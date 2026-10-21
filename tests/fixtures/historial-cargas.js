/* E6.5: historiales para probar la carga sugerida. SIN datos personales:
   - casoX(): cada caso real que describió el usuario, con solo los valores
     que dio (press banca 60 kg x 8-9, press inclinado con mancuernas 25 kg,
     press militar sentado con mancuernas 12 kg x 12).
   - historialAmplio(): nombres del plan anterior (legacy-original.json, ya
     público en el repo) con cargas DE EJEMPLO plausibles, para el reporte
     contra el Plan N.º 4. No es el backup del usuario.
   Mezcla a propósito sesiones E5 (plan_id + prescripcion_snapshot) y
   sesiones viejas sin snapshot que se resuelven por el plan archivado. */
const path = require("node:path");
const fs = require("node:fs");

const PLAN_N4 = JSON.parse(fs.readFileSync(path.join(__dirname, "plan-real-n4-esperado.json"), "utf8"));

const serie = (kg, reps) => reps.map((r) => ({ peso_kg: kg, reps: r }));
const CAMPOS_SNAP = ["nombre", "grupo_muscular", "series_objetivo", "reps_objetivo", "rir_objetivo", "rpe_objetivo", "peso_objetivo", "pausa"];

function sumarDias(iso, n) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/* Plan archivado con los ejercicios dados: [{ nombre, grupo, series, reps, rir, rpe, comentarios }]. */
function planArchivado(id, ejercicios) {
  return {
    plan_id: id, nombre: "Plan anterior (ejemplo)", fecha_inicio: null, fecha_fin: null, origen: "pdf", version_de: null,
    creado_en: "2026-07-01T00:00:00.000Z", archivado_en: "2026-10-12T00:00:00.000Z", fuente: null,
    dias: [{
      id: id + "-d1", nombre: "Día 1", orden: 1,
      ejercicios: ejercicios.map((e, i) => ({
        id: id + "-e" + (i + 1), nombre: e.nombre, grupo_muscular: e.grupo || null, series_objetivo: e.series || 3,
        reps_objetivo: e.reps || "8-10", rir_objetivo: e.rir == null ? null : e.rir, rpe_objetivo: e.rpe == null ? null : e.rpe,
        peso_objetivo: null, pausa: null, comentarios: e.comentarios || null, raw: null, eliminado: false, orden: i + 1
      }))
    }]
  };
}

/* Plan activo a partir del Plan N.º 4 sanitizado (o de una lista propia). */
function planActivo(id, dias) {
  return {
    plan_id: id, nombre: "Plan activo", fecha_inicio: "2026-10-12", fecha_fin: null, origen: "pdf", version_de: null,
    creado_en: "2026-10-12T00:00:00.000Z", archivado_en: null, fuente: null,
    dias: dias.map((d, i) => ({
      id: id + "-d" + (i + 1), nombre: d.nombre, orden: i + 1,
      ejercicios: d.ejercicios.map((e, j) => Object.assign({
        grupo_muscular: null, series_objetivo: 3, reps_objetivo: "10", rir_objetivo: null, rpe_objetivo: null,
        peso_objetivo: null, pausa: null, comentarios: null, raw: null, eliminado: false
      }, e, { id: id + "-d" + (i + 1) + "-e" + (j + 1), orden: j + 1 }))
    }))
  };
}

/* Sesiones: para cada ejercicio del plan archivado con `cargas`, una
   sesión por fecha. `conSnapshot` alterna E5 / sesión vieja. */
function sesionesDe(plan, registros, desde, cadaDias) {
  const sesiones = [];
  let n = 0;
  registros.forEach((r) => {
    const ej = plan.dias[0].ejercicios.find((e) => e.nombre === r.nombre);
    r.series.forEach((series, k) => {
      const fecha = sumarDias(desde, k * cadaDias + (n % 3));
      const conSnapshot = k % 2 === 0;
      const er = { ejercicio_id: ej.id, series };
      if (conSnapshot) er.prescripcion_snapshot = Object.fromEntries(CAMPOS_SNAP.map((c) => [c, ej[c] === undefined ? null : ej[c]]));
      sesiones.push(Object.assign(
        { id: "h" + (++n) + "-" + k, fecha: fecha + "T18:00:00", tipo: "gimnasio", dia_rutina_id: plan.dias[0].id, duracion_min: 60, rpe: r.rpeSesion || 7, notas: "", futbol_detalle: null },
        conSnapshot ? { plan_id: plan.plan_id } : {},
        { ejercicios_realizados: [er] }
      ));
    });
  });
  return sesiones;
}

