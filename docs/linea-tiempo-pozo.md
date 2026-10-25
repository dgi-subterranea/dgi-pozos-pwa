# Línea de tiempo del pozo (E6)

Estado: **E6-1 (modelo puro, `f48ac7c`) y E6-2 (cargador, `1063474`) commiteadas. E6-3 (pantalla) implementada en el repo, sin commit.** Sin pantalla, sin tarjeta, sin CSS, sin service worker, sin cambios de backend ni de `api.js`. Las etapas siguientes (E6-2 carga por fuente, E6-3 pantalla, E6-4 rollout) no empezaron.

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

## E6-2 — Cargador (`js/lineaTiempoPozoLoader.js`)
Capa de carga **sin DOM**: consulta las fuentes permitidas con los wrappers que ya existen en `js/api.js` (`apiGetCorreccionesUbicacionPozo`, `apiGetDecisionesFuentesPozo`, `apiGetHistorialReemplazo`, `apiGetObservacionesPozo`; no hizo falta tocar `api.js`), normaliza con el modelo de E6-1 y devuelve un resultado agregado. No renderiza, no guarda nada y no toca el backend. Pantalla, tarjeta, CSS y service worker son E6-3.

**Uso.** `var cargador = lineaTiempoPozoLoader_crear(deps)` (todo opcional: `api`, `logica`, `ahora`, `onSesionExpirada(code)`); `cargador.cargar(sessionToken, wellId, permisos)` devuelve una promesa que **nunca se rechaza**; `cargador.esVigente(resultado)`, `cargador.cancelar()`. `lineaTiempoPozoLogic_puedeVerLineaTiempo(permisos)` (en el modelo) dice si hay pantalla: al menos uno de `ubicacion`, `reemplazo`, `observaciones` es `=== true`.

**Resultado.**
```
{ wellId, generacion, puedeVer, auth, eventos, completa, parcial, duracionMs,
  fuentes: {
    ubicacion:     { estado, cantidadEventos, omitidos, duracionMs, motivoParcial, codigoError, partes: {correcciones: {estado, duracionMs, codigoError}, decisiones: {...}} },
    reemplazo:     { estado, cantidadEventos, omitidos, duracionMs, motivoParcial, codigoError },
    observaciones: { estado, cantidadEventos, omitidos, duracionMs, motivoParcial, codigoError, paginas, cargadas } } }
```
Solo eventos del modelo (lista blanca), contadores y códigos. Nunca payload crudo, emails, `clientRequestId`, secuencias, el `sessionToken` ni el texto de una observación anulada.

**Permisos y paralelismo.** Cada fuente se pide solo con su permiso exacto (`=== true`); sin permiso no hay request. Las lecturas independientes (correcciones, decisiones, reemplazo y la primera página de observaciones) arrancan en el mismo instante; solo las páginas siguientes de observaciones son secuenciales. La duración total es la de la fuente más lenta. Si el backend responde `PERMISSION_DENIED` (el permiso cambió), la fuente queda `SIN_PERMISO` y no es un fallo.

**Estados por fuente.** `OK`, `VACIA`, `SIN_PERMISO`, `ERROR`, `PARCIAL`, `NO_CARGADA`. Un payload válido con ítems omitidos por el modelo sigue siendo `OK` (o `VACIA` si no quedó ninguno): los omitidos quedan en `omitidos` como diagnóstico. `ERROR` solo si no se pudo obtener o interpretar la respuesta.
- *Ubicación* combina dos lecturas independientes: ambas `ERROR` → `ERROR`; una `ERROR` → `PARCIAL` (`motivoParcial`: `SUBFUENTE_CORRECCIONES` / `SUBFUENTE_DECISIONES`); ambas vacías → `VACIA`; si no, `OK`. `WELL_NOT_FOUND` de decisiones (pozo fuera del padrón) es «sin decisiones» (`VACIA`), nunca un fallo; en correcciones sí sería un fallo. Ambas con `PERMISSION_DENIED` → `SIN_PERMISO`.
- *Observaciones* — `PARCIAL` si la paginación se cortó con datos ya cargados: `LIMIT_REACHED`, `CURSOR_INVALIDO`, `CURSOR_REPETIDO`, `CURSOR_NO_AVANZA`, `ERROR_PAGINA`, `RESPUESTA_INVALIDA` o `CANCELADA`. Si falla la primera página → `ERROR`.

