/* AUTH-04 (Fase A): pantalla inicial de acceso con Google, email/contraseña
   y "Seguir sin cuenta". Acá: auth.js (render, OAuth, redirect, tokens del
   proveedor, seguridad) y su relación con sync. El arranque completo de la
   app (acceso → perfil → shell → ONB-03, logout) está en
   tests/e2e/acceso.e2e.js con Supabase simulado.
   Correr con: node --test tests/*.test.js */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { crearEntorno, esperar, clonar, datosEjemplo } = require("./entorno");

const RAIZ = path.join(__dirname, "..");
const CLAVE = "gymNutritionTracker";
const CLAVE_AUTH = "gymNutritionTracker_supabaseAuth";
const URL_APP = "https://gym-nutrition-tracker.github.io/";

const entorno = () => crearEntorno({ authReal: true });

/* Contenedor y botón falsos para los handlers de bindEventosCuenta. */
function contenedorAcceso() {
  const mensaje = { textContent: "", className: "mensaje oculto" };
  const texto = { textContent: "Continuar con Google" };
  const boton = { disabled: false, dataset: { accion: "acceso-google" }, querySelector: () => texto };
  const c = {
    handler: null,
    addEventListener(tipo, fn) { if (tipo === "click") c.handler = fn; },
    querySelector: (sel) => (sel === "#cuenta-mensaje" ? mensaje : null),
    clickGoogle() { c.handler({ target: { closest: () => boton } }); }
  };
  return { c, boton, texto, mensaje };
}

/* --- Pantalla inicial --- */

test("3-6. pantalla inicial: Google arriba, separador, email/contraseña, crear cuenta, recuperar y 'Seguir sin cuenta'", () => {
  const html = entorno().GYMAPP.auth.renderPantallaAcceso();
  const pos = (s) => html.indexOf(s);
  assert.match(html, /Bienvenido/);
  assert.match(html, /Guardá y sincronizá tu progreso entre dispositivos\./);
  assert.match(html, /data-accion="acceso-google"[^>]*>.*Continuar con Google/);
  assert.match(html, /class="acceso-separador"[^>]*><span>o<\/span>/);
  assert.match(html, /id="input-email-cuenta"/);
  assert.match(html, /id="input-password-cuenta"/);
  assert.match(html, /data-accion="iniciar-sesion"[^>]*>Iniciar sesión</);
  assert.match(html, /¿No tenés cuenta\? <button type="button" data-accion="modo-crear-cuenta"[^>]*>Crear cuenta</);
  assert.match(html, /data-accion="modo-recuperar-password"[^>]*>¿Olvidaste tu contraseña\?</);
  assert.match(html, /data-accion="acceso-sin-cuenta"[^>]*>Seguir sin cuenta</);
  assert.match(html, /Podés iniciar sesión más adelante para sincronizar tus datos\./);
  assert.ok(pos("acceso-google") < pos("acceso-separador") && pos("acceso-separador") < pos("input-email-cuenta") &&
    pos("input-email-cuenta") < pos("acceso-sin-cuenta"), "orden: Google, o, email, Seguir sin cuenta");
  assert.match(html, /class="btn btn-google btn-ancho"/, "Google es un botón principal");
  assert.match(html, /class="btn-enlace acceso-sin-cuenta"/, "Seguir sin cuenta es secundario");
});

test("5. modo 'Crear cuenta': repetir contraseña, botón Crear cuenta y Google disponible", () => {
  const e = entorno();
  const A = e.GYMAPP.auth;
  const { c } = contenedorAcceso();
  A.bindEventosCuenta(c, () => {});
  c.handler({ target: { closest: () => ({ dataset: { accion: "modo-crear-cuenta" } }) } });
  const html = A.renderPantallaAcceso();
  assert.match(html, /id="input-password-confirmar-cuenta"/);
  assert.match(html, /data-accion="crear-cuenta"[^>]*>Crear cuenta</);
  assert.match(html, /¿Ya tenés cuenta\?/);
  assert.match(html, /acceso-google/);
  assert.match(html, /acceso-sin-cuenta/);
});

