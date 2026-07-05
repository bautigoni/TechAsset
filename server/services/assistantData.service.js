import { getDb } from '../db.js';
import { getMergedDevices } from './deviceInventory.service.js';
import { config } from '../config.js';

const TZ = 'America/Argentina/Buenos_Aires';
const MAX_TOOL_ROUNDS = 4;
const MAX_ITEMS = 12;

/**
 * Chat de datos del asistente: el modelo puede consultar datos reales de la sede
 * mediante herramientas, pero CADA herramienta valida permisos del lado del servidor
 * con el `access` que arma assistant.routes.js a partir de la sesión. Nunca se
 * confía en lo que el modelo pida: el site_code y el nivel de acceso vienen de la
 * sesión, no del prompt.
 *
 * Niveles de acceso (accessLevel):
 * - staff  : admin/editores de la sede → todos los datos de SU sede.
 * - viewer : roles de solo consulta institucionales (ej. "Consulta") → lectura
 *            completa de su sede (igual que la UI en modo consulta).
 * - course : roles tipo preceptor → datos de préstamos a nivel curso; no puede
 *            consultar personas arbitrarias por nombre. (Cuando exista la
 *            asignación preceptor→cursos, filtrar acá por esos cursos.)
 * - self   : roles tipo alumno → solo datos propios y disponibilidad general.
 */
export function accessLevel(access) {
  if (access?.isManager || access?.canEdit) return 'staff';
  const role = normalize(access?.role || '');
  if (/precept/.test(role)) return 'course';
  if (/alumno|estudiante/.test(role)) return 'self';
  return 'viewer';
}

function canSeeAnyPerson(level) {
  return level === 'staff' || level === 'viewer';
}

function isOwnPerson(access, persona) {
  const own = [access?.user?.nombre, String(access?.user?.email || '').split('@')[0]]
    .map(normalize)
    .filter(Boolean);
  const target = normalize(persona);
  if (!target) return false;
  return own.some(name => name && (target.includes(name) || name.includes(target)));
}

function redactPersona(access, level, persona) {
  if (canSeeAnyPerson(level)) return persona || '';
  if (isOwnPerson(access, persona)) return persona || '';
  return persona ? 'Reservado' : '';
}

const TOOLS = [
  {
    type: 'function',
    name: 'buscar_dispositivos',
    description: 'Busca dispositivos del inventario de la sede por texto (etiqueta tipo D1436, alias tipo "Touch 34", tipo) y/o estado. Devuelve hasta 12 resultados.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Texto a buscar: etiqueta, alias o tipo. Opcional.' },
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
    name: 'prestamos_activos',
    description: 'Lista los préstamos activos de la sede. Se puede filtrar por persona o curso.',
    parameters: {
      type: 'object',
      properties: {
        persona: { type: 'string', description: 'Filtrar por nombre de la persona. Opcional.' },
        curso: { type: 'string', description: 'Filtrar por curso (ej. "EP · 5A"). Opcional.' }
      }
    }
  },
  {
    type: 'function',
    name: 'historial_prestamos',
    description: 'Historial de préstamos y devoluciones. Filtrable por fecha (YYYY-MM-DD), persona, curso o etiqueta.',
    parameters: {
      type: 'object',
      properties: {
        fecha: { type: 'string', description: 'Día exacto YYYY-MM-DD. Opcional.' },
        persona: { type: 'string', description: 'Nombre de la persona. Opcional.' },
        curso: { type: 'string', description: 'Curso. Opcional.' },
        etiqueta: { type: 'string', description: 'Etiqueta del equipo. Opcional.' }
      }
    }
  },
  {
    type: 'function',
    name: 'tareas_tic',
    description: 'Lista tareas del equipo TIC de la sede, filtrable por estado.',
    parameters: {
      type: 'object',
      properties: { estado: { type: 'string', enum: ['Pendiente', 'En proceso', 'Hecha'], description: 'Opcional.' } }
    }
  },
  {
    type: 'function',
    name: 'agenda_tic',
    description: 'Actividades de la agenda TIC de la sede para hoy o la semana.',
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
  }
];

