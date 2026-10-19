# Inventario 02: Dashboard y Préstamos

Relevado del código en la rama `rediseno-grafito` (base `83f97e4`). Todo lo que figura acá existe hoy y tiene que seguir funcionando después del rediseño. Las rutas de archivo son relativas a la raíz del repo.

Archivos cubiertos:
- `src/components/dashboard/`: `Dashboard.tsx`, `NowPanel.tsx`, `DailyHandoffChat.tsx`, `RecentMovements.tsx`, `DailyClosurePanel.tsx` (el "cierre del día"; CLAUDE.md lo llama `DailyClosureModal`, pero el componente real es `DailyClosurePanel` y **se monta en Préstamos, no en el dashboard**), `InternalNotesPanel.tsx` (huérfano, ver abajo).
- `src/components/loans/`: `LoansPage.tsx`, `LoanForm.tsx`, `DeviceChipsPanel.tsx`, `ChipPanelKit.tsx`, `PhotoPassPanel.tsx`, `PersonSuggestInput.tsx`, `ScanMessage.tsx`, `ScannerPanel.tsx`.
- Compartidos que usa esta área: `src/components/layout/Selection.tsx`, `src/components/layout/StatCard.tsx`, `src/components/devices/DeviceTable.tsx` (en modo `dashboard`), `src/components/layout/Modal.tsx`.
- Lógica: `src/utils/deviceState.ts`, `src/utils/classifyDevice.ts`, `src/utils/normalizeSearch.ts`, `src/utils/formatters.ts` (antigüedad del préstamo).
- Cableado en `src/App.tsx` (handlers de préstamo, scanner USB global, polling, "semillas" hacia Préstamos).
- Server: `server/routes/loans.routes.js`, `server/routes/photoPasses.routes.js`, `server/routes/operations.routes.js` (notas internas y cierres), `server/routes/schedules.routes.js` (`/recess-schedules`).

---

## 0. LO MÁS IMPORTANTE: Ctrl+Click y modificadores sobre tarjetas/cartelitos

Hay **dos grillas de chips** en Préstamos con exactamente la misma mecánica: "Equipos por tipo" (`DeviceChipsPanel.tsx`) y "Cartelitos de fotos" (`PhotoPassPanel.tsx`). El handler es idéntico en las dos:

```ts
// DeviceChipsPanel.tsx:105-113  (PhotoPassPanel.tsx:106-114 es igual)
const onChipClick = (event: MouseEvent, device: Device, prestado: boolean) => {
  if (selectMode || event.ctrlKey || event.metaKey || event.shiftKey) {
    if (!selectMode) setSelectMode(true);
    toggle(device.etiqueta);
    return;
  }
  if (prestado) void returnDevices([device]);
  else onSeedCode(device.etiqueta);
};
```

### Qué hace cada gesto

| Gesto | Chip de equipo (`DeviceChipsPanel`) | Cartelito (`PhotoPassPanel`) |
|---|---|---|
| **Click simple, equipo/cartelito libre** | Carga la etiqueta en el formulario de arriba (`onSeedCode` → `LoansPage.seedLoanCode`, `LoansPage.tsx:42-46`): limpia y vuelve a setear el seed (paso por `''` + `setTimeout 0` para que reaccione aunque sea la misma etiqueta), hace `window.scrollTo({top:0, behavior:'smooth'})` y `LoanForm` pone el código y enfoca el input (`LoanForm.tsx:88-92`). **No presta**: falta completar persona/rol/ubicación. | Abre el modal "Entregar cartelito N" (`openLend([pass])`, `PhotoPassPanel.tsx:94-97,113`). |
| **Click simple, prestado** | **Lo devuelve en el acto, sin confirmación y sin deshacer** (`returnDevices([device])`, `DeviceChipsPanel.tsx:111` → `POST /api/loans/return-batch` con una etiqueta). El chip pulsa (`is-busy`) mientras tanto. Si sale bien no hay mensaje (se limpia, `:86`); solo cambia el color del chip. Si falla, cartel rojo. | **Lo devuelve en el acto, sin confirmación** (`runBatch([pass], …returnPhotoPass)`, `PhotoPassPanel.tsx:112`). |
| **Ctrl+Click** (Windows/Linux) | Si no estaba en modo selección, **lo activa solo** (`setSelectMode(true)`) y marca/desmarca ese chip. No presta ni devuelve. | Igual. |
| **Cmd+Click** (Mac, `metaKey`) | Igual que Ctrl+Click. | Igual. |
| **Shift+Click** | **Igual que Ctrl+Click** (toggle de ese chip). **No hay selección por rango**: Shift no marca "desde el último hasta este". | Igual. |
| **Click simple estando en modo selección** | Marca/desmarca (ya no presta/devuelve). | Igual. |
| **Alt+Click** | No tiene tratamiento: se comporta como click simple. | Igual. |
| **Click derecho / `onContextMenu`** | No hay handler. Menú contextual nativo del navegador. | Igual. |
| **Doble click** | No hay handler. En la práctica son dos clicks: en un equipo prestado, el primero lo devuelve y el segundo cae sobre el chip ya "busy"/deshabilitado o, si ya refrescó, sobre un chip libre (que carga la etiqueta en el form). En modo selección, doble click = marcar y desmarcar. | En un cartelito libre, el primer click abre el modal (el segundo cae en el backdrop/modal). |
| **Mantener apretado (long-press) / arrastrar** | No existe. Ni `onPointerDown`, ni `onTouchStart`, ni `draggable`. En mobile, como no hay Ctrl, la única vía a la multiselección es el botón "Varios"/"Seleccionar varios". | Igual. |
| **Teclado** | Son `<button>`: Tab + Enter/Espacio = click simple. No hay atajo de teclado propio para marcar (si el navegador propaga Shift/Ctrl al click sintético de Enter, marcaría; no está pensado ni probado). | Igual. |
| **Chip bloqueado** (no encontrado / fuera de servicio) | `disabled` → ningún gesto hace nada, ni Ctrl+Click (`DeviceChipsPanel.tsx:158,166`). | Cartelito "Perdido"/"Fuera de uso": `disabled` (`PhotoPassPanel.tsx:149,156`). |
| **`consultationMode`** | Todos los chips `disabled` (`:166`) y el toggle también. | Igual (`:136,156`). |

**Gotcha Mac:** en macOS, Ctrl+Click es "click derecho" del sistema y Chrome/Safari disparan `contextmenu` en lugar de `click`, así que en Mac el atajo que funciona es **Cmd+Click** (por eso está `metaKey`).

### Qué pasa con lo marcado

- La selección es un `Set` de etiquetas (equipos) o de números (cartelitos) en `useSelection` (`Selection.tsx:10-34`), **independiente por panel**: equipos y cartelitos tienen cada uno su selección y su barra.
- Se resuelve **contra el estado actual** en cada render (`DeviceChipsPanel.tsx:57-64`): si otro operador devolvió un equipo marcado, pasa solo de "Devolver" a "Prestar".
- Aparece la barra `SelectionBar` (`Selection.tsx:37-51`), `position: sticky; bottom: 12px` (y arriba de la barra de navegación inferior en ≤980 px, `components.css:2937-2939`), con "N seleccionados" y:
  - **Equipos:** "Prestar N" (los libres) y "Devolver N" (los prestados) (`DeviceChipsPanel.tsx:200-203`).
    - *Prestar N*: no presta directamente; manda el lote al formulario (`onBatchLend` → `LoansPage.seedLoanBatch`, `LoansPage.tsx:49-52`), que **activa el escaneo continuo**, agrega los equipos a la tabla (sin duplicar por `id`), muestra "N equipos agregados desde la grilla. Completá persona y confirmá." y **enfoca el campo Persona** (`LoanForm.tsx:96-122`). Sube la vista. Sale del modo selección.
    - *Devolver N*: si son más de 1 pide `confirmDialog` ("Devolver N equipos", lista de etiquetas, `:94`); sale del modo selección y devuelve todo en **un request** (`/api/loans/return-batch`). Resultado en cartel: "Se devolvieron N equipos." o "Se devolvieron X de N equipos. D1436: …" (`batchResultMessage`, `ChipPanelKit.tsx:97-101`).
  - **Cartelitos:** "Entregar N" (abre un modal con la fila de chips a entregar y un único formulario; el campo se llama "Responsable" en vez de "Alumno") y "Devolver N" (confirmación si >1; uno por uno en serie, refresca una vez al final, `PhotoPassPanel.tsx:65-81,99-104`).
  - "Limpiar": vacía la selección pero **deja el modo selección prendido** (`Selection.tsx:44`).
