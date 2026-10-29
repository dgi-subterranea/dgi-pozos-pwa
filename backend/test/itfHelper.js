// Constructores de eventos "crudos" (como los entrega itfEventosRepository_leerTodos) para los tests del dominio de ITF colaborativos (E9-2). Un contador de secuencia compartido:
// llamar a reiniciar() en un beforeEach. Los ids son UUID deterministas; las huellas, hex de 64 caracteres.
const ISO = '2026-10-28T15:00:00.000Z';
const WELL = '14-0001';
const uuid = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const sha = (n) => (n === 'sin' ? '' : n.toString(16).padStart(64, '0'));
const storageId = (n) => 'drive-id-' + String(n).padStart(6, '0');

let seq = 0;
const reiniciar = () => { seq = 0; };

const crudo = (evento, extra) => {
  seq += 1;
  return Object.assign({
    fila: seq + 1, eventoId: uuid(1000 + seq), secuencia: seq, evento: evento, documentoId: '', wellId: WELL, documentoReemplazadoId: '', mimeType: '', bytes: '', sha256: '',
    storageFileId: '', nombreOriginal: '', motivoCodigo: '', motivoTexto: '', email: 'val@x.com', nombre: 'Valeria', timestampUtc: ISO, clientRequestId: 'req-' + String(seq).padStart(8, '0')
  }, extra || {});
};

// documento n: uuid(n)
const doc = (n) => uuid(n);
const propuesto = (n, extra) => crudo('ITF_PROPUESTO', Object.assign({
  documentoId: doc(n), mimeType: 'image/jpeg', bytes: 1000 + n, sha256: sha(n), storageFileId: storageId(n), nombreOriginal: 'itf-' + n + '.jpg', email: 'ana@x.com', nombre: 'Ana'
}, extra || {}));
const aprobado = (n, reemplaza, extra) => crudo('ITF_APROBADO', Object.assign({ documentoId: doc(n) },
  reemplaza === undefined || reemplaza === null || reemplaza === '' ? {} : { documentoReemplazadoId: typeof reemplaza === 'number' ? doc(reemplaza) : reemplaza, motivoCodigo: 'ACTUALIZACION' }, extra || {}));
const rechazado = (n, extra) => crudo('ITF_RECHAZADO', Object.assign({ documentoId: doc(n), motivoCodigo: 'ILEGIBLE' }, extra || {}));
const retirado = (n, extra) => crudo('ITF_RETIRADO', Object.assign({ documentoId: typeof n === 'number' ? doc(n) : n, motivoCodigo: 'DOCUMENTO_INCORRECTO' }, extra || {}));
const revertido = (n, reemplaza, extra) => crudo('ITF_REVERTIDO', Object.assign({
  documentoId: typeof n === 'number' ? doc(n) : n, motivoCodigo: 'ERROR_DE_APROBACION'
}, reemplaza === undefined || reemplaza === null || reemplaza === '' ? {} : { documentoReemplazadoId: typeof reemplaza === 'number' ? doc(reemplaza) : reemplaza }, extra || {}));
const legacy = (wellId, extra) => crudo('ITF_LEGACY_REGISTRADO', Object.assign({
  documentoId: 'LEGACY:' + (wellId || WELL), wellId: wellId || WELL, mimeType: 'image/jpeg', bytes: 150000, sha256: sha(9000), storageFileId: storageId(9000), nombreOriginal: (wellId || WELL) + '.jpg', clientRequestId: ''
}, extra || {}));

// --- Simulador minimo del SERVICIO futuro (E9-3+): lo que hara el orquestador, sin hojas. Deriva sobre TODOS los eventos, arma `existentes` como el repositorio, planifica y, si corresponde,
// agrega los eventos con su secuencia. Sirve para probar cadenas de acciones sobre el dominio puro.
const USUARIOS = {
  ana: { email: 'ana@x.com', nombre: 'Ana', permisos: { perfil: true, perfil_subir: true } },
  val: { email: 'val@x.com', nombre: 'Valeria', permisos: { perfil: true, perfil_validar: true } },
  ambos: { email: 'carla@x.com', nombre: 'Carla', permisos: { perfil: true, perfil_subir: true, perfil_validar: true } },
  lee: { email: 'lee@x.com', nombre: 'Lee', permisos: { perfil: true } }
};
const SNAP = { mimeType: 'image/jpeg', bytes: 150000, sha256: sha(9000), storageFileId: storageId(9000), nombreOriginal: WELL + '.jpg' };
const archivo = (n) => ({ mimeType: 'image/jpeg', bytes: 5000 + n, sha256: sha(n), storageFileId: storageId(n), nombreOriginal: 'f' + n + '.jpg' });

function crearSim(D, opciones) {
  const o = opciones || {};
  const sim = { eventos: o.eventos || [], legacy: { disponible: true, snapshot: SNAP }, pozoExiste: true, llamadasId: 0, docs: 0, ahora: new Date(ISO) };
  if (o.legacy) { Object.assign(sim.legacy, o.legacy); }
  const nuevoUuid = (base) => () => { sim.llamadasId += 1; return uuid(base + sim.llamadasId); };
  sim.existentes = (email, crid) => {
    const coinciden = sim.eventos.filter((e) => String(e.email).toLowerCase() === email && e.clientRequestId === crid);
    return { total: coinciden.length, eventos: coinciden.slice(0, 2) };
  };
  sim.contexto = (usuario, extra) => Object.assign({
    email: usuario.email, nombre: usuario.nombre, permisos: usuario.permisos, ahora: sim.ahora, derivacion: D.itfDominio_derivar(sim.eventos),
    existentes: { total: 0, eventos: [] }, nuevoEventoId: nuevoUuid(20000), nuevoDocumentoId: nuevoUuid(30000), legacy: sim.legacy, pozoExiste: sim.pozoExiste
  }, extra || {});
  sim.ejecutar = (usuario, comando, extra) => {
    const ctx = sim.contexto(usuario, extra);
    if (!extra || extra.existentes === undefined) {
      ctx.existentes = sim.existentes(String(usuario.email).trim().toLowerCase(), comando && comando.clientRequestId);
    }
    const plan = D.itfDominio_planificar(comando, ctx);
    if (plan.ok && plan.accion === 'ESCRIBIR') {
      plan.eventos.forEach((e) => {
        const max = sim.eventos.reduce((m, x) => Math.max(m, x.secuencia), 0);
        sim.eventos.push(Object.assign({}, e, { secuencia: max + 1, fila: sim.eventos.length + 2 }));
      });
    }
    return plan;
  };
  sim.estado = (wellId, legacyDisp) => D.itfDominio_estadoPozo(wellId || WELL, D.itfDominio_derivar(sim.eventos), legacyDisp === undefined ? sim.legacy.disponible : legacyDisp);
  return sim;
}
let crids = 0;
const crid = () => { crids += 1; return 'cmd-req-' + String(crids).padStart(8, '0'); };

module.exports = { ISO, WELL, uuid, sha, storageId, reiniciar, crudo, doc, propuesto, aprobado, rechazado, retirado, revertido, legacy, USUARIOS, SNAP, archivo, crearSim, crid };
