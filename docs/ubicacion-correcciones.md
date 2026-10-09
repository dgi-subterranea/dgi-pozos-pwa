# Correcciones de ubicación de pozos — etapa backend base

Permite registrar que la ubicación REAL observada de un pozo difiere de la que tiene Irrigación, **sin sobrescribir nunca la
coordenada oficial**: el padrón (JSON en Drive) no se escribe jamás; una corrección es solo una fila en una hoja, auditable y
reversible. Esta etapa es **solo backend** (hojas, repositorio, servicio, permisos, endpoints, validaciones, auditoría, tests):
no cambia ni el mapa provincial, ni Cerca Mío, ni el mapa NE, ni la ficha, ni Selección, ni Buscar reemplazo.

## Puesta en marcha (manual, en este orden)

1. Subir al proyecto de Apps Script del backend los archivos nuevos `UbicacionCorreccionRepository.js` y
   `UbicacionCorreccionService.js` y los modificados `Api.js`, `SheetUserRepository.js` y `AuthService.js`; publicar una versión nueva
   de la Web App.
2. Ejecutar **una vez** `setupUbicacionCorreccionesSheets()` desde el editor: crea `UbicacionCorrecciones` y
   `UbicacionCorreccionesLog` con su encabezado. No toca hojas existentes y **no modifica la hoja Usuarios**.
3. **Agregar a mano en la hoja `Usuarios`** dos columnas nuevas (el nombre del encabezado debe ser exactamente este; el orden da igual):

   | Columna | Valor | Efecto |
   |---|---|---|
   | `ubicacion_corregir` | `SI` | puede **proponer** correcciones (además necesita `ubicacion=SI`) |
   | `ubicacion_validar` | `SI` | puede ver la cola, **validar, rechazar y revertir** (además necesita `ubicacion=SI`) |

   Cualquier otro valor, celda vacía o columna inexistente = **NO** (fail-closed). Los permisos viajan en el mismo cache de usuario
   (hasta 5 minutos para reflejarse, igual que el resto).

## Esquema de las hojas (append-only: nunca se edita ni se borra una fila desde la app)

**`UbicacionCorrecciones`** — una fila por propuesta (inmutable). **18 columnas** = las 17 del modelo aprobado + `advertenciaDistancia`.
Las columnas se buscan por el texto del encabezado.

| # | Columna | Contenido |
|---|---|---|
| 1 | `correccionId` | uuid generado por el backend |
| 2 | `wellId` | `DD-PPPP` |
| 3 | `lat` | WGS84, 6 decimales (número) |
| 4 | `lon` | WGS84, 6 decimales (número) |
| 5 | `metodo` | `GPS_ACTUAL` \| `PUNTO_EN_MAPA` (catálogo extensible) |
| 6 | `precisionGpsM` | metros (solo `GPS_ACTUAL`; vacío en `PUNTO_EN_MAPA`) |
| 7 | `observacion` | texto, máx. 300 (se guarda como texto plano) |
| 8 | `emailPropone` | email de la sesión (en minúsculas). **Solo interno: nunca sale por la API** |
| 9 | `nombrePropone` | nombre de la hoja Usuarios |
| 10 | `timestamp` | fecha/hora de la propuesta (la pone el backend) |
| 11 | `irrLat` | snapshot de la coordenada de Irrigación vigente (vacío si no hay coordenada oficial) |
| 12 | `irrLon` | ídem |
| 13 | `irrEstado` | estado del padrón: `corroborada`, `unica`, `dudosoLeve`, `revisar`, `revisarGrave`, `sinCoordenadas` |
| 14 | `irrFuente` | `reportePozos` / `coordProvincia` (estado `unica`), `VARIAS_FUENTES` (`corroborada`), vacío en el resto |
| 15 | `padronPeriodo` | período del padrón (`metadata.fuente.periodo`, p. ej. `2026-09`) |
| 16 | `distanciaM` | metros entre Irrigación y la propuesta, **calculada por el servidor** (vacía sin coordenada oficial) |
| 17 | `advertenciaDistancia` | `SI` si `distanciaM` > 1 km (la única columna agregada a las 17 del modelo) |
| 18 | `clientRequestId` | idempotencia (único por usuario) |

**`UbicacionCorreccionesLog`** — una fila por evento (inmutable). 6 columnas.