test("6. modo recuperación: email + enviar enlace + volver; sigue 'Seguir sin cuenta'", () => {
  const e = entorno();
  const A = e.GYMAPP.auth;
  const { c } = contenedorAcceso();
  A.bindEventosCuenta(c, () => {});
  c.handler({ target: { closest: () => ({ dataset: { accion: "modo-recuperar-password" } }) } });
  const html = A.renderPantallaAcceso();
  assert.match(html, /Recuperar contraseña/);
  assert.match(html, /data-accion="enviar-recuperacion"/);
  assert.match(html, /data-accion="modo-iniciar-sesion"/);
  assert.match(html, /acceso-sin-cuenta/);
});

test("el email ingresado se escapa en el formulario", () => {
  const e = entorno();
  const A = e.GYMAPP.auth;
  const mensaje = { textContent: "", className: "" };
  const c = {
    handler: null,
    addEventListener(t, fn) { c.handler = fn; },
    querySelector: (sel) => (sel === "#input-email-cuenta" ? { value: '"><img/src=x>@a.com' } : sel === "#input-password-cuenta" ? { value: "x" } : sel === "#cuenta-mensaje" ? mensaje : null)
  };
  A.bindEventosCuenta(c, () => {});
  c.handler({ target: { closest: () => ({ dataset: { accion: "iniciar-sesion" }, disabled: false }) } });
  const html = A.renderPantallaAcceso();
  assert.match(html, /value="&quot;&gt;&lt;img\/src=x&gt;@a\.com"/, "el email quedó en el formulario, escapado");
  assert.doesNotMatch(html, /<img\/src=x>/);
});

/* --- Google OAuth --- */

test("10-11. Google llama signInWithOAuth con provider 'google', redirectTo de la app y sin scopes extra", async () => {
  const e = entorno();
  const { c } = contenedorAcceso();
  e.GYMAPP.auth.bindEventosCuenta(c, () => {});
  c.clickGoogle();
  await esperar();
  const llamadas = clonar(e.auth.llamadas).filter((l) => l[0] === "signInWithOAuth");
  assert.equal(llamadas.length, 1);
  assert.deepEqual(llamadas[0][1], { provider: "google", options: { redirectTo: URL_APP, queryParams: { prompt: "select_account" } } });
  assert.equal("scopes" in llamadas[0][1].options, false, "no pide scopes adicionales");
});

test("11. obtenerRedirectOAuth: siempre la URL publicada, nunca derivada de la URL actual", () => {
  const e = entorno();
  e.ctx.location.href = "https://atacante.example/?redirect=https://otro.example";
  assert.equal(e.GYMAPP.auth.obtenerRedirectOAuth(), URL_APP);
  assert.equal(e.GYMAPP.auth.obtenerRedirectOAuth(), "https://gym-nutrition-tracker.github.io/");
});

test("URL de retorno: OAuth y recuperación usan https://gym-nutrition-tracker.github.io/; nada del sitio viejo", async () => {
  const e = entorno();
  const cliente = e.GYMAPP.auth.obtenerCliente();
  const resets = [];
  cliente.auth.resetPasswordForEmail = (email, opciones) => { resets.push([email, opciones]); return Promise.resolve({ data: {}, error: null }); };
  const mensaje = { textContent: "", className: "mensaje oculto" };
  const boton = { disabled: false, dataset: { accion: "enviar-recuperacion" } };
  const c = {
    handler: null,
    addEventListener(tipo, fn) { if (tipo === "click") c.handler = fn; },
    querySelector: (sel) => (sel === "#cuenta-mensaje" ? mensaje : sel === "#input-email-cuenta" ? { value: "a@test.com" } : null)
  };
  e.GYMAPP.auth.bindEventosCuenta(c, () => {});
  c.handler({ target: { closest: () => boton } });
  await esperar();
  assert.deepEqual(clonar(resets), [["a@test.com", { redirectTo: "https://gym-nutrition-tracker.github.io/" }]]);
  assert.equal(e.GYMAPP.auth.obtenerRedirectOAuth(), "https://gym-nutrition-tracker.github.io/");
  const src = fs.readFileSync(path.join(RAIZ, "js/auth.js"), "utf8");
  assert.doesNotMatch(src, /nico6896|Agente-AI-de-prueba/);
  assert.match(src, /var SUPABASE_URL = "https:\/\/gegzdzpqzbmjldapsesg\.supabase\.co";/, "Supabase URL sin cambios");
});

