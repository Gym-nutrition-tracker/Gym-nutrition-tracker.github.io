/* E1: única puerta de LECTURA de la rutina / plan activo.

   Todos los módulos leen los días y ejercicios de la rutina actual a través
   de estas funciones, en vez de acceder a data.rutina.dias directamente.
   Así, cuando llegue schema 3 (rutina.planes + rutina.plan_activo_id), solo
   cambia la implementación interna de este archivo y no cada consumidor.

   Mientras schema_version = 2 la fuente es data.rutina.dias, tal cual.

   Contrato:
   - Solo lectura: nunca modifica `data`.
   - Devuelve las referencias originales (no clona), igual que el acceso
     directo que reemplaza: los consumidores no deben mutar lo que reciben.
     Las escrituras sobre la rutina siguen en rutina.js (updateData).
   - Orden: el mismo de data.rutina.dias y de dia.ejercicios. */
var GYMAPP = window.GYMAPP || (window.GYMAPP = {});

GYMAPP.planes = (function () {
  /* TODO(schema 3): resolver rutina.plan_activo_id dentro de rutina.planes
     y devolver los días de ese plan. */
  function diasDelPlanActivo(data) {
    return (data && data.rutina && data.rutina.dias) || [];
  }

  /* Ejercicios de todos los días del plan activo, en orden (día por día),
     en un array nuevo con las referencias originales. */
  function ejerciciosDelPlanActivo(data) {
    return diasDelPlanActivo(data).reduce(function (acc, dia) {
      return acc.concat(dia.ejercicios || []);
    }, []);
  }

  function buscarDiaActivo(data, diaId) {
    return diasDelPlanActivo(data).filter(function (d) { return d.id === diaId; })[0] || null;
  }

  /* Primer ejercicio con ese id recorriendo los días en orden. */
  function buscarEjercicioActivo(data, ejercicioId) {
    return ejerciciosDelPlanActivo(data).filter(function (e) { return e.id === ejercicioId; })[0] || null;
  }

  function buscarEjercicioEnDiaActivo(data, diaId, ejercicioId) {
    var dia = buscarDiaActivo(data, diaId);
    if (!dia) return null;
    return (dia.ejercicios || []).filter(function (e) { return e.id === ejercicioId; })[0] || null;
  }

  return {
    diasDelPlanActivo: diasDelPlanActivo,
    ejerciciosDelPlanActivo: ejerciciosDelPlanActivo,
    buscarDiaActivo: buscarDiaActivo,
    buscarEjercicioActivo: buscarEjercicioActivo,
    buscarEjercicioEnDiaActivo: buscarEjercicioEnDiaActivo
  };
})();
