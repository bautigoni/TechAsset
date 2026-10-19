# Barrido UX: hallazgos en pantallas de otros frentes

Medido con la suite `e2e/tests/ux.mjs` (sonda compartida `e2e/lib/ux-probe.mjs`, API en `e2e/README.md`) sobre la rama del frente de infraestructura, contra la copia de la base local. Cada vista del menú y cada página con URL se midió a **390, 1024 y 1440 px en oscuro y claro**; los colapsables (botones con `aria-expanded`) se abrieron y cerraron con el mouse y la animación real a **1440 oscuro** y **390 claro**. No se tocó ninguna de estas pantallas desde este frente.

Para reproducir: `npm run e2e -- --only=ux` (todo, ~4,5 min) o `--only="ux operacion"`, `--only="ux gestion"`, `--only="ux recursos"`, `--only="ux equipo"`… El detalle por ancho y tema queda en `e2e/.out/ux/report.json`, las capturas en `e2e/.out/ux/<vista>-<tema>-<ancho>.png` y esta misma lista, regenerada, en `e2e/.out/ux/hallazgos.md`. Con `--ux-strict` el barrido corta la corrida (para cuando cada frente deje su pantalla en cero).

Qué significa cada hallazgo:

- **De golpe**: al abrir o cerrar, el alto del contenido cambió más de 40 px de un frame al otro, sin valores intermedios: un `{open && …}` (o un reemplazo de bloque) donde REGLAS-UX pide `Collapse` / `anchored(...)`.
- **El disparador se movió N px**: el botón tocado se corrió en pantalla por un cambio de layout (no cuenta el scroll suave para mostrar lo que se abrió, mientras el botón siga a la vista). **Quedó fuera de la vista**: ese scroll lo sacó de pantalla.
- **Sin aria-controls**: el botón tiene `aria-expanded` pero no dice qué controla (`aria-controls` + `id` en lo que abre; con `Collapse` es el `id` del colapso).
- **Truncado con lugar**: texto con elipsis cortado mientras en su renglón sobra espacio para mostrarlo entero (se indica cuánto falta y cuánto sobra).
- **Franja vacía / hueco**: más de 48 px vacíos dentro de una tarjeta (al pie, arriba o en el medio) o entre dos bloques consecutivos.

## Frente Operación (Inicio, Préstamos, Dispositivos, Historial, Inventario)

### Inicio — `/sede/NFPT/dashboard`
- **Cierre del día** (botón de la cabecera): se cierra de golpe (~500 px a 1440, ~770 a 390) y no tiene `aria-controls`.
- **"Disponibles: N"** (`aria-controls=dash-types`): la lista por tipo abre de golpe (~320–450 px) y cierra de golpe (52–104 px), a 1440 y a 390.

### Préstamos — `/sede/NFPT/loans`
- **Cierre del día** (`aria-controls=lo-cierre`): `{closureOpen && <DailyClosureSection/>}` en `LoansPage.tsx`: se cierra de golpe (~510 px a 1440, ~770 a 390). La apertura entra con `ui-enter` pero el alto también llega de una.
- **Cámara**: tiene `aria-expanded` pero sin cámara (headless) no cambia ni da aviso; al tocarla a 390 el contenido salta 52 px. Sin `aria-controls`.

### Dispositivos — `/sede/NFPT/devices`
- **Importar CSV, Exportar, Grupos, Papelera, Añadir dispositivo**: los cinco paneles abren y cierran de golpe (`{panel === 'x' && …}` / `{creating && …}` en `DevicesPage.tsx`; 150–600 px a 1440, hasta 1350 a 390) y ninguno tiene `aria-controls`.
- **Ficha en línea de una fila**: la abre `Table` de `src/ui` con `{expanded && …}` (no la mide la sonda porque la fila no es un botón): tampoco anima. Si se pasa a `Collapse`, conviene hacerlo en `src/ui/Table.tsx` para todas las tablas.
- **Truncados con lugar a 1024 y 1440**: columna Dispositivo (`span.dv-cell2 > span.ui-trunc.dv-muted`, "Lenovo · Chromebook C340-11" faltan 73 px con 336 libres en la fila; "Samsung · XE500C12"), Prestado a ("Planificación móvil · 12/5 09:43" faltan 61 px, sobran 249) y Estado ("Fuera de servicio" a 1024, faltan 23, sobran 371). Las columnas fijas dejan espacio sin usar en otras. Con el asistente abierto a 1440 (el menú ya pasa a rail) siguen cortándose esas celdas.

### Página de un equipo — `/sede/NFPT/devices/<etiqueta>`
- **Secciones con franja vacía al pie** (`div.dv-detail-grid > section.dv-sec`): "Datos", "Estado y cuidado" y "Tickets relacionados" quedan estiradas por la columna de al lado (de ~50 a ~840 px vacíos según los datos, a 1024 y 1440).
- **"+ Agregar"** (sin `aria-controls`): al cerrar, el disparador se mueve ~200 px y el contenido cambia de golpe (1440 y 390).
- **"Abrir calendario"** (selector de fecha): abre y cierra de golpe (~370 px a 390).

### Historial — `/sede/NFPT/history`
- **"Ver el resumen de <equipo>"**: el resumen en línea abre y cierra de golpe (97 px a 1440, 224 a 390) y el botón no tiene `aria-controls`.
- **Encabezado "Curso / ubicación"** (`div.hs-row.hs-colh > span.hs-ell`) cortado a 1024 (faltan 4 px con 422 libres en la fila).

