// Adaptador de proveedor de IA. Una sola interfaz para todo lo que usa IA en el
// server (chat del asistente con herramientas, resúmenes de tickets/equipos y
// diagnóstico de aulas), con dos implementaciones:
//
//   - Anthropic (Claude, default con AI_PROVIDER=anthropic y ANTHROPIC_API_KEY).
//   - OpenAI (Responses API, la de antes), mientras siga habiendo OPENAI_API_KEY,
//     para poder volver atrás cambiando solo AI_PROVIDER.
//
// Interfaz (la misma para los dos):
//   getAiProvider()            -> proveedor activo o null (sin key = modo local)
//   provider.createChat({ system, context, tools, messages })
//        system  = texto estable (va cacheado)
//        context = texto volátil y confiable (fecha/hora, sede): va después del
//                  bloque cacheado para no invalidarlo
//        tools   = definiciones en formato Anthropic { name, description, input_schema, strict }
//        messages= historial [{ role:'user'|'assistant', content: string | bloques }]
//     chat.step({ allowTools, onText, signal }) -> { text, toolCalls:[{id,name,input}], stopReason, usage }
//     chat.addToolResults([{ id, content: string, isError }])
//   provider.generateText({ system, input, maxTokens, effort, schema, signal }) -> { text, usage }
//
// Las keys viven solo en variables de entorno del server. Nunca se loguea
// contenido: solo proveedor, modelo, tokens y latencia.
import Anthropic from '@anthropic-ai/sdk';
import { config } from '../../config.js';
import { callOpenAiResponses, responseOutputText } from '../openaiResponses.service.js';

const DEFAULT_ANTHROPIC_MODEL = 'claude-haiku-5-5';
const DEFAULT_OPENAI_MODEL = 'gpt-4.1-mini';
const VALID_EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);

// Error del proveedor ya traducido: `kind` sirve para decidir (reintentar,
// caer a modo local) y `userMessage` es lo único que puede ver el usuario.
export class AiProviderError extends Error {
  constructor(kind, message, { status, cause } = {}) {
    super(message);
    this.name = 'AiProviderError';
    this.kind = kind;
    this.status = status;
    if (cause) this.cause = cause;
  }

  get userMessage() {
    switch (this.kind) {
      case 'rate_limit': return 'El servicio de IA está saturado en este momento. Probá de nuevo en un rato.';
      case 'overloaded': return 'El servicio de IA está con mucha demanda. Probá de nuevo en unos segundos.';
      case 'auth': return 'El servicio de IA no está bien configurado en el servidor (credenciales).';
      case 'aborted': return 'Se canceló la consulta.';
      default: return 'No pude conectarme con el servicio de IA en este momento. Probá de nuevo en unos segundos.';
    }
  }
}

function resolveProviderName() {
  const wanted = String(config.aiProvider || '').toLowerCase();
  const hasAnthropic = Boolean(config.anthropicApiKey);
  const hasOpenai = Boolean(config.openaiApiKey);
  if (['local', 'none', 'off'].includes(wanted)) return null;
  if (wanted === 'openai') return hasOpenai ? 'openai' : hasAnthropic ? 'anthropic' : null;
  if (wanted === 'anthropic') return hasAnthropic ? 'anthropic' : hasOpenai ? 'openai' : null;
  // Sin AI_PROVIDER: se elige Anthropic si hay key; OpenAI queda como respaldo.
  return hasAnthropic ? 'anthropic' : hasOpenai ? 'openai' : null;
}

function anthropicModel() {
  const model = String(config.aiModel || '').trim();
  return model.startsWith('claude') ? model : DEFAULT_ANTHROPIC_MODEL;
}

function openaiModel() {
  const explicit = String(config.openaiModel || '').trim();
  if (explicit) return explicit;
  const model = String(config.aiModel || '').trim();
  return model && !model.startsWith('claude') ? model : DEFAULT_OPENAI_MODEL;
}

function chatEffort() {
  const value = String(config.aiEffort || '').toLowerCase();
  return VALID_EFFORTS.has(value) ? value : 'low';
}

let cached = { key: '', provider: null };

export function getAiProvider() {
  const name = resolveProviderName();
  const key = `${name}:${name === 'anthropic' ? anthropicModel() : openaiModel()}`;
  if (cached.key === key) return cached.provider;
  const provider = name === 'anthropic' ? createAnthropicProvider() : name === 'openai' ? createOpenAiProvider() : null;
  cached = { key, provider };
  return provider;
}

export function aiProviderInfo() {
  const provider = getAiProvider();
  return {
    provider: provider?.name || 'local',
    model: provider?.model || 'local-rules',
    streaming: Boolean(provider?.supportsStreaming)
  };
}

// Tokens en un formato común para el log y el tope diario.
function emptyUsage() {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
}

