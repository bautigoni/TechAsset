// Medición de layout que corre ADENTRO de la página (se pasa a page.evaluate).
// Reglas de PLAN §7.4 y CLAUDE.md: sin scroll horizontal de la página, sin
// barras de scroll visibles, ningún botón partido en varias líneas, nada que se
// pise con un hermano. Devuelve conteos y una muestra de cada problema.
export function layoutProbe(maxSamples = 15) {
  const doc = document.documentElement;
  const describe = element => {
    const tag = element.tagName.toLowerCase();
    const id = element.id ? `#${element.id}` : '';
    const classes = typeof element.className === 'string'
      ? element.className.trim().split(/\s+/).filter(Boolean).slice(0, 3).map(name => `.${name}`).join('')
      : '';
    const label = (element.getAttribute('aria-label') || element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    return `${tag}${id}${classes}${label ? ` "${label}"` : ''}`;
  };
  const visible = element => element.checkVisibility
    ? element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
    : element.getClientRects().length > 0;

  const result = {
    viewport: { width: window.innerWidth, height: window.innerHeight },
    scrollWidth: doc.scrollWidth,
    clientWidth: doc.clientWidth,
    horizontalScroll: doc.scrollWidth > doc.clientWidth,
    // Barra del documento: se cuenta aparte (es la de la página, no de un contenedor).
    pageScrollbar: window.innerWidth - doc.clientWidth > 0 || (window.innerHeight - doc.clientHeight > 0 && doc.scrollWidth > doc.clientWidth),
    scrollbars: [],
    wrappedButtons: [],
    overlaps: []
  };

  // 1. Barras de scroll visibles en contenedores (la del documento va en pageScrollbar).
  const all = document.body.querySelectorAll('*');
  for (const element of all) {
    if (element === document.body) continue;
    const style = getComputedStyle(element);
    const oy = style.overflowY;
    const ox = style.overflowX;
    const scrollY = oy === 'scroll' || oy === 'auto';
    const scrollX = ox === 'scroll' || ox === 'auto';
    if (!scrollY && !scrollX) continue;
    const borderX = parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth);
    const borderY = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
    const vbar = scrollY && element.offsetWidth - element.clientWidth - borderX > 0.5 && (oy === 'scroll' || element.scrollHeight > element.clientHeight);
    const hbar = scrollX && element.offsetHeight - element.clientHeight - borderY > 0.5 && (ox === 'scroll' || element.scrollWidth > element.clientWidth);
    if ((vbar || hbar) && visible(element)) result.scrollbars.push(`${describe(element)} (${[vbar && 'vertical', hbar && 'horizontal'].filter(Boolean).join('+')})`);
  }

  // 2. Botones con el texto partido: algún nodo de texto ocupa más de una línea.
  const range = document.createRange();
  for (const button of document.querySelectorAll('button, a.btn, a.button')) {
    if (!visible(button)) continue;
    const walker = document.createTreeWalker(button, NodeFilter.SHOW_TEXT);
    let wrapped = false;
    for (let node = walker.nextNode(); node && !wrapped; node = walker.nextNode()) {
      if (!node.textContent.trim()) continue;
      range.selectNodeContents(node);
      const tops = [];
      for (const rect of range.getClientRects()) {
        if (rect.width < 1 || rect.height < 1) continue;
        if (!tops.some(top => Math.abs(top - rect.top) < rect.height / 2)) tops.push(rect.top);
      }
      if (tops.length > 1) wrapped = true;
    }
    if (wrapped) result.wrappedButtons.push(describe(button));
  }

  // 3. Hermanos que se pisan: elementos visibles con texto o controles, mismo
  //    padre, intersección de más de 2 px en los dos ejes.
  const CONTROL = /^(button|a|input|select|textarea|label|img|video)$/i;
  const parents = new Map();
  for (const element of all) {
    const parent = element.parentElement;
    if (!parent || element.closest('svg') || element.closest('[aria-hidden="true"]')) continue;
    const isControl = CONTROL.test(element.tagName) || element.getAttribute('role') === 'button';
    if (!isControl && !(element.textContent || '').trim()) continue;
    if (!visible(element)) continue;
    // Controles inertes (p. ej. satélites de un menú cerrado, apilados debajo del botón): no se ven ni se tocan.
    if (isControl && getComputedStyle(element).pointerEvents === 'none') continue;
    const rect = element.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) continue;
    if (!parents.has(parent)) parents.set(parent, []);
    parents.get(parent).push({ element, rect });
  }
  for (const children of parents.values()) {
    if (children.length < 2) continue;
    children.sort((a, b) => a.rect.top - b.rect.top);
    for (let i = 0; i < children.length; i += 1) {
      const a = children[i];
      for (let j = i + 1; j < children.length; j += 1) {
        const b = children[j];
        if (b.rect.top >= a.rect.bottom - 2) break;
        const x = Math.min(a.rect.right, b.rect.right) - Math.max(a.rect.left, b.rect.left);
        const y = Math.min(a.rect.bottom, b.rect.bottom) - Math.max(a.rect.top, b.rect.top);
        if (x > 2 && y > 2) result.overlaps.push(`${describe(a.element)} ⟂ ${describe(b.element)}`);
      }
    }
  }

  const counts = {
    horizontalScroll: result.horizontalScroll ? 1 : 0,
    pageScrollbar: result.pageScrollbar ? 1 : 0,
    scrollbars: result.scrollbars.length,
    wrappedButtons: result.wrappedButtons.length,
    overlaps: result.overlaps.length
  };
  return {
    ...result,
    counts,
    scrollbars: result.scrollbars.slice(0, maxSamples),
    wrappedButtons: result.wrappedButtons.slice(0, maxSamples),
    overlaps: result.overlaps.slice(0, maxSamples)
  };
}
