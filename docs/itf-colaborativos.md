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

## 16. E9-5: moderación institucional de ITF (local, NO productivo)

Estado: implementado y probado **en local**. No hay UI, push, `gas:*`, despliegue, hoja `ItfEventos` productiva, `ITF_E9_ACTIVO` encendido en producción, columnas productivas en `Usuarios` ni cableado de `getProfile`. El dominio de E9-2/E9-3 ya sabía aprobar, rechazar, retirar y revertir; E9-5 **lo expone con endpoints seguros y agrega las lecturas** (cola, apertura de un documento, historial) y la comprobación del archivo.

### 16.1 Endpoints

Todos: sesión → permisos exactos (`=== true`) → interruptor `ITF_E9_ACTIVO` → **lista blanca de campos** → servicio. El actor sale de la sesión; el pozo sale del documento. Un `wellId`, `email`, `actor`, `nombre`, hash, `storageFileId`, `estado`, `secuencia` o `timestamp` del cliente se **rechaza** (`INVALID_REQUEST`), no se ignora.

| Acción | Permisos | Campos del cliente |
|---|---|---|
| `getItfPendientes` | `perfil` + `perfil_validar` | `limite`, `cursor` |
| `getItfDocumentoModeracion` | `perfil` + `perfil_validar` | `documentoId` |
| `getHistorialItf` | `perfil` + `perfil_validar` | `wellId` |
| `aprobarItf` | `perfil` + `perfil_validar` | `documentoId`, `vigenteEsperadoDocumentoId`, `motivoCodigo`, `motivoTexto`, `clientRequestId` |
| `rechazarItf` | `perfil` + `perfil_validar` | `documentoId`, `motivoCodigo`, `motivoTexto`, `clientRequestId` |
| `retirarItf` | `perfil` + `perfil_validar` | `documentoId`, `motivoCodigo`, `motivoTexto`, `clientRequestId` |
| `revertirItf` | `perfil` + `perfil_validar` | `documentoId`, `vigenteEsperadoDocumentoId`, `motivoCodigo`, `motivoTexto`, `clientRequestId` |
| `retirarPropuestaItf` | `perfil` + `perfil_subir` (y ser quien propuso) | `documentoId`, `motivoTexto`, `clientRequestId` |

No basta `perfil` solo, `perfil_validar` solo ni `perfil_subir`; un valor truthy que no sea el booleano `true` tampoco. Con el interruptor apagado responden `ITF_E9_INACTIVO` antes de tocar la hoja; el permiso se comprueba **antes** que el interruptor.

### 16.2 Cola de pendientes (`getItfPendientes`)

- Devuelve **solo** documentos `PROPUESTO`, de todos los pozos, **las más nuevas primero**. Aprobar, rechazar o retirar una propuesta la saca de la cola: no hay «resueltos».
- Cada ítem: `documentoId`, `wellId`, `mimeType`, `bytes`, `nombreOriginal`, `nombreProponente`, `timestampUtc`, `autoPropuestaPropia` (quien mira es quien propuso, **por email normalizado**, nunca por nombre), `warningDuplicadoOtroPozo` y `warningMensaje` (texto fijo «Este mismo archivo aparece asociado a otro pozo.»). **Nunca** email, `storageFileId`, hash (ni su prefijo), `clientRequestId` ni secuencia. No lleva imágenes.
- Respuesta: `items`, `siguienteCursor`, `total` (todas las pendientes de la cola) y `pozosSinDerivar` (pozos con historial roto, cuyas propuestas no se listan para no inventar un estado).
- **Costo:** UNA lectura de `ItfEventos`, derivación en memoria y el mapa «hash → pozos» ya calculado por la derivación. Cero lecturas de storage, de Drive o del legacy por tarjeta; la imagen se pide solo al abrir. Probado con 1, 20, 100 y 500 propuestas: siempre una lectura de la hoja.
- **Paginación:** `limite` 1–50 (por defecto 20) y `cursor` opaco `s1:<n>`. El cursor es la **secuencia** (única y creciente en toda la hoja) de la última propuesta entregada: «dame las anteriores». Una propuesta nueva tiene secuencia mayor y no corre las páginas ya vistas; una que sale de la cola no deja un hueco ni repite otra, que es lo que rompe un `offset`. No depende de que el último ítem entregado siga pendiente. Límite o cursor inválidos → `INVALID_LIMITE` / `INVALID_CURSOR`.

### 16.3 Abrir un documento (`getItfDocumentoModeracion`)

Devuelve `documento` (metadata segura, estado, quién lo propuso/aprobó, motivo de la decisión, `restaurable`), `pozo` (estado y **`vigenteActualDocumentoId`**, el vigente que hay que declarar al aprobar o restaurar; `vigenteIndeterminado: true` si no se puede afirmar, p. ej. legacy ambiguo) e `imagen` (`mimeType` + `imagenBase64`). Se pueden abrir propuestos, vigentes, reemplazados, retirados y rechazados. El legacy no registrado se abre como vigente implícito (`implicito: true`); el registrado se entrega **solo si su contenido sigue coincidiendo con la huella** (`LEGACY_CAMBIO` si no). Sin ids de Drive ni referencias de storage.

### 16.4 Aprobar (`aprobarItf`)

- Evento `ITF_APROBADO`; la propuesta pasa a `VIGENTE`. **Sin vigente** no hay motivo (no reemplaza nada).
- **`vigenteEsperadoDocumentoId` es obligatorio cuando ya hay vigente** (`LEGACY:<wellId>` o el id del documento E9 que vio el validador). Dentro del lock el servidor **rederiva** el vigente real; si es otro, o ya no hay → `VIGENTE_CAMBIO` y no se escribe nada. Con vigente el motivo es obligatorio: `ACTUALIZACION`, `CORRECCION`, `MEJOR_CALIDAD`, `DOCUMENTO_COMPLETO` u `OTRO` (este exige texto; en los demás es opcional). El texto se normaliza con la misma política que E8.
- **Reemplazo del legacy:** si el vigente es `LEGACY:<wellId>` y aún no tiene `ITF_LEGACY_REGISTRADO`, el servidor resuelve el legacy único, calcula su huella y escribe el registro y la aprobación **en la misma operación y el mismo lock**, con secuencias consecutivas. El archivo legacy no se toca.
- **Revalidación dentro del lock:** la propuesta sigue `PROPUESTO` (`DOCUMENTO_NO_PROPUESTO` si fue rechazada, retirada o ya aprobada), el vigente esperado coincide, el historial del pozo es derivable (`ITF_STATE_UNKNOWN`) y **el archivo sigue en el storage y es el registrado** (mismo tipo y tamaño): falta → `ITF_ARCHIVO_NO_DISPONIBLE`, distinto → `ITF_ARCHIVO_NO_COINCIDE`, storage caído → `SERVICE_UNAVAILABLE`. Nunca queda vigente un documento sin archivo. (La misma comprobación se hace al restaurar un E9.)
- **Autoaprobación:** permitida si quien aprueba es quien propuso. Son dos acciones y dos eventos, cada uno con su `clientRequestId`; la derivación la marca (`autoaprobado`) sin crear un estado especial, y la respuesta lo informa. **No existe «proponer y aprobar»** (`INVALID_ACCION`).

### 16.5 Rechazar, retirar y revertir

