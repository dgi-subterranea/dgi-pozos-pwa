# -*- coding: utf-8 -*-
"""Cliente HTTP firmado del Web App de STORAGE (segunda cuenta de Google) para el importador historico.

Mismo protocolo que backend/src/FotosStorageClient.js (hay un test cruzado contra storage/src/StorageAuth.js):
    sig = HMAC_SHA256(secreto, 'v1\\n' + accion + '\\n' + ts + '\\n' + nonce + '\\n' + payload)
La respuesta del storage viene firmada (accion 'response', mismo nonce); se rechaza si no es valida.

El URL y el secreto SOLO se leen de variables de entorno (FOTOS_STORAGE_URL y FOTOS_STORAGE_SECRET): nunca de
argumentos, archivos del repo ni .env versionados, y NUNCA se imprimen ni aparecen en mensajes de error.
"""
import hashlib
import hmac
import json
import os
import time
import urllib.error
import urllib.request
import uuid
from urllib.parse import urlparse

VERSION = 'v1'
TOLERANCIA_SEG = 300
ENV_URL = 'FOTOS_STORAGE_URL'
ENV_SECRETO = 'FOTOS_STORAGE_SECRET'
# Mayor que el limite de 6 minutos (360 s) de una ejecucion de Apps Script: si la solicitud se corta por tiempo es porque la
# ejecucion del storage YA termino o murio, y reintentar no puede cruzarse con una subida todavia en curso de la misma foto.
TIMEOUT_SEG = 400
SECRETO_MIN = 16


class ErrorConfiguracion(Exception):
    """Falta o es invalida una variable de entorno."""


class ErrorTransitorio(Exception):
    """Red caida, HTTP 5xx/429, respuesta ilegible o INTERNAL del storage: vale la pena reintentar."""


class ErrorAutenticacion(Exception):
    """El storage no acepto la firma (secreto distinto, reloj desfasado) o su respuesta no es de fiar: no reintentar."""


class ErrorPermanente(Exception):
    """El storage rechazo ESTA foto (INVALID_*): reintentar no ayuda. .codigo = codigo del storage."""

    def __init__(self, codigo):
        Exception.__init__(self, codigo)
        self.codigo = codigo


def firmar(secreto, accion, ts, nonce, payload):
    mensaje = '%s\n%s\n%s\n%s\n%s' % (VERSION, accion, ts, nonce, payload)
    return hmac.new(secreto.encode('utf-8'), mensaje.encode('utf-8'), hashlib.sha256).hexdigest()


def armar_solicitud(accion, payload_obj, secreto, ahora_seg, nonce):
    payload = json.dumps(payload_obj, separators=(',', ':'), ensure_ascii=False)
    return {'v': VERSION, 'action': accion, 'ts': ahora_seg, 'nonce': nonce, 'payload': payload,
            'sig': firmar(secreto, accion, ahora_seg, nonce, payload)}


def verificar_respuesta(cuerpo, secreto, nonce_esperado, ahora_seg):
    """Devuelve el payload ya parseado o levanta ErrorAutenticacion."""
    if not isinstance(cuerpo, dict) or not isinstance(cuerpo.get('payload'), str) or not isinstance(cuerpo.get('sig'), str):
        raise ErrorAutenticacion('la respuesta del storage no esta firmada (revisar el secreto y la URL)')
    if cuerpo.get('nonce') != nonce_esperado:
        raise ErrorAutenticacion('la respuesta del storage es de otra solicitud')
    try:
        ts = float(cuerpo.get('ts'))
    except (TypeError, ValueError):
        raise ErrorAutenticacion('la respuesta del storage no tiene hora valida')
    if abs(ahora_seg - ts) > TOLERANCIA_SEG:
        raise ErrorAutenticacion('la respuesta del storage esta vencida (revisar el reloj de la PC)')
    esperada = firmar(secreto, 'response', cuerpo['ts'], cuerpo['nonce'], cuerpo['payload'])
    if not hmac.compare_digest(esperada, cuerpo['sig']):
        raise ErrorAutenticacion('la firma de la respuesta del storage no es valida (revisar el secreto)')
    try:
        return json.loads(cuerpo['payload'])
    except ValueError:
        raise ErrorAutenticacion('la respuesta del storage no se pudo leer')


