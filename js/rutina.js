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
  }

  function hoyISO() {
    return GYMAPP.util.fechaLocalISO(new Date());
  }

  function template(data, hoy) {
    var dias = GYMAPP.planes.diasDelPlanActivo(data);
    var usuario = data.usuario;
    var listaDias = dias.length
      ? dias.map(renderDia).join("")
      : '<p class="nota">Todavía no tenés días cargados. Agregá uno manualmente o importá el PDF de tu rutina.</p>';

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
  var ORIGENES = { legacy: "Histórico", migracion: "Migrado de la versión anterior" };

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
      "</section>"
    );
  }

  function envolverModal(titulo, cuerpo) {
    return (
      '<div class="modal-fondo">' +
      '<div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-titulo" tabindex="-1">' +
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
  function abrirModal(container, html, disparador) {
    var destino = container.querySelector("#rutina-modal");
    if (!destino) return;
    if (!destino.innerHTML && disparador) destino.dataset.disparador = disparador;
    destino.innerHTML = html;
    document.body.classList.add("modal-abierto");
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
        cerrarModal(container);
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
        cerrarModal(container);
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
      if (ev.key === "Escape" && container.querySelector("#rutina-modal .modal")) cerrarModal(container);
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

  function manejarImportacionPdf(container, file) {
    mostrarMensaje(container, "Leyendo PDF...", "info");
    GYMAPP.pdfImport.importarDesdeArchivo(file).then(function (diasImportados) {
      if (!diasImportados.length) {
        mostrarMensaje(container, "No se pudo reconocer ningún ejercicio en el PDF. Cargá los días manualmente.", "error");
        return;
      }
      var resultado = GYMAPP.storage.updateData(function (data) {
        /* E2: sigue agregando los días importados al plan activo, como
           antes (el reemplazo/archivado de planes es E6). */
        diasImportados.forEach(function (dia) { GYMAPP.planes.agregarDiaAlPlanActivo(data, dia); });
      }, { alertaAutomatica: false });
      if (!resultado.guardado) {
        mostrarMensaje(container, MENSAJE_ERROR_GUARDADO, "error");
        return;
      }
      var totalEjercicios = diasImportados.reduce(function (acc, d) { return acc + d.ejercicios.length; }, 0);
      render(container);
      mostrarMensaje(
        container,
        "Se importaron " + diasImportados.length + " día(s) y " + totalEjercicios + " ejercicio(s). Revisá y corregí lo que haga falta, el parseo puede no ser exacto.",
        "exito"
      );
    }).catch(function (err) {
      console.error("Error al importar PDF", err);
      mostrarMensaje(container, "Ocurrió un error al leer el PDF. Probá con otro archivo o cargá la rutina manualmente.", "error");
    });
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
    /* Expuestas para tests (presentación pura, sin escrituras). */
    renderTarjetaPlanActivo: renderTarjetaPlanActivo,
    renderModalEditarPlan: renderModalEditarPlan,
    renderModalHistorialPlanes: renderModalHistorialPlanes,
    renderModalDetallePlan: renderModalDetallePlan,
    textoVigencia: textoVigencia
  };
})();
