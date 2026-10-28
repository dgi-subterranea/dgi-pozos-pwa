# Moderación de fotos de pozos (E8)

Estado: **E8 PRODUCTIVO (rollout E8-6 cerrado el 28/10/2026).** Backend en producción (Apps Script **v46**), frontend publicado en GitHub Pages, hoja `FotosPozoEventos` creada y permiso `fotos_moderar` habilitado inicialmente **solo** para la persona que hizo el smoke. Ver «Rollout productivo (E8-6)».

Alcance de E8 v1 (cerrado en E8-1): **moderación productiva + cola + base para la curaduría histórica.** La subida sigue **directa** (sin aprobación previa).

## Rollout productivo (E8-6)

**Estado: E8 productivo desde el 28/10/2026.** Las secciones de más abajo (E8-3, E8-4, E8-5) describen el diseño; las frases del tipo «local, sin desplegar» o «no productivo todavía» son históricas de esas etapas y quedan superadas por esta sección.

| Concepto | Resultado |
|---|---|
| Commits | backend `c254b7b`, interfaz `69683d2`, cola `7d98b26`, reconciliación de la importación `b70e450` (todos en `origin/main`) |
| Apps Script | **producción v46**, en el **mismo deployment numerado productivo** (se actualizó con `update-deployment`; no se creó ninguno) y la **misma URL `/exec`**. `@HEAD` (pruebas) y el storage no se tocaron. Versión anterior: v45 |
| Frontend | GitHub Pages servía el service worker y los scripts nuevos (`fotosModeracionColaLogic.js`, `fotosModeracionCola.js`) tras el push |
| Hoja `FotosPozoEventos` | creada con `setupFotosPozoEventosSheet()` (resultado: `Hoja FotosPozoEventos creada.`), esquema de 14 columnas fijado por el código del setup y por los tests |
| Permiso | columna `fotos_moderar` agregada a `Usuarios`; `SI` **solo** en la fila de la persona que hizo el smoke (que ya tenía `fotos`). No se modificó ningún otro usuario ni permiso. Ampliarlo a otras personas es una decisión pendiente |
| Respaldo previo | copia verificada de `scripts/out/fotos` (8.672 archivos, ~1,5 GB, hashes de los archivos clave coincidentes) fuera del repo; el original no se movió |
| Reconciliación previa | `FotosPozos` actual: 4.119 filas = **4.116 / 4.116 `CONFIRMADO` presentes**, 0 faltantes, 0 duplicados (`fotoId`, contenido, id de Drive), 0 diferencias contra el staging, 3 filas `CAMPO_APP` (cargas desde la app), todas `ACTIVA` y `CONFIRMADO` (detalle en `docs/fotos-pozos-importacion.md`) |

### Orden seguido
1. Tests (Jest completo, Python, `git diff --check`), commit de E8-5, respaldo y reconciliación **antes** de cualquier escritura en Google.
2. `gas:push` a HEAD (no cambia producción: el deployment numerado seguía en v45) para que existiera `setupFotosPozoEventosSheet()`.
3. La persona operadora ejecutó el setup y agregó la columna `fotos_moderar` con su sesión de Google (las únicas acciones que la requerían).
4. `gas:version` → **v46** (Apps Script informó el número real; la lista de versiones lo mostró con un pequeño retraso) → `gas:deploy` al deployment productivo existente (también con confirmación diferida). La URL productiva no cambió; un token inválido contra las rutas nuevas responde `UNAUTHORIZED` (en v45 serían «acción desconocida»).
5. `push` a `origin/main` y verificación de Pages (service worker con los archivos nuevos, HTTP 200 en los scripts, tarjeta en `index.html`).
6. Smoke interactivo en producción con sesión nueva (`fotos` + `fotos_moderar`).

### Smoke en producción (foto de prueba)
Foto usada: la de **prueba** del pozo **13-0638** (panorámica del 07/10/2026, observación «Prueba», `fotoId` que empieza con `57a70c0b`), cargada desde la app (`CAMPO_APP`) con esa observación; no es una foto de la importación histórica. Resultado informado por quien lo ejecutó, paso a paso:

1. **Sesión nueva:** la tarjeta «Fotos pendientes» aparece; Pendientes y Retiradas vacías al inicio.
2. **Galería del pozo 13-0638** abre con normalidad y se identifica la foto de prueba.
3. **Sugerir retiro** (motivo `Otro`): funciona; la foto sigue visible, queda «Retiro sugerido» y **persiste al recargar**; la solicitud aparece en «Fotos pendientes»; Abrir foto y Ver historial funcionan.
4. **Rechazar:** funciona; la foto sigue visible.
5. **Retirar foto** (motivo `Otro`): funciona; la foto desaparece de la galería normal y aparece en Retiradas; Abrir foto y Ver historial funcionan desde Retiradas.
6. **Reponer:** funciona; la foto vuelve a la galería.
7. **Estado final:** foto de prueba **visible y activa**, sin solicitud abierta, fuera de Retiradas. El archivo **no se borró** (el retiro es lógico; no se llamó a `trashFotoPozo`; el storage no se tocó).

Los eventos del smoke **quedan en `FotosPozoEventos` como auditoría** (no se borran): una solicitud, su rechazo, un retiro directo y una reposición. No se hizo un retiro por `PRIVACIDAD` (cubierto por tests).

Tiempos: **no se midieron en milisegundos**; el smoke interactivo no reportó latencias anómalas.

### Verificaciones que quedan pendientes (menores)
- **Contraste de las hojas por CSV:** no se exportaron `FotosPozoEventos` ni `Historial` al cierre, así que no se verificó fila por fila (eventoId únicos, secuencia, actor, timestamps, `clientRequestId`, sin duplicados) más allá de lo que el circuito productivo demostró funcionalmente. Se puede hacer en cualquier momento exportándolas.
- **Idempotencia en producción** (mismo `clientRequestId` sin duplicar) y **un usuario con `fotos` sin `fotos_moderar`** (no ve la tarjeta ni las acciones): no se probaron en vivo; el contrato está fijado por tests y no se modificó otro usuario solo para esto.

