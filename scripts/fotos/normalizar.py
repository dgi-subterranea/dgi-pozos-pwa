#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Normalizacion LOCAL de fotos (no sube nada, no modifica los originales).

Por cada foto: JPEG de 1600 px como maximo (calidad 72 y, solo si hiciera falta para entrar en 1,5 MB, 62 y 52),
miniatura de 256 px, sin ningun metadato (EXIF/XMP/IPTC/comentarios) y nombrado SOLO por fotoId.
Un JPEG que ya es chico (<= 1600 px y <= 1,5 MB) y esta derecho NO se recomprime: se copian sus bytes y se
le quitan los metadatos sin tocar la imagen. Se corrige la orientacion EXIF (JPEG y PNG).

Uso (desde la raiz del repo, despues de clasificar.py):
    python scripts/fotos/normalizar.py --seleccion piloto [--n 200] [--semilla 20261006] [--nombre piloto]
    python scripts/fotos/normalizar.py --seleccion piloto30 --nombre piloto30 [--incluir-wells 03-0652] [--excluir-wells 04-0263]
    python scripts/fotos/normalizar.py --seleccion confirmadas --nombre lote1      # todas las CONFIRMADO

Salida (PRIVADA, ignorada por git) en scripts/out/fotos/<nombre>/ :
    normalizado/<fotoId>.jpg   thumbs/<fotoId>_thumb.jpg
    manifiesto_privado.json    (incluye rutas originales: nunca fuera de la maquina)
    filas_FotosPozos.json      (filas candidatas de la hoja: solo CONFIRMADO, sin nombres ni rutas)
