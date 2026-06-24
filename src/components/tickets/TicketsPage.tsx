import { useEffect, useMemo, useState } from 'react';
import type { Ticket, TicketState } from '../../types';
import { createTicket, deleteTicket, getTickets, updateTicket, uploadTicketImage } from '../../services/ticketsApi';
import { getSiteSettings } from '../../services/authApi';
import { Button } from '../layout/Button';
import { Modal } from '../layout/Modal';

const ESTADOS: TicketState[] = ['No hecho', 'En proceso', 'Hecho'];
const DEFAULT_INVGATE = 'https://techasset.bauhub.online/requests/show/index/id/';

const ESTADO_BADGE: Record<TicketState, string> = {
  'No hecho': 'badge off',
  'En proceso': 'badge loaned',
  'Hecho': 'badge available'
};

type Draft = Partial<Ticket>;
const EMPTY: Draft = { numero: '', estado: 'No hecho', imagenUrl: '' };

const isPdf = (url?: string) => /\.pdf($|\?)/i.test(String(url || ''));
// A1: el número de InVgate es solo dígitos (strippeamos el '#' o cualquier otra cosa).
const normalizeNumero = (value: unknown) => String(value ?? '').replace(/\D+/g, '');

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('No se pudo leer el archivo.'));
    reader.readAsDataURL(file);
  });
}

