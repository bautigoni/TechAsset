import { config } from '../../config.js';
import { currentDateTimeText, sanitizeAssistantText, safeError } from './utils.js';

const TZ = 'America/Argentina/Buenos_Aires';

export function systemPrompt() {
  return `Sos el Asistente TechAsset de una aplicación escolar de gestión operativa TIC.
Respondé en español rioplatense, tono directo, práctico y cercano.
Solo iniciá flujos operativos (préstamo, devolución, tarea, agenda) cuando el usuario lo pida claramente.
No inventes datos de equipos, personas ni procedimientos.
No menciones modelos de IA, APIs, OpenAI, ni configuración técnica.
Si el usuario insulta o se frustra, respondé breve y directo sin ponerte defensivo.
Preguntá solo lo indispensable. Usá contexto previo de la conversación.
Fecha y hora actual: ${currentDateTimeText()}. Zona horaria: ${TZ}.`;
}

export async function callOpenAI(input, options = {}) {
  const body = {
    model: config.openaiModel || 'gpt-4.1-mini',
    input
  };
  if (!options.classification && config.openaiPromptId) {
    body.prompt = { id: config.openaiPromptId };
  }
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.openaiApiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    if (body.prompt) {
      delete body.prompt;
      const retry = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.openaiApiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!retry.ok) throw new Error(`OpenAI HTTP ${retry.status}`);
      const retryData = await retry.json();
      return sanitizeAssistantText(extractOpenAIText(retryData));
    }
    throw new Error(`OpenAI HTTP ${response.status}`);
  }
  const data = await response.json();
  return sanitizeAssistantText(extractOpenAIText(data));
}

function extractOpenAIText(data) {
  if (data.output_text) return String(data.output_text).trim();
  const found = [];
  const visitValue = value => {
    if (!value) return;
    if (typeof value === 'string') return;
    if (Array.isArray(value)) { value.forEach(visitValue); return; }
    if (typeof value === 'object') {
      if (typeof value.text === 'string') found.push(value.text);
      if (typeof value.content === 'string') found.push(value.content);
      Object.values(value).forEach(visitValue);
    }
  };
  const output = Array.isArray(data.output) ? data.output : [];
  for (const item of output) {
    if (item && item.type === 'reasoning') continue;
    visitValue(item);
  }
  return found.join('\n').trim();
}

export async function classifyWithOpenAI(text) {
  const INTENTS = ['general_chat', 'technical_help', 'loan_flow', 'return_flow', 'task_flow', 'agenda_flow', 'device_query', 'procedure_query', 'confirmation', 'correction'];
  const prompt = `Clasifica este mensaje para el Asistente TechAsset. Responde solo una etiqueta: ${INTENTS.join(', ')}.
PRIORIDAD:
1. Si contiene "devolv/devolucion/trajeron" → return_flow
2. Si contiene "prestamo/prestar/prestale" o equipo tipo D1435 con contexto → loan_flow
3. Si contiene "crear tarea/pendiente" → task_flow
4. Solo si dice explicitamente agendar/agenda/reservar SIN etiqueta de equipo → agenda_flow
5. general_chat para charla, saludos, preguntas sin acción operativa
Fecha actual: ${currentDateTimeText()}.
Mensaje: ${text}`;
  try {
    const output = await callOpenAI([{ role: 'user', content: prompt }], { classification: true });
    return normalize(output).replace(/[^a-z_ ]/g, '').trim().replace(/\s+/g, '_');
  } catch (error) {
    console.warn(`[assistant] OpenAI classification fallback: ${safeError(error)}`);
    return 'general_chat';
  }
}

function normalize(value) {
  return String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
}
