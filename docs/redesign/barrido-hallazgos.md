# Barrido UX: hallazgos y su estado

Medido con la suite `e2e/tests/ux.mjs` (sonda compartida `e2e/lib/ux-probe.mjs`, API en `e2e/README.md`) sobre la rama del frente de infraestructura, contra la copia de la base local. Cada vista del menú y cada página con URL se midió a **390, 1024 y 1440 px en oscuro y claro**; los colapsables (botones con `aria-expanded`) se abrieron y cerraron con el mouse y la animación real a **1440 oscuro** y **390 claro**. No se tocó ninguna de estas pantallas desde este frente.

Para reproducir: `npm run e2e -- --only=ux` (todo, ~4,5 min) o `--only="ux operacion"`, `--only="ux gestion"`, `--only="ux recursos"`, `--only="ux equipo"`… El detalle por ancho y tema queda en `e2e/.out/ux/report.json`, las capturas en `e2e/.out/ux/<vista>-<tema>-<ancho>.png` y esta misma lista, regenerada, en `e2e/.out/ux/hallazgos.md`. El barrido es bloqueante en `npm run e2e`; con `--ux-lenient` solo informa.

Qué significa cada hallazgo:

- **De golpe**: al abrir o cerrar, el alto del contenido cambió más de 40 px de un frame al otro, sin valores intermedios: un `{open && …}` (o un reemplazo de bloque) donde REGLAS-UX pide `Collapse` / `anchored(...)`.
- **El disparador se movió N px**: el botón tocado se corrió en pantalla por un cambio de layout (no cuenta el scroll suave para mostrar lo que se abrió, mientras el botón siga a la vista). **Quedó fuera de la vista**: ese scroll lo sacó de pantalla.
- **Sin aria-controls**: el botón tiene `aria-expanded` pero no dice qué controla (`aria-controls` + `id` en lo que abre; con `Collapse` es el `id` del colapso).
- **Truncado con lugar**: texto con elipsis cortado mientras en su renglón sobra espacio para mostrarlo entero (se indica cuánto falta y cuánto sobra).
- **Franja vacía / hueco**: más de 48 px vacíos dentro de una tarjeta (al pie, arriba o en el medio) o entre dos bloques consecutivos.

## Estado final (19/10/2026, rama `rediseno-grafito` con los cuatro frentes integrados)

La sonda completa (`npm run e2e -- --only=ux`) da **0 en todas las vistas** (las del menú, la página del equipo, de una tarea, de un ticket, de un artículo y los 14 paneles de Configuración, a 390/1024/1440 en oscuro y claro, con abrir/cerrar de cada colapsable) y desde ahora es **bloqueante** en `npm run e2e` (`--ux-lenient` para depurar). Lo único que queda en el reporte es informativo: en Analítica, al scrollear, algunos controles pasan por debajo del índice sticky (se alcanzan scrolleando un poco; no cuenta como tapado).

Abajo, la medición original (antes de los arreglos de cada frente) con su estado: **Resuelto** (por el frente o en la integración), **Falso positivo** (de la sonda, corregido en `e2e/lib/ux-probe.mjs`) o **Pendiente**.

### Operación
| Hallazgo | Estado |
|---|---|
| Inicio: Cierre del día y "Disponibles: N" de golpe / sin aria-controls | Resuelto (frente Operación: `Collapse` + `aria-controls`) |
| Préstamos: Cierre del día de golpe | Resuelto (frente Operación) |
| Préstamos: Cámara sin cambiar aria-expanded y salto de 52 px | Resuelto (integración): el botón abre y cierra el panel de la cámara también cuando no hay cámara (muestra por qué); `aria-controls="lo-camera"` |
| Dispositivos: cinco paneles de golpe y sin aria-controls | Resuelto (frente Operación) |
| Dispositivos: ficha debajo de la fila sin animar | Resuelto (frente Operación: `Table` usa `Collapse` + `useHeldKeys`) |
| Dispositivos: truncados con lugar (modelo, prestado a, estado; y SN/modelos sin espacios) | Resuelto (integración): hasta 2 renglones y corte en cualquier carácter para SN y modelos |
| Página del equipo: secciones con franja vacía al pie | Resuelto (integración): `FlowColumns` (columnas que fluyen; abrir algo solo agranda su columna) |
| Página del equipo: "+ Agregar" sin aria-controls y moviéndose al cerrar | Resuelto (Operación + integración: `aria-controls`; el ancla de `Collapse` lo deja quieto) |
| Página del equipo: "Abrir calendario" de golpe | Resuelto (integración): `DatePicker`, `DateRange`, `TimeField` y `Select` despliegan su panel con `Collapse` |
| Historial: resumen de golpe y sin aria-controls; encabezado cortado a 1024 | Resuelto (Operación: `Collapse`; integración: `aria-controls` por fila) |
| Inventario TIC: paneles de golpe y sin aria-controls | Resuelto (frente Operación) |

