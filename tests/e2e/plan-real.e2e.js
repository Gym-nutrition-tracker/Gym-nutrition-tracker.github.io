/* Integración E6 contra el PDF REAL del Plan N.º 4 ("plan 2.pdf"), con el
   mismo flujo de producción en Chromium: pdf.js → extraerTextoPDF →
   parsearPlanDesdeTexto → normalizarPlanParseado → validarPlanParseado, y
   además la importación desde la UI (revisión, sin escribir nada).

   El PDF NO está en el repo (es público y el documento tiene datos
   personales): se pasa su ruta en PLAN_REAL_PDF.
     PLAN_REAL_PDF=/ruta/plan\ 2.pdf PLAYWRIGHT_PATH=$(npm root -g)/playwright node tests/e2e/plan-real.e2e.js
   Expectativas: tests/fixtures/plan-real-n4-esperado.json (lectura visual). */
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const RUTA = process.env.PLAN_REAL_PDF;
if (!RUTA || !fs.existsSync(RUTA)) {
  console.log("# e2e plan real: OMITIDO — falta el PDF real (definí PLAN_REAL_PDF con su ruta). No cuenta como aprobado.");
  process.exit(0);
}

const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const { aE3 } = require("../entorno");
const { datasetHistoricos } = require("../fixtures/historicos-dataset");
const ESPERADO = require("../fixtures/plan-real-n4-esperado.json");

const RAIZ = path.join(__dirname, "..", "..");
const TIPOS = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".woff2": "font/woff2" };
const CAMPOS = ["nombre", "series_objetivo", "reps_objetivo", "rir_objetivo", "rpe_objetivo", "pausa", "comentarios"];

function servir(dir) {
  return new Promise((ok) => {
    const srv = http.createServer((req, res) => {
      const ruta = path.join(dir, decodeURIComponent(req.url.split("?")[0]).replace(/^\/+/, "") || "index.html");
      fs.readFile(ruta, (err, buf) => {
        if (err) { res.writeHead(404); res.end(); return; }
        res.writeHead(200, { "Content-Type": TIPOS[path.extname(ruta)] || "application/octet-stream" });
        res.end(buf);
      });
    });
    srv.listen(0, "127.0.0.1", () => ok(srv));
  });
}

