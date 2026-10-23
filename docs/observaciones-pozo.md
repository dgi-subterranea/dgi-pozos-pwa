# Observaciones del pozo (E5)

Estado: **E5-1 (lectura), E5-2 (alta) y E5-3 (anulación) commiteadas en local (backend completo) y E5-4 (frontend de lectura) también; E5-5 (frontend: agregar observación) implementada en el repo, sin publicar.** La anulación en el frontend (E5-6) queda para la etapa siguiente.

## Propósito
Una línea de tiempo de **observaciones operativas** por pozo: acceso, estado físico, lo que informa el propietario, anomalías vistas en campo, un dato registral a revisar o cualquier texto útil. Es **contexto humano y auditable**.

### Independencia de los otros módulos
Las observaciones existen por sí mismas. **No** dependen de, ni modifican: la ubicación (correcciones, decisiones, sugerencias), el estado registral, la evaluación de reemplazo, las fotos, el ITF, los niveles estáticos, el mapa ni ninguna decisión operativa. Ninguna columna `observacion` de otro módulo se reutiliza (cada una es el motivo de un evento de *su* flujo: evaluación de reemplazo, corrección de ubicación, leyenda de una foto, medición NE, comentario registral del padrón).

## Modelo: append-only, una fila = un evento
Hoja `ObservacionesPozo` (mismo spreadsheet que `Usuarios` / `Historial` / `UbicacionCorrecciones`). **Nunca** se edita ni se borra una fila desde la app. No hay columna de estado: el estado se **deriva** de los eventos. Una sola hoja: la escritura es una sola fila, así que no hay escritura entre hojas ni autocurado.

### Esquema (11 columnas, en este orden)
| # | Columna | Qué guarda |
|---|---|---|
| 1 | `observacionId` | UUID de la **observación** (lo genera el servidor). La ALTA lo crea; la ANULADA lo *referencia*. |
| 2 | `evento` | `ALTA` o `ANULADA`. |
| 3 | `wellId` | `DD-PPPP`. En una ANULADA es una copia del pozo de la alta. |
| 4 | `texto` | Solo en ALTA: el texto de la observación (plano; hasta 1000 caracteres, lo exigirá la escritura de E5-2). |
| 5 | `categoria` | **Reservada.** Siempre vacía en el MVP: el servidor escribe vacío y una entrada que traiga una categoría no soportada se **rechaza** (no se ignora en silencio) hasta que exista un catálogo. |
| 6 | `motivo` | Solo en ANULADA: el motivo (obligatorio al anular, E5-3). |
| 7 | `email` | Quien escribió el evento (de la sesión, normalizado). Interno: **nunca** sale al cliente. |
| 8 | `nombre` | La foto del nombre al escribir (de la sesión). Es lo único del autor que se muestra. |
| 9 | `timestampUtc` | ISO 8601 UTC con milisegundos y `Z`, guardado como **texto**. |
| 10 | `secuencia` | Entero global y monótono (máx + 1 bajo lock). Es el **único orden** y el cursor de paginación: la fecha no ordena nada. |
| 11 | `clientRequestId` | Idempotencia de la escritura, único por usuario (E5-2 / E5-3). |

Las columnas se buscan por el **texto del encabezado** (sin distinguir mayúsculas ni espacios): reordenarlas a mano no rompe nada. **Fail-closed:** si falta una de las 11 o hay una repetida, la hoja no se lee. Lo que no se guarda a propósito: estado (derivado), fuente de existencia del pozo (queda en Logger), adjuntos, visibilidad pública.

### Eventos y estado derivado
- `ALTA` crea una observación. `ANULADA` la **referencia** por `observacionId`: **no** es una observación independiente.
- **ACTIVA** mientras ninguna ANULADA la referencie; **ANULADA** si la referencia alguna.
- Una anulación no borra nada: el texto original queda en la hoja.

### Derivación fail-safe (criterio exacto)
Principio: **ante una inconsistencia el backend nunca elige en silencio y nunca hace aparecer contenido que debe seguir oculto.** El texto es contenido humano y puede ser sensible: si una observación es **ambigua** se **oculta entera** (no se devuelve, ni siquiera como anulada, y no suma a los totales). En duda de privacidad, se oculta antes que mostrar.

| Caso | Tratamiento |
|---|---|
| Evento desconocido (ni ALTA ni ANULADA) / fila rota | se ignora |
| `observacionId` que no es un UUID | se ignora: no se puede relacionar con nada |
| ALTA inválida (wellId mal formado, texto vacío, secuencia que no es un entero ≥ 1) | se ignora: no se muestra contenido dudoso |
| **Identidad duplicada:** dos o más ALTA con el mismo `observacionId` (aunque difieran el texto, la secuencia o el pozo; también compite una fila de contenido inválido) | **ninguna se devuelve** (`ID_DUPLICADO`). No se elige la de menor secuencia, ni la primera, ni la última. Una ANULADA que refiera ese id no selecciona ni hace reaparecer ninguna |
| **Secuencia duplicada:** dos eventos (ALTA o ANULADA, de la misma observación o de distintas) con la misma `secuencia` | la secuencia es el orden global y el cursor: tiene que ser **única**. Se ocultan **todas las observaciones que dependen de esos eventos** (la de cada ALTA y la que anula cada ANULADA involucrada) (`SECUENCIA_DUPLICADA`). La fila **nunca** sustituye a la secuencia |
| ANULADA que referencia una ALTA (no ambigua) | la observación queda **ANULADA** aunque el resto de la fila esté roto (secuencia, fecha, motivo, wellId) o la anulación figure **antes** del alta (fail-safe de privacidad: sin la anulación el texto saldría como activo) |
| Varias ANULADA de una misma observación | sigue anulada (nunca «des-anula»); informa autor y motivo la primera (menor secuencia; sin secuencia válida va después). Dos con la **misma** secuencia son una colisión (fila de arriba) |
| ANULADA sin ALTA (huérfana) | se ignora |

