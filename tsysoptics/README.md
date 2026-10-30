# TsysOptics · Piloto integral para ópticas

**Estado:** piloto funcional para TrendyOptics, **no habilitado para comercialización multiempresa**.

TsysOptics es una aplicación web de gestión de óptica construida sobre GitHub Pages (frontend) y Supabase (Auth, PostgreSQL/RLS y funciones RPC). Se accede desde computador, tableta y móvil.

## Accesos y módulos

- `tsysoptics/index.html`: panel, agenda, inventario, ventas y cobros, caja, laboratorio, informes y configuración del negocio.
- `tsysoptics/pacientes.html`: administración de pacientes autorizada.
- `index.html`: historia clínica principal integrada con Supabase y protegida con comprobación de sesión y rol administrativo.
- `tsysoptics/doctor.html` y `tsysoptics/clinica-completa-demo.html`: experiencias externas **limitadas a datos de demostración**.
- `tsysoptics/informes.js`: informes mensuales operativos, PDF ejecutivo y libro Excel .xlsx por secciones.
- `tsysoptics/orden-laboratorio-pdf.js`: orden de laboratorio media carta horizontal.

Los datos operativos están en Supabase. Los archivos fuente son públicos, por lo que **nunca** deben contener contraseñas, claves secretas, JWT ni `service_role`. `supabase-config.js` contiene únicamente la URL y clave publicable para navegador; la autorización depende de políticas RLS y funciones verificadas en el servidor.

## Roles actuales

- **Administrador:** operaciones del piloto autorizado.
- **Externo:** experiencia clínica DEMO limitada; no dispone de acceso a ventas/inventario/caja. No es el módulo definitivo del optómetra de una óptica comercial.
- Los demás perfiles y los permisos comerciales entre ópticas siguen pendientes de implementación y pruebas de acceso cruzado.

## Informes y datos clínicos

Los informes administrativos no reemplazan documentos fiscales o cierres contables. Las cifras del **inventario actual** no equivalen a existencias históricas del último día de un mes. Las historias clínicas son datos personales sensibles y requieren controles específicos de acceso, retención, trazabilidad y recuperación.

## Seguridad y comercialización

Ver:

- [Informe precomercial](./auditoria/INFORME_PRECOMERCIAL.md): alcance, pruebas y bloqueos.
- [QA SQL de solo lectura](./auditoria/QA_SQL_SOLO_LECTURA.md): verificación reproducible de RLS e integridad.
- [Acceso y perfiles](./ACCESO.md): configuración y limitaciones actuales.

Pruebas estáticas sin acceso a pacientes ni Supabase:

```bash
node --test tsysoptics/auditoria/controles-estaticos.test.mjs
```

GitHub Actions ejecuta estos controles cuando cambian archivos de TsysOptics. **Son controles de regresión de código, no un pentest ni la certificación de que RLS sea correcto**.

**Pendiente para vender:** aislamiento por óptica, matriz completa de roles, revisión de RPC privilegiadas, contraseñas seguras, auditoría y privacidad, respaldo verificable y restauración ensayada, contrato y operación de soporte.

No incorporar datos de otras ópticas a la misma base hasta superar estas condiciones.
