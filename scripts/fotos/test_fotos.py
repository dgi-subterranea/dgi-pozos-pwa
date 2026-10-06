#!/usr/bin/env python3
"""Tests del pipeline de fotos (unittest de la libreria estandar; requiere Pillow y numpy).

Ejecutar desde la raiz del repo:   python -m unittest discover -s scripts/fotos -p "test_*.py"
No necesita la carpeta Fotos/ ni scripts/out/: arma sus propias imagenes y referencias sinteticas.
"""
import csv
import datetime as dt
import json
import os
import random
import sys
import tempfile
import unittest
from io import BytesIO
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from PIL import Image  # noqa: E402

import clasificar as K  # noqa: E402
import fotos_comun as C  # noqa: E402
import inventariar as V  # noqa: E402
import normalizar as N  # noqa: E402
import revision as R  # noqa: E402

BASE = (-33.0, -68.8)
GRADO_M = 6371000 * 3.141592653589793 / 180


def al_norte(metros):
    return (BASE[0] + metros / GRADO_M, BASE[1])


def refs_demo():
    return C.Referencias(
        padron=['15-0103', '15-0579', '06-0001', '07-0001'],
        ne_wellids=['06-0001', '04-0577', '03-0869'],           # 04-0577 y 03-0869: solo en la red NE
        coords_mapa={'15-0103': BASE, '06-0001': BASE},
        coords_ne={'04-0577': BASE},
        ne_por_ina={'901': ['7'], '55': ['3', '4']},
        ne_ids=['7', '903', '4', '77', '3'])


def jpeg_bytes(ancho=64, alto=48, exif=None, color=(120, 160, 90), ruido=False):
    if ruido:
        r = random.Random(1)
        datos = bytes(r.getrandbits(8) for _ in range(ancho * alto * 3))
        im = Image.frombytes('RGB', (ancho, alto), datos)
    else:
        im = Image.new('RGB', (ancho, alto), color)
    buf = BytesIO()
    im.save(buf, 'JPEG', quality=90, **({'exif': exif} if exif is not None else {}))
    return buf.getvalue()


def exif_demo(orientacion=None, fecha=None, gps=None, marca=None):
    ex = Image.Exif()
    if orientacion:
        ex[0x0112] = orientacion
    if marca:
        ex[0x010F] = marca
    if fecha:
        ex.get_ifd(0x8769)[0x9003] = fecha
    if gps:
        g = ex.get_ifd(0x8825)
        g[1], g[3] = ('S' if gps[0] < 0 else 'N'), ('W' if gps[1] < 0 else 'E')
        g[2] = (abs(gps[0]), 0.0, 0.0)
        g[4] = (abs(gps[1]), 0.0, 0.0)
    return ex


class NombresTests(unittest.TestCase):
    def test_id_de_nombre_normaliza_y_valida_departamento(self):
        deptos = {'01', '06', '15'}
        self.assertEqual(C.id_de_nombre('6 777 (2).jpg', deptos), '06-0777')
        self.assertEqual(C.id_de_nombre('15 096 Apellido, N. C..jpg', deptos), '15-0096')
        self.assertEqual(C.id_de_nombre('15 1111_Cerca_2025.jpg', deptos), '15-1111')
        self.assertIsNone(C.id_de_nombre('20200101_000001.jpg', deptos))
        self.assertIsNone(C.id_de_nombre('IMG_9002.JPG', deptos))
        self.assertIsNone(C.id_de_nombre('15 ..... sin dato.JPG', deptos))
        self.assertIsNone(C.id_de_nombre('99 1234.jpg', deptos))          # 99 no es un departamento

    def test_no_toma_el_numero_si_hay_mas_de_4_digitos(self):
        self.assertIsNone(C.id_de_nombre('15 12345.jpg', {'15'}))

    def test_tipo_foto(self):
        self.assertEqual(C.tipo_foto('6 8000_Cerca_2025.jpeg', 'MONITOREO_NE'), 'CERCA')
        self.assertEqual(C.tipo_foto('6 900_PANO_2024.JPG', 'MONITOREO_NE'), 'PANORAMICA')
        self.assertEqual(C.tipo_foto('XX_Cerca_2024.JPG', 'MONITOREO_NE'), 'CERCA')
        self.assertEqual(C.tipo_foto('IMG_1.JPG', 'MONITOREO_NE'), 'OTRA')
        # Relevamiento 2018: OTRA salvo informacion explicita (aunque el nombre diga "cerca")
        self.assertEqual(C.tipo_foto('15 096 cerca_Pano_.jpg', 'RELEVAMIENTO_2018'), 'OTRA')

    def test_indicio_monitoreo_solo_sugiere(self):
        refs = refs_demo()
        self.assertEqual(C.indicio_monitoreo('INA 901_Cerca_2026.jpg', refs), {'tipo': 'INA', 'valor': '901', 'sugerencias': ['7']})
        self.assertEqual(C.indicio_monitoreo('INA 55_Pano_2025.jpg', refs)['sugerencias'], ['3', '4'])
        self.assertEqual(C.indicio_monitoreo('77_Cerca_2025.jpg', refs), {'tipo': 'MON_NUM', 'valor': '77', 'sugerencias': ['77']})
        self.assertEqual(C.indicio_monitoreo('Mon903_Cerca_2023.JPG', refs)['sugerencias'], ['903'])
        self.assertEqual(C.indicio_monitoreo('Mon099_Cerca_2023.JPG', refs)['sugerencias'], [])
        self.assertIsNone(C.indicio_monitoreo('XX_Cerca_2024.JPG', refs))

    def test_solo_jpg_jpeg_png_son_fotos(self):
        for r in ('a/b.JPG', 'a/b.jpeg', 'a/b.Png'):
            self.assertTrue(C.es_foto_por_extension(r))
        for r in ('a/b.thm', 'a/b.info', 'a/b.avi', 'a/b.zip', 'a/b'):
            self.assertFalse(C.es_foto_por_extension(r))

    def test_fuente_de(self):
        self.assertEqual(C.fuente_de('Monitoreo/2026/DCIM/x.jpg'), 'MONITOREO_NE')
        self.assertEqual(C.fuente_de('Relevamiento 2018/Todos/x.jpg'), 'RELEVAMIENTO_2018')
        self.assertEqual(C.fuente_de('otra/x.jpg'), 'OTRA_FUENTE')

    def test_formato_por_contenido(self):
        self.assertEqual(C.formato_por_contenido(jpeg_bytes()[:8]), 'JPEG')
        self.assertEqual(C.formato_por_contenido(bytes([0x89, 0x50, 0x4E, 0x47, 13, 10, 26, 10])), 'PNG')
        self.assertEqual(C.formato_por_contenido(b'PK\x03\x04abcd'), 'OTRO')


