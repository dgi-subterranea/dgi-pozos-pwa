# E10-1: seguridad, catálogo de permisos y esquema base de usuarios (implementación local; NO desplegada)

Estado: **implementado y probado en local el 05/11/2026. Sin `gas:push`, sin versión, sin deploy, sin `git push`, sin migrar `Usuarios`, sin crear hojas reales, sin tocar Script Properties, sin encender flags.** Producción sigue en v48 y storage en v6. Contexto y auditoría previa: [e10-acceso-externo-y-administracion-usuarios.md](e10-acceso-externo-y-administracion-usuarios.md).

Alcance de E10-1: seguridad, autenticación, catálogo de permisos, permisos nuevos, esquema base de `Usuarios`, auditoría, infraestructura de administración, separación INTERNO / EXTERNO y fail-closed. **No** hay pantalla de administración (E10-2), **no** se decide qué ve un usuario externo (E10-3 / E10-4) y **no** se crean usuarios externos.

## 1. Arquitectura implementada

| Capa | Pieza | Qué hace |
|---|---|---|
| Catálogo | `PermisosCatalogo.js` | **Fuente canónica** de los 17 permisos (datos y funciones puras, sin dependencias al cargar). Todo lo demás deriva de acá. |
| Dominio | `UsuariosDominio.js` | Reglas puras: acceso efectivo, administrador efectivo, validación de una mutación (catálogo, EXTERNO + `usuarios_admin`, **último administrador**), `etag`, eventos de auditoría. |
| Flags | `E10Flags.js` | `E10_ADMIN_USUARIOS_ACTIVO`, `E10_GESTION_EXTERNOS_ACTIVO` y `EMAIL_VERIFIED_MODO`. Fail-closed. |
| Repositorio | `SheetUserRepository.js` | Único que conoce la hoja `Usuarios`: lectura por request (con `tipo` y `version`), lectura/escritura de la administración y primitivas de la migración. Sin lista propia de permisos. |
| Auditoría | `UsuariosEventosRepository.js` | Hoja `UsuariosEventos` (solo agregar filas, esquema fijo), setup manual. |
| Acceso | `AuthService.js` | `getUserAccess` (acceso efectivo, cache v2 + tombstone), `authService_invalidarAcceso`, login con `email_verified` OBSERVAR / EXIGIR. |
| Operaciones | `UsuariosAdminService.js` | Alta, edición, baja lógica y reactivación con lock, versión + etag, reglas, auditoría con rollback e invalidación inmediata. **Sin endpoints todavía** (E10-2). |
| Compuertas | `Api.js` | `mapa` en los 3 endpoints del dataset; `ubicacion_corregir` en sugerir / cancelar; telemetría con permiso, existencia y coherencia. |
| Migración | `E10Migracion.js` | `migracionE10Planificar()` (solo lectura), `migracionE10Ejecutar()`, `migracionE10Revertir()`. Manuales, idempotentes, con respaldo y rollback. |
| Preflight | `E10Preflight.js` | `preflightE10_1()`: verificación de solo lectura. |
| Frontend | `mapaLogic.js`, `ubicacionFuenteDecisionesUiLogic.js`, `errorMessages.js`, `app.js` | `mapa` decide el dataset; rol de ubicación por `ubicacion_corregir`; mensaje de `EMAIL_NO_VERIFICADO`; `permisosActuales = {}` (sin lista). |

## 2. Modelo de acceso

`tipo` (INTERNO / EXTERNO) + `estado` + permisos individuales. **`tipo` no concede acceso**; la autoridad son los permisos. Dos reglas técnicas donde `tipo` participa:

1. Un permiso con `aplicableExterno = false` (hoy solo `usuarios_admin`) es **efectivo solo para un INTERNO**. Un EXTERNO con `usuarios_admin = SI` en la hoja no es administrador; y la API rechaza *escribir* ese par (`TIPO_NO_PERMITE_PERMISO`), aunque llegue directo.
2. **Administrador efectivo** = `estado = activo` + `tipo = INTERNO` + `usuarios_admin = SI`. La regla del último administrador cuenta exactamente eso.

