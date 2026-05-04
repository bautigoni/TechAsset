import { apiSend } from './apiClient';

export interface AssistantChatResponse {
  reply: string;
  intent: string;
  needsConfirmation: boolean;
  pendingAction: Record<string, unknown> | null;
  suggestedActions: string[];
  data: Record<string, unknown>;
}

export function sendAssistantMessage(payload: { message: string; action?: string; conversationId?: string; context?: Record<string, unknown> }) {
  return apiSend<AssistantChatResponse>('/api/asistente/chat', 'POST', payload);
}