class FechasTests(unittest.TestCase):
    def test_exif_valida(self):
        self.assertEqual(C.exif_valida('2018:05:22 10:11:12'), dt.datetime(2018, 5, 22, 10, 11, 12))
        self.assertIsNone(C.exif_valida('1980:01:01 00:00:00'))      # reloj sin configurar
        self.assertIsNone(C.exif_valida('2018:13:40 00:00:00'))
        self.assertIsNone(C.exif_valida('basura'))
        self.assertIsNone(C.exif_valida(None))
        self.assertIsNone(C.exif_valida('2099:01:01 00:00:00'))

    def test_fecha_de_carpeta_formatos(self):
        f = C.fecha_de_carpeta
        self.assertEqual(f('Relevamiento 2018/A-G/fotos valle de Uco/2018_04_03/x.jpg'), ('2018-04-03', 'DIA'))
        self.assertEqual(f('R/2018-06-28/x.jpg'), ('2018-06-28', 'DIA'))
        self.assertEqual(f('R/10_07_2018/x.jpg'), ('2018-07-10', 'DIA'))                # dd_mm_aaaa
        self.assertEqual(f('R/07 enero_2019/x.jpg'), ('2019-01-07', 'DIA'))
        self.assertEqual(f('R/03_2018 (73)/x.jpg'), (None, None))                        # sufijo "(73)": no se interpreta
        self.assertEqual(f('R/03_2018/x.jpg'), ('2018-03', 'MES'))
        self.assertEqual(f('R/04 al 06_09_2018/x.jpg'), ('2018-09', 'MES'))
        self.assertEqual(f('R/Todos/x.jpg'), (None, None))
        self.assertEqual(f('R/2018_02_31/x.jpg'), (None, None))                          # dia inexistente

    def test_resolver_fecha_exif_manda_y_anota_divergencia(self):
        r = C.resolver_fecha('2018:05:22 10:00:00', ['R/2018_05_10/x.jpg'], [0], 'RELEVAMIENTO_2018', True)
        self.assertEqual((r['valor'], r['precision'], r['fuente']), ('2018-05-22', 'DIA', 'EXIF'))
        self.assertIn('EXIF_DIVERGE_CARPETA', r['flags'])
        # un dia de diferencia no es divergencia
        r = C.resolver_fecha('2018:05:22 23:59:00', ['R/2018_05_23/x.jpg'], [0], 'RELEVAMIENTO_2018', True)
        self.assertNotIn('EXIF_DIVERGE_CARPETA', r['flags'])

    def test_resolver_fecha_exif_invalido_cae_a_carpeta(self):
        r = C.resolver_fecha('1980:01:01 00:00:00', ['R/03_2018/a.jpg', 'R/2018_04_03/a.jpg'], [0], 'RELEVAMIENTO_2018', True)
        self.assertEqual((r['valor'], r['precision'], r['fuente']), ('2018-04-03', 'DIA', 'CARPETA'))   # DIA antes que MES
        self.assertIn('EXIF_INVALIDO', r['flags'])

    def test_resolver_fecha_carpeta_solo_mes(self):
        r = C.resolver_fecha(None, ['R/03_2018/a.jpg'], [0], 'RELEVAMIENTO_2018', True)
        self.assertEqual((r['valor'], r['precision'], r['fuente']), ('2018-03', 'MES', 'CARPETA'))

    def test_resolver_fecha_solo_anio_nunca_es_1_de_enero(self):
        r = C.resolver_fecha(None, ['Monitoreo/2026/DCIM/6 8000_Cerca_2025.jpg'], [0], 'MONITOREO_NE', False)
        self.assertEqual((r['valor'], r['precision'], r['fuente']), ('2025', 'ANIO', 'NOMBRE_ANIO'))
        self.assertEqual(C.formatear_fecha(r['valor'], r['precision']), '2025')

    def test_resolver_fecha_archivo_solo_si_es_plausible_y_confiable(self):
        mt = int(dt.datetime(2018, 5, 3, 12).timestamp() * 1000)
        r = C.resolver_fecha(None, ['R/x/IMG_1.JPG'], [mt], 'RELEVAMIENTO_2018', True)
        self.assertEqual((r['valor'], r['precision'], r['fuente']), ('2018-05-03', 'DIA', 'ARCHIVO'))
        self.assertIn('FECHA_DE_ARCHIVO', r['flags'])
        # fuente cuyos mtime son todos la fecha de copia: no se usa
        r = C.resolver_fecha(None, ['R/x/IMG_1.JPG'], [mt], 'RELEVAMIENTO_2018', False)
        self.assertEqual(r['precision'], 'DESCONOCIDA')
        # anio fuera del rango plausible de la fuente (2026 para Relevamiento 2018)
        mt26 = int(dt.datetime(2026, 5, 3).timestamp() * 1000)
        r = C.resolver_fecha(None, ['R/x/IMG_1.JPG'], [mt26], 'RELEVAMIENTO_2018', True)
        self.assertEqual((r['precision'], r['fuente']), ('DESCONOCIDA', None))

    def test_usar_archivo_no_manda_a_revision(self):
        # ARCHIVO no es un motivo de revision: el vinculo no mira la fecha
        v = C.evaluar_vinculo('RELEVAMIENTO_2018', ['15 0103.JPG'], refs_demo())
        self.assertEqual(v['estado'], C.ESTADO_CONFIRMADO)

    def test_mtime_confiable_por_fuente(self):
        a = int(dt.datetime(2018, 4, 1).timestamp() * 1000)
        b = int(dt.datetime(2019, 4, 1).timestamp() * 1000)
        c = int(dt.datetime(2026, 4, 1).timestamp() * 1000)
        r = C.mtime_confiable_por_fuente({'RELEVAMIENTO_2018': [a, b, a], 'MONITOREO_NE': [c, c, c]})
        self.assertEqual(r, {'RELEVAMIENTO_2018': True, 'MONITOREO_NE': False})

    def test_formatear_fecha(self):
        self.assertEqual(C.formatear_fecha('2025-06-14', 'DIA'), '14/06/2025')
        self.assertEqual(C.formatear_fecha('2018-03', 'MES'), '03/2018')
        self.assertEqual(C.formatear_fecha('2025', 'ANIO'), '2025')
        self.assertEqual(C.formatear_fecha(None, 'DESCONOCIDA'), '')


