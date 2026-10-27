/* E2E de PROFILE-01: foto de perfil (Chromium/Playwright, 390 y 320 px) con
   Supabase SIMULADO (auth + Storage), sin credenciales ni red. El Storage
   falso aplica la misma regla que supabase/storage-avatars.sql (solo
   "avatars/<uid>/avatar" del usuario de la sesión). Uso:
     PLAYWRIGHT_PATH=$(npm root -g)/playwright node tests/e2e/perfil-foto.e2e.js
   CAPTURAS_DIR=/ruta guarda capturas. */
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const { aE3 } = require("../entorno");
const { datasetHistoricos } = require("../fixtures/historicos-dataset");
const { seguirSinCuenta } = require("./acceso-helper");

const RAIZ = path.join(__dirname, "..", "..");
const CLAVE = "gymNutritionTracker";
const UID = "1b2c3d4e-0000-4000-8000-00000000000a";
const TIPOS = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".woff2": "font/woff2" };
const CAPTURAS = process.env.CAPTURAS_DIR || null;

/* SDK falso. Sesión en localStorage (clave real de auth.js). Objetos de
   Storage en sessionStorage como data URL (SOLO el simulador; la app no
   guarda nada). Llamadas en sessionStorage "__fake". */
const SDK_FALSO = `
window.supabase = { createClient: function (url, key, opts) {
  var almacen = opts.auth.storage, clave = opts.auth.storageKey, oyentes = [];
  var cfg = JSON.parse(localStorage.getItem("__cfg") || "{}");
  function registrar(x) { var l = JSON.parse(sessionStorage.getItem("__fake") || "[]"); l.push(x); sessionStorage.setItem("__fake", JSON.stringify(l)); }
  function leer() { var v = almacen.getItem(clave); return v ? JSON.parse(v) : null; }
  function emitir(ev, s) { oyentes.forEach(function (f) { f(ev, s); }); }
  function permitido(bucket, ruta) { var s = leer(); return bucket === "avatars" && s && ruta === s.user.id + "/avatar"; }
  var firmas = 0;
  return {
    auth: {
      onAuthStateChange: function (f) { oyentes.push(f); return { data: { subscription: { unsubscribe: function () {} } } }; },
      getSession: function () { return Promise.resolve({ data: { session: leer() }, error: null }); },
      signInWithPassword: function (p) {
        var s = { access_token: "a", refresh_token: "r", expires_at: 4102444800, user: { id: "${UID}", email: p.email, app_metadata: { provider: "email" }, user_metadata: {} } };
        almacen.setItem(clave, JSON.stringify(s));
        setTimeout(function () { emitir("SIGNED_IN", s); }, 0);
        return Promise.resolve({ data: { session: s }, error: null });
      },
      signOut: function () { almacen.removeItem(clave); setTimeout(function () { emitir("SIGNED_OUT", null); }, 0); return Promise.resolve({ error: null }); }
    },
    storage: { from: function (bucket) { return {
      upload: function (ruta, blob, op) {
        registrar(["upload", bucket, ruta, op.upsert, op.contentType, blob.size]);
        if (JSON.parse(localStorage.getItem("__cfg") || "{}").errorStorage) return Promise.resolve({ data: null, error: { message: "internal: bucket quota exceeded (detalle interno)" } });
        if (!permitido(bucket, ruta)) return Promise.resolve({ data: null, error: { message: "row-level security" } });
        return new Promise(function (ok) { var r = new FileReader(); r.onload = function () { sessionStorage.setItem("__obj:" + ruta, r.result); ok({ data: { path: ruta }, error: null }); }; r.readAsDataURL(blob); });
      },
      createSignedUrl: function (ruta, s) {
        registrar(["createSignedUrl", bucket, ruta, s]);
        var o = permitido(bucket, ruta) && sessionStorage.getItem("__obj:" + ruta);
        return Promise.resolve(o ? { data: { signedUrl: o }, error: null } : { data: null, error: { message: "Object not found" } });
      },
      remove: function (rutas) {
        registrar(["remove", bucket, rutas]);
        rutas.filter(function (r) { return permitido(bucket, r); }).forEach(function (r) { sessionStorage.removeItem("__obj:" + r); });
        return Promise.resolve({ data: [], error: null });
      }
    }; } },
    from: function () { throw new Error("sync no debe correr"); },
    rpc: function () { throw new Error("sync no debe correr"); }
  };
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

(async () => {
  const srv = await servir(RAIZ);
  const base = "http://127.0.0.1:" + srv.address().port + "/index.html";
  const browser = await chromium.launch();
  const r = [];
  const errores = [];
  const red = [];
  const check = (nombre, ok, detalle) => r.push({ nombre, ok: !!ok, detalle });
  const datos = aE3(datasetHistoricos({ legacy: true }));
  const sesion = (meta) => ({ access_token: "a", refresh_token: "r", expires_at: 4102444800, user: { id: UID, email: "ana@test.com", app_metadata: { provider: "email" }, user_metadata: meta || {} } });

  async function abrir(semilla, ancho) {
    const ctx = await browser.newContext({ viewport: { width: ancho || 390, height: 844 }, locale: "es-AR", timezoneId: "America/Argentina/Buenos_Aires" });
    const p = await ctx.newPage();
    p.on("pageerror", (e) => errores.push(e.message));
    p.on("console", (m) => { if (m.type() === "error") errores.push(m.text()); });
    p.on("request", (q) => { if (/supabase\.co|googleusercontent/.test(q.url())) red.push(q.url()); });
    p.on("dialog", (d) => d.accept());
    await p.route("**/vendor/supabase/supabase.js", (ruta) => ruta.fulfill({ status: 200, contentType: "text/javascript", body: SDK_FALSO }));
    /* La foto de Google se sirve local (en la vida real la carga el navegador desde Google). */
    await p.route("https://lh3.googleusercontent.com/**", (ruta) => ruta.fulfill({ status: 200, contentType: "image/png", body: fs.readFileSync(path.join(RAIZ, "icons/apple-touch-icon.png")) }));
    await p.addInitScript((s) => {
      if (sessionStorage.getItem("sembrado")) return;
      localStorage.setItem("gymNutritionTracker", JSON.stringify(s.datos));
      if (s.sesion) localStorage.setItem("gymNutritionTracker_supabaseAuth", JSON.stringify(s.sesion));
      localStorage.setItem("__cfg", JSON.stringify(s.cfg || {}));
      sessionStorage.setItem("sembrado", "1");
    }, semilla);
    await p.goto(base);
    p.ctx = ctx;
    p.llamadas = () => p.evaluate(() => JSON.parse(sessionStorage.getItem("__fake") || "[]"));
    p.texto = (sel) => p.$eval(sel, (n) => n.textContent.replace(/\s+/g, " ").trim());
    p.hay = async (sel) => (await p.$(sel)) !== null;
    /* Saludos visibles en toda la pantalla (encabezado + Dashboard). */
    p.saludos = () => p.evaluate(() => (document.body.innerText.match(/Hola,/g) || []).length);
    p.enDashboard = () => p.evaluate(() => !!document.querySelector("#tab-content .pantalla-dashboard"));
    p.sinScroll = () => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    p.foto = async (n, sel) => {
      if (!CAPTURAS) return;
      await p.evaluate(() => document.fonts.ready);
      const opts = { path: path.join(CAPTURAS, n + ".png"), animations: "disabled", caret: "hide" };
      if (sel) await (await p.$(sel)).screenshot(opts); else await p.screenshot(opts);
    };
    return p;
  }

  /* Imagen real generada en el navegador (PNG/JPEG/GIF) → buffer para el input. */
  const imagen = (p, ancho, alto, color, tipo) => p.evaluate(async ([w, h, c, t]) => {
    const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
    const x = cv.getContext("2d"); x.fillStyle = c; x.fillRect(0, 0, w, h); x.fillStyle = "#fff"; x.fillRect(w / 2 - 40, h / 2 - 40, 80, 80);
    const b = await new Promise((ok) => cv.toBlob(ok, t || "image/png"));
    return Array.from(new Uint8Array(await b.arrayBuffer()));
  }, [ancho, alto, color, tipo]).then((a) => Buffer.from(a));
  const elegir = (p, nombre, tipo, buffer) => p.setInputFiles("#input-perfil-foto", { name: nombre, mimeType: tipo, buffer });
  const datosApp = (p) => p.evaluate((k) => localStorage.getItem(k), CLAVE);
  const dimensiones = (p, ruta) => p.evaluate((rt) => new Promise((ok) => {
    const src = sessionStorage.getItem("__obj:" + rt);
    if (!src) return ok(null);
    const i = new Image(); i.onload = () => ok({ w: i.naturalWidth, h: i.naturalHeight, tipo: src.slice(5, src.indexOf(";")) }); i.src = src;
  }), ruta);

  try {
    /* ---------- Sin cuenta ---------- */
    let p = await abrir({ datos });
    await seguirSinCuenta(p);
    check("sin cuenta: encabezado sin avatar (igual que antes)", !(await p.hay(".app-header .avatar")) && /^Hola, /.test(await p.texto(".app-header span")));
    check("sin cuenta: Dashboard con un solo saludo (el del encabezado)", (await p.enDashboard()) && (await p.saludos()) === 1 && !(await p.hay("#tab-content h1")), await p.saludos());
    await p.click("#btn-rutina");
    check("sin cuenta: Cuenta ofrece iniciar sesión, sin bloque de foto", (await p.hay(".seccion-cuenta #input-email-cuenta")) && !(await p.hay("[data-perfil-foto]")));
    check("sin cuenta: cero llamadas a Storage", (await p.llamadas()).length === 0);
    await p.ctx.close();

    /* ---------- Con cuenta, sin foto ---------- */
    p = await abrir({ datos, sesion: sesion() });
    await p.waitForSelector(".app-shell");
    check("con cuenta: avatar chico en el encabezado con la inicial", (await p.texto(".app-header .avatar-chico")) === "A");
    check("con cuenta sin foto: Dashboard con un solo saludo", (await p.enDashboard()) && (await p.saludos()) === 1, await p.saludos());
    await p.click("#btn-rutina");
    await p.waitForSelector("[data-perfil-foto]");
    check("Cuenta: avatar grande con inicial (fallback)", (await p.texto("[data-perfil-foto] .avatar-grande")) === "A" && !(await p.hay("[data-perfil-foto] img")));
    check("Cuenta: 'Agregar foto', sin 'Eliminar foto'", (await p.texto('[data-accion="perfil-foto-cambiar"]')) === "Agregar foto" && !(await p.hay('[data-accion="perfil-foto-eliminar"]')));
    check("Cuenta: email y 'Cerrar sesión' siguen", /Conectado como ana@test\.com/.test(await p.texto(".seccion-cuenta")) && (await p.hay('[data-accion="cerrar-sesion-cuenta"]')));
    check("sin foto: se consultó solo la ruta propia", (await p.llamadas()).every((l) => l[0] === "createSignedUrl" && l[1] === "avatars" && l[2] === UID + "/avatar" && l[3] === 3600));
    check("390: Cuenta sin scroll horizontal", await p.sinScroll());
    await p.foto("01-cuenta-sin-foto", ".seccion-cuenta");
    const antes = await datosApp(p);

    /* Formato inválido. */
    let chooser = p.waitForEvent("filechooser");
    await p.click('[data-accion="perfil-foto-cambiar"]');
    check("'Agregar foto' abre el selector de archivos", !!(await chooser));
    await elegir(p, "anim.gif", "image/gif", Buffer.from("GIF89a"));
    check("formato inválido: mensaje claro y sin subir nada", (await p.texto("#perfil-foto-mensaje")) === "Elegí una imagen JPG, PNG o WebP." && !(await p.llamadas()).some((l) => l[0] === "upload"));

    /* Subir: PNG 1600x1000 → WebP 512x512 recortado al centro. */
    await elegir(p, "foto.png", "image/png", await imagen(p, 1600, 1000, "#2F6FED"));
    await p.waitForSelector("[data-perfil-foto] .avatar-con-foto img");
    const subida = (await p.llamadas()).filter((l) => l[0] === "upload");
    check("subir: una llamada, upsert a '<uid>/avatar'", subida.length === 1 && subida[0][2] === UID + "/avatar" && subida[0][3] === true, subida);
    check("subir: comprimida a WebP liviano (< 100 KB)", subida[0][4] === "image/webp" && subida[0][5] < 100 * 1024, subida[0]);
    const dim = await dimensiones(p, UID + "/avatar");
    check("subir: recortada cuadrada a 512x512", dim && dim.w === 512 && dim.h === 512 && dim.tipo === "image/webp", dim);
    check("subir: Cuenta muestra la foto y ofrece 'Cambiar foto' + 'Eliminar foto'", (await p.texto('[data-accion="perfil-foto-cambiar"]')) === "Cambiar foto" && (await p.hay('[data-accion="perfil-foto-eliminar"]')));
    check("subir: el encabezado se actualiza sin recargar", await p.hay(".app-header .avatar-con-foto img"));
    check("subir: la imagen usa object-fit cover", (await p.$eval("[data-perfil-foto] img", (i) => getComputedStyle(i).objectFit)) === "cover");
    const src1 = await p.$eval("[data-perfil-foto] img", (i) => i.src);
    await p.foto("02-cuenta-con-foto", ".seccion-cuenta");
    await p.foto("03-encabezado-con-foto", ".app-header");

    /* Reemplazar. */
    await elegir(p, "otra.jpg", "image/jpeg", await imagen(p, 800, 1200, "#C0392B", "image/jpeg"));
    await p.waitForFunction((s) => { const i = document.querySelector("[data-perfil-foto] img"); return i && i.src !== s; }, src1);
    const subidas = (await p.llamadas()).filter((l) => l[0] === "upload");
    check("reemplazar: misma ruta (sin huérfanos)", subidas.length === 2 && subidas.every((l) => l[2] === UID + "/avatar"));
    check("reemplazar: la UI muestra la nueva (src distinto) en Cuenta y encabezado", (await p.$eval(".app-header img", (i) => i.src)) === (await p.$eval("[data-perfil-foto] img", (i) => i.src)));

    /* Datos de la app intactos, sin base64 en localStorage. */
    check("datos de la app intactos tras subir/reemplazar", (await datosApp(p)) === antes);
    check("sin base64 ni referencias de avatar en localStorage", await p.evaluate(() => Object.keys(localStorage).every((k) => !/data:image|base64|avatar/i.test(localStorage.getItem(k) || "")) && !Object.keys(localStorage).some((k) => /avatar/i.test(k))));

    /* Recargar: la foto vuelve por signed URL. */
    await p.reload();
    await p.waitForSelector(".app-shell .app-header .avatar-con-foto img");
    check("recargar: el encabezado muestra la foto (signed URL)", true);
    check("con cuenta + foto: Dashboard con un solo 'Hola, …' (encabezado)", (await p.enDashboard()) && (await p.saludos()) === 1 && /^Hola, /.test(await p.texto(".app-header-saludo > span:last-child")), await p.saludos());
    check("Dashboard: la primera tarjeta es 'Meta semanal'", await p.evaluate(() => {
      const d = document.querySelector("#tab-content .pantalla-dashboard");
      return !!d && /^Meta semanal/i.test(d.firstElementChild.innerText.trim());
    }));
    await p.foto("00-dashboard-un-saludo");
    await p.click("#btn-rutina");
    await p.waitForSelector("[data-perfil-foto] .avatar-con-foto img");
    check("recargar: Cuenta muestra la foto y 'Eliminar foto'", await p.hay('[data-accion="perfil-foto-eliminar"]'));

    /* Eliminar. */
    await p.click('[data-accion="perfil-foto-eliminar"]');
    await p.waitForSelector("[data-perfil-foto] .avatar-inicial");
    const borrado = (await p.llamadas()).filter((l) => l[0] === "remove");
    check("eliminar: remove de la ruta propia", borrado.length === 1 && JSON.stringify(borrado[0][2]) === JSON.stringify([UID + "/avatar"]));
    check("eliminar: vuelve al fallback y a 'Agregar foto'", (await p.texto('[data-accion="perfil-foto-cambiar"]')) === "Agregar foto" && (await p.texto(".app-header .avatar")) === "A");
    check("eliminar: la sesión y los datos siguen", (await p.hay('[data-accion="cerrar-sesion-cuenta"]')) && (await datosApp(p)) === antes);
    await p.foto("04-cuenta-tras-eliminar", ".seccion-cuenta");
    await p.ctx.close();

    /* ---------- Sin recargar: login desde modo local, foto, error, logout ---------- */
    p = await abrir({ datos });
    await seguirSinCuenta(p);
    check("[sin recargar] modo local: encabezado sin avatar", !(await p.hay(".app-header .avatar")));
    await p.click("#btn-rutina");
    await p.fill("#input-email-cuenta", "ana@test.com");
    await p.fill("#input-password-cuenta", "secreta");
    await p.click('[data-accion="iniciar-sesion"]');
    await p.waitForSelector(".app-header .avatar");
    check("[sin recargar] login desde Cuenta → avatar (inicial) en el encabezado al instante", (await p.texto(".app-header .avatar")) === "A" && /^Hola, /.test(await p.texto(".app-header-saludo > span:last-child")));
    check("[sin recargar] … y Cuenta muestra su bloque de foto", await p.hay("[data-perfil-foto] .avatar-grande"));
    await elegir(p, "foto.png", "image/png", await imagen(p, 700, 700, "#2F6FED"));
    await p.waitForSelector(".app-header .avatar-con-foto img");
    const srcSubida = await p.$eval(".app-header img", (i) => i.src);
    check("[sin recargar] subir: Cuenta y encabezado muestran la misma foto nueva", srcSubida === (await p.$eval("[data-perfil-foto] img", (i) => i.src)));
    await elegir(p, "otra.png", "image/png", await imagen(p, 700, 700, "#C0392B"));
    await p.waitForFunction((s) => document.querySelector(".app-header img").src !== s, srcSubida);
    const srcReemplazo = await p.$eval(".app-header img", (i) => i.src);
    check("[sin recargar] reemplazar: ambos cambian a la nueva", srcReemplazo !== srcSubida && srcReemplazo === (await p.$eval("[data-perfil-foto] img", (i) => i.src)));
    await p.evaluate(() => localStorage.setItem("__cfg", JSON.stringify({ errorStorage: true })));
    await elegir(p, "falla.png", "image/png", await imagen(p, 700, 700, "#27AE60"));
    await p.waitForFunction(() => /No pudimos subir la foto\./.test(document.getElementById("perfil-foto-mensaje").textContent));
    check("[sin recargar] error al reemplazar: Cuenta y encabezado conservan la foto anterior",
      (await p.$eval(".app-header img", (i) => i.src)) === srcReemplazo && (await p.$eval("[data-perfil-foto] img", (i) => i.src)) === srcReemplazo && (await p.hay('[data-accion="perfil-foto-eliminar"]')));
    await p.evaluate(() => localStorage.setItem("__cfg", "{}"));
    await p.click('[data-accion="perfil-foto-eliminar"]');
    await p.waitForSelector(".app-header .avatar-inicial");
    check("[sin recargar] eliminar: Cuenta y encabezado vuelven a la inicial", (await p.texto(".app-header .avatar")) === "A" && (await p.texto("[data-perfil-foto] .avatar")) === "A" && !(await p.hay(".app-header img")));
    /* Logout: perfilFoto saca el avatar del encabezado en el mismo evento de sesión
       (antes de que AUTH-04 cambie a la pantalla de acceso). */
    await p.evaluate(() => {
      window.__quitado = false;
      const h = document.querySelector(".app-header");
      new MutationObserver((ms) => ms.forEach((m) => m.removedNodes.forEach((n) => { if (n.classList && n.classList.contains("app-header-saludo")) window.__quitado = true; })))
        .observe(h, { childList: true });
    });
    await p.click('[data-accion="cerrar-sesion-cuenta"]');
    await p.waitForSelector(".pantalla-acceso");
    check("[sin recargar] logout: el avatar se quita del encabezado en el acto", await p.evaluate(() => window.__quitado));
    await p.click('[data-accion="acceso-sin-cuenta"]');
    check("[sin recargar] … y al seguir sin cuenta el encabezado queda sin avatar", !(await p.hay(".app-header .avatar")) && /^Hola, /.test(await p.texto(".app-header > span")));
    await p.ctx.close();

    /* ---------- Error de Storage ---------- */
    p = await abrir({ datos, sesion: sesion(), cfg: { errorStorage: true } });
    await p.click("#btn-rutina");
    await p.waitForSelector("[data-perfil-foto]");
    await elegir(p, "foto.png", "image/png", await imagen(p, 600, 600, "#2F6FED"));
    await p.waitForFunction(() => /No pudimos/.test(document.getElementById("perfil-foto-mensaje").textContent));
    check("error al subir: 'No pudimos subir la foto.' (sin detalles internos)", (await p.texto("#perfil-foto-mensaje")) === "No pudimos subir la foto.");
    check("error al subir: sigue el fallback", !(await p.hay("[data-perfil-foto] img")));
    await p.ctx.close();

    /* ---------- Foto de Google como fallback ---------- */
    p = await abrir({ datos, sesion: sesion({ avatar_url: "https://lh3.googleusercontent.com/a/foto-google" }) });
    await p.click("#btn-rutina");
    await p.waitForSelector("[data-perfil-foto] .avatar-google img");
    check("Google: se muestra como fallback con nota", /Se muestra tu foto de Google\. Podés subir otra\./.test(await p.texto("[data-perfil-foto]")));
    check("Google: no se sube ni se copia a Storage", !(await p.llamadas()).some((l) => l[0] === "upload"));
    check("Google: sin 'Eliminar foto' (no hay foto propia)", !(await p.hay('[data-accion="perfil-foto-eliminar"]')));
    await p.foto("05-cuenta-foto-google", ".seccion-cuenta");
    await p.ctx.close();

    /* ---------- Logout y 320 px ---------- */
    p = await abrir({ datos, sesion: sesion() }, 320);
    await p.waitForSelector(".app-shell");
    check("320: encabezado con avatar sin scroll", await p.sinScroll());
    await p.click("#btn-rutina");
    await p.waitForSelector("[data-perfil-foto]");
    await elegir(p, "foto.png", "image/png", await imagen(p, 900, 900, "#2F6FED"));
    await p.waitForSelector("[data-perfil-foto] img");
    check("320: Cuenta con foto sin scroll horizontal", await p.sinScroll());
    await p.foto("06-cuenta-320", ".seccion-cuenta");
    await p.click('[data-accion="cerrar-sesion-cuenta"]');
    await p.waitForSelector(".pantalla-acceso");
    check("logout: vuelve al acceso (AUTH-04) sin avatar", !(await p.hay(".avatar")));
    await p.click('[data-accion="acceso-sin-cuenta"]');
    check("después del logout, sin cuenta: sin avatar ni foto del usuario anterior", !(await p.hay(".app-header .avatar")) && !(await p.hay("img[src^='data:image']")));
    await p.ctx.close();
  } catch (err) {
    check("excepción en el e2e", false, err.message);
  }

  check("sin errores de consola", errores.length === 0, errores);
  check("sin requests reales a Supabase ni a Google", red.filter((u) => /supabase\.co/.test(u)).length === 0, red);
  await browser.close();
  srv.close();
  r.forEach((x) => console.log((x.ok ? "ok    - " : "FALLA - ") + x.nombre + (x.ok ? "" : " → " + JSON.stringify(x.detalle))));
  const ok = r.filter((x) => x.ok).length;
  console.log("# e2e perfil-foto: " + ok + "/" + r.length + " ok");
  process.exit(ok === r.length ? 0 : 1);
})();
