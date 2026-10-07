# scripts/fotos — pipeline de normalizacion de fotos de pozos (FotosPozos)

Pipeline **local y de solo lectura** sobre la carpeta `Fotos/` de la raiz del repo. **No sube nada a Drive ni toca
produccion.** Las salidas van a `scripts/out/fotos/` (ignorado por git). Requiere Python 3, Pillow y numpy.

> **Privacidad.** Los nombres originales de archivo pueden traer titulares o lugares. Esos nombres/rutas solo existen
> en los manifiestos privados locales (`inventario.json`, `corpus.json`, `manifiesto_privado.json`,
> `mapeo_privado_revision.csv`, `excluidas_privado.csv`). Lo que seria subido (filas de la hoja, nombres de archivo en
> Drive) usa unicamente `fotoId` y datos clasificados.

## Pasos

```bash
python scripts/fotos/inventariar.py                         # SHA-1 + EXIF de cada imagen -> scripts/out/fotos/inventario.json
python scripts/fotos/clasificar.py                          # un registro por contenido unico -> corpus.json + resumen
python scripts/fotos/clasificar.py --reaplicar-reglas             # marca FECHA_SOSPECHOSA en el corpus ya generado (sin releer fotos)
python scripts/fotos/inventario_csv.py                      # inventario POR ARCHIVO (CSV privado) + resumen, solo lectura
python scripts/fotos/revision.py                            # CSV de revision de las POR_REVISAR (+ mapeos privados)
python scripts/fotos/normalizar.py --seleccion piloto       # piloto de 200 fotos -> scripts/out/fotos/piloto/
python scripts/fotos/normalizar.py --seleccion piloto30 --nombre piloto30 --sin-medir   # lote piloto de ~30 CONFIRMADAS
python scripts/fotos/importar.py --lote piloto30 --dry-run  # plan de importacion en seco (no sube nada)
python scripts/fotos/importar.py --lote piloto30 --dry-run --existentes scripts/out/fotos/FotosPozos.csv   # ademas verifica contra la hoja real
python scripts/fotos/importar.py subir --lote piloto30 --confirmar-huella <huella>   # sube al storage (variables FOTOS_STORAGE_URL / FOTOS_STORAGE_SECRET)
python scripts/fotos/importar.py exportar-filas --lote piloto30                      # CSV de staging para la hoja
python scripts/fotos/informe.py --nombre piloto             # estadisticas, extrapolacion y auditoria de privacidad
python scripts/fotos/calidad.py --nombre piloto             # comparacion de dimension x calidad JPEG
python -m unittest discover -s scripts/fotos -p "test_*.py" # tests (no necesitan Fotos/ ni scripts/out/)
```

`normalizar.py --seleccion confirmadas --nombre lote1` normaliza **solo las CONFIRMADO** (la primera importacion). Es el
unico modo que procesa todo el corpus; no se corrio todavia.

## Reglas (aprobadas)

* **Duplicados:** un contenido por SHA-1; las demas copias solo quedan anotadas en el manifiesto privado.
* **Estados:** `CONFIRMADO` (se importa), `POR_REVISAR` (CSV de revision; se importa en un segundo lote), `EXCLUIDA_IMPORTACION`
  (`SIN_CONTENIDO_FOTOGRAFICO`: cuadros negros/planos/marcadores; ni se importa ni se borra del origen).
* **Vinculo automatico:** un unico patron `DD NNNN` inequivoco entre las copias, validado contra **padron U red NE**
  (`fuenteValidacionId` = `PADRON` | `RED_NE` | `AMBAS`, solo en el manifiesto) y sin conflicto. INA/Mon ambiguos, sin id,
  ids en conflicto o inexistentes → `POR_REVISAR` (con sugerencia de punto NE cuando la hay; una sugerencia nunca confirma).
* **GPS (no se exige):** ≤ 200 m consistente; 200–500 m confirmado con advertencia; > 500 m `POR_REVISAR`. El GPS de una
  foto jamas modifica las coordenadas oficiales del pozo.
* **Fecha:** `EXIF valido → CARPETA → NOMBRE_ANIO → ARCHIVO plausible → DESCONOCIDA`, con precision `DIA | MES | ANIO |
  DESCONOCIDA` y `fechaFotoFuente`. Un anio solo nunca se vuelve 01/01. `ARCHIVO` solo como ultimo recurso, con anios
  plausibles para la fuente y mtimes no degenerados; usarlo **no** manda a revision.
* **Tipo:** Monitoreo `CERCA`/`PANORAMICA` cuando el nombre lo dice; el resto `OTRA`.
* **Imagen:** JPEG de 1600 px maximo, calidad 72 (62 y 52 solo si no entra en 1,5 MB), miniatura 256 px, orientacion
  EXIF corregida (JPEG y PNG), sin ningun metadato. Un JPEG que ya es chico y esta derecho no se recomprime (se le quitan
  los metadatos sin tocar los pixeles). `fotoId = uuid5(SHA-1)`: reimportar nunca duplica.

## CSV de revision

`scripts/out/fotos/revision/revision_porrevisar.csv` (separador `;`, UTF-8 con BOM, abre directo en Excel). Columnas:
`fotoId, fuente, tipoFoto, fechaFotoValor, fechaFotoPrecision, fechaFotoFuente, wellIdPropuesto, monitoringIdPropuesto,
fuenteValidacionId, motivoRevision, distanciaGpsMetros, sugerencia, decision, wellIdCorregido, monitoringIdCorregido,
observacionRevision`. Se completan a mano las ultimas cuatro (`decision`: `CONFIRMAR`, `CORREGIR` o `DESCARTAR`). Para
reconocer una foto, `mapeo_privado_revision.csv` relaciona `fotoId` con la ruta original (solo local).

## Importacion

Ver `docs/fotos-pozos-importacion.md` (flujo, garantias, lote piloto y plan en seco).
