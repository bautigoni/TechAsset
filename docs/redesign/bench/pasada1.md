# Pasada 1 de rendimiento — diagnóstico y optimización general

Rama de trabajo sobre `rediseno-grafito` desde `54ac7af`. Protocolo: `docs/redesign/RENDIMIENTO.md`; directiva: `DIRECTIVA-FINAL.md` §5, §6 y §13.

## Condiciones de medición

- **Base:** `docs/redesign/bench/snapshot.db`, generada con `node perf/seed-snapshot.mjs` (versionado; la base no). Copia de `data/techasset.db` + siembra determinista: 386 equipos en NFPT (+ NFND), 5.145 eventos de préstamo en NFPT (5.779 en total) a lo largo de un año, 410 personas distintas con nombres repetidos, con y sin tilde y la misma persona escrita de dos formas, 43 equipos prestados ahora, 5.881 movimientos, 258 tareas, 250 tickets, 327 actividades de agenda, 150 notificaciones.
- **Suite:** `node perf/suite.mjs --repo=<checkout> --label=<etiqueta> --db=docs/redesign/bench/snapshot.db` — 7 corridas, CPU 4×, red 40 ms / 10 / 5 Mbps, 15 ms sincrónicos por query (como Supabase), Chrome 155 headless 1366×800. Mediana / p95 (con n = 7, p95 = máximo).
- **Reposo:** `node perf/idle.mjs` (nuevo): arranque del server (ms y queries), consultas por minuto del server solo, y con la app quieta 60 s en Inicio, Préstamos y Dispositivos: pedidos/min, commits de React/min (hook de DevTools, sirve en producción), ms de script/min (CDP), consultas del server/min. 3 corridas.
- **Trazas:** `node perf/trace.mjs` (nuevo): tiempo propio por evento del hilo principal y funciones con más muestras para una interacción (`--action=scroll|load|mutations`, `--hover`).
- **Postgres:** `node perf/pg-startup.mjs` (nuevo): viajes a la base y tiempo hasta "listo" al arrancar contra un Postgres 17 local con `pg_stat_statements`, alternando checkouts.
- **Checkouts:** `00-inicial` = `main` (83f97e4) y `03-pre-pasada1` = `54ac7af` en worktrees temporales (junction de `node_modules`; para `main` un stub del paquete `openai`, que ya no está instalado y solo lo usa el asistente apagado). A/B de cada cambio contra un worktree del commit anterior.
- **Máquina:** Ryzen 5 5560U, Node 24.19. Durante TODAS las mediciones el dev server del dueño (`vite`, PID 16472) estuvo consumiendo ~1,9 núcleos de forma constante (19 s de CPU cada 10 s; probablemente vigilando los ~25 worktrees de `.claude/worktrees`). No es "liviano": afecta por igual a todas las etiquetas, pero agrega ruido. No se tocó.
- **Ajustes a la suite (para medir el rediseño):** el campo Persona aparece al elegir un equipo; los botones llevan el atajo (`Prestar↵`); grupos de chips (`role=group`); esqueletos debajo del pliegue no cuentan como "cargando" (Analítica monta secciones al scrollear); una lista plegada que React reusa vuelve a valer; las inserciones de `<link>` en `<head>` (precarga de chunks y CSS de pantallas) no cuentan como "pantalla que cambia"; el scroll emite un `wheel` por paso como la rueda. `00` y `03` se volvieron a medir con la suite final, así que las tres columnas de la tabla son comparables.

## Diagnóstico (mediciones de `03` contra `00`, y producción)

Los números de esta sección son de la primera medición de diagnóstico (antes de ajustar la suite para `<head>` y `wheel`); los de la tabla final son la re-medición con la suite definitiva y pueden diferir unos ms.

Señales previas:

