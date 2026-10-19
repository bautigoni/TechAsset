import type { Device, InventoryItem } from '../../types';
import { matchesOperationalAlias } from '../../utils/classifyDevice';

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
  minStock: number | null;
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

export const FORM_CATEGORIES = ['Arduino', 'Robótica', 'Electrónica', 'Sensores', 'Cables', 'Cargadores', 'Componentes', 'Herramientas', 'Filamento 3D', 'Otro'];

// ── Regla única de "revisado" ───────────────────────────────────────────────
// Un activo está revisado si su última revisión tiene menos de 3 meses. De acá
// salen TODOS los consumos: el KPI "Revisado", el cartel de la tarjeta, la
// columna Revisión y la portada. Si cada uno usara su propio criterio la
// pantalla se contradiría sola.
export const REVIEW_MAX_AGE_DAYS = 92;
const DAY_MS = 24 * 60 * 60 * 1000;

export function isReviewFresh(entry: Pick<Entry, 'condicion' | 'revisadoAt'>, now = Date.now()) {
  if (!entry.condicion || !entry.revisadoAt) return false;
  const stamp = Date.parse(entry.revisadoAt);
  if (!Number.isFinite(stamp)) return false;
  return now - stamp < REVIEW_MAX_AGE_DAYS * DAY_MS;
}

function reviewAgeDays(entry: Pick<Entry, 'condicion' | 'revisadoAt'>, now: number) {
  if (!entry.condicion || !entry.revisadoAt) return null;
  const stamp = Date.parse(entry.revisadoAt);
  if (!Number.isFinite(stamp)) return null;
  return Math.max(0, Math.floor((now - stamp) / DAY_MS));
}

// Texto largo (detalle, recorrido): "Nunca revisado" / "Revisado hace 5 meses".
export function reviewLabel(entry: Pick<Entry, 'condicion' | 'revisadoAt'>, now = Date.now()) {
  const days = reviewAgeDays(entry, now);
  if (days === null) return 'Nunca revisado';
  if (days < 1) return 'Revisado hoy';
  if (days < 31) return `Revisado hace ${days} ${days === 1 ? 'día' : 'días'}`;
  const meses = Math.floor(days / 30.44);
  return `Revisado hace ${meses} ${meses === 1 ? 'mes' : 'meses'}`;
}

// Texto corto para la columna Revisión: "Hoy", "12 d", "4 meses", "Nunca".
export function reviewShort(entry: Pick<Entry, 'condicion' | 'revisadoAt'>, now = Date.now()) {
  const days = reviewAgeDays(entry, now);
  if (days === null) return 'Nunca';
  if (days < 1) return 'Hoy';
  if (days < 31) return `${days} d`;
  const meses = Math.floor(days / 30.44);
  return `${meses} ${meses === 1 ? 'mes' : 'meses'}`;
}

export type Tone = 'normal' | 'muted' | 'warn' | 'bad';

/** Regular en ámbar, Malo en rojo, el resto sin marcar; "Sin revisar" atenuado. */
export function conditionTone(condicion: string): Tone {
  if (condicion === 'Regular') return 'warn';
  if (condicion === 'Malo') return 'bad';
  return condicion ? 'normal' : 'muted';
}

export function isProblem(entry: Pick<Entry, 'condicion'>) {
  return entry.condicion === 'Regular' || entry.condicion === 'Malo';
}

/** Stock o vida útil en una línea mono y su estado en texto (nunca barritas). */
export function stockInfo(entry: Entry): { value: string; tone: Tone; note: string; noteTone: Tone } {
  if (entry.kind === 'equipo') {
    if (entry.vidaPct === null) return { value: '—', tone: 'muted', note: '', noteTone: 'muted' };
    if (entry.vencido) return { value: `${entry.vidaPct} %`, tone: 'bad', note: 'Vencida', noteTone: 'bad' };
    const year = /^\d{4}/.test(entry.renovacion) ? entry.renovacion.slice(0, 4) : '';
    return { value: `${entry.vidaPct} %`, tone: 'normal', note: year ? `renueva ${year}` : '', noteTone: 'muted' };
  }
  const cantidad = entry.cantidad ?? 0;
  const value = `${cantidad} / mín. ${entry.minStock ?? 3}`;
  if (cantidad <= 0) return { value, tone: 'bad', note: 'Sin stock', noteTone: 'bad' };
  if (entry.bajoStock) return { value, tone: 'warn', note: 'Bajo stock', noteTone: 'warn' };
  return { value, tone: 'normal', note: '', noteTone: 'muted' };
}

