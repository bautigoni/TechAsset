# Inventario 04: Agenda TIC, Horarios, Estado de aulas y Recordatorios

Relevado sobre el código de la rama `rediseno-grafito` (16/10/2026). Fuente de verdad: el código. Las referencias son `archivo:línea`.

Módulos de sede involucrados (`src/utils/modules.ts:20-29`): `agenda` (Agenda TIC), `schedules` (Horarios), `classrooms` (Estado aulas), `reminders` (Recordatorios; arranca apagado en sedes existentes). Las cuatro vistas se montan en `src/App.tsx:551-562` con `key={activeSite}`: al cambiar de sede se desmontan y pierden todo el estado local (filtros, pestaña, piso elegido, borradores).

`consultationMode` que reciben todas = `effectiveConsultation = roleReadOnly || consultationMode` (`src/App.tsx:483`).

Permisos del lado server para escrituras: `requireEditor` (cualquier rol con algún permiso de edición) + `requireModuleEditor` por prefijo (`server/services/siteContext.service.js:213-233`): `/agenda*` → módulo `agenda`, `/classrooms*` y `/classroom-categories*` → `classrooms`, `/teacher-schedules*` y `/recess-schedules*` → `schedules`. **`/reminders` no está en la tabla**: lo controla `editableReminder` (`server/routes/reminders.routes.js:137-155`).

> Discrepancias con `CLAUDE.md` detectadas al relevar (corregir el CLAUDE.md o tenerlas en cuenta):
> - NFND **no** muestra "Próximamente": tiene 5 plantas reales dibujadas (`ClassroomStatusPage.tsx:52-61`, `models/Nordelta*.jsx`). El "Próximamente" solo aparece en NFPT para "Nivel inicial".
> - El 2do piso de NFPT **no** usa prefijo `p2_`: sus IDs son `4N`, `4F`, `4S`, `3S` (`models/PrimerPisoModel.jsx:41-49`). Los prefijos reales son: `room_*` (PB NFPT), `pp_*` (1er piso NFPT), sin prefijo (2do NFPT), `nd_pb_*`, `nd_p1_*`, `nd_p2_*`, `nd_ini_*`, `nd_art_*` (NFND).
> - `AgendaPage` no calcula "actividad en curso / próxima del día / próxima de la semana": eso vive solo en `src/components/dashboard/NowPanel.tsx`. La Agenda tiene una franja "Próximas de hoy" más simple (ver abajo).

---

## 1. Agenda TIC (`src/components/agenda/AgendaPage.tsx`)

**Para qué sirve:** planificar y seguir las entregas de equipos (Touch/Plani/TIC/Dell) a cursos por día y turno, marcar entregado/retirado, notas y cancelaciones.

**Quién la ve:** quien tenga el módulo `agenda` visible en la sede (App vuelve al dashboard si el módulo está apagado o el rol no lo ve, `src/App.tsx:218-224`). En `consultationMode` se oculta el "+" (GooeyMenu) y se deshabilitan todas las acciones de las tarjetas; "Actualizar", "Sincronizar", "Copiar resumen", "Exportar CSV", pestañas y filtros siguen activos. Escribir exige `canEditModule('agenda')` en el server.

**Datos:**
- La página NO pide datos: recibe `items`, `olderHidden`, `onLoadOlder`, `onSave`, `onDelete`, `onTask`, `onRefresh` desde `useAgenda` en App (`src/App.tsx:551`, `src/hooks/useAgenda.ts`).
- `GET /api/agenda` (o `?all=1`) — `src/services/agendaApi.ts:5`. Está en `NO_CACHE` (`src/services/apiClient.ts:42`). El server responde con ETag (`sendWithEtag`, `server/routes/agenda.routes.js:34`) y `olderHidden`.
- Polling: el auto-refresh global corre cada `VITE_AUTO_REFRESH_SECONDS` (15 s) y la agenda se refresca cada 2 vueltas (~30 s), salteando si `document.hidden` (`src/App.tsx:228-238`). También al cambiar de sede/usuario (`src/App.tsx:196-202`). `useAgenda.refresh` deduplica requests en vuelo y no re-renderiza si el JSON no cambió (`useAgenda.ts:17-31`).
- `POST /api/agenda` (crear), `PATCH /api/agenda/:id` (cambios de estado/nota/retiradas), `DELETE /api/agenda/:id` (soft delete `eliminada=1`). Todos escriben `agenda_history` (`agenda.routes.js:62-63, 81-82, 99-100`).
- `GET /api/agenda/calendar-feed` y `POST /api/agenda/calendar-feed/rotate` (`server/routes/calendar.routes.js:10-30`); feed público `GET /calendar/:token.ics` (`calendar.routes.js:32-49`, montado sin auth en `server/index.js:101`).
- Crear tarea desde una actividad: `createTaskFromAgenda` en App → `POST` de tarea con `agendaId`, refresca tareas y **navega a la vista Tareas** (`src/App.tsx:403-407`).
- Endpoints que existen y la UI **no usa**: `GET /api/agenda/today`, `GET /api/agenda/:id(\d+)`, `GET /api/agenda/history` (200 últimos de `agenda_history`; hay `getAgendaHistory` en `agendaApi.ts:6` sin llamadores), `GET /api/agenda/export.csv` (CSV crudo de todas las columnas), `PUT /api/agenda/:id` (alias de PATCH).
- Otros que escriben/leen agenda fuera de esta pantalla: el Asistente crea actividades (`server/services/assistant/chat.service.js:625`), el Cierre del día lee la agenda del día (`server/routes/operations.routes.js:130-141`), el Dashboard (`NowPanel`) y analítica.

### Modelo y reglas de negocio (server)

- Estados válidos: `Pendiente | Entregado | Realizado | Cancelado | Faltaron equipos` (`agenda.routes.js:8`, `src/types.ts:145`). Cualquier otro valor se normaliza a `Pendiente` (`agenda.routes.js:115`).
- **Capacidad por tipo** (`agenda.routes.js:9`): `touch: 25`, `tic: 99`, `plani: 99`, `dell: 99`. Tipos fuera de la tabla no tienen tope.
- **Conflicto** (`agendaCapacityConflict`, `agenda.routes.js:136-143`): suma `cantidad` de las actividades no borradas del mismo `site_code`, mismo `dia` (case-insensitive) y mismo tipo cuyo rango `desde-hasta` se superpone (`overlaps`, solapamiento estricto en minutos). Si `usado + cantidad > max` → **409** `"Conflicto de disponibilidad: Touch supera 25 en ese horario."`. Solo se chequea en **POST** (crear), **no en PATCH**. Cuenta también actividades `Canceladas`/`Realizadas` y **ignora `fecha`** (compara por nombre de día).
- ID nuevo: `AG${Date.now()}` (`agenda.routes.js:56`).
- `agenda_history.accion`: `actividad creada`, `agenda modificada` (sin cambio de estado), `agenda <Estado>` (cambio de estado), `actividad borrada`.
- **`olderHidden`**: por defecto `GET /api/agenda` no manda las terminadas (`Realizado`/`Cancelado`) cuya última modificación (o `fecha`, o `created_at`) tenga más de **120 días** (`AGENDA_RECENT_DAYS`, `agenda.routes.js:14-31`); el conteo de ocultas viaja en la misma query como `older_hidden`. Con `?all=1` viaja todo y `olderHidden=0`.

### Controles

