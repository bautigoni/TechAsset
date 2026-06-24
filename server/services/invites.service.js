import crypto from 'node:crypto';
import { getDb, nowIso } from '../db.js';
import { normalizeSiteCode } from './siteContext.service.js';

function generateCode() {
  // Código legible de un solo uso, ej. "TA-7F3A-9C2D".
  const raw = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `TA-${raw.slice(0, 4)}-${raw.slice(4, 8)}`;
}

export function createInvite({ siteCode, role = 'Consulta', turno = 'Sin turno', kind = 'standard', email = '', createdBy = '', expiresInDays = 14 }) {
  const db = getDb();
  let code = generateCode();
  // Evitar (rarísima) colisión.
  while (db.prepare('SELECT 1 FROM invites WHERE code=?').get(code)) code = generateCode();
  const ts = nowIso();
  const expiresAt = expiresInDays ? new Date(Date.now() + Number(expiresInDays) * 86400000).toISOString() : '';
  db.prepare(`
    INSERT INTO invites (code, site_code, role, turno, kind, email, created_by, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(code, normalizeSiteCode(siteCode), String(role || 'Consulta'), String(turno || 'Sin turno'), kind === 'admin' ? 'admin' : 'standard', String(email || '').trim().toLowerCase(), createdBy, expiresAt, ts);
  return getInviteByCode(code);
}

export function getInviteByCode(code) {
  return getDb().prepare('SELECT * FROM invites WHERE code=?').get(String(code || '').trim().toUpperCase());
}

export function findValidInvite(code) {
  const invite = getInviteByCode(code);
  if (!invite) return { ok: false, error: 'Código de invitación inexistente.' };
  if (invite.revoked_at) return { ok: false, error: 'Esta invitación fue revocada.' };
  if (invite.used_at) return { ok: false, error: 'Esta invitación ya fue usada.' };
  if (invite.expires_at && new Date(invite.expires_at).getTime() < Date.now()) return { ok: false, error: 'Esta invitación venció.' };
  return { ok: true, invite };
}

export function consumeInvite(code, usedBy = '') {
  getDb().prepare('UPDATE invites SET used_at=?, used_by=? WHERE code=? AND used_at=\'\'')
    .run(nowIso(), String(usedBy || '').trim().toLowerCase(), String(code || '').trim().toUpperCase());
}

export function listInvites(siteCode) {
  const site = normalizeSiteCode(siteCode);
  return getDb().prepare(`
    SELECT id, code, site_code AS siteCode, role, turno, kind, email, created_by AS createdBy,
           expires_at AS expiresAt, used_at AS usedAt, used_by AS usedBy, revoked_at AS revokedAt, created_at AS createdAt
    FROM invites
    WHERE site_code=?
    ORDER BY (used_at='' AND revoked_at='') DESC, id DESC
    LIMIT 100
  `).all(site).map(row => ({
    ...row,
    status: row.revokedAt ? 'Revocada' : row.usedAt ? 'Usada' : (row.expiresAt && new Date(row.expiresAt).getTime() < Date.now() ? 'Vencida' : 'Activa')
  }));
}

export function revokeInvite(id, siteCode) {
  const result = getDb().prepare("UPDATE invites SET revoked_at=? WHERE id=? AND site_code=? AND used_at='' AND revoked_at=''")
    .run(nowIso(), id, normalizeSiteCode(siteCode));
  return result.changes > 0;
}
