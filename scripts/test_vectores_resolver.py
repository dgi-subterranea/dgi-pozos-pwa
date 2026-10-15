# -*- coding: utf-8 -*-
"""El fixture js/fixtures/resolver_ubicacion_vectores.json (referencia de paridad del resolver de ubicacion que usa
js/ubicacionFuenteDecisionesLogic.js) tiene que seguir siendo EXACTAMENTE lo que da el resolver REAL de Python
(scripts/reindex_pozos.py::resolver_ubicacion): si alguien lo edita a mano, o cambia un umbral o el desempate del indexador, esto falla antes de
que los tests de Jest den por buena una referencia vieja. Ejecutar: python -m unittest discover -s scripts -p "test_vectores_resolver.py"
"""
import json
import os
import unittest

import gen_vectores_resolver_ubicacion as gen
import reindex_pozos as rp
from coord_utils import gk_faja2_a_wgs84

RUTA = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'js', 'fixtures', 'resolver_ubicacion_vectores.json')


class TestVectoresResolver(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with open(RUTA, encoding='utf-8') as f:
            cls.datos = json.load(f)

    def test_umbrales_del_fixture_son_los_del_indexador(self):
        u = self.datos['meta']['umbrales']
        self.assertEqual(u['corroboracionM'], rp.UBICACION_UMBRAL_CORROBORACION_M)
        self.assertEqual(u['dudosoM'], rp.UBICACION_UMBRAL_DUDOSO_M)
        self.assertEqual(u['graveM'], rp.UBICACION_UMBRAL_GRAVE_M)
        self.assertEqual((u['corroboracionM'], u['dudosoM'], u['graveM']), (10.0, 50.0, 500.0))

    def test_hay_casos_de_todos_los_estados(self):
        estados = {c['esperado']['estado'] for c in self.datos['resolver']}
        self.assertEqual(estados, {'sinCoordenadas', 'unica', 'corroborada', 'dudosoLeve', 'revisar', 'revisarGrave'})
        estados = {c['esperado']['estado'] for c in self.datos['descartes']}
        self.assertEqual(estados, {'sinCoordenadas', 'unica', 'corroborada', 'dudosoLeve', 'revisar', 'revisarGrave'})

    def test_cantidad_minima(self):
        self.assertGreaterEqual(len(self.datos['resolver']), 300)
        self.assertGreaterEqual(len(self.datos['descartes']), 150)

    def test_resolver_coincide_con_python_actual(self):
        for c in self.datos['resolver']:
            self.assertEqual(gen.resolver_python(c['fuentes']), c['esperado'], msg=c['id'])

    def test_descartes_coinciden_con_python_actual_sobre_las_que_quedan(self):
        for c in self.datos['descartes']:
            # la decision recae sobre la identidad (tipo + x + y): `descartadas` ya incluye todas las filas con la misma identidad
            claves = {gen.clave(c['fuentes'][i]) for i in c['descartadas']}
            self.assertEqual({i for i, f in enumerate(c['fuentes']) if gen.clave(f) in claves}, set(c['descartadas']), msg=c['id'])
            restantes = [f for i, f in enumerate(c['fuentes']) if i not in c['descartadas']]
            self.assertEqual(gen.resolver_python(restantes), c['esperado'], msg=c['id'])
            self.assertEqual(gen.resolver_python(c['fuentes']), c['esperadoSinDescartes'], msg=c['id'])

    def test_lat_lon_de_las_fuentes_son_las_del_padron(self):
        for c in self.datos['resolver'] + self.datos['descartes']:
            for f in c['fuentes']:
                self.assertEqual(gk_faja2_a_wgs84(f['x'], f['y']), (f['lat'], f['lon']), msg=c['id'])

    def test_orden_de_fuentes_reporte_primero_y_una_sola_vez(self):
        for c in self.datos['resolver'] + self.datos['descartes']:
            tipos = [f['tipo'] for f in c['fuentes']]
            self.assertLessEqual(tipos.count('REPORTE_POZOS'), 1, msg=c['id'])
            if 'REPORTE_POZOS' in tipos:
                self.assertEqual(tipos[0], 'REPORTE_POZOS', msg=c['id'])

    def test_el_fixture_es_exactamente_lo_que_genera_el_script(self):
        """Determinista: regenerar da lo mismo que lo guardado (nadie lo edito a mano)."""
        regenerado = json.loads(json.dumps(gen.generar()))
        self.assertEqual(regenerado, self.datos)

    def test_bordes_de_umbral_presentes(self):
        por_id = {c['id']: c['esperado'] for c in self.datos['resolver']}
        self.assertEqual(por_id['par-10.0']['estado'], 'corroborada')       # <= 10 m exacto
        self.assertEqual(por_id['par-10.001']['estado'], 'dudosoLeve')
        self.assertEqual(por_id['par-50.0']['estado'], 'dudosoLeve')        # <= 50 m exacto
        self.assertEqual(por_id['par-50.001']['estado'], 'revisar')
        self.assertEqual(por_id['par-500.0']['estado'], 'revisar')          # <= 500 m exacto
        self.assertEqual(por_id['par-500.001']['estado'], 'revisarGrave')

    def test_redondeo_half_even_de_python_esta_en_los_vectores(self):
        por_id = {c['id']: c['esperado'] for c in self.datos['resolver']}
        self.assertEqual(por_id['redondeo-12.25']['distanciaMaxima'], 12.2)      # empate exacto: half-even
        self.assertEqual(por_id['redondeo-0.15']['distanciaCorroboracion'], 0.1)  # 0.15 no es representable: queda por debajo


if __name__ == '__main__':
    unittest.main()
