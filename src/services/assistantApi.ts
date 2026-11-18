import { apiSend } from './apiClient';

export interface AssistantAction {
  id: string;
  type: 'lend' | 'return' | 'roster';
  label: string;
  summary: string;
  payload: Record<string, unknown>;
}

export interface AssistantResponse {
  reply: string;
  suggestedRoute?: string | null;
  suggestedDevice?: string | null;
  /** Ficha a abrir sola: solo si pidieron abrirla y hay una sola. */
  openDevice?: string | null;
  /** Equipos que salieron en la respuesta: se muestran como botones "Ver ficha". */
  devices?: Array<{ etiqueta: string; alias?: string }>;
  /** Préstamos, devoluciones o listas que esperan el botón «Confirmar». */
  actions?: AssistantAction[];
  /** Lo que consultó en esta vuelta; se reenvía con el historial para que lo recuerde. */
  memory?: string;
}

export interface AssistantContext { type:string; id?:string; label?:string; data?:Record<string,unknown>; view?:string }
export function sendAssistantMessage(messages: Array<{ role: string; content: string; memory?: string }>, context?:AssistantContext|null) {
  return apiSend<AssistantResponse>('/api/asistente/chat', 'POST', { messages, context });
}

export function confirmAssistantAction(action: AssistantAction) {
  return apiSend<{ ok: true; message: string }>('/api/asistente/confirmar', 'POST', { action: { type: action.type, payload: action.payload } });
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
