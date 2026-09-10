# Arquitectura

Estado: V0 cerrada (GO). **V1 cerrada — tag `v1.0.0` (2026-08-27).** Próxima etapa: diseño visual/estético y UX, sin cambios de lógica.

## Capas

```
Usuario (celular/PC)
        |
        v
   PWA (GitHub Pages)
   - HTML/CSS/JS estatico, manifest, service worker (pendiente en V1)
   - Login con Google (Google Identity Services)
        |  POST text/plain con el ID token / sessionToken en el body
        v
   API (Apps Script Web App - doPost, un unico entry point)
   - Verifica identidad, nunca expone stack traces al cliente
        |
        v
   Servicios (funciones puras, sin saber de HTTP)
   - AuthService (sesion + allowlist), ProfileService, HistoryService
        |
        v
   Repositorios (unica capa que sabe de Drive/Sheets)
   - DriveProfileRepository, SheetUserRepository, SheetHistoryRepository
        |
        v
   Google Drive (carpeta THUMB) / Google Sheets (Usuarios, Historial)
```

Backend ya separado en archivos (`backend/src/*.js`) — la migración desde el `Code.gs` único de V0 se completó en el paso 1 de V1.

## Decisiones confirmadas empíricamente en V0

**CORS**: Apps Script Web Apps no manejan el preflight de CORS de forma confiable (no hay garantía documentada de que un `doOptions` funcione siempre). Se evita el problema por diseño: todos los requests autenticados usan `POST` con `Content-Type: text/plain` (nunca headers custom, nunca `application/json` real), lo que el navegador considera "simple" y no dispara preflight. Confirmado funcionando en Chrome (PC) y Safari (iPhone, incluida la PWA instalada en modo standalone), **sin necesidad de Cloudflare**.

