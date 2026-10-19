/* E0: importación manual de backups endurecida (js/backupImport.js).
   Correr con: node --test tests/*.test.js */
const test = require("node:test");
const assert = require("node:assert/strict");
const { crearEntorno, clonar } = require("./entorno");

const CLAVE = "gymNutritionTracker";
const META = "gymNutritionTracker_syncMeta";
const PRE = "gymNutritionTracker_preImportBackup";

function locales() {
  return {
    schema_version: 2,
    usuario: { nombre: "Local", actividades: [{ tipo: "gimnasio", meta_semanal: 3 }] },
    rutina: { dias: [{ id: "L1", nombre: "Local A", ejercicios: [{ id: "L1-e1", nombre: "Sentadilla", grupo_muscular: "Piernas", series_objetivo: 3, reps_objetivo: "8" }] }] },
    sesiones_entrenamiento: [{ id: "ls1", fecha: "2026-10-10T18:00:00", tipo: "gimnasio", dia_rutina_id: "L1", duracion_min: 50, rpe: 7, notas: "", ejercicios_realizados: [{ ejercicio_id: "L1-e1", series: [{ peso_kg: 80, reps: 8 }] }], futbol_detalle: null }],
    registros_nutricion: [], base_alimentos: [], medidas_corporales: []
  };
}

/* Backup de versión `v` (0 = sin schema_version), con 2 sesiones. */
function backup(v) {
  const b = {
    usuario: { nombre: "Backup" },
    rutina: { dias: [{ id: "B1", nombre: "Backup A", ejercicios: [{ id: "B1-e1", nombre: "Press", grupo_muscular: "Pecho", series_objetivo: 4, reps_objetivo: "10" }] }] },
    sesiones_entrenamiento: [
      { id: "bs1", fecha: "2026-09-01T18:00:00", tipo: "gimnasio", dia_rutina_id: "B1", duracion_min: 60, rpe: 8, notas: "", ejercicios_realizados: [{ ejercicio_id: "B1-e1", series: [{ peso_kg: 50, reps: 10 }] }] },
      { id: "bs2", fecha: "2026-09-03T18:00:00", tipo: "gimnasio", dia_rutina_id: "B1", duracion_min: 60, rpe: 7, notas: "", ejercicios_realizados: [] }
    ],
    registros_nutricion: [], base_alimentos: [], medidas_corporales: []
  };
  if (v !== 0) b.schema_version = v;
  if (v >= 2) b.usuario.actividades = [{ tipo: "futbol", meta_semanal: 1 }];
  return b;
}

function entorno(conMeta) {
  const e = crearEntorno({ modulos: ["js/backupImport.js"] });
  e.escribir(CLAVE, locales());
  if (conMeta !== false) e.escribir(META, { user_id: "uid-A", last_known_revision: 7, last_sync_at: "2026-10-18T10:00:00Z" });
  return { e, B: e.GYMAPP.backupImport };
}

/* --- Preparación: nunca escribe --- */

function sinEscrituras(e, fn) {
  const antes = e.localStorage.getItem(CLAVE);
  const ops = e.localStorage._operaciones.length;
  const r = fn();
  assert.equal(e.localStorage._operaciones.length, ops, "preparar no escribe nada");
  assert.equal(e.localStorage.getItem(CLAVE), antes);
  return r;
}

/* 1 */
test("import schema 0 → migra en memoria a 3 y guarda", () => {
  const { e, B } = entorno();
  const p = sinEscrituras(e, () => B.prepararImportacionBackup(JSON.stringify(backup(0))));
  assert.equal(p.ok, true);
  assert.equal(p.versionOrigen, 0);
  assert.equal(p.versionDestino, 3);
  assert.equal(p.datos.schema_version, 3);
  assert.deepEqual(clonar(p.datos.usuario.actividades), [{ tipo: "gimnasio", meta_semanal: 5 }, { tipo: "futbol", meta_semanal: 2 }]);
  assert.equal(B.aplicarImportacionBackup(p, { nombreArchivo: "b0.json" }).ok, true);
  const g = e.leer(CLAVE);
  assert.equal(g.schema_version, 3);
  assert.deepEqual(g.sesiones_entrenamiento, backup(0).sesiones_entrenamiento, "sesiones intactas");
  assert.equal(g.rutina.plan_activo_id, "plan-mig-B1");
  assert.deepEqual(g.rutina.planes[0].dias.map((d) => d.id), ["B1"]);
});

