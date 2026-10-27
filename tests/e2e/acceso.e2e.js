/* E2E de AUTH-04 (Fase A): pantalla inicial de acceso (Chromium/Playwright,
   390 px y 320 px) con un SDK de Supabase SIMULADO: se sirve en lugar de
   vendor/supabase/supabase.js, así no hay credenciales reales ni requests a
   supabase.co. Uso:
     PLAYWRIGHT_PATH=$(npm root -g)/playwright node tests/e2e/acceso.e2e.js
   CAPTURAS_DIR=/ruta guarda capturas. */
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const { crearEntorno, aE3, clonar } = require("../entorno");
const { datasetHistoricos } = require("../fixtures/historicos-dataset");

const RAIZ = path.join(__dirname, "..", "..");
const AHORA = "2026-11-09T12:00:00";
const CLAVE = "gymNutritionTracker";
const CLAVE_AUTH = "gymNutritionTracker_supabaseAuth";
const META = "gymNutritionTracker_syncMeta";
const URL_APP = "https://gym-nutrition-tracker.github.io/";
const TIPOS = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".woff2": "font/woff2" };
const CAPTURAS = process.env.CAPTURAS_DIR || null;

/* SDK falso: misma forma que supabase-js v2 para lo que usa auth.js.
   Config en localStorage "__fakeSupabase"; llamadas en sessionStorage
   "__fakeLlamadas" (sobreviven a la recarga de la vuelta de Google). */
