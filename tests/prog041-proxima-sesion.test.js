/* PROG-04.1: recomendación de la próxima sesión por ejercicio. Doble
   progresión, prescripción fija, caídas, descarga, peso corporal, RIR/RPE
   objetivo vs RPE de sesión, identidad de ejercicio, confianza y que nada
   se escriba. La UI está en tests/e2e/proxima-sesion.e2e.js.
   Correr con: node --test tests/*.test.js */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { crearEntorno, clonar } = require("./entorno");
const F = require("./fixtures/historial-cargas");
const P = require("./fixtures/historial-progresion");

const CLAVE = "gymNutritionTracker";
const MODULOS = ["js/actividades.js", "js/progreso.js", "js/recomendacionCarga.js", "js/recomendacionProximaSesion.js"];
const serie = P.serie;

function entorno(datos) {
  const e = crearEntorno({ ahora: P.HOY + "T12:00:00", sinSync: true, modulos: MODULOS });
  if (datos) e.escribir(CLAVE, datos);
  return e;
}

/* Recomendación del ejercicio `nombre` (o el primero) del plan activo. */
function rec(datos, nombre) {
  const e = entorno(datos);
  const data = e.GYMAPP.storage.getData();
  const C = e.GYMAPP.recomendacionCarga;
  const plan = e.GYMAPP.planes.planActivo(data);
  const ej = plan.dias.flatMap((d) => d.ejercicios).find((x) => !nombre || x.nombre === nombre);
  return clonar(e.GYMAPP.proximaSesion.recomendar(data, ej, { hoy: P.HOY, contexto: C.contextoPlan(plan), pesoCorporal: C.pesoCorporalActual(data) }));
}

/* Un ejercicio con sus registros (series por sesión, de la más vieja a la más nueva). */
const uno = (ej, registros, opciones) => rec(P.armar([Object.assign({ series_objetivo: 4, reps_objetivo: "10-12" }, ej, {
  registros: registros.map((r) => (Array.isArray(r) ? { series: r } : r))
})], opciones));
const banca = (reps, kg) => serie(kg == null ? 25 : kg, reps);
const MANC = { nombre: "PRESS BANCA C/MANCUERNAS", rir_objetivo: "2" };

/* --- Doble progresión (4x10-12) --- */

test("10-12 incompleto: 10/10/10/10 → mantener la carga y buscar más reps", () => {
  const r = uno(MANC, [banca([10, 10, 10, 10]), banca([10, 10, 10, 10]), banca([10, 10, 10, 10])].slice(0, 2));
  assert.equal(r.accion, "mantener_reps");
  assert.equal(r.estado, "Progresar");
  assert.equal(r.titulo, "Mantené 25 kg por mancuerna");
  assert.match(r.objetivo, /^Buscá 11-12 reps$/);
});

test("10-12 casi: 11/11/10/10 → mantener (sin series idénticas exigidas)", () => {
  const r = uno(MANC, [banca([10, 10, 10, 10]), banca([11, 11, 10, 10])]);
  assert.equal(r.accion, "mantener_reps");
  assert.equal(r.titulo, "Mantené 25 kg por mancuerna");
});

test("10-12 completo: 12/12/12/12 confirmado → subir 25 → 27,5 kg por mancuerna (no 30)", () => {
  const r = uno(MANC, [banca([11, 11, 10, 10]), banca([12, 12, 11, 11]), banca([12, 12, 12, 12])]);
  assert.equal(r.accion, "subir");
  assert.equal(r.titulo, "Subí a 27,5 kg por mancuerna");
  assert.equal(r.objetivo, "Objetivo: 10-12 reps");
  assert.equal(r.carga.kg, 27.5);
  assert.equal(r.confianza, "alta");
});

test("tope sin exigir series idénticas: 12/12/12/11 cuenta, 12/12/11/11 no", () => {
  assert.equal(uno(MANC, [banca([11, 11, 11, 11]), banca([12, 12, 12, 11])]).accion, "subir");
  assert.equal(uno(MANC, [banca([11, 11, 11, 11]), banca([12, 12, 11, 11])]).accion, "mantener_reps");
});

