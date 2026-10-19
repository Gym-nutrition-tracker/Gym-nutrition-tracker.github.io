/* Tests de SYNC-03 ("Sincronizar ahora"). Correr con: node --test tests/ */
const test = require("node:test");
const assert = require("node:assert/strict");
const { crearEntorno, crearContenedor, esperar, datosEjemplo, clonar } = require("./entorno");

const CLAVE = "gymNutritionTracker";
const META = "gymNutritionTracker_syncMeta";
const BACKUP = "gymNutritionTracker_preRestoreBackup";

/* Entorno con usuario logueado, datos locales y (opcional) fila remota. */
function preparar(op) {
  op = op || {};
  const e = crearEntorno();
  if (op.login !== false) e.login(op.uid || "uid-A");
  e.escribir(CLAVE, op.local || datosEjemplo());
  if (op.remoto) e.nube.fila = { data: clonar(op.remoto), schema_version: op.remoto.schema_version, revision: op.revision || 1, updated_at: "2026-10-18T10:00:00Z" };
  if (op.meta) e.escribir(META, op.meta);
  const c = crearContenedor();
  e.GYMAPP.sync.bindEventosSincronizacion(c);
  return { e, c };
}
const rpcs = (e, nombre) => e.nube.llamadas.filter((l) => l.tipo === "rpc" && (!nombre || l.nombre === nombre));
const meta = (uid, rev) => ({ user_id: uid, last_known_revision: rev, last_sync_at: "2026-10-18T10:00:00Z" });
const localModificado = () => datosEjemplo({ medidas_corporales: [{ fecha: "2026-10-19", peso: 80 }] });

test("sin login: rechaza y no consulta ni escribe nada", async () => {
  const { e, c } = preparar({ login: false });
  await assert.rejects(e.GYMAPP.sync.sincronizarAhora(), /Iniciá sesión/);
  c.click("sincronizar-ahora"); await esperar();
  assert.equal(e.nube.llamadas.length, 0);
  assert.equal(e.leer(META), null);
  assert.match(c.mensaje().textContent, /Iniciá sesión/);
});

test("sin fila remota: usa el flujo SYNC-01 y registra revision 1", async () => {
  const { e, c } = preparar();
  c.click("sincronizar-ahora"); await esperar();
  assert.deepEqual(rpcs(e).map((r) => r.nombre), ["crear_datos_usuario_iniciales"]);
  assert.equal(e.nube.fila.revision, 1);
  assert.equal(e.leer(META).user_id, "uid-A");
  assert.equal(e.leer(META).last_known_revision, 1);
  assert.match(c.mensaje().textContent, /primera vez/);
});

test("fila remota igual y sin syncMeta: adopta baseline sin subir nada", async () => {
  const local = datosEjemplo();
  /* Mismo contenido, distinto orden de claves (como puede devolver jsonb). */
  const remoto = {};
  Object.keys(local).reverse().forEach((k) => { remoto[k] = clonar(local[k]); });
  const { e, c } = preparar({ local, remoto, revision: 7 });
  c.click("sincronizar-ahora"); await esperar();
  assert.equal(rpcs(e).length, 0, "no debe llamar ninguna RPC");
  assert.equal(e.leer(META).last_known_revision, 7);
  assert.ok(e.leer(META).last_sync_at);
  assert.match(c.mensaje().textContent, /No hizo falta subir nada/);
});

test("fila remota distinta y sin syncMeta: conflicto, no sobrescribe", async () => {
  const { e, c } = preparar({ local: localModificado(), remoto: datosEjemplo(), revision: 3 });
  c.click("sincronizar-ahora"); await esperar();
  assert.equal(rpcs(e).length, 0);
  assert.equal(e.nube.fila.revision, 3);
  assert.equal(e.leer(META), null);
  assert.match(c.panel(), /Conflicto de sincronización/);
  assert.match(c.panel(), /conflicto-usar-nube/);
  assert.match(c.panel(), /conflicto-conservar-local/);
  assert.match(c.panel(), /conflicto-cancelar/);
});

