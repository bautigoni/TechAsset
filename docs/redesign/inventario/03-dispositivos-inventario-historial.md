# 03 · Dispositivos, Inventario TIC e Historial

Relevamiento hecho contra el código de la rama `rediseno-grafito` (16/10/2026). Fuente de verdad: el código. Donde `CLAUDE.md` dice otra cosa, se aclara.

Archivos cubiertos:

- `src/components/devices/`: `DevicesPage.tsx`, `DeviceTable.tsx`, `DeviceBulkBar.tsx`, `DeviceTrashModal.tsx`, `DeviceProfile.tsx`, `AddDeviceModal.tsx`, `DeviceGroupsManager.tsx`, `DeviceCard.tsx`
- `src/components/inventory/`: `InventoryPage.tsx`, `InventoryTree.tsx`, `InventoryCategoryGrid.tsx`, `InventoryCard.tsx`, `InventoryDetail.tsx`, `InventoryUnits.tsx`, `ConditionReviewModal.tsx`, `inventoryEntries.ts`
- `src/components/history/HistoryPage.tsx`
- Lógica compartida: `src/utils/classifyDevice.ts`, `src/utils/normalizeSearch.ts`, `src/utils/deviceState.ts`, `src/hooks/useDevices.ts`, `src/components/layout/Selection.tsx`, `src/components/reminders/RelatedReminders.tsx` (dentro de la ficha)
- Servicios del front: `src/services/devicesApi.ts`, `inventoryApi.ts`, `historyApi.ts`
- Backend: `server/routes/devices.routes.js`, `server/routes/inventory.routes.js`, `server/routes/history.routes.js`, `server/services/deviceInventory.service.js`, `server/services/lifecycle.service.js`

---

## 0. Contexto común (lo que todas las pantallas de esta área heredan)

### Cómo llegan los equipos a la vista

- `App.tsx:84` usa `useDevices(search, activeSite)`. Devuelve `devices` (todos) y `filteredDevices` (filtrados por `matchesSmartSearch` con `search`).
- `DevicesPage` e `InventoryPage` reciben `filteredDevices`; `HistoryPage` recibe `devices` (`App.tsx:546-549`).
- **Ojo: hoy nada setea `search`.** El `Topbar` no recibe `search` ni tiene input (`App.tsx:538`). `setSearch` solo se llama con `''` (logout y atajo de préstamo). En la práctica `filteredDevices === devices`. Tres comportamientos que dependen de `search` están **latentes/inalcanzables**:
  - Filtro global inteligente `matchesSmartSearch` (`useDevices.ts:75-78`).
  - Scroll + resaltado de la fila al tipear una etiqueta `D####`: busca `[data-device-tag="D1436"]`, `scrollIntoView` suave al centro, agrega `.row-highlight` 1,6 s (`App.tsx:273-283`, CSS `layout.css:1448`). Solo en vistas `dashboard` y `devices`.
  - Atajo "prestar D1436" / "préstamo 1436" → abre Préstamos con ese código y limpia la búsqueda (`App.tsx:285-296`).
  Decidir en el rediseño si se recupera un buscador global (recomendado) o se borra esto. No borrar `data-device-tag` de las filas sin decidirlo.
- **Escáner USB global** (`App.tsx:298-333`): fuera de inputs y fuera de `.modal`, las teclas sueltas se acumulan en un buffer; Enter (o 120 ms sin teclas) lo vacía, `parseScannedCode` lo interpreta y, si tiene ≥2 caracteres con algún dígito, navega a Préstamos con ese código. Ignora Ctrl/Meta/Alt. Funciona también parado en Dispositivos/Inventario/Historial.
- Polling: `useAutoRefresh` cada `VITE_AUTO_REFRESH_SECONDS` (15 s por defecto) llama `refresh()` de equipos y movimientos si la pestaña no está oculta (`App.tsx:230-239`). `useDevices` compara el JSON del payload y no re-renderiza si no cambió (`useDevices.ts:28-31`).
- `GET /api/devices` está en `NO_CACHE` (`apiClient.ts:42`) y además deduplica requests en vuelo por sede+URL (`devicesApi.ts:13-34`). Responde con ETag/304 (`devices.routes.js:28`). Los params `refresh=1`, `wait=1`, `_ts` los manda el front pero el server **no los usa** (solo rompen caché del navegador).
- `withOperationalAliases` (`classifyDevice.ts:145-171`) corre en cada carga: a los `Plani` sin número les asigna uno estable (ordenado por número de etiqueta, saltando los usados) y les escribe `aliasOperativo: "Plani N"`; al resto le recalcula `aliasOperativo` con `getOperationalAlias`.
- Cambiar de sede remonta cada página (`key={activeSite}`), con lo que se pierde todo estado local (filtros, selección, vista).

### Estado de un equipo (una sola regla)

`src/utils/deviceState.ts`:
- `getLoanState(estado)`: `prest`/`retir` → `loaned`; vacío, `devuelto`, `sin revisar`, `disponible` (no "no disponible") → `available`; el resto → `blocked`. Es la misma regla que `isAvailableState`/`isLoanedState` del server (si cambia una, cambiar la otra).
- `getDeviceStateKey`: `perd`/`lost`/`no encontrad` → `missing`; si no, loaned/available; cualquier otro (fuera de servicio, en reparación, baja…) → `out`.
- Server: `normalizeDeviceState` (`devices.routes.js:660-668`) mapea texto libre a `Prestado | No encontrada | Fuera de servicio | En reparación | Sin revisar | Disponible`.
- En el merge del server, si el estado es disponible se vacían `prestadoA`, `rol`, `ubicacion`, `curso`, `motivo`, `loanedAt` (`deviceInventory.service.js:166-175`). `local_states` gana siempre que exista (`hasLocalState`).

### Identidad de un equipo

- Server `normalizeTag` (`devices.routes.js:694-698`): mayúsculas, sin espacios, y si es `D?0*\d{1,5}` lo lleva a `D` + 4 dígitos (`1436` → `D1436`, `d 01436` → `D1436`, `36` → `D0036`). Se aplica en todas las rutas con `:etiqueta`.
- `id` del equipo: `${siteCode}:${etiqueta}` (`deviceInventory.service.js:139`).
- Alias operativo (`getOperationalAlias`, `classifyDevice.ts:59-74`): `Tipo + número` (ej. `Touch 34`). El tipo sale de `filtro` → `categoria` → heurísticas por marca/modelo (`classifyDeviceType`, `classifyDevice.ts:18-36`, incluye modelos hardcodeados `xe500c12`→Plani, `cb315-3h` Acer→TIC, `r841`/`c34011`/`xe520qabk04us`→Touch).

### Búsqueda flexible: qué hay y dónde se usa

Hay **tres** motores distintos. No son intercambiables.

| Motor | Archivo | Dónde se usa | Qué encuentra |
|---|---|---|---|
| `matchesOperationalAlias` | `classifyDevice.ts:90-111` | Buscador "Filtrar etiqueta o alias" de Dispositivos | Solo etiqueta y alias/número. Normaliza a minúsculas sin acentos ni símbolos y reemplaza `planificacion`/`plano`/`plan` → `plani`. Es **"contiene"**: `touch 34` = `touch34` = `34touch` = `34 touch` → `Touch 34`; `D1436`, `d 1436`, `1436` → `D1436`; `plani 5`, `planificación 5`, `plan 5` → `Plani 5`. |
| `matchesSmartSearch` / `resolveDeviceMatches` | `normalizeSearch.ts:74-151` | Búsqueda global (latente, ver arriba), `LoanForm`, asistente (`App.tsx:574`) | Además de lo anterior: SN, MAC, marca, modelo, persona, comentarios, rol, ubicación, motivo; QR `TA\|etiqueta\|sn\|mac`, JSON `{etiqueta}`, `?etiqueta=`; igualdad exacta de alias (no "contiene") cuando la consulta parsea como alias. |
| `LIKE` SQL | `history.routes.js:48-51, 92` | Historial | `lower(texto) LIKE %q%`. Sin normalizar: `touch 34` encuentra el alias guardado `Touch 34`, pero `touch34` **no**. |

Y el inventario TIC usa un cuarto filtro trivial (`toLowerCase().includes`, `InventoryPage.tsx:80-95`): tampoco entiende `touch34`.

Comportamientos a preservar (y a revisar) de `matchesOperationalAlias`:
- Al ser "contiene", `touch 3` trae también `Touch 30…39`; `34` suelto trae cualquier etiqueta o alias que contenga `34`. Es así hoy.
- `D01436` **no** encuentra `D1436` en este buscador (sí en `matchesSmartSearch`, que normaliza la etiqueta con `normalizeDeviceLabel`).
- No busca por SN, modelo ni persona aunque el equipo esté prestado.

---

## 1. Dispositivos (`src/components/devices/DevicesPage.tsx`)

**Para qué sirve:** inventario de equipos de la sede con su estado de préstamo; filtrar, prestar/devolver, editar, borrar (papelera), importar/exportar y agrupar.