**Flag `E10_GESTION_EXTERNOS_ACTIVO` (decisión confirmada; antes se llamaba `E10_EXTERNOS_ACTIVO`, nombre descartado por ambiguo).** Gobierna **solo la gestión administrativa de externos**, nunca el acceso:

| Estado | Efecto |
|---|---|
| APAGADO (ausente, vacío, distinto de `SI` o error al leer) | No se crea un usuario EXTERNO nuevo, no se convierte un INTERNO a EXTERNO y no se reactiva un EXTERNO desde la administración: esas operaciones responden `E10_GESTION_EXTERNOS_INACTIVA`. |
| ENCENDIDO (`SI` exacto) | Se habilitan esas tres operaciones. |

**No es un gate de login.** Los EXTERNOS ya existentes (María Soledad Gualde y Sebastián Dietrich) mantienen su acceso según su **estado** y sus **permisos**, con el flag apagado o encendido; un flag que bloqueara el acceso de los EXTERNO habría apagado su acceso funcional el día del despliegue, lo que contradice «no cambiar su acceso en E10-1». Desactivar a un externo existente tampoco requiere el flag. Lo que un externo puede ver o hacer se decide en E10-3 / E10-4.

## 3. Catálogo de permisos (17)

Campos de cada entrada: `id`, `nombre`, `descripcion`, `modulo`, `categoria` (`lectura` / `escritura` / `moderacion` / `administracion`), `aplicableInterno`, `aplicableExterno` (compatibilidad potencial: **no concede nada**), `dependeDe`, `critico`, `orden`. (`dependeDe` y `critico` se suman a los campos pedidos: el primero impide combinaciones incoherentes y el segundo evita hardcodear en la UI qué cambios confirmar.)

| orden | id | categoría | dependeDe | crítico | aplicableExterno |
|---|---|---|---|---|---|
| 10 | `perfil` | lectura | — | no | sí |
| 11 | `perfil_subir` | escritura | `perfil` | no | sí |
| 12 | `perfil_validar` | moderación | `perfil` | sí | sí |
| 20 | `datos` | lectura | — | sí | sí |
| 30 | `ubicacion` | **lectura** | — | no | sí |
| 31 | `ubicacion_corregir` | **escritura** (proponer, sugerir, cancelar) | `ubicacion` | no | sí |
| 32 | `ubicacion_validar` | moderación | `ubicacion` | sí | sí |
| 40 | `mapa` *(nuevo)* | lectura | — | no | sí |
| 50 | `ne` | lectura | — | no | sí |
| 60 | `fotos` | lectura | — | no | sí |
| 61 | `fotos_carga` | escritura | — | no | sí |
| 62 | `fotos_moderar` | moderación | `fotos` | sí | sí |
| 70 | `observaciones` | lectura | — | no | sí |
| 71 | `observaciones_agregar` | escritura | `observaciones` | no | sí |
| 72 | `observaciones_anular` | moderación | `observaciones` | sí | sí |
| 80 | `reemplazo` | escritura | — | no | sí |
| 90 | `usuarios_admin` *(nuevo)* | administración | — | sí | **no (techo duro)** |

**Cómo se consume:** el backend deriva de `permisosCatalogo_*` (a llamada: en Apps Script el orden de carga no está garantizado, así que no hay constantes derivadas al cargar); `login` y `checkSession` devuelven un objeto `{id: boolean}` con **todos** los ids del catálogo (los clientes viejos ignoran los nuevos). El **frontend no mantiene ninguna lista**: ya era fail-closed por construcción (cada chequeo es sobre una clave que puede no existir), así que `permisosActuales` arranca y se reinicia en `{}`; el panel de E10-2 pedirá el catálogo al backend. Tres tests de guarda impiden que reaparezca una lista literal en el backend o en `js/`.

## 4. Esquema de la hoja `Usuarios`

Existentes (19): `email, nombre, estado, fecha_alta` + 15 permisos (`ubicacion_corregir` ya existía). **Se agregan exactamente 6**: `tipo`, `version`, `actualizado_utc`, `actualizado_por`, `usuarios_admin`, `mapa` (25 columnas). Se descartaron `creadoUtc` / `creadoPor` (están en `fecha_alta` y en el evento `USUARIO_CREADO`). **`acceso_hasta` no se agrega**: queda reservado para E10-3.

