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

Herramienta nueva: `node perf/people-check.mjs --repo=<checkout>` (salida en `perf/.out/people-check.json`). Base: el snapshot, con las dos sedes como «muchos registros» (NFPT: 349 personas distintas en el directorio, 2.602 préstamos) y «pocos» (NFND: 140 personas, 317 préstamos). Navegador con CPU 4× y red 40 ms / 10 / 5 Mbps; **máquina con carga de fondo** (7–12 núcleos ocupados de 12). Los términos salen de los datos de cada sede (el nombre más repetido, mitad de una palabra, un apellido, nombre + apellido en los dos órdenes, mayúsculas, con y sin tilde, sin resultados). Se tipea letra por letra (110 ms entre teclas, como una persona) y se mide desde el evento `input` de la última tecla hasta el frame pintado con la sugerencia esperada.

**API** (Node, 15 ms por consulta como Supabase; mismo resultado en las dos sedes):

- `GET /api/loans/people`: NFPT 56,4 KB (≈ 10 KB gzip) · 9,1 / 151,4 ms (mediana / p95, n = 15) · con `If-None-Match` → **304**. NFND 23,1 KB · 15 / 41,8 ms.
- `GET /api/loans/suggest` (respaldo del front): en los 20 casos (10 por sede) **cada resultado contiene todas las palabras tipeadas sin importar mayúsculas ni tildes, 0 repetidos** (la misma persona escrita de dos formas sale una vez), y la lista es **idéntica, en orden, a la regla del front** (`searchPeople`, copiada en el script). 3,0–18,2 ms por pedido.
- **Permisos de sede:** sin sesión → **401**; un Asistente de NFPT pidiendo el directorio o sugerencias de NFND → **403**; su sede → 200.

**Navegador, NFPT (muchos registros), n = 3:**

| 3 letras (nombre repetido) | `mic` | 8 | 107.8 / 178 | 0 | 573 ms | 264 ms | 3/3 |
| nombre repetido completo | `micaela` | 8 | 53.7 / 76.9 | 0 | 660 ms | 208 ms | 3/3 |
| parcial (mitad de palabra) | `cael` | 8 | 44.3 / 303.4 | 0 | 682 ms | 312 ms | 3/3 |
| apellido solo | `sosa` | 8 | 88.9 / 89 | 0 | 609 ms | 384 ms | 3/3 |
| nombre + apellido | `micaela sos` | 1 | 40.2 / 47.8 | 0 | 947 ms | 400 ms | 3/3 |
| apellido + nombre | `sosa mic` | 1 | 65.2 / 67.1 | 0 | 550 ms | 256 ms | 3/3 |
| MAYÚSCULAS | `MICA` | 8 | 46.9 / 65.5 | 0 | 268 ms | 232 ms | 3/3 |
| con tilde | `agustí` | 6 | 55.6 / 138 | 0 | 853 ms | 344 ms | 3/3 |
| sin tilde | `agusti` | 6 | 73.9 / 98.8 | 0 | 469 ms | 240 ms | 3/3 |
| sin resultados | `zqx` | 0 | — (nada que mostrar) | 0 | 661 ms | 248 ms | 3/3 |
| 3 letras (nombre repetido) | `lor` | 8 | 121.9 / 326.4 | 0 | 196 ms | 152 ms | 3/3 |
| nombre repetido completo | `lorena` | 7 | 78.4 / 105.1 | 0 | 452 ms | 232 ms | 3/3 |
| parcial (mitad de palabra) | `cael` | 6 | 81.1 / 258.6 | 0 | 265 ms | 200 ms | 3/3 |
| apellido solo | `marti` | 8 | 179.9 / 180.4 | 0 | 124 ms | 168 ms | 3/3 |
| nombre + apellido | `lorena mar` | 1 | 43 / 110 | 0 | 296 ms | 304 ms | 3/3 |
| apellido + nombre | `mart lor` | 1 | 44.9 / 97.9 | 0 | 336 ms | 168 ms | 3/3 |
| MAYÚSCULAS | `LORE` | 8 | 71.4 / 100.1 | 0 | 283 ms | 304 ms | 3/3 |
| con tilde | `pére` | 2 | 123.3 / 166 | 0 | 364 ms | 216 ms | 3/3 |
| sin tilde | `pere` | 2 | 58.9 / 97 | 0 | 455 ms | 224 ms | 3/3 |
| sin resultados | `zqx` | 0 | — (nada que mostrar) | 0 | 382 ms | 264 ms | 3/3 |

