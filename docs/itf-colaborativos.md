# ITF colaborativos (E9): propuesta, validación y vigente

Estado: **E9-2 (dominio puro + repositorio + tests; NO productivo).** No hay endpoints, ni permisos nuevos en `Usuarios`, ni hoja `ItfEventos` en producción, ni interfaz, ni cambios en Drive. El Perfil ITF funciona **exactamente igual que antes**. La función `setupItfEventosSheet()` está escrita y probada pero **NO se ejecutó** (se corre a mano en el rollout, E9-8).

Etapas: E9-1 (auditoría y diseño, cerrada) → **E9-2 (este documento: modelo, dominio, repositorio, tests)** → E9-3 (propuestas: backend) → E9-4 (validación y versionado: backend) → E9-5 (interfaz del Perfil) → E9-6 (cola de validadores) → E9-7 (baseline y migración si hiciera falta) → E9-8 (rollout).

## 1. Decisiones cerradas

| # | Decisión |
|---|---|
| 1 | E9 v1 trabaja con **imágenes JPEG y PNG**. **NO PDF.** No se asume que exista un PDF institucional original accesible; si se demuestra, será una evolución explícita. |
| 2 | **Autoaprobación permitida** a quien tiene `perfil_subir` y `perfil_validar`, pero **nunca implícita**: siempre dos acciones y dos eventos (`ITF_PROPUESTO` y después `ITF_APROBADO`), cada uno con su `eventoId`, su secuencia y su `clientRequestId`. No existe una acción «proponer y aprobar». La derivación marca `autoaprobado` sin crear un estado especial. |
| 3 | Alcance de E9 v1 = **C3 acotado**: proponer un ITF faltante, aprobar / rechazar, proponer una nueva versión, reemplazar el vigente, conservar el anterior como histórico, vigente inequívoco, auditoría. |
| 4 | **Una sola hoja append-only: `ItfEventos`.** La fila del evento de propuesta lleva también la metadata inmutable del documento. No hay `ItfDocumentos`. |
| 5 | **Baseline legacy:** el `<wellId>.jpg` actual es el **vigente legacy implícito**. Sin migración masiva, sin hashear miles de archivos, sin mover la carpeta. |
| 6 | **«Tiene ITF» = existe un ITF VIGENTE.** Una propuesta pendiente no cuenta. |
| 7 | Las cargas manuales directas a la carpeta legacy quedan **fuera del flujo institucional**: no se bloquean técnicamente, pero no deben usarse (ver §10). |

## 2. Arquitectura actual del Perfil ITF (auditada en E9-1, no cambia)

- El ITF de hoy es **una imagen JPEG por pozo**, `<wellId>.jpg` (formato `DD-PPPP`), en **una carpeta plana de Drive** (`FOLDER_ID`, la cuenta que despliega el backend). Son derivados comprimidos de unos 37–170 KB; los escaneos originales (del orden de 6668×5191) viven fuera del repo y se reducen con `scripts/batch_compress.py`.
- Existencia: búsqueda exacta por nombre (`getFilesByName`). Disponibilidad en lote (`getItfAvailability`, hasta 500 pozos): índice en `CacheService` por departamento (1 hora de TTL) que se reconstruye entero ante cualquier bucket faltante.
- Descarga: `getProfile` devuelve la imagen en base64 dentro de JSON; el ZIP masivo se arma en el navegador (50 pozos por ZIP, concurrencia 3).
- No hay metadata por ITF (ni versión, ni hash, ni quién lo subió). El permiso `perfil` es de consulta; `perfil_subir` y `perfil_validar` **no existen** en el código ni en `Usuarios` (solo figuraban en `docs/roadmap.md`).
- Cada `getProfile` y cada lote de disponibilidad dejan una fila en `Historial`.

## 3. Mediciones de rendimiento (parte A de E9-2)

**No se pudo medir contra producción en esta etapa**: no hay una sesión autenticada disponible para el asistente (la app exige iniciar sesión con Google) y, además, cada llamada deja filas de auditoría en `Historial`. Se registra para no inventar cifras:

