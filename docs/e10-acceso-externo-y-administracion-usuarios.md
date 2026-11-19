# E10: seguridad, usuarios y acceso externo (auditoría y plan ejecutable de E10-1)

Estado: **solo auditoría y diseño (04/11/2026)**. Sin código, sin commit, sin push, sin gas, sin deploy y sin cambios en la hoja `Usuarios`. E9 está cerrado y no se toca salvo bug.

**Qué NO se decide en este documento (queda abierto a propósito, para E10-3 / E10-4):** qué puede ver o hacer un usuario EXTERNO; paquete de permisos por defecto para EXTERNO; acceso externo a ITF, mapa, coordenadas, niveles estáticos, fotos, datos técnicos, observaciones, reemplazos, línea de tiempo, selección, Excel, ZIP o descargas masivas. Las tablas de abajo **solo clasifican técnicamente** (dato, endpoint, permiso actual, riesgo, volumen, sensibilidad potencial).

**Qué NO se pudo verificar desde acá y por qué:** no hay acceso a la hoja `Usuarios` real, a `Historial` ni a las imágenes ITF (no se ejecutan funciones de Apps Script ni se leen Sheets/Drive). Por eso las **cantidades de usuarios afectados por las migraciones** y el **contenido real de los ITF** están pendientes de dos auditorías de solo lectura que se diseñan abajo (§9.2 y §12). Todo lo demás está verificado leyendo el código.

Archivos auditados: `Api.js` (router y los 62 handlers), `AuthService.js`, `SheetUserRepository.js`, `Config.js`, `NotificationService.js`, `TelegramRepository.js`, `SearchHistoryService.js`, `SheetSearchHistoryRepository.js`, `MapaService.js`, `MapaRepository.js`, `RegistryService.js`, `ReemplazoService.js`, `ItfService.js` (patrón del flag), `appsscript.json`, y del frontend `js/api.js`, `js/app.js`, `js/mapaLogic.js`, `js/ubicacionFuenteDecisionesUiLogic.js`, `js/ubicacionCorreccionLogic.js`, `js/seleccion.js`, `js/errorMessages.js`. Más el test `backend/test/AuthService.test.js` y la documentación de Google sobre `tokeninfo`.

---

## 1. Autenticación actual (confirmado en código)

| Punto | Estado exacto |
|---|---|
| Google Identity Services | La PWA obtiene un `credential` (idToken) con GIS y lo manda a la acción `login` (`handleCredentialResponse` en `js/app.js`). |
| Validación del idToken | `handleLogin` hace `UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=…')` con `muteHttpExceptions`. Cualquier HTTP ≠ 200 → `UNAUTHORIZED`; excepción de red → `SERVICE_UNAVAILABLE`. No verifica la firma localmente: delega en Google. |
| `aud` | Se compara `tokenInfo.aud !== GOOGLE_CLIENT_ID` (constante pública en `Config.js`); si no coincide → `UNAUTHORIZED` + fila en `Historial`. **No** se comprueba `iss` (Google ya lo valida en `tokeninfo`) ni `azp`. |
| `email_verified` | **Se lee pero no se exige**: `emailVerified: tokenInfo.email_verified === 'true' || === true` solo viaja en la respuesta; ninguna rama lo usa para decidir. |
| Sesión propia | `createSessionToken(email)`: `base64url({email, iat, exp}) + '.' + base64url(HMAC-SHA256(payload, SESSION_SECRET))`. `SESSION_SECRET` en Script Properties. El token **solo contiene identidad** (email); nunca permisos. |
| Duración | `SESSION_TTL_SECONDS = 2592000` (30 días). |
| Sliding expiration | Cada `checkSession` exitoso devuelve un token nuevo de 30 días; el frontend lo reemplaza en `localStorage`. `checkSession` corre al abrir la app. **No** vuelve a pasar por Google ni por `tokeninfo`. |
| Lectura de permisos | En cada request con sesión: `getUserAccess(email)` → hoja `Usuarios` (por encabezado, cualquier orden). Un permiso es `true` solo si la celda, normalizada, vale `si`. Los handlers comparan `=== true`. |
| Cache | `CacheService.getScriptCache()`, clave `user_access_<email en minúsculas>`, TTL `USER_STATUS_CACHE_SECONDS = 300`. Se cachea **solo el resultado positivo** (usuario activo). Contiene `{active, permisos, nombre}`. |
| Usuario inexistente | `found:false` → `active:false` → `USER_DISABLED` (login: además fila `Historial` `login/USER_DISABLED`). Mismo código que inactivo (no revela cuál es). |
| Usuario inactivo | `estado` ≠ `activo` (comparación exacta tras `trim().toLowerCase()`) → `USER_DISABLED`. |
| Fail-closed | Columna de permiso ausente → `false` para todos. Permiso con valor raro (`1`, `true`, `NO`, vacío) → `false`. Hoja `Usuarios` ausente → `throw` → `doPost` responde `SERVICE_UNAVAILABLE` (nunca acceso). Token mal formado/firma inválida/vencido → `UNAUTHORIZED`. `permisosVacios` si el repositorio no devuelve permisos. |
| Despliegue | `executeAs: USER_DEPLOYING`, `access: ANYONE_ANONYMOUS`: cualquiera puede hacer POST; toda la autorización es de aplicación. |
| Latencia de cambios | Quitar permiso o dar de baja a alguien ya cacheado tarda **hasta 5 min**; altas/reactivaciones/permisos nuevos son inmediatos (no se cachea lo negativo, y un permiso nuevo solo entra cuando el cache del usuario vence si ya estaba activo). |

### 1.1 Hallazgos de autenticación

| # | Hallazgo | Acción en E10-1 |
|---|---|---|
| A1 | `email_verified` no se exige. | Exigirlo (§5). |
| A2 | `tokeninfo` es, según la documentación de Google, un endpoint de depuración: «no apto para producción, las solicitudes pueden ser limitadas o fallar de forma intermitente». Es el mecanismo vigente desde E1 y funciona, pero es un punto de fragilidad (y de consumo de cuota de `UrlFetch`). | Documentar; no cambiar ahora. Evaluar en E10-5 (verificación local del JWT o contención de abuso). |
| A3 | Cada intento anónimo de `login` consume un `UrlFetch` y, si el usuario no existe, escribe en `Historial`. | Contención en E10-5. |
| A4 | No se puede revocar **una** sesión: lo que revoca es la baja o el recorte en `Usuarios`. Revocar a todos = rotar `SESSION_SECRET`. | Informativo. |

---

## 2. Superficie de endpoints (62 acciones) y clasificación técnica

Clases técnicas (**no** son política externa): **A** sin permiso de módulo / potencialmente de bajo riesgo; **B** lectura con permiso de módulo; **C** escritura con permiso de módulo; **D** moderación/validación. «Hoy» = lo que el código exige.

### 2.1 Acciones sin permiso de módulo (solo sesión)

Confirmado con un barrido automático de **todos** los handlers contra los chequeos de permiso (incluidos los wrappers `api_itfModEntrada`, `api_lecturaModeracionFotoPozo`, `resolverCorreccionUbicacion`, `validarSesionPermisoFotos*`): son **exactamente seis**, más `login`/`checkSession`.

| Acción | L/E | Devuelve / efecto | Volumen | Riesgo técnico | Permiso futuro propuesto |
|---|---|---|---|---|---|
| `getMetadata` | L | fecha de generación y período del padrón | 1 objeto | nulo | ninguno (queda como está) |
| `getMapaPozos` | L | todos los puntos: `wellId, lat, lon, estado, cuenca, profundidad, tramosFiltrantes, surgencia` | ~13,8 mil pozos (`pozos.json`, «varios cientos de KB»), **se lee de Drive en cada llamada, sin cache** | coordenadas + datos técnicos de todo el padrón; costo de Drive y de payload por llamada | **`mapa`** |
| `getUbicacionesValidadas` | L | `wellId, lat, lon, vts` de ubicaciones validadas en campo | crece con el uso (hoy pocas); con cache propio | coordenadas | **`mapa`** |
| `getDecisionesFuentesDelta` | L | `version, periodo, parcial, decisiones[{wellId, estado, lat, lon}]` (efecto de las decisiones sobre el padrón) | acotado a pozos con decisiones; cálculo con lecturas del registro | coordenadas | **`mapa`** |
| `registerWellSearch` | E | fila en `Busquedas` + Telegram | 1 fila / aviso por llamada | ver §8 | ver §8 |
| `registerDescargaItf` | E | Telegram | 1 aviso por llamada | ver §8 | ver §8 |

