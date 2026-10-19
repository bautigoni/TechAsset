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

Node: producción (VM) corre **Node 20**; `engines.node` acepta 20 a 26. `better-sqlite3` está fijado en **12.9.0** exacto: es la última versión con binario precompilado para Node 20 en Linux (la VM tiene 1 GB de RAM y compilarlo ahí es arriesgado) y para Node 24 en Windows. No subirlo sin chequear los binarios de la release. Con npm 11, si `better-sqlite3` no carga localmente, correr `npx prebuild-install` dentro de `node_modules/better-sqlite3` (npm ya no ejecuta los scripts de instalación por defecto). El Dockerfile usa `node:22-bookworm-slim` (no Alpine — `better-sqlite3` necesita glibc).

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

- Login por mail autorizado + contraseña (o Google). El alta es por código de invitación.
- `server/routes/auth.routes.js`:
  - `POST /api/auth/register` → canjea la invitación, crea `allowed_users`, dispara `notifyRegistration` (no bloqueante).
  - `POST /api/auth/login` → mismo mensaje para mail inexistente y contraseña errónea (no revela qué mails tienen cuenta); el estado Pendiente/Rechazado se informa recién con la contraseña correcta. Límite de intentos fallidos en memoria (8 por IP+mail, 100 por IP, ventana 15 min).
  - Cuentas sin contraseña (allowlist viejo) **no** se reclaman con la primera contraseña tipeada: se les manda un link de un solo uso (`password_tokens`, hash SHA-256, vence en 1 h). `POST /api/auth/password/request` ("olvidé mi contraseña", respuesta idéntica exista o no la cuenta) y `POST /api/auth/password/confirm`. El link abre `/login?password=<token>`.
- Seguridad de la API (`server/index.js`): `/uploads/<categoría>/<SEDE>/...` exige sesión con acceso a esa sede (solo `site-logos` es público); CORS solo para orígenes propios; `trust proxy` loopback (Caddy local); el `operator`/`operador` de cualquier escritura se pisa con el usuario de la sesión; `requireModuleEditor` (en `siteContext.service.js`) exige `canEditModule` por prefijo de ruta para los routers viejos. `PATCH /settings/mail` es solo superadmin; enviar credenciales 365, solo admin de sede.
- Frontend: la sede activa es **por pestaña** (`src/services/activeSite.ts`, memoria + sessionStorage); un 401 fuera de `/api/auth` dispara `techasset:session-expired` y la app vuelve al login.
- `server/routes/sites.routes.js` `POST /api/allowed-users/:id/:action` (`approve|reject|deactivate|delete`) dispara `notifyAllowedUserAction`.
- Mail bot: `server/services/mail.service.js` (`sendMail`) + plantillas card-style en `server/services/mailTemplates.js` (`buildRegistrationUserMail`, `buildRegistrationAdminMail`, `buildUserApprovedMail`, `buildUserRejectedMail`, `buildUserDeactivatedMail`).
- Variables `.env` que controlan envíos:
  - `APP_BASE_URL` (fallback `http://127.0.0.1:8000`) — usado para el botón "Revisar solicitud" → `{APP_BASE_URL}/sede/{site_code}/configuracion/usuarios`.
  - `SUPERADMIN_EMAILS` (CSV).
  - `SMTP_*`, `MAIL_FROM`, `MODO_PRUEBA`. Si `MODO_PRUEBA=true` se loguea en consola pero **no se envía**. Si SMTP está incompleto o falla, el flujo (registro/aprobación) **no se rompe**.
- Settings de mail también editables vía UI (`PATCH /api/settings/mail`) y persisten en SQLite (`app_settings` table) sobreescribiendo los valores de `.env`.

## Dispositivos / inventario

- `server/services/deviceInventory.service.js` arma el inventario desde la base (`local_devices` + `local_states`, sin los `hidden_devices`). Caché en memoria por sede (60 s) que se invalida en cada escritura de equipos/préstamos (las rutas llaman `invalidateDeviceInventoryCache` y además hay un hook global en `server/index.js`); `getInventoryVersion` sirve de clave para cachés derivadas (la vida útil de `GET /api/devices`). Si agregás una escritura que cambia equipos por fuera de esas rutas, invalidá.
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

