// TsysOptics · Normalización de los campos libres del panel.
// Se guarda el texto en mayúsculas, no sólo se modifica su apariencia visual.
// Campos de credenciales, correos, URLs, números, fechas y claves se conservan intactos.
(() => {
  "use strict";
  const fields = 'input:not([type]),input[type="text"],input[type="search"],textarea';
  function eligible(element) {
    return element instanceof HTMLElement &&
      element.matches(fields) &&
      element.closest('#tsys-app') &&
      !element.matches('[readonly],[disabled],[data-preserve-case]') &&
      !element.closest('[data-preserve-case]') &&
      !/^(email|password|url|tel|number|date|time|datetime-local)$/i.test(element.type || '') &&
      !/email|correo|contrase|password|token|apikey|api_key|url|enlace|webhook/i.test(
        (element.name || '') + ' ' + (element.id || '')
      );
  }
  function uppercase(element) {
    if (!eligible(element)) return;
    const previous = element.value;
    const upper = previous.toLocaleUpperCase('es-CO');
    if (previous === upper) return;
    const start = element.selectionStart;
    const end = element.selectionEnd;
    element.value = upper;
    if (start !== null && end !== null) {
      try {
        element.setSelectionRange(
          previous.slice(0, start).toLocaleUpperCase('es-CO').length,
          previous.slice(0, end).toLocaleUpperCase('es-CO').length
        );
      } catch (_) { /* No todos los campos permiten establecer el cursor. */ }
    }
  }
  document.addEventListener('input', event => {
    if (!event.isComposing) uppercase(event.target);
  }, true);
  document.addEventListener('compositionend', event => uppercase(event.target), true);
  document.addEventListener('change', event => uppercase(event.target), true);
  // Un campo puede modificarse por código sin generar input; normalizar antes de leer FormData.
  document.addEventListener('submit', event => {
    if (!event.target.closest?.('#tsys-app')) return;
    event.target.querySelectorAll(fields).forEach(uppercase);
  }, true);
})();