### Limitaciones y deudas de E8 v1
- **Curaduría de las 1.073 `POR_REVISAR`:** fuera de E8 v1 (E8.x posterior); no se subieron.
- **No hay borrado físico:** retirar (incluso por `PRIVACIDAD`) es solo lógico; `PRIVACIDAD` enciende la señal «Pendiente de revisión de borrado» y no existe todavía un flujo de borrado.
- **No hay foto principal** ni **moderación previa de nuevas subidas** (la subida sigue directa).
- **`fotos_moderar` solo para la persona del smoke:** ampliarlo a otros usuarios queda para cuando se decida.
- La cola no tiene filtros ni buscador, ni «Ver pozo» desde la tarjeta; sin badge en el hub.

## Archivos

| Archivo | Rol |
|---|---|
| `backend/src/FotosPozoEventosRepository.js` | Hoja futura `FotosPozoEventos`: esquema, lectura completa / por foto / solicitudes sin resolver, búsqueda por `(usuario, clientRequestId)`, secuencia global y escritura. **No decide estados.** |
| `backend/src/FotosPozosModeracionService.js` | Dominio puro: catálogo de motivos, permisos, derivación del estado, visibilidad central, validación de comandos, idempotencia y transiciones (`fotosPozosModeracion_planificar`). Sin Sheets, locks ni cache. |
| `backend/src/FotosPozosModeracionOperaciones.js` | (E8-3) Une el dominio con la hoja de eventos y FotosPozos: escritura bajo lock con revalidación, invalidación de cache, vista de historial, cola de pendientes e imagen para moderador. Sin HTTP ni permisos de Usuarios. |
| `backend/src/Api.js` | (E8-3) 7 acciones nuevas: gates de permiso, lista blanca de campos, identidad solo de la sesión, auditoría en Historial. |
| `backend/src/FotosPozosService.js`, `FotosPozosRepository.js` | (E8-3) La galería, la imagen normal y el resumen pasan por la visibilidad derivada. Subir una foto **no cambió**. |
| `backend/src/SheetUserRepository.js`, `AuthService.js` | (E8-3) Permiso `fotos_moderar` (columna ausente → `false`). |
| `backend/test/FotosPozosModeracionService.test.js`, `FotosPozoEventosRepository.test.js`, `FotosPozosModeracionContrato.test.js` | Dominio, repositorio y contratos contra el esquema actual de FotosPozos. |
| `backend/test/FotosPozosModeracionOperaciones.test.js`, `ApiFotosPozosModeracion.test.js`, `FotosPozosModeracionE2E.test.js` | (E8-3) Operaciones con hojas en memoria, capa Api y recorrido completo Api → dominio real → repositorios reales. |

## Baseline legacy (crítico)

`FotosPozos.estado` ya existe (`ACTIVA` | `OCULTA`) y **sigue mandando**. La capa de eventos se aplica ENCIMA:

| Baseline | Eventos | Estado derivado |
|---|---|---|
| ACTIVA | ninguno | ACTIVA |
| OCULTA | ninguno | **RETIRADA** (origen `LEGACY_OCULTA`), no visible |
| ACTIVA | solicitud abierta | ACTIVA (una solicitud NO oculta) |
| ACTIVA | solicitud aprobada / `RETIRADA` | RETIRADA |
| ACTIVA | solicitud rechazada | ACTIVA |
| OCULTA | cualquiera | RETIRADA legacy: **ningún evento la revive** |
| otro valor (`''`, `activa`, `PENDIENTE`…) | — | **NO DERIVABLE** (no se interpreta) |

`REPUESTA` solo repone lo retirado por eventos. Una foto OCULTA a mano no se repone automáticamente: no se conoce el motivo histórico. Eso requeriría una futura decisión administrativa explícita (y su propia migración).

## Modelo append-only

Una hoja `FotosPozoEventos` (**no existe aún**; `setupFotosPozoEventosSheet` está escrita pero NO se ejecuta hasta el rollout E8-6). Una fila = un evento inmutable; sin columna de estado (se deriva); formato de texto plano `@` (un `=` nunca se evalúa) y `secuencia` con formato `0`.

`eventoId | secuencia | evento | fotoId | entidadTipo | entidadId | solicitudId | resolucion | motivoCodigo | motivoTexto | email | nombre | timestampUtc | clientRequestId`

- **Entidad:** la identidad canónica que ya usa Fotos: `WELL` + `wellId` (pozo de Provincia o punto NE con número de pozo) o `MONITORING` + `monitoringId` (punto NE especial sin `wellId`). La autoridad para localizar la foto es `fotoId`; la entidad solo detecta eventos mal atribuidos.
- **No se guarda:** payloads, ids de Drive, URLs, imagen / base64, coordenadas.
- **Auditoría:** `email` normalizado (idempotencia y auditoría; **nunca** sale en un DTO de lectura), `nombre` (solo presentación; la autorización es por permisos, jamás por nombre) y `timestampUtc` ISO UTC como texto.
- **Orden:** solo `secuencia` (entero global, `max + 1` bajo lock, fail-closed ante ausente / duplicada / fraccionaria / inválida). La fecha no ordena.

### Eventos v1

| Evento | Quién | Campos | Efecto |
|---|---|---|---|
| `RETIRO_SOLICITADO` | `fotos_carga === true` | motivo (código + texto) | solicitud ABIERTA; la foto **sigue activa**. Su `eventoId` es el id de la solicitud. |
| `RETIRADA` | `fotos_moderar === true` | motivo | la foto queda retirada. |
| `RETIRO_RESUELTO` | `fotos_moderar === true` | `solicitudId` + `resolucion` (`APROBADO` / `RECHAZADO`) | APROBADO: retirada; RECHAZADO: sigue activa. La foto y la entidad salen de la solicitud, **no** del cliente. |
| `REPUESTA` | `fotos_moderar === true` | — | repone una foto retirada por eventos. |

`RETIRO_RESUELTO` y `REPUESTA` **no llevan motivo** en v1 (el motivo de una aprobación es el de la solicitud). Si más adelante se quiere una nota de resolución, se agrega sin cambiar el esquema (la columna `motivoTexto` ya existe).

## Estados

