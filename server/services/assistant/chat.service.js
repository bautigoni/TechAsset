import { config } from '../../config.js';
import { addDays, currentDateTimeText, dayName, normalize, normalizeCode, toLocalDate } from './utils.js';
import { addLoanEvent, addLocalMovement, getDb, nowIso, setLocalState } from '../../db.js';
import { buildLocalInventory, getMergedDevices, invalidateDeviceInventoryCache } from '../deviceInventory.service.js';
import { notifySiteAdmins } from '../notifications.service.js';
import { searchProcedures } from '../procedureSearch.js';

const MAX_ROUNDS = 5;

// Vistas válidas de App.tsx (setView). El asistente navega solo a estas.
const SECTIONS = ['dashboard', 'devices', 'loans', 'inventory', 'analytics', 'agenda', 'tasks', 'classrooms', 'tools', 'quickaccess', 'tickets', 'settings'];

const SECTION_LABELS = {
  dashboard: 'Inicio', devices: 'Dispositivos', loans: 'Préstamos', inventory: 'Inventario maker',
  analytics: 'Analítica', agenda: 'Agenda TIC', tasks: 'Tareas TIC', classrooms: 'Estado de aulas',
  tools: 'Herramientas', quickaccess: 'Accesos rápidos', tickets: 'Tickets', settings: 'Configuración'
};

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
  consulta_bd: null
};

function buildSystemPrompt(access) {
  const role = access?.role || 'Consulta';
  const siteCode = String(access?.siteCode || config.defaultSiteCode || 'NFPT').toUpperCase();
  const nombre = access?.user?.nombre || access?.user?.email || 'Usuario';
  const permission = access?.canEdit
    ? 'Podés registrar préstamos, devoluciones, tareas y eventos de agenda.'
    : 'Tu rol es de solo consulta: podés ver datos pero no modificar nada. Si te piden una acción de escritura, avisalo en la primera oración.';

  return `Soy el Asistente TechAsset, soy como un compañero más del equipo TIC de ${siteCode}. Estoy laburando con ${nombre} (${role}). ${permission}

LA POSTA DE CÓMO LABURO:
- Uso las herramientas que tengo para resolver lo que me pidas. Nunca invento números ni datos — solo digo lo que las herramientas me devuelven.
- Si ejecuto una acción (préstamo, tarea, etc.), me fijo bien que la herramienta haya dicho "todo ok" antes de confirmártelo.
- Si algo sale mal, te cuento el error en criollo, sin enchastre técnico. Jamás te voy a hablar de bases de datos ni errores internos.
- No te hago repetir las cosas: si ya me lo dijiste antes o ya lo tengo de una herramienta, lo uso directo.
- Las etiquetas de los equipos son tipo D1436. Los alias operativos son "Touch 34", "Plani 5", "TIC 12". Ojo: si te dicen "Touch" no es lo mismo que una "TIC", cada uno tiene su tipo.

PRÉSTAMOS — cuando te pidan prestar algo:
1. Primero fijate con detalle_dispositivo que el equipo exista y esté disponible, y con buscar_persona fijate si ya tiene movimientos (rol/ubicación que usa siempre). Podés pedir ambas cosas al mismo tiempo.
2. Si la persona ya tiene histórico, proponé directamente el rol y la ubicación que más usa.
3. Todo en un solo mensaje: "¿Te confirmo? D1432 → Mili (rol DOE, en DOE)". Si falta algún dato que no está en el histórico, lo pedís ahí mismo, no en preguntas separadas.
4. Cuando te digan que sí ("sí", "dale", "mandale", "confirmo"), ejecutá registrar_prestamo al toque, sin preguntar de nuevo nada.

DEVOLUCIONES: verifica con detalle_dispositivo que esté prestado y ejecutá registrar_devolucion. Si no te dicen condición, asumí "bueno".

TAREAS Y AGENDA: si el pedido es claro, crealas sin vueltas ni confirmación. Metele responsable, prioridad y detalles en el mismo llamado. NO podés editar ni borrar cosas existentes — si te lo piden, decí "mirá, no puedo modificar eso, pero te llevo a la sección y lo hacés vos".

NAVEGACIÓN: si te piden ir a algún lado ("llevame a tareas", "abrí préstamos"), usá abrir_seccion. Si además te pidieron un dato específico, buscalo primero con la herramienta y decí algo como "te llevo a Tareas, por cierto la tarea Maker está pendiente, vence el 19/06".

LÍMITE DE SEDE: TODO lo que hago es exclusivamente de la sede ${siteCode}. No puedo ver ni modificar datos de otras sedes. Si te piden algo de otra sede, decí que los tenants están separados y que necesitan cambiarse a esa sede con los permisos correspondientes.

CONSULTAS LIBRES: si una pregunta no se puede responder con las herramientas que tengo, avisá que por seguridad no podés hacer consultas libres a la base y ofreceles la pantalla más cercana o las herramientas que sí están disponibles.

CÓMO HABLO: español rioplatense (vos), como si estuviera charlando con un colega en el taller. Nada de Markdown ni emojis. Nada de "estimado usuario" ni fórmulas robóticas. Si algo está bien, va un "todo bien", "joya", "dale". Si algo está mal, lo digo derecho viejo. Variá las respuestas, no repitas siempre la misma estructura. Usá contracciones, frases cortas, preguntá si hace falta. Sé directo pero no seco — como cuando le hablás a alguien que está al lado tuyo.

Hoy es ${currentDateTimeText()} (hora de Argentina).`;
}