Semántica: `tipo` vacío o inválido o columna ausente → no es administrador efectivo y el resto del acceso **no cambia**; `version` vacía = 0; los permisos nuevos valen NO si la columna falta (fail-closed). Concurrencia: `version` + `etag` (hash del estado editable: detecta ediciones manuales que no suben la versión). El email nunca se edita.

## 5. Hoja `UsuariosEventos` (solo agregar filas)

19 columnas: `eventoId, secuencia, evento, usuarioObjetivo, nombreObjetivo, nombreAnterior, ejecutadoPor, timestampUtc, tipoAnterior, tipoNuevo, estadoAnterior, estadoNuevo, versionAnterior, versionNueva, permisosAntes, permisosDespues, motivo, clientRequestId, origen`. **Campo adicional justificado:** `nombreAnterior` (sin él, un cambio de solo el nombre no dejaría el valor previo en la auditoría). Eventos: `USUARIO_CREADO`, `USUARIO_EDITADO`, `USUARIO_DESACTIVADO`, `USUARIO_REACTIVADO`, `PERMISOS_MODIFICADOS` (+ `USUARIO_MIGRADO` y `USUARIO_MIGRACION_REVERTIDA` de la migración). `origen`: `APP` / `MIGRACION`. Sin secretos. Texto plano (un motivo que empiece con `=` no se evalúa). Un grupo de eventos se escribe en **una sola operación**; si la hoja falta o su esquema no coincide, ninguna operación toca `Usuarios` (`AUDITORIA_NO_DISPONIBLE`). La crea `setupUsuariosEventosSheet()` (manual, idempotente; **no ejecutado**).

## 6. Operaciones administrativas (infraestructura de E10-2)

`usuariosAdmin_crear / _actualizar / _cambiarEstado` (sin endpoints). Secuencia, todo bajo el script lock: flag `E10_ADMIN_USUARIOS_ACTIVO` → lock → abrir `Usuarios` y `UsuariosEventos` **sin escribir** → leer todo fresco → el actor es administrador efectivo (hoja fresca, no cache) → idempotencia por `clientRequestId` → versión esperada (+ `etag`) → estado nuevo → reglas → escribir `Usuarios` → escribir `UsuariosEventos` → **si la auditoría falla, revertir `Usuarios`** (en un alta, quitar la fila recién agregada) → invalidar el cache del usuario afectado.

- **Último administrador:** una operación nunca puede dejar 0 administradores efectivos: desactivar, quitar `usuarios_admin`, cambiar el tipo a EXTERNO o cualquier combinación (se simula el resultado y se cuenta sobre la hoja leída bajo lock; dos administradores que se quitan el permiso mutuamente se serializan y el segundo falla). Sin emails hardcodeados.
- **Conflicto:** guardar desde la versión N cuando otro lo llevó a N+1 devuelve `CONFLICT_VERSION` con el estado actual y no escribe nada.
- **Baja = `inactivo`**, nunca se borra una fila. La reactivación conserva los permisos guardados.
- Códigos: `E10_ADMIN_INACTIVO`, `E10_GESTION_EXTERNOS_INACTIVA`, `PERMISSION_DENIED`, `INVALID_REQUEST`, `USUARIOS_NO_EXISTE`, `USUARIOS_ESQUEMA_INCOMPLETO`, `AUDITORIA_NO_DISPONIBLE`, `USUARIO_EXISTE`, `USUARIO_NO_ENCONTRADO`, `EMAIL_DUPLICADO_EN_HOJA`, `CONFLICT_VERSION`, `EMAIL_INVALIDO`, `NOMBRE_INVALIDO`, `ESTADO_INVALIDO`, `TIPO_INVALIDO`, `PERMISO_DESCONOCIDO`, `PERMISOS_INCONSISTENTES`, `TIPO_NO_PERMITE_PERMISO`, `ULTIMO_ADMIN`.

## 7. Cache (invalidación inmediata)