- **Foto (derivado):** `ACTIVA` | `RETIRADA`. No existe PENDIENTE para la foto productiva.
- **Solicitud (derivado):** `ABIERTA` | `APROBADA` | `RECHAZADA`. Distinto del de la foto; nunca se mezclan.
- **Reglas:** a lo sumo UNA solicitud abierta por foto; una solicitud resuelta no se resuelve otra vez; una foto retirada no admite solicitud ni nuevo retiro; no se retira directo con una solicitud abierta (se resuelve primero); la reposición solo sobre retiros por eventos. Tras reponer o rechazar se puede volver a solicitar (ciclos).
- **DTO derivado (interno):** `{fotoId, estado, visible, solicitudAbierta:{solicitudId, motivoCodigo}|null, puedeReponerse, requiereRevisionBorrado, integridad, origenRetiro, inconsistencias}`. Sin email, sin nombre y sin texto del motivo. `origenRetiro` (`EVENTO` | `LEGACY_OCULTA`) distingue los dos tipos de retiro; `inconsistencias` son solo códigos.

## Catálogo de motivos (v1)

`NO_CORRESPONDE_POZO`, `DUPLICADA`, `MALA_CALIDAD`, `SIN_CONTENIDO_UTIL`, `PRIVACIDAD`, `DESACTUALIZADA`, `OTRO`. Código **exacto** (sin trim, sin mayúsculas, sin sinónimos, sin códigos desconocidos). `motivoTexto`: opcional (los 6 primeros), **obligatorio con `OTRO`**, normalizado, 3 a 300 caracteres únicos (un emoji cuenta 1).

Normalización (igual que las observaciones, E5): CRLF / CR / NEL / LS / PS → LF; tab → espacio; se eliminan controles C0 (salvo LF), DEL, C1, controles direccionales explícitos, BOM y surrogates sueltos; trim. Se conservan emoji (incluido ZWJ), marcas LRM / RLM y las líneas en blanco internas.

## PRIVACIDAD y no borrado físico

Retirar **nunca** toca Drive ni el storage; tampoco por `PRIVACIDAD`. `PRIVACIDAD` retira como cualquier motivo (ocultamiento inmediato + invalidación de cache) y enciende la señal derivada `requiereRevisionBorrado` mientras la foto siga retirada. No hay workflow ni evento de borrado en E8-2: un borrado físico será una acción administrativa separada (el storage ya tiene `trashFotoPozo`, que va a la papelera de Drive).

## Idempotencia

`clientRequestId` obligatorio en toda escritura (`^[A-Za-z0-9_-]{8,64}$`), único **por usuario** (namespace `(email normalizado, clientRequestId)`, en cualquier tipo de evento). Orden del plan: validar entrada → permiso → idempotencia → estado → evento. El reintento exacto devuelve el evento original (sin email) y no escribe ni consume secuencia; el mismo id con otro contenido (otro tipo, otra foto, otro motivo / texto, otra solicitud / resolución) es `IDEMPOTENCY_CONFLICT`; más de una coincidencia es `INCONSISTENT_STATE`. El reintento se reconoce aunque la foto ya haya cambiado de estado.

## Integridad: fail-closed

Si el historial de una foto es ambiguo o corrupto **no se inventa un estado**: `integridad: 'NO_DERIVABLE'`, `estado: null`, `visible: false`. Una galería debe preferir ocultar antes que mostrar como activa una foto que no se puede derivar. Un evento corrupto solo afecta a las fotos que involucra. Códigos: `EVENTO_ID_DUPLICADO`, `SECUENCIA_DUPLICADA`, `SECUENCIA_INVALIDA`, `ID_INVALIDO`, `EVENTO_DESCONOCIDO`, `ENTIDAD_INVALIDA`, `ENTIDAD_NO_COINCIDE`, `ENTIDAD_INCONSISTENTE_EN_EVENTOS`, `MOTIVO_INVALIDO`, `CAMPOS_INCOHERENTES`, `RESOLUCION_HUERFANA`, `RESOLUCION_DOBLE`, `RESOLUCION_OTRA_FOTO`, `RESOLUCION_ANTERIOR_A_SOLICITUD`, `SOLICITUD_ABIERTA_DUPLICADA`, `SOLICITUD_SOBRE_FOTO_RETIRADA`, `RETIRO_DOBLE`, `RETIRO_CON_SOLICITUD_ABIERTA`, `REPOSICION_INVALIDA`, `BASELINE_DESCONOCIDO`, `FOTO_ID_INVALIDO`, `DERIVACION_NO_DISPONIBLE`. Las filas rotas sin `fotoId` válido no se pueden atribuir a ninguna foto (quedan como diagnóstico). Un evento con un tipo desconocido y una foto válida deja esa foto no derivable (puede ser un evento de una versión futura: ocultar es lo seguro).

Qué hace la galería si la hoja de eventos no se puede leer: ver «Fail-closed» más abajo (decidido en E8-3: `SERVICE_UNAVAILABLE`, sin fallback).

## Visibilidad central

`fotosPozosModeracion_visible(base, derivacion)` es **la única** decisión de «¿se muestra en la galería normal?»: baseline ACTIVA **y** vínculo CONFIRMADO **y** estado derivado ACTIVA **y** historial derivable. Con una derivación vacía coincide exactamente con `fotosPozosRepository_esVisible` (test de contrato). La usan `getFotosPozo`, `getFotoPozo` y el resumen (E8-3). **Visible internamente no es publicable:** la política pública de E10 será otra, encima de esta; por eso no se agregó ningún campo `publicable`.

## Permisos y gates definitivos (E8-3)

Todo es `=== true` (un `"SI"`, `1`, `"true"` o un objeto **no habilita nada**; el parser institucional de `Usuarios` convierte `SI` en `true` y columna ausente, vacío o cualquier otro valor en `false`). El permiso nuevo es `fotos_moderar`, columna **opcional** de `Usuarios` (si falta, es `false` para todos; no se crea en producción en esta etapa).

| Acción | Gate |
|---|---|
| Leer galería, imagen normal y resumen | `fotos` |
| Subir foto (sin cambios) | `fotos_carga` |
| Solicitar retiro | `fotos` **y** `fotos_carga` |
| Retirar directo, resolver, reponer, historial, cola, imagen de moderación | `fotos` **y** `fotos_moderar` |

