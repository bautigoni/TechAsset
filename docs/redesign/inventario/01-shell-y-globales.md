# 01 · Shell y funciones globales

Relevamiento del caparazón de la app (lo que está alrededor de todas las vistas) y de las piezas compartidas. Fuente: el código de la rama `rediseno-grafito` al 16/10/2026. Todas las rutas son relativas a `src/` salvo que se diga otra cosa.

Alcance: `App.tsx`, `main.tsx`, `components/layout/*`, `hooks/*`, `services/apiClient.ts` + `activeSite.ts` + `authApi.ts` + `notificationsApi.ts` + `assistantApi.ts` + `userPrefsApi.ts`, `components/common/*`, `components/auth/*`, `components/assistant/*`, `utils/themeProfile.ts`, `utils/permissions.ts`, `utils/modules.ts`, `utils/lazyView.tsx`, `utils/a11y.ts`, `utils/download.ts`, `public/sw.js`, `public/manifest.webmanifest`, `index.html`, y `components/tools/QuickAccessPopover.tsx` (vive en la topbar).

---

## 0. Mapa de montaje

```
main.tsx
├─ applyThemeProfile(readThemeProfile())   ← antes del primer render (evita flash)
└─ <StrictMode>
   ├─ <App/>                               ← todo lo de abajo
   ├─ <InstallBanner/>                     ← hermano de App: existe aun sin sesión
   ├─ <ReleaseNotesModal/>                 ← hermano de App: pide /api/release-notes/latest al cargar
   └─ <FeedbackHost/>                      ← confirmDialog / promptDialog / toast

App (con sesión)
└─ div.app-shell[.sidebar-collapsed]
   ├─ <Sidebar/>        (clásica: aside.sidebar + .mobile-overlay | variante: aside.sidebar-rail)
   ├─ main.main.main-content
   │  ├─ <Topbar/>      (clásica: header.topbar.topbar-min | variante: .topbar-smart-block)
   │  └─ div.view-enter[key=view]  ← remonta en cada cambio de vista (animación de entrada)
   │     └─ <Suspense fallback=<SkeletonView/>> {la vista activa, key=activeSite}
   ├─ <MobileNav/>      (solo perfiles variante; bottom nav ≤980px)
   └─ <Suspense fallback=null>
      ├─ <AssistantPanel/>   (FAB + panel en portal al body)
      ├─ <DeviceProfile/>    si `profile` (ficha de equipo, global)
      └─ <AddDeviceModal/>   si `editingDevice` (editar equipo desde el dashboard)

App (sin sesión)
├─ authLoading → null (pantalla vacía, solo fondo)
├─ authMode 'landing' → <LandingPage/>
└─ authMode 'login' | 'register' → <LoginPage/>
```

No hay React Context ni store global: todo el estado del shell vive en `App` y baja por props. La comunicación transversal se hace con **CustomEvents en `window`** (ver §18) y con módulos singleton (`Feedback.tsx`, `apiClient.ts`, `activeSite.ts`).

---

## 1. Arranque y sesión (`App.tsx`, `main.tsx`)

**Para qué sirve:** decidir si hay sesión, qué sede y qué vista mostrar, y pintar rápido.
**Quién la ve:** todos.
**Datos:** `GET /api/auth/session` (`apiGet`, en `NO_CACHE` por el prefijo `/api/auth/`), `GET /api/user/prefs` (sí cacheado 15 s), `GET /api/site-settings` (cacheado), y en paralelo las cargas de datos de §6.

Comportamiento exacto:
- `main.tsx:11` aplica el perfil de tema guardado **antes** de montar React (sin flash claro/oscuro).
- **Sesión recordada** (`App.tsx:592-631`): `localStorage['techasset_session_cache']` = `{savedAt, user, sites}`. Si existe y tiene menos de **12 h** (`SESSION_CACHE_TTL_MS`), la app pinta la sesión en el primer frame y valida contra el servidor por detrás (`App.tsx:122-126`). No guarda credenciales (la cookie httpOnly de 30 días es la llave). Se reescribe en cada validación OK y en el login; se borra en logout, sesión vencida y validación negativa.
- Mientras `authLoading` → `return null` a propósito (`App.tsx:505`): ni spinner ni skeleton (el pedido tarda ~170 ms y un placeholder parpadea).
- Si `/api/auth/session` falla **por red**, no se expulsa al usuario (`App.tsx:149`). Solo una respuesta `authenticated:false` limpia todo.
- Tras validar, pide `GET /api/user/prefs` y si trae `themeProfile` lo aplica con `saveThemeProfile` (que además lo vuelve a guardar en el server, ida y vuelta redundante) (`App.tsx:134-139`).
- `useEffect` `user → setOperator(user.nombre || user.email)` (`App.tsx:154-156`): el "operador" de todas las escrituras es el usuario logueado (además el server lo pisa).
- `onReady` del login (`App.tsx:521-531`): setea user, operador, sedes, sede default (`isDefault` o la primera), guarda la sesión recordada y va a `dashboard`.
- **Logout** (`App.tsx:435-446`): `POST /api/auth/logout` (errores ignorados), borra sesión recordada y caché de API, resetea user/sedes/sede/vista/búsqueda, `authMode='landing'`, URL `/`. **No pide confirmación.**
- **Sesión vencida** (`App.tsx:421-433`): escucha `techasset:session-expired` (lo dispara `apiClient` ante cualquier 401 fuera de `/api/auth/`). Si había usuario: limpia todo, `authMode='login'` y URL `/login?error=session_expired` (el LoginPage traduce ese slug a "Tu sesión venció. Volvé a ingresar.").
- **Service worker** (`main.tsx:23-31`): solo en `PROD`, en `load`, `register('/sw.js', { updateViaCache: 'none' })` + `registration.update()`. Errores silenciosos.

**Riesgos:** el orden "pintar con caché → validar" depende de que ninguna vista haga algo irreversible antes de la validación. El `return null` durante `authLoading` es deliberado; no meter un splash. `readSessionCache` exige `user.email` y `sites.length`.

---

## 2. URLs, vistas y navegación (`App.tsx`)

| URL | Qué hace |
|---|---|
| `/` | Landing (sin sesión). Con sesión: sede default y vista `dashboard`; la URL se reescribe a `/sede/<sede>/dashboard`. |
| `/login` | LoginPage modo login. Lee `?error=<slug>` y `?password=<token>`. |
| `/register` | LoginPage modo registro. Lee `?code=<invitación>` (lo pasa a mayúsculas). |
| `/sede/<codigo>/<vista>` | Deep link. La sede se busca case-insensitive entre las del usuario (`App.tsx:109`); si no la tiene, cae a la default **y fuerza `dashboard`** (`App.tsx:112`). La vista se valida contra una lista blanca (`App.tsx:640`). |
| `/dashboard` | Destino del callback de Google cuando no hay sede (server `googleAuth.routes.js:143`). Sin sesión cae en landing; con sesión, sede default. |

- La URL **sigue** a la vista con `history.replaceState` (`App.tsx:180-184`): **no hay `pushState` ni `popstate`**. El botón Atrás del navegador **no** vuelve a la vista anterior (sale de la app o va a lo que hubiera antes). F5 sí conserva sede y vista.
- Los cambios de `authMode` también usan `replaceState` (`App.tsx:507-510`, `518-520`).
- Las vistas son estado (`view: ViewKey`), no rutas. `ViewKey` en `types.ts:1`.
- `'assistant'` está en la lista blanca de URL (`App.tsx:640`) y en `ViewKey`, pero **no renderiza nada**: `/sede/x/assistant` deja el `main` vacío (no hay `view === 'assistant'`).
- Si la vista actual queda deshabilitada por módulos de sede o por rol, vuelve a `dashboard` (`App.tsx:219-225`). Corre cuando llegan los `siteSettings`.
- `tenants` y `adminusers` además exigen `superadmin` en el render (`App.tsx:563-564`).
- Cada vista se monta con `key={activeSite}` (salvo `tools`, `quickaccess`, `tenants`, `adminusers`, `settings`): cambiar de sede **remonta** la vista y pierde su estado local.
- El contenedor `div.view-enter` tiene `key={view}` (`App.tsx:543`): cada cambio de vista remonta y dispara `t-view-enter` (solo entrada, sin salida a propósito).

**Lazy views** (`App.tsx:28-58`, `utils/lazyView.tsx`):
- Cada vista es un chunk propio con `lazyView(name, import, exportName)`. Fuera del nav también son lazy: `DeviceProfile`, `AddDeviceModal`, `AssistantPanel`, `LoginPage`, `LandingPage`.
- **Prefetch en idle** (`App.tsx:497-500`): cuando hay sesión y módulos, `prefetchViewsWhenIdle([...navKeys, 'device-profile', 'assistant'])` de a uno con `requestIdleCallback` (timeout 2,5 s; fallback `setTimeout 300`).
- **Prefetch por intención**: hover / focus / touchstart sobre un ítem del sidebar (`Sidebar.tsx:111-115`) y touchstart en el bottom nav (`MobileNav.tsx:43`) llaman `prefetchView`.
- Si el chunk ya está en memoria, `View` lo renderiza directo sin pasar por `React.lazy` (evita el throttle de 300 ms de Suspense) (`lazyView.tsx:63-66`).
- **Recarga automática tras deploy**: si falla un import dinámico, recarga la página **una sola vez** (flag `sessionStorage['techasset_chunk_reload']`, se limpia en el próximo import OK) (`lazyView.tsx:25-35`).
- Fallback de Suspense de las vistas: `<section className="view active"><SkeletonView/></section>` (`App.tsx:544`).

