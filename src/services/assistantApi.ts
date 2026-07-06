import { apiSend } from './apiClient';

export interface AssistantResponse {
  reply: string;
  suggestedRoute?: string | null;
}

export function sendAssistantMessage(messages: Array<{ role: string; content: string }>) {
  return apiSend<AssistantResponse>('/api/asistente/chat', 'POST', { messages });
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('No pude leer el audio grabado.'));
    reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
    reader.readAsDataURL(blob);
  });
}

export async function transcribeAssistantAudio(blob: Blob): Promise<string> {
  const audio = await blobToBase64(blob);
  const response = await apiSend<{ ok: true; text: string }>('/api/asistente/transcribir', 'POST', {
    audio,
    mimeType: blob.type || 'audio/webm'
  });
  return response.text;
}
