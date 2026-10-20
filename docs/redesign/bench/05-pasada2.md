# Benchmark 05-pasada2

Checkout `5b6ca7a arranque: la vista que reemplaza al esqueleto no repite la animación de entrada` (5b6ca7a, worktree-agent-acf1372c3ffbbb1aa) · 2026-10-20T12:29:13.011Z · generado por `perf/suite.mjs`.

**Condiciones:** 7 corridas por métrica · CPU 4× más lenta · red simulada 40 ms RTT, 10 Mbps bajada, 5 Mbps subida · 15 ms sincrónicos por query en el server (simula Supabase) · Chrome 155.0.8059.85 headless, 1366×800 · Node v24.19.0 · AMD Ryzen 5 5560U with Radeon Graphics ×12. Una pasada de calentamiento sin registrar antes de las corridas; cada medición en un contexto de navegador nuevo, sin service worker.
**Datos (copia de la base, sede NFPT):** 386 equipos, 5145 eventos de préstamo, 5881 movimientos, 258 tareas, 327 actividades de agenda, 250 tickets.

Valores en ms: **mediana / p95** (p95 por rango más cercano; con n = 7 coincide con el máximo). Entre paréntesis, el tamaño de muestra válida. "–" = no se pudo medir (ver Fallas).

## Inicio de la aplicación

| Métrica | Frío (sin caché) | Caliente (recarga con caché) |
| --- | ---: | ---: |
| FCP (primer pintado con contenido) | 720 / 752 (7) | 364 / 380 (7) |
| App visible (navegación + main pintados) | 790.7 / 834.4 (7) | 407.9 / 425.9 (7) |
| Dashboard a la vista (sin pedidos en vuelo ni esqueletos en la ventana) | 1402.4 / 1461.9 (7) | 883.1 / 927.7 (7) |
| Dashboard con datos (todos los pedidos terminados y pantalla quieta) | 1402.4 / 1461.9 (7) | 883.1 / 927.7 (7) |
| Interactiva (TTI: 5 s sin tareas largas) | 1344.2 / 1413.4 (7) | 740.6 / 823.8 (7) |
| TBT (FCP → TTI) | 187 / 235 (7) | 77 / 113 (7) |
| Tareas largas totales (ms) | 746 / 802 (7) | 279 / 316 (7) |
| DOMContentLoaded | 422.4 / 425.6 (7) | 155.6 / 182.4 (7) |
| Transferido hasta TTI (KB, corrida 1) | Script 426.3, Stylesheet 79.2, Font 52.1, Fetch 34.2, Document 1.9, Image 1.5, Other 0 | Fetch 3.1, Document 0.3, Script 0, Stylesheet 0, Font 0, Image 0, Other 0 |

## Cambio de módulo

Click en la navegación → **respuesta** (primer frame con un cambio en `<main>`), **a la vista** (primer frame con cambio en `<main>` sin pedidos de la acción en vuelo ni esqueletos dentro de la ventana: lo que se ve listo aunque abajo del pliegue sigan montándose secciones) y **contenido** (datos cargados y pantalla quieta). 1ª vez = primera visita en la sesión (puede bajar el chunk); 2ª = volver a una pantalla ya vista.

