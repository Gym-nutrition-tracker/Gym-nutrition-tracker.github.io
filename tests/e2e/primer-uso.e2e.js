/* E2E de ONB-03: primer uso guiado (Chromium/Playwright, 390 px y 320 px).
   Usuario nuevo sin plan, con plan y sin sesiones, con 1 sesión y usuario
   existente con historial. Uso:
     PLAYWRIGHT_PATH=$(npm root -g)/playwright node tests/e2e/primer-uso.e2e.js
   CAPTURAS_DIR=/ruta guarda las capturas de cada estado.
   BASE_DIR=/ruta/version_base compara el HTML del usuario existente contra
   esa versión (solo Rutina puede cambiar, y solo por los dos agregados). */
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const { seguirSinCuenta } = require("./acceso-helper");
const { crearEntorno, aE3, clonar } = require("../entorno");
const { datasetHistoricos } = require("../fixtures/historicos-dataset");
const { crearPdf, LINEAS_PLAN_EJEMPLO } = require("../fixtures/pdf-sintetico");

const RAIZ = path.join(__dirname, "..", "..");
const AHORA = "2026-11-09T12:00:00";
const CLAVE = "gymNutritionTracker";
const TIPOS = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".woff2": "font/woff2" };
const CAPTURAS = process.env.CAPTURAS_DIR || null;
const BASE = process.env.BASE_DIR || null;

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

/* Datos de cada escenario (schema 3). El usuario nuevo ya completó el
   formulario de perfil (onboarding.js) y no tiene nada más. */
const historial = () => aE3(datasetHistoricos({ legacy: true }));
function nuevo() {
  const d = clonar(crearEntorno({ sinSync: true }).GYMAPP.storage.getDefaultData());
  d.usuario = Object.assign(clonar(historial().usuario), { nombre: "Ana" });
  return d;
}
function conPlan() { const d = historial(); d.sesiones_entrenamiento = []; return d; }
function unaSesion() { const d = historial(); d.sesiones_entrenamiento = d.sesiones_entrenamiento.slice(0, 1); return d; }

