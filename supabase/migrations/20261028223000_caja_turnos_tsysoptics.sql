-- TsysOptics · Turnos y arqueo de caja, con pagos por medio y trazabilidad
-- Las transacciones antiguas no se adjudican retroactivamente a un turno.
BEGIN;
CREATE TABLE IF NOT EXISTS public.turnos_caja_tsysoptics (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 estado text NOT NULL DEFAULT 'abierta' CHECK (estado IN ('abierta','cerrada')),
 fondo_inicial numeric(14,2) NOT NULL CHECK (fondo_inicial>=0),
 abierta_en timestamptz NOT NULL DEFAULT now(),
 abierta_por uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
 cerrada_en timestamptz,
 cerrada_por uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
 efectivo_esperado numeric(14,2),
 efectivo_contado numeric(14,2),
 diferencia numeric(14,2),
 observaciones_cierre text,
 CONSTRAINT cierre_completo CHECK (
  (estado='abierta' AND cerrada_en IS NULL AND cerrada_por IS NULL AND efectivo_contado IS NULL AND diferencia IS NULL)
  OR
  (estado='cerrada' AND cerrada_en IS NOT NULL AND cerrada_por IS NOT NULL AND efectivo_contado IS NOT NULL
   AND efectivo_esperado IS NOT NULL AND diferencia IS NOT NULL)
 )
);
CREATE UNIQUE INDEX IF NOT EXISTS turno_caja_unico_abierto_tsysoptics
 ON public.turnos_caja_tsysoptics(estado) WHERE estado='abierta';
CREATE INDEX IF NOT EXISTS turnos_caja_orden_tsysoptics
 ON public.turnos_caja_tsysoptics(abierta_en DESC);

CREATE TABLE IF NOT EXISTS public.movimientos_caja_tsysoptics(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 turno_id uuid NOT NULL REFERENCES public.turnos_caja_tsysoptics(id) ON DELETE RESTRICT,
 tipo text NOT NULL CHECK(tipo IN ('ingreso','egreso')),
 monto numeric(14,2) NOT NULL CHECK(monto>0),
 motivo text NOT NULL CHECK(char_length(btrim(motivo)) BETWEEN 3 AND 160),
 usuario_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
 fecha timestamptz NOT NULL DEFAULT now(),
 operacion_id uuid NOT NULL UNIQUE
);
CREATE INDEX IF NOT EXISTS movimientos_caja_por_turno_tsysoptics
 ON public.movimientos_caja_tsysoptics(turno_id,fecha DESC);
