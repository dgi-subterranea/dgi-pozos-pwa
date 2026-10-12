# Sincronizar Apps Script con clasp

Dos proyectos Apps Script independientes (cuentas de Google distintas):

| Proyecto | Carpeta | Usuario de clasp | Archivos que se sincronizarán |
|---|---|---|---|
| `main` (**dgi-pozos-backend**) | `backend/` | `main` | `backend/src/*.js` + `backend/src/appsscript.json` |
| `storage` (**DGI Fotos Storage**) | `storage/` | `storage` | `storage/src/*.js` + `storage/src/appsscript.json` |

**Los conteos nunca están escritos en ningún lado**: `gas:status` los deriva del filesystem y los contrasta con `git ls-files`. Si difieren
(archivos sin versionar o versionados que faltan) lo informa y lo explica. Nunca entran tests, `js/`, `scripts/`, `docs/`, Python ni `Cuencas/`:
cualquier archivo que no sea `Nombre.js` o `appsscript.json` dentro de `src` es un **extra prohibido** que bloquea.

> **Lectura y escritura están separadas.** `pull`, `status`, `diff`, `adopt` y `deployments` solo leen. `push`, `version` y `deploy` escriben, cada uno
> detrás de todas sus guardas. Todo comando de clasp pasa por una allowlist con la **forma exacta** permitida (`clasp push --user <u>` sin flags,
> `create-version "<desc>"`, `update-deployment <id> -V <n>`); `--force`, `create-deployment`, `delete-*`, `deploy`, etc. están prohibidos siempre.
> `clasp push` **reemplaza el proyecto remoto completo**: por eso el wrapper compara el inventario remoto contra el local y contra lo adoptado antes de subir.

## Qué se versiona y qué no
| Archivo | Git |
|---|---|
| `backend/.clasp.json.example`, `storage/.clasp.json.example` (marcadores de posición) | sí |
| `backend/src/appsscript.json`, `storage/src/appsscript.json` (se traen del remoto y se **revisan** antes de agregarlos) | sí |
| `backend/.clasp.json`, `storage/.clasp.json` (scriptId real) | **no** (`.gitignore`) |
| `.clasprc.json` (token OAuth) | **no** (`.gitignore`; clasp lo guarda en tu carpeta de usuario, no en el repo) |
| `.gas-remote/` (copia remota temporal), `.gas-state/` (estado adoptado), `.gas.local.json` (deploymentId y `pushHabilitado`) | **no** |
| `.gas.local.json.example` (estructura vacía) | sí |

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

## Configuración local: `.gas.local.json` (ignorado por git)
Copiar `.gas.local.json.example` a `.gas.local.json` y completarlo. Nada de esto se versiona; el `deploymentId` del storage forma parte de su URL secreta.
```json
{
  "version": 1,
  "main":    { "pushHabilitado": false, "deploymentId": "" },
  "storage": { "pushHabilitado": false, "deploymentId": "" }
}
```
- `pushHabilitado`: **`false` al inicio**. Mientras sea `false`, `gas:push` se niega (salvo `--simular`).
- `deploymentId`: ID **completo** del deployment **numerado** de producción de ese proyecto (no `@HEAD`). Se obtiene de
  `npx clasp list-deployments --user main|storage` (sin enmascarar). Los dos IDs deben ser distintos.

## Escritura (solo después de revisar `gas:diff` y de completar `.gas.local.json`)
```
npm run gas:push:main     -- --confirmar-huella <sha256 completo> [--simular] [--permitir-sucio] [--permitir-manifest]
npm run gas:version:main  -- --descripcion "<texto>"             [--permitir-sucio]
npm run gas:deploy:main   -- --version <n> [--descripcion "<texto>"] [--confirmar-despliegue vN@xxxxxx] [--permitir-retroceso] [--permitir-distinta] [--permitir-head-distinto]
npm run gas:deployments:main  [-- --mostrar-ids]                  (solo lectura)
```
(lo mismo con `:storage`). Flujo normal: `gas:diff` → revisar → `gas:push -- --confirmar-huella <hex>` → `gas:version -- --descripcion "..."` → `gas:deploy -- --version N`
(primero imprime el plan; se repite con `--confirmar-despliegue vN@xxxxxx`). **Push, version y deploy son comandos separados**: un push no cambia lo desplegado.

