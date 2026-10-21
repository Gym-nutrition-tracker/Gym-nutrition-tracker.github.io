/* E6.5: carga sugerida (peso orientativo). Clasificación, selección de
   referencias A > B > C > D, cálculo, confianza y que nada se escriba.
   La UI en Entrenar está en tests/e2e/carga-sugerida.e2e.js.
   Correr con: node --test tests/*.test.js */
const test = require("node:test");
const assert = require("node:assert/strict");
const { crearEntorno, clonar, aE3 } = require("./entorno");
const { datasetHistoricos } = require("./fixtures/historicos-dataset");
const F = require("./fixtures/historial-cargas");

const CLAVE = "gymNutritionTracker";
const HOY = "2026-11-09";
const MODULOS = ["js/actividades.js", "js/progreso.js", "js/recomendacionCarga.js"];

function entorno(datos) {
  const e = crearEntorno({ ahora: HOY + "T12:00:00", sinSync: true, modulos: MODULOS });
  if (datos) e.escribir(CLAVE, datos);
  return e;
}

/* Recomendación para el (único o n-ésimo) ejercicio del plan activo. */
function recomendar(datos, nombreObjetivo) {
  const e = entorno(datos);
  const R = e.GYMAPP.recomendacionCarga;
  const data = e.GYMAPP.storage.getData();
  const plan = e.GYMAPP.planes.planActivo(data);
  const ej = plan.dias.flatMap((d) => d.ejercicios).find((x) => !nombreObjetivo || x.nombre === nombreObjetivo);
  return clonar(R.recomendar(R.construirIndiceHistorial(data), ej, { hoy: HOY, contexto: R.contextoPlan(plan) }));
}

const clasificar = (nombre, extra) => clonar(entorno().GYMAPP.recomendacionCarga.clasificarEjercicio(Object.assign({ nombre }, extra || {})));
const serie = F.serie;

/* Historial de un ejercicio (3 sesiones) y objetivo, con F.caso. */
const h = (nombre, series, extra) => ({ ejercicio: Object.assign({ nombre }, extra || {}), series });
const tres = (f) => [0, 1, 2].map(f);

/* --- Clasificación --- */

test("clasificación: patrón, familia, implemento, lateralidad y tipo desde el nombre (no hardcodeado)", () => {
  const casos = [
    ["PRESS BANCA C/BARRA", { patron: "empuje_horizontal", familia: "press_plano", implemento: "barra", lateralidad: "bilateral", tipo: "principal" }],
    ["Press inclinado en Smith", { patron: "empuje_horizontal", familia: "press_inclinado", implemento: "smith" }],
    ["press militar arrodillado con mancuernas", { patron: "empuje_vertical", familia: "press_hombro", implemento: "mancuernas", postura: "arrodillado", unidades: 2 }],
    ["REMO CON MANCUERNA A 1 BRAZO", { patron: "traccion_horizontal", implemento: "mancuernas", lateralidad: "unilateral", unidades: 1 }],
    ["REMO BAJO POLEA TOMA UNILATERAL", { implemento: "polea", lateralidad: "unilateral", porLado: true }],
    ["Jalón al pecho en polea", { patron: "traccion_vertical", familia: "jalon", implemento: "polea" }],
    ["SENTADILLA C/BARRA", { patron: "sentadilla", familia: "sentadilla", implemento: "barra" }],
    ["PESO MUERTO RUMANO EN SMITH", { patron: "bisagra", familia: "peso_muerto", implemento: "smith" }],
    ["SILLON DE CUADRICEPS", { patron: "extension_rodilla", implemento: "maquina", tipo: "accesorio" }],
    ["CURL FEMORAL ACOSTADO", { patron: "flexion_rodilla", implemento: "maquina" }],
    ["GEMELOS EN PRENSA HACK", { patron: "pantorrilla" }],
    ["BICEPS MARTILLO EN POLEA", { patron: "biceps", implemento: "polea" }],
    ["PRESS FRANCES C/BARRA", { patron: "triceps", implemento: "barra" }],
    ["Máquina abductora", { patron: "aduccion_abduccion", implemento: "maquina" }],
    ["PRESS PALLOF EN POSICION DE ESTOCADA", { patron: "core_antirotacion" }],
    ["SIT UPS", { patron: "core_flexion" }],
    ["ESTOCADA BULGARA C/MANCUERNA", { patron: "sentadilla", familia: "zancada", lateralidad: "unilateral", unidades: 2 }],
    ["SWING C/KETTLEBELL", { patron: "bisagra", implemento: "kettlebell", unidades: 1 }],
    ["DOMINADAS TOMA NEUTRA", { patron: "traccion_vertical", implemento: "peso_corporal", sinCargaExterna: true }],
    ["ROTACION TORACICA EN CUADRUPEDIA CON BRAZOS EXTENDIDOS", { tipo: "movilidad", sinCargaExterna: true }]
  ];
  casos.forEach(([nombre, esperado]) => {
    const c = clasificar(nombre);
    Object.keys(esperado).forEach((k) => assert.equal(c[k], esperado[k], nombre + " → " + k));
  });
});

