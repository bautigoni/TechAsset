import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import '../../styles/screens/inventory.css';
import type { Device, InventoryItem } from '../../types';
import { CONDITION_VALUES } from '../../types';
import { deleteInventoryItem, getInventoryItems, restoreInventoryItem, undoInventoryReview, updateInventoryItem, type ReviewUndoPayload } from '../../services/inventoryApi';
import { updateDeviceMetadata } from '../../services/devicesApi';
import { Button, Collapse, EmptyState, ErrorState, Eyebrow, Ring, Segmented, SkeletonRows, Table, useHeldKeys, useStatusLine, type Column, type SortState } from '../../ui';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { useFitPlaceholder } from '../../hooks/useFitPlaceholder';
import { TruncatedText } from '../../ui/Truncated';
import { IconChevronDown, IconLock, IconPlus, IconSearch, IconX } from '../../ui/icons';
import { dayKeyAr, todayKeyAr } from '../../utils/formatters';
import { downloadCsv } from '../../utils/download';
import { getActiveSiteCode } from '../../services/activeSite';
import {
  compareEntries, compareText, conditionTone, deviceToEntry, entryMatches, groupEntries, isProblem, isReviewFresh,
  itemToEntry, normalizeQuery, reviewShort, stockInfo, thumbText, type Entry
} from './inventoryEntries';
import { Chip, ChipGroup, errorText, Tx } from './inventoryParts';
import { InventoryTree, type TreeSelection } from './InventoryTree';
import { InventoryCategoryGrid } from './InventoryCategoryGrid';
import { InventoryCard } from './InventoryCard';
import { InventoryDetail } from './InventoryDetail';
import { ConditionReview } from './ConditionReview';
import { ResourceForm } from './ResourceForm';
import { HiddenPanel, ImportExportPanel } from './InventoryPanels';

type Segment = 'todo' | 'equipo' | 'recurso';
// Los KPI no son decorativos: cada uno es el filtro de lo que está contando.
type KpiFilter = '' | 'malos' | 'vencidos' | 'bajoStock' | 'sinFoto' | 'aRevisar';
type Panel = '' | 'review' | 'add' | 'io' | 'hidden';
type DeviceOverride = { condition?: string; lastReviewedAt?: string; assetClass?: string; teamviewerId?: string };

const PAGE = 20;
const KPI_LABELS: Record<Exclude<KpiFilter, ''>, string> = {
  malos: 'Mostrando solo lo que está Regular o Malo.',
  vencidos: 'Mostrando solo lo que tiene la vida útil vencida.',
  bajoStock: 'Mostrando solo los recursos en bajo stock (cantidad igual o menor al mínimo).',
  sinFoto: 'Mostrando solo los recursos sin foto.',
  aRevisar: 'Mostrando lo que no se revisa hace más de 3 meses (o nunca).'
};

const matchesKpi = (entry: Entry, kpi: KpiFilter, now: number) => {
  switch (kpi) {
    case 'malos': return isProblem(entry);
    case 'vencidos': return entry.vencido;
    case 'bajoStock': return entry.kind === 'recurso' && entry.bajoStock;
    case 'sinFoto': return entry.kind === 'recurso' && !entry.imagenUrl;
    case 'aRevisar': return !isReviewFresh(entry, now);
    default: return true;
  }
};
const matchesCondition = (entry: Entry, condicion: string) => !condicion || (condicion === 'Sin revisar' ? !entry.condicion : entry.condicion === condicion);

/**
 * Inventario TIC: equipos (local_devices) y recursos (inventory_items) juntos,
 * con condición, revisión, vida útil y stock. Todo lo que se abre va en línea:
 * ficha debajo de la fila o tarjeta, formulario de alta arriba, recorrido de
 * revisión, importar/exportar y ocultos. Nada flota.
 */
