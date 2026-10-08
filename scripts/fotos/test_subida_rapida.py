# -*- coding: utf-8 -*-
"""Tests de la subida con concurrencia (--concurrencia) y por lotes (--lote-tamano). Mismas garantias que la subida de a una:
idempotencia, reanudacion, una foto fallida no frena a las demas, abortar solo ante errores de autenticacion."""
import base64
import io
import json
import os
import subprocess
import sys
import threading
import time
import unittest
from contextlib import redirect_stdout
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import importar as I  # noqa: E402
import storage_cliente as SC  # noqa: E402
import test_subida as TS  # noqa: E402


class ClienteRapidoFalso(TS.ClienteFalso):
    """ClienteFalso seguro para hilos, con demora por solicitud, medicion de solicitudes simultaneas y soporte de lotes.
    por_foto: {fotoId: {'code': 'INTERNAL'}} -> resultado de error de ESA foto dentro de un lote (una sola vez si 'una_vez')."""

    def __init__(self, demora=0.0, por_foto=None, **kw):
        TS.ClienteFalso.__init__(self, **kw)
        self.demora = demora
        self.por_foto = dict(por_foto or {})
        self.lote_llamadas = []
        self._lock = threading.Lock()
        self._en_vuelo = 0
        self.max_en_vuelo = 0

    def _entrar(self):
        with self._lock:
            self._en_vuelo += 1
            self.max_en_vuelo = max(self.max_en_vuelo, self._en_vuelo)
        time.sleep(self.demora)

    def _salir(self):
        with self._lock:
            self._en_vuelo -= 1

    def put_foto_pozo(self, fotoId, fuente, carpeta_fecha, imagen_b64, thumb_b64):
        self._entrar()
        try:
            with self._lock:
                accion = self.por_foto.get(fotoId)
                if isinstance(accion, Exception):
                    self.llamadas.append({'fotoId': fotoId})
                    raise accion
            return TS.ClienteFalso.put_foto_pozo(self, fotoId, fuente, carpeta_fecha, imagen_b64, thumb_b64)
        finally:
            self._salir()

    def put_fotos_pozo_lote(self, items):
        self._entrar()
        try:
            with self._lock:
                self.lote_llamadas.append([i['fotoId'] for i in items])
                if isinstance(self.guion[:1] and self.guion[0], Exception):
                    raise self.guion.pop(0)
                resultados = []
                for it in items:
                    err = self.por_foto.get(it['fotoId'])
                    if isinstance(err, dict):
                        if err.get('una_vez'):
                            self.por_foto.pop(it['fotoId'])
                        resultados.append({'status': 'error', 'code': err['code'], 'fotoId': it['fotoId']})
                        continue
                    existente = it['fotoId'] in self.existentes
                    self.existentes.add(it['fotoId'])
                    self.llamadas.append({'fotoId': it['fotoId']})
                    resultados.append({'status': 'ok', 'fotoId': it['fotoId'], 'driveFileId': 'F' + it['fotoId'].replace('-', '')[:20],
                                       'driveThumbId': 'T' + it['fotoId'].replace('-', '')[:20],
                                       'tamanoBytes': len(base64.b64decode(it['imagenBase64'])), 'existente': existente,
                                       'tiempos': {'carpetas': 5, 'imagen': 7, 'total': 20}})
                if self.por_foto.get('__omitir_ultima__') and resultados:
                    resultados.pop()
                return {'status': 'ok', 'resultados': resultados}
        finally:
            self._salir()


