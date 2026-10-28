-- TsysOptics | 001_esquema_inicial.sql
-- Primera migracion. No importa datos ni modifica la aplicacion original.
-- Tablas cerradas por defecto: NO hay politicas RLS habilitantes.
begin;

create table if not exists public.usuarios_tsysoptics (
  id uuid primary key references auth.users(id) on delete cascade,
  nombre text not null default '',
  rol text not null default 'pendiente'
    check (rol in ('pendiente', 'administrador', 'optometra', 'recepcion')),
  activo boolean not null default false,
  creado_en timestamptz not null default now()
);

create table if not exists public.pacientes_tsysoptics (
  id uuid primary key default gen_random_uuid(),
  tipo_documento text not null,
  documento text not null,
  nombre_completo text not null,
  fecha_nacimiento date,
  telefono text,
  direccion text,
  eps text,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  constraint pacientes_documento_unico unique (tipo_documento, documento),
  constraint pacientes_documento_no_vacio check (length(trim(documento)) > 0),
  constraint pacientes_nombre_no_vacio check (length(trim(nombre_completo)) > 0)
);

create table if not exists public.historias_clinicas_tsysoptics (
  id uuid primary key default gen_random_uuid(),
  paciente_id uuid not null references public.pacientes_tsysoptics(id) on delete restrict,
  id_origen_sheets text unique,
  fecha_consulta timestamptz not null,
  optometra_id uuid references public.usuarios_tsysoptics(id) on delete set null,
  optometra_nombre text,
  datos_clinicos jsonb not null default '{}'::jsonb,
  estado text not null default 'borrador'
    check (estado in ('borrador', 'finalizada', 'anulada')),
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  constraint historias_json_objeto check (jsonb_typeof(datos_clinicos) = 'object')
);

create index if not exists idx_historias_paciente_fecha
  on public.historias_clinicas_tsysoptics (paciente_id, fecha_consulta desc);

-- Bloqueo inicial incluso para usuarios autenticados.
alter table public.usuarios_tsysoptics enable row level security;
alter table public.pacientes_tsysoptics enable row level security;
alter table public.historias_clinicas_tsysoptics enable row level security;

revoke all on table public.usuarios_tsysoptics from anon, authenticated;
revoke all on table public.pacientes_tsysoptics from anon, authenticated;
revoke all on table public.historias_clinicas_tsysoptics from anon, authenticated;

commit;

-- Resultado esperado: 3 filas, las 3 con rowsecurity = true.
select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in (
    'usuarios_tsysoptics',
    'pacientes_tsysoptics',
    'historias_clinicas_tsysoptics'
  )
order by tablename;
