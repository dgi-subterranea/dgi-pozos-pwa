# -*- coding: utf-8 -*-
"""Piezas comunes del pipeline de normalizacion de fotos de pozos (FotosPozos).

Todo lo "puro" (sin leer imagenes ni disco) vive aca para poder testearlo:
parseo de nombres, fechas con precision parcial, vinculo a pozo, esquema de la
hoja y limpieza de JPEG. Los scripts hermanos hacen la E/S.

PRIVACIDAD: los nombres originales de archivo pueden traer titulares o lugares.
Nada de eso sale de los manifiestos PRIVADOS locales (scripts/out/fotos/, ignorado
por git): ni a Drive, ni a Sheets, ni al frontend, ni a logs.
"""
import datetime as dt
import json
import math
import os
import re
import uuid
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
FOTOS_DEFAULT = REPO / 'Fotos'
OUT_DATOS = REPO / 'scripts' / 'out'          # padron / mapa / red NE (generados por los reindex_*.py)
OUT_FOTOS = OUT_DATOS / 'fotos'               # salidas de este pipeline (ignorado por git)

# Namespace propio: fotoId = uuid5(NS, sha1). Mismo contenido -> mismo fotoId (importacion idempotente).
NS_FOTO = uuid.UUID('6f1c1d8e-7b0a-4c36-9e5a-0d6b1e1f0a11')

# --- Reglas aprobadas ---
GPS_CONSISTENTE_M = 200      # <= : confirmado y GPS consistente
GPS_REVISION_M = 500         # >  : POR_REVISAR (entre ambos: confirmado con advertencia)
EXIF_ANIO_MIN = 2005
# Anios en que es plausible una fecha de archivo (mtime) para cada fuente
MTIME_ANIOS_PLAUSIBLES = {'RELEVAMIENTO_2018': (2018, 2019), 'MONITOREO_NE': (2023, 2026)}

ESTADO_CONFIRMADO = 'CONFIRMADO'
ESTADO_POR_REVISAR = 'POR_REVISAR'
ESTADO_EXCLUIDA = 'EXCLUIDA_IMPORTACION'
MOTIVO_SIN_CONTENIDO = 'SIN_CONTENIDO_FOTOGRAFICO'

RE_ID = re.compile(r'^\s*(\d{1,2})\s*[ _-]\s*(\d{1,4})(?!\d)')
MESES = {'enero': 1, 'febrero': 2, 'marzo': 3, 'abril': 4, 'mayo': 5, 'junio': 6, 'julio': 7, 'agosto': 8,
         'septiembre': 9, 'setiembre': 9, 'octubre': 10, 'noviembre': 11, 'diciembre': 12}

FOTOSPOZOS_COLUMNAS = [
    'fotoId', 'timestampRegistro', 'wellId', 'monitoringId', 'fuente', 'tipoFoto',
    'fechaFotoValor', 'fechaFotoPrecision', 'fechaFotoFuente', 'observacion',
    'estadoVinculo', 'vinculoMetodo', 'gpsLat', 'gpsLon', 'gpsOrigen',
    'emailUsuarioCarga', 'loteImportacion', 'sha1Original', 'procesamiento',
    'mimeType', 'tamanoBytes', 'ancho', 'alto', 'tamanoOriginalBytes',
    'driveFileId', 'driveThumbId', 'estado',
]

REVISION_COLUMNAS = [
    'fotoId', 'fuente', 'tipoFoto', 'fechaFotoValor', 'fechaFotoPrecision', 'fechaFotoFuente',
    'wellIdPropuesto', 'monitoringIdPropuesto', 'fuenteValidacionId', 'motivoRevision',
    'distanciaGpsMetros', 'sugerencia', 'decision', 'wellIdCorregido', 'monitoringIdCorregido',
    'observacionRevision',
]


def foto_id(sha1):
    return str(uuid.uuid5(NS_FOTO, sha1))


def haversine(lat1, lon1, lat2, lon2):
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


# ---------------------------------------------------------------- referencias

