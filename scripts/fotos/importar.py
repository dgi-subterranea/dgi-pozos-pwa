#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Plan (DRY-RUN) de importacion de un lote ya normalizado a FotosPozos. NO sube nada y NO toca produccion.

Lee scripts/out/fotos/<lote>/ (lo genera normalizar.py) y verifica, ANTES de cualquier subida real:
  * solo fotos CONFIRMADO (nunca POR_REVISAR ni EXCLUIDA_IMPORTACION) y sin fotoId repetidos;
  * cada archivo existe, es JPEG, no trae EXIF/XMP/IPTC/comentarios, y se llama SOLO por fotoId
    (nada de nombres/rutas originales, ni en las filas ni en los nombres a subir);
  * cada fila respeta el esquema de la hoja FotosPozos (enums, fecha/precision, carpeta de anio);
  * ruta de destino en el Drive secundario: FotosPozos/<fuente>/<anio|sin_fecha>/<fotoId>.jpg (+ _thumb.jpg).
Muestra: cantidad, fotoIds, entidades afectadas, peso, rutas de destino y las filas que se crearian, y deja
plan_importacion.json (con su huella) y reporte_dryrun.txt en la carpeta del lote.

Uso (desde la raiz del repo):
    python scripts/fotos/importar.py --lote piloto30 --dry-run [--sin-detalle]

