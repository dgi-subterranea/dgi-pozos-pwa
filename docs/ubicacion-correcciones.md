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
   | `ubicacion_corregir` | `SI` | puede **proponer** correcciones (además necesita `ubicacion=SI`). Solo con esto, la corrección queda `PROPUESTA` pendiente de validación |
   | `ubicacion_validar` | `SI` | puede ver la cola, **validar, rechazar y revertir** (además necesita `ubicacion=SI`). Si **además** tiene `ubicacion_corregir=SI`, lo que crea queda **vigente de inmediato** (ver *Corrección directa*) |

   | `ubicacion_corregir` | `ubicacion_validar` | Qué pasa al crear una corrección |
   |---|---|---|
   | `SI` | `NO` | queda `PROPUESTA`, pendiente de que valide otra persona |
   | `SI` | `SI` | **corrección directa**: `PROPUESTA` → `VALIDADA` en la misma operación, a nombre del mismo usuario |
   | `NO` | cualquiera | no puede crear nada (`PERMISSION_DENIED`) |

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
| `PROPUESTA` | `VALIDADA` | `ubicacion_validar` (**puede ser quien la propuso**; también al crearla, ver *Corrección directa*) |
| `PROPUESTA` | `RECHAZADA` | `ubicacion_validar` (motivo obligatorio), y **no** quien la propuso |
| `VALIDADA` | `REVERTIDA` | `ubicacion_validar` (motivo obligatorio) |
| `VALIDADA` | `SUPERADA` | automático al validar otra del mismo pozo |

`RECHAZADA`, `SUPERADA` y `REVERTIDA` son terminales (revertir no revive a la superada anterior). Cualquier otra transición =
`INVALID_TRANSITION`. **Una sola `VALIDADA` vigente por pozo**: al validar, en **una sola escritura contigua** se registra `SUPERADA`
para la anterior y después `VALIDADA` para la nueva. Pueden coexistir varias `PROPUESTA` del mismo pozo.

Quien tiene `ubicacion_validar` **puede validar una propuesta propia ya existente** (no hay restricción de autoría al validar: el antiguo
`SELF_VALIDATION` se eliminó). Lo que sigue vedado es **rechazar la propia** (`SELF_REJECTION`): `RECHAZADA` es una decisión de quien valida
lo de otra persona. No existe `RETIRADA`: si más adelante el autor pudiera retirar la suya, se modelaría como un evento separado.

## Corrección directa (`ubicacion_corregir=SI` + `ubicacion_validar=SI`)
Es un usuario autorizado a modificar la ubicación directamente: **no necesita que otra persona valide**. El permiso lo decide el backend
(`Api.js`, hoja `Usuarios`, fail-closed); el cliente no puede pedirlo ni forzarlo.
- **Mismo modelo de eventos, misma operación.** Dentro de **un solo lock** se escriben `PROPUESTA`, `SUPERADA` de la vigente anterior del pozo (si hay) y
  `VALIDADA`, **todos a nombre del mismo usuario**, en **una sola escritura contigua** del log: queda el grupo completo o ninguno. El motivo del
  evento `VALIDADA` dice *«Validada automaticamente al crearla…»*, así que en la auditoría se distingue de una validación manual.
- **Historial**: se registran `proponerCorreccionUbicacion` `OK` y `validarCorreccionUbicacion` `OK` (mismo usuario). La respuesta suma
  `autoValidada:true` y `supersedidas[]`.
- **Idempotente.** Reenviar la misma solicitud (mismo usuario y `clientRequestId`) devuelve la ya creada (`duplicada:true`) y **no agrega ningún
  evento**: nunca puede haber una segunda `VALIDADA`. Un reenvío tampoco valida una `PROPUESTA` que ya estaba escrita (esa se valida con
  `validar`). Con dos ejecuciones a la vez manda el lock: la segunda ve lo escrito por la primera.
- **Escritura parcial.** Si se cortó entre la fila y los eventos, el reintento del mismo usuario completa el `PROPUESTA` y, **si hoy tiene
  `ubicacion_validar`**, también la `VALIDADA` en la misma escritura (`curada:true`, `autoValidada:true`); sin el permiso solo completa el `PROPUESTA`.