- Salir del modo: botón "Listo" (el toggle prendido) → limpia y apaga (`exitSelection`). También se sale solo después de "Prestar N"/"Devolver N" (equipos) o de una entrega en lote exitosa (cartelitos, `PhotoPassPanel.tsx:203`).
- Con modo selección prendido, cada grupo desplegado muestra "Todos"/"Ninguno" (`DeviceChipsPanel.tsx:147-151`; solo cuenta libres y prestados). Cerrar un grupo **no** borra lo marcado adentro.
- Texto de ayuda visible: "Tocá un tipo para desplegarlo. Ctrl+clic marca varios." / en modo selección "Tocá los equipos que quieras marcar." (`DeviceChipsPanel.tsx:122-124`). Los cartelitos no tienen texto de ayuda.
- Tooltips (`title=`) del chip según estado: "Touch 34 · D1436 — clic para prestar" / "… — Juan · 5F · Aula — clic para devolver" / "… — clic para marcar|desmarcar" / "… — Fuera de servicio" (`DeviceChipsPanel.tsx:168-174`; cartelitos `PhotoPassPanel.tsx:158-164`). `aria-pressed` solo en modo selección.

---

## 1. Dashboard (`src/components/dashboard/Dashboard.tsx`)

**Para qué sirve:** portada operativa: contadores de equipos que filtran la tabla, panel "Ahora" (traspaso del día + tarea prioritaria + próxima agenda), últimos movimientos y la tabla de equipos con Prestar/Devolver directos.
**Quién la ve:** todos los usuarios con sesión; es la vista por defecto y el destino de fallback cuando un módulo está apagado o sin permiso (`App.tsx:219-225`). `consultationMode` solo se pasa a `NowPanel`; **la tabla de equipos del dashboard NO lo respeta** (`Dashboard.tsx:145` no le pasa nada a `DeviceTable`): los botones Prestar/Devolver/Editar aparecen igual en modo consulta (el server después responde 403 si el rol no puede escribir).
**Datos:** todo por props desde `App.tsx:545`: `devices = filteredDevices` (**ya filtrados por el buscador del topbar**, a diferencia de Préstamos que recibe todos), `counts` (de `useDevices`), `agenda.items`, `tasks.items`, `movements`. Polling global (ver §11). `key={activeSite}`: al cambiar de sede se remonta y se pierden filtro y búsqueda.

**Controles:**

| Control | Dónde | Qué hace exactamente | Condiciones |
|---|---|---|---|
| Tarjeta "Total" | `Dashboard.tsx:113` | Filtro `all` + scroll suave a la tabla a los 40 ms (`applyDeviceFilter`, `:86-89`) | `aria-pressed` cuando activa |
| Tarjeta "Disponibles" | `:114` | Filtro `available` (por `getDeviceStateKey`) + scroll | — |
| Tarjeta "Prestados" | `:115` | Filtro `loaned` + scroll | — |
| Tarjetas por categoría | `:122-124` | Una por cada clave de `counts` que no sea `total/available/loaned/missing/out` y tenga valor > 0, orden alfabético (`:103-105`). Filtra por `filtro || categoria || classifyDeviceType || 'Otro'` (`getDashboardFilter`, `:154-156`, misma función en `useDevices.ts:119`) | — |
| (No existen) tarjetas "No encontrados" / "Fuera de servicio" | `FILTER_TITLES` `:60-66` | Los filtros `missing` y `out` están programados (título y lógica `:95-96`) pero **no hay tarjeta que los active** | — |
| Título de la tabla | `:132` | Según filtro ("Dispositivos prestados", etc.) o `Equipos <categoría>`; contador "N equipos" | — |
| Buscador "Filtrar etiqueta o alias" | `:135-142` | `input type="search"`; filtra con `matchesOperationalAlias` (`classifyDevice.ts`, acepta `D1433`, `Touch 31`, `touch31`, `31touch`, `Plani 5`, `planificación 5`, `plan 5`) y ordena con `sortByOperationalAlias` (grupo → número → etiqueta) | Tooltip `title` con ejemplos |
| Fila de la tabla | `DeviceTable.tsx:102` | Click / Enter / Espacio → abre la ficha (`onProfile` → `setProfile`) | — |
| Botón "Prestar" | `DeviceTable.tsx:137` | `openLoanFlow` (`App.tsx:456-461`): manda la etiqueta a Préstamos (seed) y cambia de vista | Solo si `getLoanState === 'available'` |
| Botón "Devolver" | `DeviceTable.tsx:138` | **Devuelve en el acto** (`returnFromTable` → `onReturn({etiqueta})` → `POST /api/loans/return`, `App.tsx:398-401`), sin confirmación, sin accesorios. Texto "Devolviendo..." y `disabled` mientras dura | Solo si `loaned`. Un solo "Devolviendo" a la vez en toda la tabla (`returningTag`) |
| Botón "Editar" | `DeviceTable.tsx:140` | Abre el modal de edición (`setEditingDevice`) | Siempre (no respeta consulta) |
| "Ficha" y "Borrar" | `DeviceTable.tsx:139,141` | **Ocultos** en `actionMode="dashboard"` | — |
| "Ver más" / "Ver todos" | `DeviceTable.tsx:156-162` | Paginado de 30 en 30 / todo. Primer pintado 12 filas, completa a 30 en idle | Si hay más filas que las mostradas |
| Badge de estado | `DeviceTable.tsx:134` | `Perdida` se muestra como "No encontrada" | — |
| Pill de antigüedad del préstamo | `DeviceTable.tsx:126-131` | "Hoy" / "1 dia" / "N dias" con tono fresh/warning/danger (`formatters.ts:90-112`) | Solo `estado === 'Prestado'` literal |

**Micro-interacciones y atajos:**
- Tarjetas de categoría con ancho calculado por `ResizeObserver` (`useCardBasis`, `Dashboard.tsx:31-58`): mín. 150 px, gap 14, máx. 6 columnas, filas parejas (6 categorías con lugar para 4 → 3+3). Escribe la variable CSS `--card-basis` que usa `components.css:3902-3933` con `flex-grow` para que la última fila llene el ancho.
- Contadores animados (`AnimatedNumber` en `StatCard.tsx`).
- Buscador del topbar con una etiqueta `D1436`: en dashboard/dispositivos hace scroll a la fila `[data-device-tag="D1436"]` y la resalta 1,6 s con `.row-highlight` (`App.tsx:273-283`). **Depende del atributo `data-device-tag` de `DeviceTable.tsx:102`.**
- Buscador del topbar con "prestar D1436" / "préstamo 1436": a los 250 ms abre Préstamos con esa etiqueta y borra la búsqueda (`App.tsx:285-296`).
- Devolver desde el dashboard **no da feedback de éxito** (la fila cambia sola tras el refresh) y **si falla no hay mensaje**: `handleReturn` usa `try/finally` sin `catch` (`DeviceTable.tsx:63-71`) y `returnFromTable` tampoco atrapa → promesa rechazada sin aviso.
- Prop `compact` se pasa (`Dashboard.tsx:145`) pero `DeviceTable` no la usa.

**Estados:** vacío "No hay equipos para este filtro." (`:147`). No hay skeleton propio (los datos llegan por props). Sin toasts ni deshacer.

**Controles nativos a reemplazar:** `input type="search"` (`Dashboard.tsx:137`, trae la "x" nativa del navegador); tooltip `title=` (`:141`); `<table>` de `DeviceTable`.

**Mobile:** ≤980 px las tarjetas principales y secundarias pasan a 2 columnas; ≤560 px a 1 (`components.css:169-170`, ojo que conviven con el `--card-basis` medido). La tabla usa `data-label` por celda para el layout apilado.

**Riesgos para el rediseño:** `data-device-tag` (scroll/resaltado desde el topbar); `ref` de la sección para el scroll al filtrar; `ResizeObserver` + `--card-basis`; la tabla no respeta `consultationMode`.

---

## 2. Panel "Ahora" (`src/components/dashboard/NowPanel.tsx`) + chat de traspaso (`DailyHandoffChat.tsx`)

**Para qué sirve:** "Traspaso del día y tu tarea prioritaria": mini chat de notas del turno de hoy, hasta 2 tareas prioritarias y la línea de próxima agenda.
**Quién la ve:** todos en el dashboard. Modo consulta: oculta el formulario del chat y los botones "Borrar" (`DailyHandoffChat.tsx:58,66`). Escribir notas en el server exige permiso de edición del módulo **`tasks`** (`siteContext.service.js:220`), no de préstamos.
**Datos:**
- `GET /api/recess-schedules` una sola vez al montar (`NowPanel.tsx:63`); usa `response.active` (recreos en curso según reloj del server, `schedules.routes.js:70`). **No se refresca**: si el dashboard queda abierto, "Recreo hasta…" queda viejo.
- Chat: `GET /api/internal-notes?filter=active` al montar y después de enviar/borrar (`DailyHandoffChat.tsx:20-28`). **Sin polling**: no ves las notas de tu compañero hasta recargar o volver a la vista. Filtra en el cliente las que `createdAt` empieza con la fecha local de hoy (`:23-24`).
- `POST /api/internal-notes` (`texto`, `importante:false`) y `PATCH /api/internal-notes/:id {visible:false}` (borrado blando).
- Tareas y agenda por props (polleadas por App).