**No existen otros** endpoints de mapa ni de coordenadas sin permiso. Los demás lectores de coordenadas ya tienen permiso: `getWellLocation` (`ubicacion`), `getMapaNE` y `getMonitoringPoint` (`ne`), `getCorreccionesUbicacionPozo`/`getDecisionesFuentesPozo`/`getSugerenciasFuentesPozo` (`ubicacion`).

### 2.2 Endpoints de mapa afectados por `mapa` (contrato propuesto)

| Acción | Permiso hoy | Permiso futuro | Consumidores en el frontend (hoy) |
|---|---|---|---|
| `getMapaPozos` | ninguno (cualquier activo) | `mapa` | «Pozos cerca mío» (**todo usuario activo**), mapa Provincia (`perfil` o `ne`), selección por radio/polígono, «Buscar reemplazo» (`reemplazo`) |
| `getUbicacionesValidadas` | ninguno | `mapa` | las mismas, vía `js/mapaDataset.js` |
| `getDecisionesFuentesDelta` | ninguno | `mapa` | las mismas, vía `js/mapaDataset.js` |

Los tres se piden juntos desde `mapaDataset_obtener` (cache compartida en el navegador), por lo que **deben pasar a `mapa` a la vez**: gatear solo uno rompería el dataset operativo. `getMapaNE` queda con `ne` y `getIndiceBusquedaProvincia` con `datos`: ya están cubiertos.

Lo que el frontend usa hoy para habilitar cada vista (`mapaLogic_calcularAccesos`): `cercaMio: true` siempre; `provincia: perfil || ne`; `ne: ne`; `reemplazo: reemplazo`. Con `mapa` hay que cambiar **qué** habilita el dataset (ver §4.4), no agregar una lista de permisos.

### 2.3 Lectura vs. mutación en el dominio de ubicación

| Acción | L/E | Permiso hoy | Permiso futuro propuesto |
|---|---|---|---|
| `getWellLocation` | L | `ubicacion` | `ubicacion` |
| `getCorreccionesUbicacionPozo`, `getDecisionesFuentesPozo`, `getSugerenciasFuentesPozo` | L | `ubicacion` | `ubicacion` |
| `proponerCorreccionUbicacion` | **E** | `ubicacion` + `ubicacion_corregir` (nace validada si además `ubicacion_validar`) | igual |
| **`sugerirDecisionFuente`** | **E** | **solo `ubicacion`** | `ubicacion` + `ubicacion_corregir` |
| **`cancelarSugerenciaFuente`** | **E** (cancela la propia) | **solo `ubicacion`** | `ubicacion` + `ubicacion_corregir` |
| `getCorreccionesUbicacionPendientes`, `getSugerenciasFuentesPendientes` | L | `ubicacion` + `ubicacion_validar` | igual |
| `validarCorreccionUbicacion`, `rechazarCorreccionUbicacion`, `revertirCorreccionUbicacion`, `decidirFuenteUbicacion`, `resolverSugerenciaFuente` | **E** | `ubicacion` + `ubicacion_validar` | igual |

**Escrituras/propuestas de ubicación existentes (completo): ocho** — `proponerCorreccionUbicacion`, `sugerirDecisionFuente`, `cancelarSugerenciaFuente` (originan o cancelan) y `validar/rechazar/revertirCorreccionUbicacion`, `decidirFuenteUbicacion`, `resolverSugerenciaFuente` (resuelven). Solo **dos** están mal alineadas con el contrato «`ubicacion` = lectura»: `sugerirDecisionFuente` y `cancelarSugerenciaFuente`. Efecto lateral relacionado: `avisarValidadoresCorreccion` y `avisarValidadoresSugerencia` mandan emails a quienes tienen `ubicacion` + `ubicacion_validar`.

**Hallazgo importante sobre el comportamiento actual (frontend):** `ufdui_rol(permisos)` devuelve `LECTOR` a todo el que tenga `ubicacion === true` y `VALIDADOR` si además tiene `ubicacion_validar`; y el módulo ofrece a los `LECTOR` los botones **«Sugerir aceptar / descartar / restaurar» y «Cancelar la propia»**. O sea, **hoy, por diseño, todo usuario con `ubicacion = SI` puede sugerir**. No es un descuido del backend: es el comportamiento de producto vigente. Por eso la migración de §7.3 no puede asumir que `ubicacion_corregir` ya refleja quién sugiere.

### 2.4 Resto de la superficie (clasificación técnica, sin política externa)

Formato: acción — L/E — permiso hoy — qué devuelve/hace — volumen — sensibilidad potencial (a evaluar en E10-4).

| Módulo | Acciones | L/E | Permiso hoy | Devuelve / hace | Volumen | Sensibilidad potencial |
|---|---|---|---|---|---|---|
| ITF | `getProfile` | L | `perfil` | imagen del ITF vigente (base64) | 1 imagen (mediana ~0,78 MB; ~16,6 mil legacy) | **depende del contenido de los ITF (pendiente §12)** |
| ITF | `getItfAvailability` | L | `perfil` | `wellId → boolean`, ≤500 por llamada | por lote | baja |
| ITF | `proponerItf`, `retirarPropuestaItf` | E | `perfil`+`perfil_subir` | propuesta / retiro | 1 | escritura |
| ITF | `getMisPropuestasItf` | L | `perfil`+`perfil_subir` | propuestas propias | paginado | baja |
| ITF | `getItfPendientes`, `getItfDocumentoModeracion`, `getHistorialItf` | L | `perfil`+`perfil_validar` | cola, documento, historial | paginado | interna |
| ITF | `aprobarItf`, `rechazarItf`, `retirarItf`, `revertirItf` | E | `perfil`+`perfil_validar` | decisión institucional | 1 | moderación |
| Padrón | `getWellRecord` | L | `datos` | ficha sin geografía (titular, domicilios, expediente, técnicas, construcción, laboratorio, uso/concesión, comentarios) | 1 ficha | **datos personales** |
| Padrón | `getWellSummary` | L | `datos` | titular, departamento, distrito | 1 | **dato personal** |
| Padrón | `getIndiceBusquedaProvincia` | L | `datos` | `wellId`+NC16+titular de todo el padrón | ~13,8 mil filas | **volcado masivo de datos personales/catastrales** |
| Ubicación | `getWellLocation` y lectores de §2.3 | L | `ubicacion` | coordenadas, ubicación resuelta, correcciones (nombres, sin emails) | 1 pozo | localiza el pozo |
| Niveles estáticos | `getMapaNE` | L | `ne` | puntos de la red con coordenadas | cientos/miles | coordenadas de la red |
| Niveles estáticos | `getMonitoringPoint` | L | `ne` | serie de mediciones; `nombreOriginal` (suele contener el propietario) | 1 punto | `nombreOriginal` = dato personal indirecto |
| Fotos de pozos | `getFotosPozo`, `getFotoPozo`, `getResumenFotosPozos` | L | `fotos` | metadatos/imagen/conteos de fotos visibles | por pozo / resumen | fotos de propiedades |
| Fotos de pozos | `subirFotoPozo`; `solicitarRetiroFotoPozo` | E | `fotos_carga`; `fotos`+`fotos_carga` | alta / pedido de retiro | 1 | escritura |
| Fotos de pozos | `retirarFotoPozo`, `resolverRetiroFotoPozo`, `reponerFotoPozo` | E | `fotos`+`fotos_moderar` | moderación | 1 | moderación |
| Fotos de pozos | `getHistorialFotoPozo`, `getFotosPozosPendientesModeracion`, `getFotosPozosRetiradasModeracion`, `getFotoPozoModeracion` | L | `fotos`+`fotos_moderar` | colas e imagen de retiradas | paginado | interna |
| Observaciones | `getObservacionesPozo` | L | `observaciones` | texto, autor (nombre), anuladas solo con `observaciones_anular` | paginado | comentarios internos |
| Observaciones | `agregarObservacionPozo`; `anularObservacionPozo` | E | `observaciones`+`observaciones_agregar`; `observaciones`+(`agregar` propias / `anular` cualquiera) | alta / anulación | 1 | escritura / moderación |
| Reemplazos | `getEstadoReemplazo`, `getHistorialReemplazo`, `getResumenReemplazoMapa`, `getFotosReemplazo`, `getFotosReemplazoPozo`, `getFotoReemplazo` | L | `reemplazo` | evaluaciones (nombre del evaluador, estado, motivo, observación), resumen `wellId→estado`, fotos | por pozo / resumen | evaluaciones internas |
| Reemplazos | `registrarEvaluacionReemplazo`, `subirFotoReemplazo` | E | `reemplazo` | alta | 1 | escritura |
| Línea de tiempo | (se compone en el navegador con lo que el usuario ya puede ver; no tiene endpoint propio) | — | hereda | — | — | hereda |
| Selección / Excel / ZIP | se arman en el navegador con datos ya autorizados: el Excel excluye siempre el titular y exporta coordenadas solo con `ubicacion`; el ZIP baja ITF uno a uno con `getProfile` | — | hereda | descarga masiva = N llamadas a `getProfile` | hasta 500 por lote | **descargas masivas: sin límite por usuario hoy** |
| Sesión | `login`, `checkSession` | E/L | — | token y permisos | 1 | ver §1.1 |

