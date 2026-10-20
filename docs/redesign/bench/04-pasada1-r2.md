# Benchmark 04-pasada1-r2

Checkout `` () · 2026-10-20T12:15:41.487Z · generado por `perf/suite.mjs`.

**Condiciones:** 7 corridas por métrica · CPU 4× más lenta · red simulada 40 ms RTT, 10 Mbps bajada, 5 Mbps subida · 15 ms sincrónicos por query en el server (simula Supabase) · Chrome 155.0.8059.85 headless, 1366×800 · Node v24.19.0 · AMD Ryzen 5 5560U with Radeon Graphics ×12. Una pasada de calentamiento sin registrar antes de las corridas; cada medición en un contexto de navegador nuevo, sin service worker.
**Datos (copia de la base, sede NFPT):** 386 equipos, 5145 eventos de préstamo, 5881 movimientos, 258 tareas, 327 actividades de agenda, 250 tickets.

Valores en ms: **mediana / p95** (p95 por rango más cercano; con n = 7 coincide con el máximo). Entre paréntesis, el tamaño de muestra válida. "–" = no se pudo medir (ver Fallas).

## Inicio de la aplicación

| Métrica | Frío (sin caché) | Caliente (recarga con caché) |
| --- | ---: | ---: |
| FCP (primer pintado con contenido) | 1040 / 1348 (7) | 400 / 556 (7) |
| App visible (navegación + main pintados) | 1233.1 / 1507 (7) | 469.9 / 660.1 (7) |
| Dashboard a la vista (sin pedidos en vuelo ni esqueletos en la ventana) | 1699 / 2038.3 (7) | 959 / 1212.5 (7) |
| Dashboard con datos (todos los pedidos terminados y pantalla quieta) | 1699 / 2038.3 (7) | 959 / 1212.5 (7) |
| Interactiva (TTI: 5 s sin tareas largas) | 1687.8 / 2179.3 (7) | 849.1 / 1200.7 (7) |
| TBT (FCP → TTI) | 140 / 251 (7) | 25 / 75 (7) |
| Tareas largas totales (ms) | 732 / 1099 (7) | 248 / 526 (7) |
| DOMContentLoaded | 410.7 / 456.6 (7) | 153.5 / 236.8 (7) |
| Transferido hasta TTI (KB, corrida 1) | Script 426.8, Stylesheet 79.2, Font 52.1, Fetch 34, Document 1.9, Other 1.5, Image 0 | Fetch 3.1, Document 0.3, Script 0, Stylesheet 0, Font 0, Image 0, Other 0 |

## Cambio de módulo

Click en la navegación → **respuesta** (primer frame con un cambio en `<main>`), **a la vista** (primer frame con cambio en `<main>` sin pedidos de la acción en vuelo ni esqueletos dentro de la ventana: lo que se ve listo aunque abajo del pliegue sigan montándose secciones) y **contenido** (datos cargados y pantalla quieta). 1ª vez = primera visita en la sesión (puede bajar el chunk); 2ª = volver a una pantalla ya vista.

| Pantalla | 1ª respuesta | 1ª a la vista | 1ª contenido | 2ª respuesta | 2ª a la vista | 2ª contenido | Fallas |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Dashboard | 194.1 / 249.9 | 277.1 / 336.2 | 277.1 / 336.2 (7) | 203.1 / 224 | 218.5 / 298.6 | 218.5 / 298.6 (7) | 0 |
| Préstamos | 361.6 / 436.5 | 483 / 567.6 | 483 / 567.6 (7) | 157.5 / 207.8 | 232.4 / 318 | 236.9 / 318 (7) | 0 |
| Dispositivos | 212.1 / 233.2 | 385.6 / 421 | 582 / 599.3 (7) | 143 / 184.3 | 309.3 / 392.1 | 496 / 561.8 (7) | 0 |
| Inventario | 129.6 / 143.8 | 232.1 / 249.7 | 232.1 / 249.7 (7) | 96.2 / 119.8 | 173.7 / 176.9 | 173.7 / 176.9 (7) | 0 |
| Agenda | 159.8 / 182.4 | 159.8 / 182.4 | 159.8 / 182.4 (7) | 123.1 / 131.5 | 123.1 / 131.5 | 123.1 / 131.5 (7) | 0 |
| Tareas | 150.1 / 160.3 | 436.3 / 518.2 | 436.3 / 587.9 (7) | 115.3 / 232.3 | 318 / 358.2 | 318 / 358.2 (7) | 0 |
| Tickets | 108.5 / 127.8 | 494.3 / 549.6 | 494.3 / 549.6 (7) | 97.4 / 194.6 | 270.4 / 282.1 | 270.4 / 282.1 (7) | 0 |
| Historial | 98.1 / 134.6 | 348 / 535.2 | 348 / 535.2 (7) | 85.8 / 211.7 | 250.8 / 278.5 | 250.8 / 278.5 (7) | 0 |
| Analítica | 138.1 / 177.2 | 580.7 / 949.6 | 1862.7 / 2282.4 (7) | 210.8 / 233.5 | 443 / 1086.2 | 1345.7 / 1693.9 (7) | 0 |
| Configuración | 115.7 / 165.6 | 115.7 / 165.6 | 115.7 / 165.6 (7) | 104.8 / 129 | 104.8 / 129 | 104.8 / 129 (7) | 0 |

