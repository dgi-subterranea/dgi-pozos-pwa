# UbicacionFuenteDecisiones — propuesta técnica (NO implementada)

Capa **append-only y auditable** para que una persona autorizada **acepte o descarte la coordenada de una fuente registral** (Reporte Pozos / Irrigación) sin tocar nunca el dato original. Es un concepto distinto de las **correcciones de campo** (`UbicacionCorrecciones`: propuesta → validada / rechazada / superada / revertida); no se mezclan hojas, estados, endpoints ni etiquetas.

Estado de este documento: propuesta + auditoría de los CSV reales. Decisiones de producto cerradas el 14 oct 2026 (ver §1 y §12). **Etapa 1 (dominio puro + paridad con Python) implementada**: ver «Etapa 1 — implementada» al final; donde esta propuesta original difiere (eventos, esquema), manda esa sección. Contexto previo: `docs/ubicacion-correcciones.md` (modelo de fuentes, sección «Ubicaciones conocidas»).

---

## 0. Auditoría SOLO LECTURA de los CSV exportados

Archivos (no se modificaron; están ignorados por git): `DGI Pozos - Usuarios - UbicacionCorrecciones.csv` (exportado 13 oct 20:38) y `…UbicacionCorreccionesLog.csv` (13 oct 22:44). UTF-8 sin BOM, CRLF, sin caracteres de reemplazo (los `°` y las tildes están bien). Los correos y nombres **no se reproducen** acá.

| Pregunta | Resultado |
|---|---|
| Filas | **3** correcciones y **7** eventos de log |
| Pozos | **2**: `14-0001` (2 correcciones) y `01-0012` (1) |
| Métodos | `PUNTO_EN_MAPA` ×2, `COORDENADAS_GMS` ×1. **Nunca** `GPS_ACTUAL` ni `COORDENADAS_POSGAR94_AR2` (`precisionGpsM` vacío en las 3) |
| Distancias a Irrigación | 22,2 m, 22,2 m y **0,0 m** (recalculadas con haversine: coinciden con lo guardado) |
| `advertenciaDistancia` | nunca (ninguna > 1 km) |
| Estados derivados (reconstruidos del log) | 2 **VALIDADA** vigentes (`01-0012`, y la GMS de `14-0001`) y 1 **SUPERADA** (la primera de `14-0001`) |
| Pendientes (PROPUESTA) | **0** |
| RECHAZADAS / REVERTIDAS | **0 / 0** — esos caminos **nunca corrieron con datos reales** (solo con tests) |
| VALIDADA + SUPERADA | `14-0001`: la validada por mapa (22,2 m, auto-validada al crearla) fue superada por la GMS a 0,0 m |
| `coordenadaOriginalTexto` / `crsOriginal` | solo la GMS: `33° 20' 51.54" S, 69° 8' 43.62" O` / `GMS_WGS84`; convertida da exactamente `-33.347650, -69.145450` (= la coordenada de Irrigación) |
| Duplicados / `clientRequestId` repetidos / `correccionId` repetidos | **ninguno** |
| Huérfanos (log sin corrección, corrección sin evento) | **ninguno**; las 3 cadenas son válidas (PROPUESTA → VALIDADA [→ SUPERADA]) |
| Datos de prueba | 2 de los 3 `clientRequestId` son de prueba (`test-…`); el tercero es de la UI real (`ucorr-<uuid>`) |

Hallazgos que **afectan el diseño**:

1. **Mismo segundo, orden por fila.** Hay dos pares de eventos con el mismo `timestamp` (`PROPUESTA`+`VALIDADA` de la auto-validación, y `SUPERADA`+`VALIDADA` de `14-0001` a las 12:34:13). Hoy el orden lo da la posición de la fila. → La nueva hoja necesita una columna **`secuencia`** explícita; no se puede ordenar por fecha.
2. **El timestamp exportado no tiene zona** (`2026-10-12 03:41:29`, formato de Sheets). → Guardar el instante como **texto ISO UTC** (el API ya responde ISO) y ordenar por `secuencia`.
3. **Las correcciones solo guardan el punto resuelto de Irrigación, no cada fuente** (`irrLat/irrLon/irrEstado/irrFuente`). No se puede reconstruir cuál fuente era la operativa cuando se corrigió. → Las decisiones guardan **snapshot por fuente** (`x`, `y`).
4. **Dos vocabularios para la fuente:** `irrFuente` = `coordProvincia` (padrón, pozo con una sola fuente) y `VARIAS_FUENTES` (corroborada); el frontend usa `IRR_PROVINCIA` / `IRR_VARIAS`. → La capa nueva define su propio `fuenteTipo` (`REPORTE_POZOS` / `IRRIGACION`) y el mapeo es explícito.
5. **Caso `14-0001`:** una validada en campo a 0,0 m de una fuente registral convive con esa fuente. Es el solapamiento semántico a cuidar: *Validada en campo (0 m)* ≠ *Aceptada* (decisión de gabinete). Deben verse como filas distintas aun con la misma coordenada.
6. **Los CSV son una foto vieja** (último evento: 13 oct 12:34). No hay datos de hoy.
7. `revertir`, `rechazar` y las pendientes nunca se usaron en producción real: el diseño nuevo no puede apoyarse en su comportamiento observado, solo en sus tests.

