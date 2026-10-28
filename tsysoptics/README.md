# TsysOptics · Piloto aislado

Este directorio contiene una **prueba funcional administrativa** para Óptica Trendy Optics.

- Entrada: `tsysoptics/index.html`
- Imagen de marca: `tsysoptics/logo.svg` (adaptación vectorial del logotipo incluido en el código clínico existente)
- Historia clínica original: `../index.html` (sin cambios)

## Funciones disponibles

- Panel de indicadores de demostración
- Agenda ficticia con almacenamiento local
- Inventario y venta de productos ficticios, con abonos, saldo y descuento de existencias
- Simulador esquemático de lente positivo/negativo, **no** cálculo físico
- Acceso directo a la historia clínica original, que sigue siendo `index.html`

## Alcance y seguridad

No usar información personal, historias clínicas, datos de pacientes ni cobros reales en los módulos de prueba. Los registros quedan en el almacenamiento de **este navegador**, sin autenticación, API ni sincronización entre dispositivos. Es un prototipo de interfaz, no un producto listo para el manejo seguro de datos de salud.

La historia clínica original tiene un webhook Apps Script con escritura de tipo `no-cors`. Esta modalidad no permite al navegador comprobar si Google Sheets guardó el registro. El botón original de historial lee el `localStorage` del equipo, no el histórico central de Google Sheets.

Antes de una integración productiva: respaldar el repositorio y Sheet, obtener el código del Apps Script, verificar mapeo de columnas y confirmación de operaciones, implementar API privada y autenticada, controles de autorización, auditoría, respaldo y migración verificable. No exponer API keys ni nuevos datos clínicos en GitHub Pages.

## Probar desde el móvil

Mientras esta rama está en revisión, abre el archivo desde la pestaña *Files changed* del pull request para inspeccionar el código. GitHub Pages normalmente publica la rama configurada (en este proyecto `main`), de modo que **la demo no aparecerá en la página pública hasta aprobar y fusionar la rama**. La ruta prevista después de fusionarla es:

`https://trendyoptics.github.io/trendyapp/tsysoptics/`

El sitio clínico original permanecerá en `https://trendyoptics.github.io/trendyapp/`.

## Próxima iteración

Extraer los componentes de HTML monolítico, crear backend con PostgreSQL, permisos clínicos, módulos separados, sincronización central de paciente/consulta, controles de privacidad y copias de seguridad.