- **Rechazar** (`ITF_RECHAZADO`): solo `PROPUESTO`; motivo obligatorio (`NO_CORRESPONDE_POZO`, `INCOMPLETO`, `ILEGIBLE`, `DUPLICADO`, `VERSION_INCORRECTA`, `OTRO`; `OTRO` exige texto). El archivo **no se borra ni se mueve**: queda para trazabilidad. No depende del legacy, de Drive ni del storage.
- **Retirar** (`ITF_RETIRADO`), tres caminos sin estados paralelos: (a) el **proponente** retira la **propia** pendiente (`retirarPropuestaItf`; motivo reservado `CANCELADO_POR_PROPONENTE`; la ajena o una inexistente dan el mismo `PERMISSION_DENIED`); (b) un **validador** retira cualquier pendiente con el catálogo institucional; (c) un **validador** retira el **vigente** (E9 o `LEGACY:<wellId>`), con motivo `ERROR_DE_APROBACION`, `DOCUMENTO_INCORRECTO`, `NO_CORRESPONDE_POZO`, `DESACTUALIZADO` u `OTRO`. Retirar el vigente deja el pozo `SIN_ITF` y **no restaura el anterior**. Si el vigente es el legacy implícito se registra su huella antes del retiro; el archivo físico no se mueve y el overlay deja de considerarlo vigente. Un retirado, reemplazado o rechazado no se vuelve a retirar (`DOCUMENTO_NO_RETIRABLE`).
- **Revertir / restaurar** (`ITF_REVERTIDO`), acción explícita: puede restaurar un E9 `REEMPLAZADO`, un `RETIRADO` que fue vigente o el legacy registrado; **no** una propuesta, un rechazado, un documento que nunca fue vigente ni el vigente actual (`DESTINO_INVALIDO`). Declara el destino y el vigente que el cliente vio (`vigenteEsperadoDocumentoId`, obligatorio si hay vigente): al restaurar A con B vigente, A queda `VIGENTE` y B `REEMPLAZADO` en un solo evento. Motivo obligatorio (catálogo de retiro). **Restaurar el legacy:** se vuelve a leer por el id de Drive **registrado**, se comprueba que sigue siendo el `<wellId>.jpg` único de la carpeta correcta y se recalcula la huella: si no coincide → `LEGACY_CAMBIO`; si ya no está → `LEGACY_NO_DISPONIBLE`. Nunca se restaura «el archivo que ahora tenga ese nombre».

### 16.6 Historial por pozo (`getHistorialItf`)

Contrato elegido: **por `wellId`**, porque muestra toda la evolución institucional (propuestas, aprobaciones, reemplazos, rechazos, retiros, reversiones y el registro del legacy) en una sola respuesta. Eventos del **más nuevo al más viejo**: `evento`, `documentoId`, `documentoReemplazadoId`, nombre de quien actuó, `timestamp`, `motivoCodigo`, `motivoTexto`, `detalle` (texto legible) y `estadoActualDocumento`; más `pozo` y `documentos` (con su estado actual, el legacy implícito incluido). Nada de email, hash, storage, secuencia ni `clientRequestId`. Para consultar por documento se usa `getItfDocumentoModeracion`.

### 16.7 Escrituras: respuesta, Historial, idempotencia

- Respuesta: `{documentoId, wellId, evento, estado, reintento, autoaprobado?}`; nada más.
- **Historial:** una fila por escritura exitosa (`aprobarItf`, `rechazarItf`, `retirarItf`, `revertirItf`, `retirarPropuestaItf`, igual que `proponerItf`); un reintento idempotente no escribe otra; sin imágenes, hashes ni ids de storage. Los errores dejan su fila con el código. Las lecturas no escriben en Historial. Sin Telegram.
- **Idempotencia:** todas llevan `clientRequestId` con namespace por email normalizado. Reintento exacto → mismo resultado sin evento nuevo; contenido distinto → `IDEMPOTENCY_CONFLICT`.
- Códigos para el validador (claros, sin texto de Drive ni del storage): `VIGENTE_CAMBIO`, `DOCUMENTO_NO_PROPUESTO`, `DOCUMENTO_NO_RETIRABLE`, `DESTINO_INVALIDO`, `ITF_NOT_FOUND`, `ITF_STATE_UNKNOWN`, `INCONSISTENT_STATE`, `LEGACY_AMBIGUO`, `LEGACY_NOMBRE_NO_CANONICO`, `LEGACY_CAMBIO`, `LEGACY_NO_DISPONIBLE`, `ITF_ARCHIVO_NO_DISPONIBLE`, `ITF_ARCHIVO_NO_COINCIDE`, `IDEMPOTENCY_CONFLICT`, `INVALID_*`, `SERVICE_UNAVAILABLE`.

### 16.8 Concurrencia (todo con lock + relectura + derivación)

| Caso | Resultado |
|---|---|
| A. Dos validadores aprueban propuestas distintas del mismo pozo | Gana el primero; el segundo recibe `VIGENTE_CAMBIO`, su propuesta sigue pendiente y el legacy se registra una sola vez. |
| B. Uno aprueba y otro rechaza la misma propuesta | Gana el primero; el segundo, `DOCUMENTO_NO_PROPUESTO`. |
| C. Retiro mientras otro reemplaza (y al revés) | El retiro sobre lo ya reemplazado da `DOCUMENTO_NO_RETIRABLE`; el reemplazo sobre lo ya retirado, `VIGENTE_CAMBIO`. |
| D. Reversión mientras otro aprueba (y al revés) | `VIGENTE_CAMBIO` al que llegó segundo. |

Después de cada carrera se comprueba que el pozo sigue derivable y con **a lo sumo un vigente**. Las secuencias son consecutivas.

### 16.9 Archivos físicos y lectura productiva

Aprobar y rechazar **no mueven archivos**: todo documento E9 vive en `ItfPropuestas/` aunque pase a vigente. El estado institucional vive en los eventos, no en la carpeta, lo que simplifica la reversión. Tras aprobar B, `itfService_resolverVigente` devuelve B (y `getProfile` de servicio entrega sus bytes); tras revertir A, devuelve A. **`getProfile` y la disponibilidad productivos siguen sin cablear** hasta tener la auditoría de la carpeta legacy.

### 16.10 Decisiones y cambios respecto del diseño anterior

| Tema | Antes | E9-5 |
|---|---|---|
| Nombre del vigente esperado | `documentoReemplazadoId` (comando interno) | el endpoint lo llama `vigenteEsperadoDocumentoId`; el servicio lo traduce |
| Archivo al aprobar / restaurar | no se comprobaba | se comprueba dentro del lock (existe, tipo y tamaño registrados) |
| Autoaprobación | solo marca en la derivación | además la respuesta de `aprobarItf` informa `autoaprobado` |
| Huella en DTO de validador | `itfDominio_dtoValidador` mostraba 12 caracteres | los DTO de E9-5 **no llevan ni el prefijo** del hash |
| Retiro de la propia propuesta | solo servicio | endpoint propio `retirarPropuestaItf` (permiso de proponer) |

### 16.11 Pendientes para E9-6

1. Resultado real de `auditarCarpetaItfLegacy()` (a cargo de quien lo ejecute): decide qué hacer con duplicados, mayúsculas y nombres inválidos **sin corregirlos automáticamente**; se prepara un informe aparte.
2. Interfaz: cola, ficha del documento (imagen + vigente a declarar), formularios de motivo, historial; y la vista del proponente (sus propias propuestas pendientes, hoy sin endpoint de lectura).
3. Despliegue ordenado: storage con las acciones de ITF y `ITF_ROOT_FOLDER_ID`, hoja `ItfEventos`, columnas `perfil_subir` / `perfil_validar` en `Usuarios`, recién entonces el interruptor.
4. Cablear `getProfile` / disponibilidad / descarga ZIP a `itfService_*` con la política legacy decidida.
5. Mediciones reales en Apps Script (límite de 3 MB y costo de derivar con muchos eventos).