class VinculoTests(unittest.TestCase):
    def setUp(self):
        self.refs = refs_demo()

    def ev(self, bases, fuente='RELEVAMIENTO_2018', **kw):
        return C.evaluar_vinculo(fuente, bases, self.refs, **kw)

    def test_confirma_contra_padron_red_ne_o_ambas(self):
        self.assertEqual(self.ev(['15 0103.JPG'])['fuenteValidacionId'], 'PADRON')
        self.assertEqual(self.ev(['04 0577.JPG'])['fuenteValidacionId'], 'RED_NE')
        self.assertEqual(self.ev(['06 0001.JPG'])['fuenteValidacionId'], 'AMBAS')
        for b in (['15 0103.JPG'], ['04 0577.JPG'], ['06 0001.JPG']):
            self.assertEqual(self.ev(b)['estado'], C.ESTADO_CONFIRMADO)

    def test_id_fuera_de_padron_y_red_ne_va_a_revision(self):
        v = self.ev(['07 0999.JPG'])
        self.assertEqual(v['estado'], C.ESTADO_POR_REVISAR)
        self.assertEqual(v['motivos'], ['ID_FUERA_PADRON'])
        self.assertIsNone(v['fuenteValidacionId'])

    def test_copias_con_el_mismo_id_no_son_conflicto(self):
        v = self.ev(['15 0103.JPG', '15 103 Apellido, Nombre.JPG', 'IMG_1.JPG'])
        self.assertEqual(v['estado'], C.ESTADO_CONFIRMADO)
        self.assertEqual(v['idsPorNombre'], ['15-0103'])

    def test_copias_con_ids_distintos_es_conflicto(self):
        v = self.ev(['15 0103.JPG', '15 0579.JPG'])
        self.assertEqual((v['estado'], v['motivos'], v['wellId']), (C.ESTADO_POR_REVISAR, ['ID_CONFLICTO'], None))

    def test_sin_id_y_con_indicio_ina_mon(self):
        self.assertEqual(self.ev(['IMG_9001.JPG'])['motivos'], ['SIN_ID'])
        v = self.ev(['INA 901_Cerca_2026.jpg'], fuente='MONITOREO_NE')
        self.assertEqual((v['estado'], v['motivos']), (C.ESTADO_POR_REVISAR, ['ID_AMBIGUO_INA_MON']))
        self.assertEqual(v['indicioMonitoreo']['sugerencias'], ['7'])
        self.assertIsNone(v['wellId'])           # una sugerencia NUNCA confirma

    def test_gps_no_es_obligatorio(self):
        v = self.ev(['15 0103.JPG'], gps=None)
        self.assertEqual((v['estado'], v['gpsEstado'], v['confianza']), (C.ESTADO_CONFIRMADO, 'SIN_GPS', 'MEDIA'))

    def test_gps_hasta_200_m_es_consistente(self):
        v = self.ev(['15 0103.JPG'], gps=al_norte(200))
        self.assertEqual((v['estado'], v['gpsEstado'], v['confianza'], v['advertencias']), (C.ESTADO_CONFIRMADO, 'GPS_CONSISTENTE', 'ALTA', []))

    def test_gps_200_a_500_confirma_con_advertencia(self):
        v = self.ev(['15 0103.JPG'], gps=al_norte(350))
        self.assertEqual((v['estado'], v['gpsEstado'], v['advertencias']), (C.ESTADO_CONFIRMADO, 'GPS_CERCANO', ['GPS_200_500M']))
        self.assertEqual(self.ev(['15 0103.JPG'], gps=al_norte(500))['estado'], C.ESTADO_CONFIRMADO)

    def test_gps_mas_de_500_va_a_revision(self):
        v = self.ev(['15 0103.JPG'], gps=al_norte(600))
        self.assertEqual((v['estado'], v['motivos'], v['gpsEstado']), (C.ESTADO_POR_REVISAR, ['GPS_LEJOS'], 'GPS_LEJOS'))
        self.assertGreater(v['gpsDistM'], 500)

    def test_gps_se_compara_con_la_coordenada_conocida_mas_cercana(self):
        refs = C.Referencias(padron=['06-0001'], ne_wellids=['06-0001'], coords_mapa={'06-0001': al_norte(5000)}, coords_ne={'06-0001': BASE})
        v = C.evaluar_vinculo('MONITOREO_NE', ['6 1_Cerca_2025.jpg'], refs, gps=al_norte(100))
        self.assertEqual(v['gpsEstado'], 'GPS_CONSISTENTE')

    def test_gps_sin_referencia_o_sin_pozo_no_decide(self):
        self.assertEqual(self.ev(['07 0001.JPG'], gps=BASE)['gpsEstado'], 'GPS_SIN_REFERENCIA')     # pozo valido sin coordenada conocida
        self.assertEqual(self.ev(['IMG_1.JPG'], gps=BASE)['gpsEstado'], 'GPS_SIN_POZO')

    def test_el_gps_nunca_modifica_coordenadas_oficiales(self):
        refs = refs_demo()
        antes = (dict(refs.coords_mapa), dict(refs.coords_ne))
        C.evaluar_vinculo('RELEVAMIENTO_2018', ['15 0103.JPG'], refs, gps=al_norte(900))
        self.assertEqual((refs.coords_mapa, refs.coords_ne), antes)

    def test_sin_contenido_fotografico_se_excluye_no_va_a_revision(self):
        v = self.ev(['15 0103.JPG'], contenido_sin_foto=True)
        self.assertEqual((v['estado'], v['motivos']), (C.ESTADO_EXCLUIDA, [C.MOTIVO_SIN_CONTENIDO]))
        # aunque ademas tuviera otros problemas
        v = self.ev(['IMG_1.JPG'], contenido_sin_foto=True)
        self.assertEqual((v['estado'], v['motivos']), (C.ESTADO_EXCLUIDA, [C.MOTIVO_SIN_CONTENIDO]))

    def test_sin_contenido_fotografico_umbrales(self):
        self.assertTrue(C.sin_contenido_fotografico({'blanco': 0.97, 'negro': 0, 'std': 6.7}))
        self.assertTrue(C.sin_contenido_fotografico({'blanco': 0, 'negro': 1.0, 'std': 0.5}))
        self.assertTrue(C.sin_contenido_fotografico({'blanco': 0, 'negro': 0.1, 'std': 8.8}))
        self.assertFalse(C.sin_contenido_fotografico({'blanco': 0.1, 'negro': 0.05, 'std': 55}))
        self.assertFalse(C.sin_contenido_fotografico(None))

    def test_imagen_ilegible_va_a_revision(self):
        self.assertEqual(self.ev(['15 0103.JPG'], ilegible=True)['motivos'], ['IMAGEN_ILEGIBLE'])


