#!/usr/bin/env python3
"""Tests de las reglas puras del inventario por archivo (inventario_csv.py). No necesitan Fotos/ ni scripts/out/."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import fotos_comun as C  # noqa: E402
import inventario_csv as V  # noqa: E402


def rec(estado, motivos=(), sugerencias=None):
    r = {'estado': estado, 'motivos': list(motivos)}
    if sugerencias is not None:
        r['indicioMonitoreo'] = {'tipo': 'INA', 'valor': '1', 'sugerencias': sugerencias}
    return r


class CategoriaMatchTests(unittest.TestCase):
    def test_confirmado_es_match_exacto(self):
        self.assertEqual(V.categoria_match(rec(C.ESTADO_CONFIRMADO)), 'MATCH_EXACTO')

    def test_excluida_es_aparte(self):
        self.assertEqual(V.categoria_match(rec(C.ESTADO_EXCLUIDA, [C.MOTIVO_SIN_CONTENIDO])), 'EXCLUIDA')

    def test_sin_id_y_id_inexistente_son_sin_match(self):
        self.assertEqual(V.categoria_match(rec(C.ESTADO_POR_REVISAR, ['SIN_ID'])), 'SIN_MATCH')
        self.assertEqual(V.categoria_match(rec(C.ESTADO_POR_REVISAR, ['ID_FUERA_PADRON'])), 'SIN_MATCH')

    def test_conflicto_y_gps_lejos_son_ambiguos(self):
        self.assertEqual(V.categoria_match(rec(C.ESTADO_POR_REVISAR, ['ID_CONFLICTO'])), 'AMBIGUO')
        self.assertEqual(V.categoria_match(rec(C.ESTADO_POR_REVISAR, ['GPS_LEJOS'])), 'AMBIGUO')

    def test_ina_o_mon_con_un_solo_punto_es_probable_nunca_exacto(self):
        self.assertEqual(V.categoria_match(rec(C.ESTADO_POR_REVISAR, ['ID_AMBIGUO_INA_MON'], ['04-0263'])), 'MATCH_PROBABLE')

    def test_ina_o_mon_sin_punto_o_con_varios_es_ambiguo(self):
        self.assertEqual(V.categoria_match(rec(C.ESTADO_POR_REVISAR, ['ID_AMBIGUO_INA_MON'], [])), 'AMBIGUO')
        self.assertEqual(V.categoria_match(rec(C.ESTADO_POR_REVISAR, ['ID_AMBIGUO_INA_MON'], ['04-0263', '04-0264'])), 'AMBIGUO')
        self.assertEqual(V.categoria_match(rec(C.ESTADO_POR_REVISAR, ['ID_AMBIGUO_INA_MON'])), 'AMBIGUO')


class ClaseNombreTests(unittest.TestCase):
    def test_convenciones_sin_datos_personales(self):
        d = {'15', '04'}
        casos = {
            '15 0268.JPG': 'DD NNNN.ext (solo el id)',
            '15 0268 Apellido, Nombre.JPG': 'DD NNNN <apellido/nombre/lugar>.ext',
            '04 0263_Cerca_2025.jpg': 'DD NNNN_<Cerca|Pano>_<anio> (Monitoreo)',
            'INA 101_Pano_2023.JPG': 'INA nnn_<Cerca|Pano>_<anio> (Monitoreo)',
            '004_Cerca_2025.jpg': 'nnn_<Cerca|Pano>_<anio> (Monitoreo sin departamento)',
            'IMG_4562.JPG': 'IMG_nnnn / DSC_nnnn (nombre de camara)',
            '20180320_152302.jpg': 'AAAAMMDD_HHMMSS (marca de tiempo del celular)',
            'Puesto viejo.JPG': 'solo texto (sin id)',
        }
        for nombre, clase in casos.items():
            self.assertEqual(V.clase_nombre(nombre, d), clase, nombre)

    def test_las_clases_no_contienen_el_nombre_original(self):
        self.assertNotIn('Apellido', V.clase_nombre('15 0268 Apellido, Nombre.JPG', {'15'}))


class ColumnasTests(unittest.TestCase):
    def test_columnas_pedidas(self):
        for c in ('ruta_relativa', 'nombre_original', 'extension', 'tamano_bytes', 'mtime_archivo', 'fecha_exif', 'ancho', 'alto',
                  'wellId_candidato', 'metodo_wellId', 'categoria_match', 'confianza', 'fecha_candidata', 'metodo_fecha', 'sha1',
                  'estado_migrabilidad', 'observacion'):
            self.assertIn(c, V.COLUMNAS)

    def test_es_solo_lectura_no_escribe_fuera_de_scripts_out(self):
        fuente = Path(V.__file__).read_text(encoding='utf-8')
        for peligroso in ('os.remove', 'os.rename', 'shutil', 'unlink', 'rmtree', 'urllib', 'requests', 'socket'):
            self.assertNotIn(peligroso, fuente)


if __name__ == '__main__':
    unittest.main()
