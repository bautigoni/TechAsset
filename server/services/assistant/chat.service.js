import { config } from '../../config.js';
import { currentDateTimeText } from './utils.js';
import { getDb } from '../../db.js';
import { getMergedDevices } from '../deviceInventory.service.js';
import { searchProcedures } from '../procedureSearch.js';

const TZ = 'America/Argentina/Buenos_Aires';
const SUGGESTED_ROUTES = {
  buscar_dispositivos: 'devices',
  detalle_dispositivo: 'devices',
  prestamos_activos: 'loans',
  historial_prestamos: 'analytics',
  tareas_tic: 'tasks',
  agenda_tic: 'agenda',
  resumen_sitio: 'dashboard',
  registrar_prestamo: 'loans',
  registrar_devolucion: 'loans',
  crear_tarea: 'tasks',
  crear_evento_agenda: 'agenda',
  buscar_persona: 'loans',
  procedimiento: 'dashboard'
};

function buildSystemPrompt(access) {
  const role = access?.role || 'Consulta';
  const siteCode = String(access?.siteCode || config.defaultSiteCode || 'NFPT').toUpperCase();
  const nombre = access?.user?.nombre || access?.user?.email || 'Usuario';
  const permission = access?.canEdit
    ? 'Podés registrar préstamos, devoluciones, tareas y eventos de agenda.'
    : 'Tu rol es de solo consulta: podés ver datos pero no modificar nada.';

  return `Sos el Asistente TechAsset, de gestión TIC escolar.
Usuario: ${nombre} (${role}, ${siteCode}).
${permission}

REGLAS:
- Cuando te pidan algo, USÁ las herramientas para resolverlo. No preguntes de más.
- "prestale X a Y" → buscá el device + persona con las herramientas, preguntá solo lo que falte, y ejecutá.
- Si falta un dato obligatorio (rol, ubicación), preguntá SOLO ese. No pidas todo de nuevo.
- Respondé sin Markdown, sin emojis, sin rodeos.
- No inventes datos. Solo afirmá lo que devuelvan las herramientas.
- Si no hay permiso, decilo CLARO en la primera oración.

Hoy: ${currentDateTimeText()}.`;
}

