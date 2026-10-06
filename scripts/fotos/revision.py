#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Genera los archivos para la revision manual de las fotos POR_REVISAR (y el registro de las excluidas).

Uso (desde la raiz del repo, despues de clasificar.py):
    python scripts/fotos/revision.py [--salida scripts/out/fotos]

Escribe en <salida>/revision/ :
  revision_porrevisar.csv     Para abrir en Excel (separador ';', UTF-8 con BOM). SIN titulares ni nombres o rutas
                              de archivo: solo fotoId, datos clasificados y sugerencias. Las ultimas 4 columnas
                              (decision, wellIdCorregido, monitoringIdCorregido, observacionRevision) se completan a mano.
                              decision admite: CONFIRMAR (usar wellIdPropuesto/monitoringIdPropuesto), CORREGIR (usar los
                              "Corregido") o DESCARTAR (no importar).
  mapeo_privado_revision.csv  fotoId -> rutas/nombres originales. PRIVADO: para poder abrir la foto y reconocerla.
  excluidas_privado.csv       fotoId -> rutas de las EXCLUIDA_IMPORTACION (no se importan, tampoco se borran del origen).
Todo queda bajo scripts/out/ (ignorado por git).
"""
import argparse
import collections
import csv
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fotos_comun as C  # noqa: E402


def escribir_csv(ruta, columnas, filas):
    with open(str(ruta), 'w', encoding='utf-8-sig', newline='') as fh:
        w = csv.DictWriter(fh, fieldnames=columnas, delimiter=';', extrasaction='ignore')
        w.writeheader()
        for f in filas:
            w.writerow(f)


def generar(filas, salida):
    rev = C.asegurar_directorio(Path(salida) / 'revision')
    por_revisar = sorted((f for f in filas if f['estado'] == C.ESTADO_POR_REVISAR),
                         key=lambda f: ('|'.join(f['motivos']), f['fuente'], C.foto_id(f['sha1'])))
    escribir_csv(rev / 'revision_porrevisar.csv', C.REVISION_COLUMNAS, [C.fila_revision(f) for f in por_revisar])
    escribir_csv(rev / 'mapeo_privado_revision.csv', ['fotoId', 'fuente', 'motivoRevision', 'nCopias', 'rutasOriginales'], [
        {'fotoId': C.foto_id(f['sha1']), 'fuente': f['fuente'], 'motivoRevision': ' | '.join(f['motivos']),
         'nCopias': f['nCopias'], 'rutasOriginales': ' | '.join(f['copias'])} for f in por_revisar])
    excluidas = [f for f in filas if f['estado'] == C.ESTADO_EXCLUIDA]
    escribir_csv(rev / 'excluidas_privado.csv', ['fotoId', 'fuente', 'estado', 'motivo', 'nCopias', 'rutasOriginales'], [
        {'fotoId': C.foto_id(f['sha1']), 'fuente': f['fuente'], 'estado': C.ESTADO_EXCLUIDA, 'motivo': C.MOTIVO_SIN_CONTENIDO,
         'nCopias': f['nCopias'], 'rutasOriginales': ' | '.join(f['copias'])} for f in excluidas])
    return rev, por_revisar, excluidas


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--salida', default=str(C.OUT_FOTOS))
    args = ap.parse_args()
    filas = json.loads((Path(args.salida) / 'corpus.json').read_text(encoding='utf-8'))
    rev, por_revisar, excluidas = generar(filas, args.salida)
    print('POR_REVISAR: %d | EXCLUIDA_IMPORTACION: %d -> %s' % (len(por_revisar), len(excluidas), rev))
    print('por motivo:', dict(collections.Counter(' | '.join(f['motivos']) for f in por_revisar)))


if __name__ == '__main__':
    main()