| Medición pedida | Resultado |
|---|---|
| Disponibilidad con caché fría / caliente | **No se midió** (sin sesión). |
| Disponibilidad de 1 pozo y de 500 pozos | **No se midió.** |
| `getProfile`: tiempo total, tiempo de Drive, tamaño | **No se midió** (el backend ya informa `elapsedMsEnDrive`). |
| Flujo de búsqueda de un pozo | **No se midió.** |
| Mi selección: ITF conocida vs. desconocida | Solo hay la medición **documentada en E7** (`docs/exportacion-seleccion.md`): 12 pozos ≈ 0,4 s con el ITF ya conocido; 700 pozos con el ITF desconocido ≈ 5,5 s en dos lotes (500 + 200); con el ITF ya conocido ≈ 0,13 s. |
| Reconstrucción del índice | **No se midió** (no se puede forzar de forma segura: solo ocurre con la caché vencida). |

Para obtenerlas queda listo **`scripts/medir_itf_consola.js`**: se pega en la consola del navegador con una sesión con `perfil`; mide disponibilidad (1 pozo, 500, 500 caliente, 700 en dos lotes) y `getProfile` (dos veces) y devuelve una tabla y un JSON para pegar en el chat. No escribe nada más que las filas de auditoría normales de la app y **no** llama a `registerDescargaItf` (sin avisos de Telegram).

### Quick wins: clasificación (sin implementar)

| Id | Propuesta | Clasificación | Motivo |
|---|---|---|---|
| Q1 | Renderizar la tabla de «Mi selección» antes de la disponibilidad ITF (columna «verificando…») | **Hacer antes del rollout E9** | Es solo frontend y de bajo riesgo; la lentitud percibida (≈ 5,5 s para 700 pozos) es de la espera, y E9 le suma trabajo al camino de disponibilidad. |
| Q2 | El hub decide si hay ITF con la disponibilidad y baja la imagen **solo al abrir el Perfil** | **Hacer antes del rollout E9** | Hoy cada búsqueda baja el JPEG completo en base64 solo para decidir si mostrar la tarjeta. E9 permite imágenes de hasta 3 MB (≈ 4 MB en base64): sin Q2, cada búsqueda podría bajar varios MB. |
| Q3 | No escribir una fila de `Historial` por cada `getProfile` dentro del ZIP (ya existe la auditoría resumida `registerDescargaItf`) | **Hacer antes del rollout E9** (decisión de auditoría explícita) | Cada fila cuesta 4 operaciones de Sheets por ITF; E9 suma además la lectura de eventos. Conviene decidir con las mediciones pendientes. |
| Q4 | Lock durante la reconstrucción del índice de disponibilidad | **Después** | Optimización (evita reconstrucciones duplicadas), no corrige un error. Se revisa con la medición del recorrido en frío. |
| Q5 | Disparador horario / índice materializado `wellId → vigente` | **Después, solo con evidencia** | Para E9 v1 basta con derivar en memoria a partir de **una** lectura de `ItfEventos` por pedido y, en E9-3, cachear esa derivación. Un índice materializado se justifica si las mediciones muestran un cuello. |

## 4. Modelo

### 4.1 Eventos (catálogo mínimo definitivo)

| Evento | Quién (futuro) | Qué hace |
|---|---|---|
| `ITF_PROPUESTO` | `perfil_subir` | Propone un archivo para un pozo. Lleva la **metadata inmutable** del documento. No cambia el vigente. |
| `ITF_APROBADO` | `perfil_validar` | La propuesta pasa a `VIGENTE`. Si el pozo ya tenía vigente, el **mismo evento** declara cuál reemplaza (`documentoReemplazadoId`): el anterior pasa a `REEMPLAZADO` en la misma fila. Reemplazar exige motivo. |
| `ITF_RECHAZADO` | `perfil_validar` | Una propuesta pasa a `RECHAZADO` (motivo obligatorio). Nunca será vigente. |
| `ITF_RETIRADO` | `perfil_validar` | Retira el vigente (el pozo queda `SIN_ITF`) o una propuesta pendiente. Motivo obligatorio. **No restaura nada.** |
| `ITF_REVERTIDO` | `perfil_validar` | Restaura un documento que **ya fue vigente** (`REEMPLAZADO` o `RETIRADO`). Si había otro vigente, lo declara en `documentoReemplazadoId` y ese pasa a `REEMPLAZADO`. |
| `ITF_LEGACY_REGISTRADO` | el backend | Registra, una sola vez y bajo demanda, la huella del archivo legacy justo **antes** del primer evento que lo reemplaza, retira o revierte (ver §5). |

No existe `ITF_REEMPLAZADO` como evento: lo declara la aprobación (o la reversión).

