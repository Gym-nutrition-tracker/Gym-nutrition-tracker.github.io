/* ONB-03: estado de primer uso, tarjeta del Dashboard, guía de 4 pasos y
   persistencia de data.onboarding. La UI completa (Rutina, Entrenar,
   Progreso, tour en el navegador) está en tests/e2e/primer-uso.e2e.js.
   Correr con: node --test tests/*.test.js */
const test = require("node:test");
const assert = require("node:assert/strict");
const { crearEntorno, esperar, clonar, aE3 } = require("./entorno");
const { datasetHistoricos } = require("./fixtures/historicos-dataset");

const CLAVE = "gymNutritionTracker";

/* Datos de prueba (schema 3). */
const historial = () => aE3(datasetHistoricos({ legacy: true }));
function vacio(e) { return clonar(e.GYMAPP.storage.getDefaultData()); }
function conPlan(e) {
  const d = historial();
  d.sesiones_entrenamiento = [];
  return d;
}
function conSesiones(n) {
  const d = historial();
  d.sesiones_entrenamiento = d.sesiones_entrenamiento.slice(0, n);
  return d;
}

/* DOM mínimo para la guía: nodos de la barra (objetivos de cada paso) y
   un contenedor #guia-inicio con su handler de click. */
function conDom(e) {
  const clases = () => {
    const s = new Set();
    return { add: (c) => s.add(c), remove: (c) => s.delete(c), contains: (c) => s.has(c) };
  };
  const nodos = {};
  ["#btn-rutina", "#nav-entrenar", "#nav-progreso", "#nav-nutricion"].forEach((sel) => { nodos[sel] = { classList: clases() }; });
  const dom = { contenedor: null, teclado: null, body: { classList: clases() } };
  dom.body.appendChild = (n) => { dom.contenedor = n; n.parentNode = dom.body; };
  dom.body.removeChild = (n) => { if (dom.contenedor === n) dom.contenedor = null; };
  const doc = e.ctx.document;
  const crear = doc.createElement;
  doc.body = dom.body;
  doc.getElementById = (id) => (id === "guia-inicio" && dom.contenedor ? dom.contenedor : null);
  doc.querySelector = (sel) => nodos[sel] || null;
  doc.querySelectorAll = (sel) => (sel === ".guia-objetivo" ? Object.values(nodos).filter((n) => n.classList.contains("guia-objetivo")) : []);
  doc.createElement = (t) => {
    if (t !== "div") return crear(t);
    const n = { id: "", innerHTML: "", handler: null };
    n.addEventListener = (tipo, fn) => { if (tipo === "click") n.handler = fn; };
    n.querySelector = () => ({ focus() {} });
    return n;
  };
  dom.nodos = nodos;
  dom.click = (accion) => dom.contenedor.handler({ target: { closest: () => ({ dataset: { guia: accion } }) } });
  dom.objetivo = () => Object.keys(nodos).find((k) => nodos[k].classList.contains("guia-objetivo")) || null;
  return dom;
}

function entorno(datos, opciones) {
  const e = crearEntorno(Object.assign({ ahora: "2026-11-09T12:00:00", sinSync: true }, opciones || {}));
  if (datos) e.escribir(CLAVE, typeof datos === "function" ? datos(e) : datos);
  return e;
}
const estado = (datos) => { const e = entorno(datos); return clonar(e.GYMAPP.primerUso.estadoInicial(e.GYMAPP.storage.getData())); };
const tarjeta = (datos) => { const e = entorno(datos); return e.GYMAPP.primerUso.renderTarjetaDashboard(e.GYMAPP.storage.getData()); };

/* --- ESTADO --- */

test("1. sin plan (dato por defecto) → sin_plan, paso plan", () => {
  const r = estado(vacio);
  assert.equal(r.estado, "sin_plan");
  assert.equal(r.paso_sugerido, "plan");
  assert.equal(r.tiene_plan, false);
  assert.equal(r.tiene_entrenamientos, false);
  assert.equal(r.mostrar_onboarding, true);
});