test("clasificación usa comentarios y reps: 'UNILATERAL, CON MANCUERNAS' y '10/10'", () => {
  const c = clasificar("ELEVACIONES DE CADERA EN BANCO C/BARRA", { comentarios: "UNILATERAL, CON MANCUERNAS", reps_objetivo: "10/10" });
  assert.equal(c.implemento, "mancuernas");
  assert.equal(c.lateralidad, "unilateral");
  /* "usar la barra de arriba" no cambia la Smith a barra. */
  assert.equal(clasificar("PRESS INCLINADO EN SMITH", { comentarios: "SI ESTA OCUPADA, USAR LA BARRA DE ARRIBA" }).implemento, "smith");
  assert.equal(clasificar("ESTOCADAS", { reps_objetivo: "10/10" }).lateralidad, "unilateral");
});

test("clasificación usa el plan: sin RIR/RPE y 1-2 series en un plan con intensidad → activación", () => {
  const R = entorno().GYMAPP.recomendacionCarga;
  const ej = { nombre: "EJERCICIO NUEVO DESCONOCIDO", series_objetivo: 2, reps_objetivo: "8" };
  assert.equal(R.clasificarEjercicio(ej, { planConIntensidad: true }).tipo, "movilidad");
  assert.notEqual(R.clasificarEjercicio(ej, { planConIntensidad: false }).tipo, "movilidad");
  assert.notEqual(R.clasificarEjercicio(Object.assign({}, ej, { rir_objetivo: "2" }), { planConIntensidad: true }).tipo, "movilidad");
});

/* --- Ejercicios sin carga --- */

test("movilidad: nunca kilos, aunque haya historial relacionado (caso D)", () => {
  const r = recomendar(F.CASOS.D());
  assert.equal(r.tipo, "movilidad");
  assert.equal(r.kg, undefined);
  ["ADUCCION ESCAPULAR C/BANDA", "CANDELABRO NIVEL 3", "MOVILIDAD DE CADERA 90/90 COMPLETA", "SALUDO AL SOL + CARPA", "MANGUITO ROTADOR CON BANDA (NIVEL 3)"]
    .forEach((n) => assert.equal(clasificar(n).tipo, "movilidad", n));
  assert.equal(entorno().GYMAPP.recomendacionCarga.renderSugerencia(r), "", "sin tarjeta de peso");
});

test("peso corporal y banda: 'Sin carga externa sugerida'", () => {
  const datos = F.caso([h("PRESS BANCA C/BARRA", tres(() => serie(60, [8, 8, 8])))], { nombre: "FONDOS EN PARALELAS", series_objetivo: 4, reps_objetivo: "6-8", rir_objetivo: "1-2" });
  const r = recomendar(datos);
  assert.equal(r.tipo, "sin_carga");
  assert.match(entorno().GYMAPP.recomendacionCarga.renderSugerencia(r), /Sin carga externa sugerida/);
  const banda = F.caso([h("PESO MUERTO RUMANO EN SMITH", tres(() => serie(60, [8, 8])))], { nombre: "PESO MUERTO EN STEP CON BANDA", reps_objetivo: "10/10", rir_objetivo: "2" });
  assert.equal(recomendar(banda).tipo, "sin_carga");
  const iso = F.caso([h("DOMINADAS TOMA NEUTRA", tres(() => serie(0, [8])))], { nombre: "DOMINADA ISOMETRICA", reps_objetivo: "15-30''", rir_objetivo: "1" });
  assert.equal(recomendar(iso).tipo, "sin_carga");
});

test("peso corporal con lastre: solo desde su propio historial con kg", () => {
  const datos = F.caso([h("FONDOS EN PARALELAS", tres(() => serie(10, [8, 8, 7])))], { nombre: "FONDOS EN PARALELAS", series_objetivo: 4, reps_objetivo: "6-8", rir_objetivo: "1-2" });
  const r = recomendar(datos);
  assert.equal(r.tipo, "sugerencia");
  assert.equal(r.nivel, "A");
});

/* --- A: mismo ejercicio --- */

test("A. mismo ejercicio: alta confianza, mismas reps → cerca de la carga habitual", () => {
  const datos = F.caso([h("PRESS BANCA C/BARRA", tres((k) => serie(40, [10]).concat(serie(60, [8, 8, 8]))), { reps: "8" })],
    { nombre: "PRESS BANCA C/BARRA", series_objetivo: 4, reps_objetivo: "8", rir_objetivo: null });
  const r = recomendar(datos);
  assert.equal(r.nivel, "A");
  assert.equal(r.confianza, "alta");
  assert.equal(r.kg, 60);
  assert.equal(r.ultimaReferencia.carga, 60);
  assert.match(r.explicacion[0], /últimas 3 ejecuciones de este ejercicio \(la última: 60 kg × 8\)/);
});