function datos(planes, activoId, sesiones) {
  return {
    schema_version: 3,
    usuario: { nombre: "Ejemplo", actividades: [{ tipo: "gimnasio", meta_semanal: 4 }] },
    rutina: { plan_activo_id: activoId, planes },
    sesiones_entrenamiento: sesiones,
    registros_nutricion: [], base_alimentos: [], medidas_corporales: []
  };
}

/* Un caso: historial de UN ejercicio y un plan activo con UN ejercicio. */
function caso(historico, objetivo, opciones) {
  opciones = opciones || {};
  const viejo = planArchivado("plan-viejo", historico.map((h) => h.ejercicio));
  const activo = planActivo("plan-nuevo", [{ nombre: "Día", ejercicios: [objetivo] }]);
  const ses = sesionesDe(viejo, historico.map((h) => ({ nombre: h.ejercicio.nombre, series: h.series, rpeSesion: h.rpeSesion })), opciones.desde || "2026-09-14", 7);
  return datos([viejo, activo], "plan-nuevo", ses);
}

const banca = (k) => serie(40, [10]).concat(serie(60, [9, 8, 8 + (k % 2)]));

const CASOS = {
  /* A. Press banca con barra 60 kg x 8-9 → press banca con mancuernas 4x10-12 RIR 2. */
  A: () => caso(
    [{ ejercicio: { nombre: "PRESS BANCA C/BARRA", grupo: "Pecho", series: 4, reps: "6-8" }, series: [0, 1, 2, 3].map(banca) }],
    { nombre: "PRESS BANCA C/MANCUERNAS", series_objetivo: 4, reps_objetivo: "10-12", rir_objetivo: "2", rpe_objetivo: 8 }
  ),
  /* B. Press inclinado con mancuernas 25 kg → press inclinado en Smith 4x8 RIR 1-2 RPE 8. */
  B: () => caso(
    [{ ejercicio: { nombre: "PRESS INCLINADO C/MANCUERNAS", grupo: "Pecho", series: 4, reps: "8-10" }, series: [0, 1, 2].map((k) => serie(15, [10]).concat(serie(25, [10, 9, 9 + (k % 2)]))) }],
    { nombre: "PRESS INCLINADO EN SMITH", series_objetivo: 4, reps_objetivo: "8", rir_objetivo: "1-2", rpe_objetivo: 8, comentarios: "SI ESTA OCUPADA, USAR LA BARRA DE ARRIBA" }
  ),
  /* C. Press militar sentado con mancuernas 12 kg x 12 → arrodillado 3x10 RIR 2. */
  C: () => caso(
    [{ ejercicio: { nombre: "PRESS MILITAR C/MANCUERNAS SENTADO", grupo: "Hombro", series: 3, reps: "8-12" }, series: [0, 1, 2].map(() => serie(12, [12, 12, 12])) }],
    { nombre: "PRESS MILITAR ARRODILLADO CON MANCUERNAS", series_objetivo: 3, reps_objetivo: "10", rir_objetivo: "2", rpe_objetivo: 8 }
  ),
  /* D. Rotación torácica: movilidad, nunca kilos (aunque haya historial). */
  D: () => caso(
    [{ ejercicio: { nombre: "PRESS BANCA C/BARRA", grupo: "Pecho" }, series: [0, 1].map(banca) }],
    { nombre: "ROTACION TORACICA EN CUADRUPEDIA CON BRAZOS EXTENDIDOS", series_objetivo: 2, reps_objetivo: "8" }
  )
};

