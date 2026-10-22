# Pruebas de punta a punta (e2e)

Red de seguridad del rediseño (PLAN §7): corre la app **actual** de verdad y verifica los flujos críticos antes y después de cada etapa.

```bash
npm run e2e                        # todo: funcionales + línea base (i, j) + barrido ux · ~10 min
npm run e2e -- --no-baseline       # solo funcionales (sin i, j ni ux) · ~4,5 min
npm run e2e -- --no-ux             # todo menos el barrido ux
npm run e2e -- --only=ux           # solo el barrido ux (--only="ux recursos", --only="ux equipo"...) · ~4 min
npm run e2e -- --ux-lenient        # el barrido ux solo informa (no corta): para depurar una pantalla
npm run e2e -- --only=prestamos    # filtra por grupo o nombre (sin tildes ni mayúsculas)
npm run e2e -- --no-build          # usa dist/ como esté, aunque sea más viejo que src/
npm run e2e -- --build             # buildea sí o sí
npm run e2e -- --headful --keep    # navegador a la vista y conserva la copia de la base
npm run e2e -- --only=asistente --ai  # el server de prueba usa la IA del .env (gasta tokens)
npm run check:ui                   # guardia de controles nativos (scripts/check-ui.mjs)
```

## Qué hace

1. **Build:** si `dist/` no existe o es más viejo que `src/`/`public/`, corre `vite build` (sin `tsc`: el chequeo de tipos es de `npm run build`).
2. **Base:** copia `data/techasset.db` a un temporal con la API de backup de SQLite. **Nunca** toca la base real ni Postgres. En la copia: sesión para el superadmin existente, un usuario de **solo consulta** (lo crea si no hay), un equipo puesto *Fuera de servicio* para el chip bloqueado, `mail.modoPrueba=true` y sin suscripciones push.
3. **Server:** `node server/index.js` en un puerto libre de `127.0.0.1`, con `DATABASE_URL`, SMTP, Resend, OpenAI, Google, VAPID y la planilla vacíos y `MODO_PRUEBA=true`: no sale ningún mail, push ni llamada externa. Adjuntos (`UPLOADS_DIR`), temporales de Herramientas (`TOOLS_TEMP_DIR`) y CSV de caché van al temporal de la corrida (se copian los adjuntos que ya había para que los de la base abran) y se borran con él: **una corrida no deja nada en `data/`**. La copia de la base se hace sin crear `-wal`/`-shm` al lado de la fuente.
4. **Navegador:** Chrome (si no, Edge; `E2E_BROWSER=<ruta>` lo pisa) con `puppeteer-core`, sin `--hide-scrollbars` para que las barras ocupen lugar como en la vida real. Cada grupo usa un contexto aislado con la cookie de sesión y la sede `NFPT`.
5. **Salida:** tabla en consola, `e2e/last-run.json` con todo el detalle (incluye las muestras de layout por vista y ancho) y capturas de las pruebas que fallan en `e2e/.out/fallas/`.

**Exit code 1** si falla alguna prueba funcional (a–h y las demás) o si el barrido ux (que es bloqueante) encuentra algo. Las de línea base (i, j) se reportan con conteos y no cambian el exit code; con `--ux-lenient` el barrido ux también pasa a informar sin cortar.

## Qué garantiza

Cada prueba verifica el efecto en la base (vía API), no solo lo que se ve.

