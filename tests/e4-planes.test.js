/* E4: plan activo (metadata y vigencia) e Historial de planes.
   Correr con: node --test tests/*.test.js */
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { crearEntorno, crearContenedor, esperar, clonar, aE3 } = require("./entorno");
const { datasetHistoricos } = require("./fixtures/historicos-dataset");

const CLAVE = "gymNutritionTracker";
const META = "gymNutritionTracker_syncMeta";
const PLAN_LEGACY = "plan-hist-mu4c87ep730qj1";
const HOY = "2026-11-09";

const datos = () => aE3(datasetHistoricos({ legacy: true }));
const activoDe = (d) => d.rutina.planes.find((p) => p.plan_id === d.rutina.plan_activo_id);

function entorno(d, opciones) {
  const e = crearEntorno(Object.assign({ sinSync: true, ahora: HOY + "T12:00:00", modulos: ["js/actividades.js", "js/rutina.js"] }, opciones || {}));
  e.escribir(CLAVE, d || datos());
  return e;
}
const conMetadata = (nombre, inicio, fin) => {
  const d = datos();
  Object.assign(activoDe(d), { nombre, fecha_inicio: inicio, fecha_fin: fin });
  return d;
};
const textoDe = (html) => html.replace(/<[^>]+>/g, "|").split("|").map((x) => x.trim()).filter(Boolean);

/* --- Plan activo (1-10) --- */

test("1. nombre null → 'Plan actual' (solo visual: no se escribe en los datos)", () => {
  const e = entorno();
  const d = e.GYMAPP.storage.getData();
  const t = textoDe(e.GYMAPP.rutina.renderTarjetaPlanActivo(d, HOY));
  assert.deepEqual(t.slice(0, 3), ["Plan activo", "Plan actual", "Sin fechas definidas"]);
  assert.equal(activoDe(e.leer(CLAVE)).nombre, null);
  assert.deepEqual(e.localStorage._escrituras, []);
  assert.match(e.GYMAPP.rutina.renderTarjetaPlanActivo(d, HOY), /data-accion="editar-plan"[^>]*>Editar plan</);
  assert.match(e.GYMAPP.rutina.renderTarjetaPlanActivo(d, HOY), /data-accion="historial-planes"[^>]*>Historial de planes</);
});

test("2. nombre real se muestra (escapado)", () => {
  const e = entorno(conMetadata("Plan N.º 4 <b>", null, null));
  const html = e.GYMAPP.rutina.renderTarjetaPlanActivo(e.GYMAPP.storage.getData(), HOY);
  assert.match(html, /Plan N\.º 4 &lt;b&gt;/);
});

test("3-6. vigencia: sin fechas, solo inicio, solo fin, inicio + fin (DD/MM/YYYY)", () => {
  const R = entorno().GYMAPP.rutina;
  assert.equal(R.textoVigencia({ fecha_inicio: null, fecha_fin: null }), "Sin fechas definidas");
  assert.equal(R.textoVigencia({ fecha_inicio: "2026-10-12", fecha_fin: null }), "Desde 12/10/2026");
  assert.equal(R.textoVigencia({ fecha_inicio: null, fecha_fin: "2026-12-18" }), "Hasta 18/12/2026");
  assert.equal(R.textoVigencia({ fecha_inicio: "2026-10-12", fecha_fin: "2026-12-18" }), "12/10/2026 – 18/12/2026");
  assert.equal(R.textoVigencia({ fecha_inicio: "2026-02-30", fecha_fin: "basura" }), "Sin fechas definidas", "fechas inválidas no se muestran");
});

test("tarjeta: semana, futuro y finalizado", () => {
  const tarjeta = (i, f, hoy) => textoDe(entorno(conMetadata("P", i, f)).GYMAPP.rutina.renderTarjetaPlanActivo(entorno(conMetadata("P", i, f)).GYMAPP.storage.getData(), hoy));
  assert.deepEqual(tarjeta("2026-10-12", "2026-12-18", HOY).slice(2, 4), ["12/10/2026 – 18/12/2026", "Semana 5 de 10"]);
  assert.deepEqual(tarjeta("2026-10-12", null, HOY).slice(2, 4), ["Desde 12/10/2026", "Semana 5"]);
  assert.deepEqual(tarjeta("2026-11-16", "2027-01-10", HOY).slice(2, 4), ["16/11/2026 – 10/01/2027", "Comienza el 16/11/2026"]);
  assert.deepEqual(tarjeta("2026-08-01", "2026-10-31", HOY).slice(2, 4), ["01/08/2026 – 31/10/2026", "Plan finalizado"]);
  assert.equal(tarjeta(null, "2026-12-18", HOY)[3], "Editar plan", "solo fin: sin línea de semana");
});

