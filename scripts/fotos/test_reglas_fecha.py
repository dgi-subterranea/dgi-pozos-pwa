#!/usr/bin/env python3
"""Regla de fecha sospechosa: un anio sacado solo del nombre y fuera del rango plausible de la fuente va a revision."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import fotos_comun as C  # noqa: E402
import inventario_csv as V  # noqa: E402


def rec(fuente='MONITOREO_NE', valor='2025', origen='NOMBRE_ANIO', precision='ANIO', estado=C.ESTADO_CONFIRMADO):
    return {'estado': estado, 'motivos': [], 'flags': [], 'fuente': fuente, 'wellId': '04-0263',
            'fecha': {'valor': valor, 'precision': precision, 'fuente': origen, 'flags': []}}


class FechaSospechosaTests(unittest.TestCase):
    def test_monitoreo_2016_es_sospechoso(self):
        self.assertTrue(C.fecha_sospechosa(rec(valor='2016')['fecha'], 'MONITOREO_NE'))

    def test_rangos_plausibles_de_monitoreo(self):
        for anio in ('2023', '2024', '2025', '2026'):
            self.assertFalse(C.fecha_sospechosa(rec(valor=anio)['fecha'], 'MONITOREO_NE'), anio)
        for anio in ('2022', '2027', '2016'):
            self.assertTrue(C.fecha_sospechosa(rec(valor=anio)['fecha'], 'MONITOREO_NE'), anio)

    def test_solo_aplica_a_fechas_sacadas_del_nombre(self):
        self.assertFalse(C.fecha_sospechosa(rec(valor='2016-05-03', origen='EXIF', precision='DIA')['fecha'], 'MONITOREO_NE'))
        self.assertFalse(C.fecha_sospechosa(rec(valor='2016-05', origen='CARPETA', precision='MES')['fecha'], 'MONITOREO_NE'))

    def test_fuente_desconocida_o_sin_fecha_no_se_toca(self):
        self.assertFalse(C.fecha_sospechosa(rec(valor='2016')['fecha'], 'OTRA_FUENTE'))
        self.assertFalse(C.fecha_sospechosa({'valor': None, 'precision': 'DESCONOCIDA', 'fuente': None}, 'MONITOREO_NE'))

    def test_pasa_a_revision_sin_corregir_la_fecha(self):
        r = rec(valor='2016')
        self.assertTrue(C.aplicar_regla_fecha(r))
        self.assertEqual(r['estado'], C.ESTADO_POR_REVISAR)
        self.assertEqual(r['motivos'], ['FECHA_SOSPECHOSA'])
        self.assertIn('ANIO_FUERA_DE_RANGO', r['flags'])
        self.assertEqual(r['fecha']['valor'], '2016')               # NO se corrige
        self.assertEqual(r['wellId'], '04-0263')                    # el pozo sigue propuesto

    def test_es_idempotente_y_no_toca_lo_normal_ni_lo_que_ya_estaba_en_revision(self):
        r = rec(valor='2016')
        C.aplicar_regla_fecha(r)
        self.assertFalse(C.aplicar_regla_fecha(r))
        self.assertEqual(r['motivos'], ['FECHA_SOSPECHOSA'])
        normal = rec(valor='2025')
        self.assertFalse(C.aplicar_regla_fecha(normal))
        self.assertEqual(normal['estado'], C.ESTADO_CONFIRMADO)

    def test_un_contenido_que_ya_estaba_en_revision_conserva_sus_motivos_y_suma_este(self):
        r = rec(valor='2016', estado=C.ESTADO_POR_REVISAR)
        r['motivos'] = ['GPS_LEJOS']
        self.assertTrue(C.aplicar_regla_fecha(r))
        self.assertEqual(r['estado'], C.ESTADO_POR_REVISAR)
        self.assertEqual(r['motivos'], ['GPS_LEJOS', 'FECHA_SOSPECHOSA'])
        self.assertFalse(C.aplicar_regla_fecha(r))
        self.assertEqual(V.categoria_match(r), 'AMBIGUO')              # el GPS lejos sigue mandando

    def test_una_excluida_no_se_toca(self):
        e = rec(valor='2016', estado=C.ESTADO_EXCLUIDA)
        self.assertFalse(C.aplicar_regla_fecha(e))
        self.assertEqual(e['motivos'], [])

    def test_el_csv_de_revision_la_explica_sin_nombres_de_archivo(self):
        r = rec(valor='2016')
        C.aplicar_regla_fecha(r)
        r.update({'idsPorNombre': ['04-0263'], 'gpsDistM': None, 'tipoFoto': 'CERCA', 'fuenteValidacionId': 'AMBAS', 'sha1': 'a' * 40, 'indicioMonitoreo': None})
        fila = C.fila_revision(r)
        self.assertEqual(fila['motivoRevision'], 'FECHA_SOSPECHOSA')
        self.assertIn('anio del nombre (2016)', fila['sugerencia'])
        self.assertEqual(fila['wellIdPropuesto'], '04-0263')
        self.assertEqual(fila['fechaFotoValor'], '2016')

    def test_en_el_inventario_sigue_siendo_match_exacto_pero_migrable_solo_tras_revision(self):
        r = rec(valor='2016')
        C.aplicar_regla_fecha(r)
        self.assertEqual(V.categoria_match(r), 'MATCH_EXACTO')


if __name__ == '__main__':
    unittest.main()