**Riesgos:** la lista blanca de vistas está duplicada en 3 lugares que no coinciden: `App.tsx:640`, `NotificationBell.tsx:19` (le faltan `history`, `reminders`, `adminusers`) y `types.ts:1`. Si se pasa a un router real, mantener `/sede/<codigo>/<vista>` (lo generan mails, notificaciones y el callback de Google) y `/login?password=` / `/register?code=` (los generan `server/routes/auth.routes.js:106` e `invites.routes.js:48`).

---

## 3. Sidebar (`components/layout/Sidebar.tsx`)

**Para qué sirve:** navegación principal entre módulos.
**Quién la ve:** todos con sesión. Los ítems se filtran con `visibleNavItems` (`Sidebar.tsx:68-75`):
- `superadminOnly` (`tenants` "Tenants", `adminusers` "Usuarios") solo superadmin.
- `isViewEnabled(key, settings)`: módulo prendido en la sede (`modules.enabled`; si la sede no tiene la clave, **todos** prendidos).
- `canViewModule(access, key)`: permiso de ver del rol (`roles.config`).
- `requiresAny`: `history` "Historial" aparece si el rol ve y la sede tiene prendido `loans` **o** `devices`.
- Orden (`navSort`, `Sidebar.tsx:213-228`): `dashboard`, `tenants` fijos arriba; `settings` siempre último; el resto según `modules.order` de la sede (lo que no esté va al final, 999).

Catálogo completo (`Sidebar.tsx:40-62`): Dashboard, Tenants*, Usuarios*, Dispositivos, Préstamos, Historial, Inventario TIC, Analítica, Agenda TIC, Horarios, Tareas TIC, Recordatorios, Canvas, Caja chica, Estado aulas, Tickets, Base de conocimiento, Sugerencias, Herramientas auxiliares, Accesos rápidos, Configuración. Íconos de `lucide-react`.

### 3a. Sidebar clásica (perfil `classic` / `smart` sin variante)

| Control | Dónde | Qué hace exactamente | Condiciones |
|---|---|---|---|
| Logo de sede + "TechAsset" + nombre de sede | `.brand` | Solo display. `TenantLogo` usa `site.logo` y cae a `/favicon.png` si falla la imagen (`TenantLogo.tsx`). | — |
| Botón contraer/expandir | `.brand-collapse-btn` | Alterna `sidebarCollapsed` y lo persiste en `localStorage['techasset_sidebar_collapsed']` ('1'/'0') (`App.tsx:448-454`). Ícono `PanelLeftClose`/`PanelLeftOpen`. `title` y `aria-label` "Contraer menú"/"Expandir menú". | Desktop (en mobile el sidebar es cajón). |
| Ítem de navegación (×N) | `nav.nav-scrollable` | `onNavigate(key)` + cierra el cajón mobile. Hover/focus/touchstart → prefetch del chunk. Clase `active` en el actual. | Filtrado por §3. |
| Configuración | `nav.sidebar-bottom-nav` | Igual, separado abajo. | Siempre visible. |
| Overlay oscuro | `.mobile-overlay` | Click cierra el cajón. | Solo ≤980px con el menú abierto. |

Micro-interacciones:
- Contraída (desktop): ancho ~82px, se esconden labels; **tooltip CSS** con `data-tooltip` + `::after/::before` en hover y `:focus-visible` (`components.css:2239-2285`). Además tiene `title=` nativo → hoy salen **dos tooltips** a la vez.
- `aria-current` no se usa en la clásica (sí en la variante); el activo es solo la clase.
- No hay cierre con Escape del cajón mobile.

### 3b. Sidebar variante (perfiles `*-stairs`, `*-centered`, `*-peek`)

| Control | Dónde | Qué hace | Condiciones |
|---|---|---|---|
| Caja flotante `.sidebar-box` | `aside.sidebar-rail` | Click en el riel (fuera de la caja) cierra el cajón (`Sidebar.tsx:123-125`). | — |
| Header logo + nombre de sede | `.sidebar-box-header` | Display. | Visible en mobile. |
| Cerrar (X) | `.sidebar-close-btn` | Cierra el cajón. | Mobile. |
| Ítems | `nav` | Igual que clásica, con `aria-current="page"`. Estilo `stairs`: `marginLeft` inline según distancia al activo: 0 / 26 / 19 / 12 / 5 px (`getStairsMargin`, `Sidebar.tsx:78-86`). Estilo `peek`: clase `peek`. | — |

- La variante **no tiene botón de contraer** ni sección inferior separada para Configuración.
- Desktop (≥981px): riel fijo de 240px debajo de una topbar de 64px (`nav-smart.css:230+`). Mobile (≤980px): cajón a pantalla completa con blur, la caja ocupa `min(86vw, 340px)` (`nav-smart.css:380-405`).
- Al elegir un estilo variante en Configuración > Apariencia se borra `techasset_sidebar_collapsed` y se dispara `techasset:sidebar-expand` (`AppearancePanel.tsx:26-29`, escuchado en `App.tsx:256-263`).

**Riesgos:** las reglas de `.sidebar` están definidas en al menos cinco bloques (`components.css:12`, `:642-704`, `:2175-2305`, `:3318`, `layout.css:141-220`, `:1381-1400`) con `!important` cruzados. `.app-shell.sidebar-collapsed` mueve el `main`. `body.mobile-menu-open` (`App.tsx:265-268`) bloquea scroll de fondo (`responsive.css:361`).

---

## 4. Topbar (`components/layout/Topbar.tsx`)

**Para qué sirve:** sede, accesos rápidos, notificaciones y cuenta. Ya no tiene título, buscador, recargar ni sincronización (comentario `Topbar.tsx:11-19`).

| Control | Dónde | Qué hace exactamente | Condiciones |
|---|---|---|---|
| Hamburguesa | Izquierda (`.mobile-menu-btn` clásica / `.topbar-menu-btn` variante) | `setMenuOpen(true)` (abre cajón). | Clásica: visible ≤980px. Variante: visible solo ≤768px (`nav-smart.css:131,179`). |
| Chip "Modo consulta" | Izquierda (`.consulta-banner`) | Indicador. | `effectiveConsultation`. **Oculto en ≤768px** en la clásica (`components.css:1841`, `:373`). |
| Banner de impersonación | Arriba de la topbar | "Modo superadmin · viendo {sede}" + punto pulsante + botón **"Salir del modo"** → vuelve a la sede default (`App.tsx:487-490`). | Solo **topbar variante**, superadmin, >1 sede y sede activa ≠ default (`App.tsx:486`). La topbar clásica no lo muestra. |
| Selector de sede | Derecha (`.site-switcher`) | Botón con logo, código, nombre y chevron; color `--tenant-accent` = `site.themeColor` (fallback `#3b82f6`). Abre menú `role="menu"` con todas las sedes (logo, código, nombre o subtítulo, check en la activa). Click → `onSiteChange(code)` + cierra. Cierra con click afuera (`mousedown`) y Escape (`Topbar.tsx:46-60`). Animación `t-dropdown` 120 ms. | **Solo `rolGlobal === 'Superadmin'` y >1 sede** (`Topbar.tsx:43`). |
| Chip de sede (estático) | Derecha (`.operator-chip`) | Muestra el código de sede; `title` = nombre de sede o mail. | Cuando no hay selector (clásica). En la variante no se muestra nada. |
| Accesos rápidos (rayo) | Derecha | Ver §4a. | Siempre (no mira si el módulo está prendido ni el rol). |
| Campana | Derecha | Ver §9. | Con sesión. |
| Avatar (iniciales) | Derecha | Toggle del menú de cuenta. Iniciales = primeras letras de las dos primeras palabras del nombre o mail (`Topbar.tsx:41`). `title` = mail. | — |
| Menú cuenta: nombre + mail | Dropdown | Display. | — |
| Menú cuenta: "Sede activa" | Dropdown | `CODIGO · Nombre`. | — |
| Menú cuenta: Tema Oscuro / Claro | Dropdown, grupo `aria-pressed` | Llama `toggleTheme` solo si cambia: alterna `classic*` ↔ `smart*` **conservando el estilo de nav** (`App.tsx:336-341`). Persiste local + server (§16). | — |
| Menú cuenta: Cerrar sesión | Dropdown | `handleLogout` (§1). Sin confirmación. | — |

Micro-interacciones:
- El menú de cuenta **no se cierra con click afuera ni con Escape** (no tiene listener; solo el avatar lo alterna). Tampoco se cierra al elegir tema.
- El menú de cuenta se dibuja en dos variantes de markup pero comparte estado (`Topbar.tsx:111-132`).
- Dropdowns montados con `useMountTransition` para animar la salida.

### 4a. Popover de accesos rápidos (`components/tools/QuickAccessPopover.tsx`)

| Control | Qué hace | Condiciones |
|---|---|---|
| Botón rayo (`Zap`) | Abre/cierra popover `role="dialog"`. Cierra con click afuera y Escape. | — |
| "Administrar" | Cierra y navega a `quickaccess`. | Si el módulo está apagado, el guard de `App.tsx:219` lo devuelve al dashboard. |
| Link (título + descripción), agrupados por categoría ("Sin categoría" por defecto) | Abre en pestaña nueva (`target=_blank rel=noreferrer`) y cierra el popover. | — |
| Vacío | "Todavía no hay accesos cargados." | — |

