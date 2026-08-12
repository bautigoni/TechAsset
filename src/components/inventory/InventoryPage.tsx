import { useEffect, useMemo, useRef, useState } from 'react';
import type { Device, InventoryItem } from '../../types';
import { CONDITION_VALUES } from '../../types';
import { createInventoryItem, deleteInventoryItem, getInventoryItems, importInventoryCsv, updateInventoryItem, uploadInventoryImage } from '../../services/inventoryApi';
import { updateDeviceMetadata } from '../../services/devicesApi';
import { csvCell } from '../../utils/formatters';
import { Button } from '../layout/Button';
import { Modal } from '../layout/Modal';
import { ConditionReviewModal } from './ConditionReviewModal';

// Dos mundos en una sola vista de lectura: los equipos siguen viviendo en
// local_devices (padrón + préstamos) y los recursos en inventory_items. Acá se
// mergean en el cliente; no hay endpoint unificado ni datos migrados.
type EntryKind = 'equipo' | 'recurso';
type Segment = 'todo' | 'equipo' | 'recurso';

interface Entry {
  key: string;
  kind: EntryKind;
  nombre: string;
  detalle: string;
  clase: string;
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

const FORM_CATEGORIES = ['Arduino', 'Robótica', 'Electrónica', 'Sensores', 'Cables', 'Cargadores', 'Componentes', 'Herramientas', 'Otro'];
const EMPTY_FORM: Partial<InventoryItem> = {
  nombre: '',
  categoria: 'Otro',
  cantidad: 1,
  unidad: 'unidades',
  imagenUrl: '',
  condicion: '',
  minStock: 3,
  observaciones: ''
};

function conditionClass(condicion: string) {
  const value = String(condicion || '').trim().toLowerCase();
  if (!value) return 'is-sin-revisar';
  return `is-${value.normalize('NFD').replace(/[\u0300-\u036f]/g, '')}`;
}

function ConditionCell({ condicion }: { condicion: string }) {
  return <span className={`condition-dot ${conditionClass(condicion)}`}>{condicion || 'Sin revisar'}</span>;
}

function RowThumb({ url }: { url: string }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [url]);
  if (!url || broken) return <span className="inventory-row-thumb"><span /></span>;
  return <span className="inventory-row-thumb"><img src={url} alt="" loading="lazy" onError={() => setBroken(true)} /></span>;
}

