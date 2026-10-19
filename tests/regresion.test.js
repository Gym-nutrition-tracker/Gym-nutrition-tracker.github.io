/* Regresión de storage, AUTH, SYNC-01 y SYNC-02. Correr con:
     node --test tests/*.test.js
   Para comparar contra otra versión de sync.js:
     SYNC_JS=/ruta/a/sync.js node --test tests/regresion.test.js */
const test = require("node:test");
const assert = require("node:assert/strict");
const { crearEntorno, crearContenedor, esperar, datosEjemplo, clonar } = require("./entorno");

const CLAVE = "gymNutritionTracker";
const BACKUP = "gymNutritionTracker_preRestoreBackup";
const rpcs = (e) => e.nube.llamadas.filter((l) => l.tipo === "rpc");

/* --- storage --- */

test("storage: sin datos devuelve el estado por defecto (schema 3)", () => {
  const e = crearEntorno({ sinSync: true });
  const d = e.GYMAPP.storage.getData();
  assert.equal(d.schema_version, 3);
  assert.equal(d.usuario, null);
  assert.deepEqual(clonar(d.rutina), { plan_activo_id: "plan-mig-vacio", planes: [{
    plan_id: "plan-mig-vacio", nombre: null, fecha_inicio: null, fecha_fin: null, origen: "migracion",
    version_de: null, creado_en: null, archivado_en: null, fuente: null, dias: [] }] });
});

test("storage: migra 0 -> 3 agregando actividades y persiste", () => {
  const e = crearEntorno({ sinSync: true });
  e.escribir(CLAVE, { usuario: { nombre: "N" }, rutina: { dias: [] } });
  const d = e.GYMAPP.storage.getData();
  assert.equal(d.schema_version, 3);
  assert.deepEqual(clonar(d.usuario.actividades), [{ tipo: "gimnasio", meta_semanal: 5 }, { tipo: "futbol", meta_semanal: 2 }]);
  assert.equal(e.leer(CLAVE).schema_version, 3);
});

test("storage: schema futuro bloquea save()", () => {
  const e = crearEntorno({ sinSync: true });
  e.escribir(CLAVE, datosEjemplo({ schema_version: 99 }));
  e.GYMAPP.storage.getData();
  assert.equal(e.GYMAPP.storage.save(datosEjemplo(), { alertaAutomatica: false }), false);
  assert.equal(e.leer(CLAVE).schema_version, 99);
});

test("storage: si setItem falla, save() devuelve false y no pisa lo anterior", () => {
  const e = crearEntorno({ sinSync: true });
  e.escribir(CLAVE, datosEjemplo());
  e.localStorage._fallas.add(CLAVE);
  const r = e.GYMAPP.storage.updateData((d) => { d.usuario.nombre = "otro"; }, { alertaAutomatica: false });
  assert.equal(r.guardado, false);
  assert.equal(e.leer(CLAVE).usuario.nombre, "Nico");
});

/* --- AUTH --- */

test("AUTH: crea el cliente con su propia storageKey y recupera la sesión al inicializar", async () => {
  const e = crearEntorno({ authReal: true });
  e.auth.sesion = { user: { id: "uid-A", email: "a@test.com" } };
  const avisos = [];
  e.GYMAPP.auth.suscribirCambiosSesion((s) => avisos.push(s));
  e.GYMAPP.auth.inicializar();
  await esperar();
  assert.equal(e.registro.createClient.opts.auth.storageKey, "gymNutritionTracker_supabaseAuth");
  assert.equal(e.GYMAPP.auth.obtenerSesion().user.id, "uid-A");
  assert.equal(avisos.length, 1);
});

test("AUTH: login/logout usan email + contraseña y nunca tocan gymNutritionTracker", async () => {
  const e = crearEntorno({ authReal: true });
  e.escribir(CLAVE, datosEjemplo());
  await e.GYMAPP.auth.iniciarSesion("a@test.com", "secreta");
  await e.GYMAPP.auth.cerrarSesion();
  assert.deepEqual(clonar(e.auth.llamadas), [["signInWithPassword", { email: "a@test.com", password: "secreta" }], ["signOut"]]);
  assert.ok(!e.localStorage._escrituras.includes(CLAVE));
});

test("AUTH: onAuthStateChange actualiza la sesión que usa sync", async () => {
  const e = crearEntorno({ authReal: true });
  e.GYMAPP.auth.obtenerCliente();
  e.auth.eventos("SIGNED_IN", { user: { id: "uid-Z", email: "z@test.com" } });
  assert.match(e.GYMAPP.sync.renderSeccionSincronizacion(), /z@test\.com/);
  e.auth.eventos("SIGNED_OUT", null);
  assert.match(e.GYMAPP.sync.renderSeccionSincronizacion(), /Iniciá sesión/);
});

/* --- SYNC-01 --- */

test("SYNC-01: sin sesión rechaza sin llamar a la nube", async () => {
  const e = crearEntorno();
  await assert.rejects(e.GYMAPP.sync.subirPrimeraVez(), /Iniciá sesión/);
  assert.equal(e.nube.llamadas.length, 0);
});

