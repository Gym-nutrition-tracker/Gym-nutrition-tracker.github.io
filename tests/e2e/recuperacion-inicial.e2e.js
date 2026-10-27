/* E2E de la recuperación inicial (Chromium/Playwright, 390 px y 320 px):
   usuario con copia en la nube que entra con local vacío (otro navegador,
   dispositivo o dominio) → "Encontramos tus datos" → Recuperar → Dashboard;
   usuario nuevo → onboarding; "Empezar de cero" → onboarding con la nube
   intacta. Supabase simulado: solo lectura de datos_usuario; cualquier RPC
   se registra como escritura (y no debe ocurrir). Datos de ejemplo
   sintéticos. Uso:
     PLAYWRIGHT_PATH=$(npm root -g)/playwright node tests/e2e/recuperacion-inicial.e2e.js
   CAPTURAS_DIR=/ruta guarda capturas. */
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const { aE3, clonar } = require("../entorno");
const { datasetHistoricos } = require("../fixtures/historicos-dataset");

const RAIZ = path.join(__dirname, "..", "..");
const AHORA = "2026-10-27T12:00:00";
const CLAVE = "gymNutritionTracker";
const TIPOS = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".woff2": "font/woff2" };
const CAPTURAS = process.env.CAPTURAS_DIR || null;

/* SDK falso (misma forma que supabase-js v2 para lo que usan auth.js y
   sync.js). Config en localStorage "__fakeSupabase"; llamadas en
   sessionStorage "__fakeLlamadas" (sobreviven a la vuelta de Google). */
const SDK_FALSO = `
window.supabase = { createClient: function (url, key, opts) {
  var cfg = JSON.parse(localStorage.getItem("__fakeSupabase") || "{}");
  var almacen = opts.auth.storage, clave = opts.auth.storageKey, oyentes = [];
  function registrar(nombre, p) { var l = JSON.parse(sessionStorage.getItem("__fakeLlamadas") || "[]"); l.push([nombre, p]); sessionStorage.setItem("__fakeLlamadas", JSON.stringify(l)); }
  function emitir(ev, s) { oyentes.forEach(function (f) { f(ev, s); }); }
  function sesion(id, email, proveedor) { return { access_token: "acc-" + id, refresh_token: "ref-" + id, expires_at: 4102444800, user: { id: id, email: email, app_metadata: { provider: proveedor } } }; }
  function guardar(s) { almacen.setItem(clave, JSON.stringify(s)); }
  function leer() { var v = almacen.getItem(clave); return v ? JSON.parse(v) : null; }
  var m = /#fake_oauth=([^:]+):(.+)$/.exec(location.hash);
  if (m) { guardar(sesion(m[1], decodeURIComponent(m[2]), "google")); history.replaceState(null, "", location.pathname); setTimeout(function () { emitir("SIGNED_IN", leer()); }, 0); }
  return { auth: {
    onAuthStateChange: function (f) { oyentes.push(f); return { data: { subscription: { unsubscribe: function () {} } } }; },
    getSession: function () { return Promise.resolve({ data: { session: leer() }, error: null }); },
    signInWithPassword: function (p) {
      registrar("signInWithPassword", { email: p.email });
      var s = sesion("uid-ana", p.email, "email"); guardar(s); setTimeout(function () { emitir("SIGNED_IN", s); }, 0);
      return Promise.resolve({ data: { session: s }, error: null });
    },
    signUp: function (p) { var s = sesion("uid-nuevo", p.email, "email"); guardar(s); setTimeout(function () { emitir("SIGNED_IN", s); }, 0); return Promise.resolve({ data: { session: s }, error: null }); },
    signOut: function () { almacen.removeItem(clave); setTimeout(function () { emitir("SIGNED_OUT", null); }, 0); return Promise.resolve({ error: null }); },
    signInWithOAuth: function (p) {
      registrar("signInWithOAuth", p.provider);
      setTimeout(function () { location.assign(location.pathname + "?vuelta=1#fake_oauth=" + cfg.oauth); }, 30);
      return Promise.resolve({ data: { provider: p.provider, url: "https://proyecto.supabase.co/auth/v1/authorize" }, error: null });
    }
  },
  from: function (tabla) { return { select: function (cols) { return { maybeSingle: function () {
    registrar("select", tabla);
    return Promise.resolve({ data: cfg.filaNube || null, error: null });
  } }; } }; },
  rpc: function (nombre, params) { registrar("rpc", nombre); return Promise.resolve({ data: null, error: { message: "escritura no permitida en este e2e" } }); },
  storage: { from: function () { return { createSignedUrl: function () { return Promise.resolve({ data: null, error: { message: "Object not found" } }); } }; } } };
} };`;

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