Cada inconsistencia queda en Logger como **código + pozo consultado + `observacionId` + filas + secuencias** (hasta 10 detalles por lectura, con «y N más»; **jamás** el texto, el motivo, el nombre ni el email).
**Alcance de la unicidad de `secuencia`:** se exige entre los eventos que concurren en la lectura del pozo (sus filas y las anulaciones que las referencian). Una colisión con un evento de **otro** pozo que no concurre no afecta a este (su cursor sigue siendo inequívoco); la unicidad global la garantiza quien escribe (E5-2: máx + 1 bajo lock). Un `observacionId` repetido **sí** se detecta entre pozos (la lectura trae toda fila que comparta el id de una alta del pozo). La lectura de un pozo selecciona también toda ANULADA que referencie una alta del pozo **aunque su `wellId` esté vacío o roto**: si no se leyera, la observación reaparecería como activa.

## Permisos (nuevos, columnas de la hoja `Usuarios`)
| Permiso | Semántica |
|---|---|
| `observaciones` | ver |
| `observaciones` + `observaciones_agregar` | agregar y anular las **propias** (E5-2 / E5-3) |
| `observaciones` + `observaciones_anular` | anular las de **cualquier autor** y ver el **texto original de las anuladas** |

Mismo parser que el resto: solo `"SI"` (normalizado: mayúsculas / espacios) habilita; cualquier otro valor, o una **columna ausente en `Usuarios`, es `false`** (fail-closed). `observaciones_agregar` y `observaciones_anular` **no** dan lectura por sí solos: siempre hace falta `observaciones`. Los permisos viajan al cliente en el mismo objeto que los demás (`checkSession` / `login`).
**Hay que agregar las tres columnas a la hoja `Usuarios` a mano** (la lectura sigue funcionando sin ellas: todos en `false`, nadie ve la tarjeta). Cambios de permiso: hasta 5 minutos (cache de usuario, como el resto).
**Frontend (futuro, NO en E5-1):** `js/app.js` tiene los permisos por defecto en **dos lugares** (inicio y logout; un test de wiring los vigila) y tendrán que incluir los tres; los JS nuevos van a `SHELL_FILES` de `sw.js`.

## Privacidad
- El backend decide qué devuelve. **Anulada:** con `observaciones_anular`, el texto original (auditoría); **sin** él, `texto: null` (la clave está siempre) y sí puede recibir quién y cuándo anuló y el motivo.
- Al cliente nunca viaja el **email**, la **secuencia** (solo el cursor, aparte), el `clientRequestId` ni datos técnicos. Autor = solo `nombre`; si falta o parece un email, la etiqueta neutra **«Usuario»** (la misma que Evaluaciones de reemplazo).
- Un permiso o un campo que mande el cliente en el cuerpo (`moderador`, `email`, `permisos`) se **ignora**: lo único que decide es la sesión.
- Texto libre: puede traer datos personales; la UI deberá avisarlo y la anulación permite retirarlo de la vista. Vista pública futura: whitelist de campos y fail-closed, sin autor; no se implementa.

## Endpoint de lectura: `getObservacionesPozo`
Entrada: `wellId`, `limit?`, `antesDeSecuencia?`. Orden de chequeos: sesión → formato de `wellId` (`DD-PPPP`, depto 01–19) → permiso `observaciones` → contenido.
```
{ wellId, total, activas, anuladas, hayMas, cursor,
  observaciones: [ { observacionId, wellId, estado: 'ACTIVA'|'ANULADA', texto|null, categoria|null,
                     nombre, timestamp, anulacion: null | { nombre, timestamp, motivo|null } } ] }
```
- `total` / `activas` / `anuladas` son **globales del pozo**, no de la página: salen de los mismos eventos que hay que leer para derivar los estados, sin una lectura extra. **Cuentan solo las observaciones derivadas sin ambigüedad y retornables**: las ocultas por inconsistencia no suman a los totales (el payload no trae un contador de inconsistencias; el diagnóstico va a Logger).
- **Orden:** más reciente primero (por `secuencia`, no por fecha). `limit`: 50 por defecto, **máximo 100** (por encima se acota a 100); un `limit` que no es un entero ≥ 1 → `INVALID_LIMIT`. **Cursor por `secuencia`** (no hay offset): `antesDeSecuencia` entero ≥ 1 (si no, `INVALID_CURSOR`); `cursor` = la secuencia a pasar en la página siguiente, o `null` si no hay más. Es **estable**: una observación nueva tiene una secuencia mayor, así que no entra en una página ya pedida ni la desplaza; una anulación solo cambia el estado de un ítem, nunca repite ni salta. Cada observación devuelta tiene una secuencia **inequívoca** (las ambiguas ya salieron), así que el cursor estricto nunca repite ni pierde observaciones sanas, ni siquiera alrededor de una secuencia corrupta.
- **No verifica existencia** del pozo: sin filas devuelve una lista vacía (leer no es un oráculo de existencia). Una lectura OK no escribe en `Historial`; errores sí (`PERMISSION_DENIED`, `INVALID_*`, `SERVICE_UNAVAILABLE`).
- **Hoja ausente o con esquema inesperado:** `SERVICE_UNAVAILABLE`, sin crear ni reparar nada.

## Lectura y performance
Apps Script cobra por **llamada** a Sheets y por **volumen leído**; el texto es lo pesado. Estrategia (`ObservacionesPozoRepository.js`):
- **Hoja chica** (hasta 2000 filas de datos): **una** lectura de todo el rango y se filtra en memoria.
- **Hoja grande:** **una** lectura de las **3 columnas de identidad** (`observacionId`, `evento`, `wellId`) de todas las filas —sin los textos—, se eligen las filas del pozo (más toda ANULADA que referencie una alta del pozo) y se leen **solo esas filas** en **a lo sumo 5 rangos** (las filas separadas por hasta 40 filas se unen; si aun así hay más de 5, se unen los huecos más chicos). Cada fila leída se verifica contra la identidad vista (la hoja es append-only: si alguien la reordenó, un reintento y después error; nunca datos mezclados).
- **Sin N+1:** llamadas acotadas (encabezado + identidad + ≤ 5 rangos).
- Complejidad: **1.000 filas** → una lectura de ~11.000 celdas. **100.000 filas** → una lectura de 300.000 celdas (en vez de 1.100.000 con todos los textos) y unas pocas filas más. Crece con las filas totales solo en la lectura de identidad y con los eventos **del propio pozo** en lo demás. Peor caso: eventos del pozo repartidos por toda la hoja → los rangos se unen y se lee algo de más (acotado). Sin cache en E5-1: se mide primero.

