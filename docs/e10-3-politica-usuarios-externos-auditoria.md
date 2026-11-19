# E10-3: política funcional de usuarios externos — auditoría previa y alternativas

Estado: **auditoría previa a la implementación (19/11/2026).** La política aprobada y lo implementado están en [e10-3-politica-autoridad-externos.md](e10-3-politica-autoridad-externos.md); este documento conserva el análisis, la matriz funcional y las alternativas A/B/C que lo fundamentan. Lo siguiente se escribió **antes** de implementar: las recomendaciones de §6–§10 ya están adoptadas (Modelo C). Sin cambios de código, permisos, usuarios, flags, versiones ni despliegues. Base auditada: `HEAD` = `53e63f1`, backend v53 en producción. Citas `archivo:línea` sobre el árbol actual.

## 1. Comportamiento actual exacto de `tipo = EXTERNO`

**El backend no consulta `tipo` en ninguna decisión de acceso, salvo en dos lugares, ambos sobre `usuarios_admin`:**

1. `UsuariosDominio.js:44` (`usuariosDominio_permisosEfectivos`): un permiso con `aplicableExterno !== true` solo es efectivo si el tipo es INTERNO. Hoy es únicamente `usuarios_admin` (`PermisosCatalogo.js:36`). Alimenta `getUserAccess` (`AuthService.js:71`) y por lo tanto `login`, `checkSession`, `hasPermission`, `registerWellSearch` y los destinatarios de avisos (`SheetUserRepository.js:123`).
2. `UsuariosAdminApi.js:93` y `UsuariosDominio.js:68`: administrador efectivo = activo + INTERNO + `usuarios_admin`.

Todo lo demás (69 acciones de `doPost`, `Api.js:22-241`) decide por **sesión válida + usuario activo** (`validateSession`, `Api.js:262-274`) y por **permisos** (`validarPermiso` `Api.js:310`, `validarPermisosTodos` `Api.js:1749`, `api_validarPermisosEstrictos` `Api.js:1600`, `hasPermission` `AuthService.js:99`). Un EXTERNO activo con un permiso puede hacer exactamente lo mismo que un INTERNO con ese permiso. `tipo` es descriptivo salvo el techo de `usuarios_admin`.

Otros hechos:

- Un EXTERNO **inactivo** o ausente de la hoja no inicia sesión (`USER_DISABLED`, `AuthService.js:233-237`).
- `login` y `checkSession` devuelven solo `{email, sessionToken, permisos efectivos}` (`AuthService.js:165-173`, `242-251`): **no devuelven `tipo`, `estado` ni "es admin"**. El frontend **no tiene el concepto de `tipo`** (en `js/` el único uso es la pantalla de Administración, que lo recibe de `adminUsuarioObtener`). Todo el frontend se gobierna por `permisosActuales` (`app.js:184`, `1193`, `2199`), que son los **efectivos**.
- `email_verified` está en modo OBSERVAR por defecto (`AuthService.js:220-231`): hoy no se exige para ningún usuario.
- Sin límite de tasa (pendiente E10-5, comentario `Api.js:542`).

## 2. Matriz funcional

INTERNO = INTERNO con ese permiso; EXTERNO HOY = EXTERNO activo con ese permiso. **Para todas las filas salvo la administración, ambas columnas son idénticas** (el tipo no se consulta). «Gualde/Dietrich» indica si hoy tienen el permiso.

