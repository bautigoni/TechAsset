# Inventario 06: Analítica, Configuración, Herramientas, Accesos rápidos y Caja chica

Relevado contra el código de la rama `rediseno-grafito` (octubre 2026). Las referencias `archivo:línea` son del archivo real. Donde dice "server" es `server/routes/*.js`.

Pantallas cubiertas:

1. Analítica (`AnalyticsPage`, `ParqueSection`, `ChartCard`)
2. Configuración (`SettingsPage` y sus paneles: Apariencia, Turnos, Notificaciones, Módulos, Roles, Invitaciones, Opciones de préstamo, Vida útil, Usuarios permitidos, Avanzado)
3. Tenants (`TenantsDashboard`, solo superadmin)
4. Usuarios por tenant (`UsersByTenantPage`, solo superadmin)
5. Herramientas auxiliares (`ToolsPage`: Creador de tarjetas Glifing/Santillana, Credenciales 365, Configuración SMTP)
6. Accesos rápidos (`QuickAccessPage` + `QuickAccessPopover` de la topbar + Descargas .bat)
7. Caja chica (`PettyCashPage`)
8. Componentes sueltos: `MailStatusChip`, `SiteAdminPanel` (código muerto)

---

## Mapa de permisos de esta área (leer primero)

Hay **dos sistemas de permisos que no siempre coinciden**, y el rediseño tiene que respetar los dos tal como están hoy:

| Concepto | Front | Back |
|---|---|---|
| Superadmin | `isSuperadmin(user)` → `rolGlobal === 'Superadmin'` (`src/utils/permissions.ts:16`) | `isSuperadmin(req.user)` (`server/services/siteContext.service.js:135`) |
| Admin de sede ("manager", Jefe TIC) | `roleAccess(...).admin` desde `roles.config` del tenant, fallback por nombre `Superadmin/Jefe TIC/Admin/Administrador` (`permissions.ts:52-68`) | `isSiteManager(req)` = `resolveSitePermissions().admin` (`siteContext.service.js:159-181`) |
| Ver un módulo | `canViewModule(access, key)` (`permissions.ts:71`) filtra la sidebar | `canViewModule(req, key)` solo lo chequean algunos routers (caja chica sí; analítica **no**) |
| Editar un módulo | `access.edit` | `canEditModule(req, key)`; además `requireModuleEditor` por prefijo de ruta: `/quick-links` → `quickaccess`, `/tools` → `tools`, `/lifecycle` → `devices` (`siteContext.service.js:214-233`) |
| Solo consulta | `roleReadOnly = !access.admin && access.edit.size === 0`; `effectiveConsultation = roleReadOnly || consultationMode` (`App.tsx:482-483`) | `requireEditor` bloquea toda escritura de quien no tiene ningún permiso de edición (`siteContext.service.js:202-208`), montado en `server/index.js:134` |

**Ojo:** `SettingsPage` decide si mostrar los paneles de administración con una lista de **nombres** de rol (`['Superadmin','Jefe TIC','Admin','Administrador']`, `SettingsPage.tsx:31`), no con `access.admin`. Un rol custom con `admin: true` en `roles.config` (ej. "Coordinación") es admin para el back pero **no ve** Módulos/Roles/Invitaciones/Usuarios en el front. Hoy es así; decidir explícitamente si se corrige.

Vistas y su gating (`src/components/layout/Sidebar.tsx:40-62`, `App.tsx:550-565`, `utils/modules.ts`):

| Vista (`ViewKey`) | URL | Módulo apagable | Quién la ve |
|---|---|---|---|
| `analytics` | `/sede/{SEDE}/analytics` | sí (`analytics`) | quien tenga `view` del módulo |
| `pettycash` | `/sede/{SEDE}/pettycash` | sí (`pettycash`) | `view` del módulo (el back también lo exige) |
| `tools` | `/sede/{SEDE}/tools` | sí (`tools`) | `view` del módulo |
| `quickaccess` | `/sede/{SEDE}/quickaccess` | sí (`quickaccess`) | `view` del módulo. El popover de la topbar se ve **siempre** (ver abajo) |
| `tenants` | `/sede/{SEDE}/tenants` | no (`ALWAYS_ON_VIEWS`) | solo superadmin (`superadminOnly`, `App.tsx:563`) |
| `adminusers` | `/sede/{SEDE}/adminusers` | no | solo superadmin (`App.tsx:564`) |
| `settings` | `/sede/{SEDE}/settings` | no (siempre) | todos; los paneles de admin solo para nombres de rol manager |

Si la vista actual deja de estar habilitada o permitida, `App.tsx:223` manda al dashboard.

Orden en la sidebar: `dashboard` y `tenants` fijos arriba, `settings` fijo abajo (`BOTTOM_NAV`), el resto según `modules.order` de la sede (`Sidebar.tsx:213-229`). `adminusers` no está en `modules.order`, así que cae al final de la lista (índice 999) antes de Configuración.

**Remontaje por sede:** `AnalyticsPage` y `PettyCashPage` llevan `key={activeSite}` (se recargan al cambiar de sede). `SettingsPage`, `ToolsPage`, `QuickAccessPage`, `TenantsDashboard`, `UsersByTenantPage` **no**: ver "Riesgos" en cada pantalla.

---

## 1. Analítica (`src/components/analytics/AnalyticsPage.tsx`)

**Para qué sirve:** métricas de préstamos, tickets, tareas y agenda en un período, más una foto del parque (condición y vida útil).
**Quién la ve:** módulo `analytics` prendido y `view` del rol. No hay acciones de escritura, así que `consultationMode` no cambia nada. El back (`GET /api/analytics`) **no** chequea `canViewModule`: cualquier usuario con acceso a la sede puede pedir los datos.
**Datos:**
- `GET /api/analytics?from=YYYY-MM-DD&to=YYYY-MM-DD` vía `apiGet` (caché 15 s + revalidación) (`services/analyticsApi.ts`). Se llama al montar y cada vez que cambia el preset (`AnalyticsPage.tsx:36-49`).
- `GET /api/analytics/parque` vía `apiGet`, una sola vez al montar `ParqueSection` (`ParqueSection.tsx:14-24`). **No** se recarga con el botón "Recargar".
- Sin polling. Recibe `devices` como prop solo para el fallback de "Equipos más utilizados" (`typeRows`, `AnalyticsPage.tsx:55-62`); `onRefresh` se recibe y no se usa.
- Respuesta de `/api/analytics` incluye `events` (todos los `loan_events` del período, sin paginar) además de `summary`.

### Encabezado y período

| Control | Dónde | Qué hace exactamente | Condiciones |
|---|---|---|---|
| Texto "N préstamos en el período" | barra superior `.analytics-reload-bar` (`:103-106`) | Muestra `summary.totalPrestamos`. Mientras carga, `SkeletonLine` de 190×13 | — |
| Botón "Recargar" / "Actualizando..." | barra superior (`:107`) | Vuelve a pedir `/api/analytics` con el rango actual. **No** recarga el parque | `disabled` mientras `loading` |
| Pills de período (5) | card "Período" (`:110-124`) | `Último año` (365 d, **default**), `Últimos 3 meses` (92 d), `Último mes` (30 d), `Última semana` (7 d), `Todo` (3650 d). Cambian `preset` y disparan recarga. Clase `analytics-summary-pill is-active` en la elegida | El preset no se persiste: al volver a la vista arranca en "Último año" |

`from` se calcula como `hoy - días` con `toISOString().slice(0,10)` (UTC). `to` = hoy en UTC (`:20-34`). El server incluye todo el día `to` (`analytics.routes.js:17-20`). Si `from/to` son inválidos, el server usa último año.

### KPIs (10 tarjetas `.kpi-bento`, `:64-75`)

| KPI | Fuente | ¿Respeta el período? |
|---|---|---|
| Préstamos en el período (hint: N devoluciones) | `totalPrestamos`, `totalDevoluciones` | sí |
| Personas distintas | `personasUnicas` (persona en minúsculas) | sí |
| Equipos distintos | `equiposUnicos` (etiqueta en mayúsculas) | sí |
| Tickets abiertos | `ticketsAbiertos` | **no** (foto actual) |
| Tareas abiertas | `tareasAbiertas` | **no** |
| Tiempo resp. tickets (d) | `ticketResponseDays`: promedio `updated_at - created_at` de tickets `Hecho` | **no** (todo el histórico) |
| Tickets creados (hint: N resueltos) | `ticketMetrics.created/resolved` | sí |
| Resolución tickets (h) | `ticketMetrics.averageResolutionHours` | sí |
| Primera respuesta (h) | `ticketMetrics.averageResponseHours` | sí |
| Promedio prestado (hint: "horas por equipo") | `formatTopAverage(avgLoanHoursByDevice)`: muestra el **primer valor > 0 de una lista ordenada desc**, o sea el máximo, no un promedio general (`:150-153`) | **no** (calculado sobre todos los eventos) |

### Gráficos (21 `ChartCard`, `:77-99`)

| Título | Datos | Tipo default | Tamaño | ¿Período? |
|---|---|---|---|---|
| Evolución de préstamos | `series.rows` (por día si el rango ≤ 92 días, por mes si es mayor; `analytics.routes.js:37-53`) | line | wide | sí |
| Equipos más utilizados | `byDevice` (alias o etiqueta); si viene vacío, conteo por tipo calculado en el front con `classifyDeviceType` | bar | md | sí |
| Tendencia anual | `annualTrend`: últimos 12 meses, siempre | line | md | **no** |
| Personas que más prestaron | `byPerson.slice(0,15)` | bar | md | sí |
| Ubicaciones | `byLocation` | bar | md | sí |
| Motivos de préstamo | `byReason` | donut | md | sí |
| Top cursos usuarios | `byCourse` | bar | md | sí |
| Préstamos por hora | `byHour` (07:00 a 18:00 precargadas, filtra ceros) | vertical | md | sí |
| Días con más demanda | `byWeekday` | bar | sm | sí |
| Demanda por hora y día | `byHourWeekday` ("Lun 09:00") | vertical | lg | sí |
| Actividad TIC | `byOperator` (préstamos y devoluciones) | bar | sm | sí |
| Equipos con más fallas | `byTicketDevice`: regex `D\s*0*\d{1,5}` sobre título/descr./nota de tickets activos, normalizado a `D0000` | bar | sm | **no** |
| Agenda TIC ocupación | `agendaOccupation`: agenda por `dia`, sin Cancelado/Realizado | vertical | sm | **no** |
| Tickets abiertos vs cerrados | `ticketMetrics.openClosed` | donut | sm | sí |
| Tickets por categoría | `byCategory` | bar | md | sí |
| Tickets por prioridad | `byPriority` | donut | sm | sí |
| Tickets por técnico | `byTechnician` (de `responsables_json`, "Sin asignar") | bar | md | sí |
| Tickets por escuela | `bySchool` | bar | sm | sí |
| Tickets por aula | `byClassroom` | bar | md | sí |
| Incidentes recurrentes | `recurring`: misma categoría/título > 1 vez, top 12 | bar | md | sí |
| Tendencia mensual de tickets | `ticketMetrics.monthly` | line | wide | sí |

(`byRole` y `byTaskType` vienen en la respuesta y **no se grafican**.)

Grilla `.analytics-bento`: 4 columnas; `sm` = 1, `md`/`lg` = 2, `wide` = 4 (`src/styles/components.css:1040-1061`). Los KPIs ocupan 1 columna cada uno (`span-1`).

### `ChartCard` (`src/components/analytics/ChartCard.tsx`)

