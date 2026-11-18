import { config } from '../../config.js';
import { addDays, currentDateTimeText, dayName, normalize, normalizeCode, toLocalDate } from './utils.js';
import { addLoanEvent, addLocalMovement, getDb, nowIso, setLocalState } from '../../db.js';
import { buildLocalInventory, getMergedDevices, invalidateDeviceInventoryCache } from '../deviceInventory.service.js';
import { notifySiteAdmins } from '../notifications.service.js';
import { searchProcedures } from '../procedureSearch.js';
import { searchKnowledgeArticles } from '../knowledge.service.js';
import { claudeClient, hasClaude, responseText } from '../claude.service.js';
import { findRosterPerson, normalizePersonName, parseRosterText, rosterCounts, saveRoster, searchRoster } from '../peopleRoster.service.js';
import { invalidateLoanPeople, searchLoanPeople } from '../loanPeople.service.js';
import crypto from 'node:crypto';

const MAX_ROUNDS = 5;

// Vistas válidas de App.tsx (setView). El asistente navega solo a estas.
const SECTIONS = ['dashboard', 'devices', 'loans', 'inventory', 'analytics', 'agenda', 'schedules', 'tasks', 'reminders', 'pettycash', 'classrooms', 'tools', 'quickaccess', 'tickets', 'suggestions', 'settings'];

const SECTION_LABELS = {
  dashboard: 'Inicio', devices: 'Dispositivos', loans: 'Préstamos', inventory: 'Inventario maker',
  analytics: 'Analítica', agenda: 'Agenda TIC', tasks: 'Tareas TIC', classrooms: 'Estado de aulas',
  schedules: 'Horarios', reminders:'Recordatorios', pettycash: 'Caja chica', tools: 'Herramientas', quickaccess: 'Accesos rápidos', tickets: 'Tickets', suggestions:'Sugerencias', settings: 'Configuración'
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
  crear_recordatorio: 'reminders',
  buscar_persona: 'loans',
  consulta_bd: null
};

