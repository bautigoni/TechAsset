import { config } from '../../config.js';
import { normalize, isConfirmation, isCancel } from './utils.js';
import { classifyWithOpenAI } from './ai.js';
import { extractDevice, looksLikeCorrection } from './parser.js';

const INTENTS = new Set([
  'general_chat', 'technical_help', 'loan_flow', 'return_flow',
  'task_flow', 'agenda_flow', 'device_query', 'procedure_query',
  'confirmation', 'correction'
]);

const ACTION_TO_FLOW = {
  start_loan: 'loan_flow',
  start_return: 'return_flow',
  start_task: 'task_flow',
  start_agenda: 'agenda_flow',
  show_agenda: 'agenda_flow',
  procedure_search: 'procedure_query'
};

export function classifyLocal(text) {
  const lower = normalize(text);
  if (!lower) return 'general_chat';
  if (isConfirmation(lower) || isCancel(lower)) return 'general_chat';
  if (isQuickActionLabel(lower)) return quickActionToIntent(lower);

  if (/devolv|devolucion|devoluci|trajeron|me trajeron/.test(lower)) return 'return_flow';
  if (/prestamo|prestame|prestale|prestar|prestarle|registrar prestamo/.test(lower)) return 'loan_flow';
  if (/crea.*tarea|crear.*tarea|dejame pendiente|marc(a|ar).*tarea|cerr(a|ar).*tarea|resolver.*tarea/.test(lower)) return 'task_flow';
  if (/agend|agenda|evento|reserv|mantenimiento.*(manana|viernes|lunes|martes|miercoles|jueves|sabado|domingo|semana)/.test(lower)) return 'agenda_flow';
  if (/procedimiento|que hago si|criterio|penalizacion|danad|rot[ao]|falt|sin cargador|incomplet|regla/.test(lower)) return 'procedure_query';
  if (extractDevice(lower) && /\b(quien|estado|disponible|tiene|figura|donde|esta)\b/.test(lower)) return 'device_query';
  if (/no anda|no funciona|falla|proyector|audio|wifi|internet|aula|nuc|pantalla/.test(lower)) return 'technical_help';
  return 'general_chat';
}

export function forceIntentFromText(lower, raw) {
  // Preguntas de datos nunca fuerzan escritura
  if (/\b(quien|donde|estado|figura|disponible|cuantos|cuantas|desde cuando)\b/.test(lower) || raw.includes('?')) return null;

  // Return keywords
  if (/devolv|devolucion|devoluci|trajeron|me trajeron|ya volvio|entregaron|cerrar prestamo|marcar devuelta/.test(lower)) return 'return_flow';

  // Loan keywords OR device code + loan context
  const hasLoanKw = /prestamo|prestame|prestale|prestar|prestarle|asignar|registrar prestamo/.test(lower);
  const hasDevice = /\bD\s*\d{1,5}\b/.test(lower) || /\b(Touch|Plani|NUC)\s+\d{1,2}\b/.test(raw);
  const hasLoanCtx = /va a usar|va a estar|a\s+\w|en:|ubicacion|para planif|para clases/.test(lower);
  if (hasLoanKw || (hasDevice && hasLoanCtx)) return 'loan_flow';

  // Task
  if (/crea.*tarea|crear.*tarea|dejame pendiente|marc(a|ar).*tarea/.test(lower)) return 'task_flow';

  return null;
}

export async function classifyMessage({ text, action, memory }) {
  const lower = normalize(text);
  const mapped = ACTION_TO_FLOW[action];
  if (mapped) return mapped;

  if (memory.pendingConfirmation && isConfirmation(lower)) return 'confirmation';
  if (memory.pendingConfirmation && isCancel(lower)) return 'correction';
  if (memory.activeFlow && isCancel(lower) && !memory.pendingConfirmation) return 'correction';
  if (memory.activeFlow && looksLikeCorrection(text)) return 'correction';

  // Si el mensaje señala un intent DIFERENTE al flow activo, reset y reclasificar
  const forced = forceIntentFromText(lower, text);
  if (forced && forced !== memory.activeFlow) {
    memory.activeFlow = null;
    memory.waitingFor = null;
    memory.collectedData = {};
    memory.pendingConfirmation = null;
    return forced;
  }

  if (memory.activeFlow) return memory.activeFlow;

  const local = classifyLocal(text);
  if (!config.openaiApiKey || local !== 'general_chat') return local;

  const ai = await classifyWithOpenAI(text);
  return INTENTS.has(ai) ? ai : local;
}

export function isQuickActionLabel(lower) {
  return /^(registrar prestamo|registrar devolucion|consultar procedimiento|crear tarea|crear evento|ver agenda|confirmar|cancelar|volver)$/.test(lower);
}

function quickActionToIntent(lower) {
  if (lower.includes('prestamo')) return 'loan_flow';
  if (lower.includes('devolucion')) return 'return_flow';
  if (lower.includes('procedimiento')) return 'procedure_query';
  if (lower.includes('tarea')) return 'task_flow';
  if (lower.includes('evento') || lower.includes('agenda')) return 'agenda_flow';
  return 'general_chat';
}

export function isEmptyProcedureRequest(text, action = '') {
  const lower = normalize(text);
  if (action === 'procedure_search' && (!lower || lower === 'consultar procedimiento')) return true;
  return !lower || lower === 'consultar procedimiento' || lower === 'procedimiento';
}
