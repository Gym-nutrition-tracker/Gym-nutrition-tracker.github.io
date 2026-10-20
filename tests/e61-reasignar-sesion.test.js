/* E6.1: reasignación manual de UNA sesión de gimnasio a otro plan/día.
   La UI (panel en Entrenar) está en tests/e2e/reasignar-sesion.e2e.js.
   Correr con: node --test tests/*.test.js */
const test = require("node:test");
const assert = require("node:assert/strict");
const { crearEntorno, crearContenedor, esperar, clonar, aE3 } = require("./entorno");
const { datasetHistoricos } = require("./fixtures/historicos-dataset");

const CLAVE = "gymNutritionTracker";
const PRE = "gymNutritionTracker_preReasignarSesion";
const META = "gymNutritionTracker_syncMeta";
const PLAN_LEGACY = "plan-hist-mu4c87ep730qj1";
const AHORA = "2026-11-09T15:00:00.000Z";
const NINGUNO = "__ninguno__";

/* Plan A (activo al principio): EMPUJE con 3 ejercicios con nombres de
   ejemplo. Una sesión S se guarda bajo A; después se activa el plan B
   (importado) y S queda mal vinculada. */
const TEXTO_B = [
  "EMPUJE",
  "Press Inclinado en  Smith 4x8 RIR 1-2 RPE 8",
  "Press militar arrodillado con mancuernas 3x10 RIR 2 RPE 8",
  "Fondos en paralelas 4x6-8 RIR 1-2 RPE 9",
  "TRACCIÓN",
  "Dominadas toma neutra 4x6-8"
].join("\n");

function escenario(opciones) {
  const e = crearEntorno({ ahora: "2026-11-09T12:00:00", sinSync: !(opciones && opciones.sync), modulos: ["js/actividades.js", "js/pdfImport.js", "js/progreso.js", "js/entrenamiento.js"] });
  const d = aE3(datasetHistoricos({ legacy: true }));
  const planA = d.rutina.planes.find((p) => p.plan_id === d.rutina.plan_activo_id);
  planA.dias[0].nombre = "EMPUJE";
  Object.assign(planA.dias[0].ejercicios[0], { nombre: "PRESS INCLINADO EN SMITH", series_objetivo: 4, reps_objetivo: "8-10" });
  Object.assign(planA.dias[0].ejercicios[1], { nombre: "PRESS MILITAR C/MANCUERNAS SENTADO", series_objetivo: 3, reps_objetivo: "8-12" });
  planA.dias[0].ejercicios.push(Object.assign(clonar(planA.dias[0].ejercicios[1]), { id: "D1-e3", nombre: "FONDOS", orden: 3 }));
  e.escribir(CLAVE, d);
  let n = 0;
  e.GYMAPP.planes.configurarGeneradorIds(() => "b-" + (++n));
  const P = e.GYMAPP.planes;
  /* S: sesión E5 bajo A (como la guarda Entrenar). */
  const sesion = { id: "S", fecha: "2026-11-09T14:00:00.000Z", tipo: "gimnasio", dia_rutina_id: "D1", duracion_min: 75, rpe: 8, notas: "hoy con el plan nuevo",
    ejercicios_realizados: [
      { ejercicio_id: "D1-e1", series: [{ peso_kg: 40, reps: 8 }, { peso_kg: 42.5, reps: 8 }] },
      { ejercicio_id: "D1-e2", series: [{ peso_kg: 14, reps: 10 }] },
      { ejercicio_id: "D1-e3", series: [{ peso_kg: 0, reps: 8 }, { peso_kg: 0, reps: 7 }] }
    ], futbol_detalle: null };
  const v = P.vincularSesionAlPlanActivo(e.GYMAPP.storage.getData(), sesion);
  e.GYMAPP.storage.updateData((x) => { x.sesiones_entrenamiento.push(v.sesion); }, { alertaAutomatica: false });
  /* Activar B. */
  const b = e.GYMAPP.pdfImport.normalizarPlanParseado(e.GYMAPP.pdfImport.parsearPlanDesdeTexto(TEXTO_B));
  const p = P.prepararCambioDePlan(e.GYMAPP.storage.getData(), b, { ahora: AHORA, nombreArchivo: "b.pdf" });
  e.GYMAPP.storage.guardarConCopiaPrevia("gymNutritionTracker_preCambioPlan", p.datos, AHORA);
  const d2 = e.GYMAPP.storage.getData();
  const planB = P.planActivo(d2);
  return { e, P, planA: d2.rutina.planes.find((x) => x.plan_id === planA.plan_id), planB, diaB: planB.dias[0] };
}
const sesionS = (e) => e.leer(CLAVE).sesiones_entrenamiento.find((s) => s.id === "S");
const ids = (dia) => dia.ejercicios.map((x) => x.id);   // [inclinado, militar, fondos] de B

