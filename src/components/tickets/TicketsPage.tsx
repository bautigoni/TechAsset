import { useEffect, useMemo, useState } from 'react';
import type { Ticket, TicketState } from '../../types';
import { createTicket, deleteTicket, getTickets, updateTicket, uploadTicketImage } from '../../services/ticketsApi';
import { getSiteSettings } from '../../services/authApi';
import { Button } from '../layout/Button';
import { Modal } from '../layout/Modal';
import { StatCard } from '../layout/StatCard';

const ESTADOS: TicketState[] = ['No hecho', 'En proceso', 'Hecho'];
const DEFAULT_INVGATE = 'https://tikno.sd.cloud.invgate.net/requests/show/index/id/';

const ESTADO_BADGE: Record<TicketState, string> = {
  'No hecho': 'badge off',
  'En proceso': 'badge loaned',
  'Hecho': 'badge available'
};

type Draft = Partial<Ticket>;
const EMPTY: Draft = { numero: '', estado: 'No hecho', imagenUrl: '' };

const isPdf = (url?: string) => /\.pdf($|\?)/i.test(String(url || ''));

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('No se pudo leer el archivo.'));
    reader.readAsDataURL(file);
  });
}

function FilePreview({ url, compact = false }: { url: string; compact?: boolean }) {
  if (!url) return null;
  if (isPdf(url)) {
    return (
      <div className={`ticket-file ${compact ? 'is-compact' : ''}`}>
        <iframe src={`${url}#toolbar=0&navpanes=0`} title="Ticket PDF" />
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
    total: tickets.length,
    noHecho: tickets.filter(t => t.estado === 'No hecho').length,
    enProceso: tickets.filter(t => t.estado === 'En proceso').length,
    hecho: tickets.filter(t => t.estado === 'Hecho').length
  }), [tickets]);

  const visible = filter === 'todos' ? tickets : tickets.filter(t => t.estado === filter);
  const invgateLink = (numero: string) => `${invgateBase}${encodeURIComponent(String(numero || '').trim())}`;

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
    if (!String(draft.numero || '').trim()) { setError('Cargá el número de ticket.'); return; }
    setBusy(true);
    setError('');
    try {
      if (editingId) await updateTicket(editingId, draft);
      else await createTicket(draft);
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

      <div className="stats-grid analytics-kpi-grid">
        <StatCard label="Total" value={counts.total} />
        <StatCard label="No hechos" value={counts.noHecho} />
        <StatCard label="En proceso" value={counts.enProceso} />
        <StatCard label="Hechos" value={counts.hecho} />
      </div>

      <div className="analytics-filters" style={{ gridTemplateColumns: 'repeat(4, minmax(0,1fr))', marginTop: 12 }}>
        {(['todos', ...ESTADOS] as const).map(key => (
          <button key={key} type="button" className={`analytics-summary-pill ${filter === key ? 'is-active' : ''}`} onClick={() => setFilter(key)}>
            <strong>{key === 'todos' ? 'Todos' : key}</strong>
          </button>
        ))}
      </div>

      {error && !modalOpen && <div className="tool-error" style={{ marginTop: 12 }}>{error}</div>}
      {loading && <div className="tool-info" style={{ marginTop: 12 }}>Cargando tickets…</div>}
      {!loading && visible.length === 0 && <div className="tool-info" style={{ marginTop: 12 }}>No hay tickets en este filtro.</div>}

      <div className="analytics-grid" style={{ marginTop: 12 }}>
        {visible.map(ticket => (
          <section className="card" key={ticket.id}>
            <div className="card-head" style={{ alignItems: 'flex-start' }}>
              <a href={invgateLink(ticket.numero)} target="_blank" rel="noreferrer" className="ticket-number-link">#{ticket.numero} ↗</a>
              <span className={ESTADO_BADGE[ticket.estado]}>{ticket.estado}</span>
            </div>
            {ticket.imagenUrl && <FilePreview url={ticket.imagenUrl} compact />}
            <div className="actions" style={{ marginTop: 10, gap: 8, display: 'flex', flexWrap: 'wrap', alignItems: 'center' }}>
              <select className="input" style={{ width: 'auto' }} value={ticket.estado} disabled={consultationMode} onChange={e => changeEstado(ticket, e.target.value as TicketState)}>
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
              <input className="input" value={draft.numero || ''} onChange={e => setDraft(d => ({ ...d, numero: e.target.value }))} placeholder="Ej. 2103" autoFocus />
            </label>
            <label>Estado
              <select className="input" value={draft.estado || 'No hecho'} onChange={e => setDraft(d => ({ ...d, estado: e.target.value as TicketState }))}>
                {ESTADOS.map(e => <option key={e}>{e}</option>)}
              </select>
            </label>
          </div>
          {draft.numero?.trim() && (
            <a href={invgateLink(draft.numero)} target="_blank" rel="noreferrer" className="muted" style={{ fontSize: 13 }}>
              Abrir en InVgate: {invgateLink(draft.numero)} ↗
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
