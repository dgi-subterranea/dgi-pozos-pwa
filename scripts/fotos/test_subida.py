#!/usr/bin/env python3
"""Tests de la subida al storage (importar.py subir / exportar-filas) y del cliente HMAC (storage_cliente.py).

Ejecutar desde la raiz del repo:   python -m unittest discover -s scripts/fotos -p "test_*.py"
No necesitan Fotos/, scripts/out/ ni acceso a Google. Los tests de punta a punta levantan el codigo REAL del storage
(storage/src) en localhost con un Drive en memoria (scripts/fotos/servidor_storage_prueba.js) y se saltean si no hay node.
"""
import base64
import collections
import csv
import hashlib
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
import urllib.error
from contextlib import redirect_stdout, redirect_stderr
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import clasificar as K  # noqa: E402
import fotos_comun as C  # noqa: E402
import importar as I  # noqa: E402
import inventariar as V  # noqa: E402
import normalizar as N  # noqa: E402
import storage_cliente as SC  # noqa: E402
import test_fotos as T  # noqa: E402

REPO = Path(__file__).resolve().parents[2]
SECRETO = 'secreto-de-prueba-0123456789'
URL_PRIVADA = 'https://script.google.com/macros/s/URL_PRIVADA_DE_PRUEBA/exec'
NODE = shutil.which('node')


class ClienteFalso(object):
    """Reemplaza al ClienteStorage: guarda lo que se le manda y responde segun un guion."""

    def __init__(self, guion=None, indica_existencia=True):
        self.llamadas = []
        self.guion = list(guion or [])
        self.indica = indica_existencia
        self.existentes = set()

    def __repr__(self):
        return '<ClienteFalso>'

    def put_foto_pozo(self, fotoId, fuente, carpeta_fecha, imagen_b64, thumb_b64):
        self.llamadas.append({'fotoId': fotoId, 'fuente': fuente, 'carpetaFecha': carpeta_fecha, 'img': imagen_b64, 'thumb': thumb_b64})
        if self.guion:
            accion = self.guion.pop(0)
            if isinstance(accion, Exception):
                raise accion
        existente = fotoId in self.existentes
        self.existentes.add(fotoId)
        r = {'status': 'ok', 'driveFileId': 'F' + fotoId.replace('-', '')[:20], 'driveThumbId': 'T' + fotoId.replace('-', '')[:20],
             'tamanoBytes': len(base64.b64decode(imagen_b64))}
        if self.indica:
            r['existente'] = existente
        return r


class LoteBase(unittest.TestCase):
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
        sel = collections.OrderedDict((f['sha1'], {'categoria': 'LOTE', 'estrato': None}) for f in self.filas)
        with redirect_stdout(io.StringIO()):
            N.ejecutar(self.filas, sel, self.out / 'lote', self.raiz, 'LOTE-TEST', medir=False)
        self.lote = self.out / 'lote'
        self.silencio = lambda *_a, **_k: None
        self.sin_espera = lambda s: self.esperas.append(s)
        self.esperas = []

    def tearDown(self):
        self.t.cleanup()

    def dry_run(self):
        with redirect_stdout(io.StringIO()):
            self.assertEqual(I.main(['--lote', 'lote', '--salida', str(self.out), '--dry-run']), 0)
        return json.loads((self.lote / 'plan_importacion.json').read_text(encoding='utf-8'))['huella']

    def subir(self, cliente, huella=None, **kw):
        h = huella or self.dry_run()
        kw.setdefault('esperar', self.sin_espera)
        kw.setdefault('log', self.silencio)
        return I.subir(self.lote, cliente, h, **kw)

    def estado(self):
        return I.leer_estado(self.lote)


