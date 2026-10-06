#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Inventario de la carpeta de fotos (SOLO LECTURA): ruta relativa, tamano, mtime, formato por contenido,
SHA-1 y metadatos EXIF utiles (fecha original, camara, orientacion, dimensiones, GPS).

Uso (desde la raiz del repo):
    python scripts/fotos/inventariar.py [--fotos Fotos] [--salida scripts/out/fotos] [--hilos 8]

Escribe <salida>/inventario.json. Ese archivo es PRIVADO (las rutas relativas pueden contener nombres de
titulares): vive en scripts/out/, ignorado por git. Nunca modifica ni borra nada de la carpeta de fotos.
Requiere Pillow.
"""
import argparse
import datetime as dt
import hashlib
import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fotos_comun as C  # noqa: E402


def _dms(v, ref):
    try:
        d = float(v[0]) + float(v[1]) / 60.0 + float(v[2]) / 3600.0
    except Exception:
        return None
    return -d if ref in ('S', 'W') else d


def leer_metadatos(ruta_abs):
    """Metadatos de una imagen con Pillow (sin decodificar los pixeles). Tolerante: si falla devuelve {error}."""
    from PIL import Image
    try:
        with Image.open(str(ruta_abs)) as im:
            ancho, alto = im.size
            ex = im.getexif()
            ifd = ex.get_ifd(0x8769) if ex else {}
            gps_ifd = ex.get_ifd(0x8825) if ex else {}
            gps = None
            if gps_ifd and 2 in gps_ifd and 4 in gps_ifd:
                lat, lon = _dms(gps_ifd[2], gps_ifd.get(1)), _dms(gps_ifd[4], gps_ifd.get(3))
                if lat is not None and lon is not None and not (abs(lat) < 0.0001 and abs(lon) < 0.0001):
                    gps = [round(lat, 6), round(lon, 6)]
            texto = lambda v: (str(v).replace('\x00', '').strip() or None) if v is not None else None
            return {
                'ancho': ancho, 'alto': alto,
                'fechaOriginal': texto(ifd.get(0x9003)) if ifd else None,
                'marca': texto(ex.get(0x010F)) if ex else None,
                'modelo': texto(ex.get(0x0110)) if ex else None,
                'orientacion': ex.get(0x0112) if ex else None,
                'gps': gps,
                'gpsPresente': bool(gps_ifd),
            }
    except Exception as e:  # imagen corrupta o formato raro: se informa, no se aborta
        return {'error': str(e)[:80]}


def sha1_de(ruta_abs):
    h = hashlib.sha1()
    with open(str(ruta_abs), 'rb') as fh:
        for bloque in iter(lambda: fh.read(1024 * 1024), b''):
            h.update(bloque)
    return h.hexdigest()


def procesar(raiz, ruta_rel):
    p = raiz / ruta_rel
    st = p.stat()
    with open(str(p), 'rb') as fh:
        cab = fh.read(8)
    formato = C.formato_por_contenido(cab) if C.es_foto_por_extension(ruta_rel) else 'OTRO'
    item = {'ruta': ruta_rel, 'tam': st.st_size, 'mtime': int(st.st_mtime * 1000), 'formato': formato}
    if formato == 'OTRO':      # no es .jpg/.jpeg/.png o su contenido no es JPEG/PNG: se omite, no se toca
        return item
    item['sha1'] = sha1_de(p)
    item['exif'] = leer_metadatos(p)
    return item


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--fotos', default=str(C.FOTOS_DEFAULT), help='carpeta de fotos (default: <repo>/Fotos)')
    ap.add_argument('--salida', default=str(C.OUT_FOTOS), help='directorio de salida (default: scripts/out/fotos)')
    ap.add_argument('--hilos', type=int, default=8)
    args = ap.parse_args()

    raiz = Path(args.fotos).resolve()
    if not raiz.is_dir():
        sys.exit('No existe la carpeta de fotos: ' + str(raiz))
    rutas = sorted(str(p.relative_to(raiz)).replace('\\', '/') for p in raiz.rglob('*') if p.is_file())
    print('archivos encontrados:', len(rutas))
    t0 = time.time()
    items = []
    with ThreadPoolExecutor(max_workers=args.hilos) as ex:
        for i, item in enumerate(ex.map(lambda r: procesar(raiz, r), rutas)):
            items.append(item)
            if (i + 1) % 1000 == 0:
                print('  %d / %d  (%ds)' % (i + 1, len(rutas), time.time() - t0))
    imagenes = [i for i in items if i['formato'] != 'OTRO']
    no_imagenes = [{'ruta': i['ruta'], 'tam': i['tam']} for i in items if i['formato'] == 'OTRO']
    salida = C.asegurar_directorio(args.salida)
    (salida / 'inventario.json').write_text(json.dumps({
        'generadoEl': dt.datetime.now().isoformat(timespec='seconds'),
        'archivos': imagenes,
        'noImagenes': no_imagenes,
    }, ensure_ascii=False), encoding='utf-8')
    print('imagenes: %d | no imagenes (se omiten, no se tocan): %d | %ds -> %s' % (
        len(imagenes), len(no_imagenes), time.time() - t0, salida / 'inventario.json'))


if __name__ == '__main__':
    main()
