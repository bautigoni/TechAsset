# Benchmark 01-etapa1

Checkout `e3124f5 etapa 1: tokens Grafito, tema claro/oscuro/sistema, Geist y librería src/ui` (e3124f5, HEAD) · 2026-10-19T14:51:11.657Z · generado por `perf/suite.mjs`.

**Condiciones:** 7 corridas por métrica · CPU 4× más lenta · red simulada 40 ms RTT, 10 Mbps bajada, 5 Mbps subida · 15 ms sincrónicos por query en el server (simula Supabase) · Chrome 155.0.8059.84 headless, 1366×800 · Node v24.19.0 · AMD Ryzen 5 5560U with Radeon Graphics ×12. Una pasada de calentamiento sin registrar antes de las corridas; cada medición en un contexto de navegador nuevo, sin service worker.
**Datos (copia de la base, sede NFPT):** 76 equipos, 153 eventos de préstamo, 255 movimientos, 8 tareas, 27 actividades de agenda, 0 tickets.

Valores en ms: **mediana / p95** (p95 por rango más cercano; con n = 7 coincide con el máximo). Entre paréntesis, el tamaño de muestra válida. "–" = no se pudo medir (ver Fallas).

## Inicio de la aplicación

| Métrica | Frío (sin caché) | Caliente (recarga con caché) |
| --- | ---: | ---: |
| FCP (primer pintado con contenido) | 1396 / 2196 (7) | 696 / 1356 (7) |
| App visible (navegación + main pintados) | 1527.3 / 2529.4 (7) | 800.2 / 1495.9 (7) |
| Dashboard con datos (todos los pedidos terminados y pantalla quieta) | 4313.2 / 5883.9 (7) | 2520.8 / 3903.2 (7) |
| Interactiva (TTI: 5 s sin tareas largas) | 2507.4 / 4830.8 (7) | 2725.4 / 3805.2 (7) |
| TBT (FCP → TTI) | 349 / 936 (7) | 391 / 848 (7) |
| Tareas largas totales (ms) | 1415 / 2880 (7) | 1085 / 2207 (7) |
| DOMContentLoaded | 538.7 / 694.7 (7) | 222.1 / 398.6 (7) |
| Transferido hasta TTI (KB, corrida 1) | Script 251.4, Stylesheet 63.6, Image 45, Font 29.1, Fetch 17.8, Document 1.9, Other 0 | Fetch 6.9, Document 0.3, Script 0, Stylesheet 0, Font 0, Other 0, Image 0 |

## Cambio de módulo

Click en la navegación → **respuesta** (primer frame con un cambio en `<main>`) y **contenido** (datos cargados y pantalla quieta). 1ª vez = primera visita en la sesión (puede bajar el chunk); 2ª = volver a una pantalla ya vista.

| Pantalla | 1ª respuesta | 1ª contenido | 2ª respuesta | 2ª contenido | Fallas |
| --- | ---: | ---: | ---: | ---: | ---: |
| Dashboard | 402.3 / 754.2 | 804 / 1181.5 (7) | 433 / 855.8 | 894.7 / 1524.5 (7) | 0 |
| Préstamos | 493.7 / 890.3 | 660.9 / 1172.1 (7) | 217.3 / 407.8 | 431.7 / 734.8 (7) | 0 |
| Dispositivos | 369.9 / 555.8 | 920.7 / 1069.6 (7) | 255.1 / 531.4 | 722.1 / 1471.8 (7) | 0 |
| Inventario | 623.6 / 790.1 | 770 / 972.8 (7) | 135 / 174 | 259.6 / 322.6 (7) | 0 |
| Agenda | 434.2 / 560.9 | 434.2 / 560.9 (7) | 207.2 / 504.8 | 207.2 / 504.8 (7) | 0 |
| Tareas | 226.4 / 348 | 773.4 / 913.6 (7) | 150.7 / 642.2 | 416.9 / 1071.2 (7) | 0 |
| Tickets | 161.5 / 372.4 | 255.8 / 583.4 (7) | 142.6 / 549.5 | 253.4 / 598.1 (7) | 0 |
| Historial | 187.1 / 536.2 | 618.2 / 1055.8 (7) | 140.7 / 306.9 | 486.4 / 700.4 (7) | 0 |
| Analítica | 170.9 / 344.6 | 1282 / 1559.1 (7) | 136.9 / 170.4 | 1175.9 / 1313.6 (7) | 0 |
| Configuración | 1503.4 / 1763.6 | 1921.9 / 2267.8 (7) | 836.5 / 1171.1 | 1337.3 / 1802.2 (7) | 0 |