### Gestión
| Hallazgo | Estado |
|---|---|
| Agenda: Nueva actividad, Sincronizar, Filtros, "Ver detalle" de golpe / sin aria-controls | Resuelto (Gestión: `Collapse`; integración: `aria-controls` en todos, también en la vista Semana) |
| Agenda: con pocas actividades la columna Próximas + Touch por franja queda más alta que la lista | Resuelto (integración): si el costado queda > 48 px más alto, la lista pasa a todo el ancho y las dos tarjetas bajan lado a lado. Se decide al cambiar día/filtros/datos o el ancho, nunca mientras se abre un detalle |
| Horarios: Agregar horario de golpe / sin aria-controls | Resuelto |
| Horarios (recreos): el campo de hora abierto saltaba a su propia fila (44 px) | Resuelto (integración): Inicio y Fin quietos; el selector se despliega debajo, a todo el ancho |
| Estado aulas: Categorías sin aria-controls | Resuelto |
| Estado aulas: planta alta con pocas aulas deja un hueco debajo de la lista | Resuelto (integración): sin ficha abierta el plano se ajusta al alto de la columna derecha (piso de 20rem, el zoom sigue) y las filas de la lista llegan a su pie; con la ficha abierta el plano conserva el tamaño |
| Recordatorios: Nuevo / Posponer / Editar sin aria-controls | Resuelto |
| Tareas: editor de columna de golpe / sin aria-controls; "+" corrido 5 px al cerrar | Resuelto (Gestión: `Collapse`; integración: `aria-controls`, el "+" se hunde 2 px) |
| Tareas: "Ver N más" de golpe | Resuelto (integración): las subtareas de más se despliegan con `Collapse` |
| Tickets: panel vacío sin selección (línea suelta en tarjeta alta; espacio vacío a la derecha) | Resuelto (Gestión: `EmptyState compact`; integración: resumen por estado y "Esperan hace más", que abren su ticket) |
| Ticket: selector "Elegí un ticket…" de golpe y disparador corrido | Resuelto (integración): `Select` con `Collapse`, y la reserva de scroll al cerrar cuenta el gap del colapso |
| Sugerencias: Nueva, Comentarios, Estado sin aria-controls | Resuelto (integración) |
| Sugerencias: "Nueva sugerencia" cierra de golpe (99 px a 1440) | Falso positivo: el colapso anima (364 → 0), pero la columna de filtros pone piso al alto de la página y el primer frame de la curva consume los 99 px visibles. La sonda ahora mira también el alto de lo que controla el botón |

### Recursos y Configuración
| Hallazgo | Estado |
|---|---|
| Analítica: tarjetas con franjas vacías y huecos entre bloques | Resuelto (Recursos: contenido centrado y tablas con su alto; integración: una fila despareja > 48 px se apila —no se reacomoda mientras el usuario cambia Gráfico/Tabla—, skeleton de línea sin franja vacía y el mapa de calor apilado sin doble relleno) |
| Analítica: controles que pasan bajo el índice sticky | Informativo (no cuenta) |
| Caja chica: Registrar gasto / Solicitar compra sacaban el botón de la vista a 390; sin aria-controls | Resuelto (Recursos: errores debajo de las acciones, `returnFocus`; integración: `aria-controls`) |
| Herramientas: paso 2 con ~200 px vacíos al pie | Resuelto (integración): el paso muestra el esquema de la hoja A4 (2 × 4) y ocupa el alto del paso 1 |
| Accesos rápidos: dominio cortado a 390; Nuevo acceso sin aria-controls | Resuelto |
| Canvas: Archivo sin aria-controls | Resuelto |
| Configuración: Roles de golpe; Usuarios, Sedes, Avanzado sin aria-controls; Nuevo usuario fuera de la vista a 390 | Resuelto (Recursos: `Collapse`; integración: `aria-controls` en cada fila) |
| Configuración › Mail: hueco de 52 px en la grilla a 1024 | Resuelto (integración): la pista del puerto entra en un renglón |

### Shell y transversales
| Hallazgo | Estado |
|---|---|
| Líneas de estado de las pantallas que aparecían de golpe (`useStatusLine`) | Resuelto (integración): `useStatusLine` entra y sale con el colapso compartido (gap automático), `status.slot(clase)` donde el lugar tiene margen propio; `StatusSlot` es lo mismo |
| Reserva de alto al pie que quedaba al cambiar de vista | Resuelto (integración): el shell la suelta al cambiar de vista, de sede y con Atrás/Adelante |
| Dashboard a 390: "Agenda / Tareas" tapado por la barra inferior | Falso positivo: a media página el botón tenía el centro justo en el borde del área que scrollea; la sonda lo cuenta como scrolleado afuera |

