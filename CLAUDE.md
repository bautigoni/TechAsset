# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Comandos

```bash
npm install              # primera vez
npm run db:init          # seedea la base (SQLite local o Postgres via DATABASE_URL)
npm run dev              # backend (8000) + Vite (5173) en paralelo
npm run server           # solo backend
npm run build            # tsc -b && vite build (verificación principal antes de mergear)
npm run start            # producción local (sirve dist/ desde Express en 8000)
npm run preview          # vite preview de dist/
npm run release:broadcast -- --version=vX.Y.Z --title="..." --file=./release-notes.md
npm run release:broadcast:dry -- --version=vX.Y.Z ...  # simula sin enviar
```

`npm run build` debe pasar antes de cerrar cualquier cambio. No hay tests configurados.

Engine fijado: **Node 22** (`engines.node: ">=22 <23"`). El Dockerfile usa `node:22-bookworm-slim` (no Alpine — `better-sqlite3` necesita glibc).

## Arquitectura — Postgres con adaptador SQLite-like

La regla más importante de este repo: **la base es la fuente de verdad**. Google Sheets / CSV publicado se usan **solo para importación manual** de inventario, nunca para sincronización viva. Prestar/devolver no escribe en planillas. Si Google falla, la app sigue funcionando.

- Frontend: React 19 + Vite 6 + TypeScript en `src/`. PWA instalable (`public/manifest.webmanifest` + `public/sw.js`).
- Backend: Express en `server/`.
- Base: el driver se elige por env en `server/db.js` → `server/pg-sync.js`:
  - `DATABASE_URL` seteada → Postgres real (driver `pg` ya en deps).
  - Si no, fallback a **SQLite** vía `better-sqlite3` en `./data/techasset.db`.
  - El adaptador `pg-sync.js` expone la misma API que `better-sqlite3` (`prepare`, `run`, `get`, `all`, `transaction`, named params `@id`), así que el código de routes no cambia entre drivers.
- En producción Express sirve `dist/` y la API en el mismo `:8000`. En desarrollo Vite proxea `/api/*` y `/sheet.csv` al backend (ver `vite.config.ts`).
- Volumen persistente: `./data/` (db SQLite, cache CSV, `tmp/`, uploads). En Postgres el volumen es externo (gestionado por el deploy).
- Migración: `server/migrate_to_postgres.cjs` (script standalone, se corre una vez para migrar de SQLite → Postgres).

## Multi-sede

Todo dato operativo (dispositivos, préstamos, tareas, agenda, aulas, inventario maker, etc.) está particionado por `site_code` (ej. `NFPT`, `NFND`). **NFPT y NFND nunca cruzan datos.** Identidad de dispositivo: `site_code + etiqueta`.

- Sede activa del usuario: cookie de sesión + `siteContext.service.js`. Helpers `requireSite(req)`, `isSuperadmin(req.user)`, `isSiteManager(req, siteCode)`.
- Componentes que dependen de la sede leen `activeSite` desde props (ej. `ClassroomStatusPage` muestra el plano real solo en `NFPT` y un placeholder "Próximamente" en `NFND`).
- Roles: `Superadmin` (toda la app) > `Jefe TIC` (su sede) > asistentes y consulta. Tabla `allowed_users` + `allowed_user_sites` define el acceso. Estado de un usuario: `Pendiente | Activo | Rechazado | Inactivo`. Borrado de usuarios = soft delete (`activo=0`, `deleted_at`, `deleted_by`); no se borra historial.

## Auth y mails

- Login por mail autorizado (sin password); registro queda en estado `Pendiente`.
- `server/routes/auth.routes.js`:
  - `POST /api/auth/register` → crea `allowed_users` con `Pendiente`, dispara `notifyRegistration` (no bloqueante).
  - `POST /api/auth/login` → rechaza pendientes/rechazados/inactivos con mensajes específicos.