Se calcula en el front (`NowPanel.tsx` del dashboard y `AgendaPage.tsx`, no hay endpoint): actividad en curso (Entregado/Pendiente y horario actual entre `desde`/`hasta`), si no la próxima del día, si no la próxima de la semana. Cancelado/Realizado nunca aparecen como próxima.

Ojo con el orden de rutas en Express: un `/:id` declarado antes tapa a las rutas literales del mismo prefijo (pasaba con `/agenda/history` y `/agenda/export.csv`). Restringir el parámetro (`/:id(\d+)`) o declararlo al final. Las rutas `/api/*` inexistentes responden 404 JSON (no el `index.html`).

## Loans (préstamos)

- `LoanForm.tsx` soporta escaneo continuo: toggle abre tabla de equipos escaneados, agrega por scanner USB (Enter) o manual, marca duplicados / no disponibles, y un único form de persona/rol/ubicación/motivo aplica al lote.
- `POST /api/loans/lend` y `/return` actualizan SQLite y registran en `local_movements`. **No** hacen llamadas externas a Apps Script. Si alguien introduce esa dependencia de nuevo, romper la review.

- Lotes: `POST /api/loans/lend-batch` y `/return-batch` (un request, inventario armado una vez, cada equipo se resuelve por separado). Los usan la selección múltiple de Préstamos/Dispositivos y el escaneo continuo.
- El estado de un equipo se decide en UN lugar: `getLoanState` / `getDeviceStateKey` en `src/utils/deviceState.ts`, con la misma regla que `isAvailableState`/`isLoanedState` del server. Si cambia una, cambiar la otra.

## Historial y papelera

- `GET /api/history?kind=loans|all&q&from&to&tipo&before&limit` (`server/routes/history.routes.js`): filtros en SQL y paginado por cursor (`timestamp|id`). Pantalla `HistoryPage` (visible si el rol ve Préstamos o Dispositivos).
- Papelera de dispositivos: `GET /api/devices/deleted` + `POST /api/devices/:etiqueta/restore`. Borrar = ocultar; al borrar sale un toast con "Deshacer".
- `GET /api/agenda` omite por defecto las terminadas de más de 120 días (`?all=1` trae todo; la respuesta trae `olderHidden`).

## Shell (etapa 2 del rediseño)

- `src/components/layout/AppShell.tsx` arma todo: `Sidebar` (menú agrupado Operación / Gestión / Inventario y datos / Recursos / Superadmin, 232 px; rail de 56 px con Ctrl B o bajo 1100 px), `Topbar` (título + contexto, Asistente, accesos rápidos, campana, cuenta), `MobileNav` (bajo 768 px: Inicio, Préstamos, Escanear, Agenda, Más; "Más" es una vista en línea, `MoreView`) y la columna del asistente. Catálogo del menú, grupos y títulos: `layout/nav.ts`. La lista de vistas es una sola: `VIEW_KEYS` en `src/types.ts`.
- La app ocupa la ventana (100dvh) y lo único que scrollea es `.shell-scroll` (franjas + contenido): para subir arriba usar `scrollAppToTop()` (`utils/scroll.ts`), no `window.scrollTo`.
- Nada flota: accesos rápidos, notificaciones, sede, cuenta y **Ctrl K** (`CommandPalette.tsx`) se abren como una franja en línea bajo la barra (una a la vez; Esc o el mismo botón la cierran y devuelven el foco). Ctrl K, franjas, "Más" y la barra inferior viajan en el chunk `ShellPanels` (precargado en idle). El asistente es columna a la derecha (≥ 1024 px) o vista propia.
- Navegación con historial: `navigate()` de App hace `pushState` (Atrás/Adelante recorren vistas); las correcciones automáticas (deep link inválido, módulo apagado, login) usan `replaceState`. La URL sigue siendo `/sede/<sede>/<vista>`.
- Escáner USB global (`hooks/useGlobalScanner.ts`): exige ritmo de lector (≥ 4 caracteres, ≤ 50 ms de promedio entre teclas) e ignora campos editables, `form`, `.modal`, `[role=dialog]` y todo lo marcado con `[data-scanner-ignore]` (franjas, Ctrl K, asistente). Un formulario en línea nuevo que no sea `<form>` lleva `data-scanner-ignore`.