test("A. mismo ejercicio con más reps objetivo → carga menor; con menos reps → mayor", () => {
  const hist = [h("PRESS BANCA C/BARRA", tres(() => serie(60, [8, 8, 8])))];
  const r8 = recomendar(F.caso(hist, { nombre: "PRESS BANCA C/BARRA", reps_objetivo: "8" }));
  const r12 = recomendar(F.caso(hist, { nombre: "PRESS BANCA C/BARRA", reps_objetivo: "10-12" }));
  const r5 = recomendar(F.caso(hist, { nombre: "PRESS BANCA C/BARRA", reps_objetivo: "5" }));
  assert.ok(r12.kg < r8.kg && r8.kg < r5.kg, [r5.kg, r8.kg, r12.kg].join(" / "));
  /* 60x8 (+2 RIR supuesto) → e1RM 80; 11 reps + 2 RIR → 80 / 1,433 = 55,8 → 55. */
  assert.equal(r12.kg, 55);
});

test("A. una sola ejecución o historial viejo → confianza media (no alta)", () => {
  const una = recomendar(F.caso([h("PRESS BANCA C/BARRA", [serie(60, [8, 8, 8])])], { nombre: "PRESS BANCA C/BARRA", reps_objetivo: "8" }));
  assert.equal(una.nivel, "A");
  assert.equal(una.confianza, "media");
  const vieja = recomendar(F.caso([h("PRESS BANCA C/BARRA", tres(() => serie(60, [8, 8, 8])))], { nombre: "PRESS BANCA C/BARRA", reps_objetivo: "8" }, { desde: "2026-05-04" }));
  assert.equal(vieja.confianza, "media");
});

test("A. la experiencia propia gana sobre las equivalencias (Smith ya registrada)", () => {
  const datos = F.caso([
    h("PRESS INCLINADO C/MANCUERNAS", tres(() => serie(25, [10, 10, 10]))),
    h("PRESS INCLINADO EN SMITH", [serie(35, [8, 8, 8])])
  ], { nombre: "PRESS INCLINADO EN SMITH", reps_objetivo: "8", rir_objetivo: "1-2" });
  const r = recomendar(datos);
  assert.equal(r.nivel, "A");
  assert.deepEqual(r.fuentes, ["PRESS INCLINADO EN SMITH"]);
  assert.ok(r.kg <= 37.5, "usa los 35 kg reales, no la equivalencia (~60)");
});

test("A. tendencia: las ejecuciones recientes pesan más", () => {
  const sube = recomendar(F.caso([h("SENTADILLA C/BARRA", [serie(50, [8, 8]), serie(60, [8, 8]), serie(70, [8, 8])])], { nombre: "SENTADILLA C/BARRA", reps_objetivo: "8" }));
  assert.ok(sube.kg >= 62.5, "más cerca de 70 que del promedio simple (60): " + sube.kg);
});

/* --- B, C, D: equivalencias --- */

test("caso A real: press banca barra 60x8-9 → mancuernas 4x10-12 RIR2 ≈ 22 kg por mancuerna, media", () => {
  const r = recomendar(F.CASOS.A());
  assert.equal(r.tipo, "sugerencia");
  assert.equal(r.nivel, "B");
  assert.equal(r.confianza, "media");
  assert.equal(r.unidad, "por mancuerna");
  assert.ok(r.kg >= 20 && r.kg <= 26, "kg " + r.kg);
  assert.ok(r.rango[0] <= 25 && r.rango[1] >= 25, "el rango incluye ~25 kg: " + r.rango.join("–"));
  assert.deepEqual(r.fuentes, ["PRESS BANCA C/BARRA"]);
  assert.ok(r.explicacion.some((l) => /de barra a mancuernas/.test(l)));
});

test("caso B real: press inclinado mancuernas 25 → Smith 4x8 RIR1-2 RPE8: carga inicial 50-55 (primer uso), media y aviso", () => {
  const r = recomendar(F.CASOS.B());
  assert.equal(r.nivel, "B");
  assert.equal(r.confianza, "media");
  assert.equal(r.unidad, "");
  assert.equal(r.primerUsoGuiado, true);
  assert.ok(r.kg >= 50 && r.kg <= 55, "carga inicial " + r.kg);
  assert.ok(r.equivalencia > r.kg, "la equivalencia estimada (" + r.equivalencia + ") es mayor que la carga inicial");
  assert.ok(r.rango[0] > r.kg, "el rango es de la equivalencia, no de la carga inicial");
  assert.ok(r.explicacion.some((l) => /Las máquinas y Smith pueden variar entre gimnasios/.test(l)));
  const html = entorno().GYMAPP.recomendacionCarga.renderSugerencia(r);
  assert.match(html, /Equivalencia estimada con tu historial: [\d,]+–[\d,]+ kg\. Como todavía no registraste este ejercicio, la carga inicial sugerida es más baja para calibrar\./);
  assert.match(html, /Usala como punto de partida y ajustá en la primera serie\./);
  assert.doesNotMatch(html, /Rango orientativo/);
});

