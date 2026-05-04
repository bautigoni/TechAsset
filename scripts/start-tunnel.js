// Mantiene el tunel publicado siempre en https://techasset-nfpt.loca.lt
// Reintenta automaticamente si localtunnel cae o no concede el subdominio.
import { spawn } from 'node:child_process';

const SUBDOMAIN = process.env.TUNNEL_SUBDOMAIN || 'techasset-nfpt';
const PORT = process.env.TUNNEL_PORT || process.env.PORT || '8000';
const HOST = process.env.TUNNEL_HOST || '127.0.0.1';
const TARGET_URL = `https://${SUBDOMAIN}.loca.lt`;
const RETRY_MS = Number(process.env.TUNNEL_RETRY_MS || 4000);
const npxCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx';

let stopping = false;

function waitFor(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runOnce() {
  return new Promise(resolve => {
    console.log(`[tunnel] abriendo ${TARGET_URL} -> http://${HOST}:${PORT}`);
    const child = spawn(npxCommand, [
      'localtunnel',
      '--local-host', HOST,
      '--port', String(PORT),
      '--subdomain', SUBDOMAIN
    ], { stdio: 'inherit' });

    child.on('exit', code => {
      console.log(`[tunnel] localtunnel cerro (codigo ${code})`);
      resolve();
    });

    child.on('error', error => {
      console.warn(`[tunnel] error ejecutando localtunnel: ${error.message}`);
      resolve();
    });

    process.once('SIGINT', () => { stopping = true; child.kill('SIGINT'); });
    process.once('SIGTERM', () => { stopping = true; child.kill('SIGTERM'); });
  });
}

async function loop() {
  while (!stopping) {
    await runOnce();
    if (stopping) break;
    console.log(`[tunnel] reintentando en ${RETRY_MS}ms...`);
    await waitFor(RETRY_MS);
  }
}

loop().catch(error => {
  console.error('[tunnel] fallo critico:', error);
  process.exit(1);
});