(async () => {
  const srv = await servir(RAIZ);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errores = [];
  const supabase = [];
  page.on("pageerror", (e) => errores.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errores.push(m.text()); });
  page.on("request", (q) => { if (/supabase\.co/.test(q.url())) supabase.push(q.url()); });
  page.on("dialog", (d) => d.accept());
  await page.addInitScript((d) => { if (!sessionStorage.getItem("sembrado")) { localStorage.setItem("gymNutritionTracker", d); sessionStorage.setItem("sembrado", "1"); } }, JSON.stringify(aE3(datasetHistoricos({ legacy: true }))));
  await page.goto("http://127.0.0.1:" + srv.address().port + "/index.html");

  const r = [];
  const check = (nombre, ok, detalle) => r.push({ nombre, ok: !!ok, detalle });
  const pdf = fs.readFileSync(RUTA);

  try {
    /* 1. Flujo de producción, capa por capa. */
    const { texto, norm, val } = await page.evaluate(async (b64) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const P = GYMAPP.pdfImport;
      const texto = await P.extraerTextoPDF(new File([bytes], "plan 2.pdf", { type: "application/pdf" }));
      const norm = P.normalizarPlanParseado(P.parsearPlanDesdeTexto(texto));
      return { texto, norm, val: P.validarPlanParseado(norm) };
    }, pdf.toString("base64"));

    /* El nombre esperado se lee del propio PDF ("Descripción:"), para no
       guardar datos personales en el repo. La persona ("Nombre:") nunca
       puede terminar como nombre del plan. */
    const etiqueta = (rotulo) => { const m = texto.match(new RegExp("^" + rotulo + ":\\s{2,}(.+?)(?=\\s{2,}|$)", "mi")); return m ? m[1].trim() : null; };
    const descripcion = etiqueta("Descripción");
    const persona = etiqueta("Nombre");
    check("nombre del plan = 'Descripción:' del PDF", !!descripcion && norm.nombre === descripcion, norm.nombre === descripcion);
    check("el nombre de la persona no se usa ni aparece en el borrador", !!persona && norm.nombre !== persona && !JSON.stringify(norm).includes(persona));
    check("fecha_inicio = 2026-10-12", norm.fecha_inicio === ESPERADO.fecha_inicio, norm.fecha_inicio);
    check("fecha_fin = 2026-12-18", norm.fecha_fin === ESPERADO.fecha_fin, norm.fecha_fin);
    check("5 días en orden", JSON.stringify(norm.dias.map((d) => d.nombre)) === JSON.stringify(ESPERADO.dias.map((d) => d.nombre)), norm.dias.map((d) => d.nombre));
    check("ningún día vacío", norm.dias.every((d) => d.ejercicios.length > 0));
    const total = norm.dias.reduce((n, d) => n + d.ejercicios.length, 0);
    check("54 ejercicios (12/9/12/9/12)", total === 54 && JSON.stringify(norm.dias.map((d) => d.ejercicios.length)) === JSON.stringify(ESPERADO.dias.map((d) => d.ejercicios.length)), norm.dias.map((d) => d.ejercicios.length));

    const malos = Object.fromEntries(CAMPOS.concat(["peso_objetivo", "grupo_muscular"]).map((c) => [c, []]));
    ESPERADO.dias.forEach((d, i) => d.ejercicios.forEach((e, j) => {
      const g = (norm.dias[i] || { ejercicios: [] }).ejercicios[j] || {};
      CAMPOS.forEach((c) => { if (JSON.stringify(g[c] === undefined ? null : g[c]) !== JSON.stringify(e[c])) malos[c].push(d.nombre + " #" + (j + 1) + " " + e.nombre + ": " + JSON.stringify(g[c])); });
      if (g.peso_objetivo !== null) malos.peso_objetivo.push(e.nombre + ": " + g.peso_objetivo);
      if (g.grupo_muscular !== null) malos.grupo_muscular.push(e.nombre + ": " + g.grupo_muscular);
    }));
    const cuenta = (c) => ESPERADO.dias.flatMap((d) => d.ejercicios).filter((e) => e[c] !== null).length;
    check("nombres 54/54", !malos.nombre.length, malos.nombre);
    check("series 54/54", !malos.series_objetivo.length, malos.series_objetivo);
    check("reps 54/54 (10/10, 7-7-7, 15-30'', 8 (5''))", !malos.reps_objetivo.length, malos.reps_objetivo);
    check("RIR " + cuenta("rir_objetivo") + "/" + cuenta("rir_objetivo") + " (y null donde no hay)", !malos.rir_objetivo.length, malos.rir_objetivo);
    check("RPE " + cuenta("rpe_objetivo") + "/" + cuenta("rpe_objetivo") + " (y null donde no hay)", !malos.rpe_objetivo.length, malos.rpe_objetivo);
    check("pausas " + cuenta("pausa") + "/" + cuenta("pausa") + " (30'', 1', 1-2', 2', 1´)", !malos.pausa.length, malos.pausa);
    check("los " + cuenta("comentarios") + " comentarios reales, sin campos estructurados mezclados", !malos.comentarios.length, malos.comentarios);
    check("ningún valor en peso_objetivo (el PDF no trae cargas; RIR y '10 KG' no son peso)", !malos.peso_objetivo.length, malos.peso_objetivo);
    const lumbares = norm.dias[2] && norm.dias[2].ejercicios.find((e) => /LUMBARES/.test(e.nombre));
    check("'10 KG' queda dentro del comentario de su ejercicio", lumbares && /10 KG/.test(lumbares.comentarios) && lumbares.peso_objetivo === null, lumbares);
    check("grupo_muscular null en los 54 (el PDF no lo trae)", !malos.grupo_muscular.length, malos.grupo_muscular);
    check("salto de página: los 2 ABD que cierran TRACCIÓN siguen en TRACCIÓN", JSON.stringify(norm.dias[2].ejercicios.slice(-2).map((e) => e.nombre)) === JSON.stringify(ESPERADO.dias[2].ejercicios.slice(-2).map((e) => e.nombre)));

    check("0 errores de validación", val.errores.length === 0, val.errores);
    const tipos = [...new Set(val.advertencias.map((a) => a.mensaje))];
    const MSJ_RIR_RPE = "Este plan utiliza RIR y RPE simultáneamente. Ambos valores fueron importados por separado.";
    check("solo advertencias legítimas (grupo muscular; RIR + RPE informativo)", tipos.every((m) => m === "No se pudo detectar el grupo muscular." || m === MSJ_RIR_RPE), tipos);
    const ambos = norm.dias.flatMap((d) => d.ejercicios).filter((e) => e.rir_objetivo !== null && e.rpe_objetivo !== null);
    check("33 ejercicios con RIR y RPE, ambos conservados", ambos.length === 33, ambos.length);
    check("RIR + RPE: un único aviso a nivel plan (no 33)", val.advertencias.filter((a) => a.mensaje === MSJ_RIR_RPE).length === 1 &&
      val.advertencias.filter((a) => a.mensaje === MSJ_RIR_RPE)[0].dia === null);
    check("los avisos por ejercicio siguen individuales (grupo muscular ×54)", val.advertencias.filter((a) => a.mensaje === "No se pudo detectar el grupo muscular.").length === 54);
    check("sin 'Línea sin interpretar' por el encabezado desplazado", !val.advertencias.some((a) => /Línea sin interpretar/.test(a.mensaje)));
    check("sin 'Texto ambiguo' (RPE y pausas reconocidos)", !val.advertencias.some((a) => /Texto ambiguo/.test(a.mensaje)));

    /* 2. El mismo PDF desde la UI: abre la revisión y no escribe nada. */
    await page.click("#btn-rutina");
    const antes = await page.evaluate(() => JSON.stringify(Object.keys(localStorage).sort().map((k) => [k, localStorage.getItem(k)])));
    await page.setInputFiles("#input-pdf-rutina", { name: "plan 2.pdf", mimeType: "application/pdf", buffer: pdf });
    await page.waitForSelector(".modal-revision");
    const resumen = await page.$eval(".rev-resumen", (n) => n.textContent);
    check("UI: revisión con 5 días · 54 ejercicios", /Nuevo plan: 5 días · 54 ejercicios/.test(resumen), resumen);
    check("UI: un solo aviso de RIR + RPE en la revisión", (await page.$$eval(".rev-advertencias li", (l) => l.filter((x) => /RIR y RPE simultáneamente/.test(x.textContent)).length)) === 1);
    check("UI: nombre y fechas precargados", (await page.$eval("#rev-plan-nombre", (i) => i.value)) === descripcion &&
      (await page.$eval("#rev-plan-inicio", (i) => i.value)) === "2026-10-12" && (await page.$eval("#rev-plan-fin", (i) => i.value)) === "2026-12-18");
    check("UI: RIR 1-2 / RPE 8 / pausa 2' en el ejercicio 5 de EMPUJE", (await page.$eval("#rev-d0-e4-rir_objetivo", (i) => i.value)) === "1-2" &&
      (await page.$eval("#rev-d0-e4-rpe_objetivo", (i) => i.value)) === "8" && (await page.$eval("#rev-d0-e4-pausa", (i) => i.value)) === "2'");
    check("UI: importar y revisar no escribe nada", (await page.evaluate(() => JSON.stringify(Object.keys(localStorage).sort().map((k) => [k, localStorage.getItem(k)])))) === antes);

    check("sin errores de consola", errores.length === 0, errores);
    check("sin requests a Supabase", supabase.length === 0, supabase);
  } finally {
    await browser.close();
    srv.close();
  }
  r.forEach((x) => console.log((x.ok ? "ok   " : "FALLA") + " - " + x.nombre + (x.ok ? "" : " → " + JSON.stringify(x.detalle))));
  const fallas = r.filter((x) => !x.ok).length;
  console.log("# e2e plan real: " + (r.length - fallas) + "/" + r.length + " ok");
  process.exit(fallas ? 1 : 0);
})();
