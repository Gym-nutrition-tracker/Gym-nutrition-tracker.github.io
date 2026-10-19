/* E3: plan histórico legacy persistido en rutina.planes (schema 3).
   Correr con: node --test tests/*.test.js */
const test = require("node:test");
const assert = require("node:assert/strict");
const { crearEntorno, crearContenedor, esperar, clonar, aV3, aE3 } = require("./entorno");
const { datasetHistoricos } = require("./fixtures/historicos-dataset");
const ORIGINAL = require("./fixtures/legacy-original.json");

const CLAVE = "gymNutritionTracker";
const PRE_E3 = "gymNutritionTracker_preE3LegacyBackfill";
const PRE_V3 = "gymNutritionTracker_preMigracionV3";
const META = "gymNutritionTracker_syncMeta";
const PLAN_ID = "plan-hist-mu4c87ep730qj1";
const HOY = "2026-11-09";

const IDS_DIAS = ORIGINAL.bloques.map((b) => b.id);
const IDS_EJERCICIOS = ORIGINAL.bloques.flatMap((b) => b.ejercicios.map((e) => e.id));

/* Estado real de hoy: schema 3 (E2) con plan activo nuevo y sesiones del
   plan anterior, todavía sin el plan legacy persistido. */
const preE3 = () => aV3(datasetHistoricos({ legacy: true }));
const sinLegacy = () => aV3(datasetHistoricos());

function cargar(datos, opciones) {
  const e = crearEntorno(Object.assign({ sinSync: true, ahora: HOY + "T12:00:00" }, opciones || {}));
  const raw = JSON.stringify(datos);
  e.localStorage._mapa.set(CLAVE, raw);
  return { e, raw };
}
const planLegacyDe = (d) => d.rutina.planes.filter((p) => p.plan_id === PLAN_ID);

/* --- Dataset legacy (10-15) --- */

test("dataset: 5 días con los IDs, nombres y orden originales", () => {
  const e = crearEntorno({ sinSync: true });
  const plan = clonar(e.GYMAPP.planLegacy.crearPlanHistoricoLegacy());
  assert.equal(plan.dias.length, 5);
  assert.deepEqual(plan.dias.map((d) => d.id), ["mu4c87ep730qj1", "mu4c87ep241kdy", "mu4c87ep2snsau", "mu4c87epiiepiq", "mu4c87eptjrn47"]);
  assert.deepEqual(plan.dias.map((d) => [d.id, d.nombre, d.orden]), ORIGINAL.bloques.map((b, i) => [b.id, b.nombre, i + 1]));
});

test("dataset: 54 ejercicios únicos, cada uno en su día, en el orden y con el nombre originales", () => {
  const e = crearEntorno({ sinSync: true });
  const plan = clonar(e.GYMAPP.planLegacy.crearPlanHistoricoLegacy());
  const ejercicios = plan.dias.flatMap((d) => d.ejercicios);
  assert.equal(ejercicios.length, 54);
  assert.equal(new Set(ejercicios.map((x) => x.id)).size, 54);
  assert.equal(new Set(plan.dias.map((d) => d.id).concat(ejercicios.map((x) => x.id))).size, 59, "sin IDs repetidos entre días y ejercicios");
  plan.dias.forEach((d, i) => {
    assert.deepEqual(d.ejercicios.map((x) => [x.id, x.nombre, x.orden]), ORIGINAL.bloques[i].ejercicios.map((x, j) => [x.id, x.nombre, j + 1]), d.nombre);
  });
});

test("dataset: los 54 ejercicios coinciden campo por campo con el backup original (grupo, series, reps)", () => {
  const e = crearEntorno({ sinSync: true });
  const plan = clonar(e.GYMAPP.planLegacy.crearPlanHistoricoLegacy());
  let revisados = 0;
  plan.dias.forEach((d, i) => {
    assert.equal(d.nombre, ORIGINAL.bloques[i].nombre);
    d.ejercicios.forEach((x, j) => {
      const ref = ORIGINAL.bloques[i].ejercicios[j];
      assert.deepEqual({ id: x.id, nombre: x.nombre, grupo_muscular: x.grupo_muscular, series_objetivo: x.series_objetivo, reps_objetivo: x.reps_objetivo }, ref, d.nombre + " #" + (j + 1));
      revisados += 1;
    });
  });
  assert.equal(revisados, 54);
});