/** Miniatura sin foto: "T34" para Touch 34, iniciales para un recurso. */
export function thumbText(entry: Entry) {
  if (entry.kind === 'equipo') {
    const match = entry.nombre.match(/^(\S)\S*\s+(\d+)/);
    return match ? `${match[1]}${match[2]}`.toUpperCase() : entry.nombre.replace(/^D/i, '').slice(-4);
  }
  const words = entry.nombre.replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/).filter(Boolean);
  return `${words[0]?.[0] || ''}${words[1]?.[0] || ''}`.toUpperCase() || '—';
}

/** "2030-05-10" → "10/05/2030" sin pasar por Date (evita el corrimiento UTC). */
export function formatDay(value: string) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value || '—';
}

// ── Búsqueda ────────────────────────────────────────────────────────────────
// Equipos: el mismo motor de alias que Dispositivos (touch 34 = touch34 =
// 34touch, D1436, 1436, plani 5, planificación 5), más modelo, marca, SN y MAC.
// Recursos: "contiene" sin tildes, mayúsculas ni símbolos.
export function normalizeQuery(value: unknown) {
  return String(value || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
}

export function entryMatches(entry: Entry, query: string, needle = normalizeQuery(query)) {
  if (!needle) return true;
  if (entry.device) {
    if (matchesOperationalAlias(entry.device, query)) return true;
    // "34touch" / "planificación 5" contra el alias que se ve ("Touch 34",
    // "Plani 5"), aunque el tipo del equipo no salga de su filtro.
    const alias = normalizeQuery(entry.nombre);
    const plani = needle.replace(/planificacion|plano|plan(?!i)/g, 'plani');
    const swapped = plani.replace(/^(\d+)([a-z]+)$/, '$2$1');
    if (alias.includes(plani) || alias.includes(swapped)) return true;
  }
  return [entry.nombre, entry.detalle, entry.categoria, entry.subcategoria, entry.condicion, entry.sn, entry.mac]
    .some(value => value && normalizeQuery(value).includes(needle));
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
    minStock: null,
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
    minStock: Number.isFinite(Number(item.minStock)) ? Number(item.minStock) : 3,
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

const collator = new Intl.Collator('es', { numeric: true, sensitivity: 'base' });
export const compareText = (a: string, b: string) => collator.compare(a || '', b || '');

/** Orden del listado: categoría → sin subcategoría primero → subcategoría → nombre (Touch 2 antes que Touch 10). */
export function compareEntries(a: Entry, b: Entry) {
  return compareText(a.categoria, b.categoria)
    || (a.subcategoria ? 1 : 0) - (b.subcategoria ? 1 : 0)
    || compareText(a.subcategoria, b.subcategoria)
    || compareText(a.nombre, b.nombre);
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
    .sort((a, b) => compareText(a[0], b[0]))
    .map(([categoria, subs]) => {
      const flat = [...subs.values()].flat();
      return {
        categoria,
        total: flat.length,
        subgroups: [...subs.entries()]
          .sort((a, b) => (a[0] ? 1 : 0) - (b[0] ? 1 : 0) || compareText(a[0], b[0]))
          .map(([subcategoria, list]) => ({ subcategoria, entries: list.sort((a, b) => compareText(a.nombre, b.nombre)) })),
        equipos: flat.filter(entry => entry.kind === 'equipo').length,
        recursos: flat.filter(entry => entry.kind === 'recurso').length,
        aRevisar: flat.filter(entry => !isReviewFresh(entry, now)).length,
        conProblema: flat.filter(entry => isProblem(entry) || entry.vencido || entry.bajoStock).length,
        portada: flat.find(entry => entry.imagenUrl)?.imagenUrl || ''
      };
    });
}