const TOOLS = [
  {
    type: 'function',
    name: 'buscar_dispositivos',
    description: 'Busca dispositivos del inventario por texto (etiqueta tipo D1436, alias tipo "Touch 34", tipo) y/o estado. Devuelve hasta 12 resultados.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Texto a buscar: etiqueta, alias, modelo o tipo. Opcional.' },
        estado: { type: 'string', enum: ['Disponible', 'Prestado', 'Fuera de servicio', 'No encontrada'], description: 'Filtrar por estado. Opcional.' }
      }
    }
  },
  {
    type: 'function',
    name: 'detalle_dispositivo',
    description: 'Detalle completo de un dispositivo por etiqueta (ej. D1436), incluyendo préstamo activo si lo tiene.',
    parameters: {
      type: 'object',
      properties: { etiqueta: { type: 'string', description: 'Etiqueta del equipo, ej. D1436 o 1436.' } },
      required: ['etiqueta']
    }
  },
  {
    type: 'function',
    name: 'buscar_persona',
    description: 'Busca personas por nombre en el historial de préstamos. Devuelve el nombre exacto, último rol conocido y ubicaciones frecuentes.',
    parameters: {
      type: 'object',
      properties: { nombre: { type: 'string', description: 'Nombre parcial a buscar, ej. "mili" o "juan". Mínimo 2 caracteres.' } },
      required: ['nombre']
    }
  },
  {
    type: 'function',
    name: 'prestamos_activos',
    description: 'Lista los préstamos activos de la sede. Se puede filtrar por persona.',
    parameters: {
      type: 'object',
      properties: {
        persona: { type: 'string', description: 'Filtrar por nombre de la persona. Opcional.' }
      }
    }
  },
  {
    type: 'function',
    name: 'historial_prestamos',
    description: 'Historial de préstamos y devoluciones. Filtrable por fecha (YYYY-MM-DD), persona o etiqueta.',
    parameters: {
      type: 'object',
      properties: {
        fecha: { type: 'string', description: 'Día exacto YYYY-MM-DD. Opcional.' },
        persona: { type: 'string', description: 'Nombre de la persona. Opcional.' },
        etiqueta: { type: 'string', description: 'Etiqueta del equipo. Opcional.' }
      }
    }
  },
  {
    type: 'function',
    name: 'tareas_tic',
    description: 'Lista tareas del equipo TIC, filtrable por estado.',
    parameters: {
      type: 'object',
      properties: { estado: { type: 'string', enum: ['Pendiente', 'En proceso', 'Hecha'], description: 'Opcional.' } }
    }
  },
  {
    type: 'function',
    name: 'agenda_tic',
    description: 'Actividades de la agenda TIC para hoy o la semana.',
    parameters: {
      type: 'object',
      properties: { rango: { type: 'string', enum: ['hoy', 'semana'], description: 'Por defecto hoy.' } }
    }
  },
  {
    type: 'function',
    name: 'resumen_sitio',
    description: 'Resumen general de la sede: dispositivos por estado, préstamos activos y tareas pendientes.',
    parameters: { type: 'object', properties: {} }
  },
  {
    type: 'function',
    name: 'procedimiento',
    description: 'Busca procedimientos TIC por texto (ej. "notebook dañada", "falta cargador").',
    parameters: {
      type: 'object',
      properties: { consulta: { type: 'string', description: 'Texto a buscar en procedimientos.' } },
      required: ['consulta']
    }
  },
  {
    type: 'function',
    name: 'registrar_prestamo',
    description: 'Registra un préstamo de dispositivo. USAR SOLO después de que el usuario confirmó explícitamente.',
    parameters: {
      type: 'object',
      properties: {
        codigo_dispositivo: { type: 'string', description: 'Etiqueta del dispositivo, ej. D1436.' },
        usuario_nombre: { type: 'string', description: 'Nombre de la persona.' },
        rol: { type: 'string', description: 'Rol: DOE, Docente, Alumno, Preceptor, Directivo.' },
        ubicacion: { type: 'string', description: 'Ubicación, ej. DOE, NFPT, SUM, Aula 12.' },
        motivo: { type: 'string', description: 'Motivo del préstamo. Opcional.' }
      },
      required: ['codigo_dispositivo', 'usuario_nombre', 'rol', 'ubicacion']
    }
  },
  {
    type: 'function',
    name: 'registrar_devolucion',
    description: 'Registra la devolución de un dispositivo. USAR SOLO después de confirmación del usuario.',
    parameters: {
      type: 'object',
      properties: {
        codigo_dispositivo: { type: 'string', description: 'Etiqueta del dispositivo.' },
        condicion: { type: 'string', enum: ['bueno', 'danado', 'incompleto'], description: 'Estado del equipo.' },
        accesorios: { type: 'string', description: 'Accesorios devueltos. Opcional.' }
      },
      required: ['codigo_dispositivo', 'condicion']
    }
  },
  {
    type: 'function',
    name: 'crear_tarea',
    description: 'Crea una tarea TIC. USAR SOLO después de confirmación del usuario.',
    parameters: {
      type: 'object',
      properties: {
        titulo: { type: 'string', description: 'Título de la tarea.' },
        prioridad: { type: 'string', enum: ['Baja', 'Media', 'Alta', 'Urgente'], description: 'Prioridad.' },
        responsable: { type: 'string', description: 'Responsable. Opcional.' }
      },
      required: ['titulo']
    }
  },
  {
    type: 'function',
    name: 'crear_evento_agenda',
    description: 'Crea un evento en la agenda TIC. USAR SOLO después de confirmación del usuario.',
    parameters: {
      type: 'object',
      properties: {
        dia: { type: 'string', description: 'Día de la semana: Lunes, Martes, Miércoles, Jueves, Viernes.' },
        desde: { type: 'string', description: 'Horario de inicio, ej. "08:00".' },
        actividad: { type: 'string', description: 'Descripción de la actividad.' },
        ubicacion: { type: 'string', description: 'Ubicación. Opcional.' }
      },
      required: ['dia', 'desde', 'actividad']
    }
  }
];

