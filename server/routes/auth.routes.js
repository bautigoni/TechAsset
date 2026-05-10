import { Router } from 'express';
import { config } from '../config.js';
import { getDb } from '../db.js';
import { clearSession, createRegisteredUser, createSession, getUserSession, normalizeEmail, readSessionToken, upsertLoginUser } from '../services/siteContext.service.js';
import { getSuperadminRecipients, sendMail } from '../services/mail.service.js';
import { buildRegistrationAdminMail, buildRegistrationUserMail } from '../services/mailTemplates.js';

export const authRouter = Router();

authRouter.get('/auth/session', (req, res) => {
  const session = getUserSession(req);
  if (!session) return res.json({ ok: true, authenticated: false });
  res.json({ ok: true, authenticated: true, user: session.user, sites: session.sites });
});

authRouter.post('/auth/login', (req, res) => {
  const email = normalizeEmail(req.body?.email);
  if (!email || !email.includes('@')) return res.status(400).json({ ok: false, error: 'Ingresá un mail válido.' });
  const allowed = getDb().prepare("SELECT * FROM allowed_users WHERE lower(email)=? AND COALESCE(deleted_at,'')=''").get(email);
  if (!allowed) return res.status(403).json({ ok: false, error: 'Usuario no autorizado.' });
  if (allowed.status === 'Pendiente') return res.status(403).json({ ok: false, error: 'Tu cuenta está pendiente de aprobación.' });
  if (allowed.status === 'Rechazado' || allowed.activo !== 1) return res.status(403).json({ ok: false, error: 'Tu solicitud fue rechazada o tu usuario no está activo.' });
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
  const sites = getDb().prepare('SELECT site_code AS siteCode, nombre, subtitulo FROM sites WHERE activo=1 ORDER BY site_code').all();
  res.json({ ok: true, sites: sites.map(site => ({
    siteCode: site.siteCode,
    nombre: site.nombre || site.siteCode,
    subtitulo: site.subtitulo || ''
  })) });
});

authRouter.post('/auth/register', async (req, res) => {
  try {
    const allowed = createRegisteredUser(req.body || {});
    res.json({ ok: true, authenticated: false, pending: true, message: 'Solicitud enviada. Tu acceso quedará habilitado cuando sea aprobado por un administrador.' });
    // Notificaciones por mail (sin bloquear la respuesta).
    notifyRegistration(allowed, req.body || {}).catch(error => {
      console.warn('[auth/register] notify error:', error?.message || error);
    });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message || 'No se pudo completar el registro.' });
  }
});

async function notifyRegistration(allowed, payload) {
  if (!allowed) return;
  const email = normalizeEmail(allowed.email || payload.email);
  const nombre = String(allowed.nombre || payload.nombre || '').trim() || email.split('@')[0];
  const sede = String(payload.siteCode || '').trim();
  const rol = String(payload.role || allowed.default_role || 'Consulta');
  const turno = String(payload.turno || '').trim() || (rol.includes('mañana') ? 'Mañana' : rol.includes('tarde') ? 'Tarde' : 'Sin turno');
  const fecha = new Date().toLocaleString('es-AR');

  // 1) Mail al usuario
  const userMail = buildRegistrationUserMail({ nombre, sede });
  await sendMail({ to: email, subject: userMail.subject, html: userMail.html, text: userMail.text });

  // 2) Mail al superadmin y al jefe TIC de la sede
  const adminRecipients = new Set(getSuperadminRecipients());
  if (sede) {
    try {
      const jefes = getDb().prepare(`
        SELECT lower(au.email) AS email
        FROM allowed_users au
        JOIN allowed_user_sites aus ON aus.allowed_user_id = au.id
        WHERE aus.site_code = ?
          AND aus.activo = 1
          AND au.activo = 1
          AND COALESCE(au.deleted_at,'') = ''
          AND aus.site_role = 'Jefe TIC'
      `).all(sede);
      jefes.forEach(j => j?.email && adminRecipients.add(j.email));
    } catch (error) {
      console.warn('[auth/register] no se pudieron leer jefes de sede:', error?.message || error);
    }
  }
  const adminList = Array.from(adminRecipients);
  if (!adminList.length) return;
  const adminMail = buildRegistrationAdminMail({ nombre, email, sede, rol, turno, fecha });
  await sendMail({ to: adminList, subject: adminMail.subject, html: adminMail.html, text: adminMail.text });
}

authRouter.post('/auth/logout', (req, res) => {
  clearSession(readSessionToken(req));
  res.cookie(config.sessionCookieName, '', { httpOnly: true, sameSite: 'lax', expires: new Date(0), path: '/' });
  res.json({ ok: true });
});