## Existencia del pozo
- **Lectura:** no verifica nada.
- **Escritura (E5-2):** usa `pozoExistenciaService_verificar` (el existente, fail-closed; padrón, ITF, NE o corrección previa). No se duplica su lógica.
- **Las observaciones NO son evidencia de existencia:** no se agrega una fuente `OBSERVACION_PREVIA` a ese servicio. Una observación ya escrita se sigue leyendo aunque la fuente de existencia del pozo desaparezca.

## Limitación documentada: roles «solo observaciones»
El hub solo ofrecerá la tarjeta si **otro** módulo (perfil, datos, ubicación o NE) encuentra el pozo. Por eso, **quien reciba `observaciones` debe tener al menos un permiso de descubrimiento existente** (`perfil`, `datos`, `ubicacion` o `ne`). Un usuario con *únicamente* `observaciones` no podría llegar a un pozo desde el buscador. No se agrega un endpoint `existe` ni se toca el buscador / hub en E5-1.

## Setup de la hoja (manual, NO ejecutado todavía)
`setupObservacionesPozoSheet()` (en el editor de Apps Script): crea la hoja con sus 11 encabezados y la fila congelada si no existe; si existe solo la **valida** (no toca ninguna fila ni el encabezado) y falla si el esquema no es el esperado. **Ninguna lectura la llama**: una hoja ausente es un error controlado, no se autocrea.

## Alta: `agregarObservacionPozo` (E5-2)
Entrada: `wellId`, `texto`, `clientRequestId` y (técnicamente) `categoria`. **Solo** esos cuatro campos cuentan; cualquier otro (`email`, `nombre`, `observacionId`, `secuencia`, `timestamp`, `estado`, `motivo`…) se **ignora**: los genera el servidor o salen de la sesión.

**Orden de chequeos:** sesión → formato del `wellId` → permisos → texto / categoría / `clientRequestId` → camino rápido de idempotencia → **existencia** del pozo → lock { idempotencia otra vez → secuencia → escritura }.

### Permisos
`observaciones` **y** `observaciones_agregar`, ambos exactos (`=== true`, fail-closed). Ninguno sustituye al otro y `observaciones_anular` **no** reemplaza a `observaciones_agregar`. Una columna ausente en `Usuarios` es `false`. Los permisos existentes no cambiaron.

### Texto: normalización y validación (regla exacta)
1. Saltos de línea: CRLF, CR suelto, NEL (U+0085), LS (U+2028) y PS (U+2029) → `\n`.
2. El tabulador → **un espacio** (no se borra: no se pegan palabras).
3. Se **eliminan**: los controles C0 salvo `\n` (U+0000–0008, 000B, 000C, 000E–001F), DEL y los C1 (U+007F–0084, 0086–009F), los controles direccionales explícitos (U+202A–202E, U+2066–2069), el BOM (U+FEFF) y los *surrogates* sueltos (UTF-16 inválido).
4. Trim de los extremos. **No** se colapsan espacios internos ni líneas en blanco.
- Se **conservan**: Unicode, emoji (incluidos los compuestos con ZWJ), acentos, otros alfabetos, las marcas de dirección RTL (U+200E / U+200F), espacio de no separación.
- **Largo:** de **3 a 1000** *caracteres únicos* (code points: un emoji cuenta 1), medido **después** de normalizar. Un texto que queda de menos de 3 tras normalizar (por ejemplo, solo controles) es inválido.
- **Errores:** `INVALID_TEXTO` (ausente, `null`, no es un string, vacío, solo espacios / controles, menos de 3, más de 1000). El mensaje **nunca repite el contenido**.
- **Se guarda como texto plano.** Un texto que empiece con `=`, `+`, `-` o `@` queda como texto: la fila se escribe con formato de texto plano (`@`) **antes** de los valores (en todas las columnas menos `secuencia`, que es `0`), nunca como fórmula.

### Categoría (MVP)
Ausente, `null`, `""` o solo espacios (se normaliza a vacío, igual que el trim de los otros campos) → se guarda **vacía**. **Cualquier otro valor** (un texto, un número, `0`, `false`, un objeto, una lista) → **`INVALID_CATEGORIA`**: no se ignora ni se coacciona. Sin catálogo. La respuesta trae `categoria: null`.

### Existencia del pozo
`pozoExistenciaService_verificar(wellId)` (el servicio de E4; no se duplica su lógica): padrón, ITF, NE o corrección previa de ubicación. **Las observaciones no son evidencia.** `existe` → se sigue; ninguna fuente lo conoce → **`WELL_NOT_FOUND`**; no se pudo verificar y ninguna confirmó → **`SERVICE_UNAVAILABLE`**; en ambos casos **no se escribe nada**. Con una entrada inválida no se consulta (primero lo barato) y un **reenvío idempotente tampoco vuelve a verificar** (aunque la fuente haya desaparecido).

### Idempotencia
Por `(usuario normalizado, clientRequestId)`, con el patrón `^[A-Za-z0-9_-]{8,64}$` (`INVALID_CLIENT_REQUEST_ID`). El id es **por usuario**: otro usuario con el mismo id crea la suya. El usuario se compara en minúscula y sin espacios; el id distingue mayúsculas.
- **Mismo contenido** = mismo `wellId`, **mismo texto ya normalizado** y misma categoría (la fecha y la secuencia no cuentan): se devuelve la observación **ya creada** con `duplicada: true`; **no** se escribe otra fila, **no** se consume secuencia y **no** se vuelve a escribir en `Historial`. La observación devuelta es la de hoy según el modelo de lectura.
- **Otro contenido** (otro texto, otro `wellId`…) → `IDEMPOTENCY_CONFLICT`. Un id ya usado por **otro tipo de evento** (p. ej. una anulación) también.
- **Hoja inconsistente:** el id figura más de una vez para el usuario, o la observación existente es ambigua para el modelo de lectura → `INCONSISTENT_STATE` (no se elige ni se escribe nada).
- Un reintento tras un fallo **antes** de guardar crea la observación; tras un fallo **después** de guardar (p. ej. un error al confirmar) encuentra la fila y responde `duplicada: true`.