class ProtocoloTests(unittest.TestCase):
    def test_firma_identica_a_la_del_storage_real(self):
        if not NODE:
            self.skipTest('node no disponible')
        payload = json.dumps({'fotoId': 'x', 'obs': 'ñandú ✓'}, separators=(',', ':'), ensure_ascii=False)
        js = ("global.Utilities={computeHmacSha256Signature:(m,k)=>Array.from(require('crypto').createHmac('sha256',k).update(m,'utf8').digest())};"
              "const A=require('./storage/src/StorageAuth.js');"
              "console.log(A.storageAuth_firmar(process.argv[1],'putFotoPozo',1700000000,'abc-nonce-0123456789',process.argv[2]))")
        esperado = subprocess.run([NODE, '-e', js, SECRETO, payload], cwd=str(REPO), capture_output=True, text=True, check=True).stdout.strip()
        self.assertEqual(SC.firmar(SECRETO, 'putFotoPozo', 1700000000, 'abc-nonce-0123456789', payload), esperado)

    def test_solicitud_firmada_la_acepta_el_storage_real(self):
        if not NODE:
            self.skipTest('node no disponible')
        sol = SC.armar_solicitud('putFotoPozo', {'a': 1}, SECRETO, 1700000000, 'abc-nonce-0123456789')
        js = ("global.Utilities={computeHmacSha256Signature:(m,k)=>Array.from(require('crypto').createHmac('sha256',k).update(m,'utf8').digest())};"
              "const A=require('./storage/src/StorageAuth.js');const c={g:{},get(k){return this.g[k]===undefined?null:this.g[k]},put(k,v){this.g[k]=v}};"
              "const r=A.storageAuth_verificarSolicitud(JSON.parse(process.argv[1]),process.argv[2],1700000000,c);console.log(JSON.stringify(r))")
        salida = subprocess.run([NODE, '-e', js, json.dumps(sol), SECRETO], cwd=str(REPO), capture_output=True, text=True, check=True).stdout
        r = json.loads(salida)
        self.assertTrue(r['ok'])
        self.assertEqual(r['payload'], {'a': 1})

    def test_verificar_respuesta(self):
        payload = json.dumps({'status': 'ok'})
        firmada = {'v': 'v1', 'ts': 1700000000, 'nonce': 'n' * 20, 'payload': payload, 'sig': SC.firmar(SECRETO, 'response', 1700000000, 'n' * 20, payload)}
        self.assertEqual(SC.verificar_respuesta(firmada, SECRETO, 'n' * 20, 1700000100), {'status': 'ok'})
        for malo, msg in (
            (dict(firmada, nonce='otro' * 5), 'otra solicitud'),
            (dict(firmada, sig='0' * 64), 'firma'),
            (dict(firmada, payload=json.dumps({'status': 'hack'})), 'firma'),
            ({'status': 'ok'}, 'no esta firmada'),
        ):
            with self.assertRaises(SC.ErrorAutenticacion) as cm:
                SC.verificar_respuesta(malo, SECRETO, 'n' * 20, 1700000100)
            self.assertIn(msg, str(cm.exception))
        with self.assertRaises(SC.ErrorAutenticacion):
            SC.verificar_respuesta(firmada, SECRETO, 'n' * 20, 1700000000 + 3600)      # vencida
        with self.assertRaises(SC.ErrorAutenticacion):
            SC.verificar_respuesta(firmada, 'otro-secreto-0123456789', 'n' * 20, 1700000100)


class ConfiguracionTests(unittest.TestCase):
    def test_solo_desde_variables_de_entorno_y_validada(self):
        self.assertEqual(SC.ENV_URL, 'FOTOS_STORAGE_URL')
        self.assertEqual(SC.ENV_SECRETO, 'FOTOS_STORAGE_SECRET')
        self.assertEqual(SC.configuracion_desde_entorno({'FOTOS_STORAGE_URL': URL_PRIVADA, 'FOTOS_STORAGE_SECRET': SECRETO}), (URL_PRIVADA, SECRETO))
        for env in ({}, {'FOTOS_STORAGE_URL': URL_PRIVADA}, {'FOTOS_STORAGE_SECRET': SECRETO},
                    {'FOTOS_STORAGE_URL': 'http://script.google.com/x', 'FOTOS_STORAGE_SECRET': SECRETO},       # http fuera de localhost
                    {'FOTOS_STORAGE_URL': 'ftp://x', 'FOTOS_STORAGE_SECRET': SECRETO},
                    {'FOTOS_STORAGE_URL': URL_PRIVADA, 'FOTOS_STORAGE_SECRET': 'corto'}):
            with self.assertRaises(SC.ErrorConfiguracion):
                SC.configuracion_desde_entorno(env)

    def test_localhost_http_se_admite_solo_para_pruebas(self):
        SC.configuracion_desde_entorno({'FOTOS_STORAGE_URL': 'http://127.0.0.1:5000/', 'FOTOS_STORAGE_SECRET': SECRETO})

    def test_los_mensajes_de_error_no_incluyen_el_secreto_ni_la_url(self):
        for env in ({'FOTOS_STORAGE_URL': URL_PRIVADA, 'FOTOS_STORAGE_SECRET': 'corto'},
                    {'FOTOS_STORAGE_URL': 'http://secretos.example/' + SECRETO, 'FOTOS_STORAGE_SECRET': SECRETO}):
            try:
                SC.configuracion_desde_entorno(env)
            except SC.ErrorConfiguracion as e:
                self.assertNotIn(SECRETO, str(e))
                self.assertNotIn('URL_PRIVADA', str(e))
                self.assertNotIn('secretos.example', str(e))

    def test_el_cliente_no_se_deja_imprimir(self):
        c = SC.ClienteStorage(URL_PRIVADA, SECRETO)
        for t in (repr(c), str(c)):
            self.assertNotIn(SECRETO, t)
            self.assertNotIn('URL_PRIVADA', t)


