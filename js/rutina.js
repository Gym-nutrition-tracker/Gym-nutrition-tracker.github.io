/* Pestaña Rutina: plantilla editable de días/ejercicios. Nunca toca sesiones_entrenamiento. */
var GYMAPP = window.GYMAPP || (window.GYMAPP = {});

GYMAPP.rutina = (function () {
  var GRUPOS_MUSCULARES = ["Pecho", "Espalda", "Pierna", "Hombro", "Bíceps", "Tríceps", "Glúteo", "Core", "Cardio"];

  function render(container) {
    var data = GYMAPP.storage.getData();
    cerrarModal(container, { sinFoco: true });
    container.innerHTML = template(data, hoyISO());
    if (!container.dataset.rutinaBound) {
      bindEventos(container);
      container.dataset.rutinaBound = "1";
    }
    /* PROFILE-01: completa la foto de Cuenta cuando llega su URL. */
    if (GYMAPP.perfilFoto) GYMAPP.perfilFoto.hidratar(container);
    /* E6: una revisión de PDF en curso sobrevive a un re-render. */
    if (importacion) abrirModal(container, renderRevisionPlan(data, importacion.borrador));
  }

  function hoyISO() {
    return GYMAPP.util.fechaLocalISO(new Date());
  }

  function template(data, hoy) {
    var dias = GYMAPP.planes.diasDelPlanActivo(data);
    var usuario = data.usuario;
    var listaDias = dias.length
      ? dias.map(renderDia).join("")
      : renderEstadoVacio();

    return (
      '<div class="pantalla pantalla-rutina">' +
      '<div class="rutina-header">' +
      "<h2>Rutina</h2>" +
      '<div class="rutina-acciones">' +
      '<button type="button" data-accion="importar-pdf" class="btn btn-secundario">📄 Importar PDF</button>' +
      '<input type="file" id="input-pdf-rutina" accept="application/pdf" style="display:none" />' +
      '<button type="button" data-accion="nuevo-dia" class="btn btn-secundario">+ Nuevo día</button>' +
      "</div>" +
      "</div>" +
      '<div id="rutina-mensaje" class="mensaje oculto"></div>' +
      renderTarjetaPlanActivo(data, hoy) +
      '<div class="rutina-dias">' + listaDias + "</div>" +
      '<datalist id="grupos-musculares">' +
      GRUPOS_MUSCULARES.map(function (g) { return '<option value="' + g + '"></option>'; }).join("") +
      "</datalist>" +
      renderSeccionActividades(usuario) +
      (GYMAPP.auth ? GYMAPP.auth.renderSeccionCuenta() : "") +
      (GYMAPP.sync ? GYMAPP.sync.renderSeccionSincronizacion() : "") +
      renderSeccionAyuda() +
      renderSeccionBackup() +
      '<div id="rutina-modal"></div>' +
      "</div>"
    );
  }

  /* --- E4: plan activo e historial de planes ---
     Solo presentación: nada de esto escribe datos salvo "Guardar" en Editar
     plan, que pasa por GYMAPP.planes.actualizarMetadataPlanActivo dentro de
     storage.updateData. Los planes históricos son de solo lectura. */

  var NOMBRE_PLAN_ACTIVO_DEFAULT = "Plan actual";
  var NOMBRE_PLAN_SIN_NOMBRE = "Plan sin nombre";
  var ORIGENES = { legacy: "Histórico", migracion: "Migrado de la versión anterior", pdf: "Importado de PDF" };

  /* "YYYY-MM-DD" → "DD/MM/YYYY" (sin Date: no hay corrimiento de zona). */
  function formatearFecha(iso) {
    if (!GYMAPP.planes.esFechaValida(iso)) return null;
    var p = iso.split("-");
    return p[2] + "/" + p[1] + "/" + p[0];
  }

  /* escapeHtml no escapa comillas (usa innerHTML); dentro de un atributo
     hace falta. */
  function escaparAtributo(v) {
    return GYMAPP.util.escapeHtml(v).replace(/"/g, "&quot;");
  }

  function nombrePlan(plan, porDefecto) {
    return plan && typeof plan.nombre === "string" && plan.nombre.trim() ? plan.nombre.trim() : porDefecto;
  }

  function textoVigencia(plan) {
    var inicio = formatearFecha(plan && plan.fecha_inicio);
    var fin = formatearFecha(plan && plan.fecha_fin);
    if (inicio && fin) return inicio + " – " + fin;
    if (inicio) return "Desde " + inicio;
    if (fin) return "Hasta " + fin;
    return "Sin fechas definidas";
  }

  /* Línea informativa de semana/estado (no se usa en PROG-04). */
  function textoEstadoTemporal(plan, hoy) {
    var t = GYMAPP.planes.calcularEstadoTemporalPlan(plan, hoy);
    if (t.estado === "futuro") return "Comienza el " + formatearFecha(plan.fecha_inicio);
    if (t.estado === "finalizado") return "Plan finalizado";
    if (t.estado === "vigente" && t.semana_actual !== null) {
      return "Semana " + t.semana_actual + (t.semanas_totales !== null ? " de " + t.semanas_totales : "");
    }
    return null;
  }

  function renderTarjetaPlanActivo(data, hoy) {
    var plan = GYMAPP.planes.planActivo(data);
    if (!plan) return "";
    var estado = textoEstadoTemporal(plan, hoy);
    var esc = GYMAPP.util.escapeHtml;
    return (
      '<section class="plan-activo-card" aria-labelledby="plan-activo-nombre">' +
      '<p class="plan-etiqueta">Plan activo</p>' +
      '<h3 id="plan-activo-nombre" class="plan-nombre">' + esc(nombrePlan(plan, NOMBRE_PLAN_ACTIVO_DEFAULT)) + "</h3>" +
      '<p class="plan-vigencia">' + esc(textoVigencia(plan)) + "</p>" +
      (estado ? '<p class="plan-semana">' + esc(estado) + "</p>" : "") +
      '<div class="plan-acciones">' +
      '<button type="button" data-accion="editar-plan" class="btn-secundario">Editar plan</button>' +
      '<button type="button" data-accion="historial-planes" class="btn-secundario">Historial de planes</button>' +
      "</div>" +
      /* Sin días se muestra el estado vacío con su propio "Cargar mi plan":
         una sola acción principal. */
      (plan.dias && plan.dias.length
        ? '<button type="button" data-accion="cargar-plan" class="btn btn-primario plan-cargar">Cargar / cambiar plan</button>'
        : "") +
      "</section>"
    );
  }

  function envolverModal(titulo, cuerpo, clase) {
    return (
      '<div class="modal-fondo">' +
      '<div class="modal' + (clase ? " " + clase : "") + '" role="dialog" aria-modal="true" aria-labelledby="modal-titulo" tabindex="-1">' +
      '<div class="modal-header">' +
      '<h3 id="modal-titulo">' + GYMAPP.util.escapeHtml(titulo) + "</h3>" +
      '<button type="button" data-accion="cerrar-modal" class="btn-icono" aria-label="Cerrar">✕</button>' +
      "</div>" +
      '<div class="modal-cuerpo">' + cuerpo + "</div>" +
      "</div>" +
      "</div>"
    );
  }

  function renderModalEditarPlan(data) {
    var plan = GYMAPP.planes.planActivo(data);
    var esc = GYMAPP.util.escapeHtml;
    var valor = function (v) { return escaparAtributo(typeof v === "string" ? v : ""); };
    return envolverModal("Editar plan",
      '<form id="form-editar-plan" class="form-plan" novalidate>' +
      '<div class="campo"><label for="plan-nombre">Nombre del plan</label>' +
      '<input id="plan-nombre" name="nombre" type="text" maxlength="80" autocomplete="off" placeholder="' + NOMBRE_PLAN_ACTIVO_DEFAULT + '" value="' + valor(plan.nombre) + '" /></div>' +
      '<div class="campo"><label for="plan-fecha-inicio">Fecha de inicio</label>' +
      '<input id="plan-fecha-inicio" name="fecha_inicio" type="date" value="' + valor(plan.fecha_inicio) + '" /></div>' +
      '<div class="campo"><label for="plan-fecha-fin">Fecha de fin</label>' +
      '<input id="plan-fecha-fin" name="fecha_fin" type="date" value="' + valor(plan.fecha_fin) + '" /></div>' +
      '<p class="nota">Todos los campos son opcionales. Acá solo se cambian el nombre y las fechas; los días y ejercicios se editan en la rutina.</p>' +
      '<div id="plan-form-error" class="mensaje error oculto" role="alert"></div>' +
      '<div class="modal-acciones">' +
      '<button type="button" data-accion="cerrar-modal" class="btn-secundario">Cancelar</button>' +
      '<button type="submit" class="btn-secundario btn-guardar-plan">Guardar</button>' +
      "</div>" +
      "</form>");
  }

  function contarEjercicios(plan) {
    return plan.dias.reduce(function (n, d) { return n + ((d && d.ejercicios) || []).length; }, 0);
  }

  function plural(n, uno, varios) {
    return n + " " + (n === 1 ? uno : varios);
  }

  function renderModalHistorialPlanes(data) {
    var esc = GYMAPP.util.escapeHtml;
    var planes = GYMAPP.planes.planesHistoricos(data);
    var cuerpo = planes.length ? planes.map(function (plan) {
      var sesiones = GYMAPP.planes.cantidadSesionesPlan(data, plan.plan_id);
      var rango = GYMAPP.planes.rangoObservadoPlan(data, plan.plan_id);
      return (
        '<div class="plan-historico-card">' +
        '<p class="plan-nombre">' + esc(nombrePlan(plan, NOMBRE_PLAN_SIN_NOMBRE)) + "</p>" +
        '<p class="nota">Origen: ' + esc(ORIGENES[plan.origen] || "Histórico") + "</p>" +
        '<p class="nota">' + esc(textoVigencia(plan)) + "</p>" +
        '<p class="nota">' + plural(plan.dias.length, "día", "días") + " · " + plural(contarEjercicios(plan), "ejercicio", "ejercicios") +
        " · " + plural(sesiones, "sesión registrada", "sesiones registradas") + "</p>" +
        (rango ? '<p class="nota plan-actividad">Actividad observada: ' + formatearFecha(rango.desde) + " – " + formatearFecha(rango.hasta) + "</p>" : "") +
        '<button type="button" data-accion="ver-plan" data-plan-id="' + escaparAtributo(plan.plan_id) + '" class="btn-secundario">Ver</button>' +
        "</div>"
      );
    }).join("") : '<p class="nota">Todavía no hay planes anteriores.</p>';
    return envolverModal("Historial de planes",
      '<p class="nota">Planes anteriores, solo para consulta. No se pueden editar ni volver a usar para entrenar.</p>' + cuerpo);
  }

  function textoPrescripcion(ej) {
    var series = ej.series_objetivo !== null && ej.series_objetivo !== undefined && ej.series_objetivo !== "" ? String(ej.series_objetivo) : "";
    var reps = ej.reps_objetivo !== null && ej.reps_objetivo !== undefined ? String(ej.reps_objetivo) : "";
    if (series && reps) return series + " × " + reps;
    if (series) return series + " series";
    return reps;
  }

  function renderModalDetallePlan(data, planId) {
    var esc = GYMAPP.util.escapeHtml;
    var plan = GYMAPP.planes.buscarPlan(data, planId);
    if (!plan || planId === data.rutina.plan_activo_id) return renderModalHistorialPlanes(data);
    var dias = plan.dias.map(function (dia) {
      var ejercicios = (dia.ejercicios || []).map(function (ej) {
        var prescripcion = textoPrescripcion(ej);
        return (
          '<li class="plan-ejercicio">' +
          '<span class="plan-ejercicio-nombre">' + esc(ej.nombre || "(sin nombre)") + "</span>" +
          (prescripcion ? '<span class="plan-ejercicio-dato">' + esc(prescripcion) + "</span>" : "") +
          (ej.grupo_muscular ? '<span class="plan-ejercicio-dato">' + esc(ej.grupo_muscular) + "</span>" : "") +
          "</li>"
        );
      }).join("");
      return (
        '<details class="plan-dia">' +
        "<summary>" + esc(dia.nombre || "(sin nombre)") + ' <span class="nota">· ' + plural((dia.ejercicios || []).length, "ejercicio", "ejercicios") + "</span></summary>" +
        '<ul class="plan-ejercicios">' + ejercicios + "</ul>" +
        "</details>"
      );
    }).join("");
    return envolverModal(nombrePlan(plan, NOMBRE_PLAN_SIN_NOMBRE),
      '<button type="button" data-accion="historial-planes" class="btn-enlace">← Historial de planes</button>' +
      '<p class="nota">' + esc(textoVigencia(plan)) + " · Solo lectura</p>" +
      dias);
  }

  /* Abre (o reemplaza) el modal. `disparador` recibe el foco al cerrar. */
  function abrirModal(container, html, disparador, opciones) {
    var destino = container.querySelector("#rutina-modal");
    if (!destino) return;
    if (!destino.innerHTML && disparador) destino.dataset.disparador = disparador;
    destino.innerHTML = html;
    document.body.classList.add("modal-abierto");
    if (opciones && opciones.sinFoco) return;
    var foco = destino.querySelector("input") || destino.querySelector(".modal");
    if (foco) foco.focus();
  }

  function cerrarModal(container, opciones) {
    var destino = container.querySelector("#rutina-modal");
    if (document.body) document.body.classList.remove("modal-abierto");
    if (!destino || !destino.innerHTML) return;
    var disparador = destino.dataset.disparador;
    destino.innerHTML = "";
    delete destino.dataset.disparador;
    if (!(opciones && opciones.sinFoco) && disparador) {
      var boton = container.querySelector('[data-accion="' + disparador + '"]');
      if (boton) boton.focus();
    }
  }

  function guardarMetadataPlan(container, form) {
    var errorEl = form.querySelector("#plan-form-error");
    var v = GYMAPP.planes.validarMetadataPlan({
      nombre: form.querySelector("#plan-nombre").value,
      fecha_inicio: form.querySelector("#plan-fecha-inicio").value,
      fecha_fin: form.querySelector("#plan-fecha-fin").value
    });
    if (!v.ok) {
      mostrarMensajeEn(errorEl, v.error, "error");
      return;
    }
    var actual = GYMAPP.planes.planActivo(GYMAPP.storage.getData());
    var sinCambios = ["nombre", "fecha_inicio", "fecha_fin"].every(function (k) { return (actual[k] === undefined ? null : actual[k]) === v.valores[k]; });
    if (sinCambios) {
      cerrarModal(container);
      return;
    }
    var resultado = GYMAPP.storage.updateData(function (data) {
      GYMAPP.planes.actualizarMetadataPlanActivo(data, v.valores);
    }, { alertaAutomatica: false });
    if (!resultado.guardado) {
      mostrarMensajeEn(errorEl, MENSAJE_ERROR_GUARDADO, "error");
      return;
    }
    render(container);
    mostrarMensaje(container, "Plan actualizado.", "exito");
    var boton = container.querySelector('[data-accion="editar-plan"]');
    if (boton) boton.focus();
  }

  /* ACT-02: sección "Actividades y metas" para usuarios existentes. Permite
     agregar/quitar actividades y modificar su meta semanal marcando o
     desmarcando cada fila, reutilizando el mismo catálogo y helpers de
     GYMAPP.actividades que usa el onboarding. Desactivar una actividad acá
     solo saca su entrada de usuario.actividades: nunca toca la rutina (planes),
     sesiones_entrenamiento, nutrición ni medidas_corporales. */
  function renderSeccionActividades(usuario) {
    var actividadesUsuario = GYMAPP.actividades.obtenerActividadesUsuario(usuario);
    return (
      '<div class="seccion-actividades">' +
      "<h3>Actividades y metas</h3>" +
      '<p class="nota">Elegí qué actividades practicás y tu meta de días por semana para cada una. Desactivar una actividad no borra las sesiones ya guardadas.</p>' +
      '<div id="actividades-mensaje" class="mensaje oculto"></div>' +
      '<div class="lista-actividades" id="lista-actividades-usuario">' +
      GYMAPP.actividades.renderListaActividades(actividadesUsuario, "rutina-act") +
      "</div>" +
      "</div>"
    );
  }

  function renderSeccionBackup() {
    return (
      '<div class="seccion-backup">' +
      "<h3>Copia de seguridad</h3>" +
      '<p class="nota">Todos tus datos se guardan solo en este dispositivo. Exportalos para tener un respaldo o pasarlos a otro celular.</p>' +
      '<div class="backup-acciones">' +
      '<button type="button" data-accion="exportar-backup" class="btn btn-secundario">⬇️ Exportar datos</button>' +
      '<button type="button" data-accion="importar-backup" class="btn btn-secundario">⬆️ Importar datos</button>' +
      '<input type="file" id="input-backup" accept="application/json,.json" style="display:none" />' +
      "</div>" +
      "</div>"
    );
  }

  function renderDia(dia) {
    var listaEjercicios = dia.ejercicios.length
      ? dia.ejercicios.map(function (ej) { return renderEjercicio(dia.id, ej); }).join("")
      : '<p class="nota nota-dia">Sin ejercicios todavía.</p>';

    return (
      '<div class="dia-card" data-dia-id="' + dia.id + '">' +
      '<div class="dia-card-header">' +
      '<input type="text" class="input-nombre-dia" data-campo="nombre" value="' + GYMAPP.util.escapeHtml(dia.nombre) + '" placeholder="Nombre del día" />' +
      '<button type="button" data-accion="borrar-dia" data-dia-id="' + dia.id + '" class="btn-icono btn-borrar" aria-label="Borrar día">🗑️</button>' +
      "</div>" +
      '<div class="ejercicios-lista">' + listaEjercicios + "</div>" +
      '<button type="button" data-accion="nuevo-ejercicio" data-dia-id="' + dia.id + '" class="btn btn-agregar-ejercicio">+ Agregar ejercicio</button>' +
      "</div>"
    );
  }

  function renderEjercicio(diaId, ej) {
    return (
      '<div class="ejercicio-row" data-dia-id="' + diaId + '" data-ejercicio-id="' + ej.id + '">' +
      '<input type="text" class="input-ejercicio-nombre" data-campo="nombre" value="' + GYMAPP.util.escapeHtml(ej.nombre) + '" placeholder="Ejercicio" />' +
      '<input type="text" class="input-ejercicio-grupo" data-campo="grupo_muscular" value="' + GYMAPP.util.escapeHtml(ej.grupo_muscular || "") + '" placeholder="Grupo muscular" list="grupos-musculares" />' +
      '<input type="number" class="input-ejercicio-series" data-campo="series_objetivo" value="' + ej.series_objetivo + '" min="1" max="20" placeholder="Series" />' +
      '<input type="text" class="input-ejercicio-reps" data-campo="reps_objetivo" value="' + GYMAPP.util.escapeHtml(ej.reps_objetivo) + '" placeholder="Reps" />' +
      '<button type="button" data-accion="borrar-ejercicio" data-dia-id="' + diaId + '" data-ejercicio-id="' + ej.id + '" class="btn-icono btn-borrar" aria-label="Borrar ejercicio">✕</button>' +
      "</div>"
    );
  }

  function bindEventos(container) {
    container.addEventListener("click", function (ev) {
      if (ev.target.classList && ev.target.classList.contains("modal-fondo")) {
        solicitarCerrarModal(container);
        return;
      }
      var boton = ev.target.closest("[data-accion]");
      if (!boton) return;
      var accion = boton.dataset.accion;

      if (accion === "editar-plan") {
        abrirModal(container, renderModalEditarPlan(GYMAPP.storage.getData()), "editar-plan");
      } else if (accion === "historial-planes") {
        abrirModal(container, renderModalHistorialPlanes(GYMAPP.storage.getData()), "historial-planes");
      } else if (accion === "ver-plan") {
        abrirModal(container, renderModalDetallePlan(GYMAPP.storage.getData(), boton.dataset.planId));
      } else if (accion === "cerrar-modal") {
        solicitarCerrarModal(container);
      } else if (accion.indexOf("rev-") === 0) {
        manejarAccionRevision(container, accion, boton);
      } else if (accion === "nuevo-dia") {
        agregarDia(container);
      } else if (accion === "borrar-dia") {
        borrarDia(container, boton.dataset.diaId);
      } else if (accion === "nuevo-ejercicio") {
        agregarEjercicio(container, boton.dataset.diaId);
      } else if (accion === "borrar-ejercicio") {
        borrarEjercicio(container, boton.dataset.diaId, boton.dataset.ejercicioId);
      } else if (accion === "importar-pdf") {
        container.querySelector("#input-pdf-rutina").click();
      } else if (accion === "cargar-plan") {
        abrirModal(container, renderModalCargarPlan(GYMAPP.planes.diasDelPlanActivo(GYMAPP.storage.getData()).length > 0), "cargar-plan");
      } else if (accion === "cargar-plan-pdf") {
        /* Mismo flujo que "Importar PDF" (E6): selector de archivo → revisión. */
        cerrarModal(container, { sinFoco: true });
        iniciarImportacionPdf(container);
      } else if (accion === "cargar-plan-manual") {
        cerrarModal(container, { sinFoco: true });
        iniciarCreacionManual(container);
      } else if (accion === "ver-guia") {
        GYMAPP.primerUso.abrirGuia({ alCerrar: boton });
      } else if (accion === "exportar-backup") {
        exportarBackup();
      } else if (accion === "importar-backup") {
        container.querySelector("#input-backup").click();
      }
    });

    container.addEventListener("submit", function (ev) {
      if (ev.target.id !== "form-editar-plan") return;
      ev.preventDefault();
      guardarMetadataPlan(container, ev.target);
    });

    /* Escape cierra el modal si la pantalla de Rutina sigue visible. */
    document.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape" && container.querySelector("#rutina-modal .modal")) solicitarCerrarModal(container);
    });

    /* E6: los campos de la revisión solo actualizan el borrador en memoria. */
    container.addEventListener("input", function (ev) {
      if (importacion && ev.target.dataset && ev.target.dataset.revCampo) actualizarCampoRevision(ev.target);
    });
    container.addEventListener("change", function (ev) {
      if (importacion && ev.target.dataset && ev.target.dataset.revCampo) {
        actualizarCampoRevision(ev.target);
        refrescarValidacionRevision(container);
      }
    });

    container.addEventListener("change", function (ev) {
      if (ev.target.closest && ev.target.closest("#rutina-modal")) return;
      if (ev.target.id === "input-pdf-rutina") {
        var file = ev.target.files[0];
        ev.target.value = "";
        if (file) manejarImportacionPdf(container, file);
        return;
      }
      if (ev.target.id === "input-backup") {
        var archivoBackup = ev.target.files[0];
        ev.target.value = "";
        if (archivoBackup) manejarImportacionBackup(container, archivoBackup);
        return;
      }
      if (ev.target.classList.contains("fila-actividad-checkbox") || ev.target.classList.contains("fila-actividad-meta-input")) {
        manejarCambioActividades(container, ev.target);
        return;
      }
      actualizarCampo(container, ev.target);
    });

    if (GYMAPP.auth) {
      GYMAPP.auth.bindEventosCuenta(container, function () {
        render(container);
      });
      /* Solo re-renderizamos si la pantalla de Rutina sigue siendo la que
         está visible: si el usuario está en otra pestaña cuando cambia el
         estado de sesión (ej. una renovación de token en segundo plano), no
         queremos pisar el contenido de esa pestaña. */
      GYMAPP.auth.suscribirCambiosSesion(function () {
        if (container.querySelector(".pantalla-rutina")) render(container);
      });
    }

    if (GYMAPP.sync) {
      GYMAPP.sync.bindEventosSincronizacion(container);
    }

    if (GYMAPP.perfilFoto) GYMAPP.perfilFoto.bindEventos(container);
  }

  var MENSAJE_ERROR_GUARDADO = "No se pudo guardar el cambio. Revisá el espacio disponible en tu dispositivo e intentá de nuevo.";

  function actualizarCampo(container, input) {
    var campo = input.dataset.campo;
    if (!campo) return;
    var filaEjercicio = input.closest("[data-ejercicio-id]");
    var tarjetaDia = input.closest("[data-dia-id]");
    if (!tarjetaDia) return;
    var diaId = tarjetaDia.dataset.diaId;
    var ejercicioId = filaEjercicio ? filaEjercicio.dataset.ejercicioId : null;

    var resultado = GYMAPP.storage.updateData(function (data) {
      var dia = GYMAPP.planes.buscarDiaActivo(data, diaId);
      if (!dia) return;
      if (ejercicioId) {
        var ejercicio = GYMAPP.planes.buscarEjercicioEnDiaActivo(data, diaId, ejercicioId);
        if (!ejercicio) return;
        ejercicio[campo] = campo === "series_objetivo" ? (parseInt(input.value, 10) || 0) : input.value;
      } else {
        dia[campo] = input.value;
      }
    }, { alertaAutomatica: false });

    if (!resultado.guardado) {
      mostrarMensaje(container, MENSAJE_ERROR_GUARDADO, "error");
    }
  }

  /* --- ONB-03: puertas de entrada visibles a los flujos existentes --- */

  function renderEstadoVacio() {
    return (
      '<section class="rutina-vacia" aria-labelledby="rutina-vacia-titulo">' +
      '<h3 id="rutina-vacia-titulo">No tenés un plan cargado</h3>' +
      '<p class="nota">Podés importar el PDF de tu entrenador o crear tu rutina manualmente.</p>' +
      '<div class="primer-uso-acciones">' +
      '<button type="button" data-accion="cargar-plan" class="btn btn-primario">Cargar mi plan</button>' +
      "</div>" +
      "</section>"
    );
  }

  /* `hayDias`: con plan armado se ofrece cambiarlo o editarlo; sin días,
     cargarlo o crearlo. Las dos opciones abren los flujos existentes. */
  function renderModalCargarPlan(hayDias) {
    return envolverModal(hayDias ? "Cargar / cambiar plan" : "Cargar mi plan",
      '<div class="cargar-plan-opciones">' +
      '<button type="button" data-accion="cargar-plan-pdf" class="cargar-plan-opcion">' +
      "<strong>Importar desde PDF</strong>" +
      "<span>Subí el PDF de tu entrenador. Vas a revisar todo antes de activarlo.</span></button>" +
      '<button type="button" data-accion="cargar-plan-manual" class="cargar-plan-opcion">' +
      (hayDias
        ? "<strong>Crear / editar manualmente</strong><span>Armá o ajustá los días y ejercicios de tu plan actual.</span>"
        : "<strong>Crear manualmente</strong><span>Armá tus días y ejercicios desde cero.</span>") +
      "</button>" +
      "</div>");
  }

  function renderSeccionAyuda() {
    return (
      '<div class="seccion-ayuda">' +
      "<h3>Ayuda</h3>" +
      '<p class="nota">Un repaso rápido de cómo usar la app.</p>' +
      '<button type="button" data-accion="ver-guia" class="btn-secundario">Ver guía de inicio</button>' +
      "</div>"
    );
  }

  /* Abre el selector de archivo del importador de PDF existente (E6). */
  function iniciarImportacionPdf(container) {
    var input = container.querySelector("#input-pdf-rutina");
    if (input) input.click();
  }

  /* Editor manual existente: si el plan no tiene días crea el primero
     (igual que "+ Nuevo día"); después lleva el foco al primer día. */
  function iniciarCreacionManual(container) {
    if (!GYMAPP.planes.diasDelPlanActivo(GYMAPP.storage.getData()).length) agregarDia(container);
    var primero = container.querySelector(".rutina-dias .input-nombre-dia");
    if (primero) {
      primero.scrollIntoView({ block: "center" });
      primero.focus();
    }
  }

  function agregarDia(container) {
    var resultado = GYMAPP.storage.updateData(function (data) {
      GYMAPP.planes.agregarDiaAlPlanActivo(data, {
        id: GYMAPP.util.generarId(),
        nombre: "Día " + (GYMAPP.planes.diasDelPlanActivo(data).length + 1),
        ejercicios: []
      });
    }, { alertaAutomatica: false });
    if (!resultado.guardado) {
      mostrarMensaje(container, MENSAJE_ERROR_GUARDADO, "error");
      return;
    }
    render(container);
  }

  function borrarDia(container, diaId) {
    if (!confirm("¿Borrar este día de la rutina? El historial de sesiones ya guardadas no se ve afectado.")) return;
    var resultado = GYMAPP.storage.updateData(function (data) {
      GYMAPP.planes.eliminarDiaDelPlanActivo(data, diaId);
    }, { alertaAutomatica: false });
    if (!resultado.guardado) {
      mostrarMensaje(container, MENSAJE_ERROR_GUARDADO, "error");
      return;
    }
    render(container);
  }

  function agregarEjercicio(container, diaId) {
    var resultado = GYMAPP.storage.updateData(function (data) {
      GYMAPP.planes.agregarEjercicioADiaActivo(data, diaId, {
        id: GYMAPP.util.generarId(),
        nombre: "",
        grupo_muscular: "",
        series_objetivo: 3,
        reps_objetivo: "10"
      });
    }, { alertaAutomatica: false });
    if (!resultado.guardado) {
      mostrarMensaje(container, MENSAJE_ERROR_GUARDADO, "error");
      return;
    }
    render(container);
  }

  function borrarEjercicio(container, diaId, ejercicioId) {
    var resultado = GYMAPP.storage.updateData(function (data) {
      GYMAPP.planes.eliminarEjercicioDeDiaActivo(data, diaId, ejercicioId);
    }, { alertaAutomatica: false });
    if (!resultado.guardado) {
      mostrarMensaje(container, MENSAJE_ERROR_GUARDADO, "error");
      return;
    }
    render(container);
  }

  function mostrarMensajeEn(el, texto, tipo) {
    if (!el) return;
    el.textContent = texto;
    el.className = "mensaje " + (tipo || "info");
  }

  function mostrarMensaje(container, texto, tipo) {
    mostrarMensajeEn(container.querySelector("#rutina-mensaje"), texto, tipo);
  }

  /* ACT-02: guarda usuario.actividades ante cualquier cambio en la sección
     "Actividades y metas" (tildar/destildar una actividad, cambiar una
     meta). Si la selección resultante no es válida (0 actividades, meta
     fuera de rango o no entera) no se guarda nada: se muestra el error y
     queda vigente la última configuración válida guardada. */
  function manejarCambioActividades(container, target) {
    if (target.classList.contains("fila-actividad-checkbox")) {
      GYMAPP.actividades.alternarVisibilidadMeta(target);
    }

    var mensajeEl = container.querySelector("#actividades-mensaje");
    var seleccion = GYMAPP.actividades.leerSeleccionDesdeDom(container.querySelector("#lista-actividades-usuario"));
    var resultado = GYMAPP.actividades.construirActividades(seleccion);

    if (!resultado.ok) {
      mostrarMensajeEn(mensajeEl, resultado.error, "error");
      return;
    }

    var guardado = GYMAPP.storage.updateData(function (data) {
      data.usuario.actividades = resultado.actividades;
    }, { alertaAutomatica: false });

    if (!guardado.guardado) {
      mostrarMensajeEn(mensajeEl, MENSAJE_ERROR_GUARDADO, "error");
      return;
    }

    mostrarMensajeEn(mensajeEl, "", "oculto");
  }

  /* E6: el PDF ya no se agrega al plan activo. Se lee y se parsea a un
     borrador en memoria que se revisa antes de activarlo como plan nuevo.
     Nada se escribe hasta "Activar nuevo plan". */
  function manejarImportacionPdf(container, file) {
    mostrarMensaje(container, "Leyendo PDF...", "info");
    GYMAPP.pdfImport.importarPlanDesdeArchivo(file).then(function (borrador) {
      importacion = { borrador: borrador, intentoActivar: false };
      mostrarMensaje(container, "", "oculto");
      abrirModal(container, renderRevisionPlan(GYMAPP.storage.getData(), borrador), "importar-pdf");
    }).catch(function (err) {
      console.error("Error al importar PDF", err);
      var conocido = err && (err.message === GYMAPP.pdfImport.MENSAJE_SIN_TEXTO || err.message === GYMAPP.pdfImport.MENSAJE_SIN_EJERCICIOS || /^No se pudo leer el PDF/.test(err.message));
      mostrarMensaje(container, conocido ? err.message : "Ocurrió un error al leer el PDF. Probá con otro archivo o cargá la rutina manualmente.", "error");
    });
  }

  /* --- E6: revisión del plan importado --- */

  /* { borrador, intentoActivar } mientras hay una revisión abierta. */
  var importacion = null;
  var CLAVE_PRE_CAMBIO_PLAN = "gymNutritionTracker_preCambioPlan";
  var CAMPOS_REVISION_EJERCICIO = [
    ["nombre", "Ejercicio", "text"], ["grupo_muscular", "Grupo muscular", "text"], ["series_objetivo", "Series", "number"],
    ["reps_objetivo", "Reps", "text"], ["rir_objetivo", "RIR", "text"], ["rpe_objetivo", "RPE", "text"],
    ["peso_objetivo", "Peso objetivo", "text"], ["pausa", "Pausa", "text"], ["comentarios", "Comentarios", "text"]
  ];

  function solicitarCerrarModal(container) {
    if (importacion) {
      if (!confirm("¿Descartar la importación? No se guardó nada y tu plan actual sigue igual.")) return;
      importacion = null;
    }
    cerrarModal(container);
  }

  function valorInput(v) {
    return v === null || v === undefined ? "" : escaparAtributo(String(v));
  }

  function errorDe(validacion, dia, ejercicio, campo) {
    return validacion.errores.filter(function (x) { return x.dia === dia && x.ejercicio === ejercicio && x.campo === campo; })[0] || null;
  }

  function campoRevision(id, etiqueta, tipo, valor, datos, error, extraClase) {
    var esc = GYMAPP.util.escapeHtml;
    return (
      '<div class="rev-campo' + (extraClase ? " " + extraClase : "") + '">' +
      '<label for="' + id + '">' + esc(etiqueta) + "</label>" +
      '<input id="' + id + '" type="' + tipo + '"' + (tipo === "number" ? ' inputmode="numeric" min="1" step="1"' : "") +
      (tipo === "text" && datos.indexOf("grupo_muscular") !== -1 ? ' list="grupos-musculares"' : "") +
      ' value="' + valorInput(valor) + '" ' + datos +
      (error ? ' aria-invalid="true" aria-describedby="' + id + '-error"' : "") + " />" +
      '<p id="' + id + '-error" class="campo-error-texto' + (error ? "" : " oculto") + '">' + (error ? esc(error.mensaje) : "") + "</p>" +
      "</div>"
    );
  }

  function renderAdvertencias(lista) {
    if (!lista.length) return "";
    return '<ul class="rev-advertencias">' + lista.map(function (a) {
      return "<li>⚠ " + GYMAPP.util.escapeHtml(a.mensaje) + "</li>";
    }).join("") + "</ul>";
  }

  function renderRevisionPlan(data, borrador) {
    var esc = GYMAPP.util.escapeHtml;
    var validacion = GYMAPP.pdfImport.validarPlanParseado(borrador);
    var mostrarErrores = importacion && importacion.intentoActivar;
    var v = mostrarErrores ? validacion : { errores: validacion.errores.filter(function (e) { return e.campo === "nombre"; }), advertencias: validacion.advertencias };
    var activo = GYMAPP.planes.planActivo(data);
    var totalEjercicios = borrador.dias.reduce(function (n, d) { return n + d.ejercicios.length; }, 0);
    var generales = v.advertencias.filter(function (a) { return a.dia === null; });
    var coincide = GYMAPP.planes.borradorCoincideConPlan(borrador, activo);
    var errorFechas = errorDe(v, null, null, "fechas");

    var dias = borrador.dias.map(function (dia, i) {
      var pre = "rev-d" + i;
      var ejercicios = dia.ejercicios.map(function (ej, j) {
        var datos = function (campo) { return 'data-rev-campo="' + campo + '" data-rev-dia="' + i + '" data-rev-ej="' + j + '"'; };
        return (
          '<div class="rev-ejercicio" data-rev-dia="' + i + '" data-rev-ej="' + j + '">' +
          '<div class="rev-ejercicio-header"><span class="rev-numero">' + (j + 1) + "</span>" +
          '<button type="button" data-accion="rev-quitar-ej" data-rev-dia="' + i + '" data-rev-ej="' + j + '" class="btn-enlace rev-quitar">Quitar ejercicio</button></div>' +
          renderAdvertencias(v.advertencias.filter(function (a) { return a.dia === i && a.ejercicio === j; })) +
          '<div class="rev-grilla">' +
          CAMPOS_REVISION_EJERCICIO.map(function (c) {
            var ancho = c[0] === "nombre" || c[0] === "comentarios" ? "rev-campo-ancho" : "";
            return campoRevision(pre + "-e" + j + "-" + c[0], c[1], c[2], ej[c[0]], datos(c[0]), errorDe(v, i, j, c[0]), ancho);
          }).join("") +
          "</div>" +
          (ej.raw ? '<p class="nota rev-raw">Texto original: ' + esc(ej.raw) + "</p>" : "") +
          "</div>"
        );
      }).join("");
      return (
        '<section class="rev-dia" aria-labelledby="' + pre + '-titulo">' +
        '<div class="rev-dia-header"><h4 id="' + pre + '-titulo">Día ' + (i + 1) + "</h4>" +
        '<div class="rev-dia-acciones">' +
        '<button type="button" data-accion="rev-subir-dia" data-rev-dia="' + i + '" class="btn-secundario"' + (i === 0 ? " disabled" : "") + ' aria-label="Subir día ' + (i + 1) + '">↑</button>' +
        '<button type="button" data-accion="rev-bajar-dia" data-rev-dia="' + i + '" class="btn-secundario"' + (i === borrador.dias.length - 1 ? " disabled" : "") + ' aria-label="Bajar día ' + (i + 1) + '">↓</button>' +
        '<button type="button" data-accion="rev-quitar-dia" data-rev-dia="' + i + '" class="btn-secundario" aria-label="Quitar día ' + (i + 1) + '">Quitar</button>' +
        "</div></div>" +
        campoRevision(pre + "-nombre", "Nombre del día", "text", dia.nombre, 'data-rev-campo="nombre" data-rev-dia="' + i + '"', errorDe(v, i, null, "nombre"), "rev-campo-ancho") +
        renderAdvertencias(v.advertencias.filter(function (a) { return a.dia === i && a.ejercicio === null; })) +
        ejercicios +
        '<button type="button" data-accion="rev-agregar-ej" data-rev-dia="' + i + '" class="btn btn-agregar-ejercicio">+ Agregar ejercicio</button>' +
        "</section>"
      );
    }).join("");

    return envolverModal("Revisar nuevo plan",
      '<p class="nota">Revisá y corregí lo que haga falta. Nada se guarda hasta que actives el plan.' +
      (borrador.nombre_archivo ? " Archivo: " + esc(borrador.nombre_archivo) + "." : "") + "</p>" +
      '<div class="mensaje info rev-coincide' + (coincide ? "" : " oculto") + '" role="status">⚠ Este plan parece coincidir con el plan activo.</div>' +
      renderAdvertencias(generales) +
      '<section class="rev-plan" aria-label="Datos del plan">' +
      campoRevision("rev-plan-nombre", "Nombre del plan", "text", borrador.nombre, 'data-rev-campo="nombre" data-rev-plan="1"', null, "rev-campo-ancho") +
      '<div class="rev-grilla">' +
      campoRevision("rev-plan-inicio", "Fecha de inicio", "date", borrador.fecha_inicio, 'data-rev-campo="fecha_inicio" data-rev-plan="1"', errorFechas) +
      campoRevision("rev-plan-fin", "Fecha de fin", "date", borrador.fecha_fin, 'data-rev-campo="fecha_fin" data-rev-plan="1"', null) +
      "</div></section>" +
      dias +
      '<section class="rev-resumen" aria-labelledby="rev-resumen-titulo">' +
      '<h4 id="rev-resumen-titulo">Resumen</h4>' +
      "<p><strong>Nuevo plan:</strong> " + plural(borrador.dias.length, "día", "días") + " · " + plural(totalEjercicios, "ejercicio", "ejercicios") + "</p>" +
      (GYMAPP.planes.planDescartableAlReemplazar(data, activo)
        ? "<p><strong>Plan actual:</strong> no tiene ejercicios, no se guarda en el historial</p>"
        : "<p><strong>Plan actual que será archivado:</strong> " + esc(nombrePlan(activo, NOMBRE_PLAN_ACTIVO_DEFAULT)) + "</p>") +
      "<p><strong>Sesiones históricas:</strong> no se modificarán</p>" +
      '<div id="rev-errores" class="mensaje error' + (mostrarErrores && validacion.errores.length ? "" : " oculto") + '" role="alert">' +
      (mostrarErrores && validacion.errores.length ? esc("Corregí " + plural(validacion.errores.length, "error", "errores") + " antes de activar: " + validacion.errores.map(function (e) { return e.mensaje; }).join(" ")) : "") +
      "</div>" +
      '<div class="modal-acciones">' +
      '<button type="button" data-accion="cerrar-modal" class="btn-secundario">Cancelar</button>' +
      '<button type="button" data-accion="rev-activar" class="btn-secundario btn-guardar-plan">Activar nuevo plan</button>' +
      "</div></section>", "modal-revision");
  }

  /* Input → borrador en memoria (sin re-render, para no perder el foco). */
  function actualizarCampoRevision(input) {
    var b = importacion.borrador;
    var campo = input.dataset.revCampo;
    var valor = input.value;
    if (input.dataset.revPlan) {
      b[campo] = valor.trim() ? valor.trim() : null;
      return;
    }
    var dia = b.dias[Number(input.dataset.revDia)];
    if (!dia) return;
    if (input.dataset.revEj === undefined) {
      dia.nombre = valor.trim() ? valor.trim() : null;
      return;
    }
    var ej = dia.ejercicios[Number(input.dataset.revEj)];
    if (!ej) return;
    var P = GYMAPP.pdfImport;
    if (campo === "series_objetivo") {
      ej.series_objetivo = valor.trim() === "" ? null : (P.normalizarSeries(valor) !== null ? P.normalizarSeries(valor) : valor.trim());
    } else if (campo === "rir_objetivo" || campo === "rpe_objetivo") {
      ej[campo] = P.normalizarValorEsfuerzo(valor);
    } else {
      ej[campo] = valor.replace(/\s+/g, " ").trim() || null;
    }
  }

  /* Tras editar un campo: actualiza los mensajes de error de nombres sin
     re-renderizar todo (el foco queda donde está). */
  function refrescarValidacionRevision(container) {
    var validacion = GYMAPP.pdfImport.validarPlanParseado(importacion.borrador);
    var aviso = container.querySelector("#rutina-modal .rev-coincide");
    if (aviso) {
      var coincide = GYMAPP.planes.borradorCoincideConPlan(importacion.borrador, GYMAPP.planes.planActivo(GYMAPP.storage.getData()));
      aviso.className = "mensaje info rev-coincide" + (coincide ? "" : " oculto");
    }
    container.querySelectorAll("#rutina-modal [data-rev-campo]").forEach(function (input) {
      var dia = input.dataset.revPlan ? null : Number(input.dataset.revDia);
      var ej = input.dataset.revEj === undefined ? null : Number(input.dataset.revEj);
      var campo = input.dataset.revCampo === "fecha_inicio" ? "fechas" : input.dataset.revCampo;
      var error = input.dataset.revCampo === "fecha_fin" ? null : errorDe(validacion, dia, ej, campo);
      if (!(campo === "nombre" || campo === "fechas" || importacion.intentoActivar)) return;
      var p = container.querySelector("#" + input.id + "-error");
      if (!p) return;
      p.textContent = error ? error.mensaje : "";
      p.className = "campo-error-texto" + (error ? "" : " oculto");
      if (error) {
        input.setAttribute("aria-invalid", "true");
        input.setAttribute("aria-describedby", input.id + "-error");
      } else {
        input.removeAttribute("aria-invalid");
        input.removeAttribute("aria-describedby");
      }
    });
  }

  function rerenderRevision(container, focoSelector) {
    var modal = container.querySelector("#rutina-modal .modal");
    var scroll = modal ? modal.scrollTop : 0;
    abrirModal(container, renderRevisionPlan(GYMAPP.storage.getData(), importacion.borrador), null, { sinFoco: true });
    var nuevo = container.querySelector("#rutina-modal .modal");
    if (nuevo) nuevo.scrollTop = scroll;
    var foco = focoSelector ? container.querySelector(focoSelector) : nuevo;
    if (foco) foco.focus({ preventScroll: !focoSelector });
  }

  function manejarAccionRevision(container, accion, boton) {
    if (!importacion) return;
    var b = importacion.borrador;
    var i = Number(boton.dataset.revDia);
    var j = Number(boton.dataset.revEj);
    if (accion === "rev-subir-dia" && i > 0) {
      b.dias.splice(i - 1, 0, b.dias.splice(i, 1)[0]);
      rerenderRevision(container, '[data-accion="rev-subir-dia"][data-rev-dia="' + Math.max(i - 1, 1) + '"]');
    } else if (accion === "rev-bajar-dia" && i < b.dias.length - 1) {
      b.dias.splice(i + 1, 0, b.dias.splice(i, 1)[0]);
      rerenderRevision(container, '[data-accion="rev-bajar-dia"][data-rev-dia="' + Math.min(i + 1, b.dias.length - 2) + '"]');
    } else if (accion === "rev-quitar-dia") {
      if (!confirm("¿Quitar este día del plan importado?")) return;
      b.dias.splice(i, 1);
      rerenderRevision(container);
    } else if (accion === "rev-quitar-ej") {
      b.dias[i].ejercicios.splice(j, 1);
      rerenderRevision(container);
    } else if (accion === "rev-agregar-ej") {
      b.dias[i].ejercicios.push(GYMAPP.pdfImport.ejercicioVacio());
      rerenderRevision(container, "#rev-d" + i + "-e" + (b.dias[i].ejercicios.length - 1) + "-nombre");
    } else if (accion === "rev-activar") {
      activarPlanImportado(container);
    }
  }

  /* Confirmación final: todo en memoria y validado → copia previa → un
     único guardado. Si algo falla, los datos anteriores quedan intactos. */
  function activarPlanImportado(container) {
    importacion.intentoActivar = true;
    var b = importacion.borrador;
    var validacion = GYMAPP.pdfImport.validarPlanParseado(b);
    if (validacion.errores.length) {
      rerenderRevision(container, "#rev-errores");
      var primero = container.querySelector('#rutina-modal [aria-invalid="true"]');
      if (primero) primero.focus();
      return;
    }
    var ahora = new Date().toISOString();
    var preparado = GYMAPP.planes.prepararCambioDePlan(GYMAPP.storage.getData(), b, { ahora: ahora, nombreArchivo: b.nombre_archivo });
    var errorEl = container.querySelector("#rev-errores");
    if (!preparado.ok) {
      mostrarMensajeEn(errorEl, preparado.error, "error");
      return;
    }
    if (!confirm((preparado.anteriorDescartado
      ? "Tu plan actual no tiene ejercicios: no se guarda en el historial."
      : "El plan actual pasará al historial. Tus entrenamientos anteriores no se modificarán.") + "\n\n¿Activar el nuevo plan?")) return;
    var guardado = GYMAPP.storage.guardarConCopiaPrevia(CLAVE_PRE_CAMBIO_PLAN, preparado.datos, ahora);
    if (!guardado.ok) {
      mostrarMensajeEn(errorEl, guardado.motivo === "copia"
        ? "No se pudo crear la copia de seguridad previa. No se cambió nada."
        : "No se pudo guardar el nuevo plan. Tus datos anteriores se conservan intactos.", "error");
      return;
    }
    importacion = null;
    render(container);
    mostrarMensaje(container, preparado.anteriorDescartado
      ? "Nuevo plan activado."
      : "Nuevo plan activado. El plan anterior quedó en el Historial de planes.", "exito");
  }

  function exportarBackup() {
    var data = GYMAPP.storage.getData();
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var fecha = new Date().toISOString().slice(0, 10);

    var enlace = document.createElement("a");
    enlace.href = url;
    enlace.download = "gym-nutrition-backup-" + fecha + ".json";
    document.body.appendChild(enlace);
    enlace.click();
    document.body.removeChild(enlace);
    URL.revokeObjectURL(url);
  }

  /* Import manual de backup: toda la validación/migración ocurre en
     memoria (GYMAPP.backupImport) y recién después de confirmar se
     escribe, con copia previa e invalidación de la baseline de SYNC-03. */
  function manejarImportacionBackup(container, file) {
    var lector = new FileReader();

    lector.onload = function () {
      var preparado = GYMAPP.backupImport.prepararImportacionBackup(lector.result);
      if (!preparado.ok) {
        mostrarMensaje(container, preparado.error, "error");
        return;
      }

      var avisoVersion = preparado.versionOrigen < preparado.versionDestino
        ? "\n\nEl backup es de una versión anterior de la app y se va a actualizar a versión " + preparado.versionDestino + "."
        : "";
      if (!confirm(
        "Esto reemplaza todos los datos actuales de la app (rutina, historial, nutrición) por los del archivo. ¿Continuar?" +
        avisoVersion +
        "\n\nLa próxima vez que sincronices con la nube vas a tener que confirmar qué datos conservar."
      )) {
        return;
      }

      var resultado = GYMAPP.backupImport.aplicarImportacionBackup(preparado, { nombreArchivo: file && file.name });
      if (!resultado.ok) {
        mostrarMensaje(container, resultado.error, "error");
        return;
      }
      alert("Backup importado con éxito. La app se va a recargar.");
      window.location.reload();
    };

    lector.onerror = function () {
      mostrarMensaje(container, "No se pudo leer el archivo.", "error");
    };

    lector.readAsText(file);
  }

  return {
    render: render,
    /* ONB-03: entradas a los flujos existentes desde otras pantallas. */
    iniciarImportacionPdf: iniciarImportacionPdf,
    iniciarCreacionManual: iniciarCreacionManual,
    /* Expuestas para tests (presentación pura, sin escrituras). */
    renderTarjetaPlanActivo: renderTarjetaPlanActivo,
    renderModalEditarPlan: renderModalEditarPlan,
    renderModalHistorialPlanes: renderModalHistorialPlanes,
    renderModalDetallePlan: renderModalDetallePlan,
    textoVigencia: textoVigencia
  };
})();
