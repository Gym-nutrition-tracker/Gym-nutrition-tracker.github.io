/* Tests de PROG-04 ("Estado del plan / Fatiga y progresión").
   Correr con: node --test tests/*.test.js */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { crearEntorno, clonar, aV3 } = require("./entorno");

const CLAVE = "gymNutritionTracker";

/* --- Generador de escenarios ---
   Rutina con 2 bloques (A: martes, B: jueves) de 3 ejercicios cada uno.
   Cada semana se describe con { A, B } y cada bloque con
   { rpe, ej: { a1: [[peso, reps], ...], ... } } (null = no se entrenó). */
const RUTINA = {
  dias: [
    { id: "A", nombre: "Bloque A", ejercicios: ["a1", "a2", "a3"].map((id) => ({ id, nombre: id, grupo_muscular: "", series_objetivo: 4, reps_objetivo: "10-12" })) },
    { id: "B", nombre: "Bloque B", ejercicios: ["b1", "b2", "b3"].map((id) => ({ id, nombre: id, grupo_muscular: "", series_objetivo: 4, reps_objetivo: "10-12" })) }
  ]
};

function sumarDias(iso, n) {
  const [y, m, d] = iso.split("-").map(Number);
  const f = new Date(Date.UTC(y, m - 1, d + n));
  return f.toISOString().slice(0, 10);
}

function series(peso, repsLista) { return repsLista.map((r) => ({ peso_kg: peso, reps: r })); }

let contador = 0;
function sesionGym(fechaISO, bloque, rpe, ej, hora) {
  contador += 1;
  return {
    id: "s" + contador, fecha: fechaISO + "T" + (hora || "18:00:00"), tipo: "gimnasio", dia_rutina_id: bloque,
    duracion_min: 60, rpe, notas: "", futbol_detalle: null,
    ejercicios_realizados: Object.keys(ej).map((id) => ({ ejercicio_id: id, series: ej[id] }))
  };
}

/* lunesISO = lunes de la primera semana. */
function escenario(lunesISO, semanas) {
  const sesiones = [];
  semanas.forEach((sem, i) => {
    const lunes = sumarDias(lunesISO, i * 7);
    if (sem && sem.A) sesiones.push(sesionGym(sumarDias(lunes, 1), "A", sem.A.rpe, sem.A.ej));
    if (sem && sem.B) sesiones.push(sesionGym(sumarDias(lunes, 3), "B", sem.B.rpe, sem.B.ej));
    if (sem && sem.extra) sem.extra(lunes, sesiones);
  });
  return {
    schema_version: 2,
    usuario: { nombre: "Nico", actividades: [{ tipo: "gimnasio", meta_semanal: 2 }, { tipo: "futbol", meta_semanal: 1 }] },
    rutina: clonar(RUTINA),
    sesiones_entrenamiento: sesiones,
    registros_nutricion: [], base_alimentos: [], medidas_corporales: []
  };
}

/* Semana "normal": 1 aproximación + 4 series efectivas a la misma carga,
   reps progresando de a 1 rep en una serie por semana (~+2%). */
function semanaProgresiva(i, rpeA, rpeB) {
  const reps = [12, 12, 12, 12].map((r, k) => (k < i ? r + 1 : r));
  const ej = (ids) => Object.fromEntries(ids.map((id) => [id, series(20, [10]).concat(series(25, reps))]));
  return { A: { rpe: rpeA, ej: ej(["a1", "a2", "a3"]) }, B: { rpe: rpeB, ej: ej(["b1", "b2", "b3"]) } };
}

function evaluar(data, hoyISO) {
  const e = crearEntorno({ modulos: ["js/actividades.js", "js/progreso.js"] });
  const input = e.GYMAPP.progreso.construirInputEstadoPlan(aV3(data), hoyISO);
  return { e, input, r: e.GYMAPP.progreso.calcularEstadoPlan(input) };
}

const LUNES = "2026-10-12";

