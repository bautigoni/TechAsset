# Benchmark 00-inicial-r2

Checkout `` () · 2026-10-20T12:42:19.425Z · generado por `perf/suite.mjs`.

**Condiciones:** 7 corridas por métrica · CPU 4× más lenta · red simulada 40 ms RTT, 10 Mbps bajada, 5 Mbps subida · 15 ms sincrónicos por query en el server (simula Supabase) · Chrome 155.0.8059.85 headless, 1366×800 · Node v24.19.0 · AMD Ryzen 5 5560U with Radeon Graphics ×12. Una pasada de calentamiento sin registrar antes de las corridas; cada medición en un contexto de navegador nuevo, sin service worker.
**Datos (copia de la base, sede NFPT):** 386 equipos, 5145 eventos de préstamo, 5881 movimientos, 258 tareas, 327 actividades de agenda, 250 tickets.

Valores en ms: **mediana / p95** (p95 por rango más cercano; con n = 7 coincide con el máximo). Entre paréntesis, el tamaño de muestra válida. "–" = no se pudo medir (ver Fallas).

## Inicio de la aplicación

| Métrica | Frío (sin caché) | Caliente (recarga con caché) |
| --- | ---: | ---: |
| FCP (primer pintado con contenido) | 892 / 1236 (7) | 316 / 540 (7) |
| App visible (navegación + main pintados) | 941.7 / 1312.9 (7) | 362.4 / 617.7 (7) |
| Dashboard a la vista (sin pedidos en vuelo ni esqueletos en la ventana) | 1388.8 / 1976.6 (7) | 840.4 / 1227.2 (7) |
| Dashboard con datos (todos los pedidos terminados y pantalla quieta) | 1645.8 / 2125.9 (7) | 1033.6 / 1447 (7) |
| Interactiva (TTI: 5 s sin tareas largas) | 1557.7 / 2123.7 (7) | 1000.5 / 1445.5 (7) |
| TBT (FCP → TTI) | 74 / 212 (7) | 15 / 46 (7) |
| Tareas largas totales (ms) | 575 / 1040 (7) | 123 / 575 (7) |
| DOMContentLoaded | 363 / 452.5 (7) | 144.6 / 160.6 (7) |
| Transferido hasta TTI (KB, corrida 1) | Script 227.8, Stylesheet 60.5, Image 45, Fetch 44.5, Document 1.3, Other 0 | Fetch 13.6, Document 0.3, Script 0, Stylesheet 0, Other 0, Image 0 |

## Cambio de módulo

Click en la navegación → **respuesta** (primer frame con un cambio en `<main>`), **a la vista** (primer frame con cambio en `<main>` sin pedidos de la acción en vuelo ni esqueletos dentro de la ventana: lo que se ve listo aunque abajo del pliegue sigan montándose secciones) y **contenido** (datos cargados y pantalla quieta). 1ª vez = primera visita en la sesión (puede bajar el chunk); 2ª = volver a una pantalla ya vista.

| Pantalla | 1ª respuesta | 1ª a la vista | 1ª contenido | 2ª respuesta | 2ª a la vista | 2ª contenido | Fallas |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Dashboard | 185.2 / 287.3 | 452.9 / 707 | 452.9 / 707 (7) | 157.7 / 235.3 | 421.9 / 590.1 | 421.9 / 590.1 (7) | 0 |
| Préstamos | 376.8 / 485.3 | 955.9 / 1346.6 | 955.9 / 1346.6 (7) | 155.4 / 218.5 | 801.9 / 1072.8 | 801.9 / 1072.8 (7) | 0 |
| Dispositivos | 209 / 224.3 | 427.9 / 547.7 | 427.9 / 547.7 (7) | 139.6 / 217.8 | 393.4 / 591.1 | 393.4 / 591.1 (7) | 0 |
| Inventario | 307.6 / 371.1 | 396.3 / 483.8 | 396.3 / 483.8 (7) | 74.9 / 104.1 | 140.9 / 222.3 | 140.9 / 222.3 (7) | 0 |
| Agenda | 189.8 / 212.8 | 189.8 / 212.8 | 189.8 / 212.8 (7) | 114.3 / 152.9 | 114.3 / 152.9 | 114.3 / 152.9 (7) | 0 |
| Tareas | 123.4 / 225.9 | 357 / 696.4 | 357 / 696.4 (7) | 100.5 / 120.7 | 201.3 / 371.2 | 201.3 / 371.2 (7) | 0 |
| Tickets | 110.4 / 122.3 | 1570.5 / 1714.3 | 1570.5 / 1714.3 (7) | 83.6 / 111 | 1098.1 / 1424.3 | 1098.1 / 1424.3 (7) | 0 |
| Historial | 143.5 / 249.3 | 275.2 / 555.6 | 275.2 / 555.6 (7) | 132.5 / 154.8 | 285 / 322.8 | 285 / 322.8 (7) | 0 |
| Analítica | 102.2 / 154.3 | 955.5 / 1086.8 | 1302.9 / 1432.5 (7) | 70.1 / 88.2 | 794.9 / 1060.9 | 1103.8 / 1347.8 (7) | 0 |
| Configuración | 521.6 / 794 | 835.5 / 921.2 | 835.5 / 921.2 (7) | 266.8 / 352.8 | 690.4 / 789.7 | 690.4 / 789.7 (7) | 0 |

