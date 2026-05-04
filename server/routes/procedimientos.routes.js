import { Router } from 'express';
import { procedureStatus, reindexProcedures, searchProcedures } from '../services/procedureSearch.js';

export const procedimientosRouter = Router();

procedimientosRouter.get('/procedimientos/search', async (req, res) => {
  const q = String(req.query.q || '');
  const items = await searchProcedures(q);
  res.json({ ok: true, items });
});

procedimientosRouter.get('/procedimientos/status', async (_req, res) => {
  res.json(await procedureStatus());
});

procedimientosRouter.post('/procedimientos/reindex', async (_req, res) => {
  const result = await reindexProcedures();
  res.json(result.status);
});