(async () => {
  const srvNuevo = await servir(RAIZ);
  const srvBase = BASE ? await servir(BASE) : null;
  const browser = await chromium.launch();
  const r = [];
  const errores = [];
  const supabase = [];
  const check = (nombre, ok, detalle) => r.push({ nombre, ok: !!ok, detalle });

  async function abrir(datos, opciones) {
    opciones = opciones || {};
    const ctx = await browser.newContext({ viewport: { width: opciones.ancho || 390, height: 844 }, locale: "es-AR", timezoneId: "America/Argentina/Buenos_Aires" });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errores.push(e.message));
    page.on("console", (m) => { if (m.type() === "error") errores.push(m.text()); });
    page.on("request", (q) => { if (/supabase\.co/.test(q.url())) supabase.push(q.url()); });
    page.dialogos = [];
    page.on("dialog", (d) => { page.dialogos.push(d.message()); d.accept(); });
    await page.clock.install({ time: new Date(AHORA) });
    await page.clock.pauseAt(new Date(AHORA));
    await page.addInitScript((d) => { if (!sessionStorage.getItem("sembrado")) { localStorage.setItem("gymNutritionTracker", d); sessionStorage.setItem("sembrado", "1"); } }, JSON.stringify(datos));
    await page.goto("http://127.0.0.1:" + (opciones.srv || srvNuevo).address().port + "/index.html");
    await seguirSinCuenta(page);
    page.leer = () => page.evaluate((k) => JSON.parse(localStorage.getItem(k)), CLAVE);
    page.texto = (sel) => page.$eval(sel, (n) => n.textContent.replace(/\s+/g, " ").trim());
    page.hay = async (sel) => (await page.$(sel)) !== null;
    page.sinScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    page.foto = async (n) => {
      if (!CAPTURAS) return;
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: path.join(CAPTURAS, n + ".png"), animations: "disabled", caret: "hide" });
    };
    page.cerrarCtx = () => ctx.close();
    return page;
  }

  try {
    /* ---------- A. Usuario nuevo sin plan (390 px) ---------- */
    const semilla = nuevo();
    let p = await abrir(semilla);

    /* Tour automático. */
    check("A. tour automático para usuario nuevo", await p.hay("#guia-inicio .guia-tarjeta"));
    check("A. tour: role=dialog y aria-modal", await p.$eval(".guia-tarjeta", (n) => n.getAttribute("role") === "dialog" && n.getAttribute("aria-modal") === "true"));
    check("A. tour paso 1: Rutina", (await p.texto("#guia-titulo")) === "Rutina" && /Paso 1 de 4/.test(await p.texto(".guia-paso")));
    check("A. tour paso 1 resalta el botón de Rutina", await p.$eval("#btn-rutina", (n) => n.classList.contains("guia-objetivo")));
    check("A. tour paso 1 sin 'Atrás', con 'Omitir' y 'Siguiente'", !(await p.hay('[data-guia="atras"]')) && (await p.hay('[data-guia="omitir"]')) && (await p.hay('[data-guia="siguiente"]')));
    check("A. foco en 'Siguiente'", await p.evaluate(() => document.activeElement && document.activeElement.dataset.guia === "siguiente"));
    check("A. abrir el tour no escribe datos", JSON.stringify(await p.leer()) === JSON.stringify(semilla));
    check("A. tour sin scroll horizontal (390)", await p.sinScroll());
    await p.foto("04-tour-paso-1");
    await p.click('[data-guia="siguiente"]');
    check("A. tour paso 2: Entrenar", (await p.texto("#guia-titulo")) === "Entrenar" && (await p.$eval("#nav-entrenar", (n) => n.classList.contains("guia-objetivo"))));
    check("A. paso 2 tiene 'Atrás'", await p.hay('[data-guia="atras"]'));
    await p.foto("05-tour-paso-2");
    await p.click('[data-guia="atras"]');
    check("A. 'Atrás' vuelve al paso 1", (await p.texto("#guia-titulo")) === "Rutina");
    await p.click('[data-guia="siguiente"]');
    await p.click('[data-guia="siguiente"]');
    check("A. tour paso 3: Progreso", (await p.texto("#guia-titulo")) === "Progreso" && (await p.$eval("#nav-progreso", (n) => n.classList.contains("guia-objetivo"))));
    check("A. un solo objetivo resaltado", (await p.$$(".guia-objetivo")).length === 1);
    await p.foto("06-tour-paso-3");
    await p.click('[data-guia="siguiente"]');
    check("A. tour paso 4: Nutrición (opcional)", (await p.texto("#guia-titulo")) === "Nutrición (opcional)" && /Paso 4 de 4/.test(await p.texto(".guia-paso")));
    check("A. paso 4: 'Listo' y sin 'Siguiente' ni 'Omitir'", (await p.hay('[data-guia="listo"]')) && !(await p.hay('[data-guia="siguiente"]')) && !(await p.hay('[data-guia="omitir"]')));
    await p.foto("07-tour-paso-4");
    await p.click('[data-guia="listo"]');
    check("A. 'Listo' cierra el tour y lo saca del DOM", !(await p.hay("#guia-inicio")) && !(await p.hay(".guia-objetivo")) && !(await p.evaluate(() => document.body.classList.contains("guia-activa"))));
    let guardado = await p.leer();
    check("A. completar guarda onboarding {version:1, completado:true}", JSON.stringify(guardado.onboarding) === JSON.stringify({ version: 1, completado: true }), guardado.onboarding);
    const sinFlag = clonar(guardado); delete sinFlag.onboarding;
    check("A. completar solo agrega onboarding (schema 3, resto intacto)", guardado.schema_version === 3 && JSON.stringify(sinFlag) === JSON.stringify(semilla));

    /* Dashboard sin plan. */
    check("A. Dashboard: 'Empezá configurando tu entrenamiento'", (await p.texto("#primer-uso-titulo")) === "Empezá configurando tu entrenamiento");
    check("A. Dashboard: tarjeta arriba de todo (sin saludo duplicado)", await p.evaluate(() => {
      const c = document.querySelector(".primer-uso-card");
      return !!c && c.parentElement.classList.contains("pantalla-dashboard") && c.previousElementSibling === null && !document.querySelector("#tab-content h1");
    }));
    check("A. Dashboard: 3 pasos", (await p.$$eval(".primer-uso-pasos li", (l) => l.map((x) => x.textContent))).join("|") === "Cargá tu plan|Registrá tu primer entrenamiento|Seguimos tu progreso automáticamente");
    check("A. Dashboard: CTA 'Importar plan desde PDF'", (await p.texto('[data-accion="inicio-importar-pdf"]')) === "Importar plan desde PDF");
    check("A. Dashboard: CTA 'Crear plan manualmente'", (await p.texto('[data-accion="inicio-crear-plan"]')) === "Crear plan manualmente");
    check("A. Dashboard: Nutrición marcada como opcional", /Nutrición es opcional/.test(await p.texto(".primer-uso-card")));
    check("A. Dashboard sin scroll horizontal (390)", await p.sinScroll());
    await p.foto("02-dashboard-cta-inicial");

    /* CTA importar PDF → selector de archivos del importador E6 existente. */
    let chooser = p.waitForEvent("filechooser", { timeout: 3000 }).catch(() => null);
    await p.click('[data-accion="inicio-importar-pdf"]');
    chooser = await chooser;
    check("A. 'Importar plan desde PDF' abre el selector del importador existente", !!chooser && (await chooser.element().evaluate((n) => n.id)) === "input-pdf-rutina");
    check("A. … y lleva a Rutina", await p.hay(".rutina-vacia"));
    check("A. abrir el importador no escribe datos", JSON.stringify(await p.leer()) === JSON.stringify(guardado));

    /* Rutina vacía: una sola acción principal, "Cargar mi plan". */
    check("A. Rutina vacía: 'No tenés un plan cargado'", (await p.texto("#rutina-vacia-titulo")) === "No tenés un plan cargado");
    check("A. Rutina vacía: texto de ayuda", /Podés importar el PDF de tu entrenador o crear tu rutina manualmente\./.test(await p.texto(".rutina-vacia")));
    check("A. Rutina vacía: un solo botón, 'Cargar mi plan'", (await p.$$eval(".rutina-vacia button", (b) => b.map((x) => x.textContent))).join("|") === "Cargar mi plan");
    /* Zona del plan (encabezado, tarjeta y días); "Iniciar sesión" de la
       sección Cuenta, al pie, no compite con esta acción. */
    const primarios = await p.$$eval(".rutina-header .btn-primario, .plan-activo-card .btn-primario, .rutina-dias .btn-primario", (b) => b.map((x) => x.textContent));
    check("A. Rutina vacía: un solo botón primario en la zona del plan", primarios.join("|") === "Cargar mi plan", primarios);
    check("A. Rutina vacía: la tarjeta del plan no repite 'Cargar / cambiar plan'", !(await p.hay(".plan-activo-card .plan-cargar")));
    check("A. Rutina: 'Ver guía de inicio' disponible", await p.isVisible('[data-accion="ver-guia"]'));
    check("A. Rutina vacía sin scroll horizontal (390)", await p.sinScroll());
    await p.foto("03-rutina-vacia");

    /* Cargar mi plan → selector existente: Importar desde PDF / Crear manualmente. */
    await p.click('.rutina-vacia [data-accion="cargar-plan"]');
    check("A. 'Cargar mi plan' abre las 2 opciones", (await p.texto("#modal-titulo")) === "Cargar mi plan" &&
      (await p.$$eval(".cargar-plan-opcion strong", (l) => l.map((x) => x.textContent))).join("|") === "Importar desde PDF|Crear manualmente");
    check("A. modal de opciones sin scroll horizontal", await p.sinScroll());
    await p.foto("03b-rutina-vacia-opciones");
    await p.keyboard.press("Escape");
    check("A. Escape cierra las opciones", !(await p.hay(".modal")));
    await p.click('.rutina-vacia [data-accion="cargar-plan"]');
    chooser = p.waitForEvent("filechooser", { timeout: 3000 }).catch(() => null);
    await p.click('[data-accion="cargar-plan-pdf"]');
    check("A. opción 'Importar desde PDF' abre el importador existente", !!(await chooser) && !(await p.hay(".modal")));
    check("A. abrir opciones e importador no escribe datos", JSON.stringify(await p.leer()) === JSON.stringify(guardado));

    /* Entrenar sin plan. */
    await p.click("#nav-entrenar");
    check("A. Entrenar sin plan: 'Primero necesitás cargar un plan.'", /Primero necesitás cargar un plan\./.test(await p.texto(".pantalla-entrenar .primer-uso-aviso")));
    check("A. Entrenar sin plan: sin 'Guardar sesión' ni errores técnicos", !(await p.hay('[data-accion="guardar-sesion"]')) && !/plan_activo_id|schema|undefined|null/.test(await p.texto(".pantalla-entrenar")));
    check("A. Entrenar sin plan sin scroll horizontal (390)", await p.sinScroll());
    await p.foto("01-usuario-nuevo-sin-plan-entrenar");
    await p.click('.pantalla-entrenar [data-accion="inicio-ir-rutina"]');
    check("A. 'Cargar mi plan' lleva a Rutina", await p.hay(".rutina-vacia"));

    /* Progreso sin plan. */
    await p.click("#nav-progreso");
    check("A. Progreso sin plan: aviso con 'Cargar mi plan'", (await p.hay('.primer-uso-aviso [data-accion="inicio-ir-rutina"]')));

    /* Crear plan manualmente → editor existente (crea el primer día como '+ Nuevo día'). */
    await p.click("#nav-dashboard");
    await p.click('[data-accion="inicio-crear-plan"]');
    guardado = await p.leer();
    const diasCreados = guardado.rutina.planes.find((x) => x.plan_id === guardado.rutina.plan_activo_id).dias;
    check("A. 'Crear plan manualmente' abre el editor con el primer día", diasCreados.length === 1 && diasCreados[0].nombre === "Día 1" && (await p.evaluate(() => document.activeElement && document.activeElement.classList.contains("input-nombre-dia"))));
    check("A. crear manual no toca sesiones ni crea planes", guardado.sesiones_entrenamiento.length === 0 && guardado.rutina.planes.length === 1 && guardado.schema_version === 3);
    check("A. un día sin ejercicios sigue siendo 'sin plan' (Rutina sin estado vacío, Dashboard igual)", !(await p.hay(".rutina-vacia")));
    await p.click('[data-accion="cargar-plan"]');
    check("A. con días: tarjeta con 'Cargar / cambiar plan' y opciones 'Crear / editar manualmente'", (await p.texto("#modal-titulo")) === "Cargar / cambiar plan" &&
      (await p.$$eval(".cargar-plan-opcion strong", (l) => l.map((x) => x.textContent))).join("|") === "Importar desde PDF|Crear / editar manualmente");
    await p.click('[data-accion="cargar-plan-manual"]');
    check("A. opción 'Crear / editar manualmente' lleva al editor (no crea otro día)", !(await p.hay(".modal")) && (await p.leer()).rutina.planes[0].dias.length === 1 &&
      (await p.evaluate(() => document.activeElement && document.activeElement.classList.contains("input-nombre-dia"))));

    /* Recarga: no reaparece. */
    await p.reload();
    await seguirSinCuenta(p);
    check("A. después de completarlo no reaparece al recargar", !(await p.hay("#guia-inicio")));
    await p.click("#btn-rutina");
    await p.click('[data-accion="ver-guia"]');
    check("A. 'Ver guía de inicio' lo reabre en el paso 1", (await p.hay("#guia-inicio")) && (await p.texto("#guia-titulo")) === "Rutina");
    await p.keyboard.press("Escape");
    check("A. Escape cierra el tour", !(await p.hay("#guia-inicio")));
    check("A. foco vuelve a 'Ver guía de inicio'", await p.evaluate(() => document.activeElement && document.activeElement.dataset.accion === "ver-guia"));
    await p.cerrarCtx();

    /* Omitir en el primer uso. */
    p = await abrir(nuevo());
    await p.click('[data-guia="omitir"]');
    check("A. 'Omitir' cierra y guarda completado", !(await p.hay("#guia-inicio")) && (await p.leer()).onboarding.completado === true);
    await p.reload();
    await seguirSinCuenta(p);
    check("A. después de omitir no reaparece", !(await p.hay("#guia-inicio")));
    await p.cerrarCtx();

    /* Navegación no bloqueada: con el tour abierto la barra sigue usable. */
    p = await abrir(nuevo());
    await p.click("#nav-progreso");
    check("A. con el tour abierto se puede navegar (no bloquea)", await p.hay(".primer-uso-aviso"));
    await p.cerrarCtx();

    /* ---------- F. Primer PDF real por la UI: sin histórico vacío ---------- */
    p = await abrir(nuevo());
    await p.click('[data-guia="omitir"]');
    await p.click("#btn-rutina");
    const antesF = await p.leer();
    const subir = (nombre, lineas) => p.setInputFiles("#input-pdf-rutina", { name: nombre, mimeType: "application/pdf", buffer: crearPdf(lineas) });
    await subir("plan-ejemplo.pdf", LINEAS_PLAN_EJEMPLO);
    await p.waitForSelector(".modal-revision");
    check("F. revisión: avisa que el plan actual vacío no va al historial", /Plan actual: no tiene ejercicios, no se guarda en el historial/.test(await p.texto(".rev-resumen")) && !/será archivado/.test(await p.texto(".rev-resumen")));
    await p.click('[data-accion="rev-activar"]');
    await p.waitForSelector(".modal-revision", { state: "detached" });
    check("F. confirmación sin 'pasará al historial'", p.dialogos.some((m) => /no tiene ejercicios: no se guarda en el historial/.test(m)) && !p.dialogos.some((m) => /pasará al historial/.test(m)), p.dialogos);
    check("F. mensaje 'Nuevo plan activado.' sin mencionar el historial", (await p.texto("#rutina-mensaje")) === "Nuevo plan activado.");
    const f1 = await p.leer();
    const primerPlan = f1.rutina.planes[0];
    check("F. primer PDF: rutina.planes contiene solo el nuevo plan", f1.rutina.planes.length === 1 && f1.rutina.plan_activo_id === primerPlan.plan_id && primerPlan.origen === "pdf");
    check("F. primer PDF: version_de = null", primerPlan.version_de === null);
    check("F. primer PDF: sesiones intactas y schema 3", JSON.stringify(f1.sesiones_entrenamiento) === JSON.stringify(antesF.sesiones_entrenamiento) && f1.schema_version === 3);
    await p.click('[data-accion="historial-planes"]');
    check("F. Historial de planes sin 'Plan sin nombre · 0 días'", /Todavía no hay planes anteriores\./.test(await p.texto(".modal")) && !/0 días/.test(await p.texto(".modal")));
    await p.foto("11-historial-tras-primer-pdf");
    await p.keyboard.press("Escape");
    p.dialogos.length = 0;
    await subir("plan-segundo.pdf", ["TRACCIÓN", "Dominadas toma neutra 4x6-8 RIR 1-2 RPE 9"]);
    await p.waitForSelector(".modal-revision");
    check("F. segundo PDF: la revisión anuncia que el primero se archiva", /Plan actual que será archivado/.test(await p.texto(".rev-resumen")));
    await p.click('[data-accion="rev-activar"]');
    await p.waitForSelector(".modal-revision", { state: "detached" });
    check("F. segundo PDF: confirmación de E6 sin cambios", p.dialogos.some((m) => /El plan actual pasará al historial\./.test(m)));
    const f2 = await p.leer();
    const segundoPlan = f2.rutina.planes[1];
    check("F. segundo PDF: el primero se archiva y version_de apunta a él", f2.rutina.planes.length === 2 && f2.rutina.planes[0].plan_id === primerPlan.plan_id && !!f2.rutina.planes[0].archivado_en && segundoPlan.version_de === primerPlan.plan_id && f2.rutina.plan_activo_id === segundoPlan.plan_id);
    await p.click('[data-accion="historial-planes"]');
    check("F. Historial muestra el primer plan", (await p.$$(".modal .plan-historico-card")).length === 1 && (await p.$eval(".modal .plan-historico-card .plan-nombre", (n) => n.textContent)) === primerPlan.nombre);
    await p.cerrarCtx();

    /* ---------- B. Plan cargado, 0 sesiones ---------- */
    const semillaB = conPlan();
    p = await abrir(semillaB);
    check("B. plan sin uso: el tour todavía aparece (no completado)", await p.hay("#guia-inicio"));
    await p.click('[data-guia="omitir"]');
    check("B. Dashboard: 'Tu plan ya está listo'", (await p.texto("#primer-uso-titulo")) === "Tu plan ya está listo");
    check("B. Dashboard: CTA 'Registrar primer entrenamiento'", (await p.texto('[data-accion="inicio-entrenar"]')) === "Registrar primer entrenamiento");
    check("B. Dashboard: sin CTAs de importar", !(await p.hay('[data-accion="inicio-importar-pdf"]')));
    await p.foto("08-plan-sin-sesiones");
    /* #tab-content es compartido entre pestañas: después de visitarlas todas,
       un CTA de primer uso tiene que ejecutarse UNA sola vez. */
    for (const t of ["entrenar", "progreso", "nutricion", "dashboard"]) await p.click("#nav-" + t);
    await p.evaluate(() => { const o = GYMAPP.app.irA; window.__irA = 0; GYMAPP.app.irA = function () { window.__irA++; return o.apply(this, arguments); }; });
    await p.click('[data-accion="inicio-entrenar"]');
    check("B. el CTA navega una sola vez aunque se hayan visitado todas las pestañas", (await p.evaluate(() => window.__irA)) === 1, await p.evaluate(() => window.__irA));
    check("B. CTA lleva a Entrenar con el flujo normal", (await p.hay(".pantalla-entrenar")) && (await p.hay('[data-accion="guardar-sesion"]')) && !(await p.hay(".pantalla-entrenar .primer-uso-aviso")));
    check("B. Entrenar normal: selector de día del plan", (await p.$$eval(".pantalla-entrenar select option", (o) => o.length)) > 1);
    await p.click("#nav-progreso");
    check("B. Progreso 0 sesiones: mensaje", /Tu progreso aparecerá después de registrar tu primer entrenamiento\./.test(await p.texto(".primer-uso-aviso")));
    check("B. Progreso 0 sesiones: CTA 'Ir a Entrenar'", (await p.texto('.primer-uso-aviso [data-accion="inicio-entrenar"]')) === "Ir a Entrenar");
    check("B. Progreso sin scroll horizontal (390)", await p.sinScroll());
    await p.foto("09-progreso-0-sesiones");
    await p.click('.primer-uso-aviso [data-accion="inicio-entrenar"]');
    check("B. 'Ir a Entrenar' navega a Entrenar (una sola vez)", (await p.hay('[data-accion="guardar-sesion"]')) && (await p.evaluate(() => window.__irA)) === 2);
    await p.click("#btn-rutina");
    check("B. Rutina con plan: CTA 'Cargar / cambiar plan' en la tarjeta", await p.isVisible('.plan-activo-card [data-accion="cargar-plan"]'));
    check("B. Rutina con plan: sin estado vacío", !(await p.hay(".rutina-vacia")));
    const finB = await p.leer();
    check("B. planes y sesiones intactos", JSON.stringify(finB.rutina) === JSON.stringify(semillaB.rutina) && JSON.stringify(finB.sesiones_entrenamiento) === JSON.stringify(semillaB.sesiones_entrenamiento));
    await p.cerrarCtx();

    /* ---------- C. Una sola sesión ---------- */
    p = await abrir(unaSesion());
    check("C. 1 sesión: sin tour automático", !(await p.hay("#guia-inicio")));
    check("C. 1 sesión: sin tarjeta grande en Dashboard", !(await p.hay(".primer-uso-card")));
    await p.click("#nav-progreso");
    check("C. Progreso 1 sesión: mensaje de primera sesión", /Ya registraste tu primera sesión\. Vas a empezar a ver comparaciones cuando repitas ejercicios\./.test(await p.texto(".primer-uso-aviso")));
    check("C. el mensaje no tiene botones", (await p.$$(".primer-uso-aviso button")).length === 0);
    await p.cerrarCtx();

    /* ---------- D. Usuario existente con historial (sin flag) ---------- */
    const semillaD = historial();
    p = await abrir(semillaD);
    check("D. existente: sin tour automático", !(await p.hay("#guia-inicio")));
    check("D. existente: sin tarjeta grande", !(await p.hay(".primer-uso-card")));
    const html = {};
    for (const t of ["dashboard", "entrenar", "progreso", "nutricion"]) { await p.click("#nav-" + t); html[t] = await p.$eval("#tab-content", (n) => n.innerHTML); }
    check("D. existente: Progreso sin avisos de primer uso", !/primer-uso-aviso/.test(html.progreso));
    check("D. existente: Entrenar normal", /guardar-sesion/.test(html.entrenar) && !/primer-uso-aviso/.test(html.entrenar));
    await p.click("#btn-rutina");
    html.rutina = await p.$eval("#tab-content", (n) => n.innerHTML);
    check("D. recorrer todo no escribe datos", JSON.stringify(await p.leer()) === JSON.stringify(semillaD));
    await p.foto("10-usuario-existente");
    await p.click('[data-accion="ver-guia"]');
    check("D. 'Ver guía de inicio' lo abre a mano", (await p.hay("#guia-inicio")) && (await p.texto("#guia-titulo")) === "Rutina");
    await p.click('[data-guia="omitir"]');
    const finD = await p.leer();
    const finDSinFlag = clonar(finD); delete finDSinFlag.onboarding;
    check("D. cerrar la guía manual solo agrega onboarding", finD.onboarding.completado === true && JSON.stringify(finDSinFlag) === JSON.stringify(semillaD));
    await p.cerrarCtx();

    if (srvBase) {
      const b = await abrir(semillaD, { srv: srvBase });
      const base = {};
      for (const t of ["dashboard", "entrenar", "progreso", "nutricion"]) { await b.click("#nav-" + t); base[t] = await b.$eval("#tab-content", (n) => n.innerHTML); }
      await b.click("#btn-rutina");
      base.rutina = await b.$eval("#tab-content", (n) => n.innerHTML);
      await b.cerrarCtx();
      ["dashboard", "entrenar", "progreso", "nutricion"].forEach((t) => check("D. HTML idéntico a la base: " + t, html[t] === base[t]));
      const p2 = await abrir(semillaD);
      await p2.click("#btn-rutina");
      const rutinaSinAgregados = await p2.evaluate(() => {
        const c = document.getElementById("tab-content").cloneNode(true);
        c.querySelectorAll(".plan-cargar, .seccion-ayuda").forEach((n) => n.remove());
        return c.innerHTML;
      });
      await p2.cerrarCtx();
      /* Base que ya incluye ONB-03 (por ejemplo, HEAD): Rutina completa
         idéntica. Base anterior: idéntica salvo los dos agregados. */
      if (/plan-cargar/.test(base.rutina)) check("D. Rutina idéntica a la base (ya con ONB-03)", html.rutina === base.rutina);
      else check("D. Rutina idéntica a la base salvo 'Cargar / cambiar plan' y 'Ver guía de inicio'", rutinaSinAgregados === base.rutina);
    }

    /* ---------- E. 320 px ---------- */
    p = await abrir(nuevo(), { ancho: 320 });
    check("E. 320: tour sin scroll horizontal", await p.sinScroll());
    const tarjetaDentro = await p.$eval(".guia-tarjeta", (n) => { const r = n.getBoundingClientRect(); return r.left >= 0 && r.right <= window.innerWidth; });
    check("E. 320: tarjeta del tour dentro de la pantalla", tarjetaDentro);
    for (let i = 0; i < 3; i++) await p.click('[data-guia="siguiente"]');
    check("E. 320: paso 4 sin scroll horizontal", await p.sinScroll());
    await p.click('[data-guia="listo"]');
    check("E. 320: Dashboard con CTA sin scroll horizontal", await p.sinScroll());
    await p.foto("e320-dashboard");
    await p.click("#btn-rutina");
    check("E. 320: Rutina vacía sin scroll horizontal", await p.sinScroll());
    await p.click('[data-accion="cargar-plan"]');
    check("E. 320: opciones de carga sin scroll horizontal", await p.sinScroll());
    await p.keyboard.press("Escape");
    await p.click("#nav-entrenar");
    check("E. 320: Entrenar sin plan sin scroll horizontal", await p.sinScroll());
    await p.click("#nav-progreso");
    check("E. 320: Progreso sin plan sin scroll horizontal", await p.sinScroll());
    await p.cerrarCtx();
    p = await abrir(conPlan(), { ancho: 320 });
    await p.click('[data-guia="omitir"]');
    check("E. 320: 'Tu plan ya está listo' sin scroll horizontal", await p.sinScroll());
    await p.click("#nav-progreso");
    check("E. 320: Progreso 0 sesiones sin scroll horizontal", await p.sinScroll());
    await p.cerrarCtx();
  } catch (err) {
    check("excepción en el e2e", false, err.message);
  }

  check("sin errores de consola", errores.length === 0, errores);
  check("sin requests a Supabase", supabase.length === 0, supabase);
  await browser.close();
  srvNuevo.close();
  if (srvBase) srvBase.close();
  r.forEach((x) => console.log((x.ok ? "ok    - " : "FALLA - ") + x.nombre + (x.ok ? "" : " → " + JSON.stringify(x.detalle))));
  const ok = r.filter((x) => x.ok).length;
  console.log("# e2e primer-uso: " + ok + "/" + r.length + " ok");
  process.exit(ok === r.length ? 0 : 1);
})();