const TOOLS = [
  {
    type: 'function',
    name: 'buscar_dispositivos',
    description: 'Busca dispositivos del inventario por texto (etiqueta D1436, alias "Touch 34", tipo, modelo) y/o estado. Devuelve hasta 12 resultados.',
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
    description: 'Detalle completo de un dispositivo por etiqueta (ej. D1436) o alias operativo (ej. "Touch 34"), incluyendo a quién está prestado si corresponde.',
    parameters: {
      type: 'object',
      properties: { etiqueta: { type: 'string', description: 'Etiqueta (D1436, 1436) o alias operativo ("Touch 34").' } },
      required: ['etiqueta']
    }
  },
  {
    type: 'function',
    name: 'buscar_persona',
    description: 'Busca personas por nombre en el historial de préstamos. Devuelve nombre exacto, rol y ubicación más frecuentes, y cantidad de préstamos. Usá esos valores como propuesta para un préstamo nuevo.',
    parameters: {
      type: 'object',
      properties: { nombre: { type: 'string', description: 'Nombre parcial, ej. "mili" o "juan". Mínimo 2 caracteres.' } },
      required: ['nombre']
    }
  },
  {
    type: 'function',
    name: 'prestamos_activos',
    description: 'Lista los préstamos activos de la sede (equipos actualmente prestados). Se puede filtrar por persona.',
    parameters: {
      type: 'object',
      properties: { persona: { type: 'string', description: 'Filtrar por nombre. Opcional.' } }
    }
  },
  {
    type: 'function',
    name: 'historial_prestamos',
    description: 'Historial de préstamos y devoluciones ya registrados. Filtrable por fecha, persona o etiqueta.',
    parameters: {
      type: 'object',
      properties: {
        desde: { type: 'string', description: 'Fecha inicio YYYY-MM-DD. Opcional.' },
        hasta: { type: 'string', description: 'Fecha fin YYYY-MM-DD. Opcional.' },
        persona: { type: 'string', description: 'Nombre de la persona. Opcional.' },
        etiqueta: { type: 'string', description: 'Etiqueta del equipo. Opcional.' }
      }
    }
  },
  {
    type: 'function',
    name: 'tareas_tic',
    description: 'Lista tareas del equipo TIC, filtrable por estado o por texto en el título.',
    parameters: {
      type: 'object',
      properties: {
        estado: { type: 'string', enum: ['Pendiente', 'En proceso', 'Hecha'], description: 'Opcional.' },
        buscar: { type: 'string', description: 'Texto a buscar en el título. Opcional.' }
      }
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
    name: 'abrir_seccion',
    description: 'Navega a una sección de la app. Usar cuando el usuario pide ir a una pantalla ("llevame a tareas", "abrí préstamos"). También sirve para llevarlo a donde está el dato que consultó.',
    parameters: {
      type: 'object',
      properties: { seccion: { type: 'string', enum: SECTIONS, description: 'Sección destino.' } },
      required: ['seccion']
    }
  },
  {
    type: 'function',
    name: 'registrar_prestamo',
    description: 'Registra un préstamo de dispositivo en el sistema. USAR SOLO después de que el usuario confirmó explícitamente el resumen del préstamo.',
    parameters: {
      type: 'object',
      properties: {
        codigo_dispositivo: { type: 'string', description: 'Etiqueta del dispositivo, ej. D1436.' },
        usuario_nombre: { type: 'string', description: 'Nombre de la persona que recibe el equipo.' },
        rol: { type: 'string', description: 'Rol: DOE, Docente, Alumno, Preceptor, Directivo, Administración.' },
        ubicacion: { type: 'string', description: 'Ubicación, ej. DOE, SUM, Aula 12, Dirección.' },
        motivo: { type: 'string', description: 'Motivo del préstamo. Opcional.' }
      },
      required: ['codigo_dispositivo', 'usuario_nombre', 'rol', 'ubicacion']
    }
  },
  {
    type: 'function',
    name: 'registrar_devolucion',
    description: 'Registra la devolución de un dispositivo prestado. USAR SOLO después de confirmación del usuario.',
    parameters: {
      type: 'object',
      properties: {
        codigo_dispositivo: { type: 'string', description: 'Etiqueta del dispositivo.' },
        condicion: { type: 'string', enum: ['bueno', 'danado', 'incompleto'], description: 'Estado del equipo al devolverse. Por defecto "bueno".' },
        comentario: { type: 'string', description: 'Observaciones de la devolución. Opcional.' }
      },
      required: ['codigo_dispositivo']
    }
  },
  {
    type: 'function',
    name: 'crear_tarea',
    description: 'Crea una tarea TIC. Usala directamente cuando el pedido es claro; incluí responsable y prioridad si el usuario los mencionó. No existe herramienta para editar tareas ya creadas.',
    parameters: {
      type: 'object',
      properties: {
        titulo: { type: 'string', description: 'Título corto de la tarea.' },
        descripcion: { type: 'string', description: 'Detalle de la tarea. Opcional.' },
        prioridad: { type: 'string', enum: ['Baja', 'Media', 'Alta', 'Urgente'], description: 'Por defecto Media.' },
        responsable: { type: 'string', description: 'Responsable asignado. Opcional.' }
      },
      required: ['titulo']
    }
  },
  {
    type: 'function',
    name: 'crear_evento_agenda',
    description: 'Crea una actividad en la agenda TIC. Usala directamente cuando el pedido es claro (día, horario y actividad). No existe herramienta para editar eventos ya creados.',
    parameters: {
      type: 'object',
      properties: {
        dia: { type: 'string', enum: ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes'], description: 'Día de la semana.' },
        fecha: { type: 'string', description: 'Fecha exacta YYYY-MM-DD si el usuario la dio. Opcional.' },
        desde: { type: 'string', description: 'Horario de inicio HH:MM, ej. "08:00".' },
        hasta: { type: 'string', description: 'Horario de fin HH:MM. Opcional.' },
        actividad: { type: 'string', description: 'Descripción de la actividad.' },
        curso: { type: 'string', description: 'Curso o grado, ej. "5to A". Opcional.' },
        ubicacion: { type: 'string', description: 'Ubicación. Opcional.' }
      },
      required: ['dia', 'desde', 'actividad']
    }
  }
];

const WRITE_TOOLS = new Set(['registrar_prestamo', 'registrar_devolucion', 'crear_tarea', 'crear_evento_agenda']);

export async function runToolLoop({ messages, access }) {
  const lastUserMessage = getLastUserMessage(messages);
  if (!config.openaiApiKey) return localFallback(messages, access);

  const input = [
    { role: 'system', content: buildSystemPrompt(access) },
    ...(messages || []).slice(-20)
  ];

  let suggestedRoute = null;

  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const lastRound = round === MAX_ROUNDS - 1;
      const data = await callResponses(input, { allowTools: !lastRound });
      const toolCalls = (data.output || []).filter(o => o.type === 'function_call');

      if (!toolCalls.length) {
        const reply = extractText(data);
        if (!reply) return { reply: 'No pude procesar el mensaje. ¿Podés reformularlo?', suggestedRoute: null };
        const deterministic = await deterministicLoanDraft(lastUserMessage, access);
        if (deterministic && isGenericAssistantReply(reply)) return deterministic;
        return { reply, suggestedRoute };
      }

      for (const call of toolCalls) {
        const result = await runAssistantTool(call.name, parseArgs(call.arguments), access);
        if (result?.ok !== false) {
          if (call.name === 'abrir_seccion' && result?.seccion) suggestedRoute = result.seccion;
          else if (SUGGESTED_ROUTES[call.name]) suggestedRoute = SUGGESTED_ROUTES[call.name];
        }
        input.push({ type: 'function_call', call_id: call.call_id, name: call.name, arguments: call.arguments });
        input.push({ type: 'function_call_output', call_id: call.call_id, output: JSON.stringify(result).slice(0, 6000) });
      }
    }
  } catch (error) {
    console.error('[assistant] fallo del loop:', error?.message || error);
    return { reply: 'No pude conectarme con el servicio de IA en este momento. Probá de nuevo en unos segundos.', suggestedRoute: null };
  }

  return { reply: 'Hice varias consultas pero no llegué a una respuesta clara. ¿Podés reformular el pedido?', suggestedRoute };
}