| # | Funcionalidad | Permiso necesario | INTERNO | EXTERNO hoy | Backend autoritativo | Frontend | Observaciones | Gualde / Dietrich |
|---|---|---|---|---|---|---|---|---|
| 1 | Iniciar sesión | usuario activo en la hoja | sí | **sí** | `AuthService.js:233-251` | login | `tipo` no se mira; `email_verified` solo se observa (`:220-231`) | sí |
| 2 | Renovar sesión / metadata del padrón | sesión + activo | sí | **sí** | `AuthService.js:149-174`; `Api.js:409-427` | `init()` | sin permiso de módulo | sí |
| 3 | Buscar pozo (telemetría, Telegram, Historial) | al menos uno de perfil/datos/ubicacion/ne; el pozo debe existir | sí | **sí** | `Api.js:567-613` (permiso `:574`) | `buscarPozo` | igual que un interno | sí |
| 4 | Ver ITF vigente, disponibilidad, descargar | `perfil` | sí | **sí** | `Api.js:325`, `:834`, `:902` | `app.js:269` | | sí |
| 5 | Proponer ITF / retirar la propia / ver las propias | `perfil`+`perfil_subir` (+ `ITF_E9_ACTIVO`) | sí | **sí** | `Api.js:949`; `:1066-1067` | `itfLogic.js:15` | queda PROPUESTO hasta validación | sí |
| 6 | Moderar ITF (cola, aprobar, rechazar, retirar, revertir, historial) | `perfil`+`perfil_validar` | sí | **sí, si se le asigna** | `Api.js:1058-1065` | `itfLogic.js:20`, `app.js:1255` | **autoridad DGI**; ve nombres de proponentes, nunca emails | **no** |
| 7 | Ver Datos (ficha, titular, domicilios, resumen, índice por titular/NC16) | `datos` | sí | **sí** | `Api.js:382`, `:688`, `:760`; `MapaService.js:87-115` | `app.js:1397` | el índice devuelve titular+NC16 de toda la provincia en UNA llamada | **sí** |
| 8 | Ver Ubicación, correcciones, decisiones y sugerencias propias | `ubicacion` | sí | **sí** | `Api.js:481`, `:1858`, `:1996`, `:2129` | `app.js:1398` | | sí |
| 9 | Proponer corrección / sugerir fuente / cancelar sugerencia | `ubicacion`+`ubicacion_corregir` | sí | **sí** | `Api.js:1782`, `:2090`, `:2232` | módulo Ubicación | queda PROPUESTA, salvo si el mismo usuario tiene `ubicacion_validar` (`Api.js:1790`: auto-validación) | sí |
| 10 | Validar/rechazar/revertir correcciones, decidir fuentes, resolver sugerencias, ver pendientes | `ubicacion`+`ubicacion_validar` | sí | **sí, si se le asigna** | `Api.js:1878`, `:1899`, `:2021`, `:2156`, `:2182` | `ubicacionPendientes.js` | **autoridad DGI**: modifica la ubicación oficial | **no** |
| 11 | Mapa, Cerca mío, Mi selección (dataset general) | `mapa` | sí | **sí** | `Api.js:635`, `:662`, `:1976` | `mapaLogic.js:224-241` | provincia exige además perfil o ne | sí |
| 12 | Niveles estáticos (red y mediciones) | `ne` | sí | **sí** | `Api.js:446`, `:724` | `app.js:1399` | | sí |
| 13 | Ver fotos | `fotos` | sí | **sí** | `Api.js:1499`, `:1517`, `:1539` | `app.js:403` | | sí |
| 14 | Subir fotos / pedir retiro de las propias | `fotos_carga` (retiro: `fotos`+`fotos_carga`) | sí | **sí** | `Api.js:1565`, `:1669` | fotosPozos | la foto nace `ACTIVA` = visible en el acto (`FotosPozosService.js:608`); moderación posterior | sí |
| 15 | Moderar fotos (retirar, reponer, resolver pedidos, colas) | `fotos`+`fotos_moderar` | sí | **sí, si se le asigna** | `Api.js:1673-1681`, `:1691` | `fotosModeracionLogic` | **autoridad DGI** | **no** |
| 16 | Ver observaciones | `observaciones` | sí | **sí** | `Api.js:2270` | `observacionesPozoLogic.js:30` | texto libre de personal interno; nunca emails | sí |
| 17 | Agregar observaciones | `observaciones`+`observaciones_agregar` | sí | **sí** | `Api.js:2309` | | | sí |
| 18 | Anular observaciones (propias / de cualquiera) | `observaciones` + `agregar` (propias) o `anular` (cualquiera) | sí | **sí** (propias); ajenas solo si se le asigna `anular` | `Api.js:2356-2365` | | `anular` además muestra el texto de las anuladas (`:2260`) | solo las propias |
| 19 | Reemplazo (estado, evaluaciones, fotos, resumen del mapa) | `reemplazo` | sí | **sí** | `Api.js:1267`, `:1291`, `:1317`, `:1359`, `:1388` | `app.js:351` | evaluación técnica interna | **no** |
| 20 | Exportar Mi selección (XLSX) | cliente: columnas según `ubicacion`/`perfil`/`ne`/`reemplazo` | sí | **sí** | **no hay endpoint**: se arma en el navegador con datasets ya gateados (`mapa`, `ne`, disponibilidad ITF) | `exportacionSeleccionLogic.js:24-53` | la exportación nunca incluye `datos` (titular) | sí (según permisos) |
| 21 | Endpoints administrativos (7 `admin*`) | `usuarios_admin` + INTERNO + flag | sí | **no (bloqueado)** | `UsuariosAdminApi.js:93`; `UsuariosDominio.js:44`, `:68`; `UsuariosAdminService.js:169` | `usuariosAdminLogic.js:17` | techo duro por catálogo (`PermisosCatalogo.js:36`) | no |
| 22 | Telegram y logs | cualquier búsqueda / descarga | sí | **sí, igual** | `Api.js:593-610`; `NotificationService.js:14-47` (nombre + email completo); `logHistoryEvent` | — | el mensaje **no distingue** interno de externo | sí |

