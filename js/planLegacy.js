/* Plan anterior (legacy) reconstruido: ÚNICA fuente de verdad de los 5
   días y 54 ejercicios del plan previo a la rutina actual (E3).

   Todos los datos (IDs, nombres, día y orden de cada ejercicio,
   grupo_muscular, series_objetivo y reps_objetivo) vienen tal cual del
   backup original. Lo que el backup no tenía (RIR, RPE, peso, pausa,
   comentarios, raw) queda en null.

   Usos:
   - backfill E3 (storage.aplicarBackfillsV3): persistir el plan en
     rutina.planes de usuarios con sesiones de este plan;
   - import de backups viejos (backupImport.js, vía storage);
   - fallback defensivo de nombres (rutinasHistoricas.js) cuando el plan
     todavía no está persistido.
   Solo lectura sobre `data`, salvo agregarPlanLegacy(), que se usa sobre
   una copia dentro de storage. Nunca modifica sesiones ni IDs. */
var GYMAPP = window.GYMAPP || (window.GYMAPP = {});

GYMAPP.planLegacy = (function () {
  /* plan_id determinístico, derivado del primer día del plan legacy. */
  var PLAN_ID = "plan-hist-mu4c87ep730qj1";
  var NOMBRE_PLAN = "Plan anterior (reconstruido)";

  /* Días en el orden del plan original. Cada ejercicio:
     [id, nombre, grupo_muscular, series_objetivo, reps_objetivo],
     en el orden del día. */
  var DIAS = [
    {
      id: "mu4c87ep730qj1", nombre: "EMPUJE",
      ejercicios: [
        ["mu4c87epbg96ws", "MOVILIDAD DE HOMBRO CON SOGA / BANDA", "Hombro", 2, "8"],
        ["mu4c87ept9zor6", "MANGUITO ROTADOR CON BANDA (NIVEL 2)", "Hombro", 2, "8"],
        ["mu4c87epymia1f", "ROTACION TORACICA EN CUADRUPEDIA CON BRAZOS EXTENDIDOS", "Espalda", 2, "8"],
        ["mu4c87epoowggf", "FLEXIONES DE BRAZO EN CAJON BAJO O STEP", "Pecho", 2, "10/10"],
        ["mu4c87epsr80xw", "PRESS BANCA C/BARRA", "Pecho", 4, "6-8"],
        ["mu4c87epqc4fa9", "PRESS INCLINADO EN SMITH", "Pecho", 4, "8-10"],
        ["mu4c87epra2lxd", "MARIPOSA", "Pecho", 3, "12-15"],
        ["mu4c87ep3aktdt", "PRESS MILITAR C/MANCUERNAS SENTADO", "Hombro", 3, "8-12"],
        ["mu4c87epb3rmfc", "PRESS FRANCES C/BARRA", "Tríceps", 4, "8-10"],
        ["mu4c87epfzs2x1", "TRICEPS A UN BRAZO TOMANDO CODO", "Tríceps", 3, "12"],
        ["mu4c87eprlf0dw", "DEAD BUG EXTIENDO PIES Y BRAZOS CON PESO", "Core", 3, "10-12"],
        ["mu4c87epql8xft", "LANZAMIENTO DE PELOTA LATERAL", "Core", 3, "12"]
      ]
    },
    {
      id: "mu4c87ep241kdy", nombre: "PIERNAS (ENFOQUE EN CUADRICEPS)",
      ejercicios: [
        ["mu4c87epb85qpz", "MOVILIDAD DE CADERA 90/90 COMPLETA", "Core", 2, "8"],
        ["mu4c87epykfu38", "BUDA + DORSIFLEXION DE TOBILLO", "Pierna", 2, "8"],
        ["mu4c87epweavgf", "MOVILIDAD CADERA + ESTIRO ADUCTOR EN SUELO", "Pierna", 2, "8"],
        ["mu4c87ep87iw35", "DE ARRODILLADO A PARADO", "Pierna", 2, "15-30"],
        ["mu4c87ep038sy5", "SENTADILLA SMITH", "Pierna", 4, "6-8"],
        ["mu4c87ep8e0jqr", "ESTOCADA BULGARA C/MANCUERNA", "Pierna", 3, "10-12"],
        ["mu4c87ep8xs800", "HIP THRUST CON BARRA", "Glúteo", 4, "8"],
        ["mu4c87ep4n43li", "SENTADILLA SUMO CON KB", "Pierna", 3, "10-12"],
        ["mu4c87ep69us8o", "SILLON DE CUADRICEPS", "Pierna", 3, "12"],
        ["mu4c87epo1bdnp", "GEMELOS EN PRENSA HACK", "Pierna", 3, "10-15"]
      ]
    },
    {
      id: "mu4c87ep2snsau", nombre: "TRACCIÓN",
      ejercicios: [
        ["mu4c87epeyfdj5", "ADUCCION ESCAPULAR C/BANDA", "Hombro", 2, "8"],
        ["mu4c87ep3do44n", "BUDA + TRACCIONES C/BANDA", "Hombro", 2, "8"],
        ["mu4c87epn2cxo3", "ROTACION TORACICA EN CUADRUPEDIA CON BRAZOS EXTENDIDOS", "Espalda", 2, "8"],
        ["mu4c87epgu3z75", "DOMINADAS AUSTRALIANAS", "Espalda", 2, "8-12"],
        ["mu4c87epd9q159", "DOMINADAS TOMA NEUTRA", "Espalda", 4, "6-8"],
        ["mu4c87ep8spsdp", "REMO T CON BARRA", "Espalda", 4, "10"],
        ["mu4c87ep58zem5", "REMO CON MANCUERNA A 1 BRAZO", "Espalda", 3, "10-12"],
        ["mu4c87ep0qemzm", "VUELOS LATERALES C/ KETBELL", "Hombro", 4, "8"],
        ["mu4c87ep3ubm4o", "CURL BICEPS C/BARRA BANCO SCOTT", "Bíceps", 4, "8-10"],
        ["mu4c87ep0eby47", "BICEPS MARTILLO EN POLEA", "Bíceps", 3, "12"],
        ["mu4c87ep7ktd1j", "SIT UPS", "Core", 3, "10-12"],
        ["mu4c87epxgpjgh", "ELEVACIONES DE PIERNAS SOBRE MANCUERNA", "Core", 3, "12/12"]
      ]
    },
    {
      id: "mu4c87epiiepiq", nombre: "PIERNAS (ENFOQUE EN ISQUIOS)",
      ejercicios: [
        ["mu4c87ep2a0odw", "MOVILIDAD DE CADERA 90/90 COMPLETA", "Pierna", 2, "8"],
        ["mu4c87eplnvqe9", "CUA+ PSOAS + ISQUIO DESDE ESTOCADA EN SUELO", "Pierna", 2, "8"],
        ["mu4c87ep0qejns", "ROTACIÓN DE TRONCO Y CADERA DESDE POSICIÓN PRONA ( ALACRAN)", "Pierna", 2, "8"],
        ["mu4c87ep9sfk61", "DE ARRODILLADO A PARADO", "Pierna", 2, "15-30"],
        ["mu4c87eptl7g4e", "PESO MUERTO RUMANO EN SMITH", "Pierna", 4, "6-8"],
        ["mu4c87epqbyg9x", "PRENSA 45º", "Pierna", 3, "10-12"],
        ["mu4c87ephy6m59", "CURL FEMORAL ACOSTADO", "Pierna", 4, "10-12"],
        ["mu4c87epnlj2w1", "SWING C/KETTLEBELL", "Pierna", 3, "10-14"],
        ["mu4c87ep5bebig", "SUBIDAS AL BANCO C/KETBELLS", "Pierna", 3, "12/12"],
        ["mu4c87epaaxezk", "GEMELOS/SOLEO EN MAQUINA", "Pierna", 3, "10-15"]
      ]
    },
    {
      id: "mu4c87eptjrn47", nombre: "TREN SUPERIOR",
      ejercicios: [
        ["mu4c87epga0kg0", "MANGUITO ROTADOR CON BANDA (NIVEL 2)", "Hombro", 2, "8"],
        ["mu4c87eps3rrhu", "ROTACION TORACICA EN CUADRUPEDIA CON BRAZOS EXTENDIDOS", "Espalda", 2, "8"],
        ["mu4c87epl1orvw", "ROTACIONES DE HOMBRO CON BANDA", "Hombro", 2, "8"],
        ["mu4c87epv7k03i", "HALO SOBRE 1 PIERNA", "Core", 2, "12/12"],
        ["mu4c87epjry3ek", "PRESS BANCA C/MANCUERNAS", "Pecho", 4, "10-12"],
        ["mu4c87epijpm86", "MARIPOSA", "Pecho", 3, "10/10"],
        ["mu4c87epbm1w7y", "POLEA DORSAL AL PECHO TOMA AMPLIA", "Espalda", 4, "10-12"],
        ["mu4c87epm1j832", "REMO BAJO POLEA TOMA SUPINA", "Espalda", 3, "10-12"],
        ["mu4c87ep49fuyl", "BICEPS C/BARRA PLANA", "Bíceps", 3, "12"],
        ["mu4c87ep94uybp", "TRICEPS TRASNUCA C/BARRA", "Tríceps", 3, "12"]
      ]
    }
  ];

  function crearEjercicio(fila) {
    return {
      id: fila[0],
      nombre: fila[1],
      grupo_muscular: fila[2],
      series_objetivo: fila[3],
      reps_objetivo: fila[4]
    };
  }

  /* Plan histórico completo en formato schema 3, siempre igual (sin fechas,
     azar ni campos generados): dos dispositivos producen el mismo JSON. */
  function crearPlanHistoricoLegacy() {
    return {
      plan_id: PLAN_ID,
      nombre: NOMBRE_PLAN,
      fecha_inicio: null,
      fecha_fin: null,
      origen: "legacy",
      version_de: null,
      creado_en: null,
      archivado_en: null,
      fuente: { tipo: "backup_legacy_reconstruido" },
      dias: DIAS.map(function (dia, i) {
        return GYMAPP.storage.crearDiaV3({ id: dia.id, nombre: dia.nombre, ejercicios: dia.ejercicios.map(crearEjercicio) }, i + 1);
      })
    };
  }

  /* --- Consultas sobre el dataset (fallback de nombres) --- */

  /* { nombre, orden } del día legacy (orden 0..4), o null. */
  function buscarDia(diaId) {
    for (var i = 0; i < DIAS.length; i++) {
      if (DIAS[i].id === diaId) return { nombre: DIAS[i].nombre, orden: i };
    }
    return null;
  }

  function nombreEjercicio(ejercicioId) {
    for (var i = 0; i < DIAS.length; i++) {
      for (var j = 0; j < DIAS[i].ejercicios.length; j++) {
        if (DIAS[i].ejercicios[j][0] === ejercicioId) return DIAS[i].ejercicios[j][1];
      }
    }
    return null;
  }

  function esDiaLegacy(diaId) {
    return buscarDia(diaId) !== null;
  }

  /* --- Backfill E3 --- */

  /* true si hay que agregar el plan: schema 3, alguna sesión apunta a un
     día legacy y ningún plan (ni el activo) contiene ya un día legacy. */
  function necesitaPlanLegacy(data) {
    if (!data || data.schema_version !== 3 || !data.rutina || !Array.isArray(data.rutina.planes)) return false;
    var yaEsta = data.rutina.planes.some(function (plan) {
      return plan && (plan.plan_id === PLAN_ID || (Array.isArray(plan.dias) && plan.dias.some(function (d) { return d && esDiaLegacy(d.id); })));
    });
    if (yaEsta) return false;
    return (data.sesiones_entrenamiento || []).some(function (s) { return s && esDiaLegacy(s.dia_rutina_id); });
  }

  /* Agrega el plan al principio de rutina.planes (es anterior al activo).
     No toca plan_activo_id ni ningún otro dato. Muta `data`. */
  function agregarPlanLegacy(data) {
    data.rutina.planes.unshift(crearPlanHistoricoLegacy());
    return data;
  }

  /* Invariantes del backfill: `antes` es el dato schema 3 sin el plan y
     `despues` el resultado. Devuelve null o el primer problema. */
  function verificarBackfillLegacy(antes, despues) {
    var mismo = function (a, b) { return JSON.stringify(a) === JSON.stringify(b); };
    if (despues.schema_version !== 3) return "schema_version cambió.";
    if (despues.rutina.plan_activo_id !== antes.rutina.plan_activo_id) return "Cambió plan_activo_id.";
    if (despues.rutina.planes.length !== antes.rutina.planes.length + 1) return "No se agregó exactamente un plan.";
    if (!mismo(despues.rutina.planes.slice(1), antes.rutina.planes)) return "Cambiaron los planes existentes.";
    var plan = despues.rutina.planes[0];
    if (plan.plan_id !== PLAN_ID || despues.rutina.planes.filter(function (p) { return p.plan_id === PLAN_ID; }).length !== 1) return "plan_id legacy inválido.";
    if (plan.dias.length !== 5) return "El plan legacy no tiene 5 días.";
    var ids = {};
    var ejercicios = 0;
    for (var i = 0; i < plan.dias.length; i++) {
      if (ids[plan.dias[i].id]) return "ID repetido en el plan legacy.";
      ids[plan.dias[i].id] = true;
      for (var j = 0; j < plan.dias[i].ejercicios.length; j++) {
        var id = plan.dias[i].ejercicios[j].id;
        if (ids[id]) return "ID repetido en el plan legacy.";
        ids[id] = true;
        ejercicios += 1;
      }
    }
    if (ejercicios !== 54) return "El plan legacy no tiene 54 ejercicios.";
    var otros = Object.keys(antes).concat(Object.keys(despues)).filter(function (k) { return k !== "rutina"; });
    for (var k = 0; k < otros.length; k++) {
      if (!mismo(antes[otros[k]], despues[otros[k]])) return "Cambió " + otros[k] + ".";
    }
    return null;
  }

  return {
    PLAN_ID: PLAN_ID,
    crearPlanHistoricoLegacy: crearPlanHistoricoLegacy,
    buscarDia: buscarDia,
    nombreEjercicio: nombreEjercicio,
    necesitaPlanLegacy: necesitaPlanLegacy,
    agregarPlanLegacy: agregarPlanLegacy,
    verificarBackfillLegacy: verificarBackfillLegacy
  };
})();
