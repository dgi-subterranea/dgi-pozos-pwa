#!/usr/bin/env python3
"""Reindexa el Reporte de Pozos (CSV exportado del sistema interno) en 19
archivos JSON por departamento (01.json..19.json, siempre los 19, aunque
alguno quede vacio) mas metadata.json, listos para subir a mano a la
carpeta de Drive que lee RegistryRepository.js.

Uso:
  python scripts/reindex_pozos.py "Reporte Pozos 09_2026.csv" --out scripts/out/registro

El CSV de entrada se lee tal cual sale del sistema (ISO-8859-1, delimitado
por ";", decimales con coma) - no hace falta convertirlo antes. La salida
siempre es UTF-8.

Las columnas se acceden por POSICION, no por nombre (varias tienen tildes
que no vale la pena arriesgar a transcribir mal); ver COLUMNAS mas abajo
para el mapeo, y validate_header() para la validacion de que el CSV que
llego tiene la forma esperada antes de procesar nada.
"""
import argparse
import csv
import json
import re
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

EXPECTED_COLUMN_COUNT = 106

# Particionado por departamento grande: medido contra Drive real (Etapa 2),
# leer el JSON completo de un departamento de ~7-8MB (07, 08) tarda 3.5-
# 4.7s en frio, contra ~0.6-0.7s para departamentos chicos o vacios - el
# cuello de botella es getBlob().getDataAsString(), no JSON.parse. Un
# departamento con mas de PARTITION_THRESHOLD pozos se parte en 10
# archivos DD-0.json..DD-9.json segun el primer digito de PPPP (siempre
# los 10, aunque algunos queden vacios {} - mismo criterio que los 19
# archivos de departamento), en vez de un unico DD.json. El backend
# (RegistryRepository.js) resuelve el nombre de archivo directamente
# desde el wellId, sin leer ningun indice - por eso la lista de
# departamentos particionados tiene que existir tambien, a mano, como
# PARTITIONED_DEPARTMENTS en RegistryRepository.js. Si al re-correr este
# script con un CSV nuevo cambia el resultado (ver
# metadata.departamentosParticionados), hay que actualizar esa constante
# en el backend tambien - el CLI lo recuerda explicitamente al final.
PARTITION_THRESHOLD = 3000