- `server/routes/sites.routes.js` `POST /api/allowed-users/:id/:action` (`approve|reject|deactivate|delete`) dispara `notifyAllowedUserAction`.
- Mail bot: `server/services/mail.service.js` (`sendMail`) + plantillas card-style en `server/services/mailTemplates.js` (`buildRegistrationUserMail`, `buildRegistrationAdminMail`, `buildUserApprovedMail`, `buildUserRejectedMail`, `buildUserDeactivatedMail`).
- Variables `.env` que controlan envíos:
  - `APP_BASE_URL` (fallback `http://127.0.0.1:8000`) — usado para el botón "Revisar solicitud" → `{APP_BASE_URL}/sede/{site_code}/configuracion/usuarios`.
  - `SUPERADMIN_EMAILS` (CSV).
  - `SMTP_*`, `MAIL_FROM`, `MODO_PRUEBA`. Si `MODO_PRUEBA=true` se loguea en consola pero **no se envía**. Si SMTP está incompleto o falla, el flujo (registro/aprobación) **no se rompe**.
- Settings de mail también editables vía UI (`PATCH /api/settings/mail`) y persisten en SQLite (`app_settings` table) sobreescribiendo los valores de `.env`.

## Dispositivos / inventario

- `server/services/deviceInventory.service.js` mergea: padrón estático del CSV (`data/cache_sheet.csv`) + estado vivo de SQLite (`local_states` / `local_devices`). Tiene caché en memoria con TTL (`SHEET_CACHE_TTL_MS`, default 5 s) y stale-while-revalidate.
- Bug histórico a no repetir: si el fetch externo fallaba, la caché en memoria quedaba congelada. Ahora el fallback a `buildFromLocalCsvCache` actualiza `inventoryCache`. No volver a romper ese fix.
- Merge de estado (`mergeStateOverrides`): cuando la planilla dice `Prestado | No encontrada | Fuera de servicio` y `local_states` dice `Disponible | Devuelto | vacío`, **gana la planilla** salvo que el local tenga `updated_at` con menos de 90 segundos (ventana para tolerar sync en curso). Esto evita que filas viejas de `local_states` pisen ediciones manuales en la hoja.
- Importación CSV: Borrar dispositivo = ocultar (`activo=0`, `deleted_at`). Reimportar el mismo `site_code+etiqueta` lo reactiva (`activo=1`, `deleted_at=NULL`). No hay blacklist permanente.
- Alias operativo: `Filtro + Numero Operativo` (ej. `Touch 34`). Función central `getOperationalAlias` en `src/utils/classifyDevice.ts`. Se autonumeran los `PLANI` que no tengan número (estable por etiqueta) en `withOperationalAliases` desde `useDevices`.
- Búsqueda flexible (`src/utils/normalizeSearch.ts`): debe encontrar `touch 34`, `touch34`, `34touch`, `D1436`, `plani 5`, `planificación 5`, etc. — usa `normalizeAlias`, `flexibleDeviceKey`, `parseOperationalAlias`. Si tocás esto, mantener todos los formatos.
- Tabla en `data/techasset.db`. Endpoint `POST /api/devices/sync-from-sheet` borra entradas triviales (`Disponible/Devuelto/vacío`) de `local_states` para forzar a la planilla como fuente; útil cuando se acumulan restos de pruebas.

## Estado de aulas (planos)

`src/components/classrooms/`:
- `ClassroomStatusPage.tsx` orquesta selector de pisos + modal de aula (`ClassroomInfoPanel`). Filtra por sede activa: NFPT muestra los modelos reales, NFND muestra placeholder "Próximamente".
- Modelos SVG en `models/`: `PrimerPisoModel.jsx` (planta baja real), `FloorMapPrimerPiso.jsx` (1er piso real, exporta `default` + `ROOMS`), `SecondFloorModel` (2do piso). `PrimerPisoModel.jsx` es el barrel que expone `PrimerPisoModel`, `FirstFloorModel`, `SecondFloorModel` y `ALL_FLOOR_ROOMS`.
- Convención de IDs por piso para que no colisionen entre plantas: `room_*` (planta baja), `pp_*` (1er piso), `p2_*` (2do piso).
- Equipamiento por aula es array dinámico (`equipment_json` en `classrooms`). Estados válidos: `OK | Con falla | No tiene | En reparación | Sin revisar`. `'No encontrado'` está deprecado; al leer se migra a `'Con falla'` (`migrateLegacyClassroomData` corre una vez al startup).
- Modal usa el wrapper `.modal` global (centrado, scroll interno, bloquea scroll de fondo con `body.modal-open`, cierra con backdrop / X / Escape).

## Tareas TIC

