# -*- coding: utf-8 -*-
"""Genera js/fixtures/posgar94_ar2_vectores.json: vectores de referencia para el modulo de
conversion de coordenadas del frontend (js/coordenadasConversion.js).

- posgar: pares (x = Este, y = Norte) de EPSG:22182 (POSGAR 94 / Argentina 2) con su lat/lon WGS84 calculados
  por pyproj/PROJ (la MISMA operacion que usa scripts/coord_utils.py para el padron). El frontend no usa
  pyproj: calcula la conversion localmente (serie de Kruger) y se compara contra estos valores.
- gms: coordenadas en grados/minutos/segundos con su valor decimal calculado con aritmetica EXACTA
  (fracciones), independiente de cualquier libreria.

Es determinista (semilla fija). Regenerar solo si cambia el rango cubierto o la version de PROJ:
    "C:\\Program Files\\Python39\\python" scripts/gen_vectores_posgar.py
(requiere pyproj, ver la nota de coord_utils.py sobre que interprete usar).
"""
import json
import os
import random
from fractions import Fraction

import pyproj
from pyproj import Transformer

EPSG_ORIGEN = 'EPSG:22182'
EPSG_DESTINO = 'EPSG:4326'
SEMILLA = 94
RUTA_SALIDA = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'js', 'fixtures', 'posgar94_ar2_vectores.json')

# Caja de Mendoza (la misma que UBICACION_CORR_MENDOZA_BBOX del backend) expresada en POSGAR: Este 2.34-2.74 M, Norte 5.83-6.47 M.
ESTE_MIN, ESTE_MAX = 2300000, 2800000
NORTE_MIN, NORTE_MAX = 5800000, 6500000

FIJOS = [
    (2500000, 6350000),          # meridiano central de la faja 2 (lon = -69 exacto): el valor tipico del padron
    (2500000.0, 6000000.0),
    (2300000, 5800000), (2800000, 5800000), (2300000, 6500000), (2800000, 6500000),     # esquinas del rango de sanidad
    (2400000.123, 6200000.456),  # con decimales
    (2652489.77, 6091258.31),
]


def gms(g, m, s, h):
    return {'g': g, 'm': m, 's': s, 'h': h}


# (lat, lon) en GMS; el valor decimal se calcula exacto abajo. h: S / O en Mendoza (tambien casos de borde).
CASOS_GMS = [
    (gms(32, 53, 10.2, 'S'), gms(68, 50, 25.4, 'O')),      # ejemplo del pedido (zona de la ciudad de Mendoza)
    (gms(33, 20, 51.54, 'S'), gms(69, 8, 43.62, 'O')),     # ~ pozo 14-0001
    (gms(34, 36, 0, 'S'), gms(68, 20, 0, 'O')),            # minutos y segundos redondos (San Rafael)
    (gms(35, 28, 32.5, 'S'), gms(69, 35, 9.0, 'O')),
    (gms(32, 0, 0, 'S'), gms(70, 0, 0, 'O')),              # grados enteros
    (gms(37, 39, 0, 'S'), gms(70, 38, 59.9999, 'O')),      # borde de la caja de Mendoza y segundos casi 60
    (gms(31, 57, 0, 'S'), gms(66, 27, 0, 'O')),
    (gms(33, 0, 0.1, 'S'), gms(69, 0, 0.01, 'O')),
    (gms(33, 15, 30.75, 'S'), gms(68, 45, 15.125, 'O')),   # varios decimales
    (gms(0, 0, 0, 'N'), gms(0, 0, 0, 'E')),                # origen
    (gms(90, 0, 0, 'N'), gms(180, 0, 0, 'E')),             # extremos
    (gms(90, 0, 0, 'S'), gms(180, 0, 0, 'O')),
    (gms(32, 53, 10.2, 'N'), gms(68, 50, 25.4, 'E')),      # hemisferios "equivocados" (fuera de Mendoza, pero conversion valida)
    (gms(33, 59, 59.99, 'S'), gms(68, 59, 59.99, 'O')),
]


def decimal_exacto(c):
    valor = Fraction(c['g']) + Fraction(c['m'], 60) + Fraction(str(c['s'])) / 3600
    return float(-valor if c['h'] in ('S', 'O', 'W') else valor)


def generar():
    t = Transformer.from_crs(EPSG_ORIGEN, EPSG_DESTINO, always_xy=True)
    rng = random.Random(SEMILLA)
    pares = list(FIJOS)
    for _ in range(52):
        pares.append((round(rng.uniform(ESTE_MIN, ESTE_MAX), 3), round(rng.uniform(NORTE_MIN, NORTE_MAX), 3)))
    posgar = []
    for x, y in pares:
        lon, lat = t.transform(x, y)
        posgar.append({'x': x, 'y': y, 'lat': lat, 'lon': lon})
    gms_v = []
    for la, lo in CASOS_GMS:
        gms_v.append({'lat': la, 'lon': lo, 'latDecimal': decimal_exacto(la), 'lonDecimal': decimal_exacto(lo)})
    return {
        'meta': {
            'generador': 'scripts/gen_vectores_posgar.py',
            'crs': EPSG_ORIGEN,
            'destino': EPSG_DESTINO,
            'ejes': 'x = Este, y = Norte (convencion del padron; el IGN usa la inversa)',
            'semilla': SEMILLA,
            'pyproj': pyproj.__version__,
            'proj': pyproj.proj_version_str,
            'operacion': t.description if hasattr(t, 'description') else '',
        },
        'posgar': posgar,
        'gms': gms_v,
    }


if __name__ == '__main__':
    datos = generar()
    ruta = os.path.normpath(RUTA_SALIDA)
    os.makedirs(os.path.dirname(ruta), exist_ok=True)
    with open(ruta, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(datos, f, ensure_ascii=False, indent=1)
        f.write('\n')
    print('escrito', ruta, '-', len(datos['posgar']), 'vectores POSGAR y', len(datos['gms']), 'GMS (pyproj', pyproj.__version__ + ', PROJ', pyproj.proj_version_str + ')')
