# Línea de tiempo del pozo (E6)

Estado: **E6-1 (modelo puro) aprobada.** Sin pantalla, sin tarjeta, sin CSS, sin service worker, sin cambios de backend ni de `api.js`. Las etapas siguientes (E6-2 carga por fuente, E6-3 pantalla, E6-4 rollout) no empezaron.

## Propósito
Una vista cronológica única, de lectura, que junta lo que hoy está repartido en cuatro pantallas: ubicación, evaluaciones de reemplazo y observaciones (las fotos quedan afuera en v1, ver abajo). **No agrega datos, hojas, permisos ni endpoints**: se arma en el cliente con las lecturas que ya existen, cada una con su permiso.

## Regla central de privacidad
La línea de tiempo **nunca muestra más que el módulo fuente**. Cada evento se construye con una **lista blanca** a partir del payload ya autorizado de su endpoint: no se copia ningún objeto crudo y se descarta todo lo demás (email, `clientRequestId`, `secuencia`, `sessionToken`, coordenadas, ids de Drive, campos desconocidos). Una observación **anulada** nunca conserva su texto, lo mande o no el payload (el moderador lo recibe; la línea de tiempo es un subconjunto estricto). No se lee ninguna hoja desde el frontend ni hay un endpoint que saltee los servicios actuales.

## Inventario de contratos (verificado contra el código real, no contra los docs)
Los tests de `js/lineaTiempoPozoContrato.test.js` ejecutan los flujos reales (Api → permisos → servicios → repositorios sobre hojas en memoria) y **fijan las claves exactas de cada payload**: si el backend agrega o cambia un campo, fallan.

| | Correcciones de ubicación | Decisiones sobre fuentes | Reemplazo | Observaciones | Fotos |
|---|---|---|---|---|---|
| Endpoint | `getCorreccionesUbicacionPozo` | `getDecisionesFuentesPozo` | `getHistorialReemplazo` | `getObservacionesPozo` | `getFotosPozo` |
| Permiso | `ubicacion` | `ubicacion` | `reemplazo` | `observaciones` | `fotos` |
| Payload | `{wellId, vigente, pendientes[], historial[]}` | `{wellId, version, integro, padronPeriodo, fuentes[], obsoletas[], historial[], resolucion}` | `{wellId, evaluaciones[]}` | `{wellId, total, activas, anuladas, hayMas, cursor, observaciones[]}` | `{entidad, total, fotos[]}` |
| Lo que se usa | `historial[]` (`vigente` y `pendientes` son subconjuntos) | `historial[]` | `evaluaciones[]` | `observaciones[]` | — |
| Id estable | `correccionId` (UUID) | `secuencia` (entera, global y monótona en la hoja) | `evaluacionId` (UUID) | `observacionId` (UUID) | `fotoId` |
| Instante | `timestamp` (propuesta) y `resolucion.timestamp` (último evento) | `timestampUtc` por evento | `timestamp` | `timestamp` y `anulacion.timestamp` | **no hay** (`timestampRegistro` no sale) |
| Formato | ISO 8601 UTC con ms y `Z` (`toISOString`) o `null` | ISO UTC con ms y `Z` (texto), o `''` | ISO UTC con ms y `Z` | ISO UTC con ms y `Z` (texto) | `fechaFotoValor` parcial (`2018`, `2018-06`, `2018-06-14`) con `fechaFotoPrecision` |
| Autor | `nombrePropone`, `resolucion.nombre` | `nombre` | `nombre` (`Usuario` si falta) | `nombre`, `anulacion.nombre` (`Usuario` si falta o trae `@`) | **no hay** |
| Estado | `estado` ∈ PROPUESTA, VALIDADA, RECHAZADA, SUPERADA, REVERTIDA, INCONSISTENTE | por evento: `evento` ∈ ACEPTADA, DESCARTADA, ACEPTACION_QUITADA, RESTAURADA | `estado` ∈ APTO, NO_APTO, DUDOSO | `estado` ∈ ACTIVA, ANULADA | — |
| Texto libre | `observacion`, `resolucion.motivo`, `coordenadaOriginalTexto` | `motivo` | `observacion` | `texto`, `anulacion.motivo` | `observacion` |
| Sensible (no sale al cliente) | emails, `clientRequestId`; sale `propia` (booleano) | emails, `clientRequestId`, `versionVista` | email, `clientRequestId` | email, `clientRequestId`, `secuencia` | email, `timestampRegistro`, sha1, ids de Drive, lote, coordenadas GPS |
| Privacidad por rol | ninguna | ninguna | ninguna | el texto de una ANULADA sale `null` salvo a `observaciones_anular` | — |
| Orden del backend | más reciente primero | `secuencia` ascendente | más reciente primero | `secuencia` descendente (no cronológico) | por fecha de la foto |
| Paginación / límite | ninguna / ninguno | ninguna / ninguno | ninguna / ninguno | cursor `antesDeSecuencia`, `limit` 50 (máx. 100) | ninguna |
| Pozo sin datos | `historial: []` | `historial: []`; **`WELL_NOT_FOUND` si el pozo no está en el padrón** | `evaluaciones: []` | `observaciones: []` | `fotos: []` |
| Error | `PERMISSION_DENIED`, `INVALID_WELL_ID`, `SERVICE_UNAVAILABLE`, sesión | ídem + `WELL_NOT_FOUND` | ídem | ídem + `INVALID_LIMIT`, `INVALID_CURSOR` | ídem |
| ¿Eventos múltiples por item? | **sí, hasta 2**: la propuesta y el último evento. El resto de la cadena se pierde | sí, es un historial real (una fila = un evento) | no: una fila = una evaluación | sí, hasta 2 por observación (alta y anulación) | no |
| ¿El frontend ya normaliza? | parcial (`ubicacionCorreccionLogic`: etiquetas y render del historial) | parcial (`ubicacionOperativaLogic` y `ubicacionesConocidasLogic`) | render inline en `reemplazo.js` | sí (`observacionesPozoLogic`: lista blanca del módulo) | `fotosPozosLogic` |

