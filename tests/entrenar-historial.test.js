/* Tests del historial de sesiones de Entrenar con bloques históricos.
   Correr con: node --test tests/*.test.js */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { crearEntorno, clonar } = require("./entorno");
const { datasetEntrenar } = require("./fixtures/entrenar-historial-dataset");

const CLAVE = "gymNutritionTracker";

function entorno() {
  const e = crearEntorno({ ahora: "2026-10-20T12:00:00", modulos: ["js/actividades.js", "js/entrenamiento.js", "js/progreso.js"] });
  e.escribir(CLAVE, datasetEntrenar());
  return { e, d: e.GYMAPP.storage.getData() };
}

/* Tarjetas del historial como [{ id, fecha, resumen }]. */
function tarjetas(html) {
  return Array.from(html.matchAll(/<div class="historial-item" data-sesion-id="([^"]+)">[\s\S]*?<span class="historial-item-fecha">([^<]*)<\/span><span class="historial-item-resumen">([^<]*)<\/span>/g))
    .map((m) => ({ id: m[1], fecha: m[2], resumen: m[3] }));
}

test("resolverNombreDiaRutina: activo, legacy conocidos y desconocido", () => {
  const { e, d } = entorno();
  const R = e.GYMAPP.rutinasHistoricas;
  assert.equal(R.resolverNombreDiaRutina(d, "nuevo-1"), "Día 1 · Pecho y tríceps");
  assert.equal(R.resolverNombreDiaRutina(d, "mu4c87ep730qj1"), "EMPUJE");
  assert.equal(R.resolverNombreDiaRutina(d, "mu4c87ep241kdy"), "PIERNAS (ENFOQUE EN CUADRICEPS)");
  assert.equal(R.resolverNombreDiaRutina(d, "mu4c87ep2snsau"), "TRACCIÓN");
  assert.equal(R.resolverNombreDiaRutina(d, "mu4c87epiiepiq"), "PIERNAS (ENFOQUE EN ISQUIOS)");
  assert.equal(R.resolverNombreDiaRutina(d, "mu4c87eptjrn47"), "TREN SUPERIOR");
  assert.equal(R.resolverNombreDiaRutina(d, "id-historico-desconocido"), "Bloque anterior");
});

test("prioridad: un ID legacy que siga en la rutina actual usa su nombre actual", () => {
  const { e, d } = entorno();
  e.GYMAPP.planes.agregarDiaAlPlanActivo(d, { id: "mu4c87ep730qj1", nombre: "Empuje v2", ejercicios: [] });
  assert.equal(e.GYMAPP.rutinasHistoricas.resolverNombreDiaRutina(d, "mu4c87ep730qj1"), "Empuje v2");
});

/* 1-8 */
test("historial de Entrenar: nombres reales, fallback neutral, cantidad de ejercicios y fútbol intacto", () => {
  const { e, d } = entorno();
  const html = e.GYMAPP.entrenamiento.renderHistorial(d);
  const t = tarjetas(html);
  const por = Object.fromEntries(t.map((x) => [x.id, x]));

  assert.equal(por["n-1910"].resumen, "🏋️ Día 1 · Pecho y tríceps · 2 ejercicios", "1. activa -> nombre actual");
  assert.equal(por["h-1310"].resumen, "🏋️ EMPUJE · 10 ejercicios", "2. EMPUJE");
  assert.equal(por["h-0510"].resumen, "🏋️ EMPUJE · 10 ejercicios");
  assert.equal(por["h-1510"].resumen, "🏋️ TRACCIÓN · 10 ejercicios", "3. TRACCIÓN");
  assert.equal(por["h-0810"].resumen, "🏋️ TRACCIÓN · 10 ejercicios");
  assert.equal(por["h-1610"].resumen, "🏋️ TREN SUPERIOR · 10 ejercicios", "4. TREN SUPERIOR");
  assert.equal(por["h-0216"].resumen, "🏋️ TREN SUPERIOR · 10 ejercicios");
  assert.equal(por["x-desc"].resumen, "🏋️ Bloque anterior · 3 ejercicios", "5. desconocido");
  assert.doesNotMatch(html, /Día ya no existe en la rutina/, "6");
  assert.doesNotMatch(html, /histórico|eliminado/i);
  assert.equal(por["f-1710"].resumen, "⚽ Fútbol · Partido · 80 min", "8. fútbol sin cambios");

  /* Orden y fechas como antes (más reciente primero). */
  assert.deepEqual(clonar(t.map((x) => x.fecha + " " + x.resumen.replace(/^🏋️ |^⚽ /, ""))).slice(0, 7), [
    "19/10/2026 Día 1 · Pecho y tríceps · 2 ejercicios",
    "17/10/2026 Fútbol · Partido · 80 min",
    "16/10/2026 TREN SUPERIOR · 10 ejercicios",
    "15/10/2026 TRACCIÓN · 10 ejercicios",
    "13/10/2026 EMPUJE · 10 ejercicios",
    "08/10/2026 TRACCIÓN · 10 ejercicios",
    "05/10/2026 EMPUJE · 10 ejercicios"
  ]);
});

