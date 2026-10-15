# -*- coding: utf-8 -*-
"""Genera js/fixtures/resolver_ubicacion_vectores.json: vectores de PARIDAD entre el resolver de ubicacion del padron
(scripts/reindex_pozos.py::resolver_ubicacion, el que corre offline) y su copia en JS (js/ubicacionFuenteDecisionesLogic.js).

Para cada caso se guardan las fuentes (con su lat/lon calculada por scripts/coord_utils.py, o sea pyproj redondeado a 5 decimales) y lo que
devuelve el resolver de PYTHON. Los tests de Jest exigen que el JS devuelva EXACTAMENTE lo mismo (mismos umbrales, mismo desempate, mismo redondeo).

  - "resolver":  fuentes -> resultado del resolver (sin decisiones).
  - "descartes": fuentes + indices descartados -> resultado del resolver de Python sobre las fuentes que QUEDAN (Reporte Pozos primero, luego las de
                 Irrigacion en su orden: es lo que recibiria el indexador si esas coordenadas no estuvieran). Es la definicion de «resolver automatico sobre
                 fuentes no descartadas».

Incluye los bordes de los umbrales (10 / 50 / 500 m exactos y a una milesima de ellos), empates, fuentes duplicadas y redondeos delicados de Python
(round half-even y valores como 0.15 o 1.25) ademas de casos aleatorios con semilla fija. Es determinista. Regenerar solo si cambia el resolver de Python:
    "C:\\Program Files\\Python39\\python" scripts/gen_vectores_resolver_ubicacion.py
(requiere pyproj, ver la nota de coord_utils.py sobre que interprete usar).
"""
import json
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import reindex_pozos as rp  # noqa: E402
from coord_utils import gk_faja2_a_wgs84  # noqa: E402

SEMILLA = 2026
RUTA_SALIDA = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'js', 'fixtures', 'resolver_ubicacion_vectores.json')

BASE_X, BASE_Y = 2486460.782, 6310651.228     # ~ pozo 14-0001 (Este, Norte)


def _r3(v):
    return round(v, 3)


def fuente(tipo, x, y):
    lat, lon = gk_faja2_a_wgs84(x, y)
    return {'tipo': tipo, 'x': x, 'y': y, 'lat': lat, 'lon': lon}


def resolver_python(fuentes):
    """Llama al resolver REAL de Python con las fuentes en el orden del indexador (Reporte primero, si hay)."""
    reporte = None
    provincia = []
    for i, f in enumerate(fuentes):
        if f['tipo'] == 'REPORTE_POZOS':
            assert i == 0 and reporte is None, 'Reporte Pozos va primero y una sola vez'
            reporte = {'x': f['x'], 'y': f['y']}
        else:
            provincia.append({'x': f['x'], 'y': f['y']})
    return rp.resolver_ubicacion(reporte, provincia)


def caso_resolver(cid, descripcion, fuentes):
    return {'id': cid, 'descripcion': descripcion, 'fuentes': fuentes, 'esperado': resolver_python(fuentes)}


def clave(f):
    """Identidad de una fuente: tipo + x + y a 3 decimales (el wellId es el mismo en todo el caso)."""
    return (f['tipo'], '%.3f' % f['x'], '%.3f' % f['y'])


def caso_descartes(cid, descripcion, fuentes, descartadas):
    """Una decision recae sobre la IDENTIDAD de la fuente (tipo + x + y), no sobre una fila: si el padron trae dos filas identicas del mismo tipo, descartar una
    descarta las dos. `descartadas` queda ya expandido a todas las filas con esa identidad."""
    claves = {clave(fuentes[i]) for i in descartadas}
    efectivas = {i for i, f in enumerate(fuentes) if clave(f) in claves}
    restantes = [f for i, f in enumerate(fuentes) if i not in efectivas]
    descartadas = efectivas
    return {
        'id': cid, 'descripcion': descripcion, 'fuentes': fuentes, 'descartadas': sorted(descartadas),
        'esperado': resolver_python(restantes), 'esperadoSinDescartes': resolver_python(fuentes),
    }