| Control | Dónde | Qué hace exactamente | Condiciones |
|---|---|---|---|
| Selector "Top" (`SelectField`, aria-label "Cuántos mostrar") | cabecera de cada card (`:144`) | Limita filas a 10 (**default**), 15, 25 o 50. Se aplica después de sacar las filas con valor 0 (`compactRows`, `:28-30`) | Estado local por card; no se persiste |
| Selector "Tipo" (`SelectField`, aria-label "Tipo de gráfico") | cabecera (`:148`) | Cambia la visualización: Horizontal, Vertical, Pie chart, Donut chart, 3D animado, Linea (`:122-129`) | Estado local; arranca en el tipo default de la tabla de arriba |

Detalles de cada render:
- **Horizontal** (`:32-45`): fila label · barra (ancho % del máximo) · valor.
- **Vertical** (`:47-60`): altura mínima 8 %, label en `<em title={label}>` (tooltip nativo con el texto completo). Var CSS `--chart-count`.
- **Pie / Donut** (`:62-84`): SVG 120×120, arcos calculados a mano, leyenda "label · N%". Donut = círculo `r=28` con clase `donut-hole`. Último segmento topeado en 359.99° para que el arco cierre.
- **Línea** (`:86-105`): SVG 320×150, puntos `r=4`, todos los labels debajo (con muchos días se amontonan).
- **3D animado** (`:107-120`): barras con `--bar-height` (mín 14 %), `--bar-color`, `--delay` escalonado 55 ms por barra; keyframe `bar3dIn` anima `height` (`src/styles/layout.css:1347-1370`). Label con `title`.
- Paleta fija de 8 colores (`:6`), cada fila puede traer `color` propio.
- Sin datos → `.empty-state` "Sin datos".
- `prefers-reduced-motion`: desactiva animaciones de `.vbar span`, `.chart-pie-svg`, `.chart-line-svg path`, `.bar-3d span` (`layout.css:1430-1445`).

### Parque y vida útil (`src/components/analytics/ParqueSection.tsx`)

Foto del presente, sin filtro de período (lo dice el subtítulo "Estado actual, sin filtro de período", `:59`).

| Control / bloque | Dónde | Qué hace exactamente | Condiciones |
|---|---|---|---|
| Aviso de cobertura | arriba (`:62-66`) | "Solo el N% del inventario tiene condición cargada. Corré la revisión desde Inventario..." | Solo si `cobertura < 60` y ya cargó |
| 6 KPIs `.inv-kpis` | (`:68-75`) | Equipos regular/malo, Recursos regular/malo, Vida útil vencida (`is-bad`), A renovar 12 meses, Bajo stock (cantidad ≤ `min_stock`, default 3), Revisado (%). Clase `is-warn`/`is-bad` cuando el valor > 0 | Mientras carga muestran "·" y la fila lleva `is-loading` (no salta el layout) |
| Barra "Condición del parque" | `ConditionBar` (`:125-146`) | Barra apilada por condición (Excelente verde, Bueno azul, Regular amarillo, Malo rojo, Sin revisar borde) sobre equipos + recursos. Cada segmento tiene `title="Condición: N"` (tooltip nativo). Leyenda con conteos y total "N activos" | No se dibuja si total = 0. Transición de `width` con spring (`motion.css:905-913`, excepción documentada a la regla de no animar width) |
| ChartCard "Renovaciones por año" | (`:83`) | `renovacionPorAnio` | vertical, wide |
| ChartCard "Vida útil consumida" | (`:84`) | tramos 0-50 %, 50-80 %, 80-100 %, Vencido | bar, md |
| ChartCard "Clases con más deterioro" | (`:85`) | Regular + Malo por clase de activo, desc | bar, md |
| Botón "Exportar CSV" | card "A renovar" (`:94`) | Descarga `a-renovar-YYYY-MM-DD.csv` con `downloadCsv` (BOM UTF-8): Etiqueta, Alias, Clase, Condición (o "Sin revisar"), Alta, Renovación, Meses restantes, Fecha estimada (sí/no) (`:38-46`) | `disabled` si no hay ítems |
| Tabla "A renovar" | (`:99-117`) | Equipo (alias + etiqueta chica), Clase, Condición, Renovación (+ "· estimada"), Restan ("Vencida" o "N meses"). Máx. 100 filas (lo corta el server, `analytics.routes.js:285`) | Vacía → "Ningún equipo vence en los próximos 12 meses." |

**Es el único "Exportar CSV" de Analítica.** No hay exportación de los gráficos ni de los KPIs.

**Micro-interacciones y atajos:**
- Skeleton estructural en el parque mientras carga (no "Cargando...", para que la página no salte; comentario `:50-51`).
- Tooltips nativos `title` en labels de barras verticales/3D y en segmentos de la barra de condición.
- Entrada escalonada de las barras 3D (55 ms por barra).
- Estado de Top/Tipo por card: sobrevive al cambio de período (la card tiene `key={title}`), se pierde al salir de la vista.
- Sin atajos de teclado propios.

**Estados:**
- Loading: `SkeletonLine` en la barra superior; botón "Actualizando..."; KPIs muestran los valores anteriores (o 0) mientras recarga.
- Error de analítica: `.tool-error` con el mensaje (`:126`). Error del parque: reemplaza toda la sección por `.tool-error` (`ParqueSection.tsx:48`).
- Vacío: `.tool-info` "No hay préstamos registrados en este período. Probá ampliar el rango." (`:143-145`).

**Controles nativos o fuera de sistema a reemplazar:**
- `title=` como tooltip: `ChartCard.tsx:55`, `:115`; `ParqueSection.tsx:136`.
- `<table>` sin componente propio en "A renovar" (`ParqueSection.tsx:100`).
- Los selectores ya son `SelectField` (custom, no nativo).

**Mobile:**
- ≤ 1100 px: bento a 2 columnas; `sm` ocupa 1, el resto 2. ≤ 680 px: 1 columna (`components.css:1054-1061`).
- ≤ 980 px: cabecera de ChartCard en grid, selectores a ancho completo, `.chart-stage` min 230 px; filtros de período en 1 columna; pie/donut con leyenda debajo (`layout.css:1400-1410`, `components.css:1145`).

**Riesgos para el rediseño:**
- Las clases `.vbar`, `.bar-3d`, `.chart-pie-svg`, `.chart-line-svg`, `.parque-bar` las usan las animaciones y el guard de reduced-motion en `layout.css` y `motion.css`.
- Las CSS vars `--bar-height`, `--bar-color`, `--delay`, `--chart-count` las setea el JSX inline.
- `kpis` mezcla métricas del período con fotos actuales e históricas sin indicarlo en la UI; si el rediseño agrupa KPIs, no prometer "del período" donde no lo es.
- "Promedio prestado" muestra el máximo, no un promedio.
- El botón Recargar no recarga el parque.

---

## 2. Configuración (`src/components/settings/SettingsPage.tsx`)

**Para qué sirve:** preferencias del usuario y administración de la sede activa.
**Quién la ve:** todos (vista siempre activa). Los paneles marcados "admin" solo si el **nombre** del rol en la sede es `Superadmin`, `Jefe TIC`, `Admin` o `Administrador` (`:31`, `:76-86`). Si no es admin, al final se muestra `.tool-info` "Tu usuario tiene acceso a: NFPT, NFND" (`:87`).
**Datos:** cada panel hace su propio fetch al montar (detalle abajo). `SettingsPage` no tiene `key={activeSite}`.

Orden de las cards hoy:
1. Configuración (siempre)
2. Apariencia (siempre)
3. Turnos TIC (siempre)
4. Notificaciones (siempre)
5. Módulos de la sede (admin)
6. Roles y permisos (admin)
7. Invitaciones (admin)
8. Configuración de sede (opciones de préstamo) (admin)
9. Vida útil esperada (admin)
10. Usuarios permitidos (admin)
11. Avanzado (admin, `<details>` plegado)

### 2.1 Card "Configuración" (`SettingsPage.tsx:40-57`)

| Control | Dónde | Qué hace exactamente | Condiciones |
|---|---|---|---|
| Input "Usuario actual" | (`:43-45`) | Muestra `operator` (nombre de sesión). `readOnly` | — |
| Select "Modo consulta / vista jefe" (`SelectField` Desactivado/Activado) | (`:46-51`) | Prende/apaga `consultationMode` del App (vista previa solo lectura). **No se persiste**: al recargar vuelve a Desactivado (`App.tsx:69`) | `disabled` si `roleReadOnly`; hint cambia: "Tu rol (X) es de solo lectura: el modo consulta está siempre activo." vs "Activalo para previsualizar la app en modo solo lectura." |
| Línea "Base local: OK / Con advertencia / Error / Sincronizando · mensaje" | (`:53-56`) | Estado de `sync` del App. Siempre con clase `sync-status ok` aunque sea error | Solo lectura |

### 2.2 Apariencia (`src/components/settings/AppearancePanel.tsx`)

**Datos:** `localStorage['techasset_theme_profile']` + `PATCH /api/user/prefs { themeProfile }` (fire-and-forget, `utils/themeProfile.ts:47-54`). Al iniciar sesión, `App.tsx:134-139` lee `GET /api/user/prefs` y aplica el tema guardado. Dispara `techasset:theme-profile`.

| Control | Dónde | Qué hace exactamente | Condiciones |
|---|---|---|---|
| Card de tema "Clásico" (Azul oscuro original) | (`:37-44`) | Aplica perfil `classic` (o su variante de nav), con mini preview | `selected` si no es smart |
| Card de tema "Tema claro" (Panel flotante, cálido) | (`:45-52`) | Aplica perfil `smart` | `selected` si es smart |
| Chips "Estilo de navegación" (4) | (`:56-68`) | Normal (Sidebar tradicional), Escalera (Items escalonados), Centrada (Sidebar tipo dock), Centrada + peek (Sidebar que asoma). Combina tema + estilo (`profileForThemeAndStyle`) | Si se elige un estilo distinto de Normal: borra `localStorage['techasset_sidebar_collapsed']` y dispara `techasset:sidebar-expand` para expandir la sidebar (`:21-30`) |

Funciona en `consultationMode` (es preferencia personal). Nota fija: "La sidebar cambia el acomodo de sus items en desktop; en mobile aparece la barra inferior."

### 2.3 Turnos TIC (`SettingsPage.tsx:59-74`)

**Datos:** `GET /api/settings/shifts` al montar (errores tragados con `.catch(() => {})`, `:34`). `PATCH /api/settings/shifts { morningOperator, afternoonOperator }`. Se guardan en `site_settings` (`shift.morningOperator`, `shift.afternoonOperator`). Los usa `useTasks` para "mis tareas del turno" (`hooks/useTasks.ts:109-112`).

| Control | Dónde | Qué hace exactamente | Condiciones |
|---|---|---|---|
| Input "Mañana" | (`:62`) | Texto libre: nombre del operador de la mañana (tiene que coincidir con el nombre de sesión para que `isOwnShift` funcione) | — |
| Input "Tarde" | (`:63`) | Ídem tarde | — |
| Botón "Guardar turnos" | (`:65-73`) | Guarda; toast ok "Turnos guardados." o toast error | `disabled` en `consultationMode`. En el back solo pasa por `requireEditor` (cualquier rol con algún permiso de edición; no exige admin ni módulo) |

### 2.4 Notificaciones (`src/components/settings/NotificationsPanel.tsx`)

**Datos:** `GET /api/notifications/prefs` → `{ email, types, pushSubscribed, pushAvailable }`. `POST /api/notifications/prefs { email }` o `{ types }`. Push: `enableBrowserPush()` (`services/notificationsApi.ts:55-75`): pide permiso del navegador, `GET` VAPID key, `pushManager.subscribe`, `POST` suscripción.

