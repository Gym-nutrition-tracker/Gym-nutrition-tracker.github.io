/* E5: plan_id y prescripcion_snapshot en sesiones NUEVAS de gimnasio.
   El flujo real de Entrenar (DOM) está en tests/e2e/sesion-plan.e2e.js.
   Correr con: node --test tests/*.test.js */
const test = require("node:test");
const assert = require("node:assert/strict");
const { crearEntorno, crearContenedor, esperar, clonar, aE3 } = require("./entorno");
const { datasetHistoricos } = require("./fixtures/historicos-dataset");

const CLAVE = "gymNutritionTracker";
const META = "gymNutritionTracker_syncMeta";
const HOY = "2026-11-09";
const CAMPOS = ["nombre", "grupo_muscular", "series_objetivo", "reps_objetivo", "rir_objetivo", "rpe_objetivo", "peso_objetivo", "pausa"];

/* Plan activo con EMPUJE y PRESS BANCA 4 × 6-8, RIR 2 (+ plan legacy por E3). */
function datos() {
  const d = aE3(datasetHistoricos({ legacy: true }));
  const activo = d.rutina.planes.find((p) => p.plan_id === d.rutina.plan_activo_id);
  activo.dias[0].nombre = "EMPUJE";
  Object.assign(activo.dias[0].ejercicios[0], { nombre: "PRESS BANCA C/BARRA", grupo_muscular: "Pecho", series_objetivo: 4, reps_objetivo: "6-8", rir_objetivo: 2, comentarios: "codos a 45°", raw: "PRESS BANCA 4x6-8 RIR2" });
  return d;
}
const activoDe = (d) => d.rutina.planes.find((p) => p.plan_id === d.rutina.plan_activo_id);
const entorno = (d) => {
  const e = crearEntorno({ sinSync: true, ahora: HOY + "T12:00:00", modulos: ["js/actividades.js", "js/progreso.js", "js/entrenamiento.js"] });
  e.escribir(CLAVE, d || datos());
  return e;
};
/* Sesión tal como la arma guardarSesion() antes de vincular. */
const sesionGym = (extra) => Object.assign({
  id: "nueva", fecha: "2026-11-09T15:00:00.000Z", tipo: "gimnasio", dia_rutina_id: "D1", duracion_min: 60, rpe: 8, notas: "",
  ejercicios_realizados: [{ ejercicio_id: "D1-e1", series: [{ peso_kg: 60, reps: 8 }] }, { ejercicio_id: "D1-e2", series: [{ peso_kg: 20, reps: 12 }] }],
  futbol_detalle: null
}, extra || {});

/* Guarda una sesión nueva igual que Entrenar: vincular y, si está bien, un único updateData. */
function guardarNueva(e, sesion) {
  const v = e.GYMAPP.planes.vincularSesionAlPlanActivo(e.GYMAPP.storage.getData(), sesion);
  if (!v.ok) return v;
  const r = e.GYMAPP.storage.updateData((d) => { d.sesiones_entrenamiento.push(v.sesion); }, { alertaAutomatica: false });
  return { ok: r.guardado, sesion: clonar(v.sesion) };
}
const guardada = (e, id) => e.leer(CLAVE).sesiones_entrenamiento.find((s) => s.id === (id || "nueva"));

/* --- Creación (1-7) --- */

test("1-5. sesión nueva de gimnasio: plan_id del plan activo y snapshot de 8 campos por ejercicio", () => {
  const e = entorno();
  assert.equal(guardarNueva(e, sesionGym()).ok, true);
  const s = guardada(e);
  const d = e.leer(CLAVE);
  assert.equal(s.plan_id, d.rutina.plan_activo_id, "1-2");
  assert.deepEqual(Object.keys(s), ["id", "fecha", "tipo", "plan_id", "dia_rutina_id", "duracion_min", "rpe", "notas", "ejercicios_realizados", "futbol_detalle"]);
  s.ejercicios_realizados.forEach((er) => {
    assert.deepEqual(Object.keys(er), ["ejercicio_id", "series", "prescripcion_snapshot"], "3");
    assert.deepEqual(Object.keys(er.prescripcion_snapshot), CAMPOS, "4. solo los 8 campos");
  });
  assert.deepEqual(s.ejercicios_realizados[0].prescripcion_snapshot, { nombre: "PRESS BANCA C/BARRA", grupo_muscular: "Pecho", series_objetivo: 4,
    reps_objetivo: "6-8", rir_objetivo: 2, rpe_objetivo: null, peso_objetivo: null, pausa: null }, "5. sin comentarios/raw/eliminado/orden");
  const ej2 = activoDe(d).dias[0].ejercicios[1];
  assert.deepEqual(s.ejercicios_realizados[1].prescripcion_snapshot, Object.fromEntries(CAMPOS.map((k) => [k, ej2[k]])), "5");
  assert.deepEqual(s.ejercicios_realizados[0].series, [{ peso_kg: 60, reps: 8 }], "series sin cambios");
  assert.equal(e.GYMAPP.storage.validarDatosV3(d), null);
});