test("primer uso guiado: regla general (mancuerna→máquina, barra→máquina, máquina A→máquina B), no en libres", () => {
  const conMargen = [
    [h("PRESS BANCA C/MANCUERNAS", tres(() => serie(25, [10, 10]))), "PRESS DE PECHO EN MAQUINA"],
    [h("REMO T CON BARRA", tres(() => serie(40, [10, 10]))), "REMO EN MAQUINA"],
    [h("JALON AL PECHO EN MAQUINA", tres(() => serie(50, [10, 10]))), "POLEA DORSAL AL PECHO TOMA AMPLIA"]
  ];
  conMargen.forEach(([hist, objetivo]) => {
    const r = recomendar(F.caso([hist], { nombre: objetivo, reps_objetivo: "10", rir_objetivo: "2" }));
    assert.equal(r.tipo, "sugerencia", objetivo);
    assert.equal(r.primerUsoGuiado, true, objetivo);
    assert.ok(r.kg < r.equivalencia, objetivo + ": " + r.kg + " < " + r.equivalencia);
  });
  const libre = recomendar(F.CASOS.A());
  assert.equal(libre.primerUsoGuiado, false, "barra → mancuernas no es guiado");
  assert.ok(libre.rango[0] <= 25 && libre.rango[1] >= 25, "caso A sin cambios: el rango incluye 25");
  assert.equal(libre.kg, 22, "caso A sigue en 22 kg por mancuerna (factor mancuerna sin tocar)");
});

test("primer uso guiado: después de UNA ejecución real del ejercicio, gana esa experiencia y el margen desaparece", () => {
  const datos = F.caso([
    h("PRESS INCLINADO C/MANCUERNAS", tres(() => serie(25, [10, 10, 10]))),
    h("PRESS INCLINADO EN SMITH", [serie(50, [8, 8, 8])])
  ], { nombre: "PRESS INCLINADO EN SMITH", series_objetivo: 4, reps_objetivo: "8", rir_objetivo: "1-2", rpe_objetivo: 8 });
  const r = recomendar(datos);
  assert.equal(r.nivel, "A");
  assert.equal(r.primerUsoGuiado, false);
  assert.ok(r.kg >= 47.5 && r.kg <= 52.5, "cerca de los 50 kg reales: " + r.kg);
  assert.match(entorno().GYMAPP.recomendacionCarga.renderSugerencia(r), /Rango orientativo/);
});

test("caso C real: militar sentado 12x12 → arrodillado 3x10 RIR2 (postura menos estable)", () => {
  const r = recomendar(F.CASOS.C());
  assert.equal(r.nivel, "B");
  assert.equal(r.confianza, "media");
  assert.ok(r.kg >= 10 && r.kg <= 12, "kg " + r.kg);
  assert.ok(r.kg <= 12, "no más que el sentado");
});

test("barra → mancuerna y mancuerna → barra son simétricos (ida y vuelta ≈ igual)", () => {
  const ida = recomendar(F.caso([h("PRESS BANCA C/BARRA", tres(() => serie(60, [10, 10, 10])))], { nombre: "PRESS BANCA C/MANCUERNAS", reps_objetivo: "10", rir_objetivo: "2" }));
  const vuelta = recomendar(F.caso([h("PRESS BANCA C/MANCUERNAS", tres(() => serie(25, [10, 10, 10])))], { nombre: "PRESS BANCA C/BARRA", reps_objetivo: "10", rir_objetivo: "2" }));
  assert.equal(ida.confianza, "media");
  assert.equal(vuelta.confianza, "media");
  assert.ok(ida.kg >= 22 && ida.kg <= 26, "ida " + ida.kg);
  assert.ok(vuelta.kg >= 52.5 && vuelta.kg <= 62.5, "vuelta " + vuelta.kg);
});

test("máquina ↔ polea (compuesto): comparable; libre → polea en aislamiento: no se infiere", () => {
  const jalon = recomendar(F.caso([h("JALON AL PECHO EN MAQUINA", tres(() => serie(50, [10, 10, 10])))], { nombre: "POLEA DORSAL AL PECHO TOMA AMPLIA", reps_objetivo: "10", rir_objetivo: "2" }));
  assert.equal(jalon.nivel, "B");
  assert.equal(jalon.confianza, "media");
  const lateral = recomendar(F.caso([h("VUELOS LATERALES C/ KETBELL", tres(() => serie(8, [10, 10])))], { nombre: "VUELOS LATERALES EN POLEA", reps_objetivo: "6-9", rir_objetivo: "2" }));
  assert.equal(lateral.tipo, "sin_datos", "8 kg de kettlebell no dicen nada de la polea");
  const aislGuiado = recomendar(F.caso([h("MARIPOSA", tres(() => serie(45, [12, 12])))], { nombre: "CRUCES EN POLEA (ALTO)", reps_objetivo: "9-12", rir_objetivo: "2" }));
  assert.equal(aislGuiado.confianza, "baja", "máquina → polea en aislamiento: baja");
  assert.equal(aislGuiado.unidad, "por lado");
});

