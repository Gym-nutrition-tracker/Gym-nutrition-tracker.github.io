/* Dataset con 5 bloques activos (rutina actual) y 5 bloques históricos
   (sesiones cuyo dia_rutina_id ya no existe en la rutina). Dos históricos
   coinciden a propósito en fechas y cantidad de sesiones. */
function sumarDias(iso, n) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
const serie = (p, reps) => reps.map((r) => ({ peso_kg: p, reps: r }));

/* Ejercicios con IDs legacy reales del plan anterior (algunos), con
   aproximación + series efectivas; *-ej1/*-ej2 quedan como IDs desconocidos. */
const EJERCICIOS_LEGACY = {
  "mu4c87ep730qj1": [
    ["mu4c87epsr80xw", (i) => serie(40, [10]).concat(serie(60, [8, 8, 7 + (i % 2)]))],
    ["mu4c87epqc4fa9", () => serie(20, [10, 10, 10])],
    ["mu4c87epra2lxd", () => serie(90, [12]).concat(serie(105, [10, 10]))],
    ["mu4c87epoowggf", () => serie(0, [15, 15, 12])]
  ],
  "mu4c87ep2snsau": [
    ["mu4c87epd9q159", (i) => serie(0, [8, 7, 6 + (i % 2)])],
    ["mu4c87ep8spsdp", () => serie(30, [10]).concat(serie(40, [10, 10, 9]))]
  ],
  "mu4c87eptjrn47": [
    ["mu4c87epjry3ek", () => serie(18, [10]).concat(serie(22, [10, 10, 9]))],
    ["mu4c87epbm1w7y", () => serie(50, [12, 12, 10])]
  ]
};

function datasetHistoricos(opciones) {
  opciones = opciones || {};
  const ses = [];
  let n = 0;
  const gym = (fecha, dia, rpe, ejercicios) => ses.push({
    id: "s" + (++n), fecha: fecha + "T18:00:00", tipo: "gimnasio", dia_rutina_id: dia, duracion_min: 60, rpe, notas: "", futbol_detalle: null,
    ejercicios_realizados: ejercicios.map((e) => ({ ejercicio_id: e.id, series: e.series }))
  });

  /* Plan anterior: 5 bloques eliminados (ids del PDF viejo), ago-sep 2026. */
  const historicos = [
    { id: "old-1", desde: "2026-08-03", semanas: 4 },
    { id: "old-2", desde: "2026-08-04", semanas: 6 },
    { id: "old-3", desde: "2026-08-05", semanas: 3 },
    { id: "old-4", desde: "2026-09-07", semanas: 2 },
    { id: "old-5", desde: "2026-09-07", semanas: 2 }
  ];
  historicos.forEach((h, k) => {
    for (let i = 0; i < h.semanas; i++) {
      gym(sumarDias(h.desde, i * 7), h.id, 7, [
        { id: h.id + "-e1", series: serie(20, [10]).concat(serie(25 + k, [12, 12, 11 + (i % 2)])) },
        { id: h.id + "-e2", series: serie(40, [8, 8, 8]) },
        { id: h.id + "-e3", series: serie(0, [15, 15, 12]) }
      ]);
    }
  });

  /* Plan actual: 5 bloques activos, desde el 12/10/2026. */
  const nombres = ["Día 1 · Pecho", "Día 2 · Espalda", "Día 3 · Piernas", "Día 4 · Hombros", "Día 5 · Brazos"];
  const dias = nombres.map((nombre, k) => ({
    id: "D" + (k + 1), nombre,
    ejercicios: [1, 2].map((j) => ({ id: "D" + (k + 1) + "-e" + j, nombre: nombre + " ej " + j, grupo_muscular: "", series_objetivo: 4, reps_objetivo: "10-12" }))
  }));
  for (let i = 0; i < 4; i++) {
    dias.forEach((d, k) => {
      gym(sumarDias("2026-10-12", i * 7 + k), d.id, 7, d.ejercicios.map((e) => ({ id: e.id, series: serie(20, [10]).concat(serie(30, [12, 12, 12, 12].map((r, q) => (q < i ? r + 1 : r)))) })));
    });
  }

  /* Opcional: los 5 días reales del plan anterior (IDs legacy del backup),
     con fechas y cantidades distintas, en orden de fechas mezclado a
     propósito respecto del orden del plan. */
  if (opciones.legacy) {
    [
      { id: "mu4c87eptjrn47", desde: "2026-09-19", semanas: 4 },
      { id: "mu4c87ep2snsau", desde: "2026-09-17", semanas: 5 },
      { id: "mu4c87ep730qj1", desde: "2026-09-15", semanas: 4 },
      { id: "mu4c87epiiepiq", desde: "2026-09-18", semanas: 4 },
      { id: "mu4c87ep241kdy", desde: "2026-09-16", semanas: 5 }
    ].forEach((h) => {
      for (let i = 0; i < h.semanas; i++) {
        gym(sumarDias(h.desde, i * 7), h.id, 7, (EJERCICIOS_LEGACY[h.id] || []).map((e) => ({ id: e[0], series: e[1](i) })).concat([
          { id: h.id + "-ej1", series: serie(20, [10]).concat(serie(30, [10, 10, 9 + (i % 2)])) },
          { id: h.id + "-ej2", series: serie(15, [12, 12, 12]) }
        ]));
      }
    });
  }

  /* Opcional: un bloque eliminado hace pocos días con RPE 10 (para probar
     que PROG-04 lo ignora). */
  if (opciones.historicoReciente) {
    ["2026-11-03", "2026-11-05", "2026-11-07"].forEach((f) => gym(f, "old-reciente", 10, [{ id: "old-reciente-e1", series: serie(30, [12, 8, 6, 5]) }]));
  }

  return {
    schema_version: 2,
    usuario: { nombre: "Nico", fecha_nacimiento: "1990-05-10", sexo: "masculino", peso_kg: 80, altura_cm: 178, objetivo: "mantenimiento", nivel_actividad: "moderado",
      metas_macros: { calorias: 2600, proteinas_g: 160, carbos_g: 300, grasas_g: 80 },
      actividades: [{ tipo: "gimnasio", meta_semanal: 5 }] },
    rutina: { dias },
    sesiones_entrenamiento: ses, registros_nutricion: [], base_alimentos: [], medidas_corporales: []
  };
}

module.exports = { datasetHistoricos };