## Eventos que se pueden demostrar (catálogo v1)
| Fuente | Tipo | De dónde sale | Instante |
|---|---|---|---|
| UBICACION | `UBICACION_PROPUESTA` | toda corrección | `timestamp` |
| UBICACION | `UBICACION_VALIDADA` / `_RECHAZADA` / `_SUPERADA` / `_REVERTIDA` | `resolucion.evento` (== `estado`) | `resolucion.timestamp` |
| UBICACION | `FUENTE_ACEPTADA` / `_DESCARTADA` / `_ACEPTACION_QUITADA` / `_RESTAURADA` | cada item de `historial[]` de decisiones | `timestampUtc` |
| REEMPLAZO | `REEMPLAZO_APTO` / `_NO_APTO` / `_DUDOSO` | cada evaluación | `timestamp` |
| OBSERVACIONES | `OBSERVACION_AGREGADA` | toda observación | `timestamp` |
| OBSERVACIONES | `OBSERVACION_ANULADA` | `estado === 'ANULADA'` con `anulacion` | `anulacion.timestamp` |

**Estado vs eventos.** Solo se emite lo que el payload prueba:
- *Observado:* todo lo de la tabla.
- *Estado derivado, no es evento:* el estado vigente de reemplazo (es la última evaluación), `vigente` de correcciones, `resolucion` de decisiones (punto operativo), `puedeAnular`, `activas`/`anuladas`/`total`. Ninguno se convierte en evento. `SIN_EVALUAR` es la ausencia de evaluaciones.
- *Real pero no representable:* el **instante de la VALIDADA** de una corrección que después fue SUPERADA o REVERTIDA (el payload solo trae el último evento: no se fabrica `UBICACION_VALIDADA`); los eventos de una corrección `INCONSISTENTE` (cadena dudosa: se omite entera); las decisiones de un pozo con log **no íntegro** (el backend manda `historial: []`); el motivo/autor de una observación **inconsistente** (el backend la oculta); las **sugerencias** de fuente (su vista depende de quién pregunta: el no validador ve solo las suyas, el validador solo las pendientes, así que no forman un historial coherente).

