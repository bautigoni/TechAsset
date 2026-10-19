# Reglas innegociables de UX/UI del dueño (19/10/2026)

Texto del dueño, tal cual. Aplica a TODA la app, a cada pantalla de cada etapa, y es criterio obligatorio de la auditoría final (los 10 subagentes verifican estas reglas en todas las pantallas). Se suma a las reglas de `CLAUDE.md` (nada superpuesto, sin barras de scroll visibles, sin modales ni capas flotantes salvo el tooltip de texto truncado, sin "AI slop", mobile fijo).

> Nota de compatibilidad: varias reglas hablan de modales, drawers y popovers. En esta app **no hay** modales ni capas flotantes (decisión anterior del dueño): todo se abre en línea. Las reglas igual aplican a los paneles que se abren en línea (por ejemplo: un panel que se expande tiene que quedar visible y llevarte hasta él; nunca puede quedar contenido inaccesible; cerrar no puede perder tu posición), y al único elemento flotante permitido, el tooltip de texto truncado (no puede quedar cortado por el borde ni desaparecer cuando movés el cursor hacia él).

## Cosas que JAMÁS tienen que pasar en una web

### 🖱️ Interacciones y comportamiento
- En ningún contexto, al tocar un botón, se puede mover toda la pantalla inesperadamente.
- En ningún contexto, al abrir un modal, drawer o panel, puede aparecer fuera del área visible sin llevarme automáticamente hasta él.
- En ningún contexto, un popup puede tener contenido que no se pueda scrollear hasta el final.
- En ningún contexto, un botón puede ejecutar una acción sin dar feedback visual de que algo pasó.
- En ningún contexto, un elemento puede parecer clickeable si no lo es.
- En ningún contexto, una acción puede cambiar el scroll, el foco o la posición de la página sin una razón clara.
- En ningún contexto, un menú desplegable puede quedar cortado por los bordes de la pantalla.
- En ningún contexto, un tooltip puede desaparecer justo cuando intento mover el cursor hacia él.
- En ningún contexto, un botón puede quedar tapado por otro elemento flotante.
- En ningún contexto, puedo activar accidentalmente una acción destructiva por tocar dos veces o por un clic mal interpretado.

### 📱 Scroll y navegación
- En ningún contexto, puede haber scroll horizontal accidental en una web que debería adaptarse al ancho de la pantalla.
- En ningún contexto, dos contenedores pueden competir por el scroll y dejarme atrapado en una sección.
- En ningún contexto, un modal puede bloquear el scroll de una manera que me impida acceder a su propio contenido.
- En ningún contexto, al cerrar un modal puedo perder la posición de scroll en la que estaba trabajando.
- En ningún contexto, una barra fija puede tapar títulos, botones, campos o contenido importante.
- En ningún contexto, puedo quedar atrapado en un scroll infinito sin una forma clara de llegar al pie de página.
- En ningún contexto, una sección puede cambiar de tamaño inesperadamente mientras estoy interactuando con ella.
- En ningún contexto, una animación puede hacer que pierda el lugar donde estaba leyendo o intentando hacer clic.

### 🪟 Modales, popups y overlays
- En ningún contexto, se puede abrir un modal fuera del viewport o parcialmente oculto.
- En ningún contexto, un modal puede exceder la altura disponible sin tener scroll interno.
- En ningún contexto, un popup puede abrirse detrás de otro elemento.
- En ningún contexto, puedo abrir un segundo modal que tape el primero y me deje en un estado confuso.
- En ningún contexto, un modal puede cerrarse accidentalmente por hacer clic dentro de su contenido.
- En ningún contexto, un popup puede bloquear toda la interfaz sin ofrecer una manera evidente de cerrarlo, salvo que sea un flujo verdaderamente obligatorio.
- En ningún contexto, un modal puede tener botones importantes fuera del alcance visible sin una forma de acceder a ellos.
- En ningún contexto, puede aparecer un popup inesperado mientras estoy escribiendo, seleccionando texto o completando un formulario.

## Reglas innegociables de UX/UI y calidad de implementación