test("update exitoso: llama la RPC segura con expected_revision y actualiza syncMeta", async () => {
  const { e, c } = preparar({ local: localModificado(), remoto: datosEjemplo(), revision: 4, meta: meta("uid-A", 4) });
  c.click("sincronizar-ahora"); await esperar();
  const llamadas = rpcs(e, "actualizar_datos_usuario_seguro");
  assert.equal(llamadas.length, 1);
  assert.equal(llamadas[0].params.p_expected_revision, 4);
  assert.equal(llamadas[0].params.p_schema_version, 3);
  assert.ok(!("user_id" in llamadas[0].params) && !("user_id" in llamadas[0].params.p_data), "nunca manda user_id");
  assert.deepEqual(llamadas[0].params.p_data, clonar(e.GYMAPP.storage.getData()));
  assert.equal(e.nube.fila.revision, 5);
  assert.equal(e.leer(META).last_known_revision, 5);
  assert.notEqual(e.leer(META).last_sync_at, "2026-10-18T10:00:00Z");
  assert.match(c.mensaje().textContent, /Revisión: 5/);
});

test("update exitoso sin revision en la respuesta: relee la nube y adopta la revision solo si coincide", async () => {
  const { e } = preparar({ local: localModificado(), remoto: datosEjemplo(), revision: 4, meta: meta("uid-A", 4) });
  e.nube.omitirRevisionEnRespuesta = true;
  const r = await e.GYMAPP.sync.sincronizarAhora();
  assert.equal(r.estado, "actualizado");
  assert.equal(e.leer(META).last_known_revision, 5);
});

test("revision local y remota iguales con datos iguales: no sube nada", async () => {
  const { e } = preparar({ remoto: datosEjemplo(), revision: 4, meta: meta("uid-A", 4) });
  const r = await e.GYMAPP.sync.sincronizarAhora();
  assert.equal(r.estado, "sin_cambios");
  assert.equal(rpcs(e).length, 0);
});

test("la revision remota cambió antes de actualizar: conflicto sin llamar la RPC", async () => {
  const { e, c } = preparar({ local: localModificado(), remoto: datosEjemplo(), revision: 6, meta: meta("uid-A", 4) });
  c.click("sincronizar-ahora"); await esperar();
  assert.equal(rpcs(e).length, 0);
  assert.equal(e.nube.fila.revision, 6);
  assert.equal(e.leer(META).last_known_revision, 4, "syncMeta no cambia");
  assert.match(c.panel(), /revisión conocida: 4, revisión en la nube: 6/);
});

test("la RPC devuelve conflict: muestra conflicto y no actualiza syncMeta", async () => {
  const { e, c } = preparar({ local: localModificado(), remoto: datosEjemplo(), revision: 4, meta: meta("uid-A", 4) });
  /* Otro dispositivo escribe entre el SELECT y la RPC. */
  e.nube.antesDeActualizar = (n) => { n.fila.revision = 5; n.fila.data.base_alimentos = [{ nombre: "otro" }]; };
  c.click("sincronizar-ahora"); await esperar();
  assert.equal(rpcs(e, "actualizar_datos_usuario_seguro").length, 1);
  assert.deepEqual(e.nube.fila.data.base_alimentos, [{ nombre: "otro" }], "el cambio remoto se conserva");
  assert.equal(e.leer(META).last_known_revision, 4);
  assert.match(c.panel(), /cambió mientras se intentaba actualizarla/);
});

test("opción usar nube: reutiliza SYNC-02 con backup previo y registra la revision remota", async () => {
  const local = localModificado();
  const { e, c } = preparar({ local, remoto: datosEjemplo(), revision: 6, meta: meta("uid-A", 4) });
  c.click("sincronizar-ahora"); await esperar();
  e.respuestas.confirm.push(true);
  c.click("conflicto-usar-nube"); await esperar();
  assert.equal(e.registro.confirmaciones.length, 1, "pide la confirmación de SYNC-02");
  assert.deepEqual(e.leer(BACKUP).data, clonar(local), "backup de los datos locales previos");
  assert.equal(e.leer(BACKUP).revision_remota_a_restaurar, 6);
  assert.deepEqual(e.leer(CLAVE).medidas_corporales, [], "se restauró lo remoto");
  assert.equal(e.leer(META).last_known_revision, 6);
  assert.equal(rpcs(e).length, 0, "restaurar nunca escribe en la nube");
  assert.equal(c.panel(), "");
});

