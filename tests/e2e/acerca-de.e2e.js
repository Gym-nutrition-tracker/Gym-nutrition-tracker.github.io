/* E2E de "Acerca de" (Chromium/Playwright, 390 px y 320 px): visible solo en
   la pantalla ⚙️ (Configuración / Cuenta), al final; enlace a Instagram en
   pestaña nueva y seguro; no aparece en las otras pantallas; no escribe
   datos. Uso:
     PLAYWRIGHT_PATH=$(npm root -g)/playwright node tests/e2e/acerca-de.e2e.js
   CAPTURAS_DIR=/ruta guarda capturas. */
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const { seguirSinCuenta } = require("./acceso-helper");
const P = require("../fixtures/historial-progresion");

const RAIZ = path.join(__dirname, "..", "..");
const CLAVE = "gymNutritionTracker";
const TIPOS = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".woff2": "font/woff2" };
const CAPTURAS = process.env.CAPTURAS_DIR || null;
const MARCAS = /Acerca de|nico_olmedo|Nicolás Olmedo|sin fines de lucro/;

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
  const datos = P.armar(P.EJEMPLOS, { pesoCorporal: 75 });
  datos.usuario.metas_macros = { calorias: 2500, proteinas_g: 150, carbos_g: 300, grasas_g: 70 };

  async function abrir(ancho) {
    const page = await browser.newPage({ viewport: { width: ancho, height: 844 }, locale: "es-AR" });
    page.on("pageerror", (e) => errores.push(e.message));
    page.on("console", (m) => { if (m.type() === "error") errores.push(m.text()); });
    page.on("request", (q) => { if (/supabase\.co|instagram\.com/.test(q.url())) supabase.push(q.url()); });
    await page.clock.install({ time: new Date(P.HOY + "T12:00:00") });
    await page.addInitScript((d) => { if (!sessionStorage.getItem("sembrado")) { localStorage.setItem("gymNutritionTracker", d); sessionStorage.setItem("sembrado", "1"); } }, JSON.stringify(datos));
    await page.goto("http://127.0.0.1:" + srv.address().port + "/index.html");
    await seguirSinCuenta(page);
    return page;
  }
  const texto = (page) => page.$eval("#tab-content", (c) => c.innerText);

  try {
    const p = await abrir(390);
    const antes = await p.evaluate((k) => localStorage.getItem(k), CLAVE);

    /* 9-10 y resto: ninguna otra pantalla la muestra. */
    for (const [nav, nombre] of [["#nav-dashboard", "Dashboard"], ["#nav-entrenar", "Entrenar"], ["#nav-progreso", "Progreso"], ["#nav-nutricion", "Nutrición"]]) {
      await p.click(nav);
      check("no aparece en " + nombre, !MARCAS.test(await texto(p)));
    }

    /* 1-8: pantalla ⚙️ */
    await p.click("#btn-rutina");
    await p.waitForSelector(".seccion-acerca-de");
    const sec = await p.$eval(".seccion-acerca-de", (s) => s.innerText.replace(/\s+/g, " ").trim());
    check("1. 'Acerca de' visible en Configuración / Cuenta", (await p.isVisible(".seccion-acerca-de h3")) && /^Acerca de/.test(sec), sec);
    check("2. 'Desarrollado por Nicolás Olmedo'", /Desarrollado por Nicolás Olmedo/.test(sec));
    check("3. 'Proyecto personal sin fines de lucro'", /Proyecto personal sin fines de lucro/.test(sec));
    check("4. 'Instagram: @nico_olmedo'", /Instagram: @nico_olmedo/.test(sec));
    const a = await p.$eval(".seccion-acerca-de a", (x) => ({ href: x.getAttribute("href"), target: x.target, rel: x.rel, txt: x.textContent }));
    check("5. href exacto", a.href === "https://instagram.com/nico_olmedo", a);
    check("6. abre en pestaña nueva", a.target === "_blank");
    check("7. rel noopener noreferrer", a.rel === "noopener noreferrer");
    check("8. pie 'Gym & Nutrition Tracker · Nicolás Olmedo' al final de la pantalla", await p.evaluate(() => {
      const pie = document.querySelector(".acerca-de-pie");
      const s = document.querySelector(".seccion-acerca-de");
      const resto = Array.from(document.querySelectorAll("#tab-content .pantalla-rutina > div")).filter((d) => d.id !== "rutina-modal");
      return pie && pie.textContent === "Gym & Nutrition Tracker · Nicolás Olmedo" && resto[resto.length - 1] === s;
    }));
    check("después de 'Copia de seguridad'", await p.evaluate(() => {
      const b = document.querySelector(".seccion-backup"), s = document.querySelector(".seccion-acerca-de");
      return !!(b.compareDocumentPosition(s) & Node.DOCUMENT_POSITION_FOLLOWING);
    }));
    check("secundaria: texto más chico que los botones", await p.evaluate(() => {
      const pie = getComputedStyle(document.querySelector(".acerca-de-pie")).fontSize;
      const btn = getComputedStyle(document.querySelector(".seccion-backup .btn")).fontSize;
      return parseFloat(pie) < parseFloat(btn);
    }));
    check("sin email ni IDs en la sección", !/@[\w.-]+\.\w{2,}|uid|token/i.test(sec));
    check("390: sin scroll horizontal", await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    if (CAPTURAS) { await (await p.$(".seccion-acerca-de")).screenshot({ path: path.join(CAPTURAS, "acerca-de-390.png") }); }
    check("12. no escribe datos", (await p.evaluate((k) => localStorage.getItem(k), CLAVE)) === antes);
    await p.close();

    const q = await abrir(320);
    await q.click("#btn-rutina");
    await q.waitForSelector(".seccion-acerca-de");
    check("320: sin scroll horizontal", await q.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    check("320: la sección entra en la pantalla", await q.$eval(".seccion-acerca-de", (s) => s.getBoundingClientRect().right <= window.innerWidth + 0.5));
    if (CAPTURAS) { await (await q.$(".seccion-acerca-de")).screenshot({ path: path.join(CAPTURAS, "acerca-de-320.png") }); }
    await q.close();
  } catch (err) {
    check("excepción en el e2e", false, err.message);
  }

  check("sin errores de consola", errores.length === 0, errores);
  check("sin requests a Supabase ni a Instagram", supabase.length === 0, supabase);
  await browser.close();
  srv.close();
  r.forEach((x) => console.log((x.ok ? "ok    - " : "FALLA - ") + x.nombre + (x.ok ? "" : " → " + JSON.stringify(x.detalle))));
  const ok = r.filter((x) => x.ok).length;
  console.log("# e2e acerca de: " + ok + "/" + r.length + " ok");
  process.exit(ok === r.length ? 0 : 1);
})();
