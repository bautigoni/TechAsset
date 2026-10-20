# Benchmark 04-pasada1

Checkout `f65843f pg-smoke: chequea directorio de personas, sugerencias, día anterior, opciones de cartelitos y recordatorio por evento` (f65843f, worktree-agent-a2b973c53ac59b620) · 2026-10-20T06:49:44.254Z · generado por `perf/suite.mjs`.

**Condiciones:** 7 corridas por métrica · CPU 4× más lenta · red simulada 40 ms RTT, 10 Mbps bajada, 5 Mbps subida · 15 ms sincrónicos por query en el server (simula Supabase) · Chrome 155.0.8059.85 headless, 1366×800 · Node v24.19.0 · AMD Ryzen 5 5560U with Radeon Graphics ×12. Una pasada de calentamiento sin registrar antes de las corridas; cada medición en un contexto de navegador nuevo, sin service worker.
**Datos (copia de la base, sede NFPT):** 386 equipos, 5145 eventos de préstamo, 5881 movimientos, 258 tareas, 327 actividades de agenda, 250 tickets.

Valores en ms: **mediana / p95** (p95 por rango más cercano; con n = 7 coincide con el máximo). Entre paréntesis, el tamaño de muestra válida. "–" = no se pudo medir (ver Fallas).

## Inicio de la aplicación

| Métrica | Frío (sin caché) | Caliente (recarga con caché) |
| --- | ---: | ---: |
| FCP (primer pintado con contenido) | 1044 / 1192 (7) | 424 / 476 (7) |
| App visible (navegación + main pintados) | 1288.2 / 1312.8 (7) | 511 / 543.7 (7) |
| Dashboard con datos (todos los pedidos terminados y pantalla quieta) | 1740.2 / 1817.4 (7) | 1017.2 / 1127.9 (7) |
| Interactiva (TTI: 5 s sin tareas largas) | 1712.8 / 1936.6 (7) | 907.8 / 972.4 (7) |
| TBT (FCP → TTI) | 188 / 288 (7) | 37 / 50 (7) |
| Tareas largas totales (ms) | 720 / 845 (7) | 280 / 354 (7) |
| DOMContentLoaded | 419.4 / 445.5 (7) | 161.9 / 186.8 (7) |
| Transferido hasta TTI (KB, corrida 1) | Script 426.8, Stylesheet 79.2, Font 52.1, Fetch 34, Document 1.9, Other 1.5, Image 0 | Fetch 3.1, Document 0.3, Script 0, Stylesheet 0, Font 0, Image 0, Other 0 |

## Cambio de módulo

Click en la navegación → **respuesta** (primer frame con un cambio en `<main>`) y **contenido** (datos cargados y pantalla quieta). 1ª vez = primera visita en la sesión (puede bajar el chunk); 2ª = volver a una pantalla ya vista.

| Pantalla | 1ª respuesta | 1ª contenido | 2ª respuesta | 2ª contenido | Fallas |
| --- | ---: | ---: | ---: | ---: | ---: |
| Dashboard | 209.3 / 246.4 | 301.8 / 337.7 (7) | 215.4 / 244.5 | 282.9 / 358.3 (7) | 0 |
| Préstamos | 380.5 / 395.2 | 483.4 / 546 (7) | 174.3 / 197 | 261.2 / 294.4 (7) | 0 |
| Dispositivos | 232.1 / 241.6 | 626.2 / 653.9 (7) | 150.2 / 160.5 | 543.4 / 624.6 (7) | 0 |
| Inventario | 134.6 / 144.3 | 230.3 / 245.8 (7) | 102.4 / 106.8 | 183 / 230.4 (7) | 0 |
| Agenda | 160.7 / 170.7 | 160.7 / 170.7 (7) | 142.6 / 150.3 | 142.6 / 150.3 (7) | 0 |
| Tareas | 149.6 / 165.6 | 506.6 / 539.3 (7) | 111.7 / 131.1 | 359 / 408 (7) | 0 |
| Tickets | 112.3 / 125.1 | 553.5 / 560.7 (7) | 93.1 / 175.5 | 272.9 / 298.9 (7) | 0 |
| Historial | 105.5 / 112.4 | 391.4 / 402.7 (7) | 83.1 / 266.5 | 275.8 / 287.5 (7) | 0 |
| Analítica | 139 / 143.6 | 1892.7 / 2073.4 (7) | 114.7 / 254.8 | 1486.4 / 1680.5 (7) | 0 |
| Configuración | 130.9 / 156.4 | 130.9 / 156.4 (7) | 107.9 / 123.7 | 107.9 / 123.7 (7) | 0 |