**Quién la ve:** módulo `devices` (`modules.ts:16`, ítem de sidebar `Sidebar.tsx:44`). Si el módulo está apagado o el rol no lo ve, `App.tsx:219-225` manda al dashboard.
- `consultationMode` (`effectiveConsultation` = modo consulta manual o rol sin permisos de edición, `App.tsx:480-483`): oculta "Importar CSV" y "+ Añadir dispositivo"; la tabla pierde Prestar, Devolver, Editar, Borrar y la columna de selección; no se monta la barra de lote (`DevicesPage.tsx:204, 212, 217, 222`). "Grupos" y "Papelera" siguen visibles pero adentro todo queda deshabilitado. "Ficha" y click en fila siguen andando.
- Server: escrituras bajo `/devices`, `/device-groups`, `/lifecycle` exigen `canEditModule('devices')` (`siteContext.service.js:214-233`) y `requireEditor` (`server/index.js:133`).

**Datos:**
- Equipos: props (`GET /api/devices`, ver §0).
- `POST /api/devices/import` (importar), `GET /api/devices/export/inventory.csv`, `GET /api/devices/export/summary.csv`, `GET /api/movements/export.csv`, `GET /api/loans/export/active.csv` (exportar, vía `fetch` con `cache:no-store` + headers de sede, `devicesApi.ts:47-60`).
- Borrar: `DELETE /api/devices/:etiqueta` (vía `App.onDeleteDevice`: borra, `removeLocal` optimista después del OK, `refresh({force,wait})`, refresca movimientos — `App.tsx:348-353`).
- Deshacer/restaurar: `POST /api/devices/:etiqueta/restore`.
- Alta/edición: `addDevice` → `POST /api/devices/add` o, si trae `originalEtiqueta`, `PATCH /api/devices/:originalEtiqueta` (`devicesApi.ts:62-67`); luego `refresh()` no forzado (`App.tsx:343-346`).
- Lote: `POST /api/loans/return-batch` (vía `App.onReturnBatch`), `POST /api/devices/status` (uno por equipo), `DELETE /api/devices/:etiqueta` (uno por equipo).
- "Prestar" en fila → `openLoanFlow` navega a Préstamos con la etiqueta precargada (`App.tsx:456-461`). "Prestar N" del lote → `openLoanBatch` navega con el lote (`App.tsx:471-474`). La semilla se olvida al salir de Préstamos (`App.tsx:464-469`).
- "Devolver" en fila → `returnFromTable` → `POST /api/loans/return` directo, sin confirmación ni pasar por Préstamos (`App.tsx:398-401`).

**Controles:**

| Control | Dónde | Qué hace exactamente | Condiciones |
|---|---|---|---|
| Tarjeta KPI "Total" | Grilla superior `.device-filter-grid` | Filtro `all`. Número animado (`AnimatedNumber`). `<button aria-pressed>` | Siempre. Volver a tocar la activa no la apaga |
| KPI "Disponibles" | idem | Filtro por `getDeviceStateKey === 'available'` | — |
| KPI "Prestados" | idem | Filtro `loaned` | — |
| KPI por categoría (dinámicas) | idem, entre Prestados y No encontradas | Una por cada `classifyDeviceType` distinto, orden alfabético; filtra por tipo | Aparecen según los datos |
| KPI "No encontradas" | idem | Filtro `missing` | — |
| KPI "Fuera de servicio" | idem | Filtro `out` (incluye En reparación, etc.) | — |
| Título de la card | `card-head` | Muestra el nombre del filtro (`FILTER_LABELS` o la categoría) + "N equipos visibles" | — |
| Buscador "Filtrar etiqueta o alias" | `card-head .actions` | `input type=search` con `matchesOperationalAlias` en vivo (sin debounce). Si tiene texto, el resultado se **ordena siempre por número operativo** aunque el select diga "Orden original" (`DevicesPage.tsx:71-72`) | `title` con ejemplos: "Buscar D1433, Touch 31, touch31, Plani 5..." |
| Select de orden | idem | `SelectField`: "Orden original" (orden del server: por etiqueta) / "Ordenar por número operativo" (`sortByOperationalAlias`: grupo alfabético → número → etiqueta numérica) | — |
| "Importar CSV" | idem | `promptDialog` (input `url`, opcional) → `POST /api/devices/import { csvUrl, operator }`. Vacío = usa `sites.spreadsheet_url`. Muestra "Importando…" y luego el resumen inline (leídos, nuevos, actualizados, reactivados, omitidos, errores) y refresca forzado | Oculto en consulta |
| "Exportar inventario" | idem | Descarga `techasset_inventario.csv` (server: `techasset_inventario_SEDE.csv`, BOM, 20 columnas) | Siempre |
| "Exportar resumen" | idem | `techasset_resumen.csv`: cantidad por Filtro×Estado | Siempre |
| "Exportar movimientos" | idem | `techasset_movimientos.csv`: todo `local_movements` de la sede | Siempre |
| "Exportar préstamos" | idem | `techasset_prestamos_activos.csv` | Siempre |
| "Exportar PDF QR" | idem | Abre popup 980×720, escribe HTML con una tarjeta por equipo **visible** (respeta filtro y búsqueda), QR de `api.qrserver.com` con payload `TA\|etiqueta\|sn\|mac`, alias o categoría debajo; grilla 4 columnas (3 al imprimir); `print()` a los 600 ms | Si el navegador bloquea el popup: error inline |
| "Grupos" | idem | Abre `DeviceGroupsManager` (§6) | Siempre |
| "Papelera" | idem | Abre `DeviceTrashModal` (§3) | Siempre |
| "+ Añadir dispositivo" | idem (primary) | Abre `AddDeviceModal` vacío (§5) | Oculto en consulta |
| Mensaje inline | Debajo del head | `.tool-info` / `.tool-error` con el resultado de importar, exportar o borrar. Persiste hasta la próxima acción | — |
| Tabla | Card | `DeviceTable` (§2) con selección | — |
| Estado vacío | Card | "No hay dispositivos para este filtro o búsqueda." | — |
| Barra de lote | Flotante abajo | `DeviceBulkBar` (§4) | Solo fuera de consulta y con ≥1 seleccionado |

**Micro-interacciones y atajos:**
- KPI = filtro: no hay "toggle off", hay que tocar "Total".
- El buscador no tiene debounce ni foco automático. `type=search` → el navegador muestra la X nativa para limpiar.
- Buscar fuerza el orden por número operativo (útil para `touch` → Touch 1, 2, 3…).
- Exportar PDF QR depende de un servicio externo (`api.qrserver.com`): manda etiqueta, SN y MAC a un tercero. Sin internet, no hay QR.
- El QR `TA|…` es el formato que entiende `parseScannedCode` (`normalizeSearch.ts:14-15`): escanear una etiqueta impresa con el escáner USB abre Préstamos.
- Borrar desde la fila: confirmación → borrar → toast "D1436 se movió a la papelera." con acción **Deshacer** (7 s, `Feedback.tsx:92`) que restaura y refresca, con toast "D1436 restaurado." (`DevicesPage.tsx:76-104`).

**Estados:** sin skeleton propio (lo da el `Suspense` de la vista y el `sync` global); vacío con texto; errores inline; toasts para borrar/deshacer; confirmación en borrar.

**Controles nativos o fuera de sistema a reemplazar:**
- `<input type="search">` con X nativa (`DevicesPage.tsx:189-196`).
- `title=` como tooltip del buscador (`DevicesPage.tsx:195`).
- `window.open` + `document.write` + `print()` para el PDF QR (`DevicesPage.tsx:147-166`), con estilos inline propios (no siguen el tema).
- Fila de 9 botones del mismo peso en el head (`DevicesPage.tsx:204-212`): candidatos a menú "Importar / Exportar".

**Mobile:** la grilla de KPIs se reacomoda (`stats-grid`); la tabla pasa a tarjetas (§2); la barra de lote sube por encima del MobileNav (`components.css:5165`).

**Riesgos para el rediseño:**
- El orden de las KPIs es fijo con las categorías insertadas en el medio.
- `count()` recorre todos los equipos por cada tarjeta en cada render (barato hoy, ~80 equipos).
- La selección se arma sobre `devices` (todos), no sobre los visibles: ver §4.

---

## 2. Tabla de equipos (`src/components/devices/DeviceTable.tsx`)

**Para qué sirve:** lista de equipos con acciones por fila. Se usa en Dispositivos (`actionMode='full'`, con selección) y en el Dashboard (`actionMode='dashboard'`, sin selección, sin Ficha ni Borrar; `Dashboard.tsx:145`).

**Quién la ve:** la de cada página. Las acciones llegan como props opcionales: si la prop no viene, el botón no aparece (así se implementa consulta).

**Datos:** ninguno propio; llama a los callbacks.

**Controles:**

