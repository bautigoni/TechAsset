import { Router } from 'express';
import { getDb, nowIso, seedDefaultSettings } from '../db.js';
import { isAdminUser, normalizeSiteCode, requireSite } from '../services/siteContext.service.js';

export const sitesRouter = Router();

sitesRouter.get('/sites', (req, res) => {
  if (isAdminUser(req.user)) {
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
  if (!isAdminUser(req.user)) return res.status(403).json({ ok: false, error: 'Solo Jefe TIC puede editar la configuracion de sede.' });
  const siteCode = requireSite(req);
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
  if (!isAdminUser(req.user)) return res.status(403).json({ ok: false, error: 'Solo Jefe TIC puede administrar sedes.' });
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
  if (!isAdminUser(req.user)) return res.status(403).json({ ok: false, error: 'Solo Jefe TIC puede administrar sedes.' });
  const siteCode = normalizeSiteCode(req.params.siteCode);
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
  if (!isAdminUser(req.user)) return res.status(403).json({ ok: false, error: 'Solo Jefe TIC puede administrar usuarios.' });
  const rows = getDb().prepare('SELECT id, email, nombre, default_role AS defaultRole, can_choose_role AS canChooseRole, activo FROM allowed_users ORDER BY email').all();
  res.json({ ok: true, items: rows.map(row => ({
    ...row,
    canChooseRole: Boolean(row.canChooseRole),
    activo: Boolean(row.activo),
    sites: getAllowedUserSites(row.id)
  })) });
});

sitesRouter.post('/allowed-users', (req, res) => {
  if (!isAdminUser(req.user)) return res.status(403).json({ ok: false, error: 'Solo Jefe TIC puede administrar usuarios.' });
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!email.includes('@')) return res.status(400).json({ ok: false, error: 'Mail inválido.' });
  const ts = nowIso();
  getDb().prepare(`
    INSERT INTO allowed_users (email, nombre, default_role, can_choose_role, activo, created_at, updated_at)
    VALUES (?, ?, ?, ?, 1, ?, ?)
    ON CONFLICT(email) DO UPDATE SET nombre=excluded.nombre, default_role=excluded.default_role, can_choose_role=excluded.can_choose_role, activo=excluded.activo, updated_at=excluded.updated_at
  `).run(email, req.body?.nombre || '', req.body?.defaultRole || 'Consulta', req.body?.canChooseRole ? 1 : 0, ts, ts);
  const allowed = getDb().prepare('SELECT * FROM allowed_users WHERE lower(email)=?').get(email);
  saveAllowedUserSites(allowed.id, req.body?.sites || req.body?.siteCodes || [], req.body?.defaultSiteCode || req.body?.defaultSite || '', req.body?.defaultRole || 'Consulta', req.body?.turno || 'Sin turno');
  syncExistingUserSites(email, allowed);
  res.json({ ok: true, item: { ...allowed, sites: getAllowedUserSites(allowed.id) } });
});

sitesRouter.patch('/allowed-users/:id', (req, res) => {
  if (!isAdminUser(req.user)) return res.status(403).json({ ok: false, error: 'Solo Jefe TIC puede administrar usuarios.' });
  const old = getDb().prepare('SELECT * FROM allowed_users WHERE id=?').get(req.params.id);
  if (!old) return res.status(404).json({ ok: false, error: 'Usuario permitido no encontrado.' });
  const ts = nowIso();
  getDb().prepare(`
    UPDATE allowed_users SET email=?, nombre=?, default_role=?, can_choose_role=?, activo=?, updated_at=? WHERE id=?
  `).run(
    String(req.body?.email || old.email).trim().toLowerCase(),
    req.body?.nombre ?? old.nombre,
    req.body?.defaultRole ?? req.body?.default_role ?? old.default_role,
    req.body?.canChooseRole == null ? old.can_choose_role : (req.body.canChooseRole ? 1 : 0),
    req.body?.activo == null ? old.activo : (req.body.activo ? 1 : 0),
    ts,
    req.params.id
  );
  const updated = getDb().prepare('SELECT * FROM allowed_users WHERE id=?').get(req.params.id);
  if (Array.isArray(req.body?.sites) || Array.isArray(req.body?.siteCodes)) {
    saveAllowedUserSites(updated.id, req.body?.sites || req.body?.siteCodes || [], req.body?.defaultSiteCode || req.body?.defaultSite || '', updated.default_role, req.body?.turno || 'Sin turno');
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
  getDb().prepare('UPDATE user_sites SET activo=0, updated_at=? WHERE user_id=?').run(ts, user.id);
  const stmt = getDb().prepare(`
    INSERT INTO user_sites (user_id, site_code, site_role, turno, is_default, activo, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?)
    ON CONFLICT(user_id, site_code) DO UPDATE SET site_role=excluded.site_role, turno=excluded.turno, is_default=excluded.is_default, activo=1, updated_at=excluded.updated_at
  `);
  for (const site of sites) stmt.run(user.id, site.siteCode, site.siteRole || allowed.default_role, site.turno || 'Sin turno', site.isDefault ? 1 : 0, ts, ts);
}
