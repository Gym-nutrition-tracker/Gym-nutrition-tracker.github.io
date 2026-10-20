/* Importación de un plan desde PDF (E6), en capas separadas y testeables:

     extraerTextoPDF(file)         pdf.js → texto (líneas por posición vertical)
     parsearPlanDesdeTexto(texto)  texto → borrador crudo + advertencias
     normalizarPlanParseado(b)     tipos y vacíos coherentes (null, números)
     validarPlanParseado(b)        { errores (bloquean), advertencias }

   Nada de esto escribe datos ni genera IDs: el borrador vive en memoria
   hasta que el usuario confirma (GYMAPP.planes.prepararCambioDePlan).

   Tipos (los que acepta schema 3 hoy, ver storage.validarSnapshotPrescripcion):
   series_objetivo número entero o null; reps_objetivo texto o null;
   rir_objetivo / rpe_objetivo número (valor único) o texto (rango "1-2"),
   o null; peso_objetivo y pausa texto tal cual figura, o null. Nunca se
   inventa un valor ausente ni se infiere el grupo muscular. */
var GYMAPP = window.GYMAPP || (window.GYMAPP = {});

GYMAPP.pdfImport = (function () {
  var WORKER_SRC = "vendor/pdfjs/pdf.worker.min.js";

  var MENSAJE_SIN_TEXTO = "No se pudo extraer texto del PDF. Este archivo puede ser una imagen o un escaneo.";
  var MENSAJE_ILEGIBLE = "No se pudo leer el PDF. Verificá que el archivo no esté dañado.";
  var MENSAJE_RIR_Y_RPE = "Este plan utiliza RIR y RPE simultáneamente. Ambos valores fueron importados por separado.";
  var MENSAJE_SIN_EJERCICIOS = "No se encontró ningún ejercicio en el PDF. Podés cargar la rutina manualmente.";

  /* --- Reutilizado del importador anterior --- */

  var REGEX_DIA = /^(d[ií]a\s*\d+[a-z]?\b.*|rutina\s*[a-z0-9]*\b.*|lunes.*|martes.*|mi[eé]rcoles.*|jueves.*|viernes.*|s[aá]bado.*|domingo.*)$/i;

  /* Formato tabla "Ord. Ejercicio Series Rep. ..." (apps de gimnasio tipo planilla). */
  var REGEX_ORD_PREFIJO = /^(?:\d{1,2}|MA|AC|ABD|WU|CD)\s+/i;
  var REGEX_EJERCICIO_TABLA = /^(.+?)\s+(\d{1,2})\s+(\d{1,2}(?:\s*[-–\/]\s*\d{1,2})?|al fallo)\b/i;

  var PALABRAS_CLAVE_DIA = [
    "EMPUJE", "TRACCION", "PIERNAS", "PIERNA", "TREN SUPERIOR", "TREN INFERIOR",
    "FULL BODY", "PECHO", "ESPALDA", "HOMBRO", "HOMBROS", "BRAZOS",
    "GLUTEO", "GLUTEOS", "CORE", "CARDIO", "PUSH", "PULL", "LEGS", "UPPER", "LOWER"
  ];

  /* Grupo muscular SOLO si figura explícito como columna separada por "|". */
  var GRUPOS_EXPLICITOS = ["Pecho", "Espalda", "Pierna", "Piernas", "Hombro", "Hombros", "Bíceps", "Tríceps", "Glúteo", "Glúteos", "Core", "Cardio", "Cuádriceps", "Isquios", "Gemelos", "Abdomen"];

  function quitarAcentos(texto) {
    return texto.normalize("NFD").replace(/[̀-ͯ]/g, "");
  }

  function esEncabezadoDia(linea) {
    if (REGEX_DIA.test(linea)) return true;
    var normalizada = quitarAcentos(linea.trim()).toUpperCase();
    return PALABRAS_CLAVE_DIA.some(function (palabra) {
      return normalizada.indexOf(palabra) === 0;
    });
  }

  function configurarWorker() {
    if (window.pdfjsLib && !window.pdfjsLib.GlobalWorkerOptions.workerSrc) {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = WORKER_SRC;
    }
  }

  function extraerLineasDePagina(pdf, numeroPagina) {
    return pdf.getPage(numeroPagina).then(function (page) {
      return page.getTextContent();
    }).then(function (contenido) {
      var lineas = [];
      var lineaActual = "";
      var yAnterior = null;
      contenido.items.forEach(function (item) {
        var y = item.transform[5];
        if (yAnterior !== null && Math.abs(y - yAnterior) > 2) {
          lineas.push(lineaActual.trim());
          lineaActual = "";
        }
        lineaActual += item.str + " ";
        yAnterior = y;
      });
      if (lineaActual.trim()) lineas.push(lineaActual.trim());
      return lineas.filter(function (l) { return l.length > 0; });
    });
  }

  /* --- Capa 1: extracción --- */

  /* Promise<string>: líneas del PDF separadas por "\n". Rechaza con un
     Error de mensaje claro si no se puede leer o no tiene texto (no OCR). */
  function extraerTextoPDF(file) {
    configurarWorker();
    return file.arrayBuffer().then(function (arrayBuffer) {
      return window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    }).then(function (pdf) {
      var promesas = [];
      for (var i = 1; i <= pdf.numPages; i++) promesas.push(extraerLineasDePagina(pdf, i));
      return Promise.all(promesas);
    }, function () {
      throw new Error(MENSAJE_ILEGIBLE);
    }).then(function (porPagina) {
      var texto = porPagina.reduce(function (acc, l) { return acc.concat(l); }, []).join("\n");
      if (!texto.replace(/\s+/g, "")) throw new Error(MENSAJE_SIN_TEXTO);
      return texto;
    });
  }

  /* --- Capa 2: parseo de texto --- */

  var NUM = "\\d+(?:[.,]\\d+)?";
  var RANGO = NUM + "(?:\\s*(?:-|–|a)\\s*" + NUM + ")?";
  /* Marcas de segundos/minutos, incluidas las variantes tipográficas. */
  var SEG = "(?:''|\"|″|”)";
  var MIN = "(?:'|’|´|′)";
  /* Reps: "8", "8-10", "10/10", "7-7-7", "15-30''", "8 (5'')", AMRAP… */
  var REPS = "\\d+(?:\\s*[-–\\/]\\s*\\d+)*(?:\\s*" + SEG + ")?(?:\\s*\\(\\s*\\d+(?:\\s*[-–\\/]\\s*\\d+)*\\s*(?:" + SEG + "|" + MIN + "|s)?\\s*\\))?|AMRAP|al fallo|m[aá]x(?:imo)?";
  var REGEX_SERIES_X_REPS = new RegExp("(?:^|\\s|\\|)(\\d{1,2})\\s*[x×X]\\s*(" + REPS + ")(?=$|[\\s|,;)])", "i");
  var REGEX_SERIES_PALABRA = new RegExp("(?:^|\\s|\\|)(\\d{1,2})\\s*series?(?:\\s*de\\s*(" + REPS + "))?(?=$|[\\s|,;)])", "i");
  var REGEX_RIR = [new RegExp("\\bRIR\\s*:?\\s*(" + RANGO + ")", "i"), new RegExp("(" + RANGO + ")\\s*RIR\\b", "i")];
  var REGEX_RPE = [new RegExp("\\bRPE\\s*:?\\s*(" + RANGO + ")", "i"), new RegExp("(" + RANGO + ")\\s*RPE\\b", "i")];
  var TIEMPO = "\\d+(?:\\s*[-–]\\s*\\d+)?\\s*" + SEG + "|\\d+(?:\\s*[-–]\\s*\\d+)?\\s*" + MIN + "(?:\\s*\\d+\\s*" + SEG + "?)?|" + NUM + "\\s*(?:s|seg|segs|segundos|min|mins|minutos)\\b\\.?";
  var REGEX_PAUSA_CLAVE = new RegExp("\\b(?:pausa|descanso|desc\\.?|rest|recuperaci[oó]n)\\s*:?\\s*((?:" + TIEMPO + ")(?:\\s*(?:-|–|a)\\s*(?:" + TIEMPO + "))?)", "i");
  var REGEX_PAUSA_SUELTA = new RegExp("(?:^|\\s|\\|)((?:" + TIEMPO + ")(?:\\s*(?:-|–|a)\\s*(?:" + TIEMPO + "))?)(?=$|[\\s|,;])", "i");
  var REGEX_PESO = new RegExp("(?:\\b(?:peso|carga)\\s*:?\\s*)?(" + NUM + "(?:\\s*(?:-|–|a)\\s*" + NUM + ")?\\s*kg\\b(?:\\s*(?:c\\/u|cada uno|por lado|x lado))?)", "i");
  var REGEX_FECHA = /(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/g;
  var REGEX_NOTA = /^(?:\*+\s*|(?:nota|notas|obs|observaci[oó]n|observaciones|comentario|comentarios|importante)\s*:\s*)/i;
  var REGEX_ENCABEZADO_TABLA = /\bejercicios?\b.*\b(series?|rep)/i;
  var REGEX_PAGINA = /^p[aá]gina\s+\d+(\s+de\s+\d+)?$/i;
  var REGEX_NOMBRE_PLAN = /^(?:plan|programa|mesociclo|planificaci[oó]n)\b/i;

  function limpiarEspacios(t) {
    return String(t).replace(/\s+/g, " ").trim();
  }

  function quitarSeparadoresBorde(t) {
    return limpiarEspacios(t).replace(/^[\s|·•,;:\-–—]+|[\s|·•,;:\-–—]+$/g, "");
  }

  function fechaISO(d, m, a) {
    var anio = a.length === 2 ? 2000 + Number(a) : Number(a);
    var iso = anio + "-" + String(m).padStart(2, "0") + "-" + String(d).padStart(2, "0");
    return GYMAPP.planes.esFechaValida(iso) ? iso : null;
  }

  function fechasDeLinea(linea) {
    var r = [];
    var m;
    REGEX_FECHA.lastIndex = 0;
    while ((m = REGEX_FECHA.exec(linea)) !== null) {
      var iso = fechaISO(m[1], m[2], m[3]);
      if (iso) r.push(iso);
    }
    return r;
  }

  /* "Plan Fuerza - Del 01/03/2027 al 30/04/2027" → "Plan Fuerza": sin
     fechas ni conectores/separadores colgando al final. */
  function limpiarNombrePlan(linea) {
    var t = linea.replace(REGEX_FECHA, " ");
    var anterior;
    do {
      anterior = t;
      /* Paréntesis que quedaron vacíos al sacar las fechas: "(vigencia: - )". */
      t = t.replace(/\(([^()]*)\)/g, function (m, adentro) {
        return /[a-z0-9áéíóúñ]/i.test(adentro.replace(/\b(del|al|desde|hasta|vigencia|inicio|fin)\b/gi, "")) ? m : " ";
      });
      t = quitarSeparadoresBorde(t).replace(/\s*\b(del|al|desde|hasta|vigencia|inicio|fin)\b\s*:?$/i, "");
    } while (t !== anterior);
    return normalizarTexto(t);
  }

  /* Valor de RIR/RPE: número si es único ("2", "8,5"), texto si es un rango
     ("1-2"). Vacío o ausente → null. */
  function normalizarValorEsfuerzo(valor) {
    if (valor === null || valor === undefined) return null;
    if (typeof valor === "number") return isFinite(valor) ? valor : null;
    var t = limpiarEspacios(valor).replace(/,/g, ".").replace(/\s*(?:–|a)\s*/g, "-").replace(/\s*-\s*/g, "-");
    if (!t) return null;
    return /^\d+(?:\.\d+)?$/.test(t) ? Number(t) : t;
  }

  /* Series: entero positivo o null. */
  function normalizarSeries(valor) {
    if (valor === null || valor === undefined || valor === "") return null;
    var n = typeof valor === "number" ? valor : Number(String(valor).trim());
    return Number.isInteger(n) && n > 0 ? n : null;
  }

  function normalizarTexto(valor) {
    if (valor === null || valor === undefined) return null;
    var t = limpiarEspacios(valor);
    return t ? t : null;
  }

  function ejercicioVacio() {
    return {
      nombre: null, grupo_muscular: null, series_objetivo: null, reps_objetivo: null,
      rir_objetivo: null, rpe_objetivo: null, peso_objetivo: null, pausa: null,
      comentarios: null, raw: null, advertencias: []
    };
  }

  /* Busca el primer patrón que matchee; devuelve { valor, inicio, fin }. */
  function buscar(linea, regexes) {
    for (var i = 0; i < regexes.length; i++) {
      var m = regexes[i].exec(linea);
      if (m) {
        var inicio = m.index + m[0].indexOf(m[1]);
        return { valor: m[1], inicio: m.index, fin: m.index + m[0].length, inicioValor: inicio, match: m };
      }
    }
    return null;
  }

  /* Reemplaza por espacios lo ya interpretado, para ver qué quedó. */
  function tapar(linea, desde, hasta) {
    return linea.slice(0, desde) + " ".repeat(hasta - desde) + linea.slice(hasta);
  }

  /* Interpreta UNA línea como ejercicio, o devuelve null si no tiene
     series/repeticiones reconocibles. */
  function parsearLineaEjercicio(linea) {
    var original = limpiarEspacios(linea);
    var resto = original;
    var ej = ejercicioVacio();
    ej.raw = original.length > 200 ? original.slice(0, 197) + "..." : original;

    var sr = REGEX_SERIES_X_REPS.exec(resto) || REGEX_SERIES_PALABRA.exec(resto);
    var nombre;
    if (sr) {
      var posSeries = sr.index + sr[0].indexOf(sr[1]);
      nombre = resto.slice(0, posSeries);
      ej.series_objetivo = normalizarSeries(sr[1]);
      ej.reps_objetivo = sr[2] ? limpiarEspacios(sr[2]).replace(/\s*([-–\/])\s*/g, function (_, s) { return s === "–" ? "-" : s; }) : null;
      resto = " ".repeat(sr.index + sr[0].length) + resto.slice(sr.index + sr[0].length);
    } else {
      var sinOrd = resto.replace(REGEX_ORD_PREFIJO, "");
      var tabla = sinOrd.match(REGEX_EJERCICIO_TABLA);
      if (!tabla) return null;
      var corrimiento = resto.length - sinOrd.length;
      nombre = tabla[1];
      ej.series_objetivo = normalizarSeries(tabla[2]);
      ej.reps_objetivo = limpiarEspacios(tabla[3]).replace(/\s*([-–\/])\s*/g, function (_, s) { return s === "–" ? "-" : s; });
      resto = " ".repeat(corrimiento + tabla[0].length) + resto.slice(corrimiento + tabla[0].length);
    }

    /* Nombre: sin prefijo de orden ni separadores; si viene como columnas
       "Nombre | Grupo", el grupo explícito se toma de ahí. */
    var partesNombre = nombre.split("|").map(quitarSeparadoresBorde).filter(Boolean);
    var nombreLimpio = (partesNombre[0] || "").replace(REGEX_ORD_PREFIJO, "");
    partesNombre.slice(1).forEach(function (p) {
      var g = GRUPOS_EXPLICITOS.filter(function (x) { return quitarAcentos(x).toLowerCase() === quitarAcentos(p).toLowerCase(); })[0];
      if (g && !ej.grupo_muscular) ej.grupo_muscular = g;
      else if (!g) nombreLimpio += " " + p;
    });
    ej.nombre = normalizarTexto(quitarSeparadoresBorde(nombreLimpio));

    var rir = buscar(resto, REGEX_RIR);
    if (rir) { ej.rir_objetivo = normalizarValorEsfuerzo(rir.valor); resto = tapar(resto, rir.inicio, rir.fin); }
    var rpe = buscar(resto, REGEX_RPE);
    if (rpe) { ej.rpe_objetivo = normalizarValorEsfuerzo(rpe.valor); resto = tapar(resto, rpe.inicio, rpe.fin); }
    var peso = buscar(resto, [REGEX_PESO]);
    if (peso) { ej.peso_objetivo = limpiarEspacios(peso.valor); resto = tapar(resto, peso.inicio, peso.fin); }
    var pausa = buscar(resto, [REGEX_PAUSA_CLAVE, REGEX_PAUSA_SUELTA]);
    if (pausa) { ej.pausa = limpiarEspacios(pausa.valor); resto = tapar(resto, pausa.inicio, pausa.fin); }

    /* Grupo explícito en una columna posterior ("| Pecho |"). */
    resto.split("|").forEach(function (segmento) {
      var s = quitarSeparadoresBorde(segmento);
      var g = GRUPOS_EXPLICITOS.filter(function (x) { return quitarAcentos(x).toLowerCase() === quitarAcentos(s).toLowerCase(); })[0];
      if (g && !ej.grupo_muscular) {
        ej.grupo_muscular = g;
        resto = resto.replace(segmento, " ".repeat(segmento.length));
      }
    });

    /* Lo que quedó sin interpretar. Notas explícitas ("(...)", "Nota: ...")
       van a comentarios; cualquier otro texto también, pero con aviso. */
    var sobrante = quitarSeparadoresBorde(resto.replace(/\|/g, " "));
    if (sobrante) {
      var esNota = /^\(.*\)$/.test(sobrante) || REGEX_NOTA.test(sobrante);
      ej.comentarios = sobrante.replace(/^\((.*)\)$/, "$1").replace(REGEX_NOTA, "").trim() || null;
      if (!esNota) ej.advertencias.push("Texto ambiguo: revisá este ejercicio (\"" + sobrante + "\" quedó en comentarios).");
    }
    return ej;
  }

  /* --- Tablas (columnas separadas por 2+ espacios en el texto extraído) --- */

  var REGEX_CODIGO_ORD = /^(?:\d{1,2}|MA|AC|ABD|WU|CD)$/i;
  var REGEX_CELDA_SERIES = /^\d{1,2}$/;
  var REGEX_CELDA_REPS = new RegExp("^(?:" + REPS + ")$", "i");
  var REGEX_CELDA_TIEMPO = new RegExp("^(?:" + TIEMPO + ")$", "i");
  var REGEX_CELDA_RIR = new RegExp("^(?:RIR\\s*:?\\s*(" + RANGO + ")|(" + RANGO + ")\\s*RIR)$", "i");
  var REGEX_CELDA_RPE = new RegExp("^RPE\\s*:?\\s*(" + RANGO + ")$", "i");
  var REGEX_CELDA_NUMERO_RPE = /^(?:10|[1-9])(?:[.,]5)?$/;
  /* Una celda es carga solo si la celda ENTERA es una carga con unidad: un
     "10 KG" dentro de un comentario no es peso prescripto. */
  var REGEX_CELDA_PESO = new RegExp("^(?:(?:peso|carga)\\s*:?\\s*)?" + NUM + "(?:\\s*(?:-|–|a)\\s*" + NUM + ")?\\s*kg\\b(?:\\s*(?:c\\/u|cada uno|por lado|x lado))?$", "i");
  var COLUMNAS = [
    ["ord", /^ord\.?$|^orden$|^n[°º.]?$/i], ["ejercicio", /^ejercicios?$/i], ["series", /^series?$/i], ["reps", /^rep(?:s|\.|eticiones)?$/i],
    ["peso", /^(?:peso|carga|kg)$/i], ["rir", /^rir$/i], ["rpe", /^rpe$/i], ["pausa", /^(?:pausa|descanso|desc\.?)$/i],
    ["comentarios", /^(?:comentarios?|observaciones|notas?)$/i], ["grupo", /^(?:grupo|grupo muscular|m[uú]sculo)$/i]
  ];

  function celdas(lineaOriginal) {
    return String(lineaOriginal).split(/\s{2,}|\t+/).map(function (c) { return c.trim(); }).filter(Boolean);
  }

  /* Si la línea es el encabezado de una tabla de ejercicios devuelve sus
     columnas conocidas (["ord", "ejercicio", "series", …]); si no, null. */
  function leerEncabezadoColumnas(lineaOriginal) {
    var cs = celdas(lineaOriginal);
    if (cs.length < 3) return null;
    var columnas = cs.map(function (c) {
      var col = COLUMNAS.filter(function (x) { return x[1].test(c); })[0];
      return col ? col[0] : null;
    });
    if (columnas.indexOf("ejercicio") === -1 || (columnas.indexOf("series") === -1 && columnas.indexOf("reps") === -1)) return null;
    if (columnas.filter(function (c) { return c; }).length < cs.length - 1) return null;
    return columnas.filter(function (c) { return c; });
  }

  /* Fila de una tabla con encabezado conocido. Estructura: [orden] nombre
     (1+ celdas de texto) series reps [resto]. Cada celda del resto se
     clasifica por SEMÁNTICA, no por posición: RIR → rir_objetivo, tiempo →
     pausa, carga con unidad (celda completa) → peso_objetivo, número 1-10
     → rpe_objetivo solo si el encabezado tiene columna RPE, texto →
     comentarios (si el encabezado tiene esa columna). Si la fila no tiene
     esa estructura devuelve null y se usa el parseo por línea. */
  function parsearFilaTabla(lineaOriginal, columnas) {
    var cs = celdas(lineaOriginal);
    var i = 0;
    if (cs.length && REGEX_CODIGO_ORD.test(cs[0]) && cs.length > 3) i = 1;
    var fin = -1;
    for (var k = i + 1; k < cs.length - 1; k++) {
      if (REGEX_CELDA_SERIES.test(cs[k]) && REGEX_CELDA_REPS.test(cs[k + 1])) { fin = k; break; }
    }
    if (fin === -1) return null;
    var nombre = cs.slice(i, fin).join(" ");
    if (!/[a-záéíóúñ]/i.test(nombre)) return null;

    var ej = ejercicioVacio();
    ej.raw = cs.join(" | ");
    if (ej.raw.length > 200) ej.raw = ej.raw.slice(0, 197) + "...";
    ej.nombre = normalizarTexto(nombre);
    ej.series_objetivo = normalizarSeries(cs[fin]);
    ej.reps_objetivo = limpiarEspacios(cs[fin + 1]).replace(/\s*([-–\/])\s*/g, function (_, x) { return x === "–" ? "-" : x; });

    var tieneRpe = columnas.indexOf("rpe") !== -1;
    var tieneComentarios = columnas.indexOf("comentarios") !== -1;
    var comentarios = [];
    var dudosos = [];
    cs.slice(fin + 2).forEach(function (celda) {
      var m;
      if ((m = REGEX_CELDA_RIR.exec(celda)) && ej.rir_objetivo === null) {
        ej.rir_objetivo = normalizarValorEsfuerzo(m[1] || m[2]);
      } else if ((m = REGEX_CELDA_RPE.exec(celda)) && ej.rpe_objetivo === null) {
        ej.rpe_objetivo = normalizarValorEsfuerzo(m[1]);
      } else if (REGEX_CELDA_TIEMPO.test(celda) && ej.pausa === null) {
        ej.pausa = celda;
      } else if (REGEX_CELDA_PESO.test(celda) && ej.peso_objetivo === null) {
        ej.peso_objetivo = limpiarEspacios(celda.replace(/^(?:peso|carga)\s*:?\s*/i, ""));
      } else if (REGEX_CELDA_NUMERO_RPE.test(celda) && tieneRpe && ej.rpe_objetivo === null) {
        ej.rpe_objetivo = normalizarValorEsfuerzo(celda);
      } else if (/[a-záéíóúñ]/i.test(celda) && tieneComentarios) {
        comentarios.push(celda);
      } else {
        dudosos.push(celda);
      }
    });
    if (dudosos.length) comentarios = comentarios.concat(dudosos);
    if (comentarios.length) ej.comentarios = comentarios.join(" ");
    if (dudosos.length) ej.advertencias.push("Texto ambiguo: revisá este ejercicio (\"" + dudosos.join(" ") + "\" quedó en comentarios).");
    return ej;
  }

  /* --- Metadata del documento (en cualquier parte del texto) --- */

  var REGEX_ETIQUETA_FECHA = "(\\d{1,2}[\\/.-]\\d{1,2}[\\/.-]\\d{2,4})";
  var REGEX_DESDE = new RegExp("\\b(?:desde|inicio|comienzo|fecha de inicio)\\s*:\\s*" + REGEX_ETIQUETA_FECHA, "i");
  var REGEX_HASTA = new RegExp("\\b(?:hasta|fin|finaliza|fecha de fin)\\s*:\\s*" + REGEX_ETIQUETA_FECHA, "i");
  var REGEX_DESCRIPCION = /^descripci[oó]n\s*:\s*(.*?)(?=\s{2,}(?:desde|hasta|inicio|fin|fecha)\b|$)/i;
  /* Datos de la persona o del documento que no son parte del plan. */
  var REGEX_METADATA = /^(?:nombre|alumno|alumna|atleta|cliente|profesor|profesora|entrenador|entrenadora|coach|fecha|desde|hasta)\s*:/i;
  var REGEX_OBSERVACIONES = /^observaciones(\s+generales)?\s*:\s*(.*)$/i;
  var REGEX_TITULO_GENERICO = /^(?:plan(?:illa)? de entrenamiento|rutina de entrenamiento|planificaci[oó]n)$/i;

  function fechaDeEtiqueta(regex, linea) {
    var m = regex.exec(linea);
    if (!m) return null;
    var p = m[1].split(/[\/.-]/);
    return fechaISO(p[0], p[1], p[2]);
  }

  /* texto → borrador crudo. No genera IDs ni escribe nada. */
  function parsearPlanDesdeTexto(texto) {
    /* Se conserva la línea original (con sus espacios) para leer celdas. */
    var originales = String(texto || "").split(/\r?\n/).filter(function (l) { return l.trim(); });
    var lineas = originales.map(limpiarEspacios);
    var borrador = { nombre: null, fecha_inicio: null, fecha_fin: null, advertencias: [], dias: [] };
    var diaActual = null;
    var ultimoEjercicio = null;
    var columnas = null;
    var fechasEncabezado = [];
    var fechaInicioEtiquetada = null, fechaFinEtiquetada = null;
    var nombreDescripcion = null;

    /* Un encabezado de tabla justo después de una línea la marca como
       nombre de día (además de los nombres de día habituales). */
    var anteDeTabla = {};
    originales.forEach(function (l, k) {
      if (k > 0 && leerEncabezadoColumnas(l)) anteDeTabla[k - 1] = true;
    });

    lineas.forEach(function (linea, indice) {
      var original = originales[indice];
      if (REGEX_PAGINA.test(linea)) return;

      var encabezado = leerEncabezadoColumnas(original);
      if (encabezado) { columnas = encabezado; return; }
      if (REGEX_ENCABEZADO_TABLA.test(linea) && !REGEX_SERIES_X_REPS.test(linea)) return;

      /* Metadata del documento: puede aparecer en cualquier lugar del texto
         extraído (pdf.js no garantiza el orden visual). Nunca es una línea
         "sin interpretar". */
      var desde = fechaDeEtiqueta(REGEX_DESDE, original);
      var hasta = fechaDeEtiqueta(REGEX_HASTA, original);
      if (desde && !fechaInicioEtiquetada) fechaInicioEtiquetada = desde;
      if (hasta && !fechaFinEtiquetada) fechaFinEtiquetada = hasta;
      var descripcion = REGEX_DESCRIPCION.exec(original);
      if (descripcion) {
        if (!nombreDescripcion) nombreDescripcion = normalizarTexto(descripcion[1]);
        return;
      }
      if (REGEX_METADATA.test(linea) || REGEX_TITULO_GENERICO.test(linea)) return;
      var observacion = REGEX_OBSERVACIONES.exec(linea);
      if (observacion) {
        var textoObs = observacion[2].trim();
        if (textoObs && observacion[1]) borrador.advertencias.push("Observación general del plan: \"" + textoObs + "\".");
        else if (textoObs && diaActual) diaActual.advertencias.push("Observación del día: \"" + textoObs + "\".");
        return;
      }

      var fechas = fechasDeLinea(linea);
      if (!diaActual && fechas.length && !desde && !hasta) {
        if (/\b(inicio|desde|comienza|comienzo)\b/i.test(linea) && fechas.length === 1) fechaInicioEtiquetada = fechas[0];
        else if (/\b(fin|hasta|finaliza|termina)\b/i.test(linea) && fechas.length === 1) fechaFinEtiquetada = fechas[0];
        else fechasEncabezado = fechasEncabezado.concat(fechas);
      }
      if (!diaActual && !borrador.nombre && REGEX_NOMBRE_PLAN.test(linea)) {
        borrador.nombre = limpiarNombrePlan(linea);
        return;
      }
      if (!diaActual && fechas.length && !REGEX_SERIES_X_REPS.test(linea)) return;

      if (REGEX_NOTA.test(linea) && ultimoEjercicio) {
        var nota = linea.replace(REGEX_NOTA, "").trim();
        ultimoEjercicio.comentarios = ultimoEjercicio.comentarios ? ultimoEjercicio.comentarios + " " + nota : nota;
        return;
      }

      var ej = (columnas && parsearFilaTabla(original, columnas)) || parsearLineaEjercicio(linea);
      if (!ej && (esEncabezadoDia(linea) || anteDeTabla[indice])) {
        diaActual = { nombre: linea, advertencias: [], ejercicios: [] };
        borrador.dias.push(diaActual);
        ultimoEjercicio = null;
        return;
      }
      if (ej) {
        if (!diaActual) {
          diaActual = { nombre: "Día importado 1", advertencias: ["No se encontró el nombre de este día en el PDF."], ejercicios: [] };
          borrador.dias.push(diaActual);
        }
        diaActual.ejercicios.push(ej);
        ultimoEjercicio = ej;
        return;
      }
      /* Dentro de un día: nada se descarta en silencio. */
      if (diaActual) diaActual.advertencias.push("Línea sin interpretar: \"" + linea + "\". Si era un ejercicio, agregalo a mano.");
    });

    if (nombreDescripcion) borrador.nombre = nombreDescripcion;

    if (fechaInicioEtiquetada || fechaFinEtiquetada) {
      borrador.fecha_inicio = fechaInicioEtiquetada;
      borrador.fecha_fin = fechaFinEtiquetada;
    } else if (fechasEncabezado.length === 2 && fechasEncabezado[0] <= fechasEncabezado[1]) {
      borrador.fecha_inicio = fechasEncabezado[0];
      borrador.fecha_fin = fechasEncabezado[1];
    } else if (fechasEncabezado.length) {
      borrador.advertencias.push("Se encontraron fechas en el PDF pero no se pudo determinar la vigencia con seguridad: completala a mano.");
    }

    borrador.dias = borrador.dias.filter(function (d) {
      if (d.ejercicios.length) return true;
      borrador.advertencias.push("Se ignoró \"" + d.nombre + "\" porque no tenía ejercicios reconocibles.");
      return false;
    });
    return borrador;
  }

  /* --- Capa 3: normalización --- */

  /* Copia con tipos coherentes. Sin campos inventados: lo que no está
     queda en null. No genera IDs. */
  function normalizarPlanParseado(borrador) {
    borrador = borrador || {};
    return {
      nombre: normalizarTexto(borrador.nombre),
      fecha_inicio: normalizarTexto(borrador.fecha_inicio),
      fecha_fin: normalizarTexto(borrador.fecha_fin),
      advertencias: (borrador.advertencias || []).slice(),
      dias: (borrador.dias || []).map(function (d) {
        return {
          nombre: normalizarTexto(d.nombre),
          advertencias: (d.advertencias || []).slice(),
          ejercicios: (d.ejercicios || []).map(function (e) {
            return {
              nombre: normalizarTexto(e.nombre),
              grupo_muscular: normalizarTexto(e.grupo_muscular),
              series_objetivo: normalizarSeries(e.series_objetivo),
              reps_objetivo: normalizarTexto(e.reps_objetivo),
              rir_objetivo: normalizarValorEsfuerzo(e.rir_objetivo),
              rpe_objetivo: normalizarValorEsfuerzo(e.rpe_objetivo),
              peso_objetivo: normalizarTexto(e.peso_objetivo),
              pausa: normalizarTexto(e.pausa),
              comentarios: normalizarTexto(e.comentarios),
              raw: normalizarTexto(e.raw),
              advertencias: (e.advertencias || []).slice()
            };
          })
        };
      })
    };
  }

  /* --- Capa 4: validación --- */

  /* errores: impiden activar (estructura, nombres, fechas, series inválidas).
     advertencias: informativas (campos sin detectar, RIR + RPE, avisos del
     parser). Cada item: { dia, ejercicio, campo, mensaje } (índices o null). */
  function validarPlanParseado(borrador) {
    var errores = [];
    var advertencias = [];
    var item = function (lista, dia, ejercicio, campo, mensaje) { lista.push({ dia: dia, ejercicio: ejercicio, campo: campo, mensaje: mensaje }); };
    if (!borrador || !Array.isArray(borrador.dias)) {
      item(errores, null, null, null, "El plan no tiene una estructura válida.");
      return { errores: errores, advertencias: advertencias };
    }
    (borrador.advertencias || []).forEach(function (m) { item(advertencias, null, null, null, m); });
    var fechas = GYMAPP.planes.validarMetadataPlan({ nombre: borrador.nombre || "", fecha_inicio: borrador.fecha_inicio || "", fecha_fin: borrador.fecha_fin || "" });
    if (!fechas.ok) item(errores, null, null, "fechas", fechas.error);
    if (!borrador.dias.length) item(errores, null, null, null, "El plan no tiene días.");
    var total = 0;
    var conRirYRpe = 0;
    borrador.dias.forEach(function (dia, i) {
      if (!dia || !Array.isArray(dia.ejercicios)) { item(errores, i, null, null, "Un día no tiene una estructura válida."); return; }
      if (!normalizarTexto(dia.nombre)) item(errores, i, null, "nombre", "Falta el nombre del día.");
      (dia.advertencias || []).forEach(function (m) { item(advertencias, i, null, null, m); });
      dia.ejercicios.forEach(function (ej, j) {
        total += 1;
        if (!normalizarTexto(ej.nombre)) item(errores, i, j, "nombre", "Falta el nombre del ejercicio.");
        if (ej.series_objetivo !== null && normalizarSeries(ej.series_objetivo) === null) item(errores, i, j, "series_objetivo", "Las series tienen que ser un número entero mayor a 0.");
        (ej.advertencias || []).forEach(function (m) { item(advertencias, i, j, null, m); });
        if (ej.series_objetivo === null) item(advertencias, i, j, "series_objetivo", "No se detectaron series.");
        if (ej.reps_objetivo === null) item(advertencias, i, j, "reps_objetivo", "No se detectaron repeticiones.");
        if (ej.grupo_muscular === null) item(advertencias, i, j, "grupo_muscular", "No se pudo detectar el grupo muscular.");
        if (ej.rir_objetivo !== null && ej.rpe_objetivo !== null) conRirYRpe += 1;
      });
    });
    if (borrador.dias.length && !total) item(errores, null, null, null, "El plan no tiene ejercicios.");
    /* RIR + RPE juntos es válido: un único aviso informativo a nivel plan
       (no uno por ejercicio). Los datos no cambian. */
    if (conRirYRpe) item(advertencias, null, null, null, MENSAJE_RIR_Y_RPE);
    return { errores: errores, advertencias: advertencias };
  }

  /* --- Orquestación (UI) --- */

  /* Promise<borrador normalizado>. Rechaza con Error de mensaje claro si no
     hay texto o no se encontró ningún ejercicio. No escribe nada. */
  function importarPlanDesdeArchivo(file) {
    return extraerTextoPDF(file).then(function (texto) {
      var borrador = normalizarPlanParseado(parsearPlanDesdeTexto(texto));
      var hayEjercicios = borrador.dias.some(function (d) { return d.ejercicios.length; });
      if (!hayEjercicios) throw new Error(MENSAJE_SIN_EJERCICIOS);
      borrador.nombre_archivo = file && file.name ? String(file.name) : null;
      return borrador;
    });
  }

  return {
    extraerTextoPDF: extraerTextoPDF,
    parsearPlanDesdeTexto: parsearPlanDesdeTexto,
    normalizarPlanParseado: normalizarPlanParseado,
    validarPlanParseado: validarPlanParseado,
    importarPlanDesdeArchivo: importarPlanDesdeArchivo,
    normalizarValorEsfuerzo: normalizarValorEsfuerzo,
    normalizarSeries: normalizarSeries,
    ejercicioVacio: ejercicioVacio,
    MENSAJE_SIN_TEXTO: MENSAJE_SIN_TEXTO,
    MENSAJE_SIN_EJERCICIOS: MENSAJE_SIN_EJERCICIOS,
    MENSAJE_RIR_Y_RPE: MENSAJE_RIR_Y_RPE
  };
})();