Dato de contexto para E10-4: **no existe un permiso propio de «exportar»**; la exportación y el ZIP heredan los permisos de cada dato.

---

## 3. Modelo aprobado: `tipo` + `estado` + permisos

- **No hay roles** que dupliquen permisos. Un usuario es `tipo` (`INTERNO`/`EXTERNO`) + `estado` + permisos individuales.
- **`tipo` no otorga acceso.** Sirve para políticas futuras, filtros, plantillas del panel, límites futuros y distinguir usuarios. La autoridad de acceso real sigue siendo el permiso.
- **Dos reglas técnicas** donde `tipo` participa (ambas de seguridad, no de negocio):
  1. `usuarios_admin` solo es efectivo para `tipo = INTERNO` (un EXTERNO nunca puede tenerlo; validado en la API **y** al calcular el acceso).
  2. *(Reemplazado en la implementación de E10-1, ver [e10-1-seguridad-usuarios.md](e10-1-seguridad-usuarios.md) §2)* `E10_GESTION_EXTERNOS_ACTIVO` NO bloquea el login de un EXTERNO: gobierna solo la gestión administrativa (crear un externo, convertir un usuario a EXTERNO, reactivar un externo).
- **Sin paquete por defecto para EXTERNO.** Las plantillas del panel de E10-2 serán solo de usuarios internos (opcionales) y no se define ninguna para EXTERNO hasta E10-4.

---

## 4. Catálogo canónico de permisos (una sola fuente en el backend)

### 4.1 Diseño

Archivo nuevo (propuesto) `backend/src/PermisosCatalogo.js`: **datos puros + funciones puras, sin acceso a Sheets**. Cada entrada:

| Campo | Contenido |
|---|---|
| `id` | id técnico = encabezado de la columna en `Usuarios` |
| `nombre` | nombre visible |
| `descripcion` | texto comprensible para el panel |
| `modulo` | agrupación (Perfil/ITF, Datos, Ubicación, Mapa, Niveles estáticos, Fotos, Observaciones, Reemplazos, Administración) |
| `categoria` | `lectura` / `escritura` / `moderacion` / `administracion` |
| `aplicableInterno` | booleano |
| `aplicableExterno` | booleano: `false` **solo** si está técnicamente prohibido (techo duro); `true` significa «no excluido técnicamente», **no** «concedido a externos» |
| `orden` | orden de presentación |
| `dependeDe` | ids que deben estar en `SI` (validación; el panel los aplica automáticamente) |
| `critico` | si exige confirmación reforzada en el panel |

(`dependeDe` y `critico` son los dos campos que se suman a los pedidos: el primero evita combinaciones incoherentes y el segundo evita hardcodear en la UI qué cambios confirmar.)

### 4.2 Contenido

| orden | id | nombre | módulo | categoría | interno | externo | dependeDe | crítico |
|---|---|---|---|---|---|---|---|---|
| 10 | `perfil` | Ver ITF vigente y disponibilidad | Perfil / ITF | lectura | sí | sí | — | no |
| 11 | `perfil_subir` | Proponer ITF | Perfil / ITF | escritura | sí | sí | `perfil` | no |
| 12 | `perfil_validar` | Validar ITF | Perfil / ITF | moderación | sí | sí | `perfil` | **sí** |
| 20 | `datos` | Ver ficha completa del pozo | Datos | lectura | sí | sí | — | **sí** |
| 30 | `ubicacion` | Ver ubicación y fuentes | Ubicación | lectura | sí | sí | — | no |
| 31 | `ubicacion_corregir` | Proponer correcciones y sugerencias | Ubicación | escritura | sí | sí | `ubicacion` | no |
| 32 | `ubicacion_validar` | Validar correcciones y decidir fuentes | Ubicación | moderación | sí | sí | `ubicacion` | **sí** |
| 40 | `mapa` *(nuevo)* | Ver mapa de pozos, «Cerca mío» y selección | Mapa | lectura | sí | sí | — | no |
| 50 | `ne` | Ver niveles estáticos | Niveles estáticos | lectura | sí | sí | — | no |
| 60 | `fotos` | Ver fotos de pozos | Fotos | lectura | sí | sí | — | no |
| 61 | `fotos_carga` | Subir fotos de pozos | Fotos | escritura | sí | sí | — | no |
| 62 | `fotos_moderar` | Moderar fotos de pozos | Fotos | moderación | sí | sí | `fotos` | **sí** |
| 70 | `observaciones` | Ver observaciones | Observaciones | lectura | sí | sí | — | no |
| 71 | `observaciones_agregar` | Agregar observaciones | Observaciones | escritura | sí | sí | `observaciones` | no |
| 72 | `observaciones_anular` | Anular observaciones | Observaciones | moderación | sí | sí | `observaciones` | **sí** |
| 80 | `reemplazo` | Evaluar reemplazos (ver y registrar) | Reemplazos | escritura | sí | sí | — | no |
| 90 | `usuarios_admin` *(nuevo)* | Administrar usuarios y permisos | Administración | administración | sí | **no (techo duro)** | — | **sí** |

Total: 15 existentes + 2 nuevos (`mapa`, `usuarios_admin`) = **17**. `ubicacion_corregir` **ya existe** en la hoja y en el código; lo que cambia es qué endpoints lo exigen (§2.3).

### 4.3 Cómo se consume sin romper nada

**Backend.** Hoy hay listas duplicadas: `USUARIOS_COLUMNAS_PERMISO` y `USUARIOS_COLUMNAS` (`SheetUserRepository.js`), `permisosVacios` en `AuthService.js` y `sheetUserRepository_permisosVacios`. Se reemplazan por funciones que **derivan del catálogo** (`permisosCatalogo_ids()`, `permisosCatalogo_vacios()`, `permisosCatalogo_validarConjunto(tipo, ids)`).
- **Riesgo propio de Apps Script:** los archivos se cargan en un orden definido por el manifiesto y una constante global que dependa de otro archivo puede quedar `undefined`. Por eso el catálogo se expone **solo con funciones** (nada de constantes derivadas evaluadas al cargar).
- La forma de `permisos` en `login` y `checkSession` **no cambia**: objeto `{id: boolean}`; solo se suman las claves nuevas (`mapa`, `usuarios_admin`). Los clientes viejos las ignoran.
- Cache: la clave pasa a `user_access_v2_<email>` (forma nueva con `tipo` y `version`) para que entradas viejas del cache no se interpreten con la forma nueva; las viejas expiran solas en ≤ 5 min.

**Frontend.** No mantiene lista alguna: el runtime ya es **fail-closed por construcción** (todos los chequeos son `=== true` o truthy sobre claves que pueden no existir), así que no necesita conocer los ids. Los dos literales de 15 claves de `permisosActuales` en `js/app.js` se reducen a `{}` (comportamiento idéntico: una clave ausente es falsa). El panel de E10-2 obtiene el catálogo con una acción administrativa (`adminGetCatalogoPermisos`) en lugar de duplicarlo. Un **test de guarda** impide que reaparezca una lista literal de ≥3 permisos en `js/`.

