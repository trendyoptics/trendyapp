-- Ciclo 3: órdenes de laboratorio vinculadas a ventas existentes.
CREATE TABLE IF NOT EXISTS public.ordenes_laboratorio_tsysoptics (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 venta_id uuid NOT NULL REFERENCES public.ventas_tsysoptics(id) ON DELETE RESTRICT,
 laboratorio text NOT NULL CHECK (char_length(trim(laboratorio)) BETWEEN 3 AND 120),
 fecha_entrega_estimada date NOT NULL,
 fecha_recepcion date,
 fecha_entrega_paciente date,
 estado text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','en_fabricacion','recibido','listo_para_entrega','entregado','cancelado')),
 observaciones text NOT NULL DEFAULT '' CHECK (char_length(observaciones)<=1000),
 creado_en timestamptz NOT NULL DEFAULT now(),
 actualizado_en timestamptz NOT NULL DEFAULT now(),
 creado_por uuid NOT NULL DEFAULT auth.uid(),
 CONSTRAINT ordenes_laboratorio_venta_unica UNIQUE (venta_id),
 CONSTRAINT ordenes_lab_recepcion_orden CHECK (fecha_entrega_paciente IS NULL OR fecha_recepcion IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS ordenes_lab_estado_fecha_tsysoptics ON public.ordenes_laboratorio_tsysoptics(estado,fecha_entrega_estimada);
ALTER TABLE public.ordenes_laboratorio_tsysoptics ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ordenes_laboratorio_tsysoptics FROM anon;
GRANT SELECT,INSERT,UPDATE ON public.ordenes_laboratorio_tsysoptics TO authenticated;
DROP POLICY IF EXISTS ordenes_lab_lectura_admin ON public.ordenes_laboratorio_tsysoptics;
CREATE POLICY ordenes_lab_lectura_admin ON public.ordenes_laboratorio_tsysoptics FOR SELECT TO authenticated
 USING (tsys_privado.tiene_rol(ARRAY['administrador'::text]));
DROP POLICY IF EXISTS ordenes_lab_insertar_admin ON public.ordenes_laboratorio_tsysoptics;
CREATE POLICY ordenes_lab_insertar_admin ON public.ordenes_laboratorio_tsysoptics FOR INSERT TO authenticated
 WITH CHECK (tsys_privado.tiene_rol(ARRAY['administrador'::text]) AND creado_por=auth.uid()
 AND EXISTS (SELECT 1 FROM public.ventas_tsysoptics v WHERE v.id=venta_id AND v.estado='emitida'));
DROP POLICY IF EXISTS ordenes_lab_actualizar_admin ON public.ordenes_laboratorio_tsysoptics;
CREATE POLICY ordenes_lab_actualizar_admin ON public.ordenes_laboratorio_tsysoptics FOR UPDATE TO authenticated
 USING (tsys_privado.tiene_rol(ARRAY['administrador'::text]))
 WITH CHECK (tsys_privado.tiene_rol(ARRAY['administrador'::text]));
