// A/B intercalado con perf/suite.mjs: corre A y B alternados (A B, B A, …) con
// --runs=R por tanda y junta las muestras crudas. Imprime mediana / p95 por
// métrica y la carga de fondo de la máquina durante cada tanda (CPU de los
// procesos ajenos: lo que no es el server ni el Chrome de la suite no se puede
// separar, así que se informa la carga total de la máquina antes de cada tanda).
//
//   node perf/ab.mjs --a=<checkout> --b=<checkout> --only=startup,views --runs=4 --rounds=2 --tag=x
//
// Los checkouts tienen que estar buildeados (se corre con --no-build). Salida
// en perf/.out/ab/<tag>/ (no se versiona).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = (name, fallback) => { const f = argv.find(a => a.startsWith(`--${name}=`)); return f ? f.slice(name.length + 3) : fallback; };
const A = opt('a'); const B = opt('b');
const ONLY = opt('only', 'startup,views');
const RUNS = Number(opt('runs', 4));
const ROUNDS = Number(opt('rounds', 2));
const TAG = opt('tag', 'ab');
const SUITE = path.join(here, 'suite.mjs');
const DB = opt('db', path.join(here, '..', 'docs', 'redesign', 'bench', 'snapshot.db'));
const OUT = path.join(here, '.out', 'ab', TAG);
fs.mkdirSync(OUT, { recursive: true });
const merged = { A: null, B: null };
const loads = { A: [], B: [] };

function merge(target, source) {
  if (Array.isArray(source)) return (target || []).concat(source);
  if (source && typeof source === 'object') {
    const out = target && typeof target === 'object' && !Array.isArray(target) ? target : {};
    for (const [k, v] of Object.entries(source)) out[k] = merge(out[k], v);
    return out;
  }
  return target === undefined ? source : target;
}

/** Núcleos ocupados en promedio durante 3 s (toda la máquina). */
async function machineLoad() {
  const snap = () => os.cpus().reduce((acc, cpu) => { const t = cpu.times; acc.busy += t.user + t.nice + t.sys + t.irq; acc.all += t.user + t.nice + t.sys + t.irq + t.idle; return acc; }, { busy: 0, all: 0 });
  const a = snap();
  await new Promise(resolve => setTimeout(resolve, 3000));
  const b = snap();
  return Math.round(((b.busy - a.busy) / (b.all - a.all)) * os.cpus().length * 10) / 10;
}

for (let round = 0; round < ROUNDS; round += 1) {
  const order = round % 2 === 0 ? ['A', 'B'] : ['B', 'A'];
  for (const side of order) {
    const repo = side === 'A' ? A : B;
    const label = `${TAG}-${side}-${round}`;
    const load = await machineLoad();
    loads[side].push(load);
    const t0 = Date.now();
    const result = spawnSync(process.execPath, [SUITE, `--repo=${repo}`, `--label=${label}`, `--db=${DB}`, `--out=${OUT}`, `--only=${ONLY}`, `--runs=${RUNS}`, '--no-build'], { encoding: 'utf8' });
    fs.writeFileSync(path.join(OUT, `${label}.log`), (result.stdout || '') + (result.stderr || ''));
    console.log(`${label}: exit ${result.status} en ${Math.round((Date.now() - t0) / 1000)} s (carga previa ${load} núcleos de ${os.cpus().length})`);
    const file = path.join(OUT, `${label}.json`);
    if (!fs.existsSync(file)) { console.log(result.stderr?.slice(-2000)); continue; }
    const json = JSON.parse(fs.readFileSync(file, 'utf8'));
    merged[side] = merge(merged[side], json.results);
  }
}
fs.writeFileSync(path.join(OUT, 'merged.json'), JSON.stringify({ merged, loads }));

const stats = values => {
  const v = values.filter(x => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  return { n: v.length, med: Math.round(v[Math.floor((v.length - 1) / 2)] * 10) / 10, p95: Math.round(v[Math.min(v.length - 1, Math.ceil(v.length * 0.95) - 1)] * 10) / 10 };
};
const rows = [];
const add = (name, getter) => {
  const a = stats(getter(merged.A || {}) || []); const b = stats(getter(merged.B || {}) || []);
  if (!a && !b) return;
  const d = a && b && a.med ? `${b.med >= a.med ? '+' : ''}${Math.round(((b.med - a.med) / a.med) * 1000) / 10} %` : '';
  rows.push(`| ${name} | ${a ? `${a.med} / ${a.p95} (${a.n})` : '–'} | ${b ? `${b.med} / ${b.p95} (${b.n})` : '–'} | ${d} |`);
};
const ok = list => (list || []).filter(x => x && x.ok !== false);
for (const mode of ['cold', 'warm']) {
  for (const key of ['fcp', 'shell', 'dashboardReady', 'dashboardData', 'tti', 'tbt', 'dcl', 'longTaskMs']) add(`inicio ${mode} ${key}`, r => (r.startup?.[mode] || []).map(x => x[key]));
}
const viewKeys = Object.keys(merged.A?.views?.first || merged.B?.views?.first || {});
for (const pass of ['first', 'second']) for (const key of viewKeys) {
  add(`${key} ${pass} respuesta`, r => (r.views?.[pass]?.[key] || []).map(x => x.firstChangeMs));
  add(`${key} ${pass} a la vista`, r => ok(r.views?.[pass]?.[key]).map(x => x.readyMs));
  add(`${key} ${pass} contenido`, r => ok(r.views?.[pass]?.[key]).map(x => x.ms));
}
for (const kind of Object.keys(merged.A?.people || {})) add(`personas ${kind}`, r => ok(r.people?.[kind]?.samples).map(x => x.ms));
add('touch 34', r => ok(r.devsearch).map(x => x.ms));
add('historial 1ª', r => ok(r.history?.first).map(x => x.ms));
add('historial más', r => ok(r.history?.more).map(x => x.ms));
for (const list of ['devices', 'history']) {
  add(`scroll ${list} p50`, r => ok(r.scroll?.[list]).map(x => x.p50));
  add(`scroll ${list} p95`, r => ok(r.scroll?.[list]).map(x => x.p95));
  add(`scroll ${list} peor frame`, r => ok(r.scroll?.[list]).map(x => x.worst));
  add(`scroll ${list} frames > 50 ms`, r => ok(r.scroll?.[list]).map(x => x.over50));
}
add('prestar', r => ok(r.ops?.lend).map(x => x.ms));
add('devolver', r => ok(r.ops?.ret).map(x => x.ms));
const fmtLoad = list => list.length ? `${Math.min(...list)}–${Math.max(...list)}` : '–';
console.log(`\nCarga de fondo antes de cada tanda (núcleos ocupados de ${os.cpus().length}): A ${fmtLoad(loads.A)} · B ${fmtLoad(loads.B)}`);
console.log(`\n| métrica | A | B | B vs A |\n| --- | ---: | ---: | ---: |\n${rows.join('\n')}`);