| Control | Dónde | Qué hace exactamente | Condiciones |
|---|---|---|---|
| Botón "Activar" (push) / badge "Activadas" | fila "Notificaciones push" (`:94-103`) | Pide permiso del navegador y suscribe este dispositivo. Mensaje ok "Notificaciones push activadas." o error textual (navegador sin soporte, permiso negado, server sin VAPID) | `disabled` si `busy` o `!pushAvailable`; aviso "El servidor no tiene push configurado." |
| Switch "Avisos por mail" (`role="switch"`, `aria-checked`) | fila (`:105-113`) | **Optimistic**: cambia al toque, guarda, si falla revierte y muestra "No se pudo guardar." Ok: "Te vamos a avisar por mail." / "Avisos por mail desactivados." | — |
| 6 tarjetas de tipo (`aria-pressed`) | `.notif-type-grid` (`:115-131`) | Sugerencias e ideas, Tareas TIC, Tickets, Novedades de TechAsset, Altas e invitaciones, Sistema. Toggle optimistic con rollback. Estado "Activo"/"Pausado" | `reminders` existe en `DEFAULT_TYPES` pero no tiene tarjeta |

Mensajes (`msg`/`err`) se autolimpian a los 3,5 s (`:44-48`). Nota fija para iPhone: instalar la app desde Compartir antes de activar push. No respeta `consultationMode` (es preferencia personal).

### 2.5 Módulos de la sede (admin) (`src/components/settings/ModulesPanel.tsx`)

**Datos:** `GET /api/site-settings` → `modules.enabled`, `modules.order`. Guardar: `PATCH /api/site-settings { settings: { 'modules.enabled': [...], 'modules.order': [...] } }` (back exige `isSiteManager`, `sites.routes.js:53-68`). Al guardar llama `onChanged` → `reloadSiteSettings` del App (la sidebar se reordena al instante).

| Control | Dónde | Qué hace exactamente | Condiciones |
|---|---|---|---|
| Número de posición | cada card (`:85`) | Posición 1..N en el menú | — |
| Botón flecha arriba (`aria-label="Subir X"`, `title="Subir"`) | (`:93-95`) | Intercambia con el anterior | `disabled` en `consultationMode` o si es el primero |
| Botón flecha abajo (`title="Bajar"`) | (`:96-98`) | Intercambia con el siguiente | `disabled` en `consultationMode` o si es el último |
| Switch prender/apagar (`role="switch"`, `aria-label="Prender/Apagar X"`) | (`:100-110`) | Agrega/saca el módulo del set local | `disabled` en `consultationMode` |
| Botón "Guardar modulos" / "Guardando..." | (`:117-121`) | Guarda enabled + order | `disabled` si `saving` o `consultationMode` |

Cada card muestra ícono emoji, label, descripción y categoría (de `TOGGLEABLE_MODULES`, `utils/modules.ts:15-31`). 16 módulos: devices, loans, inventory, analytics, agenda, schedules, tasks, pettycash, suggestions, classrooms, tickets, tools, knowledge, reminders, canvas, quickaccess.

**Estados:** toast **propio** `.settings-toast` (fijo abajo a la derecha, 2,6 s) con "Modulos guardados" / "No se pudo guardar." (`:30-34`, `:122`), distinto del `toast()` global. Error de carga → toast global.

**No hay drag & drop**: el orden se cambia solo con flechas.

**Riesgo detectado:** `server/db.js:981` corre `migrateRetiredModules` en **cada arranque** y saca `reminders` de `modules.enabled`/`modules.order` de todas las sedes (`db.js:1378-1389`). Si un admin prende "Recordatorios" acá, se apaga solo en el próximo reinicio del server. (CLAUDE.md dice que `reminders` es un módulo que se prende en Configuración.)

### 2.6 Roles y permisos (admin) (`src/components/settings/RolesPanel.tsx`)

**Datos:** `GET /api/site-settings` → `roles.config` (array `{ name, admin, view: [...|'*'], edit: [...|'*'] }`). Si no hay config, arranca con un único rol "Administrador" admin. Guardar: `PATCH /api/site-settings { settings: { 'roles.config': [...] } }`. Al guardar llama `onChanged` (recarga settings del App).

| Control | Dónde | Qué hace exactamente | Condiciones |
|---|---|---|---|
| Botón "+ Rol" | cabecera (`:79`) | Agrega "Nuevo rol" (no admin, ve todo, no edita nada) | `disabled` en `consultationMode` |
| Input "Nombre del rol" | cada rol (`:86-88`) | Renombra. Los roles con nombre vacío se descartan al guardar (`toConfig`, `:22-29`) | `disabled` en `consultationMode` |
| Checkbox "Administrador del tenant" | (`:89-92`) | `admin: true` da acceso total; oculta la grilla de permisos | `disabled` en `consultationMode` |
| Grilla Módulo / Ver / Editar (checkbox nativos ×16 ×2) | (`:94-104`) | Toggle por módulo. **Marcar Editar marca Ver** también (`:55`, muta el set en el lugar). Desmarcar Ver no desmarca Editar | Solo si el rol no es admin |
| Botón "Eliminar rol" | (`:106-108`) | Saca el rol del draft (sin confirmación) | Solo si hay más de 1 rol y no está en consulta |
| Botón "Guardar roles" / "Guardando…" | (`:113`) | Guarda. Si todos los módulos están marcados se guarda `['*']` | `disabled` si `saving` o consulta |
| Indicador "Guardado ✓" | (`:114`) | Aparece tras guardar, se va al editar algo | — |

**Estados:** error de guardado **no se muestra** (solo `finally`, `:64-72`; queda una promesa rechazada sin manejar).

**Riesgos:** las keys de las cards son el índice (`key={idx}`). Renombrar un rol que ya tienen usuarios asignados los deja con un rol que no está en config → caen al fallback por nombre (back y front). `roles.config` alimenta también los selects de rol de Invitaciones y Usuarios permitidos.

### 2.7 Invitaciones (admin) (`src/components/settings/InvitesPanel.tsx`)

**Datos:**
- `GET /api/invites` (lista de la sede; back exige `isSiteManager`).
- `GET /api/site-settings` → `roles.config` (nombres de rol; default al primero que no sea "Administrador") y `shift.options` (turnos).
- `POST /api/invites { role, turno, email?, expiresInDays }` → `{ invite: { registerUrl, ... }, emailSent }`.
- `POST /api/invites/:id/resend`, `POST /api/invites/:id/revoke`.
- Back: límite 20 invitaciones (crear + reenviar) por hora por usuario, en memoria → 429 con mensaje (`invites.routes.js:17-30`). El link es `{APP_BASE_URL}/register?code=CODIGO`. Si hay mail, se manda y se registra `email_sent_at` / `email_error`.

| Control | Dónde | Qué hace exactamente | Condiciones |
|---|---|---|---|
| `MailStatusChip` | cabecera (`:87`) | Faro del proveedor de mail (ver sección 8) | — |
| Select "Rol" (`SelectField`) | (`:90-92`) | Roles de `roles.config` (fallback Administrador/Asistente/Consulta) | `disabled` en consulta |
| Select "Turno" (`SelectField`) | (`:93-95`) | `shift.options` (fallback Sin turno/Mañana/Tarde/Todo el día) | `disabled` en consulta |
| Input "Mail (opcional, para enviar la invitación)" `type="email"` | (`:98-100`) | Si se completa, se manda el mail | `disabled` en consulta |
| Input "Vence en (días)" `type="number" min=1 max=90` | (`:101-103`) | Default 14; `0` o vacío vuelve a 14 (`Number(...) || 14`). No se clampa al máximo en el front | `disabled` en consulta |
| Botón "Generar invitación" / "Generando…" | (`:106`) | Crea, limpia el mail, recarga la lista y muestra el link | `disabled` si `busy` o consulta |
| Bloque resultado: `Link: <code>` + botón "Copiar link" | (`:109-116`) | `copyToClipboard` con toast "Copiado al portapapeles." (o error con instrucción de copiar a mano). Muestra "· mail enviado ✓" o "· compartí el link" | Hasta la próxima generación |
| Tabla: Código, Rol, Turno, Estado, Mail, Envío | (`:119-141`) | Envío: "Enviado dd/mm/aaaa" / error en rojo (`.is-error`) / "Sin registro" / "—" | — |
| Botón "Reenviar" (fila) | (`:132`) | Reenvía la **misma** invitación (no genera código nuevo). Si no salió, muestra `emailError` | Solo invitaciones `Activa` con mail, no en consulta; `disabled` si `busy` |
| Botón "Revocar" (fila) | (`:133`) | Revoca **sin confirmación**; toast "Invitación revocada." | Solo `Activa`, no en consulta |

**Estados:** vacío → "Todavía no generaste invitaciones." Error de generar/reenviar → `.tool-error`. Error de carga → toast.

### 2.8 Configuración de sede / opciones de préstamo (admin) (`src/components/settings/LoanSettingsPanel.tsx`)

**Datos:** `GET /api/site-settings` → `loan.roles`, `loan.locations`, `loan.motives`, `loan.gradeOptions`, `devices.categories`. Guardar: `PATCH /api/site-settings` con las 5 claves. Defaults en `:7-36` (iguales a los del seed del server). Estas listas alimentan `LoanForm` y la categorización de dispositivos.

| Control | Dónde | Qué hace exactamente | Condiciones |
|---|---|---|---|
| Botón "Guardar opciones" | cabecera (`:77`) | Guarda las 5 listas; muestra `.tool-info` "Configuración de préstamos guardada." | **No** recibe `consultationMode`: se puede guardar en modo consulta. Errores no se capturan (`:62-71`) |
| Editor "Roles de préstamo" (input + "Agregar" + pills con "Desactivar") | (`:80`) | Agrega string (sin duplicados case-insensitive, `:134-139`); "Desactivar" lo **saca** de la lista | — |
| Editor "Cursos / grados" | (`:81`) | Ídem. Al leer, mezcla los defaults 1N..6S con lo configurado y descarta "EP"/"ES" (`mergeStringList`, `:157-167`): **no se pueden quitar los defaults de forma persistente** (vuelven al recargar) | — |
| Editor "Categorias de dispositivos" | (`:82`) | Ídem | — |
| Editor "Ubicaciones" (fila: input label + checkbox "Detalle" + checkbox "Curso" + "Desactivar") | (`:83`, `OptionEditor :111-132`) | `requiresDetail` pide detalle libre en el préstamo; `requiresCourse` pide curso | — |
| Editor "Motivos" (sin checkbox Curso) | (`:84`) | Ídem con `showCourse=false` | — |

Agregar no responde a Enter (no hay `<form>`): solo el botón.

**Riesgo / bug existente:** en `OptionEditor` la fila usa `key={item.label}` (`:122`) y el input edita ese mismo `label` (`:123`): **cada tecla remonta la fila y el input pierde el foco**. Al migrar, usar una key estable (índice o id) y verificar que no se "arregle" otra cosa sin querer.

### 2.9 Vida útil esperada (admin) (`src/components/settings/LifecyclePanel.tsx`)

**Datos:** `GET /api/lifecycle/defaults` → `[{ assetClass, meses, origen: 'equipo'|'sede'|'global' }]`. Guardar fila: `PATCH /api/lifecycle/defaults { assetClass, meses }` (`meses: 0` = volver al global). Back: pasa por `requireModuleEditor` con prefijo `lifecycle` → exige editar `devices` (no admin). Invalida la caché de inventario.

| Control | Dónde | Qué hace exactamente | Condiciones |
|---|---|---|---|
| Input `type="number" min=0` por clase (`aria-label="Vida útil de X en meses"`) | columna Meses (`:59-68`) | Override por sede. Placeholder = valor efectivo actual. Vacío = usar el global | `disabled` en consulta |
| Columna Origen | (`:70`) | "N (esta sede)" o "N (por defecto)" | — |
| Botón "Guardar" / "Guardando..." por fila | (`:72-74`) | Guarda esa clase, mensaje "X actualizado." y recarga | `disabled` en consulta o mientras guarda esa fila |