## Fotos: fuera de v1
`getFotosPozo` **no** devuelve fecha de alta (`timestampRegistro` no sale del backend), ni autor, ni evento de alta. Lo único temporal es `fechaFotoValor`, la fecha **de la foto** (puede ser solo el año, un mes, o desconocida). Un `FOTO_AGREGADA` no se puede demostrar y mostrar la fecha de la foto como si fuera una incorporación sería falso. Queda fuera hasta que el backend exponga una fecha de alta y un nombre (cambio de backend, aparte). El test de contrato fija las claves de la galería para que este punto se revise si cambian.

## Modelo de evento
```
{ id, fuente, tipo, timestamp, nombre, titulo, detalle, estado, metadata }
```
- `id`: estable y deduplicable (ver abajo).
- `fuente`: `UBICACION` | `REEMPLAZO` | `OBSERVACIONES`. `tipo`: catálogo cerrado, la fuente del tipo debe coincidir.
- `timestamp`: ISO UTC canónico `AAAA-MM-DDTHH:MM:SS.mmmZ` (ancho fijo: comparar strings es comparar instantes). No se guarda el valor original.
- `nombre`: el del payload, sin `@` ni vacío (si no, `Usuario`).
- `titulo`: **fijo por tipo** (nunca lleva datos). `detalle`: extracto de una línea (máx. 140 code points) del texto libre que la fuente ya muestra, o `null`. Texto plano: la interfaz debe usar `textContent`.
- `estado`: estado **actual** de la entidad afectada, solo si el payload lo informa (corrección, observación, evaluación); `null` en decisiones. Sirve para atenuar la propuesta de una corrección ya revertida o la alta de una observación anulada.
- `metadata`: lista blanca por tipo (`metodo`; `primeraUbicacion` solo si es `true`; `fuenteTipo` y `obsoleta`; `motivo` de reemplazo como código del catálogo). Vacía en el resto.

## IDs y deduplicación
Siempre ids del backend: `UBICACION:<correccionId>:<EVENTO>`, `DECISION:<wellId>:<secuencia con 9 dígitos>` (la `secuencia` pública del historial de decisiones; el relleno hace que el orden de ids sea el orden de escritura), `REEMPLAZO:<evaluacionId>`, `OBSERVACION:<observacionId>:ALTA|ANULADA`. Sin `evaluacionId` usable: `REEMPLAZO:<wellId>:<instante>:<estado>` (campos estables, sin texto libre). Nunca índices de arreglo, instantes solos ni texto.
Ante el mismo id gana el evento de **mayor avance de estado** (PROPUESTA < VALIDADA < terminal; ACTIVA < ANULADA) y, a igual avance, la última aparición. Así una lectura vieja de una observación activa nunca pisa a la anulada (y no recupera su texto), sin importar el orden de llegada.

## Fechas
Una sola función, `lineaTiempoPozoLogic_normalizarTimestamp`. Acepta ISO 8601 con zona **explícita** (`Z` u offset) y lo lleva a UTC. Rechaza: sin zona, separador con espacio (formato de Sheets), números, `Date`, año fuera de 2000..2100, fechas imposibles (31/02, hora 24, minuto/segundo 60) y offsets inválidos. No usa nunca la zona del dispositivo. Un evento sin fecha válida **se omite** (opción A: no se inventa una fecha ni se lo manda al final) y queda contado en `omitidos`.

