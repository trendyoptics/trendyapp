-- TsysOptics · Agenda centralizada
-- Las citas se conservan en Supabase. Los administradores pueden consultarlas
-- y gestionarlas; otros roles no acceden por la API.
BEGIN;
CREATE TABLE IF NOT EXISTS public.citas_tsysoptics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  paciente_id uuid NULL REFERENCES public.pacientes_tsysoptics(id) ON DELETE RESTRICT,
  referencia text NOT NULL CHECK (char_length(btrim(referencia)) BETWEEN 2 AND 100),
  fecha date NOT NULL,
  hora time without time zone NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('Optometría','Entrega de lentes','Control')),
  estado text NOT NULL DEFAULT 'programada' CHECK (estado IN ('programada','confirmada','atendida','cancelada','no_asistio')),
  creado_por uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE RESTRICT,
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS citas_tsysoptics_fecha_hora_idx ON public.citas_tsysoptics(fecha,hora);
CREATE INDEX IF NOT EXISTS citas_tsysoptics_paciente_idx ON public.citas_tsysoptics(paciente_id);
-- Una óptica, un profesional por franja en esta primera versión.
CREATE UNIQUE INDEX IF NOT EXISTS citas_tsysoptics_horario_activo_unico
  ON public.citas_tsysoptics(fecha,hora)
  WHERE estado IN ('programada','confirmada');

CREATE OR REPLACE FUNCTION public.actualizar_fecha_citas_tsysoptics()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  NEW.actualizado_en = now();
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION public.actualizar_fecha_citas_tsysoptics() FROM PUBLIC, anon;
DROP TRIGGER IF EXISTS tsys_actualizar_fecha_cita ON public.citas_tsysoptics;
CREATE TRIGGER tsys_actualizar_fecha_cita BEFORE UPDATE
  ON public.citas_tsysoptics FOR EACH ROW
  EXECUTE FUNCTION public.actualizar_fecha_citas_tsysoptics();

ALTER TABLE public.citas_tsysoptics ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.citas_tsysoptics FROM anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.citas_tsysoptics TO authenticated;
DROP POLICY IF EXISTS tsys_citas_admin_lectura ON public.citas_tsysoptics;
CREATE POLICY tsys_citas_admin_lectura ON public.citas_tsysoptics
FOR SELECT TO authenticated
USING (tsys_privado.tiene_rol(ARRAY['administrador'::text]));
DROP POLICY IF EXISTS tsys_citas_admin_crear ON public.citas_tsysoptics;
CREATE POLICY tsys_citas_admin_crear ON public.citas_tsysoptics
FOR INSERT TO authenticated
WITH CHECK (
  tsys_privado.tiene_rol(ARRAY['administrador'::text])
  AND creado_por = auth.uid()
);
DROP POLICY IF EXISTS tsys_citas_admin_actualizar ON public.citas_tsysoptics;
CREATE POLICY tsys_citas_admin_actualizar ON public.citas_tsysoptics
FOR UPDATE TO authenticated
USING (tsys_privado.tiene_rol(ARRAY['administrador'::text]))
WITH CHECK (tsys_privado.tiene_rol(ARRAY['administrador'::text]));
COMMIT;