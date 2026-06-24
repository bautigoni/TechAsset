import { Router } from 'express';
import { getDb, nowIso } from '../db.js';
import { config } from '../config.js';
import { broadcastRelease } from '../services/notifications.service.js';

export const notificationsRouter = Router();

const userEmail = (req) => String(req.user?.email || '').toLowerCase();
const isSuperadmin = (req) => String(req.user?.rolGlobal || '') === 'Superadmin';

function rowToNotification(row) {
  return {
    id: row.id,
    siteCode: row.site_code,
    kind: row.kind,
    title: row.title,
    body: row.body || '',
    link: row.link || '',
    read: Number(row.read) === 1,
    createdAt: row.created_at
  };
}

notificationsRouter.get('/notifications', (req, res) => {
  const email = userEmail(req);
  if (!email) return res.json({ ok: true, items: [], unread: 0 });
  const onlyUnread = req.query.unread === '1';
  const rows = getDb().prepare(`
    SELECT * FROM notifications
    WHERE lower(user_email)=? ${onlyUnread ? 'AND read=0' : ''}
    ORDER BY created_at DESC LIMIT 30
  `).all(email);
  const unread = getDb().prepare('SELECT COUNT(*) AS n FROM notifications WHERE lower(user_email)=? AND read=0').get(email).n;
  res.json({ ok: true, items: rows.map(rowToNotification), unread });
});

notificationsRouter.patch('/notifications/:id/read', (req, res) => {
  getDb().prepare('UPDATE notifications SET read=1 WHERE id=? AND lower(user_email)=?').run(req.params.id, userEmail(req));
  res.json({ ok: true });
});

notificationsRouter.post('/notifications/read-all', (req, res) => {
  getDb().prepare('UPDATE notifications SET read=1 WHERE lower(user_email)=? AND read=0').run(userEmail(req));
  res.json({ ok: true });
});

notificationsRouter.get('/push/vapid-public-key', (_req, res) => {
  res.json({ ok: true, publicKey: config.vapid.publicKey || '' });
});

// Preferencias de notificación del usuario (push + mail).
notificationsRouter.get('/notifications/prefs', (req, res) => {
  const email = userEmail(req);
  const row = getDb().prepare('SELECT notif_email FROM allowed_users WHERE lower(email)=?').get(email);
  const subs = getDb().prepare('SELECT COUNT(*) AS n FROM push_subscriptions WHERE lower(user_email)=?').get(email).n;
  res.json({
    ok: true,
    email: row ? Number(row.notif_email) === 1 : false,
    pushSubscribed: subs > 0,
    pushAvailable: Boolean(config.vapid.publicKey)
  });
});

notificationsRouter.post('/notifications/prefs', (req, res) => {
  const email = userEmail(req);
  if (typeof req.body?.email === 'boolean') {
    getDb().prepare('UPDATE allowed_users SET notif_email=? WHERE lower(email)=?').run(req.body.email ? 1 : 0, email);
  }
  res.json({ ok: true });
});

notificationsRouter.post('/push/subscribe', (req, res) => {
  const sub = req.body?.subscription || req.body;
  const endpoint = String(sub?.endpoint || '');
  const p256dh = String(sub?.keys?.p256dh || '');
  const auth = String(sub?.keys?.auth || '');
  if (!endpoint) return res.status(400).json({ ok: false, error: 'Suscripción inválida.' });
  const ts = nowIso();
  getDb().prepare(`
    INSERT INTO push_subscriptions (user_email, site_code, endpoint, p256dh, auth, created_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(endpoint) DO UPDATE SET user_email=excluded.user_email, site_code=excluded.site_code, p256dh=excluded.p256dh, auth=excluded.auth, last_seen_at=excluded.last_seen_at
  `).run(userEmail(req), req.siteCode || config.defaultSiteCode, endpoint, p256dh, auth, ts, ts);
  res.json({ ok: true });
});

notificationsRouter.delete('/push/subscribe', (req, res) => {
  const endpoint = String(req.body?.endpoint || '');
  if (endpoint) getDb().prepare('DELETE FROM push_subscriptions WHERE endpoint=?').run(endpoint);
  res.json({ ok: true });
});

// F1.6: broadcast de release (solo Superadmin). Idempotente por versión.
notificationsRouter.post('/admin/release-notes', async (req, res) => {
  if (!isSuperadmin(req)) return res.status(403).json({ ok: false, error: 'Solo Superadmin puede enviar releases.' });
  const version = String(req.body?.version || '').trim();
  const title = String(req.body?.title || '').trim();
  const body = String(req.body?.body || '').trim();
  if (!version || !title) return res.status(400).json({ ok: false, error: 'Faltan versión o título.' });

  const existing = getDb().prepare('SELECT version, sent_at FROM release_notes WHERE version=?').get(version);
  if (existing && existing.sent_at) {
    return res.status(409).json({ ok: false, error: `La versión ${version} ya fue enviada el ${existing.sent_at}.` });
  }
  const ts = nowIso();
  getDb().prepare(`
    INSERT INTO release_notes (version, title, body_md, sent_at, sent_by)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(version) DO UPDATE SET title=excluded.title, body_md=excluded.body_md, sent_at=excluded.sent_at, sent_by=excluded.sent_by
  `).run(version, title, body, ts, userEmail(req));

  const result = await broadcastRelease({ version, title, body });
  res.json({ ok: true, ...result });
});

// Último release publicado (para el modal "Qué hay de nuevo").
notificationsRouter.get('/release-notes/latest', (_req, res) => {
  const row = getDb().prepare("SELECT version, title, body_md FROM release_notes WHERE COALESCE(sent_at,'')<>'' ORDER BY sent_at DESC LIMIT 1").get();
  res.json({ ok: true, release: row ? { version: row.version, title: row.title, bodyMd: row.body_md || '' } : null });
});
