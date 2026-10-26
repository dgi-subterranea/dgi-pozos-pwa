# Roadmap

## V0 — Prueba técnica (CERRADA — GO)

Objetivo cumplido: validar la cadena `GitHub Pages → Google Sign-In → Apps Script → sesión propia → Drive → imagen real` en Android y iPhone (incluida la PWA instalada en modo standalone), antes de construir el producto.

Resultado: **GO de arquitectura**. Ningún eslabón obligó a cambiar de plataforma ni a introducir Cloudflare. El único punto que no cumplía el objetivo de performance (entrega de imagen vía base64 para archivos grandes) tiene una causa raíz identificada y una solución acotada en curso (ver V1 más abajo) que no requiere rediseñar nada de lo ya validado.

Descartado explícitamente durante V0: entrega de imagen vía `doGet` + `Blob` directo — no soportado por la plataforma (Apps Script Web Apps solo puede devolver `HtmlOutput`/`TextOutput`). Código eliminado del proyecto; detalle en `docs/architecture.md`.

## V1 — Consulta de perfiles ITF (CERRADA — tag `v1.0.0`, 2026-08-27)

**Optimización de imágenes**: decisión tomada el 2026-08-27 — se descarta por ahora. V1 usa la carpeta `THUMB` actual tal cual (no `THUMB_WEB`), sin reprocesar el corpus, porque los archivos reales ya son livianos (37-170 KB). Queda documentado como mejora opcional/no bloqueante para más adelante si el corpus crece con archivos más pesados.

**Backend (migrado en pasos, cada uno verificado en dispositivo real antes de avanzar) — completo:**
1. ✅ Reestructuración en capas (`Api`/`AuthService`/`ProfileService`/`DriveProfileRepository`/`Config`), sin cambiar comportamiento.
2. ✅ Allowlist real (`SheetUserRepository` + `USER_DISABLED`, cache de 5 min).
3. ✅ Historial de auditoría (`SheetHistoryRepository`/`HistoryService`) para `login` y `getProfile`.

**Rate limiting: NO forma parte de V1.0.** Decisión explícita y ratificada (2026-08-27): no se implementa `RateLimiter.js`, no hay contadores en `CacheService`, no se emite `RATE_LIMITED`. Queda únicamente como mejora opcional para una V1.x futura — no es un pendiente de `v1.0.0` ni bloquea el tag.

**Frontend:**
- ✅ Máquina de estados completa (8 estados, incluida pantalla de "sin conexión" en el arranque), sin restos de la UI de diagnóstico de V0.
- ✅ `manifest.json` + `sw.js` (app shell, estrategia network-first con fallback a cache, offline verificado en dispositivo real).
- ✅ Validación/normalización de `wellId` sin ambigüedad + rango de departamento 01-19 (frontend y backend) — corrige bugs detectados en pruebas de campo (`112`→ambiguo, `000012`→departamento inválido, etc.), ver `docs/architecture.md`.
- ✅ Enmascarado de input consistente en Android/iPhone, con preservación de la posición del cursor.
- ✅ Google Identity Services con init programático — corrige el prompt de "One Tap" apareciendo aun con sesión ya recuperada.
- ✅ Botón de limpiar (`×`) en el input, botón "Guardar/Compartir" en iOS (Web Share API con fallback), UX de arranque medida y validada (~1.3-2.2s según plataforma).

**Tests: completo.** 76 tests (Jest) — `wellIdValidator` (41), `sw.js`/lista de archivos cacheados (9), `AuthService` (15), `ProfileService`/`Api.handleGetProfile` (11).

**Documentación: completa.** `README.md` actualizado para V1 (antes describía V0), `CHANGELOG.md` creado, este roadmap y `docs/architecture.md` al día.

**Fix final antes del tag**: la celda `wellId` de "Historial" se forzaba a texto plano (`setNumberFormat('@')`) porque Sheets reinterpretaba `01-0012` como fecha/número — confirmado con una fila real antes de cerrar V1.

Los 21 criterios de aceptación quedaron verificados (checklist en `docs/architecture.md`). Próxima etapa: **diseño visual/estético y UX**, sin tocar la lógica ya validada de V1.

## V1.1 — Diseño visual/UX y sesión persistente (CERRADA — tag `v1.1.0`, 2026-09-10)

