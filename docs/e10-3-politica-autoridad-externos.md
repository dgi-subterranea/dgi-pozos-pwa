# E10-3: política de autoridad para el usuario EXTERNO autenticado

Estado: **implementada y probada en local (19/11/2026). Sin `gas push`, sin versión, sin deploy, sin `git push`, sin Pages, sin tocar Script Properties, sin tocar usuarios ni a Gualde y Dietrich.** Producción sigue en backend v53 / storage v6, con `E10_ADMIN_USUARIOS_ACTIVO = SI`, `E10_GESTION_EXTERNOS_ACTIVO` **ausente** y `EMAIL_VERIFIED_MODO = OBSERVAR`.

Análisis previo: [e10-3-politica-usuarios-externos-auditoria.md](e10-3-politica-usuarios-externos-auditoria.md) (matriz funcional, riesgos, alternativas A/B/C). Capa pública futura: [e10-publico-anonimo-diseno.md](e10-publico-anonimo-diseno.md).

## 1. La política (Modelo C — híbrido)

> Un usuario **EXTERNO** autenticado puede **consultar, proponer y cargar** información según sus permisos, pero **no puede validar, moderar, anular contenido ajeno ni administrar usuarios**.

Reservados a INTERNO (`aplicableExterno = false` en `PermisosCatalogo.js`):

| Permiso | Qué sería ejercerlo |
|---|---|
| `perfil_validar` | aprobar, rechazar, retirar y revertir ITF |
| `ubicacion_validar` | validar, rechazar y revertir correcciones; decidir fuentes; resolver sugerencias (y, junto con `ubicacion_corregir`, la auto-validación) |
| `fotos_moderar` | retirar, reponer y resolver pedidos de retiro de fotos |
| `observaciones_anular` | anular observaciones de cualquiera y leer el texto de las anuladas |
| `usuarios_admin` | administrar usuarios (ya reservado desde E10-1) |

**No se reservan** (siguen siendo decisiones sobre el externo autenticado, para E10-4): `datos`, `observaciones`, `observaciones_agregar`, `fotos`, `fotos_carga`, `reemplazo`, `perfil`, `perfil_subir`, `ubicacion`, `ubicacion_corregir`, `mapa`, `ne`.

La regla coincide con la `categoria` del catálogo: los cinco son `moderacion` o `administracion`. Está protegida por un **invariante de test** («todo permiso de moderación o administración tiene `aplicableExterno = false` y ninguno de lectura o escritura lo tiene») y por un ítem del preflight (`politica_autoridad`).

**`tipo` describe únicamente personas autenticadas.** PÚBLICO / ANÓNIMO **no** es un tipo de usuario: no está en `Usuarios`, no tiene sesión ni permisos individuales, no usa `getUserAccess` ni `hasPermission` y no escribe en `Historial`, `UsuariosEventos` ni Telegram. La capa pública (etapa posterior al hardening) tendrá una política pública global y su propia whitelist, y **no se deriva de lo que ve un EXTERNO**.

## 2. Cómo se hace cumplir (el backend es la autoridad)

1. **Permisos efectivos** (`usuariosDominio_permisosEfectivos`, `UsuariosDominio.js`): un permiso no aplicable a EXTERNO solo es efectivo si el tipo es INTERNO (un tipo vacío o inválido también lo anula: fail-closed). Alimenta `getUserAccess` → `login`, `checkSession`, `hasPermission`, `registerWellSearch` y los destinatarios de avisos a validadores (`sheetUserRepository_filtrarConPermisos`). **Ningún handler cambió**: todos deciden por `hasPermission` / `getUserAccess`, que ya devuelven el efectivo, así que ITF, Ubicación (incluida la auto-validación, `Api.js` `ubicacion_validar`), Fotos y Observaciones se cierran por la misma vía. El frontend no necesita saber el `tipo`: recibe permisos efectivos y oculta solo las tarjetas.
2. **Administración** (`usuariosDominio_validarMutacion`, usada por **todas** las operaciones de `UsuariosAdminService`): ningún administrador puede **otorgar** a un EXTERNO un permiso no aplicable, **tampoco a uno activo ya existente** (la brecha de E10-2: el flag `E10_GESTION_EXTERNOS_ACTIVO` solo cubría crear, convertir y reactivar, no editar). Código `TIPO_NO_PERMITE_PERMISO` con `detalle` que lista **todos** los permisos incompatibles; no se escribe nada.