test("unilateral ↔ bilateral: remo con polea a un brazo desde remo bilateral → por lado", () => {
  const r = recomendar(F.caso([h("REMO BAJO POLEA TOMA SUPINA", tres(() => serie(45, [10, 10, 10])))], { nombre: "REMO BAJO POLEA TOMA UNILATERAL", reps_objetivo: "10/10", rir_objetivo: "1-2" }));
  assert.equal(r.unidad, "por lado");
  assert.ok(r.kg >= 20 && r.kg <= 27.5, "≈ mitad del bilateral: " + r.kg);
  const pierna = recomendar(F.caso([h("HIP THRUST CON BARRA", tres(() => serie(80, [8, 8, 8])))], { nombre: "ELEVACIONES DE CADERA EN BANCO C/BARRA", reps_objetivo: "10/10", rir_objetivo: "2", comentarios: "UNILATERAL, CON MANCUERNAS" }));
  assert.equal(pierna.confianza, "baja", "pierna unilateral desde bilateral: baja");
  assert.ok(pierna.kg <= 24, "carga externa mucho menor en una pierna: " + pierna.kg);
});

test("C. mismo patrón, otra familia: prensa desde sentadilla → baja; D. press militar desde press banca → baja", () => {
  const c = recomendar(F.caso([h("SENTADILLA C/BARRA", tres(() => serie(80, [8, 8, 8])))], { nombre: "PRENSA 45º", reps_objetivo: "10-12", rir_objetivo: "2" }));
  assert.equal(c.nivel, "C");
  assert.equal(c.confianza, "baja");
  assert.ok(c.kg > 80, "la prensa mueve más que la sentadilla: " + c.kg);
  const d = recomendar(F.caso([h("PRESS BANCA C/BARRA", tres(() => serie(60, [8, 8, 8])))], { nombre: "PRESS MILITAR C/BARRA DE PIE", reps_objetivo: "8", rir_objetivo: "2" }));
  assert.equal(d.nivel, "D");
  assert.equal(d.confianza, "baja");
  assert.ok(d.kg >= 30 && d.kg <= 40, "≈ 60% del press banca: " + d.kg);
});

test("prioridad A > B > C > D", () => {
  const hist = [
    h("PRESS BANCA C/BARRA", tres(() => serie(60, [8, 8]))),
    h("PRESS INCLINADO C/MANCUERNAS", tres(() => serie(22, [10, 10]))),
    h("PRESS INCLINADO EN SMITH", tres(() => serie(40, [8, 8])))
  ];
  assert.equal(recomendar(F.caso(hist, { nombre: "PRESS INCLINADO EN SMITH", reps_objetivo: "8" })).nivel, "A");
  assert.equal(recomendar(F.caso(hist, { nombre: "PRESS INCLINADO C/BARRA", reps_objetivo: "8" })).nivel, "B");
  assert.equal(recomendar(F.caso(hist.slice(0, 1), { nombre: "PRESS INCLINADO C/BARRA", reps_objetivo: "8" })).nivel, "C");
  assert.equal(recomendar(F.caso(hist.slice(0, 1), { nombre: "PRESS MILITAR C/BARRA", reps_objetivo: "8" })).nivel, "D");
});

test("B con mismo implemento pesa más y se priorizan fuentes del mismo implemento", () => {
  const r = recomendar(F.caso([
    h("PRESS INCLINADO C/BARRA", tres(() => serie(50, [10, 10]))),
    h("PRESS INCLINADO C/MANCUERNAS", tres(() => serie(20, [10, 10])))
  ], { nombre: "PRESS INCLINADO EN SMITH", reps_objetivo: "10", rir_objetivo: "2" }));
  assert.equal(r.fuentes[0], "PRESS INCLINADO C/BARRA", "barra ↔ Smith es más cercano que mancuernas ↔ Smith");
  assert.equal(r.fuentes.length, 2);
  assert.ok(r.explicacion[0].includes(" y "), "explica ambas fuentes");
});

/* --- Series, RIR, RPE --- */

test("calentamientos ignorados: 20 kg de aproximación no bajan la sugerencia", () => {
  const sin = recomendar(F.caso([h("SENTADILLA C/BARRA", tres(() => serie(60, [8, 8, 8])))], { nombre: "SENTADILLA C/BARRA", reps_objetivo: "8" }));
  const con = recomendar(F.caso([h("SENTADILLA C/BARRA", tres(() => serie(20, [10]).concat(serie(40, [6])).concat(serie(60, [8, 8, 8]))))], { nombre: "SENTADILLA C/BARRA", reps_objetivo: "8" }));
  assert.equal(con.kg, sin.kg);
});

test("RIR objetivo: más reserva → menos carga; sin RIR usa el RPE objetivo del ejercicio (10 - RPE)", () => {
  const hist = [h("PRESS BANCA C/BARRA", tres(() => serie(60, [8, 8, 8])))];
  const rir0 = recomendar(F.caso(hist, { nombre: "PRESS BANCA C/BARRA", reps_objetivo: "8", rir_objetivo: "0" }));
  const rir3 = recomendar(F.caso(hist, { nombre: "PRESS BANCA C/BARRA", reps_objetivo: "8", rir_objetivo: "3" }));
  assert.ok(rir3.kg < rir0.kg, rir0.kg + " vs " + rir3.kg);
  const rpe7 = recomendar(F.caso(hist, { nombre: "PRESS BANCA C/BARRA", reps_objetivo: "8", rpe_objetivo: 7 }));
  assert.equal(rpe7.kg, rir3.kg, "RPE 7 equivale a RIR 3");
  const R = entorno().GYMAPP.recomendacionCarga;
  assert.equal(R.rirDePrescripcion({ rir_objetivo: "1-2" }), 1.5);
  assert.equal(R.rirDePrescripcion({ rir_objetivo: null, rpe_objetivo: 8 }), 2);
  assert.equal(R.rirDePrescripcion({ rir_objetivo: "2", rpe_objetivo: 9 }), 2, "si hay RIR, manda el RIR");
});