test("después de subir: 10/9/8/8 → consolidar con condición; muy debajo → volver a la carga anterior", () => {
  const r = uno(MANC, [banca([12, 12, 12, 12]), banca([10, 9, 8, 8], 27.5)]);
  assert.equal(r.accion, "consolidar");
  assert.equal(r.titulo, "Mantené 27,5 kg por mancuerna");
  assert.ok(r.porQue.some((l) => /volvé a la carga anterior/.test(l)), r.porQue);
  const r2 = uno(MANC, [banca([12, 12, 12, 12]), banca([8, 7, 6, 6], 27.5)]);
  assert.equal(r2.accion, "bajar");
  assert.equal(r2.titulo, "Bajá a 25 kg por mancuerna");
  /* Recién subida y dentro del rango: sumar reps con el peso nuevo. */
  assert.equal(uno(MANC, [banca([12, 12, 12, 12]), banca([10, 10, 10, 10], 27.5)]).accion, "mantener_reps");
});

/* --- Prescripción fija (4x8) --- */

test("prescripción fija 4x8: cumplida dos veces → subida chica; solo una vez → mantener; caída → consolidar", () => {
  const ej = { nombre: "PRESS INCLINADO EN SMITH", reps_objetivo: "8", rir_objetivo: "1-2" };
  const subir = uno(ej, [serie(40, [8, 8, 8, 8]), serie(40, [8, 8, 8, 8])]);
  assert.equal(subir.accion, "subir");
  assert.equal(subir.titulo, "Subí a 42,5 kg");
  const una = uno(ej, [serie(40, [8, 8, 7, 7]), serie(40, [8, 8, 8, 8])]);
  assert.equal(una.accion, "consolidar");
  assert.equal(una.motivo, "tope_sin_confirmar");
  const caida = uno(ej, [serie(40, [8, 8, 8, 8]), serie(40, [8, 7, 6, 6])]);
  assert.equal(caida.accion, "consolidar");
  assert.equal(caida.motivo, "caida_aislada");
});

/* --- Cantidad de sesiones y tendencia --- */

test("1 sesión: calibración, confianza baja, sin tendencia", () => {
  const r = uno(MANC, [banca([10, 10, 10, 10])]);
  assert.equal(r.accion, "mantener_reps");
  assert.equal(r.motivo, "calibracion");
  assert.equal(r.confianza, "baja");
  assert.equal(r.exposiciones, 1);
  /* Tope en la primera: no sube sin confirmar. */
  assert.equal(uno(MANC, [banca([12, 12, 12, 12])]).accion, "consolidar");
});

test("2 sesiones → confianza media; 3+ consistentes y recientes → alta", () => {
  assert.equal(uno(MANC, [banca([10, 10, 10, 10]), banca([11, 10, 10, 10])]).confianza, "media");
  assert.equal(uno(MANC, [banca([10, 10, 10, 10]), banca([11, 10, 10, 10]), banca([11, 11, 10, 10])]).confianza, "alta");
  /* Historial viejo (más de 28 días): retomar, confianza media. */
  const viejo = uno(MANC, [banca([11, 11, 11, 11]), banca([12, 12, 12, 12]), banca([12, 12, 12, 12])], { ultimaHace: 40 });
  assert.equal(viejo.accion, "consolidar");
  assert.equal(viejo.motivo, "pausa_larga");
  assert.equal(viejo.confianza, "media");
});

test("tendencia positiva sostenida → sigue progresando (sumar reps hasta el tope)", () => {
  const r = uno(MANC, [banca([10, 10, 10, 10]), banca([11, 10, 10, 10]), banca([11, 11, 11, 10])]);
  assert.equal(r.accion, "mantener_reps");
  assert.equal(r.objetivo, "Buscá 11-12 reps");
});

test("estancamiento: 3 sesiones iguales sin tope → consolidar", () => {
  const r = uno(MANC, [banca([10, 10, 10, 10]), banca([10, 10, 10, 10]), banca([10, 10, 10, 10])]);
  assert.equal(r.accion, "consolidar");
  assert.equal(r.motivo, "estancado");
});

test("una mala sesión aislada → consolidar, nunca bajar", () => {
  const r = uno(MANC, [banca([11, 11, 11, 11]), banca([12, 12, 11, 11]), banca([9, 9, 8, 8])]);
  assert.equal(r.accion, "consolidar");
  assert.equal(r.motivo, "caida_aislada");
  assert.equal(r.carga.kg, 25);
});

