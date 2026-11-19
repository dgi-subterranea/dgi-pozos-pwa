# Acceso PÚBLICO / ANÓNIMO — auditoría y diseño conceptual

Estado: **solo análisis (19/11/2026); nada implementado.** Adoptado por el usuario: PÚBLICO / ANÓNIMO **no** está en `Usuarios`, no tiene login ni permisos individuales y tendrá una política pública global con su propia whitelist; no se deriva de lo que ve un EXTERNO. Las decisiones de información (§14) se toman en E10-4 y la capa pública se construye después del hardening (E10-5). Sin código, endpoints, páginas, QR/NFC, permisos, usuarios ni Script Properties. `EMAIL_VERIFIED_MODO` sigue en `OBSERVAR`. Complementa [e10-3-politica-usuarios-externos-auditoria.md](e10-3-politica-usuarios-externos-auditoria.md) y la fase futura «QR + NFC por pozo» de [roadmap.md](roadmap.md) (líneas 152-180), que ya fija: token opaco revocable, controles por campo fail-closed y «la vista pública expone solo el punto operativo autorizado».

## 1. Modelo de acceso recomendado

| | INTERNO | EXTERNO | PÚBLICO / ANÓNIMO |
|---|---|---|---|
| Autenticación | Google + sesión | Google + sesión | **ninguna** |
| Fila en `Usuarios` | sí | sí | **no** |
| Qué decide el acceso | permisos individuales | permisos individuales **sin autoridad DGI** | **política pública global** (whitelist de campos) |
| Autoridad (validar, moderar, anular ajeno, administrar) | puede | **nunca** | no aplica |
| Vive en | backend privado | backend privado | **capa separada** |

**PÚBLICO no debe existir en `Usuarios`:** `Usuarios` es una tabla de personas con identidad verificable, auditoría (`UsuariosEventos`) y permisos; un usuario ficticio mezclaría actividad anónima con la auditoría real, obligaría a una sesión ficticia (un token que cualquiera podría usar es una credencial pública con permisos reales) y contaminaría `Historial`, Telegram y los conteos de administradores. Tampoco se agrega `PUBLICO` a `PERMISOS_CATALOGO_TIPOS` (`PermisosCatalogo.js:40`): `tipo` describe a una persona autenticada. Regla de código: **ninguna función de la capa pública llama a `getUserAccess`, `hasPermission` ni `logHistoryEvent`.**

## 2. Qué exige sesión hoy

- `doPost` despacha **69 acciones** (`Api.js:22-241`; en la auditoría anterior conté 63 por error: 62 de negocio + 7 `admin*` = 69). **Todas exigen `sessionToken` válido + usuario activo** (`validateSession`, `Api.js:262-274`, o la puerta de administración `UsuariosAdminApi.js:86-99`), **excepto `login`**, que exige un `idToken` de Google.
- **No hay `doGet`** ni triggers. Ninguna acción es pública.
- El despliegue está como `executeAs: USER_DEPLOYING`, `access: ANYONE_ANONYMOUS` (`backend/src/appsscript.json`): **cualquiera en internet puede enviar un POST**; lo que protege es la sesión. El script corre con los permisos del dueño (acceso total a Drive/Sheets).
- Lo único público hoy es el **shell estático** en GitHub Pages (HTML/JS/CSS). Los datos (padrón, CSV, fotos, `scripts/out/`) están en `.gitignore` y no se versionan (`.gitignore`: `*.csv`, `scripts/out/`, `/Fotos/`). GitHub Pages gratuito exige repositorio público (verificar): todo lo que se agregue al repo para la capa pública es visible por definición.

## 3. Riesgos de reutilizar endpoints privados