## UI compartida

- `src/components/layout/Feedback.tsx`: `confirmDialog`, `promptDialog` (texto o `options`), `toast` (con acción "Deshacer"), `copyToClipboard`, `errorMessage`. **No usar `window.confirm/prompt/alert`** ni tragarse errores con `.catch(() => {})` en acciones del usuario.
- `src/components/layout/Selection.tsx`: `useSelection` + `SelectionBar` (`floating` la monta en el body). Selección múltiple en Préstamos, Dispositivos, Tickets y Tareas.
- `useDialogFocus`: foco, Tab y Escape de cualquier diálogo (lo usan `Modal`, el de aula y el de novedades).
- `utils/a11y` `clickableProps` para filas/tarjetas clickeables; `utils/download` para descargas/CSV (con BOM); `SelectField` en vez de `<select>` nativo (no queda ninguno).
- Módulos que cada sede prende en Configuración: además de los de siempre, `knowledge`, `reminders` y `canvas` (arrancan apagados en sedes existentes).

## Cierre del día

`/api/daily-closures` (GET/POST + `/preview`) genera un resumen automático: préstamos activos, tareas pendientes/en proceso/hechas hoy, agenda del día y sus incidencias, aulas con problema, notas importantes. El operador agrega observaciones desde `DailyClosureModal` y se persiste en `daily_closures`.

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
- Campana: botón de la barra superior + franja en línea (`ShellStrips.tsx` › `NotifStrip`) + `src/hooks/useNotifications.ts` (polling 30 s, pausado con la pestaña oculta). Una notificación nueva sale como línea de estado bajo la barra (`pushStatus` + `StatusOutlet`, "Ver", 6 s), no como toast.
- Backend notificaciones: `server/services/notifications.service.js` (`notifyUser`, `notifySiteAdmins`, `broadcastRelease`, `sendPush` con fallback graceful).
- Tablas: `notifications`, `push_subscriptions`, `release_notes` (todas en `server/db.js`, idempotentes con `CREATE TABLE IF NOT EXISTS`).
- Hooks: `tasks.routes.js` y `tickets.routes.js` llaman `notifySiteAdmins` en POST (no bloqueante).
- Modal "Qué hay de nuevo": `src/components/common/ReleaseNotesModal.tsx` + `GET /api/release-notes/latest`.
- VAPID setup: si `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` no están seteados, las push caen gracefully a in-app + mail sin romper.
- Broadcast de release: `POST /api/admin/release-notes` (solo Superadmin, idempotente por `version`). Alternativa CLI: `npm run release:broadcast -- --version=vX.Y.Z --title="..." --file=./release-notes.md`.

## Asistente e IA

