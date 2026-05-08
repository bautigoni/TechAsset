import { useCallback, useEffect, useMemo, useState } from 'react';
import { flushSync } from 'react-dom';
import type { TaskItem, TaskState } from '../types';
import { createTask, deleteTask, getTasks, updateTask } from '../services/tasksApi';
import { fetchShiftSettings } from '../services/operationsApi';
import { isOverdue } from '../utils/dates';

export function useTasks(operator: string) {
  const [items, setItems] = useState<TaskItem[]>([]);
  const [shifts, setShifts] = useState({ morningOperator: '', afternoonOperator: '' });

  const refresh = useCallback(async () => {
    const data = await getTasks();
    setItems(data.items);
  }, []);

  useEffect(() => {
    refresh().catch(() => setItems([]));
    fetchShiftSettings().then(r => r.ok && setShifts(r.settings)).catch(() => {});
  }, [refresh]);

  const kpis = useMemo<Record<string, number>>(() => ({
    total: items.length,
    pending: items.filter(item => item.estado === 'Pendiente').length,
    progress: items.filter(item => item.estado === 'En proceso').length,
    done: items.filter(item => item.estado === 'Hecha').length,
    overdue: items.filter(item => item.estado !== 'Hecha' && isOverdue(item.fechaVencimiento)).length,
    mine: items.filter(item => isAssignedTo(item, operator) && isOwnShift(item, operator, shifts)).length
  }), [items, operator, shifts]);

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

function isAssignedTo(item: TaskItem, operator: string) {
  if (item.responsables?.includes(operator)) return true;
  return String(item.responsable || '').split(',').map(v => v.trim()).includes(operator) || item.responsable === 'Ambos';
}

function isOwnShift(item: TaskItem, operator: string, shifts: { morningOperator: string; afternoonOperator: string }) {
  const shift = item.turno || 'Sin turno';
  if (shift === 'Todo el día' || shift === 'Sin turno') return true;
  if (operator === shifts.morningOperator) return shift === 'Mañana';
  if (operator === shifts.afternoonOperator) return shift === 'Tarde';
  return true;
}
