/* PROG-04.2: RIR real por ejercicio (última serie efectiva). Campo
   ejercicios_realizados[].rir_real (0-4, 4 = "4+", opcional), compatible con
   schema 3; reglas de PROG-04.1 con RIR; backup/import. El registro en
   Entrenar (elegir, guardar, editar, 390/320 px) está en
   tests/e2e/rir-real.e2e.js.
   Correr con: node --test tests/*.test.js */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { crearEntorno, clonar } = require("./entorno");
const P = require("./fixtures/historial-progresion");

const CLAVE = "gymNutritionTracker";
const RAIZ = path.join(__dirname, "..");
const MODULOS = ["js/actividades.js", "js/progreso.js", "js/recomendacionCarga.js", "js/recomendacionProximaSesion.js", "js/backupImport.js"];
const serie = P.serie;

function entorno(datos) {
  const e = crearEntorno({ ahora: P.HOY + "T12:00:00", sinSync: true, modulos: MODULOS });
  if (datos) e.escribir(CLAVE, datos);
  return e;
}
function rec(datos, nombre) {
  const e = entorno(datos);
  const data = e.GYMAPP.storage.getData();
  const C = e.GYMAPP.recomendacionCarga;
  const plan = e.GYMAPP.planes.planActivo(data);
  const ej = plan.dias.flatMap((d) => d.ejercicios).find((x) => !nombre || x.nombre === nombre);
  return clonar(e.GYMAPP.proximaSesion.recomendar(data, ej, { hoy: P.HOY, contexto: C.contextoPlan(plan), pesoCorporal: C.pesoCorporalActual(data) }));
}
/* registros: [{ series, rir?, rpe? }] */
const uno = (ej, registros, opciones) => rec(P.armar([Object.assign({ series_objetivo: 4, reps_objetivo: "10-12" }, ej, { registros })], opciones));
const MANC = { nombre: "PRESS BANCA C/MANCUERNAS", rir_objetivo: "2" };
const b = (reps, kg) => serie(kg == null ? 25 : kg, reps);

/* --- Campo y schema 3 --- */

test("1-4. rir_real: 0, 2 y 4 (= 4+) se guardan como número; sin elegir, la clave no existe", () => {
  const d = P.armar([Object.assign({ series_objetivo: 4, reps_objetivo: "10-12", registros: [{ series: b([12, 12, 12, 12]), rir: 0 }, { series: b([12, 12, 12, 12]), rir: 2 }, { series: b([12, 12, 12, 12]), rir: 4 }, { series: b([12, 12, 12, 12]) }] }, MANC)]);
  const e = entorno(d);
  const s = e.GYMAPP.storage.getData().sesiones_entrenamiento.map((x) => x.ejercicios_realizados[0]);
  assert.deepEqual(clonar(s.slice(0, 3).map((er) => er.rir_real)), [0, 2, 4]);
  assert.ok(s.slice(0, 3).every((er) => typeof er.rir_real === "number"));
  assert.equal("rir_real" in s[3], false, "opcional: sin RIR no se agrega nada");
  assert.equal(e.GYMAPP.storage.validarDatosV3(e.GYMAPP.storage.getData()), null, "válido en schema 3");
  assert.equal(e.leer(CLAVE).schema_version, 3);
});

test("5. editar/reasignar conserva rir_real (planes copia todas las claves del ejercicio)", () => {
  const e = entorno();
  const original = { id: "s", plan_id: "p", ejercicios_realizados: [{ ejercicio_id: "e1", series: b([10]), rir_real: 2, prescripcion_snapshot: { nombre: "X" } }] };
  const editada = { id: "s", ejercicios_realizados: [{ ejercicio_id: "e1", series: b([11]), rir_real: 3 }] };
  const r = clonar(e.GYMAPP.planes.conservarVinculoPlan(original, editada));
  assert.equal(r.plan_id, "p");
  assert.equal(r.ejercicios_realizados[0].rir_real, 3);
  assert.deepEqual(r.ejercicios_realizados[0].prescripcion_snapshot, { nombre: "X" }, "snapshot conservado");
});

