// Texto simple con IA (resúmenes de tickets y equipos, diagnóstico de aulas)
// a través del adaptador de proveedor, con tope diario por sede y log.
// Devuelve null cuando no hay proveedor o se llegó al tope: el que llama usa su
// versión determinística. Los errores del proveedor se propagan para que el que
// llama también caiga a esa versión.
import { getAiProvider } from './provider.js';
import { logAiCall, recordAiTokens, reserveAiCall } from './usage.js';

export async function generateAiText({ op, siteCode, system, input, maxTokens = 1500, effort = 'low', schema = null }) {
  const provider = getAiProvider();
  if (!provider) return null;
  const slot = reserveAiCall(siteCode);
  if (!slot.allowed) {
    logAiCall({ op, provider: provider.name, model: provider.model, siteCode, usage: null, ms: 0, rounds: 0, outcome: 'daily_limit' });
    return null;
  }
  const started = performance.now();
  try {
    const result = await provider.generateText({ system, input, maxTokens, effort, schema });
    recordAiTokens(siteCode, result.usage);
    logAiCall({ op, provider: provider.name, model: provider.model, siteCode, usage: result.usage, ms: performance.now() - started });
    return result.text;
  } catch (error) {
    logAiCall({ op, provider: provider.name, model: provider.model, siteCode, usage: null, ms: performance.now() - started, outcome: error?.kind || 'error' });
    throw error;
  }
}