Texto de ayuda: "Dejalo vacío para usar el valor por defecto del sistema. Un equipo puntual puede tener su propio valor desde su perfil." Cadena de prioridad: equipo → sede → global.

### 2.10 Usuarios permitidos (admin) (`src/components/settings/AllowedUsersPanel.tsx`)

**Datos:**
- `GET /api/allowed-users`: superadmin ve **todos** los usuarios de todas las sedes; Jefe TIC solo los de su sede activa y nunca a un Superadmin (`sites.routes.js:122-141`). Ordenado con Pendientes primero.
- `GET /api/sites` (sedes para los checkboxes).
- `GET /api/site-settings` → `roles.config` para el select de rol.
- Guardar: `POST /api/allowed-users` (nuevo) o `PATCH /api/allowed-users/:id`. Solo el superadmin puede asignar sedes múltiples; un Jefe TIC siempre guarda contra la sede activa (`sites.routes.js:195-199`, `231-235`).
- Acciones: `POST /api/allowed-users/:id/approve|reject|deactivate|delete`. Cada una manda mail al usuario (aprobado / rechazado / desactivado) best-effort. `delete` = soft delete (`deleted_at`, `deleted_by`) + desactiva `users` y `user_sites`.
- Toda escritura limpia la caché de sesiones del server (`server/index.js:93-96`), así el cambio rige al instante.

| Control | Dónde | Qué hace exactamente | Condiciones |
|---|---|---|---|
| Botón "Nuevo usuario" | cabecera (`:94`) | Resetea el formulario a vacío (rol Consulta, Activo, primera sede) | Sin chequeo de consulta |
| Tabla: Mail (con `title` = mail completo, nombre abajo), Rol, Sedes, Estado, Acciones | (`:96-119`) | — | — |
| Botón "Editar" (fila) | (`:108`) | Carga el usuario en el formulario de abajo (no hay scroll automático al form) | — |
| Botón "Aprobar" | (`:109`) | approve | Solo si `Pendiente` |
| Botón "Rechazar" | (`:110`) | reject | Solo si `Pendiente` |
| Botón "Desactivar" | (`:111`) | deactivate | Solo si `Activo` |
| Botón "Borrar" | (`:112`) | `confirmDialog` danger "¿Borrar X? Pierde el acceso; su historial queda." → delete | Siempre |
| Input "Mail" | form (`:123`) | Se pasa a minúsculas al tipear | — |
| Input "Nombre" | form (`:124`) | — | — |
| Select "Rol" (`SelectField`) | form (`:127`) | Roles de `roles.config`; "Superadmin" solo si quien edita es superadmin. Fallback hardcodeado (`:9-10`) | — |
| Select "Turno" (`SelectField`) | form (`:128`) | Sin turno, Mañana, Tarde, Todo el día | — |
| Select "Estado" (`SelectField`) | form (`:130-132`) | Pendiente, Activo, Rechazado, Inactivo (`activo = estado === 'Activo'`) | — |
| Checkboxes de sedes (`.site-check-grid`) | form (`:133-140`) | Agrega/quita sedes al draft; recalcula la sede default si se saca la actual | Para un Jefe TIC se ignoran en el back |
| Select "Sede default" | form (`:141-143`) | Entre las sedes marcadas | — |
| Botón "Guardar usuario" | form (`:144`) | Valida que el mail tenga "@" ("Mail inválido."), guarda con el mismo rol y turno para todas las sedes, mensaje "Usuario guardado.", resetea el form | Sin chequeo de consulta |

**Estados:** mensajes inline `.tool-info`/`.tool-error` (`:145`). Error de carga → toast. Errores de guardar y de las acciones **no se capturan** (promesa rechazada sin mensaje).

**No respeta `consultationMode`** (no recibe la prop). Un Jefe TIC en "modo consulta" puede aprobar/borrar igual.

### 2.11 Avanzado (admin) (`src/components/settings/AdvancedSettings.tsx`)

Envuelto en `<details className="card">` con `<summary>Avanzado</summary>` (plegado por defecto, `:44-45`).

| Control | Dónde | Qué hace exactamente | Condiciones |
|---|---|---|---|
| Botón "Diagnóstico local" | (`:49`) | `GET /api/devices/diagnostics` → grilla: Fuente, Sede, Equipos, Última importación, Último error | `disabled` mientras carga |
| Botón "Configuración de sede" | (`:50`) | Carga **todo** `site_settings` de la sede en un textarea JSON | — |
| Botón "Backup SQLite" | (`:51`) | **No hace nada** (no tiene `onClick`) | — |
| Textarea "Configuración de sede (JSON)" (12 filas) | (`:56-58`) | Edición cruda de cualquier clave | Solo tras cargar |
| Botón "Guardar configuración" | (`:59`) | `JSON.parse` y `PATCH /api/site-settings` con el objeto completo; muestra "Configuración de sede guardada." o el error de parseo/servidor | Back exige `isSiteManager` |

Texto fijo (desactualizado): "TechAsset usa SQLite como fuente principal..." (en prod es Postgres).

**Riesgo:** el editor JSON escribe cualquier clave sin validar (puede romper `roles.config`, `modules.*`, etc.). No respeta `consultationMode`.

**Controles nativos o fuera de sistema a reemplazar (todo Configuración):**
- `<details>/<summary>`: `AdvancedSettings.tsx:44-45`.
- Checkbox nativos: `RolesPanel.tsx:90`, `:100`, `:101`; `AllowedUsersPanel.tsx:136`; `LoanSettingsPanel.tsx:124`, `:125`.
- `<input type="number">`: `InvitesPanel.tsx:102`; `LifecyclePanel.tsx:62`.
- `<input type="email">`: `InvitesPanel.tsx:99`.
- `<textarea>` JSON crudo: `AdvancedSettings.tsx:57`.
- `title=` como tooltip: `ModulesPanel.tsx:93`, `:96`; `AllowedUsersPanel.tsx:102`.
- Toast propio `.settings-toast` en `ModulesPanel.tsx:122` (no usa el `toast()` global).
- Botones crudos `<button>` sin el componente `Button`: pills "Desactivar" (`LoanSettingsPanel.tsx:103`, `:126`), cards de tema y chips (`AppearancePanel`), tarjetas de notificación.
- No hay `<select>` nativos (todos son `SelectField`).

**Mobile (Configuración):** `.module-cards-ordered` es 1 columna siempre; `.role-perm-row` grilla `1fr 60px 60px` (`components.css:1120`); `.notif-type-grid` con regla propia en `responsive.css:924`. Tablas en `.table-wrap` con scroll interno. `.settings-toast` cambia de posición con la bottom-nav de los perfiles variantes (`nav-smart.css:498-500`, `layout.css:30`).

**Riesgos para el rediseño (Configuración):**
- `SettingsPage` no se remonta al cambiar de sede: los paneles quedan con los datos de la sede anterior y **guardar escribe esos datos en la sede nueva** (el header `X-Site-Code` sí cambia). Ej.: Módulos cargados de NFPT → cambio a NFND → Guardar → NFND queda con los módulos de NFPT. Recomendado: `key={activeSite}` en la migración.
- Gate de admin por nombre de rol (ver mapa de permisos).
- `roles.config`, `shift.options`, `modules.*`, `loan.*` se comparten entre varios paneles y con el resto de la app; el rediseño no debe cambiar los nombres de clave.
- `onModulesChanged` → `reloadSiteSettings` y `onSitesChanged` → `refreshSessionSites` son los únicos avisos al App: si se separa Configuración en sub-rutas, mantenerlos.

---

## 3. Tenants (`src/components/settings/TenantsDashboard.tsx`)

**Para qué sirve:** alta y edición de sedes (tenants), branding (logo, color), CSV de importación, y códigos de invitación de administrador por sede.
**Quién la ve:** solo superadmin (`App.tsx:563`, sidebar `superadminOnly`). No recibe `consultationMode`: nada se bloquea en consulta.
**Datos:**
- `GET /api/sites` (superadmin ve todas, incluidas inactivas).
- Crear: `POST /api/sites` (solo superadmin). Editar: `PATCH /api/sites/:siteCode` (superadmin o manager de esa sede). Body: `siteCode, nombre, subtitulo, themeColor, spreadsheetUrl, inventorySheetName, logo, logoDataUrl, activo`.
- Al crear, el server siembra los settings default de la sede (`seedDefaultSettings`) y le da acceso al creador (`sites.routes.js:85-92`).
- Logo: `logoDataUrl` (data URL PNG/JPEG/WEBP ≤ 2 MB) se guarda en `data/uploads/site-logos/<sede>-<hash>.<ext>` y se sirve **público** (`server/index.js:72`; va en mails y antes del login). También acepta URL `https://` o `/uploads/site-logos/...` (`sites.routes.js:292-322`).
- Código admin: `POST /api/invites { siteCode, role: 'Administrador', kind: 'admin', email?, expiresInDays: 30 }` (`:104`).
- Tras guardar: `onChanged` → `refreshSessionSites` del App (actualiza selector de sede, logos de sidebar/topbar).

| Control | Dónde | Qué hace exactamente | Condiciones |
|---|---|---|---|
| Botón "Crear tenant" | hero (`:138`) | Abre modal vacío (color default `#3b82f6`, activo) | — |
| 4 `StatCard` | (`:141-146`) | Tenants totales, Activos, Inactivos, Sede actual | — |
| Buscador `type="search"` "Buscar tenant por código o nombre" | toolbar (`:149`) | Filtra por código + nombre + subtítulo (contiene, minúsculas) | — |
| Tarjeta de tenant | grilla (`:156-198`) | Logo (`TenantLogo`, fallback `/favicon.png` si la imagen falla), nombre, "CÓDIGO · subtítulo", badge Activo/Inactivo, meta CSV (Configurado/Sin configurar), Logo (Personalizado/TA), Color (hex). Borde/acento con CSS var `--tenant-accent` = `themeColor` | — |
| Botón "Entrar" / "Sede actual" | tarjeta (`:174-176`) | Cambia la sede activa (`setActiveSite`) | `disabled` en la sede actual |
| Botón "Editar" | tarjeta (`:177`) | Abre modal con los datos | — |
| Input `type="email"` "mail admin opcional" | tarjeta (`:180-186`) | Mail para mandar el código admin | Estado por tenant |
| Botón "Código admin" / "Generando..." | tarjeta (`:187-189`) | Genera invitación de admin (30 días). Muestra `<code>` con el link + "Copiar" + "Mail enviado" | `disabled` mientras genera ese tenant |
| Botón "Copiar" | resultado (`:194`) | `copyToClipboard` + toast | — |

Modal "Crear tenant" / "Editar NFXX" (`Modal` global: foco atrapado, Escape y backdrop cierran **sin confirmar** y se pierde el draft):

| Control | Qué hace | Condiciones |
|---|---|---|
| Preview del logo (`TenantLogo`) | Muestra el logo actual o el recién elegido | — |
| "Subir logo" (label con `<input type="file" accept="image/png,image/jpeg,image/webp">` invisible, `:212-215`) | Valida tipo y ≤ 2 MB en el front ("El logo tiene que ser PNG, JPG o WEBP." / "El logo no puede superar 2 MB."), lo lee con `FileReader` como data URL y lo previsualiza | — |
| Botón "Usar TA" (`:216`) | Borra el logo (vuelve a la marca TA) | — |
| Input "Código" (`autoFocus` al crear, `:222`) | Se pasa a mayúsculas al tipear. El server además normaliza a `[A-Z0-9_]` | `disabled` al editar |
| Input "Color" `type="color"` (`:225`) | Color de acento del tenant | — |
| Inputs Nombre, Subtítulo, "URL CSV para importación manual", "Inventory sheet name" | Texto libre | — |
| Checkbox "Tenant activo" (`:241`) | Activa/inactiva | — |
| Botón "Guardar tenant" / "Guardando..." | Valida código ("Falta el código del tenant."), guarda, cierra, recarga lista y sesión | `disabled` mientras guarda |
| Botón "Cancelar" | Cierra | — |