1. **Sanitizadores «pasa-todo»**: `registryService_cleanRecord` (`RegistryService.js:116`) solo quita `null` y la geografía; devuelve titular, domicilios, expediente, motivos de baja, comentarios. `nivelesEstaticosService_cleanPunto` hace lo mismo (`NivelesEstaticosService.js:17`). Un campo nuevo del padrón sale solo.
2. **Los índices privados**: `getIndiceBusquedaProvincia` (titular + NC16 de toda la provincia, `MapaService.js:100-115`) y `getWellSummary` (titular).
3. **Coordenadas de todos los pozos** en una llamada (`getMapaPozos`), con `estado` (mecánica interna de ubicación).
4. **Mecánica interna de ubicación**: `getWellLocation` devuelve `ubicacionResuelta` y `coordenadasProvincia` (fuentes); el punto operativo se compone **en el cliente** (`ubicacionOperativaLogic`), no en el backend: hoy el backend no tiene «el punto operativo publicable».
5. **Acoplamiento a sesión**: `hasPermission`, cache `user_access_v2_*`, `logHistoryEvent(email…)`, Telegram con nombre y email: nada de eso tiene sentido sin usuario.
6. **Cuotas compartidas**: un volumen público consumiría las mismas ejecuciones simultáneas, `CacheService` y `UrlFetch` que usa el personal.
7. **Ocultar en el frontend no cuenta**: quien llame directo a la API recibe todo.
8. **ITF**: el contenido de las imágenes **no está revisado** (e10 §12 sigue pendiente): pueden traer titular, domicilio o coordenadas.

## 4. Inventario y clasificación preliminar (SIN decidir publicación)

Leyenda: **P** = potencialmente publicable · **S** = sensible / requiere decisión · **I** = claramente interno. «Personal» = dato personal (Ley 25.326) o de terceros.

| Grupo | Fuente / endpoint actual | Clasif. | Personal | Riesgo de publicarlo | Versión resumida posible |
|---|---|---|---|---|---|
| Número de pozo (`DD-PPPP`) | clave de todo; padrón, `pozos.json` | **P** | no | secuencial ⇒ enumerable (13.8 mil) | — |
| Departamento, distrito | padrón `identificacion`; `getWellSummary` (`datos`) | **P** | no | bajo | solo departamento |
| Cuenca | `pozos.json` (mapa) | **P** | no | bajo | — |
| Nomenclatura catastral (NC16) | padrón; `pozos_busqueda.json` vía `getIndiceBusquedaProvincia` | **S** | indirecto (identifica el predio → titular) | permite llegar al propietario cruzando catastro | no publicar; o solo búsqueda exacta sin listar |
| `registroPerforacion`, NIC | padrón `identificacion` | **S** | administrativo | identificador interno de cuenta/trámite | omitir |
| Titular, domicilios, expediente, DDJJ, organismo, familia | padrón `titularidad`; `getWellRecord`, `getWellSummary`, índice | **I** | **sí** | datos personales y de predios | omitir (no se transforma) |
| Uso y concesión (uso, superficies, hectáreas, caducidad, resolución) | padrón `usoConcesion`; `getWellRecord` | **S** | indirecto | situación legal del derecho de agua | solo «uso» general, o nada |
| Datos técnicos de perforación (profundidad, diámetros, surgencia, aptitud, perfilaje) | padrón `tecnicas`; profundidad y surgencia ya en `pozos.json` | **P/S** | no | dimensiona el uso/valor del pozo | solo profundidad total y surgencia |
| Caudal, depresión, potencia, índice | padrón `tecnicas` | **S** | no | sensibilidad comercial/legal | omitir o rangos |
| Construcción (fecha, mecanismo, cementación, tramos filtrantes) | padrón `construccion`; tramos ya en `pozos.json` | **P/S** | no | bajo | fecha y tramos |
| Empresa y director técnico | padrón `construccion` | **S** | **sí** (director técnico) | nombres de personas/firmas | omitir |
| Domicilio del pozo, plano DGI, plano catastro | padrón `ubicacion`; `getWellRecord` | **S** | indirecto | ubica el predio | omitir |
| Coordenadas exactas (padrón X/Y, WGS84) | padrón; `getWellLocation`; `getMapaPozos` | **S** | indirecto | ubica un predio privado | **aproximada** (grilla o solo distrito) o solo el punto operativo autorizado |
| Punto operativo (resolución de fuentes) | compuesto en cliente: `getMapaPozos` + `getUbicacionesValidadas` + `getDecisionesFuentesDelta` | **S** | no | hoy no existe en el backend | habría que calcularlo en el pipeline |
| Estado de ubicación (R/C/D, validada, coincidente) y fuentes | `getWellLocation`, `getDecisionesFuentesPozo` | **I** | nombres de quien decide | mecánica interna (roadmap:172-175) | no mostrar |
| Estado del pozo (activo/baja/obra/cegado) | padrón `estado` | **P/S** | no | bajo | situación general; sin motivo ni expediente de baja |
| Fecha y motivo de baja, expediente de baja | padrón `estado.baja` | **I** | indirecto | trámites internos | omitir |
| Laboratorio / calidad de agua | padrón `laboratorio.analisis[]` | **S** | no | interés público pero implicancias de salud/comerciales | decisión de política |
| Comentarios y documentación faltante | padrón `comentarios` | **I** | posible | texto libre interno | omitir |
| ITF (imagen) y su disponibilidad | Drive; `getProfile`, `getItfAvailability` (`perfil`) | **S** | **desconocido** (revisión pendiente) | puede traer titular/domicilio/coordenadas | disponibilidad «tiene ITF» quizá P; imagen: decidir tras revisar |
| Niveles estáticos: red | `getMapaNE` (`ne`) | **S** | no | ya se ocultaba a quien no tenía `ne` (`MapaService.js:10-15`) | decisión |
| Niveles estáticos: mediciones | `getMonitoringPoint` (`ne`) | **P/S** | no | dato hidrogeológico de interés | última medición o gráfico |
| Fotos | storage por proxy; `getFotosPozo`, `getFotoPozo` (`fotos`) | **S** | **sí posible** (personas, patentes, predio) | las fotos nacen `ACTIVA` (visibles) y las suben hasta externos | subconjunto curado con flag «publicable» (no existe hoy) |
| Observaciones | `getObservacionesPozo` (`observaciones`) | **I** | nombres de autores | texto libre del personal | omitir (observaciones «públicas» explícitas serían un campo nuevo) |
| Reemplazo (evaluaciones, fotos) | `getEstadoReemplazo`, `getHistorialReemplazo` (`reemplazo`) | **I** | autores | evaluación técnica interna | omitir |
| Historial / línea de tiempo | derivada de correcciones, decisiones, evaluaciones, observaciones | **I** | sí | mezcla todo lo interno | omitir |
| Propuestas colaborativas (ITF, correcciones, sugerencias) | `getItfPendientes`, `getCorreccionesUbicacionPendientes`, `getSugerenciasFuentes*` | **I** | nombres de proponentes | contenido sin validar | omitir |
| Validaciones y decisiones | `UbicacionCorrecciones*`, decisiones de fuentes, `ItfEventos` | **I** | nombres y motivos | trazabilidad interna | omitir |
| Auditoría | `Historial` (emails), `UsuariosEventos`, `Busquedas` | **I** | **sí** | emails y acciones | nunca |
| Usuarios, permisos, administración | hoja `Usuarios`; endpoints `admin*` | **I** | **sí** | — | nunca |
| Metadata del padrón (periodo, fecha) | `getMetadata` | **P** | no | bajo | «Padrón: mes año» |
| Derivados (aptitud para reemplazo, exportación XLSX) | cliente, a partir de datasets privados | **I** | no | mecánica interna | omitir |