test("una sesión sin ejercicios o con 1 ejercicio mantiene el texto de cantidad", () => {
  const { e, d } = entorno();
  d.sesiones_entrenamiento.push({ id: "uno", fecha: "2026-09-01T10:00:00", tipo: "gimnasio", dia_rutina_id: "mu4c87epiiepiq", duracion_min: 30, rpe: 6, notas: "", ejercicios_realizados: [{ ejercicio_id: "z", series: [] }], futbol_detalle: null });
  const t = tarjetas(e.GYMAPP.entrenamiento.renderHistorial(d));
  assert.equal(t.filter((x) => x.id === "uno")[0].resumen, "🏋️ PIERNAS (ENFOQUE EN ISQUIOS) · 1 ejercicio");
});

/* 11-13 */
test("renderizar el historial no escribe localStorage, no cambia schema ni toca sync", () => {
  const { e, d } = entorno();
  e.login();
  const antes = e.localStorage.getItem(CLAVE);
  const escrituras = e.localStorage._escrituras.length;
  e.GYMAPP.entrenamiento.renderHistorial(d);
  assert.equal(e.localStorage._escrituras.length, escrituras);
  assert.equal(e.localStorage.getItem(CLAVE), antes);
  assert.equal(JSON.parse(antes).schema_version, 3);
  assert.equal(e.GYMAPP.storage.getDefaultData().schema_version, 3);
  assert.equal(e.nube.llamadas.length, 0);
  const leer = (f) => fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8");
  ["entrenamiento.js", "rutinasHistoricas.js"].forEach((f) => assert.doesNotMatch(leer(f), /GYMAPP\.sync|localStorage\./, f));
});

/* 14 */
test("Progreso sigue resolviendo los históricos igual que antes", () => {
  const { e, d } = entorno();
  const P = e.GYMAPP.progreso;
  const textos = clonar(P.construirOpcionesBloquesHistoricos(d).map((o) => o.nombre));
  assert.deepEqual(textos, ["EMPUJE · 2 sesiones", "TRACCIÓN · 2 sesiones", "TREN SUPERIOR · 2 sesiones", "Bloque anterior · 20/09 · 1 sesión"]);
  assert.equal(P.resolverNombreBloqueHistorico(d, "mu4c87ep2snsau").nombre, "TRACCIÓN");
  assert.equal(P.resolverNombreBloqueHistorico(d, "id-historico-desconocido"), null);
});

test("el mapa legacy existe en un único archivo", () => {
  const dir = path.join(__dirname, "..", "js");
  const conIds = fs.readdirSync(dir).filter((f) => f.endsWith(".js") && /mu4c87/.test(fs.readFileSync(path.join(dir, f), "utf8")));
  assert.deepEqual(conIds, ["rutinasHistoricas.js"]);
});