### 4.2 Esquema de `ItfEventos` (17 columnas, en este orden)

`eventoId | secuencia | evento | documentoId | wellId | documentoReemplazadoId | mimeType | bytes | sha256 | storageFileId | nombreOriginal | motivoCodigo | motivoTexto | email | nombre | timestampUtc | clientRequestId`

| Columna | Contenido |
|---|---|
| `eventoId` | UUID v4 del evento (lo genera el servidor). |
| `secuencia` | Entero global y monótono (máximo + 1 bajo `ScriptLock`). Es el **único** orden entre eventos; la fecha no ordena nunca. |
| `evento` | Uno de los 6 de §4.1 (exacto, en mayúsculas). |
| `documentoId` | UUID v4 **opaco** del documento (lo genera el servidor al proponer; estable toda la historia) o `LEGACY:<wellId>`. Nunca un id de Drive, un hash ni un nombre de archivo. |
| `wellId` | `DD-PPPP`, en **todos** los eventos (el servidor lo copia de la propuesta). La derivación exige que coincida con el pozo del documento. |
| `documentoReemplazadoId` | Solo en `ITF_APROBADO` / `ITF_REVERTIDO` cuando hay otro vigente: el que deja de serlo. Vacío en el resto. |
| `mimeType`, `bytes`, `sha256`, `storageFileId`, `nombreOriginal` | **Metadata inmutable.** Solo en `ITF_PROPUESTO` (y en `ITF_LEGACY_REGISTRADO`). En cualquier otro evento tienen que estar vacías: si no, la fila es corrupta. `storageFileId` es solo del backend. |
| `motivoCodigo`, `motivoTexto` | Catálogos de §6. Vacíos en propuesta, registro del legacy y primera aprobación. |
| `email`, `nombre` | Quién escribió el evento (sale de la sesión). El email se normaliza y es **solo backend**. |
| `timestampUtc` | ISO 8601 UTC con `Z` (se rechaza lo que no tenga fecha, hora y zona), guardado como texto. |
| `clientRequestId` | Idempotencia, único por usuario (`^[A-Za-z0-9_-]{8,64}$`). Vacío en `ITF_LEGACY_REGISTRADO`. |

Todas las columnas de texto se escriben como **texto plano** (`@`); `secuencia` y `bytes` con formato `0`. No se guarda base64, imagen, URL ni estado. Las columnas se buscan por el texto del encabezado (reordenarlas a mano no rompe nada); si falta alguna o hay una repetida, se lanza error.

### 4.3 Estados

- **Por documento (derivados):** `PROPUESTO`, `VIGENTE`, `REEMPLAZADO`, `RECHAZADO`, `RETIRADO`. «Histórico» es una **presentación** (un `REEMPLAZADO`, o un `RETIRADO` que alguna vez fue vigente), no un sexto estado. Un `RETIRADO` que nunca fue vigente es una propuesta retirada y no se muestra como histórico.
- **Por pozo:** `SIN_ITF`, `PENDIENTE` (no hay vigente pero sí propuestas pendientes), `VIGENTE`. **Puede haber `VIGENTE` + propuestas pendientes: lo pendiente nunca oculta ni reemplaza al vigente.**
- **Integridad:** `OK` | `NO_DERIVABLE`.

### 4.4 Transiciones

| Evento | Requiere | Efecto |
|---|---|---|
| `ITF_PROPUESTO` | documento nuevo | documento `PROPUESTO` |
| `ITF_APROBADO` | documento `PROPUESTO`; si hay vigente, declararlo; si no hay, no declarar nada | documento `VIGENTE`; el vigente anterior (si había) `REEMPLAZADO` |
| `ITF_RECHAZADO` | documento `PROPUESTO` | `RECHAZADO` |
| `ITF_RETIRADO` | documento `VIGENTE` o `PROPUESTO` | `RETIRADO`; si era el vigente, el pozo queda sin vigente |
| `ITF_REVERTIDO` | documento que fue vigente y está `REEMPLAZADO` o `RETIRADO`; si hay vigente, declararlo | el documento vuelve a `VIGENTE`; el vigente actual (si había) `REEMPLAZADO` |
| `ITF_LEGACY_REGISTRADO` | legacy sin registrar y ningún vigente E9 todavía | documento `LEGACY:<wellId>` en `VIGENTE` |