class ClienteHttpTests(unittest.TestCase):
    def _cliente(self, abrir):
        return SC.ClienteStorage(URL_PRIVADA, SECRETO, abrir=abrir, reloj=lambda: 1700000000, generar_nonce=lambda: 'nonce-0123456789abcd')

    def _firmada(self, data):
        payload = json.dumps(data)
        return {'v': 'v1', 'ts': 1700000000, 'nonce': 'nonce-0123456789abcd', 'payload': payload, 'sig': SC.firmar(SECRETO, 'response', 1700000000, 'nonce-0123456789abcd', payload)}

    def test_ok(self):
        c = self._cliente(lambda cuerpo: (200, json.dumps(self._firmada({'status': 'ok', 'driveFileId': 'A' * 12})).encode()))
        self.assertEqual(c.llamar('putFotoPozo', {'x': 1})['driveFileId'], 'A' * 12)

    def test_el_cuerpo_enviado_esta_firmado_y_no_lleva_el_secreto(self):
        visto = {}

        def abrir(cuerpo):
            visto['cuerpo'] = cuerpo.decode()
            return 200, json.dumps(self._firmada({'status': 'ok'})).encode()
        self._cliente(abrir).llamar('putFotoPozo', {'fotoId': 'x'})
        sol = json.loads(visto['cuerpo'])
        self.assertNotIn(SECRETO, visto['cuerpo'])
        self.assertEqual(sol['sig'], SC.firmar(SECRETO, 'putFotoPozo', sol['ts'], sol['nonce'], sol['payload']))
        self.assertEqual(json.loads(sol['payload']), {'fotoId': 'x'})

    def test_clasificacion_de_errores(self):
        def levanta(exc):
            def f(_):
                raise exc
            return f
        casos = [
            (levanta(urllib.error.HTTPError(URL_PRIVADA, 503, 'x', {}, None)), SC.ErrorTransitorio),
            (levanta(urllib.error.URLError('sin red')), SC.ErrorTransitorio),
            (levanta(TimeoutError()), SC.ErrorTransitorio),
            (lambda _: (500, b''), SC.ErrorTransitorio),
            (lambda _: (200, b'<html>pagina de error</html>'), SC.ErrorTransitorio),
            (lambda _: (200, b'{"status":"error","code":"INTERNAL"}'), SC.ErrorTransitorio),
            (lambda _: (200, b'{"status":"error","code":"UNAUTHORIZED"}'), SC.ErrorAutenticacion),
            (lambda _: (200, b'{"status":"error","code":"MALFORMED"}'), SC.ErrorPermanente),
            (lambda _: (200, json.dumps(self._firmada({'status': 'error', 'code': 'INVALID_IMAGEN'})).encode()), SC.ErrorPermanente),
            (lambda _: (200, json.dumps(self._firmada({'status': 'error', 'code': 'INTERNAL'})).encode()), SC.ErrorTransitorio),
            (lambda _: (200, b'{"payload":"{}","sig":"00","nonce":"x","ts":1}'), SC.ErrorAutenticacion),
        ]
        for abrir, esperado in casos:
            with self.assertRaises(esperado):
                self._cliente(abrir).llamar('putFotoPozo', {})

    def test_los_errores_no_filtran_secreto_url_ni_payload(self):
        def f(_):
            raise urllib.error.URLError('fallo con ' + URL_PRIVADA + ' ' + SECRETO)
        try:
            self._cliente(f).llamar('putFotoPozo', {'imagenBase64': 'AAAA' * 50})
        except SC.ErrorTransitorio as e:
            self.assertNotIn(SECRETO, str(e))
            self.assertNotIn('URL_PRIVADA', str(e))
            self.assertNotIn('AAAA', str(e))


