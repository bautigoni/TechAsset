# Benchmark 00-inicial-r3

Checkout `` () · 2026-10-22T13:22:08.615Z · generado por `perf/suite.mjs`.

**Condiciones:** 7 corridas por métrica · CPU 4× más lenta · red simulada 40 ms RTT, 10 Mbps bajada, 5 Mbps subida · 15 ms sincrónicos por query en el server (simula Supabase) · Chrome 155.0.8059.85 headless, 1366×800 · Node v24.19.0 · AMD Ryzen 5 5560U with Radeon Graphics ×12. Una pasada de calentamiento sin registrar antes de las corridas; cada medición en un contexto de navegador nuevo, sin service worker.
**Datos (copia de la base, sede NFPT):** 386 equipos, 5145 eventos de préstamo, 5881 movimientos, 258 tareas, 327 actividades de agenda, 250 tickets.

Valores en ms: **mediana / p95** (p95 por rango más cercano; con n = 7 coincide con el máximo). Entre paréntesis, el tamaño de muestra válida. "–" = no se pudo medir (ver Fallas).

## Inicio de la aplicación

| Métrica | Frío (sin caché) | Caliente (recarga con caché) |
| --- | ---: | ---: |
| FCP (primer pintado con contenido) | 872 / 900 (7) | 320 / 412 (7) |
| App visible (navegación + main pintados) | 935.5 / 950.5 (7) | 366.6 / 484.9 (7) |
| Dashboard a la vista (sin pedidos en vuelo ni esqueletos en la ventana) | 1405.2 / 1566.4 (7) | 855.4 / 951.4 (7) |
| Dashboard con datos (todos los pedidos terminados y pantalla quieta) | 1614.8 / 1763.3 (7) | 1020.5 / 1170.5 (7) |
| Interactiva (TTI: 5 s sin tareas largas) | 1486.4 / 1761.5 (7) | 870.7 / 1164.8 (7) |
| TBT (FCP → TTI) | 53 / 191 (7) | 3 / 51 (7) |
| Tareas largas totales (ms) | 499 / 698 (7) | 112 / 278 (7) |
| DOMContentLoaded | 358.8 / 396.2 (7) | 133.9 / 161.4 (7) |
| Transferido hasta TTI (KB, corrida 1) | Script 227.8, Stylesheet 60.5, Image 45, Fetch 44.6, Document 1.3, Other 0 | Fetch 13.6, Document 0.3, Script 0, Stylesheet 0, Image 0, Other 0 |

## Cambio de módulo

Click en la navegación → **respuesta** (primer frame con un cambio en `<main>`), **a la vista** (primer frame con cambio en `<main>` sin pedidos de la acción en vuelo ni esqueletos dentro de la ventana: lo que se ve listo aunque abajo del pliegue sigan montándose secciones) y **contenido** (datos cargados y pantalla quieta). 1ª vez = primera visita en la sesión (puede bajar el chunk); 2ª = volver a una pantalla ya vista.

| Pantalla | 1ª respuesta | 1ª a la vista | 1ª contenido | 2ª respuesta | 2ª a la vista | 2ª contenido | Fallas |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Dashboard | 175.2 / 252.7 | 407.6 / 574.9 | 407.6 / 574.9 (7) | 158.4 / 160.8 | 364.1 / 567.5 | 364.1 / 567.5 (7) | 0 |
| Préstamos | 332.1 / 439.4 | 897.3 / 1036.9 | 897.3 / 1036.9 (7) | 153.9 / 200.1 | 800 / 960.2 | 800 / 960.2 (7) | 0 |
| Dispositivos | 215.7 / 287.4 | 423.9 / 537.4 | 423.9 / 537.4 (7) | 159.5 / 178.7 | 370.1 / 447.9 | 370.1 / 447.9 (7) | 0 |
| Inventario | 285.6 / 331.5 | 377.5 / 442.2 | 377.5 / 442.2 (7) | 81.2 / 102.2 | 131.7 / 210.8 | 131.7 / 210.8 (7) | 0 |
| Agenda | 184 / 190.9 | 184 / 190.9 | 184 / 190.9 (7) | 107.1 / 124.1 | 107.1 / 124.1 | 107.1 / 124.1 (7) | 0 |
| Tareas | 125.6 / 162.2 | 441.5 / 543.2 | 441.5 / 543.2 (7) | 92.3 / 125.8 | 283.1 / 504.5 | 283.1 / 504.5 (7) | 0 |
| Tickets | 110.6 / 115 | 1578.7 / 2153.6 | 1578.7 / 2153.6 (7) | 85.9 / 109.8 | 1161 / 1521 | 1161 / 1521 (7) | 0 |
| Historial | 145.5 / 196.2 | 314.9 / 371.5 | 314.9 / 371.5 (7) | 120.5 / 138.6 | 268.4 / 360.9 | 268.4 / 360.9 (7) | 0 |
| Analítica | 102 / 143.8 | 965.9 / 1226.3 | 1267.3 / 1394.1 (7) | 69.2 / 103.5 | 788.4 / 831.1 | 1091 / 1125.4 (7) | 0 |
| Configuración | 480 / 618.8 | 829.7 / 888.1 | 829.7 / 888.1 (7) | 276.9 / 357 | 677.9 / 704.2 | 677.9 / 704.2 (7) | 0 |

