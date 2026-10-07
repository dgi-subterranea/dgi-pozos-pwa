# Importación histórica a FotosPozos (piloto y lote completo)

Estado: **implementado y testeado, todavía NO ejecutado contra producción.** No se subió ninguna foto, no se creó la hoja
de staging y no se importó nada a `FotosPozos`.

## Flujo de punta a punta

```
Fotos/ (local, solo lectura)
  └─ inventariar → clasificar → corpus.json                              (ya existe)
  └─ normalizar.py --seleccion piloto30|confirmadas                      JPG 1600 px q72 + miniatura 256 px, sin metadatos,
        └─ scripts/out/fotos/<lote>/normalizado|thumbs|filas…            nombrados SOLO por fotoId
  └─ importar.py --lote <lote> --dry-run                                 plan + huella (cantidad, fotoIds, entidades, peso, destinos, filas)
  └─ importar.py subir --lote <lote> --confirmar-huella <12+ hex>        storage Web App (cuenta 2), putFotoPozo, UNA foto por POST
  └─ importar.py exportar-filas --lote <lote>                            CSV de staging (solo subidas confirmadas)
  └─ hoja FotosPozosImport (staging)  ← se importa el CSV a mano
  └─ Apps Script (editor): simularImportacionFotosPozosDesdeHoja()  →  importarFotosPozosDesdeHoja()
        └─ valida, omite lo ya registrado y agrega a FotosPozos         (visible en la galería)
```

Nada borra ni modifica `Fotos/`. `FotosReemplazo` no se toca. Solo se importan filas `CONFIRMADO`. La importación a la hoja
**no es un endpoint web**: `Api.js` no la enruta y solo se ejecuta a mano desde el editor de Apps Script.

## Garantías (verificadas por tests)

* Solo `CONFIRMADO`; `POR_REVISAR` y `EXCLUIDA_IMPORTACION` jamás entran al plan (una fila sin registro `CONFIRMADO` en el
  manifiesto privado es un error). Se cuentan como `OMITIDA` en el reporte.
* `fotoId = uuid5(SHA-1)`: reimportar nunca duplica. Archivos de Drive y de salida nombrados solo por `fotoId`.
* Los JPEG no tienen EXIF/XMP/IPTC/comentarios; las filas no tienen rutas ni nombres originales, `observacion` vacía y
  `emailUsuarioCarga=IMPORTACION`. Fecha: valor + precisión + fuente tal cual el corpus (un año solo nunca es 01/01).
* Carpeta en el Drive secundario: `FotosPozos/<fuente>/<año|sin_fecha>/<fotoId>.jpg` y `<fotoId>_thumb.jpg`.
* `sha1Original` y los ids de Drive quedan solo en la hoja: la API nunca los devuelve al frontend.

## Confirmación obligatoria antes de subir

`subir` se niega si: no existe `plan_importacion.json`; el plan tiene errores; **algún archivo o fila cambió desde el dry-run**
(la huella incluye el SHA-256 de cada JPG y miniatura); o no se pasa `--confirmar-huella` con 12 o más caracteres de la
"Huella del plan" que imprimió el dry-run. Además cada archivo se vuelve a comparar con su SHA-256 justo antes de enviarlo.

## Variables de entorno (únicas fuentes del URL y del secreto)

| Variable | Contenido |
|---|---|
| `FOTOS_STORAGE_URL` | URL de la Web App del storage (la misma de la Script Property `FOTOS_STORAGE_URL` del proyecto principal). `https` obligatorio. |
| `FOTOS_STORAGE_SECRET` | El secreto compartido (`FOTOS_STORAGE_SECRET`). Mínimo 16 caracteres. |

Nunca se aceptan por argumento ni desde archivos del repo; nunca se imprimen (ni en logs, reportes, estado o errores).
`.env` está en `.gitignore`. PowerShell, solo para esa ventana (los valores van entre comillas, aquí son placeholders):

```powershell
$env:FOTOS_STORAGE_URL = "<URL de la Web App del storage>"
$env:FOTOS_STORAGE_SECRET = "<secreto compartido>"
```

