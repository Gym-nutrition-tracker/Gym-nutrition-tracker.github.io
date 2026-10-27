/* Pesos decimales: "42,5" y "42.5" se aceptan y se guardan como número
   42.5, sin redondear; la presentación usa coma y no agrega ceros. El ciclo
   completo en la UI (crear → guardar → editar → guardar, 390/320 px) está en
   tests/e2e/decimales-peso.e2e.js.
   Correr con: node --test tests/*.test.js */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { crearEntorno, clonar } = require("./entorno");
const P = require("./fixtures/historial-progresion");

const CLAVE = "gymNutritionTracker";
const MODULOS = ["js/actividades.js", "js/progreso.js", "js/recomendacionCarga.js", "js/recomendacionProximaSesion.js"];
const leerJs = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

function entorno(datos) {
  const e = crearEntorno({ ahora: P.HOY + "T12:00:00", sinSync: true, modulos: MODULOS });
  if (datos) e.escribir(CLAVE, datos);
  return e;
}
const U = () => entorno().GYMAPP.util;

test("1-2. '42.5' y '42,5' se aceptan → 42.5", () => {
  const u = U();
  assert.equal(u.parsearDecimal("42.5"), 42.5);
  assert.equal(u.parsearDecimal("42,5"), 42.5);
  assert.equal(u.parsearDecimal(" 42,5 "), 42.5);
});

test("3-4. '7.5' y '7,5' → número 7.5 (no string)", () => {
  const u = U();
  for (const v of ["7.5", "7,5"]) {
    assert.equal(typeof u.parsearDecimal(v), "number");
    assert.equal(u.parsearDecimal(v), 7.5);
  }
  assert.equal(u.parsearDecimal("7"), 7);
});

test("5. precisión: 0,25 / 0,5 / 0,75 / 1,25 / 2,5 / 12,5 / 42,5 sin redondeo", () => {
  const u = U();
  assert.deepEqual(["0,25", "0.5", "0,75", "1,25", "2,5", "12,5", "42,5", "27.5", "82,5"].map(u.parsearDecimal), [0.25, 0.5, 0.75, 1.25, 2.5, 12.5, 42.5, 27.5, 82.5]);
});

test("validación: texto, negativos, vacío y dos separadores → NaN", () => {
  const u = U();
  for (const v of ["abc", "-5", "", "  ", "1,2,3", "4.2.1", "4 2", "42kg", "1e3"]) assert.ok(Number.isNaN(u.parsearDecimal(v)), JSON.stringify(v));
  assert.equal(u.parsearDecimal("0"), 0);
});

test("7-8. presentación: 25 → '25' (no '25,0'); 42.5 → '42,5' (no 43)", () => {
  const u = U();
  assert.equal(u.formatearDecimal(25), "25");
  assert.equal(u.formatearDecimal(42.5), "42,5");
  assert.equal(u.formatearDecimal(0.25), "0,25");
  assert.equal(u.formatearDecimal(82.5), "82,5");
  /* Ida y vuelta: lo que muestra la edición vuelve al mismo número. */
  for (const n of [0.25, 7.5, 25, 27.5, 42.5, 82.5]) assert.equal(u.parsearDecimal(u.formatearDecimal(n)), n);
});

test("8. Progreso no redondea cargas: 'Última referencia' y 'Peso máximo' con 42,5", () => {
  const e = entorno();
  const Pg = e.GYMAPP.progreso;
  assert.equal(Pg.formatearUltimaReferenciaEjercicio({ series: P.serie(42.5, [8, 7]), pesoMaximo: 42.5 }), "42,5 kg · 8/7");
  const filas = Pg.filasVolumenEjercicio({ cantidadSesiones: 1, volumenTotal: 340, pesoMaximo: 42.5, repsTotales: 8, series: 1 });
  assert.ok(JSON.stringify(filas).includes("42,5 kg") && !JSON.stringify(filas).includes("43 kg"), JSON.stringify(filas));
});

test("9. sugerencia PROG-04.1 de 27,5 kg: lo que se muestra se registra exacto", () => {
  const datos = P.armar([Object.assign({}, P.EJEMPLOS[0])]);
  const e = entorno(datos);
  const data = e.GYMAPP.storage.getData();
  const ej = e.GYMAPP.planes.planActivo(data).dias[0].ejercicios[0];
  const rec = e.GYMAPP.proximaSesion.recomendar(data, ej, { hoy: P.HOY });
  assert.equal(rec.titulo, "Subí a 27,5 kg por mancuerna");
  const escrito = /(\d+(?:,\d+)?) kg/.exec(rec.titulo)[1];
  assert.equal(e.GYMAPP.util.parsearDecimal(escrito), 27.5);
});

test("10. lastre +7,5 kg: peso corporal 75 + 7,5 → carga total 82.5 exacta", () => {
  const u = U();
  assert.equal(75 + u.parsearDecimal("7,5"), 82.5);
  assert.equal(u.parsearDecimal("82,5"), 82.5);
});

test("11-12. parsear/formatear no tocan datos: historial y schema_version intactos", () => {
  const datos = P.armar(P.EJEMPLOS);
  const e = entorno(datos);
  const antes = JSON.stringify(e.leer(CLAVE));
  const data = e.GYMAPP.storage.getData();
  data.sesiones_entrenamiento.forEach((s) => s.ejercicios_realizados.forEach((er) => er.series.forEach((x) => e.GYMAPP.util.formatearDecimal(x.peso_kg))));
  assert.equal(JSON.stringify(e.leer(CLAVE)), antes);
  assert.equal(e.leer(CLAVE).schema_version, 3);
});

test("inputs de peso: texto con teclado decimal (type=number pierde la coma)", () => {
  const ent = leerJs("js/entrenamiento.js");
  assert.match(ent, /<input type="text" inputmode="decimal" autocomplete="off" class="input-serie-peso"/);
  assert.doesNotMatch(ent, /type="number"[^>]*input-serie-peso/);
  assert.match(ent, /GYMAPP\.util\.parsearDecimal\(s\.peso_kg\)/);
  assert.doesNotMatch(ent, /parseFloat\(s\.peso_kg\)/);
  const dash = leerJs("js/dashboard.js");
  assert.match(dash, /type="text" id="input-peso-hoy" inputmode="decimal"/);
  assert.match(dash, /parsearDecimal\(pesoInput\.value\)/);
  const onb = leerJs("js/onboarding.js");
  assert.match(onb, /campoTexto\("peso_kg", "Peso \(kg\)", "text", true, \{ inputmode: "decimal"/);
  assert.match(onb, /peso_kg: GYMAPP\.util\.parsearDecimal\(fd\.get\("peso_kg"\)\)/);
});

