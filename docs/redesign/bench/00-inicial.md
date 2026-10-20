# Benchmark 00-inicial

Checkout `83f97e4 Merge pull request #5: rendimiento, seguridad, bugs y UX` (83f97e4, HEAD) · 2026-10-20T06:19:39.409Z · generado por `perf/suite.mjs`.

**Condiciones:** 7 corridas por métrica · CPU 4× más lenta · red simulada 40 ms RTT, 10 Mbps bajada, 5 Mbps subida · 15 ms sincrónicos por query en el server (simula Supabase) · Chrome 155.0.8059.85 headless, 1366×800 · Node v24.19.0 · AMD Ryzen 5 5560U with Radeon Graphics ×12. Una pasada de calentamiento sin registrar antes de las corridas; cada medición en un contexto de navegador nuevo, sin service worker.
**Datos (copia de la base, sede NFPT):** 386 equipos, 5145 eventos de préstamo, 5881 movimientos, 258 tareas, 327 actividades de agenda, 250 tickets.

Valores en ms: **mediana / p95** (p95 por rango más cercano; con n = 7 coincide con el máximo). Entre paréntesis, el tamaño de muestra válida. "–" = no se pudo medir (ver Fallas).

## Inicio de la aplicación

| Métrica | Frío (sin caché) | Caliente (recarga con caché) |
| --- | ---: | ---: |
| FCP (primer pintado con contenido) | 884 / 920 (7) | 300 / 336 (7) |
| App visible (navegación + main pintados) | 949.3 / 979.2 (7) | 347.4 / 389 (7) |
| Dashboard con datos (todos los pedidos terminados y pantalla quieta) | 1677.8 / 1706.2 (7) | 1076.5 / 1126.1 (7) |
| Interactiva (TTI: 5 s sin tareas largas) | 1533.5 / 1681 (7) | 1074.1 / 1124.2 (7) |
| TBT (FCP → TTI) | 63 / 96 (7) | 6 / 20 (7) |
| Tareas largas totales (ms) | 527 / 616 (7) | 106 / 174 (7) |
| DOMContentLoaded | 359.8 / 373 (7) | 133.3 / 145.3 (7) |
| Transferido hasta TTI (KB, corrida 1) | Script 227.8, Stylesheet 60.5, Image 45, Fetch 44.5, Document 1.3, Other 0 | Fetch 13.6, Document 0.3, Script 0, Stylesheet 0, Image 0, Other 0 |

## Cambio de módulo

Click en la navegación → **respuesta** (primer frame con un cambio en `<main>`) y **contenido** (datos cargados y pantalla quieta). 1ª vez = primera visita en la sesión (puede bajar el chunk); 2ª = volver a una pantalla ya vista.

| Pantalla | 1ª respuesta | 1ª contenido | 2ª respuesta | 2ª contenido | Fallas |
| --- | ---: | ---: | ---: | ---: | ---: |
| Dashboard | 156.2 / 180.1 | 381 / 576.7 (7) | 151 / 169.1 | 325.2 / 381.8 (7) | 0 |
| Préstamos | 327.6 / 346.3 | 977.2 / 1048.5 (7) | 143.2 / 166.1 | 879 / 891.7 (7) | 0 |
| Dispositivos | 215.7 / 226.2 | 393 / 459.4 (7) | 139.3 / 148.4 | 294.2 / 477.3 (7) | 0 |
| Inventario | 284.6 / 502.1 | 354.4 / 642.2 (7) | 73.9 / 85.9 | 143.1 / 185.7 (7) | 0 |
| Agenda | 190.3 / 218.5 | 190.3 / 218.5 (7) | 115 / 123 | 115 / 123 (7) | 0 |
| Tareas | 113.7 / 138.3 | 416.7 / 435 (7) | 92.2 / 112.4 | 292.5 / 317.8 (7) | 0 |
| Tickets | 101.3 / 109.6 | 1575.5 / 1611.3 (7) | 84.7 / 92.4 | 1154.9 / 1198 (7) | 0 |
| Historial | 135.8 / 147.4 | 311.9 / 336.9 (7) | 129.9 / 141.2 | 315.8 / 435.9 (7) | 0 |
| Analítica | 96.7 / 100.3 | 1255.3 / 1312.7 (7) | 69.1 / 78.1 | 1123.2 / 1214 (7) | 0 |
| Configuración | 476 / 510 | 871.1 / 937.9 (7) | 285.1 / 320.4 | 754.1 / 843.4 (7) | 0 |

