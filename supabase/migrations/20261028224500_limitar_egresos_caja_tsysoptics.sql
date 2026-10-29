-- Prevención de egresos mayores al efectivo disponible.
BEGIN;
CREATE OR REPLACE FUNCTION tsys_privado.movimiento_manual_caja_interno_tsysoptics(
 p_tipo text,p_monto numeric,p_motivo text,p_operacion_id uuid
) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public AS $$
DECLARE v_id bigint;v_turno uuid;v_actor uuid:=auth.uid();v_disponible numeric(14,2);
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
 IF p_tipo='egreso' THEN
  SELECT t.fondo_inicial
       +coalesce((SELECT sum(p.monto) FROM public.pagos_ventas_tsysoptics p WHERE p.turno_id=t.id AND p.medio='efectivo'),0)
       +coalesce((SELECT sum(m.monto) FROM public.movimientos_caja_tsysoptics m WHERE m.turno_id=t.id AND m.tipo='ingreso'),0)
       -coalesce((SELECT sum(m.monto) FROM public.movimientos_caja_tsysoptics m WHERE m.turno_id=t.id AND m.tipo='egreso'),0)
  INTO v_disponible FROM public.turnos_caja_tsysoptics t WHERE t.id=v_turno;
  IF p_monto>v_disponible THEN
   RAISE EXCEPTION 'El egreso excede el efectivo esperado de caja' USING ERRCODE='22023';
  END IF;
 END IF;
 INSERT INTO public.movimientos_caja_tsysoptics(turno_id,tipo,monto,motivo,usuario_id,operacion_id)
 VALUES(v_turno,p_tipo,p_monto,btrim(p_motivo),v_actor,p_operacion_id)
 RETURNING id INTO v_id;
 RETURN v_id;
END $$;


COMMIT;