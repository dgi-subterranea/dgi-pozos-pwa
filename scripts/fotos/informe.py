#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Informe estadistico de una corrida de normalizacion (piloto o lote) + auditoria de privacidad.

Uso:
    python scripts/fotos/informe.py [--nombre piloto] [--salida scripts/out/fotos]

Lee corpus.json y <nombre>/manifiesto_privado.json. Imprime por pantalla: vinculo, fechas, duplicados,
pesos original vs normalizado, calidad medida, extrapolacion al corpus y verificaciones de privacidad
(ningun nombre original en las filas, archivos solo por fotoId, sin metadatos en las salidas).
"""
import argparse
import collections
import json
import re
import statistics
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fotos_comun as C  # noqa: E402

MB = 1024.0 * 1024.0


def _bucket(tam):
    m = tam / MB
    for lim, nom in ((0.5, '<0.5'), (1, '0.5-1'), (2, '1-2'), (3, '2-3'), (6, '3-6'), (10, '6-10')):
        if m < lim:
            return nom
    return '>10'


def extrapolar(corpus, regs):
    """Peso normalizado esperado de todo el corpus, post-estratificado por fuente x tamano original."""
    por_estrato = collections.defaultdict(list)
    por_fuente = collections.defaultdict(list)
    for r in regs:
        if r.get('pesoFinal') is None:
            continue
        por_estrato[(r['fuente'], _bucket(r['pesoOriginal']))].append(r['pesoFinal'])
        por_fuente[r['fuente']].append(r['pesoFinal'])
    thumb = statistics.mean(r['pesoThumb'] for r in regs if r.get('pesoThumb'))
    res = {'todas': 0.0, 'confirmadas': 0.0, 'nTodas': 0, 'nConfirmadas': 0}
    for c in corpus:
        if c['estado'] == C.ESTADO_EXCLUIDA:
            continue
        k = (c['fuente'], _bucket(c['tam']))
        media = statistics.mean(por_estrato[k]) if k in por_estrato else statistics.mean(por_fuente[c['fuente']])
        res['todas'] += media + thumb
        res['nTodas'] += 1
        if c['estado'] == C.ESTADO_CONFIRMADO:
            res['confirmadas'] += media + thumb
            res['nConfirmadas'] += 1
    return res


def auditoria_privacidad(regs, filas, directorio):
    """Palabras de los nombres originales que aparecerian en lo que viajaria (valores de las filas) y
    nombres de archivo / metadatos de las salidas."""
    stop = {'cerca', 'pano', 'jpeg', 'sin', 'nombre', 'foto', 'fotos', 'image'}
    serial = json.dumps([list(f.values()) for f in filas], ensure_ascii=False).lower()
    tokens, fuga = set(), set()
    for r in regs:
        for c in r['_copiasOriginales']:
            base = re.sub(r'\.[A-Za-z0-9]+$', '', c.split('/')[-1])
            for t in re.findall(r'[A-Za-zÀ-ÿ]{4,}', base):
                t = t.lower()
                if t in stop:
                    continue
                tokens.add(t)
                if t in serial:
                    fuga.add(t)
    nombres = [p.name for d in ('normalizado', 'thumbs') for p in (directorio / d).glob('*')]
    malos = [n for n in nombres if not re.match(r'^[0-9a-f-]{36}(_thumb)?\.jpg$', n)]
    meta = collections.Counter(tuple(C.metadatos_presentes(p.read_bytes())) for d in ('normalizado', 'thumbs') for p in (directorio / d).glob('*'))
    campos_ruta = [k for f in filas for k, v in f.items() if k != 'mimeType' and isinstance(v, str) and re.search(r'[\\/]|\.(jpe?g|png)$', v, re.I)]
    return {'palabrasAnalizadas': len(tokens), 'palabrasQueAparecenEnFilas': sorted(fuga), 'archivosConNombreNoFotoId': malos,
            'camposConRutaOArchivo': campos_ruta, 'metadatosEnSalidas': dict(meta)}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--nombre', default='piloto')
    ap.add_argument('--salida', default=str(C.OUT_FOTOS))
    args = ap.parse_args()
    base = Path(args.salida)
    corpus = json.loads((base / 'corpus.json').read_text(encoding='utf-8'))
    d = base / args.nombre
    regs = json.loads((d / 'manifiesto_privado.json').read_text(encoding='utf-8'))
    filas = json.loads((d / 'filas_FotosPozos.json').read_text(encoding='utf-8'))
    cnt = collections.Counter
    print('== MUESTRA ==', len(regs), dict(cnt(r.get('categoriaMuestra') for r in regs)))
    print('estado:', dict(cnt(r['estado'] for r in regs)), '| confianza:', dict(cnt(r['confianza'] for r in regs)))
    print('motivos:', dict(cnt(m for r in regs for m in r['motivos'])))
    print('fuenteValidacionId (confirmadas):', dict(cnt(r['fuenteValidacionId'] for r in regs if r['estado'] == C.ESTADO_CONFIRMADO)))
    print('gpsEstado:', dict(cnt(r['gpsEstado'] for r in regs)))
    print('clasificacion:', dict(cnt(r['clasificacion'] for r in regs)))
    print('copias representadas: %d | sobrantes: %d' % (sum(r['nCopias'] for r in regs), sum(r['nCopias'] - 1 for r in regs)))
    print('fecha fuente/precision:', dict(cnt((r['fecha']['fuente'], r['fecha']['precision']) for r in regs)))
    print('flags de fecha:', dict(cnt(f for r in regs for f in r['fecha']['flags'])))
    proc = [r for r in regs if r.get('pesoFinal') is not None]
    o, f = sum(r['pesoOriginal'] for r in proc), sum(r['pesoFinal'] for r in proc)
    print('\n== PESOS == original %.1f MB -> normalizado %.1f MB (%.1f%%) + miniaturas %.2f MB' % (
        o / MB, f / MB, 100.0 * f / o, sum(r['pesoThumb'] for r in proc) / MB))
    for fuente in sorted({r['fuente'] for r in proc}):
        sub = [r for r in proc if r['fuente'] == fuente]
        pf = sorted(r['pesoFinal'] for r in sub)
        print('  %-18s n=%d  %.1f -> %.1f MB | final mediana %.0f KB p90 %.0f KB max %.0f KB' % (
            fuente, len(sub), sum(r['pesoOriginal'] for r in sub) / MB, sum(r['pesoFinal'] for r in sub) / MB,
            statistics.median(pf) / 1024, pf[int(len(pf) * .9)] / 1024, pf[-1] / 1024))
    print('procesamiento:', dict(cnt(r['procesamiento'] for r in proc)), '| sobre 1,5 MB:', sum(1 for r in proc if r['pesoFinal'] > 1.5 * MB))
    q = [r for r in proc if r.get('psnr') is not None]
    if q:
        ps, ss = sorted(r['psnr'] for r in q), sorted(r['ssim'] for r in q)
        print('PSNR dB: min %.1f mediana %.1f | SSIM: min %.4f mediana %.4f (n=%d)' % (ps[0], statistics.median(ps), ss[0], statistics.median(ss), len(q)))
    ex = extrapolar(corpus, proc)
    print('\n== EXTRAPOLACION == todas las no excluidas (%d): %.2f GB | solo CONFIRMADO (%d): %.2f GB (con miniaturas)' % (
        ex['nTodas'], ex['todas'] / MB / 1024, ex['nConfirmadas'], ex['confirmadas'] / MB / 1024))
    aud = auditoria_privacidad(proc, filas, d)
    print('\n== PRIVACIDAD ==')
    for k, v in aud.items():
        print(' ', k, ':', v)


if __name__ == '__main__':
    main()