**Estados:** `SkeletonPanel` de 3 filas de 110 px al cargar; vacío "No hay tenants para ese filtro."; el `error` es uno solo para la página y el modal (se ve en los dos lugares).

**Controles nativos a reemplazar:** `<input type="color">` (`:225`), `<input type="file">` (`:214`), checkbox (`:241`), `type="search"` (`:149`), `type="email"` (`:181`).

**Mobile:** `.tenant-grid` a 1 columna (`components.css:4347`).

**Riesgos:**
- `POST /api/sites` hace **upsert** (`ON CONFLICT(site_code) DO UPDATE`, `sites.routes.js:78-84`): "Crear tenant" con un código existente **pisa** nombre/logo/color de esa sede sin avisar. Además en el upsert no se actualiza `activo`.
- El logo se manda como data URL dentro del JSON (límite `express.json` = `max(2, MAX_UPLOAD_MB)` MB, `server/index.js:63`).
- `.tenant-upload-btn input` está oculto con `opacity:0; pointer-events:none` y depende de que el `<label>` lo envuelva (`components.css:4191-4192`).
- No hay `key={activeSite}` (es global, no importa), pero "Entrar" cambia la sede sin cambiar de vista.

---

## 4. Usuarios por tenant (`src/components/settings/UsersByTenantPage.tsx`)

**Para qué sirve:** ver de un vistazo quién tiene acceso a cada tenant (superadmins, admins, usuarios), pendientes, invitaciones e usuarios sin sede.
**Quién la ve:** solo superadmin (back `adminUsers.routes.js:139-141`). Las acciones se bloquean con `consultationMode`.
**Datos:** `GET /api/admin/users-by-tenant` (3 queries fijas, armado en memoria; solo tenants activos; 30 invitaciones más recientes por tenant). Acciones: `POST /api/allowed-users/:id/:action` (mismo endpoint que 2.10, con mails al usuario).

| Control | Dónde | Qué hace exactamente | Condiciones |
|---|---|---|---|
| `MailStatusChip` | header (`:102`) | Faro del mail | — |
| KPIs: Usuarios, Tenants, Pendientes (`is-warn` si > 0), Sin sede (`is-warn` si > 0) | (`:105-112`) | Totales globales | — |
| Segmentado Todos / Admins / Pendientes | toolbar (`:118-122`) | Filtra la tabla del tenant abierto. "Admins" = superadmin o rol que contenga "admin"/"jefe" (regex, `:34-36`) | — |
| Buscador `type="search"` "Buscar por mail, nombre o rol" | toolbar (`:123`) | Filtra la tabla del tenant abierto por mail/nombre/rol **y** calcula coincidencias globales | — |
| Línea "N coincidencia(s) en total: NFPT, NFND" | (`:126-131`) | Indica en qué tenants aparece lo buscado (solo mail/nombre) | Si hay texto y coincidencias |
| Lista de tenants (botones) | nav izquierda (`:134-153`) | Abre ese tenant. Muestra nombre, código, "N usuarios", "N admins", "N pendientes" (`is-warn`), "N invitaciones" activas | El primero queda abierto al cargar; se conserva al refrescar |
| Tabla del tenant: Usuario (nombre o parte local del mail + mail), Rol (+ tag "superadmin"), Turno, Estado (pill de color), Último login (dd/mm/aa), Acciones | (`:166-198`) | Contador "N de M usuarios" | — |
| Botón "Aprobar" | fila (`:187`) | approve | Si estado ≠ Activo (también sirve para reactivar Inactivo/Rechazado) |
| Botón "Rechazar" | fila (`:188`) | reject | Solo Pendiente |
| Botón "Desactivar" | fila (`:189`) | deactivate | Solo Activo |
| Botón "Baja" (`.is-danger`) | fila (`:190`) | `confirmDialog` danger "Dar de baja ... Se oculta sin borrar el historial." → delete | Siempre |
| Tabla "Invitaciones" del tenant: Mail ("solo link"), Rol, Estado (Activa/Usada/Vencida/Revocada), Envío, Vence | (`:200-222`) | Solo lectura; muestra **12** de las 30 que manda el server | Si hay invitaciones |
| Tabla "Sin sede asignada" + botón "Baja" | (`:226-252`) | Usuarios sin ninguna sede; solo se pueden dar de baja | Si hay huérfanos |
| Botón "Actualizar" | pie (`:257`) | Recarga todo | — |

Todos los botones de acción: `disabled` en `consultationMode` o mientras se procesa ese usuario (`busy === user.id`). Mensaje de éxito "mail: aprobado/rechazado/desactivado/dado de baja." en `.tool-info`; error en `.tool-error`. Skeleton de 4 filas de 54 px.

**No hay** edición de rol/sedes acá (se hace desde Configuración → Usuarios permitidos). No hay acciones sobre invitaciones (reenviar/revocar).

**Controles nativos:** botones crudos `<button>` en `.users-actions` y en el segmentado; `type="search"`.

**Mobile:** `.users-layout` (lista + detalle) pasa a 1 columna ≤ 1000 px (`components.css:2843`).

**Riesgos:** la acción usa el header de la sede activa, pero como es superadmin `canManageAllowedUser` siempre da true. La regex de "admin" depende de nombres de rol.

---

## 5. Herramientas auxiliares (`src/components/tools/ToolsPage.tsx`)

**Para qué sirve:** utilidades del equipo TIC: tarjetas de acceso imprimibles, envío masivo de credenciales Microsoft 365 y la configuración SMTP global.
**Quién la ve:** módulo `tools` prendido y `view`. `ToolsPage` **no recibe `consultationMode`** (`App.tsx:557`): ningún botón se deshabilita en consulta; el back rechaza con 403 las escrituras `/api/tools/*` de quien no edita `tools` (`requireModuleEditor`) y la UI muestra el `error` que devuelva.
**Datos comunes:** las llamadas usan `fetch` directo con `siteHeaders` (no `apiSend`) porque las rutas devuelven `{ ok:false, error }` que la UI muestra tal cual (`services/toolsApi.ts:20-27`). `GET /api/tools/config` → `{ modoPrueba, smtpConfigurado, resendConfigurado, mailConfigurado, handingTicketUrl }` (sin secretos).

Las tres cards se apilan en `.tools-page` (grid, gap 16).

### 5.1 Creador de tarjetas Glifing / Santillana (`src/components/tools/GlifingTool.tsx`)

**Flujo:** elegir tipo → (opcional) bajar plantilla → subir CSV → validación + preview → generar → se abre una pestaña con HTML A4 imprimible.

| Control | Dónde | Qué hace exactamente | Condiciones |
|---|---|---|---|
| Segmentado "Glifing" / "Santillana" | `.tool-type-selector` (`:58-59`) | Cambia `kind`. Cambia los textos (formato, plantilla, botón generar) | Default Glifing. No se persiste |
| Bloque "Formato CSV requerido": `Username,Nombre,Apellido,Grupo,Contraseña` | (`:62-65`) | Informativo (iguales columnas para los dos tipos) | — |
| Botón "Descargar plantilla CSV (glifing/santillana)" | (`:68`) | `window.open('/api/tools/{glifing|santillana}/template')` → descarga `plantilla-glifing.csv` / `plantilla-santillana.csv` con BOM y una fila de ejemplo | — |
| "Subir CSV" / "Cambiar archivo (nombre.csv)" (label + `<input type="file" accept=".csv,text/csv" hidden>`) | (`:69-72`) | Lee el archivo como texto en el navegador y lo manda a `POST /api/tools/glifing/upload { csv }`: valida columnas obligatorias ("Faltan columnas obligatorias: ..."), devuelve total y preview de 10 filas. Mensaje "N fila(s) detectadas correctamente." | — |
| Botón "Generar tarjetas Glifing/Santillana" | (`:73`) | `POST /api/tools/glifing/generate { csv, tipo }` → `{ downloadUrl }` y abre `window.open(downloadUrl, '_blank')`. Mensaje "Tarjetas (tipo) generadas para N usuario(s). Descarga iniciada." | `disabled` sin CSV o `busy` |
| Tabla preview (5 columnas) | (`:79-91`) | Primeras 10 filas; "Mostrando 10 de N filas." | Si hay preview |

**HTML generado** (`server/routes/tools.routes.js:179-322`):
- `<title>` y `<h1>` "Tarjetas de acceso · Glifing/Santillana", botón "Imprimir" que llama `window.print()`.
- `@page { size: A4; margin: 10mm; }`, grilla de 2 columnas con filas de 65 mm (≈ 8 tarjetas por hoja), `page-break-inside: avoid`, borde punteado para recortar.
- `print-color-adjust: exact` en `html, body` para que el fondo salga impreso. En `@media print` se ocultan título y botón.
- Fondo: plantilla embebida como data URL (`public/templates/glifing-template.png`, `template_santillana.jpeg`) cargada una vez al arrancar el server. Glifing: `object-fit: cover`, texto abajo a la derecha sobre blanco 70 %, acento `#f08000`. Santillana: `object-fit: contain`, recuadro blanco 82 % con `backdrop-filter`, acento `#e7176d`.
- Cada tarjeta: nombre + apellido, "Usuario: X", "Contraseña: X", "Grupo: X" (si hay). Todo escapado (`escapeHtml`).
- El archivo vive en `config.toolsTempDir`; **se borra 1 s después de servirlo** y los jobs vencen a los 30 min (`:81-90`, `:349-359`). Recargar la pestaña da 404 JSON "Resultado no disponible".

### 5.2 Envío de credenciales 365 (`src/components/tools/Credentials365Tool.tsx`)

**Flujo:** subir CSV → vista previa (valida mails) → enviar (prueba o real) → descargar reporte CSV.

| Control | Dónde | Qué hace exactamente | Condiciones |
|---|---|---|---|
| Aviso `.tool-warning` + badge proveedor | (`:106-109`) | "Atención: revisá los destinatarios..." + estado: modo prueba activo / envío real (por Resend) / proveedor sin configurar. Badge: "Resend configurado" / "Mail configurado" / "Mail sin configurar" | Según `/api/tools/config` |
| Formato requerido: `Nombre para mostrar,Nombre de usuario,mail,Contraseña,Sede,Licencias` | (`:111-114`) | Informativo | — |
| Botón "Descargar plantilla CSV" | (`:117`) | Abre `/api/tools/credentials365/template` → `plantilla-credenciales365.csv` | — |
| "Subir CSV" / "Cambiar archivo (x)" (file input oculto, `accept=".csv,text/csv"`) | (`:118-121`) | `POST /api/tools/credentials365/upload`: valida columnas, preview 10 filas. "N fila(s) detectadas. Genera la vista previa para validar emails." | — |
| Botón "Generar vista previa" | (`:122`) | `POST .../preview`: cuenta válidos/inválidos (mail con formato, usuario y contraseña no vacíos), preview 10 + 10 inválidas con motivo. **Pisa `modoPrueba` del estado con lo que devuelve el server** | `disabled` sin CSV o `busy` |
| Botón "Enviar (modo prueba)" / "Enviar correos" | (`:123-125`) | En modo real: `confirmDialog` danger "Enviar credenciales reales — Vas a mandar credenciales reales por mail a N destinatario(s). M se descartan por inválidos." con botón "Enviar a N". `POST .../send { csv, confirm }` | `disabled` sin CSV, `busy`, o (modo real y sin proveedor). Back: solo `isSiteManager` (403 "Solo un administrador de la sede puede enviar credenciales.") |
| Link "Descargar reporte" (`<a target="_blank">`) | (`:126`) | `GET /api/tools/credentials365/report/:jobId` → `reporte-credenciales365.csv` (BOM) con `mail_destino, usuario, nombre, estado (OK/PRUEBA/ERROR), detalle`. **Se puede bajar una sola vez** (se borra 1 s después) y vence a los 30 min | Tras enviar |
| Contadores `.tool-counters` | (`:132-143`) | Total, Validos (`ok`), Invalidos (`bad`); tras enviar: Enviados OK, Prueba, Errores | Si `total > 0` |
| Tabla preview | (`:145-156`) | 6 columnas; **Contraseña enmascarada `****`** | — |
| Tabla "Filas invalidas" | (`:158-175`) | Nombre, Usuario, Mail, Motivo | — |

