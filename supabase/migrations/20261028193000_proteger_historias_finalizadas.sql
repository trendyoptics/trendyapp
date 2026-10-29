-- Seguridad para historias clínicas: normalización de tipo de documento
-- e inmutabilidad de las consultas finalizadas.
BEGIN;
DROP POLICY IF EXISTS tsys_historias_admin_update_all ON public.historias_clinicas_tsysoptics;
DROP POLICY IF EXISTS tsys_historias_admin_update_borrador ON public.historias_clinicas_tsysoptics;
CREATE POLICY tsys_historias_admin_update_borrador
  ON public.historias_clinicas_tsysoptics FOR UPDATE TO authenticated
  USING (estado = 'borrador' AND tsys_privado.tiene_rol(ARRAY['administrador'::text]))
  WITH CHECK (estado = 'borrador' AND tsys_privado.tiene_rol(ARRAY['administrador'::text]));

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

  v_tipo_documento := upper(nullif(split_part(btrim(p_paciente->>'tipo_documento'), ' - ', 1), ''));
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
      AND estado = 'borrador'
      AND id_origen_sheets IS NULL
    RETURNING id INTO v_historia_id;

    IF v_historia_id IS NULL THEN
      RAISE EXCEPTION 'No se encontró la historia que se intenta actualizar'
        USING ERRCODE = 'P0002';
    END IF;
  END IF;

  RETURN v_historia_id;
END;
$$;


COMMIT;
