import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AgendaItem } from '../types';
import { createAgenda, deleteAgenda, getAgenda, updateAgenda } from '../services/agendaApi';

export function useAgenda(operator: string) {
  const [items, setItems] = useState<AgendaItem[]>([]);

  const refresh = useCallback(async () => {
    const data = await getAgenda();
    setItems(data.items);
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
