# Exportación de «Mi selección» a XLSX (E7)

Estado: **E7-2 — lógica pura lista, SIN cablear** (sin botón, sin pantalla, sin descarga, sin permiso nuevo, sin backend). La interfaz y la descarga son E7-3.

Alcance de E7 v1: exportar a **XLSX** los pozos que el usuario ve en la tabla de «Mi selección», solo con datos operativos y técnicos. Decisiones cerradas: (1) las coordenadas salen solo con `ubicacion === true`; (2) XLSX sí, CSV fuera de v1; (3) `titular` y `nc16` fuera de v1; (4) la hoja «Información» describe los filtros aplicados.

## Archivos

| Archivo | Rol |
|---|---|
| `js/xlsxLogic.js` | Escritor XLSX puro (solo JSZip, inyectado). Texto literal, números tipados, sanitización XML. |
| `js/exportacionSeleccionLogic.js` | Modelo de la exportación: columnas por permiso, filas, hoja «Información», nombre de archivo. |
| `js/seleccionLogic.js` | Se agregó `seleccionLogic_filtrarYOrdenarFilas` (filtro + orden de la tabla, compartido con la exportación), `seleccionLogic_dividirEnLotes` / `seleccionLogic_combinarDisponibilidadItf` (ITF por lotes) y `SELECCION_ETIQUETAS_TIPO_POZO`. |
| `js/seleccion.js` | La tabla usa la función compartida; la disponibilidad ITF se pide por lotes (≤ 500) con a lo sumo 3 en vuelo; `seleccionController_asegurarDisponibilidadItf()` la entrega con los pozos desconocidos. |
| `scripts/generar_xlsx_exportacion.js`, `scripts/test_xlsx_exportacion.py` | Verificación externa con openpyxl (el XLSX lo genera el código real del frontend). |

Tests: `js/xlsxLogic.test.js`, `js/exportacionSeleccionLogic.test.js`, `js/seleccionLoteItfLogic.test.js`, `js/seleccionItfLotes.test.js`, `js/seleccionTablaFiltros.test.js`, `js/exportacionSeleccionWiring.test.js`.

## Lo que se exporta = lo que se ve

La exportación recibe los `wellId` **ya filtrados y ordenados por la tabla** y no reordena nada. La tabla y la exportación comparten `seleccionLogic_filtrarYOrdenarFilas` (búsqueda por pozo / titular / departamento / cuenca, filtro de aptitud con AND y orden por pozo / departamento / cuenca / profundidad). Si la tabla está filtrada, el archivo trae solo esos pozos, no toda la selección. Un test fija el orden de la tabla real (DOM falso) para cada orden y filtro.

La búsqueda también mira el titular (como la tabla), pero el titular **nunca** se exporta.

## Columnas

Hoja «Pozos». Siempre: `Pozo`, `Departamento`, `Cuenca`, `Profundidad (m)`, `Tipo de pozo`. Condicionales (solo con el permiso en **exactamente** `true`):

| Permiso | Columnas |
|---|---|
| `ubicacion` | `Estado de ubicación`, `Latitud`, `Longitud` |
| `perfil` | `Tiene ITF` |
| `ne` | `Tiene NE` |
| `reemplazo` | `Aptitud para reemplazo` |

Sin permiso la columna **no existe** (ni vacía, ni «—», ni «sin permiso»). Un permiso «truthy» que no es el booleano `true` (`"SI"`, `1`, objetos) no habilita nada (fail-closed).

### Permisos: cómo se usan

No hay permiso nuevo («exportar»). Quien llega a «Mi selección» ya pasó por los permisos de cada dato; la exportación solo decide qué columnas existen con el mismo criterio.

## Valores

- `Pozo`: texto. `Departamento`, `Cuenca`, `Tipo de pozo`: texto (`Profundo` / `Semisurgente` / `Surgente`).
- `Profundidad (m)`, `Latitud`, `Longitud`: **números reales** de Excel (nunca texto, nunca con coma local). Latitud y longitud con formato `0.000000`. Dato ausente o no numérico → celda vacía (no 0).
- `Estado de ubicación`: etiqueta humana (`Disponible`, `Coincidente`, `Aceptada`, `Validada en campo`, `Sin ubicación operativa`), nunca la letra cruda.
- `Tiene ITF`, `Tiene NE`: `Sí` / `No`. `Aptitud para reemplazo`: `Apto` / `Dudoso` / `No apto` / `Sin evaluar`.
- **Celda vacía = no se sabe**: dataset no cargado, lote ITF que falló, pozo sin dato. Solo se escribe «No» / «Sin evaluar» cuando el origen lo afirma.