test("dos malas sesiones seguidas con la misma carga → bajar ligeramente", () => {
  const r = uno({ nombre: "PRESS MILITAR C/MANCUERNAS SENTADO", series_objetivo: 3, reps_objetivo: "8-12" },
    [serie(14, [10, 10, 9]), serie(14, [8, 8, 7]), serie(14, [7, 7, 6])]);
  assert.equal(r.accion, "bajar");
  assert.equal(r.titulo, "Bajá a 12 kg por mancuerna");
  assert.equal(r.estado, "Recuperar");
});

test("caídas repetidas + RPE de sesión muy alto → descarga (−15%, una serie menos)", () => {
  const r = uno({ nombre: "PRESS BANCA C/BARRA", reps_objetivo: "8-10" }, [
    { series: serie(60, [10, 10, 9, 9]) }, { series: serie(60, [9, 8, 8, 8]), rpe: 9 }, { series: serie(60, [7, 7, 6, 6]), rpe: 9.5 }
  ]);
  assert.equal(r.accion, "descargar");
  assert.equal(r.titulo, "Sesión liviana: 50 kg");
  assert.match(r.objetivo, /Una serie menos/);
  /* Sin caídas, el RPE de sesión alto nunca dispara una descarga. */
  const sinCaidas = uno({ nombre: "PRESS BANCA C/BARRA", reps_objetivo: "8-10" }, [
    { series: serie(60, [9, 9, 9, 9]), rpe: 9.5 }, { series: serie(60, [9, 9, 9, 9]), rpe: 9.5 }
  ]);
  assert.notEqual(sinCaidas.accion, "descargar");
});

/* --- Series principales, por lado, peso corporal, movilidad --- */

test("aproximaciones ignoradas: 15 kg x10 de entrada no cuenta como serie efectiva", () => {
  const r = uno(MANC, [serie(15, [10]).concat(banca([12, 12, 11, 11])), serie(15, [10]).concat(banca([12, 12, 12, 12]))]);
  assert.equal(r.accion, "subir");
  assert.ok(r.porQue.some((l) => /sin contar 1 de aproximación/.test(l)), r.porQue);
});

test("reps por lado ('10/10'): se usan por lado, nunca sumadas", () => {
  const E = (k) => ({ nombre: "ESTOCADA BULGARA C/MANCUERNA", series_objetivo: 3, reps_objetivo: "10/10", rir_objetivo: "2" });
  const e = entorno();
  const obj = clonar(e.GYMAPP.proximaSesion.parsearObjetivo("10/10"));
  assert.deepEqual([obj.min, obj.max, obj.porLado], [10, 10, true]);
  const r = uno(E(), [serie(12, [10, 10, 10]), serie(12, [10, 10, 10])]);
  assert.equal(r.accion, "subir"); /* 10 por lado cumplido dos veces; 20 nunca se exige */
  assert.equal(r.objetivo, "Objetivo: 10 reps por lado");
});

test("peso corporal con lastre: carga total − peso corporal → '+10 kg de lastre'", () => {
  const r = uno({ nombre: "DOMINADAS TOMA NEUTRA", reps_objetivo: "6-8", rir_objetivo: "1" },
    [serie(82.5, [8, 8, 8, 8]), serie(82.5, [8, 8, 8, 8])], { pesoCorporal: 75 });
  assert.equal(r.accion, "subir");
  assert.equal(r.titulo, "Subí a +10 kg de lastre");
  const sinLastre = uno({ nombre: "DOMINADAS TOMA NEUTRA", reps_objetivo: "6-8" }, [serie(0, [7, 6, 6, 6]), serie(0, [7, 7, 6, 6])], { pesoCorporal: 75 });
  assert.equal(sinLastre.titulo, "Peso corporal");
  assert.ok(!/kg/.test(sinLastre.titulo));
});

test("movilidad/activación: sin progresión de carga aunque haya historial", () => {
  const r = uno({ nombre: "ROTACION TORACICA EN CUADRUPEDIA CON BRAZOS EXTENDIDOS", series_objetivo: 2, reps_objetivo: "8" }, [serie(0, [8, 8]), serie(0, [8, 8])]);
  assert.equal(r.tipo, "movilidad");
  const iso = uno({ nombre: "DOMINADA ISOMETRICA", series_objetivo: 3, reps_objetivo: "15-30''" }, [serie(0, [20, 20, 20])]);
  assert.equal(iso.tipo, "movilidad");
});

/* --- Esfuerzo: RIR/RPE objetivo del ejercicio vs RPE de la sesión --- */