export function InventoryPage({ devices, consultationMode, onProfile, onRefreshDevices }: {
  devices: Device[];
  consultationMode: boolean;
  onProfile?: (device: Device) => void;
  onRefreshDevices?: () => Promise<unknown> | void;
}) {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [itemsLoaded, setItemsLoaded] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [overrides, setOverrides] = useState<Record<string, DeviceOverride>>({});
  const [panel, setPanel] = useState<Panel>('');
  const [openKey, setOpenKey] = useState('');
  const [editingKey, setEditingKey] = useState('');
  const [openMessage, setOpenMessage] = useState<{ key: string; text: string } | null>(null);
  const [search, setSearch] = useState('');
  const [segment, setSegment] = useState<Segment>('recurso');
  const [condicion, setCondicion] = useState('');
  const [kpi, setKpi] = useState<KpiFilter>('');
  const [view, setView] = useState<'table' | 'grid'>('table');
  const [selected, setSelected] = useState<TreeSelection>(null);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [treeOpen, setTreeOpen] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const [sort, setSort] = useState<SortState>(null);
  // En angosto el árbol de categorías se pliega detrás de "Categoría" (en ancho siempre se ve).
  const narrowTree = useMediaQuery('(max-width: 767px)');
  // El placeholder más largo que entra en el ancho real del buscador (nunca cortado).
  const [searchRef, searchPlaceholder] = useFitPlaceholder(['Nombre, etiqueta, modelo… (touch 34, D1436, sensor)', 'Nombre, etiqueta, modelo…', 'Buscar…']);
  const topStatus = useStatusLine();
  const listStatus = useStatusLine();
  const siteCode = getActiveSiteCode();

  const refresh = useCallback(() => getInventoryItems()
    .then(response => { setItems(response.items); setLoadError(''); })
    .catch(error => setLoadError(errorText(error, 'No se pudo cargar el inventario.')))
    .finally(() => setItemsLoaded(true)), []);

  useEffect(() => { void refresh(); }, [refresh]);

  // Lo que se guardó desde acá (condición, clase, TeamViewer) se ve en el acto;
  // cuando el refresco de equipos ya lo trae, el parche sobra y se descarta.
  useEffect(() => {
    setOverrides(current => {
      const keys = Object.keys(current);
      if (!keys.length) return current;
      const byTag = new Map(devices.map(device => [device.etiqueta, device]));
      let changed = false;
      const next: Record<string, DeviceOverride> = {};
      for (const tag of keys) {
        const device = byTag.get(tag);
        const patch = current[tag];
        const settled = device
          && (patch.condition === undefined || (device.condition || '') === patch.condition)
          && (patch.lastReviewedAt === undefined || (device.lastReviewedAt || '') === patch.lastReviewedAt)
          && (patch.assetClass === undefined || !patch.assetClass || device.assetClass === patch.assetClass)
          && (patch.teamviewerId === undefined || (device.teamviewerId || '') === patch.teamviewerId);
        if (settled) changed = true;
        else next[tag] = patch;
      }
      return changed ? next : current;
    });
  }, [devices]);

  const entries = useMemo<Entry[]>(() => [
    ...devices.map(device => {
      const patch = overrides[device.etiqueta];
      if (!patch) return deviceToEntry(device);
      return deviceToEntry({
        ...device,
        ...(patch.condition !== undefined ? { condition: patch.condition } : {}),
        ...(patch.lastReviewedAt !== undefined ? { lastReviewedAt: patch.lastReviewedAt } : {}),
        ...(patch.assetClass ? { assetClass: patch.assetClass } : {}),
        ...(patch.teamviewerId !== undefined ? { teamviewerId: patch.teamviewerId } : {})
      });
    }),
    ...items.map(itemToEntry)
  ], [devices, items, overrides]);

  const entriesByKey = useMemo(() => new Map(entries.map(entry => [entry.key, entry])), [entries]);

  // ── KPI (sobre TODO: son la puerta de entrada al filtro) ──────────────────
  const kpis = useMemo(() => {
    const at = Date.now();
    const equipos = entries.filter(entry => entry.kind === 'equipo');
    const recursos = entries.filter(entry => entry.kind === 'recurso');
    const revisados = entries.filter(entry => isReviewFresh(entry, at)).length;
    return {
      total: entries.length,
      equipos: equipos.length,
      recursos: recursos.length,
      malos: entries.filter(isProblem).length,
      vencidos: equipos.filter(entry => entry.vencido).length,
      bajoStock: recursos.filter(entry => entry.bajoStock).length,
      sinStock: recursos.filter(entry => (entry.cantidad ?? 0) <= 0).length,
      sinFoto: recursos.filter(entry => !entry.imagenUrl).length,
      revisados,
      cobertura: entries.length ? Math.round((revisados / entries.length) * 100) : 0
    };
  }, [entries]);

  // ── Filtros ──────────────────────────────────────────────────────────────
  const base = useMemo(() => {
    const needle = normalizeQuery(search);
    const at = Date.now();
    return entries.filter(entry => (segment === 'todo' || entry.kind === segment)
      && matchesKpi(entry, kpi, at)
      && entryMatches(entry, search, needle));
  }, [entries, segment, kpi, search]);
  const filtered = useMemo(() => base.filter(entry => matchesCondition(entry, condicion)), [base, condicion]);
  const groups = useMemo(() => groupEntries(filtered), [filtered]);

  const narrowed = Boolean(search.trim() || kpi || condicion);
  const showPortada = !selected && !narrowed;

  const listed = useMemo(() => {
    if (showPortada) return [];
    const scoped = selected
      ? filtered.filter(entry => entry.categoria === selected.categoria && (!selected.subcategoria || entry.subcategoria === selected.subcategoria))
      : filtered;
    return [...scoped].sort(compareEntries);
  }, [filtered, selected, showPortada]);

  const sortColumns = useMemo<Record<string, (entry: Entry) => string | number | null>>(() => ({
    nombre: entry => entry.nombre,
    categoria: entry => `${entry.categoria} ${entry.subcategoria}`,
    seguimiento: entry => entry.kind,
    stock: entry => (entry.kind === 'recurso' ? (entry.cantidad ?? 0) - (entry.minStock ?? 0) : entry.vidaPct),
    condicion: entry => (entry.condicion ? CONDITION_VALUES.indexOf(entry.condicion as typeof CONDITION_VALUES[number]) : 9),
    revision: entry => (entry.condicion && entry.revisadoAt ? Date.parse(entry.revisadoAt) || 0 : null)
  }), []);

  const ordered = useMemo(() => {
    if (!sort) return listed;
    const pick = sortColumns[sort.key];
    if (!pick) return listed;
    const factor = sort.dir === 'asc' ? 1 : -1;
    return [...listed].sort((a, b) => {
      const va = pick(a);
      const vb = pick(b);
      if (va === null || va === undefined || va === '') return vb === null || vb === undefined || vb === '' ? 0 : 1;
      if (vb === null || vb === undefined || vb === '') return -1;
      const diff = typeof va === 'number' && typeof vb === 'number' ? va - vb : compareText(String(va), String(vb));
      return diff * factor || compareEntries(a, b);
    });
  }, [listed, sort, sortColumns]);

  // La ficha abierta siempre se ve: si quedó más allá del corte, el corte se estira.
  const openIndex = openKey ? ordered.findIndex(entry => entry.key === openKey) : -1;
  const visible = ordered.slice(0, Math.max(limit, openIndex + 1));
  const openEntry = openKey ? entriesByKey.get(openKey) || null : null;
  // Tarjetas: la ficha que se cierra sigue dibujada hasta terminar de plegarse.
  const heldCards = useHeldKeys(view === 'grid' && openEntry ? openKey : null);

  const selGroup = selected ? groups.find(group => group.categoria === selected.categoria) : undefined;
  const subChips = selGroup ? selGroup.subgroups.filter(sub => sub.subcategoria) : [];

  // ── Cambios de filtro: vuelven al primer tramo y cierran la ficha ──────────
  const resetList = () => { setLimit(PAGE); setOpenKey(''); setEditingKey(''); };
  const pickSegment = (next: Segment) => { resetList(); setSegment(next); setKpi(''); setSelected(null); };
  const toggleKpi = (next: Exclude<KpiFilter, ''>, segFor: Segment) => {
    resetList();
    if (kpi === next) { setKpi(''); return; }
    setKpi(next);
    setSegment(segFor);
    setSelected(null);
  };
  const pickCategory = (next: TreeSelection) => {
    resetList();
    setSelected(next);
    if (next) setExpanded(current => (current.includes(next.categoria) ? current : [...current, next.categoria]));
    setTreeOpen(false);
  };
  const clearAll = () => { resetList(); setKpi(''); setCondicion(''); setSearch(''); setSelected(null); };

  const togglePanel = (next: Panel) => setPanel(current => (current === next ? '' : next));
  const toggleOpen = (key: string) => {
    setEditingKey('');
    setOpenMessage(null);
    setOpenKey(current => (current === key ? '' : key));
  };

  // ── Escrituras ───────────────────────────────────────────────────────────
  const patchDevice = (etiqueta: string, patch: DeviceOverride) => setOverrides(current => ({ ...current, [etiqueta]: { ...current[etiqueta], ...patch } }));
  const replaceItem = (next: InventoryItem) => setItems(current => current.map(item => (item.id === next.id ? next : item)));

  const setEntryCondition = async (entry: Entry, value: string) => {
    if (entry.device) {
      // Mismo contrato que antes: la condición del equipo viaja con su clase.
      const response = await updateDeviceMetadata(entry.device.etiqueta, { condition: value, assetClass: entry.categoria, origen: 'Inventario' });
      patchDevice(entry.device.etiqueta, { condition: response.condition, lastReviewedAt: response.lastReviewedAt, assetClass: response.assetClass });
      void onRefreshDevices?.();
    } else if (entry.item) {
      // `revisado`: una revisión de verdad refresca la fecha aunque la condición quede igual.
      const response = await updateInventoryItem(entry.item.id, { condicion: value, revisado: true });
      replaceItem(response.item);
    }
  };

  const saveTeamviewer = async (device: Device, value: string) => {
    // Sin `condition`: cargar el ID no es revisar el equipo, no mueve la fecha.
    await updateDeviceMetadata(device.etiqueta, { teamviewerId: value, origen: 'Inventario' });
    patchDevice(device.etiqueta, { teamviewerId: value });
    void onRefreshDevices?.();
  };

  const hideItem = async (item: InventoryItem) => {
    await deleteInventoryItem(item.id);
    setItems(current => current.filter(entry => entry.id !== item.id));
    setOpenKey('');
    setEditingKey('');
    listStatus.show({
      tone: 'info',
      message: `${item.nombre} se ocultó del inventario.`,
      undo: {
        seconds: 10,
        onUndo: async () => {
          try {
            const response = await restoreInventoryItem(item.id);
            const restored = response.item || item;
            setItems(current => (current.some(entry => entry.id === restored.id) ? current : [...current, restored].sort((a, b) => compareText(a.nombre, b.nombre))));
            setOpenKey(`i:${restored.id}`);
            setOpenMessage({ key: `i:${restored.id}`, text: 'Se volvió a mostrar.' });
            listStatus.clear();
          } catch (reason) {
            listStatus.show({ tone: 'bad', message: errorText(reason, 'No se pudo volver a mostrar el recurso.'), retry: { onRetry: () => restoreInventoryItem(item.id).then(() => refresh()) } });
          }
        }
      }
    });
  };

  const onResourceCreated = (item: InventoryItem) => {
    setItems(current => [...current, item]);
    setPanel('');
    // Que el recurso nuevo quede a la vista con su ficha abierta.
    setSegment(current => (current === 'equipo' ? 'recurso' : current));
    setKpi('');
    setCondicion('');
    setSearch('');
    setSelected({ categoria: item.categoria || 'Otro', subcategoria: '' });
    setExpanded(current => (current.includes(item.categoria) ? current : [...current, item.categoria]));
    setLimit(Number.MAX_SAFE_INTEGER);
    setOpenKey(`i:${item.id}`);
    setOpenMessage({ key: `i:${item.id}`, text: `Se agregó ${item.nombre}.` });
  };

  // Recorrido: cada calificación se ve en la lista sin recargar todo.
  const rateDevice = async (etiqueta: string, value: string, assetClass: string) => {
    const response = await updateDeviceMetadata(etiqueta, { condition: value, assetClass, origen: 'Revisión' });
    patchDevice(etiqueta, { condition: response.condition, lastReviewedAt: response.lastReviewedAt, assetClass: response.assetClass });
  };
  const rateItem = async (id: number, value: string, categoria: string) => {
    const response = await updateInventoryItem(id, { condicion: value, categoria, revisado: true });
    replaceItem(response.item);
  };
  const undoRating = async (payload: ReviewUndoPayload) => {
    const response = await undoInventoryReview(payload);
    if (payload.kind === 'equipo') {
      patchDevice(payload.etiqueta, { condition: response.condition ?? payload.condicion, lastReviewedAt: response.lastReviewedAt ?? payload.reviewedAt, assetClass: response.assetClass || undefined });
    } else if (response.item) {
      replaceItem(response.item);
    }
  };
  const exitReview = (rated: number) => {
    setPanel('');
    if (rated) topStatus.show({ tone: 'ok', message: `Recorrido cerrado: ${rated} ${rated === 1 ? 'ítem calificado' : 'ítems calificados'} en esta pasada.` });
    void onRefreshDevices?.();
    void refresh();
  };

  // ── Exportar ─────────────────────────────────────────────────────────────
  const exportCsv = () => {
    const headers = ['Tipo', 'Nombre', 'Categoría', 'Subcategoría', 'Condición', 'Última revisión', 'Cantidad', 'Unidad', 'Vida consumida %', 'Renovación'];
    const rows = filtered.map(entry => [
      entry.kind === 'equipo' ? 'Equipo' : 'Recurso',
      entry.nombre, entry.categoria, entry.subcategoria, entry.condicion || 'Sin revisar',
      entry.revisadoAt ? (dayKeyAr(entry.revisadoAt) || entry.revisadoAt.slice(0, 10)) : '',
      entry.cantidad ?? '', entry.unidad, entry.vidaPct ?? '', entry.renovacion
    ]);
    const name = `inventario-${todayKeyAr()}.csv`;
    downloadCsv(name, [headers, ...rows]);
    topStatus.show({ tone: 'ok', message: `Se descargó ${name} con ${filtered.length} ${filtered.length === 1 ? 'ítem' : 'ítems'} (lo filtrado, no solo la categoría abierta).` });
  };
  const exportTemplate = () => {
    downloadCsv('plantilla-inventario-tic.csv', [
      ['Nombre', 'Cantidad', 'Categoría', 'Subcategoría', 'Unidad', 'Condición', 'Stock mínimo', 'Observaciones', 'Imagen URL'],
      ['LEDs', 100, 'Componentes', 'Diodos', 'unidades', 'Bueno', 10, 'Stock general', ''],
      ['Sensores de distancia', 34, 'Sensores', 'Ultrasonido', 'unidades', 'Regular', 5, 'HC-SR04', '']
    ]);
    topStatus.show({ tone: 'ok', message: 'Se descargó plantilla-inventario-tic.csv (2 filas de ejemplo).' });
  };

  // ── Ficha en línea ───────────────────────────────────────────────────────
  const renderDetail = (entry: Entry) => (
    <InventoryDetail
      key={entry.key}
      entry={entry}
      items={items}
      consultationMode={consultationMode}
      editing={editingKey === entry.key}
      onStartEdit={() => { if (!consultationMode) setEditingKey(entry.key); }}
      onCancelEdit={() => setEditingKey('')}
      onSaved={item => { replaceItem(item); setEditingKey(''); }}
      onCondition={value => setEntryCondition(entry, value)}
      onHide={hideItem}
      onProfile={onProfile}
      onItemChange={replaceItem}
      onTeamviewer={saveTeamviewer}
      onClose={() => { setOpenKey(''); setEditingKey(''); }}
      initialMessage={openMessage?.key === entry.key ? openMessage.text : undefined}
    />
  );

  const columns = useMemo<Column<Entry>[]>(() => [
    {
      key: 'foto', header: 'Foto', width: '2.5rem', card: 'meta',
      cell: entry => (
        <span className={`ivt-thumb${entry.imagenUrl ? ' has-photo' : ''}`}>
          {entry.imagenUrl ? <img src={entry.imagenUrl} alt="" loading="lazy" /> : <span className="ivt-mono">{thumbText(entry)}</span>}
        </span>
      )
    },
    {
      key: 'nombre', header: 'Nombre', width: 'minmax(0, 2fr)', card: 'title', sortValue: entry => entry.nombre,
      cell: entry => (
        <span className="ivt-cell-stack">
          <TruncatedText className="ivt-strong">{entry.nombre}</TruncatedText>
          {entry.detalle && <TruncatedText className={`ivt-sub${entry.kind === 'equipo' ? ' ivt-mono' : ''}`}>{entry.detalle}</TruncatedText>}
        </span>
      )
    },
    {
      key: 'categoria', header: 'Categoría', width: 'minmax(0, 1.3fr)', sortValue: entry => `${entry.categoria} ${entry.subcategoria}`,
      cell: entry => <TruncatedText className="ivt-sub2">{[entry.categoria, entry.subcategoria].filter(Boolean).join(' › ')}</TruncatedText>
    },
    {
      key: 'seguimiento', header: 'Seguimiento', width: '6.5rem', card: 'hide', sortValue: entry => entry.kind,
      cell: entry => <Tx tone="normal">{entry.kind === 'equipo' ? 'Individual' : 'Stock'}</Tx>
    },
    {
      key: 'stock', header: 'Stock / vida', width: '7.5rem', sortValue: sortColumns.stock,
      cell: entry => {
        const stock = stockInfo(entry);
        return (
          <span className="ivt-cell-stack">
            <Tx tone={stock.tone} mono>{stock.value}</Tx>
            {stock.note && <Tx tone={stock.noteTone} className="ivt-small">{stock.note}</Tx>}
          </span>
        );
      }
    },
    {
      key: 'condicion', header: 'Condición', width: '6.5rem', sortValue: sortColumns.condicion,
      cell: entry => <Tx tone={conditionTone(entry.condicion)}>{entry.condicion || 'Sin revisar'}</Tx>
    },
    {
      key: 'revision', header: 'Revisión', width: '5.5rem', card: 'hide', sortValue: sortColumns.revision,
      cell: entry => <Tx tone={isReviewFresh(entry) ? 'normal' : entry.condicion ? 'warn' : 'muted'}>{reviewShort(entry)}</Tx>
    },
    {
      key: 'abrir', header: <span className="ivt-sr">Abrir</span>, cardLabel: '', width: '1.25rem', card: 'meta',
      cell: entry => <IconChevronDown size={16} className={`ivt-chev${openKey === entry.key ? ' is-open' : ''}`} />
    }
  ], [openKey, sortColumns]);

  // ── Encabezado ───────────────────────────────────────────────────────────
  const kpiButton = ({ id, label, value, tone, note, noteTone, pressed, onClick, ring }: {
    id: string; label: string; value: ReactNode; tone?: 'warn' | 'bad'; note?: string; noteTone?: 'bad' | 'muted'; pressed: boolean; onClick: () => void; ring?: ReactNode;
  }) => (
    <button key={id} type="button" className={`ivt-kpi${ring ? ' ivt-kpi--wide' : ''}`} aria-pressed={pressed} onClick={onClick}
      aria-label={`${label}: ${typeof value === 'string' || typeof value === 'number' ? value : ''}${note ? `, ${note}` : ''}${pressed ? '. Filtro activo' : ''}`}>
      {ring}
      <span className="ivt-kpi-text">
        <TruncatedText className="ivt-kpi-label">{label}</TruncatedText>
        <span className="ivt-kpi-line">
          <span className={`ivt-kpi-n ivt-mono${tone ? ` is-${tone}` : ''}`}>{value}</span>
          {note && <Tx tone={noteTone || 'muted'} className="ivt-small ivt-ell">{note}</Tx>}
        </span>
      </span>
    </button>
  );

  const revTone = kpis.cobertura <= 0 && kpis.total ? 'bad' : kpis.cobertura <= 20 && kpis.total ? 'warn' : undefined;
  const emptyAlt = (() => {
    if (segment === 'todo' && !selected) return 0;
    const at = Date.now();
    const needle = normalizeQuery(search);
    return entries.filter(entry => matchesKpi(entry, kpi, at) && entryMatches(entry, search, needle) && matchesCondition(entry, condicion)).length;
  })();

  const crumbCount = showPortada
    ? `${groups.length} ${groups.length === 1 ? 'categoría' : 'categorías'}`
    : `${listed.length} ${listed.length === 1 ? 'ítem' : 'ítems'}`;

  return (
    <section className="view active ivt" aria-label="Inventario TIC">
      <header className="ivt-head">
        <div className="ivt-head-text">
          <Eyebrow>{`Inventario y datos · ${siteCode || 'Sede'}`}</Eyebrow>
          <h2 className="ivt-title">Equipos y recursos</h2>
          <p className="ivt-help ivt-head-desc">Revisado = condición cargada hace menos de 92 días. Vale igual para equipos y recursos.</p>
        </div>
        <div className="ivt-head-actions">
          <Button disabled={consultationMode} aria-expanded={panel === 'review'} aria-controls="ivt-review" onClick={() => togglePanel('review')}>Revisar condición</Button>
          <Button aria-expanded={panel === 'io'} aria-controls="ivt-ie" onClick={() => togglePanel('io')}>Importar / exportar</Button>
          <Button aria-expanded={panel === 'hidden'} aria-controls="ivt-hidden" onClick={() => togglePanel('hidden')}>Ocultos</Button>
          <Button variant="primary" icon={<IconPlus size={16} />} disabled={consultationMode} aria-expanded={panel === 'add'} aria-controls="ivt-add" onClick={() => togglePanel('add')}>Agregar recurso</Button>
        </div>
      </header>

      {consultationMode && (
        <div className="ivt-note" role="status">
          <IconLock size={14} />
          <span>Modo consulta: podés mirar y exportar. Revisar, importar, agregar y editar quedan deshabilitados.</span>
        </div>
      )}

      {/* Paneles en línea: se abren y se cierran suaves con el botón quieto (Collapse). */}
      <Collapse open={panel === 'io'} id="ivt-ie" outerClassName="ivt-fold" unmountOnClose>
        <ImportExportPanel count={filtered.length} consultationMode={consultationMode} onExport={exportCsv} onTemplate={exportTemplate} onImported={refresh} />
      </Collapse>
      <Collapse open={panel === 'hidden'} id="ivt-hidden" outerClassName="ivt-fold" unmountOnClose>
        <HiddenPanel
          consultationMode={consultationMode}
          onRestored={item => setItems(current => (current.some(entry => entry.id === item.id) ? current : [...current, item]))}
        />
      </Collapse>
      {topStatus.element}
      {loadError && <ErrorState message={loadError} onRetry={() => void refresh()} />}

      <Collapse open={panel === 'review' && !consultationMode} id="ivt-review" outerClassName="ivt-fold" unmountOnClose>
        <ConditionReview
          items={items}
          entriesByKey={entriesByKey}
          consultationMode={consultationMode}
          onRateDevice={rateDevice}
          onRateItem={rateItem}
          onUndo={undoRating}
          onExit={exitReview}
        />
      </Collapse>

      <Collapse open={panel === 'add' && !consultationMode} id="ivt-add" outerClassName="ivt-fold" unmountOnClose>
        <section className="ivt-panel">
          <ResourceForm
            items={items}
            defaultCategory={selected?.categoria}
            consultationMode={consultationMode}
            onSaved={item => onResourceCreated(item)}
            onCancel={() => setPanel('')}
          />
        </section>
      </Collapse>

      <div className="ivt-kpis" role="group" aria-label="Filtros rápidos">
        {kpiButton({ id: 'equipos', label: 'Equipos', value: kpis.equipos, pressed: segment === 'equipo' && !kpi, onClick: () => pickSegment('equipo') })}
        {kpiButton({ id: 'recursos', label: 'Recursos', value: kpis.recursos, pressed: segment === 'recurso' && !kpi, onClick: () => pickSegment('recurso') })}
        {kpiButton({ id: 'malos', label: 'Regular o malo', value: kpis.malos, tone: kpis.malos ? 'warn' : undefined, pressed: kpi === 'malos', onClick: () => toggleKpi('malos', 'todo') })}
        {kpiButton({ id: 'vencidos', label: 'Vida útil vencida', value: kpis.vencidos, tone: kpis.vencidos ? 'bad' : undefined, pressed: kpi === 'vencidos', onClick: () => toggleKpi('vencidos', 'equipo') })}
        {kpiButton({ id: 'bajo', label: 'Bajo stock', value: kpis.bajoStock, tone: kpis.bajoStock ? 'warn' : undefined, note: kpis.sinStock ? `${kpis.sinStock} sin stock` : undefined, noteTone: 'bad', pressed: kpi === 'bajoStock', onClick: () => toggleKpi('bajoStock', 'recurso') })}
        {kpiButton({ id: 'foto', label: 'Sin foto', value: kpis.sinFoto, tone: kpis.sinFoto ? 'warn' : undefined, pressed: kpi === 'sinFoto', onClick: () => toggleKpi('sinFoto', 'recurso') })}
        {kpiButton({
          id: 'revisado', label: 'Revisado', value: `${kpis.cobertura} %`, tone: revTone, note: `${kpis.revisados} de ${kpis.total}`,
          pressed: kpi === 'aRevisar', onClick: () => toggleKpi('aRevisar', 'todo'),
          ring: <Ring value={kpis.revisados} total={kpis.total} size={32} unit="revisados hace menos de 3 meses" />
        })}
      </div>

      <Collapse open={Boolean(kpi)} outerClassName="ivt-fold">
        <div className="ivt-note" role="status">
          <span className="ivt-grow">{kpi ? KPI_LABELS[kpi] : ''}</span>
          <Button size="sm" variant="ghost" onClick={() => { resetList(); setKpi(''); }}>Quitar filtro</Button>
        </div>
      </Collapse>

      <div className="ivt-tools">
        <Segmented<Segment>
          ariaLabel="Qué mostrar"
          value={segment}
          onChange={pickSegment}
          options={[
            { value: 'recurso', label: 'Recursos', count: kpis.recursos },
            { value: 'equipo', label: 'Equipos', count: kpis.equipos },
            { value: 'todo', label: 'Todo', count: kpis.total }
          ]}
        />
        <label className="ivt-search">
          <IconSearch size={16} />
          <span className="ivt-sr">Buscar en el inventario</span>
          <input
            ref={searchRef}
            type="text"
            autoComplete="off"
            spellCheck={false}
            value={search}
            placeholder={searchPlaceholder}
            onChange={event => { resetList(); setSearch(event.target.value); }}
            onKeyDown={event => { if (event.key === 'Escape' && search) { event.preventDefault(); resetList(); setSearch(''); } }}
          />
          {search && (
            <button type="button" className="ivt-search-clear" aria-label="Limpiar búsqueda" onClick={() => { resetList(); setSearch(''); }}>
              <IconX size={14} />
            </button>
          )}
        </label>
        <span className="ivt-grow" aria-hidden="true" />
        <Segmented<'table' | 'grid'>
          ariaLabel="Vista"
          value={view}
          onChange={next => { setView(next); setEditingKey(''); }}
          options={[{ value: 'table', label: 'Tabla' }, { value: 'grid', label: 'Tarjetas' }]}
        />
      </div>

      <div className="ivt-condrow">
        <span className="ivt-label">Condición</span>
        <ChipGroup label="Filtrar por condición">
          {[['', 'Toda'], ...CONDITION_VALUES.map(value => [value, value]), ['Sin revisar', 'Sin revisar']].map(([value, label]) => (
            <Chip
              key={value || 'toda'}
              pressed={condicion === value}
              tone={value === 'Regular' ? 'warn' : value === 'Malo' ? 'bad' : 'normal'}
              count={value ? base.filter(entry => matchesCondition(entry, value)).length : base.length}
              onClick={() => { resetList(); setCondicion(value); }}
            >
              {label}
            </Chip>
          ))}
        </ChipGroup>
      </div>

      <div className="ivt-body">
        <button type="button" className="ivt-treepick" aria-expanded={treeOpen} aria-controls="ivt-tree" onClick={() => setTreeOpen(value => !value)}>
          <span className="ivt-label">Categoría</span>
          <TruncatedText className="ivt-treepick-value">{selected ? [selected.categoria, selected.subcategoria].filter(Boolean).join(' › ') : 'Todo el inventario'}</TruncatedText>
          <IconChevronDown size={16} className={`ivt-chev${treeOpen ? ' is-open' : ''}`} />
        </button>
        <Collapse open={!narrowTree || treeOpen} outerClassName="ivt-treewrap" className="ivt-treewrap-body">
          <InventoryTree
            id="ivt-tree"
            groups={groups}
            total={filtered.length}
            selected={selected}
            onSelect={pickCategory}
            expanded={expanded}
            onToggle={categoria => setExpanded(current => (current.includes(categoria) ? current.filter(item => item !== categoria) : [...current, categoria]))}
          />
        </Collapse>

        <section className="ivt-main" aria-label="Listado">
          <div className="ivt-crumbs">
            <nav aria-label="Ubicación en el inventario" className="ivt-crumb-nav">
              <button type="button" className={`ivt-crumb${selected ? ' is-link' : ''}`} aria-current={!selected ? 'page' : undefined} onClick={() => pickCategory(null)}>Categorías</button>
              {selected && (
                <>
                  <span className="ivt-crumb-sep" aria-hidden="true">/</span>
                  <button type="button" className={`ivt-crumb${selected.subcategoria ? ' is-link' : ''}`} aria-current={!selected.subcategoria ? 'page' : undefined} onClick={() => pickCategory({ categoria: selected.categoria, subcategoria: '' })}>
                    <TruncatedText>{selected.categoria}</TruncatedText>
                  </button>
                </>
              )}
              {selected?.subcategoria && (
                <>
                  <span className="ivt-crumb-sep" aria-hidden="true">/</span>
                  <TruncatedText className="ivt-crumb is-current">{selected.subcategoria}</TruncatedText>
                </>
              )}
            </nav>
            <span className="ivt-count">{crumbCount}</span>
          </div>

          {subChips.length > 0 && selected && (
            <ChipGroup label="Subcategorías">
              {subChips.map(sub => (
                <Chip
                  key={sub.subcategoria}
                  pressed={selected.subcategoria === sub.subcategoria}
                  count={sub.entries.length}
                  thumb={sub.entries.find(entry => entry.imagenUrl)?.imagenUrl}
                  onClick={() => pickCategory({ categoria: selected.categoria, subcategoria: selected.subcategoria === sub.subcategoria ? '' : sub.subcategoria })}
                >
                  {sub.subcategoria}
                </Chip>
              ))}
            </ChipGroup>
          )}

          {listStatus.element}

          {!itemsLoaded && !loadError ? <SkeletonRows rows={5} /> : showPortada ? (
            groups.length
              ? <InventoryCategoryGrid groups={groups} onOpen={categoria => pickCategory({ categoria, subcategoria: '' })} />
              : <EmptyState title="Todavía no hay nada en el inventario de esta sede." description={consultationMode ? undefined : 'Agregá un recurso o importá la planilla.'} />
          ) : !listed.length ? (
            <EmptyState
              title="No hay nada para este filtro."
              action={(
                <span className="ivt-actions ivt-center">
                  {emptyAlt > 0 && <Button size="sm" onClick={() => { resetList(); setSegment('todo'); setSelected(null); }}>Ver {emptyAlt} {emptyAlt === 1 ? 'resultado' : 'resultados'} en todo el inventario</Button>}
                  <Button size="sm" variant="ghost" onClick={clearAll}>Quitar filtros</Button>
                </span>
              )}
            />
          ) : view === 'table' ? (
            <div className="ivt-tablewrap">
              <Table<Entry>
                caption="Inventario"
                rows={visible}
                columns={columns}
                rowKey={entry => entry.key}
                sort={sort}
                manualSort
                onSortChange={next => { setSort(next); setLimit(PAGE); }}
                onRowClick={entry => toggleOpen(entry.key)}
                rowAttrs={entry => ({ 'data-device-tag': entry.device?.etiqueta })}
                expandedKey={openEntry ? openKey : null}
                renderExpanded={renderDetail}
                cardBelow="lg"
                className="ivt-table"
              />
              <Pager shown={visible.length} total={ordered.length} onMore={() => setLimit(value => value + PAGE)} onAll={() => setLimit(Number.MAX_SAFE_INTEGER)} />
            </div>
          ) : (
            <>
              <div className="ivt-cards ivt-cards--dense">
                {visible.map(entry => (
                  <Fragment key={entry.key}>
                    <InventoryCard entry={entry} expanded={openKey === entry.key} onOpen={() => toggleOpen(entry.key)} />
                    {heldCards.drawn(entry.key) && (
                      <Collapse open={openKey === entry.key} appear unmountOnClose outerClassName="ivt-card-fold" className="ivt-card-detail" onSettled={open => { if (!open) heldCards.release(entry.key); }}>
                        {renderDetail(entry)}
                      </Collapse>
                    )}
                  </Fragment>
                ))}
              </div>
              <Pager shown={visible.length} total={ordered.length} onMore={() => setLimit(value => value + PAGE)} onAll={() => setLimit(Number.MAX_SAFE_INTEGER)} />
            </>
          )}
        </section>
      </div>
    </section>
  );
}

function Pager({ shown, total, onMore, onAll }: { shown: number; total: number; onMore: () => void; onAll: () => void }) {
  if (shown >= total) return null;
  return (
    <div className="ivt-pager">
      <span className="ivt-count ivt-grow">Mostrando {shown} de {total}</span>
      <Button size="sm" onClick={onMore}>Ver {Math.min(PAGE, total - shown)} más</Button>
      <Button size="sm" variant="ghost" onClick={onAll}>Ver todos</Button>
    </div>
  );
}