- Tabla `tasks` con columnas extra: `responsables_json` (array `["Bauti","Equi"]`), `turno`. `responsable` (string) se mantiene por compatibilidad: `"Ambos"` cuando hay dos. Asignar a ambos asistentes guarda en ambos.
- Subtareas: tabla `task_items`, endpoints `GET/POST/PATCH/DELETE /api/tasks/:id/items`. Cada cambio queda en `task_history`.
- Edición de tareas: `TaskModal` se abre tanto para crear como para editar (recibe `initial`).
- Notas internas tipo chat / Traspaso TIC: `internal_notes` table + `/api/internal-notes` CRUD. Renderizado en la tab "Traspaso TIC" dentro de `TasksPage`.

## Próxima agenda

`GET /api/agenda/upcoming` calcula correctamente: actividad en curso (Entregado/Pendiente y horario actual entre `desde`/`hasta`), si no la próxima del día, si no la próxima de la semana. Cancelado/Realizado nunca aparecen como próxima.

## Loans (préstamos)

- `LoanForm.tsx` soporta escaneo continuo: toggle abre tabla de equipos escaneados, agrega por scanner USB (Enter) o manual, marca duplicados / no disponibles, y un único form de persona/rol/ubicación/motivo aplica al lote.
- `POST /api/loans/lend` y `/return` actualizan SQLite y registran en `local_movements`. **No** hacen llamadas externas a Apps Script. Si alguien introduce esa dependencia de nuevo, romper la review.

## Cierre del día

`/api/daily-closures` (GET/POST + `/preview/today`) genera un resumen automático: préstamos activos, tareas pendientes/en proceso/hechas hoy, agenda del día y sus incidencias, aulas con problema, notas importantes. El operador agrega observaciones desde `DailyClosureModal` y se persiste en `daily_closures`.

## Accesos rápidos

`quick_links` table + `/api/quick-links` CRUD. Validación de URL: solo `http(s)://`, rechaza `javascript:`, `data:`, `vbscript:`. La tabla incluye links institucionales fijos + ediciones desde la UI. Archivos `.bat` administrativos viven en `public/downloads/` y se sirven como descarga (no se ejecutan desde la web).

## Generador de tarjetas (Glifing / Santillana)

`server/routes/tools.routes.js` genera HTML imprimible (A4, ~8 tarjetas/página, 2×4) con templates embebidos como data URL para que la imagen aparezca al imprimir. Templates en `public/templates/` (`glifing-template.png`, `template_santillana.jpeg`). `print-color-adjust: exact` en `html, body` para que el background salga en print.

## Login con Google (OAuth 2.0)

Botón opcional en la pantalla de login al lado del tradicional por mail. Si las vars `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` están vacías, el botón se oculta automáticamente (`GET /api/auth/google/config` → `{ enabled: false }`).

- Servicio: `server/services/googleOAuth.service.js` (`buildAuthUrl`, `exchangeCode`, `verifyIdToken` vía `oauth2.googleapis.com/tokeninfo`).
- Rutas: `server/routes/googleAuth.routes.js`:
  - `GET /api/auth/google/login` → redirige a Google, setea cookie `state` (CSRF) + cookie `site` (sede activa).
  - `GET /api/auth/google/callback` → valida state, intercambia code, verifica id_token (valida `aud` + `email_verified` + dominio si `GOOGLE_ALLOWED_DOMAINS` está seteado), busca en `allowed_users`, crea sesión normal con `createSession`.
- El gatekeeper sigue siendo `allowed_users`: si el mail no está autorizado, redirect a `/login?error=not_authorized` con mensaje claro.
- Auditoría: cada login queda en `local_movements` con `tipo='auth'`, `origen='Google'`.
- Setup completo en `server/scripts/README.md` (Google Cloud Console + redirect URIs + test users).

## PWA + notificaciones push

