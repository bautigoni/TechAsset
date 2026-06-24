import { getDb, nowIso } from '../db.js';
import { config } from '../config.js';
import { sendMail } from './mail.service.js';
import { buildReleaseBroadcastMail } from './mailTemplates.js';

let webpushModule = null;
let webpushReady = false;

// Carga perezosa de web-push: si no está instalado o no hay VAPID, las push
// quedan deshabilitadas sin romper el resto (in-app + mail siguen funcionando).
async function getWebPush() {
  if (webpushReady) return webpushModule;
  webpushReady = true;
  if (!config.vapid.publicKey || !config.vapid.privateKey) return null;
  try {
    const mod = await import('web-push');
    const webpush = mod.default || mod;
    webpush.setVapidDetails(config.vapid.subject, config.vapid.publicKey, config.vapid.privateKey);
    webpushModule = webpush;
  } catch {
    webpushModule = null; // web-push no instalado
  }
  return webpushModule;
}

export async function sendPush(subscription, payload) {
  const webpush = await getWebPush();
  if (!webpush) return false;
  try {
    await webpush.sendNotification(
      { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
      JSON.stringify(payload)
    );
    return true;
  } catch (error) {
    // 404/410 => suscripción muerta, la limpiamos.
    if (error && (error.statusCode === 404 || error.statusCode === 410)) {
      try { getDb().prepare('DELETE FROM push_subscriptions WHERE endpoint=?').run(subscription.endpoint); } catch { /* noop */ }
    }
    return false;
  }
}

function pushToUser(email, payload) {
  const subs = getDb().prepare('SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE lower(user_email)=?').all(String(email || '').toLowerCase());
  for (const sub of subs) void sendPush(sub, payload);
}

export function notifyUser({ siteCode, email, kind = 'general', title, body = '', link = '', payload = null }) {
  if (!email || !title) return null;
  const ts = nowIso();
  const info = getDb().prepare(`
    INSERT INTO notifications (site_code, user_email, kind, title, body, link, read, payload_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
  `).run(siteCode || config.defaultSiteCode, String(email).toLowerCase(), kind, title, body, link, payload ? JSON.stringify(payload) : '', ts);
  pushToUser(email, { title, body, link });
  return info.lastInsertRowid;
}

// Jefes TIC + Superadmin de la sede (para avisar de tareas/tickets nuevos).
function siteAdminEmails(siteCode) {
  const code = String(siteCode || config.defaultSiteCode).toUpperCase();
  const rows = getDb().prepare(`
    SELECT DISTINCT lower(au.email) AS email
    FROM allowed_users au
    LEFT JOIN allowed_user_sites aus ON aus.allowed_user_id = au.id AND upper(aus.site_code) = ?
    WHERE au.activo = 1 AND COALESCE(au.deleted_at,'') = ''
      AND (au.default_role = 'Superadmin' OR aus.site_role IN ('Jefe TIC', 'Superadmin', 'Administrador'))
  `).all(code);
  return rows.map(r => r.email).filter(Boolean);
}

export function notifySiteAdmins({ siteCode, kind, title, body = '', link = '', exceptEmail = '' }) {
  const except = String(exceptEmail || '').toLowerCase();
  for (const email of siteAdminEmails(siteCode)) {
    if (email === except) continue;
    notifyUser({ siteCode, email, kind, title, body, link });
  }
}

export async function broadcastRelease({ version, title, body, appUrl = config.techassetPublicUrl }) {
  const users = getDb().prepare("SELECT email, nombre FROM users WHERE activo=1 AND COALESCE(email,'')<>''").all();
  const mail = buildReleaseBroadcastMail({ version, title, bodyMd: body, appUrl });
  let sent = 0;
  for (const user of users) {
    notifyUser({ siteCode: config.defaultSiteCode, email: user.email, kind: 'release', title, body: `Versión ${version}`, link: '/' });
    try {
      await sendMail({ to: user.email, subject: mail.subject, text: mail.text, html: mail.html });
      sent += 1;
    } catch { /* mail individual falla, seguimos */ }
  }
  return { recipients: users.length, mailsSent: sent };
}
