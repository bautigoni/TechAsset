// Aplica server/db/enable_rls.sql contra la Postgres apuntada por DATABASE_URL.
//
// Uso:
//   node server/scripts/enable-rls.mjs
//
// Requiere DATABASE_URL seteada (mismo string que usa el backend). No hace nada
// si estás en modo SQLite (no aplica RLS). Es idempotente: podés correrlo las
// veces que quieras.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import 'dotenv/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sqlPath = path.join(__dirname, '..', 'db', 'enable_rls.sql');

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('[enable-rls] Falta DATABASE_URL. En modo SQLite no hay RLS que aplicar.');
  process.exit(1);
}

const sql = fs.readFileSync(sqlPath, 'utf8');

const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });

try {
  await client.connect();
  await client.query(sql);

  const { rows } = await client.query(
    `SELECT tablename, rowsecurity
     FROM pg_tables
     WHERE schemaname = 'public'
     ORDER BY rowsecurity, tablename`
  );
  const off = rows.filter((r) => !r.rowsecurity);
  const on = rows.filter((r) => r.rowsecurity);
  console.log(`[enable-rls] RLS habilitado en ${on.length} tabla(s) de public.`);
  if (off.length) {
    console.warn(`[enable-rls] AÚN sin RLS: ${off.map((r) => r.tablename).join(', ')}`);
  } else {
    console.log('[enable-rls] Todas las tablas de public tienen RLS activo. ✔');
  }
} catch (err) {
  console.error('[enable-rls] Error aplicando RLS:', err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