Siempre hay **0 o 1** vigente: aprobar B sobre A es **un solo evento** (no hay estado intermedio con 0 ni con 2). Reemplazar «en silencio» es imposible: si el pozo tiene vigente y el evento no lo declara, o declara otro, el pozo queda `NO_DERIVABLE`.

### 4.5 Integridad: fail-closed y por pozo

Un historial imposible **no inventa un vigente**: el pozo queda `NO_DERIVABLE` (y «Tiene ITF» = `DESCONOCIDO`, nunca `SI`). Casos cubiertos: secuencia duplicada o inválida; `eventoId` duplicado; evento desconocido; aprobar un documento inexistente, rechazado o ya aprobado; dos aprobaciones incompatibles; reemplazar algo que no era vigente; revertir a un documento inexistente o que nunca fue vigente; evento de otro `wellId` (`WELL_CRUZADO`); `documentoId` reutilizado con otra metadata o con la misma; metadata en un evento posterior; metadata inválida; timestamp, email o `clientRequestId` inválidos; `clientRequestId` repetido por el mismo usuario; registro del legacy duplicado o con vigente ya definido.

**Aislamiento:** el problema afecta solo al pozo (o a los pozos) involucrado. Los demás se derivan con normalidad, y un pozo sin eventos conserva el comportamiento legacy. Las filas que no se pueden atribuir a ningún pozo se informan como «globales» (diagnóstico) y no afectan a nadie. Si la **secuencia** de la hoja no se puede calcular (corrupción global), las lecturas siguen pero **ninguna escritura** se hace (igual que en E5 y E8).

## 5. Baseline legacy

- **Sin eventos E9, nada cambia:** el `<wellId>.jpg` existente es el vigente (implícito); si no existe, `SIN_ITF`; si Drive falló, `DESCONOCIDO`.
- **Identificador lógico del legacy:** `LEGACY:<wellId>` (determinista, **no** es un id de Drive ni un hash; puede mostrarse sin riesgo). No se crea ningún registro masivo.
- **Primer reemplazo.** El legacy no tiene `documentoId` ni huella. Cuando un evento tiene que referirlo (aprobar sobre él, retirarlo o revertirlo), el backend escribe **antes**, en la misma operación, un `ITF_LEGACY_REGISTRADO` con la huella del archivo en ese momento (`mimeType`, `bytes`, `sha256`, id de Drive, nombre). Así:
  - el legacy queda **referenciable** (`LEGACY:<wellId>`), **descargable como histórico** y **restaurable** (`ITF_REVERTIDO`);
  - se puede verificar que el archivo no cambió (la comparación de hash la hará el servicio de E9-3/E9-4; el dominio es puro);
  - si el corte ocurre entre las dos filas, el registro solitario es inofensivo (el legacy sigue vigente) y el reintento no lo duplica.
- **El archivo no se mueve ni se renombra nunca.** Restaurar el legacy exige que el archivo siga disponible.
- Una vez que el overlay E9 define el vigente, un archivo legacy suelto se **ignora** con la advertencia `LEGACY_IGNORADO`; un legacy retirado **no** vuelve solo a ser vigente aunque el archivo siga en la carpeta (restaurar es otra acción).
- **No se agrega el vigente E9 como fuente de `PozoExistenciaService`**: una propuesta no prueba que un pozo exista.

## 6. Catálogos de motivos (tentativos)

| Acción | Catálogo | Obligatoriedad |
|---|---|---|
| Rechazar | `NO_CORRESPONDE_POZO`, `INCOMPLETO`, `ILEGIBLE`, `DUPLICADO`, `VERSION_INCORRECTA`, `OTRO` | Código siempre; texto opcional salvo `OTRO` |
| Aprobar **reemplazando** un vigente | `ACTUALIZACION`, `CORRECCION`, `MEJOR_CALIDAD`, `DOCUMENTO_COMPLETO`, `OTRO` | Código siempre; texto opcional salvo `OTRO` |
| Aprobar sin vigente | — | **Sin** motivo |
| Retirar / Revertir | `ERROR_DE_APROBACION`, `DOCUMENTO_INCORRECTO`, `NO_CORRESPONDE_POZO`, `DESACTUALIZADO`, `OTRO` | Código siempre; texto opcional salvo `OTRO` |

El código se compara exacto (sin recortes ni mayúsculas). El texto se normaliza con la misma regla que Observaciones (E5) y la moderación de fotos (E8) y mide de 3 a 300 caracteres. Se ajustarán con casos reales.

