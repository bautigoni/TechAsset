// ux) Barrido de REGLAS-UX sobre TODAS las vistas: las del menú del superadmin
// y las páginas de detalle con URL (equipo, tarea, ticket, artículo y cada
// panel de Configuración), a 390, 1024 y 1440 px en oscuro y claro, con la
// sonda compartida `lib/ux-probe.mjs`:
//   huecos > 48 px entre bloques · tarjetas con franjas vacías · truncados con
//   lugar · texto cortado sin elipsis · controles tapados (recorriendo el
//   scroll) · cosas que parecen clickeables y no lo son · cada colapsable
//   (aria-expanded + aria-controls) abre y cierra sin mover su disparador
//   (± 2 px) ni scrollear el documento (a 1440 oscuro y 390 claro).
//
// Es BLOQUEANTE (cuenta como funcional: un hallazgo corta la corrida con exit 1)
// desde que todas las vistas quedaron en cero; `--ux-lenient` la vuelve línea base
// (informa sin cortar, para depurar). `--no-ux` la saltea.
// Capturas en e2e/.out/ux/ y el detalle en e2e/.out/ux/report.json (y en
// last-run.json → ux).
import fs from 'node:fs';
import path from 'node:path';
import { root } from '../lib/env.mjs';
import { gotoView, openContext, sleep } from '../lib/browser.mjs';
import { checkCollapsibles, countTotal, formatProbe, probeView, setTheme, settle } from '../lib/ux-probe.mjs';
import { NAV_ITEM } from './functional.mjs';

export const UX_WIDTHS = [390, 1024, 1440];
export const UX_THEMES = ['dark', 'light'];
const outDir = path.join(root, 'e2e', '.out', 'ux');
const WORKERS = 3;

// Zonas donde el vacío ES el contenido (lienzos): no se miden huecos ni tarjetas
// vacías ahí. Lo ideal es que la pantalla las marque con data-ux-ignore.
const IGNORE_BY_KIND = { canvas: ['.cv-board'] };

// Paneles de Configuración (settingsRoute.ts). Se prueban todos los que el superadmin ve.
const SETTINGS_PANELS = ['cuenta', 'apariencia', 'notificaciones', 'turnos', 'modulos', 'roles', 'usuarios', 'invitaciones', 'prestamo', 'vida-util', 'sede', 'avanzado', 'sedes', 'mail'];

// Dueño de cada vista en el barrido (para el reporte de hallazgos).
const FRONTS = {
  operacion: ['dashboard', 'loans', 'devices', 'history', 'inventory', 'device'],
  gestion: ['agenda', 'schedules', 'classrooms', 'reminders', 'tasks', 'tickets', 'suggestions', 'task', 'ticket'],
  recursos: ['knowledge', 'canvas', 'analytics', 'settings', 'tools', 'quickaccess', 'pettycash', 'article', 'settings-panel'],
  shell: ['shell']
};
export function frontOf(kind) {
  return Object.entries(FRONTS).find(([, list]) => list.includes(kind))?.[0] || 'otro';
}

async function detailTargets(api) {
  const out = [];
  const devices = await api.devices();
  const device = devices.find(item => /^D\d+$/i.test(item.etiqueta)) || devices[0];
  if (device) out.push({ key: `device:${device.etiqueta}`, kind: 'device', label: `Equipo ${device.etiqueta}`, path: `devices/${encodeURIComponent(device.etiqueta)}`, ready: '.dv-detail--page' });
  const tasks = (await api.get('/api/tasks?space=team')).data.items || [];
  const task = tasks.find(item => item.descripcion) || tasks[0];
  if (task) out.push({ key: `task:${task.id}`, kind: 'task', label: `Tarea ${task.id}`, path: `tasks/${encodeURIComponent(task.id)}` });
  const tickets = (await api.get('/api/tickets')).data.items || [];
  const ticket = tickets.find(item => (item.checklist || []).length) || tickets[0];
  if (ticket) out.push({ key: `ticket:${ticket.id}`, kind: 'ticket', label: `Ticket ${ticket.id}`, path: `tickets/${ticket.id}` });
  const articles = (await api.get('/api/knowledge/articles')).data.items || [];
  const article = articles.find(item => String(item.body || item.contenido || '').length > 400) || articles[0];
  if (article) out.push({ key: `article:${article.id}`, kind: 'article', label: `Artículo ${article.id}`, path: `knowledge/${article.id}` });
  for (const panel of SETTINGS_PANELS) out.push({ key: `settings/${panel}`, kind: 'settings-panel', label: `Configuración › ${panel}`, path: `settings/${panel}` });
  return out;
}