Clave `user_access_v2_<email>` (forma nueva con `tipo` y `version`; las entradas viejas `user_access_<email>` expiran solas y nunca se leen). Tras cada cambio administrativo: `remove` de la clave + **tombstone** `user_access_inv_<email>` de 15 s; mientras existe, `getUserAccess` lee la hoja y **no escribe el cache**, lo que cierra la carrera «una request leyó la hoja antes del cambio y cachea el valor viejo después de mi `remove`». Resultado: alta, baja, reactivación, agregar o quitar un permiso son efectivos en la **siguiente** request. Las ediciones manuales de la hoja conservan el TTL de 5 minutos.

## 8. Autenticación: `email_verified`

`tokeninfo` devuelve las claims como **cadenas** (`"email_verified": "true"`, según la documentación de Google); el código acepta la cadena exacta `true` y el booleano. **No se pudo confirmar con un token real desde este entorno.** Orden del login: `aud` → email presente → `email_verified` → hoja `Usuarios`.

| Propiedad `EMAIL_VERIFIED_MODO` | Comportamiento |
|---|---|
| ausente / vacía / `OBSERVAR` / **cualquier valor inválido** | **No bloquea.** Registra en `Historial` solo la categoría: `EMAIL_VERIFIED_VERDADERO` / `_FALSO` / `_AUSENTE` / `_OTRO` (más `_MODO_INVALIDO` si la propiedad tiene un valor inválido). Nunca el token, el idToken ni el valor crudo. |
| `EXIGIR` | Todo valor distinto de verdadero → `EMAIL_NO_VERIFICADO`, sin sesión, antes de consultar `Usuarios` (no revela si el usuario existe). `checkSession` no cambia: las sesiones existentes siguen válidas. |

**Fail-safe elegido y documentado:** ausente o inválido ⇒ OBSERVAR (equivale al comportamiento de hoy). Un error de tipeo en la propiedad (`OBSERBAR`) no puede dejar sin acceso a todos; queda a la vista por `_MODO_INVALIDO`. Los internos actuales vuelven a pasar por Google recién cuando vence su token de 30 días o al «Salir»: la observación debe durar al menos una semana de uso real antes de pasar a `EXIGIR`.

## 9. `mapa` y `ubicacion_corregir`

- **`mapa`** gatea los **tres** endpoints del dataset general, a la vez: `getMapaPozos`, `getUbicacionesValidadas`, `getDecisionesFuentesDelta` (un barrido de los 62 handlers confirmó que no hay otros sin permiso de módulo salvo `getMetadata` y las dos de telemetría). Frontend: sin `mapa` no hay «Cerca mío» ni Provincia ni selección; con `ne` sin `mapa` se entra directo a Niveles Estáticos (su dataset es aparte).
- **`ubicacion` = lectura; `ubicacion_corregir` = escritura.** Un barrido de las 8 acciones de escritura de ubicación mostró que dos pedían solo `ubicacion`: `sugerirDecisionFuente` y `cancelarSugerenciaFuente`; ahora exigen `ubicacion` + `ubicacion_corregir`. Las otras seis ya pedían escritura o validación. Frontend: rol `CONSULTA` (solo `ubicacion`: ve estados, ninguna acción); `LECTOR` (nombre histórico) = quien sugiere. **Los 11 usuarios actuales ya tienen `ubicacion_corregir = SI`: no hay migración de valores.**

## 10. Telemetría (`registerWellSearch`, `registerDescargaItf`)

- `registerWellSearch`: exige al menos uno de `perfil`, `datos`, `ubicacion`, `ne` (sin permiso nuevo); verifica que el pozo **exista** con `pozoExistenciaService_verificar` (la fuente institucional única; **una** verificación por llamada, sin lecturas nuevas); pozo inexistente → `POZO_NOT_FOUND` e indeterminado → `SERVICE_UNAVAILABLE`, ambos **sin ningún efecto** (ni `Busquedas` ni Telegram). Los flags de `modulos` se acotan a los permisos reales de quien llama. **Cambio visible:** una búsqueda de un pozo inexistente ya no deja fila `NO_ENCONTRADO` en `Busquedas` ni aviso de Telegram.
- `registerDescargaItf`: exige `perfil` y un resumen coherente (`solicitados = wellIds.length`, `descargados + fallidos = solicitados`, `solicitados ≤ totalSeleccionados`, enteros).
- Se **conserva la deduplicación existente** (30 s por email + pozo; 10 s en la descarga). **El límite de tasa por usuario y global queda pendiente: E10-5** (no se agregan topes arbitrarios ahora).

