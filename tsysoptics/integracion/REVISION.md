# Integración de historias clínicas TrendyOptics → TsysOptics

## Revisión técnica (sin acceso a registros de pacientes)

Se contrastó el código actual de `index.html` (función `obtenerDatos`) con el Apps Script compartido por el propietario. Se identificaron **53 columnas**, una generada por el servidor (fecha y hora del guardado) y las otras 52 alimentadas por datos del formulario. Se verificó que todas las claves de origen figuran en `obtenerDatos`. `timestamp` del navegador no se almacena en la hoja porque el Apps Script utiliza su propia fecha.

**No se logró acceder a los metadatos de la hoja** mediante la conexión Google Drive actual (403, permisos insuficientes). Por tanto, los encabezados reales, filas y duplicados permanecen sin verificar. NO se ha leído contenido clínico.

## Hallazgos

1. **Confirmación incorrecta:** frontend usa `fetch(..., {mode:'no-cors'})` y luego muestra éxito. La respuesta opaca no permite saber si `doPost` guardó. Incluso respuestas `{status:'error'}` pueden pasar inadvertidas. No cambiar simplemente a `cors` porque Apps Script ContentService y sus redirecciones requieren diseño/verificación de orígenes compatible con el backend.
2. **Duplicados por ID:** `sheet.appendRow(finalRow)` siempre crea una fila; no hay detección de ID repetido ni idempotencia.
3. **Historial incompleto:** `openHistoryModal` consulta solo `localStorage.trendy_hc_records`, no Google Sheets. Los datos quedan en el equipo local y no hay sincronización entre dispositivos.
4. **Seguridad:** no hay autenticación ni autorización en `doPost`; si el despliegue es público, cualquiera que conozca la URL podría enviar escrituras. La URL en `index.html` está publicada, así que no sirve como secreto. Revocar/restringir el despliegue una vez haya un reemplazo seguro, evitando cortar la operación sin migración.
5. **Riesgo de inyección:** `openHistoryModal` usa `innerHTML` con valores de pacientes sin escaparlos. Crear nodos mediante `textContent` en implementación nueva.
6. **Control de integridad:** `Number(... || 0)` puede aceptar valores inválidos; guardar montos y saldo con reglas en servidor. Los encabezados se crean solo si hoja completamente vacía; no se verifican al escribir en una hoja existente.
7. **Lock:** `waitLock(30000)` ocurre antes de `try`; si falla, no hay manejo normal del error. Además `doGet` solo publica un mensaje de estado.
8. **Cuidado clínico:** una historia emitida no debe sobrescribirse sin mantener auditoría y versiones. El ID de registro no equivale necesariamente al ID del paciente; usar entidades distintas `paciente` y `consulta`.

## Estructura segura objetivo

Navegador → API autenticada HTTPS → PostgreSQL cifrado/respaldado. Roles mínimos: administrador, optómetra, recepción/caja. Para el historial anterior: importador ejecutado desde entorno privado con acceso autorizado a la hoja, validación de columnas, comparación de totales, detección de duplicados y registros de auditoría. Mantener copia inmutable de respaldo de Google Sheets durante transición.

No conectar la aplicación GitHub Pages directamente a un Google Sheet que contenga historias mediante un `doGet` público, ni colocar token/API key en JavaScript descargable por pacientes.

## Verificación inicial sin información sensible

El archivo `auditoria-sheets-solo-lectura.gs` incluye la función `auditarEstructuraTsysOptics()` para ejecutar manualmente desde el editor privado de Apps Script. Lee solamente encabezados y valores de la columna de IDs, pero solo **muestra** conteos y números de columnas inconsistentes, nunca los valores. No cambia el backend de producción. Ejecutar con acceso a la hoja; no compartir captura con datos de pacientes.

## Siguiente tanda

1. Confirmar que los 53 encabezados reales y orden coinciden, obtener cantidad de filas e IDs duplicados.
2. Diseñar sistema de identidad/roles/autenticación y contrato de API (sin datos reales).
3. Implementar prueba privada de 1 historia ficticia en entorno aislado, con acuse verificable de guardado y lectura.
4. Planear migración e integración segura sin tocar el Apps Script de producción.
