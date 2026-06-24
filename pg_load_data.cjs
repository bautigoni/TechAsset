// Carga los datos reales del SQLite rescatado dentro del esquema que YA construyó
// la app en Postgres (preserva PKs/UNIQUEs/constraints). Solo datos: DELETE + INSERT.
//   node pg_load_data.cjs "<pg-url>" [ruta-sqlite]
const Database = require('better-sqlite3');
const { Client } = require('pg');

const PG_URL = process.argv[2] || process.env.DATABASE_URL;
const SQLITE = process.argv[3] || 'C:/Users/gonib/Downloads/techasset_export/techasset.db';
const q = (id) => '"' + id.replace(/"/g, '""') + '"';

(async () => {
  const sdb = new Database(SQLITE, { readonly: true });
  const pg = new Client({ connectionString: PG_URL, ssl: { rejectUnauthorized: false } });
  await pg.connect();

  const sqliteTables = sdb.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  ).all().map(r => r.name);

  await pg.query('BEGIN');
  let grand = 0;
  try {
    for (const table of sqliteTables) {
      // columnas que existen en AMBOS lados (la app pudo agregar/omitir alguna)
      const pgColRows = (await pg.query(
        'SELECT column_name, data_type FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2',
        ['public', table]
      )).rows;
      if (!pgColRows.length) { console.log(`  ${table}: (no existe en PG, omitido)`); continue; }
      const pgSet = new Set(pgColRows.map(r => r.column_name));
      const idRow = pgColRows.find(r => r.column_name === 'id');
      const idIsNumeric = idRow && /int/i.test(idRow.data_type);
      const srcCols = sdb.prepare(`PRAGMA table_info(${q(table)})`).all().map(c => c.name);
      const cols = srcCols.filter(c => pgSet.has(c));
      if (!cols.length) { console.log(`  ${table}: (sin columnas comunes, omitido)`); continue; }

      const rows = sdb.prepare(`SELECT ${cols.map(q).join(',')} FROM ${q(table)}`).all();
      await pg.query(`DELETE FROM ${q(table)}`);
      const colList = cols.map(q).join(', ');
      const BATCH = 300;
      for (let i = 0; i < rows.length; i += BATCH) {
        const slice = rows.slice(i, i + BATCH);
        const values = [];
        const tuples = slice.map((row, ri) => '(' + cols.map((c, ci) => {
          values.push(row[c]);
          return '$' + (ri * cols.length + ci + 1);
        }).join(', ') + ')');
        if (slice.length) {
          await pg.query(`INSERT INTO ${q(table)} (${colList}) VALUES ${tuples.join(', ')}`, values);
        }
      }
      // reajustar secuencia identity solo si id es numérico
      if (idIsNumeric) {
        await pg.query(
          `SELECT setval(pg_get_serial_sequence($1,'id'), GREATEST(COALESCE((SELECT MAX(id) FROM ${q(table)}),1),1))`,
          [table]
        );
      }
      grand += rows.length;
      console.log(`  ${table.padEnd(24)} ${rows.length}`);
    }
    await pg.query('COMMIT');
    console.log(`\nOK: ${grand} filas reales cargadas.`);
  } catch (e) {
    await pg.query('ROLLBACK');
    console.error('ROLLBACK por error:', e.message);
    process.exitCode = 1;
  } finally {
    await pg.end();
    sdb.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