class ConfirmacionTests(LoteBase):
    def test_se_niega_sin_dry_run(self):
        with self.assertRaises(I.ErrorImportacion) as cm:
            I.subir(self.lote, ClienteFalso(), 'a' * 12, log=self.silencio)
        self.assertIn('dry-run', str(cm.exception))

    def test_se_niega_con_huella_distinta_o_corta(self):
        h = self.dry_run()
        cli = ClienteFalso()
        for mala in ('0' * 12, h[:11], '', 'zz'):
            with self.assertRaises(I.ErrorImportacion):
                I.subir(self.lote, cli, mala, log=self.silencio)
        self.assertEqual(cli.llamadas, [])
        I.verificar_plan(self.lote, h[:12])           # la correcta (12 caracteres) alcanza
        I.verificar_plan(self.lote, h.upper())

    def test_se_niega_si_un_archivo_cambio_despues_del_dry_run(self):
        h = self.dry_run()
        fid = I.planificar(self.lote)['elementos'][0]['fotoId']         # un archivo QUE VA a subirse (las POR_REVISAR tambien se normalizan, pero no entran al plan)
        f = self.lote / 'normalizado' / (fid + '.jpg')
        datos = bytearray(f.read_bytes())
        datos[-3] ^= 0xFF                              # mismo peso, otro contenido
        f.write_bytes(bytes(datos))
        with self.assertRaises(I.ErrorImportacion) as cm:
            I.subir(self.lote, ClienteFalso(), h, log=self.silencio)
        self.assertIn('cambio', str(cm.exception))

    def test_se_niega_si_cambiaron_las_filas_o_el_plan_guardado_tiene_errores(self):
        h = self.dry_run()
        filas = json.loads((self.lote / 'filas_FotosPozos.json').read_text(encoding='utf-8'))
        filas[0]['tipoFoto'] = 'CERCA' if filas[0]['tipoFoto'] != 'CERCA' else 'OTRA'
        (self.lote / 'filas_FotosPozos.json').write_text(json.dumps(filas), encoding='utf-8')
        # el plan no contempla el tipo en la huella, pero SI el esquema; aca el cambio es valido: se verifica que el plan sigue vigente
        I.verificar_plan(self.lote, h)
        plan = json.loads((self.lote / 'plan_importacion.json').read_text(encoding='utf-8'))
        plan['errores'] = ['x']
        (self.lote / 'plan_importacion.json').write_text(json.dumps(plan), encoding='utf-8')
        with self.assertRaises(I.ErrorImportacion):
            I.verificar_plan(self.lote, h)

    def test_main_sin_confirmacion_ni_variables_de_entorno_no_toca_nada(self):
        h = self.dry_run()
        err = io.StringIO()
        entorno = {k: v for k, v in os.environ.items() if k not in (SC.ENV_URL, SC.ENV_SECRETO)}
        viejo = dict(os.environ)
        os.environ.clear()
        os.environ.update(entorno)
        try:
            with redirect_stderr(err):
                self.assertEqual(I.main(['subir', '--lote', 'lote', '--salida', str(self.out), '--confirmar-huella', h]), 2)
                self.assertEqual(I.main(['subir', '--lote', 'lote', '--salida', str(self.out), '--confirmar-huella', '0' * 12]), 2)
        finally:
            os.environ.clear()
            os.environ.update(viejo)
        self.assertIn(SC.ENV_URL, err.getvalue())
        self.assertFalse((self.lote / I.ESTADO_ARCHIVO).exists())

    def test_confirmar_huella_es_obligatorio(self):
        with self.assertRaises(SystemExit), redirect_stderr(io.StringIO()):
            I.main(['subir', '--lote', 'lote', '--salida', str(self.out)])


