/* SYNC-01/SYNC-02/SYNC-03: subida manual, descarga/restauración manual y
   actualización segura (con detección de conflictos) de
   gymNutritionTracker contra Supabase. Encapsula TODA la lógica de
   sincronización en la nube (auth.js sigue sin saber nada de datos_usuario,
   storage.js sigue sin saber nada de Supabase).

   SYNC-01 (ya publicado): solo subir por primera vez (crear la fila remota
   si no existe). Si ya existe una fila remota, NUNCA se sobrescribe desde la
   subida: se avisa y listo.

   SYNC-02 (ya publicado): permitir que un usuario en OTRO dispositivo
   recupere manualmente sus datos guardados en la nube. Es una acción
   explícita del usuario (nunca automática al iniciar sesión), con
   confirmación previa y backup local antes de tocar gymNutritionTracker.

   SYNC-03 (este alcance): "Sincronizar ahora", una acción explícita que
   actualiza la copia existente en la nube mediante la RPC
   actualizar_datos_usuario_seguro, que solo escribe si la revision remota
   sigue siendo la que este dispositivo conoce (control de concurrencia
   optimista). La última revision conocida se guarda en una clave aparte
   (gymNutritionTracker_syncMeta), nunca dentro de gymNutritionTracker. Ante
   cualquier diferencia (revision distinta, primera vez con datos distintos,
   conflicto devuelto por la RPC o cambio de cuenta) NO se pisa nada: se
   muestra el conflicto y el usuario elige qué hacer.

   A propósito acotado: nada de auto-restore al login, auto-sync, merge,
   last-write-wins, realtime ni listeners automáticos. */
var GYMAPP = window.GYMAPP || (window.GYMAPP = {});

