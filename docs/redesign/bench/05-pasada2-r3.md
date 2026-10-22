# Benchmark 05-pasada2-r3

Checkout `` () · 2026-10-22T13:36:08.429Z · generado por `perf/suite.mjs`.

**Condiciones:** 7 corridas por métrica · CPU 4× más lenta · red simulada 40 ms RTT, 10 Mbps bajada, 5 Mbps subida · 15 ms sincrónicos por query en el server (simula Supabase) · Chrome 155.0.8059.85 headless, 1366×800 · Node v24.19.0 · AMD Ryzen 5 5560U with Radeon Graphics ×12. Una pasada de calentamiento sin registrar antes de las corridas; cada medición en un contexto de navegador nuevo, sin service worker.
**Datos (copia de la base, sede NFPT):** 386 equipos, 5145 eventos de préstamo, 5881 movimientos, 258 tareas, 327 actividades de agenda, 250 tickets.

Valores en ms: **mediana / p95** (p95 por rango más cercano; con n = 7 coincide con el máximo). Entre paréntesis, el tamaño de muestra válida. "–" = no se pudo medir (ver Fallas).

## Inicio de la aplicación

| Métrica | Frío (sin caché) | Caliente (recarga con caché) |
| --- | ---: | ---: |
| FCP (primer pintado con contenido) | 740 / 904 (7) | 396 / 528 (7) |
| App visible (navegación + main pintados) | 857.8 / 1013.3 (7) | 443.1 / 602.3 (7) |
| Dashboard a la vista (sin pedidos en vuelo ni esqueletos en la ventana) | 1560.5 / 1720.9 (7) | 972.9 / 1097 (7) |
| Dashboard con datos (todos los pedidos terminados y pantalla quieta) | 1560.5 / 1720.9 (7) | 972.9 / 1097 (7) |
| Interactiva (TTI: 5 s sin tareas largas) | 1489.7 / 1670.4 (7) | 924.4 / 1048 (7) |
| TBT (FCP → TTI) | 246 / 365 (7) | 164 / 216 (7) |
| Tareas largas totales (ms) | 859 / 974 (7) | 422 / 551 (7) |
| DOMContentLoaded | 419.5 / 431.4 (7) | 168.4 / 192.2 (7) |
| Transferido hasta TTI (KB, corrida 1) | Script 426.3, Stylesheet 79.2, Font 52.1, Fetch 34.1, Document 1.9, Image 1.5, Other 0 | Fetch 3.1, Document 0.3, Script 0, Stylesheet 0, Font 0, Image 0, Other 0 |

## Cambio de módulo

Click en la navegación → **respuesta** (primer frame con un cambio en `<main>`), **a la vista** (primer frame con cambio en `<main>` sin pedidos de la acción en vuelo ni esqueletos dentro de la ventana: lo que se ve listo aunque abajo del pliegue sigan montándose secciones) y **contenido** (datos cargados y pantalla quieta). 1ª vez = primera visita en la sesión (puede bajar el chunk); 2ª = volver a una pantalla ya vista.

| Pantalla | 1ª respuesta | 1ª a la vista | 1ª contenido | 2ª respuesta | 2ª a la vista | 2ª contenido | Fallas |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Dashboard | 215.6 / 327.5 | 298.1 / 408.5 | 298.1 / 408.5 (7) | 221.8 / 356.5 | 278 / 429.4 | 278 / 429.4 (7) | 0 |
| Préstamos | 436.9 / 762.3 | 543.5 / 868.6 | 543.5 / 868.6 (7) | 173.8 / 311.7 | 252.9 / 441.8 | 252.9 / 441.8 (7) | 0 |
| Dispositivos | 229 / 357.4 | 398.8 / 586.2 | 582.1 / 745.6 (7) | 144.8 / 162.6 | 313 / 383 | 535.3 / 552.7 (7) | 0 |
| Inventario | 157.8 / 161.6 | 242.2 / 274.3 | 242.2 / 274.3 (7) | 102.9 / 111.6 | 181.6 / 198.9 | 181.6 / 198.9 (7) | 0 |
| Agenda | 163.4 / 263.2 | 163.4 / 263.2 | 163.4 / 263.2 (7) | 104.4 / 161.3 | 104.4 / 161.3 | 104.4 / 161.3 (7) | 0 |
| Tareas | 353.8 / 483.2 | 467.6 / 606.2 | 467.6 / 606.2 (7) | 274.6 / 302.5 | 294.3 / 454.2 | 294.3 / 454.2 (7) | 0 |
| Tickets | 112.6 / 146.2 | 429.1 / 497.5 | 429.1 / 497.5 (7) | 94.8 / 134.8 | 277.6 / 339.3 | 277.6 / 339.3 (7) | 0 |
| Historial | 108.5 / 152.2 | 418.3 / 459.6 | 418.3 / 459.6 (7) | 93.7 / 152.7 | 276.1 / 587 | 276.1 / 587 (7) | 0 |
| Analítica | 152.8 / 193.9 | 717 / 924 | 2102.9 / 2381.5 (7) | 121.6 / 236.1 | 802.9 / 1368.1 | 1715.8 / 1896.9 (7) | 0 |
| Configuración | 127.1 / 302.5 | 127.1 / 302.5 | 127.1 / 302.5 (7) | 135.6 / 159.3 | 135.6 / 159.3 | 135.6 / 159.3 (7) | 0 |

