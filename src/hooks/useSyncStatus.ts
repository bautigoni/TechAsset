import type { SyncStatus } from '../types';

export function useSyncStatus(sync: SyncStatus) {
  const className = sync.state === 'ok' ? 'sync-ok' : sync.state === 'error' ? 'sync-error' : 'sync-pending';
  return { className, title: sync.message || sync.loadedAt || 'Base local' };
}
