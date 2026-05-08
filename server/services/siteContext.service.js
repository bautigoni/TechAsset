import crypto from 'node:crypto';
import { config } from '../config.js';
import { getDb, nowIso } from '../db.js';

export function normalizeSiteCode(value) {
  return String(value || config.defaultSiteCode || 'NFPT').trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_') || 'NFPT';
}

export function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

export function readSessionToken(req) {
  const cookie = String(req.headers.cookie || '');
  const match = cookie.split(';').map(part => part.trim()).find(part => part.startsWith(`${config.sessionCookieName}=`));
  return match ? decodeURIComponent(match.split('=').slice(1).join('=')) : '';
}

export function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const now = nowIso();
  const expires = new Date(Date.now() + 30 * 86400000).toISOString();
  getDb().prepare('INSERT INTO user_sessions (token, user_id, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?)')
    .run(token, userId, now, expires, now);
  return { token, expires };
}

export function clearSession(token) {
  if (token) getDb().prepare('DELETE FROM user_sessions WHERE token=?').run(token);
}

export function getUserSession(req) {
  const token = readSessionToken(req);
  if (!token) return null;
  const row = getDb().prepare(`
    SELECT s.token, s.expires_at, u.*
    FROM user_sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token=? AND u.activo=1
  `).get(token);
  if (!row) return null;
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
    clearSession(token);
    return null;
  }
  getDb().prepare('UPDATE user_sessions SET last_seen_at=? WHERE token=?').run(nowIso(), token);
  return {
    token,
    user: {
      id: row.id,
      email: row.email,
      nombre: row.nombre,
      rolGlobal: row.rol_global,
      activo: Boolean(row.activo)
    },
    sites: getUserSites(row.id)
  };
}

export function getUserSites(userId) {
  return getDb().prepare(`
    SELECT us.site_code AS siteCode, us.site_role AS siteRole, us.turno, us.is_default AS isDefault,
           s.nombre, s.subtitulo, s.theme_color AS themeColor
    FROM user_sites us LEFT JOIN sites s ON s.site_code=us.site_code
    WHERE us.user_id=? AND us.activo=1 AND COALESCE(s.activo,1)=1
    ORDER BY us.is_default DESC, us.site_code
  `).all(userId).map(row => ({
    siteCode: row.siteCode,
    siteRole: row.siteRole || 'Consulta',
    turno: row.turno || 'Sin turno',
    isDefault: Boolean(row.isDefault),
    nombre: row.nombre || row.siteCode,
    subtitulo: row.subtitulo || '',
    themeColor: row.themeColor || ''
  }));
}

export function isAdminUser(user) {
  return ['Jefe TIC', 'Admin', 'Administrador'].includes(String(user?.rolGlobal || user?.rol_global || ''));
}

export function getAllowedSitesForAllowedUser(allowed) {
  const rows = getDb().prepare(`
    SELECT aus.site_code AS siteCode, aus.site_role AS siteRole, aus.turno, aus.is_default AS isDefault,
           s.nombre, s.subtitulo, s.theme_color AS themeColor
    FROM allowed_user_sites aus LEFT JOIN sites s ON s.site_code=aus.site_code
    WHERE aus.allowed_user_id=? AND aus.activo=1 AND COALESCE(s.activo,1)=1
    ORDER BY aus.is_default DESC, aus.site_code
  `).all(allowed.id);
  if (rows.length) return rows;
  if (isAdminUser({ rolGlobal: allowed.default_role })) {
    const sites = getDb().prepare('SELECT site_code AS siteCode, nombre, subtitulo, theme_color AS themeColor FROM sites WHERE activo=1 ORDER BY site_code').all();
    if (sites.length) return sites.map((site, index) => ({ ...site, siteRole: allowed.default_role || 'Jefe TIC', turno: 'Todo el día', isDefault: index === 0 ? 1 : 0 }));
  }
  return [{
    siteCode: normalizeSiteCode(config.defaultSiteCode),
    siteRole: allowed.default_role || 'Consulta',
    turno: 'Sin turno',
    isDefault: 1,
    nombre: normalizeSiteCode(config.defaultSiteCode),
    subtitulo: '',
    themeColor: ''
  }];
}

export function resolveRequestSite(req, session) {
  const requested = normalizeSiteCode(req.headers['x-site-code'] || req.query.site || req.body?.siteCode || req.body?.site_code);
  const sites = session?.sites || [];
  const fallback = sites.find(site => site.isDefault) || sites[0];
  const match = sites.find(site => normalizeSiteCode(site.siteCode) === requested);
  if (match) return match.siteCode;
  if (!req.headers['x-site-code'] && !req.query.site && !req.body?.siteCode && !req.body?.site_code && fallback) return fallback.siteCode;
  return '';
}

export function authMiddleware(req, res, next) {
  const session = getUserSession(req);
  if (!session) return res.status(401).json({ ok: false, error: 'Necesitás iniciar sesión.' });
  const siteCode = resolveRequestSite(req, session);
  if (!siteCode) return res.status(403).json({ ok: false, error: 'No tenés permiso para esta sede.' });
  req.user = session.user;
  req.userSites = session.sites;
  req.siteCode = normalizeSiteCode(siteCode);
  next();
}

export function requireSite(req) {
  return normalizeSiteCode(req.siteCode || req.headers['x-site-code'] || req.query.site || req.body?.siteCode || req.body?.site_code);
}

export function upsertLoginUser(allowed, profile = {}) {
  const db = getDb();
  const ts = nowIso();
  const email = normalizeEmail(allowed.email);
  const existing = db.prepare('SELECT * FROM users WHERE email=?').get(email);
  const nombre = String(profile.nombre || allowed.nombre || email.split('@')[0]).trim();
  if (existing) {
    db.prepare('UPDATE users SET nombre=?, rol_global=?, activo=1, last_login_at=?, updated_at=? WHERE id=?')
      .run(nombre, allowed.default_role || existing.rol_global || 'Consulta', ts, ts, existing.id);
  } else {
    db.prepare('INSERT INTO users (email, nombre, rol_global, activo, last_login_at, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?, ?)')
      .run(email, nombre, allowed.default_role || 'Consulta', ts, ts, ts);
  }
  const user = db.prepare('SELECT * FROM users WHERE email=?').get(email);
  const allowedSites = getAllowedSitesForAllowedUser(allowed);
  const requested = Array.isArray(profile.siteCodes) && profile.siteCodes.length
    ? profile.siteCodes.map(normalizeSiteCode)
    : profile.siteCode ? [normalizeSiteCode(profile.siteCode)] : [];
  const selectedAllowedSites = requested.length
    ? allowedSites.filter(site => requested.includes(normalizeSiteCode(site.siteCode)))
    : allowedSites;
  const effectiveSites = selectedAllowedSites.length ? selectedAllowedSites : allowedSites;
  const siteRole = allowed.can_choose_role ? String(profile.role || allowed.default_role || 'Consulta') : (allowed.default_role || 'Consulta');
  const turno = String(profile.turno || '');
  const insertSite = db.prepare(`
    INSERT INTO user_sites (user_id, site_code, site_role, turno, is_default, activo, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?)
    ON CONFLICT(user_id, site_code) DO UPDATE SET site_role=excluded.site_role, turno=excluded.turno, activo=1, updated_at=excluded.updated_at
  `);
  effectiveSites.forEach((site, index) => insertSite.run(
    user.id,
    normalizeSiteCode(site.siteCode),
    site.siteRole || siteRole,
    turno || site.turno || 'Sin turno',
    site.isDefault || index === 0 ? 1 : 0,
    ts,
    ts
  ));
  return user;
}