test("el RPE de la SESIÓN no se usa como RPE del ejercicio", () => {
  const base = (rpeSesion) => F.caso([Object.assign(h("PRESS BANCA C/BARRA", tres(() => serie(60, [8, 8, 8]))), { rpeSesion })], { nombre: "PRESS BANCA C/MANCUERNAS", reps_objetivo: "10-12", rir_objetivo: "2" });
  const r5 = recomendar(base(5));
  const r10 = recomendar(base(10));
  assert.equal(r5.kg, r10.kg);
  assert.deepEqual(r5.rango, r10.rango);
});

test("reps: rangos, por lado, '7-7-7' (parciales → baja) y '8 (5'')'", () => {
  const R = entorno().GYMAPP.recomendacionCarga;
  assert.deepEqual(clonar(R.parsearReps("10-12")), { reps: 11 });
  assert.deepEqual(clonar(R.parsearReps("10/10")), { reps: 10 });
  assert.deepEqual(clonar(R.parsearReps("8 (5'')")), { reps: 8 });
  assert.deepEqual(clonar(R.parsearReps("7-7-7")), { reps: 13, parciales: true });
  assert.equal(R.parsearReps("15-30''"), null);
  const curl21 = recomendar(F.caso([h("BICEPS C/BARRA PLANA", tres(() => serie(25, [10, 10])))], { nombre: "CURL 21 CON BARRA", reps_objetivo: "7-7-7", rir_objetivo: "1" }));
  assert.equal(curl21.confianza, "baja");
});

/* --- Sin datos --- */

test("historial insuficiente o sin relación: sin_datos con guía (nunca kilos inventados)", () => {
  const nada = recomendar(F.caso([], { nombre: "PRESS BANCA C/MANCUERNAS", reps_objetivo: "10", rir_objetivo: "2" }));
  assert.equal(nada.tipo, "sin_datos");
  const lejos = recomendar(F.caso([h("CURL FEMORAL ACOSTADO", tres(() => serie(30, [12])))], { nombre: "PRESS BANCA C/MANCUERNAS", reps_objetivo: "10" }));
  assert.equal(lejos.tipo, "sin_datos");
  const core = recomendar(F.caso([h("PRESS BANCA C/BARRA", tres(() => serie(60, [8])))], { nombre: "PRESS PALLOF EN POSICION DE ESTOCADA", reps_objetivo: "10/10", rir_objetivo: "1" }));
  assert.equal(core.tipo, "sin_datos", "core: solo con su propio historial");
  assert.match(entorno().GYMAPP.recomendacionCarga.renderSugerencia(nada), /Sin historial relacionado para sugerir una carga\./);
});

/* --- Compatibilidad histórica --- */

test("planes históricos, snapshots, sesiones sin snapshot e IDs distintos entre planes", () => {
  const d = F.CASOS.A();
  const conSnap = d.sesiones_entrenamiento.filter((s) => s.ejercicios_realizados[0].prescripcion_snapshot).length;
  assert.ok(conSnap > 0 && conSnap < d.sesiones_entrenamiento.length, "mezcla E5 y viejas");
  const ids = new Set(d.sesiones_entrenamiento.map((s) => s.ejercicios_realizados[0].ejercicio_id));
  const plan = d.rutina.planes.find((p) => p.plan_id === d.rutina.plan_activo_id);
  assert.ok(!ids.has(plan.dias[0].ejercicios[0].id), "el objetivo tiene otro id");
  const r = recomendar(d);
  assert.equal(r.tipo, "sugerencia");
  /* Solo snapshots (el plan viejo ya no existe): igual se relaciona por nombre. */
  const soloSnap = clonar(d);
  soloSnap.sesiones_entrenamiento = soloSnap.sesiones_entrenamiento.filter((s) => s.ejercicios_realizados[0].prescripcion_snapshot);
  soloSnap.rutina.planes = soloSnap.rutina.planes.filter((p) => p.plan_id === soloSnap.rutina.plan_activo_id);
  assert.equal(recomendar(soloSnap).tipo, "sugerencia");
});

