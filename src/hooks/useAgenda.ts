import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AgendaItem } from '../types';
import { createAgenda, deleteAgenda, getAgenda, updateAgenda } from '../services/agendaApi';
import { confirmDialog } from '../components/layout/Feedback';

export function useAgenda(operator: string) {
  const [items, setItems] = useState<AgendaItem[]>([]);
  // Terminadas viejas que el server no mandó (ver GET /api/agenda). Al pedirlas
  // una vez, el auto-refresh sigue trayendo todo.
  const [olderHidden, setOlderHidden] = useState(0);
  const includeAll = useRef(false);

  // El hook refresca al montar y App vuelve a pedir al cambiar de sede: sin esta
  // guarda salían dos GET /api/agenda idénticos en cada arranque.
  const inFlight = useRef<Promise<void> | null>(null);
  const lastKey = useRef('');
  const refresh = useCallback(async () => {
    if (inFlight.current) return inFlight.current;
    // Se pollea (App, cada 30 s): si no cambió nada no hay re-render.
    const promise = getAgenda(includeAll.current)
      .then(data => {
        setOlderHidden(data.olderHidden || 0);
        const key = JSON.stringify(data.items);
        if (key === lastKey.current) return;
        lastKey.current = key;
        setItems(data.items);
      })
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

  // Borrar una actividad no pedía confirmación: un clic de más la perdía.
  const remove = async (id: string) => {
    const item = items.find(entry => entry.id === id);
    const label = item ? [item.curso, item.actividad].filter(Boolean).join(' · ') : '';
    if (!(await confirmDialog({ title: 'Borrar actividad', message: label || undefined, confirmLabel: 'Borrar', danger: true }))) return;
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