test("dataset: ningún grupo/series/reps en null; solo RIR, RPE, peso, pausa, comentarios y raw en null", () => {
  const e = crearEntorno({ sinSync: true });
  const ejercicios = clonar(e.GYMAPP.planLegacy.crearPlanHistoricoLegacy().dias.flatMap((d) => d.ejercicios));
  ejercicios.forEach((x) => {
    assert.equal(typeof x.grupo_muscular, "string", x.id);
    assert.ok(x.grupo_muscular.length > 0, x.id);
    assert.ok(Number.isInteger(x.series_objetivo) && x.series_objetivo > 0, x.id);
    assert.equal(typeof x.reps_objetivo, "string", x.id);
    assert.ok(x.reps_objetivo.length > 0, x.id);
    assert.equal(x.eliminado, false);
    const enNull = Object.keys(x).filter((k) => x[k] === null).sort();
    assert.deepEqual(enNull, ["comentarios", "pausa", "peso_objetivo", "raw", "rir_objetivo", "rpe_objetivo"], x.id);
  });
  assert.deepEqual(ejercicios[4], { id: "mu4c87epsr80xw", nombre: "PRESS BANCA C/BARRA", grupo_muscular: "Pecho", series_objetivo: 4, reps_objetivo: "6-8",
    rir_objetivo: null, rpe_objetivo: null, peso_objetivo: null, pausa: null, comentarios: null, raw: null, eliminado: false, orden: 5 });
});

test("dataset: cabecera del plan determinística, sin fechas inventadas", () => {
  const e = crearEntorno({ sinSync: true });
  const plan = clonar(e.GYMAPP.planLegacy.crearPlanHistoricoLegacy());
  delete plan.dias;
  assert.deepEqual(plan, { plan_id: PLAN_ID, nombre: "Plan anterior (reconstruido)", fecha_inicio: null, fecha_fin: null, origen: "legacy",
    version_de: null, creado_en: null, archivado_en: null, fuente: { tipo: "backup_legacy_reconstruido" } });
  assert.equal(JSON.stringify(e.GYMAPP.planLegacy.crearPlanHistoricoLegacy()), JSON.stringify(crearEntorno({ sinSync: true }).GYMAPP.planLegacy.crearPlanHistoricoLegacy()));
});

/* --- Backfill (1-9) --- */

test("schema 3 con sesiones legacy y sin plan → agrega el plan legacy antes del plan activo", () => {
  const antes = preE3();
  const { e } = cargar(antes);
  const d = clonar(e.GYMAPP.storage.getData());
  const g = e.leer(CLAVE);
  assert.equal(g.schema_version, 3);
  assert.deepEqual(g.rutina.planes.map((p) => p.plan_id), [PLAN_ID, antes.rutina.plan_activo_id]);
  assert.equal(planLegacyDe(g).length, 1);
  assert.equal(JSON.stringify(d), JSON.stringify(g), "lo que devuelve getData es lo guardado");
  assert.equal(e.GYMAPP.storage.validarDatosV3(g), null);
});

test("plan_activo_id y plan activo intactos (byte a byte); Entrenar/Dashboard/PROG-04 siguen viendo solo el activo", () => {
  const antes = preE3();
  const { e } = cargar(antes, { modulos: ["js/actividades.js", "js/progreso.js"] });
  const d = e.GYMAPP.storage.getData();
  assert.equal(d.rutina.plan_activo_id, antes.rutina.plan_activo_id);
  assert.equal(JSON.stringify(e.GYMAPP.planes.planActivo(d)), JSON.stringify(antes.rutina.planes[0]));
  assert.deepEqual(clonar(e.GYMAPP.planes.diasDelPlanActivo(d).map((x) => x.id)), ["D1", "D2", "D3", "D4", "D5"]);
  const P = e.GYMAPP.progreso;
  assert.deepEqual(clonar(P.calcularEstadoPlan(P.construirInputEstadoPlan(d, HOY))), clonar(P.calcularEstadoPlan(P.construirInputEstadoPlan(antes, HOY))), "PROG-04 igual");
});

