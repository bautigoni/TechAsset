# 07 · Auditoría técnica: design system y rendimiento

Relevamiento hecho el 16/10/2026 sobre la rama `rediseno-grafito` (base `83f97e4`), sin tocar código. Los números salen de mediciones reales: `npm run build`, scripts de conteo sobre `src/styles/*.css` y el banco `perf/` corrido con CPU 4× más lenta. Al final de cada sección hay una lista de qué hacer.

Objetivo del rediseño: tema oscuro grafito y tema claro completo, acento `#5B9BFF`, tipografía Geist / Geist Mono, sin perder velocidad.

---

## 1. Arquitectura CSS actual

### 1.1 Archivos

Todo el CSS entra por **un único `import './styles/global.css'`** en `src/main.tsx:3`, que a su vez hace `@import` de los demás. **No hay CSS por chunk**: cada usuario, incluso en el login, descarga el CSS de todas las pantallas.

| Archivo | Líneas | Bytes | Reglas `{` | Comentario |
|---|---:|---:|---:|---|
| `variables.css` | 135 | 4.774 | 3 | Tokens: `:root`, `:root.theme-light` y el perfil smart |
| `global.css` | 691 | 15.968 | 119 | Hace los `@import` y define el shell, el asistente de IA y algunos utilitarios |
| `components.css` | 5.190 | 246.180 | 2.421 | Es el ex `legacy.css`, con mucho escrito minificado en una línea. Tiene el 76 % del CSS |
| `layout.css` | 1.925 | 38.717 | 338 | Tiene que cargar **después** de components (`global.css:2-3`) |
| `responsive.css` | 1.324 | 32.979 | 265 | 89 `!important` |
| `auth.css` | 750 | 16.756 | 118 | Landing y login, con tokens locales propios (`--paper`, `--ink-2`, `--mute`, `--hair`) |
| `nav-smart.css` | 898 | 26.271 | 173 | Tema B "Smart Campus" (claro crema) + navs variantes |
| `motion.css` | 1.207 | 46.487 | 215 | Sistema de movimiento (transitions.dev). Va último a propósito |
| **Total** | **12.120** | **428.132** | **3.652** | Salida del build: **322,97 kB / 58,18 kB gzip** |

`src/styles/transitions/` es solo el catálogo de recetas: 27 `.md` sueltos más 9 carpetas Pro (`css.md`, `react.md`, `typescript.md`). No se importa y no suma al bundle.

### 1.2 Tokens existentes (`variables.css`)

- **Color base:** `--bg #09101d`, `--panel #121b2d`, `--panel-2 #16264a`, `--border #2c3d5f`, `--text #e8eefb`, `--muted #99a9c6`, `--blue #3b82f6`, `--green`, `--yellow`, `--red`.
- **Superficies:** `--surface`, `--surface-raised` (= `--panel-2`), `--surface-border`, `--surface-border-strong`, `--surface-shadow`, `--surface-shadow-hover`, `--surface-inset`.
- **Charts:** `--chart-1..5`. **Casi no se usan**: 2 referencias fuera de `variables.css`, porque `ChartCard.tsx:6` tiene su propia `PALETTE` hardcodeada.
- **Layout:** `--topbar-h: 62px`, `--radius: 16px`.
- **Movimiento:** `--ease-out`, `--ease-spring`, `--duration-fast/base/slow`. `motion.css` arma encima `--m-*` y, por receta, `--modal-*`, `--toast-*`, `--dropdown-*`, `--tabs-*`, `--toggle-*`, `--pulse-*`, `--stagger-*`, `--resize-*` y `--goo-*`.
- **Solo en el perfil smart:** `--accent`, `--accent-soft`, `--accent-light`, `--glass-*`, `--card-radius`, `--card-shadow`, `--navy-50/100`. Ojo: **`auth.css` usa `var(--accent)` sin fallback** y en el tema clásico esa variable **no está definida**.
- Hay 151 custom properties definidas. Se usan algunas que nunca se definen: `--bar-color`, `--bar-height`, `--card`, `--card-basis`, `--column-color`, `--task-progress`, etc. La mayoría se setean inline desde JS.
- Las más usadas: `--border` (325 usos), `--muted` (297), `--text` (202), `--panel-2` (170), `--blue` (169), `--panel` (69) y `--accent` (50).
- **No hay escala** de espaciado, tipografía, radios, sombras ni z-index. Medido:
  - font-size: 40 valores distintos en 528 declaraciones.
  - font-weight: 9 valores (400, 500, 550, 600, 650, 700, 750, 800 y 850).
  - border-radius: 33 valores distintos en 476 declaraciones.
  - box-shadow: 136 valores distintos en 166 declaraciones.
  - z-index: 24 valores distintos, de -1 a 10000.
  - breakpoints: más de 20 anchos distintos (980px aparece 43 veces; además 700, 640, 560, 900, 760, 600, 480, 768, 1280, 1100…).

### 1.3 Cómo funciona hoy el tema claro

- `src/utils/themeProfile.ts:40-45`, `applyThemeProfile()`:
  - pone `data-theme-profile="<perfil>"` en `<html>`;
  - pone o saca la **clase `.theme-light`** en `<html>`.
- Se aplica antes del primer render (`main.tsx:11`) para evitar el flash. Se persiste en `localStorage` (`techasset_theme_profile`) y en el server (`saveUserPrefs`, `/api/user/prefs`).
- Hay **8 perfiles**: `classic`, `classic-stairs`, `classic-centered`, `classic-peek`, `smart`, `smart-stairs`, `smart-centered` y `smart-peek`. El perfil mezcla **dos ejes**: tema (classic = oscuro, smart = claro crema) y estilo de navegación (normal, escalera, centrada, peek).
- El toggle de la topbar (`App.tsx:336-341`) y Configuración › Apariencia (`AppearancePanel.tsx`) alternan classic ↔ smart y conservan el estilo.
- **El "tema claro" real que ve el usuario es el Smart Campus crema**, no el azul de `:root.theme-light`. El azul claro solo se alcanza con la clave legacy `techasset_nfpt_theme=light`, que `saveThemeProfile` borra. Smart activa los dos a la vez: hereda los overrides de `.theme-light` y pisa sus variables.
- Cobertura medida (script sobre las declaraciones de color: color, background, border, shadow, fill, stroke, outline):

| Métrica | Valor |
|---|---|
| Declaraciones de color (todos los archivos) | 2.581 |
| Usan **solo tokens** (`var(--…)`) → se adaptan solas al cambiar de tema | **1.448 (56 %)** |
| Usan literales (`#hex`, `rgb()`, `white`/`black`) | 1.092 (42 %) + 41 mixtas |
| Reglas con colores literales, fuera de `variables.css` y sin ser override | **562** (539 sin `auth.css`) |
| Reglas override para claro (`.theme-light` + `[data-theme-profile]`) | **123** (40 bloques `.theme-light` en components, 77 smart en nav-smart, 6 en global) |
| Colores literales distintos | **623** |

**Conclusión:** el tema claro cubre aproximadamente lo que se pinta con tokens (~56 %) más unos 120 parches puntuales. Las ~560 reglas con literales quedan con valores pensados para el oscuro. Abundan los textos celestes (`#bfdbfe` ×18, `#93c5fd` ×16, `#cfe2ff` ×10, `#dbeafe` ×9) y los fondos `rgba(255,255,255,.02–.08)`, que en claro no se ven o no contrastan. Hoy no existe un tema claro completo: existe un oscuro con parches.

