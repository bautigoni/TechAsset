import { searchProcedures } from '../procedureSearch.js';
import { normalize } from './utils.js';

export async function procedureAnswer(text, memory, action = '') {
  if (isEmptyProcedureRequest(text, action)) {
    memory.activeFlow = 'procedure_query';
    memory.waitingFor = 'procedure_query';
    return ask('Decime qué procedimiento o situación querés consultar. Por ejemplo: "notebook dañada", "falta cargador" o "cómo prestar un equipo".', 'procedure_query');
  }
  const results = await searchProcedures(text);
  memory.activeFlow = null;
  memory.waitingFor = null;
  memory.collectedData = {};
  if (!results.length) return response('No encontré información suficiente en los documentos de procedimiento cargados para responder con precisión. Te recomiendo validarlo con la coordinación o responsable TIC.', 'procedure_query');
  return response(`${results[0].excerpt}\n\nFuente: ${results[0].source}`, 'procedure_query', { results });
}

function isEmptyProcedureRequest(text, action = '') {
  const lower = normalize(text);
  if (action === 'procedure_search' && (!lower || lower === 'consultar procedimiento')) return true;
  return !lower || lower === 'consultar procedimiento' || lower === 'procedimiento';
}

function response(reply, intent, data = {}) {
  return { reply, intent, needsConfirmation: false, pendingAction: null, suggestedActions: [], data };
}

function ask(reply, intent) {
  return { reply, intent, needsConfirmation: false, pendingAction: null, suggestedActions: [], data: {} };
}
