# Plan de migración y rediseño de TechAsset

Estado: **propuesta para aprobar**. No se implementó nada todavía. Rama de trabajo: `rediseno-grafito`.

Regla de este plan: **primero entender, después rediseñar**. Antes de tocar una pantalla se lee su inventario, se migra, y se tilda su lista de verificación completa. Si algo del inventario no se puede conservar, se frena y se pregunta.

---

## 1. Qué se relevó

Siete relevamientos leyendo el código (no los README), con `archivo:línea` para cada cosa no obvia, en `docs/redesign/inventario/`:

| Documento | Cubre | Puntos a verificar |
|---|---|---:|
| `01-shell-y-globales.md` | App, navegación y URLs, menú, topbar, campana, sesión, sede por pestaña, caché, escáner USB global, PWA, temas, modo consulta, asistente, login | 98 |
| `02-dashboard-y-prestamos.md` | Dashboard, panel Ahora, traspaso, movimientos, Préstamos, formulario, escaneo continuo, chips de equipos y cartelitos (**Ctrl+Click**), cierre del día | 74 |
| `03-dispositivos-inventario-historial.md` | Dispositivos, tabla, ficha, alta/edición, lotes, papelera, grupos, Inventario TIC, recorrido de revisión, Historial | 104 |
| `04-agenda-aulas-horarios-recordatorios.md` | Agenda, Horarios y recreos, Estado de aulas (planos SVG), Recordatorios | 75 |
| `05-tareas-tickets-conocimiento-canvas.md` | Tareas (tablero, drag & drop, subtareas), Tickets, Sugerencias, Base de conocimiento, Canvas | 65 |
| `06-analitica-config-herramientas.md` | Analítica, los 11 paneles de Configuración, Tenants, Herramientas, Accesos rápidos, Caja chica | 84 |
| `07-auditoria-design-system-y-rendimiento.md` | Arquitectura CSS, controles nativos, tema claro actual, tamaños del build, medición base, presupuestos | — |

**Total: 500 puntos de verificación**, uno por funcionalidad, para tildar a mano al terminar cada pantalla (además de las pruebas automáticas de la sección 7).

---

## 2. Funcionalidades que se conservan (resumen)

Todo lo de los inventarios se conserva. Lo que sigue son las cosas chicas, fáciles de perder en un rediseño, que **quedan explícitamente protegidas**:

**Préstamos y equipos**
- **Ctrl+Click / Cmd+Click / Shift+Click** sobre chips de equipos y cartelitos: marca sin prestar ni devolver, prende solo el modo "Seleccionar varios", barra "Prestar N / Devolver N / Limpiar" ("Entregar N" en cartelitos). Click simple: libre → carga la etiqueta en el formulario; prestado → devuelve. Chips bloqueados (no encontrado / fuera de servicio) no responden. "Todos / Ninguno" por grupo. La selección se recalcula contra el estado vivo.
- Escáner USB desde cualquier pantalla (lleva a Préstamos); escaneo continuo con Enter, detección de duplicados, no disponibles y ambiguos; "Prestar N" desde la grilla manda el lote al escaneo continuo y enfoca Persona.
- Sugerencia por historial: al elegir una persona completa su rol, ubicación, motivo y curso más usados.
- Búsqueda flexible: `touch 34`, `touch34`, `34touch`, `D1436`, `1436`, `plani 5`, `planificación 5`.
- "Préstamos del día anterior" = último día con préstamos (después de un finde, el viernes).
- Lotes en un solo request (`lend-batch` / `return-batch`), confirmación al devolver más de uno.
- Pill de antigüedad del préstamo (Hoy / 1 día / N días con tono).

**Dispositivos e inventario**
- Borrar = ocultar, toast "Deshacer" (7 s), papelera con buscador y restaurar; reimportar CSV reactiva.
- Atajos del recorrido de revisión: 1–4 califican, S salta, Esc sale.
- Filas abren con click, Enter o Espacio; `data-device-tag` y resaltado de fila.
- Exportar PDF QR, CSV de "A renovar", grupos de equipos.

**Agenda, aulas, tareas, tickets**
- Capacidad por tipo (Touch 25) y conflictos; historial de agenda; export CSV; "ver todo" / terminadas ocultas.
- Planos: los IDs SVG son las claves de la base (`room_*`, `pp_*`, 2º piso `4N/4F/4S/3S`): **no se renombran**.
- Tablero de tareas con drag & drop de tareas y columnas, movimiento optimista con vuelta atrás si falla, paneo arrastrando el fondo, "Ver más" por columna, selección múltiple con mover/borrar en lote.
- Tickets: link al sistema externo, plantillas, resumen IA, checklist, padre/relacionados, comentarios y actividad.
- Notas del día en el Dashboard (lo que hoy es el chat de traspaso; el nombre "Traspaso TIC" desaparece por pedido del dueño, la función se conserva como "Notas").