class ConcurrenciaTests(TS.LoteBase):
    def test_sube_en_paralelo_sin_superar_el_tope_y_registra_todas(self):
        c = ClienteRapidoFalso(demora=0.15)
        res = self.subir(c, concurrencia=2)
        self.assertEqual(c.max_en_vuelo, 2)
        self.assertEqual(res['fallidas'], 0)
        self.assertEqual(res['subidas'], res['previstas'])
        self.assertEqual({r['estado'] for r in self.estado().values()}, {'SUBIDA'})
        self.assertEqual(len(self.estado()), res['previstas'])

    def test_el_resultado_es_el_mismo_que_de_a_una(self):
        a = ClienteRapidoFalso()
        self.subir(a, concurrencia=1)
        de_a_una = {k: (v['estado'], v['driveFileId']) for k, v in self.estado().items()}
        (self.lote / I.ESTADO_ARCHIVO).unlink()
        b = ClienteRapidoFalso()
        self.subir(b, huella=None, concurrencia=3)
        paralelo = {k: (v['estado'], v['driveFileId']) for k, v in self.estado().items()}
        self.assertEqual(de_a_una, paralelo)
        self.assertEqual(sorted(x['fotoId'] for x in a.llamadas), sorted(x['fotoId'] for x in b.llamadas))

    def test_una_foto_rechazada_no_frena_a_las_demas(self):
        h = self.dry_run()
        plan = json.loads((self.lote / 'plan_importacion.json').read_text(encoding='utf-8'))
        previstas = plan['cantidad']
        malo = plan['elementos'][0]['fotoId']
        c = ClienteRapidoFalso(demora=0.05, por_foto={malo: SC.ErrorPermanente('INVALID_IMAGE')})
        res = self.subir(c, huella=h, concurrencia=3)
        self.assertEqual(res['fallidas'], 1)
        self.assertEqual(res['subidas'], previstas - 1)
        self.assertEqual(self.estado()[malo]['estado'], 'FALLIDA')
        self.assertIn('RECHAZADA', self.estado()[malo]['motivo'])

    def test_error_de_autenticacion_aborta_sin_marcar_fallidas_y_se_puede_reanudar(self):
        c = ClienteRapidoFalso(demora=0.05, por_foto={})
        h = self.dry_run()
        plan = json.loads((self.lote / 'plan_importacion.json').read_text(encoding='utf-8'))
        primero = plan['elementos'][0]['fotoId']
        c.por_foto[primero] = SC.ErrorAutenticacion('firma')
        res = self.subir(c, huella=h, concurrencia=2)
        self.assertIsNotNone(res['abortada'])
        self.assertEqual(res['fallidas'], 0)
        self.assertNotIn(primero, self.estado())                   # la abortada no queda anotada como fallida
        self.assertEqual(res['subidas'] + res['pendientes'] + res['yaConfirmadasAntes'], res['previstas'])
        c2 = ClienteRapidoFalso()
        res2 = self.subir(c2, huella=h, concurrencia=2)
        self.assertEqual(res2['fallidas'], 0)
        self.assertEqual(len(self.estado()), res['previstas'])
        self.assertEqual({r['estado'] for r in self.estado().values()}, {'SUBIDA'})

    def test_limite_con_concurrencia(self):
        c = ClienteRapidoFalso()
        res = self.subir(c, limite=2, concurrencia=3)
        self.assertEqual(res['subidas'], 2)
        self.assertEqual(res['pendientes'], res['previstas'] - 2)
        self.assertEqual(len(c.llamadas), 2)

    def test_no_reenvia_lo_ya_confirmado(self):
        h = self.dry_run()
        self.subir(ClienteRapidoFalso(), huella=h, concurrencia=2)
        c = ClienteRapidoFalso()
        res = self.subir(c, huella=h, concurrencia=2)
        self.assertEqual(c.llamadas, [])
        self.assertEqual(res['yaConfirmadasAntes'], res['previstas'])

    def test_parametros_fuera_de_rango_se_rechazan_antes_de_subir(self):
        c = ClienteRapidoFalso()
        for kw in ({'concurrencia': 0}, {'concurrencia': I.MAX_CONCURRENCIA + 1}, {'tamano_lote': 0}, {'tamano_lote': I.MAX_LOTE + 1}):
            with self.assertRaises(I.ErrorImportacion):
                self.subir(c, **kw)
        self.assertEqual(c.llamadas, [])

    def test_registra_tiempos_por_foto_y_resumen(self):
        c = ClienteRapidoFalso(demora=0.05)
        res = self.subir(c, concurrencia=2)
        reg = next(iter(self.estado().values()))
        self.assertEqual(set(reg['ms']), {'leer', 'b64', 'http'})
        self.assertIn('Ritmo:', (self.lote / 'reporte_subida.txt').read_text(encoding='utf-8'))
        self.assertIn('http', res['ms'])


