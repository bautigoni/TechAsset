# Benchmark 00-inicial

Checkout `83f97e4 Merge pull request #5: rendimiento, seguridad, bugs y UX` (83f97e4, HEAD) · 2026-10-20T03:40:12.773Z · generado por `perf/suite.mjs`.

**Condiciones:** 7 corridas por métrica · CPU 4× más lenta · red simulada 40 ms RTT, 10 Mbps bajada, 5 Mbps subida · 15 ms sincrónicos por query en el server (simula Supabase) · Chrome 155.0.8059.85 headless, 1366×800 · Node v24.19.0 · AMD Ryzen 5 5560U with Radeon Graphics ×12. Una pasada de calentamiento sin registrar antes de las corridas; cada medición en un contexto de navegador nuevo, sin service worker.
**Datos (copia de la base, sede NFPT):** 386 equipos, 5145 eventos de préstamo, 5881 movimientos, 258 tareas, 327 actividades de agenda, 250 tickets.

Valores en ms: **mediana / p95** (p95 por rango más cercano; con n = 7 coincide con el máximo). Entre paréntesis, el tamaño de muestra válida. "–" = no se pudo medir (ver Fallas).

## Inicio de la aplicación

| Métrica | Frío (sin caché) | Caliente (recarga con caché) |
| --- | ---: | ---: |
| FCP (primer pintado con contenido) | 912 / 928 (7) | 300 / 304 (7) |
| App visible (navegación + main pintados) | 970 / 978 (7) | 338 / 347.4 (7) |
| Dashboard con datos (todos los pedidos terminados y pantalla quieta) | 3100.5 / 3191.1 (7) | 1392.3 / 1459.2 (7) |
| Interactiva (TTI: 5 s sin tareas largas) | 1533.7 / 1666.7 (7) | 304 / 935.7 (7) |
| TBT (FCP → TTI) | 63 / 119 (7) | 0 / 6 (7) |
| Tareas largas totales (ms) | 513 / 756 (7) | 0 / 56 (7) |
| DOMContentLoaded | 369.6 / 392.5 (7) | 133.8 / 137.5 (7) |
| Transferido hasta TTI (KB, corrida 1) | Script 227.8, Stylesheet 60.5, Image 45, Fetch 44.5, Document 1.3, Other 0 | Fetch 13.6, Document 0.3, Script 0, Stylesheet 0, Image 0, Other 0 |

## Cambio de módulo

Click en la navegación → **respuesta** (primer frame con un cambio en `<main>`) y **contenido** (datos cargados y pantalla quieta). 1ª vez = primera visita en la sesión (puede bajar el chunk); 2ª = volver a una pantalla ya vista.

| Pantalla | 1ª respuesta | 1ª contenido | 2ª respuesta | 2ª contenido | Fallas |
| --- | ---: | ---: | ---: | ---: | ---: |
| Dashboard | 157.4 / 169.9 | 401.3 / 576.4 (7) | 152.4 / 183.6 | 337.4 / 419.3 (7) | 0 |
| Préstamos | 298.5 / 311.5 | 1008.2 / 1061.2 (7) | 138.6 / 179.2 | 892.6 / 972.1 (7) | 0 |
| Dispositivos | 179.5 / 200.7 | 342.9 / 386.8 (7) | 125 / 130.9 | 240.8 / 281.7 (7) | 0 |
| Inventario | 264.7 / 301.6 | 338.7 / 373.4 (7) | 73.7 / 91.2 | 135.1 / 165.1 (7) | 0 |
| Agenda | 164.8 / 176.8 | 164.8 / 176.8 (7) | 114.4 / 117.6 | 114.4 / 117.6 (7) | 0 |
| Tareas | 112.5 / 121.4 | 386.6 / 415.6 (7) | 82.2 / 98.3 | 246.3 / 349.8 (7) | 0 |
| Tickets | 92.7 / 111 | 1412.6 / 1546.8 (7) | 73.8 / 80.3 | 1037.8 / 1174.8 (7) | 0 |
| Historial | 130 / 151.8 | 283.8 / 309 (7) | 112.9 / 130.5 | 250.7 / 270.4 (7) | 0 |
| Analítica | 85.3 / 91 | 1225.3 / 1239.4 (7) | 66.1 / 294.4 | 1080.2 / 1131.2 (7) | 0 |
| Configuración | 441.6 / 464 | 835.7 / 888.7 (7) | 259.4 / 419.1 | 750.4 / 857.9 (7) | 0 |