Mail que se manda (`tools.routes.js:426-443`): HTML con usuario, contraseña, sede, licencias y botón "Ingresar a la plataforma" (`microsoftLoginUrl`). Envío real por `sendMail` (Resend o SMTP, el que esté).

### 5.3 Configuración SMTP / Credenciales 365 (`src/components/tools/MailSettings.tsx`)

**Datos:** `GET /api/settings/mail` (cualquier usuario autenticado lo puede leer: server, puerto, usuario, from, asunto; la contraseña viene enmascarada `••••••••xy`). `PATCH /api/settings/mail` **solo superadmin** (configuración global de todas las sedes, `tools.routes.js:628-631`). Persiste en `app_settings` (`mail.*`) y pisa el `.env`.

| Control | Dónde | Qué hace exactamente | Condiciones |
|---|---|---|---|
| `<details>` "¿Cómo completar esta configuración?" | (`:59-74`) | Lista de 11 pasos (Office 365, puerto 587, contraseña de aplicación, SMTP AUTH, usar modo prueba primero...) | Plegado |
| Input "SMTP server" (placeholder smtp.gmail.com) | (`:77`) | — | — |
| Input "SMTP port" `type="number"` | (`:78`) | Default 465. `secure` se activa solo con 465 | — |
| Input "SMTP user" | (`:81`) | — | — |
| Input "SMTP app password" `type="password"` | (`:82-89`) | Placeholder "Guardada (••••xy). Dejá vacío para conservar." o "Sin configurar". Vacío = no se cambia | — |
| Input "Mail from" | (`:93`) | — | — |
| Input "Mail subject" | (`:94`) | Asunto del mail de credenciales | — |
| Input "Microsoft login URL" | (`:97`) | Botón del mail de credenciales | — |
| Select "Modo de envío" (`SelectField`) | (`:98-100`) | "Modo prueba (no envía)" / "Modo real (envía)" | — |
| Botón "Guardar configuración" | (`:103-105`) | Guarda; "Configuración guardada." | `disabled` si `busy`. Para no-superadmin el server devuelve 403 y la UI muestra el genérico "No se pudo guardar la configuración" (no el motivo) |

Error de carga tragado (`.catch(() => {})`, `:26`).

**Controles nativos a reemplazar (Herramientas):** `<input type="file" hidden>` (`GlifingTool.tsx:71`, `Credentials365Tool.tsx:120`); `<input type="number">` (`MailSettings.tsx:78`); `<input type="password">` (`MailSettings.tsx:83`); `<details>` (`MailSettings.tsx:59`); `window.open` para descargas (`services/toolsApi.ts:29-31`, `GlifingTool.tsx:40`); `<table>` crudas.

**Mobile:** cards apiladas; las tablas scrollean en `.table-wrap`. Los botones de acción en `.wrap-actions` hacen wrap.

**Riesgos (Herramientas):**
- `window.open(downloadUrl)` del generador corre **después de un `await`**: los bloqueadores de pop-ups (Safari/iOS sobre todo) pueden frenarlo y la tarjeta no aparece; el usuario ve "Descarga iniciada" igual.
- Resultados de un solo uso: recargar la pestaña de tarjetas o volver a tocar "Descargar reporte" da 404.
- `preview` de 365 devuelve `modoPrueba: config.smtp.modoPrueba` (**valor del `.env`**, `tools.routes.js:414`), mientras que `send` usa el valor guardado en la base (`:533-534`). Si difieren, la UI puede saltear la confirmación y el server responde 400 "Confirmación requerida", o pedir confirmación de envío real cuando en realidad será de prueba.
- Si se toca "Enviar" sin haber hecho la vista previa, la confirmación dice "0 destinatario(s)".
- `ToolsPage` no se remonta al cambiar de sede (no carga datos por sede salvo el envío, que usa el header activo).
- Los botones no se esconden para roles sin permiso; dependen del 403.

---

## 6. Accesos rápidos

### 6.1 Página (`src/components/tools/QuickAccess.tsx`, montada por `QuickAccessPage.tsx`)

**Para qué sirve:** links institucionales y personalizados de la sede, agrupados por categoría, más descargas de scripts `.bat`.
**Quién la ve:** módulo `quickaccess` prendido y `view`. Editar/borrar/crear se ocultan en `consultationMode`. Back: escrituras en `/api/quick-links` exigen editar `quickaccess` (`requireModuleEditor`); un rol con `view` pero sin `edit` del módulo **ve los botones** (si tiene algún otro permiso de edición) y recibe 403.
**Datos:**
- `GET /api/quick-links` (`apiGet`, caché 15 s): activos de la sede, ordenados por categoría y título (`operations.routes.js:74-77`).
- `POST /api/quick-links`, `PATCH /api/quick-links/:id`, `DELETE /api/quick-links/:id` (soft delete: `activo=0`). El server valida `^https?://` (rechaza `javascript:`, `data:`, etc.).
- `GET /api/tools/config` → `handingTicketUrl`.
- `HEAD` a cada archivo de descarga para saber si existe (`:84-90`).
- Seed: las sedes existentes recibieron una vez 6 links "Institucionales" (Listas EP, Listas ES, Hosking, Tiknology/InvGate, Drive TIC, Drive recursos) con `creado_por='Sistema'` (`server/db.js:1346-1376`). Tenants nuevos arrancan vacíos.

| Control | Dónde | Qué hace exactamente | Condiciones |
|---|---|---|---|
| Botón "Nuevo acceso" | cabecera (`:99`) | Abre modal "Nuevo acceso rápido" con categoría precargada "Institucionales" | Oculto en consulta |
| Grupo por categoría (`<h4>`) | (`:102-125`) | Orden alfabético `localeCompare('es')`; sin categoría → "Sin categoría" (`groupLinks`, `:30-38`) | — |
| Tarjeta: título + descripción | (`:107-111`) | — | — |
| Botón "Abrir" (`<a target="_blank" rel="noreferrer">`) | (`:113`) | Abre el link en pestaña nueva | Siempre |
| Botón "Editar" | (`:114`) | Abre modal "Editar acceso" con los datos | Oculto en consulta |
| Botón "Borrar" | (`:115-119`) | `confirmDialog` danger "Borrar acceso — ¿Borrar "X"?" → DELETE → recarga | Oculto en consulta. Sin toast de éxito ni deshacer; errores no capturados |
| Nota Handing | (`:126-128`) | "Handing configurado en `<url>`. Agregalo como acceso si querés tenerlo acá." | Si `HANDING_TICKET_URL`/`TECHASSET_PUBLIC_URL` está seteada |
| Card "Descargas": "Activación Windows / Office (.bat)" y "Reinicio historial WIFI + limpieza DNS (.bat)" | (`:131-150`) | Lista fija en el código (`DOWNLOAD_LINKS`, `:13-16`), archivos en `public/downloads/`. Botón "Descargar" (`<a download="archivo.bat">`) | Mientras chequea: "Verificando…" deshabilitado; si el HEAD falla: "Archivo no cargado" deshabilitado con `title="Archivo no cargado"` |

Modal (`QuickLinkForm`, `:40-77`, dentro de `Modal` global):

| Control | Qué hace | Condiciones |
|---|---|---|
| Input "Nombre" (`required`) | `titulo` | Validación nativa del navegador |
| Input "URL" (`required`, placeholder `https://...`) | Validación front `^https?://` → "Solo se permiten URLs http:// o https://." | — |
| Textarea "Descripción" (2 filas) | — | — |
| Input "Categoría" (texto libre, placeholder "Institucionales, Personalizados...") | Define el grupo | — |
| Botón "Guardar" / "Guardando..." (`type="submit"`) | Crea o actualiza, cierra y recarga. **Enter en cualquier input envía** (es un `<form>`) | `disabled` mientras guarda |
| Botón "Cancelar" | Cierra | — |

El campo `icono` existe en la tabla y en la API pero **no tiene UI**. No hay reordenamiento manual ni buscador.

### 6.2 Popover de la topbar (`src/components/tools/QuickAccessPopover.tsx`)

Montado en las dos variantes de topbar (`Topbar.tsx:153` tema claro, `:179` clásico), **siempre**, aunque el módulo esté apagado o el rol no lo vea.

| Control | Dónde | Qué hace exactamente | Condiciones |
|---|---|---|---|
| Botón ícono rayo (`Zap`, `aria-label`/`title` "Accesos rápidos", `aria-expanded`) | topbar (`:36-45`) | Abre/cierra el popover | Oculto ≤ 900 px por CSS (`components.css:3065`) |
| Popover (`role="dialog"`, clase `t-dropdown`, `data-origin="top-right"`) | (`:47-65`) | Lista agrupada igual que la página (título + descripción chica) | Animación de salida 120 ms con `useMountTransition` (debe coincidir con `--dropdown-close-dur`) |
| Botón "Administrar" | cabecera del popover (`:50`) | Cierra y navega a la vista `quickaccess` | Si el módulo está apagado, el App redirige al dashboard |
| Cada link (`<a target="_blank">`) | (`:56-60`) | Abre en pestaña nueva y cierra el popover | — |

**Micro-interacciones:**
- Cierra con click afuera (`mousedown` en document, `:19-21`) y con Escape (`:23`).
- No mueve el foco adentro ni lo atrapa (a diferencia de los `Modal`).
- Cada instancia de `useQuickLinks` hace su propio fetch: el popover pide `/api/quick-links` y `/api/tools/config` al cargar la app, aunque nunca se abra.

**Estados (Accesos rápidos):** vacío "Todavía no hay accesos cargados." (página y popover). Error de carga → toast "No se pudo cargar los accesos rápidos.". Error al guardar → `.tool-error` dentro del modal.

**Controles nativos a reemplazar:** `title=` en el botón de descarga deshabilitado (`QuickAccess.tsx:145`) y en el trigger del popover; `<a download>`; validación nativa `required`.

**Mobile:** grilla de tarjetas a 1 columna (`components.css:2073`); el popover no existe en mobile, se usa la vista de la sidebar.

**Riesgos:**
- `QuickAccessPage` y el popover **no se recargan al cambiar de sede** (sin `key={activeSite}`; el popover vive en la topbar): quedan los links de la sede anterior hasta navegar o recargar. Editar/borrar en ese estado manda el id viejo con el header de la sede nueva → 404 "Acceso no encontrado".
- `.quick-pop-wrap` lo esconde CSS, no JS: si el rediseño cambia breakpoints, revisar.
- Las descargas dependen de que `public/downloads/*.bat` exista en `dist/` (el HEAD lo verifica).

---

## 7. Caja chica (`src/components/pettycash/PettyCashPage.tsx`)