### Medición original


#### Frente Operación (Inicio, Préstamos, Dispositivos, Historial, Inventario)

##### Inicio — `/sede/NFPT/dashboard`
- **Cierre del día** (botón de la cabecera): se cierra de golpe (~500 px a 1440, ~770 a 390) y no tiene `aria-controls`.
- **"Disponibles: N"** (`aria-controls=dash-types`): la lista por tipo abre de golpe (~320–450 px) y cierra de golpe (52–104 px), a 1440 y a 390.

##### Préstamos — `/sede/NFPT/loans`
- **Cierre del día** (`aria-controls=lo-cierre`): `{closureOpen && <DailyClosureSection/>}` en `LoansPage.tsx`: se cierra de golpe (~510 px a 1440, ~770 a 390). La apertura entra con `ui-enter` pero el alto también llega de una.
- **Cámara**: tiene `aria-expanded` pero sin cámara (headless) no cambia ni da aviso; al tocarla a 390 el contenido salta 52 px. Sin `aria-controls`.

##### Dispositivos — `/sede/NFPT/devices`
- **Importar CSV, Exportar, Grupos, Papelera, Añadir dispositivo**: los cinco paneles abren y cierran de golpe (`{panel === 'x' && …}` / `{creating && …}` en `DevicesPage.tsx`; 150–600 px a 1440, hasta 1350 a 390) y ninguno tiene `aria-controls`.
- **Ficha en línea de una fila**: la abre `Table` de `src/ui` con `{expanded && …}` (no la mide la sonda porque la fila no es un botón): tampoco anima. Si se pasa a `Collapse`, conviene hacerlo en `src/ui/Table.tsx` para todas las tablas.
- **Truncados con lugar a 1024 y 1440**: columna Dispositivo (`span.dv-cell2 > span.ui-trunc.dv-muted`, "Lenovo · Chromebook C340-11" faltan 73 px con 336 libres en la fila; "Samsung · XE500C12"), Prestado a ("Planificación móvil · 12/5 09:43" faltan 61 px, sobran 249) y Estado ("Fuera de servicio" a 1024, faltan 23, sobran 371). Las columnas fijas dejan espacio sin usar en otras. Con el asistente abierto a 1440 (el menú ya pasa a rail) siguen cortándose esas celdas.

##### Página de un equipo — `/sede/NFPT/devices/<etiqueta>`
- **Secciones con franja vacía al pie** (`div.dv-detail-grid > section.dv-sec`): "Datos", "Estado y cuidado" y "Tickets relacionados" quedan estiradas por la columna de al lado (de ~50 a ~840 px vacíos según los datos, a 1024 y 1440).
- **"+ Agregar"** (sin `aria-controls`): al cerrar, el disparador se mueve ~200 px y el contenido cambia de golpe (1440 y 390).
- **"Abrir calendario"** (selector de fecha): abre y cierra de golpe (~370 px a 390).

##### Historial — `/sede/NFPT/history`
- **"Ver el resumen de <equipo>"**: el resumen en línea abre y cierra de golpe (97 px a 1440, 224 a 390) y el botón no tiene `aria-controls`.
- **Encabezado "Curso / ubicación"** (`div.hs-row.hs-colh > span.hs-ell`) cortado a 1024 (faltan 4 px con 422 libres en la fila).

##### Inventario TIC — `/sede/NFPT/inventory`
- **Revisar condición** (cierra de golpe, ~390/610 px, sin `aria-controls`), **Importar / exportar** (`ivt-ie`), **Ocultos** (`ivt-hidden`), **Agregar recurso** (sin `aria-controls`, ~540/1120 px) y el selector de **Categoría** a 390 (`ivt-tree`): todos abren y cierran de golpe.

#### Frente Gestión (Agenda, Horarios, Aulas, Recordatorios, Tareas, Tickets, Sugerencias)

##### Agenda TIC — `/sede/NFPT/agenda`
- **Nueva actividad** (655 px a 1440, 1467 a 390), **Sincronizar** (cierra de golpe), **Filtros** (390) y cada **"Ver detalle: …"** de la lista (~470 px a 390): de golpe y sin `aria-controls`. A 1440 los "Ver detalle" ya no saltan pero siguen sin `aria-controls`.

##### Horarios — `/sede/NFPT/schedules`
- **Agregar horario**: abre y cierra de golpe (486 px a 1440, 855 a 390), sin `aria-controls`.

