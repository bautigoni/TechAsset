# Brief común de implementación de pantallas (etapas 3 a 8)

Cada pantalla se implementa en un git worktree propio (base `rediseno-grafito`) y después se integra. Varias pantallas avanzan en paralelo: respetá los límites de archivos para que la integración no choque.

## Preparación del worktree

1. Desde la raíz del worktree: `cmd /c mklink /J node_modules C:\Users\Usuario\Downloads\techasset\node_modules`.
2. Copiá `C:\Users\Usuario\Downloads\techasset\.env` a la raíz del worktree (está en .gitignore; nunca lo commitees ni imprimas sus valores).
3. Para e2e/servers locales hace falta `data/techasset.db` en el worktree: copiala con el backup de SQLite (como hace e2e) desde `C:\Users\Usuario\Downloads\techasset\data\techasset.db`. Nunca escribas en la base original.
4. Puertos 5173 y 8000 están ocupados por el dev server del dueño: usá otros. Cualquier server que levantes: `MODO_PRUEBA=true`, SMTP/RESEND vacíos.

## Qué leer antes de tocar nada

- `CLAUDE.md` (reglas de UI del dueño: nada superpuesto, sin barras de scroll, sin modales ni capas flotantes salvo el tooltip de texto truncado, sin "AI slop", mobile fijo; rendimiento: cada query es sincrónica en prod).
- `docs/redesign/PLAN.md` (§2, §4, §5, §5.1, §7 y tu etapa en §6) y `docs/redesign/TOKENS.md`.
- El inventario de tu pantalla en `docs/redesign/inventario/0*.md` **completo**, con su lista de verificación: todo lo que hace hoy tiene que seguir funcionando. Si algo no se puede conservar, no lo saques: documentalo en tu informe.
- Los mockups aprobados en `docs/redesign/mockups/<Pantalla>.dc.html` y `<Pantalla>-m.dc.html` (y `BRIEF-v2.md`). Son la referencia visual y de interacción; la estructura de datos real manda.
- La librería `src/ui/` (y `src/ui/Showcase.tsx` como ejemplo de uso). Usala; si falta algo, agregalo en `src/ui/` de forma genérica (sin romper su API) y mencionalo.
- El shell nuevo (etapa 2): `src/components/layout/` (Sidebar, Topbar, franjas en línea, StatusOutlet/pushStatus, scrollAppToTop, `[data-scanner-ignore]`).

## Reglas de implementación

- **Sin modales**: cada `Modal`, `confirmDialog`, `promptDialog` o `toast` de tu pantalla pasa a patrones en línea (`Disclosure`, ficha expandida, `InlineConfirm`/`useInlineConfirm`, `useInlinePrompt`, `StatusLine`/`useStatusLine` o `pushStatus`, página de detalle con URL si es grande). Formularios en línea llevan `data-scanner-ignore` si el escáner global no debe tomar su tipeo.
- **Sin controles nativos**: nada de `<select>`, `input type=date/time/number/file/color`, checkbox/radio crudos, `<details>`, `<datalist>`, `title=` como tooltip, `window.confirm`. `npm run check:ui` tiene que bajar, nunca subir (`--update` cuando bajó).
- **CSS**: todo lo nuevo de tu pantalla va en `src/styles/screens/<pantalla>.css` (o junto al componente) importado desde el módulo lazy de la pantalla, con clases propias y SOLO tokens. **No edites** `components.css`, `layout.css`, `responsive.css`, `global.css`, `variables.css`, `tokens.css` ni `src/ui/ui.css` salvo un cambio mínimo imprescindible (decilo en el informe); el CSS viejo que tu pantalla deje de usar se purga en la etapa 9.
- **Archivos compartidos** (`src/App.tsx`, `src/types.ts`, `src/components/layout/*`, `server/index.js`, `e2e/tests/functional.mjs`): cambios mínimos y localizados, solo si son imprescindibles. Tus cambios de componentes y rutas de server de tu área sí son libres.
- **Server**: si tu pantalla necesita datos nuevos (por ejemplo un Deshacer que hoy no existe), agregá endpoints en el router de tu área, con permisos (`canEditModule`, consulta), sede (`requireSite`), migraciones idempotentes, sin sumar queries a endpoints polleados sin medir, y probalo contra Postgres si podés (`server/scripts/bench/pg-smoke.mjs` con un contenedor `postgres:17-alpine` en un puerto libre; agregale chequeos de lo nuevo).
- **Interacción**: conservá todos los atajos (Ctrl/Cmd/Shift+Click donde existan, Enter del escáner, teclado), `data-device-tag`, `row-highlight`, modo consulta, permisos por módulo, polling, caché `apiGet`/`apiSend`.
- **Fechas**: `formatDate`/`dateFormatter` y los helpers de hora argentina de `utils/formatters`.
- **Rendimiento**: presupuestos de PLAN §7 (CSS inicial ≤ 58 kB gzip, JS entry ≤ 102 kB; tu pantalla en su chunk lazy; ninguna pantalla > 300 ms al abrir). Listas largas: paginá o renderizá en tandas; nada de layout thrash.
- **Mobile**: 360–390 px perfecto, 44 px táctil, sin scroll horizontal, sin barras visibles.

## Verificación obligatoria antes de commitear

1. `npx tsc -b` y `npm run build` (reportá tamaños).
2. `npm run e2e` (funcionales todos OK; si un selector de tu pantalla cambió, ajustá el test mínimamente sin esconder regresiones; sumá tests nuevos de tu pantalla en `e2e/tests/` si podés). Reportá la línea base de layout de tu pantalla (scroll, barras, botones partidos, solapamientos): tiene que quedar en 0 en tu pantalla.
3. `npm run check:ui` sin nada nuevo.
4. Capturas de tu pantalla en oscuro y claro a 1440, 1024, 768 y 390, con sus estados principales abiertos, en `C:\Users\Usuario\Downloads\techasset\e2e\.out\etapa<N>\`. Revisalas: nada superpuesto, nada partido, nada fuera del diseño.
5. Recorré la lista de verificación del inventario de tu pantalla punto por punto.

## Commit

Commits en la rama de tu worktree, en español, descriptivos, terminados en la línea `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Sin push, sin merge.

## Informe final

Rama y commits; qué cambió; la lista de verificación del inventario con cada punto OK / cambió (cómo) / pendiente (por qué); endpoints nuevos; tamaños; resultados de e2e, layout y check:ui; capturas; pendientes y riesgos.
