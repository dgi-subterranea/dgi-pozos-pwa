# E10-2: Administración → Usuarios (implementación local; NO desplegada)

Estado: **implementada y probada en local el 10/11/2026. Sin `gas push`, sin versión, sin deploy, sin `git push`, sin tocar Script Properties, sin encender flags, sin crear ni editar usuarios reales.** Producción sigue en backend v51 / storage v6, con `E10_ADMIN_USUARIOS_ACTIVO` y `E10_GESTION_EXTERNOS_ACTIVO` **APAGADOS**. Base: [e10-1-seguridad-usuarios.md](e10-1-seguridad-usuarios.md) (infraestructura reutilizada sin rediseño). Contexto: [e10-acceso-externo-y-administracion-usuarios.md](e10-acceso-externo-y-administracion-usuarios.md).

Alcance: una sección **Administración → Usuarios** dentro de la app para que un administrador autorizado **liste, busque, filtre, vea el detalle, cree, edite, cambie permisos, desactive y reactive** usuarios. **No** define qué puede usar un EXTERNO (E10-3 / E10-4), **no** cambia el email de un usuario, **no** borra filas.

## 1. Principios

- **La autoridad real son los permisos.** `tipo` (INTERNO / EXTERNO) es descriptivo/político: no concede ni quita ningún permiso, no hay roles redundantes (admin, editor, supervisor, técnico) y nada se infiere del tipo. Única restricción dura: **un EXTERNO nunca tiene `usuarios_admin`** (el catálogo marca `aplicableExterno = false`; lo exige el backend).
- **El backend manda.** Ocultar la UI no es defensa: cada endpoint exige sesión + usuario activo + INTERNO + `usuarios_admin = SI` + `E10_ADMIN_USUARIOS_ACTIVO = SI` (fail-closed) y los servicios lo vuelven a comprobar contra la hoja **fresca**, bajo lock, sin cache.
- **El actor sale siempre de la sesión y de la hoja**, nunca del pedido. Ningún campo del cuerpo puede ser un actor ni un ejecutor (no están en la lista blanca).
- **El frontend no mantiene una segunda lista de permisos**: los pide al backend (`adminPermisosCatalogo`) y usa `dependeDe`, `critico`, `aplicableInterno/Externo`. El backend siempre valida; el frontend solo ayuda a no armar estados inválidos.
- **Los flags son Script Properties del PROYECTO `dgi-pozos-backend`, no de un deployment.** No existe un flag aislado por deployment: `E10_ADMIN_USUARIOS_ACTIVO` y `E10_GESTION_EXTERNOS_ACTIVO` se leen en cada pedido (`E10Flags.js`, sin cache) y cambiarlos afecta **a la vez** a `@HEAD`, a las versiones numeradas y a producción. Lo único que separa a `@HEAD` de producción es **qué código** corre cada uno: mientras producción siga en v51 (sin los siete endpoints `admin*`; responde acción desconocida) y el frontend publicado en Pages no tenga la pantalla de Administración, encender temporalmente el flag para probar `@HEAD` **no abre nada en producción**. El día que una versión con estos endpoints se promueva a producción, el flag **ya estará** donde esté la property: ese paso exige apagar el flag antes y encenderlo después, con autorización expresa.
- `E10_GESTION_EXTERNOS_ACTIVO` gobierna **únicamente** crear un EXTERNO, convertir INTERNO → EXTERNO y reactivar un EXTERNO. **No** gobierna el login ni los permisos de los externos existentes (María Soledad Gualde y Sebastián Dietrich conservan los suyos).

## 2. Arquitectura

