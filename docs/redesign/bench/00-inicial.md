# Benchmark 00-inicial

Checkout `83f97e4 Merge pull request #5: rendimiento, seguridad, bugs y UX` (83f97e4, main) · 2026-10-19T15:18:10.649Z · generado por `perf/suite.mjs`.

**Condiciones:** 7 corridas por métrica · CPU 4× más lenta · red simulada 40 ms RTT, 10 Mbps bajada, 5 Mbps subida · 15 ms sincrónicos por query en el server (simula Supabase) · Chrome 155.0.8059.84 headless, 1366×800 · Node v24.19.0 · AMD Ryzen 5 5560U with Radeon Graphics ×12. Una pasada de calentamiento sin registrar antes de las corridas; cada medición en un contexto de navegador nuevo, sin service worker.
**Datos (copia de la base, sede NFPT):** 76 equipos, 153 eventos de préstamo, 255 movimientos, 8 tareas, 27 actividades de agenda, 0 tickets.

Valores en ms: **mediana / p95** (p95 por rango más cercano; con n = 7 coincide con el máximo). Entre paréntesis, el tamaño de muestra válida. "–" = no se pudo medir (ver Fallas).

## Inicio de la aplicación

| Métrica | Frío (sin caché) | Caliente (recarga con caché) |
| --- | ---: | ---: |
| FCP (primer pintado con contenido) | 968 / 1372 (7) | 368 / 640 (7) |
| App visible (navegación + main pintados) | 1037.7 / 1456.4 (7) | 443.4 / 813.9 (7) |
| Dashboard con datos (todos los pedidos terminados y pantalla quieta) | 3199.6 / 4232.5 (7) | 1481.6 / 2273.9 (7) |
| Interactiva (TTI: 5 s sin tareas largas) | 1926.5 / 2805.4 (7) | 1108.3 / 1822 (7) |
| TBT (FCP → TTI) | 263 / 548 (7) | 38 / 113 (7) |
| Tareas largas totales (ms) | 1005 / 1729 (7) | 254 / 714 (7) |
| DOMContentLoaded | 378.5 / 427.7 (7) | 144.4 / 167.1 (7) |
| Transferido hasta TTI (KB, corrida 1) | Script 227.8, Stylesheet 60.5, Image 45, Fetch 17.8, Document 1.3, Other 0 | Fetch 6.9, Document 0.3, Script 0, Stylesheet 0, Other 0, Image 0 |

## Cambio de módulo

Click en la navegación → **respuesta** (primer frame con un cambio en `<main>`) y **contenido** (datos cargados y pantalla quieta). 1ª vez = primera visita en la sesión (puede bajar el chunk); 2ª = volver a una pantalla ya vista.

| Pantalla | 1ª respuesta | 1ª contenido | 2ª respuesta | 2ª contenido | Fallas |
| --- | ---: | ---: | ---: | ---: | ---: |
| Dashboard | 163.9 / 292.3 | 330.9 / 587 (7) | 209.5 / 470.2 | 429.6 / 987.5 (7) | 0 |
| Préstamos | 442.3 / 638.3 | 561.3 / 827.5 (7) | 165.6 / 237.8 | 305.4 / 444.4 (7) | 0 |
| Dispositivos | 348.8 / 423.3 | 628.8 / 755 (7) | 151 / 206.3 | 479.4 / 677.3 (7) | 0 |
| Inventario | 377.9 / 631.8 | 545.3 / 778.5 (7) | 92.6 / 121.6 | 127.2 / 275.5 (7) | 0 |
| Agenda | 307.5 / 548.2 | 307.5 / 548.2 (7) | 118.7 / 249.7 | 118.7 / 249.7 (7) | 0 |
| Tareas | 177.9 / 258.8 | 598.2 / 721.6 (7) | 132.4 / 184.6 | 168 / 462.1 (7) | 0 |
| Tickets | 145.9 / 180.8 | 187 / 269.2 (7) | 110.4 / 140.6 | 116.6 / 231.4 (7) | 0 |
| Historial | 115.6 / 196.3 | 336.1 / 501.2 (7) | 123.5 / 206.8 | 200.1 / 421.5 (7) | 0 |
| Analítica | 137.3 / 252 | 888 / 1146 (7) | 197.3 / 577 | 230.5 / 775.9 (7) | 0 |
| Configuración | 615.8 / 659 | 924 / 1056.2 (7) | 429.6 / 778.4 | 429.6 / 778.4 (7) | 0 |

