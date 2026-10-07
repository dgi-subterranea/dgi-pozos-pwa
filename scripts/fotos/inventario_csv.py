#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Inventario POR ARCHIVO de las fotos historicas (CSV + resumen). SOLO LECTURA y LOCAL.

No lee, mueve, renombra, sube ni modifica ninguna foto: parte de los resultados que ya generaron inventariar.py (SHA-1,
EXIF, tamano, fechas del archivo) y clasificar.py (vinculo con el padron / red NE, fecha, duplicados), todos en
scripts/out/fotos/ (ignorado por git). Escribe en esa misma carpeta:

    inventario_por_archivo.csv   una fila por archivo del arbol (fotos y archivos que no lo son)   [PRIVADO: trae rutas/nombres]
    resumen_inventario.json      agregados sin nombres de archivo

Uso (desde la raiz del repo, despues de inventariar.py y clasificar.py):
    python scripts/fotos/inventario_csv.py

Categoria de asociacion con el pozo (se valida SIEMPRE contra padron U red NE; un id inexistente nunca se inventa):
    MATCH_EXACTO    un unico patron 'DD NNNN' inequivoco entre las copias, el pozo existe y no hay conflicto
    MATCH_PROBABLE  el nombre no trae el id pero apunta a UN solo punto de la red NE (INA / numero de monitoreo): nunca se confirma solo
    AMBIGUO         ids en conflicto entre copias, GPS que contradice al id, o varios puntos NE posibles
    SIN_MATCH       sin id en el nombre, o el id del nombre no existe en el padron ni en la red NE
    (EXCLUIDA)      cuadro negro/plano/marcador: no es una foto del pozo (se informa aparte)
