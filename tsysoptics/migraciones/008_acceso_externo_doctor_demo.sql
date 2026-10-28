-- TsysOptics v0.4 | accesos piloto para doctor externo
-- Solamente para pacientes con documentos DEMO y consultas no clínicas.
-- Mantener RLS y la restricción historias_piloto_solo_demo existentes.
begin;

-- El doctor puede consultar los pacientes ficticios, pero no registrarlos,
-- editar sus datos personales, eliminarlos, ni acceder a ventas.
drop policy if exists "tsys_pacientes_externo_lectura" on public.pacientes_tsysoptics;
create policy "tsys_pacientes_externo_lectura"
on public.pacientes_tsysoptics for select to authenticated
using (
  (select tsys_privado.tiene_rol(array['externo']::text[]))
  and documento ~ '^DEMO-[A-Z0-9-]{1,25}$'
);

-- Asociar nuevas consultas ficticias al usuario que las creó.
-- Los registros anteriores se conservan sin atribuir a otro profesional.
alter table public.historias_clinicas_tsysoptics
  add column if not exists creado_por uuid references auth.users(id) default auth.uid();

drop policy if exists "tsys_historias_externo_lectura" on public.historias_clinicas_tsysoptics;
create policy "tsys_historias_externo_lectura"
on public.historias_clinicas_tsysoptics for select to authenticated
using (
  (select tsys_privado.tiene_rol(array['externo']::text[]))
  and exists (
    select 1 from public.pacientes_tsysoptics p
    where p.id = paciente_id
      and p.documento ~ '^DEMO-[A-Z0-9-]{1,25}$'
  )
);

drop policy if exists "tsys_historias_externo_insert" on public.historias_clinicas_tsysoptics;
create policy "tsys_historias_externo_insert"
on public.historias_clinicas_tsysoptics for insert to authenticated
with check (
  (select tsys_privado.tiene_rol(array['externo']::text[]))
  and creado_por = (select auth.uid())
  and exists (
    select 1 from public.pacientes_tsysoptics p
    where p.id = paciente_id
      and p.documento ~ '^DEMO-[A-Z0-9-]{1,25}$'
  )
);

-- El profesional solo puede actualizar los datos de SUS borradores.
-- No se permiten cambios de paciente, autor, estado o fechas por la API.
grant update (datos_clinicos) on public.historias_clinicas_tsysoptics to authenticated;

drop policy if exists "tsys_historias_edicion_borradores" on public.historias_clinicas_tsysoptics;
create policy "tsys_historias_edicion_borradores"
on public.historias_clinicas_tsysoptics for update to authenticated
using (
  estado = 'borrador'
  and (
    (select tsys_privado.tiene_rol(array['administrador']::text[]))
    or (
      (select tsys_privado.tiene_rol(array['externo']::text[]))
      and creado_por = (select auth.uid())
    )
  )
)
with check (
  estado = 'borrador'
  and (
    (select tsys_privado.tiene_rol(array['administrador']::text[]))
    or (
      (select tsys_privado.tiene_rol(array['externo']::text[]))
      and creado_por = (select auth.uid())
    )
  )
);

-- Se mantienen prohibidos DELETE y edición de columnas estructurales.
commit;