Literales más repetidos: `#fff` ×33, `#3b82f6` ×31 (el azul de `--blue` escrito a mano), `#bfdbfe` ×18, `#2563eb` ×17, `#22c55e` ×16, `#93c5fd` ×16, `#86efac` ×13, `rgba(255,255,255,.02)` ×13 y `#f59e0b` ×12.

Literales por archivo:

| Archivo | hex | rgb/rgba | `!important` | `@keyframes` | `@media` | guards reduced-motion |
|---|---:|---:|---:|---:|---:|---:|
| components.css | 253 | 532 | 169 | 6 | 94 | 5 |
| layout.css | 52 | 99 | 49 | 8 | 11 | 1 |
| nav-smart.css | 45 | 50 | 22 | 1 | 6 | 0 |
| variables.css | 45 | 20 | 0 | 0 | 0 | 0 |
| responsive.css | 14 | 53 | 89 | 0 | 16 | 0 |
| auth.css | 19 | 27 | 0 | 3 | 3 | 0 |
| global.css | 17 | 26 | 3 | 5 | 7 | 1 |
| motion.css | 1 | 11 | 17 | 14 | 5 | 4 |
| **Total** | **446** | **818** | **349** | **37** | **142** | **11** |

Colores literales en TS/JSX:

| Archivo | Literales |
|---|---:|
| `FloorMapPrimerPiso.jsx` | 48 |
| `FloorModelBase.jsx` | 33 |
| `NordeltaFloorKit.jsx` | 28 |
| `LandingPage.tsx` | 9 |
| `ChartCard.tsx` | 8 |
| `CanvasPage.tsx` | 6 |
| `TenantsDashboard.tsx` | 5 |
| `LoginPage.tsx` | 4 |
| `GooeyMenu.tsx` | 3 |
| `DevicesPage.tsx` | 3 |
| `Topbar.tsx` | 2 |
| `KnowledgePage.tsx` | 2 |
| `SiteAdminPanel.tsx` | 1 |

### 1.4 `color-scheme` y superficies del browser

- **El tema oscuro no declara `color-scheme: dark`**. Solo `nav-smart.css:515` declara `light` para smart. Por eso en oscuro los controles nativos se dibujan claros sobre fondo oscuro: el picker de `datetime-local`, el de `type=color`, el botón de `type=file`, los spinners de `number`, los checkboxes y el `<datalist>`.
- **Scrollbars: hay cuatro definiciones globales que compiten:**
  - `components.css:3148-3155`: `*{scrollbar-width:thin; scrollbar-color: rgba(59,130,246,.45) rgba(15,23,42,.32)}` más `*::-webkit-scrollbar` de 9px con degradé.
  - `components.css:3312-3315`: `::-webkit-scrollbar` de 6px.
  - `motion.css:1142-1153`: `:root{scrollbar-color:var(--border) transparent}` más `::-webkit-scrollbar` de 10px.
  - `nav-smart.css:518-528`: override smart con `*`.

  Desde Chrome 121, cuando hay `scrollbar-color`/`scrollbar-width` estándar, el browser **ignora los `::-webkit-scrollbar`**. En Chromium esos tres bloques no hacen nada, y gana el `*` de components, con color oscuro hardcodeado.
- Además hay dos scrollbars locales:
  - `.sidebar .nav-scrollable` (`components.css:2086-2097`): delgada, visible en hover.
  - `.tab-row` y `.agenda-day-selector` (`responsive.css:646-673`): ocultas en mobile.
- `::selection`, `caret-color` y `:focus-visible` están bien centralizados en `motion.css` §10 y se pueden conservar.

### 1.5 CSS muerto obvio

Método: extraje los nombres de clase de cada selector y los busqué como texto en `src/**/*.{ts,tsx,jsx}`, `index.html` y `server/`. Las clases armadas con template (`btn-${variant}`, `task-state-${…}`) cuentan como usadas. Es una aproximación: puede marcar de más algo armado por concatenación rara, así que hay que revisar antes de borrar.

| Archivo | Clases | Sin referencia | Ejemplos |
|---|---:|---:|---|
| components.css | 1.026 | **230** | `sidebar-footer`, `stats-grid-3`, `batch-*` (panel de lote viejo), `scanner-panel`, `scanner-video`, `sync-card`, `sync-grid`, `sync-mini`, `continuous-scan-control`, `switch-label`, `switch-ui`, `cell-stack`, `cell-pair` |
| layout.css | 184 | 17 | `auth-shell`, `auth-hero`, `auth-card` (login viejo), `procedures-list`, `map-placeholder`, `assistant-popup*`, `analytics-gauge*` |
| responsive.css | 192 | 27 | `sidebar-footer`, `tab-row`, `sync-mini*`, `topbar-logo`, `theme-icon-btn`, `petty-hero`, `analytics-risk-*` |
| nav-smart.css | 117 | 16 | `topbar-smart-*`, `classroom-coming-card`, `row-scanned`, `row-duplicate`, `sidebar-style-selector` |
| global.css | 41 | 4 | `page-actions`, `assistant-confirm*`, `assistant-topbar-btn` |
| motion.css | 81 | 3 | `switch-ui`, `assistant-bar-fill`, `stat-value` |
| auth.css | 61 | 1 | `auth-hint` |
| **Total** | **1.703** | **~298 (17,5 %)** | |

Además hay mucha redefinición: **604 selectores aparecen dos o más veces** y **193 tres o más veces**, sobre 2.890 selectores únicos. Por ejemplo:

| Selector | Definiciones | Dónde |
|---|---:|---|
| `.topbar` | 16 | 13 en components |
| `.sidebar` | 14 | |
| `.view` | 9 | |
| `.task-card` | 9 | repartidas en 4 archivos |
| `.topbar-actions` | 9 | |
| `.mobile-menu-btn` | 9 | |
| `.agenda-card` | 8 | |
| `body` | 7 | |
| `html` | 7 | |

### 1.6 Especificidad y `!important`

- Hay **349 `!important`**:
  - components.css: 169
  - responsive.css: 89
  - layout.css: 49
  - nav-smart.css: 22
  - motion.css: 17
  - global.css: 3

  Un ejemplo es `.topbar{position:sticky!important; top:0!important}` en `components.css:3157`.
- Los overrides de tema usan `:root.theme-light .x` y `:root[data-theme-profile^="smart"] .x`, de especificidad (0,2,1) o más, a veces con `!important` (`nav-smart.css:553-557`). **Un componente nuevo con clase simple (0,1,0) pierde contra todo eso.**
- La cascada depende del orden: components tiene que ir antes que layout (`global.css:2-3`) y motion último, porque pisa el `background` de `.modal`.
- Hay 21 selectores con `#id` en components.css y uno en responsive.
- `transition: all` aparece 5 veces. `backdrop-filter` aparece 18 veces: 8 en nav-smart, 4 en components, 4 en auth y 2 en global. Es caro en superficies grandes.
- `color-mix()` aparece 66 veces. Funciona en todos los navegadores objetivo.
- **Para la migración ojo con `@layer`:** meter lo viejo en `@layer legacy` y lo nuevo en una capa posterior **no alcanza**. Con `!important` el orden de capas se invierte: un `!important` de una capa anterior le gana a uno de una capa posterior. Los 349 `!important` legacy seguirían ganando. O se migra por pantalla y se borra el CSS viejo de esa pantalla, o primero se limpian los `!important` de las clases que se reescriben.