## 3. Cierre de la brecha de E10-2

Con `E10_ADMIN_USUARIOS_ACTIVO = SI`, un administrador podía asignar `perfil_validar` (o los otros) a un externo activo. Ahora se rechaza, con la gestión de externos apagada o encendida; la regla vale para cualquier mutación sobre una fila EXTERNO, y se verifica contra los 4 permisos y `usuarios_admin` (test `CIERRE DE LA BRECHA DE E10-2`).

## 4. Conversiones y reactivación (sin cascada silenciosa)

| Operación | Comportamiento |
|---|---|
| **Crear EXTERNO con autoridad** | `E10_GESTION_EXTERNOS_INACTIVA` si el flag está apagado; con el flag encendido, `TIPO_NO_PERMITE_PERMISO` (el techo vale siempre) |
| **INTERNO → EXTERNO** con permisos de autoridad | **se rechaza** listando **todos**; el backend **no quita nada solo**. El administrador manda la lista sin ellos (la pantalla los deja marcados y bloquea Guardar hasta que los desmarque) y un motivo obligatorio. Requiere el flag de externos |
| **EXTERNO → INTERNO** | no es alta de externo (no usa el flag), exige motivo y **no concede nada**. Si la fila tenía permisos de autoridad **inefectivos**, se rechaza con `CONCESION_AUTOMATICA` (se activarían de golpe): hay que quitarlos y, si corresponde, otorgarlos después en un paso aparte y explícito |
| **Reactivar EXTERNO** con autoridad heredada | se rechaza (`TIPO_NO_PERMITE_PERMISO`) hasta que se quiten (con el flag apagado, primero `E10_GESTION_EXTERNOS_INACTIVA`) |
| **Desactivar** o **renombrar** un EXTERNO con autoridad heredada | permitido: no la otorga, y no se bloquea una baja por un permiso que ya no vale |
| **Quitar** el permiso heredado (también inactivo) | permitido: es limpiar |

## 5. Permisos crudos históricos en una fila EXTERNO

Si una fila EXTERNO tiene en `SI` un permiso reservado (edición manual de la hoja o dato histórico):

- el permiso **efectivo es `false`** y el backend no permite ejercerlo (`hasPermission`, `login`, `checkSession`, avisos);
- la administración devuelve `permisosInefectivos` (listado y detalle) y la pantalla lo muestra como **«Asignado en origen, pero inefectivo»** (etiqueta «Inefectivo», aviso en el editor y «N inefectivos» en la tarjeta);
- **la hoja no se limpia sola**: el administrador lo desmarca explícitamente;
- el preflight (`externos_sin_autoridad`) cuenta esas filas (nunca nombra personas).

Hoy no hay ninguna: Gualde y Dietrich no tienen ningún permiso reservado.

## 6. Interfaz (Administración → Usuarios)

- Etiqueta «Inefectivo», aviso «Asignados en la hoja pero INEFECTIVOS» y cartel «No aplicables a un usuario externo: … Desmarcalos para poder guardar».
- Casilla de un permiso reservado **sin marcar**, deshabilitada para un EXTERNO; **marcada**, habilitada para poder desmarcarla.
- Guardar bloqueado al convertir a EXTERNO con autoridad (o a INTERNO con inefectivos) hasta desmarcar; los heredados no bloquean un renombrado.
- Confirmación al crear o convertir a externo con la política en palabras; al pasar a interno aclara que no otorga permisos.
- Errores `TIPO_NO_PERMITE_PERMISO` y `CONCESION_AUTOMATICA` con los permisos por nombre.

## 7. Modos de acceso (test estático)

`backend/test/ApiModosAcceso.test.js` (+ `accesoEstatico.js`) declara el **modo de acceso** de cada una de las 69 acciones de `doPost`: `sesion` o `publico`. Hoy **todas son `sesion`**. Es análisis estático del grafo de llamadas. Falla si:

- aparece una acción nueva **sin modo declarado** (o sobra una declaración);
- una acción `sesion` no alcanza ninguna compuerta de sesión;
- una acción `publico` alcanza —directa o transitivamente— `getUserAccess`, `hasPermission`, `isUserActive`, `validateSession*`, `validarPermiso*`, `logHistoryEvent`, `verifySessionToken`, repositorios de usuarios / auditoría de usuarios, `usuariosAdmin*` o Telegram.

