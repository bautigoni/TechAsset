# Inventario 05: Tareas TIC, Traspaso, Tickets, Sugerencias, Base de conocimiento y Canvas

Relevado desde el código (rama `rediseno-grafito`, 16/10/2026). Todas las referencias son `archivo:línea`.

## Mapa del área

| Vista (`ViewKey`) | URL | Componente raíz | Módulo de sede | Prop `consultationMode` |
|---|---|---|---|---|
| `tasks` | `/sede/<sede>/tasks` | `src/components/tasks/TasksPage.tsx` | `tasks` | sí (`App.tsx:553`) |
| `tickets` | `/sede/<sede>/tickets` | `src/components/tickets/TicketsPage.tsx` | `tickets` | sí (`App.tsx:559`) |
| `suggestions` | `/sede/<sede>/suggestions` | `src/components/suggestions/SuggestionsPage.tsx` | `suggestions` | **no la recibe** (`App.tsx:555`) |
| `knowledge` | `/sede/<sede>/knowledge` | `src/components/knowledge/KnowledgePage.tsx` | `knowledge` (arranca apagado en sedes existentes) | sí (`App.tsx:560`) |
| `canvas` | `/sede/<sede>/canvas` | `src/components/canvas/CanvasPage.tsx` | `canvas` (arranca apagado en sedes existentes) | sí (`App.tsx:561`) |
| (dashboard) | — | `src/components/dashboard/DailyHandoffChat.tsx` dentro de `NowPanel.tsx:97` | escrituras protegidas como `tasks` | sí |

Comunes a todas:
- Se montan con `key={activeSite}` (`App.tsx:553-561`): cambiar de sede remonta la vista y pierde todo estado local (filtros, selección, modales abiertos, viewport del canvas).
- `effectiveConsultation = roleReadOnly || consultationMode` (`App.tsx:483`): un rol sin ningún permiso de edición entra siempre en modo consulta.
- Si el módulo está apagado o el rol no lo puede ver, `App.tsx:219-225` redirige al dashboard.
- Las vistas son lazy (`lazyView`, `App.tsx:39-47`).
- Sidebar: `Tareas TIC` (ícono `ClipboardCheck`), `Canvas` (`Shapes`), `Tickets` (`Ticket`), `Base de conocimiento` (`BookOpen`), `Sugerencias` (`Lightbulb`) — `Sidebar.tsx:50-58`.
- Notificaciones (`NotificationBell.tsx:11-19`) linkean a estas vistas según el `kind` (`task.*`, `ticket.*`, `suggestion.*`, `knowledge.created`, `canvas.created`).
- Contexto del Asistente IA: varias pantallas emiten `window` `CustomEvent('techasset:assistant-context')` y, al desmontar, `'techasset:assistant-context-clear'` (`src/hooks/useAssistantContext.ts:8-9`). Ver cada pantalla.
- **No hay menciones (@usuario)** en ningún lado del área, ni atajos de teclado propios (salvo Escape y Enter, detallados abajo).
- Atajo global que afecta al área: el lector de scanner USB de `App.tsx:314-327` captura teclas imprimibles + Enter cuando el foco **no** está en un input/textarea/select/contentEditable ni dentro de `.modal`. Si alguien tipea dígitos y Enter con el foco en una tarjeta o en el fondo, la app salta a Préstamos.

---

## 1. Tareas TIC

### 1.1 Página de tareas (`src/components/tasks/TasksPage.tsx`)

**Para qué sirve:** tablero kanban de tareas del equipo TIC por sede, con un espacio compartido y uno personal, y una vista agrupada por prioridad.
**Quién la ve:** módulo `tasks` prendido + `canViewModule`. En `consultationMode` se ocultan el "+" (GooeyMenu), los checkboxes de selección y la barra de selección; los botones de las tarjetas quedan deshabilitados (no ocultos).
**Datos:**
- Las tareas **no** se piden acá: llegan por props de `useTasks` (`src/hooks/useTasks.ts`) montado en `App.tsx:86`. `GET /api/tasks?space=all` (excluido de la caché: `NO_CACHE` en `apiClient.ts:42`). Se piden al cambiar de sede/usuario (`App.tsx:197-203`) y cada 2 vueltas del auto-refresh (~30 s, solo con la pestaña visible, `App.tsx:229-239`). `useTasks.refresh` deduplica requests en vuelo y no re-renderiza si el JSON no cambió (`useTasks.ts:16-29`).
- `GET /api/task-columns` al montar (`TasksPage.tsx:70-78`) — **sí pasa por la caché SWR de 15 s** de `apiGet` (no está en `NO_CACHE`).
- `useTasks` también pide `fetchShiftSettings` (turnos mañana/tarde) para el KPI `mine` (`useTasks.ts:33,42,109-115`). Los `kpis` se pasan a `TasksPage` pero **la página no los usa** (solo se desestructuran, `TasksPage.tsx:22`).
- El server filtra privadas ajenas (`canSeeTask`, `tasks.routes.js:371-373`) y ordena: no-hechas primero, luego más nuevas (`tasks.routes.js:33`).

**Controles:**

| Control | Dónde | Qué hace exactamente | Condiciones |
|---|---|---|---|
| Solapa "Tablero" | toolbar izq. (`TasksPage.tsx:101`) | `tab='board'`: tablero por columnas | — |
| Solapa "Prioridad" | toolbar izq. (`:102`) | `tab='priority'`: 3 columnas fijas Urgente/Media/Baja, solo tareas **no hechas** (`:86`) | — |
| Píldora animada de solapas | detrás de los botones (`:100`, `useTabPill`) | indicador deslizante del tab activo | decorativo |
| Botón "+" (GooeyMenu, se abre hacia abajo) | toolbar centro (`:107-115`) | abre abanico de 3 satélites | oculto en consulta |
| Satélite "Nueva tarea de equipo" (ícono Users) | abanico | `setSpace('team')` + abre `TaskModal` con visibilidad `team` | — |
| Satélite "Nueva tarea privada" (ícono Lock) | abanico | `setSpace('my')` + abre `TaskModal` con visibilidad `private` | — |
| Satélite "Nueva columna" (ícono Columns3) | abanico | abre modal "Nueva columna" | — |
| Toggle "Equipo" | toolbar der. (`:121`) | `space='team'`: muestra solo tareas `visibility !== 'private'` (`:81`) + analítica abajo | — |
| Toggle "Mis tareas" | toolbar der. (`:122`) | `space='my'`: privadas propias + de equipo donde `responsables` (o `responsable` CSV) incluye al **operador** (por nombre, no por mail) (`:82-83`) | — |
| Modal "Nueva columna" → input "Nombre" | modal (`:139-157`) | `autoFocus`, placeholder "Ej. En revisión"; submit vacío no hace nada | — |
| "Crear columna" / "Cancelar" | modal | `POST /api/task-columns {name}` y recarga columnas | 409 si el nombre ya existe (sin manejo, ver Estados) |
| Barra de selección flotante | portal al `body`, abajo al centro (`:159-166`) | aparece con ≥1 tarea marcada. Un botón **por columna** de la sede (verde `success` si `column.isDone`), "Borrar" (rojo) y "Limpiar" | oculta en consulta; botones `disabled` mientras `bulkBusy` |
| Botón de columna en la barra | barra | `bulkMove`: mueve **en serie** cada tarea seleccionada que no esté ya en esa columna (`onMove(id, column.name, column.id)`), toast ok `"N tareas en "<col>"."`, limpia selección (`:30-41`) | si una falla, corta el resto y muestra toast de error |
| "Borrar" en la barra | barra | `confirmDialog` con la lista de títulos separados por " · ", borra en serie con `deleteTask` directo (sin la confirmación por tarea de `useTasks.remove`), refresca, toast con las que fallaron (`:42-53`) | — |
| "Limpiar" | barra | vacía la selección | — |

