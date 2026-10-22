/**
 * Política para contraseñas NUEVAS (registro, "Elegí tu contraseña", cambiar
 * contraseña). Misma regla que newPasswordProblem en
 * server/services/password.service.js (si cambia una, cambiar la otra): el
 * formulario avisa en línea antes de mandar y el server igual la exige.
 * No invalida contraseñas existentes.
 */
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 200;
export const PASSWORD_HINT = `Mínimo ${PASSWORD_MIN} caracteres y que no sea fácil de adivinar.`;

const COMMON = new Set([
  'password', 'password1', 'password123', 'passw0rd', 'contraseña', 'contrasena', 'contraseña1', 'contrasena1',
  'qwerty', 'qwerty123', 'qwertyuiop', 'asdfghjk', 'asdfghjkl', 'zxcvbnm1', 'iloveyou', 'abc12345', 'abcd1234',
  '12345678', '123456789', '1234567890', '0123456789', '87654321', '11111111', '00000000', '12341234', '11223344',
  'techasset', 'techasset1', 'techasset123', 'colegio', 'colegio1', 'colegio123', 'escuela1', 'escuela123',
  'admin123', 'administrador', 'bienvenido', 'bienvenido1', 'argentina', 'argentina1', 'futbol123', 'boca1234', 'river123'
]);
const SEQUENCES = ['0123456789', 'abcdefghijklmnopqrstuvwxyz', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm'];

function isSequence(value: string) {
  if (/^(.)\1+$/.test(value)) return true;
  return SEQUENCES.some(seq => seq.includes(value) || seq.split('').reverse().join('').includes(value));
}

/** '' si sirve; si no, el motivo para mostrar debajo del campo. */
export function newPasswordProblem(plain: string, { email = '', nombre = '' }: { email?: string; nombre?: string } = {}): string {
  const password = String(plain || '');
  if (password.length < PASSWORD_MIN) return `Tiene que tener al menos ${PASSWORD_MIN} caracteres.`;
  if (password.length > PASSWORD_MAX) return `Es demasiado larga (máximo ${PASSWORD_MAX} caracteres).`;
  const folded = password.toLowerCase().trim();
  const mail = email.toLowerCase().trim();
  const local = mail.split('@')[0];
  const name = nombre.toLowerCase().replace(/\s+/g, '');
  if ((mail && (folded === mail || folded === local)) || (name.length >= 4 && folded.replace(/\s+/g, '') === name)) {
    return 'No puede ser tu mail ni tu nombre.';
  }
  if (COMMON.has(folded) || isSequence(folded)) {
    return 'Es muy fácil de adivinar (como 12345678 o password). Probá con una frase corta o mezclá palabras y números.';
  }
  return '';
}
