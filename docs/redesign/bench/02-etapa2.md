# Benchmark 02-etapa2

Checkout `cd38156 docs: brief común de implementación de pantallas` (cd38156, HEAD) · 2026-10-19T15:44:08.928Z · generado por `perf/suite.mjs`.

**Condiciones:** 7 corridas por métrica · CPU 4× más lenta · red simulada 40 ms RTT, 10 Mbps bajada, 5 Mbps subida · 15 ms sincrónicos por query en el server (simula Supabase) · Chrome 155.0.8059.84 headless, 1366×800 · Node v24.19.0 · AMD Ryzen 5 5560U with Radeon Graphics ×12. Una pasada de calentamiento sin registrar antes de las corridas; cada medición en un contexto de navegador nuevo, sin service worker.
**Datos (copia de la base, sede NFPT):** 76 equipos, 153 eventos de préstamo, 255 movimientos, 8 tareas, 27 actividades de agenda, 0 tickets.

Valores en ms: **mediana / p95** (p95 por rango más cercano; con n = 7 coincide con el máximo). Entre paréntesis, el tamaño de muestra válida. "–" = no se pudo medir (ver Fallas).

## Inicio de la aplicación

| Métrica | Frío (sin caché) | Caliente (recarga con caché) |
| --- | ---: | ---: |
| FCP (primer pintado con contenido) | 1512 / 2424 (7) | 524 / 812 (7) |
| App visible (navegación + main pintados) | 1721.5 / 2591.1 (7) | 644.1 / 888.3 (7) |
| Dashboard con datos (todos los pedidos terminados y pantalla quieta) | 4791.3 / 6242 (7) | 2762.7 / 3843.6 (7) |
| Interactiva (TTI: 5 s sin tareas largas) | 3345.2 / 5328.2 (7) | 2941.8 / 3884.5 (7) |
| TBT (FCP → TTI) | 636.2 / 907 (7) | 236 / 907.3 (7) |
| Tareas largas totales (ms) | 1836 / 3111 (7) | 919 / 2023 (7) |
| DOMContentLoaded | 633.3 / 1053 (7) | 170.2 / 288.1 (7) |
| Transferido hasta TTI (KB, corrida 1) | Script 261.4, Font 52.1, Stylesheet 50.3, Fetch 17.8, Document 1.9, Other 0, Image 0 | Fetch 6.9, Document 0.3, Script 0, Stylesheet 0, Font 0, Image 0, Other 0 |

## Cambio de módulo

Click en la navegación → **respuesta** (primer frame con un cambio en `<main>`) y **contenido** (datos cargados y pantalla quieta). 1ª vez = primera visita en la sesión (puede bajar el chunk); 2ª = volver a una pantalla ya vista.

| Pantalla | 1ª respuesta | 1ª contenido | 2ª respuesta | 2ª contenido | Fallas |
| --- | ---: | ---: | ---: | ---: | ---: |
| Dashboard | 349.1 / 775 | 711.1 / 1229.5 (7) | 595.2 / 868.9 | 992.3 / 1335.5 (7) | 0 |
| Préstamos | 479.2 / 665.6 | 672.2 / 935 (7) | 275.7 / 539.4 | 466.3 / 735.7 (7) | 0 |
| Dispositivos | 382 / 519.1 | 874.7 / 962.2 (7) | 303 / 343.5 | 778.8 / 867.6 (7) | 0 |
| Inventario | 612.7 / 717.3 | 760.5 / 1033.1 (7) | 128.2 / 308.5 | 294.8 / 478.6 (7) | 0 |
| Agenda | 384.7 / 501.1 | 384.7 / 501.1 (7) | 245.7 / 379.4 | 245.7 / 379.4 (7) | 0 |
| Tareas | 240.2 / 294.8 | 714.8 / 877.2 (7) | 181 / 274.3 | 461 / 680.6 (7) | 0 |
| Tickets | 156.2 / 303 | 251.9 / 441.5 (7) | 150 / 181 | 277.9 / 287.3 (7) | 0 |
| Historial | 137.1 / 258.3 | 473.7 / 659 (7) | 135.3 / 185.7 | 451.1 / 771.7 (7) | 0 |
| Analítica | 235.7 / 264.1 | 1245.6 / 1423.1 (7) | 146.6 / 248.8 | 1128.4 / 1309.8 (7) | 0 |
| Configuración | 1207.4 / 1427.6 | 1433.6 / 1685.2 (7) | 877.4 / 1252.4 | 1022.4 / 1790.6 (7) | 0 |

