#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Reindexa la Red de Niveles Estaticos (NE) en un unico
nivelesEstaticos.json + metadata.json, listos para subir a mano a Drive.

Fuentes (3 archivos independientes, nunca se mezclan sus roles):
  - NE_General_2026.csv       identidad + ubicacion + metadatos de campana
  - NE_Historico_hasta_2025.csv  serie anual 1967-2025 (autoritativa para
                                  historia previa a 2026)
  - NE_Mediciones_2026.csv    mediciones individuales de la campana 2026
                                  (autoritativa para 2026, no se usan las
                                  columnas embebidas de mediciones_2026_*
                                  en NE_General_2026.csv - son una copia
                                  derivada de menor confianza)

Uso:
  python scripts/reindex_niveles_estaticos.py \
      NE_General_2026.csv NE_Historico_hasta_2025.csv NE_Mediciones_2026.csv \
      --out scripts/out/niveles_estaticos

Identidad de cada punto (monitoringId):
  - Si dep_pozo tiene la forma "DD PPPP" (departamento 01-19 + numero de
    pozo), monitoringId = wellId normalizado ("06-0714") y wellId queda
    seteado - es un pozo del padron.
  - Si no, es un punto especial (INA/RTR/Puesto/etc, sin padron):
    monitoringId = el token antes del primer " - ", normalizado
    (mayusculas, espacios colapsados) para que el mismo punto se
    identifique igual aunque el texto completo varie entre archivos
    (confirmado real: "INA 2055" en General vs "INA 2055 - Jofre Puesto
    San Vicente" en Mediciones2026). wellId queda None.
  - Numeros sueltos sin prefijo de departamento (ej. "7", "11") son
    identidad ambigua - se indexan igual bajo ese token pero se marcan
    con advertencia para revision manual.

Requiere pyproj (ver coord_utils.py) para convertir x/y (POSGAR94 Faja 2)
a lat/lon.
"""
import argparse
import csv
import json
import re
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

from coord_utils import gk_faja2_a_wgs84

# --- Identidad de punto --------------------------------------------------

_DDPPPP_PREFIX_RE = re.compile(r'^\s*(\d{1,2})\s+(\d{1,4})\b\s*-?\s*')


def parse_dep_pozo(raw):
    """raw crudo de dep_pozo -> (wellId o None, monitoringId, nombreOriginal).
    Usa solo el PREFIJO (sin anclar el final) porque algunos nombres en
    NE_Historico_hasta_2025.csv traen saltos de linea embebidos dentro del
    campo citado del CSV - anclar a $ los deja sin matchear."""
    raw = raw if raw is not None else ''
    m = _DDPPPP_PREFIX_RE.match(raw)
    if m:
        dep_n, pozo_n = int(m.group(1)), int(m.group(2))
        if 1 <= dep_n <= 19:
            well_id = f'{dep_n:02d}-{pozo_n:04d}'
            nombre = raw[m.end():].strip()
            return well_id, well_id, (nombre or None)
    token, sep, resto = raw.partition(' - ')
    monitoring_id = re.sub(r'\s+', ' ', token.strip()).upper()
    nombre = resto.strip() if sep else None
    return None, monitoring_id, (nombre or None)


def es_identidad_ambigua(monitoring_id, well_id):
    """Numero suelto sin prefijo de departamento (ej. "7") - no es un
    wellId valido ni tiene un prefijo reconocible tipo INA/RTR/Pto."""
    return well_id is None and monitoring_id.isdigit()


# --- Parsing numerico ------------------------------------------------------

def parse_numero(raw):
    """Los archivos NE usan '.' decimal sin separador de miles (formato
    distinto al Reporte Pozos y a Coord_pozos_provincia.csv) - se admite
    ademas ',' decimal por si algun export lo trae, nunca al mismo tiempo
    que un '.' (eso indicaria separador de miles, no aplica aca)."""
    v = (raw or '').strip()
    if not v:
        return None
    try:
        return float(v)
    except ValueError:
        pass
    try:
        return float(v.replace(',', '.'))
    except ValueError:
        return None


def limpiar_numero(value):
    if value is None:
        return None
    return int(value) if value == int(value) else value


def parse_fecha_ymd_slash(raw):
    v = (raw or '').strip()
    if not v:
        return None
    try:
        return datetime.strptime(v, '%Y/%m/%d').date().isoformat()
    except ValueError:
        return None


def texto(raw):
    v = (raw or '').strip()
    return v or None


# --- Lectura de NE_General_2026.csv ----------------------------------------

def read_general(path, puntos, warnings):
    with open(path, encoding='utf-8-sig', newline='') as f:
        reader = csv.DictReader(f)
        rows = list(reader)

    ambiguos = set()
    for row in rows:
        well_id, monitoring_id, nombre = parse_dep_pozo(row['dep_pozo'])
        if es_identidad_ambigua(monitoring_id, well_id):
            ambiguos.add(monitoring_id)

        punto = puntos.setdefault(monitoring_id, _punto_vacio(monitoring_id))
        if well_id:
            punto['wellId'] = well_id
        _actualizar_nombre_original(punto, nombre)

        x, y = parse_numero(row['x']), parse_numero(row['y'])
        if x is not None and y is not None:
            lat, lon = gk_faja2_a_wgs84(x, y)
            punto['coordenadas'] = {'x': limpiar_numero(x), 'y': limpiar_numero(y), 'lat': lat, 'lon': lon}

        punto['elevacion'] = limpiar_numero(parse_numero(row.get('z', '')))
        punto['zona'] = texto(row.get('zona'))
        punto['cuenca'] = texto(row.get('cuenca'))
        punto['estadoMonitoreo'] = texto(row.get('Estado'))
        punto['idIna'] = texto(row.get('ina'))
        punto['propietario'] = texto(row.get('propietario'))

    if ambiguos:
        warnings.append(
            f'NE_General_2026.csv: {len(ambiguos)} identidad(es) ambigua(s) sin prefijo de departamento '
            f'(numeros sueltos, ej. {sorted(ambiguos)[:5]}) - revisar manualmente'
        )
    return len(rows)


def _punto_vacio(monitoring_id):
    return {
        'monitoringId': monitoring_id,
        'wellId': None,
        'nombreOriginal': None,
        'coordenadas': None,
        'elevacion': None,
        'zona': None,
        'cuenca': None,
        'estadoMonitoreo': None,
        'idIna': None,
        'propietario': None,
        'historico': [],
        'campana2026': [],
    }


def _actualizar_nombre_original(punto, nombre_candidato):
    """Se conserva el nombre mas descriptivo visto hasta ahora entre
    archivos (confirmado real: el mismo punto especial trae distinto
    texto segun el archivo, ej. 'INA 2055' vs 'INA 2055 - Jofre Puesto
    San Vicente') - nunca se descarta el que ya habia si el nuevo es mas
    corto o vacio."""
    if not nombre_candidato:
        return
    actual = punto['nombreOriginal']
    if actual is None or len(nombre_candidato) > len(actual):
        punto['nombreOriginal'] = nombre_candidato


# --- Lectura de NE_Historico_hasta_2025.csv --------------------------------

def read_historico(path, puntos, warnings):
    with open(path, encoding='utf-8-sig', newline='') as f:
        reader = csv.reader(f, delimiter=';')
        header = next(reader)
        rows = list(reader)
    idx = {h: i for i, h in enumerate(header)}

    vacios = 0
    for row in rows:
        well_id, monitoring_id, nombre = parse_dep_pozo(row[idx['dep_pozo']])
        anio = texto(row[idx['anio']])
        nivel = parse_numero(row[idx['nivel_estatico']])
        if not anio and nivel is None:
            vacios += 1
            continue

        punto = puntos.setdefault(monitoring_id, _punto_vacio(monitoring_id))
        if well_id:
            punto['wellId'] = well_id
        _actualizar_nombre_original(punto, nombre)

        if nivel is not None and anio:
            punto['historico'].append({
                'anio': int(anio),
                'nivel': limpiar_numero(nivel),
                'surgente': nivel > 0,
            })

    if vacios:
        warnings.append(f'NE_Historico_hasta_2025.csv: {vacios} fila(s) completamente vacia(s) (sin anio ni nivel), se omiten')

    for punto in puntos.values():
        punto['historico'].sort(key=lambda m: m['anio'])
    return len(rows)


# --- Lectura de NE_Mediciones_2026.csv -------------------------------------

# Correcciones puntuales aprobadas a mano por el usuario (2026-09-14) sobre
# filas concretas de NE_Mediciones_2026.csv, identificadas por 'fid' (el
# CSV fuente NUNCA se modifica - esto solo cambia como se interpreta al
# indexar, y siempre queda en un warning, nunca en silencio). Si el
# archivo fuente se vuelve a exportar, estos fid pueden dejar de existir o
# apuntar a otra fila - revisar esta lista contra la evidencia real antes
# de reusarla en una corrida futura, no asumir que sigue siendo valida.
#
# fid 279 (10-0809): fecha_medicion decia 2025/07/08 - aprobado usar 2026
#   conservando dia y mes. fid 314 (8-0286): decia 2027/06/29, mismo
#   criterio.
FECHA_CORREGIDA_POR_FID = {
    '279': '2026-07-08',
    '314': '2026-06-29',
}

# fid 437 (06-0714) y fid 439 (06-0459): dos filas reales del mismo punto
# y la misma fecha (2026/08/04), no un duplicado exacto - se descarta una
# de cada par por decision explicita del usuario, no por una regla
# automatica de deduplicacion:
#   - 06-0714: se conserva fid 436 (hora simple '09:20:06'), se descarta
#     fid 437 (hora en formato ISO detallado).
#   - 06-0459: se descarta fid 439 (nivel -84), se conserva fid 440
#     (nivel -84.92).
FILAS_DESCARTADAS_POR_FID = {'437', '439'}


def read_mediciones_2026(path, puntos, warnings):
    with open(path, encoding='utf-8-sig', newline='') as f:
        reader = csv.DictReader(f)
        rows = list(reader)

    sin_nivel = 0
    claves_vistas = Counter()
    fuera_de_2026 = 0
    for row in rows:
        fid = row.get('fid', '').strip()

        if fid in FILAS_DESCARTADAS_POR_FID:
            warnings.append(
                f'NE_Mediciones_2026.csv: fid {fid} ({row["dep_pozo"].strip()}) descartado por decision '
                'manual aprobada (duplicado de punto+fecha, ver FILAS_DESCARTADAS_POR_FID) - fila fuente sin modificar'
            )
            continue

        well_id, monitoring_id, nombre = parse_dep_pozo(row['dep_pozo'])
        nivel = parse_numero(row['nivel_estatico'])
        fecha = parse_fecha_ymd_slash(row['fecha_medicion'])

        if fid in FECHA_CORREGIDA_POR_FID:
            fecha_original = fecha
            fecha = FECHA_CORREGIDA_POR_FID[fid]
            warnings.append(
                f'NE_Mediciones_2026.csv: fid {fid} ({row["dep_pozo"].strip()}) fecha corregida por decision '
                f'manual aprobada: {fecha_original} -> {fecha} - fila fuente sin modificar'
            )

        if fecha and not fecha.startswith('2026-'):
            fuera_de_2026 += 1

        clave = (monitoring_id, fecha)
        if fecha:
            claves_vistas[clave] += 1

        if nivel is None:
            sin_nivel += 1
            continue

        punto = puntos.setdefault(monitoring_id, _punto_vacio(monitoring_id))
        if well_id:
            punto['wellId'] = well_id
        _actualizar_nombre_original(punto, nombre)

        punto['campana2026'].append({
            'fecha': fecha,
            'hora': texto(row.get('hora_medicion')),
            'nivel': limpiar_numero(nivel),
            'surgente': nivel > 0,
            'persona': texto(row.get('persona_dgi')),
            'observacion': texto(row.get('observacion_2026')) or texto(row.get('ultima_observacion')),
        })

    if sin_nivel:
        warnings.append(f'NE_Mediciones_2026.csv: {sin_nivel} fila(s) sin nivel_estatico (medicion pendiente/no realizada), se omiten de campana2026')
    if fuera_de_2026:
        warnings.append(f'NE_Mediciones_2026.csv: {fuera_de_2026} fila(s) con fecha_medicion fuera de 2026 (probable error de carga)')
    duplicadas = {k: v for k, v in claves_vistas.items() if v > 1}
    if duplicadas:
        warnings.append(f'NE_Mediciones_2026.csv: {len(duplicadas)} combinacion(es) (punto, fecha) con mas de una fila - {list(duplicadas.items())[:5]}')

    for punto in puntos.values():
        punto['campana2026'].sort(key=lambda m: m['fecha'] or '')
    return len(rows)


# --- Estadisticas + ultima medicion -----------------------------------------

def calcular_estadisticas(punto):
    valores = [(m['anio'], m['nivel']) for m in punto['historico']]
    valores += [(int(m['fecha'][:4]), m['nivel']) for m in punto['campana2026'] if m['fecha']]
    if not valores:
        punto['estadisticas'] = None
        punto['ultimaMedicion'] = None
        return

    niveles = [v for _, v in valores]
    minimo = min(valores, key=lambda t: t[1])
    maximo = max(valores, key=lambda t: t[1])
    media = sum(niveles) / len(niveles)
    punto['estadisticas'] = {
        'nivelMasProfundo': {'valor': limpiar_numero(minimo[1]), 'anio': minimo[0]},
        'nivelMasAlto': {'valor': limpiar_numero(maximo[1]), 'anio': maximo[0]},
        'media': round(media, 2),
        'cantidadMediciones': len(valores),
    }

    if punto['campana2026']:
        ultima = punto['campana2026'][-1]
        punto['ultimaMedicion'] = {
            'fecha': ultima['fecha'], 'nivel': ultima['nivel'],
            'surgente': ultima['surgente'], 'persona': ultima['persona'],
        }
    elif punto['historico']:
        ultima = punto['historico'][-1]
        punto['ultimaMedicion'] = {
            'fecha': None, 'nivel': ultima['nivel'],
            'surgente': ultima['surgente'], 'persona': None,
        }


# --- Consistencia General vs Mediciones2026 (solo diagnostico) -------------

def chequear_consistencia_general_vs_mediciones(path_general, puntos, warnings):
    """NE_General_2026.csv trae columnas embebidas mediciones_2026_* que
    NO se usan como dato (ver docstring del modulo) - se leen solo para
    detectar discrepancias reales contra NE_Mediciones_2026.csv y
    avisar, sin intentar reconciliar automaticamente."""
    with open(path_general, encoding='utf-8-sig', newline='') as f:
        reader = csv.DictReader(f)
        rows = list(reader)

    col_nivel = 'NE General 2026 — mediciones_2026_nivel_estatico'
    if col_nivel not in (rows[0].keys() if rows else []):
        return

    discrepancias = 0
    for row in rows:
        _, monitoring_id, _ = parse_dep_pozo(row['dep_pozo'])
        nivel_embebido = parse_numero(row.get(col_nivel, ''))
        if nivel_embebido is None:
            continue
        punto = puntos.get(monitoring_id)
        if not punto or len(punto['campana2026']) != 1:
            continue
        if punto['campana2026'][0]['nivel'] != limpiar_numero(nivel_embebido):
            discrepancias += 1

    if discrepancias:
        warnings.append(
            f'{discrepancias} punto(s) con valor embebido en NE_General_2026.csv distinto al de '
            'NE_Mediciones_2026.csv (se usa siempre el de Mediciones2026, mas granular)'
        )


# --- Metadata ---------------------------------------------------------------

def build_metadata(puntos, filas_por_archivo, warnings):
    con_well_id = sum(1 for p in puntos.values() if p['wellId'])
    con_coordenadas = sum(1 for p in puntos.values() if p['coordenadas'])
    return {
        'generadoEl': datetime.now(timezone.utc).astimezone().isoformat(timespec='seconds'),
        'puntosTotales': len(puntos),
        'puntosConWellId': con_well_id,
        'puntosEspeciales': len(puntos) - con_well_id,
        'puntosConCoordenadas': con_coordenadas,
        'filasPorArchivo': filas_por_archivo,
    }


# --- Pipeline principal ------------------------------------------------------

def reindex(path_general, path_historico, path_mediciones_2026, out_dir):
    warnings = []
    puntos = {}

    n_general = read_general(path_general, puntos, warnings)
    n_historico = read_historico(path_historico, puntos, warnings)
    n_mediciones = read_mediciones_2026(path_mediciones_2026, puntos, warnings)
    chequear_consistencia_general_vs_mediciones(path_general, puntos, warnings)

    for punto in puntos.values():
        calcular_estadisticas(punto)

    metadata = build_metadata(puntos, {
        'NE_General_2026.csv': n_general,
        'NE_Historico_hasta_2025.csv': n_historico,
        'NE_Mediciones_2026.csv': n_mediciones,
    }, warnings)

    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    with open(out_dir / 'nivelesEstaticos.json', 'w', encoding='utf-8') as f:
        json.dump({'puntos': puntos}, f, ensure_ascii=False, indent=None, separators=(',', ':'), sort_keys=True)
    with open(out_dir / 'metadata.json', 'w', encoding='utf-8') as f:
        json.dump(metadata, f, ensure_ascii=False, indent=2, sort_keys=True)

    return metadata, warnings


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('general_csv', help='NE_General_2026.csv')
    parser.add_argument('historico_csv', help='NE_Historico_hasta_2025.csv')
    parser.add_argument('mediciones_2026_csv', help='NE_Mediciones_2026.csv')
    parser.add_argument('--out', default='scripts/out/niveles_estaticos', help='directorio de salida')
    args = parser.parse_args(argv)

    metadata, warnings = reindex(args.general_csv, args.historico_csv, args.mediciones_2026_csv, args.out)

    print(f'OK - {metadata["puntosTotales"]} puntos de monitoreo en {args.out}/')
    print(f'  con wellId (padron): {metadata["puntosConWellId"]}')
    print(f'  especiales (sin padron): {metadata["puntosEspeciales"]}')
    print(f'  filas por archivo: {metadata["filasPorArchivo"]}')
    print(f'  con coordenadas propias: {metadata["puntosConCoordenadas"]}')
    if warnings:
        print(f'\n{len(warnings)} advertencia(s):', file=sys.stderr)
        for w in warnings:
            print(f'  - {w}', file=sys.stderr)
    return 0


if __name__ == '__main__':
    sys.exit(main())
