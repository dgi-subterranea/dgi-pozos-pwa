# -*- coding: utf-8 -*-
"""Benchmark CONTROLADO de la subida de fotos al storage: compara de a una vs. concurrencia vs. lotes con fotos descartables.

Que hace:
  - Toma N fotos YA MIGRADAS de un lote (solo lee sus JPG normalizados y miniaturas) y las sube con fotoId NUEVOS al azar,
    en la fuente descartable BENCHMARK_TEMP (carpeta FotosPozos/BENCHMARK_TEMP/sin_fecha/). Nunca usa fuentes reales,
    nunca toca el fotoId de una foto real y NO escribe nada en ninguna hoja: no hay filas en FotosPozos.
  - Mide cada modo (tiempo total, fotos por minuto, errores, reintentos, tiempo de solicitud y tiempo dentro del storage).
  - Al terminar manda todo lo subido a la PAPELERA de Drive (nunca borrado definitivo), salvo --conservar.
  - Cada id creado se anota apenas se conoce en scripts/out/fotos/benchmark/benchmark_ids.jsonl (carpeta privada e ignorada
    por git), asi `limpiar` puede vaciar la prueba aunque se corte la corrida.

Usa el MISMO motor que la subida real (importar._subir_una / _subir_lote / ejecutar_unidades), el mismo cliente firmado
y las mismas variables de entorno FOTOS_STORAGE_URL / FOTOS_STORAGE_SECRET (nunca se imprimen).

Uso:
    python scripts/fotos/benchmark_subida.py medir --lote validacion100                       # muestra el plan y NO sube nada
    python scripts/fotos/benchmark_subida.py medir --lote validacion100 --confirmar-benchmark # sube (descartable) y mide
        --cantidad 24                     fotos por modo (2 a 40; recomendado 24)
        --modos s,c2,c4,l5,l5c2           s = de a una | cN = N solicitudes a la vez | lK = K fotos por solicitud | lKcN = ambos
    python scripts/fotos/benchmark_subida.py limpiar                                          # papelera para lo que haya quedado
"""
import argparse
import hashlib
import json
import re
import shutil
import sys
import tempfile
import time
import uuid
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fotos_comun as C  # noqa: E402
import importar as I  # noqa: E402
import storage_cliente as SC  # noqa: E402

FUENTE_PRUEBA = 'BENCHMARK_TEMP'
MODOS_POR_DEFECTO = 's,c2,c4,l5,l5c2'
MIN_FOTOS, MAX_FOTOS = 2, 40
RE_MODO = re.compile(r'^(?:s|c(\d+)|l(\d+)(?:c(\d+))?)$')
ARCHIVO_IDS = 'benchmark_ids.jsonl'


class ErrorBenchmark(Exception):
    pass


def parsear_modos(texto):
    """'s,c2,l5c2' -> [('s', 1, 1), ('c2', 2, 1), ('l5c2', 2, 5)]  (nombre, concurrencia, fotos por solicitud)."""
    modos = []
    for crudo in [m.strip() for m in texto.split(',') if m.strip()]:
        m = RE_MODO.match(crudo)
        if not m:
            raise ErrorBenchmark('modo invalido: "%s" (usar s, cN, lK o lKcN)' % crudo)
        conc = int(m.group(1) or m.group(3) or 1)
        lote = int(m.group(2) or 1)
        if not (1 <= conc <= I.MAX_CONCURRENCIA) or not (1 <= lote <= I.MAX_LOTE):
            raise ErrorBenchmark('modo fuera de rango: "%s" (concurrencia 1-%d, lote 1-%d)' % (crudo, I.MAX_CONCURRENCIA, I.MAX_LOTE))
        modos.append((crudo, conc, lote))
    if not modos:
        raise ErrorBenchmark('no hay modos para medir')
    return modos


def _carpeta_privada(salida):
    return Path(salida) / 'benchmark'


def _anotar_id(carpeta, registro):
    carpeta.mkdir(parents=True, exist_ok=True)
    registro = dict(registro, origen='benchmark', fuente=FUENTE_PRUEBA)      # marca de que lo creo el benchmark
    with open(str(carpeta / ARCHIVO_IDS), 'a', encoding='utf-8') as f:
        f.write(json.dumps(registro, sort_keys=True) + '\n')


