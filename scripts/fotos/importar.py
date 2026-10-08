#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Importacion de un lote ya normalizado a FotosPozos: plan en seco, subida al storage y CSV de staging.

Lee scripts/out/fotos/<lote>/ (lo genera normalizar.py) y verifica, ANTES de cualquier subida real:
  * solo fotos CONFIRMADO (nunca POR_REVISAR ni EXCLUIDA_IMPORTACION) y sin fotoId repetidos;
  * cada archivo existe, es JPEG, no trae EXIF/XMP/IPTC/comentarios, y se llama SOLO por fotoId
    (nada de nombres/rutas originales, ni en las filas ni en los nombres a subir);
  * cada fila respeta el esquema de la hoja FotosPozos (enums, fecha/precision, carpeta de anio);
  * ruta de destino en el Drive secundario: FotosPozos/<fuente>/<anio|sin_fecha>/<fotoId>.jpg (+ _thumb.jpg).
Muestra: cantidad, fotoIds, entidades afectadas, peso, rutas de destino y las filas que se crearian, y deja
plan_importacion.json (con su huella) y reporte_dryrun.txt en la carpeta del lote.

Uso (desde la raiz del repo):
    python scripts/fotos/importar.py --lote piloto30 --dry-run [--sin-detalle]           # plan en seco (NO sube nada)
    python scripts/fotos/importar.py --lote piloto30 --dry-run --existentes FotosPozos.csv   # ademas verifica que ninguna ya este en la hoja
    python scripts/fotos/importar.py subir --lote piloto30 --confirmar-huella <12+ hex>  # sube al storage (cuenta 2)
        opciones de velocidad (por defecto: de a una, una foto por solicitud):  --concurrencia N   --lote-tamano K
    python scripts/fotos/importar.py exportar-filas --lote piloto30                      # CSV de staging para la hoja

