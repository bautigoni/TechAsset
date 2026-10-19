# Benchmark 00-inicial

Checkout `83f97e4 Merge pull request #5: rendimiento, seguridad, bugs y UX` (83f97e4, main) · 2026-10-19T14:37:33.005Z · generado por `perf/suite.mjs`.

**Condiciones:** 7 corridas por métrica · CPU 4× más lenta · red simulada 40 ms RTT, 10 Mbps bajada, 5 Mbps subida · 15 ms sincrónicos por query en el server (simula Supabase) · Chrome 155.0.8059.84 headless, 1366×800 · Node v24.19.0 · AMD Ryzen 5 5560U with Radeon Graphics ×12. Una pasada de calentamiento sin registrar antes de las corridas; cada medición en un contexto de navegador nuevo, sin service worker.
**Datos (copia de la base, sede NFPT):** 76 equipos, 153 eventos de préstamo, 255 movimientos, 8 tareas, 27 actividades de agenda, 0 tickets.

Valores en ms: **mediana / p95** (p95 por rango más cercano; con n = 7 coincide con el máximo). Entre paréntesis, el tamaño de muestra válida. "–" = no se pudo medir (ver Fallas).

## Inicio de la aplicación

| Métrica | Frío (sin caché) | Caliente (recarga con caché) |
| --- | ---: | ---: |
| FCP (primer pintado con contenido) | 1196 / 1600 (7) | 480 / 652 (7) |
| App visible (navegación + main pintados) | 1288.2 / 1732.4 (7) | 598.1 / 755.5 (7) |
| Dashboard con datos (todos los pedidos terminados y pantalla quieta) | 3362.9 / 5052.1 (7) | 1797.6 / 3050.6 (7) |
| Interactiva (TTI: 5 s sin tareas largas) | 1941.9 / 3408.8 (7) | 1442.2 / 2366.1 (7) |
| TBT (FCP → TTI) | 189 / 902 (7) | 76 / 452 (7) |
| Tareas largas totales (ms) | 990 / 2554 (7) | 454 / 935 (7) |
| DOMContentLoaded | 426 / 537.4 (7) | 167.1 / 253.3 (7) |
| Transferido hasta TTI (KB, corrida 1) | Script 227.8, Stylesheet 60.5, Image 45, Fetch 17.8, Document 1.3, Other 0 | Fetch 7.1, Document 0.3, Script 0, Stylesheet 0, Image 0, Other 0 |

## Cambio de módulo

Click en la navegación → **respuesta** (primer frame con un cambio en `<main>`) y **contenido** (datos cargados y pantalla quieta). 1ª vez = primera visita en la sesión (puede bajar el chunk); 2ª = volver a una pantalla ya vista.

| Pantalla | 1ª respuesta | 1ª contenido | 2ª respuesta | 2ª contenido | Fallas |
| --- | ---: | ---: | ---: | ---: | ---: |
| Dashboard | 347.8 / 381.5 | 736 / 866.5 (7) | 346.1 / 414.9 | 764.8 / 1010.2 (7) | 0 |
| Préstamos | 491.9 / 636.2 | 648.8 / 764.5 (7) | 196.8 / 290.5 | 434.8 / 491.8 (7) | 0 |
| Dispositivos | 356.2 / 438.7 | 671 / 885.2 (7) | 323.7 / 469.2 | 700.8 / 893.2 (7) | 0 |
| Inventario | 491.1 / 586.1 | 632 / 666.9 (7) | 138.7 / 184.4 | 252.9 / 294.2 (7) | 0 |
| Agenda | 365.1 / 640.3 | 365.1 / 640.3 (7) | 210.9 / 347.4 | 210.9 / 347.4 (7) | 0 |
| Tareas | 147.5 / 258.6 | 502.2 / 704.2 (7) | 135.6 / 275.2 | 319.9 / 604.5 (7) | 0 |
| Tickets | 160.6 / 375.2 | 245.7 / 421.3 (7) | 168.9 / 299.7 | 260.5 / 443.7 (7) | 0 |
| Historial | 148.1 / 317.3 | 547.5 / 716.4 (7) | 128.4 / 154.8 | 400.4 / 518.2 (7) | 0 |
| Analítica | 201.9 / 253 | 1191.8 / 1379.1 (7) | 130.4 / 194.8 | 1012.3 / 1286.4 (7) | 0 |
| Configuración | 870.3 / 1158.2 | 1206.9 / 1431.8 (7) | 724.5 / 862.9 | 1105.2 / 1621.8 (7) | 0 |

