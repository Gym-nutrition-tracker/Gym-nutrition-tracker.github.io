/* Punto de entrada: pantalla de acceso (AUTH-04), onboarding de perfil o
   la app principal, y arma el shell con bottom nav.

   Arranque:
     bloqueo de migración          → aviso y nada más
     acceso sin resolver           → "Cargando…" mientras Supabase recupera
                                     la sesión; con sesión válida se sigue,
                                     sin sesión se muestra la pantalla de
                                     acceso (Google, email o "Seguir sin
                                     cuenta")
     sin perfil local, con sesión  → si la cuenta tiene copia en la nube
                                     (consulta SOLO LECTURA): "Encontramos
                                     tus datos" (recuperar / empezar de
                                     cero); si no, onboarding de perfil
     sin perfil local, sin sesión  → onboarding de perfil
     con perfil                    → shell (y ONB-03 si corresponde)
   La cuenta nunca es obligatoria: sin Supabase disponible se entra directo
   en modo local, como antes. */
var GYMAPP = window.GYMAPP || (window.GYMAPP = {});

GYMAPP.app = (function () {
  var TABS = [
    { id: "dashboard", label: "Dashboard", icono: "🏠" },
    { id: "entrenar", label: "Entrenar", icono: "🏋️" },
    { id: "progreso", label: "Progreso", icono: "📈" },
    { id: "nutricion", label: "Nutrición", icono: "🍽️" }
  ];

  var tabActual = "dashboard";

  /* AUTH-04: estado del arranque, solo en memoria (nada se persiste).
     vista: "cargando" | "acceso" | "buscando-nube" | "recuperar" |
     "perfil" | "app". */
  var accesoResuelto = false;
  var vista = null;
  var habiaSesion = false;
  var escuchandoSesion = false;
  var errorOAuthMostrado = false;
  /* "Empezar de cero" en la pantalla de recuperación: no volver a
     ofrecerla en esta carga (solo memoria; la nube no se toca). */
  var omitirRecuperacion = false;
  /* Si Supabase no responde (por ejemplo, sin red con un token vencido),
     no se espera más que esto para mostrar el acceso. */
  var ESPERA_MAXIMA_SESION_MS = 4000;

  function root() {
    return document.getElementById("app-root");
  }

  function iniciar() {
    var data = GYMAPP.storage.getData();
    /* E2: si la migración de formato no se pudo completar, no se arranca
       con datos parciales: se muestra el aviso y nada más (save() también
       queda bloqueado). Los datos guardados no se modificaron. */
    var bloqueo = GYMAPP.storage.obtenerBloqueoMigracion();
    if (bloqueo) {
      root().innerHTML =
        '<div class="pantalla">' +
        "<h2>No se pudieron cargar tus datos</h2>" +
        '<div class="mensaje error">' + GYMAPP.util.escapeHtml(bloqueo.mensaje) + "</div>" +
        '<p class="nota">No se modificó nada. Recargá la app para volver a intentarlo. Si el problema sigue, no borres los datos del navegador.</p>' +
        "</div>";
      return;
    }
    if (!accesoResuelto) {
      arrancarAcceso();
      return;
    }
    continuar();
  }

  function continuar() {
    var data = GYMAPP.storage.getData();
    if (!data.usuario) {
      if (debeBuscarCopiaNube(data)) {
        buscarCopiaNube();
        return;
      }
      mostrarPerfil();
      return;
    }
    vista = "app";
    renderShell(data);
  }

  function mostrarPerfil() {
    vista = "perfil";
    GYMAPP.onboarding.render(root());
  }

  /* Solo con sesión (nunca en "Seguir sin cuenta") y sin datos locales
     útiles: ahí se consulta si la cuenta ya tiene una copia en la nube. */
  function debeBuscarCopiaNube(data) {
    var R = GYMAPP.recuperacionInicial;
    return !omitirRecuperacion && !!R && !!GYMAPP.sync && !!GYMAPP.auth &&
      tieneUsuario(GYMAPP.auth.obtenerSesion()) && !R.hayDatosLocalesUtiles(data);
  }

  /* Consulta de solo lectura; ninguna escritura en la nube hasta que el
     usuario decida (y aun así, recuperar solo escribe en este dispositivo). */
  function buscarCopiaNube() {
    vista = "buscando-nube";
    root().innerHTML = '<div class="pantalla pantalla-cargando" role="status"><p class="nota">Buscando tus datos…</p></div>';
    GYMAPP.recuperacionInicial.consultar().then(function (estado) {
      if (vista !== "buscando-nube") return;
      if (estado.estado === "sin_datos") mostrarPerfil();
      else mostrarRecuperacion(estado);
    });
  }

  function mostrarRecuperacion(estado) {
    var R = GYMAPP.recuperacionInicial;
    vista = "recuperar";
    var opciones = {};
    root().innerHTML = '<div id="recuperacion"></div>';
    var cont = document.getElementById("recuperacion");
    var pintar = function () { cont.innerHTML = R.render(estado, opciones); };
    pintar();
    cont.addEventListener("click", function (ev) {
      var boton = ev.target.closest("[data-accion]");
      if (!boton || boton.disabled || vista !== "recuperar") return;
      var accion = boton.dataset.accion;
      if (accion === "recuperacion-recuperar") {
        opciones = { cargando: true };
        pintar();
        var sesion = GYMAPP.auth.obtenerSesion();
        R.recuperar(sesion && sesion.user ? sesion.user.id : null).then(function (r) {
          if (vista !== "recuperar") return;
          if (r.ok) {
            omitirRecuperacion = true;
            continuar();
            return;
          }
          opciones = { mensaje: r.mensaje };
          pintar();
        });
      } else if (accion === "recuperacion-cero") {
        opciones = { confirmarCero: true };
        pintar();
      } else if (accion === "recuperacion-volver") {
        opciones = {};
        pintar();
      } else if (accion === "recuperacion-continuar-cero") {
        omitirRecuperacion = true;
        mostrarPerfil();
      } else if (accion === "recuperacion-reintentar") {
        buscarCopiaNube();
      }
    });
  }

  function tieneUsuario(sesion) {
    return !!(sesion && sesion.user);
  }

  function arrancarAcceso() {
    var auth = GYMAPP.auth;
    if (!auth || !auth.disponible()) {
      accesoResuelto = true;
      continuar();
      return;
    }
    vista = "cargando";
    root().innerHTML = '<div class="pantalla pantalla-cargando" role="status"><p class="nota">Cargando…</p></div>';
    if (!escuchandoSesion) {
      escuchandoSesion = true;
      auth.suscribirCambiosSesion(alCambiarSesion);
    }
    var decidido = false;
    var decidir = function (sesion) {
      if (decidido || vista !== "cargando") return;
      decidido = true;
      if (tieneUsuario(sesion)) entrar();
      else mostrarAcceso();
    };
    auth.inicializar().then(decidir);
    setTimeout(function () { decidir(auth.obtenerSesion()); }, ESPERA_MAXIMA_SESION_MS);
  }

  /* Login (email o Google) desde el acceso → se entra. Logout desde la app
     → vuelve al acceso. El blob local nunca se toca. */
  function alCambiarSesion(sesion) {
    var hay = tieneUsuario(sesion);
    if (vista === "acceso" && hay) {
      entrar();
    } else if ((vista === "app" || vista === "perfil" || vista === "recuperar" || vista === "buscando-nube") && habiaSesion && !hay) {
      accesoResuelto = false;
      mostrarAcceso();
    }
    habiaSesion = hay;
  }

  function entrar() {
    accesoResuelto = true;
    habiaSesion = tieneUsuario(GYMAPP.auth.obtenerSesion());
    continuar();
  }

  function seguirSinCuenta() {
    accesoResuelto = true;
    continuar();
  }

  function mostrarAcceso() {
    vista = "acceso";
    omitirRecuperacion = false;
    tabActual = "dashboard";
    if (GYMAPP.primerUso && GYMAPP.primerUso.guiaAbierta()) GYMAPP.primerUso.cerrarGuia();
    root().innerHTML = '<div id="acceso"></div>';
    var cont = document.getElementById("acceso");
    var pintar = function () { cont.innerHTML = GYMAPP.auth.renderPantallaAcceso(); };
    pintar();
    GYMAPP.auth.bindEventosCuenta(cont, pintar);
    cont.addEventListener("click", function (ev) {
      if (ev.target.closest('[data-accion="acceso-sin-cuenta"]')) seguirSinCuenta();
    });
    /* Vuelta de un login con Google cancelado o fallido: avisar una vez y
       limpiar la URL. */
    if (!errorOAuthMostrado && GYMAPP.auth.hayErrorOAuthEnUrl(window.location)) {
      errorOAuthMostrado = true;
      GYMAPP.auth.mostrarMensajeAcceso(cont, "No pudimos iniciar sesión con Google.", "error");
      if (window.history && window.history.replaceState) window.history.replaceState(null, "", window.location.pathname);
    }
  }

  function renderShell(data) {
    root().innerHTML =
      '<div class="app-shell">' +
      '<header class="app-header">' +
      "<span>Hola, " + GYMAPP.util.escapeHtml(data.usuario.nombre) + "</span>" +
      '<button id="btn-rutina" class="btn-icono" title="Rutina" aria-label="Rutina">⚙️</button>' +
      "</header>" +
      '<main id="tab-content" class="tab-content"></main>' +
      '<nav class="bottom-nav">' +
      TABS.map(renderBotonNav).join("") +
      "</nav>" +
      "</div>";

    document.getElementById("btn-rutina").addEventListener("click", function () {
      renderTab("rutina", data);
    });

    /* ONB-03: un único listener para los botones de primer uso de todas
       las pestañas (#tab-content es compartido: si cada módulo lo manejara,
       la acción se ejecutaría una vez por módulo visitado). */
    document.getElementById("tab-content").addEventListener("click", function (ev) {
      var boton = ev.target.closest('[data-accion^="inicio-"]');
      if (boton) GYMAPP.primerUso.manejarAccion(boton.dataset.accion);
    });

    TABS.forEach(function (tab) {
      document.getElementById("nav-" + tab.id).addEventListener("click", function () {
        renderTab(tab.id, data);
      });
    });

    renderTab(tabActual, data);

    /* PROFILE-01: el avatar del encabezado lo maneja perfilFoto (también
       cuando después cambia la sesión o la foto). */
    if (GYMAPP.perfilFoto) GYMAPP.perfilFoto.actualizarEncabezado();

    /* ONB-03: guía de inicio automática solo para quien parece nuevo. */
    if (GYMAPP.primerUso) GYMAPP.primerUso.mostrarGuiaSiCorresponde(GYMAPP.storage.getData());
  }

  /* ONB-03: navegación compartida para los botones de primer uso. Abre la
     pestaña y, si se pide, dispara el flujo EXISTENTE de esa pantalla
     (importador de PDF o editor manual de Rutina). Se llama dentro del
     mismo click, así el selector de archivos del navegador se puede abrir. */
  function irA(tabId, opciones) {
    if (!document.getElementById("tab-content")) return;
    renderTab(tabId, GYMAPP.storage.getData());
    var contenido = document.getElementById("tab-content");
    var accion = opciones && opciones.accion;
    if (tabId === "rutina" && accion === "importar-pdf") GYMAPP.rutina.iniciarImportacionPdf(contenido);
    if (tabId === "rutina" && accion === "crear-plan") GYMAPP.rutina.iniciarCreacionManual(contenido);
  }

  function renderBotonNav(tab) {
    return (
      '<button id="nav-' + tab.id + '" class="nav-item" data-tab="' + tab.id + '">' +
      '<span class="nav-icono">' + tab.icono + "</span>" +
      '<span class="nav-label">' + tab.label + "</span>" +
      "</button>"
    );
  }

  function renderTab(tabId, data) {
    tabActual = tabId;
    var contenido = document.getElementById("tab-content");
    window.scrollTo(0, 0);

    document.querySelectorAll(".nav-item").forEach(function (btn) {
      btn.classList.toggle("activo", btn.dataset.tab === tabId);
    });

    if (tabId === "dashboard") {
      GYMAPP.dashboard.render(contenido);
      return;
    }

    if (tabId === "rutina") {
      GYMAPP.rutina.render(contenido);
      return;
    }

    if (tabId === "entrenar") {
      GYMAPP.entrenamiento.render(contenido);
      return;
    }

    if (tabId === "progreso") {
      GYMAPP.progreso.render(contenido);
      return;
    }

    if (tabId === "nutricion") {
      GYMAPP.nutricion.render(contenido);
      return;
    }
  }

  return { iniciar: iniciar, irA: irA };
})();

/* AUTH-04: auth.inicializar() ahora lo llama iniciar() (pantalla de
   acceso), para decidir con la sesión ya recuperada. */
document.addEventListener("DOMContentLoaded", function () {
  GYMAPP.app.iniciar();
});