| Control | Dónde | Qué hace exactamente | Condiciones |
|---|---|---|---|
| Título "Agenda TIC" + subtítulo | `.agenda-workbar` (`:221-225`) | Texto: `{n} hoy · {n} visibles · {n} pendientes` (hoy = actividades de hoy con el turno filtrado; visibles = todas con el turno filtrado; pendientes = Pendiente de hoy) | — |
| Botón **Actualizar** (ícono RefreshCw) | `:227` | Llama `onRefresh` (= `useAgenda.refresh`). Sin feedback visual (ni spinner ni toast) | Siempre |
| Botón **Sincronizar** (ícono Rss) | `:228` | Abre modal "Sincronizar calendario" y pide el link ICS (`openSync`, `:191-200`) | Siempre, también en consulta |
| **GooeyMenu "+"** (FAB líquido) | `:231-237` | Abanico con 2 satélites: **Nueva actividad** (abre `AgendaModal`) y **Sincronizar calendario** (igual que el botón). Es el ÚNICO punto de entrada para crear actividades | Oculto en consulta. Si quedara 1 solo ítem el componente no se renderiza (`GooeyMenu.tsx:120`) |
| Selector de día: **Hoy · Lun · Mar · Mie · Jue · Vie** | `.agenda-day-selector` (`:243-245`) | Setea `day` y fuerza la pestaña **Día** (`setTab('today')`) | No hay Sáb/Dom |
| Pestañas **Día · Semana · Mes · Historial** | `.agenda-view-tabs` (`:246-252`) | Cambian `tab`. `role="tablist"` pero los botones no tienen `role="tab"`/`aria-selected` | — |
| Filtro de turno **Completo · Mañana · Tarde** | `.agenda-turno-filter` (`:253-264`) | Filtra por `item.turno` normalizado sin acentos (`matchesTurno`, `:35-41`). Afecta todas las vistas, KPIs y el subtítulo | `role="group"` con aria-label |
| Franja **Próximas de hoy** | `.agenda-live-strip` (`:267-282`) | Muestra hasta 4 actividades de hoy en `Pendiente` o `Entregado`, ordenadas por `desde+curso`. Cada una es un botón (hora, curso · actividad, estado) que **solo** vuelve a Día/Hoy (no abre la actividad) | Vacío: "No hay actividades pendientes o entregadas para hoy." |
| 7 KPIs (`AgendaKpis.tsx:8-14`) | `.agenda-kpi-grid` | Botones `StatCard` con `aria-pressed`: **Actividades** (total; limpia el filtro), **Pendientes**, **Entregadas**, **Realizadas**, **Vencidas** (Pendiente con `fecha` y `fecha+hasta` pasada; sin `fecha` nunca vence, `:43-46`), **Plani requeridas** (suma de `cantidad` con tipo /plani/), **TIC requeridas** (suma de `cantidad` con tipo /tic/). Clic de nuevo en el mismo = quita el filtro (`toggleKpiFilter`, `:181`) | Valor animado (`AnimatedNumber`) |
| Tira **Filtro activo: {clave}** + **Limpiar** | `.filter-strip` (`:285-290`) | Muestra la clave cruda (`pending`, `entregadas`, `vencidas`…, no un label) y "Limpiar" la quita | Solo con filtro KPI activo |
| **Copiar resumen** (ícono Clipboard) | `.agenda-secondary-actions` (`:293`) | Copia al portapapeles líneas `dia desde-hasta \| curso \| actividad \| cantidad tipo \| estado`. Fuente: en Mes = día seleccionado; en cualquier otra pestaña = lista `filtered` (día elegido + KPI). Si no hay `navigator.clipboard` descarga `agenda-resumen.txt` (`:182-187`). **Sin toast ni feedback** | — |
| **Exportar CSV** | `:294` | Descarga `agenda-tic.csv` con BOM (Excel), columnas `dia,turno,desde,hasta,curso,actividad,tipo,cantidad,ubicacion,estado,nota`. Fuente: `filtered` (día + turno + KPI); si está vacía, exporta **todos** los `items` sin filtro de turno (`:189`). Generado en el front, no usa `/api/agenda/export.csv` | En Semana/Mes/Historial exporta igual el filtro de la pestaña Día |
| Vista **Día** | `.agenda-cards` (`:347-351`) | `AgendaCard` por cada actividad del día elegido (Hoy = `fecha===hoy` o `dia===hoy`; Lun..Vie = por `dia`, aunque tenga `fecha` de otra semana) | Vacío: "Sin actividades en el filtro actual." |
| Vista **Semana** | `.agenda-week-board` (`:297-308`) | 5 columnas Lunes–Viernes agrupadas por `dia` (ignora `fecha`), con `AgendaCard` completas | Vacío por columna: "Sin actividades" |
| Vista **Mes**: encabezado | `.agenda-month-head` (`:312-315`) | Título mes/año actual (`formatDate`), botón **Hoy** que vuelve a seleccionar hoy | **No hay navegación a otros meses**: siempre el mes actual |
| Vista **Mes**: grilla 6×7 | `.agenda-month-grid` (`:316-332`) | 42 botones-día (lunes primero). Clases `muted-day` (fuera de mes), `today`, `selected`. Muestra badge con la cantidad de actividades. Clic = selecciona el día | Actividades sin `fecha` se ubican en la fecha de **esta semana** que corresponde a su `dia` (`itemDate`, `:71-80`) |
| Vista **Mes**: panel del día | `.agenda-selected-day` (`:334-345`) | Título "martes 14 de octubre" + "N actividades" + `AgendaCard`s | Vacío: "Sin actividades para este día." |
| Vista **Historial** | `:352-363` | Actividades `Realizado`/`Cancelado` (de lo cargado), orden por `ultimaModificacion`/`createdAt` desc. No usa `agenda_history` | Vacío: "Aún no hay actividades realizadas o canceladas." |
| Bloque **olderHidden** + **Ver anteriores** | `.agenda-older` (`:356-361`) | "Hay N actividades terminadas de hace más de 4 meses." + botón que llama `onLoadOlder` → `useAgenda.loadOlder`: pone `includeAll=true` **para el resto de la sesión** (todos los polls siguientes piden `?all=1`) y fuerza re-render | Solo en Historial y si `olderHidden>0`. Sin spinner |
| Modal **Sincronizar calendario** | `:366-386` | Texto explicativo; input readonly con el link ICS (placeholder "Generando enlace..."); **Copiar enlace** (primary), **Abrir Google Calendar** (`window.open` a `calendar.google.com/.../addbyurl`, `noopener`), **Regenerar** (rota el token; el link viejo deja de andar); mensaje info/error (error si el texto contiene "No se"); pasos 1-2-3 | Los tres botones deshabilitados hasta tener link. Regenerar **sin confirmación**. En roles de solo lectura Regenerar da 403 (POST bajo `/agenda`) |

#### Tarjeta de actividad (`src/components/agenda/AgendaCard.tsx`)

| Control | Dónde | Qué hace exactamente | Condiciones |
|---|---|---|---|
| Tarjeta completa | `<article role="button" tabIndex=0>` (`:45-51`) | Clic o **Enter** abre el modal de detalle. Clases: `agenda-kind-{glifing\|matific\|programacion\|tic}` según texto de `actividad` (`:6-13`), `agenda-state-{estado}`, `agenda-retired-all\|some` | Space no la abre |
| Cabecera | `:52-61` | `desde - hasta`, turno legible (Mañana/Tarde), badge de estado (`agenda-status-*`), badge "Retiradas X/Y" si `compusRetiradas>0` (`is-all`/`is-some`) | — |
| Cuerpo | `:62-68` | Badge con `actividad`, `curso` (h3), "**cantidad** tipo", `ubicacion`, preview de `nota` | — |
| Botón **Entregar / Entregado** | `.agenda-actions` (`:70-78`) | Toggle `Pendiente ↔ Entregado` vía PATCH. Texto "Guardando..." mientras guarda; `aria-pressed`; variante `success` cuando está entregado | Deshabilitado en consulta o mientras guarda. Desde `Realizado/Cancelado` lo pasa a `Entregado` |
| Botón **Nota** | `:79` | Abre modal "Nota - {curso}" | Deshabilitado en consulta |
| Botón **Retirar / Retiradas** | `:80` | Toggle `compusRetiradas = cantidad` ↔ `0` | Solo si estado `Entregado` o `Realizado`; deshabilitado en consulta |
| (contenedor de acciones) | `:69` | `stopPropagation` para que los botones no abran el detalle | — |
| Modal detalle "{curso} - {actividad}" | `:83-111` | Resumen: Horario, Entrega, Ubicacion, Estado; nota. Acciones: **Marcar entregado / Volver a pendiente**, **Marcar retirada / Desmarcar retirada** (sin restricción de estado acá), **Nota**, **Crear tarea** (`onTask` → crea tarea "Revisar {curso} - {actividad}" y navega a Tareas), **Cancelar evento** (estado `Cancelado`, **sin confirmación**), **Borrar** (`confirmDialog` "Borrar actividad", soft delete; `useAgenda.ts:58-64`) | Todas deshabilitadas en consulta |
| Modal nota | `:113-127` | `<textarea rows=5>` con la nota, **Guardar nota** (PATCH `nota`), **Cancelar** | — |

#### Alta de actividad (`src/components/agenda/AgendaModal.tsx`)

| Control | Qué hace | Condiciones |
|---|---|---|
| **Día** (`SelectField`, `:29`) | Lunes–Viernes. Default `Lunes` | **No existe campo de fecha**: las actividades creadas acá son semanales por nombre de día |
| **Turno** (`SelectField`, `:30`) | Mañana / Tarde. Default `Mañana` | — |
| **Desde / Hasta** (`:33-34`) | `<input>` de texto, `inputMode="numeric"`, `pattern="[0-2][0-9]:[0-5][0-9]"`, placeholder `08:00`/`08:45`. Default `09:05`–`09:55` | **No es time picker nativo**; el `pattern` se valida con el globo nativo del navegador al enviar. Sin `required` |
| **Curso** (`:36`) | Texto, `required` | — |
| **Actividad** (`:37`) | Texto libre, default `Glifing` | Determina el color de la tarjeta |
| **Tipo** (`SelectField`, `:39`) | Touch / Plani / TIC / Dell. Default `Touch` | — |
| **Cantidad** (`:40`) | `<input type="number" min=1 max=25 (Touch) / 99>` **nativo** | El tope del front es por actividad; el server suma superpuestas |
| **Ubicación**, **Nota** (`:42-43`) | Texto (Nota es input de una línea, no textarea) | — |
| **Guardar / Cancelar** (`:45`) | Guarda (`onSave` → POST + refresh), cierra. "Guardando..." deshabilitado | Error del server (p.ej. 409 de capacidad) se muestra en `.form-error` dentro del modal |