## Búsqueda rápida de personas (Préstamos)

Se tipean 3 letras seguidas en el campo Persona; se mide desde la 3ª tecla hasta el frame pintado con la sugerencia en pantalla. Hoy: `LoanForm` espera 220 ms (debounce) y pide `/api/loans/suggest`; el server lee todo `loan_events` de la sede y filtra en JS.

| Caso | Término | Personas que coinciden | Visible en pantalla | Espera antes del pedido | Pedido (navegador) | Endpoint (Node) | Fallas |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| común | `ale` | 2 | 358.2 / 462.5 (7) | 239.5 / 296.8 | 74.9 / 139.8 | 36.3 / 48.1 · 1 q | 0 |
| parcial | `val` | 1 | 361.8 / 493 (7) | 246.9 / 271.6 | 80.6 / 166.9 | 33.8 / 42.1 · 1 q | 0 |
| con tilde | `áka` | 2 | 374.2 / 495.4 (7) | 252.6 / 284.9 | 75.2 / 118.9 | 31.9 / 39.9 · 1 q | 0 |
| sin tilde | `aka` | 2 | 382.6 / 515.8 (7) | 278.6 / 300.9 | 79.2 / 123.8 | 33 / 45.2 · 1 q | 0 |
| sin resultados | `zqx` | 0 | 338.5 / 354 (7) | 244.3 / 257.1 | 68.1 / 89.9 | 34.1 / 117.2 · 1 q | 0 |

En "sin resultados" la columna visible mide hasta que llega la respuesta vacía y se pinta el frame siguiente.

## Búsqueda flexible de equipos (Dispositivos)

`touch 34` (debería encontrar D1436): **86 / 122.8 (5)** ms desde la última tecla hasta que la tabla se aquieta · filas 76 → 1 · encontrado en 5/5 corridas.

## Historial

| Acción | ms | Filas |
| --- | ---: | ---: |
| Abrir Historial (primera página) | 709.3 / 803.1 (5) | 50 |
| Cargar más | 391.9 / 1354 (5) | 100 |

## Desplazamiento en listas largas

Scroll programático de 120 px por frame, bajando y subiendo, sobre el contenedor que scrollea. Duración entre frames pintados (16,7 ms = 60 fps).

| Lista | Filas | Frames | p50 frame | p95 frame | Peor frame | Frames > 50 ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Dispositivos (tabla abierta entera) | 76 | 110 | 16.7 / 16.7 | 16.8 / 17.3 (5) | 17 / 67 | 0 / 1 |
| Historial (hasta 4 páginas) | 157 | 134 | 16.7 / 16.7 | 16.9 / 17.8 (5) | 42.3 / 83.6 | 0 / 3 |

## Operaciones frecuentes

| Operación | UI: click → pantalla quieta | POST (navegador) | API desde Node (POST + ver en /api/devices) | Queries |
| --- | ---: | ---: | ---: | ---: |
| Prestar uno | 551.2 / 1191.4 (6) | 178.5 / 315 | 332.9 / 412 | 13 / 15 |
| Devolver uno | 608.6 / 701.3 (6) | 241 / 292 | 345.3 / 399.9 | 14 / 14 |

## API (desde Node, sin red simulada)

Cada endpoint 7 veces con las cachés del server calientes. Ráfaga de arranque (los GET que pide la app al abrir, 6 en paralelo): **531.7 / 573.7 (7)** ms, 22 queries.

