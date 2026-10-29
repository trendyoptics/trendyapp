-- TsysOptics · Anulación AUDITABLE para ventas SIN recaudos
-- Seguridad: no se permite devolución financiera implícita. Las ventas con
-- abonos o pagos requieren la futura nota crédito/devolución de dinero.
BEGIN;

ALTER TABLE public.ventas_tsysoptics
 DROP CONSTRAINT IF EXISTS ventas_tsysoptics_estado_check;
ALTER TABLE public.ventas_tsysoptics
 ADD CONSTRAINT ventas_tsysoptics_estado_check
 CHECK (estado IN ('emitida','anulada'));
ALTER TABLE public.ventas_tsysoptics
 ADD COLUMN IF NOT EXISTS anulada_en timestamptz,
 ADD COLUMN IF NOT EXISTS anulada_por uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
 ADD COLUMN IF NOT EXISTS motivo_anulacion text;
ALTER TABLE public.ventas_tsysoptics
 ADD CONSTRAINT ventas_tsysoptics_anulacion_integridad
 CHECK (
  (estado='emitida' AND anulada_en IS NULL AND anulada_por IS NULL AND motivo_anulacion IS NULL)
  OR
  (estado='anulada' AND anulada_en IS NOT NULL AND anulada_por IS NOT NULL
    AND char_length(btrim(motivo_anulacion)) BETWEEN 10 AND 300
    AND abonado=0 AND saldo=0)
 );