test("6-7. actividades no gimnasio: misma estructura de siempre, sin plan_id ni snapshot", () => {
  const futbol = { id: "f", fecha: "2026-11-09T20:00:00.000Z", tipo: "futbol", dia_rutina_id: null, duracion_min: 90, rpe: 7, notas: "",
    ejercicios_realizados: [], futbol_detalle: null, detalle: { tipo_sesion: "partido", posicion: "", minutos_jugados: 90 } };
  const fuente = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "js", "entrenamiento.js"), "utf8");
  /* El vínculo solo se arma dentro de la rama de gimnasio de guardarSesion. */
  const rama = fuente.slice(fuente.indexOf('if (estado.tipo === "gimnasio") {\n      var ejerciciosRealizados;'), fuente.indexOf('} else if (estado.tipo === "natacion")'));
  assert.match(rama, /vincularSesionAlPlanActivo/);
  assert.equal((fuente.match(/vincularSesionAlPlanActivo/g) || []).length, 1, "un solo punto de creación");
  const e = entorno();
  e.GYMAPP.storage.updateData((d) => { d.sesiones_entrenamiento.push(futbol); }, { alertaAutomatica: false });
  const g = guardada(e, "f");
  assert.ok(!("plan_id" in g));
  assert.equal(JSON.stringify(g), JSON.stringify(futbol));
});

/* --- Validación (8-11) --- */

test("8-11. plan activo inexistente, día o ejercicio inexistente → error claro y 0 escrituras", () => {
  const casos = [
    ["8", (d) => { d.rutina.plan_activo_id = "no-existe"; }, sesionGym(), /plan activo/],
    ["9", null, sesionGym({ dia_rutina_id: "mu4c87ep730qj1" }), /día seleccionado ya no existe en tu plan activo/],
    ["10", null, sesionGym({ ejercicios_realizados: [{ ejercicio_id: "D2-e1", series: [{ peso_kg: 1, reps: 1 }] }] }), /ejercicio de la sesión ya no existe/]
  ];
  casos.forEach(([n, preparar, sesion, error]) => {
    const d = datos();
    if (preparar) preparar(d);
    const e = entorno(d);
    const antes = e.localStorage.getItem(CLAVE);
    const r = guardarNueva(e, sesion);
    assert.equal(r.ok, false, n);
    assert.match(r.error, error, n);
    assert.match(r.error, /No se guardó la sesión/, n);
    assert.deepEqual(e.localStorage._escrituras, [], n + ". sin escritura parcial");
    assert.equal(e.localStorage.getItem(CLAVE), antes, n);
  });
});

test("vincular no muta la sesión ni los datos de entrada", () => {
  const e = entorno();
  const d = e.GYMAPP.storage.getData();
  const s = sesionGym();
  const antesD = JSON.stringify(d), antesS = JSON.stringify(s);
  e.GYMAPP.planes.vincularSesionAlPlanActivo(d, s);
  assert.equal(JSON.stringify(d), antesD);
  assert.equal(JSON.stringify(s), antesS);
});

/* --- Inmutabilidad (12-16) + caso realista (18) --- */

