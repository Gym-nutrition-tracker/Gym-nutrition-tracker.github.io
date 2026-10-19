/* E2E de E0: importación de backups desde Rutina (Chromium/Playwright).
   Uso: PLAYWRIGHT_PATH=$(npm root -g)/playwright node tests/e2e/backup-import.e2e.js */
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const { aV3, aE3 } = require("../entorno");
const { datasetHistoricos } = require("../fixtures/historicos-dataset");

const RAIZ = path.join(__dirname, "..", "..");
const TIPOS = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png" };

function servir(dir) {
  return new Promise((ok) => {
    const srv = http.createServer((req, res) => {
      const ruta = path.join(dir, decodeURIComponent(req.url.split("?")[0]).replace(/^\/+/, "") || "index.html");
      fs.readFile(ruta, (err, buf) => {
        if (err) { res.writeHead(404); res.end(); return; }
        res.writeHead(200, { "Content-Type": TIPOS[path.extname(ruta)] || "application/octet-stream" });
        res.end(buf);
      });
    });
    srv.listen(0, "127.0.0.1", () => ok(srv));
  });
}

const LOCALES = {
  schema_version: 2,
  usuario: { nombre: "Local", fecha_nacimiento: "1990-05-10", sexo: "masculino", peso_kg: 80, altura_cm: 178, objetivo: "mantenimiento", nivel_actividad: "moderado",
    metas_macros: { calorias: 2600, proteinas_g: 160, carbos_g: 300, grasas_g: 80 }, actividades: [{ tipo: "gimnasio", meta_semanal: 3 }] },
  rutina: { dias: [{ id: "L1", nombre: "Local A", ejercicios: [] }] },
  sesiones_entrenamiento: [], registros_nutricion: [], base_alimentos: [], medidas_corporales: []
};
const META = JSON.stringify({ user_id: "uid-A", last_known_revision: 7, last_sync_at: "2026-10-18T10:00:00Z" });

function backup(version) {
  const b = JSON.parse(JSON.stringify(LOCALES));
  b.usuario.nombre = "Importado";
  delete b.usuario.actividades;
  b.rutina.dias = [{ id: "B1", nombre: "Backup A", ejercicios: [{ id: "B1-e1", nombre: "Press", grupo_muscular: "Pecho", series_objetivo: 4, reps_objetivo: "10" }] }];
  if (version === 0) delete b.schema_version; else b.schema_version = version;
  return b;
}