```
Frontend                                   Backend (Apps Script)
─────────────────────────                  ─────────────────────────────────────────────
index.html  screen-usuarios-admin          Api.js  doPost  → 7 rutas adminUsuario*/adminPermisosCatalogo
js/usuariosAdminLogic.js  (puro, ES5)      UsuariosAdminApi.js   puerta + flag + lista blanca + tipos
js/usuariosAdmin.js       (DOM, textContent)  ├─ UsuariosAdminLectura.js   listar / obtener / catálogo (solo lectura)
js/api.js                 7 wrappers          └─ UsuariosAdminService.js   crear / actualizar / cambiarEstado (E10-1)
js/app.js                 tarjeta + wiring        ├─ UsuariosDominio.js     reglas puras, eventos
                                                  ├─ SheetUserRepository.js hoja Usuarios
                                                  ├─ UsuariosEventosRepository.js  auditoría append-only
                                                  └─ AuthService.js          cache v2 + tombstone (invalidación)
```

### Cambios sobre la infraestructura de E10-1 (auditados; sin rediseño)

Auditoría de `UsuariosAdminService` frente a la especificación de E10-2. Se mantuvo todo lo demás (lock, versión + etag, idempotencia, rollback, techo EXTERNO, último administrador, invalidación de cache).

| # | Defecto / diferencia | Cambio |
|---|---|---|
| 1 | El motivo era siempre opcional | **`MOTIVO_REQUERIDO`** para desactivar, reactivar, quitar `usuarios_admin` y cambiar INTERNO ↔ EXTERNO (`usuariosAdmin_exigeMotivo`). Se exige **después** de las reglas duras (último admin, EXTERNO + admin) para que el error más fundamental salga primero. |
| 2 | Desactivar a un inactivo / reactivar a un activo respondía `sinCambios` | **`USUARIO_YA_INACTIVO` / `USUARIO_YA_ACTIVO`** (error explícito, no escribe nada). |
| 3 | Reactivar no revalidaba dependencias | Reactivar **revalida la consistencia completa** (`cambiaPermisos: true`): un usuario dado de baja con permisos inconsistentes escritos a mano no se reactiva. |
| 4 | Vocabulario de eventos: `USUARIO_EDITADO` + `PERMISOS_MODIFICADOS` (dos eventos por edición) | Un solo **`USUARIO_ACTUALIZADO`** por mutación (nombre, tipo y/o permisos) con el estado completo antes/después. Eventos: `USUARIO_CREADO`, `USUARIO_ACTUALIZADO`, `USUARIO_DESACTIVADO`, `USUARIO_REACTIVADO` (+ `USUARIO_MIGRADO` / `USUARIO_MIGRACION_REVERTIDA`). Los nombres viejos nunca se escribieron en producción (la única auditoría real es `USUARIO_MIGRADO`). |
| 5 | La vista y la lectura de la hoja no traían `actualizado_utc` / `actualizado_por` | `sheetUserRepository_leerUsuarios` los lee (una fecha que Sheets convirtió en `Date` sale como ISO-8601 UTC); la vista suma `cantidadPermisos`, `esAdmin`, `actualizadoUtc`, `actualizadoPor`. |

## 3. Endpoints

Siete acciones POST (mismo `doPost`, mismo formato `{status, code, message, data}`). **No existe ningún endpoint genérico de escritura de filas.**

| Acción | Cuerpo (lista blanca estricta) | Respuesta `data` |
|---|---|---|
| `adminUsuariosListar` | — | `{usuarios[], total, activos, administradoresEfectivos}` (todos, sin paginar, ordenados por nombre) |
| `adminPermisosCatalogo` | — | `{permisos[{id,nombre,descripcion,modulo,categoria,aplicableInterno,aplicableExterno,dependeDe,critico,orden}], categorias, tipos}` |
| `adminUsuarioObtener` | `email`, `limiteEventos?` | `{usuario, eventos[], eventosDisponibles, hayMasEventos, limiteEventos}` (20 por defecto, tope 100) |
| `adminUsuarioCrear` | `email`, `nombre`, `tipo`, `permisos[]`, `clientRequestId`, `motivo?` | `{usuario, eventos, advertencias}` |
| `adminUsuarioActualizar` | `email`, `versionEsperada`, `etag`, `clientRequestId`, al menos uno de `nombre` / `tipo` / `permisos`, `motivo?` | `{usuario, eventos, advertencias}` |
| `adminUsuarioDesactivar` | `email`, `versionEsperada`, `etag`, `motivo`, `clientRequestId` | idem |
| `adminUsuarioReactivar` | `email`, `versionEsperada`, `etag`, `motivo`, `clientRequestId` | idem |