`fotos_moderar` sin `fotos` **no** habilita moderación (quien no puede ver las fotos no decide a ciegas). El **autor** de una foto no puede retirarla directo por ser autor: solicita como cualquiera con `fotos_carga`. El gate se comprueba dos veces: en `Api.js` (estricto, antes de leer nada) y en el dominio (defensa en profundidad). Orden: sesión → permisos → contenido → estado (este último dentro del lock).

## No oráculo

Implementado en E8-3. Para quien **solicita** (sin moderación) se devuelve el mismo `FOTO_NOT_FOUND` ante: foto inexistente, oculta (legacy), retirada, no derivable o con vínculo sin confirmar. Lo único que se distingue es `SOLICITUD_YA_ABIERTA` (solo sobre una foto visible). El moderador sí ve la diferencia (`FOTO_YA_RETIRADA`, `SOLICITUD_ABIERTA`, `ESTADO_NO_DERIVABLE`, `REPOSICION_NO_PERMITIDA`, `SOLICITUD_YA_RESUELTA`, `SOLICITUD_NOT_FOUND`). Los errores nunca repiten el contenido del texto.

## Cache e invalidación (E8-3)

Cuando cambia la visibilidad (`RETIRADA`, `RETIRO_RESUELTO` + APROBADO y `REPUESTA`; **no** una solicitud ni un rechazo) se botan, por foto: `fotospozos_m_<fotoId>` (ids internos; vive 10 min), `fotospozos_t_<fotoId>` (miniatura; vive 6 h) y `fotospozos_resumen` (contador por entidad; vive 5 min). La imagen `full` no se cachea y la lista de la galería tampoco: no se inventó ninguna clave. Un test de contrato compara estas claves con las que `FotosPozosService` crea de verdad.

- La invalidación ocurre **después** de escribir el evento y de liberar el lock, y solo si hubo escritura nueva (un reintento idempotente no invalida). Si `CacheService` falla, se registra en el log y la operación sigue (el evento ya está escrito).
- **El cache no es un bypass:** `getFotoPozo` consulta los eventos **antes** de mirar el cache. Una foto retirada no se sirve aunque su miniatura siga cacheada (test crítico: miniatura cacheada → retiro → un usuario normal la pide → `FOTO_NOT_FOUND`). La invalidación es una optimización de frescura; la garantía de privacidad es la comprobación previa.

## Endpoints (E8-3)

Todos por `doPost` con `sessionToken`; el cliente es autoridad **solo** sobre los campos listados. El email y el nombre salen de la sesión y de la hoja `Usuarios`; la entidad, el timestamp, la secuencia y los ids los pone el servidor. Cualquier otro campo (`email`, `nombre`, `wellId`, `monitoringId`, `estado`, `secuencia`, `timestampUtc`, `solicitudId` en un retiro, `fotoId` en una resolución…) se descarta en la lista blanca de `Api.js`.

| Acción | Entrada | Respuesta OK |
|---|---|---|
| `solicitarRetiroFotoPozo` | `fotoId`, `motivoCodigo`, `motivoTexto`, `clientRequestId` | `{fotoId, duplicada, solicitudId}` |
| `retirarFotoPozo` | `fotoId`, `motivoCodigo`, `motivoTexto`, `clientRequestId` | `{fotoId, duplicada}` |
| `resolverRetiroFotoPozo` | `solicitudId`, `resolucion` (`APROBADO` / `RECHAZADO`), `clientRequestId` | `{fotoId, duplicada, solicitudId, resolucion}` |
| `reponerFotoPozo` | `fotoId`, `clientRequestId` | `{fotoId, duplicada}` |
| `getHistorialFotoPozo` | `fotoId` | `{foto, estado, eventos}` |
| `getFotosPozosPendientesModeracion` | `limit` (1..100, defecto 50), `cursor` | `{total, items, hayMas, cursor}` |
| `getFotosPozosRetiradasModeracion` (E8-5) | `limit` (1..100, defecto 50), `cursor` | `{total, items, hayMas, cursor}` |
| `getFotoPozoModeracion` | `fotoId`, `variante` (`thumb` / `full`) | `{fotoId, variante, mimeType, imagenBase64}` |

Ninguna respuesta lleva email, secuencia, `clientRequestId`, claves de cache, ids de Drive ni URLs de storage. Códigos de error estables: `INVALID_*` de entrada, `PERMISSION_DENIED`, `FOTO_NOT_FOUND`, `SOLICITUD_NOT_FOUND`, `SOLICITUD_YA_ABIERTA`, `SOLICITUD_ABIERTA`, `SOLICITUD_YA_RESUELTA`, `FOTO_YA_RETIRADA`, `FOTO_NO_RETIRADA`, `REPOSICION_NO_PERMITIDA`, `ESTADO_NO_DERIVABLE`, `IDEMPOTENCY_CONFLICT`, `INCONSISTENT_STATE`, `SERVICE_UNAVAILABLE`.

- **Retirar con una solicitud abierta** devuelve `SOLICITUD_ABIERTA`: nunca la resuelve en silencio.
- **Resolver:** la foto y la entidad salen de la solicitud almacenada. `APROBADO` retira e invalida el cache; `RECHAZADO` deja la foto activa y no invalida.
- **Reponer:** solo lo retirado por eventos; una `OCULTA` legacy devuelve `REPOSICION_NO_PERMITIDA`.

## Escritura: orden, lock y concurrencia

1. Validación de entrada (dominio) y permiso, sin leer nada. 2. Camino rápido: si `(usuario, clientRequestId)` ya existe, se devuelve el resultado equivalente sin lock. 3. **ScriptLock.** 4. **Dentro del lock** se vuelve a mirar la idempotencia, se **relee** la hoja de eventos y se deriva (nunca se confía en estado leído antes), se lee la foto y se planifica (el estado se revalida acá). 5. Se calcula la secuencia (`max + 1`) y se agrega la fila. 6. Se libera el lock. 7. Se invalida el cache. 8. `Api.js` escribe **una** fila resumida en Historial.

Si no se consigue el lock, si falla la lectura o la escritura, o si la hoja no está, se lanza y `Api.js` responde `SERVICE_UNAVAILABLE` con mensaje fijo (el detalle va a `Logger`, sin el motivo ni URLs): no se escribió nada ni se invalidó el cache. Test de carrera simulado: otro moderador resuelve la solicitud mientras este espera el lock → `SOLICITUD_YA_RESUELTA`, un solo evento.