**Navegador, NFND (pocos registros), n = 3:**

| 3 letras (nombre repetido) | `lor` | 8 | 121.9 / 326.4 | 0 | 196 ms | 152 ms | 3/3 |
| nombre repetido completo | `lorena` | 7 | 78.4 / 105.1 | 0 | 452 ms | 232 ms | 3/3 |
| parcial (mitad de palabra) | `cael` | 6 | 81.1 / 258.6 | 0 | 265 ms | 200 ms | 3/3 |
| apellido solo | `marti` | 8 | 179.9 / 180.4 | 0 | 124 ms | 168 ms | 3/3 |
| nombre + apellido | `lorena mar` | 1 | 43 / 110 | 0 | 296 ms | 304 ms | 3/3 |
| apellido + nombre | `mart lor` | 1 | 44.9 / 97.9 | 0 | 336 ms | 168 ms | 3/3 |
| MAYÚSCULAS | `LORE` | 8 | 71.4 / 100.1 | 0 | 283 ms | 304 ms | 3/3 |
| con tilde | `pére` | 2 | 123.3 / 166 | 0 | 364 ms | 216 ms | 3/3 |
| sin tilde | `pere` | 2 | 58.9 / 97 | 0 | 455 ms | 224 ms | 3/3 |
| sin resultados | `zqx` | 0 | — (nada que mostrar) | 0 | 382 ms | 264 ms | 3/3 |

(«última tecla → sugerencias» en ms, mediana / p95; «pedidos /api al tipear»: pedidos a `/api/loans/*` mientras se tipeaba —el directorio ya estaba bajado—; «tareas largas»: suma de tareas ≥ 50 ms del hilo principal en la ventana del tipeo, incluye los polls de fondo; «peor tecla»: la peor duración de un evento de teclado según Event Timing; «lista correcta»: la lista mostrada contiene exactamente lo que da la regla —para «sin resultados», que no se muestre nada.)

**Respuestas viejas que no pisan a las nuevas:** con el directorio caído (pedido abortado a propósito) la app usa `/api/loans/suggest` con debounce; la respuesta del primer término (`mic`) se demoró 900 ms y la del segundo (`sosa`) no. Resultado: el campo dice «sosa», se ven **8 sugerencias y todas son del último término**. Con el directorio (el camino normal) no hay pedidos al tipear, así que no hay respuestas que puedan llegar tarde.

**Veredicto §6:** sugerencias en **40–180 ms de mediana** desde la última tecla en los 20 casos, sin pedidos de red al tipear, listas correctas 60/60, tolerante a mayúsculas y tildes, nombres/apellidos/combinaciones, nombres repetidos, sin resultados, respuestas viejas descartadas y permisos de sede aplicados en el server. **Objetivo < 200 ms: cumplido en las medianas**; el p95 (n = 3, es decir el peor de 3) superó 200 ms en 3 de 18 casos con resultados: `cael` 303 ms en NFPT, `lor` 326 y `cael` 259 en NFND, con la máquina saturada por otros procesos (no se aisló si coincidieron con un poll de fondo). Sin cambios de código en esta pasada (lo de la pasada 1 sigue vigente).

## Barrido de los 5 ejes en las pantallas que no se habían mirado

Herramientas nuevas: `node perf/sweep.mjs --repo=<checkout>` (navegador, CPU 4×, red 40 ms / 10 / 5 Mbps, 15 ms por consulta; prende Conocimiento, Recordatorios y Canvas en la copia de la base) y `perf/pg-endpoints.mjs` (Postgres 17 real con el volumen del snapshot y `pg_stat_statements`). n = 2 corridas del barrido; **máquina con carga de fondo**: los ms son indicativos, los conteos (commits, pedidos, consultas, archivos) no dependen de la carga.

