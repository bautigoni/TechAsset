// Copia TODA una base Postgres (Supabase) a la base SQLite de la app y verifica
// que cada tabla quede con la misma cantidad de filas. Solo lee Postgres.
//
// La usan:
//  - el arranque (server/index.js) cuando está IMPORT_FROM_DATABASE_URL: así el
//    corte de Supabase a SQLite se hace en el servidor nuevo, al final, sin
//    mover archivos;
//  - server/scripts/pg-to-sqlite.mjs, para hacerlo a mano.
import pg from 'pg';

const quote = id => `"${String(id).replace(/"/g, '""')}"`;

function toLite(value) {
  if (value === undefined) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value) || (value && typeof value === 'object' && !Buffer.isBuffer(value))) return JSON.stringify(value);
  return value;
}

// Tipos de Postgres → los valores que guardaba la app con better-sqlite3.
const TYPE_PARSERS = {
  20: v => Number(v),                                  // bigint
  1700: v => Number(v),                                // numeric
  1184: v => new Date(v).toISOString(),                // timestamptz
  1114: v => String(v).replace(' ', 'T'),              // timestamp
  1082: v => v,                                        // date
  114: v => v,                                         // json → texto
  3802: v => v                                         // jsonb → texto
};

/**
 * @param {object} opts
 * @param {string} opts.connectionString  Postgres de origen.
 * @param {import('better-sqlite3').Database} opts.lite  Base SQLite ya inicializada (initDb).
 * @param {(line: string) => void} [opts.log]
 * @returns {Promise<{ ok: boolean, tables: number, rows: number, report: object[], warnings: string[], integrity: string }>}
 */
export async function importPostgresIntoSqlite({ connectionString, lite, log = console.log }) {
  const types = { getTypeParser: (oid, format) => (TYPE_PARSERS[oid] ? (v => (v === null ? null : TYPE_PARSERS[oid](v))) : pg.types.getTypeParser(oid, format)) };
  const client = new pg.Client({
    connectionString,
    ssl: /[?&]sslmode=disable\b/.test(connectionString) ? false : { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
    types
  });
  await client.connect();
  const report = [];
  const warnings = [];
  try {
    // Una sola foto consistente de toda la base, aunque alguien siga escribiendo.
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const pgTables = (await client.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `)).rows.map(row => row.table_name);
    const liteTables = new Set(lite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(row => row.name));
    lite.pragma('foreign_keys = OFF');

    for (const table of pgTables) {
      const columns = (await client.query(`
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = $1 ORDER BY ordinal_position
      `, [table])).rows.map(row => row.column_name);
      if (!liteTables.has(table)) {
        lite.exec(`CREATE TABLE ${quote(table)} (${columns.map(quote).join(', ')})`);
        warnings.push(`tabla ${table}: no la crea la app actual; se copió igual`);
      } else {
        const liteColumns = new Set(lite.prepare(`PRAGMA table_info(${quote(table)})`).all().map(col => col.name));
        for (const column of columns) {
          if (liteColumns.has(column)) continue;
          lite.exec(`ALTER TABLE ${quote(table)} ADD COLUMN ${quote(column)}`);
          warnings.push(`columna ${table}.${column}: no la crea la app actual; se copió igual`);
        }
      }
      const rows = (await client.query(`SELECT ${columns.map(quote).join(', ')} FROM ${quote(table)}`)).rows;
      const insert = lite.prepare(`INSERT INTO ${quote(table)} (${columns.map(quote).join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`);
      lite.transaction(() => {
        // Lo que sembró initDb (settings por defecto, columnas de tareas…) se
        // reemplaza por lo que hay en producción.
        lite.prepare(`DELETE FROM ${quote(table)}`).run();
        for (const row of rows) insert.run(...columns.map(column => toLite(row[column])));
      })();
      const count = lite.prepare(`SELECT COUNT(*) AS n FROM ${quote(table)}`).get().n;
      report.push({ table, postgres: rows.length, sqlite: count, ok: rows.length === count });
    }
    for (const table of liteTables) {
      if (!pgTables.includes(table)) warnings.push(`tabla ${table}: no existe en Postgres; queda como la crea la app`);
    }
    await client.query('COMMIT');
  } finally {
    await client.end().catch(() => undefined);
    lite.pragma('foreign_keys = ON');
  }
  const integrity = lite.pragma('integrity_check', { simple: true });
  const width = Math.max(10, ...report.map(row => row.table.length));
  for (const row of report) log(`${row.table.padEnd(width)} ${String(row.postgres).padStart(8)} ${String(row.sqlite).padStart(8)}${row.ok ? '' : '  ✖ NO COINCIDE'}`);
  for (const warning of warnings) log(`⚠ ${warning}`);
  const rows = report.reduce((sum, row) => sum + row.postgres, 0);
  const ok = report.every(row => row.ok) && integrity === 'ok';
  log(`${ok ? '✔' : '✖'} ${report.length} tablas, ${rows} filas · integridad SQLite: ${integrity}`);
  return { ok, tables: report.length, rows, report, warnings, integrity };
}
