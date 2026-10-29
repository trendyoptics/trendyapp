-- TsysOptics · ventas y cobros integrados con inventario
-- Operaciones piloto: transaccionales, inmutables y restringidas al administrador.
BEGIN;

CREATE TABLE IF NOT EXISTS public.ventas_tsysoptics (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 numero bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 solicitud_id uuid NOT NULL UNIQUE,
 paciente_id uuid NULL REFERENCES public.pacientes_tsysoptics(id) ON DELETE RESTRICT,
 fecha timestamptz NOT NULL DEFAULT now(),
 total numeric(14,2) NOT NULL DEFAULT 0 CHECK (total>=0),
 abonado numeric(14,2) NOT NULL DEFAULT 0 CHECK (abonado>=0),
 saldo numeric(14,2) NOT NULL DEFAULT 0 CHECK (saldo>=0),
 estado text NOT NULL DEFAULT 'emitida' CHECK (estado IN ('emitida')),
 creado_por uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS ventas_tsysoptics_fecha_idx ON public.ventas_tsysoptics(fecha DESC);
CREATE INDEX IF NOT EXISTS ventas_tsysoptics_paciente_idx ON public.ventas_tsysoptics(paciente_id);

CREATE TABLE IF NOT EXISTS public.detalle_ventas_tsysoptics (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 venta_id uuid NOT NULL REFERENCES public.ventas_tsysoptics(id) ON DELETE RESTRICT,
 producto_id uuid NOT NULL REFERENCES public.productos_tsysoptics(id) ON DELETE RESTRICT,
 codigo_snapshot text NOT NULL,
 nombre_snapshot text NOT NULL,
 cantidad integer NOT NULL CHECK (cantidad>0),
 precio_unitario numeric(14,2) NOT NULL CHECK (precio_unitario>=0),
 costo_unitario numeric(14,2),
 total_linea numeric(14,2) NOT NULL CHECK (total_linea>=0),
 UNIQUE(venta_id,producto_id)
);
CREATE INDEX IF NOT EXISTS detalle_ventas_tsysoptics_venta_idx ON public.detalle_ventas_tsysoptics(venta_id);

CREATE TABLE IF NOT EXISTS public.pagos_ventas_tsysoptics (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 venta_id uuid NOT NULL REFERENCES public.ventas_tsysoptics(id) ON DELETE RESTRICT,
 operacion_id uuid NOT NULL UNIQUE,
 monto numeric(14,2) NOT NULL CHECK (monto>0),
 medio text NOT NULL CHECK (medio IN ('efectivo','transferencia','nequi','daviplata','tarjeta','otro')),
 registrado_por uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
 registrado_en timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pagos_ventas_tsysoptics_venta_idx ON public.pagos_ventas_tsysoptics(venta_id);

ALTER TABLE public.ventas_tsysoptics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.detalle_ventas_tsysoptics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pagos_ventas_tsysoptics ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.ventas_tsysoptics FROM anon,authenticated;
REVOKE ALL ON public.detalle_ventas_tsysoptics FROM anon,authenticated;
REVOKE ALL ON public.pagos_ventas_tsysoptics FROM anon,authenticated;
GRANT SELECT ON public.ventas_tsysoptics TO authenticated;
GRANT SELECT ON public.detalle_ventas_tsysoptics TO authenticated;
GRANT SELECT ON public.pagos_ventas_tsysoptics TO authenticated;

DROP POLICY IF EXISTS ventas_tsysoptics_admin_leer ON public.ventas_tsysoptics;
CREATE POLICY ventas_tsysoptics_admin_leer ON public.ventas_tsysoptics
 FOR SELECT TO authenticated
 USING (tsys_privado.tiene_rol(ARRAY['administrador'::text]));

DROP POLICY IF EXISTS detalle_ventas_tsysoptics_admin_leer ON public.detalle_ventas_tsysoptics;
CREATE POLICY detalle_ventas_tsysoptics_admin_leer ON public.detalle_ventas_tsysoptics
 FOR SELECT TO authenticated
 USING (tsys_privado.tiene_rol(ARRAY['administrador'::text]));

DROP POLICY IF EXISTS pagos_ventas_tsysoptics_admin_leer ON public.pagos_ventas_tsysoptics;
CREATE POLICY pagos_ventas_tsysoptics_admin_leer ON public.pagos_ventas_tsysoptics
 FOR SELECT TO authenticated
 USING (tsys_privado.tiene_rol(ARRAY['administrador'::text]));

-- El RPC público es SECURITY INVOKER; la lógica privilegiada está
-- aislada en un esquema no expuesto, con verificación del rol ACTIVO.
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
   (venta_id,operacion_id,monto,medio,registrado_por)
  VALUES(v_id,p_solicitud_id,v_abono,p_medio_pago,v_actor);
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
 (venta_id,operacion_id,monto,medio,registrado_por)
 VALUES(v_venta,p_operacion_id,p_monto,p_medio,v_actor);
 UPDATE public.ventas_tsysoptics
 SET abonado=abonado+p_monto,saldo=saldo-p_monto WHERE id=v_venta;
 RETURN v_venta;
END
$$;

REVOKE ALL ON FUNCTION tsys_privado.crear_venta_interna_tsysoptics(jsonb,uuid,numeric,text,uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION tsys_privado.registrar_abono_interno_tsysoptics(uuid,numeric,text,uuid) FROM PUBLIC,anon;
GRANT USAGE ON SCHEMA tsys_privado TO authenticated;
GRANT EXECUTE ON FUNCTION tsys_privado.crear_venta_interna_tsysoptics(jsonb,uuid,numeric,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION tsys_privado.registrar_abono_interno_tsysoptics(uuid,numeric,text,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.crear_venta_tsysoptics(
 p_items jsonb,p_paciente_id uuid,p_abono numeric,p_medio_pago text,p_solicitud_id uuid
)
RETURNS uuid LANGUAGE sql SECURITY INVOKER
SET search_path=pg_catalog,public
AS $$
 SELECT tsys_privado.crear_venta_interna_tsysoptics(p_items,p_paciente_id,p_abono,p_medio_pago,p_solicitud_id);
$$;

CREATE OR REPLACE FUNCTION public.registrar_abono_tsysoptics(
 p_venta_id uuid,p_monto numeric,p_medio text,p_operacion_id uuid
)
RETURNS uuid LANGUAGE sql SECURITY INVOKER
SET search_path=pg_catalog,public
AS $$
 SELECT tsys_privado.registrar_abono_interno_tsysoptics(p_venta_id,p_monto,p_medio,p_operacion_id);
$$;

REVOKE ALL ON FUNCTION public.crear_venta_tsysoptics(jsonb,uuid,numeric,text,uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.registrar_abono_tsysoptics(uuid,numeric,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crear_venta_tsysoptics(jsonb,uuid,numeric,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_abono_tsysoptics(uuid,numeric,text,uuid) TO authenticated;

COMMIT;