test("sesiones, nutrición, alimentos, medidas y usuario idénticos por JSON.stringify", () => {
  const antes = preE3();
  antes.registros_nutricion = [{ fecha: "2026-10-01", comidas: [{ nombre: "x", calorias: 100 }] }];
  antes.medidas_corporales = [{ fecha: "2026-10-01", peso: 80 }];
  antes.base_alimentos = [{ nombre: "Arroz" }];
  const { e } = cargar(antes);
  e.GYMAPP.storage.getData();
  const g = e.leer(CLAVE);
  ["sesiones_entrenamiento", "registros_nutricion", "base_alimentos", "medidas_corporales", "usuario", "schema_version"].forEach((k) => {
    assert.equal(JSON.stringify(g[k]), JSON.stringify(antes[k]), k);
  });
});

test("schema 3 sin sesiones legacy → no agrega nada y 0 escrituras", () => {
  const { e, raw } = cargar(sinLegacy());
  e.GYMAPP.storage.getData();
  assert.deepEqual(e.localStorage._escrituras, []);
  assert.equal(e.localStorage.getItem(CLAVE), raw);
  assert.equal(e.localStorage.getItem(PRE_E3), null);
});

test("plan ya presente → idempotente: 0 escrituras y mismo JSON", () => {
  const { e } = cargar(preE3());
  e.GYMAPP.storage.getData();
  const despues = e.localStorage.getItem(CLAVE);
  const otro = cargar(JSON.parse(despues));
  const d = otro.e.GYMAPP.storage.getData();
  assert.deepEqual(otro.e.localStorage._escrituras, []);
  assert.equal(JSON.stringify(Object.assign({}, d)), despues);
  assert.equal(otro.e.GYMAPP.storage.aplicarBackfillsV3(JSON.parse(despues)).cambio, false);
});

test("backfill dos veces en memoria → mismo JSON; no muta el dato de entrada", () => {
  const e = crearEntorno({ sinSync: true });
  const S = e.GYMAPP.storage;
  const entrada = preE3();
  const copia = JSON.stringify(entrada);
  const una = S.aplicarBackfillsV3(entrada);
  assert.equal(JSON.stringify(entrada), copia, "la entrada no se toca");
  const dos = S.aplicarBackfillsV3(una.datos);
  assert.equal(una.cambio, true);
  assert.equal(dos.cambio, false);
  assert.equal(JSON.stringify(dos.datos), JSON.stringify(una.datos));
});

test("dos dispositivos con el mismo schema 3 → exactamente el mismo JSON (y relojes distintos)", () => {
  const a = cargar(preE3(), { ahora: "2026-10-20T08:00:00Z" });
  const b = cargar(preE3(), { ahora: "2027-02-01T23:59:00Z" });
  a.e.GYMAPP.storage.getData();
  b.e.GYMAPP.storage.getData();
  assert.equal(a.e.localStorage.getItem(CLAVE), b.e.localStorage.getItem(CLAVE));
  assert.equal(a.e.localStorage.getItem(CLAVE), JSON.stringify(aE3(datasetHistoricos({ legacy: true }))));
});

test("schema 2 directo a E3 (un solo paso) = schema 2 → E2 → E3 (mismo JSON)", () => {
  const v2 = datasetHistoricos({ legacy: true });
  const directo = cargar(v2);
  directo.e.GYMAPP.storage.getData();
  const enDosPasos = cargar(preE3());
  enDosPasos.e.GYMAPP.storage.getData();
  assert.equal(directo.e.localStorage.getItem(CLAVE), enDosPasos.e.localStorage.getItem(CLAVE));
  assert.equal(directo.e.leer(PRE_V3).data_raw, JSON.stringify(v2), "la copia previa es la de schema 2");
  assert.equal(directo.e.localStorage.getItem(PRE_E3), null, "no hubo un schema 3 previo guardado");
});