test("18. caso realista: PRESS BANCA 4 × 6-8 RIR 2; el plan pasa a 3 × 10-12 RIR 3; la sesión conserva 4 × 6-8 RIR 2", () => {
  const e = entorno();
  guardarNueva(e, sesionGym());
  const snapAntes = JSON.stringify(guardada(e).ejercicios_realizados[0].prescripcion_snapshot);
  e.GYMAPP.storage.updateData((d) => {
    Object.assign(e.GYMAPP.planes.buscarEjercicioEnDiaActivo(d, "D1", "D1-e1"), { series_objetivo: 3, reps_objetivo: "10-12", rir_objetivo: 3 });
  }, { alertaAutomatica: false });
  const s = guardada(e);
  const snap = s.ejercicios_realizados[0].prescripcion_snapshot;
  assert.deepEqual([snap.series_objetivo, snap.reps_objetivo, snap.rir_objetivo], [4, "6-8", 2]);
  assert.equal(JSON.stringify(snap), snapAntes, "byte a byte");
  const plan = activoDe(e.leer(CLAVE)).dias[0].ejercicios[0];
  assert.deepEqual([plan.series_objetivo, plan.reps_objetivo, plan.rir_objetivo], [3, "10-12", 3], "el plan sí cambió");
  /* La resolución por sesión muestra lo prescripto en ese momento. */
  const R = e.GYMAPP.rutinasHistoricas;
  const r = R.resolverEjercicioDeSesion(e.GYMAPP.storage.getData(), s, s.ejercicios_realizados[0]);
  assert.deepEqual([r.nombre, r.prescripcion.series_objetivo, r.prescripcion.reps_objetivo, r.prescripcion.rir_objetivo], ["PRESS BANCA C/BARRA", 4, "6-8", 2]);
});

test("12-14. editar metadata del plan, renombrar el ejercicio o cambiar plan_activo_id no toca la sesión", () => {
  const e = entorno();
  guardarNueva(e, sesionGym());
  const antes = JSON.stringify(guardada(e));
  e.GYMAPP.storage.updateData((d) => {
    e.GYMAPP.planes.actualizarMetadataPlanActivo(d, { nombre: "Plan N.º 4", fecha_inicio: "2026-10-12", fecha_fin: "2026-12-18" });
    e.GYMAPP.planes.buscarEjercicioEnDiaActivo(d, "D1", "D1-e1").nombre = "PRESS BANCA (renombrado)";
  }, { alertaAutomatica: false });
  assert.equal(JSON.stringify(guardada(e)), antes, "12-13");
  e.GYMAPP.storage.updateData((d) => { d.rutina.plan_activo_id = "plan-hist-mu4c87ep730qj1"; }, { alertaAutomatica: false });
  assert.equal(JSON.stringify(guardada(e)), antes, "14");
});

test("15-16. editar la sesión conserva plan_id y los snapshots byte a byte (aunque el plan haya cambiado)", () => {
  const e = entorno();
  guardarNueva(e, sesionGym());
  const original = guardada(e);
  e.GYMAPP.storage.updateData((d) => {
    Object.assign(e.GYMAPP.planes.buscarEjercicioEnDiaActivo(d, "D1", "D1-e1"), { series_objetivo: 3, reps_objetivo: "10-12", rir_objetivo: 3 });
  }, { alertaAutomatica: false });
  /* Como guardarSesion() en edición: arma la sesión de nuevo SIN los campos E5. */
  const editada = { id: original.id, fecha: original.fecha, tipo: "gimnasio", dia_rutina_id: original.dia_rutina_id, duracion_min: 70, rpe: 9, notas: "editada",
    ejercicios_realizados: [{ ejercicio_id: "D1-e1", series: [{ peso_kg: 62.5, reps: 7 }] }], futbol_detalle: null };
  const conservada = clonar(e.GYMAPP.planes.conservarVinculoPlan(original, editada));
  assert.equal(conservada.plan_id, original.plan_id, "15");
  assert.equal(JSON.stringify(conservada.ejercicios_realizados[0].prescripcion_snapshot), JSON.stringify(original.ejercicios_realizados[0].prescripcion_snapshot), "16");
  assert.deepEqual(conservada.ejercicios_realizados[0].series, [{ peso_kg: 62.5, reps: 7 }], "la ejecución sí se edita");
  assert.deepEqual([conservada.duracion_min, conservada.rpe, conservada.notas], [70, 9, "editada"]);
  assert.deepEqual(Object.keys(conservada), Object.keys(original), "mismo orden de claves");
});

