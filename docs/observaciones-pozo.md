# Observaciones del pozo (E5)

Estado: **E5-1 implementada en el repo (solo backend de LECTURA), sin publicar.** Alta (E5-2), anulación (E5-3) y todo el frontend (E5-4 a E5-6) quedan para las etapas siguientes.

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
- **Escritura (E5-2):** usará `pozoExistenciaService_verificar` (el existente, fail-closed; padrón, ITF, NE o corrección previa). No se duplica su lógica.
- **Las observaciones NO son evidencia de existencia:** no se agrega una fuente `OBSERVACION_PREVIA` a ese servicio. Una observación ya escrita se sigue leyendo aunque la fuente de existencia del pozo desaparezca.

## Limitación documentada: roles «solo observaciones»
El hub solo ofrecerá la tarjeta si **otro** módulo (perfil, datos, ubicación o NE) encuentra el pozo. Por eso, **quien reciba `observaciones` debe tener al menos un permiso de descubrimiento existente** (`perfil`, `datos`, `ubicacion` o `ne`). Un usuario con *únicamente* `observaciones` no podría llegar a un pozo desde el buscador. No se agrega un endpoint `existe` ni se toca el buscador / hub en E5-1.

## Setup de la hoja (manual, NO ejecutado todavía)
`setupObservacionesPozoSheet()` (en el editor de Apps Script): crea la hoja con sus 11 encabezados y la fila congelada si no existe; si existe solo la **valida** (no toca ninguna fila ni el encabezado) y falla si el esquema no es el esperado. **Ninguna lectura la llama**: una hoja ausente es un error controlado, no se autocrea.

## Decisiones ya cerradas para la escritura (E5-2)
- **Texto:** mínimo **3** caracteres y máximo **1000** (después del trim de los extremos); se **conservan los saltos de línea** (`
` se normaliza a `
`); se **eliminan los demás caracteres de control**. Se guarda como texto plano.
- **Categoría:** en el MVP solo se admite **vacío o `null`**; cualquier categoría no vacía → **`INVALID_CATEGORIA`** (no se ignora en silencio) hasta que exista un catálogo. El servidor escribe la columna vacía.
- Existencia con `pozoExistenciaService_verificar` (fail-closed); idempotencia por `(email, clientRequestId)`; `secuencia` = máx + 1 bajo lock; una fila en `Historial` con acción + `wellId` + resultado (sin texto).

## Alcance
| Etapa | Contenido | Estado |
|---|---|---|
| **E5-1** | modelo + hoja + permisos + derivación + `getObservacionesPozo` (lectura, paginada) | **implementada (sin publicar)** |
| E5-2 | `agregarObservacionPozo`: existencia, idempotencia, lock, `Historial`, validación de texto y categoría (ver abajo) | pendiente |
| E5-3 | `anularObservacionPozo` (propia / cualquiera según permiso, motivo obligatorio) | pendiente |
| E5-4 a E5-6 | frontend: tarjeta y lectura, alta, anulación | pendiente |
| E5-7 | publicación (**backend primero**, luego el frontend) y smoke real | pendiente |

**Fuera de alcance de E5-1:** alta, anulación, idempotencia de escritura, frontend, tarjeta, modal, categorías funcionales, adjuntos, offline, cache, vista pública y cualquier cambio de mapa / reemplazo / ubicación / fotos / ITF / NE.

## Tests
`backend/test/ObservacionesPozoRepository.test.js` (esquema, hoja ausente / mal formada, setup, selección de filas, plan de lectura, llamadas y celdas leídas con hojas de 2.500 y 100.000 filas), `ObservacionesPozoService.test.js` (derivación, propiedades con datos aleatorios, privacidad, paginación), `ApiObservacionesPozo.test.js` (permisos, orden de chequeos, sin existencia, contrato, hoja ausente) y `ObservacionesPozoPermisos.test.js` (columnas de `Usuarios`, fail-closed, compatibilidad). Se ajustaron `SheetUserRepository.test.js` y `AuthService.test.js` a los 12 permisos.