## 11. Migración (manual; no se ejecuta con el deploy)

Parámetros **sin ningún email en el código**: Script Property `E10_MIGRACION_PARAMETROS` = `{"admins":[...],"externos":[...]}`, que carga a mano quien la ejecuta. Valores confirmados: `mapa = SI` a los 11 activos; `usuarios_admin = SI` a Federico Albrieu y Mariana Ryan (resto `NO`; DGI PERFILES no); `version = 1`; `tipo = EXTERNO` para María Soledad Gualde y Sebastián Dietrich, `INTERNO` para los otros 9; `actualizado_utc` = instante de la corrida (UTC) y `actualizado_por = migracion:E10-1` (valor institucional documentado, no una persona). **No se modifica ninguna celda existente: ningún permiso actual cambia, tampoco el de los dos externos** (un test lo comprueba fila por fila, en la hoja y en el login).

Reglas del plan: cada email debe existir; un administrador debe estar activo y no ser externo; al menos un administrador; sin emails duplicados o inválidos; estados activo/inactivo; esquema actual completo. Con cualquier bloqueo o conflicto **no se escribe nada**. `Ejecutar`: exige que `UsuariosEventos` exista, toma el lock, crea el **respaldo** (hoja `Usuarios_backup_E10-1_<fecha>`), agrega las 6 columnas en **una** escritura y registra un `USUARIO_MIGRADO` por usuario; si falla después de escribir, **revierte** lo que agregó. **Idempotente:** una segunda corrida informa `YA_APLICADA`; completa una migración parcial sin pisar valores correctos. `Revertir`: quita solo las 6 columnas, deja `USUARIO_MIGRACION_REVERTIDA` por usuario y se niega si ya hubo operaciones administrativas o si alguien modificó las columnas migradas.

## 12. Preflight

`preflightE10_1()` (solo lectura; no imprime emails): columnas, catálogo, `UsuariosEventos`, `mapa` (todo activo con `mapa = SI`), administradores (≥ 1 efectivo, ningún EXTERNO con `usuarios_admin`), flags (se informan; en E10-1 deben estar apagados → advertencia si no), `tipo`, consistencia (emails, estados, `version ≥ 1`, `actualizado_*`, valores de permisos), último administrador y techo EXTERNO (**se ejercitan las reglas reales con datos sintéticos**), modo de `email_verified` y gates de telemetría (idem). Un solo administrador efectivo da advertencia, no rojo.

## 13. Orden de despliegue y rollback (todo pendiente de autorización)

1. Copia de la hoja `Usuarios`; cargar `E10_MIGRACION_PARAMETROS`; `setupUsuariosEventosSheet()`.
2. `migracionE10Planificar()` → revisar → `migracionE10Ejecutar()` → `preflightE10_1()` en verde.
3. **Hoja migrada primero**, luego backend (`gas:push` a `@HEAD` → versión → deploy al deployment productivo existente), luego frontend. Si el backend con el gate de `mapa` saliera antes de la migración, los internos perderían el mapa; si el frontend nuevo saliera antes que el backend, «Cerca mío» desaparecería.
4. `EMAIL_VERIFIED_MODO` ausente (OBSERVAR) → observar una semana → `EXIGIR`.

Rollback: el backend v48 ignora las columnas nuevas y no conoce los gates (volver a v48 revierte todo); `migracionE10Revertir()` quita las columnas; el respaldo es la hoja de copia; los flags se apagan sin deploy y `EMAIL_VERIFIED_MODO` vuelve a `OBSERVAR` sin deploy.

## 14. Pendiente / decisiones abiertas

- (Resuelto) `E10_GESTION_EXTERNOS_ACTIVO` gobierna solo la gestión administrativa de externos, no el login (§2).
- Endpoints `admin*` y pantalla: E10-2. Primer externo piloto: E10-3. Política funcional de datos externos: E10-4. Límites de tasa: E10-5.
- `acceso_hasta`: reservado para E10-3.
- La revisión de una muestra real de ITF antes de E10-3 sigue pendiente (método en el documento de auditoría §12).
- `tokeninfo` no es apto para producción según Google (puede limitarse): contención en E10-5.
- `js/seleccionLogic.test.js` (prueba de rendimiento «polígono de 100 vértices … tiempo»): **flaky preexistente y ajeno a E10**. Falló una vez bajo carga durante la suite completa; aislada y en las corridas completas posteriores pasa. No se tocó el código ni el umbral; si vuelve a fallar bajo carga, repetirla aislada antes de atribuirla a un cambio.

