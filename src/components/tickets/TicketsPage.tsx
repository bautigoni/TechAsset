import { useEffect, useMemo, useState } from 'react';
import type { Classroom, Ticket, TicketSource, TicketState, TicketTemplate } from '../../types';
import { createTicket, deleteTicket, getTickets, getTicketTemplates, updateTicket, uploadTicketImage } from '../../services/ticketsApi';
import { getSiteSettings } from '../../services/authApi';
import { fetchToolsConfig } from '../../services/toolsApi';
import { fetchClassrooms } from '../../services/classroomsApi';
import { formatDateTime } from '../../utils/formatters';
import { Button } from '../layout/Button';
import { Modal } from '../layout/Modal';
import { TicketTemplateManager } from './TicketTemplateManager';
import { TicketDetailModal } from './TicketDetailModal';
import { GooeyMenu } from '../layout/GooeyMenu';
import { SkeletonPanel } from '../layout/Skeleton';
import { useCardResize } from '../../hooks/useCardResize';
import { LayoutTemplate, TicketPlus } from 'lucide-react';

const ESTADOS: TicketState[] = ['No hecho', 'En proceso', 'Hecho'];
const ORIGENES: Array<{ key: TicketSource; label: string; helper: string }> = [
  { key: 'tik', label: 'Tiknology', helper: 'Ticket Tik/InVgate' },
  { key: 'handing', label: 'Handing', helper: 'Ticket Handing' }
];
const DEFAULT_INVGATE = 'https://tikno.sd.cloud.invgate.net/requests/show/index/id/';
const DEFAULT_HANDING = 'https://techasset.bauhub.online';

const ESTADO_BADGE: Record<TicketState, string> = {
  'No hecho': 'badge off',
  'En proceso': 'badge loaned',
  'Hecho': 'badge available'
};

type Draft = Partial<Ticket>;
const EMPTY: Draft = { numero: '', titulo: '', descripcion: '', categoria: '', estado: 'No hecho', prioridad: 'Media', imagenUrl: '', origen: 'tik', tags: [], checklist: [], responsables: [], classroom: '', classroomKey: '', school: '' };

const isPdf = (url?: string) => /\.pdf($|\?)/i.test(String(url || ''));
// A1: el número de InVgate es solo dígitos (strippeamos el '#' o cualquier otra cosa).
const normalizeNumero = (value: unknown) => String(value ?? '').replace(/\D+/g, '');
const normalizeReference = (value: unknown, source: TicketSource) => source === 'tik'
  ? normalizeNumero(value)
  : String(value ?? '').trim();

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

const MAX_DESC_LEN = 120;

function DescriptionBox({ desc }: { desc: string }) {
  const [expanded, setExpanded] = useState(false);
  const needsTrunc = desc.length > MAX_DESC_LEN;
  const show = expanded || !needsTrunc ? desc : desc.slice(0, MAX_DESC_LEN) + '…';
  return (
    <p
      className={`ticket-card-description${needsTrunc && !expanded ? ' is-trunc' : ''}`}
      onClick={() => needsTrunc && setExpanded(prev => !prev)}
    >{show}</p>
  );
}