CREATE TABLE IF NOT EXISTS public.anulaciones_ventas_tsysoptics(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 venta_id uuid NOT NULL UNIQUE REFERENCES public.ventas_tsysoptics(id) ON DELETE RESTRICT,
 operacion_id uuid NOT NULL UNIQUE,
 numero_venta bigint NOT NULL,
 usuario_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
 motivo text NOT NULL CHECK (char_length(btrim(motivo)) BETWEEN 10 AND 300),
 inventario_reintegrado jsonb NOT NULL CHECK (jsonb_typeof(inventario_reintegrado)='array'),
 fecha timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS anulaciones_fecha_tsysoptics
 ON public.anulaciones_ventas_tsysoptics(fecha DESC);

ALTER TABLE public.anulaciones_ventas_tsysoptics ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.anulaciones_ventas_tsysoptics FROM anon,authenticated;
GRANT SELECT ON public.anulaciones_ventas_tsysoptics TO authenticated;
DROP POLICY IF EXISTS anulaciones_ventas_admin_lectura ON public.anulaciones_ventas_tsysoptics;
CREATE POLICY anulaciones_ventas_admin_lectura ON public.anulaciones_ventas_tsysoptics
 FOR SELECT TO authenticated
 USING(tsys_privado.tiene_rol(ARRAY['administrador'::text]));

CREATE OR REPLACE FUNCTION tsys_privado.anular_venta_sin_pago_interna_tsysoptics(
 p_venta_id uuid,p_motivo text,p_operacion_id uuid
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public
AS $$
DECLARE
 v_actor uuid:=auth.uid();
 v_venta record;
 v_detalle record;
 v_stock integer;
 v_reintegrado jsonb:='[]'::jsonb;
 v_motivo text:=btrim(coalesce(p_motivo,''));
BEGIN
 IF v_actor IS NULL OR NOT tsys_privado.tiene_rol(ARRAY['administrador'::text]) THEN
  RAISE EXCEPTION 'No autorizado para anular ventas' USING ERRCODE='42501';
 END IF;
 IF p_venta_id IS NULL OR p_operacion_id IS NULL
    OR char_length(v_motivo) NOT BETWEEN 10 AND 300 THEN
  RAISE EXCEPTION 'La anulación requiere una venta y un motivo de 10 a 300 caracteres'
    USING ERRCODE='22023';
 END IF;

 SELECT id,numero,estado,total,abonado,saldo INTO v_venta
 FROM public.ventas_tsysoptics
 WHERE id=p_venta_id FOR UPDATE;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'Venta no encontrada' USING ERRCODE='P0002';
 END IF;

 IF v_venta.estado='anulada' THEN
  -- Un reintento idéntico devuelve el mismo resultado sin duplicar el stock.
  IF EXISTS(
   SELECT 1 FROM public.anulaciones_ventas_tsysoptics
   WHERE venta_id=p_venta_id AND operacion_id=p_operacion_id AND usuario_id=v_actor
  ) THEN
   RETURN p_venta_id;
  END IF;
  RAISE EXCEPTION 'Esta venta ya fue anulada' USING ERRCODE='22023';
 END IF;
 IF v_venta.estado <> 'emitida' THEN
  RAISE EXCEPTION 'Estado de venta incompatible con anulación' USING ERRCODE='22023';
 END IF;
 IF v_venta.abonado<>0 OR v_venta.saldo<>v_venta.total OR EXISTS(
  SELECT 1 FROM public.pagos_ventas_tsysoptics WHERE venta_id=p_venta_id
 ) THEN
  RAISE EXCEPTION 'La venta tiene pagos: requiere devolución financiera, no esta anulación'
   USING ERRCODE='22023';
 END IF;
 IF EXISTS(
  SELECT 1 FROM public.anulaciones_ventas_tsysoptics WHERE operacion_id=p_operacion_id
 ) THEN
  RAISE EXCEPTION 'Este identificador ya fue usado para otra anulación'
   USING ERRCODE='22023';
 END IF;

 PERFORM set_config('tsys.stock_motivo',
  'Anulación V-'||lpad(v_venta.numero::text,6,'0'),true);
 FOR v_detalle IN
  SELECT d.producto_id,d.codigo_snapshot,d.cantidad
  FROM public.detalle_ventas_tsysoptics d
  WHERE d.venta_id=p_venta_id
  ORDER BY d.producto_id
 LOOP
  SELECT cantidad INTO v_stock FROM public.productos_tsysoptics
   WHERE id=v_detalle.producto_id FOR UPDATE;
  IF NOT FOUND THEN
   RAISE EXCEPTION 'Referencia de inventario no encontrada' USING ERRCODE='P0002';
  END IF;
  IF v_stock > 2147483647 - v_detalle.cantidad THEN
   RAISE EXCEPTION 'Se excedería la capacidad máxima del inventario'
    USING ERRCODE='22003';
  END IF;
  UPDATE public.productos_tsysoptics
  SET cantidad=cantidad+v_detalle.cantidad WHERE id=v_detalle.producto_id;
  v_reintegrado:=v_reintegrado||jsonb_build_array(jsonb_build_object(
   'producto_id',v_detalle.producto_id,'codigo',v_detalle.codigo_snapshot,
   'cantidad',v_detalle.cantidad));
 END LOOP;
 IF jsonb_array_length(v_reintegrado)=0 THEN
  RAISE EXCEPTION 'Venta sin líneas de inventario' USING ERRCODE='22023';
 END IF;
 UPDATE public.ventas_tsysoptics
 SET estado='anulada',saldo=0,anulada_en=now(),anulada_por=v_actor,motivo_anulacion=v_motivo
 WHERE id=p_venta_id;
 INSERT INTO public.anulaciones_ventas_tsysoptics
 (venta_id,operacion_id,numero_venta,usuario_id,motivo,inventario_reintegrado)
 VALUES(p_venta_id,p_operacion_id,v_venta.numero,v_actor,v_motivo,v_reintegrado);
 RETURN p_venta_id;
END
$$;
REVOKE ALL ON FUNCTION tsys_privado.anular_venta_sin_pago_interna_tsysoptics(uuid,text,uuid)
 FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION tsys_privado.anular_venta_sin_pago_interna_tsysoptics(uuid,text,uuid)
 TO authenticated;

CREATE OR REPLACE FUNCTION public.anular_venta_sin_pago_tsysoptics(
 p_venta_id uuid,p_motivo text,p_operacion_id uuid
)
RETURNS uuid LANGUAGE sql SECURITY INVOKER
SET search_path=pg_catalog,public
AS $$
 SELECT tsys_privado.anular_venta_sin_pago_interna_tsysoptics(
  p_venta_id,p_motivo,p_operacion_id);
$$;
REVOKE ALL ON FUNCTION public.anular_venta_sin_pago_tsysoptics(uuid,text,uuid)
 FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.anular_venta_sin_pago_tsysoptics(uuid,text,uuid)
 TO authenticated;

-- Evitar que una venta anulada vuelva a recibir abonos en cualquier vía.
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
 v_estado text;
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
 SELECT id,saldo,estado INTO v_venta,v_saldo,v_estado
 FROM public.ventas_tsysoptics WHERE id=p_venta_id FOR UPDATE;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'Venta no encontrada' USING ERRCODE='P0002';
 END IF;
 IF v_estado <> 'emitida' THEN
  RAISE EXCEPTION 'No se aceptan abonos para ventas anuladas' USING ERRCODE='22023';
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





-- El resumen histórico incluye exclusivamente ventas vigentes.
-- Las anuladas permanecen en su historial para auditoría.
CREATE OR REPLACE FUNCTION public.resumen_ventas_tsysoptics()
RETURNS TABLE(cantidad bigint,total numeric,recibido numeric,pendiente numeric)
LANGUAGE sql SECURITY INVOKER
SET search_path=pg_catalog,public
AS $$
 SELECT count(*),
        coalesce(sum(v.total),0),
        coalesce(sum(v.abonado),0),
        coalesce(sum(v.saldo),0)
 FROM public.ventas_tsysoptics v
 WHERE v.estado='emitida';
$$;
COMMIT;
