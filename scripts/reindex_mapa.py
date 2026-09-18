#!/usr/bin/env python3
"""Genera el dataset del Mapa de Pozos (Etapa 5C-1) a partir de la salida
ya indexada del padron (scripts/out/registro/*.json, generados por
reindex_pozos.py).

Uso:
  python scripts/reindex_mapa.py --registro scripts/out/registro --out scripts/out/mapa

Produce, en el directorio --out:
  pozos.json          - lista de puntos [{wellId, lat, lon, estado}], SOLO
                  esos 4 campos (nunca titular/distrito/uso/NE/ningun otro
                  dato registral - ver adjustment #1 de la Etapa 5B/5C: el
                  dataset general del mapa no debe permitir inferir
                  membresia a la red NE ni exponer nada que dependa de
                  "datos", solo de "ubicacion").
  pozos_busqueda.json - lista [{wellId, titular}] para los MISMOS pozos de
                  pozos.json (mismo orden, misma cantidad) - indice
                  SEPARADO a proposito (Etapa 1A, arquitectura de
                  busqueda): titular requiere el permiso "datos", nunca
                  "ubicacion", asi que viaja en un dataset propio que el
                  backend gatea distinto (ver getIndiceBusquedaProvincia
                  en Api.js) - jamas se mezcla con pozos.json.
  metadata.json - generadoEl, fuente, conteos (para invalidacion de cache
                  del lado del frontend en una etapa futura, mismo patron
                  que scripts/out/registro/metadata.json).

Que pozos entran (ver resolver_ubicacion() en reindex_pozos.py para el
significado exacto de cada estado):
  ubicacion.ubicacionResuelta.estado == "corroborada" -> estado "C" (2+
    fuentes de coordenadas de acuerdo entre si, <=10m)
  ubicacion.ubicacionResuelta.estado == "unica"       -> estado "D" (una
    sola fuente disponible - "Disponible", nunca "confiable")

Que pozos quedan afuera (nunca aparecen en el mapa, en ninguna etapa
futura sin una decision explicita nueva):
  "dudosoLeve", "revisar", "revisarGrave" (fuentes en desacuerdo - nunca
    se promedia ni se elige una al azar) y "sinCoordenadas".

No requiere pyproj: lat/lon ya vienen resueltos en ubicacionResuelta (los
calculo coord_utils.gk_faja2_a_wgs84 ya corrio en reindex_pozos.py) - este
script solo lee, filtra y reproyecta el JSON, no hace ninguna conversion
de coordenadas.
"""
import argparse
import glob
import gzip
import re
import json
import os
import sys
import time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

ESTADO_A_CODIGO = {
    'corroborada': 'C',
    'unica': 'D',
}

# Estados que existen en el padron pero nunca entran al mapa - se cuentan
# igual para el reporte de exclusiones, no son un error.
ESTADOS_EXCLUIDOS = ('dudosoLeve', 'revisar', 'revisarGrave', 'sinCoordenadas')

# NC16 (Etapa 1A, nomenclatura catastral): identificacion.nomenclatura NO
# siempre trae una nomenclatura catastral real - 1.932 de 24.180 registros
# (medido) traen un codigo interno provisorio en su lugar (prefijo "B"+8
# digitos, prefijo "E"+1-4 digitos, o "0" como dato faltante), nunca una
# NC16 valida. Solo el formato EXACTO de 16 digitos numericos (sin
# separadores - ninguno de los 22.248 casos reales los tiene) se acepta
# como NC16 - cualquier otra cosa se guarda como None, nunca se completa
# ni se inventa un valor.
NC16_RE = re.compile(r'^\d{16}$')


def _nc16_valido(raw):
    s = str(raw or '')
    return s if NC16_RE.match(s) else None


def iter_shard_files(registro_dir):
    """Todos los *.json de scripts/out/registro EXCEPTO metadata.json -
    cubre tanto los departamentos sin particionar (DD.json) como los
    particionados (DD-N.json), sin necesidad de conocer de antemano cual
    lista aplica (esa lista vive solo en RegistryRepository.js, no hace
    falta duplicarla aca)."""
    paths = sorted(glob.glob(os.path.join(registro_dir, '*.json')))
    return [p for p in paths if os.path.basename(p) != 'metadata.json']


def leer_metadata_padron(registro_dir):
    metadata_path = os.path.join(registro_dir, 'metadata.json')
    if not os.path.isfile(metadata_path):
        return None
    with open(metadata_path, encoding='utf-8') as f:
        return json.load(f)