# Posiciones (0-indexadas) de las columnas que se usan. El resto de las
# columnas "Cod. X" / "Cod. X" son el codigo numerico de una columna de
# texto ya presente aca (ej. "Cod. Uso" vs "Uso") y se descartan.
COL_COD_DEPARTAMENTO = 0
COL_NRO_POZO = 1
COL_DEPARTAMENTO = 2
COL_PERSONA = 4
COL_EXPEDIENTE = 5
COL_FECHA_EJECUCION = 6
COL_DISTRITO = 8
COL_DECL_JURADA = 9
COL_USO = 11
COL_USO_SECUNDARIO = 13
COL_CADUCIDAD = 14
COL_CONCES = 15
COL_NOMENCLATURA = 16
COL_DOMICILIO_POSTAL = 17
COL_DOMICILIO_REAL = 18
COL_DOMICILIO_TIT_PRINCIPAL = 19
COL_ESTADO = 20
COL_FECHA_BAJA_CTACTE = 21
COL_FECHA_BAJA_REAL = 22
COL_MOTIVO_BAJA = 24
COL_EXPEDIENTE_BAJA = 25
COL_ORGANISMO = 27
COL_SUP_ORIGEN = 28
COL_SUP_CONCESION = 29
COL_HECTAREAS_FACTIBLES = 30
COL_PLANO_CATASTRO = 31
COL_PLANO_DGI = 32
COL_NIC = 33
COL_FAMILIA = 35
COL_REGISTRO_PERFORACION = 36
COL_COMENTARIO = 37
COL_DIAMETRO_ENTUBACION = 38
COL_DIAMETRO_BOMBA = 39
COL_PROFUNDIDAD_BOMBA = 40
COL_MECANISMO_BOMBA = 42
COL_EMPRESA = 44
COL_DIRECTOR_TECNICO = 46
COL_DIAMETRO_ANTEPOZO = 47
COL_PROFUNDIDAD_ANTEPOZO = 48
COL_PROFUNDIDAD_TOTAL = 49
COL_FILTRO_1 = 50
COL_FILTRO_2 = 51
COL_FILTRO_3 = 52
COL_FILTRO_4 = 53
COL_FILTRO_5 = 54
COL_REDUCCION_1 = 55
COL_REDUCCION_2 = 56
COL_REDUCCION_3 = 57
COL_CEMENTACION = 59
COL_CEMENTACION_DESDE = 60
COL_CEMENTACION_HASTA = 61
COL_NIVEL_ESTATICO = 62
COL_PERFILAJE = 63
COL_CAUDAL = 64
COL_DEPRESION = 65
COL_INDICE_PROMEDIO = 66
COL_POTENCIA = 67
COL_SURGENCIA = 68
COL_APTITUD = 69
COL_DOCUM_FALTANTE = 71
COL_RIEGO_SUPERFICIAL = 72
COL_ESTADO_OBRA = 74
COL_CEGADO = 76
COL_COORD_X = 77
COL_COORD_Y = 78
COL_LABORATORIO = 79
COL_DUREZA_PEM = 80
COL_DUREZA_TOTAL = 81  # el header dice literalmente "Dureaza Total" (typo de origen)
COL_CONDUCTIVIDAD = 82
COL_CALCIO = 83
COL_SODIO = 84
COL_CLORUROS = 85
COL_CARBONATOS = 86
COL_RESIDUOS = 87
COL_CSR = 88
COL_NITRATOS = 89
COL_SILICE = 90
COL_AMONIACO = 91
COL_DIAG_RIEVER = 92
COL_NRO_ANALISIS = 93
COL_DUREZA_TEMP = 94
COL_COEF_ALCAL = 95
COL_VALOR_PH = 96
COL_MAGNESIO = 97
COL_POTASIO = 98
COL_SULFATOS = 99
COL_BICARBONATOS = 100
COL_RAS = 101
COL_NITRITOS = 102
COL_INDICE_KELLE = 103
COL_RASP = 104
COL_RESIDUO_SECO = 105

# Rango de columnas de laboratorio (usado para detectar filas que solo
# difieren en el analisis de agua - ver group_rows_by_well_id).
LAB_COL_START = COL_LABORATORIO
LAB_COL_END = COL_RESIDUO_SECO  # inclusive

# Headers sin tilde (ASCII), usados solo para validar en la posicion
# esperada que el CSV no cambio de forma - no se usan para buscar columnas.
HEADER_SENTINELS = {
    0: 'Cod. Departamento',
    2: 'Departamento',
    20: 'Estado',
    63: 'Perfilaje',
    72: 'Riego Superficial',
    105: 'Residuo Seco',
}


class HeaderMismatch(Exception):
    pass


def validate_header(header):
    if len(header) != EXPECTED_COLUMN_COUNT:
        raise HeaderMismatch(
            f'se esperaban {EXPECTED_COLUMN_COUNT} columnas, el CSV tiene {len(header)}'
        )
    for pos, expected in HEADER_SENTINELS.items():
        actual = header[pos].strip()
        if actual != expected:
            raise HeaderMismatch(
                f'columna {pos} esperada "{expected}", encontrada "{actual}" '
                '- el CSV puede haber cambiado de formato, revisar COL_* antes de continuar'
            )


# --- Normalizacion de valores individuales -----------------------------

def normalize_text(raw):
    v = raw.strip()
    return v if v else None


def normalize_quoted_text(raw):
    """Varios campos de texto vienen entre comillas simples literales
    ('0101220020000005', '' para vacio) - se despoja la comilla."""
    v = raw.strip()
    if len(v) >= 2 and v.startswith("'") and v.endswith("'"):
        v = v[1:-1].strip()
    return v if v else None


def normalize_dash_text(raw):
    """Un campo de texto que ademas usa '-' como placeholder de vacio
    (confirmado en Plano DGI, ~33% de las filas)."""
    v = raw.strip()
    if v in ('', '-'):
        return None
    return v