## Búsqueda rápida de personas (Préstamos)

Se tipean 3 letras seguidas en el campo Persona; se mide desde la 3ª tecla hasta el frame pintado con la sugerencia en pantalla. Hoy: `LoanForm` espera 220 ms (debounce) y pide `/api/loans/suggest`; el server lee todo `loan_events` de la sede y filtra en JS.

| Caso | Término | Personas que coinciden | Visible en pantalla | Espera antes del pedido | Pedido (navegador) | Endpoint (Node) | Fallas |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| común | `ale` | 2 | 343.6 / 367.7 (7) | 237.2 / 264.8 | 76 / 108.8 | 34.6 / 57.3 · 1 q | 0 |
| parcial | `val` | 1 | 338.5 / 383.1 (7) | 238.6 / 252.3 | 72.9 / 103 | 34.5 / 38.8 · 1 q | 0 |
| con tilde | `áka` | 2 | 344.4 / 358.4 (7) | 241.9 / 247.2 | 69.3 / 87.4 | 29.9 / 41.2 · 1 q | 0 |
| sin tilde | `aka` | 2 | 334.6 / 378.1 (7) | 235 / 270.4 | 67.6 / 79 | 34.5 / 50.4 · 1 q | 0 |
| sin resultados | `zqx` | 0 | 327.5 / 337.7 (7) | 233.4 / 238.2 | 68.4 / 81.1 | 36.1 / 48.2 · 1 q | 0 |

En "sin resultados" la columna visible mide hasta que llega la respuesta vacía y se pinta el frame siguiente.

## Búsqueda flexible de equipos (Dispositivos)

`touch 34` (debería encontrar D1436): **74 / 120.5 (7)** ms desde la última tecla hasta que la tabla se aquieta · filas 76 → 1 · encontrado en 7/7 corridas.

## Historial

| Acción | ms | Filas |
| --- | ---: | ---: |
| Abrir Historial (primera página) | 475.6 / 551.2 (7) | 50 |
| Cargar más | 364.6 / 548.5 (7) | 100 |

## Desplazamiento en listas largas

Scroll programático de 120 px por frame, bajando y subiendo, sobre el contenedor que scrollea. Duración entre frames pintados (16,7 ms = 60 fps).

| Lista | Filas | Frames | p50 frame | p95 frame | Peor frame | Frames > 50 ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Dispositivos (tabla abierta entera) | 76 | 110 | 16.7 / 16.7 | 33.4 / 33.5 (7) | 50.1 / 66.9 | 1 / 3 |
| Historial (hasta 4 páginas) | 159 | 138 | 16.7 / 16.7 | 16.9 / 20.4 (7) | 33.7 / 67 | 0 / 2 |

## Operaciones frecuentes

| Operación | UI: click → pantalla quieta | POST (navegador) | API desde Node (POST + ver en /api/devices) | Queries |
| --- | ---: | ---: | ---: | ---: |
| Prestar uno | 497.3 / 545.8 (7) | 171 / 250 | 368 / 443.4 | 13 / 13 |
| Devolver uno | 466 / 673.7 (7) | 171 / 317 | 396.9 / 532.4 | 14 / 16 |

## API (desde Node, sin red simulada)

Cada endpoint 7 veces con las cachés del server calientes. Ráfaga de arranque (los GET que pide la app al abrir, 6 en paralelo): **604.7 / 805.6 (7)** ms, 22 queries.