La importacion real todavia NO esta habilitada: exige que este plan se haya generado y que su huella coincida
(ver docs/fotos-pozos-importacion.md). Sin --dry-run el script se niega a continuar.
"""
import argparse
import collections
import hashlib
import json
import re
import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fotos_comun as C  # noqa: E402

FUENTES = ('MONITOREO_NE', 'RELEVAMIENTO_2018', 'CAMPO_APP')
TIPOS = ('CERCA', 'PANORAMICA', 'OTRA')
PRECISIONES = ('DIA', 'MES', 'ANIO', 'DESCONOCIDA')
FUENTES_FECHA = ('EXIF', 'CARPETA', 'NOMBRE_ANIO', 'ARCHIVO', 'USUARIO', 'DESCONOCIDA')
METODOS_VINCULO = ('NOMBRE_ARCHIVO', 'NOMBRE_ARCHIVO_GPS', 'MANUAL', 'CAMPO_APP')
RAIZ_DESTINO = 'FotosPozos'
RE_WELL = re.compile(r'^\d{2}-\d{4}$')
RE_UUID = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
RE_CARPETA_FECHA = re.compile(r'^(20\d{2}|sin_fecha)$')
RE_SHA1 = re.compile(r'^[0-9a-f]{40}$')
# Cualquier rastro de ruta/archivo original en una celda (los nombres reales traen apellidos o lugares)
RE_RASTRO_ARCHIVO = re.compile(r'[\\/]|\.(jpe?g|png|heic|thm|info)\b|^[A-Za-z]:', re.I)


def carpeta_fecha(fila):
    """Carpeta del anio en el Drive: el anio de la fecha, o 'sin_fecha' si no se conoce."""
    if fila['fechaFotoPrecision'] == 'DESCONOCIDA' or not fila['fechaFotoValor']:
        return 'sin_fecha'
    return str(fila['fechaFotoValor'])[:4]


def rutas_destino(fila):
    base = '%s/%s/%s/%s' % (RAIZ_DESTINO, fila['fuente'], carpeta_fecha(fila), fila['fotoId'])
    return base + '.jpg', base + '_thumb.jpg'


def _validar_fila(fila, errores):
    fid = fila.get('fotoId', '?')

    def err(msg):
        errores.append('%s: %s' % (fid, msg))
    if list(fila.keys()) != C.FOTOSPOZOS_COLUMNAS:
        err('las columnas no coinciden con el esquema de la hoja FotosPozos')
        return
    if not RE_UUID.match(str(fila['fotoId'])):
        err('fotoId no es un UUID')
    if not RE_WELL.match(str(fila['wellId'])) or fila['monitoringId']:
        err('la entidad debe ser un wellId DD-PPPP (los puntos NE con numero de pozo usan wellId)')
    if fila['fuente'] not in FUENTES:
        err('fuente invalida')
    if fila['tipoFoto'] not in TIPOS:
        err('tipoFoto invalido')
    if fila['fechaFotoPrecision'] not in PRECISIONES or fila['fechaFotoFuente'] not in FUENTES_FECHA:
        err('fecha: precision o fuente invalida')
    valor, prec = str(fila['fechaFotoValor']), fila['fechaFotoPrecision']
    esperado = {'DIA': r'^\d{4}-\d{2}-\d{2}$', 'MES': r'^\d{4}-\d{2}$', 'ANIO': r'^\d{4}$', 'DESCONOCIDA': r'^$'}.get(prec)
    if esperado and not re.match(esperado, valor):
        err('fechaFotoValor "%s" no corresponde a la precision %s' % (valor, prec))
    if not RE_CARPETA_FECHA.match(carpeta_fecha(fila)):
        err('el anio de la fecha no entra en la carpeta de destino')
    if fila['estadoVinculo'] != 'CONFIRMADO' or fila['estado'] != 'ACTIVA':
        err('solo se importan filas CONFIRMADO / ACTIVA')
    if fila['vinculoMetodo'] not in METODOS_VINCULO:
        err('vinculoMetodo invalido')
    if (fila['gpsLat'] == '') != (fila['gpsLon'] == '') or (fila['gpsLat'] != '' and fila['gpsOrigen'] != 'EXIF_ORIGINAL'):
        err('gps incompleto o sin origen')
    if fila['mimeType'] != 'image/jpeg':
        err('mimeType debe ser image/jpeg')
    if not RE_SHA1.match(str(fila['sha1Original'])):
        err('sha1Original invalido')
    if fila['driveFileId'] != '' or fila['driveThumbId'] != '':
        err('un lote nuevo no puede traer ids de Drive (se completan al subir)')
    for col, v in fila.items():
        if isinstance(v, str) and col not in ('procesamiento', 'mimeType') and RE_RASTRO_ARCHIVO.search(v):
            err('la columna %s parece contener una ruta o nombre de archivo' % col)
    if fila['observacion']:
        err('las fotos historicas no llevan observacion (podria traer nombres)')


def _validar_archivo(carpeta, fila, errores, avisos):
    fid = fila['fotoId']
    img = carpeta / 'normalizado' / (fid + '.jpg')
    thumb = carpeta / 'thumbs' / (fid + '_thumb.jpg')
    info = {'peso': 0, 'pesoThumb': 0}
    for nombre, ruta, minimo in (('imagen', img, 1), ('miniatura', thumb, 1)):
        if not ruta.is_file():
            errores.append('%s: falta el archivo de la %s (%s)' % (fid, nombre, ruta.name))
            return info
        datos = ruta.read_bytes()
        if len(datos) < minimo or C.formato_por_contenido(datos[:8]) != 'JPEG':
            errores.append('%s: la %s no es un JPEG valido' % (fid, nombre))
            return info
        meta = C.metadatos_presentes(datos)
        if meta:
            errores.append('%s: la %s conserva metadatos (%s): no se puede subir' % (fid, nombre, ','.join(meta)))
        if nombre == 'imagen':
            info['peso'] = len(datos)
            if len(datos) != fila['tamanoBytes']:
                errores.append('%s: el peso del archivo (%d) no coincide con tamanoBytes de la fila (%d)' % (fid, len(datos), fila['tamanoBytes']))
            if len(datos) > int(1.5 * 1024 * 1024):
                avisos.append('%s: pesa %.2f MB (mas del objetivo de 1,5 MB)' % (fid, len(datos) / 1048576.0))
        else:
            info['pesoThumb'] = len(datos)
    return info


def planificar(carpeta_lote):
    """Arma el plan del lote. Devuelve dict serializable con 'errores' (lista; vacia = apto para subir)."""
    carpeta = Path(carpeta_lote)
    errores, avisos = [], []
    manifiesto = json.loads((carpeta / 'manifiesto_privado.json').read_text(encoding='utf-8'))
    filas = json.loads((carpeta / 'filas_FotosPozos.json').read_text(encoding='utf-8'))
    por_id = {r['fotoId']: r for r in manifiesto}

    # 1) solo CONFIRMADO; las demas quedan afuera y se cuentan (nunca se importan)
    omitidas = collections.Counter(r['estado'] for r in manifiesto if not r['subir'])
    for r in manifiesto:
        if r['subir'] and r['estado'] != C.ESTADO_CONFIRMADO:
            errores.append('%s: figura para subir pero su estado es %s' % (r['fotoId'], r['estado']))
        if r['subir'] and r['fotoId'] != C.foto_id(r['sha1']):
            errores.append('%s: el fotoId no corresponde al SHA-1 (uuid5)' % r['fotoId'])
    ids = [f['fotoId'] for f in filas]
    repetidos = [i for i, n in collections.Counter(ids).items() if n > 1]
    for i in repetidos:
        errores.append('%s: fotoId repetido en el lote' % i)
    sha_vistos = collections.Counter(f['sha1Original'] for f in filas)
    for s, n in sha_vistos.items():
        if n > 1:
            errores.append('contenido repetido en el lote (mismo SHA-1 en %d filas)' % n)
    for f in filas:
        r = por_id.get(f['fotoId'])
        if r is None or not r['subir']:
            errores.append('%s: la fila no tiene un registro CONFIRMADO en el manifiesto' % f['fotoId'])

    # 2) esquema + archivos
    elementos, peso, peso_thumb = [], 0, 0
    for f in filas:
        _validar_fila(f, errores)
        info = _validar_archivo(carpeta, f, errores, avisos)
        peso += info['peso']
        peso_thumb += info['pesoThumb']
        destino, destino_thumb = rutas_destino(f)
        r = por_id.get(f['fotoId'], {})
        elementos.append({
            'fotoId': f['fotoId'], 'wellId': f['wellId'], 'fuente': f['fuente'], 'tipoFoto': f['tipoFoto'],
            'fecha': f['fechaFotoValor'], 'precision': f['fechaFotoPrecision'], 'fechaFuente': f['fechaFotoFuente'],
            'gps': f['gpsLat'] != '', 'validadoContra': r.get('fuenteValidacionId'),
            'procesamiento': f['procesamiento'], 'ancho': f['ancho'], 'alto': f['alto'],
            'peso': info['peso'], 'pesoThumb': info['pesoThumb'], 'destino': destino, 'destinoThumb': destino_thumb,
        })

    # 3) archivos huerfanos en la carpeta de salida (no deberian subirse sin fila)
    esperados = set(ids)
    for sub, sufijo in (('normalizado', '.jpg'), ('thumbs', '_thumb.jpg')):
        d = carpeta / sub
        if d.is_dir():
            for p in d.iterdir():
                if not p.name.endswith(sufijo) or p.name[:-len(sufijo)] not in esperados:
                    avisos.append('archivo sin fila en %s/: %s (no se subira)' % (sub, p.name if RE_UUID.match(p.name[:36]) else '<nombre no estandar>'))

    entidades = collections.defaultdict(list)
    for e in elementos:
        entidades[e['wellId']].append(e['fotoId'])
    cuenta = collections.Counter
    huella = hashlib.sha256(json.dumps([[e['fotoId'], e['destino'], e['peso']] for e in elementos], sort_keys=True).encode('utf-8')).hexdigest()
    return {
        'lote': carpeta.name,
        'loteImportacion': filas[0]['loteImportacion'] if filas else '',
        'cantidad': len(filas),
        'omitidasPorEstado': dict(omitidas),
        'pesoImagenesBytes': peso, 'pesoMiniaturasBytes': peso_thumb,
        'pozos': len(entidades),
        'pozosConVariasFotos': {w: len(v) for w, v in sorted(entidades.items()) if len(v) > 1},
        'porFuente': dict(cuenta(e['fuente'] for e in elementos)),
        'porTipo': dict(cuenta(e['tipoFoto'] for e in elementos)),
        'porPrecisionFecha': dict(cuenta(e['precision'] for e in elementos)),
        'porAnio': dict(sorted(cuenta(e['fecha'][:4] if e['fecha'] else 'sin_fecha' for e in elementos).items())),
        'validadoContra': dict(cuenta(e['validadoContra'] for e in elementos)),
        'conGps': sum(1 for e in elementos if e['gps']),
        'elementos': elementos,
        'errores': errores, 'avisos': avisos,
        'huella': huella,
    }


def _mb(b):
    return '%.2f MB' % (b / 1048576.0)


def informe(plan, detalle=True):
    L = []
    L.append('=== DRY-RUN de importacion a FotosPozos: lote "%s" (loteImportacion=%s) ===' % (plan['lote'], plan['loteImportacion']))
    L.append('Modo: SOLO PLAN. No se sube nada, no se escribe en Drive ni en la hoja.')
    L.append('')
    L.append('Fotos a importar (solo CONFIRMADO): %d   | pozos afectados: %d   | con GPS historico: %d' % (plan['cantidad'], plan['pozos'], plan['conGps']))
    L.append('Omitidas del manifiesto por estado (nunca se importan): %s' % (plan['omitidasPorEstado'] or 'ninguna'))
    L.append('Peso: imagenes %s + miniaturas %s = %s' % (_mb(plan['pesoImagenesBytes']), _mb(plan['pesoMiniaturasBytes']), _mb(plan['pesoImagenesBytes'] + plan['pesoMiniaturasBytes'])))
    L.append('Por fuente: %s' % plan['porFuente'])
    L.append('Por tipo: %s' % plan['porTipo'])
    L.append('Fecha: precision %s | anio %s' % (plan['porPrecisionFecha'], plan['porAnio']))
    L.append('Entidad validada contra (solo informativo, no va a la hoja): %s' % plan['validadoContra'])
    if plan['pozosConVariasFotos']:
        L.append('Pozos con varias fotos: %s' % plan['pozosConVariasFotos'])
    carpetas = collections.Counter('/'.join(e['destino'].split('/')[:-1]) for e in plan['elementos'])
    L.append('')
    L.append('Carpetas de destino en el Drive secundario (fotos por carpeta):')
    for c, n in sorted(carpetas.items()):
        L.append('  %s/   %d' % (c, n))
    if detalle:
        L.append('')
        L.append('Filas que se crearian en la hoja FotosPozos (driveFileId / driveThumbId se completan al subir):')
        L.append('  %-36s %-7s %-17s %-10s %-10s %-6s %-11s %-3s %8s' % ('fotoId', 'wellId', 'fuente', 'tipo', 'fecha', 'prec.', 'fechaFuente', 'gps', 'KB'))
        for e in plan['elementos']:
            L.append('  %-36s %-7s %-17s %-10s %-10s %-6s %-11s %-3s %8d' % (
                e['fotoId'], e['wellId'], e['fuente'], e['tipoFoto'], e['fecha'] or '(sin)', e['precision'], e['fechaFuente'],
                'SI' if e['gps'] else '-', round(e['peso'] / 1024.0)))
        L.append('')
        L.append('Valores fijos de las filas: estadoVinculo=CONFIRMADO, estado=ACTIVA, vinculoMetodo=NOMBRE_ARCHIVO[_GPS], '
                 'emailUsuarioCarga=IMPORTACION, mimeType=image/jpeg, observacion vacia, gpsOrigen=EXIF_ORIGINAL (solo con GPS).')
        L.append('Destino de cada foto: <carpeta>/<fotoId>.jpg y <fotoId>_thumb.jpg (ver arriba). Archivos nombrados SOLO por fotoId.')
    L.append('')
    if plan['avisos']:
        L.append('AVISOS (%d):' % len(plan['avisos']))
        L.extend('  - ' + a for a in plan['avisos'])
    if plan['errores']:
        L.append('ERRORES (%d) -> el lote NO es apto para subir:' % len(plan['errores']))
        L.extend('  - ' + e for e in plan['errores'][:60])
    else:
        L.append('Verificaciones OK: solo CONFIRMADO, sin fotoId ni contenido repetido, JPEG sin metadatos, nombres solo por fotoId, esquema valido.')
    L.append('Huella del plan: %s' % plan['huella'])
    return '\n'.join(L)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--lote', required=True, help='subcarpeta de scripts/out/fotos/ con el lote normalizado (p. ej. piloto30)')
    ap.add_argument('--dry-run', action='store_true', help='OBLIGATORIO: genera el plan y no sube nada')
    ap.add_argument('--sin-detalle', action='store_true', help='no lista una por una las filas que se crearian')
    ap.add_argument('--salida', default=str(C.OUT_FOTOS))
    args = ap.parse_args(argv)
    if not args.dry_run:
        print('La importacion real todavia no esta habilitada: primero se aprueba el plan con --dry-run.', file=sys.stderr)
        return 2
    carpeta = Path(args.salida) / args.lote
    plan = planificar(carpeta)
    texto = informe(plan, detalle=not args.sin_detalle)
    (carpeta / 'plan_importacion.json').write_text(json.dumps(plan, ensure_ascii=False, indent=1), encoding='utf-8')
    (carpeta / 'reporte_dryrun.txt').write_text(informe(plan, detalle=True), encoding='utf-8')
    print(texto)
    return 1 if plan['errores'] else 0


if __name__ == '__main__':
    sys.exit(main())
