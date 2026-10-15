/**
 * Sede activa de ESTA pestaña.
 *
 * Antes cada request leía la sede de localStorage, que comparten todas las
 * pestañas: con NFPT en una y NFND en otra, la última en cambiar pisaba a la
 * otra y sus requests salían con la sede equivocada. Ahora vive en memoria (y en
 * sessionStorage, que es por pestaña, para sobrevivir a un F5). localStorage
 * queda solo como "última sede usada" para abrir pestañas nuevas.
 */
const KEY = 'techasset_active_site';
let current = '';

function read(storage: () => Storage) {
  try {
    return storage().getItem(KEY) || '';
  } catch {
    return '';
  }
}

export function getActiveSiteCode() {
  if (!current) current = read(() => sessionStorage) || read(() => localStorage) || 'NFPT';
  return current;
}

export function setActiveSiteCode(siteCode: string) {
  if (!siteCode) return;
  current = siteCode;
  try {
    sessionStorage.setItem(KEY, siteCode);
    localStorage.setItem(KEY, siteCode);
  } catch {
    // Sin storage (modo privado): la pestaña sigue funcionando con la sede en memoria.
  }
}
