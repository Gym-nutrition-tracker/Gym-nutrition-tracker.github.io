/* E6: importador de planes desde PDF (parser en capas) y activación segura
   de un plan nuevo. El flujo con pdf.js real y la UI está en
   tests/e2e/importar-plan.e2e.js. Correr con: node --test tests/*.test.js */
const test = require("node:test");
const assert = require("node:assert/strict");
const { crearEntorno, crearContenedor, esperar, clonar, aE3 } = require("./entorno");
const { datasetHistoricos } = require("./fixtures/historicos-dataset");
const { LINEAS_PLAN_EJEMPLO } = require("./fixtures/pdf-sintetico");

const CLAVE = "gymNutritionTracker";
const PRE = "gymNutritionTracker_preCambioPlan";
const META = "gymNutritionTracker_syncMeta";
const PLAN_LEGACY = "plan-hist-mu4c87ep730qj1";
const AHORA = "2026-11-09T15:00:00.000Z";

function entorno(datos) {
  const e = crearEntorno({ sinSync: true, ahora: "2026-11-09T12:00:00", modulos: ["js/actividades.js", "js/pdfImport.js"] });
  if (datos !== null) e.escribir(CLAVE, datos || aE3(datasetHistoricos({ legacy: true })));
  let n = 0;
  e.GYMAPP.planes.configurarGeneradorIds(() => "id-" + (++n));
  return e;
}
const parsear = (e, texto) => clonar(e.GYMAPP.pdfImport.normalizarPlanParseado(e.GYMAPP.pdfImport.parsearPlanDesdeTexto(texto)));
const validar = (e, b) => clonar(e.GYMAPP.pdfImport.validarPlanParseado(b));
const ej0 = (b) => b.dias[0].ejercicios[0];
const CAMPOS_EJ = ["nombre", "grupo_muscular", "series_objetivo", "reps_objetivo", "rir_objetivo", "rpe_objetivo", "peso_objetivo", "pausa", "comentarios", "raw", "advertencias"];

/* --- Parser (1-15) --- */

test("1. un día simple", () => {
  const b = parsear(entorno(null), "Día 1 - Empuje\nPress banca 4x8");
  assert.equal(b.dias.length, 1);
  assert.equal(b.dias[0].nombre, "Día 1 - Empuje");
  assert.deepEqual(Object.keys(ej0(b)), CAMPOS_EJ, "sin IDs en el borrador");
  assert.equal(ej0(b).nombre, "Press banca");
});

test("2. múltiples días, en orden", () => {
  const b = parsear(entorno(null), "DÍA 1 - EMPUJE\nPress 4x8\nDÍA 2 - TRACCIÓN\nRemo 4x10\nDÍA 3 - PIERNAS\nSentadilla 5x5");
  assert.deepEqual(b.dias.map((d) => d.nombre), ["DÍA 1 - EMPUJE", "DÍA 2 - TRACCIÓN", "DÍA 3 - PIERNAS"]);
});

test("3-5. series número y reps texto: 4 × 8, 4 × 8-10, 10/10, AMRAP, '3 series de 15', tabla Ord/Series/Rep", () => {
  const e = entorno(null);
  const casos = [["Press 4 x 8", 4, "8"], ["Press 4x8-10", 4, "8-10"], ["Estocadas 3x10/10", 3, "10/10"], ["Dominadas 4 x AMRAP", 4, "AMRAP"],
    ["Face pull 3 series de 15", 3, "15"], ["1 Press banca c/barra 4 6-8", 4, "6-8"], ["Plancha 3 series", 3, null], ["Press 4×8–10", 4, "8-10"]];
  casos.forEach(([linea, series, reps]) => {
    const ej = ej0(parsear(e, "Día 1\n" + linea));
    assert.equal(ej.series_objetivo, series, linea);
    assert.equal(typeof ej.series_objetivo, "number", linea);
    assert.equal(ej.reps_objetivo, reps, linea);
  });
});

test("6-8. RIR y RPE: formatos, rangos y ambos a la vez en campos separados", () => {
  const e = entorno(null);
  const casos = [["Press 4x8 RIR 2", 2, null], ["Press 4x8 RIR: 2", 2, null], ["Press 4x8 2 RIR", 2, null], ["Press 4x8 RIR 1-2", "1-2", null],
    ["Press 4x8 RPE 8", null, 8], ["Press 4x8 RPE: 8,5", null, 8.5], ["Press 4x8 RPE 7-8", null, "7-8"],
    ["Press 4x8 RIR 2 RPE 8", 2, 8], ["Press inclinado Smith | 4x8-10 | RIR 2 | RPE 8", 2, 8]];
  casos.forEach(([linea, rir, rpe]) => {
    const ej = ej0(parsear(e, "Día 1\n" + linea));
    assert.deepEqual([ej.rir_objetivo, ej.rpe_objetivo], [rir, rpe], linea);
  });
  const b = parsear(e, "Día 1\nPress 4x8 RIR 2 RPE 8");
  assert.ok(validar(e, b).advertencias.some((a) => /RIR y RPE/.test(a.mensaje)), "8. aviso informativo");
  assert.equal(validar(e, b).errores.length, 0, "8. no es error");
});