test("conservarVinculoPlan asocia cada snapshot por ejercicio_id, nunca por posición", () => {
  const e = entorno();
  const snapA = { nombre: "A", grupo_muscular: "Pecho", series_objetivo: 4, reps_objetivo: "6-8", rir_objetivo: 2, rpe_objetivo: null, peso_objetivo: null, pausa: null };
  const snapB = { nombre: "B", grupo_muscular: "Espalda", series_objetivo: 3, reps_objetivo: "10", rir_objetivo: null, rpe_objetivo: 8, peso_objetivo: 40, pausa: "90s" };
  const original = { id: "x", fecha: "f", tipo: "gimnasio", plan_id: "plan-1", dia_rutina_id: "D1", duracion_min: 60, rpe: 8, notas: "", futbol_detalle: null,
    ejercicios_realizados: [{ ejercicio_id: "A", series: [{ peso_kg: 1, reps: 1 }], prescripcion_snapshot: snapA },
      { ejercicio_id: "B", series: [{ peso_kg: 2, reps: 2 }], prescripcion_snapshot: snapB }] };
  const base = (ejercicios) => ({ id: "x", fecha: "f", tipo: "gimnasio", dia_rutina_id: "D1", duracion_min: 60, rpe: 8, notas: "", ejercicios_realizados: ejercicios, futbol_detalle: null });
  const P = e.GYMAPP.planes;
  /* Orden invertido. */
  const invertida = clonar(P.conservarVinculoPlan(original, base([{ ejercicio_id: "B", series: [{ peso_kg: 22, reps: 2 }] }, { ejercicio_id: "A", series: [{ peso_kg: 11, reps: 1 }] }])));
  assert.deepEqual(invertida.ejercicios_realizados.map((er) => [er.ejercicio_id, er.prescripcion_snapshot.nombre]), [["B", "B"], ["A", "A"]]);
  assert.equal(JSON.stringify(invertida.ejercicios_realizados[0].prescripcion_snapshot), JSON.stringify(snapB));
  assert.equal(JSON.stringify(invertida.ejercicios_realizados[1].prescripcion_snapshot), JSON.stringify(snapA));
  assert.deepEqual(invertida.ejercicios_realizados.map((er) => er.series[0].peso_kg), [22, 11], "las series editadas quedan con su ejercicio");
  /* Un ejercicio quitado: el que queda conserva SU snapshot (no el de la posición 0). */
  const soloB = clonar(P.conservarVinculoPlan(original, base([{ ejercicio_id: "B", series: [{ peso_kg: 2, reps: 2 }] }])));
  assert.equal(JSON.stringify(soloB.ejercicios_realizados[0].prescripcion_snapshot), JSON.stringify(snapB));
  /* Un snapshot cruzado en la editada se reemplaza por el original de ESE ejercicio. */
  const cruzada = clonar(P.conservarVinculoPlan(original, base([{ ejercicio_id: "A", series: [], prescripcion_snapshot: snapB }])));
  assert.equal(JSON.stringify(cruzada.ejercicios_realizados[0].prescripcion_snapshot), JSON.stringify(snapA));
  /* Un ejercicio sin snapshot en la original no recibe ninguno. */
  const ajeno = clonar(P.conservarVinculoPlan(original, base([{ ejercicio_id: "C", series: [] }])));
  assert.ok(!("prescripcion_snapshot" in ajeno.ejercicios_realizados[0]));
  assert.equal(invertida.plan_id, "plan-1");
});

test("editar una sesión anterior a E5 NO le agrega plan_id ni snapshot", () => {
  const e = entorno();
  const vieja = e.leer(CLAVE).sesiones_entrenamiento.find((s) => s.dia_rutina_id === "D1");
  const editada = clonar(vieja);
  editada.notas = "x";
  const r = clonar(e.GYMAPP.planes.conservarVinculoPlan(vieja, editada));
  assert.ok(!("plan_id" in r));
  assert.ok(r.ejercicios_realizados.every((er) => !("prescripcion_snapshot" in er)));
  assert.equal(JSON.stringify(r), JSON.stringify(editada));
});

/* --- Compatibilidad (17-20) --- */