| Señal | Resultado |
| --- | --- |
| Inicio en frío más lento en etapas 1/2 que en `main` | **Confirmado.** FCP 1.228 vs 912 ms, app visible 1.342 vs 970 ms, TTI 1.950 vs 1.534 ms. Trazas: más JS evaluado al arrancar (`v8.evaluateModule` 162 vs 38 ms: precarga de 25 chunks con su CSS), el Inicio en su propio chunk, y pedidos de más: `/api/devices` dos veces (~310 KB c/u, uno forzado con `refresh=1` que además salta la caché del server) y `/api/agenda` repetida según el timing. El "dashboard con datos" de 3,7 s era en buena parte la precarga insertando `<link>` en `<head>` (la suite lo contaba como pantalla que cambia). |
| Scroll de Dispositivos p95 201 ms | **Confirmado** (104 ms p95 / 71 ms p50 con 387 filas; `main` 18 ms). Traza: 8,7 s de `Layerize` en el hilo principal: `.shell-scroll` (transparente) no se componía en pantallas de densidad 1 y cada frame repintaba y re-layerizaba toda la lista; con el puntero encima, además, el `:hover` saltaba de fila en fila (Layerize 12 s, Paint 3 s, HitTest 1,8 s). |
| Analítica más lenta al abrir (295 vs 230 ms) | **Confirmado en "contenido"** (1.776 vs 1.225 ms) pero por diseño: la pantalla dibuja la primera sección y monta las otras cuatro de a una en ratos libres; la suite espera hasta que el DOM se aquieta. La 1ª respuesta es similar (127 vs 85 ms). Queda para la pasada 2 (medir "primera sección visible"). |
| Producción: ticks del server (~880k viajes) | **Confirmado** en el banco: 12 consultas/min con el server solo (outbox + recordatorios cada 10 s). |
| Producción: emulación de esquema (~150 × 22 ms) | **Confirmado** contra Postgres 17: 123 consultas a `information_schema` por arranque, 2,2 s hasta "listo" en local. |
| Producción: búsqueda de personas y `DISTINCT curso` | **Confirmado.** `/loans/suggest` leía 2.600 filas por tecla; sugerencia visible a 360 ms de la 3ª letra (220 ms de debounce + pedido + render). `/loans/previous-day` leía todos los préstamos y creaba un `Intl.DateTimeFormat` por fila: **650 ms** con 5.000 eventos (el pedido más caro de la app; frenaba Préstamos). `/photo-passes/options` (con el `DISTINCT curso`): 7 consultas, 174 ms, al abrir Préstamos. |
| Producción: logos faltantes → ENOENT | **Confirmado y peor:** respondía **500** (con la ruta del disco en el JSON) y el stack en el log en cada carga. |

Los 5 ejes en `03`:

1. **Renders:** Inicio quieto 14 commits/min y 286 ms de script/min (main: 2 y 19): un `setState` cada 5 s para "Actualizado hace N s" re-renderizaba todo el Inicio. Notificaciones: `setState` en cada poll de 30 s aunque viniera lo mismo.
2. **Bundle:** JS inicial 93,7 KB gzip (main 94,4), CSS inicial 15 KB (main 56,8), fuente precargada 28,7 KB; total crítico 139 KB (main 152). Dentro del presupuesto (PLAN §7). El costo está en lo que se precarga después (todos los chunks de pantallas + su CSS en idle), no en lo crítico.
3. **Requests:** 16 pedidos al arrancar en frío (main 15): `/api/devices` duplicado y agenda repetida; Préstamos pedía `photo-passes/options` aunque el panel estuviera plegado. Polling con la app quieta: 14 pedidos/min en el Inicio (igual que main; ETag/304 ya estaba).
4. **Queries:** ver producción arriba; además 41 consultas/min del server con el Inicio abierto (12 de ticks). Notificaciones: `lower(user_email) … ORDER BY created_at` sin índice (SCAN + B-tree temporal).
5. **Imágenes, fuentes, scripts:** Geist precargada con `font-display: swap` (bien); el logo de sede ya cae al por defecto en el front; el problema era el 500 del server.

## Cambios (cada uno con su medición antes/después)