test("2. plan activo con días pero sin ejercicios → sin_plan, paso plan", () => {
  const r = estado((e) => {
    const d = vacio(e);
    d.rutina.planes[0].dias = [{ id: "d1", nombre: "Día 1", orden: 1, ejercicios: [] }];
    return d;
  });
  assert.equal(r.estado, "sin_plan");
  assert.equal(r.paso_sugerido, "plan");
  assert.equal(r.tiene_plan, false);
});

test("3. plan con ejercicios y 0 sesiones → plan_sin_entrenamientos, paso entrenar", () => {
  const r = estado(conPlan);
  assert.equal(r.estado, "plan_sin_entrenamientos");
  assert.equal(r.paso_sugerido, "entrenar");
  assert.equal(r.tiene_plan, true);
  assert.equal(r.tiene_entrenamientos, false);
  assert.equal(r.mostrar_onboarding, true);
});

test("4. plan + 1 sesión → primer_entrenamiento, paso progreso", () => {
  const r = estado(conSesiones(1));
  assert.equal(r.estado, "primer_entrenamiento");
  assert.equal(r.paso_sugerido, "progreso");
  assert.equal(r.tiene_entrenamientos, true);
  assert.equal(r.mostrar_onboarding, false);
});

test("5. usuario con historial (sin flag de onboarding) → usuario_activo, sin guía automática", () => {
  const d = historial();
  assert.equal(d.onboarding, undefined, "el dato real de hoy no tiene el flag");
  const r = estado(d);
  assert.equal(r.estado, "usuario_activo");
  assert.equal(r.paso_sugerido, "completo");
  assert.equal(r.guia_automatica, false);
  assert.equal(r.mostrar_onboarding, false);
});

test("5b. cualquier uso previo desactiva la guía automática (sesión de otra actividad, nutrición, medidas)", () => {
  const otra = (e) => Object.assign(vacio(e), { sesiones_entrenamiento: [{ id: "s1", fecha: "2026-11-01", tipo: "correr" }] });
  const nutri = (e) => Object.assign(vacio(e), { registros_nutricion: [{ id: "n1", fecha: "2026-11-01" }] });
  const medidas = (e) => Object.assign(vacio(e), { medidas_corporales: [{ fecha: "2026-11-01", peso: 80 }] });
  [otra, nutri, medidas].forEach((f) => assert.equal(estado(f).guia_automatica, false));
  assert.equal(estado(otra).estado, "sin_plan", "sesiones de otra actividad no cuentan como gimnasio");
  assert.equal(estado(vacio).guia_automatica, true);
  assert.equal(estado(conPlan).guia_automatica, true, "plan cargado sin ningún uso: todavía es nuevo");
});

test("6. onboarding completado → no hay guía automática", () => {
  const r = estado((e) => Object.assign(vacio(e), { onboarding: { version: 1, completado: true } }));
  assert.equal(r.guia_automatica, false);
  assert.equal(r.estado, "sin_plan", "el estado de datos no depende del flag");
});

test("7. guía manual: se abre aunque el onboarding esté completado o haya historial", () => {
  const d = historial();
  d.onboarding = { version: 1, completado: true };
  const e = entorno(d);
  const dom = conDom(e);
  const U = e.GYMAPP.primerUso;
  U.mostrarGuiaSiCorresponde(e.GYMAPP.storage.getData());
  assert.equal(U.guiaAbierta(), false, "no se abre sola");
  U.abrirGuia();
  assert.equal(U.guiaAbierta(), true);
  assert.equal(U.pasoActual(), 0);
  assert.ok(dom.contenedor, "contenedor #guia-inicio creado");
});

/* --- DASHBOARD --- */

