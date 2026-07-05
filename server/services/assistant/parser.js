import { normalize } from './utils.js';

export function extractDevice(text) {
  const raw = String(text || '').match(/\bD\s*0*\d{1,5}\b/i)?.[0]?.replace(/\s+/g, '');
  return raw ? raw.toUpperCase().replace(/^D0*/, 'D') : '';
}

export function extractPerson(text) {
  // Busca "a NOMBRE" después del dispositivo o al inicio, frenando en del/de la/en/por/para/coma
  const value = String(text || '').match(/\ba\s+(.+?)(?:\s+del\b|\s+de la\b|\s+en\b|\s+en:|\s+por\b|\s+para\b|\s+va\s+a\s+estar\b|,|$)/i)?.[1]?.trim();
  if (!value) return '';
  const cleaned = value.replace(/\bD\s*\d{1,5}\b/gi, '').trim();
  if (!cleaned || /^(si|no|ok|dale)$/i.test(cleaned)) return '';
  // Si el nombre capturado es muy largo, probablemente capturó demás
  if (cleaned.split(/\s+/).length > 5) return cleaned.split(/\s+/).slice(0, 3).join(' ');
  return cleaned;
}

export function extractRole(text) {
  const lower = normalize(text);
  if (/\b(alumno|alumnos|estudiante)\b/.test(lower)) return 'Alumno';
  if (/\b(profesor|profesora|docente|maestra|maestro|profe)\b/.test(lower)) return 'Docente';
  if (/\b(directivo|director|directora)\b/.test(lower)) return 'Directivo';
  if (/\b(preceptor|preceptora)\b/.test(lower)) return 'Preceptor';
  if (/\bdoe\b/.test(lower)) return 'DOE';
  const custom = String(text || '').match(/\b(?:rol|como|del area|del|de la)\s+(.+?)(?:\s+en\b|\s+por\b|\s+para\b|,|$)/i)?.[1]?.trim();
  return custom || '';
}

export function extractLocation(text) {
  const t = String(text || '');

  // "en: DOE", "EN: DOE", "va a estar en DOE"
  const explicit = t.match(/(?:va\s+a\s+estar\s+)?en\s*:?\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9\s]{0,30}?)(?:\s+por\b|\s+para\b|\s+va\b|\s+y\b|,|\.|$)/i);
  if (explicit) {
    const loc = explicit[1].trim();
    if (loc.length <= 35 && loc.length >= 1) return loc;
  }

  // "del DOE", "de DOE" (ubicación como organización)
  const deMatch = t.match(/\bdel?\s+([A-Za-zÀ-ÿ]{2,20})(?:\s+por\b|\s+para\b|\s+va\b|,|\.|$)/i);
  if (deMatch) return deMatch[1].trim();

  return '';
}

export function extractMotive(text) {
  const t = String(text || '');

  // "motivo: X" o "motivo X"
  const motivoKw = t.match(/\b(?:motivo|razon)\s*:?\s+(.+?)(?:,|\.|$)/i);
  if (motivoKw) return motivoKw[1].trim();

  // "para PLANIFICACION", "para CLASE", "para TRABAJO", etc.
  const paraMatch = t.match(/\bpara\s+(.+?)(?:,|\.|$)/i);
  if (paraMatch) {
    const motive = paraMatch[1].trim();
    // Filtrar frases vacías o genéricas
    if (/^(que|estar|ser|ir|poder|hacer|usar|agendar)\b/i.test(motive)) return '';
    return motive;
  }

  return '';
}

export function extractComment(text) {
  return String(text || '').match(/\b(?:comentario|nota|obs)\s*:\s*(.+)$/i)?.[1]?.trim() || '';
}