class JpegTests(unittest.TestCase):
    def test_quita_exif_sin_tocar_la_imagen(self):
        datos = jpeg_bytes(exif=exif_demo(orientacion=1, fecha='2018:05:22 10:11:12', gps=BASE, marca='Canon'))
        self.assertIn('E1', C.metadatos_presentes(datos))
        limpio = C.jpeg_sin_metadatos(datos)
        self.assertEqual(C.metadatos_presentes(limpio), [])
        a, b = Image.open(BytesIO(datos)), Image.open(BytesIO(limpio))
        self.assertEqual(list(a.convert('RGB').getdata()), list(b.convert('RGB').getdata()))   # pixeles identicos
        self.assertLess(len(limpio), len(datos))

    def test_rechaza_lo_que_no_es_jpeg(self):
        with self.assertRaises(ValueError):
            C.jpeg_sin_metadatos(b'PK\x03\x04')


class NormalizarTests(unittest.TestCase):
    def test_jpeg_chico_y_derecho_no_se_recomprime(self):
        datos = jpeg_bytes(800, 600, exif=exif_demo(fecha='2025:01:02 03:04:05', gps=BASE))
        n = N.normalizar_bytes(datos)
        self.assertEqual(n['procesamiento'], 'COPIA_SIN_METADATOS')
        self.assertEqual(n['metadatosEnSalida'], [])
        self.assertEqual((n['anchoFinal'], n['altoFinal']), (800, 600))
        a, b = Image.open(BytesIO(datos)).convert('RGB'), Image.open(BytesIO(n['salida'])).convert('RGB')
        self.assertEqual(list(a.getdata()), list(b.getdata()))

    def test_jpeg_grande_se_reduce_a_1600_con_calidad_72(self):
        n = N.normalizar_bytes(jpeg_bytes(3264, 2448, color=(100, 120, 140)), medir=True)
        self.assertEqual(n['procesamiento'], 'JPEG_1600_Q72')
        self.assertEqual((n['anchoFinal'], n['altoFinal']), (1600, 1200))
        self.assertEqual(n['calidad'], 72)
        self.assertLessEqual(n['pesoFinal'], N.OBJETIVO_BYTES)
        self.assertGreater(n['psnr'], 30)
        self.assertEqual(n['metadatosEnSalida'], [])

    def test_escalera_de_calidad_solo_si_no_entra_en_1_5_mb(self):
        n = N.normalizar_bytes(jpeg_bytes(2400, 1800, ruido=True))     # ruido: casi incompresible
        self.assertIn(n['calidad'], N.CALIDADES)
        if n['calidad'] != 72:
            self.assertGreater(len(n['salida']) - 0, 0)
        self.assertEqual(n['superaObjetivo'], n['pesoFinal'] > N.OBJETIVO_BYTES)
        self.assertLessEqual(max(n['anchoFinal'], n['altoFinal']), 1600)

    def test_corrige_orientacion_exif_en_jpeg(self):
        n = N.normalizar_bytes(jpeg_bytes(800, 600, exif=exif_demo(orientacion=6)))
        self.assertEqual((n['anchoFinal'], n['altoFinal']), (600, 800))          # rotada
        self.assertNotEqual(n['procesamiento'], 'COPIA_SIN_METADATOS')

    def test_png_con_orientacion_exif_se_endereza_y_pasa_a_jpeg(self):
        buf = BytesIO()
        Image.new('RGB', (400, 300), (200, 50, 50)).save(buf, 'PNG', exif=exif_demo(orientacion=6))
        n = N.normalizar_bytes(buf.getvalue())
        self.assertTrue(n['procesamiento'].startswith('PNG_A_JPEG'))
        self.assertEqual((n['anchoFinal'], n['altoFinal']), (300, 400))
        self.assertEqual(C.formato_por_contenido(n['salida']), 'JPEG')

    def test_png_con_transparencia_se_compone_sobre_blanco(self):
        buf = BytesIO()
        Image.new('RGBA', (50, 50), (0, 0, 0, 0)).save(buf, 'PNG')
        n = N.normalizar_bytes(buf.getvalue())
        px = Image.open(BytesIO(n['salida'])).convert('RGB').getpixel((10, 10))
        self.assertTrue(all(c > 245 for c in px))

    def test_miniatura_de_256_px(self):
        n = N.normalizar_bytes(jpeg_bytes(3000, 2000))
        self.assertEqual(max(n['anchoThumb'], n['altoThumb']), 256)
        self.assertEqual(C.metadatos_presentes(n['thumb']), [])

    def test_foto_id_es_deterministico_y_no_expone_el_sha1(self):
        a, b = C.foto_id('a' * 40), C.foto_id('a' * 40)
        self.assertEqual(a, b)
        self.assertNotEqual(a, C.foto_id('b' * 40))
        self.assertNotIn('a' * 8, a)


