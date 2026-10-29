# ITF colaborativos (E9): propuesta, validación y vigente

Estado: **E9-3 (servicio orquestador + proveedor legacy + contrato de storage; local, NO productivo)** sobre **E9-2 (dominio puro + repositorio + tests; commit local)**. No hay endpoints, ni permisos nuevos en `Usuarios`, ni hoja `ItfEventos` en producción, ni interfaz, ni cambios en Drive. El Perfil ITF funciona **exactamente igual que antes**. La función `setupItfEventosSheet()` está escrita y probada pero **NO se ejecutó** (se corre a mano en el rollout, E9-8).

Etapas: E9-1 (auditoría y diseño, cerrada) → E9-2 (modelo, dominio, repositorio, tests; cerrada) → **E9-3 (este documento, §14: servicio y proveedor legacy; local)** → E9-4 (propuestas y storage reales, cableado a `Api.js`) → E9-5 (interfaz del Perfil) → E9-6 (cola de validadores) → E9-7 (baseline y migración si hiciera falta) → E9-8 (rollout).

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
| 8 | **El proponente puede retirar SU PROPIA propuesta**, solo mientras siga `PROPUESTO` (ownership por el email normalizado del `ITF_PROPUESTO`, nunca por el nombre), con `perfil` + `perfil_subir` (sin `perfil_validar`), con el mismo `ITF_RETIRADO` y el motivo reservado `CANCELADO_POR_PROPONENTE` (sin texto obligatorio). Un validador retira cualquier propuesta pendiente (catalogo institucional); retirar un **vigente** es solo del validador. Detalle en 14.5. |

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

`perfil_subir` (proponer y retirar la propia propuesta pendiente) y `perfil_validar` (aprobar, rechazar, retirar cualquier propuesta o un vigente, revertir). Cada uno **exige `perfil === true`** y se compara con `=== true`. Con ambos se puede aprobar lo propio (§1). No se agregan a `Usuarios` ni a `Auth` en esta etapa; el permiso `perfil` sigue gobernando la consulta y el acceso a Pozos Provincia.

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

## 14. E9-3: servicio orquestador y proveedor legacy (local, NO productivo)

Objetivo: conectar el dominio de E9-2 con la arquitectura actual del Perfil **sin** subir documentos, sin endpoints de propuesta, sin permisos reales, sin hoja productiva, sin interfaz y sin deploy. Con **cero eventos E9** el resultado es el del ITF legacy de hoy.

### 14.1 Piezas

| Archivo | Rol |
|---|---|
| `backend/src/ItfService.js` | Orquestador. `itfService_resolverVigente(wellId)`, `itfService_getProfile(wellId)`, `itfService_disponibilidad(wellIds)`, `itfService_obtenerDocumento(documentoId)`, `itfService_ejecutar(sesion, comando, opciones)`, `itfService_pozoExiste(wellId)`. Todo con dependencias inyectables. No tiene reglas de dominio ni escribe `Historial`. |
| `backend/src/ItfLegacyProvider.js` | El único lugar nuevo que sabe resolver el `<wellId>.jpg`: existencia, archivo, disponibilidad en lote, huella y verificación. Usa `DriveProfileRepository.js` para hablar con Drive. |
| `backend/src/ItfStorageProvider.js` | **Contrato** del storage de los documentos E9 (`guardarPropuesta`, `leerDocumento`, `obtenerMetadata`, `eliminarTemporal`) y un proveedor por defecto `itfStorage_noConfigurado()`. No hay implementación real todavía. |
| `backend/src/DriveProfileRepository.js` | Se agregan `driveProfileRepository_buscarPorNombre` (todas las coincidencias, no la primera) y `driveProfileRepository_leerPorId` (solo archivos dentro de `FOLDER_ID`). `getFile`, `existe` y `listarArchivosThumb` **no cambian**. |
| `backend/src/PozoExistenciaService.js` | Opción nueva y opcional `excluirFuentes` en `pozoExistenciaService_verificar` (sin ella, comportamiento idéntico). |
| `backend/src/ItfDominioService.js` | Se agregan `RETIRAR_PROPUESTA`, el motivo `CANCELADO_POR_PROPONENTE`, la verificación de huella al restaurar el legacy (`LEGACY_CAMBIO`) y la lista blanca de campos del comando. |

### 14.2 `itfService_resolverVigente(wellId)`

Devuelve **una** decisión institucional por pozo:
`{wellId, estado: 'SI'|'NO'|'DESCONOCIDO', origen: 'LEGACY'|'E9'|null, documentoId, storageRef, mimeType, bytes, integridad: 'OK'|'NO_DERIVABLE', codigo, legacy}`.

- `storageRef` es **interno** (id de Drive del legacy o `storageFileId` del documento E9) y nunca sale hacia el cliente. `abrir()` (no enumerable) entrega el blob del legacy ya encontrado, sin una segunda llamada a Drive.
- **A.** Sin eventos + legacy único → `SI`, origen `LEGACY`. **B.** Sin eventos + sin legacy → `NO` (`ITF_NOT_FOUND`). **C.** Documento E9 vigente → `SI`, origen `E9` (no se toca Drive). **D.** Historial `NO_DERIVABLE` → `DESCONOCIDO` (`ITF_STATE_UNKNOWN`), aunque el archivo legacy exista.
- Lanza si Drive o Sheets fallan: un error de infraestructura nunca se vuelve «no existe».

### 14.3 Interruptor `ITF_E9_ACTIVO` y «sin fallback inseguro»

