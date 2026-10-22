# Tokens Grafito (contrato)

Fuente única de verdad de los nombres. `src/styles/tokens.css` los define; `src/ui/` y todo CSS nuevo los usa. Nunca un color, tamaño o duración literal en el CSS de un componente o pantalla nueva: siempre un token.

## Temas y preferencias (atributos en `<html>`)

| Atributo | Valores | Default |
|---|---|---|
| `data-theme` | `dark` · `light` (resuelto; "Sistema" se resuelve en JS con `prefers-color-scheme` y escucha cambios) | `dark` |
| `data-density` | `comfortable` · `compact` | `comfortable` |
| `data-text-size` | `normal` · `large` · `xlarge` (escala `html { font-size }` 16 / 17.5 / 19 px; todo lo nuevo usa rem) | `normal` |

`color-scheme` acompaña al tema. El fondo de `html` es `--g-bg` (nada de blanco en rebotes ni zoom afuera) y `<meta name="theme-color">` sigue al tema.

## Color

| Token | Oscuro | Claro | Uso |
|---|---|---|---|
| `--g-bg` | `#0D0F12` | `#F6F7F9` | fondo de la app |
| `--g-surface` | `#14171B` | `#FFFFFF` | cards, paneles |
| `--g-raised` | `#1B1F24` | `#F0F2F5` | hover, inputs, item activo, chips |
| `--g-line` | `#262B32` | `#E3E6EB` | bordes |
| `--g-line-strong` | `#353B44` | `#CDD2D9` | bordes de controles |
| `--g-text` | `#ECEEF1` | `#14171B` | texto principal |
| `--g-text-2` | `#A7AEB8` | `#4A525E` | secundario, estado normal |
| `--g-text-3` | `#7C8592` | `#646C78` | eyebrows, ejes, mínimo para texto |
| `--g-accent` | `#5B9BFF` | `#2F6FE0` | primario, activo, foco, link, serie 1 |
| `--g-accent-hover` | `#8DBBFF` | `#2560C8` | hover del acento |
| `--g-on-accent` | `#0D0F12` | `#FFFFFF` | texto sobre acento |
| `--g-focus` | `#5B9BFF` | `#2F6FE0` | anillo de foco 2px, offset 2px |
| `--g-ok` | `#5BD68A` | `#16804A` | solo texto o arco |
| `--g-warn` | `#F5C04E` | `#A15C00` | solo texto o arco |
| `--g-bad` | `#FF6B6B` | `#C93636` | solo texto o arco |
| `--g-info` | `#4FD1C5` | `#0F8A80` | prestado / info |
| `--g-series-1..5` | `#5B9BFF #4FD1C5 #FF9F5A #B79CFF #F28FD0` | `#2F6FE0 #0F8A80 #C8641E #7A5BD6 #C2489A` | gráficos |
| `--g-series-rest` | `#3A414B` | `#C9CED6` | "resto", período anterior |
| `--g-check-bg` / `--g-check-fg` | `#ECEEF1` / `#0D0F12` | `#14171B` / `#FFFFFF` | checkbox marcado |
| `--g-shadow-tooltip` | `0 6px 20px rgba(0,0,0,.35)` | `0 6px 20px rgba(20,23,27,.12)` | ÚNICA sombra permitida |
| `--g-orb-hi` / `--g-orb-mid` / `--g-orb-lo` | `#A9CBFF` / `#5B9BFF` / `#2C5DB3` | `#8DB4F5` / `#2F6FE0` / `#1A4BA6` | solo la marca del asistente (sombreado tonal de la esfera) |

Prohibido: fondos tintados de estado, gradientes, glows, sombras fuera del tooltip.

## Tipografía