## Comandos (desde la raíz del repo)

```bash
# 1) Lote piloto (31 CONFIRMADAS; no sube nada). Opcional: sumar o quitar pozos concretos
python scripts/fotos/normalizar.py --seleccion piloto30 --nombre piloto30 --sin-medir
python scripts/fotos/normalizar.py --seleccion piloto30 --nombre piloto30 --sin-medir --incluir-wells 03-0652,04-0263 --excluir-wells 05-0001

# 2) Plan en seco (obligatorio). Imprime la "Huella del plan"
python scripts/fotos/importar.py --lote piloto30 --dry-run

# 3) Subida real (solo después de aprobar el plan). Reanudable: si se corta, volver a correr el mismo comando
python scripts/fotos/importar.py subir --lote piloto30 --confirmar-huella <12 o mas caracteres de la huella>
python scripts/fotos/importar.py subir --lote piloto30 --confirmar-huella <huella> --limite 3     # probar con 3 primero

# 4) CSV de staging con los ids de Drive (solo fotos con subida confirmada)
python scripts/fotos/importar.py exportar-filas --lote piloto30
```

`--incluir-wells` **suma** una foto CONFIRMADA por pozo pedido al lote base (no desplaza ninguna foto de la muestra);
si el pozo no tiene fotos confirmadas, el comando avisa. Cambiar el lote obliga a normalizar y a repetir el dry-run
(la huella cambia).

### Estados y reanudación

Cada foto queda en `scripts/out/fotos/<lote>/estado_subida.jsonl` (append-only):

* `SUBIDA`: el storage la creó ahora. `YA_EXISTE`: ya estaba en Drive (reintento o progreso local perdido; no se duplica).
  Con un storage anterior a este cambio no informa existencia y se reporta `SUBIDA`.
* `FALLIDA`: se reintenta sola al volver a correr el comando. Errores transitorios (red, HTTP 5xx/429, `INTERNAL`) se
  reintentan hasta 4 veces con espera 2/5/10/20 s; un rechazo del storage (`INVALID_*`) no se reintenta; un error de firma
  (secreto o reloj de la PC) **aborta** toda la corrida sin marcar fallidas.
* `OMITIDA`: entradas del manifiesto que no se suben (POR_REVISAR / EXCLUIDA).
* Lo ya `SUBIDA`/`YA_EXISTE` no se vuelve a enviar nunca. `reporte_subida.txt` resume previstas, subidas, ya existentes,
  fallidas, omitidas, pendientes y MB enviados.

## Formato del CSV de staging (`staging_FotosPozosImport.csv`)

UTF-8, separador coma, fin de línea CRLF, una fila de encabezado y **exactamente estas 27 columnas, en este orden**
(las de la hoja `FotosPozos`):

```
fotoId,timestampRegistro,wellId,monitoringId,fuente,tipoFoto,fechaFotoValor,fechaFotoPrecision,fechaFotoFuente,observacion,
estadoVinculo,vinculoMetodo,gpsLat,gpsLon,gpsOrigen,emailUsuarioCarga,loteImportacion,sha1Original,procesamiento,mimeType,
tamanoBytes,ancho,alto,tamanoOriginalBytes,driveFileId,driveThumbId,estado
```

Ejemplo (valores de relleno): `00000000-0000-5000-8000-000000000001,,15-0268,,RELEVAMIENTO_2018,OTRA,2018-08-06,DIA,EXIF,,CONFIRMADO,NOMBRE_ARCHIVO,,,,IMPORTACION,PILOTO-2026-10,<sha1 de 40 hex>,JPEG_1600_Q72,image/jpeg,400123,1600,1200,4200000,<driveFileId>,<driveThumbId>,ACTIVA`