/* 1 */
test("una sola semana → datos insuficientes", () => {
  const { r } = evaluar(escenario(LUNES, [semanaProgresiva(0, 7, 7)]), "2026-10-19");
  assert.equal(r.estado, null);
  assert.equal(r.confianza, "insuficiente");
  assert.equal(r.contexto.inicioObservadoISO, "2026-10-13");
  assert.equal(r.contexto.semanaDeRegistros, 2);
  assert.match(r.motivos.join(" | "), /2 sesiones registradas desde el inicio observado \(13\/10\) · RPE promedio 7,0/);
  assert.match(r.motivos.join(" | "), /1 semana cerrada con entrenamientos/);
  assert.match(r.sugerencia, /aproximadamente 1 semana cerrada más/);
});

/* 2 */
test("dos semanas buenas → progresar, confianza inicial", () => {
  const { r } = evaluar(escenario(LUNES, [semanaProgresiva(0, 7, 7), semanaProgresiva(1, 7, 7)]), "2026-10-26");
  assert.equal(r.estado, "progresar");
  assert.equal(r.confianza, "inicial");
  assert.ok(r.motivos.length >= 2 && r.motivos.length <= 4);
});

/* 3 */
test("tres o más semanas buenas con RPE 5–7 → intensificar", () => {
  const sems = [0, 1, 2, 3].map((i) => semanaProgresiva(i, 6, 7));
  const { r } = evaluar(escenario(LUNES, sems), "2026-11-09");
  assert.equal(r.estado, "intensificar");
  assert.equal(r.confianza, "normal");
  assert.match(r.sugerencia, /acercar gradualmente el esfuerzo de las series principales al objetivo de tu plan, sin llegar al fallo/);
  assert.doesNotMatch(r.sugerencia, /RIR \d|RPE \d/);
});

/* 4 */
test("progreso con RPE alto sostenido (promedio ≥ 8,5) → consolidar", () => {
  const sems = [0, 1, 2, 3].map((i) => semanaProgresiva(i, 9, 8));
  const { r } = evaluar(escenario(LUNES, sems), "2026-11-09");
  assert.equal(r.senales.rpeAlto.activa, false, "solo 2 sesiones RPE 9 en 14 días");
  assert.equal(r.estado, "consolidar");
  assert.match(r.motivos.join(" | "), /RPE promedio de 8,5 en los últimos 14 días/);
});

/* 5 */
test("tres sesiones con RPE ≥ 9 sin caída → consolidar, nunca descargar", () => {
  const sems = [0, 1, 2, 3].map((i) => semanaProgresiva(i, 7, 7));
  sems[2].A.rpe = 9; sems[3].A.rpe = 9; sems[3].B.rpe = 10;
  const { r } = evaluar(escenario(LUNES, sems), "2026-11-09");
  assert.equal(r.senales.rpeAlto.activa, true);
  assert.equal(r.senales.caidaRendimiento.activa, false);
  assert.equal(r.estado, "consolidar");
  assert.match(r.motivos[0], /3 sesiones de gimnasio con RPE ≥ 9/);
});

/* 6 */
test("RPE alto acumulado + caída en varios ejercicios y sesiones → descargar", () => {
  const sems = [0, 1, 2].map((i) => semanaProgresiva(i, 7, 7));
  const caida = (ids) => Object.fromEntries(ids.map((id) => [id, series(20, [10]).concat(series(25, [12, 10, 9, 8]))]));
  sems[2].A.rpe = 9;
  sems.push({ A: { rpe: 9, ej: caida(["a1", "a2", "a3"]) }, B: { rpe: 9, ej: caida(["b1", "b2", "b3"]) } });
  const { r } = evaluar(escenario(LUNES, sems), "2026-11-09");
  assert.equal(r.senales.rpeAlto.activa, true);
  assert.equal(r.senales.caidaCargaMantenida.activa, true);
  assert.equal(r.senales.caidaRendimiento.activa, true);
  assert.equal(r.estado, "descargar");
  assert.match(r.sugerencia, /entre un tercio y la mitad de las series efectivas/);
});

