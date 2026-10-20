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

  /* --- Reasignación manual de una sesión de gimnasio (E6.1) ---
     Corrige UNA sesión vinculada al plan equivocado. Solo cambian plan_id,
     dia_rutina_id y, en cada ejercicio realizado, ejercicio_id y
     prescripcion_snapshot (del ejercicio destino elegido por el usuario).
     Nada de lo que se hizo en el gimnasio cambia. Funciones puras. */

  var SIN_CORRESPONDENCIA = "__ninguno__";

  /* Solo para SUGERIR: sin acentos, minúsculas, espacios simples. */
  function normalizarNombre(nombre) {
    return String(nombre || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
  }

  function buscarSesion(data, sesionId) {
    return ((data && data.sesiones_entrenamiento) || []).filter(function (s) { return s && s.id === sesionId; })[0] || null;
  }

  /* Planes posibles como destino: el activo primero, después los demás en
     el orden de rutina.planes. [{ plan, activo }]. */
  function planesParaReasignar(data) {
    var activo = planActivo(data);
    var lista = activo ? [{ plan: activo, activo: true }] : [];
    planesHistoricos(data).forEach(function (p) { lista.push({ plan: p, activo: false }); });
    return lista;
  }

  /* Día destino sugerido: el mismo día si la sesión ya es de ese plan; si
     no, el único día del plan con el mismo nombre normalizado; si no, null. */
  function sugerirDiaDestino(data, sesion, planId) {
    var plan = buscarPlan(data, planId);
    if (!plan || !Array.isArray(plan.dias)) return null;
    var mismo = plan.dias.filter(function (d) { return d && d.id === sesion.dia_rutina_id; })[0];
    if (mismo) return mismo.id;
    var nombre = normalizarNombre(GYMAPP.rutinasHistoricas.resolverNombreDiaDeSesion(data, sesion));
    var iguales = plan.dias.filter(function (d) { return d && normalizarNombre(d.nombre) === nombre; });
    return iguales.length === 1 ? iguales[0].id : null;
  }

  /* { ejercicio_id original: id destino | "" }. Sugiere SOLO coincidencias
     exactas de nombre normalizado y únicas; nunca equivalencias. */
  function sugerirMapeoEjercicios(data, sesion, planId, diaId) {
    var plan = buscarPlan(data, planId);
    var dia = plan && Array.isArray(plan.dias) ? plan.dias.filter(function (d) { return d && d.id === diaId; })[0] : null;
    var destinos = dia ? (dia.ejercicios || []) : [];
    var usados = {};
    var mapeo = {};
    (sesion.ejercicios_realizados || []).forEach(function (er) {
      var resuelto = GYMAPP.rutinasHistoricas.resolverEjercicioDeSesion(data, sesion, er);
      var nombre = normalizarNombre(resuelto ? resuelto.nombre : "");
      var iguales = destinos.filter(function (e) { return e && nombre && normalizarNombre(e.nombre) === nombre; });
      mapeo[er.ejercicio_id] = iguales.length === 1 && !usados[iguales[0].id] ? iguales[0].id : "";
      if (mapeo[er.ejercicio_id]) usados[mapeo[er.ejercicio_id]] = true;
    });
    return mapeo;
  }

  /* Errores de una elección { planId, diaId, mapeo }: lista de
     { ejercicio_id (original) | null, mensaje }. Vacía = se puede guardar. */
  function validarReasignacion(data, sesionId, eleccion) {
    var errores = [];
    var sesion = buscarSesion(data, sesionId);
    if (!sesion || sesion.tipo !== "gimnasio") return [{ ejercicio_id: null, mensaje: "La sesión no existe o no es de gimnasio." }];
    var plan = buscarPlan(data, eleccion.planId);
    if (!plan || !Array.isArray(plan.dias)) return [{ ejercicio_id: null, mensaje: "El plan destino no existe." }];
    var dia = plan.dias.filter(function (d) { return d && d.id === eleccion.diaId; })[0];
    if (!dia) return [{ ejercicio_id: null, mensaje: "Elegí un día del plan destino." }];
    var originales = (sesion.ejercicios_realizados || []).map(function (er) { return er.ejercicio_id; });
    if (originales.some(function (id, i) { return originales.indexOf(id) !== i; })) {
      return [{ ejercicio_id: null, mensaje: "La sesión tiene ejercicios repetidos y no se puede reasignar." }];
    }
    var idsDia = (dia.ejercicios || []).map(function (e) { return e.id; });
    var asignados = {};
    var mapeo = eleccion.mapeo || {};
    var hayNinguno = false;
    originales.forEach(function (orig) {
      var destino = mapeo[orig];
      if (destino === SIN_CORRESPONDENCIA) {
        hayNinguno = true;
        errores.push({ ejercicio_id: orig, mensaje: "No corresponde a ningún ejercicio." });
      } else if (!destino) {
        errores.push({ ejercicio_id: orig, mensaje: "Elegí el ejercicio correspondiente." });
      } else if (idsDia.indexOf(destino) === -1) {
        errores.push({ ejercicio_id: orig, mensaje: "Ese ejercicio no pertenece al día destino." });
      } else if (asignados[destino]) {
        errores.push({ ejercicio_id: orig, mensaje: "Este ejercicio del plan destino ya está asignado." });
      } else {
        asignados[destino] = true;
      }
    });
    if (hayNinguno) errores.push({ ejercicio_id: null, mensaje: "Para reasignar la sesión, todos los ejercicios realizados deben vincularse con un ejercicio del plan destino." });
    if (!errores.length && sesion.plan_id === plan.plan_id && sesion.dia_rutina_id === dia.id &&
        originales.every(function (orig) { return mapeo[orig] === orig; })) {
      errores.push({ ejercicio_id: null, mensaje: "La sesión ya está vinculada a ese plan, día y ejercicios." });
    }
    return errores;
  }

  /* Invariantes: solo cambian plan_id, dia_rutina_id, ejercicio_id y
     prescripcion_snapshot de ESA sesión. null o el problema. */
  function verificarReasignacion(antes, despues, sesionId) {
    var mismo = function (a, b) { return JSON.stringify(a) === JSON.stringify(b); };
    var sa = antes.sesiones_entrenamiento, sd = despues.sesiones_entrenamiento;
    if (sa.length !== sd.length) return "Cambió la cantidad de sesiones.";
    for (var i = 0; i < sa.length; i++) {
      if (sa[i].id !== sd[i].id) return "Cambió el orden o el id de las sesiones.";
      if (sa[i].id !== sesionId) {
        if (!mismo(sa[i], sd[i])) return "Cambió otra sesión.";
        continue;
      }
      var a = sa[i], b = sd[i];
      var claves = Object.keys(a).concat(Object.keys(b)).filter(function (k) { return ["plan_id", "dia_rutina_id", "ejercicios_realizados"].indexOf(k) === -1; });
      for (var k = 0; k < claves.length; k++) if (!mismo(a[claves[k]], b[claves[k]])) return "Cambió " + claves[k] + " de la sesión.";
      var ea = a.ejercicios_realizados || [], eb = b.ejercicios_realizados || [];
      if (ea.length !== eb.length) return "Cambió la cantidad de ejercicios realizados.";
      for (var j = 0; j < ea.length; j++) {
        var cs = Object.keys(ea[j]).concat(Object.keys(eb[j])).filter(function (x) { return x !== "ejercicio_id" && x !== "prescripcion_snapshot"; });
        for (var c = 0; c < cs.length; c++) if (!mismo(ea[j][cs[c]], eb[j][cs[c]])) return "Cambiaron los datos de ejecución (" + cs[c] + ").";
      }
    }
    var otras = Object.keys(antes).concat(Object.keys(despues)).filter(function (x) { return x !== "sesiones_entrenamiento"; });
    for (var o = 0; o < otras.length; o++) if (!mismo(antes[otras[o]], despues[otras[o]])) return "Cambió " + otras[o] + ".";
    return null;
  }

  /* Reasignación completa en memoria: valida, arma la sesión corregida y
     verifica invariantes. { ok, datos, sesion } o { ok: false, error, errores }. */
  function prepararReasignacionSesion(data, sesionId, eleccion) {
    var errores = validarReasignacion(data, sesionId, eleccion);
    if (errores.length) {
      var general = errores.filter(function (e) { return e.ejercicio_id === null; })[0] || errores[0];
      return { ok: false, error: general.mensaje, errores: errores };
    }
    var plan = buscarPlan(data, eleccion.planId);
    var dia = plan.dias.filter(function (d) { return d.id === eleccion.diaId; })[0];
    var datos = JSON.parse(JSON.stringify(data));
    var indice = datos.sesiones_entrenamiento.findIndex(function (s) { return s.id === sesionId; });
    var original = datos.sesiones_entrenamiento[indice];
    var nueva = conPlanId(original, plan.plan_id);
    nueva.dia_rutina_id = dia.id;
    nueva.ejercicios_realizados = (original.ejercicios_realizados || []).map(function (er) {
      var destino = dia.ejercicios.filter(function (e) { return e.id === eleccion.mapeo[er.ejercicio_id]; })[0];
      var copia = {};
      Object.keys(er).forEach(function (k) { copia[k] = er[k]; });
      copia.ejercicio_id = destino.id;
      copia.prescripcion_snapshot = crearSnapshotPrescripcion(destino);
      return copia;
    });
    datos.sesiones_entrenamiento[indice] = nueva;
    var error = GYMAPP.storage.validarDatosV3(datos) || verificarReasignacion(data, datos, sesionId);
    if (error) return { ok: false, error: "No se pudo preparar la reasignación: " + error, errores: [] };
    return { ok: true, datos: datos, sesion: nueva };
  }

  /* --- Nuevo plan desde un borrador revisado (E6) ---
     El borrador (pdfImport) no tiene IDs ni fechas de evento: todo eso se
     genera recién acá, al confirmar. Las funciones son puras: devuelven
     copias y no escriben nada (la escritura es storage.guardarConCopiaPrevia). */

  /* Generador de IDs inyectable para tests (null = el real). */
  var generadorIds = null;

  function configurarGeneradorIds(fn) {
    generadorIds = typeof fn === "function" ? fn : null;
  }

  function idAleatorio() {
    if (generadorIds) return String(generadorIds());
    var c = window.crypto;
    if (c && typeof c.randomUUID === "function") return c.randomUUID();
    return GYMAPP.util.generarId() + GYMAPP.util.generarId();
  }

  /* Todos los IDs que ya existen: planes, días y ejercicios de todos los
     planes, y los dia_rutina_id / ejercicio_id de todas las sesiones (así
     un ID nuevo nunca coincide con uno histórico). */
  function idsUsados(data) {
    var usados = {};
    planesValidos(data).forEach(function (p) {
      usados[p.plan_id] = true;
      p.dias.forEach(function (d) {
        if (!d) return;
        usados[d.id] = true;
        (d.ejercicios || []).forEach(function (e) { if (e) usados[e.id] = true; });
      });
    });
    ((data && data.sesiones_entrenamiento) || []).forEach(function (s) {
      if (!s) return;
      if (s.dia_rutina_id) usados[s.dia_rutina_id] = true;
      (s.ejercicios_realizados || []).forEach(function (er) { if (er) usados[er.ejercicio_id] = true; });
    });
    return usados;
  }

  function idNuevo(usados, prefijo) {
    for (var i = 0; i < 20; i++) {
      var id = prefijo + idAleatorio();
      if (!usados[id]) {
        usados[id] = true;
        return id;
      }
    }
    throw new Error("No se pudo generar un identificador único.");
  }

  function textoONull(v) {
    if (v === null || v === undefined) return null;
    var t = String(v).replace(/\s+/g, " ").trim();
    return t ? t : null;
  }

  function valorPrescripcion(v) {
    if (v === null || v === undefined) return null;
    if (typeof v === "number") return isFinite(v) ? v : null;
    return textoONull(v);
  }

  /* Borrador revisado → plan schema 3 con IDs nuevos (días y ejercicios
     NUNCA reutilizan IDs de otros planes, aunque se llamen igual).
     opciones: { ahora (ISO), nombreArchivo, versionDe, usados }. */
  function crearPlanDesdeBorrador(borrador, opciones) {
    var usados = opciones.usados || {};
    return {
      plan_id: idNuevo(usados, "plan-"),
      nombre: textoONull(borrador.nombre),
      fecha_inicio: textoONull(borrador.fecha_inicio),
      fecha_fin: textoONull(borrador.fecha_fin),
      origen: "pdf",
      version_de: opciones.versionDe || null,
      creado_en: opciones.ahora,
      archivado_en: null,
      fuente: { tipo: "pdf", nombre_archivo: textoONull(opciones.nombreArchivo) },
      dias: (borrador.dias || []).map(function (dia, i) {
        return {
          id: idNuevo(usados, ""),
          nombre: textoONull(dia.nombre),
          orden: i + 1,
          ejercicios: (dia.ejercicios || []).map(function (e, j) {
            return {
              id: idNuevo(usados, ""),
              nombre: textoONull(e.nombre),
              grupo_muscular: textoONull(e.grupo_muscular),
              series_objetivo: typeof e.series_objetivo === "number" && isFinite(e.series_objetivo) ? e.series_objetivo : null,
              reps_objetivo: textoONull(e.reps_objetivo),
              rir_objetivo: valorPrescripcion(e.rir_objetivo),
              rpe_objetivo: valorPrescripcion(e.rpe_objetivo),
              peso_objetivo: valorPrescripcion(e.peso_objetivo),
              pausa: valorPrescripcion(e.pausa),
              comentarios: textoONull(e.comentarios),
              raw: textoONull(e.raw),
              eliminado: false,
              orden: j + 1
            };
          })
        };
      })
    };
  }

  /* Estructura de un plan nuevo. null o el primer problema. */
  function validarNuevoPlan(plan) {
    if (!plan || typeof plan.plan_id !== "string" || !plan.plan_id) return "El plan no tiene identificador.";
    var meta = validarMetadataPlan({ nombre: plan.nombre || "", fecha_inicio: plan.fecha_inicio || "", fecha_fin: plan.fecha_fin || "" });
    if (!meta.ok) return meta.error;
    if (!Array.isArray(plan.dias) || !plan.dias.length) return "El plan no tiene días.";
    var ids = {};
    var ejercicios = 0;
    var ok = function (v) { return v === null || typeof v === "string" || (typeof v === "number" && isFinite(v)); };
    for (var i = 0; i < plan.dias.length; i++) {
      var d = plan.dias[i];
      if (!d.nombre) return "Falta el nombre del día " + (i + 1) + ".";
      if (d.orden !== i + 1 || ids[d.id]) return "Los días del plan no son válidos.";
      ids[d.id] = true;
      for (var j = 0; j < d.ejercicios.length; j++) {
        var e = d.ejercicios[j];
        if (!e.nombre) return "Falta el nombre de un ejercicio en " + d.nombre + ".";
        if (e.orden !== j + 1 || ids[e.id]) return "Los ejercicios del plan no son válidos.";
        if (e.series_objetivo !== null && !(Number.isInteger(e.series_objetivo) && e.series_objetivo > 0)) return "Las series de " + e.nombre + " no son válidas.";
        if (!ok(e.reps_objetivo) || !ok(e.rir_objetivo) || !ok(e.rpe_objetivo) || !ok(e.peso_objetivo) || !ok(e.pausa)) return "La prescripción de " + e.nombre + " no es válida.";
        ids[e.id] = true;
        ejercicios += 1;
      }
    }
    if (!ejercicios) return "El plan no tiene ejercicios.";
    return null;
  }

  /* Copia de `data` con el plan activo archivado (archivado_en, si no lo
     tenía) y `nuevoPlan` agregado AL FINAL y activo. No toca días,
     ejercicios ni otros campos de ningún plan existente, ni sesiones. */
  function reemplazarPlanActivo(data, nuevoPlan, timestamp) {
    var copia = JSON.parse(JSON.stringify(data));
    var anterior = planActivo(copia);
    if (!anterior) throw new Error("No hay un plan activo válido.");
    if (anterior.archivado_en === null || anterior.archivado_en === undefined) anterior.archivado_en = timestamp;
    copia.rutina.planes.push(JSON.parse(JSON.stringify(nuevoPlan)));
    copia.rutina.plan_activo_id = nuevoPlan.plan_id;
    return copia;
  }

  /* Invariantes del cambio de plan: null o el problema. */
  function verificarCambioDePlan(antes, despues, nuevoPlan) {
    var mismo = function (a, b) { return JSON.stringify(a) === JSON.stringify(b); };
    if (despues.schema_version !== 3 || "dias" in despues.rutina) return "Formato inválido.";
    var planesAntes = antes.rutina.planes, planesDespues = despues.rutina.planes;
    if (planesDespues.length !== planesAntes.length + 1) return "No se agregó exactamente un plan.";
    if (!mismo(planesDespues[planesDespues.length - 1], nuevoPlan) || despues.rutina.plan_activo_id !== nuevoPlan.plan_id) return "El nuevo plan no quedó activo.";
    for (var i = 0; i < planesAntes.length; i++) {
      var a = planesAntes[i], b = planesDespues[i];
      if (a.plan_id === antes.rutina.plan_activo_id) {
        var sinArchivo = JSON.parse(JSON.stringify(b));
        sinArchivo.archivado_en = a.archivado_en;
        if (!mismo(sinArchivo, a) || !b.archivado_en) return "El plan anterior cambió.";
      } else if (!mismo(a, b)) {
        return "Cambió un plan histórico.";
      }
    }
    var claves = Object.keys(antes).concat(Object.keys(despues)).filter(function (k) { return k !== "rutina"; });
    for (var k = 0; k < claves.length; k++) {
      if (!mismo(antes[claves[k]], despues[claves[k]])) return "Cambió " + claves[k] + ".";
    }
    return null;
  }

  /* Todo el cambio de plan en memoria: plan nuevo con IDs nuevos y
     version_de = plan activo, plan anterior archivado con el mismo instante,
     validaciones. { ok, datos, plan } o { ok: false, error }. No escribe. */
  function prepararCambioDePlan(data, borrador, opciones) {
    var anterior = planActivo(data);
    if (!anterior) return { ok: false, error: "No hay un plan activo válido." };
    var plan;
    try {
      plan = crearPlanDesdeBorrador(borrador, { ahora: opciones.ahora, nombreArchivo: opciones.nombreArchivo, versionDe: anterior.plan_id, usados: idsUsados(data) });
    } catch (e) {
      return { ok: false, error: e.message };
    }
    var error = validarNuevoPlan(plan);
    if (error) return { ok: false, error: error };
    var datos = reemplazarPlanActivo(data, plan, opciones.ahora);
    error = GYMAPP.storage.validarDatosV3(datos) || verificarCambioDePlan(data, datos, plan);
    if (error) return { ok: false, error: "No se pudo preparar el nuevo plan: " + error };
    return { ok: true, datos: datos, plan: plan };
  }

  /* true si el borrador tiene los mismos días y ejercicios (nombres y
     prescripción) que `plan`. Solo para advertir; no deduplica. */
  function borradorCoincideConPlan(borrador, plan) {
    if (!plan || !borrador) return false;
    var clave = function (dias) {
      return JSON.stringify((dias || []).map(function (d) {
        return [String(textoONull(d.nombre) || "").toLowerCase(), (d.ejercicios || []).map(function (e) {
          return [String(textoONull(e.nombre) || "").toLowerCase(), e.series_objetivo == null ? null : e.series_objetivo,
            textoONull(e.reps_objetivo), valorPrescripcion(e.rir_objetivo), valorPrescripcion(e.rpe_objetivo), valorPrescripcion(e.peso_objetivo), valorPrescripcion(e.pausa)];
        })];
      }));
    };
    return clave(borrador.dias) === clave(plan.dias);
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
    configurarGeneradorIds: configurarGeneradorIds,
    SIN_CORRESPONDENCIA: SIN_CORRESPONDENCIA,
    planesParaReasignar: planesParaReasignar,
    sugerirDiaDestino: sugerirDiaDestino,
    sugerirMapeoEjercicios: sugerirMapeoEjercicios,
    validarReasignacion: validarReasignacion,
    verificarReasignacion: verificarReasignacion,
    prepararReasignacionSesion: prepararReasignacionSesion,
    crearPlanDesdeBorrador: crearPlanDesdeBorrador,
    validarNuevoPlan: validarNuevoPlan,
    reemplazarPlanActivo: reemplazarPlanActivo,
    prepararCambioDePlan: prepararCambioDePlan,
    borradorCoincideConPlan: borradorCoincideConPlan,
    agregarDiaAlPlanActivo: agregarDiaAlPlanActivo,
    eliminarDiaDelPlanActivo: eliminarDiaDelPlanActivo,
    agregarEjercicioADiaActivo: agregarEjercicioADiaActivo,
    eliminarEjercicioDeDiaActivo: eliminarEjercicioDeDiaActivo
  };
})();