## Búsqueda rápida de personas (Préstamos)

Se tipean 3 letras seguidas en el campo Persona; se mide desde la 3ª tecla hasta el frame pintado con la sugerencia en pantalla. Hoy: `LoanForm` espera 220 ms (debounce) y pide `/api/loans/suggest`; el server lee todo `loan_events` de la sede y filtra en JS.

| Caso | Término | Personas que coinciden | Visible en pantalla | Espera antes del pedido | Pedido (navegador) | Endpoint (Node) | Fallas |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| común | `mic` | 9 | 114.4 / 176.1 (7) | – | – | 11.7 / 19.2 · 0 q | 0 |
| parcial | `cae` | 9 | 104.8 / 114.9 (7) | – | – | 14.6 / 16.9 · 0 q | 0 |
| con tilde | `rám` | 6 | 85.9 / 122.8 (7) | – | – | 4.1 / 17.2 · 0 q | 0 |
| sin tilde | `ram` | 6 | 103 / 131.3 (7) | – | – | 6.8 / 16.8 · 0 q | 0 |
| sin resultados | `zqx` | 0 | 0 / 2577.8 (7) | 2326.3 / 2326.3 | 204.3 / 204.3 | 15.8 / 17.8 · 0 q | 0 |

En "sin resultados" la columna visible mide hasta que llega la respuesta vacía y se pinta el frame siguiente.

## Búsqueda flexible de equipos (Dispositivos)

`touch 34` (debería encontrar D1436): **130.9 / 134 (7)** ms desde la última tecla hasta que la tabla se aquieta · filas 387 → 2 · encontrado en 7/7 corridas.

## Historial

| Acción | ms | Filas |
| --- | ---: | ---: |
| Abrir Historial (primera página) | 626.2 / 674.1 (7) | 56 |
| Cargar más | 379 / 399.7 (7) | 109 |

## Desplazamiento en listas largas

Scroll programático de 120 px por frame, bajando y subiendo, sobre el contenedor que scrollea. Duración entre frames pintados (16,7 ms = 60 fps).

| Lista | Filas | Frames | p50 frame | p95 frame | Peor frame | Frames > 50 ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Dispositivos (tabla abierta entera) | 387 | 296 | 16.7 / 16.7 | 33.5 / 50.2 (7) | 735.9 / 802.9 | 4 / 31 |
| Historial (hasta 4 páginas) | 215 | 182 | 16.7 / 16.7 | 16.9 / 17 (7) | 200.7 / 200.8 | 1 / 1 |

## Operaciones frecuentes

| Operación | UI: click → pantalla quieta | POST (navegador) | API desde Node (POST + ver en /api/devices) | Queries |
| --- | ---: | ---: | ---: | ---: |
| Prestar uno | 567.5 / 674.9 (7) | 191 / 236 | 308.8 / 351.2 | 13 / 13 |
| Devolver uno | 475.7 / 512.3 (7) | 188 / 211 | 310.3 / 360.8 | 14 / 14 |

## API (desde Node, sin red simulada)

Cada endpoint 7 veces con las cachés del server calientes. Ráfaga de arranque (los GET que pide la app al abrir, 6 en paralelo): **551.6 / 571 (7)** ms, 23 queries.