test("plan legacy E3 (historial real de IDs): el motor corre sin errores y relaciona por nombre", () => {
  const d = aE3(datasetHistoricos({ legacy: true }));
  const e = entorno(d);
  const R = e.GYMAPP.recomendacionCarga;
  const data = e.GYMAPP.storage.getData();
  const idx = R.construirIndiceHistorial(data);
  assert.ok(idx.porNombre["press banca con barra"], "PRESS BANCA C/BARRA del legacy, resuelto por id");
  const a = clonar(R.recomendar(idx, { nombre: "Press banca c/barra", reps_objetivo: "8", rir_objetivo: "2" }, { hoy: HOY }));
  assert.equal(a.nivel, "A", "mismo ejercicio aunque el nombre esté escrito distinto");
  const b = clonar(R.recomendar(idx, { nombre: "Press banca en Smith", reps_objetivo: "8", rir_objetivo: "2" }, { hoy: HOY }));
  assert.equal(b.tipo, "sugerencia");
  assert.equal(b.nivel, "B");
});

/* --- No modificar datos --- */

test("calcular recomendaciones (índice, todas las del plan y render) no escribe nada", () => {
  const e = entorno(F.historialAmplio());
  const antes = e.localStorage.getItem(CLAVE);
  const R = e.GYMAPP.recomendacionCarga;
  const data = e.GYMAPP.storage.getData();
  const copia = JSON.stringify(data);
  const plan = e.GYMAPP.planes.planActivo(data);
  const idx = R.construirIndiceHistorial(data);
  plan.dias.forEach((d) => d.ejercicios.forEach((ej) => R.renderSugerencia(R.recomendar(idx, ej, { hoy: HOY, contexto: R.contextoPlan(plan) }))));
  assert.deepEqual(e.localStorage._escrituras, []);
  assert.equal(e.localStorage.getItem(CLAVE), antes);
  assert.equal(JSON.stringify(data), copia, "ni siquiera muta el objeto en memoria");
});

/* --- Render --- */

test("render compacto: carga + confianza, '¿Por qué?' con rango, explicación y guía de calibración", () => {
  const e = entorno();
  const R = e.GYMAPP.recomendacionCarga;
  const html = R.renderSugerencia(recomendar(F.CASOS.A()));
  assert.match(html, /Carga sugerida:<\/span> <strong>22 kg por mancuerna<\/strong> <span class="carga-sugerida-confianza">· Confianza media<\/span>/);
  assert.match(html, /<details class="carga-sugerida-detalle"><summary>¿Por qué\?<\/summary>/);
  assert.match(html, /Rango orientativo: \d+–\d+ kg por mancuerna\./);
  assert.match(html, /Usala como punto de partida y ajustá en la primera serie\./);
  assert.match(html, /Si terminás con más de 2-3 repeticiones en reserva, subí ligeramente/);
  assert.doesNotMatch(html, /<input|value=/, "no toca inputs");
  assert.equal(R.GUIA.alta, "Empezá cerca de esta carga.");
  assert.equal(R.GUIA.baja, "Estimación inicial. Probá conservador y ajustá según sensaciones.");
});

/* --- Reporte del Plan N.º 4 (historial de ejemplo) --- */

test("Plan N.º 4 completo: cada ejercicio recibe un resultado coherente (sin kilos en movilidad/peso corporal)", () => {
  const e = entorno(F.historialAmplio());
  const R = e.GYMAPP.recomendacionCarga;
  const data = e.GYMAPP.storage.getData();
  const plan = e.GYMAPP.planes.planActivo(data);
  const idx = R.construirIndiceHistorial(data);
  const ctx = R.contextoPlan(plan);
  const todos = plan.dias.flatMap((d) => d.ejercicios).map((ej) => ({ ej, r: clonar(R.recomendar(idx, ej, { hoy: HOY, contexto: ctx })) }));
  assert.equal(todos.length, 54);
  todos.forEach(({ ej, r }) => {
    if (r.clasificacion.tipo === "movilidad" || r.clasificacion.sinCargaExterna) assert.notEqual(r.tipo, "sugerencia", ej.nombre);
    if (r.tipo === "sugerencia") {
      assert.ok(r.kg > 0 && r.kg < 200, ej.nombre + " " + r.kg);
      assert.ok(r.rango[0] <= r.kg && r.kg <= r.rango[1], ej.nombre);
      assert.ok(["alta", "media", "baja"].includes(r.confianza));
    }
  });
  const cuenta = (f) => todos.filter(f).length;
  assert.ok(cuenta((x) => x.r.tipo === "sugerencia") >= 15);
  assert.ok(cuenta((x) => x.r.tipo === "movilidad") >= 15);
});

/* --- "Última vez": identidad estricta (no variantes) --- */

function ultimaVez(datos, nombre) {
  const e = entorno(datos);
  const data = e.GYMAPP.storage.getData();
  const ej = e.GYMAPP.planes.planActivo(data).dias.flatMap((d) => d.ejercicios).find((x) => x.nombre === nombre);
  return { r: clonar(e.GYMAPP.rutinasHistoricas.buscarUltimaEjecucion(data, ej)), e };
}