Dos observaciones de la auditoría que conviene conocer:

- **La administración (E10-2) hoy permite asignar a un EXTERNO existente cualquier permiso aplicable** (incluidos `perfil_validar`, `ubicacion_validar`, `fotos_moderar`, `observaciones_anular`). `E10_GESTION_EXTERNOS_ACTIVO` solo gobierna crear/convertir/reactivar externos (`UsuariosAdminService.js:122-128`, `:191`), **no** editar los permisos de uno activo. Con el flag de administración en `SI`, un administrador puede hoy dar autoridad DGI a Gualde o Dietrich sin que nada lo impida.
- El comentario de `Api.js:654-656` (getUbicacionesValidadas) quedó viejo («CUALQUIER usuario activo, sin permiso de módulo»): el código exige `mapa`. Solo documentación.

## 3. Permisos actuales de María Soledad Gualde y Sebastián Dietrich (lectura, sin modificar)

Obtenidos con `adminUsuarioObtener` desde la sesión de un administrador. Ambos: `tipo = EXTERNO`, `estado = activo`, `version = 1`, **idénticos entre sí**.

- **Declarados = efectivos (11):** `perfil`, `perfil_subir`, `datos`, `ubicacion`, `ubicacion_corregir`, `mapa`, `ne`, `fotos`, `fotos_carga`, `observaciones`, `observaciones_agregar`. (Ninguno es un permiso no aplicable a EXTERNO, así que la regla de efectivos no recorta nada.)
- **Sin permiso (6):** `perfil_validar`, `ubicacion_validar`, `fotos_moderar`, `observaciones_anular`, `reemplazo`, `usuarios_admin`.
- **Pueden hoy:** iniciar sesión, buscar pozos, ver ITF y descargarlo, proponer ITF (queda pendiente), ver la ficha completa y buscar por titular, ver Ubicación y proponer correcciones/sugerencias (quedan pendientes), usar Mapa / Cerca mío / Mi selección y exportar, ver NE, ver fotos y subir fotos (visibles en el acto), ver y agregar observaciones y anular las propias.
- **No pueden hoy:** aprobar/rechazar/retirar/revertir ITF, validar correcciones o decidir fuentes de ubicación, moderar fotos, anular observaciones ajenas ni ver el texto de las anuladas, usar Reemplazo, usar cualquier endpoint de administración.
- Nota: `perfil_subir` solo funciona con `ITF_E9_ACTIVO` encendido; el smoke de producción de `getMisPropuestasItf` respondió `ok`, lo que indica (inferencia, no leí la property) que está encendido.