### Lock y secuencia global
Toda escritura ocurre bajo el lock de script (`waitLock` de 10 s; se libera siempre, también ante un error). **Orden dentro del lock** (la idempotencia va **antes** que la integridad):
1. se **vuelve a comprobar** la idempotencia: si `(usuario, clientRequestId)` ya identifica **inequívocamente** una `ALTA` con el mismo contenido, se devuelve (`duplicada: true`) y **no se escribe ni se consume secuencia**, aunque la hoja tenga una corrupción no relacionada aparecida después (si el propio `clientRequestId` es ambiguo → `INCONSISTENT_STATE`);
2. **solo si hace falta una NUEVA escritura** se valida la integridad global de las secuencias;
3. `máx + 1`;
4. se escribe **una única** fila `ALTA` (`setValues` de una fila).
Si la repetición involucra a la **propia** observación del reintento, el modelo de lectura la oculta por ambigua y por eso no se devuelve (`INCONSISTENT_STATE`): la privacidad manda.
- `secuencia` = **máx + 1**: entero ≥ 1, global y estrictamente creciente. No se usa la fecha ni la cantidad de filas.
- **Falla cerrado ante una hoja estructuralmente corrupta.** `secuencia` es un invariante (orden global, cursor de paginación: un entero único y monótono). Si alguna fila tiene una secuencia **ilegible** (vacía con `observacionId`, texto, no numérica), **≤ 0**, **fraccionaria**, **sin `observacionId`** o **repetida** (dos eventos distintos con la misma secuencia, sean `ALTA` o `ANULADA`, de la misma observación o de pozos distintos), una NUEVA escritura da `SERVICE_UNAVAILABLE` y **no se escribe nada**, ni se consume secuencia. **No** se renumera, **no** se repara, **no** se elige una de las repetidas y **no** se sigue escribiendo sobre la corrupción. La detección no cuesta otra lectura: ya se recorren todas las secuencias para calcular el máximo. Sin corrupción: `máx + 1`. El mensaje técnico nombra solo números de fila y de secuencia (nunca contenido) y va a Logger; la respuesta es el mensaje fijo de siempre.
- **Hoja ausente o con el esquema mal** (falta o repite una columna) → `SERVICE_UNAVAILABLE`. **Nunca se autocrea** (el setup sigue siendo manual).

### La fila escrita
`observacionId` (UUID del servidor), `evento = ALTA`, `wellId`, `texto` normalizado, `categoria = ""`, `motivo = ""`, `email` (de la sesión, normalizado), `nombre` (de la sesión), `timestampUtc` (ISO UTC del servidor, como texto), `secuencia`, `clientRequestId`. El cliente no elige ninguno.

### Historial
Alta exitosa: **una** fila con acción `agregarObservacionPozo` + `wellId` + `OK`. **Nunca** el texto, el `clientRequestId` ni el `observacionId` (el resultado de `Historial` es un código). La **duplicada** idempotente **no** escribe otra. Errores: una fila por intento con su código (`INVALID_TEXTO`, `INVALID_CATEGORIA`, `WELL_NOT_FOUND`, `PERMISSION_DENIED`, `IDEMPOTENCY_CONFLICT`, `SERVICE_UNAVAILABLE`…), como el resto del repo.

### Respuesta
```
{ wellId, duplicada, observacion: { observacionId, wellId, estado: 'ACTIVA', texto, categoria: null, nombre, timestamp, anulacion: null } }
```
Mismo contrato que la lectura: **sin email, sin `clientRequestId` y sin `secuencia`**. Si falta el nombre del autor, «Usuario».

### Errores
| Código | Cuándo |
|---|---|
| `UNAUTHORIZED` / `USER_DISABLED` / `PERMISSION_DENIED` | sesión inválida / usuario inactivo / falta alguno de los dos permisos |
| `INVALID_WELL_ID` | formato del pozo |
| `INVALID_TEXTO` / `INVALID_CATEGORIA` / `INVALID_CLIENT_REQUEST_ID` | entrada inválida |
| `WELL_NOT_FOUND` | ninguna fuente conoce el pozo |
| `IDEMPOTENCY_CONFLICT` | `clientRequestId` ya usado con otro contenido (o por otro tipo de evento) |
| `INCONSISTENT_STATE` | hoja con un id repetido o una observación existente ambigua: requiere revisión manual |
| `SERVICE_UNAVAILABLE` | no se pudo verificar la existencia, la hoja falta o está mal, la secuencia no se puede calcular o falló la escritura. Mensaje fijo, sin detalle técnico |

### Privacidad
La respuesta nunca trae el email; **ni `Logger`, ni `Historial`, ni ningún mensaje de error recibe el texto** de la observación (los fallos internos devuelven un mensaje fijo y el detalle técnico va a `Logger`, recortado y sin el contenido).

### Concurrencia
Cubierta intercalando otra ejecución justo al tomar el lock: dos altas distintas simultáneas → secuencias distintas; el mismo `clientRequestId` simultáneo → **una sola fila** (la segunda recibe `duplicada: true`, un solo `Historial`); dos usuarios con el mismo id → cada uno crea la suya; mismo usuario y mismo id con otro texto → conflicto; muchas escrituras intercaladas → secuencias únicas, consecutivas y crecientes.

No hay edición ni corrección de observaciones (la anulación está en la sección siguiente).

## Anulación: `anularObservacionPozo` (E5-3)
Agrega **una fila `ANULADA`** que referencia la observación: no borra ni edita nada (la `ALTA` original se conserva para la auditoría). Acción por `doPost`; el cliente manda **solo** `observacionId`, `motivo` y `clientRequestId`. **No** acepta `wellId`, autor, estado ni texto: el pozo sale de la `ALTA` original, el autor y la fecha, de la sesión y del servidor.

### Orden de chequeos
1. sesión;
2. `observaciones` **y** (`observaciones_agregar` **o** `observaciones_anular`); si no → `PERMISSION_DENIED` **sin consultar el `observacionId`** (ni leer la hoja);
3. contenido (`observacionId`, `motivo`, `clientRequestId`: solo formato);
4. observación objetivo y **autorización fina** (ver «Sin oráculo de observacionId»);
5. idempotencia → transición → lock `{ repetir todo, integridad de secuencias, máx + 1, una fila }`.
Los permisos se evalúan **siempre antes** de resolver un reintento y con los permisos **de hoy**.