**Micro-interacciones y atajos:**
- Escape o click afuera cierran el GooeyMenu (`GooeyMenu.tsx:93-106`). Los satélites tienen `aria-label` y `title` = label; `tabIndex` solo cuando está abierto. Con <2 ítems el GooeyMenu no se dibuja (`GooeyMenu.tsx:119`).
- Crear una tarea desde el "+" **cambia el espacio visible** (team/my) antes de abrir el modal.
- `useCardResize` sobre el contenedor (`:58,130`) anima la altura al cambiar `space:tab` (sin animación con `prefers-reduced-motion`).
- La selección **persiste** al cambiar de solapa o de espacio: `selectedTasks` se calcula sobre todas las tareas, así que puede incluir tareas que ya no se ven.
- No hay "seleccionar todo" ni shift+click para rango.
- El botón de refrescar se eliminó a propósito (comentario `:94-97`): la vista depende del polling.

**Estados:**
- Loading: `TaskBoardSkeleton` (3 columnas fantasma con 3 tarjetas, delays escalonados) mientras `columnsLoading` (`TaskBoard.tsx:18-31`). Reserva el alto para que la analítica no salte.
- Error de columnas: banner `tool-info` "No se pudieron cargar las columnas." (`:78,125`).
- Vista Prioridad vacía por columna: "Sin tareas".
- Toasts de lote (ok/error). Confirmación de borrado en lote con `confirmDialog` (danger).

**Controles nativos a reemplazar:** checkbox nativo de selección (`TaskCard.tsx:61`, estilizado solo con `accent-color`).

**Mobile:** `.task-space-toggle` y `.tasks-subnav` pasan a ancho 100% con `overflow-x:auto` (≤640px, `responsive.css:752`); `.tasks-primary-actions` hace wrap (≤980px, `:739`). La barra de selección flotante sube a `bottom: 88px + safe-area` para no tapar la bottom nav (`components.css:5165`).

**Riesgos para el rediseño:**
- `GooeyMenu` es una receta de transitions.dev con filtro SVG; tiene notas explícitas de cosas que **no** se pueden "prolijar" (`GooeyMenu.tsx:42-49`).
- `SelectionBar floating` se monta con portal en `body` porque un ancestro con `transform` rompe `position:fixed` (`Selection.tsx:48-50`).
- `key={activeSite}` y `animKey` (`${space}:${tab}`) controlan remontes/animaciones de entrada.

### 1.2 Tablero (`src/components/tasks/TaskBoard.tsx`)

