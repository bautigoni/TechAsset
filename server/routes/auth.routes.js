import { Router } from 'express';
import { config } from '../config.js';
import { getDb, nowIso } from '../db.js';
import { clearSession, createSession, getUserSession, normalizeEmail, readSessionToken, upsertLoginUser } from '../services/siteContext.service.js';
import { consumeInvite, findValidInvite } from '../services/invites.service.js';
import { hashPassword, verifyPassword, hasPassword } from '../services/password.service.js';

export const authRouter = Router();

authRouter.get('/auth/session', (req, res) => {
  const session = getUserSession(req);
  if (!session) return res.json({ ok: true, authenticated: false });
  res.json({ ok: true, authenticated: true, user: session.user, sites: session.sites });
});

authRouter.post('/auth/login', (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const password = String(req.body?.password || '');
  if (!email || !email.includes('@')) return res.status(400).json({ ok: false, error: 'Ingresá un mail válido.' });
  const allowed = getDb().prepare("SELECT * FROM allowed_users WHERE lower(email)=? AND COALESCE(deleted_at,'')=''").get(email);
  if (!allowed) return res.status(403).json({ ok: false, error: 'Usuario no autorizado.' });
  if (allowed.status === 'Pendiente') return res.status(403).json({ ok: false, error: 'Tu cuenta está pendiente de aprobación.' });
  if (allowed.status === 'Rechazado' || allowed.activo !== 1) return res.status(403).json({ ok: false, error: 'Tu solicitud fue rechazada o tu usuario no está activo.' });

  // Auth por contraseña. Si el usuario ya tiene una seteada, la verificamos.
  // Si no (usuarios legacy del allowlist), la primera contraseña que ingrese
  // queda registrada como suya ("reclamar cuenta").
  if (!password) {
    return res.status(400).json({ ok: false, error: hasPassword(allowed.password_hash) ? 'Ingresá tu contraseña.' : 'Definí una contraseña para tu cuenta (mínimo 6 caracteres).', needsPassword: true });
  }
  if (hasPassword(allowed.password_hash)) {
    if (!verifyPassword(password, allowed.password_hash)) {
      return res.status(401).json({ ok: false, error: 'Contraseña incorrecta.' });
    }
  } else {
    if (password.length < 6) return res.status(400).json({ ok: false, error: 'La contraseña debe tener al menos 6 caracteres.' });
    getDb().prepare('UPDATE allowed_users SET password_hash=?, updated_at=? WHERE id=?').run(hashPassword(password), nowIso(), allowed.id);
  }

  const user = upsertLoginUser(allowed, req.body || {});
  const session = createSession(user.id);
  res.cookie(config.sessionCookieName, session.token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
    expires: new Date(session.expires),
    path: '/'
  });
  const fresh = getUserSession({ headers: { cookie: `${config.sessionCookieName}=${session.token}` } });
  res.json({ ok: true, authenticated: true, user: fresh.user, sites: fresh.sites });
});

authRouter.get('/auth/register-options', (_req, res) => {
  // Por seguridad multi-tenant ya NO exponemos la lista de sedes. El registro
  // es por código de invitación que entrega un administrador.
  res.json({ ok: true, requiresCode: true });
});

authRouter.post('/auth/register', (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const nombre = String(req.body?.nombre || '').trim() || email.split('@')[0];
    const code = String(req.body?.code || '').trim().toUpperCase();
    const password = String(req.body?.password || '');
    if (!email || !email.includes('@')) return res.status(400).json({ ok: false, error: 'Ingresá un mail válido.' });
    if (!code) return res.status(400).json({ ok: false, error: 'Ingresá el código de invitación.' });
    if (password.length < 6) return res.status(400).json({ ok: false, error: 'La contraseña debe tener al menos 6 caracteres.' });

    const check = findValidInvite(code);
    if (!check.ok) return res.status(403).json({ ok: false, error: check.error });
    const invite = check.invite;
    if (invite.email && invite.email !== email) {
      return res.status(403).json({ ok: false, error: 'Esta invitación es para otro mail.' });
    }

    const db = getDb();
    const ts = nowIso();
    const pwdHash = hashPassword(password);
    db.prepare(`
      INSERT INTO allowed_users (email, nombre, default_role, can_choose_role, status, activo, deleted_at, deleted_by, password_hash, created_at, updated_at)
      VALUES (?, ?, ?, 0, 'Activo', 1, '', '', ?, ?, ?)
      ON CONFLICT(email) DO UPDATE SET nombre=excluded.nombre, default_role=excluded.default_role, status='Activo', activo=1, deleted_at='', deleted_by='', password_hash=excluded.password_hash, updated_at=excluded.updated_at
    `).run(email, nombre, invite.role, pwdHash, ts, ts);
    const allowed = db.prepare('SELECT * FROM allowed_users WHERE lower(email)=?').get(email);
    db.prepare(`
      INSERT INTO allowed_user_sites (allowed_user_id, site_code, site_role, turno, is_default, activo, created_at, updated_at)
      VALUES (?, ?, ?, ?, 1, 1, ?, ?)
      ON CONFLICT(allowed_user_id, site_code) DO UPDATE SET site_role=excluded.site_role, turno=excluded.turno, activo=1, updated_at=excluded.updated_at
    `).run(allowed.id, invite.site_code, invite.role, invite.turno, ts, ts);

    consumeInvite(code, email);
    res.json({ ok: true, authenticated: false, activated: true, message: 'Cuenta creada. Ya podés iniciar sesión con tu mail.' });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message || 'No se pudo completar el registro.' });
  }
});

authRouter.post('/auth/logout', (req, res) => {
  clearSession(readSessionToken(req));
  res.cookie(config.sessionCookieName, '', { httpOnly: true, sameSite: 'lax', expires: new Date(0), path: '/' });
  res.json({ ok: true });
});
