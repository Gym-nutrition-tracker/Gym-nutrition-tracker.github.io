/* E2E de E6.1: reasignar una sesión de gimnasio a otro plan desde Entrenar
   (Chromium/Playwright, 390 px y 320 px).
   Uso: PLAYWRIGHT_PATH=$(npm root -g)/playwright node tests/e2e/reasignar-sesion.e2e.js
   CAPTURAS_DIR=/ruta guarda capturas. */
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const { seguirSinCuenta } = require("./acceso-helper");
const { aE3 } = require("../entorno");
const { datasetHistoricos } = require("../fixtures/historicos-dataset");

const RAIZ = path.join(__dirname, "..", "..");
const AHORA = "2026-11-09T18:00:00";
const TIPOS = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".woff2": "font/woff2" };
const CAPTURAS = process.env.CAPTURAS_DIR || null;
const PRE = "gymNutritionTracker_preReasignarSesion";

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

/* Plan A con EMPUJE de 3 ejercicios (nombres de ejemplo). */
function datosIniciales() {
  const d = aE3(datasetHistoricos({ legacy: true }));
  d.usuario.actividades = [{ tipo: "gimnasio", meta_semanal: 5 }, { tipo: "futbol", meta_semanal: 2 }];
  const a = d.rutina.planes.find((p) => p.plan_id === d.rutina.plan_activo_id);
  a.dias[0].nombre = "EMPUJE";
  Object.assign(a.dias[0].ejercicios[0], { nombre: "PRESS INCLINADO EN SMITH", series_objetivo: 4, reps_objetivo: "8-10" });
  Object.assign(a.dias[0].ejercicios[1], { nombre: "PRESS MILITAR C/MANCUERNAS SENTADO", series_objetivo: 3, reps_objetivo: "8-12" });
  a.dias[0].ejercicios.push(Object.assign(JSON.parse(JSON.stringify(a.dias[0].ejercicios[1])), { id: "D1-e3", nombre: "FONDOS", orden: 3 }));
  d.sesiones_entrenamiento.push({ id: "F", fecha: "2026-11-08T20:00:00.000Z", tipo: "futbol", dia_rutina_id: null, duracion_min: 90, rpe: 7, notas: "", ejercicios_realizados: [], futbol_detalle: null, detalle: { tipo_sesion: "partido", posicion: "", minutos_jugados: 90 } });
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
  await page.addInitScript((d) => { if (!sessionStorage.getItem("sembrado")) { localStorage.setItem("gymNutritionTracker", d); sessionStorage.setItem("sembrado", "1"); } }, JSON.stringify(datosIniciales()));
  await page.goto("http://127.0.0.1:" + srv.address().port + "/index.html");
  await seguirSinCuenta(page);

  /* Sesión S guardada bajo A (E5) y DESPUÉS se activa el plan B (E6). */
  await page.evaluate(() => {
    const P = GYMAPP.planes;
    const v = P.vincularSesionAlPlanActivo(GYMAPP.storage.getData(), { id: "S", fecha: "2026-11-09T14:00:00.000Z", tipo: "gimnasio", dia_rutina_id: "D1", duracion_min: 75, rpe: 8, notas: "hoy con el plan nuevo",
      ejercicios_realizados: [
        { ejercicio_id: "D1-e1", series: [{ peso_kg: 40, reps: 8 }, { peso_kg: 42.5, reps: 8 }] },
        { ejercicio_id: "D1-e2", series: [{ peso_kg: 14, reps: 10 }] },
        { ejercicio_id: "D1-e3", series: [{ peso_kg: 0, reps: 8 }] }
      ], futbol_detalle: null });
    GYMAPP.storage.updateData((x) => { x.sesiones_entrenamiento.push(v.sesion); }, { alertaAutomatica: false });
    const texto = ["EMPUJE", "Press Inclinado en Smith 4x8 RIR 1-2 RPE 8", "Press militar arrodillado con mancuernas 3x10 RIR 2 RPE 8", "Fondos en paralelas 4x6-8 RIR 1-2 RPE 9", "TRACCIÓN", "Dominadas toma neutra 4x6-8"].join("\n");
    const b = GYMAPP.pdfImport.normalizarPlanParseado(GYMAPP.pdfImport.parsearPlanDesdeTexto(texto));
    b.nombre = "Plan N.º 5 (prueba)";
    const p = P.prepararCambioDePlan(GYMAPP.storage.getData(), b, { ahora: "2026-11-09T17:00:00.000Z", nombreArchivo: "b.pdf" });
    GYMAPP.storage.guardarConCopiaPrevia("gymNutritionTracker_preCambioPlan", p.datos, "2026-11-09T17:00:00.000Z");
  });
  await page.reload();
  await seguirSinCuenta(page);

  const r = [];
  const check = (nombre, ok, detalle) => r.push({ nombre, ok: !!ok, detalle });
  const foto = async (n, selector) => {
    if (!CAPTURAS) return;
    if (selector) await page.$eval(selector, (el) => el.scrollIntoView({ block: "start" }));
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(CAPTURAS, n + ".png"), animations: "disabled", caret: "hide" });
  };
  const leer = () => page.evaluate(() => JSON.parse(localStorage.getItem("gymNutritionTracker")));
  const almacenado = () => page.evaluate(() => JSON.stringify(Object.keys(localStorage).sort().map((k) => [k, localStorage.getItem(k)])));
  const texto = (sel) => page.$eval(sel, (n) => n.textContent.trim());
  const sinScrollHorizontal = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

  try {
    const inicial = await leer();
    const S0 = inicial.sesiones_entrenamiento.find((s) => s.id === "S");
    const planB = inicial.rutina.planes.find((p) => p.plan_id === inicial.rutina.plan_activo_id);
    const diaB = planB.dias[0];
    const [inc, mil, fon] = diaB.ejercicios.map((x) => x.id);
    check("escenario: S quedó vinculada al plan anterior", S0.plan_id !== planB.plan_id && S0.dia_rutina_id === "D1");

    await page.click("#nav-entrenar");
    /* 1. Solo gimnasio muestra la acción. */
    await page.click('[data-accion="editar-sesion"][data-sesion-id="F"]');
    check("fútbol: sin 'Reasignar a otro plan'", (await page.$('[data-accion="reasignar-sesion"]')) === null);
    await page.click('[data-accion="cancelar-edicion"]');
    await page.click('[data-accion="editar-sesion"][data-sesion-id="S"]');
    check("gimnasio: botón 'Reasignar a otro plan'", (await texto('[data-accion="reasignar-sesion"]')) === "Reasignar a otro plan");
    await foto("01-edicion-con-boton", ".pantalla-entrenar");

    /* 2. Panel: plan activo por defecto, día y sugerencias. */
    const S1 = await almacenado();
    await page.click('[data-accion="reasignar-sesion"]');
    check("panel abierto", (await texto("#reasig-titulo")) === "Reasignar sesión");
    check("foco en el plan", await page.evaluate(() => document.activeElement && document.activeElement.id === "reasig-plan"));
    const planes = await page.$$eval("#reasig-plan option", (o) => o.map((x) => x.textContent));
    check("planes: activo primero + históricos", planes[0] === "Plan N.º 5 (prueba) (activo)" && planes.includes("Plan anterior (reconstruido)") && planes.length === 3, planes);
    check("día sugerido: EMPUJE del plan activo", (await page.$eval("#reasig-dia", (s) => s.value)) === diaB.id);
    const valores = await page.$$eval("[data-reasig-orig]", (s) => s.map((x) => x.value));
    check("nombre exacto preseleccionado; distintos sin sugerencia", JSON.stringify(valores) === JSON.stringify([inc, "", ""]), valores);
    check("opciones: elegir, ejercicios del día y 'No corresponde'", JSON.stringify(await page.$$eval("#reasig-ej-1 option", (o) => o.map((x) => x.textContent))) ===
      JSON.stringify(["Elegí el ejercicio correspondiente", "Press Inclinado en Smith", "Press militar arrodillado con mancuernas", "Fondos en paralelas", "No corresponde a ningún ejercicio"]));
    check("resumen De/A y 1 de 3 vinculados", /De: Plan sin nombre · EMPUJE/.test(await texto(".reasig-resumen")) && /A: Plan N\.º 5 \(prueba\) \(activo\) · EMPUJE/.test(await texto(".reasig-resumen")) && /1 de 3 vinculados/.test(await texto(".reasig-resumen")), await texto(".reasig-resumen"));
    check("aviso: los datos de ejecución no se modifican", /Tus pesos, repeticiones y demás datos de ejecución no se modificarán\./.test(await texto(".reasig-resumen")));
    check("labels reales", await page.evaluate(() => Array.from(document.querySelectorAll("#entrenar-modal select")).every((s) => !!document.querySelector('label[for="' + s.id + '"]'))));
    check("sin scroll horizontal a 390 px", await sinScrollHorizontal());
    await foto("02-panel-inicial");

    /* 3. Bloqueos: sin mapear, duplicado, "no corresponde". 0 escrituras. */
    await page.click('[data-accion="reasig-confirmar"]');
    check("sin mapear → error y foco en el primer select inválido", /Elegí el ejercicio correspondiente/.test(await texto("#reasig-ej-1-error")) &&
      await page.evaluate(() => document.activeElement && document.activeElement.id === "reasig-ej-1"));
    await page.selectOption("#reasig-ej-1", inc);
    check("duplicado → 'Este ejercicio del plan destino ya está asignado.'", (await texto("#reasig-ej-1-error")) === "Este ejercicio del plan destino ya está asignado.");
    await page.selectOption("#reasig-ej-2", "__ninguno__");
    check("'No corresponde' → bloqueo con el mensaje pedido", /Para reasignar la sesión, todos los ejercicios realizados deben vincularse con un ejercicio del plan destino\./.test(await texto("#reasig-errores")));
    await foto("03-bloqueos");
    await page.click('[data-accion="reasig-confirmar"]');
    check("bloqueado: 0 escrituras", (await almacenado()) === S1);

    /* 4. Mapeo manual completo y confirmación. */
    await page.selectOption("#reasig-ej-1", mil);
    await page.selectOption("#reasig-ej-2", fon);
    check("3 de 3 vinculados", /3 de 3 vinculados/.test(await texto(".reasig-resumen")));
    await foto("04-mapeo-completo", ".reasig-resumen");
    const datosAntes = await page.evaluate(() => localStorage.getItem("gymNutritionTracker"));
    await page.click('[data-accion="reasig-confirmar"]');
    await page.waitForSelector("#entrenar-modal .modal", { state: "detached" });
    const d = await leer();
    const S = d.sesiones_entrenamiento.find((s) => s.id === "S");
    const pre = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)), PRE);
    check("copia preReasignarSesion con el texto anterior y sesion_id", pre && pre.data_raw === datosAntes && pre.sesion_id === "S" && !!pre.fecha);
    check("plan_id, día y ejercicios del plan B", S.plan_id === planB.plan_id && S.dia_rutina_id === diaB.id && JSON.stringify(S.ejercicios_realizados.map((x) => x.ejercicio_id)) === JSON.stringify([inc, mil, fon]));
    check("snapshots de B", S.ejercicios_realizados[1].prescripcion_snapshot.nombre === "Press militar arrodillado con mancuernas" && S.ejercicios_realizados[1].prescripcion_snapshot.reps_objetivo === "10");
    check("ejecución byte a byte (series, pesos, reps)", JSON.stringify(S.ejercicios_realizados.map((x) => x.series)) === JSON.stringify(S0.ejercicios_realizados.map((x) => x.series)));
    check("id, fecha, tipo, duración, RPE y notas intactos", ["id", "fecha", "tipo", "duracion_min", "rpe", "notas"].every((k) => S[k] === S0[k]));
    check("ninguna otra sesión cambió", JSON.stringify(d.sesiones_entrenamiento.filter((s) => s.id !== "S")) === JSON.stringify(inicial.sesiones_entrenamiento.filter((s) => s.id !== "S")));
    check("planes y plan_activo_id intactos; schema 3; sin rutina.dias", JSON.stringify(d.rutina) === JSON.stringify(inicial.rutina) && d.schema_version === 3 && !("dias" in d.rutina));
    check("mensaje de éxito", /Sesión reasignada a Plan N\.º 5 \(prueba\) \(activo\) · EMPUJE/.test(await texto("#entrenar-mensaje")));
    check("historial: la sesión aparece una sola vez", (await page.$$('.historial-item[data-sesion-id="S"]')).length === 1);
    await foto("05-historial-despues");

    /* 5. Abrirla otra vez: nuevo plan/día/prescripción, mismos datos. */
    await page.click('[data-accion="editar-sesion"][data-sesion-id="S"]');
    const encabezados = await page.$$eval(".ejercicio-entrenar-card .ejercicio-entrenar-header", (h) => h.map((x) => x.textContent));
    check("edición: ejercicios y prescripción de B", encabezados[0].includes("Press Inclinado en Smith") && encabezados[0].includes("4 × 8") && encabezados[2].includes("Fondos en paralelas"), encabezados);
    check("edición: mismos pesos", (await page.$eval('.ejercicio-entrenar-card[data-ejercicio-id="' + inc + '"] .input-serie-peso >> nth=1', (i) => i.value).catch(() => page.$$eval('.ejercicio-entrenar-card[data-ejercicio-id="' + inc + '"] .input-serie-peso', (i) => i[1].value))) === "42,5");
    await foto("06-edicion-despues", ".pantalla-entrenar");

    /* 6. Escape y click afuera cierran sin escribir. 320 px. */
    const S2 = await almacenado();
    await page.click('[data-accion="reasignar-sesion"]');
    await page.keyboard.press("Escape");
    check("Escape cierra el panel y devuelve el foco", (await page.$("#entrenar-modal .modal")) === null && await page.evaluate(() => document.activeElement && document.activeElement.dataset.accion === "reasignar-sesion"));
    await page.setViewportSize({ width: 320, height: 640 });
    await page.click('[data-accion="reasignar-sesion"]');
    check("sin scroll horizontal a 320 px", await sinScrollHorizontal());
    await page.mouse.click(160, 10);
    check("click afuera cierra", (await page.$("#entrenar-modal .modal")) === null);
    check("abrir/cerrar no escribe nada", (await almacenado()) === S2);

    check("sin errores de consola", errores.length === 0, errores);
    check("sin requests a Supabase", supabase.length === 0, supabase);
  } finally {
    await browser.close();
    srv.close();
  }
  r.forEach((x) => console.log((x.ok ? "ok   " : "FALLA") + " - " + x.nombre + (x.ok ? "" : " → " + JSON.stringify(x.detalle))));
  const fallas = r.filter((x) => !x.ok).length;
  console.log("# e2e reasignar-sesion: " + (r.length - fallas) + "/" + r.length + " ok");
  process.exit(fallas ? 1 : 0);
})();