- Todo lo que usa IA pasa por el adaptador `server/services/ai/provider.js` (`getAiProvider()`: `createChat` con herramientas + streaming, `generateText` para resúmenes/diagnósticos). Proveedor por env: `AI_PROVIDER=anthropic|openai|local`, `AI_MODEL` (default `claude-haiku-5-5`), `AI_EFFORT` (chat, default `low`: en las evals fue más rápido y acertó más que `medium`), `ANTHROPIC_API_KEY`. OpenAI queda de respaldo solo mientras exista `OPENAI_API_KEY`; sacarla deja todo en Claude. Sin keys, el asistente cae al modo local de reglas.
- `server/services/ai/text.js` (`generateAiText`): resúmenes de tickets/equipos (`aiSummaries.service.js`) y diagnóstico de aulas (`classrooms.routes.js`, salida JSON con esquema). Devuelve null sin proveedor o con el tope: el que llama usa su versión determinística.
- Tope diario por sede (`AI_DAILY_LIMIT_PER_SITE`, default 400, 0 = sin tope) y tokens en `ai_usage_daily`; cada llamada deja una línea `[ai] op=... in= out= cache_read= ms=` en el log (sin contenido).
- Chat: `server/services/assistant/chat.service.js` (prompt estable cacheado + bloque SESIÓN volátil; contexto de pantalla y artículos de conocimiento van en el mensaje del usuario como `<datos_no_confiables>`), herramientas en `tools.js` (formato Anthropic, `strict` en las de escritura: la API limita a 24 parámetros opcionales sumando las estrictas), auditoría y Deshacer en `actions.service.js` (`assistant_audit`, `assistant_actions`).
- Seguridad: permisos por herramienta en el server (`writePermissionError`, por módulo); préstamos/devoluciones solo si el equipo (y la persona) aparecen en lo que escribió el usuario o en la pantalla abierta (frena instrucciones metidas en notas/tareas); más de 5 equipos en un pedido piden confirmación.
- Endpoints: `POST /api/asistente/chat` (respuesta completa, compatible), `POST /api/asistente/chat/stream` (SSE: `start`, `delta`, `tool`, `action`, `done`, `error`), `POST /api/asistente/deshacer` (`{ actionId }`; mismos permisos, misma sede, mismo usuario o admin, hasta 12 h), `GET /api/asistente/status` (proveedor, modelo, tope y uso del día). `/asistente/transcribir` responde 410: el dictado es del navegador (`src/hooks/useSpeechDictation.ts`).
- Evaluaciones: `node server/scripts/ai-evals.mjs [--db=ruta] [--only=a,b] [--effort=low|medium] [--verbose]` corre ~35 pedidos contra una copia temporal de la base con la key del `.env`. Correrlas antes de cambiar modelo, prompt o herramientas.

## Deployment

**Producción real (VM bauhub, desde julio 2026): systemd, NO Docker.**

- Caddy corre en el host y proxea `techasset.bauhub.online` → `reverse_proxy 127.0.0.1:3013` (ver `/etc/caddy/Caddyfile`).
- En el 3013 escucha el servicio systemd `techasset` (`/etc/systemd/system/techasset.service`): `node server/index.js` desde `/opt/apps/techasset`, con `.env` ahí (PORT=3013, `DATABASE_URL` a Postgres/Supabase, `AI_PROVIDER`/`AI_MODEL`/`ANTHROPIC_API_KEY`; `OPENAI_API_KEY` solo hasta que se confirme Claude en producción).
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

## Rendimiento

