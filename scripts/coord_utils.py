# -*- coding: utf-8 -*-
"""Conversion de coordenadas Gauss-Kruger Faja 2 (POSGAR94, EPSG:22182) a
WGS84 lat/lon. Modulo compartido entre reindex_pozos.py y
reindex_niveles_estaticos.py - la logica de CRS vive en un solo lugar.

El CRS quedo confirmado empiricamente (no asumido) comparando 3 datums
candidatos (POSGAR94/22182, POSGAR07/5344, Campo Inchauspe/22172) contra
coordenadas DMS reales incluidas en Coord_pozos_provincia.csv: los tres
dan ~11-19m de error, indistinguibles entre si (el error viene del
redondeo a 1" del DMS, no de un mismatch de datum). Se eligio POSGAR94
Faja 2 por ser el que el usuario confirmo para la red NE, y por quedar
empiricamente validado tambien para las coordenadas del padron.

Requiere pyproj. En este entorno de desarrollo, pyproj esta instalado
bajo Python 3.9 ("C:\\Program Files\\Python39\\python"), no bajo el
"python3"/"pip" que resuelve por defecto en la shell (un stub 3.11 de
WindowsApps sin el paquete) - si este modulo falla con
ModuleNotFoundError al correr un script que lo importa, usar ese
interprete explicito.
"""
from pyproj import Transformer

EPSG_ORIGEN = 'EPSG:22182'  # POSGAR94 / Argentina Faja 2 (Gauss-Kruger)
EPSG_DESTINO = 'EPSG:4326'  # WGS84

_transformer = Transformer.from_crs(EPSG_ORIGEN, EPSG_DESTINO, always_xy=True)


def gk_faja2_a_wgs84(x, y):
    """(x, y) en Gauss-Kruger Faja 2 (POSGAR94) -> (lat, lon) WGS84.
    Redondeado a 5 decimales (~1m de precision - mas que suficiente para
    un pin de mapa, evita falsa precision de 15 decimales)."""
    lon, lat = _transformer.transform(x, y)
    return round(lat, 5), round(lon, 5)