test("RIR objetivo alto (>= 3): progresa más despacio (pide el tope dos veces)", () => {
  const ej = { nombre: "PRESS BANCA C/MANCUERNAS", rir_objetivo: "3" };
  assert.equal(uno(ej, [banca([11, 11, 11, 11]), banca([12, 12, 12, 12])]).accion, "consolidar");
  assert.equal(uno(ej, [banca([12, 12, 12, 12]), banca([12, 12, 12, 12])]).accion, "subir");
  /* RIR 2: el tope una vez alcanza. */
  assert.equal(uno(MANC, [banca([11, 11, 11, 11]), banca([12, 12, 12, 12])]).accion, "subir");
});

test("RPE objetivo DEL EJERCICIO: se usa como RIR (10 − RPE), igual que E6.5", () => {
  const ej = { nombre: "PRESS BANCA C/MANCUERNAS", rpe_objetivo: 7 }; /* RIR 3 */
  const r = uno(ej, [banca([11, 11, 11, 11]), banca([12, 12, 12, 12])]);
  assert.equal(r.accion, "consolidar");
  assert.ok(r.porQue.some((l) => /dejar 3 reps en reserva/.test(l)), r.porQue);
});

test("RPE de SESIÓN: solo contexto; frena la subida, nunca se compara con el RPE objetivo", () => {
  const ej = { nombre: "PRESS BANCA C/MANCUERNAS", rir_objetivo: "2", rpe_objetivo: 8 };
  const alto = uno(ej, [{ series: banca([11, 11, 11, 11]), rpe: 9 }, { series: banca([12, 12, 12, 12]), rpe: 9.5 }]);
  assert.equal(alto.accion, "consolidar");
  assert.equal(alto.motivo, "tope_con_fatiga");
  assert.ok(alto.porQue.some((l) => /RPE de sesión alto/.test(l)));
  assert.ok(!alto.porQue.some((l) => /RPE (del )?ejercicio demasiado alto/i.test(l)));
  /* RPE de sesión 8,5 (por encima del RPE objetivo 8) NO frena nada. */
  const medio = uno(ej, [{ series: banca([11, 11, 11, 11]), rpe: 8.5 }, { series: banca([12, 12, 12, 12]), rpe: 8.5 }]);
  assert.equal(medio.accion, "subir");
  /* Una sola sesión exigente tampoco. */
  assert.equal(uno(ej, [{ series: banca([11, 11, 11, 11]), rpe: 7 }, { series: banca([12, 12, 12, 12]), rpe: 10 }]).accion, "subir");
  const src = fs.readFileSync(path.join(__dirname, "..", "js", "recomendacionProximaSesion.js"), "utf8");
  assert.ok(!/RPE ejercicio demasiado alto/i.test(src));
});

/* --- Identidad del ejercicio --- */

test("mismo ejercicio con otro id (otro plan): usa su historial por nombre estricto", () => {
  const d = F.caso(
    [{ ejercicio: { nombre: "PRESS BANCA C/MANCUERNAS", series: 4, reps: "10-12" }, series: [banca([11, 11, 11, 11]), banca([12, 12, 12, 12]), banca([12, 12, 12, 12])] }],
    { nombre: "Press banca c/ mancuernas", series_objetivo: 4, reps_objetivo: "10-12", rir_objetivo: "2" },
    { desde: "2026-10-20" }
  );
  const r = rec(d);
  assert.equal(r.tipo, "accion");
  assert.equal(r.accion, "subir");
  assert.equal(r.titulo, "Subí a 27,5 kg por mancuerna");
});

test("variantes nunca se mezclan: press inclinado con mancuernas ≠ Smith (queda para E6.5)", () => {
  const d = F.caso(
    [{ ejercicio: { nombre: "PRESS INCLINADO C/MANCUERNAS", series: 4, reps: "8-10" }, series: [serie(25, [10, 10, 10, 10]), serie(25, [10, 10, 10, 10])] }],
    { nombre: "PRESS INCLINADO EN SMITH", series_objetivo: 4, reps_objetivo: "8" },
    { desde: "2026-10-20" }
  );
  assert.equal(rec(d).tipo, "sin_historial");
});

/* --- Pureza --- */