test("9-10. pausa y peso objetivo se conservan como texto", () => {
  const e = entorno(null);
  const casos = [["Press 4x8 Pausa 2 min", "2 min", null], ["Press 4x8 descanso 90 s", "90 s", null], ["Sentadilla 5x5 descanso 3'", "3'", null],
    ["Press 4x8 1'30\"", "1'30\"", null], ["Press militar 3x8-12 25 kg c/u", null, "25 kg c/u"], ["Sentadilla 5x5 peso: 100 kg", null, "100 kg"]];
  casos.forEach(([linea, pausa, peso]) => {
    const ej = ej0(parsear(e, "Día 1\n" + linea));
    assert.deepEqual([ej.pausa, ej.peso_objetivo], [pausa, peso], linea);
  });
});

test("11. comentarios: nota en línea aparte y paréntesis; raw no se copia a comentarios", () => {
  const e = entorno(null);
  const b = parsear(e, "Día 1\nPress 4x8 (tempo 3-1-1)\nNota: controlar la bajada\nRemo 4x10");
  assert.equal(b.dias[0].ejercicios[0].comentarios, "tempo 3-1-1 controlar la bajada");
  assert.equal(b.dias[0].ejercicios[0].raw, "Press 4x8 (tempo 3-1-1)");
  assert.equal(b.dias[0].ejercicios[1].comentarios, null);
  assert.equal(b.dias[0].ejercicios[1].raw, "Remo 4x10");
});

test("12. campos ausentes → null (sin inventar ni inferir grupo)", () => {
  const e = entorno(null);
  const ej = ej0(parsear(e, "PECHO\nPress banca 4x8"));
  assert.deepEqual([ej.grupo_muscular, ej.rir_objetivo, ej.rpe_objetivo, ej.peso_objetivo, ej.pausa, ej.comentarios], [null, null, null, null, null, null]);
  assert.equal(ej0(parsear(e, "Día 1\nRemo 4x10 | Espalda")).grupo_muscular, "Espalda", "solo grupo explícito en columna");
  const v = validar(e, parsear(e, "Día 1\nPlancha 3 series"));
  assert.ok(v.advertencias.some((a) => a.mensaje === "No se pudo detectar el grupo muscular."));
  assert.ok(v.advertencias.some((a) => a.mensaje === "No se detectaron repeticiones."));
  assert.equal(v.errores.length, 0);
});

test("13. texto ambiguo y líneas no interpretadas → advertencias (nada se pierde en silencio)", () => {
  const e = entorno(null);
  const b = parsear(e, "Día 1\nFlexiones 2x10 algo raro\nPlancha abdominal 45 s\nCORE\nDía 2\nRemo 4x10");
  assert.match(ej0(b).advertencias[0], /Texto ambiguo/);
  assert.equal(ej0(b).comentarios, "algo raro");
  assert.ok(b.dias[0].advertencias.some((a) => /Línea sin interpretar: "Plancha abdominal 45 s"/.test(a)));
  assert.ok(b.advertencias.some((a) => /Se ignoró "CORE"/.test(a)));
});

test("RIR + RPE en muchos ejercicios: datos intactos y UN solo aviso a nivel plan; los demás avisos siguen individuales", () => {
  const e = entorno(null);
  const filas = [];
  for (let i = 1; i <= 33; i++) filas.push("Ejercicio de prueba " + i + " 3x10 RIR " + (i % 3 + 1) + " RPE " + (7 + (i % 3)));
  filas.push("Ejercicio sin esfuerzo 3x10");
  filas.push("Ejercicio dudoso 3x10 texto suelto");
  const b = parsear(e, "Día 1\n" + filas.join("\n"));
  const ambos = b.dias[0].ejercicios.filter((x) => x.rir_objetivo !== null && x.rpe_objetivo !== null);
  assert.equal(ambos.length, 33);
  ambos.forEach((x, k) => {
    assert.equal(x.rir_objetivo, (k + 1) % 3 + 1, "RIR conservado");
    assert.equal(x.rpe_objetivo, 7 + ((k + 1) % 3), "RPE conservado");
  });
  const v = validar(e, b);
  const avisoPlan = v.advertencias.filter((a) => a.mensaje === e.GYMAPP.pdfImport.MENSAJE_RIR_Y_RPE);
  assert.equal(avisoPlan.length, 1, "un solo aviso agregado");
  assert.deepEqual([avisoPlan[0].dia, avisoPlan[0].ejercicio], [null, null], "a nivel plan");
  assert.equal(avisoPlan[0].mensaje, "Este plan utiliza RIR y RPE simultáneamente. Ambos valores fueron importados por separado.");
  assert.equal(v.advertencias.filter((a) => /grupo muscular/.test(a.mensaje)).length, 35, "grupo muscular sigue por ejercicio");
  assert.equal(v.advertencias.filter((a) => /Texto ambiguo/.test(a.mensaje) && a.ejercicio === 34).length, 1, "la ambigüedad real sigue individual");
  assert.ok(!v.advertencias.some((a) => a.ejercicio !== null && /RIR y RPE/.test(a.mensaje)), "ningún aviso de RIR + RPE por ejercicio");
  assert.equal(validar(e, parsear(e, "Día 1\nPress 4x8 RIR 2")).advertencias.filter((a) => /RIR y RPE/.test(a.mensaje)).length, 0, "sin ambos, sin aviso");
});