---

## 1. Decisiones de producto (cerradas)

1. **Prioridad del punto operativo:** (1) corrección VALIDADA en campo → (2) fuente registral ACEPTADA → (3) resolver automático sobre fuentes no descartadas → (4) sin punto. La validada en campo **siempre** gana.
2. **ACEPTADA** = «fuente registral elegida manualmente como referencia operativa». **No** es «Validada en campo». Máximo **una** vigente por pozo; aceptar otra deja a la anterior no vigente (historial intacto).
3. **DESCARTADA:** la fuente sigue existiendo y visible, claramente marcada «Descartada», **no participa** del resolver; motivo obligatorio; nunca se borra ni se modifica su coordenada.
4. **RESTAURAR:** conserva el historial, vuelve a estado neutral, vuelve al resolver automático, **no** la acepta.
5. **Reindexados:** la identidad incluye el snapshot `wellId + tipoFuente + x + y`. Si cambia la coordenada, la decisión queda histórica, **no se hereda** y la nueva coordenada es neutral / sin revisar.
6. **UI futura:** estados *Sin revisar / Aceptada / Descartada / Punto operativo / Validada en campo*; la corrección de campo **no** usa Aceptar/Descartar.

---

## 2. Identidad de la fuente

`fuenteKey = wellId | fuenteTipo | x | y` con `x`, `y` normalizados a **3 decimales** (`toFixed(3)`; el padrón tiene milímetros).

- `fuenteTipo`: `REPORTE_POZOS` o `IRRIGACION`. **No** se guarda el número «(2)»: es posicional y puede cambiar en un reindexado.
- Una decisión **solo se puede escribir** sobre una fuente que **existe hoy** en el padrón del pozo (el backend lo lee y compara; si no, `SOURCE_NOT_FOUND`). Fail-closed: el cliente no puede inventar una clave.
- **Obsoleta** (se *deriva*, no se guarda): una clave con decisiones cuyo `(tipo, x, y)` ya no está en el padrón. Se conserva en el historial, **no aplica** y no se hereda a la coordenada nueva.
- Caso límite: dos filas del padrón con idéntico `(tipo, x, y)` comparten clave y estado (se muestran como una). Si Reporte Pozos e Irrigación tienen la **misma** coordenada, son claves distintas (cambia `fuenteTipo`).

---

## 3. Esquema de la hoja `UbicacionFuenteDecisiones` — versión FINAL (Etapa 2)

Una sola hoja, **una fila = un evento**, append-only (nunca se edita ni se borra una fila desde la app; mismo libro que `UbicacionCorrecciones`). Se crea con `setupUbicacionFuenteDecisionesSheet()` (idempotente, fail-closed, **no se ejecuta sola**). **14 columnas**:

| # | Columna | Tipo | Contenido |
|---|---|---|---|
| 1 | `decisionId` | texto | UUID v4 generado en el servidor |
| 2 | `secuencia` | entero | autonumérico **global** (`max + 1` bajo lock). Define el orden; la fecha no se usa jamás para ordenar |
| 3 | `wellId` | texto | `DD-PPPP` |
| 4 | `fuenteTipo` | texto | `REPORTE_POZOS` \| `IRRIGACION` |
| 5 | `x` | número (0.000) | Este POSGAR 94 / Argentina 2, normalizado a 3 decimales |
| 6 | `y` | número (0.000) | Norte |
| 7 | `evento` | texto | `ACEPTADA` \| `DESCARTADA` \| `ACEPTACION_QUITADA` \| `RESTAURADA` |
| 8 | `motivo` | texto ≤ 300 | obligatorio en `DESCARTADA`; opcional en el resto |
| 9 | `email` | texto | de la **sesión**, normalizado (idempotencia por usuario y auditoría interna; nunca sale por la API) |
| 10 | `nombre` | texto | foto del nombre al decidir (sí sale por la API, igual que `nombrePropone` en las correcciones) |
| 11 | `timestampUtc` | texto | ISO 8601 UTC con milisegundos y `Z` (p. ej. `2026-10-14T14:32:10.123Z`), guardado como **texto** |
| 12 | `clientRequestId` | texto 8–64 | idempotencia, único **por usuario** |
| 13 | `versionVista` | entero | la versión del pozo que el cliente tenía al decidir (auditoría + comparación de reintentos) |
| 14 | `padronPeriodo` | texto | período del padrón con el que se decidió (contexto si luego queda obsoleta por un reindexado) |

**Qué se quitó respecto de la propuesta vieja y por qué:** `causaDecisionId` y los eventos `SUPERADA` / `REEVALUADA` (el reemplazo de la aceptada anterior se deduce del orden); `lat` / `lon` (derivables de `x`/`y`); la clave canónica (derivable de `wellId`+`fuenteTipo`+`x`+`y`); `etiquetaFuente` («Irrigación (2)» es posicional, no identidad); `resultadoLat/Lon/Estado` (el punto operativo registral posterior a cada evento se obtiene reproduciendo hasta esa secuencia; si la Etapa 3 necesitara un snapshot para el delta, se **agregan** columnas al final, como ya se hizo en las correcciones V2). Las columnas se buscan por el texto del encabezado (reordenarlas a mano no rompe nada); si falta o se repite alguna, **todo falla cerrado**. Texto plano (`@`) en todo menos `secuencia`, `x`, `y` y `versionVista`: un motivo que empiece con `=`, `+`, `-` o `@` nunca se evalúa como fórmula.

