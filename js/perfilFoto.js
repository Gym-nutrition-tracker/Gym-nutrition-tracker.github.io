/* PROFILE-01: foto de perfil opcional, solo para usuarios con cuenta.

   - La imagen vive en Supabase Storage (bucket PRIVADO "avatars"), nunca en
     el blob de la app, en localStorage ni en sync.
   - Ruta fija derivada del user.id: "<user_id>/avatar". No se persiste
     ninguna referencia: si el archivo existe, hay foto. Una sola ruta por
     usuario = cambiar la foto la reemplaza (upsert) y nunca deja huérfanos.
   - Se muestra con signed URLs de corta duración, cacheadas solo en memoria.
   - Prioridad visual: foto subida > foto de Google (solo se muestra, nunca
     se copia ni se guarda) > inicial genérica.
   - Modo sin cuenta: avatar genérico, sin tocar Storage. */
var GYMAPP = window.GYMAPP || (window.GYMAPP = {});

GYMAPP.perfilFoto = (function () {
  var BUCKET = "avatars";
  var NOMBRE_ARCHIVO = "avatar";
  var TIPOS_ACEPTADOS = ["image/jpeg", "image/png", "image/webp"];
  var TAMANO_MAXIMO_ORIGINAL = 10 * 1024 * 1024; /* antes de comprimir */
  var TAMANO_MAXIMO_FINAL = 1024 * 1024; /* lo que se sube */
  var LADO_MAXIMO = 512;
  var CALIDAD = 0.8;
  var VIGENCIA_URL_S = 3600;

  var MENSAJE_ERROR_SUBIR = "No pudimos subir la foto.";
  var MENSAJE_ERROR_ELIMINAR = "No pudimos eliminar la foto.";

  /* --- Puras --- */

  /* Ruta del avatar de un usuario. Solo acepta un id con forma de UUID de
     Supabase: nunca un email ni algo con "/" o "..". */
  function rutaAvatar(userId) {
    if (typeof userId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) return null;
    return userId.toLowerCase() + "/" + NOMBRE_ARCHIVO;
  }

  /* null si el archivo elegido se puede usar, o el mensaje para el usuario. */
  function validarArchivo(archivo) {
    if (!archivo) return "Elegí una imagen.";
    if (TIPOS_ACEPTADOS.indexOf(String(archivo.type).toLowerCase()) === -1) return "Elegí una imagen JPG, PNG o WebP.";
    if (!(archivo.size > 0)) return "La imagen está vacía.";
    if (archivo.size > TAMANO_MAXIMO_ORIGINAL) return "La imagen es demasiado grande (máximo 10 MB).";
    return null;
  }

  /* Recorte cuadrado centrado y lado de salida (<= 512, sin agrandar). */
  function calcularRecorte(ancho, alto) {
    var lado = Math.min(ancho, alto);
    return {
      sx: Math.floor((ancho - lado) / 2),
      sy: Math.floor((alto - lado) / 2),
      lado: lado,
      salida: Math.min(lado, LADO_MAXIMO)
    };
  }

  /* Inicial para el avatar genérico: nombre del perfil local, si no el
     email, si no nada (se muestra un ícono). */
  function inicial(nombre, email) {
    var t = String(nombre || "").trim() || String(email || "").trim();
    var c = t.charAt(0);
    return c ? c.toLocaleUpperCase("es-AR") : "";
  }

  /* URL de la foto de Google de la sesión (solo para mostrar). Solo https. */
  function fotoGoogle(sesion) {
    var meta = sesion && sesion.user && sesion.user.user_metadata;
    var url = meta && (meta.avatar_url || meta.picture);
    return typeof url === "string" && /^https:\/\//.test(url) ? url : null;
  }

  /* --- Estado en memoria (nunca se persiste) --- */

  /* userId → { url, vence, existe } */
  var cache = {};
  var pendientes = {};

  function sesionActual() {
    return GYMAPP.auth && GYMAPP.auth.obtenerSesion ? GYMAPP.auth.obtenerSesion() : null;
  }

  function cliente() {
    return GYMAPP.auth && GYMAPP.auth.obtenerCliente ? GYMAPP.auth.obtenerCliente() : null;
  }

  function idDeSesion(sesion) {
    return sesion && sesion.user && sesion.user.id ? sesion.user.id : null;
  }

  function vigente(entrada) {
    return entrada && (!entrada.existe || entrada.vence > Date.now());
  }

  /* Pide (una vez) la signed URL de la foto del usuario DE LA SESIÓN (nunca
     de otro id). "No existe" no es un error: se recuerda y se muestra el
     fallback. Errores de red: también fallback, sin mensaje. */
  function cargarFoto(userId) {
    var ruta = rutaAvatar(userId);
    var c = cliente();
    if (!ruta || !c || !c.storage || userId !== idDeSesion(sesionActual())) return Promise.resolve(null);
    if (vigente(cache[userId])) return Promise.resolve(cache[userId]);
    if (pendientes[userId]) return pendientes[userId];
    pendientes[userId] = c.storage.from(BUCKET).createSignedUrl(ruta, VIGENCIA_URL_S)
      .then(function (r) {
        var url = r && !r.error && r.data && r.data.signedUrl;
        cache[userId] = url ? { url: url, existe: true, vence: Date.now() + (VIGENCIA_URL_S - 60) * 1000 } : { existe: false };
        return cache[userId];
      })
      .catch(function () { return null; })
      .then(function (v) { delete pendientes[userId]; return v; });
    return pendientes[userId];
  }

  /* --- Render --- */

  /* Avatar: <span class="avatar" data-avatar-usuario="..."> con la imagen
     si ya se conoce, o la inicial/ícono. `tamano`: "chico" | "grande". */
  function renderAvatar(opciones) {
    opciones = opciones || {};
    var esc = GYMAPP.util.escapeHtml;
    var sesion = opciones.sesion;
    var userId = idDeSesion(sesion);
    var entrada = userId ? cache[userId] : null;
    var url = entrada && entrada.existe && vigente(entrada) ? entrada.url : null;
    var google = !url && (!entrada || !entrada.existe) ? fotoGoogle(sesion) : null;
    var letra = inicial(opciones.nombre, sesion && sesion.user && sesion.user.email);
    var clase = "avatar avatar-" + (opciones.tamano || "chico");
    var contenido = url
      ? '<img src="' + esc(url).replace(/"/g, "&quot;") + '" alt="" />'
      : google
        ? '<img src="' + esc(google).replace(/"/g, "&quot;") + '" alt="" referrerpolicy="no-referrer" />'
        : letra ? '<span class="avatar-inicial">' + esc(letra) + "</span>" : '<span class="avatar-generico">👤</span>';
    return (
      '<span class="' + clase + (url ? " avatar-con-foto" : google ? " avatar-google" : "") + '"' +
      (userId ? ' data-avatar-usuario="' + esc(userId) + '"' : "") +
      ' data-avatar-nombre="' + esc(opciones.nombre || "").replace(/"/g, "&quot;") + '"' +
      ' role="img" aria-label="Foto de perfil">' + contenido + "</span>"
    );
  }

  /* Bloque de foto dentro de Cuenta (solo con sesión). */
  function renderBloqueCuenta(sesion, nombre) {
    var userId = idDeSesion(sesion);
    if (!userId) return "";
    var entrada = cache[userId];
    var tieneFoto = !!(entrada && entrada.existe);
    var google = !tieneFoto && fotoGoogle(sesion);
    return (
      '<div class="perfil-foto" data-perfil-foto>' +
      renderAvatar({ sesion: sesion, nombre: nombre, tamano: "grande" }) +
      '<div class="perfil-foto-acciones">' +
      '<button type="button" data-accion="perfil-foto-cambiar" class="btn btn-secundario">' + (tieneFoto ? "Cambiar foto" : "Agregar foto") + "</button>" +
      (tieneFoto ? '<button type="button" data-accion="perfil-foto-eliminar" class="btn-enlace perfil-foto-eliminar">Eliminar foto</button>' : "") +
      (google ? '<p class="nota perfil-foto-nota">Se muestra tu foto de Google. Podés subir otra.</p>' : "") +
      '<input type="file" id="input-perfil-foto" accept="image/jpeg,image/png,image/webp" hidden />' +
      '<p class="mensaje oculto" id="perfil-foto-mensaje" role="status"></p>' +
      "</div>" +
      "</div>"
    );
  }

  /* Completa los avatares ya pintados cuando llega la signed URL. */
  function hidratar(raiz) {
    var sesion = sesionActual();
    var userId = idDeSesion(sesion);
    if (!userId) return;
    var nodos = (raiz || document).querySelectorAll('[data-avatar-usuario="' + userId + '"]');
    if (!nodos.length) return;
    cargarFoto(userId).then(function (entrada) {
      if (!entrada) return;
      actualizarDom(sesion);
    });
  }

  /* Re-pinta en el lugar todos los avatares y el bloque de Cuenta del
     usuario actual (sin re-renderizar pantallas). */
  function actualizarDom(sesion) {
    var userId = idDeSesion(sesion);
    if (!userId || typeof document === "undefined") return;
    document.querySelectorAll('[data-avatar-usuario="' + userId + '"]').forEach(function (n) {
      var grande = n.classList.contains("avatar-grande");
      var tmp = document.createElement("span");
      tmp.innerHTML = renderAvatar({ sesion: sesion, nombre: n.getAttribute("data-avatar-nombre"), tamano: grande ? "grande" : "chico" });
      n.replaceWith(tmp.firstChild);
    });
    document.querySelectorAll("[data-perfil-foto]").forEach(function (b) {
      var nombre = (b.querySelector("[data-avatar-nombre]") || { getAttribute: function () { return ""; } }).getAttribute("data-avatar-nombre");
      var tmp = document.createElement("div");
      tmp.innerHTML = renderBloqueCuenta(sesion, nombre);
      b.replaceWith(tmp.firstChild);
    });
  }

  function mostrarMensaje(texto, tipo) {
    var el = document.getElementById("perfil-foto-mensaje");
    if (!el) return;
    el.textContent = texto;
    el.className = "mensaje " + (tipo || "info");
  }

  /* --- Compresión (navegador) --- */

  function cargarImagen(archivo) {
    if (typeof createImageBitmap === "function") return createImageBitmap(archivo);
    return new Promise(function (ok, mal) {
      var url = URL.createObjectURL(archivo);
      var img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); ok(img); };
      img.onerror = function () { URL.revokeObjectURL(url); mal(new Error("imagen")); };
      img.src = url;
    });
  }

  function aBlob(canvas, tipo, calidad) {
    return new Promise(function (ok) { canvas.toBlob(ok, tipo, calidad); });
  }

  /* Recorte cuadrado centrado, máximo 512x512, WebP ~0,8 (JPEG si el
     navegador no codifica WebP). Baja la calidad si aún pesa > 1 MB. */
  function comprimir(archivo) {
    return cargarImagen(archivo).then(function (img) {
      var ancho = img.width || img.naturalWidth, alto = img.height || img.naturalHeight;
      if (!ancho || !alto) throw new Error("imagen vacía");
      var r = calcularRecorte(ancho, alto);
      var canvas = document.createElement("canvas");
      canvas.width = r.salida;
      canvas.height = r.salida;
      var ctx = canvas.getContext("2d");
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, r.sx, r.sy, r.lado, r.lado, 0, 0, r.salida, r.salida);
      if (img.close) img.close();
      var intentar = function (calidad) {
        return aBlob(canvas, "image/webp", calidad).then(function (b) {
          if (!b || b.type !== "image/webp") return aBlob(canvas, "image/jpeg", calidad);
          return b;
        }).then(function (b) {
          if (!b) throw new Error("no se pudo codificar");
          if (b.size > TAMANO_MAXIMO_FINAL && calidad > 0.4) return intentar(Math.round((calidad - 0.2) * 10) / 10);
          if (b.size > TAMANO_MAXIMO_FINAL) throw new Error("demasiado grande");
          return b;
        });
      };
      return intentar(CALIDAD);
    });
  }

  /* --- Storage --- */

  /* Sube (o reemplaza) la foto del usuario de la sesión. Nunca a otra ruta. */
  function subir(blob) {
    var sesion = sesionActual();
    var ruta = rutaAvatar(idDeSesion(sesion));
    var c = cliente();
    if (!ruta || !c || !c.storage) return Promise.reject(new Error("sin sesión"));
    return c.storage.from(BUCKET).upload(ruta, blob, { upsert: true, contentType: blob.type, cacheControl: "3600" })
      .then(function (r) {
        if (r && r.error) throw r.error;
        var userId = idDeSesion(sesion);
        var anterior = cache[userId];
        if (anterior && anterior.local) URL.revokeObjectURL(anterior.url);
        /* La nueva foto se muestra desde el blob local (sin volver a bajarla
           ni arriesgar la versión vieja en caché). La próxima carga pide una
           signed URL nueva (token distinto = URL distinta). */
        cache[userId] = { url: URL.createObjectURL(blob), existe: true, local: true, vence: Infinity };
        return true;
      });
  }

  function eliminar() {
    var sesion = sesionActual();
    var userId = idDeSesion(sesion);
    var ruta = rutaAvatar(userId);
    var c = cliente();
    if (!ruta || !c || !c.storage) return Promise.reject(new Error("sin sesión"));
    return c.storage.from(BUCKET).remove([ruta]).then(function (r) {
      if (r && r.error) throw r.error;
      var anterior = cache[userId];
      if (anterior && anterior.local) URL.revokeObjectURL(anterior.url);
      cache[userId] = { existe: false };
      return true;
    });
  }

  /* --- Eventos (Cuenta) --- */

  var ocupado = false;

  function bindEventos(container) {
    container.addEventListener("click", function (ev) {
      var boton = ev.target.closest('[data-accion="perfil-foto-cambiar"], [data-accion="perfil-foto-eliminar"]');
      if (!boton || ocupado) return;
      if (boton.dataset.accion === "perfil-foto-cambiar") {
        var input = container.querySelector("#input-perfil-foto");
        if (input) input.click();
      } else {
        if (!confirm("¿Eliminar tu foto de perfil?")) return;
        ocupado = true;
        boton.disabled = true;
        eliminar()
          .then(function () { ocupado = false; actualizarDom(sesionActual()); })
          .catch(function (e) {
            ocupado = false;
            boton.disabled = false;
            console.warn("perfilFoto: eliminar", e && e.message);
            mostrarMensaje(MENSAJE_ERROR_ELIMINAR, "error");
          });
      }
    });
    container.addEventListener("change", function (ev) {
      if (!ev.target || ev.target.id !== "input-perfil-foto") return;
      var archivo = ev.target.files && ev.target.files[0];
      ev.target.value = "";
      if (!archivo || ocupado) return;
      var error = validarArchivo(archivo);
      if (error) { mostrarMensaje(error, "error"); return; }
      ocupado = true;
      mostrarMensaje("Subiendo foto…", "info");
      comprimir(archivo)
        .then(subir)
        .then(function () { ocupado = false; actualizarDom(sesionActual()); })
        .catch(function (e) {
          ocupado = false;
          console.warn("perfilFoto: subir", e && e.message);
          mostrarMensaje(MENSAJE_ERROR_SUBIR, "error");
        });
    });
  }

  /* Avatar del encabezado: único lugar que lo pone o lo saca. Con sesión,
     envuelve el saludo con el avatar; sin sesión, deja el saludo como
     siempre. Se llama al armar el shell y cada vez que cambia la sesión. */
  function actualizarEncabezado() {
    if (typeof document === "undefined") return;
    var header = document.querySelector(".app-header");
    if (!header) return;
    var sesion = sesionActual();
    var envoltura = header.querySelector(".app-header-saludo");
    var saludo = envoltura ? envoltura.lastElementChild : header.firstElementChild;
    if (!saludo) return;
    if (!idDeSesion(sesion)) {
      if (envoltura) envoltura.replaceWith(saludo);
      return;
    }
    var tmp = document.createElement("span");
    tmp.innerHTML = '<span class="app-header-saludo">' + renderAvatar({ sesion: sesion, tamano: "chico" }) + "</span>";
    var nueva = tmp.firstChild;
    (envoltura || saludo).replaceWith(nueva);
    nueva.appendChild(saludo);
    hidratar(header);
  }

  /* Al cambiar de cuenta o cerrar sesión: se olvida todo lo cacheado y el
     encabezado se actualiza en el momento (sin recargar). */
  if (GYMAPP.auth && GYMAPP.auth.suscribirCambiosSesion) {
    var ultimoId = null;
    GYMAPP.auth.suscribirCambiosSesion(function (sesion) {
      var id = idDeSesion(sesion);
      if (id === ultimoId) return;
      ultimoId = id;
      Object.keys(cache).forEach(function (k) { if (cache[k].local) URL.revokeObjectURL(cache[k].url); delete cache[k]; });
      actualizarEncabezado();
    });
  }

  return {
    BUCKET: BUCKET,
    rutaAvatar: rutaAvatar,
    validarArchivo: validarArchivo,
    calcularRecorte: calcularRecorte,
    inicial: inicial,
    fotoGoogle: fotoGoogle,
    cargarFoto: cargarFoto,
    renderAvatar: renderAvatar,
    renderBloqueCuenta: renderBloqueCuenta,
    hidratar: hidratar,
    actualizarEncabezado: actualizarEncabezado,
    comprimir: comprimir,
    subir: subir,
    eliminar: eliminar,
    bindEventos: bindEventos,
    MENSAJE_ERROR_SUBIR: MENSAJE_ERROR_SUBIR,
    MENSAJE_ERROR_ELIMINAR: MENSAJE_ERROR_ELIMINAR
  };
})();
