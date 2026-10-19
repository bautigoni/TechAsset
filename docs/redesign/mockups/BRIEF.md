# Brief de rediseño TechAsset — lenguaje "Grafito"

TechAsset es la app interna del equipo TIC de un colegio (sedes NFPT "Northfield Puertos" y NFND "Northfield Nordelta"): préstamos de equipos (Chromebooks "Touch", notebooks "TIC", "Plani", Dell, cartelitos), inventario, agenda TIC, tareas, tickets, estado de aulas, analítica. Usuarios: 2-3 asistentes TIC y el Jefe TIC. Español rioplatense ("vos", "prestá", "revisá"). El repo está en C:\Users\Usuario\Downloads\techasset (React en src/components/...). Podés LEER el código de la sección que te toca para saber qué datos y acciones reales tiene; no inventes features que no existen salvo como mejora clara y sobria.

El dueño dice que la app actual (fondo azul marino, cards con borde azul brillante, botones gigantes, todo apilado) "es horrenda", "no se entiende nada cuando scrolleás" y que el menú de la izquierda no le gusta. Queremos que se sienta DISTINTA: más sobria, más densa en información útil, jerarquía clara.

## Lenguaje visual (obligatorio, igual en todos los artboards)

- Tipografía: **Geist** (UI) y **Geist Mono** (números, etiquetas de equipo tipo D1436, horas). En `<helmet>`:
  `<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500&display=swap" rel="stylesheet">`
  Números siempre `font-variant-numeric: tabular-nums`.
- Escala: 12 / 13 / 14 (cuerpo) / 16 / 20 (título de sección) / 28 (título de página) / 40 (KPI héroe). Títulos 600, cuerpo 400, labels 500.
- Colores (fondo oscuro grafito, NO azul marino):
  - fondo `#0D0F12`, superficie (cards) `#14171B`, elevada (hover, inputs, popovers) `#1B1F24`
  - línea `#262B32`, línea fuerte `#353B44`
  - texto `#ECEEF1`, texto 2 `#A7AEB8`, texto 3 `#7C8592` (mínimo para texto, nada más apagado)
  - acento **lima `#C8F25A`**, con mucha moderación: item activo del menú (barrita + texto), botón primario (texto `#0D0F12` sobre lima), foco, la serie principal de un gráfico. Nunca fondos grandes de lima.
  - series de datos: `#C8F25A` lima, `#6CA8FF` azul, `#FF9F5A` naranja, `#B79CFF` violeta, `#5ED3C4` teal; serie "resto/otros" `#3A414B`.
  - estados: ok `#5BD68A`, atención `#F5C04E`, mal `#FF6B6B`, info `#6CA8FF`. Siempre acompañados de texto/ícono, nunca solo color.
  - condición de equipos: Excelente `#5BD68A`, Bueno `#6CA8FF`, Regular `#F5C04E`, Malo `#FF6B6B`, Sin revisar `#3A414B`.
- Formas: radio 6px (botones, inputs, chips), 10px (cards), 999px solo en badges de estado. Bordes de 1px `#262B32`. SIN glows, SIN gradientes, SIN sombras (salvo una sombra suave en popovers/menús flotantes), SIN cards con borde izquierdo de color, SIN emojis.
- Espaciado base 4: 8 / 12 / 16 / 24 / 32 / 48. Filas de tabla 40px. Botones 36px alto (44px en mobile). Íconos: SVG inline de trazo 1.5px, 16-18px, estilo lucide (`fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"`), `aria-hidden="true"`.
- Encabezado de sección: eyebrow en Geist Mono 11px mayúsculas `#7C8592` con letter-spacing .08em + título 20px 600.
- Botón primario: lima con texto oscuro. Secundario: fondo `#1B1F24`, borde `#353B44`, texto `#ECEEF1`. Ghost: solo texto `#A7AEB8`.
- Shell de la app (para artboards de pantalla completa): menú lateral de 232px a la izquierda + topbar de 56px. Menú base (los artboards de sección usan este, salvo los de "Menú" que lo exploran):
  - Arriba: selector de sede (cuadradito "NF" + "Northfield Puertos" + "NFPT" en mono + chevron), debajo un buscador "Buscar o ir a…  Ctrl K".
  - Grupos con label chico: **Operación**: Inicio, Préstamos, Dispositivos, Agenda TIC, Estado aulas · **Gestión**: Tareas TIC, Tickets, Recordatorios, Historial · **Inventario y datos**: Inventario TIC, Analítica, Caja chica · **Recursos**: Base de conocimiento, Herramientas, Accesos rápidos.
  - Abajo: Configuración y el usuario (avatar "BG", "Bauti G.", "Jefe TIC").
  - Item: 32px alto, ícono 16px + label 14px `#A7AEB8`; activo: texto `#ECEEF1`, fondo `#1B1F24`, barrita lima de 2px a la izquierda DENTRO del item (no borde de card). Contadores (ej. préstamos activos) en mono 12px a la derecha.
  - Topbar: breadcrumb/título a la izquierda; a la derecha botón "Nuevo préstamo" (primario), campana con contador, ayuda. Nada de pills gigantes.