| Control | Dónde | Qué hace exactamente | Condiciones |
|---|---|---|---|
| Checkbox de encabezado | `th.device-select-cell` | `toggleMany` de las filas **renderizadas** (`shown`), no de todas las filtradas. Marcado si todas las renderizadas están seleccionadas. Si estaban todas, las desmarca | Solo con `selection` |
| Checkbox por fila | `td.device-select-cell` | `toggle(etiqueta)`. La celda corta `click` y `keydown` para no abrir la ficha | Solo con `selection` |
| Fila | `tr.device-row-clickable` | Click → `onProfile(device)` (abre la ficha). `role=button`, `tabIndex=0`; Enter o Espacio la abren (`preventDefault`) | Solo con `onProfile` |
| Columna Etiqueta | | Etiqueta en negrita + alias operativo debajo (`.operational-alias`) | — |
| Columna Dispositivo | | `categoria \|\| dispositivo \|\| 'Chromebook'`; si difieren, `dispositivo` debajo; `marca · modelo` debajo | — |
| Columna SN | | `sn` o, si no hay, `mac`. Valores `devuelto/prestado/disponible` se muestran como `-` (`tableValue`) | — |
| Columna Prestado a | | Persona; si está prestado: `ubicación · curso`, fecha/hora de préstamo y píldora de antigüedad (`loanAgeLabel`/`loanAgeTone`) | — |
| Columna Última devolución | | `formatLoanDateTime(returnedAt)` | — |
| Columna Estado | | `Badge` con tono: Prestado→`loaned`, No encontrada/Perdida→`lost`, Fuera de servicio→`out-service`, resto→`available`. "Perdida" se muestra como "No encontrada" | — |
| "Prestar" | Acciones | `onLoan(device)` → navega a Préstamos | Solo si `getLoanState === 'available'` y hay `onLoan` |
| "Devolver" | Acciones (success) | Devuelve en el acto. Texto pasa a "Devolviendo..." y se deshabilita. Mientras haya una devolución en curso, ninguna otra fila puede devolver (guard `returningTag`) | Solo si `loaned` y hay `onReturn` |
| "Ficha" | Acciones | `onProfile(device)` | No en dashboard |
| "Editar" | Acciones | `onEdit(device)` → `AddDeviceModal` en modo edición | Solo con `onEdit` |
| "Borrar" | Acciones (`.device-delete-btn`) | `confirmDialog` danger "Se oculta de la app sin borrar su historial. Se puede restaurar desde la papelera." → `onDelete`; texto "Borrando..." | No en dashboard; solo con `onDelete` |
| "Ver más" | Pie `.device-table-more` | +30 filas | Si hay más equipos que filas renderizadas |
| "Ver todos" | idem | Renderiza todas | idem |
| Contador "N de M" | idem | Filas renderizadas / total | idem |

**Ordenamiento por columnas: no existe.** Los `<th>` no son clickeables ni tienen `aria-sort`. El único orden es el select de `DevicesPage` y el orden forzado al buscar.

**Paginado en el cliente (progresivo):** primer pintado 12 filas; en `requestIdleCallback` (timeout 400 ms, fallback `setTimeout` 50 ms) sube a 30; luego "Ver más" de a 30 (`DeviceTable.tsx:45-60`). Se resetea a 12 cuando cambia `devices.length` (no cuando cambia el contenido con la misma cantidad).

**Micro-interacciones y atajos:**
- Enter/Espacio sobre la fila abre la ficha; las celdas de checkbox y acciones paran la propagación de click y teclado.
- No hay shift-click para rango, ni ctrl/cmd-click, ni doble click, ni menú contextual, ni drag.
- `data-device-tag={etiqueta}` en cada `<tr>`: lo usa el scroll+resaltado global (§0) y la clase `.row-highlight`.
- Hover de fila: fondo azul tenue; foco: outline azul (`components.css:4426`).

**Estados:** botones con texto de progreso ("Devolviendo...", "Borrando..."); sin skeleton.

**Controles nativos a reemplazar:** checkboxes nativos con `accent-color` (`DeviceTable.tsx:80-85, 105-110`; CSS `components.css:5160-5161`). Botones "Ver más/Ver todos" son `<button>` crudos con estilo propio (`components.css:2791-2794`).

**Mobile (≤760 px, `layout.css:851-903`):** cada fila pasa a tarjeta; se oculta `thead`; cada `td` es grilla `120px 1fr` con la etiqueta de columna sacada de `data-label` vía `::before`. Las acciones quedan a la izquierda y hacen wrap (`components.css:3282-3298`).

**Riesgos para el rediseño:**
- Los anchos de columna están definidos por `th:nth-child(n)` **dos veces** con valores distintos (`layout.css:477-484` para 8 columnas y `components.css:79-85` para `.compact-table`), y la columna de selección **corre** los índices cuando aparece. Cualquier cambio de columnas desalinea anchos y la regla de centrado de Estado/Acciones (`components.css:92-93`).
- La vista mobile depende de que cada `<td>` tenga `data-label`.
- La clase `no-scroll-table` y `.device-table-wrap` controlan que no haya scroll horizontal.
- `tableValue` esconde "Disponible/Prestado/Devuelto" en celdas de texto: si se reescribe, no mostrar esas palabras como persona o SN.

---

## 3. Papelera de dispositivos (`src/components/devices/DeviceTrashModal.tsx`)

**Para qué sirve:** ver equipos borrados (ocultos), quién y cuándo, y restaurarlos tal cual estaban.

**Quién la ve:** cualquiera que vea Dispositivos. En consulta, "Restaurar" deshabilitado.

**Datos:** `GET /api/devices/deleted` (cacheado 15 s por `apiGet`, se invalida con cualquier `apiSend`), `POST /api/devices/:etiqueta/restore`. Al restaurar llama `onRestored` → `refresh({force,wait})`.

Server (`devices.routes.js:402-464`):
- Borrar = upsert en `hidden_devices` (fecha, operador, razón "Borrado desde Dispositivos") + `local_devices.eliminado=1, deleted_at, deleted_by` + movimiento "dispositivo borrado". No se borra historial.
- Papelera = `hidden_devices` LEFT JOIN `local_devices.payload`, ordenado por `deleted_at DESC`.
- Restaurar = borra de `hidden_devices`, `eliminado=0`, movimiento "dispositivo restaurado". 404 si no estaba en la papelera.
- **Reimportar el CSV también restaura** cualquier equipo de la papelera que venga en el archivo (`saveLocalDevice` borra de `hidden_devices`, `devices.routes.js:538`). Editar un equipo también lo "des-oculta".

**Controles:**

| Control | Dónde | Qué hace exactamente | Condiciones |
|---|---|---|---|
| Texto intro | Arriba | Explica que conservan historial | — |
| Buscador | Arriba | Filtra en vivo por etiqueta, alias, categoría, modelo y "quién lo borró" (minúsculas, contiene) | **Solo aparece con más de 6 ítems** |
| Ítem | Lista | `etiqueta · alias`, `categoría · marca · modelo` (o "Sin datos del equipo"), "Borrado {fecha} por {operador}" | — |
| "Restaurar" | Por ítem | Restaura, saca el ítem de la lista sin recargar, toast "D1436 restaurado." | Deshabilitado en consulta y mientras restaura ("Restaurando…") |
| Cerrar | Modal | X, backdrop o Escape | — |

**Estados:** skeleton de 2 líneas; vacío "La papelera está vacía."; error inline; toast de éxito/error.

**Controles nativos:** ninguno relevante (input de texto común).

**Mobile:** modal `wide` estándar.

**Riesgos:** no hay "vaciar papelera" ni borrado definitivo (correcto por las reglas). No hay papelera para recursos del Inventario TIC (ver §8).

---

## 4. Selección múltiple y barra de lote (`src/components/devices/DeviceBulkBar.tsx` + `layout/Selection.tsx`)

**Para qué sirve:** acciones sobre varios equipos marcados en la tabla de Dispositivos.

**Quién la ve:** solo fuera de consulta (`DevicesPage.tsx:222`). Aparece con ≥1 seleccionado.

**Datos:** ver §1.

**Selección (`useSelection`):** `Set<string>` de etiquetas; `toggle`, `toggleMany` (si ya estaban todas, las saca; si no, completa), `clear`. Vive en `DevicesPage`; se pierde al cambiar de sede o de vista (desmonte).

**Controles:**

| Control | Dónde | Qué hace exactamente | Condiciones |
|---|---|---|---|
| Contador | Barra | "**N** seleccionado(s)" | — |
| "Prestar N" | Barra (primary) | Navega a Préstamos con las etiquetas **disponibles** de la selección como lote | Solo si hay disponibles |
| "Devolver N" | Barra (success) | `confirmDialog` con la lista de etiquetas → `POST /api/loans/return-batch` → toast ok o warn con los que fallaron y por qué → limpia selección | Solo si hay prestados |
| "Cambiar estado" | Barra | `promptDialog` con `options`: Disponible, Fuera de servicio, En reparación, No encontrada, Sin revisar. Si hay prestados en la selección, avisa que no se tocan. Un `POST /api/devices/status` **por equipo, en serie**; luego refresca, toast ok/warn y limpia | Solo si hay no-prestados. Los prestados se excluyen a propósito (borraría el préstamo sin registrar devolución) |
| "Borrar" | Barra (danger) | `confirmDialog` danger → un `DELETE` por equipo en serie (toast de error por cada fallo) → refresca → limpia → toast "N equipos se movieron a la papelera." con **Deshacer** (restaura uno por uno; errores tragados con `.catch(() => undefined)`) | Siempre (incluye prestados) |
| "Limpiar" | Barra | Vacía la selección | — |

**Micro-interacciones:**
- La barra es `position:fixed` abajo al centro, montada con portal en `body` (por el `transform` de la animación de vistas), ancho `min(760px, 100vw-32px)`, `z-index:60`, animación de entrada con guard de `prefers-reduced-motion` (`components.css:5163-5166`).
- Todos los botones se deshabilitan mientras corre una acción (`busy`).
- Cada acción filtra por sí sola los equipos donde tiene sentido; los contadores de los botones lo reflejan.

**Estados:** confirmaciones, toasts ok/warn/error, Deshacer en borrar.

