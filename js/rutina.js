/* Pestaña Rutina: plantilla editable de días/ejercicios. Nunca toca sesiones_entrenamiento. */
var GYMAPP = window.GYMAPP || (window.GYMAPP = {});

GYMAPP.rutina = (function () {
  var GRUPOS_MUSCULARES = ["Pecho", "Espalda", "Pierna", "Hombro", "Bíceps", "Tríceps", "Glúteo", "Core", "Cardio"];

  function render(container) {
    var data = GYMAPP.storage.getData();
    container.innerHTML = template(data.rutina.dias, data.usuario);
    if (!container.dataset.rutinaBound) {
      bindEventos(container);
      container.dataset.rutinaBound = "1";
    }
  }

  function template(dias, usuario) {
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
      '<div class="rutina-dias">' + listaDias + "</div>" +
      '<datalist id="grupos-musculares">' +
      GRUPOS_MUSCULARES.map(function (g) { return '<option value="' + g + '"></option>'; }).join("") +
      "</datalist>" +
      renderSeccionActividades(usuario) +
      (GYMAPP.auth ? GYMAPP.auth.renderSeccionCuenta() : "") +
      (GYMAPP.sync ? GYMAPP.sync.renderSeccionSincronizacion() : "") +
      renderSeccionBackup() +
      "</div>"
    );
  }

  /* ACT-02: sección "Actividades y metas" para usuarios existentes. Permite
     agregar/quitar actividades y modificar su meta semanal marcando o
     desmarcando cada fila, reutilizando el mismo catálogo y helpers de
     GYMAPP.actividades que usa el onboarding. Desactivar una actividad acá
     solo saca su entrada de usuario.actividades: nunca toca rutina.dias,
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
      var boton = ev.target.closest("[data-accion]");
      if (!boton) return;
      var accion = boton.dataset.accion;

      if (accion === "nuevo-dia") {
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

    container.addEventListener("change", function (ev) {
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
      var dia = data.rutina.dias.find(function (d) { return d.id === diaId; });
      if (!dia) return;
      if (ejercicioId) {
        var ejercicio = dia.ejercicios.find(function (e) { return e.id === ejercicioId; });
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
      data.rutina.dias.push({
        id: GYMAPP.util.generarId(),
        nombre: "Día " + (data.rutina.dias.length + 1),
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
      data.rutina.dias = data.rutina.dias.filter(function (d) { return d.id !== diaId; });
    }, { alertaAutomatica: false });
    if (!resultado.guardado) {
      mostrarMensaje(container, MENSAJE_ERROR_GUARDADO, "error");
      return;
    }
    render(container);
  }

  function agregarEjercicio(container, diaId) {
    var resultado = GYMAPP.storage.updateData(function (data) {
      var dia = data.rutina.dias.find(function (d) { return d.id === diaId; });
      if (!dia) return;
      dia.ejercicios.push({
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
      var dia = data.rutina.dias.find(function (d) { return d.id === diaId; });
      if (!dia) return;
      dia.ejercicios = dia.ejercicios.filter(function (e) { return e.id !== ejercicioId; });
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
        data.rutina.dias = data.rutina.dias.concat(diasImportados);
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
        ? "\n\nEl backup es de una versión anterior de la app y se va a actualizar al formato actual."
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

  return { render: render };
})();