**`gas:push` — guardas, en este orden** (cualquier falla aborta antes de escribir; exit 1 = uso/config, 2 = bloqueado, 3 = estado incierto/no coincide):
1. `--confirmar-huella` obligatoria, **sha256 completo (64 hex)**; no existe `--force` (ni `-f`) y las opciones desconocidas se rechazan.
2. `pushHabilitado = true` para el proyecto en `.gas.local.json` (con `--simular` no se exige: ensaya todas las demás guardas sin subir nada).
3. Árbol git **limpio**: sin cambios en archivos versionados y sin archivos nuevos dentro de la carpeta del proyecto (carpetas ajenas sin versionar, como `Cuencas/`,
   no cuentan). Escape explícito: `--permitir-sucio`.
4. **Pull remoto nuevo** antes de cualquier escritura; la huella debe coincidir con la de ese pull (si el repo o el remoto cambiaron desde el diff, aborta).
5. Proyectos **no cruzados** (mismo scriptId, remoto con archivos del otro proyecto, o sin ningún archivo propio).
6. Proyecto **adoptado** y **sin deriva**: el remoto no cambió desde `adopt` (ni archivos editados a mano en el editor web, ni nuevos, ni borrados, ni manifiesto).
7. Archivos **solo-remotos**: solo se permiten (y se eliminan) los aprobados en `.gas-state/<proyecto>.json` → `descartados`; cualquier otro archivo remoto no reconocido bloquea.
8. `appsscript.json` local igual al remoto; si difiere, solo con `--permitir-manifest`; si falta localmente, nunca.
9a. **Destino de escritura exacto** (vale también para `version` y `deploy`): `clasp` solo se ejecuta con `cwd` = la carpeta del proyecto (`backend/` o `storage/`), nunca desde `.gas-remote/*`
   (copias de HEAD que pueden ser viejas) ni desde otra carpeta o ruta relativa; y el `.clasp.json` de esa carpeta, **releído del disco justo antes de escribir**, debe tener el scriptId
   esperado (el del inicio del comando), distinto del del otro proyecto y con `rootDir: "src"`. Si algo no cuadra: exit 2 y no se escribe nada.
9. Nada no permitido dentro de `src` y **contraste con `clasp show-file-status`**: ningún archivo local queda sin subir y ningún archivo inesperado se sube (si la salida de clasp
   no se reconoce, se aborta: correr `gas:status` y revisarla).
10. `clasp push --user <u>` (sin `--force`) → **pull de nuevo → verifica remoto == repo** (archivos, contenido y manifiesto). Si no coincide: exit 3 y el estado adoptado **no** se actualiza.
11. Informa **agregados / modificados / eliminados** y actualiza `.gas-state` (nuevo estado base, `descartados` vacío, `ultimoPush` con `huellaPrevia` y `remotoPrevio`, la firma del contenido remoto anterior).

**`gas:version`:** solo `create-version "<descripción>"` (obligatoria, ≤ 200 caracteres); exige proyecto adoptado, árbol limpio y **remoto == repo** (no versiona un HEAD roto o sin subir);
verifica con `list-versions` y **informa el número creado**. Nunca despliega.
**HEAD se verifica antes y después:** antes de crear la versión (remoto == repo) y de nuevo **después** (pull de HEAD). Si HEAD cambió o ya no coincide con el repo, la versión **igual existe**
(clasp no se puede deshacer), pero el comando sale con **código 3**, lo dice ("VERSION CREADA: N … pero HEAD quedó INCONSISTENTE") y deja `ultimaVersion.headConsistente = false` en `.gas-state`.

