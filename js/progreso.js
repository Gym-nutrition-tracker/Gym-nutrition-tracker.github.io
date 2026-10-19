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
    /* PROG-04: la fecha de hoy se resuelve acá (render), nunca dentro de
       la función pura de decisión. */
    var estadoPlan = calcularEstadoPlan(construirInputEstadoPlan(data, GYMAPP.util.fechaLocalISO(new Date())));

    return (
      '<div class="pantalla pantalla-progreso">' +
      "<h2>Progreso</h2>" +
      renderResumenGeneral(sesiones, rachas) +
      '<div class="progreso-layout">' +
      '<div class="progreso-columna-principal">' +
      renderSeccionEvolucion(opcionesBloquesEvolucion, opcionesEjerciciosEvolucion) +
      renderSeccionEstadoPlan(estadoPlan) +
      renderSeccionAnalisisSemanal(data) +
      renderSeccionProximaSesion(data, estadoPlan) +
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

  /* Cantidad de semanas REALIZADAS (cantidadSesiones > 0) en toda la serie.
     Es el dato de "cantidad de sesiones reales disponibles" que usa PROG-02
     para decidir el nivel de confianza (sección 2): no se cuentan sesiones
     individuales sueltas, sino semanas con al menos una sesión real, que
     es la misma unidad que ya usan ultimoCambio/tendencia3. */
  function contarSemanasRealizadas(serie) {
    return serie.filter(function (e) { return e.datos.cantidadSesiones > 0; }).length;
  }

  /* PROG-02, sección 8: adherencia baja = 2 o más semanas "0/1 · No
     realizado" entre las últimas 3 semanas YA CERRADAS (nunca la semana
     actual, que todavía puede completarse). Esto NUNCA se clasifica como
     caída de rendimiento: solo limita el techo de la recomendación más
     abajo (aplicarLimiteAdherencia) y agrega una advertencia aparte. */
  function calcularAdherenciaBaja(serie) {
    var cerradas = serie.slice(0, -1).slice(-3);
    var noRealizadas = cerradas.filter(function (e) { return e.datos.cantidadSesiones === 0; }).length;
    return noRealizadas >= 2;
  }

  /* --- PROG-02: motor de recomendación para la próxima sesión ---

     Alcance: función PURA, sin DOM ni storage, que NO reimplementa ni
     modifica ninguna fórmula de PROG-01/01.1/01.2 (usa sus resultados ya
     calculados como entrada: último cambio real, tendencia de 3 cambios
     reales, RPE, volumen de la última sesión realizada, cantidad de
     semanas realizadas). Devuelve SIEMPRE UN RANGO %, nunca un número
     exacto, y nunca persiste ni edita nada: es una sugerencia de lectura,
     no una orden (sección 14). */

  var CONFIANZA_SIN_DATOS = "insuficiente";
  var CONFIANZA_INICIAL = "inicial";
  var CONFIANZA_NORMAL = "normal";

  /* Reglas base de progresión (sección 3): categoría según el ÚLTIMO
     CAMBIO REAL (mismos límites que clasificarProgreso, para que la
     categoría de la recomendación sea consistente con el badge de
     "Análisis semanal") y rama según el RPE REAL (nunca se llega acá sin
     un RPE real: ver reglaBaseSinRpe para cuando no existe). */
  function reglaBase(ultimoCambio, rpe) {
    if (ultimoCambio < 0) {
      if (rpe >= 8) {
        return { min: -5, max: 0, estado: "Recuperar / consolidar", motivo: "El rendimiento bajó y el esfuerzo de la última sesión ya fue alto: priorizá recuperarte antes de buscar más carga." };
      }
      return { min: 0, max: 2, estado: "Recuperar rendimiento", motivo: "El rendimiento bajó, pero el esfuerzo de la última sesión todavía deja algo de margen: buscá recuperar el nivel anterior." };
    }
    if (ultimoCambio < 2) {
      if (rpe <= 7) {
        return { min: 3, max: 5, estado: "Margen para progresar", motivo: "Venís manteniendo el rendimiento y el esfuerzo de la última sesión fue bajo: hay margen real para progresar." };
      }
      if (rpe < 9) {
        return { min: 1, max: 3, estado: "Progresión moderada", motivo: "Venís manteniendo el rendimiento y el esfuerzo de la última sesión fue moderado-alto: conviene progresar de forma gradual." };
      }
      return { min: 0, max: 0, estado: "Mantener", motivo: "El esfuerzo de la última sesión fue muy alto: por ahora conviene mantener el nivel actual." };
    }
    if (ultimoCambio <= 5) {
      if (rpe <= 7) {
        return { min: 3, max: 5, estado: "Progreso óptimo", motivo: "Venís progresando a buen ritmo y el esfuerzo de la última sesión fue bajo: el margen para seguir avanzando es real." };
      }
      if (rpe < 9) {
        return { min: 1, max: 3, estado: "Progresión moderada", motivo: "Venís progresando, pero el esfuerzo de la última sesión fue moderado-alto: conviene avanzar de forma gradual." };
      }
      return { min: 0, max: 1, estado: "Consolidar", motivo: "Venís progresando, pero el esfuerzo de la última sesión fue muy alto: conviene consolidar antes de seguir subiendo." };
    }
    if (ultimoCambio <= 8) {
      if (rpe <= 7) {
        return { min: 0, max: 2, estado: "Consolidar progreso", motivo: "El último salto de rendimiento fue alto y el esfuerzo todavía deja algo de margen: conviene consolidar antes de seguir subiendo fuerte." };
      }
      return { min: 0, max: 0, estado: "Mantener", motivo: "El último salto de rendimiento fue alto y el esfuerzo también fue alto: por ahora conviene mantener el nivel actual." };
    }
    // ultimoCambio > 8: nunca recomendar otro salto agresivo inmediatamente.
    if (rpe >= 8) {
      return { min: 0, max: 0, estado: "Consolidar salto previo", motivo: "Venís de un salto de rendimiento muy grande: nunca conviene repetir un salto así de inmediato, así que toca consolidar." };
    }
    return { min: 0, max: 2, estado: "Consolidar salto previo", motivo: "Venís de un salto de rendimiento muy grande: nunca conviene repetir un salto así de inmediato, así que toca ir despacio." };
  }

  /* Ajuste 1 del pedido: SIN RPE no se usa ningún proxy numérico (nunca
     se inventa un RPE real, ni siquiera internamente). En su lugar, un
     fallback orientativo basado SOLO en el último cambio real, siempre
     conservador y siempre no-negativo (una caída de rendimiento sin dato
     de esfuerzo no autoriza a recomendar menos volumen, solo a frenar la
     progresión). Después se aplican tendencia y adherencia exactamente
     igual que con RPE conocido. */
  function reglaBaseSinRpe(ultimoCambio) {
    if (ultimoCambio < 0) {
      return { min: 0, max: 1, estado: "Recuperar rendimiento", motivo: "El rendimiento bajó y no tenemos el esfuerzo de la última sesión: conviene ser conservador y priorizar recuperarte." };
    }
    if (ultimoCambio < 2) {
      return { min: 1, max: 3, estado: "Progresión moderada", motivo: "Venís manteniendo el rendimiento; sin el esfuerzo de la última sesión, conviene progresar con cautela." };
    }
    if (ultimoCambio <= 5) {
      return { min: 1, max: 3, estado: "Progresión moderada", motivo: "Venís progresando; sin el esfuerzo de la última sesión, conviene avanzar con cautela." };
    }
    if (ultimoCambio <= 8) {
      return { min: 0, max: 1, estado: "Consolidar progreso", motivo: "El último salto de rendimiento fue alto; sin el esfuerzo de la última sesión, conviene consolidar." };
    }
    return { min: 0, max: 0, estado: "Consolidar salto previo", motivo: "Venís de un salto de rendimiento muy grande: nunca conviene repetir un salto así de inmediato, así que toca consolidar." };
  }

  /* Ajuste 2 del pedido + sección 4 original: la tendencia es un
     MODIFICADOR del rango base, nunca un objetivo en sí misma (nunca
     "tendencia +8,5% -> subir +8,5%"). Mismo ajuste mecánico para ambos
     extremos (techo -2, piso -1) tanto si la tendencia viene muy alta
     como si viene negativa; entre 0% y +8% no se ajusta nada; sin
     tendencia (insuficientes datos) no se inventa, tampoco se ajusta.

     `piso` es el límite inferior de la categoría (0 en casi todas; -10
     solo en la rama de rendimiento en caída con RPE real). La resta
     mecánica nunca baja de ese piso, PERO si el rango base tenía margen
     real por encima del piso (max > piso) y la resta lo deja pegado al
     piso, se conserva al menos 1 punto de ventana en vez de aplanarlo
     del todo: así un rango angosto como 0% a +2% con tendencia muy alta
     queda en 0% a +1% (no en 0% a 0%, que es literalmente "Mantener" y
     significaría otra cosa), y un rango amplio como +3% a +5% sigue
     dando ~+2% a +3%, igual que antes de este ajuste. */
  function ajustarPorTendencia(min, max, tendencia3, piso) {
    if (tendencia3 === null || tendencia3 === undefined) {
      return { min: min, max: max, notaTendencia: null };
    }
    if (!(tendencia3 > 8) && !(tendencia3 < 0)) {
      return { min: min, max: max, notaTendencia: null };
    }

    var maxAjustado = Math.max(max - 2, piso);
    var minAjustado = Math.max(min - 1, piso);
    if (max > piso && maxAjustado <= piso) maxAjustado = piso + 1;
    if (minAjustado > maxAjustado) minAjustado = maxAjustado;

    var nota = tendencia3 > 8
      ? "Venís acumulando progresos rápidos; conviene consolidar."
      : "La tendencia reciente viene a la baja: conviene ser más conservador.";
    return { min: minAjustado, max: maxAjustado, notaTendencia: nota };
  }

  /* Límites de seguridad (secciones 4 y 14): nunca más de +5% como
     objetivo normal, nunca menos que el piso de la categoría. */
  function clampRango(min, max, piso) {
    var minClamp = Math.max(min, piso);
    var maxClamp = Math.min(max, 5);
    if (minClamp > maxClamp) minClamp = maxClamp;
    return { min: minClamp, max: maxClamp };
  }

  /* Estrategia de "cómo progresar" (sección 7): prioridad repeticiones >
     carga > series, basada en el RPE real, con un último cambio >8% como
     override (nunca conviene otro salto agresivo, sea cual sea el RPE) y
     una rama propia sin inventar esfuerzo cuando no hay RPE disponible.
     Las series NUNCA se sugieren como primera opción: solo se mencionan
     aparte, como alternativa de último recurso. */
  function obtenerAccionSugerida(rpe, ultimoCambio, rpeDisponible) {
    if (ultimoCambio > 8) {
      return { corta: "Consolidar antes de aumentar", larga: "Consolidá el nivel actual antes de volver a aumentar." };
    }
    if (!rpeDisponible) {
      return { corta: "Ajuste mínimo", larga: "Sin el esfuerzo de la última sesión, probá una mejora pequeña (1 repetición extra o un aumento mínimo de carga) y prestá atención a tus sensaciones." };
    }
    if (rpe <= 7) {
      return { corta: "↑ Repeticiones o carga", larga: "Intentá primero sumar 1–2 repeticiones en alguna serie o subir ligeramente la carga." };
    }
    if (rpe === 8) {
      return { corta: "↑ Ajuste mínimo", larga: "Buscá una mejora pequeña: 1 repetición extra o un aumento mínimo de carga." };
    }
    return { corta: "Mantener técnica", larga: "No agregues volumen por ahora. Intentá repetir el rendimiento con buena técnica." };
  }

  /* calcularRecomendacionProximaSesion: función pura (sección 3 del
     pedido). Entrada = los datos que YA calculan PROG-01/01.1/01.2
     (nunca recalculados ni redefinidos acá); adherenciaBaja es opcional
     (sección 8), calculada aparte por calcularAdherenciaBaja. */
  function calcularRecomendacionProximaSesion(input) {
    var ultimoCambio = input.ultimoCambio;
    var tendencia3 = input.tendencia3;
    var rpe = input.rpe;
    var volumenUltimaSesion = input.volumenUltimaSesion;
    var cantidadSesiones = input.cantidadSesiones;
    var adherenciaBaja = !!input.adherenciaBaja;

    /* Sección 2: con 1 sola sesión histórica (o directamente sin cambio
       real que comparar) no hay base para recomendar nada: se dice así,
       en vez de inventar una tendencia o un rango. */
    if (!(cantidadSesiones >= 2) || ultimoCambio === null || ultimoCambio === undefined) {
      return {
        confianza: CONFIANZA_SIN_DATOS,
        mensaje: "Necesitamos al menos 2 sesiones para recomendar una progresión.",
        rango: null, estado: "Datos insuficientes", motivo: null, notaTendencia: null,
        accion: null, volumenObjetivo: null, rpeDisponible: typeof rpe === "number", advertenciaAdherencia: null
      };
    }

    /* Ajuste 1: sin RPE real, NUNCA se usa un número inventado (ni
       siquiera internamente) para elegir rama: se usa directamente el
       fallback de reglaBaseSinRpe, que solo mira el último cambio real y
       es siempre conservador y no-negativo. El piso para el ajuste por
       tendencia/clamp es -10 únicamente en la categoría de caída con RPE
       REAL conocido; en cualquier otro caso (incluido todo el fallback
       sin RPE, que ya nace no-negativo) el piso es 0. */
    var rpeDisponible = typeof rpe === "number";
    var base = rpeDisponible ? reglaBase(ultimoCambio, rpe) : reglaBaseSinRpe(ultimoCambio);
    var piso = (rpeDisponible && ultimoCambio < 0) ? -10 : 0;

    var ajustado = ajustarPorTendencia(base.min, base.max, tendencia3, piso);
    var rango = clampRango(ajustado.min, ajustado.max, piso);

    var advertenciaAdherencia = null;
    if (adherenciaBaja) {
      var maxLimitado = Math.min(rango.max, 2);
      rango = { min: Math.min(rango.min, maxLimitado), max: maxLimitado };
      advertenciaAdherencia = "Antes de aumentar la carga, priorizá recuperar regularidad.";
    }

    var volumenObjetivo = null;
    if (typeof volumenUltimaSesion === "number" && volumenUltimaSesion > 0) {
      volumenObjetivo = {
        min: Math.round(volumenUltimaSesion * (1 + rango.min / 100)),
        max: Math.round(volumenUltimaSesion * (1 + rango.max / 100))
      };
    }

    /* Ajuste 1 (confianza): sin RPE real se baja un escalón la confianza
       (normal -> inicial), nunca se sube ni se inventa. "Insuficiente"
       sigue dependiendo solo de la cantidad de sesiones, nunca del RPE. */
    var confianzaPorSesiones = cantidadSesiones >= 3 ? CONFIANZA_NORMAL : CONFIANZA_INICIAL;
    var confianza = rpeDisponible ? confianzaPorSesiones : (confianzaPorSesiones === CONFIANZA_NORMAL ? CONFIANZA_INICIAL : confianzaPorSesiones);

    return {
      confianza: confianza,
      mensaje: null,
      rango: rango,
      estado: base.estado,
      motivo: base.motivo,
      notaTendencia: ajustado.notaTendencia,
      accion: obtenerAccionSugerida(rpe, ultimoCambio, rpeDisponible),
      volumenObjetivo: volumenObjetivo,
      rpeDisponible: rpeDisponible,
      advertenciaAdherencia: advertenciaAdherencia
    };
  }

  /* --- PROG-03: recomendación específica por EJERCICIO ---

     Baja un nivel respecto de PROG-02 (que recomienda para "todo el
     bloque"): acá se analiza un ejercicio puntual, comparando sus
     ÚLTIMAS EJECUCIONES REALES (nunca semanas con huecos en 0 — una
     semana sin este ejercicio simplemente no genera una entrada, no se
     rellena con 0, así que jamás se confunde con una caída de
     rendimiento). Función pura, sin DOM, nada persistido, nunca edita
     pesos/reps/rutina.

     LÍMITE DOCUMENTADO (sección 3 del pedido): el modelo de datos no
     distingue series de calentamiento/aproximación de series de trabajo
     principal. Esta v1 NUNCA descarta ni reinterpreta series por su
     cuenta: el volumen y las reps totales siempre suman TODAS las
     series registradas. Para decidir si "se completó el rango objetivo"
     se usan las series que quedaron AL PESO MÁXIMO de esa ejecución (la
     única señal objetiva disponible de cuál fue la serie de trabajo
     real, sin inventar cuál fue warm-up); con peso corporal (0 kg, sin
     forma de distinguir por peso) se usan TODAS las series. */

  /* Reconstruye, para un ejercicio, cada EJECUCIÓN real (una por sesión
     donde se registró ese ejercicio), ordenadas por fecha ascendente.
     Nunca incluye una entrada "vacía" para una sesión/semana donde no se
     hizo el ejercicio: por construcción, no existe el concepto de "0"
     acá (secciones 4/18/19 del pedido). */
  function reconstruirEjecucionesEjercicio(sesiones, ejercicioId) {
    var relevantes = sesiones
      .filter(function (s) {
        return s.tipo === "gimnasio" && (s.ejercicios_realizados || []).some(function (er) { return er.ejercicio_id === ejercicioId; });
      })
      .sort(function (a, b) { return new Date(a.fecha) - new Date(b.fecha); });

    return relevantes.map(function (s) {
      var registro = s.ejercicios_realizados.filter(function (er) { return er.ejercicio_id === ejercicioId; })[0];
      var series = registro.series || [];
      var pesoMaximo = series.reduce(function (max, serie) { return Math.max(max, Number(serie.peso_kg) || 0); }, 0);
      var repsTotales = series.reduce(function (acc, serie) { return acc + (Number(serie.reps) || 0); }, 0);
      var volumenTotal = series.reduce(function (acc, serie) { return acc + (Number(serie.peso_kg) || 0) * (Number(serie.reps) || 0); }, 0);

      /* Series "principales": al peso máximo de la ejecución. Con peso
         corporal (0 kg) no hay por peso con qué distinguir series: se
         toman todas (nunca se excluye nada por cuenta propia). */
      var seriesPrincipales = pesoMaximo > 0
        ? series.filter(function (serie) { return (Number(serie.peso_kg) || 0) === pesoMaximo; })
        : series;
      var repsEnSeriesPrincipales = seriesPrincipales.map(function (serie) { return Number(serie.reps) || 0; });

      return {
        fecha: s.fecha,
        rpeSesion: typeof s.rpe === "number" ? s.rpe : null,
        series: series,
        pesoMaximo: pesoMaximo,
        repsTotales: repsTotales,
        volumenTotal: volumenTotal,
        repsEnSeriesPrincipales: repsEnSeriesPrincipales
      };
    });
  }

  /* Reutiliza agregarCambiosYTendencia (PROG-01, sin modificarla) sobre
     la serie de EJECUCIONES reales: cada entrada se compara contra la
     ejecución real inmediatamente anterior (nunca contra un hueco en
     cero), y la tendencia usa los últimos 3 cambios de volumen entre
     ejecuciones reales. */
  function construirSerieEjecucionesConCambios(ejecuciones) {
    var serieGenerica = ejecuciones.map(function (e) { return { semana: e.fecha, datos: e }; });
    return agregarCambiosYTendencia(serieGenerica, function (d) { return d.volumenTotal; });
  }

  /* Rango de reps objetivo de la rutina (sección 5), SOLO en formatos
     inequívocos: "10-12", "10–12", "10 a 12" (rango), o un único número
     ("10" -> min=max=10). Nunca inventa un rango: si el texto no matchea
     ninguno de esos patrones, devuelve null.

     Ajuste explícito: cualquier formato con "/" (ej. "10/10", "12/12")
     se rechaza A PROPÓSITO, ANTES de intentar ningún otro parseo. "/" es
     una convención ambigua en esta rutina (puede significar "10 por
     lado" en un ejercicio unilateral, o cualquier otra cosa) y nunca se
     debe asumir que es un rango 10-10: tratarlo así generaba falsos
     "Subir carga" solo porque las reps registradas superaban ese "rango"
     mal interpretado. Sin rango (null), el motor usa el criterio
     conservador existente (nunca "Subir carga" sin un rango inequívoco
     contra el cual confirmar el tope). */
  function parsearRangoReps(repsObjetivo) {
    if (!repsObjetivo || typeof repsObjetivo !== "string") return null;
    if (repsObjetivo.indexOf("/") !== -1) return null;
    var rango = repsObjetivo.match(/(\d+)\s*(?:-|–|a)\s*(\d+)/i);
    if (rango) {
      var min = parseInt(rango[1], 10);
      var max = parseInt(rango[2], 10);
      return min <= max ? { min: min, max: max } : { min: max, max: min };
    }
    var unico = repsObjetivo.match(/(\d+)/);
    if (unico) {
      var n = parseInt(unico[1], 10);
      return { min: n, max: n };
    }
    return null;
  }

  /* Ejercicio tal como está configurado HOY en la rutina (para leer
     series_objetivo/reps_objetivo). null si el ejercicio ya no existe en
     el bloque actual (histórico): en ese caso nunca se inventa un rango,
     el motor cae directo al criterio conservador de la sección 5. */
  function obtenerEjercicioDeRutina(data, bloqueId, ejercicioId) {
    var dia = data.rutina.dias.filter(function (d) { return d.id === bloqueId; })[0];
    if (!dia) return null;
    return dia.ejercicios.filter(function (ej) { return ej.id === ejercicioId; })[0] || null;
  }

  /* Umbrales de caída (secciones 10/13/14): el pedido dice "cae de forma
     clara" / "la caída es fuerte" sin dar un número exacto. -5% se eligió
     como piso para no disparar "Recuperar rendimiento" por una variación
     trivial (ej. una repetición de diferencia en un ejercicio de pocas
     reps); -15% como "caída fuerte" que amerita un motivo más cauteloso
     cuando además el RPE fue alto. Documentado para poder ajustarse. */
  function cambioClaroNegativo(pct) { return pct !== null && pct !== undefined && pct <= -5; }
  function cambioFuerteNegativo(pct) { return pct !== null && pct !== undefined && pct <= -15; }
  function todasAlTopeOMas(reps, max) { return reps.length > 0 && reps.every(function (r) { return r >= max; }); }

  /* Textos por estado (secciones 7-10, 13-14). Nunca definen kilos
     concretos (sección 8: "no conocemos los incrementos disponibles de
     la máquina/mancuernas") y nunca exigen +1 rep en TODAS las series. */
  function textosRecomendacionEjercicio(estado, ctx) {
    if (estado === "Sumar repeticiones") {
      return ctx.esPesoCorporal
        ? {
            sugerencia: "Mantené la misma ejecución e intentá sumar 1–2 repeticiones totales o completar una repetición más en alguna serie.",
            motivo: "Las repeticiones todavía pueden crecer sin necesidad de aumentar la dificultad."
          }
        : {
            sugerencia: "Mantené " + formatearKg(ctx.pesoMaximo) + " e intentá sumar 1–2 repeticiones totales o completar una repetición más en alguna serie.",
            motivo: "El rendimiento es estable o creciente y todavía hay margen antes de exigir más en el rango objetivo."
          };
    }
    if (estado === "Subir carga") {
      return {
        sugerencia: "Probá subir la carga mínima disponible en la próxima sesión.",
        motivo: "Completaste el extremo superior del rango de forma sólida y el esfuerzo no fue muy alto."
      };
    }
    if (estado === "Mantener y consolidar") {
      return ctx.esPesoCorporal
        ? {
            sugerencia: "Consolidá la ejecución actual con buena técnica antes de buscar más repeticiones o más dificultad.",
            motivo: "El avance reciente fue grande: conviene afianzarlo antes de seguir exigiendo más."
          }
        : {
            sugerencia: "Repetí la carga actual y buscá igualar o mejorar levemente las repeticiones.",
            motivo: "Hubo un avance reciente importante: conviene consolidarlo antes de seguir progresando."
          };
    }
    if (estado === "Recuperar rendimiento") {
      return ctx.esPesoCorporal
        ? {
            sugerencia: "Repetí la misma ejecución y buscá recuperar las repeticiones antes de exigir más.",
            motivo: "Las repeticiones bajaron respecto de la ejecución anterior."
          }
        : {
            sugerencia: "Repetí la carga de la última sesión y buscá recuperar repeticiones antes de aumentar.",
            motivo: "El rendimiento cayó respecto de la ejecución anterior."
          };
    }
    // "Seguimiento cualitativo"
    return {
      sugerencia: "Seguí registrando esta actividad; todavía no hay una métrica numérica útil para sugerir progresión.",
      motivo: "No hay peso ni repeticiones que permitan medir una progresión concreta."
    };
  }

  /* calcularRecomendacionEjercicio: función pura (secciones 4-10 y 13-14
     del pedido). Entrada = datos de la ÚLTIMA ejecución real + su
     comparación contra la anterior + el rango objetivo de la rutina (si
     existe). Nunca recibe RPE "promedio histórico": el RPE es el de la
     sesión de la última ejecución únicamente (sección 11), y nunca se
     inventa si no existe. */
  function calcularRecomendacionEjercicio(input) {
    var cantidadEjecuciones = input.cantidadEjecuciones;
    var rpeSesion = input.rpeSesion;
    var rpeDisponible = typeof rpeSesion === "number";

    if (!(cantidadEjecuciones >= 2)) {
      return {
        confianza: "insuficiente",
        mensaje: "Datos insuficientes para recomendar progresión.",
        estado: "Datos insuficientes", sugerencia: null, motivo: null, rpeDisponible: rpeDisponible
      };
    }

    var esPesoCorporal = input.pesoMaximoUltimo === 0;
    var rpeAlto = rpeDisponible && rpeSesion >= 9;
    var estado;

    if (esPesoCorporal && input.repsTotalesUltimo === 0) {
      /* Sección 13: ni peso ni reps -> no hay ninguna métrica progresiva
         útil (ej. una actividad puramente cualitativa). */
      estado = "Seguimiento cualitativo";
    } else if (esPesoCorporal) {
      if (cambioClaroNegativo(input.cambioRepsPct)) {
        estado = "Recuperar rendimiento";
      } else if (input.rangoReps && todasAlTopeOMas(input.repsEnSeriesPrincipales, input.rangoReps.max)) {
        estado = "Mantener y consolidar";
      } else {
        estado = "Sumar repeticiones";
      }
    } else if (input.cambioPesoMaximoPct > 0) {
      /* Sección 9, evaluado ANTES que la caída (sección 10): si la carga
         subió recién, una baja de reps/volumen es la consecuencia
         ESPERABLE de ese aumento, no un fracaso de rendimiento. Nunca se
         interpreta como "Recuperar rendimiento" solo porque se hizo
         menos reps con más peso. */
      estado = "Mantener y consolidar";
    } else if (cambioClaroNegativo(input.cambioVolumenPct) || cambioClaroNegativo(input.cambioRepsPct)) {
      estado = "Recuperar rendimiento";
    } else if (
      (input.cambioVolumenPct !== null && input.cambioVolumenPct > 15) ||
      (input.tendenciaVolumen !== null && input.tendenciaVolumen > 8)
    ) {
      /* Sección 9: salto fuerte de volumen o tendencia acelerada ->
         consolidar antes de seguir exigiendo. */
      estado = "Mantener y consolidar";
    } else if (input.rangoReps && todasAlTopeOMas(input.repsEnSeriesPrincipales, input.rangoReps.max)) {
      /* Sección 8: el RPE alto bloquea la subida de carga aunque se haya
         alcanzado el tope del rango (sección 11, nunca se exige fallo). */
      estado = rpeAlto ? "Mantener y consolidar" : "Subir carga";
    } else {
      /* Sección 5: sin rango configurado, o dentro/por debajo del rango
         sin caída -> siempre conservador, nunca "Subir carga" sin un
         rango objetivo contra el cual confirmar que se topó el techo. */
      estado = "Sumar repeticiones";
    }

    var textos = textosRecomendacionEjercicio(estado, {
      pesoMaximo: input.pesoMaximoUltimo, esPesoCorporal: esPesoCorporal
    });

    if (estado === "Recuperar rendimiento" && rpeAlto && (cambioFuerteNegativo(input.cambioVolumenPct) || cambioFuerteNegativo(input.cambioRepsPct))) {
      textos = {
        sugerencia: textos.sugerencia,
        motivo: textos.motivo + " Además, fue una sesión muy exigente: priorizá la técnica antes que el peso."
      };
    }

    return {
      confianza: cantidadEjecuciones >= 3 ? "normal" : "inicial",
      mensaje: null,
      estado: estado,
      sugerencia: textos.sugerencia,
      motivo: textos.motivo,
      rpeDisponible: rpeDisponible
    };
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

  /* --- PROG-04: Estado del plan / Fatiga y progresión ---

     Capa general (no por bloque ni por ejercicio) que lee el estado actual
     del entrenamiento y lo resume en progresar / consolidar / intensificar /
     descargar, o null cuando no hay datos suficientes. Nunca usa la semana
     del plan para decidir: el storage no tiene fecha_inicio/fecha_fin, así
     que la "semana N de registros de esta rutina" es solo contexto.

     Dos piezas:
     - construirInputEstadoPlan(data, hoyISO): arma todos los datos que
       necesita la decisión, con la fecha de hoy EXPLÍCITA (fechas locales,
       semanas lunes-domingo). No escribe nada.
     - calcularEstadoPlan(input): función PURA (sin DOM, sin storage, sin
       new Date()): solo lee números y fechas ISO ya calculados.

     No modifica PROG-01/02/03: sus estados se usan solo como contexto; las
     señales salen de las métricas subyacentes (series principales, RPE por
     sesión, adherencia).

     Umbrales: elegidos para v1 y documentados acá para poder ajustarlos
     con datos reales. */

  var EP_SEMANAS_VENTANA = 4;
  var EP_RPE_ALTO = 9;
  var EP_MIN_SESIONES_RPE_ALTO = 3;
  var EP_DIAS_VENTANA_RPE = 14;
  var EP_PROPORCION_EJERCICIOS = 0.3;
  var EP_MIN_EJERCICIOS_EVALUABLES = 3;
  var EP_MIN_EJERCICIOS_S4 = 2;
  /* Caída "clara": -5% en las reps (o en el trabajo por serie) de las
     series principales. Mismo piso que PROG-03 (cambioClaroNegativo), para
     no disparar señales por una repetición de diferencia. */
  var EP_UMBRAL_CAIDA_PCT = -5;
  var EP_UMBRAL_MEJORA_PCT = 2;
  var EP_UMBRAL_SALTO_CARGA_PCT = 10;
  var EP_UMBRAL_SALTO_RENDIMIENTO_PCT = 15;
  var EP_TENDENCIA_MUY_ALTA_PCT = 8;
  var EP_DIAS_EJERCICIO_RECIENTE = 21;
  var EP_DIAS_SIN_ENTRENAR = 21;
  var EP_RPE_PROMEDIO_ALTO = 8.5;
  var EP_RPE_INTENSIFICAR_MAX = 7.5;
  var EP_ADHERENCIA_BAJA = 0.5;
  var EP_ADHERENCIA_INTENSIFICAR = 0.75;
  var EP_SEMANAS_INTENSIFICAR = 3;
  var EP_SEMANA_LIVIANA_CAIDA_PCT = -20;
  var EP_SEMANA_LIVIANA_RPE_MAX = 6;
  /* Una serie con carga menor pero >= 90% de la principal puede ser una
     serie efectiva (back-off) y no una aproximación: no se puede saber, así
     que la estructura se marca como ambigua (baja la confianza). */
  var EP_CERCANIA_CARGA_AMBIGUA = 0.9;
  var EP_MAX_CAMBIOS_EJERCICIO = 4;

  /* --- Fechas ISO deterministas (YYYY-MM-DD), sin depender de "ahora" --- */

  function partesFechaISO(iso) {
    var p = iso.split("-");
    return [parseInt(p[0], 10), parseInt(p[1], 10), parseInt(p[2], 10)];
  }

  function numeroDeDiaISO(iso) {
    var p = partesFechaISO(iso);
    return Math.round(Date.UTC(p[0], p[1] - 1, p[2]) / 86400000);
  }

  function diasEntreISO(desdeISO, hastaISO) {
    return numeroDeDiaISO(hastaISO) - numeroDeDiaISO(desdeISO);
  }

  function sumarDiasISO(iso, dias) {
    var p = partesFechaISO(iso);
    var d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + dias));
    return d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0") + "-" + String(d.getUTCDate()).padStart(2, "0");
  }

  function formatearDiaMesISO(iso) {
    var p = iso.split("-");
    return p[2] + "/" + p[1];
  }

  function plural(n, singular, pluralTexto) {
    return n + " " + (n === 1 ? singular : pluralTexto);
  }

  function formatearDecimal(n) {
    return (Math.round(n * 10) / 10).toFixed(1).replace(".", ",");
  }

  /* --- Series principales ---

     Regla (sin detectar calentamientos automáticamente):
     1. Se ignoran series sin repeticiones registradas.
     2. Carga principal = la carga máxima de esa ejecución.
     3. Series principales = las que se hicieron con esa carga máxima, en
        el orden registrado. Son las únicas que se comparan.
     4. Las series con menos carga cuentan para el volumen/contexto, pero
        nunca disparan una señal por sí solas.
     5. Peso corporal (todas las series en 0 kg): no hay carga con qué
        distinguir, así que todas las series son principales.
     6. Ambigüedad (no se inventa interpretación, solo baja la confianza):
        - alguna serie con menos carga está a >= 90% de la principal
          (puede ser una serie efectiva y no una aproximación), o
        - la carga máxima tiene una sola serie y hay 2+ series más livianas
          (estructura en rampa/pirámide: no está claro cuál es el trabajo). */
  function analizarSeriesPrincipales(series) {
    var validas = (series || [])
      .map(function (s) { return { peso: Number(s.peso_kg) || 0, reps: Number(s.reps) || 0 }; })
      .filter(function (s) { return s.reps > 0; });

    if (!validas.length) {
      return { sinDatos: true, pesoCorporal: false, cargaPrincipal: 0, repsPrincipales: [], seriesSecundarias: 0, ambigua: false };
    }

    var cargaMaxima = validas.reduce(function (max, s) { return Math.max(max, s.peso); }, 0);
    if (cargaMaxima === 0) {
      return {
        sinDatos: false, pesoCorporal: true, cargaPrincipal: 0,
        repsPrincipales: validas.map(function (s) { return s.reps; }), seriesSecundarias: 0, ambigua: false
      };
    }

    var principales = validas.filter(function (s) { return Math.abs(s.peso - cargaMaxima) < 0.001; });
    var secundarias = validas.filter(function (s) { return Math.abs(s.peso - cargaMaxima) >= 0.001; });
    var secundariasCercanas = secundarias.filter(function (s) { return s.peso >= cargaMaxima * EP_CERCANIA_CARGA_AMBIGUA; });

    return {
      sinDatos: false,
      pesoCorporal: false,
      cargaPrincipal: cargaMaxima,
      repsPrincipales: principales.map(function (s) { return s.reps; }),
      seriesSecundarias: secundarias.length,
      ambigua: secundariasCercanas.length > 0 || (principales.length === 1 && secundarias.length >= 2)
    };
  }

  function promedioSimple(valores) {
    if (!valores.length) return null;
    return valores.reduce(function (a, b) { return a + b; }, 0) / valores.length;
  }

  /* Compara dos ejecuciones reales de un ejercicio usando SOLO sus series
     principales. Se comparan las primeras k series principales de cada una
     (k = la menor cantidad), así que agregar o quitar una serie efectiva no
     se lee como mejora ni como caída: eso es volumen, no rendimiento.
     tipo:
       "misma_carga"   misma carga principal: se comparan reps promedio.
       "carga_mayor"   subió la carga: menos reps es esperable, NUNCA es
                       caída (cuenta como mejora).
       "carga_menor"   bajó la carga: se compara el trabajo por serie
                       principal (carga x reps), para no premiar ni
                       castigar el cambio de carga en sí.
       "peso_corporal" ambas sin carga: se comparan reps promedio.
       "no_comparable" falta información o una tiene carga y la otra no. */
  function compararEjecucionesPrincipales(anterior, actual) {
    var base = { tipo: "no_comparable", cambioCargaPct: null, cambioRepsPrincipalPct: null, cambioRendimientoPct: null, esCaida: false, esMejora: false, esSalto: false };
    if (anterior.sinDatos || actual.sinDatos || anterior.pesoCorporal !== actual.pesoCorporal) return base;

    var k = Math.min(anterior.repsPrincipales.length, actual.repsPrincipales.length);
    var repsAnt = promedioSimple(anterior.repsPrincipales.slice(0, k));
    var repsAct = promedioSimple(actual.repsPrincipales.slice(0, k));
    var cambioReps = calcularCambioPorcentual(repsAct, repsAnt);

    var tipo;
    var cambioCarga = null;
    var cambioRendimiento;
    if (actual.pesoCorporal) {
      tipo = "peso_corporal";
      cambioRendimiento = cambioReps;
    } else {
      cambioCarga = calcularCambioPorcentual(actual.cargaPrincipal, anterior.cargaPrincipal);
      if (Math.abs(actual.cargaPrincipal - anterior.cargaPrincipal) < 0.001) {
        tipo = "misma_carga";
        cambioRendimiento = cambioReps;
      } else {
        tipo = actual.cargaPrincipal > anterior.cargaPrincipal ? "carga_mayor" : "carga_menor";
        cambioRendimiento = calcularCambioPorcentual(actual.cargaPrincipal * repsAct, anterior.cargaPrincipal * repsAnt);
      }
    }

    var esCaida = tipo !== "carga_mayor" && cambioRendimiento !== null && cambioRendimiento <= EP_UMBRAL_CAIDA_PCT;
    var esMejora = tipo === "carga_mayor" || (cambioRendimiento !== null && cambioRendimiento >= EP_UMBRAL_MEJORA_PCT);
    var esSalto = (tipo === "carga_mayor" && cambioCarga !== null && cambioCarga >= EP_UMBRAL_SALTO_CARGA_PCT) ||
      (cambioRendimiento !== null && cambioRendimiento > EP_UMBRAL_SALTO_RENDIMIENTO_PCT);

    return {
      tipo: tipo,
      cambioCargaPct: cambioCarga,
      cambioRepsPrincipalPct: cambioReps,
      cambioRendimientoPct: cambioRendimiento,
      esCaida: esCaida,
      esMejora: esMejora,
      esSalto: esSalto
    };
  }

  /* Valor que alimenta la tendencia: una subida de carga nunca cuenta como
     tendencia negativa aunque el trabajo por serie haya bajado un poco. */
  function valorParaTendencia(comparacion) {
    if (comparacion.cambioRendimientoPct === null) return null;
    if (comparacion.tipo === "carga_mayor") return Math.max(0, comparacion.cambioRendimientoPct);
    return comparacion.cambioRendimientoPct;
  }

  /* --- Constructor del input (lee data, no escribe nada) --- */

  function construirInputEstadoPlan(data, hoyISO) {
    var semanaActual = inicioDeSemanaISO(hoyISO);
    var bloquesActivos = data.rutina.dias.map(function (d) { return d.id; });
    var esActivo = {};
    bloquesActivos.forEach(function (id) { esActivo[id] = true; });

    var todas = (data.sesiones_entrenamiento || [])
      .map(function (s) { return { sesion: s, fechaISO: GYMAPP.util.fechaLocalISO(s.fecha) }; })
      .filter(function (x) { return x.fechaISO <= hoyISO; })
      .sort(function (a, b) {
        if (a.fechaISO !== b.fechaISO) return a.fechaISO < b.fechaISO ? -1 : 1;
        return String(a.sesion.fecha) < String(b.sesion.fecha) ? -1 : 1;
      });

    var gimnasio = todas.filter(function (x) { return x.sesion.tipo === "gimnasio"; });
    var deLaRutina = gimnasio.filter(function (x) { return esActivo[x.sesion.dia_rutina_id]; });

    /* Inicio observado: primera sesión real asociada a un bloque de la
       rutina actual. No se afirma que sea la fecha real del plan. */
    var inicioObservado = deLaRutina.length ? deLaRutina[0].fechaISO : null;
    var semanaInicio = inicioObservado ? inicioDeSemanaISO(inicioObservado) : null;
    var inicioEsParcial = inicioObservado ? inicioObservado !== semanaInicio : false;

    var semanasCerradasDesdeInicio = (semanaInicio && semanaInicio < semanaActual)
      ? generarRangoSemanas(semanaInicio, sumarDiasISO(semanaActual, -7))
      : [];

    var porSemana = {};
    deLaRutina.forEach(function (x) {
      var semana = inicioDeSemanaISO(x.fechaISO);
      if (!porSemana[semana]) porSemana[semana] = [];
      porSemana[semana].push(x);
    });

    var semanasCerradasConDatos = semanasCerradasDesdeInicio.filter(function (s) { return porSemana[s] && porSemana[s].length; }).length;

    var semanasVentana = semanasCerradasDesdeInicio.slice(-EP_SEMANAS_VENTANA);
    if (semanaInicio) semanasVentana = semanasVentana.concat([semanaActual]);

    var semanas = semanasVentana.map(function (semana) {
      var sesionesSemana = porSemana[semana] || [];
      var volumenPorBloque = {};
      sesionesSemana.forEach(function (x) {
        var id = x.sesion.dia_rutina_id;
        volumenPorBloque[id] = (volumenPorBloque[id] || 0) + volumenSesionCompleta(x.sesion);
      });
      var bloquesRealizados = Object.keys(volumenPorBloque).length;
      var rpes = sesionesSemana.map(function (x) { return typeof x.sesion.rpe === "number" ? x.sesion.rpe : null; });
      var rpesValidos = rpes.filter(function (r) { return r !== null; });
      return {
        semana: semana,
        cerrada: semana < semanaActual,
        esSemanaInicioParcial: semana === semanaInicio && inicioEsParcial,
        bloquesPlanificados: bloquesActivos.length,
        bloquesRealizados: bloquesRealizados,
        adherencia: bloquesActivos.length ? Math.min(1, bloquesRealizados / bloquesActivos.length) : 0,
        sesiones: sesionesSemana.length,
        sesionesSinRpe: rpes.length - rpesValidos.length,
        rpes: rpesValidos,
        rpePromedio: promedioSimple(rpesValidos),
        volumenTotal: Object.keys(volumenPorBloque).reduce(function (acc, id) { return acc + volumenPorBloque[id]; }, 0),
        volumenPorBloque: volumenPorBloque
      };
    });

    var ejercicios = [];
    data.rutina.dias.forEach(function (dia) {
      (dia.ejercicios || []).forEach(function (ej) {
        var ejecuciones = gimnasio
          .map(function (x) {
            var registro = (x.sesion.ejercicios_realizados || []).filter(function (er) { return er.ejercicio_id === ej.id; })[0];
            if (!registro) return null;
            var principal = analizarSeriesPrincipales(registro.series);
            return {
              sesionId: x.sesion.id,
              fechaISO: x.fechaISO,
              semanaISO: inicioDeSemanaISO(x.fechaISO),
              principal: principal,
              repsTotales: (registro.series || []).reduce(function (acc, s) { return acc + (Number(s.reps) || 0); }, 0),
              volumenTotal: volumenDeSeries(registro.series || [])
            };
          })
          .filter(function (e) { return e && !e.principal.sinDatos; });

        if (!ejecuciones.length) return;

        var recientes = ejecuciones.slice(-(EP_MAX_CAMBIOS_EJERCICIO + 1));
        var comparaciones = [];
        for (var i = 1; i < recientes.length; i++) {
          var c = compararEjecucionesPrincipales(recientes[i - 1].principal, recientes[i].principal);
          c.sesionId = recientes[i].sesionId;
          c.fechaISO = recientes[i].fechaISO;
          comparaciones.push(c);
        }

        /* Tendencia3: promedio de los últimos 3 cambios reales entre
           ejecuciones (nunca semanas faltantes = 0, porque una semana sin
           el ejercicio no genera ninguna ejecución). */
        var ultimosTres = comparaciones.slice(-3).map(valorParaTendencia);
        var tendencia3 = (ultimosTres.length === 3 && ultimosTres.every(function (v) { return v !== null; }))
          ? promedioSimple(ultimosTres) : null;

        var ultima = recientes[recientes.length - 1];
        var anteultima = recientes.length >= 2 ? recientes[recientes.length - 2] : null;

        ejercicios.push({
          ejercicioId: ej.id,
          nombre: ej.nombre || "",
          bloqueId: dia.id,
          cantidadEjecuciones: ejecuciones.length,
          diasDesdeUltima: diasEntreISO(ultima.fechaISO, hoyISO),
          ultima: {
            sesionId: ultima.sesionId,
            fechaISO: ultima.fechaISO,
            semanaISO: ultima.semanaISO,
            cargaPrincipal: ultima.principal.cargaPrincipal,
            repsPrincipales: ultima.principal.repsPrincipales,
            seriesSecundarias: ultima.principal.seriesSecundarias,
            repsTotales: ultima.repsTotales,
            volumenTotal: ultima.volumenTotal
          },
          ambigua: ultima.principal.ambigua || (anteultima ? anteultima.principal.ambigua : false),
          comparaciones: comparaciones,
          tendencia3: tendencia3,
          estadoProg03: estadoProg03DeContexto(data, dia.id, ej.id)
        });
      });
    });

    var bloques = data.rutina.dias.map(function (dia) {
      var serie = construirSerieSemanalBloque(data.sesiones_entrenamiento, dia.id);
      var ultimaRealizada = obtenerUltimaSemanaRealizada(serie);
      var estadoProg02 = null;
      if (ultimaRealizada && contarSemanasRealizadas(serie) >= 2) {
        estadoProg02 = calcularRecomendacionProximaSesion({
          ultimoCambio: ultimaRealizada.cambioPct,
          tendencia3: ultimaRealizada.tendencia3,
          rpe: ultimaRealizada.datos.rpePromedio,
          volumenUltimaSesion: ultimaRealizada.datos.volumenPromedioPorSesion,
          cantidadSesiones: contarSemanasRealizadas(serie),
          adherenciaBaja: calcularAdherenciaBaja(serie)
        }).estado;
      }
      return {
        bloqueId: dia.id,
        nombre: dia.nombre || "",
        ultimoCambioPct: ultimaRealizada ? ultimaRealizada.cambioPct : null,
        tendencia3: ultimaRealizada ? ultimaRealizada.tendencia3 : null,
        estadoProg02: estadoProg02
      };
    });

    var sesionesRecientes = gimnasio
      .filter(function (x) { return diasEntreISO(x.fechaISO, hoyISO) < EP_DIAS_VENTANA_RPE * 2; })
      .map(function (x) {
        return {
          sesionId: x.sesion.id,
          fechaISO: x.fechaISO,
          diasDesdeHoy: diasEntreISO(x.fechaISO, hoyISO),
          rpe: typeof x.sesion.rpe === "number" ? x.sesion.rpe : null,
          duracion_min: x.sesion.duracion_min,
          bloqueId: x.sesion.dia_rutina_id
        };
      });

    var futbolContexto = todas
      .filter(function (x) { return x.sesion.tipo === "futbol" && diasEntreISO(x.fechaISO, hoyISO) < EP_DIAS_VENTANA_RPE; })
      .map(function (x) {
        return { fechaISO: x.fechaISO, rpe: typeof x.sesion.rpe === "number" ? x.sesion.rpe : null, duracion_min: x.sesion.duracion_min };
      });

    return {
      hoyISO: hoyISO,
      semanaActualISO: semanaActual,
      cantidadBloquesActivos: bloquesActivos.length,
      inicioObservadoISO: inicioObservado,
      semanaDeRegistros: semanaInicio ? Math.floor(diasEntreISO(semanaInicio, semanaActual) / 7) + 1 : null,
      sesionesDeLaRutina: deLaRutina.length,
      rpePromedioRutina: promedioSimple(deLaRutina.map(function (x) { return x.sesion.rpe; }).filter(function (r) { return typeof r === "number"; })),
      semanasCerradasDesdeInicio: semanasCerradasDesdeInicio.length,
      semanasCerradasConDatos: semanasCerradasConDatos,
      diasDesdeUltimaSesionRutina: deLaRutina.length ? diasEntreISO(deLaRutina[deLaRutina.length - 1].fechaISO, hoyISO) : null,
      semanas: semanas,
      ejercicios: ejercicios,
      bloques: bloques,
      sesionesRecientes: sesionesRecientes,
      futbolContexto: futbolContexto
    };
  }

  /* Estado de PROG-03 para un ejercicio, calculado EXACTAMENTE como lo
     muestra "Próxima vez en este ejercicio". Solo contexto: ninguna señal
     de PROG-04 se dispara por este texto. */
  function estadoProg03DeContexto(data, bloqueId, ejercicioId) {
    var ejecuciones = reconstruirEjecucionesEjercicio(data.sesiones_entrenamiento, ejercicioId);
    if (ejecuciones.length < 2) return null;
    var serie = construirSerieEjecucionesConCambios(ejecuciones);
    var ultimo = serie[serie.length - 1];
    var anterior = serie[serie.length - 2];
    var ejercicioRutina = obtenerEjercicioDeRutina(data, bloqueId, ejercicioId);
    return calcularRecomendacionEjercicio({
      cantidadEjecuciones: ejecuciones.length,
      pesoMaximoUltimo: ultimo.datos.pesoMaximo,
      cambioPesoMaximoPct: calcularCambioPorcentual(ultimo.datos.pesoMaximo, anterior.datos.pesoMaximo),
      repsTotalesUltimo: ultimo.datos.repsTotales,
      cambioRepsPct: calcularCambioPorcentual(ultimo.datos.repsTotales, anterior.datos.repsTotales),
      cambioVolumenPct: ultimo.cambioPct,
      tendenciaVolumen: ultimo.tendencia3,
      rpeSesion: ultimo.datos.rpeSesion,
      rangoReps: ejercicioRutina ? parsearRangoReps(ejercicioRutina.reps_objetivo) : null,
      repsEnSeriesPrincipales: ultimo.datos.repsEnSeriesPrincipales
    }).estado;
  }

  /* --- Función pura de decisión --- */

  function contarSesionesDistintas(lista) {
    var vistas = {};
    lista.forEach(function (x) { vistas[x] = true; });
    return Object.keys(vistas).length;
  }

  function senal(activa, detalle) {
    return { activa: !!activa, detalle: detalle };
  }

  function calcularEstadoPlan(input) {
    var semanasCerradas = input.semanas.filter(function (s) { return s.cerrada; });
    var semanaEnCurso = input.semanas.filter(function (s) { return !s.cerrada; })[0] || null;

    /* Ejercicios evaluables: de la rutina actual, con 2+ ejecuciones
       reales, la última hace <= 21 días y la última comparación hecha
       sobre series principales comparables. */
    var evaluables = input.ejercicios.filter(function (e) {
      var ult = e.comparaciones[e.comparaciones.length - 1];
      return e.cantidadEjecuciones >= 2 && e.diasDesdeUltima <= EP_DIAS_EJERCICIO_RECIENTE && ult && ult.tipo !== "no_comparable";
    });
    var nEval = evaluables.length;
    function ultimaComp(e) { return e.comparaciones[e.comparaciones.length - 1]; }
    function proporcion(n) { return nEval > 0 ? n / nEval : 0; }

    /* S1: acumulación de RPE alto (gimnasio, últimos 14 días). */
    var ultimos14 = input.sesionesRecientes.filter(function (s) { return s.diasDesdeHoy < EP_DIAS_VENTANA_RPE; });
    var previos14 = input.sesionesRecientes.filter(function (s) { return s.diasDesdeHoy >= EP_DIAS_VENTANA_RPE && s.diasDesdeHoy < EP_DIAS_VENTANA_RPE * 2; });
    var rpeAltas14 = ultimos14.filter(function (s) { return s.rpe !== null && s.rpe >= EP_RPE_ALTO; }).length;
    var s1 = rpeAltas14 >= EP_MIN_SESIONES_RPE_ALTO;
    var rpes14 = ultimos14.map(function (s) { return s.rpe; }).filter(function (r) { return r !== null; });
    var rpesPrevios = previos14.map(function (s) { return s.rpe; }).filter(function (r) { return r !== null; });
    var rpePromedio14 = promedioSimple(rpes14);
    var rpePromedioPrevio = promedioSimple(rpesPrevios);

    /* S2: caída de rendimiento principal en varios ejercicios y en 2+
       sesiones distintas (una sola mala sesión nunca alcanza). */
    var conCaida = evaluables.filter(function (e) { return ultimaComp(e).esCaida; });
    var sesionesConCaida = contarSesionesDistintas(conCaida.map(function (e) { return ultimaComp(e).sesionId; }));
    var s2 = nEval >= EP_MIN_EJERCICIOS_EVALUABLES && proporcion(conCaida.length) >= EP_PROPORCION_EJERCICIOS && sesionesConCaida >= 2;

    /* S3: tendencia negativa. Además de tendencia3 < 0, se exige que al
       menos 2 de los últimos 3 cambios sean <= 0, para que una única caída
       grande no arrastre sola el promedio. */
    var conTendenciaNegativa = evaluables.filter(function (e) {
      if (e.tendencia3 === null || !(e.tendencia3 < 0)) return false;
      var negativos = e.comparaciones.slice(-3).map(valorParaTendencia).filter(function (v) { return v !== null && v <= 0; }).length;
      return negativos >= 2;
    });
    var s3 = nEval >= EP_MIN_EJERCICIOS_EVALUABLES && proporcion(conTendenciaNegativa.length) >= EP_PROPORCION_EJERCICIOS;

    /* S4: misma carga principal y caída clara de reps de las series
       principales, en 2+ ejercicios y 2+ sesiones distintas. */
    var conCaidaMismaCarga = evaluables.filter(function (e) {
      var c = ultimaComp(e);
      return c.tipo === "misma_carga" && c.cambioRepsPrincipalPct !== null && c.cambioRepsPrincipalPct <= EP_UMBRAL_CAIDA_PCT;
    });
    var sesionesS4 = contarSesionesDistintas(conCaidaMismaCarga.map(function (e) { return ultimaComp(e).sesionId; }));
    var s4 = conCaidaMismaCarga.length >= EP_MIN_EJERCICIOS_S4 && sesionesS4 >= 2;

    /* S5 / esfuerzo en alza: RPE promedio de los últimos 14 días >= el de
       los 14 anteriores + 1, con 2+ sesiones por encima de ese nivel (una
       sola sesión extrema no alcanza). S5 exige además que el rendimiento
       no esté mejorando claramente. */
    var mejoras = evaluables.filter(function (e) { return ultimaComp(e).esMejora; });
    var rendimientoMejorandoClaro = nEval > 0 && conCaida.length === 0 && proporcion(mejoras.length) >= 0.5;
    var esfuerzoEnAlza = rpes14.length >= 2 && rpesPrevios.length >= 2 && rpePromedio14 >= rpePromedioPrevio + 1 &&
      rpes14.filter(function (r) { return r >= rpePromedioPrevio + 1; }).length >= 2;
    var s5 = esfuerzoEnAlza && !rendimientoMejorandoClaro;

    /* A: adherencia baja en 2+ de las últimas 3 semanas cerradas. La semana
       del inicio observado se excluye si no empezó un lunes (es parcial
       por definición). */
    var cerradasAdherencia = semanasCerradas.filter(function (s) { return !s.esSemanaInicioParcial; }).slice(-3);
    var semanasAdherenciaBaja = cerradasAdherencia.filter(function (s) { return s.adherencia < EP_ADHERENCIA_BAJA; }).length;
    var adherenciaBaja = semanasAdherenciaBaja >= 2;

    /* L: semana liviana aparente (solo contexto: NO borra S2/S4). Última
       semana cerrada con sesiones vs la semana previa del mismo bloque. */
    var semanaLiviana = null;
    var cerradasConSesiones = semanasCerradas.filter(function (s) { return s.sesiones > 0; });
    if (cerradasConSesiones.length >= 2) {
      var w = cerradasConSesiones[cerradasConSesiones.length - 1];
      var cambiosBloque = [];
      Object.keys(w.volumenPorBloque).forEach(function (bloqueId) {
        for (var i = cerradasConSesiones.length - 2; i >= 0; i--) {
          var previo = cerradasConSesiones[i].volumenPorBloque[bloqueId];
          if (previo) {
            cambiosBloque.push(calcularCambioPorcentual(w.volumenPorBloque[bloqueId], previo));
            break;
          }
        }
      });
      var cambioMedio = promedioSimple(cambiosBloque.filter(function (c) { return c !== null; }));
      var cargasNoSubieron = input.ejercicios
        .filter(function (e) { return e.ultima.semanaISO === w.semana && e.comparaciones.length; })
        .every(function (e) { return ultimaComp(e).tipo !== "carga_mayor"; });
      if (cambioMedio !== null && cambioMedio <= EP_SEMANA_LIVIANA_CAIDA_PCT && w.rpePromedio !== null &&
          w.rpePromedio <= EP_SEMANA_LIVIANA_RPE_MAX && cargasNoSubieron) {
        semanaLiviana = { semanaISO: w.semana, cambioVolumenPct: cambioMedio, rpePromedio: w.rpePromedio };
      }
    }

    /* Auxiliares de Consolidar / Intensificar. */
    var conSalto = evaluables.filter(function (e) { return ultimaComp(e).esSalto; });
    var conTendenciaMuyAlta = evaluables.filter(function (e) { return e.tendencia3 !== null && e.tendencia3 > EP_TENDENCIA_MUY_ALTA_PCT; });
    var saltoReciente = (conSalto.length >= 2 && proporcion(conSalto.length) >= EP_PROPORCION_EJERCICIOS) ||
      (conTendenciaMuyAlta.length >= 2 && proporcion(conTendenciaMuyAlta.length) >= EP_PROPORCION_EJERCICIOS);
    var ambiguos = evaluables.filter(function (e) { return e.ambigua; }).length;
    var estructuraAmbigua = ambiguos >= 2 || (nEval > 0 && proporcion(ambiguos) >= EP_PROPORCION_EJERCICIOS);
    var sinEntrenarMucho = input.diasDesdeUltimaSesionRutina !== null && input.diasDesdeUltimaSesionRutina > EP_DIAS_SIN_ENTRENAR;

    var sesionesVentana = input.semanas.reduce(function (acc, s) { return acc + s.sesiones; }, 0);
    var sinRpeVentana = input.semanas.reduce(function (acc, s) { return acc + s.sesionesSinRpe; }, 0);
    var proporcionSinRpe = sesionesVentana > 0 ? sinRpeVentana / sesionesVentana : 0;

    var futbolRpes = input.futbolContexto.map(function (f) { return f.rpe; }).filter(function (r) { return r !== null; });
    var futbolMinutos = input.futbolContexto.reduce(function (acc, f) { return acc + (Number(f.duracion_min) || 0); }, 0);

    var senales = {
      rpeAlto: senal(s1, plural(rpeAltas14, "sesión", "sesiones") + " de gimnasio con RPE ≥ " + EP_RPE_ALTO + " en los últimos 14 días"),
      caidaRendimiento: senal(s2, conCaida.length + " de " + nEval + " ejercicios comparables bajaron su rendimiento principal (" + plural(sesionesConCaida, "sesión", "sesiones distintas") + ")"),
      tendenciaNegativa: senal(s3, conTendenciaNegativa.length + " de " + nEval + " ejercicios con tendencia negativa en sus últimas ejecuciones"),
      caidaCargaMantenida: senal(s4, plural(conCaidaMismaCarga.length, "ejercicio bajó", "ejercicios bajaron") + " reps con la misma carga principal (" + plural(sesionesS4, "sesión", "sesiones distintas") + ")"),
      rpeEnAlza: senal(s5, (rpePromedio14 !== null && rpePromedioPrevio !== null)
        ? "RPE promedio " + formatearDecimal(rpePromedioPrevio) + " → " + formatearDecimal(rpePromedio14) + " (14 días previos → últimos 14 días)"
        : "Sin RPE suficiente para comparar los últimos 28 días"),
      adherenciaBaja: senal(adherenciaBaja, semanasAdherenciaBaja + " de las últimas " + cerradasAdherencia.length + " semanas cerradas con menos de la mitad de los bloques realizados"),
      semanaLiviana: senal(!!semanaLiviana, semanaLiviana
        ? "La semana del " + formatearDiaMesISO(semanaLiviana.semanaISO) + " fue sensiblemente más liviana (volumen " + formatearPctEntero(semanaLiviana.cambioVolumenPct) + ", RPE promedio " + formatearDecimal(semanaLiviana.rpePromedio) + ")"
        : "Sin una semana claramente más liviana"),
      futbol: senal(false, input.futbolContexto.length
        ? plural(input.futbolContexto.length, "sesión", "sesiones") + " de fútbol en 14 días" + (futbolRpes.length ? " · RPE promedio " + formatearDecimal(promedioSimple(futbolRpes)) : "") + " · " + futbolMinutos + " min (solo contexto)"
        : "Sin fútbol en los últimos 14 días (solo contexto)")
    };

    var contexto = {
      inicioObservadoISO: input.inicioObservadoISO,
      semanaDeRegistros: input.semanaDeRegistros,
      semanasCerradasDesdeInicio: input.semanasCerradasDesdeInicio,
      semanasCerradasConDatos: input.semanasCerradasConDatos,
      semanasAnalizadas: semanasCerradas.length,
      sesionesDeLaRutina: input.sesionesDeLaRutina,
      rpePromedioRutina: input.rpePromedioRutina,
      rpePromedio14: rpePromedio14,
      ejerciciosEvaluables: nEval,
      ejerciciosAmbiguos: ambiguos,
      semanaEnCurso: semanaEnCurso ? { sesiones: semanaEnCurso.sesiones, bloquesRealizados: semanaEnCurso.bloquesRealizados, bloquesPlanificados: semanaEnCurso.bloquesPlanificados } : null,
      futbol: { sesiones: input.futbolContexto.length, rpePromedio: promedioSimple(futbolRpes), minutos: futbolMinutos },
      auxiliares: { saltoReciente: saltoReciente, esfuerzoEnAlza: esfuerzoEnAlza, estructuraAmbigua: estructuraAmbigua, sinEntrenarMucho: sinEntrenarMucho, proporcionSinRpe: proporcionSinRpe }
    };

    /* 1. Datos insuficientes. */
    if (!input.cantidadBloquesActivos || input.semanasCerradasConDatos < 2) {
      var faltan = Math.max(1, 2 - input.semanasCerradasConDatos);
      var motivosInsuf = [];
      if (!input.cantidadBloquesActivos) {
        motivosInsuf.push("La rutina actual no tiene bloques cargados.");
      } else if (!input.inicioObservadoISO) {
        motivosInsuf.push("Todavía no hay sesiones registradas con los bloques de la rutina actual.");
      } else {
        motivosInsuf.push(plural(input.sesionesDeLaRutina, "sesión registrada", "sesiones registradas") + " desde el inicio observado (" + formatearDiaMesISO(input.inicioObservadoISO) + ")" +
          (input.rpePromedioRutina !== null ? " · RPE promedio " + formatearDecimal(input.rpePromedioRutina) : ""));
        motivosInsuf.push(input.semanasCerradasConDatos + " semana" + (input.semanasCerradasConDatos === 1 ? "" : "s") + " cerrada" + (input.semanasCerradasConDatos === 1 ? "" : "s") + " con entrenamientos de esta rutina; se necesitan 2 para una lectura inicial");
      }
      return {
        estado: null,
        confianza: "insuficiente",
        motivos: motivosInsuf,
        senales: senales,
        sugerencia: input.cantidadBloquesActivos
          ? "Seguí registrando tus sesiones. Con aproximadamente " + faltan + " semana" + (faltan === 1 ? "" : "s") + " cerrada" + (faltan === 1 ? "" : "s") + " más con entrenamientos vas a tener una lectura inicial."
          : "Cargá tu rutina para empezar a leer el estado del plan.",
        contexto: contexto
      };
    }

    var fatigas = [s1, s2, s3, s4, s5].filter(Boolean).length;
    var hayRendimiento = s2 || s3 || s4;

    /* Motivos con datos concretos, en orden de relevancia. */
    var motivos = [];
    function agregar(cond, texto) { if (cond && motivos.indexOf(texto) === -1) motivos.push(texto); }

    var estado;
    if ((s1 && (s2 || s4)) || (s2 && s3) || (fatigas >= 3 && hayRendimiento)) {
      estado = "descargar";
      agregar(s1, senales.rpeAlto.detalle);
      agregar(s4, senales.caidaCargaMantenida.detalle);
      agregar(s2, senales.caidaRendimiento.detalle);
      agregar(s3, senales.tendenciaNegativa.detalle);
      agregar(s5, senales.rpeEnAlza.detalle);
    } else if (fatigas >= 1 || saltoReciente || (rpePromedio14 !== null && rpePromedio14 >= EP_RPE_PROMEDIO_ALTO) ||
        adherenciaBaja || sinEntrenarMucho || semanaLiviana || esfuerzoEnAlza) {
      estado = "consolidar";
      agregar(sinEntrenarMucho, input.diasDesdeUltimaSesionRutina + " días sin entrenar con esta rutina: retomá de a poco antes de progresar");
      agregar(s1, senales.rpeAlto.detalle);
      agregar(s2, senales.caidaRendimiento.detalle);
      agregar(s4, senales.caidaCargaMantenida.detalle);
      agregar(s3, senales.tendenciaNegativa.detalle);
      agregar(s5, senales.rpeEnAlza.detalle);
      agregar(esfuerzoEnAlza && !s5, "El RPE promedio subió de " + formatearDecimal(rpePromedioPrevio || 0) + " a " + formatearDecimal(rpePromedio14 || 0) + " aunque el rendimiento sigue mejorando");
      agregar(rpePromedio14 !== null && rpePromedio14 >= EP_RPE_PROMEDIO_ALTO, "RPE promedio de " + formatearDecimal(rpePromedio14 || 0) + " en los últimos 14 días");
      agregar(saltoReciente, plural(Math.max(conSalto.length, conTendenciaMuyAlta.length), "ejercicio", "ejercicios") + " con un salto fuerte reciente de carga o rendimiento");
      agregar(adherenciaBaja, senales.adherenciaBaja.detalle + ": primero recuperá regularidad");
      agregar(!!semanaLiviana, senales.semanaLiviana.detalle + "; sin una marca de descarga no se puede saber si fue intencional");
    } else if (esIntensificable()) {
      estado = "intensificar";
      agregar(true, "Adherencia de 75% o más en las últimas " + EP_SEMANAS_INTENSIFICAR + " semanas cerradas");
      agregar(true, (nEval - conCaida.length) + " de " + nEval + " ejercicios comparables mejoraron o se mantuvieron, sin caídas");
      agregar(true, "RPE promedio de " + formatearDecimal(rpeIntensificar()) + " en esas semanas, sin señales de fatiga");
    } else {
      estado = "progresar";
      agregar(nEval > 0, (nEval - conCaida.length) + " de " + nEval + " ejercicios comparables mejoraron o se mantuvieron");
      agregar(rpePromedio14 !== null, "RPE promedio de " + formatearDecimal(rpePromedio14 || 0) + " en los últimos 14 días");
      agregar(true, "Sin acumulación de señales de fatiga");
    }

    /* Sesión aislada: se informa, nunca cambia el estado por sí sola. */
    if (conCaida.length >= 2 && sesionesConCaida === 1) {
      var fechaAislada = ultimaComp(conCaida[0]).fechaISO;
      agregar(true, "La sesión del " + formatearDiaMesISO(fechaAislada) + " mostró caídas en " + conCaida.length + " ejercicios, pero una sesión aislada no alcanza para cambiar el estado");
    }
    agregar(!!semanaLiviana && estado !== "consolidar", senales.semanaLiviana.detalle + "; sin una marca de descarga no se puede saber si fue intencional");
    if (motivos.length < 2) agregar(input.futbolContexto.length > 0, senales.futbol.detalle);
    motivos = motivos.slice(0, 4);

    /* Confianza. */
    var confianza = "normal";
    if (input.semanasCerradasDesdeInicio < EP_SEMANAS_VENTANA || nEval < EP_MIN_EJERCICIOS_EVALUABLES ||
        proporcionSinRpe > 0.3 || estructuraAmbigua || semanaLiviana) {
      confianza = "inicial";
    }

    return {
      estado: estado,
      confianza: confianza,
      motivos: motivos,
      senales: senales,
      sugerencia: SUGERENCIAS_ESTADO_PLAN[estado],
      contexto: contexto
    };

    /* Intensificar: 3+ semanas cerradas consecutivas (las últimas) con
       adherencia >= 75%, 3+ ejercicios evaluables sin caídas, mayoría con
       margen (sin caída ni salto), RPE <= 7,5 y ninguna señal ni auxiliar. */
    function semanasIntensificar() {
      return semanasCerradas.slice(-EP_SEMANAS_INTENSIFICAR);
    }
    function rpeIntensificar() {
      var todos = [];
      semanasIntensificar().forEach(function (s) { todos = todos.concat(s.rpes); });
      return promedioSimple(todos);
    }
    function esIntensificable() {
      var ultimas = semanasIntensificar();
      if (ultimas.length < EP_SEMANAS_INTENSIFICAR) return false;
      if (!ultimas.every(function (s) { return s.adherencia >= EP_ADHERENCIA_INTENSIFICAR; })) return false;
      if (nEval < EP_MIN_EJERCICIOS_EVALUABLES || conCaida.length > 0) return false;
      var conMargen = evaluables.filter(function (e) { var c = ultimaComp(e); return !c.esCaida && !c.esSalto; }).length;
      if (!(proporcion(conMargen) > 0.5)) return false;
      var rpe = rpeIntensificar();
      if (rpe === null || rpe > EP_RPE_INTENSIFICAR_MAX) return false;
      if (rpePromedio14 !== null && rpePromedio14 > EP_RPE_INTENSIFICAR_MAX) return false;
      return !estructuraAmbigua;
    }
  }

  var SUGERENCIAS_ESTADO_PLAN = {
    progresar: "Seguí con la progresión gradual que sugieren tus recomendaciones por bloque y por ejercicio, priorizando la técnica.",
    consolidar: "Sostené las cargas y series actuales y buscá repetir o mejorar levemente el rendimiento antes de volver a subir.",
    intensificar: "Podés acercar gradualmente el esfuerzo de las series principales al objetivo de tu plan, sin llegar al fallo.",
    descargar: "Durante una semana, reducí aproximadamente entre un tercio y la mitad de las series efectivas y mantené el esfuerzo alrededor de RPE 6–7. Después volvé a evaluar. Si tu entrenador indicó otra pauta, priorizá esa."
  };

  /* --- UI de PROG-04 --- */

  var PRESENTACION_ESTADO_PLAN = {
    progresar: { emoji: "🟢", etiqueta: "Progresar", clase: "optimo" },
    consolidar: { emoji: "🟡", etiqueta: "Consolidar", clase: "mantenimiento" },
    intensificar: { emoji: "🔵", etiqueta: "Intensificar", clase: "alto" },
    descargar: { emoji: "🟠", etiqueta: "Descargar / recuperar", clase: "agresivo" },
    insuficiente: { emoji: "⚪", etiqueta: "Datos insuficientes", clase: "neutro" }
  };

  var NOMBRES_SENALES_PLAN = [
    ["rpeAlto", "RPE alto"],
    ["caidaRendimiento", "Caída de rendimiento"],
    ["tendenciaNegativa", "Tendencia negativa"],
    ["caidaCargaMantenida", "Caída con carga mantenida"],
    ["rpeEnAlza", "RPE en alza"],
    ["adherenciaBaja", "Adherencia"],
    ["semanaLiviana", "Semana liviana aparente"],
    ["futbol", "Fútbol reciente (contexto)"]
  ];

  function renderSeccionEstadoPlan(r) {
    var pres = PRESENTACION_ESTADO_PLAN[r.estado || "insuficiente"];
    var c = r.contexto;
    var lineasContexto = [];
    if (c.inicioObservadoISO) {
      lineasContexto.push("Semana " + c.semanaDeRegistros + " de registros de esta rutina");
      lineasContexto.push("Inicio observado: " + formatearDiaMesISO(c.inicioObservadoISO));
      lineasContexto.push(c.semanasAnalizadas + " semana" + (c.semanasAnalizadas === 1 ? "" : "s") + " cerrada" + (c.semanasAnalizadas === 1 ? "" : "s") + " analizada" + (c.semanasAnalizadas === 1 ? "" : "s"));
    }

    var esc = GYMAPP.util.escapeHtml;
    return (
      '<div class="progreso-panel progreso-estado-plan">' +
      "<h3>Estado del plan</h3>" +
      '<div class="estado-plan-cabecera">' +
      '<span class="analisis-badge analisis-badge-' + pres.clase + '">' + pres.emoji + " " + esc(pres.etiqueta) + "</span>" +
      '<span class="estado-plan-chip">Confianza: ' + esc(r.confianza) + "</span>" +
      "</div>" +
      (lineasContexto.length ? '<p class="nota estado-plan-contexto">' + lineasContexto.map(esc).join(" · ") + "</p>" : "") +
      (r.motivos.length ? '<ul class="estado-plan-motivos">' + r.motivos.map(function (m) { return "<li>" + esc(m) + "</li>"; }).join("") + "</ul>" : "") +
      '<p class="nota estado-plan-sugerencia"><strong>Sugerencia:</strong> ' + esc(r.sugerencia) + "</p>" +
      '<details class="estado-plan-senales"><summary>Señales</summary><ul>' +
      NOMBRES_SENALES_PLAN.map(function (par) {
        var s = r.senales[par[0]];
        var marca = par[0] === "futbol" ? "ℹ️" : (s.activa ? "⚠️" : "✓");
        return "<li>" + marca + " <strong>" + esc(par[1]) + ":</strong> " + esc(s.detalle) + "</li>";
      }).join("") +
      "</ul></details>" +
      '<p class="nota estado-plan-nota">Lectura orientativa basada en tus registros. No reemplaza el criterio de tu entrenador.</p>' +
      "</div>"
    );
  }

  /* Aviso para PROG-02/03: PROG-04 solo puede volver la lectura más
     conservadora, nunca más agresiva. No cambia sus rangos ni estados. */
  function avisoEstadoPlanParaProximaSesion(r) {
    if (!r) return "";
    if (r.estado === "descargar") {
      return '<p class="nota proxima-sesion-nota proxima-sesion-advertencia">⚠ El estado general sugiere recuperar. Priorizá esta lectura por sobre la progresión puntual.</p>';
    }
    if (r.estado === "consolidar") {
      return '<p class="nota proxima-sesion-nota proxima-sesion-advertencia">⚠ Preferí el extremo bajo del rango de progresión.</p>';
    }
    return "";
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

  /* --- UI: sección "Próxima sesión" / "Próxima vez en este ejercicio" ---
     (PROG-02 / PROG-03)

     Vive debajo de "Análisis semanal" y reacciona a la MISMA selección de
     bloque/ejercicio (estadoAnalisis): no tiene selector propio. Sección
     16 del pedido de PROG-03: nunca se muestran ambas recomendaciones a
     la vez. "Todo el bloque" (ejercicioId vacío) -> PROG-02; un ejercicio
     puntual seleccionado -> PROG-03. Un bloque histórico (ya no activo)
     sigue sin recomendación de bloque (ya no hay "próxima sesión" que
     planificar para un bloque que no se entrena), pero un EJERCICIO
     histórico sí sigue siendo analizable (PROG-03 sección 17: depende
     solo del historial de sesiones, nunca de si el bloque sigue activo). */

  function renderSeccionProximaSesion(data, estadoPlan) {
    var opcionesBloques = construirOpcionesBloquesAnalisis(data);
    if (!opcionesBloques.length || !estadoAnalisis.bloqueId) return "";

    var titulo;
    var cuerpo;

    if (estadoAnalisis.ejercicioId) {
      titulo = "Próxima vez en este ejercicio";
      cuerpo = renderProximaVezEjercicio(data);
    } else {
      titulo = "Próxima sesión";
      var esActivo = bloqueEsActivo(data, estadoAnalisis.bloqueId);
      if (!esActivo) {
        cuerpo = '<p class="nota">Este bloque ya no forma parte de la rutina actual.</p>';
      } else {
        var serieBloque = construirSerieSemanalBloque(data.sesiones_entrenamiento, estadoAnalisis.bloqueId);
        cuerpo = renderProximaSesionBloque(serieBloque);
      }
    }

    return (
      '<div class="progreso-panel progreso-proxima-sesion">' +
      "<h3>" + titulo + "</h3>" +
      cuerpo +
      avisoEstadoPlanParaProximaSesion(estadoPlan) +
      "</div>"
    );
  }

  function renderProximaSesionBloque(serie) {
    if (!serie.length) {
      return '<p class="nota">Todavía no hay sesiones registradas para este bloque.</p>';
    }

    var cantidadRealizadas = contarSemanasRealizadas(serie);
    var ultimaRealizada = obtenerUltimaSemanaRealizada(serie);

    if (!ultimaRealizada || cantidadRealizadas < 2) {
      return '<p class="nota">Necesitamos al menos 2 sesiones para recomendar una progresión.</p>';
    }

    /* Sección 1 y PROG-01.2: nunca se pasa el cambio/tendencia de la serie
       completa (con huecos), sino los de la última semana REALIZADA, para
       no usar una semana 0/1 como caída de rendimiento. RPE y volumen
       también salen de esa misma última semana realizada, nunca de un
       promedio histórico (sección 5: "no usar RPE promedio histórico"). */
    var recomendacion = calcularRecomendacionProximaSesion({
      ultimoCambio: ultimaRealizada.cambioPct,
      tendencia3: ultimaRealizada.tendencia3,
      rpe: ultimaRealizada.datos.rpePromedio,
      volumenUltimaSesion: ultimaRealizada.datos.volumenPromedioPorSesion,
      cantidadSesiones: cantidadRealizadas,
      adherenciaBaja: calcularAdherenciaBaja(serie)
    });

    if (recomendacion.confianza === CONFIANZA_SIN_DATOS) {
      return '<p class="nota">' + recomendacion.mensaje + "</p>";
    }

    return renderTarjetaRecomendacion(recomendacion, ultimaRealizada.cambioPct);
  }

  function formatearPctEntero(n) {
    var signo = n > 0 ? "+" : "";
    return signo + Math.round(n) + "%";
  }

  function formatearRangoPct(rango) {
    if (rango.min === rango.max) return formatearPctEntero(rango.min);
    return formatearPctEntero(rango.min) + " a " + formatearPctEntero(rango.max);
  }

  function formatearRangoVolumen(volumenObjetivo) {
    if (volumenObjetivo.min === volumenObjetivo.max) return formatearKg(volumenObjetivo.min);
    return volumenObjetivo.min.toLocaleString("es-AR") + "–" + volumenObjetivo.max.toLocaleString("es-AR") + " kg";
  }

  /* Badge: reutiliza el MISMO componente visual y los MISMOS 5 colores que
     "Análisis semanal" (sección 13: "no crear colores nuevos"), coloreado
     según la categoría del último cambio real (clasificarProgreso), con
     el texto prescriptivo propio de la recomendación (estado) en vez de
     la etiqueta descriptiva genérica. */
  function renderTarjetaRecomendacion(r, ultimoCambio) {
    var clasif = clasificarProgreso(ultimoCambio);
    var etiquetaConfianza = r.confianza === CONFIANZA_NORMAL ? "Normal" : "Inicial";

    var filas = [["🎯 Objetivo sugerido", formatearRangoPct(r.rango)]];
    if (r.volumenObjetivo) {
      filas.push(["Volumen orientativo", formatearRangoVolumen(r.volumenObjetivo)]);
    }

    return (
      '<div class="analisis-semana-actual proxima-sesion-tarjeta">' +
      '<div class="analisis-stats">' +
      filas.map(function (f) {
        return '<div class="analisis-stat"><span class="analisis-stat-label">' + f[0] + '</span><span class="analisis-stat-valor">' + f[1] + "</span></div>";
      }).join("") +
      "</div>" +
      (clasif ? '<div class="analisis-badge analisis-badge-' + clasif.nivel + '">' + clasif.emoji + " " + GYMAPP.util.escapeHtml(r.estado) + "</div>" : "") +
      '<p class="nota proxima-sesion-nota"><strong>Prioridad:</strong> ' + GYMAPP.util.escapeHtml(r.accion.corta) + "</p>" +
      '<p class="nota proxima-sesion-nota">' + GYMAPP.util.escapeHtml(r.accion.larga) + "</p>" +
      '<p class="nota proxima-sesion-nota"><strong>Motivo:</strong> ' + GYMAPP.util.escapeHtml(r.motivo) + (r.notaTendencia ? " " + GYMAPP.util.escapeHtml(r.notaTendencia) : "") + "</p>" +
      (r.advertenciaAdherencia ? '<p class="nota proxima-sesion-nota proxima-sesion-advertencia">⚠ ' + GYMAPP.util.escapeHtml(r.advertenciaAdherencia) + "</p>" : "") +
      (!r.rpeDisponible ? '<p class="nota proxima-sesion-nota">RPE no disponible: recomendación con menor confianza.</p>' : "") +
      '<p class="nota proxima-sesion-nota"><strong>Confianza:</strong> ' + etiquetaConfianza + "</p>" +
      '<p class="nota proxima-sesion-nota">Considerá una serie adicional solo si varias semanas siguen estancadas y recuperás bien.</p>' +
      '<p class="nota proxima-sesion-nota">Usá técnica y sensaciones como prioridad. El objetivo es orientativo.</p>' +
      "</div>"
    );
  }

  /* --- UI: "Próxima vez en este ejercicio" (PROG-03) --- */

  function renderProximaVezEjercicio(data) {
    var ejecuciones = reconstruirEjecucionesEjercicio(data.sesiones_entrenamiento, estadoAnalisis.ejercicioId);
    if (!ejecuciones.length) {
      return '<p class="nota">Todavía no hay registros de este ejercicio.</p>';
    }

    var serieConCambios = construirSerieEjecucionesConCambios(ejecuciones);
    var ultimo = serieConCambios[serieConCambios.length - 1];
    var anterior = serieConCambios.length >= 2 ? serieConCambios[serieConCambios.length - 2] : null;

    var ejercicioRutina = obtenerEjercicioDeRutina(data, estadoAnalisis.bloqueId, estadoAnalisis.ejercicioId);
    var rangoReps = ejercicioRutina ? parsearRangoReps(ejercicioRutina.reps_objetivo) : null;

    var recomendacion = calcularRecomendacionEjercicio({
      cantidadEjecuciones: ejecuciones.length,
      pesoMaximoUltimo: ultimo.datos.pesoMaximo,
      cambioPesoMaximoPct: anterior ? calcularCambioPorcentual(ultimo.datos.pesoMaximo, anterior.datos.pesoMaximo) : null,
      repsTotalesUltimo: ultimo.datos.repsTotales,
      cambioRepsPct: anterior ? calcularCambioPorcentual(ultimo.datos.repsTotales, anterior.datos.repsTotales) : null,
      cambioVolumenPct: ultimo.cambioPct,
      tendenciaVolumen: ultimo.tendencia3,
      rpeSesion: ultimo.datos.rpeSesion,
      rangoReps: rangoReps,
      repsEnSeriesPrincipales: ultimo.datos.repsEnSeriesPrincipales
    });

    if (recomendacion.confianza === "insuficiente") {
      return '<p class="nota">' + recomendacion.mensaje + "</p>";
    }

    return renderTarjetaRecomendacionEjercicio(recomendacion, ultimo.datos);
  }

  var ICONO_ESTADO_EJERCICIO = {
    "Sumar repeticiones": "↑",
    "Subir carga": "↑",
    "Mantener y consolidar": "■",
    "Recuperar rendimiento": "↓",
    "Seguimiento cualitativo": "•"
  };

  /* "Última referencia" (sección 15): peso máximo + reps de CADA serie de
     la última ejecución (no solo las "principales": acá es solo una
     referencia informativa, no la señal usada para decidir la regla).
     Con peso corporal nunca se inventa un "0 kg" (sección 13: nada de
     kilos ficticios), se muestran directamente las reps. */
  function formatearUltimaReferenciaEjercicio(datosUltimaEjecucion) {
    var repsPorSerie = datosUltimaEjecucion.series.map(function (s) { return Number(s.reps) || 0; }).join("/");
    if (datosUltimaEjecucion.pesoMaximo === 0) {
      return repsPorSerie + " reps";
    }
    return formatearKg(datosUltimaEjecucion.pesoMaximo) + " · " + repsPorSerie;
  }

  function renderTarjetaRecomendacionEjercicio(r, datosUltimaEjecucion) {
    var etiquetaConfianza = r.confianza === "normal" ? "Normal" : "Inicial";
    var icono = ICONO_ESTADO_EJERCICIO[r.estado] || "";

    return (
      '<div class="analisis-semana-actual proxima-sesion-tarjeta">' +
      '<div class="analisis-stats">' +
      '<div class="analisis-stat"><span class="analisis-stat-label">Estado</span><span class="analisis-stat-valor">' + icono + " " + GYMAPP.util.escapeHtml(r.estado) + "</span></div>" +
      '<div class="analisis-stat"><span class="analisis-stat-label">Última referencia</span><span class="analisis-stat-valor">' + GYMAPP.util.escapeHtml(formatearUltimaReferenciaEjercicio(datosUltimaEjecucion)) + "</span></div>" +
      "</div>" +
      '<p class="nota proxima-sesion-nota"><strong>Sugerencia:</strong> ' + GYMAPP.util.escapeHtml(r.sugerencia) + "</p>" +
      '<p class="nota proxima-sesion-nota"><strong>Motivo:</strong> ' + GYMAPP.util.escapeHtml(r.motivo) + "</p>" +
      '<p class="nota proxima-sesion-nota"><strong>Confianza:</strong> ' + etiquetaConfianza + "</p>" +
      (r.rpeDisponible
        ? '<p class="nota proxima-sesion-nota"><strong>Contexto:</strong> RPE de la sesión: ' + datosUltimaEjecucion.rpeSesion + "</p>"
        : "") +
      '<p class="nota proxima-sesion-nota">Usá técnica y sensaciones como prioridad. El objetivo es orientativo.</p>' +
      "</div>"
    );
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
    formatearCambioHistorial: formatearCambioHistorial,
    /* PROG-02: expuestas para pruebas unitarias del motor de recomendación. */
    calcularRecomendacionProximaSesion: calcularRecomendacionProximaSesion,
    contarSemanasRealizadas: contarSemanasRealizadas,
    calcularAdherenciaBaja: calcularAdherenciaBaja,
    /* PROG-03: expuestas para pruebas unitarias del motor por ejercicio. */
    reconstruirEjecucionesEjercicio: reconstruirEjecucionesEjercicio,
    construirSerieEjecucionesConCambios: construirSerieEjecucionesConCambios,
    parsearRangoReps: parsearRangoReps,
    obtenerEjercicioDeRutina: obtenerEjercicioDeRutina,
    calcularRecomendacionEjercicio: calcularRecomendacionEjercicio,
    /* PROG-04: expuestas para pruebas unitarias del estado del plan. */
    analizarSeriesPrincipales: analizarSeriesPrincipales,
    compararEjecucionesPrincipales: compararEjecucionesPrincipales,
    construirInputEstadoPlan: construirInputEstadoPlan,
    calcularEstadoPlan: calcularEstadoPlan,
    renderSeccionEstadoPlan: renderSeccionEstadoPlan
  };
})();