/* Copia en la nube de ejemplo (dataset sintético, sin datos personales). */
function filaNube(schema) {
  const data = aE3(datasetHistoricos({ legacy: true }));
  data.usuario.nombre = "Ana";
  data.medidas_corporales = [{ fecha: "2026-10-20", peso_kg: 74.5, cintura_cm: 81 }];
  if (schema) data.schema_version = schema;
  return { data, schema_version: schema || 3, revision: 7, updated_at: "2026-10-26T21:30:00Z" };
}

(async () => {
  const srv = await servir(RAIZ);
  const base = "http://127.0.0.1:" + srv.address().port + "/index.html";
  const browser = await chromium.launch();
  const r = [];
  const errores = [];
  const red = [];
  const check = (nombre, ok, detalle) => r.push({ nombre, ok: !!ok, detalle });

  async function abrir(semilla, ancho) {
    const ctx = await browser.newContext({ viewport: { width: ancho || 390, height: 844 }, locale: "es-AR", timezoneId: "America/Argentina/Buenos_Aires" });
    const p = await ctx.newPage();
    p.on("pageerror", (e) => errores.push(e.message));
    p.on("console", (m) => { if (m.type() === "error") errores.push(m.text()); });
    p.on("request", (q) => { if (/supabase\.co/.test(q.url())) red.push(q.url()); });
    p.on("dialog", (d) => { errores.push("diálogo inesperado: " + d.message()); d.dismiss(); });
    await p.route("**/vendor/supabase/supabase.js", (ruta) => ruta.fulfill({ status: 200, contentType: "text/javascript", body: SDK_FALSO }));
    await p.clock.install({ time: new Date(AHORA) });
    await p.addInitScript((s) => {
      if (sessionStorage.getItem("sembrado")) return;
      if (s.datos) localStorage.setItem("gymNutritionTracker", JSON.stringify(s.datos));
      localStorage.setItem("__fakeSupabase", JSON.stringify(s.config || {}));
      sessionStorage.setItem("sembrado", "1");
      new MutationObserver(() => {
        if (document.querySelector("#form-onboarding")) sessionStorage.setItem("vioPerfil", "1");
        if (document.querySelector(".pantalla-recuperacion")) sessionStorage.setItem("vioRecuperacion", "1");
      }).observe(document, { childList: true, subtree: true });
    }, semilla || {});
    await p.goto(base);
    p.ctx = ctx;
    p.texto = (sel) => p.$eval(sel, (n) => n.innerText.replace(/\s+/g, " ").trim());
    p.hay = async (sel) => (await p.$(sel)) !== null;
    p.llamadas = () => p.evaluate(() => JSON.parse(sessionStorage.getItem("__fakeLlamadas") || "[]"));
    p.flag = (k) => p.evaluate((c) => sessionStorage.getItem(c) === "1", k);
    p.local = () => p.evaluate((k) => JSON.parse(localStorage.getItem(k) || "null"), CLAVE);
    p.sinScroll = () => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    p.foto = async (n) => {
      if (!CAPTURAS) return;
      await p.evaluate(() => document.fonts.ready);
      await p.screenshot({ path: path.join(CAPTURAS, n + ".png"), animations: "disabled", caret: "hide" });
    };
    return p;
  }
  async function loginEmail(p) {
    await p.waitForSelector(".pantalla-acceso");
    await p.fill("#input-email-cuenta", "ana@test.com");
    await p.fill("#input-password-cuenta", "correcta");
    await p.click('[data-accion="iniciar-sesion"]');
  }
  const rpcs = async (p) => (await p.llamadas()).filter((l) => l[0] === "rpc");
  const selects = async (p) => (await p.llamadas()).filter((l) => l[0] === "select");

  try {
    /* ---------- A. Usuario existente (email) + local vacío + copia en la nube ---------- */
    const fila = filaNube();
    let p = await abrir({ config: { filaNube: fila } });
    await loginEmail(p);
    await p.waitForSelector(".pantalla-recuperacion");
    const pantalla = await p.texto(".pantalla-recuperacion");
    check("A. email: 'Encontramos tus datos' antes del perfil", /Encontramos tus datos/.test(pantalla) && /Ya tenés una copia guardada en la nube\./.test(pantalla), pantalla);
    check("A. muestra 'Recuperar mis datos' y 'Empezar de cero'", (await p.hay('[data-accion="recuperacion-recuperar"]')) && (await p.hay('[data-accion="recuperacion-cero"]')));
    check("A. resumen de la copia (perfil, sesiones, fecha)", /Perfil de Ana/.test(pantalla) && /sesiones registradas/.test(pantalla) && /Última actualización/.test(pantalla), pantalla);
    check("A. nunca se mostró el formulario de perfil (sin perfil de relleno)", !(await p.flag("vioPerfil")));
    check("A. antes de decidir: un SELECT a datos_usuario y 0 RPC", (await selects(p)).length === 1 && (await selects(p))[0][1] === "datos_usuario" && (await rpcs(p)).length === 0, await p.llamadas());
    check("A. antes de decidir: no se escribió el perfil local", !((await p.local()) || {}).usuario);
    check("A. 390: sin scroll horizontal", await p.sinScroll());
    await p.foto("01-encontramos-tus-datos-390");
    await p.click('[data-accion="recuperacion-recuperar"]');
    await p.waitForSelector(".app-shell");
    check("A. recuperar → Dashboard con 'Hola, Ana'", /Hola, Ana/.test(await p.texto(".app-header")));
    const local = await p.local();
    check("A. perfil, planes, sesiones y medidas restaurados", local.usuario.nombre === "Ana" && JSON.stringify(local.rutina) === JSON.stringify(fila.data.rutina) &&
      local.sesiones_entrenamiento.length === fila.data.sesiones_entrenamiento.length && local.medidas_corporales[0].peso_kg === 74.5);
    const meta = await p.evaluate(() => JSON.parse(localStorage.getItem("gymNutritionTracker_syncMeta")));
    check("A. baseline de sincronización = revisión 7 de uid-ana", meta && meta.user_id === "uid-ana" && meta.last_known_revision === 7, meta);
    check("A. recuperar no escribió en la nube (0 RPC)", (await rpcs(p)).length === 0);
    check("A. nunca se mostró el formulario de perfil", !(await p.flag("vioPerfil")));
    check("A. schema_version 3", local.schema_version === 3);
    await p.foto("02-dashboard-restaurado");
    await p.click("#nav-progreso");
    check("A. Progreso abre con el historial restaurado", await p.hay(".progreso-analisis-semanal, .progreso-panel"));
    await p.ctx.close();

    /* ---------- A'. Mismo caso entrando con Google ---------- */
    p = await abrir({ config: { filaNube: fila, oauth: "uid-ana:ana%40test.com" } });
    await p.waitForSelector(".pantalla-acceso");
    await p.click('[data-accion="acceso-google"]');
    await p.waitForSelector(".pantalla-recuperacion");
    check("A'. Google: misma pantalla 'Encontramos tus datos'", /Encontramos tus datos/.test(await p.texto(".pantalla-recuperacion")));
    check("A'. Google: 0 RPC antes de decidir", (await rpcs(p)).length === 0);
    await p.click('[data-accion="recuperacion-recuperar"]');
    await p.waitForSelector(".app-shell");
    check("A'. Google: recuperar → Dashboard 'Hola, Ana'", /Hola, Ana/.test(await p.texto(".app-header")));
    await p.ctx.close();

    /* ---------- B. Usuario nuevo: sin copia → onboarding directo ---------- */
    p = await abrir({ config: {} });
    await loginEmail(p);
    await p.waitForSelector("#form-onboarding");
    check("B. sin copia en la nube → onboarding de perfil", await p.hay("#form-onboarding"));
    check("B. no mostró 'Encontramos tus datos'", !(await p.flag("vioRecuperacion")));
    check("B. solo lectura (1 SELECT, 0 RPC)", (await selects(p)).length === 1 && (await rpcs(p)).length === 0);
    await p.ctx.close();

    /* ---------- C. Usuario existente elige empezar de cero ---------- */
    p = await abrir({ config: { filaNube: fila } }, 320);
    await loginEmail(p);
    await p.waitForSelector(".pantalla-recuperacion");
    check("C. 320: sin scroll horizontal", await p.sinScroll());
    await p.foto("03-encontramos-320");
    await p.click('[data-accion="recuperacion-cero"]');
    const conf = await p.texto(".pantalla-recuperacion");
    check("C. confirmación: 'Ya existe una copia en la nube. Si continuás, todavía no la vamos a reemplazar.'", /Ya existe una copia en la nube\. Si continuás, todavía no la vamos a reemplazar\./.test(conf), conf);
    await p.foto("04-empezar-de-cero-320");
    await p.click('[data-accion="recuperacion-volver"]');
    check("C. 'Volver' regresa a 'Encontramos tus datos'", /Encontramos tus datos/.test(await p.texto(".pantalla-recuperacion")));
    await p.click('[data-accion="recuperacion-cero"]');
    await p.click('[data-accion="recuperacion-continuar-cero"]');
    await p.waitForSelector("#form-onboarding");
    check("C. 'Continuar sin recuperar' → onboarding", await p.hay("#form-onboarding"));
    check("C. la nube queda intacta (0 RPC)", (await rpcs(p)).length === 0);
    check("C. no se restauró nada local", !((await p.local()) || {}).usuario && !(await p.evaluate(() => localStorage.getItem("gymNutritionTracker_syncMeta"))));
    await p.ctx.close();

    /* ---------- Versión futura: recuperación bloqueada ---------- */
    p = await abrir({ config: { filaNube: filaNube(99) } });
    await loginEmail(p);
    await p.waitForSelector(".pantalla-recuperacion");
    const bloq = await p.texto(".pantalla-recuperacion");
    check("Futura: mensaje seguro y sin botón de recuperar", /versión más nueva de esta app/.test(bloq) && /Actualizá la app/.test(bloq) && !(await p.hay('[data-accion="recuperacion-recuperar"]')), bloq);
    check("Futura: 0 RPC y nada local", (await rpcs(p)).length === 0 && !((await p.local()) || {}).usuario);
    await p.ctx.close();

    /* ---------- Sin cuenta: no se consulta la nube ---------- */
    p = await abrir({ config: { filaNube: fila } });
    await p.waitForSelector(".pantalla-acceso");
    await p.click('[data-accion="acceso-sin-cuenta"]');
    await p.waitForSelector("#form-onboarding");
    check("Sin cuenta: onboarding como siempre", await p.hay("#form-onboarding"));
    check("Sin cuenta: ninguna consulta a datos_usuario", (await selects(p)).length === 0 && !(await p.flag("vioRecuperacion")));
    await p.ctx.close();

    /* ---------- Con datos locales: se entra directo, sin consultar ---------- */
    const conDatos = clonar(fila.data);
    conDatos.usuario.nombre = "Local";
    p = await abrir({ datos: conDatos, config: { filaNube: fila } });
    await loginEmail(p);
    await p.waitForSelector(".app-shell");
    check("Con datos locales: shell directo ('Hola, Local')", /Hola, Local/.test(await p.texto(".app-header")));
    check("Con datos locales: sin pantalla de recuperación ni consulta", !(await p.flag("vioRecuperacion")) && (await selects(p)).length === 0);
    await p.ctx.close();

    /* ---------- Plan útil = definición central (al menos un ejercicio) ---------- */
    const conDias = (dias) => { const d = clonar(fila.data); d.usuario = null; d.sesiones_entrenamiento = []; d.registros_nutricion = []; d.medidas_corporales = []; d.base_alimentos = [];
      d.rutina = { plan_activo_id: "p1", planes: [Object.assign({}, fila.data.rutina.planes[0], { plan_id: "p1", archivado_en: null, dias })] }; return d; };
    p = await abrir({ datos: conDias([1, 2, 3].map((i) => ({ id: "d" + i, nombre: "Día " + i, orden: i, ejercicios: [] }))), config: { filaNube: fila } });
    await loginEmail(p);
    await p.waitForSelector(".pantalla-recuperacion");
    check("Plan con días vacíos + copia en la nube → 'Encontramos tus datos'", /Encontramos tus datos/.test(await p.texto(".pantalla-recuperacion")));
    await p.ctx.close();
    p = await abrir({ datos: conDias([{ id: "d1", nombre: "Día 1", orden: 1, ejercicios: [{ id: "e1", nombre: "PRESS BANCA C/BARRA", series_objetivo: 4, reps_objetivo: "8" }] }]), config: { filaNube: fila } });
    await loginEmail(p);
    await p.waitForSelector("#form-onboarding");
    check("Plan con 1 ejercicio (sin perfil) → flujo normal, sin pantalla de recuperación ni consulta", !(await p.flag("vioRecuperacion")) && (await selects(p)).length === 0);
    await p.ctx.close();
  } catch (err) {
    check("excepción en el e2e", false, err.message);
  }

  check("sin errores de consola ni diálogos", errores.length === 0, errores);
  check("sin requests reales a Supabase", red.length === 0, red);
  await browser.close();
  srv.close();
  r.forEach((x) => console.log((x.ok ? "ok    - " : "FALLA - ") + x.nombre + (x.ok ? "" : " → " + JSON.stringify(x.detalle))));
  const ok = r.filter((x) => x.ok).length;
  console.log("# e2e recuperación inicial: " + ok + "/" + r.length + " ok");
  process.exit(ok === r.length ? 0 : 1);
})();