`usuario` = `{email, nombre, tipo, estado, version, etag, permisos[ids], cantidadPermisos, esAdmin, actualizadoUtc, actualizadoPor}`. Respuestas repetidas por idempotencia llevan `duplicada: true`.

### Orden de chequeos (cada endpoint)

1. Sesión válida y usuario activo → `UNAUTHORIZED` / `USER_DISABLED`.
2. Administrador (activo + INTERNO + `usuarios_admin`, acceso efectivo) → `PERMISSION_DENIED`, **sin revelar el estado del flag** a quien no es administrador.
3. Flag `E10_ADMIN_USUARIOS_ACTIVO` exacto `SI` → `E10_ADMIN_INACTIVO` (antes de leer el cuerpo y de abrir ninguna hoja).
4. Lista blanca de campos, obligatorios y tipos → `INVALID_REQUEST` (cualquier campo no listado se rechaza: un actor falsificado, `ejecutadoPor`, `nuevoEmail`, `estado`, `version`, `fila`, `usuarios_admin`…).
5. El servicio revalida flag y actor contra la hoja **fresca** bajo el script lock y aplica las reglas del dominio.

### Códigos de error (todos con mensaje propio en la pantalla)

`E10_ADMIN_INACTIVO`, `E10_GESTION_EXTERNOS_INACTIVA`, `PERMISSION_DENIED`, `CONFLICT_VERSION` (con `actual`), `ULTIMO_ADMIN`, `USUARIO_EXISTE`, `EMAIL_INVALIDO`, `NOMBRE_INVALIDO`, `TIPO_INVALIDO`, `PERMISO_DESCONOCIDO`, `PERMISOS_INCONSISTENTES`, `TIPO_NO_PERMITE_PERMISO`, `USUARIO_NO_ENCONTRADO`, `USUARIO_YA_INACTIVO`, `USUARIO_YA_ACTIVO`, `MOTIVO_REQUERIDO`, `EMAIL_DUPLICADO_EN_HOJA`, `AUDITORIA_NO_DISPONIBLE`, `SERVICE_UNAVAILABLE`, `INVALID_REQUEST`, `UNAUTHORIZED`, `USER_DISABLED`.

## 4. Seguridad

- **Gate fail-closed en dos capas**: filtro rápido por el acceso cacheado + comprobación fresca bajo lock en el servicio. Un administrador degradado a mano en la hoja (con su acceso todavía cacheado) es rechazado por la comprobación fresca.
- **Un EXTERNO con `usuarios_admin = SI` escrito a mano no es administrador** (el acceso efectivo lo ignora).
- **Lista blanca + tipos**: nada de campos desconocidos; `permisos` es una lista de ≤ 100 textos; `versionEsperada` entero ≥ 0.
- **Historial**: una fila por pedido con la acción y el resultado (`OK` o el código), **sin el email del usuario objetivo ni datos del cuerpo**.
- **Sin secretos**: no hay contraseñas (la autenticación sigue siendo Google), ni tokens en eventos ni en el Historial.
- **Frontend**: todo texto de datos por `textContent` (el DOM falso de los tests lanza ante `innerHTML`); nada en `localStorage`; el email de un usuario existente es de solo lectura.

## 5. Comportamiento INTERNO / EXTERNO

