/* E2: migración schema 2 -> 3, copia previa, bloqueo seguro y estrategia A
   de SYNC-03. Correr con: node --test tests/*.test.js */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { crearEntorno, crearContenedor, esperar, clonar, aV3 } = require("./entorno");

const CLAVE = "gymNutritionTracker";
const PRE = "gymNutritionTracker_preMigracionV3";
const META = "gymNutritionTracker_syncMeta";
const MENSAJE = "No se pudo actualizar el formato de tus datos. Tus datos anteriores se conservaron.";

/* Dato schema 2 realista: dos días, prescripción de schema 2, sesiones con
   series, una sesión de un día que ya no está en la rutina y fútbol. */
function v2(extra) {
  return Object.assign({
    schema_version: 2,
    usuario: { nombre: "Nico", actividades: [{ tipo: "gimnasio", meta_semanal: 5 }, { tipo: "futbol", meta_semanal: 2 }] },
    rutina: { dias: [
      { id: "dA", nombre: "EMPUJE", ejercicios: [
        { id: "eA1", nombre: "Press banca", grupo_muscular: "Pecho", series_objetivo: 4, reps_objetivo: "8-10" },
        { id: "eA2", nombre: "Press militar", grupo_muscular: "Hombros", series_objetivo: 3, reps_objetivo: "10" }
      ] },
      { id: "dB", nombre: "TRACCIÓN", ejercicios: [
        { id: "eB1", nombre: "Remo", grupo_muscular: "Espalda", series_objetivo: 4, reps_objetivo: "10-12" }
      ] }
    ] },
    sesiones_entrenamiento: [
      { id: "s1", fecha: "2026-10-01T10:00:00", tipo: "gimnasio", dia_rutina_id: "dA", duracion_min: 60, rpe: 7, notas: "",
        ejercicios_realizados: [{ ejercicio_id: "eA1", series: [{ peso: 60, reps: 10 }, { peso: 62.5, reps: 8 }] }], futbol_detalle: null },
      { id: "s2", fecha: "2026-09-01T10:00:00", tipo: "gimnasio", dia_rutina_id: "viejo", duracion_min: 50, rpe: 8, notas: "x",
        ejercicios_realizados: [{ ejercicio_id: "viejo-e", series: [{ peso: 20, reps: 12 }] }], futbol_detalle: null },
      { id: "s3", fecha: "2026-10-02T20:00:00", tipo: "futbol", dia_rutina_id: null, duracion_min: 90, rpe: 6, notas: "",
        ejercicios_realizados: [], futbol_detalle: { posicion: "medio" } }
    ],
    registros_nutricion: [{ fecha: "2026-10-01", comidas: [] }],
    base_alimentos: [{ nombre: "Arroz" }],
    medidas_corporales: [{ fecha: "2026-10-01", peso: 80 }]
  }, extra || {});
}

function cargarV2(datos, opciones) {
  const e = crearEntorno(Object.assign({ sinSync: true }, opciones || {}));
  const raw = JSON.stringify(datos);
  e.localStorage._mapa.set(CLAVE, raw);
  return { e, raw };
}

/* --- Migración --- */

test("2 -> 3: estructura de planes, plan_id determinístico, IDs/nombres/objetivos conservados", () => {
  const { e } = cargarV2(v2());
  const d = clonar(e.GYMAPP.storage.getData());
  assert.equal(d.schema_version, 3);
  assert.ok(!("dias" in d.rutina), "sin espejo rutina.dias");
  assert.equal(d.rutina.plan_activo_id, "plan-mig-dA");
  assert.equal(d.rutina.planes.length, 1);
  const plan = d.rutina.planes[0];
  assert.deepEqual(Object.keys(plan), ["plan_id", "nombre", "fecha_inicio", "fecha_fin", "origen", "version_de", "creado_en", "archivado_en", "fuente", "dias"]);
  assert.deepEqual({ ...plan, dias: undefined }, { plan_id: "plan-mig-dA", nombre: null, fecha_inicio: null, fecha_fin: null, origen: "migracion",
    version_de: null, creado_en: null, archivado_en: null, fuente: null, dias: undefined });
  assert.deepEqual(plan.dias.map((x) => [x.id, x.nombre, x.orden]), [["dA", "EMPUJE", 1], ["dB", "TRACCIÓN", 2]]);
  assert.deepEqual(plan.dias[0].ejercicios[1], { id: "eA2", nombre: "Press militar", grupo_muscular: "Hombros", series_objetivo: 3, reps_objetivo: "10",
    rir_objetivo: null, rpe_objetivo: null, peso_objetivo: null, pausa: null, comentarios: null, raw: null, eliminado: false, orden: 2 });
  assert.equal(e.GYMAPP.storage.validarDatosV3(d), null);
  assert.equal(e.leer(CLAVE).schema_version, 3, "persistido");
});