class SubidaTests(LoteBase):
    def test_sube_una_foto_por_request_con_jpg_y_miniatura_y_nada_mas(self):
        cli = ClienteFalso()
        res = self.subir(cli)
        plan = json.loads((self.lote / 'plan_importacion.json').read_text(encoding='utf-8'))
        self.assertEqual(len(cli.llamadas), plan['cantidad'])                    # una por foto
        self.assertEqual({c['fotoId'] for c in cli.llamadas}, {e['fotoId'] for e in plan['elementos']})
        self.assertEqual(res['subidas'], plan['cantidad'])
        for c, e in zip(cli.llamadas, plan['elementos']):
            self.assertEqual(c['fuente'], e['fuente'])
            self.assertEqual(c['carpetaFecha'], e['destino'].split('/')[2])
            self.assertEqual(hashlib.sha256(base64.b64decode(c['img'])).hexdigest(), e['sha256'])
            self.assertEqual(hashlib.sha256(base64.b64decode(c['thumb'])).hexdigest(), e['sha256Thumb'])

    def test_estados_omitidas_y_reporte(self):
        res = self.subir(ClienteFalso())
        self.assertEqual(res['fallidas'], 0)
        self.assertEqual(res['omitidas'], sum(1 for r in json.loads((self.lote / 'manifiesto_privado.json').read_text(encoding='utf-8')) if not r['subir']))
        self.assertGreater(res['omitidas'], 0)
        txt = (self.lote / 'reporte_subida.txt').read_text(encoding='utf-8')
        for palabra in ('SUBIDA', 'YA_EXISTE', 'FALLIDA', 'OMITIDA', 'Previstas'):
            self.assertIn(palabra, txt)
        self.assertEqual({r['estado'] for r in self.estado().values()}, {'SUBIDA'})

    def test_no_vuelve_a_subir_lo_ya_confirmado(self):
        cli = ClienteFalso()
        self.subir(cli)
        n = len(cli.llamadas)
        res2 = self.subir(cli)
        self.assertEqual(len(cli.llamadas), n)                                  # cero requests nuevos
        self.assertEqual(res2['yaConfirmadasAntes'], n)
        self.assertEqual((res2['subidas'], res2['yaExisten'], res2['fallidas']), (0, 0, 0))

    def test_ya_existe_si_el_storage_lo_indica(self):
        cli = ClienteFalso()
        plan = json.loads(json.dumps(I.planificar(self.lote)))
        cli.existentes.add(plan['elementos'][0]['fotoId'])
        res = self.subir(cli)
        self.assertEqual(res['yaExisten'], 1)
        self.assertEqual(self.estado()[plan['elementos'][0]['fotoId']]['estado'], 'YA_EXISTE')
        self.assertEqual(res['subidas'], plan['cantidad'] - 1)

    def test_storage_viejo_sin_indicador_se_informa_como_subida(self):
        cli = ClienteFalso(indica_existencia=False)
        res = self.subir(cli)
        self.assertEqual(res['yaExisten'], 0)
        self.assertTrue(all(r['storageIndicaExistencia'] is False for r in self.estado().values()))

    def test_reintenta_errores_transitorios_con_espera_creciente(self):
        cli = ClienteFalso(guion=[SC.ErrorTransitorio('HTTP 503'), SC.ErrorTransitorio('HTTP 503')])
        res = self.subir(cli, limite=1)
        self.assertEqual(res['subidas'], 1)
        self.assertEqual(res['fallidas'], 0)
        self.assertEqual(self.esperas, [2, 5])
        self.assertEqual(len(cli.llamadas), 3)
        self.assertEqual(next(iter(self.estado().values()))['intentos'], 3)

    def test_transitorio_sin_exito_queda_fallida_y_se_reintenta_en_la_proxima_corrida(self):
        cli = ClienteFalso(guion=[SC.ErrorTransitorio('x')] * 5)
        res = self.subir(cli, limite=1, reintentos=4)
        self.assertEqual((res['fallidas'], res['subidas']), (1, 0))
        fid = next(iter(res['fallos']))
        self.assertIn('TRANSITORIO', res['fallos'][fid])
        self.assertEqual(self.estado()[fid]['estado'], 'FALLIDA')
        res2 = self.subir(ClienteFalso())                                        # vuelve a correr: reintenta SOLO lo que falto
        self.assertEqual(res2['fallidas'], 0)
        self.assertEqual(self.estado()[fid]['estado'], 'SUBIDA')
        self.assertEqual(res2['yaConfirmadasAntes'], 0)

    def test_rechazo_permanente_no_se_reintenta(self):
        cli = ClienteFalso(guion=[SC.ErrorPermanente('INVALID_IMAGEN')])
        res = self.subir(cli, limite=1)
        self.assertEqual(res['fallidas'], 1)
        self.assertEqual(len(cli.llamadas), 1)
        self.assertEqual(self.esperas, [])
        self.assertIn('INVALID_IMAGEN', next(iter(res['fallos'].values())))

    def test_error_de_autenticacion_aborta_sin_marcar_fallidas_las_demas(self):
        cli = ClienteFalso(guion=[SC.ErrorAutenticacion('el storage rechazo la firma')])
        res = self.subir(cli)
        self.assertIsNotNone(res['abortada'])
        self.assertEqual(len(cli.llamadas), 1)
        self.assertEqual(res['subidas'] + res['fallidas'], 0)
        self.assertEqual(res['pendientes'], res['previstas'])
        self.assertEqual(self.estado(), {})

    def test_limite_y_continuar_despues(self):
        cli = ClienteFalso()
        res = self.subir(cli, limite=2)
        self.assertEqual((res['subidas'], res['pendientes']), (2, res['previstas'] - 2))
        res2 = self.subir(cli)
        self.assertEqual(res2['yaConfirmadasAntes'], 2)
        self.assertEqual(res2['subidas'], res['previstas'] - 2)
        self.assertEqual(len({c['fotoId'] for c in cli.llamadas}), res['previstas'])      # ninguna dos veces
        self.assertEqual(len(cli.llamadas), res['previstas'])

    def test_se_puede_continuar_despues_de_una_interrupcion(self):
        cli = ClienteFalso()
        self.subir(cli, limite=3)
        with open(str(self.lote / I.ESTADO_ARCHIVO), 'a', encoding='utf-8') as f:
            f.write('{"fotoId": "corta')                                         # linea cortada por un corte de luz
        res = self.subir(ClienteFalso())
        self.assertEqual(res['yaConfirmadasAntes'], 3)
        self.assertEqual(res['fallidas'], 0)

    def test_un_archivo_que_cambia_justo_antes_de_subir_no_se_sube(self):
        h = self.dry_run()
        plan = I.verificar_plan(self.lote, h)
        e = plan['elementos'][0]
        ruta = self.lote / 'normalizado' / (e['fotoId'] + '.jpg')
        ruta.write_bytes(ruta.read_bytes() + b'\x00')
        cli = ClienteFalso()
        filas = {f['fotoId']: f for f in json.loads((self.lote / 'filas_FotosPozos.json').read_text(encoding='utf-8'))}
        reg = I._subir_una(cli, self.lote, e, filas[e['fotoId']], 0, self.sin_espera)
        self.assertEqual(reg['estado'], 'FALLIDA')
        self.assertIn('CAMBIO', reg['motivo'])
        self.assertEqual(cli.llamadas, [])

    def test_respuesta_sin_ids_validos_es_fallida(self):
        class Mal(ClienteFalso):
            def put_foto_pozo(self, *a):
                return {'status': 'ok', 'driveFileId': '', 'driveThumbId': 'x'}
        res = self.subir(Mal(), limite=1)
        self.assertEqual(res['fallidas'], 1)

    def test_el_reporte_y_el_estado_no_traen_secreto_url_ni_nombres_originales(self):
        self.subir(ClienteFalso())
        todo = ((self.lote / 'reporte_subida.txt').read_text(encoding='utf-8') + (self.lote / I.ESTADO_ARCHIVO).read_text(encoding='utf-8')).lower()
        for tabu in (SECRETO, 'url_privada', 'apellido', 'otroapellido', 'dcim', 'relevamiento 2018/', 'monitoreo/2026', 'script.google'):
            self.assertNotIn(tabu.lower(), todo)

    def test_no_modifica_los_archivos_del_lote_ni_los_originales(self):
        antes = {p.name: p.read_bytes() for p in (self.lote / 'normalizado').iterdir()}
        orig = {str(p): p.read_bytes() for p in self.raiz.rglob('*') if p.is_file()}
        self.subir(ClienteFalso())
        self.assertEqual(antes, {p.name: p.read_bytes() for p in (self.lote / 'normalizado').iterdir()})
        self.assertEqual(orig, {str(p): p.read_bytes() for p in self.raiz.rglob('*') if p.is_file()})