async function pool(items, size, fn) {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(size, queue.length) }, async () => {
    while (queue.length) await fn(queue.shift());
  }));
}

export async function uxTests({ browser, base, api, admin, releaseVersion, test, strict = false }) {
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  const report = {};

  // Vistas del menú (las que la sede tiene prendidas), sin la muestra interna de componentes.
  const first = await openContext(browser, { base, token: admin.token, releaseVersion, reducedMotion: true, viewport: { width: 1440, height: 900 } });
  let menu = [];
  try {
    await gotoView(first.page, base, 'dashboard');
    await first.page.waitForSelector(NAV_ITEM, { timeout: 20000 });
    menu = (await first.page.$$eval(NAV_ITEM, buttons => buttons.map(button => button.getAttribute('data-view')))).filter(key => key && key !== 'ui');
  } finally {
    await first.context.close().catch(() => {});
  }
  const targets = [
    ...menu.map(view => ({ key: view, kind: view, label: view, path: view })),
    ...(await detailTargets(api))
  ];

  const contexts = [];
  const pages = [];
  for (let i = 0; i < WORKERS; i += 1) {
    const ctx = await openContext(browser, { base, token: admin.token, releaseVersion, reducedMotion: true, viewport: { width: 1440, height: 900 } });
    contexts.push(ctx.context);
    pages.push(ctx.page);
  }
  const free = [...pages];

  const runTarget = async target => {
    const page = free.pop();
    try {
      await test('ux', `UX ${frontOf(target.kind)}`, `${target.label} (${UX_WIDTHS.join('/')} px, oscuro y claro)`, async () => {
        const entry = { kind: target.kind, front: frontOf(target.kind), path: target.path, combos: {}, collapsibles: {} };
        report[target.key] = entry;
        const problems = [];
        for (const width of UX_WIDTHS) {
          await page.setViewport({ width, height: width < 768 ? 844 : width <= 1024 ? 768 : 900 });
          await gotoView(page, base, target.path);
          if (target.ready) await page.waitForSelector(target.ready, { timeout: 15000 }).catch(() => {});
          await settle(page);
          for (const theme of UX_THEMES) {
            await setTheme(page, theme);
            await sleep(120);
            const probe = await probeView(page, { ignore: IGNORE_BY_KIND[target.kind] || [] });
            entry.combos[`${theme}-${width}`] = probe;
            const file = `${target.key.replace(/[^a-z0-9-]+/gi, '_')}-${theme}-${width}.png`;
            await page.screenshot({ path: path.join(outDir, file) }).catch(() => {});
            if (probe.error || probe.total) problems.push(`${theme} ${width}: ${formatProbe(probe)}`);
            // Colapsables: a 1440 en oscuro y a 390 en claro (abren/cierran con animación real).
            if ((width === 1440 && theme === 'dark') || (width === 390 && theme === 'light')) {
              const toggles = await checkCollapsibles(page, { max: 8 });
              entry.collapsibles[`${theme}-${width}`] = toggles;
              if (toggles.problems.length) problems.push(`${theme} ${width}: ${formatProbe({ counts: {} }, toggles)}`);
              // Lo abierto/cerrado en la prueba no tiene que contaminar la otra pasada.
              await gotoView(page, base, target.path);
              if (target.ready) await page.waitForSelector(target.ready, { timeout: 15000 }).catch(() => {});
              await settle(page);
            }
          }
        }
        await setTheme(page, 'dark');
        const counts = summarize(entry);
        entry.counts = counts;
        const line = Object.entries(counts).filter(([, value]) => value).map(([key, value]) => `${key === 'underSticky' ? 'bajo algo sticky (info)' : key} ${value}`).join(' · ') || 'limpia';
        if (problems.length) throw new Error(`${line}\n         ${problems.slice(0, 4).join('\n         ')}`);
        return line;
      }, { baseline: !strict });
    } finally {
      free.push(page);
    }
  };

  try {
    // Shell: los disparadores de la cabecera (franjas, campana, cuenta, Ctrl K)
    // y el menú no se mueven al abrir/cerrar; nada del shell tapado ni cortado.
    await (async () => {
      const page = pages[0];
      await test('ux', 'UX shell', 'Shell: cabecera, menú y barra inferior (390/1024/1440 px)', async () => {
        const entry = { kind: 'shell', front: 'shell', combos: {}, collapsibles: {} };
        report.shell = entry;
        const problems = [];
        for (const width of UX_WIDTHS) {
          await page.setViewport({ width, height: width < 768 ? 844 : width <= 1024 ? 640 : 900 });
          await gotoView(page, base, 'dashboard');
          await settle(page);
          for (const theme of UX_THEMES) {
            await setTheme(page, theme);
            await sleep(120);
            // Solo el shell: lo de la vista lo mide su propia prueba.
            const probe = await probeView(page, { scope: '.shell', ignore: ['.shell-view'], scrollSteps: 0 });
            for (const key of ['covered', 'cut']) {
              probe[key] = (probe[key] || []).filter(item => !/shell-view|shell-main/.test(item.where));
              probe.counts[key] = probe[key].length;
            }
            probe.total = countTotal(probe.counts);
            entry.combos[`${theme}-${width}`] = probe;
            await page.screenshot({ path: path.join(outDir, `shell-${theme}-${width}.png`) }).catch(() => {});
            if (probe.total) problems.push(`${theme} ${width}: ${formatProbe(probe)}`);
          }
          const toggles = await checkCollapsibles(page, { scope: '.shell', exclude: '.shell-main', max: 10 });
          entry.collapsibles[`${width}`] = toggles;
          if (toggles.problems.length) problems.push(`${width}: ${formatProbe({ counts: {} }, toggles)}`);
        }
        await setTheme(page, 'dark');
        entry.counts = summarize(entry);
        if (problems.length) throw new Error(problems.slice(0, 4).join('\n         '));
        return Object.entries(entry.counts).filter(([, value]) => value).map(([key, value]) => `${key} ${value}`).join(' · ') || 'limpia';
      }, { baseline: !strict });
    })();

    await pool(targets, WORKERS, runTarget);
  } finally {
    for (const context of contexts) await context.close().catch(() => {});
  }
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(outDir, 'hallazgos.md'), findingsMarkdown(report));
  return report;
}

