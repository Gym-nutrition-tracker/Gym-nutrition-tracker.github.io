/* E6.5: peso orientativo (carga inicial sugerida) para los ejercicios del
   plan activo, calculado en el momento desde el historial real. No guarda
   nada, no completa series y no cambia ningún dato: solo orienta.

   Capas (funciones puras salvo el render):
     1. clasificarEjercicio   patrón, familia, implemento, lateralidad, tipo
     2. construirIndiceHistorial / seleccionarReferencias
                              ejecuciones útiles por ejercicio (series
                              principales de PROG-03) y referencias por
                              prioridad A > B > C > D
     3. calcular              e1RM conservador (Epley), conversión de
                              implemento/familia y objetivo de reps + RIR
     4. explicar / renderSugerencia
                              texto corto, confianza y guía de calibración

   Reglas deterministas y explicables (sin ML). La experiencia propia con el
   mismo ejercicio (A) siempre gana sobre las equivalencias teóricas. */
var GYMAPP = window.GYMAPP || (window.GYMAPP = {});

GYMAPP.recomendacionCarga = (function () {
  /* --- 1. Clasificación --- */

  /* Misma normalización que "Última vez" (rutinasHistoricas.claveEjercicio). */
  function normalizar(texto) {
    return GYMAPP.rutinasHistoricas.claveEjercicio(texto);
  }

  /* Movilidad, activación, potencia sin carga: nunca kilos. */
  var RE_MOVILIDAD = /movilidad|rotacion toracica|rotacion de tronco|rotaciones de hombro|candelabro|aduccion escapular|activacion|manguito rotador|saludo al sol|carpa|90\/90|estir|\bbuda\b|dorsiflexion|alacran|psoas|cuadrupedia|\bhalo\b/;
  var RE_POTENCIA = /salto|pliometr|de arrodillado a parado|lanzamiento|\bpelota\b|\bbalon\b/;

  /* Reglas de patrón/familia, en orden (la primera que coincide gana).
     region: grupo muscular amplio para el nivel D. */
  var REGLAS = [
    { re: /pallof|antirotaci/, patron: "core_antirotacion", familia: "pallof", movimiento: "core", region: "core" },
    { re: /sit ?ups?|abdominal|crunch|dead bug|elevaciones de piernas|plancha|rueda abdominal/, patron: "core_flexion", familia: "abdominal", movimiento: "core", region: "core" },
    { re: /farmer|carry|paseo (del )?granjero/, patron: "otros", familia: "acarreo", movimiento: "otros", region: "otros" },
    { re: /press (de )?banca|press plano|press de pecho|chest press|bench/, patron: "empuje_horizontal", familia: "press_plano", movimiento: "compuesto", region: "pecho" },
    { re: /press inclinado|inclinado/, patron: "empuje_horizontal", familia: "press_inclinado", movimiento: "compuesto", region: "pecho" },
    { re: /press declinado|declinado/, patron: "empuje_horizontal", familia: "press_declinado", movimiento: "compuesto", region: "pecho" },
    { re: /flexiones|lagartijas/, patron: "empuje_horizontal", familia: "flexiones", movimiento: "compuesto", region: "pecho", corporal: true },
    { re: /fondos/, patron: "empuje_vertical", familia: "fondos", movimiento: "compuesto", region: "pecho", corporal: true },
    { re: /mariposa|pec ?deck|aperturas|cruces/, patron: "empuje_horizontal", familia: "aperturas", movimiento: "aislamiento", region: "pecho" },
    { re: /press (militar|de hombros?|hombros?)|arnold|press por encima/, patron: "empuje_vertical", familia: "press_hombro", movimiento: "compuesto", region: "hombro" },
    { re: /vuelos? laterales|elevaciones laterales|laterales/, patron: "hombro_lateral", familia: "elevacion_lateral", movimiento: "aislamiento", region: "hombro" },
    { re: /face ?pull|vuelos? posteriores|pajaros/, patron: "traccion_horizontal", familia: "deltoide_posterior", movimiento: "aislamiento", region: "espalda" },
    { re: /dominada.*isometric|isometric.*dominada/, patron: "traccion_vertical", familia: "isometrico", movimiento: "core", region: "espalda", corporal: true, tiempo: true },
    { re: /australianas|remo invertido/, patron: "traccion_horizontal", familia: "remo_invertido", movimiento: "compuesto", region: "espalda", corporal: true },
    { re: /dominada|chin ?up|pull ?up/, patron: "traccion_vertical", familia: "dominadas", movimiento: "compuesto", region: "espalda", corporal: true },
    { re: /pull ?over/, patron: "traccion_vertical", familia: "pullover", movimiento: "aislamiento", region: "espalda" },
    { re: /polea dorsal|jalon|lat ?pull|dorsal al pecho/, patron: "traccion_vertical", familia: "jalon", movimiento: "compuesto", region: "espalda" },
    { re: /remo/, patron: "traccion_horizontal", familia: "remo", movimiento: "compuesto", region: "espalda" },
    { re: /gemelos|soleo|pantorrilla/, patron: "pantorrilla", familia: "pantorrilla", movimiento: "aislamiento", region: "piernas" },
    { re: /sentadilla sumo|goblet/, patron: "sentadilla", familia: "sentadilla_goblet", movimiento: "compuesto", region: "piernas" },
    { re: /sentadilla|squat/, patron: "sentadilla", familia: "sentadilla", movimiento: "compuesto", region: "piernas" },
    { re: /prensa/, patron: "sentadilla", familia: "prensa", movimiento: "compuesto", region: "piernas" },
    { re: /\bhack\b/, patron: "sentadilla", familia: "hack", movimiento: "compuesto", region: "piernas" },
    { re: /bulgara|estocada|zancada|step ?up|subidas? al banco/, patron: "sentadilla", familia: "zancada", movimiento: "compuesto", region: "piernas", unilateral: true },
    { re: /peso muerto|rumano|good morning/, patron: "bisagra", familia: "peso_muerto", movimiento: "compuesto", region: "piernas" },
    { re: /hip thrust|elevaciones de cadera|puente de gluteo/, patron: "bisagra", familia: "empuje_cadera", movimiento: "compuesto", region: "piernas" },
    { re: /swing/, patron: "bisagra", familia: "swing", movimiento: "compuesto", region: "piernas" },
    { re: /lumbar|hiperextension/, patron: "bisagra", familia: "lumbares", movimiento: "aislamiento", region: "espalda", implemento: "maquina" },
    { re: /sillon de cuadriceps|extension(es)? de cuadriceps|extension de rodilla/, patron: "extension_rodilla", familia: "extension_rodilla", movimiento: "aislamiento", region: "piernas", implemento: "maquina" },
    { re: /curl femoral|sillon de isquio|isquiotibiales|femoral/, patron: "flexion_rodilla", familia: "curl_femoral", movimiento: "aislamiento", region: "piernas", implemento: "maquina" },
    { re: /aductor|abductor|aduccion de cadera|abduccion de cadera/, patron: "aduccion_abduccion", familia: "aduccion_abduccion", movimiento: "aislamiento", region: "piernas", implemento: "maquina" },
    { re: /press frances|frances|triceps|trasnuca|tomando codo|patada de triceps/, patron: "triceps", familia: "triceps", movimiento: "aislamiento", region: "brazos" },
    { re: /curl|biceps|martillo/, patron: "biceps", familia: "biceps", movimiento: "aislamiento", region: "brazos" }
  ];

  function detectarImplemento(nombre, comentarios) {
    var n = nombre;
    var impl =
      /smith/.test(n) ? "smith" :
      /polea|cable/.test(n) ? "polea" :
      /maquina|sillon|prensa|\bhack\b|pec ?deck|mariposa/.test(n) ? "maquina" :
      /mancuerna/.test(n) ? "mancuernas" :
      /\bkb\b|kettlebell|ketbell|kettelbell/.test(n) ? "kettlebell" :
      /barra/.test(n) ? "barra" :
      /banda|\bband\b|elastico/.test(n) ? "banda" :
      /corebag|core bag|disco|pelota|balon|saco/.test(n) ? "otros" :
      null;
    /* Un comentario solo cambia el implemento cuando lo dice explícito
       ("con mancuernas"); frases como "usar la barra de arriba" no. */
    if (/con mancuernas?/.test(comentarios || "")) impl = "mancuernas";
    return impl;
  }

  /* "10/10", "12/12", "8/8": repeticiones por lado. */
  function repsPorLado(reps) {
    return /^\s*\d+\s*\/\s*\d+\s*$/.test(String(reps || ""));
  }

  /* contexto opcional: { planConIntensidad: true si otros ejercicios del
     plan tienen RIR/RPE } (señal de activación cuando este no tiene). */
  function clasificarEjercicio(ejercicio, contexto) {
    ejercicio = ejercicio || {};
    var nombre = normalizar(ejercicio.nombre);
    var comentarios = normalizar([ejercicio.comentarios, ejercicio.raw].filter(Boolean).join(" "));
    var grupo = normalizar(ejercicio.grupo_muscular);
    var regla = null;
    for (var i = 0; i < REGLAS.length && !regla; i++) if (REGLAS[i].re.test(nombre)) regla = REGLAS[i];

    var implemento = detectarImplemento(nombre, comentarios);
    var unilateralBrazo = /a 1 brazo|un brazo|1 brazo|toma unilateral|unilateral|alternad/.test(nombre + " " + comentarios);
    var unilateral = unilateralBrazo || !!(regla && regla.unilateral) || repsPorLado(ejercicio.reps_objetivo) || /1 pierna|una pierna|unipodal/.test(nombre);
    var sinIntensidad = ejercicio.rir_objetivo == null && ejercicio.rpe_objetivo == null;
    var activacionPorPlan = !!(contexto && contexto.planConIntensidad) && sinIntensidad && Number(ejercicio.series_objetivo) > 0 && Number(ejercicio.series_objetivo) <= 2;
    var tiempo = !!(regla && regla.tiempo) || /\d+\s*''|\bseg/.test(String(ejercicio.reps_objetivo || ""));

    var tipo, patron, familia, movimiento, region;
    if (RE_MOVILIDAD.test(nombre) || activacionPorPlan) {
      tipo = "movilidad"; patron = "movilidad"; familia = "movilidad"; movimiento = "movilidad"; region = "otros";
    } else if (RE_POTENCIA.test(nombre)) {
      tipo = "movilidad"; patron = "potencia"; familia = "potencia"; movimiento = "potencia"; region = "otros";
    } else if (regla) {
      patron = regla.patron; familia = regla.familia; movimiento = regla.movimiento; region = regla.region;
      tipo = movimiento === "compuesto" ? "principal" : "accesorio";
    } else {
      patron = "otros"; familia = "otros"; movimiento = "otros"; region = grupo ? grupo : "otros"; tipo = "accesorio";
    }

    /* Sin implemento en el texto: el típico de la familia (máquinas), peso
       corporal, o "desconocido" (solo se usa su propio historial). */
    if (!implemento) {
      implemento = regla && regla.implemento ? regla.implemento :
        regla && regla.corporal ? "peso_corporal" :
        tipo === "movilidad" ? "peso_corporal" : "desconocido";
    }
    /* Postura del press de hombros: sentado es más estable. */
    var postura = /arrodillad/.test(nombre) ? "arrodillado" : /sentad/.test(nombre) ? "sentado" : /de pie|parado/.test(nombre) ? "de_pie" : null;
    /* Mancuernas/kettlebells: el registro es por unidad; cuántas se usan. */
    var unidades = 1;
    if (implemento === "mancuernas" || implemento === "kettlebell") {
      unidades = unilateralBrazo || /sumo|goblet|swing/.test(nombre) ? 1 : 2;
    }

    return {
      patron: patron,
      familia: familia,
      movimiento: movimiento,
      region: region,
      implemento: implemento,
      lateralidad: unilateral ? "unilateral" : "bilateral",
      /* Registro por lado: polea/máquina a un brazo, o cruces en polea (dos
         columnas de peso). Solo brazos: en piernas el peso del cuerpo
         cambia la relación. */
      porLado: region !== "piernas" && implemento !== "mancuernas" && implemento !== "kettlebell" &&
        (unilateralBrazo || (familia === "aperturas" && implemento === "polea")),
      unidades: unidades,
      postura: postura,
      tipo: tipo,
      tiempo: tiempo,
      corporal: implemento === "peso_corporal",
      /* Sin kilos con sentido: movilidad/potencia, banda, peso corporal,
         isométricos por tiempo. (Peso corporal con lastre se sugiere solo
         desde el propio historial del ejercicio.) */
      sinCargaExterna: tipo === "movilidad" || implemento === "banda" || implemento === "peso_corporal" || tiempo,
      /* Core, acarreos y "otros": solo con historial del mismo ejercicio. */
      soloMismoEjercicio: movimiento === "core" || familia === "acarreo" || patron === "otros" || implemento === "desconocido"
    };
  }

  /* --- 2. Historial --- */

  function parsearReps(reps) {
    var t = String(reps == null ? "" : reps).replace(/\(.*?\)/g, "").trim();
    var tripleta = /^(\d+)\s*-\s*(\d+)\s*-\s*(\d+)$/.exec(t);
    if (tripleta) return { reps: Math.round((+tripleta[1] + +tripleta[2] + +tripleta[3]) * 0.6), parciales: true };
    var porLado = /^(\d+)\s*\/\s*(\d+)$/.exec(t);
    if (porLado) return { reps: +porLado[1] };
    var rango = /^(\d+)\s*-\s*(\d+)$/.exec(t);
    if (rango) return { reps: (+rango[1] + +rango[2]) / 2 };
    var uno = /^(\d+)$/.exec(t);
    if (uno) return { reps: +uno[1] };
    return null;
  }

  /* RIR del objetivo: rir_objetivo ("1-2" → 1,5); si falta, desde el RPE
     objetivo DEL EJERCICIO (RIR = 10 - RPE). Nunca el RPE de la sesión. */
  function rirDePrescripcion(p) {
    if (!p) return null;
    var desde = function (v) {
      if (v == null || v === "") return null;
      if (typeof v === "number") return v;
      var m = /^\s*(\d+(?:[.,]\d+)?)\s*(?:-\s*(\d+(?:[.,]\d+)?))?\s*$/.exec(String(v));
      if (!m) return null;
      var a = parseFloat(m[1].replace(",", ".")), b = m[2] ? parseFloat(m[2].replace(",", ".")) : a;
      return (a + b) / 2;
    };
    var rir = desde(p.rir_objetivo);
    if (rir != null) return rir;
    var rpe = desde(p.rpe_objetivo);
    return rpe != null ? Math.max(0, 10 - rpe) : null;
  }

  var RIR_SUPUESTO = 2;

  function mediana(v) {
    var s = v.slice().sort(function (a, b) { return a - b; });
    var m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  /* Ejecuciones útiles agrupadas por nombre normalizado (no por id: así se
     relacionan planes distintos, el legacy y sesiones viejas). Series
     principales con la heurística de PROG-03 (calentamientos afuera). */
  function construirIndiceHistorial(data) {
    var porNombre = {};
    var analizar = GYMAPP.progreso && GYMAPP.progreso.analizarSeriesPrincipales;
    ((data && data.sesiones_entrenamiento) || []).forEach(function (s) {
      if (!s || s.tipo !== "gimnasio") return;
      (s.ejercicios_realizados || []).forEach(function (er) {
        var resuelto = GYMAPP.rutinasHistoricas.resolverEjercicioDeSesion(data, s, er);
        if (!resuelto || !resuelto.nombre) return;
        var principal = analizar(er.series);
        if (principal.sinDatos || !principal.repsPrincipales.length) return;
        var clave = normalizar(resuelto.nombre);
        var presc = resuelto.prescripcion || {};
        if (!porNombre[clave]) {
          porNombre[clave] = {
            nombre: resuelto.nombre,
            clasificacion: clasificarEjercicio({ nombre: resuelto.nombre, grupo_muscular: presc.grupo_muscular, comentarios: presc.comentarios, reps_objetivo: presc.reps_objetivo }),
            ejecuciones: []
          };
        }
        porNombre[clave].ejecuciones.push({
          fecha: String(s.fecha || "").slice(0, 10),
          carga: principal.cargaPrincipal,
          reps: mediana(principal.repsPrincipales),
          pesoCorporal: principal.pesoCorporal,
          rir: rirDePrescripcion(presc)
        });
      });
    });
    Object.keys(porNombre).forEach(function (k) {
      porNombre[k].ejecuciones.sort(function (a, b) { return a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : 0; });
    });
    return { porNombre: porNombre };
  }

  /* Implementos "comparables": cambio chico (confianza media). */
  var GRUPO_IMPL = { barra: "libre", smith: "libre", mancuernas: "libre", kettlebell: "libre", maquina: "guiado", polea: "guiado", otros: "otros", desconocido: "desconocido" };

  /* Pares muy cercanos (barra↔Smith, máquina↔polea, mancuernas↔
     kettlebell): se prefieren como fuente frente a otros comparables. */
  var CERCANOS = { "barra|smith": 1, "smith|barra": 1, "maquina|polea": 1, "polea|maquina": 1, "mancuernas|kettlebell": 1, "kettlebell|mancuernas": 1 };

  function similitudImplemento(a, b) {
    if (a === b) return "igual";
    if (CERCANOS[a + "|" + b]) return "cercano";
    if (GRUPO_IMPL[a] && GRUPO_IMPL[a] === GRUPO_IMPL[b] && a !== "otros") return "comparable";
    return "distinto";
  }

  /* Nivel D: relaciones entre patrones del mismo grupo muscular, con
     factor de fuerza relativa (solo las que tienen sentido). */
  var CRUZADOS = {
    "empuje_vertical<empuje_horizontal": 0.6,
    "empuje_horizontal<empuje_vertical": 1.6
  };

  /* Fuerza relativa por familia dentro de un patrón (carga total
     equivalente a barra). Familias sin factor no se cruzan (nivel C). */
  var FACTOR_FAMILIA = {
    press_plano: 1, press_inclinado: 0.85, press_declinado: 1.05,
    press_hombro: 1,
    jalon: 1, remo: 1,
    sentadilla: 1, hack: 1.1, prensa: 1.8, sentadilla_goblet: 0.45, zancada: 0.45,
    peso_muerto: 1, empuje_cadera: 1.2, swing: 0.35
  };

  var FACTOR_POSTURA = { sentado: 1, de_pie: 0.9, arrodillado: 0.9 };

  /* Pierna a una pierna vs. las dos: el peso del cuerpo hace gran parte
     del trabajo, así que la carga externa unilateral es ~35% de la
     bilateral (dentro de la misma familia). */
  var FACTOR_PIERNA_UNILATERAL = 0.35;

  /* Referencias para un ejercicio objetivo, por prioridad:
     A mismo ejercicio, B misma familia (variante), C mismo patrón,
     D patrón relacionado del mismo grupo. Devuelve el mejor nivel. */
  function seleccionarReferencias(indice, objetivo, clasif) {
    var clave = normalizar(objetivo.nombre);
    var mismo = indice.porNombre[clave];
    if (mismo && ejecucionesConCarga(mismo).length) return { nivel: "A", fuentes: [mismo] };
    if (clasif.sinCargaExterna || clasif.soloMismoEjercicio) return { nivel: null, fuentes: [] };

    var candidatos = Object.keys(indice.porNombre).filter(function (k) { return k !== clave; }).map(function (k) { return indice.porNombre[k]; })
      .filter(function (h) { return !h.clasificacion.sinCargaExterna && !h.clasificacion.soloMismoEjercicio && ejecucionesConCarga(h).length; });
    /* En aislamiento, pasar de peso libre a polea/máquina (o al revés)
       no da una carga con sentido: no se infiere. */
    candidatos = candidatos.filter(function (h) {
      return clasif.movimiento !== "aislamiento" || GRUPO_IMPL[h.clasificacion.implemento] === GRUPO_IMPL[clasif.implemento];
    });
    var b = candidatos.filter(function (h) { return h.clasificacion.familia === clasif.familia && h.clasificacion.movimiento === clasif.movimiento; });
    if (b.length) return { nivel: "B", fuentes: mejores(b, clasif) };
    var c = candidatos.filter(function (h) {
      return h.clasificacion.patron === clasif.patron && h.clasificacion.movimiento === clasif.movimiento &&
        FACTOR_FAMILIA[h.clasificacion.familia] && FACTOR_FAMILIA[clasif.familia];
    });
    if (c.length) return { nivel: "C", fuentes: mejores(c, clasif) };
    var d = candidatos.filter(function (h) { return CRUZADOS[clasif.patron + "<" + h.clasificacion.patron] && h.clasificacion.familia !== "fondos"; });
    if (d.length) return { nivel: "D", fuentes: mejores(d, clasif) };
    return { nivel: null, fuentes: [] };
  }

  /* Ejecuciones con kilos registrados (peso corporal sin lastre no da
     una carga con qué calcular). */
  function ejecucionesConCarga(hist) {
    return hist.ejecuciones.filter(function (e) { return e.carga > 0; });
  }

  /* Hasta 2 fuentes: primero mismo implemento, después comparable, y
     dentro de eso la ejecución más reciente. */
  function mejores(lista, clasif) {
    var orden = { igual: 0, cercano: 1, comparable: 2, distinto: 3 };
    return lista.slice().sort(function (a, b) {
      var sa = orden[similitudImplemento(a.clasificacion.implemento, clasif.implemento)];
      var sb = orden[similitudImplemento(b.clasificacion.implemento, clasif.implemento)];
      if (sa !== sb) return sa - sb;
      return a.ejecuciones[0].fecha < b.ejecuciones[0].fecha ? 1 : -1;
    }).slice(0, 2);
  }

  /* --- 3. Cálculo --- */

  var REPS_MAX_EPLEY = 20;
  /* Mancuernas/kettlebells: dos unidades rinden ~84% de una barra. */
  var FACTOR_MANCUERNA = 0.84;
  /* Unilateral por lado (polea/máquina a un brazo): 2 lados x ~1/1,1. */
  var VENTAJA_UNILATERAL = 1.1;
  var INCREMENTO = { barra: 2.5, smith: 2.5, mancuernas: 2, kettlebell: 4, polea: 2.5, maquina: 5, otros: 2, peso_corporal: 2.5 };
  var CONSERVADOR = { alta: 1, media: 0.95, baja: 0.9 };
  /* Primer uso de un implemento guiado (Smith, máquina, polea) sin
     historial propio de ese ejercicio: la equivalencia teórica no conoce
     esa máquina (guía, poleas, contrapeso), así que la carga INICIAL se
     baja un 12% más para calibrar con seguridad. Desaparece en cuanto hay
     una ejecución real del ejercicio (nivel A). */
  var MARGEN_PRIMER_USO_GUIADO = 0.88;
  var GUIADOS = { smith: true, maquina: true, polea: true };
  var AMPLITUD = { alta: 0.05, media: 0.1, baja: 0.15 };
  var SEMANAS_RECIENTE = 8;

  function e1rm(carga, repsAlFallo) {
    return carga * (1 + Math.min(repsAlFallo, REPS_MAX_EPLEY) / 30);
  }

  function cargaPara(e1, repsAlFallo) {
    return e1 / (1 + Math.min(repsAlFallo, REPS_MAX_EPLEY) / 30);
  }

  /* Carga registrada → carga total equivalente a barra (bilateral). */
  function aEquivalente(carga, c) {
    var total = carga * (c.unidades || 1);
    if (c.implemento === "mancuernas" || c.implemento === "kettlebell") {
      total = total / FACTOR_MANCUERNA;
      if (c.unidades === 1 && c.lateralidad === "unilateral" && c.region !== "piernas") total = total * 2 / VENTAJA_UNILATERAL;
    } else if (c.porLado) {
      total = total * 2 / VENTAJA_UNILATERAL;
    }
    return total;
  }

  function desdeEquivalente(eq, c) {
    var total = eq;
    if (c.implemento === "mancuernas" || c.implemento === "kettlebell") {
      if (c.unidades === 1 && c.lateralidad === "unilateral" && c.region !== "piernas") total = total * VENTAJA_UNILATERAL / 2;
      total = total * FACTOR_MANCUERNA;
    } else if (c.porLado) {
      total = total * VENTAJA_UNILATERAL / 2;
    }
    return total / (c.unidades || 1);
  }

  function dias(entre, y) {
    return Math.round((Date.parse(entre + "T12:00:00Z") - Date.parse(y + "T12:00:00Z")) / 86400000);
  }

  /* e1RM equivalente de una fuente: promedio ponderado de sus últimas
     2-4 ejecuciones (la más reciente pesa más: sigue la tendencia). */
  function e1rmFuente(hist) {
    var c = hist.clasificacion;
    var ej = ejecucionesConCarga(hist).slice(0, 4);
    var pesos = [4, 3, 2, 1];
    var suma = 0, total = 0;
    ej.forEach(function (e, i) {
      var rir = e.rir != null ? e.rir : RIR_SUPUESTO;
      suma += e1rm(aEquivalente(e.carga, c), e.reps + rir) * pesos[i];
      total += pesos[i];
    });
    return { valor: total ? suma / total : null, ejecuciones: ej };
  }

  function redondear(valor, incremento, hacia) {
    var f = hacia === "abajo" ? Math.floor : hacia === "arriba" ? Math.ceil : Math.round;
    var r = f(valor / incremento + 1e-9) * incremento;
    return Math.round(r * 10) / 10;
  }

  function unidadTexto(c) {
    if (c.implemento === "mancuernas") return c.unidades === 2 ? "por mancuerna" : "(1 mancuerna)";
    if (c.implemento === "kettlebell") return c.unidades === 2 ? "por kettlebell" : "";
    if (c.porLado) return "por lado";
    return "";
  }

  /* Recomendación para un ejercicio del plan. `hoy`: "AAAA-MM-DD". */
  function recomendar(indice, ejercicio, opciones) {
    opciones = opciones || {};
    var clasif = clasificarEjercicio(ejercicio, opciones.contexto);
    if (clasif.tipo === "movilidad") return { tipo: "movilidad", clasificacion: clasif };
    var refs = seleccionarReferencias(indice, ejercicio, clasif);
    if (!refs.nivel) {
      return { tipo: clasif.sinCargaExterna ? "sin_carga" : "sin_datos", clasificacion: clasif };
    }

    var objetivoReps = parsearReps(ejercicio.reps_objetivo);
    var rirObjetivo = rirDePrescripcion(ejercicio);
    var repsMeta = (objetivoReps ? objetivoReps.reps : 10) + (rirObjetivo != null ? rirObjetivo : RIR_SUPUESTO);

    var estimaciones = refs.fuentes.map(function (h) {
      var f = e1rmFuente(h);
      var hc = h.clasificacion;
      var eq = f.valor;
      if (refs.nivel === "C") eq = eq * FACTOR_FAMILIA[clasif.familia] / FACTOR_FAMILIA[hc.familia];
      if (refs.nivel === "D") eq = eq * CRUZADOS[clasif.patron + "<" + hc.patron];
      if (refs.nivel === "B" && clasif.familia === "press_hombro") eq = eq * (FACTOR_POSTURA[clasif.postura] || 1) / (FACTOR_POSTURA[hc.postura] || 1);
      var cambioLado = clasif.region === "piernas" && clasif.familia !== "zancada" && hc.familia !== "zancada" && clasif.lateralidad !== hc.lateralidad;
      if (cambioLado) eq = eq * (clasif.lateralidad === "unilateral" ? FACTOR_PIERNA_UNILATERAL : 1 / FACTOR_PIERNA_UNILATERAL);
      var carga = desdeEquivalente(cargaPara(eq, repsMeta), clasif);
      return { fuente: h, carga: carga, ejecuciones: f.ejecuciones, implemento: similitudImplemento(hc.implemento, clasif.implemento), cambioLado: cambioLado };
    });
    /* Mismo implemento pesa el doble que comparable/distinto. */
    var peso = function (e) { return e.implemento === "igual" ? 2 : 1; };
    var estimado = estimaciones.reduce(function (s, e) { return s + e.carga * peso(e); }, 0) / estimaciones.reduce(function (s, e) { return s + peso(e); }, 0);

    var confianza;
    var ultima = estimaciones[0].ejecuciones[0];
    var hoy = opciones.hoy || ultima.fecha;
    if (refs.nivel === "A") {
      var recientes = estimaciones[0].ejecuciones.filter(function (e) { return dias(hoy, e.fecha) <= SEMANAS_RECIENTE * 7; });
      confianza = recientes.length >= 2 ? "alta" : "media";
    } else if (refs.nivel === "B") {
      var mejorImpl = estimaciones.some(function (e) { return e.implemento !== "distinto"; });
      var pocas = estimaciones.every(function (e) { return e.ejecuciones.length < 2; });
      var guiadoAislado = clasif.movimiento === "aislamiento" && GRUPO_IMPL[clasif.implemento] === "guiado" &&
        estimaciones.some(function (e) { return e.implemento !== "igual"; });
      var lado = estimaciones.some(function (e) { return e.cambioLado; });
      confianza = mejorImpl && !pocas && !guiadoAislado && !lado ? "media" : "baja";
    } else {
      confianza = "baja";
    }
    if (objetivoReps && objetivoReps.parciales && confianza !== "baja") confianza = "baja";

    var incremento = INCREMENTO[clasif.implemento] || 2.5;
    /* equivalencia estimada (estimado, rango) vs. carga inicial sugerida. */
    var primerUsoGuiado = refs.nivel !== "A" && !!GUIADOS[clasif.implemento];
    var sugerida = redondear(estimado * CONSERVADOR[confianza] * (primerUsoGuiado ? MARGEN_PRIMER_USO_GUIADO : 1), incremento);
    var rango = [redondear(estimado * (1 - AMPLITUD[confianza]), incremento, "abajo"), redondear(estimado * (1 + AMPLITUD[confianza]), incremento, "arriba")];
    if (sugerida < rango[0] && !primerUsoGuiado) rango[0] = sugerida;
    if (sugerida <= 0) return { tipo: "sin_datos", clasificacion: clasif };

    return {
      tipo: "sugerencia",
      kg: sugerida,
      rango: rango,
      equivalencia: redondear(estimado, incremento),
      primerUsoGuiado: primerUsoGuiado,
      unidad: unidadTexto(clasif),
      confianza: confianza,
      nivel: refs.nivel,
      fuentes: estimaciones.map(function (e) { return e.fuente.nombre; }),
      ultimaReferencia: refs.nivel === "A" ? { fecha: ultima.fecha, carga: ultima.carga, reps: ultima.reps } : null,
      repsMeta: repsMeta,
      clasificacion: clasif,
      explicacion: explicar(refs.nivel, estimaciones, clasif, ejercicio, rirObjetivo),
      /* Peso corporal: el registro es CARGA TOTAL (cuerpo + lastre). Solo
         presentación: kg sigue siendo la carga total calculada. */
      pesoCorporal: clasif.corporal ? lastreDe(sugerida, opciones.pesoCorporal) : null
    };
  }

  /* --- Peso corporal (presentación de ejercicios con el propio cuerpo) --- */

  /* Peso corporal actual, sin inventarlo:
     1. la medida más reciente de medidas_corporales con peso válido;
     2. si no hay, el peso del perfil (usuario.peso_kg);
     3. si no, null. { kg, fuente: "medida"|"perfil", fecha }. */
  function pesoCorporalActual(data) {
    var medidas = ((data && data.medidas_corporales) || []).filter(function (m) {
      return m && typeof m.peso_kg === "number" && isFinite(m.peso_kg) && m.peso_kg > 0;
    });
    if (medidas.length) {
      var ultima = medidas.slice().sort(function (a, b) { return String(a.fecha) < String(b.fecha) ? 1 : -1; })[0];
      return { kg: ultima.peso_kg, fuente: "medida", fecha: String(ultima.fecha).slice(0, 10) };
    }
    var perfil = data && data.usuario && Number(data.usuario.peso_kg);
    return perfil > 0 ? { kg: perfil, fuente: "perfil", fecha: null } : null;
  }

  /* Lastre = carga total - peso corporal, redondeado hacia abajo a 1,25 kg
     (discos chicos; nunca sugerir más de lo calculado). <= 0 → sin lastre. */
  var INCREMENTO_LASTRE = 1.25;

  function lastreDe(cargaTotal, peso) {
    if (!peso) return { conocido: false };
    var lastre = redondear(cargaTotal - peso.kg, INCREMENTO_LASTRE, "abajo");
    return { conocido: true, kg: peso.kg, fuente: peso.fuente, fecha: peso.fecha, lastre: lastre > 0 ? lastre : 0 };
  }

  /* --- 4. Explicación y UI --- */

  var NOMBRE_IMPL = { barra: "barra", smith: "Smith", mancuernas: "mancuernas", kettlebell: "kettlebell", polea: "polea", maquina: "máquina", otros: "otro implemento", peso_corporal: "peso corporal" };

  var GUIA = {
    alta: "Empezá cerca de esta carga.",
    media: "Usala como punto de partida y ajustá en la primera serie.",
    baja: "Estimación inicial. Probá conservador y ajustá según sensaciones."
  };

  function formatearKg(n) {
    return String(n).replace(".", ",");
  }

  function explicar(nivel, estimaciones, clasif, ejercicio, rirObjetivo) {
    var lineas = [];
    var nombres = estimaciones.map(function (e) { return titulo(e.fuente.nombre); });
    if (nivel === "A") {
      var u = estimaciones[0].ejecuciones[0];
      lineas.push("Basado en tus últimas " + estimaciones[0].ejecuciones.length + " ejecuciones de este ejercicio (la última: " + formatearKg(u.carga) + " kg × " + formatearKg(u.reps) + ").");
    } else {
      lineas.push("Basado en tu historial de " + nombres.join(" y ") + ".");
      var impls = estimaciones.map(function (e) { return e.fuente.clasificacion.implemento; }).filter(function (v, i, a) { return a.indexOf(v) === i; });
      if (impls.some(function (i) { return i !== clasif.implemento; })) {
        lineas.push("Se convirtió de " + impls.map(function (i) { return NOMBRE_IMPL[i]; }).join("/") + " a " + NOMBRE_IMPL[clasif.implemento] + ": las equivalencias entre implementos son aproximadas.");
      }
      if (nivel === "C") lineas.push("Es un ejercicio del mismo patrón de movimiento, no una variante directa.");
      if (nivel === "D") lineas.push("Es una relación indirecta (mismo grupo muscular).");
    }
    lineas.push("Ajustado a " + (ejercicio.reps_objetivo ? ejercicio.reps_objetivo + " reps" : "las reps del plan") +
      (rirObjetivo != null ? " dejando " + formatearKg(Math.round(rirObjetivo * 10) / 10) + " en reserva" : "") + ".");
    if (clasif.implemento === "smith" || clasif.implemento === "maquina" || clasif.implemento === "polea") {
      lineas.push("Las máquinas y Smith pueden variar entre gimnasios: después de tu primer registro, la sugerencia usa tu propia experiencia.");
    }
    return lineas;
  }

  function titulo(nombre) {
    var t = String(nombre || "").toLowerCase();
    return t.charAt(0).toUpperCase() + t.slice(1);
  }

  /* HTML compacto para la tarjeta del ejercicio en Entrenar. Movilidad:
     nada. Peso corporal/banda: una línea. Sin datos: una línea con guía. */
  function renderSugerencia(rec) {
    var esc = GYMAPP.util.escapeHtml;
    if (!rec || rec.tipo === "movilidad") return "";
    if (rec.tipo === "sin_carga") return '<p class="carga-sugerida carga-sin-externa">Sin carga externa sugerida</p>';
    if (rec.tipo === "sin_datos") {
      return '<p class="carga-sugerida carga-sin-datos">Sin historial relacionado para sugerir una carga. Elegí una que te deje cerca de las reps en reserva del plan.</p>';
    }
    var unidad = rec.unidad ? " " + rec.unidad : "";
    var etiquetaConfianza = { alta: "alta", media: "media", baja: "baja" }[rec.confianza];
    if (rec.pesoCorporal) return renderSugerenciaCorporal(rec, etiquetaConfianza);
    return (
      '<div class="carga-sugerida carga-confianza-' + rec.confianza + '">' +
      '<p class="carga-sugerida-linea"><span class="carga-sugerida-etiqueta">Carga sugerida:</span> <strong>' + formatearKg(rec.kg) + " kg" + esc(unidad) + "</strong>" +
      ' <span class="carga-sugerida-confianza">· Confianza ' + etiquetaConfianza + "</span></p>" +
      '<details class="carga-sugerida-detalle"><summary>¿Por qué?</summary>' +
      (rec.primerUsoGuiado
        ? "<p>Equivalencia estimada con tu historial: " + formatearKg(rec.rango[0]) + "–" + formatearKg(rec.rango[1]) + " kg" + esc(unidad) +
          ". Como todavía no registraste este ejercicio, la carga inicial sugerida es más baja para calibrar.</p>"
        : "<p>Rango orientativo: " + formatearKg(rec.rango[0]) + "–" + formatearKg(rec.rango[1]) + " kg" + esc(unidad) + ".</p>") +
      rec.explicacion.map(function (l) { return "<p>" + esc(l) + "</p>"; }).join("") +
      '<p class="carga-sugerida-guia">' + esc(GUIA[rec.confianza]) + " Si terminás con más de 2-3 repeticiones en reserva, subí ligeramente; si no llegás a las reps, bajá.</p>" +
      "</details>" +
      "</div>"
    );
  }

  /* Peso corporal: lo principal es el LASTRE (carga total - peso actual);
     la carga total queda como dato secundario. Sin peso conocido, carga
     total orientativa y pedido de registrar el peso. */
  function renderSugerenciaCorporal(rec, etiquetaConfianza) {
    var esc = GYMAPP.util.escapeHtml;
    var pc = rec.pesoCorporal;
    var total = formatearKg(rec.kg) + " kg";
    var confianza = ' <span class="carga-sugerida-confianza">· Confianza ' + etiquetaConfianza + "</span>";
    var linea, extra, detalle;
    if (!pc.conocido) {
      linea = '<span class="carga-sugerida-etiqueta">Carga total orientativa:</span> <strong>' + total + "</strong>";
      extra = '<p class="carga-sugerida-nota">Para calcular el lastre necesitás registrar tu peso corporal.</p>';
      detalle = "<p>Tus registros de este ejercicio son carga total (peso corporal + lastre).</p>";
    } else {
      var origen = pc.fuente === "medida" ? " (última medida" + (pc.fecha ? " del " + pc.fecha.split("-").reverse().join("/") : "") + ")" : " (según tu perfil)";
      var peso = formatearKg(pc.kg) + " kg";
      if (pc.lastre > 0) {
        linea = '<span class="carga-sugerida-etiqueta">Lastre sugerido:</span> <strong>+' + formatearKg(pc.lastre) + " kg</strong>";
        extra = '<p class="carga-sugerida-nota">Carga total estimada: ' + total + "</p>";
        detalle = "<p>Tu peso corporal actual es " + peso + esc(origen) + ". La carga total estimada para este objetivo es " + total +
          ". Eso equivale aproximadamente a +" + formatearKg(pc.lastre) + " kg de lastre.</p>";
      } else {
        linea = '<span class="carga-sugerida-etiqueta">Sugerencia:</span> <strong>Peso corporal</strong>';
        extra = "";
        detalle = "<p>Tu peso corporal actual es " + peso + esc(origen) + ". La carga total estimada para este objetivo (" + total +
          ") no lo supera: hacelo sin lastre.</p>";
      }
    }
    return (
      '<div class="carga-sugerida carga-corporal carga-confianza-' + rec.confianza + '">' +
      '<p class="carga-sugerida-linea">' + linea + confianza + "</p>" +
      extra +
      '<details class="carga-sugerida-detalle"><summary>¿Por qué?</summary>' +
      detalle +
      "<p>Rango orientativo de carga total: " + formatearKg(rec.rango[0]) + "–" + formatearKg(rec.rango[1]) + " kg.</p>" +
      rec.explicacion.map(function (l) { return "<p>" + esc(l) + "</p>"; }).join("") +
      '<p class="carga-sugerida-guia">' + esc(GUIA[rec.confianza]) + " Si terminás con más de 2-3 repeticiones en reserva, subí ligeramente; si no llegás a las reps, bajá.</p>" +
      "</details>" +
      "</div>"
    );
  }

  /* Contexto de clasificación de un plan: si tiene ejercicios con RIR/RPE,
     uno sin intensidad y con 1-2 series es probablemente activación. */
  function contextoPlan(plan) {
    var tiene = false;
    ((plan && plan.dias) || []).forEach(function (d) {
      (d.ejercicios || []).forEach(function (e) { if (e && (e.rir_objetivo != null || e.rpe_objetivo != null)) tiene = true; });
    });
    return { planConIntensidad: tiene };
  }

  return {
    normalizar: normalizar,
    clasificarEjercicio: clasificarEjercicio,
    parsearReps: parsearReps,
    rirDePrescripcion: rirDePrescripcion,
    construirIndiceHistorial: construirIndiceHistorial,
    seleccionarReferencias: seleccionarReferencias,
    recomendar: recomendar,
    renderSugerencia: renderSugerencia,
    contextoPlan: contextoPlan,
    pesoCorporalActual: pesoCorporalActual,
    GUIA: GUIA
  };
})();