## 5. Alternativas de arquitectura de la capa pública

| Opción | Cómo | Ventajas | Desventajas |
|---|---|---|---|
| **A. Mismo deployment, acciones `public*`** | `doPost` con acciones nuevas | cero infraestructura nueva | **comparte cuotas, cache y cuenta con el personal** (un pico público degrada la app interna); el script corre con acceso total a Drive/Sheets; `doPost` no entrega IP: no hay rate limit por cliente; sin SEO ni vista previa de enlaces |
| **B. Deployment/proyecto Apps Script independiente** (otra cuenta, solo ve un conjunto público) | proyecto aparte que lee una **copia pública** (Drive/Sheet solo con lo publicable) | cuotas y cuenta aisladas, privilegio mínimo (no puede leer `Usuarios` ni el padrón completo), revocación inmediata por pozo, kill-switch propio | sigue sin IP; sin SEO; hay que mantener un pipeline que alimente la copia |
| **C. Publicación estática en GitHub Pages** (generada offline con whitelist) | el pipeline Python (`reindex_*.py` ya existen) emite **archivos públicos** (`/publico/…`) | **sin backend en tiempo de consulta**: sin cuotas de Apps Script, sin API que filtrar campos, SEO y vista previa (Open Graph), CDN, $0; lo publicado es solo lo que el generador escribe | datos con latencia de publicación (Pages cachea ~10 min + deploy); **revocar = redeploy**; búsqueda 100 % en el cliente sobre un índice reducido; 13.8 mil páginas o un SPA con rutas por query |

