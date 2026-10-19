/* Tests del historial de rutinas anteriores en Progreso.
   Correr con: node --test tests/*.test.js */
const test = require("node:test");
const assert = require("node:assert/strict");
const { crearEntorno, clonar } = require("./entorno");
const { datasetHistoricos } = require("./fixtures/historicos-dataset");

const CLAVE = "gymNutritionTracker";
const HOY = "2026-11-09";

function entorno(data) {
  const e = crearEntorno({ ahora: HOY + "T12:00:00", modulos: ["js/actividades.js", "js/progreso.js"] });
  e.escribir(CLAVE, data);
  return { e, P: e.GYMAPP.progreso, d: e.GYMAPP.storage.getData() };
}

function opcionesDe(html, id) {
  const m = html.match(new RegExp('<select id="' + id + '">([\\s\\S]*?)</select>'));
  if (!m) return null;
  return Array.from(m[1].matchAll(/<option value="([^"]*)"( selected)?>([^<]*)<\/option>/g)).map((x) => ({ value: x[1], selected: !!x[2], texto: x[3] }));
}

/* 1 */
test("5 activos + 5 históricos: el selector principal muestra solo los activos + acceso al historial", () => {
  const { P, d } = entorno(datasetHistoricos());
  const activos = P.construirOpcionesBloquesActivos(d);
  const historicos = P.construirOpcionesBloquesHistoricos(d);
  assert.equal(activos.length, 5);
  assert.equal(historicos.length, 5);
  const html = P.renderSelectorBloqueEjercicio("select-analisis-bloque", "select-analisis-ejercicio", activos, historicos, [], "D1", "");
  const principal = opcionesDe(html, "select-analisis-bloque");
  assert.deepEqual(principal.map((o) => o.texto), ["Día 1 · Pecho", "Día 2 · Espalda", "Día 3 · Piernas", "Día 4 · Hombros", "Día 5 · Brazos", "Historial de rutinas anteriores"]);
  assert.equal(principal[5].value, P.VALOR_HISTORIAL_RUTINAS);
  assert.equal(opcionesDe(html, "select-analisis-bloque-historico"), null, "sin segundo selector si hay un activo elegido");
});

/* 2 */
test("no aparecen opciones repetidas ni 'Bloque eliminado de la rutina'; etiquetas por fechas reales", () => {
  const { P, d } = entorno(datasetHistoricos());
  const historicos = P.construirOpcionesBloquesHistoricos(d);
  const textos = historicos.map((h) => h.nombre);
  assert.equal(new Set(textos).size, textos.length, "todas distintas");
  textos.forEach((t) => assert.doesNotMatch(t, /Bloque eliminado de la rutina/));
  assert.deepEqual(clonar(textos), [
    "Bloque anterior · 07/09–14/09 · 2 sesiones",
    "Bloque anterior · 07/09–14/09 · 2 sesiones (2)",
    "Bloque anterior · 04/08–08/09 · 6 sesiones",
    "Bloque anterior · 03/08–24/08 · 4 sesiones",
    "Bloque anterior · 05/08–19/08 · 3 sesiones"
  ]);
  const html = P.renderSelectorBloqueEjercicio("x", "y", P.construirOpcionesBloquesActivos(d), historicos, [], historicos[0].id, "");
  assert.doesNotMatch(html, /Bloque eliminado de la rutina/);
});

test("con sesiones en distintos años, la etiqueta incluye el año", () => {
  const data = datasetHistoricos();
  data.sesiones_entrenamiento.push({ id: "viejo", fecha: "2025-12-01T18:00:00", tipo: "gimnasio", dia_rutina_id: "old-2025", duracion_min: 50, rpe: 7, notas: "", ejercicios_realizados: [], futbol_detalle: null });
  const { P, d } = entorno(data);
  const textos = P.construirOpcionesBloquesHistoricos(d).map((h) => h.nombre);
  assert.ok(textos.includes("Bloque anterior · 01/12/25 · 1 sesión"));
  assert.ok(textos.includes("Bloque anterior · 04/08/26–08/09/26 · 6 sesiones"));
});