| # | Cambio | Medición | Antes | Después | Estado |
| --- | --- | --- | --- | --- | --- |
| 1 | `pg-sync`: esquema en caché (1 consulta para todas las tablas; DDL marca tablas sucias) | `perf/pg-startup.mjs`, PG 17 local, 5 corridas alternadas | listo 2.246 ms · 368 sentencias · 123 a information_schema | 1.255 ms · 248 · 1 | **queda** (commit 117b613) |
| 2 | Recordatorios por evento (escritura + hora exacta + barrido 5 min); outbox cada 30 s | `perf/idle.mjs`, server solo | 12 consultas/min | 2 consultas/min | **queda** (074aeab) |
| 3 | `/uploads`: 404 limpio (cacheable 10 min) para archivos que faltan | pedido al logo faltante | 500 + ENOENT con stack en el log | 404, log limpio | **queda** (074aeab) |
| 4 | Directorio de personas en memoria (server) + filtrado local sin debounce (front) | suite, 3ª tecla → sugerencia visible, 5 corridas | 356–387 ms | 85–126 ms; sin resultados: sin pedido | **queda** (5837d6e) |
| 4b | `/loans/suggest` desde el directorio | API desde Node | 42 ms · 1 query | 17 ms · 0 | **queda** |
| 5 | `/loans/previous-day`: consulta indexada del día + caché por versión de `loan_events` | API desde Node (respuesta idéntica comparada sobre el snapshot) | 650 ms · 1 query (2.600 filas) | 17 ms · 0 (2 en frío) | **queda** (5837d6e) |
| 6 | Índice `notifications(lower(user_email), created_at)` | EXPLAIN + ms en SQLite | SCAN + B-tree temp · 0,20 ms | SEARCH por índice · 0,11 ms | **queda** (5837d6e) |
| 7 | Arranque: un solo `/api/devices`; agenda/tareas no se repiten si tienen < 5 s | suite `--only=startup`, A/B 2×4 corridas | 16 pedidos · 921 KB JSON · datos frío 1.843 · TTI caliente 1.080 | 14 · 553 KB · 1.774 · 932 | **queda** (95fb5ab) |
| 8 | Reloj "Actualizado hace" en su propio componente; notificaciones sin `setState` si no cambió | `perf/idle.mjs`, 60 s × 3 | Inicio 14 commits/min · 286 ms script/min; Préstamos/Dispositivos 2 commits/min | 11 · 44; 0 | **queda** (8355a5d) |
| 9 | `.shell-scroll` opaco (mismo fondo que `.shell`) | `perf/trace.mjs` Dispositivos 387 filas, sin puntero | p50 35 ms · Layerize 8,7 s | p50 17,5 ms · Layerize ≈ 0 | **queda** (50a9023) |
| 10 | Sin puntero en el contenido mientras scrollea por rueda (150 ms) | traza con puntero encima | p50 67 · p95 82 ms | p50 17 · p95 34 ms | **queda** (50a9023) |
| 11 | Filas de Dispositivos sin `position: relative` (solo la marcada) | traza con puntero, con #10 | p95 39 ms | p95 33 ms | **queda** (50a9023) |
| 12 | Opciones de cartelitos: 6 SELECT → 1 UNION ALL; se piden al abrir el panel | endpoint con latencia 15 ms; suite pantallas A/B 2×4 | 174 ms · 7 q; Préstamos 1ª 593 · 2ª 423 ms | 81 ms · 2 q; 464 · 230 ms | **queda** (c505626) |
| R1 | `useFitPlaceholder` sin medir en el layout effect | traza de carga del Inicio | 361 muestras en `pick` (layout forzado) | el layout forzado pasa a otro lector (`TruncatedText`); total igual | **revertido**: el costo es el layout del Inicio, no quién lo dispara |
| R2 | Precarga de pantallas recién después de `load` + 1,2 s | suite `--only=startup,views`, A/B 2×4 | datos frío 1.732 · TTI caliente 916 | 1.744 · 991 | **revertido** (sin mejora, TTI caliente +8 %) |
| R3 | `content-visibility: auto` en filas de Dispositivos | traza con puntero (antes de #10) | p50 68 · p95 84 ms | p50 61 · p95 74 ms, pero +3,6 s PrePaint y +2,1 s IntersectionObserver | **revertido** (#10 resolvió la causa) |
| R4 | Filas sin `position: relative` SIN #10 | traza con puntero | p50 68 ms | p50 181 ms (Paint 34 s) | **revertido** (cada fila aislaba su repintado); con #10 sí mejora (#11) |
| R5 | Volver a posicionar las filas (deshacer #11) para recuperar el ~5 % al abrir Dispositivos | suite pantallas + scroll, A/B 2×4 | abrir 1ª 614 · 2ª 545 ms; scroll p95 36 ms | 584 · 534 ms; scroll p95 52 ms | **descartado**: el scroll empeora 45 %; se mantiene #11 |

Verificación de equivalencia: `/loans/previous-day`, `/loans/suggest` (6 términos, incluido vacío y sin resultados) y `/photo-passes/options` dan respuestas idénticas byte a byte entre la versión anterior y la nueva sobre el snapshot.

## Búsqueda rápida de personas (DIRECTIVA §6)

- **De punta a punta:** el server arma el directorio de la sede una vez (1 consulta, ~2.600 filas) y lo guarda en memoria con la versión de `loan_events` (sube en `addLoanEvent` y en el Deshacer) y un TTL de 10 min por escrituras externas. `GET /api/loans/people` lo entrega entero (349 personas ≈ 58 KB, ~10 KB gzip; ETag → 304). El front lo baja al abrir el formulario (o la barra del Inicio en modo préstamo) y filtra en memoria en el render de cada tecla: sin debounce, sin red, sin respuestas viejas posibles. Si el directorio no llegó, cae al pedido de siempre (`/loans/suggest`, ahora 0 queries) con debounce y descarte de respuestas viejas.
- **Coincidencia:** sin mayúsculas ni tildes; cada palabra tipeada tiene que estar en el nombre (nombres, apellidos y combinaciones: `gonz mar` → María González); primero quien empieza con lo tipeado, después quien tiene una palabra que empieza así, después el resto; dentro de cada grupo por cantidad de préstamos y fecha. Misma regla en server y front.
- **Permisos y sede:** el directorio es por sede (`requireSite`), detrás de `authMiddleware` como el resto de `/loans`.
- **Por qué caché en memoria y no índice:** el costo no era la consulta (4 ms en SQLite) sino el viaje sincrónico por tecla y traer 2.600 filas por la red de Supabase. Un índice no evita ninguno de los dos; el directorio en memoria sí, y se invalida exacto porque la app es la única que escribe `loan_events` (TTL de respaldo).
- **Tiempo:** 3ª tecla → sugerencia visible ≈ 100 ms con CPU 4× (≈ 25 ms en CPU normal). Objetivo < 200 ms: **cumplido**. Lo que queda es el render de `LoanForm` entero en cada tecla (oportunidad pasada 2).

## Regresiones vigiladas (regla del 5 %)

- **Dispositivos al abrir:** A/B intercalado `03` vs `04` (2×4 corridas): 1ª vez 589 → 609 ms (+3 %), 2ª 516 → 551 ms (+7 %). Se aisló con otro A/B (filas posicionadas vs no, 2×4): las filas sin `position: relative` (#11) abren ~5 % más lento (584 → 614 / 534 → 545 ms) pero scrollean mucho mejor (p95 52 → 36 ms, −31 %). Se mantiene #11 por el balance; queda anotado para la pasada 2 (abrir Dispositivos ya estaba +55 % sobre `main` por los dos pedidos extra y el render inicial).
- **Inicio en caliente, app visible:** 502 → 511 ms (+2 %, dentro del ruido; en el A/B de #7 fue 494 → 494).
- Ninguna otra métrica empeoró más de 5 % entre `03` y `04`.

## Cierre

- `npm run e2e` (completo, con la sonda UX bloqueante): **271/271 funcionales OK, línea base 23/23 limpias**, exit 0 (1.197 s).
- `npm run check:ui`: nada nuevo (4 ocurrencias heredadas).
- `pg-smoke` contra Postgres 17 en un contenedor nuevo (puerto 55445): **123/123 OK**, con chequeos nuevos del directorio de personas (y su invalidación tras el Deshacer), sugerencias por palabras, día anterior, opciones de cartelitos (UNION ALL) y recordatorio vencido que avisa al guardarlo.
- Suite completa: `00-inicial.md`, `03-pre-pasada1.md` y `04-pasada1.md` (misma suite y snapshot); reposo: `idle-00-inicial.json`, `idle-03-pre-pasada1.json`, `idle-04-pasada1.json` (`idle-04-a-cambios.json` es la medición intermedia del A/B de #2 y #8).

## Tabla resumen (DIRECTIVA §13)

Mediana / p95 en ms, n = 7 (suite) o n = 3 (reposo), CPU 4×, red simulada, 15 ms por query. "vs" compara medianas.

| Operación | 00-inicial (main) | 03-pre-pasada1 | 04-pasada1 | vs 00 | vs 03 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Inicio en frío: app visible | 949,3 / 979,2 | 1.301,6 / 1.336,7 | 1.288,2 / 1.312,8 | +36 % | −1 % |
| Inicio en frío: interactiva (TTI) | 1.533,5 / 1.681 | 1.760,9 / 1.937,2 | 1.712,8 / 1.936,6 | +12 % | −3 % |
| Inicio en caliente: app visible | 347,4 / 389 | 502,2 / 531,8 | 511 / 543,7 | +47 % | +2 % |
| Inicio en caliente: TTI | 1.074,1 / 1.124,2 | 1.063,4 / 1.147,5 | 907,8 / 972,4 | −15 % | −15 % |
| Arranque del server en Postgres (listo, local) | no medido | 2.246 | 1.255 | – | −44 % |
| Carga del dashboard con datos (frío) | 1.677,8 / 1.706,2 | 1.768,1 / 2.045,2 | 1.740,2 / 1.817,4 | +4 % | −2 % |
| Carga del dashboard con datos (caliente) | 1.076,5 / 1.126,1 | 1.072,8 / 1.148,3 | 1.017,2 / 1.127,9 | −6 % | −5 % |
| Cambio de módulo: 1ª respuesta (promedio de 10 pantallas) | 209,8 | 170,8 | 175,5 | −16 % | +3 % |
| Cambio de módulo: 1ª vez con contenido (promedio) | 672,6 | 598 | 527,8 | −22 % | −12 % |
| Cambio de módulo: 2ª vez con contenido (promedio) | 539,7 | 466,3 | 391,5 | −27 % | −16 % |
| Búsqueda rápida de equipos ("touch 34") | 102,7 / 126 | 144,8 / 191,6 | 133,4 / 153,3 | +30 % | −8 % |
| Sugerencias con 3 letras: común (`mic`) | 347,1 / 348,6 | 376,8 / 393,8 | 106,7 / 121,1 | −69 % | −72 % |
| Sugerencias con 3 letras: parcial (`cae`) | 341 / 350,3 | 370,4 / 377,4 | 104,7 / 112,5 | −69 % | −72 % |
| Sugerencias con 3 letras: con tilde (`rám`) | 352 / 371,8 | 360,4 / 388,1 | 110,7 / 126,7 | −69 % | −69 % |
| Sugerencias con 3 letras: sin tilde (`ram`) | 344,7 / 364,9 | 362,8 / 385,3 | 105,7 / 126,6 | −69 % | −71 % |
| Sugerencias con 3 letras: sin resultados (`zqx`) | 330,8 / 343,8 | 328 / 353,8 | 0 (sin pedido; no hay nada que mostrar) | – | – |
| Historial: primera página | 611,2 / 628,9 | 662,6 / 682 | 657,7 / 678,7 | +8 % | −1 % |
| Historial: cargar más | 251,8 / 295,2 | 402,6 / 417 | 400,7 / 496,5 | +59 % | 0 % |
| Consulta API: ráfaga de arranque (Node, 6 en paralelo) | 531,7 / 557,3 | 550,6 / 583,5 | 551,6 / 615,4 | +4 % | 0 % |
| Consulta API: `/loans/previous-day` | 613,9 · 1 q | 602,7 · 1 q | 16,9 · 0 q | −97 % | −97 % |
| Consulta API: `/loans/suggest?q=mic` | 52,5 · 1 q | 45,5 · 1 q | 16,8 · 0 q | −68 % | −63 % |
| Consulta API: `/photo-passes/options` | 159 · 7 q | 174,2 · 7 q | 80,6 · 2 q (aparte) | −49 % | −54 % |
| Renderizado de listas: scroll Dispositivos (387 filas), p95 por frame | 18,2 / 18,3 | 106,5 / 106,9 | 35,8 / 35,9 | +97 % | −66 % |
| Renderizado de listas: scroll Historial (4 páginas), p95 por frame | 18,3 / 18,3 | 18,2 / 18,6 | 18,2 / 18,3 | −1 % | 0 % |
| Prestar uno (click → pantalla quieta) | 516,3 / 536,8 | 618,9 / 722,6 | 624,3 / 704,3 | +21 % | +1 % |
| Devolver uno (click → pantalla quieta) | 537,1 / 586,5 | 545,6 / 589,2 | 506,8 / 552,3 | −6 % | −7 % |
| Server quieto: consultas/min (ticks de fondo) | 12 | 12 | 2 | −83 % | −83 % |
| Server: consultas/min con el Inicio abierto | 41 | 41 | 31 | −24 % | −24 % |
| Inicio quieto: ms de script/min | 19,1 | 286,1 | 48,9 | +156 % | −83 % |
| Inicio quieto: commits de React/min | 2 | 14 | 11 | +450 % | −21 % |
| Préstamos quieto: commits de React/min | 2 | 2 | 0 | −100 % | −100 % |

`/photo-passes/options` en `04` ya no se pide al abrir Préstamos (la suite no lo observa); su número sale de `perf` aparte con el mismo preload de 15 ms/query (7 pedidos, mediana). El arranque en Postgres sale de `perf/pg-startup.mjs` (5 corridas alternadas contra PG 17 local); en producción cada viaje cuesta ~22 ms (media de `pg_stat_statements`), así que los 122 viajes menos a `information_schema` deberían ahorrar del orden de 2,7 s por reinicio (**cálculo, no medición**).

Pantallas, 1ª vez con contenido (mediana / p95):

| Pantalla | 00 | 03 | 04 |
| --- | ---: | ---: | ---: |
| Inicio | 381 / 576,7 | 269,6 / 322,7 | 301,8 / 337,7 |
| Préstamos | 977,2 / 1.048,5 | 1.196,2 / 1.213,8 | 483,4 / 546 |
| Dispositivos | 393 / 459,4 | 611,6 / 652,7 | 626,2 / 653,9 |
| Inventario | 354,4 / 642,2 | 227,3 / 266,5 | 230,3 / 245,8 |
| Agenda | 190,3 / 218,5 | 165,1 / 174,3 | 160,7 / 170,7 |
| Tareas | 416,7 / 435 | 500,2 / 534,3 | 506,6 / 539,3 |
| Tickets | 1.575,5 / 1.611,3 | 561,5 / 570,2 | 553,5 / 560,7 |
| Historial | 311,9 / 336,9 | 366,2 / 390,8 | 391,4 / 402,7 |
| Analítica | 1.255,3 / 1.312,7 | 1.945,8 / 2.000,6 | 1.892,7 / 2.073,4 |
| Configuración | 871,1 / 937,9 | 136,1 / 161,7 | 130,9 / 156,4 |

Pantallas, 2ª vez con contenido (mediana / p95):

| Pantalla | 00 | 03 | 04 |
| --- | ---: | ---: | ---: |
| Inicio | 325,2 / 381,8 | 320,5 / 373,6 | 282,9 / 358,3 |
| Préstamos | 879 / 891,7 | 935,9 / 1.056,7 | 261,2 / 294,4 |
| Dispositivos | 294,2 / 477,3 | 516,2 / 550,4 | 543,4 / 624,6 |
| Inventario | 143,1 / 185,7 | 181,8 / 189,7 | 183 / 230,4 |
| Agenda | 115 / 123 | 129,6 / 134,7 | 142,6 / 150,3 |
| Tareas | 292,5 / 317,8 | 377,6 / 411,6 | 359 / 408 |
| Tickets | 1.154,9 / 1.198 | 269 / 320 | 272,9 / 298,9 |
| Historial | 315,8 / 435,9 | 304,9 / 339,2 | 275,8 / 287,5 |
| Analítica | 1.123,2 / 1.214 | 1.519,6 / 1.678,8 | 1.486,4 / 1.680,5 |
| Configuración | 754,1 / 843,4 | 108 / 123,2 | 107,9 / 123,7 |

Tamaños (gzip): JS inicial 94,4 / 93,7 / 94 KB; CSS inicial 56,8 / 15 / 15 KB; fuente precargada 0 / 28,7 / 28,7 KB; total crítico 152,1 / 139 / 139,3 KB (presupuesto PLAN §7: 185).

**No se pudo medir / límites:** el arranque del server con latencia real de Supabase (solo local + cálculo); la suite corre en Chrome headless de escritorio, no en un celular real; Analítica "con contenido" incluye el montaje en idle de secciones debajo del pliegue; el dev server del dueño consumió ~2 núcleos durante todas las corridas.

## Oportunidades para la pasada 2

- **Render de `LoanForm` por tecla** (~100 ms con CPU 4× entre la tecla y la sugerencia): aislar el estado del campo Persona para no re-renderizar todo el formulario.
- **Analítica:** la primera sección aparece rápido pero las otras cuatro se montan en idle hasta ~1,8 s; medir "primera sección visible" y revisar el costo de montaje de cada sección (charts) con CPU 4×.
- **Dispositivos 1ª vez** (626 ms vs 393 en main): pide `device-groups` y `devices/deleted` al abrir (la papelera solo se necesita al abrirla) y el render inicial de la tabla (+5 % por las filas sin posicionar, ver R5).
- **`/api/tasks?space=all` al arrancar:** 159 KB con las 213 tareas hechas; el Inicio solo usa las abiertas. Paginar/omitir hechas viejas como hace `/api/agenda`.
- **Historial "cargar más"** (401 ms vs 252 en main), Tareas 1ª vez (507 vs 417), "touch 34" (133 vs 103) y Prestar uno (624 vs 516): perfilar el render de las filas nuevas y del formulario.
- **Inicio en caliente, app visible** (511 vs 347 en main) y **en frío** (1.288 vs 949): la mayor brecha que queda contra `main`.
- **Inicio en frío:** el shell aparece recién con la sesión (sin caché local en un navegador nuevo) y el Inicio vive en un chunk aparte; probar el shell vacío antes de la sesión y el Inicio en el chunk de entrada (PLAN §7 deja margen: total crítico ~139 KB de 185).
- **Precarga de pantallas:** precargar solo JS (`modulepreload`) y aplicar el CSS de cada pantalla al abrirla, en vez de insertar 25 hojas de estilo durante el arranque.
- **Outbox de notificaciones:** con Postgres, `LISTEN/NOTIFY` desde `enqueue_techasset_notification` dejaría el tick de 30 s en cero consultas.
- **HitTest residual en el scroll** (~2,6 s en la traza de 387 filas con puntero): menos elementos posicionados por fila (checkbox propio).
- **Producción:** volver a mirar `pg_stat_statements` después del deploy para confirmar la baja de `information_schema`, `notification_outbox`/`reminders` y de `loan_events` por sugerencias.
