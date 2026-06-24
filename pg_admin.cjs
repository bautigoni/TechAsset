// Helper de administración Postgres para la migración.
//   node pg_admin.cjs drop  "<url>"   -> dropea TODAS las tablas de public (clean slate)
//   node pg_admin.cjs list  "<url>"   -> lista tablas + conteos
const { Client } = require('pg');
const cmd = process.argv[2];
const url = process.argv[3] || process.env.DATABASE_URL;

(async () => {
  const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await c.connect();
  if (cmd === 'drop') {
    const t = (await c.query("SELECT tablename FROM pg_tables WHERE schemaname='public'")).rows;
    for (const r of t) await c.query(`DROP TABLE IF EXISTS "${r.tablename}" CASCADE`);
    console.log('dropped', t.length, 'tablas');
  } else if (cmd === 'list') {
    const t = (await c.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY 1")).rows;
    let total = 0;
    for (const r of t) {
      const n = (await c.query(`SELECT COUNT(*)::int AS n FROM "${r.tablename}"`)).rows[0].n;
      total += n;
      console.log('  ' + r.tablename.padEnd(26) + n);
    }
    console.log(`total ${t.length} tablas | ${total} filas`);
  } else {
    console.log('uso: drop | list');
  }
  await c.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
