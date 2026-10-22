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

**`UbicacionCorrecciones`** — una fila por propuesta (inmutable). **20 columnas (esquema V2)** = las 17 del modelo aprobado + `advertenciaDistancia` (18, el esquema V1 que hoy
tiene producción) + `coordenadaOriginalTexto` y `crsOriginal` **al final** (ver *Coordenadas ingresadas*). Las columnas se buscan por el texto del encabezado.

| # | Columna | Contenido |
|---|---|---|
| 1 | `correccionId` | uuid generado por el backend |
| 2 | `wellId` | `DD-PPPP` |
| 3 | `lat` | WGS84, 6 decimales (número) |
| 4 | `lon` | WGS84, 6 decimales (número) |
| 5 | `metodo` | `GPS_ACTUAL` \| `PUNTO_EN_MAPA` \| `COORDENADAS_GMS` \| `COORDENADAS_POSGAR94_AR2` (catálogo extensible) |
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
| 19 | `coordenadaOriginalTexto` | **V2.** Valor tipeado en su forma canónica, generada por el backend (vacío en `GPS_ACTUAL` / `PUNTO_EN_MAPA` y en filas históricas) |
| 20 | `crsOriginal` | **V2.** `GMS_WGS84` \| `EPSG:22182` (vacío igual que la anterior) |

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
| `proponerCorreccionUbicacion` | `ubicacion` + `ubicacion_corregir` | `wellId, lat, lon, metodo, precisionGpsM, observacion, clientRequestId, coordenadaOriginal?` | `{correccion, duplicada, curada}` (+ `autoValidada:true, supersedidas[]` si el usuario también tiene `ubicacion_validar`) |
| `getCorreccionesUbicacionPozo` | `ubicacion` | `wellId` | `{wellId, vigente, pendientes[], historial[]}` |
| `getCorreccionesUbicacionPendientes` | `ubicacion` + `ubicacion_validar` | — | `{total, inconsistentes, pendientes[]}` (más viejas primero, máx. 200) |
| `validarCorreccionUbicacion` | `ubicacion` + `ubicacion_validar` | `correccionId, motivo?` | `{correccion, supersedidas[]}` |
| `rechazarCorreccionUbicacion` | `ubicacion` + `ubicacion_validar` | `correccionId, motivo` | `{correccion, supersedidas:[]}` |
| `revertirCorreccionUbicacion` | `ubicacion` + `ubicacion_validar` | `correccionId, motivo` | `{correccion, supersedidas:[]}` |

Vista de `correccion` (sin emails): `correccionId, wellId, lat, lon, metodo, precisionGpsM, coordenadaOriginalTexto, crsOriginal, observacion, nombrePropone, timestamp,
distanciaM, advertenciaDistancia, irrigacion:{lat,lon,estado,fuente,padronPeriodo}, estado, resolucion:{evento,nombre,timestamp,motivo}|null,
propia` (`propia` = la propuso quien consulta; `coordenadaOriginalTexto` y `crsOriginal` son `''` en GPS / mapa y en filas históricas). Los errores devuelven `{status:'error', code, message}`;
`OBSERVACION_REQUERIDA` suma `distanciaM` y los errores de una coordenada ingresada suman `detalle` y `campo` (ver *Coordenadas ingresadas*).

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
Hoja `Historial` (como el resto): `proponer/validar/rechazar/revertirCorreccionUbicacion` (y `notificarCorreccionUbicacion` para el aviso por email, ver abajo) con `OK`, `PERMISSION_DENIED`, `INVALID_TRANSITION`,
`SELF_REJECTION`, `INCONSISTENT_STATE`, `AUTOCURADA` y los demás códigos de error. Una corrección directa registra `proponerCorreccionUbicacion` `OK` y
`validarCorreccionUbicacion` `OK`. No se auditan las lecturas ni los
reenvíos idempotentes. **Sin Telegram (el aviso a validadores es por email, ver abajo).** Además
`UbicacionCorreccionesLog` es el registro de dominio (quién, cuándo, motivo).

## Frontend — etapa 1: ficha individual del pozo
Solo la ficha del pozo (módulo **Ubicación**): ver y crear correcciones. **Sin tocar** el mapa provincial, Cerca Mío, la selección geográfica, el mapa NE,
Reemplazos ni (todavía) un overlay global de correcciones validadas.

**Qué se ve** (`js/app.js` → `renderUbicacion` + `js/ubicacionCorreccion.js`):
- **Ubicación de Irrigación** (siempre primero, rotulada, nunca reemplazada): lo de siempre (confirmada/disponible, fuentes, enlace a Google Maps). Sin coordenada
  oficial, el módulo se ofrece solo a quien puede corregir y dice «Sin ubicación de Irrigación».
- **Ubicación corregida** (se lee con `getCorreccionesUbicacionPozo` al abrir el módulo, con el componente de carga):
  - con `vigente`: badge *Validada en campo*, coordenadas, quién (nombre, nunca email), fecha, método (*Elegida en mapa* / *GPS (± n m)* / *Coordenadas GMS / WGS84* / *Coordenadas POSGAR 94 / Argentina 2*), distancia a
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
deshabilitado). El backend valida igual. Abre un panel (hoja inferior en celular) que repite la coordenada de Irrigación y ofrece (las dos primeras opciones y, desde las etapas 3 y 4, *Ingresar coordenadas*):
- **A. Mi ubicación actual** (`GPS_ACTUAL`): `getCurrentPosition` con alta precisión, sin caché. Muestra lat/lon y precisión; con precisión inválida (0, ausente) o
  **> 50 m** no se puede guardar: «La precisión actual es de 73 m. Necesitamos 50 m o menos para guardar.» + *Intentar nuevamente*. Envía `precisionGpsM`.
- **B. Elegir punto en el mapa** (`PUNTO_EN_MAPA`): Leaflet con la carga diferida y las capas Mapa/Satélite de `mapaShared.js`. Centro: corrección vigente →
  Irrigación → ubicación del dispositivo → vista general de Mendoza. **Irrigación y la vigente son marcadores fijos** (no interactivos); solo el punto nuevo se
  elige tocando el mapa y se puede arrastrar. Muestra lat/lon y la distancia aproximada.
- **Confirmar**: distancia a Irrigación (solo orientativa; el backend recalcula), **observación opcional hasta 250 m y obligatoria a más de 250 m**, y a más de
  **1 km** la advertencia fuerte «La ubicación propuesta está a más de 1 km de la ubicación de Irrigación. Verificá cuidadosamente antes de guardar.» (permite
  guardar). Sin ubicación de Irrigación: se puede proponer, sin distancia y con observación opcional.

**Guardado** (`apiProponerCorreccionUbicacion`, lista blanca): `wellId, lat, lon, metodo, precisionGpsM, observacion, clientRequestId` (+ `coordenadaOriginal` solo en los métodos por coordenadas, ver *etapas 3 y 4*). Nunca viajan email, nombre,
`autoValidar`, distancia, estado ni datos de Irrigación. `clientRequestId` es estable por intento (se reutiliza al reintentar el mismo contenido tras un corte o un
error; si el usuario cambia algo es otro contenido y se genera uno nuevo; tras guardar bien, el siguiente es otro intento). Doble toque: un solo envío.
El resultado lo dice el backend, **solo por `data.correccion.estado`**: `VALIDADA` → «Ubicación corregida y validada.»; `PROPUESTA` → «Corrección enviada para validación.». El flag
`autoValidada` (que hoy el backend suma cuando quien guarda tiene `ubicacion_validar`) **no es una dependencia**: con o sin él la pantalla muestra el resultado correcto.
Después del POST **siempre** se relee `getCorreccionesUbicacionPozo` y se pinta desde esa lectura (si la relectura falla se avisa y se ofrece *Actualizar*).
Los errores se muestran en el panel con un texto en español (nunca el mensaje técnico del backend); una sesión vencida cierra sesión.

**Contrato frontend ↔ backend**: `backend/test/UbicacionCorreccionContratoFrontend.test.js` ejecuta el `js/api.js` real contra `Api.doPost` → servicio → repositorio (hojas en memoria) y pasa
las respuestas reales por la lógica del frontend. Fija los campos de `proponerCorreccionUbicacion` (`{correccion, duplicada, curada}` + `autoValidada, supersedidas` solo con
validación directa) y de `getCorreccionesUbicacionPozo` (`{wellId, vigente, pendientes, historial}`), los de la vista de corrección (17 campos, sin emails: los 15 originales + `coordenadaOriginalTexto` y `crsOriginal`) y de `resolucion`, las
acciones, los permisos, los umbrales (50 m / 250 m / 1 km / 300) y los códigos de error: si el backend o el frontend cambian uno solo, falla.

**Service Worker / offline** (`sw.js`): el precache del shell es **todo** lo que `index.html` carga (CSS, manifest, icono y cada `<script src>` local, incluidos
`ubicacionCorreccionLogic.js` y `ubicacionCorreccion.js`) y cada archivo se precachea con `cache: 'reload'` (sin la caché HTTP) para que sea de la misma versión que el `sw.js`. `sw.test.js` obliga a
que todo script/link local de `index.html` esté en `SHELL_FILES`. Lo que se carga bajo demanda (Leaflet, JSZip: `vendor/*`) no es del shell.

**Código**: `js/ubicacionCorreccionLogic.js` (lógica pura con tests: permisos, GPS, distancia, observación, payload, flujo de guardado, HTML de la sección),
`js/ubicacionCorreccion.js` (controlador DOM: sección, modal, GPS, mapa), `js/api.js` (2 funciones), `index.html` (modal), `css/styles.css` (`.ucorr-*`).

## Aviso por email a validadores + indicador de pendientes (costo $0)
**Qué hace.** Cuando una corrección nueva queda `PROPUESTA`, el backend manda un email a quienes la pueden validar, y el hub muestra a esas mismas personas «Correcciones pendientes: N».
No hay servicios externos ni de pago: solo `MailApp` de Apps Script (backend actual) y el frontend actual.

