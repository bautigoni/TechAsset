import { Router } from 'express';
import { config } from '../config.js';
import { isSiteManager, isSuperadmin, normalizeSiteCode, requireSite } from '../services/siteContext.service.js';
import { createInvite, listInvites, revokeInvite } from '../services/invites.service.js';
import { getDb } from '../db.js';
import { sendMail } from '../services/mail.service.js';
import { buildInviteMail } from '../services/mailTemplates.js';

export const invitesRouter = Router();

function siteName(siteCode) {
  const row = getDb().prepare('SELECT nombre FROM sites WHERE site_code=?').get(siteCode);
  return row?.nombre || siteCode;
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
  const role = String(req.body?.role || 'Consulta').trim();
  const turno = String(req.body?.turno || 'Sin turno').trim();
  const kind = req.body?.kind === 'admin' ? 'admin' : 'standard';
  const email = String(req.body?.email || '').trim().toLowerCase();
  const expiresInDays = Number(req.body?.expiresInDays ?? 14);
  const invite = createInvite({ siteCode, role, turno, kind, email, createdBy: req.user?.email || '', expiresInDays });
  const registerUrl = `${config.appBaseUrl}/register?code=${encodeURIComponent(invite.code)}`;

  let emailSent = false;
  if (email) {
    const mail = buildInviteMail({ siteName: siteName(siteCode), code: invite.code, role, registerUrl, expiresAt: invite.expires_at, isAdmin: kind === 'admin' });
    const result = await sendMail({ to: email, subject: mail.subject, html: mail.html, text: mail.text }).catch(() => ({ sent: false }));
    emailSent = Boolean(result?.sent);
  }

  res.json({ ok: true, invite: { ...invite, registerUrl }, emailSent });
});

invitesRouter.post('/invites/:id/revoke', (req, res) => {
  const siteCode = requireSite(req);
  if (!isSiteManager(req, siteCode)) return res.status(403).json({ ok: false, error: 'Solo administradores de la sede pueden revocar invitaciones.' });
  const ok = revokeInvite(req.params.id, siteCode);
  res.json({ ok, revoked: ok });
});