test("no muta datos: storage intacto y objetos de entrada sin cambios", () => {
  const datos = P.armar([Object.assign({ series_objetivo: 4, reps_objetivo: "10-12", registros: [{ series: banca([12, 12, 12, 12]) }, { series: banca([12, 12, 12, 12]) }] }, MANC)]);
  const e = entorno(datos);
  const antes = JSON.stringify(e.leer(CLAVE));
  const data = e.GYMAPP.storage.getData();
  const copia = JSON.stringify(data);
  const ej = e.GYMAPP.planes.planActivo(data).dias[0].ejercicios[0];
  const r = e.GYMAPP.proximaSesion.recomendar(data, ej, { hoy: P.HOY });
  e.GYMAPP.proximaSesion.renderRecomendacion(r);
  assert.equal(JSON.stringify(data), copia);
  assert.equal(JSON.stringify(e.leer(CLAVE)), antes);
  assert.equal(e.leer(CLAVE).schema_version, 3);
});

test("render: acción, objetivo, confianza y '¿Por qué?' cerrado; texto escapado", () => {
  const e = entorno();
  const html = e.GYMAPP.proximaSesion.renderRecomendacion({
    tipo: "accion", accion: "subir", confianza: "alta", titulo: "Subí a 27,5 kg <b>", objetivo: "Objetivo: 10-12 reps", porQue: ["a & b"]
  });
  assert.match(html, /Próxima sesión/);
  assert.match(html, /Subí a 27,5 kg &lt;b&gt;/);
  assert.match(html, /Confianza alta/);
  assert.match(html, /<details class="carga-sugerida-detalle"><summary>¿Por qué\?<\/summary>/);
  assert.ok(!/<details[^>]*open/.test(html));
  assert.equal(e.GYMAPP.proximaSesion.renderRecomendacion({ tipo: "movilidad" }), "");
});

/* --- Ejemplos (datos de ejemplo, no el backup del usuario) --- */