Etapa exclusivamente de diseño visual/UX sobre V1.0 ("Acequia Profesional"), más un cambio funcional acotado en persistencia de sesión pedido por el usuario durante la misma etapa. Sin pantallas ni fuentes de datos nuevas.

**Diseño visual/UX — completo:**
- ✅ Paleta y tipografía definitivas (azul institucional dominante, acento terracota puntual, monoespaciada para `wellId`).
- ✅ Logo oficial de IRRIGACIÓN incorporado con la geometría exacta del SVG provisto (recoloreado vía `currentColor`, sin redibujar): grande en el login, chico y discreto al pie del resto de pantallas, oculto en el estado vacío del buscador.
- ✅ Ícono de PWA nuevo (gota).
- ✅ Botón de limpiar (`×`) y "Salir" aplanados a icono/link de texto puros, sin cápsula ni sombra heredada del `.button` genérico.
- ✅ Estados vacío/no encontrado/offline aligerados, imagen de perfil sin borde duro, composición propia para desktop.
- ✅ Placeholder de carga para el botón de Google Identity Services (causa raíz medida: 3 requests secuenciales al dominio de Google, agravado por el `<script>` sin `async`), con timeout y reintento — corrige una demora de varios segundos observada en iPhone real tras reinstalar la PWA.

**Sesión (cambio funcional, no solo visual):**
- ✅ Sesión rolling/sliding: `sessionToken` pasa de 12h fijas a 30 días, renovado silenciosamente en cada `checkSession` exitoso. En uso periódico la sesión se mantiene indefinidamente; sin uso por 30 días completos, o al tocar "Salir", pide login de nuevo. Firma HMAC y verificación de expiración sin cambios; un usuario deshabilitado sigue perdiendo acceso aunque tenga un token vigente.

**Tests: 77** (76 de V1.0 + 1 nuevo para la renovación rolling de `checkSession`).

Verificado en dispositivo real (iPhone): login, placeholder de Google y persistencia de sesión funcionando correctamente. Detalle completo en `CHANGELOG.md`.

## V1.2 — Historial visible

Pantalla "mis consultas" para el usuario. Sin fuentes de datos nuevas.

## V2 — Ficha del Pozo (EN CURSO)

Módulo nuevo e independiente del ITF (`RegistryRepository`/`RegistryService`), a partir del Reporte de Pozos real exportado del sistema interno (106 columnas, no un esquema hipotético). Detalle de diseño (modelo de datos, agrupación de campos, normalización) en `docs/architecture.md`.

**Etapa 1 — Indexador (CERRADA):**
- ✅ `scripts/reindex_pozos.py`: CSV real (ISO-8859-1, 106 columnas) → 19 archivos `01.json`..`19.json` (siempre los 19, vacíos `{}` si no hay registros) + `metadata.json` (fecha de generación, período de la fuente, conteos por departamento).
- ✅ Normalización campo por campo (no una regla genérica `0=null`), con excepciones evidenciadas contra el CSV real — ver `docs/architecture.md` para la tabla completa.
- ✅ Deduplicación: un único duplicado exacto se descarta; los análisis de laboratorio distintos del mismo `wellId` se conservan todos en `laboratorio.analisis[]`, sin asumir cuál es más reciente (no existe ningún campo de fecha para el análisis en el reporte).
- ✅ El CSV fuente y la salida del indexador quedan fuera del repo (`.gitignore`) — contienen datos personales reales.

**Etapa 2 — Backend (CERRADA):**
- ✅ `RegistryRepository`/`RegistryService`/`Api.handleGetWellRecord` (acción `getWellRecord`), validación de sesión+wellId compartida con `handleGetProfile` vía `validateSessionAndWellId`.
- ✅ La Ficha del Pozo es independiente del ITF: un `wellId` puede tener uno, otro, ambos o ninguno — nunca se bloquean entre sí.
- ✅ **Particionado de departamentos grandes**: medido contra Drive real, leer el JSON completo de un departamento de ~7-8MB (07, 08) tardaba 3.5-4.7s en frío. Se parten en 10 archivos por el primer dígito de `Nro Pozo` (`07-0.json`..`07-9.json`), resuelto por el backend directamente desde el `wellId` sin índice adicional. Verificado de nuevo tras el particionado: ~0.9-1.2s en frío — problema resuelto, sin seguir optimizando sin evidencia adicional.
- ✅ `RegistryService` limpia recursivamente las claves `null` de la respuesta antes de mandarla por la red.
- ✅ Evento de auditoría `getWellRecord` en Historial, mismo mecanismo que `getProfile`.
- ✅ 96 tests (Jest) + 65 tests (Python, `unittest`).