/* Guarda como la UI: prepara y, si está bien, copia previa + un save. */
function reasignar(e, eleccion) {
  const p = e.GYMAPP.planes.prepararReasignacionSesion(e.GYMAPP.storage.getData(), "S", eleccion);
  if (!p.ok) return p;
  return Object.assign(clonar(e.GYMAPP.storage.guardarConCopiaPrevia(PRE, p.datos, AHORA, { sesion_id: "S" })), { sesion: clonar(p.sesion) });
}

/* --- Listados y sugerencias (1-5, 20-21) --- */

test("1-2. planes destino (activo primero) y días del plan", () => {
  const { e, P, planA, planB } = escenario();
  const d = e.GYMAPP.storage.getData();
  assert.deepEqual(clonar(P.planesParaReasignar(d).map((o) => [o.plan.plan_id, o.activo])), [[planB.plan_id, true], [PLAN_LEGACY, false], [planA.plan_id, false]]);
  assert.deepEqual(clonar(planB.dias.map((x) => x.nombre)), ["EMPUJE", "TRACCIÓN"]);
  assert.equal(P.sugerirDiaDestino(d, sesionS(e), planB.plan_id), planB.dias[0].id, "EMPUJE → EMPUJE por nombre");
  assert.equal(P.sugerirDiaDestino(d, sesionS(e), planA.plan_id), "D1", "en su propio plan, su día");
});

test("3, 20. nombre exacto (normalizado) → sugerencia; 4, 21. nombre distinto → sin sugerencia", () => {
  const { e, P, planB, diaB } = escenario();
  const d = e.GYMAPP.storage.getData();
  const m = clonar(P.sugerirMapeoEjercicios(d, sesionS(e), planB.plan_id, diaB.id));
  assert.equal(m["D1-e1"], ids(diaB)[0], "PRESS INCLINADO EN SMITH ↔ 'Press Inclinado en  Smith'");
  assert.equal(m["D1-e2"], "", "PRESS MILITAR C/MANCUERNAS SENTADO ≠ arrodillado: requiere elección manual");
  assert.equal(m["D1-e3"], "", "FONDOS ≠ Fondos en paralelas: no se adivina");
  assert.equal(JSON.stringify(sesionS(e).ejercicios_realizados.map((x) => x.ejercicio_id)), JSON.stringify(["D1-e1", "D1-e2", "D1-e3"]), "sugerir no persiste nada");
});