- **Reglas de contenido iguales** (observación obligatoria a más de 250 m, Mendoza, precisión GPS). La coordenada de Irrigación sigue siendo
  **inmutable**: es el snapshot que toma el backend; el padrón no se escribe.
- Revertir lo propio funciona como siempre (`VALIDADA` → `REVERTIDA`, con motivo).
- **Propuestas anteriores a este cambio** (creadas cuando el usuario no tenía `ubicacion_validar`, o antes de la regla) siguen `PROPUESTA` y
  pendientes: nada se migra ni se valida solo; las valida quien tenga el permiso, incluido su autor.

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
| `proponerCorreccionUbicacion` | `ubicacion` + `ubicacion_corregir` | `wellId, lat, lon, metodo, precisionGpsM, observacion, clientRequestId` | `{correccion, duplicada, curada}` (+ `autoValidada:true, supersedidas[]` si el usuario también tiene `ubicacion_validar`) |
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
`SELF_REJECTION`, `INCONSISTENT_STATE`, `AUTOCURADA` y los demás códigos de error. Una corrección directa registra `proponerCorreccionUbicacion` `OK` y
`validarCorreccionUbicacion` `OK`. No se auditan las lecturas ni los
reenvíos idempotentes. **Sin Telegram.** Además
`UbicacionCorreccionesLog` es el registro de dominio (quién, cuándo, motivo).

## Frontend — etapa 1: ficha individual del pozo
Solo la ficha del pozo (módulo **Ubicación**): ver y crear correcciones. **Sin tocar** el mapa provincial, Cerca Mío, la selección geográfica, el mapa NE,
Reemplazos ni (todavía) un overlay global de correcciones validadas.

**Qué se ve** (`js/app.js` → `renderUbicacion` + `js/ubicacionCorreccion.js`):
- **Ubicación de Irrigación** (siempre primero, rotulada, nunca reemplazada): lo de siempre (confirmada/disponible, fuentes, enlace a Google Maps). Sin coordenada
  oficial, el módulo se ofrece solo a quien puede corregir y dice «Sin ubicación de Irrigación».
- **Ubicación corregida** (se lee con `getCorreccionesUbicacionPozo` al abrir el módulo, con el componente de carga):
  - con `vigente`: badge *Validada en campo*, coordenadas, quién (nombre, nunca email), fecha, método (*Elegida en mapa* / *GPS (± n m)*), distancia a
    Irrigación, observación y enlace a Google Maps; siempre con la nota «no reemplaza ni modifica la ubicación de Irrigación»;
  - sin vigente y con pendientes: *Corrección pendiente de validación* con todas las pendientes (ninguna se oculta); con vigente **y** pendientes se ven ambas;
  - sin nada: estado vacío.
  - **Visibilidad del módulo** (`ubicacionCorreccionLogic_ofrecerModulo`): con coordenada oficial, como siempre. **Sin** coordenada oficial la tarjeta *Ubicación* se ofrece si el
    usuario puede corregir (para cargar la primera) **o** si ya existe una corrección registrada (vigente, pendiente o en el historial) que su permiso `ubicacion` le deja leer. El
    permiso `ubicacion_corregir` controla solo el botón, no la información: un lector (`ubicacion=SI`, `ubicacion_corregir=NO`) abre el módulo de un pozo sin coordenada si hay una
    corrección. Para decidirlo, al buscar un pozo sin coordenada oficial y sin permiso de corregir se hace **una** llamada a `getCorreccionesUbicacionPozo` (solo en ese caso; si falla,
    el módulo no se ofrece).
  - **Historial de correcciones** (colapsable, orden cronológico): estado legible (Pendiente · Validada en campo · Rechazada · Reemplazada por una corrección
    posterior · Revertida · Inconsistente), coordenadas, autor, fecha, método, distancia, observación y resolución/motivo.

**Botón «Corregir ubicación»**: solo con `ubicacion === true` **y** `ubicacion_corregir === true` (valores exactos; cualquier otra cosa = no existe, ni
deshabilitado). El backend valida igual. Abre un panel (hoja inferior en celular) que repite la coordenada de Irrigación y ofrece:
- **A. Mi ubicación actual** (`GPS_ACTUAL`): `getCurrentPosition` con alta precisión, sin caché. Muestra lat/lon y precisión; con precisión inválida (0, ausente) o
  **> 50 m** no se puede guardar: «La precisión actual es de 73 m. Necesitamos 50 m o menos para guardar.» + *Intentar nuevamente*. Envía `precisionGpsM`.