test("14-15. documento sin ejercicios o vacío → error", () => {
  const e = entorno(null);
  ["", "   \n\n", "Plan sin nada\nDía 1\nSolo texto suelto"].forEach((t) => {
    const b = parsear(e, t);
    assert.equal(b.dias.length, 0, JSON.stringify(t));
    assert.ok(validar(e, b).errores.length > 0);
  });
  assert.match(e.GYMAPP.pdfImport.MENSAJE_SIN_EJERCICIOS, /No se encontró ningún ejercicio/);
  assert.match(e.GYMAPP.pdfImport.MENSAJE_SIN_TEXTO, /imagen o un escaneo/);
});

test("nombre y vigencia del plan solo si aparecen en el documento", () => {
  const e = entorno(null);
  const b = parsear(e, LINEAS_PLAN_EJEMPLO.join("\n"));
  assert.deepEqual([b.nombre, b.fecha_inicio, b.fecha_fin], ["Plan de prueba sintético", "2026-10-12", "2026-12-18"]);
  assert.deepEqual([parsear(e, "Día 1\nPress 4x8").fecha_inicio, parsear(e, "Día 1\nPress 4x8").nombre], [null, null]);
  const etiquetas = parsear(e, "Inicio: 01/11/2026\nFin: 30/11/2026\nDía 1\nPress 4x8");
  assert.deepEqual([etiquetas.fecha_inicio, etiquetas.fecha_fin], ["2026-11-01", "2026-11-30"]);
  assert.equal(parsear(e, "Plan X 31/02/2026 al 10/03/2026\nDía 1\nPress 4x8").fecha_inicio, null, "fecha inexistente no se usa");
});

/* --- Reglas generales para tablas (validadas con el PDF real en
   tests/e2e/plan-real.e2e.js). Documento INVENTADO: otros ejercicios, días
   y valores, con columnas separadas por 2+ espacios como las arma pdf.js. --- */
const TABLA = [
  "HIPERTROFIA A",
  "Ord.   Ejercicio   Series   Rep.   Peso   RPE   Pausa   Comentarios",
  "MA   MOVILIDAD DE TOBILLO NIVEL 2   2   10",
  "1   REMO CON BARRA T   4   7-7-7   RIR 0-1   9   1-2'   AGARRE NEUTRO, 20 KG POR LADO COMO REFERENCIA",
  "2   PLANCHA LATERAL   3   20-40''   RIR 2   7   45''",
  "3   SALTO AL CAJON   3   6 (3'')   8   1´",
  "4   PRESS ARNOLD   3   12   60 kg   RIR 3   8   90’",
  "5   CURL INVERTIDO   2   15/15   RPE 7   2″",
  "Observaciones:",
  "FUERZA B",
  "Ord.   Ejercicio   Series   Rep.   Peso   RPE   Pausa   Comentarios",
  "1   SENTADILLA FRONTAL   5   3   RIR 2   8   3'"
].join("\n");