### 16.12 Verificación de E9-5 (local)

- Jest completo en serie: 170 suites, 11.213 tests verdes; Python: 97 + 224 verdes; `git diff --check` limpio.
- Mutaciones: E9-5 **55 de 55 muertas**; E9-4 62/62, E9-3 59/59 y E9-2 75/75 repetidas sobre el código actual. En la primera corrida de E9-5 sobrevivieron 6: eran defensas en profundidad (el servicio repite el permiso, el interruptor, la lista blanca y la captura de excepciones del Api) que daban el mismo resultado visible; se agregaron pruebas que exigen que el Api corte **antes** de llamar al servicio y que no filtre el texto de una excepción. Dos mutantes de E9-3 dejaron de aplicar al agregar las lecturas y se reescribieron con contexto único.
- No se corrió nada contra Google ni se obtuvo aún el resultado real de `auditarCarpetaItfLegacy()`.

## 17. E9-6: experiencia de usuario completa (local, NO productivo)

Estado: implementado y probado EN LOCAL. NO hay push, `gas:*`, deploy, hoja `ItfEventos` real, columnas `perfil_subir` / `perfil_validar` en `Usuarios`, ni `ITF_E9_ACTIVO` encendido. Nada de esto se ve en producción mientras el interruptor siga apagado y nadie tenga los permisos nuevos.

### 17.1 Qué se agregó

| Pieza | Archivo | Qué hace |
| --- | --- | --- |
| Lógica pura | `js/itfLogic.js` | permisos exactos, catálogos de motivos, textos de estado / evento / error, formatos, validación del archivo elegido, plan de reducción de imagen, data: URI segura, foco de diálogos, ids de intención |
| Flujos con estado | `js/itfFlujosLogic.js` | Perfil, proponer, Mis propuestas (+ retiro propio), cola, visor / comparación, historial y el diálogo de aprobar / rechazar / retirar / restaurar; sin DOM, con dependencias inyectables |
| Imagen | `js/itfImagen.js` | decodifica (respeta la orientación), conserva o reduce con la escalera de §17.4 |
| Pantalla Perfil | `js/itfPerfil.js` | imagen vigente, guardar / compartir, proponer, Mis propuestas, retirar la propia propuesta, atajos del validador |
| Moderación | `js/itfModeracion.js` | pantalla «ITF pendientes», visor con comparación, diálogo de acción, historial |
| Cableado | `js/app.js`, `js/api.js`, `js/seleccion.js`, `index.html`, `css/styles.css`, `sw.js` | tarjeta del hub, availability al buscar, getProfile al abrir, Mi selección, ZIP, wrappers, markup, estilos, precache |
| Backend | `ItfDominioService.js`, `ItfService.js`, `Api.js` | `getMisPropuestasItf`, y `getProfile` / `getItfAvailability` detrás del interruptor |

### 17.2 Perfil: lo de siempre para quien solo tiene `perfil`

- Con solo `perfil === true`: imagen + «Guardar / Compartir», o «No hay un ITF vigente registrado para este pozo.». Sin estados internos, sin propuestas, sin uploader, sin historial.
- El ITF se pide **al abrir** Perfil (`getProfile`), con carga, error y reintento. Descargar usa el tipo real (un PNG vigente se guarda como `.png`).
- «No se sabe» (`ITF_STATE_UNKNOWN`) **nunca** se presenta como «no hay ITF»: es un error con mensaje propio.

### 17.3 Permisos (todos exactos, `=== true`)

| Permisos | Ve en Perfil | Hub |
| --- | --- | --- |
| solo `perfil` | imagen / mensaje | — |
| `perfil` + `perfil_subir` | + Proponer ITF / nueva versión, Mis propuestas (y retirar las propias pendientes) | — |
| `perfil` + `perfil_validar` | + Historial de ITF, Retirar ITF vigente | tarjeta «ITF pendientes» |
| los tres | todo lo anterior (autoaprobación = dos acciones) | tarjeta «ITF pendientes» |
| truthy inválidos (`"SI"`, `1`, objeto), `perfil_*` sin `perfil` | como solo `perfil` / nada | — |

El backend vuelve a validar cada acción; el cliente solo evita pedir lo que va a fallar. Cada acción se prueba con la matriz completa (itfLogic, flujos, controladores, backend).

### 17.4 Proponer y reducción de la imagen

- «Proponer ITF» (sin vigente) / «Proponer nueva versión» (con vigente); nunca «Subir ITF definitivo». Se elige JPEG o PNG del dispositivo (sin cámara especial). Se muestran nombre, vista previa, tamaño original, **tamaño final** y resolución; la vista previa es la imagen que **realmente** se envía.
- Validación de cliente (comodidad): tipo aparente y extensión, no vacío, ≤ 40 MB de entrada. El servidor sigue siendo la autoridad (mira los bytes reales y el límite de 3 MB).
- Reducción (legibilidad > ahorro; un ITF es un documento escaneado):

| Situación | Decisión |
| --- | --- |
| entra en 2,5 MB y su lado mayor ≤ 4096 px | **se conserva tal cual** (los mismos bytes; JPEG o PNG) |
| si no | JPEG, lado mayor ≤ 2400 px (≈ A4 a 200 dpi), calidad 0,92; si no entra: 0,88 → 0,84 → 0,80 → 0,76; si aún no: lado 2000 y luego 1600 con calidad 0,92 otra vez |
| PNG grande | se convierte a JPEG (la transparencia se aplana sobre blanco) |
| ni así ≤ 3 MB | **no se envía**: «La imagen sigue pesando X aun reducida (máximo 3 MB)» |

Mínimos: lado 1600 px y calidad 0,76 (por debajo el texto deja de leerse). Reducir con canvas descarta EXIF / GPS; **conservar** no toca el archivo (queda como lo mandó la persona).
- Estados: preparando imagen → enviando → «ITF propuesto. Queda pendiente de validación.» (nunca dice que ya es vigente); error con «Reintentar envío». El botón se deshabilita mientras envía (doble toque = **una** solicitud).
- `clientRequestId`: **uno por intención** (cada archivo elegido), el **mismo** en cada reintento (fallo de red / servicio), nuevo al elegir otro archivo; si el servidor responde `IDEMPOTENCY_CONFLICT` hay que volver a elegir el archivo.

### 17.5 Mis propuestas (`getMisPropuestasItf`, nuevo)

- Gate `perfil` + `perfil_subir`; el dueño sale **siempre de la sesión** (el cuerpo no acepta email, actor ni nombre). `wellId` es opcional y solo **acota** a un pozo. Misma paginación por secuencia que la cola (`limite`, `cursor`).
- DTO: `documentoId, wellId, estado (PROPUESTO | APROBADO | REEMPLAZADO | RECHAZADO | RETIRADO), esVigente, puedeRetirar, mimeType, bytes, nombreOriginal, timestampUtc, decididoEn, retiradaPorMi, motivoCodigo, motivoTexto`. Sin email, storage, hash, `clientRequestId`, secuencia ni el nombre de quien decidió.
- El motivo de un rechazo / retiro institucional **sí** sale (es lo que la persona necesita para corregir); retirar la propia no lleva motivo.
- Una lectura de la hoja por pedido, cero lecturas de storage / Drive.
- «Retirar propuesta» solo si sigue `PROPUESTO` (endpoint `retirarPropuestaItf` existente), con confirmación; después la lista **se vuelve a pedir** y pasa a «Retirada».