ALTER TABLE public.pagos_ventas_tsysoptics
 ADD COLUMN IF NOT EXISTS turno_id uuid REFERENCES public.turnos_caja_tsysoptics(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS pagos_turno_tsysoptics
 ON public.pagos_ventas_tsysoptics(turno_id,medio);

ALTER TABLE public.turnos_caja_tsysoptics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.movimientos_caja_tsysoptics ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.turnos_caja_tsysoptics FROM anon,authenticated;
REVOKE ALL ON public.movimientos_caja_tsysoptics FROM anon,authenticated;
GRANT SELECT ON public.turnos_caja_tsysoptics TO authenticated;
GRANT SELECT ON public.movimientos_caja_tsysoptics TO authenticated;
DROP POLICY IF EXISTS caja_turnos_admin_lectura_tsysoptics ON public.turnos_caja_tsysoptics;
CREATE POLICY caja_turnos_admin_lectura_tsysoptics ON public.turnos_caja_tsysoptics
 FOR SELECT TO authenticated
 USING(tsys_privado.tiene_rol(ARRAY['administrador'::text]));
DROP POLICY IF EXISTS caja_movimientos_admin_lectura_tsysoptics ON public.movimientos_caja_tsysoptics;
CREATE POLICY caja_movimientos_admin_lectura_tsysoptics ON public.movimientos_caja_tsysoptics
 FOR SELECT TO authenticated
 USING(tsys_privado.tiene_rol(ARRAY['administrador'::text]));

CREATE OR REPLACE FUNCTION tsys_privado.abrir_turno_caja_interno_tsysoptics(
 p_fondo numeric
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public AS $$
DECLARE v_id uuid; v_actor uuid:=auth.uid();
BEGIN
 IF v_actor IS NULL OR NOT tsys_privado.tiene_rol(ARRAY['administrador'::text]) THEN
  RAISE EXCEPTION 'No autorizado' USING ERRCODE='42501';
 END IF;
 IF p_fondo IS NULL OR p_fondo<0 OR p_fondo<>round(p_fondo,2) OR p_fondo>999999999999 THEN
  RAISE EXCEPTION 'Fondo inicial inválido' USING ERRCODE='22023';
 END IF;
 -- La restricción única protege aperturas concurrentes.
 IF EXISTS(SELECT 1 FROM public.turnos_caja_tsysoptics WHERE estado='abierta') THEN
  RAISE EXCEPTION 'Ya existe un turno de caja abierto' USING ERRCODE='22023';
 END IF;
 INSERT INTO public.turnos_caja_tsysoptics(fondo_inicial,abierta_por)
 VALUES(p_fondo,v_actor) RETURNING id INTO v_id;
 RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION tsys_privado.movimiento_manual_caja_interno_tsysoptics(
 p_tipo text,p_monto numeric,p_motivo text,p_operacion_id uuid
) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public AS $$
DECLARE v_id bigint;v_turno uuid;v_actor uuid:=auth.uid();
BEGIN
 IF v_actor IS NULL OR NOT tsys_privado.tiene_rol(ARRAY['administrador'::text]) THEN
  RAISE EXCEPTION 'No autorizado' USING ERRCODE='42501';
 END IF;
 IF p_operacion_id IS NULL OR p_tipo NOT IN ('ingreso','egreso')
 OR p_monto IS NULL OR p_monto<=0 OR p_monto<>round(p_monto,2) OR p_monto>999999999999
 OR p_motivo IS NULL OR char_length(btrim(p_motivo)) NOT BETWEEN 3 AND 160 THEN
  RAISE EXCEPTION 'Datos de movimiento de caja inválidos' USING ERRCODE='22023';
 END IF;
 SELECT id INTO v_id FROM public.movimientos_caja_tsysoptics
 WHERE operacion_id=p_operacion_id AND usuario_id=v_actor;
 IF FOUND THEN RETURN v_id; END IF;
 SELECT id INTO v_turno FROM public.turnos_caja_tsysoptics
 WHERE estado='abierta' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'No existe turno de caja abierto' USING ERRCODE='22023'; END IF;
 INSERT INTO public.movimientos_caja_tsysoptics(turno_id,tipo,monto,motivo,usuario_id,operacion_id)
 VALUES(v_turno,p_tipo,p_monto,btrim(p_motivo),v_actor,p_operacion_id)
 RETURNING id INTO v_id;
 RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION tsys_privado.cerrar_turno_caja_interno_tsysoptics(
 p_contado numeric,p_observaciones text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public AS $$
DECLARE
 v_actor uuid:=auth.uid();
 v_id uuid;
 v_fondo numeric(14,2);
 v_recibido numeric(14,2);
 v_ingresos numeric(14,2);
 v_egresos numeric(14,2);
 v_esperado numeric(14,2);
BEGIN
 IF v_actor IS NULL OR NOT tsys_privado.tiene_rol(ARRAY['administrador'::text]) THEN
  RAISE EXCEPTION 'No autorizado' USING ERRCODE='42501';
 END IF;
 IF p_contado IS NULL OR p_contado<0 OR p_contado<>round(p_contado,2)
 OR p_contado>999999999999 OR char_length(coalesce(p_observaciones,''))>500 THEN
  RAISE EXCEPTION 'Arqueo inválido' USING ERRCODE='22023';
 END IF;
 SELECT id,fondo_inicial INTO v_id,v_fondo
 FROM public.turnos_caja_tsysoptics WHERE estado='abierta' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'No existe un turno abierto' USING ERRCODE='22023'; END IF;

 SELECT coalesce(sum(monto),0) INTO v_recibido
 FROM public.pagos_ventas_tsysoptics
 WHERE turno_id=v_id AND medio='efectivo';
 SELECT coalesce(sum(monto) FILTER(WHERE tipo='ingreso'),0),
        coalesce(sum(monto) FILTER(WHERE tipo='egreso'),0)
 INTO v_ingresos,v_egresos
 FROM public.movimientos_caja_tsysoptics WHERE turno_id=v_id;
 v_esperado:=v_fondo+v_recibido+v_ingresos-v_egresos;
 UPDATE public.turnos_caja_tsysoptics
 SET estado='cerrada',cerrada_en=now(),cerrada_por=v_actor,
  efectivo_esperado=v_esperado,efectivo_contado=p_contado,
  diferencia=p_contado-v_esperado,observaciones_cierre=nullif(btrim(coalesce(p_observaciones,'')),'')
 WHERE id=v_id;
 RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION tsys_privado.abrir_turno_caja_interno_tsysoptics(numeric) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION tsys_privado.movimiento_manual_caja_interno_tsysoptics(text,numeric,text,uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION tsys_privado.cerrar_turno_caja_interno_tsysoptics(numeric,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION tsys_privado.abrir_turno_caja_interno_tsysoptics(numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION tsys_privado.movimiento_manual_caja_interno_tsysoptics(text,numeric,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION tsys_privado.cerrar_turno_caja_interno_tsysoptics(numeric,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.abrir_turno_caja_tsysoptics(p_fondo numeric)
RETURNS uuid LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog,public
AS $$ SELECT tsys_privado.abrir_turno_caja_interno_tsysoptics(p_fondo); $$;
CREATE OR REPLACE FUNCTION public.movimiento_manual_caja_tsysoptics(p_tipo text,p_monto numeric,p_motivo text,p_operacion_id uuid)
RETURNS bigint LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog,public
AS $$ SELECT tsys_privado.movimiento_manual_caja_interno_tsysoptics(p_tipo,p_monto,p_motivo,p_operacion_id); $$;
CREATE OR REPLACE FUNCTION public.cerrar_turno_caja_tsysoptics(p_contado numeric,p_observaciones text)
RETURNS uuid LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog,public
AS $$ SELECT tsys_privado.cerrar_turno_caja_interno_tsysoptics(p_contado,p_observaciones); $$;
REVOKE ALL ON FUNCTION public.abrir_turno_caja_tsysoptics(numeric) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.movimiento_manual_caja_tsysoptics(text,numeric,text,uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.cerrar_turno_caja_tsysoptics(numeric,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.abrir_turno_caja_tsysoptics(numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.movimiento_manual_caja_tsysoptics(text,numeric,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cerrar_turno_caja_tsysoptics(numeric,text) TO authenticated;

-- Los siguientes procedimientos se ejecutan bajo la misma transacción
-- y usan el candado del turno antes de modificar existencias o pagos.
CREATE OR REPLACE FUNCTION tsys_privado.crear_venta_interna_tsysoptics(
 p_items jsonb,p_paciente_id uuid,p_abono numeric,p_medio_pago text,p_solicitud_id uuid
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public
AS $$
DECLARE
 v_actor uuid:=auth.uid();
 v_id uuid;
 v_numero bigint;
 v_turno_id uuid;
 v_item jsonb;
 v_producto_id uuid;
 v_seen uuid[]:=ARRAY[]::uuid[];
 v_cantidad integer;
 v_stock integer;
 v_precio numeric(14,2);
 v_costo numeric(14,2);
 v_codigo text;
 v_nombre text;
 v_activo boolean;
 v_total numeric(14,2):=0;
 v_abono numeric(14,2);
 v_linea numeric(14,2);
BEGIN
 IF v_actor IS NULL OR NOT tsys_privado.tiene_rol(ARRAY['administrador'::text]) THEN
  RAISE EXCEPTION 'No autorizado para emitir ventas' USING ERRCODE='42501';
 END IF;
 IF p_solicitud_id IS NULL THEN
  RAISE EXCEPTION 'Falta identificador de la operación' USING ERRCODE='22023';
 END IF;

 SELECT id INTO v_id FROM public.ventas_tsysoptics
 WHERE solicitud_id=p_solicitud_id AND creado_por=v_actor;
 IF FOUND THEN RETURN v_id; END IF;
 -- Bloquea el turno abierto antes de cambiar existencias o registrar pagos.
 -- El cierre toma el mismo lock y espera cualquier venta en curso.
 SELECT id INTO v_turno_id FROM public.turnos_caja_tsysoptics
 WHERE estado='abierta' FOR UPDATE;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'Debes abrir caja antes de registrar una venta' USING ERRCODE='22023';
 END IF;

 IF jsonb_typeof(p_items) IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 20 THEN
  RAISE EXCEPTION 'La venta debe tener entre 1 y 20 referencias'
  USING ERRCODE='22023';
 END IF;
 IF p_paciente_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM public.pacientes_tsysoptics WHERE id=p_paciente_id
 ) THEN
  RAISE EXCEPTION 'Paciente no encontrado' USING ERRCODE='22023';
 END IF;

 IF p_abono IS NULL OR p_abono < 0 OR p_abono>999999999999
    OR p_abono<>round(p_abono,2) THEN
  RAISE EXCEPTION 'Abono inicial inválido' USING ERRCODE='22023';
 END IF;
 v_abono:=p_abono;
 IF v_abono>0 AND p_medio_pago NOT IN ('efectivo','transferencia','nequi','daviplata','tarjeta','otro') THEN
  RAISE EXCEPTION 'Medio de pago inválido' USING ERRCODE='22023';
 END IF;

 INSERT INTO public.ventas_tsysoptics(solicitud_id,paciente_id,creado_por)
 VALUES(p_solicitud_id,p_paciente_id,v_actor)
 RETURNING id,numero INTO v_id,v_numero;
 PERFORM set_config('tsys.stock_motivo','Venta V-'||lpad(v_numero::text,6,'0'),true);

 -- Orden determinista para reducir bloqueos concurrentes.
 FOR v_item IN
  SELECT x FROM jsonb_array_elements(p_items) AS t(x)
  ORDER BY x->>'producto_id'
 LOOP
  IF jsonb_typeof(v_item) IS DISTINCT FROM 'object'
     OR coalesce(v_item->>'producto_id','')=''
     OR coalesce(v_item->>'cantidad','') !~ '^[1-9][0-9]{0,3}$' THEN
   RAISE EXCEPTION 'Referencia o cantidad inválida' USING ERRCODE='22023';
  END IF;
  v_producto_id:=(v_item->>'producto_id')::uuid;
  v_cantidad:=(v_item->>'cantidad')::integer;
  IF v_producto_id = ANY(v_seen) THEN
   RAISE EXCEPTION 'No repitas la misma referencia en la venta' USING ERRCODE='22023';
  END IF;
  v_seen:=array_append(v_seen,v_producto_id);

  SELECT codigo,nombre,precio_venta,costo_compra,cantidad,activo
    INTO v_codigo,v_nombre,v_precio,v_costo,v_stock,v_activo
    FROM public.productos_tsysoptics
    WHERE id=v_producto_id FOR UPDATE;
  IF NOT FOUND OR NOT v_activo THEN
   RAISE EXCEPTION 'La referencia no está disponible' USING ERRCODE='22023';
  END IF;
  IF v_stock<v_cantidad THEN
   RAISE EXCEPTION 'Existencias insuficientes para %',v_codigo USING ERRCODE='22023';
  END IF;

  v_linea:=round(v_precio*v_cantidad,2);
  v_total:=v_total+v_linea;

  UPDATE public.productos_tsysoptics
    SET cantidad=cantidad-v_cantidad WHERE id=v_producto_id;

  INSERT INTO public.detalle_ventas_tsysoptics
   (venta_id,producto_id,codigo_snapshot,nombre_snapshot,cantidad,precio_unitario,costo_unitario,total_linea)
  VALUES
   (v_id,v_producto_id,v_codigo,v_nombre,v_cantidad,v_precio,v_costo,v_linea);
 END LOOP;

 IF v_abono>v_total THEN
  RAISE EXCEPTION 'El abono no puede superar el total' USING ERRCODE='22023';
 END IF;
 UPDATE public.ventas_tsysoptics
   SET total=v_total,abonado=v_abono,saldo=v_total-v_abono
   WHERE id=v_id;
 IF v_abono>0 THEN
  INSERT INTO public.pagos_ventas_tsysoptics
   (venta_id,operacion_id,monto,medio,registrado_por,turno_id)
  VALUES(v_id,p_solicitud_id,v_abono,p_medio_pago,v_actor,v_turno_id);
 END IF;
 RETURN v_id;
END
$$;


CREATE OR REPLACE FUNCTION tsys_privado.registrar_abono_interno_tsysoptics(
 p_venta_id uuid,p_monto numeric,p_medio text,p_operacion_id uuid
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public
AS $$
DECLARE
 v_actor uuid:=auth.uid();
 v_saldo numeric(14,2);
 v_venta uuid;
 v_turno_id uuid;
BEGIN
 IF v_actor IS NULL OR NOT tsys_privado.tiene_rol(ARRAY['administrador'::text]) THEN
  RAISE EXCEPTION 'No autorizado para registrar cobros' USING ERRCODE='42501';
 END IF;
 IF p_venta_id IS NULL OR p_operacion_id IS NULL THEN
  RAISE EXCEPTION 'Faltan datos de la operación' USING ERRCODE='22023';
 END IF;
 IF p_monto IS NULL OR p_monto<=0 OR p_monto<>round(p_monto,2) THEN
  RAISE EXCEPTION 'El valor del abono debe ser positivo' USING ERRCODE='22023';
 END IF;
 IF p_medio NOT IN ('efectivo','transferencia','nequi','daviplata','tarjeta','otro') THEN
  RAISE EXCEPTION 'Medio de pago inválido' USING ERRCODE='22023';
 END IF;
 -- Las ventas y los abonos bloquean el mismo turno que utiliza el cierre.
 SELECT id INTO v_turno_id FROM public.turnos_caja_tsysoptics
 WHERE estado='abierta' FOR UPDATE;
 IF NOT FOUND THEN
  -- Reconoce reintentos idénticos, aunque el turno haya cerrado.
  SELECT venta_id INTO v_venta FROM public.pagos_ventas_tsysoptics
  WHERE operacion_id=p_operacion_id AND venta_id=p_venta_id;
  IF FOUND THEN RETURN v_venta; END IF;
  RAISE EXCEPTION 'Debes abrir caja antes de registrar un abono' USING ERRCODE='22023';
 END IF;
 -- El bloqueo evita que dos abonos simultáneos excedan el saldo.
 SELECT id,saldo INTO v_venta,v_saldo
 FROM public.ventas_tsysoptics WHERE id=p_venta_id FOR UPDATE;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'Venta no encontrada' USING ERRCODE='P0002';
 END IF;
 IF EXISTS(
  SELECT 1 FROM public.pagos_ventas_tsysoptics
  WHERE operacion_id=p_operacion_id AND venta_id=p_venta_id
 ) THEN RETURN v_venta; END IF;
 IF p_monto>v_saldo THEN
  RAISE EXCEPTION 'Abono superior al saldo pendiente' USING ERRCODE='22023';
 END IF;
 INSERT INTO public.pagos_ventas_tsysoptics
 (venta_id,operacion_id,monto,medio,registrado_por,turno_id)
 VALUES(v_venta,p_operacion_id,p_monto,p_medio,v_actor,v_turno_id);
 UPDATE public.ventas_tsysoptics
 SET abonado=abonado+p_monto,saldo=saldo-p_monto WHERE id=v_venta;
 RETURN v_venta;
END
$$;



CREATE OR REPLACE FUNCTION public.resumen_turno_caja_tsysoptics()
RETURNS TABLE(
 turno_id uuid, estado text, fecha_apertura timestamptz,fecha_cierre timestamptz,
 fondo numeric,recibido_efectivo numeric,recibido_nequi numeric,
 recibido_daviplata numeric,recibido_transferencia numeric,
 recibido_tarjeta numeric,recibido_otro numeric,ingreso_manual numeric,
 egreso_manual numeric,esperado numeric,contado numeric,diferencia_efectivo numeric
)
LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog,public
AS $$
 SELECT t.id,t.estado,t.abierta_en,t.cerrada_en,t.fondo_inicial,
 coalesce(sum(p.monto) FILTER(WHERE p.medio='efectivo'),0),
 coalesce(sum(p.monto) FILTER(WHERE p.medio='nequi'),0),
 coalesce(sum(p.monto) FILTER(WHERE p.medio='daviplata'),0),
 coalesce(sum(p.monto) FILTER(WHERE p.medio='transferencia'),0),
 coalesce(sum(p.monto) FILTER(WHERE p.medio='tarjeta'),0),
 coalesce(sum(p.monto) FILTER(WHERE p.medio='otro'),0),
 coalesce((SELECT sum(m.monto) FROM public.movimientos_caja_tsysoptics m
   WHERE m.turno_id=t.id AND m.tipo='ingreso'),0),
 coalesce((SELECT sum(m.monto) FROM public.movimientos_caja_tsysoptics m
   WHERE m.turno_id=t.id AND m.tipo='egreso'),0),
 coalesce(t.efectivo_esperado,
  t.fondo_inicial
  +coalesce(sum(p.monto) FILTER(WHERE p.medio='efectivo'),0)
  +coalesce((SELECT sum(m.monto) FROM public.movimientos_caja_tsysoptics m
   WHERE m.turno_id=t.id AND m.tipo='ingreso'),0)
  -coalesce((SELECT sum(m.monto) FROM public.movimientos_caja_tsysoptics m
   WHERE m.turno_id=t.id AND m.tipo='egreso'),0)),
 t.efectivo_contado,t.diferencia
 FROM public.turnos_caja_tsysoptics t
 LEFT JOIN public.pagos_ventas_tsysoptics p ON p.turno_id=t.id
 WHERE t.id=(SELECT t2.id FROM public.turnos_caja_tsysoptics t2
  ORDER BY (t2.estado='abierta') DESC,t2.abierta_en DESC LIMIT 1)
 GROUP BY t.id,t.estado,t.abierta_en,t.cerrada_en,t.fondo_inicial,t.efectivo_esperado,t.efectivo_contado,t.diferencia;
$$;
REVOKE ALL ON FUNCTION public.resumen_turno_caja_tsysoptics() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.resumen_turno_caja_tsysoptics() TO authenticated;
COMMIT;