| Operación | INTERNO | EXTERNO |
|---|---|---|
| Crear | permitido | requiere `E10_GESTION_EXTERNOS_ACTIVO = SI` |
| Permisos | los que el catálogo permita | los mismos **salvo** los `aplicableExterno = false` (hoy solo `usuarios_admin`) |
| INTERNO → EXTERNO | requiere flag de externos + motivo; no puede terminar con `usuarios_admin`; conserva sus demás permisos | — |
| EXTERNO → INTERNO | permitido, con motivo; conserva sus permisos | — |
| Desactivar | permitido (motivo) | permitido sin el flag (el flag gobierna solo las altas nuevas) |
| Reactivar | permitido (motivo) | requiere flag de externos (+ motivo) |
| Login / permisos existentes | sin cambios | **sin cambios**, con el flag apagado o encendido |

## 6. Auditoría

Toda mutación genera su evento en `UsuariosEventos` (append-only, una sola escritura): `USUARIO_CREADO`, `USUARIO_ACTUALIZADO`, `USUARIO_DESACTIVADO`, `USUARIO_REACTIVADO`, con usuario y nombre objetivo, `ejecutadoPor` (**de la sesión**), `timestampUtc`, tipo / estado / versión anterior y nueva, permisos antes y después, `motivo`, `clientRequestId` y `origen = APP`. Si la auditoría no se puede escribir, **Usuarios se revierte** (`AUDITORIA_NO_DISPONIBLE`, `revertido: true`); sin la hoja `UsuariosEventos` no se hace ningún cambio. El detalle muestra los eventos recientes (más nuevo primero; `limiteEventos` para ampliar; el DTO nunca lleva `clientRequestId`).

## 7. Versionado y concurrencia

`version` + `etag` + `versionEsperada` (optimista, ya implementado en E10-1). Si otro administrador cambió el usuario: `CONFLICT_VERSION` con el estado actual, **sin sobrescribir**; la pantalla explica que no se guardó nada, recarga el usuario y avisa. Todo bajo `ScriptLock` con datos frescos (también el conteo de administradores: nunca se confía en conteos del frontend).

## 8. Idempotencia

`clientRequestId` obligatorio en toda mutación (UUID con prefijo `adm-`). **Uno por intención**: el reintento del mismo pedido (error de red) lo reutiliza y el backend responde `duplicada: true` sin duplicar el cambio ni el evento; un cambio distinto usa otro id.

## 9. Cache

Toda mutación invalida de inmediato `user_access_v2_<email>` y deja un **tombstone** de 15 s (`user_access_inv_<email>`) contra el recache obsoleto (infraestructura de E10-1). El efecto es en la **siguiente request** del usuario afectado: no hay 5 minutos de permisos viejos.

## 10. Interfaz

- Tarjeta **Administración · Usuarios y permisos** en el hub, visible **solo** con `usuarios_admin === true` (`usuariosAdminLogic_puedeVer`); no carga nada: los datos se piden al abrir la pantalla.
- Estados: cargando, error con «Reintentar», **«Administración temporalmente deshabilitada»** (flag apagado: no se muestra ningún formulario, listado ni «Nuevo usuario»; «Volver a comprobar»), «Sin acceso».
- Listado completo en tarjetas (nombre, email, activo/inactivo, interno/externo, cantidad de permisos, indicador **Admin**, última actualización) con búsqueda (nombre/email, sin tildes ni mayúsculas) y filtros activo/inactivo, interno/externo y administrador/no administrador, todos **locales** y sin paginación (probado con 300 y 5000 usuarios). Las acciones sensibles no están en las filas.
- Detalle / editor: email de solo lectura, nombre, tipo, estado, versión, última actualización, permisos **agrupados por módulo** con nombre, descripción, dependencia («Requiere: …»), marca **Crítico** (p. ej. `usuarios_admin`) y nota de no aplicable (EXTERNO); actividad reciente con «Ver más».
- **Dependencias sin cascadas invisibles**: activar con el requerido apagado **ofrece** activar también el requerido; quitar un padre **advierte** qué permisos quedan afectados y exige una decisión explícita (cancelar no cambia nada; mientras se decide, la casilla refleja el estado real).
- **Confirmaciones concretas** (nunca «¿Está seguro?») para desactivar, reactivar, cambiar de tipo y conceder / quitar `usuarios_admin`, con motivo obligatorio donde corresponde.
- **Responsive**: ≥ 900 px listado a la izquierda y detalle a la derecha (la pantalla se ensancha hasta 1160 px, como Buscar reemplazo y la línea de tiempo); en el celular una cosa por vez (tarjetas, «Volver al listado», diálogos como hoja inferior), sin tabla horizontal, objetivos táctiles de 44 px. Cambios sin guardar piden una decisión antes de abrir otro usuario o volver.

