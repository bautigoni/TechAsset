import { Router } from 'express';
import { getDb, nowIso, seedDefaultSettings, seedInitialInventory } from '../db.js';
import { isSiteManager, isSuperadmin, normalizeSiteCode, requireSite } from '../services/siteContext.service.js';

export const sitesRouter = Router();

const ALLOWED_USER_ROLES = new Set(['Superadmin', 'Jefe TIC', 'Asistente TIC mañana', 'Asistente TIC tarde', 'Asistente TIC general', 'Consulta', 'Otro']);

function getAllowedRole(rawRole = 'Consulta') {
  const role = String(rawRole || 'Consulta').trim();
  return ALLOWED_USER_ROLES.has(role) ? role : 'Consulta';
}

function assertAssignableRole(req, role) {
  if (role === 'Superadmin' && !isSuperadmin(req.user)) {
    const error = new Error('Solo Superadmin puede asignar el rol Superadmin.');
    error.statusCode = 403;
    throw error;
  }
}

sitesRouter.get('/sites', (req, res) => {
  if (isSuperadmin(req.user)) {
    const rows = getDb().prepare('SELECT * FROM sites ORDER BY site_code').all();
    return res.json({ ok: true, items: rows.map(rowToSite) });
  }
  const allowed = new Set((req.userSites || []).map(site => normalizeSiteCode(site.siteCode)));
  const rows = getDb().prepare('SELECT * FROM sites WHERE activo=1 ORDER BY site_code').all()
    .filter(row => allowed.has(normalizeSiteCode(row.site_code)));
  res.json({ ok: true, items: rows.map(rowToSite) });
});

sitesRouter.get('/site-settings', (req, res) => {
  const siteCode = requireSite(req);
  res.json({ ok: true, siteCode, settings: loadSiteSettings(siteCode) });
});

sitesRouter.patch('/site-settings', (req, res) => {
  const siteCode = requireSite(req);
  if (!isSiteManager(req, siteCode)) return res.status(403).json({ ok: false, error: 'No tenés permiso para editar esta sede.' });
  const body = req.body || {};
  const ts = nowIso();
  const stmt = getDb().prepare(`
    INSERT INTO site_settings (site_code, key, value_json, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(site_code, key) DO UPDATE SET value_json=excluded.value_json, updated_at=excluded.updated_at
  `);
  for (const [key, value] of Object.entries(body.settings || body)) {
    if (key === 'siteCode' || key === 'site_code') continue;
    stmt.run(siteCode, key, JSON.stringify(value), ts);
  }
  res.json({ ok: true, siteCode, settings: loadSiteSettings(siteCode) });
});

sitesRouter.post('/sites', (req, res) => {
  if (!isSuperadmin(req.user)) return res.status(403).json({ ok: false, error: 'Solo Superadmin puede administrar sedes.' });
  const siteCode = normalizeSiteCode(req.body?.siteCode || req.body?.site_code);
  if (!siteCode) return res.status(400).json({ ok: false, error: 'Falta site_code.' });
  const ts = nowIso();
  getDb().prepare(`
    INSERT INTO sites (site_code, nombre, subtitulo, logo, activo, spreadsheet_url, apps_script_url, inventory_sheet_name, theme_color, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(site_code) DO UPDATE SET nombre=excluded.nombre, subtitulo=excluded.subtitulo, logo=excluded.logo,
      spreadsheet_url=excluded.spreadsheet_url, apps_script_url=excluded.apps_script_url, inventory_sheet_name=excluded.inventory_sheet_name,
      theme_color=excluded.theme_color, updated_at=excluded.updated_at
  `).run(siteCode, req.body?.nombre || siteCode, req.body?.subtitulo || '', req.body?.logo || '', req.body?.activo === false ? 0 : 1, req.body?.spreadsheetUrl || '', req.body?.appsScriptUrl || '', req.body?.inventorySheetName || '', req.body?.themeColor || '', ts, ts);
  seedDefaultSettings(getDb(), siteCode);
  seedInitialInventory(getDb(), siteCode);
  if (req.user?.id) {
    getDb().prepare(`
      INSERT INTO user_sites (user_id, site_code, site_role, turno, is_default, activo, created_at, updated_at)
      VALUES (?, ?, ?, ?, 0, 1, ?, ?)
      ON CONFLICT(user_id, site_code) DO UPDATE SET activo=1, updated_at=excluded.updated_at
    `).run(req.user.id, siteCode, req.user.rolGlobal || 'Jefe TIC', 'Sin turno', ts, ts);
  }
  res.json({ ok: true, item: rowToSite(getDb().prepare('SELECT * FROM sites WHERE site_code=?').get(siteCode)) });
});