**Recomendación: C como camino principal, B solo si aparece una necesidad dinámica** (búsqueda del lado del servidor, revocación inmediata de un token, datos que cambian por minuto). **No A**, salvo como paso de prueba muy acotado. Razones: SEO y compartir enlaces solo funcionan con páginas estáticas; el modelo de amenaza deja de depender de Apps Script (que no ve la IP); y la whitelist es un **artefacto de generación** (se puede auditar el archivo antes de subirlo), no un filtro en tiempo de ejecución.

Lo que hay que respetar en cualquier variante:
- **Ningún código de la capa pública importa ni llama a servicios privados.** DTOs públicos propios, construidos **campo por campo** desde una configuración `PUBLICO_CAMPOS` fail-closed (un campo que no está listado no sale), como ya hacen `mapaService_sanitizarPunto` y `registryService_getWellSummary`, **nunca** con `cleanRecord`.
- Tests «canario»: un registro de prueba lleno de titular, domicilio, NC16, emails y comentarios; la salida pública no puede contener ninguno (como las pruebas de mutación de E10-2).
- Respuestas uniformes: «no existe» y «existe pero no es público» son indistinguibles.
- Frontend público **aparte** (`/publico/`): sin `api.js` privado, sin Google Sign-In, sin `sessionToken`, JS mínimo para celular. El service worker actual (`sw.js`, alcance de todo el sitio) no debe cachear datos públicos ni servir la capa pública con la lógica del shell privado: o se excluye `/publico/` o se usa otro alcance.

## 6. Búsqueda pública sin exponer lo sensible

- **No se reutiliza** `pozos_busqueda.json` ni `getIndiceBusquedaProvincia` (titular + NC16).
- **Índice público reducido** generado por el pipeline: `{wellId, departamento, (distrito), (cuenca)}` y, solo si se decide, `{estado}`. Orden de magnitud: ~13.8 mil filas × ~50 bytes ≈ 0.7 MB (≈ 0.15 MB comprimido) — estimación a confirmar con el pipeline. Búsqueda en el cliente, sin backend.
- **Por número de pozo:** exacta, normalizada (`01-0001`, `010001`). Barata y sin riesgo propio.
- **Por nomenclatura (NC16):** **no** en el índice. Si se decide permitirla, solo como consulta exacta de uno (nunca listado ni autocompletado), porque identifica el predio.
- **Por texto libre:** solo sobre campos públicos (departamento, distrito, cuenca). **Nunca por titular**, ni siquiera exacta ni parcial.
- **Mapa público (futuro):** primero decidir exacta vs. aproximada. Aproximada = ajustar a una grilla (p. ej. 1 km) o mostrar solo el centroide de distrito; «cerca mío» no debe devolver coordenadas exactas. Hoy el mapa privado entrega **todas** las coordenadas en una llamada: no es reutilizable.
- **Límites de consulta** (si hay backend): longitud mínima, tope de resultados (p. ej. 20), sin comodines, sin conteos exactos.

## 7. URL del pozo: `wellId` visible vs. identificador opaco

| Criterio | A. `wellId` visible (`/publico/pozo/01-0001`) | B. Opaco (`/p/Ab7K92x`) | C. Combinación |
|---|---|---|---|
| Seguridad | el id **no es un secreto** (secuencial, 13.8 mil: enumerable en minutos); aceptable **solo si** la ficha es pública por política | no adivinable (7 caracteres base58 ≈ 2·10¹² combinaciones contra 13.8 mil pozos); **pero** si el índice público lista los pozos con sus enlaces, los tokens son enumerables igual | el `wellId` seguirá abriendo la misma ficha: el opaco no suma confidencialidad, solo control |
| Facilidad | legible, tipeable, se puede decir por teléfono | no se puede recordar ni deducir | lo mejor de cada uno |
| SEO y compartir | bueno (URL con significado, Open Graph) | pobre (pero `noindex` puede ser deseable) | SEO por `wellId`; QR por opaco |
| Mantenimiento | ninguno | **mapeo privado** pozo↔token (fuera del repo), regenerar y revocar | mapeo para QR/NFC |
| Enumeración masiva | trivial | difícil, mientras no haya listado | trivial por el camino `wellId` |
| QR/NFC | sirve; URL corta (`/p/01-0001`); no revocable | sirve; **revocable**, reimprimible | opaco en el sticker, `wellId` en la web |
| Revocación por pozo | solo quitando el pozo del conjunto público | token por pozo | igual que B para el sticker |