test("2 -> 3: sesiones y el resto de los datos quedan idénticos (byte a byte)", () => {
  const original = v2();
  const { e } = cargarV2(original);
  e.GYMAPP.storage.getData();
  const g = e.leer(CLAVE);
  ["sesiones_entrenamiento", "registros_nutricion", "base_alimentos", "medidas_corporales", "usuario"].forEach((k) => {
    assert.equal(JSON.stringify(g[k]), JSON.stringify(original[k]), k);
  });
  assert.ok(g.sesiones_entrenamiento.every((s) => !("plan_id" in s)), "las sesiones no reciben plan_id");
});

test("rutina vacía → plan-mig-vacio, y un usuario nuevo tiene exactamente la misma rutina", () => {
  const { e } = cargarV2(v2({ rutina: { dias: [] } }));
  const migrado = clonar(e.GYMAPP.storage.getData());
  assert.equal(migrado.rutina.plan_activo_id, "plan-mig-vacio");
  assert.deepEqual(migrado.rutina.planes[0].dias, []);
  const nuevo = crearEntorno({ sinSync: true }).GYMAPP.storage.getDefaultData();
  assert.equal(JSON.stringify(nuevo.rutina), JSON.stringify(migrado.rutina));
  assert.equal(JSON.stringify(nuevo), JSON.stringify(crearEntorno({ sinSync: true }).GYMAPP.storage.getDefaultData()), "default estable");
});

test("rutina ausente o sin dias (schema 0/1) → plan-mig-vacio", () => {
  [{ usuario: { nombre: "N" } }, { usuario: { nombre: "N" }, rutina: {} }].forEach((viejo) => {
    const m = aV3(viejo);
    assert.equal(m.schema_version, 3);
    assert.equal(m.rutina.plan_activo_id, "plan-mig-vacio");
  });
});

test("determinista multidispositivo: dos entornos independientes producen el mismo JSON", () => {
  const a = cargarV2(v2(), { ahora: "2026-10-19T08:00:00Z" });
  const b = cargarV2(v2(), { ahora: "2027-03-01T22:30:00Z" });
  a.e.GYMAPP.storage.getData();
  b.e.GYMAPP.storage.getData();
  assert.equal(a.e.localStorage.getItem(CLAVE), b.e.localStorage.getItem(CLAVE));
  assert.equal(a.e.localStorage.getItem(CLAVE), JSON.stringify(aV3(v2())));
});

test("idempotente: un schema 3 se carga sin migrar ni escribir nada", () => {
  const { e } = cargarV2(v2());
  e.GYMAPP.storage.getData();
  const guardado = e.localStorage.getItem(CLAVE);
  const otro = crearEntorno({ sinSync: true });
  otro.localStorage._mapa.set(CLAVE, guardado);
  const d = otro.GYMAPP.storage.getData();
  assert.equal(otro.localStorage._escrituras.length, 0);
  assert.equal(otro.localStorage.getItem(PRE), null, "no crea copia previa para schema 3");
  assert.equal(JSON.stringify(Object.assign({}, d)), guardado);
  assert.equal(JSON.stringify(aV3(JSON.parse(guardado))), guardado, "migrarDatos sobre schema 3 no cambia nada");
});

/* --- Copia previa y fallas --- */

test("preMigracionV3: guarda el texto crudo schema 2 exacto, antes del schema 3", () => {
  const { e, raw } = cargarV2(v2());
  e.GYMAPP.storage.getData();
  const pre = e.leer(PRE);
  assert.equal(pre.data_raw, raw);
  assert.equal(pre.version_origen, 2);
  assert.ok(pre.fecha);
  const ops = e.localStorage._operaciones.filter((o) => o[0] === "set").map((o) => o[1]);
  assert.deepEqual(ops, [PRE, CLAVE], "primero la copia, después los datos");
});

function verificarBloqueo(e, raw) {
  assert.equal(e.localStorage.getItem(CLAVE), raw, "gymNutritionTracker intacto (schema 2)");
  assert.equal(e.GYMAPP.storage.obtenerBloqueoMigracion().mensaje, MENSAJE);
  assert.equal(e.GYMAPP.storage.save(aV3(v2()), { alertaAutomatica: false }), false, "save bloqueado");
  const r = e.GYMAPP.storage.updateData((d) => { d.usuario = { nombre: "otro" }; }, { alertaAutomatica: false });
  assert.equal(r.guardado, false);
  assert.equal(e.localStorage.getItem(CLAVE), raw);
}

