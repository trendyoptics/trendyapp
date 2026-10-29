-- TsysOptics · devoluciones internas con reversión total de venta
-- PILOTO: solamente registrar reembolsos ya efectuados externamente.
-- No envía dinero ni genera una nota crédito electrónica DIAN.
BEGIN;

ALTER TABLE public.ventas_tsysoptics
  ADD COLUMN IF NOT EXISTS devuelta_en timestamptz,
  ADD COLUMN IF NOT EXISTS devuelta_por uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS motivo_devolucion text;
ALTER TABLE public.ventas_tsysoptics DROP CONSTRAINT ventas_tsysoptics_estado_check;
ALTER TABLE public.ventas_tsysoptics ADD CONSTRAINT ventas_tsysoptics_estado_check
 CHECK (estado IN ('emitida','anulada','devuelta'));
ALTER TABLE public.ventas_tsysoptics DROP CONSTRAINT ventas_tsysoptics_anulacion_integridad;
ALTER TABLE public.ventas_tsysoptics ADD CONSTRAINT ventas_tsysoptics_anulacion_integridad CHECK (
  (estado='emitida' AND anulada_en IS NULL AND anulada_por IS NULL
    AND motivo_anulacion IS NULL AND devuelta_en IS NULL AND devuelta_por IS NULL
    AND motivo_devolucion IS NULL)
  OR
  (estado='anulada' AND anulada_en IS NOT NULL AND anulada_por IS NOT NULL
    AND char_length(btrim(motivo_anulacion)) BETWEEN 10 AND 300
    AND abonado=0 AND saldo=0 AND devuelta_en IS NULL AND devuelta_por IS NULL
    AND motivo_devolucion IS NULL)
  OR
  (estado='devuelta' AND devuelta_en IS NOT NULL AND devuelta_por IS NOT NULL
    AND char_length(btrim(motivo_devolucion)) BETWEEN 10 AND 300
    AND abonado>0 AND saldo=0
    AND anulada_en IS NULL AND anulada_por IS NULL AND motivo_anulacion IS NULL)
);

CREATE TABLE IF NOT EXISTS public.devoluciones_ventas_tsysoptics (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 venta_id uuid NOT NULL UNIQUE REFERENCES public.ventas_tsysoptics(id) ON DELETE RESTRICT,
 numero_venta bigint NOT NULL,
 operacion_id uuid NOT NULL UNIQUE,
 turno_id uuid NOT NULL REFERENCES public.turnos_caja_tsysoptics(id) ON DELETE RESTRICT,
 registrado_por uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
 fecha timestamptz NOT NULL DEFAULT now(),
 motivo text NOT NULL CHECK (char_length(btrim(motivo)) BETWEEN 10 AND 300),
 monto_reembolsado numeric(14,2) NOT NULL CHECK (monto_reembolsado>0),
 saldo_condonado numeric(14,2) NOT NULL CHECK (saldo_condonado>=0),
 reintegro_stock boolean NOT NULL,
 detalle_inventario jsonb NOT NULL DEFAULT '[]'::jsonb
  CHECK (jsonb_typeof(detalle_inventario)='array'),
 confirmacion_reembolso_manual boolean NOT NULL CHECK (confirmacion_reembolso_manual=true)
);
CREATE INDEX IF NOT EXISTS devoluciones_fecha_tsysoptics ON public.devoluciones_ventas_tsysoptics(fecha DESC);
CREATE INDEX IF NOT EXISTS devoluciones_turno_tsysoptics ON public.devoluciones_ventas_tsysoptics(turno_id);

CREATE TABLE IF NOT EXISTS public.reembolsos_medios_tsysoptics(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 devolucion_id uuid NOT NULL REFERENCES public.devoluciones_ventas_tsysoptics(id) ON DELETE RESTRICT,
 pago_original_id bigint NOT NULL UNIQUE REFERENCES public.pagos_ventas_tsysoptics(id) ON DELETE RESTRICT,
 medio text NOT NULL CHECK (medio IN ('efectivo','transferencia','nequi','daviplata','tarjeta','otro')),
 monto numeric(14,2) NOT NULL CHECK(monto>0)
);
CREATE INDEX IF NOT EXISTS reembolsos_medios_devolucion_idx
 ON public.reembolsos_medios_tsysoptics(devolucion_id);

