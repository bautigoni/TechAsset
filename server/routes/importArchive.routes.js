import { Router } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { config } from '../config.js';

// Mudanza de servidor: recibe un .tar.gz con data/uploads y data/private (los
// adjuntos, logos y capturas que no están en la base) y lo descomprime en data/.
//
// Solo existe mientras está la variable IMPORT_TOKEN (≥ 24 caracteres); sin ella
// responde 404. Se usa una vez en el corte y después se borra la variable:
//   tar -czf archivos.tgz -C /opt/apps/techasset/data uploads private
//   curl -X POST --data-binary @archivos.tgz -H "X-Import-Token: $TOKEN" \
//        -H "Content-Type: application/gzip" https://<nuevo>/api/admin/import-archive
// Solo se aceptan las carpetas uploads/ y private/ (tar rechaza rutas con "..").
export const importArchiveRouter = Router();

function tokenOk(req) {
  const expected = String(process.env.IMPORT_TOKEN || '');
  const given = String(req.get('x-import-token') || '');
  if (expected.length < 24 || given.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

const dataDir = () => path.join(config.rootDir, 'data');

function countFiles(dir) {
  if (!fs.existsSync(dir)) return 0;
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    total += entry.isDirectory() ? countFiles(path.join(dir, entry.name)) : 1;
  }
  return total;
}

importArchiveRouter.get('/admin/import-archive', (req, res) => {
  if (!tokenOk(req)) return res.status(404).json({ ok: false, error: 'No existe.' });
  res.json({ ok: true, uploads: countFiles(path.join(dataDir(), 'uploads')), private: countFiles(path.join(dataDir(), 'private')) });
});

importArchiveRouter.post('/admin/import-archive', async (req, res, next) => {
  if (!tokenOk(req)) return res.status(404).json({ ok: false, error: 'No existe.' });
  const tmpDir = path.join(dataDir(), 'tmp');
  fs.mkdirSync(tmpDir, { recursive: true });
  const file = path.join(tmpDir, `import-${Date.now()}.tgz`);
  try {
    await pipeline(req, fs.createWriteStream(file));
    const list = spawnSync('tar', ['-tzf', file], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
    if (list.status !== 0) return res.status(400).json({ ok: false, error: `No es un .tar.gz válido: ${list.stderr.slice(0, 200)}` });
    const members = list.stdout.split('\n').filter(Boolean);
    const invalid = members.filter(name => !/^(\.\/)?(uploads|private)(\/|$)/.test(name) || name.split('/').includes('..'));
    if (invalid.length) return res.status(400).json({ ok: false, error: `Solo se aceptan uploads/ y private/. Sobran: ${invalid.slice(0, 5).join(', ')}` });
    const extract = spawnSync('tar', ['-xzf', file, '-C', dataDir(), '--no-same-owner', '--no-same-permissions'], { encoding: 'utf8' });
    if (extract.status !== 0) return res.status(500).json({ ok: false, error: `No se pudo descomprimir: ${extract.stderr.slice(0, 200)}` });
    res.json({ ok: true, files: members.filter(name => !name.endsWith('/')).length, uploads: countFiles(path.join(dataDir(), 'uploads')), private: countFiles(path.join(dataDir(), 'private')) });
  } catch (error) {
    next(error);
  } finally {
    fs.rm(file, { force: true }, () => undefined);
  }
});