test("12. doble click bloqueado: 'Abriendo Google…' y una sola llamada", async () => {
  const e = entorno();
  let resolver;
  e.auth.respuestaOAuth = () => new Promise((r) => { resolver = r; });
  const { c, boton, texto, mensaje } = contenedorAcceso();
  e.GYMAPP.auth.bindEventosCuenta(c, () => {});
  c.clickGoogle();
  c.clickGoogle();
  c.clickGoogle();
  assert.equal(e.auth.llamadas.filter((l) => l[0] === "signInWithOAuth").length, 1);
  assert.equal(boton.disabled, true);
  assert.equal(texto.textContent, "Abriendo Google…");
  assert.equal(mensaje.textContent, "", "sin mensaje extra que desplace el botón");
  assert.match(e.GYMAPP.auth.renderPantallaAcceso(), /disabled><svg[\s\S]*Abriendo Google…/, "un re-render conserva el bloqueo");
  resolver({ data: { url: "x" }, error: null });
  await esperar();
  assert.equal(boton.disabled, true, "sin error el navegador ya está yendo a Google");
});

test("13. error de OAuth (respuesta con error) restaura el botón y muestra el mensaje", async () => {
  const e = entorno();
  e.auth.respuestaOAuth = () => Promise.resolve({ data: null, error: { message: "provider is not enabled" } });
  const { c, boton, texto, mensaje } = contenedorAcceso();
  e.GYMAPP.auth.bindEventosCuenta(c, () => {});
  c.clickGoogle();
  await esperar();
  assert.equal(boton.disabled, false);
  assert.equal(texto.textContent, "Continuar con Google");
  assert.equal(mensaje.textContent, "No pudimos iniciar sesión con Google.");
  assert.equal(mensaje.className, "mensaje error");
  c.clickGoogle();
  assert.equal(e.auth.llamadas.filter((l) => l[0] === "signInWithOAuth").length, 2, "se puede reintentar");
});

test("13b. error de red (promesa rechazada) también restaura", async () => {
  const e = entorno();
  e.auth.respuestaOAuth = () => Promise.reject(new Error("Failed to fetch"));
  const { c, boton, mensaje } = contenedorAcceso();
  e.GYMAPP.auth.bindEventosCuenta(c, () => {});
  c.clickGoogle();
  await esperar();
  assert.equal(boton.disabled, false);
  assert.equal(mensaje.textContent, "No pudimos iniciar sesión con Google.");
});

test("13c. sin conexión: no intenta abrir Google y lo explica", async () => {
  const e = entorno();
  e.ctx.navigator = { onLine: false };
  const { c, boton, mensaje } = contenedorAcceso();
  e.GYMAPP.auth.bindEventosCuenta(c, () => {});
  c.clickGoogle();
  await esperar();
  assert.equal(e.auth.llamadas.length, 0);
  assert.equal(boton.disabled, false);
  assert.match(mensaje.textContent, /No hay conexión a internet\. Podés seguir sin cuenta/);
});

