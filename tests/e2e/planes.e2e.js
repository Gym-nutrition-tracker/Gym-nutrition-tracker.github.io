/* E2E de E4: tarjeta del plan activo, Editar plan e Historial de planes
   (Chromium/Playwright, 390 px). Uso:
     PLAYWRIGHT_PATH=$(npm root -g)/playwright node tests/e2e/planes.e2e.js
   CAPTURAS_DIR=/ruta guarda capturas de cada paso. */
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
const CAPTURAS = process.env.CAPTURAS_DIR || null;

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
  page.on("pageerror", (e) => errores.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errores.push(m.text()); });
  page.on("request", (q) => { if (/supabase\.co/.test(q.url())) supabase.push(q.url()); });
  await page.clock.install({ time: new Date(AHORA) });
  await page.clock.pauseAt(new Date(AHORA));
  /* Estado real de hoy: schema 3 con plan legacy ya persistido (E3). */
  const inicial = aE3(datasetHistoricos({ legacy: true }));
  await page.addInitScript((d) => { if (!sessionStorage.getItem("sembrado")) { localStorage.setItem("gymNutritionTracker", d); sessionStorage.setItem("sembrado", "1"); } }, JSON.stringify(inicial));
  await page.goto("http://127.0.0.1:" + srv.address().port + "/index.html");
  await seguirSinCuenta(page);
  await page.click("#btn-rutina");

  const r = [];
  const check = (nombre, ok, detalle) => r.push({ nombre, ok: !!ok, detalle });
  const foto = async (n) => {
    if (!CAPTURAS) return;
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(CAPTURAS, n + ".png"), animations: "disabled", caret: "hide" });
  };
  const leer = () => page.evaluate(() => JSON.parse(localStorage.getItem("gymNutritionTracker")));
  const texto = (sel) => page.$eval(sel, (n) => n.textContent.trim());
  const sinEscriturasDesde = async (antes) => JSON.stringify(await leer()) === JSON.stringify(antes);

  try {
    /* 1. Tarjeta del plan activo (nombre null, sin fechas). */
    check("tarjeta arriba de los días", await page.evaluate(() => {
      const c = document.querySelector(".plan-activo-card"), d = document.querySelector(".rutina-dias");
      return !!(c && d && (c.compareDocumentPosition(d) & Node.DOCUMENT_POSITION_FOLLOWING));
    }));
    check("etiqueta 'Plan activo'", (await texto(".plan-activo-card .plan-etiqueta")) === "Plan activo");
    check("nombre null → 'Plan actual'", (await texto("#plan-activo-nombre")) === "Plan actual");
    check("sin fechas → 'Sin fechas definidas'", (await texto(".plan-activo-card .plan-vigencia")) === "Sin fechas definidas");
    check("sin línea de semana sin fechas", (await page.$(".plan-activo-card .plan-semana")) === null);
    check("renderizar no escribe datos", await sinEscriturasDesde(inicial));
    const anchoOk = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    check("sin scroll horizontal a 390 px", anchoOk);
    await foto("01-rutina-despues");

    /* 2. Editar plan: modal accesible. */
    await page.click('[data-accion="editar-plan"]');
    check("modal Editar plan abierto", (await texto("#modal-titulo")) === "Editar plan");
    check("modal con role=dialog y aria-modal", await page.$eval(".modal", (m) => m.getAttribute("role") === "dialog" && m.getAttribute("aria-modal") === "true"));
    check("foco en el nombre", await page.evaluate(() => document.activeElement && document.activeElement.id === "plan-nombre"));
    check("labels reales", await page.evaluate(() => ["plan-nombre", "plan-fecha-inicio", "plan-fecha-fin"].every((id) => !!document.querySelector('label[for="' + id + '"]'))));
    check("fechas con input type=date", await page.evaluate(() => document.getElementById("plan-fecha-inicio").type === "date" && document.getElementById("plan-fecha-fin").type === "date"));
    check("el formulario no tiene campos de días/ejercicios", (await page.$$eval("#form-editar-plan input", (i) => i.length)) === 3);
    check("scroll de fondo bloqueado con el modal abierto", await page.evaluate(() => document.body.classList.contains("modal-abierto")));
    await foto("02-modal-editar-plan");

    /* 2a. fin < inicio → error, sin guardar. */
    await page.fill("#plan-fecha-inicio", "2026-12-18");
    await page.fill("#plan-fecha-fin", "2026-10-12");
    await page.click(".btn-guardar-plan");
    check("fin anterior a inicio → error visible", /no puede ser anterior/.test(await texto("#plan-form-error")));
    check("validación fallida no escribe nada", await sinEscriturasDesde(inicial));

    /* 2b. Escape cierra y devuelve el foco. */
    await page.keyboard.press("Escape");
    check("Escape cierra el modal", (await page.$(".modal")) === null);
    check("foco vuelve a 'Editar plan'", await page.evaluate(() => document.activeElement && document.activeElement.dataset.accion === "editar-plan"));
    check("se libera el scroll del fondo", await page.evaluate(() => !document.body.classList.contains("modal-abierto")));
    check("cerrar sin guardar no escribe nada", await sinEscriturasDesde(inicial));

    /* 2c. Guardar nombre y fechas. */
    await page.click('[data-accion="editar-plan"]');
    await page.fill("#plan-nombre", "  Plan N.º 4  ");
    await page.fill("#plan-fecha-inicio", "2026-10-12");
    await page.fill("#plan-fecha-fin", "2026-12-18");
    await page.click(".btn-guardar-plan");
    check("modal cerrado al guardar", (await page.$(".modal")) === null);
    check("mensaje 'Plan actualizado.'", (await texto("#rutina-mensaje")) === "Plan actualizado.");
    check("nombre nuevo en la tarjeta", (await texto("#plan-activo-nombre")) === "Plan N.º 4");
    check("vigencia DD/MM/YYYY – DD/MM/YYYY", (await texto(".plan-activo-card .plan-vigencia")) === "12/10/2026 – 18/12/2026");
    check("semana actual de total (9/11 → Semana 5 de 10)", (await texto(".plan-activo-card .plan-semana")) === "Semana 5 de 10");
    const guardado = await leer();
    const activo = guardado.rutina.planes.find((p) => p.plan_id === guardado.rutina.plan_activo_id);
    const activoAntes = inicial.rutina.planes.find((p) => p.plan_id === inicial.rutina.plan_activo_id);
    check("guarda nombre (sin espacios) y fechas YYYY-MM-DD", activo.nombre === "Plan N.º 4" && activo.fecha_inicio === "2026-10-12" && activo.fecha_fin === "2026-12-18", activo);
    check("días del plan activo intactos", JSON.stringify(activo.dias) === JSON.stringify(activoAntes.dias));
    check("resto del plan activo intacto", JSON.stringify(Object.assign({}, activo, { nombre: null, fecha_inicio: null, fecha_fin: null })) === JSON.stringify(activoAntes));
    check("plan histórico intacto", JSON.stringify(guardado.rutina.planes[0]) === JSON.stringify(inicial.rutina.planes[0]));
    check("sesiones intactas", JSON.stringify(guardado.sesiones_entrenamiento) === JSON.stringify(inicial.sesiones_entrenamiento));
    check("plan_activo_id y schema_version intactos", guardado.rutina.plan_activo_id === inicial.rutina.plan_activo_id && guardado.schema_version === 3);
    check("no crea planes nuevos", guardado.rutina.planes.length === 2);
    const sinMetadata = JSON.parse(JSON.stringify(guardado));
    Object.assign(sinMetadata.rutina.planes[1], { nombre: null, fecha_inicio: null, fecha_fin: null });
    check("solo cambiaron nombre y fechas", JSON.stringify(sinMetadata) === JSON.stringify(inicial));
    await foto("03-rutina-con-plan-editado");

    /* 3. Historial de planes. */
    await page.click('[data-accion="historial-planes"]');
    check("modal Historial de planes", (await texto("#modal-titulo")) === "Historial de planes");
    const tarjetas = await page.$$eval(".plan-historico-card", (cs) => cs.map((c) => c.textContent));
    check("solo planes no activos (1)", tarjetas.length === 1, tarjetas);
    const t = tarjetas[0] || "";
    check("nombre 'Plan anterior (reconstruido)'", t.includes("Plan anterior (reconstruido)"));
    check("Origen: Histórico (sin 'legacy')", t.includes("Origen: Histórico") && !/legacy|backup_legacy/.test(t), t);
    check("vigencia desconocida → 'Sin fechas definidas'", t.includes("Sin fechas definidas"));
    check("5 días · 54 ejercicios · 22 sesiones", t.includes("5 días · 54 ejercicios · 22 sesiones registradas"), t);
    check("actividad observada separada de la vigencia", t.includes("Actividad observada: 15/09/2026 – 15/10/2026"), t);
    check("el plan activo no aparece en el historial", !t.includes("Plan N.º 4"));
    await foto("04-modal-historial-planes");

    /* 4. Ver plan histórico (solo lectura). */
    await page.click('[data-accion="ver-plan"]');
    check("detalle con el nombre del plan", (await texto("#modal-titulo")) === "Plan anterior (reconstruido)");
    check("5 días en acordeón", (await page.$$(".plan-dia")).length === 5);
    check("detalle sin inputs ni botones de edición", (await page.$$eval(".modal input, .modal select, .modal textarea", (x) => x.length)) === 0 &&
      (await page.$$eval(".modal [data-accion]", (bs) => bs.map((b) => b.dataset.accion).filter((a) => !["cerrar-modal", "historial-planes"].includes(a)))).length === 0);
    await page.click(".plan-dia:first-of-type summary");
    const primero = await page.$$eval(".plan-dia:first-of-type .plan-ejercicio", (li) => li.map((x) => Array.from(x.children).map((c) => c.textContent)));
    check("EMPUJE: 12 ejercicios", primero.length === 12, primero.length);
    check("PRESS BANCA C/BARRA · 4 × 6-8 · Pecho", JSON.stringify(primero[4]) === JSON.stringify(["PRESS BANCA C/BARRA", "4 × 6-8", "Pecho"]), primero[4]);
    check("PRESS INCLINADO EN SMITH · 4 × 8-10 · Pecho", JSON.stringify(primero[5]) === JSON.stringify(["PRESS INCLINADO EN SMITH", "4 × 8-10", "Pecho"]), primero[5]);
    const total = await page.$$eval(".plan-ejercicio", (li) => li.length);
    check("54 ejercicios en el detalle", total === 54, total);
    await foto("05-detalle-plan-historico");
    await page.click('.modal [data-accion="historial-planes"]');
    check("volver al historial", (await texto("#modal-titulo")) === "Historial de planes");
    await page.mouse.click(195, 20);
    check("click fuera del modal lo cierra", (await page.$(".modal")) === null);
    check("consultar el historial no escribe nada", JSON.stringify(await leer()) === JSON.stringify(guardado));

    /* 5. Entrenar y Dashboard siguen solo con el plan activo. */
    await page.click("#nav-entrenar");
    const opciones = await page.$$eval("#select-dia-rutina option", (os) => os.map((o) => o.textContent)).catch(() => []);
    check("Entrenar: solo los 5 días del plan activo", JSON.stringify(opciones) === JSON.stringify(["Elegí un día", "Día 1 · Pecho", "Día 2 · Espalda", "Día 3 · Piernas", "Día 4 · Hombros", "Día 5 · Brazos"]), opciones);
    await page.click("#nav-dashboard");
    check("Dashboard sin días del plan histórico", !/EMPUJE|TRACCIÓN|TREN SUPERIOR/.test(await page.$eval("#tab-content", (n) => n.textContent)));

    check("sin errores de consola", errores.length === 0, errores);
    check("sin requests a Supabase", supabase.length === 0, supabase);
  } finally {
    await browser.close();
    srv.close();
  }
  r.forEach((x) => console.log((x.ok ? "ok   " : "FALLA") + " - " + x.nombre + (x.ok ? "" : " → " + JSON.stringify(x.detalle))));
  const fallas = r.filter((x) => !x.ok).length;
  console.log("# e2e planes: " + (r.length - fallas) + "/" + r.length + " ok");
  process.exit(fallas ? 1 : 0);
})();