## Fail-closed: la hoja de eventos es parte del contrato (decisión cerrada)

Con E8 activo, `FotosPozoEventos` es necesaria. Si no existe, tiene el esquema roto o no se puede leer, **no hay fallback silencioso**: `getFotosPozo`, `getFotoPozo`, `getResumenFotosPozos`, las escrituras, el historial y la cola responden `SERVICE_UNAVAILABLE`; nunca se muestra una galería «sin moderar» (podría haber fotos retiradas por PRIVACIDAD). La hoja **no se auto-crea**. Una foto con historial no derivable no se muestra (las demás sí). La imagen del moderador (`getFotoPozoModeracion`) no deriva estado —solo lee FotosPozos y el storage— y por eso no depende de la hoja de eventos; sí está gateada. **Orden de rollout:** crear y validar la hoja ANTES de publicar el código que depende de ella.

## Galería, imagen normal y resumen (E8-3)

- `getFotosPozo` muestra solo fotos con baseline `ACTIVA`, vínculo `CONFIRMADO`, historial derivable y estado derivado `ACTIVA`. No muestra `OCULTA` legacy, `RETIRADA` ni no derivables. Una **solicitud abierta no oculta** la foto.
- `getFotoPozo(fotoId, thumb|full)` valida la visibilidad derivada antes de servir (con o sin cache) y responde `FOTO_NOT_FOUND`, idéntico al de una foto inexistente.
- `getResumenFotosPozos` cuenta solo fotos visibles (una solicitud abierta cuenta; una retirada, `OCULTA` o no derivable no).
- Una foto recién subida (baseline `ACTIVA` + `CONFIRMADO`, sin eventos) es visible normalmente: `subirFotoPozo` no cambió ni escribe eventos.

## Historial, cola e imagen del moderador

- **Historial** (`getHistorialFotoPozo`): estado derivado + eventos, **el más reciente primero** (por secuencia), incluida la resolución de cada solicitud. Por evento: `evento`, `solicitudId`, `resolucion`, `motivoCodigo`, `motivoTexto` (solo en solicitud y retiro), `nombre`, `timestampUtc`. Sin email, `clientRequestId`, secuencia ni payload crudo. Un tipo de evento desconocido se muestra como `DESCONOCIDO`. El estado incluye `requiereRevisionBorrado` y `origenRetiro`.
- **Cola** (`getFotosPozosPendientesModeracion`): solicitudes ABIERTAS, más reciente primero; **una** lectura de la hoja de eventos y **una** de FotosPozos (sin N+1). Por ítem: `solicitudId`, `fotoId`, `entidadTipo`, `entidadId`, `motivoCodigo`, `motivoTexto`, `nombre`, `timestampUtc` y `foto: {tipoFoto, fuente, fechaFotoValor, fechaFotoPrecision}` (opcional, ya disponible en la misma lectura; la UI puede ignorarlo). **Decisión por volumen:** se esperan decenas de solicitudes abiertas, así que la paginación es un cursor simple (la secuencia del último ítem; `limit` 1..100, defecto 50) sobre una lectura completa en memoria; no hay índice ni lectura selectiva. Si algún día creciera mucho, se agrega lectura selectiva sin cambiar el contrato.
- **Imagen** (`getFotoPozoModeracion`): devuelve la miniatura o la imagen completa de una foto activa **o retirada**. No usa ni llena el cache de la galería. Solo una lectura explícita puede devolver `STORAGE_UNAVAILABLE`: los eventos de moderación no dependen del storage (un retiro lógico se registra aunque el storage esté caído).

## Historial transversal (auditoría en Sheets)

Una fila resumida (`usuario`, acción, entidad, `OK`) por cada escritura **exitosa** (solicitar, retirar, resolver, reponer). **No** se guarda el motivo, el `fotoId`, el `motivoTexto`, un email redundante, payloads ni base64. Un reintento idempotente (sin evento nuevo) no escribe otra fila. Los errores de negocio, los permisos denegados y las fallas se auditan solo con su código. No hay Telegram.

## PRIVACIDAD (E8-3)

Retiro lógico: oculta de inmediato, invalida el cache y deja `requiereRevisionBorrado = true` para el moderador. El archivo **permanece**: moderar no usa `trashFotoPozo`, `DriveApp` ni el storage (salvo la lectura explícita de imagen). Hay una guarda por test.

## Setup de la hoja (ejecutado en E8-6)

`setupFotosPozoEventosSheet()` es manual: si la hoja falta, la crea con los 14 encabezados exactos, fila 1 congelada, texto plano y `secuencia` numérica (`CREADA`); si existe y es correcta, devuelve `YA_EXISTE`; si existe mal, falla sin repararla. **No se ejecutó.**

## E8-4: interfaz de moderación en Fotos (local, sin desplegar)

> **Nota (E8-5):** la bandeja «Retiradas en esta sesión» y la memoria de «solicitud enviada» que se describen abajo **fueron reemplazadas en E8-5** por el listado de retiradas del backend (pantalla «Fotos pendientes») y por `tieneSolicitudRetiro` en la galería; ver la sección E8-5. El resto de E8-4 (permisos, formularios, historial, reposición, ids, errores, accesibilidad) sigue vigente.

**Qué hace** (sin rediseñar Fotos): en el visor de la galería, cada persona ve solo las acciones que puede ejecutar.

| Permiso (booleanos exactos, `=== true`) | Acciones en el visor |
|---|---|
| `fotos` solo | ninguna |
| `fotos` + `fotos_carga` | **Sugerir retiro** |
| `fotos` + `fotos_moderar` | **Retirar foto**, **Ver historial** (y **Reponer foto** desde el historial de una foto retirada) |
| los tres | todas |
| `fotos_carga` o `fotos_moderar` sin `fotos`, o valores truthy (`"SI"`, `1`…) | ninguna |

La moderación no se infiere de `fotos_carga`, del nombre ni de la autoría. El backend vuelve a exigir cada permiso.

