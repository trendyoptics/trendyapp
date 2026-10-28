-- Piloto: impedir que se introduzcan documentos reales por API o interfaz.
-- Para permitir datos reales en una versión aprobada habrá que migrar explícitamente esta regla.
alter table public.pacientes_tsysoptics
  add constraint tsys_pacientes_solo_demo
  check (documento ~ '^DEMO-[A-Z0-9-]{1,25}$');
