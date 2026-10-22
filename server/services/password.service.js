import crypto from 'node:crypto';

// Hash de contraseñas con scrypt (incluido en Node, sin dependencias externas).
// Formato almacenado: scrypt$<saltHex>$<hashHex>
export function hashPassword(plain) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(plain), salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(plain, stored) {
  if (!stored || typeof stored !== 'string' || !stored.startsWith('scrypt$')) return false;
  const [, salt, hash] = stored.split('$');
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(String(plain), salt, 64).toString('hex');
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(test, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function hasPassword(stored) {
  return typeof stored === 'string' && stored.startsWith('scrypt$');
}

// ── Política para contraseñas NUEVAS (registro, link de contraseña, cambio) ──
// No invalida las que ya existen: solo se aplica al elegir una. Misma regla que
// src/utils/passwordPolicy.ts (si cambia una, cambiar la otra).
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 200;
const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'password123', 'passw0rd', 'contraseña', 'contrasena', 'contraseña1', 'contrasena1',
  'qwerty', 'qwerty123', 'qwertyuiop', 'asdfghjk', 'asdfghjkl', 'zxcvbnm1', 'iloveyou', 'abc12345', 'abcd1234',
  '12345678', '123456789', '1234567890', '0123456789', '87654321', '11111111', '00000000', '12341234', '11223344',
  'techasset', 'techasset1', 'techasset123', 'colegio', 'colegio1', 'colegio123', 'escuela1', 'escuela123',
  'admin123', 'administrador', 'bienvenido', 'bienvenido1', 'argentina', 'argentina1', 'futbol123', 'boca1234', 'river123'
]);
const SEQUENCES = ['0123456789', 'abcdefghijklmnopqrstuvwxyz', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm'];

function isSequence(value) {
  if (/^(.)\1+$/.test(value)) return true;
  return SEQUENCES.some(seq => seq.includes(value) || seq.split('').reverse().join('').includes(value));
}

/** '' si la contraseña nueva sirve; si no, el motivo para mostrar en el formulario. */
export function newPasswordProblem(plain, { email = '', nombre = '' } = {}) {
  const password = String(plain || '');
  if (password.length < PASSWORD_MIN) return `La contraseña tiene que tener al menos ${PASSWORD_MIN} caracteres.`;
  if (password.length > PASSWORD_MAX) return `La contraseña es demasiado larga (máximo ${PASSWORD_MAX} caracteres).`;
  const folded = password.toLowerCase().trim();
  const mail = String(email || '').toLowerCase().trim();
  const local = mail.split('@')[0];
  const name = String(nombre || '').toLowerCase().replace(/\s+/g, '');
  if ((mail && (folded === mail || folded === local)) || (name.length >= 4 && folded.replace(/\s+/g, '') === name)) {
    return 'La contraseña no puede ser tu mail ni tu nombre.';
  }
  if (COMMON_PASSWORDS.has(folded) || isSequence(folded)) {
    return 'Esa contraseña es muy fácil de adivinar (como 12345678 o password). Probá con una frase corta o mezclá palabras y números.';
  }
  return '';
}
