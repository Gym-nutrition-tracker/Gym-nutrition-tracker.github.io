/* Recuperación inicial ("Encontramos tus datos"): usuario con cuenta y copia
   en la nube que entra en un navegador/dispositivo/dominio sin datos
   locales. Acá: detección, solo lectura, restauración con la lógica de
   sync, bloqueo de versiones futuras y "Empezar de cero". El arranque
   completo (login → pantalla → Dashboard) está en
   tests/e2e/recuperacion-inicial.e2e.js.
   Correr con: node --test tests/*.test.js */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { crearEntorno, esperar, clonar, aE3 } = require("./entorno");
const { datasetHistoricos } = require("./fixtures/historicos-dataset");

const CLAVE = "gymNutritionTracker";
const CLAVE_META = "gymNutritionTracker_syncMeta";
const CLAVE_BACKUP = "gymNutritionTracker_preRestoreBackup";
const RAIZ = path.join(__dirname, "..");

/* Copia de la nube de ejemplo (sin datos personales: dataset sintético). */
function copiaNube(extra) {
  const data = aE3(datasetHistoricos({ legacy: true }));
  data.usuario.nombre = "Ana";
  data.medidas_corporales = [{ fecha: "2026-10-01", peso_kg: 74.5, cintura_cm: 81 }];
  data.registros_nutricion = [{ fecha: "2026-10-02", items: [] }];
  return Object.assign({ data, schema_version: 3, revision: 7, updated_at: "2026-10-26T21:30:00Z" }, extra || {});
}

/* Entorno con módulos de la app, sesión opcional y local vacío. */
function entorno(opciones) {
  opciones = opciones || {};
  const e = crearEntorno({ ahora: "2026-10-27T12:00:00", modulos: ["js/recuperacionInicial.js"] });
  if (opciones.sesion !== false) e.login("uid-A", "ana@test.com");
  if (opciones.fila) e.nube.fila = clonar(opciones.fila);
  return e;
}
const escrituras = (e) => e.nube.llamadas.filter((l) => l.tipo === "rpc");
const lecturas = (e) => e.nube.llamadas.filter((l) => l.tipo === "select");

/* --- Detección --- */

test("1. local vacío + copia en la nube → 'encontrado' (pantalla de recuperación)", async () => {
  const e = entorno({ fila: copiaNube() });
  const R = e.GYMAPP.recuperacionInicial;
  assert.equal(R.hayDatosLocalesUtiles(e.GYMAPP.storage.getData()), false);
  const r = clonar(await R.consultar());
  assert.equal(r.estado, "encontrado");
  assert.equal(r.fila.revision, 7);
  const html = R.render(r);
  assert.match(html, /Encontramos tus datos/);
  assert.match(html, /Ya tenés una copia guardada en la nube\./);
  assert.match(html, /data-accion="recuperacion-recuperar"[^>]*>Recuperar mis datos</);
  assert.match(html, /data-accion="recuperacion-cero"[^>]*>Empezar de cero</);
  assert.match(html, /Perfil de Ana/);
});

test("5. local vacío + sin copia en la nube → 'sin_datos' (onboarding normal)", async () => {
  const e = entorno();
  assert.deepEqual(clonar(await e.GYMAPP.recuperacionInicial.consultar()), { estado: "sin_datos" });
});

test("6. con datos locales útiles no se ofrece recuperar", () => {
  const e = entorno();
  const R = e.GYMAPP.recuperacionInicial;
  const base = e.GYMAPP.storage.getDefaultData();
  assert.equal(R.hayDatosLocalesUtiles(base), false, "estado por defecto = vacío");
  assert.equal(R.hayDatosLocalesUtiles(Object.assign(clonar(base), { usuario: { nombre: "X" } })), true);
  assert.equal(R.hayDatosLocalesUtiles(Object.assign(clonar(base), { sesiones_entrenamiento: [{ id: "s" }] })), true);
  assert.equal(R.hayDatosLocalesUtiles(Object.assign(clonar(base), { medidas_corporales: [{ fecha: "2026-10-01", peso_kg: 80 }] })), true);
  assert.equal(R.hayDatosLocalesUtiles(Object.assign(clonar(base), { registros_nutricion: [{ fecha: "2026-10-01" }] })), true);
});

/* Plan útil = definición central de ONB-03 (planes.planEsUtil): al menos un ejercicio. */
const ejercicio = { id: "e1", nombre: "PRESS BANCA C/BARRA", series_objetivo: 4, reps_objetivo: "8" };
function localConPlan(e, dias) {
  const d = e.GYMAPP.storage.getDefaultData();
  d.rutina.planes[0].dias = dias;
  e.escribir(CLAVE, d);
  return e.GYMAPP.storage.getData();
}

test("plan útil 1. plan sin días + copia en la nube → se ofrece recuperar", async () => {
  const e = entorno({ fila: copiaNube() });
  const local = localConPlan(e, []);
  assert.equal(e.GYMAPP.recuperacionInicial.hayDatosLocalesUtiles(local), false);
  assert.equal(clonar(await e.GYMAPP.recuperacionInicial.consultar()).estado, "encontrado");
});

