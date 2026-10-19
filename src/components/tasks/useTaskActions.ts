import { useCallback, useRef, useState } from 'react';
import type { TaskChecklistItem, TaskColumn, TaskItem, TaskState } from '../../types';
import type { TasksStore } from '../../hooks/useTasks';
import { createTask, createTaskItem, deleteTask, deleteTaskItem, restoreTask, updateTask, updateTaskItem } from '../../services/tasksApi';

/** Resultado de mover: `busy` = había otro movimiento en vuelo (se mueve de a uno). */
export type MoveResult = 'ok' | 'same' | 'busy';

/** Lo que hace falta para deshacer un movimiento: dónde estaba cada tarea. */
export type MovedTask = { id: string; estado: TaskState; columnId: number | null };

/**
 * Escrituras de Tareas, optimistas y con vuelta atrás. Viven en el chunk de la
 * pantalla (no en el de entrada): `useTasks` solo trae la lista y el poll.
 */
export function useTaskActions(store: TasksStore) {
  const { setItems, itemsRef, track, patchLocal, refresh, operator } = store;
  const [moving, setMoving] = useState(false);

  // Un arrastre a la vez: con la respuesta inmediata es fácil encadenar dos
  // drops antes de que conteste el primero, y el segundo pisaría al primero.
  const movingRef = useRef(false);

  /**
   * Mueve en el mismo frame y recién después habla con el servidor (de a una
   * tarea por PATCH, en serie). Si un PATCH falla, esa tarea y las que faltaban
   * vuelven a donde estaban y se tira el error con `failed` (para Reintentar).
   * Devuelve dónde estaba cada una de las que sí se movieron (para Deshacer).
   */
  const moveMany = useCallback(async (ids: string[], column: Pick<TaskColumn, 'id' | 'name'>): Promise<{ result: MoveResult; moved: MovedTask[] }> => {
    if (movingRef.current) return { result: 'busy', moved: [] };
    const targets = itemsRef.current.filter(item => ids.includes(item.id) && item.columnId !== column.id);
    if (!targets.length) return { result: 'same', moved: [] };
    const previous = new Map<string, MovedTask>(targets.map(item => [item.id, { id: item.id, estado: item.estado, columnId: item.columnId ?? null }]));
    movingRef.current = true;
    setMoving(true);
    const patch = { estado: column.name, columnId: column.id };
    // Actualización optimista, sin adornos (un setState en un handler ya pinta
    // antes del próximo frame; nada de view transitions).
    setItems(current => current.map(item => (previous.has(item.id) ? { ...item, ...patch } : item)));
    const moved: MovedTask[] = [];
    try {
      await track(async () => {
        for (const task of targets) {
          try {
            // El PATCH devuelve la tarea actualizada: se mergea, no se relee la lista.
            const data = await updateTask(task.id, { ...task, ...patch, operator });
            moved.push(previous.get(task.id)!);
            if (data?.item) setItems(current => current.map(item => (item.id === task.id ? data.item : item)));
          } catch (error) {
            const back = targets.filter(item => !moved.some(done => done.id === item.id));
            setItems(current => current.map(item => {
              const before = back.find(entry => entry.id === item.id) && previous.get(item.id);
              return before ? { ...item, estado: before.estado, columnId: before.columnId } : item;
            }));
            throw Object.assign(error instanceof Error ? error : new Error('No se pudo mover la tarea.'), { moved, failed: back.map(item => item.id) });
          }
        }
      });
    } finally {
      movingRef.current = false;
      setMoving(false);
    }
    return { result: 'ok', moved };
  }, [operator, track]);

  /** Una sola tarea a una columna (la firma de siempre: estado = nombre de la columna). */
  const move = useCallback((id: string, estado: TaskState, columnId: number) => moveMany([id], { id: columnId, name: estado }).then(r => r.result), [moveMany]);

  /** Vuelve cada tarea a donde estaba (Deshacer de un movimiento). */
  const moveBack = useCallback(async (moved: MovedTask[]) => {
    for (const entry of moved) {
      if (entry.columnId == null) continue;
      // eslint-disable-next-line no-await-in-loop
      await moveMany([entry.id], { id: entry.columnId, name: entry.estado });
    }
  }, [moveMany]);

  const save = useCallback(async (payload: Partial<TaskItem>) => {
    if (payload.id) {
      const data = await track(() => updateTask(payload.id!, { ...payload, operator }));
      if (data?.item) setItems(previous => previous.map(item => item.id === payload.id ? data.item : item));
      return data.item;
    }
    const data = await track(() => createTask({ ...payload, operator }));
    // Una tarea nueva puede caer en cualquier orden: acá sí conviene releer.
    if (data?.item) setItems(previous => [data.item, ...previous.filter(item => item.id !== data.item.id)]);
    void refresh().catch(() => undefined);
    return data.item;
  }, [operator, refresh, track]);

  /**
   * Borra (blando) sin preguntar: la confirmación es en línea en la pantalla y
   * el Deshacer usa `restore`. Optimista: sale de la lista en el acto y vuelve
   * si el server dice que no. Devuelve las que no se pudieron borrar.
   */
  const removeMany = useCallback(async (ids: string[]) => {
    const gone = itemsRef.current.filter(item => ids.includes(item.id));
    if (!gone.length) return { removed: [] as TaskItem[], failed: [] as TaskItem[] };
    setItems(current => current.filter(item => !ids.includes(item.id)));
    const removed: TaskItem[] = [];
    const failed: TaskItem[] = [];
    await track(async () => {
      for (const task of gone) {
        try { await deleteTask(task.id, operator); removed.push(task); } catch { failed.push(task); }
      }
    });
    if (failed.length) setItems(current => [...failed.filter(task => !current.some(item => item.id === task.id)), ...current]);
    return { removed, failed };
  }, [operator, track]);

  const remove = useCallback(async (id: string) => {
    const { failed } = await removeMany([id]);
    if (failed.length) throw new Error(`No se pudo borrar «${failed[0].titulo}».`);
  }, [removeMany]);

  /** Deshacer de un borrado: vuelve a prender las tareas en el server y en la lista. */
  const restore = useCallback(async (tasks: TaskItem[]) => {
    const back: TaskItem[] = [];
    await track(async () => {
      for (const task of tasks) {
        const data = await restoreTask(task.id, operator);
        back.push(data.item || task);
      }
    });
    setItems(current => [...back.filter(task => !current.some(item => item.id === task.id)), ...current]);
  }, [operator, track]);

  /* ── Subtareas: al instante, con vuelta atrás si el server dice que no ── */

  const withItems = (task: TaskItem, list: TaskChecklistItem[]): TaskItem => ({
    ...task,
    items: list,
    checklistTotal: list.length,
    checklistDone: list.filter(item => item.completada).length
  });

  const toggleItem = useCallback(async (taskId: string, itemId: number, completada: boolean) => {
    const flip = (value: boolean) => patchLocal(taskId, task => withItems(task, (task.items || []).map(item => (item.id === itemId ? { ...item, completada: value } : item))));
    flip(completada);
    try {
      await track(() => updateTaskItem(taskId, itemId, { completada, operator }));
    } catch (error) {
      flip(!completada);
      throw error;
    }
  }, [operator, patchLocal, track]);

  const tempId = useRef(-1);
  const addItem = useCallback(async (taskId: string, texto: string, completada = false) => {
    const temp: TaskChecklistItem = { id: tempId.current--, taskId, texto, completada, orden: 9999, creadoPor: operator, completadoPor: '', createdAt: '', completedAt: '' };
    patchLocal(taskId, task => withItems(task, [...(task.items || []), temp]));
    try {
      const data = await track(async () => {
        const created = await createTaskItem(taskId, { texto, operator });
        // Deshacer de una subtarea hecha: se re-crea y se vuelve a tildar.
        if (completada && created?.item) return updateTaskItem(taskId, created.item.id, { completada: true, operator });
        return created;
      });
      patchLocal(taskId, task => withItems(task, (task.items || []).map(item => (item.id === temp.id ? data.item : item))));
      return data.item;
    } catch (error) {
      patchLocal(taskId, task => withItems(task, (task.items || []).filter(item => item.id !== temp.id)));
      throw error;
    }
  }, [operator, patchLocal, track]);

  const removeItem = useCallback(async (taskId: string, item: TaskChecklistItem) => {
    let index = -1;
    patchLocal(taskId, task => {
      index = (task.items || []).findIndex(entry => entry.id === item.id);
      return withItems(task, (task.items || []).filter(entry => entry.id !== item.id));
    });
    try {
      await track(() => deleteTaskItem(taskId, item.id, operator));
    } catch (error) {
      patchLocal(taskId, task => {
        const list = [...(task.items || [])];
        list.splice(index < 0 ? list.length : index, 0, item);
        return withItems(task, list);
      });
      throw error;
    }
  }, [operator, patchLocal, track]);

  return { ...store, moving, move, moveMany, moveBack, save, remove, removeMany, restore, toggleItem, addItem, removeItem };
}

export type TaskActions = ReturnType<typeof useTaskActions>;
