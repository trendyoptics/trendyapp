-- TsysOptics | cuenta externa de demostración (sin acceso a datos clínicos)
-- Amplía exclusivamente los roles admitidos.
-- No crea un usuario Auth; se crea manualmente con contraseña en Supabase.
begin;
alter table public.usuarios_tsysoptics
  drop constraint if exists usuarios_tsysoptics_rol_check;
alter table public.usuarios_tsysoptics
  add constraint usuarios_tsysoptics_rol_check
  check (rol in ('pendiente', 'administrador', 'optometra', 'recepcion', 'externo'));
commit;

-- El rol 'externo' NO está incluido en las políticas RLS de pacientes e historias:
-- esas tablas siguen reservadas a administradores activos.
