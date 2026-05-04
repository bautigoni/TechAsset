import { Router } from 'express';
import { getDb } from '../db.js';

export const analyticsRouter = Router();

analyticsRouter.get('/analytics', (_req, res) => {
  const movements = getDb().prepare('SELECT * FROM local_movements ORDER BY id DESC LIMIT 500').all();
  res.json({ ok: true, movements });
});
