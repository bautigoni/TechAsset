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
| 9. Login, PWA, limpieza | ✅ | de88adf, 7f3b287, d33aead, b0562a9, f2e7716, 60f53d6, adb9754 (+ docs) | e2e completo (lg y pwa nuevos), css-diff 280/280 sin diferencias, pg 117/117, CSS inicial 44,4→14,9 kB gzip, JS entrada 98,7→95,8 kB (vite) |
| Asistente IA (Claude Haiku 5.5 + dictado del navegador) | ✅ server + panel | 3d69e9f, 82cc56f, 6cf22d0 | evals 38/38, pg 39/39, e2e 60/60 |
| Pasadas de rendimiento 1/2/3 | 1 ✅ (`bench/pasada1.md`); 2 ✅ (`bench/pasada2.md`); 3 ✅ (`bench/pasada3.md`, suites `06-pasada3`) | 37fdbe8, 17abb26, 59cc209, 92c52df, d311f78 (+ bancos en `perf/`) | soak sin fugas, pg 128/128 |
| Búsqueda rápida de personas | ✅ < 200 ms (sugerencias 3 letras: 338 → 108 ms med.; 20 casos verificados con `perf/people-check.mjs`) | pasada 1 y 3 | — |
| Revisión UX con 10 revisores + estética ElevenLabs + cartelitos en pop up (`revision-ux/ENCARGO.md`) | ✅ integrada en `integracion-ux` (hueco del Inicio, "Inicio" cortado, aperturas suaves, alturas parejas, radios redondos, orbe del asistente, `Dialog` de cartelitos) | rama `integracion-ux` | e2e 346/346 + 23/23 líneas base con `KNOWN_PENDING` vacío, check:ui OK, JS entrada 97,5 kB gzip, pg 128/128 |
| Barrido REGLAS-UX (colapso compartido, sin huecos/truncados) en todas las pantallas | ✅ sonda UX bloqueante en 0 | 167dd5e, 938b7f4, 9085f22, 5ca267d | 3× e2e 265/265, pg 117/117 |
| QA de lanzamiento: 5 usuarios nuevos (impaciente, escéptico, móvil 375px/3G, no nativo, destructor) en tenant de prueba QA aislado, lista por impacto, arreglo en un pase y re-corrida | ronda 1 ✅ (`qa/HALLAZGOS-1.md`, entorno `qa/README.md`); arreglos: C ✅ verificado, A/B/D/E cortados casi al final (ver abajo); integración y ronda 2 pendientes | 671f8b5, 9cf3cf2; ramas `qa-fix-a`…`qa-fix-e` | C: e2e 377/377 en su rama |
| Auditoría 10 subagentes + correcciones + 2ª validación | pendiente | — | — |

## Decisiones tomadas en el camino

- 19/10: Tareas se rediseña (solo se conserva la transición del "+"); Analítica sobre la propuesta 05 con gráficos variados; el rayo de accesos rápidos se queda (franja en línea); los .bat se descargan; todas las resoluciones.
- Mockups de referencia: canvas https://claude.ai/artifact/HJ4NZt5L6JmSMXXiNp2b3a (fuentes `.dc.html` en el scratchpad de la sesión).

- 19/10: reglas de UX del dueño en REGLAS-UX.md (incluye colapsos suaves con encabezado anclado, sin huecos, sin truncar con espacio, vacíos diseñados) y la directiva completa en DIRECTIVA-FINAL.md.
- Integración: cada pantalla se hace en un worktree y se trae con cherry-pick (nunca merge); después de cada integración: build, e2e, check:ui y pg-smoke.

## Corte del 22/10/2026 (pedido del dueño: faltaban más de ~10 h) — qué quedó pendiente

Los 5 frentes del arreglo del QA (ronda 1) están en ramas pusheadas, todas sobre `9cf3cf2` (= `rediseno-grafito`):

| Rama | Frente | Estado al cortar |
|---|---|---|
| `qa-fix-a` | A: ingreso sin pantalla vacía y sin polling sin sesión, Privacidad y uso, 404, registro entra directo, cambiar contraseña, política de contraseña nueva, topes por campo + Unicode bidi en el server, mails de registro, cierre de sesión | 3 commits + 1 WIP (`src/App.tsx`); faltaba terminar su e2e completo |
| `qa-fix-b` | B: leyenda sin números, formulario que marca todo junto (EP/ES, cursos), errores sin red en castellano, cámara, búsqueda "10" → Touch 10 | 4 commits + 1 WIP (11 archivos); faltaba su e2e completo |
| `qa-fix-c` | C: Inicio — aviso en el lugar de la acción (sin corrimientos), sin falso vacío, vencimiento con la misma regla (`utils/taskDue.ts`), título "Equipos", textos | ✅ terminado: e2e 377/377, sonda UX 0, check:ui OK |
| `qa-fix-d` | D: íconos de la barra con nombre, `src/ui` 44 px en touch, asistente dice si usa IA y qué manda / ejemplos reales / avisa al cambiar de vista, Escanear sin cámara, "Instalá" en una línea, "Más" con historial | 3 commits + 1 WIP (e2e `qa-d`); evals 38/38; faltaba su e2e completo |
| `qa-fix-e` | E: Agenda (turnos, entregar/retirar con Deshacer, conteos), Tareas ("Grupo", casilla "Elegir", 24 h), Aulas sin plano con vacío explicado | 5 commits; faltaba su e2e completo |

Conflictos esperables al integrar: `src/App.tsx` (A y C), `src/components/tasks/taskModel.ts` (C y E), formulario de préstamo del Inicio (C marca todos los faltantes; B rehízo `LoanForm` — alinear textos), `e2e/run.mjs` (cada frente registró su grupo), `apiClient.ts` (B errores; C no lo tocó al final).

Orden para retomar:
1. Integrar `qa-fix-c` → E → D → B → A con cherry-pick sobre `integracion-ux` (nunca merge), revisando los WIP; `npx tsc -b`, `npm run build`, `npm run check:ui`, `npm run e2e` completo (sonda UX con `KNOWN_PENDING` vacío), pg-smoke (Postgres 17 de Docker, `PG_TEST_URL` local).
2. Ronda 2 de los 5 usuarios con `node qa/serve-qa.mjs --name=<p> --port=871x --fresh` (ver `qa/README.md`), comparar contra `qa/HALLAZGOS-1.md`.
3. Auditoría con 10 subagentes (toda la app + especialidad cada uno) → consolidar → arreglar críticos/altos/medios sensatos → 2.ª validación.
4. Validación técnica final (`node perf/suite.mjs --label=07-final`, comparar con 00/05/06) e informe final (tabla de benchmarks, estado de git, veredicto).

Decisiones abiertas del dueño: ¿devolver un cartelito también en pop up?; logo del asistente (esfera / anillo / dos esferas, en `/sede/nfpt/ui`); registro que entra directo y contraseñas nuevas de 8+ (tomadas por defecto en A); Inicio: rótulo de "Prestar/Devolver" en mobile (abren el modo varios) y la ayuda fija (~50 px) en la barra.

Remanentes de rendimiento (pasada 3 vs. inicial): arranque en caliente +23 %, "Cargar más" del historial +64 %, búsqueda "touch 34" +32 %, contenido de Dispositivos +34 %.

## Cómo reanudar

1. `git checkout rediseno-grafito && git pull`.
2. Leer esta tabla, docs/redesign/PLAN.md y el inventario de la etapa siguiente.
3. Verificar con `npm run build`, `npm run e2e`, `npm run check:ui` y `node perf/suite.mjs`.
