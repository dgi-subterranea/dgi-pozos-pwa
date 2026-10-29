/* Medidor de rendimiento de ITF para la CONSOLA del navegador (E9-2). NO es parte de la app: no se carga desde index.html ni desde el service worker.
 *
 * Como usarlo: abrir la app publicada (https://dgi-subterranea.github.io/dgi-pozos-pwa/) con una sesion iniciada que tenga el permiso "perfil", abrir la consola (F12 > Console), pegar TODO
 * este archivo y apretar Enter. Opcionalmente cambiar POZO_CON_ITF por un pozo que se sepa que tiene ITF. Tarda unos segundos y devuelve una tabla.
 *
 * Que hace (SOLO LECTURA de datos; usa los mismos endpoints que la app):
 *   1. getItfAvailability con 1 pozo (la primera llamada puede ser "en frio": cache de 1 hora vencida o nunca armada -> recorre la carpeta completa de Drive).
 *   2. getItfAvailability con 500 pozos, y de nuevo (en caliente).
 *   3. getItfAvailability con 700 pozos como lo hace la app (2 lotes, 500 + 200, en paralelo).
 *   4. getProfile del POZO_CON_ITF, dos veces: tiempo total, tiempo de Drive que informa el backend, y tamanos (imagen y base64).
 * Efecto colateral NORMAL de la app: cada llamada deja una fila en la hoja Historial (auditoria). NO llama a registerDescargaItf, asi que NO genera avisos de Telegram.
 * No imprime ni guarda el token de sesion. Los pozos de la disponibilidad son identificadores DD-PPPP correlativos (los que no existen devuelven false: el costo es el del indice).
 */
(async function medirItf() {
  var POZO_CON_ITF = '01-0012';
  var token = localStorage.getItem('sessionToken');
  if (!token) { console.error('No hay sesion iniciada en esta pestana.'); return; }
  if (typeof apiGetItfAvailability !== 'function' || typeof apiGetProfile !== 'function') { console.error('Abrir la app publicada (no una pestana en blanco).'); return; }

  function ids(depto, cantidad, desde) {
    var out = [];
    for (var i = 0; i < cantidad; i++) { out.push(depto + '-' + String(desde + i).padStart(4, '0')); }
    return out;
  }
  async function medir(etiqueta, fn) {
    var t0 = performance.now();
    var respuesta, error = null;
    try { respuesta = await fn(); } catch (e) { error = String(e); }
    var ms = Math.round(performance.now() - t0);
    return { etiqueta: etiqueta, ms: ms, status: error ? 'ERROR' : (respuesta && respuesta.status), detalle: error || (respuesta && respuesta.code) || '', respuesta: respuesta };
  }
  function disp(lista) { return function () { return apiGetItfAvailability(token, lista); }; }

  var filas = [];
  filas.push(await medir('disponibilidad 1 pozo (1a llamada: puede ser en frio)', disp(ids('01', 1, 12))));
  filas.push(await medir('disponibilidad 500 pozos (1a vez)', disp(ids('14', 500, 1))));
  filas.push(await medir('disponibilidad 500 pozos (caliente)', disp(ids('14', 500, 1))));
  filas.push(await medir('disponibilidad 1 pozo (caliente)', disp(ids('01', 1, 12))));
  filas.push(await medir('disponibilidad 700 pozos (2 lotes 500+200 en paralelo, como la app)', function () {
    return Promise.all([apiGetItfAvailability(token, ids('14', 500, 1)), apiGetItfAvailability(token, ids('15', 200, 1))]).then(function (rs) {
      return { status: rs.every(function (r) { return r && r.status === 'ok'; }) ? 'ok' : 'error' };
    });
  }));
  var perfiles = [];
  for (var k = 1; k <= 2; k++) {
    var p = await medir('getProfile ' + POZO_CON_ITF + ' (' + (k === 1 ? '1a vez' : '2a vez') + ')', function () { return apiGetProfile(token, POZO_CON_ITF); });
    var d = p.respuesta && p.respuesta.data;
    perfiles.push({ etiqueta: p.etiqueta, ms: p.ms, status: p.status, msEnDrive: d ? d.elapsedMsEnDrive : null, bytesImagen: d ? d.originalSizeBytes : null, bytesBase64: d ? d.base64SizeBytes : null, detalle: p.detalle });
  }
  var tabla = filas.map(function (f) { return { medicion: f.etiqueta, ms: f.ms, status: f.status, detalle: f.detalle }; });
  console.table(tabla);
  console.table(perfiles);
  var resultado = { fecha: new Date().toISOString(), disponibilidad: tabla, perfil: perfiles, userAgent: navigator.userAgent, conexion: navigator.connection ? { tipo: navigator.connection.effectiveType, rttMs: navigator.connection.rtt, downlinkMbps: navigator.connection.downlink } : null };
  console.log('Resultado (copiar y pegar en el chat):');
  console.log(JSON.stringify(resultado));
  return resultado;
})();