Además comprueba que ningún servicio de negocio compara `tipo` con `INTERNO` / `EXTERNO`, y que `PUBLICO` no es un `tipo` válido. El analizador se verifica con fuentes sintéticas (llamada directa, transitiva, comentarios y cadenas, expresiones regulares).

## 8. Gualde y Dietrich (antes / después)

Ambos EXTERNO, activos, versión 1, **idénticos**: `perfil`, `perfil_subir`, `datos`, `ubicacion`, `ubicacion_corregir`, `mapa`, `ne`, `fotos`, `fotos_carga`, `observaciones`, `observaciones_agregar` (**11**). **Antes** de E10-3: 11 efectivos. **Después**: **los mismos 11** (ninguno es reservado; `permisosInefectivos` = `[]`; el test de regresión usa sus 11 exactos). No pueden: validar ITF o ubicaciones, moderar fotos, anular observaciones ajenas, reemplazo ni administrar (igual que antes).

## 9. Preflight

`preflightE10_evaluar` suma dos ítems de solo lectura: `politica_autoridad` (el catálogo reserva exactamente la autoridad) y `externos_sin_autoridad` (ninguna fila NO INTERNO con permisos de autoridad en `SI`), más el contador `filasConPermisosInefectivos`. Con el escenario real (2 externos con los permisos de siempre): verde.

## 10. Lo que NO se hizo

- `E10_GESTION_EXTERNOS_ACTIVO` sigue ausente: la lógica queda lista, producción no habilita crear, convertir ni reactivar externos.
- `EMAIL_VERIFIED_MODO` sigue en `OBSERVAR` (pasar a `EXIGIR` queda para E10-5).
- Ninguna capa pública (`/publico`, búsqueda, ficha, QR/NFC, API, índices, whitelist, mapa).
- Ningún cambio de usuarios, permisos reales, flags, versión, deployment ni Pages.

## 11. Hoja de ruta adoptada

- **E10-3** (esta): política de autoridad para el EXTERNO autenticado.
- **E10-4**: decisiones de información (qué ve un EXTERNO y un PÚBLICO/ANÓNIMO: ITF, ubicación, NC16, datos, fotos, observaciones, URL pública, `wellId` u opaco, QR/NFC).
- **E10-5**: hardening (rate limiting, scraping, kill-switch, aislamiento de cuota, `email_verified = EXIGIR`, logging público, vencimiento de externos, protección de endpoints públicos).
- **Etapa posterior — capa pública**: pipeline con whitelist, índice público reducido, `/publico`, búsqueda, ficha, mapa si corresponde, QR/NFC opcional.
- **E10-6**: piloto de gestión real de externos con `E10_GESTION_EXTERNOS_ACTIVO`.

## 12. Riesgos y dudas conocidas

- **Fixtures sin columna `tipo`**: una hoja de Usuarios **sin** columna `tipo` (o con tipo vacío) ya no da efectivos los permisos de autoridad (igual que `usuarios_admin`). La hoja real tiene `tipo` en todas las filas (lo verifica el preflight, ítem `tipo`); los tests que simulaban la hoja sin `tipo` se actualizaron.
- `itfPreflight_cuantosActivosCon` (preflight de E9, `ItfPreflight.js`) cuenta filas crudas y podría contar a un externo con `perfil_validar` en la hoja; es informativo y E9 está cerrado.
- La pantalla muestra los permisos **crudos**; los inefectivos se marcan con la lista que calcula el backend.
- Un cambio manual de la hoja se refleja hasta 5 minutos después por el cache de acceso (TTL 300 s); los cambios de la administración invalidan al instante.
- `datos`, `observaciones`, `fotos`, `reemplazo` siguen disponibles para un externo con el permiso: se deciden en E10-4.

## 13. Archivos

`backend/src/PermisosCatalogo.js`, `UsuariosDominio.js`, `UsuariosAdminService.js`, `E10Preflight.js`; `js/usuariosAdminLogic.js`, `js/usuariosAdmin.js`, `css/styles.css`; tests: `backend/test/E10_3PoliticaExternos.test.js`, `ApiModosAcceso.test.js` (+ `accesoEstatico.js`), ampliaciones en `PermisosCatalogo`, `E10Preflight`, `UsuariosAdminApi`, `DiagnosticoPermisosE10`, `js/usuariosAdminController.test.js` y `js/usuariosAdminLogic.test.js`, y fixtures de avisos con la columna `tipo`.
