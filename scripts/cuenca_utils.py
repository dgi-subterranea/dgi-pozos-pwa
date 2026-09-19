# -*- coding: utf-8 -*-
"""Clasificacion de pozos por cuenca hidrografica - point-in-polygon
OFFLINE contra Cuencas/WGS84/vm_cuencas_provincia.shp (Etapa 1C). Nunca
corre en runtime (ni en el backend ni en el navegador): vive
exclusivamente en scripts/reindex_mapa.py, que la corre UNA sola vez por
regeneracion y guarda el resultado ('cuenca') directamente en
pozos.json - el backend/frontend solo LEEN ese campo ya calculado, nunca
recalculan nada geoespacial.

Requiere geopandas + shapely + pyproj (mismo entorno que pyproj en
coord_utils.py - ver ese modulo sobre que interprete usar si falla con
ModuleNotFoundError).

Encoding: el .dbf trae "Rio" sin tilde y con bytes latin-1/ISO-8859-1
para "Tunuyan"/"Malargue" (confirmado byte a byte: 0xe1='a', 0xfc='u',
coincide con el .cst del shapefile que declara ISO-8859-1). geopandas
(via pyogrio) ignora el parametro encoding y siempre asume UTF-8 para el
.dbf, lo que rompe esos 2 nombres - por eso los nombres NUNCA se leen del
shapefile en runtime de este script: se usa un mapeo fijo id->nombre
canonico (CUENCA_NOMBRE_POR_ID), verificado una sola vez contra el
shapefile real y nunca mas inferido dinamicamente.

Sin la capa (Cuencas/ fuera del repo a proposito, ver decision Etapa 1C):
cuenca_utils_verificar_shapefile falla con un mensaje explicito listando
los archivos faltantes - nunca hay un fallback (ni por departamento, ni
por cercania, ni cuenca:null silencioso para todo el dataset). El
shapefile FUENTE nunca se modifica: cualquier geometria invalida se
repara SOLO en la copia en memoria (ver make_valid en
cuenca_utils_cargar_poligonos), nunca se reescribe el .shp en disco.
"""
import os

from shapely.geometry import Point
from shapely.prepared import prep
from shapely.validation import make_valid
from pyproj import Transformer

# Nombres canonicos EXACTOS pedidos - un dict fijo de 6 entradas, uno por
# id real del shapefile (1..6), nunca una transformacion generica sobre
# el nombre crudo.
CUENCA_NOMBRE_POR_ID = {
    1: 'Río Mendoza',
    2: 'Río Tunuyán Inferior',
    3: 'Río Atuel',
    4: 'Río Diamante',
    5: 'Río Tunuyán Superior',
    6: 'Río Malargüe',
}

# Orden de prioridad fijo para desambiguar el caso borde de un punto que
# cae en el area de solape de 2 poligonos vecinos (existen solapes de
# borde de punto flotante entre poligonos adyacentes, del orden de
# 1e-7..1e-10 grados^2 - fracciones de metro cuadrado, artefacto de
# precision de vertices, NO 2 cuencas reclamando el mismo territorio).
# Nunca silencioso: cualquier punto real que caiga en un area asi queda
# registrado en 'ambiguos' del resultado.
ORDEN_PRIORIDAD_IDS = [1, 2, 3, 4, 5, 6]

EPSG_METRICO = 'EPSG:22182'  # POSGAR94 Faja 2 - mismo CRS metrico que coord_utils.py, para medir distancia al limite en metros
_transformer_a_metrico = Transformer.from_crs('EPSG:4326', EPSG_METRICO, always_xy=True)