test("opción conservar local: exige confirmación fuerte, relee la revision y la usa como expected", async () => {
  const { e, c } = preparar({ local: localModificado(), remoto: datosEjemplo(), revision: 6, meta: meta("uid-A", 4) });
  c.click("sincronizar-ahora"); await esperar();

  /* Confirmación incorrecta: no hace nada. */
  e.respuestas.prompt.push("si");
  c.click("conflicto-conservar-local"); await esperar();
  assert.equal(rpcs(e).length, 0);
  assert.match(c.panel(), /Conflicto/, "el conflicto sigue pendiente");

  /* La nube vuelve a cambiar mientras el usuario decide: se relee. */
  e.nube.fila.revision = 7;
  e.respuestas.prompt.push("SOBRESCRIBIR");
  c.click("conflicto-conservar-local"); await esperar();
  const llamadas = rpcs(e, "actualizar_datos_usuario_seguro");
  assert.equal(llamadas.length, 1);
  assert.equal(llamadas[0].params.p_expected_revision, 7);
  assert.deepEqual(e.nube.fila.data.medidas_corporales, [{ fecha: "2026-10-19", peso: 80 }]);
  assert.equal(e.leer(META).last_known_revision, 8);
  assert.equal(c.panel(), "");
});

test("conflicto repetido: si la nube cambia otra vez durante 'conservar local', vuelve al conflicto", async () => {
  const { e, c } = preparar({ local: localModificado(), remoto: datosEjemplo(), revision: 6, meta: meta("uid-A", 4) });
  c.click("sincronizar-ahora"); await esperar();
  e.nube.antesDeActualizar = (n) => { n.fila.revision = 9; };
  e.respuestas.prompt.push("SOBRESCRIBIR");
  c.click("conflicto-conservar-local"); await esperar();
  assert.equal(e.nube.fila.revision, 9, "no se forzó la escritura");
  assert.deepEqual(e.nube.fila.data.medidas_corporales, []);
  assert.equal(e.leer(META).last_known_revision, 4);
  assert.match(c.panel(), /Conflicto de sincronización/);
});

test("cancelar: no modifica nada local ni remoto", async () => {
  const local = localModificado();
  const { e, c } = preparar({ local, remoto: datosEjemplo(), revision: 6, meta: meta("uid-A", 4) });
  c.click("sincronizar-ahora"); await esperar();
  const escriturasAntes = e.localStorage._escrituras.length;
  c.click("conflicto-cancelar"); await esperar();
  assert.equal(e.localStorage._escrituras.length, escriturasAntes);
  assert.deepEqual(e.leer(CLAVE), clonar(local));
  assert.equal(e.nube.fila.revision, 6);
  assert.equal(rpcs(e).length, 0);
  assert.equal(c.panel(), "");
  assert.match(c.mensaje().textContent, /cancelada/);
});