const WRITE_TOOLS = new Set(['registrar_prestamo', 'registrar_devolucion', 'crear_tarea', 'crear_evento_agenda']);

export async function runToolLoop({ messages, access }) {
  if (!config.openaiApiKey) return localFallback(messages, access);

  const system = buildSystemPrompt(access);
  const input = [
    { role: 'system', content: system },
    ...(messages || []).slice(-20)
  ];

  let lastTool = '';
  let suggestedRoute = null;

  for (let round = 0; round < 4; round++) {
    const data = await callResponses(input);
    const toolCalls = (data.output || []).filter(o => o.type === 'function_call');

    if (!toolCalls.length) {
      const reply = extractText(data);
      if (!reply) {
        return { reply: 'No pude procesar el mensaje.', suggestedRoute: null };
      }
      return { reply, suggestedRoute };
    }

    for (const call of toolCalls) {
      lastTool = call.name;
      let args = {};
      try { args = JSON.parse(call.arguments || '{}'); } catch { args = {}; }

      if (WRITE_TOOLS.has(call.name) && !access?.canEdit) {
        const toolReply = { ok: false, error: 'No tenés permisos para esta acción. Tu rol es de solo consulta.' };
        input.push({ type: 'function_call', call_id: call.call_id, name: call.name, arguments: call.arguments });
        input.push({ type: 'function_call_output', call_id: call.call_id, output: JSON.stringify(toolReply) });
        continue;
      }

      let result;
      try { result = await runTool(call.name, args, access); }
      catch (err) { result = { ok: false, error: err?.message || 'Error ejecutando herramienta' }; }
      input.push({ type: 'function_call', call_id: call.call_id, name: call.name, arguments: call.arguments });
      input.push({ type: 'function_call_output', call_id: call.call_id, output: JSON.stringify(result).slice(0, 6000) });
    }
  }

  const finalData = await callResponses(input);
  const reply = extractText(finalData) || 'Completé el proceso. ¿Necesitás algo más?';
  suggestedRoute = SUGGESTED_ROUTES[lastTool] || suggestedRoute;
  return { reply, suggestedRoute: SUGGESTED_ROUTES[lastTool] || null };
}

async function runTool(name, args, access) {
  const siteCode = String(access?.siteCode || config.defaultSiteCode || 'NFPT').toUpperCase();

  switch (name) {
    case 'buscar_dispositivos': return searchDevices(args, siteCode);
    case 'detalle_dispositivo': return deviceDetail(args, siteCode);
    case 'buscar_persona': return findPerson(args, siteCode);
    case 'prestamos_activos': return activeLoans(args, siteCode);
    case 'historial_prestamos': return loanHistory(args, siteCode);
    case 'tareas_tic': return tasksList(args, siteCode);
    case 'agenda_tic': return agendaList(args, siteCode);
    case 'resumen_sitio': return siteSummary(siteCode);
    case 'procedimiento': return searchProcedure(args);
    case 'registrar_prestamo': return registerLoan(args, siteCode, access);
    case 'registrar_devolucion': return registerReturn(args, siteCode, access);
    case 'crear_tarea': return createTask(args, siteCode, access);
    case 'crear_evento_agenda': return createAgenda(args, siteCode, access);
    default: return { ok: false, error: `Herramienta desconocida: ${name}` };
  }
}

async function searchDevices({ query = '', estado = '' } = {}, siteCode) {
  const { items } = await getMergedDevices({ siteCode });
  const q = normalize(query);
  const matches = items.filter(item => {
    if (estado && normalize(item.estado || 'Disponible') !== normalize(estado)) return false;
    if (!q) return true;
    const haystack = normalize([item.etiqueta, item.aliasOperativo, item.dispositivo, item.modelo, item.marca, item.filtro].join(' '));
    return q.split(/\s+/).every(part => haystack.includes(part));
  }).slice(0, 12);
  return { ok: true, total: matches.length, items: matches.map(m => ({ etiqueta: m.etiqueta, alias: m.aliasOperativo || '', tipo: m.filtro || m.dispositivo || '', estado: m.estado || 'Disponible', prestadoA: m.prestadoA || '', ubicacion: m.ubicacion || '' })) };
}