### Inventario TIC — `/sede/NFPT/inventory`
- **Revisar condición** (cierra de golpe, ~390/610 px, sin `aria-controls`), **Importar / exportar** (`ivt-ie`), **Ocultos** (`ivt-hidden`), **Agregar recurso** (sin `aria-controls`, ~540/1120 px) y el selector de **Categoría** a 390 (`ivt-tree`): todos abren y cierran de golpe.

## Frente Gestión (Agenda, Horarios, Aulas, Recordatorios, Tareas, Tickets, Sugerencias)

### Agenda TIC — `/sede/NFPT/agenda`
- **Nueva actividad** (655 px a 1440, 1467 a 390), **Sincronizar** (cierra de golpe), **Filtros** (390) y cada **"Ver detalle: …"** de la lista (~470 px a 390): de golpe y sin `aria-controls`. A 1440 los "Ver detalle" ya no saltan pero siguen sin `aria-controls`.

### Horarios — `/sede/NFPT/schedules`
- **Agregar horario**: abre y cierra de golpe (486 px a 1440, 855 a 390), sin `aria-controls`.

### Estado aulas — `/sede/NFPT/classrooms`
- **Categorías de equipamiento**: sin `aria-controls` (la transición está bien).

### Recordatorios — `/sede/NFPT/reminders`
- **Nuevo recordatorio**, **Posponer** y **Editar**: sin `aria-controls` (sin saltos).

### Tareas TIC — `/sede/NFPT/tasks`
- **"Editar la columna «…»"**: el editor de columna abre y cierra de golpe (120–280 px) y no tiene `aria-controls`.
- **"Crear: tarea o columna"**: al cerrar, el disparador se corre 5 px; sin `aria-controls`.

### Tickets — `/sede/NFPT/tickets` y `/sede/NFPT/tickets/<id>`
- **Panel de detalle vacío** (`div.tkx-wrap.no-pane > section.tkx-pane`, "Elegí un ticket de la lista"): una línea suelta con 69–78 px vacíos arriba en una tarjeta alta, a 1024 y 1440. Pide un vacío diseñado (`EmptyState compact` con ícono) o compactar el panel.
- En la página de un ticket, el selector **"Elegí un ticket…"** abre y cierra de golpe (~174 px) y al cerrar el disparador se corre lo mismo.

### Sugerencias — `/sede/NFPT/suggestions`
- **Nueva sugerencia**, **Comentarios N** y **Estado**: sin `aria-controls`.

## Frente Recursos y Configuración (Conocimiento, Canvas, Analítica, Configuración, Herramientas, Accesos, Caja chica)

### Analítica — `/sede/NFPT/analytics`
- **Tarjetas con franjas vacías** (grilla que estira la más corta): "Clases con más deterioro · tabla" (193 px a 1024), "Tareas · foto actual" (94 px a 1440), "Anillos finos · en el período" (84 px), "Evolución · por mes" (76 px), "Tendencia · por mes" (61 px), "Duración de los préstamos" (55 px), "Condición del parque" (83 px a 390), "Hora × día de la semana" (52 px a 1024).
- **Huecos entre bloques**: dentro de "Activos en estado regular o malo" entre la tabla y la nota (182 px a 1024); en el costado del mapa de calor entre la lista de franjas y "El martes es el día hábil más tranquilo" (114 px a 1440); en "Tareas por tipo" entre la tabla e "Ir a Tareas TIC" (84 px a 1440).
- Informativo: al scrollear, columnas y leyendas pasan por debajo del índice sticky (`nav.an-index`); no cuenta como tapado, pero conviene `scroll-margin-top` en las secciones a las que lleva el índice.

### Caja chica — `/sede/NFPT/pettycash`
- **Registrar gasto** y **Solicitar compra** a 390: al abrir, el scroll para mostrar el formulario saca al botón de la vista, y al cerrar se corre 16 px. Los dos y **Editar fondo**, sin `aria-controls`.

### Herramientas — `/sede/NFPT/tools`
- **Paso 2 "Generar e imprimir"** (`div.tl-steps-row > div.tl-step`): ~200 px vacíos al pie a 1024 y 1440 (la fila estira los pasos al alto del más alto).

### Accesos rápidos — `/sede/NFPT/quickaccess`
- Dominio cortado a 390 (`span.qa-text > span.ui-trunc.qa-domain`, "tikno.sd.cloud.invgate.net": faltan 7 px, sobran 70 en la fila).
- **Nuevo acceso**: sin `aria-controls`.

### Canvas — `/sede/NFPT/canvas`
- **Archivo**: sin `aria-controls`. El lienzo (`.cv-board`) se excluye de la sonda (el vacío es el contenido); conviene marcarlo con `data-ux-ignore` en el componente.

### Configuración — `/sede/NFPT/settings/<panel>`
- **Roles**: abrir/cerrar un rol (`cfg-role-*`) cambia el alto de golpe al cerrar (82–175 px) y, a 1440, también al abrir "Consulta".
- **Usuarios**: "Nuevo usuario" y cada "Editar" sin `aria-controls`; a 1440 "Editar" abre/cierra de golpe (~170–230 px) y a 390 "Nuevo usuario" saca al botón de la vista al abrir.
- **Sedes**: "Crear sede" (cierra de golpe, ~380 px), "Editar" (abre y cierra de golpe, ~300 px) y "Código admin": sin `aria-controls`.
- **Avanzado**: "Agregar clave" y "Editar": sin `aria-controls`.
- **Mail y SMTP**: hueco de 52 px entre "Servidor SMTP" y "Usuario" en la grilla a 1024.
- Cuenta, Apariencia, Notificaciones, Turnos, Módulos, Invitaciones, Préstamo, Vida útil y Sede: limpios. Base de conocimiento (lista y artículo) y la página de una tarea: limpias.