### 1.7 `motion.css` y animaciones

- `motion.css` está bien armado:
  - Tiene una tesis ("Operate") y un presupuesto explícito: transform y opacity siempre, blur solo en superficies únicas, sin `will-change` en listas y stagger hasta 10 elementos.
  - Tokens `--m-*` colgados de `variables.css`.
  - 11 secciones: modal, cambio de vista, toast, dropdown, tabs, números, error shake, gooey menu, superficies del browser, reduced motion y otras.
  - Tiene 14 de los 37 `@keyframes` del proyecto y 4 guards de `prefers-reduced-motion`. El guard final, §11 en `motion.css:1176`, cubre las clases `t-*`.
- Fuera de `motion.css` hay **23 `@keyframes`** repartidos. Los que siguen **no tienen guard** de reduced-motion:
  - `auth.css`: `auth-fade-up`, `auth-float`, `demo-enter` (el archivo tiene 0 guards).
  - `nav-smart.css:220`: `pulse-dot`.
  - `components.css`: `toastIn` (`:1038`), `pulse-card` (`:1315`), `taBounce` (`:1896`).
  - `layout.css`: `accountMenuIn` (`:407`), `taskDropPulse` (`:643`), `rowHighlight` (`:1452`).
- Hay **dos sistemas de toast**: `toastIn` en components y `.t-toast` en motion.
- Los hooks JS respetan reduced-motion: `useCardResize.ts:8` y `useMountTransition.ts:7`.
- Clases `t-*` que usa el código: `t-modal`, `t-toast`, `t-dropdown`, `t-tabs`/`t-tabs-pill`, `t-skel-*`, `t-stagger(-x)`, `t-digit(-group)`, `t-text-swap`, `t-input`, `t-msg-enter`, `t-resize`, `t-goo-*`, `t-fade`, `t-success-check`, `t-icon-swap`. **El rediseño tiene que conservar estos nombres** o migrarlos de forma coordinada: los usan los hooks `useMountTransition`, `useCloseChoreography`, `useTabPill` y `useCardResize`.

---

## 2. Controles nativos o fuera del sistema

### 2.1 Inventario

| Control | Cant. | Dónde (archivo:línea) | Estado |
|---|---:|---|---|
| `<select>` nativo | **0** | Ya reemplazados por `SelectField` (46 usos) | Hecho |
| `window.confirm/prompt/alert` | **0** | Solo un comentario en `RelatedReminders.tsx:25` | Hecho |
| `<dialog>` | **0** | Hay overlays propios con `role="dialog"`: `Modal.tsx:43`, `ClassroomInfoPanel.tsx:135/194`, `ReleaseNotesModal.tsx:56`, `DateField.tsx:107`, `QuickAccessPopover.tsx:47` | — |
| `type="date"` | 2 | `DateField.tsx:3` (solo comentario). Nativo real: `Feedback.tsx:168` cuando `promptDialog` recibe `inputType:'date'` | Falta conectar |
| `type="datetime-local"` | **3** | `RemindersPage.tsx:77`, y vía `promptDialog`: `RelatedReminders.tsx:29`, `RemindersPage.tsx:139` | **Popup nativo blanco en oscuro** |
| Hora como texto (`pattern="HH:MM"`) | **6** | `AgendaModal.tsx:33,34`, `SchedulesPage.tsx:294,304,404,416` | Necesita TimeField |
| `type="number"` | **12** | `AgendaModal.tsx:40`, `DeviceProfile.tsx:118`, `InventoryPage.tsx:536,540`, `PettyCashPage.tsx:149,237,258,282,290`, `InvitesPanel.tsx:102`, `LifecyclePanel.tsx:62`, `MailSettings.tsx:78` | Spinners nativos |
| `type="file"` | **10** | 4 patrones distintos, ver abajo | Sin componente |
| `type="color"` | 1 | `TenantsDashboard.tsx:225`. Además `SiteAdminPanel.tsx:75` pide el color como texto libre | Picker nativo |
| `type="checkbox"` | **19** | `CanvasPage.tsx:290,380`, `ClassroomCategoryManager.tsx:83`, `ClassroomInfoPanel.tsx:246`, `DeviceGroupsManager.tsx:96`, `DeviceTable.tsx:81,106`, `AllowedUsersPanel.tsx:136`, `LoanSettingsPanel.tsx:124,125`, `RolesPanel.tsx:90,100,101`, `SiteAdminPanel.tsx:78`, `TenantsDashboard.tsx:241`, `TaskCard.tsx:61,87`, `TicketDetailModal.tsx:103`, `TicketsPage.tsx:372` | Nativos con `accent-color` (6 reglas CSS) |
| `type="radio"` / `range` / `month` / `week` / `time` | 0 | — | — |
| `type="search"` | 7 | `Dashboard.tsx:137`, `DevicesPage.tsx:191`, `InventoryPage.tsx:374`, `KnowledgePage.tsx:79`, `SchedulesPage.tsx:159`, `TenantsDashboard.tsx:149`, `UsersByTenantPage.tsx:123` | La "x" nativa de WebKit sin estilo |
| `<datalist>` nativo | **4** | `AddDeviceModal.tsx:52-53`, `InventoryPage.tsx:531-532`, `PhotoPassPanel.tsx:231-232`, `SuggestionsPage.tsx:258-259` | Popup nativo (`PersonSuggestInput` ya reemplazó uno) |
| `<textarea>` | **24** | `AgendaCard.tsx:120`, `CanvasPage.tsx:281`, `ClassroomInfoPanel.tsx:280`, `DailyClosurePanel.tsx:33`, `InternalNotesPanel.tsx:50`, `AddDeviceModal.tsx:78`, `DeviceGroupsManager.tsx:85`, `InventoryPage.tsx:550`, `PettyCashPage.tsx:261,285`, `RemindersPage.tsx:71`, `AdvancedSettings.tsx:57`, `SuggestionsPage.tsx:267,294`, `TaskCard.tsx:160,168`, `TaskModal.tsx:67,108`, `TicketDetailModal.tsx:214`, `TicketsPage.tsx:453,473`, `TicketTemplateManager.tsx:110,133`, `QuickAccess.tsx:68` | Sin autosize ni contador |
| `<details>/<summary>` | **7** | `CanvasPage.tsx:372`, `ClassroomInfoPanel.tsx:302`, `ClassroomStatusPage.tsx:172`, `DailyClosurePanel.tsx:43`, `InventoryPage.tsx:320`, `AdvancedSettings.tsx:44`, `MailSettings.tsx:59` | Triángulo nativo, sin animación |
| `title=` como tooltip | **~30** | Ver la lista de abajo | Tooltip del SO, no accesible en touch |
| Scrollbars | global | Ver §1.4 | 4 definiciones en conflicto |

**`type="file"` en 4 patrones:**
- `label.btn` que envuelve el input: `CanvasPage.tsx:183`, `KnowledgePage.tsx:232`, `PettyCashPage.tsx:310`, `TaskModal.tsx:114`.
- Input `sr-only` disparado por ref: `InventoryPage.tsx:330`, `TicketsPage.tsx:490`.
- Input `hidden` más label: `Credentials365Tool.tsx:120`, `GlifingTool.tsx:71`.
- **Input visible sin estilo**: `InventoryPage.tsx:516`, `TenantsDashboard.tsx:214`.

Ninguno acepta drag & drop.

