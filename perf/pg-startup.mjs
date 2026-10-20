// Arranque del server contra un Postgres REAL: cuántos viajes a la base hace
// antes de quedar listo y cuánto tarda. En producción cada viaje es sincrónico
// (pg-sync) y cuesta la latencia a Supabase (~22 ms de media medida en
// pg_stat_statements), así que el número de viajes manda.
//
//   docker run -d --rm --name techasset-pgstart -e POSTGRES_PASSWORD=pgtest -e POSTGRES_DB=techasset \
//     -p 127.0.0.1:55444:5432 postgres:17-alpine -c shared_preload_libraries=pg_stat_statements
//   PG_TEST_URL="postgresql://postgres:pgtest@127.0.0.1:55444/techasset?sslmode=disable" \
//     node perf/pg-startup.mjs --repos=<checkoutA>,<checkoutB> [--runs=5]
//
// La primera vuelta (descartada) crea el esquema; después alterna los checkouts
// (A, B, A, B…) sobre la misma base ya migrada, como un reinicio de producción.
// Nunca apuntarlo a producción: crea tablas y datos semilla.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { freePort } from '../e2e/lib/env.mjs';

const url = process.env.PG_TEST_URL;
if (!url || /supabase|pooler|amazonaws/i.test(url)) {
  console.error('PG_TEST_URL tiene que ser un Postgres local de pruebas (nunca el de producción).');
  process.exit(2);
}
const option = (name, fallback) => {
  const found = process.argv.slice(2).find(arg => arg.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : fallback;
};
const repos = String(option('repos', '')).split(',').filter(Boolean).map(repo => path.resolve(repo));
const RUNS = Number(option('runs', 5));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const median = values => { const s = [...values].sort((a, b) => a - b); const n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };

const admin = new pg.Client({ connectionString: url, ssl: false });
await admin.connect();
await admin.query('CREATE EXTENSION IF NOT EXISTS pg_stat_statements');

async function boot(repo) {
  const port = await freePort();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'techasset-pgstart-'));
  await admin.query('SELECT pg_stat_statements_reset()');
  const started = performance.now();
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: repo,
    env: { ...process.env, PORT: String(port), SERVER_HOST: '127.0.0.1', DATABASE_URL: url, DB_DRIVER: 'postgres', MODO_PRUEBA: 'true',
      SMTP_SERVER: '', SMTP_USER: '', SMTP_APP_PASSWORD: '', RESEND_API_KEY: '', GOOGLE_SHEET_CSV_URL: '', OPENAI_API_KEY: '', ANTHROPIC_API_KEY: '', AI_PROVIDER: 'local',
      BOOTSTRAP_SITES: 'NFPT:Northfield Puertos,NFND:Northfield Nordelta', DEFAULT_SITE_CODE: 'NFPT',
      UPLOADS_DIR: path.join(tmpDir, 'uploads'), TOOLS_TEMP_DIR: path.join(tmpDir, 'tools'),
      CACHE_CSV_PATH: path.join(tmpDir, 'cache_sheet.csv'), DEVICES_APP_CSV_PATH: path.join(tmpDir, 'devices_app.csv') },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  let readyMs = null;
  for (let i = 0; i < 1200 && child.exitCode === null; i += 1) {
    try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) { readyMs = performance.now() - started; break; } } catch { /* todavía no */ }
    await sleep(25);
  }
  // Pedido al worker de fondo y a pg_stat_statements: solo cuenta lo de este proceso hasta "listo".
  const stats = (await admin.query(`
    SELECT COALESCE(SUM(calls),0)::int AS calls,
           COALESCE(SUM(calls) FILTER (WHERE query ILIKE '%information_schema%'),0)::int AS schema_calls,
           COALESCE(SUM(total_exec_time),0)::float AS exec_ms
    FROM pg_stat_statements
    WHERE query NOT ILIKE '%pg_stat_statements%' AND dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
  `)).rows[0];
  child.kill();
  await new Promise(resolve => { if (child.exitCode !== null) resolve(); else child.once('exit', resolve); });
  for (let i = 0; i < 10; i += 1) { try { fs.rmSync(tmpDir, { recursive: true, force: true }); break; } catch { await sleep(100); } }
  if (readyMs === null) throw new Error(`No arrancó (${repo}):\n${output.slice(-2000)}`);
  return { readyMs: Math.round(readyMs), calls: stats.calls, schemaCalls: stats.schema_calls, execMs: Math.round(stats.exec_ms) };
}

await boot(repos[0]); // crea el esquema (descartada)
const results = Object.fromEntries(repos.map(repo => [repo, []]));
for (let run = 0; run < RUNS; run += 1) {
  for (const repo of repos) {
    const sample = await boot(repo);
    results[repo].push(sample);
    console.log(`${path.basename(repo)} corrida ${run + 1}:`, sample);
  }
}
for (const repo of repos) {
  const list = results[repo];
  console.log(`\n${repo}\n  listo (mediana): ${median(list.map(s => s.readyMs))} ms · viajes a la base: ${median(list.map(s => s.calls))} (information_schema: ${median(list.map(s => s.schemaCalls))}) · tiempo de ejecución en PG: ${median(list.map(s => s.execMs))} ms`);
}
await admin.end();