def leer_muestra(carpeta_lote, cantidad):
    """Las primeras `cantidad` fotos del plan del lote ya migrado: (bytes de la foto, bytes de la miniatura, sha256, sha256 mini)."""
    carpeta = Path(carpeta_lote)
    try:
        plan = json.loads((carpeta / 'plan_importacion.json').read_text(encoding='utf-8'))
    except (OSError, ValueError):
        raise ErrorBenchmark('no se pudo leer plan_importacion.json de "%s" (correr el dry-run del lote).' % carpeta.name)
    muestra = []
    for e in plan['elementos']:
        img = carpeta / 'normalizado' / (e['fotoId'] + '.jpg')
        thumb = carpeta / 'thumbs' / (e['fotoId'] + '_thumb.jpg')
        if img.is_file() and thumb.is_file():
            muestra.append((img.read_bytes(), thumb.read_bytes()))
        if len(muestra) == cantidad:
            break
    if len(muestra) < cantidad:
        raise ErrorBenchmark('el lote "%s" tiene solo %d fotos disponibles (se pidieron %d).' % (carpeta.name, len(muestra), cantidad))
    return muestra


def armar_lote_descartable(destino, muestra):
    """Crea en `destino` una carpeta de lote con fotoId NUEVOS (uuid4) y devuelve (elementos, filas)."""
    destino = Path(destino)
    (destino / 'normalizado').mkdir(parents=True)
    (destino / 'thumbs').mkdir(parents=True)
    elementos, filas = [], {}
    for img, thumb in muestra:
        fid = str(uuid.uuid4())
        (destino / 'normalizado' / (fid + '.jpg')).write_bytes(img)
        (destino / 'thumbs' / (fid + '_thumb.jpg')).write_bytes(thumb)
        elementos.append({'fotoId': fid, 'fuente': FUENTE_PRUEBA, 'sha256': hashlib.sha256(img).hexdigest(),
                          'sha256Thumb': hashlib.sha256(thumb).hexdigest()})
        filas[fid] = {'fotoId': fid, 'fuente': FUENTE_PRUEBA, 'fechaFotoPrecision': 'DESCONOCIDA', 'fechaFotoValor': ''}
    return elementos, filas


def _percentil(valores, p):
    if not valores:
        return 0.0
    v = sorted(valores)
    return v[min(len(v) - 1, int(round(p * (len(v) - 1))))]


def medir_modo(cliente, muestra, nombre, concurrencia, tamano_lote, carpeta_privada, reintentos=4, esperar=time.sleep, log=print):
    """Sube la muestra (con ids nuevos) en un modo y devuelve las metricas. Registra cada id creado para poder limpiarlo."""
    tmp = Path(tempfile.mkdtemp(prefix='bench_'))
    try:
        elementos, filas = armar_lote_descartable(tmp, muestra)
        for e in elementos:                                                      # primero se anota el id: aunque se corte, se puede limpiar
            _anotar_id(carpeta_privada, {'fotoId': e['fotoId'], 'modo': nombre, 'estado': 'PLANEADA'})
        unidades = [elementos[i:i + tamano_lote] for i in range(0, len(elementos), tamano_lote)]
        registros = []

        def procesar(unidad):
            if tamano_lote == 1:
                return [(unidad[0], I._subir_una(cliente, tmp, unidad[0], filas[unidad[0]['fotoId']], reintentos, esperar))]
            return list(zip(unidad, I._subir_lote(cliente, tmp, unidad, filas, reintentos, esperar)))

        def anotar(e, reg):
            registros.append(reg)
            if reg.get('driveFileId'):
                _anotar_id(carpeta_privada, {'fotoId': e['fotoId'], 'modo': nombre, 'estado': reg['estado'],
                                             'driveFileId': reg['driveFileId'], 'driveThumbId': reg.get('driveThumbId')})

        t0 = time.time()
        abortada, no_intentadas = I.ejecutar_unidades(unidades, procesar, concurrencia, anotar, log)
        seg = time.time() - t0
    finally:
        shutil.rmtree(str(tmp), ignore_errors=True)
    ok = [r for r in registros if r['estado'] in I.ESTADOS_OK]
    http = [r['ms']['http'] for r in ok if r.get('ms')]
    storage = {}
    for r in ok:
        for k, v in (r.get('tiemposStorage') or {}).items():
            storage.setdefault(k, []).append(v)
    return {
        'modo': nombre, 'concurrencia': concurrencia, 'fotosPorSolicitud': tamano_lote, 'fotos': len(elementos),
        'segundos': round(seg, 1), 'fotosPorMinuto': round(len(ok) * 60.0 / seg, 1) if seg > 0 else 0.0,
        'subidas': len(ok), 'fallidas': len(registros) - len(ok), 'noIntentadas': no_intentadas, 'abortada': bool(abortada),
        'reintentos': sum(max(0, (r.get('intentos') or 1) - 1) for r in registros),
        'motivosFallo': sorted({str(r.get('motivo')) for r in registros if r['estado'] not in I.ESTADOS_OK}),
        'solicitudMsMedia': round(sum(http) / float(len(http)), 0) if http else 0,
        'solicitudMsP95': _percentil(http, 0.95),
        'storageMs': {k: round(sum(v) / float(len(v)), 0) for k, v in sorted(storage.items())},
        'bytesEnviados': sum(r.get('enviadoBytes') or 0 for r in ok)
    }