async function deviceDetail({ etiqueta } = {}, siteCode) {
  const code = normalizeCode(etiqueta);
  const { items } = await getMergedDevices({ siteCode });
  const device = items.find(item => normalizeCode(item.etiqueta) === code);
  if (!device) return { ok: false, error: `No existe ${code} en el inventario.` };
  return { ok: true, item: { etiqueta: device.etiqueta, alias: device.aliasOperativo || '', tipo: device.filtro || device.dispositivo || '', marca: device.marca || '', modelo: device.modelo || '', estado: device.estado || 'Disponible', prestadoA: device.prestadoA || '', rol: device.rol || '', ubicacion: device.ubicacion || '', motivo: device.motivo || '' } };
}

async function findPerson({ nombre } = {}, siteCode) {
  if (!nombre || String(nombre).length < 2) return { ok: false, error: 'Nombre muy corto.' };
  const q = `%${nombre}%`;
  const db = getDb();
  const rows = db.prepare(`
    SELECT DISTINCT usuario_nombre AS nombre, rol, ubicacion
    FROM prestamos WHERE site_code=? AND usuario_nombre LIKE ?
    ORDER BY fecha_prestamo DESC LIMIT 10
  `).all(siteCode, q);
  if (!rows.length) return { ok: false, error: `No encontré a "${nombre}" en préstamos anteriores.` };
  return { ok: true, personas: rows.map(r => ({ nombre: r.nombre, rol: r.rol || '', ultima_ubicacion: r.ubicacion || '' })) };
}

async function activeLoans({ persona = '' } = {}, siteCode) {
  const { items } = await getMergedDevices({ siteCode });
  const filtered = items.filter(item => {
    if (normalize(item.estado) !== 'prestado') return false;
    if (persona && !normalize(item.prestadoA).includes(normalize(persona))) return false;
    return true;
  }).slice(0, 12);
  return { ok: true, total: filtered.length, items: filtered.map(i => ({ etiqueta: i.etiqueta, alias: i.aliasOperativo || '', persona: i.prestadoA || '', rol: i.rol || '', ubicacion: i.ubicacion || '', motivo: i.motivo || '', desde: i.loanedAt || '' })) };
}

function loanHistory({ fecha = '', persona = '', etiqueta = '' } = {}, siteCode) {
  const db = getDb();
  const rows = db.prepare(`
    SELECT tipo, etiqueta, alias, persona, rol, ubicacion, motivo, timestamp
    FROM loan_events WHERE site_code=?
    ORDER BY timestamp DESC LIMIT 100
  `).all(siteCode);
  const filtered = rows.filter(row => {
    if (fecha && localDateKey(row.timestamp) !== fecha) return false;
    if (persona && !normalize(row.persona).includes(normalize(persona))) return false;
    if (etiqueta && normalizeCode(row.etiqueta) !== normalizeCode(etiqueta)) return false;
    return true;
  }).slice(0, 12);
  return { ok: true, total: filtered.length, items: filtered };
}

function tasksList({ estado = '' } = {}, siteCode) {
  const db = getDb();
  const rows = db.prepare('SELECT id, titulo, estado, prioridad, responsable, fecha_vencimiento AS vence FROM tasks WHERE eliminada=0 AND site_code=? ORDER BY fecha_creacion DESC LIMIT 30').all(siteCode);
  const filtered = rows.filter(row => !estado || normalize(row.estado) === normalize(estado)).slice(0, 12);
  return { ok: true, total: filtered.length, items: filtered };
}

function agendaList({ rango = 'hoy' } = {}, siteCode) {
  const db = getDb();
  const rows = db.prepare('SELECT id, dia, fecha, desde, hasta, curso, actividad, tipo_dispositivo AS tipo, cantidad, ubicacion, estado FROM agenda WHERE eliminada=0 AND site_code=? ORDER BY fecha, desde LIMIT 30').all(siteCode);
  const today = dayName(new Date());
  const filtered = (rango === 'hoy' ? rows.filter(row => normalize(row.dia) === normalize(today)) : rows).slice(0, 12);
  return { ok: true, total: filtered.length, items: filtered };
}