test("si el plan activo ya contiene los días legacy (backup viejo con ese plan) → no se duplica", () => {
  const e = crearEntorno({ sinSync: true });
  const legacyComoActivo = aV3({ schema_version: 2, usuario: { nombre: "N" },
    rutina: { dias: e.GYMAPP.planLegacy.crearPlanHistoricoLegacy().dias.map((d) => ({ id: d.id, nombre: d.nombre, ejercicios: [] })) },
    sesiones_entrenamiento: [{ id: "s", fecha: "2026-09-01T10:00:00", tipo: "gimnasio", dia_rutina_id: "mu4c87ep730qj1", ejercicios_realizados: [] }],
    registros_nutricion: [], base_alimentos: [], medidas_corporales: [] });
  assert.equal(e.GYMAPP.storage.aplicarBackfillsV3(legacyComoActivo).cambio, false);
});

/* --- Seguridad (24-27) --- */

test("preE3LegacyBackfill: guarda el texto schema 3 exacto, ANTES del save", () => {
  const { e, raw } = cargar(preE3());
  e.GYMAPP.storage.getData();
  assert.equal(e.leer(PRE_E3).data_raw, raw);
  assert.deepEqual(e.localStorage._operaciones.filter((o) => o[0] === "set").map((o) => o[1]), [PRE_E3, CLAVE]);
});

test("una copia preE3 ya existente no se pisa (se conserva la primera)", () => {
  const { e } = cargar(preE3());
  e.localStorage._mapa.set(PRE_E3, JSON.stringify({ data_raw: "primera" }));
  e.GYMAPP.storage.getData();
  assert.equal(e.leer(PRE_E3).data_raw, "primera");
  assert.equal(planLegacyDe(e.leer(CLAVE)).length, 1);
});

test("falla la copia previa → no persiste, sigue con los datos anteriores y no reintenta en la sesión", () => {
  const { e, raw } = cargar(preE3());
  e.localStorage._fallas.add(PRE_E3);
  const d = e.GYMAPP.storage.getData();
  assert.equal(e.localStorage.getItem(CLAVE), raw);
  assert.equal(planLegacyDe(d).length, 0, "devuelve los datos sin el plan");
  assert.match(e.GYMAPP.storage.obtenerFalloBackfillE3().motivo, /copia previa/);
  assert.equal(e.GYMAPP.storage.obtenerBloqueoMigracion(), null, "no bloquea la app");
  e.localStorage._fallas.delete(PRE_E3);
  e.GYMAPP.storage.getData();
  assert.equal(e.localStorage.getItem(CLAVE), raw, "no reintenta en la misma sesión");
  const r = e.GYMAPP.storage.updateData((x) => { x.usuario.nombre = "Editado"; }, { alertaAutomatica: false });
  assert.equal(r.guardado, true, "la app sigue funcionando");
  assert.equal(planLegacyDe(e.leer(CLAVE)).length, 0, "un guardado normal no persiste un backfill sin copia previa");
});

test("falla el save del backfill → principal intacto, la copia previa queda", () => {
  const { e, raw } = cargar(preE3());
  e.localStorage._fallas.add(CLAVE);
  const d = e.GYMAPP.storage.getData();
  assert.equal(e.localStorage.getItem(CLAVE), raw);
  assert.equal(planLegacyDe(d).length, 0);
  assert.equal(e.leer(PRE_E3).data_raw, raw);
  assert.match(e.GYMAPP.storage.obtenerFalloBackfillE3().motivo, /guardar/);
});

test("recargar después de una falla reintenta y completa el backfill", () => {
  const { e } = cargar(preE3());
  e.localStorage._fallas.add(CLAVE);
  e.GYMAPP.storage.getData();
  const recarga = crearEntorno({ sinSync: true });
  recarga.localStorage._mapa.set(CLAVE, e.localStorage.getItem(CLAVE));
  recarga.localStorage._mapa.set(PRE_E3, e.localStorage.getItem(PRE_E3));
  recarga.GYMAPP.storage.getData();
  assert.equal(planLegacyDe(recarga.leer(CLAVE)).length, 1);
});

/* --- Resolvers (16-19) y chequeo sin fallback --- */