test("tabla: celdas por semántica (RIR, RPE, pausa, peso solo como celda completa, comentarios)", () => {
  const e = entorno(null);
  const b = parsear(e, TABLA);
  assert.deepEqual(b.dias.map((d) => [d.nombre, d.ejercicios.length]), [["HIPERTROFIA A", 6], ["FUERZA B", 1]], "días por encabezado de tabla, aunque no sean palabras clave");
  const fila = (n) => { const x = b.dias[0].ejercicios[n]; return [x.nombre, x.series_objetivo, x.reps_objetivo, x.rir_objetivo, x.rpe_objetivo, x.peso_objetivo, x.pausa, x.comentarios]; };
  assert.deepEqual(fila(0), ["MOVILIDAD DE TOBILLO NIVEL 2", 2, "10", null, null, null, null, null], "número al final del nombre no es series");
  assert.deepEqual(fila(1), ["REMO CON BARRA T", 4, "7-7-7", "0-1", 9, null, "1-2'", "AGARRE NEUTRO, 20 KG POR LADO COMO REFERENCIA"], "kg dentro de un comentario no es peso");
  assert.deepEqual(fila(2), ["PLANCHA LATERAL", 3, "20-40''", 2, 7, null, "45''", null], "reps en segundos ≠ pausa");
  assert.deepEqual(fila(3), ["SALTO AL CAJON", 3, "6 (3'')", null, 8, null, "1´", null]);
  assert.deepEqual(fila(4), ["PRESS ARNOLD", 3, "12", 3, 8, "60 kg", "90’", null], "carga con unidad en su propia celda sí es peso");
  assert.deepEqual(fila(5), ["CURL INVERTIDO", 2, "15/15", null, 7, null, "2″", null]);
  assert.equal(b.dias[0].ejercicios[1].raw, "1 | REMO CON BARRA T | 4 | 7-7-7 | RIR 0-1 | 9 | 1-2' | AGARRE NEUTRO, 20 KG POR LADO COMO REFERENCIA");
  const v = validar(e, b);
  assert.ok(!v.advertencias.some((a) => /Texto ambiguo|Línea sin interpretar/.test(a.mensaje)), JSON.stringify(v.advertencias));
});

test("tabla: un número suelto solo es RPE si el encabezado tiene columna RPE", () => {
  const e = entorno(null);
  const sinRpe = parsear(e, "DÍA 1\nOrd.   Ejercicio   Series   Rep.   Pausa   Comentarios\n1   PRESS   3   10   8   1'");
  const ej = ej0(sinRpe);
  assert.equal(ej.rpe_objetivo, null);
  assert.equal(ej.pausa, "1'");
  assert.equal(ej.comentarios, "8");
  assert.match(ej.advertencias[0], /Texto ambiguo/, "se avisa, no se adivina");
});

test("metadata en cualquier parte: Descripción → nombre, Desde/Hasta → fechas; Nombre y títulos no son 'sin interpretar'", () => {
  const e = entorno(null);
  const texto = [
    "DÍA 1", "Ord.   Ejercicio   Series   Rep.   RPE", "1   PRESS   3   10   8",
    "PLAN DE ENTRENAMIENTO",
    "Nombre:   PERSONA DE PRUEBA",
    "Descripción:   MESOCICLO DE PRUEBA   Desde:   03/03/2027   Hasta:   28/04/2027",
    "Observaciones generales:",
    "2   REMO   3   12   7",
    "Observaciones:   priorizar técnica"
  ].join("\n");
  const b = parsear(e, texto);
  assert.deepEqual([b.nombre, b.fecha_inicio, b.fecha_fin], ["MESOCICLO DE PRUEBA", "2027-03-03", "2027-04-28"]);
  assert.deepEqual(b.dias[0].ejercicios.map((x) => x.nombre), ["PRESS", "REMO"], "el día sigue después de la metadata intercalada");
  const avisos = validar(e, b).advertencias.map((a) => a.mensaje);
  assert.ok(!avisos.some((m) => /Línea sin interpretar/.test(m)), JSON.stringify(avisos));
  assert.ok(!JSON.stringify(b).includes("PERSONA DE PRUEBA"), "el nombre de la persona no se usa ni se guarda");
  assert.ok(avisos.includes("Observación del día: \"priorizar técnica\"."), "una observación con texto no se pierde");
});

test("pausas y reps nuevas también en texto libre (sin tabla)", () => {
  const e = entorno(null);
  const casos = [["Puente 3x15-30''", "15-30''", null], ["Saltos 4x8 (5'') 2'", "8 (5'')", "2'"], ["Curl 21 3x7-7-7 pausa 1-2'", "7-7-7", "1-2'"], ["Remo 3x10 1´", "10", "1´"]];
  casos.forEach(([linea, reps, pausa]) => {
    const ej = ej0(parsear(e, "Día 1\n" + linea));
    assert.deepEqual([ej.reps_objetivo, ej.pausa], [reps, pausa], linea);
  });
});

