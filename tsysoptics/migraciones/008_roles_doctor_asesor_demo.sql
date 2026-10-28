-- TsysOptics: permisos separados por rol para pilotos DEMO.
-- No habilita consultas reales ni datos de Google Sheets.
begin;

-- El perfil 'externo' es optometra temporal y 'asesor' es comercial.
alter table public.usuarios_tsysoptics drop constraint if exists usuarios_tsysoptics_rol_check;
alter table public.usuarios_tsysoptics
  add constraint usuarios_tsysoptics_rol_check
  check (rol in ('pendiente','administrador','optometra','recepcion','externo','asesor'));

-- Pacientes: administrador gestiona; profesionales SOLO consultan.
-- La política existente de administrador no se modifica.
drop policy if exists "tsys_pacientes_profesional_lectura" on public.pacientes_tsysoptics;
create policy "tsys_pacientes_profesional_lectura" on public.pacientes_tsysoptics
for select to authenticated
using ((select tsys_privado.tiene_rol(array['externo','optometra']::text[])));

-- Historias DEMO: el autor se registra automáticamente desde la sesión.
-- Se permite NULL para registros piloto previos, que solo podrá editar el administrador.
alter table public.historias_clinicas_tsysoptics
  add column if not exists creado_por uuid references auth.users(id) default auth.uid();

drop policy if exists "tsys_historias_profesional_lectura" on public.historias_clinicas_tsysoptics;
create policy "tsys_historias_profesional_lectura" on public.historias_clinicas_tsysoptics
for select to authenticated
using (
  (select tsys_privado.tiene_rol(array['externo','optometra']::text[]))
  and exists (
    select 1 from public.pacientes_tsysoptics p
    where p.id = paciente_id and p.documento ~ '^DEMO-[A-Z0-9-]{1,25}$'
  )
);

drop policy if exists "tsys_historias_profesional_insert" on public.historias_clinicas_tsysoptics;
create policy "tsys_historias_profesional_insert" on public.historias_clinicas_tsysoptics
for insert to authenticated
with check (
  (select tsys_privado.tiene_rol(array['externo','optometra']::text[]))
  and creado_por = (select auth.uid())
  and exists (
    select 1 from public.pacientes_tsysoptics p
    where p.id = paciente_id and p.documento ~ '^DEMO-[A-Z0-9-]{1,25}$'
  )
);

-- Restringimos modificación a los datos del borrador (no identidad, autor ni fecha).
grant update (datos_clinicos) on public.historias_clinicas_tsysoptics to authenticated;

drop policy if exists "tsys_historias_borrador_update" on public.historias_clinicas_tsysoptics;
create policy "tsys_historias_borrador_update" on public.historias_clinicas_tsysoptics
for update to authenticated
using (
  estado = 'borrador'
  and (
    (select tsys_privado.tiene_rol(array['administrador']::text[]))
    or (
      (select tsys_privado.tiene_rol(array['externo','optometra']::text[]))
      and creado_por = (select auth.uid())
    )
  )
)
with check (
  estado = 'borrador'
  and (
    (select tsys_privado.tiene_rol(array['administrador']::text[]))
    or (
      (select tsys_privado.tiene_rol(array['externo','optometra']::text[]))
      and creado_por = (select auth.uid())
    )
  )
);

-- Para el asesor: indicaciones comerciales EXCLUSIVAMENTE ficticias.
-- No se insertan historias ni recomendaciones reales.
create table if not exists public.indicaciones_venta_demo_tsysoptics (
  id uuid primary key default gen_random_uuid(),
  paciente_id uuid not null references public.pacientes_tsysoptics(id) on delete restrict,
  codigo_demo text not null
    check (codigo_demo ~ '^DEMO-[A-Z0-9-]{1,25}$'),
  tipo_lente text not null check (tipo_lente in
    ('Monofocal de ejemplo','Progresivo de ejemplo','Ocupacional de ejemplo')),
  tratamiento text not null check (tratamiento in
    ('Antirreflejo de ejemplo','Fotocromatico de ejemplo','Sin filtro de ejemplo')),
  instrucciones text not null check (instrucciones in
    ('Confirmar medidas y disponibilidad de ejemplo',
     'Cotizar segun recomendacion ficticia',
     'Verificar adaptacion en una prueba ficticia')),
  creado_por uuid not null default auth.uid() references auth.users(id),
  creado_en timestamptz not null default now(),
  constraint indicaciones_demo_paciente_tipo_unico unique (paciente_id, tipo_lente, tratamiento, instrucciones)
);
alter table public.indicaciones_venta_demo_tsysoptics enable row level security;
revoke all on public.indicaciones_venta_demo_tsysoptics from anon, authenticated;
grant select,insert on public.indicaciones_venta_demo_tsysoptics to authenticated;

drop policy if exists "tsys_indicaciones_personal_lectura" on public.indicaciones_venta_demo_tsysoptics;
create policy "tsys_indicaciones_personal_lectura" on public.indicaciones_venta_demo_tsysoptics
for select to authenticated
using ((select tsys_privado.tiene_rol(array['administrador','externo','optometra','asesor']::text[])));

drop policy if exists "tsys_indicaciones_profesional_crear" on public.indicaciones_venta_demo_tsysoptics;
create policy "tsys_indicaciones_profesional_crear" on public.indicaciones_venta_demo_tsysoptics
for insert to authenticated
with check (
  (select tsys_privado.tiene_rol(array['administrador','externo','optometra']::text[]))
  and creado_por = (select auth.uid())
  and exists (
    select 1 from public.pacientes_tsysoptics p
    where p.id = paciente_id and p.documento = codigo_demo
  )
);

-- El asesor solo tiene permiso SELECT en indicaciones y NO en pacientes/historias.
-- Los grants existentes para 'authenticated' se acotan además por RLS.
commit;
