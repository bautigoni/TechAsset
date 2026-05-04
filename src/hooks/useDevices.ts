import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Device, SyncStatus } from '../types';
import { getDevices } from '../services/devicesApi';
import { classifyDeviceType, getOperationalAlias } from '../utils/classifyDevice';
import { getDeviceStateKey } from '../utils/deviceState';
import { matchesSmartSearch } from '../utils/normalizeSearch';

export function useDevices(search: string) {
  const [devices, setDevices] = useState<Device[]>([]);
  const [sync, setSync] = useState<SyncStatus>({ state: 'loading' });

  const refresh = useCallback(async () => {
    setSync(current => current.state === 'ok' ? { ...current, state: 'loading' } : { state: 'loading' });
    try {
      const data = await getDevices();
      setDevices(data.items.map(device => ({ ...device, aliasOperativo: getOperationalAlias(device) })));
      setSync({ state: 'ok', loadedAt: data.loadedAt, message: data.source });
    } catch (error) {
      setSync({ state: 'error', message: error instanceof Error ? error.message : 'Error' });
    }
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
      out: 0,
      PLANI: 0,
      TOUCH: 0,
      TIC: 0,
      DELL: 0
    };
    devices.forEach(device => {
      const state = getDeviceStateKey(device);
      if (state === 'loaned') base.loaned += 1;
      else if (state === 'missing') base.missing += 1;
      else if (state === 'out') base.out += 1;
      else base.available += 1;
      base[classifyDeviceType(device)] += 1;
    });
    return base;
  }, [devices]);

  return { devices, filteredDevices, counts, sync, refresh, setDevices };
}