test("17-20. sesiones viejas sin plan_id/snapshot: válidas, historial y Progreso iguales que antes", () => {
  const base = datos();
  const e = entorno(base);
  const d = e.GYMAPP.storage.getData();
  assert.ok(d.sesiones_entrenamiento.every((s) => !("plan_id" in s)));
  assert.equal(e.GYMAPP.storage.validarDatosV3(d), null, "17-18");
  const htmlAntes = e.GYMAPP.entrenamiento.renderHistorial(d);
  const P = e.GYMAPP.progreso;
  const opcionesAntes = clonar(P.construirOpcionesBloquesHistoricos(d));
  const estadoAntes = clonar(P.calcularEstadoPlan(P.construirInputEstadoPlan(d, HOY)));
  /* Agregar una sesión E5 no cambia cómo se ven las viejas. */
  guardarNueva(e, sesionGym({ fecha: "2026-11-08T15:00:00.000Z" }));
  const d2 = e.GYMAPP.storage.getData();
  assert.match(htmlAntes, /TRACCIÓN · /, "19");
  const htmlDespues = e.GYMAPP.entrenamiento.renderHistorial(d2);
  assert.equal(htmlDespues.replace(/<div class="historial-item" data-sesion-id="nueva"[\s\S]*?<\/div>\s*<\/div>/, ""), htmlAntes.replace(/<div class="historial-item" data-sesion-id="nueva"[\s\S]*?<\/div>\s*<\/div>/, ""));
  assert.deepEqual(clonar(P.construirOpcionesBloquesHistoricos(d2)), opcionesAntes, "20. selector histórico igual");
  assert.ok(P.construirOpcionesEjerciciosDeBloque(d2, "D1").length > 0, "20. Progreso con sesiones E5 no rompe");
  const estadoDespues = clonar(P.calcularEstadoPlan(P.construirInputEstadoPlan(d2, HOY)));
  assert.equal(typeof estadoDespues.estado, typeof estadoAntes.estado);
});

/* --- Import / export (21-25) --- */

function importar(objeto) {
  const e = entorno(aE3(datasetHistoricos()));
  e.cargar("js/backupImport.js");
  return { e, r: e.GYMAPP.backupImport.prepararImportacionBackup(JSON.stringify(objeto)) };
}

test("21-22. export (el blob) e import schema 3 preservan plan_id y snapshots", () => {
  const e = entorno();
  guardarNueva(e, sesionGym());
  const exportado = e.leer(CLAVE);   // exportarBackup() serializa getData() tal cual
  const s = exportado.sesiones_entrenamiento.find((x) => x.id === "nueva");
  assert.ok(s.plan_id && s.ejercicios_realizados[0].prescripcion_snapshot, "21");
  const { r } = importar(exportado);
  assert.equal(r.ok, true, r.error);
  assert.equal(JSON.stringify(r.datos), JSON.stringify(exportado), "22. idéntico");
});

test("23. import schema 3 anterior a E5 sigue válido; schema 2 también", () => {
  assert.equal(importar(aE3(datasetHistoricos({ legacy: true }))).r.ok, true);
  assert.equal(importar(datasetHistoricos({ legacy: true })).r.ok, true);
});

test("24. snapshot o plan_id malformados → rechazo sin escribir", () => {
  const e = entorno();
  guardarNueva(e, sesionGym());
  const base = e.leer(CLAVE);
  const variantes = [
    (s) => { s.plan_id = ""; },
    (s) => { s.plan_id = 42; },
    (s) => { s.ejercicios_realizados[0].prescripcion_snapshot = null; },
    (s) => { s.ejercicios_realizados[0].prescripcion_snapshot = "4x8"; },
    (s) => { delete s.ejercicios_realizados[0].prescripcion_snapshot.pausa; },
    (s) => { s.ejercicios_realizados[0].prescripcion_snapshot.comentarios = "extra"; },
    (s) => { s.ejercicios_realizados[0].prescripcion_snapshot.nombre = 5; },
    (s) => { s.ejercicios_realizados[0].prescripcion_snapshot.series_objetivo = { x: 1 }; }
  ];
  variantes.forEach((romper, i) => {
    const copia = clonar(base);
    romper(copia.sesiones_entrenamiento.find((x) => x.id === "nueva"));
    const { e: ei, r } = importar(copia);
    assert.equal(r.ok, false, "variante " + i);
    assert.match(r.error, /sesiones de entrenamiento con un formato inválido/, "variante " + i);
    assert.deepEqual(ei.localStorage._escrituras, [], "variante " + i);
  });
  const S = e.GYMAPP.storage;
  assert.equal(S.validarSnapshotPrescripcion({ nombre: null, grupo_muscular: null, series_objetivo: null, reps_objetivo: null, rir_objetivo: "2-3", rpe_objetivo: 8, peso_objetivo: 60, pausa: "90s" }), null, "valores válidos");
});

