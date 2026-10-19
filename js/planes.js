/* Acceso al plan activo (E1: lectura centralizada; E2: schema 3).

   Schema 3:
     rutina: { plan_activo_id, planes: [ { plan_id, ..., dias: [...] } ] }
   Ningún módulo lee ni escribe la rutina directamente: todo pasa por acá.

   LECTURA (puras, sin modificar `data`): devuelven las referencias
   originales (no clonan); los consumidores no deben mutar lo que reciben
   salvo a través de las funciones de MUTACIÓN de abajo.

   MUTACIÓN: solo se llaman dentro de GYMAPP.storage.updateData(), sobre el
   `data` que recibe el updater. Mantienen `orden` contiguo (1..n) y los
   campos de schema 3 de cada ejercicio nuevo. */
var GYMAPP = window.GYMAPP || (window.GYMAPP = {});

GYMAPP.planes = (function () {
  /* --- Lectura --- */

  function buscarPlan(data, planId) {
    var rutina = data && data.rutina;
    if (!rutina || !Array.isArray(rutina.planes)) return null;
    return rutina.planes.filter(function (p) { return p && p.plan_id === planId; })[0] || null;
  }

  function planActivo(data) {
    var rutina = data && data.rutina;
    if (!rutina) return null;
    return buscarPlan(data, rutina.plan_activo_id);
  }

  function diasDelPlanActivo(data) {
    var plan = planActivo(data);
    return plan && Array.isArray(plan.dias) ? plan.dias : [];
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

  /* --- Mutación (solo dentro de storage.updateData) --- */

  function exigirPlanActivo(data) {
    var plan = planActivo(data);
    if (!plan || !Array.isArray(plan.dias)) throw new Error("No hay un plan activo válido.");
    return plan;
  }

  function renumerar(lista) {
    lista.forEach(function (item, i) { item.orden = i + 1; });
  }

  /* Agrega un día al final del plan activo (con sus ejercicios, si trae)
     y devuelve el día guardado. */
  function agregarDiaAlPlanActivo(data, dia) {
    var plan = exigirPlanActivo(data);
    var nuevo = GYMAPP.storage.crearDiaV3(dia, plan.dias.length + 1);
    plan.dias.push(nuevo);
    return nuevo;
  }

  function eliminarDiaDelPlanActivo(data, diaId) {
    var plan = exigirPlanActivo(data);
    plan.dias = plan.dias.filter(function (d) { return d.id !== diaId; });
    renumerar(plan.dias);
  }

  /* Agrega un ejercicio al final de un día del plan activo; null si el día
     no existe. */
  function agregarEjercicioADiaActivo(data, diaId, ejercicio) {
    var dia = buscarDiaActivo(data, diaId);
    if (!dia) return null;
    var nuevo = GYMAPP.storage.crearEjercicioV3(ejercicio, dia.ejercicios.length + 1);
    dia.ejercicios.push(nuevo);
    return nuevo;
  }

  function eliminarEjercicioDeDiaActivo(data, diaId, ejercicioId) {
    var dia = buscarDiaActivo(data, diaId);
    if (!dia) return;
    dia.ejercicios = dia.ejercicios.filter(function (e) { return e.id !== ejercicioId; });
    renumerar(dia.ejercicios);
  }

  return {
    buscarPlan: buscarPlan,
    planActivo: planActivo,
    diasDelPlanActivo: diasDelPlanActivo,
    ejerciciosDelPlanActivo: ejerciciosDelPlanActivo,
    buscarDiaActivo: buscarDiaActivo,
    buscarEjercicioActivo: buscarEjercicioActivo,
    buscarEjercicioEnDiaActivo: buscarEjercicioEnDiaActivo,
    agregarDiaAlPlanActivo: agregarDiaAlPlanActivo,
    eliminarDiaDelPlanActivo: eliminarDiaDelPlanActivo,
    agregarEjercicioADiaActivo: agregarEjercicioADiaActivo,
    eliminarEjercicioDeDiaActivo: eliminarEjercicioDeDiaActivo
  };
})();