// Ejecuta una herramienta con permisos y captura de errores. Cualquier excepción
// interna se loguea completa acá y al modelo solo le llega un mensaje transmisible,
// para que no invente causas técnicas.
export async function runAssistantTool(name, args, access) {
  if (WRITE_TOOLS.has(name) && !access?.canEdit) {
    return { ok: false, error: 'El usuario no tiene permisos para esta acción: su rol es de solo consulta.' };
  }
  try {
    return await dispatchTool(name, args, access);
  } catch (error) {
    console.error(`[assistant] error en herramienta ${name}:`, error);
    return { ok: false, error: 'Hubo un problema técnico momentáneo al consultar el sistema. Sugerile al usuario reintentar o usar la pantalla correspondiente.' };
  }
}

async function dispatchTool(name, args, access) {
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
    case 'abrir_seccion': return openSection(args);
    case 'registrar_prestamo': return registerLoan(args, siteCode, access);
    case 'registrar_devolucion': return registerReturn(args, siteCode, access);
    case 'crear_tarea': return createTask(args, siteCode, access);
    case 'crear_evento_agenda': return createAgenda(args, siteCode, access);
    case 'consulta_bd': return runSqlQuery(args, siteCode);
    default: return { ok: false, error: `Herramienta desconocida: ${name}` };
  }
}