test("después del backfill, bloques y ejercicios se resuelven desde rutina.planes", () => {
  const { e } = cargar(preE3());
  const d = clonar(e.GYMAPP.storage.getData());
  /* Cambiar el nombre en el plan persistido demuestra de dónde sale. */
  d.rutina.planes[0].dias[2].nombre = "TRACCIÓN (persistido)";
  d.rutina.planes[0].dias[0].ejercicios[4].nombre = "PRESS BANCA (persistido)";
  const R = e.GYMAPP.rutinasHistoricas;
  assert.equal(R.resolverNombreBloqueHistorico(d, "mu4c87ep2snsau").nombre, "TRACCIÓN (persistido)");
  assert.equal(R.resolverNombreBloqueHistorico(d, "mu4c87ep2snsau").orden, 2, "mismo orden que el plan original");
  assert.equal(R.resolverNombreEjercicioHistorico(d, "mu4c87epsr80xw"), "PRESS BANCA (persistido)");
  assert.equal(R.resolverNombreDiaRutina(d, "mu4c87ep2snsau"), "TRACCIÓN (persistido)");
  assert.equal(R.resolverNombreDiaRutina(d, "D1"), "Día 1 · Pecho", "el plan activo tiene prioridad");
});

test("sin fallback legacy en runtime, el plan persistido resuelve los 5 bloques y los 54 ejercicios", () => {
  const { e } = cargar(preE3());
  const d = e.GYMAPP.storage.getData();
  delete e.GYMAPP.planLegacy;
  const R = e.GYMAPP.rutinasHistoricas;
  ORIGINAL.bloques.forEach((b, i) => {
    assert.deepEqual(clonar(R.resolverNombreBloqueHistorico(d, b.id)), { nombre: b.nombre, orden: i });
    b.ejercicios.forEach(({ id, nombre }) => assert.equal(R.resolverNombreEjercicioHistorico(d, id), nombre, id));
  });
  /* Y sin plan persistido ni fallback: nada se resuelve (control). */
  const sinPlan = preE3();
  assert.equal(R.resolverNombreBloqueHistorico(sinPlan, IDS_DIAS[0]), null);
  assert.equal(R.nombreEjercicioConocido(sinPlan, IDS_EJERCICIOS[0]), null);
});

test("sin plan persistido, el fallback legacy sigue resolviendo los mismos nombres y orden", () => {
  const e = crearEntorno({ sinSync: true });
  const d = preE3();
  const R = e.GYMAPP.rutinasHistoricas;
  ORIGINAL.bloques.forEach((b, i) => {
    assert.deepEqual(clonar(R.resolverNombreBloqueHistorico(d, b.id)), { nombre: b.nombre, orden: i });
    b.ejercicios.forEach(({ id, nombre }) => assert.equal(R.resolverNombreEjercicioHistorico(d, id), nombre));
  });
});

test("ID desconocido → fallback neutral (con y sin plan persistido)", () => {
  const { e } = cargar(preE3());
  const d = e.GYMAPP.storage.getData();
  const R = e.GYMAPP.rutinasHistoricas;
  [d, preE3()].forEach((x) => {
    assert.equal(R.resolverNombreBloqueHistorico(x, "old-1"), null);
    assert.equal(R.resolverNombreDiaRutina(x, "old-1"), "Bloque anterior");
    assert.equal(R.resolverNombreEjercicioHistorico(x, "old-1-e1"), "Ejercicio anterior");
    assert.equal(R.nombreEjercicioConocido(x, "mu4c87ep730qj1-ej1"), null);
  });
});

test("GYMAPP.planes: búsquedas en todos los planes", () => {
  const { e } = cargar(preE3());
  const d = e.GYMAPP.storage.getData();
  const P = e.GYMAPP.planes;
  assert.equal(P.buscarDiaEnPlanes(d, "mu4c87epiiepiq").plan.plan_id, PLAN_ID);
  assert.equal(P.buscarDiaEnPlanes(d, "D2").plan.plan_id, d.rutina.plan_activo_id);
  assert.equal(P.buscarDiaEnPlanes(d, "nada"), null);
  const r = P.buscarEjercicioEnPlanes(d, "mu4c87ep94uybp");
  assert.equal(r.dia.id, "mu4c87eptjrn47");
  assert.equal(r.ejercicio.nombre, "TRICEPS TRASNUCA C/BARRA");
  assert.equal(P.buscarEjercicioEnPlan(d, PLAN_ID, "mu4c87epsr80xw").nombre, "PRESS BANCA C/BARRA");
  assert.equal(P.buscarEjercicioEnPlan(d, d.rutina.plan_activo_id, "mu4c87epsr80xw"), null);
  assert.equal(P.buscarEjercicioActivo(d, "mu4c87epsr80xw"), null, "el plan legacy no es editable/activo");
});

