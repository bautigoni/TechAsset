import { getDb, nowIso } from '../db.js';
import { hashPassword } from '../services/password.service.js';

const email = String(process.argv[2] || process.env.TECHASSET_ADMIN_EMAIL || '').trim().toLowerCase();
const password = String(process.argv[3] || process.env.TECHASSET_ADMIN_PASSWORD || '');
const displayName = String(process.argv[4] || process.env.TECHASSET_ADMIN_NAME || 'TechAsset Admin').trim();

if (!email || !email.includes('@')) {
  console.error('Usage: node server/scripts/ensure-superadmin.mjs <email> <password> [displayName]');
  process.exit(1);
}

if (password.length < 6) {
  console.error('Password must have at least 6 characters.');
  process.exit(1);
}

const db = getDb();
const ts = nowIso();
const passwordHash = hashPassword(password);
const sites = db.prepare("SELECT site_code FROM sites WHERE activo=1 ORDER BY site_code").all();
const defaultSite = sites[0]?.site_code || 'NFPT';

db.prepare(`
  INSERT INTO allowed_users (email, nombre, default_role, can_choose_role, status, activo, deleted_at, deleted_by, password_hash, created_at, updated_at)
  VALUES (?, ?, 'Superadmin', 0, 'Activo', 1, '', '', ?, ?, ?)
  ON CONFLICT(email) DO UPDATE SET
    nombre=excluded.nombre,
    default_role='Superadmin',
    can_choose_role=0,
    status='Activo',
    activo=1,
    deleted_at='',
    deleted_by='',
    password_hash=excluded.password_hash,
    updated_at=excluded.updated_at
`).run(email, displayName, passwordHash, ts, ts);

const allowed = db.prepare('SELECT id FROM allowed_users WHERE lower(email)=?').get(email);

for (const [index, site] of sites.entries()) {
  db.prepare(`
    INSERT INTO allowed_user_sites (allowed_user_id, site_code, site_role, turno, is_default, activo, created_at, updated_at)
    VALUES (?, ?, 'Superadmin', 'Todo el dia', ?, 1, ?, ?)
    ON CONFLICT(allowed_user_id, site_code) DO UPDATE SET
      site_role='Superadmin',
      turno='Todo el dia',
      is_default=excluded.is_default,
      activo=1,
      updated_at=excluded.updated_at
  `).run(allowed.id, site.site_code, index === 0 ? 1 : 0, ts, ts);
}

db.prepare(`
  INSERT INTO users (email, nombre, rol_global, activo, created_at, updated_at)
  VALUES (?, ?, 'Superadmin', 1, ?, ?)
  ON CONFLICT(email) DO UPDATE SET
    nombre=excluded.nombre,
    rol_global='Superadmin',
    activo=1,
    updated_at=excluded.updated_at
`).run(email, displayName, ts, ts);

const user = db.prepare('SELECT id FROM users WHERE lower(email)=?').get(email);
if (user) {
  db.prepare(`
    INSERT INTO user_sites (user_id, site_code, site_role, turno, is_default, activo, created_at, updated_at)
    VALUES (?, ?, 'Superadmin', 'Todo el dia', 1, 1, ?, ?)
    ON CONFLICT(user_id, site_code) DO UPDATE SET
      site_role='Superadmin',
      turno='Todo el dia',
      is_default=1,
      activo=1,
      updated_at=excluded.updated_at
  `).run(user.id, defaultSite, ts, ts);
}

console.log(`Superadmin ensured for ${email} on ${Math.max(1, sites.length)} site(s).`);
process.exit(0);
