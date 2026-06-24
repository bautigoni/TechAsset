const Database = require('better-sqlite3');
const db = new Database('C:/Users/gonib/Downloads/techasset_export/techasset.db');
const rows = db.prepare(
  "SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type DESC, name"
).all();
for (const r of rows) {
  console.log(`-- [${r.type}] ${r.name}`);
  console.log(r.sql + ';');
  console.log('');
}
db.close();
