# Brief v2 — rediseño TechAsset (reemplaza al BRIEF.md en todo lo que se contradiga)

Leé primero `BRIEF.md` (misma carpeta) SOLO para el formato `.dc.html` (sección "Formato de archivo"): reglas que fallan en silencio, skeleton, `renderVals`, `sc-for`, `sc-if`, eventos. Todo lo visual de ese brief queda reemplazado por esto.

TechAsset es la app interna del equipo TIC de un colegio (sedes NFPT y NFND): préstamos de equipos (Touch, TIC, Plani, Dell, cartelitos), dispositivos, inventario, agenda, aulas, tareas, tickets, etc. Español rioplatense. Repo: `C:\Users\Usuario\Downloads\techasset`. Inventarios funcionales (lo que hace HOY cada pantalla y NO se puede perder): `C:\Users\Usuario\Downloads\techasset\docs\redesign\inventario\` (01 a 06). Antes de diseñar una pantalla, leé su sección del inventario y cubrí TODAS sus funciones (podés agregar mejoras, nunca sacar funciones).

## Reglas del dueño (no negociables; cada una salió de una queja concreta)

1. **NADA se superpone**, en ningún ancho. Botones y labels nunca en dos líneas ni partidos palabra por palabra (`white-space: nowrap; overflow: hidden; text-overflow: ellipsis`, `min-width: 0` en hijos de flex). Grupos de botones/chips envuelven (`flex-wrap`). Columnas que no entran bajan debajo; tablas angostas pasan a filas-tarjeta.
2. **Nunca una barra de scroll visible** (ni nativa con flechitas, ni horizontal bajo una fila de chips) y **nunca scroll horizontal**. Preferí "Ver más"/"Ver anteriores" o envolver en filas.
3. **Nada de modales ni capas flotantes**: sin modales, paneles laterales superpuestos, hojas inferiores, toasts o barras flotantes, popovers, menús desplegables. Lo que se abre va **en línea y empuja el contenido**: formularios en línea, ficha que se expande debajo de su fila (o página de detalle propia), barra de selección que reemplaza el encabezado de la lista (con las confirmaciones de lote), Deshacer/Reintentar como **línea de estado** en línea donde pasó la acción, selects y calendarios propios que se despliegan en línea.
4. **Única excepción a 3:** todo texto cortado con elipsis se lee completo al hacer hover o foco, con un tooltip chico (superficie elevada, borde línea, 13px, sin flecha decorativa ni sombra fuerte), solo si está realmente cortado. En mobile, tocarlo lo despliega en línea.
5. **Nada de "AI slop"**. Prohibido, con ejemplos que el dueño marcó:
   - puntitos de color delante de textos o filtros ("● Disponible 68", "● Prestado 2");
   - pastillas/badges con fondo tintado ("● Disponible" verde sobre verde, "● 2 sin stock" rojo, "● 1 bajo stock" ámbar);
   - barritas de progreso de color debajo o al lado de valores ("20 h 52 min" con barra turquesa, "Touch 28/40" con barra);
   - checkboxes nativos azul brillante;
   - cuadraditos decorativos delante de títulos;
   - brillos, glows, gradientes, sombras de colores, bordes de color a la izquierda de cards, emojis.
   **En cambio:** el estado normal NO se marca (texto plano en texto-2 o nada). Lo que pide atención va como **texto coloreado sin fondo ni punto** ("Prestado · hace 2 días" en ámbar, "Sin stock" en rojo, "4 días" en rojo). Filtros como texto/segmented con el conteo en mono texto-3 (`Disponibles 68`), sin puntos. Proporciones (libres/total) con un **anillo fino**: 32–40px, trazo 3px, extremos redondeados, pista color línea, arco texto-2 neutro (ámbar si ≤20%, rojo si 0), número en mono al lado. Duraciones y cantidades: solo el número en mono.
6. **Checkbox propio**: 16px, radio 4px, borde `#353B44`, fondo transparente; marcado = fondo `#ECEEF1` con tilde `#0D0F12` (en claro: fondo `#14171B`, tilde blanca); indeterminado = guion; foco = anillo azul 2px con offset. Nunca azul brillante relleno.
7. **Sin analíticas en el Inicio** (solo datos vivos, tareas y notas).
8. **"Traspaso TIC" ya no existe**: en el Dashboard queda solo un bloque **"Notas"** (las notas del día, escribir con Enter, marcar importante, borrar con Deshacer en línea). No pongas paneles de traspaso en ninguna otra pantalla.
9. **Asistente de IA**: NO hay botón flotante abajo a la derecha. Es un botón en la **barra superior** ("Asistente", ícono + texto; en mobile solo ícono con aria-label). Al abrirlo, el asistente aparece como una columna que empuja el contenido (desktop) o como una vista propia (mobile), nunca encima.
10. **Tareas SÍ se rediseña** (cambio del dueño): estética nueva entera con TODAS las funciones de hoy; lo único que se conserva tal cual es la transición del botón "+" (menú líquido/gooey de motion.css §9 y GooeyMenu.tsx).
11. **Botón de accesos rápidos (rayo) en la topbar se queda**: al tocarlo, los accesos se abren como una franja en línea debajo de la topbar que empuja el contenido (nunca popover). Ctrl K es un atajo extra, no lo reemplaza.
12. **Resoluciones**: tiene que verse bien en TODAS (360 a 1920+), no solo en un monitor.

