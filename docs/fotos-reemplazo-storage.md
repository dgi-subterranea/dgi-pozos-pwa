# Fotos de Reemplazos (v2): almacenamiento en una segunda cuenta de Google

Las fotos de cada evaluación de reemplazo se guardan en el Drive de una
**segunda cuenta de Google**, para no consumir la cuota de 15 GB de la
cuenta principal (`dgiperfiles@gmail.com`). Este documento explica por qué
esa es la arquitectura elegida, cómo se protege la comunicación entre las
dos cuentas y los pasos manuales para ponerla en marcha.

## 1. Diagnóstico: ¿cómo garantizar que las fotos consuman la cuota de la segunda cuenta?

En Drive, **el almacenamiento lo consume el propietario del archivo**, y el
propietario es quien lo crea.

| Opción | ¿Quién es el dueño del archivo? | ¿Consume la cuota de la segunda cuenta? |
|---|---|---|
| Carpeta de la segunda cuenta **compartida** con la principal, y el backend principal crea archivos adentro | La cuenta que ejecuta el código (la principal) | **No.** Compartir una carpeta no cambia quién consume: los archivos creados por la principal cuentan contra la principal. |
| Backend principal sube con la API de Drive usando credenciales de la segunda cuenta (OAuth) | La segunda | Sí, pero hay que guardar y renovar tokens/credenciales de una cuenta: más superficie de ataque y mantenimiento. |
| **Web App de Apps Script propio de la segunda cuenta, "Ejecutar como: yo"** | La segunda | **Sí, por construcción.** El código corre como esa cuenta; `DriveApp.createFile` crea el archivo bajo ella. |

**Conclusión: la tercera opción es la más simple y segura.** Cero credenciales
que guardar; la identidad de ejecución la fija Google al desplegar. Costos:
un proyecto más de Apps Script y la necesidad de autenticar las llamadas
entre los dos proyectos (sección 2), porque un Web App con "cualquier
persona" es accesible desde internet.

Flujo: `Frontend → backend principal → storage (segunda cuenta)`. El
navegador **nunca** habla con el storage, nunca ve su URL ni el secreto.

## 2. Seguridad servicio-a-servicio

- Cada llamada del backend principal al storage va **firmada con HMAC-SHA256**
  con un secreto compartido (`FOTOS_STORAGE_SECRET`, en Script Properties de
  ambos proyectos; nunca en el código ni en el frontend):
  `sig = HMAC(secreto, "v1\n" + acción + "\n" + ts + "\n" + nonce + "\n" + payload)`
- `ts`: el storage rechaza solicitudes con más de **±5 minutos** de diferencia.
- `nonce` (UUID por llamada): el storage lo recuerda 10 minutos y rechaza
  repetidos (**anti-replay**). El nonce se registra recién después de validar
  la firma (un atacante sin secreto no puede "gastar" nonces).
- Comparación de firmas en **tiempo constante**.
- Las **respuestas** del storage también vienen firmadas (acción `response`,
  mismo nonce): el backend principal rechaza una respuesta sin firma válida,
  vencida o de otra solicitud (storage suplantado).
- El storage valida de nuevo todo lo que recibe (JPEG real por firma binaria,
  tamaño, nombre, ids) y solo lee/archiva archivos que **cuelgan de su carpeta
  raíz**: aunque una llamada firmada pidiera otro archivo de la cuenta, se
  rechaza.
- Un POST sin firma válida no ejecuta nada y responde un error genérico sin
  detalle. Un GET devuelve solo `ok`.
- Los archivos son **privados** (nunca se comparten ni hay links públicos). La
  lectura pasa siempre por el backend principal, gateada por el permiso
  `reemplazo`, con el id de la foto (UUID); el navegador nunca recibe Drive IDs.

Límite honesto: el anti-replay usa `CacheService` (best-effort; el cache puede
desalojar entradas antes de 10 minutos). La ventana de ±5 min más la firma
acotan el riesgo; no se agregó un almacén de nonces persistente.

## 3. Datos

Hoja `FotosReemplazo` (en el Spreadsheet principal, junto a `EvaluacionesReemplazo`):

```
timestamp | fotoId | evaluacionId | wellId | email | driveFileId | nombreArchivo | mimeType | tamanoBytes
```

Append-only. No guarda base64 ni URLs. `nombreArchivo` es el generado
(`wellId_evaluacionId_fotoId.jpg`), nunca el del celular (podría traer datos
personales); la verdad es `driveFileId`.

En la segunda cuenta: `FotosReemplazo/<AAAA>/wellId_evaluacionId_fotoId.jpg`
(una carpeta por año) y, al lado, `..._thumb.jpg` (miniatura de 256 px; su id
queda en la descripción del archivo principal, por eso la hoja necesita un
solo `driveFileId`).