test("validación fallida: no persiste nada, ni copia previa, y bloquea", () => {
  const { e, raw } = cargarV2(v2({ rutina: { dias: [{ nombre: "Sin id", ejercicios: [] }] } }));
  e.GYMAPP.storage.getData();
  assert.equal(e.localStorage.getItem(PRE), null);
  assert.deepEqual(e.localStorage._escrituras, []);
  verificarBloqueo(e, raw);
});

test("falla la copia preMigracionV3: no persiste el schema 3 y bloquea", () => {
  const { e, raw } = cargarV2(v2());
  e.localStorage._fallas.add(PRE);
  e.GYMAPP.storage.getData();
  assert.equal(e.localStorage.getItem(PRE), null);
  verificarBloqueo(e, raw);
});

test("falla el guardado del schema 3: el schema 2 queda intacto, la copia previa queda y bloquea", () => {
  const { e, raw } = cargarV2(v2());
  e.localStorage._fallas.add(CLAVE);
  e.GYMAPP.storage.getData();
  assert.equal(e.leer(PRE).data_raw, raw);
  e.localStorage._fallas.delete(CLAVE);
  verificarBloqueo(e, raw);
});

test("bloqueo: la app muestra el aviso y no arranca con datos parciales", () => {
  const { e } = cargarV2(v2({ rutina: { dias: [{ nombre: "Sin id", ejercicios: [] }] } }));
  const root = { innerHTML: "" };
  e.ctx.document.getElementById = () => root;
  e.ctx.document.addEventListener = () => {};
  e.cargar("js/app.js");
  e.GYMAPP.app.iniciar();
  assert.match(root.innerHTML, /No se pudo actualizar el formato de tus datos\. Tus datos anteriores se conservaron\./);
  assert.doesNotMatch(root.innerHTML, /bottom-nav|onboarding/i);
});

test("recargar después de una falla transitoria reintenta y migra bien", () => {
  const { e, raw } = cargarV2(v2());
  e.localStorage._fallas.add(PRE);
  e.GYMAPP.storage.getData();
  const recarga = crearEntorno({ sinSync: true });
  recarga.localStorage._mapa.set(CLAVE, e.localStorage.getItem(CLAVE));
  assert.equal(recarga.GYMAPP.storage.getData().schema_version, 3);
  assert.equal(recarga.leer(PRE).data_raw, raw);
});

/* --- Históricos y PROG-04 tras migrar --- */

test("después de migrar, los 5 bloques y 54 ejercicios legacy siguen resolviendo su nombre", () => {
  const ids = [...new Set(fs.readFileSync(path.join(__dirname, "..", "js", "planLegacy.js"), "utf8").match(/"mu4c87[a-z0-9]+"/g).map((x) => x.slice(1, -1)))];
  assert.equal(ids.length, 59);
  const { e } = cargarV2(v2());
  const d = e.GYMAPP.storage.getData();
  const R = e.GYMAPP.rutinasHistoricas;
  const bloques = ids.filter((id) => R.resolverNombreBloqueHistorico(d, id));
  const ejercicios = ids.filter((id) => R.nombreEjercicioConocido(d, id));
  assert.equal(bloques.length, 5);
  assert.equal(ejercicios.length, 54);
  assert.equal(R.resolverNombreDiaRutina(d, "dA"), "EMPUJE", "bloque activo por su nombre actual");
  assert.equal(R.resolverNombreEjercicioHistorico(d, "eB1"), "Remo");
});

/* --- SYNC-03 estrategia A --- */

function prepararSync(local, remoto, revisionRemota, revisionConocida) {
  const e = crearEntorno();
  e.login("uid-A");
  e.escribir(CLAVE, local);
  e.nube.fila = { data: clonar(remoto), schema_version: remoto.schema_version, revision: revisionRemota, updated_at: "2026-10-18T10:00:00Z" };
  e.escribir(META, { user_id: "uid-A", last_known_revision: revisionConocida, last_sync_at: "2026-10-18T10:00:00Z" });
  const c = crearContenedor();
  e.GYMAPP.sync.bindEventosSincronizacion(c);
  return { e, c };
}
const rpcs = (e) => e.nube.llamadas.filter((l) => l.tipo === "rpc");