## Búsqueda rápida de personas (Préstamos)

Se tipean 3 letras seguidas en el campo Persona; se mide desde la 3ª tecla hasta el frame pintado con la sugerencia en pantalla. Hoy: `LoanForm` espera 220 ms (debounce) y pide `/api/loans/suggest`; el server lee todo `loan_events` de la sede y filtra en JS.

| Caso | Término | Personas que coinciden | Visible en pantalla | Espera antes del pedido | Pedido (navegador) | Endpoint (Node) | Fallas |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| común | `mic` | 9 | 337.9 / 362.1 (7) | 240.3 / 247.1 | 66.9 / 78.4 | 39.7 / 56.1 · 1 q | 0 |
| parcial | `cae` | 9 | 335.7 / 342.9 (7) | 234.2 / 242.6 | 70.2 / 74.9 | 38.9 / 54.9 · 1 q | 0 |
| con tilde | `rám` | 6 | 345.1 / 384 (7) | 241.9 / 251.8 | 73.9 / 114.1 | 39.5 / 57.2 · 1 q | 0 |
| sin tilde | `ram` | 6 | 338.5 / 342.4 (7) | 233.6 / 243 | 70 / 75.4 | 41.3 / 108 · 1 q | 0 |
| sin resultados | `zqx` | 0 | 337.8 / 356.7 (7) | 238.5 / 241.8 | 66.8 / 72.3 | 38.8 / 48.1 · 1 q | 0 |

En "sin resultados" la columna visible mide hasta que llega la respuesta vacía y se pinta el frame siguiente.

## Búsqueda flexible de equipos (Dispositivos)

`touch 34` (debería encontrar D1436): **104.1 / 114.8 (7)** ms desde la última tecla hasta que la tabla se aquieta · filas 386 → 1 · encontrado en 7/7 corridas.

## Historial

| Acción | ms | Filas |
| --- | ---: | ---: |
| Abrir Historial (primera página) | 593.3 / 629.3 (7) | 50 |
| Cargar más | 246.7 / 283.3 (7) | 100 |

## Desplazamiento en listas largas

Scroll programático de 120 px por frame, bajando y subiendo, sobre el contenedor que scrollea. Duración entre frames pintados (16,7 ms = 60 fps).

| Lista | Filas | Frames | p50 frame | p95 frame | Peor frame | Frames > 50 ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Dispositivos (tabla abierta entera) | 386 | 588 | 16.7 / 16.7 | 17.1 / 17.1 (7) | 217.5 / 251 | 4 / 8 |
| Historial (hasta 4 páginas) | 200 | 190 | 16.7 / 16.7 | 17.2 / 17.3 (7) | 33.9 / 50.2 | 0 / 2 |

## Operaciones frecuentes

| Operación | UI: click → pantalla quieta | POST (navegador) | API desde Node (POST + ver en /api/devices) | Queries |
| --- | ---: | ---: | ---: | ---: |
| Prestar uno | 492.3 / 525.2 (7) | 167 / 186 | 328.7 / 364.2 | 13 / 15 |
| Devolver uno | 472.1 / 533 (7) | 191 / 195 | 328.3 / 356.2 | 14 / 14 |

## API (desde Node, sin red simulada)

Cada endpoint 7 veces con las cachés del server calientes. Ráfaga de arranque (los GET que pide la app al abrir, 6 en paralelo): **492.7 / 509.7 (7)** ms, 22 queries.