**Secuencia sin celda mutable:** `max(secuencia de TODAS las filas) + 1`, calculado **dentro del lock** con la lectura completa que ya hace falta para derivar el estado. Costo: una lectura de la hoja entera por escritura (cientos de filas: milisegundos). Límite conocido: si alguien borra a mano las últimas filas, la secuencia podría reusarse; borrar filas es manipulación fuera de la app y no se intenta detectar. Una secuencia repetida (p. ej. pegada a mano) deja el pozo `INCONSISTENTE`.

---

## 4. Máquina de estados (por `fuenteKey`) — versión final en «Etapa 1 — implementada»

Estados **derivados**: `SIN_REVISAR` (no hay eventos), `ACEPTADA`, `DESCARTADA`.

| Desde | Acción del usuario | Evento que se escribe (UNA fila) | Hacia |
|---|---|---|---|
| `SIN_REVISAR` | Aceptar | `ACEPTADA` (si había otra aceptada en el pozo, deja de serlo por el orden de eventos) | `ACEPTADA` |
| `SIN_REVISAR` | Descartar (motivo obligatorio) | `DESCARTADA` | `DESCARTADA` |
| `ACEPTADA` | Quitar aceptación | `ACEPTACION_QUITADA` | `SIN_REVISAR` |
| `ACEPTADA` | Descartar (motivo obligatorio) — **un solo paso** | `DESCARTADA` (implica que deja de estar aceptada) | `DESCARTADA` |
| `DESCARTADA` | Restaurar | `RESTAURADA` | `SIN_REVISAR` (**no** pasa a aceptada) |
| `DESCARTADA` | Aceptar | — | **`INVALID_TRANSITION`**: primero restaurar |
| mismo estado | repetir la acción | — | `ALREADY_IN_STATE` (sin escribir) |

- **«Quitar aceptación» es una acción propia** (decisión cerrada); `RESTAURADA` queda solo para descartadas.
- **Un único aceptado vigente por pozo** se cumple **por construcción**: al reproducir los eventos por `secuencia`, el `ACEPTADA` más nuevo reemplaza al anterior. No hace falta un evento `SUPERADA` ni escribir dos filas; la historia es inequívoca (el ítem anterior queda anotado «reemplazada por …»). El invariante se verifica igual (`ufd_verificarInvariantes`) como defensa.
- Cadena inválida (p. ej. `RESTAURADA` sin `DESCARTADA` previa, o columnas rotas por edición manual) → esa clave es `INCONSISTENTE`: se trata como `SIN_REVISAR` para el punto operativo y se informa aparte (mismo criterio que las correcciones).

### Cómo se calcula el estado vigente
1. Leer todas las filas, ordenar por `secuencia`, agrupar por `wellId` y por `fuenteKey`.
2. Por clave: reproducir los eventos validando cada transición; el estado es el que deja el último evento.
3. Por pozo: ¿hay exactamente una `ACEPTADA` con clave presente en el padrón de hoy? → es la aceptada vigente.
4. Marcar `OBSOLETA` toda clave con decisiones que ya no esté en el padrón.
5. Calcular el punto operativo registral (§5).

---

## 5. Reglas del punto operativo (con la capa nueva)

Prioridad (la validada en campo es, además, la **única** que cambia el estado a «Validada en campo»):

| Regla | Condición | Punto | Estado | Fuente | Confianza |
|---|---|---|---|---|---|
| **R1** (ya existe) | hay corrección VALIDADA vigente | la de campo | `VALIDADA_CAMPO` | `CAMPO_CORREGIDA` | A |
| **R1b** (nueva) | no hay R1 y hay fuente `ACEPTADA` vigente y presente en el padrón | las x/y de esa fuente | **`ACEPTADA`** (estado nuevo) | `IRR_REPORTE` o `IRR_PROVINCIA` (la fuente elegida) | B |
| **R2** (hoy, adaptada) | ni R1 ni R1b: resolver automático sobre las fuentes **no descartadas** | el que dé el resolver | `COINCIDENTE` / `DISPONIBLE` (o discrepancia) | `IRR_REPORTE` / `IRR_PROVINCIA` / `IRR_VARIAS` | B / C / D |
| **R0** | sin fuentes utilizables | ninguno | `SIN_COORDENADAS` (con anomalía `TODAS_DESCARTADAS` si fue por decisiones) / `DISCREPANCIA` | — | — |

