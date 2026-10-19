/* Resolución de nombres de días/bloques de rutina, compartida entre
   Progreso y Entrenar. Única fuente de verdad para nombrar un
   dia_rutina_id que ya no está en la rutina actual. Solo lectura: nunca
   modifica sesiones, IDs ni storage. */
var GYMAPP = window.GYMAPP || (window.GYMAPP = {});

GYMAPP.rutinasHistoricas = (function () {
  /* COMPATIBILIDAD LEGACY (TEMPORAL): nombres de los 5 días del plan
     anterior, recuperados del backup previo, indexados por su
     dia_rutina_id real. Es el ÚNICO lugar de la app con IDs históricos
     hardcodeados. El orden es el del plan original (Progreso lo usa para
     ordenar el selector del historial). Se reemplaza en PROG-04.1 /
     schema 3 por un historial formal de planes (snapshot de días y
     ejercicios); entonces este mapa se elimina. */
  var NOMBRES_BLOQUES_LEGACY = [
    { id: "mu4c87ep730qj1", nombre: "EMPUJE" },
    { id: "mu4c87ep241kdy", nombre: "PIERNAS (ENFOQUE EN CUADRICEPS)" },
    { id: "mu4c87ep2snsau", nombre: "TRACCIÓN" },
    { id: "mu4c87epiiepiq", nombre: "PIERNAS (ENFOQUE EN ISQUIOS)" },
    { id: "mu4c87eptjrn47", nombre: "TREN SUPERIOR" }
  ];

  var NOMBRE_BLOQUE_DESCONOCIDO = "Bloque anterior";

  /* Nombre persistido de un bloque histórico. Hoy el storage no guarda
     ningún snapshot de rutinas anteriores, así que siempre devuelve null;
     es el punto de entrada donde PROG-04.1 / schema 3 va a leer el nombre
     real desde el historial formal de planes. */
  function nombreBloqueDesdeHistorialPersistido(data, diaRutinaId) {
    return null;
  }

  /* Nombre de un bloque que NO está en la rutina actual, en orden:
     1. historial persistido (futuro);
     2. mapa de compatibilidad legacy;
     3. null (quien llama decide el fallback).
     Devuelve { nombre, orden } (orden solo para los legacy). */
  function resolverNombreBloqueHistorico(data, diaRutinaId) {
    var persistido = nombreBloqueDesdeHistorialPersistido(data, diaRutinaId);
    if (persistido) return { nombre: persistido, orden: null };
    for (var i = 0; i < NOMBRES_BLOQUES_LEGACY.length; i++) {
      if (NOMBRES_BLOQUES_LEGACY[i].id === diaRutinaId) return { nombre: NOMBRES_BLOQUES_LEGACY[i].nombre, orden: i };
    }
    return null;
  }

  /* Nombre visible de cualquier dia_rutina_id, en orden:
     1. bloque activo de la rutina actual (su nombre actual, tal cual);
     2. historial persistido (futuro) / mapa legacy;
     3. "Bloque anterior". */
  function resolverNombreDiaRutina(data, diaRutinaId) {
    var dias = (data && data.rutina && data.rutina.dias) || [];
    for (var i = 0; i < dias.length; i++) {
      if (dias[i].id === diaRutinaId) return dias[i].nombre;
    }
    var historico = resolverNombreBloqueHistorico(data, diaRutinaId);
    return historico ? historico.nombre : NOMBRE_BLOQUE_DESCONOCIDO;
  }

  return {
    resolverNombreBloqueHistorico: resolverNombreBloqueHistorico,
    resolverNombreDiaRutina: resolverNombreDiaRutina,
    NOMBRE_BLOQUE_DESCONOCIDO: NOMBRE_BLOQUE_DESCONOCIDO
  };
})();
