#!/usr/bin/env python3
"""Reconciliacion de SOLO LECTURA entre la hoja FotosPozos (export CSV) y la evidencia local de la importacion.

No modifica la hoja, ni el storage, ni scripts/out: solo lee y escribe un reporte nuevo.

Universo esperado = filas de los `staging_FotosPozosImport.csv` de los lotes (piloto30, validacion100, produccion500,
produccion_final) cuyo ultimo estado en `estado_subida.jsonl` es SUBIDA o YA_EXISTE. Se contrasta contra el CSV exportado de la hoja:

    python scripts/fotos/reconciliar_hoja.py --hoja scripts/out/fotos/FotosPozos_actual.csv

El reporte NO incluye e-mails ni ids de Drive (solo cantidades y fotoId). No corrige nada.
"""
import argparse
import csv
import io
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

LOTES = ['piloto30', 'validacion100', 'produccion500', 'produccion_final']
UUID = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', re.I)
WELL = re.compile(r'^\d{2}-\d{4}$')
OK_SUBIDA = ('SUBIDA', 'YA_EXISTE')


def leer_csv(texto):
    """Lee un CSV (coma o punto y coma) -> lista de dicts. Sin interpretar tipos."""
    muestra = texto[:4096]
    delim = ';' if muestra.split('\n', 1)[0].count(';') > muestra.split('\n', 1)[0].count(',') else ','
    return list(csv.DictReader(io.StringIO(texto, newline=''), delimiter=delim))


def leer_archivo_csv(ruta):
    return leer_csv(Path(ruta).read_text(encoding='utf-8-sig'))


def estados_subida(ruta):
    """Ultimo estado por fotoId de un estado_subida.jsonl (append-only)."""
    ultimo = {}
    if not Path(ruta).exists():
        return ultimo
    for linea in Path(ruta).read_text(encoding='utf-8').splitlines():
        if not linea.strip():
            continue
        r = json.loads(linea)
        ultimo[str(r.get('fotoId', '')).lower()] = r.get('estado')
    return ultimo


def universo_esperado(raiz, lotes=LOTES):
    """{fotoId: fila de staging + lote} de lo que la evidencia local dice que esta subido al storage."""
    esperado = {}
    detalle = {}
    for lote in lotes:
        base = Path(raiz) / lote
        filas = leer_archivo_csv(base / 'staging_FotosPozosImport.csv') if (base / 'staging_FotosPozosImport.csv').exists() else []
        estados = estados_subida(base / 'estado_subida.jsonl')
        ok = 0
        for f in filas:
            fid = f['fotoId'].lower()
            if estados.get(fid) in OK_SUBIDA:
                if fid in esperado:
                    detalle.setdefault('repetidos_entre_lotes', []).append(fid)
                esperado[fid] = dict(f, _lote=lote)
                ok += 1
        detalle[lote] = {'staging': len(filas), 'subidas_confirmadas': ok, 'estados': dict(Counter(estados.values()))}
    return esperado, detalle