## Búsqueda rápida de personas (Préstamos)

Se tipean 3 letras seguidas en el campo Persona; se mide desde la 3ª tecla hasta el frame pintado con la sugerencia en pantalla. Hoy: `LoanForm` espera 220 ms (debounce) y pide `/api/loans/suggest`; el server lee todo `loan_events` de la sede y filtra en JS.

| Caso | Término | Personas que coinciden | Visible en pantalla | Espera antes del pedido | Pedido (navegador) | Endpoint (Node) | Fallas |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| común | `ale` | 2 | 376.8 / 466.7 (7) | 246.3 / 264.4 | 85.5 / 114.1 | 35.4 / 49 · 1 q | 0 |
| parcial | `val` | 1 | 359.1 / 377.8 (7) | 244.2 / 253.4 | 75.7 / 105.3 | 30 / 49.1 · 1 q | 0 |
| con tilde | `áka` | 2 | 356.3 / 523.9 (7) | 248.5 / 276.9 | 76.4 / 126.5 | 29.9 / 47 · 1 q | 0 |
| sin tilde | `aka` | 2 | 342.4 / 406.2 (7) | 243.1 / 278.7 | 71.8 / 90.9 | 34.9 / 43 · 1 q | 0 |
| sin resultados | `zqx` | 0 | 338.2 / 384.5 (7) | 243.1 / 282.1 | 76.1 / 95.1 | 43 / 49.1 · 1 q | 0 |

En "sin resultados" la columna visible mide hasta que llega la respuesta vacía y se pinta el frame siguiente.

## Búsqueda flexible de equipos (Dispositivos)

`touch 34` (debería encontrar D1436): **116.3 / 125.7 (7)** ms desde la última tecla hasta que la tabla se aquieta · filas 76 → 1 · encontrado en 7/7 corridas.

## Historial

| Acción | ms | Filas |
| --- | ---: | ---: |
| Abrir Historial (primera página) | 818.5 / 956.2 (7) | 50 |
| Cargar más | 482.6 / 1037.7 (7) | 100 |

## Desplazamiento en listas largas

Scroll programático de 120 px por frame, bajando y subiendo, sobre el contenedor que scrollea. Duración entre frames pintados (16,7 ms = 60 fps).

| Lista | Filas | Frames | p50 frame | p95 frame | Peor frame | Frames > 50 ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Dispositivos (tabla abierta entera) | 76 | 110 | 117 / 133.7 | 200.8 / 351.3 (7) | 284.4 / 568.7 | 108 / 109 |
| Historial (hasta 4 páginas) | 159 | 136 | 50.2 / 66.8 | 83.7 / 133.7 (7) | 133.8 / 351.1 | 96 / 121 |

## Operaciones frecuentes

| Operación | UI: click → pantalla quieta | POST (navegador) | API desde Node (POST + ver en /api/devices) | Queries |
| --- | ---: | ---: | ---: | ---: |
| Prestar uno | 504 / 785.9 (7) | 188 / 364 | 327.1 / 410 | 13 / 13 |
| Devolver uno | 546.9 / 833.9 (7) | 214 / 467 | 354.1 / 494.5 | 14 / 17 |

## API (desde Node, sin red simulada)

Cada endpoint 7 veces con las cachés del server calientes. Ráfaga de arranque (los GET que pide la app al abrir, 6 en paralelo): **622.3 / 955.5 (7)** ms, 22 queries.

