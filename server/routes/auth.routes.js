import { Router } from 'express';
import { config } from '../config.js';
import { getDb } from '../db.js';
import { clearSession, createRegisteredUser, createSession, getUserSession, normalizeEmail, readSessionToken, upsertLoginUser } from '../services/siteContext.service.js';

export const authRouter = Router();

authRouter.get('/auth/session', (req, res) => {
  const session = getUserSession(req);
  if (!session) return res.json({ ok: true, authenticated: false });
  res.json({ ok: true, authenticated: true, user: session.user, sites: session.sites });
});

authRouter.post('/auth/login', (req, res) => {
  const email = normalizeEmail(req.body?.email);
  if (!email || !email.includes('@')) return res.status(400).json({ ok: false, error: 'Ingresá un mail válido.' });
  const allowed = getDb().prepare('SELECT * FROM allowed_users WHERE lower(email)=? AND activo=1').get(email);
  if (!allowed) return res.status(403).json({ ok: false, error: 'Este mail no está autorizado para TechAsset.' });
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

authRouter.post('/auth/register', (req, res) => {
  try {
    const user = createRegisteredUser(req.body || {});
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
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message || 'No se pudo completar el registro.' });
  }
});

authRouter.post('/auth/logout', (req, res) => {
  clearSession(readSessionToken(req));
  res.cookie(config.sessionCookieName, '', { httpOnly: true, sameSite: 'lax', expires: new Date(0), path: '/' });
  res.json({ ok: true });
});
