/**
 * TsysOptics · Auditoría SOLO LECTURA para Google Apps Script.
 * Ejecutar MANUALMENTE desde editor con una cuenta con permisos de acceso al Sheet.
 * No instalar como endpoint público ni reemplazar el Apps Script actual.
 * No escribe, no expone nombres/documentos/diagnósticos ni devuelve filas.
 * IMPORTANTE: salida en registros de ejecución: únicamente conteos y posiciones.
 */
function auditarEstructuraTsysOptics() {
  const SHEET_ID = '19hbfmMq5Vdq4OsQDuG3kq-mD_lLoC2EuxFXXLNeU8Kw';
  const expected = [
    'ID REGISTRO','FECHA Y HORA GUARDADO','FECHA CONSULTA','HORA CONSULTA',
    'TIPO DOC','DOCUMENTO','NOMBRE PACIENTE','FECHA NACIMIENTO','EDAD',
    'TELÉFONO (+57)','DIRECCIÓN','EPS / ASEGURADORA','OCUPACIÓN','ACOMPAÑANTE',
    'MOTIVO CONSULTA','ANTECEDENTES','AV SC OD (LEJOS)','AV SC OI (LEJOS)',
    'AV SC OD (CERCA)','AV SC OI (CERCA)','LENSOMETRÍA OD','LENSOMETRÍA OI',
    'OD ESFERA','OD CILINDRO','OD EJE','OD ADICIÓN','OD AV LEJOS','OD AV CERCA','OD DNP',
    'OI ESFERA','OI CILINDRO','OI EJE','OI ADICIÓN','OI AV LEJOS','OI AV CERCA','OI DNP',
    'DP GENERAL','TIPO DE LENTE / FILTROS','MONTURA','BIOMICROSCOPÍA',
    'OFTALMOSCOPÍA','MOTILIDAD OCULAR','DIAGNÓSTICO 1 (CIE-10)','DIAGNÓSTICO 2 (CIE-10)',
    'DIAGNÓSTICO 3 (CIE-10)','DIAGNÓSTICO 4 (CIE-10)','DIAGNÓSTICO 5 (CIE-10)',
    'CONDUCTA / RECOMENDACIONES','OPTÓMETRA EXAMINADOR','PRECIO TOTAL (COP)',
    'VALOR ABONADO (COP)','SALDO PENDIENTE (COP)','MÉTODO DE PAGO'
  ];
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheets()[0];
  const rows = sheet.getLastRow();
  const cols = sheet.getLastColumn();
  const actual = rows ? sheet.getRange(1, 1, 1, Math.max(cols, expected.length)).getDisplayValues()[0] : [];
  const normalize = s => String(s || '').trim().toUpperCase();
  const incorrect = expected.map((head, index) => normalize(actual[index]) === normalize(head) ? null : index + 1).filter(Boolean);
  // Solo lee la columna A para contar IDs repetidos. NO guarda ni muestra ningún ID.
  let duplicateRows = 0;
  let emptyIds = 0;
  let uniqueIds = 0;
  if (rows > 1) {
    const ids = sheet.getRange(2, 1, rows - 1, 1).getDisplayValues();
    const seen = new Set();
    ids.forEach(([value]) => {
      const id = String(value || '').trim();
      if (!id) { emptyIds++; return; }
      if (seen.has(id)) duplicateRows++;
      else seen.add(id);
    });
    uniqueIds = seen.size;
  }
  const report = {
    status: 'AUDITORIA_LOCAL_SOLO_LECTURA',
    sheetPosition: 1,
    totalRowsIncludingHeader: rows,
    columnsFound: cols,
    expectedColumns: expected.length,
    headerMismatchColumnNumbers: incorrect,
    duplicateIdRows: duplicateRows,
    emptyIdRows: emptyIds,
    distinctIds: uniqueIds,
    // Si el encabezado no coincide no se puede interpretar el conteo de IDs con seguridad
    idCountsReliable: normalize(actual[0]) === normalize(expected[0])
  };
  console.log(JSON.stringify(report));
  return report;
}