**No decidir todavía**: falta la política. El opaco solo agrega valor si (i) la ficha del QR muestra **más** que la ficha pública general («contacto / instrucciones» del roadmap), o (ii) se quiere revocar o regenerar por pozo, o (iii) no habrá listado público. Si la ficha del QR es la misma que la pública, **A alcanza** (el QR codifica la URL con el `wellId`) y se evita el mapeo.

## 8. QR/NFC como entrada opcional

- QR/NFC solo apuntan a `/publico/pozo/<id>`: **un acceso directo**, no el origen de la arquitectura. La capa pública funciona igual con una URL normal, desde Google o desde un enlace compartido.
- La entrada general `/publico/` (buscador) y la directa al pozo comparten la misma ficha y los mismos datos.
- NTAG213 (144 bytes) alcanza para una URL corta; el QR lo genera el sistema (roadmap:160). Pendiente de diseño: regenerar/revocar, reimprimir, NFC perdido.
- Que sea un tercer nivel de información («ficha de campo») es una **decisión de política**, no un requisito técnico (ver §7).

## 9. Protección ante scraping, enumeración y abuso

Condiciones de Apps Script a tener en cuenta (verificar las cuotas vigentes antes de dimensionar): `doPost` **no entrega la IP ni cabeceras**, así que **no hay rate limit por cliente**; solo contadores globales (CacheService, con TTL máximo de horas y 100 KB por valor) y topes de respuesta. El cuerpo de la respuesta se calcula y factura contra la cuenta del dueño.

| Amenaza | Capa estática (C) | Capa dinámica (B/A) | Pertenece a |
|---|---|---|---|
| Scraping masivo | no hay API que proteger: lo publicado es público por decisión; el límite es ancho de banda de Pages | tope por consulta, resultados acotados, sin listado completo | E10-4 (qué se publica) / E10-5 |
| Enumeración de pozos | el índice público ya los lista; irrelevante si la ficha es pública | ids opacos **sin** listado, respuestas uniformes | E10-4 |
| Búsqueda abusiva | cliente: no cuesta backend | longitud mínima, tope, contadores globales, kill-switch (`PUBLICO_ACTIVO`) | **E10-5** |
| Descarga masiva | generar archivos livianos y sin geometría exacta | tope diario global | **E10-5** |
| Bots / volumen | CDN de Pages | cuota aislada (cuenta distinta), circuit breaker, evaluar proxy con IP (p. ej. un CDN gratuito delante, que requiere dominio propio) | **E10-5** |
| Consultas repetitivas | cache del navegador y del CDN | cache `pub_v1_*` (ver §11) | E10-5 |

**Qué es E10-5 y qué no:** E10-5 = contadores y topes globales, kill-switch, aislamiento de cuota, protección de login e imágenes de usuarios autenticados, `email_verified = EXIGIR`, vencimiento de externos. **No** es E10-5 la whitelist ni la decisión de qué se publica (E10-4).

## 10. Logging y auditoría de la actividad pública

Recomendación: **cero logging individual por defecto**.
- **Nunca** en `Usuarios`, `UsuariosEventos`, `Historial` ni Telegram (un volumen anónimo inundaría el chat y sería un vector de abuso).
- **Métricas agregadas** opcionales: contadores por hora (consultas, búsquedas, errores, límites alcanzados) acumulados en cache y volcados por un trigger a una hoja **aparte** (`PublicoMetricas`), solo números: sin IP, sin texto de consulta, sin identificador de cliente. Un contador por `wellId` (p. ej. escaneos de QR) es de bajo riesgo si no se asocia a nadie.
- **Técnico mínimo:** errores del propio servicio (`exceptionLogging: STACKDRIVER` ya activo), sin cuerpo de la consulta.
- En la opción estática no hay log (Pages no lo expone); una analítica de visitas, si se quisiera, es una decisión aparte de privacidad.

## 11. Cache

