import type { Device, InventoryItem } from '../../types';

// Los dos mundos siguen viviendo en sus tablas (local_devices e inventory_items);
// esto solo los normaliza a una forma común para poder mostrarlos juntos.
export type EntryKind = 'equipo' | 'recurso';

export interface Entry {
  key: string;
  kind: EntryKind;
  nombre: string;
  detalle: string;
  categoria: string;
  subcategoria: string;
  condicion: string;
  /** Fecha ISO de la última revisión de condición. Vacío = nunca se revisó. */
  revisadoAt: string;
  cantidad: number | null;
  unidad: string;
  bajoStock: boolean;
  imagenUrl: string;
  vidaPct: number | null;
  vencido: boolean;
  renovacion: string;
  sn: string;
  mac: string;
  teamviewerId: string;
  unidadesCargadas: number;
  unidadesConFalla: number;
  device?: Device;
  item?: InventoryItem;
}

// ── Regla única de "revisado" ───────────────────────────────────────────────
// Un activo está revisado si su última revisión tiene menos de 3 meses. De acá
// salen los DOS consumos: el KPI "Revisado %" y el cartelito de la tarjeta. Si
// cada uno usara su propio criterio la pantalla se contradiría sola.
export const REVIEW_MAX_AGE_DAYS = 92;

export function isReviewFresh(entry: Entry, now = Date.now()) {
  if (!entry.condicion || !entry.revisadoAt) return false;
  const stamp = Date.parse(entry.revisadoAt);
  if (!Number.isFinite(stamp)) return false;
  return now - stamp < REVIEW_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
}

// Texto para el cartelito y el detalle: "Nunca revisado" / "Revisado hace 5 meses".
export function reviewLabel(entry: Entry, now = Date.now()) {
  if (!entry.condicion || !entry.revisadoAt) return 'Nunca revisado';
  const stamp = Date.parse(entry.revisadoAt);
  if (!Number.isFinite(stamp)) return 'Nunca revisado';
  const days = Math.max(0, Math.floor((now - stamp) / (24 * 60 * 60 * 1000)));
  if (days < 1) return 'Revisado hoy';
  if (days < 31) return `Revisado hace ${days} ${days === 1 ? 'día' : 'días'}`;
  const meses = Math.floor(days / 30.44);
  return `Revisado hace ${meses} ${meses === 1 ? 'mes' : 'meses'}`;
}

// Clase CSS del punto de condición. Vive acá porque la usan la tarjeta, la
// tabla y el detalle.
export function conditionClass(condicion: string) {
  const value = String(condicion || '').trim().toLowerCase();
  if (!value) return 'is-sin-revisar';
  return `is-${value.normalize('NFD').replace(/[\u0300-\u036f]/g, '')}`;
}

export function deviceToEntry(device: Device): Entry {
  return {
    key: `d:${device.etiqueta}`,
    kind: 'equipo',
    nombre: device.aliasOperativo || device.etiqueta,
    detalle: [device.etiqueta, device.marca, device.modelo].filter(Boolean).join(' · '),
    categoria: device.assetClass || device.categoria || 'Otro',
    // Para equipos la subcategoría natural es el modelo: agrupa los 50
    // Chromebook en sus modelos reales sin pedirle nada al operador.
    subcategoria: device.modelo || device.marca || '',
    condicion: device.condition || '',
    revisadoAt: device.lastReviewedAt || '',
    cantidad: null,
    unidad: '',
    bajoStock: false,
    imagenUrl: '',
    vidaPct: device.vidaConsumidaPct ?? null,
    vencido: Boolean(device.vencido),
    renovacion: device.fechaRenovacion || '',
    sn: device.sn || '',
    mac: device.mac || '',
    teamviewerId: device.teamviewerId || '',
    unidadesCargadas: 0,
    unidadesConFalla: 0,
    device
  };
}

export function itemToEntry(item: InventoryItem): Entry {
  return {
    key: `i:${item.id}`,
    kind: 'recurso',
    nombre: item.nombre,
    detalle: item.observaciones || '',
    categoria: item.categoria || 'Otro',
    subcategoria: item.subcategoria || '',
    condicion: item.condicion || '',
    revisadoAt: item.condicionUpdatedAt || '',
    cantidad: Number(item.cantidad || 0),
    unidad: item.unidad || 'unidades',
    bajoStock: Boolean(item.bajoStock),
    imagenUrl: item.imagenUrl || '',
    vidaPct: null,
    vencido: false,
    renovacion: '',
    sn: '',
    mac: '',
    teamviewerId: '',
    unidadesCargadas: Number(item.unidadesCargadas || 0),
    unidadesConFalla: Number(item.unidadesConFalla || 0),
    item
  };
}

export interface Group {
  categoria: string;
  total: number;
  subgroups: Array<{ subcategoria: string; entries: Entry[] }>;
  /** Resumen para la portada de categorías: qué hay adentro sin tener que entrar. */
  equipos: number;
  recursos: number;
  aRevisar: number;
  conProblema: number;
  portada: string;
}

// Agrupa categoría → subcategoría manteniendo el orden alfabético, con los
// items sin subcategoría primero para que no queden escondidos al final.
export function groupEntries(entries: Entry[]): Group[] {
  const byCategoria = new Map<string, Map<string, Entry[]>>();
  for (const entry of entries) {
    const categoria = entry.categoria || 'Otro';
    if (!byCategoria.has(categoria)) byCategoria.set(categoria, new Map());
    const subs = byCategoria.get(categoria)!;
    const sub = entry.subcategoria || '';
    if (!subs.has(sub)) subs.set(sub, []);
    subs.get(sub)!.push(entry);
  }
  const now = Date.now();
  return [...byCategoria.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], 'es'))
    .map(([categoria, subs]) => {
      const flat = [...subs.values()].flat();
      return {
        categoria,
        total: flat.length,
        subgroups: [...subs.entries()]
          .sort((a, b) => (a[0] ? 1 : 0) - (b[0] ? 1 : 0) || a[0].localeCompare(b[0], 'es'))
          .map(([subcategoria, list]) => ({
            subcategoria,
            entries: list.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { numeric: true }))
          })),
        equipos: flat.filter(entry => entry.kind === 'equipo').length,
        recursos: flat.filter(entry => entry.kind === 'recurso').length,
        aRevisar: flat.filter(entry => !isReviewFresh(entry, now)).length,
        conProblema: flat.filter(entry => entry.condicion === 'Regular' || entry.condicion === 'Malo' || entry.vencido || entry.bajoStock).length,
        portada: flat.find(entry => entry.imagenUrl)?.imagenUrl || ''
      };
    });
}