**Etapa 3 — Frontend: pendiente.** Integración visual de la Ficha del Pozo junto al visor de ITF existente, sin romper ninguno de los dos.

## V3 — Niveles estáticos

Última medición + serie histórica (tabla y gráfico).

## V4+ (backlog, no comprometido)

Ubicación/mapas, panel admin real, exportación PDF/CSV, comparación entre pozos, favoritos, búsqueda avanzada, etc.

## Fase futura (SOLO documentada; sin código) — ITF colaborativos / carga validada de perfiles

**Objetivo:** si un pozo **no** tiene ITF / perfil disponible y la persona tiene el permiso adecuado, poder **presentar un archivo** para que un validador lo revise y, si corresponde, lo publique como ITF del pozo.

**Permisos tentativos, separados** (no se reutiliza el permiso `perfil` existente, que solo es de consulta): `perfil_subir` (presentar) y `perfil_validar` (revisar y publicar).

**Flujo futuro:**
1. **SUBIR** → queda **PENDIENTE** (nunca visible para consulta).
2. **APROBAR / RECHAZAR** por quien tiene `perfil_validar` (rechazo con motivo obligatorio).
3. **OPTIMIZAR / REDUCIR** el archivo (versión liviana para consulta).
4. **PUBLICAR como ITF del pozo** y actualizar el índice / base de ITF.

**Reglas:**
- Nunca se publica directamente una subida.
- Nunca se reemplaza en silencio un ITF existente (un reemplazo sería otra solicitud, con revisión).
- Se conserva la **auditoría del original presentado** (quién, cuándo, hash) aunque se publique una versión optimizada.
- Al aprobar se genera la versión optimizada para consulta y se actualiza el índice.
- Reutilizar los patrones ya probados: indicador en el hub, cola de revisión, aviso por mail con reserva de cuota, auditoría en Historial, hoja append-only con eventos y estado derivado, idempotencia por `clientRequestId`, caché de lectura con invalidación.
- Estudiar primero **JPG / PNG / WebP**; evaluar **PDF / HEIC** aparte (conversión y tamaño).
- **Costo mensual $0 obligatorio** (sin servicios de pago): la optimización debe resolverse en el navegador o con las cuotas gratuitas ya usadas.

Estado: **idea documentada, sin diseño técnico ni implementación.** Antes de empezar hay que definir almacenamiento, límites de tamaño, formato definitivo y quién valida.

## Fase futura (SOLO documentada; sin código) — Fotos colaborativas / moderadas

**Objetivo:** aplicar a las fotos de los pozos un patrón equivalente al de las ubicaciones (decisiones directas para quien valida, sugerencias para quien no, cola de revisión).

- Una persona autorizada puede **retirar / descartar** una foto; quien no tiene permiso de validación puede **sugerir** retirarla o descartarla.
- Quien tiene el permiso adecuado puede **proponer / subir una foto nueva**; la subida incluye **observación / contexto**.
- La foto nueva queda **PENDIENTE**; un validador la **APRUEBA o RECHAZA**; recién al aprobar se **publica** en la ficha del pozo.

**Principio:** nunca se borra físicamente ni se pierde en silencio una foto original. Estados conceptuales: **Publicada**, **Descartada / retirada de publicación** y **Pendiente**, siempre con auditoría. Para las fotos nuevas: se conserva el archivo presentado, se genera una **versión optimizada** para la app, se registran autor, fecha, observación y validador, y **no se reemplaza en silencio** una foto existente (un reemplazo es otra solicitud con revisión).

**Permisos:** a definir más adelante, **después de auditar los permisos actuales de fotos** (no se inventan ahora).

**Relacionado:** «Fotos — guardado parcial cuando falta metadata» (más abajo, requiere aclaración funcional) y la miniatura en los resultados de Buscar reemplazo.

Estado: idea documentada, sin diseño técnico ni implementación.

## Observaciones generales del pozo (E5) — CERRADA / PRODUCCIÓN (24/10/2026)

