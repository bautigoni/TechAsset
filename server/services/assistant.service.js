import { getDb, nowIso, addLocalMovement } from '../db.js';
import { getMergedDevices } from './deviceInventory.service.js';
import { searchProcedures } from './procedureSearch.js';
import { config } from '../config.js';

const TZ = 'America/Argentina/Buenos_Aires';
const conversations = new Map();
let modeLogged = false;

const INTENTS = new Set([
  'general_chat',
  'technical_help',
  'loan_flow',
  'return_flow',
  'task_flow',
  'agenda_flow',
  'device_query',
  'procedure_query',
  'confirmation',
  'correction'
]);

const ACTION_TO_FLOW = {
  start_loan: 'loan_flow',
  start_return: 'return_flow',
  start_task: 'task_flow',
  start_agenda: 'agenda_flow',
  show_agenda: 'agenda_flow',
  procedure_search: 'procedure_query'
};

export function assistantStatus() {
  return {
    ok: true,
    mode: config.openaiApiKey ? 'openai' : 'local',
    hasApiKey: Boolean(config.openaiApiKey),
    model: config.openaiApiKey ? (config.openaiModel || 'gpt-4.1-mini') : 'local-rules',
    promptId: config.openaiPromptId || ''
  };
}

export async function handleAssistantChat({ message, action = '', conversationId = 'default', context = {} }) {
  logModeOnce();
  const text = String(message || '').trim();
  const memory = getMemory(conversationId);
  if (context.pendingAction && !memory.pendingConfirmation && isExecutablePending(context.pendingAction)) {
    memory.pendingConfirmation = context.pendingAction;
  }

  const intent = await classifyMessage({ text, action, memory });
  logRequest({ conversationId, message: text, action, intent, memory });

  let result;
  if (intent === 'confirmation') result = await confirmPending(memory, text);
  else if (intent === 'correction') result = await applyCorrection(memory, text);
  else if (intent === 'loan_flow') result = await handleLoanFlow(memory, text, action);
  else if (intent === 'return_flow') result = await handleReturnFlow(memory, text, action);
  else if (intent === 'task_flow') result = await handleTaskFlow(memory, text, action);
  else if (intent === 'agenda_flow') result = await handleAgendaFlow(memory, text, action);
  else if (intent === 'device_query') result = await deviceAnswer(text);
  else if (intent === 'procedure_query') result = await procedureAnswer(text, memory, action);
  else if (intent === 'technical_help') result = await technicalHelp(text);
  else result = await generalChat(text, memory);

  memory.lastIntent = intent;
  if (result.pendingAction) {
    memory.pendingConfirmation = result.needsConfirmation ? result.pendingAction : null;
  } else if (!result.needsConfirmation && intent !== 'confirmation') {
    memory.pendingConfirmation = null;
  }
  memory.messages = [...memory.messages, { role: 'user', text }, { role: 'assistant', text: result.reply }].slice(-12);
  conversations.set(conversationId, memory);
  return result;
}

function getMemory(conversationId) {
  if (!conversations.has(conversationId)) {
    conversations.set(conversationId, {
      activeFlow: null,
      waitingFor: null,
      collectedData: {},
      pendingConfirmation: null,
      lastIntent: null,
      lastDevice: '',
      lastPerson: '',
      messages: []
    });
  }
  return conversations.get(conversationId);
}