**Para qué sirve:** columnas horizontales configurables por sede con drag & drop de tareas y de columnas.
**Datos:** columnas de `GET /api/task-columns` (orden `position, id`). Si la sede no tiene columnas, el server crea `Pendiente` (#3b82f6), `En proceso` (#f59e0b), `Hecha` (#22c55e, `is_done=1`) (`tasks.routes.js:361-369`, chequeo cacheado 10 min por sede).
- Una tarea cae en una columna si `task.columnId === column.id` o, sin `columnId`, si `task.estado === column.name` (`TaskBoard.tsx:98`). **Una tarea cuyo `estado` no matchea ninguna columna y no tiene `columnId` no se ve en el tablero.**

**Controles:**

| Control | Dónde | Qué hace exactamente | Condiciones |
|---|---|---|---|
| Fondo del tablero (arrastrar) | `.infinite-board-shell` (`:93`) | paneo horizontal tipo "mano" (`useDragScroll`): solo si el arrastre empieza en el fondo y el tablero desborda; cursor `grab`/`grabbing`, clase `is-panning` | botón izquierdo; no arranca sobre `input, textarea, select, button, a, [draggable=true], .task-card, .infinite-column-head` (`useDragScroll.ts:10`) |
| Encabezado de columna (arrastrable) | `header.infinite-column-head` (`:100`) | drag nativo HTML5 con `text/plain = "column:<id>"`; al soltarlo sobre otra columna la reubica en esa posición y llama `PATCH /api/task-columns/reorder {ids}` | `draggable` si no hay consulta y no se está renombrando esa columna |
| Grip "⠿" | head | solo indicador visual (`aria-hidden`) | — |
| Nombre + contador animado | head | `AnimatedNumber` con el total del grupo **completo** (no solo lo visible) | — |
| Borde inferior de color | head | `--column-color` desde `column.color` | color no editable desde la UI |
| "✎" Renombrar (`title="Renombrar"`) | head | cambia el head por un form con input `autoFocus` + "✓" | disabled en consulta |
| Form renombrar → submit (Enter o ✓) | head | `PATCH /api/task-columns/:id {name}`; el server además reescribe `estado` de todas las tareas de esa columna (`tasks.routes.js:225`); recarga columnas y tareas | 409 si duplica nombre; **no hay Escape ni click-afuera para cancelar** |
| "×" Eliminar (`title="Eliminar"`) | head | `DELETE /api/task-columns/:id` **sin confirmación**; el server pasa las tareas a la primera otra columna y desactiva la columna (`tasks.routes.js:230-243`) | disabled en consulta o si queda una sola columna |
| Zona de columna (drop) | `section.infinite-task-column` (`:99`) | `dragover` marca `drag-over` (borde azul + fondo); `drop` de `task:<id>` llama `onMove(id, column.name, column.id)` si cambia de columna | también acepta drops en consulta, pero nada es arrastrable |
| Placeholder "Soltá una tarea acá" | columna vacía (`:110`) | indicador | — |
| "Ver N más (M restantes)" | pie de columna (`:110-113`) | muestra 8 tarjetas más (`PAGE_SIZE = 8`, `:5`) | se reinicia al cambiar `animKey` |
| Tarjetas | stack | ver 1.3 | — |

**Micro-interacciones y atajos:**
- Drag de tareas = **HTML5 drag & drop nativo** (`draggable` + `dataTransfer`), no pointer events: en touch el soporte depende del navegador y no hay alternativa salvo la selección múltiple + barra.
- Movimiento **optimista**: `useTasks.move` aplica el cambio en el mismo frame y después hace `PATCH /api/tasks/:id`; si falla, revierte toda la lista y el tablero muestra `tool-error` arriba con el mensaje (`useTasks.ts:56-80`, `TaskBoard.tsx:85-87,92`).
- Un movimiento a la vez: si hay un PATCH en vuelo, el siguiente drop se **ignora en silencio** (`useTasks.ts:47,57`).
- La tarjeta arrastrada recibe clase `dragging` (`TaskCard.tsx:52,56`).
- Columnas entran con barrido escalonado desde la derecha (`t-stagger-x`) y las tarjetas con `t-stagger`; `key={animKey}` fuerza a repetir la animación al cambiar de espacio/solapa (`:94-105`).
- La "columna-formulario" para crear columnas se eliminó; ahora es un satélite del "+" (`:117-118`).

**Estados:** error de movimiento persistente en `tool-error` hasta el próximo movimiento exitoso. Errores de renombrar/borrar/reordenar columna: **no se capturan** (promesa rechazada sin mensaje; el form de renombrar queda abierto).

**Mobile:** columnas de 340px fijos (`components.css:4425`), el shell scrollea en X adentro (`overflow-x:auto; overscroll-behavior-x:contain`), nunca la página.

**Riesgos para el rediseño:**
- `useDragScroll` excluye por selector CSS (`.task-card`, `.infinite-column-head`, `[draggable="true"]`): si cambian las clases, el paneo se pisa con el drag & drop.
- `data-task-id` y `viewTransitionName: task-<id>` en cada tarjeta (`TaskCard.tsx:44,57`).
- El formato `"column:<id>"` / `"task:<id>"` en `dataTransfer` es el contrato entre drag de columnas y de tareas en la misma zona de drop.
- `useCardResize` pone `overflow:hidden` solo durante la animación para no recortar el fantasma del drag (`useCardResize.ts:22-23`).

### 1.3 Tarjeta de tarea (`src/components/tasks/TaskCard.tsx`)

**Para qué sirve:** muestra una tarea y permite operar subtareas, nota, comentarios, editar y borrar sin abrir un detalle.
**Datos:** `POST/PATCH/DELETE /api/tasks/:id/items[/:itemId]`, `GET/POST /api/tasks/:id/comments` (el GET de comentarios **sí** pasa por la caché SWR), y `onPatch` → `PATCH /api/tasks/:id` con la tarea completa.

**Contenido mostrado:** título; línea `responsables (o responsable) - prioridad · turno · Vence DD/MM` (`:65`); píldora de estado (con "✓ " si `done`); píldora "Privada" si `visibility==='private'`; descripción; "Nota: …" si hay `comentario`; adjuntos como links "📎 nombre" (abren en pestaña nueva, `stopPropagation`); barra de progreso propia "Subtareas d/t" con `role=progressbar` y números animados (`:74-81`); checklist de subtareas.

**Controles:**

| Control | Dónde | Qué hace exactamente | Condiciones |
|---|---|---|---|
| Checkbox de selección | junto al título (`:61`) | `selection.toggle(id)`; tarjeta con clase `is-selected` | solo si no hay consulta |
| Tarjeta entera | — | **no es clickeable** (no abre detalle); solo arrastrable | `draggable={!consultationMode}` |
| Checkbox de subtarea | checklist (`:86-94`) | `PATCH …/items/:itemId {completada}` y después **refresco completo** de tareas (no optimista) | disabled en consulta |
| "×" Quitar subtarea | checklist (`:96-103`) | `DELETE` sin confirmar + toast "Subtarea quitada: …" con **"Deshacer"** (re-crea con el mismo texto, al final y sin estado completado) | disabled en consulta |
| "+ Subtarea" | pie (`:123-125`) | muestra form inline | oculto en consulta o si la tarea está hecha |
| Input "¿Qué falta hacer?" + "Agregar" | form inline (`:112-121`) | `autoFocus`; Enter o "Agregar" → `POST …/items {texto}`, limpia y **queda abierto** para cargar otra; refresca | si se va el foco con el input vacío, el form se cierra (`onBlur`) |
| "⋯" Acciones de la tarea | esquina sup. der. (`:131-141`) | abre menú `role=menu` con transición de dropdown (`useMountTransition` 120 ms) | `aria-haspopup`, `aria-expanded` |
| Menú → "Editar" | menú | abre `TaskModal` con la tarea | disabled en consulta |
| Menú → "Nota" | menú | abre modal "Nota - <título>" con textarea (5 filas) + "Guardar nota"/"Cancelar"; guarda `comentario` vía `PATCH` | disabled en consulta |
| Menú → "Comentarios (N)" | menú | `GET …/comments` y abre modal "Comentarios · <título>"; contador animado si hay | **habilitado también en consulta** (solo lectura) |
| Modal comentarios: lista | modal | autor (nombre o mail) + fecha (`formatDate`), cuerpo con `white-space:pre-wrap`; scroll interno 45vh; vacío "Todavía no hay comentarios." | — |
| Modal comentarios: textarea + "Comentar" | modal | `POST …/comments {body}`, agrega al final, limpia, refresca tareas (para el contador) | form oculto en consulta; vacío no envía |
| Menú → "Borrar" (rojo) | menú | `useTasks.remove`: `confirmDialog` "Borrar tarea" + `DELETE /api/tasks/:id` (soft: `eliminada=1`) + refresco | disabled en consulta |

**Micro-interacciones y atajos:**
- Menú: click afuera o Escape lo cierran (`:28-40`); el contenedor del menú corta `mousedown`/`pointerdown` para no iniciar drag ni paneo (`:131`).
- `onPointerDragStart` existe como prop pero **nadie la pasa** (código muerto, `:46-50`).
- El botón "+ Subtarea" hace `stopPropagation`.
- No hay Ctrl+Enter para comentar ni Enter para enviar (es textarea).

**Estados:** sin loading en subtareas ni comentarios (la UI espera el PATCH + GET completo). Errores de subtareas/comentarios/nota: **sin manejo** (promesa rechazada, nada visible).

**Controles nativos a reemplazar:** checkboxes nativos de subtareas (`:86`) y de selección (`:61`).

**Mobile:** `.task-card { padding:14px }` (`responsive.css:632`).

### 1.4 Modal crear/editar tarea (`src/components/tasks/TaskModal.tsx`)

**Para qué sirve:** alta y edición completa de una tarea (el mismo modal, `initial` decide).
**Datos:** `GET /api/site-assistants` al abrir (personas de la sede, cacheado SWR); `POST /api/tasks/upload` para adjuntos; guarda con `useTasks.save` → `POST /api/tasks` (luego refetch) o `PATCH /api/tasks/:id` (merge de la respuesta). Emite contexto del asistente `{type:'task', id, label, data:{estado, prioridad}}` solo al editar (`:21`).

**Controles:**

| Control | Dónde | Qué hace exactamente | Condiciones |
|---|---|---|---|
| Título del modal | — | "Editar tarea" / "+ Nueva tarea" | — |
| Selector "Mi tarea / Solo visible para vos" vs "Tarea de equipo / Visible en el espacio compartido" | arriba (`:65`) | fija `visibility` (`private`/`team`) | **solo al crear**; al editar la visibilidad no se puede cambiar (el server la ignora, `tasks.routes.js:123`) |
| Título | input (`:66`) | requerido (validación nativa HTML `required`) | — |
| Descripción | textarea | libre | — |
| Chips de "Responsables" | (`:69-85`) | chips toggle con "✓"; la lista es operador actual + asistentes de la sede + los ya seleccionados; el operador lleva " (vos)" | por defecto al crear: el operador; al editar: `responsables` o el CSV legacy `responsable` |
| Resumen "Asignado a: …" | bajo los chips | "Sin asignar" / "A" / "A e B" / "A, B y C" | — |
| Prioridad | `SelectField` (`:88`) | Baja / Media / Urgente (default Media) | — |
| Turno | `SelectField` (`:89`) | Sin turno / Mañana / Tarde / Todo el día | — |
| Tipo | input con placeholder "Soporte, Aula, Agenda..." | texto libre (server default "Soporte") | — |
| Vencimiento (DD/MM) | input `inputMode=numeric`, `maxLength=5` (`:92-107`) | máscara: deja solo dígitos e inserta "/" después del 2º; muestra "Formato inválido. Usá DD/MM." en rojo | se guarda como ISO del **año actual** (`taskDate.ts:16`) |
| Comentario | textarea 3 filas | campo `comentario` (es la misma "Nota" de la tarjeta) | — |
| Adjuntos: lista con link + "×" | (`:111-113`) | quitar adjunto del borrador (no borra el archivo del disco) | — |
| "+ Adjuntar archivo" | label-botón con `<input type="file">` invisible encima (`:114-126`) | lee como dataURL, `POST /api/tasks/upload {name, mimeType, base64}`, agrega `{name,url,mimeType}`; muestra "Subiendo…"; resetea el input | `accept` png/jpeg/webp/gif/pdf/txt/doc/docx/xls/xlsx; tope `MAX_UPLOAD_MB` (10) — server responde 403 sin permiso del módulo |
| "Guardar" / "Cancelar" | pie | submit: si la fecha es inválida **no hace nada** (sin foco ni aviso extra); arma `responsables` (o `['Sin asignar']`), `assigneeEmails` (mails de los asistentes elegidos, para notificar), `responsable` CSV | — |

**Micro-interacciones:** Escape, X o backdrop cierran (Modal global con foco atrapado, `useDialogFocus`). Enter en un input envía el form.

**Estados:** "Subiendo…" en el botón de adjuntar. Error de subida o de guardado: **sin manejo** (el modal queda abierto, sin mensaje).

**Controles nativos a reemplazar:** `<input type="file">` (`:114`); validación nativa `required` (`:66`).

**Riesgos:**
- El server normaliza responsables: separa por `,`, " y ", "/" o "+", y convierte `"Ambos"` en `"Compartida"` (`tasks.routes.js:398-402`). CLAUDE.md dice que "Ambos" se guarda: **ya no es así**.
- Los avisos de asignación dependen de `assigneeEmails`, que solo se arma para personas de `site-assistants` con mail.
- Fecha `31/02` pasa la validación y se guarda como `YYYY-02-31`.

### 1.5 Vista "Prioridad" (`TasksPage.tsx:131`)

Tres columnas `task-schedule-col` (Urgente/Media/Baja) con contador animado y `TaskCard` completas (mismas acciones y selección). Solo tareas no hechas. **Una tarea con otra prioridad (p. ej. "Alta" legacy) no aparece.** Las tarjetas siguen siendo `draggable` pero no hay zonas de drop.

### 1.6 Analítica de asistentes (`src/components/tasks/TaskAnalytics.tsx`)

**Para qué sirve:** progreso por persona del espacio de equipo.
**Quién la ve:** solo con `space==='team'` (`TasksPage.tsx:133`).
**Datos:** `GET /api/site-assistants` al montar; si no hay asistentes, usa los nombres que aparecen en las tareas (`:12-14`). Calcula en el front con las tareas visibles (el endpoint `GET /api/tasks/analytics` existe pero **no se usa**).
**Contenido:** una tarjeta por persona (`assistant-progress-<index>` para el color): nombre, % hechas (o "—" sin tareas), barra, grilla Asignadas/Pendientes/En proceso/Hechas, "Sin tareas asignadas." si corresponde. Las tareas con `responsable === 'Ambos'` cuentan para todos (`:20`). Los conteos usan los estados literales `Pendiente/En proceso/Hecha`: tareas en columnas personalizadas no suman a ninguno de los tres (solo a Asignadas).

### 1.7 Endpoints de tareas (`server/routes/tasks.routes.js`)

| Método y ruta | Uso en el front | Notas |
|---|---|---|
| `GET /api/tasks?space=all\|my\|team` | `useTasks`, `CanvasPage` (`team`) | ETag (`sendWithEtag`); filtra privadas ajenas |
| `POST /api/tasks` | `TaskModal`, `App.createTaskFromAgenda` (`App.tsx:403-407`, "Revisar <curso> - <actividad>", luego navega a Tareas) | id `TK<timestamp>`; `task_history`; notifica asignados + admins si es de equipo |
| `PATCH /api/tasks/:id` | mover, editar, nota | privada solo la toca su dueño (403); historial "tarea movida"/"tarea modificada"; notifica asignados nuevos y seguidores si cambió el estado |
| `DELETE /api/tasks/:id` | borrar | soft delete |
| `POST /api/tasks/upload` | adjuntos | guarda en `data/uploads/tasks/<SEDE>/` |
| `GET/POST /api/tasks/:id/comments` | tarjeta | notifica seguidores |
| `GET/POST /api/tasks/:id/items`, `PATCH/DELETE /api/tasks/:taskId/items/:itemId` | subtareas | el DELETE es físico |
| `GET/POST /api/task-columns`, `PATCH /api/task-columns/reorder`, `PATCH/DELETE /api/task-columns/:id` | tablero | chequean `canEditModule('tasks')` |
| `GET /api/tasks/history`, `GET /api/tasks/analytics`, `GET /api/tasks/export.csv` | **sin uso en el front** | `getTaskHistory`/`getTaskAnalytics` están en `tasksApi.ts:13-14` sin consumidores |
| `/api/tareas*` | alias legacy (`:37-112`) | redirigen internamente a `/tasks` |

**Riesgo de permisos:** `POST/PATCH/DELETE /api/tasks*` (tareas, subtareas, comentarios) **no** chequean `canEditModule('tasks')` adentro y `MODULE_BY_WRITE_PREFIX` solo cubre `/tareas` e `/internal-notes` (`siteContext.service.js:220`). Hoy cualquier rol con *algún* permiso de edición puede escribir tareas. Si el rediseño toca permisos, no asumir que el server protege esto.

---

## 2. Traspaso TIC / notas internas

> CLAUDE.md dice que el Traspaso vive en una tab de `TasksPage`: **ya no**. Hoy está en el dashboard.

### 2.1 Chat "Traspaso de hoy" (`src/components/dashboard/DailyHandoffChat.tsx`, montado en `NowPanel.tsx:97`)

**Para qué sirve:** mini chat de notas del turno; arranca vacío cada día (las viejas siguen en la base).
**Quién la ve:** quien ve el dashboard. Escribir/borrar requiere edición del módulo `tasks` (`siteContext.service.js:220`); en consulta se ocultan form y "Borrar".
**Datos:** `GET /api/internal-notes?filter=active` al montar (cacheado SWR 15 s, **sin polling**), filtra en el front por `createdAt` que empiece con la fecha local de hoy (`:20-26`). `POST /api/internal-notes {texto, importante:false, operator}`; borrar = `PATCH /api/internal-notes/:id {visible:false, operator}` (soft, guarda `deleted_at/deleted_by`).

| Control | Dónde | Qué hace | Condiciones |
|---|---|---|---|
| Encabezado "Traspaso de hoy" + "N nota(s)" / "Sin notas" | arriba | contador | — |
| Burbujas | lista (`:52-63`) | texto, operador ("Sin operador"), hora `HH:MM`; clase `is-mine` si `operador === operator` | — |
| "Borrar" en cada burbuja | pie de burbuja | soft delete **sin confirmación ni deshacer** | oculto en consulta |
| Input "Dejar una nota para el turno..." + "Enviar" | form (`:66-75`) | Enter envía; "Enviar" disabled vacío o en vuelo | oculto en consulta |

**Micro-interacciones:** auto-scroll al fondo de la lista cuando cambia la cantidad (`:29`). Empty: "Todavía nadie dejó notas hoy."
**Riesgos / frágil:**
- `createdAt` es ISO UTC (`db.js:25-27`) y se compara con la fecha **local**: entre las 21:00 y las 24:00 (UTC-3) una nota recién enviada **desaparece** del chat, y las de esa franja aparecen al día siguiente.
- El server ordena `importante DESC, id DESC` (más nuevas arriba) pero el chat hace auto-scroll al fondo (a la más vieja). Verificar el orden real en pantalla antes de rediseñar.
- Errores de envío/borrado sin manejo.

### 2.2 `InternalNotesPanel` (`src/components/dashboard/InternalNotesPanel.tsx`) — código muerto

No se importa en ningún lado. Tenía filtros Hoy / Importantes / Todas / Por operador / Últimos 30 días, toggle "☆/★ Importante" (`aria-pressed`), textarea y "Borrar" con leyenda "borrada por X". Decidir si se recupera (p. ej. el flag *importante* y el historial de 30 días no tienen hoy otra UI) o se borra. El server trata `filter=all` igual que `active` (`operations.routes.js:9-14`).

---

## 3. Tickets

### 3.1 Lista de tickets (`src/components/tickets/TicketsPage.tsx`)

**Para qué sirve:** registro local de tickets externos (Tiknology/InVgate o Handing) con estado, archivo exportado, checklist, relaciones y resumen IA.
**Quién la ve:** módulo `tickets` + `canViewModule` (server 403 si no). Todas las escrituras exigen `canEditModule('tickets')` en el server. En consulta: se oculta el "+", los checkboxes y la barra; "Editar", el select de estado y "Borrar" quedan deshabilitados; "Ver detalle" sigue activo.
**Datos (al montar, sin polling):** `GET /api/tickets` (orden: No hecho, En proceso, Hecho; luego `updated_at DESC`), `GET /api/ticket-templates`, `fetchClassrooms()` (aulas para vincular), `getSiteSettings()` (clave `tickets.invgateUrl`, base del link InVgate; default `https://tikno.sd.cloud.invgate.net/requests/show/index/id/`), `fetchToolsConfig()` (`handingTicketUrl`, default `https://techasset.bauhub.online`). Todas por `apiGet` (caché SWR 15 s).

**Controles:**

| Control | Dónde | Qué hace exactamente | Condiciones |
|---|---|---|---|
| "+" GooeyMenu (abre a la izquierda) | header (`:309-315`) | satélites "Cargar ticket" (TicketPlus) y "Plantillas" (LayoutTemplate) | oculto en consulta |
| Buscador | toolbar (`:322-327`) | filtra en vivo por número, título, descripción, categoría, creado por y responsables (substring, minúsculas, **sin normalizar acentos**) | — |
| Chips de estado con contador | toolbar (`:328-340`) | Todos / No hecho / En proceso / Hecho; contadores sobre **todos** los tickets (no se ajustan al buscador ni al origen) | — |
| Chips de origen con contador | toolbar (`:341-353`) | Todos los orígenes / Tiknology / Handing (`origen` vacío cuenta como `tik`) | — |
| "N resultado(s)" | bajo toolbar | contador de lo visible | — |
| Checkbox de selección | card head (`:371-377`) | `selection.toggle(String(id))`; card `is-selected` | oculto en consulta |
| Link "#<número> ↗" / "Handing ↗" | card head (`:379`) | abre el ticket externo en pestaña nueva: InVgate = base + número solo dígitos; Handing = `handingTicketUrl` reemplazando `{ticket}` si existe, si no la base tal cual (`:183-190`) | — |
| Badge de estado | card head | `badge off` / `loaned` / `available` | — |
| Línea de origen | card | "Tiknology / InVgate · #N" o "Handing · ref" | — |
| "Cargado por X · fecha hora" | card | `creadoPor` + `formatDateTime(createdAt)` | — |
| Título, categoría | card | si existen | — |
| Descripción truncada | card (`DescriptionBox`, `:98-108`) | >120 caracteres se corta con "…"; click / Enter / Space (vía `clickableProps`) expande y contrae; `title` "Mostrar todo"/"Mostrar menos"; `aria-expanded` | — |
| Tags | card | chips | — |
| "Resumen: …" | card | `aiSummary` si existe | — |
| Archivo (compacto) | card (`FilePreview compact`) | imagen: miniatura que abre en pestaña nueva; PDF: chip "PDF · Ver PDF" que abre modal "Ticket exportado" con `<object>` embebido (sin toolbar) + "Abrir en pestaña ↗" | — |
| "Ver detalle" | acciones | abre `TicketDetailModal` | siempre |
| "Editar" | acciones | abre el modal de carga con los datos | disabled en consulta |
| Select de estado | acciones (`SelectField`, `:396`) | cambio **optimista**; si falla, toast error y recarga (`:250-259`) | disabled en consulta |
| "Borrar" (ghost danger) | acciones | `confirmDialog` "Borrar ticket #N" + `DELETE` (soft: `activo=0`, `deleted_at`, `deleted_by`) + recarga; toast si falla | disabled en consulta |
| Barra de selección flotante | portal | botones "No hecho", "En proceso", "Hecho" (verde) y "Borrar" (rojo) + "Limpiar" | oculta en consulta |
| Barra → estado | barra | optimista sobre los seleccionados; PATCH en serie solo a los que cambian; toast ok "N tickets ahora están "X"." o error con los `#N` que fallaron + recarga (`:265-277`) | — |
| Barra → "Borrar" | barra | `confirmDialog` con los `#N` separados por coma, DELETE en serie, toast de fallidos, recarga (`:278-289`) | — |

**Micro-interacciones:** grilla con `useCardResize` keyed por `filtro:origen` (se estira al cambiar de filtro, `:116,365`). Ni la card ni el número son "clickeables para detalle": el detalle se abre solo con el botón.
**Estados:** skeleton `SkeletonPanel` 3 filas de 96px mientras carga; error en `tool-error` (oculto si el modal de carga está abierto, porque comparten el mismo `error`); vacío "No hay tickets en este filtro.".
**Contenido que NO se ve en la card:** prioridad, responsables, escuela, aula. Solo aparecen al editar (y la prioridad en el detalle).
**Mobile:** chips de origen sin borde izquierdo y el selector de origen del modal a una columna (≤560px, `responsive.css:1297-1304`).

### 3.2 Modal "Cargar ticket" / "Editar ticket" (`TicketsPage.tsx:412-502`)

| Control | Qué hace exactamente | Condiciones |
|---|---|---|
| Selector de origen "Tiknology · Ticket Tik/InVgate" / "Handing · Ticket Handing" (`role=group`) | cambia `origen` y re-normaliza el número (pasar a Tik borra lo que no sea dígito) | — |
| "Usar plantilla" (`SelectField`) | elegir plantilla **pisa** título, descripción, prioridad, categoría, responsables (= responsable sugerido), checklist y tags; "Sin plantilla" solo quita el `templateId` (no limpia lo cargado) | solo al crear y si hay plantillas |
| "Número de ticket (InVgate)" / "Referencia de ticket (Handing)" | `autoFocus`; Tik: solo dígitos (se borra "#" y todo lo demás al tipear), `inputMode=numeric`, placeholder "Ej. 2103"; Handing: texto libre, placeholder "Ej. HDMI-2103"; ayuda contextual debajo | Tik obligatorio (validación front y server) |
| Estado (`SelectField`) | No hecho / En proceso / Hecho | — |
| Prioridad (`SelectField`) | Baja / Media / Alta / Urgente | — |
| "Responsables (separados por coma)" | input de texto → array | ver bug de comas |
| Escuela | texto, placeholder "Sede o escuela" | — |
| "Aula (opcional)" (`SelectField` con `hint` = piso) | vincula `classroomKey` + `classroom` (nombre); muestra "Dato anterior: X" si había un aula de texto sin key | — |
| "Tags (separados por coma)" | input → array | ver bug de comas |
| "Checklist inicial (un paso por línea)" | textarea → array | solo al crear; ver bug de saltos de línea |
| Titulo / Categoria / Descripcion | inputs (placeholders "Ej. Proyector sin imagen", "Hardware, cuenta, conectividad...", "Detalle breve del problema o pedido") | sin tildes en los labels (inconsistencia de texto) |
| "Abrir en InVgate ↗" / "Abrir en Handing ↗" | link de prueba con el número tipeado | si hay referencia |
| "Ticket exportado (PDF o foto)" → "Subir PDF / foto" / "Reemplazar archivo" | `<input type="file" class="sr-only">` dentro del label; lee dataURL y `POST /api/tickets/upload-image {fileName, dataUrl}`; "Subiendo…"; link "Abrir ↗" | `accept` pdf/png/jpg/jpeg/webp; tope `MAX_UPLOAD_MB` (413) |
| Preview grande | imagen enlazada o `<object>` PDF + "Abrir PDF ↗" | si hay archivo |
| Error | `tool-error` dentro del modal | — |
| "Guardar ticket" / "Guardando…" | valida, `POST` o `PATCH`, cierra y recarga | disabled mientras guarda o sube |
| "Cancelar" | cierra sin guardar | — |

**Riesgos / frágil:**
- **Bug de inputs "separados por coma" y "uno por línea":** el `onChange` hace `split → trim → filter(Boolean)` y se re-renderiza con `join` (`:444,452,453`). Tipear una coma o un Enter al final se borra en el acto, y también el espacio al final de una palabra: en la práctica **no se puede escribir un segundo tag/paso/responsable tipeando de corrido** (hay que pegar el texto o insertar en el medio). Lo mismo en `TicketTemplateManager` y en los tags de Conocimiento. El rediseño debería pasar a chips/lista editable.
- El `<input type="file">` no se resetea: elegir dos veces el mismo archivo no dispara nada.
- Label anidado dentro de label (`:486-494`).
- El campo `nota` existe en el modelo y se preserva al editar, pero no tiene control en la UI (el server lo usa como detalle de la actividad).

### 3.3 Detalle del ticket (`src/components/tickets/TicketDetailModal.tsx`)

**Para qué sirve:** vista completa con resumen IA, checklist, relaciones, comentarios y actividad.
**Datos:** `GET /api/tickets/:id/detail` (item + comments + activity (últimas 100) + checklist + related). Emite contexto del asistente `{type:'ticket', id, label, data:{estado, prioridad, classroom}}` (`:42-47`). Cada acción vuelve a pedir el detalle completo.

| Control | Dónde | Qué hace exactamente | Condiciones |
|---|---|---|---|
| Título "Ticket #N" (modal ancho) | — | — | — |
| Hero | arriba | eyebrow "categoría · prioridad", título, descripción ("Sin descripción."), badge de estado | — |
| "Actualizar resumen" / "Actualizando…" | card "Resumen IA · Lectura rápida" (`:83-95`) | `POST /api/tickets/:id/summary` (fuerza regeneración); muestra "Actualizado <fecha>" | disabled en consulta (aunque el server solo pide *ver*) |
| Checkbox de paso | Checklist (`:100-111`) | `PATCH …/checklist/:itemId {done}` + recarga; queda en actividad "Checklist completado/reabierto" | disabled en consulta |
| "×" de paso | Checklist | `DELETE` físico sin confirmación | disabled en consulta |
| Input "Agregar paso" + "+" | Checklist (`:124-137`) | Enter o "+" → `POST …/checklist {text}` | oculto en consulta |
| Relacionado (botón) | "Tickets relacionados" (`:144-150`) | muestra "Ticket padre / Ticket hijo / Relacionado · #N" + título; click **navega dentro del mismo modal** a ese ticket | — |
| "×" de relación | relaciones | `DELETE …/relations/:relationId` sin confirmación | disabled en consulta |
| "Ticket a vincular" (`SelectField`, placeholder "Elegí un ticket…") | form de relación | lista los tickets cargados en la página, sin el actual ni los ya vinculados | oculto en consulta |
| Tipo (`SelectField`) | form | "Relacionado" / "Es su ticket padre" (el elegido pasa a ser padre del actual) | — |
| "Vincular" | form | `POST …/relations {ticketId, relationType}` (dedup en server; notifica admins) | sin selección no hace nada |
| Lista de comentarios | "Comentarios" | autor + fecha corta | — |
| Textarea "Registrar avance o respuesta" + "Comentar" | "Comentarios" (`:203-225`) | `POST …/comments`; el primer comentario setea `first_response_at`; recarga y avisa a la lista | oculto en consulta |
| Actividad | "Actividad" (`:227-243`) | timeline: acción, detalle, fecha · actor ("Sistema") | solo lectura |

**Estados:** skeleton de 3 filas mientras carga. Errores de todas las acciones **sin manejo**.
**Mobile:** grillas del detalle a 1 columna (≤980px); form de relación y de comentarios a 1 columna (≤640px) (`responsive.css:742,757`).
**Server:** el resumen IA se encola (debounce con `setTimeout`) en cada alta/edición/comentario/checklist (`aiSummaries.service.js:8-15`); sin `OPENAI_API_KEY` usa un resumen determinístico.

### 3.4 Gestor de plantillas (`src/components/tickets/TicketTemplateManager.tsx`)

**Para qué sirve:** ABM de plantillas de incidentes frecuentes.
**Datos:** `POST/PATCH/DELETE /api/ticket-templates[/:id]` (DELETE soft, `active=0`); recarga con `GET /api/ticket-templates`.

| Control | Qué hace | Condiciones |
|---|---|---|
| Tarjeta de plantilla | título, "categoría · prioridad", descripción, "N pasos · paso · paso", tags | — |
| "Editar" | abre el form debajo de la grilla con los datos (no hace scroll hasta él) | — |
| "Eliminar" | borra **sin confirmación** | — |
| "+ Nueva plantilla" | abre form vacío | oculto mientras hay form abierto |
| Form: Título, Categoría, Descripción, Prioridad (Baja/Media/Alta/Urgente), Responsable sugerido, "Checklist (un paso por línea)", "Tags (separados por coma)" | — | mismo bug de comas/saltos de línea (`:388-413`) |
| "Guardar" / "Cancelar" | sin título no guarda (sin aviso) | — |

Solo se llega desde el satélite "Plantillas" del "+" (oculto en consulta). Errores sin manejo.

---

## 4. Sugerencias (`src/components/suggestions/SuggestionsPage.tsx`)

**Para qué sirve:** buzón de ideas votables con estados de seguimiento.
**Quién la ve:** módulo `suggestions` + `canViewModule`. **No recibe `consultationMode`**: cualquiera que la vea puede crear, votar y comentar (el router está montado antes de `requireEditor`, `server/index.js:126,134`). Cambiar estado requiere `canManage` (= `canEditModule('suggestions')`, lo devuelve el GET). Editar/borrar: autor o manager (`canEdit`/`canDelete` vienen del server).
**Datos:** `GET /api/suggestions?status&category&sort` en cada cambio de filtro (caché SWR); devuelve items, stats, categorías y `canManage`. Emite contexto del asistente `{type:'suggestion', …, data:{status, category, votes}}` con el detalle abierto (`:46-55`).

| Control | Dónde | Qué hace exactamente | Condiciones |
|---|---|---|---|
| "Nueva sugerencia" (primario) | header | abre modal vacío (categoría "General") | siempre |
| KPIs | fila | Total; Más votada (votos + título o "Sin votos"); Implementadas; Pendientes de revisión (Proposed + Under Review) | — |
| Filtro Estado (`SelectField`) | card de filtros | Todos / Propuesta / En revisión / Planificada / En progreso / Implementada / Rechazada (server en inglés, `:19-27`) | — |
| Filtro Categoría | idem | Todas + categorías existentes | — |
| Orden | idem | Más nuevas / Más votadas | — |
| Píldora de estado | card | `status-<slug>` para el color | — |
| "Estado" (`SelectField`) en la card | card (`:205-218`) | `PATCH {status}` + recarga; notifica a autor, votantes y comentaristas | solo `canManage` |
| "▲ N" (votar) | acciones | toggle **optimista** (clase `active` si votaste) + `POST /vote` + recarga; si falla, recarga | — |
| "💬 N" | acciones | abre detalle con comentarios | — |
| "Editar" | acciones | modal con título/categoría/descripción | `canEdit` |
| "Eliminar" | acciones | `confirmDialog` "¿Eliminar esta sugerencia y sus votos?" + `DELETE` (soft) | `canDelete` |
| Modal form: Título (`maxLength 180`), Categoría (input con `<datalist>` de categorías existentes), Descripción (textarea 8 filas) | modal | "Guardar"/"Guardando..." y "Cancelar" (Cancelar va primero) | — |
| Modal detalle | modal | descripción, lista de comentarios (autor, fecha, cuerpo) o "Todavía no hay comentarios." | — |
| "Comentar" textarea + "Publicar comentario" | detalle | `POST /comments`; disabled vacío o en vuelo; notifica al autor | — |

**Estados:** sin skeleton (la grilla queda vacía mientras carga); vacío "No hay sugerencias para estos filtros."; error en `tool-error`.
**Frágil:** la validación "Completá título y descripción." y los errores de guardado se muestran en el `tool-error` **de la página, detrás del modal** (`:93-95,104,190`): el usuario no los ve. El título de la notificación usa el estado en inglés ("Sugerencia: Implemented", `suggestions.routes.js:259`).
**Controles nativos a reemplazar:** `<datalist>` (`:258-263`); emojis "▲" y "💬" como íconos.

---

## 5. Base de conocimiento (`src/components/knowledge/KnowledgePage.tsx`)

**Para qué sirve:** artículos internos (HTML enriquecido) que el Asistente TechAsset consulta antes de responder.
**Quién la ve:** módulo `knowledge` + `canViewModule`; crear/editar/borrar/subir exigen `canEditModule('knowledge')`. En consulta, "+ Nuevo artículo", "Editar" y "Eliminar" quedan deshabilitados.
**Datos:** `GET /api/knowledge/articles` al montar (SWR). Emite contexto del asistente con el artículo abierto en lectura (`:23-27`).

| Control | Dónde | Qué hace exactamente | Condiciones |
|---|---|---|---|
| "+ Nuevo artículo" | hero | abre editor vacío (categoría "General") | disabled en consulta |
| Buscador `type="search"` | toolbar | filtra en el front por título, categoría, tags y texto plano (sin normalizar acentos); placeholder "Buscar procedimiento, equipo, WiFi, proyector…" | — |
| "N artículos" | toolbar | contador de visibles | — |
| Card | grilla | categoría, fecha de actualización `DD/MM/AAAA` (cortada del ISO UTC), título, 220 caracteres de texto plano + "…", tags | — |
| "Leer" | card | modal ancho con chips (categoría + tags), `<iframe sandbox="" srcDoc>` con el HTML (fondo blanco fijo, tipografía de sistema), y adjuntos "📎 nombre" | — |
| "Editar" | card | editor con el artículo | disabled en consulta |
| "Eliminar" | card | `confirmDialog` + `DELETE` (soft, `active=0`) | disabled en consulta |
| Editor: Título, Categoría, "Tags (separados por coma)" | modal ancho | mismo bug de comas | — |
| Barra de formato: "Negrita", "Cursiva", "Lista", "Título" | editor (`:187-200`) | `document.execCommand` (`bold`, `italic`, `insertUnorderedList`, `formatBlock h2`) | — |
| Área `contentEditable` | editor (`:201-211`) | HTML libre (también acepta pegado con formato); el server sanitiza (quita script/style/iframe/object/embed/form, `on*=`, `javascript:`) | — |
| Adjuntos: link + "×" | editor | quita del borrador | — |
| "+ Adjuntar" | label con `<input type="file">` transparente encima | `POST /api/knowledge/upload`; "Subiendo…" | `accept` `image/*,.pdf,.docx,.xlsx,.txt` (el server solo acepta png/jpg/webp/pdf/txt/docx/xlsx) |
| "Guardar artículo" / "Cancelar" | editor | sin título o contenido **no hace nada y no avisa** | — |

**Frágil:**
- **Solo se ven 20 artículos:** el front no manda `limit`, el endpoint usa `Number(req.query.limit || 50)` pero `searchKnowledgeArticles` lo clampa a 20 (`knowledge.service.js:10`). Con más de 20, los menos recientes no aparecen ni en la búsqueda (que es solo del front).
- El editor usa `dangerouslySetInnerHTML` + `onInput → setDraft`: en cada tecla React puede reescribir `innerHTML` y mandar el cursor al inicio. Probar a mano antes de migrar; el rediseño debería usar un editor controlado de verdad.
- `document.execCommand` está deprecado.
- Subida sin manejo de error (si falla queda "Subiendo…" hasta el `finally`, sin mensaje).
- `alt`/accesibilidad: los botones de la barra de formato no tienen estado activo.

---

## 6. Canvas (`src/components/canvas/CanvasPage.tsx`)

**Para qué sirve:** pizarra infinita compartida por sede con notas, textos, checklists, enlaces, archivos/imágenes y grupos de tareas.
**Quién la ve:** módulo `canvas` + `canViewModule`; escrituras con `canEditModule('canvas')`. En consulta: botones de alta deshabilitados, inputs/textarea/checkbox deshabilitados, nodos no arrastrables; el paneo y el zoom siguen.
**Datos:** `GET /api/canvas/items` (orden `z_index, id`) y `GET /api/tasks?space=team` una vez al montar (para los grupos de tareas). **Sin polling**: lo que otro usuario cambie no aparece hasta remontar. Cada alta notifica a los admins de la sede (`canvas.routes.js:36`).

| Control | Dónde | Qué hace exactamente | Condiciones |
|---|---|---|---|
| "Nota" | toolbar | crea `sticky` (título "Nota", texto "Nueva idea") en el centro del viewport, 260×180 | disabled en consulta |
| "Texto" | toolbar | crea `text` ("Bloque de texto") | idem |
| "Checklist" | toolbar | crea `checklist` con "Primer paso" | idem |
| "Grupo de tareas" | toolbar | crea `task-group` 380×260, título "Grupo de tareas" | idem |
| "Enlace" | toolbar | crea `link` con texto "Enlace" y URL "https://" | idem |
| "Archivo" | label con `<input type="file">` transparente | sube (`POST /api/canvas/upload`) y crea `image` (360×260) o `file` (280×140) **en la posición fija (120,120)** del mundo, no en el viewport | idem; `accept` `image/*,.pdf,.docx,.xlsx,.txt` |
| "−" / "%" / "+" | zoom (`:194-197`) | ±0.15, centrado en el medio; rango 35 %–220 % | — |
| "Centrar" | zoom | vuelve a `x:140, y:100, zoom:1` (no "encuadra" el contenido) | — |
| Fondo del lienzo (arrastrar) | `.infinite-canvas` | paneo libre con pointer capture | no arranca sobre un nodo |
| Rueda del mouse | lienzo | zoom ×0.9 / ×1.1 centrado en el cursor | ver riesgos |
| Nodo (arrastrar) | `article.canvas-node` | mueve en vivo (dividido por el zoom) y guarda al soltar | no arranca sobre `button,input,textarea,a,label`; disabled en consulta |
| Título del nodo | input en header, placeholder "Sin título" | edita `title` | — |
| "×" del nodo | header | `DELETE` soft **sin confirmación ni deshacer** | — |
| Textarea | `sticky`/`text` | edita `content.text` | — |
| Checklist: checkbox + input por paso, "+ Paso" | `checklist` | tilda/edita/agrega ("Nuevo paso"); **no se pueden borrar pasos** | — |
| Imagen | `image` | `<img object-fit:contain>` | — |
| Link "📎 nombre" | `file` | abre en pestaña nueva | — |
| Inputs texto y URL + "Abrir enlace" | `link` | sin labels ni placeholders; "Abrir enlace" va a `#` si la URL no es http(s) | — |
| `<details>` "Agregar tareas" | `task-group` | lista con checkbox de tareas de equipo **no hechas**; marca/desmarca `content.taskIds` | — |
| Lista del grupo | `task-group` | "✓"/"○", título y prioridad de cada tarea elegida; vacío "Elegí tareas para armar este grupo." | — |

**Micro-interacciones:**
- Todo cambio de nodo es optimista y se guarda con **debounce de 450 ms por nodo**, acumulando el patch; al desmontar la vista se mandan los pendientes (`:30-38,68-88`). Si un guardado falla: aviso "No se pudo guardar el cambio." y recarga.
- Colores de nota ciclan por `items.length % 5` (`#fef08a #bfdbfe #bbf7d0 #fecdd3 #ddd6fe`); los archivos quedan sin color (default `#bfdbfe`).
- Empty state centrado (no intercepta el puntero): "El canvas está vacío / Agregá una nota, un checklist, un enlace o un archivo."
- No hay: redimensionar nodos, traer al frente (z-index fijo desde el alta), selección múltiple, deshacer, atajos de teclado, pinch-zoom, persistencia del viewport.

**Mobile:** toolbar a 1 columna y botones alineados a la izquierda (≤980px, `responsive.css:735-736`). `.infinite-canvas` tiene `touch-action:none` y alto `clamp(560px, 100dvh-220px, 900px)` (`components.css:4299`): en el teléfono el dedo sobre el lienzo no scrollea la página.
**Riesgos:**
- `onWheel` hace `preventDefault()` en un listener de React, que es pasivo: probablemente la página también scrollea mientras hace zoom (verificar). En el rediseño, registrar `wheel` con `{passive:false}`.
- El fondo del lienzo usa colores fijos (`#07111f` y puntos celestes), no tokens del tema.
- Paneo con `onpointermove`/`onpointerup` asignados como propiedades del elemento (`:101-102`) y arrastre de nodos con `addEventListener` sobre el nodo con pointer capture: reescribir el markup sin respetar el `closest('.canvas-node')` rompe la separación paneo/arrastre.
- La transformación vive en `.canvas-origin` (`translate + scale`, `transform-origin:0 0`); las coordenadas de los nodos son de mundo.

---

## 7. Adjuntos y subidas (resumen transversal)

| Dónde | Endpoint | Formato del body | Tipos aceptados (server) | Carpeta |
|---|---|---|---|---|
| Tareas | `POST /api/tasks/upload` | `{name, mimeType, base64}` | png, jpg, webp, gif, pdf, txt, doc, docx, xls, xlsx | `data/uploads/tasks/<SEDE>/` |
| Tickets | `POST /api/tickets/upload-image` | `{fileName, dataUrl}` | png, jpg/jpeg, webp, pdf | `data/uploads/tickets/<SEDE>/` |
| Conocimiento | `POST /api/knowledge/upload` | `{name, mimeType, base64}` | png, jpg, webp, pdf, txt, docx, xlsx | `data/uploads/knowledge/<SEDE>/` |
| Canvas | `POST /api/canvas/upload` | `{name, mimeType, base64}` | png, jpg, webp, gif, pdf, txt, docx, xlsx | `data/uploads/canvas/<SEDE>/` |

- Todos usan `<input type="file">` nativo (oculto u opaco 0 encima de un botón), sin drag & drop de archivos ni pegado de imágenes.
- El tope es `MAX_UPLOAD_MB` (10 por defecto) sobre el binario, pero el body JSON tiene límite `max(2, MAX_UPLOAD_MB)` MB (`server/index.js:63`) y base64 infla un 33 %: en la práctica el tope real es ~7,5 MB y el error es un 413 genérico.
- `/uploads/<categoría>/<SEDE>/…` exige sesión con acceso a la sede.
- Quitar un adjunto del borrador no borra el archivo del disco.

## 8. Controles nativos o fuera de sistema a reemplazar (todo el área)

- `<input type="file">`: `TaskModal.tsx:114`, `TicketsPage.tsx:490`, `KnowledgePage.tsx:231-236`, `CanvasPage.tsx:182-191`.
- Checkbox nativo: `TaskCard.tsx:61,86`, `TicketsPage.tsx:371`, `TicketDetailModal.tsx:102`, `CanvasPage.tsx:289,379`.
- `<datalist>`: `SuggestionsPage.tsx:258-263`.
- `<details>/<summary>`: `CanvasPage.tsx:372-389`.
- `<iframe srcDoc>` con estilos fijos en claro: `KnowledgePage.tsx:132-136`.
- `<object type="application/pdf">`: `TicketsPage.tsx:69,82`.
- `contentEditable` + `document.execCommand`: `KnowledgePage.tsx:186-211`.
- Validación nativa `required`: `TaskModal.tsx:66`.
- Tooltips `title=`: "Renombrar"/"Eliminar" de columnas (`TaskBoard.tsx:100`), satélites del GooeyMenu, `DescriptionBox` (`TicketsPage.tsx:105`).
- Botones sin estilo de sistema: zoom del canvas (`CanvasPage.tsx:195-198`), "×" de columnas/subtareas/checklist/relaciones, acciones de sugerencias.
- Emojis como íconos: "📎", "▲", "💬", "✓", "○", "✎", "×", "⠿".

---

## Lista de verificación

Tareas
- [ ] Solapas Tablero / Prioridad con píldora animada
- [ ] Toggle Equipo / Mis tareas con el mismo criterio (privadas propias + asignadas por nombre)
- [ ] "+" con Nueva tarea de equipo / Nueva tarea privada / Nueva columna (y que cambie el espacio al crear)
- [ ] Skeleton del tablero mientras cargan las columnas
- [ ] Columnas por sede: crear, renombrar (reescribe el estado de sus tareas), borrar (mueve tareas a otra), reordenar arrastrando el encabezado
- [ ] No permitir borrar la última columna
- [ ] Drag & drop de tareas entre columnas, optimista con rollback y mensaje de error
- [ ] Un movimiento a la vez
- [ ] Paneo horizontal arrastrando el fondo del tablero
- [ ] Paginado de 8 tarjetas por columna con "Ver N más" y contador del total
- [ ] Placeholder "Soltá una tarea acá"
- [ ] Tarjeta: responsables, prioridad, turno, vencimiento DD/MM, estado (con ✓ si está hecha), "Privada", descripción, nota, adjuntos, progreso de subtareas
- [ ] Subtareas: tildar, agregar (input que queda abierto, se cierra al perder foco vacío), quitar con "Deshacer"
- [ ] No permitir subtareas nuevas en tareas hechas
- [ ] Menú ⋯: Editar, Nota, Comentarios (con contador, visible en consulta), Borrar (con confirmación)
- [ ] Menú se cierra con Escape y click afuera
- [ ] Modal de tarea: visibilidad (solo al crear), título requerido, descripción, chips de responsables con "(vos)" y resumen, prioridad, turno, tipo, vencimiento con máscara DD/MM, comentario, adjuntos
- [ ] Avisos a asignados (assigneeEmails) y a admins
- [ ] Vista Prioridad (Urgente/Media/Baja, sin hechas)
- [ ] Analítica de asistentes (solo en Equipo)
- [ ] Selección múltiple + mover a cualquier columna + borrar en lote con confirmación y toasts
- [ ] Barra de selección flotante sobre la bottom nav en mobile
- [ ] Crear tarea desde la Agenda ("Revisar <curso> - <actividad>")
- [ ] Polling de tareas cada ~30 s con la pestaña visible
- [ ] Modo consulta: sin "+", sin selección, acciones deshabilitadas

Traspaso
- [ ] Chat "Traspaso de hoy" en el dashboard: enviar con Enter, borrar (soft), "es mía", hora, auto-scroll
- [ ] Decidir el destino de `InternalNotesPanel` (importantes, historial 30 días)

Tickets
- [ ] "+" con Cargar ticket / Plantillas
- [ ] Buscador por número, título, descripción, categoría, creador, responsables
- [ ] Chips de estado y de origen con contadores
- [ ] Contador de resultados
- [ ] Card: link externo InVgate/Handing (con `tickets.invgateUrl` y `{ticket}`), estado, origen, creado por y fecha, título, categoría, descripción truncada expandible por teclado, tags, resumen IA, archivo
- [ ] Preview de PDF en modal y de imagen en pestaña nueva
- [ ] Cambio de estado optimista desde la card con toast de error
- [ ] Borrar con confirmación (soft)
- [ ] Selección múltiple: cambiar estado y borrar en lote
- [ ] Modal de carga: origen Tik/Handing, plantilla, número solo dígitos (Tik) / referencia libre (Handing), estado, prioridad (4), responsables, escuela, aula vinculada (con dato anterior), tags, checklist inicial, título, categoría, descripción, link de prueba, subir/reemplazar PDF o foto con preview
- [ ] Validación de número Tik obligatorio
- [ ] Detalle: resumen IA y "Actualizar resumen", checklist (tildar, agregar, quitar), relaciones (navegar, vincular como relacionado o padre, desvincular), comentarios, actividad
- [ ] Plantillas: crear, editar, eliminar, con checklist y tags

Sugerencias
- [ ] KPIs (total, más votada, implementadas, pendientes de revisión)
- [ ] Filtros por estado, categoría y orden (server)
- [ ] Votar/desvotar optimista
- [ ] Cambio de estado solo para managers (con aviso a seguidores)
- [ ] Editar/eliminar para autor o manager
- [ ] Detalle con comentarios y "Publicar comentario"
- [ ] Categoría con sugerencias de las existentes
- [ ] Mostrar los errores dentro del modal

Base de conocimiento
- [ ] Buscador + contador
- [ ] Cards con categoría, fecha, extracto y tags
- [ ] Lector aislado (sandbox) con adjuntos
- [ ] Editor enriquecido (negrita, cursiva, lista, título) con pegado de HTML
- [ ] Adjuntos
- [ ] Eliminar con confirmación
- [ ] Contexto del Asistente al leer
- [ ] Mostrar más de 20 artículos

Canvas
- [ ] Altas: nota, texto, checklist, grupo de tareas, enlace, archivo/imagen
- [ ] Paneo con el fondo, zoom con botones/rueda (35–220 %), "Centrar"
- [ ] Arrastrar nodos sin pisar inputs
- [ ] Editar título y contenido con guardado diferido (450 ms) y flush al salir
- [ ] Checklist con "+ Paso"
- [ ] Enlace con "Abrir enlace" seguro (solo http/https)
- [ ] Grupo de tareas con selector de tareas de equipo no hechas
- [ ] Borrar nodo
- [ ] Modo consulta: todo deshabilitado salvo paneo y zoom

## Ideas de mejora (opcionales, no son funcionalidad existente)

- Reemplazar los inputs "separados por coma" / "uno por línea" por chips o listas editables (hoy no se pueden tipear de corrido).
- Mostrar en la card de ticket la prioridad, los responsables y el aula.
- Abrir el detalle de tarea/ticket con click en la card (hoy solo por menú o botón).
- Confirmación o "Deshacer" al borrar columnas, nodos del canvas, plantillas, pasos de checklist y notas de traspaso.
- Escape para cancelar el renombre de columna; editar color y "columna de cierre" (`isDone`) desde la UI (el server ya lo soporta).
- Subtareas optimistas (hoy cada tilde espera el PATCH y el GET completo de tareas).
- Seleccionar todo / rango con shift en tareas y tickets.
- Alternativa táctil al drag & drop (menú "Mover a…").
- Canvas: redimensionar, traer al frente, borrar pasos, colocar archivos en el viewport, polling o tiempo real, encuadrar contenido, `wheel` no pasivo, pinch-zoom.
- Conocimiento: editor controlado (sin `execCommand`), búsqueda del server con normalización de acentos y paginado.
- Traspaso: comparar fechas en hora local (o guardar `created_at` local) y revisar el orden del chat; recuperar "importante".
- Tareas: proteger `POST/PATCH/DELETE /api/tasks*` con `canEditModule('tasks')` en el server.
- Usar `/api/tasks/analytics` y `/api/tasks/history` (existen y no tienen UI) o borrarlos.
- Traducir el estado en la notificación de sugerencias.
- Unificar tildes en los labels del modal de tickets ("Titulo", "Categoria", "Descripcion").