## Búsqueda rápida de personas (Préstamos)

Se tipean 3 letras seguidas en el campo Persona; se mide desde la 3ª tecla hasta el frame pintado con la sugerencia en pantalla. Hoy: `LoanForm` espera 220 ms (debounce) y pide `/api/loans/suggest`; el server lee todo `loan_events` de la sede y filtra en JS.

| Caso | Término | Personas que coinciden | Visible en pantalla | Espera antes del pedido | Pedido (navegador) | Endpoint (Node) | Fallas |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| común | `mic` | 9 | 347.1 / 348.6 (7) | 232.4 / 241.8 | 70.9 / 75.7 | 52.5 / 55.9 · 1 q | 0 |
| parcial | `cae` | 9 | 341 / 350.3 (7) | 238.7 / 243 | 72.3 / 75.6 | 41.7 / 57.2 · 1 q | 0 |
| con tilde | `rám` | 6 | 352 / 371.8 (7) | 243.3 / 246.7 | 74.2 / 115.8 | 52.3 / 53.5 · 1 q | 0 |
| sin tilde | `ram` | 6 | 344.7 / 364.9 (7) | 237.9 / 243.4 | 73.8 / 90.9 | 52.4 / 53.6 · 1 q | 0 |
| sin resultados | `zqx` | 0 | 330.8 / 343.8 (7) | 236.2 / 243.2 | 70.1 / 75.8 | 40.3 / 52.9 · 1 q | 0 |

En "sin resultados" la columna visible mide hasta que llega la respuesta vacía y se pinta el frame siguiente.

## Búsqueda flexible de equipos (Dispositivos)

`touch 34` (debería encontrar D1436): **102.7 / 126 (7)** ms desde la última tecla hasta que la tabla se aquieta · filas 386 → 1 · encontrado en 7/7 corridas.

## Historial

| Acción | ms | Filas |
| --- | ---: | ---: |
| Abrir Historial (primera página) | 611.2 / 628.9 (7) | 50 |
| Cargar más | 251.8 / 295.2 (7) | 100 |

## Desplazamiento en listas largas

Scroll programático de 120 px por frame, bajando y subiendo, sobre el contenedor que scrollea. Duración entre frames pintados (16,7 ms = 60 fps).

| Lista | Filas | Frames | p50 frame | p95 frame | Peor frame | Frames > 50 ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Dispositivos (tabla abierta entera) | 386 | 588 | 17.7 / 17.8 | 18.2 / 18.3 (7) | 196.2 / 229.9 | 5 / 8 |
| Historial (hasta 4 páginas) | 200 | 190 | 17.7 / 17.7 | 18.3 / 18.3 (7) | 36.1 / 36.8 | 0 / 0 |

## Operaciones frecuentes

| Operación | UI: click → pantalla quieta | POST (navegador) | API desde Node (POST + ver en /api/devices) | Queries |
| --- | ---: | ---: | ---: | ---: |
| Prestar uno | 516.3 / 536.8 (7) | 203 / 224 | 328.4 / 342.2 | 13 / 13 |
| Devolver uno | 537.1 / 586.5 (7) | 225 / 268 | 359.4 / 398.1 | 14 / 16 |

## API (desde Node, sin red simulada)

Cada endpoint 7 veces con las cachés del server calientes. Ráfaga de arranque (los GET que pide la app al abrir, 6 en paralelo): **531.7 / 557.3 (7)** ms, 22 queries.

