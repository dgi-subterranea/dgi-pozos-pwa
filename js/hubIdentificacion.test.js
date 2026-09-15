const { resolverIdentificacionHub } = require('./hubIdentificacion');

function pozo(overrides) {
  return Object.assign({
    wellId: null,
    itf: { found: false },
    registro: { found: false },
    ubicacion: { found: false },
    ne: { found: false }
  }, overrides);
}

describe('resolverIdentificacionHub', () => {
  test('wellId + datos=SI: titular real de la Ficha, id principal es el wellId', () => {
    const p = pozo({
      wellId: '04-0263',
      registro: { found: true, data: { titularidad: { titular: 'PASTOR DE POZO, PETRONA' } } }
    });
    const r = resolverIdentificacionHub(p);
    expect(r.idPrincipal).toBe('04-0263');
    expect(r.identificacionSecundaria).toBe('PASTOR DE POZO, PETRONA');
  });

  // Caso central de esta regla: aunque el usuario tenga permiso "ne" y
  // el punto NE traiga un nombreOriginal, la cabecera NUNCA lo usa como
  // reemplazo del titular cuando hay wellId - filtraria Datos de forma
  // indirecta a traves de NE.
  test('wellId + ne=SI + datos=NO: identificacionSecundaria queda null, NO aparece nombreOriginal de NE', () => {
    const p = pozo({
      wellId: '04-0263',
      registro: { found: false }, // datos=NO -> buscarPozo ni siquiera trae el registro
      ne: { found: true, data: { monitoringId: '04-0263', nombreOriginal: 'PASTOR DE POZO PERONA' } }
    });
    const r = resolverIdentificacionHub(p);
    expect(r.idPrincipal).toBe('04-0263');
    expect(r.identificacionSecundaria).toBeNull();
  });

  test('wellId + datos=NO + ne=NO: solo el wellId, sin segunda linea', () => {
    const p = pozo({ wellId: '15-0036' });
    const r = resolverIdentificacionHub(p);
    expect(r.idPrincipal).toBe('15-0036');
    expect(r.identificacionSecundaria).toBeNull();
  });

  test('wellId + datos=SI pero sin titularidad cargada: sin segunda linea, sin inventar nada', () => {
    const p = pozo({
      wellId: '01-0012',
      registro: { found: true, data: {} }
    });
    const r = resolverIdentificacionHub(p);
    expect(r.identificacionSecundaria).toBeNull();
  });

  // Unica excepcion a la regla: sin wellId no hay ficha registral
  // posible, asi que identificarse con los propios datos de NE (a los
  // que el usuario ya tiene acceso via ne=SI) es correcto, no una fuga.
  test('wellId=null + ne=SI (punto especial): usa monitoringId y nombreOriginal de NE', () => {
    const p = pozo({
      wellId: null,
      ne: { found: true, data: { monitoringId: '6 RTR7', nombreOriginal: 'PASNOA' } }
    });
    const r = resolverIdentificacionHub(p);
    expect(r.idPrincipal).toBe('6 RTR7');
    expect(r.identificacionSecundaria).toBe('PASNOA');
  });

  test('wellId=null + ne=SI pero sin nombreOriginal: id principal igual, sin segunda linea', () => {
    const p = pozo({
      wellId: null,
      ne: { found: true, data: { monitoringId: 'INA 2055', nombreOriginal: null } }
    });
    const r = resolverIdentificacionHub(p);
    expect(r.idPrincipal).toBe('INA 2055');
    expect(r.identificacionSecundaria).toBeNull();
  });

  test('wellId=null + ne no encontrado (permiso denegado o inexistente): sin id, sin segunda linea', () => {
    const p = pozo({ wellId: null, ne: { found: false } });
    const r = resolverIdentificacionHub(p);
    expect(r.idPrincipal).toBeNull();
    expect(r.identificacionSecundaria).toBeNull();
  });
});