**No existe edición de una actividad ya creada** (curso, horario, tipo, cantidad, día): solo estado, nota y retiradas. Para corregir hay que borrar y crear.

**Estados y transiciones (UI):** `Pendiente ⇄ Entregado` (botón), cualquiera → `Cancelado` (detalle), retiradas `0 ⇄ cantidad` (independiente del estado). **`Realizado` y `Faltaron equipos` no se pueden setear desde ninguna pantalla** (solo por API/Asistente/datos viejos), aunque los KPIs y el Historial los muestran y `NowPanel` excluye `Faltaron equipos`.

**Micro-interacciones y atajos:**
- Enter sobre una tarjeta enfocada abre el detalle (`AgendaCard.tsx:50`). La tarjeta es `role=button` y contiene botones (interactivo anidado).
- GooeyMenu: Escape y clic afuera lo cierran (`GooeyMenu.tsx:93-106`); los satélites tienen `tabIndex=-1` cerrados y `title` (tooltip nativo) con el label; el "+" rota 45° y es la X; animación de "anticipación" al cerrar.
- Modales (`Modal.tsx`): portal al body, `body.modal-open` (bloquea scroll y `touch-action:none`), Escape cierra, Tab atrapado, foco vuelve al disparador, cierre animado de 150 ms, backdrop cierra con `mousedown` (seleccionar texto y soltar afuera no cierra).
- **Burbujeo por portal (probable bug)**: los modales de detalle y de nota se renderizan *dentro* del `<article onClick/onKeyDown>`; los eventos sintéticos de React atraviesan el portal. Un clic o un Enter dentro del modal de **Nota** (abierto desde la tarjeta) burbujea al `article` y ejecuta `setDetailOpen(true)`, abriendo el detalle por detrás. Verificar y no replicar.
- "Copiar resumen" y "Copiar enlace" no muestran toast (el de enlace pone "Enlace copiado." en el modal incluso si `navigator.clipboard` no existe).
- Recuerda: nada. Día, pestaña, turno, filtro KPI y fecha del mes se pierden al salir de la vista (no hay localStorage).
- La animación de entrada de cards depende de `useScrollReveal` con `agenda.items.length` (`src/App.tsx:87`).

**Estados:**
- Loading: ninguno propio (la página llega con `items=[]` hasta el primer GET; si falla, `useAgenda` deja `[]` en silencio, `useAgenda.ts:34`).
- Vacíos: textos por vista (ver tabla).
- Error al crear: `.form-error` en el modal. Error en PATCH/DELETE desde tarjeta: **no se muestra** (la promesa rechaza; `update` solo resetea `busyState`).
- Confirmaciones: solo Borrar (`confirmDialog` danger). Cancelar evento y Regenerar link sin confirmar.
- No hay optimistic update: todo espera al PATCH + re-GET.

**Controles nativos o fuera de sistema a reemplazar:**
- `AgendaModal.tsx:40` `<input type="number">` (Cantidad).
- `AgendaModal.tsx:33-34` inputs de hora como texto con `pattern` (no picker; validación con globo nativo).
- `AgendaPage.tsx:375` `window.open` (aceptable).
- `AgendaCard.tsx:120` `<textarea>` simple.
- No hay `<select>` nativo (usa `SelectField`). No hay date picker: la fecha del Mes se elige con la grilla propia.

**Mobile:**
- `.agenda-control-band` y `.agenda-hero-actions` pasan a una columna y los botones se estiran (`components.css:4330-4341`).
- KPIs: 5 columnas ≤1400, 3 ≤980, 2 ≤600 (`components.css:1278-1280`, refuerzos con `!important` en `:1852-1855`).
- `.agenda-cards` a 1 columna (`responsive.css:49-53`); `.agenda-month-layout` a 1 columna (calendario arriba, día abajo).
- Selector de días hace wrap (`components.css:1845`).

**Riesgos para el rediseño:**
- **Zona horaria**: `todayIso()` usa `toISOString()` (UTC) (`AgendaPage.tsx:31-33`, también `itemDate` y `monthMatrix`). Después de las 21:00 de Argentina "hoy" pasa a ser mañana para las actividades con `fecha` y para la marca `today`/`selected` del mes.
- Domingo: `todayName()` devuelve `''` → la vista Día/Hoy queda vacía; sábado busca `Sábado`, que el alta no permite.
- `monthMatrix()` se memoiza una sola vez (`:158`): con la pestaña abierta pasada la medianoche/fin de mes, el mes no avanza.
- Los KPIs en pestaña Día se calculan sobre **hoy**, no sobre el día elegido (`:175-179`); en Semana/Historial sobre todo lo visible. Es fácil "arreglarlo" sin querer y cambiar números.
- Las clases que pintan la tarjeta salen de JS: `agenda-kind-*` (por texto de actividad), `agenda-state-*`, `agenda-status-*`, `agenda-retired-*`, `agenda-delivered-btn is-on`. Hay CSS muerto con otra convención (`.agenda-card.estado-*`, `.time-vencida`, `.time-en-curso` con `pulse-card`, `components.css:1302-1313`) que no se aplica hoy.
- `includeAll` (Ver anteriores) vive en un ref del hook de App: no se resetea al cambiar de sede.
- El conteo de capacidad del server no mira `fecha` ni estado; si el rediseño agrega fecha real o edición, hay que revisar `agendaCapacityConflict` y aplicarlo también en PATCH.
- El feed ICS (`calendar.routes.js:127-144`) traduce las actividades sin `fecha` a la fecha de **la semana actual** y no emite `RRULE`: el calendario suscripto solo ve la semana en curso de lo semanal. Excluye `Cancelado`. Token por usuario+sede (64 hex), `appBaseUrl/calendar/{token}.ics`.

---

## 2. Horarios (`src/components/schedules/SchedulesPage.tsx`)

**Para qué sirve:** cargar y consultar horarios docentes por nivel (Primaria 1er ciclo, 2do ciclo, Secundaria), ver quién está dando clase ahora y configurar franjas de recreo por grupo.

**Quién la ve:** módulo `schedules` visible (`canViewModule(req,'schedules')` en GET, `schedules.routes.js:12,62`). Editar horarios docentes: `canEditModule('schedules')`. Configurar recreos: **solo administrador de la sede** (`isSiteManager`, `schedules.routes.js:74-76`); el GET devuelve `canConfigure`. En consulta: se deshabilitan "+ Agregar horario", Editar, Borrar y todo lo de recreos; se ocultan "+ Grupo", "Guardar cambios" y "+ Franja".

**Datos:**
- `GET /api/teacher-schedules` → `{items, current, clock}`; `current` = entradas cuyo día y hora (reloj de **America/Argentina/Buenos_Aires** del server, `localClock`, `schedules.routes.js:128-132`) caen ahora.
- `GET /api/recess-schedules` → `{groups, active, canConfigure, clock}`.
- `POST /api/teacher-schedules`, `PATCH /api/teacher-schedules/:id`, `DELETE /api/teacher-schedules/:id` (soft delete `active=0`), `PUT /api/recess-schedules` (reemplazo total).
- Ambos GET se piden en paralelo al montar (`refresh`, `:46-57`) y después de cada escritura. **Sin polling**: "Ahora" y "Recreo activo" quedan congelados a la hora de carga.
- Caché: `apiGet` normal (15 s stale-while-revalidate); las escrituras pasan por `apiSend` (vacía caché).
- Notificaciones: crear/editar horario y guardar recreos disparan `notifySiteAdmins` (`schedule.created`, `schedule.updated`, `recess.updated`) con link `/sede/{SEDE}/schedules` (`schedules.routes.js:33, 49, 97, 136-138`). Borrar no notifica.

### Controles