## 11. Archivos

Nuevos: `backend/src/UsuariosAdminApi.js`, `backend/src/UsuariosAdminLectura.js`, `backend/src/DiagnosticoAdminFlagOnE10.js` (manual, solo lectura, con guarda explícita contra escrituras: `diagnosticoAdminFlagOnE10`) con su test `backend/test/DiagnosticoAdminFlagOnE10.test.js`, `backend/src/DiagnosticoPermisosE10.js` (manual, solo lectura: `diagnosticoPermisosE10` y `diagnosticoGatesAdminE10`) con su test `backend/test/DiagnosticoPermisosE10.test.js`, `js/usuariosAdminLogic.js`, `js/usuariosAdmin.js`, tests `backend/test/UsuariosAdminApi.test.js`, `js/usuariosAdminLogic.test.js`, `js/usuariosAdminController.test.js`, `js/usuariosAdminWiring.test.js`, este documento.
Modificados: `backend/src/Api.js` (7 rutas), `UsuariosAdminService.js`, `UsuariosDominio.js`, `UsuariosEventosRepository.js`, `SheetUserRepository.js` (+ exporta `sheetUserRepository_celda`), `AuthService.js` (solo exporta `authService_claveCache` para los tests), `js/api.js`, `js/app.js`, `index.html`, `css/styles.css`, `sw.js` (shell), tests `UsuariosAdminService`, `UsuariosDominio`, `UsuariosEventosRepository`, `e10Frontend` (E10-2 usa el catálogo **por el endpoint**) y `fotosModeracionWiring` (acota su guarda a su bloque).

## 12. Tests y mutaciones

**Jest completo: 206 suites** (nuevos de E10-2: `UsuariosAdminApi` 151, `DiagnosticoPermisosE10` 27, `DiagnosticoAdminFlagOnE10` 27, `usuariosAdminLogic` 61, `usuariosAdminController` 64, `usuariosAdminWiring` 30; suites existentes ajustadas al contrato nuevo). `js/seleccionLogic.test.js` (rendimiento) es el flaky preexistente ya documentado: puede fallar bajo carga y pasa aislado. `git diff --check` sin errores.

**Mutaciones (61 mutantes sobre las reglas críticas): 58 muertos y 3 equivalentes documentados.** Gate de la puerta (administrador, flag, lista blanca, obligatorios, tipos, acción invertida, «algo para cambiar», `clientRequestId` / `versionEsperada` / `etag` obligatorios), lecturas (flag, administrador fresco, eventos de otros usuarios, orden, tope, `clientRequestId` expuesto, email duplicado, catálogo copiado), servicio (motivo obligatorio ×3, ya activo / inactivo, reactivar revalida, orden de reglas), eventos, lógica (visibilidad, filtros, dependencias sin cascada silenciosa, motivo, mensajes, layout, techo EXTERNO, recarga tras conflicto) y controlador (email inmutable, `clientRequestId` por intención, motivo, ofertas de dependencia, doble envío, respuesta vieja, descarte, tarjeta del hub, cierre de sesión, estado deshabilitado, sin actor).

**Los 3 equivalentes, uno por uno** (en los tres el estado final, las hojas y la respuesta son idénticos con y sin el mutante; la segunda capa rechaza exactamente el mismo caso):