SUBIR exige el plan del dry-run: se niega si no existe, si algun archivo cambio desde entonces o si no se pasa la
huella que mostro el dry-run. URL y secreto del storage SOLO por variables de entorno FOTOS_STORAGE_URL y
FOTOS_STORAGE_SECRET (nunca se imprimen). Una foto por request, progreso reanudable en estado_subida.jsonl.
Ver docs/fotos-pozos-importacion.md.
"""
import argparse
import collections
import hashlib
import json
import re
import csv
import io
import sys
import time
import uuid
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fotos_comun as C  # noqa: E402
import storage_cliente as SC  # noqa: E402

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
RE_DRIVE_ID = re.compile(r'^[A-Za-z0-9_-]{10,100}$')       # mismo formato que valida el storage al devolver ids
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


def _validar_fila(fila, errores, con_ids=False):
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
    if con_ids:
        # fila ya subida (staging): ids de Drive validos y distintos entre si
        if not RE_DRIVE_ID.match(str(fila['driveFileId'])) or not RE_DRIVE_ID.match(str(fila['driveThumbId'])):
            err('driveFileId / driveThumbId con formato invalido')
        elif fila['driveFileId'] == fila['driveThumbId']:
            err('driveFileId y driveThumbId no pueden ser el mismo archivo')
    elif fila['driveFileId'] != '' or fila['driveThumbId'] != '':
        err('un lote nuevo no puede traer ids de Drive (se completan al subir)')
    for col, v in fila.items():
        if isinstance(v, str) and col not in ('procesamiento', 'mimeType', 'driveFileId', 'driveThumbId') and RE_RASTRO_ARCHIVO.search(v):
            err('la columna %s parece contener una ruta o nombre de archivo' % col)
    if fila['observacion']:
        err('las fotos historicas no llevan observacion (podria traer nombres)')


def _validar_archivo(carpeta, fila, errores, avisos):
    fid = fila['fotoId']
    img = carpeta / 'normalizado' / (fid + '.jpg')
    thumb = carpeta / 'thumbs' / (fid + '_thumb.jpg')
    info = {'peso': 0, 'pesoThumb': 0, 'sha256': '', 'sha256Thumb': ''}
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
            info['sha256'] = hashlib.sha256(datos).hexdigest()
            info['peso'] = len(datos)
            if len(datos) != fila['tamanoBytes']:
                errores.append('%s: el peso del archivo (%d) no coincide con tamanoBytes de la fila (%d)' % (fid, len(datos), fila['tamanoBytes']))
            if len(datos) > int(1.5 * 1024 * 1024):
                avisos.append('%s: pesa %.2f MB (mas del objetivo de 1,5 MB)' % (fid, len(datos) / 1048576.0))
        else:
            info['pesoThumb'] = len(datos)
            info['sha256Thumb'] = hashlib.sha256(datos).hexdigest()
    return info


class ErrorImportacionEntrada(Exception):
    pass


def cargar_existentes(ruta):
    """CSV exportado de la hoja FotosPozos (Archivo > Descargar > .csv, coma o punto y coma). Lee SOLO las columnas
    fotoId, wellId / monitoringId y sha1Original; no usa ni copia ninguna otra (la hoja tiene e-mails e ids de Drive).
    Devuelve {'filas', 'fotoIds', 'contenido'}."""
    texto = Path(ruta).read_text(encoding='utf-8-sig')
    primera = texto.splitlines()[0] if texto else ''
    delim = ';' if primera.count(';') > primera.count(',') else ','
    lector = csv.DictReader(io.StringIO(texto), delimiter=delim)
    cols = [c.strip() for c in (lector.fieldnames or [])]
    faltan = [c for c in ('fotoId', 'sha1Original') if c not in cols] + ([] if ('wellId' in cols or 'monitoringId' in cols) else ['wellId'])
    if faltan:
        raise ErrorImportacionEntrada('El CSV de la hoja FotosPozos no tiene las columnas: %s (exportar la hoja completa).' % ', '.join(faltan))
    ids, contenido, n = set(), set(), 0
    for fila in lector:
        fid = (fila.get('fotoId') or '').strip().lower()
        if not fid:
            continue
        n += 1
        ids.add(fid)
        clave = ((fila.get('wellId') or '').strip() or (fila.get('monitoringId') or '').strip())
        sha = (fila.get('sha1Original') or '').strip().lower()
        if clave and sha:
            contenido.add((clave, sha))
    return {'filas': n, 'fotoIds': ids, 'contenido': contenido}


def otros_lotes_confirmados(carpeta):
    """Fotos ya SUBIDAS (SUBIDA / YA_EXISTE) por OTROS lotes de la misma carpeta de salida: {'ids': fotoId -> lote,
    'contenido': (pozo, sha1) -> lote}. Un lote nuevo nunca puede repetir lo ya migrado por otro."""
    base = Path(carpeta).parent
    ids, contenido = {}, {}
    if not base.is_dir():
        return {'ids': ids, 'contenido': contenido}
    for d in sorted(base.iterdir()):
        if d.resolve() == Path(carpeta).resolve() or not d.is_dir() or not (d / 'estado_subida.jsonl').is_file() or not (d / 'filas_FotosPozos.json').is_file():
            continue
        ok = {fid for fid, r in leer_estado(d).items() if r.get('estado') in ESTADOS_OK}
        if not ok:
            continue
        for f in json.loads((d / 'filas_FotosPozos.json').read_text(encoding='utf-8')):
            if f['fotoId'] in ok:
                ids[f['fotoId'].lower()] = d.name
                contenido[(f['wellId'] or f['monitoringId'], str(f['sha1Original']).lower())] = d.name
    return {'ids': ids, 'contenido': contenido}


def _rango(valores):
    v = sorted(valores)
    return {'min': v[0], 'mediana': v[len(v) // 2], 'max': v[-1]} if v else {}


def resultado_plan(plan):
    """Veredicto: BLOQUEADO (hay errores), NO CONCLUYENTE (falta o esta desactualizada la verificacion contra la hoja)
    o APTO PARA SUBIR."""
    if plan['errores']:
        return 'BLOQUEADO'
    if not plan['verificacionHoja']['verificada']:
        return 'NO CONCLUYENTE (falta --existentes con el CSV exportado de la hoja FotosPozos)'
    if plan.get('hojaSinFotosDeOtrosLotes'):
        return 'NO CONCLUYENTE (el CSV de la hoja no contiene %d foto(s) ya subidas de otros lotes: exportarlo de nuevo, o falta importar ese lote a la hoja)' % plan['hojaSinFotosDeOtrosLotes']
    return 'APTO PARA SUBIR'


def planificar(carpeta_lote, existentes=None, lote_nuevo=False):
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
            'peso': info['peso'], 'pesoThumb': info['pesoThumb'], 'sha256': info['sha256'], 'sha256Thumb': info['sha256Thumb'],
            'destino': destino, 'destinoThumb': destino_thumb,
        })

    # 3) archivos huerfanos en la carpeta de salida (no deberian subirse sin fila)
    esperados = set(ids)
    for sub, sufijo in (('normalizado', '.jpg'), ('thumbs', '_thumb.jpg')):
        d = carpeta / sub
        if d.is_dir():
            for p in d.iterdir():
                if not p.name.endswith(sufijo) or p.name[:-len(sufijo)] not in esperados:
                    avisos.append('archivo sin fila en %s/: %s (no se subira)' % (sub, p.name if RE_UUID.match(p.name[:36]) else '<nombre no estandar>'))

    # verificacion contra lo que YA hay en la hoja FotosPozos (solo si se paso el CSV exportado)
    coincidencias = []
    if existentes is not None:
        for f in filas:
            if f['fotoId'].lower() in existentes['fotoIds']:
                coincidencias.append('%s: ya existe en FotosPozos (mismo fotoId)' % f['fotoId'])
            elif (f['wellId'] or f['monitoringId'], str(f['sha1Original']).lower()) in existentes['contenido']:
                coincidencias.append('%s: ya hay una foto con el mismo contenido en el pozo %s' % (f['fotoId'], f['wellId']))
        errores.extend(coincidencias)
    progreso = leer_estado(carpeta)
    previas = sum(1 for r in progreso.values() if r.get('estado') in ESTADOS_OK)
    if previas:
        avisos.append('hay progreso local previo: %d foto(s) ya figuran como subidas en estado_subida.jsonl (no se reenviaran)' % previas)
    if lote_nuevo and (previas or progreso):
        errores.append('progreso local inesperado: se declaro un lote nuevo pero ya existe estado_subida.jsonl con %d registro(s)' % len(progreso))
    # cruce con lo que YA subieron otros lotes (mismo fotoId o mismo contenido en el mismo pozo)
    otros = otros_lotes_confirmados(carpeta)
    cruces = []
    for f in filas:
        lote_previo = otros['ids'].get(f['fotoId'].lower())
        if lote_previo:
            cruces.append('%s: ya subida por el lote %s (mismo fotoId)' % (f['fotoId'], lote_previo))
            continue
        lote_previo = otros['contenido'].get((f['wellId'] or f['monitoringId'], str(f['sha1Original']).lower()))
        if lote_previo:
            cruces.append('%s: el mismo contenido ya fue migrado por el lote %s' % (f['fotoId'], lote_previo))
    errores.extend(cruces)
    sin_en_hoja = 0
    if existentes is not None:
        sin_en_hoja = sum(1 for fid in otros['ids'] if fid not in existentes['fotoIds'])
    entidades = collections.defaultdict(list)
    for e in elementos:
        entidades[e['wellId']].append(e['fotoId'])
    cuenta = collections.Counter
    huella = hashlib.sha256(json.dumps([[e['fotoId'], e['destino'], e['peso'], e['sha256'], e['sha256Thumb']] for e in elementos], sort_keys=True).encode('utf-8')).hexdigest()
    plan = {
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
        'verificacionHoja': ({'verificada': True, 'filasLeidas': existentes['filas'], 'coincidencias': len(coincidencias)} if existentes is not None else {'verificada': False}),
        'progresoLocalPrevio': previas,
        'cruceConOtrosLotes': {'lotesConSubidas': sorted(set(otros['ids'].values())), 'coincidencias': len(cruces)},
        'hojaSinFotosDeOtrosLotes': sin_en_hoja,
        'rangoPesoFinalBytes': _rango([e['peso'] for e in elementos]),
        'rangoPesoOriginalBytes': _rango([por_id[e['fotoId']]['pesoOriginal'] for e in elementos if e['fotoId'] in por_id and 'pesoOriginal' in por_id[e['fotoId']]]),
        'conflictos': len(errores),
    }
    plan['resultado'] = resultado_plan(plan)
    return plan


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
    L.append('GPS historico: %d con GPS / %d sin GPS' % (plan['conGps'], plan['cantidad'] - plan['conGps']))
    if plan.get('rangoPesoFinalBytes'):
        r1, r0 = plan['rangoPesoFinalBytes'], plan.get('rangoPesoOriginalBytes') or {}
        L.append('Tamano de cada foto procesada: min %s | mediana %s | max %s' % (_mb(r1['min']), _mb(r1['mediana']), _mb(r1['max'])))
        if r0:
            L.append('Tamano de cada original: min %s | mediana %s | max %s' % (_mb(r0['min']), _mb(r0['mediana']), _mb(r0['max'])))
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
    vh = plan.get('verificacionHoja') or {'verificada': False}
    if vh['verificada']:
        L.append('Verificacion contra FotosPozos (CSV exportado de la hoja, %d filas): %d coincidencia(s)%s' % (vh['filasLeidas'], vh['coincidencias'], ' -> NINGUNA de estas fotos esta ya en la hoja' if vh['coincidencias'] == 0 else ''))
    else:
        L.append('Verificacion contra FotosPozos: NO realizada (pasar --existentes con el CSV exportado de la hoja para comprobar que ninguna ya existe)')
    L.append('Progreso local previo (estado_subida.jsonl): %d foto(s) ya subidas' % plan.get('progresoLocalPrevio', 0))
    cr = plan.get('cruceConOtrosLotes') or {'lotesConSubidas': [], 'coincidencias': 0}
    L.append('Cruce con otros lotes ya subidos %s: %d coincidencia(s)' % (cr['lotesConSubidas'] or '(ninguno)', cr['coincidencias']))
    if plan.get('hojaSinFotosDeOtrosLotes'):
        L.append('ATENCION: el CSV de la hoja NO contiene %d foto(s) ya subidas por otros lotes (CSV desactualizado, o ese lote todavia no se importo a la hoja)' % plan['hojaSinFotosDeOtrosLotes'])
    if plan['avisos']:
        L.append('AVISOS (%d):' % len(plan['avisos']))
        L.extend('  - ' + a for a in plan['avisos'])
    if plan['errores']:
        L.append('ERRORES (%d) -> el lote NO es apto para subir:' % len(plan['errores']))
        L.extend('  - ' + e for e in plan['errores'][:60])
    else:
        L.append('Verificaciones OK: solo CONFIRMADO, sin fotoId ni contenido repetido, JPEG sin metadatos, nombres solo por fotoId, esquema valido.')
    L.append('Huella del plan: %s' % plan['huella'])
    L.append('Conflictos: %d' % plan.get('conflictos', len(plan['errores'])))
    L.append('RESULTADO: %s' % plan.get('resultado', ''))
    return '\n'.join(L)


# ---------------------------------------------------------------- confirmacion

class ErrorImportacion(Exception):
    """El lote no esta en condiciones de subirse / exportarse (mensaje claro, sin datos sensibles)."""


def _cargar_plan_guardado(carpeta):
    ruta = Path(carpeta) / 'plan_importacion.json'
    if not ruta.is_file():
        raise ErrorImportacion('No existe plan_importacion.json: primero correr el dry-run (importar.py --lote <lote> --dry-run).')
    return json.loads(ruta.read_text(encoding='utf-8'))


def verificar_plan(carpeta, huella_confirmada=None):
    """Exige un dry-run vigente: el plan guardado existe, no tiene errores y su huella coincide con el estado ACTUAL de
    los archivos (nada cambio desde entonces). Si se pide huella_confirmada, tiene que ser el comienzo (>= 12 hex) de
    la huella que mostro el dry-run. Devuelve el plan vigente."""
    guardado = _cargar_plan_guardado(carpeta)
    if guardado.get('errores'):
        raise ErrorImportacion('El dry-run guardado tiene errores: corregirlos y volver a correrlo.')
    actual = planificar(carpeta)
    if actual['errores']:
        raise ErrorImportacion('El lote actual tiene errores (%d): correr el dry-run para verlos.' % len(actual['errores']))
    if actual['huella'] != guardado.get('huella'):
        raise ErrorImportacion('El lote cambio desde el dry-run (archivos o filas distintos): volver a correr el dry-run.')
    if huella_confirmada is not None:
        h = (huella_confirmada or '').strip().lower()
        if len(h) < 12 or not actual['huella'].startswith(h):
            raise ErrorImportacion('La huella confirmada no coincide con la del dry-run (pasar --confirmar-huella con 12 o mas caracteres de "Huella del plan").')
    return actual


# ------------------------------------------------------------- estado reanudable

ESTADOS_OK = ('SUBIDA', 'YA_EXISTE')
ESTADO_ARCHIVO = 'estado_subida.jsonl'


def leer_estado(carpeta):
    """Ultimo registro de cada fotoId del archivo de progreso (append-only: gana el ultimo)."""
    ruta = Path(carpeta) / ESTADO_ARCHIVO
    ultimo = {}
    if ruta.is_file():
        for linea in ruta.read_text(encoding='utf-8').splitlines():
            linea = linea.strip()
            if not linea:
                continue
            try:
                r = json.loads(linea)
            except ValueError:
                continue                     # linea cortada por una interrupcion: se ignora
            if isinstance(r, dict) and r.get('fotoId'):
                ultimo[r['fotoId']] = r
    return ultimo


def _registrar(carpeta, registro):
    with open(str(Path(carpeta) / ESTADO_ARCHIVO), 'a', encoding='utf-8') as f:
        f.write(json.dumps(registro, ensure_ascii=False) + '\n')
        f.flush()
        try:
            import os
            os.fsync(f.fileno())
        except OSError:
            pass


ESPERAS = [2, 5, 10, 20, 30]           # segundos entre reintentos (crece y se queda en 30)
CODIGOS_TRANSITORIOS_LOTE = ('INTERNAL', 'TIEMPO_AGOTADO')
MAX_CONCURRENCIA = 8
MAX_LOTE = 10


def _ms(t0):
    return int(round((time.time() - t0) * 1000))


def _leer_y_verificar(carpeta, e):
    """Lee JPG y miniatura y comprueba que sean EXACTAMENTE los que se aprobaron en el dry-run (SHA-256). Devuelve un dict
    con los bytes, los base64 y lo que tardo cada paso, o None si algun archivo cambio."""
    import base64
    t0 = time.time()
    img = (Path(carpeta) / 'normalizado' / (e['fotoId'] + '.jpg')).read_bytes()
    thumb = (Path(carpeta) / 'thumbs' / (e['fotoId'] + '_thumb.jpg')).read_bytes()
    ms_leer = _ms(t0)
    if hashlib.sha256(img).hexdigest() != e['sha256'] or hashlib.sha256(thumb).hexdigest() != e['sha256Thumb']:
        return None
    t1 = time.time()
    b64 = base64.b64encode(img).decode('ascii')
    tb64 = base64.b64encode(thumb).decode('ascii')
    return {'b64': b64, 'tb64': tb64, 'bytes': len(img) + len(thumb), 'leer': ms_leer, 'b64ms': _ms(t1)}


def _ahora_utc():
    return datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ')


def _registro_ok(base, e, r, p, intentos, http_ms):
    """Registro de una foto que el storage acepto (SUBIDA / YA_EXISTE) o FALLIDA si la respuesta no trae ids validos."""
    if not RE_DRIVE_ID.match(str(r.get('driveFileId', ''))) or not RE_DRIVE_ID.match(str(r.get('driveThumbId', ''))):
        return dict(base, estado='FALLIDA', motivo='RESPUESTA_SIN_IDS_VALIDOS', intentos=intentos)
    # existente=True -> ya estaba en Drive; False -> la acaba de crear; ausente (storage viejo) -> se informa SUBIDA
    estado = 'YA_EXISTE' if r.get('existente') is True else 'SUBIDA'
    reg = dict(base, estado=estado, driveFileId=r['driveFileId'], driveThumbId=r['driveThumbId'],
               tamanoBytes=r.get('tamanoBytes'), enviadoBytes=p['bytes'], intentos=intentos,
               storageIndicaExistencia='existente' in r,
               ms={'leer': p['leer'], 'b64': p['b64ms'], 'http': http_ms})
    if isinstance(r.get('tiempos'), dict):
        reg['tiemposStorage'] = {k: v for k, v in r['tiempos'].items() if isinstance(v, int)}
    return reg


def _subir_una(cliente, carpeta, e, fila, reintentos, esperar):
    """Sube una foto (JPG + miniatura) con reintentos ante errores transitorios. Devuelve el registro de estado."""
    base = {'fotoId': e['fotoId'], 'ts': _ahora_utc()}
    p = _leer_y_verificar(carpeta, e)
    if p is None:
        return dict(base, estado='FALLIDA', motivo='ARCHIVO_CAMBIO_DESPUES_DEL_DRY_RUN', intentos=0)
    for intento in range(1, reintentos + 2):
        t0 = time.time()
        try:
            r = cliente.put_foto_pozo(e['fotoId'], e['fuente'], carpeta_fecha(fila), p['b64'], p['tb64'])
        except SC.ErrorTransitorio as err:
            if intento > reintentos:
                return dict(base, estado='FALLIDA', motivo='TRANSITORIO_SIN_EXITO: %s' % err, intentos=intento)
            esperar(ESPERAS[min(intento - 1, len(ESPERAS) - 1)])
            continue
        except SC.ErrorPermanente as err:
            return dict(base, estado='FALLIDA', motivo='RECHAZADA: %s' % err.codigo, intentos=intento)
        return _registro_ok(base, e, r, p, intento, _ms(t0))
    return dict(base, estado='FALLIDA', motivo='SIN_INTENTOS', intentos=reintentos + 1)


def _subir_lote(cliente, carpeta, elementos, filas, reintentos, esperar):
    """Sube VARIAS fotos en una sola solicitud (putFotosPozoLote). Un registro por foto, en el mismo orden. El resultado de
    cada foto es independiente: lo transitorio (INTERNAL / TIEMPO_AGOTADO / respuesta incompleta o error de red) se reenvia
    SOLO para esas fotos; un rechazo (INVALID_*) es definitivo. Reenviar es seguro: lo ya guardado vuelve como YA_EXISTE."""
    registros, preparados = {}, {}
    for e in elementos:
        base = {'fotoId': e['fotoId'], 'ts': _ahora_utc()}
        p = _leer_y_verificar(carpeta, e)
        if p is None:
            registros[e['fotoId']] = dict(base, estado='FALLIDA', motivo='ARCHIVO_CAMBIO_DESPUES_DEL_DRY_RUN', intentos=0)
        else:
            preparados[e['fotoId']] = (base, p, e)
    pendientes = [e['fotoId'] for e in elementos if e['fotoId'] in preparados]
    motivo = {}
    intento = 0
    while pendientes and intento <= reintentos:
        intento += 1
        items = [{'fotoId': i, 'fuente': preparados[i][2]['fuente'], 'carpetaFecha': carpeta_fecha(filas[i]), 'mimeType': 'image/jpeg',
                  'imagenBase64': preparados[i][1]['b64'], 'thumbBase64': preparados[i][1]['tb64']} for i in pendientes]
        t0 = time.time()
        try:
            r = cliente.put_fotos_pozo_lote(items)
        except SC.ErrorTransitorio as err:
            for i in pendientes:
                motivo[i] = 'TRANSITORIO_SIN_EXITO: %s' % err
            if intento <= reintentos:
                esperar(ESPERAS[min(intento - 1, len(ESPERAS) - 1)])
            continue
        except SC.ErrorPermanente as err:
            if err.codigo == 'UNKNOWN_ACTION':
                raise SC.ErrorAutenticacion('el storage desplegado no soporta lotes (falta publicar la version nueva de StorageApi.js y StorageDrive.js): usar --lote-tamano 1')
            for i in pendientes:
                registros[i] = dict(preparados[i][0], estado='FALLIDA', motivo='RECHAZADA: %s' % err.codigo, intentos=intento)
            pendientes = []
            break
        http_ms = _ms(t0)
        por_id = {x.get('fotoId'): x for x in (r.get('resultados') or []) if isinstance(x, dict)}
        siguientes = []
        for i in pendientes:
            base, p, e = preparados[i]
            x = por_id.get(i)
            if x is None:
                motivo[i] = 'TRANSITORIO_SIN_EXITO: RESPUESTA_INCOMPLETA'
                siguientes.append(i)
            elif x.get('status') == 'ok':
                registros[i] = _registro_ok(base, e, x, p, intento, http_ms)
                registros[i]['ms']['lote'] = len(items)
            elif str(x.get('code')) in CODIGOS_TRANSITORIOS_LOTE:
                motivo[i] = 'TRANSITORIO_SIN_EXITO: %s' % x.get('code')
                siguientes.append(i)
            else:
                registros[i] = dict(base, estado='FALLIDA', motivo='RECHAZADA: %s' % x.get('code'), intentos=intento)
        pendientes = siguientes
        if pendientes and intento <= reintentos:
            esperar(ESPERAS[min(intento - 1, len(ESPERAS) - 1)])
    for i in pendientes:
        registros[i] = dict(preparados[i][0], estado='FALLIDA', motivo=motivo.get(i, 'SIN_INTENTOS'), intentos=intento)
    return [registros[e['fotoId']] for e in elementos]


def ejecutar_unidades(unidades, procesar, concurrencia, al_terminar, log=print):
    """Motor de la subida (lo usan tambien el benchmark y los tests). Procesa cada unidad (lista de elementos) con
    procesar(unidad) -> [(elemento, registro)], de a una (concurrencia=1) o con hasta N a la vez. Cada resultado se entrega
    APENAS termina a al_terminar(elemento, registro), siempre desde el hilo principal (no hace falta lock en el que anota).
    Solo un ErrorAutenticacion corta la corrida: no se lanzan mas unidades, las que ya estaban en vuelo terminan y se anotan.
    Devuelve (error_de_autenticacion_o_None, cantidad_de_elementos_no_intentados)."""
    if concurrencia == 1:
        for idx, unidad in enumerate(unidades):
            try:
                pares = procesar(unidad)
            except SC.ErrorAutenticacion as err:
                log('ABORTADA: %s' % err)
                return err, sum(len(u) for u in unidades[idx:])
            for e, reg in pares:
                al_terminar(e, reg)
        return None, 0
    from concurrent.futures import ThreadPoolExecutor, wait, FIRST_COMPLETED
    siguientes = iter(unidades)
    en_vuelo = {}
    error = [None]
    no_intentadas = 0
    with ThreadPoolExecutor(max_workers=concurrencia) as pool:
        def lanzar():
            while error[0] is None and len(en_vuelo) < concurrencia * 2:      # pocas en cola: no se leen todos los archivos de golpe
                u = next(siguientes, None)
                if u is None:
                    return
                en_vuelo[pool.submit(procesar, u)] = u

        lanzar()
        while en_vuelo:
            terminadas, _ = wait(list(en_vuelo), return_when=FIRST_COMPLETED)
            for f in terminadas:
                u = en_vuelo.pop(f)
                try:
                    pares = f.result()
                except SC.ErrorAutenticacion as err:
                    if error[0] is None:
                        error[0] = err
                        log('ABORTADA: %s' % err)
                        for otra in list(en_vuelo):
                            if otra.cancel():                                 # las que todavia no arrancaron
                                no_intentadas += len(en_vuelo.pop(otra))
                    no_intentadas += len(u)
                    continue
                for e, reg in pares:                                          # las que ya estaban corriendo se anotan igual
                    al_terminar(e, reg)
            lanzar()
    if error[0] is not None:
        no_intentadas += sum(len(u) for u in siguientes)
    return error[0], no_intentadas


def subir(carpeta_lote, cliente, huella_confirmada, limite=None, reintentos=4, esperar=time.sleep, log=print,
          concurrencia=1, tamano_lote=1):
    """Sube el lote al storage. Reanudable e idempotente. Por defecto UNA foto por solicitud y de a una (lo de siempre);
    concurrencia=N sube N solicitudes a la vez y tamano_lote=K manda K fotos por solicitud. Devuelve el resumen (dict).
    Pase lo que pase se sigue anotando CADA foto en estado_subida.jsonl apenas termina."""
    if not (1 <= int(concurrencia) <= MAX_CONCURRENCIA) or not (1 <= int(tamano_lote) <= MAX_LOTE):
        raise ErrorImportacion('concurrencia entre 1 y %d y tamano de lote entre 1 y %d.' % (MAX_CONCURRENCIA, MAX_LOTE))
    carpeta = Path(carpeta_lote)
    plan = verificar_plan(carpeta, huella_confirmada)
    manifiesto = json.loads((carpeta / 'manifiesto_privado.json').read_text(encoding='utf-8'))
    filas = {f['fotoId']: f for f in json.loads((carpeta / 'filas_FotosPozos.json').read_text(encoding='utf-8'))}
    estado = leer_estado(carpeta)
    omitidas = sum(1 for r in manifiesto if not r['subir'])           # POR_REVISAR / EXCLUIDA: nunca se suben
    res = {'lote': carpeta.name, 'previstas': plan['cantidad'], 'omitidas': omitidas, 'subidas': 0, 'yaExisten': 0,
           'fallidas': 0, 'yaConfirmadasAntes': 0, 'pendientes': 0, 'bytesEnviados': 0, 'fallos': {}, 'abortada': None,
           'concurrencia': int(concurrencia), 'tamanoLote': int(tamano_lote), 'ms': collections.defaultdict(list), 'msStorage': collections.defaultdict(list)}
    pendientes_el = []
    for e in plan['elementos']:
        previo = estado.get(e['fotoId'])
        if previo and previo.get('estado') in ESTADOS_OK:
            res['yaConfirmadasAntes'] += 1                           # confirmada en una corrida anterior: NO se vuelve a subir
        else:
            pendientes_el.append(e)
    a_intentar = pendientes_el if limite is None else pendientes_el[:limite]
    res['pendientes'] = len(pendientes_el) - len(a_intentar)
    unidades = [a_intentar[i:i + int(tamano_lote)] for i in range(0, len(a_intentar), int(tamano_lote))]
    hechas = [0]

    def procesar(unidad):
        if int(tamano_lote) == 1:
            return [(unidad[0], _subir_una(cliente, carpeta, unidad[0], filas[unidad[0]['fotoId']], reintentos, esperar))]
        regs = _subir_lote(cliente, carpeta, unidad, filas, reintentos, esperar)
        return list(zip(unidad, regs))

    def anotar(e, reg):
        _registrar(carpeta, reg)
        if reg['estado'] == 'SUBIDA':
            res['subidas'] += 1
        elif reg['estado'] == 'YA_EXISTE':
            res['yaExisten'] += 1
        else:
            res['fallidas'] += 1
            res['fallos'][e['fotoId']] = reg.get('motivo')
        res['bytesEnviados'] += reg.get('enviadoBytes') or 0
        for k, v in (reg.get('ms') or {}).items():
            if k != 'lote':
                res['ms'][k].append(v)
        for k, v in (reg.get('tiemposStorage') or {}).items():
            res['msStorage'][k].append(v)
        hechas[0] += 1
        if hechas[0] % 10 == 0 or reg['estado'] == 'FALLIDA':
            log('  %d/%d  %s  %s' % (hechas[0], len(a_intentar), e['fotoId'], reg['estado']))

    t0 = time.time()
    err, no_intentadas = ejecutar_unidades(unidades, procesar, int(concurrencia), anotar, log)
    if err is not None:
        res['abortada'] = str(err)
        res['pendientes'] += no_intentadas
    res['segundos'] = round(time.time() - t0, 3)
    res['ms'], res['msStorage'] = dict(res['ms']), dict(res['msStorage'])
    texto = informe_subida(res)
    (carpeta / 'reporte_subida.txt').write_text(texto, encoding='utf-8')
    log(texto)
    return res


def _media(lista):
    return sum(lista) / float(len(lista)) if lista else 0.0


def informe_subida(res):
    L = ['=== Subida del lote "%s" ===' % res['lote'],
         'Previstas (CONFIRMADO): %d' % res['previstas'],
         'SUBIDA (nuevas en Drive): %d' % res['subidas'],
         'YA_EXISTE (ya estaban en Drive): %d' % res['yaExisten'],
         'Ya confirmadas en corridas anteriores (no se reenviaron): %d' % res['yaConfirmadasAntes'],
         'FALLIDA: %d' % res['fallidas'],
         'OMITIDA (POR_REVISAR / EXCLUIDA del manifiesto, nunca se suben): %d' % res['omitidas'],
         'Pendientes (sin intentar: --limite o corrida abortada): %d' % res['pendientes'],
         'Enviado en esta corrida: %s en %.1f s' % (_mb(res['bytesEnviados']), res.get('segundos', 0))]
    hechas = res['subidas'] + res['yaExisten'] + res['fallidas']
    seg = res.get('segundos') or 0
    if hechas and seg:
        L.append('Ritmo: %.1f s por foto, %.1f fotos por minuto (concurrencia %d, %d foto(s) por solicitud)' % (
            seg / float(hechas), hechas * 60.0 / seg, res.get('concurrencia', 1), res.get('tamanoLote', 1)))
    if res.get('ms'):
        L.append('Tiempo medio por foto en el cliente: leer %.0f ms | base64 %.0f ms | solicitud HTTP %.0f ms' % (
            _media(res['ms'].get('leer')), _media(res['ms'].get('b64')), _media(res['ms'].get('http'))))
    if res.get('msStorage'):
        L.append('Tiempo medio por foto DENTRO del storage (ms): ' + ' | '.join('%s %.0f' % (k, _media(v)) for k, v in sorted(res['msStorage'].items())))
    if res['abortada']:
        L.append('CORRIDA ABORTADA: %s' % res['abortada'])
    if res['fallos']:
        L.append('Fallidas (se reintentan al volver a correr el mismo comando):')
        L.extend('  %s  %s' % (k, v) for k, v in sorted(res['fallos'].items()))
    return '\n'.join(L)


# --------------------------------------------------------------------- staging

STAGING_ARCHIVO = 'staging_FotosPozosImport.csv'


def exportar_filas(carpeta_lote, log=print):
    """CSV para la hoja de staging con las filas de las fotos cuya subida esta CONFIRMADA (SUBIDA o YA_EXISTE) y el
    lote sin cambios desde el dry-run. Valida el esquema (con ids de Drive) ANTES de escribir. Devuelve el resumen."""
    carpeta = Path(carpeta_lote)
    plan = verificar_plan(carpeta)
    estado = leer_estado(carpeta)
    filas = {f['fotoId']: f for f in json.loads((carpeta / 'filas_FotosPozos.json').read_text(encoding='utf-8'))}
    salida, errores, sin_confirmar = [], [], 0
    for e in plan['elementos']:
        reg = estado.get(e['fotoId'])
        if not reg or reg.get('estado') not in ESTADOS_OK:
            sin_confirmar += 1
            continue
        fila = dict(filas[e['fotoId']])
        fila['driveFileId'] = reg['driveFileId']
        fila['driveThumbId'] = reg['driveThumbId']
        if reg.get('tamanoBytes') is not None and int(reg['tamanoBytes']) != int(fila['tamanoBytes']):
            errores.append('%s: el peso en Drive (%s) no coincide con el de la fila (%s)' % (e['fotoId'], reg['tamanoBytes'], fila['tamanoBytes']))
        _validar_fila(fila, errores, con_ids=True)
        salida.append(fila)
    ids_drive = collections.Counter(x for f in salida for x in (f['driveFileId'], f['driveThumbId']))
    errores.extend('id de Drive repetido en el staging' for i, n in ids_drive.items() if n > 1)
    if errores:
        raise ErrorImportacion('No se exporta: el esquema no valida (%d): %s' % (len(errores), '; '.join(errores[:5])))
    ruta = carpeta / STAGING_ARCHIVO
    with open(str(ruta), 'w', encoding='utf-8', newline='') as f:
        w = csv.writer(f, delimiter=',', quoting=csv.QUOTE_MINIMAL, lineterminator='\r\n')
        w.writerow(C.FOTOSPOZOS_COLUMNAS)
        for fila in salida:
            w.writerow([fila[c] for c in C.FOTOSPOZOS_COLUMNAS])
    res = {'lote': carpeta.name, 'exportadas': len(salida), 'sinSubidaConfirmada': sin_confirmar, 'archivo': STAGING_ARCHIVO}
    log('CSV de staging: %d filas exportadas (%d sin subida confirmada, no incluidas) -> %s/%s' % (
        len(salida), sin_confirmar, carpeta.name, STAGING_ARCHIVO))
    return res


def main_dry_run(argv):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--lote', required=True, help='subcarpeta de scripts/out/fotos/ con el lote normalizado (p. ej. piloto30)')
    ap.add_argument('--dry-run', action='store_true', help='OBLIGATORIO: genera el plan y no sube nada')
    ap.add_argument('--sin-detalle', action='store_true', help='no lista una por una las filas que se crearian')
    ap.add_argument('--lote-nuevo', action='store_true', help='el lote no debe tener progreso previo: cualquier estado_subida.jsonl existente lo bloquea')
    ap.add_argument('--existentes', default=None, help='CSV exportado de la hoja FotosPozos: verifica que ninguna foto del lote ya exista (solo lectura)')
    ap.add_argument('--salida', default=str(C.OUT_FOTOS))
    args = ap.parse_args(argv)
    if not args.dry_run:
        print('Falta --dry-run (el plan en seco es obligatorio antes de subir). Para subir: importar.py subir --lote <lote> --confirmar-huella <huella>.', file=sys.stderr)
        return 2
    carpeta = Path(args.salida) / args.lote
    existentes = None
    if args.existentes:
        try:
            existentes = cargar_existentes(args.existentes)
        except (ErrorImportacionEntrada, OSError) as err:
            print('No se pudo leer el CSV de la hoja: %s' % err, file=sys.stderr)
            return 2
    plan = planificar(carpeta, existentes, lote_nuevo=args.lote_nuevo)
    texto = informe(plan, detalle=not args.sin_detalle)
    (carpeta / 'plan_importacion.json').write_text(json.dumps(plan, ensure_ascii=False, indent=1), encoding='utf-8')
    (carpeta / 'reporte_dryrun.txt').write_text(informe(plan, detalle=True), encoding='utf-8')
    print(texto)
    return 1 if plan['errores'] else 0


def main(argv=None, cliente=None, esperar=time.sleep):
    """Subcomandos: subir, exportar-filas. Sin subcomando: el dry-run (compatible con la forma anterior)."""
    argv = list(sys.argv[1:] if argv is None else argv)
    if argv and argv[0] == 'subir':
        ap = argparse.ArgumentParser(prog='importar.py subir')
        ap.add_argument('--lote', required=True)
        ap.add_argument('--confirmar-huella', required=True, help='huella (12+ hex) que mostro el dry-run')
        ap.add_argument('--limite', type=int, default=None, help='subir como mucho N fotos en esta corrida')
        ap.add_argument('--reintentos', type=int, default=4)
        ap.add_argument('--concurrencia', type=int, default=1, help='solicitudes simultaneas al storage (1 a %d; por defecto 1 = de a una)' % MAX_CONCURRENCIA)
        ap.add_argument('--lote-tamano', type=int, default=1, help='fotos por solicitud (1 a %d; por defecto 1 = una por solicitud)' % MAX_LOTE)
        ap.add_argument('--salida', default=str(C.OUT_FOTOS))
        a = ap.parse_args(argv[1:])
        try:
            carpeta = Path(a.salida) / a.lote
            verificar_plan(carpeta, a.confirmar_huella)             # antes de tocar variables de entorno o red
            cli = cliente or SC.ClienteStorage.desde_entorno()
            res = subir(carpeta, cli, a.confirmar_huella, a.limite, a.reintentos, esperar, concurrencia=a.concurrencia, tamano_lote=a.lote_tamano)
        except (ErrorImportacion, SC.ErrorConfiguracion) as err:
            print('No se sube: %s' % err, file=sys.stderr)
            return 2
        return 1 if (res['fallidas'] or res['abortada']) else 0
    if argv and argv[0] == 'exportar-filas':
        ap = argparse.ArgumentParser(prog='importar.py exportar-filas')
        ap.add_argument('--lote', required=True)
        ap.add_argument('--salida', default=str(C.OUT_FOTOS))
        a = ap.parse_args(argv[1:])
        try:
            exportar_filas(Path(a.salida) / a.lote)
        except ErrorImportacion as err:
            print('No se exporta: %s' % err, file=sys.stderr)
            return 2
        return 0
    return main_dry_run(argv)


if __name__ == '__main__':
    sys.exit(main())