test("7. validación: fin anterior a inicio, fechas inválidas; vacío → null; nombre recortado", () => {
  const P = entorno().GYMAPP.planes;
  assert.deepEqual(clonar(P.validarMetadataPlan({ nombre: "x", fecha_inicio: "2026-12-18", fecha_fin: "2026-10-12" })),
    { ok: false, error: "La fecha de fin no puede ser anterior a la de inicio." });
  assert.equal(P.validarMetadataPlan({ fecha_inicio: "2026-02-30" }).ok, false);
  assert.equal(P.validarMetadataPlan({ fecha_fin: "12/10/2026" }).ok, false);
  assert.equal(P.validarMetadataPlan({ fecha_inicio: "2026-10-12", fecha_fin: "2026-10-12" }).ok, true, "mismo día es válido");
  assert.deepEqual(clonar(P.validarMetadataPlan({ nombre: "  Plan 4  ", fecha_inicio: "", fecha_fin: " " })),
    { ok: true, valores: { nombre: "Plan 4", fecha_inicio: null, fecha_fin: null } });
  assert.deepEqual(clonar(P.validarMetadataPlan({ nombre: "   " }).valores), { nombre: null, fecha_inicio: null, fecha_fin: null });
});

test("actualizarMetadataPlanActivo con valores inválidos falla sin tocar nada", () => {
  const e = entorno();
  const d = clonar(e.GYMAPP.storage.getData());
  const antes = JSON.stringify(d);
  assert.throws(() => e.GYMAPP.planes.actualizarMetadataPlanActivo(d, { fecha_inicio: "2026-12-18", fecha_fin: "2026-10-12" }), /anterior/);
  assert.equal(JSON.stringify(d), antes);
});

test("8-10. editar metadata: solo cambian nombre y fechas del plan activo", () => {
  const e = entorno();
  const antes = e.leer(CLAVE);
  const r = e.GYMAPP.storage.updateData((d) => {
    e.GYMAPP.planes.actualizarMetadataPlanActivo(d, { nombre: "Plan N.º 4", fecha_inicio: "2026-10-12", fecha_fin: "2026-12-18" });
  }, { alertaAutomatica: false });
  assert.equal(r.guardado, true);
  const g = e.leer(CLAVE);
  const a = activoDe(g);
  assert.deepEqual([a.nombre, a.fecha_inicio, a.fecha_fin], ["Plan N.º 4", "2026-10-12", "2026-12-18"]);
  assert.equal(JSON.stringify(a.dias), JSON.stringify(activoDe(antes).dias), "8. días intactos");
  assert.equal(JSON.stringify(g.sesiones_entrenamiento), JSON.stringify(antes.sesiones_entrenamiento), "9. sesiones intactas");
  assert.equal(g.rutina.plan_activo_id, antes.rutina.plan_activo_id, "10. plan_activo_id intacto");
  assert.equal(JSON.stringify(g.rutina.planes[0]), JSON.stringify(antes.rutina.planes[0]), "plan histórico intacto");
  assert.equal(g.schema_version, 3);
  assert.equal(g.rutina.planes.length, 2, "no crea versión nueva");
  Object.assign(activoDe(g), { nombre: null, fecha_inicio: null, fecha_fin: null });
  assert.equal(JSON.stringify(g), JSON.stringify(antes), "nada más cambió");
  assert.equal(e.GYMAPP.storage.validarDatosV3(e.leer(CLAVE)), null);
});

/* --- Tiempo (11-18) --- */

