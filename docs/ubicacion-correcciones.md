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
Se actualiza al iniciar sesión / abrir la app y cada vez que se vuelve al hub (con un mínimo de 15 s entre refrescos automáticos), y **siempre** después de validar o rechazar: la futura cola de validación llama `ubicacionPendientesController_alResolver()` al terminar cada acción.
Con 0 pendientes, sin permiso o ante un error no se ve; un fallo de la consulta nunca bloquea la app (conserva el último valor); sesión vencida cierra sesión y usuario deshabilitado va a su pantalla, como el resto de la app. Todavía no hay cola de validación en el frontend: el indicador solo informa.

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

## Tests
`backend/test/UbicacionCorreccion{Repository,Service,E2E,Coordenadas}.test.js`, `CoordenadasConversion.test.js` (módulo del backend: contrato numérico contra pyproj, paridad con el frontend) y `ApiUbicacionCorreccion.test.js`; el E2E lee un padrón de un Drive en memoria
de **solo lectura** que falla ante cualquier escritura.