## Datos reales

Usá datos reales, NO inventes estadísticas. Fuente: `C:\Users\Usuario\AppData\Local\Temp\claude\C--Users-Usuario-Downloads-techasset\28d4eb43-9ca6-445e-8c97-66e1be73520e\scratchpad\analytics-data.json` (respuesta de /api/analytics del último año y /api/analytics/parque de una copia local de la base). Además, de producción (captura del dueño, sede NFPT): 1019 préstamos en el último año; parque 142 activos: Excelente 48, Bueno 4, Regular 22, Malo 12, Sin revisar 56; equipos regular/malo 32; recursos regular/malo 2; vida útil vencida 0; a renovar en 12 meses 0; bajo stock 16; revisado 61%; renovaciones por año 2030: 69, 2031: 17. Para KPIs de préstamos usá los de producción cuando existan; para desgloses (por hora, día, curso, ubicación, motivo, equipo) usá la forma del JSON.
Personas: mostralas como nombre + inicial ("Alex C.", "Máximo M."), nunca nombres completos. Si necesitás un dato que no está, usá un placeholder visible tipo `[N]` en vez de inventarlo.

## Formato de archivo (.dc.html) — reglas que fallan en silencio

Cada artboard es UN archivo completo así:

```html
<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>Analítica — Resumen</title>
<script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
body{margin:0;background:#0D0F12}
a{color:#C8F25A}a:hover{color:#E2FF9A}
</style>
</helmet>
<div style="min-height: 1100px; background: #0D0F12; color: #ECEEF1; font-family: Geist, system-ui, sans-serif; display: flex; ...">
  ...
</div>
</x-dc>
<script type="text/x-dc" data-dc-script data-props='{"$preview":{"width":1440,"height":1100}}'>
class Component extends DCLogic {
renderVals() {
return {};
}
}
</script>
</body>
</html>
```

- La línea `<script src="./support.js"></script>` del head va EXACTA. Cerrá todo elemento no-void y poné comillas en todos los atributos.
- Estilos: INLINE `style="…"` en cada elemento (eso es lo que el editor edita). `<helmet><style>` solo para `body`, `a`, `a:hover` y como mucho reglas de hover/focus sencillas.
- Layout con flex o grid + `gap`. Grids: `display: grid; grid-template-columns: repeat(N, minmax(0, 1fr))`. Root fluido: sin ancho fijo en px (usá `width: 100%` / `max-width`), alturas en px. `$preview` = el tamaño del frame que te asigné.
- `{{hueco}}` es solo un lookup con puntos a lo que devuelve `renderVals()`, nunca una expresión. Repeticiones con `<sc-for list="{{rows}}" as="r" hint-placeholder-count="5">…{{r.label}}…</sc-for>`; condicionales `<sc-if value="{{x}}" hint-placeholder-val="{{ true }}">`. Valores calculados (anchos de barras como `"width: 62%"` → precalculá un string `style` por item en renderVals y usalo con `style="{{r.barStyle}}"` — permitido para datos). Texto fijo: escribilo literal en el markup, no como prop.
- Script: JS clásico, `class Component extends DCLogic`, sin imports. Todo UI es markup `<x-dc>`, nunca generado con innerHTML/appendChild.
- `data-props`: solo `$preview` y como mucho 1-2 tweaks útiles (ej. `{"density":{"editor":"enum","options":["cómoda","compacta"],"default":"cómoda"}}`). Escapar `&` como `&amp;` y `'` como `&#39;` dentro del atributo.
- Interactividad liviana permitida (tabs, filtros de período, colapsar secciones) con `state`/`setState` y `onClick="{{ fn }}"` en `<button>` reales. Si hacés eso, avisame para marcar el artboard como interactivo.
- Gráficos: dibujalos con divs (barras) o `<svg>` inline con `role="img" aria-label="…"`. Líneas: precalculá el atributo `points`/`d` en renderVals. Sin librerías, sin red (solo la fuente de Google).
- Accesible: `<button>`, `<a href>`, `<input>`+`<label>` reales; `aria-label` en botones de solo ícono; contraste ≥4.5:1 (texto 3 `#7C8592` es el mínimo sobre `#14171B`).
- Nada de texto relleno, lorem ipsum ni features que el sistema no tiene presentadas como reales.
- NO rendereés, NO abras navegador, NO verifiques con screenshots, NO publiques nada: solo escribí los archivos con tu herramienta de escritura (Write), uno por artboard, en la ruta exacta que te indico. Mi parte es publicarlos.

## Al terminar

Respondé con: la lista de archivos escritos, para cada uno su altura real a 1440px de ancho (si se pasó de la asignada, decímela para agrandar el frame), si es interactivo, y 1-2 líneas del concepto de cada uno (qué problema resuelve). Nada más.