test("5, 18. caso real: A → B con mapeo manual; cambia solo el vínculo y el snapshot", () => {
  const { e, planB, diaB } = escenario();
  const antes = sesionS(e);
  const [inc, mil, fon] = ids(diaB);
  const r = reasignar(e, { planId: planB.plan_id, diaId: diaB.id, mapeo: { "D1-e1": inc, "D1-e2": mil, "D1-e3": fon } });
  assert.equal(r.ok, true, r.error);
  const s = sesionS(e);
  assert.deepEqual([s.id, s.fecha, s.tipo, s.duracion_min, s.rpe, s.notas], [antes.id, antes.fecha, antes.tipo, antes.duracion_min, antes.rpe, antes.notas]);
  assert.equal(JSON.stringify(s.ejercicios_realizados.map((x) => x.series)), JSON.stringify(antes.ejercicios_realizados.map((x) => x.series)), "series/pesos/reps byte a byte");
  assert.equal(s.plan_id, planB.plan_id);
  assert.equal(s.dia_rutina_id, diaB.id);
  assert.deepEqual(s.ejercicios_realizados.map((x) => x.ejercicio_id), [inc, mil, fon]);
  assert.deepEqual(s.ejercicios_realizados[0].prescripcion_snapshot, { nombre: "Press Inclinado en Smith", grupo_muscular: null, series_objetivo: 4,
    reps_objetivo: "8", rir_objetivo: "1-2", rpe_objetivo: 8, peso_objetivo: null, pausa: null }, "snapshot del ejercicio de B");
  assert.deepEqual(Object.keys(s), Object.keys(antes), "mismas claves y orden");
  s.ejercicios_realizados.forEach((er) => assert.deepEqual(Object.keys(er), ["ejercicio_id", "series", "prescripcion_snapshot"]));
});

test("19. el mapeo respeta la elección, nunca la posición (A,B,C → C',A',B')", () => {
  const { e, planB, diaB } = escenario();
  const [inc, mil, fon] = ids(diaB);
  const antes = sesionS(e);
  const r = reasignar(e, { planId: planB.plan_id, diaId: diaB.id, mapeo: { "D1-e1": fon, "D1-e2": inc, "D1-e3": mil } });
  assert.equal(r.ok, true, r.error);
  const s = sesionS(e);
  assert.deepEqual(s.ejercicios_realizados.map((x) => [x.ejercicio_id, x.prescripcion_snapshot.nombre]), [[fon, "Fondos en paralelas"], [inc, "Press Inclinado en Smith"], [mil, "Press militar arrodillado con mancuernas"]]);
  assert.equal(JSON.stringify(s.ejercicios_realizados.map((x) => x.series)), JSON.stringify(antes.ejercicios_realizados.map((x) => x.series)), "cada ejecución queda en su lugar");
});

/* --- Bloqueos (6-10) --- */

test("6-10. duplicado, sin mapear, 'no corresponde', plan/día/ejercicio inválidos → bloqueado y 0 escrituras", () => {
  const { e, planA, planB, diaB } = escenario();
  const [inc, mil, fon] = ids(diaB);
  const antes = e.localStorage.getItem(CLAVE);
  const escrituras = e.localStorage._escrituras.length;
  const casos = [
    [{ planId: planB.plan_id, diaId: diaB.id, mapeo: { "D1-e1": inc, "D1-e2": inc, "D1-e3": fon } }, /Este ejercicio del plan destino ya está asignado/],
    [{ planId: planB.plan_id, diaId: diaB.id, mapeo: { "D1-e1": inc, "D1-e2": mil } }, /Elegí el ejercicio correspondiente/],
    [{ planId: planB.plan_id, diaId: diaB.id, mapeo: { "D1-e1": inc, "D1-e2": mil, "D1-e3": NINGUNO } }, /^Para reasignar la sesión, todos los ejercicios realizados deben vincularse con un ejercicio del plan destino\.$/],
    [{ planId: "no-existe", diaId: diaB.id, mapeo: {} }, /El plan destino no existe/],
    [{ planId: planB.plan_id, diaId: "D1", mapeo: {} }, /Elegí un día del plan destino/],
    [{ planId: planB.plan_id, diaId: diaB.id, mapeo: { "D1-e1": inc, "D1-e2": mil, "D1-e3": planB.dias[1].ejercicios[0].id } }, /no pertenece al día destino/],
    [{ planId: planA.plan_id, diaId: "D1", mapeo: { "D1-e1": "D1-e1", "D1-e2": "D1-e2", "D1-e3": "D1-e3" } }, /ya está vinculada/]
  ];
  casos.forEach(([eleccion, error], k) => {
    const r = e.GYMAPP.planes.prepararReasignacionSesion(e.GYMAPP.storage.getData(), "S", eleccion);
    assert.equal(r.ok, false, "caso " + k);
    assert.ok(error.test(r.error) || r.errores.some((x) => error.test(x.mensaje)), "caso " + k + ": " + r.error);
  });
  assert.equal(e.localStorage._escrituras.length, escrituras);
  assert.equal(e.localStorage.getItem(CLAVE), antes);
  assert.equal(e.GYMAPP.planes.prepararReasignacionSesion(e.GYMAPP.storage.getData(), "otra", {}).ok, false, "sesión inexistente");
});