test("25. schema > 3 sigue rechazado", () => {
  const r = importar(Object.assign(datos(), { schema_version: 4 })).r;
  assert.equal(r.ok, false);
  assert.match(r.error, /versión más nueva/);
});

/* --- Resolución (26-29) --- */

test("26-29. resolución por sesión: snapshot → plan_id → IDs → legacy → null", () => {
  const e = entorno();
  guardarNueva(e, sesionGym());
  const d = clonar(e.GYMAPP.storage.getData());
  const R = e.GYMAPP.rutinasHistoricas;
  const nueva = d.sesiones_entrenamiento.find((s) => s.id === "nueva");
  activoDe(d).dias[0].ejercicios[0].nombre = "RENOMBRADO EN EL PLAN";
  assert.equal(R.resolverEjercicioDeSesion(d, nueva, nueva.ejercicios_realizados[0]).nombre, "PRESS BANCA C/BARRA", "26. snapshot primero");
  const sinSnap = clonar(nueva);
  delete sinSnap.ejercicios_realizados[0].prescripcion_snapshot;
  sinSnap.plan_id = "plan-hist-mu4c87ep730qj1";
  sinSnap.ejercicios_realizados[0].ejercicio_id = "mu4c87epsr80xw";
  assert.equal(R.resolverEjercicioDeSesion(d, sinSnap, sinSnap.ejercicios_realizados[0]).prescripcion.reps_objetivo, "6-8", "27. plan de la sesión");
  const vieja = { dia_rutina_id: "D1", ejercicios_realizados: [{ ejercicio_id: "D1-e1" }] };
  assert.equal(R.resolverEjercicioDeSesion(d, vieja, vieja.ejercicios_realizados[0]).nombre, "RENOMBRADO EN EL PLAN", "28. resolución actual");
  delete e.GYMAPP.planLegacy;
  const sinPlanLegacy = clonar(d);
  sinPlanLegacy.rutina.planes = sinPlanLegacy.rutina.planes.filter((p) => p.plan_id !== "plan-hist-mu4c87ep730qj1");
  assert.equal(R.resolverEjercicioDeSesion(sinPlanLegacy, {}, { ejercicio_id: "mu4c87epsr80xw" }), null, "sin plan ni dataset: null");
  const conLegacy = entorno(aE3(datasetHistoricos()));
  assert.equal(conLegacy.GYMAPP.rutinasHistoricas.resolverEjercicioDeSesion(conLegacy.GYMAPP.storage.getData(), {}, { ejercicio_id: "mu4c87epsr80xw" }).nombre, "PRESS BANCA C/BARRA", "29. fallback legacy");
  /* Día de la sesión: el del plan de la sesión. */
  assert.equal(R.resolverNombreDiaDeSesion(d, nueva), "EMPUJE");
  assert.equal(R.resolverNombreDiaDeSesion(d, { dia_rutina_id: "mu4c87ep2snsau" }), "TRACCIÓN");
});

/* --- Sync --- */

test("SYNC: una sesión E5 sube como una revisión normal (sync.js sin cambios)", async () => {
  const e = crearEntorno({ ahora: HOY + "T12:00:00" });
  e.login("uid-A");
  const d = datos();
  e.escribir(CLAVE, d);
  e.nube.fila = { data: clonar(d), schema_version: 3, revision: 4, updated_at: "2026-10-19T10:00:00Z" };
  e.escribir(META, { user_id: "uid-A", last_known_revision: 4, last_sync_at: "x" });
  guardarNueva(e, sesionGym());
  const c = crearContenedor();
  e.GYMAPP.sync.bindEventosSincronizacion(c);
  c.click("sincronizar-ahora"); await esperar();
  assert.equal(e.nube.fila.revision, 5);
  const s = e.nube.fila.data.sesiones_entrenamiento.find((x) => x.id === "nueva");
  assert.equal(s.ejercicios_realizados[0].prescripcion_snapshot.reps_objetivo, "6-8");
  /* Un payload remoto con snapshot malformado se rechaza al restaurar. */
  const roto = clonar(e.nube.fila.data);
  roto.sesiones_entrenamiento.find((x) => x.id === "nueva").plan_id = "";
  assert.ok(e.GYMAPP.storage.validarDatosV3(roto));
});
