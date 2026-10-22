// Topes de largo y limpieza de texto en TODAS las escrituras de la API.
//
// Antes se aceptaba cualquier largo: un mail de 5000 caracteres creaba una
// cuenta (y quemaba la invitación), una persona de 10 000 o una descripción de
// 20 000 se guardaban enteras. Y los controles invisibles de Unicode (los que
// cambian la dirección del texto o no ocupan lugar) dejaban fabricar un nombre
// que se lee distinto de lo guardado, incluido el operador del Historial
// ("El Destructor <U+202E>evil<U+202C>" se veía "El Destructor live").
//
// Un solo middleware (server/index.js) mira el cuerpo de cada POST/PUT/PATCH/
// DELETE de /api por el NOMBRE de cada campo (son los nombres reales de los
// routers) y:
//   - en nombres, títulos y demás campos de una línea saca los controles de
//     dirección y de ancho cero (U+200B–U+200F, U+202A–U+202E, U+2066–U+2069,
//     U+FEFF) y los saltos de línea;
//   - si un campo supera su tope responde 400 con el motivo en español (no
//     recorta en silencio: lo escrito no se pierde sin avisar).
// Lo que no está en la lista (CSV, imágenes en base64, HTML de artículos,
// contraseñas, tokens) no se toca: cada ruta tiene sus reglas.

// Controles de dirección y de ancho cero. Se arma con los códigos (en el fuente no puede haber ninguno de estos caracteres).
const RANGES = [[0x200b, 0x200f], [0x202a, 0x202e], [0x2066, 0x2069], [0xfeff, 0xfeff]];
const charClass = ranges => `[${ranges.map(([from, to]) => `${String.fromCodePoint(from)}-${String.fromCodePoint(to)}`).join('')}]`;
export const INVISIBLE_CONTROLS = new RegExp(charClass(RANGES), 'g');
const LINE_BREAKS = new RegExp(`[\\r\\n\\t${String.fromCodePoint(0x2028)}${String.fromCodePoint(0x2029)}]+`, 'g');

export const LIMITS = Object.freeze({
  email: 254,
  name: 120,
  title: 200,
  text: 10000
});

// Campos por tipo (nombres que usan los routers en el cuerpo).
const EMAIL_KEYS = ['email', 'ownerEmail', 'userEmail', 'assigneeEmails'];
const NAME_KEYS = [
  'nombre', 'name', 'person', 'persona', 'responsable', 'responsables', 'docente', 'teacher',
  'owner', 'ownerName', 'creadoPor', 'completedBy', 'supplier', 'morningOperator', 'afternoonOperator'
];
const TITLE_KEYS = [
  'titulo', 'title', 'subject', 'label', 'relatedLabel', 'subtitulo', 'actividad', 'motivo', 'reason',
  'location', 'locationDetail', 'ubicacion', 'curso', 'course', 'room', 'school', 'sector', 'piso',
  'categoria', 'subcategoria', 'category', 'aliasOperativo', 'marca', 'modelo', 'tipoDispositivo',
  'tags', 'rol', 'role', 'turno', 'code'
];
const TEXT_KEYS = [
  'descripcion', 'description', 'observaciones', 'comentario', 'comentarios', 'comment', 'nota', 'notas',
  'note', 'notes', 'texto', 'text', 'body', 'resumen', 'justification', 'reasonDetail', 'message'
];

const KIND = new Map([
  ...EMAIL_KEYS.map(key => [key, 'email']),
  ...NAME_KEYS.map(key => [key, 'name']),
  ...TITLE_KEYS.map(key => [key, 'title']),
  ...TEXT_KEYS.map(key => [key, 'text'])
]);

// Cuerpos que son datos de otro tipo: no se recorren (el asistente manda la
// pantalla abierta y su historial; Deshacer manda el estado anterior; push, su
// suscripción; Configuración avanzada, JSON de claves).
const SKIP_KEYS = new Set(['context', 'data', 'undo', 'previous', 'subscription', 'keys', 'settings', 'messages', 'payload', 'content', 'equipment_json']);

