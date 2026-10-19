/* Regresión de PROG-01/01.1/01.2/02/03, fechas/rachas, ACT, Dashboard y
   cálculos: compara las salidas de las funciones existentes contra un
   snapshot generado con la versión ANTERIOR a PROG-04.
     node --test tests/*.test.js
   Regenerar el snapshot (solo a propósito, desde la versión base):
     GENERAR_SNAPSHOT=1 PROGRESO_JS=/ruta/progreso_base.js node --test tests/progreso-regresion.test.js */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { crearEntorno, clonar } = require("./entorno");

/* El snapshot guarda un hash por clave (no la salida completa) para no
   sumar megas al repo; el test indica qué clave difiere. */
const huella = (v) => crypto.createHash("sha256").update(JSON.stringify(v)).digest("hex");

const SNAPSHOT = path.join(__dirname, "fixtures", "progreso-base-snapshot.json");
const AHORA = "2026-11-09T12:00:00";

function sumarDias(iso, n) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
const s = (peso, reps) => reps.map((r) => ({ peso_kg: peso, reps: r }));

/* Dataset variado: progreso, caídas, subida de carga, peso corporal,
   semana vacía, bloque eliminado, fútbol y una sesión cerca de medianoche. */
function dataset() {
  const ses = [];
  let n = 0;
  const gym = (fecha, dia, rpe, ej, hora) => ses.push({
    id: "g" + (++n), fecha: fecha + "T" + (hora || "18:00:00"), tipo: "gimnasio", dia_rutina_id: dia, duracion_min: 60, rpe, notas: "",
    futbol_detalle: null, ejercicios_realizados: Object.keys(ej).map((id) => ({ ejercicio_id: id, series: ej[id] }))
  });
  const lunes = "2026-10-05";
  const planes = [
    { a1: s(20, [10]).concat(s(25, [12, 12, 12, 12])), a2: s(60, [10, 10, 10, 10]), a3: s(0, [15, 15, 12]) },
    { a1: s(20, [10]).concat(s(25, [12, 12, 12, 13])), a2: s(60, [10, 10, 9, 8]), a3: s(0, [15, 15, 14]) },
    null,
    { a1: s(20, [10]).concat(s(27.5, [9, 9, 8, 8])), a2: s(62.5, [8, 8, 8, 8]), a3: s(0, [12, 12, 10]) },
    { a1: s(17, [10]).concat(s(20, [8]), s(27.5, [10, 10, 9, 9])), a2: s(60, [12, 12, 12, 12]), a3: s(0, [16, 16, 15]) },
    { a1: s(27.5, [10, 10, 10, 10]), a2: s(60, [11, 11, 10, 10]), a3: s(0, [16, 16, 16]) }
  ];
  planes.forEach((ej, i) => {
    const l = sumarDias(lunes, i * 7);
    if (ej) gym(sumarDias(l, 1), "A", [7, 8, 7, 9, 6, 10][i], ej);
    if (i !== 2) gym(sumarDias(l, 3), "B", [6, 7, 8, 8, 9, 7][i], { b1: s(40, [8, 8, 8 + (i % 3)]), b2: s(15, [12, 12, 10 + i]) });
  });
  gym("2026-10-18", "VIEJO", 8, { x1: s(30, [10, 10]) }, "23:45:00");
  ses.push({ id: "f1", fecha: "2026-11-07T20:00:00", tipo: "futbol", dia_rutina_id: null, duracion_min: 90, rpe: 9, notas: "", ejercicios_realizados: [], futbol_detalle: null });
  return {
    schema_version: 2,
    usuario: { nombre: "Nico", fecha_nacimiento: "1990-05-10", sexo: "masculino", peso_kg: 80, altura_cm: 178, objetivo: "mantenimiento", nivel_actividad: "moderado",
      actividades: [{ tipo: "gimnasio", meta_semanal: 2 }, { tipo: "futbol", meta_semanal: 1 }] },
    rutina: { dias: [
      { id: "A", nombre: "Bloque A", ejercicios: [{ id: "a1", nombre: "Press", grupo_muscular: "Pecho", series_objetivo: 4, reps_objetivo: "10-12" }, { id: "a2", nombre: "Remo", grupo_muscular: "Espalda", series_objetivo: 4, reps_objetivo: "10/10" }, { id: "a3", nombre: "Dominadas", grupo_muscular: "Espalda", series_objetivo: 3, reps_objetivo: "12" }] },
      { id: "B", nombre: "Bloque B", ejercicios: [{ id: "b1", nombre: "Sentadilla", grupo_muscular: "Piernas", series_objetivo: 3, reps_objetivo: "8 a 10" }, { id: "b2", nombre: "Curl", grupo_muscular: "Bíceps", series_objetivo: 3, reps_objetivo: "al fallo" }] }
    ] },
    sesiones_entrenamiento: ses,
    registros_nutricion: [], base_alimentos: [],
    medidas_corporales: [{ fecha: "2026-10-01", peso_kg: 81 }, { fecha: "2026-11-01", peso_kg: 80.2 }]
  };
}

