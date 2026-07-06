import { Router } from 'express';
import { assistantStatus, handleAssistantChat } from '../services/assistant/index.js';
import { transcribeAssistantAudio } from '../services/assistant/audio.service.js';
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
const audioBuckets = new Map();
function rateLimited(userId) {
  const now = Date.now();
  const bucket = buckets.get(userId) || [];
  const recent = bucket.filter(ts => now - ts < 60000);
  if (recent.length >= 15) { buckets.set(userId, recent); return true; }
  recent.push(now);
  buckets.set(userId, recent);
  return false;
}

function audioRateLimited(userId) {
  const now = Date.now();
  const bucket = audioBuckets.get(userId) || [];
  const recent = bucket.filter(ts => now - ts < 60000);
  if (recent.length >= 8) { audioBuckets.set(userId, recent); return true; }
  recent.push(now);
  audioBuckets.set(userId, recent);
  return false;
}

function normalizeMessages(body = {}) {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  if (messages.length) {
    return messages
      .map(message => ({
        role: message?.role === 'assistant' ? 'assistant' : 'user',
        content: String(message?.content || message?.text || '').trim()
      }))
      .filter(message => message.content);
  }

  const legacyMessage = String(body.message || body.text || '').trim();
  return legacyMessage ? [{ role: 'user', content: legacyMessage }] : [];
}

assistantRouter.post('/asistente/chat', async (req, res, next) => {
  try {
    if (rateLimited(req.user?.id || req.ip)) {
      return res.status(429).json({ ok: false, error: 'Demasiados mensajes. Esperá un momento.' });
    }
    const result = await handleAssistantChat({
      messages: normalizeMessages(req.body),
      access: buildAccess(req)
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

assistantRouter.post('/asistente/transcribir', async (req, res, next) => {
  try {
    if (audioRateLimited(req.user?.id || req.ip)) {
      return res.status(429).json({ ok: false, error: 'Demasiados audios seguidos. Esperá un momento.' });
    }
    const result = await transcribeAssistantAudio({
      audioBase64: req.body?.audio,
      mimeType: req.body?.mimeType
    });
    res.json({ ok: true, ...result });
  } catch (error) {
    if (/no se recibió|vacío|formato|demasiado largo|no pude entender/i.test(error?.message || '')) {
      return res.status(400).json({ ok: false, error: error.message });
    }
    next(error);
  }
});

assistantRouter.get('/asistente/status', (_req, res) => {
  res.json(assistantStatus());
});
