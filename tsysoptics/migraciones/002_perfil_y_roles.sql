-- TsysOptics | 002_perfil_y_roles.sql
-- Habilita SOLO la lectura del propio perfil autenticado.
-- No abre las tablas de pacientes ni historias clinicas.
-- No contiene correos, contrasenas ni datos de pacientes.
begin;

create schema if not exists tsys_privado;
revoke all on schema tsys_privado from public;
revoke all on schema tsys_privado from anon;
grant usage on schema tsys_privado to authenticated;

create or replace function tsys_privado.tiene_rol(roles_permitidos text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.usuarios_tsysoptics as u
    where u.id = (select auth.uid())
      and u.activo is true
      and u.rol = any(roles_permitidos)
  );
$$;

revoke all on function tsys_privado.tiene_rol(text[]) from public;
revoke all on function tsys_privado.tiene_rol(text[]) from anon;
revoke all on function tsys_privado.tiene_rol(text[]) from authenticated;
grant execute on function tsys_privado.tiene_rol(text[]) to authenticated;

-- No dar permisos de escritura a la tabla de roles desde el navegador.
revoke all on public.usuarios_tsysoptics from anon, authenticated;
grant select on public.usuarios_tsysoptics to authenticated;
alter table public.usuarios_tsysoptics enable row level security;

drop policy if exists "tsys_perfil_propio_lectura" on public.usuarios_tsysoptics;
create policy "tsys_perfil_propio_lectura"
  on public.usuarios_tsysoptics
  for select to authenticated
  using (id = (select auth.uid()));

-- Las tablas con datos sensibles siguen SIN permisos del frontend.
revoke all on public.pacientes_tsysoptics from anon, authenticated;
revoke all on public.historias_clinicas_tsysoptics from anon, authenticated;
alter table public.pacientes_tsysoptics enable row level security;
alter table public.historias_clinicas_tsysoptics enable row level security;

commit;

-- Comprobacion esperada:
-- usuarios_tsysoptics: select_authenticated = true, select_anon = false
-- pacientes e historias: ambos = false
select
  t.tablename,
  t.rowsecurity,
  has_table_privilege('authenticated', format('public.%I', t.tablename), 'SELECT') as select_authenticated,
  has_table_privilege('anon', format('public.%I', t.tablename), 'SELECT') as select_anon
from pg_tables as t
where t.schemaname = 'public'
  and t.tablename in (
    'usuarios_tsysoptics',
    'pacientes_tsysoptics',
    'historias_clinicas_tsysoptics'
  )
order by t.tablename;
