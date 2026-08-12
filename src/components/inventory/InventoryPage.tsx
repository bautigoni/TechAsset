import { useEffect, useMemo, useRef, useState } from 'react';
import type { Device, InventoryItem } from '../../types';
import { CONDITION_VALUES } from '../../types';
import { createInventoryItem, deleteInventoryItem, getInventoryItems, importInventoryCsv, updateInventoryItem, uploadInventoryImage } from '../../services/inventoryApi';
import { updateDeviceMetadata } from '../../services/devicesApi';
import { csvCell } from '../../utils/formatters';
import { Button } from '../layout/Button';
import { Modal } from '../layout/Modal';
import { ConditionReviewModal } from './ConditionReviewModal';
import { InventoryCard } from './InventoryCard';
import { deviceToEntry, groupEntries, itemToEntry, type Entry } from './inventoryEntries';

type Segment = 'todo' | 'equipo' | 'recurso';

const FORM_CATEGORIES = ['Arduino', 'Robótica', 'Electrónica', 'Sensores', 'Cables', 'Cargadores', 'Componentes', 'Herramientas', 'Filamento 3D', 'Otro'];
const EMPTY_FORM: Partial<InventoryItem> = {
  nombre: '',
  categoria: 'Otro',
  subcategoria: '',
  cantidad: 1,
  unidad: 'unidades',
  imagenUrl: '',
  condicion: '',
  minStock: 3,
  observaciones: ''
};

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
  const [detail, setDetail] = useState<Entry | null>(null);
  const [search, setSearch] = useState('');
  const [segment, setSegment] = useState<Segment>('recurso');
  const [condicionFilter, setCondicionFilter] = useState('');
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const refresh = () => getInventoryItems()
    .then(response => setItems(response.items))
    .catch(error => setError(error instanceof Error ? error.message : 'No se pudo cargar el inventario.'));

  useEffect(() => { refresh(); }, []);

  const entries = useMemo<Entry[]>(
    () => [...devices.map(deviceToEntry), ...items.map(itemToEntry)],
    [devices, items]
  );

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return entries
      .filter(entry => segment === 'todo' || entry.kind === segment)
      .filter(entry => !condicionFilter || (condicionFilter === 'Sin revisar' ? !entry.condicion : entry.condicion === condicionFilter))
      .filter(entry => !needle || [entry.nombre, entry.detalle, entry.categoria, entry.subcategoria, entry.condicion]
        .some(value => String(value || '').toLowerCase().includes(needle)));
  }, [entries, search, segment, condicionFilter]);

  const groups = useMemo(() => groupEntries(filtered), [filtered]);

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
      sinFoto: recursos.filter(entry => !entry.imagenUrl).length,
      cobertura: entries.length ? Math.round((revisados / entries.length) * 100) : 0
    };
  }, [entries]);

  const categorias = useMemo(() => {
    const set = new Set([...FORM_CATEGORIES, ...items.map(item => item.categoria).filter(Boolean)]);
    return [...set].sort((a, b) => a.localeCompare(b, 'es'));
  }, [items]);

  const subcategorias = useMemo(() => {
    const set = new Set(items.filter(item => item.categoria === form.categoria).map(item => item.subcategoria).filter(Boolean));
    return [...set].sort((a, b) => String(a).localeCompare(String(b), 'es'));
  }, [items, form.categoria]);

  const toggleGroup = (categoria: string) => {
    setCollapsed(current => current.includes(categoria) ? current.filter(item => item !== categoria) : [...current, categoria]);
  };

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
      subcategoria: item.subcategoria || '',
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
    if (!form.imagenUrl?.trim()) {
      setError('Subí una foto del recurso: es obligatoria.');
      return;
    }
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
    try {
      await deleteInventoryItem(item.id);
      setMessage('Recurso ocultado.');
      setDetail(null);
      await refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'No se pudo ocultar el recurso.');
    }
  };

  const setEntryCondition = async (entry: Entry, condicion: string) => {
    setError('');
    try {
      if (entry.device) {
        await updateDeviceMetadata(entry.device.etiqueta, { condition: condicion, assetClass: entry.categoria, origen: 'Inventario' });
        await onRefreshDevices?.();
      } else if (entry.item) {
        await updateInventoryItem(entry.item.id, { condicion });
        await refresh();
      }
      setMessage(`${entry.nombre}: ${condicion || 'sin revisar'}.`);
      setDetail(current => current && current.key === entry.key ? { ...current, condicion } : current);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'No se pudo guardar la condición.');
    }
  };

  const exportCsv = () => {
    const headers = ['Tipo', 'Nombre', 'Categoría', 'Subcategoría', 'Condición', 'Cantidad', 'Unidad', 'Vida consumida %', 'Renovación'];
    const rows = filtered.map(entry => [
      entry.kind === 'equipo' ? 'Equipo' : 'Recurso',
      entry.nombre, entry.categoria, entry.subcategoria, entry.condicion || 'Sin revisar',
      entry.cantidad ?? '', entry.unidad, entry.vidaPct ?? '', entry.renovacion
    ]);
    downloadCsv(`inventario-${new Date().toISOString().slice(0, 10)}.csv`, headers, rows);
  };

  const exportExample = () => {
    downloadCsv('plantilla-inventario-tic.csv',
      ['Nombre', 'Cantidad', 'Categoría', 'Subcategoría', 'Unidad', 'Condición', 'Stock mínimo', 'Observaciones', 'Imagen URL'],
      [
        ['LEDs', 100, 'Componentes', 'Diodos', 'unidades', 'Bueno', 10, 'Stock general', ''],
        ['Sensores de distancia', 34, 'Sensores', 'Ultrasonido', 'unidades', 'Regular', 5, 'HC-SR04', '']
      ]);
  };

  const handleImportFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await importInventoryCsv(await readFileAsText(file));
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
      const response = await uploadInventoryImage({ fileName: file.name, dataUrl: await readFileAsDataUrl(file) });
      setForm(current => ({ ...current, imagenUrl: response.url }));
    } catch (error) {
      setError(error instanceof Error ? error.message : 'No se pudo subir la imagen.');
    } finally {
      setUploadingImage(false);
    }
  };

  return (
    <section className="view active inventory-page">
      <header className="inv-head">
        <div>
          <h3>Inventario</h3>
          <p>Equipos y recursos de la sede, con su condición y vida útil estimada.</p>
        </div>
        <div className="inv-head-actions">
          <Button disabled={consultationMode} onClick={() => setReviewOpen(true)}>Revisar condición</Button>
          <div className="inv-menu">
            <details>
              <summary>Importar / exportar</summary>
              <div>
                <button type="button" onClick={exportCsv}>Exportar CSV</button>
                <button type="button" onClick={exportExample}>Descargar plantilla</button>
                <button type="button" disabled={consultationMode || busy} onClick={() => importInputRef.current?.click()}>Importar CSV</button>
              </div>
            </details>
          </div>
          <Button variant="primary" disabled={consultationMode} onClick={openCreate}>Agregar recurso</Button>
          <input ref={importInputRef} type="file" accept=".csv,text/csv" className="sr-only" onChange={handleImportFile} />
        </div>
      </header>

      <div className="inv-kpis">
        <div><span>Equipos</span><strong>{kpis.equipos}</strong></div>
        <div><span>Recursos</span><strong>{kpis.recursos}</strong></div>
        <div className={kpis.malos ? 'is-warn' : ''}><span>Regular o malo</span><strong>{kpis.malos}</strong></div>
        <div className={kpis.vencidos ? 'is-bad' : ''}><span>Vida útil vencida</span><strong>{kpis.vencidos}</strong></div>
        <div className={kpis.bajoStock ? 'is-warn' : ''}><span>Bajo stock</span><strong>{kpis.bajoStock}</strong></div>
        <div className={kpis.sinFoto ? 'is-warn' : ''}><span>Sin foto</span><strong>{kpis.sinFoto}</strong></div>
        <div><span>Revisado</span><strong>{kpis.cobertura}%</strong></div>
      </div>

      {message && <div className="tool-info">{message}</div>}
      {error && <div className="tool-error">{error}</div>}

      <div className="inv-toolbar">
        <div className="inventory-segmented" role="group" aria-label="Tipo de activo">
          <button type="button" className={segment === 'recurso' ? 'is-active' : ''} onClick={() => setSegment('recurso')}>Recursos</button>
          <button type="button" className={segment === 'equipo' ? 'is-active' : ''} onClick={() => setSegment('equipo')}>Equipos</button>
          <button type="button" className={segment === 'todo' ? 'is-active' : ''} onClick={() => setSegment('todo')}>Todo</button>
        </div>
        <input className="input" type="search" placeholder="Buscar por nombre, categoría o etiqueta" value={search} onChange={event => setSearch(event.target.value)} />
        <select className="input" value={condicionFilter} onChange={event => setCondicionFilter(event.target.value)}>
          <option value="">Toda condición</option>
          {CONDITION_VALUES.map(value => <option key={value} value={value}>{value}</option>)}
          <option value="Sin revisar">Sin revisar</option>
        </select>
      </div>

      {groups.map(group => {
        const isCollapsed = collapsed.includes(group.categoria);
        return (
          <section className="inv-group" key={group.categoria}>
            <button type="button" className="inv-group-head" onClick={() => toggleGroup(group.categoria)} aria-expanded={!isCollapsed}>
              <h4>{group.categoria}</h4>
              <span>{group.total}</span>
              <i className={isCollapsed ? 'is-collapsed' : ''} aria-hidden="true" />
            </button>
            {!isCollapsed && group.subgroups.map(sub => (
              <div className="inv-sub" key={sub.subcategoria || '_'}>
                {sub.subcategoria && <h5>{sub.subcategoria} <span>{sub.entries.length}</span></h5>}
                <div className="inv-grid">
                  {sub.entries.map(entry => (
                    <InventoryCard key={entry.key} entry={entry} onOpen={() => setDetail(entry)} />
                  ))}
                </div>
              </div>
            ))}
          </section>
        );
      })}

      {!groups.length && <div className="inventory-empty">No hay nada para este filtro.</div>}

      {detail && (
        <Modal title={detail.nombre} onClose={() => setDetail(null)}>
          <div className="inv-detail">
            {detail.imagenUrl && <div className="inv-detail-media"><img src={detail.imagenUrl} alt="" /></div>}
            <dl>
              <div><dt>Categoría</dt><dd>{detail.categoria}</dd></div>
              {detail.subcategoria && <div><dt>Subcategoría</dt><dd>{detail.subcategoria}</dd></div>}
              {detail.detalle && <div><dt>Detalle</dt><dd>{detail.detalle}</dd></div>}
              {detail.kind === 'recurso'
                ? <div><dt>Stock</dt><dd>{detail.cantidad} {detail.unidad}</dd></div>
                : <div><dt>Vida útil</dt><dd>{detail.vidaPct === null ? '—' : detail.vencido ? `Vencida (${detail.renovacion})` : `${detail.vidaPct}% · renueva ${detail.renovacion}`}</dd></div>}
            </dl>
            <label>Condición
              <select className="input" value={detail.condicion} disabled={consultationMode} onChange={event => void setEntryCondition(detail, event.target.value)}>
                <option value="">Sin revisar</option>
                {CONDITION_VALUES.map(value => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
            <div className="actions">
              {detail.device && onProfile && <Button onClick={() => { onProfile(detail.device as Device); setDetail(null); }}>Ver ficha completa</Button>}
              {detail.item && <Button disabled={consultationMode} onClick={() => { openEdit(detail.item as InventoryItem); setDetail(null); }}>Editar</Button>}
              {detail.item && <Button disabled={consultationMode} onClick={() => void hideItem(detail.item as InventoryItem)}>Ocultar</Button>}
            </div>
          </div>
        </Modal>
      )}

      {reviewOpen && (
        <ConditionReviewModal
          items={items}
          onClose={() => setReviewOpen(false)}
          onDone={async () => { await onRefreshDevices?.(); await refresh(); }}
        />
      )}

      {modalOpen && (
        <Modal title={editing ? 'Editar recurso' : 'Agregar recurso'} onClose={() => !busy && setModalOpen(false)}>
          <form className="inventory-form" onSubmit={save}>
            <div className="form-field">
              <span className="field-label">Foto del recurso <em>obligatoria</em></span>
              <div className={`inv-photo-drop ${form.imagenUrl ? 'has-photo' : ''}`}>
                {form.imagenUrl
                  ? <img src={form.imagenUrl} alt="" />
                  : <span>Sin foto todavía</span>}
                <label className="btn btn-secondary">
                  {uploadingImage ? 'Subiendo...' : form.imagenUrl ? 'Cambiar foto' : 'Subir foto'}
                  <input type="file" accept="image/png,image/jpeg,image/jpg,image/webp" onChange={handleImageFile} disabled={uploadingImage || consultationMode} />
                </label>
              </div>
            </div>
            <label>Nombre<input className="input" required value={form.nombre || ''} onChange={event => setForm(current => ({ ...current, nombre: event.target.value }))} /></label>
            <div className="grid-2">
              <label>Categoría
                <select className="input" value={form.categoria || 'Otro'} onChange={event => setForm(current => ({ ...current, categoria: event.target.value }))}>
                  {categorias.map(item => <option key={item}>{item}</option>)}
                </select>
              </label>
              <label>Subcategoría
                <input className="input" list="inv-subcats" placeholder="Opcional" value={form.subcategoria || ''} onChange={event => setForm(current => ({ ...current, subcategoria: event.target.value }))} />
                <datalist id="inv-subcats">{subcategorias.map(item => <option key={item} value={item} />)}</datalist>
              </label>
            </div>
            <div className="grid-2">
              <label>Cantidad<input className="input" type="number" min="0" value={form.cantidad ?? 0} onChange={event => setForm(current => ({ ...current, cantidad: Number(event.target.value) }))} /></label>
              <label>Unidad<input className="input" value={form.unidad || ''} onChange={event => setForm(current => ({ ...current, unidad: event.target.value }))} /></label>
            </div>
            <div className="grid-2">
              <label>Stock mínimo<input className="input" type="number" min="0" value={form.minStock ?? 3} onChange={event => setForm(current => ({ ...current, minStock: Number(event.target.value) }))} /></label>
              <label>Condición
                <select className="input" value={form.condicion || ''} onChange={event => setForm(current => ({ ...current, condicion: event.target.value }))}>
                  <option value="">Sin revisar</option>
                  {CONDITION_VALUES.map(item => <option key={item} value={item}>{item}</option>)}
                </select>
              </label>
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
