/* Capa de persistencia: única puerta de entrada a localStorage. */
var GYMAPP = window.GYMAPP || (window.GYMAPP = {});

GYMAPP.storage = (function () {
  var STORAGE_KEY = "gymNutritionTracker";

  /* Versión actual del esquema de datos. Subir este número junto con un paso
     nuevo en migrarDatos() cada vez que la forma de los datos cambie. */
  var VERSION_ESQUEMA_ACTUAL = 3;

  /* E2: copia del texto crudo previo a la migración 2 -> 3. Se escribe antes
     de persistir el schema 3 y nunca se borra automáticamente. */
  var CLAVE_PRE_MIGRACION_V3 = "gymNutritionTracker_preMigracionV3";

  /* plan_id del plan vacío. Es EXACTAMENTE el que produce la migración de una
     rutina schema 2 sin días ("plan-mig-vacio"), y el default usa los mismos
     valores que esa migración: así un usuario nuevo y un usuario migrado sin
     días tienen la misma rutina byte a byte (sin falsos conflictos de sync)
     y getDefaultData() es siempre igual (sin IDs aleatorios ni fechas). */
  var PLAN_ID_VACIO = "plan-mig-vacio";

  /* Campos de prescripción de schema 3 que en E2 siempre nacen en null. */
  var CAMPOS_PRESCRIPCION_V3 = ["rir_objetivo", "rpe_objetivo", "peso_objetivo", "pausa", "comentarios", "raw"];

  /* E3: copia del texto crudo schema 3 previo al backfill del plan legacy.
     Se escribe una sola vez (si ya existe, se conserva la primera) y nunca
     se borra automáticamente. */
  var CLAVE_PRE_E3 = "gymNutritionTracker_preE3LegacyBackfill";

  /* E5: los ÚNICOS campos que se copian del ejercicio del plan a
     ejercicios_realizados[i].prescripcion_snapshot de una sesión nueva. */
  var CAMPOS_SNAPSHOT_PRESCRIPCION = ["nombre", "grupo_muscular", "series_objetivo", "reps_objetivo", "rir_objetivo", "rpe_objetivo", "peso_objetivo", "pausa"];

  var MENSAJE_MIGRACION_FALLIDA = "No se pudo actualizar el formato de tus datos. Tus datos anteriores se conservaron.";

  var MENSAJE_ERROR_GUARDADO = (
    "No se pudieron guardar los cambios. Es posible que no haya espacio disponible en el dispositivo, " +
    "o que el almacenamiento esté bloqueado (por ejemplo, en modo privado del navegador). " +
    "Los últimos cambios NO se guardaron: liberá espacio o salí del modo privado y volvé a intentarlo."
  );

  var MENSAJE_VERSION_FUTURA = (
    "Tus datos guardados fueron creados por una versión más nueva de esta app que la que tenés cargada ahora. " +
    "Para no arriesgar tu información, esta sesión NO va a guardar ningún cambio nuevo. " +
    "Recargá la página (o volvé a entrar más tarde) para obtener la versión más reciente antes de seguir usándola."
  );

  /* Se activa si detectamos datos de una versión de esquema más nueva que la que
     entendemos. Mientras esté activo, save() rechaza cualquier escritura para
     nunca pisar datos que esta versión del código no sabe interpretar. */
  var bloqueadoPorVersionFutura = false;

  /* E2: se activa si la migración 2 -> 3 no se pudo completar de forma
     segura (error, validación, copia previa o guardado). Mientras esté
     activo: load() no reintenta en esta sesión, save() rechaza todo y la app
     muestra una pantalla de bloqueo en vez de arrancar con datos parciales.
     El dato guardado sigue intacto en schema 2; recargar reintenta. */
  var bloqueoMigracion = null;

  /* E3: si el backfill del plan legacy no se pudo persistir de forma segura,
     no se reintenta en esta sesión y la app sigue con los datos anteriores
     (los nombres históricos siguen saliendo del dataset legacy). Recargar
     reintenta. */
  var backfillE3Fallido = null;

  function crearPlanV3(planId, origen) {
    return {
      plan_id: planId,
      nombre: null,
      fecha_inicio: null,
      fecha_fin: null,
      origen: origen,
      version_de: null,
      creado_en: null,
      archivado_en: null,
      fuente: null,
      dias: []
    };
  }

  /* Ejercicio en formato schema 3: conserva TODOS sus campos tal cual y
     solo agrega los nuevos que falten (prescripción en null, eliminado en
     false) y su orden. Usado por la migración y por las altas de GYMAPP.planes. */
  function crearEjercicioV3(ejercicio, orden) {
    var e = {};
    Object.keys(ejercicio).forEach(function (k) { e[k] = ejercicio[k]; });
    CAMPOS_PRESCRIPCION_V3.forEach(function (campo) {
      if (!(campo in e)) e[campo] = null;
    });
    if (!("eliminado" in e)) e.eliminado = false;
    e.orden = orden;
    return e;
  }

  function crearDiaV3(dia, orden) {
    var d = {};
    Object.keys(dia).forEach(function (k) { d[k] = dia[k]; });
    d.orden = orden;
    d.ejercicios = (Array.isArray(dia.ejercicios) ? dia.ejercicios : []).map(function (e, i) {
      return crearEjercicioV3(e, i + 1);
    });
    return d;
  }

  function getDefaultData() {
    return {
      schema_version: VERSION_ESQUEMA_ACTUAL,
      usuario: null,
      rutina: { plan_activo_id: PLAN_ID_VACIO, planes: [crearPlanV3(PLAN_ID_VACIO, "migracion")] },
      sesiones_entrenamiento: [],
      registros_nutricion: [],
      base_alimentos: [],
      medidas_corporales: []
    };
  }

  /*
   * Migra `dataCruda` (tal cual se leyó de localStorage o se importó de un backup)
   * a la versión de esquema actual, en pasos secuenciales e idempotentes: cada
   * paso primero revisa la versión antes de aplicarse, así que correr esta
   * función varias veces sobre el mismo objeto nunca duplica ni pisa datos.
   * Nunca borra campos existentes, solo agrega/ajusta lo necesario.
   */
  function migrarDatos(dataCruda) {
    var version = typeof dataCruda.schema_version === "number" ? dataCruda.schema_version : 0;

    if (version < 1) {
      /* Migración 0 -> 1: solo declara la versión de esquema. Los datos de usuarios
         que ya venían usando la app (rutina, historial, nutrición, medidas) quedan
         exactamente como estaban. */
      dataCruda.schema_version = 1;
      version = 1;
    }

    if (version < 2) {
      /* Migración 1 -> 2 (ACT-01, base técnica de actividades configurables):
         agrega usuario.actividades si todavía no existe, con EXACTAMENTE la
         configuración que era la única disponible en la versión anterior
         (Gimnasio meta 5, Fútbol meta 2) — a propósito no se infiere de
         sesiones_entrenamiento, porque esa era la config funcional para
         TODOS los usuarios, hayan cargado o no sesiones todavía.
         No toca sesiones_entrenamiento, rutina, nutrición, medidas ni
         futbol_detalle histórico: es puramente aditiva sobre `usuario`, y
         solo si `usuario` ya existe (si es null, no hay nada que completar
         todavía; lo arma el onboarding). Idempotente: si usuario.actividades
         ya está seteado, no se toca. */
      if (dataCruda.usuario && !dataCruda.usuario.actividades) {
        dataCruda.usuario.actividades = [
          { tipo: "gimnasio", meta_semanal: 5 },
          { tipo: "futbol", meta_semanal: 2 }
        ];
      }
      dataCruda.schema_version = 2;
      version = 2;
    }

    if (version < 3) {
      /* Migración 2 -> 3 (E2): rutina.dias pasa a ser el único plan,
         activo, de rutina.planes. Determinística (sin fechas ni azar): dos
         dispositivos con el mismo schema 2 producen el mismo schema 3.
         Conserva todos los IDs y campos de días y ejercicios (solo agrega
         orden y los campos nuevos en null). No toca sesiones ni ningún otro
         dato. No crea planes históricos (eso es E3). */
      var diasV2 = dataCruda.rutina && Array.isArray(dataCruda.rutina.dias) ? dataCruda.rutina.dias : [];
      var planId = diasV2.length && diasV2[0] && diasV2[0].id ? "plan-mig-" + diasV2[0].id : PLAN_ID_VACIO;
      var plan = crearPlanV3(planId, "migracion");
      plan.dias = diasV2.map(function (dia, i) { return crearDiaV3(dia, i + 1); });
      dataCruda.rutina = { plan_activo_id: planId, planes: [plan] };
      dataCruda.schema_version = 3;
      version = 3;
    }

    /* Las próximas migraciones se agregan acá abajo, siguiendo el mismo patrón:
       if (version < N) { ...ajustar dataCruda...; dataCruda.schema_version = N; version = N; } */

    return dataCruda;
  }

  function esIdValido(v) {
    return (typeof v === "string" && v.length > 0) || typeof v === "number";
  }

  function esOrdenValido(v) {
    return typeof v === "number" && Math.floor(v) === v && v >= 1;
  }

  /* E5: forma de un prescripcion_snapshot: exactamente los 8 campos;
     nombre y grupo texto o null; el resto texto, número finito o null.
     Devuelve null si es válido o el problema. */
  function validarSnapshotPrescripcion(snap) {
    if (!snap || typeof snap !== "object" || Array.isArray(snap)) return "prescripcion_snapshot no es un objeto.";
    var claves = Object.keys(snap).sort();
    if (JSON.stringify(claves) !== JSON.stringify(CAMPOS_SNAPSHOT_PRESCRIPCION.slice().sort())) return "prescripcion_snapshot no tiene los campos esperados.";
    for (var i = 0; i < CAMPOS_SNAPSHOT_PRESCRIPCION.length; i++) {
      var campo = CAMPOS_SNAPSHOT_PRESCRIPCION[i];
      var v = snap[campo];
      var texto = typeof v === "string";
      var numero = typeof v === "number" && isFinite(v);
      if (v !== null && !texto && !(numero && campo !== "nombre" && campo !== "grupo_muscular")) {
        return "prescripcion_snapshot." + campo + " inválido.";
      }
    }
    return null;
  }

  /* E5: campos de vínculo con el plan de una sesión. Son opcionales (las
     sesiones anteriores a E5 no los tienen); si están, tienen que tener la
     forma correcta. No se repara nada. */
  function validarVinculoSesion(sesion) {
    if (!sesion || typeof sesion !== "object") return null;
    if (Object.prototype.hasOwnProperty.call(sesion, "plan_id") && (typeof sesion.plan_id !== "string" || !sesion.plan_id)) {
      return "plan_id inválido en una sesión.";
    }
    var ejercicios = Array.isArray(sesion.ejercicios_realizados) ? sesion.ejercicios_realizados : [];
    for (var i = 0; i < ejercicios.length; i++) {
      var er = ejercicios[i];
      if (er && typeof er === "object" && Object.prototype.hasOwnProperty.call(er, "prescripcion_snapshot")) {
        var error = validarSnapshotPrescripcion(er.prescripcion_snapshot);
        if (error) return error;
      }
    }
    return null;
  }

  /* Validación mínima pero estricta del formato schema 3. Devuelve null si
     es válido o un texto con el primer problema encontrado. No valida en
     detalle datos que schema 2 ya aceptaba (sesiones, nutrición, etc.). */
  function validarDatosV3(data) {
    if (!data || typeof data !== "object" || Array.isArray(data)) return "Los datos no son un objeto.";
    if (data.schema_version !== 3) return "schema_version no es 3.";
    var r = data.rutina;
    if (!r || typeof r !== "object" || Array.isArray(r)) return "rutina no es un objeto.";
    if (typeof r.plan_activo_id !== "string" || !r.plan_activo_id) return "plan_activo_id inválido.";
    if (!Array.isArray(r.planes)) return "rutina.planes no es un array.";
    var vistos = {};
    var activos = 0;
    for (var i = 0; i < r.planes.length; i++) {
      var plan = r.planes[i];
      if (!plan || typeof plan !== "object" || typeof plan.plan_id !== "string" || !plan.plan_id) return "Hay un plan sin plan_id.";
      if (vistos[plan.plan_id]) return "plan_id repetido: " + plan.plan_id;
      vistos[plan.plan_id] = true;
      if (plan.plan_id === r.plan_activo_id) activos += 1;
      if (!Array.isArray(plan.dias)) return "Un plan no tiene dias.";
      for (var j = 0; j < plan.dias.length; j++) {
        var dia = plan.dias[j];
        if (!dia || typeof dia !== "object" || !esIdValido(dia.id)) return "Hay un día sin id.";
        if (!esOrdenValido(dia.orden)) return "Hay un día con orden inválido.";
        if (!Array.isArray(dia.ejercicios)) return "Hay un día sin ejercicios.";
        for (var k = 0; k < dia.ejercicios.length; k++) {
          var ej = dia.ejercicios[k];
          if (!ej || typeof ej !== "object" || !esIdValido(ej.id)) return "Hay un ejercicio sin id.";
          if (!esOrdenValido(ej.orden)) return "Hay un ejercicio con orden inválido.";
        }
      }
    }
    if (activos !== 1) return "No hay exactamente un plan activo.";
    if (!Array.isArray(data.sesiones_entrenamiento)) return "sesiones_entrenamiento no es un array.";
    for (var s = 0; s < data.sesiones_entrenamiento.length; s++) {
      var errorVinculo = validarVinculoSesion(data.sesiones_entrenamiento[s]);
      if (errorVinculo) return errorVinculo;
    }
    return null;
  }

  /* Invariantes explícitas de la migración 2 -> 3: `original` es el dato
     schema <= 2 tal cual estaba (sin tocar) y `migrado` el resultado. */
  function verificarMigracionV3(original, migrado) {
    var diasAntes = original && original.rutina && Array.isArray(original.rutina.dias) ? original.rutina.dias : [];
    var planActivo = migrado.rutina.planes.filter(function (p) { return p.plan_id === migrado.rutina.plan_activo_id; })[0];
    var diasDespues = planActivo.dias;
    if (diasAntes.length !== diasDespues.length) return "Cambió la cantidad de días.";
    for (var i = 0; i < diasAntes.length; i++) {
      var a = diasAntes[i] || {};
      var b = diasDespues[i];
      if (a.id !== b.id || a.nombre !== b.nombre) return "Cambió un día (id o nombre).";
      var ejA = Array.isArray(a.ejercicios) ? a.ejercicios : [];
      if (ejA.length !== b.ejercicios.length) return "Cambió la cantidad de ejercicios de un día.";
      for (var j = 0; j < ejA.length; j++) {
        var conservado = Object.keys(ejA[j] || {}).every(function (k) {
          return JSON.stringify(ejA[j][k]) === JSON.stringify(b.ejercicios[j][k]);
        });
        if (!conservado) return "Cambió un ejercicio.";
      }
    }
    var sesionesAntes = original && Array.isArray(original.sesiones_entrenamiento) ? original.sesiones_entrenamiento : [];
    if (JSON.stringify(sesionesAntes) !== JSON.stringify(migrado.sesiones_entrenamiento)) return "Cambiaron las sesiones.";
    return null;
  }

  /* Backfills de schema 3 (E3): ajustes idempotentes que NO dependen de
     schema_version (el usuario ya está en 3). Trabaja sobre una copia: nunca
     muta `data`. Devuelve { datos, cambio, error }: si no hay nada que hacer,
     datos === data y cambio false. Hoy: plan legacy (js/planLegacy.js). */
  function aplicarBackfillsV3(data) {
    var legacy = GYMAPP.planLegacy;
    if (!legacy || !legacy.necesitaPlanLegacy(data)) return { datos: data, cambio: false, error: null };
    var copia = JSON.parse(JSON.stringify(data));
    legacy.agregarPlanLegacy(copia);
    var error = validarDatosV3(copia) || legacy.verificarBackfillLegacy(data, copia);
    return { datos: copia, cambio: true, error: error };
  }

  function fallarBackfillE3(motivo, error) {
    console.error("Backfill E3 (plan legacy) cancelado: " + motivo + ". Se siguen usando los datos anteriores.", error || "");
    backfillE3Fallido = { motivo: motivo };
  }

  /* Backfill resguardado sobre un schema 3 ya guardado: en memoria,
     validación, copia previa del texto crudo y recién entonces el guardado.
     Si algo falla, devuelve `data` sin cambios y gymNutritionTracker queda
     como estaba. Sin cambios que hacer: 0 escrituras. */
  function aplicarBackfillConResguardo(raw, data) {
    if (backfillE3Fallido) return data;
    var r;
    try {
      r = aplicarBackfillsV3(data);
    } catch (e) {
      fallarBackfillE3("error al aplicar", e);
      return data;
    }
    if (!r.cambio) return data;
    if (r.error) {
      fallarBackfillE3("validación: " + r.error);
      return data;
    }
    try {
      if (localStorage.getItem(CLAVE_PRE_E3) === null) {
        localStorage.setItem(CLAVE_PRE_E3, JSON.stringify({ data_raw: raw, fecha: new Date().toISOString() }));
      }
    } catch (e) {
      fallarBackfillE3("no se pudo crear la copia previa", e);
      return data;
    }
    if (!save(r.datos, { alertaAutomatica: false })) {
      fallarBackfillE3("no se pudo guardar");
      return data;
    }
    return r.datos;
  }

  function bloquearPorMigracion(motivo, error) {
    console.error("Migración a schema 3 cancelada: " + motivo, error || "");
    bloqueoMigracion = { motivo: motivo, mensaje: MENSAJE_MIGRACION_FALLIDA };
    return getDefaultData();
  }

  /* Migración 2 -> 3 resguardada: todo en memoria, validación, copia previa
     del texto crudo y recién entonces el guardado. Si cualquier paso falla,
     gymNutritionTracker queda como estaba (schema <= 2) y la app se bloquea. */
  function migrarConResguardoV3(raw, dataCruda, versionOriginal) {
    var original = JSON.parse(raw);
    var migrada;
    try {
      migrada = Object.assign(getDefaultData(), migrarDatos(dataCruda));
    } catch (e) {
      return bloquearPorMigracion("error al migrar", e);
    }

    var error = validarDatosV3(migrada) || verificarMigracionV3(original, migrada);
    if (error) return bloquearPorMigracion("validación: " + error);

    /* E3 en el mismo paso: el resultado es idéntico al de migrar a 3 y
       después hacer el backfill. La copia previa es la de schema 2. */
    var backfill;
    try {
      backfill = aplicarBackfillsV3(migrada);
    } catch (e) {
      return bloquearPorMigracion("error en el backfill E3", e);
    }
    if (backfill.error) return bloquearPorMigracion("validación E3: " + backfill.error);
    migrada = backfill.datos;

    try {
      localStorage.setItem(CLAVE_PRE_MIGRACION_V3, JSON.stringify({
        data_raw: raw,
        version_origen: versionOriginal,
        fecha: new Date().toISOString()
      }));
    } catch (e) {
      return bloquearPorMigracion("no se pudo crear la copia previa", e);
    }

    /* setItem reemplaza el valor completo o falla sin escribir: si falla,
       sigue el texto schema <= 2 anterior. */
    if (!save(migrada, { alertaAutomatica: false })) {
      return bloquearPorMigracion("no se pudo guardar el schema 3");
    }
    return migrada;
  }

  function load() {
    if (bloqueoMigracion) return getDefaultData();

    var raw;
    try {
      raw = localStorage.getItem(STORAGE_KEY);
    } catch (e) {
      console.error("No se pudo acceder a localStorage", e);
      return getDefaultData();
    }
    if (!raw) return getDefaultData();

    var dataCruda;
    try {
      dataCruda = JSON.parse(raw);
    } catch (e) {
      console.error("Datos guardados corruptos, se reinicia el estado", e);
      return getDefaultData();
    }

    var versionOriginal = typeof dataCruda.schema_version === "number" ? dataCruda.schema_version : 0;

    /* Datos de una versión futura: no los tocamos ni los interpretamos, y
       bloqueamos cualquier escritura por el resto de la sesión para no
       arriesgarnos a corromperlos con una lógica que no los entiende.
       Avisamos una sola vez (no en cada load(), que se llama constantemente
       desde updateData()); los intentos de guardado posteriores ya avisan
       a través de save(). */
    if (versionOriginal > VERSION_ESQUEMA_ACTUAL) {
      if (!bloqueadoPorVersionFutura) {
        bloqueadoPorVersionFutura = true;
        console.error(
          "schema_version de los datos guardados (" + versionOriginal + ") es más nueva que la soportada (" +
          VERSION_ESQUEMA_ACTUAL + "). Bloqueando guardado por el resto de la sesión."
        );
        window.alert(MENSAJE_VERSION_FUTURA);
      }
      return Object.assign(getDefaultData(), dataCruda);
    }

    if (versionOriginal < 3) {
      return migrarConResguardoV3(raw, dataCruda, versionOriginal);
    }

    var dataMigrada;
    try {
      dataMigrada = migrarDatos(dataCruda);
    } catch (e) {
      /* Si la migración falla, NUNCA devolvemos ni guardamos un estado vacío:
         devolvemos los datos tal cual estaban (completados solo con los campos
         que falten), preservando su schema_version original para que una
         futura carga pueda reintentar la migración. */
      console.error("Error al migrar los datos guardados; se conservan sin modificar.", e);
      window.alert(
        "Hubo un problema al actualizar el formato de tus datos guardados. " +
        "Tus datos NO se perdieron ni se sobrescribieron; seguís viendo la versión anterior tal cual estaba."
      );
      var dataSinMigrar = Object.assign(getDefaultData(), dataCruda);
      dataSinMigrar.schema_version = versionOriginal;
      return dataSinMigrar;
    }

    var dataCompleta = Object.assign(getDefaultData(), dataMigrada);

    /* Si la migración cambió algo, lo persistimos ahora para no tener que
       repetirla en cada carga. Si esto falla (ej. sin espacio), igual devolvemos
       los datos migrados en memoria; la próxima carga exitosa los va a guardar.
       No pasamos alertaAutomatica:false: si este guardado de fondo falla, nadie
       más va a avisar, así que queremos que save() muestre su aviso genérico. */
    if (dataMigrada.schema_version !== versionOriginal) {
      save(dataCompleta);
    }

    return aplicarBackfillConResguardo(raw, dataCompleta);
  }

  /*
   * Devuelve true si se pudo guardar. Si falla, avisa al usuario de forma
   * explícita para que nunca crea que algo se guardó cuando en realidad no.
   *
   * `opciones.alertaAutomatica` (default true): pasar `false` cuando el módulo
   * que llama ya le muestra su propio mensaje de error al usuario, para no
   * duplicar el aviso. Dejarlo en true (el default) actúa como red de
   * seguridad para cualquier llamador que no maneje el error explícitamente.
   */
  function save(data, opciones) {
    var alertaAutomatica = !opciones || opciones.alertaAutomatica !== false;

    if (bloqueoMigracion) {
      console.error("Guardado bloqueado: la migración a schema 3 no se completó.");
      return false;
    }

    if (bloqueadoPorVersionFutura) {
      console.error("Guardado bloqueado: los datos locales son de una versión de esquema más nueva que la soportada.");
      if (alertaAutomatica) window.alert(MENSAJE_VERSION_FUTURA);
      return false;
    }

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      return true;
    } catch (e) {
      console.error("No se pudo guardar en localStorage", e);
      if (alertaAutomatica) window.alert(MENSAJE_ERROR_GUARDADO);
      return false;
    }
  }

  function getData() {
    return load();
  }

  /* Aplica `updater` sobre el estado actual y lo persiste.
     Devuelve { data, guardado }: `data` es el estado (mutado en memoria) y
     `guardado` indica si el guardado en localStorage realmente se completó.
     Todo módulo que llame a esto debe chequear `guardado` antes de asumir que
     el cambio quedó persistido. Ver `save()` para el significado de `opciones`. */
  function updateData(updater, opciones) {
    var data = load();
    updater(data);
    var exito = save(data, opciones);
    return { data: data, guardado: exito };
  }

  /* null, o { motivo, mensaje } si la migración a schema 3 se bloqueó. */
  function obtenerBloqueoMigracion() {
    return bloqueoMigracion;
  }

  /* E6 (y futuros cambios grandes): guarda `datosNuevos` con una copia
     previa del texto crudo actual en `claveCopia` ({ data_raw, fecha }).
     Orden: leer el texto actual → escribir la copia (si falla, aborta sin
     tocar nada) → un único save(). setItem no escribe a medias: si el save
     falla, gymNutritionTracker queda como estaba. La copia no se borra
     automáticamente (la siguiente operación del mismo tipo la reemplaza).
     Devuelve { ok } o { ok: false, motivo: "leer" | "copia" | "guardar" }. */
  function guardarConCopiaPrevia(claveCopia, datosNuevos, fecha) {
    if (bloqueoMigracion || bloqueadoPorVersionFutura) return { ok: false, motivo: "guardar" };
    var raw;
    try {
      raw = localStorage.getItem(STORAGE_KEY);
    } catch (e) {
      return { ok: false, motivo: "leer" };
    }
    try {
      localStorage.setItem(claveCopia, JSON.stringify({ data_raw: raw, fecha: fecha }));
    } catch (e) {
      console.error("No se pudo crear la copia previa " + claveCopia, e);
      return { ok: false, motivo: "copia" };
    }
    if (!save(datosNuevos, { alertaAutomatica: false })) return { ok: false, motivo: "guardar" };
    return { ok: true };
  }

  /* null, o { motivo } si el backfill E3 no se pudo persistir. */
  function obtenerFalloBackfillE3() {
    return backfillE3Fallido;
  }

  return {
    getDefaultData: getDefaultData,
    aplicarBackfillsV3: aplicarBackfillsV3,
    guardarConCopiaPrevia: guardarConCopiaPrevia,
    obtenerFalloBackfillE3: obtenerFalloBackfillE3,
    migrarDatos: migrarDatos,
    validarDatosV3: validarDatosV3,
    CAMPOS_SNAPSHOT_PRESCRIPCION: CAMPOS_SNAPSHOT_PRESCRIPCION,
    validarSnapshotPrescripcion: validarSnapshotPrescripcion,
    validarVinculoSesion: validarVinculoSesion,
    verificarMigracionV3: verificarMigracionV3,
    crearDiaV3: crearDiaV3,
    crearEjercicioV3: crearEjercicioV3,
    obtenerBloqueoMigracion: obtenerBloqueoMigracion,
    load: load,
    save: save,
    getData: getData,
    updateData: updateData
  };
})();