def desplazar(x, y, distancia, angulo_grados):
    a = math.radians(angulo_grados)
    return _r3(x + distancia * math.cos(a)), _r3(y + distancia * math.sin(a))


def R(x=BASE_X, y=BASE_Y):
    return fuente('REPORTE_POZOS', x, y)


def I(x=BASE_X, y=BASE_Y):
    return fuente('IRRIGACION', x, y)


def casos_fijos_resolver():
    c = []
    c.append(caso_resolver('sin-fuentes', 'ninguna fuente -> sinCoordenadas', []))
    c.append(caso_resolver('solo-reporte', 'una sola fuente (Reporte Pozos) -> unica, nunca corroborada', [R()]))
    c.append(caso_resolver('solo-irrigacion', 'una sola fuente (Irrigacion) -> unica con fuente coordProvincia', [I()]))
    # umbrales exactos sobre el eje Este: d = 0 / 9.999 / 10 / 10.001 / 49.999 / 50 / 50.001 / 499.999 / 500 / 500.001 / 1200
    for d in (0.0, 0.1, 9.999, 10.0, 10.001, 25.0, 49.999, 50.0, 50.001, 120.5, 499.999, 500.0, 500.001, 1200.0):
        c.append(caso_resolver('par-%s' % d, 'Reporte + Irrigacion a %s m (eje Este)' % d, [R(), I(_r3(BASE_X + d), BASE_Y)]))
    # lo mismo sobre el eje Norte y en diagonal 3-4-5 (distancia exacta 10 = 6-8, 50 = 30-40, 500 = 300-400)
    for d, (dx, dy) in {'10-diagonal': (6.0, 8.0), '50-diagonal': (30.0, 40.0), '500-diagonal': (300.0, 400.0)}.items():
        c.append(caso_resolver('par-%s' % d, 'distancia exacta por diagonal 3-4-5', [R(), I(_r3(BASE_X + dx), _r3(BASE_Y + dy))]))
    c.append(caso_resolver('par-norte-10', 'a 10 m sobre el eje Norte', [R(), I(BASE_X, _r3(BASE_Y + 10.0))]))
    # el caso real 14-0001: Reporte y una Irrigacion coinciden (~11 m), una segunda Irrigacion esta lejos
    c.append(caso_resolver('14-0001-tres-fuentes', 'dos coinciden (<= 10 m) y una tercera a ~170 m: corroborada, la tercera no cuenta',
                           [R(), I(_r3(BASE_X + 4.0), _r3(BASE_Y + 3.0)), I(_r3(BASE_X + 130.0), _r3(BASE_Y - 110.0))]))
    c.append(caso_resolver('tres-fuentes-corroborada-con-lejana-grave', 'dos coinciden y la tercera esta a > 2 km: igual corroborada',
                           [R(), I(_r3(BASE_X + 2.0)), I(_r3(BASE_X + 2500.0))]))
    c.append(caso_resolver('tres-sin-par-cercano-leve', 'ningun par <= 10 m pero todas a <= 50 m: dudosoLeve',
                           [R(), I(_r3(BASE_X + 20.0)), I(_r3(BASE_X + 40.0))]))
    c.append(caso_resolver('tres-sin-par-cercano-revisar', 'ningun par <= 10 m y la mas lejana entre 50 y 500 m: revisar',
                           [R(), I(_r3(BASE_X + 20.0)), I(_r3(BASE_X + 300.0))]))
    c.append(caso_resolver('tres-sin-par-cercano-grave', 'ningun par <= 10 m y la mas lejana a > 500 m: revisarGrave',
                           [R(), I(_r3(BASE_X + 20.0)), I(_r3(BASE_X + 900.0))]))
    # desempate: dos pares con la MISMA distancia minima -> gana el primer par encontrado (i < j), y la candidata es la i
    c.append(caso_resolver('empate-de-pares', 'dos pares a 6 m: la candidata elegida es la primera del primer par',
                           [R(), I(_r3(BASE_X + 6.0)), I(_r3(BASE_X + 500.0)), I(_r3(BASE_X + 506.0))]))
    c.append(caso_resolver('par-mejor-no-es-el-primero', 'el par mas cercano esta entre la segunda y la tercera fuente',
                           [R(), I(_r3(BASE_X + 80.0)), I(_r3(BASE_X + 83.0))]))
    c.append(caso_resolver('filas-duplicadas-irrigacion', 'dos filas IDENTICAS de Irrigacion: distancia 0 -> corroborada (artefacto del padron, igual que Python)',
                           [I(), I()]))
    c.append(caso_resolver('reporte-y-irrigacion-identicos', 'Reporte e Irrigacion con la misma coordenada: corroborada a 0 m', [R(), I()]))
    c.append(caso_resolver('seis-fuentes', 'seis fuentes en cadena a 7 m una de otra', [R()] + [I(_r3(BASE_X + 7.0 * k)) for k in range(1, 6)]))
    # redondeos delicados de round(d, 1) de Python (half-even exacto y valores no representables como 0.15 o 9.95)
    for d in (0.05, 0.15, 0.25, 0.35, 0.45, 1.25, 2.25, 3.75, 4.35, 9.95, 12.25, 12.75, 20.75, 33.35, 49.95, 77.25, 250.05, 250.25):
        c.append(caso_resolver('redondeo-%s' % d, 'distancia %s m: probar el redondeo a 1 decimal de Python' % d, [R(), I(_r3(BASE_X + d))]))
    # valores sin decimales y enteros como los del padron
    c.append(caso_resolver('enteros', 'x e y enteros', [fuente('REPORTE_POZOS', 2500000, 6350000), fuente('IRRIGACION', 2500004, 6350003)]))
    return c