# Documentado tal cual en metadata.json y en el header de
# cuenca_limite_100m.json - decision explicita (Etapa 1C, revision
# post-1C): se toman estos numeros como diagnostico VIGENTE segun esta
# metodologia, sin forzarlos a coincidir con un conteo anterior de otro
# metodo.
CRITERIO_CERCA_LIMITE = (
    'Distancia en metros (EPSG:22182, POSGAR94 Faja 2) del pozo al borde '
    'de la cuenca que se le asigno, restringida a bordes INTERNOS '
    '(compartidos con una cuenca vecina real). Los pozos cerca '
    'UNICAMENTE del borde EXTERIOR del area de estudio completa (el '
    'limite de la zona relevada en su conjunto, sin ninguna cuenca vecina '
    'del otro lado) quedan EXCLUIDOS de este conteo a proposito - no son '
    'una ambiguedad real entre 2 cuencas.'
)


# Umbral de "diferencia despreciable" para una reparacion make_valid -
# 1e-6 relativo (0.0001%) es varios ordenes de magnitud mayor que la
# diferencia real medida en Rio Atuel (~2e-9 relativo), deliberadamente
# holgado para no marcar "no despreciable" por ruido de punto flotante.
REPARACION_DIFERENCIA_DESPRECIABLE = 1e-6


def cuenca_utils_verificar_shapefile(shp_path):
    """Falla con un mensaje explicito (nunca un fallback silencioso -
    nunca inferir cuenca por departamento ni por cercania) si falta
    alguno de los archivos minimos de un shapefile valido. shp_path debe
    ser la ruta al .shp; .shx y .dbf con el mismo nombre base son
    obligatorios (pyshp los necesita para geometria + atributos)."""
    base, _ = os.path.splitext(shp_path)
    requeridos = [base + ext for ext in ('.shp', '.shx', '.dbf')]
    faltantes = [p for p in requeridos if not os.path.isfile(p)]
    if faltantes:
        detalle = '\n'.join('  - ' + p for p in faltantes)
        raise FileNotFoundError(
            f'Faltan archivos del shapefile de cuencas (se necesitan los 3, mismo nombre base):\n{detalle}\n'
            f'Base esperada: {base}\n'
            'La capa de cuencas no se versiona en el repo (Etapa 1C) - conseguila aparte y pasa su ruta con --cuencas-shp.'
        )


def cuenca_utils_cargar_poligonos(shp_path):
    """Carga los 6 poligonos, reparados (make_valid) y preparados (prep,
    para point-in-polygon rapido). shp_path debe apuntar al .shp dentro
    de Cuencas/WGS84 (ya en EPSG:4326, mismo CRS que lat/lon de
    pozos.json - nunca reproyectar los poligonos de entrada). Devuelve
    (poligonos, reparaciones) - reparaciones documenta cada geometria que
    necesito make_valid() (nunca se toca el .shp en disco, solo la copia
    en memoria) para que quede registrado en metadata.json, nunca en
    silencio."""
    cuenca_utils_verificar_shapefile(shp_path)
    import shapefile  # pyshp - lectura de geometria/atributos cruda, sin depender del encoding de geopandas

    # encoding explicito: el .dbf es ISO-8859-1/latin-1 (ver .cst del
    # shapefile, confirmado byte a byte) - el default de pyshp es utf-8 y
    # tira dbfFileException con "Tunuyán"/"Malargüe" si no se lo pasamos.
    sf = shapefile.Reader(shp_path, encoding='latin-1')
    poligonos = []
    reparaciones = []
    for sr in sf.shapeRecords():
        rec = sr.record.as_dict()
        cuenca_id = int(rec['id'])
        nombre = CUENCA_NOMBRE_POR_ID.get(cuenca_id)
        if nombre is None:
            raise ValueError(f'id de cuenca desconocido en el shapefile: {cuenca_id} - revisar CUENCA_NOMBRE_POR_ID')

        geom = shape_pyshp_a_shapely(sr.shape)
        if not geom.is_valid:
            area_antes = geom.area
            geom = make_valid(geom)
            area_despues = geom.area
            diferencia_relativa = abs(area_despues - area_antes) / area_antes if area_antes else 0.0
            reparaciones.append({
                'cuenca': nombre,
                'motivo': 'geometria invalida (self-intersection de un vertice) reparada con shapely.validation.make_valid() - el shapefile fuente NUNCA se modifica, solo la copia en memoria usada para clasificar',
                'areaAntesGrados2': area_antes,
                'areaDespuesGrados2': area_despues,
                'diferenciaRelativa': diferencia_relativa,
                'diferenciaDespreciable': diferencia_relativa < REPARACION_DIFERENCIA_DESPRECIABLE,
            })

        poligonos.append({
            'id': cuenca_id,
            'nombre': nombre,
            'geom': geom,
            'geom_prep': prep(geom),
            'geom_metrico': None,  # lazy, ver distancia_al_limite_m
        })

    poligonos.sort(key=lambda p: ORDEN_PRIORIDAD_IDS.index(p['id']))
    return poligonos, reparaciones


