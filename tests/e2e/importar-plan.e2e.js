/* E2E de E6: importar un plan desde PDF (pdf.js real + PDF sintético),
   revisar, corregir y activar (Chromium/Playwright, 390 px).
   Uso: PLAYWRIGHT_PATH=$(npm root -g)/playwright node tests/e2e/importar-plan.e2e.js
   CAPTURAS_DIR=/ruta guarda capturas de cada paso. */
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const { aE3 } = require("../entorno");
const { datasetHistoricos } = require("../fixtures/historicos-dataset");
const { crearPdf, LINEAS_PLAN_EJEMPLO } = require("../fixtures/pdf-sintetico");

const RAIZ = path.join(__dirname, "..", "..");
const AHORA = "2026-11-09T12:00:00";
const TIPOS = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".woff2": "font/woff2" };
const CAPTURAS = process.env.CAPTURAS_DIR || null;
const CLAVE = "gymNutritionTracker";
const PRE = "gymNutritionTracker_preCambioPlan";

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
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: "es-AR", timezoneId: "America/Argentina/Buenos_Aires" });
  const errores = [];
  const supabase = [];
  const dialogos = [];
  let respuestaConfirm = true;
  page.on("pageerror", (e) => errores.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Error al importar PDF/.test(m.text())) errores.push(m.text()); });
  page.on("request", (q) => { if (/supabase\.co/.test(q.url())) supabase.push(q.url()); });
  page.on("dialog", (d) => { dialogos.push(d.message()); (respuestaConfirm ? d.accept() : d.dismiss()); });
  await page.clock.install({ time: new Date(AHORA) });
  await page.clock.pauseAt(new Date(AHORA));
  const inicial = aE3(datasetHistoricos({ legacy: true }));
  /* Una sesión E5 bajo el plan activo (A), para verificar que no cambia. */
  await page.addInitScript((d) => { if (!sessionStorage.getItem("sembrado")) { localStorage.setItem("gymNutritionTracker", d); sessionStorage.setItem("sembrado", "1"); } }, JSON.stringify(inicial));
  await page.goto("http://127.0.0.1:" + srv.address().port + "/index.html");
  await page.evaluate(() => {
    const d = GYMAPP.storage.getData();
    const dia = GYMAPP.planes.diasDelPlanActivo(d)[0];
    const v = GYMAPP.planes.vincularSesionAlPlanActivo(d, { id: "sA", fecha: "2026-11-08T15:00:00.000Z", tipo: "gimnasio", dia_rutina_id: dia.id, duracion_min: 60, rpe: 8, notas: "",
      ejercicios_realizados: [{ ejercicio_id: dia.ejercicios[0].id, series: [{ peso_kg: 60, reps: 8 }] }], futbol_detalle: null });
    GYMAPP.storage.updateData((x) => { x.sesiones_entrenamiento.push(v.sesion); }, { alertaAutomatica: false });
  });
  await page.click("#btn-rutina");

  const r = [];
  const check = (nombre, ok, detalle) => r.push({ nombre, ok: !!ok, detalle });
  const foto = async (n, selector) => {
    if (!CAPTURAS) return;
    if (selector) await page.$eval(selector, (el) => el.scrollIntoView({ block: "start" }));
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(CAPTURAS, n + ".png"), animations: "disabled", caret: "hide" });
  };
  const almacenado = () => page.evaluate(() => JSON.stringify(Object.keys(localStorage).sort().map((k) => [k, localStorage.getItem(k)])));
  const texto = (sel) => page.$eval(sel, (n) => n.textContent.trim());
  const subir = (nombre, buffer) => page.setInputFiles("#input-pdf-rutina", { name: nombre, mimeType: "application/pdf", buffer });
  const esperarMensaje = () => page.waitForFunction(() => { const m = document.getElementById("rutina-mensaje"); return m && !m.classList.contains("oculto") && !/Leyendo/.test(m.textContent); });
  const sinScrollHorizontal = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

  try {
    const S0 = await almacenado();
    const datos0 = await page.evaluate(() => localStorage.getItem("gymNutritionTracker"));
    await foto("01-rutina-antes");

    /* 1. Errores de PDF: escaneo, archivo dañado, sin ejercicios. 0 escrituras. */
    await subir("escaneo.pdf", crearPdf([], { sinTexto: true }));
    await esperarMensaje();
    check("PDF sin texto → mensaje de escaneo", (await texto("#rutina-mensaje")) === "No se pudo extraer texto del PDF. Este archivo puede ser una imagen o un escaneo.", await texto("#rutina-mensaje"));
    await foto("02-carga-pdf-escaneado");
    await subir("roto.pdf", Buffer.from("esto no es un pdf"));
    await esperarMensaje();
    check("PDF dañado → no se pudo leer", /^No se pudo leer el PDF/.test(await texto("#rutina-mensaje")), await texto("#rutina-mensaje"));
    await subir("vacio.pdf", crearPdf(["Hola", "Texto sin rutina"]));
    await esperarMensaje();
    check("PDF sin ejercicios → error claro", /No se encontró ningún ejercicio/.test(await texto("#rutina-mensaje")), await texto("#rutina-mensaje"));
    check("errores de PDF: 0 escrituras", (await almacenado()) === S0);

    /* 2. PDF válido → revisión. */
    await subir("plan-ejemplo.pdf", crearPdf(LINEAS_PLAN_EJEMPLO));
    await page.waitForSelector(".modal-revision");
    check("revisión abierta", (await texto("#modal-titulo")) === "Revisar nuevo plan");
    check("foco en el nombre del plan", await page.evaluate(() => document.activeElement && document.activeElement.id === "rev-plan-nombre"));
    const valor = (id) => page.$eval("#" + id, (i) => i.value);
    check("plan: nombre y fechas del documento", (await valor("rev-plan-nombre")) === "Plan de prueba sintético" && (await valor("rev-plan-inicio")) === "2026-10-12" && (await valor("rev-plan-fin")) === "2026-12-18");
    check("ejercicio con RIR 2 y RPE 8 separados", (await valor("rev-d0-e0-rir_objetivo")) === "2" && (await valor("rev-d0-e0-rpe_objetivo")) === "8" && (await valor("rev-d0-e0-pausa")) === "2 min");
    const advertencias = await page.$$eval(".rev-advertencias li", (l) => l.map((x) => x.textContent));
    check("advertencias visibles (línea sin interpretar, grupo, RIR+RPE)", advertencias.some((a) => /Línea sin interpretar/.test(a)) && advertencias.some((a) => /grupo muscular/.test(a)) && advertencias.some((a) => /RIR y RPE/.test(a)), advertencias.length);
    check("RIR + RPE: un solo aviso agregado en la revisión", advertencias.filter((a) => /RIR y RPE simultáneamente/.test(a)).length === 1, advertencias.filter((a) => /RIR y RPE/.test(a)));
    check("labels reales en todos los campos", await page.evaluate(() => Array.from(document.querySelectorAll(".modal-revision input")).every((i) => !!document.querySelector('label[for="' + i.id + '"]'))));
    check("sin scroll horizontal a 390 px", await sinScrollHorizontal());
    await foto("03-revision-plan");
    await foto("04-ejercicio-rir-rpe", '.rev-ejercicio[data-rev-dia="0"][data-rev-ej="0"]');
    await foto("05-advertencias", '.rev-ejercicio[data-rev-dia="0"][data-rev-ej="2"]');

    /* 3. Correcciones en memoria: 0 escrituras. */
    await page.fill("#rev-d0-e1-grupo_muscular", "Pecho");
    await page.fill("#rev-d0-e1-rpe_objetivo", "9");
    await page.click('[data-accion="rev-quitar-ej"][data-rev-dia="0"][data-rev-ej="2"]');
    await page.click('[data-accion="rev-agregar-ej"][data-rev-dia="1"]');
    check("agregar ejercicio enfoca su nombre", await page.evaluate(() => document.activeElement && document.activeElement.id === "rev-d1-e3-nombre"));
    await page.fill("#rev-d1-e3-nombre", "Curl bíceps \"martillo\"");
    await page.fill("#rev-d1-e3-series_objetivo", "3");
    await page.fill("#rev-d1-e3-reps_objetivo", "12");
    await page.click('[data-accion="rev-subir-dia"][data-rev-dia="1"]');
    check("subir día: TRACCIÓN pasa a ser el día 1", (await valor("rev-d0-nombre")) === "DÍA 2 - TRACCIÓN");
    check("comillas en un valor nuevo se conservan (atributo escapado)", (await valor("rev-d0-e3-nombre")) === "Curl bíceps \"martillo\"");
    await page.fill("#rev-d1-nombre", "");
    await page.click('[data-accion="rev-activar"]');
    check("activar con nombre de día vacío → error y no guarda", /Falta el nombre del día/.test(await texto("#rev-errores")) && (await almacenado()) === S0);
    check("foco en el campo con error", await page.evaluate(() => document.activeElement && document.activeElement.id === "rev-d1-nombre"));
    check("error asociado al campo (aria-describedby)", await page.$eval("#rev-d1-nombre", (i) => i.getAttribute("aria-invalid") === "true" && i.getAttribute("aria-describedby") === "rev-d1-nombre-error"));
    await page.fill("#rev-d1-nombre", "EMPUJE (corregido)");
    check("las correcciones no escriben nada", (await almacenado()) === S0);

    /* 4. Cancelar: descarta y 0 escrituras. */
    respuestaConfirm = true;
    await page.click('.modal-revision [data-accion="cerrar-modal"]');
    check("cancelar pide confirmación", dialogos.some((d) => /Descartar la importación/.test(d)));
    check("cancelar cierra la revisión", (await page.$(".modal-revision")) === null);
    check("cancelar: 0 escrituras", (await almacenado()) === S0);

    /* 5. Importar de nuevo y activar. */
    await subir("plan-ejemplo.pdf", crearPdf(LINEAS_PLAN_EJEMPLO));
    await page.waitForSelector(".modal-revision");
    check("re-importar vuelve a la revisión desde cero", (await valor("rev-d0-nombre")) === "DÍA 1 - EMPUJE");
    await page.fill("#rev-plan-nombre", "Plan N.º 5 (prueba)");
    await page.fill("#rev-d0-e1-rir_objetivo", "1-2");
    check("Escape con confirmación negada no cierra", await (async () => { respuestaConfirm = false; await page.keyboard.press("Escape"); respuestaConfirm = true; return (await page.$(".modal-revision")) !== null; })());
    const resumen = await texto(".rev-resumen");
    check("resumen: días, ejercicios, plan a archivar y sesiones", /Nuevo plan: 2 días · 6 ejercicios/.test(resumen) && /Plan actual que será archivado: Plan actual/.test(resumen) && /Sesiones históricas: no se modificarán/.test(resumen), resumen);
    await foto("06-confirmacion-final", ".rev-resumen");
    dialogos.length = 0;
    await page.click('[data-accion="rev-activar"]');
    await page.waitForSelector(".modal-revision", { state: "detached" });
    check("confirmación adicional con el texto pedido", dialogos.some((d) => /El plan actual pasará al historial\. Tus entrenamientos anteriores no se modificarán\./.test(d)), dialogos);
    const d = await page.evaluate(() => JSON.parse(localStorage.getItem("gymNutritionTracker")));
    const antes = JSON.parse(datos0);
    const nuevo = d.rutina.planes[d.rutina.planes.length - 1];
    const anterior = d.rutina.planes.find((p) => p.plan_id === antes.rutina.plan_activo_id);
    check("copia preCambioPlan = texto anterior exacto", JSON.parse(await page.evaluate((k) => localStorage.getItem(k), PRE)).data_raw === datos0);
    check("nuevo plan activo, al final, con version_de del anterior", d.rutina.plan_activo_id === nuevo.plan_id && nuevo.version_de === antes.rutina.plan_activo_id && nuevo.origen === "pdf");
    check("plan anterior archivado en el mismo instante", anterior && anterior.archivado_en && anterior.archivado_en === nuevo.creado_en);
    check("nuevo plan con las correcciones", nuevo.nombre === "Plan N.º 5 (prueba)" && nuevo.dias[0].ejercicios[1].rir_objetivo === "1-2" && nuevo.dias[0].ejercicios[1].rpe_objetivo === 8 && nuevo.fuente.nombre_archivo === "plan-ejemplo.pdf");
    check("sesiones (incluida la E5) byte a byte", JSON.stringify(d.sesiones_entrenamiento) === JSON.stringify(antes.sesiones_entrenamiento));
    check("plan legacy intacto", JSON.stringify(d.rutina.planes[0]) === JSON.stringify(antes.rutina.planes[0]));
    check("schema 3, sin rutina.dias, datos válidos", d.schema_version === 3 && !("dias" in d.rutina) && (await page.evaluate((x) => GYMAPP.storage.validarDatosV3(x), d)) === null);
    check("tarjeta: plan nuevo activo y mensaje", (await texto("#plan-activo-nombre")) === "Plan N.º 5 (prueba)" && /Nuevo plan activado/.test(await texto("#rutina-mensaje")));
    check("Rutina muestra los días del plan nuevo", JSON.stringify(await page.$$eval(".input-nombre-dia", (i) => i.map((x) => x.value))) === JSON.stringify(["DÍA 1 - EMPUJE", "DÍA 2 - TRACCIÓN"]));
    await foto("07-rutina-despues");

    /* 6. Historial de planes. */
    await page.click('[data-accion="historial-planes"]');
    const tarjetas = await page.$$eval(".plan-historico-card .plan-nombre", (n) => n.map((x) => x.textContent));
    check("historial: legacy + plan archivado (el nuevo no)", JSON.stringify(tarjetas) === JSON.stringify(["Plan anterior (reconstruido)", "Plan sin nombre"]), tarjetas);
    await foto("08-historial-planes");
    await page.keyboard.press("Escape");

    /* 7. Entrenar: solo días del plan nuevo; la sesión E5 vieja sigue con su plan. */
    await page.click("#nav-entrenar");
    const opciones = await page.$$eval("#select-dia-rutina option", (o) => o.map((x) => x.textContent));
    check("Entrenar: solo días del plan nuevo", JSON.stringify(opciones) === JSON.stringify(["Elegí un día", "DÍA 1 - EMPUJE", "DÍA 2 - TRACCIÓN"]), opciones);
    const resumenSA = await page.$eval('.historial-item[data-sesion-id="sA"] .historial-item-resumen', (n) => n.textContent);
    check("historial de Entrenar: la sesión E5 sigue con su día del plan anterior", /Día 1 · Pecho/.test(resumenSA), resumenSA);
    await page.selectOption("#select-dia-rutina", { index: 1 });
    await foto("09-entrenar-plan-nuevo");

    /* 8. Mismo PDF otra vez → aviso de coincidencia (sin bloquear). */
    await page.click("#btn-rutina");
    await subir("plan-ejemplo.pdf", crearPdf(LINEAS_PLAN_EJEMPLO));
    await page.waitForSelector(".modal-revision");
    const visible = () => page.$eval(".rev-coincide", (n) => !n.classList.contains("oculto") && n.textContent.includes("Este plan parece coincidir con el plan activo."));
    check("el PDF sin la corrección de RIR no coincide con el activo → sin aviso", !(await visible()));
    await page.fill("#rev-d0-e1-rir_objetivo", "1-2");
    await page.dispatchEvent("#rev-d0-e1-rir_objetivo", "change");
    check("con la misma corrección → 'Este plan parece coincidir con el plan activo.' (sin bloquear)", await visible());
    check("el aviso no deshabilita 'Activar nuevo plan'", await page.$eval('[data-accion="rev-activar"]', (b) => !b.disabled));
    respuestaConfirm = true;
    await page.keyboard.press("Escape");

    /* 9. 320 px sin scroll horizontal en la revisión. */
    await page.setViewportSize({ width: 320, height: 640 });
    await subir("plan-ejemplo.pdf", crearPdf(LINEAS_PLAN_EJEMPLO));
    await page.waitForSelector(".modal-revision");
    check("sin scroll horizontal a 320 px (revisión)", await sinScrollHorizontal());
    await page.keyboard.press("Escape");
    check("sin scroll horizontal a 320 px (Rutina)", await sinScrollHorizontal());

    check("sin errores de consola", errores.length === 0, errores);
    check("sin requests a Supabase", supabase.length === 0, supabase);
  } finally {
    await browser.close();
    srv.close();
  }
  r.forEach((x) => console.log((x.ok ? "ok   " : "FALLA") + " - " + x.nombre + (x.ok ? "" : " → " + JSON.stringify(x.detalle))));
  const fallas = r.filter((x) => !x.ok).length;
  console.log("# e2e importar-plan: " + (r.length - fallas) + "/" + r.length + " ok");
  process.exit(fallas ? 1 : 0);
})();