class Referencias(object):
    """Padron, red NE y coordenadas conocidas. Se arma desde scripts/out/ o a mano (tests)."""

    def __init__(self, padron=(), ne_wellids=(), coords_mapa=None, coords_ne=None, ne_por_ina=None, ne_ids=()):
        self.padron = set(padron)
        self.ne_wellids = set(ne_wellids)
        self.coords_mapa = dict(coords_mapa or {})      # wellId -> (lat, lon)
        self.coords_ne = dict(coords_ne or {})          # wellId o monitoringId -> (lat, lon)
        self.ne_por_ina = dict(ne_por_ina or {})        # idIna -> [monitoringId]
        self.ne_ids = set(ne_ids)                       # monitoringId de toda la red
        self.deptos = {w.split('-')[0] for w in (self.padron | self.ne_wellids) if '-' in w}

    def fuente_validacion(self, well_id):
        """'PADRON' | 'RED_NE' | 'AMBAS' | None: contra que fuente se valida el id (union logica)."""
        en_p, en_n = well_id in self.padron, well_id in self.ne_wellids
        if en_p and en_n:
            return 'AMBAS'
        if en_p:
            return 'PADRON'
        if en_n:
            return 'RED_NE'
        return None

    def coords_de(self, well_id):
        res = []
        if well_id in self.coords_mapa:
            res.append(self.coords_mapa[well_id])
        if well_id in self.coords_ne:
            res.append(self.coords_ne[well_id])
        return res


def cargar_referencias(out_datos=None):
    out = Path(out_datos) if out_datos else OUT_DATOS
    padron = set()
    for f in sorted((out / 'registro').glob('*.json')):
        if f.name == 'metadata.json':
            continue
        d = json.loads(f.read_text(encoding='utf-8'))
        for r in (d if isinstance(d, list) else d.values()):
            if isinstance(r, dict) and r.get('wellId'):
                padron.add(r['wellId'])
    mapa = {p['wellId']: (p['lat'], p['lon']) for p in json.loads((out / 'mapa' / 'pozos.json').read_text(encoding='utf-8'))}
    ne = json.loads((out / 'niveles_estaticos' / 'nivelesEstaticos.json').read_text(encoding='utf-8'))['puntos']
    ne_wellids, ne_ids, coords_ne, ne_por_ina = set(), set(), {}, {}
    for mid, p in ne.items():
        mon = str(p.get('monitoringId', mid))
        ne_ids.add(mon)
        if p.get('wellId'):
            ne_wellids.add(p['wellId'])
        c = p.get('coordenadas')
        if c and c.get('lat') is not None:
            coords_ne[p.get('wellId') or mon] = (c['lat'], c['lon'])
        if p.get('idIna') not in (None, ''):
            ne_por_ina.setdefault(str(p['idIna']).strip(), []).append(mon)
    return Referencias(padron, ne_wellids, mapa, coords_ne, ne_por_ina, ne_ids)


# ------------------------------------------------------------------- nombres

def fuente_de(ruta):
    if ruta.startswith('Monitoreo/'):
        return 'MONITOREO_NE'
    if ruta.startswith('Relevamiento 2018/'):
        return 'RELEVAMIENTO_2018'
    return 'OTRA_FUENTE'


def id_de_nombre(base, deptos):
    """'DD NNNN...' -> 'DD-PPPP' solo si DD es un departamento real. Nunca interpreta el resto del nombre."""
    m = RE_ID.match(base)
    if not m:
        return None
    dd = m.group(1).zfill(2)
    if dd not in deptos:
        return None
    return dd + '-' + m.group(2).zfill(4)


def tipo_foto(base, fuente):
    """Monitoreo: CERCA / PANORAMICA cuando el nombre lo dice; Relevamiento y el resto: OTRA."""
    if fuente != 'MONITOREO_NE':
        return 'OTRA'
    m = re.search(r'_(Cerca|Pano)_', base, re.I)
    if not m:
        return 'OTRA'
    return 'CERCA' if m.group(1).lower() == 'cerca' else 'PANORAMICA'


def indicio_monitoreo(base, refs):
    """Nombres de Monitoreo sin 'DD NNNN' (INA nnn / Monnnn / numero suelto). Nunca confirma: solo
    devuelve una SUGERENCIA de punto NE para la revision humana."""
    m = re.match(r'^INA\s*(\d+)_', base, re.I)
    if m:
        return {'tipo': 'INA', 'valor': m.group(1), 'sugerencias': sorted(refs.ne_por_ina.get(m.group(1), []))}
    m = re.match(r'^(?:Mon)?0*(\d{1,3})_(?:Cerca|Pano)_', base, re.I)
    if m:
        v = m.group(1)
        return {'tipo': 'MON_NUM', 'valor': v, 'sugerencias': [v] if v in refs.ne_ids else []}
    return None


