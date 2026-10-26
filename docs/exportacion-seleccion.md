# Exportación de «Mi selección» a XLSX (E7)

Estado: **E7 CERRADA / PRODUCCIÓN (26/10/2026).** Exportación de «Mi selección» a Excel, frontend-only (backend sigue en Apps Script v45, sin permiso nuevo, sin pantalla nueva, sin auditoría nueva). Etapas: E7-1 auditoría y diseño; E7-2 lógica pura (`958606a`); E7-3 interfaz y descarga (`010fa6d`); E7-4 rollout + smoke real (esta sección, al final).

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

## Cableado en «Mi selección» (E7-3)

No hay pantalla, modal ni selector de formato: un botón en la pantalla existente de la tabla (`#btn-seleccion-exportar`, debajo de la búsqueda y el orden) y dos mensajes (`role="status"` y `role="alert"`). Controlador: `js/exportacionSeleccion.js`; `js/seleccion.js` solo entrega la foto, la disponibilidad ITF de pozos concretos y el contador.

### Botón y contador

- Texto **«Exportar Excel (N)»**, con N = filas que la tabla dibuja **ahora** (después de búsqueda + filtro de aptitud + orden). No es la cantidad de la selección. Se actualiza al instante al buscar / filtrar / ordenar o cambiar la selección y **no hace ningún pedido**.
- N = 0 → deshabilitado. Durante la preparación → «Preparando Excel…», deshabilitado y `aria-busy="true"`; al terminar vuelve a «Exportar Excel (N)». Una sola exportación a la vez (el segundo clic se ignora).

### Foto (snapshot)

Al hacer clic se captura, sin red: los `wellId` visibles y ordenados (misma función que dibuja la tabla), búsqueda, filtro de aptitud, orden, permisos y datasets. Lo que el usuario cambie mientras se prepara (búsqueda, filtro, orden, selección) **no** entra en el archivo ya iniciado; la exportación siguiente usa el estado nuevo. La fecha se toma en el clic.

### Flujo

1. Foto. 2. Con `perfil === true`: disponibilidad de ITF **solo de los pozos de la foto**, reutilizando lo que la tabla ya sabe y pidiendo únicamente lo que falta, en lotes de ≤ 500 con 3 en vuelo; sin `perfil`, no se consulta nada ni existe la columna. 3. `mapaShared_cargarJSZip()` (carga diferida: nunca al entrar a «Mi selección»). 4. `exportacionSeleccion_construirLibro` + `xlsxLogic_generar`. 5. Blob con el MIME de XLSX y descarga con un enlace `download`; la URL se revoca a los 60 s (no al instante). Sin fetch por pozo.

### Mensajes

| Caso | Mensaje |
|---|---|
| Éxito | «Excel descargado.» (se borra solo) |
| ITF parcial o caído (con `perfil`) | «El archivo se exportó, pero no se pudo determinar la disponibilidad de ITF para algunos pozos.» El archivo se genera igual; los pozos sin respuesta quedan con «Tiene ITF» vacío, nunca «No». |
| JSZip, Blob o generación fallan | «No se pudo preparar el archivo Excel. Intentá nuevamente.» No se descarga nada y el botón se rehabilita. |
| `UNAUTHORIZED` / `USER_DISABLED` | Logout global existente; no se genera archivo ni se muestra un error de Excel. |

Sin códigos del backend, cantidades de lotes ni detalles técnicos. Un logout descarta cualquier exportación en preparación.

### ITF y auditoría

Cada lote de `getItfAvailability` usa el comportamiento actual del backend (una fila de Historial, sin Telegram): una selección muy grande puede producir varias lecturas auditadas de disponibilidad ITF (13 804 pozos → 28). **No** hay `registrarExportacion`: la auditoría específica de exportaciones será requisito antes de exportar datos personales o reportes masivos sensibles (E7 v1 no los incluye).

### Safari / iPhone

Blob + enlace `download`, sin File System Access API ni nada exclusivo de Chromium; la URL del objeto sigue viva 60 s para que Safari / iOS alcance a iniciar la descarga. Pendiente de smoke real en E7-4 si hay dispositivo.

### Service worker

`xlsxLogic.js`, `exportacionSeleccionLogic.js` y `exportacionSeleccion.js` están en el shell (mismo orden que `index.html`). No se cachea ningún XLSX ni URL de objeto; la API sigue sin cachearse.

## Cierre de E7 (E7-4): rollout y smoke real

Frontend publicado en GitHub Pages con E7-2 + E7-3 (`010fa6d`); los archivos publicados son idénticos al commit y el service worker lista los tres scripts nuevos. Sin `gas:*` ni cambios de backend.

