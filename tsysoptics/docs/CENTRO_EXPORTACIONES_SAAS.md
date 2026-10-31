# TsysOptics · Centro de exportaciones por óptica

Estado: **diseño técnico y contrato de exportación incorporados; exportaciones clínicas NO habilitadas**. Prohibido activar en producción hasta que aislamiento multiempresa y pruebas negativas estén completos.

## Propósito
Cada **administrador de óptica** descarga un XLSX de sus propios registros, incluyendo opción **mes anterior** (por defecto). La exportación debe poder hacerse bajo demanda y también como tarea mensual autorizada. El superadministrador gestiona licencias y soporte, **no recibe datos clínicos** por defecto.

## Período solicitado
Zona horaria del negocio, inicialmente `America/Bogota`. Para una solicitud efectuada en octubre de 2026, mes anterior es **01/09/2026 00:00 a 01/10/2026 00:00**, intervalo semiabierto `[inicio, fin)`. Para cada tabla se usará la fecha **de negocio pertinente**; las tablas de catálogo (pacientes, productos) requieren opción explícita: registros creados en el período o foto completa al cierre. Para «todas las historias» ofrecer también «historial completo», no confundir con el mes anterior.

## Módulos y fuentes de datos actuales
1. Pacientes: `pacientes_tsysoptics` (creado_en).
2. Historias clínicas: `historias_clinicas_tsysoptics` (fecha_consulta, incluidos campos de `datos_clinicos` sin perder el JSON original).
3. Ventas y pagos: `ventas_tsysoptics`, `detalle_ventas_tsysoptics`, `pagos_ventas_tsysoptics` y reversas (fecha de cada evento).
4. Inventario y movimientos: `productos_tsysoptics`, `movimientos_inventario_tsysoptics` (creado_en); distinguir catálogo actual de movimientos del mes.
5. Caja y gastos: `turnos_caja_tsysoptics`, `movimientos_caja_tsysoptics`, `gastos_tsysoptics` y cierres.
6. Citas y laboratorio: `citas_tsysoptics`, `ordenes_laboratorio_tsysoptics` (fecha de cada evento).
7. Cotizaciones: `cotizaciones_tsysoptics` (fecha de creación/emisión).

## Bloqueo de seguridad imprescindible
La base actual tiene tablas de una sola óptica, sin `optica_id`. **No exponer API, Excel ni botón de descarga real** hasta realizar migración multiempresa.

Para habilitar:
- Crear `opticas` y `miembros_optica` (usuario_id, optica_id, rol, activo) con índices y restricciones.
- Migrar los registros actuales a una óptica inicial dentro de transacción y copia restaurable comprobada.
- Asociar **todas** las entidades, relaciones, funciones RPC, vistas, Storage y auditorías a `optica_id`; garantizar que las FKs no relacionen distintas ópticas.
- Aplicar RLS `USING` y `WITH CHECK` por membresía, no confiar en un `optica_id` enviado por el navegador; endurecer las funciones `SECURITY DEFINER`.
- Backend autenticado: validar JWT, resolver `optica_id` desde la membresía activa, exigir rol administrador y permiso clínico separado para historias y pacientes. Nunca exponer `service_role` en cliente. Superadministrador sin permiso clínico implícito.
- Registrar evento inmutable: usuario, óptica, módulos, intervalo, fecha, cantidad de filas, resultado, hash del archivo y caducidad del enlace. No guardar contenido clínico en logs.
- XLSX generado en backend o job de exportación, con límites/paginación y protección contra **inyección de fórmulas Excel** (valores que empiezan `=,+,-,@`), columnas legibles, hojas por módulo, metadatos y resumen. Ninguna fórmula calculada proveniente de campos libres.
- Archivo temporal privado cifrado, enlace firmado breve con permiso de descarga, purga automática. No mandar XLSX clínicos como adjuntos de correo; Google Drive solo mediante OAuth, carpeta privada propia y autorización explícita.
- Exportar adjuntos binarios mediante paquete separado con manifiesto, no confundir enlaces/metadatos con archivos respaldados.
- Realizar pruebas con ópticas A y B: administrador A nunca obtiene registros de B ni manipulando ruta, identificadores, fechas o roles; asesor sin autorización no obtiene clínica; usuario revocado pierde acceso; enlaces expiran; auditoría registra fallo y éxito.

## Entrega por etapas
1. **Fundamento multiempresa y pruebas de aislamiento** (bloqueante).
2. API autenticada `POST /exportaciones` y consulta de estado `GET /exportaciones/:id`, modelo de tareas; listas blancas de módulos, límites y rangos de fechas; auditoría.
3. Generación XLSX real, hojas: Pacientes, Historias clínicas, Ventas, Detalle de ventas, Pagos, Productos, Movimientos de inventario, Caja, Gastos, Citas, Laboratorio, Cotizaciones, Resumen.
4. Panel adaptable a móvil con período predeterminado «Mes anterior», módulos seleccionables, progreso y descarga segura.
5. Exportación mensual opcional a Drive privado, control de retención y revocación.

## Criterios de aceptación
- Fecha y zona horaria correctas (incluidos cambios de año).
- Aislamiento efectivo A/B probado en todos los módulos y en relaciones.
- Excel abre sin errores, conserva los datos clínicos y números monetarios, sin fórmulas inyectadas.
- Auditoría de descargas y denegaciones, acceso restringido por rol.
- Exportación no altera ventas, caja, inventario ni historias.
- Sin intervención manual del propietario ni del superadministrador.
- Restauración de respaldos verificada aparte: una exportación XLSX **no sustituye un backup**.