test("validación: bloquea nombres faltantes, series inválidas y fechas al revés; no bloquea campos null", () => {
  const e = entorno(null);
  const b = parsear(e, "Día 1\nPress 4x8");
  b.dias[0].nombre = null;
  b.dias[0].ejercicios[0].nombre = "";
  b.dias[0].ejercicios.push(Object.assign(clonar(e.GYMAPP.pdfImport.ejercicioVacio()), { nombre: "Manual", series_objetivo: "0" }));
  b.fecha_inicio = "2026-12-18"; b.fecha_fin = "2026-10-12";
  const errores = validar(e, b).errores.map((x) => x.mensaje);
  assert.ok(errores.includes("Falta el nombre del día."));
  assert.ok(errores.includes("Falta el nombre del ejercicio."));
  assert.ok(errores.includes("Las series tienen que ser un número entero mayor a 0."));
  assert.ok(errores.includes("La fecha de fin no puede ser anterior a la de inicio."));
  const manual = Object.assign(clonar(e.GYMAPP.pdfImport.ejercicioVacio()), { nombre: "Solo nombre" });
  assert.equal(validar(e, { dias: [{ nombre: "D", ejercicios: [manual] }] }).errores.length, 0, "todo null salvo el nombre es válido");
});

test("16. parsear/normalizar/validar no escriben nada", () => {
  const e = entorno();
  const antes = e.localStorage.getItem(CLAVE);
  const b = parsear(e, LINEAS_PLAN_EJEMPLO.join("\n"));
  validar(e, b);
  e.GYMAPP.planes.borradorCoincideConPlan(b, e.GYMAPP.planes.planActivo(e.GYMAPP.storage.getData()));
  e.GYMAPP.planes.prepararCambioDePlan(e.GYMAPP.storage.getData(), b, { ahora: AHORA, nombreArchivo: "plan.pdf" });
  assert.deepEqual(e.localStorage._escrituras, []);
  assert.equal(e.localStorage.getItem(CLAVE), antes);
});

/* --- Activación (17-34) --- */

/* Lo mismo que hace rutina.activarPlanImportado tras la confirmación. */
function activar(e, texto, opciones) {
  const b = parsear(e, texto || LINEAS_PLAN_EJEMPLO.join("\n"));
  const p = e.GYMAPP.planes.prepararCambioDePlan(e.GYMAPP.storage.getData(), b, { ahora: AHORA, nombreArchivo: "plan.pdf" });
  if (!p.ok) return p;
  if (opciones && opciones.cancelar) return { ok: false, cancelado: true };
  const g = e.GYMAPP.storage.guardarConCopiaPrevia(PRE, p.datos, AHORA);
  return Object.assign({ plan: clonar(p.plan) }, clonar(g));
}

test("17. cancelar antes de activar → 0 escrituras", () => {
  const e = entorno();
  const antes = e.localStorage.getItem(CLAVE);
  assert.equal(activar(e, null, { cancelar: true }).cancelado, true);
  assert.deepEqual(e.localStorage._escrituras, []);
  assert.equal(e.localStorage.getItem(CLAVE), antes);
});

test("18. confirmar → copia preCambioPlan con el texto anterior ANTES del único save", () => {
  const e = entorno();
  const antes = e.localStorage.getItem(CLAVE);
  assert.equal(activar(e).ok, true);
  assert.deepEqual(e.localStorage._operaciones.map((o) => o.join(":")), ["set:" + PRE, "set:" + CLAVE]);
  assert.equal(e.leer(PRE).data_raw, antes);
  assert.equal(e.leer(PRE).fecha, AHORA);
});

test("19-20. falla la copia → nada cambia; falla el save → datos anteriores intactos", () => {
  const e1 = entorno();
  const antes1 = e1.localStorage.getItem(CLAVE);
  e1.localStorage._fallas.add(PRE);
  const r1 = activar(e1);
  assert.deepEqual([r1.ok, r1.motivo], [false, "copia"]);
  assert.equal(e1.localStorage.getItem(CLAVE), antes1);
  const e2 = entorno();
  const antes2 = e2.localStorage.getItem(CLAVE);
  e2.localStorage._fallas.add(CLAVE);
  const r2 = activar(e2);
  assert.deepEqual([r2.ok, r2.motivo], [false, "guardar"]);
  assert.equal(e2.localStorage.getItem(CLAVE), antes2);
  assert.equal(e2.GYMAPP.planes.planActivo(e2.GYMAPP.storage.getData()).plan_id, JSON.parse(antes2).rutina.plan_activo_id, "el plan no quedó activado");
});

