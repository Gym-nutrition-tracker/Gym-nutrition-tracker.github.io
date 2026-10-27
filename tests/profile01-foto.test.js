/* PROFILE-01: foto de perfil opcional en Supabase Storage (bucket privado
   "avatars", ruta "<user_id>/avatar"). Storage falso en tests/entorno.js con
   la misma regla que supabase/storage-avatars.sql. La UI (Cuenta,
   encabezado, subir/reemplazar/borrar con imágenes reales) está en
   tests/e2e/perfil-foto.e2e.js.
   Correr con: node --test tests/*.test.js */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { crearEntorno, esperar, clonar, datosEjemplo } = require("./entorno");

const RAIZ = path.join(__dirname, "..");
const CLAVE = "gymNutritionTracker";
const UID_A = "1b2c3d4e-0000-4000-8000-00000000000a";
const UID_B = "1b2c3d4e-0000-4000-8000-00000000000b";

function entorno(opciones) {
  opciones = opciones || {};
  const e = crearEntorno({ sinSync: true, modulos: ["js/perfilFoto.js"] });
  let n = 0;
  e.urls = { creadas: [], revocadas: [] };
  e.ctx.URL = {
    createObjectURL: () => { const u = "blob:local/" + (++n); e.urls.creadas.push(u); return u; },
    revokeObjectURL: (u) => e.urls.revocadas.push(u)
  };
  e.escribir(CLAVE, datosEjemplo());
  if (opciones.uid) e.auth.sesion = { user: Object.assign({ id: opciones.uid, email: "ana@test.com", user_metadata: {} }, opciones.user || {}) };
  return e;
}
const P = (e) => e.GYMAPP.perfilFoto;
const blob = (tipo, tam) => ({ type: tipo || "image/webp", size: tam || 40000 });
const sesion = (e) => e.GYMAPP.auth.obtenerSesion();

/* --- Ruta e identidad --- */

test("ruta derivada del user.id: '<uid>/avatar' (nada persistido, nunca el email)", () => {
  const p = P(entorno());
  assert.equal(p.BUCKET, "avatars");
  assert.equal(p.rutaAvatar(UID_A), UID_A + "/avatar");
  assert.equal(p.rutaAvatar(UID_A.toUpperCase()), UID_A + "/avatar", "en minúsculas, como auth.uid()");
  ["ana@test.com", "../" + UID_B, UID_A + "/../x", "", null, undefined, 123].forEach((v) => assert.equal(p.rutaAvatar(v), null, String(v)));
});

/* --- 1, 2: fallback y avatar visible --- */