Datos: `useQuickLinks()` → `GET /api/quick-links` (vía `fetchQuickLinks`) + `GET /api/tools/config`, **una sola vez al montar la topbar**: no se recarga al cambiar de sede (un superadmin que cambia de sede sigue viendo los links de la anterior hasta recargar). Error → toast de error.

---

## 5. MobileNav / bottom nav (`components/layout/MobileNav.tsx`)

**Quién la ve:** solo perfiles variante (`hasVariantNav`) y ≤980px (`nav-smart.css:481-483`). En el tema clásico no renderiza nada: en mobile clásico la única navegación es el cajón por hamburguesa.

| Control | Qué hace | Condiciones |
|---|---|---|
| Ítems (máx. 4 slots) | Navega. touchstart → prefetch. `aria-current`. Píldora `.bottom-nav-pill` que se desliza con `translateX(index*100%)`. | Si hay >4 ítems se muestran los 3 primeros + "Más". |
| "Más" / "Cerrar" | Alterna el cajón (`setMenuOpen(open => !open)`). Íconos `MoreHorizontal`/`X` cruzados con `t-icon-swap` (el botón no cambia de tamaño). | Solo si hay >4 ítems. |

- Agrega `padding-bottom: 88px + safe-area` al `main` y sube FAB del asistente, toasts e install banner a `92px` (`nav-smart.css:486-511`).
- Hueco: entre 769 y 980px con perfil variante, la hamburguesa de la topbar está oculta y el cajón solo se abre con "Más"; si la sede tiene ≤4 ítems visibles no hay "Más" → **no hay forma de abrir el cajón** (igual todos los ítems ya están abajo).

---

## 6. Datos globales y auto-refresh (`App.tsx`, `hooks/useDevices|useAgenda|useTasks|useAutoRefresh`)

App es dueño de los datos que comparten varias vistas:

| Dato | Hook / función | Endpoint | Cuándo se pide |
|---|---|---|---|
| Equipos (+ `filteredDevices`, `counts`, `sync`) | `useDevices(search, activeSite)` | `GET /api/devices` (`?refresh=1&wait=1&_ts=` si force) — `NO_CACHE` | Al cambiar de sede (resetea a vacío y muestra "Sincronizando inventario X…"), con `force` al cambiar sede/usuario, cada tick del auto-refresh, tras cada préstamo/devolución/borrado. |
| Movimientos | `refreshMovements` (`App.tsx:161-177`) | `GET /api/movements` — `NO_CACHE` | Igual que equipos. Un solo pedido a la vez; `force` tras mutaciones. Sin re-render si el JSON no cambió. Errores ignorados. |
| Agenda | `useAgenda(operator)` | `GET /api/agenda` (`?all=1` tras `loadOlder`) — `NO_CACHE` | Al montar, al cambiar sede/usuario, cada 2 ticks. |
| Tareas (+ KPIs, turnos) | `useTasks(operator)` | `GET /api/tasks?space=all` — `NO_CACHE`; `GET /api/settings/shifts` (cacheado) | Al montar (turnos **solo** al montar), al cambiar sede/usuario, cada 2 ticks. |
| Settings de sede | `getSiteSettings` | `GET /api/site-settings` (cacheado 15 s) | Al cambiar sede/usuario (se pone en `null` mientras tanto → el guard de §2 espera), y `reloadSiteSettings` cuando Configuración cambia módulos/roles. |

- **Auto-refresh** (`App.tsx:229-239`): cada `VITE_AUTO_REFRESH_SECONDS` (default **15 s**): equipos + movimientos; agenda y tareas cada 2 vueltas (~30 s). `useAutoRefresh` **se pausa con la pestaña oculta** y al volver refresca una vez y retoma (`useAutoRefresh.ts:29-36`). Además el callback hace `if (document.hidden) return`.
- Las tres fuentes comparan el JSON con el último para no re-renderizar si no cambió.
- `useDevices`: `requestSeq` descarta respuestas de una sede anterior; los errores en polling no pisan un estado OK previo.
- Mutaciones centralizadas en App (todas mandan `operator`): `onAddDevice` (alta/edición), `onDeleteDevice` (borra + `removeLocal` optimista + refresh `force,wait`), `onLend`, `onReturn`, `onLendBatch`, `onReturnBatch`, `returnFromTable` (devolver desde tabla sin pasar por Préstamos), `createTaskFromAgenda` (crea "Revisar {curso} - {actividad}", prioridad Media, va a Tareas).
- `useTasks.move`: optimista, revierte si falla, bloquea un segundo drop mientras corre (`moving` ref). `useAgenda.remove` y `useTasks.remove` piden `confirmDialog` danger.
- **Semillas hacia Préstamos** (`App.tsx:456-474`):
  - `openLoanFlow(device|código)`: `loanSeed` se vacía y se setea en el próximo tick (`setTimeout 0`) para que el mismo código dos veces vuelva a disparar; navega a `loans`.
  - `openLoanBatch(etiquetas)`: `loanBatchSeed = {etiquetas, nonce+1}` (el nonce fuerza la recarga aunque el lote sea igual); navega a `loans`.
  - Al salir de `loans` ambas semillas se olvidan (`App.tsx:465-469`).
- `useScrollReveal` (`App.tsx:87`): en cada cambio de vista o de cantidad de ítems, agrega `.scroll-reveal` / `.is-visible` a **todas** las `.card, .stat-card, .agenda-card, .task-card, .chart-card` del documento (IntersectionObserver, fallback 900 ms). Es global y depende de esos nombres de clase.

**Riesgos:**
- `useAgenda.refresh` / `useTasks.refresh` deduplican con `inFlight`: si al cambiar de sede hay un poll en vuelo de la sede anterior, el pedido nuevo devuelve esa promesa vieja → la agenda/tareas pueden mostrar la sede anterior hasta el siguiente poll (~30 s).
- `/api/settings/shifts` no se vuelve a pedir al cambiar de sede (KPI "mías" con turnos de la sede inicial).
- El comentario de `useDevices.ts:15` dice "cada 5s"; el valor real es 15 s.

---

## 7. Escáner global (USB / pistola) (`App.tsx:298-334`)

**Para qué sirve:** escanear una etiqueta desde cualquier pantalla y caer en Préstamos con ese equipo cargado.

- Listener `keydown` en `window`, activo solo con sesión.
- Ignora si hay `Ctrl`, `Meta` o `Alt`; si el foco está en `input`/`textarea`/`select`/`contentEditable` (`isTypingTarget`, `App.tsx:651-655`) o dentro de un `.modal`.
- Acumula cada tecla de 1 carácter en un buffer; el buffer se procesa a los **120 ms sin teclas** o con **Enter** (Enter con buffer hace `preventDefault`).
- `parseScannedCode` (`utils/normalizeSearch.ts:5-20`) acepta: JSON con `etiqueta|id|codigo|code`, URLs con `etiqueta=|codigo=|code=|id=`, QR viejo `TA|<código>`, o cualquier `D####` dentro del texto.
- Si el resultado tiene ≥2 caracteres y algún dígito: `loanSeed` = código, vista `loans`, cierra el cajón mobile.

**Riesgos:** no distingue un escáner de una persona tecleando rápido: dos teclas en <120 ms con un dígito fuera de un input (p. ej. sobre el dashboard) mandan a Préstamos. El `ReleaseNotesModal` y el panel del asistente no usan la clase `.modal`, así que con foco en un botón de esos el escáner sigue activo. Cualquier rediseño de modales tiene que mantener la clase `.modal` (o cambiar este filtro).

---

## 8. Búsqueda global (estado huérfano) (`App.tsx:63, 273-296`)

Existe `search` en App y dos efectos que dependen de él, pero **ningún control lo setea** (el buscador de la topbar se sacó). Hoy es código muerto, pero documento qué hacía por si se quiere recuperar en el rediseño (command palette):
- `useDevices(search)` filtra con `matchesSmartSearch` → `filteredDevices` (lo que reciben Dashboard, Dispositivos e Inventario). Con `search=''` es igual a `devices`.
- Si la búsqueda contiene un `D####` y la vista es dashboard o dispositivos: a los 180 ms hace `scrollIntoView` suave a `[data-device-tag="D####"]` y le pone `.row-highlight` 1,6 s (`layout.css:1448`).
- Si contiene "prestar/préstamo(s)" + un número: a los 250 ms abre el flujo de préstamo con ese código y limpia la búsqueda.

No existe command palette ni atajo tipo Ctrl+K.

---

## 9. Notificaciones in-app (`NotificationBell.tsx`, `hooks/useNotifications.ts`)

**Datos:** `GET /api/notifications` (`NO_CACHE`) al montar y cada **30 s** (no se pausa con la pestaña oculta); `PATCH /api/notifications/:id/read`; `POST /api/notifications/read-all`.

