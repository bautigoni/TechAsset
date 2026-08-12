import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type { TaskItem, TaskState } from '../types';
import { createTask, deleteTask, getTasks, updateTask } from '../services/tasksApi';
import { fetchShiftSettings } from '../services/operationsApi';
import { isOverdue } from '../utils/dates';

export function useTasks(operator: string) {
  const [items, setItems] = useState<TaskItem[]>([]);
  const [shifts, setShifts] = useState({ morningOperator: '', afternoonOperator: '' });

  // Misma guarda que en agenda: el hook pide al montar y App vuelve a pedir al
  // cambiar de sede, y salían dos GET /api/tasks (el más pesado de todos).
  const inFlight = useRef<Promise<void> | null>(null);
  const refresh = useCallback(async () => {
    if (inFlight.current) return inFlight.current;
    const promise = getTasks()
      .then(data => { setItems(data.items); })
      .finally(() => { inFlight.current = null; });
    inFlight.current = promise;
    return promise;
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

  // Un arrastre a la vez: con la respuesta inmediata es fácil encadenar dos
  // drops antes de que conteste el primero, y el segundo pisaría al primero.
  const moving = useRef(false);

  /**
   * Mueve la tarjeta en el mismo frame y recién después habla con el servidor.
   * Antes el tablero esperaba el PATCH + un GET de la lista entera (~6 s en dev)
   * sin mostrar nada, así que el gesto parecía no haber funcionado.
   * Si el PATCH falla se vuelve al estado anterior: la vista no puede mostrar
   * algo que el servidor nunca aceptó.
   */
  const move = async (id: string, estado: TaskState, columnId?: number | null) => {
    if (moving.current) return;
    const current = items.find(item => item.id === id);
    if (!current) return;
    const previousItems = items;
    moving.current = true;
    const patch = { estado, ...(columnId === undefined ? {} : { columnId }) };
    const updateLocal = () => flushSync(() => setItems(previous => previous.map(item => item.id === id ? { ...item, ...patch } : item)));
    const transition = (document as Document & { startViewTransition?: (callback: () => void) => void }).startViewTransition;
    if (transition) transition(updateLocal);
    else updateLocal();
    try {
      // El PATCH ya devuelve la tarea actualizada: se mergea en vez de volver a
      // pedir la lista completa.
      const data = await updateTask(id, { ...current, ...patch, operator });
      if (data?.item) setItems(previous => previous.map(item => item.id === id ? data.item : item));
    } catch (error) {
      setItems(previousItems);
      throw error;
    } finally {
      moving.current = false;
    }
  };

  const save = async (payload: Partial<TaskItem>) => {
    if (payload.id) {
      const data = await updateTask(payload.id, { ...payload, operator });
      if (data?.item) setItems(previous => previous.map(item => item.id === payload.id ? data.item : item));
      return data.item;
    }
    const data = await createTask({ ...payload, operator });
    // Una tarea nueva puede caer en cualquier orden: acá sí conviene releer.
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