Fecha: EXIF valido > carpeta > anio del nombre > fecha del archivo (solo como ultimo recurso, marcada BAJA) > sin_fecha.
"""
import collections
import csv
import datetime as dt
import json
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fotos_comun as C  # noqa: E402

COLUMNAS = [
    'ruta_relativa', 'nombre_original', 'extension', 'tamano_bytes', 'mtime_archivo', 'fecha_exif', 'ancho', 'alto',
    'fuente', 'tipo_foto_candidato', 'wellId_candidato', 'metodo_wellId', 'validado_contra', 'categoria_match', 'confianza',
    'fecha_candidata', 'precision_fecha', 'metodo_fecha', 'fecha_confiable', 'sha1', 'copias_del_contenido',
    'copia_canonica', 'fotoId', 'estado_migrabilidad', 'observacion',
]

NO_FOTO_EXT = ('.thm',)          # miniaturas de video: contenido JPEG, no son fotos


def categoria_match(rec):
    """Categoria de asociacion (ver docstring) y metodo, a partir del registro ya clasificado."""
    motivos = set(rec['motivos'])
    if rec['estado'] == C.ESTADO_CONFIRMADO:
        return 'MATCH_EXACTO'
    if rec['estado'] == C.ESTADO_EXCLUIDA:
        return 'EXCLUIDA'
    if motivos == {'FECHA_SOSPECHOSA'}:
        return 'MATCH_EXACTO'               # el pozo esta bien identificado; lo dudoso es solo la fecha
    if 'ID_CONFLICTO' in motivos or 'GPS_LEJOS' in motivos:
        return 'AMBIGUO'
    if 'ID_AMBIGUO_INA_MON' in motivos:
        sug = (rec.get('indicioMonitoreo') or {}).get('sugerencias') or []
        return 'MATCH_PROBABLE' if len(sug) == 1 else 'AMBIGUO'
    return 'SIN_MATCH'                       # SIN_ID, ID_FUERA_PADRON


def clase_nombre(base, deptos):
    """Patron del nombre SIN datos personales (para describir la convencion y contarla)."""
    if C.RE_ID.match(base):
        resto = base[C.RE_ID.match(base).end():]
        if re.search(r'_(Cerca|Pano)_', base, re.I):
            return 'DD NNNN_<Cerca|Pano>_<anio> (Monitoreo)'
        if re.fullmatch(r'\s*(\(\d+\))?\.\w+', resto):
            return 'DD NNNN.ext (solo el id)'
        if re.search(r'[A-Za-zÀ-ÿ]{3,}', resto):
            return 'DD NNNN <apellido/nombre/lugar>.ext'
        return 'DD NNNN <otro sufijo>.ext'
    if re.match(r'^INA\s*\d+_', base, re.I):
        return 'INA nnn_<Cerca|Pano>_<anio> (Monitoreo)'
    if re.match(r'^(?:Mon)?0*\d{1,3}_(?:Cerca|Pano)_', base, re.I):
        return 'nnn_<Cerca|Pano>_<anio> (Monitoreo sin departamento)'
    if re.match(r'^(IMG|DSC|DSCN|DSCF|P|PHOTO|PICT|SAM|IMAG)[_-]?\d+', base, re.I):
        return 'IMG_nnnn / DSC_nnnn (nombre de camara)'
    if re.match(r'^(19|20)\d{6}[_-]\d{4,6}', base):
        return 'AAAAMMDD_HHMMSS (marca de tiempo del celular)'
    if re.search(r'[A-Za-zÀ-ÿ]{3,}', base):
        return 'solo texto (sin id)'
    return 'otro'


def construir(base_dir):
    base = Path(base_dir)
    inv = json.loads((base / 'inventario.json').read_text(encoding='utf-8'))
    corpus = json.loads((base / 'corpus.json').read_text(encoding='utf-8'))
    refs = C.cargar_referencias()
    por_sha = {r['sha1']: r for r in corpus}
    filas, patrones, ext_cont = [], collections.Counter(), collections.Counter()

    for a in inv['archivos']:
        ruta = a['ruta'].replace('\\', '/')
        nombre = ruta.split('/')[-1]
        ext = os.path.splitext(nombre)[1].lower()
        ex = a.get('exif') or {}
        rec = por_sha.get(a['sha1'])
        mtime = dt.datetime.fromtimestamp(a['mtime'] / 1000.0).isoformat(timespec='seconds') if a.get('mtime') else ''
        fila = dict.fromkeys(COLUMNAS, '')
        fila.update({
            'ruta_relativa': ruta, 'nombre_original': nombre, 'extension': ext, 'tamano_bytes': a['tam'], 'mtime_archivo': mtime,
            'fecha_exif': ex.get('fechaOriginal') or '', 'ancho': ex.get('ancho') or '', 'alto': ex.get('alto') or '',
            'fuente': C.fuente_de(ruta), 'sha1': a['sha1'],
        })
        if ext in NO_FOTO_EXT or rec is None:
            fila.update({'estado_migrabilidad': 'NO_ES_FOTO', 'observacion': 'miniatura de video (.thm)' if ext in NO_FOTO_EXT else 'sin registro clasificado'})
            filas.append(fila)
            continue
        base_nombre = nombre
        propio = C.id_de_nombre(base_nombre, refs.deptos)
        categoria = categoria_match(rec)
        if propio:
            metodo = 'NOMBRE_ARCHIVO'
        elif rec.get('wellId'):
            metodo = 'NOMBRE_DE_OTRA_COPIA'                       # el id sale del nombre de una copia identica en otra carpeta
        elif categoria == 'MATCH_PROBABLE':
            metodo = 'SUGERENCIA_RED_NE'
        else:
            metodo = 'SIN_ID' if categoria != 'AMBIGUO' else 'IDS_EN_CONFLICTO'
        well = rec.get('wellId') or propio or ''
        if categoria == 'MATCH_PROBABLE':
            well = ((rec.get('indicioMonitoreo') or {}).get('sugerencias') or [''])[0]
        f = rec['fecha']
        confiable = {'EXIF': 'ALTA', 'CARPETA': 'ALTA', 'NOMBRE_ANIO': 'MEDIA', 'ARCHIVO': 'BAJA'}.get(f['fuente'], 'NO')
        canonica = rec['copias'][0].replace('\\', '/') == ruta
        if rec['estado'] == C.ESTADO_EXCLUIDA:
            migr = 'EXCLUIDA_SIN_CONTENIDO'
        elif not canonica:
            migr = 'COPIA_DUPLICADA'                              # se importa UNA vez por contenido (la canonica)
        elif rec['estado'] == C.ESTADO_CONFIRMADO:
            migr = 'MIGRABLE'
        else:
            migr = 'MIGRABLE_TRAS_REVISION'
        obs = sorted(set(rec['flags']) | set(f.get('flags') or []) | set(rec['motivos']))
        fila.update({
            'tipo_foto_candidato': rec['tipoFoto'], 'wellId_candidato': well, 'metodo_wellId': metodo,
            'validado_contra': rec.get('fuenteValidacionId') or '', 'categoria_match': categoria, 'confianza': rec.get('confianza') or '',
            'fecha_candidata': f['valor'] or 'sin_fecha', 'precision_fecha': f['precision'], 'metodo_fecha': f['fuente'] or 'SIN_FECHA',
            'fecha_confiable': confiable, 'copias_del_contenido': rec['nCopias'], 'copia_canonica': 'SI' if canonica else 'NO',
            'fotoId': C.foto_id(a['sha1']), 'estado_migrabilidad': migr, 'observacion': ';'.join(obs),
        })
        patrones[clase_nombre(nombre, refs.deptos)] += 1
        filas.append(fila)

    for n in inv['noImagenes']:
        ruta = n['ruta'].replace('\\', '/')
        fila = dict.fromkeys(COLUMNAS, '')
        fila.update({'ruta_relativa': ruta, 'nombre_original': ruta.split('/')[-1], 'extension': os.path.splitext(ruta)[1].lower(),
                     'tamano_bytes': n['tam'], 'fuente': C.fuente_de(ruta), 'estado_migrabilidad': 'NO_ES_FOTO', 'observacion': 'no es una imagen'})
        filas.append(fila)
    return filas, inv, corpus, patrones


def resumen(filas, inv, corpus, patrones):
    n = collections.Counter
    fotos = [f for f in filas if f['estado_migrabilidad'] != 'NO_ES_FOTO']
    unicos = [r for r in corpus]
    nombres_utiles = lambda lista: sorted(lista.items(), key=lambda kv: -kv[1])
    res = collections.OrderedDict()
    res['archivosEnElArbol'] = len(filas)
    res['archivosQueSonFotos'] = len(fotos)
    res['archivosQueNoSonFotos'] = {'total': len(filas) - len(fotos), 'porExtension': dict(n(f['extension'] for f in filas if f['estado_migrabilidad'] == 'NO_ES_FOTO'))}
    res['contenidosUnicos'] = len(unicos)
    res['porExtension'] = dict(n(f['extension'] for f in fotos))
    res['porFuente'] = {'archivos': dict(n(f['fuente'] for f in fotos)), 'contenidosUnicos': dict(n(r['fuente'] for r in unicos))}
    res['carpetas'] = nombres_utiles(n('/'.join(f['ruta_relativa'].split('/')[:-1]) for f in fotos))
    res['categoriaMatch'] = {'archivos': dict(n(f['categoria_match'] for f in fotos)),
                             'contenidosUnicos': dict(n(categoria_match(r) for r in unicos))}
    res['estadoMigrabilidad'] = dict(n(f['estado_migrabilidad'] for f in fotos))
    res['estadoPipeline'] = dict(n(r['estado'] for r in unicos))
    res['motivosDeRevision'] = dict(n(m for r in unicos for m in r['motivos']))
    res['metodoWellId'] = dict(n(f['metodo_wellId'] for f in fotos))
    res['validadoContra'] = dict(n(r.get('fuenteValidacionId') or 'NINGUNA' for r in unicos if r['estado'] == C.ESTADO_CONFIRMADO))
    res['fecha'] = {
        'metodoContenidosUnicos': dict(n(r['fecha']['fuente'] or 'SIN_FECHA' for r in unicos)),
        'precisionContenidosUnicos': dict(n(r['fecha']['precision'] for r in unicos)),
        'confiableArchivos': dict(n(f['fecha_confiable'] for f in fotos)),
        'conFechaExifEnElArchivo': sum(1 for f in fotos if f['fecha_exif']),
        'anios': dict(sorted(n((r['fecha']['valor'] or 'sin_fecha')[:4] for r in unicos).items())),
    }
    res['metadatos'] = {
        'archivosConFechaExif': sum(1 for f in fotos if f['fecha_exif']),
        'archivosConDimensiones': sum(1 for f in fotos if f['ancho'] and f['alto']),
        'contenidosConGps': sum(1 for r in unicos if r.get('gps')),
        'gpsEstado': dict(n(r['gpsEstado'] for r in unicos)),
        'camaras': nombres_utiles(n((r.get('camara') or '(sin dato)') for r in unicos))[:8],
    }
    por_contenido = n(f['sha1'] for f in fotos)
    grupos = [c for c in por_contenido.values() if c > 1]
    carpetas_por_sha = collections.defaultdict(list)
    for f in fotos:
        carpetas_por_sha[f['sha1']].append('/'.join(f['ruta_relativa'].split('/')[:-1]))
    nombres_por_sha = collections.defaultdict(set)
    for f in fotos:
        nombres_por_sha[f['sha1']].add(f['nombre_original'].lower())
    res['duplicados'] = {
        'contenidosConMasDeUnaCopia': len(grupos),
        'copiasSobrantes': sum(c - 1 for c in grupos),
        'distribucionCopias': dict(sorted(n(min(c, 6) for c in por_contenido.values()).items())),
        'contenidosCopiadosDentroDeLaMismaCarpeta': sum(1 for s, cs in carpetas_por_sha.items() if len(cs) != len(set(cs))),
        'contenidosConNombresDistintosEntreCopias': sum(1 for s, ns in nombres_por_sha.items() if len(ns) > 1),
        'contenidosConIdsEnConflicto': sum(1 for r in unicos if 'ID_CONFLICTO' in r['motivos']),
        'duplicadosVisualesDetectados': 'no se calculan (solo duplicados exactos por SHA-1)',
    }
    res['convencionDeNombres'] = nombres_utiles(patrones)
    res['problemas'] = {
        'flagsContenidosUnicos': dict(n(fl for r in unicos for fl in set(r['flags']) | set(r['fecha'].get('flags') or []))),
        'excluidasSinContenido': sum(1 for r in unicos if r['estado'] == C.ESTADO_EXCLUIDA),
        'archivosConExtensionPNG': sum(1 for f in fotos if f['extension'] == '.png'),
        'formatoRealPorContenido': dict(n(r['formato'] for r in unicos)),
        'pesoTotalOriginalesUnicosMB': round(sum(r['tam'] for r in unicos) / 1048576.0),
        'pesoTotalArbolMB': round(sum(int(f['tamano_bytes'] or 0) for f in filas) / 1048576.0),
    }
    return res


def main():
    base = C.OUT_FOTOS
    filas, inv, corpus, patrones = construir(base)
    with open(str(base / 'inventario_por_archivo.csv'), 'w', encoding='utf-8-sig', newline='') as f:
        w = csv.DictWriter(f, fieldnames=COLUMNAS, delimiter=';', lineterminator='\r\n')
        w.writeheader()
        w.writerows(filas)
    res = resumen(filas, inv, corpus, patrones)
    (base / 'resumen_inventario.json').write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding='utf-8')
    print(json.dumps(res, ensure_ascii=False, indent=1))
    print('\nCSV por archivo (PRIVADO): %s  (%d filas)' % (base / 'inventario_por_archivo.csv', len(filas)))


if __name__ == '__main__':
    main()