##### Estado aulas — `/sede/NFPT/classrooms`
- **Categorías de equipamiento**: sin `aria-controls` (la transición está bien).

##### Recordatorios — `/sede/NFPT/reminders`
- **Nuevo recordatorio**, **Posponer** y **Editar**: sin `aria-controls` (sin saltos).

##### Tareas TIC — `/sede/NFPT/tasks`
- **"Editar la columna «…»"**: el editor de columna abre y cierra de golpe (120–280 px) y no tiene `aria-controls`.
- **"Crear: tarea o columna"**: al cerrar, el disparador se corre 5 px; sin `aria-controls`.

##### Tickets — `/sede/NFPT/tickets` y `/sede/NFPT/tickets/<id>`
- **Panel de detalle vacío** (`div.tkx-wrap.no-pane > section.tkx-pane`, "Elegí un ticket de la lista"): una línea suelta con 69–78 px vacíos arriba en una tarjeta alta, a 1024 y 1440. Pide un vacío diseñado (`EmptyState compact` con ícono) o compactar el panel.
- En la página de un ticket, el selector **"Elegí un ticket…"** abre y cierra de golpe (~174 px) y al cerrar el disparador se corre lo mismo.

##### Sugerencias — `/sede/NFPT/suggestions`
- **Nueva sugerencia**, **Comentarios N** y **Estado**: sin `aria-controls`.

#### Frente Recursos y Configuración (Conocimiento, Canvas, Analítica, Configuración, Herramientas, Accesos, Caja chica)

##### Analítica — `/sede/NFPT/analytics`
- **Tarjetas con franjas vacías** (grilla que estira la más corta): "Clases con más deterioro · tabla" (193 px a 1024), "Tareas · foto actual" (94 px a 1440), "Anillos finos · en el período" (84 px), "Evolución · por mes" (76 px), "Tendencia · por mes" (61 px), "Duración de los préstamos" (55 px), "Condición del parque" (83 px a 390), "Hora × día de la semana" (52 px a 1024).
- **Huecos entre bloques**: dentro de "Activos en estado regular o malo" entre la tabla y la nota (182 px a 1024); en el costado del mapa de calor entre la lista de franjas y "El martes es el día hábil más tranquilo" (114 px a 1440); en "Tareas por tipo" entre la tabla e "Ir a Tareas TIC" (84 px a 1440).
- Informativo: al scrollear, columnas y leyendas pasan por debajo del índice sticky (`nav.an-index`); no cuenta como tapado, pero conviene `scroll-margin-top` en las secciones a las que lleva el índice.

##### Caja chica — `/sede/NFPT/pettycash`
- **Registrar gasto** y **Solicitar compra** a 390: al abrir, el scroll para mostrar el formulario saca al botón de la vista, y al cerrar se corre 16 px. Los dos y **Editar fondo**, sin `aria-controls`.

##### Herramientas — `/sede/NFPT/tools`
- **Paso 2 "Generar e imprimir"** (`div.tl-steps-row > div.tl-step`): ~200 px vacíos al pie a 1024 y 1440 (la fila estira los pasos al alto del más alto).

##### Accesos rápidos — `/sede/NFPT/quickaccess`
- Dominio cortado a 390 (`span.qa-text > span.ui-trunc.qa-domain`, "tikno.sd.cloud.invgate.net": faltan 7 px, sobran 70 en la fila).
- **Nuevo acceso**: sin `aria-controls`.

##### Canvas — `/sede/NFPT/canvas`
- **Archivo**: sin `aria-controls`. El lienzo (`.cv-board`) se excluye de la sonda (el vacío es el contenido); conviene marcarlo con `data-ux-ignore` en el componente.

##### Configuración — `/sede/NFPT/settings/<panel>`
- **Roles**: abrir/cerrar un rol (`cfg-role-*`) cambia el alto de golpe al cerrar (82–175 px) y, a 1440, también al abrir "Consulta".
- **Usuarios**: "Nuevo usuario" y cada "Editar" sin `aria-controls`; a 1440 "Editar" abre/cierra de golpe (~170–230 px) y a 390 "Nuevo usuario" saca al botón de la vista al abrir.
- **Sedes**: "Crear sede" (cierra de golpe, ~380 px), "Editar" (abre y cierra de golpe, ~300 px) y "Código admin": sin `aria-controls`.
- **Avanzado**: "Agregar clave" y "Editar": sin `aria-controls`.
- **Mail y SMTP**: hueco de 52 px entre "Servidor SMTP" y "Usuario" en la grilla a 1024.
- Cuenta, Apariencia, Notificaciones, Turnos, Módulos, Invitaciones, Préstamo, Vida útil y Sede: limpios. Base de conocimiento (lista y artículo) y la página de una tarea: limpias.