**Para qué sirve:** fondo fijo de la sede: saldo, gastos directos, solicitudes de compra con aprobación, y alta opcional en Inventario TIC.
**Quién la ve:** módulo `pettycash` y `view` (el back también exige `canViewModule`, `pettyCash.routes.js:21`). Permisos que devuelve el server en cada GET:
- `permissions.manager` = `isSiteManager` (Jefe TIC / admin): editar fondo, registrar gastos, aprobar/rechazar.
- `permissions.canRequest` = `canEditModule('pettycash')`: crear solicitudes y subir comprobantes.
- `consultationMode` deshabilita todo.
**Datos:**
- `GET /api/petty-cash` (`apiGet`) → `{ config: { initialAmount }, balance, spent, expenses, requests, permissions }`. Gastos ordenados por fecha desc; solicitudes con Pendientes primero.
- `PATCH /api/petty-cash/config { initialAmount }` (manager; ≥ 0).
- `POST /api/petty-cash/expenses` (manager; valida descripción, importe > 0, fecha `YYYY-MM-DD`, y que no supere el saldo). Notifica a los admins de la sede.
- `POST /api/petty-cash/requests` (canRequest; descripción obligatoria). Notifica a los admins.
- `PATCH /api/petty-cash/requests/:id { status: 'Aprobada'|'Rechazada', ... }` (manager; solo pendientes). Aprobar: en **una transacción** crea el gasto, opcionalmente un ítem de `inventory_items` (estado "Nuevo", observación "Compra aprobada #id · proveedor · $costo") y marca la solicitud. Notifica al solicitante (aprobada/rechazada).
- `POST /api/petty-cash/upload-receipt { mimeType, base64 }` (canRequest): PNG/JPEG/WEBP/PDF ≤ `MAX_UPLOAD_MB`, guarda en `data/uploads/petty-cash/<SEDE>/` y devuelve URL protegida por sesión + sede (`server/index.js:70-81`).
- Las escrituras pasan por `apiSend` (vacía la caché) y después `refresh()`.

### Encabezado y barra de comandos

| Control | Dónde | Qué hace exactamente | Condiciones |
|---|---|---|---|
| Card resumen | (`:127-141`) | Ícono, "Fondo fijo", "Caja chica", "Gastos y solicitudes de compra de la sede." Saldo disponible grande; "Fondo $X · Gastado $Y". Moneda `Intl` es-AR ARS (`:316-318`) | — |
| Input "Fondo inicial" `type="number" min=0 step=0.01` | `.petty-fund-editor` (`:148-150`) | Edita el fondo | Solo manager; `disabled` en consulta |
| Botón "Guardar fondo" | (`:151-159`) | Guarda; mensaje "Fondo actualizado." o error | Solo manager; `disabled` en consulta |
| `GooeyMenu` "+" (`ariaLabel="Nuevo movimiento"`) con satélites "Registrar gasto" y "Solicitar compra" | `.petty-actions` (`:166`) | Abre el modal correspondiente. Cierra con click afuera y Escape | Solo si hay **2** acciones permitidas y no está en consulta |
| Botón "+ Registrar gasto" | (`:167`) | Abre modal de gasto | Si hay < 2 acciones y es manager; `disabled` en consulta |
| Botón "+ Solicitar compra" (primario) | (`:168`) | Abre modal de solicitud | Si hay < 2 acciones y canRequest; `disabled` en consulta |

### Historial de gastos (`:173-190`)

| Elemento | Qué muestra / hace | Condiciones |
|---|---|---|
| Contador en la cabecera | Cantidad de gastos | — |
| Fila `.petty-row` | Fecha dd/mm/aaaa, descripción, "proveedor · categoría" ("Sin proveedor"), importe | — |
| Link "Comprobante" (`target="_blank"`) | Abre el archivo subido | Si tiene; si no, "Sin comprobante" |
| Badge "Inventario #id" | El gasto generó un ítem de inventario | Si `inventoryItemId` |
| Vacío | Ícono + "Todavía no hay gastos" + "Cuando registres uno aparecerá en este historial." | — |

No hay editar/borrar gastos, filtros, búsqueda, totales por categoría ni exportar.

### Solicitudes de compra (`:192-221`)

| Elemento / control | Qué hace | Condiciones |
|---|---|---|
| Contador "N pendientes" | — | — |
| Tarjeta `.request-card status-{pendiente|aprobada|rechazada}` | Descripción, "solicitante · fecha", estado, justificación ("Sin justificación adicional."), "Estimado $X", proveedor sugerido ("Proveedor a definir"); resuelta: "proveedor final · costo" o la nota | Aprobada: borde verde; Rechazada: opacidad .68 |
| Botón "Resolver →" (primario) | Abre modal "Aprobar solicitud #id" precargado con estimado y proveedor sugerido | Solo pendientes y manager; `disabled` en consulta |
| Botón "Rechazar" | Rechaza **sin confirmación**, con nota fija "Rechazada desde caja chica". Sin mensaje de éxito | Ídem |
| Vacío | "No hay solicitudes" + "Las solicitudes del equipo se mostrarán acá." | — |

El comprobante adjunto a una **solicitud** se guarda (`receipt_url`) pero **no se muestra** en la tarjeta (al aprobar se hereda al gasto).

### Modales (todos con `Modal` global; Escape/backdrop cierran sin confirmar)

**"Registrar gasto"** (`:224-249`):

| Control | Qué hace | Validación |
|---|---|---|
| Banner de error | `modalError` | — |
| "Saldo disponible" | Contexto | — |
| Input "Fecha" de **texto** `inputMode="numeric"` placeholder "DD/MM/AAAA" (precargado hoy) | Fecha del gasto | `isoDate` exige DD/MM/AAAA y fecha real (`:325-333`): "Ingresá una fecha válida con formato DD/MM/AAAA." |
| Input "Descripción" (`required`) | — | — |
| Input "Proveedor", Input "Categoría" (texto libre, default "General") | — | — |
| Input "Importe" `type="number" min=0.01 step=0.01` (`required`) | — | Si supera el saldo: "No alcanza el saldo. Hay $X disponibles y el gasto es de $Y." |
| `ReceiptField` "Comprobante (opcional)": input readOnly con la URL + botón "Adjuntar" (`<input type="file" accept="image/*,.pdf">` encima, opacidad 0) | Sube **al elegir** el archivo (base64 en JSON) y muestra la URL | Error → "No se pudo adjuntar el comprobante." (o el del server) |
| "Registrar gasto" / "Registrando…" (submit) · "Cancelar" | Guarda, cierra, "Gasto registrado." | `disabled` si `busy` |

**"Solicitar compra"** (`:251-273`): "Qué necesitás comprar" (`required`), Categoría, "Importe estimado" (`number min=0 step=0.01`), "Proveedor sugerido", "Justificación" (textarea 3 filas), Comprobante. Enviar → "Solicitud enviada al responsable de caja chica."

**"Aprobar solicitud #id"** (`:275-294`): texto "Al aprobar se crea el gasto y se notifica a X.", saldo, "Costo final" (`number min=0.01`, required), "Proveedor" (required), "Nota de resolución" (textarea 2), **switch** "Registrar también en Inventario TIC" (`<button role="switch" aria-checked>` con `.toggle-pill`), "Cantidad" (`number min=1`, solo si el switch está prendido; unidad "unidades", estado "Nuevo"). Si el costo supera el saldo: "No alcanza el saldo para aprobarla. Disponible: $X." Botón "Aprobar y descontar" / "Aprobando…" → "Compra aprobada y descontada del saldo."

**Micro-interacciones:**
- Gooey menu con anticipación/animación (`GooeyMenu`), cierre con click afuera y Escape. Si queda una sola acción, no se dibuja el gooey (un satélite solo no se lee como líquido) y aparecen botones sueltos (`:163-168`).
- Comprobante se sube en cuanto se elige el archivo (no al guardar): si se cancela el modal, el archivo queda huérfano en el server.
- Enter en cualquier input del modal envía el form.
- Fechas formateadas con helpers locales (`displayDate`, `formatDate`, `:320-338`), no con `utils/formatters`.

**Estados:**
- Loading: `SkeletonView` mientras `!data`.
- **Error de carga: queda el skeleton para siempre.** El mensaje se guarda en `message` pero nunca se ve porque `if (!data) return <Skeleton>` corta antes (`:30-39`).
- Éxito: `.tool-info` con `message` (no toast); no se autolimpia.
- Sin deshacer. Sin confirmación para rechazar.

**Controles nativos a reemplazar:** `<input type="file">` (`:310`); `<input type="number">` (`:149`, `:237`, `:258`, `:282`, `:290`); fecha como texto con máscara manual (`:230`), candidato a date picker propio respetando DD/MM/AAAA; textareas.

**Mobile:** `.petty-layout` (2 columnas: gastos 1.2fr / solicitudes .8fr) pasa a 1 columna (`responsive.css:737`); `.petty-row` a 1 columna (`responsive.css:749-750`); `.receipt-field` a 1 columna (`:756`).

**Riesgos:**
- `accept="image/*"` deja elegir GIF/HEIC/etc. que el server rechaza ("El comprobante debe ser una imagen o PDF.").
- El input file de `ReceiptField` depende de la regla `.receipt-field input[type=file]{position:absolute;inset:0;opacity:0}` que vive en la misma línea que el CSS de Canvas (`components.css:4299`): si se borra el CSS de Canvas se rompe el adjuntar.
- El saldo se valida en el front con el dato cargado y otra vez en el back (correcto); no hay bloqueo de concurrencia.
- `requestsEnabled` existe en la config pero está forzado a `true` en front y back.

---

## 8. Componentes sueltos

### `MailStatusChip` (`src/components/settings/MailStatusChip.tsx`)

Faro del proveedor de mail. Lo usan Invitaciones (2.7) y Usuarios por tenant (4). Lee `GET /api/tools/config` una vez.

| Estado | Chip | Nota |
|---|---|---|
| Modo prueba | "Mail: Resend/SMTP" o "Mail sin configurar", tono `is-test` | "Modo prueba activo: las invitaciones no se envían por mail, compartí el link." |
| Resend configurado | "Mail: Resend", `is-ok` | — |
| Solo SMTP | "Mail: SMTP", `is-warn` | "Resend no está configurado: se usa SMTP." |
| Ninguno | "Mail sin configurar", `is-bad` | "Sin proveedor: las invitaciones solo sirven por link copiado." |

Si el fetch falla no se muestra nada.

### `SiteAdminPanel` (`src/components/settings/SiteAdminPanel.tsx`)

**Código muerto**: no lo importa ningún archivo (lo reemplazó `TenantsDashboard`). Tenía tabla de sedes, form con "Color / logo" como **input de texto** y checkbox "Sede activa". No migrar; borrar en una limpieza aparte.

---

## Endpoints usados por esta área (referencia rápida)

