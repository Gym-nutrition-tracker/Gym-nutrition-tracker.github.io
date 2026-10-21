/* E2E de E5: el flujo real de Entrenar guarda plan_id + prescripcion_snapshot
   en sesiones nuevas de gimnasio y la edición los conserva (Chromium/Playwright).
   Uso: PLAYWRIGHT_PATH=$(npm root -g)/playwright node tests/e2e/sesion-plan.e2e.js */
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const { seguirSinCuenta } = require("./acceso-helper");
const { aE3 } = require("../entorno");
const { datasetHistoricos } = require("../fixtures/historicos-dataset");

const RAIZ = path.join(__dirname, "..", "..");
const AHORA = "2026-11-09T12:00:00";
const TIPOS = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".woff2": "font/woff2" };

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

/* Plan activo: Día 1 = EMPUJE con PRESS BANCA 4 × 6-8, RIR 2. */
function datos() {
  const d = aE3(datasetHistoricos({ legacy: true }));
  d.usuario.actividades = [{ tipo: "gimnasio", meta_semanal: 5 }, { tipo: "futbol", meta_semanal: 2 }];
  const activo = d.rutina.planes.find((p) => p.plan_id === d.rutina.plan_activo_id);
  activo.dias[0].nombre = "EMPUJE";
  Object.assign(activo.dias[0].ejercicios[0], { nombre: "PRESS BANCA C/BARRA", grupo_muscular: "Pecho", series_objetivo: 4, reps_objetivo: "6-8", rir_objetivo: 2 });
  return d;
}