**Cuándo se manda** (`backend/src/UbicacionCorreccionNotificacion.js`, llamado desde `handleProponerCorreccionUbicacion` en `Api.js`):
- **Sí:** propuesta nueva que quedó `PROPUESTA` (usuario con `ubicacion_corregir` y sin `ubicacion_validar`), y el reintento que *recién* completa una escritura parcial dejándola `PROPUESTA` (autocurado).
- **No:** corrección `VALIDADA` directa (corregir + validar); reintento idempotente (`duplicada`); errores de validación o de permiso. Segunda defensa: marca en `CacheService` por `correccionId` (6 h).
- **Destinatarios:** usuarios **activos** con `ubicacion=SI` **y** `ubicacion_validar=SI` (los dos permisos que el backend exige para ver la cola y validar), sin repetidos, con un email de forma válida y **sin el propio proponente**. Se manda **un email por destinatario**
  (los validadores no ven las direcciones de los demás y un fallo individual no afecta al resto). La lista se lee de la hoja `Usuarios` en el momento (sin caché).
- **Contenido:** asunto `DGI Pozos — Corrección de ubicación pendiente: 14-0001`; cuerpo con pozo, quién propuso (nombre), fecha/hora, método (*GPS (± n m)* / *Elegida en mapa* / *Coordenadas GMS / WGS84* / *Coordenadas POSGAR 94 / Argentina 2*), distancia a Irrigación, observación,
  advertencia si pasa de 250 m o de 1 km y, si está configurada, la URL de la PWA. **No** lleva coordenadas, emails, datos del padrón ni ids. El texto de usuario se limpia de saltos de línea y caracteres de control (nadie puede fabricar líneas falsas).
- **Best-effort:** si falla la lectura de usuarios, el permiso de `MailApp`, la cuota o un destinatario, **la propuesta sigue creada** y la respuesta al cliente no cambia; se registra y se sigue.

**Auditoría** (Historial, acción `notificarCorreccionUbicacion`, a nombre de quien propuso; nunca el cuerpo ni direcciones): `EMAIL_ENVIADO (N destinatarios)`, `EMAIL_PARCIAL (k de N enviados[, cuota diaria agotada])`,
`EMAIL_FALLO (0 de N enviados[, cuota diaria agotada])`, `EMAIL_SIN_DESTINATARIOS`, `EMAIL_ERROR` (no se pudo leer la hoja de usuarios). Un aviso repetido o una corrección no pendiente no registran nada.

**Cuotas de MailApp** (cuenta que despliega el Web App, que es la que envía; cada destinatario cuenta): Gmail personal **100 destinatarios/día**; Google Workspace **1.500/día**; hasta 50 destinatarios y 200 KB por mensaje (acá: 1 destinatario y ~1 KB).
Antes de enviar se consulta `MailApp.getRemainingDailyQuota()` y no se pasa de lo disponible (lo que no entra queda como parcial/fallo con «cuota diaria agotada»). La cuota se renueva en un día móvil.
Con 5 validadores, una cuenta Gmail aguanta ~20 propuestas por día: de sobra para el uso previsto.

**Configuración manual (una sola vez, ANTES de desplegar la versión nueva a producción):**
1. **Autorizar el permiso de enviar correo.** El manifest no declara `oauthScopes` (los permisos se detectan solos), así que al subir código con `MailApp` el proyecto pasa a requerir `script.send_mail`. La cuenta que despliega debe aprobarlo: en el editor de Apps Script,
   con el código nuevo ya en HEAD, ejecutar **`diagnosticoCorreccionesEmail`** y aceptar el aviso de autorización (no envía ningún email; muestra cuota, URL y cantidad de validadores). **Hacerlo antes de crear la versión y de actualizar el deployment**: un Web App «ejecutar como yo» que requiere un permiso no
   autorizado puede fallar (para todas las acciones, no solo las correcciones) hasta que el dueño lo apruebe.
2. **(Opcional) `PWA_URL`** en Script Properties (`https://…`, URL pública de la PWA en GitHub Pages) para que el email lleve el enlace. Sin ella el aviso sale sin enlace. Solo se acepta `https://host[/ruta]` sin espacios, parámetros ni credenciales.
3. Verificar en la hoja `Usuarios` que los validadores tengan estado `activo`, `ubicacion=SI` y `ubicacion_validar=SI` y un email real.

**Indicador del hub** (`js/ubicacionPendientes.js` + `ubicacionCorreccionLogic_crearBadgePendientes`): solo con `ubicacion === true` **y** `ubicacion_validar === true` exactos (fail-closed); usa `getCorreccionesUbicacionPendientes` (`data.total`).
Se actualiza al iniciar sesión / abrir la app y cada vez que se vuelve al hub (con un mínimo de 15 s entre refrescos automáticos), y **siempre** después de validar o rechazar: la bandeja de validación llama `ubicacionPendientesController_alResolver()` al terminar cada acción (y `ubicacionPendientesController_fijarTotal(n)` cuando acaba de leer la cola completa).
Con 0 pendientes, sin permiso o ante un error no se ve; un fallo de la consulta nunca bloquea la app (conserva el último valor); sesión vencida cierra sesión y usuario deshabilitado va a su pantalla, como el resto de la app. Desde la etapa de validación (abajo) el indicador es un **botón** que abre la bandeja «Correcciones pendientes».

## Coordenadas ingresadas — etapa 2 (backend): `COORDENADAS_GMS` y `COORDENADAS_POSGAR94_AR2`
Solo backend (el modal y el resto del frontend vienen en etapas siguientes; hoy ninguna pantalla manda estos métodos). Una persona con `ubicacion_corregir` puede proponer una ubicación **tipeando**
la coordenada: grados/minutos/segundos (WGS84) o **POSGAR 94 / Argentina 2 · EPSG:22182**. El backend **no confía en el WGS84 que arma el cliente**: recibe el valor ORIGINAL, lo vuelve a convertir con
su propia copia del módulo (`backend/src/CoordenadasConversion.js`, idéntica a `js/coordenadasConversion.js`; un test las compara sin comentarios) y guarda SU resultado.

**Payload** (`proponerCorreccionUbicacion`, además de `wellId, metodo, observacion, clientRequestId`; sin `precisionGpsM`):

| `metodo` | `coordenadaOriginal` (claves permitidas; una clave de más, o un `lat`/`lon`/`x`/`y` que falte = `INVALID_COORDENADA_ORIGINAL`) |
|---|---|
| `COORDENADAS_GMS` | `{lat:{g,m,s,h}, lon:{g,m,s,h}}` — `g/m/s` número o texto (coma o punto decimal), `h` texto (`N/S`, `E/O/W`). **Grados y hemisferio son obligatorios; minutos y segundos pueden omitirse (o ir vacíos) y se interpretan como 0.** Una clave que no sea `g/m/s/h` es un error |
| `COORDENADAS_POSGAR94_AR2` | `{x, y}` — **X = Este, Y = Norte** (convención del padrón; el IGN usa la inversa), metros, número o texto (`2.500.000,50` vale). Ambos obligatorios |

`lat`/`lon` son **opcionales** (preview del cliente). Si vienen, el backend compara, con **distancia métrica** (haversine), el valor que mandó el cliente **tal cual** contra su propia conversión **sin redondear**:
más de **0,02 m (2 cm)** = `COORDENADA_INCONSISTENTE` y no se guarda nada. **El redondeo a 6 decimales (hasta ~5,5 cm) es solo de persistencia / vista y nunca interviene en esa decisión.**
Consecuencia de contrato: un cliente honesto manda `lat`/`lon` **sin redondear** (el frontend lo hace); si mandara el valor ya redondeado a 6 decimales podría quedar a más de 2 cm y se rechazaría.
(Los módulos de conversión devuelven `latExacta`/`lonExacta`, sin redondear, además de `lat`/`lon` a 6 decimales.) `coordenadaOriginalTexto` y `crsOriginal` **no se leen del cliente** (si los manda se ignoran). `GPS_ACTUAL` y `PUNTO_EN_MAPA` no llevan `coordenadaOriginal`.

**Validaciones** (todas en el backend): GMS — grados enteros (lat 0–90, lon 0–180), minutos enteros 0–59, segundos ≥ 0 y < 60, minutos/segundos vacíos = 0, nunca negativos (el signo lo da el hemisferio),
lat solo N/S, lon E/O/W, y el punto final tiene que quedar en Mendoza (si un hemisferio está mal, el mensaje lo dice, pero **no se corrige solo**). POSGAR — rango de sanidad previo
(Este 2.300.000–2.800.000, Norte 5.800.000–6.500.000), **X/Y invertidos se detectan y NO se intercambian solos**, y después la misma caja de Mendoza sobre el WGS84 derivado. NaN / infinito / texto no numérico se rechazan.
Siguen las reglas de siempre sobre el punto derivado: distancia oficial calculada por el servidor, observación obligatoria a más de 250 m, advertencia a más de 1 km.

**Errores nuevos:** `COORDENADA_INVALIDA` (con `detalle`, p. ej. `MINUTOS_FUERA_DE_RANGO`, y `campo`, p. ej. `lat.m` / `x`), `XY_INVERTIDOS`, `COORDENADA_INCONSISTENTE`, `INVALID_COORDENADA_ORIGINAL`,
`ESQUEMA_DESACTUALIZADO` (la hoja todavía es V1: ver abajo). `FUERA_DE_MENDOZA` e `INVALID_PRECISION` se reutilizan. Ningún error repite lo que escribió la persona.

**Auditoría:** `coordenadaOriginalTexto` canónico — GMS `33° 20' 51.54" S, 69° 8' 43.62" O` (`crsOriginal = GMS_WGS84`), POSGAR `X(Este)=2500000.00, Y(Norte)=6350000.00` (`crsOriginal = EPSG:22182`).
Idempotencia: `clientRequestId` sigue siendo la autoridad; con el mismo id, dos pedidos con igual pozo, método y punto pero **distinto valor original canónico** (o distinto CRS) son `IDEMPOTENCY_CONFLICT`.
El email a validadores muestra, para estos métodos, el método con el mismo nombre que la ficha (`Método: Coordenadas GMS / WGS84` o `Método: Coordenadas POSGAR 94 / Argentina 2`), `Valor ingresado: <texto canónico>` (única coordenada que lleva el correo; nunca el payload crudo) y `Sistema: GMS / WGS84` o `Sistema: POSGAR 94 / Argentina 2 · EPSG:22182`. GPS y mapa no suman esas dos líneas.

