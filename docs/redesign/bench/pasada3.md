# Pasada 3 de rendimiento — validación final y experiencia percibida

Rama de trabajo sobre `rediseno-grafito` desde `0c342f6` (pasada 2 integrada). Protocolo: `docs/redesign/RENDIMIENTO.md`; directiva: `DIRECTIVA-FINAL.md` §5, §6 y §13. Todo lo que sigue son mediciones reales; lo que no se pudo medir limpio está dicho.

## Condiciones de medición (leer antes que los números)

- **Base:** `docs/redesign/bench/snapshot.db` regenerada con `node perf/seed-snapshot.mjs` (mismos conteos que en las pasadas 1 y 2: 386 equipos NFPT, 5.145 eventos de préstamo, 410 personas, 43 prestados, 5.881 movimientos, 258 tareas, 250 tickets, 327 agenda, 150 notificaciones).
- **Checkouts:** `00` = `main` (83f97e4, con el stub local del paquete `openai`); `05` = `0c342f6`; `06` = esta rama. Copias con `git archive` + junction de `node_modules` (`perf/.out/mkco.ps1`), una por cada paso (`c06veil`, `c06start`, `c06views`).
- **Carga de fondo: la máquina NO estuvo quieta.** Al empezar (20/10 11:11) estaba en reposo (nada por encima de 0,2 s de CPU en 10 s; el dev server del dueño en 5173/8000 sin consumo). Desde las ~11:40 corrieron en paralelo 10 agentes revisores de UX y un agente de estética (Chrome + e2e cada uno): antes de cada tanda de medición la carga fue de **8,4 a 12 núcleos ocupados de 12** (`perf/ab.mjs` la mide 3 s antes de cada tanda y la imprime). La sesión se cortó dos veces (20/10 ~11:50 y 12:25) y se retomó el 22/10 con la misma situación (7,5/12 al retomar).
- **Consecuencia:** el tiempo de pared (lo que mide `perf/suite.mjs`) no sirvió para decidir: en el A/B del arranque el DOMContentLoaded en frío —que ningún cambio toca— se movió +50 % entre lados. Por eso cada cambio se decidió con **mediciones que no dependen de la carga**, alternando A y B:
  - **`perf/cpu-ab.mjs` (nuevo):** traza de Chrome por corrida (CPU 4×, misma red que la suite) y cuenta **layouts y recálculos de estilo forzados** (los que pasan dentro de JS: alguien leyó una medida con el layout sucio), el tiempo de CPU del hilo principal (`tdur`, reloj del hilo) por tipo de trabajo, la tarea más larga y los pedidos `/api` que salen al abrir una vista. Los conteos son deterministas; el tiempo de CPU también se infla con la carga (la misma versión dio 367–859 ms de CPU en una misma tanda), así que solo se usó cuando la diferencia es mucho mayor que esa dispersión.
  - `perf/ab.mjs` (el A/B de la pasada 2, ahora versionado y con la carga de fondo por tanda) para el tiempo de pared, como referencia.
  - Microbenchmarks en la página (`perf/.out/probe-*.mjs`, no versionados) para aislar costos puntuales.
- **Suite final `06-pasada3` y re-medición de `00`:** ver el final; se corrieron con la carga que había y se presentan como tales.

## Diagnóstico de lo que seguía peor que `main`