## 4. Riesgos

**A. Riesgo real actual (sin asignar nada nuevo):**

1. **`datos` para dos externos**: acceso a titular y domicilios de cualquier pozo y, con `getIndiceBusquedaProvincia`, al índice completo de titular + NC16 en una sola llamada (`Api.js:760`, `MapaService.js:87-115`), sin límite de tasa. Es una decisión de política (qué datos ve un externo), no un bug; el catálogo ya lo marca `critico`.
2. **`observaciones` / `fotos`**: un externo lee todas las notas internas y todas las fotos. Política, no bug.
3. **`fotos_carga`**: lo que sube un externo es visible para todos de inmediato (`FotosPozosService.js:608`); la moderación es posterior.
4. **Brecha de E10-2**: un administrador puede dar hoy permisos de moderación a un externo (ver §2).
5. `email_verified` en OBSERVAR: para internos poco importa; para cuentas externas (cualquier cuenta de Google) conviene EXIGIR antes de crear más.

**B. Riesgo hipotético si se asigna un permiso a un EXTERNO:**

- `perfil_validar`: un externo aprueba el ITF oficial de cualquier pozo.
- `ubicacion_validar`: un externo valida/revierte ubicaciones oficiales y decide fuentes; **junto con `ubicacion_corregir` se auto-valida** (`Api.js:1790`) y cambia la ubicación oficial sin segunda mirada.
- `fotos_moderar`: retira/repone fotos de otros.
- `observaciones_anular`: anula observaciones de cualquiera y lee el texto de las anuladas.
- `datos` a más externos: amplía A1.

**C. Ya bloqueado por arquitectura:**

- Ningún EXTERNO puede ejercer `usuarios_admin` (techo en el catálogo + efectivos + puerta de los 7 endpoints + servicio contra la hoja fresca).
- El actor siempre sale de la sesión y de la hoja, nunca del cuerpo.
- Un usuario inactivo/ausente no entra; `tipo` vacío/inválido no tiene `usuarios_admin` efectivo.
- Ningún DTO de moderación trae emails (solo nombres).
- Crear/convertir/reactivar externos está cerrado mientras `E10_GESTION_EXTERNOS_ACTIVO` esté ausente.

## 5. Modelos

El techo por tipo **ya existe como mecanismo** (`aplicableExterno = false` en el catálogo): lo respetan el validador de la administración, los permisos efectivos (login/checkSession/hasPermission), los avisos a validadores y la pantalla (que lo lee del catálogo, sin lista propia). Por eso B y C cuestan casi lo mismo; cambia el **alcance**.

| | **A — Permisos puros** | **B — Restricciones por tipo (amplio)** | **C — Híbrido (autoridad reservada)** |
|---|---|---|---|
| Idea | `tipo` solo descriptivo; los permisos mandan | Muchos permisos prohibidos a EXTERNO (autoridad **y** datos/lectura sensible) | Los permisos mandan, pero la **autoridad DGI** (moderar/validar/administrar) queda reservada a INTERNO |
| Ventajas | Sin trabajo; máxima flexibilidad | Máxima contención | Cierra B sin tocar lo que externos ya hacen; regla simple y explicable: «un externo nunca valida ni administra» |
| Desventajas | Depende 100 % de que ningún admin se equivoque (brecha de §2) | Quita capacidades hoy en uso (p. ej. `datos`); decisiones de negocio todavía no tomadas | No resuelve A1–A3 (política de datos): se decide en E10-4 |
| Complejidad | Nula | Media (más permisos, UI y comunicación) | **Baja**: cambiar `aplicableExterno` en 4 permisos + tests |
| Riesgo | Alto a futuro | Rompe a Gualde/Dietrich si incluye `datos` | Bajo |
| Impacto Gualde/Dietrich | Ninguno | Pierden lo que se reserve (si `datos`, pierden la ficha) | **Ninguno** (no tienen ningún permiso reservado) |
| Impacto administración | Ninguno | UI deshabilita más casillas | UI deshabilita 4 casillas más al elegir EXTERNO (ya lo hace con `usuarios_admin`) |
| Impacto futuro | Habría que parchear al primer incidente | Rígido | Extensible: lo que E10-4 decida sobre datos se agrega con la misma palanca |

