/* E2E del historial de rutinas anteriores en Progreso (Chromium/Playwright).
   Uso: PLAYWRIGHT_PATH=$(npm root -g)/playwright node tests/e2e/historicos.e2e.js */
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const { seguirSinCuenta } = require("./acceso-helper");
const { datasetHistoricos } = require("../fixtures/historicos-dataset");
const { aV3, aE3 } = require("../entorno");

const RAIZ = path.join(__dirname, "..", "..");
const AHORA = "2026-11-09T12:00:00";
const TIPOS = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png" };

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

const textos = (page, sel) => page.$$eval(sel + " option", (os) => os.map((o) => o.textContent));
const seleccionado = (page, sel) => page.$eval(sel, (s) => s.value);
const puntosGrafico = (page) => page.evaluate(() => {
  const c = document.getElementById("grafico-progreso");
  const chart = c && window.Chart && window.Chart.getChart(c);
  return chart ? chart.data.datasets[0].data.length : -1;
});

(async () => {
  const srv = await servir(RAIZ);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
  const errores = [];
  const supabase = [];
  page.on("pageerror", (e) => errores.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errores.push(m.text()); });
  page.on("request", (r) => { if (/supabase\.co/.test(r.url())) supabase.push(r.url()); });
  await page.clock.install({ time: new Date(AHORA) });
  await page.clock.pauseAt(new Date(AHORA));
  const datos = JSON.stringify(datasetHistoricos());
  await page.addInitScript((d) => { if (!sessionStorage.getItem("sembrado")) { localStorage.setItem("gymNutritionTracker", d); sessionStorage.setItem("sembrado", "1"); } }, datos);
  await page.goto("http://127.0.0.1:" + srv.address().port + "/index.html");
  await seguirSinCuenta(page);
  await page.click("#nav-progreso");

  const r = [];
  const check = (nombre, ok, detalle) => r.push({ nombre, ok: !!ok, detalle });
  const activosMasHistorial = ["Día 1 · Pecho", "Día 2 · Espalda", "Día 3 · Piernas", "Día 4 · Hombros", "Día 5 · Brazos", "Historial de rutinas anteriores"];

  try {
    const evo = await textos(page, "#select-evolucion-bloque");
    const ana = await textos(page, "#select-analisis-bloque");
    check("Evolución: solo 5 activos + historial", JSON.stringify(evo) === JSON.stringify(activosMasHistorial), evo);
    check("Análisis: solo 5 activos + historial", JSON.stringify(ana) === JSON.stringify(activosMasHistorial), ana);
    const html = await page.content();
    check("ninguna opción 'Bloque eliminado de la rutina'", !/Bloque eliminado de la rutina/.test(html));
    check("sin segundo selector por defecto", !(await page.$("#select-evolucion-bloque-historico")) && !(await page.$("#select-analisis-bloque-historico")));

    /* Evolución → historial */
    await page.selectOption("#select-evolucion-bloque", "__historial__");
    const hist = await textos(page, "#select-evolucion-bloque-historico");
    check("Evolución: segundo selector con 5 históricos distintos", hist.length === 5 && new Set(hist).size === 5, hist);
    check("Evolución: abre el histórico más reciente", (await seleccionado(page, "#select-evolucion-bloque-historico")) === "old-4");
    check("Evolución: principal muestra 'Historial de rutinas anteriores'", (await seleccionado(page, "#select-evolucion-bloque")) === "__historial__");
    await page.selectOption("#select-evolucion-bloque-historico", "old-2");
    check("Evolución: gráfico del histórico con sus 6 sesiones", (await puntosGrafico(page)) === 6, await puntosGrafico(page));
    const ejEvo = await textos(page, "#select-evolucion-ejercicio");
    check("Evolución: ejercicios del histórico distinguibles", JSON.stringify(ejEvo) === JSON.stringify(["Todo el bloque", "Ejercicio anterior · máx. 26 kg", "Ejercicio anterior · máx. 40 kg", "Ejercicio anterior · peso corporal"]), ejEvo);
    await page.selectOption("#select-evolucion-ejercicio", "old-2-e1");
    check("Evolución: gráfico de un ejercicio histórico", (await puntosGrafico(page)) === 6);
    await page.selectOption("#select-evolucion-bloque", "D3");
    check("Evolución: volver a un activo oculta el segundo selector", !(await page.$("#select-evolucion-bloque-historico")) && (await puntosGrafico(page)) === 4);

    /* Análisis semanal → historial */
    await page.selectOption("#select-analisis-bloque", "__historial__");
    await page.selectOption("#select-analisis-bloque-historico", "old-1");
    const tituloAnalisis = await page.$eval(".progreso-analisis-semanal h4", (h) => h.textContent);
    check("Análisis: título con la etiqueta por fechas", /^Bloque anterior · 03\/08–24\/08 · 4 sesiones/.test(tituloAnalisis), tituloAnalisis);
    const historialFilas = await page.$$eval(".progreso-analisis-semanal .analisis-historial-item", (n) => n.length);
    check("Análisis: historial semanal del bloque histórico", historialFilas > 0, historialFilas);
    const proxima = await page.$eval(".progreso-proxima-sesion", (p) => p.textContent);
    check("Próxima sesión: el histórico se informa como fuera de la rutina", /ya no forma parte de la rutina actual/.test(proxima), proxima);
    await page.selectOption("#select-analisis-ejercicio", "old-1-e1");
    const proximaEj = await page.$eval(".progreso-proxima-sesion", (p) => p.textContent);
    check("PROG-03 sobre un ejercicio histórico sigue funcionando", /Próxima vez en este ejercicio/.test(proximaEj) && /Estado/.test(proximaEj), proximaEj.slice(0, 120));

    /* PROG-04 */
    const contexto = await page.$eval(".progreso-estado-plan .estado-plan-contexto", (p) => p.textContent);
    check("PROG-04: inicio observado en la rutina actual (12/10)", /Inicio observado: 12\/10/.test(contexto), contexto);

    /* Compatibilidad legacy: los 5 días reales del plan anterior. */
    const pageL = await browser.newPage({ viewport: { width: 390, height: 900 } });
    pageL.on("pageerror", (e) => errores.push(e.message));
    pageL.on("console", (m) => { if (m.type() === "error") errores.push(m.text()); });
    pageL.on("request", (q) => { if (/supabase\.co/.test(q.url())) supabase.push(q.url()); });
    await pageL.clock.install({ time: new Date(AHORA) });
    await pageL.clock.pauseAt(new Date(AHORA));
    const datosL = JSON.stringify(datasetHistoricos({ legacy: true }));
    await pageL.addInitScript((d) => { if (!sessionStorage.getItem("sembrado")) { localStorage.setItem("gymNutritionTracker", d); sessionStorage.setItem("sembrado", "1"); } }, datosL);
    await pageL.goto("http://127.0.0.1:" + srv.address().port + "/index.html");
    await seguirSinCuenta(pageL);
    await pageL.click("#nav-progreso");
    const legacyEsperado = ["EMPUJE · 4 sesiones", "PIERNAS (ENFOQUE EN CUADRICEPS) · 5 sesiones", "TRACCIÓN · 5 sesiones", "PIERNAS (ENFOQUE EN ISQUIOS) · 4 sesiones", "TREN SUPERIOR · 4 sesiones"];
    for (const seccion of ["evolucion", "analisis"]) {
      await pageL.selectOption("#select-" + seccion + "-bloque", "__historial__");
      const hl = await textos(pageL, "#select-" + seccion + "-bloque-historico");
      check("Legacy " + seccion + ": los 5 días por nombre y en orden del plan", JSON.stringify(hl.slice(0, 5)) === JSON.stringify(legacyEsperado), hl);
      check("Legacy " + seccion + ": abre EMPUJE", (await seleccionado(pageL, "#select-" + seccion + "-bloque-historico")) === "mu4c87ep730qj1");
    }
    await pageL.selectOption("#select-evolucion-bloque-historico", "mu4c87ep2snsau");
    check("Legacy: gráfico de TRACCIÓN con sus 5 sesiones", (await puntosGrafico(pageL)) === 5, await puntosGrafico(pageL));
    await pageL.selectOption("#select-analisis-bloque-historico", "mu4c87ep241kdy");
    const tituloL = await pageL.$eval(".progreso-analisis-semanal h4", (h) => h.textContent);
    check("Legacy: análisis con título PIERNAS (ENFOQUE EN CUADRICEPS)", /^PIERNAS \(ENFOQUE EN CUADRICEPS\) · 5 sesiones/.test(tituloL), tituloL);
    /* Ejercicios con nombre real dentro de EMPUJE (Evolución y Análisis). */
    const esperadoEmpuje = ["Todo el bloque", "PRESS BANCA C/BARRA · máx. 60 kg", "PRESS INCLINADO EN SMITH · máx. 20 kg", "MARIPOSA · máx. 105 kg",
      "FLEXIONES DE BRAZO EN CAJON BAJO O STEP · peso corporal", "Ejercicio anterior · máx. 30 kg", "Ejercicio anterior · máx. 15 kg"];
    for (const seccion of ["evolucion", "analisis"]) {
      await pageL.selectOption("#select-" + seccion + "-bloque-historico", "mu4c87ep730qj1");
      const ejs = await textos(pageL, "#select-" + seccion + "-ejercicio");
      check("Legacy " + seccion + ": ejercicios de EMPUJE con nombre real", JSON.stringify(ejs) === JSON.stringify(esperadoEmpuje), ejs);
    }
    await pageL.selectOption("#select-evolucion-ejercicio", "mu4c87epsr80xw");
    check("Legacy: gráfico de PRESS BANCA C/BARRA con sus 4 ejecuciones", (await puntosGrafico(pageL)) === 4, await puntosGrafico(pageL));
    await pageL.selectOption("#select-analisis-ejercicio", "mu4c87epra2lxd");
    const tituloEj = await pageL.$eval(".progreso-analisis-semanal h4", (h) => h.textContent);
    check("Legacy: análisis del ejercicio con su nombre real", /^MARIPOSA · máx\. 105 kg/.test(tituloEj), tituloEj);
    const proximaEjL = await pageL.$eval(".progreso-proxima-sesion", (p) => p.textContent);
    check("Legacy: PROG-03 del ejercicio histórico funciona", /Próxima vez en este ejercicio/.test(proximaEjL) && /Estado/.test(proximaEjL), proximaEjL.slice(0, 100));
    const htmlL = await pageL.content();
    check("Legacy: sin 'Ejercicio anterior N' ni 'Ejercicio eliminado' en Progreso", !/Ejercicio anterior \d/.test(htmlL) && !/Ejercicio eliminado de la rutina/.test(htmlL));

    const contextoL = await pageL.$eval(".progreso-estado-plan .estado-plan-contexto", (p) => p.textContent);
    check("Legacy: PROG-04 sigue en la rutina actual", /Inicio observado: 12\/10/.test(contextoL), contextoL);
    check("Legacy: localStorage solo con la migración 2→3 + plan legacy (E3)", (await pageL.evaluate(() => localStorage.getItem("gymNutritionTracker"))) === JSON.stringify(aE3(JSON.parse(datosL))));
    const planesL = await pageL.evaluate(() => JSON.parse(localStorage.getItem("gymNutritionTracker")).rutina.planes.map((p) => p.plan_id));
    check("Legacy: plan legacy persistido antes del plan activo", planesL.length === 2 && planesL[0] === "plan-hist-mu4c87ep730qj1", planesL);
    await pageL.close();

    check("sin errores de consola", errores.length === 0, errores);
    check("sin requests a Supabase", supabase.length === 0, supabase);
    check("localStorage solo con la migración 2→3", (await page.evaluate(() => localStorage.getItem("gymNutritionTracker"))) === JSON.stringify(aV3(JSON.parse(datos))));
  } finally {
    await browser.close();
    srv.close();
  }
  r.forEach((x) => console.log((x.ok ? "ok   " : "FALLA") + " - " + x.nombre + (x.ok ? "" : " → " + JSON.stringify(x.detalle))));
  const fallas = r.filter((x) => !x.ok).length;
  console.log("# e2e historial: " + (r.length - fallas) + "/" + r.length + " ok");
  process.exit(fallas ? 1 : 0);
})();
