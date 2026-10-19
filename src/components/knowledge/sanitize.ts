/**
 * Sanitizado del HTML de los artículos con lista blanca (el server además
 * quita script/style/iframe/object/embed/form, `on*=` y `javascript:`).
 *
 * Se parsea en un documento inerte (DOMParser: no corre scripts) y se arma uno
 * nuevo solo con etiquetas y atributos permitidos. Sirve para tres cosas:
 * mostrar el artículo con la tipografía de la app (antes iba en un iframe
 * blanco), limpiar lo que se pega desde Docs/Word y limpiar al guardar.
 */
const KEEP = new Set(['P', 'BR', 'H2', 'H3', 'STRONG', 'EM', 'U', 'S', 'UL', 'OL', 'LI', 'A', 'BLOCKQUOTE', 'PRE', 'CODE', 'IMG', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TD', 'TH', 'HR']);
const RENAME: Record<string, string> = { B: 'STRONG', I: 'EM', H1: 'H2', H4: 'H3', H5: 'H3', H6: 'H3', DIV: 'P', STRIKE: 'S', DEL: 'S', INS: 'U' };
const DROP = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'FORM', 'INPUT', 'BUTTON', 'TEXTAREA', 'SELECT', 'OPTION', 'META', 'LINK', 'BASE', 'TITLE', 'HEAD', 'SVG', 'MATH', 'TEMPLATE', 'NOSCRIPT', 'VIDEO', 'AUDIO', 'CANVAS', 'FRAME', 'FRAMESET']);
const BLOCKS = new Set(['P', 'H2', 'H3', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'PRE', 'TABLE', 'HR']);
const SAFE_HREF = /^(https?:|mailto:|tel:|\/(?!\/))/i;
const SAFE_SRC = /^(https?:|\/(?!\/)|data:image\/(png|jpe?g|webp|gif);base64,)/i;

function styleFlags(element: Element) {
  const style = (element.getAttribute('style') || '').toLowerCase().replace(/\s+/g, '');
  const weight = style.match(/font-weight:(\w+)/)?.[1];
  return {
    bold: weight === 'bold' || weight === 'bolder' || Number(weight) >= 600,
    notBold: weight === 'normal' || weight === 'lighter' || (Number(weight) > 0 && Number(weight) < 600),
    italic: /font-style:italic/.test(style)
  };
}

function copyChildren(source: Node, target: Node, doc: Document) {
  source.childNodes.forEach(child => copyNode(child, target, doc));
}

function copyNode(node: Node, parent: Node, doc: Document) {
  if (node.nodeType === Node.TEXT_NODE) {
    parent.appendChild(doc.createTextNode(node.textContent || ''));
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return;
  const element = node as Element;
  const tag = element.tagName.toUpperCase();
  if (DROP.has(tag)) return;
  const flags = styleFlags(element);
  let name = RENAME[tag] || tag;
  // Google Docs envuelve todo en <b style="font-weight:normal">: eso no es negrita.
  if ((name === 'STRONG' && flags.notBold) || !KEEP.has(name)) {
    if (tag === 'SPAN' && (flags.bold || flags.italic)) {
      let target: Node = parent;
      if (flags.bold) target = target.appendChild(doc.createElement('strong'));
      if (flags.italic) target = target.appendChild(doc.createElement('em'));
      copyChildren(element, target, doc);
      return;
    }
    copyChildren(element, parent, doc);
    if (BLOCKS.has(RENAME[tag] || tag) || tag === 'DIV') parent.appendChild(doc.createElement('br'));
    return;
  }
  // Un <p> o <div> dentro de un <li> o de otro bloque: se aplana.
  if (name === 'P' && parent.nodeType === Node.ELEMENT_NODE && ['LI', 'P', 'H2', 'H3', 'TD', 'TH', 'BLOCKQUOTE'].includes((parent as Element).tagName)) {
    copyChildren(element, parent, doc);
    return;
  }
  const out = doc.createElement(name.toLowerCase());
  if (name === 'A') {
    const href = (element.getAttribute('href') || '').trim();
    if (SAFE_HREF.test(href)) {
      out.setAttribute('href', href);
      out.setAttribute('target', '_blank');
      out.setAttribute('rel', 'noopener noreferrer');
    }
  } else if (name === 'IMG') {
    const src = (element.getAttribute('src') || '').trim();
    if (!SAFE_SRC.test(src)) return;
    out.setAttribute('src', src);
    out.setAttribute('alt', (element.getAttribute('alt') || '').slice(0, 200));
    out.setAttribute('loading', 'lazy');
  } else if (name === 'TD' || name === 'TH') {
    for (const attr of ['colspan', 'rowspan']) {
      const value = Number(element.getAttribute(attr));
      if (value > 1 && value < 50) out.setAttribute(attr, String(value));
    }
  }
  copyChildren(element, out, doc);
  if (name === 'STRONG' && flags.italic) {
    const em = doc.createElement('em');
    while (out.firstChild) em.appendChild(out.firstChild);
    out.appendChild(em);
  }
  parent.appendChild(out);
}

/** HTML limpio (lista blanca). Vacío si no hay nada que mostrar. */
export function sanitizeArticleHtml(html: string): string {
  if (!html) return '';
  const doc = new DOMParser().parseFromString(`<!doctype html><body>${html}</body>`, 'text/html');
  const out = doc.createElement('div');
  copyChildren(doc.body, out, doc);
  // Sin <br> sueltos al principio o al final ni párrafos vacíos.
  out.querySelectorAll('p').forEach(p => { if (!p.textContent?.trim() && !p.querySelector('img,br')) p.remove(); });
  while (out.firstChild && out.firstChild.nodeName === 'BR') out.firstChild.remove();
  while (out.lastChild && out.lastChild.nodeName === 'BR') out.lastChild.remove();
  return out.innerHTML.trim();
}

/** ¿El HTML tiene contenido visible (texto o imagen)? */
export function hasArticleContent(html: string) {
  if (!html) return false;
  const doc = new DOMParser().parseFromString(`<!doctype html><body>${html}</body>`, 'text/html');
  return Boolean(doc.body.textContent?.replace(/ /g, ' ').trim() || doc.body.querySelector('img'));
}