test("11-17. calcularEstadoTemporalPlan", () => {
  const T = (i, f, hoy) => clonar(entorno().GYMAPP.planes.calcularEstadoTemporalPlan({ fecha_inicio: i, fecha_fin: f }, hoy));
  const I = "2026-10-12", F = "2026-12-18";   // 68 días → 10 semanas
  assert.deepEqual(T(null, null, HOY), { estado: "sin_fechas", semana_actual: null, semanas_totales: null, semanas_restantes: null });
  assert.deepEqual(T(I, F, "2026-10-11"), { estado: "futuro", semana_actual: null, semanas_totales: 10, semanas_restantes: 10 }, "11. futuro");
  assert.deepEqual(T(I, F, "2026-10-12"), { estado: "vigente", semana_actual: 1, semanas_totales: 10, semanas_restantes: 9 }, "12. primer día");
  assert.equal(T(I, F, "2026-10-18").semana_actual, 1, "13. séptimo día");
  assert.equal(T(I, F, "2026-10-19").semana_actual, 2, "14. octavo día");
  assert.deepEqual(T(I, F, "2026-12-18"), { estado: "vigente", semana_actual: 10, semanas_totales: 10, semanas_restantes: 0 }, "15. fecha final");
  assert.deepEqual(T(I, F, "2026-12-19"), { estado: "finalizado", semana_actual: null, semanas_totales: 10, semanas_restantes: 0 }, "16. finalizado");
  assert.equal(T("2026-10-12", "2026-10-18", HOY).semanas_totales, 1, "17. 7 días = 1 semana");
  assert.equal(T("2026-10-12", "2026-10-19", HOY).semanas_totales, 2, "17. 8 días = 2 semanas");
  assert.equal(T("2026-10-12", "2026-10-12", HOY).semanas_totales, 1, "17. 1 día = 1 semana");
  assert.equal(T("2026-12-28", "2027-01-03", "2027-01-03").semana_actual, 1, "cruce de año");
  assert.equal(T("2028-02-26", "2028-03-03", "2028-03-03").semanas_totales, 1, "año bisiesto: 26/02–03/03 incluye el 29/02 = 7 días");
  assert.equal(T("2028-02-26", "2028-03-04", "2028-03-04").semana_actual, 2, "año bisiesto: 04/03 es el día 8");
  assert.equal(T("2027-02-26", "2027-03-04", "2027-03-04").semanas_totales, 1, "año no bisiesto: 26/02–04/03 = 7 días");
  assert.deepEqual(T(I, null, "2027-01-01"), { estado: "vigente", semana_actual: 12, semanas_totales: null, semanas_restantes: null }, "solo inicio");
  assert.deepEqual(T(null, F, "2026-12-19"), { estado: "finalizado", semana_actual: null, semanas_totales: null, semanas_restantes: null }, "solo fin");
});

test("18. sin drift de zona horaria: mismos resultados en Argentina, UTC, UTC+14 y UTC-11", () => {
  const script = `
    const { crearEntorno } = require(${JSON.stringify(path.join(__dirname, "entorno"))});
    const e = crearEntorno({ sinSync: true });
    const P = e.GYMAPP.planes;
    const r = ["2026-10-11", "2026-10-12", "2026-10-18", "2026-10-19", "2026-12-18", "2026-12-19"]
      .map((h) => P.calcularEstadoTemporalPlan({ fecha_inicio: "2026-10-12", fecha_fin: "2026-12-18" }, h));
    const d = { rutina: { plan_activo_id: "x", planes: [{ plan_id: "x", dias: [] }, { plan_id: "h", dias: [{ id: "a", ejercicios: [] }] }] },
      sesiones_entrenamiento: [{ id: "1", fecha: "2026-09-15T23:30:00", dia_rutina_id: "a" }, { id: "2", fecha: "2026-10-01T00:15:00", dia_rutina_id: "a" }] };
    const textos = [e.GYMAPP.util.fechaLocalISO(new Date(2026, 9, 12, 23, 59))];
    process.stdout.write(JSON.stringify({ r, rango: P.rangoObservadoPlan(d, "h"), textos }));`;
  const correr = (tz) => execFileSync(process.execPath, ["-e", script], { env: Object.assign({}, process.env, { TZ: tz }) }).toString();
  const base = correr("America/Argentina/Buenos_Aires");
  assert.deepEqual(JSON.parse(base).rango, { desde: "2026-09-15", hasta: "2026-10-01" });
  assert.equal(JSON.parse(base).textos[0], "2026-10-12", "23:59 del 12/10 sigue siendo el 12/10");
  ["UTC", "Pacific/Kiritimati", "Pacific/Pago_Pago"].forEach((tz) => assert.equal(correr(tz), base, tz));
});