test("6. sesiones viejas sin rir_real: misma recomendación y explicación de siempre", () => {
  const r = uno(MANC, [{ series: b([11, 11, 10, 10]) }, { series: b([12, 12, 11, 11]) }, { series: b([12, 12, 12, 12]) }]);
  assert.equal(r.accion, "subir");
  assert.equal(r.titulo, "Subí a 27,5 kg por mancuerna");
  assert.equal(r.confianza, "alta");
  assert.ok(r.porQue.some((l) => /No registramos el esfuerzo real por ejercicio/.test(l)));
  assert.ok(!r.porQue.some((l) => /Último RIR registrado/.test(l)));
});

test("7. backup/import acepta rir_real 0-4 o null y rechaza strings u otros valores", () => {
  const e = entorno();
  const B = e.GYMAPP.backupImport;
  const con = (v) => {
    const d = P.armar([Object.assign({ series_objetivo: 4, reps_objetivo: "10-12", registros: [{ series: b([12]) }] }, MANC)]);
    d.usuario = { nombre: "Ejemplo", actividades: [{ tipo: "gimnasio", meta_semanal: 4 }] };
    if (v !== undefined) d.sesiones_entrenamiento[0].ejercicios_realizados[0].rir_real = v;
    return B.prepararImportacionBackup(JSON.stringify(d));
  };
  for (const v of [undefined, null, 0, 2, 4]) assert.equal(con(v).ok, true, "acepta " + v);
  for (const v of ["2", 5, -1, 1.5]) assert.equal(con(v).ok, false, "rechaza " + JSON.stringify(v));
});

/* --- Reglas de PROG-04.1 con RIR --- */

test("8. tope de reps + RIR >= objetivo → subir (sin esperar una segunda confirmación)", () => {
  const r = uno(MANC, [{ series: b([11, 11, 11, 11]) }, { series: b([12, 12, 12, 12]), rir: 2 }]);
  assert.equal(r.accion, "subir");
  assert.equal(r.motivo, "tope_con_rir");
  assert.equal(r.titulo, "Subí a 27,5 kg por mancuerna");
  assert.ok(r.porQue.some((l) => /Último RIR registrado: 2\. Objetivo del plan: 2\./.test(l)), r.porQue);
  /* Caso A: RIR 3 con objetivo 2 → también subir. Prescripción fija (que sin RIR pide confirmar). */
  assert.equal(uno({ nombre: "PRESS INCLINADO EN SMITH", reps_objetivo: "8", rir_objetivo: "2" }, [{ series: serie(40, [7, 7, 7, 7]) }, { series: serie(40, [8, 8, 8, 8]), rir: 3 }]).accion, "subir");
});

test("9. tope de reps + RIR 0 con objetivo 2 → consolidar, nunca subir", () => {
  const r = uno(MANC, [{ series: b([12, 12, 12, 12]), rir: 2 }, { series: b([12, 12, 12, 12]), rir: 0 }]);
  assert.equal(r.accion, "consolidar");
  assert.equal(r.motivo, "tope_rir_bajo");
  assert.equal(r.titulo, "Mantené 25 kg por mancuerna");
  assert.ok(r.porQue.some((l) => /Completaste el máximo de reps, pero con RIR 0 \(objetivo 2\); conviene consolidar antes de subir\./.test(l)), r.porQue);
  /* Aunque sin RIR se hubiera confirmado el tope dos veces. */
  assert.equal(uno(MANC, [{ series: b([12, 12, 12, 12]) }, { series: b([12, 12, 12, 12]), rir: 1 }]).accion, "consolidar");
});

