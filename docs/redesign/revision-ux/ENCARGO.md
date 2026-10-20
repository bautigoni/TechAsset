# Revisión UX/UI con 10 revisores (20/10/2026)

Pedido del dueño, con dos capturas en esta carpeta:

- `dueno-hueco-inicio.png`: en el Inicio (desktop) hay un **hueco vacío grande** entre la barra superior y el primer bloque ("Escaneá o escribí un equipo…", el link "Act…" a la derecha). Ese espacio no puede estar así.
- `dueno-inicio-cortado.png`: en el menú de la izquierda, el ítem **"Inicio" se ve cortado arriba** (no se llega a ver su parte de arriba / el resaltado del ítem activo queda recortado).

"Buscá las reglas de UI/UX y mandá 10 subagentes que revisen eso." Las reglas son TODAS estas, sin excepción:

- `docs/redesign/REGLAS-UX.md` (reglas del dueño + agregados: colapsos suaves con el encabezado quieto, sin huecos, sin truncar con lugar, vacíos diseñados, nada cortado ni tapado, todo panel visible completo).
- `CLAUDE.md` § Rendimiento (reglas duras): nunca scroll horizontal; nunca se superpone nada (360–1920 px); botones/labels nunca partidos; nunca barras de scroll visibles; nada de modales ni capas flotantes (única excepción: tooltip del texto truncado); mobile = pantalla fija; nada de "AI slop".
- `docs/redesign/PLAN.md` §5 y §5.1 (design system y mobile fijo), `docs/redesign/TOKENS.md`.

## Cómo revisar (cada revisor, en SUS pantallas)

1. Levantá la app en tu worktree (como en `docs/redesign/IMPLEMENTACION.md`: junction de node_modules, `.env`, copia de la base, puertos libres que no sean 5173/8000, `MODO_PRUEBA=true`) y entrá con un usuario superadmin de la copia (podés crear uno en la copia con `server/services/password.service.js`; nunca toques `data/techasset.db` real ni producción). Prendé en la copia los módulos que estén apagados si te tocan (`knowledge`, `reminders`, `canvas`).
2. Mirá con capturas reales (puppeteer-core + Chrome, como `e2e/`) cada pantalla en **360, 390, 768, 1024, 1280, 1366, 1440, 1600 y 1920 px**, en **oscuro y claro**, con datos cortos, largos y vacíos, con el menú expandido y en riel, y con el asistente abierto (≥ 1024). Además de mirar, medí: huecos verticales > 32 px que no sean el espaciado del sistema (incluido el **espacio entre la barra superior y el primer bloque**), elementos recortados por un `overflow` del padre (comparar `getBoundingClientRect` del elemento contra el del contenedor que lo recorta, incluyendo resaltados, bordes de foco y sombras de selección), textos truncados habiendo lugar, controles tapados, botones partidos, scroll horizontal, barras de scroll visibles, saltos al abrir/cerrar.
3. Interactuá: abrir/cerrar cada colapsable, formularios en línea, confirmaciones, "Ver más", selección, foco con Tab y Esc, estados de carga/vacío/error/éxito.
4. Arreglá todo lo que encuentres en tus pantallas. Causa raíz, no parches por ancho.
5. Agregá pruebas que lo garanticen en el archivo e2e de tu frente (no en los de otros).

## Reglas de trabajo

- Solo tocás los archivos de tus pantallas (sus componentes y su `src/styles/screens/<pantalla>.css`). Lo compartido (`src/ui/*`, `src/styles/tokens.css`, CSS heredado global, `src/components/layout/*`, `e2e/lib/ux-probe.mjs`) es del **revisor 1**; si necesitás un cambio ahí, hacé el arreglo mínimo con alcance local en tu pantalla y explicá en el informe qué cambio compartido haría falta.
- Nada de `!important` nuevo, nada de valores mágicos por ancho; tokens del sistema.
- Verificación al cerrar: `npx tsc -b`, `npm run build` (entry JS ≤ 102 kB gzip), `npm run e2e -- --only=<tus grupos>` mientras trabajás y `npm run e2e` completo al final (sonda UX bloqueante), `npm run check:ui`. Capturas antes/después en `e2e/.out/revision-ux-<n>/` del checkout principal (`C:\Users\Usuario\Downloads\techasset\e2e\.out\revision-ux-<n>\`).
- Hay otro agente midiendo rendimiento en paralelo: no cambies `perf/`, ni toques lógica de datos/fetch/caché salvo que sea la causa de un problema visual.
- Commits en español con `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, sin push.
- Informe: tabla de hallazgos (pantalla, ancho/tema, problema, regla que rompe, causa, arreglo, commit), pruebas nuevas, resultados de verificación, y cambios compartidos sugeridos.

## Agregado del dueño (20/10, mientras corría la revisión)

> "HAY MUCHAS veces que tocás un botón y esperás que algo se abra smooth, pero no, se abre de una todo tosco, como el asistente de IA (horrendo el logo y la caja toda cuadrada, la estética me gusta que sea todo más redondo si lo podés hacer, usá la estética de ELEVENLABS que la amo)"

Para TODOS los revisores, en sus pantallas:

- **Nada se abre "de golpe".** Todo lo que aparece o desaparece por tocar algo (secciones, fichas debajo de filas, formularios en línea, confirmaciones, listas de sugerencias, filtros, "Ver más", paneles, detalles, resultados, mensajes de error/éxito) entra y sale con transición suave: `Collapse` (alto + opacidad) o `anchored(...)`, con el control tocado quieto. Buscá activamente `{cond && <...>}`, `hidden`, `display: none`, cambios de clase que muestran/ocultan sin transición, y cambios de contenido que saltan de alto (cargando → datos) — pasalos a la primitiva. Respetando `prefers-reduced-motion` (ahí: sin animación, pero sin saltos de scroll).
- Probá cada disparador de tu pantalla mirando cuadro a cuadro (capturas cada ~16 ms o `requestAnimationFrame` midiendo el alto del contenido nuevo): si pasa de 0 al alto final en un cuadro, está mal.
- **Estética redonda (ElevenLabs)**: la hace un agente aparte ("estética"), dueño de los tokens de forma (radios, botones píldora, campos, tarjetas) en `src/styles/tokens.css` y `src/ui/*`, y del asistente completo (columna, panel, logo, compositor). **No cambies radios ni la forma de los componentes compartidos**; si tu pantalla tiene radios propios escritos a mano (px sueltos en su CSS), pasalos a los tokens de radio (`--radius-*` o los que existan en `TOKENS.md`) para que hereden la estética nueva.