// detecta "touch 34", "plani 5", "nuc 2" como alias operacional en el texto
export function extractOperationalAlias(text) {
  const t = String(text || '');
  const match = t.match(/\b(Touch|Plani|NUC|Notebook|PC|Tablet|Monitor|Impresora|Proyector|Chromebook|iPad|Mac)\s+(\d{1,3})\b/i);
  if (match) return `${match[1]} ${match[2]}`;
  return '';
}

// Parsea texto completo de préstamo: "prestale a mili touch 30 para clase en DOE"
export function parseLoanText(text, previous = {}) {
  const device = extractDevice(text) || previous.codigo_dispositivo || '';
  const alias = !device ? extractOperationalAlias(text) || previous.aliasOperativo || '' : '';
  const person = extractPerson(text) || previous.usuario_nombre || '';
  const role = extractRole(text) || previous.rol || '';
  const location = extractLocation(text) || previous.ubicacion || '';
  const motive = extractMotive(text) || previous.motivo || '';
  const comment = extractComment(text) || previous.comentario || '';

  // Si no se encontró persona con "a NOMBRE", intentar al inicio del texto
  // "mili prestale touch 30" o "mili touch 30"
  const resolvedPerson = person || tryExtractPersonFromStart(text) || '';

  const parsed = {
    codigo_dispositivo: device,
    aliasOperativo: alias,
    usuario_nombre: resolvedPerson,
    rol: role || previous.rol || '',
    ubicacion: location || previous.ubicacion || '',
    motivo: motive || previous.motivo || '',
    comentario: comment || previous.comentario || ''
  };

  return parsed;
}

function tryExtractPersonFromStart(text) {
  const cleaned = String(text || '').replace(/^(prestale|prestar|prestame|prestale a|quiero prestar|necesito prestar)\s+/i, '').trim();
  // Solo los primeros 1-2 tokens
  const tokens = cleaned.match(/^([A-Za-zÀ-ÿ]+(?:\s+[A-Za-zÀ-ÿ]+)?)/);
  if (!tokens) return '';
  const candidate = tokens[1].trim();
  if (!candidate || candidate.length < 2) return '';
  // Excluir words vacías, roles, dispositivos
  const exclude = /^(el|la|los|las|un|una|qsy|no|si|ya|en|del|para|por|como|con|doe|docente|alumno|preceptor|touch|plani|nuc|que|es|se|le|me|te|lo)$/i;
  const parts = candidate.split(/\s+/);
  for (const p of parts) {
    if (exclude.test(p) || /\d/.test(p)) return '';
  }
  return candidate;
}

