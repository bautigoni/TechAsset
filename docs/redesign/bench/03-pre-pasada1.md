# Benchmark 03-pre-pasada1

Checkout `54ac7af docs: protocolo de las tres pasadas de rendimiento` (54ac7af, HEAD) · 2026-10-20T06:33:37.963Z · generado por `perf/suite.mjs`.

**Condiciones:** 7 corridas por métrica · CPU 4× más lenta · red simulada 40 ms RTT, 10 Mbps bajada, 5 Mbps subida · 15 ms sincrónicos por query en el server (simula Supabase) · Chrome 155.0.8059.85 headless, 1366×800 · Node v24.19.0 · AMD Ryzen 5 5560U with Radeon Graphics ×12. Una pasada de calentamiento sin registrar antes de las corridas; cada medición en un contexto de navegador nuevo, sin service worker.
**Datos (copia de la base, sede NFPT):** 386 equipos, 5145 eventos de préstamo, 5881 movimientos, 258 tareas, 327 actividades de agenda, 250 tickets.

Valores en ms: **mediana / p95** (p95 por rango más cercano; con n = 7 coincide con el máximo). Entre paréntesis, el tamaño de muestra válida. "–" = no se pudo medir (ver Fallas).

## Inicio de la aplicación

| Métrica | Frío (sin caché) | Caliente (recarga con caché) |
| --- | ---: | ---: |
| FCP (primer pintado con contenido) | 1028 / 1224 (7) | 424 / 456 (7) |
| App visible (navegación + main pintados) | 1301.6 / 1336.7 (7) | 502.2 / 531.8 (7) |
| Dashboard con datos (todos los pedidos terminados y pantalla quieta) | 1768.1 / 2045.2 (7) | 1072.8 / 1148.3 (7) |
| Interactiva (TTI: 5 s sin tareas largas) | 1760.9 / 1937.2 (7) | 1063.4 / 1147.5 (7) |
| TBT (FCP → TTI) | 262 / 316 (7) | 37 / 48 (7) |
| Tareas largas totales (ms) | 799 / 843 (7) | 283 / 335 (7) |
| DOMContentLoaded | 433.6 / 450.1 (7) | 150.5 / 162.3 (7) |
| Transferido hasta TTI (KB, corrida 1) | Script 425.5, Stylesheet 79.2, Font 52.1, Fetch 44.5, Document 1.9, Other 1.5, Image 0 | Fetch 13.6, Document 0.3, Script 0, Stylesheet 0, Font 0, Image 0, Other 0 |

## Cambio de módulo

Click en la navegación → **respuesta** (primer frame con un cambio en `<main>`) y **contenido** (datos cargados y pantalla quieta). 1ª vez = primera visita en la sesión (puede bajar el chunk); 2ª = volver a una pantalla ya vista.

| Pantalla | 1ª respuesta | 1ª contenido | 2ª respuesta | 2ª contenido | Fallas |
| --- | ---: | ---: | ---: | ---: | ---: |
| Dashboard | 172.7 / 236.8 | 269.6 / 322.7 (7) | 216.2 / 238.1 | 320.5 / 373.6 (7) | 0 |
| Préstamos | 377.7 / 414.1 | 1196.2 / 1213.8 (7) | 181 / 255.8 | 935.9 / 1056.7 (7) | 0 |
| Dispositivos | 235.4 / 264.9 | 611.6 / 652.7 (7) | 155.7 / 178.9 | 516.2 / 550.4 (7) | 0 |
| Inventario | 128 / 151.6 | 227.3 / 266.5 (7) | 98.1 / 104.9 | 181.8 / 189.7 (7) | 0 |
| Agenda | 165.1 / 174.3 | 165.1 / 174.3 (7) | 129.6 / 134.7 | 129.6 / 134.7 (7) | 0 |
| Tareas | 132.6 / 172.6 | 500.2 / 534.3 (7) | 110.4 / 115.2 | 377.6 / 411.6 (7) | 0 |
| Tickets | 109.4 / 120.7 | 561.5 / 570.2 (7) | 101.4 / 104.1 | 269 / 320 (7) | 0 |
| Historial | 103.8 / 107.3 | 366.2 / 390.8 (7) | 81.7 / 102.2 | 304.9 / 339.2 (7) | 0 |
| Analítica | 147.3 / 163.9 | 1945.8 / 2000.6 (7) | 113.6 / 247.5 | 1519.6 / 1678.8 (7) | 0 |
| Configuración | 136.1 / 161.7 | 136.1 / 161.7 (7) | 108 / 123.2 | 108 / 123.2 (7) | 0 |

