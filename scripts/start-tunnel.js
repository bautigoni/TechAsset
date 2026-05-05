// Mantiene el túnel publicado siempre. Estrategia robusta:
// - Probar en orden los proveedores disponibles (cloudflared → localtunnel).
// - Reintentar para siempre con backoff si el túnel cae o el subdominio no se concede.
// - Imprimir la URL pública para que sea fácil compartirla.
//
// Variables disponibles (.env):
//   TUNNEL_PROVIDER=auto|cloudflared|localtunnel   (default: auto)
//   TUNNEL_SUBDOMAIN=techasset-nfpt                (solo localtunnel)
//   TUNNEL_PORT=8000
//   TUNNEL_HOST=127.0.0.1
//   TUNNEL_RETRY_MS=4000
//
// Para que un visitante externo no vea la pantalla de "tunnel password" de loca.lt
// puede abrir la URL agregando ?bypass-tunnel-reminder=true o usar cloudflared.
import { spawn } from 'node:child_process';

const PROVIDER = (process.env.TUNNEL_PROVIDER || 'auto').toLowerCase();
const SUBDOMAIN = process.env.TUNNEL_SUBDOMAIN || 'techasset-nfpt';
const PORT = process.env.TUNNEL_PORT || process.env.PORT || '8000';
const HOST = process.env.TUNNEL_HOST || '127.0.0.1';
const RETRY_MS = Number(process.env.TUNNEL_RETRY_MS || 4000);
const isWin = process.platform === 'win32';
const npxCommand = isWin ? 'npx.cmd' : 'npx';

let stopping = false;
process.once('SIGINT', () => { stopping = true; });
process.once('SIGTERM', () => { stopping = true; });

function waitFor(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function checkBinary(cmd) {
  return new Promise(resolve => {
    const probe = spawn(cmd, ['--version'], { stdio: 'ignore', shell: isWin });
    probe.on('error', () => resolve(false));
    probe.on('exit', code => resolve(code === 0));
  });
}

function runCloudflared() {
  return new Promise(resolve => {
    console.log(`[tunnel] iniciando cloudflared -> http://${HOST}:${PORT}`);
    const child = spawn('cloudflared', ['tunnel', '--no-autoupdate', '--url', `http://${HOST}:${PORT}`], { stdio: ['ignore', 'pipe', 'pipe'], shell: isWin });
    const onData = data => {
      const text = data.toString();
      process.stdout.write(text);
      const match = text.match(/https?:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
      if (match) console.log(`\n[tunnel] URL publica (cloudflared): ${match[0]}\n`);
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', code => { console.log(`[tunnel] cloudflared cerro (codigo ${code})`); resolve(); });
    child.on('error', err => { console.warn(`[tunnel] error cloudflared: ${err.message}`); resolve(); });
    process.once('SIGINT', () => child.kill('SIGINT'));
    process.once('SIGTERM', () => child.kill('SIGTERM'));
  });
}

function runLocaltunnel() {
  return new Promise(resolve => {
    const target = `https://${SUBDOMAIN}.loca.lt`;
    console.log(`[tunnel] iniciando localtunnel ${target} -> http://${HOST}:${PORT}`);
    console.log(`[tunnel] tip: si el visitante ve la pantalla de "tunnel password", abrir ${target}/?bypass-tunnel-reminder=true`);
    const child = spawn(npxCommand, [
      'localtunnel',
      '--local-host', HOST,
      '--port', String(PORT),
      '--subdomain', SUBDOMAIN
    ], { stdio: 'inherit', shell: isWin });
    child.on('exit', code => { console.log(`[tunnel] localtunnel cerro (codigo ${code})`); resolve(); });
    child.on('error', err => { console.warn(`[tunnel] error localtunnel: ${err.message}`); resolve(); });
    process.once('SIGINT', () => child.kill('SIGINT'));
    process.once('SIGTERM', () => child.kill('SIGTERM'));
  });
}

async function pickProvider() {
  if (PROVIDER === 'cloudflared') return 'cloudflared';
  if (PROVIDER === 'localtunnel') return 'localtunnel';
  // auto: preferir cloudflared si esta disponible (no muestra pantalla intermedia)
  const hasCloudflared = await checkBinary('cloudflared');
  return hasCloudflared ? 'cloudflared' : 'localtunnel';
}

async function loop() {
  const provider = await pickProvider();
  console.log(`[tunnel] proveedor seleccionado: ${provider}`);
  let attempt = 0;
  while (!stopping) {
    if (provider === 'cloudflared') await runCloudflared();
    else await runLocaltunnel();
    if (stopping) break;
    attempt += 1;
    const wait = Math.min(RETRY_MS * Math.min(attempt, 5), 30000);
    console.log(`[tunnel] reintentando en ${wait}ms (intento ${attempt})...`);
    await waitFor(wait);
  }
}

loop().catch(error => {
  console.error('[tunnel] fallo critico:', error);
  process.exit(1);
});
