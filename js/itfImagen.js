// Pipeline de imagen del NAVEGADOR para PROPONER un ITF (E9-6): decodifica respetando la orientacion y deja la imagen LISTA PARA ENVIAR, la misma que se le muestra a la persona. Las reglas puras (cuando conservar,
// cuanto reducir, la escalera de calidad) viven en js/itfLogic.js con tests; aca solo se aplican. Se prueba con un navegador falso (js/itfImagen.test.js) y se verifica a mano en un navegador real.
//
// Criterio: un ITF es un DOCUMENTO escaneado, asi que la legibilidad pesa mas que el ahorro de bytes.
//  - Un archivo que ya entra en el objetivo (2,5 MB) y no es enorme se envia TAL CUAL (los mismos bytes: no se recomprime lo que ya esta bien).
//  - Si no, se reduce a JPEG con lado mayor de hasta 2400 px y calidad 0.92, bajando primero la calidad (hasta 0.76) y despues el lado (hasta 1600 px); un PNG grande de un escaneo se convierte a JPEG
//    (la transparencia, si la hubiera, se aplana sobre blanco). Reducir con canvas descarta EXIF / GPS; CONSERVAR no toca el archivo (queda como lo mando la persona).
//  - Si ni asi entra en el maximo del servidor (3 MB), NO se envia: el flujo de proponer bloquea con un mensaje claro.
// Rechaza con Error('DECODIFICAR') si el navegador no puede abrir la imagen. El servidor sigue siendo la autoridad (mira los bytes reales).
(function () {
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

  function dibujarABlob(dec, lado, calidad) {
    var d = itfLogic_dimensiones(dec.ancho, dec.alto, lado);
    var canvas = document.createElement('canvas');
    canvas.width = d.ancho;
    canvas.height = d.alto;
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, d.ancho, d.alto);
    ctx.drawImage(dec.fuente, 0, 0, d.ancho, d.alto);
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (blob) {
        canvas.width = 0;
        canvas.height = 0;
        if (blob) { resolve({ blob: blob, ancho: d.ancho, alto: d.alto }); } else { reject(new Error('DECODIFICAR')); }
      }, 'image/jpeg', calidad);
    });
  }

  function blobABase64(blob) {
    return new Promise(function (resolve, reject) {
      var lector = new FileReader();
      lector.onload = function () {
        var s = String(lector.result);
        var i = s.indexOf(',');
        resolve(i >= 0 ? s.slice(i + 1) : '');
      };
      lector.onerror = function () { reject(new Error('DECODIFICAR')); };
      lector.readAsDataURL(blob);
    });
  }

  // Reduce probando la escalera hasta que entre en el objetivo; si se agota, devuelve lo ultimo (el flujo de proponer lo bloquea por tamano si pasa del maximo).
  function reducir(dec, plan) {
    function intentar(paso) {
      return dibujarABlob(dec, paso.lado, paso.calidad).then(function (r) {
        if (r.blob.size <= ITF_IMG_OBJETIVO_BYTES) { return r; }
        var siguiente = itfLogic_siguientePaso(paso);
        return siguiente === null ? r : intentar(siguiente);
      });
    }
    return intentar({ lado: plan.lado, calidad: plan.calidad });
  }

  // archivo (File ya validado por tipo y tamano) -> {base64, bytes, mimeType, ancho, alto, accion: 'CONSERVADA'|'REDUCIDA', previewUrl}. previewUrl es un blob: URL que quien lo pide debe liberar (URL.revokeObjectURL).
  function itfImagen_preparar(archivo) {
    return decodificar(archivo).then(function (dec) {
      var plan = itfLogic_planificarImagen({ bytes: archivo.size, ancho: dec.ancho, alto: dec.alto, mimeType: archivo.type });
      if (plan.accion === 'CONSERVAR') {
        return blobABase64(archivo).then(function (b64) {
          dec.liberar();
          return { base64: b64, bytes: archivo.size, mimeType: plan.mimeType, ancho: dec.ancho, alto: dec.alto, accion: 'CONSERVADA', previewUrl: URL.createObjectURL(archivo) };
        });
      }
      return reducir(dec, plan).then(function (r) {
        return blobABase64(r.blob).then(function (b64) {
          dec.liberar();
          return { base64: b64, bytes: r.blob.size, mimeType: 'image/jpeg', ancho: r.ancho, alto: r.alto, accion: 'REDUCIDA', previewUrl: URL.createObjectURL(r.blob) };
        });
      });
    }).catch(function (err) {
      var e = new Error('DECODIFICAR');
      e.mensaje = 'No se pudo abrir la imagen. Probá con otra.';
      throw e;
    });
  }

  window.itfImagen_preparar = itfImagen_preparar;
})();
