/* Nombres reales de ejercicios históricos (mapa legacy del módulo
   compartido) en Progreso y en la edición de Entrenar.
   Correr con: node --test tests/*.test.js */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { crearEntorno, clonar } = require("./entorno");
const { datasetHistoricos } = require("./fixtures/historicos-dataset");

const CLAVE = "gymNutritionTracker";
const HOY = "2026-11-09";
const EMPUJE = "mu4c87ep730qj1", TRACCION = "mu4c87ep2snsau", TREN_SUPERIOR = "mu4c87eptjrn47";

function entorno(data) {
  const e = crearEntorno({ ahora: HOY + "T12:00:00", modulos: ["js/actividades.js", "js/entrenamiento.js", "js/progreso.js"] });
  e.escribir(CLAVE, data || datasetHistoricos({ legacy: true }));
  return { e, R: e.GYMAPP.rutinasHistoricas, P: e.GYMAPP.progreso, d: e.GYMAPP.storage.getData() };
}

function etiquetasEjercicios(P, d, bloqueId) {
  return clonar(P.distinguirEjerciciosEliminados(d, bloqueId, P.construirOpcionesEjerciciosDeBloque(d, bloqueId)).map((o) => o.nombre));
}

/* 1 y 2 */
test("resolverNombreEjercicioHistorico: conocidos → nombre real; desconocido → 'Ejercicio anterior'", () => {
  const { R, d } = entorno();
  assert.equal(R.resolverNombreEjercicioHistorico(d, "mu4c87epsr80xw"), "PRESS BANCA C/BARRA");
  assert.equal(R.resolverNombreEjercicioHistorico(d, "mu4c87epra2lxd"), "MARIPOSA");
  assert.equal(R.resolverNombreEjercicioHistorico(d, "mu4c87ep8spsdp"), "REMO T CON BARRA");
  assert.equal(R.resolverNombreEjercicioHistorico(d, "mu4c87epjry3ek"), "PRESS BANCA C/MANCUERNAS");
  assert.equal(R.resolverNombreEjercicioHistorico(d, "mu4c87ep0qejns"), "ROTACIÓN DE TRONCO Y CADERA DESDE POSICIÓN PRONA ( ALACRAN)");
  assert.equal(R.resolverNombreEjercicioHistorico(d, "mu4c87epqbyg9x"), "PRENSA 45º");
  assert.equal(R.resolverNombreEjercicioHistorico(d, "id-desconocido"), "Ejercicio anterior");
  assert.equal(R.nombreEjercicioConocido(d, "id-desconocido"), null);
  assert.equal(R.nombreEjercicioConocido(d, "toString"), null, "no confunde propiedades del objeto con IDs");
});

test("prioridad: un ejercicio de la rutina actual usa su nombre actual", () => {
  const data = datasetHistoricos({ legacy: true });
  data.rutina.dias[0].ejercicios.push({ id: "mu4c87epsr80xw", nombre: "Press banca (plan nuevo)", grupo_muscular: "", series_objetivo: 4, reps_objetivo: "8-10" });
  const { R, d } = entorno(data);
  assert.equal(R.resolverNombreEjercicioHistorico(d, "mu4c87epsr80xw"), "Press banca (plan nuevo)");
});

/* 3, 4, 8, 9 */
test("Evolución y Análisis: el selector de ejercicios del histórico muestra nombre real primero", () => {
  const { P, d } = entorno();
  assert.deepEqual(etiquetasEjercicios(P, d, EMPUJE), [
    "PRESS BANCA C/BARRA · máx. 60 kg",
    "PRESS INCLINADO EN SMITH · máx. 20 kg",
    "MARIPOSA · máx. 105 kg",
    "FLEXIONES DE BRAZO EN CAJON BAJO O STEP · peso corporal",
    "Ejercicio anterior · máx. 30 kg",
    "Ejercicio anterior · máx. 15 kg"
  ]);
  assert.deepEqual(etiquetasEjercicios(P, d, TRACCION).slice(0, 2), ["DOMINADAS TOMA NEUTRA · peso corporal", "REMO T CON BARRA · máx. 40 kg"]);
  assert.deepEqual(etiquetasEjercicios(P, d, TREN_SUPERIOR).slice(0, 2), ["PRESS BANCA C/MANCUERNAS · máx. 22 kg", "POLEA DORSAL AL PECHO TOMA AMPLIA · máx. 50 kg"]);

  /* Mismo helper en ambos selectores (Evolución y Análisis comparten renderSelectorBloqueEjercicio). */
  const opciones = P.distinguirEjerciciosEliminados(d, EMPUJE, P.construirOpcionesEjerciciosDeBloque(d, EMPUJE));
  ["select-evolucion", "select-analisis"].forEach((pref) => {
    const html = P.renderSelectorBloqueEjercicio(pref + "-bloque", pref + "-ejercicio", P.construirOpcionesBloquesActivos(d), P.construirOpcionesBloquesHistoricos(d), opciones, EMPUJE, "");
    assert.match(html, /<option value="mu4c87epsr80xw">PRESS BANCA C\/BARRA · máx\. 60 kg<\/option>/, pref);
    assert.doesNotMatch(html, /Ejercicio eliminado de la rutina/);
    assert.doesNotMatch(html, /Ejercicio anterior \d/);
  });
});