/* 3 */
test("el historial es accesible explícitamente con un segundo selector", () => {
  const { P, d } = entorno(datasetHistoricos());
  const historicos = P.construirOpcionesBloquesHistoricos(d);
  const html = P.renderSelectorBloqueEjercicio("select-evolucion-bloque", "select-evolucion-ejercicio", P.construirOpcionesBloquesActivos(d), historicos, [], "old-3", "");
  const principal = opcionesDe(html, "select-evolucion-bloque");
  assert.equal(principal.filter((o) => o.selected)[0].texto, "Historial de rutinas anteriores");
  const segundo = opcionesDe(html, "select-evolucion-bloque-historico");
  assert.equal(segundo.length, 5);
  assert.equal(segundo.filter((o) => o.selected)[0].value, "old-3");
  assert.match(html, /<label for="select-evolucion-bloque-historico">Bloque anterior<\/label>/);
});

test("sin históricos el selector queda igual que antes (sin opción de historial)", () => {
  const data = datasetHistoricos();
  data.sesiones_entrenamiento = data.sesiones_entrenamiento.filter((s) => /^D/.test(s.dia_rutina_id));
  const { P, d } = entorno(data);
  assert.deepEqual(clonar(P.construirOpcionesBloquesHistoricos(d)), []);
  const html = P.renderSelectorBloqueEjercicio("a", "b", P.construirOpcionesBloquesActivos(d), [], [], "D2", "");
  assert.doesNotMatch(html, /Historial de rutinas anteriores/);
  assert.equal(opcionesDe(html, "a").length, 5);
});

test("los ejercicios de un bloque histórico tienen etiquetas distinguibles (sin inventar nombres)", () => {
  const { P, d } = entorno(datasetHistoricos());
  const opciones = P.distinguirEjerciciosEliminados(d, "old-1", P.construirOpcionesEjerciciosDeBloque(d, "old-1"));
  assert.deepEqual(clonar(opciones.map((o) => o.nombre)), ["Ejercicio anterior 1 · máx. 25 kg", "Ejercicio anterior 2 · máx. 40 kg", "Ejercicio anterior 3 · peso corporal"]);
  const activos = P.distinguirEjerciciosEliminados(d, "D1", P.construirOpcionesEjerciciosDeBloque(d, "D1"));
  assert.deepEqual(clonar(activos.map((o) => o.nombre)), ["Día 1 · Pecho ej 1", "Día 1 · Pecho ej 2"], "los activos no cambian");
});

/* 4 */
test("los bloques históricos conservan todas sus sesiones", () => {
  const data = datasetHistoricos();
  const { e, P, d } = entorno(data);
  const antes = e.localStorage.getItem(CLAVE);
  const totalHistoricas = data.sesiones_entrenamiento.filter((s) => /^old-/.test(s.dia_rutina_id)).length;
  assert.equal(totalHistoricas, 17);
  const historicos = P.construirOpcionesBloquesHistoricos(d);
  assert.equal(historicos.reduce((a, h) => a + h.sesiones, 0), totalHistoricas);
  assert.equal(e.localStorage.getItem(CLAVE), antes);
  assert.equal(JSON.parse(e.localStorage.getItem(CLAVE)).sesiones_entrenamiento.length, data.sesiones_entrenamiento.length);
});

/* 5 y 6 */
test("Evolución y Análisis semanal de un bloque histórico siguen funcionando", () => {
  const { P, d } = entorno(datasetHistoricos());
  const serie = P.construirSerieSemanalBloque(d.sesiones_entrenamiento, "old-2");
  assert.equal(P.contarSemanasRealizadas(serie), 6);
  assert.equal(P.bloqueEsActivo(d, "old-2"), false);
  const ej = P.construirSerieEjecucionesConCambios(P.reconstruirEjecucionesEjercicio(d.sesiones_entrenamiento, "old-2-e1"));
  assert.equal(ej.length, 6);
  assert.ok(ej[5].datos.volumenTotal > 0);
  assert.ok(P.construirOpcionesBloquesAnalisis(d).some((o) => o.id === "old-2"), "sigue siendo una selección válida");
});

