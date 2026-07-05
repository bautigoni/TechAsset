import { Router } from 'express';
import { assistantStatus, handleAssistantChat } from '../services/assistant/index.js';
import { canEditSite, getActiveSiteRole, isSiteManager } from '../services/siteContext.service.js';

export const assistantRouter = Router();

function buildAccess(req) {
  return {
    siteCode: req.siteCode,
    role: getActiveSiteRole(req),
    canEdit: canEditSite(req),
    isManager: isSiteManager(req),
    user: { id: req.user?.id || 0, email: req.user?.email || '', nombre: req.user?.nombre || '' }
  };
}

const buckets = new Map();
function rateLimited(userId) {
  const now = Date.now();
  const bucket = buckets.get(userId) || [];
  const recent = bucket.filter(ts => now - ts < 60000);
  if (recent.length >= 15) { buckets.set(userId, recent); return true; }
  recent.push(now);
  buckets.set(userId, recent);
  return false;
}

assistantRouter.post('/asistente/chat', async (req, res, next) => {
  try {
    if (rateLimited(req.user?.id || req.ip)) {
      return res.status(429).json({ ok: false, error: 'Demasiados mensajes. Esperá un momento.' });
    }
    const result = await handleAssistantChat({
      messages: req.body?.messages || [],
      access: buildAccess(req)
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

assistantRouter.get('/asistente/status', (_req, res) => {
  res.json(assistantStatus());
});
