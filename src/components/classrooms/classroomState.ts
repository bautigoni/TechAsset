import type { Classroom, ClassroomCategory, ClassroomEquipmentItem, ClassroomGeneralState, ClassroomItemState } from '../../types';

/* Reglas de estado del aula. Tienen que coincidir con el server
   (`calcEstadoGeneral` / `migrateItemState` en classrooms.routes.js). */

export const ITEM_STATES: ClassroomItemState[] = ['OK', 'Con falla', 'No tiene', 'En reparación', 'Sin revisar'];

export const DEFAULT_EQUIPMENT_OPTIONS: Array<{ key: string; label: string; options?: ClassroomItemState[] }> = [
  { key: 'proyector', label: 'Proyector' },
  { key: 'nuc', label: 'NUC' },
  { key: 'monitor', label: 'Monitor' },
  { key: 'tecladoMouse', label: 'Teclado/Mouse' },
  { key: 'tele', label: 'Tele' },
  { key: 'notebook', label: 'Notebook' },
  { key: 'parlantes', label: 'Parlantes' },
  { key: 'conectividad', label: 'Conectividad' },
  { key: 'otro', label: 'Otro' }
];

const LEGACY_STATE_KEYS: Record<string, keyof Pick<Classroom, 'proyector' | 'nuc' | 'monitor' | 'tecladoMouse'>> = {
  proyector: 'proyector',
  nuc: 'nuc',
  monitor: 'monitor',
  tecladoMouse: 'tecladoMouse'
};

/** 'No encontrado' (deprecado) se lee como 'Con falla'; lo desconocido, 'Sin revisar'. */
export function migrateLegacyState(value: string | undefined): ClassroomItemState {
  if (value === 'No encontrado') return 'Con falla';
  if (value === 'OK' || value === 'Con falla' || value === 'No tiene' || value === 'En reparación' || value === 'Sin revisar') return value;
  return 'Sin revisar';
}

/** Equipamiento del aula; si viene vacío, las primeras 4 categorías de la sede con el estado de las columnas viejas. */
export function getEquipment(item: Classroom, categories: Array<{ key: string; label: string }>): ClassroomEquipmentItem[] {
  if (Array.isArray(item.equipment) && item.equipment.length) return item.equipment.map(entry => ({ ...entry, state: migrateLegacyState(entry.state) }));
  return (categories.length ? categories : DEFAULT_EQUIPMENT_OPTIONS).slice(0, 4).map(option => {
    const stateKey = LEGACY_STATE_KEYS[option.key];
    return { key: option.key, label: option.label, state: migrateLegacyState(stateKey ? item[stateKey] : 'Sin revisar') };
  });
}

export function calcGeneral(equipment: ClassroomEquipmentItem[]): ClassroomGeneralState {
  const states = equipment.map(item => item.state);
  if (states.some(v => v === 'En reparación')) return 'Problema';
  if (states.some(v => v === 'Con falla' || v === 'Sin revisar')) return 'Con observaciones';
  if (states.length && states.every(v => v === 'OK' || v === 'No tiene')) return 'OK';
  return 'Sin revisar';
}

/** Lo que pide atención en el aula ("NUC en reparación", "Proyector con falla"). */
export function issuesOf(equipment: ClassroomEquipmentItem[]): string[] {
  return equipment
    .filter(item => item.state !== 'OK' && item.state !== 'No tiene')
    .map(item => `${item.label} ${item.state.toLowerCase()}`);
}

export function normalizeClassroom(item: Classroom, categories: ClassroomCategory[]): Classroom {
  return {
    ...item,
    proyector: migrateLegacyState(item.proyector),
    nuc: migrateLegacyState(item.nuc),
    monitor: migrateLegacyState(item.monitor),
    tecladoMouse: migrateLegacyState(item.tecladoMouse),
    equipment: getEquipment(item, categories)
  };
}

/** Tono de texto por estado general: lo normal no se marca. */
export function generalTone(state: ClassroomGeneralState | undefined): 'normal' | 'warn' | 'bad' | 'muted' {
  if (state === 'Problema') return 'bad';
  if (state === 'Con observaciones') return 'warn';
  if (state === 'Sin revisar' || !state) return 'muted';
  return 'normal';
}

export function itemTone(state: ClassroomItemState): 'normal' | 'warn' | 'bad' {
  if (state === 'En reparación') return 'bad';
  if (state === 'Con falla') return 'warn';
  return 'normal';
}

const FIELD_LABELS: Record<string, string> = {
  proyector: 'Proyector',
  nuc: 'NUC',
  monitor: 'Monitor',
  tecladoMouse: 'Teclado/Mouse',
  equipment: 'Equipamiento',
  observaciones: 'Observaciones',
  estadoGeneral: 'Estado general'
};

export function fieldLabel(campo: string) {
  return FIELD_LABELS[campo] || campo;
}

/** Cambio de `equipment` (JSON completo antes/después) en palabras: "Proyector OK → Con falla, + Tele". */
export function describeEquipmentChange(before: string, after: string): string {
  const parse = (value: string): ClassroomEquipmentItem[] => {
    try {
      const parsed = JSON.parse(value || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };
  const a = parse(before);
  const b = parse(after);
  const parts: string[] = [];
  for (const item of b) {
    const old = a.find(entry => entry.key === item.key);
    if (!old) parts.push(`+ ${item.label} (${migrateLegacyState(item.state)})`);
    else if (migrateLegacyState(old.state) !== migrateLegacyState(item.state)) parts.push(`${item.label} ${migrateLegacyState(old.state)} → ${migrateLegacyState(item.state)}`);
  }
  for (const item of a) if (!b.some(entry => entry.key === item.key)) parts.push(`− ${item.label}`);
  return parts.join(', ') || 'sin cambios de estado';
}