**Objetivo:** una sección propia en la ficha, **«Observaciones del pozo»**, **separada** de «Evaluar para reemplazo», para comentarios generales sobre la perforación: acceso, estado físico, funcionamiento, surgencia, información informada por el propietario, anomalías observadas en campo y cualquier dato útil que no sea una evaluación de reemplazo.

**Modelo deseado:** cronológico; cada observación con **autor**, **fecha / hora** y **texto**; **append-only / auditable**. No se editan en silencio las observaciones históricas: si hace falta corregir o retirar una, se hace con un **evento o estado auditable**.

**A evaluar más adelante:** categorías, adjuntos / fotos (en relación con la fase de fotos), permisos para comentar y visibilidad interna / pública.

Estado: **E5 CERRADA / PRODUCCIÓN (24/10/2026).** Backend en Apps Script **v45** (deployment productivo existente, URL `/exec` sin cambios) y frontend en GitHub Pages = `6720cf3`. Etapas: E5-1 lectura / modelo (`def2839`), E5-2 alta backend (`1939f5f`), E5-3 anulación backend (`6e81803`), E5-4 lectura frontend (`c806e2f`), E5-5 alta frontend (`f0e5113`), E5-6b `puedeAnular` (`40e7669`), E5-6 anulación frontend (`6720cf3`) y E5-7 rollout. Smoke real en el pozo 14-0006 (lectura vacía, alta, `puedeAnular`, anulación, persistencia tras recargar; append-only) y regresión de solo lectura de los módulos existentes sin hallazgos. Rollout de permisos inicialmente limitado a una cuenta controlada. Detalle, preparación y deuda no bloqueante en `docs/observaciones-pozo.md`.

## Línea de tiempo del pozo (E6) — CERRADA / PRODUCCIÓN (26/10/2026)

**Objetivo:** una vista cronológica única, de solo lectura, que junta lo que estaba repartido en varias pantallas: **ubicación** (correcciones y decisiones sobre fuentes), **evaluaciones de reemplazo** y **observaciones**. Sin datos, hojas, permisos ni endpoints nuevos: se arma en el cliente con las lecturas existentes, cada una con su permiso. **Fotos queda fuera de v1** (`getFotosPozo` no expone fecha de alta ni autor).

**Estado:** **E6 CERRADA / PRODUCCIÓN (26/10/2026).** Frontend en GitHub Pages; backend en Apps Script **v45**, sin cambios y sin `gas:*`. Etapas: E6-1 modelo de eventos (`f48ac7c`), E6-2 cargador con paginación y fallos parciales (`1063474`), E6-3 tarjeta del hub y pantalla con filtros (`8d481e6`), E6-4 rollout frontend (realizado), E6-4b ajuste responsive del hub (`6201f82`). **E6-5 (endpoint agregado) NO necesaria:** las cuatro fuentes cargan en paralelo y la latencia real en 14-0001 (5 aperturas: mín 2183 ms, mediana 2933 ms, máx 4387 ms) es razonable. Smoke real en 14-0001, 14-0006 (la anulación nunca muestra el texto original, ni a un moderador), 14-0002 (vacío verdadero) y 14-0123 (fuera del padrón, sin error). Detalle, contratos y decisiones en `docs/linea-tiempo-pozo.md`.

## Exportación de «Mi selección» a Excel (E7) — CERRADA / PRODUCCIÓN (26/10/2026)

**Objetivo:** descargar a XLSX los pozos que el usuario ve en la tabla de «Mi selección» (después de búsqueda, filtro de aptitud y orden), solo con datos operativos y técnicos.

**Estado:** **E7 CERRADA / PRODUCCIÓN (26/10/2026).** Frontend en GitHub Pages; backend en Apps Script **v45**, sin cambios y sin `gas:*`. Etapas: E7-1 auditoría y diseño (XLSX elegido sobre CSV); E7-2 lógica pura de exportación y escritor XLSX, con ITF por lotes de 500 (`958606a`); E7-3 botón «Exportar Excel (N)», snapshot al clic y descarga (`010fa6d`); E7-4 rollout + smoke real. Sin datos personales (titular y NC16 fuera de v1), sin permiso nuevo (columnas por permiso `=== true`: `ubicacion`, `perfil`, `ne`, `reemplazo`), sin pantalla nueva y sin `registrarExportacion`. ITF en lotes de 500 con concurrencia 3; un lote caído deja la celda «Tiene ITF» vacía, nunca «No». Validado con openpyxl y con Excel real (es-AR), y responsive en 375 px y escritorio. **Safari / iPhone: no probado** (sin dispositivo). Deuda no bloqueante: comportamiento previo de `perfil` truthy en la tabla; helper legacy `seleccionController_asegurarDisponibilidadItf()` (solo tests); auditoría específica antes de exportar datos personales; reportes batch de Reemplazo / Observaciones requerirán backend. Detalle en `docs/exportacion-seleccion.md`.