| Endpoint | Estado | ms | Queries | KB |
| --- | ---: | ---: | ---: | ---: |
| `/api/auth/session` | 200 | 15.6 / 16.5 | 0 | 0.5 |
| `/api/site-settings` | 200 | 42.5 / 51.5 | 1 | 1.6 |
| `/api/devices` | 200 | 18.9 / 21.9 | 0 | 62.2 |
| `/api/movements` | 200 | 38.3 / 47.5 | 1 | 15.8 |
| `/api/agenda` | 200 | 37.6 / 48.1 | 1 | 10.5 |
| `/api/tasks?space=team` | 200 | 99.8 / 125.7 | 4 | 4.6 |
| `/api/notifications` | 200 | 32 / 48.9 | 1 | 0 |
| `/api/user/prefs` | 200 | 29.2 / 47.7 | 1 | 0 |
| `/api/release-notes/latest` | 200 | 42.4 / 47.6 | 1 | 0 |
| `/api/internal-notes?filter=all` | 200 | 31.1 / 43.7 | 1 | 0 |
| `/api/loans/previous-day` | 200 | 67.1 / 126.6 | 1 | 0.8 |
| `/api/photo-passes` | 200 | 34.2 / 42.9 | 1 | 5.9 |
| `/api/history?kind=loans&limit=50` | 200 | 38.8 / 49.7 | 1 | 11.9 |
| `/api/history?kind=all&limit=50` | 200 | 42.7 / 97.1 | 1 | 8.7 |
| `/api/loans/suggest?q=ale` | 200 | 36.3 / 48.1 | 1 | 0.3 |
| `/api/loans/suggest?q=val` | 200 | 33.8 / 42.1 | 1 | 0.1 |
| `/api/loans/suggest?q=%C3%A1ka` | 200 | 31.9 / 39.9 | 1 | 0.2 |
| `/api/loans/suggest?q=aka` | 200 | 33 / 45.2 | 1 | 0.2 |
| `/api/loans/suggest?q=zqx` | 200 | 34.1 / 117.2 | 1 | 0 |
| `/api/settings/shifts` | 200 | 42.8 / 48.6 | 1 | 0.1 |
| `/api/tasks?space=all` | 200 | 99.9 / 225.6 | 4 | 4.6 |
| `/api/quick-links` | 200 | 29.5 / 48 | 1 | 2.3 |
| `/api/tools/config` | 200 | 182 / 200.1 | 8 | 0.1 |
| `/api/internal-notes?filter=active` | 200 | 34.8 / 47.1 | 1 | 0 |
| `/api/recess-schedules` | 200 | 35.1 / 45.8 | 1 | 0.1 |
| `/api/devices?refresh=1` | 200 | 12.1 / 20.3 | 0 | 62.2 |
| `/api/photo-passes/options` | 200 | 162.8 / 173.5 | 7 | 0.6 |
| `/api/inventory/items` | 200 | 58.3 / 67.7 | 2 | 18.1 |
| `/api/site-assistants` | 200 | 31.2 / 40.6 | 1 | 0.2 |
| `/api/task-columns` | 200 | 43.3 / 50.7 | 1 | 0.3 |
| `/api/tickets` | 200 | 35.4 / 47.4 | 1 | 0 |
| `/api/ticket-templates` | 200 | 30.5 / 47.2 | 1 | 0 |
| `/api/classrooms` | 200 | 38.7 / 55.4 | 1 | 21.4 |
| `/api/analytics/parque` | 200 | 102.6 / 117.2 | 4 | 0.8 |
| `/api/analytics?from=2025-10-19&to=2026-10-19` | 200 | 187.1 / 250.6 | 9 | 61.4 |
| `/api/notifications/prefs` | 200 | 51.2 / 66.2 | 2 | 0.2 |
| `/api/invites` | 200 | 31.7 / 46.5 | 1 | 0 |
| `/api/lifecycle/defaults` | 200 | 57.1 / 67.4 | 2 | 0.4 |
| `/api/allowed-users` | 200 | 298.9 / 347.7 | 15 | 2 |
| `/api/sites` | 200 | 31.1 / 46.8 | 1 | 0.7 |

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

- devices/history (corrida 5): Dispositivos no cargó: no está en la navegación
- ops (corrida 6): Préstamos no cargó: no está en la navegación
- devices/history (corrida 7): Dispositivos no cargó: no está en la navegación

## Cómo reproducir

```bash
node perf/suite.mjs --repo=<checkout> --label=01-etapa1 --runs=7 --cpu=4 --latency=15 --rtt=40 --down=10 --up=5
```

Para medir otra rama sin tocar el repo principal: `git worktree add <tmp> <rama>`, junction de `node_modules` (`cmd /c mklink /J node_modules <repo>\node_modules`), correr la suite con `--repo=<tmp>` y `git worktree remove --force <tmp>`. Usá la misma base (`--db=<snapshot>`) en todas las etiquetas que quieras comparar.