test("Última vez: IDs distintos + mismo nombre (escrito distinto) → encuentra la última ejecución", () => {
  const datos = F.caso([h("PRESS BANCA C/BARRA", [serie(55, [8, 8]), serie(57.5, [8, 8]), serie(60, [8, 7])])], { nombre: "Press banca con barra", reps_objetivo: "8" });
  const plan = datos.rutina.planes.find((p) => p.plan_id === datos.rutina.plan_activo_id);
  assert.ok(!datos.sesiones_entrenamiento.some((s) => s.ejercicios_realizados[0].ejercicio_id === plan.dias[0].ejercicios[0].id), "ids distintos");
  const { r } = ultimaVez(datos, "Press banca con barra");
  assert.ok(r, "encontrada");
  assert.deepEqual(r.series, serie(60, [8, 7]), "la más reciente");
});

test("Última vez: una variante del mismo patrón NO se presenta como última vez (aunque sí sirva para la carga)", () => {
  const datos = F.CASOS.B();
  const { r } = ultimaVez(datos, "PRESS INCLINADO EN SMITH");
  assert.equal(r, null, "press inclinado con mancuernas no es 'última vez' de la Smith");
  assert.equal(recomendar(datos).nivel, "B", "pero sí es referencia (B) para la carga sugerida");
  assert.equal(ultimaVez(F.CASOS.C(), "PRESS MILITAR ARRODILLADO CON MANCUERNAS").r, null);
  assert.equal(ultimaVez(F.CASOS.A(), "PRESS BANCA C/MANCUERNAS").r, null);
});

test("Última vez: el mismo ejercicio_id tiene prioridad sobre el nombre", () => {
  const datos = F.caso([h("PRESS BANCA C/BARRA", [serie(60, [8])])], { nombre: "PRESS BANCA C/BARRA", reps_objetivo: "8" });
  const plan = datos.rutina.planes.find((p) => p.plan_id === datos.rutina.plan_activo_id);
  const idNuevo = plan.dias[0].ejercicios[0].id;
  datos.sesiones_entrenamiento.push({ id: "viejo-mismo-id", fecha: "2026-08-01T18:00:00", tipo: "gimnasio", dia_rutina_id: plan.dias[0].id, plan_id: plan.plan_id, duracion_min: 60, rpe: 7, notas: "", futbol_detalle: null,
    ejercicios_realizados: [{ ejercicio_id: idNuevo, series: serie(40, [10]) }] });
  assert.deepEqual(ultimaVez(datos, "PRESS BANCA C/BARRA").r.series, serie(40, [10]), "por id, aunque por nombre haya una más nueva");
});

test("Última vez: plan legacy E3 → plan nuevo con el mismo ejercicio", () => {
  const d = aE3(datasetHistoricos({ legacy: true }));
  const activo = d.rutina.planes.find((p) => p.plan_id === d.rutina.plan_activo_id);
  activo.dias[0].ejercicios[0] = Object.assign({}, activo.dias[0].ejercicios[0], { id: "nuevo-banca", nombre: "Press banca c/barra" });
  const { r } = ultimaVez(d, "Press banca c/barra");
  assert.ok(r, "encuentra la ejecución del legacy (PRESS BANCA C/BARRA, id mu4c87epsr80xw)");
  assert.equal(r.series[r.series.length - 1].peso_kg, 60);
});

test("Última vez: sesión E5 con snapshot (sin el plan viejo) → funciona", () => {
  const datos = F.CASOS.A();
  datos.rutina.planes = datos.rutina.planes.filter((p) => p.plan_id === datos.rutina.plan_activo_id);
  datos.sesiones_entrenamiento = datos.sesiones_entrenamiento.filter((s) => s.ejercicios_realizados[0].prescripcion_snapshot);
  const plan = datos.rutina.planes[0];
  plan.dias[0].ejercicios[0].nombre = "PRESS BANCA C/BARRA";
  assert.ok(datos.sesiones_entrenamiento.length > 0);
  const { r } = ultimaVez(datos, "PRESS BANCA C/BARRA");
  assert.ok(r, "resuelto por el nombre del snapshot");
});

test("Última vez: solo lectura (no escribe ni muta)", () => {
  const datos = F.historialAmplio();
  const e = entorno(datos);
  const data = e.GYMAPP.storage.getData();
  const copia = JSON.stringify(data);
  e.GYMAPP.planes.planActivo(data).dias.forEach((d) => d.ejercicios.forEach((ej) => e.GYMAPP.rutinasHistoricas.buscarUltimaEjecucion(data, ej)));
  assert.deepEqual(e.localStorage._escrituras, []);
  assert.equal(JSON.stringify(data), copia);
});

test("una sola normalización: claveEjercicio es la que usa el motor", () => {
  const e = entorno();
  assert.equal(e.GYMAPP.rutinasHistoricas.claveEjercicio("PRESS BANCA C/BARRA"), e.GYMAPP.rutinasHistoricas.claveEjercicio("  Press  banca con barra "));
  assert.equal(e.GYMAPP.recomendacionCarga.normalizar("Elevación C/MANCUERNA"), "elevacion con mancuerna");
  assert.notEqual(e.GYMAPP.rutinasHistoricas.claveEjercicio("PRESS INCLINADO EN SMITH"), e.GYMAPP.rutinasHistoricas.claveEjercicio("PRESS INCLINADO C/MANCUERNAS"));
});