## Búsqueda rápida de personas (Préstamos)

Se tipean 3 letras seguidas en el campo Persona; se mide desde la 3ª tecla hasta el frame pintado con la sugerencia en pantalla. Hoy: `LoanForm` espera 220 ms (debounce) y pide `/api/loans/suggest`; el server lee todo `loan_events` de la sede y filtra en JS.

| Caso | Término | Personas que coinciden | Visible en pantalla | Espera antes del pedido | Pedido (navegador) | Endpoint (Node) | Fallas |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| común | `mic` | 9 | 339.2 / 356.4 (7) | 240 / 243.8 | 70.4 / 78.3 | 51.5 / 52.7 · 1 q | 0 |
| parcial | `cae` | 9 | 336.2 / 344.7 (7) | 240.6 / 244.9 | 69.6 / 74.5 | 50.2 / 53.5 · 1 q | 0 |
| con tilde | `rám` | 6 | 338.7 / 379.9 (7) | 236.9 / 259.5 | 71.2 / 105.1 | 50.7 / 52.3 · 1 q | 0 |
| sin tilde | `ram` | 6 | 326.9 / 353.9 (7) | 237.6 / 241.5 | 69.1 / 96.2 | 51.2 / 53.4 · 1 q | 0 |
| sin resultados | `zqx` | 0 | 337.1 / 341.2 (7) | 241.6 / 252.1 | 68.4 / 79.4 | 50.6 / 99.1 · 1 q | 0 |

En "sin resultados" la columna visible mide hasta que llega la respuesta vacía y se pinta el frame siguiente.

## Búsqueda flexible de equipos (Dispositivos)

`touch 34` (debería encontrar D1436): **83.1 / 113.9 (7)** ms desde la última tecla hasta que la tabla se aquieta · filas 386 → 1 · encontrado en 7/7 corridas.

## Historial

| Acción | ms | Filas |
| --- | ---: | ---: |
| Abrir Historial (primera página) | 609.6 / 657.5 (7) | 50 |
| Cargar más | 220 / 432.2 (7) | 100 |

## Desplazamiento en listas largas

Scroll programático de 120 px por frame, bajando y subiendo, sobre el contenedor que scrollea. Duración entre frames pintados (16,7 ms = 60 fps).

| Lista | Filas | Frames | p50 frame | p95 frame | Peor frame | Frames > 50 ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Dispositivos (tabla abierta entera) | 386 | 588 | 16.7 / 16.7 | 17 / 17.1 (7) | 200.8 / 250.9 | 5 / 6 |
| Historial (hasta 4 páginas) | 200 | 190 | 16.7 / 16.7 | 17.1 / 17.3 (7) | 33.5 / 50.2 | 0 / 2 |

## Operaciones frecuentes

| Operación | UI: click → pantalla quieta | POST (navegador) | API desde Node (POST + ver en /api/devices) | Queries |
| --- | ---: | ---: | ---: | ---: |
| Prestar uno | 468.7 / 656.5 (7) | 174 / 365 | 369.5 / 407.8 | 13 / 15 |
| Devolver uno | 477.6 / 545.1 (7) | 189 / 226 | 384.7 / 400.5 | 14 / 14 |

## API (desde Node, sin red simulada)

Cada endpoint 7 veces con las cachés del server calientes. Ráfaga de arranque (los GET que pide la app al abrir, 6 en paralelo): **555.4 / 612.4 (7)** ms, 22 queries.

