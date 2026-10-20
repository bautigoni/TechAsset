import { apiSend, clearApiCache, siteHeaders, SESSION_EXPIRED_EVENT } from './apiClient';

/** Acción de escritura que hizo el asistente; `undo` alimenta el botón "Deshacer". */
export interface AssistantAction {
  id: number;
  tool: string;
  label: string;
  undo: { actionId: number; tipo: string } | null;
}

export interface AssistantResponse {
  reply: string;
  suggestedRoute?: string | null;
  suggestedDevice?: string | null;
  actions?: AssistantAction[];
  /** Más de 5 equipos en un pedido: el asistente pregunta antes de ejecutar. */
  pendingConfirmation?: { tipo: 'lote'; cantidad: number; equipos: string[] };
}

export interface AssistantContext { type:string; id?:string; label?:string; data?:Record<string,unknown>; view?:string }

/** Deshace una acción del asistente (mismos permisos que la acción original). */
export function undoAssistantAction(actionId: number) {
  return apiSend<{ ok: true; actionId: number; tipo: string; mensaje: string }>('/api/asistente/deshacer', 'POST', { actionId });
}

export interface AssistantStreamHandlers {
  /** Texto a medida que se genera. */
  onDelta?: (text: string) => void;
  /** El asistente está consultando o ejecutando una herramienta. */
  onTool?: (name: string) => void;
  /** Acción ejecutada (para mostrar la tarjeta con Deshacer al instante). */
  onAction?: (action: AssistantAction) => void;
  signal?: AbortSignal;
}

/**
 * Igual que sendAssistantMessage pero por SSE (POST /api/asistente/chat/stream):
 * va llamando a onDelta con el texto y resuelve con la respuesta completa.
 */
export async function streamAssistantMessage(
  messages: Array<{ role: string; content: string }>,
  context: AssistantContext | null | undefined,
  handlers: AssistantStreamHandlers = {}
): Promise<AssistantResponse> {
  clearApiCache();
  const response = await fetch('/api/asistente/chat/stream', {
    method: 'POST',
    headers: siteHeaders({ 'Content-Type': 'application/json', Accept: 'text/event-stream' }),
    body: JSON.stringify({ messages, context }),
    signal: handlers.signal
  });
  if (response.status === 401) window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
  if (!response.ok || !response.body) {
    const data = await response.json().catch(() => ({} as Record<string, unknown>));
    throw new Error(String((data as { error?: string }).error || `HTTP ${response.status}`));
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result: AssistantResponse | null = null;
  let failure = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let boundary;
    while ((boundary = buffer.indexOf('\n\n')) >= 0) {
      const raw = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const event = raw.match(/^event: (.+)$/m)?.[1] || 'message';
      const dataLine = raw.match(/^data: (.*)$/m)?.[1];
      if (!dataLine) continue;
      const data = JSON.parse(dataLine);
      if (event === 'delta') handlers.onDelta?.(String(data.text || ''));
      else if (event === 'tool') handlers.onTool?.(String(data.name || ''));
      else if (event === 'action') handlers.onAction?.(data as AssistantAction);
      else if (event === 'done') result = data as AssistantResponse;
      else if (event === 'error') failure = String(data.error || 'No pude procesar el mensaje.');
    }
  }
  clearApiCache();
  if (result) return result;
  throw new Error(failure || 'Se cortó la respuesta del asistente.');
}