**Riesgos para el rediseño (frágil):**
- `selectedDevices` se calcula sobre **todos** los equipos (`DevicesPage.tsx:57`), no sobre los visibles: si marcás equipos, cambiás de filtro o búsqueda y apretás "Borrar", también se borran los marcados que ya no ves. La tabla no muestra cuántos seleccionados quedaron ocultos.
- "Seleccionar todos" solo marca las filas renderizadas (12/30/…), no todo el filtro.
- Cambiar estado y borrar en lote son N requests en serie: lentos con Supabase y sin atomicidad.
- El Deshacer de lote traga errores (contra la convención de `CLAUDE.md`).
- `STATES` del lote (5 opciones) no coincide con los estados del formulario de alta/edición (4 opciones, §5).

---

## 5. Alta y edición de equipo (`src/components/devices/AddDeviceModal.tsx`)

**Para qué sirve:** crear un equipo a mano o editar uno existente (mismo formulario).

**Quién la ve:** fuera de consulta. Se abre desde "+ Añadir dispositivo" y "Editar" en Dispositivos, y desde "Editar" del Dashboard (montado en `App.tsx:586`).

**Datos:** `GET /api/device-categories` al abrir (categorías de la tabla `device_categories` + las usadas + fijas; se fusionan con la lista local). Guardar: `POST /api/devices/add` o `PATCH /api/devices/:originalEtiqueta`.

Server:
- `normalizeDevicePayload` (`devices.routes.js:623-658`) acepta muchos alias de campo (para CSV): `numero|numeroOperativo|nro|número operativo|operativo`, `sn|serial|s/n`, `prestada|prestadoA|persona`, etc. Si no hay estado y hay persona → Prestado.
- Alias operativo: si no se manda, se arma `Filtro + número`. Varios alias separados por coma → `alias_alternativos` JSON.
- `saveCategory` agrega la categoría a `device_categories`.
- **Renombrar etiqueta** (PATCH con etiqueta distinta): arrastra `device_metadata` (condición, clase, vida útil; si la nueva ya tenía, gana la nueva), borra la fila vieja de `local_devices`. **No** arrastra `local_states`, `loan_events`, `local_movements` ni pertenencia a grupos: el historial queda bajo la etiqueta vieja.
- Movimientos: "dispositivo agregado" / "dispositivo editado".

**Controles:**

| Control | Dónde | Qué hace exactamente | Condiciones |
|---|---|---|---|
| "Etiqueta 2023" | Form | Texto, `required` | Obligatoria (HTML + JS) |
| "Número operativo" | Form | Texto | — |
| "Categoría / tipo" | Form | Texto con `<datalist>` de categorías, `required` | Obligatoria |
| "Filtro" | Form | Texto, placeholder "Touch, Dell, TIC, Tablet, Plani..." (define el tipo del alias) | — |
| "Dispositivo" | Form | Texto | — |
| "Marca" / "Modelo" | Form, 2 columnas | Texto | — |
| "Serial" / "MAC" | Form, 2 columnas | Texto | — |
| "Estado" | Form | `SelectField`: Disponible, Prestado, No encontrada, Fuera de servicio (default Disponible) | — |
| "Alias operativo opcional" | Form | Texto, placeholder "TIC1, TIC 1, 1TIC, 1 TIC" (acepta varios separados por coma) | — |
| "Observaciones" | Form | `textarea` 3 filas → `comentarios` | — |
| "Guardar" | Pie (primary, submit) | Valida, guarda, cierra. "Guardando..." | Deshabilitado mientras guarda |
| "Cancelar" | Pie | Cierra sin guardar | — |

**Micro-interacciones:** Enter en cualquier input envía el form. Sin `autoFocus` explícito (el foco lo pone `useDialogFocus` en la tarjeta). Defaults nuevos: `estado=Disponible`, `categoria=Chromebook`, `dispositivo=Chromebook`.

**Estados:** error inline `.form-error`; sin toast de éxito.

**Controles nativos a reemplazar:** `<datalist>` (`AddDeviceModal.tsx:52-55`); `required` con globo nativo del navegador (`:49, :52`); `<textarea>` estándar.

**Riesgos:**
- Editar "Estado" escribe en `local_devices.payload`, pero si el equipo tiene fila en `local_states` (casi todos los que alguna vez se prestaron) **gana `local_states`** (`deviceInventory.service.js:136-138`): el cambio puede no verse. El camino que sí funciona para cambiar estado es "Cambiar estado" del lote (`POST /devices/status`).
- La lista de estados no incluye "En reparación" ni "Sin revisar".
- El `.catch(() => {})` de categorías es aceptable (no es acción del usuario).

---

## 6. Grupos de dispositivos (`src/components/devices/DeviceGroupsManager.tsx`)

**Para qué sirve:** agrupar equipos (ej. "Carro móvil 5to"); el grupo aparece en la ficha de cada miembro.

**Quién la ve:** botón "Grupos" de Dispositivos, siempre. En consulta todo deshabilitado.

**Datos:** `GET /api/device-groups`, `POST /api/device-groups`, `PATCH /api/device-groups/:id`, `DELETE /api/device-groups/:id` (soft: `active=0` y borra miembros). Publica contexto al asistente con `useAssistantContext` (`type:'group'`).

**Controles:**

| Control | Dónde | Qué hace exactamente | Condiciones |
|---|---|---|---|
| "+ Nuevo grupo" | Columna izquierda | Limpia el editor para crear | Deshabilitado en consulta |
| Ítem de grupo | Lista izquierda | Carga nombre, descripción y miembros en el editor; `.active` si es el elegido. Muestra "N dispositivos" | — |
| "Nombre" | Editor | Texto, placeholder "Ej. Carro móvil 5to" | Deshabilitado en consulta |
| "Descripción" | Editor | `textarea` | idem |
| Checkbox por equipo | Picker (lista de **todos** los equipos) | Agrega/quita del grupo en edición | idem |
| Botón texto del equipo | Picker, al lado del checkbox | "D1436 · Touch 34": **cierra Grupos y abre la ficha** de ese equipo (no toggle) | Siempre |
| "Eliminar" | Acciones | `confirmDialog` danger "¿Eliminar el grupo X? Los equipos no se borran." → borra, recarga, limpia editor | Solo con grupo elegido y fuera de consulta |
| "Guardar grupo" | Acciones (primary) | Crea o actualiza (reemplaza miembros), recarga, limpia, mensaje "Grupo guardado." | Deshabilitado sin nombre o en consulta |

**Micro-interacciones:** el mensaje "Grupo guardado." no se borra solo. El picker no tiene buscador.

**Estados:** error de carga como mensaje inline. **Guardar y Eliminar no tienen try/catch**: un nombre duplicado (409 "Ya existe un grupo con ese nombre.") termina en promesa rechazada sin feedback (contra la convención).

**Controles nativos:** checkboxes nativos (`:95-102`); `<button>` dentro de `<label>`.

**Riesgos:**
- **Un equipo pertenece a un solo grupo**: `device_group_members` tiene unique `(site_code, device_tag)` y el insert hace `ON CONFLICT DO UPDATE SET group_id` (`devices.routes.js:248`). Agregarlo a B lo saca de A en silencio.
- El picker lista todos los equipos sin filtro: con muchos equipos es largo.
- `classroomKey` existe en el modelo y la API pero no hay UI.

---

## 7. Ficha de equipo (`src/components/devices/DeviceProfile.tsx`)

**Para qué sirve:** todo sobre un equipo: estado, condición, vida útil, estadísticas, préstamo activo, grupo, actividad, tickets, mantenimiento y recordatorios.

**Quién la ve:** cualquiera; se abre desde la fila/botón "Ficha" de Dispositivos y Dashboard, "Ver ficha" de Inventario, link de etiqueta en Historial, botones de miembros de grupo, el asistente (`App.tsx:573-578`) y el picker de Grupos. Montada globalmente en `App.tsx:585`. En consulta: condición, vida útil, fecha de alta y "+ Agregar" recordatorio deshabilitados.

**Datos:**
- `GET /api/devices/:etiqueta/overview` (cacheado 15 s por `apiGet`). El server junta: `loan_events` (200), `local_movements` (100), tickets cuyo título/descripción/nota contienen la etiqueta (100), resumen IA (`getDeviceAiSummary`), metadata, ciclo de vida, grupo y miembros (`devices.routes.js:52-102`). Reparaciones = tickets que matchean `/repar|manten|service/`.
- `PATCH /api/devices/:etiqueta/metadata` por cada control. El PATCH es parcial: lo que no se manda se conserva. Solo cuando viene `condition` no vacía se actualiza `last_reviewed_at`; si cambió, se registra movimiento "condicion" (`recordConditionChange`).
- Recordatorios: `getReminders({relatedType:'device', relatedId})`, `createReminder`, `completeReminder`.
- Eventos globales: dispara `techasset:assistant-context` al abrir y `techasset:assistant-context-clear` al cerrar (`DeviceProfile.tsx:46-60`).

**Controles:**