/* --- Historial (19-26) --- */

test("19-25. historial: solo planes no activos, plan legacy con 5 días, 54 ejercicios, sesiones y rango", () => {
  const e = entorno();
  const d = e.GYMAPP.storage.getData();
  const P = e.GYMAPP.planes;
  const hist = P.planesHistoricos(d);
  assert.deepEqual(clonar(hist.map((p) => p.plan_id)), [PLAN_LEGACY], "19-20");
  assert.equal(hist[0].dias.length, 5, "21");
  assert.equal(hist[0].dias.reduce((n, x) => n + x.ejercicios.length, 0), 54, "22");
  const legacyIds = hist[0].dias.map((x) => x.id);
  const esperadas = d.sesiones_entrenamiento.filter((s) => legacyIds.includes(s.dia_rutina_id)).length;
  assert.equal(P.cantidadSesionesPlan(d, PLAN_LEGACY), esperadas, "23");
  assert.equal(esperadas, 22);
  assert.equal(P.cantidadSesionesPlan(d, d.rutina.plan_activo_id), 20, "el activo cuenta solo sus días");
  assert.equal(P.cantidadSesionesPlan(d, "no-existe"), 0);
  assert.deepEqual(clonar(P.rangoObservadoPlan(d, PLAN_LEGACY)), { desde: "2026-09-15", hasta: "2026-10-15" }, "24");
  assert.equal(P.rangoObservadoPlan({ rutina: { planes: [{ plan_id: "v", dias: [] }] }, sesiones_entrenamiento: [] }, "v"), null);
  assert.equal(hist[0].fecha_inicio, null, "25. vigencia desconocida sigue en null");
  assert.equal(hist[0].fecha_fin, null, "25");
  assert.deepEqual(e.localStorage._escrituras, [], "consultar no escribe");
});

test("historial (HTML): tarjeta del plan legacy, sin 'legacy' visible, y el activo no aparece", () => {
  const e = entorno(conMetadata("Plan N.º 4", "2026-10-12", "2026-12-18"));
  const html = e.GYMAPP.rutina.renderModalHistorialPlanes(e.GYMAPP.storage.getData());
  const t = textoDe(html);
  assert.ok(t.includes("Plan anterior (reconstruido)"));
  assert.ok(t.includes("Origen: Histórico"));
  assert.ok(t.includes("Sin fechas definidas"));
  assert.ok(t.includes("5 días · 54 ejercicios · 22 sesiones registradas"));
  assert.ok(t.includes("Actividad observada: 15/09/2026 – 15/10/2026"));
  assert.doesNotMatch(html, /legacy|backup_legacy_reconstruido/i);
  assert.doesNotMatch(html, /Plan N\.º 4/);
  const sin = entorno(aE3(datasetHistoricos()));
  assert.match(sin.GYMAPP.rutina.renderModalHistorialPlanes(sin.GYMAPP.storage.getData()), /Todavía no hay planes anteriores/);
});

