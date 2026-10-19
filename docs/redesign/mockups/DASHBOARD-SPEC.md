# Dashboard nuevo — "Mostrador" (especificación para diseñar)

Leé también `BRIEF.md` (misma carpeta) para el formato `.dc.html` y las reglas. **Cambios respecto del BRIEF:** el acento ya NO es lima, es **azul `#5B9BFF`** (hover `#8DBBFF`, texto sobre el botón primario `#0D0F12`); el azul de datos/estado "Prestado"/"Bueno" pasó a **turquesa `#4FD1C5`**. Rampa de azul para mapas/intensidades: `#24344D #2B4366 #304C76 #3C629D #4673BB #5087DD #5B9BFF`.

El dueño quiere el Dashboard rehecho por completo, pensado para el uso REAL diario del mostrador TIC de un colegio: dos asistentes prestan y devuelven Chromebooks (Touch), notebooks (TIC, Dell, Plani) y cartelitos durante el día, muchas veces con un lector de códigos USB, entre recreos. Tiene que ser eficaz: lo frecuente en 1 paso, nada decorativo.

Inventario de lo que hace HOY (no se puede perder nada): `C:\Users\Usuario\Downloads\techasset\docs\redesign\inventario\02-dashboard-y-prestamos.md` secciones 0 a 3 y 11 (leelas). Resumen:
- Tarjetas Total / Disponibles / Prestados / una por categoría (Touch, TIC, Plani, Dell…) que filtran la tabla y hacen scroll a ella. Filtros "No encontrados" y "Fuera de servicio" existen en código sin tarjeta.
- Tabla de equipos (filtrada por el buscador del topbar + buscador propio flexible "touch 34 / touch34 / 34touch / D1436 / plani 5"), fila clickeable abre la ficha, botón Prestar (lleva a Préstamos con la etiqueta), Devolver (devuelve al instante), Editar, pill de antigüedad del préstamo (Hoy / 1 día / N días), paginado 12→30→todos, resaltado de fila al buscar D1436 en el topbar.
- Panel "Ahora": próxima agenda (en curso / próxima de hoy / próxima de la semana; excluye Realizado/Cancelado/Faltaron equipos), hasta 2 tareas prioritarias (primero las del operador), "Recreo hasta HH:MM", Ver Agenda / Ver Tareas.
- Traspaso del turno: mini chat de notas de hoy (Enter envía, borrar nota, propias alineadas tipo chat). Antes existía marcar nota como "Importante" (se perdió; el cierre del día cuenta las importantes) → recuperarlo.
- Últimos 20 movimientos (fecha · tipo, descripción, operador · origen).
- Global: el lector USB tipeando fuera de un input lleva a Préstamos. Ctrl/Cmd/Shift+Click en chips de equipos/cartelitos = selección múltiple con barra "Prestar N / Devolver N / Limpiar" (esto vive en Préstamos; el dueño lo AMA: el Dashboard debe ofrecer la misma gramática).
- Modo consulta (Jefe que mira): no se puede prestar/devolver/editar (hoy la tabla del dashboard no lo respeta: bug a corregir).

## Pedido explícito del dueño (manda sobre todo lo demás)
"No quiero analíticas en el inicio, simplemente los datos útiles que cambian. Tareas y notas sí." → En el Inicio NADA de gráficos, tendencias, sparklines, porcentajes históricos, rankings ni comparaciones. Solo estado vivo y accionable: qué está afuera, qué está libre, qué viene en la agenda, tareas, notas del traspaso, últimos movimientos. Los números de los tiles son conteos del momento (no estadísticas). Las barritas de disponibilidad de categorías son "libres ahora / total", nada más.

## Concepto

Una sola pantalla que responde, en este orden: **¿qué tengo que hacer ahora?** (devolver/prestar, entregar agenda) → **¿qué está afuera?** → **¿qué viene?** → **¿qué pasó?**