function buildSystemPrompt(access, knowledgeContext = '', context = null) {
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

VARIOS PEDIDOS EN UN MENSAJE: si en un mismo mensaje te piden varias cosas (por ejemplo revisar dos equipos, o devolver uno y prestar otro), resolvé TODAS. Llamá todas las herramientas que hagan falta, en la misma vuelta si podés, y respondé cada una por separado. Nunca te quedes solo con la primera.

PRÉSTAMOS — cuando te pidan prestar algo:
1. Fijate con detalle_dispositivo que el equipo exista y esté disponible, y con buscar_persona quién es (curso, si es docente o alumno, rol y ubicación que usa siempre). Podés pedir ambas cosas al mismo tiempo.
2. Si la persona tiene historial o está en la lista de personas, proponé directamente ese rol, curso y ubicación.
3. Usá registrar_prestamo. OJO: no registra nada todavía; al usuario le aparece un botón «Confirmar» con los datos. Decile en una frase corta qué va a quedar registrado y que lo confirme con el botón. Nunca digas que ya quedó prestado: recién queda cuando el usuario toca el botón.
4. Ningún dato es obligatorio salvo el equipo y saber a quién: el nombre, o si no lo sabe, una descripción en comentario (curso, cómo es). No frenes un préstamo por falta de rol o ubicación.

DEVOLUCIONES: verificá con detalle_dispositivo que esté prestado y usá registrar_devolucion; también deja un botón para que el usuario confirme. Si no te dicen condición, asumí "bueno". Si el alias que te dicen coincide con varios equipos (detalle_dispositivo te devuelve "coincidencias"), preguntá cuál antes de seguir.

PERSONAS: buscar_persona busca en el historial de préstamos y en la lista de docentes y alumnos de la sede. Cuando nombren a alguien, decí su curso y si es docente o alumno según la lista. Si no está en la lista ni en el historial, decilo así; jamás adivines el curso ni el rol.

LISTAS DE DOCENTES Y ALUMNOS: si te pegan una lista de nombres para guardar, usá cargar_lista_personas (el texto lo tomo yo directo del mensaje: no lo copies en la herramienta). Queda un botón para que el usuario confirme; decile cuántas personas entendiste y que confirme.

MEMORIA: tenés toda la conversación de este chat. Al principio de tus mensajes anteriores, entre corchetes, está lo que consultaste con las herramientas en ese momento: usalo para no volver a preguntar lo que ya sabés. Si es un dato que pudo cambiar (el estado de un equipo, quién lo tiene), volvé a consultarlo. Nunca escribas vos esos corchetes en tus respuestas.

TAREAS Y AGENDA: si el pedido es claro, crealas sin vueltas ni confirmación. Metele responsable, prioridad y detalles en el mismo llamado. NO podés editar ni borrar cosas existentes — si te lo piden, decí "mirá, no puedo modificar eso, pero te llevo a la sección y lo hacés vos".

NAVEGACIÓN: si te piden ir a algún lado ("llevame a tareas", "abrí préstamos"), usá abrir_seccion. Si además te pidieron un dato específico, buscalo primero con la herramienta y decí algo como "te llevo a Tareas, por cierto la tarea Maker está pendiente, vence el 19/06".
- Si te piden abrir, entrar, ver la ficha o el reporte de un dispositivo concreto, usá detalle_dispositivo: al usuario le aparece un botón para abrir la ficha sin salir del chat. No mandes un dispositivo a Inventario maker: los equipos Dxxxx, Dell, Touch, Plani y TIC viven en Dispositivos.
- No uses abrir_seccion si no te pidieron ir a una pantalla: consultar un dato no es motivo para sacar al usuario de donde está.

LÍMITE DE SEDE: TODO lo que hago es exclusivamente de la sede ${siteCode}. No puedo ver ni modificar datos de otras sedes. Si te piden algo de otra sede, decí que los tenants están separados y que necesitan cambiarse a esa sede con los permisos correspondientes.

BASE DE CONOCIMIENTO: antes de responder preguntas técnicas, priorizá siempre la documentación interna incluida abajo o consultá base_conocimiento. Si hay una respuesta interna relevante, usala por encima de una explicación genérica y mencioná el título del artículo. No inventes pasos que contradigan esa documentación.

${knowledgeContext ? `DOCUMENTACIÓN INTERNA RELEVANTE DE ${siteCode}:\n${knowledgeContext}` : 'No apareció documentación interna relevante para el último mensaje.'}

${context ? `CONTEXTO DE LA PANTALLA ABIERTA (usalo para resolver referencias como "este", "acá" o "el actual"): ${JSON.stringify(context).slice(0,4000)}` : 'No hay una entidad abierta en este momento.'}

CONSULTAS LIBRES: si una pregunta no se puede responder con las herramientas que tengo, avisá que por seguridad no podés hacer consultas libres a la base y ofreceles la pantalla más cercana o las herramientas que sí están disponibles.

CÓMO HABLO: español rioplatense (vos), como si estuviera charlando con un colega en el taller. Nada de Markdown ni emojis. Nada de "estimado usuario" ni fórmulas robóticas. Si algo está bien, va un "todo bien", "joya", "dale". Si algo está mal, lo digo derecho viejo. Variá las respuestas, no repitas siempre la misma estructura. Usá contracciones, frases cortas, preguntá si hace falta. Sé directo pero no seco — como cuando le hablás a alguien que está al lado tuyo.

Hoy es ${currentDateTimeText()} (hora de Argentina).`;
}

const TOOLS = [
  {
    type: 'function',
    name: 'base_conocimiento',
    description: 'Busca primero en la documentación técnica interna de la organización. Usar antes de responder preguntas de configuración, troubleshooting o procedimientos.',
    parameters: {
      type: 'object',
      properties: { consulta: { type: 'string', description: 'Pregunta o términos técnicos a buscar.' } },
      required: ['consulta']
    }
  },
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
    description: 'Busca personas por nombre o apellido en la lista de docentes y alumnos de la sede y en el historial de préstamos. Devuelve nombre exacto, si es docente o alumno y su curso (según la lista), y rol/ubicación/curso más frecuentes en préstamos. Usá esos valores como propuesta para un préstamo nuevo; si no aparece, decilo.',
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
    description: 'Prepara un préstamo y le muestra al usuario un botón para confirmarlo. NO registra nada hasta que el usuario toca el botón. Hace falta el dispositivo y el nombre de la persona (o, si no se sabe, un comentario que la describa); el resto es opcional.',
    parameters: {
      type: 'object',
      properties: {
        codigo_dispositivo: { type: 'string', description: 'Etiqueta del dispositivo, ej. D1436, o alias "Touch 34".' },
        usuario_nombre: { type: 'string', description: 'Nombre de la persona que recibe el equipo. Vacío si no se sabe.' },
        rol: { type: 'string', description: 'Rol: DOE, Docente, Alumno, Preceptor, Directivo, Administración. Opcional.' },
        ubicacion: { type: 'string', description: 'Ubicación, ej. DOE, SUM, Aula 12, Dirección. Opcional.' },
        curso: { type: 'string', description: 'Curso, ej. 3S o EP · 2F. Opcional.' },
        motivo: { type: 'string', description: 'Motivo del préstamo. Opcional.' },
        comentario: { type: 'string', description: 'Lo que se sepa aunque falten datos (color del equipo, cómo es la persona). Opcional.' }
      },
      required: ['codigo_dispositivo']
    }
  },
  {
    type: 'function',
    name: 'registrar_devolucion',
    description: 'Prepara la devolución de un dispositivo prestado y le muestra al usuario un botón para confirmarla. NO registra nada hasta que el usuario toca el botón.',
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

TOOLS.push({
  type: 'function',
  name: 'cargar_lista_personas',
  description: 'Prepara la carga de una lista de docentes o alumnos que el usuario pegó en su último mensaje (el texto lo toma el sistema directo del mensaje, no lo copies). Le muestra al usuario cuántas personas se entendieron y un botón para confirmar el guardado.',
  parameters: {
    type: 'object',
    properties: {
      tipo: { type: 'string', enum: ['docente', 'alumno'], description: 'Tipo por defecto de la lista si el texto no lo dice con un título "Docentes:" o "Alumnos:".' },
      curso: { type: 'string', description: 'Curso de toda la lista si el usuario lo dijo (ej. "3S") y los renglones no lo traen. Opcional.' },
      modo: { type: 'string', enum: ['agregar', 'reemplazar'], description: 'agregar (por defecto) suma a la lista; reemplazar borra la lista de ese tipo y la carga de nuevo. Solo si lo pidieron explícitamente.' }
    },
    required: ['tipo']
  }
});

const WRITE_TOOLS = new Set(['registrar_prestamo', 'registrar_devolucion', 'crear_tarea', 'crear_evento_agenda', 'cargar_lista_personas']);
// Herramientas que no escriben: preparan una acción que el usuario confirma con un botón.
const CONFIRM_TOOLS = new Set(['registrar_prestamo', 'registrar_devolucion', 'cargar_lista_personas']);
TOOLS.push({ type:'function', name:'crear_recordatorio', description:'Crea inmediatamente un recordatorio cuando título y fecha/hora están claros.', parameters:{ type:'object', properties:{ titulo:{type:'string'}, descripcion:{type:'string'}, fecha_hora:{type:'string',description:'Fecha y hora ISO'}, prioridad:{type:'string',enum:['Baja','Media','Alta','Urgente']}, tipo_relacion:{type:'string'}, id_relacion:{type:'string'}, nombre_relacion:{type:'string'} }, required:['titulo','fecha_hora'] } });
WRITE_TOOLS.add('crear_recordatorio');

export async function runToolLoop({ messages, access, context = null }) {
  const lastUserMessage = getLastUserMessage(messages);
  if (!hasClaude()) return localFallback(messages, access);

  const knowledgeContext = searchKnowledgeArticles(String(access?.siteCode || config.defaultSiteCode || 'NFPT').toUpperCase(), lastUserMessage, 3)
    .map(article => `[${article.title}] (${article.category || 'General'}; tags: ${article.tags.join(', ') || 'sin tags'})\n${article.contentText.slice(0, 2500)}`)
    .join('\n\n');

  const system = buildSystemPrompt(access, knowledgeContext, context);
  const conversation = toClaudeMessages(messages);
  if (!conversation.length) return { reply: '¿En qué te doy una mano?', suggestedRoute: null };

  let suggestedRoute = null;
  // Fichas que salieron en esta respuesta: el front las muestra como botones
  // "Ver ficha" bajo el mensaje. Antes se abría sola la primera y se cerraba el
  // chat, aunque hubieran pedido revisar varias.
  const devices = [];
  const actions = [];
  const memory = [];
  const wantsToOpen = /(abr[ií]|entr[aá]|ficha|reporte|llev[aá])/i.test(lastUserMessage);
  const finish = (reply) => {
    const openDevice = wantsToOpen && devices.length === 1 ? devices[0].etiqueta : null;
    return { reply, suggestedRoute, suggestedDevice: openDevice, openDevice, devices, actions, memory: memory.join(' | ').slice(0, 1800) };
  };

  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const lastRound = round === MAX_ROUNDS - 1;
      const response = await callClaude(system, conversation, { allowTools: !lastRound });
      // El contenido va entero (con los bloques de thinking) para que la vuelta
      // siguiente lo reciba igual que lo generó el modelo.
      conversation.push({ role: 'assistant', content: response.content });
      const toolCalls = response.content.filter(block => block.type === 'tool_use');

      if (response.stop_reason !== 'tool_use' || !toolCalls.length) {
        const reply = responseText(response);
        if (!reply) return { reply: 'No pude procesar el mensaje. ¿Podés reformularlo?', suggestedRoute: null };
        if (!actions.length && isGenericAssistantReply(reply)) {
          const deterministic = await deterministicLoanDraft(lastUserMessage, access);
          if (deterministic) return deterministic;
        }
        return finish(reply);
      }

      // Todos los resultados de una vuelta viajan juntos en un solo mensaje.
      const results = [];
      for (const call of toolCalls) {
        const args = call.input && typeof call.input === 'object' ? call.input : {};
        const result = await runAssistantTool(call.name, args, access, { lastUserMessage });
        if (result?.ok !== false) {
          if (call.name === 'detalle_dispositivo' && result?.item?.etiqueta) {
            addDevice(devices, result.item);
          } else if (call.name === 'buscar_dispositivos' && result?.items?.length === 1 && wantsToOpen) {
            addDevice(devices, result.items[0]);
          } else if (call.name === 'abrir_seccion' && result?.seccion) suggestedRoute = result.seccion;
        }
        // La acción (con su payload) viaja al front; al modelo le llega solo el aviso.
        let forModel = result;
        if (result?.accion) {
          actions.push(result.accion);
          const { accion: _accion, ...rest } = result;
          forModel = rest;
        }
        memory.push(`${call.name}(${JSON.stringify(args).slice(0, 160)}) → ${JSON.stringify(forModel).slice(0, 360)}`);
        results.push({ type: 'tool_result', tool_use_id: call.id, content: JSON.stringify(forModel).slice(0, 6000), is_error: result?.ok === false });
      }
      conversation.push({ role: 'user', content: results });
    }
  } catch (error) {
    console.error('[assistant] fallo del loop:', error?.message || error);
    return { reply: 'No pude conectarme con el servicio de IA en este momento. Probá de nuevo en unos segundos.', suggestedRoute: null };
  }

  return finish('Hice varias consultas pero no llegué a una respuesta clara. ¿Podés reformular el pedido?');
}

function addDevice(list, item) {
  const etiqueta = String(item?.etiqueta || '').trim();
  if (!etiqueta || list.some(entry => entry.etiqueta === etiqueta)) return;
  list.push({ etiqueta, alias: String(item.alias || item.aliasOperativo || '') });
}

/**
 * Ejecuta una acción que el Asistente dejó preparada y el usuario confirmó con
 * el botón. Valida todo de nuevo contra la base: el payload viene del navegador.
 */
export async function confirmAssistantAction(action, access) {
  const type = String(action?.type || '');
  const payload = action?.payload && typeof action.payload === 'object' ? action.payload : {};
  const siteCode = String(access?.siteCode || config.defaultSiteCode || 'NFPT').toUpperCase();
  if (!access?.canEdit) return { ok: false, error: 'Tu rol es de solo consulta: no podés confirmar esta acción.' };
  try {
    if (type === 'lend') return await registerLoan(payload, siteCode, access);
    if (type === 'return') return await registerReturn(payload, siteCode, access);
    if (type === 'roster') {
      const people = parseRosterText(String(payload.text || ''), { defaultTipo: payload.tipo });
      if (!people.length) return { ok: false, error: 'No encontré nombres para guardar.' };
      const result = saveRoster(siteCode, people, {
        mode: payload.modo === 'reemplazar' ? 'reemplazar' : 'agregar',
        replaceTipo: payload.tipo === 'docente' ? 'docente' : 'alumno',
        createdBy: access?.user?.nombre || access?.user?.email || 'Asistente IA'
      });
      return { ok: true, mensaje: `Lista guardada: ${result.added} nuevas${result.updated ? `, ${result.updated} actualizadas` : ''}${result.removed ? `, ${result.removed} quitadas` : ''}. Ahora hay ${result.docentes} docentes y ${result.alumnos} alumnos en la lista.` };
    }
    return { ok: false, error: 'Acción desconocida.' };
  } catch (error) {
    console.error('[assistant] error al confirmar acción:', error);
    return { ok: false, error: 'No se pudo completar. Probá de nuevo o hacelo desde la pantalla.' };
  }
}

// Ejecuta una herramienta con permisos y captura de errores. Cualquier excepción
// interna se loguea completa acá y al modelo solo le llega un mensaje transmisible,
// para que no invente causas técnicas.
export async function runAssistantTool(name, args, access, extra = {}) {
  if (WRITE_TOOLS.has(name) && !access?.canEdit) {
    return { ok: false, error: 'El usuario no tiene permisos para esta acción: su rol es de solo consulta.' };
  }
  try {
    if (CONFIRM_TOOLS.has(name)) return await prepareAction(name, args, access, extra);
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
    case 'base_conocimiento': return knowledgeSearch(args, siteCode);
    case 'abrir_seccion': return openSection(args);
    case 'registrar_prestamo': return registerLoan(args, siteCode, access);
    case 'registrar_devolucion': return registerReturn(args, siteCode, access);
    case 'crear_tarea': return createTask(args, siteCode, access);
    case 'crear_evento_agenda': return createAgenda(args, siteCode, access);
    case 'crear_recordatorio': return createReminder(args, siteCode, access);
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
  const all = await findDevices(etiqueta, siteCode);
  if (all.length > 1) {
    return {
      ok: true,
      coincidencias: all.slice(0, 6).map(device => ({ etiqueta: device.etiqueta, alias: device.aliasOperativo || '', tipo: device.filtro || device.dispositivo || '', estado: device.estado || 'Disponible', prestadoA: device.prestadoA || '' })),
      nota: `Hay ${all.length} equipos que coinciden con "${etiqueta}". Preguntá cuál es (por etiqueta) antes de seguir.`
    };
  }
  const device = all[0];
  if (!device) return { ok: false, error: `No existe "${etiqueta}" en el inventario de ${siteCode}. Verificá la etiqueta o alias.` };
  return { ok: true, item: { etiqueta: device.etiqueta, alias: device.aliasOperativo || '', tipo: device.filtro || device.dispositivo || '', marca: device.marca || '', modelo: device.modelo || '', estado: device.estado || 'Disponible', prestadoA: device.prestadoA || '', rol: device.rol || '', ubicacion: device.ubicacion || '', motivo: device.motivo || '', prestadoDesde: device.loanedAt || '' } };
}

// Busca por etiqueta exacta o por alias operativo ("Touch 34").
async function findDevice(value, siteCode, prefer = null) {
  const all = await findDevices(value, siteCode);
  if (all.length <= 1 || !prefer) return all[0] || null;
  // Con un alias repetido, para devolver sirve el que está prestado y para
  // prestar el que está disponible (antes agarraba siempre el primero).
  return all.find(item => (prefer === 'loaned' ? isLoanedState(item.estado) : isAvailableState(item.estado))) || all[0];
}

async function findDevices(value, siteCode) {
  const code = normalizeCode(value);
  const { items } = await getMergedDevices({ siteCode });
  const byTag = items.find(item => normalizeCode(item.etiqueta) === code);
  if (byTag) return [byTag];
  const q = normalize(value);
  if (!q) return [];
  return items.filter(item => normalize(item.aliasOperativo) === q);
}

// Lee de loan_events (historial durable, el mismo que alimenta el autocompletado
// del LoanForm). La tabla legacy `prestamos` no tiene rol/ubicación y casi no se usa.
function findPerson({ nombre } = {}, siteCode) {
  const clean = String(nombre || '').trim();
  if (clean.length < 2) return { ok: false, error: 'El nombre a buscar es muy corto (mínimo 2 letras).' };
  const listado = (name) => {
    const person = findRosterPerson(siteCode, name);
    return person ? { en_lista: true, tipo: person.tipo, curso_segun_lista: person.curso || '' } : { en_lista: false };
  };
  const personas = searchLoanPeople(siteCode, clean, 5).map(group => ({
    nombre: group.persona,
    ...listado(group.persona),
    rol_habitual: group.rol,
    ubicacion_habitual: group.ubicacion,
    curso_habitual: group.curso,
    prestamos_registrados: group.count,
    ultimo_prestamo: group.lastAt ? toLocalDate(new Date(group.lastAt)) : ''
  }));
  const known = new Set(personas.map(person => normalizePersonName(person.nombre)));
  for (const person of searchRoster(siteCode, clean, { limit: 6 })) {
    if (known.has(normalizePersonName(person.nombre))) continue;
    personas.push({ nombre: person.nombre, en_lista: true, tipo: person.tipo, curso_segun_lista: person.curso || '', prestamos_registrados: 0 });
  }
  const counts = rosterCounts(siteCode);
  if (!personas.length) {
    return {
      ok: true,
      personas: [],
      nota: counts.total
        ? `"${clean}" no está en la lista de docentes y alumnos ni en el historial de préstamos. Decilo así; no adivines curso ni rol.`
        : `No hay historial de préstamos con "${clean}" y todavía no se cargó la lista de docentes y alumnos. Pedile lo que haga falta; no adivines curso ni rol.`
    };
  }
  return { ok: true, personas: personas.slice(0, 8) };
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

function knowledgeSearch({ consulta } = {}, siteCode) {
  const items = searchKnowledgeArticles(siteCode, consulta || '', 5).map(article => ({ id: article.id, title: article.title, category: article.category, tags: article.tags, content: article.contentText.slice(0, 3500), updatedAt: article.updatedAt }));
  return { ok: true, total: items.length, items, prioridad: items.length ? 'Usá esta documentación interna como fuente principal de la respuesta.' : 'No se encontró documentación interna relevante.' };
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
  const device = await findDevice(args.codigo_dispositivo, siteCode, 'available');
  if (!device) return { ok: false, error: `No existe el dispositivo "${args.codigo_dispositivo}" en el inventario de ${siteCode}.` };
  const etiqueta = normalizeCode(device.etiqueta);
  const label = device.aliasOperativo ? `${etiqueta} (${device.aliasOperativo})` : etiqueta;
  if (!isAvailableState(device.estado)) {
    const quien = device.prestadoA ? ` a ${device.prestadoA}` : '';
    return { ok: false, error: `${label} está ${device.estado}${quien} y no se puede prestar. Si corresponde, primero registrá la devolución.` };
  }
  const persona = String(args.usuario_nombre || '').trim();
  const comentario = String(args.comentario || '').trim();
  if (!persona && !comentario) return { ok: false, error: 'Falta a quién se le presta: el nombre o, si no se sabe, una descripción en comentario.' };
  const curso = String(args.curso || '').trim();

  const fecha = nowIso();
  const operador = access?.user?.nombre || access?.user?.email || 'Asistente IA';
  setLocalState(etiqueta, {
    estado: 'Prestado',
    prestadoA: persona || 'Sin nombre',
    rol: args.rol || '',
    ubicacion: args.ubicacion || '',
    ubicacionDetalle: '',
    curso,
    motivo: args.motivo || '',
    motivoDetalle: '',
    comentarios: comentario || 'Registrado vía Asistente IA',
    loanedAt: fecha,
    returnedAt: '',
    siteCode
  });
  invalidateDeviceInventoryCache('assistant-lend', siteCode);
  invalidateLoanPeople(siteCode);
  addLocalMovement({ tipo: 'préstamo', descripcion: `${label} prestada a ${persona || 'sin nombre (ver comentario)'}`, operador, origen: 'Asistente IA', etiqueta, siteCode });
  addLoanEvent({
    siteCode, tipo: 'prestamo', etiqueta,
    alias: device.aliasOperativo || '', filtro: device.filtro || device.categoria || '',
    persona, rol: args.rol || '', ubicacion: args.ubicacion || '', curso,
    motivo: args.motivo || '', comentarios: comentario, operador, origen: 'Asistente IA', timestamp: fecha
  });
  return { ok: true, mensaje: `${label} quedó prestado a ${persona || 'sin nombre'}${[args.rol, curso, args.ubicacion].filter(Boolean).length ? ` (${[args.rol, curso, args.ubicacion].filter(Boolean).join(', ')})` : ''}.` };
}

// Prepara (sin escribir) una acción que el usuario confirma con un botón.
// Valida lo que se puede validar ahora para no mostrar un botón que va a fallar.
async function prepareAction(name, args, access, extra = {}) {
  const siteCode = String(access?.siteCode || config.defaultSiteCode || 'NFPT').toUpperCase();
  const id = crypto.randomUUID();
  if (name === 'registrar_prestamo') {
    if (!String(args.codigo_dispositivo || '').trim()) return { ok: false, error: 'Falta la etiqueta del dispositivo a prestar.' };
    const device = await findDevice(args.codigo_dispositivo, siteCode, 'available');
    if (!device) return { ok: false, error: `No existe el dispositivo "${args.codigo_dispositivo}" en el inventario de ${siteCode}.` };
    const etiqueta = normalizeCode(device.etiqueta);
    const label = device.aliasOperativo ? `${device.aliasOperativo} (${etiqueta})` : etiqueta;
    if (!isAvailableState(device.estado)) {
      const quien = device.prestadoA ? ` a ${device.prestadoA}` : '';
      return { ok: false, error: `${label} está ${device.estado}${quien} y no se puede prestar. Si corresponde, primero hay que registrar la devolución.` };
    }
    const persona = String(args.usuario_nombre || '').trim();
    const comentario = String(args.comentario || '').trim();
    if (!persona && !comentario) return { ok: false, error: 'Falta a quién se le presta: preguntá el nombre o una descripción.' };
    const payload = { codigo_dispositivo: etiqueta, usuario_nombre: persona, rol: String(args.rol || ''), ubicacion: String(args.ubicacion || ''), curso: String(args.curso || ''), motivo: String(args.motivo || ''), comentario };
    const detalle = [payload.rol, payload.curso, payload.ubicacion, payload.motivo].filter(Boolean).join(' · ');
    return {
      ok: true,
      pendiente_confirmacion: true,
      mensaje: `Quedó listo el botón para confirmar el préstamo de ${label} a ${persona || 'alguien sin nombre'}. Todavía NO está registrado.`,
      accion: { id, type: 'lend', label: 'Confirmar préstamo', summary: `${label} → ${persona || 'sin nombre'}${detalle ? ` (${detalle})` : ''}${comentario ? ` · ${comentario}` : ''}`, payload }
    };
  }
  if (name === 'registrar_devolucion') {
    if (!String(args.codigo_dispositivo || '').trim()) return { ok: false, error: 'Falta la etiqueta del dispositivo a devolver.' };
    const device = await findDevice(args.codigo_dispositivo, siteCode, 'loaned');
    if (!device) return { ok: false, error: `No existe el dispositivo "${args.codigo_dispositivo}" en el inventario de ${siteCode}.` };
    const etiqueta = normalizeCode(device.etiqueta);
    const label = device.aliasOperativo ? `${device.aliasOperativo} (${etiqueta})` : etiqueta;
    if (!isLoanedState(device.estado)) {
      return { ok: true, nota: `${label} ya figura ${device.estado || 'disponible'}: no hay nada que devolver.` };
    }
    const condicion = ['bueno', 'danado', 'incompleto'].includes(args.condicion) ? args.condicion : 'bueno';
    const payload = { codigo_dispositivo: etiqueta, condicion, comentario: String(args.comentario || '') };
    return {
      ok: true,
      pendiente_confirmacion: true,
      mensaje: `Quedó listo el botón para confirmar la devolución de ${label} (lo tenía ${device.prestadoA || 'alguien sin registrar'}). Todavía NO está registrada.`,
      accion: { id, type: 'return', label: 'Confirmar devolución', summary: `${label} · lo tenía ${device.prestadoA || 'sin registrar'}${condicion !== 'bueno' ? ` · ${condicion}` : ''}`, payload }
    };
  }
  if (name === 'cargar_lista_personas') {
    const tipo = args.tipo === 'docente' ? 'docente' : 'alumno';
    let text = extractRosterText(extra.lastUserMessage || '');
    if (args.curso && String(args.curso).trim()) text = `${String(args.curso).trim()}:\n${text}`;
    const people = parseRosterText(text, { defaultTipo: tipo });
    if (!people.length) return { ok: false, error: 'No encontré nombres en el mensaje. Pedile que pegue la lista con una persona por renglón.' };
    const modo = args.modo === 'reemplazar' ? 'reemplazar' : 'agregar';
    const docentes = people.filter(person => person.tipo === 'docente').length;
    const ejemplo = people.slice(0, 4).map(person => `${person.nombre}${person.curso ? ` (${person.curso})` : ''}`).join(', ');
    return {
      ok: true,
      pendiente_confirmacion: true,
      entendidas: people.length,
      docentes,
      alumnos: people.length - docentes,
      ejemplo,
      mensaje: `Entendí ${people.length} personas. Quedó un botón para que el usuario confirme el guardado; todavía NO está guardado.`,
      accion: {
        id,
        type: 'roster',
        label: modo === 'reemplazar' ? 'Reemplazar lista' : 'Guardar en la lista',
        summary: `${people.length} ${people.length === 1 ? 'persona' : 'personas'} (${docentes} docentes, ${people.length - docentes} alumnos). Ej.: ${ejemplo}${people.length > 4 ? '…' : ''}`,
        payload: { text, tipo, modo }
      }
    };
  }
  return { ok: false, error: `Herramienta desconocida: ${name}` };
}

// Saca del mensaje del usuario lo que es la lista: descarta los renglones de
// pedido ("cargá esta lista de alumnos de 3S") pero conserva lo que dicen del
// tipo y el curso como título, y separa listas escritas en un renglón con comas.
function extractRosterText(message) {
  const out = [];
  for (const rawLine of String(message || '').split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line) continue;
    const colon = line.indexOf(':');
    let head = colon >= 0 ? line.slice(0, colon) : line;
    let rest = colon >= 0 ? line.slice(colon + 1).trim() : '';
    const isInstruction = /\b(carg|guard|agreg|sum[aá]|pon[eé]|pas[aá]|lista|estos|estas|porfa|por favor|te paso|ac[aá] (va|est))/i.test(head);
    if (isInstruction || (colon >= 0 && /\b(docent|profe|maestr|alumn|estudiant)/i.test(head))) {
      const tipo = /\b(docent|profe|maestr)/i.test(head) ? 'Docentes' : /\b(alumn|estudiant)/i.test(head) ? 'Alumnos' : '';
      const curso = head.match(/\b((?:EP|ES)\s*)?\d{1,2}\s*(?:°|º|ro|do|er|to|mo|vo|no)?\s*(?:año|grado)?\s*[A-Z]{1,2}\b/i)?.[0] || '';
      if (tipo || curso) out.push(`${tipo || 'Alumnos'}${curso ? ` ${curso.trim()}` : ''}:`);
      if (!rest) continue;
      line = rest;
    } else if (colon >= 0 && !rest) {
      out.push(line);
      continue;
    }
    const parts = line.split(',').map(part => part.trim()).filter(Boolean);
    if (parts.length >= 3 && parts.every(part => part.split(/\s+/).length <= 4)) out.push(...parts);
    else out.push(line);
  }
  return out.join('\n');
}

// Replica POST /api/loans/return, incluida la idempotencia si ya estaba disponible.
async function registerReturn(args, siteCode, access) {
  if (!String(args.codigo_dispositivo || '').trim()) return { ok: false, error: 'Falta la etiqueta del dispositivo a devolver.' };
  const device = await findDevice(args.codigo_dispositivo, siteCode, 'loaned');
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
      link: `/sede/${siteCode}/tasks`,
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
function createReminder(args, siteCode, access) {
  const title=String(args.titulo||'').trim(); const date=new Date(String(args.fecha_hora||''));
  if(!title||Number.isNaN(date.getTime())) return {ok:false,error:'Faltan título o una fecha y hora válida.'};
  const ts=nowIso(); const relatedType=['device','classroom','ticket','loan','task','purchase','suggestion','group','knowledge'].includes(String(args.tipo_relacion||''))?String(args.tipo_relacion):'';
  const info=getDb().prepare(`INSERT INTO reminders (site_code,title,description,remind_at,owner_email,owner_name,priority,related_type,related_id,related_label,status,created_by_email,created_by_name,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?, 'pending',?,?,1,?,?)`).run(siteCode,title,String(args.descripcion||''),date.toISOString(),String(access?.user?.email||'').toLowerCase(),access?.user?.nombre||'',String(args.prioridad||'Media'),relatedType,String(args.id_relacion||''),String(args.nombre_relacion||''),String(access?.user?.email||'').toLowerCase(),access?.user?.nombre||'',ts,ts);
  return {ok:true,id:Number(info.lastInsertRowid),titulo:title,fechaHora:date.toISOString()};
}

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
  const knowledge = searchKnowledgeArticles(siteCode, last, 1)[0];
  if (knowledge && !/hola|buenas/i.test(last)) return { reply: `${knowledge.title}: ${knowledge.contentText.slice(0, 900)}`, suggestedRoute: null };
  const match = last.match(/\bD\s*0*(\d{1,5})\b/i);
  if (match) {
    const code = normalizeCode(`D${match[1]}`);
    const device = buildLocalInventory(siteCode).find(item => normalizeCode(item.etiqueta) === code);
    if (!device) return { reply: `No encontré ${code} en Dispositivos de ${siteCode}.`, suggestedRoute: 'devices' };
    const openProfile = /(abr|entr|ficha|reporte|detalle|llev)/i.test(last);
    const devices = [{ etiqueta: code, alias: device.aliasOperativo || '' }];
    const openDevice = openProfile ? code : null;
    if (isLoanedState(device.estado)) return { reply: `${code} está prestado a ${device.prestadoA || 'alguien sin registrar'}.`, suggestedRoute: null, suggestedDevice: openDevice, openDevice, devices };
    return { reply: `${code} está ${device.estado || 'disponible'}.`, suggestedRoute: null, suggestedDevice: openDevice, openDevice, devices };
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
    return { reply: `No encontré "${parsed.device}" en el inventario de ${siteCode}.`, suggestedRoute: null };
  }
  const etiqueta = normalizeCode(device.etiqueta);
  const label = device.aliasOperativo ? `${device.aliasOperativo} (${etiqueta})` : etiqueta;
  if (!isAvailableState(device.estado)) {
    const quien = device.prestadoA ? ` a ${device.prestadoA}` : '';
    return { reply: `${label} está ${device.estado}${quien}; primero registrá la devolución si corresponde.`, suggestedRoute: null };
  }
  const personInfo = findPerson({ nombre: parsed.person }, siteCode);
  const person = personInfo?.personas?.[0] || {};
  const prepared = await prepareAction('registrar_prestamo', {
    codigo_dispositivo: etiqueta,
    usuario_nombre: person.nombre || titleCase(parsed.person),
    rol: person.rol_habitual || (person.tipo === 'docente' ? 'Docente' : person.tipo === 'alumno' ? 'Alumno' : ''),
    ubicacion: person.ubicacion_habitual || '',
    curso: person.curso_segun_lista || person.curso_habitual || ''
  }, access);
  if (!prepared?.accion) return { reply: prepared?.error || `Tengo ${label} para ${titleCase(parsed.person)}, pero no pude prepararlo.`, suggestedRoute: null };
  return { reply: `Te dejo listo el préstamo de ${label}. Confirmalo con el botón.`, suggestedRoute: null, actions: [prepared.accion], devices: [], memory: '' };
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

// ---------- Claude (Messages API) ----------

const CLAUDE_TOOLS = TOOLS.map(tool => ({ name: tool.name, description: tool.description, input_schema: tool.parameters }));

async function callClaude(system, messages, { allowTools = true } = {}) {
  return claudeClient().messages.create({
    model: config.claudeModel,
    max_tokens: 4096,
    output_config: { effort: 'low' },
    system,
    tools: CLAUDE_TOOLS,
    tool_choice: { type: allowTools ? 'auto' : 'none' },
    messages
  });
}

// El historial del front viene como [{ role, content }] con texto. Claude pide
// que arranque con un mensaje del usuario: se descarta el saludo inicial.
// El historial completo del chat va como contexto (antes, a lo sumo los últimos
// 12 mensajes del front y sin nada de lo consultado). Cada respuesta anterior del
// asistente lleva adelante, entre corchetes, lo que consultó con las
// herramientas en ese momento: si no, en la vuelta siguiente "se olvidaba" de los
// datos que él mismo había dicho. Tope por tamaño: se descartan los más viejos.
const HISTORY_MAX_MESSAGES = 60;
const HISTORY_MAX_CHARS = 60000;
function toClaudeMessages(messages) {
  const recent = (messages || []).slice(-HISTORY_MAX_MESSAGES)
    .map(message => {
      const role = message.role === 'assistant' ? 'assistant' : 'user';
      const text = String(message.content || '').trim();
      const memory = role === 'assistant' ? String(message.memory || '').trim() : '';
      return { role, content: memory && text ? `[Lo que consulté para responder esto: ${memory}]\n${text}` : text };
    })
    .filter(message => message.content);
  let total = recent.reduce((sum, message) => sum + message.content.length, 0);
  while (recent.length > 1 && total > HISTORY_MAX_CHARS) total -= recent.shift().content.length;
  while (recent.length && recent[0].role !== 'user') recent.shift();
  // Claude pide que los roles alternen: dos seguidos del mismo rol se juntan.
  const merged = [];
  for (const message of recent) {
    const last = merged[merged.length - 1];
    if (last && last.role === message.role) last.content += `\n\n${message.content}`;
    else merged.push({ ...message });
  }
  return merged;
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
