/* E0: SYNC-03 reconoce status "schema_downgrade" de la RPC.
   Correr con: node --test tests/*.test.js */
const test = require("node:test");
const assert = require("node:assert/strict");
const { crearEntorno, crearContenedor, esperar, datosEjemplo, clonar } = require("./entorno");

const META = "gymNutritionTracker_syncMeta";
const MENSAJE = "La copia de la nube usa una versión de datos más nueva. Actualizá la app antes de sincronizar.";

function preparar() {
  const e = crearEntorno();
  e.login("uid-A");
  e.escribir("gymNutritionTracker", datosEjemplo({ medidas_corporales: [{ fecha: "2026-10-19", peso: 80 }] }));
  e.nube.fila = { data: datosEjemplo(), schema_version: 2, revision: 4, updated_at: "2026-10-18T10:00:00Z" };
  e.escribir(META, { user_id: "uid-A", last_known_revision: 4, last_sync_at: "2026-10-18T10:00:00Z" });
  e.nube.respuestaActualizar = { status: "schema_downgrade", current_schema_version: 3, current_revision: 4 };
  const c = crearContenedor();
  e.GYMAPP.sync.bindEventosSincronizacion(c);
  return { e, c };
}

test("schema_downgrade: rechaza con el mensaje exacto, sin tocar nube ni syncMeta y sin reintentar", async () => {
  const { e } = preparar();
  const filaAntes = JSON.stringify(e.nube.fila);
  const metaAntes = e.localStorage.getItem(META);
  await assert.rejects(e.GYMAPP.sync.sincronizarAhora(), { message: MENSAJE });
  assert.equal(e.nube.llamadas.filter((l) => l.tipo === "rpc").length, 1, "una sola llamada, sin reintento");
  assert.equal(JSON.stringify(e.nube.fila), filaAntes);
  assert.equal(e.localStorage.getItem(META), metaAntes, "syncMeta no avanza");
  assert.ok(!e.localStorage._escrituras.includes("gymNutritionTracker"), "no restaura nada");
});

test("schema_downgrade también en 'Conservar datos locales'", async () => {
  const { e } = preparar();
  const metaAntes = e.localStorage.getItem(META);
  await assert.rejects(e.GYMAPP.sync.conservarLocalYActualizar(), { message: MENSAJE });
  assert.equal(e.localStorage.getItem(META), metaAntes);
});

test("UI: muestra el mensaje y no abre conflicto ni restaura", async () => {
  const { e, c } = preparar();
  c.click("sincronizar-ahora"); await esperar();
  assert.equal(c.mensaje().textContent, "No se pudo sincronizar: " + MENSAJE + " Tus datos locales y la nube no se modificaron.");
  assert.equal(c.mensaje().className, "mensaje error");
  assert.equal(c.panel(), "");
  assert.equal(e.registro.confirmaciones.length, 0);
  assert.equal(e.registro.timeouts.length, 0, "no programa recarga");
});

test("otras respuestas desconocidas (invalid_payload) siguen siendo error genérico sin efectos", async () => {
  const { e } = preparar();
  e.nube.respuestaActualizar = { status: "invalid_payload" };
  const metaAntes = e.localStorage.getItem(META);
  await assert.rejects(e.GYMAPP.sync.sincronizarAhora(), /Respuesta inesperada del servidor/);
  assert.equal(e.localStorage.getItem(META), metaAntes);
});
