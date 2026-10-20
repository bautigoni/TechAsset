# Pasada 2 de rendimiento — cuellos de botella críticos

Rama de trabajo sobre `rediseno-grafito` desde `799bfc7` (pasada 1 integrada). Protocolo: `docs/redesign/RENDIMIENTO.md`; directiva: `DIRECTIVA-FINAL.md` §5, §6 y §13. Todo lo que sigue son mediciones reales de esta pasada; lo que no se pudo medir está dicho.

## Condiciones de medición

- **Base:** `docs/redesign/bench/snapshot.db` regenerada con `node perf/seed-snapshot.mjs` (mismos conteos que en la pasada 1: 386 equipos NFPT, 5.145 eventos de préstamo, 410 personas, 43 prestados, 5.881 movimientos, 258 tareas, 250 tickets, 327 agenda, 150 notificaciones).
- **Checkouts:** `00` = `main` (83f97e4, con un stub local del paquete `openai` en `server/node_modules`, que ya no está instalado y solo lo usa el asistente apagado); `04` = `799bfc7`; `05` = esta rama (`5b6ca7a`, más este documento). Copias con `git archive` + junction de `node_modules`; cada paso intermedio también (c1…c10 en el registro de A/B).
- **Suite:** `perf/suite.mjs` (7 corridas, CPU 4×, red 40 ms / 10 / 5 Mbps, 15 ms sincrónicos por query, Chrome 155 headless 1366×800), con una métrica nueva: **«a la vista»** = primer frame con cambio en `<main>` sin pedidos de la acción en vuelo (las revalidaciones de fondo no cuentan) ni esqueletos dentro de la ventana. Sirve para Analítica (dibuja la primera sección y monta el resto en ratos libres) y para el arranque. Como la métrica es nueva, `00` y `04` se volvieron a medir con la misma suite.
- **A/B de cada cambio:** script de intercalado (A, B, B, A) con `--runs=4` × 2 rondas = **n = 8 por lado**, solo con las secciones de la suite que toca el cambio. Mediana / p95.
- **Trazas:** `perf/trace.mjs` ampliado: `--net` (misma red que la suite), `--action=warm` (recarga con caché y sesión recordada), `--action=type` (tipeo en Persona), `--action=more` (Cargar más del Historial) y `--timeline` (pedidos y tareas ≥ 16 ms del hilo principal en orden, con su trabajo dominante). Elige el hilo principal correcto aunque haya varios renderers.
- **Máquina:** Ryzen 5 5560U, Node 24.19. Carga de fondo medida antes de cada bloque (CPU por proceso en 10 s): al empezar, nada por encima de 0,3 s de CPU (el dev server del dueño ya no vigila `.claude/worktrees`). En la segunda mitad (A/B finales, e2e, suite de cierre e idle) el Chrome del dueño (servicio de reconocimiento de voz + renderer) consumía ~1 núcleo constante y dos procesos `claude` ~1,3 núcleos: afecta a todas las etiquetas por igual pero suma ruido (se ve en los p95 de `00-inicial-r2`).
- **HTTP/1.1:** el banco sirve por `http://127.0.0.1` (6 conexiones por host). Producción va por Caddy con HTTP/2: lo que en el banco es "cola de conexiones" en producción no existe. Se tuvo en cuenta para descartar optimizaciones que solo ayudarían al banco (ver R4).

Archivos: `05-pasada2.{json,md}` (suite de cierre), `00-inicial-r2` y `04-pasada1-r2` (re-medición inmediatamente antes/después de `05`, base de la tabla), `idle-00-inicial-r2`, `idle-04-pasada1-r2{,b}` e `idle-05-pasada2{,-b}` (reposo). Los A/B intermedios quedaron fuera del repo (son corridas parciales); sus números están en la tabla de cambios.

## Diagnóstico

