import { config } from '../../config.js';
import { hasClaude } from '../claude.service.js';
import { runToolLoop } from './chat.service.js';

const DEFAULT_ACCESS = { siteCode: '', role: 'Consulta', canEdit: false, isManager: false, user: { id: 0, email: '', nombre: '' } };

export function assistantStatus() {
  return {
    ok: true,
    mode: hasClaude() ? 'claude' : 'local',
    hasApiKey: hasClaude(),
    model: hasClaude() ? config.claudeModel : 'local-rules',
    voice: Boolean(config.openaiApiKey)
  };
}

export async function handleAssistantChat({ messages = [], access = DEFAULT_ACCESS, context = null }) {
  return runToolLoop({ messages, access, context });
}