test("10. reps medias + RIR alto → sumar reps hasta el tope (Caso D)", () => {
  const r = uno(MANC, [{ series: b([10, 10, 10, 10]) }, { series: b([10, 10, 10, 10]), rir: 3 }]);
  assert.equal(r.accion, "mantener_reps");
  assert.equal(r.motivo, "en_rango_margen");
  assert.equal(r.objetivo, "Buscá 12 reps");
  assert.ok(r.porQue.some((l) => /Te quedaban 3 reps en reserva \(objetivo 2\): hay margen para sumar reps/.test(l)));
  /* Caso B (RIR = objetivo, sin tope): progresión normal de reps. */
  assert.equal(uno(MANC, [{ series: b([10, 10, 10, 10]) }, { series: b([10, 10, 10, 10]), rir: 2 }]).objetivo, "Buscá 11-12 reps");
});

test("11. RIR real ≠ RPE de sesión: RIR OK con RPE de sesión alto sube; sin RIR, el RPE alto frena", () => {
  const conRir = uno(MANC, [{ series: b([11, 11, 11, 11]), rpe: 9.5 }, { series: b([12, 12, 12, 12]), rpe: 9.5, rir: 2 }]);
  assert.equal(conRir.accion, "subir", "el RIR del ejercicio manda sobre el RPE global");
  const sinRir = uno(MANC, [{ series: b([12, 12, 12, 12]), rpe: 9.5 }, { series: b([12, 12, 12, 12]), rpe: 9.5 }]);
  assert.equal(sinRir.motivo, "tope_con_fatiga");
  /* Y un RPE de sesión bajo nunca tapa un RIR 0. */
  assert.equal(uno(MANC, [{ series: b([12, 12, 12, 12]), rpe: 6 }, { series: b([12, 12, 12, 12]), rpe: 6, rir: 0 }]).accion, "consolidar");
  const src = fs.readFileSync(path.join(RAIZ, "js/recomendacionProximaSesion.js"), "utf8");
  assert.doesNotMatch(src, /rirReal[^;\n]*rpe|rpeSesion[^;\n]*rir_real/i, "no se mezclan en una misma señal");
});

test("12. confianza: sube un nivel con RIR; sin RIR, igual que antes", () => {
  const sinRir = uno(MANC, [{ series: b([10, 10, 10, 10]) }, { series: b([11, 10, 10, 10]) }]);
  const conRir = uno(MANC, [{ series: b([10, 10, 10, 10]) }, { series: b([11, 10, 10, 10]), rir: 2 }]);
  assert.equal(sinRir.confianza, "media");
  assert.equal(conRir.confianza, "alta");
  assert.equal(uno(MANC, [{ series: b([10, 10, 10, 10]) }]).confianza, "baja");
  assert.equal(uno(MANC, [{ series: b([10, 10, 10, 10]), rir: 2 }]).confianza, "media", "una sola sesión: como mucho media");
});

test("primera sesión con RIR: calibración (sin tendencia); sube solo con margen claro", () => {
  const margen = uno(MANC, [{ series: b([12, 12, 12, 12]), rir: 3 }]);
  assert.equal(margen.accion, "subir");
  assert.equal(margen.motivo, "calibracion_tope_rir");
  assert.equal(margen.confianza, "media");
  assert.match(margen.porQue[0], /Primera sesión registrada/);
  assert.equal(uno(MANC, [{ series: b([12, 12, 12, 12]), rir: 2 }]).accion, "consolidar", "RIR igual al objetivo: confirmar una vez");
  assert.equal(uno(MANC, [{ series: b([12, 12, 12, 12]), rir: 0 }]).motivo, "tope_rir_bajo");
});

test("14. peso corporal: +7,5 kg de lastre, 8 reps, RIR 2 → señal válida para progresar", () => {
  const r = uno({ nombre: "DOMINADAS TOMA NEUTRA", reps_objetivo: "6-8", rir_objetivo: "2" },
    [{ series: serie(82.5, [7, 7, 7, 7]) }, { series: serie(82.5, [8, 8, 8, 8]), rir: 2 }], { pesoCorporal: 75 });
  assert.equal(r.accion, "subir");
  assert.equal(r.titulo, "Subí a +10 kg de lastre");
});

