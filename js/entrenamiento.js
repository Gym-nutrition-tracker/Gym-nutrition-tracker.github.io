/* Pestaña Entrenar: registra sesiones contra sesiones_entrenamiento.
   ACT-03: el selector de actividad y el formulario específico salen de
   usuario.actividades + GYMAPP.actividades (catálogo), no de una lista fija
   de gimnasio/fútbol. Gimnasio nunca cambió su lógica (rutina.dias +
   ejercicios_realizados); el resto de los deportes usa sesion.detalle. */
var GYMAPP = window.GYMAPP || (window.GYMAPP = {});

GYMAPP.entrenamiento = (function () {
  var RPE_VALORES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  var MENSAJE_ERROR_GUARDADO = "No se pudo guardar el cambio. Revisá el espacio disponible en tu dispositivo e intentá de nuevo.";

  /* Estado del borrador de sesión en curso. No se persiste hasta "Guardar sesión". */
  var estado = null;

  function estadoInicial() {
    return {
      /* Si tiene un id, guardarSesion() edita esa sesión existente en vez de
         crear una nueva. Nunca se persiste tal cual: es solo el borrador. */
      editandoId: null,
      fecha: fechaHoyISO(),
      /* Corregido en cada render() según usuario.actividades: si "gimnasio"
         no está configurado, se reemplaza por la primera actividad
         configurada (o queda así si el usuario no configuró ninguna). */
      tipo: "gimnasio",
      diaRutinaId: "",
      seriesPorEjercicio: {},
      /* Solo se usa editando una sesión de gimnasio: instantánea de qué
         ejercicios tenía ESA sesión (id + etiqueta para mostrar), resuelta
         una vez al entrar en edición. Nunca se vuelve a mirar la rutina
         actual durante la edición, así que un día u ejercicio borrado
         después no bloquea editar la sesión. */
      ejerciciosHistoricos: [],
      duracion_min: "",
      rpe: null,
      notas: "",
      /* ACT-03: campos específicos de deportes no-gimnasio, compartidos por
         todos (fútbol/básquet/pádel/tenis/natación). Cada deporte solo lee y
         guarda los campos que le corresponden según GYMAPP.actividades
         (ver campos de cada actividad en el catálogo); tener acá los 5
         campos siempre presentes evita tener un estado distinto por deporte. */
      detalle: { tipo_sesion: "entrenamiento", posicion: "", minutos_jugados: "", distancia_m: "", estilo: "" }
    };
  }

  function fechaHoyISO() {
    var d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  function render(container) {
    if (!estado) estado = estadoInicial();
    var data = GYMAPP.storage.getData();
    var actividadesUsuario = GYMAPP.actividades.obtenerActividadesUsuario(data.usuario);

    /* Si no se está editando una sesión histórica, el tipo activo siempre
       tiene que ser una actividad configurada: si el usuario desactivó la
       que tenía elegida (o todavía no eligió ninguna), se corrige acá antes
       de armar el formulario. Editando, en cambio, el tipo queda fijo al de
       la sesión histórica aunque esa actividad ya no esté configurada. */
    if (!estado.editandoId) {
      var tiposConfigurados = actividadesUsuario.map(function (a) { return a.tipo; });
      if (tiposConfigurados.indexOf(estado.tipo) === -1) {
        estado.tipo = tiposConfigurados.length ? tiposConfigurados[0] : "gimnasio";
      }
    }

    /* Al editar, seriesPorEjercicio ya viene precargado desde la sesión
       histórica (ver cargarParaEditar); no hay que completarlo con la
       rutina actual. */
    if (!estado.editandoId && estado.tipo === "gimnasio" && estado.diaRutinaId) {
      var dia = GYMAPP.planes.buscarDiaActivo(data, estado.diaRutinaId);
      if (dia) asegurarSeriesInicializadas(dia);
    }

    container.innerHTML = template(data, estado, actividadesUsuario);
    if (!container.dataset.entrenarBound) {
      bindEventos(container);
      container.dataset.entrenarBound = "1";
    }
  }

  function asegurarSeriesInicializadas(dia) {
    dia.ejercicios.forEach(function (ej) {
      if (estado.seriesPorEjercicio[ej.id]) return;
      var cantidad = ej.series_objetivo > 0 ? ej.series_objetivo : 1;
      var series = [];
      for (var i = 0; i < cantidad; i++) series.push({ peso_kg: "", reps: "" });
      estado.seriesPorEjercicio[ej.id] = series;
    });
  }

  /* --- Templates --- */

  function template(data, estado, actividadesUsuario) {
    var hayFormulario = !!estado.editandoId || actividadesUsuario.length > 0;
    /* ONB-03: gimnasio sin plan → solo el aviso para cargarlo (sin campos
       ni "Guardar sesión" que llevarían a un error). */
    var gimnasioSinPlan = !estado.editandoId && estado.tipo === "gimnasio" && !GYMAPP.primerUso.tienePlanUtil(data);

    return (
      '<div class="pantalla pantalla-entrenar">' +
      "<h2>Entrenar</h2>" +
      renderFecha(estado) +
      renderSelectorActividad(estado, actividadesUsuario) +
      '<div id="entrenar-mensaje" class="mensaje oculto"></div>' +
      (hayFormulario && gimnasioSinPlan ? renderCuerpoActividad(data, estado) : "") +
      (hayFormulario && !gimnasioSinPlan
        ? renderCuerpoActividad(data, estado) +
          renderComun(estado) +
          '<button type="button" data-accion="guardar-sesion" class="btn btn-primario">' +
          (estado.editandoId ? "Guardar cambios" : "Guardar sesión") +
          "</button>"
        : "") +
      (estado.editandoId
        ? '<button type="button" data-accion="cancelar-edicion" class="btn btn-secundario">Cancelar edición</button>'
        : "") +
      renderHistorial(data) +
      /* E6.1: el contenedor del panel existe solo mientras está abierto. */
      (reasignacion ? '<div id="entrenar-modal">' + renderModalReasignacion(data) + "</div>" : "") +
      "</div>"
    );
  }

  function renderFecha(estado) {
    return (
      '<div class="campo">' +
      '<label for="input-fecha-sesion">Fecha</label>' +
      '<input type="date" id="input-fecha-sesion" value="' + estado.fecha + '" max="' + fechaHoyISO() + '" />' +
      "</div>"
    );
  }

  /* ACT-03: reemplaza el selector fijo Gimnasio/Fútbol por uno construido
     desde usuario.actividades (nunca de una lista hardcodeada acá), usando
     el catálogo de GYMAPP.actividades para nombre e ícono.
     - Editando una sesión histórica: el tipo queda fijo (no seleccionable),
       aunque esa actividad ya no esté configurada actualmente.
     - 0 actividades configuradas: se avisa y no se ofrece cargar una nueva.
     - 1 sola actividad: se selecciona sola, sin mostrar un selector.
     - 2 o más: selector de botones (igual que el gimnasio/fútbol de
       siempre); con más de 2 pasa a una tira horizontal deslizable para no
       generar overflow en pantallas angostas. */
  function renderSelectorActividad(estado, actividadesUsuario) {
    if (estado.editandoId) {
      /* Gimnasio ya deja clarísimo qué es en su propia edición (día de
         rutina + ejercicios): repetirlo acá sería redundante. Para el resto
         de los deportes, que no tienen otra pista visual del tipo mientras
         se edita, sí conviene mostrarlo. */
      if (estado.tipo === "gimnasio") return "";
      var actividadEditando = GYMAPP.actividades.obtenerActividadPorId(estado.tipo);
      var etiquetaEditando = actividadEditando ? actividadEditando.icono + " " + actividadEditando.nombre : estado.tipo;
      return '<div class="campo"><label>Actividad</label><p class="nota">' + etiquetaEditando + "</p></div>";
    }

    if (!actividadesUsuario.length) {
      return '<p class="nota">Todavía no configuraste ninguna actividad. Andá a Rutina para elegir tus actividades y metas semanales.</p>';
    }

    if (actividadesUsuario.length === 1) {
      var unica = GYMAPP.actividades.obtenerActividadPorId(actividadesUsuario[0].tipo);
      var etiquetaUnica = unica ? unica.icono + " " + unica.nombre : actividadesUsuario[0].tipo;
      return '<div class="campo"><label>Actividad</label><p class="nota">' + etiquetaUnica + "</p></div>";
    }

    var claseExtra = actividadesUsuario.length > 2 ? " selector-tipo-entrenar" : "";
    return (
      '<div class="selector-tipo' + claseExtra + '">' +
      actividadesUsuario.map(function (a) {
        var actividad = GYMAPP.actividades.obtenerActividadPorId(a.tipo);
        if (!actividad) return "";
        return botonTipo(actividad.id, actividad.icono + " " + actividad.nombre, estado.tipo);
      }).join("") +
      "</div>"
    );
  }

  function botonTipo(valor, etiqueta, tipoActual) {
    return (
      '<button type="button" data-accion="set-tipo" data-tipo="' + valor + '" class="btn-tipo' +
      (tipoActual === valor ? " activo" : "") + '">' + etiqueta + "</button>"
    );
  }

  function renderGimnasio(data, estado) {
    if (estado.editandoId) return renderGimnasioEdicion(estado);

    var dias = GYMAPP.planes.diasDelPlanActivo(data);
    if (!GYMAPP.primerUso.tienePlanUtil(data)) {
      return (
        '<div class="primer-uso-aviso" role="status">' +
        "<p><strong>Primero necesitás cargar un plan.</strong></p>" +
        "<p>Importá el PDF de tu entrenador o armá tu rutina, y después registrás tus entrenamientos acá.</p>" +
        '<button type="button" data-accion="inicio-ir-rutina" class="btn btn-primario">Cargar mi plan</button>' +
        "</div>"
      );
    }

    var opciones = '<option value="">Elegí un día</option>' +
      dias.map(function (d) {
        return '<option value="' + d.id + '"' + (d.id === estado.diaRutinaId ? " selected" : "") + ">" +
          GYMAPP.util.escapeHtml(d.nombre) + "</option>";
      }).join("");

    var html = '<div class="campo"><label for="select-dia-rutina">Día de rutina</label>' +
      '<select id="select-dia-rutina">' + opciones + "</select></div>";

    if (!estado.diaRutinaId) return html;

    var dia = GYMAPP.planes.buscarDiaActivo(data, estado.diaRutinaId);
    if (!dia) return html;

    if (!dia.ejercicios.length) {
      return html + '<p class="nota">Este día no tiene ejercicios cargados todavía.</p>';
    }

    /* E6.5: carga sugerida, calculada en el momento (no se guarda). El
       índice del historial se arma una sola vez por día elegido. */
    var cargas = GYMAPP.recomendacionCarga;
    var sugerencias = null;
    if (cargas) {
      var indice = cargas.construirIndiceHistorial(data);
      var contexto = cargas.contextoPlan(GYMAPP.planes.planActivo(data));
      var hoy = GYMAPP.util.fechaLocalISO(new Date());
      var pesoCorporal = cargas.pesoCorporalActual(data);
      sugerencias = function (ej) { return cargas.renderSugerencia(cargas.recomendar(indice, ej, { hoy: hoy, contexto: contexto, pesoCorporal: pesoCorporal })); };
    }

    html += '<div class="ejercicios-entrenar">' +
      dia.ejercicios.map(function (ej) { return renderEjercicioEntrenar(data, ej, sugerencias); }).join("") +
      "</div>";

    return html;
  }

  function renderEjercicioEntrenar(data, ejercicio, sugerencias) {
    /* E6.5: mismo id, o el mismo ejercicio por nombre en otro plan. */
    var ultimo = GYMAPP.rutinasHistoricas.buscarUltimaEjecucion(data, ejercicio);
    var series = estado.seriesPorEjercicio[ejercicio.id] || [];

    return (
      '<div class="ejercicio-entrenar-card" data-ejercicio-id="' + ejercicio.id + '">' +
      '<div class="ejercicio-entrenar-header">' +
      "<strong>" + GYMAPP.util.escapeHtml(ejercicio.nombre || "(sin nombre)") + "</strong>" +
      '<span class="ejercicio-objetivo">' + ejercicio.series_objetivo + " × " + GYMAPP.util.escapeHtml(ejercicio.reps_objetivo) + "</span>" +
      "</div>" +
      '<div class="ejercicio-ultimo-registro">' +
      (ultimo ? "Última vez: " + GYMAPP.util.escapeHtml(formatearSeries(ultimo.series)) : "Sin registros previos") +
      "</div>" +
      (sugerencias ? sugerencias(ejercicio) : "") +
      '<div class="series-lista">' +
      series.map(function (s, i) { return renderSerieInput(ejercicio.id, i, s); }).join("") +
      "</div>" +
      '<button type="button" data-accion="agregar-serie" data-ejercicio-id="' + ejercicio.id + '" class="btn-agregar-serie">+ Serie</button>' +
      "</div>"
    );
  }

  /* Edición de una sesión de gimnasio: se muestran EXACTAMENTE los
     ejercicios que ya tenía esa sesión (estado.ejerciciosHistoricos), nunca
     los de la rutina actual. El día de rutina se muestra solo informativo
     (no editable): cambiar a qué día pertenece la sesión implicaría
     reconstruirla con otros ejercicios, y eso es justamente lo que no
     queremos hacer al editar un registro histórico. */
  function renderGimnasioEdicion(estado) {
    var nombreDia = estado.nombreDiaHistorico || GYMAPP.rutinasHistoricas.NOMBRE_BLOQUE_DESCONOCIDO;
    var html = '<div class="campo"><label>Día de rutina</label><p class="nota">' + GYMAPP.util.escapeHtml(nombreDia) + "</p>" +
      '<button type="button" data-accion="reasignar-sesion" class="btn-enlace btn-reasignar">Reasignar a otro plan</button></div>';

    if (!estado.ejerciciosHistoricos.length) {
      return html + '<p class="nota">Esta sesión no tiene ejercicios registrados.</p>';
    }

    html += '<div class="ejercicios-entrenar">' +
      estado.ejerciciosHistoricos.map(renderEjercicioHistoricoEntrenar).join("") +
      "</div>";

    return html;
  }

  function renderEjercicioHistoricoEntrenar(ejercicioHistorico) {
    var series = estado.seriesPorEjercicio[ejercicioHistorico.ejercicio_id] || [];

    return (
      '<div class="ejercicio-entrenar-card" data-ejercicio-id="' + ejercicioHistorico.ejercicio_id + '">' +
      '<div class="ejercicio-entrenar-header">' +
      "<strong>" + GYMAPP.util.escapeHtml(ejercicioHistorico.etiqueta) + "</strong>" +
      (ejercicioHistorico.objetivo ? '<span class="ejercicio-objetivo">' + GYMAPP.util.escapeHtml(ejercicioHistorico.objetivo) + "</span>" : "") +
      "</div>" +
      '<div class="series-lista">' +
      series.map(function (s, i) { return renderSerieInput(ejercicioHistorico.ejercicio_id, i, s); }).join("") +
      "</div>" +
      '<button type="button" data-accion="agregar-serie" data-ejercicio-id="' + ejercicioHistorico.ejercicio_id + '" class="btn-agregar-serie">+ Serie</button>' +
      "</div>"
    );
  }

  /* Busca un ejercicio por id en TODOS los días de la rutina actual (no solo
     en el día original de la sesión), para poder mostrar su nombre incluso
     si el ejercicio se movió de día. Devuelve null si ya no existe en
     ningún lado. */
  function renderSerieInput(ejercicioId, indice, serie) {
    return (
      '<div class="serie-input-row" data-ejercicio-id="' + ejercicioId + '" data-serie-indice="' + indice + '">' +
      '<span class="serie-numero">' + (indice + 1) + "</span>" +
      '<input type="number" inputmode="decimal" class="input-serie-peso" data-campo="peso_kg" placeholder="kg" min="0" step="0.5" value="' + serie.peso_kg + '" />' +
      '<span class="serie-x">×</span>' +
      '<input type="number" inputmode="numeric" class="input-serie-reps" data-campo="reps" placeholder="reps" min="0" step="1" value="' + serie.reps + '" />' +
      '<button type="button" data-accion="borrar-serie" data-ejercicio-id="' + ejercicioId + '" data-serie-indice="' + indice + '" class="btn-icono btn-borrar" aria-label="Borrar serie">✕</button>' +
      "</div>"
    );
  }

  /* ACT-03: qué formulario mostrar para el cuerpo específico de la
     actividad elegida. Gimnasio y natación tienen forma propia real
     (rutina/series el primero, distancia+estilo la segunda); el resto
     (fútbol, básquet, pádel, tenis, y cualquier deporte nuevo con la misma
     forma) comparte renderDeporteGenerico según su metadata de catálogo. */
  function renderCuerpoActividad(data, estado) {
    if (estado.tipo === "gimnasio") return renderGimnasio(data, estado);
    if (estado.tipo === "natacion") return renderNatacion(estado);

    var actividad = GYMAPP.actividades.obtenerActividadPorId(estado.tipo);
    if (!actividad) return "";
    return renderDeporteGenerico(estado, actividad);
  }

  /* Formulario genérico para deportes de tipoSesion (entrenamiento/partido)
     + opcionalmente posición y minutos jugados (fútbol). Un deporte nuevo
     que solo necesite tipoSesion + duración + RPE + notas (ya cubiertos por
     renderComun) queda andando agregando una entrada al catálogo, sin
     escribir un formulario nuevo acá. */
  function renderDeporteGenerico(estado, actividad) {
    var campos = actividad.campos || [];
    var d = estado.detalle;
    var html = "";

    if (campos.indexOf("tipoSesion") !== -1) {
      html += '<div class="campo"><label for="select-detalle-tipo-sesion">Tipo de sesión</label>' +
        '<select id="select-detalle-tipo-sesion">' +
        '<option value="entrenamiento"' + (d.tipo_sesion === "entrenamiento" ? " selected" : "") + ">Entrenamiento</option>" +
        '<option value="partido"' + (d.tipo_sesion === "partido" ? " selected" : "") + ">Partido</option>" +
        "</select></div>";
    }

    if (campos.indexOf("posicion") !== -1) {
      html += '<div class="campo"><label for="input-detalle-posicion">Posición</label>' +
        '<input type="text" id="input-detalle-posicion" placeholder="Ej: Mediocampista" value="' + GYMAPP.util.escapeHtml(d.posicion) + '" /></div>';
    }

    if (campos.indexOf("minutosJugados") !== -1) {
      html += '<div class="campo"><label for="input-detalle-minutos">Minutos jugados</label>' +
        '<input type="number" id="input-detalle-minutos" inputmode="numeric" min="0" placeholder="Minutos" value="' + GYMAPP.util.escapeHtml(d.minutos_jugados) + '" /></div>';
    }

    return '<div class="deporte-form">' + html + "</div>";
  }

  var OPCIONES_ESTILO_NATACION = [
    ["", "Sin especificar"],
    ["libre", "Libre"],
    ["espalda", "Espalda"],
    ["pecho", "Pecho"],
    ["mariposa", "Mariposa"],
    ["combinado", "Combinado"]
  ];

  /* Natación tiene forma propia (distancia en metros + estilo opcional, sin
     tipoSesion): no encaja en renderDeporteGenerico, así que tiene su propio
     render como gimnasio. */
  function renderNatacion(estado) {
    var d = estado.detalle;
    return (
      '<div class="deporte-form">' +
      '<div class="campo"><label for="input-detalle-distancia">Distancia (metros)</label>' +
      '<input type="number" id="input-detalle-distancia" inputmode="decimal" min="0" step="0.01" placeholder="Metros" value="' + GYMAPP.util.escapeHtml(d.distancia_m) + '" /></div>' +
      '<div class="campo"><label for="select-detalle-estilo">Estilo (opcional)</label>' +
      '<select id="select-detalle-estilo">' +
      OPCIONES_ESTILO_NATACION.map(function (o) {
        return '<option value="' + o[0] + '"' + (d.estilo === o[0] ? " selected" : "") + ">" + o[1] + "</option>";
      }).join("") +
      "</select></div>" +
      "</div>"
    );
  }

  function renderComun(estado) {
    return (
      '<div class="campo"><label for="input-duracion">Duración total (min)</label>' +
      '<input type="number" id="input-duracion" inputmode="numeric" min="0" placeholder="Minutos" value="' + GYMAPP.util.escapeHtml(estado.duracion_min) + '" /></div>' +
      '<div class="campo"><label>RPE (esfuerzo percibido)</label>' +
      '<div class="rpe-selector">' +
      RPE_VALORES.map(function (v) {
        return '<button type="button" data-accion="set-rpe" data-valor="' + v + '" class="btn-rpe' +
          (estado.rpe === v ? " activo" : "") + '">' + v + "</button>";
      }).join("") +
      "</div></div>" +
      '<div class="campo"><label for="input-notas">Notas</label>' +
      '<textarea id="input-notas" rows="3" placeholder="Sensaciones, dolores, lo que quieras anotar">' + GYMAPP.util.escapeHtml(estado.notas) + "</textarea></div>"
    );
  }

  /* --- Historial de sesiones --- */

  function formatearFechaHistorial(fechaLocalIso) {
    var d = new Date(fechaLocalIso + "T00:00:00");
    return d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
  }

  function renderHistorial(data) {
    var sesiones = data.sesiones_entrenamiento;
    if (!sesiones.length) {
      return '<div class="seccion-historial"><h3>Historial de sesiones</h3><p class="nota">Todavía no registraste ninguna sesión.</p></div>';
    }

    var ordenadas = sesiones.slice().sort(function (a, b) { return new Date(b.fecha) - new Date(a.fecha); });

    return (
      '<div class="seccion-historial">' +
      "<h3>Historial de sesiones</h3>" +
      '<div class="historial-lista">' +
      ordenadas.map(function (s) { return renderItemHistorial(s, data); }).join("") +
      "</div>" +
      "</div>"
    );
  }

  function renderItemHistorial(sesion, data) {
    var fechaLegible = formatearFechaHistorial(GYMAPP.util.fechaLocalISO(sesion.fecha));
    var resumen;

    if (sesion.tipo === "gimnasio") {
      /* Día del plan de la sesión (E5, si tiene plan_id); si no: bloque
         activo -> su nombre actual; bloque histórico -> nombre real si se
         conoce (historial/legacy), si no "Bloque anterior". */
      var cantidad = (sesion.ejercicios_realizados || []).length;
      resumen = "🏋️ " + GYMAPP.util.escapeHtml(GYMAPP.rutinasHistoricas.resolverNombreDiaDeSesion(data, sesion)) +
        " · " + cantidad + (cantidad === 1 ? " ejercicio" : " ejercicios");
    } else {
      resumen = resumenSesionNoGimnasio(sesion);
    }

    return (
      '<div class="historial-item" data-sesion-id="' + sesion.id + '">' +
      '<div class="historial-item-info">' +
      '<span class="historial-item-fecha">' + fechaLegible + "</span>" +
      '<span class="historial-item-resumen">' + resumen + "</span>" +
      "</div>" +
      '<div class="historial-item-acciones">' +
      '<button type="button" data-accion="editar-sesion" data-sesion-id="' + sesion.id + '" class="btn-icono" aria-label="Editar sesión">✏️</button>' +
      '<button type="button" data-accion="borrar-sesion" data-sesion-id="' + sesion.id + '" class="btn-icono btn-borrar" aria-label="Borrar sesión">🗑️</button>' +
      "</div>" +
      "</div>"
    );
  }

  /* Resumen genérico del historial para cualquier deporte que no sea
     gimnasio (incluye actividades ya desactivadas: usa el catálogo y
     obtenerDetalleSesion, que no dependen de usuario.actividades). Solo
     fútbol y natación agregan un dato propio (minutos / distancia); el
     resto queda con ícono + nombre + tipo de sesión. */
  function resumenSesionNoGimnasio(sesion) {
    var actividad = GYMAPP.actividades.obtenerActividadPorId(sesion.tipo);
    var detalle = GYMAPP.actividades.obtenerDetalleSesion(sesion) || {};
    var icono = actividad ? actividad.icono : "🏃";
    var nombre = actividad ? actividad.nombre : sesion.tipo;
    var tipoSesion = detalle.tipo_sesion || detalle.tipo || null;

    var partes = [icono + " " + nombre];
    if (tipoSesion) partes.push(tipoSesion === "partido" ? "Partido" : "Entrenamiento");
    if (sesion.tipo === "futbol" && detalle.minutos_jugados) partes.push(detalle.minutos_jugados + " min");
    if (sesion.tipo === "natacion" && detalle.distancia_m) partes.push(detalle.distancia_m + " m");
    return partes.join(" · ");
  }

  /* Carga una sesión existente en el borrador para editarla. Reconstruye
     seriesPorEjercicio y ejerciciosHistoricos directamente desde
     ejercicios_realizados de la sesión (nunca desde la rutina actual), así
     que un día o ejercicio borrado después no impide editar los valores ya
     registrados. usa fechaLocalISO (PRO-01/PRO-02) para precargar el campo
     de fecha en el día LOCAL correcto, nunca el día UTC del timestamp
     guardado. */
  function cargarParaEditar(sesion, data) {
    var seriesPorEjercicio = {};
    var ejerciciosHistoricos = [];

    if (sesion.tipo === "gimnasio") {
      (sesion.ejercicios_realizados || []).forEach(function (er) {
        seriesPorEjercicio[er.ejercicio_id] = er.series.map(function (s) {
          return { peso_kg: String(s.peso_kg), reps: String(s.reps) };
        });
        /* Nombre y objetivo tal como se registraron (E5: snapshot de la
           sesión; si no tiene, la resolución de siempre). Sin datos: el
           texto de siempre. */
        var resuelto = GYMAPP.rutinasHistoricas.resolverEjercicioDeSesion(data, sesion, er);
        ejerciciosHistoricos.push({
          ejercicio_id: er.ejercicio_id,
          etiqueta: resuelto ? resuelto.nombre : "Ejercicio eliminado de la rutina",
          objetivo: resuelto && resuelto.prescripcion ? (resuelto.prescripcion.series_objetivo + " × " + resuelto.prescripcion.reps_objetivo) : ""
        });
      });
    }

    /* obtenerDetalleSesion da compatibilidad hacia atrás: para fútbol
       histórico sin migrar lee futbol_detalle (campo "tipo"), para todo lo
       demás lee detalle (campo "tipo_sesion"). Cubrimos ambas claves acá
       para no perder el valor sea cual sea el origen. */
    var detalleGuardado = GYMAPP.actividades.obtenerDetalleSesion(sesion) || {};

    estado = {
      editandoId: sesion.id,
      fecha: GYMAPP.util.fechaLocalISO(sesion.fecha),
      tipo: sesion.tipo,
      diaRutinaId: sesion.dia_rutina_id || "",
      /* Solo informativo (el día de una sesión histórica no se edita). */
      nombreDiaHistorico: sesion.dia_rutina_id ? GYMAPP.rutinasHistoricas.resolverNombreDiaDeSesion(data, sesion) : null,
      seriesPorEjercicio: seriesPorEjercicio,
      ejerciciosHistoricos: ejerciciosHistoricos,
      duracion_min: sesion.duracion_min != null ? String(sesion.duracion_min) : "",
      rpe: sesion.rpe || null,
      notas: sesion.notas || "",
      detalle: {
        tipo_sesion: detalleGuardado.tipo_sesion || detalleGuardado.tipo || "entrenamiento",
        posicion: detalleGuardado.posicion || "",
        minutos_jugados: detalleGuardado.minutos_jugados != null ? String(detalleGuardado.minutos_jugados) : "",
        distancia_m: detalleGuardado.distancia_m != null ? String(detalleGuardado.distancia_m) : "",
        estilo: detalleGuardado.estilo || ""
      }
    };
  }

  function iniciarEdicion(container, sesionId) {
    var data = GYMAPP.storage.getData();
    var sesion = data.sesiones_entrenamiento.filter(function (s) { return s.id === sesionId; })[0];
    if (!sesion) return;
    cargarParaEditar(sesion, data);
    render(container);
    window.scrollTo(0, 0);
    mostrarMensaje(container, "Editando la sesión del " + formatearFechaHistorial(GYMAPP.util.fechaLocalISO(sesion.fecha)) + ".", "info");
  }

  function borrarSesion(container, sesionId) {
    var data = GYMAPP.storage.getData();
    var sesion = data.sesiones_entrenamiento.filter(function (s) { return s.id === sesionId; })[0];
    if (!sesion) return;

    var actividadSesion = GYMAPP.actividades.obtenerActividadPorId(sesion.tipo);
    var etiquetaTipo = "de " + (actividadSesion ? actividadSesion.nombre.toLowerCase() : sesion.tipo);
    var fechaLegible = formatearFechaHistorial(GYMAPP.util.fechaLocalISO(sesion.fecha));
    if (!confirm("¿Eliminar esta sesión " + etiquetaTipo + " del " + fechaLegible + "? Esta acción no se puede deshacer.")) return;

    var resultado = GYMAPP.storage.updateData(function (d) {
      d.sesiones_entrenamiento = d.sesiones_entrenamiento.filter(function (s) { return s.id !== sesionId; });
    }, { alertaAutomatica: false });

    if (!resultado.guardado) {
      mostrarMensaje(container, MENSAJE_ERROR_GUARDADO, "error");
      return;
    }

    if (estado.editandoId === sesionId) estado = estadoInicial();
    render(container);
    mostrarMensaje(container, "Sesión eliminada.", "exito");
  }

  /* --- Helpers de datos --- */

  function formatearSeries(series) {
    return series.map(function (s) { return s.peso_kg + "kg x" + s.reps; }).join(" · ");
  }

  /* --- Eventos --- */

  function bindEventos(container) {
    container.addEventListener("click", function (ev) {
      var boton = ev.target.closest("[data-accion]");
      if (!boton) return;
      var accion = boton.dataset.accion;

      if (accion === "set-tipo") {
        estado.tipo = boton.dataset.tipo;
        render(container);
      } else if (accion === "set-rpe") {
        estado.rpe = parseInt(boton.dataset.valor, 10);
        render(container);
      } else if (accion === "agregar-serie") {
        var lista = estado.seriesPorEjercicio[boton.dataset.ejercicioId] || [];
        lista.push({ peso_kg: "", reps: "" });
        estado.seriesPorEjercicio[boton.dataset.ejercicioId] = lista;
        render(container);
      } else if (accion === "borrar-serie") {
        var arr = estado.seriesPorEjercicio[boton.dataset.ejercicioId] || [];
        arr.splice(parseInt(boton.dataset.serieIndice, 10), 1);
        render(container);
      } else if (accion === "guardar-sesion") {
        guardarSesion(container);
      } else if (accion === "editar-sesion") {
        iniciarEdicion(container, boton.dataset.sesionId);
      } else if (accion === "cancelar-edicion") {
        estado = estadoInicial();
        render(container);
      } else if (accion === "borrar-sesion") {
        borrarSesion(container, boton.dataset.sesionId);
      } else if (accion === "reasignar-sesion") {
        abrirReasignacion(container);
      } else if (accion === "reasig-cancelar") {
        cerrarReasignacion(container);
      } else if (accion === "reasig-confirmar") {
        confirmarReasignacion(container);
      }
    });

    /* E6.1: cerrar el panel de reasignación tocando afuera o con Escape. */
    container.addEventListener("click", function (ev) {
      if (reasignacion && ev.target.classList && ev.target.classList.contains("modal-fondo")) cerrarReasignacion(container);
    });
    document.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape" && reasignacion && container.querySelector("#entrenar-modal .modal")) cerrarReasignacion(container);
    });

    container.addEventListener("change", function (ev) {
      if (reasignacion && ev.target.closest && ev.target.closest("#entrenar-modal")) {
        cambiarReasignacion(container, ev.target);
        return;
      }
      if (ev.target.id === "select-dia-rutina") {
        estado.diaRutinaId = ev.target.value;
        render(container);
      } else if (ev.target.id === "select-detalle-tipo-sesion") {
        estado.detalle.tipo_sesion = ev.target.value;
      } else if (ev.target.id === "select-detalle-estilo") {
        estado.detalle.estilo = ev.target.value;
      } else if (ev.target.id === "input-fecha-sesion") {
        estado.fecha = ev.target.value;
      }
    });

    container.addEventListener("input", function (ev) {
      var target = ev.target;
      if (target.id === "input-duracion") {
        estado.duracion_min = target.value;
      } else if (target.id === "input-notas") {
        estado.notas = target.value;
      } else if (target.id === "input-detalle-posicion") {
        estado.detalle.posicion = target.value;
      } else if (target.id === "input-detalle-minutos") {
        estado.detalle.minutos_jugados = target.value;
      } else if (target.id === "input-detalle-distancia") {
        estado.detalle.distancia_m = target.value;
      } else if (target.dataset.campo === "peso_kg" || target.dataset.campo === "reps") {
        var fila = target.closest("[data-serie-indice]");
        var ejercicioId = fila.dataset.ejercicioId;
        var indice = parseInt(fila.dataset.serieIndice, 10);
        var lista = estado.seriesPorEjercicio[ejercicioId];
        if (lista && lista[indice]) lista[indice][target.dataset.campo] = target.value;
      }
    });
  }

  /* --- E6.1: reasignar una sesión de gimnasio a otro plan/día ---
     Trabaja sobre la sesión GUARDADA (no sobre cambios sin guardar de la
     edición). Nada se escribe hasta "Confirmar reasignación". */

  var CLAVE_PRE_REASIGNAR = "gymNutritionTracker_preReasignarSesion";
  /* { sesionId, planId, diaId, mapeo: { ejercicio_id original: destino }, intento } */
  var reasignacion = null;

  function escaparAtributo(v) {
    return GYMAPP.util.escapeHtml(v).replace(/"/g, "&quot;");
  }

  function nombrePlanReasignar(plan, activo) {
    var nombre = plan && typeof plan.nombre === "string" && plan.nombre.trim() ? plan.nombre.trim() : (activo ? "Plan actual" : "Plan sin nombre");
    return nombre + (activo ? " (activo)" : "");
  }

  function abrirReasignacion(container) {
    var data = GYMAPP.storage.getData();
    var sesion = data.sesiones_entrenamiento.filter(function (s) { return s.id === estado.editandoId; })[0];
    if (!sesion || sesion.tipo !== "gimnasio") return;
    var activo = GYMAPP.planes.planActivo(data);
    var planId = activo ? activo.plan_id : null;
    var diaId = planId ? GYMAPP.planes.sugerirDiaDestino(data, sesion, planId) : null;
    reasignacion = {
      sesionId: sesion.id, planId: planId, diaId: diaId,
      mapeo: diaId ? GYMAPP.planes.sugerirMapeoEjercicios(data, sesion, planId, diaId) : {}, intento: false
    };
    pintarReasignacion(container, "reasig-plan");
  }

  function cerrarReasignacion(container) {
    reasignacion = null;
    var destino = container.querySelector("#entrenar-modal");
    if (destino) destino.parentNode.removeChild(destino);
    document.body.classList.remove("modal-abierto");
    var boton = container.querySelector('[data-accion="reasignar-sesion"]');
    if (boton) boton.focus();
  }

  /* Re-dibuja solo el panel (sin tocar el formulario de edición). */
  function pintarReasignacion(container, focoId) {
    var destino = container.querySelector("#entrenar-modal");
    if (!destino) {
      var pantalla = container.querySelector(".pantalla-entrenar");
      if (!pantalla) return;
      destino = document.createElement("div");
      destino.id = "entrenar-modal";
      pantalla.appendChild(destino);
    }
    var modal = destino.querySelector(".modal");
    var scroll = modal ? modal.scrollTop : 0;
    destino.innerHTML = renderModalReasignacion(GYMAPP.storage.getData());
    document.body.classList.add("modal-abierto");
    var nuevo = destino.querySelector(".modal");
    if (nuevo) nuevo.scrollTop = scroll;
    var foco = focoId ? destino.querySelector("#" + focoId) : nuevo;
    if (foco) foco.focus({ preventScroll: !!modal });
  }

  function cambiarReasignacion(container, target) {
    var data = GYMAPP.storage.getData();
    var sesion = data.sesiones_entrenamiento.filter(function (s) { return s.id === reasignacion.sesionId; })[0];
    if (!sesion) return;
    if (target.id === "reasig-plan") {
      reasignacion.planId = target.value;
      reasignacion.diaId = GYMAPP.planes.sugerirDiaDestino(data, sesion, reasignacion.planId);
      reasignacion.mapeo = reasignacion.diaId ? GYMAPP.planes.sugerirMapeoEjercicios(data, sesion, reasignacion.planId, reasignacion.diaId) : {};
    } else if (target.id === "reasig-dia") {
      reasignacion.diaId = target.value || null;
      reasignacion.mapeo = reasignacion.diaId ? GYMAPP.planes.sugerirMapeoEjercicios(data, sesion, reasignacion.planId, reasignacion.diaId) : {};
    } else if (target.dataset.reasigOrig !== undefined) {
      reasignacion.mapeo[target.dataset.reasigOrig] = target.value;
    } else {
      return;
    }
    pintarReasignacion(container, target.id);
  }

  function renderModalReasignacion(data) {
    var esc = GYMAPP.util.escapeHtml;
    var r = reasignacion;
    var sesion = data.sesiones_entrenamiento.filter(function (s) { return s.id === r.sesionId; })[0];
    if (!sesion) return "";
    var opciones = GYMAPP.planes.planesParaReasignar(data);
    var plan = GYMAPP.planes.buscarPlan(data, r.planId);
    var dia = plan && r.diaId ? plan.dias.filter(function (d) { return d.id === r.diaId; })[0] : null;
    var errores = GYMAPP.planes.validarReasignacion(data, sesion.id, { planId: r.planId, diaId: r.diaId, mapeo: r.mapeo });
    /* Duplicados y "no corresponde" se marcan siempre; lo que falta elegir,
       recién al intentar confirmar. */
    var visibles = errores.filter(function (e) { return r.intento || /ya está asignado|No corresponde|todos los ejercicios/.test(e.mensaje); });
    var errorDe = function (orig) { return visibles.filter(function (e) { return e.ejercicio_id === orig; })[0] || null; };
    var planOrigen = sesion.plan_id ? GYMAPP.planes.buscarPlan(data, sesion.plan_id) : null;
    var activoId = data.rutina.plan_activo_id;
    var vinculados = (sesion.ejercicios_realizados || []).filter(function (er) {
      return !errores.some(function (e) { return e.ejercicio_id === er.ejercicio_id; }) && r.mapeo[er.ejercicio_id];
    }).length;
    var total = (sesion.ejercicios_realizados || []).length;

    var ejercicios = (sesion.ejercicios_realizados || []).map(function (er, i) {
      var resuelto = GYMAPP.rutinasHistoricas.resolverEjercicioDeSesion(data, sesion, er);
      var nombre = resuelto ? resuelto.nombre : "Ejercicio sin nombre";
      var id = "reasig-ej-" + i;
      var error = errorDe(er.ejercicio_id);
      var elegido = r.mapeo[er.ejercicio_id] || "";
      var series = (er.series || []).length;
      return (
        '<div class="reasig-ejercicio">' +
        '<p class="reasig-origen"><span class="nota">Ejercicio registrado</span><br>' + esc(nombre) +
        ' <span class="nota">· ' + series + (series === 1 ? " serie" : " series") + "</span></p>" +
        '<label for="' + id + '">Ejercicio destino</label>' +
        '<select id="' + id + '" data-reasig-orig="' + escaparAtributo(er.ejercicio_id) + '"' +
        (error ? ' aria-invalid="true" aria-describedby="' + id + '-error"' : "") + ">" +
        '<option value=""' + (elegido ? "" : " selected") + ">Elegí el ejercicio correspondiente</option>" +
        (dia ? dia.ejercicios.map(function (e) {
          return '<option value="' + escaparAtributo(e.id) + '"' + (elegido === e.id ? " selected" : "") + ">" + esc(e.nombre || "(sin nombre)") + "</option>";
        }).join("") : "") +
        '<option value="' + GYMAPP.planes.SIN_CORRESPONDENCIA + '"' + (elegido === GYMAPP.planes.SIN_CORRESPONDENCIA ? " selected" : "") + ">No corresponde a ningún ejercicio</option>" +
        "</select>" +
        '<p id="' + id + '-error" class="campo-error-texto' + (error ? "" : " oculto") + '">' + (error ? esc(error.mensaje) : "") + "</p>" +
        "</div>"
      );
    }).join("");

    var generales = visibles.filter(function (e) { return e.ejercicio_id === null; });
    return (
      '<div class="modal-fondo">' +
      '<div class="modal modal-reasignar" role="dialog" aria-modal="true" aria-labelledby="reasig-titulo" tabindex="-1">' +
      '<div class="modal-header"><h3 id="reasig-titulo">Reasignar sesión</h3>' +
      '<button type="button" data-accion="reasig-cancelar" class="btn-icono" aria-label="Cerrar">✕</button></div>' +
      '<div class="modal-cuerpo">' +
      '<p class="nota">Vinculá esta sesión con el plan y el día que realmente entrenaste. Se reasigna la sesión tal como está guardada.</p>' +
      '<div class="campo"><label for="reasig-plan">Plan</label><select id="reasig-plan">' +
      opciones.map(function (o) {
        return '<option value="' + escaparAtributo(o.plan.plan_id) + '"' + (o.plan.plan_id === r.planId ? " selected" : "") + ">" + esc(nombrePlanReasignar(o.plan, o.activo)) + "</option>";
      }).join("") + "</select></div>" +
      '<div class="campo"><label for="reasig-dia">Día</label><select id="reasig-dia">' +
      '<option value=""' + (r.diaId ? "" : " selected") + ">Elegí un día</option>" +
      (plan ? plan.dias.map(function (d) {
        return '<option value="' + escaparAtributo(d.id) + '"' + (d.id === r.diaId ? " selected" : "") + ">" + esc(d.nombre || "(sin nombre)") + "</option>";
      }).join("") : "") + "</select></div>" +
      (dia ? '<h4 class="reasig-subtitulo">Ejercicios</h4>' + (ejercicios || '<p class="nota">Esta sesión no tiene ejercicios registrados.</p>') : "") +
      '<section class="rev-resumen reasig-resumen" aria-labelledby="reasig-resumen-titulo">' +
      '<h4 id="reasig-resumen-titulo">Resumen</h4>' +
      "<p><strong>De:</strong> " + esc(planOrigen ? nombrePlanReasignar(planOrigen, planOrigen.plan_id === activoId) : "Sin plan registrado") +
      " · " + esc(GYMAPP.rutinasHistoricas.resolverNombreDiaDeSesion(data, sesion)) + "</p>" +
      "<p><strong>A:</strong> " + esc(plan ? nombrePlanReasignar(plan, plan.plan_id === activoId) : "—") + " · " + esc(dia ? dia.nombre : "—") + "</p>" +
      "<p><strong>Ejercicios:</strong> " + vinculados + " de " + total + " vinculados</p>" +
      '<p class="nota">Tus pesos, repeticiones y demás datos de ejecución no se modificarán.</p>' +
      '<div id="reasig-errores" class="mensaje error' + (generales.length ? "" : " oculto") + '" role="alert">' +
      esc(generales.map(function (e) { return e.mensaje; }).join(" ")) + "</div>" +
      '<div class="modal-acciones">' +
      '<button type="button" data-accion="reasig-cancelar" class="btn-secundario">Cancelar</button>' +
      '<button type="button" data-accion="reasig-confirmar" class="btn-secundario btn-guardar-plan">Confirmar reasignación</button>' +
      "</div></section>" +
      "</div></div></div>"
    );
  }

  /* Validación → todo en memoria → copia previa → un único guardado. */
  function confirmarReasignacion(container) {
    var r = reasignacion;
    r.intento = true;
    var data = GYMAPP.storage.getData();
    var preparado = GYMAPP.planes.prepararReasignacionSesion(data, r.sesionId, { planId: r.planId, diaId: r.diaId, mapeo: r.mapeo });
    if (!preparado.ok) {
      pintarReasignacion(container, "reasig-errores");
      var primero = container.querySelector('#entrenar-modal [aria-invalid="true"]');
      if (primero) primero.focus();
      var errorEl = container.querySelector("#reasig-errores");
      if (errorEl && errorEl.classList.contains("oculto")) {
        errorEl.textContent = preparado.error;
        errorEl.className = "mensaje error";
      }
      return;
    }
    var ahora = new Date().toISOString();
    var guardado = GYMAPP.storage.guardarConCopiaPrevia(CLAVE_PRE_REASIGNAR, preparado.datos, ahora, { sesion_id: r.sesionId });
    if (!guardado.ok) {
      var el = container.querySelector("#reasig-errores");
      if (el) {
        el.textContent = guardado.motivo === "copia"
          ? "No se pudo crear la copia de seguridad previa. No se cambió nada."
          : "No se pudo guardar la reasignación. Tus datos anteriores se conservan intactos.";
        el.className = "mensaje error";
      }
      return;
    }
    var nuevos = GYMAPP.storage.getData();
    var plan = GYMAPP.planes.buscarPlan(nuevos, r.planId);
    var dia = plan.dias.filter(function (d) { return d.id === r.diaId; })[0];
    reasignacion = null;
    document.body.classList.remove("modal-abierto");
    estado = estadoInicial();
    render(container);
    mostrarMensaje(container, "Sesión reasignada a " + nombrePlanReasignar(plan, plan.plan_id === nuevos.rutina.plan_activo_id) + " · " + dia.nombre + ". Tus datos de ejecución no cambiaron.", "exito");
  }

  function mostrarMensaje(container, texto, tipo) {
    var el = container.querySelector("#entrenar-mensaje");
    if (!el) return;
    el.textContent = texto;
    el.className = "mensaje " + (tipo || "info");
  }

  function construirEjerciciosRealizados(dia) {
    var resultado = [];
    dia.ejercicios.forEach(function (ej) {
      var seriesValidas = (estado.seriesPorEjercicio[ej.id] || [])
        .filter(function (s) { return s.peso_kg !== "" || s.reps !== ""; })
        .map(function (s) {
          return { peso_kg: parseFloat(s.peso_kg) || 0, reps: parseInt(s.reps, 10) || 0 };
        });
      if (seriesValidas.length) {
        resultado.push({ ejercicio_id: ej.id, series: seriesValidas });
      }
    });
    return resultado;
  }

  /* Igual que construirEjerciciosRealizados, pero recorriendo los ejercicios
     que ya tenía la sesión (estado.ejerciciosHistoricos) en vez de los de un
     día de rutina. Se usa al editar, para no depender de que el día o los
     ejercicios sigan existiendo en la rutina actual. */
  function construirEjerciciosRealizadosDesdeHistorico(ejerciciosHistoricos) {
    var resultado = [];
    ejerciciosHistoricos.forEach(function (eh) {
      var seriesValidas = (estado.seriesPorEjercicio[eh.ejercicio_id] || [])
        .filter(function (s) { return s.peso_kg !== "" || s.reps !== ""; })
        .map(function (s) {
          return { peso_kg: parseFloat(s.peso_kg) || 0, reps: parseInt(s.reps, 10) || 0 };
        });
      if (seriesValidas.length) {
        resultado.push({ ejercicio_id: eh.ejercicio_id, series: seriesValidas });
      }
    });
    return resultado;
  }

  function construirFechaSesion(fechaSeleccionada) {
    if (fechaSeleccionada === fechaHoyISO()) {
      return new Date().toISOString();
    }
    return new Date(fechaSeleccionada + "T12:00:00").toISOString();
  }

  function guardarSesion(container) {
    if (!estado.fecha) {
      mostrarMensaje(container, "Elegí la fecha de la sesión.", "error");
      return;
    }

    if (estado.fecha > fechaHoyISO()) {
      mostrarMensaje(container, "No podés cargar una sesión con fecha futura.", "error");
      return;
    }

    if (!estado.rpe) {
      mostrarMensaje(container, "Seleccioná el RPE de la sesión antes de guardar.", "error");
      return;
    }

    var duracion = parseInt(estado.duracion_min, 10);
    if (isNaN(duracion) || duracion <= 0) {
      mostrarMensaje(container, "Ingresá la duración de la sesión en minutos.", "error");
      return;
    }

    var esEdicion = !!estado.editandoId;
    var data = GYMAPP.storage.getData();
    var sesionOriginal = null;

    if (esEdicion) {
      sesionOriginal = data.sesiones_entrenamiento.filter(function (s) { return s.id === estado.editandoId; })[0] || null;
      if (!sesionOriginal) {
        mostrarMensaje(container, "Esta sesión ya no existe (puede haber sido eliminada). Cancelá la edición e intentá de nuevo.", "error");
        return;
      }
    } else {
      /* No se puede iniciar una sesión nueva de una actividad que ya no está
         configurada (el selector ya no la ofrece, esto es un resguardo por
         si el estado quedó desactualizado, ej. la desactivó en otra pestaña). */
      var actividadesUsuario = GYMAPP.actividades.obtenerActividadesUsuario(data.usuario);
      var estaConfigurada = actividadesUsuario.some(function (a) { return a.tipo === estado.tipo; });
      if (!estaConfigurada) {
        mostrarMensaje(container, "Esa actividad ya no está configurada. Elegí una actividad configurada en Rutina antes de guardar.", "error");
        return;
      }
    }

    var sesion = {
      id: esEdicion ? sesionOriginal.id : GYMAPP.util.generarId(),
      fecha: construirFechaSesion(estado.fecha),
      tipo: estado.tipo,
      dia_rutina_id: null,
      duracion_min: duracion,
      rpe: estado.rpe,
      notas: estado.notas,
      ejercicios_realizados: [],
      futbol_detalle: null
    };

    if (estado.tipo === "gimnasio") {
      var ejerciciosRealizados;

      if (esEdicion) {
        /* Edición de una sesión histórica: se conservan exactamente el día y
           los ejercicios con los que se registró originalmente, sin volver a
           mirar la rutina actual. Solo se editan las series (peso/reps) de
           esos ejercicios. Esto es lo que permite editar sesiones aunque el
           día o el ejercicio ya no existan en la rutina. */
        ejerciciosRealizados = construirEjerciciosRealizadosDesdeHistorico(estado.ejerciciosHistoricos);
        sesion.dia_rutina_id = sesionOriginal.dia_rutina_id;
      } else {
        if (!estado.diaRutinaId) {
          mostrarMensaje(container, "Elegí un día de rutina antes de guardar.", "error");
          return;
        }
        var dia = GYMAPP.planes.buscarDiaActivo(data, estado.diaRutinaId);
        if (!dia) {
          mostrarMensaje(container, "El día seleccionado ya no existe en tu rutina.", "error");
          return;
        }
        ejerciciosRealizados = construirEjerciciosRealizados(dia);
        sesion.dia_rutina_id = estado.diaRutinaId;
      }

      if (!ejerciciosRealizados.length) {
        mostrarMensaje(container, "Cargá al menos una serie antes de guardar.", "error");
        return;
      }
      sesion.ejercicios_realizados = ejerciciosRealizados;

      if (esEdicion) {
        /* E5: la edición conserva plan_id y los prescripcion_snapshot
           originales (nunca se regeneran desde el plan actual). */
        sesion = GYMAPP.planes.conservarVinculoPlan(sesionOriginal, sesion);
      } else {
        /* E5: sesión nueva → plan_id del plan activo y snapshot de la
           prescripción de cada ejercicio, validados y armados ANTES del
           único guardado (la sesión se persiste completa o no se persiste). */
        var vinculo = GYMAPP.planes.vincularSesionAlPlanActivo(data, sesion);
        if (!vinculo.ok) {
          mostrarMensaje(container, vinculo.error, "error");
          return;
        }
        sesion = vinculo.sesion;
      }
    } else if (estado.tipo === "natacion") {
      var distanciaValor = null;
      if (estado.detalle.distancia_m !== "") {
        var distanciaNum = parseFloat(estado.detalle.distancia_m);
        if (isNaN(distanciaNum) || distanciaNum <= 0) {
          mostrarMensaje(container, "La distancia debe ser un número mayor a 0, o dejala vacía.", "error");
          return;
        }
        distanciaValor = distanciaNum;
      }
      sesion.detalle = { distancia_m: distanciaValor, estilo: estado.detalle.estilo || "" };
    } else {
      /* Fútbol/básquet/pádel/tenis (y cualquier deporte nuevo con la misma
         forma): arma detalle solo con los campos que le corresponden según
         el catálogo, nunca con los 5 campos de estado.detalle completos. */
      var actividad = GYMAPP.actividades.obtenerActividadPorId(estado.tipo);
      var campos = (actividad && actividad.campos) || [];
      var detalleNuevo = {};
      if (campos.indexOf("tipoSesion") !== -1) detalleNuevo.tipo_sesion = estado.detalle.tipo_sesion || "entrenamiento";
      if (campos.indexOf("posicion") !== -1) detalleNuevo.posicion = estado.detalle.posicion || "";
      if (campos.indexOf("minutosJugados") !== -1) detalleNuevo.minutos_jugados = parseInt(estado.detalle.minutos_jugados, 10) || 0;

      if (estado.tipo === "futbol" && esEdicion && sesionOriginal.futbol_detalle && !sesionOriginal.detalle) {
        /* Sesión histórica de fútbol que todavía guarda el detalle en
           futbol_detalle (ACT-01, antes de que existiera sesion.detalle):
           la opción de menor riesgo es seguir actualizando ese mismo campo
           en vez de migrarla a "detalle" recién en esta edición puntual.
           Así ningún consumidor existente de futbol_detalle (incluida esta
           misma pantalla, vía obtenerDetalleSesion) puede quedar con datos
           inconsistentes, y no hay que demostrar que ningún otro lugar de
           la app asuma ese campo. Las sesiones NUEVAS de fútbol, en cambio,
           siempre usan "detalle" (nunca crean futbol_detalle nuevo). */
        sesion.futbol_detalle = {
          tipo: detalleNuevo.tipo_sesion,
          posicion: detalleNuevo.posicion,
          minutos_jugados: detalleNuevo.minutos_jugados
        };
      } else {
        sesion.detalle = detalleNuevo;
      }
    }

    var resultado = GYMAPP.storage.updateData(function (d) {
      if (esEdicion) {
        var indice = d.sesiones_entrenamiento.findIndex(function (s) { return s.id === sesion.id; });
        if (indice === -1) d.sesiones_entrenamiento.push(sesion);
        else d.sesiones_entrenamiento[indice] = sesion;
      } else {
        d.sesiones_entrenamiento.push(sesion);
      }
    }, { alertaAutomatica: false });
    if (!resultado.guardado) {
      mostrarMensaje(container, "No se pudo guardar la sesión. Revisá el espacio disponible en tu dispositivo e intentá de nuevo.", "error");
      return;
    }

    estado = estadoInicial();
    render(container);
    mostrarMensaje(container, esEdicion ? "Cambios guardados." : "Sesión guardada. ¡Buen trabajo!", "exito");
  }

  return {
    render: render,
    /* Expuesta para pruebas del historial de sesiones (solo arma HTML). */
    renderHistorial: renderHistorial
  };
})();
