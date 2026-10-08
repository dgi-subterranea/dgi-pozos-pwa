#!/usr/bin/env python3
"""Seleccion productiva (produccion500): primeras N CONFIRMADAS pendientes por SHA-1, sin lo ya migrado."""
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import fotos_comun as C  # noqa: E402
import normalizar as N  # noqa: E402
from test_validacion100 import corpus  # noqa: E402


class SeleccionProduccionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.filas = corpus()
        cls.por = {f['sha1']: f for f in cls.filas}
        cls.sel = N.muestra_produccion(cls.filas)

    def test_son_500_unicas_en_orden_sha1_ascendente(self):
        claves = list(self.sel)
        self.assertEqual(len(claves), 500)
        self.assertEqual(len(set(claves)), 500)
        self.assertEqual(claves, sorted(claves))

    def test_son_exactamente_las_primeras_pendientes(self):
        elegibles = sorted(f['sha1'] for f in self.filas if f['estado'] == C.ESTADO_CONFIRMADO and f['wellId'])
        self.assertEqual(list(self.sel), elegibles[:500])

    def test_determinista_y_sin_azar(self):
        self.assertEqual(list(self.sel), list(N.muestra_produccion(self.filas)))
        mezcladas = list(reversed(self.filas))
        self.assertEqual(list(self.sel), list(N.muestra_produccion(mezcladas)))      # no depende del orden del corpus

    def test_nunca_entran_por_revisar_excluidas_ni_sin_pozo(self):
        mezcla = [dict(f) for f in self.filas]
        mezcla[0]['estado'] = C.ESTADO_POR_REVISAR
        mezcla[1]['estado'] = 'EXCLUIDA_IMPORTACION'
        mezcla[2]['estado'] = C.ESTADO_CONFIRMADO
        mezcla[2]['wellId'] = None
        sel = N.muestra_produccion(mezcla, n=len(mezcla))
        por = {f['sha1']: f for f in mezcla}
        self.assertEqual({por[s]['estado'] for s in sel}, {C.ESTADO_CONFIRMADO})
        self.assertTrue(all(por[s]['wellId'] for s in sel))
        for f in mezcla[:3]:
            self.assertNotIn(f['sha1'], sel)

    def test_excluye_lo_ya_migrado_y_completa_con_las_siguientes(self):
        migrados = set(list(self.sel)[:40])
        otra = N.muestra_produccion(self.filas, migrados)
        self.assertEqual(len(otra), 500)
        self.assertFalse(migrados & set(otra))
        self.assertEqual(list(otra)[:460], list(self.sel)[40:])                       # lo que seguia, sin saltos

    def test_tramos_consecutivos_no_se_pisan_y_cubren_todo(self):
        todos = N.muestra_produccion(self.filas, n=10 ** 6)
        primero = N.muestra_produccion(self.filas, n=500)
        resto = N.muestra_produccion(self.filas, set(primero), n=10 ** 6)
        self.assertFalse(set(primero) & set(resto))
        self.assertEqual(list(primero) + list(resto), list(todos))

    def test_n_configurable_y_si_hay_menos_devuelve_las_que_hay(self):
        self.assertEqual(len(N.muestra_produccion(self.filas, n=37)), 37)
        pocas = [f for f in self.filas if f['estado'] == C.ESTADO_CONFIRMADO and f['wellId']][:10]
        self.assertEqual(len(N.muestra_produccion(pocas)), 10)
        self.assertEqual(len(N.muestra_produccion([])), 0)

    def test_sha1_ya_migrados_deja_afuera_piloto_y_validacion(self):
        """Contrato con la exclusion real: el SHA-1 de toda foto SUBIDA / YA_EXISTE de cualquier lote queda fuera del tramo."""
        with tempfile.TemporaryDirectory() as t:
            base = Path(t)
            for nombre, sha_ini, estado in (('piloto30', 0, 'SUBIDA'), ('validacion100', 10, 'YA_EXISTE'), ('fallido', 20, 'FALLIDA')):
                d = base / nombre
                d.mkdir()
                (d / 'manifiesto_privado.json').write_text(json.dumps(
                    [{'fotoId': 'f%d' % (sha_ini + i), 'sha1': '%040x' % (sha_ini + i + 1)} for i in range(3)]), encoding='utf-8')
                (d / 'estado_subida.jsonl').write_text(
                    ''.join(json.dumps({'fotoId': 'f%d' % (sha_ini + i), 'estado': estado}) + chr(10) for i in range(3)), encoding='utf-8')
            migrados = N.sha1_ya_migrados(base)
            self.assertEqual(len(migrados), 6)                                        # las FALLIDAS no cuentan como migradas
            sel = N.muestra_produccion(self.filas, migrados, n=10 ** 6)
            self.assertFalse(migrados & set(sel))


if __name__ == '__main__':
    unittest.main()