test("vuelta de Google con error en la URL (?error= o #error=) se detecta", () => {
  const A = entorno().GYMAPP.auth;
  assert.equal(A.hayErrorOAuthEnUrl({ search: "?error=access_denied&error_description=x", hash: "" }), true);
  assert.equal(A.hayErrorOAuthEnUrl({ search: "", hash: "#error=server_error" }), true);
  assert.equal(A.hayErrorOAuthEnUrl({ search: "", hash: "#access_token=abc&type=bearer" }), false);
  assert.equal(A.hayErrorOAuthEnUrl({ search: "?v=1", hash: "" }), false);
});

/* --- Sesión --- */

test("2/16. inicializar devuelve la sesión (Google o email) y la trata igual", async () => {
  const e = entorno();
  e.auth.sesion = { user: { id: "uid-G", email: "g@gmail.com", app_metadata: { provider: "google" } } };
  const s = await e.GYMAPP.auth.inicializar();
  assert.equal(s.user.id, "uid-G");
  assert.equal(e.GYMAPP.auth.obtenerSesion().user.email, "g@gmail.com");
});

test("1. sin sesión, inicializar devuelve null (la app muestra el acceso) y no escribe datos", async () => {
  const e = entorno();
  e.escribir(CLAVE, datosEjemplo());
  const antes = e.localStorage.getItem(CLAVE);
  assert.equal(await e.GYMAPP.auth.inicializar(), null);
  assert.equal(e.localStorage.getItem(CLAVE), antes);
});

test("9. sin Supabase (SDK no cargado): inicializar resuelve null y disponible() es false", async () => {
  const e = crearEntorno({ authReal: true });
  delete e.ctx.supabase;
  assert.equal(e.GYMAPP.auth.disponible(), false);
  assert.equal(await e.GYMAPP.auth.inicializar(), null);
});

test("16. sync usa la sesión de Google como cualquier otra (mismo user.id → misma cuenta)", async () => {
  const e = entorno();
  e.GYMAPP.auth.obtenerCliente();
  e.auth.eventos("SIGNED_IN", { user: { id: "uid-A", email: "a@test.com", app_metadata: { provider: "google", providers: ["email", "google"] } } });
  assert.match(e.GYMAPP.sync.renderSeccionSincronizacion(), /a@test\.com/);
});

test("13 (cuenta). Google con OTRO user.id: sync bloquea la subida (cambio de cuenta), sin copiar ni mezclar", async () => {
  const e = entorno();
  e.escribir(CLAVE, datosEjemplo({ medidas_corporales: [{ fecha: "2026-10-19", peso: 80 }] }));
  e.escribir("gymNutritionTracker_syncMeta", { user_id: "uid-A", last_known_revision: 4, last_sync_at: "2026-10-18T10:00:00Z" });
  e.GYMAPP.auth.obtenerCliente();
  e.auth.eventos("SIGNED_IN", { user: { id: "uid-OTRO", email: "a@test.com", app_metadata: { provider: "google" } } });
  e.auth.sesion = { user: { id: "uid-OTRO", email: "a@test.com" } };
  const antes = e.localStorage.getItem(CLAVE);
  const r = await e.GYMAPP.sync.conservarLocalYActualizar();
  assert.equal(r.estado, "cuenta_distinta");
  assert.equal(e.nube.llamadas.filter((l) => l.tipo === "rpc").length, 0, "no sube nada");
  assert.equal(e.localStorage.getItem(CLAVE), antes, "no toca el blob local");
  assert.equal(e.leer("gymNutritionTracker_syncMeta").user_id, "uid-A", "no cambia el dueño registrado");
});

/* --- Logout --- */

