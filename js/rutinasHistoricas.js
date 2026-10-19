/* Resolución de nombres de días/bloques de rutina, compartida entre
   Progreso y Entrenar. Única fuente de verdad para nombrar un
   dia_rutina_id que ya no está en la rutina actual. Solo lectura: nunca
   modifica sesiones, IDs ni storage. */
var GYMAPP = window.GYMAPP || (window.GYMAPP = {});

GYMAPP.rutinasHistoricas = (function () {
  /* Los nombres del plan anterior ya no se duplican acá: la única fuente
     es js/planLegacy.js (E3), que se persiste en rutina.planes. El dataset
     solo se consulta como fallback si el plan todavía no está persistido. */

  var NOMBRE_BLOQUE_DESCONOCIDO = "Bloque anterior";
  var NOMBRE_EJERCICIO_DESCONOCIDO = "Ejercicio anterior";

  /* Posición de un día de un plan NO activo, para ordenar el selector del
     historial: los planes en el orden de rutina.planes y cada día en su
     orden. Con un solo plan histórico coincide con el orden del plan. */
  function ordenHistorico(data, planBuscado, dia) {
    var activoId = data.rutina.plan_activo_id;
    var orden = 0;
    var planes = data.rutina.planes;
    for (var i = 0; i < planes.length && planes[i] !== planBuscado; i++) {
      if (planes[i].plan_id !== activoId) orden += planes[i].dias.length;
    }
    return orden + (dia.orden - 1);
  }

  /* Dataset legacy (fallback); null si el módulo no está cargado. */
  function legacy() {
    return GYMAPP.planLegacy || null;
  }

  /* Nombre de un bloque que NO está en la rutina actual, en orden:
     1. planes persistidos en rutina.planes;
     2. dataset legacy (fallback, si el plan todavía no se persistió);
     3. null (quien llama decide el fallback neutral).
     Devuelve { nombre, orden }. */
  function resolverNombreBloqueHistorico(data, diaRutinaId) {
    var persistido = GYMAPP.planes.buscarDiaEnPlanes(data, diaRutinaId);
    if (persistido) return { nombre: persistido.dia.nombre, orden: ordenHistorico(data, persistido.plan, persistido.dia) };
    return legacy() ? legacy().buscarDia(diaRutinaId) : null;
  }

  /* Nombre visible de cualquier dia_rutina_id, en orden:
     1. bloque activo de la rutina actual (su nombre actual, tal cual);
     2. planes persistidos / dataset legacy;
     3. "Bloque anterior". */
  function resolverNombreDiaRutina(data, diaRutinaId) {
    var diaActivo = GYMAPP.planes.buscarDiaActivo(data, diaRutinaId);
    if (diaActivo) return diaActivo.nombre;
    var historico = resolverNombreBloqueHistorico(data, diaRutinaId);
    return historico ? historico.nombre : NOMBRE_BLOQUE_DESCONOCIDO;
  }

  /* Nombre conocido de un ejercicio, o null si no hay ninguno, en orden:
     1. ejercicio del plan activo (cualquier día);
     2. planes persistidos en rutina.planes;
     3. dataset legacy (fallback). */
  function nombreEjercicioConocido(data, ejercicioId) {
    var ejercicioActivo = GYMAPP.planes.buscarEjercicioActivo(data, ejercicioId);
    if (ejercicioActivo) return ejercicioActivo.nombre || "(sin nombre)";
    var persistido = GYMAPP.planes.buscarEjercicioEnPlanes(data, ejercicioId);
    if (persistido) return persistido.ejercicio.nombre || "(sin nombre)";
    return legacy() ? legacy().nombreEjercicio(ejercicioId) : null;
  }

  /* Nombre visible de un ejercicio: el conocido, o "Ejercicio anterior". */
  function resolverNombreEjercicioHistorico(data, ejercicioId) {
    return nombreEjercicioConocido(data, ejercicioId) || NOMBRE_EJERCICIO_DESCONOCIDO;
  }

  /* E5: datos de un ejercicio TAL COMO SE REGISTRÓ en una sesión, en orden:
     1. prescripcion_snapshot de la sesión;
     2. plan_id de la sesión + ese plan persistido;
     3. resolución actual por IDs (plan activo, planes, dataset legacy);
     4. null (quien llama decide el texto neutral).
     Devuelve { nombre, prescripcion } (prescripcion: objeto con
     series_objetivo/reps_objetivo/... o null si solo se conoce el nombre). */
  function resolverEjercicioDeSesion(data, sesion, er) {
    var snap = er && er.prescripcion_snapshot;
    if (snap) return { nombre: snap.nombre || "(sin nombre)", prescripcion: snap };
    if (sesion && sesion.plan_id) {
      var delPlan = GYMAPP.planes.buscarEjercicioEnPlan(data, sesion.plan_id, er.ejercicio_id);
      if (delPlan) return { nombre: delPlan.nombre || "(sin nombre)", prescripcion: delPlan };
    }
    var activo = GYMAPP.planes.buscarEjercicioActivo(data, er.ejercicio_id);
    if (activo) return { nombre: activo.nombre || "(sin nombre)", prescripcion: activo };
    var conocido = nombreEjercicioConocido(data, er.ejercicio_id);
    return conocido ? { nombre: conocido, prescripcion: null } : null;
  }

  /* E5: nombre del día de una sesión: el del plan de la sesión si tiene
     plan_id y el día está ahí; si no, la resolución actual. */
  function resolverNombreDiaDeSesion(data, sesion) {
    if (sesion && sesion.plan_id) {
      var plan = GYMAPP.planes.buscarPlan(data, sesion.plan_id);
      var dia = plan && Array.isArray(plan.dias) ? plan.dias.filter(function (d) { return d && d.id === sesion.dia_rutina_id; })[0] : null;
      if (dia) return dia.nombre;
    }
    return resolverNombreDiaRutina(data, sesion.dia_rutina_id);
  }

  return {
    resolverEjercicioDeSesion: resolverEjercicioDeSesion,
    resolverNombreDiaDeSesion: resolverNombreDiaDeSesion,
    resolverNombreBloqueHistorico: resolverNombreBloqueHistorico,
    resolverNombreEjercicioHistorico: resolverNombreEjercicioHistorico,
    nombreEjercicioConocido: nombreEjercicioConocido,
    NOMBRE_EJERCICIO_DESCONOCIDO: NOMBRE_EJERCICIO_DESCONOCIDO,
    resolverNombreDiaRutina: resolverNombreDiaRutina,
    NOMBRE_BLOQUE_DESCONOCIDO: NOMBRE_BLOQUE_DESCONOCIDO
  };
})();
