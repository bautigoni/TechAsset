// Preload del benchmark de API (node --import). Envuelve better-sqlite3 para:
//  1. contar cada query que hace el server, y
//  2. sumarle una demora SINCRÓNICA por query (BENCH_LATENCY_MS), que es como se
//     comporta producción: pg-sync bloquea el hilo con Atomics.wait mientras la
//     query viaja a Supabase y vuelve.
// Expone el contador en http://127.0.0.1:$BENCH_STATS_PORT/stats (y /reset).
import http from 'node:http';
import Database from 'better-sqlite3';

const latency = Number(process.env.BENCH_LATENCY_MS || 0);
const sleeper = new Int32Array(new SharedArrayBuffer(4));
const stats = { queries: 0 };

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