# --------------------------------------------------------------------- fechas

def exif_valida(txt):
    """Fecha EXIF utilizable o None (formato roto, anio < 2005 como el 1980-01-01 de relojes sin configurar, futura)."""
    if not txt or not re.match(r'^\d{4}:\d{2}:\d{2} \d{2}:\d{2}:\d{2}', txt):
        return None
    try:
        d = dt.datetime.strptime(txt[:19], '%Y:%m:%d %H:%M:%S')
    except ValueError:
        return None
    if d.year < EXIF_ANIO_MIN or d > dt.datetime.now() + dt.timedelta(days=1):
        return None
    return d


def _fecha_ok(y, mo, d):
    try:
        dt.date(y, mo, d)
    except ValueError:
        return False
    return 2005 <= y <= 2030


def fecha_de_carpeta(ruta):
    """(valor ISO parcial, precision) segun las carpetas de la ruta, de la mas profunda a la raiz.
    Convencion local dd_mm_aaaa (verificada contra EXIF: no mm_dd)."""
    for nombre in reversed(ruta.split('/')[:-1]):
        n = nombre.strip()
        m = re.match(r'^(\d{4})[_-](\d{1,2})[_-](\d{1,2})$', n)
        if m and _fecha_ok(int(m.group(1)), int(m.group(2)), int(m.group(3))):
            return '%04d-%02d-%02d' % (int(m.group(1)), int(m.group(2)), int(m.group(3))), 'DIA'
        m = re.match(r'^(\d{1,2})[_-](\d{1,2})[_-](\d{4})$', n)
        if m and _fecha_ok(int(m.group(3)), int(m.group(2)), int(m.group(1))):
            return '%04d-%02d-%02d' % (int(m.group(3)), int(m.group(2)), int(m.group(1))), 'DIA'
        m = re.match(r'^(\d{1,2}) al (\d{1,2})[_-](\d{1,2})[_-](\d{4})$', n)   # rango de dias de un mes
        if m and 1 <= int(m.group(3)) <= 12 and 2005 <= int(m.group(4)) <= 2030:
            return '%04d-%02d' % (int(m.group(4)), int(m.group(3))), 'MES'
        m = re.match(r'^(\d{1,2}) ([a-z]+)[_-](\d{4})$', n, re.I)
        if m and m.group(2).lower() in MESES and _fecha_ok(int(m.group(3)), MESES[m.group(2).lower()], int(m.group(1))):
            return '%04d-%02d-%02d' % (int(m.group(3)), MESES[m.group(2).lower()], int(m.group(1))), 'DIA'
        m = re.match(r'^(\d{1,2})[_-](\d{4})$', n)
        if m and 1 <= int(m.group(1)) <= 12 and 2005 <= int(m.group(2)) <= 2030:
            return '%04d-%02d' % (int(m.group(2)), int(m.group(1))), 'MES'
        m = re.match(r'^(\d{4})[_-](\d{1,2})$', n)
        if m and 1 <= int(m.group(2)) <= 12 and 2005 <= int(m.group(1)) <= 2030:
            return '%04d-%02d' % (int(m.group(1)), int(m.group(2))), 'MES'
    return None, None


def anio_de_nombre(base):
    m = re.search(r'_(\d{4})(?:\D|$)', base)
    if m and 2005 <= int(m.group(1)) <= 2030:
        return m.group(1)
    return None


def mtime_confiable_por_fuente(mtimes_por_fuente):
    """Una fuente tiene mtimes utilizables solo si NO son todos la misma fecha de copia: se exigen al menos 2
    anios distintos (Monitoreo trae todo 2026 aunque las fotos sean de 2023-2026)."""
    res = {}
    for fuente, lista in mtimes_por_fuente.items():
        anios = {dt.datetime.fromtimestamp(m / 1000.0).year for m in lista if m}
        res[fuente] = len([a for a in anios if a >= 2005]) >= 2
    return res


