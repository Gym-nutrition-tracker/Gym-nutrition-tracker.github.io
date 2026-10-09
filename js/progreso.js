/* Pestaña Progreso: gráfico por ejercicio, heatmap de entrenamientos y rachas. */
var GYMAPP = window.GYMAPP || (window.GYMAPP = {});

GYMAPP.progreso = (function () {
  var DIAS_SEMANA = ["L", "M", "M", "J", "V", "S", "D"];

  /* PROG-01.2 Parte B: jerarquía bloque -> ejercicio (opcional), igual que
     en "Análisis semanal" (estadoAnalisis más abajo). bloqueId siempre
     tiene un valor (el primer bloque ACTIVO de la rutina por defecto,
     nunca un ejercicio suelto ni el primero "porque sí" -podía ser
     movilidad/calentamiento-); ejercicioId vacío significa "Todo el
     bloque" (vista agregada), que es el valor por defecto. */
  var estado = { bloqueId: "", ejercicioId: "", metrica: "volumen_total", mesActual: inicioDeMes(new Date()) };

  function render(container) {
    var data = GYMAPP.storage.getData();
    var opcionesBloquesEvolucion = construirOpcionesBloquesAnalisis(data);

    if (!estado.bloqueId || !opcionesBloquesEvolucion.some(function (o) { return o.id === estado.bloqueId; })) {
      estado.bloqueId = opcionesBloquesEvolucion.length ? primerBloqueActivoOInicial(data, opcionesBloquesEvolucion) : "";
      estado.ejercicioId = "";
    }

    var opcionesEjerciciosEvolucion = construirOpcionesEjerciciosDeBloque(data, estado.bloqueId);
    if (estado.ejercicioId && !opcionesEjerciciosEvolucion.some(function (o) { return o.id === estado.ejercicioId; })) {
      estado.ejercicioId = "";
    }

    /* "Todo el bloque" solo tiene sentido con Volumen total (sección 10:
       peso máximo/repeticiones agregados de ejercicios distintos no
       significan nada). Al elegir un ejercicio concreto, volumen_total
       sigue siendo válido, así que no se fuerza ningún cambio ahí. */
    if (!estado.ejercicioId && estado.metrica !== "volumen_total") {
      estado.metrica = "volumen_total";
    }

    var rachas = calcularRachas(obtenerDiasActivosOrdenados(data.sesiones_entrenamiento));

    container.innerHTML = template(data, opcionesBloquesEvolucion, opcionesEjerciciosEvolucion, rachas);
    if (!container.dataset.progresoBound) {
      bindEventos(container);
      container.dataset.progresoBound = "1";
    }
    dibujarGrafico(container, data);
  }

  /* Primer bloque ACTIVO de la rutina (sección 9: nunca el primer
     ejercicio, que podía ser movilidad/calentamiento). Si no hay ningún
     bloque activo (rutina vacía) pero sí históricos, cae al primero de
     las opciones disponibles, igual criterio que ya usa
     renderSeccionAnalisisSemanal para no dejar la sección sin selección. */
  function primerBloqueActivoOInicial(data, opcionesBloques) {
    if (data.rutina.dias.length) return data.rutina.dias[0].id;
    return opcionesBloques[0].id;
  }

  /* --- Templates ---
     Layout: resumen general -> evolución por ejercicio (con protagonismo) ->
     calendario -> historial accesible. En pantallas angostas todo se apila
     en ese orden; en tablet/desktop, evolución queda en una columna ancha y
     calendario+historial en una columna lateral (ver .progreso-layout en
     styles.css). */

  function template(data, opcionesBloquesEvolucion, opcionesEjerciciosEvolucion, rachas) {
    var sesiones = data.sesiones_entrenamiento;

    return (
      '<div class="pantalla pantalla-progreso">' +
      "<h2>Progreso</h2>" +
      renderResumenGeneral(sesiones, rachas) +
      '<div class="progreso-layout">' +
      '<div class="progreso-columna-principal">' +
      renderSeccionEvolucion(opcionesBloquesEvolucion, opcionesEjerciciosEvolucion) +
      renderSeccionAnalisisSemanal(data) +
      "</div>" +
      '<div class="progreso-columna-lateral">' +
      renderSeccionCalendario(data) +
      renderSeccionHistorialAccesible(sesiones) +
      "</div>" +
      "</div>" +
      "</div>"
    );
  }

  /* --- Resumen general ---
     Cuatro cifras separadas a propósito (ver comentario de "Rachas" más
     abajo): días activos y sesiones totales son conteos distintos, nunca se
     mezclan entre sí ni con las rachas. */
  function renderResumenGeneral(sesiones, rachas) {
    var diasActivos = obtenerDiasActivosOrdenados(sesiones).length;

    return (
      '<div class="tarjetas-macros progreso-resumen">' +
      tarjetaResumen(diasActivos, diasActivos === 1 ? "Día activo" : "Días activos") +
      tarjetaResumen(sesiones.length, sesiones.length === 1 ? "Sesión total" : "Sesiones totales") +
      tarjetaResumen(rachas.actual, "Racha actual (días)") +
      tarjetaResumen(rachas.maxima, "Racha máxima (días)") +
      "</div>"
    );
  }

  function tarjetaResumen(valor, etiqueta) {
    return (
      '<div class="tarjeta-macro">' +
      '<span class="tarjeta-macro-valor">' + valor + "</span>" +
      '<span class="tarjeta-macro-nombre">' + etiqueta + "</span>" +
      "</div>"
    );
  }

  /* --- Evolución: jerarquía bloque -> ejercicio (opcional) ---
     PROG-01.2 Parte B: antes, esta sección abría por defecto en el primer
     ejercicio de la rutina (podía ser movilidad/abdominales, sin
     progresión útil). Ahora replica la jerarquía de "Análisis semanal":
     primero se elige el bloque/día de rutina (por defecto el primero
     activo), y opcionalmente un ejercicio puntual de ese bloque (por
     defecto "Todo el bloque", viendo el volumen agregado). */

  function renderSeccionEvolucion(opcionesBloques, opcionesEjercicios) {
    if (!opcionesBloques.length) {
      return (
        '<div class="progreso-panel progreso-evolucion">' +
        "<h3>Evolución</h3>" +
        '<p class="nota">Todavía no hay ejercicios en tu rutina ni en tu historial.</p>' +
        "</div>"
      );
    }

    var selectores = renderSelectorBloqueEjercicio(
      "select-evolucion-bloque", "select-evolucion-ejercicio",
      opcionesBloques, opcionesEjercicios, estado.bloqueId, estado.ejercicioId
    );

    return (
      '<div class="progreso-panel progreso-evolucion">' +
      "<h3>Evolución</h3>" +
      selectores +
      renderVistaEvolucion(!!estado.ejercicioId) +
      "</div>"
    );
  }

  /* Markup de los dos <select> (bloque + ejercicio opcional), compartido
     entre Evolución y "Análisis semanal" (misma jerarquía, sección 9 del
     pedido: "igual que en Análisis semanal"). Los ids se parametrizan
     porque ambas secciones conviven en la misma pantalla. */
  function renderSelectorBloqueEjercicio(idSelectBloque, idSelectEjercicio, opcionesBloques, opcionesEjercicios, bloqueSeleccionado, ejercicioSeleccionado) {
    var selectBloque =
      '<div class="campo"><label for="' + idSelectBloque + '">Bloque / día de rutina</label>' +
      '<select id="' + idSelectBloque + '">' +
      opcionesBloques.map(function (o) {
        return '<option value="' + o.id + '"' + (o.id === bloqueSeleccionado ? " selected" : "") + ">" +
          GYMAPP.util.escapeHtml(o.nombre) + "</option>";
      }).join("") +
      "</select></div>";

    var selectEjercicio = opcionesEjercicios.length
      ? '<div class="campo"><label for="' + idSelectEjercicio + '">Ejercicio (opcional)</label>' +
        '<select id="' + idSelectEjercicio + '">' +
        '<option value=""' + (!ejercicioSeleccionado ? " selected" : "") + ">Todo el bloque</option>" +
        opcionesEjercicios.map(function (o) {
          return '<option value="' + o.id + '"' + (o.id === ejercicioSeleccionado ? " selected" : "") + ">" +
            GYMAPP.util.escapeHtml(o.nombre) + "</option>";
        }).join("") +
        "</select></div>"
      : "";

    return selectBloque + selectEjercicio;
  }

  /* Con "Todo el bloque" (ejercicioSeleccionado=false) solo tiene sentido
     Volumen total (sección 10: peso máximo/repeticiones agregados de
     ejercicios distintos no significan nada); con un ejercicio puntual
     reaparecen las 3 métricas de siempre (PRO-04, sin cambios). El texto
     informativo de cantidad de sesiones (sección "para este día") solo se
     muestra en la vista de bloque, igual que antes de esta tarea. */
  function renderVistaEvolucion(ejercicioSeleccionado) {
    var tabs = ejercicioSeleccionado
      ? botonMetrica("peso_maximo", "Peso máximo") + botonMetrica("repeticiones", "Repeticiones") + botonMetrica("volumen_total", "Volumen total")
      : botonMetrica("volumen_total", "Volumen total");

    return (
      '<div class="selector-tipo metrica-selector">' + tabs + "</div>" +
      (ejercicioSeleccionado ? "" : '<p id="progreso-dia-info" class="nota oculto"></p>') +
      '<div class="grafico-contenedor grafico-contenedor-grande"><canvas id="grafico-progreso"></canvas></div>' +
      renderEstadoVacioEvolucion(ejercicioSeleccionado)
    );
  }

  function renderEstadoVacioEvolucion(ejercicioSeleccionado) {
    var titulo = ejercicioSeleccionado
      ? "Todavía no hay registros para este ejercicio"
      : "Todavía no hay sesiones registradas para este bloque";
    var ayuda = ejercicioSeleccionado
      ? "Cargá una sesión de gimnasio con este ejercicio en la pestaña Entrenar para ver su evolución acá."
      : "Cargá una sesión de gimnasio para este bloque en la pestaña Entrenar para ver su evolución acá.";

    return (
      '<div id="progreso-grafico-vacio" class="progreso-estado-vacio oculto">' +
      '<span class="progreso-estado-vacio-icono" aria-hidden="true">📉</span>' +
      '<p class="progreso-estado-vacio-titulo">' + titulo + "</p>" +
      '<p class="nota">' + ayuda + "</p>" +
      "</div>"
    );
  }

  function botonMetrica(valor, etiqueta) {
    return (
      '<button type="button" data-accion="set-metrica" data-metrica="' + valor + '" class="btn-tipo' +
      (estado.metrica === valor ? " activo" : "") + '">' + etiqueta + "</button>"
    );
  }

  /* --- PROG-01: análisis de progresión semanal ---

     Alcance: solo lectura de datos. Todo se deriva en runtime a partir de
     sesiones_entrenamiento en cada render; no se persiste nada nuevo ni se
     toca schema_version, localStorage, rutina histórica ni sesiones.

     Semana: lunes a domingo, siempre en fecha LOCAL (se parte de
     GYMAPP.util.fechaLocalISO(sesion.fecha), nunca de la hora UTC cruda, y
     toda la aritmética de fechas usa el constructor local new Date(y,m,d),
     nunca new Date(isoString) ni slice sobre un timestamp).

     Bloque = día de rutina (dia_rutina_id). Un bloque o ejercicio histórico
     (ya editado/eliminado de la rutina actual) sigue analizándose igual:
     las opciones de bloque/ejercicio para este análisis se reconstruyen
     también desde el historial, no solo desde la rutina vigente (mismo
     criterio que ya usa construirOpcionesEjercicio más arriba).

     RPE: el modelo de datos solo lo guarda a nivel SESIÓN COMPLETA, nunca
     por ejercicio individual. Por eso "RPE promedio" se calcula y se
     muestra únicamente en la vista por BLOQUE (promedio del RPE de las
     sesiones de ese bloque en la semana); la vista por EJERCICIO nunca
     muestra un RPE propio, a propósito, para no inventar un dato que el
     modelo no tiene. */

  var estadoAnalisis = { bloqueId: "", ejercicioId: "" };

  /* PROG-01.1: frecuencia semanal esperada por bloque.
     Contexto de producto: cada día/bloque de la rutina está pensado para
     hacerse UNA sola vez por semana (una rutina de 3/4/5 días implica 3/4/5
     bloques, cada uno 1 vez/semana). Por eso 1 sesión esa semana no es una
     "muestra chica": es la ejecución completa de ese bloque. Fija en 1 por
     ahora, a propósito (sección 1: "no agregar todavía configuración
     manual de frecuencia"); el día que exista frecuencia configurable por
     bloque, este valor pasa a leerse de ahí sin tocar el resto de la
     lógica de abajo. */
  var FRECUENCIA_ESPERADA_SEMANAL = 1;

  /* Un bloque histórico (ya eliminado de la rutina actual) sigue
     analizándose igual (sección 1: "seguir analizándolos"), pero nunca se
     le asume una frecuencia esperada: no sabemos con qué cadencia se
     entrenaba en su momento, así que nunca se etiqueta como
     "pendiente"/"completado" (eso implicaría inventar un dato). */
  function bloqueEsActivo(data, bloqueId) {
    return data.rutina.dias.some(function (d) { return d.id === bloqueId; });
  }

  /* Estado semanal del bloque (sección 2), independiente de la vista
     (bloque o ejercicio: ambas comparten la misma cadencia esperada,
     porque un ejercicio solo se registra cuando se entrena su bloque).
     null cuando el bloque es histórico (frecuencia no disponible). */
  function obtenerEstadoFrecuenciaSemanal(cantidadSesiones, esActivo) {
    if (!esActivo) return null;
    if (cantidadSesiones === 0) {
      return { tipo: "pendiente", texto: "Pendiente esta semana" };
    }
    if (cantidadSesiones === FRECUENCIA_ESPERADA_SEMANAL) {
      return { tipo: "completado", texto: "✓ Sesión semanal completada" };
    }
    return { tipo: "superior", texto: cantidadSesiones + " sesiones esta semana · frecuencia superior a la planificada" };
  }

  /* Lunes=0 ya existe como diaDeSemanaLunesPrimero(date) más abajo en el
     archivo (declarado con function, por lo que el hoisting lo deja
     disponible acá arriba sin problema). */
  function inicioDeSemanaISO(fechaLocalISOStr) {
    var partes = fechaLocalISOStr.split("-");
    var d = new Date(parseInt(partes[0], 10), parseInt(partes[1], 10) - 1, parseInt(partes[2], 10));
    d.setDate(d.getDate() - diaDeSemanaLunesPrimero(d));
    return formatearFechaISO(d);
  }

  function finDeSemanaISO(inicioSemanaISO) {
    var partes = inicioSemanaISO.split("-");
    var d = new Date(parseInt(partes[0], 10), parseInt(partes[1], 10) - 1, parseInt(partes[2], 10));
    d.setDate(d.getDate() + 6);
    return formatearFechaISO(d);
  }

  /* Rango continuo de semanas (lunes a lunes, de 7 en 7) entre dos inicios
     de semana ISO, ambos incluidos. Así las semanas sin ninguna sesión
     quedan representadas con 0 en vez de simplemente no existir. */
  function generarRangoSemanas(inicioISO, finISO) {
    var resultado = [];
    var partesInicio = inicioISO.split("-");
    var cursor = new Date(parseInt(partesInicio[0], 10), parseInt(partesInicio[1], 10) - 1, parseInt(partesInicio[2], 10));
    var partesFin = finISO.split("-");
    var fin = new Date(parseInt(partesFin[0], 10), parseInt(partesFin[1], 10) - 1, parseInt(partesFin[2], 10));
    while (cursor <= fin) {
      resultado.push(formatearFechaISO(cursor));
      cursor.setDate(cursor.getDate() + 7);
    }
    return resultado;
  }

  /* Series de TODOS los ejercicios realizados en una sesión, aplanadas.
     Mismo criterio que obtenerSerieDia: peso/reps faltantes o en 0 nunca
     rompen el cálculo, simplemente no aportan volumen. */
  function obtenerSeriesDeSesion(sesion) {
    return (sesion.ejercicios_realizados || []).reduce(function (acc, er) {
      return acc.concat(er.series || []);
    }, []);
  }

  function volumenDeSeries(series) {
    return series.reduce(function (acc, serie) {
      var peso = Number(serie.peso_kg) || 0;
      var reps = Number(serie.reps) || 0;
      return acc + peso * reps;
    }, 0);
  }

  /* volumen = SUMA(peso * repeticiones) sobre todas las series de la
     sesión, sumando los ejercicios del bloque (todos los ejercicios
     realizados en esa sesión, ya que una sesión de gimnasio corresponde a
     un solo bloque/día de rutina). */
  function volumenSesionCompleta(sesion) {
    return volumenDeSeries(obtenerSeriesDeSesion(sesion));
  }

  function promedioONull(valores) {
    var limpios = valores.filter(function (v) { return v !== null && v !== undefined && !isNaN(v); });
    if (!limpios.length) return null;
    return limpios.reduce(function (a, b) { return a + b; }, 0) / limpios.length;
  }

  /* cambio_pct = ((actual - anterior) / anterior) * 100.
     - Sin semana anterior comparable (no se pasa `anterior`): null -> "Sin
       comparación".
     - anterior = 0: nunca se divide por cero. Si actual también es 0, el
       cambio es 0% (no hay base matemática distinta); si actual > 0, no
       hay una base real desde la que calcular un porcentaje (sería
       "infinito"), así que se trata también como "Sin comparación" en vez
       de inventar un número. */
  function calcularCambioPorcentual(valorActual, valorAnterior) {
    if (valorAnterior === null || valorAnterior === undefined) return null;
    if (valorAnterior === 0) return valorActual === 0 ? 0 : null;
    return ((valorActual - valorAnterior) / valorAnterior) * 100;
  }

  /* Clasificación de progreso (SOLO lectura del rendimiento actual, nunca
     una recomendación: eso es PROG-02) según el cambio semanal del volumen
     promedio por sesión. Límites tal como los pidió el usuario:
       <0%            -> Caída
       0% a <2%       -> Mantenimiento
       2% a 5%        -> Progreso óptimo
       >5% a 8%       -> Progreso alto
       >8%            -> Salto agresivo */
  function clasificarProgreso(cambioPct) {
    if (cambioPct === null || cambioPct === undefined) return null;
    if (cambioPct < 0) return { nivel: "caida", emoji: "🔴", etiqueta: "Caída" };
    if (cambioPct < 2) return { nivel: "mantenimiento", emoji: "🟡", etiqueta: "Mantenimiento" };
    if (cambioPct <= 5) return { nivel: "optimo", emoji: "🟢", etiqueta: "Progreso óptimo" };
    if (cambioPct <= 8) return { nivel: "alto", emoji: "🔵", etiqueta: "Progreso alto" };
    return { nivel: "agresivo", emoji: "🟠", etiqueta: "Salto agresivo" };
  }

  /* Métricas de UNA semana para un BLOQUE (sección 2 del pedido). */
  function calcularMetricasSemanaBloque(sesionesSemana) {
    var cantidadSesiones = sesionesSemana.length;
    var volumenTotal = sesionesSemana.reduce(function (acc, s) { return acc + volumenSesionCompleta(s); }, 0);
    var volumenPromedioPorSesion = cantidadSesiones > 0 ? volumenTotal / cantidadSesiones : 0;
    var rpePromedio = promedioONull(sesionesSemana.map(function (s) { return typeof s.rpe === "number" ? s.rpe : null; }));
    return {
      cantidadSesiones: cantidadSesiones,
      volumenTotal: volumenTotal,
      volumenPromedioPorSesion: volumenPromedioPorSesion,
      rpePromedio: rpePromedio
    };
  }

  /* Métricas de UNA semana para un EJERCICIO (sección 3). A propósito sin
     rpePromedio: ver nota de RPE al principio de este bloque. */
  function calcularMetricasSemanaEjercicio(registrosSemana) {
    var cantidadSesiones = registrosSemana.length;
    var seriesTotales = 0;
    var repsTotales = 0;
    var pesoMaximo = 0;
    var volumenTotal = 0;

    registrosSemana.forEach(function (r) {
      (r.registro.series || []).forEach(function (serie) {
        var peso = Number(serie.peso_kg) || 0;
        var reps = Number(serie.reps) || 0;
        seriesTotales += 1;
        repsTotales += reps;
        volumenTotal += peso * reps;
        if (peso > pesoMaximo) pesoMaximo = peso;
      });
    });

    var volumenPromedioPorSesion = cantidadSesiones > 0 ? volumenTotal / cantidadSesiones : 0;

    return {
      cantidadSesiones: cantidadSesiones,
      seriesTotales: seriesTotales,
      repsTotales: repsTotales,
      pesoMaximo: pesoMaximo,
      volumenTotal: volumenTotal,
      volumenPromedioPorSesion: volumenPromedioPorSesion
    };
  }

  /* Agrega, a una serie semanal ASCENDENTE (ya con huecos rellenados por
     generarRangoSemanas), el cambio % vs la semana inmediatamente anterior
     y la tendencia de 3 semanas (promedio de los últimos 3 cambios, sección
     5). Si cualquiera de esas 3 últimas variaciones no existe todavía
     (menos de 3 semanas de historia comparable), la tendencia queda en
     null -> "Datos insuficientes". */
  function agregarCambiosYTendencia(serieAscendente, extractorValor) {
    var conCambios = serieAscendente.map(function (entrada, i) {
      var valorActual = extractorValor(entrada.datos);
      var valorAnterior = i > 0 ? extractorValor(serieAscendente[i - 1].datos) : null;
      var cambioPct = i > 0 ? calcularCambioPorcentual(valorActual, valorAnterior) : null;
      return {
        semana: entrada.semana,
        datos: entrada.datos,
        cambioPct: cambioPct
      };
    });

    conCambios.forEach(function (entrada, i) {
      var ultimasTres = conCambios.slice(Math.max(0, i - 2), i + 1);
      var tendencia = null;
      if (ultimasTres.length === 3 && ultimasTres.every(function (e) { return e.cambioPct !== null; })) {
        tendencia = ultimasTres.reduce(function (acc, e) { return acc + e.cambioPct; }, 0) / 3;
      }
      entrada.tendencia3 = tendencia;
    });

    return conCambios;
  }

  /* --- PROG-01.2: separar ADHERENCIA de RENDIMIENTO ---

     Problema que corrige: agregarCambiosYTendencia (arriba) compara cada
     semana contra la INMEDIATAMENTE ANTERIOR del arreglo que recibe. Si
     ese arreglo es la serie completa (con huecos en 0 para semanas sin
     sesión, generados por generarRangoSemanas), una semana todavía no
     entrenada -o una semana pasada que quedó en 0- termina comparándose
     contra un volumen 0 que nunca fue una sesión real, dando un falso
     -100% y una clasificación "Caída" que no mide nada.

     ADHERENCIA (¿se cumplió la frecuencia esperada?) y RENDIMIENTO (¿cómo
     varió el volumen entre sesiones reales?) son preguntas distintas:
     - ADHERENCIA sigue viéndose en la serie completa (con huecos), vía
       obtenerEstadoFrecuenciaSemanal y el historial semanal: una semana
       en 0 se muestra como "Pendiente esta semana" / "0/1 · No
       realizado", sin que eso desaparezca.
     - RENDIMIENTO (cambioPct, tendencia3, clasificación) se calcula
       SOLO sobre las semanas con cantidadSesiones > 0, en orden
       cronológico: dos sesiones reales separadas por una semana en 0 se
       comparan entre sí (la semana en 0 nunca entra como "0 kg"), y la
       tendencia de 3 ignora las semanas no realizadas. */
  function combinarAdherenciaYRendimiento(serieCompleta, extractorValor) {
    var realizadas = serieCompleta.filter(function (e) { return e.datos.cantidadSesiones > 0; });
    var realizadasConCambios = agregarCambiosYTendencia(realizadas, extractorValor);

    var mapaRendimiento = {};
    realizadasConCambios.forEach(function (e) { mapaRendimiento[e.semana] = e; });

    return serieCompleta.map(function (entrada) {
      var r = mapaRendimiento[entrada.semana];
      return {
        semana: entrada.semana,
        datos: entrada.datos,
        /* null (nunca -100% inventado) cuando la semana no fue realizada. */
        cambioPct: r ? r.cambioPct : null,
        tendencia3: r ? r.tendencia3 : null
      };
    });
  }

  /* Última semana con al menos 1 sesión real, recorriendo la serie de atrás
     para adelante. Se usa cuando la semana actual todavía está pendiente
     (sección 5 del pedido): el rendimiento que se muestra es el de la
     última sesión real, nunca el de una semana vacía. */
  function obtenerUltimaSemanaRealizada(serie) {
    for (var i = serie.length - 1; i >= 0; i--) {
      if (serie[i].datos.cantidadSesiones > 0) return serie[i];
    }
    return null;
  }

  /* --- Series semanales completas por bloque / por ejercicio --- */

  function construirSerieSemanalBloque(sesiones, bloqueId) {
    var sesionesBloque = sesiones.filter(function (s) { return s.tipo === "gimnasio" && s.dia_rutina_id === bloqueId; });
    if (!sesionesBloque.length) return [];

    var porSemana = {};
    sesionesBloque.forEach(function (s) {
      var semana = inicioDeSemanaISO(GYMAPP.util.fechaLocalISO(s.fecha));
      if (!porSemana[semana]) porSemana[semana] = [];
      porSemana[semana].push(s);
    });

    var semanasConDatos = Object.keys(porSemana).sort();
    var semanaActual = inicioDeSemanaISO(GYMAPP.util.fechaLocalISO(new Date()));
    var semanaFin = semanasConDatos[semanasConDatos.length - 1] > semanaActual
      ? semanasConDatos[semanasConDatos.length - 1]
      : semanaActual;

    var serieBase = generarRangoSemanas(semanasConDatos[0], semanaFin).map(function (semana) {
      return { semana: semana, datos: calcularMetricasSemanaBloque(porSemana[semana] || []) };
    });

    return combinarAdherenciaYRendimiento(serieBase, function (d) { return d.volumenPromedioPorSesion; });
  }

  function construirSerieSemanalEjercicio(sesiones, ejercicioId) {
    var porSemana = {};
    sesiones.forEach(function (s) {
      if (s.tipo !== "gimnasio") return;
      var registro = (s.ejercicios_realizados || []).filter(function (er) { return er.ejercicio_id === ejercicioId; })[0];
      if (!registro) return;
      var semana = inicioDeSemanaISO(GYMAPP.util.fechaLocalISO(s.fecha));
      if (!porSemana[semana]) porSemana[semana] = [];
      porSemana[semana].push({ sesion: s, registro: registro });
    });

    var semanasConDatos = Object.keys(porSemana).sort();
    if (!semanasConDatos.length) return [];

    var semanaActual = inicioDeSemanaISO(GYMAPP.util.fechaLocalISO(new Date()));
    var semanaFin = semanasConDatos[semanasConDatos.length - 1] > semanaActual
      ? semanasConDatos[semanasConDatos.length - 1]
      : semanaActual;

    var serieBase = generarRangoSemanas(semanasConDatos[0], semanaFin).map(function (semana) {
      return { semana: semana, datos: calcularMetricasSemanaEjercicio(porSemana[semana] || []) };
    });

    return combinarAdherenciaYRendimiento(serieBase, function (d) { return d.volumenPromedioPorSesion; });
  }

  /* --- Opciones de bloque/ejercicio para el análisis (incluyen históricos,
     sección 11: "un ejercicio o bloque histórico debe seguir analizándose
     aunque ya no esté activo en la rutina actual"). --- */

  function construirOpcionesBloquesAnalisis(data) {
    var mapa = {};
    data.rutina.dias.forEach(function (dia) { mapa[dia.id] = dia.nombre || "(sin nombre)"; });
    data.sesiones_entrenamiento.forEach(function (s) {
      if (s.tipo === "gimnasio" && s.dia_rutina_id && !mapa[s.dia_rutina_id]) {
        mapa[s.dia_rutina_id] = "Bloque eliminado de la rutina";
      }
    });
    return Object.keys(mapa).map(function (id) { return { id: id, nombre: mapa[id] }; });
  }

  function construirOpcionesEjerciciosDeBloque(data, bloqueId) {
    var mapa = {};
    var diaActual = data.rutina.dias.filter(function (d) { return d.id === bloqueId; })[0];
    if (diaActual) {
      diaActual.ejercicios.forEach(function (ej) { mapa[ej.id] = ej.nombre || "(sin nombre)"; });
    }
    data.sesiones_entrenamiento.forEach(function (s) {
      if (s.tipo !== "gimnasio" || s.dia_rutina_id !== bloqueId) return;
      (s.ejercicios_realizados || []).forEach(function (er) {
        if (!mapa[er.ejercicio_id]) mapa[er.ejercicio_id] = "Ejercicio eliminado de la rutina";
      });
    });
    return Object.keys(mapa).map(function (id) { return { id: id, nombre: mapa[id] }; });
  }

  /* --- Formateo (es-AR: punto de miles, coma decimal) --- */

  function formatearKg(n) {
    return Math.round(n).toLocaleString("es-AR") + " kg";
  }

  function formatearPct(n) {
    var signo = n > 0 ? "+" : "";
    return signo + n.toFixed(1).replace(".", ",") + "%";
  }

  function formatearRangoSemana(inicioISO) {
    var fin = finDeSemanaISO(inicioISO);
    var i = new Date(inicioISO + "T00:00:00");
    var f = new Date(fin + "T00:00:00");
    var formatoCorto = function (d) { return String(d.getDate()).padStart(2, "0") + "/" + String(d.getMonth() + 1).padStart(2, "0"); };
    return "Semana " + formatoCorto(i) + "–" + formatoCorto(f);
  }

  /* --- UI: sección "Análisis semanal" --- */

  function renderSeccionAnalisisSemanal(data) {
    var opcionesBloques = construirOpcionesBloquesAnalisis(data);

    if (!opcionesBloques.length) {
      return (
        '<div class="progreso-panel progreso-analisis-semanal">' +
        "<h3>Análisis semanal</h3>" +
        '<p class="nota">Todavía no hay sesiones de gimnasio para analizar por bloque.</p>' +
        "</div>"
      );
    }

    if (!estadoAnalisis.bloqueId || !opcionesBloques.some(function (o) { return o.id === estadoAnalisis.bloqueId; })) {
      estadoAnalisis.bloqueId = opcionesBloques[0].id;
      estadoAnalisis.ejercicioId = "";
    }

    var opcionesEjercicios = construirOpcionesEjerciciosDeBloque(data, estadoAnalisis.bloqueId);
    if (estadoAnalisis.ejercicioId && !opcionesEjercicios.some(function (o) { return o.id === estadoAnalisis.ejercicioId; })) {
      estadoAnalisis.ejercicioId = "";
    }

    var nombreBloque = opcionesBloques.filter(function (o) { return o.id === estadoAnalisis.bloqueId; })[0].nombre;
    var cuerpo;

    var esActivo = bloqueEsActivo(data, estadoAnalisis.bloqueId);

    if (estadoAnalisis.ejercicioId) {
      var nombreEjercicio = opcionesEjercicios.filter(function (o) { return o.id === estadoAnalisis.ejercicioId; })[0].nombre;
      var serieEjercicio = construirSerieSemanalEjercicio(data.sesiones_entrenamiento, estadoAnalisis.ejercicioId);
      cuerpo = renderAnalisisEjercicio(nombreEjercicio, serieEjercicio, esActivo);
    } else {
      var serieBloque = construirSerieSemanalBloque(data.sesiones_entrenamiento, estadoAnalisis.bloqueId);
      cuerpo = renderAnalisisBloque(nombreBloque, serieBloque, esActivo);
    }

    return (
      '<div class="progreso-panel progreso-analisis-semanal">' +
      "<h3>Análisis semanal</h3>" +
      renderSelectoresAnalisis(opcionesBloques, opcionesEjercicios) +
      cuerpo +
      "</div>"
    );
  }

  /* Reutiliza el mismo helper que Evolución (renderSelectorBloqueEjercicio,
     más arriba): misma jerarquía bloque -> ejercicio opcional, ids propios
     ("select-analisis-*") porque ambas secciones conviven en la pantalla. */
  function renderSelectoresAnalisis(opcionesBloques, opcionesEjercicios) {
    return renderSelectorBloqueEjercicio(
      "select-analisis-bloque", "select-analisis-ejercicio",
      opcionesBloques, opcionesEjercicios, estadoAnalisis.bloqueId, estadoAnalisis.ejercicioId
    );
  }

  /* Filas de volumen para la vista por BLOQUE (secciones 4 y 5). Con
     exactamente 1 sesión (el caso normal para un bloque 1x/semana),
     volumen_total y volumen_promedio_por_sesión son matemáticamente el
     mismo número: se muestran una sola vez como "Volumen de la sesión" en
     vez de duplicarlos. Con 0 o >1 sesión, sí tiene sentido mostrar los
     números por separado (sección 4: con >1 sesión, promedio/sesión vuelve
     a ser la métrica de comparación de rendimiento). */
  function filasVolumenBloque(datosSemana) {
    if (datosSemana.cantidadSesiones === 0) return [["Sesiones", "0"]];
    if (datosSemana.cantidadSesiones === 1) return [["Volumen de la sesión", formatearKg(datosSemana.volumenTotal)]];
    return [
      ["Sesiones", String(datosSemana.cantidadSesiones)],
      ["Volumen total", formatearKg(datosSemana.volumenTotal)],
      ["Promedio/sesión", formatearKg(datosSemana.volumenPromedioPorSesion)]
    ];
  }

  function filasVolumenEjercicio(datosSemana) {
    if (datosSemana.cantidadSesiones === 0) return [["Sesiones", "0"]];
    var filas = [
      ["Peso máximo", formatearKg(datosSemana.pesoMaximo)],
      ["Reps totales", String(datosSemana.repsTotales)]
    ];
    if (datosSemana.cantidadSesiones === 1) {
      filas.push(["Volumen de la sesión", formatearKg(datosSemana.volumenTotal)]);
    } else {
      filas.unshift(["Sesiones", String(datosSemana.cantidadSesiones)]);
      filas.push(["Volumen total", formatearKg(datosSemana.volumenTotal)]);
      filas.push(["Promedio/sesión", formatearKg(datosSemana.volumenPromedioPorSesion)]);
    }
    return filas;
  }

  /* PROG-01.2, sección 5: filas para la tarjeta cuando la semana ACTUAL
     está pendiente (0 sesiones) y se muestra en su lugar la última
     semana con sesiones reales. Reetiqueta "Volumen de la sesión" como
     "Última sesión" para que quede claro que no es la semana en curso. */
  function filasUltimaSemanaRealizadaBloque(datosSemana) {
    if (datosSemana.cantidadSesiones === 1) {
      return [["Última sesión", formatearKg(datosSemana.volumenTotal)]];
    }
    return [
      ["Última semana entrenada", datosSemana.cantidadSesiones + " sesiones"],
      ["Volumen total", formatearKg(datosSemana.volumenTotal)],
      ["Promedio/sesión", formatearKg(datosSemana.volumenPromedioPorSesion)]
    ];
  }

  function filasUltimaSemanaRealizadaEjercicio(datosSemana) {
    var filas = [
      ["Peso máximo", formatearKg(datosSemana.pesoMaximo)],
      ["Reps totales", String(datosSemana.repsTotales)]
    ];
    if (datosSemana.cantidadSesiones === 1) {
      filas.push(["Última sesión", formatearKg(datosSemana.volumenTotal)]);
    } else {
      filas.unshift(["Última semana entrenada", datosSemana.cantidadSesiones + " sesiones"]);
      filas.push(["Volumen total", formatearKg(datosSemana.volumenTotal)]);
      filas.push(["Promedio/sesión", formatearKg(datosSemana.volumenPromedioPorSesion)]);
    }
    return filas;
  }

  /* Con 1 sola sesión, "RPE promedio" es literal pero suena raro (es el
     RPE de esa única sesión): se etiqueta simplemente "RPE". */
  function filaRpe(datosSemana) {
    var etiqueta = datosSemana.cantidadSesiones === 1 ? "RPE" : "RPE promedio";
    return [etiqueta, datosSemana.rpePromedio !== null ? datosSemana.rpePromedio.toFixed(1).replace(".", ",") : "—"];
  }

  /* Historial (sección 6) para un bloque ACTIVO (frecuencia esperada
     conocida = 1): expresa cada semana como "N/esperadas", con ✓ cuando se
     cumplió exactamente, y "No realizado" cuando fue 0. */
  function extractorHistorialActivo(entrada) {
    var n = entrada.datos.cantidadSesiones;
    if (n === 0) return ["0/" + FRECUENCIA_ESPERADA_SEMANAL + " · No realizado"];
    if (n === FRECUENCIA_ESPERADA_SEMANAL) {
      return ["✓ " + n + "/" + FRECUENCIA_ESPERADA_SEMANAL + " sesión", formatearKg(entrada.datos.volumenTotal)];
    }
    return [n + "/" + FRECUENCIA_ESPERADA_SEMANAL + " sesiones", "promedio " + formatearKg(entrada.datos.volumenPromedioPorSesion) + "/sesión"];
  }

  /* Historial para un bloque HISTÓRICO (sin frecuencia esperada conocida):
     se mantiene el formato original, sin ninguna fracción "N/esperadas" ni
     lenguaje de "completado/pendiente" que supondría una cadencia que no
     podemos confirmar. */
  function extractorHistorialGenerico(entrada) {
    return [
      entrada.datos.cantidadSesiones === 1 ? "1 sesión" : entrada.datos.cantidadSesiones + " sesiones",
      formatearKg(entrada.datos.volumenPromedioPorSesion) + "/sesión"
    ];
  }

  function renderAnalisisBloque(nombreBloque, serie, esActivo) {
    if (!serie.length) {
      return '<p class="nota">Todavía no hay sesiones registradas para este bloque.</p>';
    }

    var actual = serie[serie.length - 1];
    var estadoFrecuencia = obtenerEstadoFrecuenciaSemanal(actual.datos.cantidadSesiones, esActivo);
    var cuerpo;

    if (actual.datos.cantidadSesiones > 0) {
      var clasificacion = clasificarProgreso(actual.cambioPct);
      var filas = filasVolumenBloque(actual.datos).concat([filaRpe(actual.datos)]);
      cuerpo = renderResumenSemanaActual(nombreBloque, actual, clasificacion, filas, estadoFrecuencia);
    } else {
      cuerpo = renderResumenUltimaRealizada(nombreBloque, actual, obtenerUltimaSemanaRealizada(serie), estadoFrecuencia, filasUltimaSemanaRealizadaBloque, filaRpe);
    }

    return cuerpo + renderHistorialSemanal(serie, esActivo ? extractorHistorialActivo : extractorHistorialGenerico);
  }

  function renderAnalisisEjercicio(nombreEjercicio, serie, esActivo) {
    if (!serie.length) {
      return '<p class="nota">Todavía no hay registros de este ejercicio.</p>';
    }

    var actual = serie[serie.length - 1];
    var estadoFrecuencia = obtenerEstadoFrecuenciaSemanal(actual.datos.cantidadSesiones, esActivo);
    var cuerpo;

    if (actual.datos.cantidadSesiones > 0) {
      var clasificacion = clasificarProgreso(actual.cambioPct);
      cuerpo = renderResumenSemanaActual(nombreEjercicio, actual, clasificacion, filasVolumenEjercicio(actual.datos), estadoFrecuencia);
    } else {
      cuerpo = renderResumenUltimaRealizada(nombreEjercicio, actual, obtenerUltimaSemanaRealizada(serie), estadoFrecuencia, filasUltimaSemanaRealizadaEjercicio, null);
    }

    return (
      cuerpo +
      '<p class="nota analisis-nota-rpe">El RPE se registra por sesión completa, no por ejercicio: por eso no se muestra acá.</p>' +
      renderHistorialSemanal(serie, esActivo ? extractorHistorialActivo : extractorHistorialGenerico)
    );
  }

  /* "Semana en curso" (PROG-01, ajuste mínimo): aclaración puramente de UX,
     no cambia ningún cálculo ni clasificación. `actual` es casi siempre la
     semana que contiene hoy (así se construye la serie), pero se verifica
     explícitamente por fecha en vez de asumir la posición en el array,
     para que el rótulo sea siempre correcto.
     PROG-01.1 separa esto del ESTADO del bloque (pendiente/completado/
     superior a lo planificado, ver obtenerEstadoFrecuenciaSemanal): ambas
     cosas son independientes y pueden ser verdad al mismo tiempo (ej.
     "Semana en curso" + "Sesión semanal completada ✓"). */
  function esSemanaEnCurso(semanaISO) {
    return semanaISO === inicioDeSemanaISO(GYMAPP.util.fechaLocalISO(new Date()));
  }

  function renderResumenSemanaActual(titulo, entradaActual, clasificacion, filas, estadoFrecuencia) {
    var etiquetaSemana = esSemanaEnCurso(entradaActual.semana) ? "Semana en curso" : formatearRangoSemana(entradaActual.semana);

    return (
      '<div class="analisis-semana-actual">' +
      '<h4 class="analisis-semana-actual-titulo">' + GYMAPP.util.escapeHtml(titulo) + " · " + etiquetaSemana + "</h4>" +
      (estadoFrecuencia
        ? '<p class="nota analisis-estado-frecuencia analisis-estado-frecuencia-' + estadoFrecuencia.tipo + '">' + estadoFrecuencia.texto + "</p>"
        : "") +
      '<div class="analisis-stats">' +
      filas.map(function (f) {
        return '<div class="analisis-stat"><span class="analisis-stat-label">' + f[0] + '</span><span class="analisis-stat-valor">' + f[1] + "</span></div>";
      }).join("") +
      '<div class="analisis-stat"><span class="analisis-stat-label">Cambio vs semana anterior</span><span class="analisis-stat-valor">' +
      (entradaActual.cambioPct === null ? "Sin comparación" : formatearPct(entradaActual.cambioPct)) +
      "</span></div>" +
      /* Tendencia 3 semanas (sección 7): es una métrica DESCRIPTIVA del
         comportamiento reciente, no un objetivo. Un salto puntual grande
         en una sola semana (ej. +19,5%) puede inflar este promedio muy por
         encima de lo sostenible; PROG-02 (recomendaciones) NO debe tomar
         este número como el % a aplicar la próxima semana. Acá solo se
         muestra como contexto, nunca como instrucción. */
      '<div class="analisis-stat"><span class="analisis-stat-label">Tendencia 3 semanas</span><span class="analisis-stat-valor">' +
      (entradaActual.tendencia3 === null ? "Datos insuficientes" : formatearPct(entradaActual.tendencia3) + "/sem") +
      "</span></div>" +
      "</div>" +
      (clasificacion
        ? '<div class="analisis-badge analisis-badge-' + clasificacion.nivel + '">' + clasificacion.emoji + " " + clasificacion.etiqueta + "</div>"
        : "") +
      "</div>"
    );
  }

  /* PROG-01.2, sección 5: cuando la semana actual está pendiente (0
     sesiones), no se "resetea" el rendimiento a 0/-100%: se muestra la
     última semana con sesiones reales (adherencia y rendimiento quedan
     así separados, sección 1-2 del pedido). `construirFilas` es
     filasUltimaSemanaRealizadaBloque/Ejercicio; `construirFilaRpe` es
     filaRpe para bloque, o null para ejercicio (nunca se inventa un RPE
     por ejercicio, ver nota al principio de este bloque de código). */
  function renderResumenUltimaRealizada(titulo, entradaActual, ultimaRealizada, estadoFrecuencia, construirFilas, construirFilaRpe) {
    var etiquetaSemanaActual = esSemanaEnCurso(entradaActual.semana) ? "Semana en curso" : formatearRangoSemana(entradaActual.semana);
    var encabezado =
      '<h4 class="analisis-semana-actual-titulo">' + GYMAPP.util.escapeHtml(titulo) + " · " + etiquetaSemanaActual + "</h4>" +
      (estadoFrecuencia
        ? '<p class="nota analisis-estado-frecuencia analisis-estado-frecuencia-' + estadoFrecuencia.tipo + '">' + estadoFrecuencia.texto + "</p>"
        : "");

    /* No debería ocurrir si serie.length > 0 (construirSerieSemanalBloque/
       Ejercicio ya garantizan al menos una sesión real para llegar hasta
       acá), pero se cubre por seguridad en vez de asumirlo. */
    if (!ultimaRealizada) {
      return '<div class="analisis-semana-actual">' + encabezado + '<p class="nota">Sin comparación</p></div>';
    }

    var clasificacion = clasificarProgreso(ultimaRealizada.cambioPct);
    var filas = construirFilas(ultimaRealizada.datos);
    if (construirFilaRpe) filas = filas.concat([construirFilaRpe(ultimaRealizada.datos)]);

    return (
      '<div class="analisis-semana-actual">' +
      encabezado +
      '<p class="nota analisis-ultima-realizada">Último rendimiento real: ' + formatearRangoSemana(ultimaRealizada.semana) + ".</p>" +
      '<div class="analisis-stats">' +
      filas.map(function (f) {
        return '<div class="analisis-stat"><span class="analisis-stat-label">' + f[0] + '</span><span class="analisis-stat-valor">' + f[1] + "</span></div>";
      }).join("") +
      '<div class="analisis-stat"><span class="analisis-stat-label">Último cambio</span><span class="analisis-stat-valor">' +
      (ultimaRealizada.cambioPct === null ? "Sin comparación" : formatearPct(ultimaRealizada.cambioPct)) +
      "</span></div>" +
      '<div class="analisis-stat"><span class="analisis-stat-label">Tendencia 3 sesiones</span><span class="analisis-stat-valor">' +
      (ultimaRealizada.tendencia3 === null ? "Datos insuficientes" : formatearPct(ultimaRealizada.tendencia3) + "/sem") +
      "</span></div>" +
      "</div>" +
      (clasificacion
        ? '<div class="analisis-badge analisis-badge-' + clasificacion.nivel + '">' + clasificacion.emoji + " " + clasificacion.etiqueta + "</div>"
        : "") +
      "</div>"
    );
  }

  /* Historial semanal (sección 8): lista vertical mobile-first, más
     reciente primero. Se limita a las últimas 8 semanas para no volverse
     una lista interminable de semanas en 0 en rutinas muy viejas; el
     cálculo de cambio/tendencia ya usa la serie completa de todas formas,
     este límite es solo de visualización. */
  function renderHistorialSemanal(serie, extractorFilas) {
    var ultimasOcho = serie.slice(-8).reverse();
    return (
      '<div class="analisis-historial-titulo">Historial semanal</div>' +
      '<div class="analisis-historial-lista">' +
      ultimasOcho.map(function (entrada) {
        var filas = extractorFilas(entrada);
        return (
          '<div class="analisis-historial-item">' +
          '<span class="analisis-historial-semana">' + formatearRangoSemana(entrada.semana) + "</span>" +
          '<span class="analisis-historial-detalle">' + filas.join(" · ") + "</span>" +
          '<span class="analisis-historial-cambio">' + formatearCambioHistorial(entrada) + "</span>" +
          "</div>"
        );
      }).join("") +
      "</div>"
    );
  }

  /* PROG-01.2, sección 6: una semana con 0 sesiones nunca muestra un
     cambio de rendimiento (nunca -100%, nunca "Caída"): no hay ninguna
     sesión real contra la cual medir nada. Se distingue a propósito de
     "Sin comparación" (que es un cambioPct real = null porque todavía no
     hay semana anterior realizada, por ejemplo la primera sesión de la
     historia) usando un guión en vez de esa frase, para no mezclar "no
     hay dato" con "no se entrenó esta semana". */
  function formatearCambioHistorial(entrada) {
    if (entrada.datos.cantidadSesiones === 0) return "—";
    return entrada.cambioPct === null ? "Sin comparación" : formatearPct(entrada.cambioPct);
  }

  /* --- Calendario (sección) --- */

  function renderSeccionCalendario(data) {
    return '<div class="progreso-panel"><h3>Calendario</h3>' + renderCalendario(data) + "</div>";
  }

  /* --- Historial accesible ---
     Vista compacta de solo lectura de las últimas sesiones. Editar y
     eliminar sigue viviendo exclusivamente en Entrenar (PRO-03): acá solo
     se muestra un resumen y un acceso directo, para no duplicar esa lógica. */

  function renderSeccionHistorialAccesible(sesiones) {
    var recientes = sesiones
      .slice()
      .sort(function (a, b) { return new Date(b.fecha) - new Date(a.fecha); })
      .slice(0, 3);

    var lista = recientes.length
      ? '<div class="progreso-historial-lista">' + recientes.map(renderItemHistorialCompacto).join("") + "</div>"
      : '<p class="nota">Todavía no registraste ninguna sesión.</p>';

    return (
      '<div class="progreso-panel">' +
      "<h3>Historial</h3>" +
      lista +
      '<button type="button" data-accion="ver-historial-completo" class="btn btn-secundario btn-ancho">Ver y editar historial completo</button>' +
      "</div>"
    );
  }

  /* ACT-04: usa el catálogo dinámico (icono + nombre real de sesion.tipo) en
     vez de asumir gimnasio/fútbol. Un tipo histórico que ya no está en el
     catálogo (dato viejo/corrupto) cae en un fallback legible en vez de
     romper el render. */
  function renderItemHistorialCompacto(sesion) {
    var fechaLegible = formatearFechaLegible(new Date(GYMAPP.util.fechaLocalISO(sesion.fecha) + "T00:00:00"));
    var actividad = GYMAPP.actividades.obtenerActividadPorId(sesion.tipo);
    var resumen = actividad ? actividad.icono + " " + actividad.nombre : "🏃 " + GYMAPP.util.escapeHtml(sesion.tipo || "Actividad");

    return (
      '<div class="progreso-historial-item">' +
      '<span class="historial-item-fecha">' + fechaLegible + "</span>" +
      '<span class="historial-item-resumen">' + resumen + "</span>" +
      "</div>"
    );
  }

  /* --- Calendario mensual --- */

  function inicioDeMes(date) {
    return new Date(date.getFullYear(), date.getMonth(), 1);
  }

  /* Lunes=0 ... Domingo=6, a diferencia de Date#getDay() que arranca en domingo. */
  function diaDeSemanaLunesPrimero(date) {
    return (date.getDay() + 6) % 7;
  }

  function formatearMesLabel(date) {
    var texto = date.toLocaleDateString("es-AR", { month: "long", year: "numeric" });
    return texto.charAt(0).toUpperCase() + texto.slice(1);
  }

  function construirGrillaMes(mes) {
    var primerDiaMes = new Date(mes.getFullYear(), mes.getMonth(), 1);
    var ultimoDiaMes = new Date(mes.getFullYear(), mes.getMonth() + 1, 0);
    var offsetInicio = diaDeSemanaLunesPrimero(primerDiaMes);
    var offsetFin = (7 - (diaDeSemanaLunesPrimero(ultimoDiaMes) + 1)) % 7;

    var celdas = [];
    for (var i = 0; i < offsetInicio; i++) celdas.push(null);
    for (var d = 1; d <= ultimoDiaMes.getDate(); d++) celdas.push(new Date(mes.getFullYear(), mes.getMonth(), d));
    for (var j = 0; j < offsetFin; j++) celdas.push(null);
    return celdas;
  }

  /* ACT-04: reemplaza el modelo cerrado gimnasio/fútbol/ambos por un mapa
     genérico de N actividades por día (compartido con dashboard.js, ver
     GYMAPP.actividades.obtenerActividadesPorDia). Cada celda muestra un
     badge de color por actividad realizada ese día (nunca uno por sesión:
     el mapa ya dedupe por tipo). La leyenda es dinámica: actividades
     actualmente configuradas + cualquier tipo que aparezca en el historial
     mostrado, así que una actividad desactivada con partidos viejos sigue
     apareciendo tanto en el calendario como en la leyenda. */
  function renderCalendario(data) {
    var sesiones = data.sesiones_entrenamiento;
    var mapaDias = GYMAPP.actividades.obtenerActividadesPorDia(sesiones);
    var hoyIso = formatearFechaISO(new Date());
    var celdas = construirGrillaMes(estado.mesActual);
    var actividadesUsuario = GYMAPP.actividades.obtenerActividadesUsuario(data.usuario);
    var actividadesLeyenda = construirActividadesParaLeyenda(sesiones, actividadesUsuario);

    return (
      '<div class="calendario-header">' +
      '<button type="button" data-accion="mes-anterior" class="btn-icono" aria-label="Mes anterior">‹</button>' +
      '<span class="calendario-mes-label">' + formatearMesLabel(estado.mesActual) + "</span>" +
      '<button type="button" data-accion="mes-siguiente" class="btn-icono" aria-label="Mes siguiente">›</button>' +
      "</div>" +
      '<div class="calendario-grid">' +
      DIAS_SEMANA.map(function (d) { return '<span class="calendario-dia-semana">' + d + "</span>"; }).join("") +
      celdas.map(function (fecha) { return renderCeldaCalendario(fecha, mapaDias, hoyIso); }).join("") +
      "</div>" +
      renderLeyendaCalendario(actividadesLeyenda)
    );
  }

  function renderCeldaCalendario(fecha, mapaDias, hoyIso) {
    if (!fecha) return '<span class="calendario-dia vacio"></span>';

    var key = formatearFechaISO(fecha);
    var tipos = mapaDias[key] || [];
    var clase = tipos.length ? " con-actividad" : "";
    if (key === hoyIso) clase += " hoy";

    var etiqueta = tipos.length ? etiquetaEstado(tipos) : "sin entrenamiento";
    var titulo = formatearFechaLegible(fecha) + " · " + etiqueta;

    return (
      '<span class="calendario-dia' + clase + '" title="' + GYMAPP.util.escapeHtml(titulo) + '">' +
      '<span class="calendario-dia-numero">' + fecha.getDate() + "</span>" +
      GYMAPP.actividades.renderBadgesActividad(tipos) +
      "</span>"
    );
  }

  /* Actividades a listar en la leyenda: las configuradas actualmente, más
     cualquier tipo que aparezca en las sesiones mostradas (para no ocultar
     una actividad ya desactivada que tiene historial). Se devuelven en
     orden de catálogo; un tipo que ya no exista en el catálogo no genera
     entrada de leyenda (pero sigue viéndose como badge en el calendario). */
  function construirActividadesParaLeyenda(sesiones, actividadesUsuario) {
    var tipos = {};
    actividadesUsuario.forEach(function (a) { tipos[a.tipo] = true; });
    sesiones.forEach(function (s) { if (s && s.tipo) tipos[s.tipo] = true; });
    return GYMAPP.actividades.obtenerCatalogo().filter(function (a) { return tipos[a.id]; });
  }

  function renderLeyendaCalendario(actividadesLeyenda) {
    return (
      '<div class="heatmap-leyenda">' +
      leyendaItem(null, "Sin entrenar") +
      actividadesLeyenda.map(function (a) { return leyendaItem(a, a.icono + " " + a.nombre); }).join("") +
      "</div>"
    );
  }

  function leyendaItem(actividad, etiqueta) {
    var color = actividad ? actividad.color : "var(--color-borde)";
    return (
      '<span class="heatmap-leyenda-item"><span class="heatmap-leyenda-swatch" style="background-color:' + color + '"></span>' +
      etiqueta + "</span>"
    );
  }

  /* Título legible del día para el tooltip (title=), generalizado a N
     actividades: 1 sola devuelve su nombre, 2+ las concatena con comas y un
     "y" final (ej. "Gimnasio, Pádel y Natación"), igual criterio que ya
     usaba esta pantalla para "Gimnasio y fútbol". */
  function etiquetaEstado(tipos) {
    var nombres = tipos.map(function (t) {
      var a = GYMAPP.actividades.obtenerActividadPorId(t);
      return a ? a.nombre : t;
    });
    if (nombres.length === 1) return nombres[0];
    return nombres.slice(0, -1).join(", ") + " y " + nombres[nombres.length - 1];
  }

  function formatearFechaISO(date) {
    var y = date.getFullYear();
    var m = String(date.getMonth() + 1).padStart(2, "0");
    var d = String(date.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + d;
  }

  function formatearFechaLegible(date) {
    return date.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
  }

  /* --- Rachas ---
     Tres cálculos distintos, que no deben mezclarse:
     - días activos: fechas calendario únicas con al menos una sesión (gimnasio
       y fútbol el mismo día cuentan como un solo día activo).
     - cantidad de sesiones: total de registros en sesiones_entrenamiento (se
       calcula aparte, ver dashboard.js calcularResumenSemanal).
     - racha consecutiva: se deriva de los días activos, nunca de la cantidad
       de sesiones. */

  function obtenerDiasActivosOrdenados(sesiones) {
    return Object.keys(GYMAPP.actividades.obtenerActividadesPorDia(sesiones)).sort();
  }

  /* Recibe días activos ÚNICOS ya ordenados (ver obtenerDiasActivosOrdenados).
     racha máxima: mayor cantidad de días activos consecutivos en todo el
     historial. racha actual: la racha vigente hoy, contemplando que si el
     último día activo fue ayer, la racha sigue viva (todavía no venció el
     día de hoy); si el último día activo fue antes de ayer, se cortó. */
  function calcularRachas(diasActivosOrdenados) {
    if (!diasActivosOrdenados.length) return { actual: 0, maxima: 0 };

    var maxima = 1;
    var rachaEnCurso = 1;

    for (var i = 1; i < diasActivosOrdenados.length; i++) {
      var anterior = new Date(diasActivosOrdenados[i - 1] + "T00:00:00");
      var actual = new Date(diasActivosOrdenados[i] + "T00:00:00");
      var diffDias = Math.round((actual - anterior) / 86400000);
      rachaEnCurso = diffDias === 1 ? rachaEnCurso + 1 : 1;
      if (rachaEnCurso > maxima) maxima = rachaEnCurso;
    }

    var hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    var ultimoDiaActivo = new Date(diasActivosOrdenados[diasActivosOrdenados.length - 1] + "T00:00:00");
    var diasDesdeUltimoDiaActivo = Math.round((hoy - ultimoDiaActivo) / 86400000);
    var rachaActual = diasDesdeUltimoDiaActivo <= 1 ? rachaEnCurso : 0;

    return { actual: rachaActual, maxima: maxima };
  }

  /* --- Gráfico por ejercicio --- */

  function obtenerSerieEjercicio(sesiones, ejercicioId, metrica) {
    var relevantes = sesiones
      .filter(function (s) {
        return s.tipo === "gimnasio" && s.ejercicios_realizados && s.ejercicios_realizados.some(function (e) {
          return e.ejercicio_id === ejercicioId;
        });
      })
      .sort(function (a, b) { return new Date(a.fecha) - new Date(b.fecha); });

    return relevantes.map(function (s) {
      var registro = s.ejercicios_realizados.filter(function (e) { return e.ejercicio_id === ejercicioId; })[0];
      var valor;
      if (metrica === "peso_maximo") {
        valor = registro.series.reduce(function (max, serie) { return Math.max(max, serie.peso_kg); }, 0);
      } else if (metrica === "repeticiones") {
        valor = registro.series.reduce(function (acc, serie) { return acc + serie.reps; }, 0);
      } else {
        valor = registro.series.reduce(function (acc, serie) { return acc + serie.peso_kg * serie.reps; }, 0);
      }
      return { fecha: s.fecha, valor: valor };
    });
  }

  /* Igual criterio que obtenerSerieEjercicio, pero agregando TODAS las
     series de TODOS los ejercicios realizados en la sesión (no solo uno),
     ya que la vista por día busca la evolución global de ese día. */
  function obtenerSerieDia(sesiones, diaId, metrica) {
    var relevantes = sesiones
      .filter(function (s) { return s.tipo === "gimnasio" && s.dia_rutina_id === diaId; })
      .sort(function (a, b) { return new Date(a.fecha) - new Date(b.fecha); });

    return relevantes.map(function (s) {
      var series = (s.ejercicios_realizados || []).reduce(function (acc, er) {
        return acc.concat(er.series || []);
      }, []);
      var valor;
      if (metrica === "peso_maximo") {
        valor = series.reduce(function (max, serie) { return Math.max(max, serie.peso_kg); }, 0);
      } else if (metrica === "repeticiones") {
        valor = series.reduce(function (acc, serie) { return acc + serie.reps; }, 0);
      } else {
        valor = series.reduce(function (acc, serie) { return acc + serie.peso_kg * serie.reps; }, 0);
      }
      return { fecha: s.fecha, valor: valor };
    });
  }

  function formatearFechaCorta(fechaISO) {
    var d = new Date(fechaISO);
    return String(d.getDate()).padStart(2, "0") + "/" + String(d.getMonth() + 1).padStart(2, "0");
  }

  var ETIQUETAS_METRICA = {
    peso_maximo: "Peso máximo (kg)",
    repeticiones: "Repeticiones totales",
    volumen_total: "Volumen total (kg)"
  };

  function dibujarGrafico(container, data) {
    var canvas = container.querySelector("#grafico-progreso");
    if (!canvas) return;
    var vacioEl = container.querySelector("#progreso-grafico-vacio");
    var infoEl = container.querySelector("#progreso-dia-info");

    var puntos = estado.ejercicioId
      ? obtenerSerieEjercicio(data.sesiones_entrenamiento, estado.ejercicioId, estado.metrica)
      : obtenerSerieDia(data.sesiones_entrenamiento, estado.bloqueId, estado.metrica);

    if (!puntos.length) {
      canvas.style.display = "none";
      if (vacioEl) vacioEl.classList.remove("oculto");
      if (infoEl) infoEl.classList.add("oculto");
      return;
    }

    canvas.style.display = "";
    if (vacioEl) vacioEl.classList.add("oculto");
    if (infoEl) {
      infoEl.textContent = puntos.length === 1
        ? "1 sesión registrada para este día."
        : puntos.length + " sesiones registradas para este día.";
      infoEl.classList.remove("oculto");
    }

    var labels = puntos.map(function (p) { return formatearFechaCorta(p.fecha); });
    var valores = puntos.map(function (p) { return p.valor; });
    var etiqueta = ETIQUETAS_METRICA[estado.metrica] || ETIQUETAS_METRICA.peso_maximo;

    GYMAPP.graficos.graficoLinea(canvas, labels, valores, etiqueta);
  }

  /* --- Eventos --- */

  function bindEventos(container) {
    container.addEventListener("change", function (ev) {
      if (ev.target.id === "select-evolucion-bloque") {
        estado.bloqueId = ev.target.value;
        estado.ejercicioId = "";
        estado.metrica = "volumen_total";
        render(container);
      } else if (ev.target.id === "select-evolucion-ejercicio") {
        estado.ejercicioId = ev.target.value;
        if (!estado.ejercicioId) estado.metrica = "volumen_total";
        render(container);
      } else if (ev.target.id === "select-analisis-bloque") {
        estadoAnalisis.bloqueId = ev.target.value;
        estadoAnalisis.ejercicioId = "";
        render(container);
      } else if (ev.target.id === "select-analisis-ejercicio") {
        estadoAnalisis.ejercicioId = ev.target.value;
        render(container);
      }
    });

    container.addEventListener("click", function (ev) {
      var boton = ev.target.closest("[data-accion]");
      if (!boton) return;
      var accion = boton.dataset.accion;

      if (accion === "set-metrica") {
        estado.metrica = boton.dataset.metrica;
      } else if (accion === "mes-anterior") {
        estado.mesActual = new Date(estado.mesActual.getFullYear(), estado.mesActual.getMonth() - 1, 1);
      } else if (accion === "mes-siguiente") {
        estado.mesActual = new Date(estado.mesActual.getFullYear(), estado.mesActual.getMonth() + 1, 1);
      } else if (accion === "ver-historial-completo") {
        /* El historial editable vive en Entrenar (PRO-03); acá solo
           enlazamos a esa pestaña en vez de duplicar esa lógica. */
        var navEntrenar = document.getElementById("nav-entrenar");
        if (navEntrenar) navEntrenar.click();
        return;
      } else {
        return;
      }
      render(container);
    });
  }

  return {
    render: render,
    /* Expuestas para pruebas unitarias de cálculo de días activos y racha. */
    obtenerDiasActivosOrdenados: obtenerDiasActivosOrdenados,
    calcularRachas: calcularRachas,
    /* PROG-01: expuestas para pruebas unitarias de cálculo puro, sin DOM. */
    inicioDeSemanaISO: inicioDeSemanaISO,
    finDeSemanaISO: finDeSemanaISO,
    generarRangoSemanas: generarRangoSemanas,
    volumenSesionCompleta: volumenSesionCompleta,
    calcularCambioPorcentual: calcularCambioPorcentual,
    clasificarProgreso: clasificarProgreso,
    calcularMetricasSemanaBloque: calcularMetricasSemanaBloque,
    calcularMetricasSemanaEjercicio: calcularMetricasSemanaEjercicio,
    agregarCambiosYTendencia: agregarCambiosYTendencia,
    construirSerieSemanalBloque: construirSerieSemanalBloque,
    construirSerieSemanalEjercicio: construirSerieSemanalEjercicio,
    construirOpcionesBloquesAnalisis: construirOpcionesBloquesAnalisis,
    construirOpcionesEjerciciosDeBloque: construirOpcionesEjerciciosDeBloque,
    esSemanaEnCurso: esSemanaEnCurso,
    /* PROG-01.1: expuestas para pruebas unitarias de cálculo puro. */
    bloqueEsActivo: bloqueEsActivo,
    obtenerEstadoFrecuenciaSemanal: obtenerEstadoFrecuenciaSemanal,
    filasVolumenBloque: filasVolumenBloque,
    filasVolumenEjercicio: filasVolumenEjercicio,
    /* PROG-01.2: expuestas para pruebas unitarias de cálculo puro. */
    combinarAdherenciaYRendimiento: combinarAdherenciaYRendimiento,
    obtenerUltimaSemanaRealizada: obtenerUltimaSemanaRealizada,
    filasUltimaSemanaRealizadaBloque: filasUltimaSemanaRealizadaBloque,
    filasUltimaSemanaRealizadaEjercicio: filasUltimaSemanaRealizadaEjercicio,
    formatearCambioHistorial: formatearCambioHistorial
  };
})();
