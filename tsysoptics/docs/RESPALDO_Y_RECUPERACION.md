# TsysOptics — Respaldo y recuperación (plan Supabase Free)

Estado: procedimiento documentado, **NO ejecutado ni restauración validada**. No autoriza uso clínico o financiero en producción.

## 1. Preparación en equipo de soporte
- Instalar Supabase CLI y Docker según la documentación oficial.
- Operar desde un ordenador de soporte confiable. No introducir contraseñas, tokens o volcados en GitHub ni en el código frontend.
- Usar una carpeta privada, cifrada y fuera de la carpeta sincronizada/publicada del sitio web.
- Verificar espacio, permisos de archivo y protección de datos personales.

## 2. Exportación manual (solo lectura de la BD remota)
Desde una terminal en una carpeta de trabajo privada:

```powershell
supabase login
supabase link --project-ref rzeqdhddbmxcpyzssuod
supabase db dump --linked --file tsysoptics-esquema.sql
supabase db dump --linked --data-only --use-copy --file tsysoptics-datos.sql
```

Comprobar en la versión instalada de la CLI los parámetros disponibles con `supabase db dump --help`. Estas órdenes son referencias; **todavía no se han ejecutado ni comprobado con este proyecto**. La exportación por defecto puede omitir esquemas administrados por Supabase, incluido Auth, y no incluye los archivos binarios guardados en Storage. Se requiere estrategia separada para esos activos, y para la configuración/autenticación.

## 3. Validación del respaldo
- Comprobar ambos archivos, fecha, tamaño no nulo y hash SHA-256.
- Proteger el respaldo con cifrado y control de acceso.
- Mantener varias copias fuera del sitio (regla 3-2-1), documentando quién puede recuperarlas.
- Nunca subir los SQL con pacientes, historia clínica o datos comerciales al repositorio.

## 4. Restauración aislada
- Crear un entorno **distinto** al proyecto real, con credenciales, claves y URLs diferentes. Comprobar previamente el costo si se crea un proyecto de pago.
- Restaurar esquema y datos en ese entorno siguiendo una guía acorde a la versión de PostgreSQL y al método de exportación.
- Verificar conteos, relaciones paciente–venta–laboratorio–posventa, permisos RLS, perfiles, consultas y anexos.
- Probar inicio de sesión y aplicación en entorno aislado; registrar fallas y tiempos reales.
- **No ejecutar** `db reset`, importaciones ni restauraciones en el proyecto `rzeqdhddbmxcpyzssuod`.

## 5. Criterios pendientes antes de producción
- Exportación manual real completada y comprobada.
- Restauración aislada validada.
- Cobertura de Storage, autenticación e integraciones externas comprobada.
- Revisión de funciones SECURITY DEFINER y test de autorización por roles.
- Contraseñas robustas y MFA para administradores. Protección de contraseñas filtradas está disponible en planes Pro o superiores.
- Política de retención y tratamiento de datos clínicos, consentimiento, accesos, auditoría y continuidad operativa.
- Separación clara de datos DEMO y registros reales.

Documentación: https://supabase.com/docs/guides/platform/backups y https://supabase.com/docs/reference/cli/supabase-db-dump


## Puesta en marcha del respaldo desde Windows (Supabase Free)

1. Instalar Docker Desktop y la Supabase CLI; iniciar Docker Desktop.
2. Abrir PowerShell en la carpeta local del proyecto (la que contiene o contendrá `supabase/`).
3. Ejecutar `supabase login` y `supabase link --project-ref rzeqdhddbmxcpyzssuod`. Introducir credenciales solamente en la consola local y en las pantallas oficiales; **nunca en ChatGPT**.
4. Ejecutar `powershell -NoProfile -File .\\tsysoptics\\scripts\\respaldo-manual.ps1` desde la raíz del repositorio. En Windows PowerShell los archivos pueden necesitar una política de ejecución autorizada por el propietario.
5. Verificar que en `$HOME\\TsysOptics-Backups\\<fecha>` estén `roles.sql`, `schema.sql`, `data.sql` y `SHA256.csv`. Verificar los hashes antes y después de copiar los archivos.
6. Cifrar la copia, almacenarla fuera del equipo y establecer frecuencia diaria, responsable y retención. El script **no automatiza** tareas programadas, cifrado, copia remota ni recuperación.
7. La primera restauración debe efectuarse en otra base de datos, nunca en el proyecto operativo. Guardar evidencia del éxito y cotejar las relaciones y conteos.

**Limitación importante:** los volcados de Supabase CLI no equivalen a un respaldo integral del proyecto: datos administrados por Auth, configuración del proyecto, objetos de Storage e integraciones como Google Sheets requieren comprobación y respaldo independientes. No usar con datos reales hasta validar esa cobertura.

**Puesta en marcha autorizada:** la interfaz puede mantenerse como piloto con registros de prueba mientras se completa la recuperación. No eliminar la advertencia de piloto ni mezclar registros DEMO con pacientes reales.