def parse_expediente(raw):
    """Formato NUMERO-CODIGO-ANIO (o NUMERO--ANIO sin codigo, ej.
    '69631--1966'). Verificado contra el CSV real: cuando NUMERO es '0'
    (1362 filas: 1302 en formato NUMERO--ANIO + 60 con codigo real, ej.
    '0--0', '0--2000', '0-OS-1974') es el mismo sin-dato generico usado
    en el resto del reporte para campos numericos - se nulifica el
    expediente completo. Un ANIO en 0 con NUMERO real (ej. '182167--0',
    4164 filas en total, la enorme mayoria con numero real) SI se
    conserva tal cual: no hay evidencia de que esos numeros de expediente
    sean invalidos, solo que no se registro el anio - inventar una regla
    para "limpiar" el sufijo "--0" ahi no tiene respaldo en los datos."""
    v = raw.strip()
    if not v:
        return None
    numero, sep, _resto = v.partition('-')
    if sep and numero == '0':
        return None
    return v


def parse_number(raw):
    """Numeros con separador de miles '.' y decimal ',' (formato del
    reporte). None si no es parseable."""
    v = raw.strip()
    if not v:
        return None
    v = v.replace('.', '').replace(',', '.')
    try:
        return float(v)
    except ValueError:
        return None


def clean_number(value):
    if value is None:
        return None
    if value == int(value):
        return int(value)
    return value


def normalize_number_zero_null(raw):
    """Regla estandar para campos numericos: 0 significa 'sin dato'. El
    sistema de origen nunca deja estos campos en blanco - siempre completa
    con 0 por defecto (verificado contra el CSV real: 0 filas en blanco en
    Nivel Estatico/Caudal/Coord. X-Y/toda la seccion de laboratorio, etc.)."""
    v = parse_number(raw)
    if v is None or v == 0:
        return None
    return clean_number(v)


def normalize_bool_si_no(raw):
    v = raw.strip().upper()
    if v == 'SI':
        return True
    if v == 'NO':
        return False
    return None


def parse_fecha(raw):
    v = raw.strip()
    if not v:
        return None
    try:
        return datetime.strptime(v, '%d/%m/%Y').date().isoformat()
    except ValueError:
        return None


def parse_aptitud(raw):
    """'5-APTA PARA RIEGO E INDUSTRIA.' -> 'Apta para riego e industria'.
    Codigo lider 0 ('0-NO DETERMINADA.', '0-') significa sin determinar."""
    v = raw.strip()
    if not v:
        return None
    code, _, rest = v.partition('-')
    if code.strip() == '0':
        return None
    text = rest.strip().rstrip('.').strip()
    return text.capitalize() if text else None


_TRAMO_RE = re.compile(r'^([\d.,]+)-([\d.,]+)\s*\(Diam\.([\d.,]+)\)$')


def parse_tramo(raw):
    """'190,00-220,00 (Diam.8,00)' -> {desde,hasta,diametro}. El tramo
    sentinela '0,00-0,00 (Diam.0,00)' (sin ese filtro/reduccion) -> None."""
    v = raw.strip()
    m = _TRAMO_RE.match(v)
    if not m:
        return None
    desde = parse_number(m.group(1))
    hasta = parse_number(m.group(2))
    diametro = parse_number(m.group(3))
    if not desde and not hasta:
        return None
    return {
        'desde': clean_number(desde),
        'hasta': clean_number(hasta),
        'diametro': clean_number(diametro),
    }


def parse_cementacion(estado_raw, desde_raw, hasta_raw):
    """Excepcion a la regla generica de 0=null: 'desde' puede ser un cero
    real (cementado desde la superficie) - pero solo cuando 'hasta' TAMBIEN
    es un valor real. Confirmado contra el CSV real: 1894 filas con
    desde=0, hasta>0 y estado no vacio. Si hasta tambien es 0 (como en un
    pozo NO CEMENTADO con ambos en 0), no hay evidencia de que desde=0 sea
    una medicion real y no el default generico del sistema - se nulifica
    igual que hasta."""
    estado = normalize_text(estado_raw)
    hasta = normalize_number_zero_null(hasta_raw)
    desde_val = parse_number(desde_raw)
    if desde_val is not None and desde_val != 0:
        desde = clean_number(desde_val)
    elif desde_val == 0 and hasta is not None:
        desde = 0
    else:
        desde = None
    if estado is None and desde is None and hasta is None:
        return None
    return {'estado': estado, 'desde': desde, 'hasta': hasta}