def construir_dataset(registro_dir, warnings):
    shard_files = iter_shard_files(registro_dir)
    if not shard_files:
        warnings.append(f'No se encontro ningun archivo de departamento en {registro_dir}')

    puntos = []
    excluidos = Counter()
    sin_ubicacion_resuelta = 0

    for shard_path in shard_files:
        with open(shard_path, encoding='utf-8') as f:
            shard = json.load(f)

        for well_id, record in shard.items():
            ubicacion = record.get('ubicacion') or {}
            resuelta = ubicacion.get('ubicacionResuelta')
            if not resuelta or 'estado' not in resuelta:
                sin_ubicacion_resuelta += 1
                continue

            estado_resuelto = resuelta['estado']
            if estado_resuelto in ESTADOS_EXCLUIDOS:
                excluidos[estado_resuelto] += 1
                continue

            codigo = ESTADO_A_CODIGO.get(estado_resuelto)
            if codigo is None:
                warnings.append(f'{well_id}: estado de ubicacion desconocido "{estado_resuelto}", se excluye')
                excluidos['desconocido'] += 1
                continue

            lat = resuelta.get('lat')
            lon = resuelta.get('lon')
            if lat is None or lon is None:
                warnings.append(f'{well_id}: estado "{estado_resuelto}" sin lat/lon, se excluye')
                excluidos['sinLatLon'] += 1
                continue

            titularidad = record.get('titularidad') or {}
            identificacion = record.get('identificacion') or {}
            puntos.append({
                'wellId': well_id, 'lat': lat, 'lon': lon, 'estado': codigo,
                'titular': titularidad.get('titular') or None,
                'nc16': _nc16_valido(identificacion.get('nomenclatura')),
            })

    if sin_ubicacion_resuelta:
        warnings.append(f'{sin_ubicacion_resuelta} registro(s) sin ubicacionResuelta (padron generado sin enrich_ubicaciones?), se excluyen')

    puntos.sort(key=lambda p: p['wellId'])
    return puntos, excluidos


def _write_json_compacto(path, data):
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=None, separators=(',', ':'))


def generar(registro_dir, out_dir, umbral_particion_ignorado=None):
    warnings = []
    t0 = time.perf_counter()

    metadata_padron = leer_metadata_padron(registro_dir)
    # puntos_busqueda_fuente: wellId/lat/lon/estado + titular + nc16 - los
    # 2 ultimos son datos protegidos por "datos" (ver Etapa 1A, decision
    # de arquitectura aprobada: NC16 identifica una parcela catastral,
    # igual de sensible que titular - viven juntos en el MISMO indice
    # protegido, nunca en pozos.json).
    puntos_busqueda_fuente, excluidos = construir_dataset(registro_dir, warnings)

    # pozos.json NUNCA lleva titular/nc16 (ver adjustment #1) - se
    # reconstruye campo por campo (estructural, no "el resto menos
    # titular/nc16") para que agregar un campo nuevo a
    # puntos_busqueda_fuente en el futuro no se filtre por default a este
    # archivo publico.
    puntos = [{'wellId': p['wellId'], 'lat': p['lat'], 'lon': p['lon'], 'estado': p['estado']} for p in puntos_busqueda_fuente]

    con_titular = sum(1 for p in puntos_busqueda_fuente if p['titular'])
    sin_titular = len(puntos_busqueda_fuente) - con_titular
    if sin_titular:
        warnings.append(f'{sin_titular} pozo(s) del mapa sin titular en el padron - quedan con titular:null en pozos_busqueda.json')

    con_nc16 = sum(1 for p in puntos_busqueda_fuente if p['nc16'])
    sin_nc16 = len(puntos_busqueda_fuente) - con_nc16
    if sin_nc16:
        warnings.append(f'{sin_nc16} pozo(s) del mapa sin NC16 valida (16 digitos) en el padron - quedan con nc16:null en pozos_busqueda.json')

    distribucion = Counter(p['estado'] for p in puntos)

    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    pozos_path = out_dir / 'pozos.json'
    _write_json_compacto(pozos_path, puntos)

    pozos_busqueda_path = out_dir / 'pozos_busqueda.json'
    puntos_busqueda = [{'wellId': p['wellId'], 'nc16': p['nc16'], 'titular': p['titular']} for p in puntos_busqueda_fuente]
    _write_json_compacto(pozos_busqueda_path, puntos_busqueda)

    tiempo_generacion_s = time.perf_counter() - t0

    metadata = {
        'generadoEl': datetime.now(timezone.utc).astimezone().isoformat(timespec='seconds'),
        'fuente': {
            'periodo': metadata_padron.get('fuente', {}).get('periodo') if metadata_padron else None,
            'padronGeneradoEl': metadata_padron.get('generadoEl') if metadata_padron else None,
        },
        'totalPuntos': len(puntos),
        'distribucion': {
            'confirmada': distribucion.get('C', 0),
            'disponible': distribucion.get('D', 0),
        },
        'excluidos': dict(excluidos),
        'busqueda': {
            'conTitular': con_titular,
            'sinTitular': sin_titular,
            'conNc16': con_nc16,
            'sinNc16': sin_nc16,
        },
        'tiempoGeneracionSegundos': round(tiempo_generacion_s, 3),
    }
    metadata_path = out_dir / 'metadata.json'
    with open(metadata_path, 'w', encoding='utf-8') as f:
        json.dump(metadata, f, ensure_ascii=False, indent=2, sort_keys=True)

    return {
        'puntos': puntos,
        'puntosBusqueda': puntos_busqueda,
        'metadata': metadata,
        'warnings': warnings,
        'pozosPath': str(pozos_path),
        'pozosBusquedaPath': str(pozos_busqueda_path),
        'metadataPath': str(metadata_path),
        'tiempoGeneracionSegundos': tiempo_generacion_s,
    }