async function classifyMessage({ text, action, memory }) {
  const lower = normalize(text);
  const mapped = ACTION_TO_FLOW[action];
  if (mapped) return mapped;
  if (memory.pendingConfirmation && isConfirmation(lower)) return 'confirmation';
  if (memory.pendingConfirmation && isCancel(lower)) return 'correction';
  if (memory.activeFlow && isCancel(lower) && !memory.pendingConfirmation) return 'correction';
  if (memory.activeFlow && looksLikeCorrection(text)) return 'correction';

  // If message strongly signals a DIFFERENT intent than active flow, reset and reclassify.
  // This fixes the bug where a loan message was handled as agenda because activeFlow was agenda_flow.
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

function forceIntentFromText(lower, raw) {
  // Priority 1: explicit return keywords always win
  if (/devolv|devolucion|devoluci|trajeron|me trajeron|ya volvio|entregaron|cerrar prestamo|marcar devuelta/.test(lower)) return 'return_flow';
  // Priority 2: loan — keyword OR device code with location/person context
  const hasLoanKw = /prestamo|prestame|prestale|prestar|prestarle|asignar|registrar prestamo/.test(lower);
  const hasDevice = /\bd\s*\d{1,5}\b/.test(lower);
  const hasLoanCtx = /va a usar|va a estar|a\s+\w|en:|ubicacion|para planif|para clases/.test(lower);
  if (hasLoanKw || (hasDevice && hasLoanCtx)) return 'loan_flow';
  // Priority 3: task
  if (/crea.*tarea|crear.*tarea|dejame pendiente|marc(a|ar).*tarea/.test(lower)) return 'task_flow';
  return null;
}

function classifyLocal(text) {
  const lower = normalize(text);
  if (!lower) return 'general_chat';
  if (isConfirmation(lower) || isCancel(lower)) return 'general_chat';
  if (isQuickActionLabel(lower)) return quickActionToIntent(lower);
  // Priority order: return > loan > task > agenda
  if (/devolv|devolucion|devoluci|trajeron|me trajeron/.test(lower)) return 'return_flow';
  if (/prestamo|prestame|prestale|prestar|prestarle|registrar prestamo/.test(lower)) return 'loan_flow';
  if (/crea.*tarea|crear.*tarea|dejame pendiente|marc(a|ar).*tarea|cerr(a|ar).*tarea|resolver.*tarea/.test(lower)) return 'task_flow';
  if (/agend|agenda|evento|reserv|mantenimiento.*(manana|viernes|lunes|martes|miercoles|jueves|sabado|domingo|semana)/.test(lower)) return 'agenda_flow';
  if (/procedimiento|que hago si|criterio|penalizacion|danad|rot[ao]|falt|sin cargador|incomplet|regla/.test(lower)) return 'procedure_query';
  if (extractDevice(text) && /\b(quien|estado|disponible|tiene|figura|donde|esta)\b/.test(lower)) return 'device_query';
  if (/no anda|no funciona|falla|proyector|audio|wifi|internet|aula|nuc|pantalla/.test(lower)) return 'technical_help';
  return 'general_chat';
}

function isQuickActionLabel(lower) {
  return /^(registrar prestamo|registrar devolucion|consultar procedimiento|crear tarea|crear evento|ver agenda|confirmar|cancelar|volver)$/.test(lower);
}

function isEmptyProcedureRequest(text, action = '') {
  const lower = normalize(text);
  if (action === 'procedure_search' && (!lower || lower === 'consultar procedimiento')) return true;
  return !lower || lower === 'consultar procedimiento' || lower === 'procedimiento';
}

function quickActionToIntent(lower) {
  if (lower.includes('prestamo')) return 'loan_flow';
  if (lower.includes('devolucion')) return 'return_flow';
  if (lower.includes('procedimiento')) return 'procedure_query';
  if (lower.includes('tarea')) return 'task_flow';
  if (lower.includes('evento') || lower.includes('agenda')) return 'agenda_flow';
  return 'general_chat';
}

async function classifyWithOpenAI(text) {
  const prompt = `Clasifica este mensaje para el Asistente TechAsset. Responde solo una etiqueta: ${Array.from(INTENTS).join(', ')}.
PRIORIDAD:
1. Si contiene "devolv/devolucion/trajeron" → return_flow
2. Si contiene "prestamo/prestar/prestale" o equipo tipo D1435 con contexto de prestamo → loan_flow
3. Si contiene "crear tarea/pendiente" → task_flow
4. Solo si dice explicitamente agendar/agenda/reservar SIN etiqueta de equipo → agenda_flow
5. general_chat para charla, saludos, preguntas sin accion operativa
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

async function generalChat(text, memory) {
  if (!text) return response('Te escucho. Decime que queres hacer y lo ordenamos.', 'general_chat');
  const direct = directGeneralReply(text);
  if (direct) return response(direct, 'general_chat');
  if (!config.openaiApiKey) return response(localGeneralReply(text), 'general_chat');

  const history = memory.messages.slice(-8).map(item => ({ role: item.role, content: item.text }));
  const input = [
    {
      role: 'system',
      content: systemPrompt()
    },
    ...history,
    { role: 'user', content: text }
  ];
  try {
    const reply = await callOpenAI(input);
    return response(reply || localGeneralReply(text), 'general_chat');
  } catch (error) {
    console.warn(`[assistant] OpenAI general fallback: ${safeError(error)}`);
    return response(localGeneralReply(text), 'general_chat');
  }
}

async function technicalHelp(text) {
  const procedures = await searchProcedures(text);
  const procedureContext = procedures.length ? `\nProcedimiento encontrado: ${procedures[0].excerpt}\nFuente: ${procedures[0].source}` : '';
  if (config.openaiApiKey) {
    try {
      const reply = await callOpenAI([
        { role: 'system', content: `${systemPrompt()}\nAyuda a diagnosticar el problema. No crees tareas automaticamente. Al final podes preguntar si quiere dejarlo como tarea.` },
        { role: 'user', content: `${text}${procedureContext}` }
      ]);
      if (reply) return response(reply, 'technical_help', { procedures });
    } catch (error) {
      console.warn(`[assistant] OpenAI technical fallback: ${safeError(error)}`);
    }
  }
  return response(`Revisaria por partes: alimentacion, cableado, entrada seleccionada y salida de audio/video del equipo. Si es proyector, proba primero otra fuente o cable. ${procedures.length ? `Tambien encontre procedimiento: ${procedures[0].excerpt}` : 'Si queres, despues lo dejamos como tarea TIC.'}`, 'technical_help', { procedures });
}

async function handleLoanFlow(memory, text, action) {
  const previous = memory.activeFlow === 'loan_flow' ? memory.collectedData : {};
  const parsed = action === 'start_loan' && !extractDevice(text) ? { ...previous } : parseLoanText(text, previous);
  memory.activeFlow = 'loan_flow';
  memory.collectedData = parsed;
  if (parsed.codigo_dispositivo) memory.lastDevice = parsed.codigo_dispositivo;
  if (parsed.usuario_nombre) memory.lastPerson = parsed.usuario_nombre;

  if (!parsed.codigo_dispositivo) return askFlow(memory, 'Perfecto. Que numero o codigo de dispositivo queres prestar?', 'loan_flow', 'codigo_dispositivo');

  const deviceCheck = await validateDeviceForLoan(parsed.codigo_dispositivo);
  if (deviceCheck) return deviceCheck;

  const missing = loanMissing(parsed);
  if (missing.length) {
    memory.waitingFor = missing[0];
    return askFlow(memory, loanMissingQuestion(parsed, missing), 'loan_flow', missing[0]);
  }

  const pendingAction = { type: 'registrar_prestamo', payload: parsed };
  return confirm(`Confirmame si registro este prestamo:
Dispositivo: ${parsed.codigo_dispositivo}
Persona: ${parsed.usuario_nombre}
Rol: ${parsed.rol}
Ubicacion: ${parsed.ubicacion}
Motivo: ${parsed.motivo}
Comentario: ${parsed.comentario || 'sin comentario'}

Lo registro?`, 'loan_flow', pendingAction, ['Confirmar prestamo', 'Cancelar']);
}

async function validateDeviceForLoan(code) {
  const active = getActiveLoan(code);
  if (active) return response(`${normalizeCode(code)} ya tiene un prestamo activo para ${active.usuario_nombre}.`, 'loan_flow', { activeLoan: active });
  const { items } = await getMergedDevices();
  if (!items.some(item => sameCode(item.etiqueta, code))) return response(`No encontre el dispositivo ${normalizeCode(code)} en el inventario real.`, 'loan_flow');
  return null;
}

async function handleReturnFlow(memory, text, action) {
  const previous = memory.activeFlow === 'return_flow' ? memory.collectedData : {};
  const parsed = action === 'start_return' && !extractDevice(text) ? { ...previous } : parseReturnText(text, previous);
  // "devolvela / devolvelo / el de recién" — use last known device from memory
  if (!parsed.codigo_dispositivo && memory.lastDevice && /devolvela|devolvelo|el de recien|la de recien|esa|ese/.test(normalize(text))) {
    parsed.codigo_dispositivo = memory.lastDevice;
  }
  memory.activeFlow = 'return_flow';
  memory.collectedData = parsed;
  if (parsed.codigo_dispositivo) memory.lastDevice = parsed.codigo_dispositivo;

  if (!parsed.codigo_dispositivo) return askFlow(memory, 'Que equipo queres registrar como devuelto?', 'return_flow', 'codigo_dispositivo');

  const active = getActiveLoan(parsed.codigo_dispositivo);
  const procedure = parsed.condicion_devolucion !== 'bueno' ? await searchProcedures(text) : [];
  const pendingAction = { type: 'registrar_devolucion', payload: { ...parsed, prestamo_id: active?.id || '', usuario_nombre: active?.usuario_nombre || parsed.usuario_nombre || '' } };
  const activeText = active ? `Encontre prestamo activo para ${parsed.codigo_dispositivo} (${active.usuario_nombre}).` : `No encontre prestamo activo para ${parsed.codigo_dispositivo}; si confirmas lo registro como devolucion manual.`;
  const procedureText = procedure.length ? `\nProcedimiento relacionado: ${procedure[0].excerpt}` : '';
  return confirm(`${activeText}
Condicion: ${parsed.condicion_devolucion}.${parsed.accesorios_devueltos ? `\nAccesorios: ${parsed.accesorios_devueltos}` : ''}${procedureText}

Confirmas que guarde la devolucion?`, 'return_flow', pendingAction, ['Confirmar devolucion', 'Cancelar']);
}

async function handleTaskFlow(memory, text, action) {
  memory.activeFlow = 'task_flow';
  if (/mostrame|listar|consult|pendiente|vencid/i.test(text)) return taskQuery(normalize(text));
  const parsed = parseTaskText(text, memory.collectedData || {});
  memory.collectedData = parsed;
  const pendingAction = { type: 'crear_tarea', payload: parsed };
  return confirm(`Puedo crear esta tarea:
${parsed.titulo}
Responsable: ${parsed.responsable}
Prioridad: ${parsed.prioridad}

Confirmas?`, 'task_flow', pendingAction, ['Crear tarea', 'Cancelar']);
}

async function handleAgendaFlow(memory, text, action) {
  memory.activeFlow = 'agenda_flow';
  if (action === 'show_agenda' || /que tengo|mostrame|ver agenda|agenda hoy|agenda semana/i.test(text)) return agendaQuery(normalize(text));
  const parsed = parseAgendaText(text, memory.collectedData || {});
  memory.collectedData = parsed;
  const missing = [];
  if (!parsed.dia) missing.push('dia');
  if (!parsed.desde) missing.push('hora');
  if (missing.length) return askFlow(memory, `Para agendar me falta ${missing[0]}.`, 'agenda_flow', missing[0]);
  const pendingAction = { type: 'crear_evento_agenda', payload: parsed };
  return confirm(`Confirmame esta agenda:
Dia: ${parsed.dia}
Hora: ${parsed.desde}
Actividad: ${parsed.actividad}
Ubicacion: ${parsed.ubicacion || 'Aula'}`, 'agenda_flow', pendingAction, ['Crear agenda', 'Cancelar']);
}

async function confirmPending(memory, text) {
  if (!memory.pendingConfirmation) return generalChat(text, memory);
  const executed = await executePending(memory.pendingConfirmation);
  memory.pendingConfirmation = null;
  memory.activeFlow = null;
  memory.waitingFor = null;
  memory.collectedData = {};
  return executed;
}

async function applyCorrection(memory, text) {
  const lower = normalize(text);
  if (isCancel(lower) && !looksLikeCorrection(text)) {
    memory.pendingConfirmation = null;
    memory.activeFlow = null;
    memory.waitingFor = null;
    memory.collectedData = {};
    return response(pickCancel(), 'general_chat');
  }
  const flow = memory.activeFlow || actionTypeToFlow(memory.pendingConfirmation?.type);
  const current = memory.pendingConfirmation?.payload || memory.collectedData || {};
  const updated = updateDataWithCorrection(current, text, flow, memory.waitingFor);
  memory.collectedData = updated;
  memory.pendingConfirmation = null;
  if (flow === 'loan_flow') return handleLoanFlow(memory, '', '');
  if (flow === 'return_flow') return handleReturnFlow(memory, '', '');
  if (flow === 'agenda_flow') return handleAgendaFlow(memory, '', '');
  if (flow === 'task_flow') return handleTaskFlow(memory, updated.titulo || text, '');
  return response('Actualice el dato. Decime como seguimos.', 'general_chat');
}

function pickCancel() {
  const opts = ['Dale, lo cancelo.', 'Listo, descartado.', 'Cancelado. ¿Qué querés hacer?', 'Ok, cancele la acción.'];
  return opts[Math.floor(Math.random() * opts.length)];
}

async function deviceAnswer(text) {
  const code = extractDevice(text);
  if (!code) return ask('Decime el codigo del dispositivo y lo busco.', 'device_query');
  const { items } = await getMergedDevices();
  const device = items.find(item => sameCode(item.etiqueta, code));
  if (!device) return response(`No encontre el dispositivo ${code} en el inventario real.`, 'device_query');
  const active = getActiveLoan(code);
  const reply = active
    ? `${code} figura prestado a ${active.usuario_nombre}. Ubicacion: ${active.sede || '-'}. Motivo: ${active.observaciones_entrega || '-'}.`
    : `${code} figura como ${device.estado || 'Disponible'}. Modelo: ${device.marca || ''} ${device.modelo || ''}. SN: ${device.sn || '-'}. MAC: ${device.mac || '-'}.`;
  return response(reply, 'device_query', { device, activeLoan: active });
}

async function procedureAnswer(text, memory, action = '') {
  if (isEmptyProcedureRequest(text, action)) {
    memory.activeFlow = 'procedure_query';
    memory.waitingFor = 'procedure_query';
    return ask('Decime que procedimiento o situacion queres consultar. Por ejemplo: "notebook danada", "falta cargador" o "como prestar un equipo".', 'procedure_query');
  }
  const results = await searchProcedures(text);
  memory.activeFlow = null;
  memory.waitingFor = null;
  memory.collectedData = {};
  if (!results.length) return response('No encontre informacion suficiente en los documentos de procedimiento cargados para responder con precision. Te recomiendo validarlo con la coordinacion o responsable TIC.', 'procedure_query');
  return response(`${results[0].excerpt}\n\nFuente: ${results[0].source}`, 'procedure_query', { results });
}

function taskQuery(lower) {
  const rows = getDb().prepare('SELECT * FROM tasks WHERE eliminada=0 ORDER BY fecha_creacion DESC LIMIT 20').all();
  const filtered = /vencid/.test(lower) ? rows.filter(row => row.fecha_vencimiento && row.fecha_vencimiento < todayIso() && row.estado !== 'Hecha') : rows;
  return response(filtered.length ? `Encontre ${filtered.length} tareas.` : 'No encontre tareas para ese criterio.', 'task_flow', { items: filtered });
}

function agendaQuery(lower = '') {
  const rows = getDb().prepare('SELECT * FROM agenda WHERE eliminada=0 ORDER BY dia, desde LIMIT 40').all();
  const today = dayName(new Date());
  const filtered = /hoy/.test(lower) ? rows.filter(row => normalize(row.dia) === normalize(today)) : rows;
  return response(filtered.length ? `Encontre ${filtered.length} actividades de agenda.` : 'No encontre agenda para ese criterio.', 'agenda_flow', { items: filtered });
}

async function executePending(pending) {
  const db = getDb();
  const ts = nowIso();
  if (pending.type === 'crear_tarea') {
    const id = `TK${Date.now()}`;
    const p = pending.payload;
    db.prepare(`INSERT INTO tasks (id, titulo, descripcion, responsable, estado, prioridad, tipo, fecha_creacion, fecha_vencimiento, comentario, creado_por, operador_ultimo_cambio, agenda_id, ultima_modificacion) VALUES (?, ?, ?, ?, ?, ?, 'Asistente', ?, '', '', 'Asistente TechAsset', 'Asistente TechAsset', '', ?)`).run(id, p.titulo, p.descripcion || '', p.responsable || 'Sin asignar', p.estado || 'Pendiente', p.prioridad || 'Media', ts, ts);
    return response(`Tarea creada: ${p.titulo}`, 'task_flow', { id });
  }
  if (pending.type === 'crear_evento_agenda') {
    const id = `AG${Date.now()}`;
    const p = pending.payload;
    db.prepare(`INSERT INTO agenda (id, dia, fecha, turno, desde, hasta, curso, actividad, tipo_dispositivo, cantidad, ubicacion, responsable_tic, estado, nota, compus_retiradas, operador_ultimo_cambio, ultima_modificacion, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', 'Pendiente', '', 0, 'Asistente TechAsset', ?, ?)`).run(id, p.dia, p.fecha || '', p.turno || 'Manana', p.desde || '', p.hasta || '', p.curso || '', p.actividad || 'Actividad TIC', p.tipoDispositivo || 'Touch', p.cantidad || 1, p.ubicacion || 'Aula', ts, ts);
    return response(`Actividad creada: ${p.actividad}`, 'agenda_flow', { id });
  }
  if (pending.type === 'registrar_prestamo') {
    const p = pending.payload;
    const id = `PR${Date.now()}`;
    const { items } = await getMergedDevices();
    const device = items.find(d => sameCode(d.etiqueta, p.codigo_dispositivo)) || {};
    const observaciones = [p.motivo, p.comentario, p.rol ? `Rol: ${p.rol}` : ''].filter(Boolean).join(' | ');
    db.prepare(`INSERT INTO prestamos (id, dispositivo_id, codigo_dispositivo, tipo_dispositivo, usuario_nombre, usuario_email, curso_o_area, sede, responsable_entrega, fecha_prestamo, fecha_devolucion_prevista, estado, observaciones_entrega, condicion_entrega, accesorios_entregados, created_at, updated_at) VALUES (?, ?, ?, ?, ?, '', ?, ?, 'Asistente TechAsset', ?, '', 'activo', ?, 'bueno', '', ?, ?)`).run(id, device.id || '', p.codigo_dispositivo, device.dispositivo || device.modelo || '', p.usuario_nombre, p.rol || '', p.ubicacion || '', todayIso(), observaciones, ts, ts);
    addLocalMovement({ tipo: 'prestamo local', descripcion: `${p.codigo_dispositivo} prestado a ${p.usuario_nombre}`, operador: 'Asistente TechAsset', origen: 'Asistente', etiqueta: p.codigo_dispositivo });
    return response(`Listo. ${p.codigo_dispositivo} prestada a ${p.usuario_nombre}.`, 'loan_flow', { id });
  }
  if (pending.type === 'registrar_devolucion') {
    const p = pending.payload;
    const id = `DV${Date.now()}`;
    const condicion = p.condicion_devolucion || 'bueno';
    const penalizacion = /dan|incompleto/.test(condicion) ? 'si' : 'no';
    db.prepare(`INSERT INTO devoluciones (id, prestamo_id, dispositivo_id, codigo_dispositivo, usuario_nombre, fecha_devolucion_real, responsable_recepcion, condicion_devolucion, accesorios_devueltos, observaciones_devolucion, penalizacion_aplicada, detalle_penalizacion, created_at) VALUES (?, ?, '', ?, ?, ?, 'Asistente TechAsset', ?, ?, ?, ?, '', ?)`).run(id, p.prestamo_id || '', p.codigo_dispositivo, p.usuario_nombre || '', ts, condicion, p.accesorios_devueltos || '', p.observaciones_devolucion || '', penalizacion, ts);
    if (p.prestamo_id) db.prepare("UPDATE prestamos SET estado='devuelto', updated_at=? WHERE id=?").run(ts, p.prestamo_id);
    addLocalMovement({ tipo: 'devolucion local', descripcion: `${p.codigo_dispositivo} devuelta`, operador: 'Asistente TechAsset', origen: 'Asistente', etiqueta: p.codigo_dispositivo });
    return response(`Listo. ${p.codigo_dispositivo} quedo devuelta.`, 'return_flow', { id });
  }
  return response('No pude ejecutar la accion pendiente.', 'general_chat');
}

function parseLoanText(text, previous = {}) {
  const explicitDevice = extractDevice(text);
  const explicitPerson = extractPerson(text);
  const explicitRole = extractRole(text);
  const explicitLocation = extractLocation(text);
  const explicitMotive = extractMotive(text);
  const parsed = {
    codigo_dispositivo: explicitDevice || previous.codigo_dispositivo || '',
    usuario_nombre: explicitPerson || previous.usuario_nombre || '',
    rol: explicitRole || previous.rol || '',
    ubicacion: explicitLocation || previous.ubicacion || '',
    motivo: explicitMotive || previous.motivo || '',
    comentario: extractComment(text) || previous.comentario || ''
  };
  // "VA A SER PARA X" as motive fallback
  if (!parsed.motivo) {
    const motivoFallback = String(text).match(/va a ser para\s+(.+?)(?:,|$)/i)?.[1]?.trim();
    if (motivoFallback) parsed.motivo = motivoFallback;
  }
  const missing = loanMissing(parsed);
  const hasExplicitField = explicitDevice || explicitPerson || explicitRole || explicitLocation || explicitMotive;
  const parts = text.split(',').map(cleanFreeText).filter(Boolean);
  if (missing.length && parts.length > 1) {
    fillMissingFromParts(parsed, missing, parts);
  } else if (missing.length && isShortFreeText(text) && !hasExplicitField) {
    parsed[missing[0]] = cleanFreeText(text);
  }
  return parsed;
}

function parseReturnText(text, previous = {}) {
  const lower = normalize(text);
  const damaged = /danad|rot[ao]|rota|roto|pantalla|golpe|quebrad/.test(lower);
  const incomplete = /sin |falt|cargador|incomplet/.test(lower);
  return {
    codigo_dispositivo: extractDevice(text) || previous.codigo_dispositivo || '',
    usuario_nombre: previous.usuario_nombre || '',
    condicion_devolucion: damaged ? 'danado' : incomplete ? 'incompleto' : previous.condicion_devolucion || 'bueno',
    accesorios_devueltos: incomplete ? 'faltante detectado' : previous.accesorios_devueltos || '',
    observaciones_devolucion: text || previous.observaciones_devolucion || ''
  };
}

function parseTaskText(text, previous = {}) {
  const title = text.replace(/^(crea|crear|creame|nueva|dejame pendiente)?\s*(una\s*)?tarea\s*(para)?\s*/i, '').trim() || previous.titulo || text || 'Tarea TIC';
  return {
    titulo: title,
    descripcion: text || previous.descripcion || '',
    prioridad: /urgente/i.test(text) ? 'Urgente' : /alta/i.test(text) ? 'Alta' : /baja/i.test(text) ? 'Baja' : previous.prioridad || 'Media',
    responsable: previous.responsable || 'Sin asignar',
    estado: 'Pendiente'
  };
}

function parseAgendaText(text, previous = {}) {
  const relative = parseRelativeDate(text);
  const time = text.match(/\b(\d{1,2})(?::(\d{2}))?\b/);
  return {
    dia: extractDay(text) || relative.dia || previous.dia || '',
    fecha: relative.fecha || previous.fecha || '',
    turno: previous.turno || 'Manana',
    desde: time ? `${time[1].padStart(2, '0')}:${time[2] || '00'}` : previous.desde || '',
    hasta: previous.hasta || '',
    curso: previous.curso || '',
    actividad: text.replace(/^(agend(a|ar|ame)|pone|poner)\s*/i, '').trim() || previous.actividad || 'Actividad TIC',
    tipoDispositivo: /tic/i.test(text) ? 'TIC' : previous.tipoDispositivo || 'Touch',
    cantidad: Number(text.match(/\b(\d{1,2})\s*(touch|tic|compus|notebooks)?/i)?.[1] || previous.cantidad || 1),
    ubicacion: extractLocation(text) || previous.ubicacion || 'Aula'
  };
}

function updateDataWithCorrection(current, text, flow, waitingFor) {
  const updated = { ...current };
  const device = extractDevice(text);
  if (device) updated.codigo_dispositivo = device;
  if (flow === 'loan_flow') {
    const parsed = parseLoanText(text, updated);
    Object.assign(updated, parsed);
    if (waitingFor && !device && isShortFreeText(text)) updated[waitingFor] = cleanFreeText(text);
  }
  if (flow === 'return_flow') Object.assign(updated, parseReturnText(text, updated));
  if (flow === 'agenda_flow') Object.assign(updated, parseAgendaText(text, updated));
  if (flow === 'task_flow') Object.assign(updated, parseTaskText(text, updated));
  return updated;
}

function loanMissing(payload) {
  return ['codigo_dispositivo', 'usuario_nombre', 'rol', 'ubicacion', 'motivo'].filter(key => !String(payload[key] || '').trim());
}

function loanMissingQuestion(payload, missing) {
  if (missing.length > 1) return `Perfecto. Tengo ${loanKnownSummary(payload)}. Me falta ${missing.map(label).join(', ')}.`;
  return `Perfecto. Me falta ${label(missing[0])}.`;
}

function loanKnownSummary(payload) {
  const parts = [];
  if (payload.codigo_dispositivo) parts.push(`dispositivo ${payload.codigo_dispositivo}`);
  if (payload.usuario_nombre) parts.push(`persona ${payload.usuario_nombre}`);
  if (payload.ubicacion) parts.push(`ubicacion ${payload.ubicacion}`);
  return parts.join(', ') || 'el borrador iniciado';
}

function label(key) {
  return ({ codigo_dispositivo: 'codigo del equipo', usuario_nombre: 'persona', rol: 'rol', ubicacion: 'ubicacion', motivo: 'motivo', dia: 'dia', hora: 'hora' })[key] || key;
}

function fillMissingFromParts(parsed, missing, parts) {
  missing.forEach((key, index) => {
    if (parts[index]) parsed[key] = parts[index].replace(/^(para|por|en|como)\s+/i, '').trim();
  });
}

async function callOpenAI(input, options = {}) {
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

function systemPrompt() {
  return `Sos el Asistente TechAsset de una aplicacion escolar de gestion operativa TIC.
Responde siempre en espanol, tono directo, practico y cercano.
Solo inicia flujos operativos (prestamo, devolucion, tarea, agenda) cuando el usuario lo pida claramente.
No inventes datos de equipos, personas ni procedimientos.
No menciones modelos de IA, APIs, OpenAI, ni configuracion tecnica.
Si el usuario insulta o se frustra, responde breve y directo sin ponerte defensive.
Pregunta solo lo indispensable. Usa contexto previo de la conversacion.
Fecha y hora actual: ${currentDateTimeText()}. Zona horaria: ${TZ}.`;
}

function localGeneralReply(text) {
  return directGeneralReply(text) || 'Te sigo. Decime que necesitas.';
}

function directGeneralReply(text) {
  const lower = normalize(text);
  if (/que dia|fecha|hoy/.test(lower)) return `Hoy es ${currentDateText()}.`;
  if (/hora/.test(lower)) return `Ahora son ${currentTimeText()}.`;
  if (/modelo.*ia|ia.*usas|que modelo|usas.*modelo|openai|modo.*ia|que ia|como te llamas|quien sos|que sos/.test(lower)) {
    return 'Soy el Asistente TechAsset. Puedo ayudarte con prestamos, devoluciones, tareas, agenda y consultas de equipos.';
  }
  if (/retrasa|tonto|tarado|idiota|puto|boludo|inutil|mala|mals|no sirve/.test(lower)) {
    return 'Sí, algo salió mal. ¿Querés hacer prestamo, devolucion, tarea o agenda?';
  }
  if (/hola|buenas|hey/.test(lower)) return 'Hola. ¿Qué necesitas?';
  if (/pod|que hac|ayuda/.test(lower)) return 'Puedo registrar prestamos, devoluciones, tareas y agenda, y consultar equipos.';
  if (isConfirmation(lower) || isCancel(lower)) return 'No tengo ninguna accion pendiente. Decime que queres hacer.';
  return '';
}

function askFlow(memory, reply, intent, waitingFor) {
  memory.waitingFor = waitingFor;
  return { reply, intent, needsConfirmation: false, pendingAction: null, suggestedActions: [], data: {} };
}

function confirm(reply, intent, pendingAction, suggestedActions) {
  return { reply, intent, needsConfirmation: true, pendingAction, suggestedActions, data: {} };
}

function ask(reply, intent) {
  return { reply, intent, needsConfirmation: false, pendingAction: null, suggestedActions: [], data: {} };
}

function response(reply, intent, data = {}) {
  return { reply, intent, needsConfirmation: false, pendingAction: null, suggestedActions: defaultSuggestions(intent), data };
}

function defaultSuggestions(intent) {
  return [];
}

function getActiveLoan(code) {
  return getDb().prepare("SELECT * FROM prestamos WHERE upper(codigo_dispositivo)=upper(?) AND estado IN ('activo','vencido')").get(normalizeCode(code));
}

function extractDevice(text) {
  const raw = String(text || '').match(/\bD\s*0*\d{1,5}\b/i)?.[0]?.replace(/\s+/g, '');
  return raw ? normalizeCode(raw) : '';
}

function extractPerson(text) {
  const value = String(text || '').match(/\ba\s+(.+?)(?:\s+D\s*\d|\s+hasta|\s+en\b|\s+en:|\s+del\b|\s+de la\b|\s+por\b|\s+para\b|,|$)/i)?.[1]?.trim() || '';
  if (!value || isQuickActionLabel(normalize(value))) return '';
  // Strip any device codes that leaked into the name
  return value.replace(/\bD\s*\d{1,5}\b/gi, '').trim();
}

function extractRole(text) {
  const lower = normalize(text);
  if (/\b(alumno|alumnos)\b/.test(lower)) return 'Alumno';
  if (/\b(profesor|profesora|docente|maestra|maestro)\b/.test(lower)) return 'Docente';
  if (/\b(directivo|director|directora)\b/.test(lower)) return 'Directivo';
  if (/\b(preceptor|preceptora)\b/.test(lower)) return 'Preceptor';
  if (/\b(doe)\b/.test(lower)) return 'DOE';
  return String(text || '').match(/\b(?:rol|como|del|de la|area)\s+(.+?)(?:\s+en\b|\s+por\b|\s+para\b|,|$)/i)?.[1]?.trim() || '';
}

function extractLocation(text) {
  // Handle "en: DOE", "en DOE", "EN: DOE", "VA A ESTAR EN: DOE"
  return String(text || '').match(/\ben\s*:?\s+([A-Z][A-Z0-9 ]{1,30})(?:\s+por\b|\s+para\b|\s+va\b|,|$)/i)?.[1]?.trim() ||
    String(text || '').match(/\ben\s*:?\s+(.+?)(?:\s+por\b|\s+para\b|,|$)/i)?.[1]?.trim() || '';
}

function extractMotive(text) {
  // Match "para PLANIFICACION", "motivo: X", but not "para agendar", "para estar en", "para que"
  const value = String(text || '').match(/\b(?:motivo|motivo:)\s+(.+?)(?:,|$)/i)?.[1]?.trim() ||
    String(text || '').match(/\bpara\s+(planif|clase|trabajo|evento|actividad|uso|tarea|capacit|reunion|glifing|matific|tic|programacion|expo|presentacion|prueba|evaluacion|examen)[\w\s]*/i)?.[0]?.replace(/^para\s+/i, '')?.trim() || '';
  if (!value || /^usar(?:\s+en\b.*)?$/i.test(value) || /^(que|estar|agendar|ir|ser)/.test(normalize(value))) return '';
  return value;
}

function extractComment(text) {
  return String(text || '').match(/\b(?:comentario|nota)\s*:\s*(.+)$/i)?.[1]?.trim() || '';
}

function extractDay(text) {
  const lower = normalize(text);
  if (/lunes/.test(lower)) return 'Lunes';
  if (/martes/.test(lower)) return 'Martes';
  if (/miercoles/.test(lower)) return 'Miercoles';
  if (/jueves/.test(lower)) return 'Jueves';
  if (/viernes/.test(lower)) return 'Viernes';
  return '';
}

function parseRelativeDate(text) {
  const lower = normalize(text);
  const base = new Date();
  if (/pasado\s+ma.{0,3}ana/.test(lower)) return dateParts(addDays(base, 2));
  if (/ma.{0,3}ana/.test(lower)) return dateParts(addDays(base, 1));
  if (/\bhoy\b/.test(lower)) return dateParts(base);
  const weekdays = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
  const target = weekdays.findIndex(day => lower.includes(day));
  if (target >= 0) {
    const diff = (target - base.getDay() + 7) % 7 || 7;
    return dateParts(addDays(base, diff));
  }
  if (/semana que viene|proxima semana/.test(lower)) return dateParts(addDays(base, 7));
  return { fecha: '', dia: '' };
}

function dateParts(date) {
  return { fecha: toLocalDate(date), dia: dayName(date) };
}

function dayName(date) {
  const name = new Intl.DateTimeFormat('es-AR', { weekday: 'long', timeZone: TZ }).format(date);
  return name.charAt(0).toUpperCase() + name.slice(1).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function addDays(date, days) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function toLocalDate(date) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const get = type => parts.find(part => part.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function todayIso() {
  return toLocalDate(new Date());
}

function currentDateTimeText() {
  return new Intl.DateTimeFormat('es-AR', { timeZone: TZ, dateStyle: 'full', timeStyle: 'short' }).format(new Date());
}

function currentDateText() {
  return new Intl.DateTimeFormat('es-AR', { timeZone: TZ, dateStyle: 'full' }).format(new Date());
}

function currentTimeText() {
  return new Intl.DateTimeFormat('es-AR', { timeZone: TZ, timeStyle: 'short' }).format(new Date());
}

function isConfirmation(lower) {
  return /^(si|sí|dale|ok|confirmo|confirmar|registralo|guardalo|guardar|registrar|lo registro)\b/i.test(lower);
}

function isCancel(lower) {
  return /^(cancelar|cancela|no|anular|dejalo)\b/i.test(lower);
}

function looksLikeCorrection(text) {
  return /^(no,?\s*)?(era|es|mejor|quise decir)\b/i.test(text) || Boolean(extractDevice(text));
}

function isShortFreeText(text) {
  return cleanFreeText(text).split(/\s+/).length <= 10;
}

function cleanFreeText(text) {
  return String(text || '').replace(/^no,?\s*/i, '').trim();
}

function sameCode(a, b) {
  return normalizeCode(a) === normalizeCode(b);
}

function normalizeCode(value) {
  const raw = String(value || '').trim().toUpperCase().replace(/\s+/g, '');
  const number = raw.match(/^D?0*(\d{1,5})$/)?.[1];
  return number ? `D${number.padStart(4, '0')}` : raw;
}

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\u00e3\u00a1/g, 'a')
    .replace(/\u00e3\u00a9/g, 'e')
    .replace(/\u00e3\u00ad/g, 'i')
    .replace(/\u00e3\u00b3/g, 'o')
    .replace(/\u00e3\u00ba/g, 'u')
    .replace(/\u00e3\u00b1/g, 'n')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function actionTypeToFlow(type) {
  if (type === 'registrar_prestamo') return 'loan_flow';
  if (type === 'registrar_devolucion') return 'return_flow';
  if (type === 'crear_tarea') return 'task_flow';
  if (type === 'crear_evento_agenda') return 'agenda_flow';
  return null;
}

function logModeOnce() {
  if (modeLogged) return;
  const status = assistantStatus();
  console.info(`[assistant] mode=${status.mode} hasApiKey=${status.hasApiKey} model=${status.model}${status.promptId ? ' promptId=configured' : ''}`);
  modeLogged = true;
}

function logRequest({ conversationId, message, action, intent, memory }) {
  const safeMessage = String(message || '').slice(0, 140).replace(/\s+/g, ' ');
  console.info(`[assistant] conversationId=${conversationId} action=${action || '-'} classifiedIntent=${intent} activeFlow=${memory.activeFlow || '-'} waitingFor=${memory.waitingFor || '-'} mode=${assistantStatus().mode} message="${safeMessage}"`);
}

function safeError(error) {
  return error instanceof Error ? error.message : 'unknown error';
}

function isExecutablePending(action) {
  return ['registrar_prestamo', 'registrar_devolucion', 'crear_tarea', 'crear_evento_agenda'].includes(String(action?.type || ''));
}

function sanitizeAssistantText(text) {
  const clean = String(text || '').trim();
  if (!clean) return '';
  const parts = clean.split(/\n{2,}/).map(part => part.trim()).filter(Boolean);
  const noisy = part =>
    /^\*\*[^*\n]+\*\*$/.test(part) ||
    /\b(the user|i think|i need|i want|i'll|it's best|it's important|there's no need|it might be nice|i want to make sure|i'm going to|i should|i'll make sure|let me|i can see|i notice)\b/i.test(part);
  const filtered = parts.filter(part => !noisy(part));
  return (filtered.length ? filtered : parts).join('\n\n').trim();
}