| Control | Dónde | Qué hace exactamente | Condiciones |
|---|---|---|---|
| Pestañas **Docentes · Recreos** | `.planning-tabs` (`:110-117`) | Cambian `tab` | Sin roles ARIA |
| Mensaje | `.tool-info` (`:119`) | "Horario guardado." / "Recreos guardados." / "No se pudieron cargar los horarios." Nunca se limpia | El error usa estilo info, no error |
| Tabs de nivel (3) | `.schedule-level-tabs` `role=tablist` (`:123-137`) | Primaria · 1er ciclo / 2do ciclo / Secundaria, cada uno con contador "{n} horarios". Filtra lista y "Ahora" | `role=tab` + `aria-selected` |
| Tarjetas **Ahora** | `.schedule-now-grid` (`:138-155`) | Una por clase en curso del nivel: docente, curso · materia, `inicio–fin · aula` | Solo si hay alguna |
| Buscador | `.schedule-controls` (`:157-163`) | `<input type="search">` filtra (case-insensitive, `es`) por docente, curso, materia, aula y nombre del día | Sin debounce |
| Segmentado **Por docente · Por curso** | `.segmented-control` (`:164-171`) | Agrupa las tarjetas por docente o por curso (orden alfabético `es`) | — |
| **+ Agregar horario** | `:172-174` | Abre modal "Nuevo horario" con el nivel activo preseleccionado | Deshabilitado en consulta |
| Tarjeta de grupo | `.schedule-group` (`:178-225`) | Cabecera "Docente"/"Curso" + nombre + "N clases"; secciones por día (orden numérico) y filas por hora | — |
| Fila de horario | `.schedule-row` (`:196-219`) | `<time>` inicio / fin chico; curso (o docente) + "materia · aula" o "Sin detalle" | — |
| **Editar** (fila) | `:206-208` | Abre el modal con esa fila | Deshabilitado en consulta |
| **Borrar** (fila) | `:209-218` | `confirmDialog` "Borrar horario" (danger) → DELETE → refresh | Deshabilitado en consulta |
| Vacío | `:227-231` | "No hay horarios cargados para primaria · 1er ciclo." | — |
| Banner **Recreo activo** | `.active-recess-banner` (`:236-245`) | Lista "{grupo} · inicio–fin" de las franjas en curso (todos los grupos, sin filtrar por nivel) | Solo si hay |
| **+ Grupo** | `.recess-toolbar` (`:250`) | Agrega en memoria "Grupo N" vacío | `canConfigure && !consultationMode` |
| **Guardar cambios** | `:251-260` | `PUT` con todos los grupos → mensaje → refresh | Ídem. Sin try/catch: un 400 ("Todos los grupos necesitan un nombre.") no se muestra |
| Nombre del grupo | `.recess-group-card header` (`:268-273`) | Input de texto editable | Deshabilitado si no puede configurar o consulta |
| **Eliminar** (grupo) | `:274-279` | Lo saca de la lista local, **sin confirmar**; persiste al Guardar | Ídem |
| Franja: etiqueta, inicio, fin | `.recess-slot` (`:283-308`) | Etiqueta texto; inicio/fin texto `inputMode=numeric` `pattern=HH:MM` placeholder `10:00`/`10:15` | Ídem |
| **×** (franja) | `:309-314` | Quita la franja local | Ídem |
| **+ Franja** | `:318-326` | Agrega "Recreo 10:00–10:15" | `canConfigure && !consultationMode` |
| Vacío recreos | `:330` | "Todavía no hay grupos de recreo configurados." | — |

#### Modal Nuevo / Editar horario (`:334-433`)

| Control | Qué hace | Notas |
|---|---|---|
| **Nivel** (3 botones tipo chip en `<fieldset>`) | 1er ciclo / 2do ciclo / Secundaria | `type=button` |
| **Docente**, **Curso** | Texto `required` | — |
| **Materia**, **Aula** | Texto opcional | Aula es texto libre: no se vincula con `classrooms` |
| **Día** (`SelectField`) | Lunes–**Domingo** (1–7) | — |
| **Desde / Hasta** | Texto `inputMode=numeric`, `pattern="[0-2][0-9]:[0-5][0-9]"`, `required`, placeholder `08:00`/`08:45`. Defaults `08:00`–`08:45` | No es picker nativo. Server exige `HH:MM` con 2 dígitos y `inicio < fin` (`schedules.routes.js:115-121`) |
| **Guardar / Cancelar** | POST o PATCH → cierra → "Horario guardado." → refresh | Sin try/catch: si el server responde 400 el modal queda abierto sin mensaje (rechazo no manejado) |

**Micro-interacciones y atajos:** ninguno especial. Escape/Tab/foco del `Modal` genérico. Los cambios de recreos son **en memoria** hasta "Guardar cambios": cambiar a la pestaña Docentes y volver los conserva; un refresh (p.ej. guardar un horario docente) los **pisa sin avisar**. No hay aviso de cambios sin guardar.

**Estados:** sin loading (lista vacía hasta que llega). Error de carga: mensaje info. Confirmación solo en Borrar horario. Recreos: franjas inválidas (formato o inicio ≥ fin) se **descartan en silencio** al guardar (`schedules.routes.js:93`).

**Controles nativos o fuera de sistema a reemplazar:**
- `SchedulesPage.tsx:157-163` `<input type="search">` (la X de limpiar nativa de WebKit).
- Horas como texto con `pattern` en `:290-308` y `:398-421` (validación con globo nativo).
- No hay `<select>` nativo (Día usa `SelectField`).

**Mobile:** `.schedule-groups` usa `minmax(min(100%,420px),1fr)`; `.schedule-controls` hace wrap con el buscador `min-width:220px`; `.recess-slot` es grilla `minmax(90px,1fr) 100px auto 100px auto` (≈ 330 px mínimo, `components.css:4290`) — vigilar 360 px. `.schedule-level-tabs` tiene ajuste propio (`components.css:5091`).

**Riesgos para el rediseño:**
- `PUT /recess-schedules` borra y reinserta todos los grupos y franjas (IDs nuevos cada vez). Cualquier UI que guarde por grupo/franja necesita endpoint nuevo.
- "Ahora"/"Recreo activo" dependen del reloj del server en la carga; si el rediseño agrega auto-refresh, hay que hacerlo explícito.
- El orden de días en una tarjeta usa `.sort()` sobre números (funciona porque son 1–7).

---

## 3. Estado de aulas (`src/components/classrooms/ClassroomStatusPage.tsx`)

**Para qué sirve:** ver en un plano por planta el estado de equipamiento de cada aula (semáforo), abrir la ficha de un aula para revisar/editar equipos, ver incidentes, recordatorios, historial y pedir un diagnóstico IA.

**Quién la ve:** módulo `classrooms` visible. Escrituras (`PATCH /classrooms/:roomKey`, `POST /classrooms/:roomKey/health`, categorías) requieren `canEditModule('classrooms')`; además categorías exigen `isSiteManager` (`classrooms.routes.js:362, 380, 391, 403`). En consulta: botones de estado, "Editar equipamiento", Observaciones y "Guardar cambios" deshabilitados; "Administrar categorías" deshabilitado. **"Generar análisis" NO se deshabilita en consulta** (el server responde 403 y se ve el error).

**Datos:**
- Al montar y al cerrar el panel: `GET /api/classrooms` + `GET /api/classroom-categories` en paralelo (`:76-86`). Errores tragados (`catch {}` `:83`). Sin polling.
- `GET /api/classrooms` siembra una vez por proceso el padrón de aulas de la sede (`ensureDefaultClassrooms`, `classrooms.routes.js:287-317`): NFPT `DEFAULT_CLASSROOMS` (`:31-76`), NFND `NFND_CLASSROOMS` (`:80-146`). Otras sedes no siembran. El **piso** lo manda siempre el código; nombre y sector cargados a mano ganan.
- Migración legacy una vez por proceso (`migrateLegacyClassroomData`, `:250-258`): `piso='Primer piso'`→`'Planta baja'` para `room_%`; `3S/4N/4F/4S` → `'Segundo piso'`; `'No encontrado'` → `'Con falla'` en las 4 columnas viejas.
- Panel: `GET /api/classrooms/:roomKey?nombre&piso` (**crea la fila si no existe**, efecto lateral en un GET, `:429-432`), `GET /api/classrooms/:roomKey/history` (100 últimos), `GET /api/classrooms/:roomKey/incidents`, `POST /api/classrooms/:roomKey/health`, `PATCH /api/classrooms/:roomKey`.
- `GET /api/classrooms/summary` existe pero esta página no lo usa (calcula el resumen en el front por piso).
- Evento global: el panel dispara `techasset:assistant-context` `{type:'classroom', id, label, data:{piso}}` al abrir y `techasset:assistant-context-clear` al cerrar (`ClassroomInfoPanel.tsx:108`) para que el Asistente sepa en qué aula estás.
- Caché del server: mapa de categorías por sede (`categoryCache`, `classrooms.routes.js:189-202`), invalidado en cada escritura de categorías.

### Plantas por sede (`SITE_MAPS`, `:42-62`)

| Sede | `key` | Botón | `piso` en DB | Componente | viewBox | IDs |
|---|---|---|---|---|---|---|
| NFPT | `planta` | Planta baja | `Planta baja` | `PrimerPisoModel` → `FloorModel` genérico | `0 0 1000 1150` | `room_*` (+ pasillos `pasillo_*` no clickeables) |
| NFPT | `primero` | 1er piso | `1er piso` | `FirstFloorModel` → `FloorMapPrimerPiso.jsx` (dibujo propio) | `0 0 1020 830` | `pp_*` |
| NFPT | `segundo` | Segundo piso | `Segundo piso` | `SecondFloorModel` → `FloorModel` | `0 0 1320 830` | `4N`, `4F`, `4S`, `3S` (sin prefijo) |
| NFPT | `inicial` | Nivel inicial + "Próximamente" | — | deshabilitado | — | — |
| NFND | `planta` | Planta baja | `Planta baja` | `NordeltaPlantaBaja.jsx` | `0 0 1024 560` | `nd_pb_*` |
| NFND | `primero` | 1er piso | `1er piso` | `NordeltaPrimerPiso.jsx` | `0 0 1024 560` | `nd_p1_*` |
| NFND | `segundo` | 2do piso | `2do piso` | `NordeltaSegundoPiso.jsx` | `0 0 1024 560` | `nd_p2_*` |
| NFND | `inicial` | Nivel inicial | `Nivel inicial` | `FloorModel` con `INICIAL` inline en `NordeltaModels.jsx:22-42` | `0 0 1140 345` | `nd_ini_*` |
| NFND | `artes` | SUM / Artes | `Artes` | `FloorModel` con `ARTES` (`NordeltaModels.jsx:45-53`) | `0 0 680 640` | `nd_art_*` |