| Señal (pasada 2) | Medición en esta pasada | Causa encontrada |
| --- | --- | --- |
| Inicio en caliente, app visible +13 % | Sonda en la página (`probe-warm`, 2×2 cargas, máquina todavía tranquila): raíz pintada a ~200–246 ms en `05` vs ~170 en `main`; FCP 296–360 vs 232–264. Traza en caliente (build sin minificar): | (1) **Evaluar la entrada cuesta 34–41 ms vs 10 en `main`**: 44 de 96 muestras son `prefetchView('dashboard')` insertando 22 `<link rel=modulepreload>` (el Inicio y sus 21 chunks). Microbenchmark: insertar 66 links de chunks que el documento todavía no pidió cuesta 82–86 ms con CPU 4× (1,3 ms c/u: es arrancar el pedido, aunque venga de la caché HTTP); los mismos links ya pedidos, 2,4 ms. Es el costo de partir el Inicio en chunks (en `main` vivía en la entrada). (2) El `ResizeObserver` del menú probaba densidades escribiendo un atributo y leyendo `scrollHeight` (estilo + layout forzado por prueba, con `:has()` en `.shell`): **14 ms antes del primer pintado**. (3) El primer render pedía el chunk `ShellPanels` (por `ShellStatus`): ~9 ms de inserción de precargas dentro del render. (4) El primer layout con Geist (~35 ms en caliente) y `v8.produceModuleCache` (13–33 ms, V8 generando la caché de código en la 2ª carga) son comunes a las dos versiones. |
| TBT +34 % (frío) / +208 % (caliente) | Traza en caliente | El TBT se mide entre FCP y TTI. Pasada 2 adelantó el FCP (estructura un frame antes), así que el render del Inicio con datos (110 y 117 ms de tareas) cayó dentro de la ventana; además, **dentro del commit del Inicio había un layout forzado de 49 ms**: `useFitPlaceholder` leía `document.fonts.ready` en un layout effect, y ese getter fuerza estilo + layout en el acto (91 muestras en `get ready`). No es trabajo nuevo: es trabajo que pasó a contarse y un layout forzado que partía mal las tareas. |
| Historial «cargar más» 405 vs 220 | Traza (`--action=more`): tras la respuesta, una tarea de **181 ms de render** (React crea ~2.000 nodos: 50 filas × ~40 nodos; `timeOf` con `Intl` y zona horaria es la función propia más cara) y otra de **181 ms de layout + pintado** (Layout 111 ms con 27 raíces sucias sobre 2.177 objetos, Paint ~70 ms). | El costo es crear, maquetar y pintar las filas nuevas (cada celda lleva su etiqueta para el modo tarjeta de mobile). La pasada 2 ya probó filas `memo` (no re-renderizar las viejas) con A/B: +2 %, revertido. Lo que lo bajaría es CSS de la pantalla (etiquetas por `attr()` en vez de un `<span>` por celda, `content-visibility` en los grupos de día): **no se hizo** (ver Pendientes). |
| Scroll de Dispositivos p95 33,5 vs 17 | Suite: el **peor frame era 719–1.271 ms en todas las corridas de `05`** (en `main`, 67–251). Microbenchmark con la tabla entera (386 filas, 16.136 nodos en `<main>`, 5.470 con `overflow` ≠ visible): prender/apagar `data-scrolling` = **1.321–2.228 ms** de estilo + layout con CPU 4×. Hit-test (`elementFromPoint`): **9–23 ms por punto**; con un velo encima, 0,0–0,1 ms. | El «sin puntero mientras scrollea» de la pasada 1 ponía `pointer-events: none` a los hijos de `.shell-scroll`. Esa propiedad **se hereda**: cambiarla recalculaba el estilo de los ~16.000 nodos al empezar y al terminar cada gesto de rueda (el frame de 736 ms). Y no abarataba el hit-test (con `pointer-events: none` siguió en 12–16 ms por punto): Blink igual recorre la tabla. |
| «touch 34» 127 vs 83 | No se perfiló aislado (máquina saturada). | Pendiente (ver abajo). |
| Dispositivos «contenido» 566 vs 428 | Código + A/B de pedidos | La lista pinta 12 filas y 30 en idle; lo que estiraba «contenido» era el pedido de contadores de Grupos/Papelera **demorado 300 ms fijos** a propósito. |
| Tareas 1ª vez 438 vs 357 | Pedidos al abrir (cpu-ab, 3×2) | Al abrir salían `/api/task-columns` y `/api/site-assistants`. Las columnas ya llegan con `/api/tasks` desde la pasada 2: el primero sobraba. `site-assistants` se usa en el tablero (Analítica del equipo) y el formulario: se mantiene. |

## Cambios (cada uno con su medición)