def resolver_fecha(exif_original, rutas, mtimes_ms, fuente, mtime_confiable):
    """Precedencia aprobada: EXIF valido -> CARPETA -> NOMBRE_ANIO -> ARCHIVO plausible -> DESCONOCIDA.
    Devuelve {valor, precision (DIA|MES|ANIO|DESCONOCIDA), fuente, flags}. El anio solo NO se vuelve 01/01.
    ARCHIVO se usa solo como ultimo recurso y siempre deja fechaFotoFuente=ARCHIVO (no manda a revision)."""
    flags = []
    e = exif_valida(exif_original)
    carpetas = [c for c in (fecha_de_carpeta(r) for r in rutas) if c[0]]
    if exif_original and not e:
        flags.append('EXIF_INVALIDO')
    if e:
        valor = e.strftime('%Y-%m-%d')
        for v, p in carpetas:
            if p == 'DIA' and abs((dt.date.fromisoformat(valor) - dt.date.fromisoformat(v)).days) > 1:
                flags.append('EXIF_DIVERGE_CARPETA')
                break
            if p == 'MES' and v != valor[:7]:
                flags.append('EXIF_DIVERGE_CARPETA')
                break
        return {'valor': valor, 'precision': 'DIA', 'fuente': 'EXIF', 'flags': flags}
    if carpetas:
        mejor = sorted(carpetas, key=lambda x: 0 if x[1] == 'DIA' else 1)[0]
        if len({c for c in carpetas if c[1] == mejor[1]}) > 1:
            flags.append('FECHA_CARPETA_CONFLICTO')
        return {'valor': mejor[0], 'precision': mejor[1], 'fuente': 'CARPETA', 'flags': flags}
    for r in rutas:
        a = anio_de_nombre(r.split('/')[-1])
        if a:
            return {'valor': a, 'precision': 'ANIO', 'fuente': 'NOMBRE_ANIO', 'flags': flags}
    rango = MTIME_ANIOS_PLAUSIBLES.get(fuente)
    if mtime_confiable and rango:
        validos = [dt.datetime.fromtimestamp(m / 1000.0) for m in mtimes_ms]
        validos = [d for d in validos if rango[0] <= d.year <= rango[1]]
        if validos:
            return {'valor': min(validos).strftime('%Y-%m-%d'), 'precision': 'DIA', 'fuente': 'ARCHIVO',
                    'flags': flags + ['FECHA_DE_ARCHIVO']}
    return {'valor': None, 'precision': 'DESCONOCIDA', 'fuente': None, 'flags': flags}


def formatear_fecha(valor, precision):
    """Lo que ve el usuario: '2025', '03/2018' o '14/06/2025'; vacio si se desconoce."""
    if not valor or precision == 'DESCONOCIDA':
        return ''
    if precision == 'ANIO':
        return valor
    if precision == 'MES':
        y, m = valor.split('-')
        return '%s/%s' % (m, y)
    y, m, d = valor.split('-')
    return '%s/%s/%s' % (d, m, y)


# --------------------------------------------------------------------- vinculo