// ---------- Lectura ----------

async function searchDevices({ query = '', estado = '' } = {}, siteCode) {
  const { items } = await getMergedDevices({ siteCode });
  const q = normalize(query);
  const matches = items.filter(item => {
    if (estado && normalize(item.estado || 'Disponible') !== normalize(estado)) return false;
    if (!q) return true;
    const haystack = normalize([item.etiqueta, item.aliasOperativo, item.dispositivo, item.modelo, item.marca, item.filtro].join(' '));
    return q.split(/\s+/).every(part => haystack.includes(part));
  }).slice(0, 12);
  if (!matches.length) return { ok: true, total: 0, items: [], nota: 'No hubo coincidencias con esa búsqueda.' };
  return { ok: true, total: matches.length, items: matches.map(m => ({ etiqueta: m.etiqueta, alias: m.aliasOperativo || '', tipo: m.filtro || m.dispositivo || '', estado: m.estado || 'Disponible', prestadoA: m.prestadoA || '', ubicacion: m.ubicacion || '' })) };
}

async function deviceDetail({ etiqueta } = {}, siteCode) {
  if (!String(etiqueta || '').trim()) return { ok: false, error: 'Falta la etiqueta o alias del dispositivo a consultar.' };
  const device = await findDevice(etiqueta, siteCode);
  if (!device) return { ok: false, error: `No existe "${etiqueta}" en el inventario de ${siteCode}. Verificá la etiqueta o alias.` };
  return { ok: true, item: { etiqueta: device.etiqueta, alias: device.aliasOperativo || '', tipo: device.filtro || device.dispositivo || '', marca: device.marca || '', modelo: device.modelo || '', estado: device.estado || 'Disponible', prestadoA: device.prestadoA || '', rol: device.rol || '', ubicacion: device.ubicacion || '', motivo: device.motivo || '', prestadoDesde: device.loanedAt || '' } };
}

// Busca por etiqueta exacta o por alias operativo ("Touch 34").
async function findDevice(value, siteCode) {
  const code = normalizeCode(value);
  const { items } = await getMergedDevices({ siteCode });
  const byTag = items.find(item => normalizeCode(item.etiqueta) === code);
  if (byTag) return byTag;
  const q = normalize(value);
  if (!q) return null;
  return items.find(item => normalize(item.aliasOperativo) === q) || null;
}

// Lee de loan_events (historial durable, el mismo que alimenta el autocompletado
// del LoanForm). La tabla legacy `prestamos` no tiene rol/ubicación y casi no se usa.
function findPerson({ nombre } = {}, siteCode) {
  const clean = String(nombre || '').trim();
  if (clean.length < 2) return { ok: false, error: 'El nombre a buscar es muy corto (mínimo 2 letras).' };
  const q = normalize(clean);
  const rows = getDb().prepare(`
    SELECT persona, rol, ubicacion, curso, motivo, timestamp
    FROM loan_events
    WHERE site_code=? AND tipo='prestamo' AND TRIM(persona)<>''
  `).all(siteCode);

  const groups = new Map();
  for (const row of rows) {
    const key = normalize(row.persona);
    if (!key || !key.includes(q)) continue;
    let group = groups.get(key);
    if (!group) { group = { persona: row.persona, count: 0, last: '', roles: {}, ubicaciones: {}, cursos: {} }; groups.set(key, group); }
    group.count += 1;
    if (String(row.timestamp || '') > group.last) { group.last = String(row.timestamp || ''); group.persona = row.persona; }
    bump(group.roles, row.rol);
    bump(group.ubicaciones, row.ubicacion);
    bump(group.cursos, row.curso);
  }

  const personas = [...groups.values()]
    .sort((a, b) => b.count - a.count || b.last.localeCompare(a.last))
    .slice(0, 5)
    .map(group => ({
      nombre: group.persona,
      rol_habitual: mode(group.roles),
      ubicacion_habitual: mode(group.ubicaciones),
      curso_habitual: mode(group.cursos),
      prestamos_registrados: group.count,
      ultimo_prestamo: group.last ? toLocalDate(new Date(group.last)) : ''
    }));

  if (!personas.length) {
    return { ok: true, personas: [], nota: `No hay historial de préstamos con "${clean}". Pedile al usuario el rol y la ubicación.` };
  }
  return { ok: true, personas };
}

