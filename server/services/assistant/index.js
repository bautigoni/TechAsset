import { config } from '../../config.js';
import { runToolLoop } from './chat.service.js';

const DEFAULT_ACCESS = { siteCode: '', role: 'Consulta', canEdit: false, isManager: false, user: { id: 0, email: '', nombre: '' } };

export function assistantStatus() {
  return {
    ok: true,
    mode: config.openaiApiKey ? 'openai' : 'local',
    hasApiKey: Boolean(config.openaiApiKey),
    model: config.openaiApiKey ? (config.openaiModel || 'gpt-4.1-mini') : 'local-rules',
    promptId: config.openaiPromptId || ''
  };
}

export async function handleAssistantChat({ messages = [], access = DEFAULT_ACCESS, context = null }) {
  return runToolLoop({ messages, access, context });
}