### Permisos y propiedad (fail-closed, todo `=== true`)
| Quién | Condición |
|---|---|
| Autor | `observaciones` + `observaciones_agregar` **y** el email normalizado de la sesión == el email normalizado guardado en la `ALTA` → anula **la propia** |
| Moderador | `observaciones` + `observaciones_anular` → anula la de **cualquier autor**, incluso si el email histórico es inválido (la observación se deriva igual) |
| `observaciones_anular` sin `observaciones` | **no alcanza** |
| `observaciones_agregar` sin `observaciones` | **no alcanza** |
| Solo `observaciones` | no anula nada |

- La propiedad se decide **solo por el email normalizado** (minúsculas, sin espacios). El `nombre` **nunca** cuenta. Si el email de la `ALTA` (o el de la sesión) falta o no tiene forma de email, **no** se afirma que es propia.
- Un valor truthy que no sea el booleano (`1`, `"SI"`, `"true"`…) no habilita nada.

### Motivo
Obligatorio. Misma normalización que el texto (CRLF/NEL/LS/PS → `\n`, tabulador → espacio, sin controles ni sustitutos huérfanos, `trim` de extremos; no se colapsan espacios internos ni saltos de línea). **3 a 300 caracteres únicos** (un emoji cuenta 1). Error `INVALID_MOTIVO`, sin repetir el contenido. Se guarda como texto plano (una fórmula no se evalúa).

### Observación objetivo
Se busca por `observacionId` (columna completa y después solo las filas que coinciden; tope de 10 filas por id). Debe existir, ser inequívoca, derivable y no estar anulada. Lo que ve cada rol:
| Situación | Moderador (`observaciones_anular`) | Autor (solo `observaciones_agregar`) |
|---|---|---|
| ninguna `ALTA` con ese id (una `ANULADA` huérfana **no** es una observación) | `OBSERVACION_NOT_FOUND` | `PERMISSION_DENIED` |
| varias `ALTA`, demasiadas filas, `wellId` ilegible, o no derivable (identidad o secuencia duplicadas, contenido inválido) | `INCONSISTENT_STATE` (no se escribe) | `PERMISSION_DENIED` |
| ajena, o email histórico vacío / sin forma de email (propiedad no verificable) | puede anular | `PERMISSION_DENIED` |
| propia e inequívoca ya anulada (cualquier `ANULADA` que la referencie, aunque su fila esté rota: se prefiere **no** escribir de nuevo) | `INVALID_TRANSITION` — salvo el reintento de esa misma anulación | `INVALID_TRANSITION` (es suya) |

**No** se llama a `PozoExistenciaService`: la `ALTA` es la autoridad del `wellId`. Una observación existente se puede anular aunque el pozo ya no figure en ninguna fuente (hay test).

### Sin oráculo de observacionId
Quien **no es moderador** no puede usar el endpoint para averiguar qué UUID existen: el backend resuelve el objetivo internamente para comprobar la propiedad, pero hacia afuera todo lo que no sea «propia e inequívoca» (inexistente, ajena, email histórico no verificable, ambigua o no derivable, incluso ajena ya anulada) es **el mismo `PERMISSION_DENIED` con el mismo mensaje** (fail-closed). La causa técnica va a `Logger` como etiqueta fija (`NO_ENCONTRADA`, `AJENA`, `PROPIEDAD_NO_VERIFICABLE`, `NO_DERIVABLE`), sin texto, motivo, email, nombre ni ids. El `Historial` interno sí registra el `wellId` cuando se conocía. El moderador sí distingue esos estados (puede administrar cualquier observación). Un autor solo ve `INVALID_TRANSITION`, `IDEMPOTENCY_CONFLICT` o `INCONSISTENT_STATE` (de su propio `clientRequestId`) **después** de haber probado que la observación es suya.

### Idempotencia
El `clientRequestId` comparte el **espacio por usuario** con la `ALTA` (regex `^[A-Za-z0-9_-]{8,64}$`):
- mismo usuario + mismo id + misma intención (mismo `observacionId`, mismo motivo normalizado, `ANULADA`) → `duplicada: true`, **sin segunda fila, sin nueva secuencia, sin segundo `Historial`**;
- mismo id usado antes para una `ALTA`, para otra observación o con otro motivo → `IDEMPOTENCY_CONFLICT`;
- el mismo id en más de una fila del usuario → `INCONSISTENT_STATE`;
- otro usuario con el mismo id es independiente.

### El reintento aplica los permisos ACTUALES
La idempotencia **nunca** es un bypass: el reintento pasa por la misma autorización con los permisos de hoy (sin permiso → `PERMISSION_DENIED` aunque la anulación ya exista) y el payload se **reconstruye** (quien perdió `observaciones_anular` recibe `texto: null` aunque su primera respuesta trajera el texto, y al revés). Un moderador que pierde `observaciones_anular` pero conserva `observaciones_agregar` se resuelve como autor: sobre una observación **ajena** el reintento da `PERMISSION_DENIED`; sobre una **propia** sigue valiendo (sin el texto original).

### Secuencia, lock e integridad
Igual que E5-2, dentro del lock: (1) permisos validados afuera; (2) se **vuelve a resolver** objetivo, autorización e idempotencia; (3) un reintento válido se devuelve **sin escribir**; (4) solo si hay que escribir, se valida la integridad **global** de las secuencias (ilegible, ≤ 0, fraccionaria, repetida → `SERVICE_UNAVAILABLE`, sin escribir ni reparar); (5) `máx + 1`; (6) **una sola** fila `ANULADA`. La escritura y el cálculo de la secuencia son compartidos con la alta (`observacionesPozoRepository_escribirEvento`).

### La fila `ANULADA`
`observacionId` = el de la `ALTA` · `evento` = `ANULADA` · `wellId` copiado **por el servidor** de la `ALTA` · `texto` = vacío · `categoria` = vacío · `motivo` = motivo normalizado · `email` / `nombre` = sesión · `timestampUtc` = servidor · `secuencia` = siguiente global · `clientRequestId`. **Nunca** se copia el texto original a la anulación.

