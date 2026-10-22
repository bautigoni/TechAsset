// Baja instancias de QA levantadas con qa/serve-qa.mjs.
//
//   node qa/stop-qa.mjs --name=impaciente           # baja esa instancia
//   node qa/stop-qa.mjs --all                       # baja todas
//   node qa/stop-qa.mjs --all --purge               # y borra sus carpetas (bases, mails, logs)
//
// Mata el server y el proceso de serve-qa (en Windows no hay señales: si se
// matara solo el padre, el server quedaría huérfano escuchando en el puerto).
import fs from 'node:fs';
import path from 'node:path';
import { OUT_DIR, die, flag, instanceDir, option, readJson, safeName } from './lib.mjs';

const names = flag('all')
  ? (fs.existsSync(OUT_DIR) ? fs.readdirSync(OUT_DIR, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name) : [])
  : [safeName(option('name') || die('Falta --name=<persona> o --all.'))];

const kill = pid => {
  if (!pid) return false;
  try { process.kill(pid); return true; } catch { return false; }
};

for (const name of names) {
  const dir = instanceDir(name);
  const info = readJson(path.join(dir, 'instance.json'));
  if (info) {
    const server = kill(info.serverPid);
    const parent = kill(info.pid);
    if (info.tmpDir) fs.rmSync(info.tmpDir, { recursive: true, force: true });
    fs.rmSync(path.join(dir, 'instance.json'), { force: true });
    console.log(`${name}: ${server || parent ? `bajada (${info.base})` : 'no estaba corriendo'}`);
  } else if (!flag('all')) {
    console.log(`${name}: no hay instancia registrada.`);
  }
  if (flag('purge') && fs.existsSync(dir)) {
    // En Windows la base puede quedar tomada unos ms después de matar el proceso.
    for (let i = 0; i < 30; i += 1) {
      try { fs.rmSync(dir, { recursive: true, force: true }); break; } catch { await new Promise(resolve => setTimeout(resolve, 200)); }
    }
    console.log(`${name}: carpeta borrada.`);
  }
}