/* Historial amplio de ejemplo (nombres del plan anterior, cargas plausibles). */
const AMPLIO = [
  ["PRESS BANCA C/BARRA", "Pecho", "6-8", (k) => banca(k)],
  ["PRESS INCLINADO EN SMITH", "Pecho", "8-10", () => serie(20, [10]).concat(serie(40, [10, 9, 9]))],
  ["MARIPOSA", "Pecho", "12-15", () => serie(45, [12, 12, 11])],
  ["PRESS MILITAR C/MANCUERNAS SENTADO", "Hombro", "8-12", () => serie(12, [12, 12, 12])],
  ["PRESS FRANCES C/BARRA", "Tríceps", "8-10", () => serie(20, [10, 10, 9])],
  ["TRICEPS A UN BRAZO TOMANDO CODO", "Tríceps", "12", () => serie(8, [12, 12, 12])],
  ["FLEXIONES DE BRAZO EN CAJON BAJO O STEP", "Pecho", "10/10", () => serie(0, [10, 10])],
  ["SENTADILLA SMITH", "Pierna", "6-8", () => serie(40, [8]).concat(serie(60, [8, 8, 7]))],
  ["ESTOCADA BULGARA C/MANCUERNA", "Pierna", "10-12", () => serie(12, [10, 10, 10])],
  ["HIP THRUST CON BARRA", "Glúteo", "8", () => serie(80, [8, 8, 8, 8])],
  ["SENTADILLA SUMO CON KB", "Pierna", "10-12", () => serie(20, [12, 12, 12])],
  ["SILLON DE CUADRICEPS", "Pierna", "12", () => serie(45, [12, 12, 11])],
  ["GEMELOS EN PRENSA HACK", "Pierna", "10-15", () => serie(80, [12, 12, 12])],
  ["DOMINADAS TOMA NEUTRA", "Espalda", "6-8", () => serie(0, [8, 7, 6])],
  ["REMO T CON BARRA", "Espalda", "10", () => serie(40, [10, 10, 10, 9])],
  ["REMO CON MANCUERNA A 1 BRAZO", "Espalda", "10-12", () => serie(22, [10, 10, 10])],
  ["VUELOS LATERALES C/ KETBELL", "Hombro", "8", () => serie(8, [10, 10, 9, 9])],
  ["CURL BICEPS C/BARRA BANCO SCOTT", "Bíceps", "8-10", () => serie(20, [10, 9, 8, 8])],
  ["BICEPS MARTILLO EN POLEA", "Bíceps", "12", () => serie(15, [12, 12, 12])],
  ["SIT UPS", "Core", "10-12", () => serie(0, [12, 12, 10])],
  ["PESO MUERTO RUMANO EN SMITH", "Pierna", "6-8", () => serie(40, [8]).concat(serie(60, [8, 8, 8]))],
  ["PRENSA 45º", "Pierna", "10-12", () => serie(120, [12, 12, 11])],
  ["CURL FEMORAL ACOSTADO", "Pierna", "10-12", () => serie(30, [12, 12, 11, 10])],
  ["SWING C/KETTLEBELL", "Pierna", "10-14", () => serie(16, [14, 14, 12])],
  ["SUBIDAS AL BANCO C/KETBELLS", "Pierna", "12/12", () => serie(12, [12, 12, 12])],
  ["PRESS BANCA C/MANCUERNAS", "Pecho", "10-12", () => serie(15, [10]).concat(serie(25, [11, 10, 10, 10]))],
  ["POLEA DORSAL AL PECHO TOMA AMPLIA", "Espalda", "10-12", () => serie(50, [10, 10, 10, 9])],
  ["REMO BAJO POLEA TOMA SUPINA", "Espalda", "10-12", () => serie(45, [10, 10, 10])],
  ["BICEPS C/BARRA PLANA", "Bíceps", "12", () => serie(25, [10, 10, 9])],
  ["TRICEPS TRASNUCA C/BARRA", "Tríceps", "12", () => serie(20, [12, 12, 11])],
  ["MANGUITO ROTADOR CON BANDA (NIVEL 2)", "Hombro", "8", () => serie(0, [8, 8])],
  ["ROTACION TORACICA EN CUADRUPEDIA CON BRAZOS EXTENDIDOS", "Espalda", "8", () => serie(0, [8, 8])]
];

function historialAmplio() {
  const viejo = planArchivado("plan-viejo", AMPLIO.map(([nombre, grupo, reps]) => ({ nombre, grupo, reps })));
  const activo = planActivo("plan-n4", PLAN_N4.dias.map((d) => ({ nombre: d.nombre, ejercicios: d.ejercicios.map((e) => Object.assign({}, e)) })));
  const ses = sesionesDe(viejo, AMPLIO.map(([nombre, , , f]) => ({ nombre, series: [0, 1, 2].map(f) })), "2026-09-07", 7);
  return datos([viejo, activo], "plan-n4", ses);
}

module.exports = { CASOS, caso, historialAmplio, serie, planArchivado, planActivo, sesionesDe, datos, PLAN_N4 };