| Señal (pasada 1 o nueva) | Medición | Resultado |
| --- | --- | --- |
| Inicio en frío +36 % sobre main | traza en frío con red (`trace-cold`, 04 y main) | La sesión (`/api/auth/session`, lo único que frena el primer pintado sin sesión recordada) salía **última**: detrás de agenda, turnos y tareas (los piden los efectos de sus hooks) y de los 21 módulos del Inicio que precarga la entrada. El server atiende de a un pedido y lo contestaba a los **373 ms** (main: 248). Después, `check` de `TruncatedText` era la función con más muestras (364) y forzaba layouts (Layout 405 ms en la carga). |
| Inicio en caliente +47 % | traza `warm` 04 vs main | El primer render armaba menú + barra + el Inicio entero (todavía sin datos): **104 ms** de JS + layout antes del primer pintado (main: 29 + 34). |
| Ráfaga de arranque | API desde Node | **23 consultas**: `/api/tools/config` sola hacía **8** (una por clave de mail, para devolver un link que sale del `.env`), `/api/tasks` 4 en cada poll de 30 s, `/api/recess-schedules` 2. |
| Prestar más lento que main | API + suite | Prestar uno = **13 consultas**: 3 para buscar el equipo (se rearmaba el inventario entero, ~400 `JSON.parse`), 3 escrituras y 7 para que el `GET /api/devices` siguiente rearmara inventario y vida útil. |
| Dispositivos pide grupos y papelera al abrir | suite | Dos listas completas solo para dos números; `/api/device-groups` además hacía una consulta por grupo (N+1). |
| Tareas más lento que main | suite + código | El tablero esperaba `/api/task-columns` (esqueleto) aunque las columnas ya se leían al armar `/api/tasks`. |
| LoanForm re-render por tecla | traza `type` | El render de LoanForm por tecla es **~10 ms** de JS con CPU 4×; lo que tarda hasta la sugerencia es la tecla + el primer frame del `Collapse` que abre la lista (~20 ms de Paint/Layerize por frame). No es el cuello. |
| Historial «cargar más» | traza `more` | 38 ms de JS; el resto es **layout + pintado** de las 50 filas nuevas (Layout 54, Paint 30 ms). Re-renderizar las viejas no es el costo. |
| Analítica 1ª sección | métrica «a la vista» | Ya estaba bien: **581 ms** vs 956 en main (lo que tardaba era el montaje en idle de las secciones de abajo, por diseño). |
| Precarga de pantallas (JS + CSS en idle) | traza en frío | Durante la precarga (2,1 – 3,7 s) no hay ninguna tarea ≥ 16 ms en el hilo principal: no se tocó. |
| `/api/tasks` 159 KB con las hechas | API | El costo era el server (4 consultas por poll); con la caché queda en 0 consultas y 20 ms. El tamaño viaja gzip (~25 KB) y con ETag/304 en el poll. No se paginó (ver «No se hizo»). |

## Cambios (cada uno con su A/B)

A/B = intercalado 2×4 corridas (n = 8 por lado), mediana / p95, misma suite y snapshot. «A» es el commit anterior.