def evaluar_vinculo(fuente, bases, refs, gps=None, contenido_sin_foto=False, ilegible=False, fuentes_mezcladas=False):
    """Estado de importacion de un contenido unico, a partir de los nombres de sus copias (bases) y evidencia.

    Auto-confirma solo si: un unico patron 'DD NNNN' inequivoco entre las copias, el id valida contra
    padron U red NE, y no hay conflicto. GPS opcional: <=200 m consistente; 200-500 m confirmado con
    advertencia; >500 m POR_REVISAR. Una imagen sin contenido fotografico se EXCLUYE (no se importa, no se borra).
    Devuelve dict con estado, motivos, advertencias, wellId, fuenteValidacionId, gpsEstado, gpsDistM, indicio."""
    ids = sorted({i for i in (id_de_nombre(b, refs.deptos) for b in bases) if i})
    motivos, advertencias = [], []
    indicio = None
    if fuente == 'MONITOREO_NE' and not ids:
        indicio = indicio_monitoreo(bases[0], refs)
    if fuentes_mezcladas:
        motivos.append('FUENTES_MEZCLADAS')
    if ilegible:
        motivos.append('IMAGEN_ILEGIBLE')
    if not ids:
        motivos.append('ID_AMBIGUO_INA_MON' if indicio else 'SIN_ID')
    elif len(ids) > 1:
        motivos.append('ID_CONFLICTO')
    wid = ids[0] if len(ids) == 1 else None
    fuente_val = refs.fuente_validacion(wid) if wid else None
    if wid and not fuente_val:
        motivos.append('ID_FUERA_PADRON')       # no figura ni en el padron ni en la red NE

    gps_estado, gps_dist = 'SIN_GPS', None
    if gps is not None:
        if wid:
            cands = refs.coords_de(wid)
            if cands:
                gps_dist = round(min(haversine(gps[0], gps[1], c[0], c[1]) for c in cands))
                if gps_dist <= GPS_CONSISTENTE_M:
                    gps_estado = 'GPS_CONSISTENTE'
                elif gps_dist <= GPS_REVISION_M:
                    gps_estado = 'GPS_CERCANO'
                    advertencias.append('GPS_200_500M')
                else:
                    gps_estado = 'GPS_LEJOS'
                    motivos.append('GPS_LEJOS')
            else:
                gps_estado = 'GPS_SIN_REFERENCIA'
        else:
            gps_estado = 'GPS_SIN_POZO'

    if contenido_sin_foto:
        estado = ESTADO_EXCLUIDA
        motivos = [MOTIVO_SIN_CONTENIDO]       # el motivo de exclusion es el unico que importa
    elif motivos:
        estado = ESTADO_POR_REVISAR
    else:
        estado = ESTADO_CONFIRMADO
    if estado == ESTADO_CONFIRMADO:
        confianza = 'ALTA' if gps_estado == 'GPS_CONSISTENTE' else 'MEDIA'
    else:
        confianza = 'BAJA'
    return {
        'estado': estado, 'motivos': motivos, 'advertencias': advertencias, 'confianza': confianza,
        'idsPorNombre': ids, 'wellId': wid, 'fuenteValidacionId': fuente_val,
        'gpsEstado': gps_estado, 'gpsDistM': gps_dist, 'indicioMonitoreo': indicio,
    }


def sin_contenido_fotografico(c):
    """Imagen negra, plana o casi toda blanca (marcador dibujado, cuadro negro...). c = {blanco, negro, std}."""
    return c is not None and (c['blanco'] > 0.92 or c['negro'] > 0.92 or c['std'] < 10)


# ------------------------------------------------------------ filas / revision

def metodo_vinculo(rec):
    return 'NOMBRE_ARCHIVO_GPS' if rec['gpsEstado'] == 'GPS_CONSISTENTE' else 'NOMBRE_ARCHIVO'


def fila_fotospozos(rec, normalizacion, lote):
    """Fila candidata de la hoja FotosPozos para una foto CONFIRMADA ya normalizada. SIN nombres/rutas originales."""
    f = rec['fecha']
    gps = rec.get('gps')
    return dict(zip(FOTOSPOZOS_COLUMNAS, [
        foto_id(rec['sha1']), '', rec['wellId'], '', rec['fuente'], rec['tipoFoto'],
        f['valor'] or '', f['precision'], f['fuente'] or '', '',
        ESTADO_CONFIRMADO, metodo_vinculo(rec),
        gps[0] if gps else '', gps[1] if gps else '', 'EXIF_ORIGINAL' if gps else '',
        'IMPORTACION', lote, rec['sha1'], normalizacion['procesamiento'],
        'image/jpeg', normalizacion['pesoFinal'], normalizacion['anchoFinal'], normalizacion['altoFinal'],
        normalizacion['pesoOriginal'], '', '', 'ACTIVA',
    ]))