test("21-34. estructura del cambio: archivado, nuevo plan, IDs nuevos, orden y todo lo demás intacto", () => {
  const e = entorno();
  const antes = e.leer(CLAVE);
  const anteriorId = antes.rutina.plan_activo_id;
  const r = activar(e);
  assert.equal(r.ok, true);
  const d = e.leer(CLAVE);
  const anterior = d.rutina.planes.find((p) => p.plan_id === anteriorId);
  const nuevo = d.rutina.planes[d.rutina.planes.length - 1];
  assert.ok(anterior, "21. el plan anterior sigue en planes");
  assert.equal(anterior.archivado_en, AHORA, "22");
  assert.equal(nuevo.creado_en, AHORA, "23");
  assert.equal(anterior.archivado_en, nuevo.creado_en, "24. mismo instante");
  assert.equal(nuevo.version_de, anteriorId, "25");
  assert.equal(nuevo.plan_id, "plan-id-1", "26. ID nuevo (generador inyectado)");
  assert.ok(!antes.rutina.planes.some((p) => p.plan_id === nuevo.plan_id), "26");
  const idsViejos = new Set(antes.rutina.planes.flatMap((p) => [p.plan_id].concat(p.dias.flatMap((x) => [x.id].concat(x.ejercicios.map((y) => y.id))))));
  nuevo.dias.forEach((x) => { assert.ok(!idsViejos.has(x.id), "27"); x.ejercicios.forEach((y) => assert.ok(!idsViejos.has(y.id), "28")); });
  assert.equal(d.rutina.plan_activo_id, nuevo.plan_id, "29");
  assert.ok(!("dias" in d.rutina), "30");
  assert.equal(JSON.stringify(d.sesiones_entrenamiento), JSON.stringify(antes.sesiones_entrenamiento), "31-32");
  assert.equal(JSON.stringify(d.rutina.planes.find((p) => p.plan_id === PLAN_LEGACY)), JSON.stringify(antes.rutina.planes.find((p) => p.plan_id === PLAN_LEGACY)), "33");
  assert.deepEqual(d.rutina.planes.map((p) => p.plan_id), antes.rutina.planes.map((p) => p.plan_id).concat([nuevo.plan_id]), "34. nuevo al final");
  const sinArchivo = clonar(anterior); sinArchivo.archivado_en = null;
  assert.equal(JSON.stringify(sinArchivo), JSON.stringify(antes.rutina.planes.find((p) => p.plan_id === anteriorId)), "el anterior solo cambia archivado_en");
  ["usuario", "registros_nutricion", "base_alimentos", "medidas_corporales", "schema_version"].forEach((k) => assert.equal(JSON.stringify(d[k]), JSON.stringify(antes[k]), k));
  assert.equal(e.GYMAPP.storage.validarDatosV3(d), null);
});

test("estructura exacta del plan nuevo: campos, orden, tipos y nulls", () => {
  const e = entorno();
  const plan = activar(e).plan;
  assert.deepEqual(Object.keys(plan), ["plan_id", "nombre", "fecha_inicio", "fecha_fin", "origen", "version_de", "creado_en", "archivado_en", "fuente", "dias"]);
  assert.deepEqual([plan.nombre, plan.fecha_inicio, plan.fecha_fin, plan.origen, plan.archivado_en], ["Plan de prueba sintético", "2026-10-12", "2026-12-18", "pdf", null]);
  assert.deepEqual(plan.fuente, { tipo: "pdf", nombre_archivo: "plan.pdf" });
  assert.deepEqual(plan.dias.map((x) => [x.nombre, x.orden, x.ejercicios.length]), [["DÍA 1 - EMPUJE", 1, 3], ["DÍA 2 - TRACCIÓN", 2, 3]]);
  assert.deepEqual(Object.keys(plan.dias[0]), ["id", "nombre", "orden", "ejercicios"]);
  assert.deepEqual(plan.dias[0].ejercicios[0], { id: "id-3", nombre: "Press banca c/barra", grupo_muscular: null, series_objetivo: 4, reps_objetivo: "6-8",
    rir_objetivo: 2, rpe_objetivo: 8, peso_objetivo: null, pausa: "2 min", comentarios: null, raw: "1 Press banca c/barra 4 6-8 RIR 2 RPE 8 Pausa 2 min", eliminado: false, orden: 1 });
  assert.deepEqual(plan.dias[1].ejercicios.map((x) => [x.nombre, x.series_objetivo, x.reps_objetivo, x.rir_objetivo, x.grupo_muscular, x.peso_objetivo]),
    [["Dominadas", 4, "AMRAP", 2, null, null], ["Remo con barra", 4, "10", "1-2", "Espalda", null], ["Face pull", 3, "15", null, null, "25 kg c/u"]]);
});