test("etiquetas iguales se distinguen con (2)", () => {
  const data = datasetHistoricos({ legacy: true });
  data.sesiones_entrenamiento.filter((s) => s.dia_rutina_id === EMPUJE)[0].ejercicios_realizados.push({ ejercicio_id: "otro-desconocido", series: [{ peso_kg: 30, reps: 10 }] });
  const { P, d } = entorno(data);
  const textos = etiquetasEjercicios(P, d, EMPUJE);
  assert.ok(textos.includes("Ejercicio anterior · máx. 30 kg") && textos.includes("Ejercicio anterior · máx. 30 kg (2)"), textos);
});

/* 5 y 6 */
test("ejercicio histórico: serie para el gráfico, análisis semanal y PROG-03 sin cambios de cálculo", () => {
  const { P, d } = entorno();
  const ej = P.reconstruirEjecucionesEjercicio(d.sesiones_entrenamiento, "mu4c87epsr80xw");
  assert.equal(ej.length, 4);
  assert.equal(ej[0].pesoMaximo, 60);
  const serie = P.construirSerieSemanalEjercicio(d.sesiones_entrenamiento, "mu4c87epsr80xw");
  assert.equal(P.contarSemanasRealizadas(serie), 4);
  const conCambios = P.construirSerieEjecucionesConCambios(ej);
  const ult = conCambios[conCambios.length - 1], ant = conCambios[conCambios.length - 2];
  const r = P.calcularRecomendacionEjercicio({
    cantidadEjecuciones: ej.length, pesoMaximoUltimo: ult.datos.pesoMaximo,
    cambioPesoMaximoPct: P.calcularCambioPorcentual(ult.datos.pesoMaximo, ant.datos.pesoMaximo),
    repsTotalesUltimo: ult.datos.repsTotales, cambioRepsPct: P.calcularCambioPorcentual(ult.datos.repsTotales, ant.datos.repsTotales),
    cambioVolumenPct: ult.cambioPct, tendenciaVolumen: ult.tendencia3, rpeSesion: ult.datos.rpeSesion,
    rangoReps: null, repsEnSeriesPrincipales: ult.datos.repsEnSeriesPrincipales
  });
  assert.notEqual(r.confianza, "insuficiente");
  assert.ok(typeof r.estado === "string" && r.estado.length > 0);
});

/* 7 y 8 (Entrenar) */
test("Entrenar → edición histórica: nombre real cuando hay mapping; texto de siempre si no", () => {
  const { e, d } = entorno();
  const html = e.GYMAPP.entrenamiento.renderHistorial(d);
  assert.doesNotMatch(html, /Día ya no existe en la rutina/);
  /* La edición se verifica en el e2e (necesita DOM); acá, la resolución que usa. */
  const R = e.GYMAPP.rutinasHistoricas;
  assert.equal(R.nombreEjercicioConocido(d, "mu4c87epd9q159"), "DOMINADAS TOMA NEUTRA");
  assert.equal(R.nombreEjercicioConocido(d, TRACCION + "-ej1"), null);
  const fuente = fs.readFileSync(path.join(__dirname, "..", "js", "entrenamiento.js"), "utf8");
  assert.match(fuente, /nombreEjercicioConocido\(data, er\.ejercicio_id\) \|\| "Ejercicio eliminado de la rutina"/);
});

/* 10 */
test("PROG-04 ignora los ejercicios históricos", () => {
  const con = entorno(datasetHistoricos({ legacy: true }));
  const sin = entorno(datasetHistoricos());
  const inputCon = con.P.construirInputEstadoPlan(con.d, HOY);
  inputCon.ejercicios.forEach((x) => assert.match(x.ejercicioId, /^D\d-e\d$/));
  assert.deepEqual(clonar(con.P.calcularEstadoPlan(inputCon)), clonar(sin.P.calcularEstadoPlan(sin.P.construirInputEstadoPlan(sin.d, HOY))));
});

/* 11, 12, 13 */
test("0 escrituras, sesiones intactas, schema 2 y sin sync", () => {
  const { e, P, R, d } = entorno();
  e.login();
  const antes = e.localStorage.getItem(CLAVE);
  const escrituras = e.localStorage._escrituras.length;
  [EMPUJE, TRACCION, TREN_SUPERIOR].forEach((b) => etiquetasEjercicios(P, d, b));
  R.resolverNombreEjercicioHistorico(d, "mu4c87epsr80xw");
  e.GYMAPP.entrenamiento.renderHistorial(d);
  P.calcularEstadoPlan(P.construirInputEstadoPlan(d, HOY));
  assert.equal(e.localStorage._escrituras.length, escrituras);
  assert.equal(e.localStorage.getItem(CLAVE), antes);
  assert.equal(JSON.parse(antes).schema_version, 2);
  assert.equal(e.nube.llamadas.length, 0);
});

/* 14 */
test("los IDs legacy (días y ejercicios) existen solo en js/rutinasHistoricas.js: 54 ejercicios + 5 días", () => {
  const dir = path.join(__dirname, "..", "js");
  const conIds = fs.readdirSync(dir).filter((f) => f.endsWith(".js") && /mu4c87/.test(fs.readFileSync(path.join(dir, f), "utf8")));
  assert.deepEqual(conIds, ["rutinasHistoricas.js"]);
  const fuente = fs.readFileSync(path.join(dir, "rutinasHistoricas.js"), "utf8");
  const bloque = fuente.slice(fuente.indexOf("var NOMBRES_EJERCICIOS_LEGACY"), fuente.indexOf("};", fuente.indexOf("var NOMBRES_EJERCICIOS_LEGACY")));
  const ids = bloque.match(/"mu4c87[a-z0-9]+"/g);
  assert.equal(ids.length, 54);
  assert.equal(new Set(ids).size, 54);
});