def armar_fotos(raiz):
    """Carpeta de fotos sintetica con casos representativos. Devuelve la lista de rutas relativas."""
    casos = {
        'Relevamiento 2018/2018_04_03/15 0103 Apellido, Nombre.JPG': jpeg_bytes(80, 60, exif=exif_demo(fecha='2018:04:03 10:00:00', gps=al_norte(50)), ruido=True),
        'Relevamiento 2018/Todos/15 0103 Apellido, Nombre.JPG': None,           # copia exacta (se llena abajo)
        'Relevamiento 2018/Todos/IMG_9001.JPG': jpeg_bytes(90, 70, exif=exif_demo(fecha='1980:01:01 00:00:00'), ruido=True),
        'Relevamiento 2018/03_2018/04 0577.JPG': jpeg_bytes(70, 70, ruido=True),
        'Relevamiento 2018/Todos/07 0999 Otroapellido.JPG': jpeg_bytes(60, 90, ruido=True),
        'Monitoreo/2026/DCIM/6 0001_Cerca_2025.jpg': jpeg_bytes(100, 80, ruido=True),
        'Monitoreo/2026/DCIM/INA 901_Pano_2024.jpg': jpeg_bytes(66, 66, ruido=True),
        'Monitoreo/2026/DCIM/XX_Cerca_2024.JPG': jpeg_bytes(64, 64, color=(0, 0, 0)),     # cuadro negro
        'Relevamiento 2018/Todos/notas.info': b'no es una imagen',
        'Relevamiento 2018/Todos/video1.thm': jpeg_bytes(40, 30, ruido=True),   # miniatura de video: contenido JPEG, no es foto
    }
    casos['Relevamiento 2018/Todos/15 0103 Apellido, Nombre.JPG'] = casos['Relevamiento 2018/2018_04_03/15 0103 Apellido, Nombre.JPG']
    for ruta, datos in casos.items():
        p = Path(raiz) / ruta
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(datos)
    return sorted(casos)


class InventarioYClasificacionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.raiz = Path(cls.tmp.name) / 'Fotos'
        cls.rutas = armar_fotos(cls.raiz)
        items = [V.procesar(cls.raiz, r) for r in cls.rutas]
        cls.inv = {'archivos': [i for i in items if i['formato'] != 'OTRO'], 'noImagenes': [i for i in items if i['formato'] == 'OTRO']}
        cls.filas, cls.inv = K.clasificar_inventario(cls.inv, refs_demo(), cls.raiz)
        cls.por_copia = {r: f for f in cls.filas for r in f['copias']}

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_leer_metadatos_exif_y_gps(self):
        m = V.leer_metadatos(self.raiz / 'Relevamiento 2018/2018_04_03/15 0103 Apellido, Nombre.JPG')
        self.assertEqual(m['fechaOriginal'], '2018:04:03 10:00:00')
        self.assertAlmostEqual(m['gps'][0], al_norte(50)[0], places=4)
        self.assertTrue(m['gpsPresente'])
        self.assertEqual((m['ancho'], m['alto']), (80, 60))

    def test_las_no_imagenes_se_omiten_sin_tocarlas(self):
        self.assertEqual(sorted(i['ruta'] for i in self.inv['noImagenes']), ['Relevamiento 2018/Todos/notas.info', 'Relevamiento 2018/Todos/video1.thm'])
        self.assertTrue((self.raiz / 'Relevamiento 2018/Todos/notas.info').exists())

    def test_copias_identicas_se_agrupan_por_sha1(self):
        f = self.por_copia['Relevamiento 2018/Todos/15 0103 Apellido, Nombre.JPG']
        self.assertEqual(f['nCopias'], 2)
        self.assertEqual(len(self.filas), len(self.inv['archivos']) - 1)

    def test_confirmada_con_gps_consistente_y_fecha_exif(self):
        f = self.por_copia['Relevamiento 2018/Todos/15 0103 Apellido, Nombre.JPG']
        self.assertEqual((f['estado'], f['wellId'], f['fuenteValidacionId'], f['gpsEstado']), (C.ESTADO_CONFIRMADO, '15-0103', 'PADRON', 'GPS_CONSISTENTE'))
        self.assertEqual((f['fecha']['valor'], f['fecha']['precision'], f['fecha']['fuente']), ('2018-04-03', 'DIA', 'EXIF'))
        self.assertEqual(f['tipoFoto'], 'OTRA')

    def test_red_ne_valida_y_fecha_solo_mes(self):
        f = self.por_copia['Relevamiento 2018/03_2018/04 0577.JPG']
        self.assertEqual((f['estado'], f['fuenteValidacionId']), (C.ESTADO_CONFIRMADO, 'RED_NE'))
        self.assertEqual((f['fecha']['valor'], f['fecha']['precision']), ('2018-03', 'MES'))

    def test_exif_1980_sin_carpeta_queda_desconocida_y_sin_id_va_a_revision(self):
        f = self.por_copia['Relevamiento 2018/Todos/IMG_9001.JPG']
        self.assertEqual((f['estado'], f['motivos']), (C.ESTADO_POR_REVISAR, ['SIN_ID']))
        self.assertEqual(f['fecha']['precision'], 'DESCONOCIDA')
        self.assertIn('EXIF_INVALIDO', f['fecha']['flags'])

    def test_id_fuera_de_padron_y_red(self):
        f = self.por_copia['Relevamiento 2018/Todos/07 0999 Otroapellido.JPG']
        self.assertEqual((f['estado'], f['motivos']), (C.ESTADO_POR_REVISAR, ['ID_FUERA_PADRON']))

    def test_monitoreo_regular_tipo_y_anio(self):
        f = self.por_copia['Monitoreo/2026/DCIM/6 0001_Cerca_2025.jpg']
        self.assertEqual((f['estado'], f['tipoFoto'], f['wellId']), (C.ESTADO_CONFIRMADO, 'CERCA', '06-0001'))
        self.assertEqual((f['fecha']['valor'], f['fecha']['precision'], f['fecha']['fuente']), ('2025', 'ANIO', 'NOMBRE_ANIO'))

    def test_monitoreo_ina_queda_en_revision_con_sugerencia(self):
        f = self.por_copia['Monitoreo/2026/DCIM/INA 901_Pano_2024.jpg']
        self.assertEqual((f['estado'], f['motivos'], f['tipoFoto']), (C.ESTADO_POR_REVISAR, ['ID_AMBIGUO_INA_MON'], 'PANORAMICA'))
        self.assertEqual(f['indicioMonitoreo']['sugerencias'], ['7'])

    def test_cuadro_negro_se_excluye_de_la_importacion(self):
        f = self.por_copia['Monitoreo/2026/DCIM/XX_Cerca_2024.JPG']
        self.assertEqual((f['estado'], f['motivos']), (C.ESTADO_EXCLUIDA, [C.MOTIVO_SIN_CONTENIDO]))
        self.assertTrue((self.raiz / 'Monitoreo/2026/DCIM/XX_Cerca_2024.JPG').exists())          # no se borra del origen

    def test_normalizacion_de_confirmadas_y_filas_de_hoja(self):
        sel = {f['sha1']: {'categoria': 'LOTE', 'estrato': None} for f in self.filas}
        with tempfile.TemporaryDirectory() as out:
            regs = N.ejecutar(self.filas, sel, Path(out) / 'lote', self.raiz, 'LOTE-TEST', medir=False)
            por = {r['estado']: [] for r in regs}
            for r in regs:
                por[r['estado']].append(r)
            # excluidas: se registran pero NO se normalizan
            self.assertTrue(all(r['procesamiento'] is None for r in por[C.ESTADO_EXCLUIDA]))
            normalizados = sorted(p.name for p in (Path(out) / 'lote' / 'normalizado').glob('*'))
            self.assertEqual(len(normalizados), len(regs) - len(por[C.ESTADO_EXCLUIDA]))
            filas = json.loads((Path(out) / 'lote' / 'filas_FotosPozos.json').read_text(encoding='utf-8'))
            self.assertEqual(len(filas), len(por[C.ESTADO_CONFIRMADO]))
            self.assertTrue(all(f['estadoVinculo'] == 'CONFIRMADO' for f in filas))
            self.assertEqual(list(filas[0].keys()), C.FOTOSPOZOS_COLUMNAS)
            # privacidad: nada de nombres/rutas originales en las filas ni en los nombres de salida
            serial = json.dumps([list(f.values()) for f in filas], ensure_ascii=False).lower()
            for tabu in ('apellido', 'otroapellido', 'nombre,', 'dcim', 'todos', '.jpg', 'relevamiento 2018/'):
                self.assertNotIn(tabu, serial)
            self.assertTrue(all(len(n) == 40 for n in normalizados))   # uuid + '.jpg'

    def test_csv_de_revision_sin_datos_personales(self):
        with tempfile.TemporaryDirectory() as out:
            rev, por_revisar, excluidas = R.generar(self.filas, out)
            self.assertEqual(len(por_revisar), 3)
            self.assertEqual(len(excluidas), 1)
            with open(str(rev / 'revision_porrevisar.csv'), encoding='utf-8-sig', newline='') as fh:
                filas = list(csv.DictReader(fh, delimiter=';'))
            self.assertEqual(list(filas[0].keys()), C.REVISION_COLUMNAS)
            contenido = (rev / 'revision_porrevisar.csv').read_text(encoding='utf-8-sig').lower()
            for tabu in ('apellido', 'otroapellido', 'img_9001', 'dcim', '.jpg', 'todos/', 'relevamiento 2018/'):
                self.assertNotIn(tabu, contenido)
            ina = [f for f in filas if 'ID_AMBIGUO_INA_MON' in f['motivoRevision']][0]
            self.assertEqual(ina['monitoringIdPropuesto'], '7')
            self.assertIn('punto NE sugerido 7', ina['sugerencia'])
            self.assertEqual((ina['decision'], ina['wellIdCorregido'], ina['monitoringIdCorregido'], ina['observacionRevision']), ('', '', '', ''))
            fuera = [f for f in filas if f['motivoRevision'] == 'ID_FUERA_PADRON'][0]
            self.assertEqual(fuera['wellIdPropuesto'], '07-0999')
            # el mapeo privado SI relaciona fotoId con la ruta original (queda local, fuera del CSV de revision)
            privado = (rev / 'mapeo_privado_revision.csv').read_text(encoding='utf-8-sig')
            self.assertIn('Otroapellido', privado)
            self.assertIn((rev / 'excluidas_privado.csv').read_text(encoding='utf-8-sig').count('XX_Cerca_2024.JPG'), (1,))

    def test_orden_y_fotoid_del_csv_son_estables(self):
        with tempfile.TemporaryDirectory() as a, tempfile.TemporaryDirectory() as b:
            R.generar(self.filas, a)
            R.generar(list(reversed(self.filas)), b)
            self.assertEqual((Path(a) / 'revision' / 'revision_porrevisar.csv').read_bytes(), (Path(b) / 'revision' / 'revision_porrevisar.csv').read_bytes())