### 17.6 Cola, visor y comparación

- Hub: tarjeta «ITF pendientes» solo con `perfil` y `perfil_validar` exactos; **no carga nada** ni muestra badge. La primera página se pide al abrir la pantalla; «Ver más» sigue desde el cursor; cada tarjeta lleva pozo, archivo, tamaño, proponente, fecha y, si corresponde, el aviso de «mismo archivo en otro pozo». No se baja ninguna imagen hasta «Ver documento».
- Acciones por tarjeta: Ver documento, **Ver pozo** (va al hub de ese pozo y deja el atajo «Volver a ITF pendientes», que **conserva** la cola cargada), Historial, Aprobar, Rechazar.
- Visor: imagen grande con zoom (100 / 150 / 200 / 300 / 400 %), metadata segura, y el vigente actual del pozo. «Comparar con el ITF vigente» baja el vigente (una vez): **lado a lado ≥ 900 px**, **uno por vez con pestañas** en el celular. Sin OCR ni visión automática.

### 17.7 Aprobar, reemplazar, rechazar, retirar, restaurar

- **Aprobar** sin vigente: confirmación simple, sin motivo. Con vigente: «Esta aprobación reemplazará el ITF vigente actual.», motivo obligatorio (ACTUALIZACIÓN, CORRECCIÓN, MEJOR CALIDAD, DOCUMENTO COMPLETO, OTRO) y se envía `vigenteEsperadoDocumentoId` del contexto **que esa persona vio**. Desde la tarjeta (sin haber abierto el documento) el vigente se lee con `getHistorialItf` (sin imágenes) antes de habilitar el botón.
- **VIGENTE_CAMBIO**: «El ITF vigente cambió desde que abriste esta propuesta. Actualizá la información antes de decidir.»; se vuelven a pedir el contexto (visor + comparación) y la cola; **no** se reintenta solo.
- **Rechazar**: motivo obligatorio del catálogo (NO CORRESPONDE AL POZO, INCOMPLETO, ILEGIBLE, DUPLICADO, VERSIÓN INCORRECTA, OTRO); sale de la cola.
- **Retirar ITF vigente** (Perfil o historial): «El pozo quedará sin ITF vigente hasta que se apruebe o restaure otro.», motivo obligatorio; nunca borra el archivo.
- **Restaurar como vigente** (historial o visor de un documento anterior): si hay vigente lo reemplaza (se declara); motivo obligatorio, con frases propias de la restauración.
- Todos los diálogos: OTRO exige detalle de 3 a 300 caracteres; `Escape` cancela; el foco se queda dentro (Tab da la vuelta) y vuelve al botón que lo abrió (o al aviso del resultado si la tarjeta ya no existe); doble toque = una solicitud; un fallo transitorio se reintenta con el **mismo** id.
- Tras **cualquier** acción nada se parcha: la cola, el historial abierto y el contexto del visor se **vuelven a pedir**; el hub y la selección múltiple descartan lo cacheado de ese pozo.

### 17.8 Historial y documentos históricos

- «Historial de ITF» (solo `perfil_validar`): vigente actual, **documentos anteriores** (Ver / Restaurar; solo los que fueron vigentes y ya no lo son), y línea de tiempo del más nuevo al más viejo: Propuesto, Aprobado, Rechazado, Retirado, Restaurado, con persona, fecha, motivo y documento.
- El registro interno del ITF existente (`ITF_LEGACY_REGISTRADO`) **se oculta** en la línea de tiempo (lo escribe el sistema solo antes del primer reemplazo / retiro / restauración); el documento sigue apareciendo como **«ITF existente»**. Jamás se muestra `LEGACY:<wellId>`.
- Las frases las arma la pantalla (con tildes); no se usa el `detalle` crudo del servidor.
- **Autoaprobación**: sin UI especial ni advertencia. En el historial solo se agrega «Propuesto y aprobado por la misma persona.» a la frase de la aprobación.

### 17.9 Ubicación de «Mis propuestas» (decisión)

| Opción | Pro | Contra |
| --- | --- | --- |
| A. dentro de Perfil (elegida) | contexto del pozo, cero tarjetas nuevas, mismo permiso (`perfil` + `perfil_subir`) | hay que abrir un pozo; por eso hay un alcance «De todos los pozos» |
| B. tarjeta propia en el hub | acceso directo a todas | otra tarjeta más para un permiso de uso ocasional |

Se eligió A (la más simple): «De este pozo» por defecto (filtro **del servidor**) y «De todos los pozos» a un toque.

### 17.10 Lectura institucional detrás del interruptor (`getProfile`, availability, Mi selección, ZIP)

- `ITF_E9_ACTIVO` apagado (o ausente): `getProfile` y `getItfAvailability` son **exactamente** los de siempre (`profileService_getProfile`, índice por departamento); `ItfEventos` ni se lee.
- Encendido: `getProfile` → `itfService_getProfile` (documento E9 vigente o, sin eventos, el legacy); `getItfAvailability` → `itfService_disponibilidad` (una lectura de la hoja + una del índice legacy; un pozo **no determinable se omite**: el cliente lo trata como «no se sabe», nunca «No»). **Sin fallback al legacy** ante hoja ilegible, storage caído o historial no derivable: `SERVICE_UNAVAILABLE` / `ITF_STATE_UNKNOWN`.
- «Tiene ITF» = SÍ **solo** con vigente institucional: una propuesta pendiente, un rechazado, un retirado o un reemplazado nunca cuentan, ni en el hub, ni en Mi selección, ni en el ZIP (el ZIP y la descarga usan solo `getProfile`).
- El ZIP nombra cada archivo por el tipo real (`.png` / `.jpg`).
- Respuesta `getProfile` con la **misma forma** encendido o apagado; no filtra el origen ni ids.

### 17.11 Q1, Q2 y Q3

- **Q1 (implementado).** La tabla de Mi selección se **dibuja ya**; la columna «Tiene ITF» dice «Verificando…» (y el botón «Verificando…») y se repinta al llegar la disponibilidad; no se bloquea la tabla. Un lote caído o un pozo omitido queda en «—» (el botón «Ver ITF» sigue disponible: `getProfile` es la autoridad); **nunca «No»**. Antes de E9-6 la celda decía «No» para un pozo desconocido.
- **Q2 (implementado).** Buscar un pozo ya **no baja la imagen**: consulta `getItfAvailability([wellId])`; `getProfile` se pide recién al abrir Perfil. Hub: `true` → tarjeta Perfil; `false` → sin tarjeta (como hoy) salvo para quien puede proponer / validar y el pozo existe en otro módulo (para proponer el primer ITF); **desconocido** (pozo omitido, error de red o servicio) → tarjeta Perfil «Ver imagen ITF»: no se afirma que no existe y `getProfile` decide.
- **Q3 (NO implementado, a propósito).** La auditoría sigue como está: `getItfAvailability` deja una fila de Historial por llamada y `getProfile` otra al abrir. Se puede optimizar después de medir.

Medición local (arnés con backend simulado; imágenes sintéticas de 1200 × 1600; **no son tiempos de red**):