### Respuesta y privacidad
`{wellId, duplicada, observacion}` con la observación en el **mismo contrato que la lectura** (E5-1): `{observacionId, wellId, estado: "ANULADA", texto, categoria: null, nombre, timestamp, anulacion: {nombre, timestamp, motivo}}`. Sin email, `clientRequestId` ni `secuencia`. El texto original solo con `observaciones_anular`; **sin él, `texto: null` incluso para el autor** de su propia observación (no hay excepción por autoría).

### Historial y Logger
Una fila `anularObservacionPozo` con el `wellId` derivado de la `ALTA` y `OK` por anulación creada; **nunca** el motivo, el texto, el `observacionId` ni el `clientRequestId`. El reintento idempotente no escribe otra. Los errores siguen el patrón con su código (con el `wellId` solo si ya se conocía por la `ALTA`). `Logger` recibe únicamente ids / filas / secuencias del detalle técnico, nunca texto, motivo, email ni nombre; el mensaje al cliente es fijo.

### Errores
`INVALID_OBSERVACION_ID` · `INVALID_MOTIVO` · `INVALID_CLIENT_REQUEST_ID` · `PERMISSION_DENIED` · `OBSERVACION_NOT_FOUND` · `INVALID_TRANSITION` · `IDEMPOTENCY_CONFLICT` · `INCONSISTENT_STATE` · `SERVICE_UNAVAILABLE` · `UNAUTHORIZED` / `USER_DISABLED`.

### Concurrencia
Cubierta intercalando otra ejecución justo al tomar el lock: autor vs. moderador y dos moderadores sobre la misma observación → una sola `ANULADA`, la otra relee dentro del lock y falla con `INVALID_TRANSITION`; el mismo `clientRequestId` simultáneo → una fila y `duplicada: true`; dos `clientRequestId` distintos → el segundo `INVALID_TRANSITION`; una alta de otra observación intercalada → secuencias únicas y consecutivas; un objetivo que se vuelve ambiguo o una corrupción que aparece mientras se espera el lock → no se escribe.

## Frontend de lectura (E5-4)
Solo **leer**: tarjeta en el hub, pantalla propia y listado paginado. El alta se describe en la sección siguiente (E5-5); la anulación (E5-6) todavía no existe.

### Archivos
`js/observacionesPozoLogic.js` (lógica pura, con tests), `js/observacionesPozo.js` (controlador DOM), `apiGetObservacionesPozo` en `js/api.js`, la pantalla `#screen-observaciones` en `index.html`, estilos `.obs-*` en `css/styles.css`, cableado en `js/app.js` (solo hub / navegación) y los dos JS nuevos en `SHELL_FILES` de `sw.js`. Orden de scripts: `reemplazoLogic.js` (helper de fecha) → `observacionesPozoLogic.js` → `observacionesPozo.js` → `app.js`.

### Tarjeta y permisos
- Tarjeta «Observaciones» («Contexto y novedades del pozo») **solo** con `permisosActuales.observaciones === true` (el booleano exacto; `"SI"`, `1`, truthy o un permiso ausente de un backend viejo **no** cuentan) y sobre un pozo que algún módulo del hub ya encontró.
- Sin llamada extra al backend para decidir mostrarla, sin carga desde el hub, sin contador ni badge.
- Los defaults de permisos del frontend incluyen `observaciones`, `observaciones_agregar` y `observaciones_anular` en `false` (estado inicial y cierre de sesión).
- Sin soporte especial para el rol «solo observaciones» (ver la limitación documentada arriba): no hay endpoint de existencia, búsqueda propia ni lookup adicional.

### Pantalla y carga
`getObservacionesPozo` se llama **solo al abrir la pantalla** (nunca en la búsqueda ni en el hub): «Cargando…» → primera página (`limit` 50) → render. Volver regresa al hub del **mismo pozo** (`pozoActual` no cambia, sin búsqueda nueva) y descarta todo lo cargado: al reabrir se piden **datos frescos**; no hay cache. Cerrar sesión descarta también las respuestas en vuelo.

### Render
- **Activa:** texto, `nombre · fecha dd/mm/aaaa hh:mm` (hora de Mendoza, mismo helper que Reemplazo) y la categoría solo si algún día viene definida.
- **Anulada:** «Observación anulada» (con borde punteado, es una anulación deliberada, no un error), quién la escribió y cuándo, **quién anuló, cuándo** y el **motivo** si viene. Si el backend mandó `texto: null` no se intenta recuperar ni se dice «texto oculto». Si el backend mandó el texto (`observaciones_anular`) se muestra **subordinado** (más chico, apagado, en cursiva) debajo del título; el frontend **no** infiere permisos para decidirlo: renderiza lo que llega.
- Fecha ausente o inválida: «Fecha no disponible» (en una anulada, la fecha de creación inválida simplemente se omite). Nombre ausente o con forma de email: «Usuario».
- El estado vacío es «Este pozo todavía no tiene observaciones.» (sin error ni controles).

### Privacidad y seguridad
- **Lista blanca:** el modelo de vista solo toma `observacionId` (para no duplicar), estado, texto, nombre, fecha, categoría y anulación; un `email`, `clientRequestId`, `secuencia` o cualquier campo extra del payload se descarta antes de llegar al DOM. El `cursor` de paginación se usa internamente y nunca se muestra.
- Todo texto libre (observación, nombre, motivo, categoría) se pone con `textContent`; el controlador solo crea `li` y `p`; **no** usa `innerHTML` (hay un DOM falso que lanza si alguien lo intenta). Los saltos de línea se conservan por CSS (`white-space: pre-wrap`) y las palabras largas se rompen (`overflow-wrap: anywhere`). Se muestra el texto completo (hasta 1000 caracteres), sin colapsar.
- Nada de esto va a `console`, URL / hash, `localStorage` / `sessionStorage` ni cookies (hay guardas de fuente).
- Una respuesta mal formada, sin la forma esperada o **de otro pozo** es un error genérico y nunca se muestra.

