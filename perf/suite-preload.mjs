// Preload de la suite de benchmarks (node --import). Igual que
// server/scripts/bench/latency-preload.mjs, pero resuelve better-sqlite3 desde el
// checkout que se está midiendo (process.cwd()) y no desde este archivo: así
// funciona aunque ese checkout tenga su propio node_modules.
//
//  1. cuenta cada query que hace el server, y
//  2. le suma una demora SINCRÓNICA por query (BENCH_LATENCY_MS), como producción:
//     pg-sync bloquea el hilo con Atomics.wait mientras la query va y vuelve de Supabase.
// Expone el contador en http://127.0.0.1:$BENCH_STATS_PORT/stats (y /reset).
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(path.join(process.cwd(), 'package.json'));
const Database = require('better-sqlite3');

const latency = Number(process.env.BENCH_LATENCY_MS || 0);
const sleeper = new Int32Array(new SharedArrayBuffer(4));
const stats = { queries: 0, patched: true };

function hit() {
  stats.queries += 1;
  if (latency > 0) Atomics.wait(sleeper, 0, 0, latency);
}

const originalPrepare = Database.prototype.prepare;
Database.prototype.prepare = function prepare(sql) {
  const statement = originalPrepare.call(this, sql);
  for (const method of ['get', 'all', 'run', 'iterate']) {
    const original = statement[method];
    if (typeof original !== 'function') continue;
    statement[method] = function wrapped(...args) {
      hit();
      return original.apply(this, args);
    };
  }
  return statement;
};

const originalExec = Database.prototype.exec;
Database.prototype.exec = function exec(sql) {
  hit();
  return originalExec.call(this, sql);
};

http.createServer((req, res) => {
  if (req.url === '/reset') stats.queries = 0;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(stats));
}).listen(Number(process.env.BENCH_STATS_PORT || 8099), '127.0.0.1');