**Controles:**

| Control | Dónde | Qué hace exactamente | Condiciones |
|---|---|---|---|
| "Ver Agenda" | `NowPanel.tsx:92` | Navega a la vista agenda | — |
| "Ver Tareas" | `NowPanel.tsx:93` | Navega a tareas | — |
| Tarjeta de tarea (botón) | `NowPanel.tsx:106-117` | `onOpenTask` si existe; el Dashboard **no lo pasa**, así que navega a Tareas (no abre la tarea puntual) | Hasta 2: primero las tuyas (match parcial, sin acentos no, por `responsable` o `responsables[]` contra el nombre del operador), por prioridad (Urgente > Media > resto) y vencimiento; si no tenés ninguna, la más urgente del equipo (`:56-82`) |
| Línea de agenda | `NowPanel.tsx:119-123` | "En curso · <curso>" / "Próxima HH:MM · <curso>" / "N pendientes en agenda hoy" / "Sin próximas actividades" | **Solo se ve si hay al menos una tarea abierta** (está dentro del bloque de tareas). Sin tareas no hay línea de agenda |
| Input "Dejar una nota para el turno..." + "Enviar" | `DailyHandoffChat.tsx:67-75` | Envía con Enter (submit) o botón; limpia y recarga | Oculto en consulta; `disabled` si vacío o enviando |
| "Borrar" en cada nota | `DailyHandoffChat.tsx:58-60` | Oculta la nota (`visible:false`) sin confirmación ni deshacer | Oculto en consulta. Cualquiera borra cualquier nota |

**Reglas de "próxima agenda"** (`NowPanel.tsx:64-77`): excluye Realizado, Cancelado y "Faltaron equipos". En curso = de hoy, `desde ≤ ahora ≤ hasta` y estado Entregado o Pendiente. Si no, la próxima de hoy en estado Pendiente. Si no, la próxima futura Pendiente ordenada por fecha → día de la semana (relativo a hoy, `weekdayRank`) → hora. "De hoy" = `fecha === hoy` o, sin fecha, `dia` == nombre de hoy sin acentos.

**Micro-interacciones:**
- Auto-scroll al final de la lista del chat cada vez que cambia la cantidad de notas (`DailyHandoffChat.tsx:29`).
- Notas propias con clase `is-mine` (alineación tipo chat) comparando `operador === operator`.
- Hora de cada nota con `formatDate(..., TIME_HM)`.
- Layout: `ahora-split` en 2 columnas; `is-solo` (chat a todo el ancho) cuando no hay tareas (`NowPanel.tsx:96`; `components.css:2998-2999`).
- "Recreo hasta 10:15 · 10:20" en el encabezado de la columna de tareas.

**Estados:** chat vacío "Todavía nadie dejó notas hoy."; contador "Sin notas" / "N notas". Errores: el `refresh` se traga el error (`.catch(() => undefined)`, `:26`) y `send`/"Borrar" usan `try/finally` sin `catch`: si falla (p. ej. 403 por no tener edición de Tareas) **no hay ningún aviso**.

**Controles nativos a reemplazar:** ninguno relevante (input de texto común).

**Mobile:** ≤900 px `ahora-split` pasa a una columna (`components.css:3035`).

**Riesgos para el rediseño:**
- "Hoy" se calcula con fecha local del navegador contra `createdAt` que el server guarda en **UTC** (`nowIso()` = `toISOString`, `server/db.js:25-27`): una nota escrita después de las 21:00 (hora argentina) queda con fecha UTC del día siguiente y **no aparece hoy; aparece al día siguiente**.
- La línea de agenda vive adentro del bloque de tareas: si se separa en el rediseño, decidir si se muestra sin tareas (hoy no).

---

## 3. Últimos movimientos (`src/components/dashboard/RecentMovements.tsx`)

**Para qué sirve:** feed de los últimos 20 movimientos de la sede (préstamos, devoluciones, altas, etc.).
**Quién la ve:** todos en el dashboard.
**Datos:** `movements` por props; `GET /api/movements` (en `NO_CACHE`, `apiClient.ts:42`), polleado cada ~15 s y forzado después de cada préstamo/devolución (`App.tsx:164-177,233,355-394`). No re-renderiza si el JSON no cambió (`movementsKey`).

**Controles:** ninguno (lista de solo lectura, sin click).

**Micro-interacciones:** traduce `prestamo`→"préstamo", `devolucion`→"devolución" (`:4-9`); muestra `fecha · tipo`, descripción, `operador · origen`.

**Estados:** vacío "Sin movimientos todavía.". Errores del fetch se ignoran (`App.tsx:173`).

**Mobile / riesgos:** lista con scroll propio (`scroll-list`). El archivo tiene BOM al inicio (línea 1).

---

## 4. `InternalNotesPanel.tsx` (huérfano)

No se importa en ningún lado (`grep InternalNotesPanel src` solo encuentra su definición). Era la pestaña "Traspaso TIC" con filtros Hoy / Importantes / Todas / Por operador / Últimos 30 días, toggle "★ Importante", `textarea` y "Borrar"; lo reemplazó `DailyHandoffChat` (comentario en `DailyHandoffChat.tsx:6-8`). **CLAUDE.md dice que se renderiza en `TasksPage`; ya no es así.** Funcionalidad perdida hoy (decidir si se quiere recuperar en el rediseño): marcar notas como importantes (el cierre del día solo cuenta las notas `importante=1`, y hoy desde la UI ninguna nota nueva nace importante), ver notas de días anteriores y filtrar por operador.

---

## 5. Préstamos (`src/components/loans/LoansPage.tsx`)

**Para qué sirve:** préstamo y devolución de equipos (uno, por escaneo continuo o por lote), grilla de equipos por tipo, cartelitos de fotos, resumen, "último día con préstamos" y lista de prestados ahora.
**Quién la ve:** vista `loans`; requiere módulo habilitado y `canViewModule` (si no, App vuelve al dashboard, `App.tsx:219-225`). Escrituras: el server exige `canEditModule('loans')` para `/loans`, `/prestamos`, `/devoluciones` y `/photo-passes` (`siteContext.service.js:216`). En el front `consultationMode` es **global** (`effectiveConsultation = roleReadOnly || consultationMode`, `App.tsx:482-483`), no por módulo: un rol que edita Tareas pero no Préstamos ve los botones habilitados y recibe 403 (el mensaje sí se muestra en el formulario).
**Datos:**
- `devices` por props: **todos** los de la sede (no los filtrados por el topbar) (`App.tsx:547`).
- `GET /api/loans/previous-day` una vez al montar (`LoansPage.tsx:54-78`); cacheado 15 s por `apiGet` (no está en `NO_CACHE`); sin polling; con "Reintentar".
- Semillas desde afuera: `initialCode` (`loanSeed` de App: scanner global, botón Prestar de dashboard/dispositivos, buscador "prestar D…") e `initialBatch` (`loanBatchSeed`: selección múltiple en Dispositivos). Al salir de la vista se olvidan (`App.tsx:463-469`).
- `key={activeSite}`: cambiar de sede remonta todo (se pierde la lista de escaneo continuo).

**Layout:** columna principal (card "Préstamo / devolución" con `LoanForm` + `DeviceChipsPanel` + `PhotoPassPanel`) y columna lateral (`loans-side-stack`: Resumen rápido, Último día con préstamos, Actualmente prestados). Desktop `1.25fr / .75fr` (`layout.css:184`).

**Controles:**

| Control | Dónde | Qué hace exactamente | Condiciones |
|---|---|---|---|
| Botón "Cierre del día" | `LoansPage.tsx:86` (card-head) | Abre el modal de cierre (§10) | — |
| Resumen rápido: Prestados / Disponibles | `:98-99` | Conteo por `getLoanState` | — |
| Resumen rápido: "Más usado" | `:100` | **Ojo: es el tipo con más equipos en total** (`countBy(devices, classifyDeviceType)`), no el más prestado | — |
| Resumen rápido: "Ubicación" | `:101` | Ubicación más frecuente entre los prestados | — |
| Chips "Tipo: N" | `:103-105` | Conteo por tipo, solo lectura (no filtran, aunque la clase se llama `loan-filter-chips`) | — |
| Card "Último día con préstamos" | `:107-155` | Ver §5.1 | — |
| Fila de esa tabla | `:138` | Click/Enter/Espacio → ficha del equipo (si la etiqueta existe en `devices`; si no, nada) | `clickableProps` con `aria-label` "Abrir ficha de D…" |
| "Reintentar" | `:118-120` | Vuelve a pedir el resumen | `disabled` mientras carga |
| Item de "Actualmente prestados" | `:159-166` | Click/Enter/Espacio → ficha | — |
| "Revisar devolución" | `:164` | `stopPropagation` + `seedLoanCode`: carga la etiqueta en el form, enfoca y sube. **No devuelve** (el form muestra los accesorios esperados y el botón Devolver) | `disabled` en consulta |

