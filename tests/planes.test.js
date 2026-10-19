/* GYMAPP.planes (E1 lectura + E2 schema 3 y mutaciones).
   Correr con: node --test tests/*.test.js */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { crearEntorno, clonar, aV3 } = require("./entorno");

function planes() {
  return crearEntorno({ sinSync: true }).GYMAPP.planes;
}

/* Rutina schema 3 con 3 días (ejercicio e2 repetido en dos días). */
function datos() {
  return aV3({
    schema_version: 2,
    usuario: { nombre: "N" },
    rutina: { dias: [
      { id: "d1", nombre: "Día 1", ejercicios: [{ id: "e1", nombre: "Press" }, { id: "e2", nombre: "Remo" }] },
      { id: "d2", nombre: "Día 2", ejercicios: [{ id: "e3", nombre: "Sentadilla" }, { id: "e2", nombre: "Remo (repetido)" }] },
      { id: "d3", nombre: "Día 3", ejercicios: [] }
    ] },
    sesiones_entrenamiento: [], registros_nutricion: [], base_alimentos: [], medidas_corporales: []
  });
}

/* --- Lectura --- */

test("planActivo / buscarPlan: resuelven plan_activo_id dentro de rutina.planes", () => {
  const P = planes();
  const d = datos();
  assert.equal(P.planActivo(d), d.rutina.planes[0]);
  assert.equal(P.planActivo(d).plan_id, "plan-mig-d1");
  assert.equal(P.buscarPlan(d, "plan-mig-d1"), d.rutina.planes[0]);
  assert.equal(P.buscarPlan(d, "otro"), null);
  d.rutina.planes.push({ plan_id: "plan-b", dias: [{ id: "x", nombre: "X", orden: 1, ejercicios: [] }] });
  d.rutina.plan_activo_id = "plan-b";
  assert.deepEqual(clonar(P.diasDelPlanActivo(d).map((x) => x.id)), ["x"], "sigue a plan_activo_id");
});

test("diasDelPlanActivo schema 3: la misma referencia y el mismo orden", () => {
  const P = planes();
  const d = datos();
  assert.equal(P.diasDelPlanActivo(d), d.rutina.planes[0].dias);
  assert.deepEqual(clonar(P.diasDelPlanActivo(d).map((x) => x.id)), ["d1", "d2", "d3"]);
});

test("rutina/planes/plan activo ausentes o rotos → [] y null", () => {
  const P = planes();
  [undefined, null, {}, { rutina: null }, { rutina: {} }, { rutina: { planes: null } },
    { rutina: { plan_activo_id: "a", planes: [] } }, { rutina: { plan_activo_id: "a", planes: [{ plan_id: "a" }] } },
    { rutina: { dias: [{ id: "d1", ejercicios: [] }] } }].forEach((d) => {
    assert.deepEqual(clonar(P.diasDelPlanActivo(d)), [], JSON.stringify(d));
    assert.deepEqual(clonar(P.ejerciciosDelPlanActivo(d)), []);
    assert.equal(P.buscarDiaActivo(d, "d1"), null);
    assert.equal(P.buscarEjercicioActivo(d, "e1"), null);
    assert.equal(P.buscarEjercicioEnDiaActivo(d, "d1", "e1"), null);
  });
});

test("búsquedas: día, ejercicio (primero en orden) y ejercicio dentro de un día", () => {
  const P = planes();
  const d = datos();
  const dias = d.rutina.planes[0].dias;
  assert.equal(P.buscarDiaActivo(d, "d2"), dias[1]);
  assert.equal(P.buscarDiaActivo(d, "nada"), null);
  assert.equal(P.buscarEjercicioActivo(d, "e2"), dias[0].ejercicios[1], "el del primer día");
  assert.equal(P.buscarEjercicioActivo(d, "nada"), null);
  assert.equal(P.buscarEjercicioEnDiaActivo(d, "d2", "e2").nombre, "Remo (repetido)");
  assert.equal(P.buscarEjercicioEnDiaActivo(d, "d1", "e3"), null);
});

test("ejerciciosDelPlanActivo: array nuevo, plano, en orden, con las referencias originales (no clona)", () => {
  const P = planes();
  const d = datos();
  const lista = P.ejerciciosDelPlanActivo(d);
  assert.deepEqual(clonar(lista.map((e) => e.id)), ["e1", "e2", "e3", "e2"]);
  assert.equal(lista[0], d.rutina.planes[0].dias[0].ejercicios[0]);
  lista.push({ id: "x" });
  assert.equal(d.rutina.planes[0].dias[0].ejercicios.length, 2);
});

test("las lecturas no mutan el input", () => {
  const P = planes();
  const d = datos();
  const antes = JSON.stringify(d);
  P.planActivo(d); P.buscarPlan(d, "x"); P.diasDelPlanActivo(d); P.ejerciciosDelPlanActivo(d);
  P.buscarDiaActivo(d, "d1"); P.buscarEjercicioActivo(d, "e3"); P.buscarEjercicioEnDiaActivo(d, "d2", "e2");
  assert.equal(JSON.stringify(d), antes);
});

/* --- Mutaciones --- */