/* 7 */
test("PROG-04 ignora los bloques históricos (incluso si son recientes)", () => {
  const conReciente = entorno(datasetHistoricos({ historicoReciente: true }));
  const sinReciente = entorno(datasetHistoricos());
  const inputCon = conReciente.P.construirInputEstadoPlan(conReciente.d, HOY);
  const inputSin = sinReciente.P.construirInputEstadoPlan(sinReciente.d, HOY);
  assert.deepEqual(clonar(inputCon.bloques.map((b) => b.bloqueId)), ["D1", "D2", "D3", "D4", "D5"]);
  inputCon.ejercicios.forEach((e) => assert.match(e.ejercicioId, /^D\d-e\d$/));
  inputCon.sesionesRecientes.forEach((s) => assert.match(s.bloqueId, /^D\d$/));
  const rCon = conReciente.P.calcularEstadoPlan(inputCon);
  const rSin = sinReciente.P.calcularEstadoPlan(inputSin);
  assert.equal(rCon.senales.rpeAlto.activa, false, "las 3 sesiones RPE 10 del bloque eliminado no cuentan");
  assert.deepEqual(clonar(rCon), clonar(rSin));
  assert.equal(inputCon.inicioObservadoISO, "2026-10-12");
});

/* 8 */
test("sin cambios en localStorage ni en schema_version", () => {
  const { e, P, d } = entorno(datasetHistoricos({ historicoReciente: true }));
  const antes = e.localStorage.getItem(CLAVE);
  const escrituras = e.localStorage._escrituras.length;
  const historicos = P.construirOpcionesBloquesHistoricos(d);
  P.renderSelectorBloqueEjercicio("a", "b", P.construirOpcionesBloquesActivos(d), historicos, P.distinguirEjerciciosEliminados(d, "old-1", P.construirOpcionesEjerciciosDeBloque(d, "old-1")), "old-1", "");
  P.calcularEstadoPlan(P.construirInputEstadoPlan(d, HOY));
  assert.equal(e.localStorage._escrituras.length, escrituras);
  assert.equal(e.localStorage.getItem(CLAVE), antes);
  assert.equal(e.GYMAPP.storage.getDefaultData().schema_version, 2);
});

/* --- Compatibilidad legacy: nombres reales del plan anterior --- */

const LEGACY = [
  ["mu4c87ep730qj1", "EMPUJE"],
  ["mu4c87ep241kdy", "PIERNAS (ENFOQUE EN CUADRICEPS)"],
  ["mu4c87ep2snsau", "TRACCIÓN"],
  ["mu4c87epiiepiq", "PIERNAS (ENFOQUE EN ISQUIOS)"],
  ["mu4c87eptjrn47", "TREN SUPERIOR"]
];

LEGACY.forEach(([id, nombre], i) => {
  test("legacy " + (i + 1) + ": " + id + " → " + nombre, () => {
    const { P, d } = entorno(datasetHistoricos({ legacy: true }));
    const r = P.resolverNombreBloqueHistorico(d, id);
    assert.equal(r.nombre, nombre);
    const opcion = P.construirOpcionesBloquesHistoricos(d).filter((o) => o.id === id)[0];
    assert.match(opcion.nombre, new RegExp("^" + nombre.replace(/[()]/g, "\\$&") + " · \\d+ sesiones$"));
    assert.doesNotMatch(opcion.nombre, /\d\d\/\d\d/, "el identificador principal no son las fechas");
  });
});

test("ID histórico desconocido → fallback por fechas reales", () => {
  const { P, d } = entorno(datasetHistoricos({ legacy: true }));
  assert.equal(P.resolverNombreBloqueHistorico(d, "old-2"), null);
  assert.equal(P.resolverNombreBloqueHistorico(d, "id-que-no-existe"), null);
  const opcion = P.construirOpcionesBloquesHistoricos(d).filter((o) => o.id === "old-2")[0];
  assert.equal(opcion.nombre, "Bloque anterior · 04/08–08/09 · 6 sesiones");
});