/* 2 */
test("import schema 1 → migra a 3", () => {
  const { e, B } = entorno();
  const p = B.prepararImportacionBackup(JSON.stringify(backup(1)));
  assert.equal(p.ok, true);
  assert.equal(p.versionOrigen, 1);
  assert.equal(B.aplicarImportacionBackup(p).ok, true);
  assert.equal(e.leer(CLAVE).schema_version, 3);
  assert.equal(e.leer(CLAVE).usuario.actividades.length, 2);
});

/* 3 */
test("import schema 2 → migra a 3 sin corregir información existente", () => {
  const { e, B } = entorno();
  const b = backup(2);
  b.campo_extra = { conservar: true };
  const p = B.prepararImportacionBackup(JSON.stringify(b));
  assert.equal(p.ok, true);
  assert.equal(B.aplicarImportacionBackup(p).ok, true);
  const g = e.leer(CLAVE);
  assert.deepEqual(g.usuario.actividades, [{ tipo: "futbol", meta_semanal: 1 }], "no pisa actividades existentes");
  assert.deepEqual(g.campo_extra, { conservar: true });
  const ej = g.rutina.planes[0].dias[0].ejercicios[0];
  assert.deepEqual([ej.id, ej.nombre, ej.grupo_muscular, ej.series_objetivo, ej.reps_objetivo], ["B1-e1", "Press", "Pecho", 4, "10"]);
  assert.deepEqual(g.sesiones_entrenamiento, b.sesiones_entrenamiento);
});

test("defaults: solo se completan claves ausentes que las migraciones ya contemplan", () => {
  const { B } = entorno();
  const b = backup(2);
  const p = B.prepararImportacionBackup(JSON.stringify(b));
  assert.deepEqual(Object.keys(clonar(p.datos)).sort(), ["base_alimentos", "medidas_corporales", "registros_nutricion", "rutina", "schema_version", "sesiones_entrenamiento", "usuario"]);
});

/* 4 y 5 */
[4, 5, 99].forEach((v) => {
  test("import schema " + v + " (la app soporta 3) → rechazado sin tocar storage", () => {
    const { e, B } = entorno();
    const metaAntes = e.localStorage.getItem(META);
    const p = sinEscrituras(e, () => B.prepararImportacionBackup(JSON.stringify(backup(v))));
    assert.equal(p.ok, false);
    assert.match(p.error, /versión más nueva de la app/);
    assert.equal(e.localStorage.getItem(META), metaAntes);
    assert.equal(e.localStorage.getItem(PRE), null);
    assert.equal(B.aplicarImportacionBackup(p).ok, false, "aplicar un rechazo no hace nada");
    assert.equal(e.localStorage._operaciones.length, 0);
  });
});

/* 6 y 7 */
test("JSON inválido y estructuras inválidas → rechazo sin escrituras", () => {
  const { e, B } = entorno();
  const casos = [
    ["{no es json", /no es un JSON válido/],
    ["[1,2,3]", /formato esperado/],
    ["null", /formato esperado/],
    [JSON.stringify((() => { const b = backup(2); delete b.medidas_corporales; return b; })()), /formato esperado/],
    [JSON.stringify(Object.assign(backup(2), { schema_version: "2" })), /versión de datos inválida/],
    [JSON.stringify(Object.assign(backup(2), { schema_version: 1.5 })), /versión de datos inválida/],
    [JSON.stringify(Object.assign(backup(2), { schema_version: -1 })), /versión de datos inválida/],
    [JSON.stringify(Object.assign(backup(2), { rutina: { dias: {} } })), /rutina del backup/],
    [JSON.stringify(Object.assign(backup(2), { usuario: "x" })), /usuario del backup/],
    [JSON.stringify(Object.assign(backup(2), { sesiones_entrenamiento: {} })), /formato esperado/],
    [JSON.stringify(Object.assign(backup(2), { rutina: { dias: [{ nombre: "sin id", ejercicios: [] }] } })), /identificador válido/],
    [JSON.stringify(Object.assign(backup(2), { rutina: { dias: [{ id: "d", ejercicios: [{ nombre: "sin id" }] }] } })), /identificador válido/],
    [JSON.stringify(Object.assign(backup(2), { sesiones_entrenamiento: [{ id: "s", tipo: "gimnasio" }] })), /sesiones de entrenamiento/],
    [JSON.stringify(Object.assign(backup(2), { sesiones_entrenamiento: [{ id: "s", fecha: "2026-01-01", ejercicios_realizados: {} }] })), /sesiones de entrenamiento/]
  ];
  casos.forEach(([texto, mensaje]) => {
    const p = sinEscrituras(e, () => B.prepararImportacionBackup(texto));
    assert.equal(p.ok, false, texto.slice(0, 40));
    assert.match(p.error, mensaje, texto.slice(0, 40));
  });
});