test("agregar día: al final del plan activo, con orden y ejercicios en formato schema 3", () => {
  const P = planes();
  const d = datos();
  const nuevo = P.agregarDiaAlPlanActivo(d, { id: "d4", nombre: "Día 4", ejercicios: [{ id: "e9", nombre: "Curl", grupo_muscular: "Bíceps", series_objetivo: 3, reps_objetivo: "12" }] });
  const dias = d.rutina.planes[0].dias;
  assert.equal(dias[3], nuevo);
  assert.equal(nuevo.orden, 4);
  assert.deepEqual(clonar(nuevo.ejercicios[0]), { id: "e9", nombre: "Curl", grupo_muscular: "Bíceps", series_objetivo: 3, reps_objetivo: "12",
    rir_objetivo: null, rpe_objetivo: null, peso_objetivo: null, pausa: null, comentarios: null, raw: null, eliminado: false, orden: 1 });
  assert.equal(d.rutina.planes.length, 1, "no crea otra fuente de verdad");
  assert.ok(!("dias" in d.rutina), "no recrea rutina.dias");
});

test("eliminar día: lo saca del plan activo y renumera orden", () => {
  const P = planes();
  const d = datos();
  P.eliminarDiaDelPlanActivo(d, "d2");
  assert.deepEqual(clonar(d.rutina.planes[0].dias.map((x) => [x.id, x.orden])), [["d1", 1], ["d3", 2]]);
  P.eliminarDiaDelPlanActivo(d, "no-existe");
  assert.equal(d.rutina.planes[0].dias.length, 2);
});

test("agregar y eliminar ejercicio en un día del plan activo", () => {
  const P = planes();
  const d = datos();
  const e = P.agregarEjercicioADiaActivo(d, "d1", { id: "e7", nombre: "", grupo_muscular: "", series_objetivo: 3, reps_objetivo: "10" });
  assert.equal(e.orden, 3);
  assert.equal(e.eliminado, false);
  assert.equal(P.agregarEjercicioADiaActivo(d, "no-existe", { id: "z" }), null);
  P.eliminarEjercicioDeDiaActivo(d, "d1", "e1");
  assert.deepEqual(clonar(d.rutina.planes[0].dias[0].ejercicios.map((x) => [x.id, x.orden])), [["e2", 1], ["e7", 2]]);
});

test("editar día/ejercicio por referencia (como rutina.js) modifica el plan activo", () => {
  const P = planes();
  const d = datos();
  P.buscarDiaActivo(d, "d1").nombre = "Pecho";
  P.buscarEjercicioEnDiaActivo(d, "d2", "e3").series_objetivo = 5;
  assert.equal(d.rutina.planes[0].dias[0].nombre, "Pecho");
  assert.equal(d.rutina.planes[0].dias[1].ejercicios[0].series_objetivo, 5);
});

test("import PDF actual: los días importados se agregan al final del plan activo (concat)", () => {
  const P = planes();
  const d = datos();
  const importados = [
    { id: "p1", nombre: "Día importado 1", ejercicios: [{ id: "p1e1", nombre: "Press", series_objetivo: 4, reps_objetivo: "10" }] },
    { id: "p2", nombre: "Día importado 2", ejercicios: [] }
  ];
  importados.forEach((dia) => P.agregarDiaAlPlanActivo(d, dia));
  assert.deepEqual(clonar(d.rutina.planes[0].dias.map((x) => [x.id, x.orden])), [["d1", 1], ["d2", 2], ["d3", 3], ["p1", 4], ["p2", 5]]);
  assert.equal(d.rutina.planes[0].dias[3].ejercicios[0].orden, 1);
  assert.equal(d.rutina.planes.length, 1);
});

test("mutar sin plan activo válido falla explícitamente (no crea estructura)", () => {
  const P = planes();
  assert.throws(() => P.agregarDiaAlPlanActivo({ rutina: { dias: [] } }, { id: "x", nombre: "x", ejercicios: [] }), /plan activo/);
});

test("mutaciones vía storage.updateData persisten en schema 3 y quedan válidas", () => {
  const e = crearEntorno({ sinSync: true });
  e.escribir("gymNutritionTracker", datos());
  const r = e.GYMAPP.storage.updateData((d) => { e.GYMAPP.planes.agregarDiaAlPlanActivo(d, { id: "d9", nombre: "Día 9", ejercicios: [] }); }, { alertaAutomatica: false });
  assert.equal(r.guardado, true);
  const g = e.leer("gymNutritionTracker");
  assert.equal(g.schema_version, 3);
  assert.equal(g.rutina.planes[0].dias[3].id, "d9");
  assert.equal(e.GYMAPP.storage.validarDatosV3(g), null);
});

/* --- Chequeo estático --- */

test("ningún código runtime lee ni escribe rutina.dias salvo migración y backups viejos", () => {
  const dir = path.join(__dirname, "..", "js");
  const conAcceso = fs.readdirSync(dir).filter((f) => f.endsWith(".js")).filter((f) => {
    const codigo = fs.readFileSync(path.join(dir, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    return /rutina\.dias/.test(codigo);
  });
  assert.deepEqual(conAcceso.sort(), ["backupImport.js", "storage.js"], "storage: migración 2→3; backupImport: validar archivos schema 0/1/2");
  ["planes.js", "rutina.js", "progreso.js", "entrenamiento.js", "dashboard.js", "rutinasHistoricas.js", "sync.js"].forEach((f) => {
    const codigo = fs.readFileSync(path.join(dir, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    assert.doesNotMatch(codigo, /rutina\.dias/, f);
  });
});