sitesRouter.patch('/sites/:siteCode', (req, res) => {
  const siteCode = normalizeSiteCode(req.params.siteCode);
  if (!isSuperadmin(req.user) && !isSiteManager(req, siteCode)) return res.status(403).json({ ok: false, error: 'No tenés permiso para administrar esta sede.' });
  const old = getDb().prepare('SELECT * FROM sites WHERE site_code=?').get(siteCode);
  if (!old) return res.status(404).json({ ok: false, error: 'Sede no encontrada.' });
  getDb().prepare(`
    UPDATE sites SET nombre=?, subtitulo=?, logo=?, activo=?, spreadsheet_url=?, apps_script_url=?, inventory_sheet_name=?, theme_color=?, updated_at=?
    WHERE site_code=?
  `).run(
    req.body?.nombre ?? old.nombre,
    req.body?.subtitulo ?? old.subtitulo,
    req.body?.logo ?? old.logo,
    req.body?.activo == null ? old.activo : (req.body.activo ? 1 : 0),
    req.body?.spreadsheetUrl ?? req.body?.spreadsheet_url ?? old.spreadsheet_url,
    req.body?.appsScriptUrl ?? req.body?.apps_script_url ?? old.apps_script_url,
    req.body?.inventorySheetName ?? req.body?.inventory_sheet_name ?? old.inventory_sheet_name,
    req.body?.themeColor ?? req.body?.theme_color ?? old.theme_color,
    nowIso(),
    siteCode
  );
  res.json({ ok: true, item: rowToSite(getDb().prepare('SELECT * FROM sites WHERE site_code=?').get(siteCode)) });
});

sitesRouter.get('/allowed-users', (req, res) => {
  const siteCode = requireSite(req);
  if (!isSiteManager(req, siteCode)) return res.status(403).json({ ok: false, error: 'No tenés permiso para administrar usuarios de esta sede.' });
  const rows = isSuperadmin(req.user)
    ? getDb().prepare('SELECT id, email, nombre, default_role AS defaultRole, can_choose_role AS canChooseRole, activo FROM allowed_users ORDER BY email').all()
    : getDb().prepare(`
      SELECT au.id, au.email, au.nombre, au.default_role AS defaultRole, au.can_choose_role AS canChooseRole, au.activo
      FROM allowed_users au
      JOIN allowed_user_sites aus ON aus.allowed_user_id=au.id
      WHERE aus.site_code=? AND aus.activo=1 AND au.default_role <> 'Superadmin'
      ORDER BY au.email
    `).all(siteCode);
  res.json({ ok: true, items: rows.map(row => ({
    ...row,
    canChooseRole: Boolean(row.canChooseRole),
    activo: Boolean(row.activo),
    sites: isSuperadmin(req.user) ? getAllowedUserSites(row.id) : getAllowedUserSites(row.id).filter(site => normalizeSiteCode(site.siteCode) === siteCode)
  })) });
});

