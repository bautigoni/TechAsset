import { useCallback, useEffect, useMemo, useState } from 'react';
import { flushSync } from 'react-dom';
import type { TaskItem, TaskState } from '../types';
import { createTask, deleteTask, getTasks, updateTask } from '../services/tasksApi';
import { isOverdue } from '../utils/dates';

export function useTasks(operator: string) {
  const [items, setItems] = useState<TaskItem[]>([]);

  const refresh = useCallback(async () => {
    const data = await getTasks();
    setItems(data.items);
  }, []);

  useEffect(() => {
    refresh().catch(() => setItems([]));
  }, [refresh]);

  const kpis = useMemo<Record<string, number>>(() => ({
    total: items.length,
    pending: items.filter(item => item.estado === 'Pendiente').length,
    progress: items.filter(item => item.estado === 'En proceso').length,
    done: items.filter(item => item.estado === 'Hecha').length,
    overdue: items.filter(item => item.estado !== 'Hecha' && isOverdue(item.fechaVencimiento)).length,
    bauti: items.filter(item => item.responsable === 'Bauti' || item.responsable === 'Ambos').length,
    equi: items.filter(item => item.responsable === 'Equi' || item.responsable === 'Ambos').length,
    mine: items.filter(item => item.responsable === operator || item.responsable === 'Ambos').length
  }), [items, operator]);

  const move = async (id: string, estado: TaskState) => {
    const current = items.find(item => item.id === id);
    if (!current) return;
    const updateLocal = () => flushSync(() => setItems(previous => previous.map(item => item.id === id ? { ...item, estado } : item)));
    const transition = (document as Document & { startViewTransition?: (callback: () => void) => void }).startViewTransition;
    if (transition) transition(updateLocal);
    else updateLocal();
    await updateTask(id, { ...current, estado, operator });
    await refresh();
  };

  const save = async (payload: Partial<TaskItem>) => {
    const data = payload.id
      ? await updateTask(payload.id, { ...payload, operator })
      : await createTask({ ...payload, operator });
    await refresh();
    return data.item;
  };

  const remove = async (id: string) => {
    await deleteTask(id, operator);
    await refresh();
  };

  return { items, kpis, refresh, move, save, remove };
}