def casos_aleatorios_resolver(rnd, cantidad):
    distancias = [0.0, 0.5, 3.0, 9.9, 10.0, 10.1, 25.0, 49.9, 50.0, 50.1, 200.0, 499.9, 500.0, 500.1, 1200.0, 4000.0]
    out = []
    for n in range(cantidad):
        fuentes = generar_fuentes(rnd, distancias)
        out.append(caso_resolver('aleatorio-%03d' % n, 'aleatorio (%d fuentes)' % len(fuentes), fuentes))
    return out


def generar_fuentes(rnd, distancias):
    cantidad = rnd.choice([0, 1, 1, 2, 2, 2, 3, 3, 4, 5, 6])
    bx = _r3(rnd.uniform(2400000, 2700000))
    by = _r3(rnd.uniform(5900000, 6400000))
    puntos = []
    for k in range(cantidad):
        if not puntos:
            x, y = bx, by
        else:
            px, py = rnd.choice(puntos)
            d = rnd.choice(distancias) if rnd.random() < 0.85 else rnd.uniform(0, 800)
            ang = rnd.choice([0, 90, 180, 270, rnd.uniform(0, 360)])
            x, y = desplazar(px, py, d, ang)
        puntos.append((x, y))
    con_reporte = cantidad > 0 and rnd.random() < 0.6
    fuentes = []
    for i, (x, y) in enumerate(puntos):
        fuentes.append(fuente('REPORTE_POZOS' if (i == 0 and con_reporte) else 'IRRIGACION', x, y))
    return fuentes


