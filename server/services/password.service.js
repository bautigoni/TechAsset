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