**`title=` usado como tooltip** (atributos del DOM, sin contar props `title` de componentes):
- `ChartCard.tsx:55,115`
- `ParqueSection.tsx:136`
- `AssistantPanel.tsx:328`
- `ClassroomInfoPanel.tsx:208`
- `ClassroomStatusPage.tsx:148`
- `Dashboard.tsx:141`
- `DevicesPage.tsx:195`
- `InventoryPage.tsx:357,383,384`: los botones de vista "▦" y "☰" **no tienen otro label** que el `title`.
- `KnowledgePage.tsx:133`
- `GooeyMenu.tsx:177`
- `Sidebar.tsx:181,190,201`
- `Topbar.tsx:156,178,182`
- `DeviceChipsPanel.tsx:143,168`
- `PhotoPassPanel.tsx:124,158,195`
- `AllowedUsersPanel.tsx:102`
- `ModulesPanel.tsx:93,96`
- `TaskBoard.tsx:101`
- `QuickAccess.tsx:145`
- `QuickAccessPopover.tsx:41`

**Widgets propios fuera de un componente compartido:**
- **Switch:** 4 implementaciones con `role="switch"`:
  - `LoanForm.tsx:430` (`toggle-row`) y `:570`
  - `ModulesPanel.tsx:102` (`switch-knob`)
  - `NotificationsPanel.tsx:110`
  - `PettyCashPage.tsx:286` (`toggle-row-button`)

  Además hay CSS `.switch-ui` en `motion.css` que nadie usa.
- **Tabs / segmented:**
  - Con `useTabPill`, la píldora animada: `LoginPage.tsx:205`, `HistoryPage.tsx:118`, `TasksPage.tsx:99,119`.
  - Ad-hoc: `AgendaPage.tsx:246`, `SchedulesPage.tsx:110,123,164`, `InventoryPage.tsx:369,382`, `UsersByTenantPage.tsx:118`, `LoansPage.tsx:103` (chips de filtro) y `LandingPage.tsx:46,125`.
- **Popovers y menús** (`aria-expanded`): `Topbar.tsx` (cuenta y sede), `NotificationBell.tsx`, `QuickAccessPopover.tsx`, `InventoryTree.tsx`, `ChipPanelKit.tsx`, `LoanForm.tsx`, `TaskCard.tsx`, `TicketsPage.tsx` y `GooeyMenu.tsx`. Cada uno resuelve por su cuenta el click afuera, el Escape y el posicionamiento.
- **Combobox:** `PersonSuggestInput.tsx` (propio) más los 4 `<datalist>`.
- **Botones:** 212 `<button>` crudos contra 210 `<Button>`, y 27 `className="btn …"` escritos a mano.
- **Badges:** solo 2 usan `<Badge>`. Hay 15 `<span className="badge …">` crudos.

### 2.2 Componentes compartidos que ya existen (`src/components/layout/`)

| Componente | Líneas | Usos | Qué cubre | Qué le falta |
|---|---:|---:|---|---|
| `Button` | 21 | 210 | 6 variantes (`primary`, `success`, `secondary`, `danger`, `ghost`, `outline`), TextSwap del label | Tamaños (sm/md/lg), `icon-only` con `aria-label` obligatorio, `loading` con spinner, `asChild`/label para inputs file. Hay 212 `<button>` sueltos |
| `SelectField` | 139 | 46 | Listbox con teclado, `hint`, cierre en captura dentro de modales | **Búsqueda/combobox**, multi-select, grupos, opciones deshabilitadas. **No usa portal**: la lista vive dentro del contenedor y puede quedar recortada por `overflow:hidden` (`.modal` tiene `overflow:hidden`) |
| `DateField` | 145 | 3 | Calendario propio lunes primero, ISO sin UTC, "Borrar", anclaje a la derecha | Lo usan solo `DeviceProfile` e `HistoryPage`. Le faltan `min`/`max`, rango (Historial usa dos campos), tipeo directo y portal. No hay variante con hora |
| `Modal` | 62 | 36 | Portal, foco (`useDialogFocus`), Escape, cierre animado, tamaños default/wide/full | Variante **drawer/sheet** para mobile y footer de acciones estándar. `ClassroomInfoPanel` y `ReleaseNotesModal` tienen overlay propio |
| `Feedback` | 211 | 23 confirm, 6 prompt, 43 toast | `confirmDialog`, `promptDialog` (texto u `options`), `toast` con acción, `errorMessage` | `promptDialog` con `inputType: date/datetime-local/number` **renderiza el input nativo** (`Feedback.tsx:168`). Tendría que usar DateField/DateTimeField/NumberField |
| `Selection` | 51 | 5 barras | `useSelection` + `SelectionBar` flotante (portal) | Necesita un `Checkbox` del sistema para las filas (hoy son nativos) |
| `Skeleton` | 51 | 15 | Block, Line, Panel, View con pulso escalonado | OK. Faltan Table y Card si cambia el layout |
| `Badge` | 10 | 2 | 7 tonos | Lo usa casi nadie: unificar los 15 spans crudos y los `pill` de estado de tareas, tickets y agenda |
| `StatCard` | 29 | 21 | KPI clickeable | — |
| `TextSwap`, `AnimatedNumber` | 44, 44 | | Movimiento de texto y números | — |
| `GooeyMenu`, `NotificationBell`, `Sidebar`, `Topbar`, `MobileNav`, `TenantLogo` | | | Shell | Lee tokens numéricos por `getComputedStyle` (`GooeyMenu.tsx:232`) |
| Hooks: `useDialogFocus`, `useTabPill`, `useMountTransition`/`useCloseChoreography`, `useCardResize`, `useDragScroll`, `useScrollReveal` | | | Foco, píldora de tabs, entrada y salida, resize, pan horizontal y reveal | Ver riesgos en §4 |

### 2.3 Componentes que faltan para cubrir el inventario

Ordenados por cantidad de reemplazos:

1. **Tooltip** (~30 `title=`): se muestra con hover y foco; en touch, con long-press o no se muestra. Los botones sin texto necesitan `aria-label` igual.
2. **Textarea** (24): autosize, contador opcional, mismo estilo que `.input`.
3. **Checkbox** (19) y **Switch** (4 implementaciones + `.switch-ui` sin usar). Usar la receta `checkbox-check` y `toggle` del catálogo.
4. **NumberField / stepper** (12): sin spinners nativos, `inputMode="decimal"` y formato moneda para Caja chica.
5. **Popover / Menu primitive** (≥ 9 ad-hoc): portal, posicionamiento con flip, click afuera, Escape, foco, `t-dropdown`. **SelectField, DateField, Combobox y Tooltip se apoyan en esto.**
6. **Tabs / SegmentedControl** (4 con `useTabPill` y ≥ 8 ad-hoc).
7. **FileInput / Dropzone** (10, 4 patrones): botón, nombre del archivo, drag & drop, `accept`, progreso.
8. **Disclosure / Accordion** (7 `<details>`): receta `accordion`.
9. **TimeField** (6 de texto con pattern) y **DateTimeField** (3 `datetime-local`).
10. **Combobox / Autocomplete** (4 `<datalist>` + `PersonSuggestInput`): `SelectField` con búsqueda y "crear nuevo".
11. **SearchField** (7): ícono, botón limpiar (receta `input-clear-dissolve`) y atajo.
12. **ColorField** (1 + 1 de texto): swatches + hex, para el color de sede.
13. **Drawer/Sheet** (variante de `Modal`) y un **Scroll area** que unifique la scrollbar.

---

## 3. Rendimiento

