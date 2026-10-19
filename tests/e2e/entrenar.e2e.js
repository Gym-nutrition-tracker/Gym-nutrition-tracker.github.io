/* E2E del historial de Entrenar con bloques históricos (Chromium/Playwright).
   Uso:
     PLAYWRIGHT_PATH=$(npm root -g)/playwright BASE_DIR=/ruta/version_base node tests/e2e/entrenar.e2e.js
   Si BASE_DIR apunta a la versión anterior, verifica que solo cambian las
   tarjetas que antes decían "Día ya no existe en la rutina". */
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const { datasetEntrenar } = require("../fixtures/entrenar-historial-dataset");
const { aV3 } = require("../entorno");

const RAIZ = path.join(__dirname, "..", "..");
const AHORA = "2026-10-20T12:00:00";
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

async function abrir(browser, url, registro) {
  const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
  page.on("pageerror", (e) => registro.errores.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") registro.errores.push(m.text()); });
  page.on("request", (r) => { if (/supabase\.co/.test(r.url())) registro.supabase.push(r.url()); });
  page.on("dialog", (d) => d.accept());
  await page.clock.install({ time: new Date(AHORA) });
  await page.clock.pauseAt(new Date(AHORA));
  await page.addInitScript((d) => { if (!sessionStorage.getItem("sembrado")) { localStorage.setItem("gymNutritionTracker", d); sessionStorage.setItem("sembrado", "1"); } }, JSON.stringify(datasetEntrenar()));
  await page.goto(url + "/index.html");
  await page.click("#nav-entrenar");
  return page;
}

const leerTarjetas = (page) => page.$$eval(".historial-item", (items) => items.map((i) => ({
  id: i.dataset.sesionId,
  fecha: i.querySelector(".historial-item-fecha").textContent,
  resumen: i.querySelector(".historial-item-resumen").textContent
})));
const leerStorage = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("gymNutritionTracker")));