class LoteTests(TS.LoteBase):
    def test_manda_varias_fotos_por_solicitud(self):
        c = ClienteRapidoFalso()
        res = self.subir(c, tamano_lote=2)
        self.assertEqual(res['subidas'], res['previstas'])
        self.assertEqual(sum(len(x) for x in c.lote_llamadas), res['previstas'])
        self.assertTrue(all(len(x) <= 2 for x in c.lote_llamadas))
        self.assertEqual(len(c.lote_llamadas), -(-res['previstas'] // 2))
        reg = next(iter(self.estado().values()))
        self.assertEqual(reg['tiemposStorage'], {'carpetas': 5, 'imagen': 7, 'total': 20})
        self.assertEqual(reg['ms']['lote'], 2 if res['previstas'] > 1 else 1)

    def test_lo_transitorio_de_una_foto_se_reintenta_solo_para_esa(self):
        h = self.dry_run()
        plan = json.loads((self.lote / 'plan_importacion.json').read_text(encoding='utf-8'))
        ids = [e['fotoId'] for e in plan['elementos']]
        c = ClienteRapidoFalso(por_foto={ids[0]: {'code': 'INTERNAL', 'una_vez': True}})
        res = self.subir(c, huella=h, tamano_lote=len(ids))
        self.assertEqual(res['fallidas'], 0)
        self.assertEqual(c.lote_llamadas[0], ids)
        self.assertEqual(c.lote_llamadas[1], [ids[0]])           # el reintento lleva SOLO la que fallo
        self.assertEqual(self.estado()[ids[0]]['intentos'], 2)
        self.assertEqual(self.esperas, [2])

    def test_un_rechazo_definitivo_no_se_reintenta_ni_frena_a_las_demas(self):
        h = self.dry_run()
        plan = json.loads((self.lote / 'plan_importacion.json').read_text(encoding='utf-8'))
        ids = [e['fotoId'] for e in plan['elementos']]
        c = ClienteRapidoFalso(por_foto={ids[0]: {'code': 'INVALID_IMAGE'}})
        res = self.subir(c, huella=h, tamano_lote=len(ids))
        self.assertEqual(res['fallidas'], 1)
        self.assertEqual(res['subidas'], len(ids) - 1)
        self.assertEqual(len(c.lote_llamadas), 1)
        self.assertEqual(self.estado()[ids[0]]['motivo'], 'RECHAZADA: INVALID_IMAGE')

    def test_transitorio_que_nunca_cede_queda_fallida_y_se_reintenta_en_la_proxima_corrida(self):
        h = self.dry_run()
        plan = json.loads((self.lote / 'plan_importacion.json').read_text(encoding='utf-8'))
        ids = [e['fotoId'] for e in plan['elementos']]
        c = ClienteRapidoFalso(por_foto={ids[0]: {'code': 'TIEMPO_AGOTADO'}})
        res = self.subir(c, huella=h, tamano_lote=len(ids), reintentos=2)
        self.assertEqual(res['fallidas'], 1)
        self.assertTrue(self.estado()[ids[0]]['motivo'].startswith('TRANSITORIO_SIN_EXITO'))
        self.assertEqual(self.estado()[ids[0]]['intentos'], 3)
        res2 = self.subir(ClienteRapidoFalso(), huella=h, tamano_lote=len(ids))
        self.assertEqual(res2['subidas'], 1)
        self.assertEqual(res2['yaConfirmadasAntes'], len(ids) - 1)

    def test_error_de_red_en_toda_la_solicitud_reintenta_el_lote_entero(self):
        c = ClienteRapidoFalso(guion=[SC.ErrorTransitorio('HTTP 500')])
        res = self.subir(c, tamano_lote=10)
        self.assertEqual(res['fallidas'], 0)
        self.assertEqual(len(c.lote_llamadas), 2)
        self.assertEqual(c.lote_llamadas[0], c.lote_llamadas[1])

    def test_respuesta_incompleta_se_trata_como_transitoria_para_la_foto_faltante(self):
        c = ClienteRapidoFalso(por_foto={'__omitir_ultima__': True})
        c.por_foto['__omitir_ultima__'] = True
        res = self.subir(c, tamano_lote=10, reintentos=1)
        self.assertEqual(res['fallidas'], 1)
        self.assertIn('RESPUESTA_INCOMPLETA', list(res['fallos'].values())[0])

    def test_storage_sin_soporte_de_lotes_aborta_sin_marcar_fallidas(self):
        c = ClienteRapidoFalso(guion=[SC.ErrorPermanente('UNKNOWN_ACTION')])
        res = self.subir(c, tamano_lote=3)
        self.assertIn('--lote-tamano 1', res['abortada'])
        self.assertEqual(res['fallidas'], 0)
        self.assertEqual(self.estado(), {})

    def test_lote_con_concurrencia(self):
        c = ClienteRapidoFalso(demora=0.1)
        res = self.subir(c, tamano_lote=1 + 1, concurrencia=2)
        self.assertEqual(res['subidas'], res['previstas'])
        self.assertLessEqual(c.max_en_vuelo, 2)

    def test_un_archivo_que_cambia_justo_antes_de_subir_no_se_envia_y_las_demas_si(self):
        h = self.dry_run()
        plan = I.verificar_plan(self.lote, h)
        elementos = plan['elementos']
        ruta = self.lote / 'normalizado' / (elementos[0]['fotoId'] + '.jpg')
        ruta.write_bytes(ruta.read_bytes() + b'\x00')
        filas = {f['fotoId']: f for f in json.loads((self.lote / 'filas_FotosPozos.json').read_text(encoding='utf-8'))}
        c = ClienteRapidoFalso()
        regs = I._subir_lote(c, self.lote, elementos, filas, 0, self.sin_espera)
        self.assertEqual([r['estado'] for r in regs], ['FALLIDA'] + ['SUBIDA'] * (len(elementos) - 1))
        self.assertEqual(regs[0]['motivo'], 'ARCHIVO_CAMBIO_DESPUES_DEL_DRY_RUN')
        self.assertNotIn(elementos[0]['fotoId'], [i for lista in c.lote_llamadas for i in lista])


@unittest.skipUnless(TS.NODE, 'node no disponible')
class PuntaAPuntaRapidaTests(TS.PuntaAPuntaConElStorageRealTests):
    """Contra el codigo REAL del storage (Drive en memoria): lote y concurrencia no duplican ni pierden nada."""

    # de la clase base solo se usan las ayudas: sus tests se anulan abajo para no correrlos dos veces
    def _cantidad(self):
        return json.loads((self.lote / 'plan_importacion.json').read_text(encoding='utf-8'))['cantidad']

    def test_lote_sube_todo_y_reenviar_no_duplica(self):
        puerto = self._servidor()
        self._entorno(puerto)
        codigo, salida = self._correr('--lote-tamano', '10')
        self.assertEqual(codigo, 0, salida)
        n = len(self._estado_servidor(puerto))
        self.assertEqual(n, 2 * self._cantidad())
        (self.lote / I.ESTADO_ARCHIVO).unlink()                            # se perdio el progreso local
        codigo, _ = self._correr('--lote-tamano', '10')
        self.assertEqual(codigo, 0)
        self.assertEqual(len(self._estado_servidor(puerto)), n)             # Drive no se duplico
        self.assertEqual({r['estado'] for r in self.estado().values()}, {'YA_EXISTE'})
        self.assertNotIn(SECRETO_PRUEBA, salida)

    def test_concurrencia_con_latencia_es_mas_rapida_y_no_duplica(self):
        puerto = self._servidor(PRUEBA_LATENCIA_MS=400)
        self._entorno(puerto)
        t0 = time.time()
        codigo, salida = self._correr('--concurrencia', '3')
        paralelo = time.time() - t0
        self.assertEqual(codigo, 0, salida)
        n = self._cantidad()
        self.assertEqual(len(self._estado_servidor(puerto)), 2 * n)
        self.assertEqual({r['estado'] for r in self.estado().values()}, {'SUBIDA'})
        self.assertLess(paralelo, 0.4 * n * 0.9 + 1.5)                     # n fotos de 0,4 s en 3 a la vez: bastante menos que n*0,4 s

    def test_lote_reintenta_los_http_500(self):
        puerto = self._servidor(PRUEBA_500_PRIMEROS=1)
        self._entorno(puerto)
        codigo, salida = self._correr('--lote-tamano', '10')
        self.assertEqual(codigo, 0, salida)
        self.assertEqual(self.esperas, [2])
        self.assertEqual(len(self._estado_servidor(puerto)), 2 * self._cantidad())


    # ---- benchmark controlado ----
    def _bench(self, *extra):
        import benchmark_subida as B
        self.dry_run()
        sal = io.StringIO()
        with redirect_stdout(sal):
            codigo = B.main(['medir', '--lote', 'lote', '--salida', str(self.out)] + list(extra), cliente_factory=SC.ClienteStorage.desde_entorno)
        return codigo, sal.getvalue()

    def test_benchmark_sin_confirmar_no_sube_nada(self):
        puerto = self._servidor()
        self._entorno(puerto)
        codigo, salida = self._bench('--cantidad', '3', '--modos', 's,c2')
        self.assertEqual(codigo, 0)
        self.assertIn('No se subio nada', salida)
        self.assertEqual(self._estado_servidor(puerto), [])

    def test_benchmark_usa_ids_nuevos_en_carpeta_descartable_y_lo_deja_todo_en_la_papelera(self):
        puerto = self._servidor()
        self._entorno(puerto)
        plan = json.loads((self.lote / 'plan_importacion.json').read_text(encoding='utf-8')) if (self.lote / 'plan_importacion.json').exists() else None
        codigo, salida = self._bench('--cantidad', '3', '--modos', 's,c2,l2,l2c2', '--confirmar-benchmark')
        self.assertEqual(codigo, 0, salida)
        archivos = self._estado_servidor(puerto)
        self.assertEqual(len(archivos), 2 * (1 + 4 * 3))                              # calentamiento + 4 modos x 3 fotos, JPG + miniatura
        self.assertEqual({a['padre'] for a in archivos}, {'BENCHMARK_TEMP'})
        self.assertEqual({a['carpeta'] for a in archivos}, {'sin_fecha'})
        self.assertTrue(all(a['papelera'] for a in archivos), 'todo debe quedar en la papelera')
        reales = {e['fotoId'] for e in json.loads((self.lote / 'plan_importacion.json').read_text(encoding='utf-8'))['elementos']}
        self.assertFalse(any(a['nombre'].split('.')[0].replace('_thumb', '') in reales for a in archivos))
        resultado = json.loads((self.out / 'benchmark' / 'benchmark_resultado.json').read_text(encoding='utf-8'))
        self.assertEqual([r['modo'] for r in resultado['resultados']], ['s', 'c2', 'l2', 'l2c2'])
        self.assertTrue(all(r['fallidas'] == 0 and r['subidas'] == 3 for r in resultado['resultados']))
        self.assertNotIn(SECRETO_PRUEBA, salida)
        self.assertNotIn('127.0.0.1', salida)

    def test_benchmark_conservar_y_limpiar(self):
        import benchmark_subida as B
        puerto = self._servidor()
        self._entorno(puerto)
        codigo, _ = self._bench('--cantidad', '2', '--modos', 's', '--confirmar-benchmark', '--conservar')
        self.assertEqual(codigo, 0)
        self.assertFalse(any(a['papelera'] for a in self._estado_servidor(puerto)))
        sal = io.StringIO()
        with redirect_stdout(sal):
            self.assertEqual(B.main(['limpiar', '--salida', str(self.out)], cliente_factory=SC.ClienteStorage.desde_entorno), 0)
        self.assertTrue(all(a['papelera'] for a in self._estado_servidor(puerto)))
        with redirect_stdout(sal):                                                    # segunda vez: no repite
            self.assertEqual(B.main(['limpiar', '--salida', str(self.out)], cliente_factory=SC.ClienteStorage.desde_entorno), 0)
        self.assertIn('Papelera: 0 archivos', sal.getvalue())

    def test_limpiar_ignora_registros_ajenos_al_benchmark_y_ids_de_lotes_reales(self):
        import benchmark_subida as B
        puerto = self._servidor()
        self._entorno(puerto)
        self.assertEqual(self._correr()[0], 0)                                        # sube el lote REAL de prueba
        reales = list(self.estado().values())
        priv = self.out / 'benchmark'
        priv.mkdir()
        # 1) registro sin marca del benchmark  2) con marca pero apuntando a un archivo de un lote real
        lineas = [{'fotoId': 'x1', 'estado': 'SUBIDA', 'driveFileId': reales[0]['driveFileId']},
                  {'fotoId': 'x2', 'estado': 'SUBIDA', 'driveFileId': reales[1]['driveFileId'], 'origen': 'benchmark', 'fuente': 'BENCHMARK_TEMP'},
                  {'fotoId': 'x3', 'estado': 'SUBIDA', 'driveFileId': reales[2]['driveFileId'], 'origen': 'benchmark', 'fuente': 'MONITOREO_NE'}]
        (priv / B.ARCHIVO_IDS).write_text(''.join(json.dumps(x) + chr(10) for x in lineas), encoding='utf-8')
        sal = io.StringIO()
        with redirect_stdout(sal):
            self.assertEqual(B.main(['limpiar', '--salida', str(self.out)], cliente_factory=SC.ClienteStorage.desde_entorno), 0)
        self.assertFalse(any(a['papelera'] for a in self._estado_servidor(puerto)), 'no debe tocar nada real')
        self.assertIn('Papelera: 0 archivos', sal.getvalue())

    def test_benchmark_rechaza_modos_y_cantidades_invalidas(self):
        import benchmark_subida as B
        for modo in ('x', 'c0', 'c99', 'l11', 'l0c2'):
            with self.assertRaises(B.ErrorBenchmark):
                B.parsear_modos(modo)
        self.assertEqual(B.parsear_modos('s, c2 ,l5c3'), [('s', 1, 1), ('c2', 2, 1), ('l5c3', 3, 5)])


SECRETO_PRUEBA = TS.SECRETO


def _sin_tests_heredados():
    propios = set(PuntaAPuntaRapidaTests.__dict__)
    for nombre in dir(TS.PuntaAPuntaConElStorageRealTests):
        if nombre.startswith('test_') and nombre not in propios:
            setattr(PuntaAPuntaRapidaTests, nombre, None)


_sin_tests_heredados()


if __name__ == '__main__':
    unittest.main()