### Paginación
Orden recibido: más reciente primero. Con `hayMas` y un `cursor` válido se ofrece «Ver observaciones anteriores»; pide `antesDeSecuencia = cursor` y **agrega al final** (sin reemplazar la primera página, sin duplicados por `observacionId`). Un segundo toque mientras hay un pedido en vuelo no hace otro. Si falla la página 2 se conserva la página 1 y se muestra un error contextual con el botón disponible para reintentar. Un cursor que no retrocede corta la paginación (sin bucle). Las respuestas de una apertura anterior se descartan.

### Errores
Siempre desde una tabla (`PERMISSION_DENIED`: «No tenés acceso a las observaciones de este pozo.»; `SERVICE_UNAVAILABLE`, `INVALID_LIMIT`, `INVALID_CURSOR`, red y desconocidos: «No se pudieron cargar las observaciones. Intentá nuevamente.»); nunca el `message` técnico del backend. Con un backend viejo (acción desconocida) la pantalla muestra el error controlado y el resto de la app sigue funcionando. `UNAUTHORIZED` / `USER_DISABLED` cierran la sesión como en los demás módulos. Sin acceso o con sesión vencida no se ofrece «Reintentar».

### Service worker
`observacionesPozoLogic.js` y `observacionesPozo.js` están en `SHELL_FILES`; las llamadas a Apps Script siguen sin cachearse (network-first del shell; el API nunca pasa por el cache).

## Frontend: agregar observación (E5-5)
Desde la pantalla Observaciones: botón «Agregar observación», formulario modal, validación, `clientRequestId` por intención, mensaje de éxito, actualización inmediata del listado y reintento seguro. **No** hay anulación todavía (E5-6): no existe el botón ni el wrapper `anularObservacionPozo` en ningún archivo del frontend.

### Botón y permisos
El botón aparece **solo** con `observaciones === true` **y** `observaciones_agregar === true` (ambos booleanos exactos): solo uno de los dos, `"SI"`, `1` o cualquier truthy **no** alcanzan. Solo se ve con la lista cargada (también con el estado vacío). El backend sigue siendo la autoridad: se vuelve a validar al abrir el formulario y al guardar (sin permiso no se hace ningún pedido).

### API
`apiAgregarObservacionPozo(sessionToken, wellId, texto, clientRequestId)`: POST `text/plain` como el resto. Lista blanca: **no** viaja categoría, email, nombre, fecha, `observacionId`, secuencia ni permisos.

### Formulario
Modal (hoja inferior en celular, centrado en pantallas grandes; fuera de `#screen-observaciones`): título, `label` asociado a un único `textarea` («Observación», sin `maxlength`: contaría unidades UTF-16 y cortaría emoji), la ayuda «No incluyas datos personales innecesarios.», el contador `n / 1000`, un error con `role="alert"` asociado al campo (`aria-describedby`, `aria-invalid`), **Cancelar** y **Guardar** (deshabilitado de verdad si el texto es inválido o se está guardando). Foco al `textarea` al abrir; al cerrar vuelve al botón que lo abrió; Escape cancela; Tab rota dentro del modal; el fondo no se desplaza. El estado «Guardando…» bloquea Guardar, Cancelar, × y el campo (no hay doble submit: una sola request). El `submit` siempre hace `preventDefault`.

### Normalización y contador
El frontend **replica la regla del backend** (`normalizarTexto`: saltos de línea CRLF/CR/NEL/LS/PS → `\n`, tabulador → espacio, se eliminan controles incompatibles, bidireccionales explícitos, BOM y surrogates sueltos, `trim` de los extremos; no se colapsan espacios ni líneas en blanco) y mide el largo en **code points** (`Array.from`, un emoji cuenta 1): mínimo 3, máximo 1000. Un test de **paridad** compara 6000 cadenas generadas con los caracteres problemáticos contra el backend real. Se envía el texto **ya normalizado** (el backend vuelve a normalizar: es idempotente y sigue siendo la autoridad). Diferencia con el backend: los surrogates sueltos se quitan con un bucle y no con una regex con lookbehind (que es un error de sintaxis en Safari < 16.4 y rompería todo el script). El contador pasa a decir «1003 / 1000 · te pasaste por 3» (con palabras, además del color y de `aria-invalid`).

### clientRequestId: una intención de alta
`^[A-Za-z0-9_-]{8,64}$` (`obs-` + UUID, con respaldo si no hay `crypto.randomUUID`). Se genera al abrir el formulario y define **una intención** (un texto normalizado que se quiere guardar una vez):
| Situación | Id |
|---|---|
| abrir el formulario / cancelar y reabrir / tras un éxito la próxima alta | **nuevo** |
| editar antes del primer envío | el mismo |
| reintentar el **mismo** texto (red caída, error del servidor, definitivo o incierto) | el **mismo** (si la primera vez llegó a escribir, el backend devuelve esa observación con `duplicada: true`) |
| ya hubo un intento y el texto **normalizado** cambió | **nuevo**, antes de enviar (reusarlo daría `IDEMPOTENCY_CONFLICT`) |
| cambios que el backend normaliza igual (espacios de los extremos, CRLF) | el mismo |
| tras `IDEMPOTENCY_CONFLICT` o `INVALID_CLIENT_REQUEST_ID` (el id quedó asociado a otro contenido / fue rechazado antes de escribir) | **nuevo en el siguiente envío del usuario** (nunca se reenvía solo ni en bucle) |

### Respuesta y lista
`duplicada: false` y `true` son **ambos éxito** («Observación agregada.», sin mostrar «duplicada»): la observación devuelta pasa por la lista blanca de E5-4 y entra **arriba** de lo ya cargado, **sin recargar**: dedupe por `observacionId`, el estado vacío desaparece, suma al total, **no toca el cursor** (sigue apuntando a las anteriores) ni el botón «Ver observaciones anteriores». Después se cierra el formulario. **No** hay alta optimista: nada se agrega antes de la respuesta.

**Deuda menor (decisión MVP):** si el backend devuelve una observación con `duplicada: true` que **no** estaba en las páginas ya cargadas (p. ej. un reintento tardío), se inserta **arriba**; el frontend no conoce su `secuencia` y no intenta reconstruir su posición cronológica. Al volver a abrir la pantalla, la lectura del backend restaura el orden real. Una respuesta sin la forma esperada, de otro pozo o cuya observación no es una `ACTIVA` mostrable se trata como error (texto e id se conservan: el reintento es idempotente).

