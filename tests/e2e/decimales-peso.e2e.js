/* E2E de pesos decimales (Chromium/Playwright, 390 px y 320 px): escribir
   "42,5" o "42.5" en Entrenar, guardar, volver a abrir, editar y guardar
   otra vez sin perder precisión. Datos DE EJEMPLO
   (tests/fixtures/historial-progresion.js). Uso:
     PLAYWRIGHT_PATH=$(npm root -g)/playwright node tests/e2e/decimales-peso.e2e.js
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
  const fila = (nombre, i) => '.ejercicio-entrenar-card:has(strong:text-is("' + nombre + '")) .serie-input-row >> nth=' + i;
  /* Tipeo real (teclado) en el peso y las reps de una serie. */
  async function serie(page, nombre, i, peso, reps) {
    const f = page.locator(fila(nombre, i));
    await f.locator(".input-serie-peso").click();
    await page.keyboard.type(peso);
    await f.locator(".input-serie-reps").fill(String(reps));
  }
  const valorPeso = (page, nombre, i) => page.locator(fila(nombre, i)).locator(".input-serie-peso").inputValue();
  const nuevaSesion = (antes, despues) => despues.sesiones_entrenamiento.filter((s) => !antes.sesiones_entrenamiento.some((a) => a.id === s.id))[0];
  const serieDe = (sesion, d, nombre) => {
    const ej = d.rutina.planes[0].dias[0].ejercicios.find((e) => e.nombre === nombre);
    return sesion.ejercicios_realizados.find((er) => er.ejercicio_id === ej.id).series;
  };
  const foto = async (page, n, sel) => {
    if (!CAPTURAS) return;
    await page.evaluate(() => document.fonts.ready);
    const opts = { path: path.join(CAPTURAS, n + ".png"), animations: "disabled", caret: "hide" };
    if (sel) await (await page.$(sel)).screenshot(opts); else await page.screenshot(opts);
  };

  try {
    /* ---------- 390 px: crear con coma y punto ---------- */
    const p = await abrir(390);
    const inicial = await leer(p);
    check("input de peso: texto con teclado decimal (no type=number)", await p.$eval(".input-serie-peso", (i) => i.type === "text" && i.inputMode === "decimal"));
    await serie(p, "PRESS INCLINADO EN SMITH", 0, "42,5", 8);
    await serie(p, "PRESS INCLINADO EN SMITH", 1, "42.5", 8);
    await serie(p, "PRESS BANCA C/MANCUERNAS", 0, "27,5", 10);
    await serie(p, "DOMINADAS TOMA NEUTRA", 0, "82,5", 8);
    await serie(p, "BICEPS MARTILLO EN POLEA", 0, "0,25", 12);
    await serie(p, "BICEPS MARTILLO EN POLEA", 1, "25", 12);
    /* Asignación + evento input (como un teclado móvil que inserta "7,5"). */
    await p.locator(fila("TRICEPS EN POLEA BARRA PLANA", 0)).locator(".input-serie-peso").evaluate((i) => { i.value = "7,5"; i.dispatchEvent(new Event("input", { bubbles: true })); });
    await p.locator(fila("TRICEPS EN POLEA BARRA PLANA", 0)).locator(".input-serie-reps").fill("12");
    check("el input conserva lo tipeado ('42,5', no '425')", (await valorPeso(p, "PRESS INCLINADO EN SMITH", 0)) === "42,5", await valorPeso(p, "PRESS INCLINADO EN SMITH", 0));
    await p.click('[data-accion="set-rpe"][data-valor="8"]');
    await foto(p, "01-tipeado-390", '.ejercicio-entrenar-card:has(strong:text-is("PRESS INCLINADO EN SMITH"))');
    await p.click('[data-accion="guardar-sesion"]');
    const tras = await leer(p);
    const nueva = nuevaSesion(inicial, tras);
    check("guardar: se creó la sesión", !!nueva, await p.$eval("#entrenar-mensaje", (m) => m.textContent).catch(() => null));
    const smith = serieDe(nueva, tras, "PRESS INCLINADO EN SMITH");
    check("'42,5' se guarda como número 42.5", smith[0].peso_kg === 42.5 && typeof smith[0].peso_kg === "number", smith[0]);
    check("'42.5' se guarda como número 42.5", smith[1].peso_kg === 42.5, smith[1]);
    check("sugerencia PROG-04.1 de 27,5 kg registrada exacta", serieDe(nueva, tras, "PRESS BANCA C/MANCUERNAS")[0].peso_kg === 27.5);
    check("dominadas: 82,5 total (75 + lastre 7,5) exacto", serieDe(nueva, tras, "DOMINADAS TOMA NEUTRA")[0].peso_kg === 82.5);
    const biceps = serieDe(nueva, tras, "BICEPS MARTILLO EN POLEA");
    check("'0,25' → 0.25 y '25' → 25", biceps[0].peso_kg === 0.25 && biceps[1].peso_kg === 25, biceps);
    check("'7,5' por input event → 7.5", serieDe(nueva, tras, "TRICEPS EN POLEA BARRA PLANA")[0].peso_kg === 7.5);
    check("historial existente intacto", JSON.stringify(tras.sesiones_entrenamiento.filter((s) => s.id !== nueva.id)) === JSON.stringify(inicial.sesiones_entrenamiento));
    check("schema_version sigue en 3", tras.schema_version === 3);

    /* "Última vez" muestra la coma y sin ceros de más. */
    await elegirDia(p);
    const ultima = await p.$eval('.ejercicio-entrenar-card:has(strong:text-is("PRESS INCLINADO EN SMITH")) .ejercicio-ultimo-registro', (x) => x.textContent);
    check("Última vez: '42,5kg x8' (no '43', no '42.50')", /^Última vez: 42,5kg x8 · 42,5kg x8$/.test(ultima), ultima);
    const ultBiceps = await p.$eval('.ejercicio-entrenar-card:has(strong:text-is("BICEPS MARTILLO EN POLEA")) .ejercicio-ultimo-registro', (x) => x.textContent);
    check("Última vez: 25 se muestra como '25' (no '25,0')", /0,25kg x12 · 25kg x12$/.test(ultBiceps), ultBiceps);

    /* Editar: vuelve a mostrar 42,5 y al guardar sigue siendo 42.5. */
    await p.click('[data-accion="editar-sesion"][data-sesion-id="' + nueva.id + '"]');
    check("editar: el input muestra '42,5'", (await valorPeso(p, "PRESS INCLINADO EN SMITH", 0)) === "42,5", await valorPeso(p, "PRESS INCLINADO EN SMITH", 0));
    check("editar: '0,25' y '25' se muestran sin ceros de más", (await valorPeso(p, "BICEPS MARTILLO EN POLEA", 0)) === "0,25" && (await valorPeso(p, "BICEPS MARTILLO EN POLEA", 1)) === "25");
    await foto(p, "02-editar-390", '.ejercicio-entrenar-card:has(strong:text-is("PRESS INCLINADO EN SMITH"))');
    await p.click('[data-accion="guardar-sesion"]');
    const tras2 = await leer(p);
    const editada = tras2.sesiones_entrenamiento.find((s) => s.id === nueva.id);
    check("crear → guardar → editar → guardar: sesión idéntica (42.5 sigue siendo número)", JSON.stringify(editada.ejercicios_realizados) === JSON.stringify(nueva.ejercicios_realizados), editada.ejercicios_realizados[0]);
    check("sin scroll horizontal (390)", await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));

    /* Progreso: 42,5 no se redondea a 43. */
    await p.click("#nav-progreso");
    const bloque = await p.$eval("#select-analisis-bloque", (s) => Array.from(s.options).find((o) => /^Día/.test(o.textContent)).value);
    await p.selectOption("#select-analisis-bloque", bloque);
    const ejSmith = await p.$eval("#select-analisis-ejercicio", (s) => Array.from(s.options).find((o) => o.textContent === "PRESS INCLINADO EN SMITH").value);
    await p.selectOption("#select-analisis-ejercicio", ejSmith);
    const analisis = await p.$eval(".progreso-analisis-semanal", (x) => x.innerText.replace(/\s+/g, " "));
    check("Progreso: 'Peso máximo 42,5 kg' (no 43)", /Peso máximo 42,5 kg/.test(analisis) && !/43 kg/.test(analisis), analisis.slice(0, 300));
    const prox = await p.$eval(".progreso-proxima-sesion", (x) => x.innerText.replace(/\s+/g, " "));
    check("Progreso: 'Última referencia 42,5 kg · 8/8'", /Última referencia 42,5 kg · 8\/8/.test(prox), prox.slice(0, 200));
    await p.close();

    /* Validación: texto no numérico y negativos se rechazan, sin escribir. */
    const v = await abrir(390);
    const antesV = await leer(v);
    await serie(v, "PRESS INCLINADO EN SMITH", 0, "abc", 8);
    await v.click('[data-accion="set-rpe"][data-valor="8"]');
    await v.click('[data-accion="guardar-sesion"]');
    check("texto no numérico: mensaje y no guarda", /Revisá los pesos/.test(await v.$eval("#entrenar-mensaje", (m) => m.textContent)) && JSON.stringify(await leer(v)) === JSON.stringify(antesV));
    await v.locator(fila("PRESS INCLINADO EN SMITH", 0)).locator(".input-serie-peso").fill("-5");
    await v.click('[data-accion="guardar-sesion"]');
    check("negativo: mensaje y no guarda", /Revisá los pesos/.test(await v.$eval("#entrenar-mensaje", (m) => m.textContent)) && JSON.stringify(await leer(v)) === JSON.stringify(antesV));
    await v.locator(fila("PRESS INCLINADO EN SMITH", 0)).locator(".input-serie-peso").fill("");
    await v.click('[data-accion="guardar-sesion"]');
    const trasV = await leer(v);
    const conVacio = nuevaSesion(antesV, trasV);
    check("peso vacío con reps: 0 (peso corporal), como antes", conVacio && serieDe(conVacio, trasV, "PRESS INCLINADO EN SMITH")[0].peso_kg === 0);
    await v.close();

    /* ---------- 320 px: escribir, guardar, reabrir, editar ---------- */
    const q = await abrir(320);
    const antesQ = await leer(q);
    await serie(q, "PRESS INCLINADO EN SMITH", 0, "42,5", 7);
    await q.click('[data-accion="set-rpe"][data-valor="7"]');
    await q.click('[data-accion="guardar-sesion"]');
    const nq = nuevaSesion(antesQ, await leer(q));
    check("320: guarda 42,5 como 42.5", nq && nq.ejercicios_realizados[0].series[0].peso_kg === 42.5);
    await q.reload();
    await seguirSinCuenta(q);
    await q.click("#nav-entrenar");
    await q.click('[data-accion="editar-sesion"][data-sesion-id="' + nq.id + '"]');
    check("320: tras recargar, editar muestra '42,5'", (await valorPeso(q, "PRESS INCLINADO EN SMITH", 0)) === "42,5");
    await q.click('[data-accion="guardar-sesion"]');
    check("320: guardar de nuevo conserva 42.5", (await leer(q)).sesiones_entrenamiento.find((s) => s.id === nq.id).ejercicios_realizados[0].series[0].peso_kg === 42.5);
    check("320: sin scroll horizontal", await q.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await foto(q, "03-entrenar-320");
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
  console.log("# e2e decimales peso: " + ok + "/" + r.length + " ok");
  process.exit(ok === r.length ? 0 : 1);
})();