**Globales**
- URL `/sede/<SEDE>/<vista>` (la usan mails, notificaciones y el login con Google).
- Sede por pestaña, caché de 15 s con revalidación, 401 → vuelve al login, sesión pintada desde caché en el primer frame.
- PWA instalable, push, campana con polling, "Qué hay de nuevo".
- Modo consulta, permisos por módulo y por rol, módulos que cada sede prende.
- Asistente de IA con voz (dictado y lectura en voz alta) y contexto de la pantalla abierta.
- `confirmDialog` / `promptDialog` / `toast` propios (hoy ya no queda ningún `window.confirm` ni `<select>` nativo). Se conserva lo que hacen (confirmar, pedir un dato, avisar, Deshacer) pero cambia la forma: pasan a confirmaciones, campos y líneas de estado **en línea**, sin modales ni toasts flotantes.

**Funciones que hoy están rotas o perdidas y se recuperan** (no se "conservan": se arreglan):
- Buscador global (el código existe pero no hay dónde escribir) → vuelve como **Ctrl+K** (sección 6).
- Marcar una nota como **Importante** (el cierre del día las cuenta y hoy no se puede).
- "Atrás" del navegador entre vistas.

---

## 3. Bugs y deuda encontrados (se arreglan antes del rediseño)

Se arreglan **en la etapa 0, separados de lo visual**, para que si algo cambia se sepa si fue el arreglo o el rediseño.

| # | Problema | Dónde |
|---|---|---|
| 1 | Fechas en UTC: notas del traspaso después de las 21 h desaparecen; agenda "hoy" pasa al día siguiente; Historial filtra mal; cierre del día usa UTC | `DailyHandoffChat`, `AgendaPage`, `history.routes`, cierre |
| 2 | Devolver desde el Dashboard ignora el modo consulta y si falla no avisa | `Dashboard.tsx:145`, `DeviceTable.tsx:63-71` |
| 3 | Configuración, Herramientas y Accesos rápidos no se recargan al cambiar de sede: **se pueden guardar datos de una sede en la otra** | `SettingsPage`, `ToolsPage`, `QuickAccessPage` |
| 4 | `/api/user/prefs` busca al usuario con el id equivocado (el tema se guarda en otra fila) | `userPrefs.routes.js:9,20` |
| 5 | `migrateRetiredModules` apaga Recordatorios en cada arranque | `server/db.js:981` |
| 6 | Cierre del día cuenta préstamos activos desde la tabla vieja `prestamos` (da 0) | `DailyClosurePanel` |
| 7 | Errores tragados sin aviso (traspaso, columnas, subtareas, roles, usuarios, opciones, caja chica, grupos) | varios |
| 8 | Selección de Dispositivos opera sobre equipos ocultos por el filtro (borrar puede afectar lo que no ves) | `DevicesPage` |
| 9 | Tareas: el server no exige permiso del módulo para escribir | `tasks.routes` |
| 10 | Tags/responsables/checklist: no se puede tipear de corrido (borra coma/Enter) | Tickets, plantillas, conocimiento |
| 11 | Base de conocimiento muestra como máximo 20 artículos | `knowledge.routes` |
| 12 | "Crear tenant" con un código existente pisa la sede | `POST /api/sites` |
| 13 | El bloqueo de zoom no funciona en iPhone (Safari ignora `user-scalable=no`) y el comentario de `main.tsx` dice lo contrario de lo que hace el código | `index.html`, `main.tsx` (ver §5.1) |
| 14 | QR generados en `api.qrserver.com` (se mandan etiqueta, SN y MAC a un tercero) | Exportar PDF QR |
| 15 | Código muerto: `InternalNotesPanel`, `SiteAdminPanel`, `DeviceCard`, `useSyncStatus`, `assistantIntent`, botón "Backup SQLite" que no hace nada | — |

Más detalle y el resto (≈40) en cada inventario, sección "Riesgos" e "Ideas de mejora".

---

## 4. Riesgos principales