**Compatibilidad con E3–E9:** ningún handler cambia de contrato salvo los explícitos de §2.2 y §2.3; las claves de permiso existentes conservan nombre y semántica.

### 4.4 Frontend y `mapa` (cambio mínimo, derivado del backend)

`mapaLogic_calcularAccesos` pasa a exigir `permisos.mapa === true` para todo lo que usa el dataset (Cerca mío, Provincia, selección, Buscar reemplazo); lo demás (`perfil`/`ne`/`reemplazo` decidiendo cuál botón) sigue igual. **Orden obligatorio** (§14): hoja migrada → backend → frontend; si el frontend nuevo saliera antes de que el backend devuelva `mapa`, «Cerca mío» desaparecería para todos.

---

## 5. Cambio exacto para exigir `email_verified`

### 5.1 Formato real devuelto por `tokeninfo`

Según la documentación de Google (página «Authenticate with a backend server», sección `tokeninfo`), la respuesta de un token válido es HTTP 200 con claims **como cadenas**: `"email_verified": "true"`, `"exp": "1433981953"`, `"iat": "…"`, `"aud": "<client id>"`, más `iss`, `azp`, `sub`, `email`, `name`, `picture`, etc. **`email_verified` es la cadena `"true"`, no un booleano.** El código actual ya contempla ambas formas y el test existente (`AuthService.test.js`) usa `email_verified: 'true'`.

No se puede confirmar con un idToken real desde este entorno (no se usan credenciales ni se llama a Google); la confirmación en producción se hace con el modo observación de §5.3.

### 5.2 Regla propuesta

Después de validar `aud` y **antes** de consultar `Usuarios`:

- Se acepta solo `email_verified === 'true'` o `=== true`.
- `false`, `'false'`, ausente, `null` o cualquier otro valor → **rechazo explícito**: `{status:'error', code:'EMAIL_NO_VERIFICADO'}`, sin crear sesión y con una fila en `Historial` (`login`, `EMAIL_NO_VERIFICADO`).
- Se valida también que `email` sea una cadena no vacía (hoy un token sin email llegaría a `getUserAccess(undefined)`).
- El mensaje del frontend (`js/errorMessages.js`) es nuevo: «Tu cuenta de Google no tiene el correo verificado. Verificalo en Google e intentá de nuevo.» El flujo de `handleCredentialResponse` ya muestra `getErrorMessage(result.code)` en `login-error` para cualquier código distinto de `USER_DISABLED`, así que **no necesita cambios de lógica** (solo la tabla de mensajes; hoy un código desconocido mostraría «Ocurrió un error inesperado»).
- `checkSession` **no** se toca: no recibe idToken y las sesiones existentes siguen válidas.

### 5.3 Compatibilidad con los usuarios internos actuales

Para cuentas Google (incluidas Workspace), `email_verified` es verdadero en la práctica; el riesgo real es un caso borde que hoy nadie conoce. Para no descubrirlo bloqueando a alguien: **despliegue en dos pasos con una Script Property** `AUTH_EMAIL_VERIFICADO_MODO`:

| Valor | Comportamiento |
|---|---|
| ausente / `OBSERVAR` (**por defecto al desplegar**) | no bloquea; registra en `Historial` una fila `login`/`EMAIL_NO_VERIFICADO_OBSERVADO` por cada login con `email_verified` distinto de verdadero, y devuelve `emailVerified` como hoy |
| `EXIGIR` | rechaza con `EMAIL_NO_VERIFICADO` |

Se pasa a `EXIGIR` después de un período de observación sin filas observadas (los internos actuales inician sesión de nuevo recién cuando vence su token de 30 días o hacen «Salir», por lo que la ventana de observación debería durar al menos una semana de uso real, no horas). Es el único flag de E10-1 que no es todo-o-nada, y justificado porque su error es **de bloqueo de acceso** a usuarios reales.

### 5.4 Pruebas de AUTH (diseño)

| Caso | Resultado esperado |
|---|---|
| idToken válido, `email_verified:'true'`, usuario activo | `ok` + token |
| `email_verified:true` (booleano) | `ok` |
| `email_verified:'false'` / `false` | modo EXIGIR: `EMAIL_NO_VERIFICADO` sin token y con fila `Historial`; modo OBSERVAR: `ok` + fila `…_OBSERVADO` |
| `email_verified` ausente / `null` / `'TRUE'` / `'1'` / objeto | tratado como no verificado |
| `aud` distinto | `UNAUTHORIZED` (sin consultar `Usuarios`) |
| `email` ausente o vacío | `UNAUTHORIZED` (sin consultar `Usuarios`) |
| tokeninfo ≠ 200 / excepción de red | `UNAUTHORIZED` / `SERVICE_UNAVAILABLE` (sin cambios) |
| usuario inexistente / inactivo con `email_verified` verdadero | `USER_DISABLED` (sin cambios) |
| orden: con `email_verified` falso **y** usuario inexistente | `EMAIL_NO_VERIFICADO` (no se llega a consultar la hoja) |
| propiedad `AUTH_EMAIL_VERIFICADO_MODO` inválida | se comporta como `OBSERVAR`... **o** como `EXIGIR`: ver decisión D3 |
| sesión ya emitida / `checkSession` | sin cambios |

---

## 6. Esquema de la hoja `Usuarios` (mínimo)

**Real hoy (por código):** `email, nombre, estado, fecha_alta` + 15 permisos. **Contenido real no auditado** (§9.2).

### 6.1 Evaluación columna por columna

| Candidata | Decisión | Motivo |
|---|---|---|
| `tipo` | **agregar** | base de las dos reglas técnicas; valores `INTERNO`/`EXTERNO`. |
| `estado` | ya existe | `activo` / `inactivo` (la baja escribe `inactivo`; el parser ya trata todo ≠ `activo` como no habilitado). |
| `version` | **agregar** | concurrencia optimista. Entero; vacío = 0. |
| `creadoUtc` | **no agregar** | `fecha_alta` ya cumple esa función; el instante exacto y el actor quedan en `UsuariosEventos` (`USUARIO_CREADO`). |
| `creadoPor` | **no agregar** | derivable del evento `USUARIO_CREADO`; duplicarlo crea una segunda fuente que puede discrepar. |
| `actualizadoUtc` | **agregar** | legible a simple vista en la hoja y evita leer la hoja de eventos para mostrar «última modificación» en la lista. Se escribe en la misma operación que `version`. |
| `actualizadoPor` | **agregar** | ídem (email del admin o `migracion:E10-1`). |
| `usuarios_admin` | **agregar** (permiso) | |
| `mapa` | **agregar** (permiso) | |
| `ubicacion_corregir` | ya existe | solo cambia dónde se exige. |
| `accesoHasta` | **esperar a E10-3** (ver §6.3) | |

**Resultado:** 4 columnas de control (`tipo`, `version`, `actualizado_utc`, `actualizado_por`) + 2 permisos (`usuarios_admin`, `mapa`) = **6 columnas nuevas** (de 19 a 25). Los encabezados siguen buscándose por texto, en cualquier orden.

### 6.2 Semántica y compatibilidad

- **Compatibilidad hacia atrás:** el código actual (v48) ignora las columnas que no conoce, así que agregarlas no lo afecta; y es fail-closed con las que faltan. Esto permite migrar la hoja **antes** de desplegar el código.
- **`tipo` ausente (columna inexistente):** modo heredado, sin aplicar las reglas de `tipo` (nadie tiene `usuarios_admin` todavía y no hay externos). **Columna presente pero celda vacía o inválida:** se trata como el valor **restrictivo** (no puede ser administrador efectivo y queda sujeto a `E10_GESTION_EXTERNOS_ACTIVO`). Por eso la migración llena `INTERNO` en todas las filas **antes** de que el código lea la columna con esas reglas.
- **Concurrencia (más fuerte que solo `version`):** una edición manual de la hoja no incrementa `version`. Por eso el cliente manda además un `etag` = hash corto del estado editable (`nombre|tipo|estado|permisos` canónicos); el backend lo recalcula bajo lock y rechaza si cambió **aunque `version` coincida**.
- **Email inmutable:** cambiar el email equivale a otro usuario (se da de alta uno nuevo); evita secuestros de identidad por edición.
- **Unicidad:** el alta rechaza un email existente (activo o inactivo) bajo lock; el diagnóstico detecta duplicados preexistentes.