- `--g-font`: `'Geist Variable', 'Geist', system-ui, sans-serif` · `--g-font-mono`: `'Geist Mono Variable', 'Geist Mono', ui-monospace, monospace`
- Tamaños (rem, base 16): `--g-fs-xs` .75 (12) · `--g-fs-sm` .8125 (13) · `--g-fs-base` .875 (14) · `--g-fs-md` 1 (16) · `--g-fs-lg` 1.25 (20) · `--g-fs-xl` 1.75 (28) · `--g-fs-2xl` 2.5 (40)
- Pesos: `--g-fw-regular` 400 · `--g-fw-medium` 500 · `--g-fw-semibold` 600
- Números: `font-variant-numeric: tabular-nums` (clase utilitaria `.g-num`).
- Eyebrow: mono 11px (`.6875rem`), mayúsculas, `letter-spacing: .08em`, `--g-text-3`.

## Espacio, forma, tamaño

- `--g-s-1` 4px · `--g-s-2` 8 · `--g-s-3` 12 · `--g-s-4` 16 · `--g-s-5` 24 · `--g-s-6` 32 · `--g-s-7` 48
- Radios (estética ElevenLabs, ver `ESTETICA-ELEVENLABS.md`; grandes y concéntricos: lo de adentro lleva el radio de afuera menos el aire que los separa):

| Token | Valor | Uso |
|---|---|---|
| `--g-radius-xs` | 6px | casillas (5), kbd, ítems chicos |
| `--g-radius-sm` | 12px | campos y controles rectangulares, chips de pantalla, tooltip |
| `--g-radius` | 16px | tarjetas |
| `--g-radius-lg` | 20px | paneles (asistente, franjas), líneas de estado y barras de selección |
| `--g-radius-xl` | 24px | superficies de primer nivel (pop up de cartelitos) |
| `--g-radius-pill` | 999px | botones, segmentado, chips, compositor, días del calendario |
| `--g-radius-btn` | `var(--g-radius-pill)` | **semántico**: todo botón |
| `--g-radius-field` | `var(--g-radius-sm)` | **semántico**: todo campo (input, select, textarea, fechas) |
| `--g-radius-card` | `var(--g-radius)` | **semántico**: tarjetas, Disclosure, InlineConfirm |
| `--g-radius-panel` | `var(--g-radius-lg)` | **semántico**: paneles, StatusLine, SelectionHeader, ErrorState |

  Los componentes usan los semánticos; las pantallas, la escala. Nunca px sueltos: así una pantalla hereda la forma.
- Foco: `--g-focus-w` 2px · `--g-focus-offset` 2px → `outline: var(--g-focus-w) solid var(--g-focus); outline-offset: var(--g-focus-offset)` (el outline sigue el radio). Adentro de algo que recorta (`.ui-scroll-fade`, la lista del Select, el hilo del asistente) el contenedor pone `--g-focus-offset: calc(-1 * var(--g-focus-w))` y el anillo se dibuja hacia adentro: nunca queda cortado.
- `--g-control-h` 36px (compact 32px; en `(pointer: coarse)` mínimo 44px) · `--g-row-h` 40px (compact 34px)
- `--g-topbar-h` 56px · `--g-sidebar-w` 232px · `--g-rail-w` 56px

## Movimiento

- `--g-ease` `cubic-bezier(.22,1,.36,1)` · `--g-ease-spring` `cubic-bezier(.34,1.56,.64,1)`
- `--g-dur-fast` 120ms · `--g-dur` 180ms · `--g-dur-slow` 260ms · `--g-dur-panel` 240ms (paneles que entran y salen: columna del asistente, su vista en mobile) · Collapse/AutoHeight 250ms (`--ui-collapse-dur`)
- `transform` y `opacity`; el alto solo con `Collapse` / `AutoHeight` y la columna del asistente con `grid-template-columns` (son los únicos cambios de layout animados). Todo con guarda `prefers-reduced-motion: reduce` (duración 0 o sin animación).

## Reglas de layout (no negociables, ver CLAUDE.md)

Nada superpuesto en ningún ancho; nunca una barra de scroll visible (`scrollbar-width: none` + `::-webkit-scrollbar { display: none }` global; contenedores que scrollean llevan degradé de borde con `mask-image`); nunca scroll horizontal; botones y labels sin partirse (`white-space: nowrap; text-overflow: ellipsis; min-width: 0`); sin modales ni capas flotantes (excepción: tooltip de texto truncado).