1. **El CSS actual pelea contra cualquier cosa nueva.** 12.120 líneas, 349 `!important`, 604 selectores repetidos (`.topbar` 16 veces), 562 reglas con colores fijos. *Mitigación:* los componentes nuevos usan su propio prefijo de clases (`ui-…`), así ninguna regla vieja los toca; el CSS viejo se borra pantalla por pantalla, nunca se "pisa".
2. **Clases y atributos que lee el JavaScript.** `.modal` (lo usa el escáner global para no robar tipeo), `data-device-tag`, `row-highlight`, `[data-tab-active]`, `.view-enter`, `body.modal-open`, duraciones de animación copiadas en TS y CSS. *Mitigación:* lista en `01` §riesgos; cada uno tiene una prueba automática.
3. **Escáner USB global.** Se dispara con dos teclas en menos de 120 ms; hoy se protege con la clase `.modal`, que desaparece al sacar los modales. *Mitigación:* el escáner ignora todo campo editable y los formularios en línea; prueba e2e de "tipear en un formulario en línea no navega".
4. **Planos SVG de aulas.** Sus IDs son claves de la base y tienen colores fijos. *Mitigación:* se recolorean por tokens sin tocar IDs; prueba que compara la lista de IDs antes/después.
5. **Fechas en iPhone.** Recordatorios usaban el selector nativo porque el texto libre daba `Invalid Date` en Safari. *Mitigación:* el DatePicker propio nunca parsea texto libre del navegador: trabaja con `YYYY-MM-DD` y teclado propio; se prueba en Safari iOS real antes de reemplazar.
6. **Rendimiento.** En producción cada query bloquea el proceso (`pg-sync`); en el front el CSS ya es el 37 % de la primera carga. *Mitigación:* presupuestos de la sección 7 en cada PR; ningún componente nuevo suma queries; CSS partido por pantalla.
7. **Dos sistemas conviviendo** durante la migración (pantallas nuevas y viejas). *Mitigación:* la etapa 1 remapea los tokens viejos a la paleta nueva, así lo viejo ya se ve "de la familia" mientras espera su turno.
8. **8 perfiles de tema** (clásico/smart × escalera/centrado/peek) con dos menús distintos. *Mitigación:* se reemplazan por Oscuro / Claro / Sistema (+ densidad); se migra la preferencia guardada de cada usuario. **Necesito tu OK** (sección 11).
9. **Service worker con CSS viejo en caché.** *Mitigación:* subir la versión del caché (`v4`) en cada release de etapa y verificar que la PWA instalada actualiza.
10. **Datos de una sede en otra** (bug 3) si se migra Configuración antes de arreglarlo. *Mitigación:* va en la etapa 0.

---

## 5. Design system "Grafito"

Ya se ve en el canvas (página "Lenguaje y menú"). Resumen técnico:

**Tokens** (CSS custom properties, `html[data-theme="dark"|"light"]`, con `color-scheme` correcto en ambos para que nada nativo quede de otro color):

| Token | Oscuro | Claro |
|---|---|---|
| fondo | `#0D0F12` | `#F6F7F9` |
| superficie | `#14171B` | `#FFFFFF` |
| elevada | `#1B1F24` | `#F0F2F5` |
| línea / fuerte | `#262B32` / `#353B44` | `#E3E6EB` / `#CDD2D9` |
| texto 1/2/3 | `#ECEEF1` / `#A7AEB8` / `#7C8592` | `#14171B` / `#4A525E` / `#646C78` |
| acento | `#5B9BFF` (texto oscuro encima) | `#2F6FE0` (texto blanco encima) |
| ok / atención / mal / info | `#5BD68A` / `#F5C04E` / `#FF6B6B` / `#4FD1C5` | `#16804A` / `#A15C00` / `#C93636` / `#0F8A80` |

Contraste mínimo 4,5:1 en texto (verificado por token); los estados nunca dependen solo del color (ícono + texto). Color propio de cada sede: se usa en el logo y el selector de sede, **no** reemplaza al acento (evita choques).

**Tipografía:** Geist (UI) y Geist Mono (etiquetas, horas, números), **alojadas por nosotros** en `/assets/` (subset latino, `font-display: swap`, solo Geist en preload ≈29 kB; Mono se baja cuando aparece). Nada de Google Fonts: dos conexiones menos, funciona offline y no le pasa la IP de cada usuario a Google. Escala 12/13/14/16/20/28/40, números tabulares.