test("14-15. logout: signOut, el blob local queda intacto y la sesión pasa a null", async () => {
  const e = entorno();
  e.escribir(CLAVE, datosEjemplo());
  const antes = e.localStorage.getItem(CLAVE);
  e.auth.sesion = { user: { id: "uid-A", email: "a@test.com" } };
  await e.GYMAPP.auth.inicializar();
  const avisos = [];
  e.GYMAPP.auth.suscribirCambiosSesion((s) => avisos.push(s));
  await e.GYMAPP.auth.cerrarSesion();
  e.auth.eventos("SIGNED_OUT", null);
  assert.deepEqual(clonar(e.auth.llamadas).map((l) => l[0]), ["signOut"]);
  assert.equal(e.GYMAPP.auth.obtenerSesion(), null);
  assert.equal(avisos[avisos.length - 1], null);
  assert.equal(e.localStorage.getItem(CLAVE), antes);
});

/* --- Tokens del proveedor y secretos --- */

test("18. la sesión se persiste SIN provider_token ni provider_refresh_token", async () => {
  const e = entorno();
  e.GYMAPP.auth.obtenerCliente();
  const almacenamiento = e.registro.createClient.opts.auth.storage;
  assert.ok(almacenamiento, "el cliente usa el almacenamiento filtrado");
  assert.equal(e.registro.createClient.opts.auth.storageKey, CLAVE_AUTH);
  const sesion = { access_token: "a", refresh_token: "r", provider_token: "ya29.google", provider_refresh_token: "1//google", user: { id: "u" } };
  almacenamiento.setItem(CLAVE_AUTH, JSON.stringify(sesion));
  const guardado = JSON.parse(e.localStorage.getItem(CLAVE_AUTH));
  assert.equal("provider_token" in guardado, false);
  assert.equal("provider_refresh_token" in guardado, false);
  assert.deepEqual(guardado, { access_token: "a", refresh_token: "r", user: { id: "u" } });
  assert.equal(almacenamiento.getItem(CLAVE_AUTH), e.localStorage.getItem(CLAVE_AUTH));
  /* Valores que no son una sesión pasan intactos. */
  almacenamiento.setItem(CLAVE_AUTH + "-code-verifier", "abc123/PASSWORD_RECOVERY");
  assert.equal(e.localStorage.getItem(CLAVE_AUTH + "-code-verifier"), "abc123/PASSWORD_RECOVERY");
  almacenamiento.setItem("x", JSON.stringify({ access_token: "a" }));
  assert.equal(e.localStorage.getItem("x"), JSON.stringify({ access_token: "a" }));
  almacenamiento.removeItem(CLAVE_AUTH);
  assert.equal(e.localStorage.getItem(CLAVE_AUTH), null);
  assert.ok(!e.localStorage._escrituras.includes(CLAVE), "nunca toca gymNutritionTracker");
});

test("19. no hay secretos en el código: ni service_role, ni Client Secret de Google, ni tokens", () => {
  const archivos = ["index.html", ...fs.readdirSync(path.join(RAIZ, "js")).map((f) => "js/" + f)];
  const texto = archivos.map((f) => fs.readFileSync(path.join(RAIZ, f), "utf8")).join("\n");
  assert.doesNotMatch(texto, /GOCSPX-/, "Client Secret de Google");
  assert.doesNotMatch(texto, /sb_secret_/, "secret key de Supabase");
  assert.doesNotMatch(texto, /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}/, "ningún JWT (service_role o anon legacy)");
  assert.doesNotMatch(texto, /ya29\.[A-Za-z0-9_-]{10,}/, "ningún token de Google");
  const auth = fs.readFileSync(path.join(RAIZ, "js/auth.js"), "utf8");
  const claves = auth.match(/sb_publishable_[A-Za-z0-9_-]+/g) || [];
  assert.equal(new Set(claves).size, 1, "solo la publishable key existente");
  assert.doesNotMatch(auth, /client_secret|clientSecret/i);
});

test("20. sync.js sin cambios (MD5)", () => {
  const md5 = crypto.createHash("md5").update(fs.readFileSync(path.join(RAIZ, "js/sync.js"))).digest("hex");
  assert.equal(md5, "4ed9478ca49c4a26e86a6c5710761024");
});