const SDK_FALSO = `
window.supabase = { createClient: function (url, key, opts) {
  var cfg = JSON.parse(localStorage.getItem("__fakeSupabase") || "{}");
  var almacen = opts.auth.storage, clave = opts.auth.storageKey, oyentes = [];
  function registrar(nombre, p) { var l = JSON.parse(sessionStorage.getItem("__fakeLlamadas") || "[]"); l.push([nombre, p]); sessionStorage.setItem("__fakeLlamadas", JSON.stringify(l)); }
  function emitir(ev, s) { oyentes.forEach(function (f) { f(ev, s); }); }
  function sesion(id, email, proveedor) { return { access_token: "acc-" + id, refresh_token: "ref-" + id, expires_at: 4102444800, provider_token: "ya29.falso", provider_refresh_token: "1//falso", user: { id: id, email: email, app_metadata: { provider: proveedor } } }; }
  function guardar(s) { almacen.setItem(clave, JSON.stringify(s)); }
  function leer() { var v = almacen.getItem(clave); return v ? JSON.parse(v) : null; }
  /* Vuelta de Google (detectSessionInUrl): #fake_oauth=uid:email */
  var m = /#fake_oauth=([^:]+):(.+)$/.exec(location.hash);
  if (m) { guardar(sesion(m[1], decodeURIComponent(m[2]), "google")); history.replaceState(null, "", location.pathname); setTimeout(function () { emitir("SIGNED_IN", leer()); }, 0); }
  return { auth: {
    onAuthStateChange: function (f) { oyentes.push(f); return { data: { subscription: { unsubscribe: function () {} } } }; },
    getSession: function () {
      if (cfg.colgarSesion) return new Promise(function () {});
      return new Promise(function (ok) { setTimeout(function () { ok({ data: { session: leer() }, error: null }); }, cfg.demoraSesion || 0); });
    },
    signInWithPassword: function (p) {
      registrar("signInWithPassword", { email: p.email });
      if (p.password !== "correcta") return Promise.resolve({ data: { session: null }, error: { message: "Invalid login credentials" } });
      var s = sesion("uid-email", p.email, "email"); guardar(s); setTimeout(function () { emitir("SIGNED_IN", s); }, 0);
      return Promise.resolve({ data: { session: s }, error: null });
    },
    signUp: function (p) { registrar("signUp", { email: p.email }); var s = sesion("uid-nuevo", p.email, "email"); guardar(s); setTimeout(function () { emitir("SIGNED_IN", s); }, 0); return Promise.resolve({ data: { session: s }, error: null }); },
    signOut: function () { registrar("signOut", null); almacen.removeItem(clave); setTimeout(function () { emitir("SIGNED_OUT", null); }, 0); return Promise.resolve({ error: null }); },
    resetPasswordForEmail: function (e, o) { registrar("resetPasswordForEmail", { email: e, redirectTo: o && o.redirectTo }); return Promise.resolve({ data: {}, error: null }); },
    updateUser: function () { return Promise.resolve({ data: {}, error: null }); },
    signInWithOAuth: function (p) {
      registrar("signInWithOAuth", p);
      if (cfg.oauth === "error") return Promise.resolve({ data: null, error: { message: "Unsupported provider: provider is not enabled" } });
      if (cfg.oauth === "colgar") return new Promise(function () {});
      var dest = location.pathname + "?vuelta=1#fake_oauth=" + cfg.oauth;
      setTimeout(function () { location.assign(dest); }, 30);
      return Promise.resolve({ data: { provider: p.provider, url: "https://proyecto.supabase.co/auth/v1/authorize" }, error: null });
    }
  },
  /* Solo lectura de datos_usuario (recuperación inicial): sin copia en la
     nube salvo cfg.filaNube. Cualquier escritura (RPC) sigue siendo error. */
  from: function (tabla) { return { select: function (cols) { return { maybeSingle: function () {
    registrar("select", { tabla: tabla, cols: cols });
    return Promise.resolve({ data: cfg.filaNube || null, error: null });
  } }; } }; },
  rpc: function () { throw new Error("sync no debe correr en este e2e"); } };
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

const historial = () => aE3(datasetHistoricos({ legacy: true }));
/* Perfil cargado y nada más (por ejemplo, alguien que completó el perfil). */
function soloPerfil() {
  const d = clonar(crearEntorno({ sinSync: true }).GYMAPP.storage.getDefaultData());
  d.usuario = Object.assign(clonar(historial().usuario), { nombre: "Ana" });
  return d;
}
const sesionGuardada = (id, email) => ({ access_token: "acc-" + id, refresh_token: "ref-" + id, expires_at: 4102444800, user: { id, email, app_metadata: { provider: "email" } } });

(async () => {
  const srv = await servir(RAIZ);
  const base = "http://127.0.0.1:" + srv.address().port + "/index.html";
  const browser = await chromium.launch();
  const r = [];
  const errores = [];
  const supabase = [];
  const check = (nombre, ok, detalle) => r.push({ nombre, ok: !!ok, detalle });

  /* semilla: { datos, sesion, config } escritos una sola vez por pestaña. */
  async function abrir(semilla, opciones) {
    opciones = opciones || {};
    const ctx = await browser.newContext({ viewport: { width: opciones.ancho || 390, height: 844 }, locale: "es-AR", timezoneId: "America/Argentina/Buenos_Aires" });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errores.push(e.message));
    page.on("console", (m) => { if (m.type() === "error" && !/net::ERR_INTERNET_DISCONNECTED/.test(m.text())) errores.push(m.text()); });
    page.on("request", (q) => { if (/supabase\.co/.test(q.url())) supabase.push(q.url()); });
    await page.route("**/vendor/supabase/supabase.js", (ruta) => ruta.fulfill({ status: 200, contentType: "text/javascript", body: SDK_FALSO }));
    await page.clock.install({ time: new Date(AHORA) });
    await page.addInitScript((s) => {
      if (sessionStorage.getItem("sembrado")) return;
      if (s.datos) localStorage.setItem("gymNutritionTracker", JSON.stringify(s.datos));
      if (s.sesion) localStorage.setItem("gymNutritionTracker_supabaseAuth", JSON.stringify(s.sesion));
      if (s.meta) localStorage.setItem("gymNutritionTracker_syncMeta", JSON.stringify(s.meta));
      localStorage.setItem("__fakeSupabase", JSON.stringify(s.config || {}));
      sessionStorage.setItem("sembrado", "1");
      /* ¿Se llegó a pintar el acceso en algún momento? (para detectar flashes) */
      new MutationObserver(() => { if (document.querySelector(".pantalla-acceso")) sessionStorage.setItem("vioAcceso", "1"); })
        .observe(document, { childList: true, subtree: true });
    }, semilla || {});
    await page.goto(base + (opciones.query || ""));
    page.hay = async (sel) => (await page.$(sel)) !== null;
    page.texto = (sel) => page.$eval(sel, (n) => n.textContent.replace(/\s+/g, " ").trim());
    page.local = (k) => page.evaluate((c) => localStorage.getItem(c), k);
    page.llamadas = () => page.evaluate(() => JSON.parse(sessionStorage.getItem("__fakeLlamadas") || "[]"));
    page.sinScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    page.foto = async (n) => {
      if (!CAPTURAS) return;
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: path.join(CAPTURAS, n + ".png"), animations: "disabled", caret: "hide" });
    };
    page.ctx = ctx;
    return page;
  }

  try {
    /* ---------- A. Sin sesión: pantalla inicial ---------- */
    let p = await abrir({});
    await p.waitForSelector(".pantalla-acceso");
    check("A. sin sesión → pantalla inicial de acceso", await p.hay(".pantalla-acceso"));
    check("A. Google visible sin abrir nada (sin shell, sin engranaje)", (await p.isVisible('[data-accion="acceso-google"]')) && !(await p.hay(".app-shell")) && !(await p.hay("#btn-rutina")));
    check("A. Google es lo primero de la tarjeta, arriba del separador 'o'", await p.evaluate(() => {
      const g = document.querySelector('[data-accion="acceso-google"]'), sep = document.querySelector(".acceso-separador"), em = document.getElementById("input-email-cuenta");
      return g.getBoundingClientRect().top < sep.getBoundingClientRect().top && sep.getBoundingClientRect().top < em.getBoundingClientRect().top && sep.textContent.trim() === "o";
    }));
    check("A. Google dentro de la primera pantalla (sin scroll)", await p.$eval('[data-accion="acceso-google"]', (b) => b.getBoundingClientRect().bottom <= window.innerHeight));
    check("A. email, contraseña e 'Iniciar sesión'", (await p.hay("#input-email-cuenta")) && (await p.hay("#input-password-cuenta")) && (await p.texto('[data-accion="iniciar-sesion"]')) === "Iniciar sesión");
    check("A. 'Crear cuenta' y '¿Olvidaste tu contraseña?'", (await p.texto('[data-accion="modo-crear-cuenta"]')) === "Crear cuenta" && (await p.texto('[data-accion="modo-recuperar-password"]')) === "¿Olvidaste tu contraseña?");
    check("A. 'Seguir sin cuenta' visible, debajo, como enlace", (await p.isVisible('[data-accion="acceso-sin-cuenta"]')) && (await p.$eval('[data-accion="acceso-sin-cuenta"]', (b) => b.classList.contains("btn-enlace") && !b.classList.contains("btn-primario"))));
    check("A. abrir el acceso no escribe datos de la app", (await p.local(CLAVE)) === null);
    check("A. sin scroll horizontal (390)", await p.sinScroll());
    await p.foto("01-acceso-390");

    /* Registro y recuperación siguen disponibles en la misma pantalla. */
    await p.click('[data-accion="modo-crear-cuenta"]');
    check("A. 'Crear cuenta': repetir contraseña + botón + Google sigue", (await p.hay("#input-password-confirmar-cuenta")) && (await p.texto('[data-accion="crear-cuenta"]')) === "Crear cuenta" && (await p.hay('[data-accion="acceso-google"]')));
    await p.foto("02-acceso-crear-cuenta");
    await p.click('[data-accion="modo-iniciar-sesion"]');
    await p.click('[data-accion="modo-recuperar-password"]');
    await p.fill("#input-email-cuenta", "a@test.com");
    await p.click('[data-accion="enviar-recuperacion"]');
    await p.waitForFunction(() => /Te enviamos un enlace/.test(document.getElementById("cuenta-mensaje").textContent));
    const rec = (await p.llamadas()).find((l) => l[0] === "resetPasswordForEmail");
    check("A. recuperación: usa el flujo existente con su redirect", rec && rec[1].email === "a@test.com" && rec[1].redirectTo === URL_APP, rec);
    await p.click('[data-accion="modo-iniciar-sesion"]');

    /* Login con email desde el acceso. */
    await p.fill("#input-email-cuenta", "a@test.com");
    await p.fill("#input-password-cuenta", "mal");
    await p.click('[data-accion="iniciar-sesion"]');
    await p.waitForFunction(() => /No se pudo iniciar sesión/.test(document.getElementById("cuenta-mensaje").textContent));
    check("A. email: contraseña incorrecta → mensaje, sigue en el acceso", await p.hay(".pantalla-acceso"));
    await p.fill("#input-password-cuenta", "correcta");
    await p.click('[data-accion="iniciar-sesion"]');
    await p.waitForSelector(".pantalla-onboarding, #form-onboarding");
    check("A. email: login correcto → entra (sin perfil local → onboarding de perfil)", !(await p.hay(".pantalla-acceso")));
    await p.ctx.close();

    /* ---------- B. Seguir sin cuenta ---------- */
    p = await abrir({});
    await p.click('[data-accion="acceso-sin-cuenta"]');
    check("B. dispositivo vacío → onboarding de perfil actual", await p.hay("#form-onboarding"));
    check("B. no escribe datos ni sesión", (await p.local(CLAVE)) === null && (await p.local(CLAVE_AUTH)) === null);
    check("B. ninguna llamada de auth", (await p.llamadas()).length === 0);
    await p.ctx.close();

    const perfil = soloPerfil();
    p = await abrir({ datos: perfil });
    await p.click('[data-accion="acceso-sin-cuenta"]');
    check("B. con perfil → shell y ONB-03 (guía y 'Empezá configurando')", (await p.hay(".app-shell")) && (await p.hay("#guia-inicio")) && (await p.hay(".primer-uso-card")));
    check("B. modo local: los datos no cambian", (await p.local(CLAVE)) === JSON.stringify(perfil));
    await p.click('[data-guia="omitir"]');
    await p.click("#btn-rutina");
    check("B. Cuenta sigue ofreciendo iniciar sesión más adelante", (await p.hay(".seccion-cuenta #input-email-cuenta")) && (await p.hay('.seccion-cuenta [data-accion="iniciar-sesion"]')));
    check("B. Cuenta no duplica 'Continuar con Google'", !(await p.hay('.seccion-cuenta [data-accion="acceso-google"]')));
    await p.ctx.close();

    /* ---------- C. Google ---------- */
    p = await abrir({ config: { oauth: "colgar" } });
    await p.click('[data-accion="acceso-google"]');
    await p.click('[data-accion="acceso-google"]', { force: true }).catch(() => {});
    const oauth = (await p.llamadas()).filter((l) => l[0] === "signInWithOAuth");
    check("C. click en Google llama signInWithOAuth una sola vez (doble click bloqueado)", oauth.length === 1, oauth);
    check("C. provider 'google' y redirectTo a GitHub Pages", oauth[0] && oauth[0][1].provider === "google" && oauth[0][1].options.redirectTo === URL_APP, oauth[0]);
    check("C. sin scopes extra", oauth[0] && !("scopes" in oauth[0][1].options));
    check("C. 'Abriendo Google…' y botón deshabilitado", (await p.texto('[data-accion="acceso-google"]')) === "Abriendo Google…" && (await p.$eval('[data-accion="acceso-google"]', (b) => b.disabled)));
    await p.foto("03-abriendo-google");
    await p.ctx.close();

    /* Usuario Google nuevo con dispositivo vacío: vuelve, sin perfil → perfil. */
    p = await abrir({ config: { oauth: "uid-g-nuevo:nuevo%40gmail.com" } });
    await p.click('[data-accion="acceso-google"]');
    await p.waitForSelector("#form-onboarding", { timeout: 10000 });
    check("C. Google nuevo (dispositivo vacío) → vuelve con sesión → onboarding de perfil", (await p.hay("#form-onboarding")) && !(await p.hay(".pantalla-acceso")));
    const guardadaG = JSON.parse(await p.local(CLAVE_AUTH));
    check("C. sesión Google persistida SIN provider_token ni provider_refresh_token", guardadaG && guardadaG.user.id === "uid-g-nuevo" && !("provider_token" in guardadaG) && !("provider_refresh_token" in guardadaG), guardadaG);
    check("C. URL limpia después de la vuelta", await p.evaluate(() => !location.hash));
    await p.ctx.close();

    /* Usuario Google nuevo con perfil local: vuelve → shell → ONB-03. */
    p = await abrir({ datos: perfil, config: { oauth: "uid-g-nuevo:nuevo%40gmail.com" } });
    await p.click('[data-accion="acceso-google"]');
    await p.waitForSelector(".app-shell", { timeout: 10000 });
    check("C. Google nuevo → app → ONB-03 (guía automática y 'Cargar mi plan' en Rutina)", (await p.hay("#guia-inicio")) && (await p.texto("#primer-uso-titulo")) === "Empezá configurando tu entrenamiento");
    await p.click('[data-guia="omitir"]');
    await p.click("#btn-rutina");
    check("C. … Rutina vacía con 'Cargar mi plan'", (await p.texto('.rutina-vacia [data-accion="cargar-plan"]')) === "Cargar mi plan");
    check("C. Cuenta muestra el email de Google", /Conectado como nuevo@gmail\.com/.test(await p.texto(".seccion-cuenta")));
    await p.ctx.close();

    /* ---------- D. Error de OAuth ---------- */
    p = await abrir({ config: { oauth: "error" } });
    await p.click('[data-accion="acceso-google"]');
    await p.waitForFunction(() => /No pudimos iniciar sesión con Google\./.test(document.getElementById("cuenta-mensaje").textContent));
    check("D. error antes del redirect → mensaje y botón restaurado", (await p.texto('[data-accion="acceso-google"]')) === "Continuar con Google" && !(await p.$eval('[data-accion="acceso-google"]', (b) => b.disabled)));
    await p.foto("04-error-google");
    await p.ctx.close();
    p = await abrir({}, { query: "?error=access_denied&error_description=The+user+denied" });
    await p.waitForSelector(".pantalla-acceso");
    check("D. vuelta de Google cancelada (?error=) → mensaje en el acceso", /No pudimos iniciar sesión con Google\./.test(await p.texto("#cuenta-mensaje")));
    check("D. … y la URL queda limpia", await p.evaluate(() => !location.search && !location.hash));
    await p.ctx.close();

    /* ---------- E. Sesión existente ---------- */
    const hist = historial();
    p = await abrir({ datos: hist, sesion: sesionGuardada("uid-A", "a@test.com"), config: { demoraSesion: 300 } });
    await p.waitForSelector(".app-shell");
    check("E. sesión válida → entra directo a la app", await p.hay(".app-shell"));
    check("E. el acceso nunca se pintó (sin flash del login)", (await p.evaluate(() => sessionStorage.getItem("vioAcceso"))) === null);
    check("E. usuario existente: sin guía automática", !(await p.hay("#guia-inicio")));
    await p.ctx.close();

    p = await abrir({ datos: hist, sesion: sesionGuardada("uid-A", "a@test.com"), config: { demoraSesion: 600 } });
    check("E. mientras se recupera la sesión: 'Cargando…'", (await p.hay(".pantalla-cargando")) && /Cargando…/.test(await p.texto(".pantalla-cargando")));
    await p.waitForSelector(".app-shell");
    await p.ctx.close();

    p = await abrir({ datos: hist, config: { colgarSesion: true } });
    check("E. Supabase no responde → 'Cargando…'", await p.hay(".pantalla-cargando"));
    await p.waitForSelector(".pantalla-acceso", { timeout: 8000 });
    check("E. … a los pocos segundos muestra el acceso (no bloquea el uso local)", await p.hay('[data-accion="acceso-sin-cuenta"]'));
    check("E. control: el detector de flash sí registra cuando el acceso se pinta", (await p.evaluate(() => sessionStorage.getItem("vioAcceso"))) === "1");
    await p.ctx.close();

    /* ---------- F. Logout ---------- */
    const metaA = { user_id: "uid-A", last_known_revision: 7, last_sync_at: "2026-11-01T10:00:00Z" };
    p = await abrir({ datos: hist, sesion: sesionGuardada("uid-A", "a@test.com"), meta: metaA });
    await p.waitForSelector(".app-shell");
    const blobAntes = await p.local(CLAVE);
    await p.click("#btn-rutina");
    await p.click('[data-accion="cerrar-sesion-cuenta"]');
    await p.waitForSelector(".pantalla-acceso");
    check("F. logout → vuelve a la pantalla inicial", (await p.hay(".pantalla-acceso")) && !(await p.hay(".app-shell")));
    check("F. … con Google, email y 'Seguir sin cuenta'", (await p.hay('[data-accion="acceso-google"]')) && (await p.hay("#input-email-cuenta")) && (await p.hay('[data-accion="acceso-sin-cuenta"]')));
    check("F. signOut llamado", (await p.llamadas()).some((l) => l[0] === "signOut"));
    check("F. el blob local NO se borra ni cambia", (await p.local(CLAVE)) === blobAntes);
    check("F. la sesión se borra; syncMeta intacto", (await p.local(CLAVE_AUTH)) === null && (await p.local(META)) === JSON.stringify(metaA));
    await p.click('[data-accion="acceso-sin-cuenta"]');
    check("F. después del logout se puede seguir sin cuenta con los mismos datos", (await p.hay(".app-shell")) && (await p.local(CLAVE)) === blobAntes);
    await p.ctx.close();

    /* ---------- G. Datos locales sin sesión ---------- */
    p = await abrir({ datos: hist });
    await p.waitForSelector(".pantalla-acceso");
    check("G. datos locales sin sesión → acceso (los datos no se tocan)", (await p.local(CLAVE)) === JSON.stringify(hist));
    await p.click('[data-accion="acceso-sin-cuenta"]');
    check("G. 'Seguir sin cuenta' entra de inmediato a la app", await p.hay(".app-shell"));
    check("G. sin guía automática (usuario con historial)", !(await p.hay("#guia-inicio")) && !(await p.hay(".primer-uso-card")));
    for (const t of ["entrenar", "progreso", "nutricion", "dashboard"]) await p.click("#nav-" + t);
    await p.click("#btn-rutina");
    check("G. recorrer la app en modo local conserva TODO", (await p.local(CLAVE)) === JSON.stringify(hist));
    check("G. exportar backup disponible", await p.hay('[data-accion="exportar-backup"]'));
    check("G. ninguna llamada de auth", (await p.llamadas()).length === 0);
    await p.ctx.close();

    /* ---------- Offline ---------- */
    p = await abrir({ datos: hist });
    await p.waitForSelector(".pantalla-acceso");
    await p.ctx.setOffline(true);
    await p.click('[data-accion="acceso-google"]');
    check("Offline: Google explica que no hay conexión, sin intentar", /No hay conexión a internet/.test(await p.texto("#cuenta-mensaje")) && !(await p.llamadas()).some((l) => l[0] === "signInWithOAuth"));
    await p.click('[data-accion="acceso-sin-cuenta"]');
    check("Offline: 'Seguir sin cuenta' entra a los datos locales", (await p.hay(".app-shell")) && (await p.local(CLAVE)) === JSON.stringify(hist));
    await p.ctx.close();

    /* ---------- 320 px ---------- */
    p = await abrir({}, { ancho: 320 });
    await p.waitForSelector(".pantalla-acceso");
    check("320: acceso sin scroll horizontal", await p.sinScroll());
    check("320: Google visible sin scroll", await p.$eval('[data-accion="acceso-google"]', (b) => { const q = b.getBoundingClientRect(); return q.left >= 0 && q.right <= window.innerWidth && q.bottom <= window.innerHeight; }));
    await p.foto("05-acceso-320");
    await p.click('[data-accion="modo-crear-cuenta"]');
    check("320: crear cuenta sin scroll horizontal", await p.sinScroll());
    await p.click('[data-accion="modo-iniciar-sesion"]');
    await p.click('[data-accion="modo-recuperar-password"]');
    check("320: recuperación sin scroll horizontal", await p.sinScroll());
    await p.ctx.close();
  } catch (err) {
    check("excepción en el e2e", false, err.message);
  }

  check("sin errores de consola", errores.length === 0, errores);
  check("sin requests a Supabase", supabase.length === 0, supabase);
  await browser.close();
  srv.close();
  r.forEach((x) => console.log((x.ok ? "ok    - " : "FALLA - ") + x.nombre + (x.ok ? "" : " → " + JSON.stringify(x.detalle))));
  const ok = r.filter((x) => x.ok).length;
  console.log("# e2e acceso: " + ok + "/" + r.length + " ok");
  process.exit(ok === r.length ? 0 : 1);
})();