## Búsqueda rápida de personas (Préstamos)

Se tipean 3 letras seguidas en el campo Persona; se mide desde la 3ª tecla hasta el frame pintado con la sugerencia en pantalla. Hoy: `LoanForm` espera 220 ms (debounce) y pide `/api/loans/suggest`; el server lee todo `loan_events` de la sede y filtra en JS.

| Caso | Término | Personas que coinciden | Visible en pantalla | Espera antes del pedido | Pedido (navegador) | Endpoint (Node) | Fallas |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| común | `mic` | 9 | 332.4 / 364.7 (7) | 234.1 / 240.6 | 69.1 / 115.9 | 41.6 / 57.8 · 1 q | 0 |
| parcial | `cae` | 9 | 343.7 / 391.1 (7) | 235.6 / 241.4 | 74.4 / 122.1 | 53 / 57.2 · 1 q | 0 |
| con tilde | `rám` | 6 | 338 / 352.7 (7) | 235.1 / 247.4 | 73 / 76.6 | 39.3 / 55.4 · 1 q | 0 |
| sin tilde | `ram` | 6 | 336.3 / 385.4 (7) | 234 / 242.3 | 72 / 104.2 | 54.6 / 57.2 · 1 q | 0 |
| sin resultados | `zqx` | 0 | 333 / 348.4 (7) | 228.4 / 248.8 | 70.5 / 74.3 | 54 / 55.9 · 1 q | 0 |

En "sin resultados" la columna visible mide hasta que llega la respuesta vacía y se pinta el frame siguiente.

## Búsqueda flexible de equipos (Dispositivos)

`touch 34` (debería encontrar D1436): **91.5 / 100.7 (7)** ms desde la última tecla hasta que la tabla se aquieta · filas 386 → 1 · encontrado en 7/7 corridas.

## Historial

| Acción | ms | Filas |
| --- | ---: | ---: |
| Abrir Historial (primera página) | 328.4 / 336.6 (7) | 50 |
| Cargar más | 220.6 / 250 (7) | 100 |

## Desplazamiento en listas largas

Scroll programático de 120 px por frame, bajando y subiendo, sobre el contenedor que scrollea. Duración entre frames pintados (16,7 ms = 60 fps).

| Lista | Filas | Frames | p50 frame | p95 frame | Peor frame | Frames > 50 ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Dispositivos (tabla abierta entera) | 386 | 588 | 17.7 / 141.7 | 18.2 / 177.9 (7) | 196.3 / 263.9 | 5 / 558 |
| Historial (hasta 4 páginas) | 200 | 190 | 17.7 / 17.7 | 18.2 / 18.3 (7) | 36.1 / 36.8 | 0 / 0 |

## Operaciones frecuentes

| Operación | UI: click → pantalla quieta | POST (navegador) | API desde Node (POST + ver en /api/devices) | Queries |
| --- | ---: | ---: | ---: | ---: |
| Prestar uno | 510.6 / 574.2 (7) | 190 / 219 | 344.5 / 354.3 | 13 / 13 |
| Devolver uno | 527.5 / 564.8 (7) | 226 / 260 | 345.9 / 372.7 | 14 / 14 |

## API (desde Node, sin red simulada)

Cada endpoint 7 veces con las cachés del server calientes. Ráfaga de arranque (los GET que pide la app al abrir, 6 en paralelo): **545.1 / 560.7 (7)** ms, 22 queries.