/* 7 */
test("una sola sesión mala nunca provoca descarga", () => {
  const sems = [0, 1, 2].map((i) => semanaProgresiva(i, 7, 7));
  const ultima = semanaProgresiva(3, 7, 10);
  ultima.B.ej = Object.fromEntries(["b1", "b2", "b3"].map((id) => [id, series(20, [10]).concat(series(25, [10, 8, 7, 6]))]));
  sems.push(ultima);
  const { r } = evaluar(escenario(LUNES, sems), "2026-11-09");
  assert.notEqual(r.estado, "descargar");
  assert.equal(r.senales.caidaRendimiento.activa, false);
  assert.equal(r.senales.caidaCargaMantenida.activa, false);
  assert.match(r.motivos.join(" | "), /una sesión aislada no alcanza para cambiar el estado/);
});

/* 8 y 16 */
test("semana sin entrenamiento afecta adherencia, no rendimiento (nunca rendimiento = 0)", () => {
  const sems = [semanaProgresiva(0, 7, 7), semanaProgresiva(1, 7, 7), null, semanaProgresiva(2, 7, 7)];
  const { r, input } = evaluar(escenario(LUNES, sems), "2026-11-09");
  const semanaVacia = input.semanas.filter((s) => s.semana === "2026-10-26")[0];
  assert.equal(semanaVacia.sesiones, 0);
  assert.equal(semanaVacia.adherencia, 0);
  input.ejercicios.forEach((e) => {
    assert.equal(e.comparaciones.length, e.cantidadEjecuciones - 1, "una comparación por par de ejecuciones reales");
    e.comparaciones.forEach((c) => assert.ok(c.cambioRendimientoPct > -100));
  });
  assert.equal(r.senales.caidaRendimiento.activa, false);
  assert.equal(r.senales.tendenciaNegativa.activa, false);
  assert.equal(r.senales.adherenciaBaja.activa, false, "una sola semana vacía de 3");
  assert.equal(r.estado, "progresar");
});

test("dos de tres semanas con baja adherencia → consolidar por regularidad", () => {
  const sems = [0, 1, 2, 3].map((i) => semanaProgresiva(i, 7, 7));
  delete sems[1].B; delete sems[3].B;
  const { r } = evaluar(escenario(LUNES, sems), "2026-11-09");
  assert.equal(r.senales.adherenciaBaja.activa, false, "1 de 2 bloques = 50%, no es < 50%");
  const sems2 = [semanaProgresiva(0, 7, 7), null, null, semanaProgresiva(1, 7, 7)];
  const r2 = evaluar(escenario(LUNES, sems2), "2026-11-09").r;
  assert.equal(r2.senales.adherenciaBaja.activa, true);
  assert.equal(r2.estado, "consolidar");
  assert.match(r2.motivos.join(" | "), /primero recuperá regularidad/);
});

/* 9 */
test("semana liviana aparente se informa pero NO borra S4", () => {
  const sems = [0, 1, 2].map((i) => semanaProgresiva(i, 7, 7));
  const liviana = (ids) => Object.fromEntries(ids.map((id) => [id, series(25, [10, 9])]));
  sems.push({ A: { rpe: 5, ej: liviana(["a1", "a2", "a3"]) }, B: { rpe: 5, ej: liviana(["b1", "b2", "b3"]) } });
  const { r } = evaluar(escenario(LUNES, sems), "2026-11-09");
  assert.equal(r.senales.semanaLiviana.activa, true);
  assert.equal(r.senales.caidaCargaMantenida.activa, true, "S4 sigue activa");
  assert.equal(r.estado, "consolidar");
  assert.equal(r.confianza, "inicial");
  assert.match(r.motivos.join(" | "), /sensiblemente más liviana/);
});

