/* Entorno mínimo para probar los módulos de la app en Node sin navegador:
   carga los scripts reales (js/*.js) en un contexto vm con un window falso,
   un localStorage en memoria (con inyección de fallas) y un cliente de
   Supabase falso que imita la tabla datos_usuario y las dos RPC. */
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");

const RAIZ = path.join(__dirname, "..");
const clonar = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

function crearLocalStorage() {
  const mapa = new Map();
  const fallas = new Set();
  const fallasRemove = new Set();
  const escrituras = [];
  /* Orden real de las operaciones de escritura: ["set"|"remove", clave]. */
  const operaciones = [];
  return {
    getItem: (k) => (mapa.has(k) ? mapa.get(k) : null),
    setItem: (k, v) => {
      if (fallas.has(k) || fallas.has("*")) throw new Error("QuotaExceededError");
      escrituras.push(k);
      operaciones.push(["set", k]);
      mapa.set(k, String(v));
    },
    removeItem: (k) => {
      if (fallasRemove.has(k)) throw new Error("SecurityError");
      operaciones.push(["remove", k]);
      mapa.delete(k);
    },
    _mapa: mapa,
    _fallas: fallas,
    _fallasRemove: fallasRemove,
    _operaciones: operaciones,
    _escrituras: escrituras
  };
}

/* Nube falsa. `fila` es la fila de datos_usuario del usuario logueado (o
   null). Las RPC aplican la misma regla que las funciones SQL: crear solo
   si no existe, actualizar solo si revision === p_expected_revision. */
function crearNube(opciones) {
  const nube = {
    fila: null,
    llamadas: [],
    antesDeActualizar: null,   // hook para simular otro dispositivo escribiendo justo antes
    omitirRevisionEnRespuesta: false,
    errorSelect: null,
    errorRpc: null,
    /* Si se define, la RPC de actualización responde esto sin tocar la fila
       (para simular respuestas del servidor como schema_downgrade). */
    respuestaActualizar: null
  };
  nube.cliente = {
    from(tabla) {
      return {
        select(columnas) {
          return {
            maybeSingle() {
              nube.llamadas.push({ tipo: "select", tabla, columnas });
              if (nube.errorSelect) return Promise.resolve({ data: null, error: nube.errorSelect });
              return Promise.resolve({ data: clonar(nube.fila), error: null });
            }
          };
        }
      };
    },
    rpc(nombre, params) {
      nube.llamadas.push({ tipo: "rpc", nombre, params: clonar(params) });
      if (nube.errorRpc) return Promise.resolve({ data: null, error: nube.errorRpc });
      if (nombre === "crear_datos_usuario_iniciales") {
        if (nube.fila) return Promise.resolve({ data: "already_exists", error: null });
        nube.fila = { data: clonar(params.p_data), schema_version: params.p_schema_version, revision: 1, updated_at: "2026-10-19T10:00:00Z" };
        return Promise.resolve({ data: "created", error: null });
      }
      if (nombre === "actualizar_datos_usuario_seguro" && nube.respuestaActualizar) {
        return Promise.resolve({ data: clonar(nube.respuestaActualizar), error: null });
      }
      if (nombre === "actualizar_datos_usuario_seguro") {
        if (nube.antesDeActualizar) { const f = nube.antesDeActualizar; nube.antesDeActualizar = null; f(nube); }
        if (!nube.fila) return Promise.resolve({ data: { status: "not_found" }, error: null });
        if (nube.fila.revision !== params.p_expected_revision) {
          return Promise.resolve({ data: { status: "conflict", revision: nube.fila.revision }, error: null });
        }
        nube.fila = {
          data: clonar(params.p_data), schema_version: params.p_schema_version,
          revision: nube.fila.revision + 1, updated_at: "2026-10-19T11:00:00Z"
        };
        const data = nube.omitirRevisionEnRespuesta ? { status: "updated" } : { status: "updated", revision: nube.fila.revision };
        return Promise.resolve({ data, error: null });
      }
      return Promise.resolve({ data: null, error: { message: "RPC desconocida" } });
    }
  };
  return nube;
}

/* Contenedor DOM falso: guarda el handler de click y devuelve un elemento
   persistente por selector, para leer mensajes/paneles después. */
function crearContenedor() {
  const elementos = new Map();
  const c = {
    handler: null,
    addEventListener(tipo, fn) { if (tipo === "click") c.handler = fn; },
    querySelector(sel) {
      if (!elementos.has(sel)) elementos.set(sel, { textContent: "", className: "", innerHTML: "", disabled: false });
      return elementos.get(sel);
    },
    click(accion) {
      c.handler({
        target: {
          closest: (sel) => (sel.indexOf('data-accion="' + accion + '"') !== -1 ? { dataset: { accion } } : null)
        }
      });
    },
    mensaje: () => elementos.get("#sync-mensaje") || { textContent: "", className: "" },
    panel: () => (elementos.get("#sync-conflicto-contenedor") || { innerHTML: "" }).innerHTML
  };
  return c;
}