test("26. detalle del plan histórico: solo lectura, con series × reps y grupo", () => {
  const e = entorno();
  const d = e.GYMAPP.storage.getData();
  const html = e.GYMAPP.rutina.renderModalDetallePlan(d, PLAN_LEGACY);
  assert.doesNotMatch(html, /<input|<select|<textarea|contenteditable/);
  const acciones = [...html.matchAll(/data-accion="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(acciones)].sort(), ["cerrar-modal", "historial-planes"], "sin borrar/reactivar/importar");
  assert.equal((html.match(/<details class="plan-dia">/g) || []).length, 5);
  assert.equal((html.match(/class="plan-ejercicio"/g) || []).length, 54);
  assert.match(html, /PRESS BANCA C\/BARRA<\/span><span class="plan-ejercicio-dato">4 × 6-8<\/span><span class="plan-ejercicio-dato">Pecho</);
  assert.match(html, /Solo lectura/);
  /* El plan activo no se abre como histórico. */
  assert.match(e.GYMAPP.rutina.renderModalDetallePlan(d, d.rutina.plan_activo_id), /Historial de planes/);
  assert.doesNotMatch(e.GYMAPP.rutina.renderModalDetallePlan(d, d.rutina.plan_activo_id), /<details/);
  assert.deepEqual(e.localStorage._escrituras, []);
});

test("Editar plan (HTML): solo nombre y fechas, labels reales y valores actuales", () => {
  const e = entorno(conMetadata("Plan \"4\"", "2026-10-12", null));
  const html = e.GYMAPP.rutina.renderModalEditarPlan(e.GYMAPP.storage.getData());
  assert.equal((html.match(/<input /g) || []).length, 3);
  ["plan-nombre", "plan-fecha-inicio", "plan-fecha-fin"].forEach((id) => assert.match(html, new RegExp('<label for="' + id + '">')));
  assert.match(html, /id="plan-nombre"[^>]*value="Plan &quot;4&quot;"/);
  assert.match(html, /id="plan-fecha-inicio" name="fecha_inicio" type="date" value="2026-10-12"/);
  assert.match(html, /id="plan-fecha-fin" name="fecha_fin" type="date" value=""/);
  assert.match(html, /role="dialog" aria-modal="true"/);
});

/* --- Regresión: el plan activo sigue siendo el único entrenable --- */

test("tras editar metadata: Entrenar, PROG-04 y Progreso histórico dan lo mismo", () => {
  const mods = { modulos: ["js/actividades.js", "js/progreso.js", "js/entrenamiento.js", "js/rutina.js"] };
  const a = entorno(datos(), mods);
  const b = entorno(conMetadata("Plan N.º 4", "2026-10-12", "2026-12-18"), mods);
  const dA = a.GYMAPP.storage.getData(), dB = b.GYMAPP.storage.getData();
  assert.deepEqual(clonar(b.GYMAPP.planes.diasDelPlanActivo(dB).map((x) => x.id)), ["D1", "D2", "D3", "D4", "D5"]);
  const P = (e) => e.GYMAPP.progreso;
  assert.deepEqual(clonar(P(b).calcularEstadoPlan(P(b).construirInputEstadoPlan(dB, HOY))), clonar(P(a).calcularEstadoPlan(P(a).construirInputEstadoPlan(dA, HOY))));
  assert.deepEqual(clonar(P(b).construirOpcionesBloquesHistoricos(dB)), clonar(P(a).construirOpcionesBloquesHistoricos(dA)));
  assert.equal(b.GYMAPP.entrenamiento.renderHistorial(dB), a.GYMAPP.entrenamiento.renderHistorial(dA));
});

test("SYNC: editar metadata y 'Sincronizar ahora' sube una revisión normal", async () => {
  const e = crearEntorno({ ahora: HOY + "T12:00:00" });
  e.login("uid-A");
  const d = datos();
  e.escribir(CLAVE, d);
  e.nube.fila = { data: clonar(d), schema_version: 3, revision: 3, updated_at: "2026-10-19T10:00:00Z" };
  e.escribir(META, { user_id: "uid-A", last_known_revision: 3, last_sync_at: "2026-10-19T10:00:00Z" });
  e.GYMAPP.storage.updateData((x) => e.GYMAPP.planes.actualizarMetadataPlanActivo(x, { nombre: "Plan N.º 4", fecha_inicio: "2026-10-12", fecha_fin: "2026-12-18" }), { alertaAutomatica: false });
  const c = crearContenedor();
  e.GYMAPP.sync.bindEventosSincronizacion(c);
  c.click("sincronizar-ahora"); await esperar();
  const rpc = e.nube.llamadas.filter((l) => l.tipo === "rpc");
  assert.deepEqual(rpc.map((x) => x.nombre), ["actualizar_datos_usuario_seguro"]);
  assert.equal(rpc[0].params.p_expected_revision, 3);
  assert.equal(e.nube.fila.revision, 4);
  assert.equal(activoDe(e.nube.fila.data).nombre, "Plan N.º 4");
  assert.equal(e.leer(META).last_known_revision, 4);
});

test("backup: exportar e importar conserva la metadata del plan activo (sin cambios de formato)", () => {
  const original = conMetadata("Plan N.º 4", "2026-10-12", "2026-12-18");
  const e = entorno(aE3(datasetHistoricos()));
  e.cargar("js/backupImport.js");
  const r = e.GYMAPP.backupImport.prepararImportacionBackup(JSON.stringify(original));
  assert.equal(r.ok, true, r.error);
  assert.equal(JSON.stringify(r.datos), JSON.stringify(original));
});