def reconciliar(hoja, esperado):
    r = {}
    r['filas_totales'] = len(hoja)
    ids = [h['fotoId'].strip().lower() for h in hoja]
    r['filas_con_fotoId_valido'] = sum(1 for i in ids if UUID.match(i))
    r['filas_sin_fotoId_valido'] = [i for i in ids if not UUID.match(i)][:20]
    cnt = Counter(ids)
    r['fotoId_duplicados'] = {k: v for k, v in cnt.items() if v > 1}
    r['por_fuente'] = dict(Counter(h['fuente'] for h in hoja))
    r['por_lote'] = dict(Counter(h.get('loteImportacion', '') for h in hoja))
    r['por_estado'] = dict(Counter(h['estado'] for h in hoja))
    r['por_estadoVinculo'] = dict(Counter(h['estadoVinculo'] for h in hoja))
    r['importadas_emailUsuarioCarga_IMPORTACION'] = sum(1 for h in hoja if h.get('emailUsuarioCarga') == 'IMPORTACION')
    r['CAMPO_APP'] = sum(1 for h in hoja if h['fuente'] == 'CAMPO_APP')
    # entidad invalida: exactamente una de wellId / monitoringId, y wellId con formato DD-DDDD
    invalidas = []
    for h in hoja:
        w, m = h.get('wellId', '').strip(), h.get('monitoringId', '').strip()
        if (bool(w) == bool(m)) or (w and not WELL.match(w)):
            invalidas.append(h['fotoId'])
    r['entidad_invalida'] = invalidas[:50]
    r['entidad_invalida_total'] = len(invalidas)
    # duplicados por contenido en la misma entidad
    por_contenido = defaultdict(list)
    for h in hoja:
        sha = h.get('sha1Original', '').strip().lower()
        if sha:
            por_contenido[(sha, h.get('wellId') or h.get('monitoringId'))].append(h['fotoId'])
    r['sha1_duplicados_misma_entidad'] = {f'{k[0]}@{k[1]}': v for k, v in por_contenido.items() if len(v) > 1}
    drive = Counter(h.get('driveFileId', '').strip() for h in hoja if h.get('driveFileId', '').strip())
    r['driveFileId_duplicados'] = sum(1 for v in drive.values() if v > 1)
    r['filas_sin_driveFileId'] = sum(1 for h in hoja if not h.get('driveFileId', '').strip())
    # contraste con el universo esperado
    en_hoja = set(ids)
    esp = set(esperado)
    presentes = esp & en_hoja
    faltantes = sorted(esp - en_hoja)
    r['esperadas_en_storage'] = len(esp)
    r['esperadas_presentes_en_hoja'] = len(presentes)
    r['esperadas_faltantes_en_hoja'] = len(faltantes)
    r['faltantes_por_lote'] = dict(Counter(esperado[f]['_lote'] for f in faltantes))
    r['faltantes_muestra'] = faltantes[:30]
    # filas de la hoja fuera del universo esperado, clasificadas
    fuera = [h for h in hoja if h['fotoId'].strip().lower() not in esp]
    r['filas_fuera_del_universo'] = len(fuera)
    r['fuera_por_fuente'] = dict(Counter(h['fuente'] for h in fuera))
    r['fuera_por_lote'] = dict(Counter(h.get('loteImportacion', '') for h in fuera))
    r['fuera_IMPORTACION'] = [h['fotoId'] for h in fuera if h.get('emailUsuarioCarga') == 'IMPORTACION'][:50]
    # coherencia de las presentes con staging
    dif = Counter()
    por_id = {h['fotoId'].strip().lower(): h for h in hoja}
    for fid in presentes:
        h, s = por_id[fid], esperado[fid]
        for campo in ('wellId', 'monitoringId', 'fuente', 'sha1Original', 'driveFileId', 'driveThumbId', 'estadoVinculo', 'estado', 'fechaFotoValor', 'fechaFotoPrecision'):
            if (h.get(campo, '') or '').strip() != (s.get(campo, '') or '').strip():
                dif[campo] += 1
    r['presentes_con_diferencias_vs_staging'] = dict(dif)
    r['presentes_ACTIVA_CONFIRMADO'] = sum(1 for fid in presentes if por_id[fid]['estado'] == 'ACTIVA' and por_id[fid]['estadoVinculo'] == 'CONFIRMADO')
    return r


def texto(rep, detalle):
    out = ['RECONCILIACION FotosPozos (solo lectura)', '']
    out.append('Evidencia local por lote:')
    for lote in LOTES:
        d = detalle.get(lote)
        if d:
            out.append(f"  {lote}: staging={d['staging']} subidas_confirmadas={d['subidas_confirmadas']} estados={d['estados']}")
    out.append(f"  repetidos entre lotes: {len(detalle.get('repetidos_entre_lotes', []))}")
    out.append('')
    for k, v in rep.items():
        out.append(f'{k}: {v}')
    return '\n'.join(out) + '\n'


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--hoja', required=True, help='CSV exportado de la hoja FotosPozos (privado; no se copia al repo)')
    ap.add_argument('--raiz', default='scripts/out/fotos')
    ap.add_argument('--salida', default='scripts/out/fotos/reconciliacion_FotosPozos')
    a = ap.parse_args(argv)
    esperado, detalle = universo_esperado(a.raiz)
    rep = reconciliar(leer_archivo_csv(a.hoja), esperado)
    rep['evidencia_local'] = detalle
    Path(a.salida + '.json').write_text(json.dumps(rep, indent=1, ensure_ascii=False), encoding='utf-8')
    t = texto({k: v for k, v in rep.items() if k != 'evidencia_local'}, detalle)
    Path(a.salida + '.txt').write_text(t, encoding='utf-8')
    sys.stdout.write(t)
    return 0


if __name__ == '__main__':
    sys.exit(main())
