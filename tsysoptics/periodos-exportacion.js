// Utilidades sin acceso a datos. La autorización de descargas corresponde al servidor.
export const MODULOS_EXPORTACION = Object.freeze([
  "pacientes", "historias_clinicas", "ventas_pagos",
  "inventario_movimientos", "caja_gastos",
  "citas_laboratorio", "cotizaciones"
]);
export function mesAnterior(fecha = new Date(), zona = "America/Bogota") {
  if (!(fecha instanceof Date) || Number.isNaN(fecha.getTime())) throw new TypeError("Fecha inválida");
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: zona, year: "numeric", month: "2-digit"
  }).formatToParts(fecha);
  let anio = Number(partes.find(p => p.type === "year").value);
  let mes = Number(partes.find(p => p.type === "month").value) - 1;
  if (mes === 0) { mes = 12; anio--; }
  const inicio = String(anio) + "-" + String(mes).padStart(2, "0") + "-01";
  const anioFin = mes === 12 ? anio + 1 : anio;
  const mesFin = mes === 12 ? 1 : mes + 1;
  const finExclusivo = String(anioFin) + "-" + String(mesFin).padStart(2, "0") + "-01";
  return { periodo: inicio.slice(0,7), inicio, finExclusivo, zona };
}
export function textoExcelSeguro(valor) {
  if (typeof valor !== "string") return valor;
  return /^[\u0000-\u0020]*[=+@-]/u.test(valor) ? "'" + valor : valor;
}