`NordeltaInicial.jsx` existe (dibujo a mano, `viewBox 0 0 1160 440`) pero **no se usa**: el barrel usa la versión `FloorModel` inline. Mismos IDs.

Espacios no clickeables (decorativos): en `FloorModel` todo `noClick`, `patio`, `corridor` o sin label (`FloorModelBase.jsx:30-32`); en `FloorMapPrimerPiso` los `interactive:false` (`pp_Banos`, `pp_DOE`, `pp_Escalera`, `pp_Pasillo`, **`pp_TIC`**); en Nordelta los `noClick` (dirección, staff, recepción) y escaleras/baños/pasillos dibujados con `Stair`, `Bath`, `Corridor`.

Desfasajes padrón ↔ plano (no romper, pero saberlos): el server siembra `pp_DOE` y `pp_TIC` (no clickeables en el plano) y `sp_Pasillo_Precep` (en el plano el ID es `pasillo_precep_1er_piso`, no clickeable); `ROOM_DEFAULT_EQUIPMENT` define `room_Directores` (no clickeable). `pp_6F2`/`pp_6N2` se llaman "6F (T)"/"6N (T)" en el plano y "6F"/"6N" en el padrón.

### Controles

| Control | Dónde | Qué hace exactamente | Condiciones |
|---|---|---|---|
| Mensaje "Cambios guardados." | `.tool-info` (`:139`) | Aparece al cerrar el panel tras guardar; se limpia al abrir otra aula | — |
| Botones de planta | `.classrooms-floor-selector` (`:140-153`) | Cambian `floor`. Deshabilitados con `title="Próximamente"` y `<small>Próximamente</small>`; los habilitados tienen `title` = label | Piso inicial siempre `planta`; no se recuerda |
| **Administrar categorías** | `:154` | Abre `ClassroomCategoryManager` | Solo si `canManage` (admin de sede); deshabilitado en consulta |
| 8 tarjetas resumen | `.classroom-summary-grid` (`:156-165`) | Por planta: Total aulas (clickeables del plano), Aulas OK, Con observaciones, Con problema, Sin revisar (incluye aulas sin fila), Proyectores / NUC / Monitores con falla (estado `Con falla` o `En reparación`). **No son clickeables** | — |
| Plano SVG | `.classroom-model-canvas` (`:168-171`) | Ver "Interacciones con el plano" | — |
| **Ver lista de aulas** | `<details class="classroom-model-list">` (`:172-186`) | Lista desplegable de botones (nombre + estado, clase `estado-{ok\|con-observaciones\|problema\|sin-revisar}`); clic abre la ficha igual que el plano | **Única vía por teclado** para abrir un aula |
| Sede sin plano | `:128-134` | "Estado de aulas no configurado para esta sede." | Sedes ≠ NFPT/NFND |
| Planta deshabilitada | `:188-192` | "{label} próximamente disponible." | — |

### Interacciones con el plano

- **Hover** (mouse): `onMouseEnter/Leave` en cada `<g>` clickeable.
  - `FloorModel`: relleno `#142e5e` y borde `#3a90d4` de 2 px si el aula no tiene estado; si tiene estado, el color de estado gana y solo engrosa el borde (`FloorModelBase.jsx:44-56, 96-101`).
  - `FloorMapPrimerPiso`: halo con filtro `fpGlow` (rect +3 px, opacidad .5), texto en `#00d4ff` y negrita (`FloorMapPrimerPiso.jsx:272-282, 259`).
  - Nordelta: halo `ndFloorGlow`, texto `C.glow` y negrita (`NordeltaFloorKit.jsx:135-141`).
- **Click**: `onRoomClick(roomKey, nombre)` → `window.scrollTo({top:0, behavior:'smooth'})` + abre `ClassroomInfoPanel` (`ClassroomStatusPage.tsx:115-120`). El panel vuelve a hacer scroll al tope al montar.
- **Tooltip nativo** `<title>`: `"{label} · {estadoGeneral}"` en `FloorModel` (`FloorModelBase.jsx:81, 94`) y Nordelta (`NordeltaFloorKit.jsx:134`). **`FloorMapPrimerPiso` (1er piso NFPT) no tiene `<title>`.**
- **Colores de estado** (`estadoGeneral`): OK verde, Con observaciones ámbar, Problema rojo, Sin revisar = color base del tipo (sin pintar). En `FloorMapPrimerPiso` y Nordelta además un **punto** de color en la esquina superior derecha del aula (`FloorMapPrimerPiso.jsx:338-345`, `NordeltaFloorKit.jsx:142`).
- Detalles visuales que son parte de la lectura: marca de agua (texto gigante translúcido por planta), grilla de fondo (`pattern`), tramas de pasillo, arcos de puerta en Nordelta (`doorPath`), escalones dibujados (`Stair`), artefactos en baños (`Bath`), bloques punteados (`dashed`) y bloque rojo (`tone:'danger'`, Dirección Secundaria), texto rotado -90° en bloques verticales (`StaticBlock`), sala TIC destacada con ◆ y "TECHASSET · NFS" (`FloorMapPrimerPiso.jsx:283-337`), barra superior de 3 px por aula con el color del borde.
- `selectedRoom` (resaltado del aula abierta) está soportado por `FloorMapPrimerPiso` pero la página **no lo pasa**: hoy no hay "aula seleccionada" en el plano.
- **Zoom / pan**: no existe. El SVG ocupa el 100 % del ancho con `preserveAspectRatio="xMidYMid meet"`; no hay rueda, pinch ni botones. En ≤980 px `.classroom-model-canvas` tiene `overflow-x:auto` (`components.css:2076`), pero `responsive.css:68-78` lo pisa con `overflow-x:hidden` y `max-width:100%` (el plano se achica, no scrollea).
- **Teclado**: los `<g>` no son focusables ni tienen `role`/`tabIndex`; sin Enter/Space. Solo la lista `<details>`.
- Texto del plano con `userSelect:none` y `pointerEvents:none` (el clic cae en el `<g>`).

### Ficha de aula (`src/components/classrooms/ClassroomInfoPanel.tsx`)

Diálogo propio (no usa `<Modal>` ni portal): `.modal.t-modal.classroom-modal-wrap`, `role="dialog"`, `aria-modal`, `aria-label="Aula {nombre}"`.

| Control | Dónde | Qué hace exactamente | Condiciones |
|---|---|---|---|
| Backdrop | `:194` | **`onClick`** cierra (no `onMouseDown` como `Modal`: arrastrar una selección desde adentro hacia afuera cierra la ficha) | — |
| **✕** | `:201` | Cierra (sin guardar) | — |
| Encabezado | `:196-200` | Nombre (del plano) y piso | — |
| Badge **Estado general** | `.classroom-general-badge estado-*` (`:204-206`) | Se recalcula en vivo con el borrador (`calcGeneral`) | — |
| **Generar análisis** | `.classroom-health-section` (`:208`) | `POST /health`: IA (OpenAI, `max 900 tokens`) con aula, equipamiento, tickets (80) y dispositivos cuya ubicación contiene el nombre; si falla, reporte local heurístico (`classrooms.routes.js:542-570`). Muestra score, estado, resumen y listas "Problemas recurrentes / Puntos positivos / Riesgos / Acciones preventivas". Texto "Analizando…" | Se guarda en `classroom_health_reports` pero **nunca se vuelve a leer**: cada apertura arranca vacía |
| Incidentes del aula | `.classroom-incidents-section` (`:210-228`) | KPIs Abiertos / Cerrados / Total / Último incidente; chips "Problemas frecuentes" (top 5 categorías); timeline de los 8 últimos tickets (badge estado, `#numero · título`, categoría · prioridad · fecha). **No clickeables** (no llevan al ticket) | Vínculo por `classroom_key` o por nombre del aula en tickets sin key |
| Recordatorios del aula | `<RelatedReminders type="classroom">` (`:229`) | Ver sección 4.2 | — |
| **Editar equipamiento / Cerrar categorías** | `.classroom-equipment-toolbar` (`:231-236`) | Muestra/oculta los checkboxes de qué equipos tiene el aula | Deshabilitado en consulta |
| Checkboxes de equipamiento | `.classroom-equipment-config` (`:238-256`) | Uno por categoría de la sede (o los 9 por defecto). Marcar agrega el ítem en `Sin revisar`; desmarcar lo quita | No se puede desmarcar el último; deshabilitados en consulta |
| Fila por equipo + chips de estado | `.classroom-items` (`:258-277`) | Chips `OK / Con falla / No tiene / En reparación / Sin revisar` (o el subconjunto que admita la categoría). Clase `tone-{ok\|warn\|neutral\|special\|muted}` y `active` | Deshabilitados en consulta |
| **Observaciones** | `:279-287` | `<textarea rows=3>` | Deshabilitada en consulta |
| Última actualización | `:289-292` | Fecha-hora + operador del último cambio | — |
| **Cancelar** | `.classroom-modal-actions` sticky (`:296-299`) | Cierra descartando el borrador **sin preguntar** | Deshabilitado mientras guarda |
| **Guardar cambios** | `:298` | `PATCH` con nombre, piso, 4 columnas legacy, `equipment`, observaciones, operator → recarga historial → cierra con `saved=true` → la página muestra "Cambios guardados." y refresca | "Guardando..."; deshabilitado en consulta |
| **Historial de cambios (N)** | `<details class="classroom-history">` (`:301-315`) | 20 últimos: fecha · **campo**: antes → después (operador). `campo` es crudo (`proyector`, `equipment`, `estadoGeneral`…); el de `equipment` muestra JSON completo | Solo si hay historial |

