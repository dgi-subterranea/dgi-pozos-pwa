#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Clasificacion EN SECO de las fotos: una fila por contenido unico (SHA-1) con vinculo propuesto, fecha
resuelta, estado de importacion y banderas. No copia, no sube y no modifica nada.

Uso (desde la raiz del repo, despues de inventariar.py):
    python scripts/fotos/clasificar.py [--salida scripts/out/fotos] [--fotos Fotos]

Entradas: <salida>/inventario.json y los datasets de scripts/out/ (registro, mapa, niveles_estaticos).
Salida PRIVADA: <salida>/corpus.json (incluye rutas originales) y un resumen por pantalla.

Estados: CONFIRMADO (se importa), POR_REVISAR (va al CSV de revision, no se importa todavia) y
EXCLUIDA_IMPORTACION (sin contenido fotografico: no se importa y tampoco se borra del origen).
Requiere Pillow y numpy.
"""
import argparse
import collections
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fotos_comun as C  # noqa: E402


def stats_contenido(ruta_abs):
    """Estadisticas baratas (miniatura) para detectar cuadros negros, planos o casi blancos."""
    import numpy as np
    from PIL import Image
    try:
        with Image.open(str(ruta_abs)) as im:
            if im.format == 'JPEG':
                im.draft('L', (160, 160))
            g = im.convert('L')
            g.thumbnail((96, 96))
            a = np.asarray(g, dtype=float)
        return {'blanco': round(float((a > 240).mean()), 4), 'negro': round(float((a < 15).mean()), 4),
                'std': round(float(a.std()), 2)}
    except Exception:
        return None


def clasificar_inventario(inventario, refs, raiz_fotos):
    # Un inventario hecho con una version anterior puede traer auxiliares (.thm...) con contenido de imagen
    archivos = [a for a in inventario['archivos'] if C.es_foto_por_extension(a['ruta'])]
    inventario = dict(inventario, archivos=archivos,
                      noImagenes=list(inventario['noImagenes']) + [{'ruta': a['ruta'], 'tam': a['tam']} for a in inventario['archivos'] if not C.es_foto_por_extension(a['ruta'])])
    por_ruta = {a['ruta']: a for a in archivos}
    grupos = collections.defaultdict(list)
    for a in archivos:
        grupos[a['sha1']].append(a['ruta'])

    mtimes_fuente = collections.defaultdict(list)
    for a in archivos:
        mtimes_fuente[C.fuente_de(a['ruta'])].append(a['mtime'])
    mtime_ok = C.mtime_confiable_por_fuente(mtimes_fuente)

    filas = []
    for sha, rutas in sorted(grupos.items()):
        rutas = sorted(rutas)
        a0 = por_ruta[rutas[0]]
        ex = a0.get('exif') or {}
        fuentes = sorted({C.fuente_de(r) for r in rutas})
        fuente = fuentes[0]
        bases = [r.split('/')[-1] for r in rutas]
        cont = stats_contenido(Path(raiz_fotos) / rutas[0]) if raiz_fotos else None
        ilegible = bool(ex.get('error')) or cont is None
        v = C.evaluar_vinculo(
            fuente, bases, refs, gps=ex.get('gps'),
            contenido_sin_foto=(not ilegible) and C.sin_contenido_fotografico(cont),
            ilegible=ilegible, fuentes_mezcladas=len(fuentes) > 1)
        fecha = C.resolver_fecha(ex.get('fechaOriginal'), rutas, [por_ruta[r]['mtime'] for r in rutas], fuente, mtime_ok.get(fuente, False))
        ext = rutas[0].rsplit('.', 1)[-1].lower() if '.' in rutas[0] else ''
        flags = list(fecha['flags']) + list(v['advertencias'])
        if a0['formato'] == 'PNG':
            flags.append('ES_PNG')
        if (a0['formato'] == 'PNG') != (ext == 'png'):
            flags.append('EXTENSION_NO_COINCIDE')
        if a0['tam'] > 10 * 1024 * 1024:
            flags.append('MUY_GRANDE')
        carpetas = sorted({r.split('/')[0] + ('/' + r.split('/')[1] if r.startswith('Relevamiento') else '') for r in rutas})
        filas.append({
            'sha1': sha, 'copias': rutas, 'nCopias': len(rutas), 'copiasEnCarpetas': carpetas,
            'tam': a0['tam'], 'ancho': ex.get('ancho'), 'alto': ex.get('alto'), 'formato': a0['formato'],
            'fuente': fuente, 'tipoFoto': C.tipo_foto(bases[0], fuente),
            'idsPorNombre': v['idsPorNombre'], 'wellId': v['wellId'], 'fuenteValidacionId': v['fuenteValidacionId'],
            'indicioMonitoreo': v['indicioMonitoreo'],
            'estado': v['estado'], 'motivos': v['motivos'], 'confianza': v['confianza'],
            'gps': ex.get('gps'), 'gpsEstado': v['gpsEstado'], 'gpsDistM': v['gpsDistM'],
            'fecha': fecha, 'orientacionExif': ex.get('orientacion'),
            'camara': ((ex.get('marca') or '') + ' ' + (ex.get('modelo') or '')).strip() or None,
            'flags': flags, 'contenido': cont,
        })
    return filas, inventario


def imprimir_resumen(filas, inventario):
    cnt = collections.Counter
    print('\narchivos de imagen: %d | contenidos unicos: %d | copias sobrantes: %d | no imagenes omitidas: %d' % (
        len(inventario['archivos']), len(filas), len(inventario['archivos']) - len(filas), len(inventario['noImagenes'])))
    print('estado:', dict(cnt(f['estado'] for f in filas)))
    for fuente in sorted({f['fuente'] for f in filas}):
        sub = [f for f in filas if f['fuente'] == fuente]
        print('\n== %s (%d unicos) ==' % (fuente, len(sub)))
        print('  estado:', dict(cnt(f['estado'] for f in sub)))
        print('  motivos:', dict(cnt(m for f in sub for m in f['motivos'])))
        print('  fuenteValidacionId (confirmadas):', dict(cnt(f['fuenteValidacionId'] for f in sub if f['estado'] == C.ESTADO_CONFIRMADO)))
        print('  GPS:', dict(cnt(f['gpsEstado'] for f in sub)))
        print('  fecha fuente/precision:', dict(cnt((f['fecha']['fuente'], f['fecha']['precision']) for f in sub)))
        print('  pozos distintos confirmados:', len({f['wellId'] for f in sub if f['estado'] == C.ESTADO_CONFIRMADO}))
        print('  GB originales (todos / confirmados): %.2f / %.2f' % (
            sum(f['tam'] for f in sub) / 1024.0 ** 3, sum(f['tam'] for f in sub if f['estado'] == C.ESTADO_CONFIRMADO) / 1024.0 ** 3))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--fotos', default=str(C.FOTOS_DEFAULT))
    ap.add_argument('--salida', default=str(C.OUT_FOTOS))
    args = ap.parse_args()
    salida = Path(args.salida)
    inv = json.loads((salida / 'inventario.json').read_text(encoding='utf-8'))
    refs = C.cargar_referencias()
    filas, inv = clasificar_inventario(inv, refs, Path(args.fotos).resolve())
    (salida / 'corpus.json').write_text(json.dumps(filas, ensure_ascii=False), encoding='utf-8')
    imprimir_resumen(filas, inv)
    print('\ncorpus ->', salida / 'corpus.json')


if __name__ == '__main__':
    main()