export function addUsage(total, usage) {
  if (!usage) return total;
  total.inputTokens += usage.inputTokens || 0;
  total.outputTokens += usage.outputTokens || 0;
  total.cacheReadTokens += usage.cacheReadTokens || 0;
  total.cacheWriteTokens += usage.cacheWriteTokens || 0;
  return total;
}

export { emptyUsage };

// ---------------------------------------------------------------------------
// Anthropic
// ---------------------------------------------------------------------------

function createAnthropicProvider() {
  // new Anthropic() toma ANTHROPIC_API_KEY del entorno (dotenv ya lo cargó en config.js).
  const client = new Anthropic({ timeout: 60_000, maxRetries: 2 });
  const model = anthropicModel();

  function mapError(error) {
    if (error instanceof AiProviderError) return error;
    if (error instanceof Anthropic.APIUserAbortError) return new AiProviderError('aborted', 'Consulta cancelada', { cause: error });
    if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) return new AiProviderError('auth', `Anthropic ${error.status}`, { status: error.status, cause: error });
    if (error instanceof Anthropic.RateLimitError) return new AiProviderError('rate_limit', 'Anthropic 429', { status: 429, cause: error });
    if (error instanceof Anthropic.BadRequestError) return new AiProviderError('bad_request', `Anthropic 400: ${String(error.message || '').slice(0, 300)}`, { status: 400, cause: error });
    if (error instanceof Anthropic.InternalServerError) return new AiProviderError('overloaded', `Anthropic ${error.status}`, { status: error.status, cause: error });
    if (error instanceof Anthropic.APIConnectionError) return new AiProviderError('connection', 'Anthropic sin conexión', { cause: error });
    if (error instanceof Anthropic.APIError) return new AiProviderError('unknown', `Anthropic ${error.status}`, { status: error.status, cause: error });
    return new AiProviderError('unknown', String(error?.message || error), { cause: error });
  }

  function usageOf(message) {
    const u = message?.usage || {};
    return {
      inputTokens: u.input_tokens || 0,
      outputTokens: u.output_tokens || 0,
      cacheReadTokens: u.cache_read_input_tokens || 0,
      cacheWriteTokens: u.cache_creation_input_tokens || 0
    };
  }

  function textOf(message) {
    return (message?.content || []).filter(block => block.type === 'text').map(block => block.text).join('').trim();
  }

  // El system estable va primero y con cache_control: se cachea junto con las
  // herramientas (el orden de render es tools -> system -> messages). Lo
  // volátil va en un bloque aparte, después del punto de caché.
  function systemBlocks(system, context) {
    const blocks = [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }];
    if (context) blocks.push({ type: 'text', text: context });
    return blocks;
  }

  // La API exige que la conversación arranque con un turno del usuario.
  function normalizeHistory(messages) {
    const list = (messages || []).filter(m => m && (m.role === 'user' || m.role === 'assistant') && hasContent(m.content));
    while (list.length && list[0].role !== 'user') list.shift();
    return list.map(m => ({ role: m.role, content: m.content }));
  }

  return {
    name: 'anthropic',
    model,
    supportsStreaming: true,

    createChat({ system, context = '', tools = [], messages = [] }) {
      const history = normalizeHistory(messages);
      const anthropicTools = tools.map(tool => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.input_schema,
        ...(tool.strict ? { strict: true } : {})
      }));
      return {
        async step({ allowTools = true, onText, signal } = {}) {
          const params = {
            model,
            max_tokens: 8000,
            system: systemBlocks(system, context),
            messages: history,
            output_config: { effort: chatEffort() },
            ...(anthropicTools.length ? { tools: anthropicTools, tool_choice: { type: allowTools ? 'auto' : 'none' } } : {})
          };
          let message;
          try {
            if (onText) {
              const stream = client.messages.stream(params, { signal });
              stream.on('text', delta => { try { onText(delta); } catch { /* el consumidor no corta el stream */ } });
              message = await stream.finalMessage();
            } else {
              message = await client.messages.create(params, { signal });
            }
          } catch (error) {
            throw mapError(error);
          }

          const stopReason = message.stop_reason;
          // Antes de leer content: una negativa o un corte por max_tokens no
          // pueden ejecutar herramientas (el input podría venir truncado).
          if (stopReason === 'refusal') {
            return { text: '', toolCalls: [], stopReason, usage: usageOf(message), refusal: message.stop_details?.category || 'refusal' };
          }
          // Se guarda el contenido completo (incluidos los bloques de thinking)
          // para que la conversación siga siendo append-only.
          history.push({ role: 'assistant', content: message.content });
          const toolCalls = stopReason === 'tool_use'
            ? message.content.filter(block => block.type === 'tool_use').map(block => ({ id: block.id, name: block.name, input: block.input && typeof block.input === 'object' ? block.input : {} }))
            : [];
          return { text: textOf(message), toolCalls, stopReason, usage: usageOf(message) };
        },

        // Todos los resultados de una ronda van en UN solo mensaje del usuario.
        addToolResults(results) {
          history.push({
            role: 'user',
            content: results.map(result => ({
              type: 'tool_result',
              tool_use_id: result.id,
              content: String(result.content ?? ''),
              ...(result.isError ? { is_error: true } : {})
            }))
          });
        }
      };
    },

    async generateText({ system, input, maxTokens = 1500, effort = 'low', schema = null, signal } = {}) {
      const params = {
        model,
        max_tokens: maxTokens,
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: String(input || '') }],
        output_config: {
          effort: VALID_EFFORTS.has(effort) ? effort : 'low',
          ...(schema ? { format: { type: 'json_schema', schema } } : {})
        }
      };
      let message;
      try {
        message = await client.messages.create(params, { signal });
      } catch (error) {
        throw mapError(error);
      }
      if (message.stop_reason === 'refusal') throw new AiProviderError('refusal', 'La IA no generó el texto (refusal).');
      if (message.stop_reason === 'max_tokens' && schema) throw new AiProviderError('truncated', 'Respuesta JSON cortada por max_tokens.');
      const text = textOf(message);
      if (!text) throw new AiProviderError('empty', 'Respuesta de IA vacía.');
      return { text, usage: usageOf(message), stopReason: message.stop_reason };
    }
  };
}