const LABELS = {
  email: 'El mail', ownerEmail: 'El mail', userEmail: 'El mail', assigneeEmails: 'Un mail',
  nombre: 'El nombre', name: 'El nombre', person: 'El nombre de la persona', persona: 'El nombre de la persona',
  responsable: 'El responsable', responsables: 'Un responsable', docente: 'El nombre del docente', teacher: 'El nombre del docente',
  titulo: 'El título', title: 'El título', subject: 'El asunto', motivo: 'El motivo', reason: 'El motivo',
  descripcion: 'La descripción', description: 'La descripción', observaciones: 'Las observaciones',
  comentario: 'El comentario', comentarios: 'El comentario', comment: 'El comentario',
  nota: 'La nota', notas: 'La nota', note: 'La nota', notes: 'La nota', texto: 'El texto', text: 'El texto', body: 'El texto',
  code: 'El código'
};
const KIND_LABEL = { email: 'El mail', name: 'Un nombre', title: 'Un campo', text: 'Un texto' };

export class InputLimitError extends Error {
  constructor(message, field) {
    super(message);
    this.status = 400;
    this.field = field;
  }
}

/** Saca los controles invisibles. En campos de una línea, también los saltos y tabs. */
export function stripInvisible(value, { singleLine = true } = {}) {
  let text = String(value ?? '').replace(INVISIBLE_CONTROLS, '');
  if (singleLine) text = text.replace(LINE_BREAKS, ' ');
  return text;
}

/** Formato de mail razonable: una @, algo antes y un dominio con punto, sin espacios ni controles. */
export function isValidEmail(value) {
  const email = String(value || '').trim();
  if (!email || email.length > LIMITS.email) return false;
  const at = email.indexOf('@');
  if (at < 1 || at !== email.lastIndexOf('@') || at > 64) return false;
  if (/[\s\u0000-\u001F\u007F<>(),;:"[\]\\]/.test(email)) return false;
  const domain = email.slice(at + 1);
  return /^[^.@]+(\.[^.@]+)+$/.test(domain);
}

function tooLong(key, kind, length) {
  const label = LABELS[key] || KIND_LABEL[kind];
  return new InputLimitError(`${label} supera el máximo de ${LIMITS[kind].toLocaleString('es-AR')} caracteres (tiene ${length.toLocaleString('es-AR')}). Acortalo y probá de nuevo.`, key);
}

function cleanString(key, kind, value, options) {
  if (kind === 'text') {
    if (value.length > LIMITS.text) throw tooLong(key, kind, value.length);
    return value;
  }
  const cleaned = stripInvisible(value);
  if (cleaned.length > LIMITS[kind]) throw tooLong(key, kind, cleaned.length);
  if (kind === 'email' && options.checkEmailFormat && cleaned.trim() && !isValidEmail(cleaned)) {
    throw new InputLimitError(key === 'assigneeEmails' ? 'Uno de los mails no es válido.' : 'Ese mail no es válido. Revisalo (tiene que ser como nombre@colegio.edu.ar).', key);
  }
  return cleaned;
}

function walk(node, depth, options) {
  if (!node || typeof node !== 'object' || depth > 4) return;
  const entries = Array.isArray(node) ? node.map((value, index) => [index, value]) : Object.entries(node);
  for (const [key, value] of entries) {
    if (typeof key === 'string' && SKIP_KEYS.has(key)) continue;
    const kind = typeof key === 'string' ? KIND.get(key) : undefined;
    if (kind && typeof value === 'string') {
      node[key] = cleanString(key, kind, value, options);
    } else if (kind && Array.isArray(value)) {
      value.forEach((item, index) => { if (typeof item === 'string') value[index] = cleanString(key, kind, item, options); });
      walk(value, depth + 1, options);
    } else if (value && typeof value === 'object') {
      walk(value, depth + 1, options);
    }
  }
}

/**
 * Limpia y valida un cuerpo en el lugar. Tira InputLimitError (status 400) con
 * el mensaje para el usuario si algo se pasa del tope o un mail no es válido.
 */
export function sanitizeBody(body, { checkEmailFormat = true } = {}) {
  if (body && typeof body === 'object') walk(body, 0, { checkEmailFormat });
  return body;
}

// Ingresar y "olvidé mi contraseña" no validan el formato: una cuenta vieja con
// un mail raro (sin punto en el dominio) tiene que poder seguir entrando, y la
// respuesta tiene que ser la de siempre ("Mail o contraseña incorrectos").
const NO_EMAIL_FORMAT = /^\/auth\/(login|password\/request)$/;

/** Middleware para /api: escrituras con cuerpo JSON. */
export function inputLimitsMiddleware(req, res, next) {
  const method = String(req.method || 'GET').toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return next();
  try {
    sanitizeBody(req.body, { checkEmailFormat: !NO_EMAIL_FORMAT.test(req.path) });
    return next();
  } catch (error) {
    if (error instanceof InputLimitError) return res.status(400).json({ ok: false, error: error.message, field: error.field });
    return next(error);
  }
}