def parse_carbonatos(raw):
    """No es numerico: ademas de numeros trae texto de laboratorio (ATE,
    AUSENTE, NEGATIVO, VESTIGIOS, N/C...) - se conserva como string, nunca
    se fuerza a float."""
    v = raw.strip()
    if v in ('', '0', '0,00', '0.00'):
        return None
    return v


def parse_coordenadas(x_raw, y_raw):
    x = normalize_number_zero_null(x_raw)
    y = normalize_number_zero_null(y_raw)
    if x is None or y is None:
        return None
    return {'x': x, 'y': y}


# --- Construccion del wellId --------------------------------------------

def build_well_id(row):
    dep = row[COL_COD_DEPARTAMENTO].strip()
    pozo = row[COL_NRO_POZO].strip()
    try:
        dep_n = int(dep)
        pozo_n = int(pozo)
    except ValueError:
        return None
    return f'{dep_n:02d}-{pozo_n:04d}', dep_n


# --- Mapeo de una fila a los bloques del modelo --------------------------

def map_identificacion(row):
    return {
        'departamento': normalize_text(row[COL_DEPARTAMENTO]),
        'distrito': normalize_text(row[COL_DISTRITO]),
        'nomenclatura': normalize_quoted_text(row[COL_NOMENCLATURA]),
        'registroPerforacion': normalize_text(row[COL_REGISTRO_PERFORACION]),
        'nic': normalize_dash_text(row[COL_NIC]) if row[COL_NIC].strip() not in ('', '0') else None,
    }


def map_titularidad(row):
    return {
        'titular': normalize_text(row[COL_PERSONA]),
        'expediente': parse_expediente(row[COL_EXPEDIENTE]),
        'declaracionJurada': normalize_bool_si_no(row[COL_DECL_JURADA]),
        'domicilioTitular': normalize_text(row[COL_DOMICILIO_TIT_PRINCIPAL]),
        'domicilioPostal': normalize_text(row[COL_DOMICILIO_POSTAL]),
        'organismo': normalize_text(row[COL_ORGANISMO]),
        'familia': normalize_text(row[COL_FAMILIA]),
    }


def map_uso_concesion(row):
    return {
        'uso': normalize_text(row[COL_USO]),
        'usoSecundario': normalize_text(row[COL_USO_SECUNDARIO]),
        'superficieOrigen': normalize_number_zero_null(row[COL_SUP_ORIGEN]),
        'superficieConcesion': normalize_number_zero_null(row[COL_SUP_CONCESION]),
        'hectareasFactibles': normalize_number_zero_null(row[COL_HECTAREAS_FACTIBLES]),
        'enProcesoCaducidad': normalize_quoted_text(row[COL_CADUCIDAD]) is not None,
        'resolucionConcesion': normalize_quoted_text(row[COL_CONCES]),
    }


def map_tecnicas(row):
    return {
        'profundidadTotal': normalize_number_zero_null(row[COL_PROFUNDIDAD_TOTAL]),
        'diametroEntubacion': normalize_number_zero_null(row[COL_DIAMETRO_ENTUBACION]),
        'diametroBomba': normalize_number_zero_null(row[COL_DIAMETRO_BOMBA]),
        'profundidadBomba': normalize_number_zero_null(row[COL_PROFUNDIDAD_BOMBA]),
        'diametroAntepozo': normalize_number_zero_null(row[COL_DIAMETRO_ANTEPOZO]),
        'profundidadAntepozo': normalize_number_zero_null(row[COL_PROFUNDIDAD_ANTEPOZO]),
        'nivelEstatico': normalize_number_zero_null(row[COL_NIVEL_ESTATICO]),
        'caudal': normalize_number_zero_null(row[COL_CAUDAL]),
        'depresion': normalize_number_zero_null(row[COL_DEPRESION]),
        'potencia': normalize_number_zero_null(row[COL_POTENCIA]),
        'indicePromedio': normalize_number_zero_null(row[COL_INDICE_PROMEDIO]),
        'surgencia': normalize_text(row[COL_SURGENCIA]),
        'aptitud': parse_aptitud(row[COL_APTITUD]),
        'riegoSuperficial': normalize_bool_si_no(row[COL_RIEGO_SUPERFICIAL]),
        'perfilaje': normalize_bool_si_no(row[COL_PERFILAJE]),
    }