test("solo sesiones de gimnasio: otra actividad se rechaza", () => {
  const { e, planB, diaB } = escenario();
  e.GYMAPP.storage.updateData((x) => { x.sesiones_entrenamiento.push({ id: "F", fecha: "2026-11-08T20:00:00.000Z", tipo: "futbol", dia_rutina_id: null, duracion_min: 90, rpe: 7, notas: "", ejercicios_realizados: [], futbol_detalle: null }); }, { alertaAutomatica: false });
  const r = e.GYMAPP.planes.prepararReasignacionSesion(e.GYMAPP.storage.getData(), "F", { planId: planB.plan_id, diaId: diaB.id, mapeo: {} });
  assert.equal(r.ok, false);
  assert.match(r.error, /no es de gimnasio/);
});

/* --- Seguridad (11-13) --- */

test("11. copia preReasignarSesion { data_raw, fecha, sesion_id } antes del único save", () => {
  const { e, planB, diaB } = escenario();
  const [inc, mil, fon] = ids(diaB);
  const antes = e.localStorage.getItem(CLAVE);
  const ops = e.localStorage._operaciones.length;
  assert.equal(reasignar(e, { planId: planB.plan_id, diaId: diaB.id, mapeo: { "D1-e1": inc, "D1-e2": mil, "D1-e3": fon } }).ok, true);
  assert.deepEqual(e.localStorage._operaciones.slice(ops).map((o) => o.join(":")), ["set:" + PRE, "set:" + CLAVE]);
  assert.deepEqual(e.leer(PRE), { data_raw: antes, fecha: AHORA, sesion_id: "S" });
});

test("12-13. falla la copia → 0 cambios; falla el save → estado anterior intacto", () => {
  [[PRE, "copia"], [CLAVE, "guardar"]].forEach(([falla, motivo]) => {
    const { e, planB, diaB } = escenario();
    const [inc, mil, fon] = ids(diaB);
    const antes = e.localStorage.getItem(CLAVE);
    e.localStorage._fallas.add(falla);
    const r = reasignar(e, { planId: planB.plan_id, diaId: diaB.id, mapeo: { "D1-e1": inc, "D1-e2": mil, "D1-e3": fon } });
    assert.deepEqual([r.ok, r.motivo], [false, motivo]);
    assert.equal(e.localStorage.getItem(CLAVE), antes);
  });
});

/* --- Invariantes (14-16) --- */