### 5.1 "Préstamos del día anterior" (card "Último día con préstamos")
- Server `GET /api/loans/previous-day` (`loans.routes.js:224-256`): toma de `loan_events` (tipo `prestamo`) de la sede el **último día anterior a hoy que tuvo préstamos** (no "ayer" estricto: después de fin de semana o feriado muestra el viernes), con zona horaria `America/Argentina/Buenos_Aires` (`localDateKey`, `:303-312`). Si nunca hubo, usa ayer. Devuelve `date` + todos los préstamos de ese día (incluye los que ya se devolvieron).
- Front: subtítulo con la fecha corta ("17 oct") o "Actualización diaria" si no hay fecha; badge con la cantidad ("..." mientras carga); tabla Hora / Equipo (etiqueta + alias) / Persona / Ubicación · curso / Motivo / Accesorios ("Sin accesorios").
- Error: mensaje amigable si el error menciona API/JSON/inválida ("No se pudo cargar el resumen de ayer. Reintentá en un momento.") + botón Reintentar (`:62-68,115-122`).
- Vacío: "Sin préstamos registrados en días anteriores."
- Protección contra desmontaje (`alive()`).

### 5.2 "Actualmente prestados"
- Muestra **los 8 más viejos** (orden por días de antigüedad desc, después `loanedAt` asc; la variable se llama `recentLoaned` pero son los más antiguos) (`:35-37`); el contador del encabezado es el total.
- Cada item: "D1436 · Touch 34", "persona · ubicación · curso" ("Sin persona"/"Sin ubicación"), "fecha/hora · antigüedad" ("Hoy", "1 dia", "N dias"; texto sin tilde y "sin antiguedad" sin diéresis, `:163`; `formatters.ts:99-105`), color por antigüedad (`loan-age-fresh|warning|danger`: 0 / 1 / ≥2 días).
- Vacío: "No hay equipos prestados ahora."

**Mobile:** <981 px todo en una columna (formulario arriba, lateral abajo). ≤700 px el item de prestados pasa a 1 columna con el botón abajo (`layout.css:1421-1428`). La tabla del día anterior tiene `min-width` 620/560 px y scrollea **dentro** de su contenedor (`responsive.css:1012-1022,1321`). Regla `.loans-layout>*{min-width:0}` (`components.css:2892`) evita que la tabla del escaneo continuo empuje la página a scroll horizontal.

**Riesgos para el rediseño:** el truco de "semilla" (`''` + `setTimeout 0`) que fuerza a `LoanForm` a reaccionar a la misma etiqueta; `initialCode={returnSeed || initialCode}` (`:88`) mezcla dos fuentes: mientras `returnSeed` tenga valor, una semilla nueva que llegue de App (p. ej. scanner global) **no** llega al formulario; `window.scrollTo` al tope (asume que el form está arriba de la página).

---

## 6. Formulario de préstamo / devolución (`src/components/loans/LoanForm.tsx`)

**Para qué sirve:** identificar un equipo (scanner USB, tipeo, QR con cámara, semilla) y prestarlo o devolverlo; o armar una lista (escaneo continuo) y prestarla de una.
**Quién la ve:** Préstamos. Consulta: Prestar/Devolver/Confirmar múltiple `disabled`; el resto (tipear, cámara, armar la lista) sigue funcionando.
**Datos:**
- `GET /api/site-settings` (vía `getSiteSettings`) al montar (`:124-126`): `loan.roles`, `loan.locations` (`{label, requiresDetail?, requiresCourse?}`), `loan.motives` (`{label, requiresDetail?}`), `loan.gradeOptions`. Defaults en `:80-83`: roles DOE/Alumno/Maestra/Profesor/Directivo/Preceptor/Otro; ubicaciones Aula (pide curso) / DOE / Planificación móvil / Otro (pide detalle); motivos Planificación / Préstamo autorizado / Otro (pide detalle); grados 1N…6S (`:31-38`) + los configurados, sin repetir y sin "EP"/"ES" (`mergeStringOptions`, `:613-623`). Si el fetch falla, se usan los defaults en silencio.
- `GET /api/loans/suggest?q=` con debounce 220 ms desde 2 letras (`:162-169`).
- `GET /api/loans/:etiqueta/accessories` cuando el equipo identificado está prestado (`:137-146`), con cancelación.
- Escrituras por props: `onLend` → `POST /api/loans/lend`, `onReturn` → `POST /api/loans/return`, `onLendBatch` → `POST /api/loans/lend-batch`. App, después de cada una: `refresh({force, wait})` de equipos + movimientos forzados (`App.tsx:355-394`). El server pisa `operator` con el usuario de la sesión (`server/index.js:103-116`).

### 6.1 Modo normal (escaneo continuo apagado)

| Control | Dónde | Qué hace exactamente | Condiciones |
|---|---|---|---|
| Input "Etiqueta 2023 o código" | `:415` | Resuelve en vivo con `resolveDeviceMatches` (memo, `:74`). Si hay exactamente 1 match, ese es el equipo. **Enter no hace nada** en modo normal (`onCodeKeyDown` sale si no es continuo, `:272-276`; el form tiene `onSubmit=preventDefault`) | `autoComplete="off"`; placeholder "Ej. D1436 o QR" |
| "Foco scanner" | `:418` | Enfoca el input de código | — |
| Vista previa (`ScannerPanel`) | `:420`, `ScannerPanel.tsx` | "D1436 · Touch 34", "Chromebook marca modelo" (fallback "Chromebook"), "Estado: … · persona". Sin equipo: "Todavía no hay dispositivo detectado." o "Hay más de un equipo posible. Especificá mejor." | — |
| Aviso de no disponible | `:77-79,429` | "D1436 está Fuera de servicio. No se puede prestar ni devolver desde esta pantalla." | Si `getLoanState` = `blocked` |
| "Prestar" | `:554` | `handleLend` (`:187-208`): valida, envía, muestra resultado con tilde animado y **resetea todo** | Solo si el equipo está disponible. `disabled` en consulta o busy ("Prestando...") |
| "Devolver" | `:555` | `handleReturn` (`:210-226`): sin validaciones de persona; manda `returnedAccessories`; resetea | Solo si está prestado ("Devolviendo...") |
| "Abrir cámara" / "Cerrar cámara" | `:556-557` | Ver §6.4 | `disabled` según estado |
| Persona (con sugerencias) | `:466-489` | Ver §6.3 | — |
| Rol | `:490` | `SelectField` (custom), placeholder "Seleccionar rol" | — |
| Ubicación | `:493` | `SelectField`, placeholder "Seleccionar ubicación" | — |
| Motivo | `:494` | `SelectField` con opción "Sin motivo" (vacío) | Opcional |
| Nivel (EP/ES) | `:498` | `SelectField` | Solo si la ubicación tiene `requiresCourse` |
| Grado / Año / Curso | `:499` | `SelectField` con los grados | Ídem |
| Especificar ubicación | `:500` | input | Si la ubicación tiene `requiresDetail` |
| Especificar motivo | `:501` | input | Si el motivo tiene `requiresDetail` |
| Comentario | `:504` | input opcional | — |
| Accesorios entregados originalmente | `:505-516` | Lista de toggles (role=switch) con lo que se registró al prestar; se marca solo lo que vuelve. "No es obligatorio." Vacío: "No se registraron accesorios para este préstamo." | Equipo prestado y modo normal |
| Accesorios de entrega (desplegable) | `:517-544` | Botón con chevron "⌄" que abre: toggles de Cargador, Mouse, Bolso, Cable HDMI, Adaptador, Lápiz óptico, Auriculares (`:40`) + los que agregues; input "Agregar otro accesorio" + "Agregar" | Equipo disponible **o** escaneo continuo |

### 6.2 Escaneo continuo (scanner USB / Enter)