test("ejemplos: una acción por ejercicio, sin nada hardcodeado en el motor", () => {
  const d = P.armar(P.EJEMPLOS, { pesoCorporal: 75 });
  const esperado = {
    "PRESS BANCA C/MANCUERNAS": ["subir", "Subí a 27,5 kg por mancuerna"],
    "PRESS BANCA C/BARRA": ["mantener_reps", "Mantené 55 kg"],
    "PRESS INCLINADO EN SMITH": ["bajar", "Bajá a 40 kg"],
    "PRESS MILITAR C/MANCUERNAS SENTADO": ["bajar", "Bajá a 12 kg por mancuerna"],
    "BICEPS MARTILLO EN POLEA": ["consolidar", "Mantené 15 kg"],
    "DOMINADAS TOMA NEUTRA": ["subir", "Subí a +10 kg de lastre"],
    "REMO CON MANCUERNA A 1 BRAZO": ["mantener_reps", "Mantené 22 kg (1 mancuerna)"],
    "TRICEPS EN POLEA BARRA PLANA": ["consolidar", "Mantené 25 kg"]
  };
  Object.keys(esperado).forEach((n) => {
    const r = rec(d, n);
    assert.deepEqual([r.accion, r.titulo], esperado[n], n);
  });
  const src = fs.readFileSync(path.join(__dirname, "..", "js", "recomendacionProximaSesion.js"), "utf8");
  assert.ok(!/\b(press|dominadas?|biceps|triceps|remo)\b/i.test(src.replace(/\/\*[\s\S]*?\*\//g, "")), "el motor no nombra ejercicios");
});

test("insuficiente: una sola sesión sin rango claro → 'Datos insuficientes'", () => {
  const r = uno({ nombre: "CURL 21 CON BARRA", series_objetivo: 3, reps_objetivo: "7-7-7" }, [serie(20, [21, 21, 18])]);
  assert.equal(r.accion, "insuficiente");
  assert.equal(r.titulo, "Datos insuficientes");
  assert.equal(r.confianza, "baja");
});

test("estado global de PROG-04: 'descargar' frena la subida; 'consolidar' la deja con cautela", () => {
  const datos = P.armar([Object.assign({ series_objetivo: 4, reps_objetivo: "10-12", registros: [{ series: banca([11, 11, 11, 11]) }, { series: banca([12, 12, 12, 12]) }] }, MANC)]);
  const e = entorno(datos);
  const data = e.GYMAPP.storage.getData();
  const ej = e.GYMAPP.planes.planActivo(data).dias[0].ejercicios[0];
  const R = (estadoPlan) => clonar(e.GYMAPP.proximaSesion.recomendar(data, ej, { hoy: P.HOY, estadoPlan }));
  assert.equal(R("progresar").accion, "subir");
  const desc = R("descargar");
  assert.equal(desc.accion, "consolidar");
  assert.equal(desc.motivo, "plan_descarga");
  const cons = R("consolidar");
  assert.equal(cons.accion, "subir");
  assert.ok(cons.porQue.some((l) => /estado general del plan es Consolidar/.test(l)));
});

/* --- Corrección: cumplimiento del rango en exposiciones consecutivas --- */

const SMITH = { nombre: "PRESS INCLINADO EN SMITH", series_objetivo: 4, reps_objetivo: "8", rir_objetivo: "1-2" };

test("Smith 4x8: 42,5 → 8/7/7/6 y 42,5 → 7/7/6/6 (dos debajo seguidas) → bajar a 40 kg", () => {
  const r = uno(SMITH, [serie(40, [8, 8, 8, 8]), serie(42.5, [8, 7, 7, 6]), serie(42.5, [7, 7, 6, 6])]);
  assert.equal(r.accion, "bajar");
  assert.equal(r.motivo, "debajo_del_rango");
  assert.equal(r.titulo, "Bajá a 40 kg");
  assert.equal(r.objetivo, "Objetivo: 4×8");
  assert.equal(r.confianza, "alta");
  assert.equal(r.porQue[0], "Las últimas dos exposiciones con 42,5 kg quedaron por debajo de las reps objetivo. Volvé un salto para recuperar el rendimiento antes de intentar progresar otra vez.");
  /* Sin la sesión de 40 kg (sin salto propio): el salto típico, también 40. */
  assert.equal(uno(SMITH, [serie(42.5, [8, 7, 7, 6]), serie(42.5, [7, 7, 6, 6])]).titulo, "Bajá a 40 kg");
});

test("Smith 4x8 control: 42,5 → 8/8/8/8 y 42,5 → 7/7/6/6 (una sola mala) → consolidar", () => {
  const r = uno(SMITH, [serie(42.5, [8, 8, 8, 8]), serie(42.5, [7, 7, 6, 6])]);
  assert.equal(r.accion, "consolidar");
  assert.equal(r.motivo, "caida_aislada");
  assert.equal(r.titulo, "Mantené 42,5 kg");
});

test("rango 10-12: dos exposiciones seguidas debajo del mínimo con la misma carga → bajar; una sola → consolidar", () => {
  assert.equal(uno(MANC, [banca([12, 12, 12, 12]), banca([9, 9, 8, 8]), banca([9, 8, 8, 8])]).accion, "bajar");
  assert.equal(uno(MANC, [banca([11, 11, 11, 11]), banca([12, 12, 11, 11]), banca([9, 9, 8, 8])]).accion, "consolidar");
});

/* --- "Última referencia" con series efectivas (Progreso) --- */

const referencia = (series) => {
  const e = entorno();
  return e.GYMAPP.progreso.formatearUltimaReferenciaEjercicio({ series, pesoMaximo: Math.max(...series.map((s) => s.peso_kg)) });
};

test("Última referencia: aproximación + 4 efectivas → solo las efectivas", () => {
  assert.equal(referencia(serie(20, [10]).concat(serie(25, [12, 12, 12, 12]))), "25 kg · 12/12/12/12");
});

test("Última referencia: sin aproximaciones → igual que antes; decimales y peso corporal", () => {
  assert.equal(referencia(serie(25, [12, 12, 11, 10])), "25 kg · 12/12/11/10");
  assert.equal(referencia(serie(42.5, [8, 7, 7, 6])), "42,5 kg · 8/7/7/6");
  assert.equal(referencia(serie(0, [8, 7, 6])), "8/7/6 reps");
});

test("Última referencia: el historial guardado no cambia", () => {
  const datos = P.armar([Object.assign({ series_objetivo: 4, reps_objetivo: "10-12", registros: [{ series: serie(20, [10]).concat(serie(25, [12, 12, 12, 12])) }] }, MANC)]);
  const e = entorno(datos);
  const antes = JSON.stringify(e.leer(CLAVE));
  const data = e.GYMAPP.storage.getData();
  const series = data.sesiones_entrenamiento[0].ejercicios_realizados[0].series;
  assert.equal(e.GYMAPP.progreso.formatearUltimaReferenciaEjercicio({ series, pesoMaximo: 25 }), "25 kg · 12/12/12/12");
  assert.equal(series.length, 5);
  assert.deepEqual(clonar(series[0]), { peso_kg: 20, reps: 10 });
  assert.equal(JSON.stringify(e.leer(CLAVE)), antes);
});
