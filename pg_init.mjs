// Dispara initDb() contra Postgres (construye el esquema vía la app) y hace un sanity check.
import { getDb } from './server/db.js';
try {
  const db = getDb();
  console.log('INIT_OK');
  for (const t of ['sites', 'users', 'allowed_users', 'device_categories', 'site_settings', 'agenda', 'inventory_items', 'tickets', 'invites', 'loan_events']) {
    try { console.log('  ' + t.padEnd(20) + db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n); }
    catch (e) { console.log('  ' + t.padEnd(20) + 'ERR ' + e.message); }
  }
  process.exit(0);
} catch (e) {
  console.error('INIT_FAIL:', e.message);
  console.error(e.stack);
  process.exit(1);
}
