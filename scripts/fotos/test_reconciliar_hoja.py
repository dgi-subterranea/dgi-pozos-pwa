"""Tests de reconciliar_hoja.py (solo lectura): universo esperado, faltantes, duplicados y entidad invalida."""
import json
import tempfile
import unittest
from pathlib import Path

import reconciliar_hoja as rh

COLS = ['fotoId', 'timestampRegistro', 'wellId', 'monitoringId', 'fuente', 'tipoFoto', 'fechaFotoValor', 'fechaFotoPrecision', 'fechaFotoFuente', 'observacion', 'estadoVinculo', 'vinculoMetodo',
        'gpsLat', 'gpsLon', 'gpsOrigen', 'emailUsuarioCarga', 'loteImportacion', 'sha1Original', 'procesamiento', 'mimeType', 'tamanoBytes', 'ancho', 'alto', 'tamanoOriginalBytes',
        'driveFileId', 'driveThumbId', 'estado']


def uuid(n):
    return '00000000-0000-5000-8000-%012d' % n


def fila(n, **extra):
    d = {c: '' for c in COLS}
    d.update(fotoId=uuid(n), wellId='14-0001', fuente='MONITOREO_NE', estadoVinculo='CONFIRMADO', estado='ACTIVA', emailUsuarioCarga='IMPORTACION', loteImportacion='L', sha1Original='%040x' % n,
             driveFileId='D%d' % n, driveThumbId='T%d' % n, fechaFotoValor='2025', fechaFotoPrecision='ANIO')
    d.update(extra)
    return d


def csv_texto(filas):
    import csv, io
    b = io.StringIO()
    w = csv.DictWriter(b, fieldnames=COLS)
    w.writeheader()
    w.writerows(filas)
    return b.getvalue()


class Base(unittest.TestCase):
    def armar(self, lotes):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        raiz = Path(self.tmp.name)
        for lote, (filas, estados) in lotes.items():
            (raiz / lote).mkdir()
            (raiz / lote / 'staging_FotosPozosImport.csv').write_text(csv_texto(filas), encoding='utf-8')
            (raiz / lote / 'estado_subida.jsonl').write_text('\n'.join(json.dumps({'fotoId': k, 'estado': v}) for k, v in estados.items()), encoding='utf-8')
        return raiz


class UniversoTests(Base):
    def test_solo_cuentan_subidas_y_ya_existe(self):
        raiz = self.armar({'produccion_final': ([fila(1), fila(2), fila(3)], {uuid(1): 'SUBIDA', uuid(2): 'YA_EXISTE', uuid(3): 'FALLIDA'})})
        esperado, det = rh.universo_esperado(raiz, ['produccion_final'])
        self.assertEqual(sorted(esperado), [uuid(1), uuid(2)])
        self.assertEqual(det['produccion_final']['staging'], 3)

    def test_repetidos_entre_lotes_se_informan(self):
        raiz = self.armar({'a': ([fila(1)], {uuid(1): 'SUBIDA'}), 'b': ([fila(1)], {uuid(1): 'SUBIDA'})})
        esperado, det = rh.universo_esperado(raiz, ['a', 'b'])
        self.assertEqual(len(esperado), 1)
        self.assertEqual(det['repetidos_entre_lotes'], [uuid(1)])


class ReconciliarTests(Base):
    def esperado(self, ns):
        return {uuid(n): dict(fila(n), _lote='L') for n in ns}

    def test_todo_presente_y_coherente(self):
        r = rh.reconciliar([fila(1), fila(2)], self.esperado([1, 2]))
        self.assertEqual((r['esperadas_presentes_en_hoja'], r['esperadas_faltantes_en_hoja'], r['filas_fuera_del_universo']), (2, 0, 0))
        self.assertEqual(r['presentes_con_diferencias_vs_staging'], {})
        self.assertEqual(r['presentes_ACTIVA_CONFIRMADO'], 2)

    def test_faltantes_y_fuera_del_universo(self):
        hoja = [fila(1), fila(9, fuente='CAMPO_APP', emailUsuarioCarga='x@y.com', loteImportacion='')]
        r = rh.reconciliar(hoja, self.esperado([1, 2]))
        self.assertEqual(r['esperadas_faltantes_en_hoja'], 1)
        self.assertEqual(r['faltantes_muestra'], [uuid(2)])
        self.assertEqual(r['filas_fuera_del_universo'], 1)
        self.assertEqual(r['fuera_por_fuente'], {'CAMPO_APP': 1})
        self.assertEqual(r['CAMPO_APP'], 1)
        self.assertEqual(r['fuera_IMPORTACION'], [])

    def test_duplicados_por_fotoId_y_contenido_y_entidad_invalida(self):
        hoja = [fila(1), fila(1), fila(2, sha1Original='%040x' % 1), fila(3, wellId='', monitoringId=''), fila(4, wellId='1-1')]
        r = rh.reconciliar(hoja, self.esperado([1]))
        self.assertEqual(r['fotoId_duplicados'], {uuid(1): 2})
        self.assertEqual(len(r['sha1_duplicados_misma_entidad']), 1)
        self.assertEqual(r['entidad_invalida_total'], 2)

    def test_diferencias_contra_staging(self):
        r = rh.reconciliar([fila(1, driveFileId='OTRO', estado='OCULTA')], self.esperado([1]))
        self.assertEqual(r['presentes_con_diferencias_vs_staging'], {'driveFileId': 1, 'estado': 1})
        self.assertEqual(r['presentes_ACTIVA_CONFIRMADO'], 0)

    def test_el_reporte_no_lleva_emails_ni_ids_de_drive(self):
        r = rh.reconciliar([fila(1, emailUsuarioCarga='secreto@x.com', driveFileId='DRIVESECRETO')], self.esperado([1]))
        self.assertNotIn('secreto@x.com', json.dumps(r))
        self.assertNotIn('DRIVESECRETO', json.dumps(r))

    def test_csv_con_punto_y_coma(self):
        texto = csv_texto([fila(1)]).replace(',', ';')
        self.assertEqual(rh.leer_csv(texto)[0]['fotoId'], uuid(1))


if __name__ == '__main__':
    unittest.main()