### 3.1 Build actual (`npm run build`, Vite 6.4.2, 1.900 módulos, 6,0 s)

| Archivo | Tamaño | gzip | Carga |
|---|---:|---:|---|
| `index.html` | 2,33 kB | 0,96 kB | inicial |
| **`index-*.css`** | **322,97 kB** | **58,18 kB** | **inicial, bloquea render, único CSS** |
| **`index-*.js`** (entry) | **310,74 kB** | **96,67 kB** | **inicial** |
| `ClassroomStatusPage` | 48,83 | 14,29 | lazy (incluye los planos SVG) |
| `LoansPage` | 38,41 | 12,33 | lazy |
| `InventoryPage` | 37,50 | 10,44 | lazy |
| `SettingsPage` | 34,25 | 10,07 | lazy |
| `TasksPage` | 27,04 | 8,80 | lazy |
| `TicketsPage` | 25,69 | 7,78 | lazy |
| `AgendaPage` | 20,74 | 6,37 | lazy |
| `PettyCashPage` | 15,12 | 4,42 | lazy |
| `AnalyticsPage` | 15,09 | 4,99 | lazy |
| `DevicesPage` | 14,10 | 5,19 | lazy |
| `ToolsPage` | 12,64 | 3,88 | lazy |
| `AssistantPanel` | 10,09 | 3,69 | lazy |
| `SchedulesPage` | 9,28 | 3,04 | lazy |
| `CanvasPage` | 8,70 | 3,38 | lazy |
| `UsersByTenantPage` | 8,66 | 2,55 | lazy |
| `LoginPage` | 7,95 | 2,93 | lazy |
| `TenantsDashboard` | 7,60 | 2,66 | lazy |
| `DeviceProfile` | 7,30 | 2,49 | lazy |
| `SuggestionsPage` | 7,21 | 2,50 | lazy |
| `HistoryPage` | 7,10 | 2,48 | lazy |
| `KnowledgePage` | 6,57 | 2,61 | lazy |
| `LandingPage` | 5,94 | 1,33 | lazy |
| `RemindersPage` | 5,04 | 1,88 | lazy |
| `GooeyMenu` | 4,34 | 1,80 | lazy compartido |
| `AddDeviceModal` | 3,54 | 1,29 | lazy |
| `DateField` | 3,13 | 1,34 | lazy compartido |
| Chicos (`Selection`, `MailStatusChip`, `useCardResize`, `classroomsApi`, `useTabPill`, `remindersApi`, `useAssistantContext`, `plus`, `QuickAccessPage`, `a11y`) | 0,19 a 0,99 | 0,17 a 0,54 | lazy compartidos |

- **Carga inicial crítica:** HTML 0,96 + JS 96,67 + CSS 58,18 = **~156 kB gzip**. El CSS es el **37 %** de lo crítico y se descarga entero aunque el usuario esté en el login.
- **Vistas lazy** (`App.tsx:32-58`, `lazyView` con prefetch en idle de las vistas del rol, `App.tsx:499`): todas las pantallas más DeviceProfile, AddDeviceModal, AssistantPanel, LoginPage y LandingPage. **El Dashboard está en el entry.**
- Como hay prefetch en idle, después del arranque se bajan además los chunks del menú: el banco mide 651 kB de JS en total y 315 kB de CSS.
- El server comprime con `compression()` (gzip, sin brotli). `/assets` sale `immutable, max-age=1y` (`server/index.js:170-172`).

### 3.2 Dependencias

- **Frontend**, lo que va al bundle:
  - `react` y `react-dom` 19: la mayor parte de los ~97 kB gzip del entry.
  - `lucide-react` 1.x, con tree-shaking: 12 archivos lo importan.

  Nada más pesado.
- **Solo server:**
  - `openai`, `mammoth`, `pg`, `better-sqlite3`, `nodemailer`, `web-push`, `express`, `compression`.
  - `localtunnel` y `concurrently` (herramientas de desarrollo que están en `dependencies`).
  - `@vitejs/plugin-react` también está en `dependencies` en vez de `devDependencies`. No afecta el bundle, sí el `npm install` de la VM.
- **Dev:** `puppeteer-core` (banco), `transitions-pro`, `transitions-refine`, `typescript`, `vite`.
- **No hay** librerías de UI, de fechas ni de gráficos. Los gráficos son SVG y CSS propios. Esto conviene mantenerlo: los componentes nuevos (popover, datepicker, etc.) se escriben a mano como `SelectField` y `DateField`.

### 3.3 Fuentes hoy

**Ninguna webfont.** `components.css:8` declara `font-family: Inter, Segoe UI, Arial, sans-serif` y `auth.css:41` lo mismo, pero **Inter no se carga en ningún lado** (no hay `@font-face` ni link). En Windows se ve Segoe UI; en Android, Roboto. Los pesos 550, 650, 750 y 850 se redondean porque Segoe es estática. Monoespaciadas: `'Fira Code', monospace` (`components.css:1980`, tampoco se carga) y `ui-monospace, SFMono-Regular, Consolas` (`:3125`). Hoy las fuentes cuestan **0 kB**.

### 3.4 Medición base del frontend (banco `perf/`)

Corrida del 16/10/2026: Chrome 155 headless, CPU 4× (≈ notebook escolar o celular de gama media), 3 corridas (mediana), viewport 1366×800, datos reales de una copia de la base local.

> Nota: `perf/run.mjs` elige primero Edge, y en esta máquina Edge headless sale con "Code: 0" sin abrir: hay tres versiones instaladas en paralelo y parece una actualización a medias. Corrí una copia del runner en el scratchpad con Chrome primero; el código del repo no cambió. Para comparar antes y después hay que usar siempre el mismo browser.

**Arranque en frío:**

| Métrica | ms |
|---|---:|
| DOMContentLoaded | 61 |
| App lista (`perf-app-ready`) | **391** |
| First Contentful Paint | **704** |
| Tareas largas (total) | 641 |
| Blocking | 400 |
| Nodos DOM | 974 |

Desglose del hilo principal en el arranque:

| Trabajo | ms |
|---|---:|
| FunctionCall | 368 |
| **Layout** | **194** |
| **UpdateLayoutTree** (recálculo de estilos) | **109** |
| v8.evaluateModule | 86 |
| Layerize | 47 |
| Paint | 41 |
| PrePaint | 35 |
| **ParseAuthorStyleSheet** | **12** |

El CSS pesa en `UpdateLayoutTree` y en `Parse`: 2.890 selectores, `*` universales y `color-mix`.

**Abrir cada pantalla** (primera vez = chunk frío; segunda = en memoria):

| Pantalla | 1ª (ms) | 2ª (ms) | Tareas largas | Nodos DOM |
|---|---:|---:|---:|---:|
| Dispositivos | 204 | 132 | 0 | 1.065 |
| Préstamos | 187 | 134 | 0 | 441 |
| Inventario TIC | **305** | 82 | 0 | 369 |
| Analítica | 285 | **196** | 147 | 1.019 |
| Agenda TIC | 174 | 115 | 0 | 466 |
| Horarios | 100 | 83 | 0 | 241 |
| Tareas TIC | 267 | 154 | 137 | 448 |
| Estado aulas | 281 | 107 | 0 | 470 |
| Tickets | 100 | 84 | 0 | 281 |
| Configuración | 107 | 72 | 0 | 319 |
| Dashboard | 149 | 135 | 0 | 632 |

**Scroll:**

