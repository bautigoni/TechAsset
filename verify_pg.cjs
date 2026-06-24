const { Client } = require('pg');
(async () => {
  const c = new Client({ connectionString: process.argv[2], ssl: { rejectUnauthorized: false } });
  await c.connect();
  const tabs = (await c.query(
    "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename"
  )).rows.map(r => r.tablename);
  let total = 0;
  for (const t of tabs) {
    const n = (await c.query(`SELECT COUNT(*)::int AS n FROM "${t}"`)).rows[0].n;
    total += n;
    console.log(`  ${t.padEnd(28)} ${n}`);
  }
  console.log(`\nTotal en Supabase: ${tabs.length} tablas | ${total} filas`);
  // muestra de datos reales
  const dev = (await c.query('SELECT etiqueta, modelo FROM local_devices LIMIT 3')).rows;
  console.log('\nMuestra local_devices:', JSON.stringify(dev));
  await c.end();
})().catch(e => { console.error(e.message); process.exit(1); });
