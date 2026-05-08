import { useEffect, useMemo, useState } from 'react';
import type { InventoryItem } from '../../types';
import { createInventoryItem, deleteInventoryItem, getInventoryItems, updateInventoryItem } from '../../services/inventoryApi';
import { csvCell } from '../../utils/formatters';
import { Button } from '../layout/Button';
import { Modal } from '../layout/Modal';

const CATEGORIES = ['Arduino', 'Robótica', 'Electrónica', 'Sensores', 'Cables', 'Cargadores', 'Componentes', 'Herramientas', 'Otro'];
const STATES = ['', 'Operativo', 'Revisar', 'Incompleto', 'Bajo stock', 'No disponible'];
const EMPTY_FORM: Partial<InventoryItem> = {
  nombre: '',
  categoria: 'Otro',
  cantidad: 1,
  unidad: 'unidades',
  imagenUrl: '',
  estado: 'Operativo',
  observaciones: ''
};

export function InventoryPage({ consultationMode }: { consultationMode: boolean }) {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [form, setForm] = useState<Partial<InventoryItem>>(EMPTY_FORM);
  const [editing, setEditing] = useState<InventoryItem | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('Todas');
  const [sort, setSort] = useState<'name' | 'quantity'>('name');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const refresh = () => getInventoryItems()
    .then(response => setItems(response.items))
    .catch(error => setError(error instanceof Error ? error.message : 'No se pudo cargar el inventario.'));

  useEffect(() => { refresh(); }, []);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return items
      .filter(item => category === 'Todas' || item.categoria === category)
      .filter(item => !needle || [item.nombre, item.categoria, item.estado, item.observaciones].some(value => String(value || '').toLowerCase().includes(needle)))
      .sort((a, b) => sort === 'quantity' ? b.cantidad - a.cantidad : a.nombre.localeCompare(b.nombre, 'es'));
  }, [category, items, search, sort]);

  const totalUnits = items.reduce((acc, item) => acc + Number(item.cantidad || 0), 0);
  const lowStock = items.filter(item => Number(item.cantidad || 0) <= 3).length;

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
      estado: item.estado || 'Operativo',
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

  const exportCsv = () => {
    const headers = ['nombre', 'categoria', 'cantidad', 'unidad', 'estado', 'observaciones', 'imagen_url'];
    const rows = filtered.map(item => [item.nombre, item.categoria, item.cantidad, item.unidad, item.estado || '', item.observaciones || '', item.imagenUrl || '']);
    const blob = new Blob([[headers, ...rows].map(row => row.map(csvCell).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `inventario-tic-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="view active inventory-page">
      <div className="inventory-hero">
        <div>
          <h3>Inventario TIC</h3>
          <p>Recursos Maker, placas, sensores, cables, cargadores y materiales por sede.</p>
        </div>
        <div className="actions">
          <Button onClick={exportCsv}>Exportar CSV</Button>
          <Button variant="primary" disabled={consultationMode} onClick={openCreate}>Agregar recurso</Button>
        </div>
      </div>

      <div className="inventory-kpis">
        <div><span>Ítems activos</span><strong>{items.length}</strong></div>
        <div><span>Unidades</span><strong>{totalUnits}</strong></div>
        <div><span>Categorías</span><strong>{new Set(items.map(item => item.categoria)).size}</strong></div>
        <div><span>Bajo stock</span><strong>{lowStock}</strong></div>
      </div>

      <section className="card inventory-list-card">
        <div className="inventory-toolbar">
          <input className="input" type="search" placeholder="Buscar recurso, estado u observación" value={search} onChange={event => setSearch(event.target.value)} />
          <select className="input" value={category} onChange={event => setCategory(event.target.value)}>
            <option>Todas</option>
            {CATEGORIES.map(item => <option key={item}>{item}</option>)}
          </select>
          <select className="input" value={sort} onChange={event => setSort(event.target.value as 'name' | 'quantity')}>
            <option value="name">Ordenar por nombre</option>
            <option value="quantity">Ordenar por cantidad</option>
          </select>
        </div>
        {message && <div className="tool-info">{message}</div>}
        {error && <div className="tool-error">{error}</div>}
        <div className="inventory-grid">
          {filtered.map(item => (
            <article className="inventory-item-card" key={item.id}>
              <div className="inventory-thumb">
                {item.imagenUrl ? <img src={item.imagenUrl} alt="" /> : <span>{item.nombre.slice(0, 2).toUpperCase()}</span>}
              </div>
              <div className="inventory-item-main">
                <div>
                  <strong>{item.nombre}</strong>
                  <span>{item.categoria}</span>
                </div>
                {item.estado && <em>{item.estado}</em>}
              </div>
              <div className="inventory-qty"><strong>{item.cantidad}</strong><span>{item.unidad}</span></div>
              {item.observaciones && <p>{item.observaciones}</p>}
              <div className="small-actions">
                <button type="button" onClick={() => openEdit(item)} disabled={consultationMode}>Editar</button>
                <button type="button" onClick={() => hideItem(item)} disabled={consultationMode}>Ocultar</button>
              </div>
            </article>
          ))}
          {!filtered.length && <div className="empty-state">No hay recursos para este filtro.</div>}
        </div>
      </section>

      {modalOpen && (
        <Modal title={editing ? 'Editar recurso' : 'Agregar recurso'} onClose={() => !busy && setModalOpen(false)}>
          <form className="inventory-form" onSubmit={save}>
            <label>Imagen o URL de imagen<input className="input" value={form.imagenUrl || ''} onChange={event => setForm(current => ({ ...current, imagenUrl: event.target.value }))} placeholder="https://..." /></label>
            <label>Nombre<input className="input" required value={form.nombre || ''} onChange={event => setForm(current => ({ ...current, nombre: event.target.value }))} /></label>
            <div className="grid-2">
              <label>Categoría
                <select className="input" value={form.categoria || 'Otro'} onChange={event => setForm(current => ({ ...current, categoria: event.target.value }))}>
                  {CATEGORIES.map(item => <option key={item}>{item}</option>)}
                </select>
              </label>
              <label>Cantidad<input className="input" type="number" min="0" value={form.cantidad ?? 0} onChange={event => setForm(current => ({ ...current, cantidad: Number(event.target.value) }))} /></label>
            </div>
            <div className="grid-2">
              <label>Unidad<input className="input" value={form.unidad || ''} onChange={event => setForm(current => ({ ...current, unidad: event.target.value }))} /></label>
              <label>Estado
                <select className="input" value={form.estado || ''} onChange={event => setForm(current => ({ ...current, estado: event.target.value }))}>
                  {STATES.map(item => <option key={item} value={item}>{item || 'Sin estado'}</option>)}
                </select>
              </label>
            </div>
            <label>Observaciones<textarea className="input" rows={4} value={form.observaciones || ''} onChange={event => setForm(current => ({ ...current, observaciones: event.target.value }))} /></label>
            {error && <div className="tool-error">{error}</div>}
            <div className="actions modal-actions-sticky">
              <Button type="button" onClick={() => setModalOpen(false)} disabled={busy}>Cancelar</Button>
              <Button variant="primary" type="submit" disabled={busy || consultationMode}>{busy ? 'Guardando...' : editing ? 'Guardar cambios' : 'Agregar recurso'}</Button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}