### Distribución (desktop 1440, menú agrupado de 232px a la izquierda con "Inicio" activo, topbar 56px)

Topbar: a la izquierda "Inicio" + "Viernes 16 de octubre · Turno mañana"; a la derecha indicador "Actualizado hace 12 s" (punto turquesa), "Cierre del día" (secundario), campana con contador, avatar. (El botón "Nuevo préstamo" no hace falta acá: lo resuelve la barra de acción.)

**1. Barra de acción (protagonista, ancho completo, arriba).** Card de 1 fila alta (72px) con:
- Campo grande con ícono de lector: placeholder "Escaneá o escribí un equipo — touch 34, D1436, plani 5". Atajo visible `/` para enfocarlo. Con el lector USB, en el Dashboard lo escaneado cae ACÁ (en el resto de la app sigue llevando a Préstamos).
- Al escribir/escanear aparece debajo el resultado (popover anclado, no modal): el equipo encontrado (alias grande + etiqueta en mono + badge de estado) y LA acción que corresponde, marcada con `Enter`:
  - Si está **Prestado** → "Devolver" (Enter). Muestra a quién, curso/ubicación y hace cuánto ("Alex C. · 5F · Aula 3B · hace 2 h").
  - Si está **Disponible** → "Prestar" (Enter) despliega en línea 3 campos compactos: Persona (con sugerencias por historial; al elegirla completa rol/ubicación/curso/motivo más usados, como hoy), Ubicación, Motivo → "Confirmar préstamo" (Enter).
  - Si **no disponible / no encontrado / ambiguo** → mensaje claro y alternativas (ej. "Touch 3 · no encontrado. ¿Quisiste decir Touch 30, Touch 31…?").
- A la derecha de la barra: "Prestar varios" y "Devolver varios" (abren el escaneo continuo en lote: cada Enter suma a una cola, una sola confirmación).
- Después de devolver: toast abajo a la derecha "Touch 34 devuelto · Alex C." con **Deshacer** (8 s) — NUEVO.

**2. Fila de estado (debajo, 5 tiles compactos, clickeables = filtran la lista de abajo, el activo queda marcado):** Disponibles `118` · Prestados `23` · Más de 1 día afuera `3` (atención) · Fuera de servicio `2` · No encontrados `1`. Cada tile: número grande en mono + label + micro-detalle ("de 142"). Debajo, una fila de **categorías** como chips con barra de disponibilidad: "Touch 18/25 libres", "TIC 9/12", "Plani 4/6", "Dell 7/8", "Cartelitos 26/30" — click filtra (conserva las tarjetas por categoría de hoy).

**3. Cuerpo en 2 columnas (8/12 y 4/12):**
- **Izquierda — "Afuera ahora"** (la lista operativa). Tabs: Prestados (default) · Disponibles · Todos (los mismos filtros de los tiles). Buscador flexible chico a la derecha del título. Tabla densa (filas 44px): checkbox · Equipo (alias + etiqueta mono) · Quién (nombre + inicial, rol) · Dónde (curso/ubicación) · Desde (hora o "1 día" con pill de antigüedad: hoy normal, 1 día ámbar, 2+ rojo con texto) · acción **Devolver** a la derecha + menú "⋯" (Ficha, Editar, Copiar etiqueta). Fila clickeable abre la ficha en panel lateral. **Ctrl/Cmd/Shift+Click en filas = selección múltiple** (misma gramática que los cartelitos) → barra flotante "3 seleccionados · Devolver 3 · Limpiar" (y "Prestar N" si hay disponibles). Agrupar opcionalmente por persona/curso cuando una persona tiene varios equipos ("Grupo 5F · 6 equipos · Devolver los 6"). Paginado "Ver 20 más".
- **Derecha — "Ahora"**, apilado:
  1. **Agenda de hoy**: la actividad en curso arriba (curso, actividad, aula, "25 Touch", horario con barra de progreso, estado) con acciones "Entregar" / "Marcar realizada"; luego las próximas 2-3 de hoy en filas; "Recreo hasta 10:15" como chip; link "Ver agenda".
  2. **Tus tareas**: hasta 2 prioritarias (prioridad, vencimiento) — click abre ESA tarea; link "Ver tareas".
  3. **Traspaso del turno**: chat compacto de las notas de hoy (propias a la derecha), campo "Dejar una nota para el turno…" (Enter envía), estrella para marcar Importante, borrar con Deshacer.
