import { config } from '../../config.js';
import { aiProviderInfo } from '../ai/provider.js';
import { aiDailyUsage } from '../ai/usage.js';
import { runToolLoop } from './chat.service.js';
import { undoAssistantAction } from './actions.service.js';

const DEFAULT_ACCESS = { siteCode: '', role: 'Consulta', canEdit: false, isManager: false, user: { id: 0, email: '', nombre: '' } };

export function assistantStatus(siteCode = '') {
  const info = aiProviderInfo();
  const active = info.provider !== 'local';
  let usage = null;
  if (siteCode) {
    try { usage = aiDailyUsage(siteCode); } catch { usage = null; }
  }
  return {
    ok: true,
    mode: info.provider,
    provider: info.provider,
    model: info.model,
    hasApiKey: active,
    streaming: info.streaming,
    // El dictado es del navegador (Web Speech API): el server ya no transcribe.
    dictation: 'browser',
    dailyLimit: config.aiDailyLimitPerSite,
    usedToday: usage ? usage.requests : null,
    promptId: config.openaiPromptId || ''
  };
}

export async function handleAssistantChat({ messages = [], access = DEFAULT_ACCESS, context = null, onEvent = null, signal = null }) {
  return runToolLoop({ messages, access, context, onEvent, signal });
}

export async function handleAssistantUndo({ actionId, access = DEFAULT_ACCESS }) {
  return undoAssistantAction({ actionId, access });
}
