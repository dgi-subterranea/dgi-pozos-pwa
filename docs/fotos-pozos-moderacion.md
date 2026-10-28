# Moderación de fotos de pozos (E8)

Estado: **E8-3 — backend cableado (endpoints, permiso, integración con la galería), SIN UI y SIN desplegar.** Nada de esto está en producción: la hoja `FotosPozoEventos` **no está creada**, la columna `fotos_moderar` **no existe** en `Usuarios`, no se ejecutó `setupFotosPozoEventosSheet`, no hay deploy ni commit, y el frontend, el storage y Drive no se tocaron. La UI es E8-4; el rollout, E8-6.

Alcance de E8 v1 (cerrado en E8-1): **moderación productiva + cola + base para la curaduría histórica.** La subida sigue **directa** (sin aprobación previa).

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

## Setup de la hoja (no ejecutado)

`setupFotosPozoEventosSheet()` es manual: si la hoja falta, la crea con los 14 encabezados exactos, fila 1 congelada, texto plano y `secuencia` numérica (`CREADA`); si existe y es correcta, devuelve `YA_EXISTE`; si existe mal, falla sin repararla. **No se ejecutó.**

## FotosPozosCambios: legacy

La hoja `FotosPozosCambios` (6 columnas, repositorio sin endpoint ni UI) queda como **información histórica legacy**: no se borra, no se migra, no se escribe y **no es la fuente del nuevo estado**. Ningún archivo de E8 la menciona en código (test de contrato) y nada del backend actual la escribe.

## Fuera de E8-3 (a propósito)

- **POR_REVISAR (1.073):** no se suben ni hay herramienta todavía (E8.x). El modelo está pensado para que una asociación aprobada termine en una foto **ACTIVA normal** (baseline ACTIVA + vínculo CONFIRMADO, sin eventos).
- **Foto principal**, **hash SHA-256**, **vista pública (E10)**: sin cambios en E8-3; la imagen, el pipeline y el storage no se tocan.

## Requisitos PRE-ROLLOUT (E8-6)

1. **Reconciliación de `FotosPozos`:** obtener el export CSV actual de la hoja y contrastarlo con los 4.116 CONFIRMADO subidos al storage. La cifra productiva no se afirma acá: **a reconciliar** (la documentación de importación está desactualizada; ver `docs/fotos-pozos-importacion.md`).
2. **Respaldo fuera del repo de `scripts/out/fotos`**: está en `.gitignore` y contiene la evidencia de la importación (manifiestos, estados de subida, reportes). No se agrega al repo.
3. Crear la hoja con `setupFotosPozoEventosSheet` y la columna `fotos_moderar` en `Usuarios` antes de publicar el backend que las usa (la hoja primero: sin ella la galería falla cerrada).
4. Decidir los permisos reales: quién recibe `fotos_moderar` (siempre junto con `fotos`).
