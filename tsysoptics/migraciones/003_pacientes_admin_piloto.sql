-- TsysOptics · 003_pacientes_admin_piloto.sql
-- Solo para pruebas con pacientes FICTICIOS.
-- La política usa el rol de TsysOptics, no el nombre de usuario ni datos editables del JWT.
-- Conserva la tabla de historias clínicas cerrada.
begin;

alter table public.pacientes_tsysoptics enable row level security;

revoke all on public.pacientes_tsysoptics from anon, authenticated;
grant select, insert on public.pacientes_tsysoptics to authenticated;
grant update (nombre_completo, fecha_nacimiento, telefono, direccion, eps)
  on public.pacientes_tsysoptics to authenticated;

drop policy if exists "tsys_pacientes_admin_select" on public.pacientes_tsysoptics;
create policy "tsys_pacientes_admin_select"
  on public.pacientes_tsysoptics for select to authenticated
  using ((select tsys_privado.tiene_rol(array['administrador']::text[])));

drop policy if exists "tsys_pacientes_admin_insert" on public.pacientes_tsysoptics;
create policy "tsys_pacientes_admin_insert"
  on public.pacientes_tsysoptics for insert to authenticated
  with check ((select tsys_privado.tiene_rol(array['administrador']::text[])));

drop policy if exists "tsys_pacientes_admin_update" on public.pacientes_tsysoptics;
create policy "tsys_pacientes_admin_update"
  on public.pacientes_tsysoptics for update to authenticated
  using ((select tsys_privado.tiene_rol(array['administrador']::text[])))
  with check ((select tsys_privado.tiene_rol(array['administrador']::text[])));

-- Actualizar marca temporal sin permitir modificaciones directas del navegador.
create or replace function tsys_privado.actualizar_paciente_fecha()
returns trigger language plpgsql
set search_path = ''
as $fn$
begin
  new.actualizado_en := now();
  return new;
end;
$fn$;

revoke all on function tsys_privado.actualizar_paciente_fecha() from public, anon, authenticated;

drop trigger if exists tsys_pacientes_fecha_update on public.pacientes_tsysoptics;
create trigger tsys_pacientes_fecha_update
  before update on public.pacientes_tsysoptics
  for each row execute function tsys_privado.actualizar_paciente_fecha();

-- Aún no se concede ninguna operación desde el cliente para historias clínicas.
revoke all on public.historias_clinicas_tsysoptics from anon, authenticated;
commit;
