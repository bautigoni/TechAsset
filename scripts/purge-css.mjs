// Purga del CSS heredado (etapas 2 y 9 del rediseño).
//
//   node scripts/purge-css.mjs                 # informa qué sacaría
//   node scripts/purge-css.mjs --write         # lo saca
//   node scripts/purge-css.mjs --files=components,motion
//
// Saca de los archivos viejos de src/styles/ (components, layout, responsive,
// nav-smart, motion, global):
//   1. los selectores que EXIGEN una clase que no aparece en ningún fuente
//      (src, server, public: strings, templates, JSX e identificadores; los
//      comentarios no cuentan). Lo de adentro de :not()/:is()/:where()/:has()
//      no se toma como requisito. Prefijos dinámicos (`tone-${x}`) se respetan;
//   2. los @keyframes que nadie anima (ni el CSS de src ni el código);
//   3. las declaraciones pisadas por la MISMA regla más abajo (mismo selector,
//      mismo contexto de @media/@supports, y la de abajo gana siempre);
//   4. las reglas y @media que quedan vacías.
// Después: `npm run build` y `node scripts/css-diff.mjs --before=<css viejo>`
// para probar que no cambió ningún estilo computado.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'package.json'));
const ts = require('typescript');
const postcss = require('postcss');
const args = process.argv.slice(2);
const write = args.includes('--write');
const filesArg = args.find(arg => arg.startsWith('--files='));
const TARGETS = (filesArg ? filesArg.slice(8).split(',') : ['components', 'layout', 'responsive', 'nav-smart', 'motion', 'global'])
  .map(name => path.join(root, 'src', 'styles', name.endsWith('.css') ? name : `${name}.css`))
  .filter(file => fs.existsSync(file));

// ── 1. Lo que nombran los fuentes ─────────────────────────────────────────
const words = new Set();
const prefixes = new Set();
const addText = (text, { tail = false } = {}) => {
  for (const match of String(text).matchAll(/-?[A-Za-z_][\w-]*/g)) words.add(match[0]);
  // "foo-" pegado al final de un pedazo (sigue una interpolación o un +): prefijo de clase dinámica.
  const end = String(text).match(/([A-Za-z_][\w-]*[-_])$/);
  if (end && !tail) prefixes.add(end[1]);
};

function walk(dir, exts, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'dist', 'transitions'].includes(entry.name) || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, exts, out);
    else if (exts.test(entry.name)) out.push(full);
  }
  return out;
}