test("1. usuario sin foto → fallback: inicial del email (o ícono si no hay nada)", async () => {
  const e = entorno({ uid: UID_A });
  const r = await P(e).cargarFoto(UID_A);
  assert.equal(r.existe, false);
  const html = P(e).renderAvatar({ sesion: sesion(e) });
  assert.match(html, /<span class="avatar-inicial">A<\/span>/);
  assert.doesNotMatch(html, /<img/);
  assert.match(P(e).renderAvatar({}), /avatar-generico/, "sin sesión ni nombre: ícono genérico");
  assert.match(P(e).renderAvatar({ nombre: "nico" }), /avatar-inicial">N</);
});

test("2. usuario con foto → avatar con la signed URL (bucket privado)", async () => {
  const e = entorno({ uid: UID_A });
  e.almacen.objetos[UID_A + "/avatar"] = { tipo: "image/webp" };
  const r = await P(e).cargarFoto(UID_A);
  assert.equal(r.existe, true);
  assert.match(r.url, /^https:\/\/fake\.supabase\.co\/storage\/v1\/object\/sign\/avatars\/1b2c3d4e-0000-4000-8000-00000000000a\/avatar\?token=/);
  assert.deepEqual(e.almacen.llamadas[0], ["createSignedUrl", "avatars", UID_A + "/avatar", 3600]);
  const html = P(e).renderAvatar({ sesion: sesion(e), tamano: "grande" });
  assert.match(html, /avatar avatar-grande avatar-con-foto/);
  assert.match(html, /<img src="https:\/\/fake\.supabase\.co\/storage\/v1\/object\/sign\/avatars\//);
  await P(e).cargarFoto(UID_A);
  assert.equal(e.almacen.llamadas.length, 1, "la URL vigente se reutiliza (una sola firma)");
});

test("Cuenta: 'Agregar foto' sin foto; 'Cambiar foto' + 'Eliminar foto' con foto", async () => {
  const e = entorno({ uid: UID_A });
  await P(e).cargarFoto(UID_A);
  const sin = P(e).renderBloqueCuenta(sesion(e), null);
  assert.match(sin, /data-accion="perfil-foto-cambiar"[^>]*>Agregar foto</);
  assert.doesNotMatch(sin, /perfil-foto-eliminar/);
  assert.match(sin, /<input type="file" id="input-perfil-foto" accept="image\/jpeg,image\/png,image\/webp" hidden \/>/);
  await P(e).subir(blob());
  const con = P(e).renderBloqueCuenta(sesion(e), null);
  assert.match(con, />Cambiar foto</);
  assert.match(con, /data-accion="perfil-foto-eliminar"[^>]*>Eliminar foto</);
  assert.equal(P(entorno()).renderBloqueCuenta(null, null), "", "sin cuenta no hay bloque de foto");
});

/* --- 3-6: subir, validar, comprimir --- */

test("3. subir foto válida: upsert a '<uid>/avatar' con su tipo y cacheControl", async () => {
  const e = entorno({ uid: UID_A });
  await P(e).subir(blob("image/webp", 52000));
  assert.deepEqual(clonar(e.almacen.llamadas), [["upload", "avatars", UID_A + "/avatar", { upsert: true, contentType: "image/webp", cacheControl: "3600" }]]);
  assert.ok(e.almacen.objetos[UID_A + "/avatar"]);
});

test("4. formato inválido rechazado (gif, heic, pdf, sin tipo)", () => {
  const p = P(entorno());
  ["image/gif", "image/heic", "application/pdf", ""].forEach((t) => assert.equal(p.validarArchivo({ type: t, size: 1000 }), "Elegí una imagen JPG, PNG o WebP.", t));
  ["image/jpeg", "image/png", "image/webp", "IMAGE/JPEG"].forEach((t) => assert.equal(p.validarArchivo({ type: t, size: 1000 }), null, t));
});

test("5. archivo demasiado grande (> 10 MB antes de comprimir) o vacío: rechazado", () => {
  const p = P(entorno());
  assert.equal(p.validarArchivo({ type: "image/jpeg", size: 10 * 1024 * 1024 + 1 }), "La imagen es demasiado grande (máximo 10 MB).");
  assert.equal(p.validarArchivo({ type: "image/jpeg", size: 10 * 1024 * 1024 }), null);
  assert.equal(p.validarArchivo({ type: "image/jpeg", size: 0 }), "La imagen está vacía.");
  assert.equal(p.validarArchivo(null), "Elegí una imagen.");
});

test("6. recorte cuadrado centrado a máximo 512x512 (sin agrandar)", () => {
  const p = P(entorno());
  assert.deepEqual(clonar(p.calcularRecorte(4000, 3000)), { sx: 500, sy: 0, lado: 3000, salida: 512 });
  assert.deepEqual(clonar(p.calcularRecorte(1080, 1920)), { sx: 0, sy: 420, lado: 1080, salida: 512 });
  assert.deepEqual(clonar(p.calcularRecorte(300, 200)), { sx: 50, sy: 0, lado: 200, salida: 200 });
  assert.deepEqual(clonar(p.calcularRecorte(512, 512)), { sx: 0, sy: 0, lado: 512, salida: 512 });
});

/* --- 7-9: cambiar, eliminar, caché --- */

test("7. cambiar foto: misma ruta (reemplaza, sin huérfanos) y la UI usa la nueva", async () => {
  const e = entorno({ uid: UID_A });
  await P(e).subir(blob("image/webp", 1));
  const primera = P(e).renderAvatar({ sesion: sesion(e) });
  await P(e).subir(blob("image/jpeg", 2));
  const segunda = P(e).renderAvatar({ sesion: sesion(e) });
  assert.deepEqual(Object.keys(e.almacen.objetos), [UID_A + "/avatar"], "un solo archivo por usuario");
  assert.equal(e.almacen.objetos[UID_A + "/avatar"].tipo, "image/jpeg");
  assert.notEqual(primera, segunda);
  assert.deepEqual(e.urls.revocadas, ["blob:local/1"], "la URL local anterior se libera");
});

test("8. eliminar foto: remove de su ruta, vuelve al fallback, no toca datos", async () => {
  const e = entorno({ uid: UID_A });
  const antes = e.localStorage.getItem(CLAVE);
  await P(e).subir(blob());
  await P(e).eliminar();
  assert.deepEqual(clonar(e.almacen.llamadas.at(-1)), ["remove", "avatars", [UID_A + "/avatar"]]);
  assert.deepEqual(e.almacen.objetos, {});
  assert.match(P(e).renderAvatar({ sesion: sesion(e) }), /avatar-inicial">A</);
  assert.doesNotMatch(P(e).renderBloqueCuenta(sesion(e), null), /Eliminar foto/);
  assert.equal(e.localStorage.getItem(CLAVE), antes, "datos de entrenamiento intactos");
});

test("errores de Storage: se propagan para mostrar el mensaje simple; el estado no cambia", async () => {
  const e = entorno({ uid: UID_A });
  e.almacen.error = { message: "Payload too large: internal detail" };
  await assert.rejects(P(e).subir(blob()));
  await assert.rejects(P(e).eliminar());
  assert.equal(P(e).MENSAJE_ERROR_SUBIR, "No pudimos subir la foto.");
  assert.equal(P(e).MENSAJE_ERROR_ELIMINAR, "No pudimos eliminar la foto.");
  assert.doesNotMatch(P(e).renderAvatar({ sesion: sesion(e) }), /<img/);
});

test("9. caché: tras reemplazar se muestra la nueva (URL local); una carga nueva firma otra URL", async () => {
  const e = entorno({ uid: UID_A });
  e.almacen.objetos[UID_A + "/avatar"] = { tipo: "image/webp" };
  const vieja = (await P(e).cargarFoto(UID_A)).url;
  await P(e).subir(blob());
  assert.match(P(e).renderAvatar({ sesion: sesion(e) }), /<img src="blob:local\/1"/, "no la URL firmada vieja");
  /* Otra apertura de la app (caché en memoria vacía): firma nueva → URL distinta. */
  const e2 = entorno({ uid: UID_A });
  e2.almacen.objetos[UID_A + "/avatar"] = { tipo: "image/webp" };
  e2.almacen.firmas = 1;
  const nueva = (await P(e2).cargarFoto(UID_A)).url;
  assert.notEqual(nueva, vieja);
});

/* --- 10, 11: identidad y modo sin cuenta --- */

test("10. usuario A nunca escribe ni borra la foto de B (frontend + regla de Storage)", async () => {
  const e = entorno({ uid: UID_A });
  e.almacen.objetos[UID_B + "/avatar"] = { tipo: "image/webp" };
  await P(e).subir(blob());
  await P(e).eliminar();
  assert.ok(e.almacen.objetos[UID_B + "/avatar"], "la de B sigue");
  assert.ok(e.almacen.llamadas.every((l) => l[2] === UID_A + "/avatar" || (Array.isArray(l[2]) && l[2][0] === UID_A + "/avatar")), "solo la ruta propia");
  /* Aunque alguien llamara a Storage con la ruta de B, la regla lo rechaza. */
  const r = await e.nube.cliente.storage.from("avatars").upload(UID_B + "/avatar", blob(), { upsert: true });
  assert.match(r.error.message, /row-level security/);
  assert.equal(await P(e).cargarFoto(UID_B), null, "el frontend ni siquiera intenta leer la de otro");
  const ajena = await e.nube.cliente.storage.from("avatars").createSignedUrl(UID_B + "/avatar", 60);
  assert.equal(ajena.data, null, "y la regla tampoco la firma");
});

test("10b. las 4 políticas SQL restringen al bucket 'avatars' y a '<auth.uid()>/avatar'", () => {
  const sql = fs.readFileSync(path.join(RAIZ, "supabase/storage-avatars.sql"), "utf8");
  assert.match(sql, /values \('avatars', 'avatars', false, 1048576, array\['image\/webp', 'image\/jpeg'\]\)/, "bucket privado, 1 MB, WebP/JPEG");
  const politicas = sql.match(/create policy[\s\S]*?;/g);
  assert.equal(politicas.length, 4);
  const ops = politicas.map((p) => /for (select|insert|update|delete)/.exec(p)[1]).sort();
  assert.deepEqual(ops, ["delete", "insert", "select", "update"]);
  politicas.forEach((p) => {
    assert.match(p, /to authenticated/);
    const condiciones = p.match(/\((bucket_id[^;]*?'\/avatar')\)/g) || [];
    assert.ok(condiciones.length >= 1, p);
    condiciones.forEach((c) => assert.match(c, /bucket_id = 'avatars' and name = \(select auth\.uid\(\)\)::text \|\| '\/avatar'/));
  });
  const sinComentarios = sql.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");
  assert.doesNotMatch(sinComentarios, /service_role|public = true|to anon|to public/);
});

test("11. modo sin cuenta: nunca toca Storage y muestra avatar genérico", async () => {
  const e = entorno();
  assert.equal(await P(e).cargarFoto(null), null);
  assert.equal(await P(e).cargarFoto(UID_A), null, "sin sesión, ni con un id ajeno");
  await assert.rejects(P(e).subir(blob()));
  await assert.rejects(P(e).eliminar());
  assert.deepEqual(e.almacen.llamadas, [], "cero llamadas a Storage");
  const html = P(e).renderAvatar({ sesion: null, nombre: "Nico" });
  assert.doesNotMatch(html, /data-avatar-usuario/);
  assert.match(html, /avatar-inicial">N</);
});

/* --- 12, 13: Google y nada en el blob --- */

test("12. foto de Google: solo se MUESTRA como fallback; nunca se sube ni se guarda", async () => {
  const e = entorno({ uid: UID_A, user: { user_metadata: { avatar_url: "https://lh3.googleusercontent.com/a/foto", picture: "https://lh3.googleusercontent.com/a/foto" } } });
  await P(e).cargarFoto(UID_A);
  const html = P(e).renderAvatar({ sesion: sesion(e) });
  assert.match(html, /<img src="https:\/\/lh3\.googleusercontent\.com\/a\/foto" alt="" referrerpolicy="no-referrer" \/>/);
  assert.match(P(e).renderBloqueCuenta(sesion(e), null), /Se muestra tu foto de Google\. Podés subir otra\./);
  assert.equal(e.almacen.llamadas.filter((l) => l[0] === "upload").length, 0);
  assert.deepEqual(e.localStorage._escrituras, []);
  /* La foto subida tiene prioridad sobre la de Google. */
  await P(e).subir(blob());
  assert.doesNotMatch(P(e).renderAvatar({ sesion: sesion(e) }), /googleusercontent/);
  /* Solo https. */
  assert.equal(P(e).fotoGoogle({ user: { user_metadata: { avatar_url: "javascript:alert(1)" } } }), null);
  assert.equal(P(e).fotoGoogle({ user: { user_metadata: { picture: "http://inseguro/x.png" } } }), null);
});

test("13-14. sin base64 ni referencias en el blob, sin escrituras locales; schema_version 3", async () => {
  const e = entorno({ uid: UID_A });
  const antes = e.localStorage.getItem(CLAVE);
  await P(e).subir(blob());
  await P(e).cargarFoto(UID_A);
  P(e).renderBloqueCuenta(sesion(e), null);
  await P(e).eliminar();
  assert.deepEqual(e.localStorage._escrituras, []);
  assert.equal(e.localStorage.getItem(CLAVE), antes);
  for (const [, v] of e.localStorage._mapa) {
    assert.doesNotMatch(v, /data:image|base64|avatar/i);
  }
  assert.equal(JSON.parse(antes).schema_version, 3);
  const codigo = fs.readFileSync(path.join(RAIZ, "js/perfilFoto.js"), "utf8");
  assert.doesNotMatch(codigo, /toDataURL\(|readAsDataURL\(|localStorage\.|sessionStorage\.|updateData\(|storage\.save\(/, "el módulo no codifica en base64 ni escribe datos locales");
});

test("15. sync.js intacto (MD5) y sin secretos en el frontend", () => {
  const md5 = crypto.createHash("md5").update(fs.readFileSync(path.join(RAIZ, "js/sync.js"))).digest("hex");
  assert.equal(md5, "4ed9478ca49c4a26e86a6c5710761024");
  const texto = ["index.html", ...fs.readdirSync(path.join(RAIZ, "js")).map((f) => "js/" + f)].map((f) => fs.readFileSync(path.join(RAIZ, f), "utf8")).join("\n");
  assert.doesNotMatch(texto, /sb_secret_|GOCSPX-|eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}/, "ni secret key, ni Client Secret, ni JWT (service_role)");
});

test("cambio de cuenta: la caché de la anterior se descarta (no se muestra la foto de otro)", async () => {
  const e = crearEntorno({ authReal: true, sinSync: true, modulos: ["js/perfilFoto.js"] });
  e.ctx.URL = { createObjectURL: () => "blob:local/x", revokeObjectURL() {} };
  e.GYMAPP.auth.obtenerCliente();
  e.auth.sesion = { user: { id: UID_A, email: "a@test.com", user_metadata: {} } };
  e.auth.eventos("SIGNED_IN", e.auth.sesion);
  await e.GYMAPP.perfilFoto.subir(blob());
  assert.match(e.GYMAPP.perfilFoto.renderAvatar({ sesion: e.auth.sesion }), /blob:local\/x/);
  e.auth.sesion = { user: { id: UID_B, email: "b@test.com", user_metadata: {} } };
  e.auth.eventos("SIGNED_IN", e.auth.sesion);
  await esperar();
  const html = e.GYMAPP.perfilFoto.renderAvatar({ sesion: { user: { id: UID_A, email: "a@test.com" } } });
  assert.doesNotMatch(html, /blob:local/, "lo de A ya no está en memoria");
});