test("8-9. Dashboard sin plan: título, 3 pasos, CTA importar PDF y crear manual", () => {
  const html = tarjeta(vacio);
  assert.match(html, /Empezá configurando tu entrenamiento/);
  assert.match(html, /Cargá tu plan<\/li>/);
  assert.match(html, /Registrá tu primer entrenamiento<\/li>/);
  assert.match(html, /Seguimos tu progreso automáticamente<\/li>/);
  assert.match(html, /data-accion="inicio-importar-pdf"[^>]*>Importar plan desde PDF</);
  assert.match(html, /data-accion="inicio-crear-plan"[^>]*>Crear plan manualmente</);
  assert.match(html, /Nutrición es opcional/);
});

test("10. Dashboard con plan y 0 sesiones: 'Tu plan ya está listo' con CTA Entrenar", () => {
  const html = tarjeta(conPlan);
  assert.match(html, /Tu plan ya está listo/);
  assert.match(html, /data-accion="inicio-entrenar"[^>]*>Registrar primer entrenamiento</);
  assert.doesNotMatch(html, /inicio-importar-pdf/);
});

test("11. usuario que ya entrenó (1 o más sesiones): sin tarjeta grande", () => {
  assert.equal(tarjeta(conSesiones(1)), "");
  assert.equal(tarjeta(historial()), "");
});

test("acciones de las tarjetas: navegan a los flujos existentes y no escriben datos", () => {
  const e = entorno(vacio);
  const llamadas = [];
  e.GYMAPP.app = { irA: (tab, op) => llamadas.push([tab, op || null]) };
  const antes = e.localStorage._escrituras.length;
  const U = e.GYMAPP.primerUso;
  ["inicio-importar-pdf", "inicio-crear-plan", "inicio-entrenar", "inicio-ir-rutina"].forEach((a) => assert.equal(U.manejarAccion(a), true));
  assert.equal(U.manejarAccion("otra-accion"), false, "acciones ajenas siguen su camino");
  assert.deepEqual(clonar(llamadas), [
    ["rutina", { accion: "importar-pdf" }],
    ["rutina", { accion: "crear-plan" }],
    ["entrenar", null],
    ["rutina", null]
  ]);
  assert.equal(e.localStorage._escrituras.length, antes);
});

/* --- TOUR --- */

test("22. la guía tiene exactamente 4 pasos: Rutina, Entrenar, Progreso, Nutrición (opcional)", () => {
  const P = clonar(entorno().GYMAPP.primerUso.PASOS_GUIA);
  assert.equal(P.length, 4);
  assert.deepEqual(P.map((p) => p.titulo), ["Rutina", "Entrenar", "Progreso", "Nutrición (opcional)"]);
  assert.deepEqual(P.map((p) => p.objetivo), ["#btn-rutina", "#nav-entrenar", "#nav-progreso", "#nav-nutricion"]);
});

test("23. Siguiente / Atrás: avanza, retrocede, resalta el objetivo y no sale de 1..4", () => {
  const e = entorno(vacio);
  const dom = conDom(e);
  const U = e.GYMAPP.primerUso;
  U.abrirGuia();
  assert.match(dom.contenedor.innerHTML, /Paso 1 de 4/);
  assert.doesNotMatch(dom.contenedor.innerHTML, /data-guia="atras"/, "sin Atrás en el paso 1");
  assert.equal(dom.objetivo(), "#btn-rutina");
  dom.click("siguiente");
  assert.equal(U.pasoActual(), 1);
  assert.match(dom.contenedor.innerHTML, /Paso 2 de 4/);
  assert.match(dom.contenedor.innerHTML, /data-guia="atras"/);
  assert.equal(dom.objetivo(), "#nav-entrenar");
  dom.click("atras");
  assert.equal(U.pasoActual(), 0);
  assert.equal(dom.objetivo(), "#btn-rutina");
  U.irAPaso(-1);
  assert.equal(U.pasoActual(), 0);
  U.irAPaso(3);
  assert.match(dom.contenedor.innerHTML, /Paso 4 de 4/);
  assert.match(dom.contenedor.innerHTML, /data-guia="listo"[^>]*>Listo</);
  assert.doesNotMatch(dom.contenedor.innerHTML, /data-guia="siguiente"/);
  U.irAPaso(4);
  assert.equal(U.pasoActual(), 3, "no hay paso 5");
  assert.ok(dom.body.classList.contains("guia-activa"));
});