export async function runAssistantTool(name, args, access) {
  const level = accessLevel(access);
  const siteCode = String(access?.siteCode || '').toUpperCase();
  if (!siteCode) return { ok: false, error: 'Sesión sin sede activa.' };
  try {
    switch (name) {
      case 'buscar_dispositivos': return await searchDevices(args, siteCode, access, level);
      case 'detalle_dispositivo': return await deviceDetail(args, siteCode, access, level);
      case 'prestamos_activos': return await activeLoans(args, siteCode, access, level);
      case 'historial_prestamos': return loanHistory(args, siteCode, access, level);
      case 'tareas_tic': return tasksList(args, siteCode, level);
      case 'agenda_tic': return agendaList(args, siteCode);
      case 'resumen_sitio': return await siteSummary(siteCode, level);
      default: return { ok: false, error: `Herramienta desconocida: ${name}` };
    }
  } catch (error) {
    return { ok: false, error: error?.message || 'Error consultando datos.' };
  }
}

async function searchDevices({ query = '', estado = '' } = {}, siteCode, access, level) {
  const { items } = await getMergedDevices({ siteCode });
  const q = normalize(query);
  const matches = items.filter(item => {
    if (estado && normalize(item.estado || 'Disponible') !== normalize(estado)) return false;
    if (!q) return true;
    const haystack = normalize([item.etiqueta, item.aliasOperativo, item.dispositivo, item.modelo, item.marca, item.filtro].join(' '));
    return q.split(/\s+/).every(part => haystack.includes(part));
  }).slice(0, MAX_ITEMS);
  return {
    ok: true,
    total: matches.length,
    items: matches.map(item => ({
      etiqueta: item.etiqueta,
      alias: item.aliasOperativo || '',
      tipo: item.filtro || item.dispositivo || '',
      estado: item.estado || 'Disponible',
      prestadoA: redactPersona(access, level, item.prestadoA),
      ubicacion: item.ubicacion || ''
    })),
    navigation: { view: 'devices', search: query || estado || '', label: 'Ver en Dispositivos' }
  };
}

async function deviceDetail({ etiqueta } = {}, siteCode, access, level) {
  const code = normalizeCode(etiqueta);
  const { items } = await getMergedDevices({ siteCode });
  const device = items.find(item => normalizeCode(item.etiqueta) === code);
  if (!device) return { ok: false, error: `No existe ${code} en el inventario de la sede.` };
  return {
    ok: true,
    item: {
      etiqueta: device.etiqueta,
      alias: device.aliasOperativo || '',
      tipo: device.filtro || device.dispositivo || '',
      marca: device.marca || '',
      modelo: device.modelo || '',
      estado: device.estado || 'Disponible',
      prestadoA: redactPersona(access, level, device.prestadoA),
      rol: canSeeAnyPerson(level) || isOwnPerson(access, device.prestadoA) ? device.rol || '' : '',
      ubicacion: device.ubicacion || '',
      curso: device.curso || '',
      motivo: canSeeAnyPerson(level) || isOwnPerson(access, device.prestadoA) ? device.motivo || '' : '',
      loanedAt: device.loanedAt || ''
    },
    navigation: { view: 'devices', search: device.etiqueta, label: `Ver ${device.etiqueta} en Dispositivos` }
  };
}

async function activeLoans({ persona = '', curso = '' } = {}, siteCode, access, level) {
  if (level === 'self' && persona && !isOwnPerson(access, persona)) {
    return { ok: false, error: 'Solo podés consultar tus propios préstamos.' };
  }
  if (level === 'course' && persona) {
    return { ok: false, error: 'Tu rol consulta por curso, no por persona. Probá filtrando por curso.' };
  }
  const { items } = await getMergedDevices({ siteCode });
  const filtered = items.filter(item => {
    if (normalize(item.estado) !== 'prestado') return false;
    if (level === 'self' && !isOwnPerson(access, item.prestadoA)) return false;
    if (persona && !normalize(item.prestadoA).includes(normalize(persona))) return false;
    if (curso && !normalize(item.curso).includes(normalize(curso))) return false;
    return true;
  }).slice(0, MAX_ITEMS);
  return {
    ok: true,
    total: filtered.length,
    items: filtered.map(item => ({
      etiqueta: item.etiqueta,
      alias: item.aliasOperativo || '',
      persona: redactPersona(access, level === 'course' ? 'staff' : level, item.prestadoA),
      rol: item.rol || '',
      ubicacion: item.ubicacion || '',
      curso: item.curso || '',
      motivo: item.motivo || '',
      desde: item.loanedAt || ''
    })),
    navigation: { view: 'loans', search: persona || curso || '', label: 'Ver en Préstamos' }
  };
}