Propiedad de script `ITF_E9_ACTIVO === 'SI'` (exacto; vive solo en `ItfService.js`, `Config.js` no cambia).
- **Apagado o ausente = modo legacy puro:** nunca se lee `ItfEventos` (ni siquiera tiene que existir la hoja). Es el estado de producción hasta el rollout.
- **Encendido:** `ItfEventos` es **parte del contrato**. Si no se puede leer (hoja inexistente, esquema roto, error de Sheets) **no hay fallback al legacy**: se lanza o se responde «no se sabe». Un fallback podría mostrar como vigente un ITF ya reemplazado o retirado. Sin eventos para un pozo, el legacy es el vigente (con la hoja vacía el comportamiento es el de hoy).

### 14.4 Política única de nombre legacy y ambigüedad

Auditoría del código de E9-1: el índice aceptaba `.jpg` y `.JPG` (`/i`), la descarga buscaba `<wellId>.jpg` exacto y `getFile()` tomaba en silencio el primer archivo. El comportamiento real de Drive ante mayúsculas **no se pudo verificar** (el repo no tiene acceso a Drive); la política no depende de eso.

- Un ITF legacy es **exactamente `<wellId>.jpg`** con la extensión en minúscula. Se **reconoce** sin importar mayúsculas al indexar, pero las variantes (`.JPG`, `.Jpg`…) **no son descargables**: el pozo queda `NO_CANONICO` (`LEGACY_NOMBRE_NO_CANONICO`, «no se sabe»), nunca «Sí» ni un «No» engañoso.
- Un archivo canónico → `UNICO`; ninguno → `NO`; **dos o más con el mismo nombre → `AMBIGUO`** (`LEGACY_AMBIGUO`, «no se sabe»). No se toma el primero.
- La disponibilidad nunca dice «Sí» si después no se puede resolver un archivo único descargable (el índice y la resolución usan la misma regla).
- Resolución de un pozo: **una** llamada a Drive (`getFilesByName`) filtrada por nombre exacto. Índice en lote: clave `itf_leg_v1_DD` (propia; no toca `itf_idx_`), una pasada por la carpeta.
- **Diferencia con hoy, documentada:** un pozo con archivo duplicado o con extensión en mayúscula pasa de «Sí (y a veces la descarga falla)» a «no se sabe». Es la única diferencia; por eso `Api.js` todavía no se conecta (§14.9).
- **Q4 (implementado en el proveedor nuevo):** reconstrucción *single-flight* con una bandera corta en el caché; las demás ejecuciones esperan hasta ~6 s a que aparezca el índice. **No** usa el `ScriptLock`: es el lock global que serializa todas las escrituras de hojas y recorrer la carpeta lleva segundos. Sin disparador horario.

### 14.5 Retiro de la propia propuesta (`RETIRAR_PROPUESTA`)

- Acción futura, **sin evento nuevo**: produce `ITF_RETIRADO` con `motivoCodigo = CANCELADO_POR_PROPONENTE` (fijado por el servidor; el cliente no lo elige; texto opcional de 3 a 300 caracteres).
- Autorización: `perfil === true` y `perfil_subir === true` **y** `email normalizado de la sesión == email del ITF_PROPUESTO` **y** documento en `PROPUESTO`. **Nunca por nombre.** No requiere `perfil_validar`.
- Un documento ajeno o inexistente da el **mismo** `PERMISSION_DENIED` (no se filtra que existe). Aprobado, vigente, reemplazado, rechazado o ya retirado → `DOCUMENTO_NO_RETIRABLE`.
- La derivación aplica la misma regla: un `ITF_RETIRADO` con ese motivo hecho por otra persona, o sobre un documento que ya no está `PROPUESTO`, deja el pozo `NO_DERIVABLE` (`CANCELACION_INVALIDA`). El motivo no está en el catálogo institucional: un validador no puede elegirlo ni en `RETIRAR` ni en `REVERTIR`.
- Un **validador** retira cualquier propuesta pendiente con `RETIRAR` y el catálogo institucional; retirar un **vigente** es solo del validador.

### 14.6 Modelo de autenticación (futuro)

`itfService_ejecutar(sesion, comando, opciones)`: `sesion = {email, nombre, permisos}` lo arma `Api.js` a partir del token (nunca del cuerpo del pedido). El comando tiene una **lista blanca de campos**: cualquier otro (`email`, `actor`, `nombre`, `sha256`, `storageFileId`, ...) se rechaza con `INVALID_REQUEST`; no se ignora en silencio. El actor de cada evento es siempre la sesión.

### 14.7 Escritura: lock, relectura, atomicidad