(async () => {
  const srv = await servir(RAIZ);
  const srvBase = process.env.BASE_DIR ? await servir(process.env.BASE_DIR) : null;
  const browser = await chromium.launch();
  const reg = { errores: [], supabase: [] };
  const r = [];
  const check = (nombre, ok, detalle) => r.push({ nombre, ok: !!ok, detalle });
  const original = datasetEntrenar();
  /* E2: lo sembrado es schema 2; al abrir se migra una vez a schema 3. */
  const migrado = aV3(original);

  try {
    const page = await abrir(browser, "http://127.0.0.1:" + srv.address().port, reg);
    const t = await leerTarjetas(page);
    const por = Object.fromEntries(t.map((x) => [x.id, x]));
    check("16/10 → TREN SUPERIOR", por["h-1610"].fecha === "16/10/2026" && por["h-1610"].resumen === "🏋️ TREN SUPERIOR · 10 ejercicios", por["h-1610"]);
    check("15/10 → TRACCIÓN", por["h-1510"].resumen === "🏋️ TRACCIÓN · 10 ejercicios", por["h-1510"]);
    check("13/10 → EMPUJE", por["h-1310"].resumen === "🏋️ EMPUJE · 10 ejercicios", por["h-1310"]);
    check("08/10 → TRACCIÓN", por["h-0810"].resumen === "🏋️ TRACCIÓN · 10 ejercicios");
    check("05/10 → EMPUJE", por["h-0510"].resumen === "🏋️ EMPUJE · 10 ejercicios");
    check("02/10 → TREN SUPERIOR", por["h-0216"].resumen === "🏋️ TREN SUPERIOR · 10 ejercicios");
    check("desconocido → Bloque anterior", por["x-desc"].resumen === "🏋️ Bloque anterior · 3 ejercicios", por["x-desc"]);
    check("activo → nombre actual", por["n-1910"].resumen === "🏋️ Día 1 · Pecho y tríceps · 2 ejercicios");
    check("sin 'Día ya no existe en la rutina'", !/Día ya no existe en la rutina/.test(await page.content()));

    if (srvBase) {
      const pageBase = await abrir(browser, "http://127.0.0.1:" + srvBase.address().port, { errores: [], supabase: [] });
      const tb = await leerTarjetas(pageBase);
      await pageBase.close();
      const distintas = tb.filter((b, i) => b.id !== t[i].id || b.fecha !== t[i].fecha || b.resumen !== t[i].resumen);
      check("misma cantidad, orden y fechas que la versión base", tb.length === t.length && tb.every((b, i) => b.id === t[i].id && b.fecha === t[i].fecha));
      if (tb.some((b) => /Día ya no existe en la rutina/.test(b.resumen))) {
        check("solo cambian las tarjetas 'Día ya no existe en la rutina'", distintas.length === 7 && distintas.every((b) => /Día ya no existe en la rutina/.test(b.resumen)), distintas);
      } else {
        /* Base que ya resuelve los nombres (por ejemplo, HEAD): todo idéntico. */
        check("todas las tarjetas idénticas a la base", distintas.length === 0, distintas);
      }
      check("fútbol idéntico a la base", tb.filter((b) => b.id === "f-1710")[0].resumen === por["f-1710"].resumen, por["f-1710"]);
    }

    const sinEscrituras = JSON.stringify(await leerStorage(page)) === JSON.stringify(migrado);
    check("ver el historial no escribe localStorage (solo la migración 2→3)", sinEscrituras);

    /* Editar una sesión histórica (TRACCIÓN 15/10) y guardar. */
    await page.click('[data-accion="editar-sesion"][data-sesion-id="h-1510"]');
    const diaEdicion = await page.$eval(".campo p.nota", (p) => p.textContent);
    check("editar: muestra el día TRACCIÓN", diaEdicion === "TRACCIÓN", diaEdicion);
    const tarjetasEj = await page.$$eval(".ejercicio-entrenar-card", (c) => c.length);
    check("editar: muestra los 10 ejercicios registrados", tarjetasEj === 10, tarjetasEj);
    const nombresEj = await page.$$eval(".ejercicio-entrenar-card .ejercicio-entrenar-header", (hs) => hs.map((h) => h.firstElementChild.textContent));
    check("editar: ejercicios con mapping muestran el nombre real", nombresEj[0] === "DOMINADAS TOMA NEUTRA" && nombresEj[1] === "REMO T CON BARRA", nombresEj.slice(0, 3));
    check("editar: ejercicios sin mapping conservan el texto de siempre", nombresEj.slice(2).every((n) => n === "Ejercicio eliminado de la rutina"), nombresEj.slice(2));
    const repsInputs = await page.$$('.ejercicio-entrenar-card[data-ejercicio-id="mu4c87ep8spsdp"] .input-serie-reps');
    await repsInputs[1].fill("13");
    await page.click('[data-accion="guardar-sesion"]');
    const tras = await leerStorage(page);
    const editada = tras.sesiones_entrenamiento.filter((s) => s.id === "h-1510")[0];
    const orig = original.sesiones_entrenamiento.filter((s) => s.id === "h-1510")[0];
    check("guardar: conserva id, dia_rutina_id y ejercicio_id", editada && editada.dia_rutina_id === "mu4c87ep2snsau" &&
      JSON.stringify(editada.ejercicios_realizados.map((e) => e.ejercicio_id)) === JSON.stringify(orig.ejercicios_realizados.map((e) => e.ejercicio_id)), editada && editada.dia_rutina_id);
    check("guardar: aplica el cambio de reps", editada.ejercicios_realizados[1].series[1].reps === 13, editada.ejercicios_realizados[1].series[1]);
    const otrasIguales = tras.sesiones_entrenamiento.filter((s) => s.id !== "h-1510").every((s) => JSON.stringify(s) === JSON.stringify(original.sesiones_entrenamiento.filter((o) => o.id === s.id)[0]));
    check("guardar: el resto de las sesiones queda intacto", otrasIguales);
    const tarjetaEditada = (await leerTarjetas(page)).filter((x) => x.id === "h-1510")[0];
    check("guardar: la tarjeta sigue diciendo TRACCIÓN", tarjetaEditada && tarjetaEditada.resumen === "🏋️ TRACCIÓN · 10 ejercicios", tarjetaEditada);

    /* Eliminar una sesión histórica desconocida. */
    await page.click('[data-accion="borrar-sesion"][data-sesion-id="x-desc"]');
    const trasBorrar = await leerStorage(page);
    check("eliminar: quita solo esa sesión", trasBorrar.sesiones_entrenamiento.length === original.sesiones_entrenamiento.length - 1 && !trasBorrar.sesiones_entrenamiento.some((s) => s.id === "x-desc"));
    check("eliminar: la tarjeta desaparece", !(await leerTarjetas(page)).some((x) => x.id === "x-desc"));
    check("schema_version 3 y rutina válida", trasBorrar.schema_version === 3 && trasBorrar.rutina.planes.length === 1 && !("dias" in trasBorrar.rutina));

    check("sin errores de consola", reg.errores.length === 0, reg.errores);
    check("sin requests a Supabase", reg.supabase.length === 0, reg.supabase);
  } finally {
    await browser.close();
    srv.close();
    if (srvBase) srvBase.close();
  }
  r.forEach((x) => console.log((x.ok ? "ok   " : "FALLA") + " - " + x.nombre + (x.ok ? "" : " → " + JSON.stringify(x.detalle))));
  const fallas = r.filter((x) => !x.ok).length;
  console.log("# e2e entrenar: " + (r.length - fallas) + "/" + r.length + " ok");
  process.exit(fallas ? 1 : 0);
})();
