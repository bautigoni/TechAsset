# TechAsset v1.4.0 — Tickets, bento, PWA, notificaciones y Google

¡Hola! Ya está disponible la versión **v1.4.0** de TechAsset. Acá te contamos todo lo nuevo.

## Tickets de InVgate integrados

Ahora cargás los tickets de InVgate directamente desde TechAsset: ponés el número y te arma solito el link a `techasset.bauhub.online`. También podés subir el PDF o la foto del ticket exportado y queda como previsualización inline. **Ojo: cargá solo el número, sin `#`** — si lo ponés, te rompe el link.

## Búsqueda por número de ticket

La sección Tickets ahora tiene un buscador arriba: filtrá por número, título, descripción, categoría o responsable. Combinado con el filtro por estado (No hecho / En proceso / Hecho), encontrás cualquier ticket en dos segundos.

## Analítica renovada (bento box)

Rediseñamos la pantalla de Analítica con un layout **bento** tipo japonés: KPI grandes arriba, gráfico ancho de evolución de préstamos en el medio, y un mosaico 2×2 con personas que más piden, tipos de equipo, ubicaciones y roles. Más legible, más lindo, mismo dato.

## Asignación flexible de tareas

Antes el `TaskModal` te obligaba a elegir un único responsable o a sumarte a vos mismo sí o sí. Ahora tenés un selector con **chips multi-select**: marcás uno o varios responsables, y si querés asignar la tarea a los dos asistentes sin que aparezca el jefe, podés. Las reglas de visibilidad respetan tu rol (jefe ve todo, asistente ve jefe + compañero + sí mismo).

## Configuración de sede con toggles lindos

La pantalla de Módulos se modernizó: cards con switch estilo iOS agrupadas por categoría (Operación, Análisis, Planificación, Aulas y soporte, Comunicaciones). Prendé o apagá secciones para tu sede sin romperle la cabeza a nadie. Los apagados desaparecen del menú para todos.

## PWA: instalá la app en tu celular

TechAsset ya se puede instalar como aplicación. Si entrás desde el celu, te aparece un banner abajo que dice **"Instalar app"**. Tocás, aceptás, y queda como icono en tu pantalla. Funciona offline para vistas cacheadas, y las notificaciones push se disparan aunque no tengas la app abierta (si están configuradas las VAPID keys).

## Notificaciones in-app + mail

Cada vez que alguien carga una tarea o un ticket en tu sede, te llega:

- Una notificación **in-app** (campana arriba a la derecha con badge rojo).
- Un **toast popup** en la esquina inferior derecha.
- Un **mail** si tenés rol de jefe o asistente.

Botón "Marcar todas como leídas" en la campana. La primera vez que entrás después de un release nuevo, te aparece el modal **"Qué hay de nuevo"** con esta misma lista.

## Login con Google

Sumamos un botón **"Continuar con Google"** en la pantalla de login. Si tu mail está autorizado en `allowed_users`, entrás con un click — sin tipear mail ni acordarte la dirección. El admin sigue siendo quien decide quién puede entrar: si tu mail de Google no está en la lista, te aparece un mensaje claro pidiéndote que contactes al equipo TIC.

## Bug fixes

- Link InVgate corregido a `techasset.bauhub.online` (antes quedaba mal en varios lados).
- Validación del número de ticket: si ponés `#`, lo limpiamos antes de armar el link.
- Preview de PDF de ticket más compacto: thumbnail en la card, "Ver PDF" como link en vez de un iframe gigante que rompía el layout.
- Carga de archivos en tickets: el botón "Subir PDF / foto" muestra progreso real y deshabilita otros botones mientras sube.

---

**¿Dudas o problemas?** Escribinos al equipo TIC de tu sede o respondé este mail.