Todo adentro del `ScriptLock` y **releyendo** el estado adentro: buscar `clientRequestId` → leer todos los eventos → derivar → (legacy: estado, huella, verificación) → planificar → escribir (1 o 2 eventos consecutivos en **una** operación) → invalidar. Nada decidido antes del lock se reutiliza.
- **Primer reemplazo del legacy:** si el plan necesita la huella (`LEGACY_SNAPSHOT_REQUERIDO`) se lee el archivo, se calcula el SHA-256 de los bytes reales y se replanifica con `[ITF_LEGACY_REGISTRADO, ITF_APROBADO]`. Si el registro ya existe (reintento tras un corte) no se duplica. **Un `ITF_LEGACY_REGISTRADO` sin aprobación posterior no reemplaza nada: el legacy sigue vigente.**
- **Restaurar el legacy:** se vuelve a leer el archivo por el id registrado, se verifica que exista, que sea el mismo archivo que hoy resuelve `<wellId>.jpg` y que el SHA-256 coincida; si no, `LEGACY_CAMBIO`/`LEGACY_NO_DISPONIBLE`. Nunca se restaura en silencio un archivo distinto.
- **Fallo parcial:** si la primera fila se escribe y la segunda no, el estado sigue siendo consistente (legacy vigente) y el reintento completa solo lo que falta. Si el lock no se obtiene o la escritura falla: `SERVICE_UNAVAILABLE`, sin escribir y sin invalidar.
- **Qué garantiza (y qué no) la escritura de dos filas.** Las dos filas se arman con secuencias consecutivas bajo el mismo lock y se escriben con **una sola llamada** (`setValues` sobre un rango contiguo). Sheets/Apps Script **no ofrece transacciones**: no se puede *afirmar* que esa llamada sea todo-o-nada si la ejecución se corta (tiempo máximo, caída). Lo que sí está garantizado, y probado, es que **cualquiera de los estados parciales posibles es seguro**: (a) ninguna fila → no pasó nada, el reintento escribe las dos; (b) solo `ITF_LEGACY_REGISTRADO` → el legacy sigue vigente (el registro no reemplaza nada) y el reintento escribe solo la aprobación; (c) las dos → completo. La segunda fila sola es imposible (se escriben en orden, y la derivación la declararía huérfana: `LEGACY_NO_REGISTRADO`, el pozo quedaría `NO_DERIVABLE`, nunca con un vigente inventado). Recuperación: el reintento con el mismo `clientRequestId` (idempotente) o, si el cliente no reintenta, una nueva acción del validador; `ItfEventos` nunca se corrige a mano.
- **Invalidación:** `invalidarCaches([wellId])` se llama una vez por escritura exitosa y nunca en reintentos, planes fallidos o errores. En E9-3 **no existe un caché de la derivación** (una lectura de `ItfEventos` por pedido, no por pozo; sin evidencia de que haga falta); el gancho queda para E9-4.

### 14.8 Compensación del archivo temporal (propuestas futuras)

Orden de `PROPONER`: validar archivo → hash → el pozo existe → **reintento exacto sin subir nada** → `storage.guardarPropuesta` → lock + escribir. Si el evento no se escribe (duplicado, estado, error) el servicio llama a `storage.eliminarTemporal` (papelera, no borrado físico). **Si la escritura lanzó pero la fila pudo haberse escrito, no se borra nada** (se relee `ItfEventos` y solo se borra si ninguna fila referencia el archivo). Si la compensación falla se informa (`compensacion: 'FALLO'`) y queda registrado en el log. Todo probado con un storage falso; **no hay acceso real a storage**.

### 14.9 Por qué `Api.js` todavía no se conecta

1. La política nueva de nombre legacy cambia el resultado en casos exóticos (duplicados, extensión en mayúscula): se decide al cablear.
2. Con E9 activo `ItfEventos` pasa a ser parte del contrato y todavía no existe la hoja ni el storage.
3. Cablear es una línea (`ProfileService` delega en `itfService_getProfile` / `itfService_disponibilidad`) más el mapeo de códigos; se hace en E9-4.

`getProfile` y `getItfAvailability` de producción siguen exactamente igual. `itfService_getProfile` devuelve la misma forma que `profileService_getProfile` (`{found, blob}`; blob con `getBytes()` / `getContentType()`), más `unknown:true` + `code` cuando no se puede afirmar. El cliente no necesita saber si el ITF viene de la carpeta legacy o del storage E9 y no se expone `documentoId`.

### 14.10 Disponibilidad: «no se sabe» sin romper clientes

El contrato actual devuelve `{wellId: boolean}`. Opciones evaluadas: **A. omitir la clave**, B. `null`, C. error parcial, D. endpoint nuevo. Se elige **A**: el frontend (E7, `seleccionLogic_combinarDisponibilidadItf`) ya trata la ausencia de un booleano como «desconocido» (celda vacía), nunca «No». Un pozo `NO_DERIVABLE`, con legacy ambiguo o no canónico, o con el legacy sin comprobar, **se omite**. Regla: legacy vigente → `true`; E9 vigente → `true`; solo propuesta → `false`; rechazado → `false`; retirado sin vigente → `false`.

Lecturas independientes de la cantidad de pozos (probado con 1, 50, 500 y 700): **una** de `ItfEventos`, **una** pasada por la carpeta (la primera vez; después el índice), **cero** búsquedas por nombre; derivación en memoria. En modo legacy puro, cero lecturas de hoja.

### 14.11 Auditoría actual (qué escribe cada flujo) y propuesta

| Flujo | Qué escribe hoy |
|---|---|
| `getProfile` | Una fila de `Historial` por llamada (`OK`, `PROFILE_NOT_FOUND` o `SERVICE_UNAVAILABLE`): `appendRow` + `getLastRow` + formato + valor (4 operaciones de Sheets). Sin Telegram. |
| ZIP masivo | El navegador llama `getProfile` por cada pozo (cada uno escribe su fila) y al final `registerDescargaItf`. |
| `registerDescargaItf` | Una fila de `Historial` (`OK` o `TELEGRAM_ERROR`) y un aviso de Telegram (con deduplicación de 10 s). |
| `getItfAvailability` | Una fila de `Historial` por lote; sin Telegram. |

**Propuesta (Q3), sin implementar y sin perder trazabilidad:** el parámetro «no auditar este `getProfile`» **nunca** puede venir del cliente (cualquiera lo apagaría). Modelo seguro: un `iniciarDescargaItf` auditado (una fila + Telegram al comenzar) que devuelve un ticket firmado con HMAC, ligado a email + lista de pozos + vencimiento; `getProfile` con ticket válido y un pozo de la lista omite la fila individual y suma a un contador del ticket; `registerDescargaItf` cierra con los conteos reales. `itfService_*` no escribe `Historial`: la decisión de auditar sigue en `Api.js`.