## Orden
Más reciente primero. Empates: rango causal del tipo (en el mismo instante, `VALIDADA` arriba de `SUPERADA` y de `PROPUESTA`; `ANULADA` arriba de su alta), fuente ascendente, tipo ascendente e id **descendente**. Independiente del orden de llegada (probado con 200 permutaciones).

## Fallos parciales
`lineaTiempoPozoLogic_armar(entradas, wellId)` recibe por fuente `{estado: 'OK'|'SIN_PERMISO'|'ERROR', data}` y devuelve `{wellId, eventos, fuentes: {F: {estado, cantidad, omitidos}}, parcial}`. Estados por fuente: `OK`, `VACIA`, `SIN_PERMISO` (no es un fallo), `ERROR`, `NO_CARGADA`. `parcial` = alguna fuente en `ERROR` o `NO_CARGADA`. No existe «línea de tiempo inválida»: las demás fuentes siguen siendo utilizables. Una respuesta de otro pozo (apertura vieja) deja esa fuente en `ERROR`. La parte de Ubicación admite que falte una de sus dos lecturas.

## Archivos
- `js/lineaTiempoPozoLogic.js`: modelo puro (ES5, sin DOM ni red; no importa nada).
- `js/lineaTiempoPozoLogic.test.js`: unitarios (lista blanca, fechas, privacidad, orden, dedupe, armado, guardas del código).
- `js/lineaTiempoPozoContrato.test.js`: contra el backend real (flujos reales y claves de payload fijadas).

## Decisiones cerradas para E6-2 (registradas; NO implementadas)
Surgen de los bloqueos encontrados en E6-1. El modelo puro de E6-1 sigue con los cinco estados de fuente que ya tiene; `PARCIAL` lo agrega E6-2.

**A. Observaciones paginadas.** La API pagina por secuencia de observaciones y una anulación reciente puede pertenecer a una observación antigua, así que cargar solo la primera página no alcanza. El cargador:
- pide `limit=100` y sigue el cursor (`antesDeSecuencia`) hasta `hayMas=false`;
- tope de seguridad: **500 observaciones por pozo, máximo 5 páginas**;
- si al llegar al tope todavía `hayMas=true`: estado de la fuente = **PARCIAL**, se conservan los eventos obtenidos, se indica que existen eventos no cargados y **no** se afirma que la línea de tiempo está completa.

**B. Acceso.** La tarjeta/pantalla existe cuando al menos uno de `ubicacion`, `reemplazo` u `observaciones` es `=== true`. No se crea un permiso nuevo ni un discovery nuevo para usuarios «solo observaciones»: se mantiene la limitación conocida de E5.

**C. Estados de fuente (E6-2):** `OK`, `VACIA`, `SIN_PERMISO`, `ERROR`, `PARCIAL`, `NO_CARGADA`. `SIN_PERMISO` no es error ni parcial. `WELL_NOT_FOUND` de `getDecisionesFuentesPozo` (pozo fuera del padrón) se trata como **`VACIA` para esa lectura**, no como `ERROR`.

**D. Fallo parcial.** Cada lectura es independiente. Ejemplo: correcciones OK, decisiones ERROR, reemplazo OK, observaciones OK → la línea de tiempo sigue funcionando, Ubicación queda parcialmente disponible y no se ocultan las otras fuentes.

**E. Latencia.** E6-2 mide la duración de cada fuente y el total **solo dentro del cargador, del test o de un diagnóstico local**. Sin analytics, sin hoja, sin `localStorage` y sin backend nuevo. Primero se mide; un endpoint agregado no se considera antes.

**Sigue vigente de E6-1:** Fotos fuera de v1 (no se usa `fechaFotoValor` como fecha de incorporación ni se fabrica `FOTO_AGREGADA`), y una `OBSERVACION_ANULADA` nunca incorpora el texto original, aunque el backend se lo entregue a un moderador: la línea de tiempo es un resumen operativo, no una segunda vista de moderación.
