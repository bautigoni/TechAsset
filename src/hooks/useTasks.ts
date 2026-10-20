import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { TaskItem } from '../types';
import { getTasks } from '../services/tasksApi';
import { fetchShiftSettings } from '../services/operationsApi';
import { isOverdue } from '../utils/dates';
import { getActiveSiteCode } from '../services/activeSite';

export function useTasks(operator: string) {
  const [items, setItems] = useState<TaskItem[]>([]);
  const [shifts, setShifts] = useState({ morningOperator: '', afternoonOperator: '' });
  // Sede cuya lista ya llegó al menos una vez (para no decir "no existe" antes de cargar).
  const [loadedSite, setLoadedSite] = useState('');
  const itemsRef = useRef(items);
  itemsRef.current = items;

  // Misma guarda que en agenda: el hook pide al montar y App vuelve a pedir al
  // cambiar de sede, y salían dos GET /api/tasks (el más pesado de todos).
  // La guarda es por sede (como en agenda): un poll en vuelo de la sede anterior
  // no se reutiliza y su respuesta se descarta si ya cambió la sede.
  const inFlight = useRef<{ site: string; promise: Promise<void> } | null>(null);
  const lastKey = useRef('');
  // Cambios optimistas en vuelo y "época" de escrituras: un poll que salió
  // antes de un cambio (o que llega mientras otro está en vuelo) no pisa lo
  // que el usuario acaba de hacer; el próximo poll trae lo que quedó.
  const pending = useRef(0);
  const epoch = useRef(0);
  // Turnos de la sede: antes se pedían solo al montar y el KPI "mías" seguía con
  // los turnos de la sede inicial después de cambiar de sede.
  const shiftsSite = useRef('');
  const loadShifts = useCallback((site: string) => {
    if (shiftsSite.current === site) return;
    shiftsSite.current = site;
    fetchShiftSettings()
      .then(r => { if (r.ok && getActiveSiteCode() === site) setShifts(r.settings); })
      .catch(() => { if (shiftsSite.current === site) shiftsSite.current = ''; });
  }, []);
  const lastLoad = useRef<{ site: string; at: number } | null>(null);
  /** `maxAgeMs`: si ya hay datos de esta sede más nuevos que eso, no pide de nuevo. */
  const refresh = useCallback(async (options?: { maxAgeMs?: number }) => {
    const site = getActiveSiteCode();
    loadShifts(site);
    if (inFlight.current && inFlight.current.site === site) return inFlight.current.promise;
    const maxAge = Number(options?.maxAgeMs) || 0;
    if (maxAge && lastLoad.current?.site === site && Date.now() - lastLoad.current.at < maxAge) return;
    const startedAt = epoch.current;
    // Se pollea (App, cada 30 s): si no cambió nada no hay re-render.
    const promise: Promise<void> = getTasks()
      .then(data => {
        if (getActiveSiteCode() !== site) return;
        lastLoad.current = { site, at: Date.now() };
        setLoadedSite(site);
        if (pending.current > 0 || epoch.current !== startedAt) return;
        const key = `${site}|${JSON.stringify(data.items)}`;
        if (key === lastKey.current) return;
        lastKey.current = key;
        setItems(data.items);
      })
      .finally(() => { if (inFlight.current?.promise === promise) inFlight.current = null; });
    inFlight.current = { site, promise };
    return promise;
  }, [loadShifts]);

  useEffect(() => {
    refresh().catch(() => setItems([]));
  }, [refresh]);

  const kpis = useMemo<Record<string, number>>(() => ({
    total: items.length,
    pending: items.filter(item => item.estado === 'Pendiente').length,
    progress: items.filter(item => item.estado === 'En proceso').length,
    done: items.filter(item => item.estado === 'Hecha').length,
    overdue: items.filter(item => item.estado !== 'Hecha' && isOverdue(item.fechaVencimiento)).length,
    mine: items.filter(item => isAssignedTo(item, operator) && isOwnShift(item, operator, shifts)).length
  }), [items, operator, shifts]);

  /** Envuelve una escritura optimista: bloquea que el poll la pise. */
  const track = useCallback(async <T,>(work: () => Promise<T>) => {
    pending.current += 1;
    epoch.current += 1;
    try { return await work(); } finally { pending.current -= 1; }
  }, []);

  const patchLocal = useCallback((id: string, change: (task: TaskItem) => TaskItem) => {
    setItems(previous => previous.map(item => (item.id === id ? change(item) : item)));
  }, []);

  const loaded = loadedSite !== '' && loadedSite === getActiveSiteCode();

  // Las escrituras (mover, borrar, subtareas…) viven en el chunk de Tareas
  // (components/tasks/useTaskActions): acá queda solo lo que usa la app entera.
  return { items, setItems, itemsRef, kpis, refresh, loaded, track, patchLocal, operator };
}

export type TasksStore = ReturnType<typeof useTasks>;

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