**Archivos:** `js/fotosModeracionLogic.js` (lógica pura con tests), `js/fotosModeracion.js` (controlador DOM), 7 wrappers en `js/api.js`, markup en `index.html` (acciones del visor, bandeja y dos modales), estilos `.fotos-mod-*` en `css/styles.css`, integración mínima en `js/fotosPozos.js` y cableado en `js/app.js` (contexto fresco, ganchos de la galería y reseteo al cerrar sesión). Los dos scripts nuevos están en el shell del service worker. No hay cache de API ni de imágenes nuevas.

**Sugerir retiro.** Modal propio («Sugerir retiro de foto»): motivo obligatorio con etiquetas humanas (`No corresponde al pozo`, `Duplicada`, `Mala calidad`, `Sin contenido útil`, `Privacidad`, `Desactualizada`, `Otro`); detalle opcional, **obligatorio con `Otro`**, 3 a 300 caracteres normalizados (un emoji cuenta 1). Al éxito se cierra el modal, **la foto sigue visible** (una solicitud abierta no oculta nada) y aparece el estado discreto «Retiro sugerido».

**Retirar foto.** Modal claramente distinto («Retirar foto», «Esta foto dejará de mostrarse en la galería. El archivo no se eliminará.»). Con `Privacidad` agrega el aviso discreto «Quedará marcada para revisión de borrado.» (nunca dice que se borrará). Al éxito: se cierra el modal y el visor, la foto pasa a la bandeja de la sesión y la galería **se vuelve a pedir a `getFotosPozo`** (junto con el contador compartido, forzado): no hay copia optimista ni se confía en quitar un nodo. Si ese refresco falla, la galería pasa al estado de error con «Reintentar» (no queda a la vista una galería vieja que podría mostrar la foto retirada).

**Historial** (solo moderadores). Más reciente primero, con etiquetas fijas: `RETIRO_SOLICITADO` → «Retiro sugerido», `RETIRADA` → «Foto retirada», `RETIRO_RESUELTO` + `APROBADO` / `RECHAZADO` → «Retiro aprobado» / «Retiro rechazado», `REPUESTA` → «Foto repuesta». Por evento: nombre, fecha y hora, motivo (etiqueta) y detalle. **Nunca** email, `clientRequestId`, secuencia, ids ni códigos crudos. El mapeo vive en un solo lugar (`fotosModeracionLogic_*`). Una foto retirada por `PRIVACIDAD` muestra «Pendiente de revisión de borrado» (solo en este contexto de moderador).

**Reposición.** Desde el historial de una foto retirada por eventos: «Reponer foto» → confirmación («¿Querés volver a mostrar esta foto en la galería?», más la nota «Las fotos ocultas históricamente no pueden reponerse desde este flujo.»). El botón solo existe si el backend lo habilita (`puedeReponerse`) y la retiro un evento: una `OCULTA` legacy o una foto activa **no** ofrecen reponer. Al éxito: se quita de la bandeja y se refresca la galería.

**Imagen de una foto retirada.** Solo con `getFotoPozoModeracion` (miniatura en la bandeja y en el historial). El visor normal sigue usando `getFotoPozo`, que respeta la visibilidad: la UI nunca lo usa «con bypass». Tests y guardas estáticas fijan que solo `api.js` y `fotosModeracion.js` tocan los wrappers de moderación.

**Decisiones por contrato real del backend (E8-3):**
- (**Reemplazado en E8-5**, ver abajo: `getFotosPozo` ahora trae `tieneSolicitudRetiro` y no se recuerda nada en memoria.) `getFotosPozo` devolvía solo fotos visibles y **no informaba** si una foto tenía una solicitud abierta. «Retiro sugerido» se recordaba únicamente cuando el backend lo confirmaba en la sesión (éxito de la sugerencia o rechazo por solicitud ya abierta); recargar la página lo olvida. No se agregó un endpoint por foto para saberlo: una segunda sugerencia la rechaza el backend (`SOLICITUD_YA_ABIERTA`) y la UI lo explica («Esta foto ya tiene una solicitud de retiro pendiente.»).
- **No existe un listado de fotos retiradas** (el backend solo ofrece historial e imagen por `fotoId`). Para poder reponer sin inventar N pedidos, la **bandeja «Retiradas en esta sesión»** guarda las fotos que *esa persona* retiró durante la sesión (por entidad, solo en memoria; se descarta al cerrar sesión). El toggle «Ver retiradas» y la cola global quedan para **E8-5** (necesitan un endpoint de listado).
- **Resolver solicitudes (aprobar / rechazar) no tiene UI en E8-4.** El wrapper `apiResolverRetiroFotoPozo` y el de la cola global existen para fijar el contrato, pero ningún archivo de la interfaz los usa todavía. Si un moderador intenta retirar una foto con solicitud abierta ve el mensaje de solicitud pendiente.

**clientRequestId.** `foto-sol-<uuid>`, `foto-ret-<uuid>`, `foto-rep-<uuid>` (y `foto-res-<uuid>` reservado para E8-5): espacios separados por acción, siempre dentro de `^[A-Za-z0-9_-]{8,64}$`. Un id por **intención**: abrir el modal, cancelar y reabrir, o un éxito generan uno nuevo; reintentar el mismo contenido tras un error recuperable (red, servidor) reutiliza el mismo id; cambiar el motivo o el detalle después de un intento genera uno nuevo; tras `IDEMPOTENCY_CONFLICT` el id queda «quemado» y el siguiente envío usa otro (nunca se reenvía solo). Mientras hay un pedido en vuelo no se lanza otro (doble clic).

**Errores.** Texto humano, nunca códigos, stack, nombres de hoja ni el `message` crudo: `PERMISSION_DENIED` → «Ya no tenés permiso para realizar esta acción.»; `FOTO_NOT_FOUND` → «La foto ya no está disponible.»; `SOLICITUD_ABIERTA` / `SOLICITUD_YA_ABIERTA` → «Esta foto ya tiene una solicitud de retiro pendiente.»; `FOTO_YA_RETIRADA`, `FOTO_NO_RETIRADA`, `SOLICITUD_YA_RESUELTA`, `INVALID_TRANSITION` → «El estado de la foto cambió. Actualizamos la galería.» (cierra el modal y refresca); `SERVICE_UNAVAILABLE` → «No se pudo consultar la moderación de fotos. Intentá nuevamente.» (en desarrollo local aparece mientras la hoja `FotosPozoEventos` no exista: no hay ningún fallback que muestre o modere ignorando eventos). `UNAUTHORIZED` / `USER_DISABLED` usan el cierre de sesión global y no se muestran como error de moderación.

