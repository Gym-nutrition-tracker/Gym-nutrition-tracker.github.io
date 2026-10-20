/* E2E de PROG-04 en Chromium (Playwright), con reloj fijo y datos fijos.
   Uso:
     PLAYWRIGHT_PATH=$(npm root -g)/playwright BASE_DIR=/ruta/version_base node tests/e2e/progreso.e2e.js
   - Verifica el panel "Estado del plan" (posición, badge, aviso en PROG-02/03).
   - Verifica que no se escribe localStorage, que no hay requests a Supabase
     ni errores de consola.
   - Si BASE_DIR apunta a una copia de la versión anterior, compara el HTML de
     Dashboard, Entrenar, Nutrición, Rutina y Progreso (sin el panel nuevo ni
     el aviso) contra esa versión: tienen que ser idénticos. */
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const { aV3 } = require("../entorno");

const RAIZ = path.join(__dirname, "..", "..");
const AHORA = "2026-11-09T12:00:00";
const TIPOS = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".woff2": "font/woff2", ".mjs": "text/javascript" };

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

function sumarDias(iso, n) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/* 3 semanas normales + 1 con RPE alto y caída a la misma carga en todos
   los ejercicios (2 sesiones) -> PROG-04 = descargar. */
function dataset() {
  const ses = [];
  let n = 0;
  const serie = (p, reps) => reps.map((r) => ({ peso_kg: p, reps: r }));
  for (let i = 0; i < 4; i++) {
    const lunes = sumarDias("2026-10-12", i * 7);
    const reps = i < 3 ? [12, 12, 12, 12].map((r, k) => (k < i ? r + 1 : r)) : [12, 10, 9, 8];
    const rpe = i < 2 ? 7 : 9;
    [["A", 1, ["a1", "a2", "a3"]], ["B", 3, ["b1", "b2", "b3"]]].forEach(([dia, off, ids]) => {
      ses.push({ id: "s" + (++n), fecha: sumarDias(lunes, off) + "T18:00:00", tipo: "gimnasio", dia_rutina_id: dia, duracion_min: 60, rpe, notas: "", futbol_detalle: null,
        ejercicios_realizados: ids.map((id) => ({ ejercicio_id: id, series: serie(20, [10]).concat(serie(25, reps)) })) });
    });
  }
  ses.push({ id: "f1", fecha: "2026-11-07T20:00:00", tipo: "futbol", dia_rutina_id: null, duracion_min: 90, rpe: 8, notas: "", ejercicios_realizados: [], futbol_detalle: null });
  const ej = (id) => ({ id, nombre: "Ejercicio " + id, grupo_muscular: "Pecho", series_objetivo: 4, reps_objetivo: "10-12" });
  return {
    schema_version: 2,
    usuario: { nombre: "Nico", fecha_nacimiento: "1990-05-10", sexo: "masculino", peso_kg: 80, altura_cm: 178, objetivo: "mantenimiento", nivel_actividad: "moderado",
      metas_macros: { calorias: 2600, proteinas_g: 160, carbos_g: 300, grasas_g: 80 },
      actividades: [{ tipo: "gimnasio", meta_semanal: 2 }, { tipo: "futbol", meta_semanal: 1 }] },
    rutina: { dias: [{ id: "A", nombre: "Bloque A", ejercicios: ["a1", "a2", "a3"].map(ej) }, { id: "B", nombre: "Bloque B", ejercicios: ["b1", "b2", "b3"].map(ej) }] },
    sesiones_entrenamiento: ses, registros_nutricion: [], base_alimentos: [], medidas_corporales: []
  };
}