## Fase futura (SOLO documentada; sin código) — QR + NFC por pozo

**Idea:** cada perforación puede tener un sticker o cartel físico con **QR** y, opcionalmente, **NFC**. QR y NFC apuntan a **la misma URL estable**; al escanear o tocar se abre una ficha del pozo **preparada para ese acceso**.

**Visibilidad:** solo se muestra información **expresamente habilitada como visible**; no se expone automáticamente la ficha interna. Se diseñará una **vista pública / compartible separada**. Para la ubicación rige el principio «Visibilidad pública de la ubicación» (más abajo): se publica únicamente el punto operativo autorizado.

**Preferencias de arquitectura:**
- **Token público opaco por pozo**: el `wellId` **no** es una credencial.
- Token **revocable**, **URL estable y corta**; el **QR lo genera el sistema** y la **misma URL** se escribe en el NFC.
- Un **NTAG213** debería alcanzar si la URL es corta.
- **Controles por campo** (padrón visible, ubicación visible, foto, estado, profundidad, observaciones públicas, contacto / instrucciones, etc.) con configuración **fail-closed**: si un dato no está expresamente habilitado, no se publica.

**A pensar:** regenerar / revocar el token, reimprimir el QR, NFC perdido o dañado, auditoría y un cartel resistente para el campo.

Estado: idea documentada, sin diseño técnico ni implementación.

## Principio de diseño — Visibilidad pública de la ubicación

Para toda futura vista pública o externa (incluida la de QR / NFC):

> **La complejidad y la trazabilidad de las fuentes son internas; la vista pública expone únicamente la ubicación operativa autorizada.**

- Una persona pública / externa **no ve** los estados ni la mecánica interna: validada, aceptada, coincidente, propuesta, descartada, sugerencias, fuentes, ni sus autores o motivos.
- Ve **solamente el PUNTO OPERATIVO publicado**, y solo si está expresamente habilitado (fail-closed, igual que el resto de los campos públicos de «QR + NFC por pozo»).
- Hoy todas las vistas de la app requieren sesión, así que esto **no cambia nada existente**: es una regla para cuando se diseñe la vista pública.

**A definir en su momento:** qué se muestra si un pozo no tiene ubicación operativa autorizada (lo esperable: nada) y con qué precisión se publica el punto.

Estado: principio registrado, sin diseño técnico ni implementación.

## Fase futura (SOLO documentada; sin código) — Ubicación validada reemplazada por otra mejor

**Caso:** «¿Qué pasa si después aparece una ubicación más correcta que la actualmente validada?»

**Principio deseado:**
- Ninguna validación borra a la anterior.
- Una validación posterior puede pasar a ser la **vigente**.
- Se conserva el historial completo; la anterior queda **superada / reemplazada** de forma auditable.

**Ya contemplado (a revisar antes de crear nada nuevo):** `UbicacionCorrecciones` ya modela esto: una sola `VALIDADA` vigente por pozo, el evento `SUPERADA` se escribe automáticamente al validar otra del mismo pozo, el historial se conserva y revertir no revive a la superada (ver `docs/ubicacion-correcciones.md`, «Estado vigente»).

**Por revisar en la futura fase:** si el flujo actual alcanza para este caso o solo falta experiencia de uso (por ejemplo, mostrar la vigente junto a la nueva para compararlas, avisar qué se va a superar y cómo se ve en ficha y mapa), y cómo se relaciona con lo que traiga la integración de decisiones de fuentes en el mapa (Etapa 3).

Estado: idea documentada; probablemente ya soportada en el backend. Falta auditar.

## Fase futura (SOLO documentada; sin código) — Buscar pozo para reemplazo: UX y performance

