# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/) y [SemVer](https://semver.org/). Este archivo empieza a llevarse recién en el cierre de V1; el detalle completo de cómo se llegó hasta acá está en el historial de commits y en `docs/architecture.md`/`docs/roadmap.md`.

## [Unreleased]

V2 — Ficha del Pozo, en curso (backend cerrado, frontend pendiente — no forma parte todavía de una release taggeada).

### Agregado
- `scripts/reindex_pozos.py`: convierte el Reporte de Pozos real (CSV, 106 columnas) en 19 archivos JSON por departamento + `metadata.json`, con normalización basada en evidencia (no reglas genéricas), deduplicación, y conservación de todos los análisis de laboratorio distintos por pozo.
- `RegistryRepository`/`RegistryService`/`Api.handleGetWellRecord` (acción `getWellRecord`): capa de backend para la Ficha del Pozo, independiente del visor ITF. Particionado automático de departamentos grandes (07, 08) por primer dígito de `Nro Pozo` — medido contra Drive real: 3.5-4.7s → 0.9-1.2s en frío.
- Validación de sesión+`wellId` compartida entre `getProfile` y `getWellRecord` (`validateSessionAndWellId`).
- Evento de auditoría `getWellRecord` en Historial.
- 96 tests (Jest) + 65 tests (Python, `unittest`).

## [1.1.0] - 2026-09-10

Etapa de diseño visual/UX sobre V1.0 ("Acequia Profesional"), más un cambio funcional acotado en persistencia de sesión pedido durante la misma etapa. Sin pantallas ni fuentes de datos nuevas.

### Cambiado
- **Rediseño visual/UX completo** ("Acequia Profesional"): logo oficial de IRRIGACIÓN incorporado con la geometría exacta del SVG provisto por el usuario (recoloreado vía `currentColor`, sin redibujar ni deformar) — grande y protagonista en el login, chico y discreto al pie del resto de pantallas, oculto en el estado vacío del buscador para no competir con él. Ícono de PWA nuevo (gota). Botón de limpiar (`×`) y "Salir" aplanados a icono/link de texto puros (heredaban `border-radius`/`box-shadow` del `.button` genérico sin anularlos, lo que los hacía ver como cápsulas). Imagen de perfil sin borde duro, estados vacío/no encontrado/offline aligerados, foco visible en inputs y botones, composición propia para desktop. Sin cambios de lógica, backend, validadores, historial ni Service Worker.
- **Sesión rolling/sliding**: `sessionToken` pasa de 12h fijas a 30 días, renovado silenciosamente en cada `checkSession` exitoso (el frontend reemplaza el token guardado sin intervención del usuario). En uso periódico la sesión se mantiene indefinidamente; sin uso por 30 días completos, o al tocar "Salir", hay que volver a autenticarse con Google. Firma HMAC-SHA256 y verificación de expiración sin cambios; un usuario deshabilitado sigue perdiendo acceso aunque tenga un token vigente.
- **Placeholder de carga para el botón de Google**: causa raíz medida en producción — el botón depende de 3 requests secuenciales al dominio de Google (script, estilo, iframe), ~250-650ms en red rápida y varios segundos en datos móviles o en la primera conexión tras reinstalar la PWA; agravado por el `<script>` del SDK sin `async`. Se agrega un estado "Cargando acceso con Google…" del mismo alto que el botón real (sin salto de layout), timeout de 10s y botón "Reintentar" si la carga falla de verdad. `google.accounts.id.initialize()`/`renderButton()`/`prompt()` sin cambios.

### Corregido
- El cluster de usuario en el header (email + "Salir") podía comprimirse hasta volverse ilegible con un email largo, por heredar `flex-shrink` del contenedor del header.

### Verificado
- Login, placeholder de Google y persistencia de sesión probados en iPhone real.
- 77 tests (Jest): los 76 de V1.0 más uno nuevo para la renovación rolling de `checkSession`.

## [1.0.0] - 2026-08-27

### Agregado
- Login con Google Identity Services (init programático, sin prompt redundante) + sesión propia firmada (HMAC-SHA256, 12h) validada localmente sin volver a llamar a Google en cada request.
- Recuperación automática de sesión al reabrir la PWA.
- Allowlist de usuarios activos (hoja "Usuarios"), con cache de 5 minutos.
- Historial de auditoría de `login`/`getProfile` (hoja "Historial"), sin UI visible todavía.
- Búsqueda de pozo `DD-PPPP` con normalización sin ambigüedad y validación de rango de departamento (01-19), duplicada en frontend y backend.
- Visualización del perfil y descarga (Android/PC: descarga directa; iOS: hoja de compartir nativa vía Web Share API, con fallback).
- Máquina de estados de UI completa: cargando sesión, no autenticado, listo, buscando, encontrado, no encontrado, usuario deshabilitado, sin conexión.
- PWA instalable con Service Worker (estrategia network-first con fallback a cache), funcional offline para el app shell.
- 76 tests (Jest) cubriendo validación de `wellId`, `AuthService`, `ProfileService`/`Api.handleGetProfile`, y la lista de archivos cacheados por el Service Worker.

### Corregido
- Persistencia de sesión en iOS standalone (el problema real era que el frontend nunca revisaba `localStorage` al arrancar, no un límite de iOS).
- Prompt de Google apareciendo encima de una sesión ya recuperada (init de Google Identity Services pasó de declarativo a programático).
- Enmascarado del input de pozo inconsistente entre plataformas (causado por no subir la versión de cache del Service Worker).
- Dinosaurio de Chrome al abrir offline (el `install` del Service Worker era todo-o-nada; ahora tolera fallos individuales por archivo y maneja explícitamente la navegación).
- Google Sheets reinterpretaba el `wellId` de "Historial" como fecha/número (perdía el cero inicial de `01-0012`) aunque se escribiera como texto; ahora se fuerza `setNumberFormat('@')` explícitamente sobre la celda al escribirla.

### Descartado / fuera de alcance de V1.0
- Mecanismo de entrega de imagen vía `doGet` + `Blob` directo — no soportado por Apps Script Web Apps (confirmado con la documentación oficial).
- Recompresión masiva del corpus de imágenes (`THUMB_WEB`) — innecesaria, los archivos reales ya son livianos.
- Rate limiting — diseñado pero no implementado; queda como mejora opcional para una V1.x futura, no bloquea `v1.0.0`.

## V0 — prueba técnica (sin tag, 2026-08-26/27)

Validó de punta a punta la cadena GitHub Pages → Google Sign-In → Apps Script → sesión propia → Drive → imagen real, en Android y iPhone, antes de construir el producto. Cerrada con veredicto GO de arquitectura. Detalle completo en `docs/roadmap.md`.