| Endpoint | Estado | ms | Queries | KB |
| --- | ---: | ---: | ---: | ---: |
| `/api/auth/session` | 200 | 14.2 / 16.7 | 0 | 0.5 |
| `/api/site-settings` | 200 | 32.7 / 48.3 | 1 | 1.6 |
| `/api/devices` | 200 | 18.7 / 23.7 | 0 | 311 |
| `/api/movements` | 200 | 29.9 / 47.4 | 1 | 16.4 |
| `/api/agenda` | 200 | 36.8 / 39.5 | 1 | 57.2 |
| `/api/tasks?space=team` | 200 | 93.4 / 120.4 | 4 | 158.7 |
| `/api/notifications` | 200 | 32.6 / 44.7 | 1 | 4.9 |
| `/api/user/prefs` | 200 | 31.9 / 47.6 | 1 | 0 |
| `/api/release-notes/latest` | 200 | 32.9 / 50.1 | 1 | 0 |
| `/api/internal-notes?filter=all` | 200 | 32.9 / 47.2 | 1 | 0 |
| `/api/loans/previous-day` | 200 | 17.2 / 17.7 | 0 | 2.2 |
| `/api/photo-passes` | 200 | 34.8 / 49 | 1 | 5.9 |
| `/api/history?kind=loans&limit=50` | 200 | 34.3 / 36.7 | 1 | 12.9 |
| `/api/history?kind=all&limit=50` | 200 | 36.1 / 67.3 | 1 | 9 |
| `/api/loans/suggest?q=mic` | 200 | 11.7 / 19.2 | 0 | 1.2 |
| `/api/loans/suggest?q=cae` | 200 | 14.6 / 16.9 | 0 | 1.2 |
| `/api/loans/suggest?q=r%C3%A1m` | 200 | 4.1 / 17.2 | 0 | 0.9 |
| `/api/loans/suggest?q=ram` | 200 | 6.8 / 16.8 | 0 | 0.9 |
| `/api/loans/suggest?q=zqx` | 200 | 15.8 / 17.8 | 0 | 0 |
| `/api/settings/shifts` | 200 | 34.3 / 45.2 | 1 | 0.1 |
| `/api/tasks?space=all` | 200 | 90 / 104.7 | 4 | 158.7 |
| `/api/recess-schedules` | 200 | 50.7 / 64.4 | 2 | 0.1 |
| `/api/internal-notes?filter=active` | 200 | 33 / 34.4 | 1 | 0 |
| `/api/quick-links` | 200 | 33.8 / 35.4 | 1 | 2.4 |
| `/api/tools/config` | 200 | 151.3 / 170.6 | 8 | 0.1 |
| `/api/loans/people` | 200 | 12 / 19 | 0 | 57.2 |
| `/api/device-groups` | 200 | 33.6 / 47.7 | 1 | 0 |
| `/api/devices/deleted` | 200 | 33.1 / 47.6 | 1 | 0.2 |
| `/api/inventory/items` | 200 | 54.4 / 64.6 | 2 | 18.1 |
| `/api/task-columns` | 200 | 33.1 / 49.6 | 1 | 0.3 |
| `/api/site-assistants` | 200 | 32.1 / 47.7 | 1 | 0.2 |
| `/api/tickets` | 200 | 35.1 / 51.3 | 1 | 135.5 |
| `/api/ticket-templates` | 200 | 32.5 / 50.3 | 1 | 0 |
| `/api/classrooms` | 200 | 47.9 / 80.9 | 1 | 21.4 |
| `/api/analytics?from=2025-10-20&to=2026-10-20` | 200 | 168.9 / 184.9 | 4 | 112.6 |
| `/api/analytics/parque` | 200 | 98.8 / 100.4 | 4 | 0.8 |
| `/api/allowed-users` | 200 | 72.1 / 82.5 | 3 | 2.3 |
| `/api/invites` | 200 | 32.7 / 47.3 | 1 | 0 |

## Tamaños del build

| Recurso | Crudo (KB) | gzip (KB) |
| --- | ---: | ---: |
| JS inicial (entry + modulepreload) | 294.6 | 94 |
| CSS inicial | 85.9 | 15 |
| Fuentes precargadas | 28.7 | 28.7 |
| **Total crítico** (HTML + JS + CSS + fuentes precargadas) |  | **139.3** |
| Todo el JS de dist/assets (79 archivos) | 1359.5 | 455 |
| Todo el CSS de dist/assets (25 archivos) | 402 | 75 |

Crítico: `index.html` 1.6 KB, `assets/index-CVL0EBF9.js` 94 KB, `assets/index-aYIKyorj.css` 15 KB, `assets/geist-latin-wght-normal-BgDaEnEv.woff2` 28.7 KB.

## Fallas

Ninguna.

## Cómo reproducir

```bash
node perf/suite.mjs --repo=<checkout> --label=04-pasada1-r2 --runs=7 --cpu=4 --latency=15 --rtt=40 --down=10 --up=5
```

Para medir otra rama sin tocar el repo principal: `git worktree add <tmp> <rama>`, junction de `node_modules` (`cmd /c mklink /J node_modules <repo>\node_modules`), correr la suite con `--repo=<tmp>` y `git worktree remove --force <tmp>`. Usá la misma base (`--db=<snapshot>`) en todas las etiquetas que quieras comparar.
