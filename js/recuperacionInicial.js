/* Recuperación inicial: un usuario que inicia sesión en un navegador,
   dispositivo o dominio sin datos locales, y ya tiene una copia en la nube,
   ve "Encontramos tus datos" ANTES del onboarding de perfil, en vez de tener
   que armar un perfil de relleno para después recuperar.

   Reglas:
   - Solo con sesión y sin datos locales útiles (app.js decide cuándo).
   - La consulta inicial es SOLO LECTURA (sync.obtenerDatosRemotos, un
     SELECT con RLS). Nunca llama a ninguna RPC de escritura: nada se sube
     hasta que el usuario use "Sincronizar ahora" con sus protecciones.
   - "Recuperar mis datos" reutiliza la restauración de "Recuperar desde la
     nube" (sync.aplicarRestauracion): validación, bloqueo de versiones
     futuras, backup local previo, guardado y baseline de sincronización.
   - "Empezar de cero" lleva al onboarding sin tocar la nube. */
var GYMAPP = window.GYMAPP || (window.GYMAPP = {});

GYMAPP.recuperacionInicial = (function () {
  /* Datos locales que no se pueden pisar con una recuperación ofrecida al
     arrancar: perfil, sesiones, nutrición, medidas, alimentos o un plan
     útil según la definición central de ONB-03 (GYMAPP.planes.planEsUtil:
     al menos un ejercicio). Un plan vacío o con días vacíos no cuenta. Si
     hay cualquiera de esos, se sigue como siempre. */
  function hayDatosLocalesUtiles(data) {
    if (!data) return false;
    if (data.usuario) return true;
    var listas = [data.sesiones_entrenamiento, data.registros_nutricion, data.medidas_corporales, data.base_alimentos];
    if (listas.some(function (l) { return Array.isArray(l) && l.length > 0; })) return true;
    var planes = data.rutina && Array.isArray(data.rutina.planes) ? data.rutina.planes : [];
    return planes.some(GYMAPP.planes.planEsUtil);
  }

  /* Solo lectura. Resuelve a:
       { estado: "sin_datos" }                    sin fila remota
       { estado: "encontrado", fila }             copia recuperable
       { estado: "bloqueado", fila, mensaje }     copia de una versión más
                                                  nueva o con formato inválido
       { estado: "error", mensaje }               no se pudo consultar
     Nunca rechaza. */
  function consultar() {
    var promesa;
    try {
      promesa = GYMAPP.sync.obtenerDatosRemotos();
    } catch (e) {
      promesa = Promise.reject(e);
    }
    return promesa.then(function (resultado) {
      if (!resultado || resultado.estado === "sin_datos_remotos") return { estado: "sin_datos" };
      var fila = resultado.fila;
      try {
        /* Misma validación que usa la restauración (no escribe nada). */
        GYMAPP.sync.validarYMigrarPayloadRemoto({ data: JSON.parse(JSON.stringify(fila.data)) });
      } catch (e) {
        return { estado: "bloqueado", fila: fila, mensaje: e.message };
      }
      return { estado: "encontrado", fila: fila };
    }).catch(function (e) {
      console.warn("No se pudo consultar la copia en la nube", e);
      return { estado: "error", mensaje: (e && e.message) || "error desconocido" };
    });
  }

  /* Vuelve a leer la fila (por si cambió mientras la pantalla estaba
     abierta) y la restaura con la lógica existente de sync. Solo escribe
     en este dispositivo. Resuelve a { ok } o { ok: false, mensaje }. */
  function recuperar(userId) {
    return consultar().then(function (r) {
      if (r.estado === "sin_datos") return { ok: false, mensaje: "Ya no hay una copia guardada en la nube." };
      if (r.estado !== "encontrado") return { ok: false, mensaje: r.mensaje };
      return GYMAPP.sync.aplicarRestauracion(r.fila, userId);
    });
  }

  function resumenCopia(fila) {
    var partes = [];
    var d = fila && fila.data;
    if (d && d.usuario && d.usuario.nombre) partes.push("Perfil de " + d.usuario.nombre);
    var sesiones = d && Array.isArray(d.sesiones_entrenamiento) ? d.sesiones_entrenamiento.length : 0;
    if (sesiones) partes.push(sesiones + (sesiones === 1 ? " sesión" : " sesiones") + " registradas");
    if (fila && fila.updated_at) {
      var f = new Date(fila.updated_at);
      if (!isNaN(f.getTime())) partes.push("Última actualización: " + f.toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" }));
    }
    return partes;
  }

  /* estado: resultado de consultar(); opciones: { confirmarCero, cargando, mensaje } */
  function render(estado, opciones) {
    opciones = opciones || {};
    var esc = GYMAPP.util.escapeHtml;
    var cuerpo;
    if (opciones.confirmarCero) {
      cuerpo =
        '<h2 id="recuperacion-titulo">¿Empezar de cero?</h2>' +
        '<p class="nota">Ya existe una copia en la nube. Si continuás, todavía no la vamos a reemplazar.</p>' +
        '<button type="button" data-accion="recuperacion-volver" class="btn btn-primario btn-ancho">Volver</button>' +
        '<button type="button" data-accion="recuperacion-continuar-cero" class="btn btn-secundario btn-ancho">Continuar sin recuperar</button>';
    } else if (estado.estado === "error") {
      cuerpo =
        '<h2 id="recuperacion-titulo">No pudimos revisar la nube</h2>' +
        '<p class="nota">Revisá tu conexión. Si ya tenías datos guardados, podés recuperarlos en cuanto vuelva la conexión.</p>' +
        '<button type="button" data-accion="recuperacion-reintentar" class="btn btn-primario btn-ancho">Reintentar</button>' +
        '<button type="button" data-accion="recuperacion-cero" class="btn-enlace">Empezar de cero</button>';
    } else {
      var bloqueado = estado.estado === "bloqueado";
      cuerpo =
        '<p class="recuperacion-etiqueta">Cuenta</p>' +
        '<h2 id="recuperacion-titulo">Encontramos tus datos</h2>' +
        '<p class="nota acceso-subtitulo">Ya tenés una copia guardada en la nube.</p>' +
        '<ul class="recuperacion-resumen">' + resumenCopia(estado.fila).map(function (t) { return "<li>" + esc(t) + "</li>"; }).join("") + "</ul>" +
        '<div id="recuperacion-mensaje" class="mensaje' + (bloqueado || opciones.mensaje ? " error" : " oculto") + '" role="status">' +
        esc(bloqueado ? estado.mensaje : opciones.mensaje || "") + "</div>" +
        (bloqueado ? "" :
          '<button type="button" data-accion="recuperacion-recuperar" class="btn btn-primario btn-ancho"' + (opciones.cargando ? " disabled" : "") + ">" +
          (opciones.cargando ? "Recuperando…" : "Recuperar mis datos") + "</button>") +
        '<button type="button" data-accion="recuperacion-cero" class="btn-enlace"' + (opciones.cargando ? " disabled" : "") + ">Empezar de cero</button>";
    }
    return (
      '<div class="pantalla-acceso pantalla-recuperacion">' +
      '<section class="acceso-card" aria-labelledby="recuperacion-titulo">' + cuerpo + "</section>" +
      "</div>"
    );
  }

  return {
    hayDatosLocalesUtiles: hayDatosLocalesUtiles,
    consultar: consultar,
    recuperar: recuperar,
    render: render
  };
})();