def shape_pyshp_a_shapely(shape):
    from shapely.geometry import shape as shapely_shape
    return shapely_shape(shape.__geo_interface__)


def cuenca_utils_clasificar(lat, lon, poligonos):
    """Devuelve (nombre_cuenca|None, ambiguo:bool) para un punto. None =
    fuera de los 6 poligonos (nunca se infiere por cercania ni por
    departamento). ambiguo=True si el punto cae dentro de mas de 1
    poligono (se resuelve por ORDEN_PRIORIDAD_IDS, pero se marca para
    quedar documentado - ver punto 'mantener documentados' del pedido)."""
    punto = Point(lon, lat)
    coincidencias = [p['nombre'] for p in poligonos if p['geom_prep'].contains(punto)]
    if not coincidencias:
        return None, False
    if len(coincidencias) > 1:
        # ORDEN_PRIORIDAD_IDS ya ordeno 'poligonos' - el primer match en
        # ese orden es el resultado, pero se reporta como ambiguo.
        return coincidencias[0], True
    return coincidencias[0], False


def cuenca_utils_distancia_al_limite_m(lat, lon, poligono):
    """Distancia en metros (EPSG:22182, metrico) del punto al BORDE del
    poligono que lo contiene - nunca al centro. Se usa solo para el
    reporte de 'pozos cerca del limite' (documentar, nunca reasignar por
    proximidad)."""
    x, y = _transformer_a_metrico.transform(lon, lat)
    if poligono['geom_metrico'] is None:
        from shapely.ops import transform as shapely_transform
        poligono['geom_metrico'] = shapely_transform(_transformer_a_metrico.transform, poligono['geom'])
    punto_metrico = Point(x, y)
    return poligono['geom_metrico'].boundary.distance(punto_metrico)


def cuenca_utils_calcular_limite_externo(poligonos):
    """Borde EXTERNO del area total cubierta por las 6 cuencas (la union
    de las 6 geometrias, reproyectada a metros) - un limite compartido
    entre 2 cuencas vecinas NUNCA forma parte de este borde (se cancela
    en la union), asi que sirve para distinguir 'cerca de un limite
    INTERNO real (riesgo de confusion con la cuenca vecina)' de 'cerca
    del borde exterior del area de estudio' (esto ultimo no es una
    ambiguedad entre cuencas, aunque tambien este a <100m de SU propio
    poligono)."""
    from shapely.ops import unary_union, transform as shapely_transform
    union = unary_union([p['geom'] for p in poligonos])
    union_metrico = shapely_transform(_transformer_a_metrico.transform, union)
    return union_metrico.boundary


def cuenca_utils_es_limite_interno(lat, lon, distancia_propia_m, limite_externo_metrico, margen_m=1.0):
    """True si el punto esta cerca del borde de SU cuenca (ver
    distancia_propia_m, ya calculada por cuenca_utils_distancia_al_limite_m)
    PERO ese borde no es el limite exterior del area de estudio - o sea,
    hay una cuenca vecina real del otro lado, no el limite de la
    provincia/zona relevada."""
    x, y = _transformer_a_metrico.transform(lon, lat)
    d_externo = limite_externo_metrico.distance(Point(x, y))
    return d_externo > distancia_propia_m + margen_m