**Regla de estado general** (front `calcGeneral` `:60-66` y server `calcEstadoGeneral` `classrooms.routes.js:240-248`, deben coincidir):
- Algún equipo `En reparación` → **Problema**.
- Si no, alguno `Con falla` o `Sin revisar` → **Con observaciones**.
- Si todos `OK` o `No tiene` → **OK**.
- Sin equipos → **Sin revisar**.
- `'No encontrado'` se migra a `'Con falla'` al leer (front `migrateLegacyState` `:23-27`, server `migrateItemState`).

**equipment_json:** array `[{key,label,state}]` en `classrooms.equipment_json`. Si está vacío, el server arma el default desde `ROOM_DEFAULT_EQUIPMENT` o `proyector, nuc, monitor, tecladoMouse` leyendo las columnas viejas `*_estado` (`classrooms.routes.js:176-217`). El front, si llega vacío, toma las **primeras 4 categorías** de la sede (`getEquipment`, `:48-58`). Al guardar, el server descarta keys que no sean categoría activa ni existieran antes (`equipmentFromBody`, `:319-335`) y sincroniza las 4 columnas legacy (`No tiene` si el equipo no está, `syncLegacyStates`). Historial por campo cambiado en `classroom_history` (`:474-486`).

**Micro-interacciones y atajos:**
- `useDialogFocus`: foco inicial adentro, Tab atrapado, **Escape cierra**, foco vuelve al disparador (`:127-129`).
- `body.modal-open` mientras está abierta (`:122-125`).
- Cierre animado de 150 ms (`useCloseChoreography`) con `savedRef` para no perder el `saved` en la salida (`:110-120`); el valor tiene que coincidir con `--modal-close-dur`.
- Scroll suave al tope al abrir (doble: página y panel).
- Acciones sticky al pie (`components.css:2314`); la tarjeta scrollea internamente (`max-height: calc(100dvh - 48px)`).
- Carga: `SkeletonPanel rows=4` mientras no hay borrador (`:133-141`).

**Estados:** skeleton al abrir; error de guardado "No se pudo guardar" / "Error de conexión" en `.tool-error`; error de análisis con el mensaje del server. **Si `GET /classrooms/:roomKey` falla, el skeleton queda para siempre** (no hay catch). Incidentes vacíos: "Esta aula todavía no tiene incidentes vinculados.". Sin confirmación al descartar cambios.

#### Administrar categorías (`src/components/classrooms/ClassroomCategoryManager.tsx`)

`Modal` ancho "Categorías de Estado de aulas". Cada categoría = una fila del checklist de aula; se siembran las 9 por defecto la primera vez (`ensureClassroomCategories`, `classrooms.routes.js:574-584`).

| Control | Qué hace | Condiciones |
|---|---|---|
| **↑ / ↓** (`:58-59`) | Intercambia con la vecina y manda el orden completo (`PATCH /classroom-categories/reorder`) al instante | Deshabilitado en extremos; `aria-label` Subir/Bajar |
| Resumen (`:61-64`) | Nombre + "Todos los estados" o la lista de estados admitidos | — |
| **Editar** (`:66`) | Pasa la fila a formulario inline: **Nombre** (`autoFocus`) + checkboxes nativos de estados admitidos | Una a la vez |
| **Guardar / Cancelar** (inline, `:88-91`) | `PATCH /classroom-categories/:id`. Si no se marca ningún estado, guarda todos | `busy` |
| **Eliminar** (`:67-71`) | `confirmDialog` danger → soft delete (`active=0`). "El historial anterior se conserva" | — |
| **Nueva categoría** (`:115`) | Muestra input inline (`autoFocus`, placeholder "Nombre de la categoría") + **Crear** / **Cancelar**. Nombre vacío: no hace nada. Key autogenerada camelCase única (`uniqueCategoryKey`) | — |
| **Cerrar** (`:116`) | Cierra el modal | — |

Sin try/catch en mover/crear/eliminar: errores 403/400 no se muestran. `onChanged` = refresh de la página (cambia la identidad de `categories`).

**Controles nativos o fuera de sistema a reemplazar:**
- `ClassroomStatusPage.tsx:172` `<details>/<summary>` (Ver lista de aulas).
- `ClassroomInfoPanel.tsx:302` `<details>/<summary>` (Historial).
- `ClassroomInfoPanel.tsx:245-250` checkboxes nativos de equipamiento.
- `ClassroomCategoryManager.tsx:83` checkboxes nativos de estados.
- `ClassroomInfoPanel.tsx:280` `<textarea>`.
- Tooltips SVG `<title>` (`FloorModelBase.jsx:94`, `NordeltaFloorKit.jsx:134`) y `title=` en botones de planta (`ClassroomStatusPage.tsx:148`).
- Flechas ↑/↓ y ✕ como caracteres de texto.

**Mobile:**
- Selector de plantas a grilla de 2 columnas; resumen a 2 columnas; wrap con padding 10 px (`responsive.css:55-66`).
- El plano se achica al ancho (sin scroll horizontal, sin zoom): en 360 px las aulas de NFPT planta baja (viewBox 1000×1150) quedan con textos de ~3-4 px. Es el punto más débil en celular.
- Ficha: alineada arriba con scroll propio; filas de equipo en grilla; chips de estado en 2 columnas con `min-height:38px` (`responsive.css:80-96`).

**Riesgos para el rediseño:**
- Los IDs del SVG **son** los `room_key` de la base. Renombrar un ID huérfana el historial de esa aula y el seed crea otra fila. Lo mismo `piso`: el seed lo re-sincroniza desde el código en cada arranque.
- `floorItems` filtra por `c.piso === activePiso || floorRoomKeys.has(c.roomKey)` (`:92`): los textos de piso (`'1er piso'` vs `'Primer piso'`, `'Segundo piso'` vs `'2do piso'`, `'Artes'`) deben seguir alineados con el server.
- Las listas de aulas (`ALL_FLOOR_ROOMS`, `ND_ALL_FLOOR_ROOMS`) se derivan de los mismos arrays que dibujan: si se separa el dibujo de la lista, el resumen y "Ver lista" se desincronizan.
- `id` de `<pattern>`/`<filter>` en el SVG (`pgrid-*`, `cpat-*`, `fpGlow`, `fpGrid`, `ndFloorGlow`, `ndFloorGrid`, `ndFloorHatch`): son globales en el documento; dos planos montados a la vez colisionarían.
- El `useEffect` de carga del panel depende de `categories` (`:106`): si cambia la identidad del array (cualquier refresh del padre) se vuelve a pedir el aula y **se pisa el borrador**.
- Colores del plano están hardcodeados en JS (paletas `TYPE_STYLE`, `STATUS_COLOR`, `C`), no en tokens CSS: no siguen el tema claro.
- Clases que lee CSS desde JS: `estado-{normalize(estado)}`, `tone-*`, `item-state-btn active`, `equipment-option active`, `floor-btn active disabled`.
- `.tone-bad` existe en CSS pero ningún estado la usa (`En reparación` es `special`, violeta).

---

## 4. Recordatorios

### 4.1 Pantalla Recordatorios (`src/components/reminders/RemindersPage.tsx`)

**Para qué sirve:** crear avisos con fecha y hora, asignarlos a alguien por mail, vincularlos a un objeto (equipo, aula, ticket…) y completarlos, posponerlos o borrarlos.

**Quién la ve:** módulo `reminders` prendido en la sede (arranca apagado). En consulta se deshabilitan Completar, Posponer y ×; **"+ Recordatorio" y el formulario siguen habilitados** (un rol de solo lectura recibe 403 de `requireEditor` al guardar). Modificar uno existente: creador, responsable (`owner_email`), admin de sede o quien pueda editar **tareas** (`editableReminder`, `reminders.routes.js:137-155`). Ven **todos** los recordatorios activos de la sede (no solo los propios).

