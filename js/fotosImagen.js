// Pipeline de imagen del NAVEGADOR, compartido por las fotos de Reemplazos
// (js/reemplazoFotos.js) y por la galeria general de pozos (js/fotosPozos.js):
// decodificar respetando la orientacion, reducir a 1600 px, JPEG con la escalera
// de calidad 0.72 -> 0.62 -> 0.52 solo si pasa de 1,5 MB, miniatura de 256 px.
// No se testea con Jest (toca canvas/FileReader): las reglas puras (dimensiones,
// calidades, objetivo) viven en js/reemplazoFotosLogic.js, con tests; este archivo
// solo las aplica. Se verifica a mano en el navegador.
//
// Privacidad: re-codificar con canvas DESCARTA EXIF y GPS del archivo (la fecha de
// captura se lee aparte, del original, antes de comprimir) y corrige la orientacion.
// Los nombres de archivo originales no se usan.
(function () {
  // Decodifica respetando la orientacion EXIF (fotos de celular tomadas en
  // vertical). createImageBitmap con 'from-image'; si el navegador no lo
  // soporta, <img> (los navegadores modernos tambien la respetan).
  function decodificarConImg(archivo) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(archivo);
      var img = new Image();
      img.onload = function () {
        resolve({ fuente: img, ancho: img.naturalWidth, alto: img.naturalHeight, liberar: function () { URL.revokeObjectURL(url); } });
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('DECODIFICAR')); };
      img.src = url;
    });
  }

  function decodificar(archivo) {
    if (typeof createImageBitmap !== 'function') {
      return decodificarConImg(archivo);
    }
    return createImageBitmap(archivo, { imageOrientation: 'from-image' })
      .catch(function () { return createImageBitmap(archivo); })
      .then(function (bmp) {
        return { fuente: bmp, ancho: bmp.width, alto: bmp.height, liberar: function () { if (bmp.close) { bmp.close(); } } };
      })
      .catch(function () { return decodificarConImg(archivo); });
  }

  function dibujarABlob(decodificada, dimMax, calidad) {
    var d = reemplazoFotosLogic_dimensiones(decodificada.ancho, decodificada.alto, dimMax);
    var canvas = document.createElement('canvas');
    canvas.width = d.ancho;
    canvas.height = d.alto;
    var ctx = canvas.getContext('2d');
    // Fondo blanco: un PNG con transparencia no debe salir negro en JPEG.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, d.ancho, d.alto);
    ctx.drawImage(decodificada.fuente, 0, 0, d.ancho, d.alto);
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (blob) {
        canvas.width = 0; canvas.height = 0;
        if (blob) { resolve(blob); } else { reject(new Error('DECODIFICAR')); }
      }, 'image/jpeg', calidad);
    });
  }

  function blobABase64(blob) {
    return new Promise(function (resolve, reject) {
      var lector = new FileReader();
      lector.onload = function () { resolve(reemplazoFotosLogic_base64DeDataUrl(lector.result)); };
      lector.onerror = function () { reject(new Error('DECODIFICAR')); };
      lector.readAsDataURL(blob);
    });
  }

  // Foto completa a 1600 px bajando la calidad solo si hace falta, mas la
  // miniatura de 256 px. {base64, bytes, thumbBase64, thumbBytes, ancho, alto,
  // calidad, ladoMayor}. Rechaza con Error('DECODIFICAR') si el navegador no puede
  // abrir la imagen, o Error('COMPRIMIR_GRANDE') si ni a la calidad minima entra en 1,5 MB.
  function fotosImagen_comprimir(archivo) {
    return decodificar(archivo).then(function (dec) {
      var resultado = {};
      function intentar(calidad) {
        return dibujarABlob(dec, REEMPLAZO_FOTOS_MAX_DIM, calidad).then(function (blob) {
          var siguiente = reemplazoFotosLogic_siguienteCalidad(calidad, blob.size);
          if (siguiente !== null) {
            return intentar(siguiente);
          }
          if (blob.size > REEMPLAZO_FOTOS_OBJETIVO_BYTES) {
            throw new Error('COMPRIMIR_GRANDE');
          }
          resultado.bytes = blob.size;
          resultado.calidad = calidad;
          var d = reemplazoFotosLogic_dimensiones(dec.ancho, dec.alto, REEMPLAZO_FOTOS_MAX_DIM);
          resultado.ancho = d.ancho;
          resultado.alto = d.alto;
          resultado.ladoMayor = Math.max(d.ancho, d.alto);
          return blobABase64(blob);
        });
      }
      return intentar(REEMPLAZO_FOTOS_CALIDADES[0]).then(function (b64) {
        resultado.base64 = b64;
        return dibujarABlob(dec, REEMPLAZO_FOTOS_THUMB_DIM, REEMPLAZO_FOTOS_THUMB_CALIDAD);
      }).then(function (thumb) {
        resultado.thumbBytes = thumb.size;
        return blobABase64(thumb);
      }).then(function (thumbB64) {
        resultado.thumbBase64 = thumbB64;
        dec.liberar();
        return resultado;
      }, function (err) {
        dec.liberar();
        throw err;
      });
    });
  }

  // Bytes [desde, hasta) del archivo ORIGINAL (cabecera para detectar el formato
  // por contenido y leer la fecha EXIF). Nunca rechaza: Uint8Array vacio si falla.
  function fotosImagen_leerBytes(archivo, desde, hasta) {
    return new Promise(function (resolve) {
      try {
        var lector = new FileReader();
        lector.onload = function () { resolve(new Uint8Array(lector.result)); };
        lector.onerror = function () { resolve(new Uint8Array(0)); };
        lector.readAsArrayBuffer(archivo.slice(desde, hasta));
      } catch (err) {
        resolve(new Uint8Array(0));
      }
    });
  }

  // SHA-1 (hex) del archivo ORIGINAL: sirve para no subir dos veces la misma foto a
  // un pozo (doble toque, reintento, mismo archivo elegido de nuevo). '' si el
  // navegador no ofrece crypto.subtle (p. ej. pagina sin HTTPS): la subida funciona igual.
  function fotosImagen_sha1(archivo) {
    return new Promise(function (resolve) {
      try {
        if (!window.crypto || !window.crypto.subtle) {
          resolve('');
          return;
        }
        var lector = new FileReader();
        lector.onload = function () {
          window.crypto.subtle.digest('SHA-1', lector.result).then(function (buf) {
            resolve(Array.prototype.map.call(new Uint8Array(buf), function (x) { return ('0' + x.toString(16)).slice(-2); }).join(''));
          }, function () { resolve(''); });
        };
        lector.onerror = function () { resolve(''); };
        lector.readAsArrayBuffer(archivo);
      } catch (err) {
        resolve('');
      }
    });
  }

  window.fotosImagen_comprimir = fotosImagen_comprimir;
  window.fotosImagen_leerBytes = fotosImagen_leerBytes;
  window.fotosImagen_sha1 = fotosImagen_sha1;
})();
