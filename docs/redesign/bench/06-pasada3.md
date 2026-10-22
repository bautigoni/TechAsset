# Benchmark 06-pasada3

Checkout `` () · 2026-10-22T13:08:30.494Z · generado por `perf/suite.mjs`.

**Condiciones:** 7 corridas por métrica · CPU 4× más lenta · red simulada 40 ms RTT, 10 Mbps bajada, 5 Mbps subida · 15 ms sincrónicos por query en el server (simula Supabase) · Chrome 155.0.8059.85 headless, 1366×800 · Node v24.19.0 · AMD Ryzen 5 5560U with Radeon Graphics ×12. Una pasada de calentamiento sin registrar antes de las corridas; cada medición en un contexto de navegador nuevo, sin service worker.
**Datos (copia de la base, sede NFPT):** 386 equipos, 5145 eventos de préstamo, 5881 movimientos, 258 tareas, 327 actividades de agenda, 250 tickets.

Valores en ms: **mediana / p95** (p95 por rango más cercano; con n = 7 coincide con el máximo). Entre paréntesis, el tamaño de muestra válida. "–" = no se pudo medir (ver Fallas).

## Inicio de la aplicación

| Métrica | Frío (sin caché) | Caliente (recarga con caché) |
| --- | ---: | ---: |
| FCP (primer pintado con contenido) | 808 / 1048 (7) | 408 / 748 (7) |
| App visible (navegación + main pintados) | 886.3 / 1146.7 (7) | 452.5 / 877.8 (7) |
| Dashboard a la vista (sin pedidos en vuelo ni esqueletos en la ventana) | 1564.2 / 1973.1 (7) | 987 / 1578 (7) |
| Dashboard con datos (todos los pedidos terminados y pantalla quieta) | 1564.2 / 1973.1 (7) | 987 / 1578 (7) |
| Interactiva (TTI: 5 s sin tareas largas) | 1562.8 / 1906.1 (7) | 916.8 / 1508.4 (7) |
| TBT (FCP → TTI) | 217 / 434 (7) | 109 / 461 (7) |
| Tareas largas totales (ms) | 873 / 1210 (7) | 367 / 937 (7) |
| DOMContentLoaded | 426.7 / 525.5 (7) | 177.8 / 261.2 (7) |
| Transferido hasta TTI (KB, corrida 1) | Script 426.6, Stylesheet 79.2, Font 52.1, Fetch 34.1, Document 1.9, Image 1.5, Other 0 | Fetch 3.2, Document 0.3, Script 0, Stylesheet 0, Font 0, Image 0, Other 0 |

## Cambio de módulo

Click en la navegación → **respuesta** (primer frame con un cambio en `<main>`), **a la vista** (primer frame con cambio en `<main>` sin pedidos de la acción en vuelo ni esqueletos dentro de la ventana: lo que se ve listo aunque abajo del pliegue sigan montándose secciones) y **contenido** (datos cargados y pantalla quieta). 1ª vez = primera visita en la sesión (puede bajar el chunk); 2ª = volver a una pantalla ya vista.

| Pantalla | 1ª respuesta | 1ª a la vista | 1ª contenido | 2ª respuesta | 2ª a la vista | 2ª contenido | Fallas |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Dashboard | 260.3 / 361.3 | 343.4 / 459.9 | 343.4 / 459.9 (7) | 229.8 / 359.1 | 287.6 / 386.8 | 287.6 / 386.8 (7) | 0 |
| Préstamos | 357.1 / 508.4 | 428.6 / 604 | 428.6 / 604 (7) | 177.1 / 244.8 | 240.8 / 314.3 | 240.8 / 314.3 (7) | 0 |
| Dispositivos | 211.7 / 312.1 | 400.6 / 528.8 | 568.1 / 688.7 (7) | 143.7 / 171.4 | 320 / 461.3 | 514.8 / 607.2 (7) | 0 |
| Inventario | 159.9 / 223.7 | 244.5 / 330.1 | 244.5 / 330.1 (7) | 107.7 / 152.3 | 186.5 / 235.2 | 186.5 / 235.2 (7) | 0 |
| Agenda | 157.8 / 279 | 157.8 / 279 | 157.8 / 279 (7) | 105.2 / 198.8 | 105.2 / 198.8 | 105.2 / 198.8 (7) | 0 |
| Tareas | 353.9 / 436.2 | 531.9 / 682.6 | 531.9 / 682.6 (7) | 268.6 / 396.7 | 268.6 / 396.7 | 268.6 / 396.7 (7) | 0 |
| Tickets | 114.6 / 196.7 | 435.2 / 493.1 | 435.2 / 493.1 (7) | 91.9 / 209.9 | 255 / 475.3 | 255 / 475.3 (7) | 0 |
| Historial | 108.2 / 116 | 345.8 / 505.5 | 345.8 / 505.5 (7) | 89.2 / 208 | 286.8 / 517.1 | 286.8 / 517.1 (7) | 0 |
| Analítica | 152.2 / 189.2 | 803.7 / 861.4 | 2282.1 / 2460.4 (7) | 134.6 / 282.9 | 629.1 / 1398.5 | 1633.5 / 1866.2 (7) | 0 |
| Configuración | 135.9 / 264.9 | 135.9 / 264.9 | 135.9 / 264.9 (7) | 120.7 / 137.7 | 120.7 / 137.7 | 120.7 / 137.7 (7) | 0 |