GYMAPP.sync = (function () {
  var NOMBRE_RPC = "crear_datos_usuario_iniciales";
  var NOMBRE_TABLA = "datos_usuario";

  /* Clave de localStorage separada de "gymNutritionTracker": copia de
     seguridad temporal de los datos locales, creada justo antes de
     restaurar, para poder recuperarlos manualmente si algo sale mal. Es la
     ÚNICA clave de localStorage que este módulo escribe directamente; todo
     lo demás pasa siempre por la API pública de GYMAPP.storage. */
  var CLAVE_BACKUP_PRE_RESTORE = "gymNutritionTracker_preRestoreBackup";

  /* SYNC-03: RPC que actualiza la fila remota solo si su revision actual es
     p_expected_revision. El user_id lo resuelve la función con auth.uid();
     nunca se manda desde acá. */
  var NOMBRE_RPC_ACTUALIZAR = "actualizar_datos_usuario_seguro";

  /* SYNC-03: metadata de sincronización de ESTE dispositivo, en su propia
     clave (nunca dentro de gymNutritionTracker):
       { user_id, last_known_revision, last_sync_at }
     Es la segunda (y última) clave de localStorage que este módulo escribe
     directamente. */
  var CLAVE_SYNC_META = "gymNutritionTracker_syncMeta";

  /* Palabra que el usuario tiene que escribir para confirmar que quiere
     reemplazar la copia de la nube por sus datos locales en un conflicto. */
  var PALABRA_CONFIRMACION_SOBRESCRIBIR = "SOBRESCRIBIR";

  var MENSAJE_SCHEMA_DOWNGRADE = "La copia de la nube usa una versión de datos más nueva. Actualizá la app antes de sincronizar.";

  /* Estado efímero de la UI (no se persiste en ningún lado). Mismo mecanismo
     que usa auth.js para evitar doble click/doble submit; cubre las tres
     acciones (subir/recuperar/sincronizar) para que no se puedan disparar
     juntas. `conflicto` (SYNC-03) es null o el conflicto pendiente de
     resolución que muestra el panel: { motivo, userId, revisionConocida,
     revisionRemota }. */
  var estadoSync = { subiendo: false, restaurando: false, sincronizando: false, conflicto: null };

  function hayOperacionEnCurso() {
    return estadoSync.subiendo || estadoSync.restaurando || estadoSync.sincronizando;
  }

  function haySesionActiva() {
    var sesion = GYMAPP.auth && GYMAPP.auth.obtenerSesion ? GYMAPP.auth.obtenerSesion() : null;
    return !!(sesion && sesion.user);
  }

  function obtenerUserIdSesion() {
    var sesion = GYMAPP.auth && GYMAPP.auth.obtenerSesion ? GYMAPP.auth.obtenerSesion() : null;
    return sesion && sesion.user && sesion.user.id ? sesion.user.id : null;
  }

  function obtenerEmailSesion() {
    var sesion = GYMAPP.auth && GYMAPP.auth.obtenerSesion ? GYMAPP.auth.obtenerSesion() : null;
    return sesion && sesion.user ? sesion.user.email : null;
  }

  /* Llama a la RPC controlada crear_datos_usuario_iniciales (ver el SQL que
     el usuario ejecuta manualmente en Supabase). Envía EXACTAMENTE el
     objeto completo que devuelve GYMAPP.storage.getData(), sin tocarlo: sin
     agregar metadata de Supabase, sin quitar ni transformar nada. El
     user_id nunca se manda desde acá: la función lo obtiene solo con
     auth.uid() del lado del servidor.
     Devuelve una Promise que resuelve a "created" | "already_exists", o
     rechaza con el error (de red o de la RPC) para que el llamador decida
     cómo mostrarlo. Nunca modifica localStorage. */
  function subirPrimeraVez() {
    var cliente = GYMAPP.auth && GYMAPP.auth.obtenerCliente ? GYMAPP.auth.obtenerCliente() : null;
    if (!cliente || !haySesionActiva()) {
      return Promise.reject(new Error("Iniciá sesión antes de guardar en la nube."));
    }

    var datos = GYMAPP.storage.getData();

    return cliente.rpc(NOMBRE_RPC, {
      p_data: datos,
      p_schema_version: datos.schema_version
    }).then(function (resultado) {
      if (resultado && resultado.error) throw resultado.error;
      return resultado ? resultado.data : null;
    });
  }

  /* Consulta (SELECT, permitido por RLS) la fila remota del usuario
     autenticado. Nunca manda ni pide un user_id: RLS ya restringe la
     consulta a la fila del usuario logueado (auth.uid()). Solo lee las
     cuatro columnas que necesita; nunca toca contraseña, tokens ni sesión.
     Devuelve una Promise que resuelve a:
       { estado: "sin_datos_remotos" }               si no hay fila remota
       { estado: "ok", fila: { data, schema_version, revision, updated_at } }
     o rechaza si no hay sesión, o ante un error de red/consulta. */
  function obtenerDatosRemotos() {
    var cliente = GYMAPP.auth && GYMAPP.auth.obtenerCliente ? GYMAPP.auth.obtenerCliente() : null;
    if (!cliente || !haySesionActiva()) {
      return Promise.reject(new Error("Iniciá sesión antes de recuperar datos de la nube."));
    }

    return cliente
      .from(NOMBRE_TABLA)
      .select("data, schema_version, revision, updated_at")
      .maybeSingle()
      .then(function (resultado) {
        if (resultado && resultado.error) throw resultado.error;
        if (!resultado || !resultado.data) return { estado: "sin_datos_remotos" };
        return { estado: "ok", fila: resultado.data };
      });
  }

  /* Valida que `fila.data` (el payload remoto) sea algo que storage.js pueda
     interpretar con seguridad, y lo migra al esquema actual reutilizando
     exactamente la misma lógica que usa storage.js para datos locales
     (GYMAPP.storage.migrarDatos + el mismo merge contra getDefaultData()
     que hace storage.load()). Nunca asume que cualquier JSON remoto es
     válido: cualquier problema tira una excepción con un mensaje claro, sin
     tocar nada de storage.
     - No es un objeto / es null / es un array -> inválido.
     - No tiene las claves principales que la app espera (usuario, rutina)
       -> inválido.
     - schema_version remoto más nuevo que el que esta versión de la app
       soporta -> incompatible, se bloquea (igual que storage.js bloquea
       datos locales de una versión futura). */
  function validarYMigrarPayloadRemoto(fila) {
    var data = fila ? fila.data : null;

    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new Error("Los datos guardados en la nube no tienen un formato válido.");
    }
    if (!("usuario" in data) || !data.rutina || typeof data.rutina !== "object") {
      throw new Error("Los datos guardados en la nube no tienen la estructura esperada por la app.");
    }

    var schemaVersionRemota = typeof data.schema_version === "number" ? data.schema_version : 0;
    var versionSoportada = GYMAPP.storage.getDefaultData().schema_version;
    if (schemaVersionRemota > versionSoportada) {
      throw new Error(
        "Los datos guardados en la nube fueron creados por una versión más nueva de esta app (versión " +
        schemaVersionRemota + ") que la que tenés instalada ahora (versión " + versionSoportada +
        "). Actualizá la app antes de recuperar estos datos."
      );
    }

    var dataMigrada;
    try {
      dataMigrada = GYMAPP.storage.migrarDatos(data);
    } catch (e) {
      throw new Error("No se pudo procesar el formato de los datos guardados en la nube.");
    }

    /* Mismo merge que hace storage.load() tras migrar: completa cualquier
       colección que falte (sesiones_entrenamiento, registros_nutricion,
       etc.) sin pisar nada de lo que sí vino en el payload remoto. */
    return Object.assign(GYMAPP.storage.getDefaultData(), dataMigrada);
  }

  /* Backup local temporal, exclusivamente como protección ante una
     restauración fallida: guarda los datos locales actuales tal cual
     estaban, antes de reemplazarlos. No es parte del modelo de datos de la
     app (no toca schema_version ni gymNutritionTracker) y no se usa para
     nada más que esto. */
  function crearBackupLocalPreRestore(datosLocalesActuales, revisionRemota) {
    try {
      window.localStorage.setItem(CLAVE_BACKUP_PRE_RESTORE, JSON.stringify({
        data: datosLocalesActuales,
        fecha: new Date().toISOString(),
        revision_remota_a_restaurar: revisionRemota != null ? revisionRemota : null
      }));
      return true;
    } catch (e) {
      console.error("No se pudo crear la copia de seguridad local previa a restaurar", e);
      return false;
    }
  }

  /* --- SYNC-03: metadata local de sincronización --- */

  /* Devuelve la syncMeta guardada, o null si no existe o no tiene el
     formato esperado. Una syncMeta corrupta se trata igual que una
     inexistente: eso fuerza el camino más conservador (comparar local vs
     remoto y, si difieren, mostrar conflicto), nunca una subida directa. */
  function leerSyncMeta() {
    var raw;
    try {
      raw = window.localStorage.getItem(CLAVE_SYNC_META);
    } catch (e) {
      console.error("No se pudo leer la metadata de sincronización", e);
      return null;
    }
    if (!raw) return null;

    var meta;
    try {
      meta = JSON.parse(raw);
    } catch (e) {
      console.error("Metadata de sincronización corrupta; se ignora", e);
      return null;
    }
    if (!meta || typeof meta !== "object" || typeof meta.user_id !== "string" || !meta.user_id) return null;
    if (typeof meta.last_known_revision !== "number" || !isFinite(meta.last_known_revision)) return null;
    return meta;
  }

  /* Escribe la syncMeta. Se llama SOLO después de confirmar que este
     dispositivo y la nube quedaron con los mismos datos en `revision`.
     Devuelve true/false; un fallo nunca toca gymNutritionTracker. */
  function guardarSyncMeta(userId, revision) {
    try {
      window.localStorage.setItem(CLAVE_SYNC_META, JSON.stringify({
        user_id: userId,
        last_known_revision: revision,
        last_sync_at: new Date().toISOString()
      }));
      return true;
    } catch (e) {
      console.error("No se pudo guardar la metadata de sincronización", e);
      return false;
    }
  }

  /* La revision llega de Supabase como number (o como string si el bigint
     no entra en un number de JS). Devuelve un number o null si no sirve. */
  function normalizarRevision(valor) {
    if (typeof valor === "number" && isFinite(valor)) return valor;
    if (typeof valor === "string" && /^\d+$/.test(valor)) return Number(valor);
    return null;
  }

  /* --- SYNC-03: comparación estructural --- */

  /* JSON canónico: mismas claves ordenadas en cualquier nivel, así dos
     objetos con los mismos datos pero distinto orden de claves (algo
     habitual al pasar por jsonb en Postgres) se consideran iguales. */
  function serializarCanonico(valor) {
    if (Array.isArray(valor)) {
      return "[" + valor.map(serializarCanonico).join(",") + "]";
    }
    if (valor && typeof valor === "object") {
      return "{" + Object.keys(valor).sort().filter(function (k) {
        return valor[k] !== undefined;
      }).map(function (k) {
        return JSON.stringify(k) + ":" + serializarCanonico(valor[k]);
      }).join(",") + "}";
    }
    return JSON.stringify(valor === undefined ? null : valor);
  }

  function sonEstructuralmenteEquivalentes(a, b) {
    return serializarCanonico(a) === serializarCanonico(b);
  }

  /* --- SYNC-03: RPC de actualización segura --- */

  /* La RPC puede devolver un objeto jsonb ({ status, revision, ... }), una
     fila de una función RETURNS TABLE (array) o directamente el texto del
     status. Se normaliza a { status, revision } sin asumir más que eso. */
  function normalizarRespuestaActualizar(data) {
    var r = Array.isArray(data) ? data[0] : data;
    if (typeof r === "string") return { status: r, revision: null };
    if (!r || typeof r !== "object") return { status: null, revision: null };
    return {
      status: r.status || null,
      revision: normalizarRevision(
        r.revision != null ? r.revision : (r.new_revision != null ? r.new_revision : r.current_revision)
      )
    };
  }

  function llamarActualizarSeguro(datos, expectedRevision) {
    var cliente = GYMAPP.auth && GYMAPP.auth.obtenerCliente ? GYMAPP.auth.obtenerCliente() : null;
    if (!cliente || !haySesionActiva()) {
      return Promise.reject(new Error("Iniciá sesión antes de sincronizar."));
    }
    return cliente.rpc(NOMBRE_RPC_ACTUALIZAR, {
      p_data: datos,
      p_schema_version: datos.schema_version,
      p_expected_revision: expectedRevision
    }).then(function (resultado) {
      if (resultado && resultado.error) throw resultado.error;
      return normalizarRespuestaActualizar(resultado ? resultado.data : null);
    });
  }

  /* Después de una escritura exitosa en la nube, define qué revision queda
     como baseline. Si la RPC la informó, se usa esa. Si no, se vuelve a leer
     la fila y SOLO se adopta su revision si los datos remotos son
     exactamente los que se acaban de enviar: si otro dispositivo escribió
     en el medio, no se registra nada y la próxima sincronización va a
     mostrar conflicto en vez de pisar ese cambio. */
  function registrarBaselineTrasEscritura(userId, datosEnviados, revisionInformada) {
    if (revisionInformada != null) {
      return Promise.resolve({ revision: revisionInformada, metaGuardada: guardarSyncMeta(userId, revisionInformada) });
    }
    return obtenerDatosRemotos().then(function (resultado) {
      if (resultado.estado !== "ok") return { revision: null, metaGuardada: false };
      var revision = normalizarRevision(resultado.fila.revision);
      if (revision == null || !sonEstructuralmenteEquivalentes(resultado.fila.data, datosEnviados)) {
        return { revision: revision, metaGuardada: false };
      }
      return { revision: revision, metaGuardada: guardarSyncMeta(userId, revision) };
    });
  }

  function versionSoportada() {
    return GYMAPP.storage.getDefaultData().schema_version;
  }

  /* Chequeos comunes antes de cualquier escritura en la nube de SYNC-03:
     sesión con user id y datos locales que esta versión de la app entiende
     (si storage.js detectó datos de un esquema futuro, nunca se suben). */
  function prepararEscritura() {
    var cliente = GYMAPP.auth && GYMAPP.auth.obtenerCliente ? GYMAPP.auth.obtenerCliente() : null;
    var userId = obtenerUserIdSesion();
    if (!cliente || !haySesionActiva() || !userId) {
      throw new Error("Iniciá sesión antes de sincronizar.");
    }
    var datos = GYMAPP.storage.getData();
    var versionLocal = typeof datos.schema_version === "number" ? datos.schema_version : 0;
    if (versionLocal > versionSoportada()) {
      throw new Error("Los datos de este dispositivo son de una versión más nueva de la app. Actualizá la app antes de sincronizar.");
    }
    return { userId: userId, datos: datos };
  }

  function esSchemaRemotoFuturo(fila) {
    var soportada = versionSoportada();
    var columna = normalizarRevision(fila.schema_version);
    var enData = fila.data && typeof fila.data.schema_version === "number" ? fila.data.schema_version : 0;
    return (columna != null && columna > soportada) || enData > soportada;
  }

  /* Rama "no hay fila remota": reutiliza tal cual el flujo seguro de
     SYNC-01 (que nunca sobrescribe) y, si creó la fila, registra la
     baseline. */
  function crearFilaRemotaYRegistrar(userId, datos) {
    return subirPrimeraVez().then(function (estado) {
      if (estado === "created") {
        return registrarBaselineTrasEscritura(userId, datos, null).then(function (r) {
          return { estado: "creado", revision: r.revision, metaGuardada: r.metaGuardada };
        });
      }
      if (estado === "already_exists") {
        /* Otro dispositivo creó la fila entre la consulta y la subida. */
        return { estado: "conflicto", motivo: "fila_creada_en_paralelo", userId: userId, revisionConocida: null, revisionRemota: null };
      }
      throw new Error("Respuesta inesperada del servidor al crear la copia en la nube.");
    });
  }

  /* Interpreta la respuesta de actualizar_datos_usuario_seguro. Solo un
     "updated" registra baseline; "conflict" vuelve al panel de conflicto. */
  function procesarRespuestaActualizar(respuesta, userId, datos, expectedRevision) {
    if (respuesta.status === "updated") {
      return registrarBaselineTrasEscritura(userId, datos, respuesta.revision).then(function (r) {
        return { estado: "actualizado", revision: r.revision, metaGuardada: r.metaGuardada };
      });
    }
    if (respuesta.status === "conflict") {
      return {
        estado: "conflicto", motivo: "rpc_conflict", userId: userId,
        revisionConocida: expectedRevision, revisionRemota: respuesta.revision
      };
    }
    /* E0: el servidor rechazó la escritura porque la nube tiene un schema
       más nuevo. No se toca la nube, no se avanza la syncMeta, no se
       reintenta ni se restaura nada. */
    if (respuesta.status === "schema_downgrade") {
      throw new Error(MENSAJE_SCHEMA_DOWNGRADE);
    }
    throw new Error("Respuesta inesperada del servidor. No se pudo confirmar la sincronización.");
  }

  /* Flujo de "Sincronizar ahora" (SYNC-03), sin UI. Devuelve una Promise
     que resuelve a { estado, ... } con estado:
       "cuenta_distinta"   la syncMeta es de otro usuario: no se consulta ni
                           se sube nada.
       "creado"            no había fila remota; se creó con SYNC-01.
       "baseline_adoptado" primera vez, local == remoto: solo se registra
                           la revision remota, sin subir nada.
       "sin_cambios"       revision conocida y datos iguales: no se sube.
       "actualizado"       la RPC respondió "updated".
       "conflicto"         motivo: "sin_baseline" | "revision_distinta" |
                           "rpc_conflict" | "fila_creada_en_paralelo".
     o rechaza ante falta de sesión, schema futuro (local o remoto), payload
     remoto inválido o error de red/RPC. Nunca escribe gymNutritionTracker. */
  function sincronizarAhora() {
    var contexto;
    try {
      contexto = prepararEscritura();
    } catch (e) {
      return Promise.reject(e);
    }
    var userId = contexto.userId;
    var datos = contexto.datos;

    var meta = leerSyncMeta();
    if (meta && meta.user_id !== userId) {
      return Promise.resolve({ estado: "cuenta_distinta", userId: userId });
    }

    return obtenerDatosRemotos().then(function (resultado) {
      if (resultado.estado === "sin_datos_remotos") {
        return crearFilaRemotaYRegistrar(userId, datos);
      }

      var fila = resultado.fila;
      var revisionRemota = normalizarRevision(fila.revision);
      if (revisionRemota == null) {
        throw new Error("La copia de la nube no informa una revisión válida.");
      }
      if (esSchemaRemotoFuturo(fila)) {
        throw new Error("Los datos guardados en la nube fueron creados por una versión más nueva de esta app. Actualizá la app antes de sincronizar.");
      }

      /* Misma validación/migración que SYNC-02, para comparar contra los
         datos locales en el mismo formato (getData() también devuelve datos
         migrados y completados). Tira si el payload remoto es inválido. */
      var remotoComparable = validarYMigrarPayloadRemoto({ data: JSON.parse(JSON.stringify(fila.data)) });
      var iguales = sonEstructuralmenteEquivalentes(datos, remotoComparable);

      if (!meta) {
        if (iguales) {
          return { estado: "baseline_adoptado", revision: revisionRemota, metaGuardada: guardarSyncMeta(userId, revisionRemota) };
        }
        return { estado: "conflicto", motivo: "sin_baseline", userId: userId, revisionConocida: null, revisionRemota: revisionRemota };
      }

      if (meta.last_known_revision !== revisionRemota) {
        return {
          estado: "conflicto", motivo: "revision_distinta", userId: userId,
          revisionConocida: meta.last_known_revision, revisionRemota: revisionRemota
        };
      }

      if (iguales) {
        return { estado: "sin_cambios", revision: revisionRemota, metaGuardada: guardarSyncMeta(userId, revisionRemota) };
      }

      return llamarActualizarSeguro(datos, revisionRemota).then(function (respuesta) {
        return procesarRespuestaActualizar(respuesta, userId, datos, revisionRemota);
      });
    });
  }

  /* Opción "Conservar datos locales" de un conflicto (SYNC-03). Se llama
     recién después de la confirmación fuerte del usuario. Vuelve a consultar
     la revision remota EN ESTE MOMENTO y la manda como expected_revision:
     si la nube cambió otra vez en el medio, la RPC responde "conflict" y se
     vuelve al panel. Nunca hay una escritura sin expected_revision. Mismos
     estados de resultado que sincronizarAhora(). */
  function conservarLocalYActualizar() {
    var contexto;
    try {
      contexto = prepararEscritura();
    } catch (e) {
      return Promise.reject(e);
    }
    var userId = contexto.userId;
    var datos = contexto.datos;

    var meta = leerSyncMeta();
    if (meta && meta.user_id !== userId) {
      return Promise.resolve({ estado: "cuenta_distinta", userId: userId });
    }

    return obtenerDatosRemotos().then(function (resultado) {
      if (resultado.estado === "sin_datos_remotos") {
        return crearFilaRemotaYRegistrar(userId, datos);
      }
      var fila = resultado.fila;
      var revisionRemota = normalizarRevision(fila.revision);
      if (revisionRemota == null) {
        throw new Error("La copia de la nube no informa una revisión válida.");
      }
      if (esSchemaRemotoFuturo(fila)) {
        throw new Error("Los datos guardados en la nube fueron creados por una versión más nueva de esta app. No se van a reemplazar desde esta versión.");
      }
      return llamarActualizarSeguro(datos, revisionRemota).then(function (respuesta) {
        return procesarRespuestaActualizar(respuesta, userId, datos, revisionRemota);
      });
    });
  }

  /* --- UI: sección "Sincronización", embebida en la pantalla de Rutina,
     entre "Cuenta" y "Copia de seguridad" --- */

  function renderSeccionSincronizacion() {
    if (!haySesionActiva()) {
      return (
        '<div class="seccion-sincronizacion">' +
        "<h3>Sincronización</h3>" +
        '<p class="nota">Iniciá sesión para guardar tus datos en la nube y usarlos en otros dispositivos.</p>' +
        "</div>"
      );
    }

    var email = obtenerEmailSesion();
    var ocupado = hayOperacionEnCurso();

    /* Un conflicto pendiente de otra sesión (ej. se cerró sesión y se entró
       con otra cuenta) no se muestra: se descarta. */
    if (estadoSync.conflicto && estadoSync.conflicto.userId !== obtenerUserIdSesion()) {
      estadoSync.conflicto = null;
    }

    return (
      '<div class="seccion-sincronizacion">' +
      "<h3>Sincronización</h3>" +
      '<div id="sync-mensaje" class="mensaje oculto"></div>' +
      '<p class="nota">Conectado como ' + GYMAPP.util.escapeHtml(email || "") + "</p>" +
      '<div class="sync-ahora">' +
      '<p class="nota">Actualizá la copia de la nube con los cambios de este dispositivo. ' +
      "Si la nube cambió desde otro dispositivo, no se pisa nada: vas a poder elegir qué hacer.</p>" +
      '<p class="nota" id="sync-ultima">' + GYMAPP.util.escapeHtml(textoUltimaSincronizacion()) + "</p>" +
      '<button type="button" data-accion="sincronizar-ahora" class="btn btn-primario btn-ancho"' +
      (ocupado ? " disabled" : "") + ">" +
      (estadoSync.sincronizando ? "Sincronizando..." : "🔄 Sincronizar ahora") +
      "</button>" +
      '<div id="sync-conflicto-contenedor">' + renderPanelConflicto() + "</div>" +
      "</div>" +
      '<p class="nota">Guardá tus datos en la nube o recuperalos desde otro dispositivo.</p>' +
      '<button type="button" data-accion="subir-a-la-nube" class="btn btn-primario btn-ancho"' +
      (ocupado ? " disabled" : "") + ">" +
      (estadoSync.subiendo ? "Guardando..." : "☁️ Guardar en la nube") +
      "</button>" +
      '<button type="button" data-accion="recuperar-de-la-nube" class="btn btn-secundario btn-ancho"' +
      (ocupado ? " disabled" : "") + ">" +
      (estadoSync.restaurando ? "Restaurando..." : "☁️ Recuperar desde la nube") +
      "</button>" +
      "</div>"
    );
  }

  /* Se debe llamar una única vez por contenedor: el módulo que embebe esta
     sección (rutina.js) ya garantiza esto con su propio guard de
     bindEventos, igual que hace con GYMAPP.auth.bindEventosCuenta. */
  function bindEventosSincronizacion(container) {
    container.addEventListener("click", function (ev) {
      var botonSincronizar = ev.target.closest('[data-accion="sincronizar-ahora"]');
      if (botonSincronizar) {
        manejarSincronizarAhora(container);
        return;
      }
      var botonConflicto = ev.target.closest(
        '[data-accion="conflicto-usar-nube"], [data-accion="conflicto-conservar-local"], [data-accion="conflicto-cancelar"]'
      );
      if (botonConflicto) {
        manejarOpcionConflicto(container, botonConflicto.dataset.accion);
        return;
      }
      var botonSubir = ev.target.closest('[data-accion="subir-a-la-nube"]');
      if (botonSubir) {
        manejarSubirALaNube(container, botonSubir);
        return;
      }
      var botonRecuperar = ev.target.closest('[data-accion="recuperar-de-la-nube"]');
      if (botonRecuperar) {
        manejarRecuperarDeLaNube(container, botonRecuperar);
      }
    });
  }

  function actualizarBotones(container) {
    var ocupado = hayOperacionEnCurso();

    var botonSincronizar = container.querySelector('[data-accion="sincronizar-ahora"]');
    if (botonSincronizar) {
      botonSincronizar.disabled = ocupado;
      botonSincronizar.textContent = estadoSync.sincronizando ? "Sincronizando..." : "🔄 Sincronizar ahora";
    }

    var botonSubir = container.querySelector('[data-accion="subir-a-la-nube"]');
    if (botonSubir) {
      botonSubir.disabled = ocupado;
      botonSubir.textContent = estadoSync.subiendo ? "Guardando..." : "☁️ Guardar en la nube";
    }

    var botonRecuperar = container.querySelector('[data-accion="recuperar-de-la-nube"]');
    if (botonRecuperar) {
      botonRecuperar.disabled = ocupado;
      botonRecuperar.textContent = estadoSync.restaurando ? "Restaurando..." : "☁️ Recuperar desde la nube";
    }
  }

  function mostrarMensajeSync(container, texto, tipo) {
    var el = container.querySelector("#sync-mensaje");
    if (!el) return;
    el.textContent = texto;
    el.className = "mensaje " + (tipo || "info");
  }

  function manejarSubirALaNube(container, boton) {
    /* Guard sincrónico contra doble click/doble submit (y contra disparar
       una subida mientras hay otra operación en curso): se pone en true
       acá mismo, antes de que exista ninguna promesa en curso. */
    if (hayOperacionEnCurso()) return;

    estadoSync.subiendo = true;
    actualizarBotones(container);
    mostrarMensajeSync(container, "Guardando...", "info");

    subirPrimeraVez()
      .then(function (estado) {
        estadoSync.subiendo = false;
        actualizarBotones(container);

        if (estado === "created") {
          mostrarMensajeSync(container, "Datos guardados en la nube. Revisión: 1", "exito");
        } else if (estado === "already_exists") {
          mostrarMensajeSync(container, "No se sobrescribió nada. Ya existen datos guardados en la nube.", "info");
        } else {
          mostrarMensajeSync(container, "Respuesta inesperada del servidor. No se pudo confirmar el guardado.", "error");
        }
      })
      .catch(function (error) {
        estadoSync.subiendo = false;
        actualizarBotones(container);
        console.error("Error al guardar en la nube (crear_datos_usuario_iniciales)", error);
        var detalle = (error && error.message) || "error desconocido";
        mostrarMensajeSync(container, "No se pudo guardar en la nube: " + detalle + ". Tus datos locales no se modificaron.", "error");
      });
  }

  /* Flujo completo de "Recuperar desde la nube" (SYNC-02):
       1. Consultar la fila remota (nunca automática, solo al tocar el botón).
       2. Si no hay fila remota, avisar y terminar sin tocar nada local.
       3. Si hay fila remota, pedir confirmación EXPLÍCITA mostrando
          revisión / fecha de actualización / schema_version, antes de
          tocar cualquier dato local.
       4. Si cancela, no se toca nada: gymNutritionTracker queda intacto.
       5. Si confirma, validar y migrar el payload remoto. Si es inválido o
          incompatible, avisar y no tocar nada local.
       6. Crear un backup local temporal de los datos actuales.
       7. Recién ahí, guardar los datos remotos ya migrados mediante la API
          pública de GYMAPP.storage (nunca localStorage directo, salvo el
          backup del paso anterior).
       8. Si el guardado falla, los datos locales anteriores nunca se
          tocaron (localStorage.setItem no escribe parcialmente) y el
          backup ya creado queda disponible igual.
     Ninguna de estas operaciones escribe nada en Supabase: es solo lectura
     (revision remota nunca cambia, la nube nunca se modifica acá). */
  function manejarRecuperarDeLaNube(container, boton) {
    if (hayOperacionEnCurso()) return;

    /* SYNC-03: user id de la sesión con la que se inicia la restauración,
       para registrar la syncMeta de esa misma cuenta si sale bien. */
    var userIdRestauracion = obtenerUserIdSesion();

    estadoSync.restaurando = true;
    actualizarBotones(container);
    mostrarMensajeSync(container, "Consultando datos en la nube...", "info");

    obtenerDatosRemotos()
      .then(function (resultado) {
        if (resultado.estado === "sin_datos_remotos") {
          estadoSync.restaurando = false;
          actualizarBotones(container);
          mostrarMensajeSync(container, "No hay datos guardados en la nube.", "info");
          return;
        }

        var fila = resultado.fila;
        var fechaLegible = fila.updated_at ? new Date(fila.updated_at).toLocaleString("es-AR") : "sin fecha disponible";
        var confirmado = window.confirm(
          "Esto reemplazará los datos actuales de este dispositivo por la copia guardada en la nube.\n\n" +
          "Revisión remota: " + (fila.revision != null ? fila.revision : "desconocida") + "\n" +
          "Última actualización: " + fechaLegible + "\n" +
          "Versión de esquema: " + (fila.schema_version != null ? fila.schema_version : "desconocida") + "\n\n" +
          "¿Confirmás que querés reemplazar tus datos locales?"
        );

        if (!confirmado) {
          estadoSync.restaurando = false;
          actualizarBotones(container);
          mostrarMensajeSync(container, "Restauración cancelada. Tus datos locales no se modificaron.", "info");
          return;
        }

        var dataValidada;
        try {
          dataValidada = validarYMigrarPayloadRemoto(fila);
        } catch (errorValidacion) {
          estadoSync.restaurando = false;
          actualizarBotones(container);
          mostrarMensajeSync(container, errorValidacion.message, "error");
          return;
        }

        var datosLocalesActuales = GYMAPP.storage.getData();
        var backupCreado = crearBackupLocalPreRestore(datosLocalesActuales, fila.revision);
        if (!backupCreado) {
          estadoSync.restaurando = false;
          actualizarBotones(container);
          mostrarMensajeSync(container, "No se pudo crear una copia de seguridad local antes de restaurar. No se modificaron tus datos.", "error");
          return;
        }

        var guardadoExitoso = GYMAPP.storage.save(dataValidada, { alertaAutomatica: false });
        estadoSync.restaurando = false;
        actualizarBotones(container);

        if (!guardadoExitoso) {
          mostrarMensajeSync(container, "No se pudo restaurar: falló el guardado local. Tus datos anteriores se conservan intactos.", "error");
          return;
        }

        /* SYNC-03: este dispositivo quedó con los datos de `fila.revision`,
           así que esa pasa a ser su baseline. Solo después del guardado
           exitoso; si falla, la próxima "Sincronizar ahora" compara datos y
           adopta la baseline sola (nunca sube nada a ciegas). */
        var revisionRestaurada = normalizarRevision(fila.revision);
        if (userIdRestauracion && revisionRestaurada != null) {
          guardarSyncMeta(userIdRestauracion, revisionRestaurada);
        }
        estadoSync.conflicto = null;

        mostrarMensajeSync(container, "Datos restaurados correctamente. Recargando la app...", "exito");
        setTimeout(function () { window.location.reload(); }, 1200);
      })
      .catch(function (error) {
        estadoSync.restaurando = false;
        actualizarBotones(container);
        console.error("Error al recuperar datos de la nube", error);
        var detalle = (error && error.message) || "error desconocido";
        mostrarMensajeSync(container, "No se pudo consultar la nube: " + detalle + ".", "error");
      });
  }

  /* --- SYNC-03: UI de "Sincronizar ahora" y del panel de conflicto --- */

  function textoUltimaSincronizacion() {
    var meta = leerSyncMeta();
    if (!meta || meta.user_id !== obtenerUserIdSesion()) {
      return "Este dispositivo todavía no se sincronizó con esta cuenta.";
    }
    var fecha = meta.last_sync_at ? new Date(meta.last_sync_at).toLocaleString("es-AR") : "sin fecha";
    return "Última sincronización: " + fecha + " (revisión " + meta.last_known_revision + ").";
  }

  function textoConflicto(c) {
    if (c.motivo === "cuenta_distinta") {
      return "Los datos de este dispositivo se sincronizaron por última vez con OTRA cuenta. " +
        "Para no mezclar datos entre cuentas, no se subió nada a la nube.";
    }
    if (c.motivo === "sin_baseline") {
      return "Este dispositivo nunca se sincronizó con esta cuenta y sus datos no coinciden con la copia de la nube " +
        "(revisión " + c.revisionRemota + "). No se sobrescribió nada.";
    }
    if (c.motivo === "revision_distinta") {
      return "La copia de la nube cambió desde la última sincronización de este dispositivo, probablemente desde otro " +
        "dispositivo (revisión conocida: " + c.revisionConocida + ", revisión en la nube: " + c.revisionRemota + "). " +
        "No se sobrescribió nada.";
    }
    if (c.motivo === "fila_creada_en_paralelo") {
      return "Se creó una copia en la nube desde otro dispositivo mientras se sincronizaba. No se sobrescribió nada.";
    }
    return "La copia de la nube cambió mientras se intentaba actualizarla. No se sobrescribió nada.";
  }

  function renderPanelConflicto() {
    var c = estadoSync.conflicto;
    if (!c) return "";
    var ocupado = hayOperacionEnCurso() ? " disabled" : "";
    var esCuenta = c.motivo === "cuenta_distinta";

    return (
      '<div class="sync-conflicto" role="alert">' +
      "<p><strong>" + (esCuenta ? "Cambio de cuenta detectado" : "Conflicto de sincronización") + "</strong></p>" +
      '<p class="nota">' + GYMAPP.util.escapeHtml(textoConflicto(c)) + "</p>" +
      '<button type="button" data-accion="conflicto-usar-nube" class="btn btn-secundario btn-ancho"' + ocupado + ">" +
      (esCuenta ? "☁️ Recuperar datos de la nube de esta cuenta" : "☁️ Usar datos de la nube") +
      "</button>" +
      (esCuenta ? "" :
        '<button type="button" data-accion="conflicto-conservar-local" class="btn btn-secundario btn-ancho"' + ocupado + ">" +
        "📱 Conservar datos de este dispositivo</button>") +
      '<button type="button" data-accion="conflicto-cancelar" class="btn btn-secundario btn-ancho"' + ocupado + ">" +
      (esCuenta ? "Conservar datos locales sin sincronizar" : "Cancelar") +
      "</button>" +
      "</div>"
    );
  }

  function actualizarPanelConflicto(container) {
    var el = container.querySelector("#sync-conflicto-contenedor");
    if (el) el.innerHTML = renderPanelConflicto();
  }

  function actualizarUltimaSincronizacion(container) {
    var el = container.querySelector("#sync-ultima");
    if (el) el.textContent = textoUltimaSincronizacion();
  }

  /* Muestra el resultado de sincronizarAhora()/conservarLocalYActualizar(). */
  function mostrarResultadoSincronizacion(container, r) {
    var avisoMeta = " Aviso: no se pudo registrar la revisión en este dispositivo; la próxima sincronización va a pedir que confirmes qué datos conservar.";

    if (r.estado === "cuenta_distinta") {
      estadoSync.conflicto = { motivo: "cuenta_distinta", userId: r.userId, revisionConocida: null, revisionRemota: null };
      mostrarMensajeSync(container, "Sincronización bloqueada: los datos locales pertenecen a otra cuenta.", "error");
    } else if (r.estado === "conflicto") {
      estadoSync.conflicto = {
        motivo: r.motivo, userId: r.userId, revisionConocida: r.revisionConocida, revisionRemota: r.revisionRemota
      };
      mostrarMensajeSync(container, "Conflicto detectado: elegí qué datos conservar.", "error");
    } else {
      estadoSync.conflicto = null;
      var texto;
      if (r.estado === "creado") {
        texto = "Datos guardados en la nube por primera vez" + (r.revision != null ? ". Revisión: " + r.revision : "") + ".";
      } else if (r.estado === "baseline_adoptado") {
        texto = "Este dispositivo ya tenía los mismos datos que la nube (revisión " + r.revision + "). No hizo falta subir nada.";
      } else if (r.estado === "sin_cambios") {
        texto = "Ya estaba todo sincronizado (revisión " + r.revision + "). No hizo falta subir nada.";
      } else {
        texto = "Datos sincronizados con la nube" + (r.revision != null ? ". Revisión: " + r.revision : "") + ".";
      }
      mostrarMensajeSync(container, texto + (r.metaGuardada ? "" : avisoMeta), r.metaGuardada ? "exito" : "info");
    }
    actualizarPanelConflicto(container);
    actualizarUltimaSincronizacion(container);
  }

  function ejecutarSincronizacion(container, operacion, textoEnCurso) {
    if (hayOperacionEnCurso()) return;

    estadoSync.sincronizando = true;
    actualizarBotones(container);
    actualizarPanelConflicto(container);
    mostrarMensajeSync(container, textoEnCurso, "info");

    operacion()
      .then(function (resultado) {
        estadoSync.sincronizando = false;
        actualizarBotones(container);
        mostrarResultadoSincronizacion(container, resultado);
      })
      .catch(function (error) {
        estadoSync.sincronizando = false;
        actualizarBotones(container);
        actualizarPanelConflicto(container);
        console.error("Error al sincronizar con la nube", error);
        var detalle = (error && error.message) || "error desconocido";
        if (!/[.!?]$/.test(detalle)) detalle += ".";
        mostrarMensajeSync(container, "No se pudo sincronizar: " + detalle + " Tus datos locales y la nube no se modificaron.", "error");
      });
  }

  function manejarSincronizarAhora(container) {
    ejecutarSincronizacion(container, sincronizarAhora, "Sincronizando...");
  }

  function manejarOpcionConflicto(container, accion) {
    if (hayOperacionEnCurso() || !estadoSync.conflicto) return;
    var esCuenta = estadoSync.conflicto.motivo === "cuenta_distinta";

    if (accion === "conflicto-cancelar") {
      estadoSync.conflicto = null;
      actualizarPanelConflicto(container);
      mostrarMensajeSync(container, esCuenta
        ? "Se conservan los datos locales sin sincronizar. No se modificó nada."
        : "Sincronización cancelada. No se modificó nada, ni en este dispositivo ni en la nube.", "info");
      return;
    }

    if (accion === "conflicto-usar-nube") {
      /* Reutiliza el flujo completo de SYNC-02: confirmación, validación,
         backup previo obligatorio, guardado vía storage y syncMeta. */
      estadoSync.conflicto = null;
      actualizarPanelConflicto(container);
      manejarRecuperarDeLaNube(container, null);
      return;
    }

    if (accion === "conflicto-conservar-local" && !esCuenta) {
      var respuesta = window.prompt(
        "Esto va a REEMPLAZAR la copia guardada en la nube por los datos de este dispositivo.\n\n" +
        "Los cambios hechos desde otro dispositivo que no estén acá se van a perder en la nube.\n\n" +
        "Para confirmar, escribí " + PALABRA_CONFIRMACION_SOBRESCRIBIR + ":"
      );
      if (respuesta == null || String(respuesta).trim() !== PALABRA_CONFIRMACION_SOBRESCRIBIR) {
        mostrarMensajeSync(container, "No se confirmó el reemplazo. No se modificó nada.", "info");
        return;
      }
      ejecutarSincronizacion(container, conservarLocalYActualizar, "Actualizando la nube con los datos de este dispositivo...");
    }
  }

  return {
    renderSeccionSincronizacion: renderSeccionSincronizacion,
    bindEventosSincronizacion: bindEventosSincronizacion,
    /* Expuestas para pruebas y para las futuras etapas. */
    subirPrimeraVez: subirPrimeraVez,
    obtenerDatosRemotos: obtenerDatosRemotos,
    validarYMigrarPayloadRemoto: validarYMigrarPayloadRemoto,
    sincronizarAhora: sincronizarAhora,
    conservarLocalYActualizar: conservarLocalYActualizar,
    leerSyncMeta: leerSyncMeta,
    sonEstructuralmenteEquivalentes: sonEstructuralmenteEquivalentes
  };
})();
