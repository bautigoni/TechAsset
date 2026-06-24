import { Router } from 'express';
import { config } from '../config.js';
import { addLocalMovement, getDb } from '../db.js';
import {
  createSession,
  normalizeEmail,
  normalizeSiteCode,
  upsertLoginUser
} from '../services/siteContext.service.js';
import {
  buildAuthUrl,
  exchangeCode,
  generateState,
  isEnabled,
  verifyIdToken
} from '../services/googleOAuth.service.js';

export const googleAuthRouter = Router();

const STATE_COOKIE = 'techasset_google_state';
const SITE_COOKIE = 'techasset_google_site';

function isSecureCookie() {
  // En prod la app vive detrás de HTTPS (Caddy), mandamos secure=true.
  // En dev (http://127.0.0.1:8000) secure rompe el callback.
  return /^https:/i.test(config.techassetPublicUrl || config.appBaseUrl || '');
}

/**
 * Devuelve al frontend si el botón de Google debería mostrarse.
 * Sirve para que el componente LoginPage oculte el botón si no hay config.
 */
googleAuthRouter.get('/auth/google/config', (_req, res) => {
  res.json({ ok: true, enabled: isEnabled() });
});

/**
 * Inicia el flow: redirige al usuario a la pantalla de consent de Google.
 * Setea una cookie httpOnly con el `state` random (anti-CSRF) y otra con el
 * `site_code` que tenía activo (para volver a la misma sede post-login).
 */
googleAuthRouter.get('/auth/google/login', (req, res) => {
  if (!isEnabled()) {
    return res.status(503).json({ ok: false, error: 'Login con Google no configurado.' });
  }
  const state = generateState();
  const requestedSite = normalizeSiteCode(req.query.site || req.body?.siteCode || '');
  const cookieOpts = {
    httpOnly: true,
    sameSite: 'lax',
    secure: isSecureCookie(),
    path: '/',
    maxAge: 10 * 60 * 1000 // 10 min
  };
  res.cookie(STATE_COOKIE, state, cookieOpts);
  if (requestedSite) res.cookie(SITE_COOKIE, requestedSite, cookieOpts);
  res.redirect(buildAuthUrl(state));
});

/**
 * Callback de Google. Valida state, intercambia code, verifica id_token,
 * busca el usuario en allowed_users y crea sesión normal.
 *
 * Errores se traducen a un redirect a /login?error=<slug> para que el front
 * los muestre (sin filtrar detalles de Google al usuario final).
 */
googleAuthRouter.get('/auth/google/callback', async (req, res) => {
  if (!isEnabled()) {
    return res.redirect('/login?error=google_unavailable');
  }

  const code = String(req.query.code || '').trim();
  const incomingState = String(req.query.state || '').trim();
  const cookieState = String(req.cookies?.[STATE_COOKIE] || '');
  const siteCookie = normalizeSiteCode(req.cookies?.[SITE_COOKIE] || '');

  // Limpiar cookies de estado siempre, exitoso o no.
  res.clearCookie(STATE_COOKIE, { path: '/' });
  res.clearCookie(SITE_COOKIE, { path: '/' });

  if (!code) return res.redirect('/login?error=google_no_code');
  if (!incomingState || incomingState !== cookieState) return res.redirect('/login?error=google_bad_state');

  let profile;
  try {
    const { id_token } = await exchangeCode(code);
    profile = await verifyIdToken(id_token);
  } catch (err) {
    console.warn('[google-auth] verify failed:', err?.message || err);
    return res.redirect('/login?error=google_verify_failed');
  }

  const email = normalizeEmail(profile.email);
  const allowed = getDb().prepare(
    "SELECT * FROM allowed_users WHERE lower(email)=? AND COALESCE(deleted_at,'')=''"
  ).get(email);

  if (!allowed) {
    return res.redirect('/login?error=not_authorized');
  }
  if (allowed.status === 'Pendiente') {
    return res.redirect('/login?error=account_pending');
  }
  if (allowed.status === 'Rechazado' || allowed.activo !== 1) {
    return res.redirect('/login?error=account_disabled');
  }

  // Reusar el flujo estándar de upsert para mantener users/user_sites sincronizados.
  const user = upsertLoginUser(allowed, {
    nombre: profile.name,
    siteCode: siteCookie || undefined
  });

  const session = createSession(user.id);
  res.cookie(config.sessionCookieName, session.token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isSecureCookie(),
    expires: new Date(session.expires),
    path: '/'
  });

  // Auditoría (H3.4): guardar en local_movements de la sede activa (o default).
  try {
    addLocalMovement({
      tipo: 'auth',
      descripcion: 'login con Google',
      operador: email,
      origen: 'Google',
      siteCode: siteCookie || 'NFPT'
    });
  } catch (err) {
    // No romper el login si el log falla.
    console.warn('[google-auth] audit log failed:', err?.message || err);
  }

  // Redirigir a la sede correspondiente (la del cookie o la default del user).
  const fresh = getDb().prepare('SELECT site_code FROM user_sites WHERE user_id=? AND activo=1 ORDER BY is_default DESC, site_code LIMIT 1').get(user.id);
  const siteCode = siteCookie || normalizeSiteCode(fresh?.site_code || '');
  const target = siteCode ? `/sede/${siteCode.toLowerCase()}/dashboard` : '/dashboard';
  res.redirect(target);
});