test("24. Omitir: cierra, limpia el resaltado y guarda onboarding completado", () => {
  const e = entorno(vacio);
  const dom = conDom(e);
  const U = e.GYMAPP.primerUso;
  U.mostrarGuiaSiCorresponde(e.GYMAPP.storage.getData());
  assert.equal(U.guiaAbierta(), true, "usuario nuevo: se abre sola");
  dom.click("omitir");
  assert.equal(U.guiaAbierta(), false);
  assert.equal(dom.contenedor, null, "el contenedor sale del DOM");
  assert.equal(dom.objetivo(), null);
  assert.equal(dom.body.classList.contains("guia-activa"), false);
  assert.deepEqual(e.leer(CLAVE).onboarding, { version: 1, completado: true });
});

test("25. Listo en el paso 4: guarda onboarding completado", () => {
  const e = entorno(vacio);
  const dom = conDom(e);
  const U = e.GYMAPP.primerUso;
  U.abrirGuia();
  dom.click("siguiente"); dom.click("siguiente"); dom.click("siguiente");
  dom.click("listo");
  assert.equal(U.guiaAbierta(), false);
  assert.deepEqual(e.leer(CLAVE).onboarding, { version: 1, completado: true });
});

test("26. cerrar (Escape usa cerrarGuia) guarda; cerrar sin guía abierta no escribe", () => {
  const e = entorno(vacio);
  conDom(e);
  const U = e.GYMAPP.primerUso;
  const antes = e.localStorage._escrituras.length;
  U.cerrarGuia();
  assert.equal(e.localStorage._escrituras.length, antes, "nada que cerrar: sin escrituras");
  U.abrirGuia();
  U.cerrarGuia();
  assert.deepEqual(e.leer(CLAVE).onboarding, { version: 1, completado: true });
});

test("27. después de completarla no reaparece sola; reabrirla y cerrarla no vuelve a escribir", () => {
  const e = entorno(vacio);
  conDom(e);
  const U = e.GYMAPP.primerUso;
  U.abrirGuia(); U.cerrarGuia();
  U.mostrarGuiaSiCorresponde(e.GYMAPP.storage.getData());
  assert.equal(U.guiaAbierta(), false);
  const antes = e.localStorage._escrituras.length;
  U.abrirGuia(); U.cerrarGuia();
  assert.equal(e.localStorage._escrituras.length, antes, "ya estaba completada");
});

test("28. usuario existente con historial no la ve automática", () => {
  const e = entorno(historial());
  conDom(e);
  e.GYMAPP.primerUso.mostrarGuiaSiCorresponde(e.GYMAPP.storage.getData());
  assert.equal(e.GYMAPP.primerUso.guiaAbierta(), false);
});

test("si guardar falla, la guía igual se cierra y no rompe", () => {
  const e = entorno(vacio);
  conDom(e);
  const U = e.GYMAPP.primerUso;
  U.abrirGuia();
  e.localStorage._fallas.add(CLAVE);
  U.cerrarGuia();
  assert.equal(U.guiaAbierta(), false);
  e.localStorage._fallas.delete(CLAVE);
  assert.equal(e.leer(CLAVE).onboarding, undefined);
});

/* --- PERSISTENCIA --- */