- **En producción cada query es un viaje SINCRÓNICO a Supabase** (`pg-sync` bloquea el proceso con `Atomics.wait`): un request cuesta queries × latencia y frena a todos los demás. Cada query que se saca de un endpoint que se pollea vale. Antes de sumar queries a algo que corre en cada request (auth, middlewares, `/api/devices`, `/api/movements`, notificaciones), medí.
- Cachés del server: sesión en memoria 30 s (`getUserSession`, `last_seen_at` cada 5 min, se limpia ante escrituras de usuarios/sedes/accesos), inventario por sede (ver arriba).
- Caché del front: `apiGet` responde 15 s con lo último visto y revalida en segundo plano (`X-Revalidate: 1`); `apiSend` la vacía. Lo polleado/crítico está excluido (`NO_CACHE` en `apiClient.ts`). Toda escritura tiene que pasar por `apiSend` (o llamar `clearApiCache`).
- Fechas: usar `formatDate` / `dateFormatter` de `utils/formatters` (formateador cacheado), nunca `toLocaleString` en listas.
- Layout: no alternar lecturas de layout (`getBoundingClientRect`, `offsetWidth`) con escrituras en un loop; medir con `ResizeObserver`.
- Bancos de prueba: `server/scripts/bench/bench-api.mjs` (queries y latencia de la API) y `perf/` (arranque, pantallas y scroll del front en Edge headless con CPU 4×; `perf/compare.mjs` compara builds intercalados). Ver `perf/README.md`.
- **Nunca puede haber scroll horizontal**, en ninguna vista, ancho o breakpoint — salvo que el usuario lo pida explícitamente para un contenedor puntual. El `<body>` jamás scrollea en X. Contenido ancho (tablas, planos SVG, bloques de código) scrollea *dentro* de su propio contenedor con `overflow-x: auto`, nunca empujando la página. Antes de cerrar un cambio de UI, verificar en mobile (360px) y desktop.
- **Nunca se superpone nada** (pedido explícito del dueño): ningún texto, botón ni bloque pisa a otro en ningún ancho de 360 a 1920px. Botones y labels nunca se parten en varias líneas ni palabra por palabra (`white-space: nowrap` + `text-overflow: ellipsis`, `min-width: 0` en hijos de flex); grupos de botones y chips envuelven con `flex-wrap`; columnas que no entran bajan, no se aplastan; tablas angostas pasan a filas-tarjeta.
- **Nunca se ven barras de scroll** (ni la nativa con flechitas ni una horizontal debajo de una fila de chips). Preferir no scrollear: mostrar los últimos N + "Ver más/anteriores", o envolver en filas. Si un contenedor interno tiene que scrollear, la barra va oculta (`scrollbar-width: none` + `::-webkit-scrollbar { display: none }`) con un degradé sutil en el borde como pista.
- **Nada de modales ni capas flotantes** (pedido del dueño): sin modales, paneles laterales superpuestos, hojas inferiores, toasts o barras flotantes, popovers ni menús desplegables. Lo que se abre va en línea y empuja el contenido (resultados, formularios, fichas que se expanden, confirmaciones en la barra de selección, Deshacer como línea de estado). **Única excepción:** el texto truncado con elipsis se lee completo al hacer hover o foco con un tooltip chico, solo si está realmente cortado (en touch, tocarlo lo despliega en línea).
- **Mobile = pantalla fija** (pedido del dueño): sin zoom con dos dedos (en iPhone hay que cancelar `gesture*` y `touchmove` multitáctil, porque Safari ignora `user-scalable=no`), sin doble toque que agrande, campos de 16px o más, sin arrastre lateral ni rebote que muestre algo fuera de la app (`overflow-x: clip`, `overscroll-behavior: none`, fondo de `html` = fondo del tema), `100dvh`, zonas seguras. Solo el plano de aulas y el Canvas tienen zoom propio dentro de su recuadro. En desktop, con zoom afuera la app sigue llenando la ventana. Detalle completo en `docs/redesign/PLAN.md` §5.1.
- **Reglas de UX/UI del dueño** (19/10): `docs/redesign/REGLAS-UX.md` — sin saltos de layout ni de scroll por interactuar, todo panel visible y accesible completo, feedback en toda acción, sin doble ejecución accidental, sin pérdida de datos en formularios, nada tapado por barras fijas, sin scroll anidado que atrape, estados de carga/vacío/error/éxito, teclado y foco. Directiva de entrega: `docs/redesign/DIRECTIVA-FINAL.md`.
- **Nada de "AI slop"**: sin pastillas de estado con puntito y fondo tintado, sin puntitos de color delante de filtros ("● Disponible 68"), sin barras de progreso de colores (ni bajo duraciones o stock), sin checkboxes nativos azul brillante (checkbox propio sobrio), sin cuadraditos decorativos, sin glows ni gradientes. El estado normal no se marca (texto plano); solo lo que pide atención va como texto coloreado sin fondo. Proporciones (libres/total) con un anillo fino neutro.

## Animaciones y transiciones

- Las animaciones salen de [transitions.dev](https://transitions.dev) (plan Pro). Antes de escribir un keyframe a mano, buscar si ya existe la receta: `npx transitions-pro list`. Catálogo local en `src/styles/transitions/`.
- Estética sobria: micro-transiciones, easing y timing correctos. Nada de glows, confetti, bounces exagerados ni "AI slop".
- **Siempre respetar `prefers-reduced-motion: reduce`** — toda animación nueva va con su guard.
- Animar preferentemente `transform` y `opacity` (compositor). Evitar animar `width`, `height`, `top`/`left` o `box-shadow` en loops.