| Pantalla | p50 | p95 | Tareas largas |
|---|---:|---:|---|
| Préstamos | 17 ms | 17 ms | 0 |
| Dashboard | 17 ms | 17 ms | 0 |
| Agenda TIC | 17 ms | 17 ms | 0 |
| **Dispositivos** | 17 ms | **100 ms** | 1 de 66 ms |

### 3.5 Cómo medir antes y después

1. Línea base, una vez, con la rama actual. `perf/.out/` está en `.gitignore`.

   ```bash
   npx -p node@22 node server/scripts/bench/record-api.mjs perf/.out/perf-fixtures.json
   npx vite build --config perf/vite.config.ts --outDir perf/.out/dist-base
   ```

2. Después de cada pantalla migrada:

   ```bash
   npx vite build --config perf/vite.config.ts --outDir perf/.out/dist-new
   PERF_FIXTURES=perf/.out/perf-fixtures.json node perf/compare.mjs perf/.out/dist-base perf/.out/dist-new -- 7 4
   ```

   Esto corre A/B intercalado y da medianas. Con `PERF_PROFILE=1` y `PERF_NO_MINIFY=1` muestra las funciones calientes.
3. Además, `npm run build`: comparar los kB gzip de `index-*.css`, `index-*.js` y los chunks.
4. `server/scripts/bench/bench-api.mjs 15 5` no mide el front. Sirve para verificar que el rediseño **no agregue queries** al arranque: 13 pedidos, 6 en paralelo. Por ejemplo, si el tema nuevo se guarda en `/api/user/prefs` o aparece algún endpoint nuevo para preferencias visuales.
5. Agregar `'.woff2': 'font/woff2'` a `TYPES` en `perf/run.mjs` y `perf/compare.mjs` cuando haya fuentes. Hoy saldrían como `octet-stream`; Chrome las acepta igual, pero conviene que quede igual que producción.
6. El banco sirve por localhost sin latencia: **no mide el costo de red de la fuente**. Para eso: DevTools con "Slow 4G" o Lighthouse sobre `npm run start`, mirando FCP, LCP y CLS.

### 3.6 Presupuestos de rendimiento propuestos

Se basan en lo medido. Regla general: **ninguna métrica empeora más de 5 % sobre la base**, y el CSS tiene que bajar.

| Métrica | Hoy | Presupuesto (tope) | Meta |
|---|---:|---:|---:|
| CSS inicial (gzip) | 58,2 kB | **≤ 58 kB** (nunca más que hoy) | **≤ 40 kB** |
| CSS inicial (minificado) | 323 kB | ≤ 323 kB | ≤ 200 kB |
| JS entry (gzip) | 96,7 kB | **≤ 102 kB** (+5 kB para Popover, Tooltip, Checkbox, Switch, Tabs y tokens) | ≤ 98 kB |
| Chunk de pantalla más grande (gzip) | 14,3 kB (Aulas) | ≤ 16 kB | — |
| Fuente crítica (preload) | 0 | **≤ 30 kB** (1 archivo: Geist latin) | — |
| Fuentes totales | 0 | ≤ 55 kB (Geist + Geist Mono latin) | — |
| Total crítico (HTML + JS + CSS + fuente) | 156 kB | **≤ 185 kB** | ≤ 170 kB |
| App lista (4× CPU) | 391 ms | ≤ 410 ms | ≤ 380 ms |
| FCP (4× CPU, local) | 704 ms | ≤ 740 ms | — |
| Blocking en el arranque | 400 ms | ≤ 420 ms | — |
| UpdateLayoutTree en el arranque | 109 ms | ≤ 110 ms | ≤ 85 ms |
| Abrir pantalla, 1ª vez | 100 a 305 ms | **≤ 300 ms en todas**; ninguna > base +10 % | — |
| Abrir pantalla, 2ª vez | 72 a 196 ms | ≤ 200 ms | — |
| Tareas largas al abrir Analítica / Tareas | 147 / 137 ms | no subir | — |
| Scroll p95 | 17 ms (Dispositivos 100) | 17 ms; Dispositivos ≤ 100 | Dispositivos ≤ 50 |
| Nodos DOM por pantalla | 241 a 1.065 | ≤ base +10 % (ojo con los wrappers de los componentes nuevos) | — |
| CLS al cargar la fuente | — | ≤ 0,02 | — |

Para no romper los presupuestos:
- **Partir el CSS:**
  - En el entry: tokens, base, shell, componentes compartidos y motion.
  - CSS de cada pantalla importado desde su módulo lazy: Vite lo emite por chunk y lo carga antes de resolver el `import()`.
  - `auth.css` solo con Login y Landing.

  Las clases que comparten varias pantallas (`.stat-card`, `.card`, `.input`, `.btn`, `.badge`, `.table-wrap`) quedan globales.
- Los componentes pesados (DatePicker, TimePicker, Dropzone, ColorField) van lazy o en un chunk compartido, como ya pasa con `DateField`.
- **Sin** `backdrop-filter` en superficies grandes ni en listas, y sin `transition: all`. Mantener el presupuesto que ya define `motion.css`.

### 3.7 Costo de agregar Geist

Tamaños reales en `@fontsource-variable/geist@5.3.0` y `@fontsource-variable/geist-mono@5.3.0` (fuente variable, eje `wght` 100–900, cubre 550/650/750/850 sin redondear):

| Archivo woff2 | kB |
|---|---:|
| `geist-latin-wght-normal` | **28,7** |
| `geist-latin-ext-wght-normal` | 16,1 |
| `geist-mono-latin-wght-normal` | **22,6** |
| `geist-mono-latin-ext-wght-normal` | 14,4 |
| Itálicas (latin) | 30,3 / 24,9 |

El subset **latin** (U+0000-00FF + puntuación general U+2000-206F + € ™ etc.) cubre todo el español: á é í ó ú ñ ü ¿ ¡ « ». **latin-ext solo se descarga si aparece un carácter fuera de ese rango**, gracias a `unicode-range`. La flecha → (U+2192) no está en latin: cae a la fuente de respaldo.

**Opción A: self-hosted, recomendada.**
- `npm i @fontsource-variable/geist @fontsource-variable/geist-mono`, importar solo `wght.css` (normal, sin itálica) desde el CSS del entry. Hacen falta itálicas solo si el diseño las usa.
- Vite emite los woff2 a `/assets/` con hash, así que:
  - quedan `immutable, max-age=1y`;
  - el service worker los atiende **cache-first** (`sw.js:45-58`): se bajan una vez por versión;
  - van por la misma conexión HTTP/2 que la app (0 DNS y 0 TLS extra).
- Costo: **+28,7 kB** en la primera visita (Geist latin). Geist Mono (**+22,6 kB**) se baja solo cuando se pinta texto mono (`@font-face` es lazy). Precargar solo Geist sans: `<link rel="preload" as="font" type="font/woff2" crossorigin>`, con la URL hasheada inyectada por un mini-plugin `transformIndexHtml`.
- `font-display: swap` en Geist, con una fuente de respaldo de métricas ajustadas para evitar el salto de layout (CLS):

  ```css
  @font-face { font-family: 'Geist Fallback'; src: local('Arial'); size-adjust / ascent-override / descent-override }
  ```

  Calcular los valores con `fontaine` o `capsize`. Pila final: `font-family: 'Geist Variable', 'Geist Fallback', system-ui, sans-serif`.