/* 10 */
test("cambiar o agregar series de aproximación no dispara S4", () => {
  const sems = [0, 1, 2].map((i) => semanaProgresiva(2, 7, 7));
  const conMasAproximacion = (ids) => Object.fromEntries(ids.map((id) => [id, series(17, [10]).concat(series(20, [8]), series(25, [13, 13, 12, 12]))]));
  sems.push({ A: { rpe: 7, ej: conMasAproximacion(["a1", "a2", "a3"]) }, B: { rpe: 7, ej: conMasAproximacion(["b1", "b2", "b3"]) } });
  const { r, input } = evaluar(escenario(LUNES, sems), "2026-11-09");
  const c = input.ejercicios[0].comparaciones.slice(-1)[0];
  assert.equal(c.tipo, "misma_carga");
  assert.equal(c.cambioRepsPrincipalPct, 0);
  assert.equal(r.senales.caidaCargaMantenida.activa, false);
  assert.equal(r.senales.caidaRendimiento.activa, false);
});

/* 11 */
test("misma carga principal con caída real de reps dispara S4", () => {
  const e = crearEntorno({ modulos: ["js/progreso.js"] });
  const P = e.GYMAPP.progreso;
  const c = P.compararEjecucionesPrincipales(P.analizarSeriesPrincipales(series(60, [10, 10, 10, 10])), P.analizarSeriesPrincipales(series(60, [10, 10, 8, 7])));
  assert.equal(c.tipo, "misma_carga");
  assert.equal(c.cambioRepsPrincipalPct, -12.5);
  assert.equal(c.esCaida, true);

  const sems = [0, 1, 2].map((i) => semanaProgresiva(i, 7, 7));
  const ultima = semanaProgresiva(2, 7, 7);
  ultima.A.ej.a1 = series(20, [10]).concat(series(25, [12, 12, 10, 9]));
  ultima.B.ej.b1 = series(20, [10]).concat(series(25, [12, 11, 10, 9]));
  sems.push(ultima);
  const { r } = evaluar(escenario(LUNES, sems), "2026-11-09");
  assert.equal(r.senales.caidaCargaMantenida.activa, true);
  assert.match(r.senales.caidaCargaMantenida.detalle, /2 ejercicios bajaron reps con la misma carga principal \(2 sesiones distintas\)/);
});

/* 12 */
test("subir carga con menos reps no se interpreta como caída", () => {
  const e = crearEntorno({ modulos: ["js/progreso.js"] });
  const P = e.GYMAPP.progreso;
  const c = P.compararEjecucionesPrincipales(P.analizarSeriesPrincipales(series(25, [12, 12, 12, 12])), P.analizarSeriesPrincipales(series(27.5, [9, 9, 8, 8])));
  assert.equal(c.tipo, "carga_mayor");
  assert.equal(c.esCaida, false);
  assert.equal(c.esMejora, true);

  const sems = [0, 1, 2].map((i) => semanaProgresiva(i, 7, 7));
  const subida = (ids) => Object.fromEntries(ids.map((id) => [id, series(20, [10]).concat(series(27.5, [9, 9, 8, 8]))]));
  sems.push({ A: { rpe: 8, ej: subida(["a1", "a2", "a3"]) }, B: { rpe: 8, ej: subida(["b1", "b2", "b3"]) } });
  const { r } = evaluar(escenario(LUNES, sems), "2026-11-09");
  assert.equal(r.senales.caidaRendimiento.activa, false);
  assert.equal(r.senales.caidaCargaMantenida.activa, false);
  assert.notEqual(r.estado, "descargar");
});

/* 13 */
test("estructura de cargas ambigua baja la confianza", () => {
  const e = crearEntorno({ modulos: ["js/progreso.js"] });
  const P = e.GYMAPP.progreso;
  assert.equal(P.analizarSeriesPrincipales(series(20, [10]).concat(series(25, [12, 12, 12, 12]))).ambigua, false);
  assert.equal(P.analizarSeriesPrincipales([{ peso_kg: 20, reps: 10 }, { peso_kg: 22.5, reps: 8 }, { peso_kg: 25, reps: 6 }]).ambigua, true, "rampa");
  assert.equal(P.analizarSeriesPrincipales(series(25, [10, 10]).concat(series(23, [10, 10]))).ambigua, true, "back-off al 92%");

  const piramide = (i) => (ids) => Object.fromEntries(ids.map((id) => [id, [{ peso_kg: 20, reps: 10 }, { peso_kg: 22.5, reps: 8 }, { peso_kg: 25, reps: 6 + (i > 1 ? 1 : 0) }]]));
  const sems = [0, 1, 2, 3].map((i) => ({ A: { rpe: 6, ej: piramide(i)(["a1", "a2", "a3"]) }, B: { rpe: 6, ej: piramide(i)(["b1", "b2", "b3"]) } }));
  const { r } = evaluar(escenario(LUNES, sems), "2026-11-09");
  assert.equal(r.contexto.auxiliares.estructuraAmbigua, true);
  assert.equal(r.confianza, "inicial");
  assert.notEqual(r.estado, "intensificar");
});

