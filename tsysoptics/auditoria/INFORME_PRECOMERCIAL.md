# TsysOptics | Auditoría técnica de preparación comercial

**Fecha de corte:** 30 de octubre de 2026 (America/Bogota)  
**Alcance:** repositorio `trendyoptics/trendyapp` y proyecto Supabase `rzeqdhddbmxcpyzssuod`.  
**Método:** lectura de configuración, inventario de tablas/políticas/RPC, asesores Supabase, verificaciones SQL **de solo lectura**, revisión de frontend y pruebas estáticas de regresión.  
**Datos clínicos:** se consultaron conteos y metadatos, no se exportaron historiales ni identidades de pacientes.

## Dictamen

**Piloto funcional: sí. Comercialización multiempresa: NO habilitada.**

Este documento certifica el cierre de la **etapa de diagnóstico técnico** y la existencia de controles de regresión estáticos. **No** certifica conformidad normativa, resistencia a ataques, existencia de backup recuperable ni aislamiento entre empresas.

## Verificaciones realizadas

| Control | Resultado | Observaciones |
| --- | --- | --- |
| RLS en tablas TsysOptics | 19/19 activadas | No demuestra por sí solo que cada política sea correcta |
| Autenticado sin perfil activo | Sin lectura de pacientes, historias, ventas ni productos | Ejecución SQL con rol simulado, transacción de solo lectura |
| Usuario `anon` | Acceso a tablas clínicas y comerciales denegado por privilegios | Las tablas públicas de identidad comercial son un caso diferente |
| Administrador activo | Lectura de los cuatro recursos autorizada | Solo se compararon conteos |
| Usuario externo de demostración | Un paciente y una historia DEMO visibles; cero ventas y productos | No es todavía el rol completo de optómetra comercial |
| Consistencia ventas vigentes | 0 ventas con total/abono/saldo incompatibles | Datos observados en el momento de auditoría |
| Conciliación de abonos | 0 diferencias en 7 ventas vigentes | No constituye conciliación bancaria |
| Existencias negativas | 0 productos | Control puntual; hay restricciones de base de datos |
| Duplicados exactos por documento | 0 pacientes | Existe unicidad `(tipo_documento, documento)` |
| Historial clínico | 9 historias; 8 eventos de auditoría; 1 historia sin evento | Puede proceder de importación previa; requiere revisión de origen |
| Seguridad de frontend | Login/roles en el código; controles estáticos añadidos | La autorización efectiva debe permanecer en RLS y funciones SQL |
| Respaldos y restauración | **NO verificados** | El proyecto está en plan **Free** |
| Aislamiento multiempresa | **NO implementado** | 19/19 tablas carecen de `tenant_id`, `optica_id` u otra clave de pertenencia |

Las cifras son una **fotografía técnica** y pueden cambiar después de nuevas operaciones o migraciones.

## Riesgos y decisiones obligatorias antes de vender

### BLOQUEANTE · Aislamiento por óptica

El sistema actual está diseñado para una sola óptica. No añadir simplemente un selector de negocio en la interfaz: se requiere diseño de pertenencia (`opticas`, `usuarios_opticas`), identificador obligatorio en pacientes y todas sus relaciones, claves únicas por ámbito, políticas RLS por membresía/rol, funciones RPC atómicas restringidas por óptica y pruebas de acceso cruzado. Migrar TrendyOptics primero en entorno de pruebas, contrastar conteos y claves, probar rollback y después programar el corte controlado.

La configuración comercial debe decidir explícitamente si se usará **una base por óptica** (aislamiento físico y operación más costosa) o **base compartida por empresa** (exige validación minuciosa de RLS). Ninguna modalidad está aprobada todavía.

### BLOQUEANTE · Continuidad y restauración

El proyecto consultado pertenece al plan Supabase **Free**. La plataforma documenta respaldos automáticos recuperables para planes Pro/Team/Enterprise, no como prestación garantizada de Free. Se requiere definir estrategia, coste, retención, cifrado, ubicación, RPO/RTO, responsabilidades y procedimiento de restauración en **entorno aislado**. Una exportación Excel/CSV no sustituye backup de PostgreSQL, ni conserva automáticamente Auth y todos los objetos asociados.

**No se ha creado una copia, habilitado PITR ni ejecutado una restauración.** No anunciar recuperación garantizada al cliente.