test("selector histórico: los 5 días del plan anterior por nombre y en su orden, después los desconocidos", () => {
  const { P, d } = entorno(datasetHistoricos({ legacy: true }));
  const textos = clonar(P.construirOpcionesBloquesHistoricos(d).map((o) => o.nombre));
  assert.deepEqual(textos.slice(0, 5), [
    "EMPUJE · 4 sesiones",
    "PIERNAS (ENFOQUE EN CUADRICEPS) · 5 sesiones",
    "TRACCIÓN · 5 sesiones",
    "PIERNAS (ENFOQUE EN ISQUIOS) · 4 sesiones",
    "TREN SUPERIOR · 4 sesiones"
  ]);
  assert.equal(textos.length, 10);
  textos.slice(5).forEach((t) => assert.match(t, /^Bloque anterior · /));
  const html = P.renderSelectorBloqueEjercicio("select-analisis-bloque", "select-analisis-ejercicio", P.construirOpcionesBloquesActivos(d), P.construirOpcionesBloquesHistoricos(d), [], "mu4c87ep2snsau", "");
  assert.match(html, /<option value="mu4c87ep2snsau" selected>TRACCIÓN · 5 sesiones<\/option>/);
  assert.match(html, /<option value="__historial__" selected>Historial de rutinas anteriores<\/option>/);
});

test("un ID legacy que siga en la rutina actual usa su nombre actual (no el legacy)", () => {
  const data = datasetHistoricos({ legacy: true });
  data.rutina.dias.push({ id: "mu4c87ep730qj1", nombre: "Empuje (renombrado)", ejercicios: [] });
  const { P, d } = entorno(data);
  assert.ok(P.construirOpcionesBloquesActivos(d).some((o) => o.nombre === "Empuje (renombrado)"));
  assert.ok(!P.construirOpcionesBloquesHistoricos(d).some((o) => o.id === "mu4c87ep730qj1"));
});

test("legacy: Evolución y Análisis semanal siguen usando el dia_rutina_id real", () => {
  const { P, d } = entorno(datasetHistoricos({ legacy: true }));
  const serie = P.construirSerieSemanalBloque(d.sesiones_entrenamiento, "mu4c87ep241kdy");
  assert.equal(P.contarSemanasRealizadas(serie), 5);
  const ej = P.reconstruirEjecucionesEjercicio(d.sesiones_entrenamiento, "mu4c87ep241kdy-ej1");
  assert.equal(ej.length, 5);
});

test("legacy: PROG-04 sigue ignorando los bloques históricos", () => {
  const con = entorno(datasetHistoricos({ legacy: true }));
  const sin = entorno(datasetHistoricos());
  const rCon = con.P.calcularEstadoPlan(con.P.construirInputEstadoPlan(con.d, HOY));
  const rSin = sin.P.calcularEstadoPlan(sin.P.construirInputEstadoPlan(sin.d, HOY));
  assert.deepEqual(clonar(rCon), clonar(rSin));
});

test("legacy: 0 escrituras, sesiones e IDs intactos, schema 2, sin sync", () => {
  const data = datasetHistoricos({ legacy: true });
  const { e, P, d } = entorno(data);
  e.login();
  const antes = e.localStorage.getItem(CLAVE);
  const escrituras = e.localStorage._escrituras.length;
  LEGACY.forEach(([id]) => P.resolverNombreBloqueHistorico(d, id));
  P.construirOpcionesBloquesHistoricos(d);
  P.calcularEstadoPlan(P.construirInputEstadoPlan(d, HOY));
  assert.equal(e.localStorage._escrituras.length, escrituras);
  assert.equal(e.localStorage.getItem(CLAVE), antes);
  const guardado = JSON.parse(antes);
  LEGACY.forEach(([id]) => assert.ok(guardado.sesiones_entrenamiento.some((s) => s.dia_rutina_id === id), "conserva " + id));
  assert.equal(guardado.schema_version, 2);
  assert.equal(e.GYMAPP.storage.getDefaultData().schema_version, 2);
  assert.equal(e.nube.llamadas.length, 0);
  const leer = (f) => require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "js", f), "utf8");
  assert.equal((leer("rutinasHistoricas.js").match(/mu4c87/g) || []).length, 5, "los IDs legacy están solo en el mapa central");
  assert.equal((leer("progreso.js").match(/mu4c87/g) || []).length, 0);
  assert.equal((leer("entrenamiento.js").match(/mu4c87/g) || []).length, 0);
});