### Migración de la hoja (manual, **antes** de que alguien use estos métodos)
Producción tiene la hoja de 18 columnas. **No hay que migrar para seguir usando GPS / mapa**: el código nuevo **lee** la hoja de 18 columnas (las dos columnas nuevas salen vacías) y **sigue escribiendo
`GPS_ACTUAL` / `PUNTO_EN_MAPA` en ella** (esos dos campos van vacíos, no se pierde nada), de modo que desplegar el código antes de migrar no rompe nada. Los métodos nuevos, en cambio,
**exigen V2**: en una hoja V1 responden `ESQUEMA_DESACTUALIZADO` sin escribir (nunca se descarta un valor de auditoría en silencio).

1. Subir/desplegar el backend con el código nuevo (`CoordenadasConversion.js` es un archivo nuevo del proyecto).
2. Ejecutar **una vez** `migrarUbicacionCorreccionesV2()` desde el editor: **solo agrega** los encabezados que faltan (`coordenadaOriginalTexto`, `crsOriginal`) al final de la fila 1.
   Es **idempotente** (volver a correrla no escribe nada), no modifica datos existentes, no reordena ni borra columnas, no toca el Log ni `Usuarios`, corre bajo el mismo lock que las escrituras y
   **se niega** (error, sin escribir) si falta una columna base o si hay contenido a la derecha del encabezado. Las filas viejas quedan con esas dos celdas vacías.
   Distingue la **grilla física** (`getMaxColumns()`), los **encabezados** y el **contenido inesperado**: si la hoja tiene menos de 20 columnas físicas (p. ej. exactamente 18) agrega **solo las columnas que faltan, al final** (`insertColumnsAfter`) *antes* de escribir los
   encabezados; si ya hay lugar (p. ej. 26 columnas físicas y 18 encabezados) no toca la grilla. Si agrandar la grilla falla, no se escribe ningún encabezado.
3. Una instalación nueva no necesita migrar: `setupUbicacionCorreccionesSheets()` ya crea la hoja con las 20 columnas (y, si encuentra una hoja V1, la deja intacta y avisa en el log que falta migrar).

## Frontend — etapa 3: «Ingresar coordenadas» (GMS / WGS84)
El modal «Corregir ubicación» ofrece ahora **tres** opciones: *Usar mi ubicación actual*, *Elegir punto en el mapa* e *Ingresar coordenadas*. Dentro de *Ingresar coordenadas* hay un selector de sistema (**GMS / WGS84** y **POSGAR 94 / Argentina 2**, ver *etapa 4* abajo): la lista `UCORR_SISTEMAS_COORDENADAS`
(`js/ubicacionCorreccionLogic.js`) describe los sistemas y el panel de cada uno vive dentro de `#ucorr-coord-panel`.

**Pantalla** (`js/ubicacionCorreccion.js`, vista del mapa existente con un panel encima; no hay un segundo mapa): rótulo *GMS / WGS84*; **Latitud** (grados, minutos, segundos, N/S, por defecto **S**) y **Longitud**
(grados, minutos, segundos, E/O, por defecto **O**). Campos de texto (no `number`) para aceptar **coma o punto** decimal; segundos decimales. Nada se corrige en silencio: un valor inválido se informa tal cual.
- **Validación en vivo** con `js/coordenadasConversion.js` (el mismo algoritmo del backend): errores **en contexto** por eje (`aria-invalid` en el campo), un mensaje general si el punto cae fuera de Mendoza (con la pista del
  hemisferio, sin corregirlo solo). Con los campos vacíos o con un solo eje escrito no se muestra ningún error todavía. Mientras sea inválido: **no hay punto, ni conversión, y Continuar está deshabilitado**.
- Cuando es válido: se muestra *Equivale a (WGS84)*, el punto aparece en el mapa (junto con Irrigación y la corrección vigente, si existen; el mapa se encuadra con los tres) y se calcula la **distancia orientativa**
  (el backend recalcula): **> 250 m** observación obligatoria, **> 1 km** advertencia fuerte, **sin Irrigación** se continúa sin distancia. El formulario **no depende del mapa**: si no cargan las librerías se puede continuar igual.
- **Arrastrar el punto convertido**: el método pasa a **`PUNTO_EN_MAPA`**, la coordenada ingresada **deja de ser fuente activa** (no se envía `coordenadaOriginal`), se avisa *«Moviste el punto manualmente. Se guardará
  como punto elegido en el mapa.»* y se ofrece **«Restaurar coordenada ingresada»**, que vuelve al método `COORDENADAS_GMS`, **exactamente** a la coordenada derivada y recupera `coordenadaOriginal`. Escribir de nuevo en los
  campos retoma el control. Además hay una guarda pura (`evaluarPropuesta`): un `COORDENADAS_GMS` cuyo punto ya no es la conversión de lo ingresado **no es una propuesta válida**.
- Tocar el mapa en este modo no elige puntos (solo se arrastra el convertido).

**Payload de `COORDENADAS_GMS`** (`js/api.js`, lista blanca): `wellId, lat, lon, metodo='COORDENADAS_GMS', precisionGpsM=null, observacion, clientRequestId` y `coordenadaOriginal:{lat:{g,m,s,h}, lon:{g,m,s,h}}` (números;
minutos/segundos vacíos = 0; `h` = N/S, E/O). `lat`/`lon` van **sin redondear**. **No viajan** `coordenadaOriginalTexto`, `crsOriginal`, distancia, estado, email, nombre ni flags. GPS y mapa siguen mandando los 7 campos de siempre.
El `clientRequestId` es estable por contenido (incluye la coordenada ingresada): reintentar lo mismo lo reutiliza, cambiar un segundo genera otro.

**Ficha e historial**: método *Coordenadas GMS / WGS84*; si el backend devuelve `coordenadaOriginalTexto` / `crsOriginal` se muestran **aparte y en segundo plano** («Coordenada ingresada», con el sistema *GMS / WGS84*), sin reemplazar la lat/lon
normalizada. Las filas históricas con esos campos vacíos o ausentes se ven como siempre.

**Errores amigables** (nunca el código técnico): `COORDENADA_INVALIDA`, `XY_INVERTIDOS`, `COORDENADA_INCONSISTENTE`, `INVALID_COORDENADA_ORIGINAL`, `ESQUEMA_DESACTUALIZADO` y `FUERA_DE_MENDOZA` (ahora con la pista del hemisferio).

**Service Worker**: `js/coordenadasConversion.js` está en `SHELL_FILES` (y se carga antes que la lógica en `index.html`): la conversión funciona **sin conexión**. Sin dependencias externas.

**Antes de usarlo en producción**: desplegar el backend y ejecutar `migrarUbicacionCorreccionesV2()` (ver *Migración de la hoja*); sin eso el backend responde `ESQUEMA_DESACTUALIZADO`.

## Frontend — etapa 4: POSGAR 94 / Argentina 2 (EPSG:22182)
En *Ingresar coordenadas* un selector de dos botones elige el sistema (**GMS / WGS84** es el inicial; el flujo GMS no cambió). **Cambiar de sistema empieza de cero**: se vacían los campos de los dos
sistemas, se quitan errores, aviso de invertidos, aviso de «punto movido» y el punto del mapa, y Continuar queda apagado hasta que el nuevo sistema tenga datos válidos; nada de un sistema se reutiliza en el otro y
el `coordenadaOriginal` del sistema anterior nunca viaja. Volver a abrir el modal también empieza en GMS y vacío.

**Panel POSGAR**: título «POSGAR 94 / Argentina 2 · EPSG:22182», la ayuda **«En esta aplicación se ingresa X = Este e Y = Norte.»** (la convención del padrón NO se cambia; otras fuentes usan la inversa) y dos campos de
texto (`inputmode="decimal"`: teclado numérico, y texto para aceptar coma, punto y puntos de miles): **X / Este** e **Y / Norte**, en metros.
- **Números aceptados** (`coordenadas_parsearNumero` con puntos de miles): `2500000`, `2500000.50`, `2500000,50`, `2.500.000`, `2.500.000,50` (y lo mismo para Y), con espacios. Lo ambiguo o ilegible
  (`2.5e6`, `NaN`, `Infinity`, miles mal formados como `2.50.000`, un solo grupo de miles como `2.500`) **no se interpreta «como se pueda»**: queda en error (casi siempre «fuera de rango») y no se convierte.
- **Validación** (módulo de la etapa 1): valores finitos, X / Este y Y / Norte dentro del **rango de sanidad** (Este 2.300.000–2.800.000, Norte 5.800.000–6.500.000), transformación EPSG:22182 → WGS84 y, al final, la
  **caja de Mendoza** en WGS84 (autoridad geográfica). Con un solo campo escrito el error de ese campo aparece ya; con los dos vacíos o con uno solo bien escrito no se muestra ningún error.
- **X/Y invertidos**: si el módulo detecta que están intercambiados se muestra «Parece que X e Y están intercambiados…» y el botón **«Intercambiar X e Y»**. **Nunca se intercambian solos**: los campos quedan
  como los escribió la persona, no hay punto y Continuar está apagado. Solo al tocar el botón se intercambian los textos tal cual, se vuelve a validar, a convertir y a mostrar el punto; el payload refleja los
  valores *después* de esa acción.
- **Mapa y distancia**: igual que GMS (Irrigación + vigente fijos, punto nuevo movible, `fitBounds`, distancia orientativa, > 250 m observación obligatoria, > 1 km advertencia fuerte, sin Irrigación se continúa sin
  distancia; el formulario sigue siendo utilizable si no carga el mapa). El `fitBounds` deja más margen arriba para que el pin no quede cortado.