class ExportarFilasTests(LoteBase):
    def _leer(self):
        with open(str(self.lote / I.STAGING_ARCHIVO), encoding='utf-8', newline='') as f:
            return list(csv.reader(f))

    def test_exporta_solo_lo_confirmado_con_ids_y_el_esquema_exacto(self):
        cli = ClienteFalso()
        self.subir(cli, limite=2)
        res = I.exportar_filas(self.lote, log=self.silencio)
        filas = self._leer()
        self.assertEqual(filas[0], C.FOTOSPOZOS_COLUMNAS)
        self.assertEqual(len(filas) - 1, 2)
        self.assertEqual(res['exportadas'], 2)
        self.assertGreater(res['sinSubidaConfirmada'], 0)
        for r in filas[1:]:
            d = dict(zip(C.FOTOSPOZOS_COLUMNAS, r))
            self.assertRegex(d['driveFileId'], I.RE_DRIVE_ID)
            self.assertRegex(d['driveThumbId'], I.RE_DRIVE_ID)
            self.assertEqual((d['estadoVinculo'], d['estado'], d['emailUsuarioCarga']), ('CONFIRMADO', 'ACTIVA', 'IMPORTACION'))

    def test_no_exporta_fallidas_ni_pendientes(self):
        cli = ClienteFalso(guion=[SC.ErrorPermanente('INVALID_IMAGEN')])
        self.subir(cli, limite=2)
        res = I.exportar_filas(self.lote, log=self.silencio)
        self.assertEqual(res['exportadas'], 1)

    def test_sin_subidas_exporta_solo_el_encabezado(self):
        self.dry_run()
        res = I.exportar_filas(self.lote, log=self.silencio)
        self.assertEqual(res['exportadas'], 0)
        self.assertEqual(len(self._leer()), 1)

    def test_incluye_ya_existe(self):
        cli = ClienteFalso()
        fid = I.planificar(self.lote)['elementos'][0]['fotoId']
        cli.existentes.add(fid)
        self.subir(cli, limite=1)
        self.assertEqual(self.estado()[fid]['estado'], 'YA_EXISTE')
        self.assertEqual(I.exportar_filas(self.lote, log=self.silencio)['exportadas'], 1)

    def test_csv_sin_rutas_nombres_secretos_ni_url(self):
        self.subir(ClienteFalso())
        I.exportar_filas(self.lote, log=self.silencio)
        txt = (self.lote / I.STAGING_ARCHIVO).read_text(encoding='utf-8').lower()
        for tabu in (SECRETO, 'url_privada', 'apellido', 'otroapellido', 'dcim', 'relevamiento 2018/', 'monitoreo/2026', '.jpg', 'script.google', 'todos/'):
            self.assertNotIn(tabu.lower(), txt)

    def test_valida_el_esquema_antes_de_escribir(self):
        self.subir(ClienteFalso(), limite=2)
        reg = self.estado()
        fid = next(iter(reg))
        _registrar = dict(reg[fid], driveThumbId=reg[fid]['driveFileId'])           # mismo archivo para imagen y miniatura
        I._registrar(self.lote, _registrar)
        with self.assertRaises(I.ErrorImportacion):
            I.exportar_filas(self.lote, log=self.silencio)
        self.assertFalse((self.lote / I.STAGING_ARCHIVO).exists())

    def test_rechaza_un_peso_de_drive_distinto_al_de_la_fila(self):
        self.subir(ClienteFalso(), limite=1)
        reg = next(iter(self.estado().values()))
        I._registrar(self.lote, dict(reg, tamanoBytes=reg['tamanoBytes'] + 1))
        with self.assertRaises(I.ErrorImportacion):
            I.exportar_filas(self.lote, log=self.silencio)

    def test_se_niega_si_el_lote_cambio_desde_el_dry_run(self):
        self.subir(ClienteFalso(), limite=1)
        fid = I.planificar(self.lote)['elementos'][0]['fotoId']
        f = self.lote / 'thumbs' / (fid + '_thumb.jpg')
        f.write_bytes(f.read_bytes() + b'\x00')
        with self.assertRaises(I.ErrorImportacion):
            I.exportar_filas(self.lote, log=self.silencio)

    def test_main_exportar_filas(self):
        self.subir(ClienteFalso())
        with redirect_stdout(io.StringIO()):
            self.assertEqual(I.main(['exportar-filas', '--lote', 'lote', '--salida', str(self.out)]), 0)
        self.assertTrue((self.lote / I.STAGING_ARCHIVO).is_file())