## Lenguaje visual Grafito (azul)

- Fondo `#0D0F12`, superficie `#14171B`, elevada `#1B1F24`, línea `#262B32`, línea fuerte `#353B44`; texto `#ECEEF1` / `#A7AEB8` / `#7C8592` (mínimo para texto).
- **Acento azul `#5B9BFF`** (hover `#8DBBFF`), con moderación: item activo del menú (barrita 2px dentro del item + texto claro + fondo elevada), botón primario (texto `#0D0F12` sobre azul), foco (anillo 2px), link. Info/"prestado" en turquesa `#4FD1C5`. Atención `#F5C04E`, mal `#FF6B6B`, ok `#5BD68A` (solo como color de texto o arco de anillo, nunca fondo).
- Tipografía Geist (UI) + Geist Mono (etiquetas D1436, horas, números, tabular-nums). `<link>` de Google Fonts en el helmet solo para el mockup (en la app real va self-hosted). Escala 12/13/14/16/20/28/40; títulos 600.
- Radios 6px (controles), 10px (cards). Bordes 1px línea. Sin sombras salvo el tooltip de texto truncado.
- Encabezado de sección: eyebrow Geist Mono 11px mayúsculas texto-3 + título 20px 600.
- Botones 36px (44px en mobile): primario azul, secundario (elevada + borde línea fuerte), ghost (texto-2).

## Shell (todas las pantallas)

Copiá el menú lateral de `project/Menu-A.dc.html` (232px, agrupado: Operación / Gestión / Inventario y datos / Recursos, selector de sede arriba, buscador "Buscar o ir a… Ctrl K", Configuración y usuario abajo), con el item de tu pantalla activo. **Sacá "Traspaso" si aparece**. Topbar 56px: título de la pantalla (y contexto corto), a la derecha: botón **Asistente** (nuevo lugar), campana, ayuda. A <1100px el menú pasa a rail de 56px; en mobile no hay menú lateral: barra inferior (Inicio, Préstamos, Escanear al centro, Agenda, Más) y topbar con título + Asistente (ícono) + campana.

## Tamaños de artboard

- **Desktop = monitor del dueño (19", 1440×900)**: artboard de 1440 de ancho; diseñá para que lo principal entre en los primeros ~830px de alto (900 menos el navegador) y que todo funcione también a 1366 de ancho. Si la pantalla es más larga, el alto del artboard es el real (decímelo).
- **Mobile = 390 de ancho**, perfecto: botones de 44px, nada cortado, nada superpuesto, sin scroll horizontal, alto el real.
- Cada pantalla = 2 archivos: `project/<Nombre>.dc.html` (desktop) y `project/<Nombre>-m.dc.html` (mobile). `$preview` con el alto real.
- Root fluido (sin ancho fijo en px; `width: 100%`), podés usar `@media`/`@container` en el `<style>` del helmet con clases para lo responsive.

## Datos

Reales de la base local: `node` + `better-sqlite3` en modo **readonly** ejecutado desde `C:\Users\Usuario\Downloads\techasset` sobre `data/techasset.db` (nunca escribas). Personas como nombre + inicial. Lo que no haya: placeholder visible `[N]`. Nada de estadísticas inventadas.

## Entrega

Escribí con Write, un archivo a la vez. NO publiques, NO rendereés, NO abras navegador. Al terminar respondé: archivos, alto real de cada uno, cuáles son interactivos, y para cada pantalla qué puntos del inventario cubriste y si alguno quedó afuera (y por qué).