## Búsqueda rápida de personas (Préstamos)

Se tipean 3 letras seguidas en el campo Persona; se mide desde la 3ª tecla hasta el frame pintado con la sugerencia en pantalla. Hoy: `LoanForm` espera 220 ms (debounce) y pide `/api/loans/suggest`; el server lee todo `loan_events` de la sede y filtra en JS.

| Caso | Término | Personas que coinciden | Visible en pantalla | Espera antes del pedido | Pedido (navegador) | Endpoint (Node) | Fallas |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| común | `ale` | 2 | 361.8 / 462.9 (7) | 245.8 / 297.1 | 74.4 / 104 | 34 / 46.2 · 1 q | 0 |
| parcial | `val` | 1 | 350.4 / 394.4 (7) | 242.1 / 276.7 | 70.9 / 80.8 | 34 / 41.3 · 1 q | 0 |
| con tilde | `áka` | 2 | 357.9 / 433.2 (7) | 246 / 290.6 | 71.4 / 80 | 32.1 / 46.2 · 1 q | 0 |
| sin tilde | `aka` | 2 | 347.3 / 360.2 (7) | 244.2 / 250.3 | 69.6 / 81.3 | 30.1 / 40 · 1 q | 0 |
| sin resultados | `zqx` | 0 | 332.6 / 339.7 (7) | 233.2 / 246.7 | 69.5 / 88.2 | 45.1 / 52.3 · 1 q | 0 |

En "sin resultados" la columna visible mide hasta que llega la respuesta vacía y se pinta el frame siguiente.

## Búsqueda flexible de equipos (Dispositivos)

`touch 34` (debería encontrar D1436): **110 / 298 (7)** ms desde la última tecla hasta que la tabla se aquieta · filas 76 → 1 · encontrado en 7/7 corridas.

## Historial

| Acción | ms | Filas |
| --- | ---: | ---: |
| Abrir Historial (primera página) | 570.7 / 904 (7) | 50 |
| Cargar más | 397.2 / 606.8 (7) | 100 |

## Desplazamiento en listas largas

Scroll programático de 120 px por frame, bajando y subiendo, sobre el contenedor que scrollea. Duración entre frames pintados (16,7 ms = 60 fps).

| Lista | Filas | Frames | p50 frame | p95 frame | Peor frame | Frames > 50 ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Dispositivos (tabla abierta entera) | 76 | 110 | 16.7 / 16.7 | 16.9 / 33.5 (7) | 50.2 / 83.6 | 2 / 5 |
| Historial (hasta 4 páginas) | 159 | 138 | 16.7 / 16.7 | 16.9 / 16.9 (7) | 33.5 / 585.1 | 0 / 2 |

## Operaciones frecuentes

| Operación | UI: click → pantalla quieta | POST (navegador) | API desde Node (POST + ver en /api/devices) | Queries |
| --- | ---: | ---: | ---: | ---: |
| Prestar uno | 487.7 / 678.5 (7) | 188 / 217 | 339 / 428.1 | 13 / 15 |
| Devolver uno | 502.9 / 736.2 (7) | 205 / 229 | 345.1 / 428.5 | 14 / 14 |

## API (desde Node, sin red simulada)

Cada endpoint 7 veces con las cachés del server calientes. Ráfaga de arranque (los GET que pide la app al abrir, 6 en paralelo): **698.7 / 949.3 (7)** ms, 22 queries.