@unittest.skipUnless(NODE, 'node no disponible')
class PuntaAPuntaConElStorageRealTests(LoteBase):
    """Importador Python -> HTTP real -> storage/src REAL (Drive en memoria). Verifica protocolo, 302, idempotencia."""

    def _servidor(self, **entorno):
        env = dict(os.environ, PRUEBA_SECRETO=SECRETO, **{k: str(v) for k, v in entorno.items()})
        p = subprocess.Popen([NODE, str(Path(__file__).resolve().parent / 'servidor_storage_prueba.js')], cwd=str(REPO), env=env,
                             stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        self.addCleanup(lambda: (p.kill(), p.wait(), p.stdout.close(), p.stderr.close()))
        linea = p.stdout.readline().strip()
        self.assertTrue(linea.startswith('PORT '), linea + p.stderr.read() if p.poll() is not None else linea)
        return int(linea.split()[1])

    def _entorno(self, puerto, secreto=SECRETO):
        viejo = {k: os.environ.get(k) for k in (SC.ENV_URL, SC.ENV_SECRETO)}
        os.environ[SC.ENV_URL] = 'http://127.0.0.1:%d/' % puerto
        os.environ[SC.ENV_SECRETO] = secreto

        def restaurar():
            for k, v in viejo.items():
                if v is None:
                    os.environ.pop(k, None)
                else:
                    os.environ[k] = v
        self.addCleanup(restaurar)

    def _estado_servidor(self, puerto):
        import urllib.request
        with urllib.request.urlopen('http://127.0.0.1:%d/estado' % puerto, timeout=10) as r:
            return json.loads(r.read().decode())['archivos']

    def _correr(self, *extra):
        h = self.dry_run()
        sal = io.StringIO()
        with redirect_stdout(sal), redirect_stderr(sal):
            codigo = I.main(['subir', '--lote', 'lote', '--salida', str(self.out), '--confirmar-huella', h] + list(extra), esperar=self.sin_espera)
        return codigo, sal.getvalue()

    def test_sube_todo_con_la_estructura_de_carpetas_y_nombres_solo_por_fotoid(self):
        puerto = self._servidor()
        self._entorno(puerto)
        codigo, salida = self._correr()
        self.assertEqual(codigo, 0, salida)
        plan = json.loads((self.lote / 'plan_importacion.json').read_text(encoding='utf-8'))
        archivos = self._estado_servidor(puerto)
        self.assertEqual(len(archivos), 2 * plan['cantidad'])
        esperados = {(e['destino'].split('/')[3], e['destino'].split('/')[2], e['destino'].split('/')[1]) for e in plan['elementos']}
        vistos = {(a['nombre'], a['carpeta'], a['padre']) for a in archivos if not a['nombre'].endswith('_thumb.jpg')}
        self.assertEqual(vistos, esperados)
        for a in archivos:
            self.assertRegex(a['nombre'], r'^[0-9a-f-]{36}(_thumb)?\.jpg$')
        self.assertEqual({r['estado'] for r in self.estado().values()}, {'SUBIDA'})
        self.assertNotIn(SECRETO, salida)

    def test_reanudar_no_reenvia_y_sin_el_archivo_de_estado_detecta_ya_existe_sin_duplicar(self):
        puerto = self._servidor()
        self._entorno(puerto)
        self.assertEqual(self._correr()[0], 0)
        n = len(self._estado_servidor(puerto))
        self.assertEqual(self._correr()[0], 0)                                   # misma corrida de nuevo: nada nuevo
        self.assertEqual(len(self._estado_servidor(puerto)), n)
        (self.lote / I.ESTADO_ARCHIVO).unlink()                                  # se perdio el progreso local
        codigo, _ = self._correr()
        self.assertEqual(codigo, 0)
        self.assertEqual(len(self._estado_servidor(puerto)), n)                  # Drive no se duplica
        self.assertEqual({r['estado'] for r in self.estado().values()}, {'YA_EXISTE'})

    def test_reintenta_los_http_500_del_servidor(self):
        puerto = self._servidor(PRUEBA_500_PRIMEROS=2, PRUEBA_INTERNAL_PRIMEROS=0)
        self._entorno(puerto)
        codigo, salida = self._correr('--limite', '1')
        self.assertEqual(codigo, 0, salida)
        self.assertEqual(self.esperas, [2, 5])

    def test_secreto_equivocado_aborta_y_no_sube_nada(self):
        puerto = self._servidor()
        self._entorno(puerto, secreto='otro-secreto-distinto-0123')
        codigo, salida = self._correr()
        self.assertEqual(codigo, 1)
        self.assertIn('ABORTADA', salida)
        self.assertNotIn('otro-secreto', salida)
        self.assertNotIn(SECRETO, salida)
        self.assertEqual(self._estado_servidor(puerto), [])

    def test_de_punta_a_punta_hasta_el_csv_de_staging(self):
        puerto = self._servidor()
        self._entorno(puerto)
        self.assertEqual(self._correr()[0], 0)
        with redirect_stdout(io.StringIO()):
            self.assertEqual(I.main(['exportar-filas', '--lote', 'lote', '--salida', str(self.out)]), 0)
        with open(str(self.lote / I.STAGING_ARCHIVO), encoding='utf-8', newline='') as f:
            filas = list(csv.DictReader(f))
        ids_servidor = {a['nombre'] for a in self._estado_servidor(puerto)}
        self.assertEqual(len(filas), len(self.estado()))
        for fila in filas:
            self.assertIn(fila['fotoId'] + '.jpg', ids_servidor)

    def test_el_csv_de_staging_lo_acepta_la_validacion_real_de_apps_script(self):
        """Contrato entre las dos puntas: lo que exporta Python lo valida backend/src/FotosPozosImport.js (codigo real)."""
        puerto = self._servidor()
        self._entorno(puerto)
        self.assertEqual(self._correr()[0], 0)
        with redirect_stdout(io.StringIO()):
            self.assertEqual(I.main(['exportar-filas', '--lote', 'lote', '--salida', str(self.out)]), 0)
        with open(str(self.lote / I.STAGING_ARCHIVO), encoding='utf-8', newline='') as f:
            filas = list(csv.DictReader(f))                     # todo texto, como lo deja Sheets con la columna en '@'
        self.assertGreater(len(filas), 0)
        entrada = self.out / 'filas.json'
        entrada.write_text(json.dumps(filas), encoding='utf-8')
        js = ("const fs=require('fs');const S=require('./backend/src/FotosPozosService.js');const R=require('./backend/src/FotosPozosRepository.js');"
              "const I=require('./backend/src/FotosPozosImport.js');Object.assign(global,S,R,I);"
              "const filas=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));"
              "console.log(JSON.stringify(filas.map(f=>I.fotosPozosImport_normalizarFila(f,new Date()))))")
        salida = subprocess.run([NODE, '-e', js, str(entrada)], cwd=str(REPO), capture_output=True, text=True)
        self.assertEqual(salida.returncode, 0, salida.stderr)
        resultados = json.loads(salida.stdout)
        self.assertEqual([r.get('motivo') for r in resultados if not r['ok']], [])
        self.assertEqual({r['foto']['fotoId'] for r in resultados}, {f['fotoId'] for f in filas})


if __name__ == '__main__':
    unittest.main()
