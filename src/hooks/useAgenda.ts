import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AgendaItem } from '../types';
import { createAgenda, deleteAgenda, getAgenda, updateAgenda } from '../services/agendaApi';

export function useAgenda(operator: string) {
  const [items, setItems] = useState<AgendaItem[]>([]);

  // El hook refresca al montar y App vuelve a pedir al cambiar de sede: sin esta
  // guarda salían dos GET /api/agenda idénticos en cada arranque.
  const inFlight = useRef<Promise<void> | null>(null);
  const refresh = useCallback(async () => {
    if (inFlight.current) return inFlight.current;
    const promise = getAgenda()
      .then(data => { setItems(data.items); })
      .finally(() => { inFlight.current = null; });
    inFlight.current = promise;
    return promise;
  }, []);

  useEffect(() => {
    refresh().catch(() => setItems([]));
  }, [refresh]);

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

  const remove = async (id: string) => {
    await deleteAgenda(id, operator);
    await refresh();
  };

  return { items, kpis, refresh, save, remove };
}