| # | Cambio (commit) | Medición | A | B | Estado |
| --- | --- | --- | --- | --- | --- |
| 1 | **Velo invisible durante la rueda** en vez de `pointer-events` heredado (37fdbe8): un `<div>` sticky, primer hijo de `.shell-scroll`, del alto del área visible y con margen negativo igual (no ocupa lugar), se muestra 150 ms mientras se scrollea con rueda; el hit-test termina en él y la rueda sigue scrolleando el contenedor. | `cpu-ab --scenario=scroll` (Dispositivos entera, ida y vuelta, n = 4 por lado) | CPU total 5.174 ms · estilo 1.821 · hit-test 1.358 · pintado 1.516 · tarea más larga 746 | **1.718 (−67 %) · 1,4 (−99,9 %) · 35 (−97 %) · 814 (−46 %) · 116 (−84 %)** | **queda** |
| 1 | (mismo cambio) | `ab.mjs --only=scroll,devsearch` 2×4 (n = 8; carga A 8,4–9,3 / B 11,3–11,8 núcleos) | scroll Dispositivos: p50 33,4 · p95 100,3 · peor frame 1.873 · frames > 50 ms 78; Historial peor frame 468 | **16,7 · 67 · 585 (−69 %) · 30 (−62 %); 33,5 (−93 %)** | — |
| 2 | `useFitPlaceholder` escucha `loadingdone` en vez de leer `document.fonts.ready` al montar (17abb26) | `cpu-ab --scenario=warm`, n = 5 por lado | ver fila 2–4 | | **queda** |
| 3 | Menú: **densidad recordada** (mismo alto, ítems y preferencias → se usa la guardada desde el primer render, sin probar) (59cc209) | ídem | | | **queda** |
| 4 | La línea de estado completa (`ShellStatus`, chunk de franjas) se pide **un frame después del primer pintado**; mientras, `StatusOutlet` ya muestra los avisos (92c52df) | ídem | | | **queda** |
| 2–4 | (los tres juntos) | `cpu-ab --scenario=warm`, n = 5 por lado, alternados | layouts forzados 6 · **CPU de layout forzado 31 ms** (23–44 en las 5 corridas) · estilos forzados 7 · CPU hasta el FCP 193 · tarea más larga 79,9 | 5 · **4,6 ms (−85 %; 3–6 en las 5)** · 6 · 170,7 (−12 %) · 71,8 (−10 %) | **quedan** |
| 2–4 | (ídem, tiempo de pared) | `ab.mjs --only=startup` 2×4 con **12/12 núcleos ocupados** | inicio en caliente: FCP 1.008 · TTI 4.761 · TBT 1.369 | 732 (−27 %) · 2.642 (−45 %) · 667 (−51 %); en frío +18 a +43 % **con el DCL +50 %** (que ningún cambio toca): ruido | — |
| 5 | Tareas: **sin pedir `/api/task-columns` al abrir** si las columnas llegaron con la lista; se siguen de la lista polleada sin pisar un cambio local en curso (d311f78) | `cpu-ab --scenario=view:tasks`, pedidos al abrir (3×2) | `/api/task-columns` + `/api/site-assistants` (+ polls) | `/api/site-assistants` (+ polls): **un viaje menos** antes de «a la vista» | **queda** |
| 6 | Dispositivos: contadores de Grupos/Papelera **apenas se pinta la lista** (rAF + 0) en vez de a los 300 ms fijos (b5e9ea0) | `cpu-ab --scenario=view:devices` (n = 5) | último pedido terminado a 2.199 ms (mediana, con la máquina saturada) | 1.865 ms (−15 %); el pedido sale en el frame siguiente al pintado, no a los 300 ms | **queda** |

Nota sobre el CPU total del arranque (2–4): en tres tandas de `cpu-ab --scenario=warm` la CPU total del hilo principal dio +9,6 % (n = 6), −13,3 % (n = 8) y +2,7 % (n = 5): es ruido de la carga (la misma versión varió de 367 a 859 ms). Lo que sí se repite en todas las corridas es lo que el cambio ataca: el layout forzado desaparece del commit del Inicio y del primer frame, y la CPU hasta el FCP baja (−8,5 %, −16,7 %, −11,6 %).

Sin revertidos en esta pasada: los cambios que se descartaron antes de escribir código (con su medición) están en «No se hizo».

## Búsqueda rápida de personas (DIRECTIVA §6) — validación final

PENDIENTE_PEOPLE

## Barrido de los 5 ejes en las pantallas que no se habían mirado

PENDIENTE_SWEEP

## Robustez: sesión larga, duplicados, errores

PENDIENTE_SOAK

## No se hizo (con motivo)

- **Sacar la precarga del Inicio de la evaluación de la entrada** (24 ms de CPU en caliente, punto 1 del diagnóstico): es el pedido que adelanta el chunk del Inicio en frío (sale junto con la sesión); moverlo después del primer render lo atrasa ~100 ms en frío para ahorrar ~24 ms en caliente. Volver a meter el Inicio en la entrada rompe el presupuesto de JS de entrada (96,5 KB + ~22 KB gzip > 102). Juntar chunks con `manualChunks` ya se probó en la pasada 2 (R4: arrastraba `ui-kit` al camino crítico).
- **Historial «cargar más»**: necesita CSS de la pantalla (etiquetas de celda por `attr()`, `content-visibility` con tamaño intrínseco por grupo de día). Mientras los revisores de UX y el agente de estética trabajan en paralelo sobre el CSS de las pantallas, el coordinador pidió no tocarlo; además `content-visibility` empeoró el scroll en la pasada 1 (R3) y necesita su propio A/B con la sonda UX (saltos de scroll).
- **«touch 34»**: no se pudo perfilar aislado con la máquina saturada (el A/B del velo dio 241 → 323 ms con B bajo más carga; el camino no pasa por el velo, que está oculto salvo con rueda). Hipótesis sin verificar: al tipear, la lista vuelve a 12 filas y desmonta las ~375 que estaban abiertas (16.000 nodos).

## Cierre

PENDIENTE_CIERRE

## Tabla final (DIRECTIVA §13)

PENDIENTE_TABLA