## Búsqueda rápida de personas (Préstamos)

Se tipean 3 letras seguidas en el campo Persona; se mide desde la 3ª tecla hasta el frame pintado con la sugerencia en pantalla. Hoy: `LoanForm` espera 220 ms (debounce) y pide `/api/loans/suggest`; el server lee todo `loan_events` de la sede y filtra en JS.

| Caso | Término | Personas que coinciden | Visible en pantalla | Espera antes del pedido | Pedido (navegador) | Endpoint (Node) | Fallas |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| común | `mic` | 9 | 108 / 141 (7) | – | – | 17.1 / 18.3 · 0 q | 0 |
| parcial | `cae` | 9 | 103 / 145.6 (7) | – | – | 17.2 / 18.4 · 0 q | 0 |
| con tilde | `rám` | 6 | 95.1 / 139.5 (7) | – | – | 15.8 / 18.4 · 0 q | 0 |
| sin tilde | `ram` | 6 | 93.3 / 133.7 (7) | – | – | 15.8 / 18.6 · 0 q | 0 |
| sin resultados | `zqx` | 0 | 0 / 0 (7) | – | – | 15.5 / 17.9 · 0 q | 0 |

En "sin resultados" la columna visible mide hasta que llega la respuesta vacía y se pinta el frame siguiente.

## Búsqueda flexible de equipos (Dispositivos)

`touch 34` (debería encontrar D1436): **137.4 / 234.6 (7)** ms desde la última tecla hasta que la tabla se aquieta · filas 387 → 2 · encontrado en 7/7 corridas.

## Historial

| Acción | ms | Filas |
| --- | ---: | ---: |
| Abrir Historial (primera página) | 599.3 / 816.3 (7) | 56 |
| Cargar más | 403.8 / 467.2 (7) | 110 |

## Desplazamiento en listas largas

Scroll programático de 120 px por frame, bajando y subiendo, sobre el contenedor que scrollea. Duración entre frames pintados (16,7 ms = 60 fps).

| Lista | Filas | Frames | p50 frame | p95 frame | Peor frame | Frames > 50 ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Dispositivos (tabla abierta entera) | 387 | 296 | 16.7 / 16.7 | 17.2 / 33.4 (7) | 234.1 / 267.4 | 2 / 4 |
| Historial (hasta 4 páginas) | 216 | 182 | 16.7 / 16.7 | 17 / 17.2 (7) | 17.4 / 18.7 | 0 / 0 |

## Operaciones frecuentes

| Operación | UI: click → pantalla quieta | POST (navegador) | API desde Node (POST + ver en /api/devices) | Queries |
| --- | ---: | ---: | ---: | ---: |
| Prestar uno | 403.2 / 823.5 (7) | 125 / 201 | 92.7 / 109.1 | 3 / 3 |
| Devolver uno | 341.8 / 502.7 (7) | 134 / 225 | 104.8 / 122.1 | 4 / 4 |

## API (desde Node, sin red simulada)

Cada endpoint 7 veces con las cachés del server calientes. Ráfaga de arranque (los GET que pide la app al abrir, 6 en paralelo): **324.6 / 387.1 (7)** ms, 11 queries.