## Búsqueda rápida de personas (Préstamos)

Se tipean 3 letras seguidas en el campo Persona; se mide desde la 3ª tecla hasta el frame pintado con la sugerencia en pantalla. Hoy: `LoanForm` espera 220 ms (debounce) y pide `/api/loans/suggest`; el server lee todo `loan_events` de la sede y filtra en JS.

| Caso | Término | Personas que coinciden | Visible en pantalla | Espera antes del pedido | Pedido (navegador) | Endpoint (Node) | Fallas |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| común | `mic` | 9 | 106.7 / 121.1 (7) | – | – | 16.8 / 17.7 · 0 q | 0 |
| parcial | `cae` | 9 | 104.7 / 112.5 (7) | – | – | 16.7 / 17.1 · 0 q | 0 |
| con tilde | `rám` | 6 | 110.7 / 126.7 (7) | – | – | 16.2 / 16.7 · 0 q | 0 |
| sin tilde | `ram` | 6 | 105.7 / 126.6 (7) | – | – | 16.2 / 16.8 · 0 q | 0 |
| sin resultados | `zqx` | 0 | 0 / 0 (7) | – | – | 16.2 / 16.7 · 0 q | 0 |

En "sin resultados" la columna visible mide hasta que llega la respuesta vacía y se pinta el frame siguiente.

## Búsqueda flexible de equipos (Dispositivos)

`touch 34` (debería encontrar D1436): **133.4 / 153.3 (7)** ms desde la última tecla hasta que la tabla se aquieta · filas 387 → 2 · encontrado en 7/7 corridas.

## Historial

| Acción | ms | Filas |
| --- | ---: | ---: |
| Abrir Historial (primera página) | 657.7 / 678.7 (7) | 56 |
| Cargar más | 400.7 / 496.5 (7) | 109 |

## Desplazamiento en listas largas

Scroll programático de 120 px por frame, bajando y subiendo, sobre el contenedor que scrollea. Duración entre frames pintados (16,7 ms = 60 fps).

| Lista | Filas | Frames | p50 frame | p95 frame | Peor frame | Frames > 50 ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Dispositivos (tabla abierta entera) | 387 | 296 | 17.8 / 18 | 35.8 / 35.9 (7) | 818 / 884.3 | 3 / 4 |
| Historial (hasta 4 páginas) | 215 | 182 | 17.7 / 17.8 | 18.2 / 18.3 (7) | 228.7 / 248.5 | 1 / 1 |

## Operaciones frecuentes

| Operación | UI: click → pantalla quieta | POST (navegador) | API desde Node (POST + ver en /api/devices) | Queries |
| --- | ---: | ---: | ---: | ---: |
| Prestar uno | 624.3 / 704.3 (7) | 198 / 269 | 329.2 / 357.1 | 13 / 13 |
| Devolver uno | 506.8 / 552.3 (7) | 204 / 213 | 343 / 372.2 | 14 / 14 |

## API (desde Node, sin red simulada)

Cada endpoint 7 veces con las cachés del server calientes. Ráfaga de arranque (los GET que pide la app al abrir, 6 en paralelo): **551.6 / 615.4 (7)** ms, 23 queries.