| Endpoint | Estado | ms | Queries | KB |
| --- | ---: | ---: | ---: | ---: |
| `/api/auth/session` | 200 | 15.7 / 16.3 | 0 | 0.5 |
| `/api/site-settings` | 200 | 32.3 / 49.2 | 1 | 1.6 |
| `/api/devices` | 200 | 21 / 22.1 | 0 | 311 |
| `/api/movements` | 200 | 47.7 / 49.5 | 1 | 16.4 |
| `/api/agenda` | 200 | 47.7 / 49.9 | 1 | 57.2 |
| `/api/tasks?space=team` | 200 | 98.3 / 142.5 | 4 | 158.7 |
| `/api/notifications` | 200 | 32.7 / 48.6 | 1 | 4.9 |
| `/api/user/prefs` | 200 | 45.5 / 47.7 | 1 | 0 |
| `/api/release-notes/latest` | 200 | 45.8 / 46.6 | 1 | 0 |
| `/api/internal-notes?filter=all` | 200 | 45.7 / 47 | 1 | 0 |
| `/api/loans/previous-day` | 200 | 425.8 / 481.4 | 1 | 2.2 |
| `/api/photo-passes` | 200 | 47.6 / 49.2 | 1 | 5.9 |
| `/api/history?kind=loans&limit=50` | 200 | 46.8 / 48.6 | 1 | 12.9 |
| `/api/history?kind=all&limit=50` | 200 | 50.1 / 52 | 1 | 9 |
| `/api/loans/suggest?q=mic` | 200 | 51.5 / 52.7 | 1 | 1.2 |
| `/api/loans/suggest?q=cae` | 200 | 50.2 / 53.5 | 1 | 1.2 |
| `/api/loans/suggest?q=r%C3%A1m` | 200 | 50.7 / 52.3 | 1 | 0.9 |
| `/api/loans/suggest?q=ram` | 200 | 51.2 / 53.4 | 1 | 0.9 |
| `/api/loans/suggest?q=zqx` | 200 | 50.6 / 99.1 | 1 | 0 |
| `/api/tasks?space=all` | 200 | 113.7 / 127.3 | 4 | 158.7 |
| `/api/settings/shifts` | 200 | 46.7 / 48 | 1 | 0.1 |
| `/api/quick-links` | 200 | 47.1 / 48.3 | 1 | 2.3 |
| `/api/tools/config` | 200 | 156.9 / 202.9 | 8 | 0.1 |
| `/api/internal-notes?filter=active` | 200 | 46.5 / 47.7 | 1 | 0 |
| `/api/recess-schedules` | 200 | 46.2 / 47.7 | 1 | 0.1 |
| `/api/devices?refresh=1` | 200 | 22 / 25.4 | 0 | 311 |
| `/api/photo-passes/options` | 200 | 189 / 204.6 | 7 | 6.9 |
| `/api/inventory/items` | 200 | 63.2 / 80 | 2 | 18.1 |
| `/api/site-assistants` | 200 | 46.2 / 47.4 | 1 | 0.2 |
| `/api/task-columns` | 200 | 40.6 / 46.9 | 1 | 0.3 |
| `/api/tickets` | 200 | 50.1 / 51.3 | 1 | 135.5 |
| `/api/ticket-templates` | 200 | 45.9 / 47.2 | 1 | 0 |
| `/api/classrooms` | 200 | 47.7 / 48.5 | 1 | 21.4 |
| `/api/analytics/parque` | 200 | 108.9 / 125 | 4 | 0.8 |
| `/api/analytics?from=2025-10-20&to=2026-10-20` | 200 | 311.6 / 349.7 | 9 | 1892.7 |
| `/api/notifications/prefs` | 200 | 48.4 / 77 | 2 | 0.2 |
| `/api/invites` | 200 | 46.2 / 47.6 | 1 | 0 |
| `/api/lifecycle/defaults` | 200 | 62.2 / 62.7 | 2 | 0.4 |
| `/api/allowed-users` | 200 | 298.4 / 328.1 | 15 | 2 |
| `/api/sites` | 200 | 46.7 / 47.7 | 1 | 0.7 |

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
node perf/suite.mjs --repo=<checkout> --label=00-inicial-r2 --runs=7 --cpu=4 --latency=15 --rtt=40 --down=10 --up=5
```

Para medir otra rama sin tocar el repo principal: `git worktree add <tmp> <rama>`, junction de `node_modules` (`cmd /c mklink /J node_modules <repo>\node_modules`), correr la suite con `--repo=<tmp>` y `git worktree remove --force <tmp>`. Usá la misma base (`--db=<snapshot>`) en todas las etiquetas que quieras comparar.