- **Arrastrar el punto**: pasa a `PUNTO_EN_MAPA`, `coordenadaOriginal` deja de enviarse, aviso *«Moviste el punto manualmente. Se guardará como punto elegido en el mapa.»* y **«Restaurar coordenada ingresada»**
  (vuelve exactamente al punto derivado de X/Y, al método POSGAR y recupera `coordenadaOriginal`; los X/Y escritos se conservan). Si se modifica X o Y después de arrastrar, la entrada POSGAR vuelve a mandar.

**Payload de `COORDENADAS_POSGAR94_AR2`**: `wellId, lat, lon, metodo, precisionGpsM=null, observacion, clientRequestId` y `coordenadaOriginal:{x, y}` (números; x = Este, y = Norte). `lat`/`lon` son la conversión local de
**máxima precisión** (sin redondear; el backend las compara con su conversión sin redondear a 2 cm y recién después redondea a 6 decimales). No viajan `coordenadaOriginalTexto`, `crsOriginal`, distancia, estado,
email, nombre ni flags.

**Ficha e historial**: método *Coordenadas POSGAR 94 / Argentina 2*; si el backend devuelve `coordenadaOriginalTexto` / `crsOriginal` se muestran aparte (*Coordenada ingresada:* `X(Este)=2500000.00, Y(Norte)=6350000.00` y
*Sistema:* `POSGAR 94 / Argentina 2 · EPSG:22182`; para GMS, *Sistema:* `GMS / WGS84`). La lat/lon WGS84 normalizada sigue siendo el dato principal y las filas históricas sin esos campos se ven igual que antes.

**Contrato**: el frontend conoce ya los 4 métodos y todos los errores del backend (`UCORR_METODOS` = `UBICACION_CORR_METODOS`); no quedan listas temporales de «solo backend».
**Offline**: `js/coordenadasConversion.js` está en el precache del service worker y no usa red ni librerías.

## Frontend — etapa 5: validación (bandeja, detalle, Validar / Rechazar)
**Qué hace.** Quien tiene `ubicacion=SI` **y** `ubicacion_validar=SI` resuelve las correcciones `PROPUESTA` desde la app, sin tocar la hoja. **No hay endpoints nuevos**: se reutilizan los que el backend ya tenía (y tenía probados):

| Uso | Acción (`POST action`) | Permisos que exige el backend |
|---|---|---|
| Bandeja (lista de todas las pendientes) y total del indicador | `getCorreccionesUbicacionPendientes` | `ubicacion` + `ubicacion_validar` |
| Ubicación validada vigente del pozo (para el mapa y el aviso de reemplazo); detecta «ya resuelta» | `getCorreccionesUbicacionPozo` | `ubicacion` |
| Validar | `validarCorreccionUbicacion` `{correccionId}` | `ubicacion` + `ubicacion_validar` |
| Rechazar | `rechazarCorreccionUbicacion` `{correccionId, motivo}` (motivo obligatorio, ≤ 300) | `ubicacion` + `ubicacion_validar` |

**Flujo desde el indicador.** «Correcciones pendientes: N» (hub) → bandeja (un renglón-botón por propuesta: pozo, quién propuso y cuándo, método, coordenada WGS84, original ingresado y sistema si hay, distancia a Irrigación, observación y advertencias *Más de 250 m* / *Más de 1 km*) →
detalle con **mapa propio** (Irrigación fija, validada vigente si hay, y la propuesta con el pin; ninguno se puede mover) y los datos para decidir → **[Validar ubicación]** o **[Rechazar]**.
**Flujo desde el pozo.** La tarjeta *Pendiente* de la ficha trae **[Validar]** y **[Rechazar]** (solo con los dos permisos): abren **el mismo detalle y la misma confirmación** (`ubicacionValidacionController_abrirDetalle`); no hay lógica ni llamadas duplicadas.
**Validar** pide confirmación «¿Validar esta ubicación?»: pasa a ser la vigente, la validada anterior (si hay) queda `SUPERADA` y la ubicación de Irrigación **no se modifica ni se elimina**. **Rechazar** pide un motivo obligatorio y «Confirmar rechazo»; la rechazada nunca es vigente. Sobre la **propia** propuesta no se ofrece Rechazar (el backend responde `SELF_REJECTION`); validarla sí se puede.

**Después de resolver** (sin recargar la app): el indicador se vuelve a pedir (se oculta con 0), la ficha del mismo pozo se vuelve a leer y se pinta (la pendiente desaparece, cambia el historial y la vigente; `ubicacionCorreccionController_alResolver`), y la bandeja abierta recarga su lista con el aviso «Ubicación validada.» / «Corrección rechazada.».
**Estados y errores:** *Validando…* / *Rechazando…* (botones deshabilitados; ni cerrar ni Escape mientras se envía), *Esta corrección ya fue resuelta.* (`INVALID_TRANSITION` / `CORRECCION_NOT_FOUND`: otra persona se adelantó; se refresca todo), error de conexión con reintento, sesión vencida (cierra sesión) y usuario deshabilitado (su pantalla).
Doble toque: un solo envío (el flujo devuelve la misma promesa y el botón se deshabilita).

**Permisos (fail-closed).** Todo pasa por `ubicacionCorreccionLogic_puedeValidar` (`ubicacion === true` y `ubicacion_validar === true` exactos): sin ellos no se pinta el indicador, no se abre la bandeja ni el detalle, no hay botones en la ficha y, aunque alguien fuerce el DOM, el flujo no envía nada (el permiso se consulta **en cada envío**).
El backend sigue siendo la autoridad (permisos, transiciones, `SELF_REJECTION`): el frontend solo evita pedidos que ya sabe que fallarían.
Las correcciones directas (corregir + validar) siguen naciendo `VALIDADA` y no pasan por la bandeja.

**Límites conocidos.** La vista de pendientes del backend no trae el titular del pozo ni su nombre (solo `wellId`): mostrarlo exigiría el permiso `datos` y una llamada por pozo, y queda fuera de esta etapa. Si hay más de 200 pendientes el backend entrega las más antiguas y la bandeja avisa «Se muestran las N más antiguas de M».
**No se toca:** el mapa provincial y su overlay de correcciones validadas, Cerca Mío, selección geográfica, Reemplazos ni NE. **Archivos:** `js/ubicacionValidacion.js` (DOM: bandeja, detalle, mapa, confirmaciones), `js/ubicacionCorreccionLogic.js` (reglas puras), `js/api.js` (`apiValidarCorreccionUbicacion`, `apiRechazarCorreccionUbicacion`),
`js/ubicacionCorreccion.js` (botones de la ficha + `alResolver`), `js/ubicacionPendientes.js` (indicador-botón), `index.html` (`#uval-overlay`), `css/styles.css` (`.uval-*`), `sw.js` (precache) y `js/app.js` (contexto compartido y cierre de sesión).

## Punto operativo del pozo — etapa 1 (módulo puro, todavía sin UI)
`js/ubicacionOperativaLogic.js` define **una sola regla** para responder «dónde está el pozo»; todavía **no lo usa ninguna pantalla** (ni `index.html`, ni el service worker, ni el backend). Después lo heredarán el Mapa de pozos, Cerca Mío, la selección y los reemplazos,
aplicándolo **una vez** en `mapaDataset_obtener` (no se modifica `pozos.json`). Fuente, estado y confianza son tres campos **distintos**.

**Reglas V1:** **R1** corrección VALIDADA vigente → su lat/lon (fuente `CAMPO_CORREGIDA`, estado `VALIDADA_CAMPO`, confianza A); **R2** si no, el punto del padrón (`DISPONIBLE` = `unica`, `COINCIDENTE` = `corroborada`); **R0** si no, sin punto
(`SIN_COORDENADAS`, o `DISCREPANCIA` = `dudosoLeve` / `revisar` / `revisarGrave`: el padrón no elige una candidata). Revertir devuelve el pozo a su **base** (no revive una SUPERADA). La coordenada de Irrigación nunca se borra: queda en `base`.
No entran todavía NE, Relevamiento, «Confirmada en campo» ni candidatos satelitales.

**Punto del dataset (camino caliente, llega a todo usuario activo → mínimo):** `{wellId, lat, lon, estado:'C'|'D'|'V', cuenca, profundidad, tramosFiltrantes, surgencia}`; con override suma `{estado:'V', fuente:'CAMPO', base:{lat,lon,estado}|null, vts}`.
Nunca lleva autor, observación, email, motivo, historial, método ni `correccionId`. `base` solo existe en puntos con overlay (lo necesitan el aviso de Reemplazos y la futura opción «Mostrar ubicaciones/fuentes anteriores»; `null` si el pozo no tenía punto).
Un pozo que hoy no está en `pozos.json` se **enriquece** con profundidad, tramos filtrantes y surgencia del padrón (existen para 7.498, 6.207 y 5.422 de los 10.376 pozos sin punto); la **cuenca no se recalcula** (el padrón no la guarda): queda `null` («Sin dato») y la del pozo movido se mantiene.
**Punto completo (ficha / análisis):** `{wellId, lat, lon, fuente, estado, confianza, operativo, regla, etiqueta, base, override, evidencias:[], anomalias, version}`.
**Etiquetas:** `D` Ubicación disponible · `C` Ubicación coincidente · `V` Validada en campo (el rename visible de «Ubicación confirmada» → «Ubicación coincidente» y el chip «Validada en campo» se hacen en la etapa de UI). «Confirmada en campo» queda reservada para la futura confirmación física.
**Requisito aprobado para la integración visual (NO implementado; después de cerrar la etapa 2 del backend): «Ubicaciones conocidas» en la ficha.** Cuando un pozo tenga una o más coordenadas conocidas de distintas fuentes (Irrigación/padrón, Validada en campo, Nivel Estático, Relevamiento, Confirmada en campo, y las que se agreguen; sin límite de dos),
cada una se muestra por separado con su **FUENTE** (nunca «coordenada 1/2»), su lat/lon y un botón **«Abrir en Google Maps»** propio. También con una sola coordenada (UX consistente) y para cualquier coordenada válida; una inválida no genera enlace.
- **Enlace:** `https://www.google.com/maps/search/?api=1&query=LAT,LON` generado con la lat/lon de ESA fuente, en pestaña externa, sin API key, sin Maps JavaScript API y sin servicios pagos. La URL lleva **solo** `lat,lon`: nunca wellId, titular, observación, autor, email, motivo ni historial.
- **Punto operativo:** la sección marca cuál es el que usa el sistema (`[PUNTO OPERATIVO]`, p. ej. «Validada en campo»); abrir otra coordenada en Google Maps es solo consulta y **no** cambia el punto operativo. Para las demás fuentes se muestra «A XX m del punto operativo» (nunca la matriz N×N); una discrepancia importante se destaca.
- **Previsto a futuro, junto a cada punto:** «Ver en mapa interno», «Abrir en Google Maps» y eventualmente «Cómo llegar».
- **Tests futuros:** una sola coordenada; dos; tres o más fuentes; coordenada inválida sin enlace; cada botón abre SU lat/lon; punto operativo bien identificado; distancia respecto del operativo; sin datos personales en la URL; móvil y escritorio.

