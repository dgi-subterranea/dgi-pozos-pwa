#!/usr/bin/env python3
"""Lote intermedio de validacion (100 fotos): seleccion repartida, exclusion de lo ya migrado y bloqueos del dry-run."""
import collections
import csv
import io
import json
import random
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import fotos_comun as C  # noqa: E402
import importar as I  # noqa: E402
import normalizar as N  # noqa: E402
from test_subida import LoteBase  # noqa: E402


def corpus(n=2400, semilla=5):
    r = random.Random(semilla)
    filas = []
    for i in range(n):
        mon = i % 5 < 2
        estado = r.choice([C.ESTADO_CONFIRMADO] * 9 + [C.ESTADO_POR_REVISAR])
        anio = str(r.choice([2023, 2024, 2025, 2026])) if mon else str(r.choice([2018, 2019]))
        filas.append({
            'sha1': '%040x' % (i + 1), 'copias': ['Carpeta/%d.JPG' % i], 'nCopias': 1, 'copiasEnCarpetas': ['Carpeta'],
            'tam': int(r.choice([60e3, 200e3, 500e3, 900e3, 1.5e6, 3e6, 8e6, 20e6]) + r.randint(0, 50000)),
            'formato': 'JPEG', 'fuente': 'MONITOREO_NE' if mon else 'RELEVAMIENTO_2018',
            'tipoFoto': ('CERCA' if i % 2 else 'PANORAMICA') if mon else 'OTRA',
            'wellId': '%02d-%04d' % (1 + i % 19, i % 900) if estado == C.ESTADO_CONFIRMADO else None,
            'estado': estado, 'motivos': [] if estado == C.ESTADO_CONFIRMADO else ['SIN_ID'], 'flags': [],
            'fuenteValidacionId': r.choice(['PADRON', 'AMBAS']), 'gps': [-33.0, -68.0] if r.random() < 0.06 else None,
            'gpsEstado': 'SIN_GPS', 'orientacionExif': 1, 'camara': None, 'indicioMonitoreo': None, 'confianza': 'MEDIA',
            'fecha': {'valor': anio if mon else '%s-05-0%d' % (anio, 1 + i % 9), 'precision': 'ANIO' if mon else 'DIA',
                      'fuente': 'NOMBRE_ANIO' if mon else 'EXIF', 'flags': []},
        })
    return filas