def _ids_de_lotes_reales(salida):
    """fotoId y ids de Drive de TODOS los lotes de la carpeta de salida (menos el benchmark): jamas se mandan a la papelera."""
    protegidos = set()
    if salida is None or not Path(salida).is_dir():
        return protegidos
    for lote in Path(salida).iterdir():
        est = lote / I.ESTADO_ARCHIVO
        if lote.name == 'benchmark' or not est.is_file():
            continue
        for linea in est.read_text(encoding='utf-8').splitlines():
            if linea.strip():
                r = json.loads(linea)
                protegidos.update(str(r.get(k)) for k in ('fotoId', 'driveFileId', 'driveThumbId') if r.get(k))
    return protegidos


def a_papelera(cliente, carpeta_privada, log=print, esperar=time.sleep, salida=None):
    """Manda a la papelera de Drive SOLO lo que el propio benchmark creo (registro con origen=benchmark y fuente BENCHMARK_TEMP,
    y que no figure en ningun lote real). Todo lo demas se ignora. Devuelve (papelera, fallas)."""
    ruta = carpeta_privada / ARCHIVO_IDS
    if not ruta.is_file():
        return 0, 0
    protegidos = _ids_de_lotes_reales(salida if salida is not None else carpeta_privada.parent)
    ultimo = {}
    for linea in ruta.read_text(encoding='utf-8').splitlines():
        if linea.strip():
            r = json.loads(linea)
            ultimo.setdefault(r['fotoId'], {}).update(r)
    hechas = fallas = 0
    for fid, r in sorted(ultimo.items()):
        if r.get('estado') in ('PAPELERA', 'PLANEADA') or not r.get('driveFileId'):
            continue
        if r.get('origen') != 'benchmark' or r.get('fuente') != FUENTE_PRUEBA or {fid, r['driveFileId'], str(r.get('driveThumbId'))} & protegidos:
            log('se ignora %s: no es una foto de prueba del benchmark' % fid)
            continue
        for intento in range(1, 6):
            try:
                cliente.llamar('trashFotoPozo', {'driveFileId': r['driveFileId']})
                _anotar_id(carpeta_privada, {'fotoId': fid, 'estado': 'PAPELERA', 'driveFileId': r['driveFileId']})
                hechas += 1
                break
            except SC.ErrorPermanente as err:
                if err.codigo == 'NOT_FOUND':                      # ya no esta: nada que limpiar
                    _anotar_id(carpeta_privada, {'fotoId': fid, 'estado': 'PAPELERA', 'driveFileId': r['driveFileId']})
                    break
                fallas += 1
                log('no se pudo mandar a la papelera %s: %s' % (fid, err.codigo))
                break
            except SC.ErrorTransitorio:
                if intento == 5:
                    fallas += 1
                    log('no se pudo mandar a la papelera %s (red)' % fid)
                else:
                    esperar(I.ESPERAS[min(intento - 1, len(I.ESPERAS) - 1)])
    return hechas, fallas


def informe(resultados, lote, cantidad):
    L = ['=== Benchmark de subida (fotos descartables en %s, todo a la papelera al terminar) ===' % FUENTE_PRUEBA,
         'Origen de los bytes: lote "%s", %d fotos por modo, ids nuevos al azar.' % (lote, cantidad), '',
         '%-8s %6s %7s %9s %8s %6s %8s %12s %s' % ('modo', 'seg', 'foto/min', 'ok/fotos', 'fallidas', 'reint.', 'req(ms)', 'req p95(ms)', 'storage (ms medios por foto)')]
    base = next((r for r in resultados if r['concurrencia'] == 1 and r['fotosPorSolicitud'] == 1 and r['subidas']), None)
    for r in resultados:
        extra = ''
        if base is not None and r is not base and r['subidas']:
            extra = '  (%.1fx vs. de a una)' % (base['segundos'] / r['segundos'] * (r['subidas'] / float(base['subidas']))) if r['segundos'] > 0 else ''
        L.append('%-8s %6.1f %7.1f %9s %8d %6d %8.0f %12.0f %s%s' % (
            r['modo'], r['segundos'], r['fotosPorMinuto'], '%d/%d' % (r['subidas'], r['fotos']), r['fallidas'], r['reintentos'],
            r['solicitudMsMedia'], r['solicitudMsP95'], ' '.join('%s=%d' % kv for kv in r['storageMs'].items()), extra))
        if r['motivosFallo']:
            L.append('         fallos: ' + '; '.join(r['motivosFallo']))
    L.append('')
    for r in resultados:
        if r['subidas'] and r['segundos']:
            L.append('Proyeccion de 4.000 fotos con "%s": %.0f minutos.' % (r['modo'], 4000.0 / r['fotosPorMinuto']))
    return '\n'.join(L)