async function siteSummary(siteCode) {
  const { items } = await getMergedDevices({ siteCode });
  const porEstado = {};
  for (const item of items) porEstado[item.estado || 'Disponible'] = (porEstado[item.estado || 'Disponible'] || 0) + 1;
  const tareasPendientes = getDb().prepare("SELECT COUNT(*) AS n FROM tasks WHERE eliminada=0 AND site_code=? AND estado IN ('Pendiente','En proceso')").get(siteCode)?.n || 0;
  return { ok: true, resumen: { total: items.length, porEstado, tareasPendientes } };
}

async function searchProcedure({ consulta } = {}) {
  try {
    const results = await searchProcedures(consulta || '');
    return { ok: true, total: results.length, items: results.slice(0, 5) };
  } catch { return { ok: false, error: 'Error buscando procedimientos.' }; }
}

async function registerLoan(args, siteCode, access) {
  if (!access?.canEdit) return { ok: false, error: 'Permiso denegado.' };
  const db = getDb();
  const ts = nowIso();
  const id = `PR${Date.now()}`;
  const { items } = await getMergedDevices({ siteCode });
  const device = items.find(d => normalizeCode(d.etiqueta) === normalizeCode(args.codigo_dispositivo)) || {};
  const observaciones = [args.motivo || '', args.rol ? `Rol: ${args.rol}` : ''].filter(Boolean).join(' | ');
  try {
    db.prepare(`INSERT INTO prestamos (id, site_code, dispositivo_id, codigo_dispositivo, tipo_dispositivo, usuario_nombre, usuario_email, curso_o_area, sede, responsable_entrega, fecha_prestamo, estado, observaciones_entrega, condicion_entrega, accesorios_entregados, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, '', ?, ?, 'Asistente TechAsset', ?, 'activo', ?, 'bueno', '', ?, ?)`).run(id, siteCode, device.id || '', args.codigo_dispositivo, device.dispositivo || device.modelo || '', args.usuario_nombre, args.rol || '', args.ubicacion || siteCode, todayIso(), observaciones, ts, ts);
    return { ok: true, id, mensaje: `${args.codigo_dispositivo} prestado a ${args.usuario_nombre}.` };
  } catch (err) { return { ok: false, error: err.message }; }
}

async function registerReturn(args, siteCode, access) {
  if (!access?.canEdit) return { ok: false, error: 'Permiso denegado.' };
  const db = getDb();
  const ts = nowIso();
  const id = `DV${Date.now()}`;
  const active = db.prepare("SELECT id, usuario_nombre FROM prestamos WHERE site_code=? AND upper(codigo_dispositivo)=upper(?) AND estado IN ('activo','vencido')").get(siteCode, normalizeCode(args.codigo_dispositivo));
  const condicion = args.condicion || 'bueno';
  try {
    db.prepare(`INSERT INTO devoluciones (id, site_code, prestamo_id, codigo_dispositivo, usuario_nombre, fecha_devolucion_real, responsable_recepcion, condicion_devolucion, accesorios_devueltos, penalizacion_aplicada, created_at) VALUES (?, ?, ?, ?, ?, ?, 'Asistente TechAsset', ?, ?, ?, ?)`).run(id, siteCode, active?.id || '', args.codigo_dispositivo, active?.usuario_nombre || '', ts, condicion, args.accesorios || '', condicion !== 'bueno' ? 'si' : 'no', ts);
    if (active?.id) db.prepare("UPDATE prestamos SET estado='devuelto', updated_at=? WHERE id=?").run(ts, active.id);
    return { ok: true, id, mensaje: `${args.codigo_dispositivo} devuelto.` };
  } catch (err) { return { ok: false, error: err.message }; }
}

