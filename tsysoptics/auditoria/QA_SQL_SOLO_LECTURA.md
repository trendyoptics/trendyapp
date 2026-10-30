# QA de permisos e integridad | procedimientos de solo lectura

**ATENCIÓN:** ejecutar únicamente por un administrador técnico autorizado, en Supabase SQL Editor o cliente con permisos de diagnóstico. Estas verificaciones no sustituyen pentest ni pruebas desde la API HTTP real. Todas las consultas se ejecutan con `BEGIN TRANSACTION READ ONLY` y se revierten con `ROLLBACK`; no escriben registros.

## 1. Verificar RLS y pertenencia

```sql
SELECT
  (SELECT count(*) FROM pg_tables
   WHERE schemaname='public' AND tablename LIKE '%tsysoptics' AND rowsecurity) AS tablas_rls,
  (SELECT count(*) FROM pg_tables
   WHERE schemaname='public' AND tablename LIKE '%tsysoptics') AS tablas_totales,
  (SELECT count(*) FROM information_schema.columns
   WHERE table_schema='public' AND table_name LIKE '%tsysoptics'
     AND column_name IN ('optica_id','empresa_id','organizacion_id','tenant_id')) AS columnas_aislamiento;
```

Resultado observado 30/10/2026: **19, 19, 0**. El aislamiento multiempresa sigue pendiente.

## 2. Usuario autenticado sin perfil

```sql
BEGIN TRANSACTION READ ONLY;
SET LOCAL ROLE authenticated;
SELECT
  (SELECT count(*) FROM public.pacientes_tsysoptics) AS pacientes,
  (SELECT count(*) FROM public.historias_clinicas_tsysoptics) AS historias,
  (SELECT count(*) FROM public.ventas_tsysoptics) AS ventas,
  (SELECT count(*) FROM public.productos_tsysoptics) AS productos;
ROLLBACK;
```

Esperado: **0, 0, 0, 0** cuando no hay `auth.uid()` válido. Observado: **0, 0, 0, 0**.

## 3. Sesión administradora simulada

```sql
BEGIN TRANSACTION READ ONLY;
SELECT set_config('request.jwt.claim.sub',
 (SELECT id::text FROM public.usuarios_tsysoptics
  WHERE rol='administrador' AND activo IS TRUE LIMIT 1), true);
SET LOCAL ROLE authenticated;
SELECT
  (SELECT count(*) FROM public.pacientes_tsysoptics) AS pacientes,
  (SELECT count(*) FROM public.historias_clinicas_tsysoptics) AS historias,
  (SELECT count(*) FROM public.ventas_tsysoptics) AS ventas,
  (SELECT count(*) FROM public.productos_tsysoptics) AS productos;
ROLLBACK;
```

Resultado observado: **7, 9, 8, 9** (conteos variables). Es una prueba de política en SQL, **no prueba que el usuario controle realmente ese JWT**. No reutilizar `set_config` como método de autenticación de la aplicación.

## 4. Sesión externa simulada

```sql
BEGIN TRANSACTION READ ONLY;
SELECT set_config('request.jwt.claim.sub',
 (SELECT id::text FROM public.usuarios_tsysoptics
  WHERE rol='externo' AND activo IS TRUE LIMIT 1), true);
SET LOCAL ROLE authenticated;
SELECT
  (SELECT count(*) FROM public.pacientes_tsysoptics) AS pacientes,
  (SELECT count(*) FROM public.historias_clinicas_tsysoptics) AS historias,
  (SELECT count(*) FROM public.ventas_tsysoptics) AS ventas,
  (SELECT count(*) FROM public.productos_tsysoptics) AS productos;
ROLLBACK;
```

Resultado observado: **1, 1, 0, 0** (un paciente y su historia DEMO). **No** prueba todavía el rol de optómetra comercial.

## 5. Acceso anónimo

```sql
BEGIN TRANSACTION READ ONLY;
SET LOCAL ROLE anon;
SELECT count(*) FROM public.pacientes_tsysoptics;
ROLLBACK;
```

Esperado y observado: **permission denied** para lectura de pacientes. El error de autorización es el resultado esperado. Cuando una sentencia arroja error, la transacción queda abortada; emitir `ROLLBACK` antes de otras consultas. El acceso anónimo a los campos de identidad pública del negocio es una excepción expresamente configurada que requiere revisión de minimización de datos.

## 6. Consistencia de ventas, pacientes e inventario

```sql
SELECT
  (SELECT count(*) FROM public.ventas_tsysoptics
    WHERE estado='emitida'
    AND (total<0 OR saldo<0 OR abonado<0 OR abs(total-abonado-saldo)>0.01)) AS ventas_inconsistentes,
  (SELECT count(*) FROM public.productos_tsysoptics WHERE cantidad<0) AS inventario_negativo,
  (SELECT count(*) FROM (
    SELECT tipo_documento,documento
    FROM public.pacientes_tsysoptics
    GROUP BY tipo_documento,documento HAVING count(*)>1
  ) AS duplicados) AS documentos_duplicados,
  (SELECT count(*) FROM public.historias_clinicas_tsysoptics
    WHERE estado='finalizada' AND datos_clinicos IS NULL) AS historias_vacias;
```

Resultado observado: **0, 0, 0, 0**.

## 7. Conciliación básica de abonos

```sql
SELECT count(*) AS ventas_emitidas,
 count(*) FILTER (WHERE abs(coalesce(v.abonado,0)-coalesce(p.pagado,0))>0.01) AS diferencias
FROM public.ventas_tsysoptics v
LEFT JOIN (
 SELECT venta_id,sum(monto) AS pagado
 FROM public.pagos_ventas_tsysoptics GROUP BY venta_id
) p ON p.venta_id=v.id
WHERE v.estado='emitida';
```

Resultado observado: **7 emitidas, 0 diferencias**. No equivale a conciliación bancaria o contable.

## 8. Auditoría clínica

```sql
SELECT
 count(*) AS historias,
 count(*) FILTER (WHERE estado='finalizada') AS finalizadas,
 (SELECT count(*) FROM public.auditoria_historias_tsysoptics) AS eventos,
 (SELECT count(*) FROM public.historias_clinicas_tsysoptics hc
  WHERE NOT EXISTS (
   SELECT 1 FROM public.auditoria_historias_tsysoptics a
   WHERE a.historia_id=hc.id
  )) AS historias_sin_eventos
FROM public.historias_clinicas_tsysoptics;
```

Resultado observado: **9 historias, 8 finalizadas, 8 eventos, 1 historia sin evento registrado**. No intentar reconstruir acciones pasadas sin evidencia.

## 9. Pruebas pendientes fuera de SQL

Un auditor debe entrar con cuentas **reales** de administrador, asesor, doctor, usuario desactivado y dos ópticas independientes, y probar API REST/RPC directamente. En este momento **no existe** un segundo tenant autorizado ni un entorno aislado de restauración. Por eso esas pruebas se mantienen BLOQUEADAS y no se califican como aprobadas.
