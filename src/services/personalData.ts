import { clearApiCache } from './apiClient';
import { clearDrafts } from '../utils/drafts';
import { OPERATOR_KEY } from '../hooks/useOperator';

/*
 * Lo que este navegador guarda de la PERSONA (revisado clave por clave):
 *   localStorage
 *     techasset_operator          su nombre (firma de préstamos)       → se borra
 *     techasset_session_cache     nombre, mail y sedes (arranque)      → se borra (App)
 *     techasset:kb-draft:<sede>   borrador de un artículo a medias     → se borra
 *   sessionStorage
 *     techasset:kb-draft:<sede>   ídem                                 → se borra
 *     techasset:hr-draft:<sede>:* borradores de horarios y recreos     → se borra
 *     techasset:canvas-view:<sede> zoom y posición del canvas          → se borra
 *   memoria
 *     borradores de formularios (utils/drafts) y caché de lecturas      → se vacían
 * Lo que NO es de la persona queda: tema, densidad y tamaño de texto (también
 * se ven en la landing), menú colapsado, paneles abiertos de Préstamos, la
 * última novedad vista, "Instalar más tarde" y la sede de la pestaña.
 */
const PERSONAL_PREFIXES = ['techasset:kb-draft:', 'techasset:hr-draft:', 'techasset:canvas-view:'];

function sweep(storage: Storage | undefined) {
  if (!storage) return;
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key && (key === OPERATOR_KEY || PERSONAL_PREFIXES.some(prefix => key.startsWith(prefix)))) keys.push(key);
  }
  keys.forEach(key => storage.removeItem(key));
}

export function clearPersonalData() {
  try { sweep(window.localStorage); } catch { /* sin storage */ }
  try { sweep(window.sessionStorage); } catch { /* sin storage */ }
  clearDrafts();
  clearApiCache();
}