export function InventoryPage({ devices, consultationMode, onProfile, onRefreshDevices }: {
  devices: Device[];
  consultationMode: boolean;
  onProfile?: (device: Device) => void;
  onRefreshDevices?: () => Promise<unknown> | void;
}) {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [form, setForm] = useState<Partial<InventoryItem>>(EMPTY_FORM);
  const [editing, setEditing] = useState<InventoryItem | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [segment, setSegment] = useState<Segment>('todo');
  const [claseFilter, setClaseFilter] = useState('');
  const [condicionFilter, setCondicionFilter] = useState('');
  const [sort, setSort] = useState<'name' | 'condition' | 'life'>('name');
  const [busy, setBusy] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const refresh = () => getInventoryItems()
    .then(response => setItems(response.items))
    .catch(error => setError(error instanceof Error ? error.message : 'No se pudo cargar el inventario.'));

  useEffect(() => { refresh(); }, []);

  const entries = useMemo<Entry[]>(() => {
    const fromDevices: Entry[] = devices.map(device => ({
      key: `d:${device.etiqueta}`,
      kind: 'equipo',
      nombre: device.aliasOperativo || device.etiqueta,
      detalle: [device.etiqueta, device.marca, device.modelo].filter(Boolean).join(' · '),
      clase: device.assetClass || device.categoria || 'Otro',
      condicion: device.condition || '',
      cantidad: null,
      unidad: '',
      bajoStock: false,
      imagenUrl: '',
      vidaPct: device.vidaConsumidaPct ?? null,
      vencido: Boolean(device.vencido),
      renovacion: device.fechaRenovacion || '',
      device
    }));
    const fromItems: Entry[] = items.map(item => ({
      key: `i:${item.id}`,
      kind: 'recurso',
      nombre: item.nombre,
      detalle: item.observaciones || '',
      clase: item.categoria || 'Otro',
      condicion: item.condicion || '',
      cantidad: Number(item.cantidad || 0),
      unidad: item.unidad || 'unidades',
      bajoStock: Boolean(item.bajoStock),
      imagenUrl: item.imagenUrl || '',
      vidaPct: null,
      vencido: false,
      renovacion: '',
      item
    }));
    return [...fromDevices, ...fromItems];
  }, [devices, items]);

  const clases = useMemo(() => {
    const set = new Set(entries.map(entry => entry.clase).filter(Boolean));
    return [...set].sort((a, b) => a.localeCompare(b, 'es'));
  }, [entries]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return entries
      .filter(entry => segment === 'todo' || entry.kind === segment)
      .filter(entry => !claseFilter || entry.clase === claseFilter)
      .filter(entry => !condicionFilter || (condicionFilter === 'Sin revisar' ? !entry.condicion : entry.condicion === condicionFilter))
      .filter(entry => !needle || [entry.nombre, entry.detalle, entry.clase, entry.condicion].some(value => String(value || '').toLowerCase().includes(needle)))
      .sort((a, b) => {
        if (sort === 'condition') {
          const rank = (value: string) => (value ? CONDITION_VALUES.indexOf(value as never) : 99);
          const diff = rank(b.condicion) - rank(a.condicion);
          if (diff) return diff;
        }
        if (sort === 'life') {
          const diff = (b.vidaPct ?? -1) - (a.vidaPct ?? -1);
          if (diff) return diff;
        }
        return a.nombre.localeCompare(b.nombre, 'es');
      });
  }, [entries, search, segment, claseFilter, condicionFilter, sort]);

  const kpis = useMemo(() => {
    const equipos = entries.filter(entry => entry.kind === 'equipo');
    const recursos = entries.filter(entry => entry.kind === 'recurso');
    const revisados = entries.filter(entry => entry.condicion).length;
    return {
      equipos: equipos.length,
      recursos: recursos.length,
      malos: entries.filter(entry => entry.condicion === 'Regular' || entry.condicion === 'Malo').length,
      vencidos: equipos.filter(entry => entry.vencido).length,
      bajoStock: recursos.filter(entry => entry.bajoStock).length,
      cobertura: entries.length ? Math.round((revisados / entries.length) * 100) : 0
    };
  }, [entries]);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setError('');
    setModalOpen(true);
  };

  const openEdit = (item: InventoryItem) => {
    setEditing(item);
    setForm({
      nombre: item.nombre,
      categoria: item.categoria,
      cantidad: item.cantidad,
      unidad: item.unidad,
      imagenUrl: item.imagenUrl || '',
      condicion: item.condicion || '',
      minStock: item.minStock ?? 3,
      observaciones: item.observaciones || ''
    });
    setError('');
    setModalOpen(true);
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.nombre?.trim()) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      if (editing) await updateInventoryItem(editing.id, form);
      else await createInventoryItem(form);
      setModalOpen(false);
      setEditing(null);
      setForm(EMPTY_FORM);
      setMessage(editing ? 'Recurso actualizado.' : 'Recurso agregado.');
      await refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'No se pudo guardar el ítem.');
    } finally {
      setBusy(false);
    }
  };

  const hideItem = async (item: InventoryItem) => {
    if (!window.confirm(`¿Ocultar ${item.nombre}?`)) return;
    setError('');
    setMessage('');
    try {
      await deleteInventoryItem(item.id);
      setMessage('Recurso ocultado.');
      await refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'No se pudo ocultar el recurso.');
    }
  };

  // Cambiar la condición de un equipo desde acá escribe en device_metadata,
  // que es la tabla que sobrevive la reimportación del padrón.
  const setDeviceCondition = async (entry: Entry, condicion: string) => {
    if (!entry.device) return;
    setError('');
    try {
      await updateDeviceMetadata(entry.device.etiqueta, {
        condition: condicion,
        assetClass: entry.clase,
        origen: 'Inventario'
      });
      await onRefreshDevices?.();
      setMessage(`${entry.nombre}: ${condicion || 'sin revisar'}.`);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'No se pudo guardar la condición.');
    }
  };

  const exportCsv = () => {
    const headers = ['Tipo', 'Nombre', 'Detalle', 'Clase', 'Condición', 'Cantidad', 'Unidad', 'Vida consumida %', 'Renovación'];
    const rows = filtered.map(entry => [
      entry.kind === 'equipo' ? 'Equipo' : 'Recurso',
      entry.nombre,
      entry.detalle,
      entry.clase,
      entry.condicion || 'Sin revisar',
      entry.cantidad ?? '',
      entry.unidad,
      entry.vidaPct ?? '',
      entry.renovacion
    ]);
    downloadCsv(`inventario-${new Date().toISOString().slice(0, 10)}.csv`, headers, rows);
  };

  const exportExample = () => {
    const headers = ['Nombre', 'Cantidad', 'Categoría', 'Unidad', 'Condición', 'Stock mínimo', 'Observaciones', 'Imagen URL'];
    const rows = [
      ['LEDs', 100, 'Componentes', 'unidades', 'Bueno', 10, 'Stock general', ''],
      ['Resistencias', 200, 'Componentes', 'unidades', 'Bueno', 20, 'Valores surtidos', ''],
      ['Sensores de distancia', 34, 'Sensores', 'unidades', 'Regular', 5, 'HC-SR04', '']
    ];
    downloadCsv('plantilla-inventario-tic.csv', headers, rows);
  };

  const handleImportFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const csvText = await readFileAsText(file);
      const result = await importInventoryCsv(csvText);
      const preserved = [
        result.preservedImages ? `${result.preservedImages} fotos` : '',
        result.preservedConditions ? `${result.preservedConditions} condiciones` : ''
      ].filter(Boolean).join(' y ');
      setMessage(`Importación finalizada: ${result.read} leídos, ${result.created} nuevos, ${result.updated} actualizados${preserved ? `, ${preserved} conservadas` : ''}, ${result.skipped} omitidos, ${result.errors.length} errores.`);
      await refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'No se pudo importar el inventario.');
    } finally {
      setBusy(false);
    }
  };

  const handleImageFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    setUploadingImage(true);
    setError('');
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const response = await uploadInventoryImage({ fileName: file.name, dataUrl });
      setForm(current => ({ ...current, imagenUrl: response.url }));
    } catch (error) {
      setError(error instanceof Error ? error.message : 'No se pudo subir la imagen.');
    } finally {
      setUploadingImage(false);
    }
  };

  return (
    <section className="view active inventory-page">
      <div className="inventory-hero">
        <div>
          <h3>Inventario</h3>
          <p>Equipos y recursos de la sede, con su condición y vida útil estimada.</p>
        </div>
        <div className="actions">
          <Button onClick={exportCsv}>Exportar CSV</Button>
          <Button onClick={exportExample}>Plantilla</Button>
          <Button disabled={consultationMode || busy} onClick={() => importInputRef.current?.click()}>Importar CSV</Button>
          <Button disabled={consultationMode} onClick={() => setReviewOpen(true)}>Comenzar revisión de condición</Button>
          <Button variant="primary" disabled={consultationMode} onClick={openCreate}>Agregar recurso</Button>
          <input ref={importInputRef} type="file" accept=".csv,text/csv" className="sr-only" onChange={handleImportFile} />
        </div>
      </div>

      <div className="inventory-kpis">
        <div><span>Equipos</span><strong>{kpis.equipos}</strong></div>
        <div><span>Recursos</span><strong>{kpis.recursos}</strong></div>
        <div className={kpis.malos ? 'is-warn' : ''}><span>Regular o malo</span><strong>{kpis.malos}</strong></div>
        <div className={kpis.vencidos ? 'is-bad' : ''}><span>Vida útil vencida</span><strong>{kpis.vencidos}</strong></div>
        <div className={kpis.bajoStock ? 'is-warn' : ''}><span>Bajo stock</span><strong>{kpis.bajoStock}</strong></div>
        <div><span>Revisado</span><strong>{kpis.cobertura}%</strong></div>
      </div>

      {message && <div className="tool-info">{message}</div>}
      {error && <div className="tool-error">{error}</div>}

      <section className="card inventory-list-card">
        <div className="inventory-toolbar">
          <div className="inventory-segmented" role="group" aria-label="Tipo de activo">
            <button type="button" className={segment === 'todo' ? 'is-active' : ''} onClick={() => setSegment('todo')}>Todo</button>
            <button type="button" className={segment === 'equipo' ? 'is-active' : ''} onClick={() => setSegment('equipo')}>Equipos</button>
            <button type="button" className={segment === 'recurso' ? 'is-active' : ''} onClick={() => setSegment('recurso')}>Recursos</button>
          </div>
          <input className="input" type="search" placeholder="Buscar por nombre, etiqueta o clase" value={search} onChange={event => setSearch(event.target.value)} />
          <select className="input" value={claseFilter} onChange={event => setClaseFilter(event.target.value)}>
            <option value="">Todas las clases</option>
            {clases.map(clase => <option key={clase} value={clase}>{clase}</option>)}
          </select>
          <select className="input" value={condicionFilter} onChange={event => setCondicionFilter(event.target.value)}>
            <option value="">Toda condición</option>
            {CONDITION_VALUES.map(value => <option key={value} value={value}>{value}</option>)}
            <option value="Sin revisar">Sin revisar</option>
          </select>
          <select className="input" value={sort} onChange={event => setSort(event.target.value as typeof sort)}>
            <option value="name">Nombre</option>
            <option value="condition">Peor condición</option>
            <option value="life">Más vida consumida</option>
          </select>
        </div>

        <div className="inventory-rows-head">
          <span />
          <span>Nombre</span>
          <span>Clase</span>
          <span>Condición</span>
          <span>Vida / stock</span>
          <span>Acciones</span>
        </div>

        <div className="inventory-rows">
          {filtered.map(entry => (
            <div className="inventory-row" key={entry.key}>
              <RowThumb url={entry.imagenUrl} />
              <div className="inventory-row-name">
                {entry.device && onProfile
                  ? <button type="button" onClick={() => onProfile(entry.device as Device)}>{entry.nombre}</button>
                  : <strong>{entry.nombre}</strong>}
                {entry.detalle && <span>{entry.detalle}</span>}
              </div>
              <span className="inventory-row-class">{entry.clase}</span>
              <ConditionCell condicion={entry.condicion} />
              {entry.kind === 'equipo' ? (
                <span className={`inventory-row-life ${entry.vencido ? 'is-over' : (entry.vidaPct ?? 0) >= 80 ? 'is-due' : ''}`}>
                  {entry.vidaPct === null ? '—' : entry.vencido ? 'Vencida' : `${entry.vidaPct}%`}
                </span>
              ) : (
                <span className={`inventory-row-qty ${entry.bajoStock ? 'is-low' : ''}`}>
                  {entry.cantidad}<small>{entry.unidad}</small>
                </span>
              )}
              <div className="inventory-row-actions">
                {entry.kind === 'equipo' ? (
                  <select
                    className="input"
                    style={{ height: 30, fontSize: 12, width: 'auto' }}
                    value={entry.condicion}
                    disabled={consultationMode}
                    onChange={event => void setDeviceCondition(entry, event.target.value)}
                    aria-label={`Condición de ${entry.nombre}`}
                  >
                    <option value="">Sin revisar</option>
                    {CONDITION_VALUES.map(value => <option key={value} value={value}>{value}</option>)}
                  </select>
                ) : (
                  <>
                    <button type="button" onClick={() => entry.item && openEdit(entry.item)} disabled={consultationMode}>Editar</button>
                    <button type="button" onClick={() => entry.item && hideItem(entry.item)} disabled={consultationMode}>Ocultar</button>
                  </>
                )}
              </div>
            </div>
          ))}
          {!filtered.length && <div className="inventory-empty">No hay nada para este filtro.</div>}
        </div>
      </section>

      {reviewOpen && (
        <ConditionReviewModal
          items={items}
          onClose={() => setReviewOpen(false)}
          onDone={async () => {
            await onRefreshDevices?.();
            await refresh();
          }}
        />
      )}

      {modalOpen && (
        <Modal title={editing ? 'Editar recurso' : 'Agregar recurso'} onClose={() => !busy && setModalOpen(false)}>
          <form className="inventory-form" onSubmit={save}>
            <label>Nombre<input className="input" required value={form.nombre || ''} onChange={event => setForm(current => ({ ...current, nombre: event.target.value }))} /></label>
            <div className="grid-2">
              <label>Categoría
                <select className="input" value={form.categoria || 'Otro'} onChange={event => setForm(current => ({ ...current, categoria: event.target.value }))}>
                  {[...new Set([...FORM_CATEGORIES, ...clases])].sort((a, b) => a.localeCompare(b, 'es')).map(item => <option key={item}>{item}</option>)}
                </select>
              </label>
              <label>Condición
                <select className="input" value={form.condicion || ''} onChange={event => setForm(current => ({ ...current, condicion: event.target.value }))}>
                  <option value="">Sin revisar</option>
                  {CONDITION_VALUES.map(item => <option key={item} value={item}>{item}</option>)}
                </select>
              </label>
            </div>
            <div className="grid-2">
              <label>Cantidad<input className="input" type="number" min="0" value={form.cantidad ?? 0} onChange={event => setForm(current => ({ ...current, cantidad: Number(event.target.value) }))} /></label>
              <label>Unidad<input className="input" value={form.unidad || ''} onChange={event => setForm(current => ({ ...current, unidad: event.target.value }))} /></label>
            </div>
            <label>Stock mínimo<input className="input" type="number" min="0" value={form.minStock ?? 3} onChange={event => setForm(current => ({ ...current, minStock: Number(event.target.value) }))} /></label>
            <div className="form-field">
              <span className="field-label">Imagen o URL de imagen</span>
              <div className="inventory-image-field">
                <input className="input" value={form.imagenUrl || ''} onChange={event => setForm(current => ({ ...current, imagenUrl: event.target.value }))} placeholder="https://... o /uploads/..." />
                <label className="btn btn-secondary inventory-upload-button">
                  {uploadingImage ? 'Subiendo...' : 'Subir foto'}
                  <input type="file" accept="image/png,image/jpeg,image/jpg,image/webp" onChange={handleImageFile} disabled={uploadingImage || consultationMode} />
                </label>
              </div>
            </div>
            <label>Observaciones<textarea className="input" rows={3} value={form.observaciones || ''} onChange={event => setForm(current => ({ ...current, observaciones: event.target.value }))} /></label>
            {error && <div className="tool-error">{error}</div>}
            <div className="actions modal-actions-sticky">
              <Button type="button" onClick={() => setModalOpen(false)} disabled={busy}>Cancelar</Button>
              <Button variant="primary" type="submit" disabled={busy || uploadingImage || consultationMode}>{busy ? 'Guardando...' : editing ? 'Guardar cambios' : 'Agregar recurso'}</Button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}

function downloadCsv(fileName: string, headers: string[], rows: unknown[][]) {
  const blob = new Blob([[headers, ...rows].map(row => row.map(csvCell).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

function readFileAsText(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('No se pudo leer el archivo.'));
    reader.readAsText(file);
  });
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('No se pudo leer la imagen.'));
    reader.readAsDataURL(file);
  });
}