**Componentes** (`src/ui/`, cada uno con hover, active, focus visible, disabled, loading, error y success definidos):
- **Acciones:** Button (primario/secundario/ghost/peligro, con spinner) · IconButton · Kbd.
- **Campos:** Input · Textarea (autoalto) · NumberField · **Select y Combobox** (reemplazan `SelectField`; la lista de opciones se despliega **en línea**, empujando el contenido, con búsqueda y teclado) · **DatePicker / TimeField / DateTimeField / DateRange** (el calendario también se despliega en línea) · Checkbox · Switch · Radio / Segmented · TagInput (chips, arregla el bug 10) · ColorField (Tenants) · FileDrop (reemplaza los 4 patrones de `input type=file`).
- **Patrones en línea (reemplazan a modales, paneles y toasts):** Disclosure / sección que se expande · ficha que se abre debajo de su fila o en una columna de la misma página · formulario en línea · **barra de selección** que reemplaza el encabezado de la lista (con las confirmaciones de lote) · **línea de estado** con Deshacer / Reintentar debajo de donde pasó la acción · vistas de detalle como página propia (con URL) para lo que hoy es un modal grande (editar equipo, tarea, ticket).
- **Datos y estados:** Table (densa, selección, orden por columna, filas-tarjeta cuando es angosta) · **StatusText** (texto de estado sin pastilla: el estado normal no se marca, lo que pide atención va coloreado sin fondo) · **Ring** (anillo fino para libres/total; reemplaza las barras de progreso) · Skeleton · EmptyState · ErrorState · Tabs · CommandPalette (Ctrl+K, abre en línea arriba del contenido de la página).
- **TruncatedText + Tooltip:** la única capa flotante permitida. Todo texto cortado con elipsis se lee completo al hacer hover o foco, solo si está realmente cortado; en touch, tocarlo lo despliega en línea.

Inventario de lo nativo a reemplazar (de `07`): 19 checkbox, 12 `number`, 10 `file`, 24 `textarea`, 7 `details`, 4 `datalist`, 3 `datetime-local`, 6 horas como texto, ~30 tooltips `title=`, scrollbars (4 definiciones que se pisan → una). Lo pesado (pickers, FileDrop, ColorField) va en un chunk diferido.

**Movimiento:** recetas de transitions.dev ya en el repo, solo `transform`/`opacity`, 120–220 ms, todo con guarda `prefers-reduced-motion`.

**Reglas de layout (no negociables):** se ve bien en todas las resoluciones (360 a 1920+ px); botón del Asistente en la barra superior (nunca flotante); checkbox propio sobrio (borde gris, marcado claro con tilde oscura, nunca azul brillante); cero puntitos de color delante de textos o filtros; sin modales ni capas flotantes (lo que se abre va en línea y empuja el contenido; única excepción: el tooltip del texto truncado); sin "AI slop" (pastillas con puntito y fondo tintado, barras de progreso de colores, glows, gradientes); nada se superpone en ningún ancho de 360 a 1920 px; ningún botón ni label se parte en varias líneas (se acortan con elipsis o pasan a ícono); grupos de botones y chips envuelven en filas; columnas que no entran bajan debajo en vez de aplastarse; tablas angostas pasan a filas-tarjeta; nunca scroll horizontal de la página; **nunca una barra de scroll visible** (preferir "Ver más/anteriores"; si un contenedor tiene que scrollear, barra oculta con degradé en el borde).

### 5.1 Mobile: la pantalla es fija (pedido del dueño)

En el celular (navegador y PWA instalada) la app se comporta como una app nativa: **no se puede hacer zoom con dos dedos, no se puede arrastrar la página de costado y nunca se ve nada por fuera de la pantalla**. En desktop el zoom del navegador se respeta, pero con zoom afuera la app sigue llenando la ventana. Cada detalle:

1. **Viewport:** `width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover, interactive-widget=resizes-content`. Se corrige el comentario viejo de `main.tsx` que dice que el bloqueo se sacó.
2. **iPhone (Safari ignora `user-scalable=no`):** un módulo chico en `main.tsx` cancela `gesturestart`, `gesturechange` y `gestureend`, y cualquier `touchmove` con 2 o más dedos (`preventDefault` con `passive: false`, en `document`). Si `visualViewport.scale` quedara distinto de 1 (por ejemplo, al volver de otra app), se vuelve a 1.
3. **Doble toque:** `touch-action: manipulation` en `html`, `body` y en todo lo tocable, así el doble toque no hace zoom (ya existe en `html`/`body`; se extiende a los componentes nuevos).
4. **Zoom automático al tocar un campo (iOS):** todo `input`, `textarea` y campo propio con texto de 16 px o más en mobile (hoy hay una regla con `!important`; pasa al token de tamaño de los campos).
5. **Sin arrastre lateral:** `html` y `body` con `overflow-x: clip` y `overscroll-behavior: none` en los dos ejes; ningún elemento puede medir más que el viewport (lo verifica la prueba de la sección 7). Swipe horizontal = la página no se mueve.
6. **Sin ver "afuera" en el rebote:** `overscroll-behavior: none` en `html` y `body`; el fondo de `html` es el mismo color que el fondo de la app (oscuro o claro según tema) y `theme-color` sigue al tema, así ni el rebote ni la barra del sistema muestran blanco u otro color.
7. **Altos:** `100dvh` en lugar de `100vh` (hoy hay 9 usos de `100vh`) para que la barra del navegador al aparecer/desaparecer no haga saltar el layout.
8. **Zonas seguras:** barra inferior y topbar con `env(safe-area-inset-*)` (notch, barra de gestos), sin que nada quede debajo.
9. **Teclado abierto:** con `interactive-widget=resizes-content` y `visualViewport`, la barra inferior se oculta mientras el teclado está abierto, así no tapa el campo que estás escribiendo.
10. **Excepciones contenidas:** el plano de aulas y el Canvas tienen su propio zoom con dos dedos **dentro de su recuadro** (`touch-action: none` solo ahí, escala por `transform`); la página alrededor no se mueve ni se agranda.
11. **PWA:** `display: standalone` y `orientation: portrait-primary` (ya están); fondo y `theme_color` del manifest con el color del tema.
12. **Desktop con zoom afuera** (Ctrl y la rueda, o Ctrl y -): el layout es fluido hasta cualquier ancho; el fondo de la app cubre toda la ventana; los contenedores con ancho máximo quedan centrados sobre el mismo fondo; nunca aparece un borde blanco, una franja vacía o algo cortado. Con zoom adentro vale la regla de siempre: nada se superpone ni scrollea de costado.
13. **Compensación de accesibilidad:** como el zoom con dos dedos queda bloqueado (decisión del dueño), Configuración › Tema suma **Tamaño de texto** (Normal, Grande, Muy grande) que escala la tipografía de toda la app sin romper el layout.
14. **Pruebas automáticas** (se suman a la sección 7), en emulación de iPhone y Android: un gesto de pinza con dos dedos deja `visualViewport.scale` en 1; un swipe horizontal deja `scrollX` en 0; el doble toque no cambia la escala; enfocar un campo no cambia la escala; `documentElement.scrollWidth` igual a `clientWidth` en todas las pantallas; en desktop a 2880 px de ancho CSS (zoom 50 %) no hay ningún píxel fuera del fondo de la app.

**Guardia automática:** un script en `npm run build` que falla si aparece fuera de `src/ui/` un `<select>`, `type="date|time|datetime-local|color|file|number"`, checkbox/radio crudo, `<details>`, `<datalist>`, `title=` como tooltip, `window.confirm|prompt|alert` o un color hexadecimal suelto en CSS de pantallas.

---

## 6. Plan por etapas

Cada etapa: rama → PR → pruebas de la sección 7 en verde → deploy → vos lo revisás → recién ahí la siguiente. Siempre se puede volver al commit anterior. Ninguna etapa deja la app a medio camino: lo no migrado sigue funcionando igual.

| Etapa | Qué | Sale cuando |
|---|---|---|
| **0. Red de seguridad** | Pruebas e2e de los flujos críticos (sección 7), guardia de controles nativos, medición base guardada, **arreglo de los bugs de la sección 3** (en PRs propios, sin cambios visuales) | e2e en verde contra la app actual; bugs cerrados |
| **1. Fundamentos** | Tokens oscuro/claro + `color-scheme`; remapear las variables viejas a la paleta Grafito (lo viejo ya cambia de color); Geist; librería `src/ui/` completa con su página de muestra interna (solo superadmin); CSS partido por pantalla | todos los componentes con sus 7 estados en los dos temas; presupuestos OK |
| **2. Shell** | Menú agrupado (Menú A, con colapsado a 56 px), topbar, **Ctrl+K** (recupera la búsqueda global: saltar a `D1436`, "prestar D1436", ir a secciones, acciones), barra inferior mobile, Atrás/Adelante del navegador con la misma URL de hoy, un solo menú (se borran los dos shells paralelos) | checklist de `01` tildado |
| **3. Dashboard** | El diseño aprobado (sección 9) | checklist de `02` §1-4 + flujos nuevos |
| **4. Préstamos** | Formulario, escaneo continuo, chips y cartelitos con **la misma gramática de Ctrl+Click**, cierre del día | checklist de `02` completo |
| **5. Dispositivos, Inventario, Historial** | Tabla nueva con orden por columna, ficha que se expande en la misma página (sin panel superpuesto), papelera, recorrido de revisión, QR generados localmente | `03` |
| **6. Agenda, Horarios, Aulas, Recordatorios** | Semana en grilla, pickers propios (probados en iPhone), planos recoloreados sin tocar IDs, zoom/teclado en el plano | `04` |
| **7. Tareas, Tickets, Sugerencias, Conocimiento, Canvas** | **Tareas se rediseña entera** con las reglas Grafito y todas sus funciones (decisión del dueño del 19/10); lo único que se conserva tal cual es la transición del botón "+" (menú gooey, `motion.css` §9 + `GooeyMenu.tsx`). Tickets con bandeja, TagInput | `05` |
| **8. Analítica, Configuración, Herramientas, Accesos, Caja chica** | Analítica sobre la propuesta 05 (planificar la demanda) con gráficos variados y elegidos por dato (mapa de calor, líneas/áreas, columnas, anillos, puntos), sin barras horizontales de progreso | `06` |
| **9. Login, PWA y limpieza** | Login, borrar el CSS viejo que quedó, perfiles de tema viejos, caché del SW `v4`, actualizar `CLAUDE.md` | CSS inicial ≤ 40 kB gzip; 500/500 |