**Paginación de Observaciones.** `limit=100`; primera llamada sin cursor; mientras `hayMas === true` se pide `antesDeSecuencia = cursor`. Tope: **5 páginas / 500 observaciones**; si al llegar todavía hay más → `PARCIAL` + `LIMIT_REACHED`, se conservan los eventos y **no** se afirma que la línea de tiempo está completa. Cortes fail-safe (sin bucles, conservando lo cargado): `hayMas=true` con cursor ausente o que no sea un entero ≥ 1; cursor ya pedido; cursor que no baja estrictamente. Una página posterior con error o mal formada (incluida la de otro pozo) → `PARCIAL`. Los elementos repetidos entre páginas se deduplican con el modelo de E6-1 (id + avance de estado).

**Completa / parcial global** (sobre las fuentes *permitidas*, es decir, todas las que no son `SIN_PERMISO`):
- `completa = true` si hay al menos una fuente permitida y todas terminaron `OK` o `VACIA`. `SIN_PERMISO` no lo impide. Sin ninguna fuente permitida, `completa = false` (no se cargó nada; `puedeVer = false`).
- `parcial = true` si alguna fuente permitida quedó `ERROR`/`PARCIAL` **y** alguna dio datos útiles (`OK`, `VACIA` o `PARCIAL`). Si todas las permitidas fallan: `parcial = false` y `completa = false`.

**Sesión.** `UNAUTHORIZED` / `USER_DISABLED` no son un fallo de fuente: se propagan en `resultado.auth` (y en `onSesionExpirada(code)`, una sola vez por carga vigente), se corta lo pendiente y el resultado queda sin eventos y con las fuentes permitidas en `NO_CARGADA`. `USER_DISABLED` gana si coexiste con `UNAUTHORIZED`. E6-3 debe usar el cierre de sesión de siempre.

**Respuestas viejas.** Cada `cargar` abre una *generación*. `esVigente(resultado)` es `true` solo para el de la última carga; una carga desplazada o `cancelar()` corta la paginación (`PARCIAL` + `CANCELADA`) y su resultado **no debe aplicarse**. No usa `AbortController`.

**Latencia.** `duracionMs` por fuente (y por subfuente de ubicación), total y por carga, con reloj inyectable (`performance.now` por defecto), en enteros y solo en memoria: sin `console`, analytics, `localStorage`, Sheet ni backend.

**Best-effort.** Son varias llamadas separadas, no un snapshot: si durante la carga se agrega o se anula una observación, la paginación puede repetir o saltear elementos. El modelo evita que una `ANULADA` vuelva a verse `ACTIVA` cuando ambas lecturas están presentes, pero no se intenta una lectura transaccional ni se toma ningún lock. Una observación anulada *entre* páginas, cuya alta ya se había leído, puede quedar mostrada como activa hasta recargar.

**Tests.** `js/lineaTiempoPozoLoader.test.js` (unitarios con promesas controladas y reloj falso) y `js/lineaTiempoPozoLoaderContrato.test.js` (los wrappers reales de `api.js` contra el backend real: paginación real, tope de 500, `WELL_NOT_FOUND` real, permisos, errores de sesión, hoja caída).

## E6-3 — Pantalla de la línea de tiempo
Solo frontend, sin backend, sin escrituras, sin permisos nuevos, sin Fotos y sin endpoint agregado.

**Archivos.** `js/lineaTiempoPozo.js` (controlador DOM), `js/lineaTiempoPozoVistaLogic.js` (presentación pura: qué se muestra, filtros, avisos y notas de cada evento), `index.html` (pantalla `#screen-linea-tiempo` y scripts), `css/styles.css` (bloque `.lt-*`, antes del de Observaciones), `sw.js` (los cuatro scripts en `SHELL_FILES`) y `js/app.js` (solo cablea). `js/api.js` no cambió: se usan los wrappers de lectura que ya existían.

