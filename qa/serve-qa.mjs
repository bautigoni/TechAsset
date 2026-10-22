// Levanta una instancia de QA para UNA persona: server real (node server/index.js)
// sirviendo el build de producción (dist/) sobre su propia copia de la base QA.
//
//   node qa/serve-qa.mjs --name=impaciente --port=8711            # queda corriendo (Ctrl C la baja)
//   node qa/serve-qa.mjs --name=impaciente --port=8711 --fresh    # copia de nuevo la base sembrada (códigos sin usar)
//   opciones: --seed=<base sembrada> (default qa/.out/qa-seed.db), --build (fuerza vite build), --no-build
//
// Cada --name tiene su carpeta qa/.out/<name>/: techasset.db (su copia), mails.log
// (mails de modo prueba, una línea JSON por mail), server.log e instance.json
// (pids, para qa/stop-qa.mjs). Los adjuntos van a un temporal del sistema que
// se borra al bajar la instancia. Nunca usa los puertos 5173 ni 8000.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  CREDENTIALS_FILE, DEFAULT_SEED_DB, QA_SITE, assertSafeDbPath, die, ensureBuild, flag, instanceDir, option, parsePort,
  readJson, removeDbFiles, root, safeName, snapshotDatabase, startQaServer, stopQaServer
} from './lib.mjs';

const name = safeName(option('name'));
const port = parsePort(option('port'));
const seedDb = assertSafeDbPath(option('seed') || DEFAULT_SEED_DB);
if (!fs.existsSync(seedDb)) die(`No existe la base sembrada ${path.relative(root, seedDb)}. Corré primero: node qa/seed-qa-tenant.mjs`);

const dir = instanceDir(name);
const dbPath = path.join(dir, 'techasset.db');
const mailFile = path.join(dir, 'mails.log');
const logFile = path.join(dir, 'server.log');
const infoFile = path.join(dir, 'instance.json');

// ¿Ya hay una instancia viva con este nombre?
const previous = readJson(infoFile);
if (previous?.pid && isAlive(previous.pid) && previous.pid !== process.pid) {
  die(`Ya hay una instancia "${name}" corriendo (pid ${previous.pid}, ${previous.base}). Bajala con: node qa/stop-qa.mjs --name=${name}`);
}

fs.mkdirSync(dir, { recursive: true });
if (flag('fresh') || !fs.existsSync(dbPath)) {
  removeDbFiles(dbPath);
  fs.rmSync(mailFile, { force: true });
  await snapshotDatabase(seedDb, dbPath);
  console.log(`Copia nueva de la base QA → ${path.relative(root, dbPath)}`);
} else {
  console.log(`Reusando ${path.relative(root, dbPath)} (--fresh para volver a la base sembrada)`);
}

const buildMode = flag('build') ? 'force' : flag('no-build') ? 'skip' : 'auto';
ensureBuild(buildMode, message => console.log(message));

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `techasset-qa-${name}-`));
let server;
let stopping = false;

async function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  await stopQaServer(server);
  for (let i = 0; i < 20; i += 1) {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); break; } catch { await new Promise(resolve => setTimeout(resolve, 150)); }
  }
  const info = readJson(infoFile);
  if (info?.pid === process.pid) fs.rmSync(infoFile, { force: true });
  console.log(`Instancia "${name}" abajo.`);
  process.exit(code);
}
for (const signal of ['SIGINT', 'SIGTERM', 'SIGBREAK', 'SIGHUP']) process.on(signal, () => { shutdown(0); });

try {
  fs.appendFileSync(logFile, `\n==== ${new Date().toISOString()} · puerto ${port} ====\n`);
  server = await startQaServer({ dbPath, port, uploadsDir: path.join(tmpDir, 'uploads'), mailFile, tmpDir, logFile });
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  await shutdown(1);
}

server.child.on('exit', code => {
  if (!stopping) {
    console.error(`El server se cerró solo (código ${code}). Mirá ${path.relative(root, logFile)}.`);
    shutdown(1);
  }
});

fs.writeFileSync(infoFile, `${JSON.stringify({ name, pid: process.pid, serverPid: server.child.pid, port, base: server.base, db: dbPath, mailFile, tmpDir, startedAt: new Date().toISOString() }, null, 2)}\n`);

const creds = readJson(CREDENTIALS_FILE);
const persona = creds?.personas?.[name] || creds?.repuestos?.[name];
console.log(`
TechAsset QA "${name}" en ${server.base}
  Landing:   ${server.base}/
  Sede:      ${QA_SITE} (${creds?.sede?.nombre || 'Sede de prueba'})${persona ? `
  Registro:  ${server.base}${persona.registro}` : ''}
  Admin QA:  ${creds?.admin?.email || '(ver qa/.out/credenciales.json)'}
  Mails:     ${path.relative(root, mailFile)}  (node qa/mails.mjs --name=${name})
  Log:       ${path.relative(root, logFile)}
Ctrl C (o node qa/stop-qa.mjs --name=${name}) para bajarla.`);

function isAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}
