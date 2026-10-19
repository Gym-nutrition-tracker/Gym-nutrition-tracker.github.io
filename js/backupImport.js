/* Importación manual de backups (E0): preparación y aplicación separadas.

   prepararImportacionBackup(texto) no escribe NADA: parsea, valida la
   estructura mínima, rechaza schemas más nuevos que los que entiende esta
   app, migra en memoria con las migraciones existentes de storage.js,
   completa los campos ausentes igual que storage.load() y valida el
   resultado.

   aplicarImportacionBackup(preparado, info) escribe, en este orden:
     1. copia previa de los datos locales actuales
        (gymNutritionTracker_preImportBackup); si falla, aborta;
     2. invalida la baseline de SYNC-03 (borra gymNutritionTracker_syncMeta):
        un backup importado ya no representa la revisión que conocía este
        dispositivo; si no se puede borrar, aborta sin tocar los datos;
     3. guarda los datos nuevos mediante GYMAPP.storage.save().
   Si el paso 3 falla, los datos anteriores quedan intactos y la syncMeta
   queda ausente: la próxima sincronización compara antes de subir nada
   (estado seguro, a propósito no se restaura la baseline). */
var GYMAPP = window.GYMAPP || (window.GYMAPP = {});

GYMAPP.backupImport = (function () {
  var CLAVE_DATOS = "gymNutritionTracker";
  var CLAVE_BACKUP_PRE_IMPORT = "gymNutritionTracker_preImportBackup";
  var CLAVE_SYNC_META = "gymNutritionTracker_syncMeta";

  var CLAVES_BACKUP = ["usuario", "rutina", "sesiones_entrenamiento", "registros_nutricion", "base_alimentos", "medidas_corporales"];
  var COLECCIONES = ["sesiones_entrenamiento", "registros_nutricion", "base_alimentos", "medidas_corporales"];

  var MENSAJE_FORMATO = "El archivo no tiene el formato esperado de un backup de esta app.";

  function esObjeto(v) {
    return !!v && typeof v === "object" && !Array.isArray(v);
  }

  function esIdValido(v) {
    return (typeof v === "string" && v.length > 0) || typeof v === "number";
  }

  function fallo(mensaje) {
    return { ok: false, error: mensaje };
  }

  /* Estructura mínima común a todas las versiones (antes y después de
     migrar). Solo verifica lo imprescindible; nunca corrige nada. */
  function validarEstructura(datos) {
    if (datos.usuario !== null && !esObjeto(datos.usuario)) return "El usuario del backup no tiene un formato válido.";
    if (!esObjeto(datos.rutina)) return "La rutina del backup no tiene un formato válido.";

    for (var i = 0; i < COLECCIONES.length; i++) {
      if (!Array.isArray(datos[COLECCIONES[i]])) return MENSAJE_FORMATO;
    }

    var sesionesValidas = datos.sesiones_entrenamiento.every(function (s) {
      if (!esObjeto(s) || !esIdValido(s.id) || typeof s.fecha !== "string" || !s.fecha) return false;
      if (s.ejercicios_realizados === undefined || s.ejercicios_realizados === null) return true;
      return Array.isArray(s.ejercicios_realizados) && s.ejercicios_realizados.every(function (er) {
        return esObjeto(er) && (er.series === undefined || Array.isArray(er.series));
      });
    });
    if (!sesionesValidas) return "Hay sesiones de entrenamiento con un formato inválido.";

    return null;
  }

  /* Rutina de un backup schema 0/1/2 (rutina.dias), antes de migrarlo.
     Es la única lectura de rutina.dias: el formato viejo de los archivos. */
  function validarRutinaAnterior(datos) {
    if (!Array.isArray(datos.rutina.dias)) return "La rutina del backup no tiene un formato válido.";
    var diasValidos = datos.rutina.dias.every(function (dia) {
      return esObjeto(dia) && esIdValido(dia.id) && Array.isArray(dia.ejercicios) &&
        dia.ejercicios.every(function (ej) { return esObjeto(ej) && esIdValido(ej.id); });
    });
    if (!diasValidos) return "Hay días o ejercicios de la rutina sin un identificador válido.";
    return null;
  }

  function prepararImportacionBackup(texto) {
    var datos;
    try {
      datos = JSON.parse(texto);
    } catch (e) {
      return fallo("El archivo no es un JSON válido.");
    }

    if (!esObjeto(datos)) return fallo(MENSAJE_FORMATO);
    var tieneClaves = CLAVES_BACKUP.every(function (clave) { return Object.prototype.hasOwnProperty.call(datos, clave); });
    if (!tieneClaves) return fallo(MENSAJE_FORMATO);

    var versionSoportada = GYMAPP.storage.getDefaultData().schema_version;
    var versionOrigen;
    if (datos.schema_version === undefined || datos.schema_version === null) {
      versionOrigen = 0;
    } else if (typeof datos.schema_version === "number" && Math.floor(datos.schema_version) === datos.schema_version && datos.schema_version >= 0) {
      versionOrigen = datos.schema_version;
    } else {
      return fallo("El backup tiene una versión de datos inválida.");
    }

    /* Rechazo ANTES de cualquier escritura: un schema más nuevo no se
       puede interpretar con esta versión de la app. */
    if (versionOrigen > versionSoportada) {
      return fallo(
        "Este backup fue creado por una versión más nueva de la app (versión de datos " + versionOrigen +
        "). Actualizá la app antes de importarlo. No se modificó nada."
      );
    }

    var errorEntrada = validarEstructura(datos) || (versionOrigen < 3 ? validarRutinaAnterior(datos) : null);
    if (errorEntrada) return fallo(errorEntrada);

    var cantidadSesiones = datos.sesiones_entrenamiento.length;
    /* Copia intacta para verificar las invariantes de la migración 2 -> 3. */
    var original = JSON.parse(texto);

    /* `datos` es un objeto recién parseado (nadie más lo referencia), así
       que migrarlo en el lugar equivale a migrar una copia. */
    var migrados;
    try {
      migrados = GYMAPP.storage.migrarDatos(datos);
    } catch (e) {
      console.error("No se pudo migrar el backup", e);
      return fallo("No se pudo actualizar el formato del backup. Tus datos actuales no se modificaron.");
    }

    /* Mismo merge que storage.load(): solo agrega claves ausentes, nunca
       pisa lo que vino en el backup. */
    var resultado = Object.assign(GYMAPP.storage.getDefaultData(), migrados);

    if (resultado.schema_version !== versionSoportada) {
      return fallo("No se pudo actualizar el formato del backup. Tus datos actuales no se modificaron.");
    }
    var errorResultado = validarEstructura(resultado);
    if (errorResultado) return fallo(errorResultado);
    if (GYMAPP.storage.validarDatosV3(resultado)) {
      return fallo("La rutina del backup no tiene un formato válido.");
    }
    if (resultado.sesiones_entrenamiento.length !== cantidadSesiones ||
        (versionOrigen < 3 && GYMAPP.storage.verificarMigracionV3(original, resultado))) {
      return fallo("La actualización del backup no conservó todos los datos. No se modificó nada.");
    }

    return { ok: true, datos: resultado, versionOrigen: versionOrigen, versionDestino: versionSoportada };
  }

  function aplicarImportacionBackup(preparado, info) {
    if (!preparado || !preparado.ok) return fallo("No hay un backup válido para importar.");
    info = info || {};

    var anteriorRaw;
    try {
      anteriorRaw = window.localStorage.getItem(CLAVE_DATOS);
    } catch (e) {
      return fallo("No se pudo leer los datos actuales para respaldarlos. No se modificó nada.");
    }

    /* 1. Copia previa (texto crudo, tal cual estaba guardado). */
    try {
      window.localStorage.setItem(CLAVE_BACKUP_PRE_IMPORT, JSON.stringify({
        data_raw: anteriorRaw,
        fecha: new Date().toISOString(),
        version_backup_importado: preparado.versionOrigen,
        archivo: info.nombreArchivo || null
      }));
    } catch (e) {
      console.error("No se pudo crear la copia previa al import", e);
      return fallo("No se pudo crear una copia de seguridad de tus datos actuales. No se importó nada.");
    }

    /* 2. Invalidar la baseline de SYNC-03 ANTES de reemplazar los datos. */
    try {
      window.localStorage.removeItem(CLAVE_SYNC_META);
      if (window.localStorage.getItem(CLAVE_SYNC_META) !== null) throw new Error("syncMeta sigue presente");
    } catch (e) {
      console.error("No se pudo invalidar la metadata de sincronización", e);
      return fallo("No se pudo preparar la sincronización para el import. No se modificaron tus datos.");
    }

    /* 3. Guardar. setItem no escribe a medias: si falla, lo anterior queda. */
    if (!GYMAPP.storage.save(preparado.datos, { alertaAutomatica: false })) {
      return fallo("No se pudo guardar el backup importado. Tus datos anteriores se conservan intactos.");
    }

    return { ok: true };
  }

  return {
    prepararImportacionBackup: prepararImportacionBackup,
    aplicarImportacionBackup: aplicarImportacionBackup,
    CLAVE_BACKUP_PRE_IMPORT: CLAVE_BACKUP_PRE_IMPORT
  };
})();