## Búsqueda rápida de personas (Préstamos)

Se tipean 3 letras seguidas en el campo Persona; se mide desde la 3ª tecla hasta el frame pintado con la sugerencia en pantalla. Hoy: `LoanForm` espera 220 ms (debounce) y pide `/api/loans/suggest`; el server lee todo `loan_events` de la sede y filtra en JS.

| Caso | Término | Personas que coinciden | Visible en pantalla | Espera antes del pedido | Pedido (navegador) | Endpoint (Node) | Fallas |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| común | `mic` | 9 | 376.8 / 393.8 (7) | 247.5 / 249.9 | 72 / 74.3 | 45.5 / 57.5 · 1 q | 0 |
| parcial | `cae` | 9 | 370.4 / 377.4 (7) | 245.8 / 250.7 | 72.1 / 75.7 | 39.4 / 56 · 1 q | 0 |
| con tilde | `rám` | 6 | 360.4 / 388.1 (7) | 233.4 / 264.3 | 73 / 75.2 | 40 / 55.4 · 1 q | 0 |
| sin tilde | `ram` | 6 | 362.8 / 385.3 (7) | 236.9 / 252.8 | 73.5 / 80.9 | 53.8 / 55 · 1 q | 0 |
| sin resultados | `zqx` | 0 | 328 / 353.8 (7) | 234.7 / 248.7 | 68.5 / 73.2 | 38.9 / 54.9 · 1 q | 0 |

En "sin resultados" la columna visible mide hasta que llega la respuesta vacía y se pinta el frame siguiente.

## Búsqueda flexible de equipos (Dispositivos)

`touch 34` (debería encontrar D1436): **144.8 / 191.6 (7)** ms desde la última tecla hasta que la tabla se aquieta · filas 387 → 2 · encontrado en 7/7 corridas.

## Historial

| Acción | ms | Filas |
| --- | ---: | ---: |
| Abrir Historial (primera página) | 662.6 / 682 (7) | 56 |
| Cargar más | 402.6 / 417 (7) | 109 |

## Desplazamiento en listas largas

Scroll programático de 120 px por frame, bajando y subiendo, sobre el contenedor que scrollea. Duración entre frames pintados (16,7 ms = 60 fps).

| Lista | Filas | Frames | p50 frame | p95 frame | Peor frame | Frames > 50 ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Dispositivos (tabla abierta entera) | 387 | 296 | 87.8 / 88 | 106.5 / 106.9 (7) | 124.5 / 141.4 | 295 / 296 |
| Historial (hasta 4 páginas) | 215 | 182 | 17.8 / 17.8 | 18.2 / 18.6 (7) | 71 / 71.9 | 4 / 5 |

## Operaciones frecuentes

| Operación | UI: click → pantalla quieta | POST (navegador) | API desde Node (POST + ver en /api/devices) | Queries |
| --- | ---: | ---: | ---: | ---: |
| Prestar uno | 618.9 / 722.6 (7) | 199 / 210 | 342.7 / 370.6 | 13 / 13 |
| Devolver uno | 545.6 / 589.2 (7) | 216 / 232 | 359.6 / 374.6 | 14 / 14 |

## API (desde Node, sin red simulada)

Cada endpoint 7 veces con las cachés del server calientes. Ráfaga de arranque (los GET que pide la app al abrir, 6 en paralelo): **550.6 / 583.5 (7)** ms, 23 queries.