| Control | Dónde | Qué hace exactamente | Condiciones |
|---|---|---|---|
| Hero | Arriba | Etiqueta (eyebrow), alias grande, `Tipo · Fabricante Modelo` | — |
| Badge de estado | Hero derecha | `available`/`loaned`/`off` | — |
| "Condición" | Hero derecha | `SelectField`: Sin revisar (''), Excelente, Bueno, Regular, Malo. **Guarda al cambiar** (origen "Perfil") | Deshabilitado en consulta |
| "Vida útil (meses)" | Hero derecha | `input number min=0`; placeholder = meses vigentes (de clase/sede/global). **Guarda en `blur`**. Vacío = vuelve al default | idem |
| "Fecha de alta" | Hero derecha | `DateField` (calendario propio). Guarda al cambiar. Vacío si la fecha es estimada (sale de `created_at`) | idem |
| Resumen IA | Card | Texto + "Actualizado {fecha}" | Solo si el server lo devuelve |
| Información básica | Card `<dl>` | Nombre, Activo, Número operativo, Serie, Modelo, Fabricante, Tipo, Estado, Ubicación, Asignado a ("—" si vacío) | — |
| Estadísticas | Card | Préstamos, Reparaciones, Incidentes, Último préstamo, Última reparación, Mantenimiento | "—" mientras carga |
| Préstamo activo | Card | Persona · rol · ubicación, "Desde {fecha}" | Solo si está prestado |
| Grupo | Card | Nombre, descripción, botones de cada miembro → **reemplaza la ficha** por la del miembro | Solo si pertenece a uno |
| Actividad reciente | Card | Timeline de movimientos + préstamos/devoluciones (con accesorios entregados/esperados/recibidos), **solo los primeros 12** (el server manda 50) | "Sin movimientos registrados." |
| Tickets relacionados | Card | Hasta 8, cada uno es `<a href="/sede/SEDE/tickets">` (**navegación completa, recarga la app**) | "No se detectaron tickets para esta etiqueta." |
| Mantenimiento y datos de compra | Card | Lista de reparaciones + chips fijos "Compra: no registrada", "Garantía: no registrada" | — |
| Recordatorios | Card (`RelatedReminders`) | Hasta 5; "+ Agregar" abre dos `promptDialog` seguidos (texto; luego `datetime-local` con la próxima hora en punto) → crea → toast; "Completar" en pendientes | "+ Agregar" deshabilitado en consulta; "Completar" oculto en consulta |
| Cerrar | Modal | X, backdrop, Escape | — |

**Micro-interacciones:**
- Autoguardado sin confirmación ni toast de éxito; solo error genérico "No se pudo guardar el dato." arriba.
- Vida útil se guarda al salir del campo (tab o click afuera); cerrar el modal con Escape **sin** blur previo puede perder lo tipeado.
- El título del modal es "Ficha · {alias o etiqueta}".
- Mientras carga: "Armando el historial del dispositivo…" y los datos básicos ya se ven (vienen de props).
- `RelatedReminders` "Completar" no tiene try/catch.

**Controles nativos a reemplazar:** `input type=number` (`DeviceProfile.tsx:116-125`); `datetime-local` del `promptDialog` de recordatorios (`RelatedReminders.tsx:29`); `<button>` crudo "Completar" (`RelatedReminders.tsx:59`); íconos de texto ✓/○.

**Mobile:** modal `wide` estándar con scroll interno; `.device-profile-status` es flex en una fila (revisar wrap a 360 px).

**Riesgos:**
- Los links de tickets usan `href` real: si el rediseño cambia rutas, se rompen; además no abren el ticket puntual.
- `shortDate` invierte `YYYY-MM-DD` a mano.
- Datos de compra/garantía son placeholders fijos (no hay backend).

---

## 8. Inventario TIC (`src/components/inventory/InventoryPage.tsx`)

**Para qué sirve:** vista unificada de **equipos** (de `local_devices`) y **recursos** maker/stock (de `inventory_items`) con condición, revisión, vida útil y stock.

**Quién la ve:** módulo `inventory` ("Inventario TIC", `modules.ts:18`, `Sidebar.tsx:47`). Escrituras exigen `canEditModule('inventory')` para `/inventory/*`, pero los cambios de condición de **equipos** van por `/devices/:etiqueta/metadata` y exigen `canEditModule('devices')`.
- En consulta: deshabilitados "Revisar condición", "Importar CSV", "Agregar recurso", condición en el detalle, Editar, Ocultar, TeamViewer, unidades (no se muestran sus botones), subir foto y guardar.

**Datos:**
- `GET /api/inventory/items` al montar (cacheado 15 s). Trae contadores de unidades (`unidadesCargadas`, `unidadesConFalla`) y `bajoStock = cantidad <= minStock` (inclusive).
- Equipos por props (con `vidaConsumidaPct`, `vencido`, `fechaRenovacion`, `condition`, `lastReviewedAt`, `assetClass` decorados en `GET /api/devices` por `decorateDevicesWithLifecycle`).
- `POST/PATCH/DELETE /api/inventory/items[/:id]`, `POST /api/inventory/upload-image`, `POST /api/inventory/import`, `PATCH /api/devices/:etiqueta/metadata`, unidades (§10), `GET /api/devices/review-queue` (§11).
- `onRefreshDevices` = `refresh({force,wait})`.

**Modelo `Entry`** (`inventoryEntries.ts`): normaliza equipo y recurso.
- Equipo: `nombre = aliasOperativo || etiqueta`, `detalle = etiqueta · marca · modelo`, `categoria = assetClass || categoria || 'Otro'`, **`subcategoria = modelo || marca`**, sin foto, vida útil.
- Recurso: nombre, observaciones como detalle, categoría/subcategoría, cantidad/unidad, foto, bajo stock.
- **Regla única de "revisado"**: condición cargada y última revisión hace menos de **92 días** (`REVIEW_MAX_AGE_DAYS`). La usan el KPI "Revisado %", el cartel "Revisar" de la tarjeta, la columna Revisión y la portada de categorías.
- `reviewLabel`: "Nunca revisado" / "Revisado hoy" / "hace N días" (<31) / "hace N meses".
- Agrupado: categorías alfabéticas (es), subcategorías con "sin subcategoría" primero, ítems por nombre con orden numérico (`Touch 2` antes que `Touch 10`).

**Controles:**

| Control | Dónde | Qué hace exactamente | Condiciones |
|---|---|---|---|
| "Revisar condición" | Head | Abre el recorrido `ConditionReviewModal` (§11) | Deshabilitado en consulta |
| Menú "Importar / exportar" | Head, `<details>` | Desplegable nativo con 3 botones | — |
| ↳ "Exportar CSV" | Menú | CSV en el cliente de lo **filtrado** (no de lo seleccionado en el árbol): Tipo, Nombre, Categoría, Subcategoría, Condición, Última revisión, Cantidad, Unidad, Vida consumida %, Renovación. Archivo `inventario-YYYY-MM-DD.csv` con BOM | — |
| ↳ "Descargar plantilla" | Menú | `plantilla-inventario-tic.csv` con 2 filas de ejemplo | — |
| ↳ "Importar CSV" | Menú | Click en `input type=file accept=.csv` oculto → lee el archivo como texto → `POST /api/inventory/import` → mensaje con leídos/nuevos/actualizados/fotos y condiciones conservadas/omitidos/errores → recarga | Deshabilitado en consulta o `busy` |
| "Agregar recurso" | Head (primary) | Abre el form vacío (§9) | Deshabilitado en consulta |
| KPI "Equipos" | `.inv-kpis` | Segmento = equipo, quita filtro KPI. Activo si segmento equipo sin KPI | — |
| KPI "Recursos" | idem | Segmento = recurso, quita KPI | — |
| KPI "Regular o malo" | idem | Toggle filtro `malos`; al activar, segmento = todo. Número amarillo si >0 | — |
| KPI "Vida útil vencida" | idem | Toggle `vencidos`; segmento = equipo. Rojo si >0 | — |
| KPI "Bajo stock" | idem | Toggle `bajoStock`; segmento = recurso. Amarillo si >0 | — |
| KPI "Sin foto" | idem | Toggle `sinFoto`; segmento = recurso. Amarillo si >0 | — |
| KPI "Revisado %" | idem | Toggle `aRevisar` (lo no revisado en 92 días); segmento = todo. Barra de progreso; `title` "Revisado = última revisión de hace menos de 3 meses" | — |
| Mensaje / error | Bajo KPIs | `.tool-info` / `.tool-error` persistentes | — |
| Segmentado Recursos / Equipos / Todo | Toolbar | Cambia segmento y quita el filtro KPI. **Default: Recursos** | — |
| Buscador | Toolbar | `type=search`, filtra en vivo por nombre, detalle, categoría, subcategoría, condición (contiene, minúsculas) | — |
| Filtro de condición | Toolbar | `SelectField`: Toda condición, Excelente, Bueno, Regular, Malo, Sin revisar | — |
| Vista Tarjetas ▦ / Tabla ☰ | Toolbar | Cambia vista; `title` "Tarjetas"/"Tabla". No se recuerda | — |
| "Todo el inventario" | Árbol | Quita la selección de categoría (vuelve a portada si no hay filtros) | — |
| Caret de categoría | Árbol | Expande/contrae subcategorías (`aria-expanded`) | Solo si tiene subcategorías |
| Nombre de categoría | Árbol | Selecciona categoría (sin sub) | — |
| Subcategoría | Árbol | Selecciona categoría+sub | Solo con la categoría expandida |
| Breadcrumb "Categorías" | Main | Quita selección | — |
| Breadcrumb categoría | Main | Selecciona la categoría sin sub | Con selección |
| Contador | Breadcrumb | "N categorías" en portada, "N ítems" en listado | — |
| Banner de KPI activo + "Quitar filtro" | Main | Texto del filtro (`KPI_LABELS`) y botón que lo quita (el segmento queda) | Con KPI activo |
| Tarjeta de categoría (portada) | Main | Abre la categoría y **la expande en el árbol**. Muestra foto de portada, total, "X equipos, Y recursos" si hay ambos, "N con problema" y "N a revisar" | Portada = sin selección y sin búsqueda/KPI/condición |
| Tarjeta de subcategoría | Fila sobre el listado | Selecciona esa sub; tocar la activa vuelve a la categoría entera. Miniatura de la primera foto | Si la categoría tiene subcategorías |
| Tarjeta de ítem (grilla) | `InventoryCard` | Foto (o alias en grande para equipos / iniciales para recursos) y título: ambos abren el detalle | — |
| Fila (tabla) | `.inv-table` | Abre el detalle; `clickableProps` (Enter/Espacio); `is-selected` + `aria-selected` para la abierta. Columnas: Foto, Recurso, Categoría, Seguimiento (Individual/Stock), Stock/vida (warn si bajo stock o vencida), Condición (punto de color), Revisión (warn si vieja) | — |
| Vacío | Main | "No hay nada para este filtro." | — |
| Detalle | Modal `wide` | `InventoryDetail` (§9) | — |