test("13. movilidad, activación e isométricos: sin RIR (clasificación E6.5)", () => {
  const e = entorno();
  const C = e.GYMAPP.recomendacionCarga;
  const admite = (ej, ctx) => { const c = C.clasificarEjercicio(ej, ctx); return c.tipo !== "movilidad" && !c.tiempo; };
  assert.equal(admite({ nombre: "ROTACION TORACICA EN CUADRUPEDIA CON BRAZOS EXTENDIDOS", series_objetivo: 2, reps_objetivo: "8" }), false);
  assert.equal(admite({ nombre: "DOMINADA ISOMETRICA", series_objetivo: 3, reps_objetivo: "15-30''" }), false);
  assert.equal(admite({ nombre: "PRESS BANCA C/MANCUERNAS", series_objetivo: 4, reps_objetivo: "10-12" }), true);
  assert.equal(admite({ nombre: "DOMINADAS TOMA NEUTRA", series_objetivo: 4, reps_objetivo: "6-8" }), true, "peso corporal sí");
  const ent = fs.readFileSync(path.join(RAIZ, "js/entrenamiento.js"), "utf8");
  assert.match(ent, /function admiteRirReal\(ejercicio, contexto\)[\s\S]*?clasificarEjercicio\(ejercicio, contexto\)[\s\S]*?c\.tipo !== "movilidad" && !c\.tiempo/);
});

test("15. no modifica datos históricos: recomendar con y sin RIR no escribe nada", () => {
  const d = P.armar([Object.assign({ series_objetivo: 4, reps_objetivo: "10-12", registros: [{ series: b([12, 12, 12, 12]) }, { series: b([12, 12, 12, 12]), rir: 0 }] }, MANC)]);
  const e = entorno(d);
  const antes = JSON.stringify(e.leer(CLAVE));
  const data = e.GYMAPP.storage.getData();
  const ej = e.GYMAPP.planes.planActivo(data).dias[0].ejercicios[0];
  e.GYMAPP.proximaSesion.recomendar(data, ej, { hoy: P.HOY });
  assert.equal(JSON.stringify(e.leer(CLAVE)), antes);
  /* Las sesiones sin RIR siguen sin la clave. */
  assert.equal("rir_real" in e.leer(CLAVE).sesiones_entrenamiento[0].ejercicios_realizados[0], false);
});

/* --- RIR objetivo en RANGO (rir_min / rir_max) --- */

const F = require("./fixtures/historial-cargas");

test("rango 1-2: real 0 debajo · 1 dentro · 2 dentro · 3 encima", () => {
  const S = entorno().GYMAPP.proximaSesion;
  const rango = clonar(S.rangoRirObjetivo({ rir_objetivo: "1-2", rpe_objetivo: 8 }));
  assert.deepEqual(rango, { min: 1, max: 2 }, "no se aplasta a 1,5");
  assert.deepEqual([0, 1, 2, 3, 4].map((v) => S.compararRirReal(v, rango)), ["debajo", "dentro", "dentro", "encima", "encima"]);
});

test("rango 2-3: real 1 debajo · 2 dentro · 3 dentro · 4+ encima", () => {
  const S = entorno().GYMAPP.proximaSesion;
  const rango = clonar(S.rangoRirObjetivo({ rir_objetivo: "2-3" }));
  assert.deepEqual(rango, { min: 2, max: 3 });
  assert.deepEqual([1, 2, 3, 4].map((v) => S.compararRirReal(v, rango)), ["debajo", "dentro", "dentro", "encima"]);
});