| Escenario | Antes (E9-5) | Después (E9-6) |
| --- | --- | --- |
| Buscar 3 pozos (2 con ITF) sin abrir Perfil: requests | 15 | 15 |
| ídem: bytes de respuesta | 771.057 (769.929 en 3 `getProfile`) | 1.246 (118 en 3 `getItfAvailability`) |
| Abrir Perfil de un pozo | 0 requests extra (la imagen ya se bajó) | +1 `getProfile` (384.927 bytes) |
| Mi selección, requests **en serie antes del primer dibujo** de la tabla | datasets → disponibilidad (2) | datasets (1); la disponibilidad llega en paralelo después |

El orden «tabla dibujada antes de que llegue la disponibilidad» está fijado por `js/itfSeleccionDisponibilidad.test.js`. Con ITF reales (cientos de KB a varios MB en base64) la diferencia de bytes crece en proporción.

**Riesgo de Q2 (DECIDIDO en E9-7, §18.1: se acepta el TTL de 1 h):** la decisión «existe Perfil» pasa de la lectura en vivo de Drive (`getProfile`) al índice por departamento cacheado (TTL de 1 h, tanto el de `ItfAvailabilityService` como el de `ItfLegacyProvider`). Un ITF legacy agregado a mano a la carpeta puede tardar hasta 1 h en aparecer en el hub de quien tiene solo `perfil`. Opciones: aceptarlo (la carpeta casi no cambia), bajar el TTL, o ofrecer siempre la tarjeta cuando el índice dice «No» (más requests). No se cambió nada del backend por esto.

### 17.12 Responsive, accesibilidad y seguridad

- Verificado en navegador (arnés local) a **375, 768 y 1280 px**: sin scroll horizontal en Perfil con paneles abiertos, cola, visor (comparación), diálogo de acción e historial. Comparación: pestañas por debajo de 900 px, lado a lado desde 900 px.
- Pila de diálogos: historial (85) < visor (90) < acción / retiro (100). El scroll del fondo se bloquea con un diálogo abierto.
- `role="dialog"` + `aria-modal` + `aria-labelledby`; `role="status"` / `role="alert"` para avisos y errores; `aria-pressed` en alcance y vistas; botones reales (`type="button"`); `<label for>` en motivo y detalle; foco visible; los estados no dependen solo del color (texto «Pendiente de validación», «Rechazada», …).
- Todo texto del servidor (nombre del archivo, nombre de la persona, detalle de un motivo) se pinta con `textContent`; ningún archivo nuevo usa `innerHTML` / `insertAdjacentHTML` / `eval` (guarda en `js/itfWiring.test.js`). La imagen llega por `data:` URI armada solo con tipo JPEG / PNG y base64 válido.
- Respuestas viejas: tokens + generaciones en cada flujo (como Fotos). `UNAUTHORIZED` / `USER_DISABLED`: flujo global (`logout()`); `PERMISSION_DENIED`: «No tenés permiso para hacer esto.». Al cerrar sesión se descartan imágenes, listas, previews (se liberan los blob URL), diálogos y lo que esté en vuelo.
- Cache del service worker: los cinco JS nuevos están en `SHELL_FILES` (precache); sigue network-first, sin versión manual.

### 17.13 Cambios de diseño respecto de E9-5

| Cambio | Motivo |
| --- | --- |
| `getMisPropuestasItf` (nuevo) con `wellId` opcional | el proponente necesitaba ver y retirar lo suyo |
| `getProfile` / `getItfAvailability` con interruptor | el vigente institucional pasa a ser lo que ve todo el sistema, sin fallback inseguro |
| `getProfile` encendido y dudoso → `ITF_STATE_UNKNOWN` (no `PROFILE_NOT_FOUND`) | «no se sabe» no es «no existe» |
| Guardas viejas actualizadas (`ItfContrato`, `ubicacionSugerenciasWiring`) | decían «el frontend no menciona `perfil_subir` / `perfil_validar`»; ahora esos permisos solo aparecen en la UI de ITF y el cableado |
| `permisosActuales` incluye `perfil_subir` / `perfil_validar` | para las compuertas exactas |

### 17.14 Bloqueos y pendientes para el rollout (todo sigue sin hacerse)

1. **Resultado real de `auditarCarpetaItfLegacy()`** (lo corre la persona responsable): incorporarlo antes de cualquier rollout; las anomalías (duplicados, mayúsculas, nombres inválidos) **no se corrigen automáticamente**: informe aparte («rollout cleanup»).
2. Despliegue ordenado (storage con `ITF_ROOT_FOLDER_ID`, hoja `ItfEventos` con su encabezado, columnas `perfil_subir` / `perfil_validar` en `Usuarios`, y **recién entonces** el interruptor).
3. Mediciones reales en Apps Script (límite de 3 MB, tiempos de `proponerItf`, lectura de la hoja con muchos eventos).
4. ~~Riesgo de índice cacheado de Q2~~ → decidido en §18.1 (TTL 1 h aceptado); Q3 (auditoría) queda como opción futura.
5. ~~EXIF / GPS de «conservar»~~ → decidido en §18.1 (no se recodifica; limpieza completa = deuda futura).
6. Verificar a mano en un navegador real el selector de archivos del celular y el guardado en iOS (la parte de canvas se probó con un navegador falso y con Chromium en el arnés).

## 18. E9-7: pre-rollout (preparación; E9 NO está en producción)

Estado: **E9 NO es productivo.** El backend de producción sigue en **v46** (deployment `…UZRq1Z`), el storage de producción en **v5**, el frontend publicado es el previo a E9 y `ITF_E9_ACTIVO` **no existe** como propiedad (= apagado). Esta sección fija las decisiones, la preparación y el procedimiento exacto del rollout. Nada de lo descrito acá como «futuro» se ejecutó.

### 18.1 Decisiones cerradas

| Tema | Decisión |
| --- | --- |
| **Q2 / TTL del índice** | Se **acepta el TTL actual de 1 hora** (`ITF_INDEX_CACHE_SECONDS = 3600` y el equivalente del proveedor legacy). **No se baja ahora.** Un ITF legacy agregado a mano a la carpeta puede tardar **hasta 1 h** en aparecer en el hub de quien solo tiene `perfil`. Es aceptable porque las cargas futuras deben pasar por E9 (propuesta → validación). |
| **Quien solo tiene `perfil` y el pozo no tiene ITF** | **NO** se muestra la tarjeta Perfil (comportamiento actual). Si además tiene `perfil_subir` o `perfil_validar`, **sí**, porque tiene acciones disponibles (ya implementado y probado). |
| **EXIF / GPS (E9 v1)** | Lo que se **reprocesa con canvas** (reducción o conversión) **sale sin EXIF / GPS**. Un archivo **pequeño que se conserva tal cual** **conserva su metadata**: no se recodifica obligatoriamente solo para quitarla. **Deuda futura documentada:** normalización / limpieza completa de metadata (p. ej. una pasada del servidor o una opción «quitar metadata» al proponer). No se implementó. |
| **Orden de la etapa** | Hacer `gas:push` **solo a `@HEAD`**; **no** crear versión ni actualizar el deployment productivo numerado; **no** ejecutar setups; **no** activar el interruptor; **no** publicar el frontend. |

### 18.2 Dónde vive cada cosa (nombres reales, derivados del repo)