**Micro-interacciones y atajos:**
- Los KPI son filtros y además cambian el segmento; tocar el mismo KPI otra vez lo apaga, pero el segmento queda donde lo dejó.
- Si hay búsqueda, KPI o filtro de condición, se saltea la portada de categorías y se lista directo.
- Abrir una categoría desde la portada la expande en el árbol.
- El detalle se resuelve por `key` contra las entradas vivas: después de guardar, el modal muestra el dato nuevo sin cerrarse.
- Tarjetas: hover sube 2 px (`components.css` `.inv-card:hover`); la imagen rota (`onError`) cae al placeholder.
- Cartelitos apilados en la tarjeta: "Bajo stock", "Vida útil vencida", "Revisar" (tenía condición pero vieja), "Sin foto" (solo recursos).
- Tarjeta de recurso con unidades: "N detalladas · M con falla".
- Vida útil en tarjeta: clase `is-due` desde 80 %, `is-over` vencida.
- No hay atajos de teclado en la página; no hay ordenamiento por columnas en la tabla; no hay selección múltiple.

**Estados:** sin skeleton en la carga inicial (lista vacía hasta que llega); mensajes/errores inline persistentes; confirmación al ocultar; sin toasts.

**Controles nativos o fuera de sistema a reemplazar:**
- `<details>/<summary>` como menú (`InventoryPage.tsx:319-328`): no cierra al hacer click afuera ni al elegir una opción.
- `input type=file` oculto (`:330`) y otro dentro de un `<label class="btn">` para la foto (`:514-517`).
- `input type=search` (`:374`).
- `title=` en KPI Revisado y en el toggle de vista (`:357, :383-384`). Íconos del toggle son caracteres Unicode (▦ ☰).
- `style={{ padding, fontSize }}` inline en el árbol vacío (`InventoryTree.tsx:56`).

**Mobile:** ≤1100 px el árbol pasa arriba (una columna, sin sticky) (`components.css:2578-2581`); la tabla tiene `overflow:auto` propio (`.inv-table-wrap`); grilla `auto-fill minmax(190px,1fr)`. Verificar los KPIs (flex-wrap) a 360 px.

**Riesgos para el rediseño:**
- KPIs se calculan sobre todas las entradas, no sobre lo filtrado (a propósito: son la puerta de entrada al filtro).
- La subcategoría de un equipo es su modelo: cambiar modelo lo mueve en el árbol.
- Cambiar la condición de un equipo desde el detalle manda `assetClass: entry.categoria` (`InventoryPage.tsx:231`): fija la clase de activo a la categoría actual aunque fuera derivada.
- `conditionClass` está duplicada (`InventoryCard.tsx:12-16` y `inventoryEntries.ts:60-64`): las clases CSS `is-excelente|is-bueno|is-regular|is-malo|is-sin-revisar` dependen del texto sin acentos.
- El filtro "Sin foto" cuenta recursos sin `imagenUrl`; una imagen rota no cuenta.

---

## 9. Detalle de ítem y alta/edición de recurso (`InventoryDetail.tsx` + form en `InventoryPage.tsx`)

**Detalle (modal `wide`, título = nombre):**

| Control | Dónde | Qué hace exactamente | Condiciones |
|---|---|---|---|
| Foto | Izquierda | Imagen o texto (alias del equipo / "Sin foto") | — |
| Categoría › sub, detalle | Arriba | Texto | — |
| `<dl>` | Centro | Recurso: Stock, Bajo stock (Sí/No). Equipo: Vida útil (% consumida / Vencida / —), Renovación. Ambos: Seguimiento (Individual/Por stock), Revisión (warn si vieja) | — |
| "Condición" | Centro | `SelectField` (Sin revisar + 4). Equipo → `PATCH /devices/:etiqueta/metadata { condition, assetClass, origen:'Inventario' }` + refresco forzado de equipos. Recurso → `PATCH /inventory/items/:id { condicion, revisado:true }` (refresca la fecha aunque el valor no cambie) + recarga. Mensaje "Nombre: condición." | Deshabilitado en consulta |
| "Ver ficha" | Acciones | Cierra el detalle y abre `DeviceProfile` | Solo equipos |
| "Editar" | Acciones | Cierra el detalle y abre el form de edición | Solo recursos; deshabilitado en consulta |
| "Ocultar" | Acciones | `confirmDialog` danger "¿Ocultar X del inventario?" → `DELETE` (soft: `activo=0`, `deleted_at`, `deleted_by`) → cierra y recarga. **Sin Deshacer ni papelera** | Solo recursos; deshabilitado en consulta |
| Identificación (equipos) | Sección | Etiqueta, Número de serie, MAC ("—" atenuado si falta) | Solo equipos |
| "TeamViewer ID" + "Guardar" | Identificación | Input (placeholder "No aplica en Chrome OS") y botón que manda solo `teamviewerId` (no toca la fecha de revisión). Botón deshabilitado si no cambió | Deshabilitado en consulta o guardando |
| Unidades | Sección | `InventoryUnits` (§10) | Solo recursos |

**Form "Agregar recurso" / "Editar recurso" (modal):**

| Control | Qué hace | Condiciones |
|---|---|---|
| Foto ("obligatoria") | Vista previa; botón "Subir foto" / "Cambiar foto" / "Subiendo..." sobre `input file accept=png,jpeg,jpg,webp`. Lee como data URL y sube a `/uploads/inventory/SEDE/…` (límite `maxUploadMb`) | Deshabilitado en consulta o subiendo |
| Nombre | Texto `required` | Obligatorio |
| Categoría | `SelectField` con fijas (Arduino, Robótica, Electrónica, Sensores, Cables, Cargadores, Componentes, Herramientas, Filamento 3D, Otro) + las usadas, orden es | — |
| Subcategoría | Texto con `<datalist>` de subcategorías de esa categoría | Opcional |
| Cantidad | `number min=0` | — |
| Unidad | Texto (default "unidades") | — |
| Stock mínimo | `number min=0` (default 3) | — |
| Condición | `SelectField` Sin revisar + 4 | — |
| Observaciones | `textarea` | — |
| "Cancelar" / "Agregar recurso" o "Guardar cambios" | Pie sticky (`modal-actions-sticky`) | Guardar deshabilitado si `busy`, subiendo o en consulta |

Reglas: sin foto → error "Subí una foto del recurso: es obligatoria." (y el server también la exige en alta); en edición el server **no deja quitar** una foto existente; mientras guarda, el modal no se puede cerrar (`onClose` ignora con `busy`). Editar la ficha no cuenta como revisión salvo que la condición cambie.

Importación CSV (server `inventory.routes.js:171-246`): parser propio con comillas; encabezados flexibles (sin acentos, `_`/`-` = espacio, sinónimos en/es); match por **nombre** (case-insensitive); si la fila no trae foto o condición, conserva las existentes (y lo cuenta); una condición en el CSV cuenta como revisión de hoy; reactiva ítems ocultos con el mismo nombre; todo en una transacción.

**Controles nativos:** `input type=number` (`InventoryPage.tsx:536, 540`), `<datalist>` (`:531-532`), `input type=file` (`:516`), `required` nativo (`:520`).

---

## 10. Unidades de un recurso (`src/components/inventory/InventoryUnits.tsx`)

**Para qué sirve:** detallar cada unidad de un recurso (número, condición, descripción, SN, MAC, TeamViewer) sin duplicar la ficha.

**Datos:** `GET /api/inventory/items/:id/units`, `POST /api/inventory/items/:id/units`, `PATCH /api/inventory/units/:unitId`, `DELETE /api/inventory/units/:unitId` (soft). Cada respuesta trae `units` y el `item` con contadores nuevos, que se reemplaza en la lista sin recargar (`onItemChange`).

**Controles:**

| Control | Qué hace | Condiciones |
|---|---|---|
| Resumen | "N unidades cargadas · M con falla" o "Todavía no se detalló ninguna unidad" (skeleton mientras carga) | — |
| "Crear las N" | Crea N unidades vacías **una por una en serie** (tope 60), numeradas automáticamente | Solo sin unidades, cantidad > 1, fuera de consulta |
| "Agregar unidad" | Abre form vacío al final | Fuera de consulta |
| Fila de unidad | `#número`, punto de condición, descripción (o "Sin observaciones"), SN/MAC/TeamViewer | — |
| "Editar" / "Cerrar" | Abre/cierra el form inline de esa unidad | Fuera de consulta |
| Form: Número | Placeholder "Automático" (server: máximo existente + 1) | — |
| Form: Condición, Descripción ("Ej: no carga"), SN, MAC, TeamViewer ("No aplica en Chrome OS") | Campos | Todos opcionales |
| "Quitar" | `confirmDialog` danger "¿Quitar la unidad #N?" → soft delete | Solo en edición |
| "Cancelar" / "Guardar unidad" | Cierra / guarda (Enter también envía) | — |