### 6.3 `accesoHasta`: esperar a E10-3

Recomendación: **no incorporarlo ahora.** En E10-1/E10-2 nada lo usaría (agregaría una condición al camino caliente `getUserAccess` y sus pruebas sin ningún beneficio inmediato) y todavía no está decidido que algún externo tenga vencimiento. Se deja **reservado** el nombre (`acceso_hasta`) y el cálculo de acceso efectivo concentrado en **una** función (`usuariosAcceso_calcular(fila, ahora, flags)`), de modo que sumarlo en E10-3 sea una condición y una columna, sin tocar el resto. Regla futura propuesta: vacío = sin vencimiento.

---

## 7. Migraciones propuestas (no se ejecutan; solo diseño)

**Principio:** conservadora = ningún usuario interno activo pierde una capacidad que hoy ejerce legítimamente.

### 7.1 Paso 0: auditoría de solo lectura de la hoja real (prerrequisito de todo)

Como no es posible leer la hoja desde acá, la **primera pieza de código de E10-1** es una función de editor **de solo lectura** (mismo patrón que `preflightItfE9`), p. ej. `diagnosticoUsuariosE10()`, que **no escribe nada** y cuyo resultado es lo que permite entregar «cantidad de usuarios afectados». Produce, con **emails enmascarados** (`a***@d***.com`):

1. Existencia de la hoja; encabezados presentes, faltantes, desconocidos y repetidos.
2. Filas totales; `estado` crudo y su conteo (¿hay valores distintos de `activo`/`inactivo`?); emails vacíos; duplicados.
3. Por cada permiso: cantidad en `SI` entre los activos y cantidad de valores inválidos (ni `SI` ni `NO` ni vacío).
4. **Para `mapa`:** activos totales (= universo afectado); de ellos, cuántos con `perfil`, `ne`, `reemplazo` o ninguno de los tres (los que hoy solo usan «Cerca mío»).
5. **Para `ubicacion_corregir`:** activos con `ubicacion = SI`; de ellos: ya con `ubicacion_corregir`, con `ubicacion_validar`, sin ninguno; y, **por evidencia de uso real**, cuántos de los que no tienen `ubicacion_corregir` figuran como autor (`emailPropone`) en la hoja de sugerencias de fuentes, en `UbicacionCorrecciones` o en sus logs de cancelación.
6. Activos con `perfil_subir`, `perfil_validar`, `fotos_moderar`, `observaciones_anular`, `ubicacion_validar` (para elegir los administradores iniciales con criterio).
7. Verifica que no haya ninguna fila `activo` sin email válido.

**Sin esta ejecución no hay conteos.** Es el único código que precede al resto y se puede desplegar en `@HEAD` solamente, sin versión nueva.

### 7.2 Migración `mapa`

| | |
|---|---|
| **Criterio exacto** | `mapa = SI` para **toda fila con `estado = activo`**; `NO` para las demás. |
| **Por qué ese criterio** | Hoy **cualquier** usuario activo recibe el dataset en el backend y «Pozos cerca mío» está habilitado para todo activo en el frontend; limitar a quienes tienen `perfil`/`ne` quitaría Cerca mío a quienes hoy lo usan legítimamente. |
| **Usuarios afectados** | = cantidad de activos (ítem 4 del diagnóstico). Ningún usuario pierde nada; **no hay usuarios afectados negativamente**. |
| **Valores que se escribirían** | `SI` / `NO` explícitos (no se deja vacío). |
| **Rollback** | Borrar la columna `mapa` o dejarla (el código v48 la ignora); si ya está el gate nuevo, volver al backend v48 (sin gate). Los valores previos eran «columna inexistente», así que restaurar = eliminar la columna. Se registra un evento `PERMISOS_MODIFICADOS` por usuario (`ejecutadoPor: migracion:E10-1`) con `permisosAntes`/`permisosDespues`. |

Los usuarios que se reactiven más adelante nacerán sin `mapa` (mínimo privilegio); el panel lo advierte.

### 7.3 Migración `ubicacion_corregir` (alineada con «`ubicacion` = lectura»)

**Comportamiento actual inferido** (§2.3): todo `ubicacion = SI` puede sugerir/cancelar; solo `ubicacion_corregir = SI` puede proponer correcciones de campo. No se asume que todos deban recibir `ubicacion_corregir`, porque concederlo **también** habilita `proponerCorreccionUbicacion` (una capacidad que muchos hoy no tienen).

| Opción | Criterio | Efecto | Recomendación |
|---|---|---|---|
| **A (recomendada, por evidencia)** | `ubicacion_corregir = SI` para quien ya lo tiene (sin cambio) **más** quien tiene `ubicacion = SI` y **figura como autor** de alguna sugerencia/cancelación | nadie que haya usado sugerir lo pierde; los `ubicacion = SI` sin evidencia pasan a solo lectura (desaparecen los botones «Sugerir» para ellos) | **sí** |
| B (cero pérdida) | `ubicacion_corregir = SI` para **todos** los `ubicacion = SI` | nadie pierde nada, pero **amplía** a todos la capacidad de proponer correcciones de campo | solo si A resulta en pérdidas que la Dirección no acepte |
| C | no migrar ni cambiar el gate | mantiene el comportamiento actual (todo `ubicacion` puede sugerir) | posponer el cierre de H2 a E10-4 |

Los **validadores** (`ubicacion_validar = SI`) no necesitan sugerir (deciden directo); quedan cubiertos por A solo si hay evidencia. **Cantidades:** pendientes del diagnóstico (ítem 5). **Rollback:** restaurar la columna desde los eventos (`permisosAntes`) o volver al backend v48 (que vuelve a exigir solo `ubicacion` para sugerir); los usuarios a los que se les concedió `ubicacion_corregir` conservan ese permiso, que v48 ya conoce.

### 7.4 Migración de esquema y administradores iniciales

| Columna | Valor escrito en cada fila existente |
|---|---|
| `tipo` | `INTERNO` (**requiere que la Dirección confirme que todos los usuarios actuales son internos**; el diagnóstico muestra la lista enmascarada) |
| `version` | `1` |
| `actualizado_utc` | instante de la migración (UTC, ISO) |
| `actualizado_por` | `migracion:E10-1` |
| `usuarios_admin` | `NO` para todos **salvo** los emails que se pasen como **parámetro de la corrida** (nunca hardcodeados); mínimo 1, recomendado 2 (para no depender de una sola persona) |
| `mapa` | §7.2 |

Orden dentro de la migración: **primero los valores** (en columnas con encabezado temporal) y **recién al final** se renombran los encabezados definitivos, para que no exista ningún momento con la columna visible y celdas vacías. Antes de ejecutar: copia de la hoja (Archivo → Hacer una copia) y descarga del historial de versiones. **Quién es administrador inicial** es una decisión abierta (D1).

---

## 8. `registerWellSearch` y `registerDescargaItf`: auditoría y recomendación

### 8.1 Qué hacen y por qué existen como acciones

| | `registerWellSearch` | `registerDescargaItf` |
|---|---|---|
| Quién las llama | `js/app.js` (`buscarPozo`) al **terminar** una búsqueda, fire-and-forget con `keepalive`; Cerca mío/mapas nunca la llaman | `js/seleccion.js` al **terminar** una descarga ZIP de ITF, fire-and-forget |
| Qué hacen | `Busquedas` (fila: timestamp, email, nombre, `wellId`, resultado, 4 módulos SI/NO) + Telegram (🔎 identidad, pozo, módulos encontrados) | Telegram (📦 usuario, seleccionados/solicitados/descargados/fallidos, hasta 5 `wellId`) |
| Por qué son acciones | Una «búsqueda» **no es una llamada del backend**: el hub la compone con **cuatro lecturas independientes en paralelo** (`getItfAvailability`, `getWellRecord`, `getWellLocation`, `getMonitoringPoint`), cada una también usada por otros flujos. No hay un punto único del servidor que sepa que «terminó una búsqueda»; el cliente es quien lo sabe. Igual la descarga: el ZIP se arma en el navegador con N `getProfile`. | |
| Permiso | solo sesión + formato de `wellId` | solo sesión + forma del resumen |