function calcularSalidas() {
  const e = crearEntorno({ ahora: AHORA, modulos: ["js/actividades.js", "js/calculos.js", "js/progreso.js", "js/dashboard.js"] });
  const data = dataset();
  e.escribir("gymNutritionTracker", data);
  const G = e.GYMAPP;
  const P = G.progreso;
  const d = G.storage.getData();
  const out = {};
  const guardar = (k, fn) => { try { out[k] = clonar(fn()); } catch (err) { out[k] = "ERROR: " + err.message; } };

  /* Fechas / rachas */
  guardar("diasActivos", () => P.obtenerDiasActivosOrdenados(d.sesiones_entrenamiento));
  guardar("rachas", () => P.calcularRachas(P.obtenerDiasActivosOrdenados(d.sesiones_entrenamiento)));
  guardar("semanas", () => ["2026-11-09", "2026-11-15", "2026-10-18", "2026-12-31"].map((f) => [P.inicioDeSemanaISO(f), P.finDeSemanaISO(P.inicioDeSemanaISO(f))]));
  guardar("rango", () => P.generarRangoSemanas("2026-10-05", "2026-11-09"));
  guardar("esSemanaEnCurso", () => ["2026-11-09", "2026-11-02"].map(P.esSemanaEnCurso));

  /* PROG-01 / 01.1 / 01.2 */
  guardar("clasificar", () => [null, -3, 0, 1.9, 2, 5, 5.1, 8, 8.1, 30].map(P.clasificarProgreso));
  guardar("cambioPct", () => [[10, 8], [0, 0], [5, 0], [8, null]].map((x) => P.calcularCambioPorcentual(x[0], x[1])));
  guardar("volumenSesion", () => d.sesiones_entrenamiento.map(P.volumenSesionCompleta));
  guardar("opcionesBloques", () => P.construirOpcionesBloquesAnalisis(d));
  guardar("opcionesEjA", () => P.construirOpcionesEjerciciosDeBloque(d, "A"));
  ["A", "B", "VIEJO"].forEach((b) => {
    guardar("serieBloque_" + b, () => P.construirSerieSemanalBloque(d.sesiones_entrenamiento, b));
    guardar("frecuencia_" + b, () => [0, 1, 2].map((n) => P.obtenerEstadoFrecuenciaSemanal(n, P.bloqueEsActivo(d, b))));
  });
  ["a1", "a2", "a3", "b1", "b2", "x1"].forEach((id) => {
    guardar("serieEj_" + id, () => P.construirSerieSemanalEjercicio(d.sesiones_entrenamiento, id));
    guardar("ejecuciones_" + id, () => P.construirSerieEjecucionesConCambios(P.reconstruirEjecucionesEjercicio(d.sesiones_entrenamiento, id)));
  });
  guardar("filas", () => {
    const serie = P.construirSerieSemanalBloque(d.sesiones_entrenamiento, "A");
    const ult = P.obtenerUltimaSemanaRealizada(serie);
    const serieEj = P.construirSerieSemanalEjercicio(d.sesiones_entrenamiento, "a1");
    const ultEj = P.obtenerUltimaSemanaRealizada(serieEj);
    return {
      bloque: P.filasVolumenBloque(ult.datos), ej: P.filasVolumenEjercicio(ultEj.datos),
      ultBloque: P.filasUltimaSemanaRealizadaBloque(ult.datos), ultEj: P.filasUltimaSemanaRealizadaEjercicio(ultEj.datos),
      historial: serie.map(P.formatearCambioHistorial), realizadas: P.contarSemanasRealizadas(serie), adherenciaBaja: P.calcularAdherenciaBaja(serie)
    };
  });

  /* PROG-02: grilla de entradas */
  const prog02 = [];
  [null, -12, -3, 0, 1.5, 3, 5, 6.5, 8, 9, 20].forEach((uc) => [null, 5, 7, 8, 9, 10].forEach((rpe) => [null, -2, 4, 9].forEach((t) => [1, 2, 3].forEach((c) => [false, true].forEach((ab) => {
    prog02.push(P.calcularRecomendacionProximaSesion({ ultimoCambio: uc, tendencia3: t, rpe, volumenUltimaSesion: 4800, cantidadSesiones: c, adherenciaBaja: ab }));
  })))));
  out.prog02 = clonar(prog02);

  /* PROG-03: grilla de entradas */
  const prog03 = [];
  [0, 25].forEach((peso) => [null, -10, 0, 10].forEach((cp) => [0, 40].forEach((rt) => [null, -20, -6, 0, 5].forEach((cr) => [null, -16, 0, 20].forEach((cv) => [null, 9].forEach((tv) => [null, 7, 9].forEach((rpe) => [null, { min: 10, max: 12 }].forEach((rango) => {
    prog03.push(P.calcularRecomendacionEjercicio({
      cantidadEjecuciones: cp === null ? 1 : 3, pesoMaximoUltimo: peso, cambioPesoMaximoPct: cp, repsTotalesUltimo: rt, cambioRepsPct: cr,
      cambioVolumenPct: cv, tendenciaVolumen: tv, rpeSesion: rpe, rangoReps: rango, repsEnSeriesPrincipales: [12, 12, 11]
    }));
  }))))))));
  out.prog03 = clonar(prog03);
  guardar("parsearRango", () => ["10-12", "10 – 12", "10 a 12", "12", "10/10", "al fallo", "", null, "12-10"].map(P.parsearRangoReps));
  guardar("ejRutina", () => [P.obtenerEjercicioDeRutina(d, "A", "a2"), P.obtenerEjercicioDeRutina(d, "VIEJO", "x1")]);

  /* ACT */
  guardar("act", () => ({
    catalogo: G.actividades.obtenerCatalogo(),
    usuario: G.actividades.obtenerActividadesUsuario(d.usuario),
    usuarioSinActividades: G.actividades.obtenerActividadesUsuario({ nombre: "x" }),
    detalle: d.sesiones_entrenamiento.map(G.actividades.obtenerDetalleSesion),
    porDia: G.actividades.obtenerActividadesPorDia(d.sesiones_entrenamiento)
  }));

  /* Dashboard y cálculos */
  guardar("dashboard", () => ({
    resumen: G.dashboard.calcularResumenSemanal(d),
    progreso: G.dashboard.calcularProgresoSemanal(d),
    alerta: G.dashboard.calcularAlertaGrupoMuscular(d),
    variacionPeso: G.dashboard.calcularVariacionPeso(d),
    hoy: G.dashboard.obtenerActividadesHoy(d)
  }));
  guardar("calculos", () => ({
    edad: G.calculos.calcularEdad("1990-05-10"),
    tmb: G.calculos.calcularTMB(d.usuario),
    macros: G.calculos.calcularMetasMacros(d.usuario)
  }));

  out.escrituras = e.localStorage._escrituras.slice();
  return out;
}

