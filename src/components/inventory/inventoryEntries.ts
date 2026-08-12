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
  cantidad: number | null;
  unidad: string;
  bajoStock: boolean;
  imagenUrl: string;
  vidaPct: number | null;
  vencido: boolean;
  renovacion: string;
  device?: Device;
  item?: InventoryItem;
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
    cantidad: null,
    unidad: '',
    bajoStock: false,
    imagenUrl: '',
    vidaPct: device.vidaConsumidaPct ?? null,
    vencido: Boolean(device.vencido),
    renovacion: device.fechaRenovacion || '',
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
    cantidad: Number(item.cantidad || 0),
    unidad: item.unidad || 'unidades',
    bajoStock: Boolean(item.bajoStock),
    imagenUrl: item.imagenUrl || '',
    vidaPct: null,
    vencido: false,
    renovacion: '',
    item
  };
}

export interface Group {
  categoria: string;
  total: number;
  subgroups: Array<{ subcategoria: string; entries: Entry[] }>;
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
  return [...byCategoria.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], 'es'))
    .map(([categoria, subs]) => ({
      categoria,
      total: [...subs.values()].reduce((acc, list) => acc + list.length, 0),
      subgroups: [...subs.entries()]
        .sort((a, b) => (a[0] ? 1 : 0) - (b[0] ? 1 : 0) || a[0].localeCompare(b[0], 'es'))
        .map(([subcategoria, list]) => ({
          subcategoria,
          entries: list.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { numeric: true }))
        }))
    }));
}