| Control | Dónde | Qué hace exactamente | Condiciones |
|---|---|---|---|
| Switch "Escaneo continuo" (Activado/Desactivado) | `:430-434` | Prende: mensaje "Escaneo continuo activado. Escaneá los equipos uno detrás del otro." y foco al input. Apaga: igual que "Cancelar escaneo continuo" | `role="switch"`, `aria-checked` |
| Input de código + **Enter** | `:272-276` | Agrega a la lista (`addToContinuousScan`, `:239-270`), limpia el input y re-enfoca: lo que hace un scanner USB que termina en Enter | — |
| "Agregar a lista" | `:417` | Igual que Enter | `disabled` si el input está vacío |
| Mensaje del escaneo | `:438` | Ver `ScanMessage` (§6.5) | — |
| Resumen | `:439-443` | Total / Disponibles / Con error | — |
| Tabla de la lista | `:444-461` | Etiqueta, Alias, Tipo, Estado, Disponible ("Sí" o "No disponible (estado)"); fila roja `row-error` si no está disponible | Vacío: "Aún no escaneaste ningún equipo." |
| "Quitar" por fila | `:455` | Saca ese equipo de la lista | — |
| "Confirmar préstamo múltiple (N)" | `:548` | `handleConfirmMultipleLoan` (`:378-409`): mismas validaciones que el préstamo suelto; **un solo request** con las etiquetas disponibles; mensaje "Se prestaron N equipos correctamente." o "Se prestaron X de N. Errores: D…: …"; quita de la lista **todos** los disponibles (también los que fallaron; los errores solo quedan en el mensaje) y limpia persona/rol/ubicación/etc. (**no** limpia los accesorios marcados) | N = disponibles; `disabled` en consulta, busy o N=0 |
| "Limpiar lista" | `:549` | Vacía lista y mensaje, sin confirmar | `disabled` si vacía o busy |
| "Cancelar escaneo continuo" | `:550` | Si hay items: `confirmDialog` "Salir del escaneo continuo — Hay N equipos en la lista. ¿Los conservás para la próxima vez?" con **"Conservar lista"** / **"Vaciar lista"**; apaga el modo (`:292-298`) | — |

Validaciones al agregar (`:239-270`):
- Sin match → error "No se encontró ningún equipo para "X"."
- Varios matches → aviso "Hay más de un equipo posible para "X". Especificá mejor."
- **Duplicado** (mismo `id` ya en la lista) → aviso "D1436 ya estaba en la lista." (no se agrega).
- **No disponible** → se agrega igual, marcado en rojo, aviso "Agregado con error: D1436 (Prestado)"; no se presta al confirmar.
- OK → "Agregado: D1436".
- Lote que llega desde la grilla o desde Dispositivos (`batchSeed`): deduplica por `id` en silencio y descarta etiquetas que no existen (`:96-122`).

En modo continuo se ocultan la vista previa, el aviso de no disponible, la cámara y los botones Prestar/Devolver (`:420-429,546-559`).

### 6.3 Sugerencias de persona ("recordar última persona/ubicación")
- **No hay `localStorage` ni "última persona usada"**. Después de cada préstamo/devolución el form se resetea por completo (`reset`, `:154-159`) y vuelve el foco al código.
- Lo que hay es un **recomendador por historial**: al tipear ≥2 letras en Persona aparece una lista (`loan-suggest`, máx. 8) con nombre, "rol · ubicación" y "N×" (veces). El server (`loans.routes.js:187-222`) agrupa `loan_events` por nombre normalizado (sin acentos/mayúsculas/espacios dobles), ordena por cantidad y último uso y devuelve el **rol, ubicación, curso y motivo más usados** por esa persona.
- Elegir una sugerencia (`applySuggestion`, `:172-185`) completa Persona y **pre-rellena rol, ubicación y motivo** (solo si el valor existe en las opciones actuales) y nivel/curso (parte "EP · 5F").
- La lista se abre al enfocar/tipear y se cierra con blur demorado 150 ms (para que el click llegue); los items usan `onMouseDown` + `preventDefault` (`:471-483`).
- Las únicas cosas que sí se recuerdan: qué paneles de chips dejaste abiertos (`localStorage['techasset_loans_open_panels']`, §9) y la lista del escaneo continuo si elegís "Conservar lista" (solo en memoria: se pierde al cambiar de vista o de sede).

### 6.4 Cámara / QR
- `openCamera` (`:313-338`): exige `getUserMedia` y contexto seguro (HTTPS o localhost); prefiere la cámara trasera (`facingMode: environment`, fallback a cualquier cámara, `:584-593`).
- Si el navegador no tiene `BarcodeDetector`: aviso "El escaneo QR no está disponible en este navegador. Podés ingresar el código manualmente." (la cámara queda como apoyo visual).
- Loop con `requestAnimationFrame` (`:349-376`): al leer un QR nuevo lo parsea (`parseScannedCode`), lo pone en el input, mensaje "QR detectado: D1436", **cierra la cámara** y enfoca el input. Se libera la cámara al desmontar (`:128`).
- Formatos de QR aceptados (`normalizeSearch.ts:5-20`): JSON con `etiqueta|id|codigo|code`, URL/query `etiqueta=…`, QR viejo `TA|D1436|…`, o cualquier texto con `D 0*NNNN`.

### 6.5 Mensajes (`ScanMessage.tsx`)
- Tonos info/warn/error (`tool-info`, `tool-warning`, `tool-error`). Cada mensaje nuevo **entra animado** (`t-msg-enter`) y los de error **sacuden** (`t-input is-shaking`, receta `error-state-shake`); el `key` = tono+texto remonta el nodo para re-animar aunque se repita el tono. `role="alert"` para errores, `status` para el resto.
- El éxito de Prestar/Devolver lleva un **tilde que se dibuja** (`SuccessCheck`, receta `success-check`), solo ahí. Si el server dijera `synced:false` el tono pasa a warn sin tilde (hoy el server siempre responde `synced:true`).

### 6.6 Validaciones (front vs server)
| Regla | Front (`LoanForm.tsx:228-237`) | Server (`loans.routes.js:333-340`) |
|---|---|---|
| Persona obligatoria | Sí | Sí |
| Rol obligatorio | Sí | Sí |
| Ubicación obligatoria | Sí | Sí |
| Nivel EP/ES y curso | Si la ubicación tiene `requiresCourse` (configurable) | **Solo si la ubicación se llama literalmente "aula"** |
| Detalle de ubicación/motivo | Si `requiresDetail` | No se valida |
| Equipo disponible para prestar | Botón solo aparece si `available` | 409 "… está X y no se puede prestar." |
| Devolver algo que no está prestado | Botón solo aparece si `loaned` | Idempotente: `ok:true` + "ya estaba disponible. No se registró otra devolución." |
| Doble envío | `busyRef` (`:67,188,211`) | — |
| Lote | Mismas validaciones que el suelto | Dedup + máx. 300 etiquetas (`:76-79`); cada equipo se resuelve aparte; uno que falla no frena al resto |

**Toasts con deshacer:** **no hay ninguno en Préstamos ni en el Dashboard.** Todo el feedback es por carteles en línea (`ScanMessage`, `tool-info/warning/error`). Prestar, devolver (incluido el click en un chip prestado y el "Devolver" del dashboard) no tienen deshacer; para revertir hay que prestar de nuevo a mano. Los únicos toasts con "Deshacer" de equipos están en Dispositivos (`DevicesPage.tsx:89`, `DeviceBulkBar.tsx:94`).

**Controles nativos a reemplazar:** `<video>` de la cámara (`:423`); `<table>` del escaneo continuo; chevron como carácter "⌄" (`:529`); el `<form>` envuelve todo sin botón submit (Enter suelto no envía). Los selects ya son `SelectField`.

**Mobile:** ≤980 px `.scan-input-row` y `.grid-2` a una columna (`components.css:64-65`). La tabla del continuo: `max-height: 260px; overflow: auto` (`components.css:2110`).

**Riesgos para el rediseño:**
- `codeInputRef` y `personInputRef`: se enfocan programáticamente (semilla, lote, reset, QR, Enter). Si el input deja de ser el mismo nodo, se rompe el flujo de scanner.
- Enter solo agrega en modo continuo; en modo normal un scanner que manda Enter no hace nada, y el siguiente escaneo **se concatena** al código que quedó en el input (no se limpia si no se prestó/devolvió).
- Las opciones dependen de settings de la sede con formato flexible (string u objeto `{label|nombre, activo}`).
- Divergencia de validación de curso entre front y server (arriba).

---

## 7. Equipos por tipo (`src/components/loans/DeviceChipsPanel.tsx`)

**Para qué sirve:** grilla de todos los equipos agrupados por tipo operativo, cada uno un chip con su número; operar con un click o en lote.
**Quién la ve:** Préstamos, debajo del formulario. Consulta: chips y toggle `disabled`.
**Datos:** sin API propia; dibuja `devices` (props) y usa `onReturnBatch` (→ `POST /api/loans/return-batch`) y las semillas del form. Se actualiza con el polling global.

**Controles:**