- **B. Elegir punto en el mapa** (`PUNTO_EN_MAPA`): Leaflet con la carga diferida y las capas Mapa/Satélite de `mapaShared.js`. Centro: corrección vigente →
  Irrigación → ubicación del dispositivo → vista general de Mendoza. **Irrigación y la vigente son marcadores fijos** (no interactivos); solo el punto nuevo se
  elige tocando el mapa y se puede arrastrar. Muestra lat/lon y la distancia aproximada.
- **Confirmar**: distancia a Irrigación (solo orientativa; el backend recalcula), **observación opcional hasta 250 m y obligatoria a más de 250 m**, y a más de
  **1 km** la advertencia fuerte «La ubicación propuesta está a más de 1 km de la ubicación de Irrigación. Verificá cuidadosamente antes de guardar.» (permite
  guardar). Sin ubicación de Irrigación: se puede proponer, sin distancia y con observación opcional.

**Guardado** (`apiProponerCorreccionUbicacion`, lista blanca): `wellId, lat, lon, metodo, precisionGpsM, observacion, clientRequestId`. Nunca viajan email, nombre,
`autoValidar`, distancia, estado ni datos de Irrigación. `clientRequestId` es estable por intento (se reutiliza al reintentar el mismo contenido tras un corte o un
error; si el usuario cambia algo es otro contenido y se genera uno nuevo; tras guardar bien, el siguiente es otro intento). Doble toque: un solo envío.
El resultado lo dice el backend, **solo por `data.correccion.estado`**: `VALIDADA` → «Ubicación corregida y validada.»; `PROPUESTA` → «Corrección enviada para validación.». El flag
`autoValidada` (que hoy el backend suma cuando quien guarda tiene `ubicacion_validar`) **no es una dependencia**: con o sin él la pantalla muestra el resultado correcto.
Después del POST **siempre** se relee `getCorreccionesUbicacionPozo` y se pinta desde esa lectura (si la relectura falla se avisa y se ofrece *Actualizar*).
Los errores se muestran en el panel con un texto en español (nunca el mensaje técnico del backend); una sesión vencida cierra sesión.

**Contrato frontend ↔ backend**: `backend/test/UbicacionCorreccionContratoFrontend.test.js` ejecuta el `js/api.js` real contra `Api.doPost` → servicio → repositorio (hojas en memoria) y pasa
las respuestas reales por la lógica del frontend. Fija los campos de `proponerCorreccionUbicacion` (`{correccion, duplicada, curada}` + `autoValidada, supersedidas` solo con
validación directa) y de `getCorreccionesUbicacionPozo` (`{wellId, vigente, pendientes, historial}`), los de la vista de corrección (15 campos, sin emails) y de `resolucion`, las
acciones, los permisos, los umbrales (50 m / 250 m / 1 km / 300) y los códigos de error: si el backend o el frontend cambian uno solo, falla.

**Service Worker / offline** (`sw.js`): el precache del shell es **todo** lo que `index.html` carga (CSS, manifest, icono y cada `<script src>` local, incluidos
`ubicacionCorreccionLogic.js` y `ubicacionCorreccion.js`) y cada archivo se precachea con `cache: 'reload'` (sin la caché HTTP) para que sea de la misma versión que el `sw.js`. `sw.test.js` obliga a
que todo script/link local de `index.html` esté en `SHELL_FILES`. Lo que se carga bajo demanda (Leaflet, JSZip: `vendor/*`) no es del shell.

**Código**: `js/ubicacionCorreccionLogic.js` (lógica pura con tests: permisos, GPS, distancia, observación, payload, flujo de guardado, HTML de la sección),
`js/ubicacionCorreccion.js` (controlador DOM: sección, modal, GPS, mapa), `js/api.js` (2 funciones), `index.html` (modal), `css/styles.css` (`.ucorr-*`).

## Tests
`backend/test/UbicacionCorreccion{Repository,Service,E2E}.test.js` y `ApiUbicacionCorreccion.test.js`; el E2E lee un padrón de un Drive en memoria
de **solo lectura** que falla ante cualquier escritura.