**Smoke en producción** (sesión real, solo lecturas; cuenta con `ubicacion`, `perfil`, `ne`, `reemplazo` y `datos`):

- Tabla con 12 pozos: «Exportar Excel (12)» = filas dibujadas. Buscar (14-001 → 5), sin resultados (0, deshabilitado), filtro de aptitud y orden: N cambia solo con búsqueda y filtro, nunca con el orden, y ningún cambio hace pedidos.
- Exportación sin filtro: «Preparando Excel…» con el botón deshabilitado, una sola descarga (`dgi-pozos-seleccion-2026-10-26.xlsx`, MIME de XLSX), botón de vuelta en «Exportar Excel (12)» y «Excel descargado.». La URL se revocó a los 60 s. Cero pedidos de red (la tabla ya conocía el ITF).
- Exportación filtrada (búsqueda + orden por profundidad): 5 de 12 filas, mismo orden que la tabla; Información con cantidad 5, «Pozos en la selección (sin filtrar)» 12, búsqueda y orden.
- Columnas: las 11 esperadas con esa cuenta; sin titular, NC16, email ni datos personales (aunque la tabla muestra el titular en pantalla, el archivo no).
- ITF por lotes: selección de 700 pozos → 2 pedidos (200 + 500), ambos `ok`, sin `INVALID_REQUEST`; el archivo trae 462 «Sí» y 238 «No», coincidentes con la respuesta del backend. La pantalla de ITF de la selección (que antes fallaba con más de 500 pozos) muestra «462 ITF disponibles de 700». No se descargó el ZIP (genera auditoría con Telegram).
- Excel real (es-AR): el archivo del smoke abre sin advertencia; hojas `Pozos` e `Información`; primera fila congelada y autofiltro; acentos; `Pozo` como texto; profundidad numérica; latitud / longitud numéricas con formato `0,000000`; celdas vacías donde no hay dato; 0 celdas con fórmula en todo el libro.
- Responsive en producción: 375 px sin desbordes (botón de 44 px alineado con búsqueda y orden, mensaje largo envuelve); 1280 px sin romper la tabla.
- Regresión (solo lectura): búsqueda de pozo, Línea de tiempo (14-0006), «Ver en mapa» con la selección y pantalla de ITF; el filtro y el orden de la tabla (ahora compartidos con la exportación) se comportan igual. Sin errores de consola.
- Rendimiento real: 12 pozos ≈ 0,4 s (incluye la primera carga de JSZip); 700 pozos ≈ 0,13 s con el ITF ya conocido. Si el ITF no se conoce, una selección de 700 pozos tarda ≈ 5,5 s en los dos lotes (latencia del backend; es el costo de la tabla al abrirse).

**Pruebas por código (no por producción):** fallo parcial o total de ITF (celda vacía, archivo igual, aviso, nunca «No»), JSZip / Blob que fallan, doble clic, snapshot estable, `UNAUTHORIZED` / `USER_DISABLED` → logout sin archivo. El código publicado es idéntico al probado; no se provocaron caídas en producción.

**Safari / iPhone: NO probado** (sin dispositivo en esta sesión). El diseño evita todo lo exclusivo de Chromium (Blob + enlace `download`, URL viva 60 s). Chrome / Edge + Excel real pasan; se recomienda una exportación chica en un iPhone cuando haya uno a mano.

### Decisiones registradas

- **XLSX sobre CSV** (decisión cerrada): el CSV se rompe con la configuración regional (coma decimal, `;`, BOM) y con textos que parecen fórmula; el XLSX con celdas de texto literal y números tipados no.
- Frontend-only, sin datos personales, sin permiso nuevo, sin `registrarExportacion`.
- Columnas v1 y permiso por columna: ver «Columnas». ITF por lotes de 500 con concurrencia 3; un lote caído deja la celda vacía.
- Validado con openpyxl (`scripts/test_xlsx_exportacion.py`) y con Excel real.

### Deuda / no bloqueante

- Comportamiento previo de la tabla con `perfil` «truthy» no booleano (consulta ITF); la exportación exige `perfil === true`. Se deja como está.
- `seleccionController_asegurarDisponibilidadItf()` (E7-2) quedó como helper legacy, hoy usado solo por tests.
- Antes de exportar datos personales (titular, NC16, etc.) o reportes masivos sensibles hará falta una **auditoría específica** de exportaciones (backend + Historial / Telegram).
- Reportes batch de Reemplazo / Observaciones (evaluaciones, observaciones por lote) requerirán endpoints de backend nuevos.
- Smoke en iPhone / Safari pendiente de dispositivo.