test("30-33. completar la guía solo agrega onboarding: schema 3, planes, sesiones y snapshots intactos", () => {
  const d = conSesiones(0);
  d.sesiones_entrenamiento = historial().sesiones_entrenamiento;
  /* Usuario con datos que abre la guía a mano y la cierra. */
  const e = entorno(d);
  conDom(e);
  const antes = e.leer(CLAVE);
  e.GYMAPP.primerUso.abrirGuia();
  e.GYMAPP.primerUso.cerrarGuia();
  const despues = e.leer(CLAVE);
  assert.equal(despues.schema_version, 3);
  assert.deepEqual(despues.rutina, antes.rutina);
  assert.deepEqual(despues.sesiones_entrenamiento, antes.sesiones_entrenamiento);
  assert.deepEqual(
    despues.sesiones_entrenamiento.map((s) => (s.ejercicios_realizados || []).map((x) => x.prescripcion_snapshot)),
    antes.sesiones_entrenamiento.map((s) => (s.ejercicios_realizados || []).map((x) => x.prescripcion_snapshot))
  );
  const sinFlag = clonar(despues);
  delete sinFlag.onboarding;
  assert.deepEqual(sinFlag, antes, "la única diferencia es data.onboarding");
});

test("30b. el dato por defecto no incluye onboarding (migraciones y backups sin cambios)", () => {
  const e = entorno();
  assert.equal(e.GYMAPP.storage.getDefaultData().onboarding, undefined);
  assert.equal(e.GYMAPP.storage.getDefaultData().schema_version, 3);
});

test("34. sync: data.onboarding viaja en el blob con schema_version 3 por la RPC existente", async () => {
  const e = entorno(vacio, { sinSync: false });
  conDom(e);
  e.login("uid-A");
  e.GYMAPP.primerUso.abrirGuia();
  e.GYMAPP.primerUso.cerrarGuia();
  await e.GYMAPP.sync.sincronizarAhora();
  await esperar();
  const rpc = e.nube.llamadas.filter((l) => l.tipo === "rpc");
  assert.deepEqual(rpc.map((r) => r.nombre), ["crear_datos_usuario_iniciales"]);
  assert.equal(rpc[0].params.p_schema_version, 3);
  assert.deepEqual(rpc[0].params.p_data.onboarding, { version: 1, completado: true });
  assert.deepEqual(e.nube.fila.data, e.leer(CLAVE));
});

test("34b. un blob con onboarding pasa la validación de schema 3 y no abre la guía", async () => {
  const e = entorno(vacio, { sinSync: false });
  e.login("uid-A");
  const remoto = Object.assign(vacio(e), { onboarding: { version: 1, completado: true } });
  e.nube.fila = { data: clonar(remoto), schema_version: 3, revision: 4, updated_at: "2026-10-18T10:00:00Z" };
  assert.equal(e.GYMAPP.storage.validarDatosV3(clonar(remoto)), null, "la validación de schema 3 acepta el campo");
  e.escribir(CLAVE, remoto);
  conDom(e);
  e.GYMAPP.primerUso.mostrarGuiaSiCorresponde(e.GYMAPP.storage.getData());
  assert.equal(e.GYMAPP.primerUso.guiaAbierta(), false);
  assert.deepEqual(e.leer(CLAVE).onboarding, { version: 1, completado: true });
});

/* --- PRIMER PLAN REAL: el plan activo sin ejercicios no pasa al historial --- */

const { LINEAS_PLAN_EJEMPLO } = require("./fixtures/pdf-sintetico");
const PRE_CAMBIO = "gymNutritionTracker_preCambioPlan";
const AHORA_ISO = "2026-11-09T15:00:00.000Z";

/* Mismo camino que rutina.activarPlanImportado: parsear → preparar → guardar. */
function activarPdf(e, texto) {
  const pdf = e.GYMAPP.pdfImport;
  const b = clonar(pdf.normalizarPlanParseado(pdf.parsearPlanDesdeTexto(texto || LINEAS_PLAN_EJEMPLO.join("\n"))));
  const p = e.GYMAPP.planes.prepararCambioDePlan(e.GYMAPP.storage.getData(), b, { ahora: AHORA_ISO, nombreArchivo: "plan.pdf" });
  assert.ok(p.ok, p.error);
  const g = e.GYMAPP.storage.guardarConCopiaPrevia(PRE_CAMBIO, p.datos, AHORA_ISO);
  assert.ok(g.ok);
  return { plan: clonar(p.plan), descartado: p.anteriorDescartado };
}
const entornoPdf = (datos) => entorno(datos, { modulos: ["js/pdfImport.js"] });