Texto de ayuda cuando no hay unidades. "Con falla" = Regular o Malo. A diferencia de los ítems, la fecha de revisión de una unidad solo se actualiza si la condición **cambia**.

**Riesgos:** "Crear las N" son N requests en serie (con Supabase puede tardar varios segundos, sin progreso). Solo un form abierto a la vez (`editing`).

---

## 11. Recorrido de revisión de condición (`src/components/inventory/ConditionReviewModal.tsx`)

**Para qué sirve:** calificar rápido, uno por uno y con teclado, la condición de todo lo de la sede.

**Datos:** `GET /api/devices/review-queue` (cacheado 15 s): equipos ordenados "nunca revisados primero, después la revisión más vieja, luego etiqueta", más `assetClasses` de la sede. Los recursos se agregan después de los equipos: primero sin condición, luego por nombre (**no** por antigüedad de revisión). Guardar: equipo → `PATCH metadata { condition, assetClass, origen:'Revisión' }`; recurso → `PATCH item { condicion, categoria, revisado:true }`. No hay sesión guardada: al reabrir, la cola se recalcula y "retoma".

**Controles:**

| Control | Qué hace | Condiciones |
|---|---|---|
| Progreso | "i de N" + "M con condición cargada" + barra | — |
| Sujeto | Título, detalle, "Última revisión: X" si tenía | — |
| "Clase de activo" / "Categoría" | `SelectField` precargado con la clase actual; el valor elegido **se guarda junto con la condición** | — |
| Botones Excelente / Bueno / Regular / Malo | Con `<kbd>` 1-4; guardan y avanzan | Deshabilitados mientras guarda |
| "Saltar" | Avanza sin guardar | — |
| "Salir" / "Cerrar" (al terminar) / X / Escape / backdrop | Llama `onDone` (refresca equipos e ítems) y cierra | — |
| Pantalla final | "Recorrido terminado · N ítems calificados en esta pasada." | — |

**Atajos de teclado** (`window` keydown, `ConditionReviewModal.tsx:108-127`): `1`–`4` califican; `S` (o `s`) salta; Escape sale (por `Modal`). Se ignoran si el foco está en `INPUT`, `SELECT` o `TEXTAREA`. **No** se chequean Ctrl/Meta/Alt: `Ctrl+S` salta el ítem y anula el "Guardar página" del navegador; `Ctrl+1` califica. Si el foco está en el `SelectField` de clase (que no es un `<select>` nativo), `1`–`4` también califican.

**Estados:** skeleton; "No hay nada para revisar en esta sede."; error inline "No se pudo guardar. Probá de nuevo." (no avanza).

**Riesgos:** el listener es global mientras el modal está abierto; si se reescribe con otro componente de select, revisar el filtro por `tagName`.

---

## 12. Historial (`src/components/history/HistoryPage.tsx`)

**Para qué sirve:** buscar en todo el historial de la sede (préstamos/devoluciones o todos los movimientos) con filtros y paginado.

**Quién la ve:** ítem "Historial" del sidebar con `requiresAny: ['loans','devices']` (`Sidebar.tsx:46`). Es solo lectura (no le afecta consulta). Server: `GET /api/history` solo pide sede válida, **no chequea permisos de módulo**.

**Datos:**
- `GET /api/history?kind=loans|all&q&from&to&tipo&before&limit=50` (`historyApi.ts`, cacheado 15 s por `apiGet`).
- `kind=loans`: tabla `loan_events`, búsqueda en etiqueta+alias+persona+curso+ubicación+operador+motivo; `tipo` = `prestamo|devolucion`.
- `kind=all`: unión de `local_movements`, `agenda_history` (+ curso/actividad) y `task_history`; cada parte filtra y limita por separado, se mezclan y cortan; `cursor_id = id*10 + fuente` para que sea único.
- Paginado por cursor `timestamp|cursorId` (`nextCursor` vacío = no hay más). `limit` máximo 200.
- Fechas: `from` inclusive, `to` incluye el día entero (se compara con el día siguiente). La comparación es contra el `timestamp` ISO **en UTC**: un préstamo a las 22:00 de Argentina cae en el día siguiente.
- Al abrir la ficha desde una etiqueta usa `devices` (todos), comparando en mayúsculas.

**Controles:**

| Control | Dónde | Qué hace exactamente | Condiciones |
|---|---|---|---|
| Tabs "Préstamos" / "Todos los movimientos" | Head, `role=tablist` | Cambia `kind` y recarga desde cero. Píldora deslizante (`useTabPill`, receta transitions.dev). Conserva búsqueda y fechas | — |
| "Buscar" | Filtros | Texto con **debounce 300 ms**; placeholder según tab ("Persona, equipo (D1436, Touch 34), curso, ubicación…" / "Descripción, equipo, operador…") | — |
| "Desde" / "Hasta" | Filtros | `DateField` (calendario propio) | — |
| "Tipo" | Filtros | `SelectField`: Préstamos y devoluciones / Solo préstamos / Solo devoluciones | Solo en tab Préstamos |
| "Limpiar" | Filtros | Borra búsqueda, fechas y tipo | Solo si hay algún filtro (cuenta `tipo` aunque estés en "Todos") |
| "Exportar CSV" | Filtros | CSV en el cliente de **lo ya cargado** (no de todo el historial): préstamos 12 columnas (`historial_prestamos_FECHA.csv`), movimientos 6 (`historial_movimientos_FECHA.csv`), con BOM | Deshabilitado sin ítems |
| Etiqueta (tab Préstamos) | Columna Equipo | `link-button` que abre la ficha | Solo si la etiqueta existe en los equipos actuales; si no, texto en negrita |
| "Cargar más" | Pie | Trae la página siguiente con `before=cursor` y la agrega; "Cargando…" | Solo si hay cursor; muestra "N cargados" |

Tabla Préstamos: Fecha, Tipo (badge Préstamo/Devolución), Equipo (+alias), Persona (+rol), Curso / ubicación, Motivo (+"Accesorios: …"), Operador. Tabla Todos: Fecha, Origen, Movimiento (tipo + descripción), Operador. Filas no clickeables, sin orden por columnas (siempre más nuevo primero).

**Micro-interacciones:**
- Cada cambio de filtro arranca de cero; las respuestas viejas se descartan por `requestId` (también en "Cargar más" si cambiaste filtros mientras cargaba).
- La búsqueda no normaliza alias: `Touch 34` funciona, `touch34` no.
- Tabs sin navegación con flechas (solo Tab + Enter).

**Estados:** skeleton de 6 líneas de ancho decreciente; vacío "No hay resultados para esos filtros." / "Todavía no hay movimientos registrados."; error inline (la tabla anterior queda visible debajo).

**Controles nativos:** ninguno (DateField y SelectField propios).

**Mobile:** filtros 2 columnas ≤980 px (buscar y acciones a todo el ancho), 1 columna ≤640 px; tabla a tarjetas ≤640 px con `data-label` (`components.css:5141-5154`). La grilla mobile necesita que cada `<td>` tenga **un solo hijo** además del `::before`: por eso el contenido de varias celdas va envuelto en `<div>` (`HistoryPage.tsx:162-174`).

**Riesgos:** `.history-switch` tiene `overflow-x:auto` (scroll horizontal interno de los tabs); `useTabPill` mide el DOM (necesita `data-tab-active` y el `ref` en el contenedor).

---

## 13. Componentes muertos o desalineados con la documentación

- `DeviceCard.tsx`: no lo importa nadie. Candidato a borrar o a reutilizar como tarjeta mobile.
- `CLAUDE.md` describe `mergeStateOverrides` con ventana de 90 s y `POST /api/devices/sync-from-sheet`: **ninguno de los dos existe** en el código actual (`grep` sin resultados). El merge real (`deviceInventory.service.js:132-176`) es: si hay `local_states`, gana siempre.
- `GET /api/devices/state` y `GET /api/devices/diagnostics` existen; no se usan en esta área.
- `GET/PATCH /api/lifecycle/defaults` (vida útil por clase de activo y sede) existe en `devices.routes.js:182-214`; su UI no está en esta área (probablemente Configuración). Afecta lo que muestran Inventario y la ficha.

---

## Lista de verificación

### Dispositivos
- [ ] KPIs Total / Disponibles / Prestados / una por categoría / No encontradas / Fuera de servicio, con conteo animado, filtran la tabla y marcan la activa (`aria-pressed`)
- [ ] Título del filtro activo + "N equipos visibles"
- [ ] Buscador por etiqueta/alias: `touch 34`, `touch34`, `34touch`, `34 touch`, `D1436`, `1436`, `plani 5`, `planificación 5`, `plan 5`
- [ ] Buscar fuerza orden por número operativo
- [ ] Select de orden: original / por número operativo
- [ ] Importar CSV por URL (vacía = URL de la sede) con resumen de leídos/nuevos/actualizados/reactivados/omitidos/errores
- [ ] Importar reactiva equipos de la papelera presentes en el CSV
- [ ] Exportar inventario, resumen, movimientos y préstamos activos (CSV con BOM)
- [ ] Exportar PDF QR de los equipos visibles (payload `TA|etiqueta|sn|mac`, imprime solo), aviso si se bloquea el popup
- [ ] Botones Grupos y Papelera
- [ ] "+ Añadir dispositivo"
- [ ] Mensaje inline de resultado/error
- [ ] Estado vacío
- [ ] Consulta: sin importar, sin añadir, sin acciones de escritura ni selección; ficha sí
- [ ] Cambio de sede reinicia filtros y selección