### 14.12 Q1 y Q2: qué archivos tocarían (no implementados)

- **Q1** (renderizar la tabla antes de la disponibilidad ITF): `js/seleccion.js` (el `then(continuarConDisponibilidad)` de `asegurarDisponibilidadItf`, ~línea 400, y el pintado de la columna «Tiene ITF» con «verificando…»), `js/seleccionLogic.js` solo si hace falta un estado «verificando» puro, y sus tests (`js/seleccionItfLotes.test.js`, `js/seleccionLoteItfLogic.test.js` y los de controlador). Sin cambios de backend ni de `sw.js`.
- **Q2** (el hub decide con la disponibilidad y baja la imagen al abrir Perfil): `js/app.js` (`buscarPozo`, ~línea 1376, que hoy llama `apiGetProfile`; `renderPerfil`, ~línea 456, y el render del hub, ~línea 378) y sus tests de cableado; `js/api.js` y el backend ya sirven (`getItfAvailability` acepta un solo pozo). **Contrato:** la tarjeta Perfil aparece con `getItfAvailability([wellId])[wellId] === true`; la clave ausente es «no se sabe» (no oculta la tarjeta con un falso «No»); `getProfile` se llama recién al abrir Perfil.

### 14.12 bis Cierre de diseño de Q1, Q2 y Q3 (ninguno implementado)

| Id | Qué | Archivos | Riesgo | Cuándo |
|---|---|---|---|---|
| Q1 | Tabla de «Mi selección» progresiva: se pinta primero y «Tiene ITF» se completa después («verificando…»; clave ausente = vacío, nunca «No») | `js/seleccion.js`, `js/seleccionLogic.js` (solo si hace falta un estado puro «verificando») y sus tests | Bajo: solo frontend; hay que mantener que ordenar / filtrar / exportar esperen o traten la columna como desconocida hasta que llegue la respuesta | Antes del rollout E9; puede ir antes de E9-4, es independiente del backend |
| Q2 | La tarjeta Perfil sale de `getItfAvailability([wellId])`; `getProfile` recién al abrir Perfil | `js/app.js` (`buscarPozo`, `renderPerfil`, render del hub) y sus tests de cableado; `js/api.js` y el backend ya sirven | Medio: cambia cuándo aparece la tarjeta y deja de usar `getProfile` como prueba de existencia; con la clave ausente (no se sabe) no hay que ocultarla con un falso «No» | Antes del rollout E9, después del cableado de E9-4 (para que la disponibilidad ya sepa de E9); con imágenes de hasta 3 MB es la mejora que más pesa |
| Q3 | Auditoría del ZIP sin perder trazabilidad (ticket de descarga firmado, §14.11) | `Api.js` (`iniciarDescargaItf`, `getProfile`, `registerDescargaItf`), `js/seleccion.js` (pedir el ticket y mandarlo), tests de Api y del frontend | Medio-alto: es seguridad y auditoría; el parámetro nunca puede ser del cliente | Antes del rollout E9 **solo si** las mediciones muestran que las filas de `Historial` por pozo son un cuello; si no, después |

### 14.12 ter Matriz de casos (todos con prueba)

| Caso | Resolución | Disponibilidad | getProfile |
|---|---|---|---|
| A. legacy existe + 0 eventos | `SI`, `LEGACY` | `true` | bytes del legacy |
| B. legacy no existe + 0 eventos | `NO` (`ITF_NOT_FOUND`) | `false` | `found:false` |
| C. legacy ambiguo | `DESCONOCIDO` (`LEGACY_AMBIGUO`) | clave **omitida** | `found:false, unknown:true` |
| D. legacy + propuesta | `SI`, `LEGACY` | `true` | bytes del legacy |
| E. legacy registrado solamente | `SI`, `LEGACY` | `true` | bytes del legacy |
| F. legacy reemplazado por E9 | `SI`, `E9` | `true` | bytes del storage E9 |
| G. E9 vigente + legacy físico presente | `SI`, `E9` (no se toca Drive) | `true` | **solo** el E9 |
| H. E9 retirado sin restauración | `NO` | `false` | `found:false` |
| I. historial corrupto | `DESCONOCIDO` (`ITF_STATE_UNKNOWN`, `NO_DERIVABLE`) | clave **omitida** | `found:false, unknown:true` |

`DESCONOCIDO` jamás se convierte en `false`. **Estado de integración: B, preparado pero SIN cableado productivo** (§14.9). Contadores probados con 1, 50, 500 y 700 pozos: una lectura de `ItfEventos`, una llamada al proveedor legacy, una derivación, cero búsquedas o huellas por pozo; el crecimiento es de CPU / memoria.

### 14.13 Existencia del pozo para propuestas futuras

Auditado: `PozoExistenciaService` acepta como evidencia el padrón, **el `<wellId>.jpg` legacy (fuente `ITF`)**, el punto NE y las correcciones previas. Ninguna lee `ItfEventos` ni el storage E9, y un documento E9 nunca está en la carpeta legacy: una propuesta **no** puede probar que el pozo existe. Aun así, como esa fuente es un ITF, **E9 excluye la rama ITF**: `pozoExistenciaService_verificar` ganó la opción `excluirFuentes` (sin ella nada cambia, mismo cache y mismo fail-closed; un positivo cacheado de una fuente excluida no vale y no se pisa) y `itfService_pozoExiste(wellId)` la llama con `['ITF']` → `{existe, indeterminado}`. Fuente elegida para las propuestas futuras: **padrón, punto NE o corrección previa**. Un vigente E9 tampoco cuenta.
**Consecuencia a decidir:** un pozo conocido *solo* por su ITF legacy (no está en el padrón, ni en NE, ni tiene correcciones) no admite propuestas, ni de «nueva versión». Hoy se desconoce cuántos hay (necesita lectura de producción); si fueran relevantes, se puede levantar la exclusión **solo** para «nueva versión» de un pozo con legacy vigente (el legacy preexistente no es el documento propuesto, así que no hay circularidad).