test("14-15. invariantes: otras sesiones, planes y datos idénticos; en S solo cambian plan_id, dia_rutina_id, ejercicio_id y snapshot", () => {
  const { e, planB, diaB } = escenario();
  const [inc, mil, fon] = ids(diaB);
  const antes = e.leer(CLAVE);
  reasignar(e, { planId: planB.plan_id, diaId: diaB.id, mapeo: { "D1-e1": inc, "D1-e2": mil, "D1-e3": fon } });
  const d = e.leer(CLAVE);
  assert.equal(d.sesiones_entrenamiento.length, antes.sesiones_entrenamiento.length);
  d.sesiones_entrenamiento.forEach((s, i) => { if (s.id !== "S") assert.equal(JSON.stringify(s), JSON.stringify(antes.sesiones_entrenamiento[i]), s.id); });
  ["rutina", "usuario", "registros_nutricion", "base_alimentos", "medidas_corporales", "schema_version"].forEach((k) => assert.equal(JSON.stringify(d[k]), JSON.stringify(antes[k]), k));
  const sa = antes.sesiones_entrenamiento.find((s) => s.id === "S");
  const sd = d.sesiones_entrenamiento.find((s) => s.id === "S");
  const sinVinculo = (s) => Object.assign({}, s, { plan_id: null, dia_rutina_id: null, ejercicios_realizados: s.ejercicios_realizados.map((er) => Object.assign({}, er, { ejercicio_id: null, prescripcion_snapshot: null })) });
  assert.equal(JSON.stringify(sinVinculo(sd)), JSON.stringify(sinVinculo(sa)));
  assert.equal(e.GYMAPP.storage.validarDatosV3(d), null);
  assert.ok(!("dias" in d.rutina));
  /* verificarReasignacion detecta un cambio en la ejecución. */
  const roto = clonar(d);
  roto.sesiones_entrenamiento.find((s) => s.id === "S").ejercicios_realizados[0].series[0].reps = 99;
  assert.match(e.GYMAPP.planes.verificarReasignacion(antes, roto, "S"), /datos de ejecución/);
});

test("16. la sesión aparece una sola vez en el historial, con el día y la prescripción nuevos", () => {
  const { e, planB, diaB } = escenario();
  const [inc, mil, fon] = ids(diaB);
  reasignar(e, { planId: planB.plan_id, diaId: diaB.id, mapeo: { "D1-e1": inc, "D1-e2": mil, "D1-e3": fon } });
  const d = e.GYMAPP.storage.getData();
  const html = e.GYMAPP.entrenamiento.renderHistorial(d);
  assert.equal((html.match(/class="historial-item" data-sesion-id="S"/g) || []).length, 1, "una sola tarjeta");
  assert.match(html, /<div class="historial-item" data-sesion-id="S">[\s\S]*?🏋️ EMPUJE · 3 ejercicios/);
  const s = d.sesiones_entrenamiento.find((x) => x.id === "S");
  const R = e.GYMAPP.rutinasHistoricas;
  assert.equal(R.resolverNombreDiaDeSesion(d, s), "EMPUJE");
  assert.equal(R.resolverEjercicioDeSesion(d, s, s.ejercicios_realizados[1]).nombre, "Press militar arrodillado con mancuernas");
});

test("una sesión anterior a E5 (sin plan_id) también se puede reasignar: recibe plan_id (después de tipo) y snapshots", () => {
  const { e, planB, diaB } = escenario();
  const vieja = e.leer(CLAVE).sesiones_entrenamiento.find((s) => s.dia_rutina_id === "D2" && !("plan_id" in s));
  const [inc, mil] = ids(diaB);
  const mapeo = {};
  mapeo[vieja.ejercicios_realizados[0].ejercicio_id] = inc;
  mapeo[vieja.ejercicios_realizados[1].ejercicio_id] = mil;
  const p = e.GYMAPP.planes.prepararReasignacionSesion(e.GYMAPP.storage.getData(), vieja.id, { planId: planB.plan_id, diaId: diaB.id, mapeo });
  assert.equal(p.ok, true, p.error);
  const s = clonar(p.sesion);
  assert.deepEqual(Object.keys(s).slice(0, 5), ["id", "fecha", "tipo", "plan_id", "dia_rutina_id"]);
  assert.equal(s.plan_id, planB.plan_id);
  assert.ok(s.ejercicios_realizados.every((er) => er.prescripcion_snapshot && Object.keys(er.prescripcion_snapshot).length === 8));
  assert.equal(JSON.stringify(s.ejercicios_realizados.map((x) => x.series)), JSON.stringify(vieja.ejercicios_realizados.map((x) => x.series)));
  /* Con un solo ejercicio destino para dos registrados, se bloquea. */
  const bloqueada = e.GYMAPP.planes.prepararReasignacionSesion(e.GYMAPP.storage.getData(), vieja.id, { planId: planB.plan_id, diaId: planB.dias[1].id,
    mapeo: { [vieja.ejercicios_realizados[0].ejercicio_id]: planB.dias[1].ejercicios[0].id } });
  assert.equal(bloqueada.ok, false);
});

