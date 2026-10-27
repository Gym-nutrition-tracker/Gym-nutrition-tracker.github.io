/* Pestaña Dashboard: metas diarias, resumen semanal, próximo día sugerido, alertas y peso corporal. */
var GYMAPP = window.GYMAPP || (window.GYMAPP = {});

GYMAPP.dashboard = (function () {
  var esc = GYMAPP.util.escapeHtml;

  function render(container) {
    var data = GYMAPP.storage.getData();
    container.innerHTML = template(data);
    if (!container.dataset.dashboardBound) {
      bindEventos(container);
      container.dataset.dashboardBound = "1";
    }
    dibujarGraficoPeso(container, data);
  }

  /* --- Fechas --- */

  function fechaISO(date) {
    return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");
  }

  function ultimosNDiasISO(n) {
    var dias = [];
    for (var i = n - 1; i >= 0; i--) {
      var d = new Date();
      d.setDate(d.getDate() - i);
      dias.push(fechaISO(d));
    }
    return dias;
  }

  /* Lunes=0 ... Domingo=6, a diferencia de Date#getDay() que arranca en domingo. */
  function diaDeSemanaLunesPrimero(date) {
    return (date.getDay() + 6) % 7;
  }

  /* --- Cálculos --- */

  function obtenerDiasSemanaActualISO() {
    var hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    var lunes = new Date(hoy);
    lunes.setDate(lunes.getDate() - diaDeSemanaLunesPrimero(hoy));

    var dias = [];
    for (var i = 0; i < 7; i++) {
      var d = new Date(lunes);
      d.setDate(d.getDate() + i);
      dias.push(fechaISO(d));
    }
    return dias;
  }

  /* ACT-04: metas de días únicos por semana calendario (lunes a domingo,
     mismo rango que renderTiraSemana), una por cada actividad configurada en
     usuario.actividades (nunca una lista fija de 2). Usa el mapa compartido
     GYMAPP.actividades.obtenerActividadesPorDia, que ya cuenta días únicos
     (no sesiones), así que "gimnasio+pádel el mismo día" suma 1 a cada meta
     y "dos sesiones del mismo tipo el mismo día" no duplica el avance.
     Una actividad desactivada simplemente no aparece (no está en
     usuario.actividades), pero su historial sigue intacto y sigue contando
     para racha/días activos en otro lado. */
  function calcularProgresoSemanal(data) {
    var diasSemana = obtenerDiasSemanaActualISO();
    var mapaDias = GYMAPP.actividades.obtenerActividadesPorDia(data.sesiones_entrenamiento);
    var actividadesUsuario = GYMAPP.actividades.obtenerActividadesUsuario(data.usuario);

    return actividadesUsuario.map(function (a) {
      var actual = 0;
      diasSemana.forEach(function (key) {
        var tiposDelDia = mapaDias[key] || [];
        if (tiposDelDia.indexOf(a.tipo) !== -1) actual++;
      });
      var actividad = GYMAPP.actividades.obtenerActividadPorId(a.tipo);
      return {
        tipo: a.tipo,
        nombre: actividad ? actividad.nombre : a.tipo,
        icono: actividad ? actividad.icono : "🏃",
        color: actividad ? actividad.color : "var(--color-texto-secundario)",
        actual: actual,
        meta: a.meta_semanal
      };
    });
  }

  function calcularResumenSemanal(data) {
    var dias7 = ultimosNDiasISO(7);
    var sesiones7 = data.sesiones_entrenamiento.filter(function (s) { return dias7.indexOf(GYMAPP.util.fechaLocalISO(s.fecha)) !== -1; });
    var diasActivos7 = Object.keys(GYMAPP.actividades.obtenerActividadesPorDia(sesiones7)).length;
    var registros7 = data.registros_nutricion.filter(function (r) { return dias7.indexOf(r.fecha) !== -1 && r.cumplimiento; });
    var enObjetivo = registros7.filter(function (r) { return r.cumplimiento === "en_objetivo"; }).length;

    /* diasActivos7 se agrega sin tocar los campos existentes (sesiones,
       diasCerrados, diasEnObjetivo), que ya se usan en pruebas de PRO-01/02. */
    return { sesiones: sesiones7.length, diasActivos7: diasActivos7, diasCerrados: registros7.length, diasEnObjetivo: enObjetivo };
  }

  function calcularProximoDia(data) {
    var dias = GYMAPP.planes.diasDelPlanActivo(data);
    if (!dias.length) return null;

    var sesionesGimnasio = data.sesiones_entrenamiento
      .filter(function (s) { return s.tipo === "gimnasio" && s.dia_rutina_id; })
      .sort(function (a, b) { return new Date(b.fecha) - new Date(a.fecha); });

    if (!sesionesGimnasio.length) return dias[0];

    var indiceUltimo = dias.findIndex(function (d) { return d.id === sesionesGimnasio[0].dia_rutina_id; });
    if (indiceUltimo === -1) return dias[0];

    return dias[(indiceUltimo + 1) % dias.length];
  }

  /* DASH-04 (corrección confirmada): antes se tomaban los grupos musculares
     de dia.ejercicios (la configuración ACTUAL del día de rutina), no de lo
     que la sesión realmente registró. Si el día se editó después (se le
     cambiaron los ejercicios), la alerta comparaba grupos musculares que
     nunca se entrenaron en esa sesión. Ahora se derivan de
     ejercicios_realizados, la única fuente confiable de qué se entrenó. */
  /* El ejercicio se busca en TODOS los días del plan activo (mismo
     criterio que entrenamiento.js al editar sesiones históricas); null si
     ya no existe en ningún lado. */
  function obtenerGruposDeSesion(data, sesion) {
    var grupos = (sesion.ejercicios_realizados || []).map(function (er) {
      var ejercicio = GYMAPP.planes.buscarEjercicioActivo(data, er.ejercicio_id);
      return ejercicio ? (ejercicio.grupo_muscular || "").trim() : "";
    }).filter(Boolean);
    return grupos.filter(function (g, i) { return grupos.indexOf(g) === i; });
  }

  function calcularAlertaGrupoMuscular(data) {
    var sesionesGimnasio = data.sesiones_entrenamiento
      .filter(function (s) { return s.tipo === "gimnasio" && s.ejercicios_realizados && s.ejercicios_realizados.length; })
      .sort(function (a, b) { return new Date(b.fecha) - new Date(a.fecha); });

    if (sesionesGimnasio.length < 2) return null;

    var gruposA = obtenerGruposDeSesion(data, sesionesGimnasio[0]);
    var gruposB = obtenerGruposDeSesion(data, sesionesGimnasio[1]);
    var interseccion = gruposA.filter(function (g) { return gruposB.indexOf(g) !== -1; });

    return interseccion.length ? interseccion : null;
  }

  /* --- Datos de hoy (DASH-02) --- */

  /* Null si todavía no se registró ninguna comida hoy (no crea el registro:
     eso solo lo hace nutricion.js al agregar una comida). */
  function obtenerRegistroHoy(data) {
    var hoy = fechaISO(new Date());
    return data.registros_nutricion.filter(function (r) { return r.fecha === hoy; })[0] || null;
  }

  /* ACT-04: array de tipos entrenados hoy (nunca duplicado por tipo), en
     orden de catálogo. [] si todavía no entrenó ninguna actividad hoy.
     Reutiliza el mapa compartido (agrupa por día calendario LOCAL, no UTC),
     e incluye cualquier actividad con sesión hoy aunque ya no esté
     configurada en usuario.actividades. */
  function obtenerActividadesHoy(data) {
    var mapa = GYMAPP.actividades.obtenerActividadesPorDia(data.sesiones_entrenamiento);
    return mapa[fechaISO(new Date())] || [];
  }

  /* --- Peso corporal (DASH-05) --- */

  /* null si no hay ninguna medida. variacion es null si es el primer
     registro (no hay uno anterior con el que compararlo). */
  function calcularVariacionPeso(medidas) {
    if (!medidas.length) return null;
    var ordenadas = medidas.slice().sort(function (a, b) { return new Date(a.fecha) - new Date(b.fecha); });
    var ultimo = ordenadas[ordenadas.length - 1];
    var anterior = ordenadas.length > 1 ? ordenadas[ordenadas.length - 2] : null;
    var variacion = anterior ? Math.round((ultimo.peso_kg - anterior.peso_kg) * 10) / 10 : null;
    return { pesoActual: ultimo.peso_kg, variacion: variacion };
  }

  /* --- Templates --- */

  /* Layout (DASH-01): saludo -> alerta (si hay) -> columna principal (hoy +
     resumen semanal) -> columna lateral (próximo día + peso corporal). En
     mobile todo se apila en ese orden; en tablet/desktop pasa a 2 columnas
     (ver .dashboard-layout en styles.css, mismo patrón que .progreso-layout
     de PRO-04). */
  function template(data) {
    var metas = data.usuario.metas_macros;
    var resumen = calcularResumenSemanal(data);
    var rachas = GYMAPP.progreso.calcularRachas(GYMAPP.progreso.obtenerDiasActivosOrdenados(data.sesiones_entrenamiento));
    var proximoDia = calcularProximoDia(data);
    var gruposRepetidos = calcularAlertaGrupoMuscular(data);
    var registroHoy = obtenerRegistroHoy(data);
    var tiposHoy = obtenerActividadesHoy(data);
    var variacionPeso = calcularVariacionPeso(data.medidas_corporales);
    var progresoSemanal = calcularProgresoSemanal(data);

    return (
      '<div class="pantalla pantalla-dashboard">' +
      /* El saludo vive solo en el encabezado (con el avatar de PROFILE-01). */
      /* ONB-03: tarjeta de inicio (solo sin plan o sin entrenamientos). */
      (GYMAPP.primerUso ? GYMAPP.primerUso.renderTarjetaDashboard(data) : "") +
      renderHeroSemanal(progresoSemanal) +
      '<div id="dashboard-mensaje" class="mensaje oculto"></div>' +
      renderAlerta(gruposRepetidos) +
      '<div class="dashboard-layout">' +
      '<div class="dashboard-columna-principal">' +
      renderSeccionHoy(metas, registroHoy, tiposHoy) +
      renderSeccionResumenSemanal(data.sesiones_entrenamiento, resumen, rachas) +
      "</div>" +
      '<div class="dashboard-columna-lateral">' +
      renderSeccionProximoDia(proximoDia) +
      renderSeccionPeso(data, variacionPeso) +
      "</div>" +
      "</div>" +
      "</div>"
    );
  }

  /* --- Hero semanal (DASH-07/08, generalizado en ACT-04) ---
     Un anillo SVG por cada actividad configurada (1 a 6), con el progreso de
     días únicos de esta semana calendario contra su meta_semanal. Se arma
     como markup con el stroke-dashoffset ya calculado, sin necesidad de un
     paso de dibujo por JS después del innerHTML (a diferencia de Chart.js):
     es la opción más liviana y robusta para anillos estáticos por render.
     El color de cada anillo sale de la metadata del catálogo (item.color),
     nunca de una clase CSS por deporte: agregar una actividad nueva no
     requiere tocar el CSS del hero. */
  var RADIO_ANILLO = 42;
  var CIRCUNFERENCIA_ANILLO = 2 * Math.PI * RADIO_ANILLO;

  function renderHeroSemanal(progresoSemanal) {
    return (
      '<div class="dashboard-hero">' +
      '<span class="dashboard-hero-eyebrow">Meta semanal</span>' +
      "<h2 class=\"dashboard-hero-titulo\">Progreso de esta semana</h2>" +
      '<div class="dashboard-hero-anillos">' +
      progresoSemanal.map(renderAnillo).join("") +
      "</div>" +
      "</div>"
    );
  }

  function renderAnillo(item) {
    var pct = item.meta > 0 ? Math.min(1, item.actual / item.meta) : 0;
    var dashoffset = CIRCUNFERENCIA_ANILLO * (1 - pct);

    return (
      '<div class="anillo-item">' +
      '<div class="anillo-svg-wrap">' +
      '<svg class="anillo-svg" viewBox="0 0 100 100" aria-hidden="true">' +
      '<circle class="anillo-fondo" cx="50" cy="50" r="' + RADIO_ANILLO + '"></circle>' +
      '<circle class="anillo-progreso" cx="50" cy="50" r="' + RADIO_ANILLO + '" style="stroke:' + item.color + '"' +
      ' stroke-dasharray="' + CIRCUNFERENCIA_ANILLO.toFixed(2) + '" stroke-dashoffset="' + dashoffset.toFixed(2) + '"></circle>' +
      "</svg>" +
      '<div class="anillo-valor">' + item.actual + '<span class="anillo-valor-meta">/' + item.meta + "</span></div>" +
      "</div>" +
      '<span class="anillo-etiqueta">' + item.icono + " " + esc(item.nombre) + "</span>" +
      "</div>"
    );
  }

  function renderAlerta(gruposRepetidos) {
    if (!gruposRepetidos) return "";
    return (
      '<div class="dashboard-alerta">' +
      '<span class="dashboard-alerta-icono" aria-hidden="true">⚠️</span>' +
      "<span>Entrenaste " + esc(gruposRepetidos.join(", ")) + " dos veces seguidas. Considerá variar el grupo muscular.</span>" +
      "</div>"
    );
  }

  /* --- Sección "Hoy" (DASH-02) --- */

  function renderSeccionHoy(metas, registroHoy, tiposHoy) {
    var contenidoNutricion = registroHoy
      ? filaMacroDashboard("Calorías", registroHoy.totales_calculados.calorias, metas.calorias, "kcal") +
        filaMacroDashboard("Proteínas", registroHoy.totales_calculados.proteinas_g, metas.proteinas_g, "g") +
        filaMacroDashboard("Carbohidratos", registroHoy.totales_calculados.carbos_g, metas.carbos_g, "g") +
        filaMacroDashboard("Grasas", registroHoy.totales_calculados.grasas_g, metas.grasas_g, "g")
      : renderEstadoVacioNutricionHoy();

    return (
      '<div class="dashboard-panel">' +
      "<h3>Hoy</h3>" +
      contenidoNutricion +
      renderEstadoEntrenoHoy(tiposHoy) +
      "</div>"
    );
  }

  function filaMacroDashboard(nombre, real, objetivo, unidad) {
    var pct = objetivo > 0 ? Math.min(100, Math.round((real / objetivo) * 100)) : 0;
    return (
      '<div class="fila-macro">' +
      '<div class="fila-macro-header"><span>' + nombre + "</span><span>" + real + " / " + objetivo + " " + unidad + "</span></div>" +
      '<div class="barra-macro-fondo"><div class="barra-macro-relleno" style="width:' + pct + '%"></div></div>' +
      "</div>"
    );
  }

  function renderEstadoVacioNutricionHoy() {
    return (
      '<div class="dashboard-estado-vacio">' +
      '<span class="dashboard-estado-vacio-icono" aria-hidden="true">🍽️</span>' +
      '<p class="dashboard-estado-vacio-titulo">Todavía no registraste comidas hoy</p>' +
      '<button type="button" data-accion="ir-a-nutricion" class="btn btn-secundario btn-ancho">Registrar comida</button>' +
      "</div>"
    );
  }

  /* ACT-04: etiqueta dinámica según qué actividades (0 a N) se entrenaron
     hoy, usando nombre/ícono del catálogo. Una sola actividad muestra su
     nombre solo; varias se listan todas separadas por " · ", sin duplicar
     si hubo más de una sesión del mismo tipo (tiposHoy ya viene sin
     duplicados, ver obtenerActividadesHoy). */
  function renderEstadoEntrenoHoy(tiposHoy) {
    if (tiposHoy && tiposHoy.length) {
      var etiquetas = tiposHoy.map(function (t) {
        var actividad = GYMAPP.actividades.obtenerActividadPorId(t);
        return actividad ? actividad.icono + " " + esc(actividad.nombre) : esc(t);
      });
      return '<p class="dashboard-estado-entreno">Hoy: ' + etiquetas.join(" · ") + "</p>";
    }
    return (
      '<div class="dashboard-estado-vacio dashboard-estado-vacio-compacto">' +
      '<p class="nota">Todavía no entrenaste hoy.</p>' +
      '<button type="button" data-accion="ir-a-entrenar" class="btn btn-secundario btn-ancho">Registrar entrenamiento</button>' +
      "</div>"
    );
  }

  /* --- Sección "Esta semana" (DASH-03) --- */

  function renderSeccionResumenSemanal(sesiones, resumen, rachas) {
    return (
      '<div class="dashboard-panel">' +
      "<h3>Esta semana</h3>" +
      renderTiraSemana(sesiones) +
      '<div class="tarjetas-macros dashboard-resumen">' +
      tarjeta(resumen.diasActivos7, resumen.diasActivos7 === 1 ? "Día activo (7 días)" : "Días activos (7 días)") +
      tarjeta(resumen.sesiones, resumen.sesiones === 1 ? "Sesión (7 días)" : "Sesiones (7 días)") +
      tarjeta(rachas.actual, "Racha actual (días)") +
      tarjeta(resumen.diasCerrados ? resumen.diasEnObjetivo + "/" + resumen.diasCerrados : "—", "Días en objetivo (nutrición)") +
      "</div>" +
      "</div>"
    );
  }

  /* --- Sección "Próximo día sugerido" --- */

  function renderSeccionProximoDia(proximoDia) {
    var contenido = proximoDia
      ? '<p class="proximo-dia-sugerido">🏋️ ' + esc(proximoDia.nombre) + "</p>"
      : (
          '<div class="dashboard-estado-vacio">' +
          '<span class="dashboard-estado-vacio-icono" aria-hidden="true">📋</span>' +
          '<p class="dashboard-estado-vacio-titulo">Todavía no tenés días en tu rutina</p>' +
          '<button type="button" data-accion="ir-a-rutina" class="btn btn-secundario btn-ancho">Armar rutina</button>' +
          "</div>"
        );

    return '<div class="dashboard-panel"><h3>Próximo día sugerido</h3>' + contenido + "</div>";
  }

  /* --- Sección "Peso corporal" (DASH-05) --- */

  function renderSeccionPeso(data, variacionPeso) {
    var resumenPeso = variacionPeso
      ? renderResumenPeso(variacionPeso)
      : (
          '<div class="dashboard-estado-vacio">' +
          '<span class="dashboard-estado-vacio-icono" aria-hidden="true">⚖️</span>' +
          '<p class="dashboard-estado-vacio-titulo">Todavía no cargaste medidas corporales</p>' +
          "</div>"
        );

    var grafico = data.medidas_corporales.length
      ? '<div class="grafico-contenedor"><canvas id="grafico-peso-corporal"></canvas></div>'
      : "";

    return (
      '<div class="dashboard-panel">' +
      "<h3>Peso corporal</h3>" +
      resumenPeso +
      grafico +
      '<div class="registro-peso-rapido">' +
      /* Texto con teclado decimal: acepta "75,5" y "75.5" (type="number"
         pierde la coma). Se convierte con util.parsearDecimal. */
      '<input type="text" id="input-peso-hoy" inputmode="decimal" autocomplete="off" placeholder="Peso de hoy (kg)" />' +
      '<input type="text" id="input-cintura-hoy" inputmode="decimal" autocomplete="off" placeholder="Cintura (cm, opcional)" />' +
      '<button type="button" data-accion="guardar-peso" class="btn btn-secundario btn-ancho">Guardar medida</button>' +
      "</div>" +
      "</div>"
    );
  }

  function renderResumenPeso(v) {
    var textoVariacion;
    if (v.variacion === null) {
      textoVariacion = "Primer registro";
    } else if (v.variacion === 0) {
      textoVariacion = "➡️ Sin cambios desde el registro anterior";
    } else if (v.variacion > 0) {
      textoVariacion = "🔺 +" + v.variacion + " kg desde el registro anterior";
    } else {
      textoVariacion = "🔻 " + v.variacion + " kg desde el registro anterior";
    }
    return (
      '<div class="dashboard-peso-resumen">' +
      '<span class="dashboard-peso-valor">' + v.pesoActual + " kg</span>" +
      '<span class="nota">' + textoVariacion + "</span>" +
      "</div>"
    );
  }

  /* ACT-04: generalizada a N actividades (ya no gimnasio/fútbol/ambos). Cada
     columna muestra el número del día y un badge por actividad distinta ese
     día (nunca uno por sesión), igual criterio y mismo markup que el
     calendario de Progreso (ver GYMAPP.actividades.renderBadgesActividad,
     compartido entre ambas pantallas). Un día con varias actividades sigue
     contando como 1 solo día activo en el resto de los cálculos. */
  function renderTiraSemana(sesiones) {
    var etiquetas = ["L", "M", "M", "J", "V", "S", "D"];
    var mapaDias = GYMAPP.actividades.obtenerActividadesPorDia(sesiones);
    var hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    var hoyIso = fechaISO(hoy);

    var lunes = new Date(hoy);
    lunes.setDate(lunes.getDate() - diaDeSemanaLunesPrimero(hoy));

    var columnas = "";
    for (var i = 0; i < 7; i++) {
      var d = new Date(lunes);
      d.setDate(d.getDate() + i);
      var key = fechaISO(d);
      var tipos = mapaDias[key] || [];
      var clase = "calendario-dia" + (tipos.length ? " con-actividad" : "") + (key === hoyIso ? " hoy" : "");

      columnas += (
        '<div class="tira-semana-col">' +
        '<span class="tira-semana-letra">' + etiquetas[i] + "</span>" +
        '<span class="' + clase + '">' +
        '<span class="calendario-dia-numero">' + d.getDate() + "</span>" +
        GYMAPP.actividades.renderBadgesActividad(tipos) +
        "</span>" +
        "</div>"
      );
    }

    return '<div class="tira-semana">' + columnas + "</div>";
  }

  function tarjeta(valor, etiqueta) {
    return (
      '<div class="tarjeta-macro">' +
      '<span class="tarjeta-macro-valor">' + valor + "</span>" +
      '<span class="tarjeta-macro-nombre">' + etiqueta + "</span>" +
      "</div>"
    );
  }

  /* --- Gráfico de peso corporal --- */

  function dibujarGraficoPeso(container, data) {
    var canvas = container.querySelector("#grafico-peso-corporal");
    if (!canvas || !data.medidas_corporales.length) return;

    var medidas = data.medidas_corporales.slice().sort(function (a, b) { return new Date(a.fecha) - new Date(b.fecha); });
    var labels = medidas.map(function (m) {
      var d = new Date(m.fecha);
      return String(d.getDate()).padStart(2, "0") + "/" + String(d.getMonth() + 1).padStart(2, "0");
    });
    var valores = medidas.map(function (m) { return m.peso_kg; });

    GYMAPP.graficos.graficoLinea(canvas, labels, valores, "Peso (kg)");
  }

  /* --- Acciones --- */

  function guardarPeso(container) {
    var pesoInput = container.querySelector("#input-peso-hoy");
    var cinturaInput = container.querySelector("#input-cintura-hoy");
    var peso = GYMAPP.util.parsearDecimal(pesoInput.value);

    if (isNaN(peso) || peso <= 0) {
      mostrarMensaje(container, "Ingresá un peso válido.", "error");
      return;
    }

    var cintura = GYMAPP.util.parsearDecimal(cinturaInput.value);
    var fecha = fechaISO(new Date());

    var resultado = GYMAPP.storage.updateData(function (data) {
      var existente = data.medidas_corporales.filter(function (m) { return m.fecha === fecha; })[0];
      if (existente) {
        existente.peso_kg = peso;
        if (!isNaN(cintura)) existente.cintura_cm = cintura;
      } else {
        data.medidas_corporales.push({ fecha: fecha, peso_kg: peso, cintura_cm: isNaN(cintura) ? null : cintura });
      }
    }, { alertaAutomatica: false });
    if (!resultado.guardado) {
      mostrarMensaje(container, "No se pudo guardar la medida. Revisá el espacio disponible en tu dispositivo e intentá de nuevo.", "error");
      return;
    }

    render(container);
    mostrarMensaje(container, "Medida guardada.", "exito");
  }

  function mostrarMensaje(container, texto, tipo) {
    var el = container.querySelector("#dashboard-mensaje");
    if (!el) return;
    el.textContent = texto;
    el.className = "mensaje " + (tipo || "info");
  }

  /* --- Eventos --- */

  function bindEventos(container) {
    container.addEventListener("click", function (ev) {
      var boton = ev.target.closest("[data-accion]");
      if (!boton) return;
      var accion = boton.dataset.accion;

      if (accion === "guardar-peso") {
        guardarPeso(container);
      } else if (accion === "ir-a-nutricion") {
        var navNutricion = document.getElementById("nav-nutricion");
        if (navNutricion) navNutricion.click();
      } else if (accion === "ir-a-entrenar") {
        var navEntrenar = document.getElementById("nav-entrenar");
        if (navEntrenar) navEntrenar.click();
      } else if (accion === "ir-a-rutina") {
        var btnRutina = document.getElementById("btn-rutina");
        if (btnRutina) btnRutina.click();
      }
    });
  }

  return {
    render: render,
    /* Expuestas para pruebas unitarias. */
    calcularResumenSemanal: calcularResumenSemanal,
    calcularProgresoSemanal: calcularProgresoSemanal,
    calcularAlertaGrupoMuscular: calcularAlertaGrupoMuscular,
    calcularVariacionPeso: calcularVariacionPeso,
    obtenerActividadesHoy: obtenerActividadesHoy
  };
})();
