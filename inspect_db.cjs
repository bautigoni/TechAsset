const Database = require('better-sqlite3');
const path = 'C:/Users/gonib/Downloads/techasset_export/techasset.db';
const db = new Database(path);
// merge WAL into the main db so nothing is lost
db.pragma('wal_checkpoint(TRUNCATE)');
const tables = db.prepare(
  "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
).all();
console.log('TABLAS Y FILAS:');
let total = 0;
for (const t of tables) {
  const c = db.prepare(`SELECT COUNT(*) AS n FROM "${t.name}"`).get().n;
  total += c;
  console.log(`  ${t.name.padEnd(28)} ${c}`);
}
console.log(`\nTotal tablas: ${tables.length} | Total filas: ${total}`);
db.close();