def sugerencia_revision(rec):
    """Texto de ayuda para quien revisa. Usa SOLO codigos, ids de pozo y distancias: jamas nombres de archivo."""
    partes = []
    ids = rec['idsPorNombre']
    for m in rec['motivos']:
        if m == 'SIN_ID':
            partes.append('Sin numero de pozo reconocible: identificar la foto mirandola (ver manifiesto privado local)')
        elif m == 'ID_AMBIGUO_INA_MON':
            ind = rec.get('indicioMonitoreo') or {}
            sug = ind.get('sugerencias') or []
            if len(sug) == 1:
                partes.append('Indicio %s %s: punto NE sugerido %s' % (ind.get('tipo'), ind.get('valor'), sug[0]))
            elif sug:
                partes.append('Indicio %s %s: varios puntos NE posibles (%s)' % (ind.get('tipo'), ind.get('valor'), ', '.join(sug)))
            else:
                partes.append('Indicio %s %s sin punto NE que coincida' % (ind.get('tipo'), ind.get('valor')))
        elif m == 'ID_CONFLICTO':
            partes.append('Las copias de esta foto traen numeros de pozo distintos: ' + ', '.join(ids))
        elif m == 'ID_FUERA_PADRON':
            partes.append('El numero %s no figura en el padron ni en la red NE' % (ids[0] if ids else ''))
        elif m == 'GPS_LEJOS':
            partes.append('El GPS de la foto esta a %s m del pozo propuesto %s' % (rec.get('gpsDistM'), rec.get('wellId')))
        elif m == 'IMAGEN_ILEGIBLE':
            partes.append('No se pudo abrir la imagen')
        elif m == 'FUENTES_MEZCLADAS':
            partes.append('El mismo contenido esta en fuentes distintas')
    return '; '.join(partes)


def fila_revision(rec):
    """Fila del CSV de revision manual (POR_REVISAR). Sin titulares ni nombres/rutas de archivo."""
    ind = rec.get('indicioMonitoreo') or {}
    sug = ind.get('sugerencias') or []
    f = rec['fecha']
    return dict(zip(REVISION_COLUMNAS, [
        foto_id(rec['sha1']), rec['fuente'], rec['tipoFoto'],
        f['valor'] or '', f['precision'], f['fuente'] or '',
        rec['wellId'] or '', sug[0] if len(sug) == 1 else '', rec['fuenteValidacionId'] or '',
        ' | '.join(rec['motivos']), rec['gpsDistM'] if rec['gpsDistM'] is not None else '',
        sugerencia_revision(rec), '', '', '', '',
    ]))


# ------------------------------------------------------------------- JPEG

def jpeg_sin_metadatos(datos):
    """Copia los segmentos del JPEG salvo APP1 (EXIF/XMP), APP13 (IPTC) y COM, sin tocar los datos de imagen."""
    if datos[:2] != b'\xff\xd8':
        raise ValueError('no es JPEG')
    out = bytearray(b'\xff\xd8')
    i, n = 2, len(datos)
    while i + 4 <= n:
        if datos[i] != 0xFF:
            break
        marker = datos[i + 1]
        if marker == 0xDA:      # SOS: el resto es la imagen
            out += datos[i:]
            return bytes(out)
        ln = int.from_bytes(datos[i + 2:i + 4], 'big')
        if marker not in (0xE1, 0xED, 0xFE):
            out += datos[i:i + 2 + ln]
        i += 2 + ln
    out += datos[i:]
    return bytes(out)


def metadatos_presentes(datos):
    """Marcadores de metadatos que quedan en un JPEG: 'E1' (EXIF/XMP), 'ED' (IPTC), 'FE' (comentario)."""
    res, i, n = [], 2, len(datos)
    while i + 4 <= n and datos[i] == 0xFF:
        marker = datos[i + 1]
        if marker == 0xDA:
            break
        ln = int.from_bytes(datos[i + 2:i + 4], 'big')
        if marker in (0xE1, 0xED, 0xFE):
            res.append('%02X' % marker)
        i += 2 + ln
    return res


EXTENSIONES_FOTO = ('.jpg', '.jpeg', '.png')


def es_foto_por_extension(ruta):
    """Solo .jpg/.jpeg/.png son fotos candidatas. Quedan afuera, aunque su contenido sea una imagen, las miniaturas
    de video (.thm), los .info y demas archivos auxiliares de las camaras. (El FORMATO real se decide por contenido:
    hay .jpeg que son PNG.)"""
    return ruta.lower().endswith(EXTENSIONES_FOTO)


def formato_por_contenido(cabecera):
    """JPEG / PNG / OTRO por los primeros bytes (hay .jpeg que en realidad son PNG)."""
    if cabecera[:2] == bytes([0xFF, 0xD8]):
        return 'JPEG'
    if cabecera[:4] == bytes([0x89, 0x50, 0x4E, 0x47]):
        return 'PNG'
    return 'OTRO'


def asegurar_directorio(ruta):
    os.makedirs(str(ruta), exist_ok=True)
    return Path(ruta)
