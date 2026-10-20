/* Generador mínimo de PDFs SINTÉTICOS para tests (texto en Helvetica,
   WinAnsi). NO es el PDF real de ningún plan: arma documentos de prueba con
   las líneas que se le pasan, una debajo de la otra, para ejercitar
   pdf.js + el parser de E6 de punta a punta. Sin dependencias. */
function escaparTexto(t) {
  return t.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

/* lineas: array de strings. Opción { sinTexto: true } → una página con un
   rectángulo y sin texto (simula un escaneo). Devuelve un Buffer. */
function crearPdf(lineas, opciones) {
  opciones = opciones || {};
  const porPagina = 48;
  const paginas = [];
  if (opciones.sinTexto) {
    paginas.push("0.5 g 72 300 450 300 re f");
  } else {
    for (let i = 0; i < Math.max(1, lineas.length); i += porPagina) {
      const bloque = lineas.slice(i, i + porPagina);
      paginas.push(bloque.map((l, k) => "BT /F1 10 Tf 40 " + (800 - k * 16) + " Td (" + escaparTexto(l) + ") Tj ET").join("\n"));
    }
  }
  const objetos = [];
  const agregar = (cuerpo) => { objetos.push(cuerpo); return objetos.length; };
  const catalogo = agregar(null);
  const raizPaginas = agregar(null);
  const fuente = agregar("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const hijos = paginas.map((contenido) => {
    const stream = agregar("<< /Length " + Buffer.byteLength(contenido, "latin1") + " >>\nstream\n" + contenido + "\nendstream");
    return agregar("<< /Type /Page /Parent " + raizPaginas + " 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 " + fuente + " 0 R >> >> /Contents " + stream + " 0 R >>");
  });
  objetos[catalogo - 1] = "<< /Type /Catalog /Pages " + raizPaginas + " 0 R >>";
  objetos[raizPaginas - 1] = "<< /Type /Pages /Kids [" + hijos.map((h) => h + " 0 R").join(" ") + "] /Count " + hijos.length + " >>";

  let salida = "%PDF-1.4\n";
  const offsets = [];
  objetos.forEach((cuerpo, i) => {
    offsets.push(Buffer.byteLength(salida, "latin1"));
    salida += (i + 1) + " 0 obj\n" + cuerpo + "\nendobj\n";
  });
  const xref = Buffer.byteLength(salida, "latin1");
  salida += "xref\n0 " + (objetos.length + 1) + "\n0000000000 65535 f \n" +
    offsets.map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("") +
    "trailer\n<< /Size " + (objetos.length + 1) + " /Root " + catalogo + " 0 R >>\nstartxref\n" + xref + "\n%%EOF\n";
  return Buffer.from(salida, "latin1");
}

/* Plan de ejemplo SINTÉTICO con los formatos que soporta el parser
   (tabla Ord/Series/Rep, NxM, "N series de M", RIR y RPE juntos, pausa,
   peso, notas, una línea no interpretable). */
const LINEAS_PLAN_EJEMPLO = [
  "Plan de prueba sintético - Del 12/10/2026 al 18/12/2026",
  "Página 1 de 1",
  "DÍA 1 - EMPUJE",
  "Ord. Ejercicio Series Rep. RIR RPE",
  "1 Press banca c/barra 4 6-8 RIR 2 RPE 8 Pausa 2 min",
  "2 Press inclinado Smith | 4x8-10 | RIR 2 | RPE 8",
  "Nota: controlar la bajada",
  "3 Aperturas en polea 3 x 12-15 90 s (última al fallo)",
  "Plancha abdominal 45 s",
  "DÍA 2 - TRACCIÓN",
  "Dominadas 4 x AMRAP 2 RIR",
  "Remo con barra 4x10 | Espalda | RIR: 1-2",
  "Face pull 3 series de 15 25 kg c/u"
];

module.exports = { crearPdf, LINEAS_PLAN_EJEMPLO };
