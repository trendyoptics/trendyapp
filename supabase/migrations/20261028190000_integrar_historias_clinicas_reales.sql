-- Trendy Optics / TsysOptics
-- Habilita el módulo clínico principal para registros reales, con permisos y auditoría.
-- Mantiene al rol externo limitado a pacientes DEMO; esta migración no importa datos.

BEGIN;

ALTER TABLE public.pacientes_tsysoptics
  DROP CONSTRAINT IF EXISTS tsys_pacientes_solo_demo;

ALTER TABLE public.historias_clinicas_tsysoptics
  DROP CONSTRAINT IF EXISTS historias_piloto_solo_demo;

DROP POLICY IF EXISTS tsys_historias_demo_insert_admin
  ON public.historias_clinicas_tsysoptics;
DROP POLICY IF EXISTS tsys_historias_demo_select_admin
  ON public.historias_clinicas_tsysoptics;
DROP POLICY IF EXISTS tsys_historias_edicion_borradores
  ON public.historias_clinicas_tsysoptics;

CREATE POLICY tsys_historias_admin_select_all
  ON public.historias_clinicas_tsysoptics
  FOR SELECT TO authenticated
  USING (tsys_privado.tiene_rol(ARRAY['administrador'::text]));

CREATE POLICY tsys_historias_admin_insert_all
  ON public.historias_clinicas_tsysoptics
  FOR INSERT TO authenticated
  WITH CHECK (tsys_privado.tiene_rol(ARRAY['administrador'::text]));

CREATE POLICY tsys_historias_admin_update_all
  ON public.historias_clinicas_tsysoptics
  FOR UPDATE TO authenticated
  USING (tsys_privado.tiene_rol(ARRAY['administrador'::text]))
  WITH CHECK (tsys_privado.tiene_rol(ARRAY['administrador'::text]));

CREATE POLICY tsys_historias_admin_delete_all
  ON public.historias_clinicas_tsysoptics
  FOR DELETE TO authenticated
  USING (tsys_privado.tiene_rol(ARRAY['administrador'::text]));

-- El acceso externo sigue limitado a borradores vinculados a pacientes DEMO.
CREATE POLICY tsys_historias_externo_update_demo_drafts
  ON public.historias_clinicas_tsysoptics
  FOR UPDATE TO authenticated
  USING (
    estado = 'borrador'
    AND tsys_privado.tiene_rol(ARRAY['externo'::text])
    AND creado_por = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.pacientes_tsysoptics p
      WHERE p.id = historias_clinicas_tsysoptics.paciente_id
        AND p.documento ~ '^DEMO-[A-Z0-9-]{1,25}$'
    )
  )
  WITH CHECK (
    estado = 'borrador'
    AND tsys_privado.tiene_rol(ARRAY['externo'::text])
    AND creado_por = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.pacientes_tsysoptics p
      WHERE p.id = historias_clinicas_tsysoptics.paciente_id
        AND p.documento ~ '^DEMO-[A-Z0-9-]{1,25}$'
    )
  );

CREATE TABLE IF NOT EXISTS public.auditoria_historias_tsysoptics (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  usuario_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  historia_id uuid,
  paciente_id uuid,
  accion text NOT NULL CHECK (accion IN ('INSERT', 'UPDATE', 'DELETE')),
  ocurrido_en timestamptz NOT NULL DEFAULT now(),
  estado_anterior text,
  estado_nuevo text
);

ALTER TABLE public.auditoria_historias_tsysoptics ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.auditoria_historias_tsysoptics FROM anon, authenticated;
GRANT SELECT ON TABLE public.auditoria_historias_tsysoptics TO authenticated;
DROP POLICY IF EXISTS tsys_auditoria_admin_select
  ON public.auditoria_historias_tsysoptics;
CREATE POLICY tsys_auditoria_admin_select
  ON public.auditoria_historias_tsysoptics
  FOR SELECT TO authenticated
  USING (tsys_privado.tiene_rol(ARRAY['administrador'::text]));

CREATE OR REPLACE FUNCTION public.registrar_auditoria_historias_tsysoptics()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    INSERT INTO public.auditoria_historias_tsysoptics
      (usuario_id, historia_id, paciente_id, accion, estado_anterior, estado_nuevo)
    VALUES
      (auth.uid(), OLD.id, OLD.paciente_id, TG_OP, OLD.estado, NULL);
    RETURN OLD;
  ELSIF TG_OP = 'INSERT' THEN
    INSERT INTO public.auditoria_historias_tsysoptics
      (usuario_id, historia_id, paciente_id, accion, estado_anterior, estado_nuevo)
    VALUES
      (auth.uid(), NEW.id, NEW.paciente_id, TG_OP, NULL, NEW.estado);
    RETURN NEW;
  ELSE
    INSERT INTO public.auditoria_historias_tsysoptics
      (usuario_id, historia_id, paciente_id, accion, estado_anterior, estado_nuevo)
    VALUES
      (auth.uid(), NEW.id, NEW.paciente_id, TG_OP, OLD.estado, NEW.estado);
    RETURN NEW;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.registrar_auditoria_historias_tsysoptics()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS tsys_auditar_historia_clinica
  ON public.historias_clinicas_tsysoptics;
