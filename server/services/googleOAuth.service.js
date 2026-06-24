import crypto from 'node:crypto';
import { config } from '../config.js';

/**
 * Login con Google OAuth 2.0.
 *
 * Flow:
 *   1. Frontend llama GET /api/auth/google/login → redirect a buildAuthUrl(state).
 *      El server setea una cookie httpOnly con el state random.
 *   2. Google redirige al usuario a /api/auth/google/callback?code=...&state=...
 *   3. El server valida que el state matchee la cookie (CSRF), hace exchangeCode
 *      para obtener el id_token, llama verifyIdToken para validar email_verified
 *      y los allowed_domains, y si todo OK crea sesión normal.
 *
 * Si GOOGLE_CLIENT_ID/SECRET están vacíos, isEnabled() devuelve false y el router
 * devuelve 503 — el frontend oculta el botón en ese caso.
 */

const SCOPES = ['openid', 'email', 'profile'];
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const TOKENINFO_URL = 'https://oauth2.googleapis.com/tokeninfo';

export function isEnabled() {
  return Boolean(config.google.clientId && config.google.clientSecret && config.google.redirectUri);
}

export function generateState() {
  // 32 bytes random → 64 chars hex. Suficiente entropy para CSRF.
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Arma la URL de authorization de Google. `state` debería ser un string random
 * generado con generateState() y persistido en cookie httpOnly por el caller.
 */
export function buildAuthUrl(state) {
  if (!isEnabled()) throw new Error('Google OAuth no está configurado.');
  const params = new URLSearchParams({
    client_id: config.google.clientId,
    redirect_uri: config.google.redirectUri,
    response_type: 'code',
    scope: SCOPES.join(' '),
    state: String(state || ''),
    access_type: 'online',
    prompt: 'select_account',
    include_granted_scopes: 'true'
  });
  return `${AUTH_URL}?${params.toString()}`;
}

/**
 * Intercambia el `code` de Google por tokens. Devuelve { id_token, access_token }.
 */
export async function exchangeCode(code) {
  if (!isEnabled()) throw new Error('Google OAuth no está configurado.');
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: String(code || ''),
      client_id: config.google.clientId,
      client_secret: config.google.clientSecret,
      redirect_uri: config.google.redirectUri,
      grant_type: 'authorization_code'
    }).toString()
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Google token exchange failed: HTTP ${response.status} ${text.slice(0, 200)}`);
  }
  const data = await response.json().catch(() => ({}));
  if (!data.id_token) throw new Error('Google no devolvió id_token.');
  return { id_token: data.id_token, access_token: data.access_token || '' };
}

/**
 * Verifica el id_token contra Google y devuelve el perfil normalizado.
 * Validaciones que aplica:
 *   - aud == GOOGLE_CLIENT_ID (sino el token era para otra app).
 *   - email_verified == true.
 *   - Si GOOGLE_ALLOWED_DOMAINS está configurado, el dominio del email tiene que
 *     estar en la lista.
 *
 * Devuelve { sub, email, emailVerified, name, picture } o lanza Error.
 */
export async function verifyIdToken(idToken) {
  if (!isEnabled()) throw new Error('Google OAuth no está configurado.');
  const response = await fetch(`${TOKENINFO_URL}?id_token=${encodeURIComponent(String(idToken || ''))}`);
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Google tokeninfo failed: HTTP ${response.status} ${text.slice(0, 200)}`);
  }
  const claims = await response.json().catch(() => ({}));
  if (!claims || !claims.email) throw new Error('Google tokeninfo sin email.');

  if (claims.aud && claims.aud !== config.google.clientId) {
    throw new Error('El token de Google no fue emitido para esta aplicación.');
  }

  const email = String(claims.email || '').trim().toLowerCase();
  const emailVerified = String(claims.email_verified || '') === 'true';
  if (!emailVerified) throw new Error('El mail de Google no está verificado.');

  if (config.google.allowedDomains.length) {
    const domain = email.split('@')[1] || '';
    if (!config.google.allowedDomains.includes(domain.toLowerCase())) {
      throw new Error(`El dominio @${domain} no está permitido para login con Google.`);
    }
  }

  return {
    sub: String(claims.sub || ''),
    email,
    emailVerified,
    name: String(claims.name || email.split('@')[0]),
    picture: String(claims.picture || '')
  };
}