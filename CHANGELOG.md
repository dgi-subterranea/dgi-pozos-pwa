# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/) y [SemVer](https://semver.org/). Este archivo empieza a llevarse recién en el cierre de V1; el detalle completo de cómo se llegó hasta acá está en el historial de commits y en `docs/architecture.md`/`docs/roadmap.md`.

## [Unreleased]

### Cambiado
- Sesión rolling/sliding: `sessionToken` pasa de 12h fijas a 30 días, renovado silenciosamente en cada `checkSession` exitoso (el frontend reemplaza el token guardado sin intervención del usuario). En uso periódico la sesión se mantiene indefinidamente; sin uso por 30 días completos, o al tocar "Salir", hay que volver a autenticarse con Google. Firma HMAC-SHA256 y verificación de expiración sin cambios; un usuario deshabilitado sigue perdiendo acceso aunque tenga un token vigente.
- Rediseño visual/UX ("Acequia Profesional"): logo institucional real de IRRIGACIÓN, ícono PWA nuevo, ajustes de jerarquía/espaciado/tipografía y botones planos sin cápsulas. Sin cambios de lógica, backend, validadores, sesión, historial ni Service Worker.

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
