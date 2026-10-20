import { useEffect, useState } from 'react';
import { fetchToolsConfig } from '../../services/toolsApi';
import { fetchQuickLinks } from '../../services/operationsApi';
import type { QuickLink } from '../../types';
import { errorMessage } from '../layout/Feedback';
import { pushStatus } from '../../ui/Status';

/** Aviso entre la página de Accesos rápidos y el rayo / Ctrl K del shell: algo cambió, recargá. */
export const QUICK_LINKS_CHANGED = 'techasset:quick-links-changed';

/**
 * Links de Accesos rápidos de la sede. `reloadKey` (la sede): al cambiar,
 * vuelve a pedirlos (antes el rayo de la barra mostraba los de la sede
 * anterior hasta recargar). También recarga cuando la página de Accesos avisa
 * que creó, editó, borró o reordenó uno. Separado de QuickAccess.tsx para que
 * la franja y Ctrl K no arrastren el formulario de alta.
 */
export function useQuickLinks(reloadKey = '') {
  const [links, setLinks] = useState<QuickLink[]>([]);
  const [handingUrl, setHandingUrl] = useState('');
  // El error va a la línea de estado de la cabecera (antes, un toast flotante), con Reintentar.
  const reload = (): Promise<void> => fetchQuickLinks()
    .then(r => { if (r.ok) setLinks(r.items); })
    .catch(reason => {
      // Sin red ya lo dice la línea "Sin conexión" de la cabecera.
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
      pushStatus({ tone: 'bad', message: errorMessage(reason, 'No se pudieron cargar los accesos rápidos.'), retry: { onRetry: reload } }); });
  useEffect(() => {
    void reload();
    fetchToolsConfig().then(c => setHandingUrl(c.handingTicketUrl || '')).catch(() => {});
    const onChanged = () => { void reload(); };
    window.addEventListener(QUICK_LINKS_CHANGED, onChanged);
    return () => window.removeEventListener(QUICK_LINKS_CHANGED, onChanged);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadKey]);
  return { links, handingUrl, reload };
}

/** Orden dentro de una categoría: el manual (Subir/Bajar) y después por título. */
export function compareLinks(a: QuickLink, b: QuickLink) {
  return (a.orden || 0) - (b.orden || 0) || (a.titulo || '').localeCompare(b.titulo || '', 'es');
}

// Agrupa por categoría para que la lista no sea un chorizo cuando crece.
export function groupLinks(links: QuickLink[]) {
  const map = new Map<string, QuickLink[]>();
  for (const link of links) {
    const key = String(link.categoria || '').trim() || 'Sin categoría';
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(link);
  }
  for (const rows of map.values()) rows.sort(compareLinks);
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], 'es'));
}