| # | Columna | Contenido |
|---|---|---|
| 1 | `correccionId` | |
| 2 | `timestamp` | |
| 3 | `evento` | `PROPUESTA` \| `VALIDADA` \| `RECHAZADA` \| `SUPERADA` \| `REVERTIDA` |
| 4 | `email` | de quien ejecutó la acción (solo interno) |
| 5 | `nombre` | |
| 6 | `motivo` | texto, máx. 300 |

## Estado vigente (derivado)
El estado de una corrección es el **último evento** de su correccionId en el log, **siempre que el log sea una cadena válida**: empieza
con `PROPUESTA` y cada evento sigue a su anterior según la tabla de abajo. Una corrección **sin eventos** (o con un log que no es una
cadena válida: sin `PROPUESTA` inicial, eventos desconocidos, saltos imposibles) **no se supone `PROPUESTA`**: es `INCONSISTENTE`
(ver más abajo). Los eventos de un `correccionId` que no existe en la hoja de correcciones se ignoran.

| Desde | Hacia | Quién |
|---|---|---|
| `PROPUESTA` | `VALIDADA` | `ubicacion_validar`, y **no** quien la propuso |
| `PROPUESTA` | `RECHAZADA` | `ubicacion_validar` (motivo obligatorio), y **no** quien la propuso |
| `VALIDADA` | `REVERTIDA` | `ubicacion_validar` (motivo obligatorio) |
| `VALIDADA` | `SUPERADA` | automático al validar otra del mismo pozo |

`RECHAZADA`, `SUPERADA` y `REVERTIDA` son terminales (revertir no revive a la superada anterior). Cualquier otra transición =
`INVALID_TRANSITION`. **Una sola `VALIDADA` vigente por pozo**: al validar, en **una sola escritura contigua** se registra `SUPERADA`
para la anterior y después `VALIDADA` para la nueva. Pueden coexistir varias `PROPUESTA` del mismo pozo.

Quien propone **no puede validar ni rechazar su propia propuesta** (`SELF_VALIDATION` / `SELF_REJECTION`), aunque tenga
`ubicacion_validar`. `RECHAZADA` queda reservada a quien valida. No existe `RETIRADA`: si más adelante el autor pudiera retirar la suya,
se modelaría como un evento separado.

## Escritura parcial: autocurado y fail-closed
Crear una corrección escribe **dos hojas**: primero la fila de la corrección y después su evento inicial `PROPUESTA`. Sheets no tiene
transacciones entre hojas, así que **no es atómico** y no se finge que lo sea. Lo que sí se hace:

1. **Se achica la ventana**: antes de escribir la primera fila se abren y verifican **ambas** hojas (existencia, encabezado, columnas). Si falta
   una hoja o una columna, no se escribe nada. Todo ocurre bajo `LockService`, una escritura detrás de la otra.
2. **Un corte entre las dos escrituras deja una corrección sin eventos = `INCONSISTENTE`** (fail-closed): no aparece en la cola ni como
   pendiente, no puede ser vigente y **no se puede validar, rechazar ni revertir** (`INCONSISTENT_STATE`). Sí figura en el historial del
   pozo con estado `INCONSISTENTE`, y la cola de validación informa cuántas hay (`inconsistentes`).
3. **Autocurado**: el mismo usuario reintenta con el **mismo `clientRequestId`** y el mismo contenido → el backend agrega el `PROPUESTA`
   faltante (con la fecha original de la propuesta y un motivo que deja constancia del reintento), **sin duplicar la corrección**.
   La respuesta trae `duplicada:true, curada:true` y en `Historial` queda `AUTOCURADA`. No se vuelve a leer el padrón ni se reevalúan
   las reglas (la corrección ya tiene su snapshot).
4. **Lo que NO se cura**: otro `clientRequestId`/contenido (`IDEMPOTENCY_CONFLICT`), otro usuario (la corrección ajena sigue
   inconsistente), o un log con eventos pero inválido (`INCONSISTENT_STATE`, requiere revisión manual).

## Endpoints (POST `action`)

