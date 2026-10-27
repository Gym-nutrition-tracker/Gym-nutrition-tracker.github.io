/* "Acerca de" en la pantalla ⚙️ (Configuración / Cuenta): autoría discreta,
   enlace a Instagram seguro y nada más. La vista real (390/320 px, solo en
   esa pantalla) está en tests/e2e/acerca-de.e2e.js.
   Correr con: node --test tests/*.test.js */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { crearEntorno } = require("./entorno");

const RAIZ = path.join(__dirname, "..");
const html = () => crearEntorno({ sinSync: true, modulos: ["js/actividades.js", "js/rutina.js"] }).GYMAPP.rutina.renderSeccionAcercaDe();

test("1-4. 'Acerca de' con app, carácter sin fines de lucro, autor e Instagram", () => {
  const h = html();
  assert.match(h, /<div class="seccion-acerca-de"><h3>Acerca de<\/h3>/);
  assert.match(h, /Gym &amp; Nutrition Tracker/);
  assert.match(h, />Proyecto personal sin fines de lucro</);
  assert.match(h, />Desarrollado por Nicolás Olmedo</);
  assert.match(h, />@nico_olmedo<\/a>/);
});

test("5-7. enlace exacto, nueva pestaña y noopener noreferrer", () => {
  const a = /<a [^>]*>@nico_olmedo<\/a>/.exec(html())[0];
  assert.match(a, /href="https:\/\/instagram\.com\/nico_olmedo"/);
  assert.match(a, /target="_blank"/);
  assert.match(a, /rel="noopener noreferrer"/);
});

test("8. pie discreto dentro de la sección", () => {
  assert.match(html(), /<p class="acerca-de-pie">Gym &amp; Nutrition Tracker · Nicolás Olmedo<\/p><\/div>$/);
});

test("privacidad: sin email, IDs ni datos de cuenta; sin versión inventada", () => {
  const h = html();
  assert.doesNotMatch(h, /@[a-z0-9.-]+\.[a-z]{2,}|supabase|user_id|uid|token/i);
  assert.doesNotMatch(h, /versi[oó]n|v\d+\.\d+/i);
});

test("9-10. solo en rutina.js: Dashboard, Entrenar, Progreso y Nutrición no la tienen", () => {
  for (const f of ["js/dashboard.js", "js/entrenamiento.js", "js/progreso.js", "js/nutricion.js", "js/app.js"]) {
    const src = fs.readFileSync(path.join(RAIZ, f), "utf8");
    assert.doesNotMatch(src, /Acerca de|nico_olmedo|Nicolás Olmedo|acerca-de/, f);
  }
  const rutina = fs.readFileSync(path.join(RAIZ, "js/rutina.js"), "utf8");
  assert.match(rutina, /renderSeccionBackup\(\) \+\n\s+renderSeccionAcercaDe\(\) \+/, "al final, después de Copia de seguridad");
});