function loanHistory({ fecha = '', persona = '', curso = '', etiqueta = '' } = {}, siteCode, access, level) {
  if (level === 'self') {
    // Alumnos: el historial se fuerza a su propia persona, ignorando otros filtros de gente.
    persona = access?.user?.nombre || String(access?.user?.email || '').split('@')[0] || '';
    if (!persona) return { ok: false, error: 'No pude identificar tu usuario para buscar tus préstamos.' };
  }
  if (level === 'course' && persona) {
    return { ok: false, error: 'Tu rol consulta por curso, no por persona.' };
  }
  const rows = getDb().prepare(`
    SELECT tipo, etiqueta, alias, persona, rol, ubicacion, curso, motivo, operador, timestamp
    FROM loan_events
    WHERE site_code=?
    ORDER BY timestamp DESC, id DESC
    LIMIT 400
  `).all(siteCode);
  const filtered = rows.filter(row => {
    if (fecha && localDateKey(row.timestamp) !== fecha) return false;
    if (persona && !normalize(row.persona).includes(normalize(persona))) return false;
    if (curso && !normalize(row.curso).includes(normalize(curso))) return false;
    if (etiqueta && normalizeCode(row.etiqueta) !== normalizeCode(etiqueta)) return false;
    return true;
  }).slice(0, MAX_ITEMS);
  return {
    ok: true,
    total: filtered.length,
    items: filtered.map(row => ({
      tipo: row.tipo,
      etiqueta: row.etiqueta,
      alias: row.alias || '',
      persona: redactPersona(access, level === 'course' ? 'staff' : level, row.persona),
      curso: row.curso || '',
      ubicacion: row.ubicacion || '',
      motivo: row.motivo || '',
      fecha: row.timestamp || ''
    })),
    navigation: { view: 'analytics', search: '', label: 'Ver en Analítica' }
  };
}

function tasksList({ estado = '' } = {}, siteCode, level) {
  if (level === 'self' || level === 'course') {
    return { ok: false, error: 'Las tareas del equipo TIC son internas: tu rol no puede consultarlas.' };
  }
  const rows = getDb().prepare('SELECT id, titulo, estado, prioridad, responsable, fecha_vencimiento AS vence FROM tasks WHERE eliminada=0 AND site_code=? ORDER BY fecha_creacion DESC LIMIT 60').all(siteCode);
  const filtered = rows.filter(row => !estado || normalize(row.estado) === normalize(estado)).slice(0, MAX_ITEMS);
  return {
    ok: true,
    total: filtered.length,
    items: filtered,
    navigation: { view: 'tasks', search: '', label: 'Ver en Tareas TIC' }
  };
}

function agendaList({ rango = 'hoy' } = {}, siteCode) {
  const rows = getDb().prepare('SELECT id, dia, fecha, desde, hasta, curso, actividad, tipo_dispositivo AS tipoDispositivo, cantidad, ubicacion, estado FROM agenda WHERE eliminada=0 AND site_code=? ORDER BY fecha, desde LIMIT 60').all(siteCode);
  const today = dayName(new Date());
  const filtered = (rango === 'hoy' ? rows.filter(row => normalize(row.dia) === normalize(today) || row.fecha === localDateKey(new Date())) : rows).slice(0, MAX_ITEMS);
  return {
    ok: true,
    total: filtered.length,
    items: filtered,
    navigation: { view: 'agenda', search: '', label: 'Ver en Agenda TIC' }
  };
}

async function siteSummary(siteCode, level) {
  const { items } = await getMergedDevices({ siteCode });
  const porEstado = {};
  for (const item of items) {
    const key = item.estado || 'Disponible';
    porEstado[key] = (porEstado[key] || 0) + 1;
  }
  const summary = { total: items.length, porEstado };
  if (level === 'staff' || level === 'viewer') {
    summary.tareasPendientes = getDb().prepare("SELECT COUNT(*) AS n FROM tasks WHERE eliminada=0 AND site_code=? AND estado IN ('Pendiente','En proceso')").get(siteCode)?.n || 0;
  }
  return { ok: true, resumen: summary, navigation: { view: 'dashboard', search: '', label: 'Ver Dashboard' } };
}

