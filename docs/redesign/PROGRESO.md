# Registro de progreso del rediseño

Rama de trabajo: `rediseno-grafito` (pusheada a origin). **Nunca merge a `main`** (lo decide el dueño).
Autodeploy verificado el 19/10/2026: la VM de producción se actualiza solo a mano (`deploy.sh` + bundle; sin cron ni webhook); la integración de Vercel no crea deploys desde el 8/7/2026 y nunca deployó ramas que no sean `main` a producción. Push de la rama = seguro.

## Estado por etapa

| Etapa | Estado | Commits | Verificación |
|---|---|---|---|
| 0. Red de seguridad + bugs | ✅ | 0f905ca, 73e0f90, b033166 | e2e 23/23, pg-smoke 36/36 |
| 1. Tokens, tema, Geist, src/ui | ✅ | e3124f5 | e2e 23/23, barras visibles 232→0, CSS 58,2→54,7 kB |
| 2. Shell (menú, topbar, Ctrl K, router) | en curso (worktree) | — | — |
| 3. Dashboard | pendiente | — | — |
| 4. Préstamos | pendiente | — | — |
| 5. Dispositivos, Inventario, Historial | pendiente | — | — |
| 6. Agenda, Horarios, Aulas, Recordatorios | pendiente | — | — |
| 7. Tareas, Tickets, Sugerencias, Conocimiento, Canvas | pendiente | — | — |
| 8. Analítica, Configuración, Herramientas, Accesos, Caja chica | pendiente | — | — |
| 9. Login, PWA, limpieza | pendiente | — | — |
| Asistente IA (Claude Haiku 5.5 + dictado del navegador) | pendiente | — | — |
| Pasadas de rendimiento 1/2/3 | pendiente | — | — |
| Búsqueda rápida de personas | pendiente | — | — |
| Auditoría 10 subagentes + correcciones + 2ª validación | pendiente | — | — |

## Decisiones tomadas en el camino

- 19/10: Tareas se rediseña (solo se conserva la transición del "+"); Analítica sobre la propuesta 05 con gráficos variados; el rayo de accesos rápidos se queda (franja en línea); los .bat se descargan; todas las resoluciones.
- Mockups de referencia: canvas https://claude.ai/artifact/HJ4NZt5L6JmSMXXiNp2b3a (fuentes `.dc.html` en el scratchpad de la sesión).

## Cómo reanudar

1. `git checkout rediseno-grafito && git pull`.
2. Leer esta tabla, docs/redesign/PLAN.md y el inventario de la etapa siguiente.
3. Verificar con `npm run build`, `npm run e2e`, `npm run check:ui` y `node perf/suite.mjs`.