test("IDs: nunca repiten uno existente (ni de sesiones viejas) y se generan solo al confirmar", () => {
  const e = entorno();
  const b = parsear(e, "Día 1\nPress 4x8");
  assert.ok(!JSON.stringify(b).includes("\"id\""), "el borrador no tiene IDs");
  /* El generador devuelve a propósito IDs que ya existen: un día legacy,
     un ejercicio que solo aparece en sesiones viejas y un día del plan
     activo. Se descartan hasta encontrar uno libre. */
  const secuencia = ["x", "mu4c87ep730qj1", "old-1-e1", "D1", "nuevo-1", "D1-e1", "nuevo-2"];
  let i = 0;
  e.GYMAPP.planes.configurarGeneradorIds(() => secuencia[i++]);
  const p = e.GYMAPP.planes.prepararCambioDePlan(e.GYMAPP.storage.getData(), b, { ahora: AHORA });
  assert.equal(p.ok, true);
  assert.deepEqual([p.plan.plan_id, p.plan.dias[0].id, p.plan.dias[0].ejercicios[0].id], ["plan-x", "nuevo-1", "nuevo-2"]);
  e.GYMAPP.planes.configurarGeneradorIds(null);
  const real = e.GYMAPP.planes.prepararCambioDePlan(e.GYMAPP.storage.getData(), b, { ahora: AHORA });
  assert.match(real.plan.plan_id, /^plan-./, "generador real");
});

test("un ejercicio con el mismo nombre que uno del plan anterior recibe un ID distinto", () => {
  const e = entorno();
  const anterior = e.GYMAPP.planes.planActivo(e.GYMAPP.storage.getData());
  const nombre = anterior.dias[0].ejercicios[0].nombre;
  const r = activar(e, "Día 1\n" + nombre + " 4x8");
  assert.equal(r.plan.dias[0].ejercicios[0].nombre, nombre);
  assert.notEqual(r.plan.dias[0].ejercicios[0].id, anterior.dias[0].ejercicios[0].id);
});

test("importar dos veces: segunda activación también pasa por todo; aviso si coincide con el activo", () => {
  const e = entorno();
  const texto = LINEAS_PLAN_EJEMPLO.join("\n");
  activar(e, texto);
  const activo = e.GYMAPP.planes.planActivo(e.GYMAPP.storage.getData());
  assert.equal(e.GYMAPP.planes.borradorCoincideConPlan(parsear(e, texto), activo), true);
  assert.equal(e.GYMAPP.planes.borradorCoincideConPlan(parsear(e, texto.replace("4x10", "3x10")), activo), false);
  const segunda = activar(e, texto);
  assert.equal(segunda.ok, true);
  const d = e.leer(CLAVE);
  assert.equal(d.rutina.planes.length, 4, "legacy + migrado + 2 importados");
  assert.equal(d.rutina.planes[2].archivado_en, AHORA);
  assert.equal(d.rutina.planes[3].version_de, d.rutina.planes[2].plan_id);
});

/* --- 41. Plan A → sesión A → plan B → sesión B --- */

test("41. plan A, sesión E5 bajo A, activar B: A archivado, sesión intacta; sesión nueva bajo B con snapshot de B", () => {
  const e = entorno();
  const P = e.GYMAPP.planes;
  const planA = P.planActivo(e.GYMAPP.storage.getData());
  const sesionA = { id: "sA", fecha: "2026-11-08T15:00:00.000Z", tipo: "gimnasio", dia_rutina_id: planA.dias[0].id, duracion_min: 60, rpe: 8, notas: "",
    ejercicios_realizados: [{ ejercicio_id: planA.dias[0].ejercicios[0].id, series: [{ peso_kg: 60, reps: 8 }] }], futbol_detalle: null };
  const vA = P.vincularSesionAlPlanActivo(e.GYMAPP.storage.getData(), sesionA);
  e.GYMAPP.storage.updateData((d) => { d.sesiones_entrenamiento.push(vA.sesion); }, { alertaAutomatica: false });
  const sesionAGuardada = JSON.stringify(e.leer(CLAVE).sesiones_entrenamiento.find((s) => s.id === "sA"));

  const r = activar(e);
  assert.equal(r.ok, true);
  const d = e.GYMAPP.storage.getData();
  assert.ok(d.rutina.planes.find((p) => p.plan_id === planA.plan_id).archivado_en, "A archivado");
  assert.equal(d.rutina.plan_activo_id, r.plan.plan_id, "B activo");
  const sA = e.leer(CLAVE).sesiones_entrenamiento.find((s) => s.id === "sA");
  assert.equal(sA.plan_id, planA.plan_id);
  assert.equal(JSON.stringify(sA), sesionAGuardada, "sesión A byte a byte");
  assert.equal(e.GYMAPP.rutinasHistoricas.resolverNombreDiaDeSesion(d, sA), planA.dias[0].nombre, "resuelve contra A archivado");
  assert.equal(e.GYMAPP.rutinasHistoricas.resolverEjercicioDeSesion(d, sA, sA.ejercicios_realizados[0]).nombre, planA.dias[0].ejercicios[0].nombre);

  /* Entrenar ofrece solo los días de B; una sesión nueva queda bajo B. */
  assert.deepEqual(clonar(P.diasDelPlanActivo(d).map((x) => x.nombre)), ["DÍA 1 - EMPUJE", "DÍA 2 - TRACCIÓN"]);
  const diaB = P.diasDelPlanActivo(d)[0];
  const vB = P.vincularSesionAlPlanActivo(d, { id: "sB", fecha: "2026-11-09T15:00:00.000Z", tipo: "gimnasio", dia_rutina_id: diaB.id, duracion_min: 60, rpe: 8, notas: "",
    ejercicios_realizados: [{ ejercicio_id: diaB.ejercicios[0].id, series: [{ peso_kg: 62.5, reps: 7 }] }], futbol_detalle: null });
  assert.equal(vB.ok, true);
  assert.equal(vB.sesion.plan_id, r.plan.plan_id);
  assert.deepEqual(clonar(vB.sesion.ejercicios_realizados[0].prescripcion_snapshot), { nombre: "Press banca c/barra", grupo_muscular: null, series_objetivo: 4,
    reps_objetivo: "6-8", rir_objetivo: 2, rpe_objetivo: 8, peso_objetivo: null, pausa: "2 min" });
  /* Una sesión con un día de A ya no se puede crear (A no es el activo). */
  assert.equal(P.vincularSesionAlPlanActivo(d, sesionA).ok, false);
  e.GYMAPP.storage.updateData((x) => { x.sesiones_entrenamiento.push(vB.sesion); }, { alertaAutomatica: false });
  assert.equal(e.GYMAPP.storage.validarDatosV3(e.leer(CLAVE)), null);
});