async function activeLoans({ persona = '' } = {}, siteCode) {
  const { items } = await getMergedDevices({ siteCode });
  const filtered = items.filter(item => {
    if (!isLoanedState(item.estado)) return false;
    if (persona && !normalize(item.prestadoA).includes(normalize(persona))) return false;
    return true;
  }).slice(0, 12);
  return { ok: true, total: filtered.length, items: filtered.map(i => ({ etiqueta: i.etiqueta, alias: i.aliasOperativo || '', persona: i.prestadoA || '', rol: i.rol || '', ubicacion: i.ubicacion || '', motivo: i.motivo || '', desde: i.loanedAt || '' })) };
}

function loanHistory({ desde = '', hasta = '', persona = '', etiqueta = '' } = {}, siteCode) {
  const conditions = ['site_code=?'];
  const params = [siteCode];
  if (persona) { conditions.push('persona LIKE ?'); params.push(`%${persona}%`); }
  if (etiqueta) { conditions.push('upper(etiqueta)=?'); params.push(normalizeCode(etiqueta)); }
  if (desde) { conditions.push('timestamp >= ?'); params.push(`${desde}T00:00:00`); }
  if (hasta) { conditions.push('timestamp <= ?'); params.push(`${hasta}T23:59:59`); }
  const rows = getDb().prepare(`
    SELECT tipo, etiqueta, alias, persona, rol, ubicacion, motivo, operador, timestamp
    FROM loan_events WHERE ${conditions.join(' AND ')}
    ORDER BY timestamp DESC LIMIT 300
  `).all(...params);
  return { ok: true, total: rows.length, items: rows.slice(0, 50) };
}

function tasksList({ estado = '', buscar = '' } = {}, siteCode) {
  const rows = getDb().prepare('SELECT id, titulo, descripcion, estado, prioridad, responsable, fecha_vencimiento AS vence FROM tasks WHERE eliminada=0 AND site_code=? ORDER BY fecha_creacion DESC LIMIT 50').all(siteCode);
  const byEstado = rows.filter(row => !estado || normalize(row.estado) === normalize(estado));
  const q = normalize(buscar);
  if (!q) return { ok: true, total: byEstado.length, items: byEstado.slice(0, 12) };
  const words = q.split(/\s+/).filter(w => w.length > 2);
  const haystack = row => normalize(`${row.titulo} ${row.descripcion}`);
  // Primero frase completa, después todas las palabras, después cualquiera:
  // "ordenar el maker" tiene que encontrar la tarea "Maker".
  let filtered = byEstado.filter(row => haystack(row).includes(q));
  if (!filtered.length && words.length) filtered = byEstado.filter(row => words.every(w => haystack(row).includes(w)));
  if (!filtered.length && words.length) filtered = byEstado.filter(row => words.some(w => haystack(row).includes(w)));
  if (!filtered.length) return { ok: true, total: 0, items: [], nota: `Ninguna tarea coincide con "${buscar}". Probá con otra palabra o pedí la lista completa.` };
  return { ok: true, total: filtered.length, items: filtered.slice(0, 12) };
}

function agendaList({ rango = 'hoy' } = {}, siteCode) {
  const rows = getDb().prepare('SELECT id, dia, fecha, desde, hasta, curso, actividad, tipo_dispositivo AS tipo, cantidad, ubicacion, estado FROM agenda WHERE eliminada=0 AND site_code=? ORDER BY fecha, desde LIMIT 50').all(siteCode);
  const today = dayName(new Date());
  const todayDate = toLocalDate(new Date());
  const filtered = (rango === 'hoy'
    ? rows.filter(row => (row.fecha ? row.fecha === todayDate : normalize(row.dia) === normalize(today)))
    : rows
  ).slice(0, 12);
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
  const results = await searchProcedures(consulta || '');
  if (!results.length) return { ok: true, total: 0, items: [], nota: 'No hay procedimientos cargados que coincidan.' };
  return { ok: true, total: results.length, items: results.slice(0, 5) };
}

function openSection({ seccion } = {}) {
  if (!SECTIONS.includes(seccion)) return { ok: false, error: 'Esa sección no existe en la app.' };
  return { ok: true, seccion, nombre: SECTION_LABELS[seccion], mensaje: `Navegando a ${SECTION_LABELS[seccion]}.` };
}

// ---------- Escritura (mismo flujo que las rutas reales) ----------

