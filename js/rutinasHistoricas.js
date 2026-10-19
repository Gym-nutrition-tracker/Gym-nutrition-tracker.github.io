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

  /* COMPATIBILIDAD LEGACY (TEMPORAL): nombres de los ejercicios de los 5
     días del plan anterior, extraídos del backup previo, indexados por su
     ejercicio_id real. Igual que NOMBRES_BLOQUES_LEGACY: único lugar de la
     app con estos IDs, solo para mostrar nombres (nunca modifica sesiones
     ni IDs), y se reemplaza en PROG-04.1 / schema 3 por el snapshot de
     ejercicios de cada plan. */
  var NOMBRES_EJERCICIOS_LEGACY = {
    // EMPUJE
    "mu4c87epbg96ws": "MOVILIDAD DE HOMBRO CON SOGA / BANDA",
    "mu4c87ept9zor6": "MANGUITO ROTADOR CON BANDA (NIVEL 2)",
    "mu4c87epymia1f": "ROTACION TORACICA EN CUADRUPEDIA CON BRAZOS EXTENDIDOS",
    "mu4c87epoowggf": "FLEXIONES DE BRAZO EN CAJON BAJO O STEP",
    "mu4c87epsr80xw": "PRESS BANCA C/BARRA",
    "mu4c87epqc4fa9": "PRESS INCLINADO EN SMITH",
    "mu4c87epra2lxd": "MARIPOSA",
    "mu4c87ep3aktdt": "PRESS MILITAR C/MANCUERNAS SENTADO",
    "mu4c87epb3rmfc": "PRESS FRANCES C/BARRA",
    "mu4c87epfzs2x1": "TRICEPS A UN BRAZO TOMANDO CODO",
    "mu4c87eprlf0dw": "DEAD BUG EXTIENDO PIES Y BRAZOS CON PESO",
    "mu4c87epql8xft": "LANZAMIENTO DE PELOTA LATERAL",
    // PIERNAS (ENFOQUE EN CUADRICEPS)
    "mu4c87epb85qpz": "MOVILIDAD DE CADERA 90/90 COMPLETA",
    "mu4c87epykfu38": "BUDA + DORSIFLEXION DE TOBILLO",
    "mu4c87epweavgf": "MOVILIDAD CADERA + ESTIRO ADUCTOR EN SUELO",
    "mu4c87ep87iw35": "DE ARRODILLADO A PARADO",
    "mu4c87ep038sy5": "SENTADILLA SMITH",
    "mu4c87ep8e0jqr": "ESTOCADA BULGARA C/MANCUERNA",
    "mu4c87ep8xs800": "HIP THRUST CON BARRA",
    "mu4c87ep4n43li": "SENTADILLA SUMO CON KB",
    "mu4c87ep69us8o": "SILLON DE CUADRICEPS",
    "mu4c87epo1bdnp": "GEMELOS EN PRENSA HACK",
    // TRACCIÓN
    "mu4c87epeyfdj5": "ADUCCION ESCAPULAR C/BANDA",
    "mu4c87ep3do44n": "BUDA + TRACCIONES C/BANDA",
    "mu4c87epn2cxo3": "ROTACION TORACICA EN CUADRUPEDIA CON BRAZOS EXTENDIDOS",
    "mu4c87epgu3z75": "DOMINADAS AUSTRALIANAS",
    "mu4c87epd9q159": "DOMINADAS TOMA NEUTRA",
    "mu4c87ep8spsdp": "REMO T CON BARRA",
    "mu4c87ep58zem5": "REMO CON MANCUERNA A 1 BRAZO",
    "mu4c87ep0qemzm": "VUELOS LATERALES C/ KETBELL",
    "mu4c87ep3ubm4o": "CURL BICEPS C/BARRA BANCO SCOTT",
    "mu4c87ep0eby47": "BICEPS MARTILLO EN POLEA",
    "mu4c87ep7ktd1j": "SIT UPS",
    "mu4c87epxgpjgh": "ELEVACIONES DE PIERNAS SOBRE MANCUERNA",
    // PIERNAS (ENFOQUE EN ISQUIOS)
    "mu4c87ep2a0odw": "MOVILIDAD DE CADERA 90/90 COMPLETA",
    "mu4c87eplnvqe9": "CUA+ PSOAS + ISQUIO DESDE ESTOCADA EN SUELO",
    "mu4c87ep0qejns": "ROTACIÓN DE TRONCO Y CADERA DESDE POSICIÓN PRONA ( ALACRAN)",
    "mu4c87ep9sfk61": "DE ARRODILLADO A PARADO",
    "mu4c87eptl7g4e": "PESO MUERTO RUMANO EN SMITH",
    "mu4c87epqbyg9x": "PRENSA 45º",
    "mu4c87ephy6m59": "CURL FEMORAL ACOSTADO",
    "mu4c87epnlj2w1": "SWING C/KETTLEBELL",
    "mu4c87ep5bebig": "SUBIDAS AL BANCO C/KETBELLS",
    "mu4c87epaaxezk": "GEMELOS/SOLEO EN MAQUINA",
    // TREN SUPERIOR
    "mu4c87epga0kg0": "MANGUITO ROTADOR CON BANDA (NIVEL 2)",
    "mu4c87eps3rrhu": "ROTACION TORACICA EN CUADRUPEDIA CON BRAZOS EXTENDIDOS",
    "mu4c87epl1orvw": "ROTACIONES DE HOMBRO CON BANDA",
    "mu4c87epv7k03i": "HALO SOBRE 1 PIERNA",
    "mu4c87epjry3ek": "PRESS BANCA C/MANCUERNAS",
    "mu4c87epijpm86": "MARIPOSA",
    "mu4c87epbm1w7y": "POLEA DORSAL AL PECHO TOMA AMPLIA",
    "mu4c87epm1j832": "REMO BAJO POLEA TOMA SUPINA",
    "mu4c87ep49fuyl": "BICEPS C/BARRA PLANA",
    "mu4c87ep94uybp": "TRICEPS TRASNUCA C/BARRA"
  };

  var NOMBRE_BLOQUE_DESCONOCIDO = "Bloque anterior";
  var NOMBRE_EJERCICIO_DESCONOCIDO = "Ejercicio anterior";

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
    var diaActivo = GYMAPP.planes.buscarDiaActivo(data, diaRutinaId);
    if (diaActivo) return diaActivo.nombre;
    var historico = resolverNombreBloqueHistorico(data, diaRutinaId);
    return historico ? historico.nombre : NOMBRE_BLOQUE_DESCONOCIDO;
  }

  /* Nombre persistido de un ejercicio histórico: igual que para bloques,
     hoy siempre null; punto de entrada para el snapshot de PROG-04.1. */
  function nombreEjercicioDesdeHistorialPersistido(data, ejercicioId) {
    return null;
  }

  /* Nombre conocido de un ejercicio, o null si no hay ninguno, en orden:
     1. ejercicio de la rutina actual (cualquier día);
     2. historial persistido (futuro);
     3. mapa legacy. */
  function nombreEjercicioConocido(data, ejercicioId) {
    var ejercicioActivo = GYMAPP.planes.buscarEjercicioActivo(data, ejercicioId);
    if (ejercicioActivo) return ejercicioActivo.nombre || "(sin nombre)";
    var persistido = nombreEjercicioDesdeHistorialPersistido(data, ejercicioId);
    if (persistido) return persistido;
    return Object.prototype.hasOwnProperty.call(NOMBRES_EJERCICIOS_LEGACY, ejercicioId) ? NOMBRES_EJERCICIOS_LEGACY[ejercicioId] : null;
  }

  /* Nombre visible de un ejercicio: el conocido, o "Ejercicio anterior". */
  function resolverNombreEjercicioHistorico(data, ejercicioId) {
    return nombreEjercicioConocido(data, ejercicioId) || NOMBRE_EJERCICIO_DESCONOCIDO;
  }

  return {
    resolverNombreBloqueHistorico: resolverNombreBloqueHistorico,
    resolverNombreEjercicioHistorico: resolverNombreEjercicioHistorico,
    nombreEjercicioConocido: nombreEjercicioConocido,
    NOMBRE_EJERCICIO_DESCONOCIDO: NOMBRE_EJERCICIO_DESCONOCIDO,
    resolverNombreDiaRutina: resolverNombreDiaRutina,
    NOMBRE_BLOQUE_DESCONOCIDO: NOMBRE_BLOQUE_DESCONOCIDO
  };
})();
