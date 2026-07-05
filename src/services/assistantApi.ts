import { apiSend } from './apiClient';

export interface AssistantResponse {
  reply: string;
  suggestedRoute?: string | null;
}

export function sendAssistantMessage(messages: Array<{ role: string; content: string }>) {
  return apiSend<AssistantResponse>('/api/asistente/chat', 'POST', { messages });
}
