import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AgendaItem } from '../types';
import { createAgenda, deleteAgenda, getAgenda, updateAgenda } from '../services/agendaApi';
import { getActiveSiteCode } from '../services/activeSite';

/** `enabled`: sin sesión no pide nada (la landing no se come un 401). */
export function useAgenda(operator: string, enabled = true) {
  const [items, setItems] = useState<AgendaItem[]>([]);
  // Terminadas viejas que el server no mandó (ver GET /api/agenda). Al pedirlas
  // una vez, el auto-refresh sigue trayendo todo.
  const [olderHidden, setOlderHidden] = useState(0);
  const includeAll = useRef(false);

  // El hook refresca al montar y App vuelve a pedir al cambiar de sede: sin esta
  // guarda salían dos GET /api/agenda idénticos en cada arranque.
  // La guarda es por sede: si al cambiar de sede había un poll en vuelo de la
  // sede anterior, devolver esa promesa dejaba la agenda de la otra sede hasta
  // el próximo poll (~30 s). Y una respuesta que llega con otra sede activa se
  // descarta.
  const inFlight = useRef<{ site: string; promise: Promise<void> } | null>(null);
  const lastKey = useRef('');
  const lastSite = useRef('');
  const loaded = useRef<{ site: string; at: number } | null>(null);
  /** `maxAgeMs`: si ya hay datos de esta sede más nuevos que eso, no pide de nuevo. */
  const refresh = useCallback(async (options?: { maxAgeMs?: number }) => {
    const site = getActiveSiteCode();
    // "Ver anteriores" es de la sede donde se pidió: al cambiar de sede se vuelve
    // a traer solo lo reciente.
    if (lastSite.current && lastSite.current !== site) includeAll.current = false;
    lastSite.current = site;
    if (inFlight.current && inFlight.current.site === site) return inFlight.current.promise;
    const maxAge = Number(options?.maxAgeMs) || 0;
    if (maxAge && loaded.current?.site === site && Date.now() - loaded.current.at < maxAge) return;
    // Se pollea (App, cada 30 s): si no cambió nada no hay re-render.
    const promise: Promise<void> = getAgenda(includeAll.current)
      .then(data => {
        if (getActiveSiteCode() !== site) return;
        loaded.current = { site, at: Date.now() };
        setOlderHidden(data.olderHidden || 0);
        const key = `${site}|${JSON.stringify(data.items)}`;
        if (key === lastKey.current) return;
        lastKey.current = key;
        setItems(data.items);
      })
      .finally(() => { if (inFlight.current?.promise === promise) inFlight.current = null; });
    inFlight.current = { site, promise };
    return promise;
  }, []);

  useEffect(() => {
    if (!enabled) return;
    refresh().catch(() => setItems([]));
  }, [refresh, enabled]);

  const kpis = useMemo<Record<string, number>>(() => ({
    total: items.length,
    pending: items.filter(item => item.estado === 'Pendiente').length,
    retiradas: items.reduce((sum, item) => sum + Number(item.compusRetiradas || 0), 0),
    entregadas: items.filter(item => item.estado === 'Entregado').length,
    realizadas: items.filter(item => item.estado === 'Realizado').length,
    vencidas: items.filter(item => item.estado === 'Pendiente').length,
    touch: items.filter(item => /touch/i.test(item.tipoDispositivo)).reduce((sum, item) => sum + Number(item.cantidad || 0), 0),
    plani: items.filter(item => /plani/i.test(item.tipoDispositivo)).reduce((sum, item) => sum + Number(item.cantidad || 0), 0),
    tic: items.filter(item => /tic/i.test(item.tipoDispositivo)).reduce((sum, item) => sum + Number(item.cantidad || 0), 0)
  }), [items]);

  const save = async (payload: Partial<AgendaItem>) => {
    const data = payload.id
      ? await updateAgenda(payload.id, { ...payload, operator })
      : await createAgenda({ ...payload, operator });
    await refresh();
    return data.item;
  };

  // La confirmación ("¿Borrar …?") va en línea en la pantalla (AgendaRow), que
  // además ofrece Deshacer: acá solo se borra.
  const remove = async (id: string) => {
    await deleteAgenda(id, operator);
    await refresh();
  };

  const loadOlder = useCallback(async () => {
    includeAll.current = true;
    lastKey.current = '';
    await refresh();
  }, [refresh]);

  return { items, kpis, refresh, save, remove, olderHidden, loadOlder };
}