Quiero que desarrolles interfaces con un estándar de calidad profesional. No me alcanza con que la web se vea bien en una captura: tiene que funcionar correctamente en situaciones reales de uso.

### Prohibiciones absolutas
1. Nunca provoques movimientos inesperados del layout, saltos de pantalla ni cambios de scroll como consecuencia de una interacción.
2. Nunca abras un modal, drawer, popup o popover fuera del viewport, parcialmente oculto o en una posición a la que el usuario no pueda acceder inmediatamente.
3. Nunca permitas que un popup, modal o panel contenga información inaccesible por falta de scroll. El contenido debe poder recorrerse por completo, incluso en pantallas pequeñas.
4. Nunca permitas que el contenido quede cortado, que existan desbordamientos accidentales o que elementos interactivos se superpongan.
5. Nunca dejes botones sin funcionalidad, acciones sin feedback ni operaciones que puedan ejecutarse varias veces accidentalmente.
6. Nunca pierdas datos ingresados por el usuario debido a un rerender, una actualización de estado, un error recuperable o una navegación evitable.
7. Nunca permitas que headers, footers, barras fijas, overlays o elementos flotantes tapen contenido o controles importantes.
8. Nunca generes scroll horizontal accidental ni conflictos entre contenedores con scroll.
9. Nunca permitas que una animación interfiera con la interacción, retrase acciones o desplace inesperadamente el contenido.
10. Nunca entregues formularios, menús, modales o componentes responsive sin contemplar sus estados de error, carga, éxito y contenido vacío cuando correspondan.

### Comportamiento obligatorio
- Todo componente interactivo debe comportarse de manera predecible y consistente.
- Al abrir un modal, debe quedar dentro del área visible, gestionar correctamente su foco y permitir acceder a todo su contenido.
- Los modales altos deben adaptarse a la altura disponible y disponer de scroll interno cuando sea necesario.
- Al cerrar un modal, debe restaurarse el foco y conservarse la posición de la página cuando corresponda.
- Los popovers y dropdowns deben ajustar su posición para evitar quedar cortados por los límites del viewport.
- Los botones deben proporcionar feedback claro durante y después de cada operación.
- Los formularios deben conservar sus valores cuando se produzcan errores recuperables y mostrar mensajes de validación comprensibles.
- La interfaz debe ser responsive y funcional en desktop, tablet y mobile.
- Los estados de carga, error, éxito, vacío y deshabilitado deben estar contemplados cuando sean pertinentes.
- La accesibilidad, el uso mediante teclado, el foco visible y la reducción de movimiento deben formar parte de la implementación.
- Los componentes equivalentes deben mantener el mismo lenguaje visual y comportamiento en toda la aplicación.

### Proceso obligatorio de verificación
Antes de considerar terminado cualquier componente o pantalla:
1. Revisa qué ocurre al hacer clic, abrir, cerrar, guardar, cancelar y volver atrás.
2. Prueba modales y popups con contenido corto y largo, incluyendo situaciones que requieran scroll.
3. Comprueba que ningún elemento importante quede fuera del viewport o debajo de otro componente.
4. Prueba resoluciones pequeñas y grandes, así como textos extensos y estados vacíos.
5. Verifica que las acciones no dupliquen operaciones y que los errores no borren información.
6. Comprueba los estados de carga, error y éxito, además del comportamiento con teclado.
7. Corrige los problemas detectados antes de dar la tarea por finalizada.

No afirmes que una funcionalidad fue probada si realmente no lo fue. Si una regla no puede cumplirse por una limitación técnica, explícala y propón una solución adecuada.

Prioridad: primero funcionalidad, previsibilidad, accesibilidad y robustez; después los detalles estéticos. Una interfaz visualmente atractiva que se comporta mal está mal hecha.

## Agregado del dueño (19/10): abrir y cerrar secciones