def map_construccion(row):
    filtros = [parse_tramo(row[i]) for i in (COL_FILTRO_1, COL_FILTRO_2, COL_FILTRO_3, COL_FILTRO_4, COL_FILTRO_5)]
    reducciones = [parse_tramo(row[i]) for i in (COL_REDUCCION_1, COL_REDUCCION_2, COL_REDUCCION_3)]
    return {
        'fecha': parse_fecha(row[COL_FECHA_EJECUCION]),
        'empresa': normalize_text(row[COL_EMPRESA]),
        'directorTecnico': normalize_text(row[COL_DIRECTOR_TECNICO]),
        'mecanismoBomba': normalize_text(row[COL_MECANISMO_BOMBA]),
        'cementacion': parse_cementacion(row[COL_CEMENTACION], row[COL_CEMENTACION_DESDE], row[COL_CEMENTACION_HASTA]),
        'filtros': [f for f in filtros if f is not None],
        'reducciones': [r for r in reducciones if r is not None],
    }


def map_ubicacion(row):
    return {
        'domicilioPozo': normalize_text(row[COL_DOMICILIO_REAL]),
        'coordenadas': parse_coordenadas(row[COL_COORD_X], row[COL_COORD_Y]),
        'planoDgi': normalize_dash_text(row[COL_PLANO_DGI]),
        'planoCatastro': normalize_dash_text(row[COL_PLANO_CATASTRO]),
    }


def map_estado(row):
    situacion = normalize_text(row[COL_ESTADO])
    baja = None
    if situacion == 'Baja':
        baja = {
            'fecha': parse_fecha(row[COL_FECHA_BAJA_REAL]),
            'fechaContable': parse_fecha(row[COL_FECHA_BAJA_CTACTE]),
            'motivo': normalize_text(row[COL_MOTIVO_BAJA]),
            'expediente': normalize_text(row[COL_EXPEDIENTE_BAJA]),
        }
    return {
        'situacion': situacion,
        'baja': baja,
        'estadoObra': normalize_text(row[COL_ESTADO_OBRA]),
        'cegado': normalize_text(row[COL_CEGADO]),
    }


def map_comentarios(row):
    return {
        'comentario': normalize_text(row[COL_COMENTARIO]),
        'documentacionFaltante': normalize_text(row[COL_DOCUM_FALTANTE]),
    }


def map_analisis(row):
    """None si la fila no trae ningun dato de laboratorio (la mayoria de
    los pozos con un solo analisis, o ninguno)."""
    analisis = {
        'laboratorio': normalize_text(row[COL_LABORATORIO]),
        'nroAnalisis': normalize_dash_text(row[COL_NRO_ANALISIS]) if row[COL_NRO_ANALISIS].strip() not in ('', '0') else None,
        'ph': normalize_number_zero_null(row[COL_VALOR_PH]),
        'durezaTotal': normalize_number_zero_null(row[COL_DUREZA_TOTAL]),
        'durezaPermanente': normalize_number_zero_null(row[COL_DUREZA_PEM]),
        'durezaTemporal': normalize_number_zero_null(row[COL_DUREZA_TEMP]),
        'conductividad': normalize_number_zero_null(row[COL_CONDUCTIVIDAD]),
        'calcio': normalize_number_zero_null(row[COL_CALCIO]),
        'magnesio': normalize_number_zero_null(row[COL_MAGNESIO]),
        'sodio': normalize_number_zero_null(row[COL_SODIO]),
        'potasio': normalize_number_zero_null(row[COL_POTASIO]),
        'cloruros': normalize_number_zero_null(row[COL_CLORUROS]),
        'sulfatos': normalize_number_zero_null(row[COL_SULFATOS]),
        'bicarbonatos': normalize_number_zero_null(row[COL_BICARBONATOS]),
        'carbonatos': parse_carbonatos(row[COL_CARBONATOS]),
        'residuos': normalize_number_zero_null(row[COL_RESIDUOS]),
        'residuoSeco': normalize_number_zero_null(row[COL_RESIDUO_SECO]),
        'nitratos': normalize_number_zero_null(row[COL_NITRATOS]),
        'nitritos': normalize_number_zero_null(row[COL_NITRITOS]),
        'silice': normalize_number_zero_null(row[COL_SILICE]),
        'amoniaco': normalize_number_zero_null(row[COL_AMONIACO]),
        'csr': normalize_text(row[COL_CSR]),
        'diagRiever': normalize_text(row[COL_DIAG_RIEVER]),
        'coefAlcalinidad': normalize_number_zero_null(row[COL_COEF_ALCAL]),
        'ras': normalize_number_zero_null(row[COL_RAS]),
        'rasp': normalize_number_zero_null(row[COL_RASP]),
        'indiceKelle': normalize_number_zero_null(row[COL_INDICE_KELLE]),
    }
    if all(v is None for v in analisis.values()):
        return None
    return analisis