### Etapa 2 (backend): endpoint `getUbicacionesValidadas` (delta de ubicaciones validadas vigentes)
**Todavía no lo consume nadie** (ni `mapaDataset_obtener`, ni el mapa, Cerca Mío, selección, Reemplazos o la ficha): `js/api.js` ya tiene `apiGetUbicacionesValidadas(sessionToken)` para probar el contrato.
- **Contrato** (`POST action: getUbicacionesValidadas`, solo `sessionToken`): `{status:'ok', data:{ubicaciones:[{wellId, lat, lon, vts}]}}`, ordenado por `wellId` (determinista), un único elemento por pozo. Nada de email, nombre, observación, método, motivo, ids (`correccionId`), coordenada original, CRS, distancia, snapshot ni datos del padrón:
  es la ubicación final que reemplaza a la base que esos mismos usuarios ya ven en el mapa. **`vts`** = `timestamp` del evento `VALIDADA` vigente en `UbicacionCorreccionesLog` (el instante en que esa ubicación pasó a ser la vigente; **no** la fecha de la propuesta).
- **Qué genera delta:** solo una corrección en estado `VALIDADA`. `SUPERADA`, `REVERTIDA`, `RECHAZADA`, `PROPUESTA` e `INCONSISTENTE` no. Una `REVERTIDA` deja al pozo sin delta (vuelve a su base; no revive la `SUPERADA` anterior). Se parte de `ubicacionCorreccionService_leerDerivadas()` (la misma cadena de estados de la ficha y la cola) y la vigente de cada pozo se elige con
  `ubicacionCorreccionService_elegirVigente()`, **la misma rutina que usa `getPorPozo`** (si por una inconsistencia hubiera dos `VALIDADA`, gana la más reciente por fecha de propuesta y, en empate, la fila posterior). Una vigente con coordenada no numérica o fuera de Mendoza no sale (y no se «rescata» una anterior).
- **Permisos:** cualquier usuario **activo**, igual que `getMapaPozos` (sin `ubicacion`, `ubicacion_corregir` ni `ubicacion_validar`): todos deben ver la misma posición del mismo pozo. Sesión inválida → `UNAUTHORIZED`; usuario inactivo → `USER_DISABLED`; falla del servicio → `SERVICE_UNAVAILABLE`. No se audita por wellId.
- **Caché** (`CacheService`, script): clave `ubicaciones_validadas_v1`, TTL **120 s**, contenido = el payload ya sanitizado. Si el JSON supera **90.000 caracteres** (límite de 100 KB por valor; ~1.200 pozos validados) no se cachea y se calcula en cada llamada (queda un log): si algún día se llega ahí, hay que partir el valor en varias claves.
- **Invalidación inmediata**, después de la escritura confirmada (`SpreadsheetApp.flush`), dentro del lock: auto-validación al proponer (también el reintento que completa una creación directa cortada), `validarCorreccionUbicacion` y `revertirCorreccionUbicacion`. **No** invalidan: rechazar, crear una `PROPUESTA` normal ni un reenvío idempotente (no cambian la vigente).
  Si el caché falla, la operación principal **no** se revierte (se loguea y el TTL de 120 s acota el desfasaje).
- **Carrera lector/escritor:** la invalidación deja la marca `ubicaciones_validadas_v1_inval` (hora, 180 s). Un lector que empezó a calcular hasta 2 s antes de esa marca (o después de ella) calcula y responde, pero **no guarda** su resultado en el caché; así un cálculo anterior a la escritura no queda cacheado como vigente. Consecuencia: durante ~2 s después de una validación las lecturas no se cachean.
- **Fallback del cliente (etapa de integración, aprobado):** si el endpoint falla o no existe, el mapa sigue con el dataset base y muestra el aviso discreto «No se pudieron actualizar las ubicaciones validadas. Se muestran las ubicaciones base.»; si vuelve, se quita el aviso y se aplica el overlay. El cliente refresca a los 60 s y tras validar/revertir.
- **Seguridad:** la respuesta no expone nada que no se vea ya en el mapa; autor, observación, método, motivo e historial siguen detrás de `getCorreccionesUbicacionPozo` (`ubicacion`) y la cola (`ubicacion` + `ubicacion_validar`). Tests: `backend/test/UbicacionValidadasDelta.test.js`.
- **Metadata registral de pozos nuevos (recomendación, NO implementada):** un pozo con ubicación validada que no está en `pozos.json` necesita `profundidad`, `tramosFiltrantes` y `surgencia` (existen en el padrón para 7.498, 6.207 y 5.422 de los 10.376 pozos hoy sin punto); la `cuenca` queda `null` (no existe en el padrón y no se recalcula). Preferencia: un **índice liviano por wellId** generado offline junto con `pozos.json` (solo esos tres campos, solo para los pozos sin punto),
  servido por separado; descartados: meterlo en `getUbicacionesValidadas` (debe seguir mínimo), leer el padrón por pozo en el backend (un archivo de departamento por consulta) y depender de datos del frontend (no los tiene en memoria). El módulo `ubicacionOperativaLogic` ya recibe esa metadata por inyección (`obtenerRegistral`).

### Etapa 3 (frontend): el punto operativo en el dataset del mapa
`mapaDataset_obtener` (`js/mapaDataset.js`) es **el único lugar** donde se aplica: dataset base (`getMapaPozos`, `pozos.json` intacto) + `getUbicacionesValidadas` + `ubicacionOperativaLogic_aplicarOverlay`. El Mapa de pozos, Cerca Mío, la selección (polígono, radio, multiselección) y Buscar reemplazo lo heredan sin reglas propias; un pozo con ubicación validada aparece en SU lugar con estado `V` y uno que no tenía punto en el mapa aparece por ella. Un solo punto por `wellId`.
- **Formato:** `{status:'ok', data:{pozos, metadata, degradado, operativo:{aplicadas, nuevos, descartadas}}}`. El arreglo es el mismo objeto mientras no cambien el dataset base ni los deltas (los consumidores guardan la referencia).
- **Caché del cliente:** el dataset base una vez por sesión (como siempre); los deltas en memoria con **60 s** de vigencia, sin polling, y `mapaDataset_invalidarDeltas()` tras validar (cola o ficha), «ya resuelta» por otra persona y correcciones directas (corregir + validar). Rechazar no invalida.
- **Fallback:** si `getUbicacionesValidadas` falla (red, sesión, backend viejo sin la acción) el mapa **no se rompe**: usa el dataset base, `data.degradado = true` y la UI muestra «No se pudieron actualizar las ubicaciones validadas. Se muestran las ubicaciones base.» (mapa y Cerca Mío; sin códigos técnicos). Cada apertura reintenta; si funciona, se aplica el overlay y se quita el aviso. No se muestran los deltas viejos si la renovación falla.
- **Estados:** `D` Disponible (una fuente), `C` **Coincidente** (2+ fuentes del padrón coinciden; **no** es una validación humana; antes «Confirmada»), `V` **Validada en campo** (corrección validada). Filtros: ninguno activo = todo, uno = ese estado, varios = unión; los conteos incluyen `V`. Estilo de `V`: verde `#43a047` con borde `#14532d` y un punto algo más grande; el chip «Validada en campo» hace de leyenda.
  El rename visible «Confirmada» → «Coincidente» alcanza el chip, el popup, la exportación de la selección, Buscar reemplazo y la ficha («Ubicación coincidente»). «Confirmada en campo» sigue reservada para la futura confirmación física.
- **Delta con distancia 0:** una validada idéntica a la base **igualmente** pasa a `V` (la validación humana cambia el estado, no solo lat/lon); casos reales de producción 01-0012 (≈22,2 m) y 14-0001 (GMS a 0,0 m con una anterior SUPERADA) están en `js/mapaDatasetOperativo.test.js`.
- **Reemplazos:** el aviso «la coordenada de este pozo en el padrón de Provincia está a X» compara contra `punto.base` (Irrigación) cuando el punto tiene overlay; sin base no se inventa la comparación. La referencia NE sigue siendo la coordenada propia del punto NE.
- **Pozos nuevos (sin punto en `pozos.json`):** entran como `V`, `base: null`, `cuenca: null`; `profundidad`, `tramosFiltrantes` y `surgencia` quedan «Sin dato» porque el frontend **no tiene** esa metadata liviana en memoria (el índice de búsqueda trae solo titular y NC16 con `datos`). Cuando exista el índice liviano por wellId recomendado arriba, se inyecta con `obtenerRegistral`.
  La cuenca de un pozo movido se mantiene (no se recalcula). Auditoría futura: «coordenada operativa fuera o cerca del límite de la cuenca declarada».
- **Orden de despliegue seguro:** (1) backend (`gas:push` + versión + deploy: la acción nueva queda inactiva hasta que alguien la llama; no cambia nada de lo existente); (2) frontend (push a GitHub Pages). Al revés también es seguro: sin el backend nuevo el overlay cae al fallback (mapa con la base y el aviso discreto).
- **Fuera de esta etapa (sin tocar):** NE como evidencia operativa, Relevamiento, «Confirmar ubicación», tracks, «Mostrar ubicaciones anteriores», candidatos satelitales y «Ubicaciones conocidas» / «Abrir en Google Maps».