## Búsqueda rápida de personas (Préstamos)

Se tipean 3 letras seguidas en el campo Persona; se mide desde la 3ª tecla hasta el frame pintado con la sugerencia en pantalla. Hoy: `LoanForm` espera 220 ms (debounce) y pide `/api/loans/suggest`; el server lee todo `loan_events` de la sede y filtra en JS.

| Caso | Término | Personas que coinciden | Visible en pantalla | Espera antes del pedido | Pedido (navegador) | Endpoint (Node) | Fallas |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| común | `mic` | 9 | 110.5 / 119 (7) | – | – | 16.3 / 20.6 · 0 q | 0 |
| parcial | `cae` | 9 | 123.3 / 167.2 (7) | – | – | 17 / 18 · 0 q | 0 |
| con tilde | `rám` | 6 | 96.6 / 127.6 (7) | – | – | 16.5 / 18.1 · 0 q | 0 |
| sin tilde | `ram` | 6 | 96.2 / 141.6 (7) | – | – | 16.5 / 16.7 · 0 q | 0 |
| sin resultados | `zqx` | 0 | 0 / 0 (7) | – | – | 16.9 / 20.2 · 0 q | 0 |

En "sin resultados" la columna visible mide hasta que llega la respuesta vacía y se pinta el frame siguiente.

## Búsqueda flexible de equipos (Dispositivos)

`touch 34` (debería encontrar D1436): **128.3 / 197.9 (7)** ms desde la última tecla hasta que la tabla se aquieta · filas 387 → 2 · encontrado en 7/7 corridas.

## Historial

| Acción | ms | Filas |
| --- | ---: | ---: |
| Abrir Historial (primera página) | 578.8 / 639.1 (7) | 56 |
| Cargar más | 397.6 / 510.4 (7) | 110 |

## Desplazamiento en listas largas

Scroll programático de 120 px por frame, bajando y subiendo, sobre el contenedor que scrollea. Duración entre frames pintados (16,7 ms = 60 fps).

| Lista | Filas | Frames | p50 frame | p95 frame | Peor frame | Frames > 50 ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Dispositivos (tabla abierta entera) | 387 | 296 | 16.7 / 16.8 | 49.8 / 50.2 (7) | 936.8 / 1104 | 14 / 25 |
| Historial (hasta 4 páginas) | 216 | 182 | 16.7 / 16.7 | 16.9 / 17.2 (7) | 267.5 / 401.4 | 1 / 1 |

## Operaciones frecuentes

| Operación | UI: click → pantalla quieta | POST (navegador) | API desde Node (POST + ver en /api/devices) | Queries |
| --- | ---: | ---: | ---: | ---: |
| Prestar uno | 466.2 / 574.1 (7) | 147 / 305 | 90.9 / 108.5 | 3 / 3 |
| Devolver uno | 344.3 / 413.1 (7) | 144 / 202 | 108.6 / 125.8 | 4 / 4 |

## API (desde Node, sin red simulada)

Cada endpoint 7 veces con las cachés del server calientes. Ráfaga de arranque (los GET que pide la app al abrir, 6 en paralelo): **320.5 / 398.8 (7)** ms, 11 queries.