async function createTask(args, siteCode, access) {
  if (!access?.canEdit) return { ok: false, error: 'Permiso denegado.' };
  const db = getDb();
  const ts = nowIso();
  const id = `TK${Date.now()}`;
  try {
    db.prepare(`INSERT INTO tasks (id, site_code, titulo, responsable, estado, prioridad, tipo, fecha_creacion, creado_por, operador_ultimo_cambio, ultima_modificacion) VALUES (?, ?, ?, ?, 'Pendiente', ?, 'Asistente', ?, 'Asistente TechAsset', 'Asistente TechAsset', ?)`).run(id, siteCode, args.titulo, args.responsable || 'Sin asignar', args.prioridad || 'Media', ts, ts);
    return { ok: true, id, mensaje: `Tarea creada: ${args.titulo}` };
  } catch (err) { return { ok: false, error: err.message }; }
}

async function createAgenda(args, siteCode, access) {
  if (!access?.canEdit) return { ok: false, error: 'Permiso denegado.' };
  const db = getDb();
  const ts = nowIso();
  const id = `AG${Date.now()}`;
  try {
    db.prepare(`INSERT INTO agenda (id, site_code, dia, desde, actividad, ubicacion, estado, operador_ultimo_cambio, ultima_modificacion, created_at) VALUES (?, ?, ?, ?, ?, ?, 'Pendiente', 'Asistente TechAsset', ?, ?)`).run(id, siteCode, args.dia, args.desde, args.actividad, args.ubicacion || 'Aula', ts, ts);
    return { ok: true, id, mensaje: `Evento creado: ${args.actividad}` };
  } catch (err) { return { ok: false, error: err.message }; }
}

function localFallback(messages, access) {
  const last = messages?.[messages.length - 1]?.content || '';
  const db = getDb();
  const siteCode = String(access?.siteCode || config.defaultSiteCode || 'NFPT').toUpperCase();
  const device = last.match(/\bD\s*0*(\d{1,5})\b/i);
  if (device) {
    const code = `D${device[1]}`;
    const active = db.prepare("SELECT usuario_nombre, observaciones_entrega FROM prestamos WHERE site_code=? AND upper(codigo_dispositivo)=upper(?) AND estado IN ('activo','vencido')").get(siteCode, code);
    if (active) return { reply: `${code} está prestado a ${active.usuario_nombre}.`, suggestedRoute: 'loans' };
    return { reply: `${code} está disponible en el inventario.`, suggestedRoute: 'devices' };
  }
  if (/prestamo|prestar|prestale/i.test(last)) return { reply: 'Decime qué dispositivo (D#### o alias como Touch 34) y a quién se lo presto.', suggestedRoute: 'loans' };
  if (/hola|buenas|ayuda/i.test(last)) return { reply: 'Hola. Puedo ayudarte con préstamos, devoluciones, tareas, agenda y consultas de dispositivos.', suggestedRoute: null };
  return { reply: 'Te escucho. Decime qué necesitas hacer y lo ordenamos.', suggestedRoute: null };
}

async function callResponses(input) {
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.openaiApiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.openaiModel || 'gpt-4.1-mini',
      input,
      tools: TOOLS,
      tool_choice: 'auto'
    })
  });
  if (!response.ok) throw new Error(`OpenAI HTTP ${response.status}`);
  return response.json();
}

function extractText(data) {
  if (data.output_text) return String(data.output_text).trim();
  for (const item of Array.isArray(data.output) ? data.output : []) {
    if (item?.type !== 'message') continue;
    for (const chunk of Array.isArray(item.content) ? item.content : []) {
      if (typeof chunk?.text === 'string' && chunk.text.trim()) return chunk.text.trim();
    }
  }
  return '';
}

function normalize(value) {
  return String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
}

function normalizeCode(value) {
  const raw = String(value || '').trim().toUpperCase().replace(/\s+/g, '');
  const number = raw.match(/^D?0*(\d{1,5})$/)?.[1];
  return number ? `D${number.padStart(4, '0')}` : raw;
}

function dayName(date) {
  const name = new Intl.DateTimeFormat('es-AR', { timeZone: TZ, weekday: 'long' }).format(date);
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function localDateKey(value) {
  const date = value instanceof Date ? value : new Date(value || Date.now());
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

function todayIso() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function nowIso() {
  return new Date().toISOString();
}