def map_record(well_id, row):
    return {
        'wellId': well_id,
        'identificacion': map_identificacion(row),
        'titularidad': map_titularidad(row),
        'usoConcesion': map_uso_concesion(row),
        'tecnicas': map_tecnicas(row),
        'construccion': map_construccion(row),
        'ubicacion': map_ubicacion(row),
        'estado': map_estado(row),
        'laboratorio': {'analisis': []},
        'comentarios': map_comentarios(row),
    }


# --- Deduplicacion --------------------------------------------------------

def dedupe_exact_rows(rows):
    """Filas byte-a-byte identicas (mismo wellId, TODOS los campos iguales,
    incluido laboratorio) - se conserva una sola. Devuelve (filas, cantidad
    eliminada)."""
    seen = set()
    out = []
    removed = 0
    for r in rows:
        key = tuple(r)
        if key in seen:
            removed += 1
            continue
        seen.add(key)
        out.append(r)
    return out, removed


def non_lab_signature(row):
    return tuple(v for i, v in enumerate(row) if not (LAB_COL_START <= i <= LAB_COL_END))


def group_rows_by_well_id(rows, warnings):
    groups = {}
    for row in rows:
        result = build_well_id(row)
        if result is None:
            warnings.append(f'fila con Cod. Departamento/Nro Pozo no numerico, se omite: {row[:2]!r}')
            continue
        well_id, dep_n = result
        if not (1 <= dep_n <= 19):
            warnings.append(f'wellId {well_id} con departamento fuera de 01-19, se omite')
            continue
        groups.setdefault(well_id, []).append(row)
    return groups


def build_records(groups, warnings):
    """Une cada grupo (1 o mas filas por wellId) en un unico registro, con
    todos los analisis de laboratorio distintos conservados en el array."""
    records = {}
    multi_analysis_count = 0
    for well_id, rows in groups.items():
        base_row = rows[0]
        if len(rows) > 1:
            sig0 = non_lab_signature(base_row)
            for r in rows[1:]:
                if non_lab_signature(r) != sig0:
                    warnings.append(
                        f'wellId {well_id}: filas duplicadas difieren en campos no-laboratorio, '
                        'se usan los del primero encontrado'
                    )
                    break

        record = map_record(well_id, base_row)
        analyses = []
        for r in rows:
            a = map_analisis(r)
            if a is not None and a not in analyses:
                analyses.append(a)
        record['laboratorio']['analisis'] = analyses
        if len(analyses) > 1:
            multi_analysis_count += 1
        records[well_id] = record
    return records, multi_analysis_count


# --- Metadata --------------------------------------------------------------

_PERIODO_RE = re.compile(r'(\d{2})_(\d{4})')


def parse_periodo_from_filename(filename, warnings):
    m = _PERIODO_RE.search(filename)
    if not m:
        warnings.append(
            f'no se pudo determinar el periodo desde el nombre de archivo "{filename}" '
            '(se esperaba algo como "MM_AAAA"); metadata.periodo queda null'
        )
        return None
    mes, anio = m.group(1), m.group(2)
    return f'{anio}-{mes}'