| # | Cambio (commit) | Medición | A | B | Estado |
| --- | --- | --- | --- | --- | --- |
| 1 | Configuración de mail en **1 consulta** (`getAppSettings`, `IN`) y recreos con **LEFT JOIN** (eb385f7) | API desde Node | `/tools/config` 8 q · 143 ms; `/recess-schedules` 2 q · 48 ms | 1 q · 39 ms; 1 q · 40 ms | **queda** |
| 2 | Dispositivos: **`/api/devices/panel-counts`** (una consulta con dos `COUNT`) en vez de las dos listas; grupos sin N+1 (6a15e38) | suite pantallas (A/B junto con 1, 3) | Dispositivos 1ª contenido 587 ms | 533 ms (−9 %) | **queda** |
| 3 | Tareas: lista armada **en caché por sede**, invalidada por cualquier escritura de tareas/subtareas/comentarios/columnas/asistente (hook en `index.js`, antes y después del pedido) + TTL 60 s (246ff73) | API desde Node | `/tasks` 4 q · 92 ms; ráfaga de arranque 23 q · 524 ms | 0 q · 20 ms; **11 q · 329 ms** | **queda** |
| 1–3 | (pantallas, mismo A/B) | suite `startup,views,history` | Tickets 1ª 527 ms (pide `/tools/config`) | 387 ms (−27 %) | — |
| 4 | **La sesión se pide al evaluar `App`**, antes que agenda, tareas y los módulos del Inicio (232927e) | suite `startup` | frío: app visible 1.155 · FCP 1.068 · datos 1.555 · TTI 1.595 | **784 (−32 %)** · 716 (−33 %) · 1.425 (−8 %) · 1.386 (−13 %) | **queda** (ver nota TBT) |
| 5 | `TruncatedText` y `useFitPlaceholder` miden **solo desde el ResizeObserver** (después del layout) (c262a6f) | suite `startup,views,people` | caliente: app visible 477 · FCP 412; frío TBT 243 · tareas largas 750; Tareas 1ª 426 | 433 (−9 %) · 376 (−9 %); 167 (−31 %) · 695 (−7 %); 380 (−11 %) | **queda** (ver nota) |
| 6 | Préstamos: inventario y movimientos **en paralelo** después de prestar (c683f37) | suite `ops` | prestar 584 · devolver 535 | 658 (+13 %) · 579 (+8 %) | **revertido** (a318a6c): el server atiende de a uno; mandarlos juntos no adelanta el inventario y suma un render |
| 7 | **Inventario cacheado parchado en el lugar** al prestar/devolver: el equipo se busca en la caché (toda escritura la invalida o la parcha, como ya hacía el asistente) y se recalcula solo ese equipo con `mergeLocalDevice` + el estado que devuelve `setLocalState`; la lista decorada se parcha con `redecorateWith` (b5fab42) | suite `ops,api` | prestar 581 · devolver 499 ms; API prestar 13 q · 331 ms, devolver 14 q | **373 (−36 %) · 307 (−38 %)**; **3 q · 105 ms**, 4 q | **queda** |
| 8 | Las **columnas viajan con `/api/tasks`** (misma forma y orden que `/task-columns`); Tareas abre con el tablero armado y el pedido de siempre solo refresca, sin re-render si no cambió (9432668) | suite `views,api` | Tareas 1ª contenido 446 · 2ª 265 | 402 (−10 %) · 234 (−12 %) | **queda** (ver nota) |
| 9 | Campo Persona con estado propio (`PersonField` memo) para no re-renderizar LoanForm por tecla (da3a34f) | suite `people` + traza | común 99,5 · parcial 101,9 · tilde 100,7 · sin tilde 88,7 ms; JS por tecla ~10 ms | 94,6 · 93,1 · 99,6 · 99,7 (+12 %); ~9 ms | **revertido** (c5b7bbc): sin mejora clara, más complejidad |
| 10 | **Estructura de la app un frame antes que la vista** (solo la primera vez: menú, barra y esqueleto; la vista en el frame siguiente) (688a6ed) | suite `startup` | caliente: app visible 443 · FCP 388 · TTI 763 · datos 888 · tareas largas 231 | **367 (−17 %)** · 340 (−12 %) · 677 (−11 %) · 844 (−5 %) · 138 (−40 %); frío ±2 % | **queda** (ver nota TBT) |
| 10b | La vista que reemplaza a ese esqueleto **no repite la animación de entrada** (5b6ca7a) | e2e | con #10, `bxo › Agenda › Detalle de una actividad` falló 2 de 5 (la flecha se movía 4,3 px: la animación arrancaba un frame tarde); sin #10, 0 de 5 | 3/3 OK y suite completa 271/271 | **queda** (corrección de #10) |
| 11 | Historial: filas `memo` para que «Cargar más» no re-renderice las viejas (f453223) | suite `history` (A/B aislado) | cargar más 343 · 1ª página 568 | 350 (+2 %) · 552 (−3 %) | **revertido** (415c8d8): el costo es layout/pintado de las filas nuevas |
| R4 | Menos chunks para el Inicio: `manualChunks` (íconos + `src/ui`) y, en su lugar, `experimentalMinChunkSize` (a362ea3) | build | 21 archivos para abrir el Inicio | `manualChunks` arrastró `ui-kit` (+55 KB JS, +37 KB CSS) al camino crítico (los barrels no dejan saber qué queda en la entrada); `experimentalMinChunkSize` bajaba a 16 archivos pero fundía chunks **en** la entrada (96,3 → 98,3 KB gzip) | **revertido sin A/B** (ca8dae5): la cola de 6 conexiones es del banco (HTTP/1.1); producción va por HTTP/2 |

Notas sobre la regla del 5 %:

- **TBT y tareas largas (#4, #10):** el TBT se mide entre FCP y TTI. Al adelantar el FCP 350 ms (#4), entran en esa ventana tareas que antes caían antes del FCP: TBT en frío 77 → 264 ms y tareas largas 656 → 780 ms en ese A/B. El TTI baja 13 %; #5 después bajó el TBT 31 % y las tareas largas 7 %. En la suite de cierre las tareas largas totales en frío quedan iguales a `04` (732 → 746 ms, +2 %) y en caliente 248 → 279 ms (+12 %; en el A/B aislado de #10 habían bajado 40 %). Se mantienen #4 y #10 porque mejoran todo lo que el usuario ve (primer pintado, app visible, datos, TTI) y el TBT absoluto en caliente sigue bajo (77 ms).
- **#5:** en el mismo A/B, Préstamos 1ª +6,7 % (427 → 456, pero p95 547 → 492), Tickets 2ª +7,8 % (p95 269 → 247) e Historial 2ª +5,5 % (p95 285 → 257): medianas arriba con p95 abajo, y en los A/B siguientes esas pantallas no se movieron (±3 %). Se mantiene.
- **#8:** Inicio 1ª +12,8 % (222 → 250 ms) en ese A/B; en los otros A/B de la pasada el mismo valor fue 245–259 ms con el código anterior, así que el 222 del lado A es la excepción. Se mantiene.
- **#1–3:** FCP en frío +14 % en ese A/B (968 → 1.108) con app visible +0,4 %; en el A/B siguiente el mismo código (lado A de #4) dio 1.068 y con #4 queda en 716. Ninguna otra métrica empeoró más de 5 % de forma consistente.

Verificación de equivalencia (script aparte, mismo snapshot, `04` contra `05`): `GET /api/devices`, `/api/tasks` (all/team/my, sin el campo nuevo `columns`), `/api/recess-schedules`, `/api/tools/config` (con el mismo `.env`), `/api/device-groups`, `/api/devices/deleted` y `/api/movements` **idénticos byte a byte**; después de prestar, devolver y prestar en lote, `/api/devices` desde la caché parchada es **idéntico** al de un server nuevo armado desde cero. (`/api/agenda` cambia entre dos arranques del mismo checkout: no se puede comparar así.) `pg-smoke` agrega el mismo chequeo contra Postgres.

## Los 5 ejes sobre el estado actual

1. **Renders:** por interacción, la traza de tipeo muestra ~10 ms de JS por tecla en Préstamos (no vale aislarlo, #9); el primer render de la app se partió en estructura + vista (#10). Por tick, ver la tabla de reposo (commits de React por minuto con la app quieta).
2. **Bundle:** JS inicial 94,3 KB gzip (04: 94,0; main 94,4), CSS inicial 15 KB, fuente precargada 28,7 KB, total crítico 139,6 KB (presupuesto PLAN §7: JS ≤ 102, total ≤ 185). Total de JS 455,3 KB gzip en 79 archivos (sin cambios: R4 descartado).
3. **Requests:** al abrir Dispositivos, 2 pedidos de listas → 1 de contadores (#2); Tareas sin el pedido bloqueante de columnas (#8); prestar/devolver siguen siendo POST + inventario + movimientos (el inventario ahora sale de la caché parchada, 0 consultas). Por minuto con la app quieta: tabla de reposo.
4. **Queries:** ráfaga de arranque **23 → 11** consultas (−52 %, 552 → 314 ms); `/api/tasks` 4 → 0 por poll; prestar 13 → 3, devolver 14 → 4; `/tools/config` 8 → 1; `/recess-schedules` 2 → 1; `/device-groups` 1 + N → 2. En producción cada consulta es un viaje sincrónico de ~22 ms a Supabase: la ráfaga de arranque ahorra ~12 viajes (~260 ms de proceso bloqueado por cada apertura de la app) y cada préstamo ~10 viajes (~220 ms) — **cálculo con la media de `pg_stat_statements`, no medición en producción**.
5. **Imágenes, fuentes y scripts:** Geist precargada con `font-display: swap`, subsets latin/latin-ext y fallbacks métricos; Geist Mono (23 KB) se pide al aparecer los contadores en mono, sin bloquear. En frío, el primer layout con Geist cuesta ~110 ms con CPU 4× (en caliente ~35 ms): es la decodificación de la fuente variable, decisión de diseño (main usaba fuentes del sistema). Sin cambios.

**Búsqueda rápida de personas (§6):** sin cambios de código en esta pasada (el intento #9 se revirtió). Con 3 letras: 87–114 ms (main 327–339 ms), sin pedido cuando no hay resultados. Objetivo < 200 ms: cumplido.

## No se hizo (con motivo)

- **Paginar las tareas hechas** de `/api/tasks`: el problema medido era el server (resuelto con la caché, 0 consultas por poll) y paginar rompe la búsqueda de tareas viejas y los links `/tasks/<id>` a tareas hechas si no se agrega un "traer todas". Queda para la pasada 3 si el tamaño (159 KB sin comprimir) pesa en un celular.
- **Cola de notificaciones con LISTEN/NOTIFY:** son 2 consultas/min con el server quieto; `LISTEN` necesita una conexión directa (el pooler de Supabase en modo transacción no lo soporta) y los avisos con `due_at` igual necesitan un barrido. No medible contra Supabase desde acá.
- **Precarga de pantallas (solo JS en idle, CSS al abrir):** la traza no muestra tareas ≥ 16 ms durante la precarga.
- **Historial «cargar más» con `content-visibility`:** el costo es layout/pintado de filas nuevas, pero en la pasada 1 `content-visibility` en Dispositivos empeoró (R3). Queda para la pasada 3 con A/B propio.

## Cierre

- `npm run e2e` completo (con la sonda UX bloqueante): **271/271 funcionales OK, línea base 23/23 limpias**, exit 0 (1.227 s). La primera corrida completa (antes de #10b) dio 269/271: `bxo › Agenda › Detalle` (por #10, corregido en #10b) y `ux › analytics` (franja vacía en una tarjeta a 390 px oscuro); este último pasó 2/2 al repetirlo y en la corrida final.
- `npm run check:ui`: nada nuevo (4 ocurrencias heredadas).
- `npm run build`: OK, presupuestos dentro (ver eje 2).
- `pg-smoke` contra **Postgres 17** en un contenedor nuevo (`postgres:17-alpine`, puerto 55447, borrado al final): **128/128 OK**, con chequeos nuevos: inventario parchado == armado desde cero, `/devices/panel-counts`, `/tools/config` con `IN`, `/tasks` con columnas iguales a `/task-columns` y la lista cacheada que ve un alta al instante. (Una segunda corrida sobre la misma base ya usada da fallas por datos repetidos: el script asume base nueva.)
- Suite completa `05-pasada2` sobre el mismo snapshot; `04-pasada1-r2` y `00-inicial-r2` medidos inmediatamente antes y después, en las mismas condiciones.

## Tabla resumen (DIRECTIVA §13)

Mediana / p95 en ms, n = 7, CPU 4×, red simulada, 15 ms por query. «vs» compara medianas. `00` = main, `04` = pasada 1, `05` = esta pasada (re-medidos juntos).

| Operación | 00 | 04 | 05 | vs 04 | vs 00 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Inicio en frío: FCP | 892 / 1.236 | 1.040 / 1.348 | 720 / 752 | −31 % | −19 % |
| Inicio en frío: app visible | 941,7 / 1.312,9 | 1.233,1 / 1.507 | 790,7 / 834,4 | −36 % | −16 % |
| Inicio en frío: dashboard con datos | 1.645,8 / 2.125,9 | 1.699 / 2.038,3 | 1.402,4 / 1.461,9 | −17 % | −15 % |
| Inicio en frío: interactiva (TTI) | 1.557,7 / 2.123,7 | 1.687,8 / 2.179,3 | 1.344,2 / 1.413,4 | −20 % | −14 % |
| Inicio en frío: TBT | 74 / 212 | 140 / 251 | 187 / 235 | +34 % | +153 % |
| Inicio en caliente: FCP | 316 / 540 | 400 / 556 | 364 / 380 | −9 % | +15 % |
| Inicio en caliente: app visible | 362,4 / 617,7 | 469,9 / 660,1 | 407,9 / 425,9 | −13 % | +13 % |
| Inicio en caliente: dashboard con datos | 1.033,6 / 1.447 | 959 / 1.212,5 | 883,1 / 927,7 | −8 % | −15 % |
| Inicio en caliente: interactiva (TTI) | 1.000,5 / 1.445,5 | 849,1 / 1.200,7 | 740,6 / 823,8 | −13 % | −26 % |
| Inicio en caliente: TBT | 15 / 46 | 25 / 75 | 77 / 113 | +208 % | +413 % |
| Cambio de módulo — Inicio 1ª: a la vista | 452,9 / 707 | 277,1 / 336,2 | 253,4 / 313,1 | −9 % | −44 % |
| Cambio de módulo — Inicio 1ª: contenido | 452,9 / 707 | 277,1 / 336,2 | 253,4 / 313,1 | −9 % | −44 % |
| Cambio de módulo — Inicio 2ª: contenido | 421,9 / 590,1 | 218,5 / 298,6 | 201,7 / 475,6 | −8 % | −52 % |
| Cambio de módulo — Préstamos 1ª: a la vista | 955,9 / 1.346,6 | 483 / 567,6 | 467,3 / 511,2 | −3 % | −51 % |
| Cambio de módulo — Préstamos 1ª: contenido | 955,9 / 1.346,6 | 483 / 567,6 | 467,3 / 511,2 | −3 % | −51 % |
| Cambio de módulo — Préstamos 2ª: contenido | 801,9 / 1.072,8 | 236,9 / 318 | 241 / 267,2 | +2 % | −70 % |
| Cambio de módulo — Dispositivos 1ª: a la vista | 427,9 / 547,7 | 385,6 / 421 | 381,7 / 399,9 | −1 % | −11 % |
| Cambio de módulo — Dispositivos 1ª: contenido | 427,9 / 547,7 | 582 / 599,3 | 566,1 / 583 | −3 % | +32 % |
| Cambio de módulo — Dispositivos 2ª: contenido | 393,4 / 591,1 | 496 / 561,8 | 506,6 / 521,1 | +2 % | +29 % |
| Cambio de módulo — Inventario 1ª: a la vista | 396,3 / 483,8 | 232,1 / 249,7 | 208,9 / 220,6 | −10 % | −47 % |
| Cambio de módulo — Inventario 1ª: contenido | 396,3 / 483,8 | 232,1 / 249,7 | 208,9 / 220,6 | −10 % | −47 % |
| Cambio de módulo — Inventario 2ª: contenido | 140,9 / 222,3 | 173,7 / 176,9 | 168,2 / 203,6 | −3 % | +19 % |
| Cambio de módulo — Agenda 1ª: a la vista | 189,8 / 212,8 | 159,8 / 182,4 | 155 / 160,3 | −3 % | −18 % |
| Cambio de módulo — Agenda 1ª: contenido | 189,8 / 212,8 | 159,8 / 182,4 | 155 / 160,3 | −3 % | −18 % |
| Cambio de módulo — Agenda 2ª: contenido | 114,3 / 152,9 | 123,1 / 131,5 | 116,6 / 127,3 | −5 % | +2 % |
| Cambio de módulo — Tareas 1ª: a la vista | 357 / 696,4 | 436,3 / 518,2 | 437,6 / 489,7 | +0 % | +23 % |
| Cambio de módulo — Tareas 1ª: contenido | 357 / 696,4 | 436,3 / 587,9 | 437,6 / 489,7 | +0 % | +23 % |
| Cambio de módulo — Tareas 2ª: contenido | 201,3 / 371,2 | 318 / 358,2 | 253,3 / 285,2 | −20 % | +26 % |
| Cambio de módulo — Tickets 1ª: a la vista | 1.570,5 / 1.714,3 | 494,3 / 549,6 | 365,2 / 413,3 | −26 % | −77 % |
| Cambio de módulo — Tickets 1ª: contenido | 1.570,5 / 1.714,3 | 494,3 / 549,6 | 365,2 / 413,3 | −26 % | −77 % |
| Cambio de módulo — Tickets 2ª: contenido | 1.098,1 / 1.424,3 | 270,4 / 282,1 | 266,5 / 283,9 | −1 % | −76 % |
| Cambio de módulo — Historial 1ª: a la vista | 275,2 / 555,6 | 348 / 535,2 | 348,4 / 671,5 | +0 % | +27 % |
| Cambio de módulo — Historial 1ª: contenido | 275,2 / 555,6 | 348 / 535,2 | 348,4 / 671,5 | +0 % | +27 % |
| Cambio de módulo — Historial 2ª: contenido | 285 / 322,8 | 250,8 / 278,5 | 266,6 / 271,2 | +6 % | −6 % |
| Cambio de módulo — Analítica 1ª: a la vista | 955,5 / 1.086,8 | 580,7 / 949,6 | 578,1 / 835 | −0 % | −39 % |
| Cambio de módulo — Analítica 1ª: contenido | 1.302,9 / 1.432,5 | 1.862,7 / 2.282,4 | 1.816 / 2.039,6 | −3 % | +39 % |
| Cambio de módulo — Analítica 2ª: contenido | 1.103,8 / 1.347,8 | 1.345,7 / 1.693,9 | 1.476,2 / 1.565,7 | +10 % | +34 % |
| Cambio de módulo — Configuración 1ª: a la vista | 835,5 / 921,2 | 115,7 / 165,6 | 129,4 / 149,6 | +12 % | −85 % |
| Cambio de módulo — Configuración 1ª: contenido | 835,5 / 921,2 | 115,7 / 165,6 | 129,4 / 149,6 | +12 % | −85 % |
| Cambio de módulo — Configuración 2ª: contenido | 690,4 / 789,7 | 104,8 / 129 | 102,6 / 131 | −2 % | −85 % |
| Sugerencias 3 letras: común | 339,2 / 356,4 | 114,4 / 176,1 | 114,2 / 149,7 | −0 % | −66 % |
| Sugerencias 3 letras: parcial | 336,2 / 344,7 | 104,8 / 114,9 | 101 / 160,4 | −4 % | −70 % |
| Sugerencias 3 letras: con tilde | 338,7 / 379,9 | 85,9 / 122,8 | 87,6 / 108,9 | +2 % | −74 % |
| Sugerencias 3 letras: sin tilde | 326,9 / 353,9 | 103 / 131,3 | 107,5 / 123,1 | +4 % | −67 % |
| Sugerencias 3 letras: sin resultados | 337,1 / 341,2 | 0 / 2.577,8 | 0 / 0 | – | −100 % |
| Búsqueda "touch 34" | 83,1 / 113,9 | 130,9 / 134 | 126,6 / 170,4 | −3 % | +52 % |
| Historial: primera página | 609,6 / 657,5 | 626,2 / 674,1 | 593,2 / 808,3 | −5 % | −3 % |
| Historial: cargar más | 220 / 432,2 | 379 / 399,7 | 405,2 / 425,3 | +7 % | +84 % |
| Scroll Dispositivos p95 | 17 / 17,1 | 33,5 / 50,2 | 33,5 / 33,5 | +0 % | +97 % |
| Scroll Historial p95 | 17,1 / 17,3 | 16,9 / 17 | 16,8 / 16,9 | −1 % | −2 % |
| Prestar uno | 468,7 / 656,5 | 567,5 / 674,9 | 402,2 / 632 | −29 % | −14 % |
| Devolver uno | 477,6 / 545,1 | 475,7 / 512,3 | 307,9 / 444,8 | −35 % | −36 % |
| API ráfaga de arranque (ms) | 555,4 / 612,4 | 551,6 / 571 | 314,1 / 344,5 | −43 % | −43 % |
| API ráfaga de arranque (queries) | 22 / 22 | 23 / 23 | 11 / 15 | −52 % | −50 % |
| API prestar (POST + ver en /devices) | 369,5 / 407,8 | 308,8 / 351,2 | 92,1 / 107 | −70 % | −75 % |
| API prestar: queries | 13 / 15 | 13 / 13 | 3 / 3 | −77 % | −77 % |
| API devolver: queries | 14 / 14 | 14 / 14 | 4 / 4 | −71 % | −71 % |
| API /api/tasks?space=all (ms) | 113,7 / 127,3 | 90 / 104,7 | 19,5 / 21,7 | −78 % | −83 % |
| API /api/tasks?space=all (queries) | 4 / 4 | 4 / 4 | 0 / 0 | −100 % | −100 % |
| API /api/tools/config (ms) | 156,9 / 202,9 | 151,3 / 170,6 | 43,3 / 47,6 | −71 % | −72 % |
| API /api/tools/config (queries) | 8 / 8 | 8 / 8 | 1 / 1 | −88 % | −88 % |
| API /api/recess-schedules (ms) | 46,2 / 47,7 | 50,7 / 64,4 | 32,4 / 47,3 | −36 % | −30 % |
| API /api/recess-schedules (queries) | 1 / 1 | 2 / 2 | 1 / 1 | −50 % | +0 % |
| API /api/devices (ms) | 21 / 22,1 | 18,7 / 23,7 | 23,5 / 26,3 | +26 % | +12 % |
| API /api/devices (queries) | 0 / 0 | 0 / 0 | 0 / 0 | – | – |

Notas de la tabla: «sin resultados» no hace pedido (0 ms = nada que mostrar); el p95 de 2.577,8 en `04` es una corrida aislada. «Dashboard con datos» y «a la vista» del arranque coinciden (los pedidos del arranque terminan juntos), por eso no se repite. `/api/devices` desde Node (0 consultas, caché caliente) se mueve entre 19 y 24 ms entre corridas: es serializar 318 KB, sin cambios de código en ese camino salvo el parche de #7.

**Reposo** (`perf/idle.mjs`, app quieta 60 s por pantalla, CPU 4×, 15 ms por query; mediana de 6 muestras en `04` y `05` —dos corridas de 3, la segunda con el mismo `.env` para los dos— y de 3 en `00`):

| Métrica | 00 | 04 | 05 | vs 04 | vs 00 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Server quieto: consultas/min (ticks de fondo) | 12 | 2 | 2 | 0 % | −83 % |
| Arranque del server (mismo `.env`): consultas | – | 266 | 266 | 0 % | – |
| Arranque del server (mismo `.env`): ms hasta listo (2 corridas sin la primera en frío) | – | 5.119 / 5.258 | 5.294 / 5.254 | +2 % | – |
| Inicio quieto: consultas del server/min | 41 | 31 | **27** | −13 % | −34 % |
| Préstamos quieto: consultas del server/min | 35 | 25 | **23** | −8 % | −34 % |
| Dispositivos quieto: consultas del server/min | 41 | 29,5 | **24** | −19 % | −41 % |
| Inicio quieto: pedidos/min | 14 | 14 | 14 | 0 % | 0 % |
| Préstamos / Dispositivos quietos: pedidos/min | 10 / 14 | 10 / 12 | 10 / 10 | 0 % / −17 % | 0 % / −29 % |
| Inicio quieto: commits de React/min | 2 | 11 | 11 | 0 % | +450 % |
| Préstamos / Dispositivos quietos: commits/min | 2 / 2 | 0 / 0 | 0 / 0 | 0 % | −100 % |
| Inicio quieto: ms de script/min | 20,7 | 46,3 | 52,4 | +13 % | +153 % |
| Préstamos quieto: ms de script/min | 17,1 | 15 | 18 | +20 % | +5 % |
| Dispositivos quieto: ms de script/min | 23 | 21,4 | 18,6 | −13 % | −19 % |

Los ms de script por minuto en reposo son chicos en absoluto (+6 y +3 ms por minuto) y variaron 45–64 ms/min entre muestras de `05` con el mismo código; las consultas del server con la app abierta bajan en las tres pantallas (el poll de tareas ya no consulta la base). La primera corrida de `04` sin `.env` daba 222 consultas al arrancar contra 266 de `05`: la diferencia era el `.env` (siembra de sedes), no el código; con el mismo `.env` son iguales.

**No se pudo medir / límites:** producción (Supabase, HTTP/2, celulares reales): las cifras de viajes ahorrados son cálculo; el banco usa HTTP/1.1 y Chrome headless de escritorio. Durante la suite de cierre había ~2 núcleos de carga de fondo ajena (Chrome del dueño y otros procesos): los p95 de `00-inicial-r2` son altos por eso. Varias pantallas tienen medianas bimodales (frames de ~100 ms) y la mediana se mueve ±10 % entre corridas sin cambios de código (por eso cada cambio se decidió con A/B intercalado y no con la tabla).

## Oportunidades para la pasada 3

- **Inicio en caliente** sigue +13 % sobre main (408 vs 362 ms app visible): primer render del shell (Sidebar con ~25 ítems e íconos) y layout con Geist.
- **Historial «cargar más»** (405 vs 220 en main): layout y pintado de 50 filas con celdas anidadas; probar `content-visibility` por grupo de día con tamaño intrínseco, o filas más planas.
- **Dispositivos «contenido»** (566 vs 428): el llenado en idle de las 386 filas y el pedido de contadores a los 300 ms; «a la vista» ya está en 382 (main 428).
- **«touch 34»** (127 vs 83 en main) y **scroll de Dispositivos** p95 33,5 ms (main 17): HitTest residual de la pasada 1.
- **Tareas 1ª** (438 vs 357): lo que queda es `/api/site-assistants` al montar y el render del tablero con 258 tareas.
- **Analítica «contenido»** (1.816 vs 1.303): montaje en idle de las secciones de abajo; la primera sección ya está en 578 (main 956).
- **Producción:** medir con `pg_stat_statements` después del deploy la baja de `app_settings` (mail), `tasks`/`task_items`/`task_comments` por poll y las lecturas de `local_devices`/`local_states` por préstamo.