### 14.14 Catálogo de códigos del servicio

`ITF_NOT_FOUND`, `ITF_STATE_UNKNOWN`, `LEGACY_AMBIGUO`, `LEGACY_NOMBRE_NO_CANONICO`, `LEGACY_CAMBIO`, `LEGACY_FORMATO_INVALIDO`, `VIGENTE_CAMBIO`, `DUPLICADO_DOCUMENTO`, `IDEMPOTENCY_CONFLICT`, `INCONSISTENT_STATE`, `SERVICE_UNAVAILABLE`, `ITF_E9_INACTIVO`, `ITF_STORAGE_NO_CONFIGURADO`, más los de validación y permisos del dominio (`PERMISSION_DENIED`, `INVALID_*`, `POZO_NOT_FOUND`, `DOCUMENTO_NO_PROPUESTO`, `DOCUMENTO_NO_RETIRABLE`, `DESTINO_INVALIDO`, `LEGACY_NO_DISPONIBLE`...). Los mensajes nunca incluyen ids de Drive, rutas ni el texto de una excepción.

### 14.15 Cambios respecto del diseño de E9-2

| Tema | E9-2 | E9-3 | Por qué |
|---|---|---|---|
| Comando | campos extra ignorados | **lista blanca**: campo desconocido → `INVALID_REQUEST` | El actor y los datos del archivo no pueden venir del cliente. |
| Retiro de propuesta | solo validador | + el proponente, solo la propia pendiente | Decisión cerrada tras E9-2. |
| Restaurar legacy | disponible | además `huellaCoincide === true` | Nunca restaurar en silencio un archivo distinto. |
| Nombre legacy | `/i` en el índice, exacto en la descarga | política única; ambiguo / no canónico = «no se sabe» | Consistencia disponibilidad ↔ descarga. |
| Q4 | pendiente | single-flight en el proveedor nuevo (sin `ScriptLock`) | El `ScriptLock` es el lock global de las hojas. |
| Existencia del pozo | «reutilizar `PozoExistenciaService` sin modificarlo» | `excluirFuentes` (opción nueva y opcional) y E9 excluye la rama ITF | Ningún ITF puede ser evidencia de existencia; sin la opción nada cambia. Limitación en §14.13. |

### 14.16 Bloqueos y pendientes para E9-4

1. Cableado de `Api.js` / `ProfileService` y mapeo de códigos a respuestas (decidir la diferencia de §14.4).
2. Storage real de las propuestas (segunda cuenta; hoy solo JPEG) con raíz privada y nombres generados, y su implementación de `eliminarTemporal`.
3. Permisos reales `perfil_subir` y `perfil_validar` en `Usuarios` / `Auth` y la guarda de frontend que hoy los prohíbe.
4. Crear la hoja `ItfEventos` (`setupItfEventosSheet`) y activar `ITF_E9_ACTIVO` solo después.
5. Mediciones reales (sesión) y la decisión de Q1–Q3 con cifras; ticket de descarga si se hace Q3.
6. Si las mediciones lo justifican, caché de la derivación (el gancho `invalidarCaches` ya está).

### 14.17 Verificación de E9-3 (local)

- Jest completo en serie: 163 suites, 10.812 tests verdes; Python: 97 + 224 verdes; `git diff --check` limpio.
- Mutaciones: E9-2 **75 de 75 muertas** (repetidas tras cambiar el dominio); E9-3 **59 de 59 muertas**. Una de las 52 primeras sobrevivió (el proveedor legacy se leía una vez por pozo; los contadores solo miraban Drive y la hoja, y con el índice en caché esa lectura no toca Drive): era una falta de test, y se agregó un contador de llamadas al proveedor. Se agregaron 7 mutantes más (exclusión de la rama ITF, caché, single-flight).
- No se repitieron todas las mutaciones de E9-3 después de agregar tests y la exclusión de la rama ITF: los tests solo se ampliaron y el único código común tocado fue `PozoExistenciaService` (sus mutantes se corrieron).

## 15. E9-4: proponer un ITF de punta a punta (local, NO productivo)

Estado: implementado y probado **en local**. No hay push, `gas:*`, despliegue, hoja `ItfEventos` real, `ITF_E9_ACTIVO` encendido, pantalla ni columnas productivas de permisos. Con la bandera apagada el endpoint responde `ITF_E9_INACTIVO` **antes** de tocar ninguna hoja.

### 15.1 Qué hace

Un usuario autorizado manda una imagen → el backend la valida → el storage privado la guarda → el servidor calcula el SHA-256 → se agrega **un** evento `ITF_PROPUESTO` → la propuesta queda **pendiente**. Todavía no existe aprobar, rechazar, reemplazar ni revertir: nada de lo propuesto se vuelve ITF vigente.

### 15.2 Endpoint `proponerItf`