- **La aceptada gana al automático** aunque este diga `COINCIDENTE`: una elección humana explícita pesa más. Estado y fuente siguen siendo campos separados.
- **Descartar** saca la fuente del cálculo: se aplican las **mismas reglas y umbrales de `scripts/reindex_pozos.py`** sobre las restantes (≤ 10 m corroborada; ≤ 50 dudoso leve; ≤ 500 revisar; > 500 revisar grave; una sola = `unica`; ninguna = `sinCoordenadas`). Ese cálculo hoy es **offline en Python**: hay que **replicarlo en JS** (backend + frontend, código idéntico verificado por test, como `CoordenadasConversion.js`) con **test de paridad contra casos generados por el propio Python** (mismo método que `gen_vectores_posgar.py`).
- **Con una validada en campo** las decisiones registrales **no cambian el punto** (siguen guardándose y mostrándose; la UI lo dice). Al **revertir** la validada, el pozo vuelve al padrón **con las decisiones aplicadas**.
- **Un pozo que queda sin punto** (descartaron todo, o el resto está en discrepancia) debe **desaparecer del mapa**: el dataset solo trae pozos con punto. Requiere que el overlay sepa **quitar** un punto (hoy solo reemplaza o agrega).
- Estado nuevo `ACEPTADA` → código de dataset **`R`** (sugerido; evita chocar con las letras de confianza `A–D`) con etiqueta «Aceptada» y chip/estilo propios en el mapa.

---

## 6. Endpoints

Convenciones del proyecto: `POST {action, sessionToken, …}`, identidad **solo de la sesión**, lista blanca de campos, errores `{status:'error', code, message}`, auditoría en `Historial`, todo fail-closed.

| Acción | Permisos | Cuerpo (mínimo) | `data` |
|---|---|---|---|
| `getDecisionesFuentesPozo` | `ubicacion` | `wellId` | `{wellId, version, fuentes[], historial[], obsoletas[], efectoRegistral, anomalias[]}` |
| `decidirFuenteUbicacion` | `ubicacion` + `ubicacion_validar` | `wellId, fuenteTipo, x, y, decision, motivo?, clientRequestId, versionVista` | `{decision, fuentes[], version, efectoRegistral, supersedidas[], duplicada}` |
| `getDecisionesFuentesDelta` | cualquier usuario **activo** (como `getUbicacionesValidadas`) | — | `{decisiones: [{wellId, lat, lon, estado, fuente, vts}], total}` |

Detalle:

- **`decision`** ∈ `ACEPTAR` \| `DESCARTAR` \| `RESTAURAR` \| `QUITAR`. Un solo endpoint de escritura: la tabla de transiciones queda en un solo lugar.
- **`versionVista`** = la `version` del pozo que el cliente tenía al abrir (la `secuencia` máxima de ese pozo, 0 si no hay). Si cambió, `STALE_STATE` y el cliente vuelve a leer (ver §7). Evita pisar la decisión de otra persona sin saberlo.
- **`fuentes[]`** (por fuente actual del padrón): `{fuenteTipo, x, y, lat, lon, etiqueta, estado: SIN_REVISAR|ACEPTADA|DESCARTADA|INCONSISTENTE, esOperativa, ultima: {evento, nombre, timestamp, motivo}|null}`. Nunca emails.
- **`historial[]`**: eventos del pozo (sin emails): `{decisionId, evento, fuenteTipo, x, y, etiquetaFuente, nombre, timestamp, motivo, obsoleta}`; incluye las claves obsoletas.
- **Delta (payload mínimo):** por pozo con efecto registral **distinto del automático original**: `{wellId, lat, lon, estado, fuente, vts}` con `estado` ∈ `ACEPTADA | COINCIDENTE | DISPONIBLE | SIN_PUNTO` (en `SIN_PUNTO`, `lat/lon = null`: el cliente **quita** el punto). Sin `nombre`, `motivo`, `email`, `x/y`, historial ni cantidades.
- **Errores:** `UNAUTHORIZED`, `USER_DISABLED`, `PERMISSION_DENIED`, `INVALID_WELL_ID`, `WELL_NOT_FOUND`, `SOURCE_NOT_FOUND`, `INVALID_TRANSITION`, `ALREADY_IN_STATE`, `MOTIVO_REQUERIDO`, `INVALID_DECISION`, `INVALID_CLIENT_REQUEST_ID`, `IDEMPOTENCY_CONFLICT`, `STALE_STATE`, `INCONSISTENT_STATE`, `SERVICE_UNAVAILABLE`.
- **Endpoint aparte para el delta** (no se amplía `getUbicacionesValidadas`): el contrato ya desplegado no se toca, se despliegan y fallan por separado y cada uno tiene su caché. El cliente los pide **en paralelo**.

---

## 7. Concurrencia, idempotencia, logs y caché

**Concurrencia.** `LockService.getScriptLock()` (mismo patrón que `ubicacionCorreccionRepository_conLock`). Fuera del lock: validar permisos y forma, **leer el padrón del pozo** (existencia de la fuente, snapshot). Dentro del lock: releer **todos** los eventos, comprobar `versionVista` (→ `STALE_STATE`), validar la transición, calcular `secuencia` y `resultado*`, y escribir **una sola fila** (el evento; el reemplazo de la aceptada anterior se deduce del orden, no hace falta una segunda fila). Un solo libro y una sola hoja: **no existe la escritura parcial** entre hojas que obligó al autocurado de las correcciones. Dos validadores simultáneos se serializan; el segundo recibe `STALE_STATE` (nada se pisa en silencio).

