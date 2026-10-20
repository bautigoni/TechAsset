import { Router } from 'express';
import { config } from '../config.js';
import { getDb, nowIso } from '../db.js';
import { clearSession, createSession, getUserSession, normalizeEmail, readSessionToken, upsertLoginUser } from '../services/siteContext.service.js';
import { consumeInvite, findValidInvite } from '../services/invites.service.js';
import { hashPassword, verifyPassword, hasPassword } from '../services/password.service.js';
import { sendMail, getSuperadminRecipients } from '../services/mail.service.js';
import { appUrl, buildPasswordLinkMail, buildRegistrationAdminMail, buildRegistrationUserMail } from '../services/mailTemplates.js';
import crypto from 'node:crypto';

export const authRouter = Router();

authRouter.get('/auth/session', (req, res) => {
  const session = getUserSession(req);
  if (!session) return res.json({ ok: true, authenticated: false });
  res.json({ ok: true, authenticated: true, user: session.user, sites: session.sites });
});

// Freno a la fuerza bruta: intentos fallidos por IP+mail y por IP, en memoria
// (una sola instancia de Node). Un login correcto limpia el contador del mail.
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS_PER_ACCOUNT = 8;
const MAX_FAILS_PER_IP = 100; // todo el colegio sale por la misma IP pública
const loginFails = new Map();

function failCount(key) {
  const entry = loginFails.get(key);
  if (!entry || Date.now() - entry.since > LOGIN_WINDOW_MS) return 0;
  return entry.count;
}
function addFail(key) {
  const entry = loginFails.get(key);
  if (!entry || Date.now() - entry.since > LOGIN_WINDOW_MS) loginFails.set(key, { count: 1, since: Date.now() });
  else entry.count += 1;
  if (loginFails.size > 5000) {
    for (const [k, value] of loginFails) if (Date.now() - value.since > LOGIN_WINDOW_MS) loginFails.delete(k);
  }
}
const clientIp = req => String(req.ip || req.socket?.remoteAddress || '');
const isLoginBlocked = (req, email) => failCount(`ip:${clientIp(req)}`) >= MAX_FAILS_PER_IP || failCount(`acc:${clientIp(req)}:${email}`) >= MAX_FAILS_PER_ACCOUNT;
function registerLoginFail(req, email) {
  addFail(`ip:${clientIp(req)}`);
  addFail(`acc:${clientIp(req)}:${email}`);
}

// Mismo mensaje para mail desconocido y contraseña errónea: así no se puede
// averiguar qué mails tienen cuenta probando de a uno.
const BAD_CREDENTIALS = 'Mail o contraseña incorrectos.';
const PASSWORD_LINK_SENT = 'Si el mail tiene acceso a TechAsset, te llega un link para crear tu contraseña. Revisá tu casilla (y spam).';

