import { getDb, nowIso } from '../db.js';
import { config } from '../config.js';
import { sendMail } from './mail.service.js';
import { buildReleaseBroadcastMail } from './mailTemplates.js';

let webpushModule = null;
let webpushReady = false;

export const DEFAULT_NOTIFICATION_PREFS = {
  releases: true,
  tasks: true,
  tickets: true,
  suggestions: true,
  reminders: true,
  registrations: true,
  system: true
};

export function notificationKindKey(kind = '') {
  const value = String(kind || '').toLowerCase();
  if (value.startsWith('release')) return 'releases';
  if (value.startsWith('task')) return 'tasks';
  if (value.startsWith('ticket')) return 'tickets';
  if (value.startsWith('suggestion')) return 'suggestions';
  if (value.startsWith('reminder')) return 'reminders';
  if (value.startsWith('registration') || value.startsWith('invite') || value.startsWith('user.')) return 'registrations';
  return 'system';
}

export function normalizeNotificationPrefs(raw = {}) {
  const parsed = typeof raw === 'string' ? parsePrefsJson(raw) : raw;
  return Object.fromEntries(
    Object.entries(DEFAULT_NOTIFICATION_PREFS).map(([key, fallback]) => [key, typeof parsed?.[key] === 'boolean' ? parsed[key] : fallback])
  );
}

export function getNotificationPrefsForUser(email) {
  const row = getDb().prepare('SELECT notification_prefs_json FROM allowed_users WHERE lower(email)=?').get(String(email || '').toLowerCase());
  return normalizeNotificationPrefs(row?.notification_prefs_json || '');
}