Las POR_REVISAR y las EXCLUIDA_IMPORTACION no se normalizan para importar.
Requiere Pillow y numpy.
"""
import argparse
import collections
import json
import random
import re
import sys
import time
from io import BytesIO
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fotos_comun as C  # noqa: E402

MAX_DIM = 1600
THUMB_DIM = 256
OBJETIVO_BYTES = int(1.5 * 1024 * 1024)
CALIDADES = [72, 62, 52]        # equivale a la escalera 0.72 -> 0.62 -> 0.52 del navegador (fotos de evaluacion)
CALIDAD_THUMB = 60
CALIDAD_SIN_REDUCIR = 85        # recompresion obligada (rotar / PNG) de una imagen que ya entra en 1600 px


# ------------------------------------------------------------- imagen (Pillow)

def _codificar(img, q):
    buf = BytesIO()
    img.save(buf, 'JPEG', quality=q, optimize=True)
    return buf.getvalue()


def _a_rgb(img):
    from PIL import Image
    if img.mode in ('RGBA', 'LA', 'P'):
        img = img.convert('RGBA')
        fondo = Image.new('RGB', img.size, (255, 255, 255))
        fondo.paste(img, mask=img.split()[-1])
        return fondo
    return img.convert('RGB')


def _reducir(img, lado):
    from PIL import Image
    if max(img.size) <= lado:
        return img
    esc = lado / float(max(img.size))
    return img.resize((max(1, round(img.width * esc)), max(1, round(img.height * esc))), Image.LANCZOS)


def _luma(img):
    import numpy as np
    return np.asarray(img.convert('L'), dtype=np.float64)


def psnr(a, b):
    import numpy as np
    mse = float(np.mean((a - b) ** 2))
    return 99.0 if mse == 0 else float(10 * np.log10(255.0 ** 2 / mse))


def ssim(a, b, k=8):
    import numpy as np

    def box(x):
        c = np.pad(np.cumsum(np.cumsum(x, 0), 1), ((1, 0), (1, 0)))
        return (c[k:, k:] - c[:-k, k:] - c[k:, :-k] + c[:-k, :-k]) / (k * k)
    c1, c2 = (0.01 * 255) ** 2, (0.03 * 255) ** 2
    ma, mb = box(a), box(b)
    saa, sbb, sab = box(a * a) - ma ** 2, box(b * b) - mb ** 2, box(a * b) - ma * mb
    return float((((2 * ma * mb + c1) * (2 * sab + c2)) / ((ma ** 2 + mb ** 2 + c1) * (saa + sbb + c2))).mean())


def normalizar_bytes(datos, medir=False):
    """datos: bytes de una imagen JPEG/PNG. Devuelve dict con 'salida' (JPEG sin metadatos), 'thumb' y la
    trazabilidad del procesamiento. Con medir=True agrega PSNR/SSIM contra la version de 1600 px sin comprimir."""
    from PIL import Image, ImageOps
    img0 = Image.open(BytesIO(datos))
    img0.load()
    formato = img0.format
    ori = None
    try:
        ori = img0.getexif().get(0x0112)
    except Exception:
        pass
    lado = max(img0.size)
    r = {'pesoOriginal': len(datos), 'anchoOriginal': img0.width, 'altoOriginal': img0.height,
         'orientacionOriginal': ori, 'calidad': None, 'psnr': None, 'ssim': None, 'superaObjetivo': False}

    if formato == 'JPEG' and lado <= MAX_DIM and len(datos) <= OBJETIVO_BYTES and ori in (None, 1):
        salida = C.jpeg_sin_metadatos(datos)
        final = Image.open(BytesIO(salida))
        final.load()
        r['procesamiento'] = 'COPIA_SIN_METADATOS'
    else:
        img = _a_rgb(ImageOps.exif_transpose(img0))      # JPEG y tambien PNG con chunk eXIf (iPhone exportado a PNG)
        ref = _reducir(img, MAX_DIM)
        escalera = CALIDADES if lado > MAX_DIM else [CALIDAD_SIN_REDUCIR] + CALIDADES
        salida = None
        for q in escalera:
            salida = _codificar(ref, q)
            r['calidad'] = q
            if len(salida) <= OBJETIVO_BYTES:
                break
        r['superaObjetivo'] = len(salida) > OBJETIVO_BYTES
        final = Image.open(BytesIO(salida))
        final.load()
        if formato == 'PNG':
            r['procesamiento'] = 'PNG_A_JPEG_Q%d' % r['calidad']
        elif lado > MAX_DIM:
            r['procesamiento'] = 'JPEG_%d_Q%d' % (MAX_DIM, r['calidad'])
        else:
            r['procesamiento'] = 'JPEG_ORIGINAL_DIM_Q%d' % r['calidad']
        if medir:
            a, b = _luma(ref), _luma(final)
            r['psnr'], r['ssim'] = round(psnr(a, b), 2), round(ssim(a, b), 4)
    th = final.copy()
    th.thumbnail((THUMB_DIM, THUMB_DIM), Image.LANCZOS)
    thumb = _codificar(th.convert('RGB'), CALIDAD_THUMB)
    r.update({'salida': salida, 'thumb': thumb, 'anchoFinal': final.width, 'altoFinal': final.height,
              'pesoFinal': len(salida), 'pesoThumb': len(thumb), 'anchoThumb': th.width, 'altoThumb': th.height,
              'metadatosEnSalida': C.metadatos_presentes(salida) + C.metadatos_presentes(thumb)})
    return r


# -------------------------------------------------------------------- muestreo

def muestra_piloto(filas, semilla=20261006):
    """Muestra representativa y reproducible (200): 50 Monitoreo, 100 Relevamiento claro, 20 de grupos
    duplicados, 15 sin wellId claro y 15 problematicas. Devuelve OrderedDict sha1 -> {categoria, estrato}."""
    rnd = random.Random(semilla)
    sel = collections.OrderedDict()

    def tomar(cat, pool, n, sub):
        pool = [f for f in pool if f['sha1'] not in sel]
        rnd.shuffle(pool)
        for f in pool[:n]:
            sel[f['sha1']] = {'categoria': cat, 'estrato': sub}

    base = lambda f: f['copias'][0].split('/')[-1]
    mon = [f for f in filas if f['fuente'] == 'MONITOREO_NE']
    rel = [f for f in filas if f['fuente'] == 'RELEVAMIENTO_2018']
    tiene = lambda f, m: m in f['motivos']

    tomar('PROBLEMATICA', [f for f in rel if 'EXIF_INVALIDO' in f['fecha']['flags']], 3, 'EXIF_1980')
    tomar('PROBLEMATICA', [f for f in rel if f['fecha']['precision'] == 'MES'], 1, 'FECHA_SOLO_MES')
    tomar('PROBLEMATICA', [f for f in filas if tiene(f, 'ID_CONFLICTO')], 3, 'ID_CONFLICTO')
    tomar('PROBLEMATICA', [f for f in filas if tiene(f, 'GPS_LEJOS')], 2, 'GPS_LEJOS')
    tomar('PROBLEMATICA', [f for f in filas if 'MUY_GRANDE' in f['flags']], 2, 'MUY_GRANDE_>10MB')
    tomar('PROBLEMATICA', [f for f in filas if f['estado'] == C.ESTADO_EXCLUIDA], 2, 'EXCLUIDA_SIN_CONTENIDO')
    tomar('PROBLEMATICA', [f for f in filas if tiene(f, 'ID_FUERA_PADRON')], 1, 'ID_FUERA_PADRON')
    tomar('PROBLEMATICA', [f for f in filas if f['formato'] == 'PNG'], 1, 'PNG')

    tomar('DUPLICADO', [f for f in mon if f['nCopias'] > 1], 2, 'DUP_MONITOREO')
    tomar('DUPLICADO', [f for f in filas if f['nCopias'] > len(f['copiasEnCarpetas'])], 3, 'DUP_MISMA_CARPETA')
    tomar('DUPLICADO', [f for f in rel if f['nCopias'] == 2], 5, 'DUP_x2')
    tomar('DUPLICADO', [f for f in rel if f['nCopias'] == 3], 5, 'DUP_x3')
    tomar('DUPLICADO', [f for f in rel if f['nCopias'] >= 4], 5, 'DUP_x4+')

    sin_id = [f for f in rel if tiene(f, 'SIN_ID')]
    tomar('SIN_WELLID', [f for f in sin_id if re.match(r'^IMG_', base(f), re.I)], 5, 'IMG_nnnn')
    tomar('SIN_WELLID', [f for f in sin_id if re.match(r'^(19|20)\d{6}_\d{6}', base(f))], 3, 'TIMESTAMP')
    tomar('SIN_WELLID', [f for f in sin_id if re.search(r'[A-Za-zÀ-ÿ]{4,}', base(f)) and not re.match(r'^IMG_', base(f), re.I)], 5, 'SOLO_TEXTO')
    tomar('SIN_WELLID', sin_id, 2, 'OTRO')

    reg = [f for f in mon if f['estado'] == C.ESTADO_CONFIRMADO]
    tomar('MONITOREO', [f for f in reg if f['gps']], 8, 'regular_con_GPS')
    tomar('MONITOREO', [f for f in reg if f['tipoFoto'] == 'CERCA'], 14, 'regular_Cerca')
    tomar('MONITOREO', [f for f in reg if f['tipoFoto'] == 'PANORAMICA'], 14, 'regular_Pano')
    tomar('MONITOREO', [f for f in mon if tiene(f, 'ID_AMBIGUO_INA_MON') and f['indicioMonitoreo']['tipo'] == 'INA'], 5, 'irregular_INA')
    tomar('MONITOREO', [f for f in mon if tiene(f, 'ID_AMBIGUO_INA_MON') and f['indicioMonitoreo']['tipo'] != 'INA'], 5, 'irregular_Mon_num')
    tomar('MONITOREO', [f for f in mon if tiene(f, 'SIN_ID')], 4, 'irregular_sin_id')
    tomar('MONITOREO', reg, 50 - sum(1 for v in sel.values() if v['categoria'] == 'MONITOREO'), 'regular_relleno')

    ok = [f for f in rel if f['estado'] == C.ESTADO_CONFIRMADO and f['fecha']['fuente'] == 'EXIF']
    cam = lambda f: f['camara'] or '(sin)'
    tomar('RELEVAMIENTO_CLARO', [f for f in ok if 'Canon' in cam(f)], 45, 'Canon')
    tomar('RELEVAMIENTO_CLARO', [f for f in ok if 'samsung' in cam(f).lower()], 15, 'samsung')
    tomar('RELEVAMIENTO_CLARO', [f for f in ok if 'Android' in cam(f)], 12, 'Android')
    tomar('RELEVAMIENTO_CLARO', [f for f in ok if 'BLU' in cam(f)], 6, 'BLU')
    tomar('RELEVAMIENTO_CLARO', [f for f in ok if 'KODAK' in cam(f).upper()], 3, 'Kodak')
    tomar('RELEVAMIENTO_CLARO', [f for f in ok if f['gps']], 12, 'con_GPS')
    tomar('RELEVAMIENTO_CLARO', [f for f in ok if f['orientacionExif'] in (6, 8)], 7, 'orientacion_6_8')
    tomar('RELEVAMIENTO_CLARO', ok, 100 - sum(1 for v in sel.values() if v['categoria'] == 'RELEVAMIENTO_CLARO'), 'relleno')
    return sel


def muestra_piloto30(filas, semilla=20261007, incluir_wells=(), excluir_wells=()):
    """Lote piloto de ~30 fotos CONFIRMADAS para validar de punta a punta (Fotos/ -> Drive -> hoja -> galeria).
    SOLO CONFIRMADO (nunca POR_REVISAR ni EXCLUIDA_IMPORTACION). Cubre fuentes, tipos, fechas (DIA / MES / solo ANIO,
    EXIF / carpeta / archivo), GPS (consistente y 200-500 m), pozo solo de Provincia, punto de la red NE, pozo con
    varias fotos y con fotos de las dos fuentes, PNG, imagen muy grande y orientacion EXIF 6/8.
    incluir_wells: pozos que si o si deben entrar (1 foto c/u, se suman a las ~30); excluir_wells: pozos que no
    deben entrar (p. ej. los que ya recibieron fotos de prueba). Devuelve OrderedDict sha1 -> {categoria, estrato}."""
    rnd = random.Random(semilla)
    sel = collections.OrderedDict()
    excl = set(excluir_wells)
    conf = [f for f in filas if f['estado'] == C.ESTADO_CONFIRMADO and f['wellId'] not in excl]
    mon = [f for f in conf if f['fuente'] == 'MONITOREO_NE']
    rel = [f for f in conf if f['fuente'] == 'RELEVAMIENTO_2018']

    def tomar(cat, estrato, pool, n, distinto_anio=False):
        pool = [f for f in pool if f['sha1'] not in sel]
        rnd.shuffle(pool)
        anios, puestos = set(), 0
        for f in pool:
            if puestos >= n:
                break
            a = (f['fecha']['valor'] or '')[:4]
            if distinto_anio and a in anios:
                continue
            anios.add(a)
            sel[f['sha1']] = {'categoria': cat, 'estrato': estrato}
            puestos += 1

    por_pozo = collections.defaultdict(list)
    for f in conf:
        por_pozo[f['wellId']].append(f)
    # un pozo con fotos de las DOS fuentes (galeria con filtro de fuente)
    mixtos = sorted(w for w, fs in por_pozo.items() if {x['fuente'] for x in fs} == {'MONITOREO_NE', 'RELEVAMIENTO_2018'})
    rnd.shuffle(mixtos)
    if mixtos:
        fs = por_pozo[mixtos[0]]
        tomar('MONITOREO', 'pozo_dos_fuentes_monitoreo', [f for f in fs if f['fuente'] == 'MONITOREO_NE'], 1)
        tomar('RELEVAMIENTO', 'pozo_dos_fuentes_relevamiento', [f for f in fs if f['fuente'] == 'RELEVAMIENTO_2018'], 1)
    # un pozo de Monitoreo con >= 3 fotos mezclando CERCA y PANORAMICA (orden, filtros y visor)
    multi = sorted(w for w, fs in por_pozo.items()
                   if len([x for x in fs if x['fuente'] == 'MONITOREO_NE']) >= 3
                   and {x['tipoFoto'] for x in fs if x['fuente'] == 'MONITOREO_NE'} == {'CERCA', 'PANORAMICA'})
    rnd.shuffle(multi)
    if multi:
        tomar('MONITOREO', 'pozo_varias_fotos', [f for f in por_pozo[multi[0]] if f['fuente'] == 'MONITOREO_NE'], 3)

    tomar('MONITOREO', 'CERCA_anios_distintos', [f for f in mon if f['tipoFoto'] == 'CERCA'], 3, distinto_anio=True)
    tomar('MONITOREO', 'PANORAMICA_anios_distintos', [f for f in mon if f['tipoFoto'] == 'PANORAMICA'], 3, distinto_anio=True)
    tomar('MONITOREO', 'con_GPS', [f for f in mon if f['gps']], 2)
    tomar('MONITOREO', 'punto_red_NE_sin_padron', [f for f in mon if f['fuenteValidacionId'] == 'RED_NE'], 2)

    dia_exif = lambda f, a: f['fecha']['precision'] == 'DIA' and f['fecha']['fuente'] == 'EXIF' and f['fecha']['valor'].startswith(a)
    tomar('RELEVAMIENTO', 'DIA_EXIF_2018', [f for f in rel if dia_exif(f, '2018')], 2)
    tomar('RELEVAMIENTO', 'DIA_EXIF_2019', [f for f in rel if dia_exif(f, '2019')], 2)
    tomar('RELEVAMIENTO', 'GPS_consistente', [f for f in rel if f['gpsEstado'] == 'GPS_CONSISTENTE'], 2)
    tomar('RELEVAMIENTO', 'GPS_200_500m', [f for f in rel if f['gpsEstado'] == 'GPS_CERCANO'], 1)
    tomar('RELEVAMIENTO', 'fecha_solo_MES', [f for f in rel if f['fecha']['precision'] == 'MES'], 1)
    tomar('RELEVAMIENTO', 'fecha_DIA_de_carpeta', [f for f in rel if f['fecha']['precision'] == 'DIA' and f['fecha']['fuente'] == 'CARPETA'], 1)
    tomar('RELEVAMIENTO', 'fecha_DIA_de_archivo', [f for f in rel if f['fecha']['fuente'] == 'ARCHIVO'], 1)
    tomar('MONITOREO', 'PNG', [f for f in conf if f['formato'] == 'PNG'], 1)
    tomar('MONITOREO', 'imagen_muy_grande', [f for f in conf if 'MUY_GRANDE' in f['flags']], 1)
    tomar('RELEVAMIENTO', 'orientacion_EXIF_6_u_8', [f for f in rel if f['orientacionExif'] in (6, 8)], 2)
    tomar('RELEVAMIENTO', 'pozo_solo_Provincia', [f for f in rel if f['fuenteValidacionId'] == 'PADRON'], 2)

    # Pozos pedidos a mano: se SUMAN al final (el lote base no cambia, asi la muestra sigue siendo representativa y
    # reproducible). Una foto por pozo (prefiere Monitoreo y luego la mas reciente); si el pozo ya esta en el lote, no se repite.
    en_lote = {f['wellId'] for f in filas if f['sha1'] in sel}
    for w in incluir_wells:
        if w in en_lote:
            continue
        pool = [f for f in filas if f['estado'] == C.ESTADO_CONFIRMADO and f['wellId'] == w]
        pool.sort(key=lambda f: (f['fuente'] != 'MONITOREO_NE', f['fecha']['valor'] or '', f['sha1']))
        if pool:
            sel[pool[0]['sha1']] = {'categoria': 'SOLICITADO', 'estrato': 'pozo_pedido'}
            en_lote.add(w)
    return sel


def pozos_pedidos_sin_foto(filas, seleccion, incluir_wells):
    """Pozos pedidos con --incluir-wells que NO quedaron en el lote porque no tienen ninguna foto CONFIRMADA
    (p. ej. solo POR_REVISAR) o no existen en el corpus. Sirve para avisar en voz alta en vez de ignorarlos."""
    por_sha = {f['sha1']: f for f in filas}
    presentes = {por_sha[s]['wellId'] for s in seleccion}
    return [w for w in incluir_wells if w not in presentes]


def cobertura(seleccion, filas):
    """Cuenta cuantas fotos del lote cubren cada caracteristica pedida (para mostrar y verificar el lote)."""
    por_sha = {f['sha1']: f for f in filas}
    fs = [por_sha[s] for s in seleccion]
    n = collections.Counter
    return collections.OrderedDict([
        ('total', len(fs)),
        ('estado', dict(n(f['estado'] for f in fs))),
        ('fuente', dict(n(f['fuente'] for f in fs))),
        ('tipoFoto', dict(n(f['tipoFoto'] for f in fs))),
        ('fechaPrecision', dict(n(f['fecha']['precision'] for f in fs))),
        ('fechaFuente', dict(n(f['fecha']['fuente'] for f in fs))),
        ('gps', dict(n(f['gpsEstado'] for f in fs))),
        ('validadoContra', dict(n(f['fuenteValidacionId'] for f in fs))),
        ('formato', dict(n(f['formato'] for f in fs))),
        ('pozos', len({f['wellId'] for f in fs})),
        ('pozosConVariasFotos', sum(1 for v in n(f['wellId'] for f in fs).values() if v > 1)),
        ('pozosConAmbasFuentes', sum(1 for w in {f['wellId'] for f in fs} if len({f['fuente'] for f in fs if f['wellId'] == w}) == 2)),
    ])


# ---------------------------------------------------------------------- corrida

def _registro(f, meta=None):
    """Registro del manifiesto privado (sin bytes). Las rutas originales SOLO viven aca."""
    rec = {k: f[k] for k in ('sha1', 'fuente', 'tipoFoto', 'wellId', 'idsPorNombre', 'fuenteValidacionId', 'estado',
                              'motivos', 'confianza', 'indicioMonitoreo', 'gps', 'gpsEstado', 'gpsDistM', 'fecha',
                              'camara', 'flags', 'nCopias', 'copiasEnCarpetas')}
    rec['fotoId'] = C.foto_id(f['sha1'])
    rec['clasificacion'] = ('DUPLICADO_x%d' % f['nCopias']) if f['nCopias'] > 1 else 'UNICA'
    rec['subir'] = f['estado'] == C.ESTADO_CONFIRMADO
    rec['_copiasOriginales'] = f['copias']
    if meta:
        rec['categoriaMuestra'] = meta['categoria']
        rec['estratoMuestra'] = meta['estrato']
    return rec


def ejecutar(filas, seleccion, salida, fotos_dir, lote, medir=True):
    por_sha = {f['sha1']: f for f in filas}
    out = C.asegurar_directorio(salida)
    C.asegurar_directorio(out / 'normalizado')
    C.asegurar_directorio(out / 'thumbs')
    registros, t0 = [], time.time()
    for i, (sha, meta) in enumerate(seleccion.items()):
        f = por_sha[sha]
        rec = _registro(f, meta)
        if f['estado'] == C.ESTADO_EXCLUIDA:
            rec['procesamiento'] = None      # excluida: se registra y NO se normaliza ni se importa
        else:
            datos = (Path(fotos_dir) / f['copias'][0]).read_bytes()
            n = normalizar_bytes(datos, medir=medir)
            (out / 'normalizado' / (rec['fotoId'] + '.jpg')).write_bytes(n.pop('salida'))
            (out / 'thumbs' / (rec['fotoId'] + '_thumb.jpg')).write_bytes(n.pop('thumb'))
            rec.update(n)
        registros.append(rec)
        if i % 25 == 0:
            print('  %d / %d  (%ds)' % (i, len(seleccion), time.time() - t0))
    (out / 'manifiesto_privado.json').write_text(json.dumps(registros, ensure_ascii=False, indent=1), encoding='utf-8')
    filas_hoja = [C.fila_fotospozos(dict(por_sha[r['sha1']], fecha=r['fecha']), r, lote) for r in registros if r['subir']]
    (out / 'filas_FotosPozos.json').write_text(json.dumps(filas_hoja, ensure_ascii=False, indent=1), encoding='utf-8')
    print('listo: %d registros, %d filas candidatas (CONFIRMADO), %ds -> %s' % (len(registros), len(filas_hoja), time.time() - t0, out))
    return registros


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--seleccion', choices=['piloto', 'piloto30', 'confirmadas'], required=True)
    ap.add_argument('--n', type=int, default=200, help='tamano del piloto (solo orientativo: la muestra son 200)')
    ap.add_argument('--semilla', type=int, default=20261006)
    ap.add_argument('--nombre', default=None, help='subcarpeta de salida (default: el nombre de la seleccion)')
    ap.add_argument('--lote', default=None, help='etiqueta loteImportacion de las filas (default PILOTO-AAAA-MM o LOTE-AAAA-MM)')
    ap.add_argument('--incluir-wells', default='', help='piloto30: wellIds (DD-PPPP, separados por coma) que deben entrar')
    ap.add_argument('--excluir-wells', default='', help='piloto30: wellIds que NO deben entrar (p. ej. los que ya recibieron fotos de prueba)')
    ap.add_argument('--fotos', default=str(C.FOTOS_DEFAULT))
    ap.add_argument('--salida', default=str(C.OUT_FOTOS))
    ap.add_argument('--sin-medir', action='store_true', help='no calcula PSNR/SSIM (mas rapido)')
    args = ap.parse_args()

    base = Path(args.salida)
    filas = json.loads((base / 'corpus.json').read_text(encoding='utf-8'))
    lista = lambda t: [x.strip() for x in t.split(',') if x.strip()]
    if args.seleccion == 'piloto':
        sel = muestra_piloto(filas, args.semilla)
    elif args.seleccion == 'piloto30':
        sel = muestra_piloto30(filas, args.semilla if args.semilla != 20261006 else 20261007, lista(args.incluir_wells), lista(args.excluir_wells))
        print(json.dumps(cobertura(sel, filas), ensure_ascii=False))
        for w in pozos_pedidos_sin_foto(filas, sel, lista(args.incluir_wells)):
            print('AVISO: el pozo %s no entra al lote: no tiene fotos CONFIRMADAS en el corpus (o no existe).' % w)
    else:
        sel = collections.OrderedDict((f['sha1'], {'categoria': 'LOTE', 'estrato': None}) for f in filas if f['estado'] == C.ESTADO_CONFIRMADO)
    nombre = args.nombre or args.seleccion
    import datetime as dt
    lote = args.lote or ('PILOTO-' if args.seleccion.startswith('piloto') else 'LOTE-') + dt.date.today().strftime('%Y-%m')
    print('seleccion %s: %d contenidos unicos' % (args.seleccion, len(sel)))
    ejecutar(filas, sel, base / nombre, args.fotos, lote, medir=not args.sin_medir)


if __name__ == '__main__':
    main()