**Decisiones aprobadas para las etapas siguientes:** endpoint `getUbicacionesValidadas` (cualquier usuario activo, payload mínimo `wellId, lat, lon, vts`); caché de backend 120 s con invalidación al auto-validar, validar y revertir; refresco del cliente a los 60 s e invalidación al validar o revertir (rechazar no cambia la vigente);
si el endpoint falla el mapa sigue con la base y muestra un aviso discreto. **Auditoría futura pendiente:** «coordenada operativa fuera o cerca del límite de la cuenca declarada».

## Ubicaciones conocidas (ficha del pozo) — solo lectura

Sección de la ficha de **Ubicación** que trata **cada coordenada conocida por separado** (`js/ubicacionesConocidasLogic.js` puro + `js/ubicacionesConocidas.js` DOM; reemplaza al antiguo «Fuentes (detalle técnico)»).

- **Fuentes que lista** (todas de lectura): *Reporte Pozos* (`ubicacion.coordenadas`), *Irrigación* o *Irrigación (1..N)* (`ubicacion.coordenadasProvincia[]`; el número es **posicional**) y *Validada en campo* (la corrección VIGENTE, que la ficha ya lee con `getCorreccionesUbicacionPozo`). El padrón solo trae `x, y` (POSGAR 94 / Argentina 2): la lat/lon de cada fuente se calcula en el cliente con `coordenadas_posgarAWgs84` (misma conversión validada contra pyproj); **no hace falta backend nuevo**.
- **Punto operativo:** lo dice `ubicacionOperativaLogic_resolver` (R1 validada en campo, R2 punto del padrón, R0 ninguno); este módulo solo identifica **cuál** de las fuentes es (por `x/y` exactos del padrón; respaldo: la más cercana a ≤ 2 m). Sin punto operativo (discrepancia) ninguna fuente lo es y no se calculan distancias.
- **Por fuente:** nombre, lat/lon, `x/y` del padrón, indicador «Punto operativo», «A XX m del punto operativo» (no hay matriz N×N) y «Abrir en Google Maps». Una coordenada inválida (ausente, no numérica, fuera de Mendoza) se lista como «Coordenada no válida», sin enlace ni marcador.
- **Google Maps:** `https://www.google.com/maps/search/?api=1&query=LAT,LON` con 5 decimales y nada más (sin `wellId`, titular, autor, observación, email, motivo ni historial; sin API key). Los enlaces viejos de la ficha (`maps?q=`) no se tocaron.
- **«Ver todas en el mapa»:** visor interno de **solo lectura** (`#ucon-overlay`, mismo patrón que el modal de correcciones): un marcador por fuente válida (color por tipo + etiqueta; el operativo con aro oscuro y ★, siempre arriba), popup con fuente / lat,lon / distancia / «Abrir en Google Maps», leyenda tocable que centra y abre cada popup (sirve cuando dos puntos se superponen), capas Mapa/Satélite. Si el mapa no carga, la lista y los enlaces siguen sirviendo. **No llama al backend.**
- **No incluye (a propósito):** «Validar fuente» / «Descartar fuente» (ver abajo), propuestas pendientes ni correcciones históricas (SUPERADA / RECHAZADA / REVERTIDA).

### Modelo actual de las fuentes (auditoría para «aceptar / descartar» una fuente)

| Qué | Dónde vive | Quién la escribe | Mutable |
| --- | --- | --- | --- |
| **Reporte Pozos** (1 por pozo) | `Reporte Pozos *.csv` → `scripts/reindex_pozos.py` → JSON por departamento en Drive (`ubicacion.coordenadas {x,y}`) | solo el indexador | **No** desde la app; se **reemplaza entero** en cada reindexado |
| **Irrigación (1..N)** | `Coord_pozos_provincia.csv` → mismo JSON (`ubicacion.coordenadasProvincia[] {x,y}`, orden = orden del CSV) | solo el indexador | **No** desde la app; en un reindexado puede cambiar el orden o la cantidad (el «(2)» **no es una identidad estable**) |
| **Resultado del padrón** | mismo JSON (`ubicacionResuelta`: `sinCoordenadas / unica / corroborada(≤10 m) / dudosoLeve(≤50) / revisar(≤500) / revisarGrave`) y `pozos.json` (`D/C`) | indexador (offline) | **No**; es un cálculo, no una decisión humana |
| **Correcciones** (PROPUESTA / VALIDADA / RECHAZADA / SUPERADA / REVERTIDA) | Sheets `UbicacionCorrecciones` (20 col.) + `UbicacionCorreccionesLog` | los usuarios, por la app | Filas **append-only**; el estado se **deriva** del log |

- **¿Existe hoy un estado válida / descartada / ignorada / preferida para una fuente del padrón?** **No.** Los únicos estados de una fuente son los del resultado calculado por el indexador. Validar / rechazar solo opera sobre **propuestas** de `UbicacionCorrecciones` (necesita un `correccionId`).
- **«Validar Reporte Pozos» hoy:** no tiene significado propio. Lo más cercano es **proponer una corrección en esa misma coordenada** (distancia ≈ 0) y validarla: queda **«Validada en campo»** (`V`). Es una verificación física, no una revisión de gabinete. Pasó con 14-0001 (GMS a 0,0 m).
- **«Descartar Irrigación (2)» hoy:** no hay camino. Una corrección validada la pisa (R1) pero no marca la fuente como equivocada y se pierde esa señal.
- **No confundir:** (A) validar / rechazar una **propuesta de corrección** de un usuario ≠ (B) aceptar / descartar la **coordenada de una fuente** registral. (B) necesita primero una definición de producto.

### Propuesta (no implementada): capa de decisiones sobre fuentes

Principio obligatorio: **la coordenada original nunca se borra ni se modifica**; una fuente descartada se conserva y queda marcada «descartada / no operativa».

- **Hoja `UbicacionFuenteDecisiones` (append-only, una fila por evento, mismo libro que las correcciones):** el esquema FINAL (14 columnas, secuencia global, eventos `ACEPTADA` / `DESCARTADA` / `ACEPTACION_QUITADA` / `RESTAURADA`) quedo definido e implementado en el backend; ver `docs/ubicacion-fuente-decisiones.md` (§3 y «Etapa 2»). El estado vigente de una fuente se deriva reproduciendo los eventos por `secuencia`.
- **Identidad de la fuente = `(wellId, fuenteTipo, x, y)`, no «Irrigación (2)»:** si un reindexado cambia o saca esa coordenada, la decisión queda **obsoleta** (se conserva y se muestra en el historial, deja de aplicar).
- **Permisos:** reutilizar `ubicacion_validar` (nada de permiso nuevo por ahora); fail-closed como el resto.
- **Interacción:** (1) **Validada en campo gana siempre (R1)**: con una vigente, las decisiones sobre fuentes son informativas. (2) **Punto operativo:** una fuente DESCARTADA sale del cálculo del padrón (p. ej. 3 fuentes con una descartada → se recalcula con las 2 restantes; si no queda ninguna, `SIN_COORDENADAS`). Como ese cálculo hoy es offline (Python), el backend necesitaría **replicarlo en JS** (con test de paridad contra los mismos casos) y entregar un **delta** igual que `getUbicacionesValidadas`. (3) **Overlay / Cerca Mío / selección / reemplazos:** heredan el cambio **sin tocar nada**, porque todos consumen `mapaDataset_obtener` (el único punto del overlay). (4) **Revertir** una validada en campo vuelve al padrón **con las decisiones aplicadas**. (5) Una fuente ACEPTADA nunca se llama «validada en campo»: sería otra categoría («aceptada por revisión») para no repetir el problema de «Confirmada».
- **Necesita backend y esquema nuevo:** sí (hoja, repositorio, servicio, 2 endpoints —registrar decisión y leer decisiones/deltas—, permisos, invalidación de caché, tests). Sin cambios en el padrón ni en `UbicacionCorrecciones`.
- **Definiciones de producto previas:** quién puede decidir (solo `ubicacion_validar`); si DESCARTAR cambia el punto operativo o solo la etiqueta en una primera fase; qué hace exactamente ACEPTAR (informativo, o desempate en discrepancias); si se puede descartar *Reporte Pozos*; qué pasa si se descartan todas; cómo se nombra el estado resultante en el mapa (`D/C/V` o uno nuevo); y cómo se avisa una decisión obsoleta tras un reindexado.
- **Etapas sugeridas:** (1) esquema + servicio + tests, sin UI; (2) delta + overlay (un solo punto: `mapaDataset_obtener`); (3) botones «Aceptar» / «Descartar» (con motivo y confirmación) en el popup del visor.

## Ajustes visuales (prueba real en celular)
- **Pantalla de arranque:** logo de Irrigación (`#irr-logo`, el símbolo oficial que ya está en `index.html`; no se agregó ningún recurso), «Consulta de Pozos», el pozo animado y «Cargando…», centrados en el viewport real (`100dvh` con respaldo `100vh`, descontando el padding del `body` y las safe areas); en escritorio sin tarjeta. `prefers-reduced-motion` sigue desactivando las animaciones del pozo.
- **Cerca Mío:** «Ver todos en el mapa» y «Usar estos pozos» quedan en `.cercamio-acciones` (columna flex, `gap: 14px`, `padding-bottom: env(safe-area-inset-bottom)`).

## E4-1 — Primera ubicación de un pozo (backend; sin frontend todavía)

Caso real: **14-0123** aparece en la aplicación por su ITF (Perfil) pero **no figura en el padrón actual** (`getWellLocation` → `WELL_LOCATION_NOT_FOUND`, `getWellRecord` → `WELL_RECORD_NOT_FOUND`). Hasta E4 no había forma de aportarle una coordenada: el snapshot de Irrigación rechazaba todo pozo fuera del padrón y `getWellLocation` no ofrecía nada. **No se crea ningún sistema paralelo**: se reutiliza `UbicacionCorrecciones` (misma hoja, mismos eventos, misma cola, misma capa V).