* `timestampRegistro` va vacío (lo pone la importación). `observacion` vacía. `monitoringId` vacío (entidad por `wellId`).
* `fechaFotoValor`: `2018-08-06` (DIA), `2018-03` (MES), `2018` (ANIO) o vacío (DESCONOCIDA).
* `gpsLat/gpsLon/gpsOrigen`: vacíos, o ambas coordenadas y `EXIF_ORIGINAL`.
* Sin rutas, sin nombres originales, sin secreto. Solo filas con subida confirmada.

## Apps Script (nuevo, NO se ejecuta hasta aprobar)

| Archivo | Cambio |
|---|---|
| `backend/src/FotosPozosImport.js` | **nuevo** (proyecto principal): `setupFotosPozosImportStaging()`, `simularImportacionFotosPozosDesdeHoja()`, `importarFotosPozosDesdeHoja()` |
| `backend/src/RegistryRepository.js` | agrega `registryRepository_getWellIdsDeArchivo` (lectura masiva de ids para validar entidades) |
| `storage/src/StorageDrive.js` | `putFotoPozo` informa `existente: true/false` (recomendado; sin esto todo se reporta como SUBIDA) |

`FotosPozosRepository.js` solo agrega dos exports para Jest (sin cambio funcional en Apps Script).

Hoja `FotosPozosImport` = las 27 columnas de `FotosPozos` + `estadoImportacion` y `detalleImportacion` (todas como texto).
`importarFotosPozosDesdeHoja()` valida cada fila (esquema, enums, fecha/precisión, ids de storage, solo CONFIRMADO/ACTIVA,
entidad existente en padrón ∪ red NE, sin rastros de rutas), agrega en bloques de 500 filas bajo `LockService`, escribe el
resultado por fila (`INSERTADA` / `YA_EXISTE` / `INVALIDA` + motivo) y registra en el log los totales. **Es idempotente por
`fotoId`** (también cuenta una foto `OCULTA`: no revive), por contenido de la misma entidad y por id de Drive. No borra el
staging ni modifica nada más que esas dos columnas; no toca `FotosReemplazo`.

## Pasos manuales (después de aprobar el piloto y la prueba en iPhone)

1. **Storage:** pegar `StorageDrive.js` y publicar nueva versión de la Web App (misma URL).
2. **Principal:** pegar `RegistryRepository.js` y `FotosPozosImport.js`; ejecutar **una vez** `setupFotosPozosImportStaging()`.
   (La importación corre desde el editor: no requiere publicar la Web App; conviene publicarla después para que coincida con el repo.)
3. **PC:** definir las dos variables de entorno; correr el dry-run; revisar; correr `subir` (primero con `--limite 3` si se quiere); correr `exportar-filas`.
4. **Sheets:** en `FotosPozosImport`, seleccionar `A1` → Archivo → Importar → Subir el CSV → *Reemplazar datos a partir de la
   celda seleccionada* y **desmarcar** "Convertir texto en números, fechas y fórmulas".
5. **Editor:** ejecutar `simularImportacionFotosPozosDesdeHoja()` y leer el registro (cuántas insertarían / ya existen / inválidas);
   si está bien, ejecutar `importarFotosPozosDesdeHoja()`.
6. **Verificar en la app** (galería y contador de los pozos del piloto) y volver a ejecutar la importación para comprobar que no duplica.

## Cobertura del lote piloto (`--seleccion piloto30`)

Monitoreo NE y Relevamiento 2018; `CERCA`, `PANORAMICA` y `OTRA`; fecha completa (EXIF, carpeta, archivo), solo mes y solo
año; GPS histórico consistente (≤200 m) y de 200–500 m; pozo solo de Provincia y punto de la red NE (con `wellId`); un pozo
con varias fotos y otro con fotos de las dos fuentes; PNG, imagen muy grande y orientación EXIF 6/8. No existe ninguna foto
`CONFIRMADO` de un punto NE especial (sin `wellId`): ese caso se valida con una carga manual desde la app.

## Si la subida individual resultara lenta para las 4.116

Se mide con el piloto. Si hiciera falta, se agrega una acción por lotes `putFotosPozoLote` en el storage (misma firma HMAC,
varias fotos por request); hoy no se optimiza.