test("plan útil: definición por contenido (al menos un ejercicio)", () => {
  const P = entorno().GYMAPP.planes;
  assert.equal(P.planEsUtil(null), false);
  assert.equal(P.planEsUtil({ dias: [] }), false);
  assert.equal(P.planEsUtil({ dias: [{ ejercicios: [] }, { ejercicios: [] }] }), false);
  assert.equal(P.planEsUtil({ dias: [{ ejercicios: [] }, { ejercicios: [{ id: "x" }] }] }), true);
});

test("plan completamente vacío → el primer PDF no deja histórico; version_de null; planes solo el nuevo", () => {
  const e = entornoPdf(vacio);
  const antes = e.leer(CLAVE);
  const r = activarPdf(e);
  const d = e.leer(CLAVE);
  assert.equal(r.descartado, true);
  assert.equal(d.rutina.planes.length, 1, "planes contiene solo el nuevo plan");
  assert.equal(d.rutina.planes[0].plan_id, r.plan.plan_id);
  assert.equal(d.rutina.plan_activo_id, r.plan.plan_id);
  assert.equal(d.rutina.planes[0].version_de, null);
  assert.equal(clonar(e.GYMAPP.planes.planesHistoricos(d)).length, 0, "historial vacío");
  assert.equal(d.schema_version, 3);
  assert.deepEqual(d.sesiones_entrenamiento, antes.sesiones_entrenamiento);
  assert.deepEqual(JSON.parse(e.leer(PRE_CAMBIO).data_raw), antes, "la copia previa conserva el estado anterior");
});

test("plan con días pero 0 ejercicios → tampoco queda histórico", () => {
  const e = entornoPdf((x) => {
    const d = vacio(x);
    d.rutina.planes[0].dias = [{ id: "d1", nombre: "Día 1", orden: 1, ejercicios: [] }, { id: "d2", nombre: "Día 2", orden: 2, ejercicios: [] }];
    return d;
  });
  const r = activarPdf(e);
  const d = e.leer(CLAVE);
  assert.equal(r.descartado, true);
  assert.deepEqual(d.rutina.planes.map((p) => p.plan_id), [r.plan.plan_id]);
  assert.equal(d.rutina.planes[0].version_de, null);
});

test("plan con al menos 1 ejercicio → se archiva como en E6 y version_de apunta a él", () => {
  const e = entornoPdf((x) => {
    const d = vacio(x);
    d.rutina.planes[0].dias = [
      { id: "d1", nombre: "Día 1", orden: 1, ejercicios: [] },
      { id: "d2", nombre: "Día 2", orden: 2, ejercicios: [Object.assign({ id: "e1", nombre: "Sentadilla", orden: 1 }, { grupo_muscular: null, series_objetivo: null, reps_objetivo: null })] }
    ];
    return d;
  });
  const antes = e.leer(CLAVE);
  const idAnterior = antes.rutina.plan_activo_id;
  const r = activarPdf(e);
  const d = e.leer(CLAVE);
  assert.equal(r.descartado, false);
  assert.equal(d.rutina.planes.length, 2);
  const archivado = d.rutina.planes.find((p) => p.plan_id === idAnterior);
  assert.equal(archivado.archivado_en, AHORA_ISO);
  assert.deepEqual(archivado.dias, antes.rutina.planes[0].dias);
  assert.equal(r.plan.version_de, idAnterior);
});