export function TicketsPage({ consultationMode }: { consultationMode: boolean }) {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<'todos' | TicketState>('todos');
  const [sourceFilter, setSourceFilter] = useState<'todos' | TicketSource>('todos');
  const gridResizeRef = useCardResize<HTMLDivElement>(`${filter}:${sourceFilter}`);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [invgateBase, setInvgateBase] = useState(DEFAULT_INVGATE);
  const [handingBase, setHandingBase] = useState(DEFAULT_HANDING);
  const [templates, setTemplates] = useState<TicketTemplate[]>([]);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);

  const load = () => {
    setLoading(true);
    getTickets()
      .then(response => setTickets(response.items || []))
      .catch(err => setError(err instanceof Error ? err.message : 'No se pudieron cargar los tickets.'))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);
  const loadTemplates = async () => { const response = await getTicketTemplates(); setTemplates(response.items || []); };
  useEffect(() => { void loadTemplates(); }, []);
  useEffect(() => { fetchClassrooms().then(response => setClassrooms(response.items || [])).catch(() => setClassrooms([])); }, []);
  useEffect(() => {
    getSiteSettings()
      .then(response => {
        const url = String((response.settings as Record<string, unknown>)?.['tickets.invgateUrl'] || '').trim();
        if (url) setInvgateBase(url.endsWith('/') ? url : `${url}/`);
      })
      .catch(() => {});
    fetchToolsConfig()
      .then(response => {
        if (response.handingTicketUrl) setHandingBase(response.handingTicketUrl);
      })
      .catch(() => {});
  }, []);

  const counts = useMemo(() => ({
    todos: tickets.length,
    'No hecho': tickets.filter(t => t.estado === 'No hecho').length,
    'En proceso': tickets.filter(t => t.estado === 'En proceso').length,
    'Hecho': tickets.filter(t => t.estado === 'Hecho').length
  }), [tickets]);

  const sourceCounts = useMemo(() => ({
    todos: tickets.length,
    tik: tickets.filter(t => (t.origen || 'tik') === 'tik').length,
    handing: tickets.filter(t => t.origen === 'handing').length
  }), [tickets]);

  // A3: búsqueda por número, título, descripción, categoría, responsables y creadoPor.
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tickets.filter(t => {
      if (filter !== 'todos' && t.estado !== filter) return false;
      if (sourceFilter !== 'todos' && (t.origen || 'tik') !== sourceFilter) return false;
      if (!q) return true;
      const hay = [
        t.numero, t.titulo, t.descripcion, t.categoria, t.creadoPor,
        Array.isArray(t.responsables) ? t.responsables.join(' ') : ''
      ].join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [tickets, filter, search, sourceFilter]);

  const invgateLink = (numero: string) => `${invgateBase}${encodeURIComponent(normalizeNumero(numero))}`;
  const handingLink = (numero: string) => {
    const base = handingBase.trim() || DEFAULT_HANDING;
    const ref = String(numero || '').trim();
    if (base.includes('{ticket}')) return base.replace('{ticket}', encodeURIComponent(ref));
    return base;
  };
  const ticketLink = (ticket: Pick<Ticket, 'numero' | 'origen'>) => ticket.origen === 'handing' ? handingLink(ticket.numero) : invgateLink(ticket.numero);

  const openCreate = () => { setDraft(EMPTY); setEditingId(null); setError(''); setModalOpen(true); };
  const openEdit = (ticket: Ticket) => {
    setDraft({
      numero: ticket.numero,
      titulo: ticket.titulo,
      descripcion: ticket.descripcion,
      categoria: ticket.categoria,
      estado: ticket.estado,
      prioridad: ticket.prioridad,
      responsables: ticket.responsables,
      imagenUrl: ticket.imagenUrl,
      nota: ticket.nota,
      origen: ticket.origen || 'tik',
      tags: ticket.tags || [],
      templateId: ticket.templateId,
      classroom: ticket.classroom || '',
      classroomKey: ticket.classroomKey || '',
      school: ticket.school || ''
    });
    setEditingId(ticket.id);
    setError('');
    setModalOpen(true);
  };

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
    const origen = draft.origen || 'tik';
    const numero = normalizeReference(draft.numero, origen);
    if (origen === 'tik' && !numero) { setError('Cargá el número de ticket Tik/InVgate (solo dígitos).'); return; }
    setBusy(true);
    setError('');
    try {
      const payload = { ...draft, numero, origen };
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
        {/* El "+" del gooey reemplaza a "Cargar ticket": las dos acciones de
            creación viven adentro del mismo botón. */}
        <div className="actions">
          {!consultationMode && (
            <GooeyMenu
              ariaLabel="Cargar ticket"
              items={[
                { id: 'new', label: 'Cargar ticket', icon: <TicketPlus size={16} />, onSelect: openCreate },
                { id: 'templates', label: 'Plantillas', icon: <LayoutTemplate size={16} />, onSelect: () => setTemplatesOpen(true) }
              ]}
            />
          )}
        </div>
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
        <div className="ticket-chips ticket-source-chips">
          {(['todos', ...ORIGENES.map(item => item.key)] as const).map(key => (
            <button
              key={key}
              type="button"
              className={`ticket-chip ${sourceFilter === key ? 'is-active' : ''}`}
              onClick={() => setSourceFilter(key)}
            >
              {key === 'todos' ? 'Todos los orígenes' : ORIGENES.find(item => item.key === key)?.label}
              <span className="ticket-chip-count">{sourceCounts[key]}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="muted" style={{ fontSize: 13, marginTop: 6 }}>
        {visible.length} {visible.length === 1 ? 'resultado' : 'resultados'}
      </div>

      {error && !modalOpen && <div className="tool-error" style={{ marginTop: 12 }}>{error}</div>}
      {loading && <div style={{ marginTop: 12 }}><SkeletonPanel rows={3} head={false} rowHeight={96} /></div>}
      {!loading && visible.length === 0 && <div className="tool-info" style={{ marginTop: 12 }}>No hay tickets en este filtro.</div>}

      {/* Cambiar de filtro cambia cuántas tarjetas entran, así que la grilla
          cambia de alto. Con el resize se estira en vez de saltar. */}
      <div className="ticket-grid t-resize" style={{ marginTop: 12 }} ref={gridResizeRef}>
        {visible.map(ticket => (
          <section className="ticket-card" key={ticket.id}>
            {/* A5: header limpio con #numero azul + badge estado */}
            <div className="ticket-card-head">
              <a href={ticketLink(ticket)} target="_blank" rel="noreferrer" className="ticket-number-link">{ticket.origen === 'handing' ? 'Handing' : `#${normalizeNumero(ticket.numero)}`} ↗</a>
              <span className={ESTADO_BADGE[ticket.estado]}>{ticket.estado}</span>
            </div>
            <div className="ticket-source-line">{ticket.origen === 'handing' ? `Handing${ticket.numero ? ` · ${ticket.numero}` : ''}` : `Tiknology / InVgate · #${normalizeNumero(ticket.numero)}`}</div>
            <div className="ticket-creator-line">
              Cargado por <strong>{ticket.creadoPor || 'Sin usuario'}</strong>
              {ticket.createdAt && <span> · {formatDateTime(ticket.createdAt)}</span>}
            </div>
            {ticket.titulo && <div className="ticket-card-title">{ticket.titulo}</div>}
            {ticket.categoria && <div className="ticket-card-meta">{ticket.categoria}</div>}
            {ticket.descripcion && <DescriptionBox desc={ticket.descripcion} />}
            {!!ticket.tags?.length && <div className="ticket-tags">{ticket.tags.map(tag => <span key={tag}>{tag}</span>)}</div>}
            {ticket.aiSummary && <p className="ticket-summary-preview"><strong>Resumen:</strong> {ticket.aiSummary}</p>}
            {ticket.imagenUrl && <div className="ticket-card-file"><FilePreview url={ticket.imagenUrl} compact /></div>}
            <div className="ticket-card-actions">
              <Button onClick={() => setDetailId(ticket.id)}>Ver detalle</Button>
              <Button disabled={consultationMode} onClick={() => openEdit(ticket)}>Editar</Button>
              <select className="input" value={ticket.estado} disabled={consultationMode} onChange={e => changeEstado(ticket, e.target.value as TicketState)}>
                {ESTADOS.map(e => <option key={e} value={e}>{e}</option>)}
              </select>
              <Button disabled={consultationMode} onClick={() => remove(ticket)} className="btn-ghost-danger">Borrar</Button>
            </div>
          </section>
        ))}
      </div>

      {modalOpen && (
        <Modal title={editingId ? 'Editar ticket' : 'Cargar ticket'} onClose={() => setModalOpen(false)}>
          <div className="ticket-source-control" role="group" aria-label="Origen del ticket">
            {ORIGENES.map(item => (
              <button
                key={item.key}
                type="button"
                className={draft.origen === item.key ? 'active' : ''}
                onClick={() => setDraft(d => ({ ...d, origen: item.key, numero: normalizeReference(d.numero, item.key) }))}
              >
                <strong>{item.label}</strong>
                <span>{item.helper}</span>
              </button>
            ))}
          </div>
          {!editingId && templates.length > 0 && <label>Usar plantilla<select className="input" value={draft.templateId || ''} onChange={e => { const template = templates.find(item => item.id === Number(e.target.value)); setDraft(current => template ? { ...current, templateId: template.id, titulo: template.title, descripcion: template.description, prioridad: template.priority, categoria: template.category, responsables: template.suggestedAssignee ? [template.suggestedAssignee] : [], checklist: template.checklist, tags: template.tags } : { ...current, templateId: undefined }); }}><option value="">Sin plantilla</option>{templates.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>}
          <div className="grid-2">
            <label>{draft.origen === 'handing' ? 'Referencia de ticket (Handing)' : 'Número de ticket (InVgate)'}
              <input
                className="input"
                value={draft.numero || ''}
                onChange={e => setDraft(d => ({ ...d, numero: normalizeReference(e.target.value, d.origen || 'tik') }))}
                placeholder={draft.origen === 'handing' ? 'Ej. HDMI-2103' : 'Ej. 2103'}
                inputMode={draft.origen === 'handing' ? 'text' : 'numeric'}
                autoFocus
              />
              <span className="muted" style={{ fontSize: 12 }}>{draft.origen === 'handing' ? 'No usa #id: podés dejarlo vacío o escribir una referencia interna.' : <>Solo el número, sin <code>#</code> - ej. <code>2103</code></>}</span>
            </label>
            <label>Estado
              <select className="input" value={draft.estado || 'No hecho'} onChange={e => setDraft(d => ({ ...d, estado: e.target.value as TicketState }))}>
                {ESTADOS.map(e => <option key={e}>{e}</option>)}
              </select>
            </label>
          </div>
          <div className="grid-2"><label>Prioridad<select className="input" value={draft.prioridad || 'Media'} onChange={e => setDraft(d => ({ ...d, prioridad: e.target.value }))}><option>Baja</option><option>Media</option><option>Alta</option><option>Urgente</option></select></label><label>Responsables (separados por coma)<input className="input" value={(draft.responsables || []).join(', ')} onChange={e => setDraft(d => ({ ...d, responsables: e.target.value.split(',').map(x => x.trim()).filter(Boolean) }))} /></label></div>
          <div className="grid-2">
            <label>Escuela<input className="input" value={draft.school || ''} onChange={e => setDraft(d => ({ ...d, school: e.target.value }))} placeholder="Sede o escuela" /></label>
            <label>Aula (opcional)
              <select className="input" value={draft.classroomKey || ''} onChange={e => { const selectedRoom = classrooms.find(room => room.roomKey === e.target.value); setDraft(d => ({ ...d, classroomKey: selectedRoom?.roomKey || '', classroom: selectedRoom?.nombre || '' })); }}>
                <option value="">Sin aula vinculada</option>
                {classrooms.map(room => <option key={room.roomKey} value={room.roomKey}>{room.nombre}{room.piso ? ` · ${room.piso}` : ''}</option>)}
              </select>
              {!draft.classroomKey && draft.classroom && <span className="muted">Dato anterior: {draft.classroom}</span>}
            </label>
          </div>
          <label>Tags (separados por coma)<input className="input" value={(draft.tags || []).join(', ')} onChange={e => setDraft(d => ({ ...d, tags: e.target.value.split(',').map(x => x.trim()).filter(Boolean) }))} /></label>
          {!editingId && <label>Checklist inicial (un paso por línea)<textarea className="input" rows={3} value={(draft.checklist || []).join('\n')} onChange={e => setDraft(d => ({ ...d, checklist: e.target.value.split('\n').map(x => x.trim()).filter(Boolean) }))} /></label>}
          <div className="grid-2">
            <label>Titulo
              <input
                className="input"
                value={draft.titulo || ''}
                onChange={e => setDraft(d => ({ ...d, titulo: e.target.value }))}
                placeholder="Ej. Proyector sin imagen"
              />
            </label>
            <label>Categoria
              <input
                className="input"
                value={draft.categoria || ''}
                onChange={e => setDraft(d => ({ ...d, categoria: e.target.value }))}
                placeholder="Hardware, cuenta, conectividad..."
              />
            </label>
          </div>
          <label>Descripcion
            <textarea
              className="input"
              rows={3}
              value={draft.descripcion || ''}
              onChange={e => setDraft(d => ({ ...d, descripcion: e.target.value }))}
              placeholder="Detalle breve del problema o pedido"
            />
          </label>
          {normalizeReference(draft.numero, draft.origen || 'tik') && (
            <a href={(draft.origen || 'tik') === 'handing' ? handingLink(draft.numero || '') : invgateLink(draft.numero || '')} target="_blank" rel="noreferrer" className="muted" style={{ fontSize: 13 }}>
              Abrir en {(draft.origen || 'tik') === 'handing' ? 'Handing' : 'InVgate'} ↗
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
      {templatesOpen && <TicketTemplateManager templates={templates} onClose={() => setTemplatesOpen(false)} onChanged={loadTemplates} />}
      {detailId != null && <TicketDetailModal initialId={detailId} tickets={tickets} consultationMode={consultationMode} onClose={() => setDetailId(null)} onChanged={load} />}

    </section>
  );
}