**Autenticación**: login con Google Identity Services → el ID token se valida **una sola vez**, contra `https://oauth2.googleapis.com/tokeninfo`, verificando `aud` contra nuestro Client ID. A partir de ahí se emite un `sessionToken` propio firmado con HMAC-SHA256 (`email`, `iat`, `exp`), que se valida **localmente** (sin volver a llamar a Google) en cada request posterior. Confirmado: rechaza correctamente un token alterado (firma inválida) y un token expirado. `SESSION_TTL_SECONDS` es de 30 días (2592000s) con renovación rolling/sliding — ver [Sesión rolling/sliding de 30 días](#sesión-rollingsliding-de-30-días-2026-09-10) más abajo. (En V0 se usaron 60s y luego 1800s solo para poder probar la expiración sin esperar horas; el valor definitivo de V1.0 fue 12h/43200s, reemplazado por este esquema.)

**Persistencia de sesión (iOS standalone)**: `localStorage` **sí persiste correctamente** en una PWA instalada en pantalla de inicio de iPhone. El problema observado inicialmente (la app pedía login de nuevo tras cerrar/reabrir) no era un límite de almacenamiento de iOS: el frontend de V0 nunca revisaba `localStorage` al arrancar. Se corrigió agregando una verificación automática al cargar la página (busca el token guardado, lo valida contra el backend, y si es válido reusa la sesión sin pedir login). Como refuerzo adicional se activó `data-auto_select="true"` en Google Identity Services, para relogin silencioso si la sesión de Google del navegador sigue activa.

**Acceso a Drive**: `DriveApp.getFolderById(...).getFilesByName(wellId + '.jpg')` funciona correctamente y con latencia baja (366-504 ms medidos) para un archivo real de la carpeta `THUMB`. **Decisión confirmada sin cambios**: no se construye un índice separado para V1 — esta llamada ya está indexada por Drive internamente, y el volumen de uso esperado (decenas de usuarios) no lo justifica. Si en el futuro hiciera falta, se reemplaza dentro de `DriveProfileRepository` sin tocar `ProfileService` ni el frontend.

**Entrega de imagen — decisión central de V0**: se probó explícitamente un mecanismo de "ticket firmado + `doGet` + `Blob` directo" para evitar el costo de base64, y **falló**. Causa confirmada con la documentación oficial de Apps Script: un Web App de Apps Script, en `doGet`/`doPost`, **solo puede devolver `HtmlOutput` o `TextOutput`** — no existe una forma soportada de devolver un `Blob` binario como respuesta HTTP. Ese código se eliminó del proyecto (no queda como código muerto).

Mecanismo vigente al cierre de V0: base64 embebido en la respuesta JSON de una única llamada POST. Funciona correctamente en Android y iPhone, pero es lento para archivos grandes: `01-0012.jpg` (2.24 MB original, 2.99 MB en base64) tardó **~5.2-6.2 s de punta a punta**, muy por encima del objetivo de "<2s" de la especificación de V1. El tiempo del lado de Apps Script/Drive es bajo (366-504 ms); el cuello de botella es el tamaño del payload transmitido, no el backend.

Primer paso de V1 (en curso, no forma parte del cierre de V0): reducir el tamaño real de los JPG servidos generando una versión "para pantalla" del corpus, en vez de cambiar el mecanismo de entrega. Se descarta introducir Cloudflare (u otro runtime adicional) a menos que la optimización de imágenes resulte insuficiente una vez medida.

**Decisión confirmada — parámetro de compresión para V1**: se probaron 3 variantes de `01-0012.jpg` (`scripts/resize_experiment.py`, targets ~300/500/800 KB). Resultado:

| Versión | Tamaño real | Base64 | Tiempo total | Evaluación |
|---|---|---|---|---|
| A (calidad JPEG 52, resolución original 2958x2303) | 545 KB | 727 KB | 3.2 s | buena calidad visual |
| B (calidad JPEG, target 500KB) | 575 KB | 766 KB | 3.5 s | sin mejora clara sobre A |
| C (target 800KB) | 937 KB | 1249 KB | 7.0 s | demasiado lenta |

Se adopta **Versión A** como estándar: **recompresión JPEG a calidad 52, sin redimensionar** (cada archivo conserva su resolución nativa). Importante: en la búsqueda de A nunca hizo falta reducir resolución — la calidad 52 sola, a resolución original, ya alcanzó ese tamaño. Por eso el parámetro que se generaliza a todo el corpus es "calidad 52", no una resolución fija en píxeles (los archivos del corpus no son todos de la misma resolución nativa).

`scripts/batch_compress.py` quedó preparado para recomprimir el corpus completo hacia una carpeta nueva (`THUMB_WEB`), sin tocar los originales de `THUMB`. **No se ejecutó**: la decisión final (ver "Fuente de imágenes" más abajo) fue no aplicarlo en V1, porque los archivos reales del corpus ya son livianos. El script queda documentado como herramienta disponible si en el futuro hiciera falta.

**Contrato de errores**: `{status, code, message}`. Códigos activos en V1.0: `INVALID_WELL_ID`, `UNAUTHORIZED`, `USER_DISABLED`, `PROFILE_NOT_FOUND`, `SERVICE_UNAVAILABLE`. El campo `debug` temporal de V0 ya fue eliminado. `RATE_LIMITED` está reservado en el contrato pero **no se emite en V1.0** — ver nota de rate limiting más abajo.

**Configuración/secretos**: `GOOGLE_CLIENT_ID` es público por diseño (vive en el código, tanto frontend como backend). `SESSION_SECRET` y `FOLDER_ID` viven únicamente en Script Properties de Apps Script, nunca en el código fuente.

## V1 — implementado hasta el momento

- Backend separado en capas (`backend/src/Api.js`, `AuthService.js`, `ProfileService.js`, `DriveProfileRepository.js`, `SheetUserRepository.js`, `SheetHistoryRepository.js`, `HistoryService.js`, `Config.js`), migrado desde el `Code.gs` único de V0 sin cambiar comportamiento observable.
- Allowlist real (hoja "Usuarios") con cache de 5 minutos en `AuthService.isUserActive`, aplicada en `login`, `checkSession` y `getProfile` — deshabilitar a alguien tarda como máximo 5 minutos en tener efecto, no hasta que expire la sesión.
- Historial de auditoría (hoja "Historial") de `login` y `getProfile` (todos sus resultados), append-only, nunca se lee para decidir nada. `checkSession` no se audita (es recuperación silenciosa, no una acción de negocio).
- Campo `debug` temporal eliminado de las respuestas de error.
- Frontend reescrito con máquina de estados (cargando sesión, no autenticado, listo, buscando, encontrado, no encontrado, usuario deshabilitado, sin conexión/error), sin restos de la UI de diagnóstico de V0. `manifest.json` + `sw.js` (cachea solo el app shell).

**Rate limiting**: **no forma parte de V1.0** — decisión explícita del 2026-08-27, ratificada nuevamente. No existe `RateLimiter.js`, no hay contadores en `CacheService`, y el código `RATE_LIMITED` no se emite en ningún flujo. Queda solo como idea de mejora opcional para una V1.x futura (contador por email/hora vía `CacheService`), no como requisito ni pendiente de `v1.0.0`.

### Service Worker — de cache-first a network-first (2026-08-27)

La estrategia original (cache-first) exigía subir `CACHE_NAME` manualmente en cada commit que tocara un archivo del app shell — es lo único que hace que un dispositivo con el Service Worker ya instalado detecte que hay una versión nueva. Ese paso manual se olvidó **tres veces** durante el desarrollo de V1 (dos de ellas detectadas por pruebas del usuario, una detectada y corregida antes de que hiciera falta avisar), cada vez dejando Android/iPhone sirviendo archivos viejos mientras PC mostraba la versión nueva.

Se reemplaza por **network-first con fallback a cache**: con conexión, `sw.js` siempre intenta la red primero y actualiza el cache con la respuesta fresca — el usuario ve la versión más reciente sin que dependa de ningún paso manual. Sin conexión, responde lo último que haya en cache. `CACHE_NAME` deja de necesitar incrementarse en cada cambio del shell (queda fijo en `dgi-pozos-shell`); solo haría falta cambiarlo para forzar una limpieza total del cache en algún escenario excepcional.

Se agregó `sw.test.js`: verifica que cada archivo listado en `SHELL_FILES` exista realmente en el repo (evita otra clase de bug: un typo o un archivo borrado/renombrado sin actualizar la lista haría fallar `cache.addAll()` por completo en el install del Service Worker). `sw.js` expone `SHELL_FILES`/`CACHE_NAME` vía el mismo patrón de `module.exports` condicional usado en el backend, para poder testear sin duplicar código y sin que afecte la ejecución real en el navegador.

### Validación y normalización de `wellId` — reglas finales

Se separan dos preguntas distintas, cada una con su propia regla:

1. **Normalización de formato** (`js/wellIdValidator.js`, frontend únicamente): solo se normaliza cuando el punto de corte entre departamento y pozo es inequívoco — hay separador explícito (guion, guion unicode, o espacio), o son exactamente 6 dígitos sin separador (2+4, sin ambigüedad posible). Si no se puede determinar el corte sin adivinar (ej. `112`, `3123` sin separador), se deja el valor sin normalizar para que la validación lo rechace — **nunca se adivina un corte ambiguo**.
2. **Validación de rango**: los departamentos válidos van de **01 a 19**. Esta regla existe en **ambos lados**, de forma independiente: `js/wellIdValidator.js` en el frontend y `backend/src/Api.js` en el backend (el backend nunca confía únicamente en la validación del cliente). Un departamento fuera de rango (`00`, `20` o superior) devuelve `INVALID_WELL_ID` sin llegar a consultar Drive.

El input en pantalla tiene además un enmascarado en vivo (`formatWellIdInput`): solo dígitos, guion automático después del segundo dígito, máximo 6 dígitos reales — igual en Android y iPhone, ya que iOS no ofrece el guion cómodamente en el teclado numérico. El pegado de texto usa la normalización completa (acepta variantes con separador), no el enmascarado simple.

### Google Identity Services — init programático, no declarativo

V0 inicializaba Google Sign-In de forma declarativa (`<div id="g_id_onload" data-auto_select="true">`), lo que hacía que el prompt de "One Tap" de Google apareciera **siempre**, apenas cargaba la librería, sin importar si la sesión propia ya se había recuperado con éxito. Corregido: la inicialización (`google.accounts.id.initialize` + `.renderButton` + `.prompt()`) ahora es 100% programática desde `js/app.js`, y solo se dispara si `checkSession` ya determinó que no hay una sesión propia válida. También se llama a `google.accounts.id.disableAutoSelect()` al cerrar sesión, para que "Cerrar sesión" no quede anulado por un re-login silencioso de Google.

### Sesión rolling/sliding de 30 días (2026-09-10)

El TTL fijo de 12h (definitivo para `v1.0.0`) resultó demasiado corto en uso real: si el usuario no abría la app en un par de días, tenía que volver a autenticarse con Google. Se reemplaza por una sesión **rolling/sliding**:

- `SESSION_TTL_SECONDS` pasa de `43200` (12h) a `2592000` (30 días) en `backend/src/AuthService.js`.
- `handleCheckSession` (invocado por el frontend una vez, en `init()`, cada vez que se abre/reabre la app) ya no se limita a validar: si el token es válido **y** el usuario sigue activo, reemite silenciosamente un `sessionToken` nuevo con otros 30 días completos, en `data.sessionToken`.
- `js/app.js` reemplaza el token guardado en `localStorage` con el nuevo, sin ninguna acción del usuario.
- Efecto práctico: mientras la app se abra con alguna frecuencia razonable (bastante menos de 30 días entre usos), la sesión se mantiene indefinidamente. Si pasan 30 días completos sin abrirla, el último token emitido expira y vuelve a pedir login con Google. "Salir" sigue siendo el mecanismo principal de cierre de sesión (borra el token local, sin esperar a la expiración).
- La firma HMAC-SHA256 y la verificación de expiración (`verifySessionToken`) no cambian. Un usuario deshabilitado en la hoja "Usuarios" sigue perdiendo acceso (vía `isUserActive`, cache de 5 minutos) aunque su token no haya vencido — y en ese caso `handleCheckSession` devuelve `USER_DISABLED` sin emitir token nuevo.
- La renovación queda atada únicamente a `checkSession`, no a `getProfile`: una pestaña abierta sin recargar por más de 30 días seguidos, usando solo búsquedas, terminaría pidiendo login de nuevo. Caso límite aceptado explícitamente, no se resuelve en esta etapa.

### Fuente de imágenes — confirmado

V1 usa la carpeta `THUMB` actual tal cual (no `THUMB_WEB`). No se reprocesa el corpus por ahora — los archivos reales ya son livianos (37-170 KB), muy por debajo del caso de 2.24 MB que motivó la investigación de compresión. Base64 se mantiene como mecanismo de entrega en esta etapa.

## Checklist de criterios de aceptación de V1 (previo al tag `v1.0.0`)

Basado en la evidencia acumulada de las pruebas manuales de cada paso (no es una sesión de regresión única de punta a punta) más los 76 tests automatizados.

| # | Criterio | Estado |
|---|---|---|
| 1 | Abrir la app desde celular | ✅ Aprobado |
| 2 | Instalar/agregar a inicio | ✅ Aprobado (reinstalación completa probada en iPhone) |
| 3 | Autenticarse | ✅ Aprobado |
| 4 | Escribir `DD-PPPP` | ✅ Aprobado (con enmascarado, PC/Android/iPhone) |
| 5 | Encontrar el perfil si existe | ✅ Aprobado |
| 6 | Visualizarlo | ✅ Aprobado |
| 7 | Descargarlo | ✅ Aprobado (Android/PC descarga directa; iOS hoja de compartir nativa) |
| 8 | Mensaje claro si no existe | ✅ Aprobado |
| 9 | Usuario no autorizado no accede | ✅ Aprobado (`USER_DISABLED`, probado + testeado) |
| 10 | Sin secretos visibles en frontend | ✅ Aprobado (verificado en cada commit) |
| 11 | Funciona con la PC personal apagada | ✅ Aprobado (arquitectura 100% en la nube) |
| 12 | No depende de PyCharm | ✅ Aprobado |
| 13 | No depende de Telegram | ✅ Aprobado |
| 14 | No depende de WhatsApp | ✅ Aprobado |
| 15 | Costo mensual $0 | ✅ Aprobado (GitHub Pages + Apps Script + Drive/Sheets, todo dentro de cuotas gratuitas) |
| 16 | Funciona en Android | ✅ Aprobado |
| 17 | Funciona razonablemente en iPhone | ✅ Aprobado (incluido offline) |
| 18 | Funciona en escritorio | ✅ Aprobado |
| 19 | Tests de flujos críticos | ✅ Aprobado (76 tests, `wellIdValidator`/`AuthService`/`ProfileService`/`Api`/`sw.js`) |
| 20 | Documentación de despliegue | ✅ Aprobado (`README.md` actualizado) |
| 21 | Git tag/release de V1 estable | ✅ Aprobado — tag `v1.0.0` |

Ningún ítem cae en "no aplica" — los 21 criterios de la especificación original son todos relevantes para V1. **V1 cerrada.**

## Riesgos conocidos, documentados y aceptados

- Toda la infraestructura (Drive, Apps Script, Sheets) depende de cuentas de Google personales (`falbrieu@gmail.com`, `dgiperfiles@gmail.com`), no de un dominio institucional Workspace. Riesgo de continuidad institucional, fuera del alcance técnico de este proyecto.
- `CacheService` no garantiza persistencia (Google puede desalojar entradas antes de tiempo); nunca debe ser la única fuente de verdad de nada crítico — ver Script CacheService quotas.
- `tokeninfo` de Google no está pensado por Google para uso intensivo en producción (riesgo de throttling); se usa solo en el login, no en cada consulta, para minimizar ese riesgo.

## Pendiente técnico menor: actualización del shell en iOS tras cambios grandes de frontend

Confirmado el 2026-08-27: después del cambio visual (Acequia Refinada), una PWA ya instalada en un iPhone siguió mostrando la versión anterior hasta desinstalarla y volver a agregarla a pantalla de inicio — no era una incompatibilidad estética de iOS, era la versión vieja del shell todavía servida.

**Diagnóstico (confirmado con headers HTTP reales, no una suposición):** GitHub Pages sirve `index.html`/`css/styles.css`/`js/app.js` con `Cache-Control: max-age=600`. El `fetch()` que usa `networkFirstThenCache` en `sw.js` no tiene ningún override de caché, así que aun con la estrategia "red primero" ese `fetch()` puede resolverse contra la caché HTTP nativa del navegador en vez de ir a la red real — Safari/WebKit es conocido por aplicar esto de forma más persistente que Chrome, en particular para PWAs instaladas en pantalla de inicio (modo standalone).

**Arreglo identificado, no aplicado todavía (decisión explícita del usuario, 2026-08-27):** agregar `{ cache: 'no-store' }` a los `fetch()` internos de `sw.js` (tanto en `networkFirstThenCache` como en la rama `mode: 'navigate'`), para que esos requests ignoren la caché HTTP nativa sin importar la plataforma. Se descarta cache-busting por hash/querystring en los archivos del shell por reintroducir un paso manual (justo lo que se eliminó al pasar `CACHE_NAME` a un valor fijo).

Queda como mejora a evaluar en una versión futura, no bloqueante — el mitigante actual (desinstalar y reinstalar la PWA) ya resuelve el caso real observado.

## V2 — Ficha del Pozo: arquitectura (backend cerrado, frontend pendiente)

Módulo nuevo, independiente del ITF, a partir del Reporte de Pozos real (`Reporte Pozos MM_AAAA.csv`, 106 columnas, exportado del sistema interno — no una hoja mantenida a mano). El CSV fuente y toda su salida derivada tienen datos personales reales (titulares, domicilios) y quedan fuera del repositorio (`.gitignore`), nunca en git.

### Modelo de datos

Las 106 columnas se reducen a ~90 campos útiles (se descartan ~15 columnas `Cod. X`/`Cód. X` que son el código numérico de una columna de texto ya presente), agrupados en 9 secciones: `identificacion`, `titularidad`, `usoConcesion`, `tecnicas`, `construccion`, `ubicacion`, `estado`, `laboratorio` (con `analisis[]`, 0..N — ver más abajo), `comentarios`.

### Normalización — no es una regla genérica `0=null`

El sistema origen completa la mayoría de los campos numéricos con `0` cuando no hay dato (nunca los deja en blanco), así que `0→null` es la regla por defecto para esos campos. Pero se verificaron y documentaron excepciones concretas contra el CSV real antes de aplicar cualquier regla:

- **`Cementación desde`**: puede ser un `0` real (cementado desde la superficie) — pero solo si `Cementación hasta` es también un valor real; si ambos son `0`, no hay evidencia de que sea una medición y se nulifica igual que `hasta`.
- **`Carbonatos`**: no es numérico — trae texto de laboratorio (`ATE`, `AUSENTE`, `NEGATIVO`, `VESTIGIOS`, `N/C`, 311+ casos de `ATE` solo) — se conserva como string, nunca se fuerza a `float`.
- **`Reducción 1-3` (`hasta=0`/`diametro=0` con `desde` real)**: patrón real y muy frecuente (10.161 casos combinados en las 3 columnas — hasta el 94% de las entradas no vacías de `Reducción 2`), a diferencia de `Filtro 1-5` donde el mismo patrón es raro (menos de 20 casos por columna). Una "reducción" es un punto de transición de diámetro, no un rango con inicio y fin reales como un filtro — el subcampo individual se conserva literal, solo el tramo completo `0,00-0,00 (Diam.0,00)` se trata como sin dato.
- **`Expediente`** (formato `NUMERO-CODIGO-AÑO`, ej. `91373-OS-1970`, o `NUMERO--AÑO` sin código): cuando `NUMERO` es `0` (1.362 filas: 1.302 en formato `NUMERO--AÑO` + 60 con código real, ej. `0--0`, `0--2000`, `0-OS-1974`) es el mismo sin-dato genérico de campos numéricos — se nulifica el expediente completo. Un `AÑO` en `0` con `NUMERO` real (ej. `182167--0`, 4.164 filas en total, la enorme mayoría con número real) se conserva tal cual — no hay evidencia de que esos números sean inválidos, solo que no se registró el año.
- **`Plano DGI`**: usa literalmente `"-"` como placeholder (33% de las filas) además de blanco.
- **`Aptitud`**: código líder `0` (`"0-NO DETERMINADA."`, 93% de las filas) significa sin determinar; cualquier otro código conserva el texto legible.

### Deduplicación — análisis de laboratorio, no un pozo "duplicado"

18 `wellId` aparecen más de una vez en el CSV (0.15% de las filas). 1 es un duplicado exacto fila-por-fila (se descarta). Los otros 17 son el mismo pozo con **análisis de laboratorio distintos** — mismos datos de identificación/titularidad/técnica, difieren solo en columnas de calidad de agua. Se conservan **todos** los análisis distintos en `laboratorio.analisis[]`, sin asumir cuál es más reciente: no existe ningún campo de fecha para el análisis en las 106 columnas (`Nro. Análisis` es un identificador de laboratorio, no correlaciona con orden cronológico — verificado con valores como `950` y `166` para dos análisis del mismo pozo). De los 17 grupos, 9 terminan con más de un análisis realmente distinto tras la normalización; los otros 8 tenían un lado con todos los campos de laboratorio en cero/vacío, correctamente descartado como "sin análisis" en vez de contado como un segundo análisis real.

### Particionado de departamentos grandes

Medido contra Drive real (Apps Script, `getBlob().getDataAsString()` es el cuello de botella, no `JSON.parse`):

| Caso | Antes (archivo único) | Después (particionado) |
|---|---|---|
| Departamento chico/vacío | ~0.6-0.7s frío | sin cambios |
| Departamento 07 (~7MB) | ~3.5s frío | ~0.9-1.2s frío |
| Departamento 08 (~8.2MB) | ~4.7s frío | ~0.9-1.0s frío |
| Con `CacheService` (segunda lectura) | ~20-50ms | ~49-94ms |

Departamentos con más de `PARTITION_THRESHOLD` (3.000) pozos se parten en 10 archivos por el primer dígito de `Nro Pozo` (`07-0.json`..`07-9.json`, siempre los 10, aunque algunos queden vacíos `{}`) en vez de un único `DD.json`. El backend (`registryRepository_resolveFileName` en `RegistryRepository.js`) resuelve el nombre de archivo directamente desde el `wellId`, sin leer ningún índice adicional — por eso la lista de departamentos particionados (`PARTITIONED_DEPARTMENTS`) vive como constante hardcodeada en ese archivo y tiene que actualizarse a mano si cambia el resultado del indexador en una corrida futura (el CLI de `scripts/reindex_pozos.py` lo recuerda explícitamente al final de cada corrida). Con el reporte actual, solo 07 y 08 superan el umbral.

### Independencia de capas

La Ficha del Pozo (`getWellRecord`) y el visor ITF (`getProfile`) son acciones de API completamente independientes: un `wellId` puede tener uno, otro, ambos o ninguno, y una falla en una nunca bloquea ni condiciona a la otra. Comparten únicamente la validación de sesión+formato de `wellId` (`validateSessionAndWellId` en `Api.js`), no lógica de negocio.