| Acción | Permisos (todos fail-closed + usuario activo) | Cuerpo | Respuesta `data` |
|---|---|---|---|
| `proponerCorreccionUbicacion` | `ubicacion` + `ubicacion_corregir` | `wellId, lat, lon, metodo, precisionGpsM, observacion, clientRequestId` | `{correccion, duplicada, curada}` |
| `getCorreccionesUbicacionPozo` | `ubicacion` | `wellId` | `{wellId, vigente, pendientes[], historial[]}` |
| `getCorreccionesUbicacionPendientes` | `ubicacion` + `ubicacion_validar` | — | `{total, inconsistentes, pendientes[]}` (más viejas primero, máx. 200) |
| `validarCorreccionUbicacion` | `ubicacion` + `ubicacion_validar` | `correccionId, motivo?` | `{correccion, supersedidas[]}` |
| `rechazarCorreccionUbicacion` | `ubicacion` + `ubicacion_validar` | `correccionId, motivo` | `{correccion, supersedidas:[]}` |
| `revertirCorreccionUbicacion` | `ubicacion` + `ubicacion_validar` | `correccionId, motivo` | `{correccion, supersedidas:[]}` |

Vista de `correccion` (sin emails): `correccionId, wellId, lat, lon, metodo, precisionGpsM, observacion, nombrePropone, timestamp,
distanciaM, advertenciaDistancia, irrigacion:{lat,lon,estado,fuente,padronPeriodo}, estado, resolucion:{evento,nombre,timestamp,motivo}|null,
propia` (`propia` = la propuso quien consulta). Los errores devuelven `{status:'error', code, message}`; `OBSERVACION_REQUERIDA` suma `distanciaM`.

La identidad (email, nombre) sale **siempre de la sesión**; `doPost` solo pasa la lista blanca de campos de cada acción (lo demás —snapshot,
distancia, estado, emails— se ignora).

## Reglas de validación (todo se recalcula en el backend)
- **Coordenadas:** números WGS84 válidos, redondeados a 6 decimales. Se bloquea lo claramente fuera de Mendoza con una caja
  (lat −37,65 a −31,95; lon −70,65 a −66,45, ~5 km de margen): `FUERA_DE_MENDOZA`. Es una regla gruesa a propósito.
- **`GPS_ACTUAL`:** `precisionGpsM` obligatoria y ≤ 50 m (`PRECISION_INSUFICIENTE` con el motivo si es peor; `INVALID_PRECISION` si falta).
  **`PUNTO_EN_MAPA`:** `precisionGpsM` debe ser nula.
- **Distancia a Irrigación** (haversine, servidor): hasta 250 m la observación es opcional; **más de 250 m** es obligatoria
  (`OBSERVACION_REQUERIDA`); **más de 1 km** se permite pero se guarda `advertenciaDistancia=SI`. No hay máximo duro.
- **Sin coordenada de Irrigación** (`sinCoordenadas`, `revisar*`, `dudosoLeve`): se permite proponer con `distanciaM` vacía y sin
  observación obligatoria; el estado queda en el snapshot. Pozo inexistente en el padrón: `WELL_NOT_FOUND` (fail-closed).
- **Observación** ≤ 300 caracteres (no se trunca: se rechaza); **motivo** ≤ 300; obligatorio al rechazar y revertir.
- **Idempotencia:** `clientRequestId` obligatorio (8–64 caracteres `A-Za-z0-9_-`), único **por usuario**. Repetir la misma solicitud devuelve
  la corrección ya creada (`duplicada:true`), aunque el padrón haya cambiado; reutilizarlo con otro contenido = `IDEMPOTENCY_CONFLICT`.
  Si la fila se escribió pero el evento `PROPUESTA` no llegó, el reintento lo completa sin duplicar (ver *Escritura parcial*).
- **Distancia en el preview:** no hay endpoint de preview; el frontend podrá mostrar una distancia aproximada antes de confirmar, pero el
  backend siempre recalcula y es el que manda.
- **Concurrencia:** leer → decidir → escribir va bajo `LockService` (el padrón se lee antes, fuera del lock).

## Auditoría
Hoja `Historial` (como el resto): `proponer/validar/rechazar/revertirCorreccionUbicacion` con `OK`, `PERMISSION_DENIED`, `INVALID_TRANSITION`,
`SELF_VALIDATION`, `SELF_REJECTION`, `INCONSISTENT_STATE`, `AUTOCURADA` y los demás códigos de error. No se auditan las lecturas ni los
reenvíos idempotentes. **Sin Telegram.** Además
`UbicacionCorreccionesLog` es el registro de dominio (quién, cuándo, motivo).

## Tests
`backend/test/UbicacionCorreccion{Repository,Service,E2E}.test.js` y `ApiUbicacionCorreccion.test.js`; el E2E lee un padrón de un Drive en memoria
de **solo lectura** que falla ante cualquier escritura.