**Idempotencia.** `clientRequestId` obligatorio y único **por usuario**. Repetir la misma solicitud (mismo pozo, clave, decisión y motivo) devuelve la decisión ya escrita con `duplicada:true` sin escribir otra, aunque el padrón haya cambiado; reutilizarlo con otro contenido = `IDEMPOTENCY_CONFLICT`. La comparación incluye el `fuenteKey`.

**Logs / auditoría.** (1) La propia hoja es el registro de dominio (quién, cuándo, motivo, qué punto operativo resultó). (2) `Historial`: `decidirFuenteUbicacion` con `OK` y cada código de error (`PERMISSION_DENIED`, `INVALID_TRANSITION`, `STALE_STATE`, …); no se auditan lecturas ni reenvíos idempotentes. **Sin Telegram.** (3) Opcional, más adelante: aviso por email a validadores como en las correcciones (no necesario para la v1).

**Caché.** Clave nueva `decisiones_fuentes_v1` (CacheService, 120 s), con el **mismo diseño** que `ubicaciones_validadas_v1`: marcador de invalidación + margen de 2 s contra carreras, sin caché si supera 90.000 caracteres, y **nunca** una falla de caché rompe la operación. Se invalida después de **toda escritura confirmada** (cualquier evento). El cliente guarda el delta 60 s en `mapaDataset` y llama `mapaDataset_invalidarDeltas()` tras decidir. El padrón por pozo sigue cacheado 600 s por `RegistryRepository` (no cambia).

---

## 8. Interacciones

- **`mapaDataset_obtener` (único punto del overlay):** pide `getMapaPozos` + `getUbicacionesValidadas` + `getDecisionesFuentesDelta` en paralelo, **cada uno con su fallback** (si el delta registral falla: dataset base + aviso discreto, igual que hoy). Composición: (1) delta registral sobre el dataset base (cambia `lat/lon/estado/fuente`, o **quita** el punto si `SIN_PUNTO`); (2) encima, el overlay de campo existente (R1 gana). `base` sigue siendo «lo que dice Irrigación» y se define si es el automático original o el efecto registral (recomendado: **efecto registral**, así Reemplazos no compara contra una fuente descartada).
- **Cerca Mío, selección, mapa provincial, reemplazos:** todos consumen `mapaDataset_obtener`, así que **heredan** el cambio. Hay que tocar solo las etiquetas/filtros del estado nuevo `R` (`mapaLogic`, estilos del mapa, exportación de la selección, texto de Buscar reemplazo) — la misma lista de archivos que tocó el estado `V`.
- **Ficha del pozo:** «Ubicación de Irrigación» muestra el punto operativo **con** decisiones (con la leyenda «Fuente aceptada manualmente» cuando corresponda). «Ubicaciones conocidas» suma, **por fuente**, el estado (*Sin revisar / Aceptada / Descartada*), el chip «Punto operativo», y —solo a quien tenga `ubicacion_validar`— las acciones. Las descartadas siguen visibles, atenuadas y rotuladas «Descartada», con su motivo; conservan su enlace a Google Maps. La fila **«Validada en campo» no tiene** Aceptar/Descartar. El visor comparativo muestra el estado en cada marcador y las acciones en el popup (con confirmación; el motivo es un campo obligatorio al descartar).
- **Correcciones de campo:** no se modifican. `ubicacionOperativaLogic_resolver` recibe una entrada opcional nueva (`registral`) y agrega R1b entre R1 y R2.
- **Fuentes originales:** nada escribe en el padrón ni en `pozos.json`; las decisiones viven solo en la hoja.

---

## 9. Permisos (F)

| Qué | Permiso | Notas |
|---|---|---|
| Ver estados y historial por pozo | `ubicacion` | como `getCorreccionesUbicacionPozo` |
| Aceptar / Descartar / Restaurar / Quitar | `ubicacion` + `ubicacion_validar` | sin permiso nuevo; fail-closed (`SI` exacto, usuario activo); la UI oculta los botones pero **el backend manda** |
| Delta para los mapas | cualquier usuario activo | solo lat/lon/estado/fuente/vts |
| Proponer una decisión (flujo con aprobación) | — | **no incluido**: las decisiones las toma quien valida. `ubicacion_corregir` solo **no** puede decidir. Se puede agregar más adelante si se necesita |

Un validador **puede** decidir sobre cualquier pozo, incluida una fuente que el mismo cargó antes (no hay «autor» de una fuente registral).

---

## 10. Riesgos (G)

