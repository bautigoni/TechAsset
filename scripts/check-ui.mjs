// Guardia de controles nativos y "slop" (docs/redesign/PLAN.md §5, "Guardia automática").
//
//   npm run check:ui              # compara contra scripts/check-ui.baseline.json
//   npm run check:ui -- --update  # reescribe el baseline con lo que hay hoy
//   npm run check:ui -- --list    # lista todo lo encontrado (no solo lo nuevo)
//
// Busca en src/ (fuera de src/ui/, donde viven los componentes propios que SÍ
// pueden envolver lo nativo) los controles que el rediseño reemplaza. Hoy hay
// muchos: quedan en el baseline. La corrida falla solo si aparece algo NUEVO, y
// avisa cuando algo del baseline desapareció para achicarlo con --update.
//
// Las ocurrencias se identifican por archivo + regla + texto de la línea (sin
// número de línea), así mover código no las vuelve "nuevas".
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = path.join(root, 'src');
const baselinePath = path.join(root, 'scripts', 'check-ui.baseline.json');
const args = process.argv.slice(2);
const update = args.includes('--update');
const listAll = args.includes('--list');

// Fuera de la guardia: los componentes propios y los archivos de tokens.
const EXEMPT = [/^src\/ui\//, /^src\/styles\/variables\.css$/, /^src\/styles\/tokens[^/]*\.css$/];

const RULES = [
  { id: 'select-nativo', label: '<select> nativo', ext: /\.(tsx|jsx)$/, test: line => /<select[\s>]/.test(line) },
  { id: 'input-nativo', label: 'input type=date|time|datetime-local|month|week|color|file|number|range', ext: /\.(tsx|jsx)$/, test: line => /\btype\s*=\s*\{?\s*["'`](date|time|datetime-local|month|week|color|file|number|range)["'`]/.test(line) },
  { id: 'checkbox-radio-crudo', label: 'checkbox/radio crudo', ext: /\.(tsx|jsx)$/, test: line => /\btype\s*=\s*\{?\s*["'`](checkbox|radio)["'`]/.test(line) },
  { id: 'details', label: '<details>', ext: /\.(tsx|jsx)$/, test: line => /<details[\s>]/.test(line) },
  { id: 'datalist', label: '<datalist>', ext: /\.(tsx|jsx)$/, test: line => /<datalist[\s>]/.test(line) },
  { id: 'dialogo-nativo', label: 'window.confirm|prompt|alert', ext: /\.(tsx?|jsx?)$/, test: line => /\bwindow\.(confirm|prompt|alert)\s*\(/.test(line) },
  { id: 'hex-en-css', label: 'color hexadecimal suelto en CSS de pantallas', ext: /\.css$/, test: line => /#[0-9a-fA-F]{3,8}\b/.test(stripCssComment(line)) }
];

function stripCssComment(line) {
  return line.replace(/\/\*.*?\*\//g, '');
}

/** Línea de TS/JSX sin comentarios (los que mencionan "<select>" no son código). */
function codeOnly(line) {
  const trimmed = line.trim();
  if (/^(\/\/|\/\*|\*|\{\/\*)/.test(trimmed)) return '';
  return line.replace(/\{?\/\*.*?\*\/\}?/g, '');
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/**
 * `title=` usado como tooltip: solo en elementos nativos (tag en minúscula),
 * no en props de componentes (`<Modal title=...>`). Recorre cada apertura de
 * tag JSX respetando llaves y comillas para soportar atributos multilínea.
 */
function findTitleTooltips(source) {
  const hits = [];
  const tagStart = /<([a-z][a-z0-9-]*)\b/g;
  let match;
  while ((match = tagStart.exec(source))) {
    const name = match[1];
    if (name === 'title') continue;
    let depth = 0;
    let quote = '';
    let i = match.index + match[0].length;
    for (; i < source.length; i += 1) {
      const char = source[i];
      if (quote) {
        if (char === quote && source[i - 1] !== '\\') quote = '';
        continue;
      }
      if (char === '"' || char === "'" || char === '`') { if (depth > 0 || char !== '`') quote = char; continue; }
      if (char === '{') depth += 1;
      else if (char === '}') depth -= 1;
      else if (char === '>' && depth === 0) break;
    }
    const attrs = source.slice(match.index, i);
    const titleAt = attrs.search(/\stitle\s*=/);
    if (titleAt >= 0 && depthAt(attrs, titleAt) === 0) {
      const offset = match.index + titleAt;
      const lineNo = source.slice(0, offset).split('\n').length;
      const snippet = attrs.slice(titleAt).trim().split('\n')[0].slice(0, 90);
      hits.push({ line: lineNo, text: `<${name} ${snippet}` });
    }
  }
  return hits;
}

/** Profundidad de llaves en una posición (para no contar `title=` dentro de una expresión). */
function depthAt(text, index) {
  let depth = 0;
  for (let i = 0; i < index; i += 1) {
    if (text[i] === '{') depth += 1;
    else if (text[i] === '}') depth -= 1;
  }
  return depth;
}

function scan() {
  const findings = [];
  for (const file of walk(srcDir)) {
    const rel = path.relative(root, file).split(path.sep).join('/');
    if (EXEMPT.some(rx => rx.test(rel))) continue;
    if (!/\.(tsx?|jsx?|css)$/.test(rel)) continue;
    const source = fs.readFileSync(file, 'utf8');
    const lines = source.split('\n');
    lines.forEach((line, index) => {
      for (const rule of RULES) {
        const code = /\.css$/.test(rel) ? line : codeOnly(line);
        if (rule.ext.test(rel) && rule.test(code)) findings.push({ rule: rule.id, file: rel, line: index + 1, text: line.trim().slice(0, 160) });
      }
    });
    if (/\.(tsx|jsx)$/.test(rel)) {
      for (const hit of findTitleTooltips(source)) findings.push({ rule: 'title-tooltip', file: rel, line: hit.line, text: hit.text });
    }
  }
  return findings;
}

const keyOf = finding => `${finding.rule}|${finding.file}|${finding.text}`;
const countBy = list => list.reduce((map, finding) => map.set(keyOf(finding), (map.get(keyOf(finding)) || 0) + 1), new Map());
const LABELS = Object.fromEntries([...RULES.map(rule => [rule.id, rule.label]), ['title-tooltip', 'title= como tooltip en un elemento nativo']]);

const findings = scan();
const current = countBy(findings);
const byRule = findings.reduce((acc, finding) => ({ ...acc, [finding.rule]: (acc[finding.rule] || 0) + 1 }), {});

if (update || !fs.existsSync(baselinePath)) {
  const entries = [...current.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, count]) => {
    const [rule, file, ...text] = key.split('|');
    return { rule, file, text: text.join('|'), count };
  });
  fs.writeFileSync(baselinePath, `${JSON.stringify({ note: 'Generado por scripts/check-ui.mjs --update. Lo que hay hoy en src/ fuera de src/ui/; se achica a medida que el rediseño reemplaza controles.', totals: byRule, entries }, null, 2)}\n`);
  console.log(`${update ? 'Baseline actualizado' : 'Baseline creado'}: ${findings.length} ocurrencias en scripts/check-ui.baseline.json`);
  for (const [rule, count] of Object.entries(byRule)) console.log(`  ${String(count).padStart(4)}  ${LABELS[rule]}`);
  process.exit(0);
}

const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
const allowed = new Map(baseline.entries.map(entry => [`${entry.rule}|${entry.file}|${entry.text}`, entry.count]));

const added = [];
for (const [key, count] of current) {
  const extra = count - (allowed.get(key) || 0);
  if (extra > 0) added.push(...findings.filter(finding => keyOf(finding) === key).slice(-extra));
}
const gone = [];
for (const [key, count] of allowed) {
  const missing = count - (current.get(key) || 0);
  if (missing > 0) {
    const [rule, file, ...text] = key.split('|');
    gone.push({ rule, file, text: text.join('|'), missing });
  }
}

console.log('Guardia de UI (src/ fuera de src/ui/)');
for (const rule of Object.keys(LABELS)) {
  const before = baseline.totals?.[rule] || 0;
  const now = byRule[rule] || 0;
  console.log(`  ${String(now).padStart(4)}  ${LABELS[rule]}${now !== before ? `  (baseline ${before})` : ''}`);
}

if (listAll) {
  console.log('\nTodo lo encontrado:');
  for (const finding of findings) console.log(`  ${finding.file}:${finding.line}  [${finding.rule}]  ${finding.text}`);
}

if (gone.length) {
  console.log(`\nSalieron ${gone.reduce((sum, item) => sum + item.missing, 0)} ocurrencias del baseline (bien). Achicalo con: npm run check:ui -- --update`);
  for (const item of gone.slice(0, 30)) console.log(`  - ${item.file}  [${item.rule}]  ${item.text}${item.missing > 1 ? `  ×${item.missing}` : ''}`);
  if (gone.length > 30) console.log(`  ... y ${gone.length - 30} más`);
}

if (added.length) {
  console.log(`\nFALLA: ${added.length} ocurrencias NUEVAS (no estaban en el baseline). Usá los componentes de src/ui/ o los tokens:`);
  for (const finding of added) console.log(`  + ${finding.file}:${finding.line}  [${LABELS[finding.rule]}]  ${finding.text}`);
  process.exit(1);
}
console.log(`\nOK: nada nuevo respecto del baseline (${findings.length} ocurrencias heredadas).`);
