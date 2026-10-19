/* Historial de Entrenar: sesiones del plan anterior (IDs legacy reales),
   una del plan actual, una de un bloque histórico desconocido y fútbol. */
/* Primeros ejercicios de cada día legacy con sus IDs reales del plan
   anterior; el resto (dia-ejN) quedan como IDs desconocidos. */
const IDS_REALES = {
  "mu4c87ep730qj1": ["mu4c87epsr80xw", "mu4c87epra2lxd"],
  "mu4c87ep2snsau": ["mu4c87epd9q159", "mu4c87ep8spsdp"],
  "mu4c87eptjrn47": ["mu4c87epjry3ek", "mu4c87epbm1w7y"]
};

function sesionGym(id, fechaISO, dia, cantidadEjercicios, rpe) {
  const ejercicios = [];
  for (let i = 1; i <= cantidadEjercicios; i++) {
    const real = (IDS_REALES[dia] || [])[i - 1];
    ejercicios.push({ ejercicio_id: real || dia + "-ej" + i, series: [{ peso_kg: 20, reps: 10 }, { peso_kg: 25 + i, reps: 12 }, { peso_kg: 25 + i, reps: 11 }] });
  }
  return { id, fecha: fechaISO + "T18:30:00", tipo: "gimnasio", dia_rutina_id: dia, duracion_min: 70, rpe: rpe || 8, notas: "", ejercicios_realizados: ejercicios, futbol_detalle: null };
}

function datasetEntrenar() {
  return {
    schema_version: 2,
    usuario: { nombre: "Nico", fecha_nacimiento: "1990-05-10", sexo: "masculino", peso_kg: 80, altura_cm: 178, objetivo: "mantenimiento", nivel_actividad: "moderado",
      metas_macros: { calorias: 2600, proteinas_g: 160, carbos_g: 300, grasas_g: 80 },
      actividades: [{ tipo: "gimnasio", meta_semanal: 5 }, { tipo: "futbol", meta_semanal: 1 }] },
    rutina: { dias: [
      { id: "nuevo-1", nombre: "Día 1 · Pecho y tríceps", ejercicios: [
        { id: "nuevo-1-ej1", nombre: "Press banca", grupo_muscular: "Pecho", series_objetivo: 4, reps_objetivo: "8-10" },
        { id: "nuevo-1-ej2", nombre: "Fondos", grupo_muscular: "Tríceps", series_objetivo: 3, reps_objetivo: "10-12" }
      ] }
    ] },
    sesiones_entrenamiento: [
      sesionGym("h-0216", "2026-10-02", "mu4c87eptjrn47", 10),
      sesionGym("h-0510", "2026-10-05", "mu4c87ep730qj1", 10),
      sesionGym("h-0810", "2026-10-08", "mu4c87ep2snsau", 10),
      sesionGym("h-1310", "2026-10-13", "mu4c87ep730qj1", 10),
      sesionGym("h-1510", "2026-10-15", "mu4c87ep2snsau", 10),
      sesionGym("h-1610", "2026-10-16", "mu4c87eptjrn47", 10),
      sesionGym("x-desc", "2026-09-20", "id-historico-desconocido", 3),
      Object.assign(sesionGym("n-1910", "2026-10-19", "nuevo-1", 2), { ejercicios_realizados: [
        { ejercicio_id: "nuevo-1-ej1", series: [{ peso_kg: 60, reps: 10 }] },
        { ejercicio_id: "nuevo-1-ej2", series: [{ peso_kg: 0, reps: 12 }] }
      ] }),
      { id: "f-1710", fecha: "2026-10-17T20:00:00", tipo: "futbol", dia_rutina_id: null, duracion_min: 90, rpe: 8, notas: "",
        ejercicios_realizados: [], futbol_detalle: null, detalle: { tipo_sesion: "partido", posicion: "", minutos_jugados: 80 } }
    ],
    registros_nutricion: [], base_alimentos: [], medidas_corporales: []
  };
}

module.exports = { datasetEntrenar };