test("rango: número, RPE objetivo del ejercicio como respaldo y sin objetivo", () => {
  const S = entorno().GYMAPP.proximaSesion;
  assert.deepEqual(clonar(S.rangoRirObjetivo({ rir_objetivo: 2 })), { min: 2, max: 2 });
  assert.deepEqual(clonar(S.rangoRirObjetivo({ rir_objetivo: null, rpe_objetivo: "7-8" })), { min: 2, max: 3 });
  assert.deepEqual(clonar(S.rangoRirObjetivo({ rir_objetivo: null, rpe_objetivo: 9 })), { min: 1, max: 1 });
  assert.equal(S.rangoRirObjetivo({ rir_objetivo: null, rpe_objetivo: null }), null);
  assert.equal(S.compararRirReal(0, null), "debajo");
  assert.equal(S.compararRirReal(1, null), "dentro");
  /* E6.5 sigue con su punto medio (no se rompe). */
  assert.equal(entorno().GYMAPP.recomendacionCarga.rirDePrescripcion({ rir_objetivo: "1-2" }), 1.5);
});

test("rango en decisiones (2+ exposiciones): 1-2 con RIR 1 sube; con 0 consolida; 2-3 con 1 consolida", () => {
  const SMITH12 = { nombre: "PRESS INCLINADO EN SMITH", reps_objetivo: "8", rir_objetivo: "1-2" };
  const smith = (rir) => uno(SMITH12, [{ series: serie(40, [8, 8, 7, 7]) }, { series: serie(40, [8, 8, 8, 8]), rir }]);
  assert.equal(smith(1).accion, "subir", "1 está dentro de 1-2 (antes, contra 1,5, consolidaba)");
  assert.equal(smith(2).accion, "subir");
  assert.equal(smith(0).accion, "consolidar");
  assert.ok(smith(0).porQue.some((l) => /con RIR 0 \(objetivo 1-2\)/.test(l)));
  assert.ok(smith(1).porQue.some((l) => /Último RIR registrado: 1\. Objetivo del plan: 1-2\./.test(l)));
  const TRI = { nombre: "TRICEPS EN POLEA BARRA PLANA", series_objetivo: 3, reps_objetivo: "10-12", rir_objetivo: "2-3" };
  const tri = (rir) => uno(TRI, [{ series: serie(25, [11, 11, 11]) }, { series: serie(25, [12, 12, 12]), rir }]);
  assert.equal(tri(1).accion, "consolidar");
  assert.equal(tri(2).accion, "subir");
  assert.equal(tri(3).accion, "subir");
  assert.equal(tri(4).accion, "subir");
  /* Margen (encima del rango) a mitad del rango de reps → sumar reps. */
  const medio = uno(TRI, [{ series: serie(25, [10, 10, 10]) }, { series: serie(25, [10, 10, 10]), rir: 4 }]);
  assert.equal(medio.motivo, "en_rango_margen");
  assert.ok(medio.porQue.some((l) => /objetivo 2-3/.test(l)));
  assert.equal(uno(TRI, [{ series: serie(25, [10, 10, 10]) }, { series: serie(25, [10, 10, 10]), rir: 3 }]).motivo, "en_rango", "3 está dentro de 2-3: sin 'margen'");
});

/* --- Primera exposición (regla definitiva) --- */

