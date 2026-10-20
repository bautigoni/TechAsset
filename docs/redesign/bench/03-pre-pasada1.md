# Benchmark 03-pre-pasada1

Checkout `54ac7af docs: protocolo de las tres pasadas de rendimiento` (54ac7af, HEAD) · 2026-10-20T03:23:42.718Z · generado por `perf/suite.mjs`.

**Condiciones:** 7 corridas por métrica · CPU 4× más lenta · red simulada 40 ms RTT, 10 Mbps bajada, 5 Mbps subida · 15 ms sincrónicos por query en el server (simula Supabase) · Chrome 155.0.8059.84 headless, 1366×800 · Node v24.19.0 · AMD Ryzen 5 5560U with Radeon Graphics ×12. Una pasada de calentamiento sin registrar antes de las corridas; cada medición en un contexto de navegador nuevo, sin service worker.
**Datos (copia de la base, sede NFPT):** 386 equipos, 5145 eventos de préstamo, 5881 movimientos, 258 tareas, 327 actividades de agenda, 250 tickets.

Valores en ms: **mediana / p95** (p95 por rango más cercano; con n = 7 coincide con el máximo). Entre paréntesis, el tamaño de muestra válida. "–" = no se pudo medir (ver Fallas).

## Inicio de la aplicación

| Métrica | Frío (sin caché) | Caliente (recarga con caché) |
| --- | ---: | ---: |
| FCP (primer pintado con contenido) | 1228 / 1316 (7) | 420 / 440 (7) |
| App visible (navegación + main pintados) | 1341.5 / 1417.6 (7) | 494 / 526.8 (7) |
| Dashboard con datos (todos los pedidos terminados y pantalla quieta) | 3687 / 3850.2 (7) | 1362.2 / 1399.6 (7) |
| Interactiva (TTI: 5 s sin tareas largas) | 1949.9 / 2039.2 (7) | 1068.9 / 1115.8 (7) |
| TBT (FCP → TTI) | 97 / 306 (7) | 30 / 41 (7) |
| Tareas largas totales (ms) | 743 / 865 (7) | 255 / 284 (7) |
| DOMContentLoaded | 435.8 / 445.1 (7) | 157.7 / 169.3 (7) |
| Transferido hasta TTI (KB, corrida 1) | Script 425.5, Stylesheet 79.2, Font 52.1, Fetch 44.9, Document 1.9, Other 1.5, Image 0 | Fetch 13.6, Document 0.3, Script 0, Stylesheet 0, Font 0, Image 0, Other 0 |

## Cambio de módulo

Click en la navegación → **respuesta** (primer frame con un cambio en `<main>`) y **contenido** (datos cargados y pantalla quieta). 1ª vez = primera visita en la sesión (puede bajar el chunk); 2ª = volver a una pantalla ya vista.

| Pantalla | 1ª respuesta | 1ª contenido | 2ª respuesta | 2ª contenido | Fallas |
| --- | ---: | ---: | ---: | ---: | ---: |
| Dashboard | 194.4 / 210.7 | 266 / 288.9 (7) | 184.7 / 195.1 | 264.6 / 285 (7) | 0 |
| Préstamos | 343.3 / 365.8 | 1186.1 / 1204.3 (7) | 162.3 / 189.5 | 912.5 / 1109.8 (7) | 0 |
| Dispositivos | 209.2 / 226.7 | 553.7 / 611.1 (7) | 146.3 / 170.3 | 505.4 / 520.6 (7) | 0 |
| Inventario | 124.4 / 127.6 | 215.9 / 219.6 (7) | 98.2 / 133.4 | 179.4 / 240.3 (7) | 0 |
| Agenda | 157.1 / 174 | 157.1 / 174 (7) | 116.9 / 135.3 | 116.9 / 135.3 (7) | 0 |
| Tareas | 143.6 / 157 | 454.3 / 493.7 (7) | 104.2 / 114.5 | 317.2 / 391.5 (7) | 0 |
| Tickets | 108.3 / 126.9 | 534.6 / 625.5 (7) | 89.2 / 91.2 | 267.7 / 397.4 (7) | 0 |
| Historial | 96.3 / 107.8 | 336.6 / 352.7 (7) | 76.1 / 79.3 | 251.3 / 284.7 (7) | 0 |
| Analítica | 126.9 / 137.6 | 1776.1 / 1822.9 (7) | 105.7 / 126.1 | 1454.6 / 1573.9 (7) | 0 |
| Configuración | 122.4 / 140.1 | 122.4 / 140.1 (7) | 101.7 / 112.9 | 101.7 / 112.9 (7) | 0 |