## 6. Recomendación

**Modelo C.** Reservar a INTERNO exactamente la autoridad DGI: `perfil_validar`, `ubicacion_validar`, `fotos_moderar`, `observaciones_anular` y el ya reservado `usuarios_admin`. Regla en una frase: **un EXTERNO propone, consulta y carga; nunca valida, modera, anula lo ajeno ni administra.** Coincide con la `categoria` del catálogo (las cinco son `moderacion` o `administracion`), así que se puede **testear como invariante**: «todo permiso de categoría moderación/administración tiene `aplicableExterno = false`».

Análisis por permiso:

| Permiso | ¿Reservar? | Razón |
|---|---|---|
| `perfil_validar` | **Sí** | aprueba el ITF oficial |
| `ubicacion_validar` | **Sí** | cambia la ubicación oficial; con `ubicacion_corregir` se auto-valida |
| `fotos_moderar` | **Sí** | retira/repone contenido de terceros |
| `observaciones_anular` | **Sí** | anula observaciones ajenas y lee las anuladas |
| `usuarios_admin` | Ya reservado | techo duro vigente |
| `datos` | **No ahora**; decidir en E10-4 | es lectura sensible (titular, NC16, índice completo) pero Gualde y Dietrich lo tienen hoy; reservarlo quita acceso vigente y requiere una decisión de negocio explícita |
| `observaciones`, `fotos`, `reemplazo`, `mapa`, `ne`, `ubicacion`, `perfil`, `*_subir`, `*_corregir`, `*_agregar`, `fotos_carga` | **No** | lectura o propuesta; las propuestas quedan pendientes de un interno |

Pendiente de decisión de negocio (E10-4): `datos` y `observaciones` (qué ve un externo), `reemplazo` (evaluación técnica interna), y si cada cuenta externa debe tener vencimiento.

## 7. Qué hacer al convertir INTERNO → EXTERNO con permisos reservados

**Sin cascada silenciosa. Rechazar y obligar a decidir.** Estado actual: la mutación ya falla con `TIPO_NO_PERMITE_PERMISO` y el `detalle` lista todos los permisos incompatibles (`UsuariosDominio.js:115-123`, `UsuariosAdminService.js:195-198`); con `usuarios_admin` además opera `ULTIMO_ADMIN`. Propuesta:

1. El backend **no quita nada por su cuenta**: la conversión solo se acepta si el pedido ya trae el conjunto de permisos sin los reservados (el administrador los destilda explícitamente en el mismo guardado). Es lo que hace hoy con `usuarios_admin`.
2. La UI, al cambiar el tipo a EXTERNO, **muestra la lista de permisos que dejarían de aplicar** (marcados, deshabilitados y con la leyenda «No aplicable a usuarios externos»), **no los desmarca solos** y bloquea Guardar hasta que se confirmen; confirmación reforzada (`critico`) y **motivo obligatorio** (ya lo exige: `UsuariosAdminService.js:64-71`).
3. Orden de errores sin cambios: aplicabilidad/ULTIMO_ADMIN primero, luego motivo.
4. Mismo tratamiento para **reactivar** un EXTERNO que conserve permisos reservados en la fila (heredados de antes de la regla): se rechaza hasta limpiarlos.
5. Filas EXTERNO ya existentes con un permiso reservado (por edición manual de la hoja): **el runtime ya los anula** (efectivos), pero la pantalla de administración muestra los permisos **crudos**; hay que mostrarlos como «inefectivo» para que el administrador no crea que valen. Gualde/Dietrich hoy no tienen ninguno.
6. EXTERNO → INTERNO: no es alta de externo, no usa el flag, exige motivo (ya). No concede nada automáticamente.