## 4. Límites

| Límite | Valor | Dónde se aplica |
|---|---|---|
| Fotos por evaluación | 5 | navegador y backend (re-chequeado dentro del lock) |
| Original por foto | 15 MB | navegador |
| Dimensión máxima | 1600 px (lado mayor), sin agrandar | navegador (canvas) |
| Calidad JPEG | 0.72 → 0.62 → 0.52 solo si pasa de 1,5 MB | navegador |
| Comprimida | objetivo 1,5 MB; tope duro 2 MB | navegador / backend (el storage acepta hasta 3 MB) |
| Miniatura | 256 px, tope 60 KB | navegador / backend |
| Subida | 1 foto por request, cola secuencial | navegador |
| Storage (segunda cuenta) | hasta 3 MB por foto, 80 KB por miniatura | storage |

Aprobados para v1. Quién puede subir: **cualquier usuario con `reemplazo=SI`**
puede agregar fotos a **cualquier evaluación existente** del pozo (trabajo
colaborativo de campo), sin ventana temporal. `FotosReemplazo.email` identifica
a quien subió esa foto, no a quien creó la evaluación.

Medido en el navegador de prueba: foto sintética 4032×3024 de 1,8 MB → 236 KB;
ruido puro de 9,6 MB → 480 KB; miniaturas de 7-12 KB. Una foto real de celular
(3-5 MB) debería quedar en 0,3-0,6 MB, o sea ~200-400 fotos por GB.

## 5. HEIC / iPhone

**Compatibilidad pendiente de validación en un iPhone real.** No se afirma que
Safari/iOS convierta o decodifique HEIC: depende de la versión de iOS, de la
configuración de la cámara ("Alta eficiencia" / "Más compatible") y de cómo el
navegador entrega el archivo, y no se pudo probar con un dispositivo.

- El flujo intenta decodificar lo que elija el usuario con el navegador
  (`createImageBitmap` / `<img>` + canvas). Si el navegador no puede
  decodificar la imagen (HEIC en Chrome/escritorio, por ejemplo), esa foto
  muestra un **error amigable** ("No se pudo abrir esta imagen en tu
  navegador...") y se puede quitar o elegir otra. Las demás fotos no se ven
  afectadas.
- **No se agregó** ninguna librería de conversión HEIC (pesada, ~1 MB+ de
  WASM). Esta decisión se mantiene por ahora.
- Esto **no bloquea la etapa**: se valida físicamente con un iPhone después de
  desplegar el entorno de prueba.
- La compresión re-codifica con canvas: se descartan EXIF y GPS de forma natural
  y se corrige la orientación (`imageOrientation: 'from-image'`).

## 6. Pasos manuales

### 6.1 Segunda cuenta de Google

1. Iniciá sesión en Google con la **segunda cuenta** (la que tiene espacio libre).
2. Entrá a <https://script.google.com> y creá un proyecto nuevo (por ejemplo
   `DGI Fotos Storage`).
3. Creá 4 archivos de script y pegá el contenido de la carpeta `storage/src/`
   del repositorio: `StorageConfig.js`, `StorageAuth.js`, `StorageDrive.js` y
   `StorageApi.js`.

### 6.2 Secreto compartido

Generá un valor aleatorio de **al menos 32 caracteres** (recomendado 48+), por
ejemplo en tu terminal:

```bash
node -e "console.log(require('crypto').randomBytes(36).toString('base64url'))"
```

Es **el mismo** valor en los dos proyectos. No lo pegues en chats, el repo ni
el frontend.

### 6.3 Script Properties del proyecto de storage

Configuración del proyecto → Propiedades de la secuencia de comandos:

| Propiedad | Valor |
|---|---|
| `FOTOS_STORAGE_SECRET` | el secreto del paso 6.2 |
| `FOTOS_ROOT_FOLDER_ID` | *(no a mano)* lo escribe `setupFotosStorage()` |

### 6.4 Carpeta raíz

Ejecutá una vez `setupFotosStorage()` desde el editor (autorizá los permisos
de Drive). Crea (o reutiliza) la carpeta **`FotosReemplazo`** en *Mi unidad* de
la segunda cuenta y guarda su id. Es idempotente. En el log verificá que
"Cuenta efectiva" sea la segunda cuenta.

### 6.5 Publicar el Web App de storage

1. *Implementar → Nueva implementación → Aplicación web*.
2. **Ejecutar como: Yo (la segunda cuenta).**
3. **Quién tiene acceso: Cualquier persona** (el backend principal lo llama sin
   OAuth; sin firma válida nadie puede hacer nada, ver sección 2).