class SeleccionValidacion100Tests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.filas = corpus()
        cls.por = {f['sha1']: f for f in cls.filas}
        cls.sel = N.muestra_validacion100(cls.filas)
        cls.fs = [cls.por[s] for s in cls.sel]

    def test_son_100_unicas_y_solo_confirmadas(self):
        self.assertEqual(len(self.sel), 100)
        self.assertEqual(len(set(self.sel)), 100)
        self.assertEqual({f['estado'] for f in self.fs}, {C.ESTADO_CONFIRMADO})

    def test_excluye_lo_ya_migrado(self):
        migrados = set(list(self.sel)[:40])
        otra = N.muestra_validacion100(self.filas, excluir_sha1=migrados)
        self.assertEqual(len(otra), 100)
        self.assertFalse(migrados & set(otra))

    def test_reparto_por_fuente_y_tipo(self):
        c = collections.Counter(f['fuente'] for f in self.fs)
        self.assertEqual((c['MONITOREO_NE'], c['RELEVAMIENTO_2018']), (45, 55))
        t = collections.Counter(f['tipoFoto'] for f in self.fs)
        self.assertEqual((t['CERCA'], t['PANORAMICA'], t['OTRA']), (22, 23, 55))

    def test_anios_repartidos_dentro_de_cada_fuente(self):
        for fuente, anios in (('MONITOREO_NE', {'2023', '2024', '2025', '2026'}), ('RELEVAMIENTO_2018', {'2018', '2019'})):
            cuenta = collections.Counter(f['fecha']['valor'][:4] for f in self.fs if f['fuente'] == fuente)
            self.assertEqual(set(cuenta), anios)
            self.assertGreaterEqual(min(cuenta.values()), 0.6 * sum(cuenta.values()) / len(anios))

    def test_con_y_sin_gps(self):
        con = sum(1 for f in self.fs if f['gps'])
        self.assertEqual(con, 12)
        self.assertEqual({f['fuente'] for f in self.fs if f['gps']}, {'MONITOREO_NE', 'RELEVAMIENTO_2018'})

    def test_tamanos_repartidos_en_todo_el_rango(self):
        tams = sorted(f['tam'] for f in self.fs)
        universo = sorted(f['tam'] for f in self.filas if f['estado'] == C.ESTADO_CONFIRMADO)
        cortes = [universo[len(universo) * k // 4] for k in (1, 2, 3)]
        cuartiles = collections.Counter(sum(1 for c in cortes if t >= c) for t in tams)
        self.assertEqual(set(cuartiles), {0, 1, 2, 3})
        self.assertTrue(all(v >= 15 for v in cuartiles.values()), cuartiles)

    def test_pozos_y_departamentos_lo_mas_variados_posible(self):
        pozos = collections.Counter(f['wellId'] for f in self.fs)
        self.assertGreaterEqual(len(pozos), 97)
        self.assertLessEqual(max(pozos.values()), 2)
        self.assertGreaterEqual(len({f['wellId'][:2] for f in self.fs}), 17)

    def test_reproducible_y_la_semilla_cambia_el_lote(self):
        self.assertEqual(list(self.sel), list(N.muestra_validacion100(self.filas)))
        self.assertNotEqual(list(self.sel), list(N.muestra_validacion100(self.filas, semilla=99)))

    def test_nunca_toma_por_revisar_ni_sin_pozo(self):
        self.assertTrue(all(f['wellId'] for f in self.fs))
        mezcla = [dict(f) for f in self.filas]
        for f in mezcla[:50]:
            f['estado'] = C.ESTADO_POR_REVISAR
        sel = N.muestra_validacion100(mezcla)
        self.assertTrue(all(self.por[s]['estado'] == C.ESTADO_CONFIRMADO for s in sel if s not in {f['sha1'] for f in mezcla[:50]}))
        self.assertFalse({f['sha1'] for f in mezcla[:50]} & set(sel))

    def test_resumen_del_lote(self):
        r = N.resumen_lote(self.sel, self.filas)
        self.assertEqual(r['total'], 100)
        self.assertEqual(r['conGps'] + r['sinGps'], 100)
        self.assertEqual(r['estado'], {C.ESTADO_CONFIRMADO: 100})
        self.assertLessEqual(r['tamanoOriginalBytes']['min'], r['tamanoOriginalBytes']['mediana'])

    def test_sha1_ya_migrados_lee_solo_lotes_con_subidas_confirmadas(self):
        with tempfile.TemporaryDirectory() as t:
            base = Path(t)
            for nombre, estados in (('subido', ['SUBIDA', 'YA_EXISTE', 'FALLIDA']), ('sin_subir', [])):
                d = base / nombre
                d.mkdir()
                man = [{'fotoId': C.foto_id('%040x' % k), 'sha1': '%040x' % k} for k in range(3)]
                (d / 'manifiesto_privado.json').write_text(json.dumps(man), encoding='utf-8')
                if estados:
                    (d / 'estado_subida.jsonl').write_text('\n'.join(json.dumps({'fotoId': man[i]['fotoId'], 'estado': e}) for i, e in enumerate(estados)) + '\n', encoding='utf-8')
            self.assertEqual(N.sha1_ya_migrados(base), {'%040x' % 0, '%040x' % 1})


class DryRunBloqueosTests(LoteBase):
    def _csv(self, filas):
        cols = ['fotoId', 'wellId', 'monitoringId', 'sha1Original', 'emailUsuarioCarga']
        ruta = self.out / 'hoja.csv'
        with open(str(ruta), 'w', encoding='utf-8-sig', newline='') as f:
            w = csv.DictWriter(f, fieldnames=cols)
            w.writeheader()
            for fila in filas:
                w.writerow(dict({c: '' for c in cols}, **fila))
        return I.cargar_existentes(ruta)

    def _lote_previo(self, ids_confirmados, nombre='previo'):
        d = self.out / nombre
        d.mkdir()
        filas = [{'fotoId': i, 'wellId': '99-9999', 'monitoringId': '', 'sha1Original': 'e' * 40} for i in ids_confirmados]
        (d / 'filas_FotosPozos.json').write_text(json.dumps(filas), encoding='utf-8')
        (d / 'estado_subida.jsonl').write_text('\n'.join(json.dumps({'fotoId': i, 'estado': 'SUBIDA'}) for i in ids_confirmados) + '\n', encoding='utf-8')
        return d

    def test_sin_csv_no_es_concluyente(self):
        plan = I.planificar(self.lote)
        self.assertTrue(plan['resultado'].startswith('NO CONCLUYENTE'))

    def test_con_la_hoja_sin_coincidencias_y_sin_otros_lotes_es_apto(self):
        plan = I.planificar(self.lote, self._csv([]), lote_nuevo=True)
        self.assertEqual(plan['resultado'], 'APTO PARA SUBIR')
        self.assertEqual((plan['conflictos'], plan['progresoLocalPrevio']), (0, 0))
        self.assertIn('RESULTADO: APTO PARA SUBIR', I.informe(plan))

    def test_un_fotoid_en_la_hoja_bloquea(self):
        fid = I.planificar(self.lote)['elementos'][0]['fotoId']
        plan = I.planificar(self.lote, self._csv([{'fotoId': fid, 'wellId': '15-0268', 'sha1Original': 'f' * 40}]))
        self.assertEqual(plan['resultado'], 'BLOQUEADO')
        self.assertGreaterEqual(plan['conflictos'], 1)

    def test_mismo_contenido_ya_migrado_en_la_hoja_bloquea(self):
        fila = json.loads((self.lote / 'filas_FotosPozos.json').read_text(encoding='utf-8'))[0]
        plan = I.planificar(self.lote, self._csv([{'fotoId': '44444444-4444-4444-8444-444444444444', 'wellId': fila['wellId'], 'sha1Original': fila['sha1Original']}]))
        self.assertEqual(plan['resultado'], 'BLOQUEADO')

    def test_lo_ya_subido_por_otro_lote_bloquea_aunque_el_csv_este_desactualizado(self):
        filas = json.loads((self.lote / 'filas_FotosPozos.json').read_text(encoding='utf-8'))
        huella = self.dry_run()                                       # el plan queda guardado y vigente ANTES de que otro lote suba lo mismo
        previo = self.out / 'previo'
        previo.mkdir()
        (previo / 'filas_FotosPozos.json').write_text(json.dumps(filas[:2]), encoding='utf-8')
        (previo / 'estado_subida.jsonl').write_text('\n'.join(json.dumps({'fotoId': f['fotoId'], 'estado': 'SUBIDA'}) for f in filas[:2]) + '\n', encoding='utf-8')
        plan = I.planificar(self.lote, self._csv([]))
        self.assertEqual(plan['resultado'], 'BLOQUEADO')
        self.assertEqual(plan['cruceConOtrosLotes']['coincidencias'], 2)
        self.assertEqual(plan['cruceConOtrosLotes']['lotesConSubidas'], ['previo'])
        self.assertTrue(any('ya subida por el lote previo' in e for e in plan['errores']))
        with self.assertRaises(I.ErrorImportacion) as cm:            # y la subida se niega aunque el plan guardado fuera valido
            I.verificar_plan(self.lote, huella)
        self.assertIn('errores', str(cm.exception))

    def test_el_mismo_contenido_en_otro_lote_con_otro_fotoid_tambien_bloquea(self):
        fila = json.loads((self.lote / 'filas_FotosPozos.json').read_text(encoding='utf-8'))[0]
        previo = self.out / 'previo'
        previo.mkdir()
        otra = dict(fila, fotoId='55555555-5555-4555-8555-555555555555')
        (previo / 'filas_FotosPozos.json').write_text(json.dumps([otra]), encoding='utf-8')
        (previo / 'estado_subida.jsonl').write_text(json.dumps({'fotoId': otra['fotoId'], 'estado': 'YA_EXISTE'}) + '\n', encoding='utf-8')
        plan = I.planificar(self.lote)
        self.assertTrue(any('mismo contenido ya fue migrado' in e for e in plan['errores']))

    def test_csv_desactualizado_sin_las_fotos_de_otro_lote_no_es_concluyente(self):
        self._lote_previo(['66666666-6666-4666-8666-666666666666'])
        plan = I.planificar(self.lote, self._csv([]))
        self.assertEqual(plan['hojaSinFotosDeOtrosLotes'], 1)
        self.assertTrue(plan['resultado'].startswith('NO CONCLUYENTE'))
        self.assertIn('ATENCION', I.informe(plan))
        actualizado = self._csv([{'fotoId': '66666666-6666-4666-8666-666666666666', 'wellId': '99-9999', 'sha1Original': 'e' * 40}])
        self.assertEqual(I.planificar(self.lote, actualizado)['resultado'], 'APTO PARA SUBIR')

    def test_progreso_local_en_un_lote_nuevo_bloquea_pero_en_una_reanudacion_solo_avisa(self):
        fid = I.planificar(self.lote)['elementos'][0]['fotoId']
        (self.lote / I.ESTADO_ARCHIVO).write_text(json.dumps({'fotoId': fid, 'estado': 'SUBIDA'}) + '\n', encoding='utf-8')
        nuevo = I.planificar(self.lote, self._csv([]), lote_nuevo=True)
        self.assertEqual(nuevo['resultado'], 'BLOQUEADO')
        self.assertTrue(any('progreso local inesperado' in e for e in nuevo['errores']))
        reanuda = I.planificar(self.lote, self._csv([]))
        self.assertEqual(reanuda['errores'], [])
        self.assertEqual(reanuda['progresoLocalPrevio'], 1)

    def test_el_estado_aunque_sea_solo_una_fallida_cuenta_como_progreso_inesperado_en_lote_nuevo(self):
        fid = I.planificar(self.lote)['elementos'][0]['fotoId']
        (self.lote / I.ESTADO_ARCHIVO).write_text(json.dumps({'fotoId': fid, 'estado': 'FALLIDA'}) + '\n', encoding='utf-8')
        self.assertEqual(I.planificar(self.lote, self._csv([]), lote_nuevo=True)['resultado'], 'BLOQUEADO')

    def test_rangos_de_tamano_y_gps_en_el_informe(self):
        plan = I.planificar(self.lote)
        self.assertLessEqual(plan['rangoPesoFinalBytes']['min'], plan['rangoPesoFinalBytes']['max'])
        self.assertIn('rangoPesoOriginalBytes', plan)
        texto = I.informe(plan)
        self.assertIn('Tamano de cada foto procesada', texto)
        self.assertRegex(texto, r'GPS historico: \d+ con GPS / \d+ sin GPS')

    def test_la_huella_no_cambia_por_nada_de_esto(self):
        a = I.planificar(self.lote)['huella']
        self._lote_previo(['77777777-7777-4777-8777-777777777777'])
        self.assertEqual(I.planificar(self.lote, self._csv([]), lote_nuevo=True)['huella'], a)

    def test_main_con_lote_nuevo_devuelve_el_codigo_segun_el_resultado(self):
        ruta = self.out / 'hoja.csv'
        ruta.write_text('fotoId,wellId,monitoringId,sha1Original\n', encoding='utf-8')
        with redirect_stdout(io.StringIO()) as salida:
            codigo = I.main(['--lote', 'lote', '--salida', str(self.out), '--dry-run', '--existentes', str(ruta), '--lote-nuevo'])
        self.assertEqual(codigo, 0)
        self.assertIn('RESULTADO: APTO PARA SUBIR', salida.getvalue())


if __name__ == '__main__':
    unittest.main()