// Replica POST /api/loans/lend: local_states + invalidación de caché +
// local_movements + loan_events. NUNCA escribir en la tabla legacy `prestamos`:
// la UI y el inventario leen de local_states vía getMergedDevices.
async function registerLoan(args, siteCode, access) {
  if (!String(args.codigo_dispositivo || '').trim()) return { ok: false, error: 'Falta la etiqueta del dispositivo a prestar.' };
  const device = await findDevice(args.codigo_dispositivo, siteCode);
  if (!device) return { ok: false, error: `No existe el dispositivo "${args.codigo_dispositivo}" en el inventario de ${siteCode}.` };
  const etiqueta = normalizeCode(device.etiqueta);
  const label = device.aliasOperativo ? `${etiqueta} (${device.aliasOperativo})` : etiqueta;
  if (!isAvailableState(device.estado)) {
    const quien = device.prestadoA ? ` a ${device.prestadoA}` : '';
    return { ok: false, error: `${label} está ${device.estado}${quien} y no se puede prestar. Si corresponde, primero registrá la devolución.` };
  }
  const persona = String(args.usuario_nombre || '').trim();
  if (!persona) return { ok: false, error: 'Falta el nombre de la persona que recibe el equipo.' };

  const fecha = nowIso();
  const operador = access?.user?.nombre || access?.user?.email || 'Asistente IA';
  setLocalState(etiqueta, {
    estado: 'Prestado',
    prestadoA: persona,
    rol: args.rol || '',
    ubicacion: args.ubicacion || '',
    ubicacionDetalle: '',
    curso: '',
    motivo: args.motivo || '',
    motivoDetalle: '',
    comentarios: 'Registrado vía Asistente IA',
    loanedAt: fecha,
    returnedAt: '',
    siteCode
  });
  invalidateDeviceInventoryCache('assistant-lend', siteCode);
  addLocalMovement({ tipo: 'préstamo', descripcion: `${label} prestada a ${persona}`, operador, origen: 'Asistente IA', etiqueta, siteCode });
  addLoanEvent({
    siteCode, tipo: 'prestamo', etiqueta,
    alias: device.aliasOperativo || '', filtro: device.filtro || device.categoria || '',
    persona, rol: args.rol || '', ubicacion: args.ubicacion || '',
    motivo: args.motivo || '', operador, origen: 'Asistente IA', timestamp: fecha
  });
  return { ok: true, mensaje: `${label} quedó registrado como prestado a ${persona} (${args.rol || 'sin rol'}, ${args.ubicacion || 'sin ubicación'}).` };
}

// Replica POST /api/loans/return, incluida la idempotencia si ya estaba disponible.
async function registerReturn(args, siteCode, access) {
  if (!String(args.codigo_dispositivo || '').trim()) return { ok: false, error: 'Falta la etiqueta del dispositivo a devolver.' };
  const device = await findDevice(args.codigo_dispositivo, siteCode);
  if (!device) return { ok: false, error: `No existe el dispositivo "${args.codigo_dispositivo}" en el inventario de ${siteCode}.` };
  const etiqueta = normalizeCode(device.etiqueta);
  const label = device.aliasOperativo ? `${etiqueta} (${device.aliasOperativo})` : etiqueta;
  if (!isLoanedState(device.estado)) {
    return { ok: true, idempotente: true, mensaje: `${label} ya estaba ${device.estado || 'disponible'}. No se registró otra devolución.` };
  }

  const fecha = nowIso();
  const operador = access?.user?.nombre || access?.user?.email || 'Asistente IA';
  const condicion = args.condicion || 'bueno';
  const comentarios = [args.comentario || '', condicion !== 'bueno' ? `Condición: ${condicion}` : ''].filter(Boolean).join(' | ');
  setLocalState(etiqueta, {
    estado: 'Disponible', prestadoA: '', rol: '', ubicacion: '', ubicacionDetalle: '',
    curso: '', motivo: '', motivoDetalle: '', comentarios: '', loanedAt: '', returnedAt: fecha, siteCode
  });
  invalidateDeviceInventoryCache('assistant-return', siteCode);
  addLocalMovement({ tipo: 'devolución', descripcion: `${label} devuelta${condicion !== 'bueno' ? ` (${condicion})` : ''}`, operador, origen: 'Asistente IA', etiqueta, siteCode });
  // device se capturó antes de limpiar local_states, así que conserva los datos del préstamo.
  addLoanEvent({
    siteCode, tipo: 'devolucion', etiqueta,
    alias: device.aliasOperativo || '', filtro: device.filtro || device.categoria || '',
    persona: device.prestadoA || '', rol: device.rol || '', ubicacion: device.ubicacion || '',
    motivo: device.motivo || '', comentarios, operador, origen: 'Asistente IA', timestamp: fecha
  });
  const extra = condicion !== 'bueno' ? ' Ofrecé crear una tarea TIC para revisar el equipo.' : '';
  return { ok: true, mensaje: `${label} devuelto (condición: ${condicion}).${extra}` };
}