## 8. Qué faltaría para habilitar `E10_GESTION_EXTERNOS_ACTIVO = SI` con seguridad

| Aspecto | Estado hoy | Falta |
|---|---|---|
| Crear EXTERNO | implementado, cerrado por flag (`UsuariosAdminService.js:191`); validación completa | reservar autoridad (E10-3); decidir permisos iniciales sugeridos |
| INTERNO → EXTERNO | implementado; falla si hay permisos no aplicables | UX de §7; texto de confirmación específico |
| EXTERNO → INTERNO | implementado, sin flag, con motivo | ninguno |
| Reactivar EXTERNO | cuenta como alta de externo (flag) | limpiar reservados (§7.4) |
| Permisos incompatibles | solo `usuarios_admin` | ampliar a los 4 reservados (catálogo) |
| Confirmaciones | `critico` + reforzada | confirmación propia para externo («esta persona no es de la DGI») |
| Motivo | obligatorio en cambios de tipo/estado | ninguno |
| Auditoría | `UsuariosEventos` append-only con tipo antes/después | ninguno |
| Último admin | regla vigente | ninguno (un externo no puede ser admin) |
| Cache | `authService_invalidarAcceso` (`UsuariosAdminService.js:247`); TTL 300 s en cambios manuales | ninguno |
| Idempotencia | `clientRequestId` | ninguno |
| UI | tipo seleccionable; mensaje `E10_GESTION_EXTERNOS_INACTIVA` | cartel de §7 y etiqueta de «inefectivo» |
| **Identidad** | `email_verified` en OBSERVAR | **pasar a EXIGIR** antes de crear externos (cuentas Google cualquiera) |
| **Abuso** | sin límite de tasa | E10-5 (rate limiting), en particular para `getIndiceBusquedaProvincia` y `getFotoPozo` |
| **Gobernanza** | flag solo cubre altas | decidir si **editar permisos de un externo activo** debe exigir lo mismo: con C queda cubierto lo grave (no puede recibir autoridad) |

## 9. `checkSession` y qué debe exponerse al cliente

- Hoy devuelve solo `permisos` efectivos (`AuthService.js:165-173`, `242-251`); **no** `tipo`, `estado` ni admin. El frontend no usa `tipo`.
- **E10-3 no necesita exponer nada nuevo.** Como la política se implementa en el catálogo y los permisos ya llegan **efectivos**, un EXTERNO nunca recibe `perfil_validar`/`ubicacion_validar`/`fotos_moderar`/`observaciones_anular` en `permisos`, y toda la UI (`app.js:1253-1258`, `itfLogic_puedeValidar`, etc.) se oculta sola. El backend sigue siendo la autoridad y no confía en el cliente.
- Opcional (no requerido): devolver `tipo` solo para mostrar «Cuenta externa» en la interfaz. Si se agrega, es informativo y nunca se usa para autorizar.

## 10. Alcance propuesto de E10-3