| Mutante | Por qué no cambia nada observable |
|---|---|
| **B01** la puerta (`usuariosAdminApi_puerta`) no exige `access.tipo === 'INTERNO'` | `access` sale de `usuariosDominio_accesoEfectivo`, que construye `permisos` con `usuariosDominio_permisosEfectivos`: un permiso no aplicable a EXTERNO (`usuarios_admin`) vale `false` salvo que el tipo sea exactamente `INTERNO`. Para un EXTERNO (o un tipo vacío/inválido) `access.permisos.usuarios_admin` ya es `false`, así que la condición restante lo rechaza con el mismo `PERMISSION_DENIED`. El cache guarda el objeto ya efectivo, no el crudo. Si se rompiera `permisosEfectivos`, lo detectan los tests de `UsuariosDominio` y el test «EXTERNO manipulado» de la puerta. |
| **B03** la puerta no exige `access.active === true` | `usuariosDominio_accesoEfectivo` devuelve `permisos = permisosCatalogo_vacios()` para todo usuario no activo, y antes `validateSession` ya responde `USER_DISABLED` a un inactivo. `usuarios_admin` es `false` para un inactivo con o sin el chequeo: mismo `PERMISSION_DENIED` / `USER_DISABLED`. |
| **B13** `nuevoEmail` agregado a los campos de `adminUsuarioActualizar` | Pasa la lista blanca, pero `usuariosAdminApi_tipoValido` es *default-deny* (`default: return false`): un campo sin tipo definido se rechaza con `INVALID_REQUEST` (cambia solo el texto del mensaje). Nada llega a `operar`, que además solo recibe los campos declarados. El email no puede cambiarse por ninguna vía. |

**B10 (`el actor sale del cuerpo si viene emailActor`) NO se dejó como equivalente.** El pedido se rechaza igual (la lista blanca devuelve `INVALID_REQUEST` y con el flag apagado se corta antes de validar), pero el mutante cambiaba a quién se atribuye la **fila de Historial** del pedido rechazado (el email falso en vez del de la sesión). Eso es observable y es una propiedad de seguridad (nadie puede dejar un rastro a nombre de otra persona), así que se agregó un test real (`un actor FALSIFICADO en el cuerpo no atribuye el Historial a otra persona`) que lo mata. No se crearon tests artificiales para los otros tres. Cobertura: gate (admin, no admin, inactivo, EXTERNO manipulado, flag OFF, request directa, sin sesión), lectura (listado, detalle, eventos, catálogo), crear / editar / administradores / desactivar / reactivar, auditoría (contenido, motivo, actor real, rollback), cache (invalidación y tombstone), idempotencia, lista blanca (campos extra, actor falsificado, intento de cambiar el email, permisos desconocidos) y frontend (navegación, tarjeta oculta a no administradores, estado deshabilitado, listado, filtros, editor, dependencias, errores, layout).

## 13. Decisiones y riesgos pendientes

- **El flag de administración se enciende a mano** (Script Properties) y **no** durante el desarrollo; hasta entonces la pantalla muestra «Administración temporalmente deshabilitada» a los administradores.
- Un administrador con el acceso cacheado puede ver la pantalla de estado «deshabilitada» antes de que expire el cache tras un cambio manual en la hoja; la **defensa real** (comprobación fresca bajo lock) no depende de ese cache.
- `E10_GESTION_EXTERNOS_ACTIVO` sigue apagado: crear externos, convertir un usuario a externo y reactivar un externo quedan cerrados hasta decisión expresa (E10-3 / E10-4 definen qué puede ver un externo).
- El cambio de email se diseñará aparte (participa de identidad, sesión, auditoría y cache).
- Un usuario creado con un email que no existe en Google queda en la hoja pero no puede iniciar sesión; no se verifica contra Google.
- Listado sin paginar: pensado para decenas o pocos cientos de usuarios (la hoja se lee entera por pedido; ya es así para el login).

## 14. Cómo validar después en `@HEAD` (sin tocar producción)