function createTask(args, siteCode, access) {
  const titulo = String(args.titulo || '').trim();
  if (!titulo) return { ok: false, error: 'Falta el título de la tarea.' };
  const db = getDb();
  const ts = nowIso();
  const id = `TK${Date.now()}`;
  const operador = access?.user?.nombre || access?.user?.email || 'Asistente IA';
  const responsable = args.responsable || 'Sin asignar';
  db.prepare(`
    INSERT INTO tasks (id, site_code, titulo, descripcion, responsable, responsables_json, estado, prioridad, tipo, turno, fecha_creacion, fecha_vencimiento, comentario, creado_por, operador_ultimo_cambio, agenda_id, ultima_modificacion)
    VALUES (?, ?, ?, ?, ?, '', 'Pendiente', ?, 'Soporte', 'Sin turno', ?, '', '', ?, ?, '', ?)
  `).run(id, siteCode, titulo, args.descripcion || '', responsable, args.prioridad || 'Media', ts, operador, operador, ts);
  db.prepare('INSERT INTO task_history (task_id, site_code, timestamp, titulo, accion, responsable, estado_anterior, estado_nuevo, comentario, operador, agenda_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, siteCode, ts, titulo, 'tarea creada', responsable, '', 'Pendiente', '', operador, '');
  try {
    notifySiteAdmins({
      siteCode, kind: 'task.created',
      title: `Nueva tarea: ${titulo}`,
      body: `Cargada por ${operador} vía Asistente IA`,
      link: `/sede/${siteCode}/tareas`,
      exceptEmail: access?.user?.email
    });
  } catch { /* las notificaciones no deben bloquear la creación */ }
  return { ok: true, id, mensaje: `Tarea creada: "${titulo}" (prioridad ${args.prioridad || 'Media'}, responsable ${responsable}).` };
}

function createAgenda(args, siteCode, access) {
  const actividad = String(args.actividad || '').trim();
  if (!actividad) return { ok: false, error: 'Falta la descripción de la actividad.' };
  const db = getDb();
  const ts = nowIso();
  const id = `AG${Date.now()}`;
  const operador = access?.user?.nombre || access?.user?.email || 'Asistente IA';
  const fecha = args.fecha || nextDateForDay(args.dia);
  const dia = args.dia || (fecha ? dayName(new Date(`${fecha}T12:00:00`)) : '');
  const desde = args.desde || '';
  const turno = desde && desde < '13:00' ? 'Mañana' : desde ? 'Tarde' : '';
  db.prepare(`
    INSERT INTO agenda (id, site_code, dia, fecha, turno, desde, hasta, curso, actividad, tipo_dispositivo, cantidad, ubicacion, responsable_tic, estado, nota, compus_retiradas, operador_ultimo_cambio, ultima_modificacion, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '', 0, ?, '', 'Pendiente', '', 0, ?, ?, ?)
  `).run(id, siteCode, dia, fecha, turno, desde, args.hasta || '', args.curso || '', actividad, args.ubicacion || '', operador, ts, ts);
  db.prepare('INSERT INTO agenda_history (agenda_id, site_code, timestamp, accion, estado_anterior, estado_nuevo, nota, operador) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, siteCode, ts, 'actividad creada', '', 'Pendiente', '', operador);
  return { ok: true, id, mensaje: `Actividad creada: "${actividad}" el ${dia} ${fecha} de ${desde}${args.hasta ? ` a ${args.hasta}` : ''}.` };
}

// Próxima ocurrencia del día de la semana pedido (si hoy es ese día, usa hoy).
function nextDateForDay(diaNombre) {
  const target = normalize(diaNombre);
  if (!target) return '';
  for (let offset = 0; offset < 7; offset++) {
    const candidate = addDays(new Date(), offset);
    if (normalize(dayName(candidate)) === target) return toLocalDate(candidate);
  }
  return '';
}

// ---------- Fallback sin API key ----------

function localFallback(messages, access) {
  const last = messages?.[messages.length - 1]?.content || '';
  const siteCode = String(access?.siteCode || config.defaultSiteCode || 'NFPT').toUpperCase();
  const match = last.match(/\bD\s*0*(\d{1,5})\b/i);
  if (match) {
    const code = normalizeCode(`D${match[1]}`);
    const device = buildLocalInventory(siteCode).find(item => normalizeCode(item.etiqueta) === code);
    if (!device) return { reply: `No encontré ${code} en el inventario de ${siteCode}.`, suggestedRoute: 'devices' };
    if (isLoanedState(device.estado)) return { reply: `${code} está prestado a ${device.prestadoA || 'alguien sin registrar'}.`, suggestedRoute: 'loans' };
    return { reply: `${code} está ${device.estado || 'disponible'} en el inventario.`, suggestedRoute: 'devices' };
  }
  if (/prestamo|prestar|prestale|devol/i.test(last)) return { reply: 'El asistente con IA no está configurado. Podés registrar préstamos y devoluciones desde la pantalla de Préstamos.', suggestedRoute: 'loans' };
  if (/hola|buenas|ayuda/i.test(last)) return { reply: 'Hola. Puedo decirte el estado de un equipo si me pasás la etiqueta (ej. D1436). Para el asistente completo hace falta configurar la API de IA.', suggestedRoute: null };
  return { reply: 'El asistente con IA no está configurado en este servidor. Pasame una etiqueta (ej. D1436) y te digo su estado.', suggestedRoute: null };
}

async function deterministicLoanDraft(text, access) {
  const parsed = parseLoanRequest(text);
  if (!parsed) return null;
  const siteCode = String(access?.siteCode || config.defaultSiteCode || 'NFPT').toUpperCase();
  const device = await findDevice(parsed.device, siteCode);
  if (!device) {
    return { reply: `No encontré "${parsed.device}" en el inventario de ${siteCode}.`, suggestedRoute: 'devices' };
  }
  const etiqueta = normalizeCode(device.etiqueta);
  const label = device.aliasOperativo ? `${device.aliasOperativo} (${etiqueta})` : etiqueta;
  if (!isAvailableState(device.estado)) {
    const quien = device.prestadoA ? ` a ${device.prestadoA}` : '';
    return { reply: `${label} está ${device.estado}${quien}; primero registrá la devolución si corresponde.`, suggestedRoute: 'loans' };
  }
  const personInfo = findPerson({ nombre: parsed.person }, siteCode);
  const person = personInfo?.personas?.[0] || {};
  const role = person.rol_habitual || '';
  const location = person.ubicacion_habitual || '';
  if (!role || !location) {
    return { reply: `Tengo ${label} para ${titleCase(parsed.person)}. Me falta rol y ubicación para confirmarlo.`, suggestedRoute: 'loans' };
  }
  return {
    reply: `¿Confirmo? ${label} → ${person.nombre || titleCase(parsed.person)} (rol ${role}, ubicación ${location})`,
    suggestedRoute: 'loans'
  };
}

function parseLoanRequest(text) {
  const raw = String(text || '').trim();
  const lower = normalize(raw);
  if (!/(prest|prestar|prestale|dale|dalo|daselo|dáselo|asigna|asignale)/.test(lower)) return null;
  const deviceMatch =
    raw.match(/\bD\s*0*\d{1,5}\b/i)?.[0] ||
    raw.match(/\b(?:touch|plani|tic|tablet|dell)\s*\d{1,3}\b/i)?.[0] ||
    '';
  const personMatch = raw.match(/\ba\s+(.+?)(?:\s+en\b|\s+para\b|\s+por\b|,|$)/i)?.[1]?.trim() || '';
  if (!deviceMatch || !personMatch) return null;
  const person = personMatch.replace(/\b(?:la|el|un|una)\b/gi, '').trim();
  return person ? { device: deviceMatch, person } : null;
}

function getLastUserMessage(messages = []) {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === 'user') return String(messages[i]?.content || '');
  }
  return '';
}

