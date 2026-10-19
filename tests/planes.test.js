/* E1: accessor de lectura del plan activo (js/planes.js).
   Correr con: node --test tests/*.test.js */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { crearEntorno, clonar } = require("./entorno");

function planes() {
  return crearEntorno({ sinSync: true }).GYMAPP.planes;
}

function datos() {
  return {
    schema_version: 2,
    usuario: { nombre: "N" },
    rutina: { dias: [
      { id: "d1", nombre: "Día 1", ejercicios: [{ id: "e1", nombre: "Press" }, { id: "e2", nombre: "Remo" }] },
      { id: "d2", nombre: "Día 2", ejercicios: [{ id: "e3", nombre: "Sentadilla" }, { id: "e2", nombre: "Remo (repetido)" }] },
      { id: "d3", nombre: "Día 3", ejercicios: [] }
    ] },
    sesiones_entrenamiento: [], registros_nutricion: [], base_alimentos: [], medidas_corporales: []
  };
}

test("schema 2 válido: diasDelPlanActivo devuelve exactamente data.rutina.dias (misma referencia y orden)", () => {
  const P = planes();
  const d = datos();
  assert.equal(P.diasDelPlanActivo(d), d.rutina.dias);
  assert.deepEqual(clonar(P.diasDelPlanActivo(d).map((x) => x.id)), ["d1", "d2", "d3"]);
});

test("rutina ausente, dias ausente, data nula → []", () => {
  const P = planes();
  [undefined, null, {}, { rutina: null }, { rutina: {} }, { rutina: { dias: null } }].forEach((d) => {
    assert.deepEqual(clonar(P.diasDelPlanActivo(d)), [], JSON.stringify(d));
    assert.deepEqual(clonar(P.ejerciciosDelPlanActivo(d)), []);
    assert.equal(P.buscarDiaActivo(d, "d1"), null);
    assert.equal(P.buscarEjercicioActivo(d, "e1"), null);
    assert.equal(P.buscarEjercicioEnDiaActivo(d, "d1", "e1"), null);
  });
});

test("buscarDiaActivo: encontrado (referencia original) / no encontrado (null)", () => {
  const P = planes();
  const d = datos();
  assert.equal(P.buscarDiaActivo(d, "d2"), d.rutina.dias[1]);
  assert.equal(P.buscarDiaActivo(d, "nada"), null);
});

test("ejerciciosDelPlanActivo: array nuevo, plano, en orden, con las referencias originales (no clona)", () => {
  const P = planes();
  const d = datos();
  const lista = P.ejerciciosDelPlanActivo(d);
  assert.deepEqual(clonar(lista.map((e) => e.id)), ["e1", "e2", "e3", "e2"]);
  assert.equal(lista[0], d.rutina.dias[0].ejercicios[0], "misma referencia");
  assert.notEqual(lista, d.rutina.dias[0].ejercicios, "array nuevo");
  lista.push({ id: "x" });
  assert.equal(d.rutina.dias[0].ejercicios.length, 2, "agregar al resultado no toca la rutina");
});

test("buscarEjercicioActivo: primero en orden de días; null si no existe; tolera días sin ejercicios", () => {
  const P = planes();
  const d = datos();
  assert.equal(P.buscarEjercicioActivo(d, "e2"), d.rutina.dias[0].ejercicios[1], "el del primer día");
  assert.equal(P.buscarEjercicioActivo(d, "e3").nombre, "Sentadilla");
  assert.equal(P.buscarEjercicioActivo(d, "nada"), null);
  delete d.rutina.dias[2].ejercicios;
  assert.equal(P.buscarEjercicioActivo(d, "nada"), null);
});

test("buscarEjercicioEnDiaActivo: solo dentro de ese día", () => {
  const P = planes();
  const d = datos();
  assert.equal(P.buscarEjercicioEnDiaActivo(d, "d2", "e2").nombre, "Remo (repetido)");
  assert.equal(P.buscarEjercicioEnDiaActivo(d, "d1", "e3"), null, "existe en otro día");
  assert.equal(P.buscarEjercicioEnDiaActivo(d, "nada", "e1"), null);
});

test("ninguna función muta el input", () => {
  const P = planes();
  const d = datos();
  const antes = JSON.stringify(d);
  P.diasDelPlanActivo(d); P.ejerciciosDelPlanActivo(d); P.buscarDiaActivo(d, "d1");
  P.buscarEjercicioActivo(d, "e3"); P.buscarEjercicioEnDiaActivo(d, "d2", "e2");
  assert.equal(JSON.stringify(d), antes);
  assert.equal(Object.isFrozen(d), false);
});

test("no lee estructuras de schema 3 ni escribe storage", () => {
  const fuente = fs.readFileSync(path.join(__dirname, "..", "js", "planes.js"), "utf8");
  const codigo = fuente.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(codigo, /rutina\.planes|rutina\[|plan_activo_id|localStorage|GYMAPP\.storage/);
  const e = crearEntorno({ sinSync: true });
  e.escribir("gymNutritionTracker", datos());
  const d = e.GYMAPP.storage.getData();
  const escrituras = e.localStorage._escrituras.length;
  e.GYMAPP.planes.ejerciciosDelPlanActivo(d);
  assert.equal(e.localStorage._escrituras.length, escrituras);
  assert.equal(e.GYMAPP.storage.getDefaultData().schema_version, 2);
});

test("lecturas directas de rutina.dias solo quedan donde están justificadas", () => {
  const dir = path.join(__dirname, "..", "js");
  const permitidos = {
    "planes.js": "accessor central",
    "rutina.js": "escrituras de la rutina dentro de updateData",
    "backupImport.js": "validación del formato del archivo de backup"
  };
  const conAcceso = fs.readdirSync(dir).filter((f) => f.endsWith(".js")).filter((f) => {
    const codigo = fs.readFileSync(path.join(dir, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    return /rutina\.dias/.test(codigo);
  });
  assert.deepEqual(conAcceso.sort(), Object.keys(permitidos).sort());
  const rutina = fs.readFileSync(path.join(dir, "rutina.js"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  rutina.split("\n").filter((l) => /rutina\.dias/.test(l)).forEach((l) => assert.doesNotMatch(l, /container\.innerHTML|template\(/, l));
});
