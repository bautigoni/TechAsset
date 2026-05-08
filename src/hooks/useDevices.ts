import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Device, SyncStatus } from '../types';
import { getDevices } from '../services/devicesApi';
import { classifyDeviceType, withOperationalAliases } from '../utils/classifyDevice';
import { getDeviceStateKey } from '../utils/deviceState';
import { matchesSmartSearch } from '../utils/normalizeSearch';

export function useDevices(search: string) {
  const [devices, setDevices] = useState<Device[]>([]);
  const [sync, setSync] = useState<SyncStatus>({ state: 'loading' });
  const refreshInFlight = useRef<Promise<void> | null>(null);
  const hasDevices = useRef(false);

  const refresh = useCallback((options: { force?: boolean; wait?: boolean } = {}) => {
    if (refreshInFlight.current && !options.force) return refreshInFlight.current;
    const promise = (async () => {
      setSync(current => hasDevices.current ? current : { state: 'loading' });
      try {
        const data = await getDevices(options);
        const nextDevices = withOperationalAliases(data.items);
        hasDevices.current = nextDevices.length > 0;
        setDevices(nextDevices);
        const cacheNote = data.diagnostics?.respondedWithCache ? 'cache inmediato' : 'actualizado';
        const diagMessage = typeof data.diagnostics?.message === 'string' ? data.diagnostics.message : '';
        setSync({ state: data.diagnostics?.emptyFallback ? 'error' : 'ok', loadedAt: data.loadedAt, message: diagMessage || `${data.source} · ${cacheNote}` });
      } catch (error) {
        setSync(current => current.state === 'ok'
          ? { ...current, message: current.message || 'Inventario cargado desde cache local.' }
          : { state: 'error', message: error instanceof Error ? error.message : 'Error' });
      } finally {
        refreshInFlight.current = null;
      }
    })();
    refreshInFlight.current = promise;
    return promise;
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const filteredDevices = useMemo(() => {
    if (!search.trim()) return devices;
    return devices.filter(device => matchesSmartSearch(device, search));
  }, [devices, search]);

  const counts = useMemo(() => {
    const base: Record<string, number> = {
      total: devices.length,
      available: 0,
      loaned: 0,
      missing: 0,
      out: 0
    };
    devices.forEach(device => {
      const state = getDeviceStateKey(device);
      if (state === 'loaned') base.loaned += 1;
      else if (state === 'missing') base.missing += 1;
      else if (state === 'out') base.out += 1;
      else base.available += 1;
      const category = classifyDeviceType(device);
      base[category] = (base[category] || 0) + 1;
    });
    return base;
  }, [devices]);

  const patchLocal = useCallback((etiqueta: string, patch: Partial<Device>) => {
    setDevices(current => current.map(device => device.etiqueta === etiqueta ? { ...device, ...patch } : device));
  }, []);

  const removeLocal = useCallback((etiqueta: string) => {
    const key = String(etiqueta || '').trim().toUpperCase().replace(/\s+/g, '');
    setDevices(current => current.filter(device => String(device.etiqueta || '').trim().toUpperCase().replace(/\s+/g, '') !== key));
  }, []);

  return { devices, filteredDevices, counts, sync, refresh, setDevices, patchLocal, removeLocal };
}