### 8.2 Hallazgos (verificados en código)

- **Una llamada directa dispara Telegram**: sí. Con un token válido, `registerWellSearch` manda un mensaje por cada `wellId` **distinto** (el dedupe es por `email+wellId` durante 30 s); `registerDescargaItf` manda un mensaje por cada combinación distinta de cantidades/primer `wellId` (dedupe de 10 s). No hay tope por usuario ni global.
- **Cada llamada agrega una fila** a `Busquedas` (sin tope: la hoja crece sin límite y compite por el lock de escritura).
- **Los datos son declarados por el cliente**: `modulos` (informativo) y todo el resumen de descarga (`totalSeleccionados`, `descargados`, `fallidos`, `wellIds`) son **no autoritativos y falsificables**. No se verifica que el pozo exista ni que se haya hecho la descarga.
- **Sin permiso de módulo**: cualquier usuario activo puede llamarlas aunque no tenga ningún módulo.
- Telegram y `UrlFetch` comparten cuota con el login (`UrlFetch` diario): un abuso en estas acciones puede afectar el acceso de todos.
- Lo **autoritativo** de «quién descargó qué» ya está en `Historial`: cada `getProfile` exitoso escribe `getProfile/OK` con el email y el pozo.

### 8.3 Recomendación (sin implementar)

1. **Mantenerlas como acciones** (no convertirlas en efectos internos): hacerlo exigiría un endpoint agregado «buscar pozo» que reemplace las cuatro lecturas paralelas, un refactor mayor que no corresponde a E10-1. Se anota como opción de E10-5.
2. `registerWellSearch`: exigir **al menos un permiso de lectura de módulo** (`perfil`, `datos`, `ubicacion` o `ne`); sin ninguno → `PERMISSION_DENIED` sin efectos.
3. `registerDescargaItf`: exigir **`perfil`** (es la única forma de descargar ITF) y validar coherencia (`solicitados === wellIds.length`, `descargados + fallidos === solicitados`, `solicitados ≤ 500`).
4. **Tope por usuario** (contador en `CacheService`, p. ej. N por hora): superado el tope se responde `ok` **sin** fila en `Busquedas` ni Telegram. Y un **tope global** de Telegram por hora (corta-circuito) para no saturar el bot ni la cuota de `UrlFetch`.
5. Etiquetar el mensaje de Telegram de descarga como «reportado por el cliente».
6. La política de **qué avisos se generan para usuarios externos** queda para E10-5 (no se decide acá).

Los valores de los topes son una decisión abierta (D6); la recomendación 2 y 3 se pueden hacer en E10-1 sin riesgo para los internos (todos los que buscan tienen al menos un módulo; todo el que descarga tiene `perfil`).

---

## 9. Administración futura: infraestructura que prepara E10-1

(La pantalla es E10-2; E10-1 solo deja el soporte.)

### 9.1 Permiso `usuarios_admin` y acciones administrativas

Todas las acciones `admin*` (listar, obtener catálogo, crear, editar, activar/desactivar, cambiar permisos, consultar auditoría administrativa) validan **en el backend**, en este orden: sesión → usuario activo → `usuarios_admin` efectivo (columna `SI` **y** `tipo = INTERNO`) → flag `E10_ADMIN_USUARIOS_ACTIVO` → lista blanca de campos. Ocultar la UI no es una defensa. Un `EXTERNO` con `usuarios_admin = SI` en la hoja (por ejemplo editada a mano) **no** es administrador efectivo, y además la API rechaza **escribir** ese par (`TIPO_NO_PERMITE_PERMISO`) aunque llegue directo.

### 9.2 Auditoría de la hoja real

Ver §7.1: el diagnóstico de solo lectura es el mecanismo. También detecta la situación «**ningún administrador efectivo**» y duplicados.

### 9.3 Protección del último administrador

Regla (en el backend, dentro del lock, sobre el estado **leído de la hoja en ese momento**, no del cache): ninguna operación puede dejar **0 usuarios** que cumplan `estado = activo ∧ tipo = INTERNO ∧ usuarios_admin = SI` (más `acceso_hasta` cuando exista). Cubre: desactivar, quitar `usuarios_admin`, cambiar el tipo a EXTERNO, y cualquier edición que combine esos cambios. Error `ULTIMO_ADMIN`. Se evalúa **simulando el resultado** de la operación y contando de nuevo; dos administradores que se quitan el permiso mutuamente "al mismo tiempo" se serializan por el lock y el segundo falla. Sin emails hardcodeados; la UI puede advertir pero la garantía es del backend.
- **Vía de recuperación** (único camino fuera de la app): función de editor, parametrizada por email, que deja a una persona como administrador efectivo y registra `ADMIN_RESTAURADO_MANUAL` (origen `RECUPERACION_MANUAL`).
- **Red de seguridad:** el diagnóstico avisa si hay 0 administradores efectivos (p. ej. por edición manual de la hoja).

### 9.4 Concurrencia

`LockService.getScriptLock().waitLock(…)` (patrón ya usado en `ItfEventosRepository`, `FotosPozosRepository`, etc.) alrededor de cada lectura-modificación-escritura; `version` + `etag` (§6.2): quien abrió el usuario en la versión N y guarda cuando otro lo llevó a N+1 recibe `CONFLICT_VERSION` con el estado actual y debe recargar; **nunca** se sobrescribe en silencio. Reintento idempotente: si el último evento del usuario trae el mismo `clientRequestId`, se responde éxito.

### 9.5 Hoja `UsuariosEventos` (append-only)

Hoja dedicada (no se usa `Historial`, que representa hechos funcionales de pozos; los intentos denegados ya quedan en `Historial` por `validarPermiso`). Esquema exacto propuesto (19 columnas, buscadas por encabezado, fail-closed si falta alguna):

| # | Columna | Contenido |
|---|---|---|
| 1 | `eventoId` | UUID |
| 2 | `secuencia` | entero creciente, calculado **bajo lock** |
| 3 | `timestampUtc` | ISO-8601 UTC |
| 4 | `evento` | `USUARIO_CREADO`, `USUARIO_EDITADO`, `USUARIO_DESACTIVADO`, `USUARIO_REACTIVADO`, `PERMISOS_MODIFICADOS`, `ADMIN_RESTAURADO_MANUAL` |
| 5 | `usuarioObjetivo` | email del afectado |
| 6 | `ejecutadoPor` | email del admin (de la **sesión**, nunca del cuerpo) o `migracion:E10-1` |
| 7 | `versionAnterior` | |
| 8 | `versionNueva` | |
| 9 | `estadoAnterior` | |
| 10 | `estadoNuevo` | |
| 11 | `tipoAnterior` | |
| 12 | `tipoNuevo` | |
| 13 | `nombreAnterior` | |
| 14 | `nombreNuevo` | |
| 15 | `permisosAntes` | lista ordenada de ids en `SI`, separada por comas |
| 16 | `permisosDespues` | ídem |
| 17 | `motivo` | texto corto opcional (≤ 200) |
| 18 | `clientRequestId` | idempotencia |
| 19 | `origen` | `APP` / `MIGRACION` / `RECUPERACION_MANUAL` |

Se agregan a lo pedido: tipo y nombre antes/después (necesarios para `USUARIO_EDITADO`), `motivo`, `clientRequestId` y `origen`. **Sin secretos** (no hay contraseñas ni tokens); sí contiene emails (hoja restringida al dueño). Una operación que cambia varias categorías escribe **un evento por categoría** con las mismas versiones. El setup de la hoja es idempotente y no crea nada si ya existe (patrón de `setupPropuestaNotificacionesSheet`).
**Orden de escritura (no hay transacciones entre hojas):** bajo lock, actualizar la fila de `Usuarios` y **después** agregar el evento; si el evento falla se **revierte** la fila con el snapshot «antes» y se responde `AUDITORIA_NO_DISPONIBLE` (preferible rechazar un cambio a aplicarlo sin rastro); si la reversión también fallara se loguea como crítico y el diagnóstico lo detecta comparando `version` de la fila con la `versionNueva` del último evento.

### 9.6 Invalidación inmediata del cache

Hoy una baja o un recorte tarda ≤ 5 min. Estrategia propuesta (dentro del lock, **después** del write de la fila):