test("plan útil 2. plan con 3 días vacíos + copia en la nube → se ofrece recuperar", async () => {
  const e = entorno({ fila: copiaNube() });
  const local = localConPlan(e, [1, 2, 3].map((i) => ({ id: "d" + i, nombre: "Día " + i, orden: i, ejercicios: [] })));
  assert.equal(local.rutina.planes[0].dias.length, 3);
  assert.equal(e.GYMAPP.recuperacionInicial.hayDatosLocalesUtiles(local), false);
});

test("plan útil 3. plan con 1 día y 1 ejercicio → datos útiles (entra normalmente)", () => {
  const e = entorno({ fila: copiaNube() });
  const local = localConPlan(e, [{ id: "d1", nombre: "Día 1", orden: 1, ejercicios: [ejercicio] }]);
  assert.equal(e.GYMAPP.recuperacionInicial.hayDatosLocalesUtiles(local), true);
  /* Un plan útil archivado también cuenta (no solo el activo). */
  const d = e.GYMAPP.storage.getDefaultData();
  d.rutina.planes.push({ plan_id: "viejo", nombre: "Viejo", archivado_en: "2026-10-01T00:00:00Z", dias: [{ id: "v1", nombre: "V", ejercicios: [ejercicio] }] });
  assert.equal(e.GYMAPP.recuperacionInicial.hayDatosLocalesUtiles(d), true);
});