test("primer PDF y después un segundo PDF: el primero sí se archiva y version_de apunta a él", () => {
  const e = entornoPdf(vacio);
  const primero = activarPdf(e);
  const antesSegundo = e.leer(CLAVE);
  const segundo = activarPdf(e, ["TRACCIÓN", "Dominadas toma neutra 4x6-8 RIR 1-2 RPE 9"].join("\n"));
  const d = e.leer(CLAVE);
  assert.equal(segundo.descartado, false);
  assert.deepEqual(d.rutina.planes.map((p) => p.plan_id), [primero.plan.plan_id, segundo.plan.plan_id]);
  assert.equal(d.rutina.plan_activo_id, segundo.plan.plan_id);
  assert.equal(d.rutina.planes[1].version_de, primero.plan.plan_id);
  assert.equal(d.rutina.planes[0].archivado_en, AHORA_ISO);
  const sinArchivo = clonar(d.rutina.planes[0]); sinArchivo.archivado_en = null;
  assert.deepEqual(sinArchivo, antesSegundo.rutina.planes[0], "el primer plan se conserva intacto salvo archivado_en");
  assert.equal(d.schema_version, 3);
});

test("usuario existente (historial): cambiar de plan sigue archivando y no toca sesiones ni snapshots", () => {
  const e = entornoPdf(historial());
  const antes = e.leer(CLAVE);
  const r = activarPdf(e);
  const d = e.leer(CLAVE);
  assert.equal(r.descartado, false);
  assert.equal(d.rutina.planes.length, antes.rutina.planes.length + 1);
  assert.equal(r.plan.version_de, antes.rutina.plan_activo_id);
  assert.deepEqual(d.sesiones_entrenamiento, antes.sesiones_entrenamiento);
  antes.rutina.planes.forEach((p, i) => {
    const sinArchivo = clonar(d.rutina.planes[i]); sinArchivo.archivado_en = p.archivado_en;
    assert.deepEqual(sinArchivo, p);
  });
});

test("plan sin ejercicios pero referenciado (sesión o version_de) → se archiva, no se pierde nada", () => {
  const P = entorno().GYMAPP.planes;
  const base = (x) => {
    const d = vacio(x);
    d.rutina.planes[0].dias = [{ id: "d1", nombre: "Día 1", orden: 1, ejercicios: [] }];
    return d;
  };
  const e1 = entorno(base);
  const conSesion = clonar(e1.GYMAPP.storage.getData());
  conSesion.sesiones_entrenamiento = [{ id: "s1", fecha: "2026-11-01", tipo: "gimnasio", dia_rutina_id: "d1" }];
  assert.equal(P.planDescartableAlReemplazar(conSesion, conSesion.rutina.planes[0]), false);
  const porPlanId = clonar(e1.GYMAPP.storage.getData());
  porPlanId.sesiones_entrenamiento = [{ id: "s1", fecha: "2026-11-01", tipo: "gimnasio", plan_id: porPlanId.rutina.plan_activo_id }];
  assert.equal(P.planDescartableAlReemplazar(porPlanId, porPlanId.rutina.planes[0]), false);
  const conVersion = clonar(e1.GYMAPP.storage.getData());
  conVersion.rutina.planes.unshift(Object.assign(clonar(conVersion.rutina.planes[0]), { plan_id: "otro", version_de: conVersion.rutina.plan_activo_id, archivado_en: "2026-10-01T00:00:00.000Z" }));
  assert.equal(P.planDescartableAlReemplazar(conVersion, conVersion.rutina.planes[1]), false);
  const libre = clonar(e1.GYMAPP.storage.getData());
  assert.equal(P.planDescartableAlReemplazar(libre, libre.rutina.planes[0]), true);
});

test("el descarte no depende del nombre, id ni origen del plan vacío", () => {
  const e = entornoPdf((x) => {
    const d = vacio(x);
    Object.assign(d.rutina.planes[0], { plan_id: "plan-cualquiera", nombre: "Mi plan", origen: "pdf" });
    d.rutina.plan_activo_id = "plan-cualquiera";
    return d;
  });
  const r = activarPdf(e);
  assert.equal(r.descartado, true);
  assert.deepEqual(e.leer(CLAVE).rutina.planes.map((p) => p.plan_id), [r.plan.plan_id]);
});
