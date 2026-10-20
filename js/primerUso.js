/* ONB-03: primer uso guiado. Estado del usuario a partir de sus datos
   reales (plan y sesiones), tarjetas de inicio y una guía de 4 pasos.

   Estados:
     "sin_plan"                 el plan activo no tiene ejercicios y nunca entrenó
     "plan_sin_entrenamientos"  plan con ejercicios, 0 sesiones de gimnasio
     "primer_entrenamiento"     exactamente 1 sesión de gimnasio
     "usuario_activo"           2 o más sesiones de gimnasio

   La guía automática aparece SOLO a quien parece nuevo: sin sesiones de
   ninguna actividad, sin registros de nutrición ni medidas, y sin haberla
   completado u omitido. Al terminarla u omitirla se guarda
   data.onboarding = { version: 1, completado: true } (campo opcional de
   schema 3: no cambia schema_version ni toca planes ni sesiones). */
var GYMAPP = window.GYMAPP || (window.GYMAPP = {});

GYMAPP.primerUso = (function () {
  var VERSION_GUIA = 1;

  var PASOS_GUIA = [
    { objetivo: "#btn-rutina", titulo: "Rutina", texto: "Acá cargás o importás tu plan de entrenamiento." },
    { objetivo: "#nav-entrenar", titulo: "Entrenar", texto: "Durante cada sesión registrás pesos, repeticiones y esfuerzo." },
    { objetivo: "#nav-progreso", titulo: "Progreso", texto: "Acá comparás tu evolución entre entrenamientos y planes." },
    { objetivo: "#nav-nutricion", titulo: "Nutrición (opcional)", texto: "Podés registrar comidas, macros y peso corporal." }
  ];

  /* --- Estado (puro) --- */

  /* true si el plan activo tiene al menos un ejercicio. */
  function tienePlanUtil(data) {
    return GYMAPP.planes.planEsUtil(GYMAPP.planes.planActivo(data));
  }

  function guiaCompletada(data) {
    return !!(data && data.onboarding && data.onboarding.completado === true);
  }

  function estadoInicial(data) {
    var sesiones = (data && data.sesiones_entrenamiento) || [];
    var gimnasio = sesiones.filter(function (s) { return s && s.tipo === "gimnasio"; }).length;
    var tienePlan = tienePlanUtil(data);
    var estado = gimnasio >= 2 ? "usuario_activo"
      : gimnasio === 1 ? "primer_entrenamiento"
      : tienePlan ? "plan_sin_entrenamientos"
      : "sin_plan";
    var sinUso = !sesiones.length && !((data && data.registros_nutricion) || []).length && !((data && data.medidas_corporales) || []).length;
    return {
      estado: estado,
      tiene_plan: tienePlan,
      tiene_entrenamientos: gimnasio > 0,
      sesiones_gimnasio: gimnasio,
      mostrar_onboarding: estado === "sin_plan" || estado === "plan_sin_entrenamientos",
      paso_sugerido: { sin_plan: "plan", plan_sin_entrenamientos: "entrenar", primer_entrenamiento: "progreso", usuario_activo: "completo" }[estado],
      guia_automatica: sinUso && !guiaCompletada(data)
    };
  }

  /* --- Tarjeta de inicio (Dashboard) --- */

  function renderTarjetaDashboard(data) {
    var e = estadoInicial(data);
    if (e.estado === "sin_plan") {
      return (
        '<section class="primer-uso-card" aria-labelledby="primer-uso-titulo">' +
        '<h2 id="primer-uso-titulo">Empezá configurando tu entrenamiento</h2>' +
        '<ol class="primer-uso-pasos">' +
        '<li class="actual">Cargá tu plan</li>' +
        "<li>Registrá tu primer entrenamiento</li>" +
        "<li>Seguimos tu progreso automáticamente</li>" +
        "</ol>" +
        '<div class="primer-uso-acciones">' +
        '<button type="button" data-accion="inicio-importar-pdf" class="btn btn-primario">Importar plan desde PDF</button>' +
        '<button type="button" data-accion="inicio-crear-plan" class="btn-secundario">Crear plan manualmente</button>' +
        "</div>" +
        '<p class="nota">Nutrición es opcional: podés usarla cuando quieras.</p>' +
        "</section>"
      );
    }
    if (e.estado === "plan_sin_entrenamientos") {
      return (
        '<section class="primer-uso-card" aria-labelledby="primer-uso-titulo">' +
        '<h2 id="primer-uso-titulo">Tu plan ya está listo</h2>' +
        '<ol class="primer-uso-pasos">' +
        '<li class="hecho">Cargá tu plan</li>' +
        '<li class="actual">Registrá tu primer entrenamiento</li>' +
        "<li>Seguimos tu progreso automáticamente</li>" +
        "</ol>" +
        '<div class="primer-uso-acciones">' +
        '<button type="button" data-accion="inicio-entrenar" class="btn btn-primario">Registrar primer entrenamiento</button>' +
        "</div>" +
        "</section>"
      );
    }
    return "";
  }

  /* Acciones de las tarjetas: SIEMPRE abren los flujos existentes. */
  function manejarAccion(accion) {
    if (accion === "inicio-importar-pdf") GYMAPP.app.irA("rutina", { accion: "importar-pdf" });
    else if (accion === "inicio-crear-plan") GYMAPP.app.irA("rutina", { accion: "crear-plan" });
    else if (accion === "inicio-entrenar") GYMAPP.app.irA("entrenar");
    else if (accion === "inicio-ir-rutina") GYMAPP.app.irA("rutina");
    else return false;
    return true;
  }

  /* --- Guía de inicio (máximo 4 pasos) --- */

  var pasoActual = -1;
  var alCerrar = null;

  function contenedorGuia() {
    return document.getElementById("guia-inicio");
  }

  function guiaAbierta() {
    return pasoActual >= 0;
  }

  function marcarObjetivo() {
    document.querySelectorAll(".guia-objetivo").forEach(function (n) { n.classList.remove("guia-objetivo"); });
    var objetivo = document.querySelector(PASOS_GUIA[pasoActual].objetivo);
    if (objetivo) objetivo.classList.add("guia-objetivo");
  }

  function renderGuia() {
    var paso = PASOS_GUIA[pasoActual];
    var esc = GYMAPP.util.escapeHtml;
    var ultimo = pasoActual === PASOS_GUIA.length - 1;
    return (
      '<div class="guia-fondo"></div>' +
      '<div class="guia-tarjeta" role="dialog" aria-modal="true" aria-labelledby="guia-titulo" aria-describedby="guia-texto" tabindex="-1">' +
      '<p class="guia-paso">Paso ' + (pasoActual + 1) + " de " + PASOS_GUIA.length + "</p>" +
      '<h3 id="guia-titulo">' + esc(paso.titulo) + "</h3>" +
      '<p id="guia-texto">' + esc(paso.texto) + "</p>" +
      '<div class="guia-acciones">' +
      (ultimo ? "" : '<button type="button" data-guia="omitir" class="btn-enlace guia-omitir">Omitir</button>') +
      (pasoActual > 0 ? '<button type="button" data-guia="atras" class="btn-secundario">Atrás</button>' : "") +
      '<button type="button" data-guia="' + (ultimo ? "listo" : "siguiente") + '" class="btn-secundario btn-guardar-plan">' + (ultimo ? "Listo" : "Siguiente") + "</button>" +
      "</div>" +
      "</div>"
    );
  }

  function pintarGuia() {
    var cont = contenedorGuia();
    if (!cont) {
      cont = document.createElement("div");
      cont.id = "guia-inicio";
      document.body.appendChild(cont);
      cont.addEventListener("click", function (ev) {
        var b = ev.target.closest("[data-guia]");
        if (!b) return;
        var a = b.dataset.guia;
        if (a === "siguiente") irAPaso(pasoActual + 1);
        else if (a === "atras") irAPaso(pasoActual - 1);
        else cerrarGuia();
      });
    }
    cont.innerHTML = renderGuia();
    document.body.classList.add("guia-activa");
    marcarObjetivo();
    var foco = cont.querySelector('[data-guia="siguiente"], [data-guia="listo"]');
    if (foco) foco.focus();
  }

  function irAPaso(n) {
    if (n < 0 || n >= PASOS_GUIA.length) return;
    pasoActual = n;
    pintarGuia();
  }

  /* Abre la guía en el paso 1 (automática o desde "Ver guía de inicio").
     `opciones.alCerrar` recibe el foco al cerrar. */
  function abrirGuia(opciones) {
    alCerrar = (opciones && opciones.alCerrar) || null;
    pasoActual = 0;
    pintarGuia();
  }

  /* Omitir, Listo, ✕ o Escape: cierra y la marca como vista para que no
     vuelva a aparecer sola. Si no se pudo guardar, igual se cierra. */
  function cerrarGuia() {
    if (!guiaAbierta()) return;
    pasoActual = -1;
    var cont = contenedorGuia();
    if (cont) cont.parentNode.removeChild(cont);
    document.body.classList.remove("guia-activa");
    document.querySelectorAll(".guia-objetivo").forEach(function (n) { n.classList.remove("guia-objetivo"); });
    var data = GYMAPP.storage.getData();
    if (!guiaCompletada(data)) {
      GYMAPP.storage.updateData(function (d) {
        d.onboarding = { version: VERSION_GUIA, completado: true };
      }, { alertaAutomatica: false });
    }
    var volver = alCerrar;
    alCerrar = null;
    if (volver && typeof volver.focus === "function") volver.focus();
  }

  if (typeof document.addEventListener === "function") {
    document.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape" && guiaAbierta()) cerrarGuia();
    });
  }

  /* Se llama al armar la app: abre la guía sola solo si corresponde. */
  function mostrarGuiaSiCorresponde(data) {
    if (!guiaAbierta() && estadoInicial(data).guia_automatica) abrirGuia();
  }

  return {
    PASOS_GUIA: PASOS_GUIA,
    estadoInicial: estadoInicial,
    tienePlanUtil: tienePlanUtil,
    renderTarjetaDashboard: renderTarjetaDashboard,
    manejarAccion: manejarAccion,
    abrirGuia: abrirGuia,
    cerrarGuia: cerrarGuia,
    irAPaso: irAPaso,
    guiaAbierta: guiaAbierta,
    pasoActual: function () { return pasoActual; },
    mostrarGuiaSiCorresponde: mostrarGuiaSiCorresponde
  };
})();