/* --- Progreso y Entrenar: mismos resultados antes/después --- */

test("Progreso: opciones históricas, ejercicios, evolución y análisis idénticos antes y después del backfill", () => {
  const mods = { modulos: ["js/actividades.js", "js/progreso.js"] };
  const antes = cargar(preE3(), mods);
  antes.e.localStorage._fallas.add(PRE_E3);   // sin backfill: misma sesión con datos pre-E3
  const dA = antes.e.GYMAPP.storage.getData();
  const desp = cargar(preE3(), mods);
  const dD = desp.e.GYMAPP.storage.getData();
  assert.equal(planLegacyDe(dA).length, 0);
  assert.equal(planLegacyDe(dD).length, 1);
  const PA = antes.e.GYMAPP.progreso, PD = desp.e.GYMAPP.progreso;
  assert.deepEqual(clonar(PD.construirOpcionesBloquesHistoricos(dD)), clonar(PA.construirOpcionesBloquesHistoricos(dA)));
  IDS_DIAS.forEach((id) => {
    assert.deepEqual(clonar(PD.distinguirEjerciciosEliminados(dD, id, PD.construirOpcionesEjerciciosDeBloque(dD, id))),
      clonar(PA.distinguirEjerciciosEliminados(dA, id, PA.construirOpcionesEjerciciosDeBloque(dA, id))), id);
  });
  assert.deepEqual(clonar(PD.calcularEstadoPlan(PD.construirInputEstadoPlan(dD, HOY))), clonar(PA.calcularEstadoPlan(PA.construirInputEstadoPlan(dA, HOY))));
});

test("Entrenar: historial idéntico antes y después, y editar no toca IDs ni series", () => {
  const mods = { modulos: ["js/actividades.js", "js/entrenamiento.js"] };
  const antes = cargar(preE3(), mods);
  antes.e.localStorage._fallas.add(PRE_E3);
  const desp = cargar(preE3(), mods);
  const hA = antes.e.GYMAPP.entrenamiento.renderHistorial(antes.e.GYMAPP.storage.getData());
  const hD = desp.e.GYMAPP.entrenamiento.renderHistorial(desp.e.GYMAPP.storage.getData());
  assert.equal(hD, hA);
  assert.match(hD, /TRACCIÓN/);
  assert.equal(JSON.stringify(desp.e.leer(CLAVE).sesiones_entrenamiento), JSON.stringify(preE3().sesiones_entrenamiento));
});

/* --- Backup import (20-23) --- */

function importar(texto, local) {
  const e = crearEntorno({ sinSync: true });
  e.escribir(CLAVE, local || sinLegacy());
  e.cargar("js/backupImport.js");
  return { e, r: e.GYMAPP.backupImport.prepararImportacionBackup(texto) };
}

test("import schema 2 con sesiones legacy → schema 3 + plan legacy", () => {
  const { r } = importar(JSON.stringify(datasetHistoricos({ legacy: true })));
  assert.equal(r.ok, true, r.error);
  assert.equal(r.datos.schema_version, 3);
  assert.equal(JSON.stringify(r.datos), JSON.stringify(aE3(datasetHistoricos({ legacy: true }))));
  assert.equal(planLegacyDe(r.datos).length, 1);
});

test("import schema 3 pre-E3 → backfill; schema 3 con plan → no duplica", () => {
  const pre = importar(JSON.stringify(preE3())).r;
  assert.equal(pre.ok, true, pre.error);
  assert.equal(planLegacyDe(pre.datos).length, 1);
  const ya = importar(JSON.stringify(pre.datos)).r;
  assert.equal(ya.ok, true);
  assert.equal(JSON.stringify(ya.datos), JSON.stringify(pre.datos));
  assert.equal(planLegacyDe(ya.datos).length, 1);
});