const LABELS = {
  gaps: 'Hueco entre bloques',
  innerGaps: 'Tarjeta con franja vacía',
  truncated: 'Truncado con lugar',
  cut: 'Texto cortado sin elipsis',
  covered: 'Control tapado',
  fakeClickable: 'Parece clickeable y no lo es',
  underSticky: '(info) Control bajo algo sticky al scrollear'
};

/** Hallazgos agrupados por frente y vista, sin repetir lo mismo en cada ancho/tema. */
export function findingsMarkdown(report) {
  const lines = ['# Hallazgos del barrido ux (generado por e2e/tests/ux.mjs)', ''];
  const byFront = {};
  for (const [key, entry] of Object.entries(report)) (byFront[entry.front] ||= []).push([key, entry]);
  for (const [front, entries] of Object.entries(byFront)) {
    lines.push(`## Frente ${front}`, '');
    for (const [key, entry] of entries) {
      const found = new Map();
      for (const [combo, probe] of Object.entries(entry.combos || {})) {
        for (const kind of Object.keys(LABELS)) {
          for (const item of probe[kind] || []) {
            const detail = item.gap ? `${item.gap} px${item.at ? ` ${item.at}` : ''}` : item.need ? `faltan ${item.need} px, sobran ${item.free} px` : item.by ? `tapado por ${item.by}` : '';
            const id = `${kind}|${item.where}|${item.by || ''}`;
            if (!found.has(id)) found.set(id, { kind, where: item.where, detail, combos: [] });
            found.get(id).combos.push(combo.replace('-', ' '));
          }
        }
      }
      for (const [combo, toggles] of Object.entries(entry.collapsibles || {})) {
        for (const item of toggles.problems || []) {
          const id = `toggle|${item.trigger}|${item.problem}`;
          if (!found.has(id)) found.set(id, { kind: 'toggle', where: item.trigger, detail: item.problem, combos: [] });
          found.get(id).combos.push(combo.replace('-', ' '));
        }
      }
      if (!found.size) continue;
      lines.push(`### ${key} (\`/sede/NFPT/${entry.path || ''}\`)`, '');
      for (const item of found.values()) {
        const label = item.kind === 'toggle' ? 'Colapsable' : LABELS[item.kind];
        lines.push(`- **${label}** · \`${item.where.replace(/`/g, "'")}\`${item.detail ? ` — ${item.detail}` : ''} · ${[...new Set(item.combos)].join(', ')}`);
      }
      lines.push('');
    }
  }
  return lines.join('\n');
}

function summarize(entry) {
  const counts = { gaps: 0, innerGaps: 0, truncated: 0, cut: 0, covered: 0, fakeClickable: 0, collapsibles: 0, underSticky: 0 };
  for (const probe of Object.values(entry.combos)) {
    for (const key of Object.keys(counts)) if (key !== 'collapsibles') counts[key] += probe.counts?.[key] || 0;
  }
  for (const toggles of Object.values(entry.collapsibles)) counts.collapsibles += toggles.problems.length;
  return counts;
}