| Endpoint | Estado | ms | Queries | KB |
| --- | ---: | ---: | ---: | ---: |
| `/api/auth/session` | 200 | 16 / 16.3 | 0 | 0.5 |
| `/api/site-settings` | 200 | 32.5 / 47.7 | 1 | 1.6 |
| `/api/devices` | 200 | 22.7 / 24.1 | 0 | 311 |
| `/api/movements` | 200 | 33.9 / 49.7 | 1 | 16.4 |
| `/api/agenda` | 200 | 49.8 / 50.7 | 1 | 57.2 |
| `/api/tasks?space=team` | 200 | 100.3 / 101.9 | 4 | 158.7 |
| `/api/notifications` | 200 | 32.5 / 48.4 | 1 | 4.9 |
| `/api/user/prefs` | 200 | 31.7 / 46.8 | 1 | 0 |
| `/api/release-notes/latest` | 200 | 31.7 / 47.1 | 1 | 0 |
| `/api/internal-notes?filter=all` | 200 | 47.3 / 47.7 | 1 | 0 |
| `/api/loans/previous-day` | 200 | 641.8 / 714.5 | 1 | 1.2 |
| `/api/photo-passes` | 200 | 47.4 / 48.4 | 1 | 5.9 |
| `/api/history?kind=loans&limit=50` | 200 | 48.1 / 48.6 | 1 | 12.9 |
| `/api/history?kind=all&limit=50` | 200 | 52.6 / 53.5 | 1 | 9 |
| `/api/loans/suggest?q=mic` | 200 | 41.6 / 57.8 | 1 | 1.2 |
| `/api/loans/suggest?q=cae` | 200 | 53 / 57.2 | 1 | 1.2 |
| `/api/loans/suggest?q=r%C3%A1m` | 200 | 39.3 / 55.4 | 1 | 0.9 |
| `/api/loans/suggest?q=ram` | 200 | 54.6 / 57.2 | 1 | 0.9 |
| `/api/loans/suggest?q=zqx` | 200 | 54 / 55.9 | 1 | 0 |
| `/api/tasks?space=all` | 200 | 86.6 / 101.3 | 4 | 158.7 |
| `/api/settings/shifts` | 200 | 32.2 / 47.6 | 1 | 0.1 |
| `/api/quick-links` | 200 | 32.7 / 48.5 | 1 | 2.3 |
| `/api/tools/config` | 200 | 143.3 / 159.1 | 8 | 0.2 |
| `/api/internal-notes?filter=active` | 200 | 46.4 / 47.5 | 1 | 0 |
| `/api/recess-schedules` | 200 | 32.3 / 47.9 | 1 | 0.1 |
| `/api/devices?refresh=1` | 200 | 23 / 23.8 | 0 | 311 |
| `/api/photo-passes/options` | 200 | 174.3 / 206.7 | 7 | 6.9 |
| `/api/inventory/items` | 200 | 64.1 / 80.1 | 2 | 18.1 |
| `/api/site-assistants` | 200 | 31.9 / 46.9 | 1 | 0.2 |
| `/api/task-columns` | 200 | 31.9 / 47.4 | 1 | 0.3 |
| `/api/tickets` | 200 | 36.5 / 52.3 | 1 | 135.5 |
| `/api/ticket-templates` | 200 | 47 / 47.5 | 1 | 0 |
| `/api/classrooms` | 200 | 48.1 / 49.1 | 1 | 21.4 |
| `/api/analytics/parque` | 200 | 95.7 / 111.2 | 4 | 0.8 |
| `/api/analytics?from=2025-10-20&to=2026-10-20` | 200 | 308.8 / 331.4 | 9 | 1892.7 |
| `/api/notifications/prefs` | 200 | 47.6 / 63.3 | 2 | 0.2 |
| `/api/invites` | 200 | 31.8 / 94.2 | 1 | 0 |
| `/api/lifecycle/defaults` | 200 | 47.5 / 63.5 | 2 | 0.4 |
| `/api/allowed-users` | 200 | 268.5 / 283.9 | 15 | 2 |
| `/api/sites` | 200 | 31.8 / 32.1 | 1 | 0.7 |

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
node perf/suite.mjs --repo=<checkout> --label=00-inicial --runs=7 --cpu=4 --latency=15 --rtt=40 --down=10 --up=5
```

Para medir otra rama sin tocar el repo principal: `git worktree add <tmp> <rama>`, junction de `node_modules` (`cmd /c mklink /J node_modules <repo>\node_modules`), correr la suite con `--repo=<tmp>` y `git worktree remove --force <tmp>`. Usá la misma base (`--db=<snapshot>`) en todas las etiquetas que quieras comparar.
