# FotosPozos v1 — galería general de fotos de pozos y puntos NE

Fotos generales (históricas y de campo) de un pozo de Provincia o de un punto NE,
**separadas** de las fotos de evaluaciones de reemplazo (`FotosReemplazo`, sin cambios).
Esta etapa deja la infraestructura, la galería y la carga desde campo.
**No importa** las fotos históricas (el pipeline `scripts/fotos/` queda aparte).

## Arquitectura

```
Navegador ──(sessionToken)──▶ Backend principal (Apps Script) ──(HMAC)──▶ Storage Web App (2ª cuenta)
  js/fotosPozos.js              Api.js → FotosPozosService.js              StorageApi.js → StorageDrive.js
  js/fotosPozosResumen.js       FotosPozosRepository.js (hojas)             Drive privado: FotosPozos/
  js/fotosImagen.js             FotosStorageClient.js
```

- Las imágenes son privadas; el navegador solo las ve **por proxy del backend**
  (`getFotoPozo` devuelve base64). Nunca recibe `driveFileId`, `driveThumbId`, URLs de
  Drive/storage, e-mails de quien cargó, `sha1Original` ni coordenadas de la foto (solo `tieneGps`).
- Misma 2ª cuenta, misma Web App de storage y mismo HMAC que `FotosReemplazo`
  (`FOTOS_STORAGE_URL` / `FOTOS_STORAGE_SECRET`, ya existentes).
- Carpetas lógicas separadas: `FotosPozos/<fuente>/<año|sin_fecha>/<fotoId>.jpg` y `<fotoId>_thumb.jpg`.
  Cada familia de acciones del storage valida contra **su propia raíz** (aislamiento: una
  acción de Reemplazo no alcanza archivos de FotosPozos y viceversa).
- Entidad: clave `wellId` (Provincia, o NE con número de pozo → misma galería) o
  `monitoringId` (punto NE especial sin `wellId`).

## Permisos (hoja `Usuarios`, columnas nuevas)

| Columna | Efecto |
|---|---|
| `fotos` | ver galería, contador y resumen (`getFotosPozo`, `getFotoPozo`, `getResumenFotosPozos`) |
| `fotos_carga` | cargar (`subirFotoPozo`) |

Independientes entre sí y de `reemplazo`/`ne`. Fail-closed (columna ausente = NO).
`fotos_carga=SI` **no** da acceso a la galería ni al contador: el usuario ve solo "Agregar foto",
sin pedir resúmenes ni revelar si el pozo tiene fotos.

## Endpoints (backend principal)

| Acción | Gate | Resumen |
|---|---|---|
| `getFotosPozo` | `fotos` | metadata segura de fotos ACTIVAS y CONFIRMADAS; orden `recientes` (default) / `antiguas` |
| `getFotoPozo` | `fotos` | miniatura o imagen completa por proxy |
| `getResumenFotosPozos` | `fotos` | `{ "01-0012": 4 }`, solo ids con ≥1 foto visible; cache corto + invalidación al subir |
| `subirFotoPozo` | `fotos_carga` | una foto por request; valida entidad, fecha, enums, observación ≤140, JPEG real, tamaño, dimensiones; idempotente por `sha1Original`; compensa (papelera) si falla la hoja |

Fuentes al cargar desde la app: `CAMPO_APP` siempre y `MONITOREO_NE` solo sobre un punto de la red NE (el backend
lo verifica). `RELEVAMIENTO_2018` está reservada a la importación histórica y la app no puede declararla.

Auditoría: lecturas sin Historial ni Telegram; subida OK → `Historial` (acción, entidad, `OK`, sin base64
ni ids de Drive); denegaciones/errores también quedan registrados.

## Storage (cuenta 2)

Acciones nuevas: `putFotoPozo`, `getFotoPozo`, `trashFotoPozo` (firma HMAC v1, ±5 min, nonce anti-replay,
respuesta firmada). Nombres de archivo = `fotoId` (nunca nombres originales ni datos personales).

## Hojas

`FotosPozos` (27 columnas) y `FotosPozosCambios` (6): se crean con `setupFotosPozos()` (idempotente, nunca
sobrescribe). Esquemas en `backend/src/FotosPozosRepository.js` (`FOTOS_POZOS_COLUMNAS`,
`FOTOS_POZOS_CAMBIOS_COLUMNAS`).

## Carga desde el celular

- Cámara (`capture="environment"`) o galería (varias), hasta 10 por vez, previsualización y "×" para quitar.
- Formato detectado por **contenido** (JPEG/PNG/WebP). HEIC se detecta y se informa con un mensaje claro
  (sin librerías pesadas; validación real en iPhone pendiente).
- Compresión en el navegador: máx. 1600 px, JPEG q72 (baja a q62/q52 solo si pasa de 1,5 MB), miniatura 256 px q60,
  orientación respetada, EXIF/GPS descartados (re-codificación por canvas).
- Subida **secuencial, una foto por request**; una que falla no frena a las demás y se reintenta a mano.
- Fecha: EXIF si es confiable; si no, fecha de hoy editable (`fechaFotoFuente=USUARIO`) o "No sé la fecha"
  (`DESCONOCIDA`, carpeta `sin_fecha`). Nunca se inventa 01/01.
- GPS opcional (casilla sin marcar): solo se pide si el usuario acepta; si falla, la foto se sube igual.
  La ubicación es evidencia de campo y **no modifica** la coordenada oficial.

## Dónde se ve

- Hub: tarjeta "Fotos" (contador solo con `fotos=SI`).
- Popups del mapa Pozos Provincia y del mapa NE (mismo helper, `js/fotosPopup.js`): botón "Fotos" con `fotos=SI` o `fotos_carga=SI`; "Fotos (N)" solo con `fotos=SI`. Provincia siempre por `wellId`; un punto NE con número de pozo abre la misma galería, y uno especial usa `monitoringId`.
- Ficha NE: botón "Fotos (N)".
- Buscar reemplazo y Pozos cerca mío: chip `📷 N` solo con `fotos=SI` y si el pozo tiene fotos.
- Sin `fotos=SI` no se hace ninguna llamada de resumen ni se dibuja contador.

## Pasos manuales de despliegue (no automatizados)

1. Proyecto Apps Script **principal**: actualizar `Api.js`, `AuthService.js`, `SheetUserRepository.js`,
   `FotosStorageClient.js`, `FotosReemplazoService.js`, y agregar `FotosPozosRepository.js` y
   `FotosPozosService.js`. Nueva versión de la Web App.
2. Proyecto **storage** (cuenta 2): actualizar `StorageConfig.js`, `StorageDrive.js`, `StorageApi.js`; nueva
   versión de la Web App (misma URL de implementación).
3. Storage: ejecutar `setupFotosPozosStorage()` una vez (crea la carpeta `FotosPozos` y la propiedad
   `FOTOS_POZOS_ROOT_FOLDER_ID`).
4. Principal: ejecutar `setupFotosPozos()` una vez (crea las hojas `FotosPozos` y `FotosPozosCambios`).
5. Hoja `Usuarios`: agregar las columnas `fotos` y `fotos_carga` y poner `SI` a quien corresponda.
6. Frontend: publicar (`index.html`, `css/styles.css`, `js/*`).

No hay Script Properties nuevas en el proyecto principal (reutiliza `FOTOS_STORAGE_URL` y
`FOTOS_STORAGE_SECRET`). El storage suma `FOTOS_POZOS_ROOT_FOLDER_ID`, que crea el setup.