- Hoy: acceso por usuario `user_access_v2_<email>` (TTL 300 s, `AuthService.js:40`), caches de padrón por pozo, índice de ITF y datasets en `CacheService` (compartido por todo el script), shell en `sw.js` (network-first) y Pages (`max-age` ≈ 10 min).
- **Público no usa el cache de autorización** (no hay sesión). Si hay backend: claves propias `pub_v1_<snapshot>_…`, nunca las claves privadas; el volumen público no debe desalojar entradas del personal (`CacheService` es compartido → otra razón de aislamiento, opción B).
- **Estático:** CDN de Pages (≈10 min, no configurable), archivos con hash en el nombre para invalidar, y `sw.js` sin interferir. **Latencia de revocación = deploy + ~10 min**; si hace falta revocación inmediata, eso empuja a la opción B.

## 12. Compatibilidad con E10-3 (política de EXTERNOS)

La política **no entra en conflicto**: afecta solo a usuarios autenticados y se implementa en el catálogo de permisos; la capa pública **no usa permisos**. Los pares quedan así: `datos`, `observaciones`, `fotos`, etc. siguen siendo decisiones sobre el EXTERNO autenticado; lo público tiene su propia whitelist. Único cuidado: la capa pública **nunca se deriva** de lo que ve un EXTERNO (un externo con `datos` ve titular; lo público no).

### ¿E10-3 puede implementarse como estaba propuesto?
**A. Sí, sin cambios al diseño.** Un ajuste mínimo, que ya cabe en lo planeado: en el **test estático de cobertura de `doPost`** (prueba 6 del borrador de E10-3), declarar para cada acción su **modo de acceso** (`sesion` | `publico`), hoy todas `sesion`. Así el día que exista una acción pública queda declarada y revisable, y el test falla si aparece una sin declarar o una pública que llame a `getUserAccess`, `hasPermission` o `logHistoryEvent`. Se agrega además una nota en la documentación: «`tipo` solo describe personas autenticadas; PÚBLICO no es un `tipo`».

## 13. Orden recomendado de etapas

| Etapa | Contenido |
|---|---|
| **E10-3** | Autoridad reservada (4 permisos) + cerrar la brecha de E10-2 + test de modos de acceso. Sin flags nuevos, sin endpoints públicos. |
| **E10-4** | **Decisiones de información** (documento y decisiones; sin construir la capa pública): qué ve un EXTERNO y qué ve el PÚBLICO, clasificando cada campo del §4; **revisión de contenido de ITF** (e10 §12, la hace personal autorizado: es entrada obligatoria para ITF y fotos); decisión URL (§7) y punto operativo/aproximación. |
| **E10-5** | **Hardening**: límites y topes globales, kill-switch, aislamiento de cuota, `email_verified = EXIGIR`, vencimiento de externos, logging/métricas, diseño de protección de la capa pública. |
| **Etapa nueva (propuesta «E11 — Capa pública»)** | Implementación: pipeline con whitelist, índice público reducido, `/publico/`, ficha pública, QR/NFC opcional. **Después** de E10-5: no se publica nada antes de que exista la protección que corresponde. |
| **E10-6** | Piloto de externo (el antes «E10-3»), con `E10_GESTION_EXTERNOS_ACTIVO` solo para el piloto. |

La hipótesis del usuario se confirma con dos ajustes: separar **decidir** (E10-4) de **construir** lo público (etapa propia tras E10-5), y mover la revisión de ITF a E10-4 como entrada.

## 14. Decisiones que necesita el usuario

1. ¿Qué campos son públicos (§4)? ¿Algún dato personal es público por una norma de transparencia, o ninguno?
2. ¿La ubicación pública es **exacta**, **aproximada** (grilla/distrito) o **ninguna**? ¿Solo el punto operativo autorizado?
3. ¿Un QR/NFC muestra **lo mismo** que la ficha pública general o **más**? De eso depende wellId vs. opaco.
4. ¿Se acepta **revocar con latencia** (deploy + ~10 min) o hace falta revocación inmediata? Eso decide entre opción C y B.
5. ¿Se permite buscar por **NC16** (aunque sea exacta)? ¿Por **titular**: nunca?
6. ¿Fotos y observaciones públicas: existe una noción de «publicable» curada (campo nuevo) o quedan fuera?
7. ¿Se hace la revisión de ITF (e10 §12) y quién la ejecuta?
8. ¿Hay presupuesto/aceptación para un dominio propio o un proxy gratuito que dé IP para el rate limiting, o se resuelve solo con publicación estática?
9. ¿Quién es el responsable institucional de publicar (validación legal) antes de que algo sea público?
10. ¿Una segunda cuenta de Google puede alojar la opción B si se necesita (ya existe la cuenta del storage)?
