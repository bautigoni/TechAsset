import { Router } from 'express';
import { assistantStatus, handleAssistantChat, handleAssistantUndo } from '../services/assistant/index.js';
import { canEditModule, canEditSite, getActiveSiteRole, isSiteManager } from '../services/siteContext.service.js';

export const assistantRouter = Router();

// /asistente está exento de requireEditor (el chat es lectura para todos): los
// permisos de escritura se chequean por herramienta en el server con esto.
function buildAccess(req) {
  return {
    siteCode: req.siteCode,
    role: getActiveSiteRole(req),
    canEdit: canEditSite(req),
    editModules: {
      loans: canEditModule(req, 'loans'),
      tasks: canEditModule(req, 'tasks'),
      agenda: canEditModule(req, 'agenda')
    },
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

function normalizeMessages(body = {}) {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  if (messages.length) {
    return messages
      .map(message => ({
        role: message?.role === 'assistant' ? 'assistant' : 'user',
        content: String(message?.content || message?.text || '').trim().slice(0, 4000)
      }))
      .filter(message => message.content);
  }

  const legacyMessage = String(body.message || body.text || '').trim().slice(0, 4000);
  return legacyMessage ? [{ role: 'user', content: legacyMessage }] : [];
}

function normalizeContext(value) {
  if (!value || typeof value !== 'object') return null;
  const allowed = new Set(['view','device','classroom','ticket','loan','task','purchase','suggestion','group']);
  const type = allowed.has(String(value.type)) ? String(value.type) : 'view';
  return { type, id:String(value.id||'').slice(0,120), label:String(value.label||'').slice(0,200), view:String(value.view||'').slice(0,80), data:value.data && typeof value.data==='object' ? value.data : {} };
}

// Respuesta completa de una vez (compatibilidad con el panel actual).
// Devuelve { reply, suggestedRoute, suggestedDevice, actions: [{ id, tool, label, undo: { actionId, tipo } }], pendingConfirmation? }.
assistantRouter.post('/asistente/chat', async (req, res, next) => {
  try {
    if (rateLimited(req.user?.id || req.ip)) {
      return res.status(429).json({ ok: false, error: 'Demasiados mensajes. Esperá un momento.' });
    }
    const result = await handleAssistantChat({
      messages: normalizeMessages(req.body),
      access: buildAccess(req),
      context: normalizeContext(req.body?.context)
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// Streaming (SSE): mismo cuerpo que /asistente/chat. Eventos:
//   start  { provider, model }
//   delta  { text }              texto a medida que se genera
//   tool   { name }              el asistente está consultando/ejecutando algo
//   action { id, tool, label, undo }   acción ejecutada (para la tarjeta con Deshacer)
//   done   { reply, suggestedRoute, suggestedDevice, actions, pendingConfirmation? }
//   error  { error }
assistantRouter.post('/asistente/chat/stream', async (req, res) => {
  if (rateLimited(req.user?.id || req.ip)) {
    return res.status(429).json({ ok: false, error: 'Demasiados mensajes. Esperá un momento.' });
  }
  // no-transform: el middleware de compresión no bufferea el stream.
  res.status(200).set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'X-Accel-Buffering': 'no',
    Connection: 'keep-alive'
  });
  res.flushHeaders?.();
  const controller = new AbortController();
  res.on('close', () => { if (!res.writableEnded) controller.abort(); });
  const send = (event, data) => {
    if (res.writableEnded || res.destroyed) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  const status = assistantStatus();
  send('start', { provider: status.provider, model: status.model });
  try {
    const result = await handleAssistantChat({
      messages: normalizeMessages(req.body),
      access: buildAccess(req),
      context: normalizeContext(req.body?.context),
      signal: controller.signal,
      onEvent: event => {
        if (event.type === 'delta') send('delta', { text: event.text });
        else if (event.type === 'tool') send('tool', { name: event.name });
        else if (event.type === 'action') send('action', event.action);
      }
    });
    send('done', result);
  } catch (error) {
    console.error('[assistant] error en el stream:', error?.message || error);
    send('error', { error: 'No pude procesar el mensaje. Probá de nuevo.' });
  }
  res.end();
});

// Deshace una acción del asistente. Solo recibe el id: qué revertir sale de la
// base. Mismos permisos que la acción original (ver actions.service.js).
assistantRouter.post('/asistente/deshacer', async (req, res, next) => {
  try {
    const actionId = Number(req.body?.actionId ?? req.body?.undo?.actionId);
    const result = await handleAssistantUndo({ actionId, access: buildAccess(req) });
    if (!result.ok) return res.status(result.status || 400).json({ ok: false, error: result.error });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// El dictado ahora es del navegador (src/hooks/useSpeechDictation.ts, Web
// Speech API). Se deja la ruta respondiendo 410 hasta que el panel nuevo use el hook.
assistantRouter.post('/asistente/transcribir', (_req, res) => {
  res.status(410).json({
    ok: false,
    error: 'El dictado por audio del servidor se dio de baja: ahora se usa el reconocimiento de voz del navegador. Actualizá la app (Ctrl+F5) o escribí el pedido.'
  });
});

assistantRouter.get('/asistente/status', (req, res) => {
  res.json(assistantStatus(req.siteCode));
});