| Control | Dónde | Qué hace exactamente | Condiciones |
|---|---|---|---|
| Toggle "Seleccionar varios" / "Listo" | `:126-130`, `ChipPanelKit.tsx:82-94` | Prende/apaga modo selección; apagar limpia lo marcado | `disabled` en consulta. Siempre visible (en el encabezado general) |
| Encabezado de cada grupo (desplegable) | `:139-152`, `ChipPanelKit.tsx:35-77` | Abre/cierra. Muestra chevron, nombre del tipo, barra de proporción prestados/total y "**P**/T prestados" | Arranca cerrado; recuerda el estado (§9) |
| "Todos" / "Ninguno" por grupo | `:147-151` | Marca/desmarca todos los libres+prestados del grupo | Solo en modo selección y con el grupo abierto |
| Chip de equipo | `:162-178` | Ver §0. Muestra el número operativo (o la etiqueta si no tiene, chip ancho `is-wide`) | Clases: `is-prestado` (amarillo), `is-bloqueado` (rayado, punteado), `is-selected` (azul), `is-busy` (pulsa) |
| Lista de prestados del grupo | `:182-196` | Número, persona, curso (`<em>`), ubicación (`<i>`), hora del préstamo | Solo si hay prestados |
| Barra de selección | `:200-203` | "Prestar N" / "Devolver N" / "Limpiar" | Ver §0 |

**Orden:** grupos por cantidad de equipos desc y luego nombre (no cambia al prestar, para que no salten mientras operás) (`:36-55`); dentro del grupo por número operativo y luego etiqueta (numérico). Grupo = `getOperationalGroup` (`classifyDevice.ts`); sin tipo → "Otro". Si no hay equipos, el panel no se renderiza.

**Estados:** cartel en línea (no toast) arriba de los grupos: error de devolución individual, o resumen del lote ("Se devolvieron N equipos." / "Se devolvieron X de N equipos. …"). Éxito individual: sin cartel.

**Controles nativos a reemplazar:** tooltips `title=` (`:168-174`); `<ul>/<em>/<i>` con estilo semántico raro.

**Mobile:** ≤640 px chips de 40×40, se oculta la barra de proporción y el texto "prestados", el toggle dice "Varios" (`components.css:2940-2949`; ojo: la regla de "Varios" está scoped a `.chip-panel` y el toggle de equipos vive en `.chip-stack-head`, fuera de un `.chip-panel`, así que en equipos sigue diciendo "Seleccionar varios" en mobile; solo el de cartelitos pasa a "Varios"). Barra de selección arriba de la navegación inferior.

**Riesgos para el rediseño:** `busyTags` por etiqueta; la selección por `etiqueta` (no `id`); el `disabled` de los chips bloquea también Ctrl+Click; `aria-pressed` solo en modo selección.

---

## 8. Cartelitos de fotos (`src/components/loans/PhotoPassPanel.tsx`, `PersonSuggestInput.tsx`)

**Para qué sirve:** cartelitos numerados que autorizan a un alumno a usar el celular para fotos: entregar (alumno + curso + docente) y devolver.
**Quién la ve:** Préstamos, debajo de la grilla de equipos. Consulta: chips y toggle `disabled`. Server: permiso `loans`.
**Datos:**
- `GET /api/photo-passes` al montar y después de cada acción propia (**sin polling**; cambios de otro operador no se ven hasta remontar). La primera vez que una sede los pide, el server **crea del 1 al 30** (`photoPasses.routes.js:37-57`).
- `GET /api/photo-passes/options` al montar (cursos de `loan_events` + `photo_pass_events` + `loan.gradeOptions`; docentes de horarios + préstamos + cartelitos, filtrando basura tipo "123").
- `GET /api/photo-passes/suggest?field=alumno|docente&q=` (debounce 220 ms, ≥2 letras) desde `PersonSuggestInput`.
- `POST /api/photo-passes/:numero/lend` (`persona`, `curso`, `docente`, `motivo`) y `POST /api/photo-passes/:numero/return`. 409 si ya estaba prestado / no estaba prestado.
- Existen en API pero **no tienen UI**: `POST /photo-passes/generate` (alta por rango hasta 500), `PATCH /photo-passes/:numero` (estado Perdido/Fuera de uso, notas), `DELETE`, `GET /:numero/history` (`photoPassesApi.ts:77,87-89`). Hoy no se puede marcar un cartelito como perdido ni agregar el 31 desde la app.

**Controles:**

| Control | Dónde | Qué hace exactamente | Condiciones |
|---|---|---|---|
| Encabezado desplegable "Cartelitos de fotos" | `:121-141` | Abre/cierra; "**P**/T entregados"; "…" mientras carga | Recordado en localStorage (`id="photo-passes"`) |
| "Todos"/"Ninguno" | `:131-133` | Marca/desmarca todos los seleccionables | Modo selección |
| Toggle "Seleccionar varios"/"Varios"/"Listo" | `:134-138` | Igual que en equipos, **pero vive en el `extra` del panel: solo se ve con el panel abierto** (`ChipPanelKit.tsx:70`) | `disabled` en consulta o cargando |
| Chip de cartelito | `:152-168` | Ver §0 | — |
| Lista de entregados | `:172-186` | Número, alumno, curso, "con <docente>", hora | — |
| Barra de selección | `:188-191` | "Entregar N" / "Devolver N" / "Limpiar" | — |
| Modal "Entregar cartelito N" / "Entregar N cartelitos" | `:193-252` | Vista previa de los chips (lote); **Alumno** (o "Responsable" en lote) con `autoFocus` y sugerencias; Curso (`input list=` + `<datalist>`); Docente a cargo (sugerencias); Motivo opcional; "Entregar"/"Entregar N"/"Entregando..." y "Cancelar" | Entregar `disabled` sin nombre o busy |
| Sugerencia de alumno | `:214-227`, `PersonSuggestInput.tsx` | Muestra nombre, "curso · docente" y "N×"; elegirla **completa curso y docente** con los que suele venir, sin pisar lo ya escrito | — |

**Micro-interacciones:** skeleton de chips con la última cantidad conocida (variable de módulo `ultimoTotalConocido`, arranca en 30) con retardo escalonado (`:27-32,144-146`); lote = una llamada por cartelito en serie, sigue aunque alguno falle, refresca una vez (`:65-81`); Modal cierra con Escape, X o click en el backdrop (`Modal.tsx`), foco atrapado.

**Estados:** error de carga "No se pudieron cargar los cartelitos."; mensajes de lote como en equipos ("Se entregaron N cartelitos." / "Se devolvieron X de N cartelitos. 7: …").

**Controles nativos a reemplazar:** `<datalist id="pass-cursos">` (`:231-232`), justamente lo que `PersonSuggestInput` ya reemplazó para personas; tooltips `title=` (`:158-164`).

**Riesgos para el rediseño:** el toggle de selección escondido con el panel cerrado; `ultimoTotalConocido` global de módulo; números como clave de selección (`String(numero)`).

---

## 9. Piezas compartidas de las grillas (`ChipPanelKit.tsx`, `layout/Selection.tsx`)

- `CollapsiblePanel` (`ChipPanelKit.tsx:35-77`): botón con `aria-expanded`; **monta el contenido recién la primera vez que se abre** (antes estaban todos los chips en el DOM); para que la primera apertura anime, monta cerrado y abre en el segundo `requestAnimationFrame` (`:51-57`). Animación de alto con `grid-template-rows: 0fr → 1fr` sin medir en JS (`components.css:2898-2899`); cuerpo `inert` cuando está cerrado. `extra` (botones de la derecha) **solo se renderiza con el panel abierto**.
- `usePanelOpen` (`:22-33`): recuerda abierto/cerrado por id en `localStorage['techasset_loans_open_panels']` (ids `devices:<Tipo>` y `photo-passes`); tolera modo privado.
- `useSelection` / `SelectionBar` (`Selection.tsx`): ver §0. `floating` (portal al body) **no se usa acá**: en Préstamos la barra es `sticky` dentro de su bloque.
- `prefers-reduced-motion`: sin transiciones del panel ni animación de la barra/pulso (`components.css:2950-2953`).

---

## 10. Cierre del día (`src/components/dashboard/DailyClosurePanel.tsx`)

**Para qué sirve:** generar y guardar un resumen de texto del día con observaciones del operador.
**Quién la ve:** **botón en el encabezado de la card de Préstamos** (`LoansPage.tsx:86`), no en el dashboard. Consulta: "Generar cierre" `disabled`; Copiar funciona. Server: `POST /daily-closures` solo pasa por `requireEditor` (no está en el mapa de módulos).
**Datos:** al abrir el modal, en paralelo `GET /api/daily-closures/preview` y `GET /api/daily-closures` (últimos 100) (`:16-22`); `POST /api/daily-closures` con `operator`, `observaciones`, `resumen`.

**Controles:**

