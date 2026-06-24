#!/usr/bin/env node
/**
 * Dispara un broadcast de release a todos los usuarios activos.
 *
 * Uso:
 *   node server/scripts/send-release-broadcast.js \
 *     --version=v1.4.0 \
 *     --title="TechAsset v1.4.0: tickets, bento, PWA y más" \
 *     --file=./release-notes-v1.4.0.md
 *
 *   --dry-run              solo loguea, no inserta ni envía.
 *   --force                reenvía aunque la versión ya tenga sent_at.
 *
 * El body se lee de un archivo .md para que puedas escribir release notes
 * largos sin pelearte con el shell. Soporta ## headings y - bullets tal cual
 * los va a recibir el usuario.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb, nowIso } from '../db.js';
import { broadcastRelease } from '../services/notifications.service.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..', '..');

function parseArgs(argv) {
  const args = { dryRun: false, force: false };
  for (const arg of argv.slice(2)) {
    if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--force') args.force = true;
    else if (arg.startsWith('--version=')) args.version = arg.slice('--version='.length);
    else if (arg.startsWith('--title=')) args.title = arg.slice('--title='.length);
    else if (arg.startsWith('--file=')) args.file = arg.slice('--file='.length);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.version || !args.title) {
    console.error('Faltan --version y --title.');
    console.error('Uso: node server/scripts/send-release-broadcast.js --version=X.Y.Z --title="..." [--file=path/al/release.md] [--dry-run] [--force]');
    process.exit(2);
  }
  let body = '';
  if (args.file) {
    const filePath = path.isAbsolute(args.file) ? args.file : path.join(rootDir, args.file);
    body = fs.readFileSync(filePath, 'utf8');
  }

  const db = getDb();
  const existing = db.prepare('SELECT version, sent_at FROM release_notes WHERE version=?').get(args.version);
  if (existing && existing.sent_at && !args.force) {
    console.error(`La versión ${args.version} ya fue enviada el ${existing.sent_at}. Usá --force para reenviar.`);
    process.exit(3);
  }

  if (args.dryRun) {
    console.log('[DRY-RUN] No se insertó ni envió nada.');
    console.log(`  version: ${args.version}`);
    console.log(`  title:   ${args.title}`);
    console.log(`  body:    ${body.length} caracteres desde ${args.file || '(vacío)'}`);
    const recipients = db.prepare("SELECT COUNT(*) AS n FROM users WHERE activo=1 AND COALESCE(email,'')<>''").get().n;
    console.log(`  recipients activos: ${recipients}`);
    process.exit(0);
  }

  const ts = nowIso();
  db.prepare(`
    INSERT INTO release_notes (version, title, body_md, sent_at, sent_by)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(version) DO UPDATE SET title=excluded.title, body_md=excluded.body_md, sent_at=excluded.sent_at, sent_by=excluded.sent_by
  `).run(args.version, args.title, body, ts, 'cli-script');

  console.log(`Enviando release ${args.version} a usuarios activos...`);
  const result = await broadcastRelease({ version: args.version, title: args.title, body });
  console.log(`OK: ${result.mailsSent} mails enviados a ${result.recipients} usuarios activos.`);
}

main().catch(err => {
  console.error('[release-broadcast] error:', err?.message || err);
  process.exit(1);
});