## 15. Incidente del primer deploy (v49) y diagnóstico de la búsqueda

El 2026-11-05 se desplegó el backend E10-1 como **v49** en el deployment productivo y el smoke funcional falló: con el frontend publicado (pre-E10) la búsqueda de un pozo quedaba en «Buscando pozo…». Se volvió a **v48** (la app volvió a funcionar con la hoja `Usuarios` ya migrada: la migración no es la causa; la regresión está en el código de v49). Producción permanece en v48 durante la investigación; `@HEAD` conserva E10-1.

- El frontend pre-E10 dispara en paralelo `getItfAvailability`, `getWellRecord`, `getWellLocation` y `getMonitoringPoint` y luego `registerWellSearch` sin esperarlo. El spinner solo puede quedar fijo si una de esas cuatro lecturas queda pendiente.
- Esos cuatro handlers no cambiaron en E10-1; cambió lo que comparten: la resolución de acceso (`getUserAccess`: cache v2, tombstone, `getUserStatus`, catálogo, `usuariosDominio_accesoEfectivo`). `BusquedaFrontendPreE10.test.js` (módulos reales, hojas en memoria) **no** reproduce el problema, así que no es evidencia suficiente.
- `diagnosticoBusquedaE10_ejecutar()` (`backend/src/DiagnosticoBusquedaE10.js`) mide esas etapas en el runtime real de Apps Script, sin escribir nada. Ver el encabezado del archivo.

### Causa raíz y arreglo (local; sin desplegar)

Reproducida con el frontend publicado + un deployment temporal de v49 + 4 requests concurrentes: `getItfAvailability` tardó **128 s** mientras las otras tres lecturas terminaban en ~5 s. Con el índice de disponibilidad vencido (TTL 1 h), `itfAvailabilityService_asegurarIndice` / `itfLegacy_asegurarIndice` reconstruían **todo** el índice recorriendo la carpeta THUMB de Drive. El código es idéntico en v48 (explica las ejecuciones de v48 de 31–160 s): **no es una regresión de E10-1**.

Arreglo (contrato público sin cambios; el frontend no se toca):
- **1 pozo → lookup directo** por nombre (`itfLegacy_disponibilidadDirecta`, `itfAvailabilityService_disponibilidadDirecta`): sin índice, sin recorrer THUMB, igual con el cache vacío o vencido. **Lote (2 o más pozos distintos) → índice** (selección / exportación).
- **Un solo reconstructor** (`ItfIndiceReconstruccion.js`): el ScriptLock se toma solo para *reclamar* (revalida el índice, mira la bandera y la pone; milisegundos) y se suelta **antes** del recorrido pesado; la bandera dura 300 s (antes 60 s, vencía a mitad de la reconstrucción); los que esperan no recorren la carpeta: si agotan los sondeos fallan con `SERVICE_UNAVAILABLE` (reintentable).
- El TTL de los índices no cambia (1 h).
- Guarda arquitectónica (`ItfDisponibilidadIndividual.test.js`): el grafo de llamadas del código real impide que la consulta individual alcance el recorrido de THUMB.
- Evidencia directa de que la consulta individual no usa el índice: `diagnosticoDisponibilidadItfE10()` (`backend/src/DiagnosticoDisponibilidadItfE10.js`, manual, sin parámetros) llama al handler real con 1 pozo y cuenta (cache y lock observados con envoltorios que delegan; recorrido de THUMB bloqueado y contado) los accesos a `itf_leg_v2_*` / `itf_idx_*`, los recorridos de THUMB y los `ScriptLock`: todos deben dar 0, con el índice frío o caliente.
- Crash del reconstructor: la bandera (300 s) vence sola y otra ejecución reconstruye; mientras vive, nadie más recorre THUMB; el ScriptLock se libera siempre antes del recorrido, así que no puede quedar un lock huérfano.
