# Benchmark 01-etapa1

Checkout `e3124f5 etapa 1: tokens Grafito, tema claro/oscuro/sistema, Geist y librería src/ui` (e3124f5, HEAD) · 2026-10-19T15:30:10.143Z · generado por `perf/suite.mjs`.

**Condiciones:** 7 corridas por métrica · CPU 4× más lenta · red simulada 40 ms RTT, 10 Mbps bajada, 5 Mbps subida · 15 ms sincrónicos por query en el server (simula Supabase) · Chrome 155.0.8059.84 headless, 1366×800 · Node v24.19.0 · AMD Ryzen 5 5560U with Radeon Graphics ×12. Una pasada de calentamiento sin registrar antes de las corridas; cada medición en un contexto de navegador nuevo, sin service worker.
**Datos (copia de la base, sede NFPT):** 76 equipos, 153 eventos de préstamo, 255 movimientos, 8 tareas, 27 actividades de agenda, 0 tickets.

Valores en ms: **mediana / p95** (p95 por rango más cercano; con n = 7 coincide con el máximo). Entre paréntesis, el tamaño de muestra válida. "–" = no se pudo medir (ver Fallas).

## Inicio de la aplicación

| Métrica | Frío (sin caché) | Caliente (recarga con caché) |
| --- | ---: | ---: |
| FCP (primer pintado con contenido) | 1264 / 2584 (7) | 596 / 1156 (7) |
| App visible (navegación + main pintados) | 1417 / 2807.2 (7) | 718 / 1507.1 (7) |
| Dashboard con datos (todos los pedidos terminados y pantalla quieta) | 4345.1 / 8215 (7) | 2322.2 / 4267.7 (7) |
| Interactiva (TTI: 5 s sin tareas largas) | 2590.7 / 5931.6 (7) | 2206 / 3870.9 (7) |
| TBT (FCP → TTI) | 411 / 1809 (7) | 323 / 1234 (7) |
| Tareas largas totales (ms) | 1519 / 4390 (7) | 787 / 2511 (7) |
| DOMContentLoaded | 514.3 / 721.2 (7) | 214.4 / 296.5 (7) |
| Transferido hasta TTI (KB, corrida 1) | Script 251.4, Stylesheet 63.6, Image 45, Font 29.1, Fetch 18, Document 1.9, Other 0 | Fetch 6.9, Document 0.3, Script 0, Stylesheet 0, Font 0, Image 0, Other 0 |

## Cambio de módulo

Click en la navegación → **respuesta** (primer frame con un cambio en `<main>`) y **contenido** (datos cargados y pantalla quieta). 1ª vez = primera visita en la sesión (puede bajar el chunk); 2ª = volver a una pantalla ya vista.

| Pantalla | 1ª respuesta | 1ª contenido | 2ª respuesta | 2ª contenido | Fallas |
| --- | ---: | ---: | ---: | ---: | ---: |
| Dashboard | 382.6 / 550.9 | 791.7 / 1143.5 (7) | 364.6 / 623 | 747.9 / 1221 (7) | 0 |
| Préstamos | 534.9 / 748.6 | 690.2 / 1035.8 (7) | 251.9 / 480.3 | 497.1 / 801.3 (7) | 0 |
| Dispositivos | 431.3 / 753.6 | 876 / 1554.2 (7) | 270.3 / 531.8 | 819.6 / 989.7 (7) | 0 |
| Inventario | 640.7 / 1162.9 | 866.8 / 1162.9 (7) | 162.5 / 209 | 247.9 / 412.4 (7) | 0 |
| Agenda | 434.2 / 943.3 | 434.2 / 943.3 (7) | 255.2 / 306.8 | 255.2 / 306.8 (7) | 0 |
| Tareas | 232.7 / 294.2 | 703.2 / 784.3 (7) | 218 / 283.6 | 418.4 / 483.6 (7) | 0 |
| Tickets | 189.9 / 417.7 | 280.4 / 526 (7) | 131 / 178.3 | 246.9 / 491.1 (7) | 0 |
| Historial | 201.2 / 297.9 | 579.7 / 688.3 (7) | 107.2 / 186.8 | 372.4 / 834.3 (7) | 0 |
| Analítica | 201.6 / 411.8 | 1261.8 / 1533 (7) | 171.4 / 220 | 963.4 / 1247.8 (7) | 0 |
| Configuración | 1043 / 1270.6 | 1301.8 / 1566.9 (7) | 806 / 1177.3 | 1077.5 / 1633.6 (7) | 0 |