/* 14 */
test("el fútbol no dispara fatiga, pero aparece en contexto", () => {
  const sems = [0, 1, 2, 3].map((i) => semanaProgresiva(i, 6, 7));
  sems[3].extra = (lunes, sesiones) => {
    [4, 5, 6].forEach((d) => sesiones.push({ id: "f" + d, fecha: sumarDias(lunes, d - 7) + "T20:00:00", tipo: "futbol", dia_rutina_id: null, duracion_min: 90, rpe: 10, notas: "", ejercicios_realizados: [], futbol_detalle: null }));
  };
  const { r } = evaluar(escenario(LUNES, sems), "2026-11-09");
  assert.equal(r.estado, "intensificar");
  assert.equal(r.senales.futbol.activa, false);
  assert.match(r.senales.futbol.detalle, /3 sesiones de fútbol en 14 días · RPE promedio 10,0 · 270 min \(solo contexto\)/);
  assert.equal(r.contexto.futbol.sesiones, 3);
});

/* 15 */
test("fechas deterministas con hoyISO y sin new Date() en la función pura", () => {
  const data = escenario(LUNES, [0, 1, 2].map((i) => semanaProgresiva(i, 7, 7)));
  /* Sesión del domingo 01/11 a las 23:30 locales: pertenece a la semana del 26/10. */
  data.sesiones_entrenamiento.push(sesionGym("2026-11-01", "A", 7, { a1: series(25, [12, 12, 12, 12]) }, "23:30:00"));
  const e = crearEntorno({ modulos: ["js/progreso.js"] });
  const P = e.GYMAPP.progreso;
  const input = P.construirInputEstadoPlan(aV3(data), "2026-11-02");
  assert.equal(input.semanas.filter((s) => s.semana === "2026-10-26")[0].sesiones, 3);
  assert.equal(input.semanas.filter((s) => s.semana === "2026-11-02")[0].sesiones, 0);
  assert.equal(input.semanaDeRegistros, 4);
  assert.equal(P.construirInputEstadoPlan(aV3(data), "2026-11-09").semanaDeRegistros, 5);

  const RealDate = e.ctx.Date;
  e.ctx.Date = function () { throw new Error("new Date() no permitido en calcularEstadoPlan"); };
  let r1, r2;
  try {
    r1 = P.calcularEstadoPlan(input);
    r2 = P.calcularEstadoPlan(input);
  } finally {
    e.ctx.Date = RealDate;
  }
  assert.deepEqual(clonar(r1), clonar(r2));
});

/* 17 y 18 */
test("PROG-04 no escribe localStorage, no muta data ni cambia schema_version", () => {
  const data = escenario(LUNES, [0, 1, 2, 3].map((i) => semanaProgresiva(i, 7, 7)));
  const e = crearEntorno({ modulos: ["js/actividades.js", "js/progreso.js"] });
  e.escribir(CLAVE, aV3(data));
  const antes = e.localStorage.getItem(CLAVE);
  const datos = e.GYMAPP.storage.getData();
  const copia = JSON.stringify(datos);
  const escriturasAntes = e.localStorage._escrituras.length;
  const r = e.GYMAPP.progreso.calcularEstadoPlan(e.GYMAPP.progreso.construirInputEstadoPlan(datos, "2026-11-09"));
  e.GYMAPP.progreso.renderSeccionEstadoPlan(r);
  assert.equal(e.localStorage._escrituras.length, escriturasAntes);
  assert.equal(e.localStorage.getItem(CLAVE), antes);
  assert.equal(JSON.stringify(datos), copia, "no muta data");
  assert.equal(e.GYMAPP.storage.getDefaultData().schema_version, 3);
  assert.equal(JSON.parse(e.localStorage.getItem(CLAVE)).schema_version, 3);
});