function crearEntorno(opciones) {
  opciones = opciones || {};
  const localStorage = crearLocalStorage();
  const nube = crearNube();
  const registro = { alertas: [], confirmaciones: [], prompts: [], recargas: 0, timeouts: [] };
  const respuestas = { confirm: [], prompt: [] };

  const ctx = {
    console: { log() {}, warn() {}, error() {} },
    localStorage,
    document: {
      createElement() {
        const el = { _t: "" };
        Object.defineProperty(el, "textContent", { set(v) { el._t = v; }, get() { return el._t; } });
        Object.defineProperty(el, "innerHTML", {
          get() { return el._t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
        });
        return el;
      }
    },
    alert: (m) => { registro.alertas.push(m); },
    confirm: (m) => { registro.confirmaciones.push(m); return respuestas.confirm.length ? respuestas.confirm.shift() : false; },
    prompt: (m) => { registro.prompts.push(m); return respuestas.prompt.length ? respuestas.prompt.shift() : null; },
    location: { reload: () => { registro.recargas++; } },
    setTimeout: (fn) => { registro.timeouts.push(fn); return 0; }
  };
  ctx.window = ctx;
  vm.createContext(ctx);

  /* Reloj fijo opcional: `new Date()` y `Date.now()` sin argumentos
     devuelven siempre `opciones.ahora`, para que las funciones existentes
     que usan "hoy" (semana actual, rachas) sean deterministas en tests. */
  if (opciones.ahora) {
    vm.runInContext(
      "(function (fijo) {" +
      "  var R = Date;" +
      "  function D() { if (!new.target) return new R(fijo).toString();" +
      "    return arguments.length ? new (Function.prototype.bind.apply(R, [null].concat([].slice.call(arguments))))() : new R(fijo); }" +
      "  D.prototype = R.prototype; D.now = function () { return fijo; }; D.UTC = R.UTC; D.parse = R.parse;" +
      "  Date = D;" +
      "})(" + new Date(opciones.ahora).getTime() + ");",
      ctx
    );
  }

  /* Permite reemplazar cualquier módulo por otra versión (por ejemplo, la
     de HEAD) con variables de entorno: SYNC_JS, PROGRESO_JS, ... */
  const cargar = (archivo) => {
    const variable = path.basename(archivo, ".js").toUpperCase() + "_JS";
    const origen = process.env[variable] ? path.resolve(RAIZ, process.env[variable]) : path.join(RAIZ, archivo);
    vm.runInContext(fs.readFileSync(origen, "utf8"), ctx, { filename: archivo });
  };
  cargar("js/util.js");
  cargar("js/storage.js");
  cargar("js/rutinasHistoricas.js");

  const auth = { sesion: null, eventos: null, llamadas: [] };
  if (opciones.authReal) {
    /* SDK de Supabase falso: el cliente de datos es el de la nube falsa,
       más un objeto auth que registra llamadas. */
    nube.cliente.auth = {
      getSession: () => Promise.resolve({ data: { session: auth.sesion } }),
      onAuthStateChange: (fn) => { auth.eventos = fn; },
      signInWithPassword: (p) => { auth.llamadas.push(["signInWithPassword", p]); return Promise.resolve({ data: {}, error: null }); },
      signUp: (p) => { auth.llamadas.push(["signUp", p]); return Promise.resolve({ data: {}, error: null }); },
      signOut: () => { auth.llamadas.push(["signOut"]); return Promise.resolve({ error: null }); }
    };
    ctx.supabase = {
      createClient: (url, key, opts) => { registro.createClient = { url, key, opts }; return nube.cliente; }
    };
    cargar("js/auth.js");
  } else {
    ctx.GYMAPP.auth = {
      obtenerCliente: () => nube.cliente,
      obtenerSesion: () => auth.sesion
    };
  }
  if (opciones.sinSync !== true) cargar("js/sync.js");
  (opciones.modulos || []).forEach(cargar);

  return {
    ctx, GYMAPP: ctx.GYMAPP, localStorage, nube, registro, respuestas, auth, cargar,
    login(id, email) { auth.sesion = { user: { id: id || "uid-A", email: email || "a@test.com" } }; },
    logout() { auth.sesion = null; },
    leer(k) { const v = localStorage.getItem(k); return v == null ? null : JSON.parse(v); },
    escribir(k, v) { localStorage._mapa.set(k, JSON.stringify(v)); }
  };
}

/* Deja correr todas las promesas pendientes (las RPC falsas resuelven en
   microtareas). */
async function esperar() {
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
}

function datosEjemplo(extra) {
  return Object.assign({
    schema_version: 2,
    usuario: { nombre: "Nico", actividades: [{ tipo: "gimnasio", meta_semanal: 5 }] },
    rutina: { dias: [{ id: "d1", nombre: "Día 1", ejercicios: [] }] },
    sesiones_entrenamiento: [],
    registros_nutricion: [],
    base_alimentos: [],
    medidas_corporales: []
  }, extra || {});
}

module.exports = { crearEntorno, crearContenedor, esperar, datosEjemplo, clonar };