- Geist Mono: `font-display: swap` sin preload. Se usa en códigos y etiquetas como `D1436`.
- **No poner las fuentes en `public/fonts/`**: el SW manda esa ruta a la rama "resto de estáticos", que es *network-first con `cache: 'no-store'`* (`sw.js:61-70`). Se volverían a descargar en cada carga.

**Opción B: Google Fonts, no recomendada.**
- Agrega una hoja de estilos externa (`fonts.googleapis.com`), que **bloquea el render** si va con `<link rel=stylesheet>`, más una segunda conexión a `fonts.gstatic.com`. Son 2 DNS + 2 TLS, típicamente 100–300 ms extra en la red de un colegio o en 4G.
- Con el caché particionado por sitio (Chrome 86+) no hay beneficio de "ya la tiene cacheada de otro sitio".
- El SW **ignora los requests a otro origen** (`sw.js:23`): la PWA offline pierde la fuente.
- Manda la IP de cada usuario a Google en cada visita: escuela y menores, mejor evitarlo.
- Los bytes de la fuente son parecidos (Google también subsetea), pero el tiempo hasta el primer pintado es peor.

**Impacto en el render:**
- Una fuente variable de ~29 kB no cambia `App lista`, que depende de JS.
- Con `swap` no retrasa el FCP. El costo real es el **re-layout cuando la fuente llega**: si no se ajustan las métricas del fallback, todo texto medido por JS se desalinea (ver §4.2, `useTabPill`).

---

## 4. Riesgos técnicos de un cambio visual global

### 4.1 Clases y atributos que usa el JS (renombrarlos rompe comportamiento, no solo estilo)

| Dónde | Qué depende de la clase o atributo |
|---|---|
| `App.tsx:317` | `target.closest('.modal')`: el atajo global del scanner/teclado se ignora dentro de modales. Si el modal nuevo cambia de clase, el scanner escribe "detrás" del modal |
| `App.tsx:277-280` | `[data-device-tag="D…"]` + clase `row-highlight` (keyframe `rowHighlight` en `layout.css:1452`): resaltar el equipo buscado en Dashboard y Dispositivos |
| `App.tsx:266` | `body.mobile-menu-open` |
| `Modal.tsx:29`, `ClassroomInfoPanel.tsx:123` | `body.modal-open`: bloquea el scroll del fondo |
| `useScrollReveal.ts:3` | `SELECTOR = '.card, .stat-card, .agenda-card, .task-card, .chart-card'`. Les agrega `scroll-reveal` / `is-visible`. Si una card nueva no lleva una de estas clases, no se revela; si el CSS nuevo no define `.scroll-reveal:not(.is-visible)`, puede quedar invisible |
| `useDragScroll.ts:10` | `INTERACTIVE = 'input, textarea, select, button, a, [draggable="true"], .task-card, .infinite-column-head'` y la clase `is-panning` |
| `CanvasPage.tsx:91,106` | `.closest('.canvas-node')` |
| `TaskCard.tsx:48,52,56` | `.closest('button, input, textarea, select')` y la clase `dragging` |
| `SelectField.tsx:48` | `[data-active="true"]` |
| `useTabPill.ts:41` | `[data-tab-active="true"]` |
| `themeProfile.ts:44` | `<html>.theme-light` + `data-theme-profile`: 123 reglas cuelgan de esto. Los 8 perfiles mezclan tema y estilo de nav; el modelo nuevo (oscuro/claro) tiene que mapear los perfiles guardados en `localStorage` y en `/api/user/prefs` sin perder el estilo de nav elegido (escalera, centrada, peek) |
| `useDialogFocus.ts:43` | Filtra focusables con `offsetParent !== null`: **un elemento `position: fixed` dentro de un modal tiene `offsetParent === null`** y queda fuera del ciclo de Tab |
| Clases `t-*` | Las ponen los hooks de movimiento (`useMountTransition`, `useCloseChoreography`: `CLOSE_MS = 150` en `Modal.tsx:12` debe coincidir con `--modal-close-dur`) |

### 4.2 Medidas en JS que dependen del CSS y de la fuente

- **`useTabPill.ts:49-51`**: posiciona la píldora con `offsetWidth/offsetTop/offsetHeight` del tab activo y re-mide con un `ResizeObserver` sobre el **contenedor**. Cuando Geist reemplaza al fallback, cambia el ancho de cada tab pero quizá no el del contenedor, y **la píldora queda corrida**. Re-medir en `document.fonts.ready` / `loadingdone`, u observar cada tab.
- **`Dashboard.tsx:34-55`**: calcula columnas con `CARD_GAP`, `CARD_MIN` y `CARD_MAX_COLS` en JS. Si el CSS nuevo cambia el gap o el ancho mínimo, hay que cambiar las constantes.
- **`DateField.tsx:61`**: decide `alRas` con `getBoundingClientRect` y el **ancho fijo** del calendario.
- `useCardResize.ts:38-53` (`offsetHeight`), `CanvasPage.tsx:42,130` (`clientWidth`, rect) y `useDragScroll.ts:21` (`scrollWidth > clientWidth`).
- **`GooeyMenu.tsx:232`**: `readNum()` lee custom properties numéricas (`--goo-*`) de `:root`. Si se renombran o se mueven a otro selector, **cae al fallback en silencio**.
- `--topbar-h: 62px` lo usan los paneles sticky. Si la topbar nueva cambia de alto, actualizar el token.
- Breakpoints en JS: `InstallBanner.tsx:18` usa `(max-width: 768px)`; el CSS usa 980 como corte principal.

### 4.3 Estilos inline y colores en JS (80 `style={{…}}`)

- `ChartCard.tsx:6`: `PALETTE` hardcodeada de 8 colores; **ignora `--chart-1..5`**. `ParqueSection.tsx:136` tiene un mapa `colors[...]` inline.
- `CanvasPage.tsx:7,265`: colores pastel de las notas (`--node-color`), elegidos para fondo oscuro.
- `Topbar.tsx:70,93` y `TenantsDashboard.tsx:157,225`: `--tenant-accent` es **el color propio de cada sede** (default `#3b82f6`), elegido por el usuario. Puede chocar con el acento `#5B9BFF` y no tener contraste en el tema claro: definir dónde se permite y calcular el texto encima.
- `LandingPage.tsx` (10 inline), `Skeleton.tsx` (5, solo tamaños), `InvitesPanel.tsx` (4) y `AppearancePanel.tsx` (2, `fontSize: 14`).
- `KnowledgePage.tsx:135`: iframe `srcDoc` con su propio `<style>` (`font: system-ui`). No hereda el tema.
- `DevicesPage.tsx:155-162`: la exportación de QR abre un popup con CSS propio (Arial, colores fijos, `@media print`). Es independiente del tema: dejarlo así o tematizarlo a propósito.

### 4.4 Planos SVG de aulas

- `FloorModelBase.jsx:13-26` tiene la paleta entera **hardcodeada para oscuro**: aula `#0d2347`/`#1e56a0`, servicio, pasillo `#010609`, patio, fondo `#030912` (`:70`), grilla `#071630` (`:62-67`), hover `#142e5e`/`#3a90d4` (`:47,54`). También los estados `OK`/`Con observaciones`/`Problema` en rgba + hex.
- `FloorMapPrimerPiso.jsx` (26 fills/strokes), `NordeltaFloorKit.jsx` (8).
- **0 usos de `var(--…)`** en `models/`. En tema claro el plano queda azul marino sobre crema.
- Pasar los colores a CSS variables (`fill="var(--plan-room)"`) o a clases. **No tocar los IDs** `room_*` / `pp_*` / `p2_*` (`ALL_FLOOR_ROOMS`, `ROOMS`): son la clave de los datos de aulas.
- El chunk de Aulas (48,8 kB) es el más grande. Tokenizar no debería agrandarlo.

