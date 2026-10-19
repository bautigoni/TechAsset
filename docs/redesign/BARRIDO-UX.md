# Barrido de REGLAS-UX sobre toda la app

Objetivo: que TODAS las pantallas cumplan `docs/redesign/REGLAS-UX.md` completo (incluidos los agregados del dueño: colapsos suaves con encabezado anclado; sin huecos, sin truncar con espacio, vacíos diseñados, nada cortado), con un único mecanismo de colapso y pruebas automáticas que lo garanticen. Varias pantallas se hicieron antes de que existieran las reglas.

## Base común

- Primitiva compartida: `src/ui/Collapse.tsx` (API en `docs/redesign/IMPLEMENTACION.md` y en Showcase, sección "Abrir y cerrar"): `<Collapse open id className anchor reveal lazy unmountOnClose appear reserve onSettled>`, más `keepInPlace`, `useAnchoredToggle`/`anchored`, `revealInView`, `useScrollEdges` + `.ui-scroll-fade`, y `EmptyState` con `icon`/`compact`/`center`.
- Helpers locales que hay que reemplazar por la primitiva (y borrar cuando nadie los use): `src/components/common/Collapse.tsx` (Tickets), `src/components/common/SoftCollapse.tsx` + `softCollapse.css` (Aulas/Recordatorios), `src/components/common/SmoothCollapse.tsx` (Conocimiento/Canvas), `src/components/common/InlineCollapse.tsx` (Herramientas/Accesos/Caja chica), el colapso de `src/components/settings/settingsKit.tsx`, `src/components/dashboard/Collapse.tsx` (Inicio) y cualquier colapso propio de Analítica. Si la primitiva no cubre un caso que un helper sí cubría, mejorá la primitiva (sin romper su API) en vez de conservar el helper.
- Toda apertura/cierre/aparición de contenido (secciones, fichas debajo de filas, formularios en línea, confirmaciones en línea, líneas de estado, "Ver más", paneles de filtros, detalles) usa la primitiva o `anchored(...)`: transición suave, encabezado/disparador quieto en pantalla, nada de `{open && ...}` / `display:none` / `hidden` para plegar.

## Revisión por pantalla (proceso de 7 pasos de REGLAS-UX)

Para cada pantalla de tu lista: abrí/cerrá/guardá/cancelá/volvé atrás en cada elemento interactivo; contenido corto y largo; 360/768/1024/1280/1366/1440/1920 en oscuro y claro; textos extensos y vacíos; doble click/doble Enter en cada acción de escritura; errores que no borran lo escrito; carga/error/éxito/vacío/deshabilitado; teclado y foco (al cerrar algo, el foco vuelve al disparador). Arreglá todo lo que no cumpla: saltos, huecos, truncados con espacio, botones partidos, elementos tapados, cosas que parecen clickeables sin serlo, acciones sin feedback, vacíos de una línea suelta, scroll anidado que atrapa.

## Pruebas automáticas (se suman al e2e)

- En `e2e/tests/` (archivo propio de tu frente o en `e2e/lib/ux-probe.mjs` compartido por el frente de infraestructura): para cada pantalla de tu lista, abrir y cerrar cada colapsable visible y verificar que el disparador no se mueve más de 2 px y que el documento no salta; sonda de huecos (> 48 px entre bloques consecutivos que no sean el espaciado normal) y de truncado con espacio; ningún elemento interactivo tapado por otro (elementFromPoint en el centro del control devuelve el control o un hijo).
- No toques tests de otras pantallas salvo selectores mínimos.

## Reglas de trabajo

Igual que `docs/redesign/IMPLEMENTACION.md` (worktree, node_modules por junction, .env, copia de la base, puertos libres, MODO_PRUEBA=true, no CSS global salvo lo imprescindible, commits en español con `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, sin push). Verificación: `npx tsc -b`, `npm run build` (entry JS ≤ 102 kB gzip), `npm run e2e` (para correr solo tus grupos: `--only=<código exacto del grupo>`; los códigos están en e2e/README.md), `npm run check:ui`, capturas en `C:\Users\Usuario\Downloads\techasset\e2e\.out\barrido-<frente>\`. Informe: commits, qué arreglaste por pantalla, qué helpers borraste, pruebas nuevas, resultados, pendientes.