authRouter.post('/auth/login', async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const password = String(req.body?.password || '');
  if (!email || !email.includes('@')) return res.status(400).json({ ok: false, error: 'Ingresá un mail válido.' });
  if (isLoginBlocked(req, email)) return res.status(429).json({ ok: false, error: 'Demasiados intentos. Esperá 15 minutos y probá de nuevo.' });
  const allowed = getDb().prepare("SELECT * FROM allowed_users WHERE lower(email)=? AND COALESCE(deleted_at,'')=''").get(email);

  // Cuenta sin contraseña (usuarios viejos del allowlist): antes la primera
  // contraseña que alguien tipeaba quedaba como suya, así que conociendo un mail
  // se podía tomar la cuenta. Ahora se le manda un link de un solo uso a esa
  // casilla, que prueba que es el dueño.
  if (allowed && !hasPassword(allowed.password_hash)) {
    if (allowed.activo === 1 && allowed.status !== 'Pendiente' && allowed.status !== 'Rechazado') {
      await sendPasswordLink(allowed, true).catch(error => console.warn('[auth/password-link]', error?.message || error));
    }
    return res.status(400).json({ ok: false, error: PASSWORD_LINK_SENT, passwordLinkSent: true });
  }
  if (!password) return res.status(400).json({ ok: false, error: 'Ingresá tu contraseña.', needsPassword: true });
  if (!allowed || !verifyPassword(password, allowed.password_hash)) {
    registerLoginFail(req, email);
    return res.status(401).json({ ok: false, error: BAD_CREDENTIALS });
  }
  loginFails.delete(`acc:${clientIp(req)}:${email}`);
  // El estado de la cuenta se cuenta recién con la contraseña correcta.
  if (allowed.status === 'Pendiente') return res.status(403).json({ ok: false, error: 'Tu cuenta está pendiente de aprobación.' });
  if (allowed.status === 'Rechazado' || allowed.activo !== 1) return res.status(403).json({ ok: false, error: 'Tu solicitud fue rechazada o tu usuario no está activo.' });

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

// ── Links de contraseña (crear la primera / olvidé mi contraseña) ──────
const PASSWORD_LINK_TTL_MS = 60 * 60 * 1000;
const PASSWORD_LINK_COOLDOWN_MS = 2 * 60 * 1000;
const lastLinkSent = new Map();
const hashToken = token => crypto.createHash('sha256').update(token).digest('hex');

async function sendPasswordLink(allowed, firstTime) {
  // Un mail cada 2 minutos por cuenta: evita usar el login para spamear a alguien.
  const last = lastLinkSent.get(allowed.id) || 0;
  if (Date.now() - last < PASSWORD_LINK_COOLDOWN_MS) return;
  lastLinkSent.set(allowed.id, Date.now());
  const token = crypto.randomBytes(32).toString('hex');
  const ts = nowIso();
  getDb().prepare('INSERT INTO password_tokens (token_hash, allowed_user_id, expires_at, used_at, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(hashToken(token), allowed.id, new Date(Date.now() + PASSWORD_LINK_TTL_MS).toISOString(), '', ts);
  const url = appUrl(`login?password=${token}`);
  const mail = buildPasswordLinkMail({ nombre: allowed.nombre || allowed.email, url, firstTime });
  await sendMail({ to: allowed.email, subject: mail.subject, html: mail.html, text: mail.text });
}

authRouter.post('/auth/password/request', async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  if (!email || !email.includes('@')) return res.status(400).json({ ok: false, error: 'Ingresá un mail válido.' });
  if (isLoginBlocked(req, email)) return res.status(429).json({ ok: false, error: 'Demasiados intentos. Esperá 15 minutos y probá de nuevo.' });
  registerLoginFail(req, email);
  const allowed = getDb().prepare("SELECT * FROM allowed_users WHERE lower(email)=? AND COALESCE(deleted_at,'')=''").get(email);
  if (allowed && allowed.activo === 1 && allowed.status !== 'Pendiente' && allowed.status !== 'Rechazado') {
    await sendPasswordLink(allowed, !hasPassword(allowed.password_hash)).catch(error => console.warn('[auth/password-link]', error?.message || error));
  }
  // Respuesta idéntica exista o no la cuenta.
  res.json({ ok: true, message: 'Si el mail tiene acceso a TechAsset, te llega un link para elegir tu contraseña. Revisá tu casilla (y spam).' });
});

authRouter.post('/auth/password/confirm', (req, res) => {
  const token = String(req.body?.token || '');
  const password = String(req.body?.password || '');
  if (password.length < 6) return res.status(400).json({ ok: false, error: 'La contraseña debe tener al menos 6 caracteres.' });
  const db = getDb();
  const row = token ? db.prepare("SELECT * FROM password_tokens WHERE token_hash=? AND COALESCE(used_at,'')=''").get(hashToken(token)) : null;
  if (!row || !row.expires_at || new Date(row.expires_at).getTime() < Date.now()) {
    return res.status(400).json({ ok: false, error: 'El link venció o ya se usó. Pedí uno nuevo desde "Olvidé mi contraseña".' });
  }
  const ts = nowIso();
  db.prepare('UPDATE password_tokens SET used_at=? WHERE id=?').run(ts, row.id);
  db.prepare('UPDATE allowed_users SET password_hash=?, updated_at=? WHERE id=?').run(hashPassword(password), ts, row.allowed_user_id);
  const allowed = db.prepare('SELECT email FROM allowed_users WHERE id=?').get(row.allowed_user_id);
  res.json({ ok: true, email: allowed?.email || '', message: 'Listo, ya podés entrar con tu nueva contraseña.' });
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
