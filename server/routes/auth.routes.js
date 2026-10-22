import { Router } from 'express';
import { config } from '../config.js';
import { getDb, nowIso } from '../db.js';
import { clearSession, createSession, getUserSession, normalizeEmail, readSessionToken, upsertLoginUser } from '../services/siteContext.service.js';
import { consumeInvite, findValidInvite } from '../services/invites.service.js';
import { hashPassword, verifyPassword, hasPassword, newPasswordProblem, PASSWORD_MAX } from '../services/password.service.js';
import { sendMail, getSuperadminRecipients } from '../services/mail.service.js';
import { appUrl, buildPasswordChangedMail, buildPasswordLinkMail, buildRegistrationAdminMail, buildRegistrationUserMail } from '../services/mailTemplates.js';
import { formatLocalDateTime } from '../services/localTime.js';
import { isValidEmail, LIMITS, stripInvisible } from '../services/inputLimits.js';
import { isEnabled as googleLoginEnabled } from '../services/googleOAuth.service.js';
import { aiProviderInfo } from '../services/ai/provider.js';
import crypto from 'node:crypto';

export const authRouter = Router();

// Pista de arranque (NO es una credencial: la llave sigue siendo la cookie
// httpOnly de sesión). Le dice al front, sin preguntarle al server, si en este
// navegador hay una sesión abierta: si no la hay, la landing se pinta apenas
// corre el JS en vez de esperar /api/auth/session (con 3G lento, ~2 s).
export const SESSION_HINT_COOKIE = 'techasset_signed_in';
const SESSION_DAYS_MS = 30 * 86400000;
export function setSessionHint(res, expires) {
  res.cookie(SESSION_HINT_COOKIE, '1', { httpOnly: false, sameSite: 'lax', secure: config.sessionCookieSecure, expires: new Date(expires || Date.now() + SESSION_DAYS_MS), path: '/' });
}
function clearSessionHint(res) {
  res.cookie(SESSION_HINT_COOKIE, '', { httpOnly: false, sameSite: 'lax', expires: new Date(0), path: '/' });
}