## 7. Archivo, hash e idempotencia

- **Formatos:** `image/jpeg` e `image/png`, **verificados por los bytes reales** (JPEG `FF D8 FF`; PNG firma de 8 bytes + chunk `IHDR`). El MIME declarado tiene que coincidir con el contenido. Un PDF se rechaza (por MIME y por contenido). No es un antivirus ni verifica que la imagen se vea entera; no hay OCR.
- **Tamaño máximo: 3 MB (3.145.728 bytes)**, igual que el storage de Fotos. Evidencia: los ITF de consulta actuales pesan unos 37–170 KB; 3 MB admite una foto de celular sin obligar a mandar un escaneo gigante por una API que transporta base64 dentro de JSON. Archivo vacío: error propio.
- **SHA-256** de los bytes reales con `Utilities.computeDigest` (`itfArchivo_sha256Hex`, digest inyectable en los tests). Es factible para estos tamaños (decenas a cientos de KB; hasta 3 MB en el peor caso); **no se midió** el tiempo en Apps Script. El hash sirve para deduplicar, para la idempotencia y para la integridad; **nunca** es un id público ni el `documentoId`.
- **Idempotencia** (mismo `clientRequestId` del mismo usuario **y** mismo contenido): reintento exacto = el mismo resultado, sin evento nuevo ni secuencia nueva. Con otro contenido: `IDEMPOTENCY_CONFLICT`. Usuarios distintos pueden reutilizar el id; el email se normaliza.
- **Duplicado documental** (mismo `sha256`) es otra cosa y se decide **después** de la idempotencia:
  - mismo hash + mismo pozo, mientras esté propuesto, vigente, reemplazado o retirado tras ser vigente → `DUPLICADO_DOCUMENTO` (para volver a un documento anterior se usa `ITF_REVERTIDO`);
  - mismo hash + **otro** pozo → se permite y se **marca** para revisión (`MISMO_HASH_OTRO_POZO`): un mismo escaneo pudo asociarse mal y justamente necesitar corrección;
  - un rechazado o una propuesta retirada **no** son una lista negra: se puede volver a proponer.
- **Varias propuestas pendientes por pozo:** sí, hasta 10 (tope defensivo ajustable); nunca dos idénticas por hash.

## 7 bis. Concurrencia

Todo dentro de un `ScriptLock`: buscar `clientRequestId` → leer todos los eventos → derivar → planificar → escribir (uno o dos eventos consecutivos en **una** operación). El validador manda el vigente que **vio** (`documentoReemplazadoId`); si cambió mientras tanto, `VIGENTE_CAMBIO` y no se escribe nada. Casos: dos propuestas al mismo pozo (conviven); dos validadores aprueban propuestas distintas (el segundo falla con `VIGENTE_CAMBIO` y debe reemplazar explícitamente); aprobar y rechazar a la vez (gana el primero; el segundo recibe `DOCUMENTO_NO_PROPUESTO`).

## 8. Permisos futuros (no existen todavía)

`perfil_subir` (proponer) y `perfil_validar` (aprobar, rechazar, retirar, revertir). Cada uno **exige `perfil === true`** y se compara con `=== true`. Con ambos se puede aprobar lo propio (§1). No se agregan a `Usuarios` ni a `Auth` en esta etapa; el permiso `perfil` sigue gobernando la consulta y el acceso a Pozos Provincia.

## 9. Lo que ve cada rol (DTO)

- **Lectura (`perfil`):** `tieneItf` (`SI` / `NO` / `DESCONOCIDO`), `estado` y el vigente (`documentoId`, `origen`, tipo, bytes, vigente desde). Nada de propuestas, rechazos, historial, nombres de personas, hash ni ids internos.
- **Validador (`perfil_validar`):** además, pendientes, históricos, rechazados, retirados, historial con nombres (los que parecen un email se muestran como «Usuario»), `autoaprobado`, la marca de revisión y una **huella corta** (12 caracteres) del hash.
- **Nunca** hacia el cliente: email, `storageFileId`, hash completo, `clientRequestId`, secuencia, id de Drive.
- «Tiene ITF», ZIP, Mi selección y la descarga usan **solo el vigente** (`itfDominio_documentoParaDescarga`): ni propuestas, ni rechazados, ni históricos, ni retirados; y con un vigente E9 **no** se baja además el legacy.
- **Vigente interno ≠ público.** E10 necesitará una proyección pública separada (sin quién subió, validación, historia, Drive ni rechazos); `publicable` no se agrega todavía.
- Los eventos `ITF_APROBADO` / `ITF_REVERTIDO` son aptos para incorporarse más adelante a la Línea de tiempo del pozo (E6); no se hace en E9-2.