| Control | Dónde | Qué hace exactamente | Condiciones |
|---|---|---|---|
| "Cierre del día" | `:28` | Abre el modal "Cierre del día TIC" | — |
| Vista previa | `:32` | `<pre>` con el texto armado en el cliente (`renderClosureText`, `:56-78`): fecha, operador, préstamos activos, no devueltos, tareas pendientes/en proceso/hechas hoy, agenda del día, canceladas, con faltantes, aulas con problemas, notas importantes, observaciones. Skeleton de 180 px mientras carga | Se actualiza en vivo al escribir observaciones |
| "Observaciones manuales" | `:33` | `textarea` 4 filas | — |
| "Copiar" | `:35` | `navigator.clipboard.writeText` (no usa `copyToClipboard` de Feedback) y muestra "Copiado al portapapeles." | `disabled` sin texto |
| "Generar cierre" | `:36-40` | Guarda, muestra "Cierre guardado." y recarga historial. Se puede generar varias veces el mismo día (no hay dedupe) | `disabled` en consulta o sin resumen |
| "Historial (N)" | `:43-48` | `<details>` con "fecha · operador" por cierre; **no se puede abrir un cierre viejo** ni ver sus observaciones | — |

**Estados:** error al cargar → toast de error (`:22`). **Error al guardar → nada** (`await` sin `try/catch`, viola la regla de no tragarse errores). Las observaciones no se limpian después de guardar.

**Controles nativos a reemplazar:** `<details>/<summary>` (`:43-44`), `<textarea>` (`:33`), `<pre>` (`:32`).

**Riesgos / bugs a no "heredar" sin querer:**
- **"Préstamos activos" y "Dispositivos no devueltos" salen de la tabla legacy `prestamos`** (`operations.routes.js:133-137`), que el flujo actual de préstamos **no escribe** (`registerLend` escribe `local_states`, `local_movements` y `loan_events`, `loans.routes.js:85-114`). Lo más probable es que el cierre muestre 0 / "Sin datos" aunque haya equipos prestados.
- "Hoy" del cierre es la fecha **UTC** (`new Date().toISOString().slice(0,10)`, `operations.routes.js:126`): después de las 21:00 (AR) cuenta el día siguiente.
- Notas importantes: solo `importante=1` de hoy, y hoy la UI no crea notas importantes (§4).

---

## 11. Comportamientos globales que afectan a esta área (`src/App.tsx`)

- **Scanner USB global** (`App.tsx:298-334`): con sesión iniciada, cualquier tecleo **fuera de un input/textarea/select/contentEditable y fuera de un `.modal`** se acumula en un buffer; se vacía con Enter o a los **120 ms** sin teclas. Si lo leído (pasado por `parseScannedCode`) tiene ≥2 caracteres y al menos un dígito: limpia y re-setea `loanSeed`, **navega a Préstamos** y cierra el menú mobile; el form recibe la etiqueta y enfoca el input. Ignora teclas con Ctrl/Meta/Alt. Funciona desde cualquier vista. Riesgo: tipear rápido algo con números con el foco en un botón/página también navega a Préstamos.
- **Buscador del topbar:** "prestar D1436" abre Préstamos con esa etiqueta (`:285-296`); "D1436" resalta la fila en dashboard/dispositivos (`:273-283`).
- **Polling** (`useAutoRefresh`, `App.tsx:229-239`, `hooks/useAutoRefresh.ts`): cada `VITE_AUTO_REFRESH_SECONDS` (default **15 s**) refresca equipos y movimientos; agenda y tareas cada 2 vueltas (~30 s). Se **pausa con la pestaña oculta** y al volver refresca una vez y retoma. No pollean: "último día con préstamos", cartelitos, chat de traspaso, recreos, cierre del día.
- Después de cada préstamo/devolución (suelto o lote): `refresh({ force: true, wait: true })` + movimientos forzados (`App.tsx:355-394`). Las escrituras pasan por `apiSend` (vacía la caché de `apiGet`).
- `openLoanFlow` (`:456-461`) y `openLoanBatch` (`:471-474`): semillas hacia Préstamos; se olvidan al salir de la vista (`:463-469`).
- `effectiveConsultation` (`:482-483`) es lo que llega como `consultationMode` a todas las piezas.

---

## 12. Reglas de dominio que el rediseño tiene que conservar (utils)

### `src/utils/deviceState.ts` (fuente única del estado)
- `getLoanState(estado)` (`:21-27`), normalizando (minúsculas, sin acentos, espacios simples): contiene "prest" o "retir" → `loaned`; vacío, "devuelto" o "sin revisar" → `available`; "disponible" pero no "no disponible" → `available`; todo lo demás → `blocked`.
- `getDeviceStateKey` (`:30-39`): "perd"/"lost"/"no encontrad" → `missing`; luego loaned/available; resto (fuera de servicio, en reparación, mantenimiento, baja, no disponible…) → `out`.
- **Espejo en el server**: `isAvailableState` / `isLoanedState` (`loans.routes.js:354-366`). Si cambia una, cambiar la otra (lo dice CLAUDE.md y los comentarios).

### `src/utils/classifyDevice.ts`
- `normalizeDeviceCategory` / `classifyDeviceType` (`:4-36`): explícito por `filtro|categoria|tipo|category`; si no, heurística por marca/modelo/dispositivo/comentarios (Tablet, Dell, Touch, TIC, Plani por `xe500c12`, TIC por Acer `cb315-3h`, Touch por `r841|c34011|xe520qabk04us`), si no "Otro".
- `getDeviceNumber` (`:38-44`): número operativo de `numero|numeroOperativo|numero_operativo|number|nro` o del alias; **nunca** toma la etiqueta `D0123` como número.
- `getOperationalAlias` (`:59-74`): "Tipo N" (p. ej. "Touch 34"); fallback al alias explícito (primer valor si hay varios separados por coma).
- `getOperationalAliasList` (`:76-88`): variantes "Touch 34", "Touch34", "34Touch", "34 Touch" + alias explícitos.
- `matchesOperationalAlias` (`:90-111`): búsqueda del dashboard; normaliza "planificación/plano/plan" → "plani".
- `sortByOperationalAlias` (`:113-121`), `getOperationalNumber` (sin número → al final).
- `withOperationalAliases` (`:145-171`): **autonumera los Plani sin número** de forma estable por etiqueta (ordenados por `D####`), saltando números ya usados.

### `src/utils/normalizeSearch.ts`
- `parseScannedCode` (`:5-20`): JSON, query `etiqueta=`, `TA|…`, `D 0*NNNN` o texto tal cual.
- `normalizeDeviceLabel` (`:60-66`): `1436`, `d1436`, `D01436` → `D1436` (4 dígitos con ceros).
- `resolveDeviceMatches` (`:112-151`), en cascada y cortando en la primera que encuentra: (1) exacto por etiqueta/SN/MAC; (2) alias exacto; (3) "tipo + número" parseado (`touch 34`, `34touch`, `plani 5`, `planificación 5`); (4) clave flexible de etiqueta o SN/MAC parcial; (5) búsqueda inteligente amplia (`matchesSmartSearch`, `:74-110`: también persona, comentarios, ubicación, motivo…). El paso 5 puede devolver varios → "Hay más de un equipo posible".
- Formatos que tienen que seguir resolviendo (CLAUDE.md): `touch 34`, `touch34`, `34touch`, `D1436`, `1436`, `plani 5`, `planificación 5`.

### Server `loans.routes.js` (resumen de endpoints)
| Método y ruta | Qué hace |
|---|---|
| `POST /api/loans/lend` | Valida etiqueta, existencia (404), disponibilidad (409), payload (400); escribe `local_states` (Prestado + datos), `local_movements` ("D1436 · Touch 34 prestada a X"), `loan_events` (con `loan_session_id` y accesorios); invalida inventario |
| `POST /api/loans/lend-batch` | Igual por cada etiqueta (dedup, máx. 300); inventario armado una vez; `results[]` por equipo |
| `POST /api/loans/return` | Idempotente si no está prestado; limpia `local_states` (Disponible, `returnedAt`), movimiento "… devuelta", `loan_events` devolución con accesorios devueltos vs esperados |
| `POST /api/loans/return-batch` | Igual en lote; los no prestados cuentan como ok `idempotent` |
| `GET /api/loans/:etiqueta/accessories` | Accesorios del préstamo activo (último evento de esa etiqueta si es `prestamo`) |
| `GET /api/loans/suggest?q=` | Recomendador de personas (§6.3) |
| `GET /api/loans/previous-day` | Último día con préstamos (§5.1) |

Normalización de etiqueta en el server (`:314-318`): `1436`, `D01436`, `d 1436` → `D1436`. **Prestar/devolver no llama a Apps Script ni a planillas** (regla de CLAUDE.md: si alguien lo reintroduce, romper la review).

---

## Lista de verificación