/**
 * Loop de tool-calling contra la Responses API de OpenAI. Devuelve
 * { reply, navigation, items } o lanza para que el caller haga fallback local.
 */
export async function dataChat({ text, history = [], access }) {
  if (!config.openaiApiKey) throw new Error('OpenAI no configurado');
  const level = accessLevel(access);
  const input = [
    { role: 'system', content: dataSystemPrompt(access, level) },
    ...history.slice(-8).map(item => ({ role: item.role, content: item.text })),
    { role: 'user', content: text }
  ];
  let navigation = null;
  let items = null;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const data = await callResponses(input);
    const calls = (Array.isArray(data.output) ? data.output : []).filter(item => item?.type === 'function_call');
    if (!calls.length) {
      const reply = extractText(data);
      if (!reply) throw new Error('OpenAI sin texto');
      return { reply, navigation, items };
    }
    for (const call of calls) {
      let args = {};
      try { args = JSON.parse(call.arguments || '{}'); } catch { args = {}; }
      const result = await runAssistantTool(call.name, args, access);
      if (result?.navigation) navigation = result.navigation;
      if (Array.isArray(result?.items)) items = result.items;
      input.push({ type: 'function_call', call_id: call.call_id, name: call.name, arguments: call.arguments || '{}' });
      input.push({ type: 'function_call_output', call_id: call.call_id, output: JSON.stringify(result).slice(0, 6000) });
    }
  }
  throw new Error('OpenAI demasiadas rondas de herramientas');
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
  const parts = [];
  for (const item of Array.isArray(data.output) ? data.output : []) {
    if (item?.type !== 'message') continue;
    for (const chunk of Array.isArray(item.content) ? item.content : []) {
      if (typeof chunk?.text === 'string') parts.push(chunk.text);
    }
  }
  return parts.join('\n').trim();
}

function dataSystemPrompt(access, level) {
  const levelText = {
    staff: 'Usuario del equipo TIC: puede consultar todos los datos de su sede.',
    viewer: 'Usuario de consulta institucional: puede leer los datos de su sede pero no modificarlos.',
    course: 'Preceptor/a: puede consultar préstamos a nivel curso; NO puede pedir datos de una persona puntual.',
    self: 'Alumno/a: solo puede consultar sus propios préstamos y la disponibilidad general de equipos.'
  }[level];
  return `Sos el Asistente TechAsset, el asistente de datos de una app escolar de gestión TIC.
Respondé en español rioplatense, directo y breve.
Sede activa: ${access?.siteCode}. Usuario: ${access?.user?.nombre || access?.user?.email || 'desconocido'} (rol: ${access?.role || 'Consulta'}).
${levelText}
Usá las herramientas para responder con datos reales; no inventes datos.
Si una herramienta devuelve error de permisos, explicá el límite sin rodeos y no insistas.
Los datos son solo de la sede activa: nunca menciones ni compares con otras sedes.
Si el usuario pide "dónde está X" o "quién tiene X", usá detalle_dispositivo o prestamos_activos.
No menciones modelos de IA, OpenAI ni detalles técnicos.
Fecha y hora actual: ${new Intl.DateTimeFormat('es-AR', { timeZone: TZ, dateStyle: 'full', timeStyle: 'short' }).format(new Date())}.`;
}

function normalize(value) {
  return String(value || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
}

function normalizeCode(value) {
  const raw = String(value || '').trim().toUpperCase().replace(/\s+/g, '');
  const number = raw.match(/^D?0*(\d{1,5})$/)?.[1];
  return number ? `D${number.padStart(4, '0')}` : raw;
}

function localDateKey(value) {
  const date = value instanceof Date ? value : new Date(value || Date.now());
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

function dayName(date) {
  const name = new Intl.DateTimeFormat('es-AR', { weekday: 'long', timeZone: TZ }).format(date);
  return name.charAt(0).toUpperCase() + name.slice(1);
}