async function recorrer(browser, url) {
  const page = await browser.newPage();
  const errores = [];
  const pedidosSupabase = [];
  page.on("pageerror", (e) => errores.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errores.push(m.text()); });
  page.on("request", (r) => { if (/supabase\.co/.test(r.url())) pedidosSupabase.push(r.url()); });
  await page.clock.install({ time: new Date(AHORA) });
  await page.clock.pauseAt(new Date(AHORA));
  const datos = JSON.stringify(dataset());
  await page.addInitScript((d) => { if (!sessionStorage.getItem("sembrado")) { localStorage.setItem("gymNutritionTracker", d); sessionStorage.setItem("sembrado", "1"); } }, datos);
  await page.goto(url + "/index.html");
  await page.waitForSelector("#nav-dashboard");

  const html = {};
  for (const tab of ["dashboard", "entrenar", "nutricion", "progreso"]) {
    await page.click("#nav-" + tab);
    html[tab] = await page.evaluate(() => {
      const copia = document.getElementById("tab-content").cloneNode(true);
      copia.querySelectorAll("canvas").forEach((c) => { c.removeAttribute("style"); c.removeAttribute("width"); c.removeAttribute("height"); });
      return copia.innerHTML;
    });
  }
  const progreso = await page.evaluate(() => {
    const panel = document.querySelector(".progreso-estado-plan");
    const analisis = document.querySelector(".progreso-analisis-semanal");
    const copia = document.getElementById("tab-content").cloneNode(true);
    copia.querySelectorAll(".progreso-estado-plan").forEach((n) => n.remove());
    copia.querySelectorAll(".progreso-proxima-sesion > .proxima-sesion-advertencia").forEach((n) => n.remove());
    copia.querySelectorAll("canvas").forEach((c) => { c.removeAttribute("style"); c.removeAttribute("width"); c.removeAttribute("height"); });
    return {
      existe: !!panel,
      antesDeAnalisis: !!(panel && analisis && (panel.compareDocumentPosition(analisis) & Node.DOCUMENT_POSITION_FOLLOWING)),
      badge: panel ? panel.querySelector(".analisis-badge").textContent : null,
      chip: panel ? panel.querySelector(".estado-plan-chip").textContent : null,
      contexto: panel && panel.querySelector(".estado-plan-contexto") ? panel.querySelector(".estado-plan-contexto").textContent : null,
      motivos: panel ? Array.from(panel.querySelectorAll(".estado-plan-motivos li")).map((l) => l.textContent) : [],
      aviso: Array.from(document.querySelectorAll(".progreso-proxima-sesion > .proxima-sesion-advertencia")).map((n) => n.textContent),
      sinPanel: copia.innerHTML
    };
  });
  /* Cambiar a un ejercicio puntual (PROG-03) y ver que el aviso también aparece. */
  await page.selectOption("#select-analisis-ejercicio", "a1").catch(() => {});
  const avisoEjercicio = await page.evaluate(() => {
    const p = document.querySelector(".progreso-proxima-sesion");
    return p ? { titulo: p.querySelector("h3").textContent, aviso: Array.from(p.querySelectorAll(".proxima-sesion-advertencia")).map((n) => n.textContent) } : null;
  });

  await page.click("#btn-rutina");
  html.rutina = await page.evaluate(() => document.getElementById("tab-content").innerHTML);
  /* E4: Rutina sin la tarjeta del plan activo ni el contenedor del modal,
     para comparar contra versiones anteriores a E4. */
  const rutina = await page.evaluate(() => {
    const c = document.getElementById("tab-content").cloneNode(true);
    const tenia = !!c.querySelector(".plan-activo-card");
    c.querySelectorAll(".plan-activo-card, #rutina-modal").forEach((n) => n.remove());
    return { tenia, sinPlan: c.innerHTML };
  });
  /* ONB-03: los dos únicos agregados legítimos de Rutina, para comparar el
     resto contra versiones anteriores. `agregados` describe exactamente qué
     se quitó (texto y acción), así la comparación no tapa otros cambios. */
  const onb03 = await page.evaluate(() => {
    const c = document.getElementById("tab-content").cloneNode(true);
    const quitados = Array.from(c.querySelectorAll(".plan-cargar, .seccion-ayuda"));
    const agregados = quitados.map((n) => n.className + "|" + n.textContent.replace(/\s+/g, " ").trim() + "|" +
      Array.from(n.matches("[data-accion]") ? [n] : n.querySelectorAll("[data-accion]")).map((x) => x.dataset.accion).join(","));
    quitados.forEach((n) => n.remove());
    return { agregados, sinAgregados: c.innerHTML };
  });
  const almacenado = await page.evaluate(() => localStorage.getItem("gymNutritionTracker"));
  const claves = await page.evaluate(() => Object.keys(localStorage).sort());
  const pre = await page.evaluate(() => localStorage.getItem("gymNutritionTracker_preMigracionV3"));
  await page.close();
  /* E2: el dato sembrado es schema 2; al abrir la app se migra una sola vez a
     schema 3 (con su copia previa) y después nada más lo modifica. */
  const sinCambios = almacenado === JSON.stringify(aV3(JSON.parse(datos)));
  return { html, rutina, onb03, progreso, avisoEjercicio, errores, pedidosSupabase, sinCambios, claves, preCrudo: pre ? JSON.parse(pre).data_raw === datos : false };
}