test("cambio de cuenta: bloquea la subida y ofrece recuperar o conservar local", async () => {
  const { e, c } = preparar({ uid: "uid-B", local: localModificado(), remoto: datosEjemplo(), revision: 2, meta: meta("uid-A", 4) });
  c.click("sincronizar-ahora"); await esperar();
  assert.equal(e.nube.llamadas.length, 0, "ni siquiera consulta ni sube");
  assert.match(c.panel(), /Cambio de cuenta detectado/);
  assert.match(c.panel(), /conflicto-usar-nube/);
  assert.doesNotMatch(c.panel(), /conflicto-conservar-local/, "no ofrece subir lo local");
  await assert.doesNotReject(async () => {
    const r = await e.GYMAPP.sync.conservarLocalYActualizar();
    assert.equal(r.estado, "cuenta_distinta");
  });
  assert.equal(rpcs(e).length, 0);

  /* Conservar local sin sincronizar: no toca nada. */
  c.click("conflicto-cancelar"); await esperar();
  assert.equal(e.leer(META).user_id, "uid-A");

  /* Recuperar la nube de la cuenta nueva: pasa a ser la baseline de uid-B. */
  c.click("sincronizar-ahora"); await esperar();
  e.respuestas.confirm.push(true);
  c.click("conflicto-usar-nube"); await esperar();
  assert.equal(e.leer(META).user_id, "uid-B");
  assert.equal(e.leer(META).last_known_revision, 2);
});

test("syncMeta solo se actualiza tras un éxito (no ante error de red ni RPC)", async () => {
  const { e } = preparar({ local: localModificado(), remoto: datosEjemplo(), revision: 4, meta: meta("uid-A", 4) });
  e.nube.errorRpc = { message: "network down" };
  await assert.rejects(e.GYMAPP.sync.sincronizarAhora(), { message: "network down" });
  assert.deepEqual(e.leer(META), meta("uid-A", 4));
  e.nube.errorRpc = null;
  e.nube.errorSelect = { message: "timeout" };
  await assert.rejects(e.GYMAPP.sync.sincronizarAhora(), { message: "timeout" });
  assert.deepEqual(e.leer(META), meta("uid-A", 4));
  assert.ok(!e.localStorage._escrituras.includes(META));
});

test("restore mantiene el backup previo y no toca la nube", async () => {
  const local = localModificado();
  const { e, c } = preparar({ local, remoto: datosEjemplo(), revision: 3 });
  e.respuestas.confirm.push(true);
  c.click("recuperar-de-la-nube"); await esperar();
  assert.deepEqual(e.leer(BACKUP).data, clonar(local));
  assert.equal(rpcs(e).length, 0);
  assert.equal(e.leer(META).last_known_revision, 3);
  assert.equal(e.registro.timeouts.length, 1, "programa la recarga como en SYNC-02");
});

test("error de storage no destruye datos locales", async () => {
  const local = localModificado();
  const { e, c } = preparar({ local, remoto: datosEjemplo(), revision: 3 });
  /* El guardado principal falla durante el restore. */
  e.localStorage._fallas.add(CLAVE);
  e.respuestas.confirm.push(true);
  c.click("recuperar-de-la-nube"); await esperar();
  assert.deepEqual(e.leer(CLAVE), clonar(local));
  assert.ok(e.leer(BACKUP), "el backup queda disponible");
  assert.equal(e.leer(META), null, "sin syncMeta si el restore falló");
  assert.match(c.mensaje().textContent, /falló el guardado local/);

  /* Si la syncMeta no se puede escribir tras un update, avisa y no toca los datos. */
  e.localStorage._fallas.clear();
  e.escribir(META, meta("uid-A", 3));
  e.localStorage._fallas.add(META);
  c.click("sincronizar-ahora"); await esperar();
  assert.equal(e.nube.fila.revision, 4);
  assert.deepEqual(e.leer(CLAVE), clonar(local));
  assert.equal(e.leer(META).last_known_revision, 3, "queda la revision vieja: la próxima vez hay conflicto, no pisada");
  assert.match(c.mensaje().textContent, /no se pudo registrar la revisión/);
});

