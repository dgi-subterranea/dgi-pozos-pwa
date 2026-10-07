# Importación histórica a FotosPozos (piloto y lote completo)

Estado: **solo está implementado el plan en seco (`--dry-run`)**. La subida real y el registro en la hoja se
implementan después de aprobar esta arquitectura y el piloto.

## Flujo de punta a punta

```
Fotos/ (local, solo lectura)
  └─ inventariar → clasificar → corpus.json                      (ya existe)
  └─ normalizar.py --seleccion piloto30|confirmadas              JPG 1600 px / q72 + miniatura 256 px, sin metadatos,
        └─ scripts/out/fotos/<lote>/normalizado|thumbs|filas…    nombrados SOLO por fotoId
  └─ importar.py --lote <lote> --dry-run                         plan: cantidad, fotoIds, entidades, peso, destinos, filas
  └─ (aprobación del plan por la persona responsable)
  └─ importar.py subir                  → storage Web App (cuenta 2)  putFotoPozo, 1 foto por POST, idempotente
  └─ importar.py exportar-filas         → CSV con driveFileId/driveThumbId
  └─ hoja FotosPozosImport (staging) → función de Apps Script `importarFotosPozosDesdeHoja()`
        └─ valida, omite fotoId ya registrados y agrega a FotosPozos          (visible en la galería)
```

Ningún paso borra ni modifica `Fotos/`. `FotosReemplazo` no se toca. Solo se importan filas `CONFIRMADO`.

## Garantías (verificadas por el dry-run y por tests)

* Solo `CONFIRMADO`; `POR_REVISAR` y `EXCLUIDA_IMPORTACION` jamás entran al plan (y una fila sin registro
  `CONFIRMADO` en el manifiesto privado es un error).
* `fotoId = uuid5(SHA-1)`: reimportar nunca duplica. Archivos de Drive y de salida nombrados solo por `fotoId`.
* Los JPEG a subir no tienen EXIF/XMP/IPTC/comentarios; las filas no tienen rutas ni nombres originales,
  `observacion` vacía y `emailUsuarioCarga=IMPORTACION`.
* Fecha: `fechaFotoValor` + `fechaFotoPrecision` + `fechaFotoFuente` tal cual el corpus (un año solo nunca es 01/01).
* Carpeta de destino: `FotosPozos/<fuente>/<año|sin_fecha>/<fotoId>.jpg` y `<fotoId>_thumb.jpg`.
* `sha1Original` y los ids de Drive quedan solo en la hoja: la API nunca los devuelve al frontend.

## Comandos

```bash
# 1) Normalizar el lote piloto (~30 fotos CONFIRMADAS; no sube nada)
python scripts/fotos/normalizar.py --seleccion piloto30 --nombre piloto30 --sin-medir
#    opcional: --incluir-wells 03-0652,04-0263   --excluir-wells 05-0001   (p. ej. pozos que ya tienen fotos de prueba)

# 2) Plan en seco (obligatorio antes de cualquier subida real)
python scripts/fotos/importar.py --lote piloto30 --dry-run
#    deja scripts/out/fotos/piloto30/plan_importacion.json (con huella) y reporte_dryrun.txt
```

Salida del dry-run: cantidad, pozos afectados, peso (imágenes + miniaturas), fotos por fuente/tipo/año, carpetas de
destino, y una fila por foto con lo que se crearía en la hoja. Código de salida `1` si hay errores.

## Cobertura del lote piloto (`--seleccion piloto30`)

Monitoreo NE y Relevamiento 2018; `CERCA`, `PANORAMICA` y `OTRA`; fecha completa (EXIF, carpeta, archivo), solo mes y
solo año; GPS histórico consistente (≤200 m) y de 200–500 m; pozo solo de Provincia y punto de la red NE (con
`wellId`); un pozo con varias fotos y otro con fotos de las dos fuentes; un PNG, una imagen muy grande y fotos con
orientación EXIF 6/8. No existe ninguna foto `CONFIRMADO` de un punto NE especial (sin `wellId`): ese caso se
valida con una carga manual desde la app.

## Pendiente (después de aprobar)

`importar.py subir` / `exportar-filas` (cliente HMAC en Python, estado reanudable en JSONL, reintentos, reporte final),
la hoja de staging `FotosPozosImport` y `importarFotosPozosDesdeHoja()` en el Apps Script principal. Si en el piloto
la subida individual resultara lenta para 4.116 fotos, se agrega una acción por lotes `putFotosPozoLote` en el storage.