const codeFiles = [
  ...walk(path.join(root, 'src'), /\.(tsx?|jsx?|mjs)$/),
  ...walk(path.join(root, 'server'), /\.(m?js|cjs)$/),
  ...walk(path.join(root, 'public'), /\.js$/)
];
for (const file of codeFiles) {
  const text = fs.readFileSync(file, 'utf8');
  const kind = /\.(tsx|jsx)$/.test(file) ? ts.ScriptKind.TSX : /\.ts$/.test(file) ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  const visit = node => {
    switch (node.kind) {
      case ts.SyntaxKind.StringLiteral:
      case ts.SyntaxKind.NoSubstitutionTemplateLiteral:
      case ts.SyntaxKind.TemplateHead:
      case ts.SyntaxKind.TemplateMiddle:
      case ts.SyntaxKind.JsxText:
        addText(node.text); break;
      case ts.SyntaxKind.TemplateTail: addText(node.text, { tail: true }); break;
      case ts.SyntaxKind.Identifier:
      case ts.SyntaxKind.PrivateIdentifier: words.add(node.text); break;
      default: break;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}
for (const file of [path.join(root, 'index.html'), ...walk(path.join(root, 'public'), /\.html$/)]) {
  if (fs.existsSync(file)) addText(fs.readFileSync(file, 'utf8').replace(/<!--[\s\S]*?-->/g, ''));
}
// 'link-' solo arma ids (`link-${id}`), no clases.
const classUsed = name => words.has(name) || [...prefixes].some(prefix => prefix.length >= 2 && prefix !== 'link-' && name.startsWith(prefix));

const animationNames = new Set();
for (const file of walk(path.join(root, 'src'), /\.css$/)) {
  postcss.parse(fs.readFileSync(file, 'utf8'), { from: file }).walkDecls(/^animation(-name)?$/i, decl => {
    for (const match of decl.value.matchAll(/[A-Za-z_][\w-]*/g)) animationNames.add(match[0]);
  });
}

// ── 2. Purga ──────────────────────────────────────────────────────────────
function requiredClasses(selector) {
  let s = selector.replace(/\[[^\]]*\]/g, '[]').replace(/(["'])(?:\\.|(?!\1).)*\1/g, '""');
  let previous;
  do { previous = s; s = s.replace(/:[\w-]+\((?:[^()]|\([^()]*\))*\)/g, ''); } while (s !== previous);
  return [...s.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map(match => match[1]);
}
const inKeyframes = node => node.parent?.type === 'atrule' && /keyframes$/i.test(node.parent.name);
const blankBefore = node => /\n\s*\n/.test(node?.raws?.before || '');

const report = {};
const dead = new Set();
for (const file of TARGETS) {
  const css = fs.readFileSync(file, 'utf8');
  const ast = postcss.parse(css, { from: file });
  const stats = { selectores: 0, reglas: 0, keyframes: 0, pisadas: 0, importantAntes: (css.match(/!important/g) || []).length };
  const gone = new Set();

  ast.walkRules(rule => {
    if (inKeyframes(rule)) return;
    const keep = rule.selectors.filter(selector => {
      const missing = requiredClasses(selector).filter(name => !classUsed(name));
      missing.forEach(name => dead.add(name));
      if (missing.length) stats.selectores += 1;
      return !missing.length;
    });
    if (!keep.length) { gone.add(rule); stats.reglas += 1; } else if (keep.length !== rule.selectors.length) rule.selectors = keep;
  });
  ast.walkAtRules(/keyframes$/i, atRule => {
    const name = atRule.params.trim();
    if (!animationNames.has(name) && !words.has(name)) { gone.add(atRule); stats.keyframes += 1; }
  });
  const doomed = [];
  ast.walk(node => { if (gone.has(node)) doomed.push(node); });
  for (const node of doomed) {
    if (!node.parent) continue;
    const comment = node.prev();
    const tight = !blankBefore(node);
    node.remove();
    // El comentario pegado a una regla que se va, si quedó huérfano, también.
    if (comment?.type === 'comment' && tight) {
      const next = comment.next();
      if (!next || next.type === 'comment' || blankBefore(next)) comment.remove();
    }
  }

  // Declaraciones pisadas por la misma regla más abajo (mismo contexto).
  const context = node => { const parts = []; let p = node.parent; while (p && p.type !== 'root') { if (p.type === 'atrule') parts.unshift(`@${p.name} ${p.params}`); p = p.parent; } return parts.join(' | '); };
  const last = new Map();
  ast.walkRules(rule => {
    if (inKeyframes(rule)) return;
    const key = `${context(rule)} || ${rule.selectors.map(s => s.trim()).join(',')}`;
    rule.each(decl => {
      if (decl.type !== 'decl') return;
      const k = `${key} :: ${decl.prop.toLowerCase()}`;
      const previousDecl = last.get(k);
      if (previousDecl?.parent && previousDecl.parent !== rule && (decl.important || !previousDecl.important)) { previousDecl.remove(); stats.pisadas += 1; }
      last.set(k, decl);
    });
  });
  let changed = true;
  while (changed) {
    changed = false;
    ast.walk(node => {
      if ((node.type === 'rule' || (node.type === 'atrule' && node.nodes)) && !node.nodes.some(child => child.type !== 'comment')) { node.remove(); changed = true; }
    });
  }
  const out = ast.toString().replace(/(\r?\n)(?:[ \t]*\r?\n){2,}/g, '$1$1');
  stats.importantDespues = (out.match(/!important/g) || []).length;
  stats.bytes = `${css.length} → ${out.length}`;
  report[path.relative(root, file).replace(/\\/g, '/')] = stats;
  if (write) fs.writeFileSync(file, out);
}
console.table(report);
if (dead.size) console.log(`Clases sin uso (${dead.size}): ${[...dead].sort().slice(0, 60).join(' ')}${dead.size > 60 ? ' …' : ''}`);
console.log(write ? 'Escrito.' : 'Sin cambios (agregá --write para aplicar).');