### ALTO · Seguridad de autenticación y funciones privilegiadas

El asesor de seguridad de Supabase reportó una RPC pública `guardar_historia_clinica_tsysoptics` con `SECURITY DEFINER` ejecutable por `authenticated`. Se verificó que su cuerpo valida `auth.uid()` y rol `administrador`, por lo que el aviso **no demuestra por sí solo un acceso indebido**; sí requiere rediseño/revisión controlada de privilegios y pruebas de llamadas negativas. No cambiarla directamente a `SECURITY INVOKER`: escribe de forma atómica pacientes e historias finalizadas y podría romper las políticas actuales.

El asesor también reportó **protección contra contraseñas filtradas desactivada**. Debe habilitarse en la configuración de Auth al pasar a un plan compatible y verificarse. Añadir MFA, política de contraseñas, caducidad/revocación de sesiones y pruebas con roles adversariales.

### ALTO · Trazabilidad clínica

Una historia no dispone de evento correspondiente en la tabla de auditoría. No falsificar un evento retrospectivo. Investigar si es registro importado, documentar el origen y garantizar que toda **nueva** modificación quede registrada, con conservación inalterable de su historial y control sobre accesos a datos sensibles.

### MEDIO · Rendimiento y dependencias

Supabase señaló claves foráneas sin índice y optimizaciones pendientes de algunas expresiones RLS. Evaluar índices con consultas representativas y límites de carga; evitar optimizaciones ciegas. Versionar las dependencias web/CDN y adoptar políticas de actualización y revisión de vulnerabilidades antes de un lanzamiento comercial.

### ALTO · Protección de datos personales y soporte

Definir responsables/encargados, contratos, consentimiento/base legal, finalidades, retención, acceso por necesidad, gestión de incidentes y proceso verificable de eliminación/portabilidad cuando proceda. Revisión legal colombiana especializada para historias clínicas; esta auditoría técnica no la sustituye.

## Puertas mínimas para aprobación de una óptica comercial

1. **Separación:** cuentas de dos ópticas de prueba con datos identificables distintos. Probar lectura, escritura, RPC, exportación, URLs directas y accesos cruzados; todos los accesos ajenos deben fallar.
2. **Permisos:** administrador, asesor y optómetra con matriz de acciones permitidas/denegadas validada en DB, no solo en la UI.
3. **Transacciones:** duplicados, pagos concurrentes, reversas y actualizaciones parciales probados con casos adversariales.
4. **Auditoría:** nuevas historias, cambios de estado, anulaciones, exportaciones sensibles y acciones administrativas trazables.
5. **Recuperación:** backup automático disponible, retención conocida, restauración real a un entorno distinto, prueba de integridad y tiempos medidos.
6. **Operación:** monitoreo, alertas, soporte, control de despliegue/rollback, dominio y privacidad, términos y acuerdos.
7. **Evaluación externa:** revisión independiente de seguridad y privacidad antes de migrar datos reales de terceras ópticas.

## Cambios seguros efectuados en este ciclo

- Añadida suite de comprobaciones estáticas reproducibles con Node.js: `tsysoptics/auditoria/controles-estaticos.test.mjs`.
- Añadido flujo CI de GitHub Actions para ejecutarla al cambiar la aplicación: `.github/workflows/tsysoptics-seguridad.yml`.
- Documentado alcance y pruebas RLS de solo lectura, sin tocar los datos de pacientes, inventario ni ventas.
- Actualizada la documentación de acceso/piloto para evitar presentar los módulos como simple localStorage o como producto listo para ventas.

## Qué NO se hizo

- No se migró la estructura a multiempresa, porque no se puede garantizar seguridad de la migración directamente en el entorno productivo actual.
- No se contrató un plan de pago ni se cambió la infraestructura.
- No se ejecutó backup/restauración ni se garantizó recuperación ante desastre.
- No se manipularon usuarios, contraseñas ni historias clínicas.
- No se afirma cumplimiento legal, pentest aprobado ni autorización comercial.

## Próxima fase obligatoria

**Arquitectura multiempresa y recuperación verificada**, preferentemente en entorno de pruebas aislado. No incorporar otra óptica al proyecto operativo de TrendyOptics hasta cumplir las siete puertas anteriores.