test("schema futuro bloqueado (remoto y local)", async () => {
  const remotoFuturo = datosEjemplo({ schema_version: 99 });
  const a = preparar({ remoto: remotoFuturo, revision: 2, meta: meta("uid-A", 2) });
  await assert.rejects(a.e.GYMAPP.sync.sincronizarAhora(), /versión más nueva/);
  a.e.respuestas.prompt.push("SOBRESCRIBIR");
  await assert.rejects(a.e.GYMAPP.sync.conservarLocalYActualizar(), /versión más nueva/);
  assert.equal(rpcs(a.e).length, 0);

  /* Restore SYNC-02 de un schema futuro: bloqueado, local intacto. */
  const local = datosEjemplo();
  const b = preparar({ local, remoto: remotoFuturo, revision: 2 });
  b.e.respuestas.confirm.push(true);
  b.c.click("recuperar-de-la-nube"); await esperar();
  assert.deepEqual(b.e.leer(CLAVE), clonar(local));
  assert.equal(b.e.leer(BACKUP), null);
  assert.match(b.c.mensaje().textContent, /versión más nueva/);

  /* Datos locales de un schema futuro: nunca se suben. */
  const d = preparar({ local: datosEjemplo({ schema_version: 99 }), remoto: datosEjemplo(), revision: 2, meta: meta("uid-A", 2) });
  await assert.rejects(d.e.GYMAPP.sync.sincronizarAhora(), /versión más nueva/);
  assert.equal(rpcs(d.e).length, 0);
});

test("no hay auto-sync: cargar el módulo, renderizar y bindear no llama a la nube", async () => {
  const { e } = preparar({ remoto: datosEjemplo(), revision: 2, meta: meta("uid-A", 1) });
  const html = e.GYMAPP.sync.renderSeccionSincronizacion();
  await esperar();
  assert.equal(e.nube.llamadas.length, 0);
  assert.match(html, /🔄 Sincronizar ahora/);
  assert.match(html, /☁️ Guardar en la nube/);
  assert.match(html, /☁️ Recuperar desde la nube/);
});

test("no hay writes inesperados en gymNutritionTracker durante la sincronización", async () => {
  const casos = [
    { remoto: null },
    { remoto: datosEjemplo(), revision: 2 },
    { local: localModificado(), remoto: datosEjemplo(), revision: 2, meta: meta("uid-A", 2) },
    { local: localModificado(), remoto: datosEjemplo(), revision: 5, meta: meta("uid-A", 2) },
    { uid: "uid-B", remoto: datosEjemplo(), revision: 5, meta: meta("uid-A", 2) }
  ];
  for (const caso of casos) {
    const { e, c } = preparar(caso);
    const antes = e.localStorage.getItem(CLAVE);
    c.click("sincronizar-ahora"); await esperar();
    if (e.nube.fila && /Conflicto/.test(c.panel())) {
      e.respuestas.prompt.push("SOBRESCRIBIR");
      c.click("conflicto-conservar-local"); await esperar();
    }
    assert.ok(!e.localStorage._escrituras.includes(CLAVE), "gymNutritionTracker no se escribió");
    assert.equal(e.localStorage.getItem(CLAVE), antes);
    assert.ok(e.localStorage._escrituras.every((k) => k === META), "solo se escribe la syncMeta");
    const metaGuardada = e.leer(META);
    if (metaGuardada) assert.deepEqual(Object.keys(metaGuardada).sort(), ["last_known_revision", "last_sync_at", "user_id"]);
    assert.ok(!("syncMeta" in JSON.parse(e.localStorage.getItem(CLAVE))));
  }
});

test("doble click en sincronizar: una sola operación en curso", async () => {
  const { e, c } = preparar({ local: localModificado(), remoto: datosEjemplo(), revision: 4, meta: meta("uid-A", 4) });
  c.click("sincronizar-ahora");
  c.click("sincronizar-ahora");
  c.click("subir-a-la-nube");
  c.click("recuperar-de-la-nube");
  await esperar();
  assert.equal(rpcs(e).length, 1);
  assert.equal(e.registro.confirmaciones.length, 0);
});

test("syncMeta corrupta se trata como inexistente (camino conservador)", async () => {
  const { e } = preparar({ local: localModificado(), remoto: datosEjemplo(), revision: 2 });
  e.localStorage._mapa.set(META, "{no es json");
  const r = await e.GYMAPP.sync.sincronizarAhora();
  assert.equal(r.estado, "conflicto");
  assert.equal(r.motivo, "sin_baseline");
  assert.equal(rpcs(e).length, 0);
});