| Endpoint | Estado | ms | Queries | KB |
| --- | ---: | ---: | ---: | ---: |
| `/api/auth/session` | 200 | 10.5 / 17.2 | 0 | 0.5 |
| `/api/site-settings` | 200 | 43.5 / 228.4 | 1 | 1.6 |
| `/api/devices` | 200 | 12.9 / 23.6 | 0 | 62.2 |
| `/api/movements` | 200 | 47.3 / 76.9 | 1 | 15.8 |
| `/api/agenda` | 200 | 43 / 49.2 | 1 | 10.5 |
| `/api/tasks?space=team` | 200 | 109.2 / 179.8 | 4 | 4.6 |
| `/api/notifications` | 200 | 37.2 / 69.2 | 1 | 0 |
| `/api/user/prefs` | 200 | 39 / 45.2 | 1 | 0 |
| `/api/release-notes/latest` | 200 | 36.6 / 71 | 1 | 0 |
| `/api/internal-notes?filter=all` | 200 | 32 / 60 | 1 | 0 |
| `/api/loans/previous-day` | 200 | 93.2 / 142.6 | 1 | 0.8 |
| `/api/photo-passes` | 200 | 39 / 49.7 | 1 | 5.9 |
| `/api/history?kind=loans&limit=50` | 200 | 45.4 / 92.2 | 1 | 12 |
| `/api/history?kind=all&limit=50` | 200 | 41.1 / 49.2 | 1 | 8.7 |
| `/api/loans/suggest?q=ale` | 200 | 34 / 46.2 | 1 | 0.3 |
| `/api/loans/suggest?q=val` | 200 | 34 / 41.3 | 1 | 0.1 |
| `/api/loans/suggest?q=%C3%A1ka` | 200 | 32.1 / 46.2 | 1 | 0.2 |
| `/api/loans/suggest?q=aka` | 200 | 30.1 / 40 | 1 | 0.2 |
| `/api/loans/suggest?q=zqx` | 200 | 45.1 / 52.3 | 1 | 0 |
| `/api/tasks?space=all` | 200 | 108.7 / 135.3 | 4 | 4.6 |
| `/api/settings/shifts` | 200 | 43.1 / 79.5 | 1 | 0.1 |
| `/api/quick-links` | 200 | 31 / 46.5 | 1 | 2.3 |
| `/api/tools/config` | 200 | 188.6 / 216.2 | 8 | 0.1 |
| `/api/internal-notes?filter=active` | 200 | 32.9 / 48.7 | 1 | 0 |
| `/api/recess-schedules` | 200 | 33.4 / 42.9 | 1 | 0.1 |
| `/api/devices?refresh=1` | 200 | 9.7 / 18.2 | 0 | 62.2 |
| `/api/photo-passes/options` | 200 | 143.6 / 180.4 | 7 | 0.6 |
| `/api/inventory/items` | 200 | 58.8 / 94.9 | 2 | 18.1 |
| `/api/site-assistants` | 200 | 40.2 / 47.1 | 1 | 0.2 |
| `/api/task-columns` | 200 | 34.7 / 38.2 | 1 | 0.3 |
| `/api/tickets` | 200 | 33.2 / 47.6 | 1 | 0 |
| `/api/ticket-templates` | 200 | 34.2 / 68.3 | 1 | 0 |
| `/api/classrooms` | 200 | 43 / 75 | 1 | 21.4 |
| `/api/analytics/parque` | 200 | 105.2 / 119.9 | 4 | 0.8 |
| `/api/analytics?from=2025-10-19&to=2026-10-19` | 200 | 233.2 / 281.7 | 9 | 56.6 |
| `/api/notifications/prefs` | 200 | 61.1 / 65.7 | 2 | 0.2 |
| `/api/invites` | 200 | 33.3 / 47 | 1 | 0 |
| `/api/lifecycle/defaults` | 200 | 66.9 / 79.7 | 2 | 0.4 |
| `/api/allowed-users` | 200 | 325.7 / 472.3 | 15 | 2 |
| `/api/sites` | 200 | 37.6 / 47.6 | 1 | 0.7 |

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