1. **Catálogo:** `aplicableExterno = false` en `perfil_validar`, `ubicacion_validar`, `fotos_moderar`, `observaciones_anular` (`PermisosCatalogo.js:22,26,31,34`). Efecto en cadena sin más código: validador de la administración, permisos efectivos, avisos a validadores, UI (lee del catálogo).
2. **Administración (backend):** que el error por permisos no aplicables devuelva **todos** los ids incompatibles en `detalle` (ya lo hace) y que `reactivar` valide lo mismo.
3. **Administración (UI):** lista explícita de permisos que dejan de aplicar al elegir EXTERNO, sin desmarcado silencioso; etiqueta «inefectivo» para permisos crudos que el runtime anula; confirmación propia para externos.
4. **Identidad:** pasar `email_verified` a EXIGIR (decisión del usuario; es una Script Property existente, sin código).
5. **Diagnóstico/preflight:** `E10Preflight` (`E10Preflight.js:101`) debe contar externos con permisos reservados (hoy cuenta solo `usuarios_admin`) y el diagnóstico de permisos debe poder listarlos.
6. **Documentación:** política escrita («un externo propone, consulta y carga; nunca valida, modera, anula lo ajeno ni administra»).
7. **No incluye** activar `E10_GESTION_EXTERNOS_ACTIVO`, crear externos nuevos ni tocar a Gualde/Dietrich.

Activar el flag de gestión de externos quedaría para después de E10-3 y de una decisión explícita.

## 11. Para E10-4 (datos que ve un externo)

- Qué hace con `datos` (ficha, titular, NC16, índice completo), `observaciones` (notas internas), `fotos` y `reemplazo`: ¿reservar, anonimizar, o permitir con límites?
- Vencimiento de cuentas externas y revisión periódica.
- Si el índice por titular se parte o se limita (con E10-5).
- Marcar visualmente en Telegram/Historial las acciones de cuentas externas (hoy no se distinguen: `NotificationService.js:14`).

## 12. Tests a agregar (todo en local)

1. **Catálogo:** invariante «todo permiso `moderacion` o `administracion` tiene `aplicableExterno = false`»; lista exacta de los 5 reservados; ningún otro cambia.
2. **`usuariosDominio_permisosEfectivos`:** un EXTERNO con `perfil_validar`/`ubicacion_validar`/`fotos_moderar`/`observaciones_anular` crudos los tiene en `false` efectivos; un INTERNO los conserva.
3. **`getUserAccess` / `login` / `checkSession`:** un EXTERNO con reservados crudos no recibe ninguno en `permisos`.
4. **Endpoints (tabla):** para cada acción de moderación (`ITF_MOD_ENDPOINTS`, validar/rechazar/revertir ubicación, decidir/resolver fuente, moderación de fotos, anular ajena) un EXTERNO con el permiso crudo recibe `PERMISSION_DENIED`; un INTERNO con el permiso, `ok`.
5. **Auto-validación:** EXTERNO con `ubicacion_corregir` + `ubicacion_validar` crudos **no** se auto-valida (`Api.js:1790` recibe `false`).
6. **Administración:** asignar un permiso reservado a un EXTERNO → `TIPO_NO_PERMITE_PERMISO`; convertir INTERNO con reservados a EXTERNO → rechazado, `detalle` con **todos** los ids, sin escribir nada; con permisos limpios y motivo → ok; reactivar EXTERNO con reservados → rechazado; EXTERNO → INTERNO ok con motivo.
7. **Cobertura de `doPost`:** test estático que exige que cada acción de `Api.js` figure en una tabla declarada «acción → permisos» (para que ninguna acción nueva quede sin política) y que `tipo` solo se consulte en los dos lugares conocidos.
8. **Avisos:** `sheetUserRepository_filtrarConPermisos` no incluye a un EXTERNO con `perfil_validar`/`ubicacion_validar` crudos.
9. **Regresión Gualde/Dietrich:** fixture con sus 11 permisos exactos → mismos 11 efectivos y las 22 funcionalidades de la matriz sin cambios.
10. **Preflight/diagnóstico:** cuenta y lista externos con reservados.
11. **Frontend:** al elegir EXTERNO se muestran los permisos incompatibles sin desmarcarlos solos y Guardar queda bloqueado hasta limpiarlos; etiqueta «inefectivo»; la tarjeta Administración y las de moderación no aparecen con `permisos` de un externo.