| Qué | Dónde |
| --- | --- |
| Proyecto del backend | Apps Script **`dgi-pozos-backend`** (cuenta `main` de clasp). En el editor los archivos aparecen como `Nombre.gs`; en el repo son `backend/src/Nombre.js` |
| Auditoría de la carpeta legacy | archivo **`ItfLegacyAuditoria`**, función **`auditarCarpetaItfLegacy`** (solo lectura de nombres y tamaños) |
| Crear la hoja `ItfEventos` | archivo **`ItfEventosRepository`**, función **`setupItfEventosSheet`** (idempotente; esquema de **17 columnas**: `eventoId, secuencia, evento, documentoId, wellId, documentoReemplazadoId, mimeType, bytes, sha256, storageFileId, nombreOriginal, motivoCodigo, motivoTexto, email, nombre, timestampUtc, clientRequestId`) |
| Preflight de solo lectura, interruptor guardado, rollback y medición | archivo **`ItfPreflight`** (nuevo en E9-7): **`preflightItfE9`**, **`itfE9Encender`**, **`itfE9Apagar`**, **`medirRendimientoItfE9`** |
| Proyecto del storage | Apps Script **`DGI Fotos Storage`** (segunda cuenta de Google; cuenta `storage` de clasp) |
| Crear la carpeta raíz de ITF del storage | archivo **`StorageConfig`**, función **`setupItfPropuestasStorage`** (idempotente; crea / reutiliza `ItfPropuestas` en Mi unidad de la **segunda** cuenta y guarda `ITF_ROOT_FOLDER_ID`) |
| **Interruptor `ITF_E9_ACTIVO`** | **Script Property** del proyecto `dgi-pozos-backend` (no es constante ni otra fuente). Se lee **en cada pedido** (`PropertiesService.getScriptProperties()`), sin cache: apagarla corta E9 al instante, también para `@HEAD` y para las versiones numeradas |
| Valor apagado real | propiedad **ausente** (hoy). Encendido = exactamente **`SI`**; cualquier otro valor (`NO`, vacío, `si`, ` SI`, `true`, `1`) = apagado |
| Columnas de permisos | hoja `Usuarios` (se buscan por el **texto** del encabezado, cualquier orden): `perfil_subir`, `perfil_validar`. Una columna ausente = permiso `false` para todos (fail-closed); solo el valor `SI` (sin importar mayúsculas / espacios) habilita |

### 18.3 Storage: qué requiere E9

Diferencias del storage local contra el productivo (v5): **3 archivos modificados** (`StorageApi.js`, `StorageConfig.js`, `StorageDrive.js`), **0 nuevos, 0 eliminados**; solo **agrega** acciones (`putItf`, `getItf`, `metaItf`, `trashItf`), la función de setup y la tercera raíz. Las acciones de Fotos y Reemplazos no cambian (probado: con el storage nuevo y **sin** `ITF_ROOT_FOLDER_ID`, Fotos y Reemplazos funcionan igual y las acciones de ITF fallan cerradas sin crear nada).

E9 **sí** requiere en el storage:
1. **Nueva versión del storage** (`gas:push:storage` → `gas:version:storage` → `gas:deploy:storage` sobre el deployment numerado **existente**; la URL `/exec` no cambia). `.gas.local.json` hoy tiene `storage.pushHabilitado=false` y `deploymentId` vacío: hay que completarlos en el rollout (el ID forma parte de la URL secreta del storage: no se pega en chats ni en git).
2. **Una propiedad nueva**, `ITF_ROOT_FOLDER_ID`, **creada por `setupItfPropuestasStorage`** (no se edita a mano; no hace falta crear la carpeta a mano). Se corre **con la segunda cuenta**.
3. **Nada** más: el secreto (`FOTOS_STORAGE_SECRET`) y la URL (`FOTOS_STORAGE_URL`) del backend ya existen y se reutilizan.

No se hizo nada de esto todavía (solo lectura). El preflight verifica el storage con **una sola consulta de solo lectura** (`metaItf` de un archivo inexistente): `NOT_FOUND` = desplegado con las acciones de ITF y con raíz configurada; `UNKNOWN_ACTION` o error de raíz = «no configurado»; cualquier otra cosa = no responde.

### 18.4 Herramientas nuevas (solo manuales; ningún endpoint, trigger ni pantalla las llama)

- **`preflightItfE9()`**: SOLO LECTURA. Informa `interruptor` (ENCENDIDO / APAGADO), `listoParaEncender` y 7 comprobaciones (`carpeta_legacy`, `hoja_itfeventos`, `usuarios_hoja`, `usuarios_columna_perfil_subir`, `usuarios_columna_perfil_validar`, `storage_configurado`, `storage_itf`) con un texto por cada una, más **contadores** (eventos, usuarios activos con `perfil_subir` / `perfil_validar`; nunca emails). **No** escribe propiedades, hojas, Drive ni cache; **no** crea la hoja ni la carpeta; **no** cambia permisos ni sharing; **no** crea triggers; **no** imprime ids de Drive, URL, secreto, id del spreadsheet ni emails (probado con valores centinela). Hace una única llamada al storage (`metaItf`).
- **`itfE9Encender()`**: pone `ITF_E9_ACTIVO = SI` **solo si** el preflight está completamente en verde; si no, **no toca nada**, imprime qué falta y devuelve `{encendido:false, motivo:'PREFLIGHT_NO_OK', pendientes:[…]}`. Es la forma recomendada de encender.
- **`itfE9Apagar()`**: pone `ITF_E9_ACTIVO = NO`. **Siempre funciona** (sin condiciones): es el **rollback inmediato**. No borra eventos ni documentos.
- **`medirRendimientoItfE9()`**: SHA-256 de 100 KB / 500 KB / 1 MB / 3 MB sintéticos y disponibilidad legacy de 1 y 500 pozos (primera vez y repetida; la primera puede reconstruir el índice, que es el mecanismo de cache que ya usa la app). No es requisito del rollout; es opcional y no escribe nada salvo ese cache.
- Frontend: `scripts/medir_itf_consola.js` (pegar en la consola con sesión iniciada: `getItfAvailability` y `getProfile`) y, local, `scripts/medir_itf_propuesta.js`.
- Forma **inequívoca** de ON / OFF: `itfE9Encender()` / `itfE9Apagar()` (devuelven y registran el resultado) o, a mano, Configuración del proyecto → Propiedades de la secuencia de comandos → `ITF_E9_ACTIVO` = `SI` (ON) o `NO` / borrar la propiedad (OFF). `preflightItfE9()` siempre informa el estado actual.

### 18.5 Qué se subirá a `@HEAD` (backend) — diferencia exacta contra el remoto

Comparación `gas:diff:main` (repo local E9 vs Apps Script `@HEAD` actual; el remoto coincide con lo adoptado, sin deriva):

| Categoría | Archivos |
| --- | --- |
| **Nuevos (7 + 1)** | `ItfArchivoLogic.js`, `ItfDominioService.js`, `ItfEventosRepository.js`, `ItfLegacyAuditoria.js`, `ItfLegacyProvider.js`, `ItfService.js`, `ItfStorageProvider.js` y, de E9-7, `ItfPreflight.js` |
| **Modificados (5)** | `Api.js`, `AuthService.js`, `DriveProfileRepository.js`, `PozoExistenciaService.js`, `SheetUserRepository.js` |
| **Eliminados** | **0** |
| Manifiesto `appsscript.json` | igual (V8, zona horaria, acceso de la Web App, sin servicios avanzados) |

`@HEAD` es el deployment de pruebas (`/dev`); lo que sirve `/exec` (producción) es la **versión numerada**, que no cambia con un push. El proyecto **no tiene triggers** (ninguna llamada a `ScriptApp`): nada corre solo sobre `@HEAD`. Con la propiedad ausente, el código nuevo de `@HEAD` se comporta como el actual.