**Navegador** (cada pantalla abierta desde el menú con la app ya cargada en el Inicio; «tipeo»: 3 letras en el primer campo de texto de la pantalla, 90 ms entre teclas, ms hasta la pantalla quieta contando desde la primera tecla; «reposo»: 20 s quieta, escalado a 1 min):

| Pantalla | Abrir (ms, med) | Commits al abrir | Pedidos al abrir | Consultas | JS nuevo 1ª vez (archivos / KB) | Tipeo 3 letras: ms · commits · pedidos | Reposo: pedidos/min · commits/min · consultas/min |
| --- | ---: | ---: | --- | ---: | ---: | --- | --- |
| agenda | 343 | 2 | 2: /api/devices, /api/movements | 1 | 0 / 0 | sin campo | 15 · 0 · 21 |
| tickets | 268.2 | 6 | 6: /api/tickets, /api/ticket-templates, /api/classrooms, /api/site-assistants, /api/site-settings, /api/tools/config | 6 | 0 / 0 | 300 · 6 · 0 (Buscar tickets) | 21 · 0 · 33 |
| classrooms | 204.2 | 3 | 2: /api/classrooms, /api/classroom-categories | 3 | 0 / 0 | sin campo | 6 · 0 · 12 |
| inventory | 182.9 | 4 | 1: /api/inventory/items | 2 | 0 / 0 | 445 · 6 · 0 (Nombre, etiqueta, modelo… (touch 34, D14) | 9 · 0 · 15 |
| settings | 240.8 | 4 | 3: /api/allowed-users, /api/invites, /api/site-settings | 5 | 0 / 0 | sin campo | 15 · 0 · 21 |
| knowledge | 146.1 | 5 | 1: /api/knowledge/articles, /api/devices, /api/movements | 3 | 0 / 0 | 635.5 · 10 · 1 (Buscar en la base de conocimiento) | 15 · 0 · 21 |
| reminders | 81 | 3 | 1: /api/reminders | 1 | 0 / 0 | sin campo | 6 · 0 · 15 |
| canvas | 187.9 | 3 | 3: /api/canvas/items, /api/canvas/version, /api/tasks | 2 | 0 / 0 | sin campo | 6 · 0 · 6 |
| schedules | 140.1 | 5 | 2: /api/teacher-schedules, /api/recess-schedules | 2 | 1 / 8.4 | 226.7 · 3 · 0 (Buscar por docente, curso, materia, aula) | 21 · 0 · 24 |
| tools | 176.9 | 5 | 1: /api/tools/config | 1 | 0 / 0 | sin campo | 15 · 0 · 24 |
| quickaccess | 349.6 | 5 | 2: /api/quick-links, /api/tools/config, /api/devices, /api/movements | 2 | 0 / 0 | 283 · 5 · 0 (Filtrar accesos) | 15 · 0 · 21 |
| pettycash | 141.5 | 3 | 1: /api/petty-cash | 4 | 0 / 0 | sin campo | 6 · 0 · 3 |
| suggestions | 113.1 | 3 | 1: /api/suggestions | 4 | 0 / 0 | sin campo | 0 · 0 · 0 |

Lectura por eje:

1. **Renders:** 2 a 6 commits de React al abrir cualquier pantalla y **0 commits por minuto en reposo en las 13** (los polls con ETag/304 no re-renderizan). Al tipear, 1 a 2 commits por tecla (el valor y el filtro; Conocimiento suma el estado de carga de su búsqueda en el server: 10 en 3 letras). Sin renders de más que corregir.
2. **Bundle:** al abrir por primera vez **no se baja JS nuevo** en 12 de 13 pantallas (la precarga en idle de la pasada 1 ya las trajo); Horarios baja un sub-chunk de 8,4 KB. Ninguna imagen ni fuente nueva al abrir.
3. **Requests:** 1 a 3 pedidos al abrir, salvo Tickets (6: lista, plantillas y los auxiliares de los formularios —aulas, asistentes, ajustes de la sede, config de herramientas—, que salen después de la lista y no la demoran). En reposo 0 a 21 pedidos/min: son los polls globales (equipos, movimientos, notificaciones, tareas) con ETag/304; Sugerencias quieta: 0.
4. **Queries:** 1 a 7 consultas al abrir cada pantalla en SQLite. En **Postgres con el volumen del snapshot** (2 pedidos por endpoint: frío y con las cachés del server calientes):

| Endpoint | Estado | Consultas (frío / caliente) | Ejecución en PG ms (frío / caliente) | Respuesta ms (frío / caliente) | KB |
| --- | ---: | ---: | ---: | ---: | ---: |
| `/api/auth/session` | 200 | 3 / 0 | 0.2 / 0 | 33 / 5 | 0.5 |
| `/api/site-settings` | 200 | 1 / 1 | 0.1 / 0.1 | 43 / 28 | 1.6 |
| `/api/devices` | 200 | 7 / 0 | 2.5 / 0 | 252 / 112 | 310.9 |
| `/api/movements` | 200 | 1 / 1 | 15.6 / 7.5 | 65 / 37 | 16.4 |
| `/api/agenda` | 200 | 1 / 1 | 1.3 / 1.6 | 53 / 46 | 57.3 |
| `/api/tasks?space=all` | 200 | 5 / 0 | 2 / 0 | 92 / 20 | 159 |
| `/api/notifications` | 200 | 1 / 1 | 0.3 / 0.3 | 22 / 25 | 4.9 |
| `/api/user/prefs` | 200 | 1 / 1 | 0 / 0 | 27 / 26 | 0 |
| `/api/release-notes/latest` | 200 | 1 / 1 | 0.1 / 0.1 | 27 / 14 | 0 |
| `/api/internal-notes?filter=active` | 200 | 1 / 1 | 0.1 / 0.1 | 74 / 13 | 0 |
| `/api/quick-links` | 200 | 1 / 1 | 0.1 / 0.1 | 18 / 11 | 2.4 |
| `/api/tools/config` | 200 | 1 / 1 | 0 / 0 | 30 / 12 | 0.2 |
| `/api/recess-schedules` | 200 | 1 / 1 | 0.1 / 0.1 | 122 / 88 | 0.1 |
| `/api/settings/shifts` | 200 | 1 / 1 | 0.1 / 0.1 | 30 / 27 | 0.1 |
| `/api/tickets` | 200 | 1 / 1 | 2.5 / 2.5 | 98 / 63 | 135.5 |
| `/api/ticket-templates` | 200 | 1 / 1 | 0.1 / 0.1 | 10 / 18 | 0 |
| `/api/classrooms` | 200 | 9 / 1 | 1 / 0.5 | 141 / 25 | 21.4 |
| `/api/classrooms/summary` | 200 | 1 / 1 | 0.3 / 0.4 | 25 / 18 | 0.1 |
| `/api/classroom-categories` | 200 | 2 / 1 | 0.2 / 0.1 | 31 / 25 | 1.5 |
| `/api/inventory/items` | 200 | 2 / 2 | 0.2 / 0.4 | 40 / 32 | 18.1 |
| `/api/knowledge/articles` | 200 | 3 / 3 | 0.2 / 0.2 | 52 / 44 | 0.1 |
| `/api/reminders` | 200 | 1 / 1 | 0.1 / 0.1 | 21 / 9 | 0 |
| `/api/reminders/people` | 200 | 1 / 1 | 0.2 / 0.1 | 19 / 24 | 0.4 |
| `/api/canvas/items` | 200 | 1 / 1 | 0 / 0.1 | 11 / 8 | 0 |
| `/api/teacher-schedules` | 200 | 1 / 1 | 0 / 0.1 | 13 / 9 | 0.1 |
| `/api/petty-cash` | 200 | 4 / 4 | 0.3 / 0.3 | 27 / 38 | 0.2 |
| `/api/suggestions` | 200 | 4 / 4 | 0.2 / 0.2 | 35 / 27 | 0.2 |
| `/api/photo-passes` | 200 | 2 / 1 | 0.2 / 0.2 | 21 / 21 | 5.9 |
| `/api/site-assistants` | 200 | 1 / 1 | 0.3 / 0.2 | 22 / 8 | 0.2 |
| `/api/task-columns` | 200 | 1 / 1 | 0.1 / 0.1 | 12 / 11 | 0.3 |
| `/api/devices/panel-counts` | 200 | 1 / 1 | 0.1 / 0.1 | 11 / 13 | 0 |
| `/api/device-groups` | 200 | 2 / 2 | 0.1 / 0.1 | 28 / 29 | 0 |
| `/api/devices/deleted` | 200 | 1 / 1 | 0.3 / 0.4 | 12 / 22 | 0.2 |
| `/api/history?kind=loans&limit=50` | 200 | 1 / 1 | 7.5 / 4.9 | 34 / 18 | 12.9 |
| `/api/history?kind=all&limit=50` | 200 | 1 / 1 | 17.3 / 18.2 | 41 / 40 | 9 |
| `/api/loans/people` | 200 | 1 / 0 | 6.1 / 0 | 146 / 16 | 57 |
| `/api/loans/suggest?q=mar` | 200 | 0 / 0 | 0 / 0 | 18 / 8 | 1.2 |
| `/api/loans/previous-day` | 200 | 2 / 0 | 2.5 / 0 | 35 / 10 | 0.3 |
| `/api/photo-passes/options` | 200 | 2 / 2 | 7.1 / 6.7 | 43 / 40 | 6.9 |
| `/api/daily-closures` | 200 | 1 / 1 | 0 / 0 | 17 / 20 | 0 |
| `/api/daily-closures/preview` | 200 | 7 / 7 | 2.4 / 2 | 74 / 43 | 19.5 |
| `/api/analytics` | 200 | 4 / 4 | 30.3 / 29.2 | 406 / 178 | 112.4 |
| `/api/analytics/parque` | 200 | 4 / 4 | 0.2 / 0.3 | 35 / 119 | 0.8 |
| `/api/allowed-users` | 200 | 3 / 3 | 0.5 / 0.4 | 29 / 43 | 2.3 |
| `/api/sites` | 200 | 1 / 1 | 0.1 / 0.1 | 22 / 14 | 0.7 |

   Ningún endpoint crece con los datos (sin N+1): el máximo en frío es `/api/classrooms` con 9 consultas, que quedan en 1 con la caché; `/api/devices` 7 → 0, `/api/tasks` 5 → 0, `/api/loans/people` 1 → 0. Lo más caro en ejecución dentro de Postgres es `/api/analytics` (4 consultas, ~30 ms) y el historial completo (`kind=all`, 1 consulta, ~17 ms): se piden al abrir esas pantallas, no se pollean.
5. **Imágenes, fuentes y scripts:** ninguna imagen ni fuente pedida al abrir estas pantallas; Geist y Geist Mono ya están en caché desde el arranque (sin cambios desde la pasada 2).
6. **Asistente:** su chunk se precarga en idle con las vistas (`prefetchViewsWhenIdle([..., 'assistant'])`); no se midió el chat (sin claves de IA en el banco: cae al modo local).

Sin cambios de código por el barrido: lo que se vio está dentro de lo esperado o es una decisión de diseño (búsqueda de Conocimiento en el server, paginada).

## Robustez: sesión larga, duplicados, errores

Herramienta nueva: `node perf/soak.mjs --repo=<checkout> --minutes=10 --warp=3 [--snapshots]`. La app abierta en un Chrome headless (sin limitar CPU) navegando por **todas las pantallas del menú** (una cada 2,5 s, volviendo al Inicio cada tres) durante 10 minutos reales con los timers de la página **acelerados 3×** (el polling de 30 s corre cada 10 s): ≈ 30 minutos de polling. Cada minuto: GC forzado y heap usado, nodos del DOM y listeners, siempre parados en el Inicio. Pedidos duplicados = el mismo GET `/api` saliendo mientras otro idéntico está en vuelo. Después, 3 ráfagas de 600 pedidos al server (6 en paralelo, los 8 endpoints más usados) con GC antes de leer su memoria. **Máquina con carga de fondo** (no afecta conteos ni memoria).

Resultado (`06`):

    min 0: heap 4.8 MB · nodos 1335 · listeners 386 · pedidos 14 · vistas 0
    min 1: heap 8.5 MB · nodos 4207 · listeners 876 · pedidos 98 · vistas 24
    min 2: heap 9.2 MB · nodos 4207 · listeners 876 · pedidos 188 · vistas 48
    min 3: heap 10 MB · nodos 4207 · listeners 876 · pedidos 262 · vistas 69
    min 4: heap 10.3 MB · nodos 4207 · listeners 876 · pedidos 344 · vistas 92
    min 5: heap 10.8 MB · nodos 4207 · listeners 876 · pedidos 434 · vistas 116
    min 6: heap 10.9 MB · nodos 4207 · listeners 876 · pedidos 511 · vistas 138
    min 7: heap 11 MB · nodos 4207 · listeners 876 · pedidos 592 · vistas 160
    min 8: heap 11.1 MB · nodos 4207 · listeners 876 · pedidos 682 · vistas 184
    min 9: heap 11.7 MB · nodos 4207 · listeners 876 · pedidos 759 · vistas 206
    min 10: heap 11.8 MB · nodos 4207 · listeners 876 · pedidos 840 · vistas 228

- **Vistas abiertas: 228 · pedidos /api: 840 · pedidos GET duplicados en vuelo: 0 · errores de consola: 0 · excepciones sin atrapar: 0 · respuestas 5xx: 0.**
- **DOM y listeners planos:** 4.207 nodos y 876 listeners del minuto 1 al 10 (lo del minuto 0 es el Inicio antes de abrir el resto: chunks y cachés que se llenan una vez).
- **Heap del front después de GC:** 8,5 MB → 11,8 MB en 9 minutos, desacelerando (+1 MB entre el 5 y el 10). Para ver qué crece, otra corrida con `--snapshots` (6 min, snapshot del heap en el minuto 1 y al final; 137 vistas) dio el crecimiento por tipo: **1.744 KB `InstructionStream` + 267 KB `TrustedByteArray` + 132 KB `FeedbackVector` + 46 KB `Code`** (código que V8 compila y optimiza a medida que se usan más pantallas y funciones), **366 KB `NetworkResourcesData`** (el buffer de red de DevTools: lo causa el propio `Network.enable` del banco) y, de la app, **+37 KB de `Object`** y **444 `DOMRectReadOnly` (24 KB)**. No hay objetos de la app que crezcan con las vistas abiertas (componentes, filas, respuestas): **sin fugas**.
- **Server:** heap después de GC 21,9 MB antes de las ráfagas y 22,3 / 22,1 / 22,1 MB después de cada una (plano); RSS 102 → 108 → 114 MB (el RSS de Node no devuelve memoria al sistema enseguida; el heap, que es lo que crecería con una fuga, no se movió). Cada ráfaga de 600 pedidos tardó 10,5–10,8 s (≈ 17 ms por pedido con 15 ms de latencia simulada por consulta), sin 5xx.

## No se hizo (con motivo)

- **Sacar la precarga del Inicio de la evaluación de la entrada** (24 ms de CPU en caliente, punto 1 del diagnóstico): es el pedido que adelanta el chunk del Inicio en frío (sale junto con la sesión); moverlo después del primer render lo atrasa ~100 ms en frío para ahorrar ~24 ms en caliente. Volver a meter el Inicio en la entrada rompe el presupuesto de JS de entrada (96,5 KB + ~22 KB gzip > 102). Juntar chunks con `manualChunks` ya se probó en la pasada 2 (R4: arrastraba `ui-kit` al camino crítico).
- **Historial «cargar más»**: necesita CSS de la pantalla (etiquetas de celda por `attr()`, `content-visibility` con tamaño intrínseco por grupo de día). Mientras los revisores de UX y el agente de estética trabajan en paralelo sobre el CSS de las pantallas, el coordinador pidió no tocarlo; además `content-visibility` empeoró el scroll en la pasada 1 (R3) y necesita su propio A/B con la sonda UX (saltos de scroll).
- **«touch 34»**: no se pudo perfilar aislado con la máquina saturada (el A/B del velo dio 241 → 323 ms con B bajo más carga; el camino no pasa por el velo, que está oculto salvo con rueda). Hipótesis sin verificar: al tipear, la lista vuelve a 12 filas y desmonta las ~375 que estaban abiertas (16.000 nodos).

## Cierre

PENDIENTE_CIERRE

## Tabla final (DIRECTIVA §13)

PENDIENTE_TABLA