| Endpoint | Estado | ms | Queries | KB |
| --- | ---: | ---: | ---: | ---: |
| `/api/auth/session` | 200 | 16.1 / 16.3 | 0 | 0.5 |
| `/api/site-settings` | 200 | 32.4 / 47.6 | 1 | 1.6 |
| `/api/devices` | 200 | 22.3 / 22.8 | 0 | 311 |
| `/api/movements` | 200 | 48.3 / 49.4 | 1 | 16.4 |
| `/api/agenda` | 200 | 34.1 / 51.1 | 1 | 57.2 |
| `/api/tasks?space=team` | 200 | 100.5 / 115.9 | 4 | 158.7 |
| `/api/notifications` | 200 | 32.4 / 48.6 | 1 | 4.9 |
| `/api/user/prefs` | 200 | 31.9 / 47.2 | 1 | 0 |
| `/api/release-notes/latest` | 200 | 31.5 / 47 | 1 | 0 |
| `/api/internal-notes?filter=all` | 200 | 46.7 / 47.3 | 1 | 0 |
| `/api/loans/previous-day` | 200 | 602.7 / 642.4 | 1 | 1.2 |
| `/api/photo-passes` | 200 | 32.7 / 47.9 | 1 | 5.9 |
| `/api/history?kind=loans&limit=50` | 200 | 48 / 95.7 | 1 | 12.9 |
| `/api/history?kind=all&limit=50` | 200 | 52.6 / 52.7 | 1 | 9 |
| `/api/loans/suggest?q=mic` | 200 | 45.5 / 57.5 | 1 | 1.2 |
| `/api/loans/suggest?q=cae` | 200 | 39.4 / 56 | 1 | 1.2 |
| `/api/loans/suggest?q=r%C3%A1m` | 200 | 40 / 55.4 | 1 | 0.9 |
| `/api/loans/suggest?q=ram` | 200 | 53.8 / 55 | 1 | 0.9 |
| `/api/loans/suggest?q=zqx` | 200 | 38.9 / 54.9 | 1 | 0 |
| `/api/settings/shifts` | 200 | 40.1 / 47.9 | 1 | 0.1 |
| `/api/tasks?space=all` | 200 | 100.6 / 116.5 | 4 | 158.7 |
| `/api/quick-links` | 200 | 47.1 / 47.5 | 1 | 2.4 |
| `/api/tools/config` | 200 | 142.7 / 157.5 | 8 | 0.2 |
| `/api/devices?refresh=1` | 200 | 22.4 / 24.4 | 0 | 311 |
| `/api/recess-schedules` | 200 | 48 / 63.1 | 2 | 0.1 |
| `/api/internal-notes?filter=active` | 200 | 46.7 / 48.1 | 1 | 0 |
| `/api/photo-passes/options` | 200 | 174.2 / 190 | 7 | 6.9 |
| `/api/device-groups` | 200 | 46.4 / 47.1 | 1 | 0 |
| `/api/devices/deleted` | 200 | 32.3 / 47 | 1 | 0.2 |
| `/api/inventory/items` | 200 | 48.3 / 64.4 | 2 | 18.1 |
| `/api/task-columns` | 200 | 31.7 / 47.2 | 1 | 0.3 |
| `/api/site-assistants` | 200 | 47.3 / 47.6 | 1 | 0.2 |
| `/api/tickets` | 200 | 36.4 / 52.2 | 1 | 135.5 |
| `/api/ticket-templates` | 200 | 47.1 / 47.3 | 1 | 0 |
| `/api/classrooms` | 200 | 47.8 / 48.6 | 1 | 21.4 |
| `/api/analytics?from=2025-10-20&to=2026-10-20` | 200 | 188.9 / 208.1 | 4 | 112.6 |
| `/api/analytics/parque` | 200 | 94.6 / 110.9 | 4 | 0.8 |
| `/api/allowed-users` | 200 | 64.3 / 78.9 | 3 | 2.3 |
| `/api/invites` | 200 | 31.5 / 47.1 | 1 | 0 |

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
