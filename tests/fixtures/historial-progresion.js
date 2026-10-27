/* PROG-04.1: historiales DE EJEMPLO para la recomendación de la próxima
   sesión. SIN datos personales: nombres de ejercicios del plan (ya públicos
   en el repo) y cargas/reps plausibles inventadas para cubrir cada acción.
   No es el backup del usuario. */
const F = require("./historial-cargas");

const HOY = "2026-11-09";
const serie = F.serie;

function sumarDias(iso, n) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/* Datos con un plan activo de un día y, por ejercicio, sus registros:
   ejercicios: [{ nombre, series_objetivo, reps_objetivo, rir_objetivo?, rpe_objetivo?, registros: [{ series, rpe? }] }]
   Los registros son de la más vieja a la más nueva, cada `cada` días,
   terminando `ultimaHace` días antes de HOY. */
function armar(ejercicios, opciones) {
  opciones = opciones || {};
  const cada = opciones.cada || 4;
  const ultimaHace = opciones.ultimaHace == null ? 3 : opciones.ultimaHace;
  const plan = F.planActivo("plan-act", [{ nombre: "Día", ejercicios: ejercicios.map((e) => { const x = Object.assign({}, e); delete x.registros; return x; }) }]);
  const sesiones = [];
  plan.dias[0].ejercicios.forEach((ej, i) => {
    const regs = ejercicios[i].registros || [];
    regs.forEach((r, k) => {
      const fecha = sumarDias(HOY, -(ultimaHace + (regs.length - 1 - k) * cada));
      sesiones.push({
        id: "s-" + i + "-" + k, fecha: fecha + "T18:00:00", tipo: "gimnasio", dia_rutina_id: plan.dias[0].id, plan_id: plan.plan_id,
        duracion_min: 60, rpe: r.rpe == null ? 7 : r.rpe, notas: "", futbol_detalle: null,
        ejercicios_realizados: [{ ejercicio_id: ej.id, series: r.series }]
      });
    });
  });
  const d = F.datos([plan], plan.plan_id, sesiones);
  if (opciones.pesoCorporal) d.medidas_corporales = [{ id: "m1", fecha: sumarDias(HOY, -10), peso_kg: opciones.pesoCorporal }];
  return d;
}

/* Casos de ejemplo con los ejercicios que nombró el usuario (sin
   hardcodear nada en el motor: solo datos). */
const EJEMPLOS = [
  { nombre: "PRESS BANCA C/MANCUERNAS", series_objetivo: 4, reps_objetivo: "10-12", rir_objetivo: "2",
    registros: [{ series: serie(15, [10]).concat(serie(25, [11, 11, 10, 10])) }, { series: serie(15, [10]).concat(serie(25, [12, 12, 11, 11])) }, { series: serie(15, [10]).concat(serie(25, [12, 12, 12, 12])) }] },
  { nombre: "PRESS BANCA C/BARRA", series_objetivo: 4, reps_objetivo: "10-12", rir_objetivo: "2",
    registros: [{ series: serie(40, [10]).concat(serie(55, [10, 10, 10, 10])) }, { series: serie(40, [10]).concat(serie(55, [11, 10, 10, 10])) }, { series: serie(40, [10]).concat(serie(55, [11, 11, 10, 10])) }] },
  { nombre: "PRESS INCLINADO EN SMITH", series_objetivo: 4, reps_objetivo: "8", rir_objetivo: "1-2",
    registros: [{ series: serie(40, [8, 8, 8, 8]) }, { series: serie(42.5, [8, 7, 7, 6]) }, { series: serie(42.5, [7, 7, 6, 6]) }] },
  { nombre: "PRESS MILITAR C/MANCUERNAS SENTADO", series_objetivo: 3, reps_objetivo: "8-12", rir_objetivo: "2",
    registros: [{ series: serie(14, [10, 10, 9]) }, { series: serie(14, [8, 8, 7]) }, { series: serie(14, [7, 7, 6]) }] },
  { nombre: "BICEPS MARTILLO EN POLEA", series_objetivo: 3, reps_objetivo: "9-12",
    registros: [{ series: serie(15, [12, 12, 12]) }] },
  { nombre: "DOMINADAS TOMA NEUTRA", series_objetivo: 4, reps_objetivo: "6-8", rir_objetivo: "1",
    registros: [{ series: serie(82.5, [8, 8, 8, 8]) }, { series: serie(82.5, [8, 8, 8, 8]) }, { series: serie(82.5, [8, 8, 8, 8]) }] },
  { nombre: "REMO CON MANCUERNA A 1 BRAZO", series_objetivo: 3, reps_objetivo: "10-12", rir_objetivo: "2",
    registros: [{ series: serie(22, [10, 10, 10]) }, { series: serie(22, [12, 9, 10]) }, { series: serie(22, [10, 10, 10]) }] },
  { nombre: "TRICEPS EN POLEA BARRA PLANA", series_objetivo: 3, reps_objetivo: "10-12", rir_objetivo: "2",
    registros: [{ series: serie(25, [12, 12, 11]) }, { series: serie(25, [12, 12, 12]) }, { series: serie(25, [9, 9, 8]), rpe: 8 }] }
];

module.exports = { HOY, armar, EJEMPLOS, serie, sumarDias };