| Método y ruta | Permiso en el back | Usado por |
|---|---|---|
| GET `/api/analytics?from&to` | sesión + sede (sin chequeo de módulo) | Analítica |
| GET `/api/analytics/parque` | sesión + sede | Analítica |
| GET/PATCH `/api/site-settings` | GET sesión; PATCH `isSiteManager` | Módulos, Roles, Invitaciones, Usuarios, Opciones de préstamo, Avanzado |
| GET/PATCH `/api/settings/shifts` | PATCH `requireEditor` | Turnos TIC (y `useTasks`) |
| GET/POST `/api/notifications/prefs` | sesión | Notificaciones |
| GET/PATCH `/api/user/prefs` | sesión | Apariencia (tema) |
| GET/PATCH `/api/lifecycle/defaults` | PATCH editar `devices` | Vida útil |
| GET `/api/devices/diagnostics` | sesión | Avanzado |
| GET/POST `/api/invites`, POST `/api/invites/:id/resend`, `/revoke` | `isSiteManager`; superadmin puede pasar `siteCode`; 20/h | Invitaciones, Tenants |
| GET/POST `/api/allowed-users`, PATCH `/:id`, POST `/:id/:action` | `isSiteManager` (+ reglas de Superadmin) | Usuarios permitidos, Usuarios por tenant |
| GET `/api/admin/users-by-tenant` | superadmin | Usuarios por tenant |
| GET/POST `/api/sites`, PATCH `/api/sites/:code` | POST superadmin; PATCH superadmin o manager | Tenants, Usuarios permitidos |
| GET `/api/tools/config` | sesión | Tools, MailStatusChip, Accesos rápidos |
| GET `/api/tools/{glifing,santillana,credentials365}/template` | sesión | Herramientas |
| POST `/api/tools/glifing/upload`, `/generate`; GET `/download/:jobId` | POST editar `tools` | Herramientas |
| POST `/api/tools/credentials365/upload`, `/preview`, `/send`; GET `/report/:jobId` | POST editar `tools`; send además `isSiteManager` | Herramientas |
| GET/PATCH `/api/settings/mail` | GET sesión; PATCH superadmin | Herramientas |
| GET/POST/PATCH/DELETE `/api/quick-links` | escrituras: editar `quickaccess` | Accesos rápidos, popover |
| HEAD `/downloads/*.bat` | público (estático) | Accesos rápidos |
| GET `/api/petty-cash`, PATCH `/config`, POST `/expenses`, POST `/requests`, PATCH `/requests/:id`, POST `/upload-receipt` | ver sección 7 | Caja chica |
| GET `/uploads/petty-cash/<SEDE>/...`, `/uploads/site-logos/...` | sesión + sede / público | Caja chica, Tenants |

---

## Lista de verificación

### Analítica
- [ ] 5 presets de período (Último año default, 3 meses, mes, semana, Todo) recargan los datos
- [ ] Botón Recargar (deshabilitado y con "Actualizando..." mientras carga)
- [ ] Texto "N préstamos en el período" con skeleton al cargar
- [ ] 10 KPIs con sus hints
- [ ] 21 gráficos con título, datos y tipo default de la tabla
- [ ] Fallback de "Equipos más utilizados" por tipo cuando `byDevice` viene vacío
- [ ] Selector Top 10/15/25/50 por gráfico (filtra valores 0 antes)
- [ ] Selector de tipo por gráfico: Horizontal, Vertical, Pie, Donut, 3D animado, Línea
- [ ] Estado de Top/Tipo se mantiene al cambiar de período
- [ ] "Sin datos" en gráficos vacíos
- [ ] Tooltips con el label completo en barras verticales y 3D
- [ ] Animaciones de gráficos con guard de `prefers-reduced-motion`
- [ ] Error de analítica visible; aviso "No hay préstamos registrados en este período"
- [ ] Parque: 6 KPIs con `is-warn`/`is-bad` y placeholders "·" sin salto de layout
- [ ] Parque: aviso de cobertura < 60 %
- [ ] Parque: barra apilada de condición con tooltip por segmento y leyenda
- [ ] Parque: 3 gráficos (renovaciones por año, vida útil consumida, clases con deterioro)
- [ ] Parque: tabla "A renovar" (máx. 100) con "Vencida" / "N meses" / "· estimada"
- [ ] Parque: Exportar CSV `a-renovar-YYYY-MM-DD.csv` con BOM y 8 columnas; deshabilitado si vacío
- [ ] Remonta al cambiar de sede
- [ ] Bento 4 → 2 → 1 columnas sin scroll horizontal (360 px)

### Configuración
- [ ] Usuario actual (solo lectura)
- [ ] Modo consulta: toggle; deshabilitado y con texto explicativo para roles de solo lectura
- [ ] Estado de la base local
- [ ] Apariencia: tema Clásico / Claro con preview; 4 estilos de navegación; guarda en localStorage y en `/api/user/prefs`; expande la sidebar al elegir estilo variante
- [ ] Turnos TIC: mañana/tarde, guardar con toast; deshabilitado en consulta
- [ ] Notificaciones: activar push (permiso navegador), switch mail optimistic con rollback, 6 tipos con Activo/Pausado, mensajes que se van solos a los 3,5 s, nota iPhone
- [ ] Paneles de admin visibles solo para roles manager (decidir: por nombre o por `access.admin`)
- [ ] Módulos: 16 módulos con ícono, descripción y categoría; prender/apagar; subir/bajar; guardar; la sidebar se actualiza al guardar
- [ ] Roles: agregar, renombrar, admin del tenant, grilla Ver/Editar (Editar implica Ver), eliminar rol (si hay > 1), guardar, "Guardado ✓"
- [ ] Invitaciones: chip de mail, rol y turno desde la config de la sede, mail opcional, días (1-90, default 14), generar, link + copiar, "mail enviado ✓"/"compartí el link"
- [ ] Invitaciones: tabla con estado de envío, Reenviar (misma invitación) y Revocar en las activas
- [ ] Invitaciones: límite 20/h se muestra como error
- [ ] Opciones de préstamo: roles, cursos (con defaults fijos), categorías, ubicaciones (Detalle/Curso), motivos (Detalle); agregar sin duplicados; desactivar; guardar
- [ ] Vida útil: override por clase, placeholder con valor efectivo, origen, guardar por fila, vacío = global
- [ ] Usuarios permitidos: tabla con Pendientes primero; Editar, Aprobar, Rechazar, Desactivar, Borrar (con confirmación)
- [ ] Usuarios permitidos: form mail (minúsculas), nombre, rol (Superadmin solo para superadmin), turno, estado, sedes (multi para superadmin), sede default, guardar
- [ ] Avanzado plegado: diagnóstico local, editor JSON de settings con guardar
- [ ] Mensaje "Tu usuario tiene acceso a: ..." para no admins
- [ ] Cada panel recarga sus datos al cambiar de sede

### Tenants (superadmin)
- [ ] KPIs (totales, activos, inactivos, sede actual)
- [ ] Buscador por código/nombre/subtítulo
- [ ] Tarjeta con logo (fallback si falla), acento de color, badge, meta CSV/logo/color
- [ ] Entrar (cambia de sede; deshabilitado en la actual) y Editar
- [ ] Código admin por tenant con mail opcional, link copiable, "Mail enviado"
- [ ] Modal crear/editar: subir logo (PNG/JPG/WEBP ≤ 2 MB, preview), Usar TA, código (mayúsculas, bloqueado al editar, autofocus al crear), color, nombre, subtítulo, URL CSV, sheet name, activo
- [ ] Al guardar se actualizan selector de sede, sidebar y topbar
- [ ] Skeleton y vacío

### Usuarios por tenant (superadmin)
- [ ] KPIs globales con `is-warn`
- [ ] Lista de tenants con conteos (usuarios, admins, pendientes, invitaciones)
- [ ] Filtro Todos/Admins/Pendientes y buscador; coincidencias globales por tenant
- [ ] Tabla con rol, tag superadmin, turno, estado, último login
- [ ] Aprobar (también reactiva), Rechazar, Desactivar, Baja con confirmación; deshabilitados en consulta y durante la acción
- [ ] Invitaciones del tenant (12) con estado y envío
- [ ] Sección "Sin sede asignada" con Baja
- [ ] Botón Actualizar

### Herramientas
- [ ] Tarjetas: elegir Glifing/Santillana, descargar plantilla de cada tipo, subir CSV, validación de columnas, preview 10 filas + "Mostrando X de N", generar y abrir el HTML imprimible
- [ ] HTML de tarjetas: A4, 2×4, fondo impreso, botón Imprimir, se oculta título/botón al imprimir
- [ ] Credenciales 365: aviso y badge de proveedor, plantilla, subir CSV, vista previa con válidos/inválidos y motivos, contraseña enmascarada
- [ ] Credenciales 365: enviar en prueba sin confirmar; en real con `confirmDialog` danger; deshabilitado sin proveedor
- [ ] Credenciales 365: contadores, reporte CSV descargable
- [ ] SMTP: ayuda plegable, 7 campos + modo, contraseña enmascarada que se conserva vacía, guardar (solo superadmin)

### Accesos rápidos
- [ ] Grupos por categoría ordenados
- [ ] Abrir en pestaña nueva
- [ ] Nuevo / Editar en modal con validación http(s) y Enter para guardar
- [ ] Borrar con confirmación
- [ ] Botones de edición ocultos en consulta
- [ ] Nota de Handing cuando hay URL configurada
- [ ] Descargas .bat con chequeo HEAD: Verificando… / Archivo no cargado / Descargar
- [ ] Popover de topbar (desktop > 900 px): abrir/cerrar, click afuera, Escape, cerrar al abrir un link, Administrar, animación de salida
- [ ] Se recargan los links al cambiar de sede

### Caja chica
- [ ] Resumen: saldo, fondo, gastado en ARS
- [ ] Editar fondo inicial (manager)
- [ ] Gooey "+" con dos acciones; botones sueltos cuando hay una sola
- [ ] Todo deshabilitado en consulta
- [ ] Historial de gastos con comprobante, badge de inventario y vacío
- [ ] Solicitudes con estados y colores, pendientes primero, contador
- [ ] Resolver (modal) y Rechazar (manager)
- [ ] Modal gasto: fecha DD/MM/AAAA validada, descripción, proveedor, categoría, importe, control de saldo, comprobante
- [ ] Modal solicitud: descripción, categoría, estimado, proveedor, justificación, comprobante
- [ ] Modal aprobar: costo, proveedor, nota, switch inventario + cantidad, control de saldo
- [ ] Subida de comprobante (imagen/PDF) al elegir el archivo
- [ ] Mensajes de éxito
- [ ] Remonta al cambiar de sede

---

## Ideas de mejora (opcionales, no son parte de lo existente)

- Remontar `SettingsPage`, `ToolsPage`, `QuickAccessPage` y el popover con `key={activeSite}` (hoy guardan datos de una sede en otra).
- Unificar el gate de admin de Configuración con `access.admin` de `roles.config`.
- Arreglar `migrateRetiredModules` para que no apague `reminders` en cada arranque, o sacar `reminders` de `TOGGLEABLE_MODULES`.
- Key estable en `OptionEditor` (hoy pierde el foco en cada tecla).
- Capturar y mostrar errores en Roles, Usuarios permitidos, Opciones de préstamo, Accesos rápidos (borrar) y Caja chica (carga inicial).
- Pasar `consultationMode` a Usuarios permitidos, Opciones de préstamo, Avanzado, Tenants y Herramientas.
- Ocultar en el front lo que el back va a rechazar (enviar credenciales sin ser manager, SMTP sin ser superadmin, accesos rápidos sin `edit` del módulo) y mostrar el motivo real del 403 en `MailSettings`.
- `/api/user/prefs` busca `allowed_users.id = req.user.id`, pero `req.user.id` es el id de la tabla `users` (`server/routes/userPrefs.routes.js:9`, `:20`): el tema se guarda en la fila equivocada (o en ninguna). Buscar por mail.
- `preview` de credenciales 365 debería devolver el `modoPrueba` guardado, no el del `.env`.
- Abrir la pestaña de tarjetas antes del `await` (o generar un blob) para evitar el bloqueador de pop-ups; permitir re-descargar resultados por unos minutos.
- `POST /api/sites` no debería pisar una sede existente al "crear".
- Indicar en la UI qué KPIs/gráficos de Analítica no dependen del período; renombrar "Promedio prestado" o calcular un promedio real; que "Recargar" también recargue el parque; exportar CSV de cualquier gráfico.
- Caja chica: mostrar el comprobante de la solicitud, confirmar el rechazo con nota, editar/anular gastos, exportar.
- Botón "Backup SQLite" sin acción: implementarlo o sacarlo. Texto de Avanzado desactualizado (dice SQLite).
- Borrar `SiteAdminPanel.tsx` (no se usa).
- Ícono por acceso rápido (el campo `icono` ya existe) y reordenamiento manual.
- Drag & drop para ordenar módulos, además de las flechas.