### Política de existencia — `PozoExistenciaService.js` (único lugar)
`pozoExistenciaService_verificar(wellId)` decide si el pozo «existe para la aplicación». Lo usan solo dos puntos: el snapshot de Irrigación (`ubicacionCorreccionService_snapshotIrrigacion`) y el handler de `getWellLocation`. Ningún otro endpoint hace sus propios lookups.
- **Formato primero:** `DD-PPPP` y departamento 01 a 19 (la misma regla de `validateSessionAndWellId`); no se amplía el universo de ids.
- **Fuentes válidas, en este orden, y se corta en la primera que confirma:** (1) **Padrón** (`registryService_getWellLocation`; si está, no es «fuera del padrón»); (2) **ITF** (`<wellId>.jpg` en la carpeta institucional, `driveProfileRepository_existe`: solo existencia, no se descarga el archivo y no depende del índice de miniaturas); (3) **NE** (`nivelesEstaticosRepository_getPunto`: prueba existencia; su coordenada no se usa); (4) **corrección previa** (cualquier fila del pozo en `UbicacionCorrecciones`, en cualquier estado: si una primera ubicación se creó válidamente cuando existía ITF o NE y esa fuente desaparece, las correcciones siguientes no quedan bloqueadas).
- **No prueban existencia (v1):** Fotos, evaluaciones de reemplazo, historial de Búsquedas. Cualquiera de las dos últimas se genera con un `wellId` de formato válido (circulares); Fotos solo repite padrón/NE.
- **Fail-closed:** una fuente que falla nunca se vuelve «no existe» ni «existe». Alguna confirma → existe (las siguientes ni se consultan). Todas dicen «no» → `WELL_NOT_FOUND`. Ninguna confirma y alguna no se pudo verificar → `SERVICE_UNAVAILABLE`. Si el **padrón** no se puede consultar el resultado es indeterminado de inmediato: sin saberlo no se puede afirmar «fuera del padrón» (eso define el snapshot), y no se adivina con otra fuente. Una función de lectura inexistente cuenta como fuente no verificable. El detalle técnico va a Logger (con el `wellId`, sin datos personales).
- **Cache:** solo los **positivos** de las fuentes que no son el padrón, por pozo, ~10 minutos (`pozo_existe_v1_<wellId>`). Nunca negativos ni indeterminados; una falla de `CacheService` no rompe la verificación.
- El resultado (`existe`, `enPadron`, `fuentes`, `indeterminado`) es de uso interno: no se expone tal cual al cliente.

### Snapshot de Irrigación — tres situaciones
| Situación | irrLat / irrLon | irrEstado | irrFuente | distanciaM / advertencia | observación |
|---|---|---|---|---|---|
| en el padrón con coordenada | la del padrón | `corroborada` / `unica` | la del padrón | se calcula (reglas de siempre) | obligatoria > 250 m (como siempre) |
| en el padrón **sin** coordenada | vacíos | `sinCoordenadas` (o `revisar*`) | vacía | vacía / falso | **opcional** |
| **fuera del padrón** pero conocido por otra fuente | vacíos | **`noEnPadron`** | vacía | vacía / falso | **obligatoria** (`OBSERVACION_REQUERIDA`: «Indicá por qué se incorpora una ubicación para un pozo que no figura en el padrón actual.») |

`noEnPadron` no es `sinCoordenadas`: son situaciones distintas y quedan distinguibles en la hoja. **No se inventa ninguna coordenada de Irrigación.** `padronPeriodo` guarda el período del padrón vigente. Sin migración de hoja: `irrEstado` es texto libre (no hay lista cerrada ni validación de datos en la hoja ni en el código) e `irrLat` / `irrLon` ya aceptan vacío (es lo que se escribe hoy para `sinCoordenadas`). No se aplican reglas de distancia (no hay referencia). La evidencia de existencia (qué fuente conocía el pozo) va a Logger; **no** a `irrFuente`, que es la fuente de la coordenada de Irrigación.

### Permisos (sin cambios)
`ubicacion` + `ubicacion_corregir` origina; con además `ubicacion_validar` se **autovalida** (pasa a V); sin `ubicacion_validar` queda **PROPUESTA**. `ubicacion_validar` sin `corregir` valida propuestas ajenas pero no origina. Solo `ubicacion` no escribe. El orden de chequeos no cambia: sin permiso no se verifica la existencia.

### `getWellLocation` fuera del padrón
Si el pozo no está en el padrón pero `pozoExistenciaService_verificar` confirma que existe, devuelve `ok` con una vista **mínima y sintética**: `{wellId, coordenadas: null, coordenadasProvincia: [], ubicacionResuelta: {estado: 'noEnPadron'}}` (sin lat/lon, sin ficha registral) y deja `OK_NO_EN_PADRON` en el Historial. Sin evidencia: `WELL_LOCATION_NOT_FOUND`; indeterminado: `SERVICE_UNAVAILABLE`. `getWellRecord` **no cambia** (sigue sin ficha). `RegistryService` / `RegistryRepository`, las decisiones sobre fuentes registrales y NE operativo no conocen el helper: esas decisiones siguen exigiendo padrón.

### `primeraUbicacion` y `candidataPrimeraUbicacion` (derivados, sin columna)
Cada vista de corrección suma **dos booleanos distintos** (payload mínimo, nada interno más): no se mezclan «podría convertirse en la primera» e «históricamente fue la primera validada».

- **`primeraUbicacion`** — hecho histórico e inmutable: *esta corrección llegó efectivamente a ser la primera ubicación VALIDADA EN CAMPO del pozo*. Es true solo si (1) el padrón no tenía punto del pozo cuando se propuso (sin coordenada, snapshot `sinCoordenadas` o `noEnPadron`; con fuentes en desacuerdo —`revisar*`— sí tenía ubicaciones), (2) la corrección tiene un evento **VALIDADA** (también una autovalidada) y (3) ninguna otra corrección del pozo fue VALIDADA antes. Pendiente → false; rechazada → false; la primera validada → true; **si esa V se revierte o la supera otra, sigue siendo true** (ocurrió; la marca no vuelve a quedar disponible); toda V posterior → false.
- **`candidataPrimeraUbicacion`** — para la UI de propuestas: *si esta propuesta se validara ahora sería la primera ubicación validada del pozo*. Es true solo si la corrección está **PROPUESTA** (una rechazada, validada, superada o revertida deja de ser candidata), cumple (1) y **ninguna corrección del pozo llegó jamás a VALIDADA** (aunque esa V ya esté revertida o superada). Se evalúa con el historial de hoy: si otra propuesta se valida primero, las demás dejan de ser candidatas. La bandeja puede rotular una pendiente como «Primera ubicación conocida del pozo» con esta marca; el historial y la auditoría usan `primeraUbicacion`.

Orden de las validaciones: por el instante del evento VALIDADA; si coinciden (mismo milisegundo) decide el orden en que se propusieron las correcciones (`orden`: la hoja es append-only). **Fail-safe** ante un log dudoso (nunca se afirma sin comprobar; ante la duda es false): una corrección propia con log inconsistente no es primera ni candidata, una ajena inconsistente con un VALIDADA cuenta igual (el hecho ocurrió aunque su cadena no sea válida) y un VALIDADA sin instante legible también (si es el propio, no se afirma). Se calculan con el estado posterior a cada acción (la respuesta de validar / revertir ya trae el valor final) y se derivan del log: no se modifica ninguna fila histórica.

### Efecto operativo y reindexado
Una primera ubicación **pendiente** no cambia nada operativo. Validada o autovalidada pasa a **V** y la compone el frontend sin base: `sin base + V → V`, aunque no exista D/C/R (el pozo entra al dataset con cuenca y profundidad «Sin dato»). Si más adelante un padrón nuevo **incorpora el pozo** con coordenadas registrales: la V **sigue ganando**; la fila histórica conserva `noEnPadron` y su `padronPeriodo` para siempre (la hoja es append-only y nada se reinterpreta); `getWellLocation` ya devuelve la ubicación real y las propuestas nuevas se miden contra ella (no son «primera»); si la V se revierte, el pozo vuelve a la nueva resolución registral (no a «sin ubicación»). No hay lógica especial: lo resuelve la composición de E3.

## E4-2 — Frontend: tarjeta y flujo para un pozo sin ubicación
Solo frontend (el backend de E4-1 no se toca). Tres situaciones de un pozo según `getWellLocation → ubicacionResuelta.estado`: **con ubicación** (`unica` / `corroborada` / fuentes en desacuerdo `dudosoLeve` · `revisar` · `revisarGrave`, que *sí* tienen ubicaciones y siguen como siempre), **sin coordenadas** (`sinCoordenadas`: figura en el padrón pero sin coordenada) y **fuera del padrón** (`noEnPadron`, E4-1). Un pozo está «sin ubicación» cuando es una de las dos últimas **y** no tiene una validada en campo vigente. Lo decide una sola función pura, `ubicacionCorreccionLogic_modoDeIngreso`.

### Tarjeta del hub
Si `getWellLocation` responde ok (lo que ya implica el permiso de consulta `ubicacion`), la tarjeta **Ubicación** existe para cualquier usuario con ese permiso: con o sin coordenadas, con o sin correcciones previas y con o sin `ubicacion_corregir` (este permiso controla solo el botón, dentro del módulo). Sin lectura no hay tarjeta; `WELL_LOCATION_NOT_FOUND` sigue como antes. Si el servicio no pudo comprobar la ubicación (`SERVICE_UNAVAILABLE` con permiso `ubicacion`) el hub muestra «No se pudo comprobar la ubicación de este pozo. Intentá de nuevo en unos minutos.» y no inventa ningún estado (ni dice «no se encontró» por eso). Se eliminó la consulta extra de correcciones que antes decidía la tarjeta (`necesitaConsultarCorrecciones`): ya no hace falta.

### Botones y títulos del modal (los permisos no cambian; el backend es la autoridad)
| Pozo | Permisos | Botón / título del modal |
|---|---|---|
| Sin ubicación | corregir + validar | **Agregar ubicación** |
| Sin ubicación | corregir sin validar | **Sugerir ubicación** |
| Sin ubicación | validar sin corregir · solo consulta | sin botón (no origina) |
| Con ubicación | corregir + validar | **Corregir ubicación** |
| Con ubicación | corregir sin validar | **Sugerir corrección** |
| Con ubicación | validar sin corregir · solo consulta | sin botón |
Permisos exactos (`=== true`, fail-closed). El mapa, Cerca Mío y reemplazos no tienen lógica especial.