1. **Reindexado silencioso.** Si cambia una coordenada, la decisión pasa a obsoleta y el punto operativo **cambia solo** (vuelve a automático). Mitigación: tras cada reindexado correr `auditarDecisionesFuentes()` (solo lectura, informa obsoletas) y, para los pozos afectados, un evento de sistema `REEVALUADA` que refresque `resultado*`. Hasta entonces el delta podría usar un `resultado*` calculado con el padrón anterior. Los reindexados son poco frecuentes (por período), pero el paso debe quedar en el procedimiento.
2. **Divergencia Python ↔ JS** del resolver automático (umbrales y desempates). Mitigación: vectores generados por Python + código idéntico backend/frontend con test.
3. **Quitar puntos del mapa.** El overlay hoy no elimina; descartar todo/dejar en discrepancia exige esa capacidad nueva (más tests y revisión de Cerca Mío/selección).
4. **Estado de dataset nuevo (`R`).** Efecto dominó en filtros, estilos, exportación y textos (ya se hizo con `V`; es repetible pero grande). Riesgo de confundir «Aceptada» con «Validada en campo»: la UI y los textos deben separarlos (otro color/ícono, «Aceptada manualmente»).
5. **Claves duplicadas** (dos filas idénticas del padrón) comparten estado; se muestran como una.
6. **Carreras entre validadores** → `STALE_STATE`; hay que manejarlo bien en la UI (releer y avisar) para que no parezca un fallo.
7. **Crecimiento de la hoja:** insignificante hoy (un puñado de pozos); se lee entera y se agrupa en memoria, igual que las correcciones. Revisar si pasara de varios miles de filas.
8. **Dos vocabularios de fuente** (`coordProvincia/VARIAS_FUENTES` vs `IRR_PROVINCIA/IRR_VARIAS`): el mapeo debe estar en un único módulo con tests.
9. **Ordenar por fecha sería un bug** (hay eventos del mismo segundo en datos reales): usar siempre `secuencia`.
10. **Datos reales de correcciones = pruebas.** Las ramas rechazar/revertir/pendientes nunca se ejercitaron con datos reales; la capa nueva no depende de ellas, pero conviene una prueba controlada antes de habilitarla a más usuarios.

---

## 11. Plan por etapas (H)

Cada etapa se cierra con tests, `git diff --check` y se despliega por separado (backend primero: la acción nueva queda inactiva hasta que alguien la llama).

1. **Etapa 1 — Dominio puro (sin UI, sin hoja):** resolver automático en JS **con paridad contra Python**, máquina de estados, derivación del estado vigente, identidad de fuente, regla R1b/R2 y el cálculo de `resultado*`. Frontend y backend con código idéntico (test que lo exige). Solo tests.
2. **Etapa 2 — Backend:** hoja + repositorio + servicio (lock, idempotencia, `secuencia`, `STALE_STATE`), `getDecisionesFuentesPozo`, `decidirFuenteUbicacion`, `getDecisionesFuentesDelta`, caché e invalidación, auditoría, permisos. Contrato probado contra un frontend real simulado (como `UbicacionValidacionContratoFrontend`). Migración manual de la hoja (`setup…`). `gas:push` → versión → deploy.
3. **Etapa 3 — Overlay de datos:** `mapaDataset_obtener` con el delta registral, estado `R`, **quitar punto**, filtros/estilos/exportación; sin botones todavía. Verificable con una decisión cargada a mano en la hoja de pruebas.
4. **Etapa 4 — Ficha y visor:** estados por fuente, botones Aceptar / Descartar / Restaurar / Quitar con confirmación y motivo, `STALE_STATE`, textos finales. Prueba real en celular.
5. **Etapa 5 — Operación:** `auditarDecisionesFuentes()` post-reindexado (y, si se confirma que hace falta, un evento de sistema para refrescar `resultado*`) y su paso en el procedimiento de reindexado.

---

## 12. Decisiones cerradas (14 oct 2026)

1. **Quitar aceptación:** acción propia (`ACEPTACION_QUITADA`); `Restaurar` solo para descartadas. ACEPTADA → SIN_REVISAR; no queda descartada.
2. **Descartar una aceptada:** en un solo paso (un evento `DESCARTADA` implica que deja de ser la aceptada). UX con confirmación fuerte y motivo obligatorio.
3. **Motivo:** obligatorio al descartar; opcional al aceptar, quitar aceptación y restaurar.
4. **Estado `R` = «Aceptada»:** código de dataset y chip/leyenda propios (D Disponible, C Coincidente, R Aceptada, V Validada en campo). Sin reutilizar C ni D ni un símbolo.
5. **Todas descartadas:** sin punto registral; el pozo no aparece en mapas / Cerca Mío / selección / reemplazos que requieran punto; la ficha sigue, con «Sin ubicación operativa de Irrigación» y «Todas las fuentes conocidas fueron descartadas.» Si hay una validada en campo, esa sigue siendo el punto operativo.
6. **Aceptar con validada en campo vigente:** permitido. Aviso: «Esta fuente quedó aceptada como referencia registral. La ubicación operativa actual sigue siendo la validada en campo.» Si la validada se revierte, la aceptada pasa sola a ser la candidata registral prioritaria.

Jerarquía final: (1) validada en campo → (2) fuente registral aceptada → (3) resolver automático sobre fuentes no descartadas → (4) sin punto.

---

## Etapa 1 — implementada (dominio puro + paridad con Python)

Archivos: `js/ubicacionFuenteDecisionesLogic.js` (funciones globales `ufd_*`, sin IIFE ni imports: se copiará tal cual al backend en la Etapa 2), `js/ubicacionFuenteDecisionesLogic.test.js`, `js/ubicacionFuenteDecisionesParidad.test.js`, `scripts/gen_vectores_resolver_ubicacion.py` → `js/fixtures/resolver_ubicacion_vectores.json` (generado por el resolver REAL de Python) y `scripts/test_vectores_resolver.py`. **No** hay backend, hojas, endpoints, UI ni mapa; ninguna pantalla ni el backend lo referencian (un test lo exige).