### Ctrl+Click y selección (equipos y cartelitos)
- [ ] Click en chip de equipo libre carga la etiqueta en el formulario, enfoca el input y sube la vista
- [ ] Click en chip de equipo prestado lo devuelve en el acto (sin confirmación) y el chip pulsa mientras tanto
- [ ] Click en cartelito libre abre el modal de entrega; en cartelito entregado lo devuelve en el acto
- [ ] Ctrl+Click marca/desmarca y prende el modo selección solo
- [ ] Cmd+Click (Mac) hace lo mismo que Ctrl+Click
- [ ] Shift+Click hace lo mismo que Ctrl+Click (sin rango)
- [ ] En modo selección, click simple marca/desmarca
- [ ] Chips bloqueados (no encontrado/fuera de servicio, perdido/fuera de uso) no responden a ningún gesto
- [ ] Toggle "Seleccionar varios" / "Varios" (mobile) / "Listo" (apaga y limpia)
- [ ] "Todos"/"Ninguno" por grupo (solo libres + prestados)
- [ ] Barra de selección sticky con contador, "Prestar N"/"Entregar N", "Devolver N", "Limpiar" (limpia sin salir del modo)
- [ ] La selección se recalcula si cambia el estado de un equipo marcado (pasa de Devolver a Prestar)
- [ ] "Prestar N" manda el lote al escaneo continuo del formulario, enfoca Persona y sube
- [ ] "Devolver N" pide confirmación si son más de 1 y devuelve en un solo request
- [ ] "Entregar N" cartelitos: modal con vista previa de chips y campo "Responsable"
- [ ] Mensajes de lote "Se devolvieron X de N … errores"
- [ ] Tooltips por estado en cada chip ("clic para prestar/devolver/marcar")
- [ ] Texto de ayuda "Ctrl+clic marca varios."
- [ ] Selección de equipos y de cartelitos independientes
- [ ] Consulta: chips y toggles deshabilitados

### Grillas
- [ ] Grupos por tipo ordenados por cantidad; chips por número operativo; chip ancho con etiqueta si no hay número
- [ ] Desplegables arrancan cerrados y recuerdan cuáles quedaron abiertos (localStorage)
- [ ] Contenido montado recién al abrir por primera vez, con animación de apertura
- [ ] Barra de proporción y "P/T prestados|entregados" en cada encabezado
- [ ] Lista de prestados por grupo con persona, curso, ubicación y hora
- [ ] Cartelitos: skeleton con la última cantidad conocida
- [ ] Cartelitos: siembra automática del 1 al 30 por sede

### Formulario de préstamo
- [ ] Resolución en vivo de etiqueta / número / alias / SN / MAC / QR
- [ ] Vista previa del equipo y aviso "Hay más de un equipo posible"
- [ ] Aviso de equipo no disponible (bloqueado)
- [ ] "Foco scanner"
- [ ] Prestar solo con equipo disponible; Devolver solo con equipo prestado; textos "Prestando..."/"Devolviendo..."
- [ ] Validaciones: persona, rol, ubicación, nivel + curso si la ubicación lo pide, detalle de ubicación/motivo si lo piden
- [ ] Rol/ubicación/motivo/grados desde la configuración de la sede, con defaults
- [ ] Sugerencias de persona (≥2 letras, debounce) con rol · ubicación · N×; elegir pre-rellena rol, ubicación, motivo, nivel y curso
- [ ] Accesorios de entrega: desplegable, toggles por defecto + agregar uno propio
- [ ] Accesorios al devolver: lista de lo entregado originalmente para marcar lo que vuelve
- [ ] Mensaje de éxito con tilde animado; error con sacudida; mensajes nuevos animados
- [ ] Reset completo y foco al código después de prestar/devolver
- [ ] Protección contra doble envío
- [ ] Cámara: abrir/cerrar, cámara trasera preferida, aviso de HTTPS, aviso sin BarcodeDetector, lectura QR que completa el código y cierra la cámara

### Escaneo continuo
- [ ] Switch Activado/Desactivado
- [ ] Enter del scanner agrega a la lista, limpia y re-enfoca
- [ ] "Agregar a lista"
- [ ] Error si no existe, aviso si es ambiguo, aviso de duplicado, equipo no disponible agregado en rojo
- [ ] Resumen Total / Disponibles / Con error
- [ ] "Quitar" por fila, "Limpiar lista"
- [ ] "Confirmar préstamo múltiple (N)" con las mismas validaciones, un solo request y resultado parcial
- [ ] Salir con lista cargada pregunta "Conservar lista" / "Vaciar lista"
- [ ] Lote recibido desde la grilla o desde Dispositivos entra a la lista sin duplicar

### Página de Préstamos
- [ ] Botón "Cierre del día" en el encabezado de la card
- [ ] Resumen rápido: Prestados, Disponibles, "Más usado", Ubicación, chips por tipo
- [ ] Último día con préstamos: fecha corta, badge, tabla con hora/equipo/persona/ubicación/motivo/accesorios, fila abre ficha, error con Reintentar, vacío
- [ ] Salta fines de semana/feriados (último día previo con préstamos, hora argentina)
- [ ] Actualmente prestados: 8 más viejos, color por antigüedad, fila abre ficha, "Revisar devolución" carga el form
- [ ] Dos columnas en desktop, una en mobile, sin scroll horizontal (tablas scrollean adentro)

### Dashboard
- [ ] Tarjetas Total/Disponibles/Prestados y por categoría filtran la tabla y hacen scroll suave
- [ ] Tarjetas de categoría repartidas en filas parejas según el ancho real
- [ ] Buscador por etiqueta/alias con todos los formatos
- [ ] Tabla: fila abre ficha; Prestar lleva a Préstamos con la etiqueta; Devolver devuelve en el acto; Editar abre el modal
- [ ] Paginado "Ver más" / "Ver todos"
- [ ] Resaltado de fila desde el buscador del topbar
- [ ] Panel Ahora: Ver Agenda, Ver Tareas, hasta 2 tareas (tuyas primero), línea de agenda en curso/próxima, recreo activo
- [ ] Chat de traspaso: notas de hoy, enviar con Enter, borrar, propias diferenciadas, auto-scroll; oculto el envío en consulta
- [ ] Últimos 20 movimientos

### Cierre del día
- [ ] Modal con vista previa del texto, skeleton, observaciones en vivo
- [ ] Copiar al portapapeles
- [ ] Generar cierre (deshabilitado en consulta) y "Cierre guardado."
- [ ] Historial con fecha y operador

### Global
- [ ] Scanner USB desde cualquier vista abre Préstamos con el equipo
- [ ] "prestar D1436" en el buscador del topbar
- [ ] Auto-refresh de equipos y movimientos cada 15 s, pausado con la pestaña oculta
- [ ] Refresco forzado de equipos y movimientos después de cada préstamo/devolución
- [ ] Semillas hacia Préstamos se olvidan al salir de la vista

---

## Ideas de mejora (opcionales, no son parte de lo existente)

- Deshacer en la devolución de un click (chip, dashboard): hoy un click accidental en un chip prestado devuelve sin confirmación ni vuelta atrás, y para revertir hay que cargar el préstamo entero de nuevo. Un toast "Devuelto D1436 · Deshacer" que re-preste con los mismos datos (están en `loan_events`) cubriría el caso.
- Shift+Click con selección por rango dentro de un grupo (hoy Shift = Ctrl).
- Long-press en mobile para entrar al modo selección (hoy solo el botón "Varios").
- Tabla del dashboard: respetar `consultationMode` y mostrar error/éxito al devolver (hoy falla en silencio).
- Cierre del día: calcular préstamos activos desde `local_states`/`loan_events` en vez de la tabla legacy `prestamos`; usar fecha argentina; manejar error al guardar; poder abrir cierres anteriores.
- Chat de traspaso: polling liviano o refresco al volver a la pestaña; fecha "hoy" en hora argentina; avisar si falla enviar/borrar.
- Recuperar "nota importante" (el cierre del día depende de eso y hoy no se puede marcar).
- Server: validar curso según `requiresCourse` de la configuración (no la palabra "aula") y los campos de detalle.
- Escaneo continuo: conservar en la lista los equipos que fallaron en el lote (hoy desaparecen y quedan solo en el mensaje); limpiar accesorios después del lote.
- Modo normal: limpiar el código al escanear uno nuevo o aceptar Enter como "reemplazar" para que no se concatenen dos lecturas.
- UI para cartelitos: marcar perdido/fuera de uso, agregar más números (la API ya existe) y ver historial.
- Reemplazar el `<datalist>` de cursos de cartelitos por el mismo componente de sugerencias.
- "Más usado" en el resumen rápido: o renombrarlo ("Tipo más numeroso") o calcularlo con préstamos reales.
- Textos sin tilde: "1 dia", "N dias", "sin antiguedad".
- Borrar o reutilizar `InternalNotesPanel.tsx` y actualizar CLAUDE.md (nombra `DailyClosureModal` y dice que el Traspaso TIC está en `TasksPage`).