| | Pruebas |
|---|---|
| a | Préstamos: prestar y devolver por formulario; escaneo continuo con Enter (duplicado avisado, no disponible en rojo, lote de 2 en un request); **Ctrl, Meta y Shift+Click** en chips de equipos prenden la selección sin prestar; barra con *Prestar N* / *Devolver N*; *Prestar N* pasa el lote al escaneo continuo; chip bloqueado no responde; click simple en prestado lo devuelve; cartelitos con los tres modificadores (*Entregar N* / *Devolver N*) |
| b | Escáner global: tipear rápido fuera de inputs lleva a Préstamos con la etiqueta; dentro de un campo o con foco en un diálogo no navega |
| c | Búsqueda flexible en Dispositivos: `touch N`, `touchN`, `Ntouch`, `D####`, `####`, `plani N`, `planificación N` (toma alias que existan en la copia) |
| d | Borrar → Deshacer; borrar → papelera → Restaurar |
| e | Mover una tarea de columna (drag & drop con `DataTransfer`); cambiar el estado de un ticket (lo crea en la copia si no hay) |
| f | Alta de agenda con conflicto de capacidad: aparece el aviso y no se guarda |
| g | Modo consulta en Inicio, Préstamos y Dispositivos: ningún botón de escritura habilitado, chips y casillas deshabilitados; el server responde 403 |
| h | `/sede/NFPT/<vista>` abre la vista correcta para cada ítem del menú; un 401 vuelve al login |
| k | Asistente: sin `SpeechRecognition` el micrófono no aparece y con él el dictado deja el resultado intermedio y el final en el campo; un pedido de solo lectura ("¿cuántos equipos hay prestados?") llega por el stream con respuesta (modo local en el banco; IA real con `--ai`); stream simulado en la página: texto en vivo sin markdown + línea "Prestando…", `done.reply` al final, acciones con Deshacer (ok y 409 en línea) y confirmación del lote que envía "sí, confirmo". Con `--ai`, además un préstamo real por el asistente y su Deshacer, verificado por API |
| d, e | Suites `tests/devices.mjs` (Dispositivos e Historial: selección por rango, borrar en lote con Deshacer, ficha en línea y como página) y `tests/tasks.mjs` (Tareas TIC: columnas, Deshacer, actividad, URL por tarea) |
| n | Inicio (funcional): el lector cae en la barra, prestar en línea desde la barra con Deshacer, selección con Ctrl/Shift+Click y Devolver N en un request |
| inv | Inventario TIC (`tests/inventory.mjs`): búsqueda flexible, ficha en línea, ocultar con Deshacer, "Crear las N" en un request, recorrido de revisión y modo consulta |
| tk | Tickets y Sugerencias (`tests/tickets.mjs`): bandeja con URL propia, alta en el lugar, estado con Deshacer, checklist, lotes con confirmación, plantillas y modo consulta |
| au, rec | Estado de aulas y Recordatorios (`tests/classrooms.mjs`): IDs de los planos contra `fixtures/classroom-room-ids.json`, ficha en línea con teclado, zoom y pinza solo en el plano, tickets vinculados, categorías; recordatorios con fecha del selector propio en iPhone, completar/posponer/editar/borrar con Deshacer y modo consulta |
| kb, cv | Conocimiento y Canvas (`tests/knowledgeCanvas.mjs`): editor sin saltos del cursor, búsqueda sin tildes, URL por artículo y Atrás, adjuntos; canvas con altas, mover/redimensionar con teclado, zoom, borrar con Deshacer, archivos al centro de la vista y modo consulta |
| tl | Herramientas, Accesos rápidos y Caja chica (`tests/tools.mjs`): alta de acceso con sugerencia `https://` y Enter, editar en la fila (Esc no guarda), borrar → Deshacer, ordenar; CSV con columnas faltantes, vista previa con contraseña oculta, tarjetas y reporte que se abren dos veces; Enviar exige validar; gasto con importe `1.234,50` y control de saldo; aprobar con alta en Inventario TIC; rechazar con nota editable; modo consulta en las tres; abrir/cerrar paneles no mueve el encabezado |
| cfg | Configuración (`tests/settings.mjs`): Usuarios aprobar → Deshacer (el mail en espera se cancela) y borrar con confirmación en línea → Deshacer; Módulos (conteo de cambios, aviso al salir, Descartar, reordenar y menú); Roles (Editar marca Ver, eliminar con confirmación); Invitaciones (link, revocar); Sedes (409); Avanzado (JSON inválido, el server valida); links viejos `/tenants`, `/adminusers`, `/configuracion/usuarios` y Atrás; cerrar un panel en línea no mueve el encabezado; rol sin admin |
| an | Analítica (`tests/analytics.mjs`): índice que marca la sección, carga diferida sin saltos, valor exacto en línea, Gráfico/Tabla sin mover el encabezado, Recargar sin caché, período |
| ini | **Inicio sin huecos ni truncados** (`tests/inicio.mjs`): 8 casos de datos servidos interceptando los GET (sin préstamos, 1, 34, sin agenda, sin tareas, sin notas, muchas notas, todo vacío) × 360/768/1024/1280/1366/1440/1920 × oscuro y claro. Falla si hay un hueco > 48 px entre bloques consecutivos de una columna o dentro de una tarjeta, un texto cortado con elipsis que tenía lugar en su renglón, scroll horizontal, solapamientos o botones partidos. Además: el vacío de "Afuera ahora" es compacto, sin pie de atajos, y sus acciones enfocan la barra / cambian la lista; plegar "Últimos movimientos" y cambiar de ficha dejan quieto el encabezado tocado (≤ 2 px). Capturas en `e2e/.out/inicio-fix/` |
| bop | **Barrido de operación** (`tests/operacion.mjs`): en Inicio, Préstamos, Dispositivos, Historial e Inventario TIC abre y cierra cada plegable (cierre del día, grupos, cartelitos, último día, escaneo continuo, accesorios, paneles, fichas debajo de filas, resumen del Historial) con el área scrolleada: el disparador no se mueve más de 2 px en lo que se pinta, el documento no scrollea y el alto se anima; cambiar de ficha deja quieta la fila tocada. Sondas por ancho (360–1920) y tema, con casos de datos (sin préstamos, 34) y estados abiertos: huecos > 48 px, elipsis con lugar, placeholders cortados y controles tapados. Doble Enter / doble click en Prestar, Devolver y Deshacer = un request y el campo quieto; marcar el primero no corre lo tocado; con equipos marcados el buscador de Dispositivos sigue usable. Capturas en `e2e/.out/barrido-operacion/` |
| bxo | **Barrido REGLAS-UX de Agenda, Horarios, Aulas, Recordatorios, Tareas, Tickets y Sugerencias** (`tests/barridoOperacion.mjs`): por pantalla a 360/768/1024/1280/1366/1440/1920, sin scroll horizontal, sin huecos > 48 px dentro de las tarjetas, ningún control tapado (elementFromPoint en su centro) y ningún texto cortado con elipsis que tenía lugar; cada botón con `aria-expanded` visible se abre (el disparador sigue a la vista) y se cierra sin moverse más de 2 px; Tareas sin "Columnas 1–3 de 3" fantasma, lápiz de columna quieto y, en mobile, la barra de selección fija a la vista sin mover ni tapar la tarjeta tocada; Aulas sin hueco debajo del plano en plantas anchas; Recordatorios: el alta en ancho no hace saltar la lista; Horarios: el borrador de recreos sobrevive a ir y volver por el menú (y Descartar vuelve a lo guardado); Agenda: detalle y Sincronizar sin mover el disparador; una notificación con link `/tickets/<id>` abre ese ticket y Atrás vuelve |
| lg | **Login y landing** (`tests/auth.mjs`): invitación creada por API → landing → "Tengo un código" → `/register?code=` (código precargado, URL limpia, doble toque = un solo registro) → pasa a Ingresar con el mail puesto → "Olvidé mi contraseña" (mensaje neutro; el link sale de `MAIL_CAPTURE_FILE`, que el server escribe solo con `NODE_ENV=test`) → "Elegí tu contraseña" (si no coinciden, lo escrito queda) → contraseña mala (error en línea, el mail queda) → ingreso → sesión vencida (vuelve a la misma vista, con "Entrás a la sede") → cerrar sesión → link de sede sin sesión y "Usar mi sede por defecto". Errores de la URL traducidos, tema y `theme-color` desde el ingreso, sin scroll horizontal 360–1920, sonda UX en 0 en landing/login/registro (390/1024/1440, oscuro y claro) y las pestañas quietas al cambiar de modo. Capturas en `e2e/.out/etapa9/` |
| pwa | **PWA** (`tests/pwa.mjs`): sin errores de instalabilidad (`Page.getInstallabilityErrors`), íconos 192/512/maskable y colores del tema; el SW guarda el shell (index + JS/CSS de entrada) y sin red abre con "Sin conexión"; un `sw.js` nuevo (deploy simulado) queda esperando, la cabecera avisa "Hay una versión nueva · Actualizar" y al tocarlo se activa, recarga y borra el caché viejo |
| i | **Línea base de layout** por vista a 360/768/1024/1280/1366/1440: scroll horizontal de la página, barra de la página, barras visibles en contenedores, botones con el texto partido, hermanos que se pisan (> 2 px) |
| j | **Línea base mobile** (iPhone 13): pinza con dos dedos (`Input.dispatchTouchEvent`), swipe horizontal, doble toque y foco en un campo dejan escala 1 y `scrollX` 0; campos con texto ≥ 16 px. Incluye un control: la misma pinza tiene que hacer zoom en una página que no lo bloquea |
| ux | **Barrido de REGLAS-UX** (`tests/ux.mjs`, **bloqueante**; `--ux-lenient` lo deja como línea base): todas las vistas del menú y las páginas de detalle con URL (equipo, tarea, ticket, artículo, cada panel de Configuración) a 390, 1024 y 1440 en oscuro y claro, con la sonda `lib/ux-probe.mjs`: huecos > 48 px entre bloques, tarjetas con franjas vacías, truncados con lugar, texto cortado sin elipsis, controles tapados (recorriendo el scroll), cursor de mano sin control, y cada colapsable (`aria-expanded`) abre y cierra sin mover su disparador (± 2 px), sin scrollear el documento, sin cambiar el alto de golpe y con `aria-controls`. Shell aparte (cabecera, menú, barra inferior). Capturas y `report.json` en `e2e/.out/ux/` |
| sh | **Shell y colapsos** (funcional): en Préstamos, abrir y cerrar un grupo y "Cartelitos de fotos" con el área scrolleada lo más abajo posible: el encabezado tocado no se mueve más de 2 px en ningún frame, el documento no scrollea y el alto pasa por valores intermedios (se anima). En el Inicio, la franja de Accesos rápidos: el rayo no se mueve al abrir ni al cerrar, scrolleado lo que se mira no salta, los accesos usan más de una columna y ningún título se corta. Menú lateral a 1440×900 y 1366×768: todos los ítems enteros dentro de la lista, ninguno tapado por el pie, sin scroll; a 1024×640, 1024×768 (rail) y 1280×640 puede scrollear pero ningún ítem queda a medias (arriba, con la rueda y al fondo). Línea de estado de la cabecera con alto suave al aparecer y al irse. Mobile: con el teclado abierto la barra inferior se esconde y el campo enfocado queda a la vista. "Inicio" entero bajo la cabecera (resaltado, rayita de activo y anillo de foco con ≥ 4 px de aire) en expandido, denso, rail y lista que scrollea (1366×625, 1280×560, 1024×640, 1024×520, contraído, 1920), oscuro y claro, sin recortes ni vecinos dispares en el shell; Ctrl K cambia de alto suave al tipear |

