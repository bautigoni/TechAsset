# Inventario funcional: cómo documentar cada pantalla

Este relevamiento es la red de seguridad del rediseño: todo lo que figure acá tiene que seguir funcionando después de migrar. Ante la duda, anotalo. Una funcionalidad chica que no se documenta es una funcionalidad que se pierde.

Fuente de verdad: el código (no lo que dice un README). Citá archivo:línea para cada cosa no obvia.

## Formato por pantalla / componente

### <Nombre de la pantalla> (`ruta/al/Componente.tsx`)

**Para qué sirve:** una línea.
**Quién la ve:** roles, módulo de sede (`canEditModule`/módulos que se prenden en Configuración), `consultationMode` (qué se bloquea), superadmin.
**Datos:** endpoints que llama (método + ruta), polling/intervalos, caché (`apiGet`/`NO_CACHE`), eventos globales que escucha o dispara.

**Controles** (tabla, uno por fila, TODOS: botones, links, íconos, filas clickeables, chips, toggles, tabs, filtros, buscadores, inputs, menús contextuales):

| Control | Dónde | Qué hace exactamente | Condiciones (permiso, estado, disabled) |
|---|---|---|---|

**Micro-interacciones y atajos** (lo más fácil de perder; buscá a conciencia `onKeyDown`, `ctrlKey`, `metaKey`, `shiftKey`, `altKey`, `onDoubleClick`, `onContextMenu`, `draggable`/`onDrag*`, `onPaste`, `onWheel`, long-press, `autoFocus`, Enter de scanner USB, Escape, foco, selección de texto, `title`/tooltips, copiar al portapapeles, scroll automático, recordar la última opción, `localStorage`/`sessionStorage`):
- …

**Estados:** loading (skeleton/spinner), vacío, error, éxito (toasts), deshacer, confirmaciones (`confirmDialog`/`promptDialog`), optimistic updates.

**Controles nativos o fuera de sistema a reemplazar:** `<select>`, `<input type="date|time|datetime-local|month|week|color|file|range|number">`, checkbox/radio nativos sin estilo, `<dialog>`, `window.confirm/prompt/alert`, `<details>`, tooltips `title=`, scrollbars, etc. Indicá archivo:línea.

**Mobile:** qué cambia en pantallas chicas.

**Riesgos para el rediseño:** lo que se rompe fácil si se reescribe el markup (refs, medidas, `ResizeObserver`, clases que usa JS o CSS de otro lado, IDs que usa el SVG, orden de rutas, etc.).

## Al final del archivo

- **Lista de verificación:** checklist plano (`- [ ] …`) con cada funcionalidad, para tildar a mano después de migrar esa pantalla.
- **Ideas de mejora** que notaste (separadas, opcionales, sin mezclarlas con lo existente).