// ---------------------------------------------------------------------------
// OpenAI (Responses API) — respaldo mientras exista OPENAI_API_KEY
// ---------------------------------------------------------------------------

function createOpenAiProvider() {
  const model = openaiModel();

  function usageOf(data) {
    const u = data?.usage || {};
    return {
      inputTokens: u.input_tokens || 0,
      outputTokens: u.output_tokens || 0,
      cacheReadTokens: u.input_tokens_details?.cached_tokens || 0,
      cacheWriteTokens: 0
    };
  }

  async function call(body) {
    try {
      return await callOpenAiResponses({ ...body, model });
    } catch (error) {
      const status = Number(String(error?.message || '').match(/HTTP (\d{3})/)?.[1] || 0);
      const kind = status === 429 ? 'rate_limit' : status === 401 || status === 403 ? 'auth' : status >= 500 ? 'overloaded' : status === 400 ? 'bad_request' : 'connection';
      throw new AiProviderError(kind, `OpenAI ${status || 'error'}`, { status, cause: error });
    }
  }

  return {
    name: 'openai',
    model,
    supportsStreaming: false,

    createChat({ system, context = '', tools = [], messages = [] }) {
      const input = [
        { role: 'system', content: [system, context].filter(Boolean).join('\n\n') },
        ...(messages || []).map(m => ({ role: m.role, content: flattenContent(m.content) })).filter(m => m.content)
      ];
      const openaiTools = tools.map(tool => ({ type: 'function', name: tool.name, description: tool.description, parameters: tool.input_schema }));
      return {
        async step({ allowTools = true, onText } = {}) {
          const data = await call({ input, tools: openaiTools, toolChoice: allowTools ? 'auto' : 'none' });
          const calls = (data.output || []).filter(item => item.type === 'function_call');
          const toolCalls = calls.map(item => {
            input.push({ type: 'function_call', call_id: item.call_id, name: item.name, arguments: item.arguments });
            return { id: item.call_id, name: item.name, input: parseJsonObject(item.arguments) };
          });
          const text = toolCalls.length ? '' : responseOutputText(data);
          // Sin streaming real: se entrega el texto entero de una vez.
          if (text && onText) onText(text);
          return { text, toolCalls, stopReason: toolCalls.length ? 'tool_use' : 'end_turn', usage: usageOf(data) };
        },
        addToolResults(results) {
          for (const result of results) input.push({ type: 'function_call_output', call_id: result.id, output: String(result.content ?? '') });
        }
      };
    },

    async generateText({ system, input, maxTokens = 1500 } = {}) {
      const data = await call({ instructions: system, input: String(input || ''), maxOutputTokens: maxTokens });
      const text = responseOutputText(data);
      if (!text) throw new AiProviderError('empty', 'Respuesta de IA vacía.');
      return { text, usage: usageOf(data), stopReason: 'end_turn' };
    }
  };
}

// ---------------------------------------------------------------------------

function hasContent(content) {
  if (typeof content === 'string') return Boolean(content.trim());
  return Array.isArray(content) && content.length > 0;
}

function flattenContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map(block => (typeof block === 'string' ? block : block?.text || '')).filter(Boolean).join('\n\n');
}

function parseJsonObject(raw) {
  try {
    const value = JSON.parse(raw || '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}
