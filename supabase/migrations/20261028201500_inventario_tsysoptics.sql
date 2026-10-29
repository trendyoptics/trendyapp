-- TsysOptics · Inventario centralizado
-- Tabla de referencias, movimientos auditables, roles administradores.
-- No altera ni vincula todavía el módulo de Ventas de demostración.
BEGIN;

CREATE TABLE IF NOT EXISTS public.productos_tsysoptics (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 codigo text NOT NULL UNIQUE CHECK (char_length(btrim(codigo)) BETWEEN 3 AND 40),
 nombre text NOT NULL CHECK (char_length(btrim(nombre)) BETWEEN 2 AND 120),
 tipo text NOT NULL CHECK (tipo IN ('Montura','Lente oftálmico','Accesorio')),
 precio_venta numeric(12,2) NOT NULL CHECK (precio_venta >= 0),
 costo_compra numeric(12,2) NULL CHECK (costo_compra IS NULL OR costo_compra >= 0),
 cantidad integer NOT NULL DEFAULT 0 CHECK (cantidad >= 0),
 stock_minimo integer NOT NULL DEFAULT 0 CHECK (stock_minimo >= 0),
 activo boolean NOT NULL DEFAULT true,
 creado_por uuid NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
 creado_en timestamptz NOT NULL DEFAULT now(),
 actualizado_en timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.movimientos_inventario_tsysoptics (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 producto_id uuid NOT NULL REFERENCES public.productos_tsysoptics(id) ON DELETE RESTRICT,
 cantidad_anterior integer NOT NULL CHECK (cantidad_anterior>=0),
 cantidad_nueva integer NOT NULL CHECK (cantidad_nueva>=0),
 diferencia integer NOT NULL,
 motivo text NOT NULL CHECK (char_length(motivo) BETWEEN 2 AND 160),
 usuario_id uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
 creado_en timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS productos_tsysoptics_nombre_idx ON public.productos_tsysoptics(nombre);
CREATE INDEX IF NOT EXISTS movimientos_inventario_producto_fecha_idx
 ON public.movimientos_inventario_tsysoptics(producto_id,creado_en DESC);

-- Actualización sin privilegios de propietario; heredamos RLS del cliente.
CREATE OR REPLACE FUNCTION tsys_privado.actualizar_producto_tsysoptics()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path=pg_catalog,public
AS $$
BEGIN
 NEW.actualizado_en=now();
 RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION tsys_privado.actualizar_producto_tsysoptics() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS tsys_producto_fecha ON public.productos_tsysoptics;
CREATE TRIGGER tsys_producto_fecha
 BEFORE UPDATE ON public.productos_tsysoptics FOR EACH ROW
 EXECUTE FUNCTION tsys_privado.actualizar_producto_tsysoptics();

-- Auditoría de inventario: las filas del log solo las escribe el trigger,
-- jamás un cliente web. Función en esquema privado no expuesto.
CREATE OR REPLACE FUNCTION tsys_privado.registrar_movimiento_inventario_tsysoptics()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public
AS $$
DECLARE
 v_anterior integer;
 v_motivo text;
BEGIN
 IF TG_TABLE_SCHEMA <> 'public' OR TG_TABLE_NAME <> 'productos_tsysoptics' THEN
  RAISE EXCEPTION 'Evento no admitido' USING ERRCODE='42501';
 END IF;
 IF TG_OP = 'INSERT' THEN
  v_anterior := 0;
  v_motivo := 'Ingreso inicial';
 ELSE
  IF NEW.cantidad IS NOT DISTINCT FROM OLD.cantidad THEN RETURN NEW; END IF;
  v_anterior := OLD.cantidad;
  v_motivo := COALESCE(NULLIF(btrim(current_setting('tsys.stock_motivo',true)),''),'Ajuste directo');
 END IF;

 INSERT INTO public.movimientos_inventario_tsysoptics
 (producto_id,cantidad_anterior,cantidad_nueva,diferencia,motivo,usuario_id)
 VALUES (NEW.id,v_anterior,NEW.cantidad,NEW.cantidad-v_anterior,left(v_motivo,160),auth.uid());
 RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION tsys_privado.registrar_movimiento_inventario_tsysoptics() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS tsys_producto_movimiento ON public.productos_tsysoptics;
CREATE TRIGGER tsys_producto_movimiento
 AFTER INSERT OR UPDATE OF cantidad ON public.productos_tsysoptics
 FOR EACH ROW EXECUTE FUNCTION tsys_privado.registrar_movimiento_inventario_tsysoptics();

ALTER TABLE public.productos_tsysoptics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.movimientos_inventario_tsysoptics ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.productos_tsysoptics FROM anon,authenticated;
REVOKE ALL ON public.movimientos_inventario_tsysoptics FROM anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.productos_tsysoptics TO authenticated;
GRANT SELECT ON public.movimientos_inventario_tsysoptics TO authenticated;

DROP POLICY IF EXISTS tsys_productos_admin_select ON public.productos_tsysoptics;
CREATE POLICY tsys_productos_admin_select ON public.productos_tsysoptics FOR SELECT TO authenticated
 USING (tsys_privado.tiene_rol(ARRAY['administrador'::text]));
DROP POLICY IF EXISTS tsys_productos_admin_insert ON public.productos_tsysoptics;
CREATE POLICY tsys_productos_admin_insert ON public.productos_tsysoptics FOR INSERT TO authenticated
 WITH CHECK (tsys_privado.tiene_rol(ARRAY['administrador'::text]) AND creado_por=auth.uid());
DROP POLICY IF EXISTS tsys_productos_admin_update ON public.productos_tsysoptics;
CREATE POLICY tsys_productos_admin_update ON public.productos_tsysoptics FOR UPDATE TO authenticated
 USING (tsys_privado.tiene_rol(ARRAY['administrador'::text]))
 WITH CHECK (tsys_privado.tiene_rol(ARRAY['administrador'::text]));
DROP POLICY IF EXISTS tsys_movimientos_admin_read ON public.movimientos_inventario_tsysoptics;
CREATE POLICY tsys_movimientos_admin_read ON public.movimientos_inventario_tsysoptics FOR SELECT TO authenticated
 USING (tsys_privado.tiene_rol(ARRAY['administrador'::text]));

-- RPC SECURITY INVOKER para ajuste atómico y registro automático mediante trigger.
CREATE OR REPLACE FUNCTION public.ajustar_existencias_tsysoptics(
 p_producto_id uuid,p_nueva_cantidad integer,p_motivo text
) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER
SET search_path=pg_catalog,public
AS $$
DECLARE v_actual integer;
BEGIN
 IF auth.uid() IS NULL OR NOT tsys_privado.tiene_rol(ARRAY['administrador'::text])
 THEN RAISE EXCEPTION 'No autorizado' USING ERRCODE='42501'; END IF;
 IF p_nueva_cantidad IS NULL OR p_nueva_cantidad < 0
 THEN RAISE EXCEPTION 'La cantidad debe ser un entero no negativo' USING ERRCODE='22023'; END IF;
 IF p_motivo IS NULL OR char_length(btrim(p_motivo)) NOT BETWEEN 3 AND 160
 THEN RAISE EXCEPTION 'Debes justificar el ajuste de inventario' USING ERRCODE='22023'; END IF;
 PERFORM set_config('tsys.stock_motivo',btrim(p_motivo),true);
 UPDATE public.productos_tsysoptics SET cantidad=p_nueva_cantidad
 WHERE id=p_producto_id RETURNING cantidad INTO v_actual;
 IF NOT FOUND THEN RAISE EXCEPTION 'Referencia no encontrada o sin acceso' USING ERRCODE='P0002'; END IF;
 RETURN v_actual;
END
$$;
REVOKE ALL ON FUNCTION public.ajustar_existencias_tsysoptics(uuid,integer,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.ajustar_existencias_tsysoptics(uuid,integer,text) TO authenticated;

COMMIT;