def casos_fijos_descartes():
    c = []
    tres = [R(), I(_r3(BASE_X + 4.0), _r3(BASE_Y + 3.0)), I(_r3(BASE_X + 130.0), _r3(BASE_Y - 110.0))]
    c.append(caso_descartes('desc-ninguna', 'sin descartes = resolver normal', tres, []))
    c.append(caso_descartes('desc-la-lejana', 'descartar la tercera (lejana): sigue corroborada con las otras dos', tres, [2]))
    c.append(caso_descartes('desc-una-del-par', 'descartar una del par que coincidia: quedan dos lejanas -> ya no corrobora', tres, [1]))
    c.append(caso_descartes('desc-reporte', 'descartar Reporte Pozos: quedan las dos de Irrigacion', tres, [0]))
    c.append(caso_descartes('desc-todas-menos-una', 'queda una sola fuente -> unica', tres, [0, 1]))
    c.append(caso_descartes('desc-todas', 'todas descartadas -> sinCoordenadas', tres, [0, 1, 2]))
    c.append(caso_descartes('desc-cambia-discrepancia-a-disponible', 'en discrepancia grave se descarta una y queda unica',
                            [R(), I(_r3(BASE_X + 900.0))], [1]))
    c.append(caso_descartes('desc-sale-de-discrepancia', 'con tres lejanas, descartar la mas lejana baja de grave a revisar',
                            [R(), I(_r3(BASE_X + 200.0)), I(_r3(BASE_X + 900.0))], [2]))
    c.append(caso_descartes('desc-filas-identicas', 'dos filas identicas de Irrigacion: comparten identidad, descartar una descarta las dos -> sinCoordenadas',
                            [I(), I()], [1]))
    c.append(caso_descartes('desc-filas-identicas-y-otra', 'dos filas identicas + una tercera: descartar la identica deja solo la tercera -> unica',
                            [R(), I(_r3(BASE_X + 300.0)), I(_r3(BASE_X + 300.0))], [2]))
    c.append(caso_descartes('desc-par-identico-reporte-irrigacion', 'Reporte e Irrigacion identicos: se descarta Irrigacion -> unica del Reporte',
                            [R(), I()], [1]))
    c.append(caso_descartes('desc-empate', 'con pares empatados, descartar la primera cambia la candidata elegida',
                            [R(), I(_r3(BASE_X + 6.0)), I(_r3(BASE_X + 500.0)), I(_r3(BASE_X + 506.0))], [0]))
    c.append(caso_descartes('desc-sin-fuentes', 'pozo sin fuentes y sin descartes', [], []))
    return c


def casos_aleatorios_descartes(rnd, cantidad):
    distancias = [0.0, 3.0, 9.9, 10.0, 10.1, 49.9, 50.0, 50.1, 300.0, 499.9, 500.0, 500.1, 1500.0]
    out = []
    n = 0
    while len(out) < cantidad:
        fuentes = generar_fuentes(rnd, distancias)
        if not fuentes:
            continue
        descartadas = [i for i in range(len(fuentes)) if rnd.random() < 0.4]
        out.append(caso_descartes('desc-aleatorio-%03d' % n, 'aleatorio (%d fuentes, %d descartadas)' % (len(fuentes), len(descartadas)), fuentes, descartadas))
        n += 1
    return out


def generar():
    rnd = random.Random(SEMILLA)
    return {
        'meta': {
            'generador': 'scripts/gen_vectores_resolver_ubicacion.py',
            'semilla': SEMILLA,
            'fuenteDeVerdad': 'scripts/reindex_pozos.py::resolver_ubicacion',
            'conversion': 'scripts/coord_utils.py::gk_faja2_a_wgs84 (EPSG:22182 -> EPSG:4326, 5 decimales)',
            'umbrales': {
                'corroboracionM': rp.UBICACION_UMBRAL_CORROBORACION_M,
                'dudosoM': rp.UBICACION_UMBRAL_DUDOSO_M,
                'graveM': rp.UBICACION_UMBRAL_GRAVE_M,
            },
            'ejes': 'x = Este, y = Norte (EPSG:22182, metros)',
            'orden': 'Reporte Pozos primero (si hay) y luego las de Irrigacion en su orden: es el orden en que el indexador arma las candidatas',
        },
        'resolver': casos_fijos_resolver() + casos_aleatorios_resolver(rnd, 300),
        'descartes': casos_fijos_descartes() + casos_aleatorios_descartes(rnd, 200),
    }


def main():
    datos = generar()
    with open(RUTA_SALIDA, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(datos, f, ensure_ascii=False, indent=1)
        f.write('\n')
    print('escrito %s: %d casos de resolver, %d de descartes' % (os.path.normpath(RUTA_SALIDA), len(datos['resolver']), len(datos['descartes'])))


if __name__ == '__main__':
    main()