// A4: preview compacto. PDF -> thumbnail + "Ver PDF" que abre modal con el embed.
function FilePreview({ url, compact = false }: { url: string; compact?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  if (!url) return null;

  if (isPdf(url)) {
    if (compact) {
      return (
        <>
          <button type="button" className="ticket-file-chip" onClick={() => setExpanded(true)}>
            <span className="ticket-file-chip-icon">PDF</span>
            <span>Ver PDF</span>
          </button>
          {expanded && (
            <Modal title="Ticket exportado" onClose={() => setExpanded(false)}>
              <object data={`${url}#toolbar=0&navpanes=0`} type="application/pdf" className="ticket-file-embed">
                <a href={url} target="_blank" rel="noreferrer">Abrir PDF en pestaña nueva ↗</a>
              </object>
              <div className="actions" style={{ marginTop: 8 }}>
                <a className="btn btn-secondary" href={url} target="_blank" rel="noreferrer">Abrir en pestaña ↗</a>
              </div>
            </Modal>
          )}
        </>
      );
    }
    return (
      <div className="ticket-file">
        <object data={`${url}#toolbar=0&navpanes=0`} type="application/pdf" className="ticket-file-embed">
          <a href={url} target="_blank" rel="noreferrer">Abrir PDF ↗</a>
        </object>
        <a href={url} target="_blank" rel="noreferrer" className="ticket-file-open">Abrir PDF ↗</a>
      </div>
    );
  }
  return (
    <a href={url} target="_blank" rel="noreferrer" className={`ticket-file ${compact ? 'is-compact' : ''}`}>
      <img src={url} alt="Ticket" />
    </a>
  );
}

export function TicketsPage({ consultationMode }: { consultationMode: boolean }) {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<'todos' | TicketState>('todos');
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [invgateBase, setInvgateBase] = useState(DEFAULT_INVGATE);

  const load = () => {
    setLoading(true);
    getTickets()
      .then(response => setTickets(response.items || []))
      .catch(err => setError(err instanceof Error ? err.message : 'No se pudieron cargar los tickets.'))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);
  useEffect(() => {
    getSiteSettings()
      .then(response => {
        const url = String((response.settings as Record<string, unknown>)?.['tickets.invgateUrl'] || '').trim();
        if (url) setInvgateBase(url.endsWith('/') ? url : `${url}/`);
      })
      .catch(() => {});
  }, []);

  const counts = useMemo(() => ({
    todos: tickets.length,
    'No hecho': tickets.filter(t => t.estado === 'No hecho').length,
    'En proceso': tickets.filter(t => t.estado === 'En proceso').length,
    'Hecho': tickets.filter(t => t.estado === 'Hecho').length
  }), [tickets]);

  // A3: búsqueda por número, título, descripción, categoría, responsables y creadoPor.
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tickets.filter(t => {
      if (filter !== 'todos' && t.estado !== filter) return false;
      if (!q) return true;
      const hay = [
        t.numero, t.titulo, t.descripcion, t.categoria, t.creadoPor,
        Array.isArray(t.responsables) ? t.responsables.join(' ') : ''
      ].join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [tickets, filter, search]);

  const invgateLink = (numero: string) => `${invgateBase}${encodeURIComponent(normalizeNumero(numero))}`;

  const openCreate = () => { setDraft(EMPTY); setEditingId(null); setError(''); setModalOpen(true); };
  const openEdit = (ticket: Ticket) => { setDraft({ numero: ticket.numero, estado: ticket.estado, imagenUrl: ticket.imagenUrl }); setEditingId(ticket.id); setError(''); setModalOpen(true); };

  const handleFile = async (file?: File) => {
    if (!file) return;
    setUploading(true);
    setError('');
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const response = await uploadTicketImage({ fileName: file.name, dataUrl });
      setDraft(current => ({ ...current, imagenUrl: response.url }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo subir el archivo.');
    } finally {
      setUploading(false);
    }
  };

  const save = async () => {
    const numero = normalizeNumero(draft.numero);
    if (!numero) { setError('Cargá el número de ticket (solo dígitos).'); return; }
    setBusy(true);
    setError('');
    try {
      const payload = { ...draft, numero };
      if (editingId) await updateTicket(editingId, payload);
      else await createTicket(payload);
      setModalOpen(false);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar el ticket.');
    } finally {
      setBusy(false);
    }
  };

  const changeEstado = async (ticket: Ticket, estado: TicketState) => {
    setTickets(prev => prev.map(t => t.id === ticket.id ? { ...t, estado } : t));
    try { await updateTicket(ticket.id, { estado }); } catch { load(); }
  };

  const remove = async (ticket: Ticket) => {
    if (!window.confirm(`¿Borrar el ticket #${ticket.numero}?`)) return;
    await deleteTicket(ticket.id).catch(() => {});
    load();
  };

  return (
    <section className="view active">
      <div className="card-head" style={{ marginBottom: 12 }}>
        <h3>Tickets</h3>
        <Button variant="primary" disabled={consultationMode} onClick={openCreate}>Cargar ticket</Button>
      </div>

      {/* A3: búsqueda + chips de estado con contador */}
      <div className="ticket-toolbar">
        <input
          className="input ticket-search"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Buscar por número, título, categoría, responsable…"
        />
        <div className="ticket-chips">
          {(['todos', ...ESTADOS] as const).map(key => (
            <button
              key={key}
              type="button"
              className={`ticket-chip ${filter === key ? 'is-active' : ''}`}
              onClick={() => setFilter(key)}
            >
              {key === 'todos' ? 'Todos' : key}
              <span className="ticket-chip-count">{counts[key]}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="muted" style={{ fontSize: 13, marginTop: 6 }}>
        {visible.length} {visible.length === 1 ? 'resultado' : 'resultados'}
      </div>

      {error && !modalOpen && <div className="tool-error" style={{ marginTop: 12 }}>{error}</div>}
      {loading && <div className="tool-info" style={{ marginTop: 12 }}>Cargando tickets…</div>}
      {!loading && visible.length === 0 && <div className="tool-info" style={{ marginTop: 12 }}>No hay tickets en este filtro.</div>}

      <div className="ticket-grid" style={{ marginTop: 12 }}>
        {visible.map(ticket => (
          <section className="ticket-card" key={ticket.id}>
            {/* A5: header limpio con #numero azul + badge estado */}
            <div className="ticket-card-head">
              <a href={invgateLink(ticket.numero)} target="_blank" rel="noreferrer" className="ticket-number-link">#{normalizeNumero(ticket.numero)} ↗</a>
              <span className={ESTADO_BADGE[ticket.estado]}>{ticket.estado}</span>
            </div>
            {ticket.titulo && <div className="ticket-card-title">{ticket.titulo}</div>}
            {ticket.categoria && <div className="ticket-card-meta">{ticket.categoria}</div>}
            {ticket.imagenUrl && <div className="ticket-card-file"><FilePreview url={ticket.imagenUrl} compact /></div>}
            <div className="ticket-card-actions">
              <select className="input" value={ticket.estado} disabled={consultationMode} onChange={e => changeEstado(ticket, e.target.value as TicketState)}>
                {ESTADOS.map(e => <option key={e} value={e}>{e}</option>)}
              </select>
              <Button disabled={consultationMode} onClick={() => openEdit(ticket)}>Editar</Button>
              <Button disabled={consultationMode} onClick={() => remove(ticket)}>Borrar</Button>
            </div>
          </section>
        ))}
      </div>

      {modalOpen && (
        <Modal title={editingId ? 'Editar ticket' : 'Cargar ticket'} onClose={() => setModalOpen(false)}>
          <div className="grid-2">
            <label>Número de ticket (InVgate)
              <input
                className="input"
                value={draft.numero || ''}
                onChange={e => setDraft(d => ({ ...d, numero: normalizeNumero(e.target.value) }))}
                placeholder="Ej. 2103"
                inputMode="numeric"
                autoFocus
              />
              <span className="muted" style={{ fontSize: 12 }}>Solo el número, sin <code>#</code> — ej. <code>2103</code></span>
            </label>
            <label>Estado
              <select className="input" value={draft.estado || 'No hecho'} onChange={e => setDraft(d => ({ ...d, estado: e.target.value as TicketState }))}>
                {ESTADOS.map(e => <option key={e}>{e}</option>)}
              </select>
            </label>
          </div>
          {normalizeNumero(draft.numero) && (
            <a href={invgateLink(draft.numero || '')} target="_blank" rel="noreferrer" className="muted" style={{ fontSize: 13 }}>
              Abrir en InVgate: {invgateLink(draft.numero || '')} ↗
            </a>
          )}
          <label>Ticket exportado (PDF o foto)
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <label className="btn btn-secondary">
                {uploading ? 'Subiendo…' : (draft.imagenUrl ? 'Reemplazar archivo' : 'Subir PDF / foto')}
                <input type="file" accept="application/pdf,image/png,image/jpeg,image/jpg,image/webp" className="sr-only" onChange={e => handleFile(e.target.files?.[0])} disabled={uploading} />
              </label>
              {draft.imagenUrl && <a href={draft.imagenUrl} target="_blank" rel="noreferrer">Abrir ↗</a>}
            </div>
          </label>
          {draft.imagenUrl && <FilePreview url={draft.imagenUrl} />}
          {error && <div className="tool-error">{error}</div>}
          <div className="actions" style={{ marginTop: 8 }}>
            <Button variant="primary" disabled={busy || uploading} onClick={save}>{busy ? 'Guardando…' : 'Guardar ticket'}</Button>
            <Button onClick={() => setModalOpen(false)}>Cancelar</Button>
          </div>
        </Modal>
      )}
    </section>
  );
}