class MuestraPilotoTests(unittest.TestCase):
    def _corpus_sintetico(self):
        r = random.Random(3)
        filas = []
        camaras = ['Canon Canon PowerShot A590 IS', 'samsung SM-J105M', 'Android EUTB-1005', 'BLU BLU DASH X', 'EASTMAN KODAK COMPANY PIXPRO', None]
        for i in range(1500):
            mon = i % 3 == 0
            fuente = 'MONITOREO_NE' if mon else 'RELEVAMIENTO_2018'
            n = (2 if i % 30 == 0 else 1) if mon else r.choice([1, 2, 2, 3, 3, 4, 5])
            estado = r.choice([C.ESTADO_CONFIRMADO] * 8 + [C.ESTADO_POR_REVISAR, C.ESTADO_EXCLUIDA])
            motivos = [] if estado == C.ESTADO_CONFIRMADO else ([C.MOTIVO_SIN_CONTENIDO] if estado == C.ESTADO_EXCLUIDA else [r.choice(['SIN_ID', 'ID_CONFLICTO', 'GPS_LEJOS', 'ID_FUERA_PADRON', 'ID_AMBIGUO_INA_MON'])])
            base = r.choice(['IMG_%d.JPG' % i, '15 %04d.JPG' % i, '20190101_%06d.jpg' % i, 'Fulano, Zutano %d.JPG' % i]) if not mon else '6 %d_%s_2025.jpg' % (i, r.choice(['Cerca', 'Pano']))
            carpetas = (['Relevamiento 2018/A-G'] * n) if n < 3 else ['Relevamiento 2018/A-G', 'Relevamiento 2018/Todos', 'Relevamiento 2018/C-Z'][:n]
            filas.append({
                'sha1': '%040x' % i, 'copias': ['%s/%s' % (c, base) for c in (carpetas if not mon else ['Monitoreo/2026/DCIM'] * n)],
                'nCopias': n, 'copiasEnCarpetas': carpetas if not mon else ['Monitoreo/'],
                'tam': r.randint(10000, 5000000), 'formato': 'PNG' if i % 400 == 7 else 'JPEG', 'fuente': fuente,
                'tipoFoto': ('CERCA' if i % 2 else 'PANORAMICA') if mon else 'OTRA',
                'wellId': '15-%04d' % (i % 9000) if estado == C.ESTADO_CONFIRMADO else None, 'estado': estado, 'motivos': motivos,
                'indicioMonitoreo': {'tipo': 'INA' if i % 2 else 'MON_NUM', 'valor': '1', 'sugerencias': []} if 'ID_AMBIGUO_INA_MON' in motivos else None,
                'gps': [-33.0, -68.0] if i % 5 == 0 else None, 'camara': None if mon else r.choice(camaras),
                'orientacionExif': r.choice([1, 1, 1, 6, 8]), 'flags': ['MUY_GRANDE'] if i % 300 == 11 else [],
                'fecha': {'valor': '2018-05-0%d' % (1 + i % 9), 'precision': 'MES' if i % 211 == 5 else 'DIA', 'fuente': 'EXIF', 'flags': ['EXIF_INVALIDO'] if i % 97 == 1 else []},
            })
        return filas

    def test_muestra_de_200_reproducible_y_sin_repetidos(self):
        filas = self._corpus_sintetico()
        a = N.muestra_piloto(filas, 123)
        b = N.muestra_piloto(filas, 123)
        self.assertEqual(list(a.keys()), list(b.keys()))
        self.assertEqual(len(a), 200)
        self.assertEqual(len(set(a.keys())), 200)
        cuenta = {}
        for v in a.values():
            cuenta[v['categoria']] = cuenta.get(v['categoria'], 0) + 1
        self.assertEqual(cuenta, {'PROBLEMATICA': 15, 'DUPLICADO': 20, 'SIN_WELLID': 15, 'MONITOREO': 50, 'RELEVAMIENTO_CLARO': 100})
        self.assertNotEqual(list(a.keys()), list(N.muestra_piloto(filas, 124).keys()))


class EsquemaTests(unittest.TestCase):
    def test_columnas_de_la_hoja(self):
        self.assertEqual(len(C.FOTOSPOZOS_COLUMNAS), 27)
        self.assertEqual(len(set(C.FOTOSPOZOS_COLUMNAS)), 27)
        # ninguna columna guarda nombres, rutas ni titulares
        for col in C.FOTOSPOZOS_COLUMNAS:
            self.assertNotRegex(col.lower(), r'nombre|ruta|titular|path')

    def test_columnas_de_revision_incluyen_lo_pedido(self):
        pedidas = ['fotoId', 'fuente', 'fechaFotoValor', 'fechaFotoPrecision', 'fechaFotoFuente', 'wellIdPropuesto',
                   'monitoringIdPropuesto', 'fuenteValidacionId', 'motivoRevision', 'distanciaGpsMetros', 'sugerencia',
                   'decision', 'wellIdCorregido', 'monitoringIdCorregido', 'observacionRevision']
        for c in pedidas:
            self.assertIn(c, C.REVISION_COLUMNAS)


if __name__ == '__main__':
    unittest.main()