ALTER TABLE public.devoluciones_ventas_tsysoptics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reembolsos_medios_tsysoptics ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.devoluciones_ventas_tsysoptics FROM anon,authenticated;
REVOKE ALL ON public.reembolsos_medios_tsysoptics FROM anon,authenticated;
GRANT SELECT ON public.devoluciones_ventas_tsysoptics TO authenticated;
GRANT SELECT ON public.reembolsos_medios_tsysoptics TO authenticated;
DROP POLICY IF EXISTS devoluciones_admin_select ON public.devoluciones_ventas_tsysoptics;
CREATE POLICY devoluciones_admin_select ON public.devoluciones_ventas_tsysoptics
 FOR SELECT TO authenticated USING(tsys_privado.tiene_rol(ARRAY['administrador'::text]));
DROP POLICY IF EXISTS reembolsos_medios_admin_select ON public.reembolsos_medios_tsysoptics;
CREATE POLICY reembolsos_medios_admin_select ON public.reembolsos_medios_tsysoptics
 FOR SELECT TO authenticated USING(tsys_privado.tiene_rol(ARRAY['administrador'::text]));

CREATE OR REPLACE FUNCTION tsys_privado.devolver_venta_interna_tsysoptics(
 p_venta_id uuid,p_motivo text,p_reintegra_stock boolean,
 p_reembolso_confirmado boolean,p_operacion_id uuid
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public
AS $function$
DECLARE
 v_actor uuid:=auth.uid();
 v_turno uuid;
 v_venta record;
 v_motivo text:=btrim(coalesce(p_motivo,''));
 v_devolucion uuid;
 v_pagos numeric(14,2);
 v_efectivo_devolver numeric(14,2);
 v_efectivo_disponible numeric(14,2);
 v_detalle record;
 v_stock integer;
 v_inventario jsonb:='[]'::jsonb;
 v_cantidad integer:=0;
BEGIN
 IF v_actor IS NULL OR NOT tsys_privado.tiene_rol(ARRAY['administrador'::text])
 THEN RAISE EXCEPTION 'No autorizado para devolver ventas' USING ERRCODE='42501'; END IF;
 IF p_venta_id IS NULL OR p_operacion_id IS NULL OR
    char_length(v_motivo) NOT BETWEEN 10 AND 300 OR
    p_reintegra_stock IS NULL OR p_reembolso_confirmado IS DISTINCT FROM true
 THEN RAISE EXCEPTION 'Confirma el reintegro efectivo del dinero e indica el motivo y destino de mercancía'
 USING ERRCODE='22023'; END IF;

 -- Los reintentos deben regresar el mismo resultado, aun si el turno ya cerró.
 SELECT id INTO v_devolucion FROM public.devoluciones_ventas_tsysoptics
 WHERE venta_id=p_venta_id AND operacion_id=p_operacion_id AND registrado_por=v_actor;
 IF FOUND THEN RETURN v_devolucion; END IF;

 -- Bloquear el turno primero, igual que ventas y abonos. Evita carreras con el cierre.
 SELECT id INTO v_turno FROM public.turnos_caja_tsysoptics
 WHERE estado='abierta' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Debes abrir un turno para registrar la devolución' USING ERRCODE='22023'; END IF;

 SELECT id,numero,estado,total,abonado,saldo INTO v_venta
 FROM public.ventas_tsysoptics WHERE id=p_venta_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Venta no encontrada' USING ERRCODE='P0002';END IF;
 IF v_venta.estado <> 'emitida' THEN
  RAISE EXCEPTION 'La venta ya fue anulada o devuelta' USING ERRCODE='22023';
 END IF;
 IF v_venta.abonado<=0 OR v_venta.abonado>v_venta.total THEN
  RAISE EXCEPTION 'Solo admite ventas con cobros para devolución completa' USING ERRCODE='22023';
 END IF;
 SELECT coalesce(sum(p.monto),0),
        coalesce(sum(p.monto) FILTER(WHERE p.medio='efectivo'),0)
 INTO v_pagos,v_efectivo_devolver
 FROM public.pagos_ventas_tsysoptics p WHERE p.venta_id=v_venta.id;
 IF v_pagos<>v_venta.abonado OR v_venta.total<>v_venta.abonado+v_venta.saldo THEN
  RAISE EXCEPTION 'Inconsistencia contable: verificar pagos de la venta'
  USING ERRCODE='22023';END IF;
 IF EXISTS(SELECT 1 FROM public.devoluciones_ventas_tsysoptics WHERE operacion_id=p_operacion_id) THEN
  RAISE EXCEPTION 'Identificador de devolución ya utilizado' USING ERRCODE='22023';
 END IF;

 -- Efectivo en caja = fondo + ingresos efectivo + ingresos manuales
 -- - egresos manuales - reembolsos efectivo YA registrados en este turno.
 SELECT t.fondo_inicial
 +coalesce((SELECT sum(p.monto) FROM public.pagos_ventas_tsysoptics p
           WHERE p.turno_id=t.id AND p.medio='efectivo'),0)
 +coalesce((SELECT sum(m.monto) FROM public.movimientos_caja_tsysoptics m
           WHERE m.turno_id=t.id AND m.tipo='ingreso'),0)
 -coalesce((SELECT sum(m.monto) FROM public.movimientos_caja_tsysoptics m
           WHERE m.turno_id=t.id AND m.tipo='egreso'),0)
 -coalesce((SELECT sum(r.monto) FROM public.reembolsos_medios_tsysoptics r
             JOIN public.devoluciones_ventas_tsysoptics d ON d.id=r.devolucion_id
           WHERE d.turno_id=t.id AND r.medio='efectivo'),0)
 INTO v_efectivo_disponible
 FROM public.turnos_caja_tsysoptics t WHERE t.id=v_turno;
 IF v_efectivo_devolver>v_efectivo_disponible THEN
  RAISE EXCEPTION 'No hay efectivo suficiente en el turno para registrar el reembolso'
  USING ERRCODE='22023';END IF;

 -- Solo si la mercancía fue recibida y es reutilizable se reintegra al catálogo.
 IF p_reintegra_stock THEN
  PERFORM set_config('tsys.stock_motivo',
   'Devolución V-'||lpad(v_venta.numero::text,6,'0'),true);
  FOR v_detalle IN SELECT producto_id,codigo_snapshot,cantidad
    FROM public.detalle_ventas_tsysoptics
    WHERE venta_id=p_venta_id ORDER BY producto_id
  LOOP
   SELECT cantidad INTO v_stock FROM public.productos_tsysoptics
    WHERE id=v_detalle.producto_id FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'Referencia no encontrada' USING ERRCODE='P0002';END IF;
   IF v_stock>2147483647-v_detalle.cantidad THEN
    RAISE EXCEPTION 'Excedería la capacidad del inventario' USING ERRCODE='22003';END IF;
   UPDATE public.productos_tsysoptics SET cantidad=cantidad+v_detalle.cantidad
   WHERE id=v_detalle.producto_id;
   v_inventario:=v_inventario||jsonb_build_array(jsonb_build_object(
    'producto_id',v_detalle.producto_id,'codigo',v_detalle.codigo_snapshot,
    'cantidad',v_detalle.cantidad));
   v_cantidad:=v_cantidad+1;
  END LOOP;
  IF v_cantidad=0 THEN
   RAISE EXCEPTION 'La venta no tiene referencias para devolver' USING ERRCODE='22023';END IF;
 END IF;

 INSERT INTO public.devoluciones_ventas_tsysoptics
 (venta_id,numero_venta,operacion_id,turno_id,registrado_por,motivo,
  monto_reembolsado,saldo_condonado,reintegro_stock,detalle_inventario,confirmacion_reembolso_manual)
 VALUES (v_venta.id,v_venta.numero,p_operacion_id,v_turno,v_actor,v_motivo,
         v_venta.abonado,v_venta.saldo,p_reintegra_stock,v_inventario,true)
 RETURNING id INTO v_devolucion;

 INSERT INTO public.reembolsos_medios_tsysoptics
  (devolucion_id,pago_original_id,medio,monto)
 SELECT v_devolucion,p.id,p.medio,p.monto
 FROM public.pagos_ventas_tsysoptics p WHERE p.venta_id=p_venta_id;

 UPDATE public.ventas_tsysoptics
 SET estado='devuelta',saldo=0,devuelta_en=now(),devuelta_por=v_actor,
 motivo_devolucion=v_motivo
 WHERE id=v_venta.id;
 RETURN v_devolucion;
END
$function$;

REVOKE ALL ON FUNCTION tsys_privado.devolver_venta_interna_tsysoptics(uuid,text,boolean,boolean,uuid)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION tsys_privado.devolver_venta_interna_tsysoptics(uuid,text,boolean,boolean,uuid)
 TO authenticated;

CREATE OR REPLACE FUNCTION public.devolver_venta_tsysoptics(
 p_venta_id uuid,p_motivo text,p_reintegra_stock boolean,
 p_reembolso_confirmado boolean,p_operacion_id uuid
)
RETURNS uuid LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog,public
AS $function$
 SELECT tsys_privado.devolver_venta_interna_tsysoptics(
  p_venta_id,p_motivo,p_reintegra_stock,p_reembolso_confirmado,p_operacion_id);
$function$;
REVOKE ALL ON FUNCTION public.devolver_venta_tsysoptics(uuid,text,boolean,boolean,uuid)
 FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.devolver_venta_tsysoptics(uuid,text,boolean,boolean,uuid)
 TO authenticated;

-- El cierre usa pagos en efectivo menos reembolsos en efectivo.
CREATE OR REPLACE FUNCTION tsys_privado.cerrar_turno_caja_interno_tsysoptics(
 p_contado numeric,p_observaciones text
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public AS $function$
DECLARE
 v_actor uuid:=auth.uid();
 v_id uuid;v_fondo numeric(14,2);v_recibido numeric(14,2);
 v_reembolsado numeric(14,2);v_ingresos numeric(14,2);v_egresos numeric(14,2);
 v_esperado numeric(14,2);
BEGIN
 IF v_actor IS NULL OR NOT tsys_privado.tiene_rol(ARRAY['administrador'::text])
 THEN RAISE EXCEPTION 'No autorizado' USING ERRCODE='42501';END IF;
 IF p_contado IS NULL OR p_contado<0 OR p_contado<>round(p_contado,2)
 OR p_contado>999999999999 OR char_length(coalesce(p_observaciones,''))>500
 THEN RAISE EXCEPTION 'Arqueo inválido' USING ERRCODE='22023';END IF;
 SELECT id,fondo_inicial INTO v_id,v_fondo
 FROM public.turnos_caja_tsysoptics WHERE estado='abierta' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'No existe un turno abierto' USING ERRCODE='22023';END IF;
 SELECT coalesce(sum(monto),0) INTO v_recibido FROM public.pagos_ventas_tsysoptics
 WHERE turno_id=v_id AND medio='efectivo';
 SELECT coalesce(sum(r.monto),0) INTO v_reembolsado FROM public.reembolsos_medios_tsysoptics r
 JOIN public.devoluciones_ventas_tsysoptics d ON d.id=r.devolucion_id
 WHERE d.turno_id=v_id AND r.medio='efectivo';
 SELECT coalesce(sum(monto) FILTER(WHERE tipo='ingreso'),0),
        coalesce(sum(monto) FILTER(WHERE tipo='egreso'),0)
 INTO v_ingresos,v_egresos FROM public.movimientos_caja_tsysoptics WHERE turno_id=v_id;
 v_esperado:=v_fondo+v_recibido-v_reembolsado+v_ingresos-v_egresos;
 UPDATE public.turnos_caja_tsysoptics
 SET estado='cerrada',cerrada_en=now(),cerrada_por=v_actor,
     efectivo_esperado=v_esperado,efectivo_contado=p_contado,
     diferencia=p_contado-v_esperado,
     observaciones_cierre=nullif(btrim(coalesce(p_observaciones,'')),'')
 WHERE id=v_id;
 RETURN v_id;
END $function$;

-- Los egresos manuales también deben considerar reembolsos previos.
CREATE OR REPLACE FUNCTION tsys_privado.movimiento_manual_caja_interno_tsysoptics(
 p_tipo text,p_monto numeric,p_motivo text,p_operacion_id uuid
)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public AS $function$
DECLARE v_id bigint;v_turno uuid;v_actor uuid:=auth.uid();v_disponible numeric(14,2);
BEGIN
 IF v_actor IS NULL OR NOT tsys_privado.tiene_rol(ARRAY['administrador'::text])
 THEN RAISE EXCEPTION 'No autorizado' USING ERRCODE='42501';END IF;
 IF p_operacion_id IS NULL OR p_tipo NOT IN ('ingreso','egreso')
 OR p_monto IS NULL OR p_monto<=0 OR p_monto<>round(p_monto,2) OR p_monto>999999999999
 OR p_motivo IS NULL OR char_length(btrim(p_motivo)) NOT BETWEEN 3 AND 160
 THEN RAISE EXCEPTION 'Datos de movimiento de caja inválidos' USING ERRCODE='22023';END IF;
 SELECT id INTO v_id FROM public.movimientos_caja_tsysoptics
 WHERE operacion_id=p_operacion_id AND usuario_id=v_actor;
 IF FOUND THEN RETURN v_id;END IF;
 SELECT id INTO v_turno FROM public.turnos_caja_tsysoptics
 WHERE estado='abierta' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'No existe turno abierto' USING ERRCODE='22023';END IF;
 IF p_tipo='egreso' THEN
  SELECT t.fondo_inicial
   +coalesce((SELECT sum(p.monto) FROM public.pagos_ventas_tsysoptics p
             WHERE p.turno_id=t.id AND p.medio='efectivo'),0)
   +coalesce((SELECT sum(m.monto) FROM public.movimientos_caja_tsysoptics m
             WHERE m.turno_id=t.id AND m.tipo='ingreso'),0)
   -coalesce((SELECT sum(m.monto) FROM public.movimientos_caja_tsysoptics m
             WHERE m.turno_id=t.id AND m.tipo='egreso'),0)
   -coalesce((SELECT sum(r.monto) FROM public.reembolsos_medios_tsysoptics r
       JOIN public.devoluciones_ventas_tsysoptics d ON d.id=r.devolucion_id
             WHERE d.turno_id=t.id AND r.medio='efectivo'),0)
  INTO v_disponible FROM public.turnos_caja_tsysoptics t WHERE t.id=v_turno;
  IF p_monto>v_disponible THEN
   RAISE EXCEPTION 'El egreso excede el efectivo esperado de caja' USING ERRCODE='22023';END IF;
 END IF;
 INSERT INTO public.movimientos_caja_tsysoptics
 (turno_id,tipo,monto,motivo,usuario_id,operacion_id)
 VALUES(v_turno,p_tipo,p_monto,btrim(p_motivo),v_actor,p_operacion_id)
 RETURNING id INTO v_id;
 RETURN v_id;
END $function$;

-- Se amplía el resumen agregando devoluciones por cada medio sin alterar
-- las primeras columnas consumidas por las pantallas existentes.
DROP FUNCTION public.resumen_turno_caja_tsysoptics();
CREATE FUNCTION public.resumen_turno_caja_tsysoptics()
RETURNS TABLE(
 turno_id uuid,estado text,fecha_apertura timestamptz,fecha_cierre timestamptz,
 fondo numeric,recibido_efectivo numeric,recibido_nequi numeric,
 recibido_daviplata numeric,recibido_transferencia numeric,
 recibido_tarjeta numeric,recibido_otro numeric,ingreso_manual numeric,
 egreso_manual numeric,esperado numeric,contado numeric,diferencia_efectivo numeric,
 devuelto_efectivo numeric,devuelto_nequi numeric,devuelto_daviplata numeric,
 devuelto_transferencia numeric,devuelto_tarjeta numeric,devuelto_otro numeric
)
LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog,public AS $function$
 SELECT t.id,t.estado,t.abierta_en,t.cerrada_en,t.fondo_inicial,
 coalesce((SELECT sum(p.monto) FROM public.pagos_ventas_tsysoptics p WHERE p.turno_id=t.id AND p.medio='efectivo'),0),
 coalesce((SELECT sum(p.monto) FROM public.pagos_ventas_tsysoptics p WHERE p.turno_id=t.id AND p.medio='nequi'),0),
 coalesce((SELECT sum(p.monto) FROM public.pagos_ventas_tsysoptics p WHERE p.turno_id=t.id AND p.medio='daviplata'),0),
 coalesce((SELECT sum(p.monto) FROM public.pagos_ventas_tsysoptics p WHERE p.turno_id=t.id AND p.medio='transferencia'),0),
 coalesce((SELECT sum(p.monto) FROM public.pagos_ventas_tsysoptics p WHERE p.turno_id=t.id AND p.medio='tarjeta'),0),
 coalesce((SELECT sum(p.monto) FROM public.pagos_ventas_tsysoptics p WHERE p.turno_id=t.id AND p.medio='otro'),0),
 coalesce((SELECT sum(m.monto) FROM public.movimientos_caja_tsysoptics m WHERE m.turno_id=t.id AND m.tipo='ingreso'),0),
 coalesce((SELECT sum(m.monto) FROM public.movimientos_caja_tsysoptics m WHERE m.turno_id=t.id AND m.tipo='egreso'),0),
 coalesce(t.efectivo_esperado,
   t.fondo_inicial
   +coalesce((SELECT sum(p.monto) FROM public.pagos_ventas_tsysoptics p WHERE p.turno_id=t.id AND p.medio='efectivo'),0)
   -coalesce((SELECT sum(r.monto) FROM public.reembolsos_medios_tsysoptics r JOIN public.devoluciones_ventas_tsysoptics d ON d.id=r.devolucion_id
      WHERE d.turno_id=t.id AND r.medio='efectivo'),0)
   +coalesce((SELECT sum(m.monto) FROM public.movimientos_caja_tsysoptics m WHERE m.turno_id=t.id AND m.tipo='ingreso'),0)
   -coalesce((SELECT sum(m.monto) FROM public.movimientos_caja_tsysoptics m WHERE m.turno_id=t.id AND m.tipo='egreso'),0)),
 t.efectivo_contado,t.diferencia,
 coalesce((SELECT sum(r.monto) FROM public.reembolsos_medios_tsysoptics r JOIN public.devoluciones_ventas_tsysoptics d ON d.id=r.devolucion_id
   WHERE d.turno_id=t.id AND r.medio='efectivo'),0),
 coalesce((SELECT sum(r.monto) FROM public.reembolsos_medios_tsysoptics r JOIN public.devoluciones_ventas_tsysoptics d ON d.id=r.devolucion_id
   WHERE d.turno_id=t.id AND r.medio='nequi'),0),
 coalesce((SELECT sum(r.monto) FROM public.reembolsos_medios_tsysoptics r JOIN public.devoluciones_ventas_tsysoptics d ON d.id=r.devolucion_id
   WHERE d.turno_id=t.id AND r.medio='daviplata'),0),
 coalesce((SELECT sum(r.monto) FROM public.reembolsos_medios_tsysoptics r JOIN public.devoluciones_ventas_tsysoptics d ON d.id=r.devolucion_id
   WHERE d.turno_id=t.id AND r.medio='transferencia'),0),
 coalesce((SELECT sum(r.monto) FROM public.reembolsos_medios_tsysoptics r JOIN public.devoluciones_ventas_tsysoptics d ON d.id=r.devolucion_id
   WHERE d.turno_id=t.id AND r.medio='tarjeta'),0),
 coalesce((SELECT sum(r.monto) FROM public.reembolsos_medios_tsysoptics r JOIN public.devoluciones_ventas_tsysoptics d ON d.id=r.devolucion_id
   WHERE d.turno_id=t.id AND r.medio='otro'),0)
 FROM public.turnos_caja_tsysoptics t
 WHERE t.id=(SELECT t2.id FROM public.turnos_caja_tsysoptics t2
 ORDER BY (t2.estado='abierta') DESC,t2.abierta_en DESC LIMIT 1)
$function$;
REVOKE ALL ON FUNCTION public.resumen_turno_caja_tsysoptics() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.resumen_turno_caja_tsysoptics() TO authenticated;

-- Indicadores: ventas vigentes, las devueltas conservan su histórico completo.
COMMIT;