**Accesibilidad y teclado.** Dialogos `role="dialog" aria-modal`, `label` en cada campo, errores con `role="alert"`, foco inicial en el motivo, Tab/Shift+Tab sin salir del modal, Escape cancela **sin** cerrar el visor de abajo (el visor ignora el teclado mientras hay un modal), el foco vuelve al botón que abrió el modal (o al mensaje de estado si ese botón ya no está), botones deshabilitados durante el envío y objetivos de 44 px. Todo texto de datos se pinta con `textContent` (se probó HTML, script, `&`, emoji y multilínea); no hay `innerHTML`.

**Responsive** (verificado con el controlador real en el navegador, 375 / 768 / 1280 px): hoja inferior en celular, centrado desde 640 px; sin scroll horizontal (palabras largas partidas, botones que envuelven); historial largo con scroll interno del panel.

**Para un usuario normal** nada de esto aparece fuera de «Sugerir retiro» y «Retiro sugerido»: ni la bandeja, ni el historial, ni el aviso de revisión de borrado.

**No productivo todavía:** falta la hoja `FotosPozoEventos`, la columna `fotos_moderar` en `Usuarios`, el rollout y los permisos reales (E8-6).

## E8-5: cola institucional «Fotos pendientes» (local, sin desplegar)

Objetivo: cerrar el circuito institucional de moderación. **No hay rollout todavía** (hoja, columna y permisos reales son E8-6) y la hoja de ruta no cambia.

### 1. `tieneSolicitudRetiro` en la galería normal (backend)

`getFotosPozo` suma a cada foto visible **un solo booleano**: `tieneSolicitudRetiro`, `true` si el historial **derivable** de la foto tiene una solicitud de retiro **ABIERTA** y `false` en cualquier otro caso (activa sin solicitud, solicitud rechazada). Una foto retirada (incluida la que se retiró aprobando la solicitud) no aparece en la galería normal.

- **No viaja nada de la solicitud:** ni `solicitudId`, ni motivo, ni texto, ni nombre, ni email, ni fecha. Las claves de cada foto de la galería son las de siempre más ese booleano (test de claves exactas). La respuesta de una **subida** no lo lleva.
- **Sale de los eventos reales**, en la misma pasada y con la misma derivación que ya filtra la visibilidad (`fotosPozosModeracionOps_visiblesConSolicitud`): una sola lectura de la hoja de eventos por carga, **sin N+1** (test que mide lecturas de hoja con 2 y con 42 fotos). Una foto no derivable (corrupción, entidad que no coincide) **no se muestra** (fail-closed), aunque tenga la solicitud abierta.
- **No cambia la semántica de E8-3:** una solicitud abierta no oculta la foto y **sigue contando** en el contador.
- **Cache (auditado):** la lista de la galería **no se cachea**; solo se cachean los ids internos (`fotospozos_m_<fotoId>`), la miniatura (`fotospozos_t_<fotoId>`) y el resumen. El booleano se calcula en cada pedido, así que solicitar o rechazar **no invalidan nada** (test: con el cache lleno, solicitar → `true`, rechazar → `false`, sin ninguna llamada a `cache.remove`). Aprobar usa la invalidación completa de E8-3 (metadata, miniatura y resumen de esa foto).

### 2. Listado de fotos retiradas (backend)

Acción nueva `getFotosPozosRetiradasModeracion` (solo `fotos` + `fotos_moderar` exactos; mismos errores y la misma paginación que la cola: `limit` 1..100, defecto 50, `cursor` estable por la secuencia del evento que retiró la foto, la retirada más reciente primero, sin traer todo).

- **Entran** solo las fotos retiradas **por eventos** que se pueden reponer: historial derivable, estado `RETIRADA` con origen `EVENTO`, baseline `ACTIVA`, vínculo `CONFIRMADO` y entidad coincidente. **No entran:** una `OCULTA` legacy (ningún evento la revive), una foto no derivable ni una sin fila en FotosPozos.
- Por ítem: `fotoId`, `entidadTipo`, `entidadId`, `origenRetiro` (`EVENTO`), `motivoCodigo`, `motivoTexto`, `nombre`, `timestampUtc`, `viaSolicitud`, `requiereRevisionBorrado` y `foto: {tipoFoto, fuente, fechaFotoValor, fechaFotoPrecision}`. Si la foto se retiró **aprobando una solicitud**, el motivo y el detalle son los de la solicitud y `nombre` es **quien aprobó**; si la retiró un moderador directo, `nombre` es quien retiró. Sin email, `clientRequestId`, secuencia, ids de Drive, base64 ni URLs.
- **Una lectura de cada hoja** (eventos y FotosPozos; esta última solo si hay candidatas), agrupando en memoria. Para saber qué evento dejó retirada a la foto, la derivación guarda ahora `retiro` (`{ev, solicitud}`; interno, sin email).

### 3. Pantalla «Fotos pendientes» (frontend)

