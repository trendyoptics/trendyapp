-- TsysOptics · historias ficticias v0.3
-- Importante: NO habilita historias reales ni acceso a Google Sheets.
-- Requiere la función tsys_privado.tiene_rol de la migración 002.
-- Todos los datos de esta tabla quedan marcados como borradores de prueba.
begin;

alter table public.historias_clinicas_tsysoptics enable row level security;

-- Impedir importaciones reales, estados finalizados y simulaciones de historias firmadas.
alter table public.historias_clinicas_tsysoptics
  add constraint historias_piloto_solo_demo
  check (
    id_origen_sheets is null
    and estado = 'borrador'
    and optometra_id is null
    and optometra_nombre = 'DEMO / NO CLINICO'
    and datos_clinicos = jsonb_build_object('modo','DEMO','motivo',datos_clinicos->>'motivo','diagnostico',datos_clinicos->>'diagnostico')
    and datos_clinicos->>'modo' = 'DEMO'
    and datos_clinicos->>'motivo' in (
      'Control visual de ejemplo',
      'Vision borrosa de ejemplo',
      'Revision de formula de ejemplo'
    )
    and datos_clinicos->>'diagnostico' in (
      'DEMO - Sin diagnostico',
      'H52.0 - Hipermetropia (demo)',
      'H52.1 - Miopia (demo)',
      'H52.2 - Astigmatismo (demo)',
      'H52.4 - Presbicia (demo)'
    )
  );

revoke all on public.historias_clinicas_tsysoptics from anon, authenticated;
grant select, insert on public.historias_clinicas_tsysoptics to authenticated;

drop policy if exists "tsys_historias_demo_select_admin" on public.historias_clinicas_tsysoptics;
create policy "tsys_historias_demo_select_admin"
  on public.historias_clinicas_tsysoptics
  for select to authenticated
  using (
    (select tsys_privado.tiene_rol(array['administrador']::text[]))
    and exists (
      select 1 from public.pacientes_tsysoptics as p
      where p.id = paciente_id
        and p.documento ~ '^DEMO-[A-Z0-9-]{1,25}$'
    )
  );

drop policy if exists "tsys_historias_demo_insert_admin" on public.historias_clinicas_tsysoptics;
create policy "tsys_historias_demo_insert_admin"
  on public.historias_clinicas_tsysoptics
  for insert to authenticated
  with check (
    (select tsys_privado.tiene_rol(array['administrador']::text[]))
    and exists (
      select 1 from public.pacientes_tsysoptics as p
      where p.id = paciente_id
        and p.documento ~ '^DEMO-[A-Z0-9-]{1,25}$'
    )
  );

-- Sin UPDATE, DELETE ni acceso anónimo. Los borradores de prueba se conservarán
-- hasta diseñar una limpieza autorizada y una auditoría de cambios.
commit;