def build_metadata(csv_path, total_rows_source, records, exact_dupes_removed, multi_analysis_count, warnings, partitioned_deps, partition_threshold):
    departamentos = Counter(well_id[:2] for well_id in records)
    return {
        'generadoEl': datetime.now(timezone.utc).astimezone().isoformat(timespec='seconds'),
        'fuente': {
            'archivo': Path(csv_path).name,
            'periodo': parse_periodo_from_filename(Path(csv_path).name, warnings),
            'filasFuente': total_rows_source,
        },
        'pozosUnicos': len(records),
        'duplicadosExactosEliminados': exact_dupes_removed,
        'wellIdsConMultiplesAnalisis': multi_analysis_count,
        'departamentos': {f'{d:02d}': departamentos.get(f'{d:02d}', 0) for d in range(1, 20)},
        'departamentosParticionados': sorted(partitioned_deps),
        'umbralParticionado': partition_threshold,
    }


# --- Pipeline principal -----------------------------------------------------

def read_csv_rows(csv_path):
    with open(csv_path, encoding='ISO-8859-1', newline='') as f:
        reader = csv.reader(f, delimiter=';')
        header = next(reader)
        rows = list(reader)
    return header, rows


def _write_json(path, data):
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=None, separators=(',', ':'), sort_keys=True)


def reindex(csv_path, out_dir, partition_threshold=PARTITION_THRESHOLD):
    warnings = []
    header, rows = read_csv_rows(csv_path)
    validate_header(header)

    total_rows_source = len(rows)
    rows, exact_dupes_removed = dedupe_exact_rows(rows)
    groups = group_rows_by_well_id(rows, warnings)
    records, multi_analysis_count = build_records(groups, warnings)

    dep_counts = Counter(well_id[:2] for well_id in records)
    partitioned_deps = {dep_str for dep_str, count in dep_counts.items() if count > partition_threshold}

    metadata = build_metadata(
        csv_path, total_rows_source, records, exact_dupes_removed,
        multi_analysis_count, warnings, partitioned_deps, partition_threshold,
    )

    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    for dep in range(1, 20):
        dep_str = f'{dep:02d}'
        dep_records = {wid: rec for wid, rec in records.items() if wid[:2] == dep_str}

        if dep_str in partitioned_deps:
            for digit in '0123456789':
                bucket = {wid: rec for wid, rec in dep_records.items() if wid[3] == digit}
                _write_json(out_dir / f'{dep_str}-{digit}.json', bucket)
        else:
            _write_json(out_dir / f'{dep_str}.json', dep_records)

    with open(out_dir / 'metadata.json', 'w', encoding='utf-8') as f:
        json.dump(metadata, f, ensure_ascii=False, indent=2, sort_keys=True)

    return metadata, warnings


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('csv_path', help='Reporte de Pozos exportado (CSV, ISO-8859-1, ";")')
    parser.add_argument('--out', default='scripts/out/registro', help='directorio de salida (default: scripts/out/registro)')
    args = parser.parse_args(argv)

    try:
        metadata, warnings = reindex(args.csv_path, args.out)
    except HeaderMismatch as e:
        print(f'ERROR: el CSV no tiene la forma esperada: {e}', file=sys.stderr)
        return 1

    print(f'OK - {metadata["pozosUnicos"]} pozos unicos en {args.out}/')
    print(f'  fuente: {metadata["fuente"]["archivo"]} (periodo {metadata["fuente"]["periodo"]}, {metadata["fuente"]["filasFuente"]} filas)')
    print(f'  duplicados exactos eliminados: {metadata["duplicadosExactosEliminados"]}')
    print(f'  wellId con mas de un analisis de laboratorio: {metadata["wellIdsConMultiplesAnalisis"]}')
    print(f'  por departamento: {metadata["departamentos"]}')
    if metadata['departamentosParticionados']:
        print(f'\n  Departamentos particionados (>{metadata["umbralParticionado"]} pozos): {metadata["departamentosParticionados"]}')
        print('  IMPORTANTE: si esta lista cambio respecto a la corrida anterior, actualizar')
        print('  PARTITIONED_DEPARTMENTS en backend/src/RegistryRepository.js a mano antes de subir')
        print('  los archivos nuevos a Drive - el backend no lee ningun indice para saber esto.')
    else:
        print('\n  Ningun departamento supero el umbral de particionado.')
    if warnings:
        print(f'\n{len(warnings)} advertencia(s):', file=sys.stderr)
        for w in warnings:
            print(f'  - {w}', file=sys.stderr)
    return 0


if __name__ == '__main__':
    sys.exit(main())