| Control | Qué hace exactamente | Condiciones |
|---|---|---|
| Campana | Abre/cierra popover. Cierra con click afuera (`mousedown`). **No cierra con Escape.** | Con sesión. |
| Badge | Cantidad no leída, "9+" si >9. Siempre montado: con 0 se esconde con clase (`is-hidden`) para animar la salida y retiene el último número. Dígitos animados (`AnimatedNumber`). | — |
| "Marcar todas" | Optimista: todas leídas y badge a 0; error ignorado. | Solo si hay no leídas. |
| Ítem de notificación | Marca leída (optimista) y: si `kind` empieza con `release` o `link === '/release-notes'` → abre el modal de novedades (evento `techasset:open-release-notes`); si `link` es `http(s)://` → `window.open` en pestaña nueva; si no, resuelve vista por `link` (`/sede/x/<vista>` o `/<vista>`) o por `kind` (`task*`→tasks, `ticket*`→tickets, `suggestion*`→suggestions) y navega. Cierra el popover. Si no resuelve vista, queda abierto. | — |
| Vacío | "No tenés notificaciones." | — |
| Toast de notificación nueva | Abajo; título + cuerpo; botones **"Ver"** (= click en el ítem) y **×**. Se autocierra a los **6 s**. | Solo para la de `id` máximo, si es nueva respecto del poll anterior, no leída, y **nunca en la primera carga**. |