### Frescura (respuestas viejas)
Si la respuesta de un alta llega **después de** salir de la pantalla, cerrar sesión o abrir otro pozo, **no se aplica** a la UI (ni éxito ni error ni cierre de sesión): la escritura pudo ocurrir en el backend, pero la interfaz descarta el resultado de un contexto que ya no es ese. Al volver a abrir la pantalla se piden datos frescos y esa observación aparece. Mientras se guarda, Cancelar y Escape no cierran el formulario.

### Errores
Siempre desde una tabla; nunca el `message` técnico; el texto del formulario **siempre se conserva**:
`INVALID_TEXTO` → «La observación debe tener entre 3 y 1000 caracteres.» junto al campo (con foco al campo y `aria-invalid`); `WELL_NOT_FOUND` → «No se pudo confirmar que este pozo exista en las fuentes disponibles.»; `SERVICE_UNAVAILABLE`, red, `INVALID_CATEGORIA`, `INVALID_CLIENT_REQUEST_ID`, `INCONSISTENT_STATE` y desconocidos → «No se pudo guardar la observación. Intentá nuevamente.»; `IDEMPOTENCY_CONFLICT` → «La observación cambió después de un intento anterior. Revisá el texto e intentá nuevamente.»; `PERMISSION_DENIED` → sin permiso; `UNAUTHORIZED` / `USER_DISABLED` → el flujo global de sesión.

### Privacidad
El texto nunca va a `console`, URL / hash, `localStorage` / `sessionStorage` ni cookies, y no se usa `innerHTML` (el DOM falso de los tests lanza si alguien lo intenta); el textarea se maneja con `.value` y la observación guardada se renderiza por el pipeline seguro de E5-4 (`textContent`).

## Alcance
| Etapa | Contenido | Estado |
|---|---|---|
| **E5-1** | modelo + hoja + permisos + derivación + `getObservacionesPozo` (lectura, paginada) | **commiteada en local (sin publicar)** |
| **E5-2** | `agregarObservacionPozo`: existencia, idempotencia, lock, secuencia, `Historial`, validación de texto y categoría | **implementada (sin publicar)** |
| **E5-3** | `anularObservacionPozo` (propia / cualquiera según permiso, motivo obligatorio, idempotente, sin verificar existencia) | **implementada (sin publicar)** |
| **E5-4** | frontend de lectura: tarjeta en el hub, pantalla, listado paginado, render de activas / anuladas | **implementada (sin publicar)** |
| **E5-5** | frontend: agregar observación (botón, formulario, `clientRequestId` por intención, actualización inmediata de la lista) | **implementada (sin publicar)** |
| E5-6 | frontend: anulación | pendiente |
| E5-7 | publicación (**backend primero**, luego el frontend) y smoke real | pendiente |

**Fuera de alcance de E5-1 a E5-3:** edición, reemplazo automático, frontend, tarjeta, modal, categorías funcionales, adjuntos, offline, cache, vista pública y cualquier cambio de mapa / reemplazo / ubicación / fotos / ITF / NE.

## Tests
`backend/test/ObservacionesPozoAlta.test.js` (normalización y validación del texto, categoría y `clientRequestId`; cálculo fail-closed de la secuencia; búsqueda por `clientRequestId`; la fila escrita y el formato de texto plano) y `ApiAgregarObservacionPozo.test.js` (de punta a punta: permisos, existencia, texto, categoría, idempotencia, lock y secuencia, concurrencia, fórmulas, Historial, privacidad y lectura posterior).
`backend/test/ObservacionesPozoRepository.test.js` (esquema, hoja ausente / mal formada, setup, selección de filas, plan de lectura, llamadas y celdas leídas con hojas de 2.500 y 100.000 filas), `ObservacionesPozoService.test.js` (derivación, propiedades con datos aleatorios, privacidad, paginación), `ApiObservacionesPozo.test.js` (permisos, orden de chequeos, sin existencia, contrato, hoja ausente) y `ObservacionesPozoPermisos.test.js` (columnas de `Usuarios`, fail-closed, compatibilidad). Se ajustaron `SheetUserRepository.test.js` y `AuthService.test.js` a los 12 permisos.

`backend/test/ObservacionesPozoAnulacion.test.js` (E5-3, unidades: validación de la entrada, propiedad por email normalizado, matriz pura de permisos, búsqueda por `observacionId`, fila `ANULADA`, decisión) y `ApiAnularObservacionPozo.test.js` (E5-3, de punta a punta por `doPost`: permisos y propiedad, motivo, observación objetivo, no consulta de existencia, privacidad, `Historial` / `Logger`, idempotencia compartida con la alta, reintento con permisos actuales, secuencia e integridad, concurrencia y guardas del código).

Frontend (E5-4): `js/observacionesPozoLogic.test.js` (permisos fail-closed, vista de activa / anulada, privacidad por lista blanca, respuestas mal formadas, fechas y el cargador paginado: primera página, anteriores, sin duplicados, doble toque, error de la página 2, reabrir, respuestas viejas, sesión vencida), `observacionesPozoController.test.js` (el controlador ejecutado con un DOM falso que lanza ante `innerHTML`: activa, anulada con y sin texto, vacío, errores, paginación, XSS y privacidad del payload) y `observacionesPozoWiring.test.js` (HTML, hub, navegación, defaults de permisos, API, service worker, CSS responsive y guardas de fuente).

Alta en el frontend (E5-5): `js/observacionesPozoAlta.test.js` (permiso exacto, normalización con **paridad contra el backend**, contador por code points, `clientRequestId` por intención A–H, respuestas y errores, descarte de respuestas viejas, inserción arriba de la lista con `agregarNueva`), `observacionesPozoAltaController.test.js` (el controlador con DOM falso: botón y permisos, foco, contador, «Guardando…», doble submit, éxito sin recarga, errores que conservan el texto, paginación abierta, XSS, Escape / Tab, respuestas viejas) y los bloques E5-5 de `observacionesPozoWiring.test.js` (modal accesible, wrapper, CSS responsive).