## Búsqueda rápida de personas (Préstamos)

Se tipean 3 letras seguidas en el campo Persona; se mide desde la 3ª tecla hasta el frame pintado con la sugerencia en pantalla. Hoy: `LoanForm` espera 220 ms (debounce) y pide `/api/loans/suggest`; el server lee todo `loan_events` de la sede y filtra en JS.

| Caso | Término | Personas que coinciden | Visible en pantalla | Espera antes del pedido | Pedido (navegador) | Endpoint (Node) | Fallas |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| común | `ale` | 2 | 344 / 418 (7) | 239.8 / 253.4 | 76.9 / 83.5 | 46.7 / 48.4 · 1 q | 0 |
| parcial | `val` | 1 | 340.5 / 385.2 (7) | 241.6 / 265.3 | 69.3 / 75.6 | 48.1 / 51.1 · 1 q | 0 |
| con tilde | `áka` | 2 | 339.7 / 454.8 (7) | 247.1 / 269.1 | 65.7 / 80.4 | 41.9 / 46.8 · 1 q | 0 |
| sin tilde | `aka` | 2 | 350.1 / 481.5 (7) | 237.6 / 350.7 | 73.5 / 111.5 | 35.3 / 79.4 · 1 q | 0 |
| sin resultados | `zqx` | 0 | 336.7 / 374.2 (7) | 238.9 / 265.6 | 75 / 102 | 34.2 / 49.1 · 1 q | 0 |

En "sin resultados" la columna visible mide hasta que llega la respuesta vacía y se pinta el frame siguiente.

## Búsqueda flexible de equipos (Dispositivos)

`touch 34` (debería encontrar D1436): **136.4 / 191.5 (7)** ms desde la última tecla hasta que la tabla se aquieta · filas 76 → 1 · encontrado en 7/7 corridas.

## Historial

| Acción | ms | Filas |
| --- | ---: | ---: |
| Abrir Historial (primera página) | 650.2 / 1065.5 (7) | 50 |
| Cargar más | 451.2 / 1237.7 (7) | 100 |

## Desplazamiento en listas largas

Scroll programático de 120 px por frame, bajando y subiendo, sobre el contenedor que scrollea. Duración entre frames pintados (16,7 ms = 60 fps).

| Lista | Filas | Frames | p50 frame | p95 frame | Peor frame | Frames > 50 ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Dispositivos (tabla abierta entera) | 76 | 110 | 16.7 / 16.7 | 16.8 / 16.9 (7) | 16.9 / 50.3 | 0 / 4 |
| Historial (hasta 4 páginas) | 159 | 136 | 16.7 / 16.7 | 16.9 / 16.9 (7) | 33.5 / 66.9 | 0 / 2 |

## Operaciones frecuentes

| Operación | UI: click → pantalla quieta | POST (navegador) | API desde Node (POST + ver en /api/devices) | Queries |
| --- | ---: | ---: | ---: | ---: |
| Prestar uno | 574.3 / 771.5 (7) | 181 / 277 | 347.7 / 395.5 | 13 / 13 |
| Devolver uno | 618.2 / 1104.2 (7) | 275 / 337 | 376.7 / 427.6 | 14 / 16 |

## API (desde Node, sin red simulada)

Cada endpoint 7 veces con las cachés del server calientes. Ráfaga de arranque (los GET que pide la app al abrir, 6 en paralelo): **580.6 / 687.9 (7)** ms, 22 queries.