test("plan útil 4. usa la definición central (GYMAPP.planes.planEsUtil), no una copia", () => {
  const src = fs.readFileSync(path.join(RAIZ, "js/recuperacionInicial.js"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(src, /planes\.some\(GYMAPP\.planes\.planEsUtil\)/);
  assert.doesNotMatch(src, /dias\.length|ejercicios\.length/, "sin reglas propias de días/ejercicios");
  /* Y responde exactamente lo mismo que la función central en cada caso. */
  const e = entorno();
  const R = e.GYMAPP.recuperacionInicial;
  const casos = [[], [{ id: "a", ejercicios: [] }], [{ id: "a", ejercicios: [] }, { id: "b", ejercicios: [ejercicio] }]];
  casos.forEach((dias) => {
    const d = e.GYMAPP.storage.getDefaultData();
    d.rutina.planes[0].dias = dias;
    assert.equal(R.hayDatosLocalesUtiles(d), e.GYMAPP.planes.planEsUtil(d.rutina.planes[0]));
  });
});

/* --- Recuperar --- */

test("2-3. recuperar restaura perfil, planes, sesiones, medidas y nutrición", async () => {
  const fila = copiaNube();
  const e = entorno({ fila });
  const r = clonar(await e.GYMAPP.recuperacionInicial.recuperar("uid-A"));
  assert.deepEqual(r, { ok: true });
  const local = e.GYMAPP.storage.getData();
  assert.equal(local.usuario.nombre, "Ana");
  assert.deepEqual(clonar(local.rutina), fila.data.rutina);
  assert.deepEqual(clonar(local.sesiones_entrenamiento), fila.data.sesiones_entrenamiento);
  assert.deepEqual(clonar(local.medidas_corporales), fila.data.medidas_corporales);
  assert.deepEqual(clonar(local.registros_nutricion), fila.data.registros_nutricion);
  assert.equal(local.schema_version, 3);
});

test("4. recuperar registra la revisión remota como baseline (syncMeta) y deja backup previo", async () => {
  const e = entorno({ fila: copiaNube() });
  await e.GYMAPP.recuperacionInicial.recuperar("uid-A");
  const meta = e.leer(CLAVE_META);
  assert.equal(meta.user_id, "uid-A");
  assert.equal(meta.last_known_revision, 7);
  assert.ok(e.leer(CLAVE_BACKUP), "backup local previo, igual que 'Recuperar desde la nube'");
  /* Después de recuperar, "Sincronizar ahora" no encuentra nada que subir. */
  const s = clonar(await e.GYMAPP.sync.sincronizarAhora());
  assert.equal(s.estado, "sin_cambios");
  assert.equal(escrituras(e).length, 0);
});

test("8. copia de una versión más nueva → 'bloqueado' con el mensaje seguro; recuperar no escribe nada", async () => {
  const futura = copiaNube();
  futura.data.schema_version = 99;
  futura.schema_version = 99;
  const e = entorno({ fila: futura });
  const R = e.GYMAPP.recuperacionInicial;
  const antes = e.leer(CLAVE);
  const r = clonar(await R.consultar());
  assert.equal(r.estado, "bloqueado");
  assert.match(r.mensaje, /versión más nueva de esta app \(versión 99\).*Actualizá la app/);
  const html = R.render(r);
  assert.doesNotMatch(html, /recuperacion-recuperar/, "sin botón de recuperar");
  assert.match(html, /recuperacion-cero/);
  const intento = clonar(await R.recuperar("uid-A"));
  assert.equal(intento.ok, false);
  assert.deepEqual(e.leer(CLAVE), antes, "local intacto");
  assert.equal(e.leer(CLAVE_META), null);
  assert.equal(escrituras(e).length, 0);
});

test("copia con formato inválido → 'bloqueado', sin tocar nada", async () => {
  const e = entorno({ fila: { data: { foo: 1 }, schema_version: 3, revision: 2 } });
  const r = clonar(await e.GYMAPP.recuperacionInicial.consultar());
  assert.equal(r.estado, "bloqueado");
  assert.equal(escrituras(e).length, 0);
});

/* --- Solo lectura --- */

test("9-10. la consulta inicial es solo un SELECT: ninguna RPC antes de la decisión", async () => {
  const e = entorno({ fila: copiaNube() });
  const antes = e.leer(CLAVE);
  await e.GYMAPP.recuperacionInicial.consultar();
  e.GYMAPP.recuperacionInicial.render({ estado: "encontrado", fila: copiaNube() }, { confirmarCero: true });
  assert.equal(lecturas(e).length, 1);
  assert.equal(lecturas(e)[0].tabla, "datos_usuario");
  assert.deepEqual(escrituras(e), [], "ni crear_datos_usuario_iniciales ni actualizar_datos_usuario_seguro");
  assert.deepEqual(e.leer(CLAVE), antes, "tampoco escribe datos locales");
  assert.equal(e.leer(CLAVE_META), null);
});

test("recuperar: también solo lee la nube (escribe únicamente en este dispositivo)", async () => {
  const fila = copiaNube();
  const e = entorno({ fila });
  await e.GYMAPP.recuperacionInicial.recuperar("uid-A");
  assert.equal(escrituras(e).length, 0);
  assert.deepEqual(clonar(e.nube.fila), fila, "la fila remota no cambió");
});

test("7. 'Empezar de cero': confirmación que avisa que la nube no se reemplaza", () => {
  const e = entorno();
  const html = e.GYMAPP.recuperacionInicial.render({ estado: "encontrado", fila: copiaNube() }, { confirmarCero: true });
  assert.match(html, /Ya existe una copia en la nube\. Si continuás, todavía no la vamos a reemplazar\./);
  assert.match(html, /data-accion="recuperacion-volver"[^>]*>Volver</);
  assert.match(html, /data-accion="recuperacion-continuar-cero"[^>]*>Continuar sin recuperar</);
});

test("error de red al consultar → 'error' (reintentar o empezar de cero), sin escribir", async () => {
  const e = entorno();
  e.nube.errorSelect = { message: "Failed to fetch" };
  const r = clonar(await e.GYMAPP.recuperacionInicial.consultar());
  assert.equal(r.estado, "error");
  const html = e.GYMAPP.recuperacionInicial.render(r);
  assert.match(html, /No pudimos revisar la nube/);
  assert.match(html, /recuperacion-reintentar/);
  assert.equal(escrituras(e).length, 0);
});

test("11. sin sesión no se consulta la nube", async () => {
  const e = entorno({ sesion: false, fila: copiaNube() });
  const r = clonar(await e.GYMAPP.recuperacionInicial.consultar());
  assert.equal(r.estado, "error");
  assert.equal(e.nube.llamadas.length, 0, "obtenerDatosRemotos exige sesión antes de consultar");
  /* Y app.js solo la llama con sesión. */
  const app = fs.readFileSync(path.join(RAIZ, "js/app.js"), "utf8");
  assert.match(app, /tieneUsuario\(GYMAPP\.auth\.obtenerSesion\(\)\) && !R\.hayDatosLocalesUtiles\(data\)/);
});

test("13. no hay perfil de relleno: el módulo nunca crea usuario ni guarda antes de recuperar", () => {
  const src = fs.readFileSync(path.join(RAIZ, "js/recuperacionInicial.js"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(src, /storage\.(save|updateData)|usuario\s*=/);
  assert.doesNotMatch(src, /\.rpc\(|actualizar_datos_usuario_seguro|crear_datos_usuario_iniciales|sincronizarAhora|subirPrimeraVez|conservarLocalYActualizar/);
});

test("sync: 'Recuperar desde la nube' (botón existente) sigue igual y usa la misma restauración", async () => {
  const fila = copiaNube();
  const e = entorno({ fila });
  const { crearContenedor } = require("./entorno");
  const c = crearContenedor();
  e.GYMAPP.sync.bindEventosSincronizacion(c);
  e.respuestas.confirm.push(true);
  c.click("recuperar-de-la-nube");
  await esperar();
  assert.equal(e.GYMAPP.storage.getData().usuario.nombre, "Ana");
  assert.equal(e.leer(CLAVE_META).last_known_revision, 7);
  assert.match(c.mensaje().textContent, /Datos restaurados correctamente/);
  assert.equal(escrituras(e).length, 0);
});
