/* Utilidades compartidas entre módulos. */
var GYMAPP = window.GYMAPP || (window.GYMAPP = {});

GYMAPP.util = (function () {
  function generarId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function escapeHtml(str) {
    var div = document.createElement("div");
    div.textContent = str == null ? "" : String(str);
    return div.innerHTML;
  }

  /* Convierte un timestamp completo (Date, o string ISO con hora como los que
     guarda sesion.fecha) al día calendario LOCAL "YYYY-MM-DD". Nunca hagas
     fecha.slice(0, 10) sobre un timestamp con hora: eso toma el día en UTC,
     que cerca de la medianoche puede ser un día distinto al local (ej.
     entrenar a las 22:00 en Argentina, UTC-3, ya cae en el día siguiente
     en UTC). Esta función es la única fuente de verdad para agrupar
     sesiones por día calendario. */
  function fechaLocalISO(fechaOTimestamp) {
    var d = fechaOTimestamp instanceof Date ? fechaOTimestamp : new Date(fechaOTimestamp);
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  /* Números decimales escritos por el usuario (pesos, cargas): acepta
     punto o coma ("42.5", "42,5", ",5") y devuelve un número JS. Texto no
     numérico, negativos, vacío o más de un separador → NaN. Sin redondeo.
     Se usa con inputs type="text" inputmode="decimal": type="number" pierde
     la coma (Chromium la descarta: "42,5" → 425; iOS con región Argentina
     devuelve vacío). */
  function parsearDecimal(valor) {
    if (typeof valor === "number") return isFinite(valor) && valor >= 0 ? valor : NaN;
    var t = String(valor == null ? "" : valor).trim().replace(",", ".");
    if (!/^(\d+(\.\d*)?|\.\d+)$/.test(t)) return NaN;
    return Number(t);
  }

  /* Número para mostrar: coma decimal y sin ceros de más (25 → "25",
     42.5 → "42,5", 0.25 → "0,25"). Nunca redondea a entero. */
  function formatearDecimal(n) {
    if (typeof n !== "number" || !isFinite(n)) return n == null ? "" : String(n);
    return String(Math.round(n * 1000) / 1000).replace(".", ",");
  }

  return { generarId: generarId, escapeHtml: escapeHtml, fechaLocalISO: fechaLocalISO, parsearDecimal: parsearDecimal, formatearDecimal: formatearDecimal };
})();