| Endpoint | Estado | ms | Queries | KB |
| --- | ---: | ---: | ---: | ---: |
| `/api/auth/session` | 200 | 2.1 / 15.8 | 0 | 0.5 |
| `/api/site-settings` | 200 | 33.1 / 45 | 1 | 1.6 |
| `/api/devices` | 200 | 11.2 / 18.1 | 0 | 62.2 |
| `/api/movements` | 200 | 34.3 / 41 | 1 | 15.8 |
| `/api/agenda` | 200 | 34.7 / 37.2 | 1 | 10.5 |
| `/api/tasks?space=team` | 200 | 97.7 / 168 | 4 | 4.6 |
| `/api/notifications` | 200 | 44.2 / 62.7 | 1 | 0 |
| `/api/user/prefs` | 200 | 35.9 / 42 | 1 | 0 |
| `/api/release-notes/latest` | 200 | 41.1 / 60.9 | 1 | 0 |
| `/api/internal-notes?filter=all` | 200 | 31 / 111.7 | 1 | 0 |
| `/api/loans/previous-day` | 200 | 86.9 / 203.7 | 1 | 0.8 |
| `/api/photo-passes` | 200 | 37.9 / 68.2 | 1 | 5.9 |
| `/api/history?kind=loans&limit=50` | 200 | 40.7 / 62.2 | 1 | 12 |
| `/api/history?kind=all&limit=50` | 200 | 49.4 / 60.6 | 1 | 8.7 |
| `/api/loans/suggest?q=ale` | 200 | 34.6 / 57.3 | 1 | 0.3 |
| `/api/loans/suggest?q=val` | 200 | 34.5 / 38.8 | 1 | 0.1 |
| `/api/loans/suggest?q=%C3%A1ka` | 200 | 29.9 / 41.2 | 1 | 0.2 |
| `/api/loans/suggest?q=aka` | 200 | 34.5 / 50.4 | 1 | 0.2 |
| `/api/loans/suggest?q=zqx` | 200 | 36.1 / 48.2 | 1 | 0 |
| `/api/tasks?space=all` | 200 | 129.5 / 325.5 | 4 | 4.6 |
| `/api/settings/shifts` | 200 | 41.6 / 70.8 | 1 | 0.1 |
| `/api/quick-links` | 200 | 38.2 / 85.7 | 1 | 2.3 |
| `/api/tools/config` | 200 | 215.5 / 250.8 | 8 | 0.1 |
| `/api/internal-notes?filter=active` | 200 | 27.7 / 29.2 | 1 | 0 |
| `/api/recess-schedules` | 200 | 34.2 / 48.9 | 1 | 0.1 |
| `/api/devices?refresh=1` | 200 | 20.4 / 22 | 0 | 62.2 |
| `/api/photo-passes/options` | 200 | 170.9 / 187.3 | 7 | 0.6 |
| `/api/inventory/items` | 200 | 54.6 / 69.3 | 2 | 18.1 |
| `/api/site-assistants` | 200 | 32.9 / 44.8 | 1 | 0.2 |
| `/api/task-columns` | 200 | 31.3 / 41.6 | 1 | 0.3 |
| `/api/tickets` | 200 | 34.4 / 40.5 | 1 | 0 |
| `/api/ticket-templates` | 200 | 33.8 / 40.3 | 1 | 0 |
| `/api/classrooms` | 200 | 42.4 / 62.3 | 1 | 21.4 |
| `/api/analytics/parque` | 200 | 102.5 / 133.2 | 4 | 0.8 |
| `/api/analytics?from=2025-10-19&to=2026-10-19` | 200 | 264.1 / 378.4 | 9 | 56.6 |
| `/api/notifications/prefs` | 200 | 65.7 / 85.1 | 2 | 0.2 |
| `/api/invites` | 200 | 35.2 / 46.2 | 1 | 0 |
| `/api/lifecycle/defaults` | 200 | 67.4 / 97.8 | 2 | 0.4 |
| `/api/allowed-users` | 200 | 415.2 / 781 | 15 | 2 |
| `/api/sites` | 200 | 32.3 / 51.4 | 1 | 0.7 |

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