### 4.5 Impresión

- **Tarjetas Glifing/Santillana**: el HTML se genera en el **server** (`server/routes/tools.routes.js:241-248`, `@page A4`, `print-color-adjust: exact`) con templates en data URL. No usa el CSS de la app, así que el rediseño no lo afecta. **No "migrarlo" al CSS nuevo**: la impresión depende de que sea autocontenido.
- QR: el popup de `DevicesPage.tsx:153-162` también es autocontenido.
- La app no tiene `@media print` propio. Si alguien imprime una pantalla, sale el tema actual (el browser suele sacar los fondos). Riesgo bajo, pero un tema oscuro grafito impreso sin fondo puede dejar texto claro sobre papel blanco. Si importa, agregar un `@media print` mínimo que fuerce los tokens claros.
- Mails (`server/services/mailTemplates.js`): colores propios inline. Fuera del alcance del CSS.

### 4.6 PWA y service worker con CSS viejo

- `sw.js`:
  - `CACHE = 'techasset-shell-v3'`.
  - `/assets/*` cache-first (`:45-58`); como el nombre lleva hash, un CSS nuevo nunca choca con uno viejo.
  - La navegación va network-first con `no-store`, así que el `index.html` nuevo llega siempre online.
  - El HTML **solo** se sirve viejo cuando no hay red: entonces apunta al CSS viejo, que sigue cacheado, y la experiencia es coherente.
- Riesgos:
  - **El caché nunca se poda**: cada build agrega su CSS de 323 kB y sus chunks al mismo `techasset-shell-v3`. **Subir a `v4` en el release del rediseño**: el `activate` borra los caches viejos (`:10-12`). Idealmente, podar las entradas de `/assets/` que no estén en el build actual.
  - Una pestaña abierta durante el deploy sigue con el CSS viejo y pide chunks viejos. `lazyView.tsx:25-31` recarga una vez si el chunk ya no existe, pero si el chunk viejo estaba en el caché del SW (por el prefetch en idle) **lo sirve**, y la pestaña queda con la UI vieja hasta recargar. Si el server cambia contratos en el mismo release, avisar con el modal de novedades (`ReleaseNotesModal`).
  - Fuentes: ver §3.7, tienen que vivir en `/assets/`.
  - `index.html:11` `<meta name="theme-color" content="#0f1a2e">` y `manifest.webmanifest:9-10` (`theme_color #0f1a2e`, `background_color #0b1220`) tienen el azul viejo. Actualizarlos al grafito, y dar un `theme-color` por tema (`media="(prefers-color-scheme: …)"` o actualizarlo desde `applyThemeProfile`). El ícono instalado y la splash no se actualizan hasta reinstalar la PWA.

### 4.7 Cascada y migración parcial

- Durante la migración van a convivir clases viejas y nuevas. Las viejas ganan por `!important` (349), por especificidad (`:root[data-theme-profile^="smart"] .x`) y por redefinición: `.topbar` está definida 16 veces. Para cada componente que se reemplaza:
  1. Inventariar las reglas viejas que le pegan.
  2. Borrarlas en el mismo PR. **No sumar otra capa de override**: así nació el estado actual.
  3. Verificar en oscuro, en claro, a 360 px y en desktop. Nunca puede haber scroll horizontal (CLAUDE.md).
- `@media (hover:none) and (pointer:coarse) { input, textarea, select { font-size:16px !important } }` (`global.css:52-58`) evita el zoom de iOS al enfocar. Mantenerlo en el sistema nuevo.
- `html { scrollbar-gutter: stable }` (`global.css:28-30`) evita el salto de layout al cambiar de vista. Mantenerlo.
- `touch-action: manipulation` en `html/body/#root/.app-shell`.
- **Hallazgo aparte:** `index.html:5` tiene `maximum-scale=1.0, user-scalable=no`, pero `main.tsx` dice que el bloqueo de pinch-zoom "se sacó a propósito". Hoy el zoom sigue bloqueado en el viewport meta. Es un problema de accesibilidad; conviene resolverlo en el rediseño.

---

## Checklist para la migración

- [ ] Línea base guardada: `perf/.out/dist-base` + fixtures + salida de `npm run build`.
- [ ] Tokens nuevos (color grafito y claro completo, acento `#5B9BFF`, espaciado, radios, sombras, z-index, tipografía) en `variables.css`. Declarar `color-scheme: dark` y `light`.
- [ ] Nuevo modelo de tema (oscuro/claro × estilo de nav) que mapee los 8 perfiles guardados (`localStorage` + `/api/user/prefs`).
- [ ] Definir `--accent` siempre: hoy `auth.css` lo usa sin fallback en el tema clásico.
- [ ] Una sola definición de scrollbar con `scrollbar-color` y token; borrar los 3 bloques `::-webkit-scrollbar` y el `*{scrollbar-color}` hardcodeado.
- [ ] Componentes nuevos: Popover (base), Tooltip, Checkbox, Switch, Tabs/Segmented, Textarea, NumberField, FileInput/Dropzone, Disclosure, TimeField, DateTimeField, Combobox, SearchField, ColorField, Drawer.
- [ ] `promptDialog` deja de renderizar `date`/`datetime-local`/`number` nativos (`Feedback.tsx:168`).
- [ ] `SelectField` y `DateField` en portal (sin recorte en `.modal`).
- [ ] Reemplazar ~30 `title=` por Tooltip, con `aria-label` en los botones con solo ícono (`InventoryPage.tsx:383-384`).
- [ ] `ChartCard` usa `--chart-*`. Planos SVG con variables y sin tocar los IDs.
- [ ] `useTabPill` re-mide cuando cargan las fuentes. Revisar `Dashboard` (`CARD_GAP`/`CARD_MIN`) y `--topbar-h`.
- [ ] Geist self-hosted vía `@fontsource-variable` (latin, `wght`, normal), preload de un solo archivo, `swap` + fallback con métricas ajustadas.
- [ ] CSS partido: entry (tokens, base, shell, compartidos, motion) + CSS por pantalla en su chunk + `auth.css` solo para Login y Landing.
- [ ] Borrar el CSS muerto (~298 clases candidatas) a medida que se migra cada pantalla.
- [ ] Guards de `prefers-reduced-motion` para los 10 keyframes que hoy no lo tienen.
- [ ] `sw.js` → `techasset-shell-v4` en el release. `theme-color` y `manifest` con colores nuevos.
- [ ] Presupuestos de §3.6 verificados con `perf/compare.mjs` en cada PR de pantalla.
- [ ] `npm run build` OK. Sin scroll horizontal a 360 px y en desktop, en los dos temas.

## Ideas de mejora (opcionales)

- Pasar `localtunnel`, `concurrently` y `@vitejs/plugin-react` a `devDependencies` (achica el `npm install` de la VM de 1 GB).
- Brotli en Express (o en Caddy con `encode zstd gzip`): el CSS de 58 kB gzip bajaría a ~45 kB brotli.
- Sacar el Dashboard del entry (lazy, como las demás vistas) si el entry pasa de 100 kB gzip.
- Arreglar el banco para que pruebe Chrome si Edge no levanta, en vez de abortar.
- Unificar los dos sistemas de toast (`toastIn` en components y `.t-toast` en motion).