## Búsqueda rápida de personas (Préstamos)

Se tipean 3 letras seguidas en el campo Persona; se mide desde la 3ª tecla hasta el frame pintado con la sugerencia en pantalla. Hoy: `LoanForm` espera 220 ms (debounce) y pide `/api/loans/suggest`; el server lee todo `loan_events` de la sede y filtra en JS.

| Caso | Término | Personas que coinciden | Visible en pantalla | Espera antes del pedido | Pedido (navegador) | Endpoint (Node) | Fallas |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| común | `mic` | 9 | 368.8 / 372.3 (7) | 236.5 / 250.7 | 71.5 / 74.9 | 41.2 / 56.5 · 1 q | 0 |
| parcial | `cae` | 9 | 359.1 / 371.3 (7) | 234.6 / 248.4 | 68.1 / 75.7 | 40.1 / 58 · 1 q | 0 |
| con tilde | `rám` | 6 | 362 / 377.1 (7) | 235.2 / 238 | 74 / 74.7 | 38.4 / 40.6 · 1 q | 0 |
| sin tilde | `ram` | 6 | 362.4 / 372.5 (7) | 236.6 / 238.9 | 72.4 / 74.9 | 39.8 / 56.3 · 1 q | 0 |
| sin resultados | `zqx` | 0 | 339.2 / 427.8 (7) | 234.3 / 249.8 | 73.7 / 165 | 53.2 / 55.6 · 1 q | 0 |

En "sin resultados" la columna visible mide hasta que llega la respuesta vacía y se pinta el frame siguiente.

## Búsqueda flexible de equipos (Dispositivos)

`touch 34` (debería encontrar D1436): **127.6 / 135.2 (7)** ms desde la última tecla hasta que la tabla se aquieta · filas 387 → 2 · encontrado en 7/7 corridas.

## Historial

| Acción | ms | Filas |
| --- | ---: | ---: |
| Abrir Historial (primera página) | 410.9 / 461.8 (7) | 56 |
| Cargar más | 372.2 / 406.4 (7) | 109 |

## Desplazamiento en listas largas

Scroll programático de 120 px por frame, bajando y subiendo, sobre el contenedor que scrollea. Duración entre frames pintados (16,7 ms = 60 fps).

| Lista | Filas | Frames | p50 frame | p95 frame | Peor frame | Frames > 50 ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Dispositivos (tabla abierta entera) | 387 | 296 | 71.4 / 71.6 | 104 / 105.5 (7) | 125.2 / 193 | 295 / 296 |
| Historial (hasta 4 páginas) | 215 | 182 | 17.7 / 18 | 18.2 / 18.3 (7) | 54.4 / 71.1 | 5 / 5 |

## Operaciones frecuentes

| Operación | UI: click → pantalla quieta | POST (navegador) | API desde Node (POST + ver en /api/devices) | Queries |
| --- | ---: | ---: | ---: | ---: |
| Prestar uno | 601.3 / 632.3 (7) | 193 / 213 | 330.6 / 345.1 | 13 / 13 |
| Devolver uno | 512.1 / 520.6 (7) | 201 / 223 | 345.5 / 357 | 14 / 14 |

## API (desde Node, sin red simulada)

Cada endpoint 7 veces con las cachés del server calientes. Ráfaga de arranque (los GET que pide la app al abrir, 6 en paralelo): **558.4 / 605.1 (7)** ms, 23 queries.