(async () => {
  const srvNuevo = await servir(RAIZ);
  const srvBase = process.env.BASE_DIR ? await servir(process.env.BASE_DIR) : null;
  const browser = await chromium.launch();
  const resultados = [];
  const check = (nombre, ok, detalle) => resultados.push({ nombre, ok: !!ok, detalle });
  try {
    const nuevo = await recorrer(browser, "http://127.0.0.1:" + srvNuevo.address().port);
    check("panel Estado del plan visible", nuevo.progreso.existe);
    check("panel arriba de Análisis semanal", nuevo.progreso.antesDeAnalisis);
    check("badge Descargar / recuperar", /Descargar \/ recuperar/.test(nuevo.progreso.badge), nuevo.progreso.badge);
    check("chip de confianza", /Confianza: (inicial|normal)/.test(nuevo.progreso.chip), nuevo.progreso.chip);
    check("contexto 'de registros de esta rutina'", /Semana \d+ de registros de esta rutina · Inicio observado: 13\/10/.test(nuevo.progreso.contexto || ""), nuevo.progreso.contexto);
    check("2 a 4 motivos", nuevo.progreso.motivos.length >= 2 && nuevo.progreso.motivos.length <= 4, nuevo.progreso.motivos);
    check("aviso en PROG-02 (bloque)", nuevo.progreso.aviso.some((t) => /El estado general sugiere recuperar/.test(t)), nuevo.progreso.aviso);
    check("aviso en PROG-03 (ejercicio)", nuevo.avisoEjercicio && /ejercicio/.test(nuevo.avisoEjercicio.titulo) && nuevo.avisoEjercicio.aviso.length === 1, nuevo.avisoEjercicio);
    check("sin errores de consola", nuevo.errores.length === 0, nuevo.errores);
    check("sin requests a Supabase", nuevo.pedidosSupabase.length === 0, nuevo.pedidosSupabase);
    check("gymNutritionTracker: solo la migración 2→3, sin otros cambios tras recorrer todo", nuevo.sinCambios);
    check("copia preMigracionV3 con el texto schema 2 exacto", nuevo.preCrudo);
    check("sin otras claves en localStorage", JSON.stringify(nuevo.claves) === JSON.stringify(["gymNutritionTracker", "gymNutritionTracker_preMigracionV3"]), nuevo.claves);
    if (srvBase) {
      const base = await recorrer(browser, "http://127.0.0.1:" + srvBase.address().port);
      ["dashboard", "entrenar", "nutricion"].forEach((t) => check("HTML idéntico a la versión base: " + t, nuevo.html[t] === base.html[t]));
      if (base.rutina.tenia && base.onb03.agregados.length) {
        check("HTML idéntico a la versión base: rutina", nuevo.html.rutina === base.html.rutina);
      } else if (base.rutina.tenia) {
        /* Base anterior a ONB-03 (por ejemplo, HEAD de E6.1): Rutina idéntica
           salvo exactamente "Cargar / cambiar plan" y "Ayuda / Ver guía de inicio". */
        const esperados = [
          "btn btn-primario plan-cargar|Cargar / cambiar plan|cargar-plan",
          "seccion-ayuda|AyudaUn repaso rápido de cómo usar la app.Ver guía de inicio|ver-guia"
        ];
        check("Rutina idéntica a la base salvo 'Cargar / cambiar plan' y 'Ayuda / Ver guía de inicio' (ONB-03)",
          JSON.stringify(nuevo.onb03.agregados) === JSON.stringify(esperados) && nuevo.onb03.sinAgregados === base.html.rutina,
          nuevo.onb03.agregados);
      } else {
        check("Rutina idéntica a la base salvo la tarjeta del plan activo (E4)", nuevo.rutina.tenia && nuevo.rutina.sinPlan === base.html.rutina);
      }
      if (base.progreso.existe) {
        /* Base que ya tiene PROG-04 (por ejemplo, HEAD): Progreso completo idéntico. */
        check("Progreso idéntico a la base (completo, con panel)", nuevo.html.progreso === base.html.progreso);
      } else {
        check("Progreso idéntico a la base (sin panel ni aviso)", nuevo.progreso.sinPanel === base.html.progreso);
      }
      check("la base tampoco tiene errores de consola", base.errores.length === 0, base.errores);
    }
  } finally {
    await browser.close();
    srvNuevo.close();
    if (srvBase) srvBase.close();
  }
  resultados.forEach((r) => console.log((r.ok ? "ok   " : "FALLA") + " - " + r.nombre + (r.ok ? "" : " → " + JSON.stringify(r.detalle))));
  const fallas = resultados.filter((r) => !r.ok).length;
  console.log("# e2e: " + (resultados.length - fallas) + "/" + resultados.length + " ok");
  process.exit(fallas ? 1 : 0);
})();