- **Eventos definitivos (4):** `ACEPTADA`, `DESCARTADA`, `ACEPTACION_QUITADA`, `RESTAURADA`. **`SUPERADA` no hace falta** (se deduce del orden: el `ACEPTADA` más nuevo del pozo manda; una fila por decisión, sin escrituras de dos filas). `REEVALUADA` tampoco es del dominio (si hiciera falta tras un reindexado, es de la etapa de backend).
- **Orden:** por `secuencia` (entero ≥ 1 único); la fecha **no se mira**. Secuencia repetida o inválida → pozo inconsistente.
- **Identidad:** `wellId|TIPO|x|y` con `x`, `y` a 3 decimales (`ufd_claveFuente`); dos filas idénticas del mismo tipo comparten identidad (una decisión las afecta a las dos).
- **Estado derivado:** `ufd_derivar({wellId, eventos, fuentes})` → fuentes con estado, `version` (secuencia máxima del pozo), obsoletas, historial anotado (reemplazaA / reemplazadaPor / descartaLaAceptada / quitaAceptacion) y anomalías. Un log con **cualquier** problema (forma, secuencia, transición) deja el pozo **inconsistente**: ninguna decisión aplica y no se aceptan nuevas (`INCONSISTENT_STATE`).
- **Solicitudes:** `ufd_decidir(estado, {decision, fuenteTipo, x, y, motivo, versionVista})` → `{ok, evento, efecto}` o error de dominio: `INVALID_DECISION`, `INVALID_FUENTE`, `INVALID_VERSION`, `MOTIVO_REQUERIDO`, `MOTIVO_INVALIDO`, `WELL_ID_INVALIDO`, `INCONSISTENT_STATE`, `SOURCE_NOT_FOUND`, `STALE_STATE`, `INVALID_TRANSITION`, `ALREADY_IN_STATE`. Orden de chequeos: forma → motivo → integridad → la fuente existe hoy → estado viejo → transición.
- **Resolver registral:** `ufd_resolverRegistral(estado)`: ACEPTADA (R1b) → resolver automático sobre las no descartadas (R2) → sin punto (R0). Informa también el `automatico`, el `original` (sin decisiones) y `cambiaRespectoDelOriginal`. **No conoce la validada en campo** (V > R se integra después).
- **Paridad con Python:** 350 casos de resolver + 213 de descartes generados por `scripts/reindex_pozos.py::resolver_ubicacion`, con bordes de umbral (10 / 50 / 500 m exactos y a 1 mm), empates, filas duplicadas y redondeos delicados (`round` half-even de Python). El JS devuelve exactamente lo mismo, incluidos lat/lon.
- **Dos apuntes de la paridad:** (a) `round()` de Python desempata half-even y JS no (`1.25` → `1.2`): se replica con `ufd_redondearComoPython`; (b) dos filas idénticas hacen «corroborada» a 0 m también en Python (artefacto del padrón); se conserva el comportamiento y se informa.

---

## Etapa 2 — implementada (backend + hoja + endpoints + caché + auditoría)

Archivos: `backend/src/UbicacionFuenteDecisionesLogic.js` (copia **exacta** del dominio del frontend; `backend/test/UbicacionFuenteDecisionesService.test.js` exige que no deriven: código idéntico, mismas exportaciones y mismo comportamiento sobre los 563 vectores de Python), `UbicacionFuenteDecisionesRepository.js` (hoja, setup, lock), `UbicacionFuenteDecisionesService.js` (lectura, escritura, secuencia, idempotencia, caché, diagnóstico), `Api.js` (2 rutas + 2 handlers) y 4 archivos de tests. **Nada de frontend, mapa, Cerca Mío, selección ni reemplazos; sin `js/api.js`; sin prioridad V > R; sin deploy ni setup real.**

