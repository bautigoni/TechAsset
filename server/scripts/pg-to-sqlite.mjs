#!/usr/bin/env node
// Copia TODA la base Postgres (Supabase) a un archivo SQLite nuevo y verifica
// tabla por tabla. Solo lee Postgres: Supabase queda intacto.
//
//   DATABASE_URL="postgresql://..." node server/scripts/pg-to-sqlite.mjs --out data/techasset.db [--force]
//
// En el servidor nuevo no hace falta correrlo a mano: con IMPORT_FROM_DATABASE_URL
// e IMPORT_ID la app lo hace sola al arrancar (ver server/index.js).
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const option = (name, fallback = '') => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const connectionString = option('--from', process.env.DATABASE_URL || '');
const out = path.resolve(option('--out', 'data/techasset.db'));
if (!connectionString) {
  console.error('✖ Falta la conexión: DATABASE_URL="postgresql://..." o --from "postgresql://...".');
  process.exit(1);
}
for (const file of [out, `${out}-wal`, `${out}-shm`]) {
  if (!fs.existsSync(file)) continue;
  if (!args.includes('--force')) {
    console.error(`✖ Ya existe ${file}. Movelo a otro lado o usá --force para pisarlo.`);
    process.exit(1);
  }
  fs.rmSync(file);
}

process.env.DB_DRIVER = 'sqlite';
process.env.SQLITE_DB_PATH = out;
delete process.env.DATABASE_URL;
const { getDb } = await import('../db.js');
const { importPostgresIntoSqlite } = await import('../services/pgImport.service.js');
const lite = getDb();
const result = await importPostgresIntoSqlite({ connectionString, lite });
lite.pragma('wal_checkpoint(TRUNCATE)');
lite.close();
if (!result.ok) {
  console.error(`✖ No coincide todo. NO uses ${out}.`);
  process.exit(1);
}
console.log(`✔ Listo: ${out}`);