test("import sin sesiones legacy → sin plan legacy; schema 4 rechazado sin escribir", () => {
  const sin = importar(JSON.stringify(sinLegacy())).r;
  assert.equal(sin.ok, true);
  assert.equal(planLegacyDe(sin.datos).length, 0);
  const { e, r } = importar(JSON.stringify(Object.assign(preE3(), { schema_version: 4 })));
  assert.equal(r.ok, false);
  assert.match(r.error, /versión más nueva/);
  assert.deepEqual(e.localStorage._escrituras, []);
});

test("aplicar el import de un backup pre-E3 guarda el plan legacy (y respeta el orden de E0)", () => {
  const { e, r } = importar(JSON.stringify(preE3()));
  e.escribir(META, { user_id: "uid-A", last_known_revision: 2, last_sync_at: "x" });
  const ops = e.localStorage._operaciones.length;
  assert.equal(e.GYMAPP.backupImport.aplicarImportacionBackup(r, { nombreArchivo: "b.json" }).ok, true);
  assert.deepEqual(e.localStorage._operaciones.slice(ops), [["set", "gymNutritionTracker_preImportBackup"], ["remove", META], ["set", CLAVE]]);
  assert.equal(planLegacyDe(e.leer(CLAVE)).length, 1);
  e.GYMAPP.storage.getData();
  assert.equal(e.localStorage.getItem(PRE_E3), null, "ya guardado con el plan: no hay backfill posterior");
});

/* --- SYNC --- */

function dispositivo(local, fila, meta) {
  const e = crearEntorno({ ahora: HOY + "T12:00:00" });
  e.login("uid-A");
  e.escribir(CLAVE, local);
  e.nube.fila = clonar(fila);
  if (meta) e.escribir(META, meta);
  const c = crearContenedor();
  e.GYMAPP.sync.bindEventosSincronizacion(c);
  return { e, c };
}
const rpcs = (e) => e.nube.llamadas.filter((l) => l.tipo === "rpc");

test("SYNC: A hace backfill y sube; B hace el mismo backfill → coincide con la nube (estrategia A, 0 RPC)", async () => {
  const nube = { data: preE3(), schema_version: 3, revision: 2, updated_at: "2026-10-19T10:00:00Z" };
  const meta = { user_id: "uid-A", last_known_revision: 2, last_sync_at: "2026-10-19T10:00:00Z" };
  const A = dispositivo(preE3(), nube, meta);
  const rA = await A.e.GYMAPP.sync.sincronizarAhora();
  assert.equal(rA.estado, "actualizado");
  assert.equal(rpcs(A.e)[0].params.p_expected_revision, 2);
  assert.equal(planLegacyDe(A.e.nube.fila.data).length, 1);
  assert.equal(A.e.nube.fila.revision, 3);

  const B = dispositivo(preE3(), A.e.nube.fila, meta);
  const rB = await B.e.GYMAPP.sync.sincronizarAhora();
  assert.equal(rB.estado, "baseline_actualizada");
  assert.equal(rpcs(B.e).length, 0);
  assert.equal(B.e.leer(META).last_known_revision, 3);
  assert.equal(B.e.localStorage.getItem(CLAVE), JSON.stringify(A.e.nube.fila.data), "A y B quedan con el mismo JSON");
});

test("SYNC: restaurar desde la nube un blob pre-E3 → la próxima carga hace el backfill con copia previa", async () => {
  const B = dispositivo(sinLegacy(), { data: preE3(), schema_version: 3, revision: 2, updated_at: "2026-10-19T10:00:00Z" });
  B.e.respuestas.confirm.push(true);
  B.c.click("recuperar-de-la-nube"); await esperar();
  const d = B.e.GYMAPP.storage.getData();
  assert.equal(planLegacyDe(d).length, 1);
  assert.equal(planLegacyDe(B.e.leer(CLAVE)).length, 1);
  assert.equal(planLegacyDe(JSON.parse(B.e.leer(PRE_E3).data_raw)).length, 0);
  assert.equal(rpcs(B.e).length, 0);
});