async function abrir(browser, url, registro, respuestaConfirm) {
  const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
  page.on("pageerror", (e) => registro.errores.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") registro.errores.push(m.text()); });
  page.on("request", (r) => { if (/supabase\.co/.test(r.url())) registro.supabase.push(r.url()); });
  page.on("dialog", (d) => { registro.dialogos.push(d.type() + ": " + d.message()); (d.type() === "confirm" && !respuestaConfirm) ? d.dismiss() : d.accept(); });
  await page.addInitScript(([d, m]) => {
    if (!sessionStorage.getItem("sembrado")) { localStorage.setItem("gymNutritionTracker", d); localStorage.setItem("gymNutritionTracker_syncMeta", m); sessionStorage.setItem("sembrado", "1"); }
  }, [JSON.stringify(LOCALES), META]);
  await page.goto(url + "/index.html");
  await page.click("#btn-rutina");
  return page;
}

const subir = (page, nombre, contenido) => page.setInputFiles("#input-backup", { name: nombre, mimeType: "application/json", buffer: Buffer.from(contenido) });
const estado = (page) => page.evaluate(() => ({
  datos: localStorage.getItem("gymNutritionTracker"),
  meta: localStorage.getItem("gymNutritionTracker_syncMeta"),
  pre: localStorage.getItem("gymNutritionTracker_preImportBackup")
}));

(async () => {
  const srv = await servir(RAIZ);
  const url = "http://127.0.0.1:" + srv.address().port;
  const browser = await chromium.launch();
  const r = [];
  const check = (nombre, ok, detalle) => r.push({ nombre, ok: !!ok, detalle });
  const reg = { errores: [], supabase: [], dialogos: [] };

  try {
    /* 1. Import exitoso de un backup schema 1. */
    let page = await abrir(browser, url, reg, true);
    await Promise.all([page.waitForEvent("load"), subir(page, "viejo.json", JSON.stringify(backup(1)))]);
    let st = await estado(page);
    const datos = JSON.parse(st.datos);
    check("schema 1: importado y migrado a 3", datos.schema_version === 3 && datos.usuario.nombre === "Importado" && datos.usuario.actividades.length === 2, datos.schema_version);
    check("schema 1: rutina del backup como plan activo", datos.rutina.plan_activo_id === "plan-mig-B1" && datos.rutina.planes[0].dias[0].ejercicios[0].id === "B1-e1" && !("dias" in datos.rutina));
    check("schema 1: syncMeta invalidada", st.meta === null);
    check("schema 1: copia previa con los datos anteriores", st.pre && JSON.parse(st.pre).data_raw === JSON.stringify(aV3(LOCALES)) && JSON.parse(st.pre).archivo === "viejo.json");
    check("confirmación avisa actualización de formato y sincronización", reg.dialogos.some((d) => /versión anterior/.test(d) && /actualizar a versión 3\./.test(d) && /sincronices/.test(d)), reg.dialogos);
    check("aviso de éxito", reg.dialogos.some((d) => /^alert: Backup importado con éxito/.test(d)));
    await page.close();

    /* 1b. Import de un backup schema 3 válido: se guarda tal cual. */
    const regV3 = { errores: [], supabase: [], dialogos: [] };
    page = await abrir(browser, url, regV3, true);
    const b3 = aV3(backup(2));
    await Promise.all([page.waitForEvent("load"), subir(page, "actual.json", JSON.stringify(b3))]);
    st = await estado(page);
    check("schema 3: guardado tal cual", st.datos === JSON.stringify(b3), JSON.parse(st.datos).rutina);
    check("schema 3: sin aviso de actualización de formato", !regV3.dialogos.some((d) => /versión anterior/.test(d)), regV3.dialogos);
    reg.errores.push(...regV3.errores);
    await page.close();

    /* 1c. Backup schema 2 con sesiones del plan anterior: migra a 3 y
       persiste el plan legacy (E3), sin tocar sesiones. */
    const regL = { errores: [], supabase: [], dialogos: [] };
    page = await abrir(browser, url, regL, true);
    const bL = datasetHistoricos({ legacy: true });
    await Promise.all([page.waitForEvent("load"), subir(page, "legacy.json", JSON.stringify(bL))]);
    st = await estado(page);
    const dL = JSON.parse(st.datos);
    check("legacy: guardado = schema 3 + plan legacy", st.datos === JSON.stringify(aE3(bL)));
    check("legacy: plan legacy antes del activo, activo intacto", dL.rutina.planes.map((p) => p.plan_id).join() === "plan-hist-mu4c87ep730qj1,plan-mig-D1" && dL.rutina.plan_activo_id === "plan-mig-D1");
    check("legacy: sesiones idénticas", JSON.stringify(dL.sesiones_entrenamiento) === JSON.stringify(bL.sesiones_entrenamiento));
    reg.errores.push(...regL.errores);
    await page.close();

    /* 2. Rechazos: schema 4, JSON inválido, estructura inválida. Sin escrituras. */
    for (const [nombre, contenido, patron] of [
      ["futuro.json", JSON.stringify(backup(4)), /versión más nueva de la app/],
      ["v3-roto.json", JSON.stringify(Object.assign(aV3(backup(2)), { rutina: { plan_activo_id: "x", planes: [] } })), /rutina del backup no tiene un formato válido/],
      ["roto.json", "{no es json", /no es un JSON válido/],
      ["invalido.json", JSON.stringify({ hola: 1 }), /formato esperado/]
    ]) {
      const regR = { errores: [], supabase: [], dialogos: [] };
      page = await abrir(browser, url, regR, true);
      const antes = await estado(page);
      await subir(page, nombre, contenido);
      await page.waitForFunction(() => { const m = document.getElementById("rutina-mensaje"); return m && !m.classList.contains("oculto"); });
      const msg = await page.$eval("#rutina-mensaje", (m) => m.textContent);
      const despues = await estado(page);
      check(nombre + ": mensaje de rechazo", patron.test(msg), msg);
      check(nombre + ": storage y syncMeta intactos, sin copia previa", JSON.stringify(antes) === JSON.stringify(despues) && despues.pre === null);
      check(nombre + ": sin diálogos", regR.dialogos.length === 0, regR.dialogos);
      reg.errores.push(...regR.errores);
      await page.close();
    }

    /* 3. Cancelar la confirmación: no cambia nada. */
    const regC = { errores: [], supabase: [], dialogos: [] };
    page = await abrir(browser, url, regC, false);
    const antesC = await estado(page);
    await subir(page, "b2.json", JSON.stringify(backup(2)));
    await page.waitForTimeout(300);
    check("cancelar: nada cambia", JSON.stringify(antesC) === JSON.stringify(await estado(page)) && regC.dialogos.length === 1);
    await page.close();

    /* 4. Migración 2→3 imposible (día sin id): pantalla de bloqueo, datos intactos. */
    const regB = { errores: [], supabase: [], dialogos: [] };
    const roto = JSON.stringify(Object.assign(JSON.parse(JSON.stringify(LOCALES)), { rutina: { dias: [{ nombre: "Sin id", ejercicios: [] }] } }));
    page = await browser.newPage({ viewport: { width: 390, height: 900 } });
    page.on("pageerror", (e) => regB.errores.push(e.message));
    page.on("request", (q) => { if (/supabase\.co/.test(q.url())) reg.supabase.push(q.url()); });
    await page.addInitScript((d) => { if (!sessionStorage.getItem("sembrado")) { localStorage.setItem("gymNutritionTracker", d); sessionStorage.setItem("sembrado", "1"); } }, roto);
    await page.goto(url + "/index.html");
    const textoB = await page.$eval("#app-root", (n) => n.textContent);
    check("bloqueo: muestra el aviso de migración", /No se pudo actualizar el formato de tus datos\. Tus datos anteriores se conservaron\./.test(textoB), textoB.slice(0, 200));
    check("bloqueo: no arranca la app (sin navegación)", (await page.$("#nav-dashboard")) === null);
    const stB = await page.evaluate(() => ({ d: localStorage.getItem("gymNutritionTracker"), pre: localStorage.getItem("gymNutritionTracker_preMigracionV3") }));
    check("bloqueo: gymNutritionTracker intacto y sin copia previa", stB.d === roto && stB.pre === null);
    check("bloqueo: sin errores de página", regB.errores.length === 0, regB.errores);
    await page.close();

    check("sin errores de consola", reg.errores.length === 0, reg.errores);
    check("sin requests a Supabase", reg.supabase.length === 0, reg.supabase);
  } finally {
    await browser.close();
    srv.close();
  }
  r.forEach((x) => console.log((x.ok ? "ok   " : "FALLA") + " - " + x.nombre + (x.ok ? "" : " → " + JSON.stringify(x.detalle))));
  const fallas = r.filter((x) => !x.ok).length;
  console.log("# e2e backup import: " + (r.length - fallas) + "/" + r.length + " ok");
  process.exit(fallas ? 1 : 0);
})();