/* 19 */
test("PROG-04 no toca sync ni la nube", () => {
  const fuente = fs.readFileSync(path.join(__dirname, "..", "js", "progreso.js"), "utf8");
  assert.doesNotMatch(fuente, /GYMAPP\.sync|localStorage\.|GYMAPP\.auth/);
  const data = escenario(LUNES, [0, 1, 2, 3].map((i) => semanaProgresiva(i, 7, 7)));
  const e = crearEntorno({ modulos: ["js/actividades.js", "js/progreso.js"] });
  e.login();
  e.GYMAPP.progreso.calcularEstadoPlan(e.GYMAPP.progreso.construirInputEstadoPlan(aV3(data), "2026-11-09"));
  assert.equal(e.nube.llamadas.length, 0);
});

test("render: badge, chip, contexto, motivos, señales plegables y nota fija", () => {
  const sems = [0, 1, 2].map((i) => semanaProgresiva(i, 7, 7));
  const caida = (ids) => Object.fromEntries(ids.map((id) => [id, series(20, [10]).concat(series(25, [12, 10, 9, 8]))]));
  sems[2].A.rpe = 9;
  sems.push({ A: { rpe: 9, ej: caida(["a1", "a2", "a3"]) }, B: { rpe: 9, ej: caida(["b1", "b2", "b3"]) } });
  const { e, r } = evaluar(escenario(LUNES, sems), "2026-11-09");
  const html = e.GYMAPP.progreso.renderSeccionEstadoPlan(r);
  assert.match(html, /<h3>Estado del plan<\/h3>/);
  assert.match(html, /🟠 Descargar \/ recuperar/);
  assert.match(html, /Confianza: normal/);
  assert.match(html, /Semana 5 de registros de esta rutina · Inicio observado: 13\/10 · 4 semanas cerradas analizadas/);
  assert.doesNotMatch(html, /Semana \d+ del plan/);
  assert.match(html, /<details class="estado-plan-senales"><summary>Señales<\/summary>/);
  ["RPE alto", "Caída de rendimiento", "Tendencia negativa", "Caída con carga mantenida", "RPE en alza", "Adherencia", "Semana liviana aparente", "Fútbol reciente"].forEach((n) => assert.ok(html.includes(n), n));
  assert.match(html, /Lectura orientativa basada en tus registros\. No reemplaza el criterio de tu entrenador\./);

  const insuf = evaluar(escenario(LUNES, [semanaProgresiva(0, 7, 7)]), "2026-10-19");
  assert.match(insuf.e.GYMAPP.progreso.renderSeccionEstadoPlan(insuf.r), /⚪ Datos insuficientes/);
});

test("rutina vacía o sin sesiones de la rutina → datos insuficientes sin romper", () => {
  const data = escenario(LUNES, []);
  const r1 = evaluar(data, "2026-10-19").r;
  assert.equal(r1.estado, null);
  assert.match(r1.motivos[0], /Todavía no hay sesiones registradas/);
  data.rutina.dias = [];
  const r2 = evaluar(data, "2026-10-19").r;
  assert.equal(r2.estado, null);
  assert.match(r2.motivos[0], /no tiene bloques cargados/);
});

test("más de 21 días sin entrenar → consolidar (retomar de a poco)", () => {
  const sems = [0, 1, 2, 3].map((i) => semanaProgresiva(i, 6, 7));
  const { r } = evaluar(escenario(LUNES, sems), "2026-12-07");
  assert.equal(r.estado, "consolidar");
  assert.match(r.motivos[0], /días sin entrenar con esta rutina/);
});