test("SYNC-01: crea la fila con los datos exactos de getData() y schema_version", async () => {
  const e = crearEntorno();
  e.login();
  e.escribir(CLAVE, datosEjemplo());
  const c = crearContenedor();
  e.GYMAPP.sync.bindEventosSincronizacion(c);
  c.click("subir-a-la-nube"); await esperar();
  const r = rpcs(e);
  assert.equal(r.length, 1);
  assert.equal(r[0].nombre, "crear_datos_usuario_iniciales");
  assert.deepEqual(Object.keys(r[0].params).sort(), ["p_data", "p_schema_version"]);
  assert.deepEqual(r[0].params.p_data, clonar(e.GYMAPP.storage.getData()));
  assert.match(c.mensaje().textContent, /Datos guardados en la nube/);
});

test("SYNC-01: si ya existe fila remota, no sobrescribe", async () => {
  const e = crearEntorno();
  e.login();
  e.nube.fila = { data: datosEjemplo({ base_alimentos: [{ nombre: "remoto" }] }), schema_version: 2, revision: 3 };
  const c = crearContenedor();
  e.GYMAPP.sync.bindEventosSincronizacion(c);
  c.click("subir-a-la-nube"); await esperar();
  assert.equal(e.nube.fila.revision, 3);
  assert.deepEqual(e.nube.fila.data.base_alimentos, [{ nombre: "remoto" }]);
  assert.match(c.mensaje().textContent, /No se sobrescribió nada/);
});

/* --- SYNC-02 --- */

function prepararRestore(remoto, local) {
  const e = crearEntorno();
  e.login();
  e.escribir(CLAVE, local || datosEjemplo({ base_alimentos: [{ nombre: "local" }] }));
  if (remoto) e.nube.fila = { data: remoto, schema_version: remoto.schema_version, revision: 4, updated_at: "2026-10-18T10:00:00Z" };
  const c = crearContenedor();
  e.GYMAPP.sync.bindEventosSincronizacion(c);
  return { e, c };
}

test("SYNC-02: sin fila remota avisa y no toca nada", async () => {
  const { e, c } = prepararRestore(null);
  const antes = e.localStorage.getItem(CLAVE);
  c.click("recuperar-de-la-nube"); await esperar();
  assert.equal(e.localStorage.getItem(CLAVE), antes);
  assert.match(c.mensaje().textContent, /No hay datos guardados en la nube/);
});

test("SYNC-02: cancelar la confirmación no toca nada", async () => {
  const { e, c } = prepararRestore(datosEjemplo());
  const antes = e.localStorage.getItem(CLAVE);
  e.respuestas.confirm.push(false);
  c.click("recuperar-de-la-nube"); await esperar();
  assert.equal(e.localStorage.getItem(CLAVE), antes);
  assert.equal(e.leer(BACKUP), null);
  assert.match(c.mensaje().textContent, /Restauración cancelada/);
});

test("SYNC-02: confirmar crea backup, restaura vía storage y no escribe en la nube", async () => {
  const local = datosEjemplo({ base_alimentos: [{ nombre: "local" }] });
  const { e, c } = prepararRestore(datosEjemplo({ base_alimentos: [{ nombre: "remoto" }] }), local);
  e.respuestas.confirm.push(true);
  c.click("recuperar-de-la-nube"); await esperar();
  assert.match(e.registro.confirmaciones[0], /Revisión remota: 4/);
  assert.deepEqual(e.leer(BACKUP).data, clonar(local));
  assert.deepEqual(e.leer(CLAVE).base_alimentos, [{ nombre: "remoto" }]);
  assert.equal(rpcs(e).length, 0);
  assert.equal(e.nube.fila.revision, 4);
});

test("SYNC-02: payload remoto inválido o de schema futuro se bloquea sin tocar nada local", async () => {
  for (const remoto of [{ foo: 1 }, datosEjemplo({ schema_version: 99 })]) {
    const { e, c } = prepararRestore(remoto);
    const antes = e.localStorage.getItem(CLAVE);
    e.respuestas.confirm.push(true);
    c.click("recuperar-de-la-nube"); await esperar();
    assert.equal(e.localStorage.getItem(CLAVE), antes);
    assert.equal(e.leer(BACKUP), null);
    assert.equal(c.mensaje().className, "mensaje error");
  }
});

test("SYNC-02: payload remoto de schema viejo se migra antes de guardar", async () => {
  const { e, c } = prepararRestore({ usuario: { nombre: "Viejo" }, rutina: { dias: [] } });
  e.respuestas.confirm.push(true);
  c.click("recuperar-de-la-nube"); await esperar();
  const d = e.leer(CLAVE);
  assert.equal(d.schema_version, 3);
  assert.equal(d.usuario.actividades.length, 2);
  assert.deepEqual(d.sesiones_entrenamiento, []);
});

test("SYNC-02: si no se puede crear el backup, no restaura", async () => {
  const { e, c } = prepararRestore(datosEjemplo({ base_alimentos: [{ nombre: "remoto" }] }));
  const antes = e.localStorage.getItem(CLAVE);
  e.localStorage._fallas.add(BACKUP);
  e.respuestas.confirm.push(true);
  c.click("recuperar-de-la-nube"); await esperar();
  assert.equal(e.localStorage.getItem(CLAVE), antes);
  assert.match(c.mensaje().textContent, /No se pudo crear una copia de seguridad/);
});