4. Copiá la URL que termina en `/exec`.
5. Cada vez que cambies el código del storage: *Implementar → Administrar
   implementaciones → editar → Nueva versión* (la URL se mantiene).

### 6.6 Backend principal (cuenta principal)

1. Agregá al proyecto principal los archivos nuevos: `FotosStorageClient.js`,
   `FotosReemplazoRepository.js`, `FotosReemplazoService.js`; y actualizá los
   modificados: `Api.js`, `Config.js`, `ReemplazoRepository.js`.
2. Script Properties del proyecto principal:

   | Propiedad | Valor |
   |---|---|
   | `FOTOS_STORAGE_URL` | la URL `/exec` del paso 6.5 |
   | `FOTOS_STORAGE_SECRET` | **el mismo** secreto del paso 6.2 |

3. Ejecutá una vez `setupFotosReemplazoSheet()` (crea la hoja `FotosReemplazo`
   con el encabezado exacto; es idempotente y no pisa una hoja existente).
4. Nueva versión del Web App principal (*Implementar → Administrar
   implementaciones → Nueva versión*). No hace falta reautorizar scopes:
   `UrlFetchApp` ya se usa para Telegram.

### 6.7 Verificar que las fotos consumen la cuota de la segunda cuenta

1. En la **segunda cuenta**, ejecutá `diagnosticarCuotaStorage()` y anotá
   "Drive usado".
2. En la **cuenta principal**, anotá su uso de Drive
   (<https://drive.google.com/settings/storage>, o `Logger.log(DriveApp.getStorageUsed())`).
3. Subí 2-3 fotos desde la app a una evaluación de prueba.
4. Repetí 1 y 2: el uso de la **segunda** cuenta tiene que subir (suma el tamaño
   de las fotos + miniaturas) y el de la **principal** no cambia por las fotos.
   (Drive tarda unos minutos en reflejar el uso.)
5. En la segunda cuenta abrí `Mi unidad/FotosReemplazo/<año>/`: los archivos
   tienen que figurar con esa cuenta como **propietaria**.
6. Comprobá que no son públicos: en *Compartir*, los archivos deben estar
   restringidos (solo la propietaria).

### 6.7b Diagnóstico automático desde el editor (sin la app)

En el proyecto principal, el archivo `FotosDiagnostico.js` trae
`diagnosticarFotosReemplazo()`: sube una foto de prueba (1×1 px) por el mismo
camino que usa la app (backend → storage firmado) a una evaluación existente
(completar `FOTOS_DIAG_EVALUACION_ID` y `FOTOS_DIAG_WELL_ID` arriba del
archivo) y verifica en el log: subida, fila en `FotosReemplazo`, lectura de
miniatura e imagen completa, y que las respuestas del backend no contienen URL,
secreto, `driveFileId` ni email. Nunca imprime el secreto, la URL completa ni el
`driveFileId`.

### 6.8 Prueba de punta a punta en producción

1. En la app: abrir un pozo en Evaluación / Reemplazo → *Nueva evaluación* →
   elegir estado/motivo → *Tomar foto* y/o *Elegir de galería* (2-3 fotos) →
   *Continuar* → *Guardar evaluación*.
2. Debe aparecer "Subiendo fotos: N de M" y luego las miniaturas bajo
   "Fotos (N)" de esa evaluación en el historial.
3. Tocar una miniatura: se abre el visor, con siguiente/anterior.
4. Con un usuario **sin** `reemplazo=SI`: no debe poder ver ni subir fotos.
5. Probar con un Android y, después de desplegar el entorno de prueba, con un
   iPhone real (HEIC: compatibilidad pendiente de validación, sección 5).

## 7. Rotar el secreto

Cambiá `FOTOS_STORAGE_SECRET` en **los dos** proyectos casi a la vez. Entre un
cambio y otro, las llamadas fallan con `STORAGE_UNAVAILABLE` y se reintentan
desde la app (la evaluación ya queda guardada).

## 8. Operación

- **Storage caído o secreto desfasado:** la evaluación se guarda igual; las
  fotos fallan con "El almacenamiento de fotos no está disponible" y se
  reintentan una por una desde la pantalla.
- **Archivos huérfanos:** si una foto se subió pero no se pudo registrar en la
  hoja, el backend intenta mandarla a la papelera del storage (compensación
  interna; no existe "borrar foto" para el usuario en v1).
- **Cuota de la segunda cuenta llena:** el storage falla al crear archivos y
  la app muestra el error de almacenamiento; liberar espacio o cambiar de
  cuenta (nuevo `FOTOS_STORAGE_URL`; las fotos viejas quedan donde están, el
  `driveFileId` solo es válido en su cuenta de origen).