export function parseReturnText(text, previous = {}) {
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

export function parseTaskText(text, previous = {}) {
  const title = text.replace(/^(crea|crear|creame|nueva|dejame pendiente)?\s*(una\s*)?tarea\s*(para)?\s*/i, '').trim() || previous.titulo || text || 'Tarea TIC';
  return {
    titulo: title,
    descripcion: text || previous.descripcion || '',
    prioridad: /urgente/i.test(text) ? 'Urgente' : /alta/i.test(text) ? 'Alta' : /baja/i.test(text) ? 'Baja' : previous.prioridad || 'Media',
    responsable: previous.responsable || 'Sin asignar',
    estado: 'Pendiente'
  };
}

export function parseAgendaText(text, previous = {}) {
  const time = text.match(/\b(\d{1,2})(?::(\d{2}))?\b/);
  return {
    dia: extractDay(text) || parseRelativeDate(text).dia || previous.dia || '',
    fecha: parseRelativeDate(text).fecha || previous.fecha || '',
    turno: previous.turno || 'Mañana',
    desde: time ? `${time[1].padStart(2, '0')}:${time[2] || '00'}` : previous.desde || '',
    hasta: previous.hasta || '',
    curso: previous.curso || '',
    actividad: text.replace(/^(agend(a|ar|ame)|pone|poner)\s*/i, '').trim() || previous.actividad || 'Actividad TIC',
    tipoDispositivo: /tic/i.test(text) ? 'TIC' : previous.tipoDispositivo || 'Touch',
    cantidad: Number(text.match(/\b(\d{1,2})\s*(touch|tic|compus|notebooks)?/i)?.[1] || previous.cantidad || 1),
    ubicacion: extractLocation(text) || previous.ubicacion || 'Aula'
  };
}

// Actualiza datos con corrección del usuario
export function updateDataWithCorrection(current, text, flow, waitingFor) {
  const updated = { ...current };
  const device = extractDevice(text);
  if (device) updated.codigo_dispositivo = device;
  const alias = extractOperationalAlias(text);
  if (alias) updated.aliasOperativo = alias;

  if (flow === 'loan_flow') {
    // Correcciones específicas por campo
    const ubicMatch = text.match(/(?:ubicacion|ubicación|lugar|esta en|está en)\s*(?:es|:)?\s*(.+?)(?:,|\.|$)/i);
    if (ubicMatch) updated.ubicacion = ubicMatch[1].trim();

    const motivoMatch = text.match(/(?:motivo|razon|razón)\s*(?:es|:)?\s*(.+?)(?:,|\.|$)/i);
    if (motivoMatch) updated.motivo = motivoMatch[1].trim();

    const personaMatch = text.match(/(?:persona|usuario|a quien|a quién)\s*(?:es|:)?\s*(.+?)(?:,|\.|$)/i);
    if (personaMatch) updated.usuario_nombre = personaMatch[1].trim();

    const rolMatch = text.match(/(?:rol|como)\s*(?:es|:)?\s*(.+?)(?:,|\.|$)/i);
    if (rolMatch) updated.rol = rolMatch[1].trim();

    // Fallback: si hay texto corto y estamos esperando un campo específico
    if (waitingFor && !device && !alias && isShortFreeText(text)) {
      updated[waitingFor] = cleanFreeText(text);
    }
  }

  if (flow === 'return_flow') Object.assign(updated, parseReturnText(text, updated));
  if (flow === 'agenda_flow') Object.assign(updated, parseAgendaText(text, updated));
  if (flow === 'task_flow') Object.assign(updated, parseTaskText(text, updated));

  return updated;
}

export function loanMissing(payload) {
  const required = ['codigo_dispositivo', 'usuario_nombre', 'rol', 'ubicacion'];
  return required.filter(key => !String(payload[key] || '').trim());
}

export function loanKnownSummary(payload) {
  const parts = [];
  if (payload.codigo_dispositivo) parts.push(`dispositivo ${payload.codigo_dispositivo}`);
  if (payload.usuario_nombre) parts.push(`persona ${payload.usuario_nombre}`);
  if (payload.ubicacion) parts.push(`ubicación ${payload.ubicacion}`);
  return parts.join(', ') || 'el borrador iniciado';
}

export function label(key) {
  return {
    codigo_dispositivo: 'código del equipo',
    aliasOperativo: 'alias del equipo',
    usuario_nombre: 'persona',
    rol: 'rol',
    ubicacion: 'ubicación',
    motivo: 'motivo',
    dia: 'día',
    hora: 'hora'
  }[key] || key;
}

export function looksLikeCorrection(text) {
  // Requiere señal explícita de corrección, no solo un device code
  if (/^(no,?\s*)?(era|es|mejor|quise decir|en realidad|corrijo|corregir|cambia|cambio)\b/i.test(text)) return true;
  // "en ubicacion X", "motivo X", "persona X"
  if (/\b(ubicacion|motivo|persona|rol)\s*(es|:)\s*\w/i.test(text)) return true;
  // Sólo device code sin más contexto NO es corrección (evita "perdon la d1432")
  return false;
}

export function isShortFreeText(text) {
  return cleanFreeText(text).split(/\s+/).length <= 10;
}

export function cleanFreeText(text) {
  return String(text || '').replace(/^no,?\s*/i, '').trim();
}

// Re-export para compatibilidad
import { extractDay, parseRelativeDate } from './utils.js';