| Endpoint | Estado | ms | Queries | KB |
| --- | ---: | ---: | ---: | ---: |
| `/api/auth/session` | 200 | 16 / 119.9 | 0 | 0.5 |
| `/api/site-settings` | 200 | 32.6 / 32.7 | 1 | 1.6 |
| `/api/devices` | 200 | 22.8 / 24.1 | 0 | 311 |
| `/api/movements` | 200 | 48.2 / 49 | 1 | 16.4 |
| `/api/agenda` | 200 | 34.5 / 49.9 | 1 | 57.2 |
| `/api/tasks?space=team` | 200 | 98.8 / 101.8 | 4 | 158.7 |
| `/api/notifications` | 200 | 32.7 / 47.8 | 1 | 4.9 |
| `/api/user/prefs` | 200 | 31.7 / 47.4 | 1 | 0 |
| `/api/release-notes/latest` | 200 | 31.7 / 47.4 | 1 | 0 |
| `/api/internal-notes?filter=all` | 200 | 31.8 / 47.4 | 1 | 0 |
| `/api/loans/previous-day` | 200 | 613.9 / 624.6 | 1 | 1.2 |
| `/api/photo-passes` | 200 | 47.6 / 48 | 1 | 5.9 |
| `/api/history?kind=loans&limit=50` | 200 | 48.1 / 48.6 | 1 | 12.9 |
| `/api/history?kind=all&limit=50` | 200 | 51.7 / 52.6 | 1 | 9 |
| `/api/loans/suggest?q=mic` | 200 | 52.5 / 55.9 | 1 | 1.2 |
| `/api/loans/suggest?q=cae` | 200 | 41.7 / 57.2 | 1 | 1.2 |
| `/api/loans/suggest?q=r%C3%A1m` | 200 | 52.3 / 53.5 | 1 | 0.9 |
| `/api/loans/suggest?q=ram` | 200 | 52.4 / 53.6 | 1 | 0.9 |
| `/api/loans/suggest?q=zqx` | 200 | 40.3 / 52.9 | 1 | 0 |
| `/api/tasks?space=all` | 200 | 85.4 / 114.9 | 4 | 158.7 |
| `/api/settings/shifts` | 200 | 47 / 47.8 | 1 | 0.1 |
| `/api/quick-links` | 200 | 32.1 / 47.5 | 1 | 2.3 |
| `/api/tools/config` | 200 | 157.4 / 158.1 | 8 | 0.2 |
| `/api/internal-notes?filter=active` | 200 | 46.6 / 47.9 | 1 | 0 |
| `/api/recess-schedules` | 200 | 32.1 / 47.9 | 1 | 0.1 |
| `/api/devices?refresh=1` | 200 | 22.8 / 23.8 | 0 | 311 |
| `/api/photo-passes/options` | 200 | 159 / 189.5 | 7 | 6.9 |
| `/api/inventory/items` | 200 | 48.2 / 63.5 | 2 | 18.1 |
| `/api/site-assistants` | 200 | 32.2 / 46.6 | 1 | 0.2 |
| `/api/task-columns` | 200 | 47.5 / 47.8 | 1 | 0.3 |
| `/api/tickets` | 200 | 50.7 / 52.2 | 1 | 135.5 |
| `/api/ticket-templates` | 200 | 32.3 / 46.7 | 1 | 0 |
| `/api/classrooms` | 200 | 33 / 47 | 1 | 21.4 |
| `/api/analytics/parque` | 200 | 95.4 / 109.3 | 4 | 0.8 |
| `/api/analytics?from=2025-10-20&to=2026-10-20` | 200 | 314.9 / 341 | 9 | 1892.7 |
| `/api/notifications/prefs` | 200 | 47.8 / 93.6 | 2 | 0.2 |
| `/api/invites` | 200 | 32.2 / 80.2 | 1 | 0 |
| `/api/lifecycle/defaults` | 200 | 48 / 78.5 | 2 | 0.4 |
| `/api/allowed-users` | 200 | 253.9 / 284.8 | 15 | 2 |
| `/api/sites` | 200 | 31.9 / 47.1 | 1 | 0.7 |

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