test("backups históricos legítimos (sesiones sin ejercicios_realizados, fútbol, rutina vacía) se aceptan", () => {
  const { B } = entorno();
  const b = backup(0);
  b.rutina.dias = [];
  b.sesiones_entrenamiento.push({ id: "f1", fecha: "2026-09-05T20:00:00", tipo: "futbol", duracion_min: 90, rpe: 8, notas: "", futbol_detalle: { tipo: "partido" } });
  const p = B.prepararImportacionBackup(JSON.stringify(b));
  assert.equal(p.ok, true, p.error);
});

/* 8 */
test("migración fallida → no modifica datos", () => {
  const { e, B } = entorno();
  e.GYMAPP.storage.migrarDatos = () => { throw new Error("boom"); };
  const p = sinEscrituras(e, () => B.prepararImportacionBackup(JSON.stringify(backup(1))));
  assert.equal(p.ok, false);
  assert.match(p.error, /No se pudo actualizar el formato del backup/);
});

/* 9 y test nuevo de ORDEN */
test("import exitoso: backup previo → borrar syncMeta → recién después escribir gymNutritionTracker", () => {
  const { e, B } = entorno(true);
  const anteriorRaw = e.localStorage.getItem(CLAVE);
  assert.ok(e.localStorage.getItem(META) !== null, "syncMeta existía");
  const p = B.prepararImportacionBackup(JSON.stringify(backup(2)));
  const r = B.aplicarImportacionBackup(p, { nombreArchivo: "x.json" });
  assert.equal(r.ok, true);
  assert.deepEqual(clonar(e.localStorage._operaciones), [["set", PRE], ["remove", META], ["set", CLAVE]]);
  const pre = e.leer(PRE);
  assert.equal(pre.data_raw, anteriorRaw, "copia exacta del texto anterior");
  assert.equal(pre.archivo, "x.json");
  assert.equal(pre.version_backup_importado, 2);
  assert.equal(e.localStorage.getItem(META), null);
  assert.equal(e.leer(CLAVE).usuario.nombre, "Backup");
  assert.ok(e.localStorage.getItem("gymNutritionTracker_preRestoreBackup") === null, "no usa la clave de SYNC-02");
});

test("sin datos locales previos: la copia previa guarda data_raw = null", () => {
  const e = crearEntorno({ modulos: ["js/backupImport.js"] });
  const B = e.GYMAPP.backupImport;
  assert.equal(B.aplicarImportacionBackup(B.prepararImportacionBackup(JSON.stringify(backup(2)))).ok, true);
  assert.equal(e.leer(PRE).data_raw, null);
});

/* 10 */
test("falla al crear el backup previo → abortar sin tocar syncMeta ni datos", () => {
  const { e, B } = entorno(true);
  const antes = e.localStorage.getItem(CLAVE);
  const metaAntes = e.localStorage.getItem(META);
  e.localStorage._fallas.add(PRE);
  const r = B.aplicarImportacionBackup(B.prepararImportacionBackup(JSON.stringify(backup(2))));
  assert.equal(r.ok, false);
  assert.match(r.error, /copia de seguridad/);
  assert.equal(e.localStorage.getItem(CLAVE), antes);
  assert.equal(e.localStorage.getItem(META), metaAntes);
  assert.deepEqual(clonar(e.localStorage._operaciones), []);
});

