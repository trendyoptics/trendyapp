# Acceso y perfiles de TsysOptics · Estado actual

Esta es la documentación vigente del **piloto TrendyOptics**, no una instrucción de lanzamiento comercial.

## Autenticación

La aplicación web usa Supabase Auth en `https://trendyoptics.github.io/trendyapp/tsysoptics/`. El panel comprueba la sesión con `auth.getUser()` y consulta un perfil activo en `usuarios_tsysoptics`. Los permisos efectivos de los datos deben comprobarse en PostgreSQL/RLS y en las funciones RPC, nunca solamente en controles visuales.

El archivo `supabase-config.js` incluye **solo** la URL y clave publicable. No agregar ninguna contraseña, clave `service_role`, `sb_secret_*` o token a la aplicación pública.

## Perfiles en el piloto

- **Administrador:** acceso completo a los módulos disponibles.
- **Externo:** acceso limitado a pacientes e historias marcados DEMO, sin ventas/inventario/caja/laboratorio/informes.
- **Asesor** y **optómetra comercial:** la matriz de permisos para estos perfiles aún requiere diseño y pruebas; no anunciarla como funcional.
- **Cuentas desactivadas o sin rol autorizado:** deben carecer de acceso a operaciones internas. Las pruebas de lectura SQL de la auditoría confirman bloqueo de los recursos examinados, pero no sustituyen pruebas HTTP autenticadas.

## Historia clínica principal

El `index.html` de la raíz ahora contiene un control de sesión y perfil administrador que usa Supabase. Las historias clínicas se guardan mediante la RPC protegida `guardar_historia_clinica_tsysoptics`. La aplicación anterior y el material de migración pueden aparecer en archivos históricos del repositorio; no son instrucciones vigentes para insertar registros en Google Sheets.

## Recuperación de contraseña

Usar la opción de recuperación del login, que depende de URL de redirección autorizada en Supabase Auth. Para un entorno comercial se requieren reglas de contraseñas, comprobación de contraseñas comprometidas cuando el plan lo permita, MFA y criterios de revocación de sesiones.

## Seguridad y salida comercial

El diagnóstico y sus limitaciones están en [auditoria/INFORME_PRECOMERCIAL.md](auditoria/INFORME_PRECOMERCIAL.md). Los datos siguen en una base diseñada para **una sola óptica**, y el proyecto Supabase auditado utiliza plan Free. No abrir cuentas a terceros como si ya existiera aislamiento multiempresa o restauración garantizada.

**Importante:** una clave publicable no es un secreto, pero eso **no** convierte a los datos en públicos. El sistema solo será vendible cuando se pruebe una arquitectura aislada y procedimientos reales de respaldo/restauración.
