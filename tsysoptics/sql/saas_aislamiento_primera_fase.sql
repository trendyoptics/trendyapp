-- TsysOptics SaaS: esquema de aislamiento, preparado para revisión.
-- La ejecución en la base operativa requiere restauración validada antes de migrar.
-- NO ejecutar directamente sin una prueba de recuperación y auditoría de RLS.
BEGIN;
CREATE SCHEMA IF NOT EXISTS tsys_saas;
CREATE TABLE IF NOT EXISTS tsys_saas.opticas (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 nombre text NOT NULL CHECK(length(btrim(nombre)) BETWEEN 2 AND 120),
 estado text NOT NULL DEFAULT 'preparacion' CHECK (estado IN ('preparacion','activa','suspendida')),
 creado_en timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS tsys_saas.miembros (
 optica_id uuid NOT NULL REFERENCES tsys_saas.opticas(id),
 usuario_id uuid NOT NULL REFERENCES auth.users(id),
 rol text NOT NULL CHECK(rol IN ('administrador','optometra','asesor','externo')),
 activo boolean NOT NULL DEFAULT true,
 PRIMARY KEY(optica_id,usuario_id)
);
ALTER TABLE tsys_saas.opticas ENABLE ROW LEVEL SECURITY;
ALTER TABLE tsys_saas.miembros ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON SCHEMA tsys_saas FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA tsys_saas FROM PUBLIC,anon,authenticated;
COMMIT;
