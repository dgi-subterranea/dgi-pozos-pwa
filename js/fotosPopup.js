// Boton "Fotos" de los popups de mapa (Pozos Provincia y Niveles Estaticos): UNA sola
// implementacion con la misma semantica de permisos en los dos.
//
// El permiso lo decide quien arma el contexto (app.js, con fotosPozosLogic_accesoUI):
//   contexto.onVerFotos(ref)      solo existe con fotos=SI o fotos_carga=SI -> sin ella NO hay boton
//   contexto.cantidadFotos(ref)   solo existe con fotos=SI -> sin ella el boton dice "Fotos" a secas,
//                                 sin contador, sin pedir galeria y sin revelar si hay fotos
// ref: wellId (texto, Provincia: siempre por wellId) o punto NE (objeto del mapa NE).
// El contador sale del resumen compartido y se refresca cada vez que se abre el popup
// (refleja fotos recien cargadas); si todavia no esta disponible, "Fotos" y se actualiza luego.
//
// doc se inyecta solo para testear con Jest; en el navegador es document.
function fotosPopup_crearBoton(contexto, ref, marker, doc) {
  if (!contexto || typeof contexto.onVerFotos !== 'function') {
    return null;
  }
  var d = doc || document;
  var btn = d.createElement('button');
  btn.type = 'button';
  btn.className = 'button mapa-popup-btn mapa-popup-btn-secundario';
  var etiquetar = function () {
    var n = typeof contexto.cantidadFotos === 'function' ? contexto.cantidadFotos(ref) : null;
    btn.textContent = fotosPozosLogic_textoBoton(n);
  };
  etiquetar();
  btn.addEventListener('click', function () {
    contexto.onVerFotos(ref);
  });
  if (marker && typeof marker.on === 'function') {
    marker.on('popupopen', etiquetar);
  }
  return btn;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { fotosPopup_crearBoton };
}