- `public/manifest.webmanifest` + `public/sw.js`: shell cache, network-first para `/api/*`, cache-first para assets estáticos, listener `push` y `notificationclick`.
- Registro del SW en `src/main.tsx` (solo prod).
- Banner de instalación: `src/components/common/InstallBanner.tsx`, montado como hermano de `<App />`. Solo aparece en mobile, si no está instalada y el browser disparó `beforeinstallprompt`.
- Campana + popover + toasts: `src/components/layout/NotificationBell.tsx` + `src/hooks/useNotifications.ts` (polling 30s, dispara toast en nuevas).
- Backend notificaciones: `server/services/notifications.service.js` (`notifyUser`, `notifySiteAdmins`, `broadcastRelease`, `sendPush` con fallback graceful).
- Tablas: `notifications`, `push_subscriptions`, `release_notes` (todas en `server/db.js`, idempotentes con `CREATE TABLE IF NOT EXISTS`).
- Hooks: `tasks.routes.js` y `tickets.routes.js` llaman `notifySiteAdmins` en POST (no bloqueante).
- Modal "Qué hay de nuevo": `src/components/common/ReleaseNotesModal.tsx` + `GET /api/release-notes/latest`.
- VAPID setup: si `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` no están seteados, las push caen gracefully a in-app + mail sin romper.
- Broadcast de release: `POST /api/admin/release-notes` (solo Superadmin, idempotente por `version`). Alternativa CLI: `npm run release:broadcast -- --version=vX.Y.Z --title="..." --file=./release-notes.md`.

## Deployment

**Producción real (VM bauhub, desde julio 2026): systemd, NO Docker.**

- Caddy corre en el host y proxea `techasset.bauhub.online` → `reverse_proxy 127.0.0.1:3013` (ver `/etc/caddy/Caddyfile`).
- En el 3013 escucha el servicio systemd `techasset` (`/etc/systemd/system/techasset.service`): `node server/index.js` desde `/opt/apps/techasset`, con `.env` ahí (PORT=3013, `DATABASE_URL` a Postgres/Supabase, `OPENAI_API_KEY`).
- **Deploy: `ssh oracle` y correr `/opt/apps/techasset/deploy.sh`** (pull + npm install + build + `systemctl restart techasset` + health check). El restart NO es opcional: node no relee código del disco — actualizar la carpeta sin reiniciar deja el proceso viejo sirviendo (causa histórica de "deployé y sigue igual").
- Cuidado con el nombre: el `hostname` de la VM es `bauhub`, pero el alias en `~/.ssh/config` es **`oracle`** (`168.75.68.75`, user `ubuntu`, key `oracle-bauhub.key`). `ssh bauhub` no resuelve.
- La VM **no tiene credenciales de GitHub**: el código llega por un `git bundle` subido por scp, y el `origin` del repo remoto apunta a ese archivo en `/tmp` (que se borra al reiniciar la VM). Si `deploy.sh` avisa que el bundle no existe, desde la máquina de desarrollo: `git bundle create /tmp/techasset.bundle <sha-en-la-vm>..main`, `scp` a `bauhub:/tmp/`, `git remote set-url origin` al nuevo path y correr `deploy.sh`. El script imprime los comandos exactos con el SHA correcto.
- La VM tiene 1GB de RAM: el build tarda ~2-3 min. Si no da, buildear local y subir `dist/`, después `deploy.sh --no-build`.
- El container `techasset-nfs` (compose del mismo dir) quedó **detenido a propósito**: era un deploy paralelo que no recibía tráfico y confundía (`restart=no`). No volver a levantarlo salvo que se migre Caddy a apuntarle.
- `Dockerfile`/`docker-compose.yml` quedan para entornos que sí usen Docker: la imagen escucha `:8000` sin exponer puertos al host; el reverse proxy debe compartir la red `proxy-network` y proxear `techasset:8000`. Volumen `./data:/app/data` para SQLite/cache CSV/uploads.

## Convenciones

- Mantener tema oscuro, sidebar/topbar/cards/responsive existentes. No refactor destructivo.
- Migraciones SQLite idempotentes en `server/db.js` (`ensureColumn`, `CREATE TABLE IF NOT EXISTS`). Datos legacy: traducir, no borrar (ej. `'No encontrado' → 'Con falla'`, `piso='Primer piso' → 'Planta baja'`).
- Cualquier feature operativa nueva debe respetar `consultationMode` (vista jefe = bloquea ediciones).
- En español rioplatense (`vos`, `acordate`). Encoding UTF-8 — vigilar mojibake `Ã©`/`prÃ³xima` en CSVs y mails.
- Logs: `[devices/perf]` está silenciado salvo que `DEBUG_DEVICE_PERF=1`. No volver a llenar la consola por default.
