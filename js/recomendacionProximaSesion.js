/* PROG-04.1: qué hacer en la PRÓXIMA sesión de cada ejercicio.

   PROG-04 dice el ESTADO (progresar, consolidar, descargar...); este módulo
   decide la ACCIÓN concreta del ejercicio: carga y reps objetivo. Reglas
   deterministas y explicables, sin ML y sin periodización por calendario:
   todo sale del rendimiento real de las últimas exposiciones.

   Capas (funciones puras salvo el render):
     analizarHistorialEjercicio  ejecuciones del MISMO ejercicio (mismo id o
                                 mismo nombre estricto; nunca variantes),
                                 series principales de PROG-03
     decidirAccion               una sola acción: subir / mantener_reps /
                                 consolidar / bajar / descargar / insuficiente
     calcularCargaSiguiente      salto pequeño según implemento (o el salto
                                 que el usuario ya usó en ese ejercicio)
     explicarRecomendacion       "¿Por qué?" en lenguaje simple

   Datos de esfuerzo: hoy se registra peso y reps por serie y un RPE GLOBAL
   por sesión. No hay RIR/RPE real por ejercicio: no se inventa. El RIR/RPE
   OBJETIVO del ejercicio ajusta qué tan rápido progresar; el RPE de la
   SESIÓN solo es contexto de fatiga (nunca se compara con el objetivo).
   Nada se guarda ni se completa: solo orienta. */
var GYMAPP = window.GYMAPP || (window.GYMAPP = {});