**Tarjeta del hub.** «Línea de tiempo» · «Historia operativa del pozo». Aparece solo si `lineaTiempoPozoLogic_puedeVerLineaTiempo(permisosActuales)`: al menos uno de `ubicacion`, `reemplazo` u `observaciones` es exactamente `true`. Perfil, datos, NE, fotos y los valores «truthy» no la habilitan. La tarjeta **no carga datos**: solo navega; el pedido sale al abrir la pantalla. Un usuario con solo `observaciones` sigue sin descubrimiento propio (limitación conocida de E5).

**Pantalla.** Cabecera con el pozo, «Cargando…», lista de eventos (`<ol>`, el orden que entrega el modelo: más reciente primero, sin reordenar en el DOM), filtros, avisos y estado vacío. Volver cancela la carga y regresa al hub del mismo pozo (no hay búsqueda nueva). Cada apertura es una carga fresca; no hay caché.

**Evento.** Badge de la fuente en texto (Ubicación / Reemplazo / Observaciones; el color solo refuerza), fecha y hora locales (helper de fecha de la app sobre el instante UTC canónico del modelo), título, detalle (extracto de hasta 140 caracteres, solo con `textContent`), notas y «Por <nombre>». Las notas salen de una lista blanca de metadata: método de ubicación, «Primera ubicación del pozo», tipo de fuente registral, motivo de la evaluación (con la etiqueta del catálogo; un código sin etiqueta no se muestra) y el estado actual de una propuesta u observación. Nunca ids, emails, secuencias, `clientRequestId`, metadata cruda ni códigos técnicos. Una observación anulada nunca muestra el texto original, ni siquiera a un moderador.

**Filtros.** Botones reales «Todas · Ubicación · Reemplazo · Observaciones» (`aria-pressed`, el seleccionado lleva además un tilde), solo de las fuentes que participan (una fuente `SIN_PERMISO` o no cargada no tiene filtro; con menos de dos fuentes no hay barra). Filtrar usa `lineaTiempoPozoLogic_filtrarPorFuente` sobre el resultado ya cargado: **no vuelve a pedir nada** y el aviso de carga incompleta sigue visible (filtrar no arregla lo que no se cargó).

**Estados.**
- *Vacío* (todo cargó, sin eventos): «Este pozo todavía no tiene eventos en la línea de tiempo.» (no es un error).
- *Ninguna fuente se pudo leer* (el frontend creía poder verla pero el backend denegó todas): estado neutro «No hay información disponible para mostrar.». No afirma que no haya eventos (no pudo leerlos), no menciona permisos, no sugiere datos ocultos y no es un error.
- *Error total* (sin eventos y nada útil): «No se pudo cargar la línea de tiempo.» + «Reintentar» (carga nueva del mismo pozo). Sin códigos.
- *Parcial* (hay información útil pero falta algo): la lista disponible y un aviso discreto: «Parte de la información no pudo cargarse.» más una línea por fuente («Reemplazo no pudo cargarse.», «Observaciones no pudo cargarse por completo.», «Parte del historial de ubicación no pudo cargarse.»).
- *Límite* (`LIMIT_REACHED`): «Hay más observaciones antiguas que no se incluyeron en esta vista.» (no es un error y no activa el aviso general).
- `SIN_PERMISO` y `CANCELADA` no se avisan; los tiempos del cargador no se muestran.

**Sesión.** `UNAUTHORIZED` / `USER_DISABLED` no se muestran como error: el controlador pide el cierre de sesión de siempre (`logout()`), **una sola vez** por apertura y apenas la primera fuente lo informa. El cierre de sesión (`reset`) cancela y limpia la pantalla.

**Respuestas viejas.** El resultado se aplica solo si `cargador.esVigente(resultado)`: salir, cambiar de pozo o reabrir descartan lo que venía en vuelo.

**Service worker.** Los cuatro scripts se precachean como el resto del shell; la estrategia no cambió y la API sigue sin cachearse.

**Tests.** `js/lineaTiempoPozoVistaLogic.test.js` (presentación pura), `js/lineaTiempoPozoController.test.js` (controlador real con DOM falso que lanza ante `innerHTML` o `data-*`) y `js/lineaTiempoPozoWiring.test.js` (index.html, tarjeta, app.js, service worker y CSS). Verificación visual con datos simulados a 375 px y 1280 px, sin scroll horizontal.
