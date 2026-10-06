// Logica PURA de "Buscar reemplazo" (v1): dado un punto de la red NE como
// referencia, encuentra pozos candidatos de Provincia cercanos, los filtra
// y los ordena. Sin DOM, sin red - la testea Jest (js/buscarReemplazoLogic.test.js).
// El controlador (js/buscarReemplazo.js) solo pinta y llama a esto.
//
// Principios (decisiones aprobadas):
// - Coordenada de referencia = la PROPIA del punto NE (la que ve el mapa NE).
//   Si el mismo wellId tiene coordenada en Provincia y difiere >= 500 m solo
//   se AVISA (no bloquea y no se cambia la coordenada usada).
// - Nada se infiere: un dato ausente es "Sin dato" y no entra a ningun
//   calculo (diferencia de profundidad, orden por profundidad, filtros de
//   profundidad). Una profundidad atipica (> 1000 m, igual que el umbral
//   documentado en la metadata del mapa) se muestra pero tampoco se compara.
// - Sin score numerico compuesto: el orden es UNO a la vez (distancia,
//   diferencia de profundidad o estado de reemplazo) y cada candidato muestra
//   los datos crudos que lo explican (buscarReemplazoLogic_explicar).
// - Los puntos de la red NE quedan fuera por defecto (interruptor para
//   incluirlos), y los "No apto" tambien (interruptor para mostrarlos).
// - Cuenca: la clasificacion de la red NE (MI, MD, VdU, Este...) NO es la de
//   Provincia (Rio Mendoza, ...), por eso nunca se comparan entre si: la
//   cuenca del candidato solo se muestra y se puede filtrar entre candidatos.
//
// Depende de cercaMioLogic_* (haversine, bounding box, formato de distancia)
// y de reemplazoResumenLogic_* (estado de aptitud): globales en el navegador.

var BUSCAR_REEMPLAZO_RADIO_DEFAULT_METROS = 1000;
var BUSCAR_REEMPLAZO_PAGINA = 30;
var BUSCAR_REEMPLAZO_UMBRAL_COORDENADA_METROS = 500;
var BUSCAR_REEMPLAZO_PROFUNDIDAD_ATIPICA_METROS = 1000;
var BUSCAR_REEMPLAZO_ORDENES = ['distancia', 'profundidad', 'estado'];
// Prioridad del orden por estado: se explica en pantalla tal cual.
var BUSCAR_REEMPLAZO_PRIORIDAD_ESTADO = { APTO: 0, DUDOSO: 1, SIN_EVALUAR: 2, NO_APTO: 3 };
var BUSCAR_REEMPLAZO_SURGENCIAS = ['Natural', 'SemiSurgente', 'Profundo'];
var BUSCAR_REEMPLAZO_SURGENCIA_ETIQUETAS = {
  Natural: 'Surgente natural',
  SemiSurgente: 'Semisurgente',
  Profundo: 'Profundo (no surgente)'
};

// --- Formato ---