/* Test nuevo: falla removeItem(syncMeta) */
test("si falla borrar syncMeta: aborta, datos byte a byte iguales, la copia previa puede quedar", () => {
  const { e, B } = entorno(true);
  const antes = e.localStorage.getItem(CLAVE);
  e.localStorage._fallasRemove.add(META);
  const r = B.aplicarImportacionBackup(B.prepararImportacionBackup(JSON.stringify(backup(2))));
  assert.equal(r.ok, false);
  assert.match(r.error, /No se modificaron tus datos/);
  assert.equal(e.localStorage.getItem(CLAVE), antes);
  assert.ok(e.localStorage.getItem(PRE) !== null, "la copia previa quedó creada");
  assert.ok(e.localStorage.getItem(META) !== null);
  assert.ok(!e.localStorage._operaciones.some((o) => o[1] === CLAVE), "nunca se escribió gymNutritionTracker");
});

/* 11 y test nuevo: falla save después de borrar syncMeta */
test("si falla storage.save después de borrar syncMeta: datos previos intactos y syncMeta ausente (estado seguro)", () => {
  const { e, B } = entorno(true);
  const antes = e.localStorage.getItem(CLAVE);
  e.localStorage._fallas.add(CLAVE);
  const r = B.aplicarImportacionBackup(B.prepararImportacionBackup(JSON.stringify(backup(2))));
  assert.equal(r.ok, false);
  assert.match(r.error, /Tus datos anteriores se conservan intactos/);
  assert.equal(e.localStorage.getItem(CLAVE), antes);
  assert.equal(e.localStorage.getItem(META), null, "baseline perdida a propósito, no se restaura");
  assert.equal(e.registro.alertas.length, 0, "sin alerta genérica duplicada de storage");
});

test("3.E: tras importar, la siguiente sincronización compara y muestra conflicto en vez de subir", async () => {
  const { e, B } = entorno(true);
  e.login("uid-A");
  e.nube.fila = { data: locales(), schema_version: 2, revision: 7, updated_at: "2026-10-18T10:00:00Z" };
  assert.equal(B.aplicarImportacionBackup(B.prepararImportacionBackup(JSON.stringify(backup(2)))).ok, true);
  const r = await e.GYMAPP.sync.sincronizarAhora();
  assert.equal(r.estado, "conflicto");
  assert.equal(r.motivo, "sin_baseline");
  assert.equal(e.nube.llamadas.filter((l) => l.tipo === "rpc").length, 0, "no subió nada");
  assert.equal(e.nube.fila.revision, 7);
});

test("schema_version de la app es 3", () => {
  const { e } = entorno();
  assert.equal(e.GYMAPP.storage.getDefaultData().schema_version, 3);
});

test("import schema 3 → valida y guarda tal cual (sin volver a migrar)", () => {
  const { e, B } = entorno();
  const b3 = B.prepararImportacionBackup(JSON.stringify(backup(2))).datos;
  b3.usuario.nombre = "Backup v3";
  const p = B.prepararImportacionBackup(JSON.stringify(b3));
  assert.equal(p.ok, true, p.error);
  assert.equal(p.versionOrigen, 3);
  assert.deepEqual(clonar(p.datos), clonar(b3), "idéntico, sin cambios");
  assert.equal(B.aplicarImportacionBackup(p).ok, true);
  assert.equal(e.leer(CLAVE).usuario.nombre, "Backup v3");
});

test("import schema 3 inválido (sin plan activo, plan_id repetido, día sin orden) → rechazado", () => {
  const { e, B } = entorno();
  const base = B.prepararImportacionBackup(JSON.stringify(backup(2))).datos;
  const casos = [
    (d) => { d.rutina.plan_activo_id = "no-existe"; },
    (d) => { d.rutina.planes.push(clonar(d.rutina.planes[0])); },
    (d) => { delete d.rutina.planes[0].dias[0].orden; },
    (d) => { d.rutina.planes = {}; },
    (d) => { d.rutina = { dias: [] }; }
  ];
  casos.forEach((romper) => {
    const d = clonar(base);
    romper(d);
    const p = sinEscrituras(e, () => B.prepararImportacionBackup(JSON.stringify(d)));
    assert.equal(p.ok, false, String(romper));
  });
});