| Endpoint | Estado | ms | Queries | KB |
| --- | ---: | ---: | ---: | ---: |
| `/api/auth/session` | 200 | 17.1 / 18 | 0 | 0.5 |
| `/api/site-settings` | 200 | 34.4 / 50.3 | 1 | 1.6 |
| `/api/devices` | 200 | 22.6 / 24.9 | 0 | 311 |
| `/api/movements` | 200 | 35.2 / 53.3 | 1 | 16.4 |
| `/api/agenda` | 200 | 36.5 / 53.4 | 1 | 57.3 |
| `/api/tasks?space=team` | 200 | 19.6 / 20.2 | 0 | 159 |
| `/api/notifications` | 200 | 48.5 / 49.2 | 1 | 4.9 |
| `/api/user/prefs` | 200 | 32.2 / 35.2 | 1 | 0 |
| `/api/release-notes/latest` | 200 | 32.6 / 41.3 | 1 | 0 |
| `/api/internal-notes?filter=all` | 200 | 33.8 / 48 | 1 | 0 |
| `/api/loans/previous-day` | 200 | 9.6 / 17.6 | 0 | 0.3 |
| `/api/photo-passes` | 200 | 41.6 / 49.8 | 1 | 5.9 |
| `/api/history?kind=loans&limit=50` | 200 | 33.4 / 35.2 | 1 | 12.9 |
| `/api/history?kind=all&limit=50` | 200 | 41.9 / 54.3 | 1 | 9 |
| `/api/loans/suggest?q=mic` | 200 | 17.1 / 18.3 | 0 | 1.2 |
| `/api/loans/suggest?q=cae` | 200 | 17.2 / 18.4 | 0 | 1.2 |
| `/api/loans/suggest?q=r%C3%A1m` | 200 | 15.8 / 18.4 | 0 | 0.9 |
| `/api/loans/suggest?q=ram` | 200 | 15.8 / 18.6 | 0 | 0.9 |
| `/api/loans/suggest?q=zqx` | 200 | 15.5 / 17.9 | 0 | 0 |
| `/api/settings/shifts` | 200 | 32.9 / 34.5 | 1 | 0.1 |
| `/api/tasks?space=all` | 200 | 20.1 / 21 | 0 | 159 |
| `/api/quick-links` | 200 | 48.4 / 49.4 | 1 | 2.4 |
| `/api/tools/config` | 200 | 32.9 / 48.5 | 1 | 0.2 |
| `/api/recess-schedules` | 200 | 32.9 / 48.6 | 1 | 0.1 |
| `/api/internal-notes?filter=active` | 200 | 32.5 / 48 | 1 | 0 |
| `/api/loans/people` | 200 | 18.3 / 19.2 | 0 | 57.2 |
| `/api/devices/panel-counts` | 200 | 32.7 / 42 | 1 | 0 |
| `/api/inventory/items` | 200 | 49.4 / 64.9 | 2 | 18.1 |
| `/api/site-assistants` | 200 | 35 / 46.9 | 1 | 0.2 |
| `/api/tickets` | 200 | 39 / 52.2 | 1 | 135.5 |
| `/api/ticket-templates` | 200 | 33.8 / 46.7 | 1 | 0 |
| `/api/classrooms` | 200 | 29.7 / 35.9 | 1 | 21.4 |
| `/api/analytics?from=2025-10-22&to=2026-10-22` | 200 | 168.9 / 231.6 | 4 | 112.6 |
| `/api/analytics/parque` | 200 | 96.7 / 114.6 | 4 | 0.8 |
| `/api/allowed-users` | 200 | 77.9 / 112.7 | 3 | 2.3 |
| `/api/invites` | 200 | 35.9 / 48.9 | 1 | 0 |

## Tamaños del build

| Recurso | Crudo (KB) | gzip (KB) |
| --- | ---: | ---: |
| JS inicial (entry + modulepreload) | 296.5 | 94.6 |
| CSS inicial | 85.9 | 15 |
| Fuentes precargadas | 28.7 | 28.7 |
| **Total crítico** (HTML + JS + CSS + fuentes precargadas) |  | **139.9** |
| Todo el JS de dist/assets (79 archivos) | 1361.8 | 455.7 |
| Todo el CSS de dist/assets (25 archivos) | 402 | 75 |

Crítico: `index.html` 1.6 KB, `assets/index-BrWbeNJg.js` 94.6 KB, `assets/index-Djl-Bt00.css` 15 KB, `assets/geist-latin-wght-normal-BgDaEnEv.woff2` 28.7 KB.

## Fallas

Ninguna.

## Cómo reproducir

```bash
node perf/suite.mjs --repo=<checkout> --label=06-pasada3 --runs=7 --cpu=4 --latency=15 --rtt=40 --down=10 --up=5
```

Para medir otra rama sin tocar el repo principal: `git worktree add <tmp> <rama>`, junction de `node_modules` (`cmd /c mklink /J node_modules <repo>\node_modules`), correr la suite con `--repo=<tmp>` y `git worktree remove --force <tmp>`. Usá la misma base (`--db=<snapshot>`) en todas las etiquetas que quieras comparar.