| Endpoint | Estado | ms | Queries | KB |
| --- | ---: | ---: | ---: | ---: |
| `/api/auth/session` | 200 | 15.9 / 16.2 | 0 | 0.5 |
| `/api/site-settings` | 200 | 32.6 / 32.7 | 1 | 1.6 |
| `/api/devices` | 200 | 22.6 / 23.6 | 0 | 311 |
| `/api/movements` | 200 | 33.3 / 49.3 | 1 | 16.4 |
| `/api/agenda` | 200 | 33.8 / 49.6 | 1 | 57.2 |
| `/api/tasks?space=team` | 200 | 85.1 / 102.1 | 4 | 158.7 |
| `/api/notifications` | 200 | 32.6 / 48.2 | 1 | 4.9 |
| `/api/user/prefs` | 200 | 31.9 / 47.5 | 1 | 0 |
| `/api/release-notes/latest` | 200 | 32 / 46.1 | 1 | 0 |
| `/api/internal-notes?filter=all` | 200 | 31.7 / 46.9 | 1 | 0 |
| `/api/loans/previous-day` | 200 | 660.8 / 1093.8 | 1 | 1.2 |
| `/api/photo-passes` | 200 | 32.5 / 47.7 | 1 | 5.9 |
| `/api/history?kind=loans&limit=50` | 200 | 47.7 / 48.7 | 1 | 12.9 |
| `/api/history?kind=all&limit=50` | 200 | 50.3 / 85 | 1 | 9 |
| `/api/loans/suggest?q=mic` | 200 | 41.2 / 56.5 | 1 | 1.2 |
| `/api/loans/suggest?q=cae` | 200 | 40.1 / 58 | 1 | 1.2 |
| `/api/loans/suggest?q=r%C3%A1m` | 200 | 38.4 / 40.6 | 1 | 0.9 |
| `/api/loans/suggest?q=ram` | 200 | 39.8 / 56.3 | 1 | 0.9 |
| `/api/loans/suggest?q=zqx` | 200 | 53.2 / 55.6 | 1 | 0 |
| `/api/settings/shifts` | 200 | 32 / 47.5 | 1 | 0.1 |
| `/api/tasks?space=all` | 200 | 84.3 / 85.9 | 4 | 158.7 |
| `/api/recess-schedules` | 200 | 62.9 / 64.2 | 2 | 0.1 |
| `/api/internal-notes?filter=active` | 200 | 47.4 / 47.8 | 1 | 0 |
| `/api/quick-links` | 200 | 32.4 / 47.4 | 1 | 2.4 |
| `/api/tools/config` | 200 | 142.6 / 143.4 | 8 | 0.2 |
| `/api/devices?refresh=1` | 200 | 22.7 / 23.7 | 0 | 311 |
| `/api/photo-passes/options` | 200 | 160.3 / 176.2 | 7 | 6.9 |
| `/api/device-groups` | 200 | 31.6 / 47.5 | 1 | 0 |
| `/api/devices/deleted` | 200 | 32 / 32.4 | 1 | 0.2 |
| `/api/inventory/items` | 200 | 63.6 / 64.6 | 2 | 18.1 |
| `/api/task-columns` | 200 | 31.8 / 47.8 | 1 | 0.3 |
| `/api/site-assistants` | 200 | 31.8 / 48 | 1 | 0.2 |
| `/api/tickets` | 200 | 36.7 / 51.5 | 1 | 135.5 |
| `/api/ticket-templates` | 200 | 31.9 / 47.1 | 1 | 0 |
| `/api/classrooms` | 200 | 48.4 / 48.9 | 1 | 21.4 |
| `/api/analytics?from=2025-10-20&to=2026-10-20` | 200 | 192 / 209.1 | 4 | 112.6 |
| `/api/analytics/parque` | 200 | 95.6 / 110.9 | 4 | 0.8 |
| `/api/allowed-users` | 200 | 64.2 / 79.7 | 3 | 2.3 |
| `/api/invites` | 200 | 32 / 46.4 | 1 | 0 |

## Tamaños del build

| Recurso | Crudo (KB) | gzip (KB) |
| --- | ---: | ---: |
| JS inicial (entry + modulepreload) | 293.6 | 93.7 |
| CSS inicial | 85.8 | 15 |
| Fuentes precargadas | 28.7 | 28.7 |
| **Total crítico** (HTML + JS + CSS + fuentes precargadas) |  | **139** |
| Todo el JS de dist/assets (79 archivos) | 1356.9 | 453.8 |
| Todo el CSS de dist/assets (25 archivos) | 401.9 | 75 |

Crítico: `index.html` 1.6 KB, `assets/index-BE2ecvSL.js` 93.7 KB, `assets/index-CrVh3YjT.css` 15 KB, `assets/geist-latin-wght-normal-BgDaEnEv.woff2` 28.7 KB.

## Fallas

Ninguna.

## Cómo reproducir

```bash
node perf/suite.mjs --repo=<checkout> --label=03-pre-pasada1 --runs=7 --cpu=4 --latency=15 --rtt=40 --down=10 --up=5
```

Para medir otra rama sin tocar el repo principal: `git worktree add <tmp> <rama>`, junction de `node_modules` (`cmd /c mklink /J node_modules <repo>\node_modules`), correr la suite con `--repo=<tmp>` y `git worktree remove --force <tmp>`. Usá la misma base (`--db=<snapshot>`) en todas las etiquetas que quieras comparar.
