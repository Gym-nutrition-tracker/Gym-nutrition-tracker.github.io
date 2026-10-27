/* E2E de PROG-04.1: próxima sesión por ejercicio en Entrenar y Progreso
   (Chromium/Playwright, 390 px y 320 px). Datos DE EJEMPLO
   (tests/fixtures/historial-progresion.js) + un ejercicio nuevo que queda
   para E6.5. Uso:
     PLAYWRIGHT_PATH=$(npm root -g)/playwright node tests/e2e/proxima-sesion.e2e.js
   CAPTURAS_DIR=/ruta guarda capturas. */
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const { seguirSinCuenta } = require("./acceso-helper");
const P = require("../fixtures/historial-progresion");

const RAIZ = path.join(__dirname, "..", "..");
const AHORA = P.HOY + "T12:00:00";
const CLAVE = "gymNutritionTracker";
const TIPOS = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".woff2": "font/woff2" };
const CAPTURAS = process.env.CAPTURAS_DIR || null;
const NUEVO = "PRESS MILITAR ARRODILLADO CON MANCUERNAS";

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

(async () => {
  const srv = await servir(RAIZ);
  const browser = await chromium.launch();
  const r = [];
  const errores = [];
  const supabase = [];
  const check = (nombre, ok, detalle) => r.push({ nombre, ok: !!ok, detalle });
  const datos = P.armar(P.EJEMPLOS.concat([{ nombre: NUEVO, series_objetivo: 3, reps_objetivo: "10", rir_objetivo: "2" }]), { pesoCorporal: 75 });

  async function abrir(ancho) {
    const page = await browser.newPage({ viewport: { width: ancho, height: 844 }, locale: "es-AR", timezoneId: "America/Argentina/Buenos_Aires" });
    page.on("pageerror", (e) => errores.push(e.message));
    page.on("console", (m) => { if (m.type() === "error") errores.push(m.text()); });
    page.on("request", (q) => { if (/supabase\.co/.test(q.url())) supabase.push(q.url()); });
    await page.clock.install({ time: new Date(AHORA) });
    await page.clock.pauseAt(new Date(AHORA));
    await page.addInitScript((d) => { if (!sessionStorage.getItem("sembrado")) { localStorage.setItem("gymNutritionTracker", d); sessionStorage.setItem("sembrado", "1"); } }, JSON.stringify(datos));
    await page.goto("http://127.0.0.1:" + srv.address().port + "/index.html");
    await seguirSinCuenta(page);
    return page;
  }
  async function entrenar(page) {
    await page.click("#nav-entrenar");
    const id = await page.$eval("#select-dia-rutina", (s) => Array.from(s.options).find((o) => o.textContent === "Día").value);
    await page.selectOption("#select-dia-rutina", id);
  }
  const tarjeta = (page, nombre) => page.evaluateHandle((n) => Array.from(document.querySelectorAll(".ejercicio-entrenar-card")).find((c) => c.querySelector("strong").textContent === n), nombre);
  const textoEn = async (page, nombre, sel) => (await tarjeta(page, nombre)).evaluate((c, s) => { const x = c.querySelector(s); return x ? x.innerText.replace(/\s+/g, " ").trim() : null; }, sel);
  const foto = async (page, n, sel) => {
    if (!CAPTURAS) return;
    await page.evaluate(() => document.fonts.ready);
    const opts = { path: path.join(CAPTURAS, n + ".png"), animations: "disabled", caret: "hide" };
    if (sel) await (await page.$(sel)).screenshot(opts); else await page.screenshot(opts);
  };

  try {
    const p = await abrir(390);
    const antes = await p.evaluate((k) => localStorage.getItem(k), CLAVE);
    await entrenar(p);

    /* Ejercicio conocido → PROG-04.1; nuevo → E6.5. Nunca los dos. */
    const banca = await textoEn(p, "PRESS BANCA C/MANCUERNAS", ".proxima-sesion-ej");
    check("Conocido: 'Próxima sesión · Subí a 27,5 kg por mancuerna · Objetivo: 10-12 reps · Confianza alta'",
      /^Próxima sesión Subí a 27,5 kg por mancuerna Objetivo: 10-12 reps · Confianza alta/i.test(banca), banca);
    check("Conocido: sin 'Carga sugerida' de E6.5", (await textoEn(p, "PRESS BANCA C/MANCUERNAS", ".carga-sugerida")) === null);
    check("Nuevo (variante): 'Carga sugerida' de E6.5, sin 'Próxima sesión'",
      /^Carga sugerida: .*kg por mancuerna/.test(await textoEn(p, NUEVO, ".carga-sugerida-linea")) && (await textoEn(p, NUEVO, ".proxima-sesion-ej")) === null,
      await textoEn(p, NUEVO, ".carga-sugerida"));
    check("Ninguna tarjeta muestra dos recomendaciones", await p.evaluate(() => Array.from(document.querySelectorAll(".ejercicio-entrenar-card"))
      .every((c) => !(c.querySelector(".proxima-sesion-ej") && c.querySelector(".carga-sugerida")))));
    check("Mantener + reps: press banca con barra 'Mantené 55 kg · Buscá 11-12 reps'",
      /Mantené 55 kg Buscá 11-12 reps/.test(await textoEn(p, "PRESS BANCA C/BARRA", ".proxima-sesion-ej")));
    check("Bajar: militar sentado 'Bajá a 12 kg por mancuerna'", /Bajá a 12 kg por mancuerna/.test(await textoEn(p, "PRESS MILITAR C/MANCUERNAS SENTADO", ".proxima-sesion-ej")));
    check("Bajar: Smith 4×8 con dos exposiciones debajo → 'Bajá a 40 kg · Objetivo: 4×8'", /Bajá a 40 kg Objetivo: 4×8 · Confianza alta/.test(await textoEn(p, "PRESS INCLINADO EN SMITH", ".proxima-sesion-ej")), await textoEn(p, "PRESS INCLINADO EN SMITH", ".proxima-sesion-ej"));
    check("Peso corporal: dominadas 'Subí a +10 kg de lastre'", /Subí a \+10 kg de lastre/.test(await textoEn(p, "DOMINADAS TOMA NEUTRA", ".proxima-sesion-ej")));
    check("Primera sesión: bíceps martillo con confianza baja", /Confianza baja/.test(await textoEn(p, "BICEPS MARTILLO EN POLEA", ".proxima-sesion-ej")));

    /* "¿Por qué?" expandible. */
    const card = await tarjeta(p, "PRESS BANCA C/MANCUERNAS");
    check("'¿Por qué?' cerrado por defecto", !(await card.evaluate((c) => c.querySelector(".proxima-sesion-ej details").open)));
    await card.evaluate((c) => c.querySelector(".proxima-sesion-ej summary").click());
    const detalle = await textoEn(p, "PRESS BANCA C/MANCUERNAS", ".proxima-sesion-ej details");
    check("'¿Por qué?' explica el tope del rango y la última sesión", /extremo superior del rango/.test(detalle) && /Última sesión: 25 kg por mancuerna · 12\/12\/12\/12/.test(detalle), detalle);
    check("'¿Por qué?' aclara que no hay esfuerzo real por ejercicio", /No registramos el esfuerzo real por ejercicio/.test(detalle));
    await foto(p, "01-entrenar-390");
    await foto(p, "02-por-que", '.ejercicio-entrenar-card:has(strong:text-is("PRESS BANCA C/MANCUERNAS"))');

    /* No escribe inputs ni datos. */
    const inputs = await p.$$eval(".serie-input-row input", (l) => l.map((i) => i.value));
    check("Ningún input de serie viene completado", inputs.length > 0 && inputs.every((v) => v === ""), inputs);
    check("Ver la recomendación no escribe datos", (await p.evaluate((k) => localStorage.getItem(k), CLAVE)) === antes);
    check("Sin scroll horizontal (390)", await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));

    /* Progreso: tarjeta de próxima sesión del ejercicio, filtros e historial intactos. */
    await p.click("#nav-progreso");
    const bloque = await p.$eval("#select-analisis-bloque", (s) => Array.from(s.options).find((o) => /^Día/.test(o.textContent)).value);
    await p.selectOption("#select-analisis-bloque", bloque);
    const ejId = await p.$eval("#select-analisis-ejercicio", (s) => Array.from(s.options).find((o) => /^PRESS BANCA C\/MANCUERNAS/.test(o.textContent)).value);
    await p.selectOption("#select-analisis-ejercicio", ejId);
    const prox = await p.$eval(".progreso-proxima-sesion", (x) => x.innerText.replace(/\s+/g, " ").trim());
    check("Progreso: 'Próxima vez en este ejercicio' con Estado 'Progresar'", /Próxima vez en este ejercicio/.test(prox) && /Estado Progresar/.test(prox), prox.slice(0, 200));
    check("Progreso: 'Recomendación para la próxima sesión · Subí a 27,5 kg por mancuerna'", /Recomendación para la próxima sesión Subí a 27,5 kg por mancuerna Objetivo: 10-12 reps · Confianza alta/i.test(prox), prox);
    check("Progreso: 'Última referencia' solo con series efectivas (25 kg · 12/12/12/12)", /Última referencia 25 kg · 12\/12\/12\/12 /.test(prox), prox.slice(0, 120));
    check("Progreso: una sola recomendación (sin 'Sugerencia:' de PROG-03)", !/Sugerencia:/.test(prox));
    check("Progreso: el análisis histórico del ejercicio sigue visible", await p.$eval(".progreso-analisis-semanal h4", (h) => /^PRESS BANCA C\/MANCUERNAS/.test(h.textContent)));
    check("Progreso: el filtro de ejercicio quedó seleccionado", (await p.$eval("#select-analisis-ejercicio", (s) => s.value)) === ejId);
    await p.selectOption("#select-analisis-ejercicio", "");
    check("Progreso: 'Todo el bloque' vuelve a la vista general", !/Recomendación para la próxima sesión/i.test(await p.$eval(".progreso-proxima-sesion", (x) => x.textContent)));
    await p.selectOption("#select-analisis-ejercicio", ejId);
    check("Progreso: no escribe datos", (await p.evaluate((k) => localStorage.getItem(k), CLAVE)) === antes);
    check("Progreso: sin scroll horizontal (390)", await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await foto(p, "03-progreso-390", ".progreso-proxima-sesion");
    await p.close();

    /* 320 px */
    const q = await abrir(320);
    await entrenar(q);
    await (await tarjeta(q, "DOMINADAS TOMA NEUTRA")).evaluate((c) => c.querySelector(".proxima-sesion-ej summary").click());
    check("320: sin scroll horizontal con el detalle abierto", await q.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    check("320: la tarjeta de próxima sesión entra en el ejercicio", await (await tarjeta(q, "PRESS BANCA C/MANCUERNAS")).evaluate((c) => {
      const l = c.querySelector(".proxima-sesion-ej"); return l.getBoundingClientRect().right <= c.getBoundingClientRect().right + 0.5;
    }));
    await foto(q, "04-entrenar-320");
    await q.click("#nav-progreso");
    const bloque320 = await q.$eval("#select-analisis-bloque", (s) => Array.from(s.options).find((o) => /^Día/.test(o.textContent)).value);
    await q.selectOption("#select-analisis-bloque", bloque320);
    const ej320 = await q.$eval("#select-analisis-ejercicio", (s) => Array.from(s.options).find((o) => /^DOMINADAS/.test(o.textContent)).value);
    await q.selectOption("#select-analisis-ejercicio", ej320);
    check("320 Progreso: dominadas en lastre", /Subí a \+10 kg de lastre/.test(await q.$eval(".progreso-proxima-sesion", (x) => x.textContent)));
    check("320 Progreso: sin scroll horizontal", await q.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await foto(q, "05-progreso-320", ".progreso-proxima-sesion");
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
  console.log("# e2e próxima sesión: " + ok + "/" + r.length + " ok");
  process.exit(ok === r.length ? 0 : 1);
})();