| Endpoint | Estado | ms | Queries | KB |
| --- | ---: | ---: | ---: | ---: |
| `/api/auth/session` | 200 | 13.7 / 16.5 | 0 | 0.5 |
| `/api/site-settings` | 200 | 34.8 / 46 | 1 | 1.6 |
| `/api/devices` | 200 | 6.8 / 19.7 | 0 | 62.2 |
| `/api/movements` | 200 | 42.8 / 47.7 | 1 | 15.8 |
| `/api/agenda` | 200 | 28.5 / 37.2 | 1 | 10.5 |
| `/api/tasks?space=team` | 200 | 84.1 / 109.4 | 4 | 4.6 |
| `/api/notifications` | 200 | 37.5 / 46.6 | 1 | 0 |
| `/api/user/prefs` | 200 | 27.3 / 40.1 | 1 | 0 |
| `/api/release-notes/latest` | 200 | 34.5 / 46.7 | 1 | 0 |
| `/api/internal-notes?filter=all` | 200 | 33.6 / 44.6 | 1 | 0 |
| `/api/loans/previous-day` | 200 | 61.6 / 150.3 | 1 | 0.8 |
| `/api/photo-passes` | 200 | 46.2 / 72.9 | 1 | 5.9 |
| `/api/history?kind=loans&limit=50` | 200 | 41 / 52.9 | 1 | 12 |
| `/api/history?kind=all&limit=50` | 200 | 39.1 / 49.6 | 1 | 8.7 |
| `/api/loans/suggest?q=ale` | 200 | 35.4 / 49 | 1 | 0.3 |
| `/api/loans/suggest?q=val` | 200 | 30 / 49.1 | 1 | 0.1 |
| `/api/loans/suggest?q=%C3%A1ka` | 200 | 29.9 / 47 | 1 | 0.2 |
| `/api/loans/suggest?q=aka` | 200 | 34.9 / 43 | 1 | 0.2 |
| `/api/loans/suggest?q=zqx` | 200 | 43 / 49.1 | 1 | 0 |
| `/api/settings/shifts` | 200 | 40 / 46.8 | 1 | 0.1 |
| `/api/tasks?space=all` | 200 | 104.8 / 122.8 | 4 | 4.6 |
| `/api/internal-notes?filter=active` | 200 | 34.7 / 45 | 1 | 0 |
| `/api/recess-schedules` | 200 | 39.3 / 47.3 | 1 | 0.1 |
| `/api/quick-links` | 200 | 33.1 / 45 | 1 | 2.3 |
| `/api/tools/config` | 200 | 172.6 / 268.6 | 8 | 0.1 |
| `/api/devices?refresh=1` | 200 | 20.2 / 23.7 | 0 | 62.2 |
| `/api/photo-passes/options` | 200 | 153.1 / 239 | 7 | 0.6 |
| `/api/inventory/items` | 200 | 64.3 / 92.4 | 2 | 18.1 |
| `/api/site-assistants` | 200 | 37.5 / 48.2 | 1 | 0.2 |
| `/api/task-columns` | 200 | 29.9 / 47 | 1 | 0.3 |
| `/api/tickets` | 200 | 36.6 / 48.3 | 1 | 0 |
| `/api/ticket-templates` | 200 | 42.3 / 46.6 | 1 | 0 |
| `/api/classrooms` | 200 | 44 / 51.4 | 1 | 21.4 |
| `/api/analytics/parque` | 200 | 96 / 124 | 4 | 0.8 |
| `/api/analytics?from=2025-10-19&to=2026-10-19` | 200 | 225.5 / 278.3 | 9 | 62.2 |
| `/api/notifications/prefs` | 200 | 49.2 / 75 | 2 | 0.2 |
| `/api/invites` | 200 | 35.1 / 48.4 | 1 | 0 |
| `/api/lifecycle/defaults` | 200 | 57.7 / 117.6 | 2 | 0.4 |
| `/api/allowed-users` | 200 | 372.6 / 652.5 | 15 | 2 |
| `/api/sites` | 200 | 36.6 / 45.7 | 1 | 0.7 |

## Tamaños del build

| Recurso | Crudo (KB) | gzip (KB) |
| --- | ---: | ---: |
| JS inicial (entry + modulepreload) | 313.2 | 99.3 |
| CSS inicial | 256.8 | 43.8 |
| Fuentes precargadas | 28.7 | 28.7 |
| **Total crítico** (HTML + JS + CSS + fuentes precargadas) |  | **173.4** |
| Todo el JS de dist/assets (44 archivos) | 826.5 | 267 |
| Todo el CSS de dist/assets (5 archivos) | 281.9 | 50.1 |

Crítico: `index.html` 1.6 KB, `assets/index-DQolaGR3.js` 99.3 KB, `assets/index-B3eDcoiL.css` 43.8 KB, `assets/geist-latin-wght-normal-BgDaEnEv.woff2` 28.7 KB.

## Fallas

Ninguna.

## Cómo reproducir

```bash
node perf/suite.mjs --repo=<checkout> --label=02-etapa2 --runs=7 --cpu=4 --latency=15 --rtt=40 --down=10 --up=5
```

Para medir otra rama sin tocar el repo principal: `git worktree add <tmp> <rama>`, junction de `node_modules` (`cmd /c mklink /J node_modules <repo>\node_modules`), correr la suite con `--repo=<tmp>` y `git worktree remove --force <tmp>`. Usá la misma base (`--db=<snapshot>`) en todas las etiquetas que quieras comparar.