Recordatorio: **los flags son del proyecto, no del deployment** (ver §1). Producción (v51) no tiene estos endpoints, así que un encendido TEMPORAL del flag de administración, mientras producción siga en v51 y Pages no tenga la pantalla, solo abre `@HEAD`. Aun así se enciende **solo con autorización expresa**, el menor tiempo posible, y se apaga al terminar.

Orden **exacto**:

1. `npm run gas:diff:main` → revisar → `npm run gas:push:main -- --confirmar-huella <huella>` (solo `@HEAD`). Verificar repo = `@HEAD`, producción v51, storage v6, `origin/main` sin cambios.
2. **Flags apagados** (los dos). Desde el editor de `@HEAD`, correr `diagnosticoGatesAdminE10()`: pega por `doPost` a los siete endpoints con la sesión de un administrador (→ `E10_ADMIN_INACTIVO`), de un usuario normal y de un EXTERNO (→ `PERMISSION_DENIED`) y de un token inválido (→ `UNAUTHORIZED`); se niega a correr si el flag está encendido y no escribe nada. Correr también `diagnosticoPermisosE10()` (matriz de coherencia de permisos, solo lectura).
3. UI local (sin publicar Pages) apuntando a `@HEAD` con el flag apagado: el administrador ve la tarjeta «Administración» y el cartel «Administración temporalmente deshabilitada»; un no administrador no ve la tarjeta.
4. **Primera prueba real (Ruta A, sin escrituras)** — con autorización específica y de forma TEMPORAL, a mano en Apps Script: `dgi-pozos-backend` → Project Settings → Script Properties → `E10_ADMIN_USUARIOS_ACTIVO = SI` (anotar el valor anterior; `E10_GESTION_EXTERNOS_ACTIVO` NO se toca). Después correr `diagnosticoAdminFlagOnE10` (archivo `DiagnosticoAdminFlagOnE10.js`). Se niega a correr si el flag de administración no es `SI` o si el de externos es `SI`. Comprueba, con **cero escrituras reales**: listado (11 / 11 / 9 INTERNO / 2 EXTERNO / 2 administradores), catálogo (17 permisos, ids únicos, metadata completa, orden estable, `usuarios_admin` no aplicable a EXTERNO), detalle (cada administrador, un INTERNO no administrador y un EXTERNO: versión, etag, permisos, eventos), gates con el flag ON (administrador permitido; INTERNO no administrador y EXTERNO `PERMISSION_DENIED`; token inválido `UNAUTHORIZED`) y, con la gestión de externos apagada, que crear EXTERNO, convertir INTERNO → EXTERNO y reactivar EXTERNO (sintético en memoria) responden `E10_GESTION_EXTERNOS_INACTIVA`.
   La **guarda sin escrituras**: mientras corre, todas las funciones que escriben en `Usuarios` / `UsuariosEventos` (`sheetUserRepository_escribirFila`, `_agregarFila`, `_restaurarFila`, `_quitarUltimaFilaSiEs`, `_agregarColumnas`, `_escribirCeldas`, `_quitarColumnas`, `_crearRespaldo`, `usuariosEventosRepository_agregar`, `setupUsuariosEventosSheet` y `authService_invalidarAcceso`) se reemplazan por funciones que lanzan y cuentan el intento; se verifica que quedó instalada y que bloquea **antes** de llamar a ningún endpoint; se restauran siempre; y se compara una huella de ambas hojas antes y después. Un test estático exige que toda función de los repositorios que escribe una hoja esté en esa lista. **No** se apaga el flag solo: se apaga a mano al terminar, o se sigue con la Ruta B (versión numerada + deployment temporal + frontend local real + usuario de prueba `e10-2-prueba@example.com`, aprobada para esa fase y todavía no creada).
5. Verificar en `UsuariosEventos` los eventos (`ejecutadoPor` = el administrador real).
6. Solo después, y con autorización expresa: versión nueva, deploy productivo, `git push` y activación del flag.