- **Acceso:** tarjeta propia en la pantalla principal («Fotos pendientes» / «Revisá solicitudes de retiro»), visible **solo con `fotos` y `fotos_moderar` exactos** (`fotosModeracionLogic_puedeModerar`: la regla compartida; `app.js` no tiene el nombre del permiso). Al hacer click se vuelve a comprobar el permiso. **La tarjeta no carga nada:** la primera página se pide recién al abrir la pantalla.
- **Pestañas** (`role="tablist"`, flechas / Inicio / Fin): **Pendientes** (solicitudes abiertas, `getFotosPozosPendientesModeracion`) y **Retiradas** (`getFotosPozosRetiradasModeracion`). Son listas **independientes**: una respuesta vieja de una no pisa la otra, y una respuesta vieja de la misma lista (recarga, salir de la pantalla, cerrar sesión) se descarta. Una pestaña ya cargada se muestra tal cual; tras **aprobar** la de Retiradas se marca para recargarse.
- **Paginación honesta:** una página por vez (20), «Ver más» con el cursor del backend, dedupe por `solicitudId` / `fotoId`, un ítem resuelto no resucita si llegaba en una página en vuelo. **No hay filtros ni buscador:** filtrar solo la página cargada daría la impresión de buscar en toda la cola. El total que informa el backend se muestra como «N solicitudes pendientes» / «N fotos retiradas» **sin otra llamada** (no hay badge en la tarjeta: exigiría leer la cola al entrar al hub).
- **Tarjetas:** miniatura (`getFotoPozoModeracion` thumb, **nunca** el endpoint normal; carga lazy con un máximo de 3 pedidos en paralelo; si falla, «Sin vista previa» y la solicitud sigue siendo resoluble), entidad («Pozo 14-0001» o «Punto NE …»), quién y cuándo, motivo humano, detalle y metadata de la foto. Pendientes: **Abrir foto**, **Ver historial**, **Aprobar retiro**, **Rechazar**. Retiradas: **Abrir foto**, **Ver historial**, **Reponer** y, si el backend lo marca (PRIVACIDAD), la etiqueta «Pendiente de revisión de borrado» (no hay botón de borrar).
- **Abrir foto:** imagen completa con `getFotoPozoModeracion` (full), aunque otra persona la haya retirado mientras se miraba la cola; sin fallback al endpoint normal.
- **Ver historial:** reutiliza el diálogo de E8-4 (`fotosModeracionController_abrirHistorial`); no hay un componente nuevo. Reponer desde ahí actualiza la lista y el contador compartido.
- **Confirmaciones** (un diálogo, sin pedir motivo): aprobar («La foto dejará de mostrarse en la galería.»), rechazar («La foto seguirá visible en la galería.»), reponer («¿Querés volver a mostrar esta foto en la galería?», más «También dejará de quedar marcada para revisión de borrado.» si requiere revisión de borrado). `clientRequestId` `foto-res-<uuid>` (aprobar y rechazar) / `foto-rep-<uuid>`: estable en el reintento, nuevo al cancelar y reabrir o tras un éxito; doble clic = un solo pedido; botones deshabilitados mientras se envía.
- **Resultados:** aprobar → sale de Pendientes, baja el total, la foto aparece en Retiradas al recargar esa pestaña y el contador compartido se vuelve a pedir; rechazar → sale de Pendientes y la foto sigue activa (`tieneSolicitudRetiro` vuelve a `false`); reponer → sale de Retiradas, vuelve a la galería y se refresca el contador. Si otro moderador ya resolvió: «La solicitud ya fue resuelta. Actualizamos la lista.» y se vuelve a pedir la primera página.
- **Errores:** pantalla de error con texto fijo («No se pudo cargar la moderación de fotos.») y **Reintentar**, sin códigos técnicos. `UNAUTHORIZED` / `USER_DISABLED` usan el cierre de sesión global.
- **Accesibilidad / responsive:** pestañas con `aria-selected` (la activa no depende solo del color: trazo grueso, peso y subrayado), botones reales con nombre propio por tarjeta, foco que vuelve al botón de origen (o al aviso si la tarjeta ya no está), Tab / Escape en los diálogos, mensajes anunciables (`role="status"` / `alert`), objetivos de 44 px. Verificado con el controlador real en el navegador a 375 / 768 / 1280 px con 0, 1, 8, 20 y 45 solicitudes, texto largo, nombre largo sin espacios, miniatura fallida, PRIVACIDAD y paginación: sin scroll horizontal.

### 4. Cambios en la galería (E8-4 ajustada)

- **Se eliminó «Retiradas en esta sesión»** (la bandeja en memoria): las retiradas salen del backend en «Fotos pendientes». Tampoco se recuerda en memoria «solicitud enviada».
- «Retiro sugerido» sale de `foto.tieneSolicitudRetiro === true` (booleano exacto): **sobrevive a recargar y a una sesión nueva**. Con una solicitud abierta, un usuario con `fotos_carga` **no ve «Sugerir retiro»** y ve el estado discreto; un moderador no ve «Retirar foto» (el backend la rechazaría con `SOLICITUD_ABIERTA`) y ve «Retiro sugerido. Resolvelo desde Fotos pendientes.» más **Ver historial**. Un lector (solo `fotos`) no ve nada de esto.
- Tras sugerir, la galería se vuelve a pedir y **el visor abierto pasa a mostrar la foto actualizada** (o se cierra si ya no está), sin volver a pedir la imagen.

### 5. No productivo todavía

Falta la hoja `FotosPozoEventos`, la columna `fotos_moderar` en `Usuarios`, el rollout y los permisos reales (E8-6). **No se implementó** borrado físico (la cola solo muestra la señal de revisión), ni «Ver pozo» desde la cola, ni filtros, ni el botón Inicio global del roadmap.

## FotosPozosCambios: legacy

La hoja `FotosPozosCambios` (6 columnas, repositorio sin endpoint ni UI) queda como **información histórica legacy**: no se borra, no se migra, no se escribe y **no es la fuente del nuevo estado**. Ningún archivo de E8 la menciona en código (test de contrato) y nada del backend actual la escribe.

## Fuera de E8-3 (a propósito)

- **POR_REVISAR (1.073):** no se suben ni hay herramienta todavía (E8.x). El modelo está pensado para que una asociación aprobada termine en una foto **ACTIVA normal** (baseline ACTIVA + vínculo CONFIRMADO, sin eventos).
- **Foto principal**, **hash SHA-256**, **vista pública (E10)**: sin cambios en E8-3; la imagen, el pipeline y el storage no se tocan.

## Requisitos PRE-ROLLOUT (E8-6, cumplidos; ver «Rollout productivo»)

1. **Reconciliación de `FotosPozos`:** obtener el export CSV actual de la hoja y contrastarlo con los 4.116 CONFIRMADO subidos al storage. La cifra productiva no se afirma acá: **a reconciliar** (la documentación de importación está desactualizada; ver `docs/fotos-pozos-importacion.md`).
2. **Respaldo fuera del repo de `scripts/out/fotos`**: está en `.gitignore` y contiene la evidencia de la importación (manifiestos, estados de subida, reportes). No se agrega al repo.
3. Crear la hoja con `setupFotosPozoEventosSheet` y la columna `fotos_moderar` en `Usuarios` antes de publicar el backend que las usa (la hoja primero: sin ella la galería falla cerrada).
4. Decidir los permisos reales: quién recibe `fotos_moderar` (siempre junto con `fotos`).