1. `cache.remove('user_access_v2_<email>')` (y la clave vieja durante la transición).
2. **Tombstone** `user_access_inv_<email>` con TTL corto (~15 s): mientras exista, `getUserAccess` **lee de la hoja y no escribe el cache**. Esto cierra la carrera «una request leyó la hoja antes del cambio y guarda el valor viejo después de mi `remove`»: antes de cada `cache.put` se verifica que no haya tombstone.
3. Aplica a **altas, bajas, reactivaciones y a quitar o agregar cualquier permiso**: los tres casos efectivos de inmediato.
4. Los caches derivados que dependen de permisos (destinatarios de los avisos por email) **no usan** este cache: `sheetUserRepository_listarConPermisos` lee la hoja, pero debe aplicar la **misma función de acceso efectivo** (tipo, flag de externos, y `acceso_hasta` cuando exista) para no avisar a quien no esté realmente habilitado.
5. Una edición **manual** de la hoja conserva el retraso de ≤ 5 min (no pasa por la app).

---

## 10. Flags (fail-closed, separados de E9)

Script Properties, mismo patrón que `ITF_E9_ACTIVO`: encendido **solo** con el texto exacto `SI`; ausente, vacío, distinto o error al leer la propiedad = apagado. No se reutiliza nada de E9.

| Flag | Qué gobierna | Apagado |
|---|---|---|
| `E10_ADMIN_USUARIOS_ACTIVO` | todas las acciones `admin*` | responden `E10_ADMIN_INACTIVO` **antes de tocar la hoja** (después de sesión y permiso, igual que `ITF_E9_INACTIVO`). `login`/`checkSession` no devuelven la capacidad de administración |
| `E10_GESTION_EXTERNOS_ACTIVO` | la GESTION ADMINISTRATIVA de externos: crear un EXTERNO, convertir un usuario a EXTERNO, reactivar un EXTERNO (**no** el login: los externos existentes mantienen su acceso por estado + permisos) | las tres operaciones responden `E10_GESTION_EXTERNOS_INACTIVA` |
| `AUTH_EMAIL_VERIFICADO_MODO` | §5.3 | `OBSERVAR` |

En E10-1 se prepara el soporte (funciones de lectura de los flags y su uso en el cálculo de acceso) y **no se enciende ninguno**; se sigue sin crear usuarios externos. Con `E10_GESTION_EXTERNOS_ACTIVO` apagado, **crear** un externo desde la administración se rechaza (`E10_GESTION_EXTERNOS_INACTIVA`); el acceso de los externos existentes no depende del flag.

---

## 11. Riesgos

| # | Riesgo | Mitigación |
|---|---|---|
| R1 | Gate de `mapa` antes de migrar la hoja → los internos pierden el mapa | Orden obligatorio: hoja → backend → frontend (§14); el diagnóstico confirma `mapa = SI` en todos los activos antes de desplegar el gate |
| R2 | Frontend nuevo antes que el backend nuevo → «Cerca mío» desaparece | Orden: backend primero; el frontend nuevo lee `permisos.mapa` que ya existe |
| R3 | Gate de sugerir/cancelar quita un botón que alguien usa | Migración por evidencia (§7.3) y comunicación previa |
| R4 | `email_verified` bloquea a alguien legítimo | Modo OBSERVAR primero (§5.3) |
| R5 | Orden de carga de archivos en Apps Script con constantes derivadas del catálogo | Solo funciones (§4.3) |
| R6 | Cache con forma vieja | Clave `v2` + tombstone |
| R7 | Edición manual de la hoja por fuera de la app (sin `version`) | `etag` + diagnóstico + protección del rango tras E10-2 |
| R8 | Quedarse sin administradores | Regla del último admin (backend) + función de recuperación + diagnóstico |
| R9 | `tokeninfo` limitado/intermitente, o consumo de `UrlFetch` por login anónimo | Documentado; contención en E10-5 |
| R10 | `registerWellSearch`/`registerDescargaItf` usadas como amplificador de Telegram o de filas en `Busquedas` | §8.3 |
| R11 | `getMapaPozos` lee Drive entero por llamada | tope por usuario en E10-5; se evalúa cache de servidor |
| R12 | Contenido de los ITF sin revisar | §12 antes de E10-3 |
| R13 | Un permiso nuevo mal ubicado en el catálogo rompe E3–E9 | claves existentes intactas; tests de regresión de todos los handlers |

---

## 12. Cómo revisar una muestra real de ITF antes de E10-3 (diseño, no se ejecuta)

**Objetivo:** saber si los ITF contienen titular, domicilio, coordenadas, nomenclatura catastral, datos parcelarios, datos personales u otra información sensible. **No se publica ni se envía nada a terceros.**

Universo: **16.599** ITF legacy canónicos (`DD-PPPP.jpg`), mediana ~0,78 MB, más las 762 variantes fuera del patrón y los documentos E9. Las imágenes que sirve la app son las de la carpeta del ITF, así que se revisan **exactamente esos archivos**.

1. **Quién revisa:** personal autorizado de la Dirección, en **su propia sesión de Drive** y en su equipo. **No se suben las imágenes a Claude ni a ningún servicio externo**, ni se copian al repositorio ni a Pages.
2. **Muestra reproducible:** un script local de solo lectura (sobre la lista de nombres que ya produce la auditoría de la carpeta) elige con semilla fija una muestra **estratificada por departamento** (19 estratos, proporcional) de **n ≈ 400**, más una muestra dirigida: los 20 archivos más grandes y los 20 más chicos, los más antiguos y los más recientes, los fuera de patrón y los 3 `.JPG`. Salida: **solo una lista de `wellId`** (sin contenido). Con n = 400 y **0 hallazgos**, el límite superior del 95 % de prevalencia es ≈ 0,75 % (regla de tres); con hallazgos, la prevalencia se estima con ±5 puntos.
3. **Planilla de revisión local** (fuera del repositorio): por `wellId`, sí/no/legible para: titular o nombre de persona (propietario, técnico, perforista), domicilio, **coordenadas** (lat/lon, UTM, Gauss-Krüger), **nomenclatura catastral**/datos parcelarios, número de expediente, DNI/CUIT, teléfono/email, firma o sello, fotos o croquis del terreno, otra información; gravedad (ninguna / baja / alta); y si es **legible a la resolución en que se sirve**.
4. **Pre-clasificación automática opcional, 100 % local:** OCR (por ejemplo Tesseract) en el equipo del revisor sobre la muestra —o sobre todo el universo si se desea—, con expresiones regulares (palabras como titular/propietario/domicilio/expediente/nomenclatura/catastro, patrones de coordenadas, DNI/CUIT). **Solo salen del equipo los conteos y las banderas por `wellId`, nunca las imágenes.** Sirve para priorizar la revisión humana, no para reemplazarla (la calidad del OCR sobre estas imágenes puede ser baja).
5. **Metadatos de Drive:** contar cuántos archivos tienen descripción no vacía u otro metadato con texto (lo puede hacer la misma auditoría de solo lectura de la carpeta).
6. **Entregable:** tabla de prevalencia por tipo de dato + clasificación del conjunto (sin datos personales / con algunos / sistemático) **sin decidir** qué hacer: las mitigaciones (por ejemplo ocultar o recortar) quedan para E10-4.
7. **Cuándo:** antes de E10-3; no bloquea E10-1 ni E10-2.

---

## 13. Pruebas (diseño)