| Pantalla | 1ª respuesta | 1ª a la vista | 1ª contenido | 2ª respuesta | 2ª a la vista | 2ª contenido | Fallas |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Dashboard | 195.8 / 222.5 | 253.4 / 313.1 | 253.4 / 313.1 (7) | 201.7 / 377.5 | 201.7 / 475.6 | 201.7 / 475.6 (7) | 0 |
| Préstamos | 360.6 / 371.1 | 467.3 / 511.2 | 467.3 / 511.2 (7) | 156.8 / 170.5 | 241 / 267.2 | 241 / 267.2 (7) | 0 |
| Dispositivos | 205.2 / 212.2 | 381.7 / 399.9 | 566.1 / 583 (7) | 139.7 / 159.2 | 301.7 / 326.2 | 506.6 / 521.1 (7) | 0 |
| Inventario | 128.6 / 138.1 | 208.9 / 220.6 | 208.9 / 220.6 (7) | 93.5 / 113.7 | 168.2 / 203.6 | 168.2 / 203.6 (7) | 0 |
| Agenda | 155 / 160.3 | 155 / 160.3 | 155 / 160.3 (7) | 116.6 / 127.3 | 116.6 / 127.3 | 116.6 / 127.3 (7) | 0 |
| Tareas | 327.6 / 368.1 | 437.6 / 489.7 | 437.6 / 489.7 (7) | 253.3 / 285.2 | 253.3 / 285.2 | 253.3 / 285.2 (7) | 0 |
| Tickets | 112.1 / 156.8 | 365.2 / 413.3 | 365.2 / 413.3 (7) | 92.5 / 100.9 | 266.5 / 283.9 | 266.5 / 283.9 (7) | 0 |
| Historial | 97.5 / 168.6 | 348.4 / 671.5 | 348.4 / 671.5 (7) | 78.2 / 88.6 | 266.6 / 271.2 | 266.6 / 271.2 (7) | 0 |
| Analítica | 132.4 / 182.3 | 578.1 / 835 | 1816 / 2039.6 (7) | 107.3 / 287.2 | 628.4 / 1055 | 1476.2 / 1565.7 (7) | 0 |
| Configuración | 129.4 / 149.6 | 129.4 / 149.6 | 129.4 / 149.6 (7) | 102.6 / 131 | 102.6 / 131 | 102.6 / 131 (7) | 0 |

## Búsqueda rápida de personas (Préstamos)

Se tipean 3 letras seguidas en el campo Persona; se mide desde la 3ª tecla hasta el frame pintado con la sugerencia en pantalla. Hoy: `LoanForm` espera 220 ms (debounce) y pide `/api/loans/suggest`; el server lee todo `loan_events` de la sede y filtra en JS.

| Caso | Término | Personas que coinciden | Visible en pantalla | Espera antes del pedido | Pedido (navegador) | Endpoint (Node) | Fallas |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| común | `mic` | 9 | 114.2 / 149.7 (7) | – | – | 17 / 17.2 · 0 q | 0 |
| parcial | `cae` | 9 | 101 / 160.4 (7) | – | – | 16.9 / 17.3 · 0 q | 0 |
| con tilde | `rám` | 6 | 87.6 / 108.9 (7) | – | – | 16.1 / 17.2 · 0 q | 0 |
| sin tilde | `ram` | 6 | 107.5 / 123.1 (7) | – | – | 16.3 / 16.6 · 0 q | 0 |
| sin resultados | `zqx` | 0 | 0 / 0 (7) | – | – | 16.2 / 23.9 · 0 q | 0 |

En "sin resultados" la columna visible mide hasta que llega la respuesta vacía y se pinta el frame siguiente.

## Búsqueda flexible de equipos (Dispositivos)

`touch 34` (debería encontrar D1436): **126.6 / 170.4 (7)** ms desde la última tecla hasta que la tabla se aquieta · filas 387 → 2 · encontrado en 7/7 corridas.

## Historial

| Acción | ms | Filas |
| --- | ---: | ---: |
| Abrir Historial (primera página) | 593.2 / 808.3 (7) | 56 |
| Cargar más | 405.2 / 425.3 (7) | 109 |

## Desplazamiento en listas largas

Scroll programático de 120 px por frame, bajando y subiendo, sobre el contenedor que scrollea. Duración entre frames pintados (16,7 ms = 60 fps).

| Lista | Filas | Frames | p50 frame | p95 frame | Peor frame | Frames > 50 ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Dispositivos (tabla abierta entera) | 387 | 296 | 16.7 / 16.7 | 33.5 / 33.5 (7) | 736.3 / 1271.2 | 3 / 10 |
| Historial (hasta 4 páginas) | 215 | 182 | 16.7 / 16.7 | 16.8 / 16.9 (7) | 234 / 384.7 | 1 / 2 |

## Operaciones frecuentes

| Operación | UI: click → pantalla quieta | POST (navegador) | API desde Node (POST + ver en /api/devices) | Queries |
| --- | ---: | ---: | ---: | ---: |
| Prestar uno | 402.2 / 632 (7) | 130 / 202 | 92.1 / 107 | 3 / 3 |
| Devolver uno | 307.9 / 444.8 (7) | 111 / 209 | 112.1 / 125.2 | 4 / 4 |

## API (desde Node, sin red simulada)

Cada endpoint 7 veces con las cachés del server calientes. Ráfaga de arranque (los GET que pide la app al abrir, 6 en paralelo): **314.1 / 344.5 (7)** ms, 11 queries.