## Hoja «Información»

Pares Dato / Valor, solo con lo realmente activo: `Generado (Mendoza)` y `Generado (UTC)` (texto estable, reloj inyectable, no celdas de fecha), `Cantidad de pozos`, `Pozos en la selección (sin filtrar)` (solo si hay búsqueda o filtro), `Período del padrón` (si hay), `Origen` = «Mi selección», `Búsqueda aplicada` (solo si hay texto; recortada a 200 caracteres), `Filtro de aptitud` (solo con chips activos y permiso `reemplazo`), `Orden actual`, `Columnas incluidas` (nombres humanos). Sin usuario, email, token ni ids.

## Nombre de archivo

`dgi-pozos-seleccion-AAAA-MM-DD.xlsx`, con la fecha de Mendoza. Sin cantidades, wellId, usuario ni filtros.

## Escritor XLSX

Solo JSZip (el vendor): `[Content_Types].xml`, `_rels/.rels`, `xl/workbook.xml`, `xl/_rels/workbook.xml.rels`, `xl/styles.xml`, `xl/worksheets/sheetN.xml`.

- **Anti-inyección**: todo texto es `inlineStr`; **jamás** se escribe `<f>`. Un texto que empieza con `=`, `+`, `-`, `@` o tabulación queda como texto literal (igual que `1/2`, `00123`, `TRUE`).
- **Números**: celdas numéricas `<v>`; NaN / Infinity / otros tipos → celda vacía.
- **XML**: se eliminan U+0000–0008, 000B, 000C, 000E–001F, FFFE, FFFF y sustitutos sueltos; CR/CRLF → LF; se conservan tabulación, salto de línea, acentos y emoji; se escapan `& < > "`.
- **Límite de Excel**: 32 767 caracteres por celda (se corta sin partir un par sustituto). Nombre de hoja ≤ 31, sin `[ ] : * ? / \`.
- Encabezado en negrita, primera fila congelada, autofiltro, anchos de columna. 0 filas → libro válido (encabezado + Información).

## ITF de más de 500 pozos

El backend rechaza más de 500 `wellId` por llamada de `getItfAvailability`. La selección se parte en lotes de ≤ 500 (13 804 pozos → 28 llamadas), con a lo sumo 3 en vuelo. Cada pozo termina en uno de tres estados: **Sí / No** (el backend respondió ese pozo con un booleano) o **desconocido** (lote fallido o respuesta sin booleano para ese pozo): la exportación deja la celda vacía y **nunca** lo convierte en «No». Un fallo parcial no marca la disponibilidad como lista: el próximo pedido reintenta. La sesión vencida se avisa una sola vez. Cada lote genera su fila de Historial en el backend (sin Telegram), igual que antes con un solo pedido.

## Privacidad

La fila se arma campo por campo desde una lista cerrada de columnas. No existen `titular`, `nc16`, domicilios, nombres de agentes, emails, observaciones libres, ids internos, secuencias ni ids de Drive: un test inyecta esos campos en los datasets y verifica que no aparecen en el modelo ni en ninguna parte del XLSX. Dato personal que sí puede aparecer: el texto de «Búsqueda aplicada» (lo escribió el propio usuario; podría ser un nombre). Se documenta y se limita a 200 caracteres.

## Excel real (es-AR)

Verificado con Excel de escritorio (decimal `,`): los textos `=1+1`, `+1+1`, `@SUM(1,2)`, `=HYPERLINK(...)`, `1/2`, `1-2`, `00123`, `1e5`, `31/12`, `TRUE`, `#N/A` quedan como texto (`HasFormula = False`, 0 fórmulas en el libro); acentos, ñ y emoji intactos; saltos de línea conservados; latitud/longitud negativas como números con 6 decimales; fechas de «Información» como texto; autofiltro activo. Limitación conocida de Excel: si el usuario edita una celda de texto que empieza con `=` y confirma con Enter, Excel la reinterpreta como fórmula. Es comportamiento del programa, no del archivo.

## Escala medida (Node, 13 804 pozos con todas las columnas)

Modelo + XLSX en ~0,5 s, ~0,8 MB. Sin límites artificiales todavía.

## Pendiente para E7-3

Botón y pantalla, carga de JSZip con `mapaShared_cargarJSZip()`, descarga con `descargarBlob`, reunir los datasets de la tabla (índice operativo, NE, resumen de reemplazo, ITF) para llamar a `exportacionSeleccion_construirLibro`, mensajes de error y de «sin pozos», y decidir si se audita la descarga.