def medir_gzip(path):
    with open(path, 'rb') as f:
        raw = f.read()
    comprimido = gzip.compress(raw, compresslevel=9)
    return len(raw), len(comprimido)


def formatear_kb(num_bytes):
    return f'{num_bytes / 1024:.1f} KB'


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--registro', default='scripts/out/registro', help='directorio con la salida de reindex_pozos.py (default: scripts/out/registro)')
    parser.add_argument('--out', default='scripts/out/mapa', help='directorio de salida (default: scripts/out/mapa)')
    args = parser.parse_args(argv)

    if not os.path.isdir(args.registro):
        print(f'ERROR: no existe el directorio {args.registro} - corre reindex_pozos.py primero', file=sys.stderr)
        return 1

    resultado = generar(args.registro, args.out)

    raw_bytes, gzip_bytes = medir_gzip(resultado['pozosPath'])
    raw_bytes_busqueda, gzip_bytes_busqueda = medir_gzip(resultado['pozosBusquedaPath'])

    print('=== Mapa de Pozos - indexador (Etapa 5C-1 + 1A busqueda) ===')
    print(f'Entrada:  {args.registro}')
    print(f'Salida:   {resultado["pozosPath"]}')
    print(f'          {resultado["pozosBusquedaPath"]}')
    print(f'          {resultado["metadataPath"]}')
    print()
    print(f'Cantidad de puntos: {len(resultado["puntos"])}')
    print(f'  Confirmada (C): {resultado["metadata"]["distribucion"]["confirmada"]}')
    print(f'  Disponible (D): {resultado["metadata"]["distribucion"]["disponible"]}')
    print(f'Excluidos: {resultado["metadata"]["excluidos"]}')
    print(f'Busqueda - con titular: {resultado["metadata"]["busqueda"]["conTitular"]}, sin titular: {resultado["metadata"]["busqueda"]["sinTitular"]}')
    print(f'Busqueda - con NC16 valida: {resultado["metadata"]["busqueda"]["conNc16"]}, sin NC16: {resultado["metadata"]["busqueda"]["sinNc16"]}')
    print()
    print(f'Tamano pozos.json: {raw_bytes} bytes ({formatear_kb(raw_bytes)})')
    print(f'Tamano gzip (nivel 9): {gzip_bytes} bytes ({formatear_kb(gzip_bytes)}) - {gzip_bytes / raw_bytes * 100:.1f}% del original')
    print(f'Tamano pozos_busqueda.json: {raw_bytes_busqueda} bytes ({formatear_kb(raw_bytes_busqueda)})')
    print(f'Tamano gzip (nivel 9): {gzip_bytes_busqueda} bytes ({formatear_kb(gzip_bytes_busqueda)}) - {gzip_bytes_busqueda / raw_bytes_busqueda * 100:.1f}% del original')
    print(f'Tiempo de generacion: {resultado["tiempoGeneracionSegundos"]:.3f}s')
    print()
    if resultado['warnings']:
        print(f'Warnings ({len(resultado["warnings"])}):')
        for w in resultado['warnings'][:20]:
            print(f'  - {w}')
        if len(resultado['warnings']) > 20:
            print(f'  ... y {len(resultado["warnings"]) - 20} mas')
    else:
        print('Sin warnings.')

    return 0


if __name__ == '__main__':
    sys.exit(main())