**Datos:**
- `GET /api/reminders` (filtros opcionales `status`, `relatedType`, `relatedId`), orden: pendientes primero, luego por `remind_at`. Caché `apiGet` normal. Sin polling.
- `POST /api/reminders`, `POST /api/reminders/:id/complete`, `POST /api/reminders/:id/postpone`, `DELETE /api/reminders/:id` (soft delete `active=0`). `PATCH /api/reminders/:id` existe y **no se usa** en la UI.
- Aviso al vencer: worker del server cada 10 s (`startNotificationWorkers`, `notifications.service.js:238-249`) → `processDueReminders` toma hasta 50 pendientes con `remind_at <= ahora` y sin `notification_sent_at`, y llama `notifyUser` al responsable (o al creador): notificación in-app (`kind 'reminder.due'`, título "Recordatorio: {título}", cuerpo descripción · objeto, link `/sede/{sede}/reminders`) + **push** + mail si el usuario lo tiene activo. Marca `notification_sent_at`. Posponer/editar lo limpia para que vuelva a avisar.
- Al crear con responsable distinto de uno mismo: `notifyUser` `'reminder.assigned'` "Te asignaron un recordatorio".

| Control | Dónde | Qué hace exactamente | Condiciones |
|---|---|---|---|
| Encabezado | `.reminders-toolbar` (`:56-64`) | "Recordatorios" + "{n} pendientes" | — |
| **+ Recordatorio** | `:61-63` | Muestra/oculta el formulario (toggle) | Habilitado incluso en consulta |
| **Qué hay que recordar** | `:67-69` | Texto `required`, `autoFocus` | — |
| **Detalle (opcional)** | `:70-72` | `<textarea>` | — |
| **Fecha y hora** | `:76-78` | **`<input type="datetime-local">` NATIVO**, `required`. Se interpreta en hora local del dispositivo y se manda en ISO UTC (`:39-43`) | Sin valor inicial |
| **Prioridad** | `:79-81` | `SelectField` Baja / Media / Alta / Urgente (default Media) | — |
| **Responsable (mail, opcional)** | `:83-85` | `<input type="email">` (validación nativa). Vacío = el creador | Sin autocompletar usuarios |
| **Relacionado con** | `:86-88` | `SelectField`: Nada en particular, Dispositivo, Aula, Ticket, Préstamo, Tarea, Compra, Sugerencia, Grupo de equipos | El server acepta además `knowledge` |
| **Identificador / Nombre para mostrar** | `:89-98` | Texto libre (placeholder "Ej. D1436, aula 2B, ticket 1520") | Solo si hay "Relacionado con". No valida que el objeto exista |
| **Cancelar** | `:100` | Oculta el form **sin limpiar el borrador** (al reabrir sigue lo tipeado) | — |
| **Guardar** | `:101-103` | Valida fecha (toast "La fecha no es válida."), crea, limpia, cierra, toast "Recordatorio guardado." | Deshabilitado sin título, sin fecha o guardando ("Guardando…") |
| Tarjeta | `.reminder-card {status}` (`:110-167`) | Badge prioridad (`Urgente` usa clase `lost`, rojo), título, descripción, "{relatedType} · {relatedLabel}" con el **tipo crudo** (`classroom`, `device`…), fecha-hora (`formatDate`). Completados con opacidad .58 y texto "Completado" | — |
| **Completar** | `:127-135` | `POST complete` → refresh. Sin confirmación, sin toast, sin catch | Pendientes; deshabilitado en consulta |
| **Posponer** | `:136-152` | `promptDialog` con **`inputType:'datetime-local'`** (nativo), valor inicial = próxima hora en punto local (`nextHourLocal`, `:175-180`) → `POST postpone` (vuelve a `pending` y reactiva el aviso). Toast de error | Deshabilitado en consulta |
| **×** | `:153-163` | `confirmDialog` "Borrar recordatorio" danger → DELETE → refresh. `aria-label` "Borrar recordatorio {título}" | Deshabilitado en consulta |

No hay: filtros (pendientes/completados/vencidos), búsqueda, edición, resaltado de vencidos, estado vacío ni loading (lista vacía sin texto). El mensaje de error de carga usa `.tool-info`.

### 4.2 Recordatorios vinculados (`src/components/reminders/RelatedReminders.tsx`)

Tarjeta embebida en la ficha de aula (`ClassroomInfoPanel.tsx:229`, `type="classroom"`, `id=roomKey`) y en el perfil de dispositivo (`src/components/devices/DeviceProfile.tsx:255`).

| Control | Qué hace | Condiciones |
|---|---|---|
| Lista (`:51-70`) | Hasta 5 recordatorios del objeto (`GET /api/reminders?relatedType&relatedId`): ✓ completado / ○ pendiente, título, fecha | Vacío: "Sin recordatorios vinculados." |
| **+ Agregar** (`:45-47`) | Dos `promptDialog` seguidos: 1) "Qué hay que recordar" (texto, botón **Siguiente**), 2) "Fecha y hora" **`datetime-local` nativo** con valor inicial = próxima hora en punto (botón **Guardar**). Crea con `relatedType/relatedId/relatedLabel` y prioridad Media; toast ok/error | Deshabilitado en consulta |
| **Completar** (`:59-66`) | `POST complete` → refresh. Botón `<button>` sin estilo de sistema | Solo pendientes y fuera de consulta |

No permite posponer ni borrar desde acá; no tiene link a la pantalla Recordatorios.

### 4.3 Recordatorios en iPhone

- **Selector de fecha:** hoy es el `datetime-local` nativo en los 3 lugares (alta, Posponer y + Agregar). En iOS Safari abre la rueda nativa de fecha+hora. Los comentarios del código (`RemindersPage.tsx:74-75`, `RelatedReminders.tsx:25-26`) documentan que antes había texto libre `"AAAA-MM-DD HH:mm"` que en Safari/iPhone daba `Invalid Date` y rompía sin aviso. **El rediseño no puede volver a un campo de texto ni a un parser propio que dependa de `new Date('YYYY-MM-DD HH:mm')`** (con espacio, Safari no lo parsea). El valor que produce el input (`YYYY-MM-DDTHH:mm`) sí lo parsea Safari como hora local.
- En iOS el `datetime-local` vacío no tiene placeholder visible y puede colapsar de alto; en el alta arranca vacío (el botón Guardar se mantiene deshabilitado hasta elegir fecha).
- `global.css:53-59` fuerza `font-size:16px` en `input/textarea/select` con `pointer: coarse` para evitar el zoom automático de iOS al enfocar.
- **Avisos en el iPhone:** dependen de la notificación in-app (campana, polling 30 s, solo con la app abierta), del **push** (en iOS solo funciona si la PWA está instalada en la pantalla de inicio, iOS 16.4+, y el usuario aceptó permisos; el `InstallBanner` no aparece en iOS porque no existe `beforeinstallprompt`, `src/components/common/InstallBanner.tsx:11`) y del mail si el usuario lo tiene activo. No hay integración con Recordatorios/Calendario de iOS ni descarga `.ics` por recordatorio.
- La única vía hacia el calendario del iPhone es el **feed ICS de la Agenda** ("Sincronizar" → copiar enlace → en iOS Ajustes › Calendario › Cuentas › Añadir calendario suscrito), que no incluye recordatorios. El modal solo explica el paso a paso de Google Calendar.

**Controles nativos o fuera de sistema a reemplazar:**
- `RemindersPage.tsx:77` `<input type="datetime-local">` (mantener comportamiento iOS si se reemplaza).
- `RemindersPage.tsx:84` `<input type="email">`.
- `RemindersPage.tsx:139` y `RelatedReminders.tsx:29` `promptDialog` con `inputType:'datetime-local'` (nativo dentro del diálogo propio, `Feedback.tsx:168`).
- `RemindersPage.tsx:71` `<textarea>`.
- `RelatedReminders.tsx:59` `<button>` crudo "Completar"; ✓/○ como caracteres.

**Mobile:** el formulario pasa de 4 columnas a 1 y las tarjetas a grilla con la columna de acciones alineada a la izquierda (`components.css:4429, 4433`). `.reminder-card-side` usa `white-space:nowrap`: vigilar desborde con fechas largas en 360 px.

**Riesgos para el rediseño:**
- `remindAt` viaja en ISO UTC; cualquier picker nuevo tiene que convertir desde hora local del dispositivo (Argentina) y no desde UTC.
- `nextHourLocal` está duplicada en ambos archivos.
- La lista de tipos relacionados vive duplicada en front (`RELATED_TYPES`) y server (`RELATED`), con diferencia (`knowledge`).
- El permiso para tocar recordatorios ajenos se apoya en el módulo **tareas** (`canEditModule(req,'tasks')`), no en `reminders`.

---

## Lista de verificación