def configuracion_desde_entorno(entorno=None):
    """(url, secreto) desde variables de entorno. Valida sin imprimir nada. Solo https (o localhost para pruebas)."""
    env = os.environ if entorno is None else entorno
    url = (env.get(ENV_URL) or '').strip()
    secreto = env.get(ENV_SECRETO) or ''
    if not url or not secreto:
        raise ErrorConfiguracion('Faltan las variables de entorno %s y/o %s.' % (ENV_URL, ENV_SECRETO))
    partes = urlparse(url)
    local = partes.hostname in ('localhost', '127.0.0.1', '::1')
    if partes.scheme != 'https' and not (partes.scheme == 'http' and local):
        raise ErrorConfiguracion('%s debe ser una URL https.' % ENV_URL)
    if not partes.hostname:
        raise ErrorConfiguracion('%s no es una URL valida.' % ENV_URL)
    if len(secreto.strip()) < SECRETO_MIN:
        raise ErrorConfiguracion('%s es demasiado corto (minimo %d caracteres).' % (ENV_SECRETO, SECRETO_MIN))
    return url, secreto.strip()


class ClienteStorage(object):
    def __init__(self, url, secreto, abrir=None, reloj=None, generar_nonce=None, timeout=None):
        self._url = url
        self._timeout = timeout or TIMEOUT_SEG
        self._secreto = secreto
        self._abrir = abrir or self._abrir_urllib
        self._reloj = reloj or time.time
        self._nonce = generar_nonce or (lambda: str(uuid.uuid4()))

    def __repr__(self):                      # jamas deja ver URL ni secreto (logs, trazas, pruebas)
        return '<ClienteStorage>'

    @classmethod
    def desde_entorno(cls, entorno=None, **kw):
        url, secreto = configuracion_desde_entorno(entorno)
        return cls(url, secreto, **kw)

    def _abrir_urllib(self, cuerpo_bytes):
        pedido = urllib.request.Request(self._url, data=cuerpo_bytes, method='POST',
                                        headers={'Content-Type': 'text/plain;charset=utf-8'})
        # Apps Script responde la ejecucion con un 302 al resultado: urllib lo sigue (POST -> GET), igual que un navegador.
        with urllib.request.urlopen(pedido, timeout=self._timeout) as r:
            return r.status, r.read()

    def llamar(self, accion, payload_obj):
        """Ejecuta una accion firmada. Devuelve el dict del storage con status 'ok'; levanta ErrorTransitorio /
        ErrorAutenticacion / ErrorPermanente (nunca con el secreto, la URL ni el payload en el mensaje)."""
        nonce = self._nonce()
        solicitud = armar_solicitud(accion, payload_obj, self._secreto, int(self._reloj()), nonce)
        try:
            estado, datos = self._abrir(json.dumps(solicitud, separators=(',', ':')).encode('utf-8'))
        except urllib.error.HTTPError as e:
            raise ErrorTransitorio('HTTP %d' % e.code)
        except (urllib.error.URLError, OSError, TimeoutError) as e:
            raise ErrorTransitorio('sin conexion con el storage (%s)' % type(e).__name__)
        if estado != 200:
            raise ErrorTransitorio('HTTP %d' % estado)
        try:
            cuerpo = json.loads(datos.decode('utf-8'))
        except (ValueError, UnicodeDecodeError):
            raise ErrorTransitorio('el storage respondio algo que no es JSON')
        # Error SIN firmar: el storage rechazo la solicitud (firma/hora/replay) o fallo antes de firmar
        if isinstance(cuerpo, dict) and 'sig' not in cuerpo and cuerpo.get('status') == 'error':
            codigo = cuerpo.get('code')
            if codigo == 'UNAUTHORIZED':
                raise ErrorAutenticacion('el storage rechazo la firma (secreto distinto o reloj de la PC desfasado)')
            if codigo == 'INTERNAL':
                raise ErrorTransitorio('INTERNAL')
            raise ErrorPermanente(str(codigo))
        datos_ok = verificar_respuesta(cuerpo, self._secreto, nonce, int(self._reloj()))
        if datos_ok.get('status') != 'ok':
            codigo = str(datos_ok.get('code'))
            if codigo == 'INTERNAL':
                raise ErrorTransitorio('INTERNAL')
            raise ErrorPermanente(codigo)
        return datos_ok

    def put_foto_pozo(self, fotoId, fuente, carpeta_fecha, imagen_b64, thumb_b64):
        return self.llamar('putFotoPozo', {
            'fotoId': fotoId, 'fuente': fuente, 'carpetaFecha': carpeta_fecha, 'mimeType': 'image/jpeg',
            'imagenBase64': imagen_b64, 'thumbBase64': thumb_b64})

    def put_fotos_pozo_lote(self, items):
        """items: lista de dicts {fotoId, fuente, carpetaFecha, mimeType, imagenBase64, thumbBase64}. Devuelve el dict del
        storage con 'resultados' (uno por foto, en cualquier orden, cada uno con su fotoId y su propio status)."""
        return self.llamar('putFotosPozoLote', {'fotos': items})