| Endpoint | Estado | ms | Queries | KB |
| --- | ---: | ---: | ---: | ---: |
| `/api/auth/session` | 200 | 13.7 / 17.3 | 0 | 0.5 |
| `/api/site-settings` | 200 | 33.3 / 49.4 | 1 | 1.6 |
| `/api/devices` | 200 | 10.7 / 20.2 | 0 | 311 |
| `/api/movements` | 200 | 49.5 / 56.5 | 1 | 16.4 |
| `/api/agenda` | 200 | 35.2 / 43.8 | 1 | 57.3 |
| `/api/tasks?space=team` | 200 | 20.3 / 105.5 | 0 | 159 |
| `/api/notifications` | 200 | 31.5 / 35.7 | 1 | 4.9 |
| `/api/user/prefs` | 200 | 32.9 / 47 | 1 | 0 |
| `/api/release-notes/latest` | 200 | 32.5 / 33.5 | 1 | 0 |
| `/api/internal-notes?filter=all` | 200 | 34 / 45.2 | 1 | 0 |
| `/api/loans/previous-day` | 200 | 6.8 / 18 | 0 | 0.3 |
| `/api/photo-passes` | 200 | 32.9 / 51.3 | 1 | 5.9 |
| `/api/history?kind=loans&limit=50` | 200 | 39.3 / 49.8 | 1 | 12.9 |
| `/api/history?kind=all&limit=50` | 200 | 51.4 / 53.5 | 1 | 9 |
| `/api/loans/suggest?q=mic` | 200 | 16.3 / 20.6 | 0 | 1.2 |
| `/api/loans/suggest?q=cae` | 200 | 17 / 18 | 0 | 1.2 |
| `/api/loans/suggest?q=r%C3%A1m` | 200 | 16.5 / 18.1 | 0 | 0.9 |
| `/api/loans/suggest?q=ram` | 200 | 16.5 / 16.7 | 0 | 0.9 |
| `/api/loans/suggest?q=zqx` | 200 | 16.9 / 20.2 | 0 | 0 |
| `/api/settings/shifts` | 200 | 32.5 / 35.7 | 1 | 0.1 |
| `/api/tasks?space=all` | 200 | 6.8 / 21.5 | 0 | 159 |
| `/api/quick-links` | 200 | 33.3 / 47.9 | 1 | 2.4 |
| `/api/tools/config` | 200 | 33.5 / 46.4 | 1 | 0.2 |
| `/api/recess-schedules` | 200 | 32.4 / 37.5 | 1 | 0.1 |
| `/api/internal-notes?filter=active` | 200 | 33.7 / 45.3 | 1 | 0 |
| `/api/loans/people` | 200 | 17.1 / 20.7 | 0 | 57.2 |
| `/api/devices/panel-counts` | 200 | 32.8 / 35 | 1 | 0 |
| `/api/inventory/items` | 200 | 52 / 68.8 | 2 | 18.1 |
| `/api/task-columns` | 200 | 33.1 / 49.3 | 1 | 0.3 |
| `/api/site-assistants` | 200 | 33.6 / 48.2 | 1 | 0.2 |
| `/api/tickets` | 200 | 33.4 / 38.3 | 1 | 135.5 |
| `/api/ticket-templates` | 200 | 30.2 / 34.4 | 1 | 0 |
| `/api/classrooms` | 200 | 48.5 / 52.1 | 1 | 21.4 |
| `/api/analytics?from=2025-10-22&to=2026-10-22` | 200 | 165.1 / 256.5 | 4 | 112.6 |
| `/api/analytics/parque` | 200 | 100.1 / 115 | 4 | 0.8 |
| `/api/allowed-users` | 200 | 65.5 / 67 | 3 | 2.3 |
| `/api/invites` | 200 | 32 / 48.3 | 1 | 0 |

## Tamaños del build

| Recurso | Crudo (KB) | gzip (KB) |
| --- | ---: | ---: |
| JS inicial (entry + modulepreload) | 295.4 | 94.3 |
| CSS inicial | 85.9 | 15 |
| Fuentes precargadas | 28.7 | 28.7 |
| **Total crítico** (HTML + JS + CSS + fuentes precargadas) |  | **139.6** |
| Todo el JS de dist/assets (79 archivos) | 1360.4 | 455.3 |
| Todo el CSS de dist/assets (25 archivos) | 402 | 75 |

Crítico: `index.html` 1.6 KB, `assets/index-Ch_x24tB.js` 94.3 KB, `assets/index-aYIKyorj.css` 15 KB, `assets/geist-latin-wght-normal-BgDaEnEv.woff2` 28.7 KB.

## Fallas

Ninguna.

## Cómo reproducir

```bash
node perf/suite.mjs --repo=<checkout> --label=05-pasada2-r3 --runs=7 --cpu=4 --latency=15 --rtt=40 --down=10 --up=5
```

Para medir otra rama sin tocar el repo principal: `git worktree add <tmp> <rama>`, junction de `node_modules` (`cmd /c mklink /J node_modules <repo>\node_modules`), correr la suite con `--repo=<tmp>` y `git worktree remove --force <tmp>`. Usá la misma base (`--db=<snapshot>`) en todas las etiquetas que quieras comparar.