test("estrategia A: revisión distinta + datos iguales → adopta la baseline, 0 RPC, mensaje", async () => {
  const { e, c } = prepararSync(aV3(v2()), aV3(v2()), 8, 5);
  const antes = e.localStorage.getItem(CLAVE);
  c.click("sincronizar-ahora"); await esperar();
  assert.equal(rpcs(e).length, 0);
  assert.equal(e.leer(META).last_known_revision, 8);
  assert.equal(e.leer(META).user_id, "uid-A");
  assert.equal(e.localStorage.getItem(CLAVE), antes, "datos locales intactos");
  assert.equal(e.nube.fila.revision, 8);
  assert.equal(c.mensaje().textContent, "Los datos ya coinciden con la nube. Se actualizó la referencia de sincronización. Revisión: 8.");
});

test("estrategia A: la nube todavía en schema 2 con el mismo contenido también coincide (se normaliza antes)", async () => {
  const { e } = prepararSync(aV3(v2()), v2(), 4, 3);
  const r = await e.GYMAPP.sync.sincronizarAhora();
  assert.equal(r.estado, "baseline_actualizada");
  assert.equal(rpcs(e).length, 0);
  assert.equal(e.nube.fila.schema_version, 2, "no sube nada a la nube");
});

test("revisión distinta + datos distintos → conflicto revision_distinta (sin cambios)", async () => {
  const { e, c } = prepararSync(aV3(v2({ base_alimentos: [{ nombre: "local" }] })), aV3(v2()), 8, 5);
  c.click("sincronizar-ahora"); await esperar();
  assert.equal(rpcs(e).length, 0);
  assert.equal(e.leer(META).last_known_revision, 5);
  assert.match(c.panel(), /.+/);
  const r = await e.GYMAPP.sync.sincronizarAhora();
  assert.equal(r.estado, "conflicto");
  assert.equal(r.motivo, "revision_distinta");
});

test("misma revisión + datos distintos sigue subiendo con la RPC segura y p_schema_version 3", async () => {
  const { e } = prepararSync(aV3(v2({ base_alimentos: [{ nombre: "local" }] })), aV3(v2()), 5, 5);
  const r = await e.GYMAPP.sync.sincronizarAhora();
  assert.equal(r.estado, "actualizado");
  assert.equal(rpcs(e)[0].nombre, "actualizar_datos_usuario_seguro");
  assert.equal(rpcs(e)[0].params.p_schema_version, 3);
  assert.equal(rpcs(e)[0].params.p_expected_revision, 5);
});

test("nube en schema 4 (futuro) se rechaza sin tocar nada", async () => {
  const remoto = Object.assign(aV3(v2()), { schema_version: 4 });
  const { e } = prepararSync(aV3(v2()), remoto, 6, 5);
  const antes = e.localStorage.getItem(CLAVE);
  await assert.rejects(e.GYMAPP.sync.sincronizarAhora(), /versión más nueva/);
  assert.equal(rpcs(e).length, 0);
  assert.equal(e.localStorage.getItem(CLAVE), antes);
  assert.equal(e.leer(META).last_known_revision, 5);
});

test("restaurar desde la nube en schema 2 guarda schema 3 válido", async () => {
  const e = crearEntorno();
  e.login("uid-A");
  e.escribir(CLAVE, aV3(v2({ base_alimentos: [{ nombre: "local" }] })));
  e.nube.fila = { data: v2(), schema_version: 2, revision: 3, updated_at: "2026-10-18T10:00:00Z" };
  const c = crearContenedor();
  e.GYMAPP.sync.bindEventosSincronizacion(c);
  e.respuestas.confirm.push(true);
  c.click("recuperar-de-la-nube"); await esperar();
  const g = e.leer(CLAVE);
  assert.equal(g.schema_version, 3);
  assert.equal(e.GYMAPP.storage.validarDatosV3(g), null);
  assert.equal(JSON.stringify(g.sesiones_entrenamiento), JSON.stringify(v2().sesiones_entrenamiento));
});

test("nube schema 3 con rutina inválida se rechaza al restaurar", async () => {
  const e = crearEntorno();
  e.login("uid-A");
  e.escribir(CLAVE, aV3(v2()));
  const roto = aV3(v2());
  roto.rutina.plan_activo_id = "no-existe";
  e.nube.fila = { data: roto, schema_version: 3, revision: 3, updated_at: "2026-10-18T10:00:00Z" };
  const antes = e.localStorage.getItem(CLAVE);
  const c = crearContenedor();
  e.GYMAPP.sync.bindEventosSincronizacion(c);
  e.respuestas.confirm.push(true);
  c.click("recuperar-de-la-nube"); await esperar();
  assert.equal(e.localStorage.getItem(CLAVE), antes);
  assert.equal(c.mensaje().className, "mensaje error");
});