- Acceso: sesión válida y `perfil === true && perfil_subir === true`. `perfil_subir` solo no alcanza (sin `perfil` no se ve el pozo). El backend entiende ya `perfil_subir` y `perfil_validar` (valor exacto `SI` → `true`; cualquier otra cosa → `false`) **sin** crear las columnas productivas: si la hoja `Usuarios` no las tiene, ambos permisos son `false`.
- Campos admitidos, **y solo estos**: `wellId`, `imageBase64`, `mimeType`, `nombreOriginal`, `clientRequestId` (más `action` y `sessionToken`). Cualquier otro campo (`documentoId`, hash, `bytes`, `storageFileId`, `email`, `nombre`, `timestamp`, `estado`...) → `INVALID_REQUEST`. El actor sale **siempre** de la sesión.
- `imageBase64` se valida antes de decodificar: alfabeto base64, largo múltiplo de 4, tope de 4.194.304 caracteres (3 MB en base64).
- Respuesta segura (DTO): `{documentoId, wellId, estado:'PROPUESTO', mimeType, bytes, nombreOriginal, timestampUtc, warnings}`. **No** sale `storageFileId`, el hash completo, el email, `clientRequestId`, la secuencia ni ninguna advertencia interna (`warnings` va siempre `[]`: `MISMO_HASH_OTRO_POZO` queda como marca de revisión interna).
- Historial: **una** fila `OK` por propuesta nueva (un reintento no duplica); sin base64, hash, id de storage ni nombre original. Sin Telegram.

### 15.3 Storage real (segunda cuenta)

- Raíz **propia y aislada** `ItfPropuestas/` (carpeta por año del servidor), separada de `FotosReemplazo/` y de `FotosPozos/`. Mismo Web App y **mismo esquema HMAC-SHA256 v1** de Fotos (un solo secreto, un solo cliente: `fotosStorageClient_llamar`), con acciones propias: `putItf`, `getItf`, `metaItf`, `trashItf`. Las acciones de Fotos no operan sobre la raíz de ITF ni viceversa (probado en los dos sentidos); un archivo de otra raíz responde `NOT_FOUND`.
- **JPEG y PNG**, verificados por los bytes reales en el backend **y otra vez en el storage** (un PDF dicho `image/jpeg` se rechaza en ambos). Vacío, MIME falso, firma de bytes rota y tamaño > 3 MB se rechazan. Fotos mantiene su comportamiento: JPEG sí, PNG no (probado).
- Nombre físico: `<documentoId>.<jpg|png>`, con el `documentoId` generado por el servidor. **El nombre original nunca se usa como ruta ni como nombre de archivo.** Archivos privados (sin compartir). `trashItf` solo manda a la papelera (no borra definitivamente).
- `putItf` es idempotente por `documentoId`: el mismo id con el mismo contenido devuelve la misma referencia (una sola copia); con otro contenido se rechaza.
- Un storage sin las acciones nuevas se informa como `ITF_STORAGE_NO_CONFIGURADO`; una raíz sin configurar falla con `INTERNAL` sin detalle.
- Configuración que hará falta al desplegar (no hecha): propiedad `ITF_ROOT_FOLDER_ID` en el storage, que crea `setupItfPropuestasStorage()` una vez.
- Autenticación probada también para ITF: firma válida / inválida, acción desconocida, marca de tiempo vencida o futura, repetición del mismo pedido y acción alterada (`putFoto` firmada reusada como `putItf`) → `UNAUTHORIZED` sin escribir nada.

### 15.4 Límite de 3 MB y tamaño real de la solicitud (provisional)

- 3 MB de imagen = 3.145.728 bytes = **4.194.304 caracteres de base64** (+33 %), más el sobre JSON. El mismo contenido viaja **dos veces**: navegador → backend, y backend → storage (como string JSON dentro de otro JSON, más la firma): unos **4,0 MB** por tramo (benchmark local `scripts/medir_itf_propuesta.js`: factor 1,333 sobre la imagen en 100 KB, 500 KB, 1 MB y 3 MB).
- **Se mantiene 3 MB como límite PROVISIONAL.** No se pudo medir en Apps Script (no hay sesión de Google en esta etapa): ni el tiempo de `Utilities.base64Decode`, `computeDigest`, `UrlFetchApp` y Drive para 3 MB, ni el tope real del cuerpo de un `doPost` entrante. Lo único medido es CPU local de Node (decodificar 3 MB ≈ 84 ms, SHA-256 ≈ 45 ms, firmar ≈ 8 ms): sirve para comparar tamaños, **no** para estimar segundos en Apps Script.
- Evidencia para el valor: los ITF legacy pesan 37–170 KB; las fotos normalizadas del sistema, ≤ 1,55 MB; los originales de celular llegan a ~4 MB en el p99. Por eso en E9-5 el **cliente debe reducir** la foto antes de enviarla (apuntar a ≤ 1 MB). Si la medición real obligara a bajar el tope, hay que cambiarlo en `ItfArchivoLogic.js` **y** en `StorageDrive.js` (un test exige que sean iguales).
- Cómo medir en producción cuando se pueda: proponer con un token real un JPEG de 100 KB, 1 MB y 3 MB y leer el tiempo total y el de cada paso; medir también `getItf`.

### 15.5 Auditoría de la carpeta legacy (solo lectura, pendiente de correr)

