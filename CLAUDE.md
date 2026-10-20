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
npm run e2e              # banco de punta a punta (funcionales + sonda UX bloqueante), ver e2e/README.md
npm run check:ui         # guardia de controles nativos / "slop" (tiene que bajar, nunca subir)
npm run release:broadcast -- --version=vX.Y.Z --title="..." --file=./release-notes.md
npm run release:broadcast:dry -- --version=vX.Y.Z ...  # simula sin enviar
```

Antes de cerrar un cambio: `npm run build`, `npm run e2e` en verde (la sonda UX corta con exit 1) y `npm run check:ui` (con `-- --update` si bajó). Si tocaste el server, `server/scripts/bench/pg-smoke.mjs` contra un Postgres 17 de Docker.

Node: producción (VM) corre **Node 20**; `engines.node` acepta 20 a 26. `better-sqlite3` está fijado en **12.9.0** exacto: es la última versión con binario precompilado para Node 20 en Linux (la VM tiene 1 GB de RAM y compilarlo ahí es arriesgado) y para Node 24 en Windows. No subirlo sin chequear los binarios de la release. Con npm 11, si `better-sqlite3` no carga localmente, correr `npx prebuild-install` dentro de `node_modules/better-sqlite3` (npm ya no ejecuta los scripts de instalación por defecto). El Dockerfile usa `node:22-bookworm-slim` (no Alpine — `better-sqlite3` necesita glibc).

## Arquitectura — Postgres con adaptador SQLite-like

La regla más importante de este repo: **la base es la fuente de verdad**. Google Sheets / CSV publicado se usan **solo para importación manual** de inventario, nunca para sincronización viva. Prestar/devolver no escribe en planillas. Si Google falla, la app sigue funcionando.

- Frontend: React 19 + Vite 6 + TypeScript en `src/`. PWA instalable (`public/manifest.webmanifest` + `public/sw.js`).
- Backend: Express en `server/`.
- Base: el driver se elige por env en `server/db.js` → `server/pg-sync.js`:
  - `DATABASE_URL` seteada → Postgres real (driver `pg` ya en deps).
  - Si no, fallback a **SQLite** vía `better-sqlite3` en `./data/techasset.db`.
  - El adaptador `pg-sync.js` expone la misma API que `better-sqlite3` (`prepare`, `run`, `get`, `all`, `transaction`, named params `@id`), así que el código de routes no cambia entre drivers.
- En producción Express sirve `dist/` y la API en el mismo `:8000`. En desarrollo Vite proxea `/api/*`, `/uploads/*` y `/sheet.csv` al backend (ver `vite.config.ts`).
- Volumen persistente: `./data/` (db SQLite, cache CSV, `tmp/`). Adjuntos en `UPLOADS_DIR` (default `./data/uploads`). En Postgres el volumen es externo (gestionado por el deploy).
- Migración: `server/migrate_to_postgres.cjs` (script standalone, se corre una vez para migrar de SQLite → Postgres).

## Multi-sede

Todo dato operativo (dispositivos, préstamos, tareas, agenda, aulas, inventario, etc.) está particionado por `site_code` (ej. `NFPT`, `NFND`). **NFPT y NFND nunca cruzan datos.** Identidad de dispositivo: `site_code + etiqueta`.

- Sede activa del usuario: cookie de sesión + `siteContext.service.js`. Helpers `requireSite(req)`, `isSuperadmin(req.user)`, `isSiteManager(req, siteCode)`.
- Frontend: la sede activa es **por pestaña** (`src/services/activeSite.ts`, memoria + sessionStorage) y viaja en el header `X-Site-Code`.
- Roles: `Superadmin` (toda la app) > `Jefe TIC` (su sede) > asistentes y consulta; permisos por módulo en la config de roles de la sede (`canEditModule`, `utils/permissions.ts`). Tabla `allowed_users` + `allowed_user_sites` define el acceso. Estado de un usuario: `Pendiente | Activo | Rechazado | Inactivo`. Borrado de usuarios = soft delete (`activo=0`, `deleted_at`, `deleted_by`); no se borra historial.
- Toda feature operativa respeta `consultationMode` (rol de solo lectura o vista jefe = sin acciones de escritura; el server igual responde 403).

## Auth, ingreso y mails

- Pantallas sin sesión (`src/components/auth/`, chunk propio con `styles/screens/auth.css`): `LandingPage` (`/`), `LoginPage` (`/login`, `/register`) dentro de `AuthFrame` (marca + tema Oscuro/Claro/Sistema, guardado solo local). Todo en línea: pestañas "Ingresar / Tengo un código", avisos arriba del formulario (error con shake, info, OK, sesión vencida), campos de cada modo con `Collapse`, botón ocupado mientras trabaja (sin doble envío), lo escrito no se pierde ante un error.
  - `/register?code=X` precarga el código; `?error=<slug>` (Google, `session_expired`) se traduce; `/login?password=<token>` abre "Elegí tu contraseña". La query se limpia al entrar.
  - Un link a una pantalla sin sesión (`/sede/nfpt/tasks/12`, mails, notificaciones) abre el ingreso con "Entrás a la sede NFPT" y, al entrar, vuelve a esa URL si la sede es suya ("Usar mi sede por defecto" lo descarta). Un 401 fuera de `/api/auth` (`techasset:session-expired`) hace lo mismo con la vista donde estaba.
  - Registro OK: la cuenta queda activa y pasa a Ingresar con el mail (y la contraseña) ya puestos.
- `server/routes/auth.routes.js`:
  - `POST /api/auth/register` → canjea la invitación, crea `allowed_users`, dispara `notifyRegistration` (no bloqueante).
  - `POST /api/auth/login` → mismo mensaje para mail inexistente y contraseña errónea (no revela qué mails tienen cuenta); el estado Pendiente/Rechazado se informa recién con la contraseña correcta. Límite de intentos fallidos en memoria (8 por IP+mail, 100 por IP, ventana 15 min).
  - Cuentas sin contraseña (allowlist viejo) **no** se reclaman con la primera contraseña tipeada: se les manda un link de un solo uso (`password_tokens`, hash SHA-256, vence en 1 h). `POST /api/auth/password/request` ("olvidé mi contraseña", respuesta idéntica exista o no la cuenta) y `POST /api/auth/password/confirm`.
- Seguridad de la API (`server/index.js`): `/uploads/<categoría>/<SEDE>/...` exige sesión con acceso a esa sede (solo `site-logos` es público); CORS solo para orígenes propios; `trust proxy` loopback (Caddy local); el `operator`/`operador` de cualquier escritura se pisa con el usuario de la sesión; `requireModuleEditor` (en `siteContext.service.js`) exige `canEditModule` por prefijo de ruta para los routers viejos. `PATCH /settings/mail` es solo superadmin; enviar credenciales 365, solo admin de sede.
- `server/routes/sites.routes.js` `POST /api/allowed-users/:id/:action` (`approve|reject|deactivate|delete`) dispara `notifyAllowedUserAction`.
- Mail bot: `server/services/mail.service.js` (`sendMail`) + plantillas card-style en `server/services/mailTemplates.js`.
- Variables `.env` que controlan envíos:
  - `APP_BASE_URL` (fallback `http://127.0.0.1:8000`) — base de los links de los mails (`/sede/{site}/settings/usuarios`, `/login?password=…`, `/register?code=…`).
  - `SUPERADMIN_EMAILS` (CSV).
  - `SMTP_*`, `MAIL_FROM`, `MODO_PRUEBA`, `RESEND_*`. Si `MODO_PRUEBA=true` se loguea en consola pero **no se envía**. Si SMTP está incompleto o falla, el flujo (registro/aprobación) **no se rompe**. Solo para el banco: con `NODE_ENV=test` **y** `MAIL_CAPTURE_FILE`, los mails en modo prueba se agregan a ese archivo (de ahí sale el link de contraseña en e2e); en producción no existen.
- Settings de mail también editables vía UI (`PATCH /api/settings/mail`) y persisten en `app_settings` sobreescribiendo los valores de `.env`.

## Login con Google (OAuth 2.0)

Botón opcional en el ingreso. Si `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` están vacías, el botón no aparece (`GET /api/auth/google/config` → `{ enabled: false }`).

- Servicio: `server/services/googleOAuth.service.js` (`buildAuthUrl`, `exchangeCode`, `verifyIdToken` vía `oauth2.googleapis.com/tokeninfo`).
- Rutas: `server/routes/googleAuth.routes.js`: `GET /api/auth/google/login[?site=X]` (cookie `state` anti-CSRF + cookie de sede; el ingreso manda la sede del link) y `GET /api/auth/google/callback` (también `/api/auth/callback/google`): valida state, intercambia code, verifica id_token (`aud`, `email_verified`, dominio si `GOOGLE_ALLOWED_DOMAINS`), busca en `allowed_users`, crea la sesión y redirige a `/sede/<sede>/dashboard`.
- El gatekeeper sigue siendo `allowed_users`: si el mail no está autorizado, `/login?error=not_authorized`. Cada login queda en `local_movements` (`tipo='auth'`, `origen='Google'`). Setup en `server/scripts/README.md`.

## Shell

- `src/components/layout/AppShell.tsx` arma todo: `Sidebar` (menú agrupado Operación / Gestión / Inventario y datos / Recursos / Superadmin, 232 px; rail de 56 px con Ctrl B o bajo 1100 px), `Topbar` (título + contexto, Asistente, accesos rápidos, campana, cuenta), `MobileNav` (bajo 768 px: Inicio, Préstamos, Escanear, Agenda, Más; "Más" es una vista en línea, `MoreView`) y la columna del asistente. Catálogo del menú, grupos y títulos: `layout/nav.ts`. La lista de vistas es una sola: `VIEW_KEYS` en `src/types.ts`.
- La app ocupa la ventana (100dvh) y lo único que scrollea es `.shell-scroll` (franjas + contenido): para subir arriba usar `scrollAppToTop()` (`utils/scroll.ts`), no `window.scrollTo`.
- Nada flota: accesos rápidos, notificaciones, sede, cuenta, novedades de un release y **Ctrl K** (`CommandPalette.tsx`) son franjas en línea bajo la barra (`ShellStrips.tsx`, una a la vez; Esc o el mismo botón la cierran y devuelven el foco). La línea de estado global (`pushStatus` + `ShellStatus`) muestra avisos de acciones; arriba de ella van las líneas fijas de la app: "Sin conexión", "Hay una versión nueva · Actualizar" e "Instalá TechAsset" (`src/services/pwa.ts`). Ctrl K, franjas, "Más" y la barra inferior viajan en el chunk `ShellPanels` (precargado en idle). El asistente es columna a la derecha (≥ 1024 px) o vista propia.
- URLs: `/sede/<sede>/<vista>` y páginas de detalle con URL propia: `devices/<etiqueta>`, `tasks/<id>`, `tickets/<id>`, `knowledge/<id>[/editar]`, `settings/<panel>` (`settingsRoute.ts`). `navigate()` hace `pushState` (Atrás/Adelante recorren vistas); las correcciones automáticas (deep link inválido, módulo apagado, login) usan `replaceState`.
- Escáner USB global (`hooks/useGlobalScanner.ts`): exige ritmo de lector (≥ 4 caracteres, ≤ 50 ms de promedio entre teclas) e ignora campos editables, `form`, `[role=dialog]` y todo lo marcado con `[data-scanner-ignore]` (franjas, Ctrl K, asistente, formularios en línea). En el Inicio el lector cae en su barra de acción; en el resto lleva a Préstamos.
- Tema: `utils/theme.ts` (Oscuro / Claro / Sistema + densidad + tamaño de texto) → `html[data-theme|data-density|data-text-size]` y `theme-color`, antes del primer pintado (script en `index.html`). Se guarda local y en `/api/user/prefs`; los 8 perfiles viejos solo se traducen al leer.

## UI compartida (`src/ui/`, design system Grafito)

- Tokens en `src/styles/tokens.css` (contrato en `docs/redesign/TOKENS.md`): todo CSS nuevo usa solo tokens. CSS de cada pantalla en `src/styles/screens/<pantalla>.css`, importado desde su módulo lazy. El CSS heredado que queda (`components.css`, `layout.css`, `responsive.css`, `nav-smart.css`, `motion.css`, `global.css`) solo tiene reglas que alguien usa: `node scripts/purge-css.mjs [--write]` saca lo muerto y `node scripts/css-diff.mjs --before=<css viejo>` prueba que no cambió ningún estilo computado (todas las vistas, oscuro y claro, 1440/1024/768/390).
- Librería (muestra viva en la vista `ui`, solo superadmin, `src/ui/Showcase.tsx`): `Button`/`IconButton` (con `loading`), `Input`, `Textarea`, `NumberField`, `Select`/`Combobox` (lista en línea), `Checkbox`, `Switch`, `Segmented`, `TagInput`, pickers diferidos (`DatePicker`, `TimeField`, `DateRange`, `ColorField`, `FileDrop`), `Table` (filas-tarjeta en angosto), `Tabs`, `StatusText`, `Ring`, `Skeleton`, `EmptyState`, `ErrorState`, `TruncatedText` + `Tooltip` (la única capa flotante).
- Patrones en línea (reemplazan modales, confirm/prompt y toasts): `Collapse` (todo lo que se abre y se cierra: alto suave, el control tocado queda quieto, `lazy`/`unmountOnClose`; `useAnchoredToggle`/`keepInPlace` para otros cambios de alto), `InlineConfirm`/`useInlineConfirm`, `useInlinePrompt`, `StatusLine`/`useStatusLine` y `pushStatus` (con Deshacer / Reintentar), `SelectionHeader` + `useSelection`, `Disclosure`, `useScrollEdges` + `.ui-scroll-fade` para listas que scrollean sin barra.
- `components/layout/Feedback.tsx` quedó solo con `errorMessage`. **No usar `window.confirm/prompt/alert`**, `<select>`/inputs nativos de fecha/archivo/número, `<details>`, `title=` como tooltip (lo frena `npm run check:ui`), ni tragarse errores con `.catch(() => {})` en acciones del usuario.
- `utils/a11y` `clickableProps` para filas/tarjetas clickeables; `utils/download` para descargas/CSV (con BOM).
- Módulos que cada sede prende en Configuración: además de los de siempre, `knowledge`, `reminders` y `canvas` (arrancan apagados en sedes existentes).

## Dispositivos / inventario

- `server/services/deviceInventory.service.js` arma el inventario desde la base (`local_devices` + `local_states`, sin los `hidden_devices`). Caché en memoria por sede (60 s) que se invalida en cada escritura de equipos/préstamos (las rutas llaman `invalidateDeviceInventoryCache` y además hay un hook global en `server/index.js`); `getInventoryVersion` sirve de clave para cachés derivadas (la vida útil de `GET /api/devices`). Si agregás una escritura que cambia equipos por fuera de esas rutas, invalidá.
- Importación CSV: Borrar dispositivo = ocultar (`activo=0`, `deleted_at`). Reimportar el mismo `site_code+etiqueta` lo reactiva. No hay blacklist permanente.
- Alias operativo: `Filtro + Numero Operativo` (ej. `Touch 34`). Función central `getOperationalAlias` en `src/utils/classifyDevice.ts`. Se autonumeran los `PLANI` que no tengan número (estable por etiqueta) en `withOperationalAliases` desde `useDevices`.
- Búsqueda flexible (`src/utils/normalizeSearch.ts`): debe encontrar `touch 34`, `touch34`, `34touch`, `D1436`, `plani 5`, `planificación 5`, etc. — usa `normalizeAlias`, `flexibleDeviceKey`, `parseOperationalAlias`. Si tocás esto, mantener todos los formatos (lo prueba e2e c).
- La ficha de un equipo es su página (`/sede/x/devices/<etiqueta>`, `DeviceDetail`), con edición en el lugar.

## Estado de aulas (planos)

`src/components/classrooms/`:
- `ClassroomStatusPage.tsx`: selector de planta, resumen que filtra, lista de aulas y la ficha **en línea** (`ClassroomSheet.tsx`, al costado del plano en desktop, debajo en mobile). Las dos sedes tienen planos (NFPT: planta baja, 1er y 2do piso; "Nivel inicial" sale como "Próximamente". NFND: cinco plantas).
- Los planos son DATOS (`plan/floorPlans.js`) que dibuja un solo renderer (`plan/FloorPlan.tsx`) con tokens; cada aula es un `<button>`. **El `id` de cada aula es el `room_key` de la tabla `classrooms` y el `label` su `nombre`: no se renombran nunca** (`e2e/tests/classrooms.mjs` compara contra `e2e/fixtures/classroom-room-ids.json`). Zoom y pinza solo dentro del recuadro del plano.
- Equipamiento por aula es array dinámico (`equipment_json`). Estados válidos: `OK | Con falla | No tiene | En reparación | Sin revisar`. `'No encontrado'` está deprecado; al leer se migra a `'Con falla'` (`migrateLegacyClassroomData` corre una vez al startup).

## Tareas TIC

- Tabla `tasks` con columnas extra: `responsables_json` (array `["Bauti","Equi"]`), `turno`, `column_id` (columnas propias por sede, `task_columns`). `responsable` (string) se mantiene por compatibilidad.
- Subtareas: `task_items` (`POST/PATCH/DELETE /api/tasks/:id/items`, vienen dentro de `GET /api/tasks`); comentarios y actividad en `task_comments` / `task_history`.
- Tablero `TasksPage` (drag & drop, Deshacer); cada tarea tiene página propia (`/sede/x/tasks/<id>`, `TaskDetail`); alta y edición en línea (`TaskForm`). El "+" conserva la transición gooey (`GooeyMenu.tsx` + `motion.css`).
- Notas del día (lo que antes era "Traspaso TIC"): `internal_notes` + `/api/internal-notes` (GET/POST/PATCH; borrar = `visible:false`), en el Inicio (`dashboard/NotesPanel.tsx`).

## Próxima agenda

Se calcula en el front (`dashboard/agendaNow.ts`, usado por `NowColumn` del Inicio, y `AgendaPage.tsx`; no hay endpoint): actividad en curso (Entregado/Pendiente y horario actual entre `desde`/`hasta`), si no la próxima del día, si no la próxima de la semana. Cancelado/Realizado nunca aparecen como próxima.

Ojo con el orden de rutas en Express: un `/:id` declarado antes tapa a las rutas literales del mismo prefijo. Restringir el parámetro (`/:id(\d+)`) o declararlo al final. Las rutas `/api/*` inexistentes responden 404 JSON (no el `index.html`).

## Préstamos

- `LoanForm.tsx` soporta escaneo continuo: lista de equipos escaneados, agrega por lector (Enter) o a mano, marca duplicados / no disponibles, y un único formulario de persona/rol/ubicación/motivo aplica al lote. Chips de equipos y cartelitos con Ctrl/Cmd/Shift+Click → barra de selección (Prestar N / Devolver N).
- `POST /api/loans/lend` y `/return` actualizan la base y registran en `local_movements`. **No** hacen llamadas externas a Apps Script. Si alguien introduce esa dependencia de nuevo, romper la review.
- Lotes: `POST /api/loans/lend-batch` y `/return-batch` (un request, inventario armado una vez, cada equipo se resuelve por separado). Devolver deja un Deshacer (`loansUndo.routes.js`).
- El estado de un equipo se decide en UN lugar: `getLoanState` / `getDeviceStateKey` en `src/utils/deviceState.ts`, con la misma regla que `isAvailableState`/`isLoanedState` del server. Si cambia una, cambiar la otra.
- Cierre del día: `/api/daily-closures` (GET/POST + `/preview`) arma el resumen (préstamos activos, tareas, agenda e incidencias, aulas con problema, notas importantes); se abre en línea (`loans/DailyClosureSection.tsx`) desde Préstamos y desde el Inicio, y se guarda en `daily_closures`.

## Historial y papelera

- `GET /api/history?kind=loans|all&q&from&to&tipo&before&limit` (`server/routes/history.routes.js`): filtros en SQL y paginado por cursor (`timestamp|id`). Pantalla `HistoryPage` (visible si el rol ve Préstamos o Dispositivos).
- Papelera de dispositivos: `GET /api/devices/deleted` + `POST /api/devices/:etiqueta/restore`. Borrar = ocultar, con Deshacer en la línea de estado.
- `GET /api/agenda` omite por defecto las terminadas de más de 120 días (`?all=1` trae todo; la respuesta trae `olderHidden`).

## Accesos rápidos y herramientas

- `quick_links` + `/api/quick-links` CRUD. Validación de URL: solo `http(s)://`, rechaza `javascript:`, `data:`, `vbscript:`. Archivos `.bat` administrativos viven en `public/downloads/` y se sirven como descarga (no se ejecutan desde la web).
- Generador de tarjetas (Glifing / Santillana): `server/routes/tools.routes.js` genera HTML imprimible (A4, 2×4) con templates embebidos como data URL (`public/templates/`); `print-color-adjust: exact` para que el fondo salga al imprimir.

## PWA, notificaciones y errores

- `public/manifest.webmanifest` (colores del tema oscuro, íconos PNG 192/512 + maskable en `public/icons/`, generados con `node scripts/generate-icons.mjs` desde `techasset-logo.svg`).
- `public/sw.js`: la versión (`__BUILD_ID__`) la pone el build (plugin `techasset:sw-version` en `vite.config.ts`), así cada deploy publica un SW nuevo y borra el caché viejo al activarse. Navegación red primero (sin red: el shell guardado); `/assets/*` caché primero (nombres con hash: nunca CSS/JS viejo para un index nuevo); `/api`, `/uploads` y `/downloads` no pasan por el SW. Con la app abierta el SW nuevo **espera**: `src/services/pwa.ts` muestra "Hay una versión nueva · Actualizar" (SKIP_WAITING + recarga) y busca versiones al volver a la pestaña y cada 30 min. También: "Sin conexión" y el ofrecimiento de instalar (en línea, Android/Chrome, en la cabecera y en la landing). El SW se registra solo en producción.
- Campana: botón de la barra + franja (`NotifStrip`) + `hooks/useNotifications.ts` (polling 30 s, pausado con la pestaña oculta). Una notificación nueva sale como línea de estado ("Ver", 6 s).
- Backend: `server/services/notifications.service.js` (`notifyUser`, `notifySiteAdmins`, `broadcastRelease`, `sendPush` con fallback); tablas `notifications`, `push_subscriptions`, `release_notes`. Sin `VAPID_*` las push caen a in-app + mail.
- Novedades de un release: franja "Novedades" la primera vez después de un release (`GET /api/release-notes/latest`, visto en `localStorage`). Broadcast: `POST /api/admin/release-notes` (solo Superadmin) o `npm run release:broadcast`.
- **Sentry, apagado por defecto**: solo con `SENTRY_DSN` (server: `server/services/errorReporting.js`, errores del handler de Express y caídas por excepción sin atrapar, que se mandan con un proceso hijo sincrónico antes de que Node salga) y `VITE_SENTRY_DSN` al buildear (front: `services/errorReporting.ts` importa diferido `sentryLite.ts`; sin DSN no entra al bundle). Cliente mínimo propio (protocolo store, sin SDK): no manda cuerpos, cookies, headers, query strings ni el usuario; mails → `[mail]`, nombre/mail del usuario → `[persona]`, tokens largos → `[token]`. Variables en `.env.example`.

## Asistente e IA

- Todo lo que usa IA pasa por el adaptador `server/services/ai/provider.js` (`getAiProvider()`: `createChat` con herramientas + streaming, `generateText` para resúmenes/diagnósticos). Proveedor por env: `AI_PROVIDER=anthropic|openai|local`, `AI_MODEL` (default `claude-haiku-5-5`), `AI_EFFORT` (chat, default `low`), `ANTHROPIC_API_KEY`. OpenAI (por `fetch`, sin SDK) queda de respaldo solo mientras exista `OPENAI_API_KEY`. Sin keys, el asistente cae al modo local de reglas.
- `server/services/ai/text.js` (`generateAiText`): resúmenes de tickets/equipos (`aiSummaries.service.js`) y diagnóstico de aulas (`classrooms.routes.js`, salida JSON con esquema). Devuelve null sin proveedor o con el tope: el que llama usa su versión determinística.
- Tope diario por sede (`AI_DAILY_LIMIT_PER_SITE`, default 400, 0 = sin tope) y tokens en `ai_usage_daily`; cada llamada deja una línea `[ai] op=... in= out= cache_read= ms=` en el log (sin contenido).
- Chat: `server/services/assistant/chat.service.js` (prompt estable cacheado + bloque SESIÓN volátil; contexto de pantalla y artículos de conocimiento van como `<datos_no_confiables>`), herramientas en `tools.js` (formato Anthropic, `strict` en las de escritura), auditoría y Deshacer en `actions.service.js` (`assistant_audit`, `assistant_actions`). Panel: `src/components/assistant/AssistantPanel.tsx` con el stream (texto en vivo, línea "Buscando…/Prestando…" por herramienta), cada acción como línea de estado con Deshacer y el lote de más de 5 equipos como confirmación en línea.
- Seguridad: permisos por herramienta en el server (`writePermissionError`, por módulo); préstamos/devoluciones solo si el equipo (y la persona) aparecen en lo que escribió el usuario o en la pantalla abierta; más de 5 equipos en un pedido piden confirmación.
- Endpoints: `POST /api/asistente/chat` (respuesta completa, compatible), `POST /api/asistente/chat/stream` (SSE: `start`, `delta`, `tool`, `action`, `done`, `error`), `POST /api/asistente/deshacer`, `GET /api/asistente/status`. El dictado es del navegador (`src/hooks/useSpeechDictation.ts`, Web Speech API, es-AR; sin soporte el micrófono se oculta): el server no transcribe audio.
- Evaluaciones: `node server/scripts/ai-evals.mjs [--db=ruta] [--only=a,b] [--effort=low|medium] [--verbose]` contra una copia temporal de la base. Correrlas antes de cambiar modelo, prompt o herramientas.

## Pruebas y bancos

- `npm run e2e` (`e2e/run.mjs`, detalle en `e2e/README.md`): server real en un puerto libre contra una **copia** de `data/techasset.db` (nunca la real ni Postgres), `MODO_PRUEBA`, adjuntos en un temporal, Chrome con puppeteer-core. Funcionales por pantalla (préstamos, escáner, búsqueda flexible, papelera, tareas, tickets, aulas, configuración, login completo `tests/auth.mjs`, etc.), líneas base de layout y mobile, y el **barrido REGLAS-UX bloqueante** (`tests/ux.mjs` con la sonda `lib/ux-probe.mjs`: huecos, truncados con lugar, tapados, falsos clickeables, colapsables que mueven su disparador). `--only=<grupo>`, `--no-baseline`, `--ux-lenient`, `--headful --keep`.
- `server/scripts/bench/pg-smoke.mjs`: la API contra un Postgres real (contenedor `postgres:17-alpine` en un puerto libre). `bench-api.mjs`: queries y latencia por endpoint.
- `node perf/suite.mjs --repo=<checkout> --label=<nombre>`: benchmarks reproducibles (inicio, cambio de módulo, búsquedas, historial, scroll, prestar/devolver, API y bundle) con CPU 4× y red simulada; resultados en `docs/redesign/bench/`. `perf/README.md` para el resto.

## Deployment

**Producción real (VM bauhub, desde julio 2026): systemd, NO Docker.**

- Caddy corre en el host y proxea `techasset.bauhub.online` → `reverse_proxy 127.0.0.1:3013` (ver `/etc/caddy/Caddyfile`).
- En el 3013 escucha el servicio systemd `techasset` (`/etc/systemd/system/techasset.service`): `node server/index.js` desde `/opt/apps/techasset`, con `.env` ahí (PORT=3013, `DATABASE_URL` a Postgres/Supabase, `AI_PROVIDER`/`AI_MODEL`/`ANTHROPIC_API_KEY`; `OPENAI_API_KEY` solo hasta que se confirme Claude en producción; `SENTRY_DSN`/`VITE_SENTRY_DSN` si se prende Sentry).
- **Deploy: `ssh oracle` y correr `/opt/apps/techasset/deploy.sh`** (pull + npm install + build + `systemctl restart techasset` + health check). El restart NO es opcional: node no relee código del disco — actualizar la carpeta sin reiniciar deja el proceso viejo sirviendo (causa histórica de "deployé y sigue igual"). Los usuarios con la app abierta ven "Hay una versión nueva · Actualizar".
- Cuidado con el nombre: el `hostname` de la VM es `bauhub`, pero el alias en `~/.ssh/config` es **`oracle`** (`168.75.68.75`, user `ubuntu`, key `oracle-bauhub.key`). `ssh bauhub` no resuelve.
- La VM **no tiene credenciales de GitHub**: el código llega por un `git bundle` subido por scp, y el `origin` del repo remoto apunta a ese archivo en `/tmp` (que se borra al reiniciar la VM). Si `deploy.sh` avisa que el bundle no existe, desde la máquina de desarrollo: `git bundle create /tmp/techasset.bundle <sha-en-la-vm>..main`, `scp` a `bauhub:/tmp/`, `git remote set-url origin` al nuevo path y correr `deploy.sh`. El script imprime los comandos exactos con el SHA correcto.
- La VM tiene 1GB de RAM: el build tarda ~2-3 min. Si no da, buildear local y subir `dist/`, después `deploy.sh --no-build`.
- El container `techasset-nfs` (compose del mismo dir) quedó **detenido a propósito**: era un deploy paralelo que no recibía tráfico y confundía (`restart=no`). No volver a levantarlo salvo que se migre Caddy a apuntarle.
- `Dockerfile`/`docker-compose.yml` quedan para entornos que sí usen Docker: la imagen escucha `:8000` sin exponer puertos al host; el reverse proxy debe compartir la red `proxy-network` y proxear `techasset:8000`. Volumen `./data:/app/data` para SQLite/cache CSV/uploads.

## Convenciones

- Design system Grafito (oscuro y claro) y las reglas de abajo; no refactor destructivo.
- Migraciones idempotentes en `server/db.js` (`ensureColumn`, `CREATE TABLE IF NOT EXISTS`). Datos legacy: traducir, no borrar (ej. `'No encontrado' → 'Con falla'`, `piso='Primer piso' → 'Planta baja'`).
- En español rioplatense (`vos`, `acordate`). Encoding UTF-8 — vigilar mojibake `Ã©`/`prÃ³xima` en CSVs y mails.
- Logs: `[devices/perf]` está silenciado salvo que `DEBUG_DEVICE_PERF=1`. No volver a llenar la consola por default.

## Rendimiento

- **En producción cada query es un viaje SINCRÓNICO a Supabase** (`pg-sync` bloquea el proceso con `Atomics.wait`): un request cuesta queries × latencia y frena a todos los demás. Cada query que se saca de un endpoint que se pollea vale. Antes de sumar queries a algo que corre en cada request (auth, middlewares, `/api/devices`, `/api/movements`, notificaciones), medí.
- Cachés del server: sesión en memoria 30 s (`getUserSession`, `last_seen_at` cada 5 min, se limpia ante escrituras de usuarios/sedes/accesos), inventario por sede (ver arriba). ETag/304 en los GET polleados (`etag.service.js`).
- Caché del front: `apiGet` responde 15 s con lo último visto y revalida en segundo plano (`X-Revalidate: 1`); `apiSend` la vacía. Lo polleado/crítico está excluido (`NO_CACHE` en `apiClient.ts`). Toda escritura tiene que pasar por `apiSend` (o llamar `clearApiCache`).
- Presupuestos (PLAN §7): CSS inicial ≤ 40 kB gzip, JS de entrada ≤ 102 kB gzip, cada pantalla en su chunk lazy. Medir con `perf/suite.mjs` antes y después; si no mejora, se revierte.
- Fechas: usar `formatDate` / `dateFormatter` de `utils/formatters` (formateador cacheado), nunca `toLocaleString` en listas.
- Layout: no alternar lecturas de layout (`getBoundingClientRect`, `offsetWidth`) con escrituras en un loop; medir con `ResizeObserver`.
- **Nunca puede haber scroll horizontal**, en ninguna vista, ancho o breakpoint — salvo que el usuario lo pida explícitamente para un contenedor puntual. El `<body>` jamás scrollea en X. Contenido ancho (tablas, planos SVG, bloques de código) scrollea *dentro* de su propio contenedor, nunca empujando la página. Antes de cerrar un cambio de UI, verificar en mobile (360px) y desktop.
- **Nunca se superpone nada** (pedido explícito del dueño): ningún texto, botón ni bloque pisa a otro en ningún ancho de 360 a 1920px. Botones y labels nunca se parten en varias líneas ni palabra por palabra (`white-space: nowrap` + `text-overflow: ellipsis`, `min-width: 0` en hijos de flex); grupos de botones y chips envuelven con `flex-wrap`; columnas que no entran bajan, no se aplastan; tablas angostas pasan a filas-tarjeta.
- **Nunca se ven barras de scroll** (ni la nativa con flechitas ni una horizontal debajo de una fila de chips). Preferir no scrollear: mostrar los últimos N + "Ver más/anteriores", o envolver en filas. Si un contenedor interno tiene que scrollear, la barra va oculta con un degradé sutil en el borde como pista (`.ui-scroll-fade` + `useScrollEdges`).
- **Nada de modales ni capas flotantes** (pedido del dueño): sin modales, paneles laterales superpuestos, hojas inferiores, toasts o barras flotantes, popovers ni menús desplegables. Lo que se abre va en línea y empuja el contenido (resultados, formularios, fichas que se expanden, confirmaciones en la barra de selección, Deshacer como línea de estado). **Única excepción:** el texto truncado con elipsis se lee completo al hacer hover o foco con un tooltip chico, solo si está realmente cortado (en touch, tocarlo lo despliega en línea).
- **Mobile = pantalla fija** (pedido del dueño): sin zoom con dos dedos (en iPhone hay que cancelar `gesture*` y `touchmove` multitáctil, porque Safari ignora `user-scalable=no`), sin doble toque que agrande, campos de 16px o más, sin arrastre lateral ni rebote que muestre algo fuera de la app (`overflow-x: clip`, `overscroll-behavior: none`, fondo de `html` = fondo del tema), `100dvh`, zonas seguras. Solo el plano de aulas y el Canvas tienen zoom propio dentro de su recuadro. En desktop, con zoom afuera la app sigue llenando la ventana. Detalle completo en `docs/redesign/PLAN.md` §5.1.
- **Reglas de UX/UI del dueño** (19/10): `docs/redesign/REGLAS-UX.md` — sin saltos de layout ni de scroll por interactuar (todo plegable con `Collapse`), todo panel visible y accesible completo, feedback en toda acción, sin doble ejecución accidental, sin pérdida de datos en formularios, nada tapado por barras fijas, sin scroll anidado que atrape, sin huecos ni truncados con lugar, estados de carga/vacío/error/éxito, teclado y foco. Directiva de entrega: `docs/redesign/DIRECTIVA-FINAL.md`.
- **Nada de "AI slop"**: sin pastillas de estado con puntito y fondo tintado, sin puntitos de color delante de filtros ("● Disponible 68"), sin barras de progreso de colores (ni bajo duraciones o stock), sin checkboxes nativos azul brillante (checkbox propio sobrio), sin cuadraditos decorativos, sin glows ni gradientes. El estado normal no se marca (texto plano); solo lo que pide atención va como texto coloreado sin fondo. Proporciones (libres/total) con un anillo fino neutro.

## Animaciones y transiciones

- Las animaciones salen de [transitions.dev](https://transitions.dev) (plan Pro). Antes de escribir un keyframe a mano, buscar si ya existe la receta: `npx transitions-pro list`. Catálogo local en `src/styles/transitions/`.
- Estética sobria: micro-transiciones, easing y timing correctos. Nada de glows, confetti, bounces exagerados ni "AI slop".
- **Siempre respetar `prefers-reduced-motion: reduce`** — toda animación nueva va con su guard.
- Animar preferentemente `transform` y `opacity` (compositor). Evitar animar `width`, `height`, `top`/`left` o `box-shadow` en loops.
