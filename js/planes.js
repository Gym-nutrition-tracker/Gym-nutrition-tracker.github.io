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

  /* --- Lectura sobre TODOS los planes (E3) ---
     Para resolver IDs históricos (por ejemplo, el plan legacy). Recorren
     rutina.planes en su orden; el plan activo sigue siendo el único
     editable y el único que usan Entrenar, Dashboard y PROG-04. */

  function planesValidos(data) {
    var rutina = data && data.rutina;
    if (!rutina || !Array.isArray(rutina.planes)) return [];
    return rutina.planes.filter(function (p) { return p && Array.isArray(p.dias); });
  }

  /* { plan, dia } del primer plan que tiene ese día, o null. */
  function buscarDiaEnPlanes(data, diaId) {
    var planes = planesValidos(data);
    for (var i = 0; i < planes.length; i++) {
      var dia = planes[i].dias.filter(function (d) { return d && d.id === diaId; })[0];
      if (dia) return { plan: planes[i], dia: dia };
    }
    return null;
  }

  /* { plan, dia, ejercicio } del primer plan/día que tiene ese ejercicio. */
  function buscarEjercicioEnPlanes(data, ejercicioId) {
    var planes = planesValidos(data);
    for (var i = 0; i < planes.length; i++) {
      for (var j = 0; j < planes[i].dias.length; j++) {
        var dia = planes[i].dias[j];
        var ejercicio = (dia && dia.ejercicios || []).filter(function (e) { return e && e.id === ejercicioId; })[0];
        if (ejercicio) return { plan: planes[i], dia: dia, ejercicio: ejercicio };
      }
    }
    return null;
  }

  function buscarEjercicioEnPlan(data, planId, ejercicioId) {
    var plan = buscarPlan(data, planId);
    if (!plan || !Array.isArray(plan.dias)) return null;
    for (var j = 0; j < plan.dias.length; j++) {
      var ejercicio = (plan.dias[j] && plan.dias[j].ejercicios || []).filter(function (e) { return e && e.id === ejercicioId; })[0];
      if (ejercicio) return ejercicio;
    }
    return null;
  }

  /* --- Planes no activos y vigencia (E4) --- */

  /* Planes que NO son el activo, en el orden de rutina.planes. Solo para
     consulta (Historial de planes); nunca son entrenables. */
  function planesHistoricos(data) {
    var activoId = data && data.rutina ? data.rutina.plan_activo_id : null;
    return planesValidos(data).filter(function (p) { return p.plan_id !== activoId; });
  }

  /* Sesiones cuyo dia_rutina_id es uno de los días del plan. Las sesiones
     todavía no tienen plan_id: el vínculo observable es el ID del día. */
  function sesionesDelPlan(data, planId) {
    var plan = buscarPlan(data, planId);
    if (!plan || !Array.isArray(plan.dias)) return [];
    var ids = {};
    plan.dias.forEach(function (d) { if (d) ids[d.id] = true; });
    return ((data && data.sesiones_entrenamiento) || []).filter(function (s) {
      return s && s.dia_rutina_id && ids[s.dia_rutina_id] === true;
    });
  }

  function cantidadSesionesPlan(data, planId) {
    return sesionesDelPlan(data, planId).length;
  }

  /* Fechas (locales, YYYY-MM-DD) de la primera y la última sesión del plan,
     o null. Es actividad observada: NO es la vigencia del plan. */
  function rangoObservadoPlan(data, planId) {
    var fechas = sesionesDelPlan(data, planId).map(function (s) { return GYMAPP.util.fechaLocalISO(s.fecha); }).sort();
    return fechas.length ? { desde: fechas[0], hasta: fechas[fechas.length - 1] } : null;
  }

  /* Fecha conceptual "YYYY-MM-DD" → número de día, o null si no es una
     fecha real. Se calcula con los componentes de la fecha, sin pasar por
     zonas horarias: el mismo resultado en Argentina, UTC o cualquier otra. */
  function numeroDeDia(iso) {
    if (typeof iso !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
    var p = iso.split("-").map(Number);
    var ms = Date.UTC(p[0], p[1] - 1, p[2]);
    var control = new Date(ms);
    if (control.getUTCFullYear() !== p[0] || control.getUTCMonth() !== p[1] - 1 || control.getUTCDate() !== p[2]) return null;
    return Math.round(ms / 86400000);
  }

  function esFechaValida(iso) {
    return numeroDeDia(iso) !== null;
  }

  /* Estado temporal del plan para `hoyISO` (fecha local YYYY-MM-DD). Pura:
     no lee el reloj ni modifica nada. Semana 1 empieza en fecha_inicio;
     semanas_totales = ceil((fin - inicio + 1 día) / 7). Fechas inválidas se
     tratan como ausentes. */
  function calcularEstadoTemporalPlan(plan, hoyISO) {
    var inicio = numeroDeDia(plan && plan.fecha_inicio);
    var fin = numeroDeDia(plan && plan.fecha_fin);
    var hoy = numeroDeDia(hoyISO);
    var r = { estado: "sin_fechas", semana_actual: null, semanas_totales: null, semanas_restantes: null };
    if (inicio === null && fin === null) return r;
    if (inicio !== null && fin !== null && fin >= inicio) r.semanas_totales = Math.ceil((fin - inicio + 1) / 7);
    if (hoy === null) { r.estado = "vigente"; return r; }

    if (inicio !== null && hoy < inicio) {
      r.estado = "futuro";
      r.semanas_restantes = r.semanas_totales;
    } else if (fin !== null && hoy > fin) {
      r.estado = "finalizado";
      if (r.semanas_totales !== null) r.semanas_restantes = 0;
    } else {
      r.estado = "vigente";
      if (inicio !== null) r.semana_actual = Math.floor((hoy - inicio) / 7) + 1;
      if (r.semanas_totales !== null) r.semanas_restantes = r.semanas_totales - r.semana_actual;
    }
    return r;
  }

  /* Normaliza y valida { nombre, fecha_inicio, fecha_fin } tal como llegan
     del formulario. Vacío → null. Devuelve { ok, valores } o { ok, error }. */
  function validarMetadataPlan(cambios) {
    cambios = cambios || {};
    var nombre = typeof cambios.nombre === "string" ? cambios.nombre.trim() : "";
    var limpiar = function (v) { return typeof v === "string" && v.trim() ? v.trim() : null; };
    var inicio = limpiar(cambios.fecha_inicio);
    var fin = limpiar(cambios.fecha_fin);
    if (inicio !== null && !esFechaValida(inicio)) return { ok: false, error: "La fecha de inicio no es válida." };
    if (fin !== null && !esFechaValida(fin)) return { ok: false, error: "La fecha de fin no es válida." };
    if (inicio !== null && fin !== null && numeroDeDia(fin) < numeroDeDia(inicio)) {
      return { ok: false, error: "La fecha de fin no puede ser anterior a la de inicio." };
    }
    return { ok: true, valores: { nombre: nombre || null, fecha_inicio: inicio, fecha_fin: fin } };
  }

  /* --- Vínculo sesión ↔ plan (E5) ---
     Solo para sesiones NUEVAS de gimnasio. Las sesiones anteriores a E5 no
     se tocan: no se les agrega plan_id ni snapshot. */

  /* Copia de la prescripción del ejercicio del plan: SOLO los 8 campos de
     storage.CAMPOS_SNAPSHOT_PRESCRIPCION (ausente → null). */
  function crearSnapshotPrescripcion(ejercicio) {
    var snap = {};
    GYMAPP.storage.CAMPOS_SNAPSHOT_PRESCRIPCION.forEach(function (campo) {
      snap[campo] = ejercicio && ejercicio[campo] !== undefined ? ejercicio[campo] : null;
    });
    return snap;
  }

  /* Devuelve null si la sesión de gimnasio se puede vincular al plan activo
     (el plan existe, el día está en el plan y cada ejercicio está en ese
     día), o el mensaje de error para el usuario. */
  function validarSesionContraPlanActivo(data, sesion) {
    var plan = planActivo(data);
    if (!plan || !Array.isArray(plan.dias)) return "No se encontró el plan activo de tu rutina. No se guardó la sesión.";
    var dia = plan.dias.filter(function (d) { return d && d.id === sesion.dia_rutina_id; })[0];
    if (!dia) return "El día seleccionado ya no existe en tu plan activo. No se guardó la sesión.";
    var ejercicios = sesion.ejercicios_realizados || [];
    for (var i = 0; i < ejercicios.length; i++) {
      var existe = (dia.ejercicios || []).some(function (e) { return e && e.id === ejercicios[i].ejercicio_id; });
      if (!existe) return "Un ejercicio de la sesión ya no existe en ese día del plan activo. No se guardó la sesión.";
    }
    return null;
  }

  /* Copia de `sesion` con plan_id (después de "tipo") y el campo extra en
     cada ejercicio realizado. */
  function conPlanId(sesion, planId) {
    var nueva = {};
    Object.keys(sesion).forEach(function (k) {
      if (k === "plan_id") return;
      nueva[k] = sesion[k];
      if (k === "tipo") nueva.plan_id = planId;
    });
    if (!("plan_id" in nueva)) nueva.plan_id = planId;
    return nueva;
  }

  /* Sesión nueva de gimnasio → { ok: true, sesion } con plan_id y
     prescripcion_snapshot en cada ejercicio, o { ok: false, error }. Pura:
     no modifica `data` ni `sesion`. Se llama justo antes del único
     updateData que guarda la sesión. */
  function vincularSesionAlPlanActivo(data, sesion) {
    var error = validarSesionContraPlanActivo(data, sesion);
    if (error) return { ok: false, error: error };
    var plan = planActivo(data);
    var nueva = conPlanId(sesion, plan.plan_id);
    nueva.ejercicios_realizados = sesion.ejercicios_realizados.map(function (er) {
      var ejercicio = buscarEjercicioEnDiaActivo(data, sesion.dia_rutina_id, er.ejercicio_id);
      var copia = {};
      Object.keys(er).forEach(function (k) { if (k !== "prescripcion_snapshot") copia[k] = er[k]; });
      copia.prescripcion_snapshot = crearSnapshotPrescripcion(ejercicio);
      return copia;
    });
    return { ok: true, sesion: nueva };
  }

  /* Edición: la sesión editada conserva plan_id y los snapshots de la
     original tal cual (nunca se regeneran). Si la original no los tenía
     (sesión anterior a E5), no se agregan. */
  function conservarVinculoPlan(original, editada) {
    var resultado = Object.prototype.hasOwnProperty.call(original, "plan_id") ? conPlanId(editada, original.plan_id) : editada;
    var snapshots = {};
    (original.ejercicios_realizados || []).forEach(function (er) {
      if (er && Object.prototype.hasOwnProperty.call(er, "prescripcion_snapshot")) snapshots[er.ejercicio_id] = er.prescripcion_snapshot;
    });
    if (Array.isArray(resultado.ejercicios_realizados)) {
      resultado.ejercicios_realizados = resultado.ejercicios_realizados.map(function (er) {
        if (!Object.prototype.hasOwnProperty.call(snapshots, er.ejercicio_id)) return er;
        var copia = {};
        Object.keys(er).forEach(function (k) { if (k !== "prescripcion_snapshot") copia[k] = er[k]; });
        copia.prescripcion_snapshot = snapshots[er.ejercicio_id];
        return copia;
      });
    }
    return resultado;
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

  /* Edita SOLO nombre, fecha_inicio y fecha_fin del plan activo (in-place,
     sin versión nueva). Valida otra vez y falla sin tocar nada si los
     valores no son válidos. No toca días, sesiones ni otros planes. */
  function actualizarMetadataPlanActivo(data, cambios) {
    var plan = exigirPlanActivo(data);
    var v = validarMetadataPlan(cambios);
    if (!v.ok) throw new Error(v.error);
    plan.nombre = v.valores.nombre;
    plan.fecha_inicio = v.valores.fecha_inicio;
    plan.fecha_fin = v.valores.fecha_fin;
    return plan;
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
    buscarDiaEnPlanes: buscarDiaEnPlanes,
    buscarEjercicioEnPlanes: buscarEjercicioEnPlanes,
    buscarEjercicioEnPlan: buscarEjercicioEnPlan,
    planesHistoricos: planesHistoricos,
    cantidadSesionesPlan: cantidadSesionesPlan,
    rangoObservadoPlan: rangoObservadoPlan,
    calcularEstadoTemporalPlan: calcularEstadoTemporalPlan,
    esFechaValida: esFechaValida,
    validarMetadataPlan: validarMetadataPlan,
    actualizarMetadataPlanActivo: actualizarMetadataPlanActivo,
    crearSnapshotPrescripcion: crearSnapshotPrescripcion,
    validarSesionContraPlanActivo: validarSesionContraPlanActivo,
    vincularSesionAlPlanActivo: vincularSesionAlPlanActivo,
    conservarVinculoPlan: conservarVinculoPlan,
    agregarDiaAlPlanActivo: agregarDiaAlPlanActivo,
    eliminarDiaDelPlanActivo: eliminarDiaDelPlanActivo,
    agregarEjercicioADiaActivo: agregarEjercicioADiaActivo,
    eliminarEjercicioDeDiaActivo: eliminarEjercicioDeDiaActivo
  };
})();