test("PROG-01/02/03, rachas, ACT, Dashboard y cálculos: salidas idénticas a la versión anterior", () => {
  const salidas = calcularSalidas();
  const huellas = {};
  Object.keys(salidas).sort().forEach((k) => { huellas[k] = huella(salidas[k]); });
  huellas._cantidades = huella({ prog02: salidas.prog02.length, prog03: salidas.prog03.length });
  if (process.env.GENERAR_SNAPSHOT === "1") {
    fs.writeFileSync(SNAPSHOT, JSON.stringify(huellas, null, 1) + "\n");
    return;
  }
  const esperado = JSON.parse(fs.readFileSync(SNAPSHOT, "utf8"));
  assert.deepEqual(Object.keys(huellas).sort(), Object.keys(esperado).sort());
  Object.keys(esperado).forEach((k) => assert.equal(huellas[k], esperado[k], "difiere: " + k));
});

test("el dataset de regresión cubre casos reales (sin errores, grillas completas)", () => {
  const salidas = calcularSalidas();
  assert.ok(salidas.prog02.length > 1000 && salidas.prog03.length > 1000);
  const errores = Object.keys(salidas).filter((k) => typeof salidas[k] === "string" && salidas[k].indexOf("ERROR") === 0);
  assert.deepEqual(errores, []);
  assert.ok(salidas.serieBloque_A.length >= 5);
  assert.ok(salidas.rachas.maxima >= 1);
  assert.deepEqual(salidas.escrituras, [], "ninguna función analizada escribe localStorage");
});
