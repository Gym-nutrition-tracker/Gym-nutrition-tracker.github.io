/* E2E de E6.5: carga sugerida en Entrenar (Chromium/Playwright, 390 px y
   320 px). Historial de ejemplo (tests/fixtures/historial-cargas.js) con el
   Plan N.º 4 sanitizado como plan activo. Uso:
     PLAYWRIGHT_PATH=$(npm root -g)/playwright node tests/e2e/carga-sugerida.e2e.js
   CAPTURAS_DIR=/ruta guarda capturas. */
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const { seguirSinCuenta } = require("./acceso-helper");
const { datasetHistoricos } = require("../fixtures/historicos-dataset");
const F = require("../fixtures/historial-cargas");

const RAIZ = path.join(__dirname, "..", "..");
const AHORA = "2026-11-09T12:00:00";
const CLAVE = "gymNutritionTracker";
const TIPOS = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".woff2": "font/woff2" };
const CAPTURAS = process.env.CAPTURAS_DIR || null;

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

function semilla() {
  const d = F.historialAmplio();
  d.usuario = datasetHistoricos({ legacy: true }).usuario;
  return d;
}

(async () => {
  const srv = await servir(RAIZ);
  const browser = await chromium.launch();
  const r = [];
  const errores = [];
  const supabase = [];
  const check = (nombre, ok, detalle) => r.push({ nombre, ok: !!ok, detalle });
  const datos = semilla();

  /* Variante: dominadas registradas como CARGA TOTAL (75 = peso corporal,
     80 = +5 de lastre) y peso corporal actual 75 kg. */
  function conDominadasTotales(d, peso) {
    const c = JSON.parse(JSON.stringify(d));
    const viejo = c.rutina.planes.find((p) => p.plan_id === "plan-viejo");
    const id = viejo.dias[0].ejercicios.find((e) => e.nombre === "DOMINADAS TOMA NEUTRA").id;
    c.sesiones_entrenamiento.forEach((s) => s.ejercicios_realizados.forEach((er) => {
      if (er.ejercicio_id === id) er.series = [{ peso_kg: 75, reps: 10 }, { peso_kg: 80, reps: 8 }, { peso_kg: 80, reps: 8 }, { peso_kg: 80, reps: 8 }];
    }));
    c.medidas_corporales = peso ? [{ fecha: "2026-11-02", peso_kg: peso, cintura_cm: null }] : [];
    /* Sin peso conocido: tampoco en el perfil (si no, se usa ese). */
    if (!peso) delete c.usuario.peso_kg;
    return c;
  }

  async function abrir(ancho, semillaPropia) {
    const page = await browser.newPage({ viewport: { width: ancho, height: 844 }, locale: "es-AR", timezoneId: "America/Argentina/Buenos_Aires" });
    page.on("pageerror", (e) => errores.push(e.message));
    page.on("console", (m) => { if (m.type() === "error") errores.push(m.text()); });
    page.on("request", (q) => { if (/supabase\.co/.test(q.url())) supabase.push(q.url()); });
    await page.clock.install({ time: new Date(AHORA) });
    await page.clock.pauseAt(new Date(AHORA));
    await page.addInitScript((d) => { if (!sessionStorage.getItem("sembrado")) { localStorage.setItem("gymNutritionTracker", d); sessionStorage.setItem("sembrado", "1"); } }, JSON.stringify(semillaPropia || datos));
    await page.goto("http://127.0.0.1:" + srv.address().port + "/index.html");
    await seguirSinCuenta(page);
    await page.click("#nav-entrenar");
    return page;
  }
  const tarjeta = (page, nombre) => page.evaluateHandle((n) => Array.from(document.querySelectorAll(".ejercicio-entrenar-card")).find((c) => c.querySelector("strong").textContent === n), nombre);
  const textoEn = async (page, nombre, sel) => (await tarjeta(page, nombre)).evaluate((c, s) => { const x = c.querySelector(s); return x ? x.textContent.replace(/\s+/g, " ").trim() : null; }, sel);
  const elegirDia = async (page, nombre) => {
    const id = await page.$eval("#select-dia-rutina", (s, n) => Array.from(s.options).find((o) => o.textContent === n).value, nombre);
    await page.selectOption("#select-dia-rutina", id);
  };
  const foto = async (page, n, sel) => {
    if (!CAPTURAS) return;
    await page.evaluate(() => document.fonts.ready);
    const opts = { path: path.join(CAPTURAS, n + ".png"), animations: "disabled", caret: "hide" };
    if (sel) await (await page.$(sel)).screenshot(opts); else await page.screenshot(opts);
  };

  try {
    const p = await abrir(390);
    const antes = await p.evaluate((k) => localStorage.getItem(k), CLAVE);
    await elegirDia(p, "EMPUJE");

    /* Sugerencias visibles y compactas. */
    check("Smith (mismo ejercicio): 'Carga sugerida: 42,5 kg · Confianza alta'", /^Carga sugerida: 42,5 kg · Confianza alta$/.test(await textoEn(p, "PRESS INCLINADO EN SMITH", ".carga-sugerida-linea")), await textoEn(p, "PRESS INCLINADO EN SMITH", ".carga-sugerida-linea"));
    check("Mancuernas: unidad 'por mancuerna'", /kg por mancuerna/.test(await textoEn(p, "PRESS BANCA C/MANCUERNAS", ".carga-sugerida-linea")));
    check("Militar arrodillado (variante): confianza media", /Confianza media/.test(await textoEn(p, "PRESS MILITAR ARRODILLADO CON MANCUERNAS", ".carga-sugerida-linea")));
    check("Cruces en polea: 'por lado' y confianza baja", /por lado · Confianza baja/.test(await textoEn(p, "CRUCES EN POLEA (ALTO)", ".carga-sugerida-linea")));

    /* "Última vez": mismo ejercicio por nombre aunque cambió el id; nunca variantes. */
    check("Última vez: Smith (mismo ejercicio, otro id) muestra su registro", /^Última vez: .*40kg x/.test(await textoEn(p, "PRESS INCLINADO EN SMITH", ".ejercicio-ultimo-registro")), await textoEn(p, "PRESS INCLINADO EN SMITH", ".ejercicio-ultimo-registro"));
    check("Última vez: militar arrodillado (variante del sentado) → 'Sin registros previos'", (await textoEn(p, "PRESS MILITAR ARRODILLADO CON MANCUERNAS", ".ejercicio-ultimo-registro")) === "Sin registros previos");
    check("Sin contradicción: toda sugerencia de confianza alta tiene 'Última vez'", await p.evaluate(() => Array.from(document.querySelectorAll(".ejercicio-entrenar-card"))
      .filter((c) => /Confianza alta/.test(c.textContent)).every((c) => /^Última vez:/.test(c.querySelector(".ejercicio-ultimo-registro").textContent.trim()))));

    /* Explicación expandible. */
    check("'¿Por qué?' cerrado por defecto", !(await (await tarjeta(p, "PRESS MILITAR ARRODILLADO CON MANCUERNAS")).evaluate((c) => c.querySelector("details").open)));
    await (await tarjeta(p, "PRESS MILITAR ARRODILLADO CON MANCUERNAS")).evaluate((c) => c.querySelector("summary").click());
    const detalle = await textoEn(p, "PRESS MILITAR ARRODILLADO CON MANCUERNAS", ".carga-sugerida-detalle");
    check("'¿Por qué?' muestra rango, fuente y guía de calibración", /Rango orientativo:/.test(detalle) && /Press militar c\/mancuernas sentado/.test(detalle) && /Usala como punto de partida y ajustá en la primera serie\./.test(detalle), detalle);
    await foto(p, "01-entrenar-empuje-390");
    await foto(p, "02-por-que-expandido", '.ejercicio-entrenar-card:has(strong:text-is("PRESS MILITAR ARRODILLADO CON MANCUERNAS"))');

    /* Movilidad y peso corporal. */
    check("Movilidad (rotación torácica): sin tarjeta de carga", (await textoEn(p, "ROTACION TORACICA EN CUADRUPEDIA CON BRAZOS EXTENDIDOS", ".carga-sugerida")) === null);
    check("Movilidad (aducción escapular con banda): sin kilos", (await textoEn(p, "ADUCCION ESCAPULAR C/BANDA", ".carga-sugerida")) === null);
    check("Fondos (peso corporal): 'Sin carga externa sugerida'", (await textoEn(p, "FONDOS EN PARALELAS", ".carga-sugerida")) === "Sin carga externa sugerida");
    check("Ningún 'kg' en tarjetas de movilidad", await p.evaluate(() => Array.from(document.querySelectorAll(".ejercicio-entrenar-card")).filter((c) => /ROTACION|CANDELABRO|ADUCCION/.test(c.querySelector("strong").textContent)).every((c) => !/Carga sugerida/.test(c.textContent))));

    /* No modifica inputs ni datos. */
    const inputs = () => p.$$eval(".serie-input-row input", (l) => l.map((i) => i.value));
    const iniciales = await inputs();
    check("Ningún input de serie viene completado con la sugerencia", iniciales.length > 0 && iniciales.every((v) => v === ""), iniciales);
    const filasSmith = () => tarjeta(p, "PRESS INCLINADO EN SMITH").then((t) => t.evaluate((c) => Array.from(c.querySelectorAll(".serie-input-row input")).map((i) => i.value)));
    const antesSmith = await filasSmith();
    await (await tarjeta(p, "PRESS INCLINADO EN SMITH")).evaluate((c) => c.querySelector('[data-accion="agregar-serie"]').click());
    const despuesSmith = await filasSmith();
    check("'+ Serie' agrega una fila vacía (la sugerencia no la rellena)", despuesSmith.length === antesSmith.length + 2 && despuesSmith.every((v) => v === ""), despuesSmith);
    check("Ver sugerencias no escribe datos", (await p.evaluate((k) => localStorage.getItem(k), CLAVE)) === antes);
    check("Sin scroll horizontal (390)", await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));

    await elegirDia(p, "TRACCIÓN");
    check("Remo unilateral en polea: 'por lado'", /kg por lado/.test(await textoEn(p, "REMO BAJO POLEA TOMA UNILATERAL", ".carga-sugerida-linea")));
    check("Última vez: bíceps martillo en polea (antes decía 'Sin registros previos')", /^Última vez: 15kg x12/.test(await textoEn(p, "BICEPS MARTILLO EN POLEA", ".ejercicio-ultimo-registro")), await textoEn(p, "BICEPS MARTILLO EN POLEA", ".ejercicio-ultimo-registro"));
    check("Sin contradicción en Tracción", await p.evaluate(() => Array.from(document.querySelectorAll(".ejercicio-entrenar-card"))
      .filter((c) => /Confianza alta/.test(c.textContent)).every((c) => /^Última vez:/.test(c.querySelector(".ejercicio-ultimo-registro").textContent.trim()))));
    check("Dominada isométrica: sin carga externa", (await textoEn(p, "DOMINADA ISOMETRICA", ".carga-sugerida")) === "Sin carga externa sugerida");
    check("Face pull sin historial: guía en vez de kilos", /Sin historial relacionado para sugerir una carga/.test(await textoEn(p, "FACE PULL AL PISO", ".carga-sugerida")));
    await foto(p, "03-entrenar-traccion-390");
    await p.close();

    /* Peso corporal: lastre sugerido (dominadas registradas como carga total). */
    const pc = await abrir(390, conDominadasTotales(datos, 75));
    const antesPc = await pc.evaluate((k) => localStorage.getItem(k), CLAVE);
    await elegirDia(pc, "TRACCIÓN");
    check("Dominadas: 'Lastre sugerido: +7,5 kg' como dato principal", /^Lastre sugerido: \+7,5 kg · Confianza alta$/.test(await textoEn(pc, "DOMINADAS TOMA NEUTRA", ".carga-sugerida-linea")), await textoEn(pc, "DOMINADAS TOMA NEUTRA", ".carga-sugerida-linea"));
    check("Dominadas: 'Carga total estimada: 82,5 kg' secundaria", (await textoEn(pc, "DOMINADAS TOMA NEUTRA", ".carga-sugerida-nota")) === "Carga total estimada: 82,5 kg");
    check("Dominadas: 'Última vez' con los kg originales (carga total)", /^Última vez: 75kg x10 · 80kg x8/.test(await textoEn(pc, "DOMINADAS TOMA NEUTRA", ".ejercicio-ultimo-registro")));
    await (await tarjeta(pc, "DOMINADAS TOMA NEUTRA")).evaluate((c) => c.querySelector("summary").click());
    check("Dominadas: '¿Por qué?' explica peso, carga total y lastre", /Tu peso corporal actual es 75 kg .*La carga total estimada para este objetivo es 82,5 kg\. Eso equivale aproximadamente a \+7,5 kg de lastre\./.test(await textoEn(pc, "DOMINADAS TOMA NEUTRA", ".carga-sugerida-detalle")));
    check("Dominadas: no escribe datos", (await pc.evaluate((k) => localStorage.getItem(k), CLAVE)) === antesPc);
    await foto(pc, "05-dominadas-lastre", '.ejercicio-entrenar-card:has(strong:text-is("DOMINADAS TOMA NEUTRA"))');
    await pc.close();
    const sinPeso = await abrir(390, conDominadasTotales(datos, null));
    await elegirDia(sinPeso, "TRACCIÓN");
    check("Sin peso corporal: carga total orientativa + pedido de registrar el peso",
      /^Carga total orientativa: 82,5 kg/.test(await textoEn(sinPeso, "DOMINADAS TOMA NEUTRA", ".carga-sugerida-linea")) &&
      (await textoEn(sinPeso, "DOMINADAS TOMA NEUTRA", ".carga-sugerida-nota")) === "Para calcular el lastre necesitás registrar tu peso corporal.");
    await foto(sinPeso, "06-dominadas-sin-peso", '.ejercicio-entrenar-card:has(strong:text-is("DOMINADAS TOMA NEUTRA"))');
    await sinPeso.close();
    const pc320 = await abrir(320, conDominadasTotales(datos, 75));
    await elegirDia(pc320, "TRACCIÓN");
    await (await tarjeta(pc320, "DOMINADAS TOMA NEUTRA")).evaluate((c) => c.querySelector("summary").click());
    check("320: dominadas con lastre y detalle abierto sin scroll horizontal", await pc320.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await pc320.close();

    /* 320 px */
    const q = await abrir(320);
    await elegirDia(q, "EMPUJE");
    await (await tarjeta(q, "PRESS INCLINADO EN SMITH")).evaluate((c) => c.querySelector("summary").click());
    check("320: sin scroll horizontal con el detalle abierto", await q.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    check("320: la línea de carga entra en la tarjeta", await (await tarjeta(q, "PRESS INCLINADO EN SMITH")).evaluate((c) => { const l = c.querySelector(".carga-sugerida"); return l.getBoundingClientRect().right <= c.getBoundingClientRect().right + 0.5; }));
    await foto(q, "04-entrenar-320");
    await q.close();
  } catch (err) {
    check("excepción en el e2e", false, err.message);
  }

  check("sin errores de consola", errores.length === 0, errores);
  check("sin requests a Supabase", supabase.length === 0, supabase);
  await browser.close();
  srv.close();
  r.forEach((x) => console.log((x.ok ? "ok    - " : "FALLA - ") + x.nombre + (x.ok ? "" : " → " + JSON.stringify(x.detalle))));
  const ok = r.filter((x) => x.ok).length;
  console.log("# e2e carga sugerida: " + ok + "/" + r.length + " ok");
  process.exit(ok === r.length ? 0 : 1);
})();
