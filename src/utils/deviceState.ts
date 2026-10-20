import type { Device } from '../types';

/**
 * Estado de un equipo, en un solo lugar. Antes había cinco copias (tabla,
 * formulario de préstamo, página de préstamos, filtros, dashboard) y no
 * coincidían: "En reparación" era disponible en una y no disponible en otra.
 */

export type LoanState = 'available' | 'loaned' | 'blocked';
export type DeviceStateKey = 'available' | 'loaned' | 'missing' | 'out';

export function normalizeState(value?: string) {
  return String(value || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ');
}

/**
 * Si se puede prestar, devolver o ninguna de las dos. Es la MISMA regla que
 * aplica el server (isAvailableState / isLoanedState en loans.routes.js): si
 * cambia una, cambiar la otra.
 */
export function getLoanState(estado?: string): LoanState {
  const state = normalizeState(estado);
  if (state.includes('prest') || state.includes('retir')) return 'loaned';
  if (!state || state.includes('devuelto') || state.includes('sin revisar')) return 'available';
  if (state.includes('disponible') && !state.includes('no disponible')) return 'available';
  return 'blocked';
}

/** Las cuatro categorías de los contadores y filtros (dashboard, dispositivos). */
export function getDeviceStateKey(device: Pick<Device, 'estado'>): DeviceStateKey {
  const state = normalizeState(device.estado);
  if (state.includes('perd') || state.includes('lost') || state.includes('no encontrad')) return 'missing';
  const loan = getLoanState(device.estado);
  if (loan === 'loaned') return 'loaned';
  if (loan === 'available') return 'available';
  // Fuera de servicio, en reparación, mantenimiento, baja, no disponible y
  // cualquier otro estado que no se puede prestar.
  return 'out';
}