function isGenericAssistantReply(reply) {
  const clean = normalize(reply);
  return /te escucho|decime que|decime que necesitas|como te ayudo|en que te ayudo/.test(clean);
}

function titleCase(value) {
  return String(value || '').trim().replace(/\S+/g, word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
}

// ---------- OpenAI Responses API ----------

async function callResponses(input, { allowTools = true } = {}) {
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.openaiApiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.openaiModel || 'gpt-4.1-mini',
      input,
      tools: TOOLS,
      tool_choice: allowTools ? 'auto' : 'none'
    })
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`OpenAI HTTP ${response.status}: ${body.slice(0, 300)}`);
  }
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

// Bloqueado a propósito: no reintroducir ejecución de SQL libre acá.
// El aislamiento multi-tenant depende de que TODAS las consultas pasen
// por herramientas que filtran por site_code.
function runSqlQuery(_args = {}, siteCode) {
  return {
    ok: false,
    error: `Por seguridad multi-tenant, el asistente no ejecuta consultas SQL libres. Solo puede usar herramientas ya filtradas por la sede ${siteCode}.`
  };
}

// ---------- Helpers ----------

function parseArgs(raw) {
  try { return JSON.parse(raw || '{}'); } catch { return {}; }
}

function isLoanedState(value) {
  const state = normalize(value);
  return state.includes('prest') || state.includes('retir');
}

function isAvailableState(value) {
  const state = normalize(value);
  return !state || state.includes('disponible') || state.includes('devuelto') || state.includes('sin revisar');
}

function bump(map, value) {
  const key = String(value || '').trim();
  if (!key) return;
  map[key] = (map[key] || 0) + 1;
}

function mode(map) {
  let best = '';
  let bestCount = 0;
  for (const [key, count] of Object.entries(map)) {
    if (count > bestCount) { best = key; bestCount = count; }
  }
  return best;
}