| Endpoint | Estado | ms | Queries | KB |
| --- | ---: | ---: | ---: | ---: |
| `/api/auth/session` | 200 | 14.6 / 20.6 | 0 | 0.5 |
| `/api/site-settings` | 200 | 45.9 / 48.9 | 1 | 1.6 |
| `/api/devices` | 200 | 19 / 21.1 | 0 | 62.2 |
| `/api/movements` | 200 | 45.3 / 59.8 | 1 | 15.8 |
| `/api/agenda` | 200 | 45.4 / 52.4 | 1 | 10.5 |
| `/api/tasks?space=team` | 200 | 140.1 / 159.8 | 4 | 4.6 |
| `/api/notifications` | 200 | 45.7 / 56.6 | 1 | 0 |
| `/api/user/prefs` | 200 | 37.5 / 52.2 | 1 | 0 |
| `/api/release-notes/latest` | 200 | 44.1 / 47.6 | 1 | 0 |
| `/api/internal-notes?filter=all` | 200 | 35.3 / 47.3 | 1 | 0 |
| `/api/loans/previous-day` | 200 | 68.5 / 130.8 | 1 | 0.8 |
| `/api/photo-passes` | 200 | 32.3 / 48.8 | 1 | 5.9 |
| `/api/history?kind=loans&limit=50` | 200 | 52.2 / 165.4 | 1 | 12 |
| `/api/history?kind=all&limit=50` | 200 | 50.7 / 104.2 | 1 | 8.7 |
| `/api/loans/suggest?q=ale` | 200 | 46.7 / 48.4 | 1 | 0.3 |
| `/api/loans/suggest?q=val` | 200 | 48.1 / 51.1 | 1 | 0.1 |
| `/api/loans/suggest?q=%C3%A1ka` | 200 | 41.9 / 46.8 | 1 | 0.2 |
| `/api/loans/suggest?q=aka` | 200 | 35.3 / 79.4 | 1 | 0.2 |
| `/api/loans/suggest?q=zqx` | 200 | 34.2 / 49.1 | 1 | 0 |
| `/api/settings/shifts` | 200 | 45.6 / 50.4 | 1 | 0.1 |
| `/api/tasks?space=all` | 200 | 154.8 / 290.2 | 4 | 4.6 |
| `/api/quick-links` | 200 | 42.2 / 70.8 | 1 | 2.3 |
| `/api/tools/config` | 200 | 310 / 400.4 | 8 | 0.1 |
| `/api/internal-notes?filter=active` | 200 | 43 / 49.2 | 1 | 0 |
| `/api/recess-schedules` | 200 | 45.7 / 51.3 | 1 | 0.1 |
| `/api/devices?refresh=1` | 200 | 21.8 / 24 | 0 | 62.2 |
| `/api/photo-passes/options` | 200 | 234.3 / 359.7 | 7 | 0.6 |
| `/api/inventory/items` | 200 | 79.5 / 86.6 | 2 | 18.1 |
| `/api/site-assistants` | 200 | 46.7 / 59.4 | 1 | 0.2 |
| `/api/task-columns` | 200 | 45.3 / 48.7 | 1 | 0.3 |
| `/api/tickets` | 200 | 33.6 / 48.7 | 1 | 0 |
| `/api/ticket-templates` | 200 | 45.8 / 47.6 | 1 | 0 |
| `/api/classrooms` | 200 | 45.9 / 49.8 | 1 | 21.4 |
| `/api/analytics/parque` | 200 | 108.3 / 126.4 | 4 | 0.8 |
| `/api/analytics?from=2025-10-19&to=2026-10-19` | 200 | 254.4 / 464.3 | 9 | 62.2 |
| `/api/notifications/prefs` | 200 | 61.7 / 63.2 | 2 | 0.2 |
| `/api/invites` | 200 | 32 / 47.2 | 1 | 0 |
| `/api/lifecycle/defaults` | 200 | 59 / 77.4 | 2 | 0.4 |
| `/api/allowed-users` | 200 | 287.1 / 306.3 | 15 | 2 |
| `/api/sites` | 200 | 45.8 / 46.9 | 1 | 0.7 |

## Tamaños del build

| Recurso | Crudo (KB) | gzip (KB) |
| --- | ---: | ---: |
| JS inicial (entry + modulepreload) | 307.5 | 96 |
| CSS inicial | 300.2 | 53.4 |
| Fuentes precargadas | 28.7 | 28.7 |
| **Total crítico** (HTML + JS + CSS + fuentes precargadas) |  | **179.7** |
| Todo el JS de dist/assets (42 archivos) | 803.2 | 257.6 |
| Todo el CSS de dist/assets (3 archivos) | 343.2 | 60.5 |

Crítico: `index.html` 1.6 KB, `assets/index-DBiwtLLK.js` 96 KB, `assets/index-DRrBi6R0.css` 53.4 KB, `assets/geist-latin-wght-normal-BgDaEnEv.woff2` 28.7 KB.

## Fallas

Ninguna.

## Cómo reproducir

```bash
node perf/suite.mjs --repo=<checkout> --label=01-etapa1 --runs=7 --cpu=4 --latency=15 --rtt=40 --down=10 --up=5
```

Para medir otra rama sin tocar el repo principal: `git worktree add <tmp> <rama>`, junction de `node_modules` (`cmd /c mklink /J node_modules <repo>\node_modules`), correr la suite con `--repo=<tmp>` y `git worktree remove --force <tmp>`. Usá la misma base (`--db=<snapshot>`) en todas las etiquetas que quieras comparar.
