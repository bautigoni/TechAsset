import { Router } from 'express';
import { assistantStatus, handleAssistantChat } from '../services/assistant.service.js';

export const assistantRouter = Router();

assistantRouter.post('/asistente/chat', async (req, res, next) => {
  try {
    const result = await handleAssistantChat({ ...(req.body || {}), context: { ...(req.body?.context || {}), siteCode: req.siteCode } });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

assistantRouter.get('/asistente/status', (_req, res) => {
  res.json(assistantStatus());
});

assistantRouter.post('/assistant/intent', async (req, res, next) => {
  try {
    const result = await handleAssistantChat({ message: req.body?.text || req.body?.message || '', context: { ...(req.body?.context || {}), siteCode: req.siteCode } });
    res.json({ ok: true, draft: result });
  } catch (error) {
    next(error);
  }
});