test("primera exposición: A debajo → consolidar; B dentro → mantener y confirmar; C encima → subida chica", () => {
  const A = uno(MANC, [{ series: b([12, 12, 12, 12]), rir: 0 }]);
  assert.deepEqual([A.accion, A.motivo, A.titulo], ["consolidar", "tope_rir_bajo", "Mantené 25 kg por mancuerna"]);
  const B = uno(MANC, [{ series: b([12, 12, 12, 12]), rir: 2 }]);
  assert.deepEqual([B.accion, B.motivo, B.titulo], ["consolidar", "calibracion_tope_rir_dentro", "Mantené 25 kg por mancuerna"]);
  assert.match(B.porQue[0], /Confirmalo una vez más con la misma carga antes de subir/);
  const C = uno(MANC, [{ series: b([12, 12, 12, 12]), rir: 4 }]);
  assert.deepEqual([C.accion, C.motivo, C.titulo], ["subir", "calibracion_tope_rir", "Subí a 27,5 kg por mancuerna"]);
  assert.equal(C.confianza, "media", "una sola sesión: como mucho media");
  /* Con rango 1-2: RIR 2 es "dentro" (confirmar); RIR 3 ya es "encima". */
  const S12 = { nombre: "PRESS INCLINADO EN SMITH", reps_objetivo: "8", rir_objetivo: "1-2" };
  assert.equal(uno(S12, [{ series: serie(40, [8, 8, 8, 8]), rir: 2 }]).accion, "consolidar");
  assert.equal(uno(S12, [{ series: serie(40, [8, 8, 8, 8]), rir: 3 }]).accion, "subir");
  /* Desde la segunda exposición, lógica normal: tope + RIR dentro → subir. */
  assert.equal(uno(MANC, [{ series: b([11, 11, 11, 11]) }, { series: b([12, 12, 12, 12]), rir: 2 }]).accion, "subir");
});

/* --- Plan N.º 4 sanitizado (fixture): interpretación del objetivo --- */

test("Plan N.º 4: RIR 1-2, 2, 2-3 y 1 se interpretan como rango, sin nada hardcodeado", () => {
  const S = entorno().GYMAPP.proximaSesion;
  const ejercicios = F.PLAN_N4.dias.flatMap((d) => d.ejercicios);
  const por = (n) => ejercicios.find((e) => e.nombre === n);
  const casos = [
    ["PRESS INCLINADO EN SMITH", "1-2", { min: 1, max: 2 }],
    ["DOMINADAS TOMA NEUTRA", "1-2", { min: 1, max: 2 }],
    ["PRESS BANCA C/MANCUERNAS", 2, { min: 2, max: 2 }],
    ["TRICEPS EN POLEA BARRA PLANA", "2-3", { min: 2, max: 3 }],
    ["SIT UPS", 1, { min: 1, max: 1 }]
  ];
  casos.forEach(([n, esperadoPlan, rango]) => {
    assert.deepEqual(clonar(por(n).rir_objetivo), esperadoPlan, n + " en el fixture");
    assert.deepEqual(clonar(S.rangoRirObjetivo(por(n))), rango, n);
  });
  /* Todos los objetivos del plan se leen sin perder información. */
  ejercicios.filter((e) => e.rir_objetivo != null).forEach((e) => {
    const r = S.rangoRirObjetivo(e);
    const txt = String(e.rir_objetivo);
    assert.equal(r.min, Number(txt.split("-")[0]), e.nombre);
    assert.equal(r.max, Number(txt.split("-").pop()), e.nombre);
  });
  /* Recomendación con ejercicios reales del plan (copiados del fixture). */
  const conPlan = (n, registros) => uno(Object.assign({}, por(n)), registros, { pesoCorporal: 75 });
  assert.equal(conPlan("PRESS INCLINADO EN SMITH", [{ series: serie(40, [8, 8, 7, 7]) }, { series: serie(40, [8, 8, 8, 8]), rir: 1 }]).accion, "subir");
  assert.equal(conPlan("DOMINADAS TOMA NEUTRA", [{ series: serie(82.5, [7, 7, 7, 7]) }, { series: serie(82.5, [8, 8, 8, 8]), rir: 0 }]).accion, "consolidar");
  assert.equal(conPlan("TRICEPS EN POLEA BARRA PLANA", [{ series: serie(25, [11, 11, 11]) }, { series: serie(25, [12, 12, 12]), rir: 1 }]).accion, "consolidar");
  const src = fs.readFileSync(path.join(RAIZ, "js/recomendacionProximaSesion.js"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(src, /PRESS INCLINADO|DOMINADAS TOMA|TRICEPS EN POLEA|SIT UPS/i, "ningún ejercicio del plan escrito en el motor");
});
