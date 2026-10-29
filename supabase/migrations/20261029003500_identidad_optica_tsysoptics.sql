-- TsysOptics · Identidad visual de esta instalación (un solo negocio piloto)
-- Únicamente el administrador puede modificarla. Logo/nombre son públicos
-- para mostrar la marca de la óptica antes de iniciar sesión.
BEGIN;
CREATE TABLE IF NOT EXISTS public.identidad_optica_tsysoptics (
 id smallint PRIMARY KEY DEFAULT 1 CHECK (id=1),
 nombre_optica text NOT NULL DEFAULT 'Trendy Optics'
   CHECK (char_length(btrim(nombre_optica)) BETWEEN 2 AND 80),
 logo_data_url text NULL
   CHECK (logo_data_url IS NULL OR
     (char_length(logo_data_url) <= 210000 AND
      logo_data_url ~ '^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$')),
 actualizado_en timestamptz NOT NULL DEFAULT now(),
 actualizado_por uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL
);
INSERT INTO public.identidad_optica_tsysoptics (id,nombre_optica)
VALUES (1,'Trendy Optics') ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.actualizar_identidad_optica_tsysoptics()
RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER
SET search_path=pg_catalog,public
AS $$
BEGIN
  NEW.nombre_optica:=btrim(NEW.nombre_optica);
  NEW.actualizado_en:=now();
  NEW.actualizado_por:=auth.uid();
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION public.actualizar_identidad_optica_tsysoptics() FROM PUBLIC,anon;
DROP TRIGGER IF EXISTS tsys_identidad_fecha_actualizada ON public.identidad_optica_tsysoptics;
CREATE TRIGGER tsys_identidad_fecha_actualizada
BEFORE UPDATE ON public.identidad_optica_tsysoptics
FOR EACH ROW EXECUTE FUNCTION public.actualizar_identidad_optica_tsysoptics();

ALTER TABLE public.identidad_optica_tsysoptics ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.identidad_optica_tsysoptics FROM anon,authenticated;
-- Nombre y logo son datos de presentación que necesita mostrar el login.
GRANT SELECT ON public.identidad_optica_tsysoptics TO anon,authenticated;
-- No se conceden INSERT ni DELETE; el único registro se mantiene fijo.
GRANT UPDATE (nombre_optica,logo_data_url) ON public.identidad_optica_tsysoptics TO authenticated;

DROP POLICY IF EXISTS tsys_identidad_publica_lectura ON public.identidad_optica_tsysoptics;
CREATE POLICY tsys_identidad_publica_lectura
ON public.identidad_optica_tsysoptics FOR SELECT TO anon,authenticated USING(true);
DROP POLICY IF EXISTS tsys_identidad_admin_actualizar ON public.identidad_optica_tsysoptics;
CREATE POLICY tsys_identidad_admin_actualizar
ON public.identidad_optica_tsysoptics FOR UPDATE TO authenticated
USING (tsys_privado.tiene_rol(ARRAY['administrador'::text]))
WITH CHECK (tsys_privado.tiene_rol(ARRAY['administrador'::text]) AND id=1);
COMMIT;