function parsePrefsJson(value) {
  try {
    const parsed = JSON.parse(String(value || '{}'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function wantsNotificationKind(email, kind) {
  const prefs = getNotificationPrefsForUser(email);
  return prefs[notificationKindKey(kind)] !== false;
}

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
    webpushModule = null;
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

function wantsEmail(email) {
  const row = getDb().prepare('SELECT notif_email FROM allowed_users WHERE lower(email)=?').get(String(email || '').toLowerCase());
  return row ? Number(row.notif_email) === 1 : false;
}

function emailNotification(email, { title, body, link }) {
  const url = link && link.startsWith('http') ? link : `${config.techassetPublicUrl}${link || ''}`;
  sendMail({
    to: email,
    subject: `TechAsset - ${title}`,
    text: `${title}\n${body || ''}\n\nAbrir: ${url}`,
    html: `<div style="font-family:Arial,sans-serif;color:#e5e7eb;background:#0f172a;padding:24px"><div style="max-width:520px;margin:0 auto;background:#111c33;border:1px solid #2b3b5f;border-radius:16px;padding:22px"><h2 style="margin:0 0 8px;color:#fff">${title}</h2><p style="margin:0 0 16px;color:#aebbd4">${body || ''}</p><a href="${url}" style="display:inline-block;background:#3b82f6;color:#fff;text-decoration:none;font-weight:700;padding:11px 18px;border-radius:10px">Abrir TechAsset</a></div></div>`
  }).catch(() => { /* do not block flows because of mail */ });
}

export function notifyUser({ siteCode, email, kind = 'general', title, body = '', link = '', payload = null }) {
  if (!email || !title) return null;
  if (!wantsNotificationKind(email, kind)) return null;
  const ts = nowIso();
  const info = getDb().prepare(`
    INSERT INTO notifications (site_code, user_email, kind, title, body, link, read, payload_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
  `).run(siteCode || config.defaultSiteCode, String(email).toLowerCase(), kind, title, body, link, payload ? JSON.stringify(payload) : '', ts);
  pushToUser(email, { title, body, link });
  if (wantsEmail(email)) emailNotification(email, { title, body, link });
  return info.lastInsertRowid;
}

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
  const db = getDb();
  const users = db.prepare("SELECT email, notif_email FROM allowed_users WHERE activo=1 AND COALESCE(deleted_at,'')='' AND COALESCE(email,'')<>''").all();
  const mail = buildReleaseBroadcastMail({ version, title, bodyMd: body, appUrl });
  let inApp = 0;
  let sent = 0;
  for (const user of users) {
    const email = String(user.email).toLowerCase();
    const id = notifyUser({
      siteCode: config.defaultSiteCode,
      email,
      kind: 'release',
      title,
      body: `Version ${version} - toca para ver las novedades`,
      link: '/release-notes',
      payload: { version }
    });
    if (id) inApp += 1;
    if (Number(user.notif_email) === 1) {
      try { await sendMail({ to: email, subject: mail.subject, text: mail.text, html: mail.html }); sent += 1; } catch { /* continue */ }
    }
  }
  return { recipients: users.length, inApp, mailsSent: sent };
}

export function processNotificationOutbox() {
  const db = getDb();
  const now = nowIso();
  const rows = db.prepare(`
    SELECT * FROM notification_outbox
    WHERE status='pending' AND attempts < 5
      AND (COALESCE(due_at,'')='' OR due_at<=?)
    ORDER BY id LIMIT 20
  `).all(now);
  for (const row of rows) {
    db.prepare("UPDATE notification_outbox SET status='processing', attempts=attempts+1 WHERE id=? AND status='pending'").run(row.id);
    try {
      const recipients = outboxRecipients(row);
      let count = 0;
      let payload = null;
      try { payload = row.payload_json ? JSON.parse(row.payload_json) : null; } catch { payload = null; }
      for (const email of recipients) {
        const id = notifyUser({ siteCode: row.site_code, email, kind: row.kind, title: row.title, body: row.body, link: row.link, payload });
        if (id) count += 1;
      }
      db.prepare("UPDATE notification_outbox SET status='sent', result_count=?, processed_at=?, last_error='' WHERE id=?").run(count, nowIso(), row.id);
    } catch (error) {
      const attempts = Number(row.attempts || 0) + 1;
      db.prepare('UPDATE notification_outbox SET status=?, last_error=?, processed_at=? WHERE id=?')
        .run(attempts >= 5 ? 'error' : 'pending', String(error?.message || error).slice(0, 500), nowIso(), row.id);
    }
  }
  return rows.length;
}

function outboxRecipients(row) {
  const db = getDb();
  const audience = String(row.audience || 'site').toLowerCase();
  if (audience === 'user') return String(row.user_email || '').trim() ? [String(row.user_email).toLowerCase()] : [];
  if (audience === 'all') {
    return db.prepare("SELECT DISTINCT lower(email) AS email FROM allowed_users WHERE activo=1 AND COALESCE(deleted_at,'')='' AND COALESCE(email,'')<>''")
      .all().map(item => item.email).filter(Boolean);
  }
  return db.prepare(`
    SELECT DISTINCT lower(au.email) AS email
    FROM allowed_users au
    LEFT JOIN allowed_user_sites aus ON aus.allowed_user_id=au.id AND upper(aus.site_code)=upper(?) AND aus.activo=1
    WHERE au.activo=1 AND COALESCE(au.deleted_at,'')=''
      AND (upper(COALESCE(aus.site_code,''))=upper(?) OR au.default_role='Superadmin')
  `).all(row.site_code, row.site_code).map(item => item.email).filter(Boolean);
}

export function processDueReminders() {
  const db = getDb();
  const now = nowIso();
  const rows = db.prepare(`
    SELECT * FROM reminders WHERE active=1 AND status='pending'
      AND COALESCE(notification_sent_at,'')='' AND remind_at<=?
    ORDER BY remind_at LIMIT 50
  `).all(now);
  for (const row of rows) {
    const email = String(row.owner_email || row.created_by_email || '').toLowerCase();
    if (email) notifyUser({
      siteCode: row.site_code,
      email,
      kind: 'reminder.due',
      title: `Recordatorio: ${row.title}`,
      body: [row.description, row.related_label].filter(Boolean).join(' · '),
      link: `/sede/${String(row.site_code || config.defaultSiteCode).toLowerCase()}/reminders`,
      payload: { reminderId: row.id, relatedType: row.related_type, relatedId: row.related_id }
    });
    db.prepare('UPDATE reminders SET notification_sent_at=?, updated_at=? WHERE id=?').run(nowIso(), nowIso(), row.id);
  }
  return rows.length;
}

let notificationWorkerTimer = null;
export function startNotificationWorkers(intervalMs = 10000) {
  if (notificationWorkerTimer) return notificationWorkerTimer;
  const tick = () => {
    try { processNotificationOutbox(); processDueReminders(); }
    catch (error) { console.error('[notification-worker]', error?.message || error); }
  };
  tick();
  notificationWorkerTimer = setInterval(tick, Math.max(5000, intervalMs));
  notificationWorkerTimer.unref?.();
  return notificationWorkerTimer;
}
