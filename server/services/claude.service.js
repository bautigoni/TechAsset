import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';

// Cliente único de Claude para toda la app (asistente, resúmenes, salud de
// aulas, pedidos de cambios). Reemplaza a la Responses API de OpenAI.
// baseURL explícito: el SDK lee ANTHROPIC_BASE_URL del entorno y en una
// máquina de desarrollo esa variable puede apuntar a cualquier lado.
let client = null;

export function hasClaude() {
  return Boolean(config.anthropicApiKey);
}

export function claudeClient() {
  if (!config.anthropicApiKey) throw new Error('La IA no está configurada en este servidor (falta ANTHROPIC_API_KEY).');
  if (!client) client = new Anthropic({ apiKey: config.anthropicApiKey, baseURL: 'https://api.anthropic.com', timeout: 90_000, maxRetries: 2 });
  return client;
}

/** Texto plano de una respuesta (une los bloques de texto). */
export function responseText(response) {
  return (response?.content || [])
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('\n')
    .trim();
}

/**
 * Pedido de una sola vuelta: instrucciones + entrada → texto. Para resúmenes
 * cortos: sin thinking (Haiku lo acepta apagado con effort low) para que los
 * pocos tokens de salida vayan todos a la respuesta.
 */
export async function claudeText({ instructions, input, maxTokens = 1024 }) {
  const response = await claudeClient().messages.create({
    model: config.claudeModel,
    max_tokens: maxTokens,
    thinking: { type: 'disabled' },
    output_config: { effort: 'low' },
    system: instructions,
    messages: [{ role: 'user', content: String(input || '') }]
  });
  if (response.stop_reason === 'refusal') throw new Error('La IA no quiso responder este pedido.');
  const text = responseText(response);
  if (!text) throw new Error('Respuesta de IA vacía');
  return text;
}
