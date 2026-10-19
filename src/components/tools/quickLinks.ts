import { useEffect, useState } from 'react';
import { fetchToolsConfig } from '../../services/toolsApi';
import { fetchQuickLinks } from '../../services/operationsApi';
import type { QuickLink } from '../../types';
import { errorMessage, toast } from '../layout/Feedback';

/**
 * Links de Accesos rápidos de la sede. `reloadKey` (la sede): al cambiar,
 * vuelve a pedirlos (antes el rayo de la barra mostraba los de la sede
 * anterior hasta recargar). Separado de QuickAccess.tsx para que la franja y
 * Ctrl K no arrastren el formulario de alta.
 */
export function useQuickLinks(reloadKey = '') {
  const [links, setLinks] = useState<QuickLink[]>([]);
  const [handingUrl, setHandingUrl] = useState('');
  const reload = () => fetchQuickLinks().then(r => { if (r.ok) setLinks(r.items); }).catch(reason => toast({ message: errorMessage(reason, 'No se pudo cargar los accesos rápidos.'), tone: 'error' }));
  useEffect(() => {
    void reload();
    fetchToolsConfig().then(c => setHandingUrl(c.handingTicketUrl || '')).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadKey]);
  return { links, handingUrl, reload };
}

// Agrupa por categoría para que la lista no sea un chorizo cuando crece.
export function groupLinks(links: QuickLink[]) {
  const map = new Map<string, QuickLink[]>();
  for (const link of links) {
    const key = String(link.categoria || '').trim() || 'Sin categoría';
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(link);
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], 'es'));
}