sitesRouter.get('/site-assistants', (req, res) => {
  const siteCode = requireSite(req);
  const rows = getDb().prepare(`
    SELECT u.nombre, u.email, us.site_role AS siteRole, us.turno
    FROM user_sites us
    JOIN users u ON u.id=us.user_id
    WHERE us.site_code=? AND us.activo=1 AND u.activo=1
      AND lower(COALESCE(us.site_role,'')) LIKE '%asistente%'
    UNION
    SELECT au.nombre, au.email, aus.site_role AS siteRole, aus.turno
    FROM allowed_user_sites aus
    JOIN allowed_users au ON au.id=aus.allowed_user_id
    WHERE aus.site_code=? AND aus.activo=1 AND au.activo=1
      AND lower(COALESCE(aus.site_role,'')) LIKE '%asistente%'
    ORDER BY nombre, email
  `).all(siteCode, siteCode);
  const seen = new Set();
  const items = rows.map(row => ({
    name: String(row.nombre || row.email || '').trim(),
    email: row.email,
    siteRole: row.siteRole || 'Asistente TIC',
    turno: row.turno || 'Sin turno'
  })).filter(row => {
    const key = String(row.email || row.name).toLowerCase();
    if (!row.name || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  res.json({ ok: true, items });
});

sitesRouter.post('/allowed-users', (req, res) => {
  const siteCode = requireSite(req);
  if (!isSiteManager(req, siteCode)) return res.status(403).json({ ok: false, error: 'No tenés permiso para administrar usuarios de esta sede.' });
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!email.includes('@')) return res.status(400).json({ ok: false, error: 'Mail inválido.' });
  const existingAllowed = getDb().prepare('SELECT default_role FROM allowed_users WHERE lower(email)=?').get(email);
  if (existingAllowed?.default_role === 'Superadmin' && !isSuperadmin(req.user)) {
    return res.status(403).json({ ok: false, error: 'Solo Superadmin puede editar otro Superadmin.' });
  }
  const defaultRole = getAllowedRole(req.body?.defaultRole || req.body?.default_role || 'Consulta');
  try { assertAssignableRole(req, defaultRole); }
  catch (error) { return res.status(error.statusCode || 400).json({ ok: false, error: error.message }); }
  const ts = nowIso();
  getDb().prepare(`
    INSERT INTO allowed_users (email, nombre, default_role, can_choose_role, activo, created_at, updated_at)
    VALUES (?, ?, ?, ?, 1, ?, ?)
    ON CONFLICT(email) DO UPDATE SET nombre=excluded.nombre, default_role=excluded.default_role, can_choose_role=excluded.can_choose_role, activo=excluded.activo, updated_at=excluded.updated_at
  `).run(email, req.body?.nombre || '', defaultRole, req.body?.canChooseRole ? 1 : 0, ts, ts);
  const allowed = getDb().prepare('SELECT * FROM allowed_users WHERE lower(email)=?').get(email);
  if (isSuperadmin(req.user)) {
    saveAllowedUserSites(allowed.id, req.body?.sites || req.body?.siteCodes || [], req.body?.defaultSiteCode || req.body?.defaultSite || '', defaultRole, req.body?.turno || 'Sin turno');
  } else {
    upsertAllowedUserSite(allowed.id, siteCode, defaultRole, req.body?.turno || 'Sin turno');
  }
  syncExistingUserSites(email, allowed);
  res.json({ ok: true, item: { ...allowed, sites: getAllowedUserSites(allowed.id) } });
});

sitesRouter.patch('/allowed-users/:id', (req, res) => {
  const siteCode = requireSite(req);
  if (!isSiteManager(req, siteCode)) return res.status(403).json({ ok: false, error: 'No tenés permiso para administrar usuarios de esta sede.' });
  const old = getDb().prepare('SELECT * FROM allowed_users WHERE id=?').get(req.params.id);
  if (!old) return res.status(404).json({ ok: false, error: 'Usuario permitido no encontrado.' });
  if (old.default_role === 'Superadmin' && !isSuperadmin(req.user)) {
    return res.status(403).json({ ok: false, error: 'Solo Superadmin puede editar otro Superadmin.' });
  }
  const defaultRole = getAllowedRole(req.body?.defaultRole ?? req.body?.default_role ?? old.default_role);
  try { assertAssignableRole(req, defaultRole); }
  catch (error) { return res.status(error.statusCode || 400).json({ ok: false, error: error.message }); }
  const ts = nowIso();
  getDb().prepare(`
    UPDATE allowed_users SET email=?, nombre=?, default_role=?, can_choose_role=?, activo=?, updated_at=? WHERE id=?
  `).run(
    String(req.body?.email || old.email).trim().toLowerCase(),
    req.body?.nombre ?? old.nombre,
    defaultRole,
    req.body?.canChooseRole == null ? old.can_choose_role : (req.body.canChooseRole ? 1 : 0),
    req.body?.activo == null ? old.activo : (req.body.activo ? 1 : 0),
    ts,
    req.params.id
  );
  const updated = getDb().prepare('SELECT * FROM allowed_users WHERE id=?').get(req.params.id);
  if (isSuperadmin(req.user) && (Array.isArray(req.body?.sites) || Array.isArray(req.body?.siteCodes))) {
    saveAllowedUserSites(updated.id, req.body?.sites || req.body?.siteCodes || [], req.body?.defaultSiteCode || req.body?.defaultSite || '', updated.default_role, req.body?.turno || 'Sin turno');
  } else if (!isSuperadmin(req.user)) {
    upsertAllowedUserSite(updated.id, siteCode, updated.default_role, req.body?.turno || 'Sin turno');
  }
  syncExistingUserSites(updated.email, updated);
  res.json({ ok: true, item: { ...updated, sites: getAllowedUserSites(updated.id) } });
});

export function loadSiteSettings(siteCode) {
  const rows = getDb().prepare('SELECT key, value_json FROM site_settings WHERE site_code=?').all(siteCode);
  const settings = {};
  for (const row of rows) {
    try { settings[row.key] = JSON.parse(row.value_json || 'null'); }
    catch { settings[row.key] = row.value_json; }
  }
  return settings;
}

function rowToSite(row) {
  return {
    siteCode: row.site_code,
    nombre: row.nombre || row.site_code,
    subtitulo: row.subtitulo || '',
    logo: row.logo || '',
    activo: Boolean(row.activo),
    spreadsheetUrl: row.spreadsheet_url || '',
    appsScriptUrl: row.apps_script_url || '',
    inventorySheetName: row.inventory_sheet_name || '',
    themeColor: row.theme_color || ''
  };
}

function getAllowedUserSites(allowedUserId) {
  const allowed = getDb().prepare('SELECT default_role FROM allowed_users WHERE id=?').get(allowedUserId);
  if (isSuperadmin({ rolGlobal: allowed?.default_role })) {
    return getDb().prepare('SELECT site_code AS siteCode FROM sites WHERE activo=1 ORDER BY site_code')
      .all()
      .map((row, index) => ({ siteCode: row.siteCode, siteRole: 'Superadmin', turno: 'Todo el día', isDefault: index === 0, activo: true }));
  }
  return getDb().prepare('SELECT site_code AS siteCode, site_role AS siteRole, turno, is_default AS isDefault, activo FROM allowed_user_sites WHERE allowed_user_id=? ORDER BY is_default DESC, site_code')
    .all(allowedUserId)
    .map(row => ({ ...row, isDefault: Boolean(row.isDefault), activo: Boolean(row.activo) }));
}

function saveAllowedUserSites(allowedUserId, rawSites, defaultSiteCode, defaultRole, defaultTurno) {
  const siteItems = normalizeSiteItems(rawSites, defaultRole, defaultTurno);
  const fallback = siteItems.length ? siteItems : [{ siteCode: normalizeSiteCode(defaultSiteCode || 'NFPT'), siteRole: defaultRole || 'Consulta', turno: defaultTurno || 'Sin turno' }];
  const selectedDefault = normalizeSiteCode(defaultSiteCode || fallback[0].siteCode);
  const ts = nowIso();
  getDb().prepare('UPDATE allowed_user_sites SET activo=0, updated_at=? WHERE allowed_user_id=?').run(ts, allowedUserId);
  const stmt = getDb().prepare(`
    INSERT INTO allowed_user_sites (allowed_user_id, site_code, site_role, turno, is_default, activo, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?)
    ON CONFLICT(allowed_user_id, site_code) DO UPDATE SET site_role=excluded.site_role, turno=excluded.turno, is_default=excluded.is_default, activo=1, updated_at=excluded.updated_at
  `);
  for (const item of fallback) {
    stmt.run(allowedUserId, item.siteCode, item.siteRole, item.turno, item.siteCode === selectedDefault ? 1 : 0, ts, ts);
  }
}

function upsertAllowedUserSite(allowedUserId, siteCode, siteRole, turno) {
  const ts = nowIso();
  getDb().prepare(`
    INSERT INTO allowed_user_sites (allowed_user_id, site_code, site_role, turno, is_default, activo, created_at, updated_at)
    VALUES (?, ?, ?, ?, 1, 1, ?, ?)
    ON CONFLICT(allowed_user_id, site_code) DO UPDATE SET site_role=excluded.site_role, turno=excluded.turno, activo=1, updated_at=excluded.updated_at
  `).run(allowedUserId, normalizeSiteCode(siteCode), siteRole || 'Consulta', turno || 'Sin turno', ts, ts);
}

function normalizeSiteItems(rawSites, defaultRole, defaultTurno) {
  const list = Array.isArray(rawSites) ? rawSites : [];
  return list.map(item => {
    if (typeof item === 'string') return { siteCode: normalizeSiteCode(item), siteRole: defaultRole || 'Consulta', turno: defaultTurno || 'Sin turno' };
    return {
      siteCode: normalizeSiteCode(item.siteCode || item.site_code),
      siteRole: item.siteRole || item.site_role || defaultRole || 'Consulta',
      turno: item.turno || defaultTurno || 'Sin turno'
    };
  }).filter(item => item.siteCode);
}

function syncExistingUserSites(email, allowed) {
  const user = getDb().prepare('SELECT * FROM users WHERE lower(email)=?').get(String(email).toLowerCase());
  if (!user) return;
  const sites = getAllowedUserSites(allowed.id).filter(site => site.activo);
  const ts = nowIso();
  getDb().prepare('UPDATE users SET rol_global=?, activo=?, updated_at=? WHERE id=?').run(allowed.default_role || 'Consulta', allowed.activo === 0 ? 0 : 1, ts, user.id);
  getDb().prepare('UPDATE user_sites SET activo=0, updated_at=? WHERE user_id=?').run(ts, user.id);
  const stmt = getDb().prepare(`
    INSERT INTO user_sites (user_id, site_code, site_role, turno, is_default, activo, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?)
    ON CONFLICT(user_id, site_code) DO UPDATE SET site_role=excluded.site_role, turno=excluded.turno, is_default=excluded.is_default, activo=1, updated_at=excluded.updated_at
  `);
  for (const site of sites) stmt.run(user.id, site.siteCode, site.siteRole || allowed.default_role, site.turno || 'Sin turno', site.isDefault ? 1 : 0, ts, ts);
}