**`gas:deploy`:** solo `update-deployment <deploymentId> -V <n>` sobre el `deploymentId` de `.gas.local.json` (nunca crea un deployment). Antes: el ID debe figurar en los deployments **de este proyecto**
(y distinto del del otro proyecto), **no puede ser `@HEAD`**, la versión debe existir, no puede ser la que ya tiene ni un retroceso (salvo `--permitir-retroceso`), y la versión debe ser
**idéntica al repo local** (salvo `--permitir-distinta`). Muestra la versión actual → destino y exige `--confirmar-despliegue vN@<últimos 6 del deploymentId>`. Después verifica con `list-deployments`.
Los IDs se imprimen siempre enmascarados.
**HEAD se verifica antes y después:** antes de `update-deployment` se trae HEAD y debe coincidir con el repo; si no, **aborta con código 3 sin tocar ningún deployment** (`--permitir-head-distinto` lo permite
a conciencia, por ejemplo para un rollback de emergencia). Después del update se verifica **el deployment** (`list-deployments`) y **HEAD** (de nuevo). Si HEAD difiere del repo o **cambió durante el deploy**:
código 3 y un mensaje que distingue ambas cosas — "DEPLOY APLICADO Y VERIFICADO" (el deployment sí quedó actualizado) *pero* "HEAD quedó INCONSISTENTE". Un deployment versionado no depende de HEAD: lo que sirve `/exec` no cambia por esto.

## Si HEAD "vuelve" a un estado viejo (revert)
`gas:diff` y `gas:status` avisan **"El remoto volvió al estado anterior al último push"** cuando el remoto actual es el que había antes del último push registrado (por `huellaPrevia`, o por el contenido remoto previo
`remotoPrevio`), junto con las fechas del último push / versión / deploy. `status` no llama a Google: usa el último pull guardado en `.gas-remote/` (corré `gas:diff` para confirmarlo).
- **Qué pasó:** algo subió una copia vieja de **todo** el proyecto después del push. El API de clasp solo escribe archivos con `push`, y `create-version` / `update-deployment` no tocan HEAD; los sospechosos son una
  **pestaña vieja del editor web de Apps Script** (guardar, ejecutar o desplegar desde ella sube todo su contenido) o un `clasp push` desde otra carpeta o equipo. En Drive → Detalles → Actividad figura cuándo y quién.
- **Qué NO pasa:** las versiones numeradas (lo desplegado en `/exec`) no cambian. Solo HEAD (y `@HEAD`, el deployment de pruebas).
- **Recuperación:** (1) cerrar todas las pestañas del editor de ese proyecto; (2) `gas:diff` → `gas:adopt -- --confirmar-huella <hex> --descartar <solo-remotos aprobados>`; (3) `gas:push -- --confirmar-huella <hex>`;
  (4) `gas:version` solo si el repo cambió (si no, la última versión ya es el código correcto); (5) `gas:deploy`. Mientras HEAD no coincida con el repo, `push`, `version` y `deploy` se niegan.

## Seguridad
- Ningún scriptId ni token se versiona; los mensajes de error enmascaran el scriptId.
- `pull` solo escribe en `.gas-remote/<proyecto>/`; el wrapper verifica byte a byte que `src` no cambió durante el pull y corta si cambió.
- Se aborta si main y storage parecen **cruzados**: mismo scriptId en las dos carpetas, el remoto contiene archivos del otro proyecto (más que
  propios) o no comparte ningún archivo con el código local. Todo se deriva de los inventarios reales.
- Qué hacer ante un bloqueo `solo remoto`: decidir archivo por archivo si se agrega al repo o se acepta perderlo (`--descartar`).
- Aviso de runtime: `UbicacionCorreccionService.js` usa `Object.assign`; el diff advierte si el remoto no declara `runtimeVersion: "V8"`.

## Antes del primer push real (checklist)
1. `npm run gas:status:main|storage` → debe decir que clasp subiría exactamente los archivos esperados.
2. `npm run gas:diff:main|storage` → revisar; resolver o adoptar (`gas:adopt`) con `--descartar` para los solo-remotos aprobados.
3. `npm run gas:deployments:main|storage` → ver qué deployment es el de producción (versionado, no `@HEAD`) y completar `deploymentId` en `.gas.local.json`.
4. Ensayo: `npm run gas:push:main -- --confirmar-huella <hex> --simular` (no sube nada).
5. Recién entonces `pushHabilitado: true` y el push real.