def medir(args, cliente_factory=None, log=print):
    modos = parsear_modos(args.modos)
    if not (MIN_FOTOS <= args.cantidad <= MAX_FOTOS):
        raise ErrorBenchmark('--cantidad debe estar entre %d y %d.' % (MIN_FOTOS, MAX_FOTOS))
    carpeta_lote = Path(args.salida) / args.lote
    muestra = leer_muestra(carpeta_lote, args.cantidad)
    privada = _carpeta_privada(args.salida)
    log('Plan del benchmark: %d fotos por modo, modos %s, %d subidas descartables en total (%s por modo), fuente %s.' % (
        args.cantidad, ','.join(m[0] for m in modos), args.cantidad * len(modos) + 1,
        I._mb(sum(len(a) + len(b) for a, b in muestra)), FUENTE_PRUEBA))
    if not args.confirmar_benchmark:
        log('No se subio nada. Para ejecutar: agregar --confirmar-benchmark (todo queda en la papelera al terminar).')
        return 0
    cliente = (cliente_factory or SC.ClienteStorage.desde_entorno)()
    resultados = []
    try:
        log('Calentamiento (1 foto, no se cuenta)...')
        medir_modo(cliente, muestra[:1], 'calentamiento', 1, 1, privada, esperar=time.sleep, log=log)
        for nombre, conc, lote in modos:
            log('Midiendo "%s" (concurrencia %d, %d foto(s) por solicitud)...' % (nombre, conc, lote))
            r = medir_modo(cliente, muestra, nombre, conc, lote, privada, log=log)
            resultados.append(r)
            log('  -> %.1f s, %.1f fotos/min, %d fallidas, %d reintentos' % (r['segundos'], r['fotosPorMinuto'], r['fallidas'], r['reintentos']))
            if r['abortada']:
                raise ErrorBenchmark('el storage rechazo la firma o no esta disponible; se detiene el benchmark.')
    finally:
        if args.conservar:
            log('--conservar: las fotos de prueba NO se mandaron a la papelera. Para hacerlo: benchmark_subida.py limpiar')
        else:
            hechas, fallas = a_papelera(cliente, privada, log)
            log('Papelera: %d archivos de prueba enviados (fallas: %d)%s' % (
                hechas, fallas, '' if not fallas else '. Correr "benchmark_subida.py limpiar" para reintentar.'))
    texto = informe(resultados, args.lote, args.cantidad)
    log(texto)
    privada.mkdir(parents=True, exist_ok=True)
    (privada / 'benchmark_resultado.txt').write_text(texto, encoding='utf-8')
    (privada / 'benchmark_resultado.json').write_text(json.dumps(
        {'fecha': datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ'), 'lote': args.lote, 'cantidad': args.cantidad,
         'resultados': resultados}, indent=2, sort_keys=True), encoding='utf-8')
    return 0


def main(argv=None, cliente_factory=None):
    ap = argparse.ArgumentParser(description='Benchmark controlado de la subida de fotos (descartable, termina en la papelera).')
    sub = ap.add_subparsers(dest='cmd')
    m = sub.add_parser('medir')
    m.add_argument('--lote', required=True, help='lote ya migrado del que se leen los bytes de las fotos (en --salida)')
    m.add_argument('--salida', default=str(C.OUT_FOTOS))
    m.add_argument('--cantidad', type=int, default=24)
    m.add_argument('--modos', default=MODOS_POR_DEFECTO)
    m.add_argument('--confirmar-benchmark', action='store_true', help='sin esta bandera solo se muestra el plan')
    m.add_argument('--conservar', action='store_true', help='no mandar las fotos de prueba a la papelera al terminar')
    c = sub.add_parser('limpiar')
    c.add_argument('--salida', default=str(C.OUT_FOTOS))
    a = ap.parse_args(argv)
    if a.cmd is None:
        ap.print_help()
        return 2
    try:
        if a.cmd == 'medir':
            return medir(a, cliente_factory)
        cliente = (cliente_factory or SC.ClienteStorage.desde_entorno)()
        hechas, fallas = a_papelera(cliente, _carpeta_privada(a.salida))
        print('Papelera: %d archivos de prueba enviados (fallas: %d)' % (hechas, fallas))
        return 0 if not fallas else 1
    except (ErrorBenchmark, SC.ErrorConfiguracion, I.ErrorImportacion) as e:
        print('ERROR: %s' % e)
        return 1
    except SC.ErrorAutenticacion as e:
        print('ABORTADO: %s' % e)
        return 1


if __name__ == '__main__':
    sys.exit(main())