(async () => {
  const srv = await servir(RAIZ);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: "es-AR", timezoneId: "America/Argentina/Buenos_Aires" });
  const errores = [];
  const supabase = [];
  page.on("pageerror", (e) => errores.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errores.push(m.text()); });
  page.on("request", (q) => { if (/supabase\.co/.test(q.url())) supabase.push(q.url()); });
  page.on("dialog", (d) => d.accept());
  await page.clock.install({ time: new Date(AHORA) });
  await page.clock.pauseAt(new Date(AHORA));
  const inicial = datos();
  await page.addInitScript((d) => { if (!sessionStorage.getItem("sembrado")) { localStorage.setItem("gymNutritionTracker", d); sessionStorage.setItem("sembrado", "1"); } }, JSON.stringify(inicial));
  await page.goto("http://127.0.0.1:" + srv.address().port + "/index.html");
  await seguirSinCuenta(page);

  const r = [];
  const check = (nombre, ok, detalle) => r.push({ nombre, ok: !!ok, detalle });
  const leer = () => page.evaluate(() => JSON.parse(localStorage.getItem("gymNutritionTracker")));
  const nuevas = async () => (await leer()).sesiones_entrenamiento.filter((s) => !inicial.sesiones_entrenamiento.some((o) => o.id === s.id));

  try {
    /* 1. Sesión nueva de gimnasio desde la UI. */
    await page.click("#nav-entrenar");
    await page.selectOption("#select-dia-rutina", "D1");
    const card = '.ejercicio-entrenar-card[data-ejercicio-id="D1-e1"]';
    await page.fill(card + " .input-serie-peso >> nth=0", "60");
    await page.fill(card + " .input-serie-reps >> nth=0", "8");
    await page.fill("#input-duracion", "60");
    await page.click('[data-accion="set-rpe"][data-valor="8"]');
    await page.click('[data-accion="guardar-sesion"]');
    let creadas = await nuevas();
    check("se guardó 1 sesión nueva", creadas.length === 1, creadas.length);
    const s = creadas[0];
    check("plan_id = plan_activo_id", s.plan_id === inicial.rutina.plan_activo_id, s.plan_id);
    check("plan_id va después de tipo", JSON.stringify(Object.keys(s).slice(0, 5)) === JSON.stringify(["id", "fecha", "tipo", "plan_id", "dia_rutina_id"]), Object.keys(s));
    const snap = s.ejercicios_realizados[0].prescripcion_snapshot;
    check("snapshot de PRESS BANCA 4 × 6-8 RIR 2", JSON.stringify(snap) === JSON.stringify({ nombre: "PRESS BANCA C/BARRA", grupo_muscular: "Pecho", series_objetivo: 4, reps_objetivo: "6-8", rir_objetivo: 2, rpe_objetivo: null, peso_objetivo: null, pausa: null }), snap);
    check("todos los ejercicios realizados con snapshot", s.ejercicios_realizados.every((er) => er.prescripcion_snapshot && Object.keys(er.prescripcion_snapshot).length === 8));
    check("sesiones anteriores intactas", JSON.stringify((await leer()).sesiones_entrenamiento.filter((x) => x.id !== s.id)) === JSON.stringify(inicial.sesiones_entrenamiento));
    const snapTexto = JSON.stringify(s.ejercicios_realizados);

    /* 2. Sesión de fútbol: sin plan_id ni snapshot. */
    await page.click('[data-accion="set-tipo"][data-tipo="futbol"]');
    await page.fill("#input-duracion", "90");
    await page.click('[data-accion="set-rpe"][data-valor="7"]');
    await page.click('[data-accion="guardar-sesion"]');
    creadas = await nuevas();
    const futbol = creadas.find((x) => x.tipo === "futbol");
    check("fútbol guardado sin plan_id ni snapshot", futbol && !("plan_id" in futbol) && JSON.stringify(futbol.ejercicios_realizados) === "[]", futbol);

    /* 3. Cambiar el plan desde Rutina: 3 × 10-12, RIR 3 (RIR no tiene UI: vía GYMAPP.planes). */
    await page.click("#btn-rutina");
    const fila = '.ejercicio-row[data-dia-id="D1"][data-ejercicio-id="D1-e1"]';
    await page.fill(fila + " .input-ejercicio-series", "3");
    await page.dispatchEvent(fila + " .input-ejercicio-series", "change");
    await page.fill(fila + " .input-ejercicio-reps", "10-12");
    await page.dispatchEvent(fila + " .input-ejercicio-reps", "change");
    await page.evaluate(() => GYMAPP.storage.updateData((d) => { GYMAPP.planes.buscarEjercicioEnDiaActivo(d, "D1", "D1-e1").rir_objetivo = 3; }, { alertaAutomatica: false }));
    const plan = (await leer()).rutina.planes.find((p) => p.plan_id === inicial.rutina.plan_activo_id).dias[0].ejercicios[0];
    check("el plan cambió a 3 × 10-12 RIR 3", plan.series_objetivo === 3 && plan.reps_objetivo === "10-12" && plan.rir_objetivo === 3, plan);
    const trasCambio = (await leer()).sesiones_entrenamiento.find((x) => x.id === s.id);
    check("la sesión conserva 4 × 6-8 RIR 2 (byte a byte)", JSON.stringify(trasCambio.ejercicios_realizados) === snapTexto);

    /* 4. Editar la sesión: muestra lo prescripto en su momento y conserva el vínculo. */
    await page.click("#nav-entrenar");
    await page.click('[data-accion="editar-sesion"][data-sesion-id="' + s.id + '"]');
    const encabezado = await page.$eval('.ejercicio-entrenar-card[data-ejercicio-id="D1-e1"] .ejercicio-entrenar-header', (h) => h.textContent);
    check("edición muestra 'PRESS BANCA C/BARRA' y '4 × 6-8' (snapshot, no el plan nuevo)", encabezado.includes("PRESS BANCA C/BARRA") && encabezado.includes("4 × 6-8"), encabezado);
    await page.fill('.ejercicio-entrenar-card[data-ejercicio-id="D1-e1"] .input-serie-reps >> nth=0', "7");
    await page.fill("#input-notas", "editada");
    await page.dispatchEvent("#input-notas", "input");
    await page.click('[data-accion="guardar-sesion"]');
    const editada = (await leer()).sesiones_entrenamiento.find((x) => x.id === s.id);
    check("edición: reps actualizadas", editada.ejercicios_realizados[0].series[0].reps === 7, editada.ejercicios_realizados[0].series);
    check("edición: conserva plan_id", editada.plan_id === s.plan_id);
    check("edición: snapshot byte a byte", JSON.stringify(editada.ejercicios_realizados.map((er) => er.prescripcion_snapshot)) === JSON.stringify(s.ejercicios_realizados.map((er) => er.prescripcion_snapshot)));
    check("edición: mismo orden de claves", JSON.stringify(Object.keys(editada)) === JSON.stringify(Object.keys(s)));

    /* 5. Editar una sesión ANTERIOR a E5 no le agrega nada. */
    const vieja = inicial.sesiones_entrenamiento.find((x) => x.dia_rutina_id === "mu4c87ep2snsau");
    await page.click('[data-accion="editar-sesion"][data-sesion-id="' + vieja.id + '"]');
    await page.click('[data-accion="guardar-sesion"]');
    const viejaGuardada = (await leer()).sesiones_entrenamiento.find((x) => x.id === vieja.id);
    check("sesión vieja editada: sin plan_id ni snapshot", !("plan_id" in viejaGuardada) && viejaGuardada.ejercicios_realizados.every((er) => !("prescripcion_snapshot" in er)));
    const d = await leer();
    check("schema 3 y datos válidos", d.schema_version === 3 && (await page.evaluate((x) => GYMAPP.storage.validarDatosV3(x), d)) === null);
    check("plan histórico intacto", JSON.stringify(d.rutina.planes[0]) === JSON.stringify(inicial.rutina.planes[0]));
    check("plan_activo_id intacto", d.rutina.plan_activo_id === inicial.rutina.plan_activo_id);

    check("sin errores de consola", errores.length === 0, errores);
    check("sin requests a Supabase", supabase.length === 0, supabase);
  } finally {
    await browser.close();
    srv.close();
  }
  r.forEach((x) => console.log((x.ok ? "ok   " : "FALLA") + " - " + x.nombre + (x.ok ? "" : " → " + JSON.stringify(x.detalle))));
  const fallas = r.filter((x) => !x.ok).length;
  console.log("# e2e sesión-plan: " + (r.length - fallas) + "/" + r.length + " ok");
  process.exit(fallas ? 1 : 0);
})();
