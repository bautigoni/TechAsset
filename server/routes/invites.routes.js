import { Router } from 'express';
import { config } from '../config.js';
import { isSiteManager, isSuperadmin, normalizeSiteCode, requireSite } from '../services/siteContext.service.js';
import { createInvite, findInviteById, listInvites, recordInviteEmail, revokeInvite } from '../services/invites.service.js';
import { getDb } from '../db.js';
import { sendMail } from '../services/mail.service.js';
import { buildInviteMail } from '../services/mailTemplates.js';

export const invitesRouter = Router();

/**
 * Límite de envíos por usuario. Es un endpoint autenticado que dispara un mail
 * a un destinatario arbitrario: sin tope, una cuenta comprometida o un bucle en
 * el frontend puede quemar la reputación del dominio y dejar sin mail a todos
 * los tenants. Ventana en memoria, mismo patrón que el asistente.
 */
const INVITES_POR_HORA = 20;
const buckets = new Map();

function rateLimited(userKey) {
  const now = Date.now();
  const recent = (buckets.get(userKey) || []).filter(ts => now - ts < 3600000);
  if (recent.length >= INVITES_POR_HORA) {
    buckets.set(userKey, recent);
    return true;
  }
  recent.push(now);
  buckets.set(userKey, recent);
  return false;
}

function siteName(siteCode) {
  const row = getDb().prepare('SELECT nombre FROM sites WHERE site_code=?').get(siteCode);
  return row?.nombre || siteCode;
}

function motivoDeFalla(result) {
  if (!result || result.sent) return '';
  if (result.error) return String(result.error);
  if (result.mocked) return 'Modo prueba: no se envió';
  if (result.missingConfig) return 'Proveedor de mail sin configurar';
  return 'No se pudo enviar';
}

// Manda el mail de la invitación y deja registrado cómo salió, para que
// "no me llegó" tenga respuesta después de recargar la pantalla.
async function enviarInvitacion({ invite, siteCode, role, kind }) {
  const registerUrl = `${config.appBaseUrl}/register?code=${encodeURIComponent(invite.code)}`;
  if (!invite.email) return { registerUrl, result: null };
  const mail = buildInviteMail({
    siteName: siteName(siteCode),
    code: invite.code,
    role,
    registerUrl,
    expiresAt: invite.expires_at || invite.expiresAt,
    isAdmin: kind === 'admin'
  });
  const result = await sendMail({ to: invite.email, subject: mail.subject, html: mail.html, text: mail.text })
    .catch(error => ({ sent: false, error: error instanceof Error ? error.message : 'Error al enviar' }));
  recordInviteEmail(invite.id, siteCode, result);
  return { registerUrl, result };
}

invitesRouter.get('/invites', (req, res) => {
  const siteCode = requireSite(req);
  if (!isSiteManager(req, siteCode)) return res.status(403).json({ ok: false, error: 'Solo administradores de la sede pueden ver invitaciones.' });
  res.json({ ok: true, items: listInvites(siteCode) });
});

invitesRouter.post('/invites', async (req, res) => {
  // El superadmin puede generar códigos para cualquier sede (ej. el código admin
  // al crear un tenant nuevo); el resto solo para su sede activa.
  const siteCode = (isSuperadmin(req.user) && (req.body?.siteCode || req.body?.site_code))
    ? normalizeSiteCode(req.body.siteCode || req.body.site_code)
    : requireSite(req);
  if (!isSiteManager(req, siteCode)) return res.status(403).json({ ok: false, error: 'Solo administradores de la sede pueden crear invitaciones.' });
  const userKey = req.user?.email || req.user?.id || 'anon';
  if (rateLimited(userKey)) {
    return res.status(429).json({ ok: false, error: `Llegaste al límite de ${INVITES_POR_HORA} invitaciones por hora. Probá de nuevo más tarde.` });
  }
  const role = String(req.body?.role || 'Consulta').trim();
  const turno = String(req.body?.turno || 'Sin turno').trim();
  const kind = req.body?.kind === 'admin' ? 'admin' : 'standard';
  const email = String(req.body?.email || '').trim().toLowerCase();
  const expiresInDays = Number(req.body?.expiresInDays ?? 14);
  const invite = createInvite({ siteCode, role, turno, kind, email, createdBy: req.user?.email || '', expiresInDays });

  const { registerUrl, result } = await enviarInvitacion({ invite, siteCode, role, kind });
  res.json({ ok: true, invite: { ...invite, registerUrl }, emailSent: Boolean(result?.sent), emailError: motivoDeFalla(result) });
});

// Reenvía la MISMA invitación: si la persona borró el mail o cayó en spam, no
// hace falta generar un código nuevo y dejarla con dos códigos vivos.
invitesRouter.post('/invites/:id/resend', async (req, res) => {
  const siteCode = requireSite(req);
  if (!isSiteManager(req, siteCode)) return res.status(403).json({ ok: false, error: 'Solo administradores de la sede pueden reenviar invitaciones.' });
  const userKey = req.user?.email || req.user?.id || 'anon';
  if (rateLimited(userKey)) {
    return res.status(429).json({ ok: false, error: `Llegaste al límite de ${INVITES_POR_HORA} invitaciones por hora. Probá de nuevo más tarde.` });
  }
  const invite = findInviteById(req.params.id, siteCode);
  if (!invite) return res.status(404).json({ ok: false, error: 'Invitación no encontrada.' });
  if (invite.used_at) return res.status(409).json({ ok: false, error: 'Esa invitación ya fue usada.' });
  if (invite.revoked_at) return res.status(409).json({ ok: false, error: 'Esa invitación está revocada.' });
  if (invite.expires_at && new Date(invite.expires_at).getTime() < Date.now()) {
    return res.status(409).json({ ok: false, error: 'Esa invitación venció: generá una nueva.' });
  }
  if (!invite.email) return res.status(400).json({ ok: false, error: 'Esa invitación no tiene mail cargado: compartí el link.' });

  const { registerUrl, result } = await enviarInvitacion({ invite, siteCode, role: invite.role, kind: invite.kind });
  res.json({ ok: true, registerUrl, emailSent: Boolean(result?.sent), emailError: motivoDeFalla(result) });
});

invitesRouter.post('/invites/:id/revoke', (req, res) => {
  const siteCode = requireSite(req);
  if (!isSiteManager(req, siteCode)) return res.status(403).json({ ok: false, error: 'Solo administradores de la sede pueden revocar invitaciones.' });
  const ok = revokeInvite(req.params.id, siteCode);
  res.json({ ok, revoked: ok });
});