### Tabla de equipos
- [ ] Columnas Etiqueta(+alias), Dispositivo(+modelo), SN (o MAC), Prestado a (+ubicación·curso, fecha y antigüedad), Última devolución, Estado (badge), Acciones
- [ ] "Perdida" se muestra como "No encontrada"; "Disponible/Prestado/Devuelto" en celdas de texto se muestran como "-"
- [ ] Click en fila, Enter y Espacio abren la ficha
- [ ] Checkbox y acciones no abren la ficha (click ni teclado)
- [ ] Prestar solo en disponibles → navega a Préstamos con el equipo
- [ ] Devolver solo en prestados, en el acto, con "Devolviendo..." y sin devoluciones simultáneas
- [ ] Ficha, Editar, Borrar (con confirmación y "Borrando...")
- [ ] Modo dashboard: sin Ficha, sin Borrar, sin selección
- [ ] Render progresivo 12 → 30, "Ver más" (+30), "Ver todos", "N de M"
- [ ] `data-device-tag` en cada fila
- [ ] Mobile ≤760 px: filas como tarjetas con etiquetas de columna
- [ ] Sin scroll horizontal a 360 px

### Borrar, Deshacer y papelera
- [ ] Borrar = ocultar (historial intacto), toast con "Deshacer" (7 s) que restaura
- [ ] Papelera: lista con alias, categoría, modelo, fecha y quién borró, orden más reciente primero
- [ ] Buscador de papelera cuando hay más de 6
- [ ] Restaurar (deshabilitado en consulta), toast, lo saca de la lista
- [ ] Skeleton, vacío y error

### Selección y lote
- [ ] Checkbox por fila y "seleccionar todos los visibles" (toggle)
- [ ] Barra flotante con contador, encima del MobileNav en mobile
- [ ] Prestar N (solo disponibles) → Préstamos con el lote
- [ ] Devolver N (solo prestados) con confirmación listando etiquetas y resultado parcial
- [ ] Cambiar estado (5 opciones) excluyendo prestados, con aviso
- [ ] Borrar N con confirmación y Deshacer
- [ ] Limpiar
- [ ] Botones deshabilitados mientras corre una acción

### Alta / edición
- [ ] Campos: Etiqueta, Número operativo, Categoría (sugerencias), Filtro, Dispositivo, Marca, Modelo, Serial, MAC, Estado, Alias operativo (varios con coma), Observaciones
- [ ] Etiqueta y categoría obligatorias
- [ ] Editar con renombre de etiqueta conserva condición/clase/vida útil
- [ ] Error inline, "Guardando..."

### Grupos
- [ ] Lista de grupos con cantidad, crear, editar nombre/descripción/miembros, eliminar con confirmación
- [ ] Click en el nombre de un equipo del picker abre su ficha
- [ ] Un equipo en un solo grupo (moverlo lo saca del anterior)
- [ ] Contexto del asistente con el grupo elegido
- [ ] Todo deshabilitado en consulta

### Ficha de equipo
- [ ] Hero con etiqueta, alias, tipo/fabricante/modelo y badge de estado
- [ ] Condición (autoguarda), vida útil en meses (guarda al salir, placeholder con el default), fecha de alta (vacía si es estimada)
- [ ] Resumen IA con fecha
- [ ] Información básica (10 campos)
- [ ] Estadísticas (6)
- [ ] Préstamo activo
- [ ] Grupo con miembros navegables
- [ ] Actividad reciente (12) con accesorios
- [ ] Tickets relacionados (8) con link a Tickets
- [ ] Mantenimiento + "Compra/Garantía: no registrada"
- [ ] Recordatorios: agregar (texto + fecha/hora) y completar
- [ ] Contexto del asistente al abrir/cerrar
- [ ] Se abre desde Dispositivos, Dashboard, Inventario, Historial, Grupos, miembro de grupo y asistente

### Inventario TIC
- [ ] Equipos y recursos juntos con condición, revisión, vida útil y stock
- [ ] Regla única de revisado: 92 días
- [ ] KPIs Equipos, Recursos, Regular o malo, Vida útil vencida, Bajo stock, Sin foto, Revisado % (con barra y tooltip); cada uno filtra y cambia el segmento; toggle off
- [ ] Banner de KPI activo con "Quitar filtro"
- [ ] Segmentado Recursos (default) / Equipos / Todo
- [ ] Buscador y filtro de condición (incluye "Sin revisar")
- [ ] Vista tarjetas / tabla
- [ ] Árbol: Todo el inventario, categorías con contador, expandir/contraer, subcategorías
- [ ] Breadcrumb navegable con contador
- [ ] Portada de categorías (foto, totales, con problema, a revisar) cuando no hay filtros; abrir expande el árbol
- [ ] Fila de subcategorías con miniatura, toggle
- [ ] Tarjeta: foto o alias/iniciales, cartelitos, condición, cantidad o % de vida, unidades detalladas
- [ ] Tabla: 7 columnas, fila con teclado, fila abierta resaltada
- [ ] Menú Importar/exportar: Exportar CSV (lo filtrado), Descargar plantilla, Importar CSV (conserva fotos y condiciones)
- [ ] Revisar condición, Agregar recurso
- [ ] Consulta: todo lo de escritura deshabilitado
- [ ] Árbol arriba en ≤1100 px

### Detalle / recurso / unidades
- [ ] Detalle en modal con datos según tipo
- [ ] Condición desde el detalle (recurso: cuenta como revisión aunque no cambie)
- [ ] Ver ficha (equipo), Editar y Ocultar con confirmación (recurso)
- [ ] Identificación del equipo: etiqueta, SN, MAC, TeamViewer ID editable
- [ ] Form de recurso con foto obligatoria (subida PNG/JPG/WEBP), nombre, categoría, subcategoría sugerida, cantidad, unidad, stock mínimo, condición, observaciones
- [ ] No se puede quitar una foto ya cargada; modal no cierra mientras guarda
- [ ] Unidades: crear las N (máx. 60), agregar, editar inline, quitar con confirmación, numeración automática, contador "con falla"

### Recorrido de revisión
- [ ] Cola: equipos nunca revisados → más viejos; luego recursos sin condición → por nombre
- [ ] Progreso y barra
- [ ] Clase de activo / categoría editable que se guarda con la condición
- [ ] Teclas 1-4, S, Escape; botones con `kbd`
- [ ] Saltar, Salir, pantalla final con conteo
- [ ] Al cerrar refresca equipos y recursos

### Historial
- [ ] Tabs Préstamos / Todos los movimientos con píldora deslizante
- [ ] Búsqueda con debounce 300 ms
- [ ] Desde / Hasta (hasta inclusive)
- [ ] Tipo (solo préstamos)
- [ ] Limpiar
- [ ] Exportar CSV de lo cargado
- [ ] Etiqueta abre la ficha si el equipo existe
- [ ] Accesorios en la columna Motivo
- [ ] Cargar más (cursor) con "N cargados"
- [ ] Descarta respuestas viejas
- [ ] Skeleton, vacíos distintos con/sin filtros, error
- [ ] Mobile: filtros apilados y tabla a tarjetas ≤640 px

---

## Ideas de mejora (opcionales, no son parte de lo existente)

1. **Unificar la búsqueda** en un solo motor (`matchesSmartSearch` con modo "contiene" para alias) para Dispositivos, Inventario, Historial y un buscador global; hoy son cuatro con resultados distintos. En Historial, normalizar el alias en SQL o resolver la etiqueta en el front antes de consultar.
2. **Recuperar el buscador global** (el estado `search` de `App` y sus tres efectos ya existen) o borrarlo.
3. **Selección acotada a lo visible**: limpiar o mostrar "N seleccionados ocultos por el filtro" al cambiar filtro; agregar shift-click para rango.
4. **Ordenamiento por columnas** en Dispositivos, tabla de Inventario e Historial (no existe hoy).
5. Lotes en el server (`/devices/status-batch`, `/devices/delete-batch`, `/inventory/items/:id/units/batch`) en vez de N requests en serie.
6. Generar los QR en el cliente (sin `api.qrserver.com`) y sin `document.write`.
7. Papelera también para recursos del Inventario TIC (hoy "Ocultar" no tiene vuelta atrás desde la UI).
8. Arrastrar `local_states`, grupo y (opcionalmente) historial al renombrar una etiqueta; o bloquear el renombre.
9. Quitar "Estado" del formulario de edición o hacer que escriba en `local_states`, para que no parezca que no guarda.
10. Try/catch y toast en Guardar/Eliminar grupo y "Completar" recordatorio; no tragar errores en el Deshacer de lote.
11. Atajos del recorrido de revisión: ignorar con Ctrl/Meta/Alt.
12. Fechas del Historial en la zona horaria de la sede, no en UTC.
13. Links de tickets en la ficha por navegación interna, abriendo el ticket puntual.
14. Exportar CSV del Historial completo desde el server (no solo lo cargado).
15. Actualizar `CLAUDE.md` (sacar `mergeStateOverrides`/90 s y `sync-from-sheet`).
