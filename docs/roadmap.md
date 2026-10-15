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

Estado: idea documentada, sin diseño técnico ni implementación.

## Fase futura (SOLO documentada; sin código) — Observaciones generales del pozo

**Objetivo:** una sección propia en la ficha, **«Observaciones del pozo»**, **separada** de «Evaluar para reemplazo», para comentarios generales sobre la perforación: acceso, estado físico, funcionamiento, surgencia, información informada por el propietario, anomalías observadas en campo y cualquier dato útil que no sea una evaluación de reemplazo.

**Modelo deseado:** cronológico; cada observación con **autor**, **fecha / hora** y **texto**; **append-only / auditable**. No se editan en silencio las observaciones históricas: si hace falta corregir o retirar una, se hace con un **evento o estado auditable**.

**A evaluar más adelante:** categorías, adjuntos / fotos (en relación con la fase de fotos), permisos para comentar y visibilidad interna / pública.

Estado: idea documentada, sin diseño técnico ni implementación.

## Fase futura (SOLO documentada; sin código) — QR + NFC por pozo

**Idea:** cada perforación puede tener un sticker o cartel físico con **QR** y, opcionalmente, **NFC**. QR y NFC apuntan a **la misma URL estable**; al escanear o tocar se abre una ficha del pozo **preparada para ese acceso**.

**Visibilidad:** solo se muestra información **expresamente habilitada como visible**; no se expone automáticamente la ficha interna. Se diseñará una **vista pública / compartible separada**.

**Preferencias de arquitectura:**
- **Token público opaco por pozo**: el `wellId` **no** es una credencial.
- Token **revocable**, **URL estable y corta**; el **QR lo genera el sistema** y la **misma URL** se escribe en el NFC.
- Un **NTAG213** debería alcanzar si la URL es corta.
- **Controles por campo** (padrón visible, ubicación visible, foto, estado, profundidad, observaciones públicas, contacto / instrucciones, etc.) con configuración **fail-closed**: si un dato no está expresamente habilitado, no se publica.

**A pensar:** regenerar / revocar el token, reimprimir el QR, NFC perdido o dañado, auditoría y un cartel resistente para el campo.

Estado: idea documentada, sin diseño técnico ni implementación.