- **`getDecisionesFuentesPozo`** (`ubicacion`): `{wellId, version, integro, padronPeriodo, fuentes[], obsoletas[], historial[], resolucion}`. Sin emails, sin ids internos, sin anomalías técnicas. Un pozo con log inconsistente devuelve `integro:false`, todas `SIN_REVISAR`, historial vacío y la resolución automática. Caché por pozo de 120 s.
- **`decidirFuenteUbicacion`** (`ubicacion` + `ubicacion_validar`; `ubicacion_corregir` NO concede): cuerpo `{wellId, fuenteTipo, x, y, accion (ACEPTAR | DESCARTAR | QUITAR_ACEPTACION | RESTAURAR), motivo?, versionVista, clientRequestId}`; el resto se ignora. El backend verifica la fuente contra el padrón de HOY (`SOURCE_NOT_FOUND`), toma el lock, **relee dentro del lock**, compara `versionVista` (`STALE_STATE` + `versionActual`), aplica el dominio, asigna `decisionId` / `secuencia` / `timestampUtc` / identidad de la sesión y escribe **una sola fila**. Responde la vista actualizada + `decision` + `duplicada`.
- **Idempotencia:** por `(usuario, clientRequestId)`; el reintento se atiende **antes** de mirar padrón o versión (devuelve la decisión original aunque la versión haya avanzado, el padrón cambie o el padrón no responda: entonces sin vista). Otro contenido = `IDEMPOTENCY_CONFLICT`. Una solicitud rechazada no consume el id.
- **Errores estables:** `INVALID_WELL_ID`, `WELL_NOT_FOUND`, `INVALID_ACCION`, `INVALID_CLIENT_REQUEST_ID`, `INVALID_FUENTE`, `INVALID_VERSION`, `INVALID_MOTIVO`, `SOURCE_NOT_FOUND`, `STALE_STATE`, `INCONSISTENT_STATE`, `INVALID_TRANSITION`, `ALREADY_IN_STATE`, `IDEMPOTENCY_CONFLICT`, más los de sesión y permisos (`UNAUTHORIZED`, `USER_DISABLED`, `PERMISSION_DENIED`). Una falla interna (Sheets, Drive, lock) es siempre `SERVICE_UNAVAILABLE` con el texto genérico «servicio no disponible»; el detalle va a `Logger`.
- **Auditoría:** la hoja ya guarda quién, cuándo, qué, por qué y sobre qué coordenada. En `Historial` se registra **cada intento** (la hoja no puede guardar los fallidos: permiso denegado, estado viejo, transición inválida…) con `decidirFuenteUbicacion` + el código, y, para una decisión escrita, la línea legible `FUENTE_ACEPTADA` / `FUENTE_DESCARTADA` / `FUENTE_ACEPTACION_QUITADA` / `FUENTE_RESTAURADA` con resultado `OK`. Nunca el payload, el motivo, coordenadas ni emails ajenos. Los reintentos idempotentes y las lecturas no se auditan. Sin Telegram.
- **Caché:** `ufd_vista_v1_<wellId>` (120 s) con marca de invalidación global y margen de 2 s contra la carrera lector/escritor, tope de 90.000 caracteres y nunca indispensable (mismo diseño que `getUbicacionesValidadas`); se invalida tras **cada escritura confirmada**. La escritura nunca lee el caché. Una lectura = 1 padrón + 1 hoja (sin N+1).
- **Setup / diagnóstico manual:** `setupUbicacionFuenteDecisionesSheet()` y `diagnosticarUbicacionFuenteDecisiones()` (solo lectura: por pozo, códigos técnicos de anomalías y obsoletas). No se exponen por ningún endpoint ni se ejecutan solos.
- **No implementado a propósito:** `getDecisionesFuentesDelta`. Su contrato depende de decisiones de la Etapa 3 (cómo se representa «quitar el punto del mapa», el estado `R` y qué pasa con C/D); fijarlo ahora arriesga un contrato equivocado.
- **Hallazgo en código compartido (corregido):** `validateSessionAndWellId` dejaba pasar un `wellId` que no fuera texto (un arreglo `['14-0001']` pasaba el regex y rompía después con un `TypeError` que se devolvía como `SERVICE_UNAVAILABLE` con el mensaje interno). Ahora exige `typeof wellId === 'string'`. Afecta a todos los endpoints con `wellId`: solo cambia el caso de un `wellId` que no es texto (ahora `INVALID_WELL_ID`).
- **Auditoría de precisión de x/y (3 decimales) sobre los CSV reales del padrón:** Reporte Pozos 5.407 coordenadas (≤ 3 decimales, 47 de ellas con 2); Irrigación 16.069 filas **todas enteras** (metros). 42.952 valores, **ninguno** con más de 3 decimales ni cerca de un límite de redondeo; **0** pares de fuentes de un mismo pozo que colapsen en la misma clave con coordenadas distintas; distancia mínima no nula entre dos fuentes de un pozo: **1,0 m**. Solo 25 pozos tienen 2+ fuentes. Dos pozos tienen **filas idénticas** de Irrigación (`14-0997`, `16-0952`): comparten identidad y el resolver de Python las «corrobora» a 0 m (artefacto del padrón).

### Checkpoint de la Etapa 2 (correcciones)

- **Secuencia fail-closed:** si ALGUNA fila de la hoja (de cualquier pozo) tiene una `secuencia` que no es un entero seguro >= 1, `max + 1` deja de ser confiable y la escritura se rechaza con `INCONSISTENT_STATE` (el detalle, con los `decisionId`, va solo al log). La lectura y el reintento idempotente de algo ya escrito no se bloquean.
- **Padron dentro del lock:** la escritura relee hoja y padron DENTRO del lock (antes el padron se leia antes). Un reindexado entre el pedido y el lock se ve como `SOURCE_NOT_FOUND`.
- **Privacidad:** las respuestas traen solo coordenadas, estados, motivos, `nombre` y fechas; nunca email, `decisionId`, `clientRequestId` ni datos del registro del padron (tests de forma exacta).
- **Orden de produccion:** `gas:push` -> `setupUbicacionFuenteDecisionesSheet()` (manual, editor de Apps Script, idempotente) -> `gas:version` -> `gas:deploy`. Mientras el deploy apunte a la version anterior, el codigo nuevo no se sirve.

