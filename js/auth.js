/* Autenticación opcional con Supabase Auth mediante email + contraseña
   (supabase.auth.signUp / signInWithPassword) y, desde AUTH-04, Google
   (signInWithOAuth) desde la pantalla inicial de acceso. Objetivo: que la
   misma cuenta se use en celular, tablet y computadora para sincronizar
   datos propios; esta versión implementa exclusivamente la autenticación,
   sin ninguna sincronización todavía. Este módulo es completamente
   independiente de storage.js: nunca lee ni escribe la clave
   "gymNutritionTracker" ni la tabla datos_usuario. Solo maneja la sesión
   de Supabase, guardada bajo su propia clave separada. */
var GYMAPP = window.GYMAPP || (window.GYMAPP = {});

GYMAPP.auth = (function () {
  /* Completá estos dos valores con los de tu proyecto Supabase
     (Settings -> API). SUPABASE_ANON_KEY es la clave pública "anon",
     nunca la "service_role". Si los dejás sin completar, la sección de
     cuenta se muestra deshabilitada y el resto de la app sigue
     funcionando con normalidad. */
  var SUPABASE_URL = "https://gegzdzpqzbmjldapsesg.supabase.co";
  var SUPABASE_ANON_KEY = "sb_publishable_G-Foy8Nommnzr0GZlBVMFQ_ewyL_Cev";

  /* Clave de localStorage separada de "gymNutritionTracker": la sesión de
     Supabase (tokens de acceso/refresco) se guarda acá, nunca junto a los
     datos de la app. La contraseña en sí NUNCA se guarda en ningún lado:
     vive solo en el input del formulario mientras se envía la request. */
  var STORAGE_KEY_AUTH = "gymNutritionTracker_supabaseAuth";

  var LARGO_MINIMO_PASSWORD = 6;

  /* AUTH-04: única URL a la que puede volver el login con Google (la app
     publicada en GitHub Pages). Nunca se toma de la URL actual ni de
     parámetros: así no hay open redirect posible. Tiene que estar en
     Supabase -> Authentication -> URL Configuration -> Redirect URLs. */
  var URL_APP = "https://gym-nutrition-tracker.github.io/";

  /* AUTH-04: la sesión de Supabase se guarda bajo STORAGE_KEY_AUTH igual
     que antes, pero sin provider_token ni provider_refresh_token (los
     tokens de Google que Supabase incluye en la sesión OAuth). La app no
     los usa y no deben quedar persistidos. Cualquier otro valor (por
     ejemplo, el code verifier) pasa tal cual. */
  function sinTokensProveedor(valor) {
    var obj;
    try {
      obj = JSON.parse(valor);
    } catch (e) {
      return valor;
    }
    if (!obj || typeof obj !== "object") return valor;
    if (!("provider_token" in obj) && !("provider_refresh_token" in obj)) return valor;
    delete obj.provider_token;
    delete obj.provider_refresh_token;
    return JSON.stringify(obj);
  }

  var almacenamientoSesion = {
    getItem: function (clave) { return window.localStorage.getItem(clave); },
    setItem: function (clave, valor) { window.localStorage.setItem(clave, sinTokensProveedor(valor)); },
    removeItem: function (clave) { window.localStorage.removeItem(clave); }
  };

  var cliente = null;
  var clienteFalló = false;
  var sesionActual = null;
  var listeners = [];

  /* Estado efímero de la UI de login (no se persiste en ningún lado, y
     nunca incluye la contraseña). modo: "iniciar-sesion" | "crear-cuenta" |
     "recuperar-password". */
  var estadoCuenta = { modo: "iniciar-sesion", email: "", cargando: false };

  /* AUTH-03: true exclusivamente mientras la sesión activa proviene de un
     enlace de recuperación de contraseña (evento PASSWORD_RECOVERY). Mientras
     esté en true, renderSeccionCuenta() muestra únicamente el formulario de
     nueva contraseña, nunca el login normal ni la vista de "Conectado como".
     Nunca se persiste: es puramente en memoria, igual que estadoCuenta. */
  var enRecuperacion = false;
  var estadoNuevaPassword = { cargando: false };

  function configurado() {
    return (
      SUPABASE_URL.indexOf("TU_SUPABASE_URL_AQUI") === -1 &&
      SUPABASE_ANON_KEY.indexOf("TU_SUPABASE_ANON_KEY_AQUI") === -1 &&
      SUPABASE_URL.length > 0 &&
      SUPABASE_ANON_KEY.length > 0
    );
  }

  function obtenerCliente() {
    if (cliente || clienteFalló) return cliente;
    if (!configurado() || !window.supabase || typeof window.supabase.createClient !== "function") {
      clienteFalló = true;
      return null;
    }
    try {
      cliente = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: {
          storageKey: STORAGE_KEY_AUTH,
          storage: almacenamientoSesion,
          persistSession: true,
          autoRefreshToken: true,
          /* El login normal sigue siendo exclusivamente por email +
             contraseña (signUp / signInWithPassword): esto NO agrega magic
             link ni OTP como forma de iniciar sesión. detectSessionInUrl
             tiene que estar en true igual, porque es el mecanismo genérico
             con el que el SDK de Supabase procesa CUALQUIER enlace de
             redirección que la propia app haya generado, y AUTH-03 agrega
             uno: el enlace de recuperación de contraseña (generado acá mismo
             por resetPasswordForEmail). Con este valor en false, al volver
             de ese enlace el SDK nunca leía los parámetros de la URL, nunca
             armaba la sesión de recuperación y por eso el evento
             PASSWORD_RECOVERY jamás se disparaba. AUTH-04 usa el mismo
             mecanismo para la vuelta del login con Google
             (signInWithOAuth), que también regresa a URL_APP con la sesión
             en la URL. */
          detectSessionInUrl: true
        }
      });
      cliente.auth.onAuthStateChange(function (_evento, sesion) {
        sesionActual = sesion;
        if (_evento === "PASSWORD_RECOVERY") {
          /* La sesión que llega acá es real y válida (Supabase la crea a
             partir del enlace de recuperación), pero mientras estemos en
             este estado no se debe mostrar el login normal ni "Conectado
             como...": solo el formulario de nueva contraseña. */
          enRecuperacion = true;
        }
        notificarCambio();
      });
    } catch (e) {
      console.error("No se pudo inicializar el cliente de Supabase", e);
      clienteFalló = true;
      cliente = null;
    }
    return cliente;
  }

  /* Se llama al arrancar la app. Nunca bloquea ni retrasa el render
     principal: si Supabase no está configurado o falla la red, la sesión
     simplemente queda en null y la app sigue funcionando sin login. Como
     persistSession guarda la sesión bajo STORAGE_KEY_AUTH, esto es lo que
     recupera el login al cerrar y volver a abrir la PWA. */
  /* AUTH-04: devuelve una promesa con la sesión recuperada (o null); nunca
     se rechaza. app.js la usa para decidir si mostrar la pantalla de
     acceso. Al volver de Google, getSession espera a que el SDK lea la
     sesión de la URL (detectSessionInUrl). */
  function inicializar() {
    var c = obtenerCliente();
    if (!c) return Promise.resolve(null);
    return c.auth
      .getSession()
      .then(function (resultado) {
        sesionActual = resultado && resultado.data ? resultado.data.session : null;
        notificarCambio();
        return sesionActual;
      })
      .catch(function (e) {
        console.error("No se pudo recuperar la sesión de Supabase", e);
        return null;
      });
  }

  /* true si hay cliente de Supabase (configurado y SDK cargado). */
  function disponible() {
    return !!obtenerCliente();
  }

  /* AUTH-04: redirectTo del login con Google. Siempre la URL publicada de
     la app, nunca derivada de la URL actual. */
  function obtenerRedirectOAuth() {
    return URL_APP;
  }

  /* Abre el login de Google (Supabase redirige el navegador). Sin scopes
     extra: Supabase pide solo los básicos (email y perfil). prompt
     select_account deja elegir la cuenta de Google en cada intento. */
  function iniciarSesionGoogle() {
    var c = obtenerCliente();
    if (!c) return Promise.reject(new Error("Supabase no está configurado."));
    return c.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: obtenerRedirectOAuth(),
        queryParams: { prompt: "select_account" }
      }
    });
  }

  /* true si la URL trae el error con el que Supabase vuelve de un login
     OAuth fallido o cancelado (?error=... o #error=...). */
  function hayErrorOAuthEnUrl(ubicacion) {
    var u = ubicacion || window.location;
    var partes = [String(u.search || "").replace(/^\?/, ""), String(u.hash || "").replace(/^#/, "")];
    return partes.some(function (p) {
      return p.split("&").some(function (par) {
        var clave = par.split("=")[0];
        return clave === "error" || clave === "error_description";
      });
    });
  }

  function obtenerSesion() {
    return sesionActual;
  }

  function suscribirCambiosSesion(fn) {
    listeners.push(fn);
  }

  function notificarCambio() {
    listeners.forEach(function (fn) {
      try {
        fn(sesionActual);
      } catch (e) {
        console.error("Error en listener de cambio de sesión", e);
      }
    });
  }

  /* Crea la cuenta con email + contraseña. Con "Confirm Email" apagado en
     Supabase, esto ya deja la sesión iniciada (onAuthStateChange dispara
     solo). Si el email ya tenía una cuenta, Supabase puede responder sin
     error y sin sesión nueva (para no revelar si el email existe): eso se
     maneja en manejarCrearCuenta, no acá. */
  function crearCuenta(email, password) {
    var c = obtenerCliente();
    if (!c) return Promise.reject(new Error("Supabase no está configurado."));
    return c.auth.signUp({ email: email, password: password });
  }

  function iniciarSesion(email, password) {
    var c = obtenerCliente();
    if (!c) return Promise.reject(new Error("Supabase no está configurado."));
    return c.auth.signInWithPassword({ email: email, password: password });
  }

  function cerrarSesion() {
    var c = obtenerCliente();
    if (!c) return Promise.resolve();
    return c.auth.signOut();
  }

  /* URL pública de la app (GitHub Pages), a la que Supabase redirige después
     de que el usuario hace click en el enlace de recuperación del mail. Tiene
     que estar dada de alta en Supabase (Authentication -> URL Configuration
     -> Redirect URLs); nunca puede ser localhost. */
  var URL_REDIRECT_RECUPERACION = "https://gym-nutrition-tracker.github.io/";

  /* Pide el mail de recuperación. No revela si el email existe o no más allá
     de lo que Supabase mismo devuelva: siempre se trata como éxito salvo un
     error explícito de la API (por ejemplo, problema de red). */
  function solicitarRecuperacionPassword(email) {
    var c = obtenerCliente();
    if (!c) return Promise.reject(new Error("Supabase no está configurado."));
    return c.auth.resetPasswordForEmail(email, { redirectTo: URL_REDIRECT_RECUPERACION });
  }

  /* Actualiza la contraseña de la sesión de recuperación activa. La nueva
     contraseña vive solo en el input y en este parámetro de la request: no
     se guarda ni se loguea en ningún lado. */
  function actualizarPassword(nuevaPassword) {
    var c = obtenerCliente();
    if (!c) return Promise.reject(new Error("Supabase no está configurado."));
    return c.auth.updateUser({ password: nuevaPassword });
  }

  /* --- UI: sección discreta de cuenta, embebida en la pantalla de Rutina --- */

  var REGEX_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  /* escapeHtml no escapa comillas (usa innerHTML); dentro de un atributo
     value="..." hace falta, o un email con " se saldría del atributo. */
  function escaparAtributo(v) {
    return GYMAPP.util.escapeHtml(v).replace(/"/g, "&quot;");
  }

  function renderSeccionCuenta() {
    if (!configurado()) {
      return (
        '<div class="seccion-cuenta">' +
        "<h3>Cuenta</h3>" +
        '<p class="nota">La sincronización en la nube todavía no está configurada en esta app.</p>' +
        "</div>"
      );
    }

    /* Prioridad máxima: mientras estemos en recuperación de contraseña no se
       muestra ni el login normal ni "Conectado como...", solo este formulario. */
    if (enRecuperacion) return renderSeccionNuevaPassword();

    var email = sesionActual && sesionActual.user ? sesionActual.user.email : null;
    if (email) return renderSeccionConectado(email);
    return renderSeccionFormulario();
  }

  function renderSeccionConectado(email) {
    return (
      '<div class="seccion-cuenta">' +
      "<h3>Cuenta</h3>" +
      '<div id="cuenta-mensaje" class="mensaje oculto"></div>' +
      /* PROFILE-01: foto de perfil opcional (js/perfilFoto.js). */
      (GYMAPP.perfilFoto ? GYMAPP.perfilFoto.renderBloqueCuenta(sesionActual, null) : "") +
      '<p class="nota">Conectado como ' + GYMAPP.util.escapeHtml(email) + "</p>" +
      '<button type="button" data-accion="cerrar-sesion-cuenta" class="btn btn-secundario btn-ancho">Cerrar sesión</button>' +
      "</div>"
    );
  }

  function renderSeccionFormulario() {
    if (estadoCuenta.modo === "recuperar-password") return renderSeccionRecuperarPassword();

    var esCrearCuenta = estadoCuenta.modo === "crear-cuenta";
    return (
      '<div class="seccion-cuenta">' +
      "<h3>Cuenta</h3>" +
      '<div id="cuenta-mensaje" class="mensaje oculto"></div>' +
      '<div class="selector-tipo cuenta-modo-selector">' +
      '<button type="button" data-accion="modo-iniciar-sesion" class="btn-tipo' + (!esCrearCuenta ? " activo" : "") + '">Iniciar sesión</button>' +
      '<button type="button" data-accion="modo-crear-cuenta" class="btn-tipo' + (esCrearCuenta ? " activo" : "") + '">Crear cuenta</button>' +
      "</div>" +
      '<p class="nota">' +
      (esCrearCuenta
        ? "Creá una cuenta con email y contraseña. Más adelante esto va a permitir sincronizar tus datos entre dispositivos."
        : "Iniciá sesión con tu email y contraseña.") +
      "</p>" +
      '<div class="campo">' +
      '<label for="input-email-cuenta">Email</label>' +
      '<input type="email" id="input-email-cuenta" placeholder="tu@email.com" value="' +
      escaparAtributo(estadoCuenta.email) +
      '" autocomplete="email" />' +
      "</div>" +
      '<div class="campo">' +
      '<label for="input-password-cuenta">Contraseña</label>' +
      '<input type="password" id="input-password-cuenta" placeholder="••••••••" autocomplete="' +
      (esCrearCuenta ? "new-password" : "current-password") +
      '" />' +
      "</div>" +
      (esCrearCuenta
        ? '<div class="campo">' +
          '<label for="input-password-confirmar-cuenta">Repetir contraseña</label>' +
          '<input type="password" id="input-password-confirmar-cuenta" placeholder="••••••••" autocomplete="new-password" />' +
          "</div>"
        : "") +
      '<button type="button" data-accion="' +
      (esCrearCuenta ? "crear-cuenta" : "iniciar-sesion") +
      '" class="btn btn-primario btn-ancho">' +
      (esCrearCuenta ? "Crear cuenta" : "Iniciar sesión") +
      "</button>" +
      (!esCrearCuenta
        ? '<button type="button" data-accion="modo-recuperar-password" class="btn-enlace">¿Olvidaste tu contraseña?</button>'
        : "") +
      "</div>"
    );
  }

  function renderSeccionRecuperarPassword() {
    return (
      '<div class="seccion-cuenta">' +
      "<h3>Cuenta</h3>" +
      '<div id="cuenta-mensaje" class="mensaje oculto"></div>' +
      '<p class="nota">Ingresá tu email y te enviamos un enlace para recuperar tu contraseña.</p>' +
      '<div class="campo">' +
      '<label for="input-email-cuenta">Email</label>' +
      '<input type="email" id="input-email-cuenta" placeholder="tu@email.com" value="' +
      escaparAtributo(estadoCuenta.email) +
      '" autocomplete="email" />' +
      "</div>" +
      '<button type="button" data-accion="enviar-recuperacion" class="btn btn-primario btn-ancho">Enviar enlace de recuperación</button>' +
      '<button type="button" data-accion="modo-iniciar-sesion" class="btn-enlace">Volver a iniciar sesión</button>' +
      "</div>"
    );
  }

  function renderSeccionNuevaPassword() {
    return (
      '<div class="seccion-cuenta">' +
      "<h3>Cuenta</h3>" +
      '<div id="cuenta-mensaje" class="mensaje oculto"></div>' +
      '<p class="nota">Ingresá tu nueva contraseña.</p>' +
      '<div class="campo">' +
      '<label for="input-nueva-password">Nueva contraseña</label>' +
      '<input type="password" id="input-nueva-password" placeholder="••••••••" autocomplete="new-password" />' +
      "</div>" +
      '<div class="campo">' +
      '<label for="input-repetir-password">Repetir contraseña</label>' +
      '<input type="password" id="input-repetir-password" placeholder="••••••••" autocomplete="new-password" />' +
      "</div>" +
      '<button type="button" data-accion="actualizar-password" class="btn btn-primario btn-ancho"' +
      (estadoNuevaPassword.cargando ? " disabled" : "") + ">" +
      (estadoNuevaPassword.cargando ? "Guardando..." : "Cambiar contraseña") +
      "</button>" +
      "</div>"
    );
  }

  /* --- AUTH-04: pantalla inicial de acceso (antes del shell) ---
     Reutiliza los mismos ids y handlers del formulario de Cuenta
     (bindEventosCuenta), así login, registro y recuperación son los mismos
     flujos. Google arriba, email/contraseña en el medio y "Seguir sin
     cuenta" como acción secundaria (la maneja app.js). */

  var LOGO_GOOGLE =
    '<svg class="google-logo" viewBox="0 0 48 48" width="18" height="18" aria-hidden="true" focusable="false">' +
    '<path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>' +
    '<path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>' +
    '<path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>' +
    '<path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>' +
    "</svg>";

  var estadoGoogle = { cargando: false };

  function renderBotonGoogle() {
    return (
      '<button type="button" data-accion="acceso-google" class="btn btn-google btn-ancho"' + (estadoGoogle.cargando ? " disabled" : "") + ">" +
      LOGO_GOOGLE + "<span>" + (estadoGoogle.cargando ? "Abriendo Google…" : "Continuar con Google") + "</span></button>"
    );
  }

  function renderPantallaAcceso() {
    var esc = GYMAPP.util.escapeHtml;
    var modo = estadoCuenta.modo;
    var cuerpo;
    if (modo === "recuperar-password") {
      cuerpo =
        "<h2>Recuperar contraseña</h2>" +
        '<div id="cuenta-mensaje" class="mensaje oculto" role="status"></div>' +
        '<p class="nota">Ingresá tu email y te enviamos un enlace para recuperar tu contraseña.</p>' +
        '<div class="campo"><label for="input-email-cuenta">Email</label>' +
        '<input type="email" id="input-email-cuenta" placeholder="tu@email.com" value="' + escaparAtributo(estadoCuenta.email) + '" autocomplete="email" /></div>' +
        '<button type="button" data-accion="enviar-recuperacion" class="btn btn-primario btn-ancho">Enviar enlace de recuperación</button>' +
        '<button type="button" data-accion="modo-iniciar-sesion" class="btn-enlace">Volver a iniciar sesión</button>';
    } else {
      var crear = modo === "crear-cuenta";
      cuerpo =
        "<h2>Bienvenido</h2>" +
        '<p class="nota acceso-subtitulo">Guardá y sincronizá tu progreso entre dispositivos.</p>' +
        '<div id="cuenta-mensaje" class="mensaje oculto" role="status"></div>' +
        renderBotonGoogle() +
        '<div class="acceso-separador" role="separator"><span>o</span></div>' +
        '<div class="campo"><label for="input-email-cuenta">Email</label>' +
        '<input type="email" id="input-email-cuenta" placeholder="tu@email.com" value="' + escaparAtributo(estadoCuenta.email) + '" autocomplete="email" /></div>' +
        '<div class="campo"><label for="input-password-cuenta">Contraseña</label>' +
        '<input type="password" id="input-password-cuenta" placeholder="••••••••" autocomplete="' + (crear ? "new-password" : "current-password") + '" /></div>' +
        (crear
          ? '<div class="campo"><label for="input-password-confirmar-cuenta">Repetir contraseña</label>' +
            '<input type="password" id="input-password-confirmar-cuenta" placeholder="••••••••" autocomplete="new-password" /></div>' +
            '<button type="button" data-accion="crear-cuenta" class="btn btn-primario btn-ancho">Crear cuenta</button>' +
            '<p class="acceso-enlaces">¿Ya tenés cuenta? <button type="button" data-accion="modo-iniciar-sesion" class="btn-enlace">Iniciar sesión</button></p>'
          : '<button type="button" data-accion="iniciar-sesion" class="btn btn-primario btn-ancho">Iniciar sesión</button>' +
            '<p class="acceso-enlaces">¿No tenés cuenta? <button type="button" data-accion="modo-crear-cuenta" class="btn-enlace">Crear cuenta</button></p>' +
            '<p class="acceso-enlaces"><button type="button" data-accion="modo-recuperar-password" class="btn-enlace">¿Olvidaste tu contraseña?</button></p>');
    }
    return (
      '<div class="pantalla-acceso">' +
      '<section class="acceso-card" aria-labelledby="acceso-titulo">' +
      cuerpo.replace("<h2>", '<h2 id="acceso-titulo">') +
      "</section>" +
      '<div class="acceso-local">' +
      '<button type="button" data-accion="acceso-sin-cuenta" class="btn-enlace acceso-sin-cuenta">Seguir sin cuenta</button>' +
      '<p class="nota">Podés iniciar sesión más adelante para sincronizar tus datos.</p>' +
      "</div>" +
      "</div>"
    );
  }

  var MENSAJE_ERROR_GOOGLE = "No pudimos iniciar sesión con Google.";

  function restaurarBotonGoogle(boton) {
    estadoGoogle.cargando = false;
    if (!boton) return;
    boton.disabled = false;
    var texto = boton.querySelector("span");
    if (texto) texto.textContent = "Continuar con Google";
  }

  function manejarGoogle(container, boton) {
    if (estadoGoogle.cargando) return;
    if (window.navigator && window.navigator.onLine === false) {
      mostrarMensajeCuenta(container, "No hay conexión a internet. Podés seguir sin cuenta y sincronizar más adelante.", "error");
      return;
    }
    estadoGoogle.cargando = true;
    boton.disabled = true;
    var texto = boton.querySelector("span");
    /* El estado se muestra en el propio botón: un mensaje arriba lo
       desplazaría justo cuando se está tocando. */
    if (texto) texto.textContent = "Abriendo Google…";
    var promesa;
    try {
      promesa = iniciarSesionGoogle();
    } catch (e) {
      promesa = Promise.reject(e);
    }
    promesa
      .then(function (resultado) {
        /* Sin error el SDK ya está redirigiendo a Google: el botón queda
           bloqueado hasta que la página cambie. */
        if (resultado && resultado.error) {
          restaurarBotonGoogle(boton);
          mostrarMensajeCuenta(container, MENSAJE_ERROR_GOOGLE, "error");
        }
      })
      .catch(function (e) {
        console.error("No se pudo iniciar el login con Google", e);
        restaurarBotonGoogle(boton);
        mostrarMensajeCuenta(container, MENSAJE_ERROR_GOOGLE, "error");
      });
  }

  /* Si el navegador vuelve a esta página desde la caché (botón Atrás
     desde Google), el botón no debe quedar bloqueado. */
  window.addEventListener && window.addEventListener("pageshow", function (ev) {
    if (!ev.persisted || !estadoGoogle.cargando) return;
    restaurarBotonGoogle(document.querySelector('[data-accion="acceso-google"]'));
  });

  function mostrarMensajeCuenta(container, texto, tipo) {
    var el = container.querySelector("#cuenta-mensaje");
    if (!el) return;
    el.textContent = texto;
    el.className = "mensaje " + (tipo || "info");
  }

  /* Registra los eventos de click de la sección de cuenta. Se debe llamar
     una única vez por contenedor (el módulo que embebe esta sección ya
     garantiza esto con su propio guard de bindEventos). `alCambiarEstado`
     se invoca al cambiar entre "Iniciar sesión"/"Crear cuenta" (estado
     puramente local, no dispara onAuthStateChange); los cambios de sesión
     en sí (login/logout exitosos) ya llegan por suscribirCambiosSesion. */
  function bindEventosCuenta(container, alCambiarEstado) {
    container.addEventListener("click", function (ev) {
      var boton = ev.target.closest(
        '[data-accion="modo-iniciar-sesion"], [data-accion="modo-crear-cuenta"], ' +
        '[data-accion="modo-recuperar-password"], [data-accion="enviar-recuperacion"], ' +
        '[data-accion="actualizar-password"], ' +
        '[data-accion="iniciar-sesion"], [data-accion="crear-cuenta"], ' +
        '[data-accion="cerrar-sesion-cuenta"], [data-accion="acceso-google"]'
      );
      if (!boton) return;
      var accion = boton.dataset.accion;

      if (accion === "modo-iniciar-sesion") {
        estadoCuenta.modo = "iniciar-sesion";
        if (alCambiarEstado) alCambiarEstado();
      } else if (accion === "modo-crear-cuenta") {
        estadoCuenta.modo = "crear-cuenta";
        if (alCambiarEstado) alCambiarEstado();
      } else if (accion === "modo-recuperar-password") {
        estadoCuenta.modo = "recuperar-password";
        if (alCambiarEstado) alCambiarEstado();
      } else if (accion === "enviar-recuperacion") {
        manejarSolicitarRecuperacion(container, boton);
      } else if (accion === "actualizar-password") {
        manejarActualizarPassword(container, boton, alCambiarEstado);
      } else if (accion === "iniciar-sesion") {
        manejarIniciarSesion(container, boton);
      } else if (accion === "crear-cuenta") {
        manejarCrearCuenta(container, boton);
      } else if (accion === "cerrar-sesion-cuenta") {
        manejarCerrarSesion(container, boton, alCambiarEstado);
      } else if (accion === "acceso-google") {
        manejarGoogle(container, boton);
      }
    });
  }

  function leerEmailPassword(container) {
    var inputEmail = container.querySelector("#input-email-cuenta");
    var inputPassword = container.querySelector("#input-password-cuenta");
    return {
      email: inputEmail ? inputEmail.value.trim() : "",
      password: inputPassword ? inputPassword.value : ""
    };
  }

  function manejarIniciarSesion(container, boton) {
    if (estadoCuenta.cargando) return;
    var datos = leerEmailPassword(container);

    if (!REGEX_EMAIL.test(datos.email)) {
      mostrarMensajeCuenta(container, "Ingresá un email válido.", "error");
      return;
    }
    if (!datos.password) {
      mostrarMensajeCuenta(container, "Ingresá tu contraseña.", "error");
      return;
    }

    estadoCuenta.email = datos.email;
    estadoCuenta.cargando = true;
    boton.disabled = true;
    mostrarMensajeCuenta(container, "Iniciando sesión...", "info");

    iniciarSesion(datos.email, datos.password)
      .then(function (resultado) {
        estadoCuenta.cargando = false;
        boton.disabled = false;
        if (resultado && resultado.error) {
          mostrarMensajeCuenta(container, "No se pudo iniciar sesión: " + resultado.error.message, "error");
          return;
        }
        /* Éxito: onAuthStateChange dispara solo y el módulo que embebe
           esta sección (suscribirCambiosSesion) ya vuelve a renderizar
           mostrando "Conectado como...". */
      })
      .catch(function (e) {
        estadoCuenta.cargando = false;
        boton.disabled = false;
        console.error("Error de red al iniciar sesión", e);
        mostrarMensajeCuenta(container, "Ocurrió un error de red al iniciar sesión. Probá de nuevo.", "error");
      });
  }

  function manejarCrearCuenta(container, boton) {
    if (estadoCuenta.cargando) return;
    var datos = leerEmailPassword(container);
    var inputConfirmar = container.querySelector("#input-password-confirmar-cuenta");
    var passwordConfirmar = inputConfirmar ? inputConfirmar.value : "";

    if (!REGEX_EMAIL.test(datos.email)) {
      mostrarMensajeCuenta(container, "Ingresá un email válido.", "error");
      return;
    }
    if (datos.password.length < LARGO_MINIMO_PASSWORD) {
      mostrarMensajeCuenta(container, "La contraseña debe tener al menos " + LARGO_MINIMO_PASSWORD + " caracteres.", "error");
      return;
    }
    if (datos.password !== passwordConfirmar) {
      mostrarMensajeCuenta(container, "Las contraseñas no coinciden.", "error");
      return;
    }

    estadoCuenta.email = datos.email;
    estadoCuenta.cargando = true;
    boton.disabled = true;
    mostrarMensajeCuenta(container, "Creando tu cuenta...", "info");

    crearCuenta(datos.email, datos.password)
      .then(function (resultado) {
        estadoCuenta.cargando = false;
        boton.disabled = false;
        if (resultado && resultado.error) {
          mostrarMensajeCuenta(container, "No se pudo crear la cuenta: " + resultado.error.message, "error");
          return;
        }
        var haySesion = resultado && resultado.data && resultado.data.session;
        if (haySesion) {
          /* onAuthStateChange dispara solo y muestra "Conectado como...". */
          return;
        }
        /* Con "Confirm Email" apagado esto no debería pasar salvo que el
           email ya tuviera una cuenta (Supabase responde sin error y sin
           sesión nueva, para no revelar si el email existe). */
        mostrarMensajeCuenta(container, "Revisá el email ingresado: si ya tenías una cuenta, iniciá sesión en su lugar.", "info");
      })
      .catch(function (e) {
        estadoCuenta.cargando = false;
        boton.disabled = false;
        console.error("Error de red al crear la cuenta", e);
        mostrarMensajeCuenta(container, "Ocurrió un error de red al crear la cuenta. Probá de nuevo.", "error");
      });
  }

  function manejarSolicitarRecuperacion(container, boton) {
    if (estadoCuenta.cargando) return;
    var inputEmail = container.querySelector("#input-email-cuenta");
    var email = inputEmail ? inputEmail.value.trim() : "";

    if (!REGEX_EMAIL.test(email)) {
      mostrarMensajeCuenta(container, "Ingresá un email válido.", "error");
      return;
    }

    estadoCuenta.email = email;
    estadoCuenta.cargando = true;
    boton.disabled = true;
    mostrarMensajeCuenta(container, "Enviando...", "info");

    solicitarRecuperacionPassword(email)
      .then(function (resultado) {
        estadoCuenta.cargando = false;
        boton.disabled = false;
        if (resultado && resultado.error) {
          mostrarMensajeCuenta(container, "No se pudo enviar el enlace: " + resultado.error.message, "error");
          return;
        }
        /* No se revela si el email existe o no más allá de lo que haya
           devuelto Supabase: siempre se muestra el mismo mensaje de éxito. */
        mostrarMensajeCuenta(container, "Te enviamos un enlace para recuperar tu contraseña.", "exito");
      })
      .catch(function (e) {
        estadoCuenta.cargando = false;
        boton.disabled = false;
        console.error("Error de red al solicitar recuperación de contraseña", e);
        mostrarMensajeCuenta(container, "Ocurrió un error de red. Probá de nuevo.", "error");
      });
  }

  function manejarActualizarPassword(container, boton, alCambiarEstado) {
    if (estadoNuevaPassword.cargando) return;
    var inputNueva = container.querySelector("#input-nueva-password");
    var inputRepetir = container.querySelector("#input-repetir-password");
    var nuevaPassword = inputNueva ? inputNueva.value : "";
    var repetirPassword = inputRepetir ? inputRepetir.value : "";

    if (nuevaPassword.length < LARGO_MINIMO_PASSWORD) {
      mostrarMensajeCuenta(container, "La contraseña debe tener al menos " + LARGO_MINIMO_PASSWORD + " caracteres.", "error");
      return;
    }
    if (nuevaPassword !== repetirPassword) {
      mostrarMensajeCuenta(container, "Las contraseñas no coinciden.", "error");
      return;
    }

    estadoNuevaPassword.cargando = true;
    boton.disabled = true;
    boton.textContent = "Guardando...";
    mostrarMensajeCuenta(container, "Actualizando contraseña...", "info");

    actualizarPassword(nuevaPassword)
      .then(function (resultado) {
        estadoNuevaPassword.cargando = false;
        if (resultado && resultado.error) {
          boton.disabled = false;
          boton.textContent = "Cambiar contraseña";
          mostrarMensajeCuenta(container, "No se pudo actualizar la contraseña: " + resultado.error.message, "error");
          return;
        }
        /* Éxito: se sale del estado de recuperación y se vuelve a la vista
           normal de Cuenta, ya autenticada (updateUser no cierra la sesión).
           Se reemplaza el contenido acá mismo (en vez de depender de un
           re-render completo vía alCambiarEstado) para poder mostrar el
           mensaje de éxito ya en la vista de "Conectado como...". */
        enRecuperacion = false;
        estadoCuenta.modo = "iniciar-sesion";
        var email = sesionActual && sesionActual.user ? sesionActual.user.email : "";
        var seccionCuenta = container.querySelector(".seccion-cuenta");
        if (seccionCuenta) seccionCuenta.outerHTML = renderSeccionConectado(email);
        mostrarMensajeCuenta(container, "Contraseña actualizada correctamente", "exito");
      })
      .catch(function (e) {
        estadoNuevaPassword.cargando = false;
        boton.disabled = false;
        boton.textContent = "Cambiar contraseña";
        console.error("Error de red al actualizar la contraseña", e);
        mostrarMensajeCuenta(container, "Ocurrió un error de red al actualizar la contraseña. Probá de nuevo.", "error");
      });
  }

  function manejarCerrarSesion(container, boton, alCambiarEstado) {
    boton.disabled = true;
    cerrarSesion()
      .then(function () {
        estadoCuenta.modo = "iniciar-sesion";
        estadoCuenta.email = "";
        if (alCambiarEstado) alCambiarEstado();
      })
      .catch(function (e) {
        boton.disabled = false;
        console.error("Error al cerrar sesión", e);
        mostrarMensajeCuenta(container, "Ocurrió un error de red al cerrar sesión. Probá de nuevo.", "error");
      });
  }

  return {
    inicializar: inicializar,
    disponible: disponible,
    obtenerRedirectOAuth: obtenerRedirectOAuth,
    iniciarSesionGoogle: iniciarSesionGoogle,
    hayErrorOAuthEnUrl: hayErrorOAuthEnUrl,
    renderPantallaAcceso: renderPantallaAcceso,
    mostrarMensajeAcceso: mostrarMensajeCuenta,
    /* Expuesto para tests. */
    sinTokensProveedor: sinTokensProveedor,
    /* Expuesto para SYNC-01 (js/sync.js): reutiliza el mismo cliente/sesión
       de Supabase que ya administra este módulo (auth.js sigue siendo el
       único dueño de su ciclo de vida), en vez de que sync.js cree un
       cliente propio y duplique el manejo de sesión. */
    obtenerCliente: obtenerCliente,
    obtenerSesion: obtenerSesion,
    suscribirCambiosSesion: suscribirCambiosSesion,
    crearCuenta: crearCuenta,
    iniciarSesion: iniciarSesion,
    cerrarSesion: cerrarSesion,
    renderSeccionCuenta: renderSeccionCuenta,
    bindEventosCuenta: bindEventosCuenta
  };
})();
