#!/usr/bin/env python3
"""Tests del lote piloto (muestra_piloto30) y del plan de importacion en seco (importar.py).

Ejecutar desde la raiz del repo:   python -m unittest discover -s scripts/fotos -p "test_*.py"
No necesita Fotos/ ni scripts/out/: arma imagenes y corpus sinteticos.
"""
import collections
import copy
import io
import json
import random
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import clasificar as K  # noqa: E402
import fotos_comun as C  # noqa: E402
import importar as I  # noqa: E402
import inventariar as V  # noqa: E402
import normalizar as N  # noqa: E402
import test_fotos as T  # noqa: E402


def corpus_sintetico(n=1800, semilla=11):
    """Corpus con todos los atributos que el lote piloto necesita cubrir."""
    r = random.Random(semilla)
    filas = []
    for i in range(n):
        mon = i % 3 == 0
        estado = r.choice([C.ESTADO_CONFIRMADO] * 9 + [C.ESTADO_POR_REVISAR, C.ESTADO_EXCLUIDA])
        gps = [-33.0, -68.0] if i % 9 == 0 else None
        if mon:
            fecha = {'valor': str(r.choice([2023, 2024, 2025, 2026])), 'precision': 'ANIO', 'fuente': 'NOMBRE_ANIO', 'flags': []}
        elif i % 211 == 5:
            fecha = {'valor': '2018-03', 'precision': 'MES', 'fuente': 'CARPETA', 'flags': []}
        elif i % 97 == 1:
            fecha = {'valor': '2018-04-03', 'precision': 'DIA', 'fuente': 'CARPETA', 'flags': []}
        elif i % 89 == 2:
            fecha = {'valor': '2018-05-03', 'precision': 'DIA', 'fuente': 'ARCHIVO', 'flags': ['FECHA_DE_ARCHIVO']}
        else:
            fecha = {'valor': '%d-0%d-1%d' % (r.choice([2018, 2019]), 1 + i % 9, i % 9), 'precision': 'DIA', 'fuente': 'EXIF', 'flags': []}
        filas.append({
            'sha1': '%040x' % i, 'copias': ['Carpeta/%d.JPG' % i], 'nCopias': 1, 'copiasEnCarpetas': ['Carpeta'],
            'tam': 400000, 'formato': 'PNG' if i % 400 == 7 else 'JPEG',
            'fuente': 'MONITOREO_NE' if mon else 'RELEVAMIENTO_2018',
            'tipoFoto': ('CERCA' if (i // 3) % 2 else 'PANORAMICA') if mon else 'OTRA',
            'wellId': '15-%04d' % (i % 500) if estado == C.ESTADO_CONFIRMADO else None,
            'estado': estado, 'motivos': [] if estado == C.ESTADO_CONFIRMADO else ['SIN_ID'],
            'fuenteValidacionId': r.choice(['PADRON', 'PADRON', 'AMBAS', 'RED_NE']),
            'gps': gps, 'gpsEstado': ('GPS_CONSISTENTE' if i % 18 == 0 else 'GPS_CERCANO') if gps else 'SIN_GPS',
            'orientacionExif': r.choice([1, 1, 6, 8]), 'flags': ['MUY_GRANDE'] if i % 300 == 11 else [], 'fecha': fecha,
            'camara': None, 'indicioMonitoreo': None,
        })
    return filas


class MuestraPiloto30Tests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.filas = corpus_sintetico()
        cls.por_sha = {f['sha1']: f for f in cls.filas}
        cls.sel = N.muestra_piloto30(cls.filas)
        cls.sel_filas = [cls.por_sha[s] for s in cls.sel]

    def test_son_unas_30_y_sin_repetidas(self):
        self.assertGreaterEqual(len(self.sel), 20)
        self.assertLessEqual(len(self.sel), 34)
        self.assertEqual(len(set(self.sel)), len(self.sel))

    def test_solo_confirmado_nunca_por_revisar_ni_excluida(self):
        self.assertEqual({f['estado'] for f in self.sel_filas}, {C.ESTADO_CONFIRMADO})
        self.assertTrue(all(f['wellId'] for f in self.sel_filas))

    def test_cubre_lo_pedido(self):
        cov = N.cobertura(self.sel, self.filas)
        self.assertEqual(set(cov['fuente']), {'MONITOREO_NE', 'RELEVAMIENTO_2018'})
        self.assertEqual(set(cov['tipoFoto']), {'CERCA', 'PANORAMICA', 'OTRA'})
        self.assertEqual(set(cov['fechaPrecision']), {'DIA', 'MES', 'ANIO'})
        self.assertTrue({'EXIF', 'CARPETA', 'ARCHIVO', 'NOMBRE_ANIO'} <= set(cov['fechaFuente']))
        self.assertIn('GPS_CONSISTENTE', cov['gps'])
        self.assertIn('GPS_CERCANO', cov['gps'])
        self.assertTrue({'PADRON', 'RED_NE'} <= set(cov['validadoContra']))
        self.assertIn('PNG', cov['formato'])
        self.assertGreaterEqual(cov['pozosConVariasFotos'], 1)
        self.assertGreaterEqual(cov['pozosConAmbasFuentes'], 1)

    def test_incluye_fotos_muy_grandes_y_orientacion_6_u_8(self):
        self.assertTrue(any('MUY_GRANDE' in f['flags'] for f in self.sel_filas))
        self.assertTrue(any(f['orientacionExif'] in (6, 8) for f in self.sel_filas))

    def test_reproducible_y_la_semilla_cambia_el_lote(self):
        self.assertEqual(list(self.sel), list(N.muestra_piloto30(self.filas)))
        self.assertNotEqual(list(self.sel), list(N.muestra_piloto30(self.filas, 99)))

    def test_excluir_wells_los_deja_afuera(self):
        usados = {f['wellId'] for f in self.sel_filas}
        otra = N.muestra_piloto30(self.filas, excluir_wells=usados)
        self.assertFalse(usados & {self.por_sha[s]['wellId'] for s in otra})

    def test_incluir_wells_los_agrega_con_su_foto_confirmada(self):
        candidatos = sorted({f['wellId'] for f in self.filas if f['estado'] == C.ESTADO_CONFIRMADO and f['wellId'] not in {x['wellId'] for x in self.sel_filas}})[:2]
        sel = N.muestra_piloto30(self.filas, incluir_wells=candidatos)
        presentes = {self.por_sha[s]['wellId'] for s in sel}
        self.assertTrue(set(candidatos) <= presentes)
        self.assertTrue(all(self.por_sha[s]['estado'] == C.ESTADO_CONFIRMADO for s in sel))

    def test_los_pozos_pedidos_que_no_entran_se_informan(self):
        otros = {f['wellId'] for f in self.filas if f['estado'] == C.ESTADO_CONFIRMADO}
        pedidos = ['99-9999', sorted(otros)[0]]
        sel = N.muestra_piloto30(self.filas, incluir_wells=pedidos)
        self.assertEqual(N.pozos_pedidos_sin_foto(self.filas, sel, pedidos), ['99-9999'])

    def test_los_pozos_pedidos_no_rompen_la_representatividad(self):
        base = N.muestra_piloto30(self.filas)
        pedidos = sorted({f['wellId'] for f in self.filas if f['estado'] == C.ESTADO_CONFIRMADO and f['wellId'] not in {self.por_sha[s]['wellId'] for s in base}})[:2]
        con = N.muestra_piloto30(self.filas, incluir_wells=pedidos)
        # todas las fotos del lote base siguen estando (los pedidos se SUMAN, no desplazan a nadie)
        self.assertTrue(set(base) <= set(con))
        self.assertEqual(len(con) - len(base), len(pedidos))
        self.assertEqual(N.cobertura(con, self.filas)['estado'], {C.ESTADO_CONFIRMADO: len(con)})

    def test_incluir_un_pozo_sin_fotos_confirmadas_se_ignora(self):
        w = next(f['wellId'] or 'XX' for f in self.filas if f['estado'] != C.ESTADO_CONFIRMADO)
        self.assertEqual(list(N.muestra_piloto30(self.filas, incluir_wells=['99-9999'])), list(self.sel))
        self.assertIsNotNone(w)


class ImportarDryRunTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.raiz = Path(cls.tmp.name) / 'Fotos'
        rutas = T.armar_fotos(cls.raiz)
        items = [V.procesar(cls.raiz, r) for r in rutas]
        inv = {'archivos': [i for i in items if i['formato'] != 'OTRO'], 'noImagenes': [i for i in items if i['formato'] == 'OTRO']}
        cls.filas, _ = K.clasificar_inventario(inv, T.refs_demo(), cls.raiz)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def setUp(self):
        self.t = tempfile.TemporaryDirectory()
        self.out = Path(self.t.name)
        sel = collections.OrderedDict((f['sha1'], {'categoria': 'LOTE', 'estrato': None}) for f in self.filas)   # incluye POR_REVISAR y EXCLUIDA
        with redirect_stdout(io.StringIO()):
            N.ejecutar(self.filas, sel, self.out / 'lote', self.raiz, 'LOTE-TEST', medir=False)
        self.lote = self.out / 'lote'

    def tearDown(self):
        self.t.cleanup()

    def _filas(self):
        return json.loads((self.lote / 'filas_FotosPozos.json').read_text(encoding='utf-8'))

    def _guardar(self, filas):
        (self.lote / 'filas_FotosPozos.json').write_text(json.dumps(filas), encoding='utf-8')

    def test_lote_valido_sin_errores_y_solo_confirmado(self):
        plan = I.planificar(self.lote)
        self.assertEqual(plan['errores'], [])
        self.assertGreater(plan['cantidad'], 0)
        self.assertTrue(all(e['fotoId'] in {f['fotoId'] for f in self._filas()} for e in plan['elementos']))
        # las POR_REVISAR / EXCLUIDA del manifiesto no entran al plan: se cuentan como omitidas
        self.assertTrue(sum(plan['omitidasPorEstado'].values()) > 0)
        self.assertNotIn(C.ESTADO_CONFIRMADO, plan['omitidasPorEstado'])

    def test_rutas_de_destino_solo_con_fotoid(self):
        plan = I.planificar(self.lote)
        for e in plan['elementos']:
            partes = e['destino'].split('/')
            self.assertEqual(partes[0], 'FotosPozos')
            self.assertIn(partes[1], ('MONITOREO_NE', 'RELEVAMIENTO_2018'))
            self.assertRegex(partes[2], r'^(20\d{2}|sin_fecha)$')
            self.assertEqual(partes[3], e['fotoId'] + '.jpg')
            self.assertEqual(e['destinoThumb'].split('/')[3], e['fotoId'] + '_thumb.jpg')

    def test_carpeta_sin_fecha_y_con_anio(self):
        base = {'fechaFotoPrecision': 'DESCONOCIDA', 'fechaFotoValor': ''}
        self.assertEqual(I.carpeta_fecha(base), 'sin_fecha')
        self.assertEqual(I.carpeta_fecha({'fechaFotoPrecision': 'ANIO', 'fechaFotoValor': '2018'}), '2018')
        self.assertEqual(I.carpeta_fecha({'fechaFotoPrecision': 'MES', 'fechaFotoValor': '2018-03'}), '2018')

    def test_el_plan_es_determinista_y_idempotente(self):
        a, b = I.planificar(self.lote), I.planificar(self.lote)
        self.assertEqual(a['huella'], b['huella'])
        self.assertEqual([e['fotoId'] for e in a['elementos']], [e['fotoId'] for e in b['elementos']])

    def test_rechaza_una_fila_que_no_es_confirmada(self):
        filas = self._filas()
        filas[0]['estadoVinculo'] = 'POR_REVISAR'
        self._guardar(filas)
        self.assertTrue(any('CONFIRMADO' in e for e in I.planificar(self.lote)['errores']))

    def test_rechaza_una_fila_sin_registro_confirmado_en_el_manifiesto(self):
        man = json.loads((self.lote / 'manifiesto_privado.json').read_text(encoding='utf-8'))
        excl = next(r for r in man if r['estado'] == C.ESTADO_EXCLUIDA)
        filas = self._filas()
        extra = copy.deepcopy(filas[0])
        extra['fotoId'] = excl['fotoId']
        filas.append(extra)
        self._guardar(filas)
        errores = ' | '.join(I.planificar(self.lote)['errores'])
        self.assertIn('manifiesto', errores)

    def test_rechaza_fotoid_repetido(self):
        filas = self._filas()
        filas.append(copy.deepcopy(filas[0]))
        self._guardar(filas)
        self.assertTrue(any('repetido' in e for e in I.planificar(self.lote)['errores']))

    def test_detecta_un_archivo_con_metadatos(self):
        f = self._filas()[0]
        ruta = self.lote / 'normalizado' / (f['fotoId'] + '.jpg')
        datos = ruta.read_bytes()
        com = b'\xff\xfe\x00\x08hola'                     # segmento COM (comentario)
        ruta.write_bytes(datos[:2] + com + datos[2:])
        errores = ' | '.join(I.planificar(self.lote)['errores'])
        self.assertIn('metadatos', errores)

    def test_detecta_archivo_faltante_o_que_no_es_jpeg(self):
        filas = self._filas()
        (self.lote / 'thumbs' / (filas[0]['fotoId'] + '_thumb.jpg')).unlink()
        (self.lote / 'normalizado' / (filas[1]['fotoId'] + '.jpg')).write_bytes(b'no soy un jpeg')
        errores = ' | '.join(I.planificar(self.lote)['errores'])
        self.assertIn('falta el archivo', errores)
        self.assertIn('no es un JPEG', errores)

    def test_detecta_rastros_de_nombres_o_rutas_originales_en_la_fila(self):
        filas = self._filas()
        filas[0]['loteImportacion'] = 'Relevamiento 2018/Todos/15 0103 Apellido.JPG'
        self._guardar(filas)
        self.assertTrue(any('ruta o nombre de archivo' in e for e in I.planificar(self.lote)['errores']))

    def test_no_acepta_observacion_ni_ids_de_drive_en_un_lote_nuevo(self):
        filas = self._filas()
        filas[0]['observacion'] = 'Fulano'
        filas[1]['driveFileId'] = 'abc'
        self._guardar(filas)
        errores = ' | '.join(I.planificar(self.lote)['errores'])
        self.assertIn('observacion', errores)
        self.assertIn('ids de Drive', errores)

    def test_valida_fecha_y_precision(self):
        filas = self._filas()
        filas[0]['fechaFotoPrecision'] = 'ANIO'
        filas[0]['fechaFotoValor'] = '2018-04-03'
        self._guardar(filas)
        self.assertTrue(any('no corresponde a la precision' in e for e in I.planificar(self.lote)['errores']))

    def test_entidad_siempre_por_wellid(self):
        filas = self._filas()
        filas[0]['monitoringId'] = 'INA 1'
        self._guardar(filas)
        self.assertTrue(any('wellId' in e for e in I.planificar(self.lote)['errores']))

    def test_avisa_de_archivos_sin_fila_y_no_los_incluye(self):
        (self.lote / 'normalizado' / 'suelto.jpg').write_bytes(b'\xff\xd8\xff\xd9')
        plan = I.planificar(self.lote)
        self.assertTrue(any('sin fila' in a for a in plan['avisos']))
        self.assertNotIn('suelto', json.dumps(plan['elementos']))

    def test_informe_no_contiene_nombres_ni_rutas_originales(self):
        plan = I.planificar(self.lote)
        texto = I.informe(plan).lower() + json.dumps(plan).lower()
        for tabu in ('apellido', 'otroapellido', 'dcim', 'relevamiento 2018/', 'monitoreo/2026', '.thm', 'todos/'):
            self.assertNotIn(tabu, texto)

    def test_main_exige_dry_run_y_escribe_el_plan(self):
        with redirect_stdout(io.StringIO()):
            self.assertEqual(I.main(['--lote', 'lote', '--salida', str(self.out)]), 2)       # sin --dry-run: se niega
            self.assertEqual(I.main(['--lote', 'lote', '--salida', str(self.out), '--dry-run']), 0)
        self.assertTrue((self.lote / 'plan_importacion.json').is_file())
        self.assertTrue((self.lote / 'reporte_dryrun.txt').is_file())

    def test_main_devuelve_error_si_el_lote_tiene_problemas(self):
        filas = self._filas()
        filas[0]['estado'] = 'OCULTA'
        self._guardar(filas)
        with redirect_stdout(io.StringIO()):
            self.assertEqual(I.main(['--lote', 'lote', '--salida', str(self.out), '--dry-run']), 1)

    def test_dry_run_no_modifica_imagenes_ni_filas(self):
        antes = {p.name: p.read_bytes() for p in (self.lote / 'normalizado').iterdir()}
        filas = (self.lote / 'filas_FotosPozos.json').read_bytes()
        with redirect_stdout(io.StringIO()):
            I.main(['--lote', 'lote', '--salida', str(self.out), '--dry-run'])
        self.assertEqual(antes, {p.name: p.read_bytes() for p in (self.lote / 'normalizado').iterdir()})
        self.assertEqual(filas, (self.lote / 'filas_FotosPozos.json').read_bytes())


if __name__ == '__main__':
    unittest.main()