### Agenda TIC
- [ ] Subtítulo "{n} hoy · {n} visibles · {n} pendientes" respeta el filtro de turno.
- [ ] Botón Actualizar refresca la agenda.
- [ ] Botón Sincronizar visible siempre (también en consulta).
- [ ] "+" (Nueva actividad) solo fuera de consulta; también ofrece "Sincronizar calendario".
- [ ] Selector Hoy/Lun/Mar/Mie/Jue/Vie lleva a la vista Día.
- [ ] Pestañas Día / Semana / Mes / Historial.
- [ ] Filtro de turno Completo / Mañana / Tarde afecta todas las vistas y KPIs.
- [ ] Franja "Próximas de hoy" (máx. 4, Pendiente/Entregado de hoy) y su clic vuelve a Hoy.
- [ ] 7 KPIs clicables como filtro (toggle; "Actividades" limpia), con conteos actuales (Vencidas = Pendiente con fecha+hasta pasada; Plani/TIC suman cantidades).
- [ ] Tira "Filtro activo" + Limpiar.
- [ ] Copiar resumen (fallback descarga .txt).
- [ ] Exportar CSV con BOM, columnas y fallback a todo si el filtro está vacío.
- [ ] Vista Día ordenada por hora+curso; vacío "Sin actividades en el filtro actual."
- [ ] Vista Semana Lunes–Viernes; vacío por columna.
- [ ] Vista Mes: grilla 6×7 lunes primero, hoy/seleccionado/fuera de mes, badge de cantidad, botón Hoy, panel del día seleccionado.
- [ ] Actividades semanales sin fecha aparecen en la fecha de esta semana en el Mes.
- [ ] Historial: Realizado/Cancelado ordenados por última modificación.
- [ ] "Hay N actividades terminadas de hace más de 4 meses" + Ver anteriores (carga `?all=1` y lo mantiene).
- [ ] Tarjeta: horario, turno, estado, retiradas X/Y, actividad, curso, cantidad+tipo, ubicación, nota; color por actividad; clic y Enter abren el detalle.
- [ ] Entregar ⇄ Pendiente con "Guardando...".
- [ ] Retirar/Retiradas solo con Entregado/Realizado en la tarjeta; siempre en el detalle.
- [ ] Nota (modal con textarea, Guardar nota).
- [ ] Detalle: Marcar entregado/Volver a pendiente, Marcar/Desmarcar retirada, Nota, Crear tarea (crea y navega a Tareas), Cancelar evento, Borrar con confirmación.
- [ ] Todo deshabilitado en consulta.
- [ ] Alta: Día, Turno, Desde, Hasta, Curso (obligatorio), Actividad, Tipo, Cantidad (máx 25 Touch / 99), Ubicación, Nota; defaults (Lunes, Mañana, 09:05–09:55, Glifing, Touch, 1).
- [ ] Error 409 de capacidad visible dentro del modal de alta.
- [ ] Modal Sincronizar: link ICS, Copiar, Abrir Google Calendar, Regenerar, mensajes, pasos.
- [ ] Feed `/calendar/{token}.ics` sigue funcionando sin sesión y excluye canceladas.
- [ ] Auto-refresh ~30 s sin parpadeo (sin re-render si no cambió).

### Horarios
- [ ] Pestañas Docentes / Recreos.
- [ ] Tabs de nivel con contador de horarios.
- [ ] Tarjetas "Ahora" por nivel.
- [ ] Buscador por docente, curso, materia, aula y día.
- [ ] Agrupar por docente / por curso, ordenado alfabéticamente.
- [ ] Tarjeta de grupo con días y filas por hora, "N clases", "Sin detalle".
- [ ] + Agregar horario con nivel preseleccionado; Editar; Borrar con confirmación.
- [ ] Modal: Nivel, Docente*, Curso*, Materia, Aula, Día (Lun–Dom), Desde*, Hasta* (HH:MM).
- [ ] Vacío por nivel.
- [ ] Banner "Recreo activo".
- [ ] Recreos: + Grupo, nombre, Eliminar, franjas (etiqueta, inicio, fin, ×), + Franja, Guardar cambios — solo admin de sede y fuera de consulta.
- [ ] Vacío de recreos.
- [ ] Notificación a admins al crear/editar horario y al guardar recreos.

### Estado de aulas
- [ ] Plantas por sede: NFPT (PB, 1er, 2do, Inicial "Próximamente"); NFND (PB, 1er, 2do, Inicial, SUM/Artes).
- [ ] Sede sin plano: mensaje "no configurado".
- [ ] 8 tarjetas de resumen por planta.
- [ ] Plano con colores de estado (OK/observaciones/problema/sin revisar) y punto de estado donde corresponde.
- [ ] Hover resalta aulas clickeables (y solo esas).
- [ ] Tooltip con nombre · estado (PB/2do NFPT y NFND).
- [ ] Clic en aula abre la ficha y sube al tope.
- [ ] Espacios decorativos no clickeables (baños, pasillos, escaleras, dirección, TIC NFPT, etc.).
- [ ] "Ver lista de aulas" con estado y apertura por teclado.
- [ ] IDs `room_*`, `pp_*`, `4N/4F/4S/3S`, `nd_pb_*`, `nd_p1_*`, `nd_p2_*`, `nd_ini_*`, `nd_art_*` intactos.
- [ ] Ficha: skeleton, nombre/piso, estado general en vivo, ✕, Escape, backdrop, foco atrapado.
- [ ] Diagnóstico del aula (Generar análisis, IA con fallback local, score y 4 listas).
- [ ] Incidentes: 4 KPIs, problemas frecuentes, últimos 8.
- [ ] Recordatorios vinculados del aula.
- [ ] Editar equipamiento (checkboxes, no dejar sin equipos).
- [ ] Chips de estado por equipo respetando los estados admitidos por categoría.
- [ ] Observaciones.
- [ ] Última actualización + operador.
- [ ] Guardar cambios → "Cambios guardados." y plano refrescado; Cancelar.
- [ ] Historial de cambios (20 últimos).
- [ ] Contexto del aula para el Asistente (eventos `techasset:assistant-context`).
- [ ] Administrar categorías (solo admin de sede): subir/bajar, editar nombre y estados admitidos, eliminar con confirmación, nueva categoría, cerrar.
- [ ] Migración legacy `'No encontrado' → 'Con falla'` y pisos.

### Recordatorios
- [ ] Encabezado con pendientes.
- [ ] + Recordatorio abre/cierra el form.
- [ ] Form: título*, detalle, fecha y hora* (picker que funcione en iPhone), prioridad, responsable mail, relacionado con + identificador + nombre.
- [ ] Toasts de guardado/error y validación de fecha.
- [ ] Lista: pendientes primero, prioridad (Urgente en rojo), objeto relacionado, fecha, completados atenuados.
- [ ] Completar, Posponer (picker, inicial próxima hora en punto), Borrar con confirmación.
- [ ] Deshabilitados en consulta.
- [ ] Recordatorios vinculados en ficha de aula y perfil de dispositivo: lista de 5, + Agregar en 2 pasos, Completar.
- [ ] Aviso al vencer (in-app + push + mail) y al asignar a otro.
- [ ] Posponer reactiva el aviso.

---

## Ideas de mejora (opcionales, no son parte de lo existente)

- Agenda: permitir **editar** una actividad (hoy solo borrar y recrear); agregar fecha concreta en el alta; exponer `Realizado` y `Faltaron equipos` como acciones; navegar meses; KPIs del día elegido; toast al copiar; confirmar "Cancelar evento" y "Regenerar"; corregir `todayIso` a hora local; RRULE semanal en el ICS e instrucciones para iPhone/Outlook; usar `agenda_history` en el Historial; chequear capacidad también en PATCH y excluir canceladas/realizadas; mostrar capacidad disponible al elegir tipo y horario.
- Agenda: revisar el burbujeo de eventos desde los modales portaleados de `AgendaCard`.
- Horarios: manejar errores 400 (mensajes en el modal), auto-refresh de "Ahora"/"Recreo activo", aviso de cambios sin guardar en recreos, confirmar eliminar grupo, mostrar franjas descartadas, vincular "Aula" con el padrón de `classrooms`, time picker accesible.
- Aulas: zoom/pan del plano (pinch en mobile) y foco/Enter por teclado en las aulas; resaltar el aula abierta (`selectedRoom`); tooltip en el 1er piso NFPT; tarjetas de resumen como filtro; incidentes clickeables al ticket; mostrar el último diagnóstico guardado; historial legible para `equipment`; confirmar descarte de cambios; catch del GET para no quedar en skeleton; deshabilitar "Generar análisis" en consulta; mover paletas del plano a tokens CSS (tema claro).
- Recordatorios: estado vacío y loading, filtros (pendientes/completados/vencidos), resaltar vencidos, edición (el PATCH ya existe), selector de usuario en vez de mail libre, link al objeto relacionado, label legible del tipo relacionado, deshabilitar "+ Recordatorio" en consulta, posponer rápido (+1 h, mañana 8:00), `.ics` por recordatorio para iPhone.
