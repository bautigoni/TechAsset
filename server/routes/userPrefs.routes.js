import { Router } from 'express';
import { getDb } from '../db.js';

export const userPrefsRouter = Router();

userPrefsRouter.get('/user/prefs', (req, res) => {
  if (!req.user?.id) return res.status(401).json({ ok: false, error: 'No autenticado' });
  const db = getDb();
  const row = db.prepare('SELECT prefs_json FROM allowed_users WHERE id = @id').get({ id: req.user.id });
  let prefs = {};
  if (row?.prefs_json) {
    try { prefs = JSON.parse(row.prefs_json); } catch { /* ignore */ }
  }
  res.json({ ok: true, prefs });
});

userPrefsRouter.patch('/user/prefs', (req, res) => {
  if (!req.user?.id) return res.status(401).json({ ok: false, error: 'No autenticado' });
  const db = getDb();
  const row = db.prepare('SELECT prefs_json FROM allowed_users WHERE id = @id').get({ id: req.user.id });
  let current = {};
  if (row?.prefs_json) {
    try { current = JSON.parse(row.prefs_json); } catch { /* ignore */ }
  }
  const merged = { ...current, ...req.body };
  db.prepare("UPDATE allowed_users SET prefs_json = @prefs, updated_at = datetime('now') WHERE id = @id").run({
    prefs: JSON.stringify(merged),
    id: req.user.id
  });
  res.json({ ok: true, prefs: merged });
});
