# -*- coding: utf-8 -*-
"""El fixture js/fixtures/posgar94_ar2_vectores.json (referencia de la conversion de coordenadas del frontend)
tiene que seguir siendo EXACTAMENTE lo que dan pyproj y la aritmetica exacta: si alguien lo edita a mano o cambia el
CRS, esto falla antes de que los tests de Jest den por buena una referencia equivocada.
"""
import json
import os
import unittest
from fractions import Fraction

from pyproj import Transformer

RUTA = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'js', 'fixtures', 'posgar94_ar2_vectores.json')


class TestVectoresPosgar(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with open(RUTA, encoding='utf-8') as f:
            cls.datos = json.load(f)
        cls.t = Transformer.from_crs('EPSG:22182', 'EPSG:4326', always_xy=True)

    def test_metadatos(self):
        m = self.datos['meta']
        self.assertEqual(m['crs'], 'EPSG:22182')
        self.assertEqual(m['destino'], 'EPSG:4326')
        self.assertIn('Este', m['ejes'])

    def test_hay_vectores_suficientes(self):
        self.assertGreaterEqual(len(self.datos['posgar']), 50)
        self.assertGreaterEqual(len(self.datos['gms']), 10)

    def test_posgar_coincide_con_pyproj(self):
        for v in self.datos['posgar']:
            lon, lat = self.t.transform(v['x'], v['y'])
            self.assertAlmostEqual(lat, v['lat'], places=10, msg=str(v))
            self.assertAlmostEqual(lon, v['lon'], places=10, msg=str(v))

    def test_posgar_coincide_con_coord_utils_del_padron(self):
        """coord_utils.gk_faja2_a_wgs84 (la funcion con la que se generan lat/lon del padron, redondeada a 5 decimales)."""
        from coord_utils import gk_faja2_a_wgs84
        for v in self.datos['posgar']:
            lat5, lon5 = gk_faja2_a_wgs84(v['x'], v['y'])
            self.assertAlmostEqual(lat5, round(v['lat'], 5), places=9, msg=str(v))
            self.assertAlmostEqual(lon5, round(v['lon'], 5), places=9, msg=str(v))

    def test_meridiano_central_es_menos_69(self):
        centro = [v for v in self.datos['posgar'] if v['x'] == 2500000][0]
        self.assertAlmostEqual(centro['lon'], -69.0, places=10)

    def test_gms_decimal_exacto(self):
        for v in self.datos['gms']:
            for eje in ('lat', 'lon'):
                c = v[eje]
                exacto = Fraction(c['g']) + Fraction(c['m'], 60) + Fraction(str(c['s'])) / 3600
                if c['h'] in ('S', 'O', 'W'):
                    exacto = -exacto
                self.assertAlmostEqual(float(exacto), v[eje + 'Decimal'], places=13, msg=str(v))

    def test_ejemplo_del_pedido(self):
        v = self.datos['gms'][0]
        self.assertEqual(v['lat'], {'g': 32, 'm': 53, 's': 10.2, 'h': 'S'})
        self.assertAlmostEqual(v['latDecimal'], -32.88616666666667, places=12)
        self.assertAlmostEqual(v['lonDecimal'], -68.84038888888889, places=12)


if __name__ == '__main__':
    unittest.main()
