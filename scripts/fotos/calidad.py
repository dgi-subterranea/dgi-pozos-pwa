#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Experimento de calidad/compresion sobre fotos del piloto (solo lectura de las originales).

Uso:
    python scripts/fotos/calidad.py [--nombre piloto] [--n 60]

Compara dimension maxima x calidad JPEG (tamano, PSNR, SSIM contra la version sin comprimir de la misma
dimension) y arma 3 hojas de comparacion visual a 100 % en <nombre>/visual/ (PRIVADAS: son fotos reales).
"""
import argparse
import json
import random
import statistics
import sys
from io import BytesIO
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fotos_comun as C  # noqa: E402
import normalizar as N  # noqa: E402

CONFIGS = [(1280, 72), (1600, 82), (1600, 72), (1600, 62), (1600, 52), (2000, 72)]


def main():
    from PIL import Image, ImageDraw, ImageOps
    import numpy as np
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--nombre', default='piloto')
    ap.add_argument('--n', type=int, default=60)
    ap.add_argument('--fotos', default=str(C.FOTOS_DEFAULT))
    ap.add_argument('--salida', default=str(C.OUT_FOTOS))
    args = ap.parse_args()
    d = Path(args.salida) / args.nombre
    regs = json.loads((d / 'manifiesto_privado.json').read_text(encoding='utf-8'))
    cand = [r for r in regs if r['fuente'] == 'RELEVAMIENTO_2018' and (r.get('procesamiento') or '').startswith('JPEG_1600')]
    random.Random(7).shuffle(cand)
    res = {c: {'kb': [], 'psnr': [], 'ssim': []} for c in CONFIGS}
    imgs = []
    for r in cand[:args.n]:
        datos = (Path(args.fotos) / r['_copiasOriginales'][0]).read_bytes()
        img = N._a_rgb(ImageOps.exif_transpose(Image.open(BytesIO(datos))))
        imgs.append((img, r['fotoId']))
        for dim, q in CONFIGS:
            ref = N._reducir(img, dim)
            enc = N._codificar(ref, q)
            dec = Image.open(BytesIO(enc))
            dec.load()
            a, b = N._luma(ref), N._luma(dec)
            res[(dim, q)]['kb'].append(len(enc) / 1024.0)
            res[(dim, q)]['psnr'].append(N.psnr(a, b))
            res[(dim, q)]['ssim'].append(N.ssim(a, b))
    print('%-12s %8s %8s %8s %8s | %6s %7s' % ('config', 'KB med', 'KB p90', 'KB max', '<=1,5MB', 'PSNR', 'SSIM'))
    for c in CONFIGS:
        kb = sorted(res[c]['kb'])
        print('%-12s %8.0f %8.0f %8.0f %7.0f%% | %6.1f %7.4f' % ('%dpx q%d' % c, statistics.median(kb), kb[int(len(kb) * .9)], kb[-1],
              100.0 * sum(1 for k in kb if k <= 1536) / len(kb), statistics.mean(res[c]['psnr']), statistics.mean(res[c]['ssim'])))

    (d / 'visual').mkdir(exist_ok=True)
    detalle = []
    for img, fid in imgs:
        ref = N._reducir(img, 1600)
        g = N._luma(ref)
        detalle.append((float(np.mean(np.abs(np.diff(g, axis=0)))) + float(np.mean(np.abs(np.diff(g, axis=1)))), ref, fid))
    detalle.sort(key=lambda x: -x[0])
    crop = (440, 300)
    for n, (e, ref, fid) in enumerate([detalle[0], detalle[len(detalle) // 2], detalle[-1]]):
        w, h = ref.size
        x0, y0 = (w - crop[0]) // 2, (h - crop[1]) // 2
        piezas = [(ref.crop((x0, y0, x0 + crop[0], y0 + crop[1])), '1600px sin comprimir')]
        for q in (82, 72, 62, 52):
            enc = N._codificar(ref, q)
            piezas.append((Image.open(BytesIO(enc)).convert('RGB').crop((x0, y0, x0 + crop[0], y0 + crop[1])), 'q%d  %d KB' % (q, len(enc) / 1024)))
        hoja = Image.new('RGB', (crop[0] * 3 + 8, crop[1] * 2 + 8), (255, 255, 255))
        dib = ImageDraw.Draw(hoja)
        pos = [(0, 0), (crop[0] + 4, 0), (2 * crop[0] + 8, 0), (0, crop[1] + 4), (crop[0] + 4, crop[1] + 4)]
        for (im, et), (x, y) in zip(piezas, pos):
            hoja.paste(im, (x, y))
            dib.rectangle((x, y, x + 150, y + 14), fill=(0, 0, 0))
            dib.text((x + 3, y + 1), et, fill=(255, 255, 255))
        hoja.save(str(d / 'visual' / ('comparacion_%d.png' % n)))
    print('hojas visuales ->', d / 'visual')


if __name__ == '__main__':
    main()