// 1234.5 -> "1.234,5"; 120 -> "120"; sin decimal cuando es redondo.
function buscarReemplazoLogic_formatearNumero(n) {
  var redondeado = Math.round(n * 10) / 10;
  var partes = String(Math.abs(redondeado)).split('.');
  var entera = partes[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return (redondeado < 0 ? '-' : '') + entera + (partes[1] ? ',' + partes[1] : '');
}

// Distancia en el mismo formato numerico de la pantalla (coma decimal):
// 820 m / 1,9 km / 2 km. (Cerca Mio usa punto; aca todo el resto de los
// numeros usa coma, y mezclar los dos en una misma pantalla confunde.)
function buscarReemplazoLogic_formatearDistancia(metros) {
  if (metros < 1000) {
    return Math.round(metros) + ' m';
  }
  return buscarReemplazoLogic_formatearNumero(Math.round(metros / 100) / 10) + ' km';
}

function buscarReemplazoLogic_formatearMetros(n) {
  return buscarReemplazoLogic_formatearNumero(n) + ' m';
}

// +12 m / -8 m / 0 m (signo explicito: lo que importa es el sentido).
function buscarReemplazoLogic_formatearDiferencia(n) {
  var texto = buscarReemplazoLogic_formatearNumero(n);
  return (n > 0 ? '+' : '') + texto + ' m';
}

// --- Profundidad ---

function buscarReemplazoLogic_esNumero(v) {
  return typeof v === 'number' && isFinite(v);
}

// Profundidad utilizable para comparar: numero > 0 y no atipico. null si no.
function buscarReemplazoLogic_profundidadValida(v) {
  if (!buscarReemplazoLogic_esNumero(v) || v <= 0 || v > BUSCAR_REEMPLAZO_PROFUNDIDAD_ATIPICA_METROS) {
    return null;
  }
  return v;
}

function buscarReemplazoLogic_profundidadAtipica(v) {
  return buscarReemplazoLogic_esNumero(v) && v > BUSCAR_REEMPLAZO_PROFUNDIDAD_ATIPICA_METROS;
}

// --- Referencia (punto NE) ---

function buscarReemplazoLogic_buscarPuntoNE(puntosNE, monitoringId) {
  if (!puntosNE || monitoringId === null || monitoringId === undefined) {
    return null;
  }
  var buscado = String(monitoringId);
  for (var i = 0; i < puntosNE.length; i++) {
    if (String(puntosNE[i].monitoringId) === buscado) {
      return puntosNE[i];
    }
  }
  return null;
}

// Buscar reemplazo es una accion del modulo de reemplazos: requiere reemplazo=SI
// (y ne=SI, porque la referencia es un punto de la red NE). Sin reemplazo=SI el
// usuario sigue usando el Mapa NE normalmente, pero no ve el boton ni puede abrirlo.
function buscarReemplazoLogic_puedeBuscar(permisos) {
  return !!permisos && permisos.ne === true && permisos.reemplazo === true;
}

// TODOS los wellId de la red NE, con o sin coordenada propia: los de los
// puntos dibujables (getMapaNE.puntos) mas la lista corta de miembros sin
// coordenada (getMapaNE.wellIdsSinCoordenada, solo wellId). Un miembro sin
// coordenada no puede ser REFERENCIA, pero sigue siendo parte de la red a
// efectos de excluirlo de los candidatos. {wellId: true}
function buscarReemplazoLogic_wellIdsRedNE(puntosNE, wellIdsSinCoordenada) {
  var set = {};
  (puntosNE || []).forEach(function (p) {
    if (p.wellId) {
      set[p.wellId] = true;
    }
  });
  (wellIdsSinCoordenada || []).forEach(function (wellId) {
    if (typeof wellId === 'string' && wellId) {
      set[wellId] = true;
    }
  });
  return set;
}

// Punto NE de referencia de la busqueda de reemplazo que el mapa esta
// mostrando (vista previa o seleccion con geometria tipoReferencia
// 'puntoNE'), para llevarlo a "Evaluar" desde el popup del mapa. null si el
// contexto vigente NO viene de una busqueda de reemplazo (mapa normal, Cerca
// Mio, poligono...) o si el pozo no es parte de ese contexto: nunca se
// inventa una referencia.
function buscarReemplazoLogic_puntoNEDeContexto(contexto, wellId) {
  if (!contexto || !contexto.geometria || contexto.geometria.tipoReferencia !== 'puntoNE' || !contexto.geometria.etiqueta) {
    return null;
  }
  if (!wellId || !contexto.wellIds || contexto.wellIds.indexOf(wellId) === -1) {
    return null;
  }
  return String(contexto.geometria.etiqueta);
}

// Referencia a partir de un punto de getMapaNE. null si no tiene coordenada
// propia valida (no se rescata la de Provincia: decision aprobada).
function buscarReemplazoLogic_construirReferencia(puntoNE, pozosProvincia) {
  if (!puntoNE || !buscarReemplazoLogic_esNumero(puntoNE.lat) || !buscarReemplazoLogic_esNumero(puntoNE.lon)) {
    return null;
  }
  var profundidad = buscarReemplazoLogic_esNumero(puntoNE.profundidad) ? puntoNE.profundidad : null;
  var coordenadaProvincia = null;
  if (puntoNE.wellId && pozosProvincia) {
    for (var i = 0; i < pozosProvincia.length; i++) {
      if (pozosProvincia[i].wellId === puntoNE.wellId) {
        var distancia = cercaMioLogic_haversineMetros(puntoNE.lat, puntoNE.lon, pozosProvincia[i].lat, pozosProvincia[i].lon);
        coordenadaProvincia = {
          lat: pozosProvincia[i].lat,
          lon: pozosProvincia[i].lon,
          distanciaMetros: distancia,
          discrepante: distancia >= BUSCAR_REEMPLAZO_UMBRAL_COORDENADA_METROS
        };
        break;
      }
    }
  }
  return {
    monitoringId: String(puntoNE.monitoringId),
    wellId: puntoNE.wellId || null,
    nombre: puntoNE.nombreOriginal || null,
    lat: puntoNE.lat,
    lon: puntoNE.lon,
    cuenca: puntoNE.cuenca || null,
    zona: puntoNE.zona || null,
    estadoMonitoreo: puntoNE.estadoMonitoreo || null,
    tieneMedicion2026: puntoNE.tieneMedicion2026 === true,
    esEspecial: !puntoNE.wellId,
    profundidad: profundidad,
    profundidadValida: buscarReemplazoLogic_profundidadValida(profundidad),
    profundidadAtipica: buscarReemplazoLogic_profundidadAtipica(profundidad),
    coordenadaProvincia: coordenadaProvincia
  };
}

// Texto del aviso (no bloqueante) o null.
function buscarReemplazoLogic_textoAdvertenciaCoordenada(ref) {
  if (!ref || !ref.coordenadaProvincia || !ref.coordenadaProvincia.discrepante) {
    return null;
  }
  return 'La coordenada de este pozo en el padrón de Provincia está a ' +
    buscarReemplazoLogic_formatearDistancia(ref.coordenadaProvincia.distanciaMetros) +
    ' de la del punto NE. La búsqueda usa la coordenada propia del punto NE.';
}

// --- Busqueda de candidatos ---

// Todos los pozos de Provincia dentro del radio, ordenados por distancia (el
// orden base). El propio pozo de la referencia nunca es candidato; los pozos
// de la red NE tampoco, salvo opciones.incluirRedNE. opciones.redNE =
// {wellId: true} (buscarReemplazoLogic_wellIdsRedNE).
function buscarReemplazoLogic_buscarCandidatos(pozos, ref, radioMetros, opciones) {
  var o = opciones || {};
  var redNE = o.redNE || {};
  var bbox = cercaMioLogic_boundingBox(ref.lat, ref.lon, radioMetros);
  var candidatos = [];
  (pozos || []).forEach(function (p) {
    if (p.lat < bbox.latMin || p.lat > bbox.latMax || p.lon < bbox.lonMin || p.lon > bbox.lonMax) {
      return;
    }
    if (ref.wellId && p.wellId === ref.wellId) {
      return;
    }
    var enRedNE = redNE[p.wellId] === true;
    if (enRedNE && !o.incluirRedNE) {
      return;
    }
    var distancia = cercaMioLogic_haversineMetros(ref.lat, ref.lon, p.lat, p.lon);
    if (distancia > radioMetros) {
      return;
    }
    var profundidadValida = buscarReemplazoLogic_profundidadValida(p.profundidad);
    var dif = (profundidadValida !== null && ref.profundidadValida !== null)
      ? Math.round((profundidadValida - ref.profundidadValida) * 10) / 10
      : null;
    candidatos.push({
      wellId: p.wellId,
      lat: p.lat,
      lon: p.lon,
      distanciaMetros: distancia,
      estadoCoordenada: p.estado,
      cuenca: p.cuenca || null,
      profundidad: buscarReemplazoLogic_esNumero(p.profundidad) ? p.profundidad : null,
      profundidadValida: profundidadValida,
      profundidadAtipica: buscarReemplazoLogic_profundidadAtipica(p.profundidad),
      difProfundidad: dif,
      tramos: p.tramosFiltrantes || [],
      surgencia: p.surgencia || null,
      enRedNE: enRedNE
    });
  });
  candidatos.sort(function (a, b) {
    return a.distanciaMetros - b.distanciaMetros || (a.wellId < b.wellId ? -1 : 1);
  });
  return candidatos;
}

// --- Filtros ---

function buscarReemplazoLogic_filtrosPorDefecto() {
  return {
    estados: {},            // aptitud, OR; vacio = todos
    mostrarNoAptos: false,  // los No apto se ocultan por defecto
    surgencias: {},         // Natural | SemiSurgente | Profundo | SIN_DATO, OR; vacio = todos
    cuencas: {},            // cuenca del candidato (Provincia), OR; vacio = todas
    profDesde: null,
    profHasta: null,
    soloConProfundidad: false,
    soloConTramos: false
  };
}

function buscarReemplazoLogic_cantidadFiltrosActivos(filtros) {
  var f = filtros || {};
  var n = 0;
  n += reemplazoResumenLogic_hayActivos(f.estados) ? 1 : 0;
  n += reemplazoResumenLogic_hayActivos(f.surgencias) ? 1 : 0;
  n += reemplazoResumenLogic_hayActivos(f.cuencas) ? 1 : 0;
  n += (f.profDesde !== null && f.profDesde !== undefined) || (f.profHasta !== null && f.profHasta !== undefined) ? 1 : 0;
  n += f.soloConProfundidad ? 1 : 0;
  n += f.soloConTramos ? 1 : 0;
  // "Mostrar no aptos" no cuenta: es un interruptor que AMPLIA (por defecto
  // se ocultan), no una restriccion.
  return n;
}

// Todos los filtros EXCEPTO los dos de aptitud (chips + ocultar No apto):
// es el universo sobre el que se cuentan los estados.
function buscarReemplazoLogic_filtrarSinAptitud(candidatos, filtros) {
  var f = filtros || {};
  var desde = f.profDesde === undefined ? null : f.profDesde;
  var hasta = f.profHasta === undefined ? null : f.profHasta;
  return (candidatos || []).filter(function (c) {
    if (reemplazoResumenLogic_hayActivos(f.surgencias) && f.surgencias[c.surgencia || 'SIN_DATO'] !== true) {
      return false;
    }
    if (reemplazoResumenLogic_hayActivos(f.cuencas) && f.cuencas[c.cuenca || 'SIN_DATO'] !== true) {
      return false;
    }
    // Rango de profundidad: sin dato valido NO pasa (no se infiere), igual
    // que "solo con profundidad".
    if ((desde !== null || hasta !== null || f.soloConProfundidad) && c.profundidadValida === null) {
      return false;
    }
    if (desde !== null && c.profundidadValida < desde) {
      return false;
    }
    if (hasta !== null && c.profundidadValida > hasta) {
      return false;
    }
    if (f.soloConTramos && (!c.tramos || c.tramos.length === 0)) {
      return false;
    }
    return true;
  });
}

// Aptitud: sin resumen (sin permiso reemplazo / no cargado) no se oculta ni
// filtra nada. Con resumen: se ocultan los No apto salvo mostrarNoAptos, y
// los chips (OR) restringen. Elegir el chip No apto equivale a mostrarlos.
function buscarReemplazoLogic_filtrar(candidatos, resumen, filtros) {
  var f = filtros || buscarReemplazoLogic_filtrosPorDefecto();
  var base = buscarReemplazoLogic_filtrarSinAptitud(candidatos, f);
  if (!resumen) {
    return base;
  }
  var hayChips = reemplazoResumenLogic_hayActivos(f.estados);
  return base.filter(function (c) {
    var e = reemplazoResumenLogic_estadoDe(resumen, c.wellId);
    if (hayChips) {
      return f.estados[e] === true;
    }
    return f.mostrarNoAptos || e !== 'NO_APTO';
  });
}

// Conteos por estado del universo (sin los filtros de aptitud) y cuantos No
// apto quedan ocultos por el interruptor.
function buscarReemplazoLogic_conteosAptitud(candidatos, resumen, filtros) {
  var universo = buscarReemplazoLogic_filtrarSinAptitud(candidatos, filtros);
  var conteos = reemplazoResumenLogic_contar(universo, resumen);
  var f = filtros || {};
  var ocultos = (resumen && !f.mostrarNoAptos && !reemplazoResumenLogic_hayActivos(f.estados)) ? conteos.NO_APTO : 0;
  return { conteos: conteos, noAptosOcultos: ocultos, universo: universo.length };
}

// Cuencas presentes entre los candidatos (para el filtro), con conteo. Los
// sin dato van como SIN_DATO.
function buscarReemplazoLogic_opcionesCuenca(candidatos) {
  var cuenta = {};
  (candidatos || []).forEach(function (c) {
    var k = c.cuenca || 'SIN_DATO';
    cuenta[k] = (cuenta[k] || 0) + 1;
  });
  return Object.keys(cuenta).sort(function (a, b) {
    if (a === 'SIN_DATO') { return 1; }
    if (b === 'SIN_DATO') { return -1; }
    return a < b ? -1 : 1;
  }).map(function (k) { return { valor: k, cantidad: cuenta[k] }; });
}

// Frase del contador sobre la lista. total = pozos del radio, filtrados =
// los que se ven, ocultos = No apto ocultos por el interruptor, radio = texto
// del radio ("1 km"). Si lo unico que los separa son los No apto ocultos se
// dice eso (y no "filtros activos").
function buscarReemplazoLogic_textoContador(total, filtrados, ocultos, radio, hayFiltros) {
  var plural = function (n, uno, varios) { return n + ' ' + (n === 1 ? uno : varios); };
  if (total === 0) {
    return '';
  }
  if (filtrados === 0) {
    return 'Ningún pozo cumple los filtros (' + plural(total, 'pozo', 'pozos') + ' dentro de ' + radio + ').';
  }
  var base = filtrados === total
    ? plural(filtrados, 'pozo', 'pozos') + ' dentro de ' + radio
    : filtrados + ' de ' + total + ' pozos dentro de ' + radio;
  if (!hayFiltros && ocultos > 0 && filtrados === total - ocultos) {
    return plural(filtrados, 'pozo', 'pozos') + ' dentro de ' + radio + ' (' + plural(ocultos, 'no apto oculto', 'no aptos ocultos') + ')';
  }
  return filtrados === total ? base : base + ' (filtros activos)';
}

// --- Orden (uno a la vez, sin score compuesto) ---

// 'distancia' | 'profundidad' | 'estado'. 'estado' sin resumen cae a
// distancia. Desempate siempre por distancia y luego wellId (determinista).
function buscarReemplazoLogic_ordenar(candidatos, orden, resumen) {
  var copia = (candidatos || []).slice();
  function porDistancia(a, b) {
    return a.distanciaMetros - b.distanciaMetros || (a.wellId < b.wellId ? -1 : (a.wellId > b.wellId ? 1 : 0));
  }
  if (orden === 'profundidad') {
    copia.sort(function (a, b) {
      var aTiene = a.difProfundidad !== null;
      var bTiene = b.difProfundidad !== null;
      if (aTiene !== bTiene) {
        return aTiene ? -1 : 1; // los "Sin dato" al final
      }
      if (aTiene) {
        var d = Math.abs(a.difProfundidad) - Math.abs(b.difProfundidad);
        if (d !== 0) {
          return d;
        }
      }
      return porDistancia(a, b);
    });
  } else if (orden === 'estado' && resumen) {
    copia.sort(function (a, b) {
      var pa = BUSCAR_REEMPLAZO_PRIORIDAD_ESTADO[reemplazoResumenLogic_estadoDe(resumen, a.wellId)];
      var pb = BUSCAR_REEMPLAZO_PRIORIDAD_ESTADO[reemplazoResumenLogic_estadoDe(resumen, b.wellId)];
      return (pa - pb) || porDistancia(a, b);
    });
  } else {
    copia.sort(porDistancia);
  }
  return copia;
}

// Frase fija que explica el orden vigente (se muestra sobre la lista).
function buscarReemplazoLogic_textoOrden(orden, resumenDisponible, tieneReferenciaProfundidad) {
  if (orden === 'profundidad') {
    return tieneReferenciaProfundidad
      ? 'Ordenados por menor diferencia de profundidad total con el punto NE; los "Sin dato" van al final, por distancia.'
      : 'El punto NE no tiene profundidad total: no hay diferencia que calcular, se ordena por distancia.';
  }
  if (orden === 'estado' && resumenDisponible) {
    return 'Ordenados por estado de reemplazo (Apto, Dudoso, Sin evaluar, No apto) y, dentro de cada estado, por distancia.';
  }
  return 'Ordenados por distancia al punto NE, de menor a mayor.';
}

// --- Por que aparece (datos crudos, sin puntaje) ---

function buscarReemplazoLogic_textoTramos(tramos) {
  if (!tramos || tramos.length === 0) {
    return null;
  }
  var partes = tramos.slice(0, 2).map(function (t) {
    return buscarReemplazoLogic_formatearNumero(t.desde) + '–' + buscarReemplazoLogic_formatearNumero(t.hasta) + ' m';
  });
  var resto = tramos.length - partes.length;
  return partes.join(' · ') + (resto > 0 ? ' · +' + resto : '');
}

// [{clave, texto, tipo}] con tipo 'dato' | 'sin-dato' | 'aviso'. Todo lo que
// falta se dice "Sin dato"; nada se infiere.
function buscarReemplazoLogic_explicar(c, ref) {
  var items = [];
  items.push({ clave: 'distancia', texto: buscarReemplazoLogic_formatearDistancia(c.distanciaMetros) + ' del punto NE', tipo: 'dato' });

  if (c.profundidadAtipica) {
    items.push({ clave: 'profundidad', texto: 'Profundidad atípica (' + buscarReemplazoLogic_formatearMetros(c.profundidad) + '): no se compara', tipo: 'aviso' });
  } else if (c.profundidadValida === null) {
    items.push({ clave: 'profundidad', texto: 'Profundidad: Sin dato', tipo: 'sin-dato' });
  } else if (c.difProfundidad !== null) {
    items.push({ clave: 'profundidad', texto: 'Prof. ' + buscarReemplazoLogic_formatearMetros(c.profundidadValida) + ' (' + buscarReemplazoLogic_formatearDiferencia(c.difProfundidad) + ' vs. punto NE)', tipo: 'dato' });
  } else {
    items.push({ clave: 'profundidad', texto: 'Prof. ' + buscarReemplazoLogic_formatearMetros(c.profundidadValida) + ' (punto NE sin profundidad)', tipo: 'dato' });
  }

  var tramos = buscarReemplazoLogic_textoTramos(c.tramos);
  items.push(tramos
    ? { clave: 'tramos', texto: 'Filtros: ' + tramos, tipo: 'dato' }
    : { clave: 'tramos', texto: 'Filtros: Sin dato', tipo: 'sin-dato' });

  items.push(c.surgencia
    ? { clave: 'surgencia', texto: BUSCAR_REEMPLAZO_SURGENCIA_ETIQUETAS[c.surgencia] || c.surgencia, tipo: 'dato' }
    : { clave: 'surgencia', texto: 'Tipo: Sin dato', tipo: 'sin-dato' });

  items.push(c.cuenca
    ? { clave: 'cuenca', texto: c.cuenca, tipo: 'dato' }
    : { clave: 'cuenca', texto: 'Cuenca: Sin dato', tipo: 'sin-dato' });

  items.push({
    clave: 'coordenada',
    // "Disponible" (1 fuente) es lo normal (88 % de los pozos): se informa
    // como dato, no como alerta.
    texto: c.estadoCoordenada === 'C' ? 'Coordenada confirmada' : 'Coordenada disponible (1 fuente)',
    tipo: 'dato'
  });

  if (c.enRedNE) {
    items.push({ clave: 'redNE', texto: 'Ya pertenece a la red NE', tipo: 'aviso' });
  }
  return items;
}

// Geometria para publicar la busqueda como vista previa del mapa
// (seleccionController_establecerVistaPrevia): mismo contrato que el radio de
// Cerca Mio, con tipoReferencia 'puntoNE' para dibujar el punto NE.
function buscarReemplazoLogic_geometria(ref, radioMetros) {
  return { lat: ref.lat, lon: ref.lon, radioMetros: radioMetros, tipoReferencia: 'puntoNE', etiqueta: ref.monitoringId };
}

// Siguiente radio preset mayor al actual (para "Ampliar"), o null.
function buscarReemplazoLogic_siguienteRadio(radioMetros) {
  for (var i = 0; i < CERCA_MIO_RADIOS_METROS.length; i++) {
    if (CERCA_MIO_RADIOS_METROS[i] > radioMetros) {
      return CERCA_MIO_RADIOS_METROS[i];
    }
  }
  return null;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    BUSCAR_REEMPLAZO_RADIO_DEFAULT_METROS,
    BUSCAR_REEMPLAZO_PAGINA,
    BUSCAR_REEMPLAZO_UMBRAL_COORDENADA_METROS,
    BUSCAR_REEMPLAZO_PROFUNDIDAD_ATIPICA_METROS,
    BUSCAR_REEMPLAZO_ORDENES,
    BUSCAR_REEMPLAZO_PRIORIDAD_ESTADO,
    BUSCAR_REEMPLAZO_SURGENCIAS,
    BUSCAR_REEMPLAZO_SURGENCIA_ETIQUETAS,
    buscarReemplazoLogic_formatearNumero,
    buscarReemplazoLogic_formatearDistancia,
    buscarReemplazoLogic_formatearMetros,
    buscarReemplazoLogic_formatearDiferencia,
    buscarReemplazoLogic_profundidadValida,
    buscarReemplazoLogic_profundidadAtipica,
    buscarReemplazoLogic_buscarPuntoNE,
    buscarReemplazoLogic_puedeBuscar,
    buscarReemplazoLogic_wellIdsRedNE,
    buscarReemplazoLogic_puntoNEDeContexto,
    buscarReemplazoLogic_construirReferencia,
    buscarReemplazoLogic_textoAdvertenciaCoordenada,
    buscarReemplazoLogic_buscarCandidatos,
    buscarReemplazoLogic_filtrosPorDefecto,
    buscarReemplazoLogic_cantidadFiltrosActivos,
    buscarReemplazoLogic_filtrarSinAptitud,
    buscarReemplazoLogic_filtrar,
    buscarReemplazoLogic_conteosAptitud,
    buscarReemplazoLogic_opcionesCuenca,
    buscarReemplazoLogic_textoContador,
    buscarReemplazoLogic_ordenar,
    buscarReemplazoLogic_textoOrden,
    buscarReemplazoLogic_textoTramos,
    buscarReemplazoLogic_explicar,
    buscarReemplazoLogic_geometria,
    buscarReemplazoLogic_siguienteRadio
  };
}