- Título y cuerpo pasan por `plainText` (saca markdown: `#`, `**`, `` ` ``, viñetas, links) (`NotificationBell.tsx:145`).
- Tiempo relativo: "recién", "hace N min", "hace N h", "hace N d".
- En ≤ cierto ancho el popover pasa a `position: fixed` de borde a borde (`components.css:1078`).

**Riesgos:** `NotificationBell` hace `return null` (`:49`) **antes** de llamar a `useMountTransition` (`:79-80`): rompe las reglas de hooks si `enabled` cambiara en caliente (hoy no cambia porque la topbar solo existe con sesión). La lista blanca de vistas (`:19`) no incluye `history`, `reminders`, `adminusers`.

---

## 10. Novedades / release notes (`components/common/ReleaseNotesModal.tsx`)

- Al cargar la app (aun sin sesión) pide `GET /api/release-notes/latest`. Si la versión no es la de `localStorage['techasset_last_seen_release']`, abre el modal.
- También se abre a demanda con el evento `techasset:open-release-notes` (forzado, aunque ya se haya visto).
- Contenido: tag "Novedades · vX.Y.Z", título, cuerpo markdown simplificado (`parseRelease`: `#` → h3, `- ` → ítem con ✓, resto párrafo; quita `**`, `` ` ``, links).
- Cierra con: botón **"¡Buenísimo!"**, click en el overlay, Escape (vía `useDialogFocus`). Al cerrar guarda la versión como vista.
- Foco atrapado y devuelto con `useDialogFocus`. Animación `t-fade` + `t-pop` (150 ms).
- No usa el componente `Modal` (overlay propio `.release-modal-overlay`) ni la clase `.modal`.

---

## 11. PWA, service worker y push

**`index.html`:** manifest, `theme-color #0f1a2e` fijo (no cambia con el tema claro), `apple-mobile-web-app-*` (status bar `black-translucent`), **`viewport` con `maximum-scale=1.0, user-scalable=no`** (bloquea el zoom, contradice el comentario de `main.tsx:33-34` que dice que se sacó), y `speculationrules` de prerender moderado excluyendo `/api/*`, `/uploads/*`, `/downloads/*`, `/logout`, `[download]`, `[rel~=nofollow]`, `[data-no-prerender]`.

**`public/manifest.webmanifest`:** `display: standalone`, `orientation: portrait-primary`, `start_url /`, colores oscuros, íconos `techasset-logo.svg` (any maskable) y `favicon.png` 192/512.

**`public/sw.js`** (cache `techasset-shell-v3`):
- Install: precache `manifest`, `favicon.png`, `techasset-logo.svg`; `skipWaiting`.
- Activate: borra caches viejos, `clients.claim`, manda `postMessage({type:'TECHASSET_SW_READY'})` a las ventanas (nadie lo escucha en el front).
- Fetch (solo GET mismo origen): `/api/*` network-first con fallback a caché (en la práctica nunca se cachea API); navegación network-first `no-store` y guarda `/index.html` para offline; `/assets/*` cache-first con actualización; resto network-first `no-store`.
- `push`: muestra notificación con `title`, `body`, `icon/badge favicon.png`, `data.link`.
- `notificationclick`: si hay una ventana abierta, `navigate(link)` + `focus`; si no, `openWindow(link)`.

**Activar push** (`notificationsApi.ts:55-74`, botón en Configuración > Notificaciones): chequea soporte (mensaje específico para iPhone: instalar primero), `Notification.requestPermission`, `GET /api/push/vapid-public-key`, `pushManager.subscribe`, `POST /api/push/subscribe`. Errores devueltos como texto.

**Install banner** (`components/common/InstallBanner.tsx`):
- Solo si: no se descartó (`localStorage['techasset_install_dismissed']`), viewport ≤768px, no está instalada (`display-mode: standalone` o `navigator.standalone`), y el navegador disparó `beforeinstallprompt` (Android/Chrome; en iOS nunca).
- **"Instalar"** → `prompt()` nativo y se oculta. **"Más tarde"** → descarta para siempre. Se oculta también con `appinstalled`.
- Fijo abajo (`z-index 80`), se corre arriba del bottom nav en perfiles variante.

---

## 12. Feedback global (`components/layout/Feedback.tsx`)

API imperativa usable desde cualquier archivo; `FeedbackHost` montado una vez en `main.tsx`. Store propio con `useSyncExternalStore`.

| Función | Qué hace |
|---|---|
| `confirmDialog({title, message?, confirmLabel='Confirmar', cancelLabel='Cancelar', danger?})` → `Promise<boolean>` | Modal con dos botones. **Si `danger`, el foco arranca en Cancelar** (un Enter de más no borra); si no, en Confirmar. Cerrar (X, Escape, backdrop) = `false`. |
| `promptDialog({title, message?, label, initial?, placeholder?, inputType='text', confirmLabel='Aceptar', required=true, options?})` → `Promise<string|null>` | Modal con un campo (`autoFocus`) o, si hay `options`, un `SelectField` (valor inicial = `initial` o la primera opción). Enter envía (es un `<form>`). Con `required`, el botón queda deshabilitado con valor vacío. Cancelar/cerrar = `null`. `inputType` admite `text`, `datetime-local`, `date`, `url`, `number` → **inputs nativos** (`Feedback.tsx:168`). |
| `toast(string | {message, tone?, action?, durationMs?})` | Pila abajo a la derecha (en mobile ancho completo, arriba del bottom nav). Máximo 4 a la vez (descarta los más viejos). Duración: 7 s con acción, 6 s error, 3,5 s resto. Acción (típicamente "Deshacer") cierra el toast y ejecuta. Botón ×. `role="alert"` en error, `status` en el resto; contenedor `aria-live="polite"`. Animación de cierre 220 ms. |
| `dismissToast(id)` | Cierra uno. |
| `copyToClipboard(text, okMessage?)` | `navigator.clipboard.writeText`; toast OK 2 s o toast de error ("Seleccioná el texto y copialo a mano"). Falla sin HTTPS. |
| `errorMessage(reason, fallback)` | Mensaje legible de una excepción. |

- Los diálogos se encolan: se muestra de a uno (FIFO).
- Usado en ~20 archivos (ver `grep confirmDialog|toast(`). Política del repo: **no usar `window.confirm/prompt/alert`** ni `.catch(() => {})` en acciones del usuario.

---

## 13. Componentes de layout compartidos

### Modal (`Modal.tsx`)
- Portal al `body`. `div.modal.t-modal[role=dialog][aria-modal][aria-labelledby]` > `.modal-card` (+ `wide` o `wide-modal` según `size`: `default|wide|full`, o prop `wide`).
- Cabecera `.card-head` con `h3` y botón X (`.modal-close`, `aria-label="Cerrar"`).
- **Solo el backdrop cierra**, y con `mousedown` cuyo target sea el backdrop: arrastrar una selección de texto desde adentro hacia afuera no cierra (`Modal.tsx:46-48`).
- `body.modal-open` mientras está montado (`overflow:hidden; touch-action:none`, `components.css:9`).
- Cierre en dos tiempos (`useCloseChoreography`, 150 ms = `--modal-close-dur`) para ver la salida; con reduced motion cierra en el acto.
- Foco/Tab/Escape con `useDialogFocus` (abajo).

### useDialogFocus (`hooks/useDialogFocus.ts`)
- Pila global de diálogos: **solo el de arriba** responde a Escape y Tab.
- Al abrir: si el foco no está adentro, va al primer focusable que no sea la X (`skipInitial='.modal-close'`) o a la tarjeta. Respeta `autoFocus` (si un campo ya tomó foco no lo toca).
- Tab / Shift+Tab ciclan dentro (solo elementos visibles, `offsetParent !== null`).
- Al cerrar devuelve el foco a lo que lo abrió.
- Lo usan `Modal`, `ReleaseNotesModal` y el modal de aula.

### SelectField (`SelectField.tsx`)
Reemplazo del `<select>` nativo (ya no queda ninguno en la app).
- Trigger `button[aria-haspopup=listbox]` con texto o placeholder ("Elegí una opción"), lista `role="listbox"` con `role="option"` y `aria-selected`; cada opción admite `hint` (línea chica).
- Teclado cerrado: Enter / Espacio / ↑ / ↓ abren. Abierto: ↑ ↓ mueven, Home/End, Enter/Espacio eligen, **Escape cierra con `stopPropagation`** (no cierra el modal de atrás), Tab cierra. Hover mueve el activo. El activo se mantiene visible (`scrollIntoView nearest`).
- Click afuera (`mousedown`) cierra.
- No tiene búsqueda por tipeo (type-ahead).

### DateField (`DateField.tsx`)
Calendario propio en vez del popup de `<input type="date">`.
- Muestra `dd/mm/aaaa`; guarda ISO `yyyy-mm-dd` sin pasar por UTC (evita el "día anterior" en Argentina).
- Popover `role="dialog"`: mes y año en castellano, ‹ › mes anterior/siguiente, grilla de 6 semanas que arranca el lunes (LU…DO), días fuera de mes atenuados, hoy y seleccionado marcados. Pie: **Borrar** (vacía) y **Hoy**.
- Si no entra a la derecha (`left + 268 > innerWidth - 12`) se ancla del otro lado (`is-right`) para no meter scroll horizontal.
- Escape (en captura, con `stopPropagation`) y click afuera cierran. Guarda al elegir el día (no en blur).
- No tiene navegación por teclado dentro de la grilla.
- Uso: `DeviceProfile`, `HistoryPage`.

### Selection (`Selection.tsx`)
- `useSelection()` → `{selected:Set, toggle(key), toggleMany(keys), clear}`. `toggleMany`: si ya estaban todas las saca, si no completa.
- `SelectionBar({count, onClear, floating, children})`: "**N** seleccionado(s)", acciones (children) y "Limpiar". `floating` la manda al `body` por portal (porque `.view-enter` usa transform y rompería el `position:fixed`), centrada abajo, subida a 88px en ≤980px. `role="region"`.
- Uso: Dispositivos, Préstamos (ChipPanelKit, DeviceChipsPanel, PhotoPassPanel), Tareas, Tickets.

### Button + TextSwap (`Button.tsx`, `TextSwap.tsx`)
- Variantes `primary | success | secondary(default) | danger | ghost | outline` → clases `btn btn-<variant>`. `type="button"` por defecto.
- Si el hijo es un string, se envuelve en `TextSwap`: al cambiar el texto ("Guardar" → "Guardando…") el viejo sale hacia arriba con blur y entra el nuevo (180 ms). Con ícono + texto no anima.

### Skeleton (`Skeleton.tsx`)
`SkeletonBlock`, `SkeletonLine`, `SkeletonPanel(rows,rowHeight,head)`, `SkeletonView` (página entera: título, subtítulo, 4 KPI, cuerpo). Pulso escalonado 90 ms por bloque. `aria-hidden`.

### StatCard + AnimatedNumber (`StatCard.tsx`, `AnimatedNumber.tsx`)
- `StatCard`: si tiene `onClick` es un `<button aria-pressed>` (filtro de KPI), si no un `<article>`. Props `large`, `active`.
- `AnimatedNumber`: anima dígito por dígito (`number-pop-in`) solo cuando el valor cambió, solo si es numérico y de ≤8 caracteres (evita partir "NFPT").

### Badge (`Badge.tsx`)
`<span class="badge {tone}">`. Tonos conocidos: `subtle, off, available, loaned, lost, out-service, overdue` (acepta string libre).

### GooeyMenu (`GooeyMenu.tsx`)
FAB "+" que se abre en satélites "líquidos" (filtro SVG). Usado en Agenda, Caja chica, Tareas y Tickets.
- `items: {id,label,icon,onSelect}[]`, `direction: up|down|left|right` (default `left`), radio 64px, abanico simétrico.
- **Con menos de 2 ítems no renderiza nada** (la acción ya está en la barra de la página).
- Click afuera y Escape cierran. Satélites con `tabIndex=-1` cerrados, `0` abiertos; `title` y `aria-label`. El "+" girado 45° es la X.
- Al cerrar hace un "amague" (`is-anticipating`, `--goo-anticip-dur`). Lee `--goo-blur`, `--goo-contrast` de CSS y los copia a atributos SVG.
- Notas del código que **no hay que "prolijar"**: filtro con `<g filter>` y no CSS `filter:url()` (WebKit), `transform` clásico y `animation-*` en longhand, `openRef` duplicado.

### TenantLogo (`TenantLogo.tsx`)
`<img>` con `site.logo` o `/favicon.png`; `onError` cae al fallback; `alt` = nombre o código.

---

## 14. Otros hooks compartidos

| Hook | Qué hace | Lo usa |
|---|---|---|
| `useMountTransition(open, closeMs)` | Sostiene montado durante la salida; `stateClass` `''`/`is-open`/`is-closing`; un frame en `entering` para que la entrada interpole. Sin espera con reduced motion. | Topbar, campana, accesos rápidos, release notes, asistente |
| `useCloseChoreography(onClose, ms)` | Variante para modales que avisan al padre al terminar. | `Modal` |
| `useTabPill(activeKey, 'fill'|'underline')` | Píldora deslizante entre tabs; mide `[data-tab-active="true"]` con `offsetLeft/Width`, re-mide con `ResizeObserver`. | Login, Historial, Tareas |
| `useCardResize(key)` | Anima el alto de un contenedor entre dos contenidos (mide, fija, reflow, suelta; 300 ms + 30). Respeta reduced motion. | Login, Tareas, Tickets |
| `useDragScroll()` | Paneo horizontal arrastrando el fondo (no sobre `input, textarea, select, button, a, [draggable=true], .task-card, .infinite-column-head`); clase `is-panning`. | Tablero de Tareas |
| `useScrollReveal(deps)` | Ver §6. | App |
| `useAssistantContext(ctx)` | Dispara `techasset:assistant-context` al montar y `…-clear` al desmontar. | DeviceGroupsManager, Knowledge, Suggestions, TaskModal, TicketDetailModal (DeviceProfile y ClassroomInfoPanel lo hacen a mano) |
| `useOperator()` | Operador en `localStorage['techasset_operator']`. App lo pisa con el usuario logueado. | App |
| `useSyncStatus(sync)` | Clase `sync-ok|sync-error|sync-pending` + title. | **Nadie** (huérfano desde que se sacó el punto de sync de la topbar). |
| `useAutoRefresh(cb, s)` | Ver §6. | App |

`services/assistantIntent.ts` (`detectAssistantIntent`: parser local de "prestale el Touch 34 a Mili en DOE", etc.) **no lo importa nadie**.

---

## 15. Cliente de API (`services/apiClient.ts`, `services/activeSite.ts`)

- Todas las llamadas mandan `Accept: application/json` y **`X-Site-Code: <sede de esta pestaña>`** (`apiClient.ts:25-28`). `siteHeaders()` lo exporta para `fetch` manuales (devicesApi, toolsApi).
- `apiGet`: caché en memoria **15 s** por `sede|url`. Dentro de la ventana responde con una copia (`structuredClone`) y revalida en segundo plano con `X-Revalidate: 1`. Pedidos simultáneos iguales se deduplican. `fetch` con `cache: 'no-cache'` (permite 304).
- `NO_CACHE` (`apiClient.ts:42`): `/api/auth/*`, `/api/devices` (y `?…`, `/diagnostics`), `/api/movements`, `/api/notifications`, `/api/release-notes`, `/api/push/*`, `/api/agenda` (exacto o con query), `/api/tasks` (exacto o con query).
- `apiSend` (POST/PUT/PATCH/DELETE): vacía la caché **antes y después**; un contador `generation` evita que una lectura que salió antes de la escritura guarde su resultado.
- `ApiError(message, status, data)`: el mensaje es `data.error` o `HTTP <status>`; también lanza si `data.ok === false` con 200.
- 401 fuera de `/api/auth/` → vacía caché + evento `techasset:session-expired`.
- Respuestas no JSON: si es HTML → "El servidor devolvió la app en vez del API. Recargá o tocá Reintentar."; si no, muestra los primeros 120 caracteres.
- **Sede por pestaña** (`activeSite.ts`): vive en memoria + `sessionStorage['techasset_active_site']` (sobrevive F5, no se comparte entre pestañas); `localStorage` con la misma clave solo como "última sede" para pestañas nuevas; default `NFPT`. App la fija en `useLayoutEffect` (`App.tsx:188-190`) para que ningún `useEffect` hijo pida con la sede anterior.

---

## 16. Tema claro / oscuro y estilos de navegación (`utils/themeProfile.ts`)

- 8 perfiles: `classic`, `classic-stairs`, `classic-centered`, `classic-peek`, `smart`, `smart-stairs`, `smart-centered`, `smart-peek`.
  - `classic*` = **oscuro** azul institucional (tema A).
  - `smart*` = **claro**, en realidad el "Tema B Smart Campus": crema/cálido, cards de radio 32, vidrio (`variables.css:85-135`), no el claro azul de `:root.theme-light`.
  - Sufijo `-stairs|-centered|-peek` = nav variante (sidebar-rail + topbar-smart + bottom nav). Sin sufijo = sidebar clásica.
- `applyThemeProfile`: `html[data-theme-profile=<perfil>]` + clase `theme-light` si es `smart*` **o** si quedó la clave legacy `localStorage['techasset_nfpt_theme']='light'` (en ese caso `classic` se ve con la paleta clara azul).
- `saveThemeProfile`: guarda `localStorage['techasset_theme_profile']`, borra la clave legacy, aplica, dispara `techasset:theme-profile` (App lo escucha) y hace `PATCH /api/user/prefs {themeProfile}` fire-and-forget.
- Se cambia desde: menú de cuenta (Oscuro/Claro, conserva el estilo de nav) y Configuración > Apariencia (`AppearancePanel.tsx`: tarjetas "Clásico"/"Tema claro" + chips Normal/Escalera/Centrada/Centrada + peek).
- Al iniciar sesión el perfil del server pisa al local (`App.tsx:134-139`).
- Cobertura: variables en `variables.css`; ~56 overrides `theme-light` en `components.css`; overrides `[data-theme-profile^="smart"]` en `nav-smart.css` (incluye `color-scheme: light` y color de scrollbars) y `global.css:643-671` (asistente). Hay colores hardcodeados en TSX (Landing, demo-cards, `#3b82f6` de `--tenant-accent`).
- `theme-color` del manifest/HTML no cambia con el tema.

---

## 17. Permisos, módulos y modo consulta

- **Rol en la sede** (`utils/permissions.ts`): `activeSiteRole` = `'Superadmin'` si `rolGlobal` es Superadmin; si no, `siteRole` de la sede activa o `'Consulta'`.
- **`roleAccess(settings, role, superadmin)`**: superadmin → todo. Si `settings['roles.config']` tiene el rol: `{admin, view:Set, edit:Set}`. Si no, heurística: managers (`Superadmin, Jefe TIC, Admin, Administrador`) admin+todo; editores (asistentes TIC) ven y editan todo; resto ve todo y no edita.
- `canViewModule`: vistas que no son módulo siempre visibles.
- **Módulos** (`utils/modules.ts`): 16 apagables (`devices, loans, inventory, analytics, agenda, schedules, tasks, pettycash, classrooms, tickets, suggestions, tools, quickaccess, knowledge, canvas, reminders`). Siempre prendidas: `dashboard, settings, tenants`. Sin `modules.enabled` en la sede = todos prendidos. Orden: `modules.order`.
- **Modo consulta** (`App.tsx:476-483`):
  - `roleReadOnly = !access.admin && access.edit.size === 0` (rol sin permisos de edición).
  - `consultationMode`: toggle manual en Configuración (SelectField "Desactivado/Activado", deshabilitado si `roleReadOnly`). **Vive solo en memoria**: se pierde con F5 o al cerrar sesión.
  - `effectiveConsultation = roleReadOnly || consultationMode` → baja a casi todas las vistas como `consultationMode`, al chip "Modo consulta" de la topbar y al asistente (`canEdit`).
  - Ojo: es binario. El permiso fino por módulo (`access.edit`) no baja a las vistas desde el shell (el server sí lo valida con `requireModuleEditor`).

---

## 18. Asistente de IA (`components/assistant/AssistantPanel.tsx`)

**Para qué sirve:** chat con datos de la sede, por texto o voz.
**Quién lo ve:** todos con sesión (el FAB siempre está, incluso en modo consulta; cambia solo el set de sugerencias).
**Datos:** `POST /api/asistente/chat {messages (últimos 12), context}`; `POST /api/asistente/transcribir {audio base64, mimeType}`.

| Control | Dónde | Qué hace | Condiciones |
|---|---|---|---|
| FAB "Asistente de IA" | Abajo a la derecha, fijo | Abre el panel. Label visible ≥768px. | Siempre. Se sube en perfiles variante mobile. |
| Cerrar (X) | Header del panel | Cierra. | — |
| Backdrop | Fuera del panel | Click cierra. | — |
| Sugerencias (7 staff / 6 consulta) | Bienvenida | Envían el texto directo. | Solo antes del primer mensaje (`hasStarted`). |
| Input de texto | Pie | Enter (submit) envía. Placeholder cambia: "Escribí tu pedido…" / "Te escucho…" / "Transcribiendo audio…". | Deshabilitado mientras carga o graba/transcribe. |
| Micrófono | Pie | 1er click: pide micrófono (`echoCancellation`, `noiseSuppression`), graba con `MediaRecorder` (prefiere `audio/webm;codecs=opus`, `audio/mp4`, `audio/webm`, `audio/ogg;codecs=opus`), chunks de 250 ms, **corte automático a los 60 s**. 2do click: detiene, transcribe y envía el texto. Estados: ícono mic / cuadrado (grabando, `is-recording`) / loader (transcribiendo). | Deshabilitado mientras carga o transcribe. |
| Enviar | Pie | Envía. | Deshabilitado sin texto, cargando o con voz activa. |
| "Escuchar" / "Detener" en cada respuesta | Burbuja del asistente | `speechSynthesis` con `lang es-AR`, prefiere voz `es-AR` y si no cualquier `es-*`. Solo una a la vez. | — |

Comportamiento:
- Respuesta: se le saca el markdown (`stripMarkdown`). Si trae `suggestedDevice` y `onOpenDevice` lo resuelve (`resolveDeviceMatches` sobre los equipos de App) → abre la ficha del equipo y **cierra el panel**. Si no, si trae `suggestedRoute` → navega (el panel queda abierto).
- **Contexto**: por defecto `{type:'view', view, label: view}`; lo pisan las pantallas que emiten `techasset:assistant-context` (ficha de equipo, aula, grupos de equipos, artículo, sugerencia, tarea, ticket). `…-clear` solo limpia si coincide `type`+`id` (`App.tsx:89-98`).
- Escape cierra (listener en `document`, no usa `useDialogFocus` → no atrapa foco, no devuelve foco, no respeta la pila de diálogos).
- Al cerrar: cancela una grabación en curso (sin enviar) y corta la voz. Al desmontar libera micrófono y voz.
- Indicador "escribiendo" con tres puntos.
- Errores en el chat como mensajes del asistente: sin soporte de grabación, sin permiso de micrófono, fallo de transcripción, fallo general ("No pude procesar el pedido…"), sin `speechSynthesis`.
- El historial vive mientras App esté montado (sobrevive a cambios de vista, se pierde con F5/logout). No hay botón para limpiar la conversación.
- **No hace auto-scroll** al último mensaje y el input no toma foco al abrir.
- Layout: desktop (≥768px) panel lateral derecho de 440px con `inset: 12px` y radio 28; mobile hoja inferior `max-height: min(78dvh, 680px)` con backdrop oscuro y safe areas. Z-index 9999/10000 (tapa todo, incluidos los toasts que están en 120).

---

## 19. Pantallas sin sesión

### Landing (`components/auth/LandingPage.tsx`)
**Quién la ve:** sin sesión en `/` (o cualquier ruta que no sea `/login` / `/register`).

| Control | Qué hace |
|---|---|
| Logo + "Iniciar sesión" (nav) | Va a modo login (`/login`). |
| "Ingresar" | Ídem. |
| "Crear cuenta" | Modo registro (`/register`). |
| Tabs del demo (Dashboard / Aulas / Préstamos) | Muestran una maqueta estática. |

- Carrusel automático cada **4,5 s**; clickear un tab no pausa el autoplay. Animación inline `demo-enter` sin guard de reduced motion. Colores hardcodeados.
- Pie: "Cada sede ve solo sus datos."

### Login / Registro / Contraseña (`components/auth/LoginPage.tsx`)

| Control | Modo | Qué hace exactamente | Condiciones |
|---|---|---|---|
| "← TechAsset" | login/registro | Vuelve a la landing. | — |
| Tabs "Iniciar sesión" / "Registrarse" | ambos | Cambia modo y URL; píldora subrayada deslizante (`useTabPill 'underline'`), el panel anima su alto (`useCardResize`). | — |
| Nombre | registro | `required`, `autoComplete=name`. | — |
| Mail | ambos | `type=email`, `required`, `inputMode=email`. | — |
| Contraseña | ambos | `required`, `minLength 6`; `autoComplete` current/new según modo. | — |
| "Olvidé mi contraseña / es mi primera vez" | login | Si el mail no tiene `@` → error "Escribí tu mail arriba y tocá de nuevo…". Si no, `POST /api/auth/password/request` y muestra el mensaje del server (idéntico exista o no la cuenta). | Deshabilitado con `busy`. |
| Código de invitación | registro | Se fuerza a MAYÚSCULAS; se precarga de `?code=`. Placeholder `TA-XXXX-XXXX`. | `required`. |
| Submit | ambos | Login: `POST /api/auth/login {email,password,nombre}`; OK → `onReady`. Si el error trae `passwordLinkSent` (cuenta vieja sin contraseña) se muestra como **éxito** ("te mandamos un link"). Registro: `POST /api/auth/register`; OK → mensaje de éxito y limpia campos (**no** cambia a login ni entra). Texto: "Ingresar"/"Crear cuenta"/"Procesando…". | Deshabilitado con `busy`. |
| "Continuar con Google" | login | `location.href = '/api/auth/google/login'` (no manda `?site=`). | Solo si `GET /api/auth/google/config` → `enabled`. |

**Pantalla "Elegí tu contraseña"** (si la URL trae `?password=<token>`, link de un solo uso que manda el server): contraseña nueva + repetir (`minLength 6`, `autoFocus` en la primera). Si no coinciden: "Las contraseñas no coinciden." OK → `POST /api/auth/password/confirm`, vuelve al login con el mail precargado y el mensaje del server. No tiene botón para volver.

Micro-interacciones:
- Al montar lee `?code`, `?error`, `?password` y **limpia la query** de la URL (`replaceState`) (`LoginPage.tsx:66-75`).
- `?error=<slug>` traducido (`translateGoogleError`): `google_no_code`, `google_bad_state`, `google_verify_failed`, `google_unavailable`, `not_authorized`, `account_pending`, `account_disabled`, `session_expired`, y genérico.
- Errores con **shake** (`t-input is-shaking`) que se repite aunque el mensaje sea el mismo (key con contador). `role="alert"`.
- Mensaje de éxito en verde (`auth-msg is-ok`).
- Nota fija: "Cada sede ve solo sus datos."

---

## 20. Modales globales montados por App

- **Ficha de equipo** (`DeviceProfile`): se abre desde Dashboard, Dispositivos, Préstamos, Historial, Inventario y el asistente (`setProfile`). Puede abrir otro equipo desde adentro (`onOpenDevice`). Recibe `consultationMode`.
- **Editar equipo** (`AddDeviceModal` con `initialDevice`): solo desde el Dashboard (`onEdit`). Guarda con `onAddDevice` (mismo endpoint de alta) y refresca.
(El detalle de estos modales va en el inventario de Dispositivos.)

---

## 21. Eventos globales (`window`)

| Evento | Lo dispara | Lo escucha | Efecto |
|---|---|---|---|
| `techasset:session-expired` | `apiClient` (401 fuera de `/api/auth/`) | `App` | Logout local + `/login?error=session_expired`. |
| `techasset:theme-profile` (detail: perfil) | `saveThemeProfile` | `App` | Actualiza `themeProfile`. |
| `techasset:sidebar-expand` | `AppearancePanel` | `App` | Expande sidebar y borra la preferencia. |
| `techasset:assistant-context` (detail: contexto) | `useAssistantContext`, `DeviceProfile`, `ClassroomInfoPanel` | `App` | Contexto del asistente. |
| `techasset:assistant-context-clear` | ídem al desmontar | `App` | Limpia si coincide type+id. |
| `techasset:open-release-notes` | `NotificationBell` | `ReleaseNotesModal` | Abre novedades (forzado). |
| `beforeinstallprompt` / `appinstalled` | navegador | `InstallBanner` | Banner de instalación. |
| `visibilitychange` | navegador | `useAutoRefresh` | Pausa/retoma polling. |
| `keydown` (window) | — | Escáner (`App`), `useDialogFocus` | Ver §7 y §13. |
| `keydown` (document) | — | Topbar (menú sede), QuickAccessPopover, GooeyMenu, DateField (captura), AssistantPanel | Escape cierra. |
| `message` `TECHASSET_SW_READY` | `sw.js` | nadie | — |

## 22. Claves de almacenamiento

| Clave | Storage | Dueño | Contenido |
|---|---|---|---|
| `techasset_session_cache` | local | App | `{savedAt, user, sites}`, TTL 12 h |
| `techasset_active_site` | session + local | activeSite | sede de la pestaña / última sede |
| `techasset_sidebar_collapsed` | local | App, AppearancePanel | `'1'`/`'0'` |
| `techasset_theme_profile` | local | themeProfile | perfil (además en server: `/api/user/prefs`) |
| `techasset_nfpt_theme` | local | legacy | `'light'` fuerza paleta clara; se borra al guardar perfil |
| `techasset_operator` | local | useOperator | nombre del operador |
| `techasset_install_dismissed` | local | InstallBanner | `'1'` |
| `techasset_last_seen_release` | local | ReleaseNotesModal | versión vista |
| `techasset_chunk_reload` | session | lazyView | anti-loop de recarga tras deploy |
| `techasset_loans_open_panels` | local | ChipPanelKit (Préstamos) | paneles abiertos (fuera de este alcance) |

## 23. Capas fijas y z-index (para no taparse en el rediseño)

Asistente 9999/10000 · toasts `app-toasts` 120 · install banner 80 · popover campana 70 · FAB asistente 60 · SelectionBar flotante 60 · sidebar-rail mobile 50 · topbar mobile/hamburguesa 45 · account menu 40 · sidebar mobile 40 (layout.css) / 20 (components.css) · overlay 35/19 · bottom nav 30. FAB, toasts, install banner, SelectionBar flotante y bottom nav compiten por la franja inferior en mobile.

---

## Controles nativos o fuera de sistema a reemplazar

- `promptDialog` con `inputType` `date | datetime-local | number | url` → `<input>` nativo (`Feedback.tsx:168`). Hoy: `datetime-local` en `RelatedReminders.tsx:29` y `RemindersPage.tsx:139` (posponer), `url` en `DevicesPage.tsx:111` (importar CSV).
- Tooltips `title=` nativos: sidebar (duplicado con `data-tooltip`, `Sidebar.tsx:181,190,201`), avatar (`Topbar.tsx:156,182`), chip de sede (`:178`), accesos rápidos (`QuickAccessPopover.tsx:41`), GooeyMenu (`:177`), micrófono del asistente (`AssistantPanel.tsx:328`).
- Inputs nativos del login y del asistente (estilos propios `auth-input`, `assistant-input`), sin sistema común con `.input`.
- `window.open` en notificaciones con link externo.
- `index.html`: `user-scalable=no, maximum-scale=1.0`.
- Scrollbars: solo coloreadas en perfiles `smart` (`scrollbar-color`).

## Mobile (resumen)

- ≤980px: sidebar clásica = cajón desde la izquierda (`min(82vw,330px)`), overlay que cierra, `body.mobile-menu-open` bloquea scroll. Hamburguesa visible. Sin Escape para cerrar.
- ≤980px perfiles variante: cajón a pantalla completa con blur + bottom nav (4 slots, "Más"). Hamburguesa recién ≤768px.
- ≤768px clásica: la topbar pasa a grilla compacta; **se oculta el chip "Modo consulta"**; en el selector de sede se oculta el nombre (solo código).
- Popover de campana a ancho completo; toasts a ancho completo sobre el bottom nav.
- Install banner solo ≤768px.
- Asistente como hoja inferior.
- `env(safe-area-inset-*)` en sidebar, main, install banner, FAB, bottom nav, toasts (`layout.css:7-37`).
- Pinch-zoom bloqueado por el viewport.

## Riesgos para el rediseño (consolidado)

1. **Clases que usa JS**: `.modal` (filtro del escáner, `App.tsx:317`), `[data-device-tag]` + `.row-highlight` (búsqueda), `.card/.stat-card/.agenda-card/.task-card/.chart-card` (scroll reveal global), `[data-tab-active="true"]` (useTabPill), `.modal-close` (foco inicial), `.task-card`/`.infinite-column-head` (drag-scroll), `body.modal-open`, `body.mobile-menu-open`, `.view-enter` (portal de SelectionBar por el transform).
2. **Animaciones de salida** dependen de `useMountTransition`/`useCloseChoreography` + duraciones duplicadas entre TS y `motion.css` (`CLOSE_MS 150`, dropdown 120, toast 220/250, text-swap 180, resize 300). Si cambian en CSS hay que cambiarlas en TS.
3. **CSS acumulado**: reglas de `.sidebar`, `.topbar`, `.mobile-menu-btn`, `.consulta-banner` repetidas en 4–5 lugares con `!important`; selectores muertos (`#globalSearch`, `#operatorChip`, `.sync-mini`, `.topbar-smart-search`, `.assistant-topbar-btn`).
4. **Dos shells paralelos** (clásico vs variante) con markup distinto para la misma topbar/sidebar y diferencias funcionales (banner de impersonación solo en variante; colapsar solo en clásico; bottom nav solo en variante).
5. **Lista blanca de vistas triplicada** y desincronizada (§2).
6. Hooks condicionales en `NotificationBell` (§9).
7. Race de sede en `useAgenda`/`useTasks` (§6).
8. Escáner global sensible a tipeo rápido (§7).
9. `useLayoutEffect` de `setActiveSiteCode` tiene que seguir corriendo antes que los efectos de las vistas.
10. Sin `pushState`: si el rediseño agrega historial real, revisar que `replaceState` de logout/expirado/deep link siga funcionando y que el guard de módulos no genere loops.

---

## Lista de verificación

Arranque y sesión
- [ ] Con sesión recordada (<12 h) la app pinta en el primer frame y valida por detrás.
- [ ] Sin sesión recordada no se ve ningún parpadeo (pantalla vacía hasta resolver).
- [ ] Error de red en `/api/auth/session` no expulsa al usuario.
- [ ] Sesión inválida limpia caché y muestra landing.
- [ ] Preferencia de tema del server se aplica al entrar.
- [ ] Logout: POST, limpia caché de sesión y API, vuelve a `/`.
- [ ] Cualquier 401 fuera de `/api/auth` manda a `/login?error=session_expired` con el mensaje.
- [ ] Service worker se registra solo en producción.

URLs y vistas
- [ ] `/sede/<sede>/<vista>` abre esa sede y vista (sede case-insensitive).
- [ ] Sede no permitida en la URL → sede default + dashboard.
- [ ] Vista inválida en la URL → dashboard.
- [ ] La URL se actualiza al navegar y F5 conserva sede y vista.
- [ ] `/login`, `/register`, `/register?code=X`, `/login?password=T`, `/login?error=slug` funcionan.
- [ ] Vista con módulo apagado o sin permiso redirige a dashboard.
- [ ] Tenants y Usuarios solo para superadmin.
- [ ] Cambiar de sede remonta las vistas (estado local reseteado).
- [ ] Animación de entrada al cambiar de vista (respeta reduced motion).
- [ ] Skeleton de vista mientras carga el chunk.
- [ ] Prefetch en idle de las vistas del rol + ficha de equipo + asistente.
- [ ] Prefetch al hover/focus/touch del nav.
- [ ] Recarga única automática si falla un chunk tras un deploy.

Sidebar / navegación
- [ ] Ítems filtrados por superadmin, módulos de sede, permiso de rol y `requiresAny` (Historial).
- [ ] Orden: dashboard, tenants, orden de `modules.order`, configuración al final.
- [ ] Colapsar/expandir persistido; tooltips en colapsado.
- [ ] Logo de sede con fallback a favicon.
- [ ] Mobile: cajón con overlay que cierra; scroll de fondo bloqueado; navegar cierra el cajón.
- [ ] Variante: estilos escalera (márgenes 0/26/19/12/5), centrada, peek; cerrar con X o click en el riel.
- [ ] Elegir estilo variante expande el sidebar.
- [ ] Bottom nav (variante, ≤980px): 4 slots, píldora deslizante, "Más/Cerrar" con íconos cruzados.

Topbar
- [ ] Hamburguesa en mobile.
- [ ] Chip "Modo consulta" cuando corresponde.
- [ ] Banner de impersonación + "Salir del modo" (superadmin fuera de su sede default).
- [ ] Selector de sede (superadmin con >1 sede): color de sede, logo, check, cierra con click afuera/Escape.
- [ ] Chip de código de sede para el resto.
- [ ] Menú de cuenta: nombre, mail, sede activa, Oscuro/Claro, Cerrar sesión.
- [ ] Accesos rápidos: popover agrupado por categoría, links en pestaña nueva, "Administrar", vacío, Escape/click afuera.

Datos y polling
- [ ] Equipos + movimientos cada 15 s (`VITE_AUTO_REFRESH_SECONDS`), agenda + tareas cada ~30 s.
- [ ] Polling pausado con la pestaña oculta; refresca al volver.
- [ ] Sin re-render si los datos no cambiaron.
- [ ] Recarga completa al cambiar de sede/usuario (no al cambiar de vista).
- [ ] Settings de sede recargados al cambiar módulos/roles en Configuración.
- [ ] Prestar/devolver/lotes/borrar refrescan equipos y movimientos.
- [ ] Devolver desde tabla sin pasar por Préstamos.
- [ ] Crear tarea desde agenda ("Revisar curso - actividad") y saltar a Tareas.
- [ ] Semilla de préstamo (un equipo) y de lote (con nonce) llegan a Préstamos y se olvidan al salir.
- [ ] Mover tarea optimista con rollback y bloqueo de doble drop.
- [ ] Borrar actividad/tarea pide confirmación.
- [ ] Scroll reveal de tarjetas.

Escáner
- [ ] Escaneo fuera de inputs y modales lleva a Préstamos con el equipo.
- [ ] Acepta JSON, URL con `etiqueta=`, `TA|código`, `D####`.
- [ ] Ignora Ctrl/Meta/Alt y foco en campos.
- [ ] Enter con buffer no dispara otra acción.

Notificaciones / novedades / PWA
- [ ] Campana con badge (9+), animación de número, popover, marcar todas, marcar una al abrir.
- [ ] Navegación por link interno, por kind, link externo en pestaña nueva, release → modal.
- [ ] Toast de notificación nueva (no en primera carga), "Ver", ×, autocierre 6 s.
- [ ] Poll cada 30 s.
- [ ] Modal de novedades una vez por versión; reabrible desde la campana; Escape/overlay/botón cierran; foco atrapado.
- [ ] Banner de instalación (mobile, Android, no instalada); "Instalar"; "Más tarde" permanente.
- [ ] Push: permiso, suscripción, notificación del SO con link, click abre/enfoca la app.
- [ ] SW: navegación offline con index cacheado; assets cache-first; API sin caché viejo.
- [ ] Speculation rules sin prerender de API/descargas/logout.

Feedback y componentes
- [ ] `confirmDialog` con foco en Cancelar si es destructivo.
- [ ] `promptDialog` texto / opciones / required / Enter envía.
- [ ] Diálogos encolados de a uno.
- [ ] Toasts: tonos, acción Deshacer, duración por tipo, máx. 4, cerrar.
- [ ] `copyToClipboard` con toast OK/error.
- [ ] Modal: portal, cierra solo por backdrop (mousedown), X, Escape; scroll de fondo bloqueado; tamaños default/wide/full; foco atrapado y devuelto; pila de modales.
- [ ] SelectField: teclado completo, Escape no cierra el modal de atrás, hint, placeholder.
- [ ] DateField: ISO local sin desfase, lunes primero, Borrar/Hoy, se ancla a la derecha si no entra.
- [ ] SelectionBar: contador, acciones, Limpiar, flotante por portal.
- [ ] Button: variantes y TextSwap del label.
- [ ] StatCard como botón con `aria-pressed` cuando filtra; AnimatedNumber solo numérico.
- [ ] GooeyMenu: no aparece con <2 acciones; Escape/click afuera; satélites tabulables solo abiertos.
- [ ] Skeletons (bloque, línea, panel, vista).

Tema y permisos
- [ ] Oscuro/Claro desde la cuenta conserva el estilo de nav.
- [ ] Perfil persistido local + server; sin flash al cargar.
- [ ] Clave legacy `techasset_nfpt_theme` respetada/limpiada.
- [ ] Modo consulta = rol sin edición o toggle manual; bloquea ediciones en todas las vistas y cambia las sugerencias del asistente.
- [ ] Toggle manual deshabilitado si el rol ya es de solo lectura.
- [ ] Sede por pestaña (`X-Site-Code`), sobrevive F5, pestaña nueva usa la última.
- [ ] Caché de lecturas 15 s con revalidación; escrituras la vacían; `NO_CACHE` respetado.

Asistente
- [ ] FAB visible en todas las vistas; label en desktop.
- [ ] Sugerencias staff/consulta antes del primer mensaje.
- [ ] Enviar texto; indicador escribiendo; respuesta sin markdown.
- [ ] Abrir ficha de equipo sugerida (y cerrar panel) o navegar a la ruta sugerida.
- [ ] Contexto de la pantalla (equipo, aula, tarea, ticket, etc.) o de la vista.
- [ ] Voz: grabar, cortar a 60 s, transcribir y enviar; mensajes de error de micrófono/soporte.
- [ ] Escuchar/Detener respuesta en es-AR.
- [ ] Escape, X y backdrop cierran; cerrar cancela grabación y voz.
- [ ] Panel lateral 440px en desktop, hoja inferior en mobile.

Auth
- [ ] Landing: Ingresar, Crear cuenta, Iniciar sesión, carrusel de demo con tabs.
- [ ] Login por mail+contraseña; error con shake (también si se repite).
- [ ] Cuenta sin contraseña → mensaje de link enviado como éxito.
- [ ] "Olvidé mi contraseña / es mi primera vez" exige mail y muestra mensaje neutro.
- [ ] Registro con código (mayúsculas, precargado de la URL), mensaje de éxito y limpieza.
- [ ] Pantalla de contraseña nueva desde el link (coincidencia, mínimo 6, vuelve al login con el mail).
- [ ] Google visible solo si está configurado; errores traducidos.
- [ ] La query de la URL se limpia al entrar al login.

---

## Ideas de mejora (opcionales, no son funcionalidad existente)

- Router real con `pushState` para que Atrás/Adelante naveguen entre vistas; una sola lista de vistas compartida (App, campana, tipos).
- Recuperar la búsqueda global como **command palette** (Ctrl+K): ya existen `search`, el salto a `[data-device-tag]` y el atajo "prestar D####" en `App.tsx:273-296`.
- Cerrar el menú de cuenta con click afuera / Escape; Escape para el cajón mobile y la campana.
- Mostrar el chip "Modo consulta" también en mobile y el banner de impersonación en el shell clásico.
- Dejar cambiar de sede a cualquier usuario con más de una sede (hoy solo superadmin; el resto solo por URL).
- Persistir el toggle de modo consulta (hoy se pierde con F5).
- Pausar el poll de notificaciones con la pestaña oculta, como el resto.
- Recargar accesos rápidos y turnos al cambiar de sede; invalidar `inFlight` de agenda/tareas al cambiar de sede.
- Asistente: auto-scroll al último mensaje, foco en el input al abrir, botón "nueva conversación", usar `useDialogFocus`.
- Escáner: exigir ritmo de escáner (p. ej. ≥4 caracteres en <300 ms o Enter final) para no confundir tipeo humano.
- Quitar `user-scalable=no` del viewport (lo pide el comentario de `main.tsx`) y hacer que `theme-color` siga al tema.
- Borrar código huérfano: `useSyncStatus`, `assistantIntent.ts`, vista `assistant` en la lista blanca, CSS muerto de la topbar vieja, mensaje `TECHASSET_SW_READY`.
- Unificar el markup de los dos shells (clásico y variante) y limpiar las reglas duplicadas de `.sidebar`/`.topbar`.
- Mover `NotificationBell` a hooks incondicionales.
- Pausar el carrusel de la landing al interactuar y con reduced motion.