`backend/src/ItfLegacyAuditoria.js` → `auditarCarpetaItfLegacy()`, para correr **a mano** desde el editor de Apps Script (ningún endpoint ni trigger la llama). Lee nombres y tamaños de la carpeta `FOLDER_ID`, no abre archivos y no escribe nada. Informa: total de archivos, canónicos (`<wellId>.jpg`), variantes de extensión (`.JPG`, `.Jpg`...), duplicados canónicos, nombres que no coinciden, archivos sin pozo válido (departamento fuera de 01–19 o `0000`), pozos con más de un candidato, pozos por estado (`UNICO` / `AMBIGUO` / `NO_CANONICO`, **la misma regla** que el proveedor legacy: lo exige un test) y la distribución de tamaños (mínimo, mediana, p95, p99, máximo, tramos, cuántos superan 3 MB). Sin ids de Drive; ejemplos acotados a 10 por categoría; se corta a los 4,5 minutos y entonces declara `incompleto: true`. **No se pudo ejecutar** (sin sesión de Google): sus cifras son el primer dato a obtener antes de activar E9, y deciden el límite real y cuántos pozos quedarían en «no se sabe».

### 15.6 Reglas de existencia (A–D)

Una propuesta **nunca prueba** que el pozo existe (el documento aún no existe ni es válido).

| Caso | Estado del ITF del pozo | ¿Se puede proponer? |
|---|---|---|
| A | No hay ITF vigente (ni legacy ni E9) | Solo si el pozo existe por una fuente **independiente**: padrón, punto NE o corrección previa (la rama ITF de `PozoExistenciaService` queda excluida con `excluirFuentes`). Si no → `POZO_NOT_FOUND`; si no se puede comprobar → `SERVICE_UNAVAILABLE`. |
| B | Legacy **único y canónico** (`<wellId>.jpg`) y legible | **Sí**: un ITF vigente preexistente es evidencia suficiente para proponer una *nueva versión* (no es circular: el legacy ya estaba). Se registra su huella como `ITF_LEGACY_REGISTRADO` en la misma operación si aún no estaba. |
| C | Legacy ambiguo, de nombre no canónico, ilegible, o historial no derivable | **No**: requiere revisión (`LEGACY_AMBIGUO` / `LEGACY_NOMBRE_NO_CANONICO` / `LEGACY_FORMATO_INVALIDO` / `ITF_STATE_UNKNOWN`). |
| D | Hay un documento E9 vigente | Sí (nueva versión). |

Esto resuelve la «consecuencia a decidir» de §14.13: un pozo conocido solo por su ITF legacy único admite propuestas de nueva versión; sigue sin habilitarse proponer un ITF para un pozo sin ITF ni otra fuente de existencia.

### 15.7 Orden real del flujo (A–Q)

| | Paso | Dónde |
|---|---|---|
| A | Sesión válida y permisos `perfil` + `perfil_subir` (hojas `Sesiones` / `Usuarios`, nunca `ItfEventos`) | `Api.handleProponerItf`; el dominio lo repite con `itfDominio_puede` |
| B | Bandera `ITF_E9_ACTIVO === 'SI'`, si no `ITF_E9_INACTIVO`: **antes** de mirar el cuerpo, de tocar `ItfEventos` o el storage | `Api.handleProponerItf` |
| C | Lista blanca de campos; forma de `wellId`, `clientRequestId`, `mimeType` | `Api` / dominio |
| D | Parseo base64 (alfabeto, múltiplo de 4, tope) y decodificación | `Api` |
| E | Magic bytes, MIME declarado vs real, vacío y tamaño | `itfArchivo_validar` |
| F | SHA-256 **del servidor** sobre los bytes aceptados (el cliente no manda hash) | `itfService_proponer` |
| G | Existencia / estado del pozo (A–D) y prevalidación sin escribir (derivar, duplicado, pendientes, idempotencia) con el planificador en seco | `itfService_evidenciaPropuesta`, `itfService_planificar` |
| H | Idempotencia conocida: si ya hay un evento de ese `clientRequestId`, se decide **sin subir nada** | `itfService_proponer` |
| I | `documentoId` generado por el servidor | `itfService_proponer` |
| J | **Subida al storage, FUERA del lock** (es lenta) | `d.storage.guardarPropuesta` |
| K | Se toma el `ScriptLock` | `d.repo.conLock` |
| L | **Se relee `ItfEventos` y se revalida todo** (existencia, duplicado de hash, tope de pendientes, idempotencia): nada decidido antes del lock se reutiliza | `itfService_dentroDelLock` |
| M | Append de `ITF_PROPUESTO` | `d.repo.escribirEventos` |
| N | Se libera el lock | |
| O | Se invalidan las cachés (si falla, la escritura ya hecha sigue siendo éxito) | `invalidarCaches` |
| P | Una fila OK en Historial | `Api` |
| Q | Respuesta con el DTO seguro | `Api` |

**Desviaciones respecto de la lista pedida (y por qué):** (0) la sesión y los permisos (A) se comprueban **antes** que la bandera (B), y no al revés: es el orden de todos los endpoints de la app (sesión → permiso → contenido) y evita que alguien sin sesión pueda averiguar si E9 está encendido; la bandera sigue cortando antes de cualquier lectura de `ItfEventos`, del cuerpo o del storage (probado con una hoja inexistente). (1) el hash (F) se calcula **antes** de comprobar la idempotencia conocida (H): hace falta para distinguir un reintento exacto de un mismo `clientRequestId` con otro contenido (`IDEMPOTENCY_CONFLICT`). (2) La prevalidación (G) y la idempotencia (H) se resuelven con el **mismo planificador** que usa el lock, en seco, para no mantener dos implementaciones de la regla; un reintento pasa por el lock solo para devolver el evento original, sin subir ni escribir. (3) El tope de 10 pendientes se comprueba en G (antes de subir) **y** otra vez en L (la carrera). Los tests fijan el orden de las llamadas (`ORDEN DE LLAMADAS`).