| Endpoint | Estado | ms | Queries | KB |
| --- | ---: | ---: | ---: | ---: |
| `/api/auth/session` | 200 | 11 / 16.3 | 0 | 0.5 |
| `/api/site-settings` | 200 | 30.9 / 34 | 1 | 1.6 |
| `/api/devices` | 200 | 23.5 / 26.3 | 0 | 311 |
| `/api/movements` | 200 | 49.4 / 50.6 | 1 | 16.4 |
| `/api/agenda` | 200 | 44.5 / 57.9 | 1 | 57.2 |
| `/api/tasks?space=team` | 200 | 21.8 / 22.6 | 0 | 159 |
| `/api/notifications` | 200 | 32.9 / 48.8 | 1 | 4.9 |
| `/api/user/prefs` | 200 | 31.8 / 47.3 | 1 | 0 |
| `/api/release-notes/latest` | 200 | 31.6 / 47 | 1 | 0 |
| `/api/internal-notes?filter=all` | 200 | 47.4 / 49.9 | 1 | 0 |
| `/api/loans/previous-day` | 200 | 16.9 / 17.5 | 0 | 2.2 |
| `/api/photo-passes` | 200 | 32.5 / 48.9 | 1 | 5.9 |
| `/api/history?kind=loans&limit=50` | 200 | 48.1 / 48.7 | 1 | 12.9 |
| `/api/history?kind=all&limit=50` | 200 | 50.4 / 51.8 | 1 | 9 |
| `/api/loans/suggest?q=mic` | 200 | 17 / 17.2 | 0 | 1.2 |
| `/api/loans/suggest?q=cae` | 200 | 16.9 / 17.3 | 0 | 1.2 |
| `/api/loans/suggest?q=r%C3%A1m` | 200 | 16.1 / 17.2 | 0 | 0.9 |
| `/api/loans/suggest?q=ram` | 200 | 16.3 / 16.6 | 0 | 0.9 |
| `/api/loans/suggest?q=zqx` | 200 | 16.2 / 23.9 | 0 | 0 |
| `/api/settings/shifts` | 200 | 32.4 / 51.7 | 1 | 0.1 |
| `/api/tasks?space=all` | 200 | 19.5 / 21.7 | 0 | 159 |
| `/api/quick-links` | 200 | 32.8 / 48.7 | 1 | 2.4 |
| `/api/tools/config` | 200 | 43.3 / 47.6 | 1 | 0.2 |
| `/api/recess-schedules` | 200 | 32.4 / 47.3 | 1 | 0.1 |
| `/api/internal-notes?filter=active` | 200 | 43.3 / 46.9 | 1 | 0 |
| `/api/loans/people` | 200 | 17.7 / 18.4 | 0 | 57.2 |
| `/api/devices/panel-counts` | 200 | 32.5 / 47.6 | 1 | 0 |
| `/api/inventory/items` | 200 | 48.7 / 62.8 | 2 | 18.1 |
| `/api/task-columns` | 200 | 31.8 / 47.2 | 1 | 0.3 |
| `/api/site-assistants` | 200 | 31.6 / 48.3 | 1 | 0.2 |
| `/api/tickets` | 200 | 39.5 / 52.5 | 1 | 135.5 |
| `/api/ticket-templates` | 200 | 31.8 / 59.6 | 1 | 0 |
| `/api/classrooms` | 200 | 29.9 / 39.4 | 1 | 21.4 |
| `/api/analytics?from=2025-10-20&to=2026-10-20` | 200 | 178.5 / 223.7 | 4 | 112.6 |
| `/api/analytics/parque` | 200 | 96.2 / 111.6 | 4 | 0.8 |
| `/api/allowed-users` | 200 | 65.8 / 112.8 | 3 | 2.3 |
| `/api/invites` | 200 | 28.3 / 33.5 | 1 | 0 |

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
node perf/suite.mjs --repo=<checkout> --label=05-pasada2 --runs=7 --cpu=4 --latency=15 --rtt=40 --down=10 --up=5
```

Para medir otra rama sin tocar el repo principal: `git worktree add <tmp> <rama>`, junction de `node_modules` (`cmd /c mklink /J node_modules <repo>\node_modules`), correr la suite con `--repo=<tmp>` y `git worktree remove --force <tmp>`. Usá la misma base (`--db=<snapshot>`) en todas las etiquetas que quieras comparar.