### 18.6 Matriz de compatibilidad (todo con prueba: `backend/test/ItfRolloutCompat.test.js` y `storage/test`)

| Combinación | Resultado verificado |
| --- | --- |
| **Frontend nuevo + backend con el interruptor APAGADO** (la propagación) | el Perfil sigue siendo el de siempre (availability al buscar, `getProfile` al abrir, imagen legacy); quien solo tiene `perfil` no ve nada colaborativo; con permisos E9 «adelantados», proponer / Mis propuestas / cola responden «La propuesta y validación de ITF todavía no están habilitadas.» sin escribir ni tocar la hoja ni el storage |
| **Backend nuevo + frontend viejo** | `getProfile` y `getItfAvailability` conservan exactamente su forma (apagado o encendido); las acciones nuevas son rutas nuevas; ninguna ruta vieja cambió de nombre |
| **Frontend nuevo + backend v46** (sin E9) | el backend v46 no devuelve `perfil_subir` / `perfil_validar` ⇒ permisos `false` ⇒ la interfaz colaborativa no aparece; availability / `getProfile` existen en v46 |
| **Storage nuevo + Fotos / Reemplazos viejos** | sin `ITF_ROOT_FOLDER_ID` las acciones viejas funcionan igual; las de ITF fallan cerradas |
| **`ItfEventos` vacía** (con el interruptor encendido) | availability, `getProfile`, cola y Mis propuestas = legacy / vacíos |
| **`ItfEventos` ausente** (con el interruptor encendido) | **no** cae al legacy: `SERVICE_UNAVAILABLE` (por eso el preflight exige la hoja **antes** de encender) |
| **Columnas `perfil_*` ausentes** | permisos `false` (repositorio real sobre hoja falsa) ⇒ `PERMISSION_DENIED` aunque el interruptor esté encendido |
| **Interruptor apagado** | `ItfEventos` y el storage **no se tocan** (con valores `NO`, `no`, vacío, `true`, `1`, `Si`, ` SI`, `SI `) |
| **Storage sin configurar / sin acciones de ITF, interruptor encendido** | proponer devuelve `ITF_STORAGE_NO_CONFIGURADO`; ninguna fila, ningún archivo: jamás queda habilitado |
| **Rollback con eventos ya escritos** | apagar no borra ningún evento ni documento; el Perfil vuelve al ITF legacy; al volver a encender todo reaparece |

### 18.7 Caches y propagación del frontend

- El service worker es **network-first** (con fallback a cache solo si no hay red); sin versión manual. Los 5 JS nuevos están en `SHELL_FILES` y se precachean con `cache: 'reload'` (no usan la cache HTTP).
- Una pestaña abierta con el JS viejo sigue usándolo hasta recargar; el JS viejo **es compatible** con el backend nuevo (§18.6). Un dispositivo con el JS nuevo y el backend con el interruptor apagado también.
- Por eso el orden de despliegue pone el **backend antes** que el frontend y el interruptor **al final**.

### 18.8 Orden de despliegue (validado; ajustado respecto del borrador)

Ajustes: (a) el storage va **antes** de encender y de cualquier prueba de propuesta; (b) se agrega el **preflight** como compuerta antes de crear la versión y antes de encender; (c) las columnas se **crean** (vacías) antes de la versión y se **habilitan** solo para el usuario del smoke justo antes de encender; (d) `ITF_E9_ACTIVO` se enciende solo con `itfE9Encender()`.

| # | Paso | Dónde / cómo | Quién |
| --- | --- | --- | --- |
| 1 | **Backup y configuración**: copia de la hoja `Usuarios` (Archivo → Hacer una copia) y de la hoja de Historial si se quiere; anotar **nombres** (no valores) de las Script Properties de los dos proyectos; anotar versiones vigentes (backend **v46**, storage **v5**) | manual | usuario |
| 2 | **Storage E9**: `gas:diff:storage` → `gas:adopt:storage` → `gas:push:storage` → `gas:version:storage` → `gas:deploy:storage` (deployment existente) → correr `setupItfPropuestasStorage` (proyecto `DGI Fotos Storage`, archivo `StorageConfig`, **segunda cuenta**) | clasp + editor | asistente / usuario |
| 3 | **Backend a `@HEAD`**: `gas:push:main` | clasp | **hecho en esta etapa** (ver §18.12) |
| 4 | **Auditoría legacy**: `auditarCarpetaItfLegacy` (§18.9); **detiene todo hasta analizar el resultado** | editor | usuario |
| 5 | **Crear `ItfEventos`**: `setupItfEventosSheet` (proyecto `dgi-pozos-backend`, archivo `ItfEventosRepository`) | editor | usuario (con instrucción explícita) |
| 6 | **Columnas de `Usuarios`**: agregar los encabezados `perfil_subir` y `perfil_validar` al final de la fila 1, **sin valores** (nadie habilitado) | manual | usuario |
| 7 | **Preflight**: `preflightItfE9` debe dar `listoParaEncender: true` | editor | usuario |
| 8 | **Nueva versión del backend**: `gas:version:main` (v47) | clasp | asistente |
| 9 | **Actualizar el deployment productivo con el interruptor APAGADO**: `gas:deploy:main -- --version 47` | clasp | asistente |
| 10 | Verificar el legacy en producción con el frontend **actual** (Perfil, Mi selección, ZIP) | manual | usuario |
| 11 | **Push de Git / Pages** (frontend nuevo) | git | asistente |
| 12 | **Verificar el frontend nuevo con el interruptor apagado** (combinación A de §18.6, en navegador real, también en iOS) | manual | usuario |
| 13 | **Habilitar permisos del smoke**: `perfil = SI`, `perfil_subir = SI`, `perfil_validar = SI` **solo** para la persona del smoke | hoja `Usuarios` | usuario |
| 14 | **Encender**: `itfE9Encender` | editor | usuario |
| 15 | **Sesión nueva** (cerrar sesión y volver a entrar: los permisos se cachean hasta 5 minutos en el backend) | app | usuario |
| 16 | **Smoke** (§18.11) | app | usuario + asistente |
| 17 | **Cierre de documentación** (marcar E9 productivo, registrar versiones y fecha) | repo | asistente |

### 18.9 Auditoría legacy: cómo correrla y cómo se va a analizar

Procedimiento exacto para la persona responsable (se detalla en el informe de la etapa): abrir el proyecto **`dgi-pozos-backend`**, seleccionar el archivo **`ItfLegacyAuditoria`**, seleccionar la función **`auditarCarpetaItfLegacy`** en el desplegable, **Ejecutar**, y copiar **todo** el contenido del registro de ejecución (JSON). Es de **solo lectura** de nombres y tamaños (no abre archivos, no escribe, no cambia permisos ni mueve nada) y se corta a los 4,5 min con `incompleto: true` (nunca informa un conteo parcial como total).

Qué se analizará: total de archivos, canónicos (`DD-PPPP.jpg`), no canónicos, `.JPG` / `.Jpg`, duplicados, nombres inválidos, pozos sin departamento válido, pozos con más de un candidato, distribución de tamaños, cuántos pasan de 3 MB, y si la auditoría quedó completa o incompleta.

Categorías y acción **futura** (propuesta; **no se ejecuta nada** y **no se corrigen archivos automáticamente**):