CREATE TRIGGER tsys_auditar_historia_clinica
  AFTER INSERT OR UPDATE OR DELETE ON public.historias_clinicas_tsysoptics
  FOR EACH ROW EXECUTE FUNCTION public.registrar_auditoria_historias_tsysoptics();

-- Operación atómica: actualiza/crea el paciente y guarda la historia en una sola transacción.
CREATE OR REPLACE FUNCTION public.guardar_historia_clinica_tsysoptics(
  p_paciente jsonb,
  p_datos_clinicos jsonb,
  p_fecha_consulta timestamptz,
  p_optometra_nombre text,
  p_historia_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_usuario_id uuid := auth.uid();
  v_tipo_documento text;
  v_documento text;
  v_nombre text;
  v_paciente_id uuid;
  v_historia_id uuid;
BEGIN
  IF v_usuario_id IS NULL
     OR NOT tsys_privado.tiene_rol(ARRAY['administrador'::text]) THEN
    RAISE EXCEPTION 'No autorizado para guardar historias clínicas'
      USING ERRCODE = '42501';
  END IF;

  IF jsonb_typeof(p_paciente) IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_datos_clinicos) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Los datos del paciente y de la historia deben ser objetos JSON'
      USING ERRCODE = '22023';
  END IF;

  v_tipo_documento := upper(nullif(btrim(p_paciente->>'tipo_documento'), ''));
  v_documento := upper(nullif(btrim(p_paciente->>'documento'), ''));
  v_nombre := upper(nullif(btrim(p_paciente->>'nombre_completo'), ''));

  IF v_tipo_documento IS NULL OR v_documento IS NULL OR v_nombre IS NULL THEN
    RAISE EXCEPTION 'Tipo de documento, documento y nombre son obligatorios'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.pacientes_tsysoptics
    (tipo_documento, documento, nombre_completo, fecha_nacimiento, telefono, direccion, eps)
  VALUES
    (
      v_tipo_documento,
      v_documento,
      v_nombre,
      nullif(p_paciente->>'fecha_nacimiento', '')::date,
      nullif(btrim(p_paciente->>'telefono'), ''),
      nullif(btrim(p_paciente->>'direccion'), ''),
      nullif(btrim(p_paciente->>'eps'), '')
    )
  ON CONFLICT (tipo_documento, documento)
  DO UPDATE SET
    nombre_completo = EXCLUDED.nombre_completo,
    fecha_nacimiento = EXCLUDED.fecha_nacimiento,
    telefono = EXCLUDED.telefono,
    direccion = EXCLUDED.direccion,
    eps = EXCLUDED.eps,
    actualizado_en = now()
  RETURNING id INTO v_paciente_id;

  IF p_historia_id IS NULL THEN
    INSERT INTO public.historias_clinicas_tsysoptics
      (paciente_id, fecha_consulta, optometra_nombre, datos_clinicos, estado, creado_por)
    VALUES
      (
        v_paciente_id,
        coalesce(p_fecha_consulta, now()),
        nullif(btrim(p_optometra_nombre), ''),
        p_datos_clinicos,
        'finalizada',
        v_usuario_id
      )
    RETURNING id INTO v_historia_id;
  ELSE
    UPDATE public.historias_clinicas_tsysoptics
    SET paciente_id = v_paciente_id,
        fecha_consulta = coalesce(p_fecha_consulta, now()),
        optometra_nombre = nullif(btrim(p_optometra_nombre), ''),
        datos_clinicos = p_datos_clinicos,
        estado = 'finalizada',
        actualizado_en = now()
    WHERE id = p_historia_id
    RETURNING id INTO v_historia_id;

    IF v_historia_id IS NULL THEN
      RAISE EXCEPTION 'No se encontró la historia que se intenta actualizar'
        USING ERRCODE = 'P0002';
    END IF;
  END IF;

  RETURN v_historia_id;
END;
$$;

REVOKE ALL ON FUNCTION public.guardar_historia_clinica_tsysoptics(jsonb, jsonb, timestamptz, text, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.guardar_historia_clinica_tsysoptics(jsonb, jsonb, timestamptz, text, uuid)
  TO authenticated;

COMMIT;