| Endpoint | Estado | ms | Queries | KB |
| --- | ---: | ---: | ---: | ---: |
| `/api/auth/session` | 200 | 15.9 / 16.3 | 0 | 0.5 |
| `/api/site-settings` | 200 | 32.6 / 46.7 | 1 | 1.6 |
| `/api/devices` | 200 | 22 / 22.8 | 0 | 311 |
| `/api/movements` | 200 | 48.2 / 49.7 | 1 | 16.4 |
| `/api/agenda` | 200 | 49.4 / 51 | 1 | 57.2 |
| `/api/tasks?space=team` | 200 | 84.6 / 97.7 | 4 | 158.7 |
| `/api/notifications` | 200 | 32.6 / 48.5 | 1 | 4.9 |
| `/api/user/prefs` | 200 | 31.5 / 46.9 | 1 | 0 |
| `/api/release-notes/latest` | 200 | 31.7 / 46.7 | 1 | 0 |
| `/api/internal-notes?filter=all` | 200 | 31.8 / 47.4 | 1 | 0 |
| `/api/loans/previous-day` | 200 | 16.9 / 17.3 | 0 | 1.2 |
| `/api/photo-passes` | 200 | 32.5 / 47.6 | 1 | 5.9 |
| `/api/history?kind=loans&limit=50` | 200 | 47.9 / 49.3 | 1 | 12.9 |
| `/api/history?kind=all&limit=50` | 200 | 52 / 52.9 | 1 | 9 |
| `/api/loans/suggest?q=mic` | 200 | 16.8 / 17.7 | 0 | 1.2 |
| `/api/loans/suggest?q=cae` | 200 | 16.7 / 17.1 | 0 | 1.2 |
| `/api/loans/suggest?q=r%C3%A1m` | 200 | 16.2 / 16.7 | 0 | 0.9 |
| `/api/loans/suggest?q=ram` | 200 | 16.2 / 16.8 | 0 | 0.9 |
| `/api/loans/suggest?q=zqx` | 200 | 16.2 / 16.7 | 0 | 0 |
| `/api/settings/shifts` | 200 | 31.5 / 47.3 | 1 | 0.1 |
| `/api/tasks?space=all` | 200 | 98.8 / 114.5 | 4 | 158.7 |
| `/api/quick-links` | 200 | 32.4 / 48.3 | 1 | 2.4 |
| `/api/tools/config` | 200 | 156.8 / 173.6 | 8 | 0.2 |
| `/api/recess-schedules` | 200 | 63 / 64.1 | 2 | 0.1 |
| `/api/internal-notes?filter=active` | 200 | 45.8 / 47.6 | 1 | 0 |
| `/api/loans/people` | 200 | 17.8 / 18.4 | 0 | 57.2 |
| `/api/device-groups` | 200 | 32 / 47.3 | 1 | 0 |
| `/api/devices/deleted` | 200 | 31.9 / 47.5 | 1 | 0.2 |
| `/api/inventory/items` | 200 | 63.9 / 79.4 | 2 | 18.1 |
| `/api/task-columns` | 200 | 31.6 / 47.7 | 1 | 0.3 |
| `/api/site-assistants` | 200 | 47.1 / 47.4 | 1 | 0.2 |
| `/api/tickets` | 200 | 37.6 / 52 | 1 | 135.5 |
| `/api/ticket-templates` | 200 | 31.8 / 47.2 | 1 | 0 |
| `/api/classrooms` | 200 | 33 / 48.1 | 1 | 21.4 |
| `/api/analytics?from=2025-10-20&to=2026-10-20` | 200 | 191.5 / 204.2 | 4 | 112.6 |
| `/api/analytics/parque` | 200 | 110.7 / 110.8 | 4 | 0.8 |
| `/api/allowed-users` | 200 | 64 / 79.2 | 3 | 2.3 |
| `/api/invites` | 200 | 31.9 / 47.2 | 1 | 0 |

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
node perf/suite.mjs --repo=<checkout> --label=04-pasada1 --runs=7 --cpu=4 --latency=15 --rtt=40 --down=10 --up=5
```

Para medir otra rama sin tocar el repo principal: `git worktree add <tmp> <rama>`, junction de `node_modules` (`cmd /c mklink /J node_modules <repo>\node_modules`), correr la suite con `--repo=<tmp>` y `git worktree remove --force <tmp>`. Usá la misma base (`--db=<snapshot>`) en todas las etiquetas que quieras comparar.