## 10. Cargas manuales a la carpeta legacy

Subir o reemplazar a mano un `<wellId>.jpg` en la carpeta de Drive **queda fuera del flujo institucional**: no tiene propuesta, ni validación, ni huella. No se bloquea técnicamente, pero **no debe usarse** una vez que E9 esté en producción: un archivo legacy que cambia en silencio puede dejar de coincidir con la huella registrada o ser ignorado si ya hay un vigente E9. Antes del rollout se comunicará a quienes cargan ITF.

## 11. Cambios respecto del diseño de E9-1

| Tema | E9-1 | E9-2 | Por qué |
|---|---|---|---|
| Eventos | 5 (`PROPUESTO`, `APROBADO`, `RECHAZADO`, `RETIRADO`, `REVERTIDO`) | **6**: se suma `ITF_LEGACY_REGISTRADO` | El legacy necesita huella para poder restaurarse y verificarse; se registra solo bajo demanda y sin migración masiva. |
| Estados de pozo | `SIN_ITF`, `PENDIENTE`, `VIGENTE` | igual | `PENDIENTE` solo cuando no hay vigente. |
| Aprobar sobre un vigente | motivo y versión | `documentoReemplazadoId` + motivo del catálogo | El mismo evento hace B vigente y A reemplazado. |
| Quién declara el vigente | el servidor | **el cliente declara el que vio** y el servidor lo contrasta (`VIGENTE_CAMBIO`) | Evita reemplazar algo que el validador no vio (concurrencia). |
| Propuestas por pozo | a evaluar | hasta 10, nunca idénticas por hash | Tope defensivo. |
| Retiro de una propuesta | no definido | `ITF_RETIRADO` sobre una propuesta pendiente | Cubre «retirar una propuesta» sin un evento más. |
| `HISTORICO` | estado posible | **presentación** de `REEMPLAZADO` / `RETIRADO` que fue vigente | No duplicar estados. |

## 12. Archivos y pruebas de E9-2

- `backend/src/ItfArchivoLogic.js`: validadores puros del archivo (JPEG/PNG, magic bytes, tamaño, SHA-256, nombre).
- `backend/src/ItfDominioService.js`: dominio puro (parseo, derivación, overlay legacy, estado de pozo, DTO, permisos, planificación de escrituras).
- `backend/src/ItfEventosRepository.js`: repositorio de `ItfEventos` y `setupItfEventosSheet()` (**NO ejecutada**).
- `scripts/medir_itf_consola.js`: medidor de consola para la parte A.
- Tests: `ItfArchivoLogic`, `ItfDominioService`, `ItfDominioPlanificar`, `ItfEventosRepository`, `ItfEventosE2E`, `ItfContrato` (en `backend/test/`), más el helper `itfHelper.js`.
- Los tres módulos son archivos más del proyecto Apps Script: **recién viajan a Apps Script en el próximo `gas:push`** (E9-8 o antes); no tienen disparadores ni efectos al cargarse.

## 13. Bloqueos y pendientes para E9-3

1. **Mediciones reales** de §3 (necesitan una sesión): decidir Q1–Q3 con cifras.
2. **Servicio orquestador** (lock → buscar `clientRequestId` → leer → derivar → planificar → escribir → invalidar caché) y su caché de la derivación.
3. **Storage de las propuestas** en la segunda cuenta (hoy solo acepta JPEG; falta PNG) con raíz privada y nombres generados.
4. **Huella del legacy** (`snapshot`): leer el `<wellId>.jpg`, calcular el SHA-256 y obtener su id de Drive, solo en el primer reemplazo; verificar que no cambió en cada restauración.
5. **Permisos reales** en `Usuarios` y `Auth` (`perfil_subir`, `perfil_validar`) y la guarda del frontend que hoy los prohíbe.
6. **Fuente de existencia del pozo** para proponer (padrón, NE, corrección previa o el ITF legacy actual; nunca la propuesta).
7. Decidir si quien propone puede retirar su propia propuesta (hoy solo un validador).
8. Medir en Apps Script el costo del SHA-256 y de la lectura completa de `ItfEventos`.