| Área | Casos |
|---|---|
| **AUTH** | los de §5.4 |
| **PERMISOS** | `mapa`: con `SI` el trío `getMapaPozos`/`getUbicacionesValidadas`/`getDecisionesFuentesDelta` responde; con `NO` o columna ausente → `PERMISSION_DENIED` en los **tres** (y sin fila de datos); `ubicacion` solo: lee pero `sugerirDecisionFuente`/`cancelarSugerenciaFuente` → `PERMISSION_DENIED`; `ubicacion` + `ubicacion_corregir`: sugiere y cancela; `ubicacion_validar` sin `corregir`: decide pero no propone; `usuarios_admin`: permitido solo con `SI` + `tipo INTERNO` + flag; `EXTERNO` + `usuarios_admin = SI` en la hoja → no es admin efectivo y la API rechaza escribirlo (`TIPO_NO_PERMITE_PERMISO`) aun enviado directo; `tipo` vacío con columna presente → restrictivo; catálogo: cada id aparece una vez, dependencias consistentes, las claves de `login`/`checkSession` = ids del catálogo |
| **ADMIN BASE** | último admin protegido en: desactivar, quitar permiso, cambiar tipo, combinaciones y concurrencia de dos admins; concurrencia por `version` y por `etag` (edición manual intermedia); reintento idempotente; cache invalidado: baja, quitar y agregar permiso efectivos en la **siguiente** request, y la carrera del tombstone; **fail-closed** si falta una columna del catálogo, la hoja `UsuariosEventos` o el esquema de la hoja de eventos no coincide (`AUDITORIA_NO_DISPONIBLE`, sin escribir la fila de `Usuarios`); reversión de la fila si el evento falla; diagnóstico detecta 0 admins y duplicados |
| **FLAGS** | ausente / vacío / `si` minúscula / `SÍ` / `true` / excepción al leer = apagado; apagado → `E10_ADMIN_INACTIVO` antes de abrir la hoja |
| **TELEGRAM / TELEMETRÍA** | `registerWellSearch` sin ningún módulo → denegado y sin efectos; con tope superado → `ok` sin fila ni Telegram; `registerDescargaItf` sin `perfil` o con resumen incoherente → rechazo; el tope global corta Telegram |
| **COMPATIBILIDAD** | usuarios actuales (sin `tipo`/`version`) siguen entrando con v48 y con el código nuevo en modo heredado; **todos** los tests de E3–E9 y la suite completa siguen verdes; sesiones existentes (`checkSession`) con permisos nuevos presentes; el frontend actual (sin `mapa`) sigue funcionando contra el backend nuevo con el usuario migrado; el frontend nuevo contra un usuario con `mapa = SI`; guarda de «sin lista literal de permisos» |
| **MIGRACIÓN** (sobre copias/fakes) | `mapa = SI` solo en activos; `tipo = INTERNO` en todas; `usuarios_admin = SI` solo en los parámetros; evento por usuario; idempotente (segunda corrida no cambia nada); renombrado de encabezados al final |
| **Mutaciones** | las mutaciones del repositorio del proyecto (como en E9) sobre: regla del último admin, techo `EXTERNO`, gate de `mapa`, gate de sugerir, `email_verified`, tombstone |

---

## 14. Plan E10 actualizado

| Etapa | Contenido |
|---|---|
| **E10-1** | **Seguridad + catálogo + nuevos permisos + esquema base** (este plan) |
| **E10-2** | **Administración > Usuarios**: alta, edición, baja lógica, reactivación, cambio de permisos, búsqueda y filtros (pantalla) |
| **E10-3** | **Política de autoridad para el EXTERNO autenticado** (adoptado el 19/11/2026): un externo consulta, propone y carga según sus permisos, pero nunca valida, modera, anula contenido ajeno ni administra. Cierra la brecha de E10-2. Ver [e10-3-politica-autoridad-externos.md](e10-3-politica-autoridad-externos.md) |
| **E10-4** | **Decisiones de información**: qué ve un EXTERNO y qué ve el PÚBLICO / ANÓNIMO (ITF, ubicación, NC16, datos, fotos, observaciones), URL pública (`wellId` vs. opaco) y QR/NFC; incluye la revisión de contenido de ITF (§12). Solo decisiones y diseño. Ver [e10-publico-anonimo-diseno.md](e10-publico-anonimo-diseno.md) |
| **E10-5** | **Hardening**: rate limiting, scraping, kill-switch, aislamiento de cuota, `email_verified = EXIGIR`, logging público, vencimiento de externos, protección de endpoints públicos |
| **Etapa posterior: capa pública** | pipeline con whitelist, índice público reducido, `/publico`, búsqueda, ficha, mapa si corresponde, QR/NFC opcional. Se construye **después** del hardening |
| **E10-6** | **Piloto de gestión real de externos** con `E10_GESTION_EXTERNOS_ACTIVO` |
| **E10-7** | **Cierre productivo** |

### 14.1 Orden de implementación de E10-1 (cada paso con sus tests y sin encender flags)

| Paso | Qué | Notas |
|---|---|---|
| 0 | Función de diagnóstico de **solo lectura** (`@HEAD`) | produce los conteos de §7 |
| 1 | Decisiones D1–D3 del usuario con los números del paso 0 | |
| 2 | **Copia de la hoja** y migración de **esquema** (columnas nuevas, `tipo = INTERNO`, `version`, `mapa = SI` a activos, `usuarios_admin` a los parámetros, ubicación según la opción elegida) + eventos de migración | el backend v48 no se ve afectado |
| 3 | `PermisosCatalogo.js` + derivación (reemplaza las listas duplicadas) + acceso efectivo (`tipo`, flags) + cache `v2`/tombstone | sin cambio funcional visible; todo apagado |
| 4 | Gate `mapa` (los 3 endpoints) y gate de sugerir/cancelar (`ubicacion_corregir`) + `permisos` con las claves nuevas | **solo después** de verificar que la hoja ya está migrada |
| 5 | `email_verified` en modo `OBSERVAR` | |
| 6 | `registerWellSearch`/`registerDescargaItf` con permiso y topes | |
| 7 | `UsuariosEventos` (setup + repositorio append-only) y el soporte de administración (lock, `version`/`etag`, regla del último admin) **sin acciones públicas** | los flags `E10_*` apagados |
| 8 | Frontend: `permisosActuales = {}`, `mapa` en `mapaLogic`, rol de ubicación con `ubicacion_corregir`, mensaje `EMAIL_NO_VERIFICADO` | **después** del backend |
| 9 | Suite completa + mutaciones; despliegue por el esquema de E9 (`gas:push` a `@HEAD`, versión, deploy al deployment productivo existente) con **rollback listo** | cada despliegue con autorización explícita |
| 10 | Tras observación sin hallazgos: pasar `email_verified` a `EXIGIR` | |

### 14.2 Rollback

| Qué | Cómo |
|---|---|
| Código | volver el deployment productivo a la versión anterior (v48): v48 ignora las columnas nuevas y no conoce los gates nuevos |
| Hoja | las columnas nuevas son inertes para v48: se pueden dejar o borrar; los valores previos (`ubicacion_corregir`) se restauran desde los eventos de migración; la copia previa de la hoja es el respaldo final |
| `mapa` | quitar el gate = volver a v48; la columna sobra pero no molesta |
| `email_verified` | volver la propiedad a `OBSERVAR` (efecto inmediato, sin deploy) |
| Flags | apagar la propiedad (efecto inmediato) |

---

## 15. Decisiones que siguen realmente abiertas

| # | Decisión | Cuándo | Recomendación |
|---|---|---|---|
| D1 | **Quiénes son los administradores iniciales** (≥ 2 recomendado) | antes del paso 2 | elegir con el listado del diagnóstico |
| D2 | **Confirmar que todos los usuarios actuales son INTERNOS** (si hubiera alguna excepción hay que marcarla antes de migrar) | antes del paso 2 | revisar la lista enmascarada |
| D3 | Si `AUTH_EMAIL_VERIFICADO_MODO` inválido se interpreta como `OBSERVAR` (no bloquea) o como `EXIGIR` (fail-closed) | paso 5 | `OBSERVAR` durante la transición porque la propiedad ausente es el estado normal; `EXIGIR` solo cuando se la configura |
| D4 | Opción A, B o C para `ubicacion_corregir` | paso 1, con los conteos | A |
| D5 | Topes de `registerWellSearch`/`registerDescargaItf` y global de Telegram | paso 6 | valores iniciales conservadores y configurables |
| D6 | `accesoHasta`: ¿lo tendrán los externos? | E10-3 | decidir con el piloto |
| D7 | Política funcional de externos (todo lo listado al inicio) | E10-3 / E10-4 | **abierta a propósito** |
| D8 | Plantillas del panel (solo internas) y proteger el rango de `Usuarios` contra edición manual | E10-2 | sí, ambas |
| D9 | Si, por la fragilidad de `tokeninfo` (A2), se pasa a verificar el JWT localmente | E10-5 | evaluar con datos de uso |
| D10 | Cambiar `registerWellSearch` a un endpoint agregado «buscar pozo» | E10-5 | solo si el volumen lo justifica |