/* --- Progreso (17-18) y sync (19) --- */

test("17-18. Progreso usa el vínculo nuevo y agrupa S con una sesión posterior del mismo plan/día", () => {
  const { e, P, planB, diaB } = escenario();
  const [inc, mil, fon] = ids(diaB);
  reasignar(e, { planId: planB.plan_id, diaId: diaB.id, mapeo: { "D1-e1": inc, "D1-e2": mil, "D1-e3": fon } });
  /* Sesión de la semana siguiente, ya bajo B. */
  const v = P.vincularSesionAlPlanActivo(e.GYMAPP.storage.getData(), { id: "S2", fecha: "2026-11-16T14:00:00.000Z", tipo: "gimnasio", dia_rutina_id: diaB.id, duracion_min: 70, rpe: 8, notas: "",
    ejercicios_realizados: [{ ejercicio_id: inc, series: [{ peso_kg: 45, reps: 8 }] }], futbol_detalle: null });
  e.GYMAPP.storage.updateData((x) => { x.sesiones_entrenamiento.push(v.sesion); }, { alertaAutomatica: false });
  const d = e.GYMAPP.storage.getData();
  const PR = e.GYMAPP.progreso;
  const ejec = clonar(PR.reconstruirEjecucionesEjercicio(d.sesiones_entrenamiento, inc));
  assert.deepEqual(ejec.map((x) => x.pesoMaximo), [42.5, 45], "S (hoy) y S2 (semana próxima) juntas para el mismo ejercicio");
  const bloque = clonar(PR.construirSerieSemanalBloque(d.sesiones_entrenamiento, diaB.id)).filter((x) => x.datos && x.datos.cantidadSesiones > 0);
  assert.equal(bloque.length, 2, "dos semanas con datos en el EMPUJE de B");
  assert.ok(clonar(PR.construirOpcionesEjerciciosDeBloque(d, diaB.id)).some((o) => o.id === mil && o.nombre === "Press militar arrodillado con mancuernas"));
  assert.ok(!clonar(PR.reconstruirEjecucionesEjercicio(d.sesiones_entrenamiento, "D1-e1")).some((x) => x.fecha === "2026-11-09T14:00:00.000Z"), "S ya no cuenta para el ejercicio de A");
});

test("19. 'Sincronizar ahora' sube la corrección como una revisión normal", async () => {
  const { e, planB, diaB } = escenario({ sync: true });
  e.login("uid-A");
  const d = e.GYMAPP.storage.getData();
  e.nube.fila = { data: clonar(d), schema_version: 3, revision: 7, updated_at: "x" };
  e.escribir(META, { user_id: "uid-A", last_known_revision: 7, last_sync_at: "x" });
  const [inc, mil, fon] = ids(diaB);
  reasignar(e, { planId: planB.plan_id, diaId: diaB.id, mapeo: { "D1-e1": inc, "D1-e2": mil, "D1-e3": fon } });
  const c = crearContenedor();
  e.GYMAPP.sync.bindEventosSincronizacion(c);
  c.click("sincronizar-ahora"); await esperar();
  assert.equal(e.nube.fila.revision, 8);
  assert.equal(e.nube.fila.data.sesiones_entrenamiento.find((s) => s.id === "S").plan_id, planB.plan_id);
});
