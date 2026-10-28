# TsysOptics · Prueba de inicio de sesión (tercera tanda)

El panel está protegido visualmente por autenticación Supabase y exige una fila propia activa con rol `administrador` en `public.usuarios_tsysoptics`. **No equivale a seguridad de producción:** siguen pendientes pruebas, endurecimiento de configuración, despliegue y un backend seguro para datos clínicos.

## Configuración necesaria

1. Supabase → **Project Settings → API Keys**. Copiar únicamente la **publishable key** que comienza con `sb_publishable_`.
2. En el archivo `tsysoptics/supabase-config.js` de GitHub (rama de desarrollo), cambiar `PENDIENTE_CLAVE_PUBLICABLE` por la clave publicable. No copiar ni publicar `sb_secret_*`, `service_role`, JWT secret ni contraseñas.
3. Supabase → **Authentication → URL Configuration**, configurar:
   - Site URL: `https://trendyoptics.github.io/trendyapp/tsysoptics/`
   - Additional Redirect URL: `https://trendyoptics.github.io/trendyapp/tsysoptics/`
   (solo tras preparar una versión desplegada y probar los flujos de acceso).
4. La pantalla requiere contraseña. Si la cuenta se creó por invitación sin contraseña, restablecerla usando **¿Olvidaste tu contraseña?** una vez publicado el sitio y configuradas sus URLs. Para pruebas sin correo se puede configurar una contraseña desde administración en un ambiente de desarrollo separado, nunca compartirla aquí.
5. Para publicar esta rama en Pages tras la revisión, fusionar el PR #1. La ruta nueva será `https://trendyoptics.github.io/trendyapp/tsysoptics/`, manteniendo la aplicación clínica de la raíz sin cambios.

## Verificaciones funcionales

- Sin sesión → pantalla de login, panel oculto
- Clave incorrecta → no entra
- Usuario autenticado sin fila activa de administrador → acceso denegado
- Administrador activo → panel piloto visible
- Cerrar sesión → panel oculto
- Recuperación de contraseña → correo con redirección correcta y actualización real
- En otra ventana/navegador la sesión no se comparte automáticamente
- Módulos de agenda/ventas/inventario → solo datos ficticios en almacenamiento local

## Aviso clínico

El archivo original `../index.html` **no está protegido** por este login. El enlace "Historia clínica" conduce a la app anterior, de acceso público, con su flujo previo a Google Apps Script. **No usar el panel piloto como si protegiera ese módulo clínico.** Antes de datos reales: separar frontend clínico protegido, backend privado, roles y RLS para datos de pacientes, auditoría, respaldo y test de permisos de acceso indebido. La aplicación actual debe migrarse de forma controlada.

## Estado

- Migración SQL 001 ejecutada por usuario: tres tablas y RLS habilitado.
- Migración SQL 002 ejecutada por usuario: lectura de perfil propio, sin lecturas públicas de pacientes/historias.
- Administrador insertado por usuario y confirmado mediante consulta `rol=administrador, activo=true`.
- Login agregado a rama de revisión, todavía sin clave publicable ni despliegue verificado.
