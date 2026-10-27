/* Pantalla de onboarding: se muestra solo si no existe `usuario` en el estado. */
var GYMAPP = window.GYMAPP || (window.GYMAPP = {});

GYMAPP.onboarding = (function () {
  /* ONB-01: misma lógica y mismos nombres de campo que antes (ver
     manejarSubmit), solo reagrupados visualmente en 3 secciones dentro de
     una card, con la identidad de marca del resto de la app. */

  /* ACT-02: configuración por defecto para un usuario nuevo, igual a la que
     tenía toda la app antes de que las actividades fueran configurables
     (Gimnasio 5 días + Fútbol 2 días). Se usa solo para pre-marcar la
     sección de actividades del onboarding; el valor final que se guarda
     sale siempre de leer el DOM al enviar el formulario. */
  var ACTIVIDADES_DEFAULT_ONBOARDING = [
    { tipo: "gimnasio", meta_semanal: 5 },
    { tipo: "futbol", meta_semanal: 2 }
  ];

  function render(root) {
    root.innerHTML =
      '<div class="pantalla pantalla-onboarding">' +
      '<div class="onboarding-header">' +
      '<span class="onboarding-eyebrow">Bienvenido</span>' +
      "<h1>Armemos tu perfil</h1>" +
      '<p class="subtitulo">Con estos datos calculamos tus metas de calorías y macros.</p>' +
      "</div>" +
      '<form id="form-onboarding" novalidate class="onboarding-card">' +
      seccionOnboarding(
        "Datos personales",
        campoNombre() +
          campoSelect("sexo", "Sexo", [
            ["masculino", "Masculino"],
            ["femenino", "Femenino"]
          ]) +
          campoFechaNacimiento()
      ) +
      seccionOnboarding(
        "Medidas",
        campoTexto("peso_kg", "Peso (kg)", "text", true, { inputmode: "decimal", autocomplete: "off" }) +
          campoTexto("altura_cm", "Altura (cm)", "number", true, { step: "1", min: "100", max: "250", inputmode: "numeric" })
      ) +
      seccionOnboarding(
        "Objetivo y actividad",
        campoSelect("objetivo", "Objetivo", [
          ["recomposicion", "Recomposición"],
          ["volumen", "Volumen"],
          ["definicion", "Definición"]
        ]) +
          campoSelect("nivel_actividad", "Nivel de actividad", [
            ["sedentario", "Sedentario"],
            ["moderado", "Moderado"],
            ["activo", "Activo"],
            ["muy_activo", "Muy activo"]
          ])
      ) +
      seccionOnboarding(
        "¿Qué actividades realizás?",
        '<div class="lista-actividades" id="lista-actividades-onboarding">' +
          GYMAPP.actividades.renderListaActividades(ACTIVIDADES_DEFAULT_ONBOARDING, "onb-act") +
          "</div>"
      ) +
      '<button type="submit" class="btn btn-primario onboarding-btn-principal">Comenzar</button>' +
      "</form>" +
      "</div>";

    var form = document.getElementById("form-onboarding");
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      manejarSubmit(ev.target);
    });
    form.addEventListener("change", function (ev) {
      if (ev.target.classList.contains("fila-actividad-checkbox")) {
        GYMAPP.actividades.alternarVisibilidadMeta(ev.target);
      }
    });

    bindCampoNombre(form);
    bindCampoFechaNacimiento(form);
  }

  /* --- ONB-02: nombre/apellido --- */

  function campoNombre() {
    return (
      '<div class="campo">' +
      '<label for="nombre">Nombre</label>' +
      '<input id="nombre" name="nombre" type="text" required autocomplete="name" placeholder="Nombre y apellido" />' +
      '<p class="campo-error-texto oculto" id="nombre-error"></p>' +
      "</div>"
    );
  }

  /* Deja pasar únicamente letras (con acentos y ñ/Ñ vía \\p{L}, nunca
     limitado a A-Z), espacios, apóstrofe y guion. Colapsa espacios dobles y
     no deja que el valor arranque con un espacio. El trim final (para que
     tampoco pueda terminar con espacio) se hace en el blur y de nuevo al
     guardar, no acá: mientras se está escribiendo, un espacio al final es
     simplemente que el usuario está por escribir la siguiente palabra. */
  function sanitizarNombreEnVivo(valor) {
    var limpio = (valor || "").replace(/[^\p{L}\s'-]/gu, "");
    limpio = limpio.replace(/\s{2,}/g, " ");
    limpio = limpio.replace(/^\s+/, "");
    return limpio;
  }

  /* Validación final (blur/submit): además de sanitizar, exige que quede al
     menos una letra real (para no aceptar algo como "--" o "'"). Devuelve el
     nombre ya validado y trimeado, o null si no quedó nada válido. */
  function validarNombreFinal(valor) {
    var limpio = sanitizarNombreEnVivo(valor).trim();
    if (!limpio || !/\p{L}/u.test(limpio)) return null;
    return limpio;
  }

  function bindCampoNombre(form) {
    var input = form.querySelector("#nombre");
    input.addEventListener("input", function () {
      var valorAnterior = input.value;
      var posicionCursor = input.selectionStart;
      var sanitizado = sanitizarNombreEnVivo(valorAnterior);
      if (sanitizado !== valorAnterior) {
        var diferencia = valorAnterior.length - sanitizado.length;
        input.value = sanitizado;
        var nuevaPosicion = Math.max(0, posicionCursor - diferencia);
        input.setSelectionRange(nuevaPosicion, nuevaPosicion);
      }
      ocultarErrorCampo("nombre-error");
    });
    input.addEventListener("blur", function () {
      input.value = sanitizarNombreEnVivo(input.value).trim();
    });
  }

  /* --- ONB-02: fecha de nacimiento (selector nativo + entrada manual) --- */

  function campoFechaNacimiento() {
    var hoyISO = GYMAPP.util.fechaLocalISO(new Date());
    return (
      '<div class="campo">' +
      '<label for="fecha_nacimiento_manual">Fecha de nacimiento</label>' +
      '<div class="fecha-nacimiento-grupo">' +
      '<input type="text" id="fecha_nacimiento_manual" inputmode="numeric" autocomplete="bday" placeholder="DD/MM/AAAA" maxlength="10" />' +
      '<input type="date" id="fecha_nacimiento" name="fecha_nacimiento" max="' + hoyISO + '" required />' +
      "</div>" +
      '<p class="campo-error-texto oculto" id="fecha-nacimiento-error"></p>' +
      "</div>"
    );
  }

  /* Inserta las barras automáticamente a medida que se escriben los dígitos
     (29021990 -> 29/02/1990), sin dejar escribir nada que no sea un dígito. */
  function formatearFechaManualEnVivo(valor) {
    var digitos = (valor || "").replace(/\D/g, "").slice(0, 8);
    var partes = [];
    if (digitos.length > 0) partes.push(digitos.slice(0, 2));
    if (digitos.length > 2) partes.push(digitos.slice(2, 4));
    if (digitos.length > 4) partes.push(digitos.slice(4, 8));
    return partes.join("/");
  }

  /* Valida que sea una fecha calendario real (rechaza 31/02, o 29/02 en un
     año no bisiesto): construye la fecha y confirma que el día/mes/año no
     se hayan "corrido" por el rollover automático de Date. */
  function parsearFechaManual(ddmmaaaa) {
    var match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(ddmmaaaa || "");
    if (!match) return null;
    var dia = parseInt(match[1], 10);
    var mes = parseInt(match[2], 10);
    var anio = parseInt(match[3], 10);
    if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
    var fecha = new Date(anio, mes - 1, dia);
    if (fecha.getFullYear() !== anio || fecha.getMonth() !== mes - 1 || fecha.getDate() !== dia) return null;
    return { anio: anio, mes: mes, dia: dia };
  }

  function pad2(n) {
    return n < 10 ? "0" + n : String(n);
  }

  function isoDesdeParseada(p) {
    return p.anio + "-" + pad2(p.mes) + "-" + pad2(p.dia);
  }

  function ddmmaaaaDesdeIso(iso) {
    var partes = (iso || "").split("-");
    if (partes.length !== 3) return "";
    return partes[2] + "/" + partes[1] + "/" + partes[0];
  }

  /* Fuente de verdad final al guardar: siempre revalida el valor YYYY-MM-DD
     que haya quedado en el input nativo, venga de donde venga (selector
     nativo o sincronizado desde el campo manual). Nunca cambia el formato
     persistido: usuario.fecha_nacimiento sigue siendo YYYY-MM-DD. */
  function validarFechaNacimientoFinal(iso) {
    var match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
    if (!match) return null;
    var anio = parseInt(match[1], 10);
    var mes = parseInt(match[2], 10);
    var dia = parseInt(match[3], 10);
    var fecha = new Date(anio, mes - 1, dia);
    if (fecha.getFullYear() !== anio || fecha.getMonth() !== mes - 1 || fecha.getDate() !== dia) return null;
    if (iso > GYMAPP.util.fechaLocalISO(new Date())) return null;
    return iso;
  }

  function bindCampoFechaNacimiento(form) {
    var inputManual = form.querySelector("#fecha_nacimiento_manual");
    var inputNativo = form.querySelector("#fecha_nacimiento");

    inputManual.addEventListener("input", function () {
      inputManual.value = formatearFechaManualEnVivo(inputManual.value);
      ocultarErrorCampo("fecha-nacimiento-error");

      var digitos = inputManual.value.replace(/\D/g, "");
      if (digitos.length < 8) {
        inputNativo.value = "";
        return;
      }

      var parseada = parsearFechaManual(inputManual.value);
      if (!parseada) {
        inputNativo.value = "";
        mostrarErrorCampo("fecha-nacimiento-error", "Ingresá una fecha real (DD/MM/AAAA).");
        return;
      }

      var iso = isoDesdeParseada(parseada);
      if (iso > GYMAPP.util.fechaLocalISO(new Date())) {
        inputNativo.value = "";
        mostrarErrorCampo("fecha-nacimiento-error", "La fecha de nacimiento no puede ser futura.");
        return;
      }

      inputNativo.value = iso;
    });

    /* Selector nativo -> también actualiza el campo manual, para que
       siempre queden sincronizados sin importar por dónde se cargó la
       fecha (esto también cubre "cargar una fecha ya existente": si en
       algún momento este formulario arranca con el input nativo ya
       completo, el campo manual lo refleja apenas se dispara este evento
       o se llama a sincronizarCampoManualDesdeNativo explícitamente). */
    inputNativo.addEventListener("change", function () {
      sincronizarCampoManualDesdeNativo(inputManual, inputNativo);
      ocultarErrorCampo("fecha-nacimiento-error");
    });

    sincronizarCampoManualDesdeNativo(inputManual, inputNativo);
  }

  function sincronizarCampoManualDesdeNativo(inputManual, inputNativo) {
    if (inputNativo.value) {
      inputManual.value = ddmmaaaaDesdeIso(inputNativo.value);
    }
  }

  function mostrarErrorCampo(id, texto) {
    var el = document.getElementById(id);
    if (!el) return;
    el.textContent = texto;
    el.classList.remove("oculto");
  }

  function ocultarErrorCampo(id) {
    var el = document.getElementById(id);
    if (!el) return;
    el.classList.add("oculto");
    el.textContent = "";
  }

  function seccionOnboarding(titulo, camposHtml) {
    return (
      '<section class="onboarding-seccion">' +
      '<h2 class="onboarding-seccion-titulo">' + titulo + "</h2>" +
      camposHtml +
      "</section>"
    );
  }

  function campoTexto(id, label, type, requerido, extraAttrs) {
    var attrs = "";
    if (extraAttrs) {
      Object.keys(extraAttrs).forEach(function (k) {
        attrs += " " + k + '="' + extraAttrs[k] + '"';
      });
    }
    return (
      '<div class="campo">' +
      '<label for="' + id + '">' + label + "</label>" +
      '<input id="' + id + '" name="' + id + '" type="' + type + '"' +
      (requerido ? " required" : "") +
      attrs +
      "></div>"
    );
  }

  function campoSelect(id, label, opciones) {
    var optionsHtml = opciones
      .map(function (o) {
        return '<option value="' + o[0] + '">' + o[1] + "</option>";
      })
      .join("");
    return (
      '<div class="campo">' +
      '<label for="' + id + '">' + label + "</label>" +
      '<select id="' + id + '" name="' + id + '" required>' + optionsHtml + "</select></div>"
    );
  }

  function manejarSubmit(form) {
    var fd = new FormData(form);

    /* ONB-02: revalidar acá también (no confiar solo en el sanitizado en
       vivo), por si el campo llegó de otra forma (autocompletado del
       navegador, pegado, etc.). Nunca se guarda un nombre vacío o inválido,
       ni una fecha que no sea una fecha real y no futura. */
    var nombreValidado = validarNombreFinal(fd.get("nombre"));
    if (!nombreValidado) {
      mostrarErrorCampo("nombre-error", "Ingresá un nombre válido: solo letras, espacios, apóstrofe (') y guion (-).");
      form.querySelector("#nombre").focus();
      return;
    }

    var fechaValidada = validarFechaNacimientoFinal(fd.get("fecha_nacimiento"));
    if (!fechaValidada) {
      mostrarErrorCampo("fecha-nacimiento-error", "Ingresá una fecha de nacimiento válida y no futura.");
      form.querySelector("#fecha_nacimiento_manual").focus();
      return;
    }

    var usuario = {
      nombre: nombreValidado,
      sexo: fd.get("sexo"),
      objetivo: fd.get("objetivo"),
      peso_kg: GYMAPP.util.parsearDecimal(fd.get("peso_kg")),
      altura_cm: parseFloat(fd.get("altura_cm")),
      fecha_nacimiento: fechaValidada,
      nivel_actividad: fd.get("nivel_actividad")
    };

    if (isNaN(usuario.peso_kg) || isNaN(usuario.altura_cm)) {
      alert("Completá todos los campos antes de continuar.");
      return;
    }

    /* ACT-02: toda la selección de actividades y metas se arma/valida acá
       con los helpers compartidos de GYMAPP.actividades, para que ningún
       usuario nuevo pueda terminar el onboarding sin usuario.actividades
       (el gap documentado y pendiente de ACT-01). */
    var seleccionActividades = GYMAPP.actividades.leerSeleccionDesdeDom(form.querySelector("#lista-actividades-onboarding"));
    var resultadoActividades = GYMAPP.actividades.construirActividades(seleccionActividades);
    if (!resultadoActividades.ok) {
      alert(resultadoActividades.error);
      return;
    }
    usuario.actividades = resultadoActividades.actividades;

    usuario.metas_macros = GYMAPP.calculos.calcularMetasMacros(usuario);

    var resultado = GYMAPP.storage.updateData(function (data) {
      data.usuario = usuario;
    }, { alertaAutomatica: false });

    if (!resultado.guardado) {
      alert("No se pudo guardar tu perfil. Es posible que no haya espacio disponible en el dispositivo. Volvé a intentarlo.");
      return;
    }

    GYMAPP.app.iniciar();
  }

  return { render: render };
})();
