import { Router } from 'express';
import { getDb } from '../db.js';
import { requireSite } from '../services/siteContext.service.js';

export const analyticsRouter = Router();

analyticsRouter.get('/analytics', (_req, res) => {
  const movements = getDb().prepare('SELECT * FROM local_movements WHERE site_code=? ORDER BY id DESC LIMIT 500').all(requireSite(_req));
  res.json({ ok: true, movements });
});
