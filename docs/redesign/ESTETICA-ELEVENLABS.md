# Estética ElevenLabs → Grafito (20/10/2026)

Pedido del dueño: "la estética me gusta que sea todo más redondo si lo podés hacer, usá la estética de ELEVENLABS que la amo". Se estudió elevenlabs.io y su librería pública de componentes (ui.elevenlabs.io: Orb, Conversation Bar, Message), midiendo estilos computados en el navegador (solo lectura).

## Qué es la estética de ElevenLabs

Superficies limpias casi monocromas (fondo blanco cálido `#FDFCFC`, texto negro y un gris cálido `#777169` para lo secundario), mucho aire y una tipografía calma: títulos grandes en peso liviano (Waldenburg 300, tracking negativo −0,02 em) y texto en Inter 400, sin negritas gritonas. La forma es lo que más se nota: **todo lo que se toca es una píldora** (botones de 32–44 px con `border-radius: 9999px`, 14–20 px de aire a los costados; 195 píldoras en la home), las tarjetas y paneles llevan radios grandes (20–24 px) y lo de adentro radios concéntricos (contenedor 24 con 6 de aire → pestaña 14–18). Los bordes casi no existen: un anillo de 0,5 px a 12 % de opacidad y una sombra de 1–4 px muy tenue separan el botón blanco del fondo. Íconos de trazo fino. Movimiento corto y suave (150 ms, `cubic-bezier(.4,0,.2,1)`) solo en color, fondo y sombra. Su marca más reconocible es el **orb** del agente de voz: una esfera con bandas de color que se mueven despacio y cambia de ritmo según el agente esté quieto, escuchando o hablando; la barra de conversación es una píldora con botones redondos de micrófono y acción.

## Cómo se tradujo a Grafito (sin romper las decisiones del dueño)

| ElevenLabs (medido) | Grafito (nuevo) | Por qué así |
|---|---|---|
| Botones `9999px`, 32–44 px de alto, 14–20 px a los costados | `--g-radius-btn: var(--g-radius-pill)`; `.ui-btn` 14 px a los costados (10 en `sm`), alto `--g-control-h` (36 / 44 en touch) | Igual. Los botones vecinos siguen con la misma altura (agregado 2, punto 1). |
| Tarjetas y paneles 20–24 px | `--g-radius` 16 (tarjetas, `--g-radius-card`), `--g-radius-lg` 20 (paneles, `--g-radius-panel`), `--g-radius-xl` 24 (pop up) | Grafito es denso (tablas, listas): 16 en tarjetas mantiene las filas legibles; 20–24 en lo grande. |
| Radios concéntricos (contenedor 24, pestaña 14) | Escala `xs 6 · sm 12 · 16 · lg 20 · xl 24 · pill`; campo 12 → opción de su lista 8 (`--ui-radius-inner`); tarjeta 16 → campo 12 | Un elemento adentro de otro lleva el radio de afuera menos el aire que los separa. |
| Campos de texto redondeados | `--g-radius-field: 12px` (input, select, textarea, número, fechas) | Píldora en campos de una línea se ve bien sola pero choca con textareas y campos con chips: 12 queda consistente. |
| Pestañas segmentadas en píldora | `Segmented` píldora con píldoras adentro; chips (TagInput, horas, sugerencias) en píldora; días del calendario redondos | Igual. |
| Bordes de 0,5 px con sombra tenue | Bordes de 1 px `--g-line` / `--g-line-strong` (sin sombras) | El dueño prohibió sombras fuera del tooltip; el contraste de bordes de controles se mantiene (≥ 3:1 en controles). |
| Fondo blanco cálido, grises cálidos | Paleta Grafito sin cambios (oscuro y claro completos) | Decisión ya aprobada; el acento sigue siendo azul `#5B9BFF` / `#2F6FE0`. |
| Inter 400, títulos livianos con tracking negativo | Geist (ya alojada); títulos del asistente con `letter-spacing: -.01em`, pesos 500–600 | Geist es de la misma familia "calma"; no se suma otra fuente (presupuesto de CSS/fuentes). |
| Íconos de trazo fino | lucide con `strokeWidth` 1,6 (ya era así) | Igual. |
| Movimiento 150 ms en color/fondo | `--g-dur-fast` 120 ms en hover; aperturas 240–250 ms con `--g-ease` (receta *accordion* / *panel-reveal* de transitions.dev); todo con guarda `prefers-reduced-motion` | El dueño pidió que nada se abra "de golpe": las aperturas llevan alto/opacidad, no solo color. |
| Orb (WebGL, bandas de color que giran) | `AssistantMark`: esfera CSS en tres tonos del acento (`--g-orb-hi/mid/lo`), sombreado tonal mínimo, un brillo interno que gira lento **solo** mientras piensa; respira al escuchar o hablar; quieta con movimiento reducido | Sin glow, sin halo, sin gradientes de colores: solo tonos del acento. Pesa nada (va en la barra). Dos alternativas más (anillo, dúo) en Componentes UI para que el dueño elija. |
| Barra de conversación en píldora con botones redondos | Compositor del asistente en píldora (`--g-radius-pill`), micrófono redondo ghost y enviar redondo en acento | Igual. |
| Mensajes: el del usuario en burbuja gris, el del agente casi sin caja | Burbuja propia rellena (`--g-raised`), la del asistente con borde fino; esquina más chica del lado de quien habla | "Burbujas suaves" que se distinguen en oscuro y claro. |

Lo que **no** se tomó (reglas del dueño): sombras y anillos de sombra, gradientes llamativos, halos o glows del orb, pastillas de estado con puntito y fondo tintado, modales y capas flotantes (salvo el tooltip de truncado y el pop up de cartelitos), barras de scroll visibles.

## Dónde vive

- Tokens: `src/styles/tokens.css` (contrato en `TOKENS.md`): radios, semánticos de forma, foco (`--g-focus-w`, `--g-focus-offset`), `--g-dur-panel`, `--g-orb-*`.
- Componentes: `src/ui/ui.css`, `src/ui/pickers/pickers.css` (todos heredan por token); muestra viva en Componentes UI (`/ui`): "Forma · radios" y "Asistente · marca".
- Asistente: `src/components/assistant/` (`AssistantMark.tsx` + `mark.css`, `AssistantPanel.tsx`, `assistant.css`) y la columna en `src/styles/shell.css` / `AppShell.tsx`.
- Las pantallas heredan sola la forma nueva si usan `--g-radius-*` (no px sueltos).