El asistente de IA (sección 8) se trabaja en paralelo a partir de la etapa 2 (su panel es parte del shell).

---

## 7. Pruebas para no perder nada

1. **Listas de verificación manuales**: los 500 puntos, tildados por pantalla y adjuntados al PR de esa etapa.
2. **E2E automáticas** (ya tenemos `puppeteer-core` y Chrome del banco de rendimiento; corren contra el server real con una **copia** de la base, nunca la de producción). Flujos mínimos:
   - prestar / devolver uno; lotes; escaneo continuo con Enter, duplicado y no disponible;
   - **Ctrl+Click, Cmd+Click y Shift+Click** en chips y cartelitos → barra → Prestar N / Devolver N; chip bloqueado no responde;
   - escáner global fuera de inputs → Préstamos; dentro de un diálogo → no navega;
   - búsqueda flexible (los 7 formatos); borrar → Deshacer → papelera → restaurar;
   - mover tarea por drag & drop; cambio de estado de ticket; alta de agenda con conflicto de capacidad;
   - modo consulta: ninguna acción de escritura visible/habilitada;
   - cambio de sede: no se cruzan datos; 401 → login; URL `/sede/X/vista` abre la vista correcta.
3. **Guardia de controles nativos** (sección 5) en `npm run build`.
4. **Sin scroll horizontal, sin superposiciones, sin barras visibles**: prueba automática a 360, 768, 1024, 1280 y 1440 px en cada pantalla y en los dos temas. Falla si la página scrollea en X, si dos elementos de texto o controles visibles se pisan (intersección de sus cajas), si un botón ocupa más de una línea o si algún contenedor muestra una barra de scroll (`offsetWidth - clientWidth > 0` con overflow scrolleable).
5. **Capturas** de cada pantalla en oscuro y claro × 360/768/**1366×768/1440×900** (el monitor del dueño es de 19": lo principal de cada pantalla entra sin scrollear) para revisar a ojo antes/después.
6. **Accesibilidad**: foco visible, Tab/Escape en diálogos, contraste por token.
7. **Rendimiento** en cada PR con `perf/compare.mjs` (A/B intercalado, siempre el mismo navegador) y `bench-api.mjs`; presupuestos (de `07` §3.6): CSS inicial ≤ 58 kB gzip (meta 40), JS de entrada ≤ 102 kB, total crítico ≤ 185 kB, app lista ≤ 410 ms con CPU 4×, ninguna pantalla > 300 ms al abrir, scroll p95 ≤ 17 ms. **Ninguna métrica empeora más de 5 %.**
8. **Postgres real**: `pg-smoke.mjs` para cualquier cambio de server.

---

## 8. Arquitectura del asistente de IA

**Cómo está hoy:** botón flotante abajo a la derecha que abre un panel (`AssistantPanel.tsx`) → `POST /api/asistente/chat` → bucle de herramientas en el server (`chat.service.js`) con la Responses API de OpenAI, 13 herramientas (buscar/detalle de equipos, personas, préstamos activos, historial, tareas, agenda, resumen, procedimientos, base de conocimiento, abrir sección, **registrar préstamo/devolución, crear tarea/evento**), límite por usuario (15/min, 8 audios/min), permisos por rol (las de escritura se bloquean en solo consulta), todo acotado a la sede, contexto de la pantalla abierta, dictado (`/asistente/transcribir`) y lectura en voz alta del navegador. **La API key ya vive solo en el backend** (`OPENAI_API_KEY` en el `.env` del server); el front nunca la ve.

**Propuesta:**

```
Navegador                          Server (Express)                          Proveedor IA
─────────                          ────────────────                          ────────────
Panel del asistente (columna)──►  /api/asistente/chat (SSE, streaming)
 · contexto de pantalla            ├─ auth + sede + rol (como hoy)
 · Ctrl+K "Preguntar…"             ├─ límites: por usuario + tope diario por sede
 · dictado / voz                   ├─ Orquestador (bucle de herramientas, timeout, máx. rondas)
                                   │   ├─ Registro de herramientas
 Tarjetas de acción  ◄──────────── │   │   lectura: consultas acotadas a la sede
 (Deshacer)                        │   │   escritura: devuelven "acción ejecutada + deshacer"
                                   │   ├─ Contenido de la base = datos NO confiables
                                   │   │   (notas, tickets, artículos van delimitados:
                                   │   │    nunca se obedecen instrucciones que vengan ahí)
                                   │   └─ Auditoría: usuario, herramienta, args, resultado
                                   └─ Adaptador de proveedor  ───────────────► OpenAI / Anthropic
                                       (AI_PROVIDER, AI_MODEL, *_API_KEY       (elegible por env)
                                        solo en variables de entorno)
```

**Decidido (16/10):** la IA pasa de OpenAI a **Claude Haiku 5.5** (`claude-haiku-5-5`) y la key de OpenAI se borra. Sin apuro, en este orden para que nada se rompa en el medio:

1. Adaptador de Anthropic detrás de la misma interfaz, para las 4 funciones que hoy usan OpenAI: chat del asistente (`chat.service.js`), resúmenes IA de tickets (`aiSummaries.service.js`), diagnóstico IA de aulas (`classrooms.routes.js`) y el cliente base (`openaiResponses.service.js`).
2. **Dictado por voz:** Anthropic no transcribe audio, así que pasa al reconocimiento de voz del navegador (Web Speech API): gratis y sin key. En Firefox no existe, así que ahí el micrófono se oculta. En Chrome el audio lo procesa Google. Se borra `/asistente/transcribir` y `audio.service.js`. La lectura en voz alta ya es del navegador y no cambia.
3. Llamada de prueba mínima con la key nueva antes de depender de ella (empieza con `sk-ant-usr-`, distinto del formato habitual `sk-ant-api…`).
4. `ANTHROPIC_API_KEY` y `AI_MODEL=claude-haiku-5-5` en el `.env` del server (nunca en el repo), deploy, verificación de las 4 funciones en producción.
5. Recién entonces se borra `OPENAI_API_KEY` del `.env` de producción y la dependencia `openai` de `package.json`.

1. **Claves**: solo en el `.env` del server (`OPENAI_API_KEY`, opcional `ANTHROPIC_API_KEY`), nunca con prefijo `VITE_`. Una prueba del build falla si el `dist/` contiene algo con forma de key.
2. **Adaptador de proveedor**: una interfaz (`generate({ messages, tools, stream })`) con implementación OpenAI (la actual) y opcional Anthropic, elegida por `AI_PROVIDER`/`AI_MODEL`. Cambiar de modelo no toca el resto.
3. **Streaming (SSE)**: la respuesta aparece mientras se escribe; las llamadas a la IA son asíncronas y no bloquean el proceso. Las consultas de las herramientas sí son sincrónicas (`pg-sync`): se mantienen acotadas (sin SQL libre, como hoy) y medidas con el banco.
4. **Acciones con Deshacer**: hoy las escrituras se ejecutan sin confirmar. Se mantiene la rapidez, pero cada acción vuelve como tarjeta ("Touch 34 prestado a Máximo M. · Deshacer") usando el mismo Deshacer del Dashboard. Las de alto impacto (más de 5 equipos, borrar) piden confirmación.
5. **Seguridad**: permisos y sede se validan en el server en cada herramienta (no en el prompt); el contenido que viene de la base va delimitado como dato; las acciones de escritura solo si el pedido sale del usuario.
6. **Auditoría y costos**: cada llamada a herramienta queda en `local_movements` (`origen='Asistente'`); tokens y latencia en el log; tope diario por sede configurable; si el proveedor falla, cae al modo local de reglas (existe hoy).
7. **UI**: el asistente pasa a ser una columna que se abre al costado empujando el contenido (o una vista propia en mobile), sin taparlo; Escape la cierra, scroll al último mensaje, "Nueva conversación"; entrada también desde Ctrl+K; se conservan dictado y lectura en voz alta.
8. **Evaluaciones**: 30 pedidos de ejemplo ("prestá la touch 34 a Máximo", "qué hay en agenda hoy", "devolvé D1436") que se corren contra una copia de la base para verificar que elige la herramienta correcta antes de cambiar modelo o prompt.

---

## 9. Dashboard nuevo — "Mostrador" (aprobado con cambios, 16/10)

**Ver en el canvas, página "Dashboard nuevo"** (https://claude.ai/artifact/HJ4NZt5L6JmSMXXiNp2b3a). Ahí están la pantalla principal (se puede usar: tipear "touch 34", devolver, Deshacer, Ctrl+Click en filas), la hoja de estados y flujos, y el mobile.

El dueño lo aprobó ("me gusta bastante") con estos cambios, ya incorporados abajo:
- Sin analíticas en el inicio: solo datos útiles que cambian, más tareas y notas.
- Solo 3 contadores: **Disponibles, Prestados, Más de 1 día afuera**. Fuera de servicio y No encontrados no van (no se usan; "no encontrado" es un equipo perdido hace meses). Siguen existiendo en Dispositivos.
- Tocar **Disponibles** deja elegir entre **todos** los tipos de equipo de la sede (cada uno con libres/total; los que tienen 0 libres se ven apagados), más "Todos los tipos".
- **Nunca una barra de scroll visible ni nada superpuesto**, en ningún ancho (ver sección 5, reglas de layout).

Pensado para el mostrador real: solo datos que cambian durante el día y las acciones frecuentes en un paso.

1. **Barra de acción** (arriba, ancho completo): "Escaneá o escribí un equipo". El resultado aparece debajo con LA acción que corresponde marcada con Enter: prestado → **Devolver ↵**; libre → **Prestar ↵** con Persona/Ubicación/Motivo en línea (con la sugerencia por historial). "Prestar varios" / "Devolver varios" abren el escaneo continuo. Atajo `/`.
2. **Estado del momento** (3 contadores que filtran la lista): Disponibles · Prestados · Más de 1 día afuera. Tocar Disponibles abre el selector de tipo con **todos** los tipos ("Touch 18/25 libres", "TIC 9/12", … y "Todos los tipos"), en filas que envuelven, nunca con scroll lateral.
3. **Afuera ahora** (lista principal): equipo, quién, dónde, desde cuándo (con tono por antigüedad), **Devolver** por fila; la ficha (con editar y copiar etiqueta) se expande debajo de la fila. **Ctrl/Cmd/Shift+Click marca filas** (misma gramática que los cartelitos) → "Devolver N". Pestañas Prestados / Disponibles / Todos.
4. **Ahora** (columna derecha): agenda de hoy (la en curso con Entregar / Marcar realizada, las próximas), recreo, **tus tareas** (abren esa tarea), **notas** (notas, ★ importante, Enter envía).
5. **Últimos movimientos**: timeline compacta, link a Historial.

Estados: cargando (skeletons con la forma real), vacío, error por bloque con Reintentar y "actualizado hace…", devolución fallida con Reintentar, "Devolviendo…", modo consulta (candado, sin acciones), sin conexión.

**Para aprobar o cambiar:**
- a) En el Dashboard, lo que se escanea con el lector cae en la barra de acción (en el resto de la app sigue llevando a Préstamos, como hoy).
- b) Devolver deja un **Deshacer** de 8 s (nuevo; re-presta con los mismos datos).
- c) Desaparecen del inicio las tarjetas grandes por categoría y la tabla de todos los equipos (quedan como filtros y en la pestaña "Todos"). No se pierde ningún filtro.
- d) El cierre del día queda como botón en la barra superior del inicio.

---

## 10. Mejoras de experiencia propuestas (opcionales, se suman sin reemplazar nada)

- Ctrl+K para todo (buscar equipo, prestar, ir a secciones, preguntar al asistente).
- Shift+Click con **rango** dentro de un grupo (hoy Shift = Ctrl); mantener apretado en mobile para entrar al modo selección.
- Deshacer en devoluciones de un click y en borrados que hoy no tienen vuelta atrás (columnas, nodos, plantillas, notas).
- Orden por columna en todas las tablas; un único motor de búsqueda flexible para Dispositivos, Inventario, Historial y Ctrl+K.
- Editar actividades de agenda (hoy solo borrar y recrear) y marcar Realizado / Faltaron equipos.
- Lotes de estado y borrado en un request (hoy uno por equipo en serie).
- Atrás/Adelante del navegador; cerrar menús con Escape y click afuera.

---

## 11. Decisiones que necesito de vos

1. **Dashboard**: aprobar o pedir cambios (sección 9, puntos a–d).
2. **Analítica**: cuál de las 10 propuestas (o qué mezcla).
3. **Temas**: reemplazar los 8 perfiles actuales por Oscuro / Claro / Sistema (+ densidad cómoda/compacta). Si alguno de los estilos de menú (escalera, centrado, peek) se usa de verdad, decime.
4. ~~**Asistente**~~: decidido, Claude Haiku 5.5 y se borra OpenAI; dictado con el reconocimiento de voz del navegador (sección 8).
5. **Lo que se cortó de tu mensaje**: entre "si necesito devolver una computadora, debería poder:" y "…Key en frontend" se perdió un tramo. Si había más requisitos del Dashboard o del asistente, pasámelos.
