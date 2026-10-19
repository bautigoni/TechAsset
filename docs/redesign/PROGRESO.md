# Registro de progreso del rediseño

Rama de trabajo: `rediseno-grafito` (pusheada a origin). **Nunca merge a `main`** (lo decide el dueño).
Autodeploy verificado el 19/10/2026: la VM de producción se actualiza solo a mano (`deploy.sh` + bundle; sin cron ni webhook); la integración de Vercel no crea deploys desde el 8/7/2026 y nunca deployó ramas que no sean `main` a producción. Push de la rama = seguro.

## Estado por etapa

| Etapa | Estado | Commits | Verificación |
|---|---|---|---|
| 0. Red de seguridad + bugs | ✅ | 0f905ca, 73e0f90, b033166 | e2e 23/23, pg-smoke 36/36 |
| 1. Tokens, tema, Geist, src/ui | ✅ | e3124f5 | e2e 23/23, barras visibles 232→0, CSS 58,2→54,7 kB |
| 2. Shell (menú, topbar, Ctrl K, router) | ✅ (+ colapso compartido y franjas: c33a561, ff5e141) | ebbd862, e2d250a | e2e 26/26, CSS 54,7→44,8 kB |
| 3. Dashboard | ✅ (+ sin huecos/vacíos: 01b2959) | 4081960, a05210f | e2e 51/51, pg 74/74 |
| 4. Préstamos | ✅ | cbc132d, b578bc6 | e2e 34/34, pg 50/50 |
| 5. Dispositivos, Inventario, Historial | ✅ | d7301a7, 2cdfbfa | e2e 51/51, pg 74/74 |
| 6. Agenda, Horarios, Aulas, Recordatorios | ✅ | 3544f44, 5b7c197 | e2e, pg-smoke |
| 7. Tareas, Tickets, Sugerencias, Conocimiento, Canvas | ✅ | 95600e6, 91e60a6, 76a5094 | e2e, pg-smoke |
| 8. Analítica, Configuración, Herramientas, Accesos, Caja chica | ✅ | 09af8da, 89ac766, cd99ff3 | e2e 131/132 (1 intermitente), pg-smoke 118/118, layout 23/23 |
| 9. Login, PWA, limpieza | pendiente | — | — |
| Asistente IA (Claude Haiku 5.5 + dictado del navegador) | ✅ server + panel | 3d69e9f, 82cc56f, 6cf22d0 | evals 38/38, pg 39/39, e2e 60/60 |
| Pasadas de rendimiento 1/2/3 | pendiente | — | — |
| Búsqueda rápida de personas | pendiente | — | — |
| Barrido REGLAS-UX (colapso compartido, sin huecos/truncados) en todas las pantallas | en curso: 4 frentes (infra/pruebas; Préstamos-Inicio-Dispositivos-Historial-Inventario; Agenda-Horarios-Aulas-Recordatorios-Tareas-Tickets; Conocimiento-Canvas-Analítica-Configuración-Herramientas-Accesos-Caja chica) | — | — |
| Auditoría 10 subagentes + correcciones + 2ª validación | pendiente | — | — |

## Decisiones tomadas en el camino

- 19/10: Tareas se rediseña (solo se conserva la transición del "+"); Analítica sobre la propuesta 05 con gráficos variados; el rayo de accesos rápidos se queda (franja en línea); los .bat se descargan; todas las resoluciones.
- Mockups de referencia: canvas https://claude.ai/artifact/HJ4NZt5L6JmSMXXiNp2b3a (fuentes `.dc.html` en el scratchpad de la sesión).

- 19/10: reglas de UX del dueño en REGLAS-UX.md (incluye colapsos suaves con encabezado anclado, sin huecos, sin truncar con espacio, vacíos diseñados) y la directiva completa en DIRECTIVA-FINAL.md.
- Integración: cada pantalla se hace en un worktree y se trae con cherry-pick (nunca merge); después de cada integración: build, e2e, check:ui y pg-smoke.

## Cómo reanudar

1. `git checkout rediseno-grafito && git pull`.
2. Leer esta tabla, docs/redesign/PLAN.md y el inventario de la etapa siguiente.
3. Verificar con `npm run build`, `npm run e2e`, `npm run check:ui` y `node perf/suite.mjs`.
