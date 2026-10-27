/* E2E de PROG-04.2 (Chromium/Playwright, 390 px y 320 px): RIR real de la
   última serie por ejercicio en Entrenar (elegir, guardar, editar,
   conservar) y su uso en la recomendación de Progreso. Datos DE EJEMPLO
   (tests/fixtures/historial-progresion.js) + un ejercicio de movilidad.
   Uso:
     PLAYWRIGHT_PATH=$(npm root -g)/playwright node tests/e2e/rir-real.e2e.js
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
const MOVILIDAD = "ROTACION TORACICA EN CUADRUPEDIA CON BRAZOS EXTENDIDOS";

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
  const datos = P.armar(P.EJEMPLOS.concat([{ nombre: MOVILIDAD, series_objetivo: 2, reps_objetivo: "8" }]), { pesoCorporal: 75 });

  async function abrir(ancho) {
    const page = await browser.newPage({ viewport: { width: ancho, height: 844 }, locale: "es-AR", timezoneId: "America/Argentina/Buenos_Aires" });
    page.on("pageerror", (e) => errores.push(e.message));
    page.on("console", (m) => { if (m.type() === "error") errores.push(m.text()); });
    page.on("request", (q) => { if (/supabase\.co/.test(q.url())) supabase.push(q.url()); });
    page.on("dialog", (d) => d.accept());
    await page.clock.install({ time: new Date(AHORA) });
    await page.clock.pauseAt(new Date(AHORA));
    await page.addInitScript((d) => { if (!sessionStorage.getItem("sembrado")) { localStorage.setItem("gymNutritionTracker", d); sessionStorage.setItem("sembrado", "1"); } }, JSON.stringify(datos));
    await page.goto("http://127.0.0.1:" + srv.address().port + "/index.html");
    await seguirSinCuenta(page);
    await page.click("#nav-entrenar");
    await elegirDia(page);
    return page;
  }
  async function elegirDia(page) {
    const id = await page.$eval("#select-dia-rutina", (s) => Array.from(s.options).find((o) => o.textContent === "Día").value);
    await page.selectOption("#select-dia-rutina", id);
    await page.fill("#input-duracion", "60");
  }
  const leer = (page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k)), CLAVE);
  const card = (nombre) => '.ejercicio-entrenar-card:has(strong:text-is("' + nombre + '"))';
  async function series(page, nombre, peso, reps) {
    for (let i = 0; i < reps.length; i++) {
      const f = page.locator(card(nombre) + " .serie-input-row >> nth=" + i);
      await f.locator(".input-serie-peso").fill(peso);
      await f.locator(".input-serie-reps").fill(String(reps[i]));
    }
  }
  const rir = (page, nombre, valor) => page.click(card(nombre) + ' [data-accion="set-rir"][data-valor="' + valor + '"]');
  const activo = (page, nombre) => page.$eval(card(nombre), (c) => { const b = c.querySelector(".btn-rir.activo"); return b ? b.textContent : null; });
  const nuevaSesion = (antes, despues) => despues.sesiones_entrenamiento.filter((s) => !antes.sesiones_entrenamiento.some((a) => a.id === s.id))[0];
  const erDe = (sesion, d, nombre) => {
    const ej = d.rutina.planes[0].dias[0].ejercicios.find((e) => e.nombre === nombre);
    return sesion.ejercicios_realizados.find((er) => er.ejercicio_id === ej.id);
  };
  const foto = async (page, n, sel) => {
    if (!CAPTURAS) return;
    await page.evaluate(() => document.fonts.ready);
    const opts = { path: path.join(CAPTURAS, n + ".png"), animations: "disabled", caret: "hide" };
    if (sel) await (await page.$(sel)).screenshot(opts); else await page.screenshot(opts);
  };

  try {
    const p = await abrir(390);
    const inicial = await leer(p);

    /* Selector visible solo donde tiene sentido. */
    check("selector 'RIR última serie' en un ejercicio de fuerza", /RIR última serie/.test(await p.$eval(card("PRESS BANCA C/BARRA") + " .rir-real", (x) => x.textContent)));
    check("opciones 0 · 1 · 2 · 3 · 4+", JSON.stringify(await p.$$eval(card("PRESS BANCA C/BARRA") + " .btn-rir", (b) => b.map((x) => x.textContent))) === JSON.stringify(["0", "1", "2", "3", "4+"]));
    check("peso corporal (dominadas) también lo muestra", await p.$(card("DOMINADAS TOMA NEUTRA") + " .rir-real") !== null);
    check("movilidad no muestra selector", (await p.$(card(MOVILIDAD) + " .rir-real")) === null);
    check("sin elegir: ninguno marcado", (await activo(p, "PRESS BANCA C/BARRA")) === null);

    /* Elegir, desmarcar y guardar. */
    await series(p, "PRESS BANCA C/BARRA", "55", [12, 12, 12, 12]);
    await rir(p, "PRESS BANCA C/BARRA", 0);
    await series(p, "PRESS BANCA C/MANCUERNAS", "27,5", [10, 10, 10, 10]);
    await rir(p, "PRESS BANCA C/MANCUERNAS", 4);
    await series(p, "DOMINADAS TOMA NEUTRA", "82,5", [8, 8, 8, 8]);
    await rir(p, "DOMINADAS TOMA NEUTRA", 2);
    await series(p, "TRICEPS EN POLEA BARRA PLANA", "25", [12, 12, 12]);
    await rir(p, "TRICEPS EN POLEA BARRA PLANA", 1);
    await rir(p, "TRICEPS EN POLEA BARRA PLANA", 1);
    check("tocar el elegido lo desmarca", (await activo(p, "TRICEPS EN POLEA BARRA PLANA")) === null);
    check("marcado: 'PRESS BANCA C/BARRA' → 0 y mancuernas → 4+", (await activo(p, "PRESS BANCA C/BARRA")) === "0" && (await activo(p, "PRESS BANCA C/MANCUERNAS")) === "4+");
    check("ningún input se completa solo", (await p.$$eval(card("PRESS BANCA C/BARRA") + " .serie-input-row input", (l) => l.map((i) => i.value))).join() === "55,12,55,12,55,12,55,12");
    check("390: sin scroll horizontal", await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await foto(p, "01-rir-390", card("PRESS BANCA C/BARRA"));
    await p.click('[data-accion="set-rpe"][data-valor="7"]');
    await p.click('[data-accion="guardar-sesion"]');
    const tras = await leer(p);
    const nueva = nuevaSesion(inicial, tras);
    check("guardar: RIR 0 → número 0", erDe(nueva, tras, "PRESS BANCA C/BARRA").rir_real === 0);
    check("guardar: 4+ → número 4", erDe(nueva, tras, "PRESS BANCA C/MANCUERNAS").rir_real === 4);
    check("guardar: RIR 2 en dominadas (peso corporal)", erDe(nueva, tras, "DOMINADAS TOMA NEUTRA").rir_real === 2);
    check("guardar: sin elegir → sin clave rir_real", !("rir_real" in erDe(nueva, tras, "TRICEPS EN POLEA BARRA PLANA")));
    check("guardar: snapshots y plan_id como siempre", !!nueva.plan_id && nueva.ejercicios_realizados.every((er) => er.prescripcion_snapshot));
    check("historial anterior intacto y schema 3", JSON.stringify(tras.sesiones_entrenamiento.filter((s) => s.id !== nueva.id)) === JSON.stringify(inicial.sesiones_entrenamiento) && tras.schema_version === 3);

    /* "Última vez" muestra el RIR discretamente; la recomendación lo usa. */
    await elegirDia(p);
    check("Última vez: '… · RIR 0'", /^Última vez: (55kg x12 · ){3}55kg x12 · RIR 0$/.test(await p.$eval(card("PRESS BANCA C/BARRA") + " .ejercicio-ultimo-registro", (x) => x.textContent)));
    check("Última vez: 4 se muestra como '4+'", / · RIR 4\+$/.test(await p.$eval(card("PRESS BANCA C/MANCUERNAS") + " .ejercicio-ultimo-registro", (x) => x.textContent)));
    check("Entrenar: tope + RIR 0 → 'Mantené 55 kg' (no sube)", /Mantené 55 kg/.test(await p.$eval(card("PRESS BANCA C/BARRA") + " .proxima-sesion-ej", (x) => x.textContent)));
    check("Entrenar: el formulario nuevo arranca sin RIR marcado", (await activo(p, "PRESS BANCA C/BARRA")) === null);

    /* Editar: muestra, cambia y conserva. */
    await p.click('[data-accion="editar-sesion"][data-sesion-id="' + nueva.id + '"]');
    check("editar: muestra el RIR guardado (0)", (await activo(p, "PRESS BANCA C/BARRA")) === "0");
    check("editar: dominadas muestra 2", (await activo(p, "DOMINADAS TOMA NEUTRA")) === "2");
    await rir(p, "PRESS BANCA C/BARRA", 3);
    await p.click('[data-accion="guardar-sesion"]');
    const tras2 = await leer(p);
    const editada = tras2.sesiones_entrenamiento.find((s) => s.id === nueva.id);
    check("editar: el cambio a 3 se guarda", erDe(editada, tras2, "PRESS BANCA C/BARRA").rir_real === 3);
    check("editar: los demás RIR se conservan (4 y 2)", erDe(editada, tras2, "PRESS BANCA C/MANCUERNAS").rir_real === 4 && erDe(editada, tras2, "DOMINADAS TOMA NEUTRA").rir_real === 2);
    check("editar: plan_id y snapshots conservados", editada.plan_id === nueva.plan_id &&
      JSON.stringify(editada.ejercicios_realizados.map((e) => e.prescripcion_snapshot)) === JSON.stringify(nueva.ejercicios_realizados.map((e) => e.prescripcion_snapshot)));
    await p.click('[data-accion="editar-sesion"][data-sesion-id="' + nueva.id + '"]');
    await p.click('[data-accion="guardar-sesion"]');
    check("editar y guardar sin cambios: sesión idéntica", JSON.stringify((await leer(p)).sesiones_entrenamiento.find((s) => s.id === nueva.id)) === JSON.stringify(editada));

    /* Progreso: la recomendación usa el RIR y lo explica. */
    await elegirDia(p);
    check("Entrenar tras editar a RIR 3: tope con margen → 'Subí a 57,5 kg'", /Subí a 57,5 kg/.test(await p.$eval(card("PRESS BANCA C/BARRA") + " .proxima-sesion-ej", (x) => x.textContent)));
    await p.click("#nav-progreso");
    const bloque = await p.$eval("#select-analisis-bloque", (s) => Array.from(s.options).find((o) => /^Día/.test(o.textContent)).value);
    await p.selectOption("#select-analisis-bloque", bloque);
    const ej = await p.$eval("#select-analisis-ejercicio", (s) => Array.from(s.options).find((o) => /^PRESS BANCA C\/BARRA/.test(o.textContent)).value);
    await p.selectOption("#select-analisis-ejercicio", ej);
    await p.click(".progreso-proxima-sesion summary");
    const prox = await p.$eval(".progreso-proxima-sesion", (x) => x.innerText.replace(/\s+/g, " "));
    check("Progreso: recomendación con RIR ('Subí a 57,5 kg')", /Subí a 57,5 kg/.test(prox), prox.slice(0, 200));
    check("Progreso: '¿Por qué?' → 'Último RIR registrado: 3. Objetivo del plan: 2.'", /Último RIR registrado: 3\. Objetivo del plan: 2\./.test(prox), prox);
    check("Progreso: sin la nota de 'no registramos el esfuerzo real'", !/No registramos el esfuerzo real/.test(prox));
    check("Progreso: sin scroll horizontal", await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await foto(p, "02-progreso-rir", ".progreso-proxima-sesion");
    await p.close();

    /* ---------- 320 px ---------- */
    const q = await abrir(320);
    const antesQ = await leer(q);
    await series(q, "PRESS BANCA C/BARRA", "55", [12, 12, 12, 12]);
    await rir(q, "PRESS BANCA C/BARRA", 0);
    check("320: el selector entra en la tarjeta sin scroll horizontal", await q.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth) &&
      await q.$eval(card("PRESS BANCA C/BARRA"), (c) => c.querySelector(".rir-selector").getBoundingClientRect().right <= c.getBoundingClientRect().right + 0.5));
    await foto(q, "03-rir-320", card("PRESS BANCA C/BARRA"));
    await q.click('[data-accion="set-rpe"][data-valor="8"]');
    await q.click('[data-accion="guardar-sesion"]');
    const nq = nuevaSesion(antesQ, await leer(q));
    check("320: guarda RIR 0", nq && erDe(nq, await leer(q), "PRESS BANCA C/BARRA").rir_real === 0);
    await q.click('[data-accion="editar-sesion"][data-sesion-id="' + nq.id + '"]');
    check("320: editar muestra 0", (await activo(q, "PRESS BANCA C/BARRA")) === "0");
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
  console.log("# e2e RIR real: " + ok + "/" + r.length + " ok");
  process.exit(ok === r.length ? 0 : 1);
})();