### Textos
- Bloque principal de la ficha: título **«Sin ubicación registrada»** y detalle «Este pozo figura en el padrón, pero no tiene una coordenada cargada.» (`sinCoordenadas`) o «Este pozo no figura en el padrón actual.» (`noEnPadron`). **«Sin ubicación operativa de Irrigación»** queda reservado para fuentes en discrepancia / todas descartadas. Jerarquía de E3 intacta: V «Validada en campo» > R «Aceptada» > C «Coincidente» | D «Disponible».
- Estado vacío de la sección de correcciones: «Todavía no hay una ubicación cargada para este pozo.» (nunca «La ubicación vigente es la de Irrigación» si no hay punto).
- Modal: Irrigación = «Este pozo figura en el padrón, pero no tiene una ubicación de Irrigación para comparar.» / «Este pozo no figura en el padrón actual.»; sin distancia, sin advertencia de 1 km, sin marcador de Irrigación.
- Éxito (primera ubicación): solo propone «Ubicación sugerida. Queda pendiente de validación.»; autovalida «Ubicación agregada y validada.». Corrección: los mensajes de siempre. Manda la marca del backend si ya viene (`candidataPrimeraUbicacion` para una PENDIENTE, `primeraUbicacion` para una VALIDADA); con un backend sin las marcas, lo que la pantalla sabía al abrir el modal. No hay copy histórico todavía (E4-3).

### Observación
Fuera del padrón la observación es **obligatoria** (etiqueta «Observación (obligatoria)», el motivo se explica antes de escribir: «Indicá por qué se incorpora una ubicación para un pozo que no figura en el padrón actual.», Guardar apagado hasta que haya texto). Es una comodidad: el backend la exige igual y, si responde `OBSERVACION_REQUERIDA`, el aviso se muestra junto al campo (con el foco ahí), con el texto del padrón si no hay distancia y con el de la distancia si la hay. Con `sinCoordenadas` es opcional. Ni `fueraDelPadron` ni `sinUbicacion` viajan en el payload (lista blanca intacta).

### Mapa de ingreso
Sin ubicación de Irrigación ni validada vigente: centro = GPS del dispositivo (sin bloquear) y, si no hay, Mendoza. Sin centrado por departamento (mejora futura).

### Ficha y dominio
`noEnPadron` se mapea en `ubicacionOperativaLogic` igual que `sinCoordenadas` (sin punto registral, sin anomalía técnica, motivo `NO_EN_PADRON`) y la ficha no pide decisiones ni sugerencias de fuentes registrales (no existen). La validada en campo sigue componiéndose sin base (`sin base + V → V`).

### Invalidación (E3-6 intacto)
Una propuesta pendiente **no** invalida la capa de campo; una validación o autovalidación sí (`mapaDataset_invalidarDeltaCampo`); un error o un rechazo no. No se toca el delta registral.

### Compatibilidad y publicación
El frontend nunca asume que el backend ya manda `noEnPadron` ni las marcas de primera ubicación: con el backend actual (solo `sinCoordenadas`) todo funciona. **Orden:** primero este frontend, después el backend de E4-1.

## E4-3 — Copy, bandeja e historial de la primera ubicación
Solo frontend. La UI usa las dos marcas del backend **sin mezclarlas y sin volver a inferirlas** (nada de fechas, órdenes ni eventos en el cliente): `ubicacionCorreccionLogic_marcaPrimera(c)` decide qué se rotula.

| Marca del backend | Dónde vale | Frase | Se ve en |
|---|---|---|---|
| `candidataPrimeraUbicacion === true` | solo una propuesta **PENDIENTE** | **Primera ubicación conocida del pozo** | renglón de la bandeja, detalle de validación y tarjeta pendiente de la ficha |
| `primeraUbicacion === true` | **VALIDADA**, **REVERTIDA** o **SUPERADA** (hecho histórico) | **Primera ubicación validada del pozo** | validada vigente e historial de la ficha |

- Una pendiente **solo** mira `candidataPrimeraUbicacion`; lo ya resuelto **solo** mira `primeraUbicacion`. Una validada con `candidata=true` o una pendiente con `primera=true` no muestran nada.
- La marca histórica **se conserva** aunque esa validada se haya revertido o la haya superado otra (el estado actual no la oculta). Una **RECHAZADA** (o INCONSISTENTE) nunca se rotula; una propuesta nueva posterior sí puede ser candidata.
- Solo cuenta `=== true`: un campo ausente (backend sin las marcas), `null` o no booleano es *false*.
- **Dos pendientes candidatas** a la vez (ninguna validada todavía) se rotulan las dos. Al validar una, la cola refrescada trae la otra con `candidata=false` y deja de rotularse: la competencia la resuelve el backend, no el cliente.
- Autovalidación: la vigente nueva dice «validada del pozo» y no hay ninguna «candidata»; una corrección posterior no es primera (la primera, superada, conserva su marca).
- **Primera ubicación y «Sin ubicación de Irrigación para comparar»:** el renglón de la bandeja ya no repite esa línea (el rótulo lo dice) y el detalle sustituye la fila de distancia y el «No disponible» por la razón según el snapshot (`noEnPadron` → «Este pozo no figura en el padrón actual.»; `sinCoordenadas` → «Este pozo figura en el padrón, pero no tiene una coordenada cargada.»). Una pendiente común sin Irrigación conserva el copy anterior.
- **Mensajes de éxito** (sin cambios respecto de E4-2, sin sobreexplicar): primera propuesta «Ubicación sugerida. Queda pendiente de validación.»; primera autovalidada «Ubicación agregada y validada.»; corrección propuesta «Corrección enviada para validación.»; corrección autovalidada «Ubicación corregida y validada.».
- Permisos, composición E3, mapa, Cerca Mío, selección y reemplazo: sin cambios.

## E4-4 — Publicación y cierre de E4 en producción (21/10/2026)
**E4 queda CERRADA EN PRODUCCIÓN.** Orden seguido: frontend primero, backend después.

- **Frontend:** `origin/main` = `e6bd642` (GitHub Pages). Commits de E4: `88a485d` (E4-1 backend), `97bf3b5` (E4-2 tarjeta y flujo), `aae5f45` (fix de un test con reloj real; solo tests) y `e6bd642` (E4-3 copy y marcas). Con el backend todavía v43 el frontend nuevo no rompió nada (un pozo fuera del padrón seguía sin tarjeta Ubicación: `WELL_LOCATION_NOT_FOUND`).
- **Backend:** Apps Script `dgi-pozos-backend` en la **v44** (E4-1: `PozoExistenciaService`, `noEnPadron`, `primeraUbicacion` / `candidataPrimeraUbicacion`), desplegada sobre el deployment productivo existente (`gas:push` verificado → `gas:version` → `gas:deploy`); la URL `/exec` no cambió.
- **Pozo 14-0123** (fuera del padrón, conocido por ITF): `getWellLocation` → `ok` con `ubicacionResuelta.estado = noEnPadron`, `coordenadas = null`, `coordenadasProvincia = []`; `getWellRecord` sigue en `WELL_RECORD_NOT_FOUND` (sin ficha registral inventada). La tarjeta Ubicación aparece con «Sin ubicación registrada» y «Este pozo no figura en el padrón actual.»; con corregir + validar el botón es «Agregar ubicación». Modal sin guardar verificado: título, texto de Irrigación, sin distancia ni aviso de 1 km ni marcador registral, observación obligatoria con su explicación siempre visible, Guardar deshabilitado sin texto, GPS / mapa / GMS / POSGAR disponibles.
- **Sin regresiones** (backend viejo y nuevo): 14-0043 (R «Aceptada»), 14-0001 (V + R «Validada en campo»), 14-0002 (C «Coincidente») y 14-0006 (en el padrón sin coordenada: «Sin ubicación registrada», «figura en el padrón, pero no tiene una coordenada cargada», «Agregar ubicación»).
- **Cero escrituras:** el smoke no creó ninguna corrección ni dato de producción (lectura de correcciones de 14-0123: sin vigente, sin pendientes, sin historial). No se creó ninguna ubicación ficticia.

### Smoke pendiente (no bloqueante)
**Validar de punta a punta la primera ubicación real de un pozo fuera del padrón cuando exista una coordenada de campo confirmada** (por ejemplo 14-0123): propuesta / autovalidación → marcas «Primera ubicación conocida / validada del pozo» en la ficha y la bandeja → aparición del pozo en el mapa con `sin base + V`. Solo con una coordenada real y con confirmación explícita de Federico antes de escribir; no se usan datos de prueba en producción. Mejora futura aparte: centro aproximado del departamento para el mapa de ingreso (GPS → departamento → Mendoza).

## Tests
Punto operativo (etapa 1): `js/ubicacionOperativaLogic.test.js`. Etapa 2: `backend/test/UbicacionValidadasDelta.test.js`. Etapa 3: `js/mapaDatasetOperativo.test.js`, `js/mapaLogic.test.js` y `js/buscarReemplazoLogic.test.js`.
Validación (etapa 5): `js/ubicacionCorreccionLogic.test.js` (reglas puras), `js/ubicacionValidacionController.test.js` (DOM y Leaflet simulados con un servidor en memoria), `js/ubicacionValidacionWiring.test.js` (index.html, SW, api.js, app.js, estilos), `js/ubicacionCorreccionController.test.js` (botones de la ficha y `alResolver`),
`js/ubicacionPendientes.test.js` (indicador-botón) y `backend/test/UbicacionValidacionContratoFrontend.test.js` (frontend real contra el backend real).
`backend/test/UbicacionCorreccion{Repository,Service,E2E,Coordenadas}.test.js`, `CoordenadasConversion.test.js` (módulo del backend: contrato numérico contra pyproj, paridad con el frontend) y `ApiUbicacionCorreccion.test.js`; el E2E lee un padrón de un Drive en memoria
de **solo lectura** que falla ante cualquier escritura.
