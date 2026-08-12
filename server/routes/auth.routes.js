import { Router } from 'express';
import { config } from '../config.js';
import { getDb, nowIso } from '../db.js';
import { clearSession, createSession, getUserSession, normalizeEmail, readSessionToken, upsertLoginUser } from '../services/siteContext.service.js';
import { consumeInvite, findValidInvite } from '../services/invites.service.js';
import { hashPassword, verifyPassword, hasPassword } from '../services/password.service.js';
import { sendMail, getSuperadminRecipients } from '../services/mail.service.js';
import { buildRegistrationAdminMail, buildRegistrationUserMail } from '../services/mailTemplates.js';

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
    secure: config.sessionCookieSecure,
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
    notifyRegistration({ email, nombre, invite }).catch(error => console.warn('[auth/register/notify]', error?.message || error));
    res.json({ ok: true, authenticated: false, activated: true, message: 'Cuenta creada. Ya podés iniciar sesión con tu mail.' });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message || 'No se pudo completar el registro.' });
  }
});

async function notifyRegistration({ email, nombre, invite }) {
  const siteCode = invite?.site_code || '';
  const adminRecipients = getRegistrationAdminRecipients(siteCode);
  const adminMail = buildRegistrationAdminMail({
    nombre,
    email,
    sede: siteCode,
    rol: invite?.role || 'Consulta',
    turno: invite?.turno || 'Sin turno',
    fecha: new Date().toLocaleString('es-AR')
  });
  if (adminRecipients.length) {
    await sendMail({ to: adminRecipients, subject: adminMail.subject, html: adminMail.html, text: adminMail.text });
  }
  const userMail = buildRegistrationUserMail({ nombre, sede: siteCode });
  await sendMail({ to: email, subject: userMail.subject, html: userMail.html, text: userMail.text });
}

function getRegistrationAdminRecipients(siteCode) {
  const recipients = new Set(getSuperadminRecipients());
  const rows = getDb().prepare(`
    SELECT DISTINCT au.email
    FROM allowed_users au
    JOIN allowed_user_sites aus ON aus.allowed_user_id=au.id
    WHERE aus.site_code=? AND aus.activo=1 AND au.activo=1
      AND COALESCE(au.deleted_at,'')=''
      AND (
        au.default_role IN ('Superadmin', 'Jefe TIC', 'Admin', 'Administrador')
        OR aus.site_role IN ('Superadmin', 'Jefe TIC', 'Admin', 'Administrador')
      )
  `).all(siteCode);
  rows.forEach(row => {
    const email = String(row.email || '').trim().toLowerCase();
    if (email) recipients.add(email);
  });
  return Array.from(recipients);
}

authRouter.post('/auth/logout', (req, res) => {
  clearSession(readSessionToken(req));
  res.cookie(config.sessionCookieName, '', { httpOnly: true, sameSite: 'lax', expires: new Date(0), path: '/' });
  res.json({ ok: true });
});