test("historial de planes (E4) muestra legacy + el plan archivado; el nuevo no aparece", () => {
  const e = entorno();
  const anteriorId = e.leer(CLAVE).rutina.plan_activo_id;
  const r = activar(e);
  const hist = e.GYMAPP.planes.planesHistoricos(e.GYMAPP.storage.getData()).map((p) => p.plan_id);
  assert.deepEqual(clonar(hist), [PLAN_LEGACY, anteriorId]);
  assert.ok(!hist.includes(r.plan.plan_id));
});

/* --- 42. Backup import y 43. sync --- */

test("42. backup schema 3 con varios planes y sesiones ligadas a distintos plan_id se importa tal cual", () => {
  const e = entorno();
  activar(e);
  const d = e.GYMAPP.storage.getData();
  const dia = e.GYMAPP.planes.diasDelPlanActivo(d)[0];
  const v = e.GYMAPP.planes.vincularSesionAlPlanActivo(d, { id: "sB", fecha: "2026-11-09T15:00:00.000Z", tipo: "gimnasio", dia_rutina_id: dia.id, duracion_min: 60, rpe: 8, notas: "",
    ejercicios_realizados: [{ ejercicio_id: dia.ejercicios[0].id, series: [{ peso_kg: 1, reps: 1 }] }], futbol_detalle: null });
  e.GYMAPP.storage.updateData((x) => { x.sesiones_entrenamiento.push(v.sesion); }, { alertaAutomatica: false });
  const exportado = e.leer(CLAVE);
  const destino = entorno(aE3(datasetHistoricos()));
  destino.cargar("js/backupImport.js");
  const r = destino.GYMAPP.backupImport.prepararImportacionBackup(JSON.stringify(exportado));
  assert.equal(r.ok, true, r.error);
  assert.equal(JSON.stringify(r.datos), JSON.stringify(exportado));
  ["schema 2", "schema 3 pre-E3"].forEach((n, k) => {
    const viejo = k === 0 ? datasetHistoricos({ legacy: true }) : clonar(exportado);
    if (k === 1) viejo.rutina.planes = viejo.rutina.planes.filter((p) => p.plan_id !== PLAN_LEGACY);
    assert.equal(destino.GYMAPP.backupImport.prepararImportacionBackup(JSON.stringify(viejo)).ok, true, n);
  });
});

test("43. después de activar, 'Sincronizar ahora' sube una revisión normal", async () => {
  const e = crearEntorno({ ahora: "2026-11-09T12:00:00", modulos: ["js/pdfImport.js"] });
  e.login("uid-A");
  const d = aE3(datasetHistoricos({ legacy: true }));
  e.escribir(CLAVE, d);
  e.nube.fila = { data: clonar(d), schema_version: 3, revision: 5, updated_at: "x" };
  e.escribir(META, { user_id: "uid-A", last_known_revision: 5, last_sync_at: "x" });
  const r = activar(e);
  assert.equal(r.ok, true);
  const c = crearContenedor();
  e.GYMAPP.sync.bindEventosSincronizacion(c);
  c.click("sincronizar-ahora"); await esperar();
  assert.equal(e.nube.fila.revision, 6);
  assert.equal(e.nube.fila.data.rutina.plan_activo_id, r.plan.plan_id);
  assert.equal(e.nube.fila.data.rutina.planes.length, 3);
});