### 15.8 Concurrencia

- **Mismo archivo, dos usuarios a la vez (A/B):** ambos pasan la prevalidación y ambos suben. El primero que toma el lock escribe; el segundo, ya dentro del lock, ve el hash duplicado → `DUPLICADO_DOCUMENTO`, **no** escribe evento y **compensa su propio archivo** (se manda a la papelera solo el suyo, que ninguna fila referencia; el del primero no se toca).
- **Tope de 10 pendientes:** dos solicitudes ven 9; la primera crea la 10.ª; la segunda falla con `TOO_MANY_PENDING` dentro del lock y compensa su archivo.
- **Sin atomicidad entre archivo y fila:** Drive y Sheets no son transaccionales. Si el append *lanza*, no se sabe si se escribió (un timeout posterior): se **relee** `ItfEventos` y solo se borra el archivo si ninguna fila lo referencia; si no se puede comprobar, **no se borra nada** (un huérfano se limpia a mano; uno referenciado que desaparece no se recupera). Un append de varias filas (legacy + propuesta) no está probado como atómico en Sheets: los estados parciales son seguros (el legacy registrado solo es información).
- La compensación solo ocurre cuando no hubo escritura, o cuando se puede probar que no hay fila que apunte al archivo.

### 15.9 Idempotencia (casos A–F, todos con prueba)

Clave: `(email normalizado, clientRequestId)`.

1. Reintento cuando el evento ya existe → devuelve **la misma propuesta**; sin subida, sin evento, sin llamada de storage.
2. Se perdió la respuesta y se reintenta → mismo `documentoId`, 0 eventos nuevos, 0 archivos nuevos.
3. Mismo `clientRequestId` con **otros bytes** → `IDEMPOTENCY_CONFLICT`.
4. Mismo `clientRequestId` y **mismo hash pero otro `wellId`** → `IDEMPOTENCY_CONFLICT`.
5. El email se compara sin distinguir mayúsculas.
6. Otro usuario puede reutilizar el mismo `clientRequestId`.

### 15.10 Duplicados y advertencias

- Mismo hash en el mismo pozo (propuesto, vigente, reemplazado o retirado tras ser vigente) → `DUPLICADO_DOCUMENTO`, sin guardar nada.
- Mismo hash en **otro** pozo → se permite y queda una marca de revisión interna (`MISMO_HASH_OTRO_POZO`); no sale al cliente. No se agregó columna.

### 15.11 Seguridad (resumen verificable)

El cliente no elige actor, ids, hash, estado ni referencias de storage. Ni el `storageFileId` ni el hash completo salen del servidor. El nombre original es solo texto de auditoría, normalizado y acotado. Las raíces de storage están aisladas y toda llamada va firmada y con marca de tiempo anti-replay. Los mensajes de error no contienen ids de Drive, rutas ni excepciones.

### 15.12 Decisiones de E9-4 (y diferencias con el diseño anterior)

| Tema | Antes | E9-4 |
|---|---|---|
| Legacy único y nueva versión | pendiente de decidir (§14.13) | permitido (regla B) |
| Pendientes por pozo | tope «defensivo» sin código | `TOO_MANY_PENDING` a 10, antes de subir y dentro del lock |
| Storage de propuestas | solo JPEG, contrato abstracto | PNG además; raíz aislada; acciones propias; nombre = `documentoId` |
| Permisos | no existían | `perfil_subir` / `perfil_validar` entendidos por el backend, sin columnas productivas |
| Invalidación de cachés | dentro de la operación | **después** de liberar el lock, con `try/catch` |
| Advertencias al cliente | a definir | siempre `[]`; `MISMO_HASH_OTRO_POZO` solo interno |

### 15.13 Bloqueos y pendientes para E9-5

1. Correr `auditarCarpetaItfLegacy()` y medir en Apps Script (decide el límite real).
2. Desplegar el storage con las acciones de ITF y crear `ITF_ROOT_FOLDER_ID`; crear la hoja `ItfEventos` y las columnas `perfil_subir` / `perfil_validar` en `Usuarios`; recién entonces encender `ITF_E9_ACTIVO`.
3. Aprobar / rechazar / reemplazar / revertir expuestos por la API y la **cola de pendientes** para quien valida.
4. Pantalla: carga con reducción de la foto en el cliente, estado «pendiente» visible para quien propuso, y la guarda de frontend que hoy prohíbe subir.
5. Ver/descargar una propuesta pendiente por quien valida (hoy el servicio solo la lee internamente por `leerDocumento`).

### 15.14 Verificación de E9-4 (local)

- Jest completo en serie: 167 suites, 11.049 tests verdes; Python: 97 + 224 verdes; `git diff --check` limpio.
- Mutaciones: E9-4 **62 de 62 muertas**; E9-3 **59 de 59** y E9-2 **75 de 75** repetidas sobre el código actual (el código compartido cambió). En la primera corrida de E9-4 sobrevivieron 6: tres eran faltas de test reales (un `sha256` que acompañe al archivo, los argumentos exactos que recibe el storage, el nombre original en el payload del storage) y se agregaron los tests; dos eran mutantes que no cambiaban el comportamiento por la lista blanca o por el UUID exigido (se reescribieron para que prueben la defensa en profundidad); uno eran cuatro guardas redundantes contra el archivo vacío (se anularon juntas).
- No se corrió nada contra Google: ni storage desplegado, ni hoja real, ni la auditoría de la carpeta legacy ni la medición en Apps Script. El benchmark de `scripts/medir_itf_propuesta.js` es CPU local de Node.