| Cat. | Qué es | Acción futura propuesta |
| --- | --- | --- |
| **A. Limpia / segura** | `<wellId>.jpg` único, ≤ 3 MB, JPEG | ninguna: es el vigente legacy implícito |
| **B. Nombre no canónico** | `DD-PPPP.JPG`, `.Jpg`, `.jpeg`, etc. | E9 los trata como «no se sabe» (no los muestra como vigente). Renombrar **a mano** a `DD-PPPP.jpg` previa verificación, o proponerlos por E9 |
| **C. Duplicado** | dos o más archivos para el mismo pozo | revisión manual: elegir el correcto y **proponerlo por E9**; los duplicados quedan sin tocar (no se borran) |
| **D. Huérfano** | nombre parece ITF pero el pozo no es válido (`00`, `20+`, `0000`) o no existe en el padrón | listar y decidir pozo por pozo; no se migra |
| **E. Tamaño grande** | > 3 MB | no entra como propuesta E9 tal cual (el cliente lo reduce); el legacy se sigue sirviendo. Decidir si se reduce con la herramienta de reducción |
| **F. Formato no soportado** | no es JPEG (PNG disfrazado, PDF, otro) | quedan fuera de E9 v1 (solo JPEG / PNG); proponer una versión en imagen |
| **G. Requiere revisión manual** | cualquier otro caso (nombre ambiguo, tamaño nulo, auditoría incompleta) | revisión humana antes del rollout; con la auditoría incompleta no se afirma nada |

### 18.10 Rollback

Principio: **apagar el interruptor primero**; no se borran eventos ni documentos; el deployment solo vuelve a v46 si hace falta.

| Falla | Síntoma | Acción (en orden) |
| --- | --- | --- |
| **A. El frontend E9 falla** | pantalla rota o JS con error en navegadores | 1) `itfE9Apagar()`; con el interruptor apagado el frontend se comporta como el legacy (§18.6, A); 2) si el defecto está en el JS, revertir el commit en `main` y republicar Pages (network-first: los clientes lo toman al recargar); 3) el backend no necesita cambios |
| **B. El backend E9 falla** | errores en `getProfile` / disponibilidad / login | 1) `itfE9Apagar()`; 2) si el problema persiste con el interruptor apagado, **`gas:deploy:main -- --version 46 --permitir-retroceso`** (v46 es la última versión productiva conocida; hacer `gas:deployments:main` antes para confirmar); 3) no hace falta tocar la hoja ni el storage |
| **C. El storage E9 falla** | `ITF_STORAGE_NO_CONFIGURADO` / `SERVICE_UNAVAILABLE` al proponer, aprobar o abrir | 1) `itfE9Apagar()`; 2) Fotos y Reemplazos no se ven afectados (acciones separadas); 3) si hay que volver, `gas:deploy:storage -- --version 5 --permitir-retroceso`; los archivos de `ItfPropuestas` **no se borran** |
| **D. `ItfEventos` falla** | hoja ilegible / esquema roto / filas dañadas | 1) `itfE9Apagar()` (con el interruptor apagado la hoja **ni se lee**); 2) **no** editar ni borrar filas: la hoja es append-only; un pozo con historial dañado queda en `ITF_STATE_UNKNOWN` (no se inventa estado) y se revisa a mano |
| **E. El interruptor causa problemas** | comportamiento inesperado al encender | `itfE9Apagar()`; verificar con `preflightItfE9()` que dice `APAGADO`; si la propiedad está mal escrita, corregirla en la Configuración del proyecto. El estado de E9 queda intacto y se retoma al volver a encender |

Con E9 apagado después de haber aprobado documentos E9, el Perfil vuelve a mostrar el **ITF legacy** (los eventos y archivos siguen guardados). Los usuarios con `perfil_subir` / `perfil_validar` ven «todavía no están habilitadas» en las pantallas colaborativas.

### 18.11 Plan de smoke (no ejecutado) y pozo de prueba

**Pozo de prueba:** no existe uno definido en el repo. **No se usará un ITF institucional real para mutaciones.** Propuesta: tras la auditoría legacy elegir un pozo **del padrón sin ITF** (availability `false` y sin archivo en la carpeta) y **bajo control de la persona responsable**, con imágenes obviamente de prueba («PRUEBA E9 – NO USAR»). Así el estado final se puede dejar **igual al inicial** (sin ITF) retirando el último vigente; el historial conserva el rastro (append-only). La ruta «reemplazo del legacy» está cubierta por pruebas automáticas y **no** se ejercita sobre un ITF real; si se quisiera probarla, solo sobre un pozo de prueba acordado con una copia.

Secuencia (todo con el pozo de prueba): **A.** login nuevo → **B.** permisos visibles (tarjeta «ITF pendientes»; en Perfil: Proponer, Mis propuestas, Historial) → **C.** el Perfil legacy sigue funcionando en un pozo **distinto** que ya tenga ITF (solo lectura) → **D.** proponer un ITF de prueba → **E.** aparece en «Mis propuestas» → **F.** aparece en «ITF pendientes» → **G.** abrirlo y comparar → **H.** rechazar una propuesta de prueba (con motivo) → **I.** nueva propuesta → **J.** aprobar → **K.** el Perfil muestra el nuevo vigente (y `getItfAvailability` / Mi selección lo cuentan) → **L.** el historial muestra el anterior → **M.** restaurar el anterior → **N.** estado final: retirar el vigente de prueba (queda «sin ITF») y verificar el historial; confirmar que **no** se tocó ningún otro pozo, y que `Historial` registró las acciones. Después: si algo falla, rollback (§18.10).

### 18.12 Garantías del preflight y del `gas:push` a `@HEAD`

- **Ningún paso de preflight** expone ids de Drive, publica una carpeta, cambia sharing, habilita usuarios, crea triggers ni activa la feature (el código no tiene cómo: probado por inspección del fuente y con valores centinela).
- `gas:push:main` sube **solo** `backend/src/*.js` + `appsscript.json` a `@HEAD`; **no** crea versión ni toca el deployment numerado. Las guardas del wrapper (huella confirmada, árbol limpio, sin deriva, sin solo-remotos) se aplican igual.
- Verificación posterior: remoto = repo; `gas:deployments:main` debe seguir mostrando **v46** y el deployment `…UZRq1Z` apuntando a v46.
- **Hecho el 30/10/2026** (commit `e0c475f`): `gas:push:main` a `@HEAD` verificado — remoto idéntico al repo (53 archivos + manifiesto; 8 agregados, 5 modificados, 0 eliminados). Después: `gas:deployments:main` sigue mostrando **v46** (última versión: 46) y `…UZRq1Z` → v46; `@HEAD` (`…iHYjIM`) es solo pruebas; el storage no se tocó (v5); el frontend de Pages sigue sin los archivos de E9 (`js/itfLogic.js` → 404); `origin/main` sigue en `efc9262` (no se hizo `git push`). No se ejecutó ningún setup, no se creó la hoja, no se cambió `Usuarios` y `ITF_E9_ACTIVO` no existe.

### 18.13 Bloqueos antes de cualquier setup o cambio productivo

1. **Resultado de `auditarCarpetaItfLegacy()`** (pendiente de la persona responsable) y su análisis / categorías (§18.9).
2. Elegir el **pozo de prueba** (§18.11).
3. Completar `.gas.local.json` del storage (`pushHabilitado`, `deploymentId`) y desplegar el storage E9 (§18.3).
4. Confirmar la persona del **smoke** y su correo en la hoja `Usuarios` (el correo **no** va en documentación).
5. Mediciones reales en Apps Script (límite de 3 MB, tiempos; opcional, §18.4).
6. Deuda: limpieza completa de metadata (§18.1) y, si se quiere, Q3 (auditoría).