Se registran **objetivos y problemas**; no se diseña ninguna solución todavía.

- **Más filtros** en la búsqueda (cuáles: sin definir; ver «Filtros hidrogeológicos» y «Departamento vs Cuenca» más abajo).
- **Foto / miniatura del pozo en los resultados**, cuando exista. Ya hay miniaturas y entrega por proxy (`docs/fotos-pozos.md`); el problema a resolver es no sumar una llamada por resultado.
- **Motivo obligatorio al evaluar un pozo para reemplazo.** Ya existe un campo de motivo según el estado en `js/reemplazo.js`; falta auditar en qué estados hoy es obligatorio antes de cambiar la regla.
- **Búsqueda más inteligente.** *Requiere aclaración funcional:* qué significa «inteligente» (tolerancia al escribir, orden por relevancia, sugerencias, etc.).
- **Mejor diseño visual de los resultados.**
- **Optimizar el tiempo de respuesta** de la búsqueda por área / radio. Primero medir con datos reales (mismo criterio que el particionado de la Ficha del Pozo); no optimizar a ciegas.
- **Navegación clara «Ir a inicio»** desde esta pantalla. No se verificó la navegación actual en todas las pantallas.

Estado: idea documentada, sin diseño técnico ni implementación.

## Fase futura (SOLO documentada; sin código) — Fotos: guardado parcial cuando falta metadata

**Idea:** poder guardar una foto aunque algún dato complementario asociado no esté disponible o no pueda obtenerse; que la falta de metadata **no esencial** no bloquee necesariamente la carga. En el futuro hay que definir qué metadata es **obligatoria** y cuál **opcional**.

> **Requiere aclaración funcional antes de implementar.** No está claro a qué dato se refiere (fecha, GPS / EXIF, fuente, observación, vínculo con el pozo) ni si aplica a la carga desde la app o a importaciones. Hoy la importación ya tolera fechas parciales (`docs/fotos-pozos-importacion.md`), pero no se sabe si la idea apunta a eso.

Relacionado con «Fotos colaborativas / moderadas». Estado: idea pendiente de aclarar.

## Backlog de búsqueda, mapa y datos (por auditar; sin campos ni diseño definidos)

- **Filtros hidrogeológicos** en la búsqueda y el mapa. **No se definen campos todavía:** primero auditar qué atributos reales existen en el padrón y los datasets. Lo que ya se conoce del dataset del mapa (cuenca, profundidad, tramos filtrantes, surgencia; ver `docs/ubicacion-correcciones.md`) es un punto de partida, no una decisión.
- **Niveles del Atuel.** Incorporar y publicar los niveles disponibles correspondientes al Atuel. Antes de implementar: revisar **fuente, formato, periodicidad y permisos**. No figura hoy en la documentación del proyecto; se relaciona con V3 (Niveles estáticos).
- **Departamento vs Cuenca (bug / mejora).** Revisar qué pasa cuando se elige Departamento y Cuenca a la vez (hay filtros de ambos en el mapa y en Buscar reemplazo). Evitar combinaciones incompatibles: idealmente se filtran dinámicamente las opciones válidas o se muestra un mensaje claro, y **nunca se devuelven resultados incoherentes en silencio**. *Falta reproducir con un caso concreto antes de decidir la solución.*
- **Estado «Coincidente» en Monitoreo / Relevamiento.** Revisar los casos de monitoreo y relevamiento y cuándo deben considerarse «coincidentes». **No cambiar la semántica actual** (`C` = 2 o más fuentes del padrón coinciden; no es una validación humana, ver `docs/ubicacion-correcciones.md`) sin auditar antes los datasets y las reglas existentes. *Requiere revisión funcional.*

Estado: ideas documentadas, sin diseño técnico ni implementación.

## Relación entre estas ideas y las fases ya registradas

No se duplica nada: ITF colaborativos, fotos colaborativas / moderadas, observaciones del pozo y QR + NFC público quedan como están. Las ideas nuevas se enlazan así: la visibilidad pública de la ubicación y el QR + NFC comparten la regla fail-closed; el guardado parcial de fotos y la miniatura en Buscar reemplazo dependen de la fase de fotos; la ubicación validada reemplazada se apoya en `UbicacionCorrecciones` y en las sugerencias / decisiones auditables de fuentes ya implementadas.