authRouter.get('/auth/session', (req, res) => {
  const session = getUserSession(req);
  const hinted = Boolean(req.cookies?.[SESSION_HINT_COOKIE]);
  if (!session) {
    if (hinted) clearSessionHint(res);
    return res.json({ ok: true, authenticated: false });
  }
  // Sesiones abiertas antes de existir la pista (o por Google): se marca al primer uso.
  if (!hinted) setSessionHint(res);
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
const TOO_MANY = 'Demasiados intentos. Esperá 15 minutos y probá de nuevo.';

// Mismo mensaje para mail desconocido y contraseña errónea: así no se puede
// averiguar qué mails tienen cuenta probando de a uno.
const BAD_CREDENTIALS = 'Mail o contraseña incorrectos.';
const PASSWORD_LINK_SENT = 'Si el mail tiene acceso a TechAsset, te llega un link para crear tu contraseña. Revisá tu casilla (y spam).';

/** Abre la sesión (cookie httpOnly de 30 días) y devuelve el cuerpo de /auth/session. */
function startSession(res, allowed, profile = {}) {
  const user = upsertLoginUser(allowed, profile);
  const session = createSession(user.id);
  res.cookie(config.sessionCookieName, session.token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.sessionCookieSecure,
    expires: new Date(session.expires),
    path: '/'
  });
  setSessionHint(res, session.expires);
  const fresh = getUserSession({ headers: { cookie: `${config.sessionCookieName}=${session.token}` } });
  return { ok: true, authenticated: true, user: fresh.user, sites: fresh.sites };
}

authRouter.post('/auth/login', async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const password = String(req.body?.password || '');
  if (!email || !email.includes('@')) return res.status(400).json({ ok: false, error: 'Ingresá un mail válido.' });
  if (isLoginBlocked(req, email)) return res.status(429).json({ ok: false, error: TOO_MANY });
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
  if (password.length > PASSWORD_MAX || !allowed || !verifyPassword(password, allowed.password_hash)) {
    registerLoginFail(req, email);
    return res.status(401).json({ ok: false, error: BAD_CREDENTIALS });
  }
  loginFails.delete(`acc:${clientIp(req)}:${email}`);
  // El estado de la cuenta se cuenta recién con la contraseña correcta.
  if (allowed.status === 'Pendiente') return res.status(403).json({ ok: false, error: 'Tu cuenta está pendiente de aprobación.' });
  if (allowed.status === 'Rechazado' || allowed.activo !== 1) return res.status(403).json({ ok: false, error: 'Tu solicitud fue rechazada o tu usuario no está activo.' });

  res.json(startSession(res, allowed, req.body || {}));
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

/** Cierra las sesiones abiertas de una cuenta (menos `keepToken`): después de cambiar la contraseña. */
function closeOtherSessions(email, keepToken = '') {
  const user = getDb().prepare('SELECT id FROM users WHERE lower(email)=?').get(normalizeEmail(email));
  if (!user) return 0;
  return getDb().prepare('DELETE FROM user_sessions WHERE user_id=? AND token<>?').run(user.id, keepToken || '').changes || 0;
}

authRouter.post('/auth/password/request', async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  if (!email || !email.includes('@')) return res.status(400).json({ ok: false, error: 'Ingresá un mail válido.' });
  if (isLoginBlocked(req, email)) return res.status(429).json({ ok: false, error: TOO_MANY });
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
  const db = getDb();
  const row = token && token.length <= 128 ? db.prepare("SELECT * FROM password_tokens WHERE token_hash=? AND COALESCE(used_at,'')=''").get(hashToken(token)) : null;
  if (!row || !row.expires_at || new Date(row.expires_at).getTime() < Date.now()) {
    return res.status(400).json({ ok: false, error: 'El link venció o ya se usó. Pedí uno nuevo desde "Olvidé mi contraseña".' });
  }
  const allowed = db.prepare('SELECT email, nombre FROM allowed_users WHERE id=?').get(row.allowed_user_id);
  // La política se chequea antes de gastar el link: si la rechaza, el mismo link sigue sirviendo.
  const problem = newPasswordProblem(password, { email: allowed?.email, nombre: allowed?.nombre });
  if (problem) return res.status(400).json({ ok: false, error: problem, field: 'password' });
  const ts = nowIso();
  db.prepare('UPDATE password_tokens SET used_at=? WHERE id=?').run(ts, row.id);
  db.prepare('UPDATE allowed_users SET password_hash=?, updated_at=? WHERE id=?').run(hashPassword(password), ts, row.allowed_user_id);
  // Quien tenía la contraseña vieja (y una sesión abierta) queda afuera.
  if (allowed?.email) closeOtherSessions(allowed.email);
  res.json({ ok: true, email: allowed?.email || '', message: 'Listo, ya podés entrar con tu nueva contraseña.' });
});

// ── Cuenta propia (Configuración › Cuenta) ──────────────────────────────
// authRouter va antes del middleware de sesión: estas rutas la piden a mano.
function requireOwnSession(req, res) {
  const session = getUserSession(req);
  if (!session) {
    res.status(401).json({ ok: false, error: 'Tu sesión venció. Volvé a ingresar.' });
    return null;
  }
  return session;
}

authRouter.get('/auth/account', (req, res) => {
  const session = requireOwnSession(req, res);
  if (!session) return;
  const allowed = getDb().prepare("SELECT password_hash FROM allowed_users WHERE lower(email)=? AND COALESCE(deleted_at,'')=''").get(normalizeEmail(session.user.email));
  res.json({ ok: true, hasPassword: hasPassword(allowed?.password_hash), googleEnabled: googleLoginEnabled() });
});

authRouter.post('/auth/password/change', (req, res) => {
  const session = requireOwnSession(req, res);
  if (!session) return;
  const email = normalizeEmail(session.user.email);
  // Mismo freno que Ingresar (por IP+cuenta y por IP), con su propia clave.
  const key = `chg:${email}`;
  if (isLoginBlocked(req, key)) return res.status(429).json({ ok: false, error: TOO_MANY });
  const current = String(req.body?.currentPassword || '');
  const next = String(req.body?.newPassword || '');
  const db = getDb();
  const allowed = db.prepare("SELECT * FROM allowed_users WHERE lower(email)=? AND COALESCE(deleted_at,'')=''").get(email);
  if (!allowed) return res.status(403).json({ ok: false, error: 'Tu usuario no está activo.' });
  if (!hasPassword(allowed.password_hash)) {
    return res.status(400).json({ ok: false, noPassword: true, error: 'Tu cuenta no tiene contraseña: entrás con Google. Para usar mail y contraseña, pedí un link con "Olvidé mi contraseña" en la pantalla de ingreso.' });
  }
  if (!current || current.length > PASSWORD_MAX || !verifyPassword(current, allowed.password_hash)) {
    registerLoginFail(req, key);
    return res.status(400).json({ ok: false, field: 'current', error: 'La contraseña actual no es correcta.' });
  }
  loginFails.delete(`acc:${clientIp(req)}:${key}`);
  if (next === current) return res.status(400).json({ ok: false, field: 'new', error: 'La contraseña nueva tiene que ser distinta de la actual.' });
  const problem = newPasswordProblem(next, { email, nombre: allowed.nombre });
  if (problem) return res.status(400).json({ ok: false, field: 'new', error: problem });
  db.prepare('UPDATE allowed_users SET password_hash=?, updated_at=? WHERE id=?').run(hashPassword(next), nowIso(), allowed.id);
  // Las otras sesiones (otra compu, un celular perdido) se cierran; esta sigue.
  const closed = closeOtherSessions(email, session.token);
  const mail = buildPasswordChangedMail({ nombre: allowed.nombre || email, fecha: formatLocalDateTime(new Date()) });
  sendMail({ to: email, subject: mail.subject, html: mail.html, text: mail.text }).catch(error => console.warn('[auth/password-changed]', error?.message || error));
  res.json({ ok: true, closedSessions: closed, message: closed ? `Contraseña cambiada. Cerramos tu sesión en ${closed === 1 ? 'otro dispositivo' : `otros ${closed} dispositivos`}.` : 'Contraseña cambiada.' });
});

// ── Privacidad (pantalla pública): qué servicios de afuera están prendidos ──
authRouter.get('/auth/privacy-info', (_req, res) => {
  const ai = aiProviderInfo().provider;
  res.json({
    ok: true,
    ai: ai === 'anthropic' ? 'Anthropic (Claude)' : ai === 'openai' ? 'OpenAI' : '',
    google: googleLoginEnabled(),
    push: Boolean(config.vapid?.publicKey),
    // Reporte de errores (Sentry): apagado salvo SENTRY_DSN (services/errorReporting.js).
    errorReports: Boolean(String(process.env.SENTRY_DSN || '').trim())
  });
});

// ── Registro con código de invitación ────────────────────────────────────
const INVITE_CODE = /^[A-Z0-9][A-Z0-9-]{3,31}$/;

authRouter.post('/auth/register', (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const code = String(req.body?.code || '').trim().toUpperCase();
    const password = String(req.body?.password || '');
    // Todo se valida ANTES de mirar (y gastar) la invitación: un mail imposible
    // o una contraseña rechazada no queman el código.
    if (!email || !isValidEmail(email)) return res.status(400).json({ ok: false, field: 'email', error: 'Ingresá un mail válido (como nombre@colegio.edu.ar).' });
    if (!code) return res.status(400).json({ ok: false, field: 'code', error: 'Ingresá el código de invitación.' });
    if (!INVITE_CODE.test(code)) return res.status(400).json({ ok: false, field: 'code', error: 'Ese código no es válido. Tiene la forma TA-XXXX-XXXX.' });
    const nombre = stripInvisible(req.body?.nombre).trim().slice(0, LIMITS.name) || email.split('@')[0];
    const problem = newPasswordProblem(password, { email, nombre });
    if (problem) return res.status(400).json({ ok: false, field: 'password', error: problem });

    const check = findValidInvite(code);
    if (!check.ok) return res.status(403).json({ ok: false, field: 'code', error: check.error });
    const invite = check.invite;
    if (invite.email && invite.email !== email) {
      return res.status(403).json({ ok: false, field: 'email', error: 'Esta invitación es para otro mail.' });
    }

    const db = getDb();
    // Un código suelto (sin mail puntual) no pisa una cuenta activa ajena: antes
    // cualquiera con un código podía cambiarle la contraseña a otro registrándose
    // con su mail. Las cuentas borradas o sin contraseña sí se reactivan.
    const existing = db.prepare('SELECT * FROM allowed_users WHERE lower(email)=?').get(email);
    if (!invite.email && existing && !existing.deleted_at && existing.activo === 1 && hasPassword(existing.password_hash)) {
      return res.status(409).json({ ok: false, field: 'email', error: 'Ya hay una cuenta con ese mail. Ingresá con tu contraseña o pedí un link con "Olvidé mi contraseña".' });
    }

    const ts = nowIso();
    const pwdHash = hashPassword(password);
    let consumed = false;
    db.transaction(() => {
      // La invitación se gasta primero y una sola vez: dos registros simultáneos
      // con el mismo código no crean dos cuentas.
      consumed = consumeInvite(code, email) > 0;
      if (!consumed) return;
      db.prepare(`
        INSERT INTO allowed_users (email, nombre, default_role, can_choose_role, status, activo, deleted_at, deleted_by, password_hash, created_at, updated_at)
        VALUES (?, ?, ?, 0, 'Activo', 1, '', '', ?, ?, ?)
        ON CONFLICT(email) DO UPDATE SET nombre=excluded.nombre, default_role=excluded.default_role, status='Activo', activo=1, deleted_at='', deleted_by='', password_hash=excluded.password_hash, updated_at=excluded.updated_at
      `).run(email, nombre, invite.role, pwdHash, ts, ts);
      const created = db.prepare('SELECT id FROM allowed_users WHERE lower(email)=?').get(email);
      db.prepare(`
        INSERT INTO allowed_user_sites (allowed_user_id, site_code, site_role, turno, is_default, activo, created_at, updated_at)
        VALUES (?, ?, ?, ?, 1, 1, ?, ?)
        ON CONFLICT(allowed_user_id, site_code) DO UPDATE SET site_role=excluded.site_role, turno=excluded.turno, activo=1, updated_at=excluded.updated_at
      `).run(created.id, invite.site_code, invite.role, invite.turno, ts, ts);
    })();
    if (!consumed) return res.status(403).json({ ok: false, field: 'code', error: 'Esta invitación ya fue usada.' });

    const allowed = db.prepare('SELECT * FROM allowed_users WHERE lower(email)=?').get(email);
    notifyRegistration({ email, nombre, invite }).catch(error => console.warn('[auth/register/notify]', error?.message || error));
    // La cuenta queda activa: se entra directo, sin volver a tipear la contraseña.
    res.json({ ...startSession(res, allowed), activated: true, message: 'Cuenta creada. Ya estás adentro.' });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message || 'No se pudo completar el registro.' });
  }
});

function siteName(siteCode) {
  const row = siteCode ? getDb().prepare('SELECT nombre FROM sites WHERE site_code=?').get(siteCode) : null;
  return String(row?.nombre || '').trim() || siteCode || '';
}

async function notifyRegistration({ email, nombre, invite }) {
  const siteCode = invite?.site_code || '';
  const sedeNombre = siteName(siteCode);
  const rol = invite?.role || 'Consulta';
  const adminRecipients = getRegistrationAdminRecipients(siteCode).filter(address => address !== email);
  const adminMail = buildRegistrationAdminMail({ nombre, email, sedeCodigo: siteCode, sedeNombre, rol, fecha: formatLocalDateTime(new Date()) });
  if (adminRecipients.length) {
    await sendMail({ to: adminRecipients, subject: adminMail.subject, html: adminMail.html, text: adminMail.text });
  }
  const userMail = buildRegistrationUserMail({ nombre, sedeNombre, rol });
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
  clearSessionHint(res);
  res.json({ ok: true });
});