- **Abajo, ancho completo — "Últimos movimientos"**: timeline compacta de los últimos 20 (hora mono · tipo con ícono · descripción · operador), plegable, con link a Historial.

### Interacciones clave (mostrar en el storyboard)
- **Devolver en 1 paso:** escanear D1436 (o tipear "touch 34") → aparece la tarjeta con "Devolver ↵" → Enter → toast con Deshacer. O bien botón Devolver en la fila.
- **Devolver varios:** Ctrl+Click en 3 filas → barra "Devolver 3" → confirmación compacta (lista de etiquetas) → toast "3 devueltos · Deshacer".
- **Prestar rápido:** escanear un disponible → Enter → Persona (sugerencia) → Enter → listo.
- **Teclado:** `/` enfoca la barra · `Enter` acción principal · `Esc` limpia/cierra · `↑ ↓` recorre la lista · `Espacio` marca la fila · `Ctrl+Click`/`Shift+Click` marcan · `?` muestra atajos.
- Tiles y categorías filtran la lista y hacen scroll suave a ella.

### Estados (todos con el mismo sistema)
- **Cargando:** skeletons con la forma exacta de cada bloque (no spinners), sin saltos de layout.
- **Vacío:** "Todo en casa: no hay equipos prestados." / agenda "Sin actividades hoy" / traspaso "Nadie dejó notas hoy".
- **Error:** banner en el bloque afectado ("No se pudo actualizar la lista · Reintentar"), datos anteriores visibles con "Actualizado hace 3 min". Devolución fallida: toast rojo con el motivo y "Reintentar".
- **Modo consulta:** acciones ocultas o deshabilitadas con candado y texto "Modo consulta: solo lectura"; la barra de acción busca pero no presta/devuelve.
- **Ocupado:** botón "Devolviendo…" con spinner chico, fila atenuada.
- **Sin conexión:** chip "Sin conexión · reintentando" en el topbar.

### Mobile (390)
Barra de acción arriba con botón de cámara (QR) a la derecha; tiles 2×2 + scroll horizontal de categorías DENTRO de su contenedor; "Afuera ahora" como tarjetas (alias, quién, desde, botón Devolver de 44px); "Ahora" en pestañas Agenda / Tareas / Traspaso; barra inferior (Inicio, Préstamos, Escanear, Agenda, Más).

## Tema claro (tokens)
fondo `#F6F7F9`, superficie `#FFFFFF`, elevada `#F0F2F5`, línea `#E3E6EB`, línea fuerte `#CDD2D9`, texto `#14171B`, texto 2 `#4A525E`, texto 3 `#646C78`; acento `#2F6FE0` (botón primario con texto blanco; hover `#2560C8`); estados: ok `#16804A`, atención `#A15C00`, mal `#C93636`, turquesa `#0F8A80`; badges con fondo del color al 10%. Sin sombras salvo popovers (`0 8px 24px rgba(20,23,27,.10)`).

## Datos
Usá etiquetas/alias/personas reales de la base local (podés leer `C:\Users\Usuario\Downloads\techasset\data\techasset.db` con node + better-sqlite3 en modo readonly desde el directorio del repo) y los totales de producción del BRIEF (142 activos). Personas como nombre + inicial. "Ahora" = viernes 16/10, 09:20, sede NFPT. Lo que no tengas: placeholder `[N]`.