Ejemplo que marcó: en Préstamos, al cerrar "Cartelitos de fotos" la página saltó y el encabezado que tocó quedó ~200 px más abajo. **Eso no puede pasar.**
- Toda sección, grupo, ficha o panel que se despliega **se abre y se cierra con una transición suave de alto** (se pliega hacia arriba, hacia su encabezado), nunca de golpe. Con `prefers-reduced-motion: reduce` es instantáneo.
- **El encabezado que se tocó queda fijo en la pantalla**, bajo el cursor: se mueve lo de abajo, nunca la página. Si al cerrar el documento se acorta y el navegador tendría que recortar el scroll, se compensa para que el encabezado no se desplace (por ejemplo, conservando el alto con un espaciador que se libera suavemente, o ajustando `scrollTop` en el mismo frame).
- Lo mismo al abrir: lo que aparece crece hacia abajo desde el encabezado; si queda fuera de vista, se lleva suavemente hasta él (`scrollIntoView({ block: 'nearest', behavior: 'smooth' })`, instantáneo con reduced motion).
- Implementación única en `src/ui` (componente/hook de colapso compartido) usada por TODA la app; nada de colapsos caseros con `display: none`.

## Agregado del dueño (19/10): sin huecos, sin truncar con espacio, vacíos diseñados

Ejemplos que marcó: (1) la franja de Accesos rápidos mostraba una columna angosta con más de media franja vacía, truncando títulos, y empujaba la página de golpe; (2) en el Inicio, "Afuera ahora" vacío dejaba un hueco enorme hasta "Últimos movimientos" (columnas desbalanceadas), el estado vacío era una línea de texto suelta, y los movimientos truncaban textos ("Dispositivo e…") con espacio de sobra; (3) el menú lateral mostraba "Historial" cortado/medio tapado al pie.
- **Nunca huecos grandes vacíos** por desbalance de columnas o por alturas fijas: el layout se reacomoda (las columnas fluyen, lo de abajo sube, o la sección vacía se compacta).
- **Nunca truncar si hay espacio**: el texto usa el ancho disponible (o 2 líneas); la elipsis es solo el último recurso cuando de verdad no entra (y entonces con tooltip).
- **Usar el ancho**: paneles y listas se distribuyen en grilla responsive; nada de una columna angosta con la mitad vacía.
- **Estados vacíos diseñados**: compactos, con un ícono o ilustración sobria, una frase clara y, si corresponde, la acción siguiente; no una línea de texto perdida en una tarjeta alta.
- **Ningún ítem de una lista o menú puede verse cortado o medio tapado** por otro bloque.

## Cómo se aplica en este proyecto (checklist técnico por pantalla)

- **Sin saltos**: abrir/cerrar un panel en línea no mueve lo que está arriba del punto de interacción; si lo abierto queda fuera de vista, se hace `scrollIntoView({ block: 'nearest' })` (respetando `prefers-reduced-motion`); al cerrar, el foco vuelve al disparador y la posición se conserva.
- **Feedback siempre**: todo botón muestra estado ocupado (`loading`) mientras trabaja y resultado (línea de estado OK/error/Deshacer) al terminar; doble click o doble Enter no duplica (botón deshabilitado durante la operación / idempotencia en el server).
- **Destructivas**: confirmación en línea (InlineConfirm) o Deshacer; nunca un solo click accidental borra sin vuelta atrás.
- **Formularios**: los valores sobreviven a errores, refrescos por polling y re-renders (estado local no se pisa con datos que llegan del server mientras se edita); aviso de cambios sin guardar al navegar.
- **Scroll**: un solo contenedor de scroll por zona; nada de scroll anidado que atrape; la topbar/barra inferior nunca tapan contenido (padding/safe areas); `scroll-margin-top` para anclas bajo la topbar.
- **Tooltip** (único flotante): se reposiciona para no cortarse en el borde y se mantiene abierto mientras el cursor va hacia él.
- **Clickeable = parece clickeable y viceversa**: cursor, hover y foco solo en lo interactivo.
- **Estados**: carga (skeleton con la forma real, sin saltos), vacío, error con Reintentar, éxito, deshabilitado con motivo.
- **Pruebas**: el e2e de cada pantalla cubre abrir/cerrar/guardar/cancelar/volver, contenido corto y largo, 360–1920 px, sin duplicar operaciones y sin perder datos ante un error.