GYMAPP.proximaSesion = (function () {
  var MAX_EXPOSICIONES = 4;
  var DIAS_RECIENTE = 56; /* 8 semanas: historial "reciente" para la confianza */
  var DIAS_PAUSA_LARGA = 28; /* sin hacer el ejercicio: retomar antes de subir */
  var RPE_SESION_MUY_ALTO = 9;
  var CAIDA_CLARA_PCT = -5; /* mismo piso que PROG-03/PROG-04 */
  var INCREMENTO_DEFECTO = { barra: 2.5, smith: 2.5, mancuernas: 2.5, kettlebell: 4, polea: 2.5, maquina: 5, peso_corporal: 2.5, otros: 2.5, desconocido: 2.5 };

  /* --- Utilidades --- */

  function progreso() { return GYMAPP.progreso; }
  function cargas() { return GYMAPP.recomendacionCarga; }
  function historicas() { return GYMAPP.rutinasHistoricas; }

  function promedio(v) { return v.length ? v.reduce(function (a, b) { return a + b; }, 0) / v.length : null; }

  function diasEntre(desdeISO, hastaISO) {
    return Math.round((Date.parse(hastaISO + "T12:00:00Z") - Date.parse(desdeISO + "T12:00:00Z")) / 86400000);
  }

  function redondear(valor, paso, hacia) {
    var f = hacia === "abajo" ? Math.floor : hacia === "arriba" ? Math.ceil : Math.round;
    return Math.round(f(valor / paso + 1e-9) * paso * 100) / 100;
  }

  function formatearKg(n) {
    return String(Math.round(n * 100) / 100).replace(".", ",");
  }

  /* Objetivo de reps del plan: rango "10-12", fijo "8", por lado "10/10"
     (reps POR LADO: nunca se suman), parciales "7-7-7" o por tiempo. */
  function parsearObjetivo(reps) {
    var t = String(reps == null ? "" : reps).trim();
    if (!t) return null;
    if (/''|"|seg/.test(t)) return { tiempo: true, texto: t };
    t = t.replace(/\(.*?\)/g, "").trim();
    var lado = /^(\d+)\s*\/\s*(\d+)$/.exec(t);
    if (lado) return { min: +lado[1], max: +lado[1], porLado: true, texto: reps };
    if (/^\d+\s*-\s*\d+\s*-\s*\d+$/.test(t)) return { parciales: true, texto: reps };
    var rango = /^(\d+)\s*(?:-|–|a)\s*(\d+)$/.exec(t);
    if (rango) return { min: Math.min(+rango[1], +rango[2]), max: Math.max(+rango[1], +rango[2]), texto: reps };
    var uno = /^(\d+)$/.exec(t);
    if (uno) return { min: +uno[1], max: +uno[1], texto: reps };
    return null;
  }

  /* --- 1. Historial del MISMO ejercicio --- */

  /* Ejecuciones útiles (series principales con datos), de la más vieja a
     la más nueva. Mismo ejercicio = mismo ejercicio_id, o mismo nombre
     estricto (claveEjercicio) en sesiones de otros planes. Nunca variantes:
     "press inclinado con mancuernas" no es historial de "press inclinado
     en Smith" (eso lo relaciona E6.5 solo para la carga inicial). */
  function analizarHistorialEjercicio(data, ejercicio) {
    var H = historicas();
    var clave = H.claveEjercicio(ejercicio && ejercicio.nombre);
    var ejecuciones = [];
    ((data && data.sesiones_entrenamiento) || [])
      .filter(function (s) { return s && s.tipo === "gimnasio" && Array.isArray(s.ejercicios_realizados); })
      .slice()
      .sort(function (a, b) { return String(a.fecha) < String(b.fecha) ? -1 : String(a.fecha) > String(b.fecha) ? 1 : 0; })
      .forEach(function (s) {
        var er = s.ejercicios_realizados.filter(function (e) { return e.ejercicio_id === ejercicio.id; })[0];
        var resuelto = null;
        if (!er && clave) {
          er = s.ejercicios_realizados.filter(function (e) {
            var r = H.resolverEjercicioDeSesion(data, s, e);
            return !!r && H.claveEjercicio(r.nombre) === clave;
          })[0];
        }
        if (!er) return;
        resuelto = H.resolverEjercicioDeSesion(data, s, er);
        var principal = progreso().analizarSeriesPrincipales(er.series);
        if (principal.sinDatos) return;
        ejecuciones.push({
          fecha: String(s.fecha).slice(0, 10),
          principal: principal,
          rpeSesion: typeof s.rpe === "number" ? s.rpe : null,
          prescripcion: resuelto && resuelto.prescripcion ? resuelto.prescripcion : null
        });
      });
    return {
      todas: ejecuciones,
      recientes: ejecuciones.slice(-MAX_EXPOSICIONES)
    };
  }

  /* Rendimiento de una ejecución frente al objetivo del plan. */
  function evaluarEjecucion(e, objetivo, seriesObjetivo) {
    var reps = e.principal.repsPrincipales;
    var prom = promedio(reps);
    var minimo = Math.min.apply(null, reps);
    var r = { promedio: prom, minimo: minimo, series: reps.length, tope: false, enRango: null, debajo: false };
    if (!objetivo || objetivo.min == null) return r;
    var seriesOk = !seriesObjetivo || reps.length >= seriesObjetivo;
    if (objetivo.min === objetivo.max) {
      r.tope = seriesOk && minimo >= objetivo.max;
    } else {
      /* No se exigen series idénticas: 12/12/12/11 es el tope; 12/12/11/11 no. */
      r.tope = seriesOk && prom >= objetivo.max - 0.25 && minimo >= objetivo.max - 1;
    }
    r.enRango = minimo >= objetivo.min;
    r.debajo = prom < objetivo.min - 0.5;
    return r;
  }

  /* Salto de carga: el que el usuario ya usó en este ejercicio (diferencia
     mínima entre cargas registradas), o uno chico por implemento. */
  function saltoDeCarga(historial, clasif) {
    var cargasUsadas = [];
    historial.todas.forEach(function (e) { if (e.principal.cargaPrincipal > 0 && cargasUsadas.indexOf(e.principal.cargaPrincipal) === -1) cargasUsadas.push(e.principal.cargaPrincipal); });
    cargasUsadas.sort(function (a, b) { return a - b; });
    var defecto = INCREMENTO_DEFECTO[clasif.implemento] || 2.5;
    var observado = null;
    for (var i = 1; i < cargasUsadas.length; i++) {
      var d = Math.round((cargasUsadas[i] - cargasUsadas[i - 1]) * 100) / 100;
      if (d >= 0.5 && d <= defecto * 2 && (observado === null || d < observado)) observado = d;
    }
    if (observado) return { paso: observado, observado: true };
    /* Sin saltos propios: el salto típico que sea compatible con la carga
       actual (14 kg en mancuernas → de a 2 kg; 25 kg → de a 2,5 kg). */
    var actual = cargasUsadas.length ? historial.recientes[historial.recientes.length - 1].principal.cargaPrincipal : 0;
    var candidatos = [defecto, 2.5, 2, 1.25, 1];
    for (var j = 0; j < candidatos.length && actual > 0; j++) {
      var c = candidatos[j];
      if (c <= defecto && Math.abs(actual / c - Math.round(actual / c)) < 1e-6) return { paso: c, observado: false };
    }
    return { paso: defecto, observado: false };
  }

  /* --- 2. Decisión --- */

  /* contexto: { hoy, rpeSesionAlto: bool, estadoPlan } (se calcula afuera).
     estadoPlan es el ESTADO global de PROG-04 ("descargar" frena las
     subidas de todos los ejercicios; "consolidar" las deja, con cautela). */
  function decidirAccion(historial, ejercicio, clasif, contexto) {
    contexto = contexto || {};
    var recientes = historial.recientes;
    var n = recientes.length;
    var objetivo = parsearObjetivo(ejercicio.reps_objetivo);
    var seriesObjetivo = Number(ejercicio.series_objetivo) > 0 ? Number(ejercicio.series_objetivo) : null;
    var rirObj = cargas().rirDePrescripcion(ejercicio);

    if (!n) return { accion: "insuficiente", motivo: "sin_historial" };

    var ultima = recientes[n - 1];
    var previa = n >= 2 ? recientes[n - 2] : null;
    var evU = evaluarEjecucion(ultima, objetivo, seriesObjetivo);
    var evP = previa ? evaluarEjecucion(previa, objetivo, seriesObjetivo) : null;
    var comparar = progreso().compararEjecucionesPrincipales;
    var compU = previa ? comparar(previa.principal, ultima.principal) : null;
    var compP = n >= 3 ? comparar(recientes[n - 3].principal, previa.principal) : null;
    var conRango = !!(objetivo && objetivo.min != null);
    var fatiga = !!contexto.rpeSesionAlto;
    var pausa = contexto.hoy ? diasEntre(ultima.fecha, contexto.hoy) : 0;
    var caidaU = !!(compU && compU.esCaida);
    var caidaP = !!(compP && compP.esCaida);
    var subioCarga = !!(compU && compU.tipo === "carga_mayor");
    var mismaCarga = function (c) { return !!c && (c.tipo === "misma_carga" || c.tipo === "peso_corporal"); };
    /* Intensidad objetivo baja (RIR >= 3): progresar más despacio (pedir el
       tope dos veces). Intensidad alta: el tope ya cuesta; mismo criterio de
       confirmación para los objetivos fijos. */
    var pideConfirmacion = !conRango || (objetivo.min === objetivo.max) || (rirObj !== null && rirObj >= 3);
    var base = { estadoPlan: contexto.estadoPlan || null, ultima: ultima, previa: previa, evU: evU, evP: evP, objetivo: objetivo, seriesObjetivo: seriesObjetivo, rirObj: rirObj, pausa: pausa, fatiga: fatiga };

    function d(accion, motivo, extra) { return Object.assign({ accion: accion, motivo: motivo }, base, extra || {}); }

    if (pausa > DIAS_PAUSA_LARGA) return d("consolidar", "pausa_larga");

    if (n === 1) {
      if (!conRango || ultima.principal.ambigua) return d("insuficiente", "pocos_datos");
      if (conRango && evU.debajo && evU.promedio < objetivo.min - 2) return d("bajar", "calibracion_debajo");
      if (conRango && evU.tope) return d("consolidar", "calibracion_tope");
      return d("mantener_reps", "calibracion");
    }

    /* Caídas: una sola no alcanza; dos seguidas sí. */
    if (caidaU && caidaP) {
      if (fatiga || (n >= 4 && comparar(recientes[n - 4].principal, recientes[n - 3].principal).esCaida)) return d("descargar", "caidas_con_fatiga");
      return d("bajar", "dos_caidas");
    }

    /* Cumplimiento del rango, no solo la comparación con la sesión
       anterior: dos exposiciones seguidas por debajo del objetivo con la
       misma carga → bajar un salto. Una sola mala sesión → consolidar. */
    if (conRango && evU.debajo && evP && evP.debajo && mismaCarga(compU)) return d("bajar", "debajo_del_rango");
    if (caidaU) return d("consolidar", "caida_aislada");

    if (subioCarga) {
      if (conRango && evU.promedio < objetivo.min - 2) return d("bajar", "subida_excesiva");
      if (conRango && evU.debajo) return d("consolidar", "subida_reciente_debajo");
      return d("mantener_reps", "subida_reciente");
    }


    if (conRango && evU.tope) {
      var confirmado = !!(evP && evP.tope && mismaCarga(compU));
      if (pideConfirmacion && !confirmado) return d("consolidar", "tope_sin_confirmar");
      if (fatiga) return d("consolidar", "tope_con_fatiga");
      if (contexto.estadoPlan === "descargar") return d("consolidar", "plan_descarga");
      return d("subir", confirmado ? "tope_confirmado" : "tope");
    }

    /* Estancado: misma carga y mismas reps en 3 exposiciones, sin tope. */
    if (n >= 3 && mismaCarga(compU) && mismaCarga(compP) &&
        !compU.esMejora && !compP.esMejora) return d("consolidar", "estancado");

    return d("mantener_reps", conRango ? "en_rango" : "sin_rango");
  }

  /* --- 3. Carga siguiente --- */

  function calcularCargaSiguiente(decision, historial, clasif) {
    var actual = decision.ultima.principal.cargaPrincipal;
    var s = saltoDeCarga(historial, clasif);
    var paso = s.paso;
    var siguiente = actual;
    if (actual > 0) {
      if (decision.accion === "subir") siguiente = actual + paso;
      else if (decision.accion === "bajar" && decision.motivo === "subida_excesiva" && decision.previa) siguiente = decision.previa.principal.cargaPrincipal;
      /* Bajar: un salto, y al menos ~5% (en cargas altas un salto es poco). */
      else if (decision.accion === "bajar") siguiente = paso >= actual * 0.05 ? actual - paso : redondear(actual * 0.95, paso, "abajo");
      /* Descarga: ~15% menos. */
      else if (decision.accion === "descargar") siguiente = redondear(actual * 0.85, paso, "abajo");
      siguiente = Math.max(paso, siguiente);
    }
    return { kg: Math.round(siguiente * 100) / 100, actual: actual, paso: paso, pasoObservado: s.observado };
  }

  /* --- 4. Textos --- */

  var ESTADO = {
    subir: "Progresar",
    mantener_reps: "Progresar",
    consolidar: "Consolidar",
    bajar: "Recuperar",
    descargar: "Descargar / recuperar",
    insuficiente: "Datos insuficientes"
  };

  function unidad(clasif) {
    if (clasif.implemento === "mancuernas") return clasif.unidades === 2 ? " por mancuerna" : " (1 mancuerna)";
    if (clasif.implemento === "kettlebell" && clasif.unidades === 2) return " por kettlebell";
    if (clasif.porLado) return " por lado";
    return "";
  }

  /* Carga expresada para el usuario. Peso corporal: el registro es carga
     total (cuerpo + lastre); se muestra el lastre con el peso actual. */
  function textoCarga(kg, clasif, peso) {
    if (!(kg > 0)) return clasif.corporal ? "peso corporal" : "sin carga externa";
    if (clasif.corporal) {
      if (peso && peso.kg > 0) {
        var lastre = redondear(kg - peso.kg, 1.25, "abajo");
        return lastre > 0 ? "+" + formatearKg(lastre) + " kg de lastre" : "peso corporal";
      }
      return formatearKg(kg) + " kg de carga total";
    }
    return formatearKg(kg) + " kg" + unidad(clasif);
  }

  function textoReps(objetivo, ev) {
    if (!objetivo) return null;
    if (objetivo.parciales || objetivo.tiempo || objetivo.min == null) return objetivo.texto + (objetivo.tiempo ? "" : " reps");
    var lado = objetivo.porLado ? " por lado" : "";
    if (objetivo.min === objetivo.max) return objetivo.max + " reps" + lado;
    return objetivo.min + "-" + objetivo.max + " reps" + lado;
  }

  function repsDe(e) { return e.principal.repsPrincipales.join("/"); }

  function explicarRecomendacion(decision, carga, clasif, peso, confianza) {
    var u = decision.ultima;
    var cargaUlt = u.principal.cargaPrincipal > 0 ? textoCarga(u.principal.cargaPrincipal, clasif, peso) : "peso corporal";
    var obj = decision.objetivo;
    var tope = obj && obj.max != null ? obj.max : null;
    var lineas = [];
    var M = {
      calibracion: "Es tu primera sesión registrada de este ejercicio: sirve para calibrar. Repetí la carga y buscá más reps antes de subir.",
      calibracion_tope: "Llegaste al tope del rango en tu primera sesión registrada. Confirmalo una vez más antes de subir.",
      calibracion_debajo: "En tu primera sesión registrada quedaste bastante por debajo del rango: una carga algo menor te deja trabajar dentro del objetivo.",
      pausa_larga: "Hace " + decision.pausa + " días que no hacés este ejercicio: retomá con la última carga antes de progresar.",
      dos_caidas: "En tus últimas dos exposiciones bajaron las reps con la misma carga.",
      caidas_con_fatiga: "Varias exposiciones seguidas con menos rendimiento" + (decision.fatiga ? " y sesiones muy exigentes (RPE de sesión alto)" : "") + ": conviene una sesión más liviana para recuperar.",
      caida_aislada: "La última sesión rindió menos que la anterior, pero una sola sesión no alcanza para bajar la carga.",
      subida_excesiva: "Con la carga nueva quedaste muy por debajo del rango: volvé a la anterior y consolidala.",
      subida_reciente_debajo: "Subiste la carga hace poco y todavía quedás por debajo del rango. Si la próxima vuelve a pasar, volvé a la carga anterior.",
      subida_reciente: "Subiste la carga hace poco: primero sumá reps con este peso.",
      debajo_del_rango: "Las últimas dos exposiciones con " + cargaUlt + " quedaron por debajo de las reps objetivo. Volvé un salto para recuperar el rendimiento antes de intentar progresar otra vez.",
      tope_sin_confirmar: "Llegaste al tope del rango en la última sesión. Confirmalo una vez más con la misma carga antes de subir.",
      plan_descarga: "Estás listo para subir en este ejercicio, pero el estado general del plan sugiere recuperar: mantené la carga por ahora.",
      tope_con_fatiga: "Estás listo para subir, pero tus últimas sesiones fueron muy exigentes en general (RPE de sesión alto): consolidá una vez más.",
      tope_confirmado: "Completaste el extremo superior del rango en tus últimas dos sesiones con " + cargaUlt + ".",
      tope: "Completaste el extremo superior del rango en tu última sesión con " + cargaUlt + ".",
      estancado: "Tres sesiones con la misma carga y las mismas reps: consolidá la técnica y buscá una rep más en alguna serie.",
      en_rango: "La carga está bien, pero todavía no completaste el extremo superior del rango" + (tope ? " (" + tope + " reps)" : "") + ".",
      pocos_datos: "Hay una sola sesión registrada y " + (decision.ultima.principal.ambigua ? "no queda claro cuáles fueron las series efectivas" : "el plan no tiene un rango de reps claro") + ": todavía no alcanza para recomendar un cambio.",
      sin_rango: "El plan no tiene un rango de reps claro para este ejercicio: progresá sumando reps con la misma carga."
    };
    lineas.push(M[decision.motivo] || "");
    lineas.push("Última sesión: " + cargaUlt + " · " + repsDe(u) + (u.principal.seriesSecundarias ? " (sin contar " + u.principal.seriesSecundarias + " de aproximación)" : "") + ".");
    if (decision.previa) lineas.push("Anterior: " + (decision.previa.principal.cargaPrincipal > 0 ? textoCarga(decision.previa.principal.cargaPrincipal, clasif, peso) : "peso corporal") + " · " + repsDe(decision.previa) + ".");
    if (decision.accion === "subir" && !carga.pasoObservado && carga.actual > 0) lineas.push("El salto es aproximado: usá el incremento más chico disponible en tu gimnasio.");
    if (decision.rirObj !== null && decision.rirObj !== undefined) lineas.push("Objetivo del plan: dejar " + formatearKg(decision.rirObj) + (decision.rirObj === 1 ? " rep" : " reps") + " en reserva.");
    if (decision.accion === "subir" && decision.estadoPlan === "consolidar") lineas.push("El estado general del plan es Consolidar: con la carga nueva arrancá por el extremo bajo del rango.");
    if (clasif.corporal && !(peso && peso.kg > 0) && u.principal.cargaPrincipal > 0) lineas.push("Para calcular el lastre necesitás registrar tu peso corporal.");
    if (confianza === "baja") lineas.push("Confianza baja: hay pocas sesiones o datos incompletos.");
    lineas.push("No registramos el esfuerzo real por ejercicio: la recomendación se basa en carga, reps y el rango del plan.");
    return lineas.filter(Boolean);
  }

  /* --- Recomendación completa --- */

  /* opciones: { hoy: "AAAA-MM-DD", contexto (E6.5), pesoCorporal (E6.5),
     estadoPlan (PROG-04: "progresar" | "consolidar" | ...) } */
  function recomendar(data, ejercicio, opciones) {
    opciones = opciones || {};
    var clasif = cargas().clasificarEjercicio(ejercicio, opciones.contexto);
    if (clasif.tipo === "movilidad" || clasif.tiempo || (clasif.sinCargaExterna && !clasif.corporal)) return { tipo: "movilidad", clasificacion: clasif };
    var historial = analizarHistorialEjercicio(data, ejercicio);
    if (!historial.recientes.length) return { tipo: "sin_historial", clasificacion: clasif };

    /* RPE de SESIÓN: solo contexto de fatiga general (2 de las últimas 2
       sesiones donde se hizo el ejercicio con RPE >= 9). */
    var ult2 = historial.recientes.slice(-2).map(function (e) { return e.rpeSesion; }).filter(function (r) { return r !== null; });
    var rpeSesionAlto = ult2.length === 2 && ult2.every(function (r) { return r >= RPE_SESION_MUY_ALTO; });

    var decision = decidirAccion(historial, ejercicio, clasif, { hoy: opciones.hoy, rpeSesionAlto: rpeSesionAlto, estadoPlan: opciones.estadoPlan });
    var carga = calcularCargaSiguiente(decision, historial, clasif);

    var n = historial.recientes.length;
    var recientes = opciones.hoy ? historial.recientes.filter(function (e) { return diasEntre(e.fecha, opciones.hoy) <= DIAS_RECIENTE; }).length : n;
    var objetivo = decision.objetivo;
    var datosIncompletos = !objetivo || objetivo.min == null || decision.ultima.principal.ambigua;
    var confianza = n === 1 || datosIncompletos ? "baja" : (recientes >= 3 && decision.pausa <= DIAS_PAUSA_LARGA ? "alta" : "media");

    var peso = clasif.corporal ? opciones.pesoCorporal || null : null;
    var cargaTexto = textoCarga(carga.kg, clasif, peso);
    var reps = textoReps(objetivo, decision.evU);
    var titulo;
    switch (decision.accion) {
      case "subir": titulo = "Subí a " + cargaTexto; break;
      case "bajar": titulo = "Bajá a " + cargaTexto; break;
      case "descargar": titulo = "Sesión liviana: " + cargaTexto; break;
      case "consolidar": titulo = "Mantené " + cargaTexto; break;
      case "insuficiente": titulo = "Datos insuficientes"; break;
      default: titulo = "Mantené " + cargaTexto;
    }
    if (!(carga.kg > 0) && !clasif.corporal && decision.accion !== "insuficiente") {
      titulo = decision.accion === "descargar" ? "Sesión liviana" : "Repetí la ejecución";
    }
    if (clasif.corporal && cargaTexto === "peso corporal" && decision.accion !== "insuficiente") {
      titulo = decision.accion === "descargar" ? "Sesión liviana: peso corporal" :
        decision.accion === "subir" ? "Peso corporal: sumá un lastre chico" : "Peso corporal";
    }
    var objetivoTexto;
    if (decision.accion === "mantener_reps" && objetivo && objetivo.max != null && objetivo.min !== objetivo.max) {
      var desde = Math.min(objetivo.max, Math.max(objetivo.min, Math.floor(decision.evU.promedio) + 1));
      objetivoTexto = "Buscá " + (desde >= objetivo.max ? objetivo.max : desde + "-" + objetivo.max) + " reps" + (objetivo.porLado ? " por lado" : "");
    } else if (decision.accion === "bajar") {
      objetivoTexto = objetivo && objetivo.min != null
        ? "Objetivo: " + (decision.seriesObjetivo ? decision.seriesObjetivo + "×" : "") + (objetivo.min === objetivo.max ? objetivo.max : objetivo.min + "-" + objetivo.max) + (objetivo.porLado ? " por lado" : "")
        : "Objetivo: recuperar las reps";
    } else if (decision.accion === "descargar") {
      objetivoTexto = "Una serie menos y dejando 3 reps en reserva; después volvé a evaluar";
    } else if (decision.accion === "insuficiente") {
      objetivoTexto = "Repetí " + cargaTexto + " y registrá todas las series";
    } else if (decision.accion === "consolidar") {
      objetivoTexto = reps ? "Repetí " + reps + " con buena técnica" : "Repetí las reps de la última sesión";
    } else {
      objetivoTexto = reps ? "Objetivo: " + reps : "Buscá una rep más en alguna serie";
    }

    return {
      tipo: "accion",
      accion: decision.accion,
      estado: ESTADO[decision.accion],
      motivo: decision.motivo,
      titulo: titulo,
      objetivo: objetivoTexto,
      carga: carga,
      confianza: confianza,
      porQue: explicarRecomendacion(decision, carga, clasif, peso, confianza),
      exposiciones: n,
      clasificacion: clasif
    };
  }

  /* --- UI --- */

  function renderRecomendacion(rec, opciones) {
    opciones = opciones || {};
    if (!rec || rec.tipo !== "accion") return "";
    var esc = GYMAPP.util.escapeHtml;
    return (
      '<div class="proxima-sesion-ej proxima-accion-' + rec.accion + ' carga-confianza-' + rec.confianza + '">' +
      '<p class="proxima-sesion-ej-etiqueta">' + esc(opciones.etiqueta || "Próxima sesión") + "</p>" +
      '<p class="proxima-sesion-ej-titulo"><strong>' + esc(rec.titulo) + "</strong></p>" +
      '<p class="proxima-sesion-ej-objetivo">' + esc(rec.objetivo) + ' <span class="carga-sugerida-confianza">· Confianza ' + rec.confianza + "</span></p>" +
      '<details class="carga-sugerida-detalle"><summary>¿Por qué?</summary>' +
      rec.porQue.map(function (l) { return "<p>" + esc(l) + "</p>"; }).join("") +
      '<p class="carga-sugerida-guia">Usala como guía: la decisión final es tuya según técnica y sensaciones.</p>' +
      "</details>" +
      "</div>"
    );
  }

  return {
    parsearObjetivo: parsearObjetivo,
    analizarHistorialEjercicio: analizarHistorialEjercicio,
    evaluarEjecucion: evaluarEjecucion,
    decidirAccion: decidirAccion,
    calcularCargaSiguiente: calcularCargaSiguiente,
    explicarRecomendacion: explicarRecomendacion,
    recomendar: recomendar,
    renderRecomendacion: renderRecomendacion,
    ESTADO: ESTADO
  };
})();