| Endpoint | Estado | ms | Queries | KB |
| --- | ---: | ---: | ---: | ---: |
| `/api/auth/session` | 200 | 13.5 / 18.5 | 0 | 0.5 |
| `/api/site-settings` | 200 | 32.9 / 48.9 | 1 | 1.6 |
| `/api/devices` | 200 | 22.5 / 23.8 | 0 | 311 |
| `/api/movements` | 200 | 36.5 / 52.3 | 1 | 16.4 |
| `/api/agenda` | 200 | 36.3 / 49.2 | 1 | 57.3 |
| `/api/tasks?space=team` | 200 | 88.9 / 100.5 | 4 | 158.7 |
| `/api/notifications` | 200 | 47.9 / 49.3 | 1 | 4.9 |
| `/api/user/prefs` | 200 | 27.3 / 47.6 | 1 | 0 |
| `/api/release-notes/latest` | 200 | 32.5 / 37.9 | 1 | 0 |
| `/api/internal-notes?filter=all` | 200 | 33.3 / 34.2 | 1 | 0 |
| `/api/loans/previous-day` | 200 | 498.6 / 618.8 | 1 | 0.3 |
| `/api/photo-passes` | 200 | 33 / 35.5 | 1 | 5.9 |
| `/api/history?kind=loans&limit=50` | 200 | 36 / 49.3 | 1 | 12.9 |
| `/api/history?kind=all&limit=50` | 200 | 43 / 55 | 1 | 9 |
| `/api/loans/suggest?q=mic` | 200 | 39.7 / 56.1 | 1 | 1.2 |
| `/api/loans/suggest?q=cae` | 200 | 38.9 / 54.9 | 1 | 1.2 |
| `/api/loans/suggest?q=r%C3%A1m` | 200 | 39.5 / 57.2 | 1 | 0.9 |
| `/api/loans/suggest?q=ram` | 200 | 41.3 / 108 | 1 | 0.9 |
| `/api/loans/suggest?q=zqx` | 200 | 38.8 / 48.1 | 1 | 0 |
| `/api/tasks?space=all` | 200 | 86.8 / 101 | 4 | 158.7 |
| `/api/settings/shifts` | 200 | 39.7 / 47.2 | 1 | 0.1 |
| `/api/quick-links` | 200 | 33.7 / 48 | 1 | 2.3 |
| `/api/tools/config` | 200 | 150.5 / 167 | 8 | 0.2 |
| `/api/internal-notes?filter=active` | 200 | 37.4 / 93.9 | 1 | 0 |
| `/api/recess-schedules` | 200 | 33.6 / 47.6 | 1 | 0.1 |
| `/api/devices?refresh=1` | 200 | 23 / 24 | 0 | 311 |
| `/api/photo-passes/options` | 200 | 164.1 / 178.9 | 7 | 6.9 |
| `/api/inventory/items` | 200 | 51.6 / 66.8 | 2 | 18.1 |
| `/api/site-assistants` | 200 | 33.9 / 41.9 | 1 | 0.2 |
| `/api/task-columns` | 200 | 34.9 / 48.7 | 1 | 0.3 |
| `/api/tickets` | 200 | 24 / 38.6 | 1 | 135.5 |
| `/api/ticket-templates` | 200 | 47.3 / 57.9 | 1 | 0 |
| `/api/classrooms` | 200 | 48.1 / 51.4 | 1 | 21.4 |
| `/api/analytics/parque` | 200 | 101.8 / 118.6 | 4 | 0.8 |
| `/api/analytics?from=2025-10-22&to=2026-10-22` | 200 | 309.4 / 323 | 9 | 1886.6 |
| `/api/notifications/prefs` | 200 | 49.1 / 56.3 | 2 | 0.2 |
| `/api/invites` | 200 | 32.8 / 47.2 | 1 | 0 |
| `/api/lifecycle/defaults` | 200 | 41.2 / 48.6 | 2 | 0.4 |
| `/api/allowed-users` | 200 | 274.8 / 301.9 | 15 | 2 |
| `/api/sites` | 200 | 31.7 / 33.1 | 1 | 0.7 |

## Tamaños del build

| Recurso | Crudo (KB) | gzip (KB) |
| --- | ---: | ---: |
| JS inicial (entry + modulepreload) | 303.5 | 94.4 |
| CSS inicial | 315.4 | 56.8 |
| Fuentes precargadas | 0 | 0 |
| **Total crítico** (HTML + JS + CSS + fuentes precargadas) |  | **152.1** |
| Todo el JS de dist/assets (38 archivos) | 693.8 | 220.3 |
| Todo el CSS de dist/assets (1 archivos) | 315.4 | 56.8 |

Crítico: `index.html` 0.9 KB, `assets/index-DOsGF_Mo.js` 94.4 KB, `assets/index-DMXscToB.css` 56.8 KB.

## Fallas

Ninguna.

## Cómo reproducir

```bash
node perf/suite.mjs --repo=<checkout> --label=00-inicial-r3 --runs=7 --cpu=4 --latency=15 --rtt=40 --down=10 --up=5
```

Para medir otra rama sin tocar el repo principal: `git worktree add <tmp> <rama>`, junction de `node_modules` (`cmd /c mklink /J node_modules <repo>\node_modules`), correr la suite con `--repo=<tmp>` y `git worktree remove --force <tmp>`. Usá la misma base (`--db=<snapshot>`) en todas las etiquetas que quieras comparar.
