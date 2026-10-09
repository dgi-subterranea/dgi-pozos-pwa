# Sincronizar Apps Script con clasp (fase de solo lectura)

Dos proyectos Apps Script independientes (cuentas de Google distintas):

| Proyecto | Carpeta | Usuario de clasp | Archivos que se sincronizarán |
|---|---|---|---|
| `main` (**dgi-pozos-backend**) | `backend/` | `main` | `backend/src/*.js` + `backend/src/appsscript.json` |
| `storage` (**DGI Fotos Storage**) | `storage/` | `storage` | `storage/src/*.js` + `storage/src/appsscript.json` |

**Los conteos nunca están escritos en ningún lado**: `gas:status` los deriva del filesystem y los contrasta con `git ls-files`. Si difieren
(archivos sin versionar o versionados que faltan) lo informa y lo explica. Nunca entran tests, `js/`, `scripts/`, `docs/`, Python ni `Cuencas/`:
cualquier archivo que no sea `Nombre.js` o `appsscript.json` dentro de `src` es un **extra prohibido** que bloquea.

> **Esta fase NO modifica Apps Script.** No existen `push`, `version` ni `deploy`. El wrapper solo puede ejecutar los subcomandos de clasp
> `pull`, `show-file-status` y `show-authorized-user` (allowlist; cualquier otro, o `--force`/`--deleteUnusedFiles`, se corta antes de ejecutarse).
> `clasp push` **reemplaza el proyecto remoto completo**: por eso antes de habilitarlo se compara el inventario remoto contra el local.

## Qué se versiona y qué no
| Archivo | Git |
|---|---|
| `backend/.clasp.json.example`, `storage/.clasp.json.example` (marcadores de posición) | sí |
| `backend/src/appsscript.json`, `storage/src/appsscript.json` (se traen del remoto y se **revisan** antes de agregarlos) | sí |
| `backend/.clasp.json`, `storage/.clasp.json` (scriptId real) | **no** (`.gitignore`) |
| `.clasprc.json` (token OAuth) | **no** (`.gitignore`; clasp lo guarda en tu carpeta de usuario, no en el repo) |
| `.gas-remote/` (copia remota temporal), `.gas-state/` (estado adoptado), `.gas.local.json` | **no** |

El wrapper se niega a trabajar si detecta un `.clasp.json` / `.clasprc.json` versionado o sin ignorar.

## Primer uso (una sola vez; no toca nada remoto)
1. `npm install` (clasp 3.4.1 queda pinneado como devDependency; no se instala global).
2. En **cada** cuenta de Google, activar la Apps Script API: <https://script.google.com/home/usersettings> → "Google Apps Script API: Activada".
3. Login de las dos cuentas (se abre el navegador; cada comando con la cuenta que corresponde):
   ```
   npx clasp login --user main        # cuenta dueña de dgi-pozos-backend
   npx clasp login --user storage     # cuenta dueña de DGI Fotos Storage
   npx clasp show-authorized-user --user main
   npx clasp show-authorized-user --user storage
   ```
4. Obtener el **ID de la secuencia de comandos** de cada proyecto (editor de Apps Script → ⚙ Configuración del proyecto) y crear los archivos locales:
   ```
   copy backend\.clasp.json.example backend\.clasp.json     # y pegar el scriptId de dgi-pozos-backend
   copy storage\.clasp.json.example storage\.clasp.json     # y pegar el scriptId de DGI Fotos Storage
   ```
   (Dejar `"rootDir": "src"`. Estos archivos están en `.gitignore`.)
5. `npm run gas:status:main` y `npm run gas:status:storage` (locales, no consultan el remoto).

## Comandos (todos de solo lectura)
```
npm run gas:pull:main      | gas:pull:storage     trae el remoto a .gas-remote/<proyecto>/ (nunca sobre src)
npm run gas:status:main    | gas:status:storage   inventario local, chequeos de seguridad, contraste con clasp show-file-status
npm run gas:diff:main      | gas:diff:storage     pull + comparación local/remoto + huella      [-- --lineas N --max-archivos N --sin-pull]
npm run gas:adopt:main     | gas:adopt:storage    registra el estado remoto revisado, solo en .gas-state/   -- --confirmar-huella <hex> [--descartar A.js,B.js]
```
`gas:diff` informa: archivos **solo remotos** (un push futuro los borraría → bloqueante), **solo locales**, **modificados** (con diff `- remoto / + local`),
estado del `appsscript.json` (con runtime, acceso de la Web App y alcances), deriva respecto de lo adoptado, estado de git y la **huella** determinista
(SHA-256 de los contenidos normalizados local+remoto; no depende del orden, de CRLF/LF ni del formato del manifiesto).

`gas:adopt` re-trae el remoto, exige que la huella coincida con la del diff revisado y que no haya bloqueos (manifiesto local igual al remoto, sin
cruces, sin solo-remotos sin reconocer), y solo entonces escribe `.gas-state/<proyecto>.json` con los hashes remotos. A partir de ahí, cualquier
edición hecha fuera de este flujo (por ejemplo directamente en el editor web) aparece como **deriva** y bloquea el diff.

## Seguridad
- Ningún scriptId ni token se versiona; los mensajes de error enmascaran el scriptId.
- `pull` solo escribe en `.gas-remote/<proyecto>/`; el wrapper verifica byte a byte que `src` no cambió durante el pull y corta si cambió.
- Se aborta si main y storage parecen **cruzados**: mismo scriptId en las dos carpetas, el remoto contiene archivos del otro proyecto (más que
  propios) o no comparte ningún archivo con el código local. Todo se deriva de los inventarios reales.
- Qué hacer ante un bloqueo `solo remoto`: decidir archivo por archivo si se agrega al repo o se acepta perderlo (`--descartar`).
- Aviso de runtime: `UbicacionCorreccionService.js` usa `Object.assign`; el diff advierte si el remoto no declara `runtimeVersion: "V8"`.

## Próximas fases (no implementadas)
`push` (exigirá siempre `--confirmar-huella`, árbol git limpio salvo `--permitir-sucio`, y repetirá el diff), `version` y `deploy` (por separado y solo
sobre un deployment existente, para no cambiar la URL de la Web App).