## Sonda UX compartida (`lib/ux-probe.mjs`)

Para las pruebas de cada pantalla:

```js
import { probeView, checkCollapsibles, formatProbe, setTheme, settle } from '../lib/ux-probe.mjs';

await settle(page);                                   // sin skeletons y la API quieta
await setTheme(page, 'light');                         // oscuro/claro sin recargar
const probe = await probeView(page, { scope: '.mi-pantalla' });   // counts + muestras con 'where' (selector legible)
const toggles = await checkCollapsibles(page, { scope: '.mi-pantalla', max: 8 });
assert(!probe.total && !toggles.problems.length, formatProbe(probe, toggles));
```

- `probeView` mide `gaps`, `innerGaps`, `truncated`, `cut`, `covered` (recorre el área que scrollea en `scrollSteps` pasos) y `fakeClickable`. Opciones: `scope`, `maxGap` (48), `ignore` (selectores), `scrollSteps` (6). `uxProbe` es la función que corre en la página, por si se quiere una sola medición.
- `checkCollapsibles` abre y cierra con el mouse cada botón con `aria-expanded` del `scope` (salvo destructivos: `skip`), con el movimiento prendido, y mide frame a frame. Devuelve `items` y `problems`. "De golpe" se mide en el alto de la página y se descarta si lo que controla (`aria-controls` → su colapso) pasó por valores intermedios: cuando otra columna más alta le pone un piso al alto de la página, el primer frame de la curva puede consumir todo el cambio visible sin que haya salto.
- Desde el 20/10 además mide (todo bloqueante): `clipped` (caja, sombra exterior, anillo de foco —medido con `:focus-visible` por `sampleFocusRings`— y `::before`/`::after` absolutos cortados > 1 px por un ancestro con overflow; en lo que scrollea solo el borde donde el scroll llegó al tope), `topGap` (espacio muerto entre la barra superior y el primer bloque), `mismatch` (controles con caja de una misma fila con distinta altura; tarjetas tipo mosaico de una fila con distinto alto) y `modal` (diálogos o capas fijas grandes; única excepción, el diálogo del cartelito, por su nombre accesible). `checkCollapsibles` marca también la apertura/cierre de golpe (lo controlado pasa de 0 al alto final en un cuadro).
- **Pendientes conocidos** de otras pantallas: `KNOWN_PENDING` en `lib/ux-probe.mjs` (vista, tipo, selector, dueño). `splitKnown` / `splitKnownToggles` los sacan del resultado: se informan en `e2e/.out/ux/hallazgos.md` como "pendiente conocido" y no cortan. Al arreglar uno, borrá su línea.
- `data-ux-ignore` en un elemento lo saca de la sonda (solo para lienzos/planos donde el vacío es el contenido).

## Notas

- Las pruebas reparten equipos libres distintos entre sí y miran el estado actual por API, así no dependen de etiquetas fijas.
- La línea base de layout cuenta problemas por ancho; en consola: `1024: XP/3/0/94` = scroll horizontal, barra de página, 3 barras en contenedores, 0 botones partidos, 94 solapamientos. Las muestras de cada uno están en `last-run.json` → `layout.<vista>.<ancho>`.
- `last-run.json` y `.out/` tienen datos de la base local: no se commitean.
