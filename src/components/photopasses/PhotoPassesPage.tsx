import { useEffect, useMemo, useState } from 'react';
import {
  deletePhotoPass, generatePhotoPasses, getPhotoPasses, getPhotoPassHistory,
  lendPhotoPass, returnPhotoPass, updatePhotoPass,
  type PhotoPass, type PhotoPassEvent, type PhotoPassSummary
} from '../../services/photoPassesApi';
import { Button } from '../layout/Button';
import { Modal } from '../layout/Modal';

const ESTADOS = ['Disponible', 'Prestado', 'Perdido', 'Fuera de uso'];

function stateClass(estado: string) {
  if (estado === 'Prestado') return 'is-prestado';
  if (estado === 'Perdido' || estado === 'Fuera de uso') return 'is-fuera';
  return 'is-disponible';
}

export function PhotoPassesPage({ consultationMode }: { consultationMode: boolean }) {
  const [items, setItems] = useState<PhotoPass[]>([]);
  const [summary, setSummary] = useState<PhotoPassSummary>({ total: 0, disponibles: 0, prestados: 0, fuera: 0 });
  const [filter, setFilter] = useState<'todos' | 'Disponible' | 'Prestado' | 'fuera'>('todos');
  const [search, setSearch] = useState('');
  const [lending, setLending] = useState<PhotoPass | null>(null);
  const [detail, setDetail] = useState<PhotoPass | null>(null);
  const [history, setHistory] = useState<PhotoPassEvent[]>([]);
  const [rangeOpen, setRangeOpen] = useState(false);
  const [range, setRange] = useState({ desde: 1, hasta: 30 });
  const [form, setForm] = useState({ persona: '', rol: '', motivo: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const refresh = () => getPhotoPasses()
    .then(response => { setItems(response.items); setSummary(response.summary); })
    .catch(reason => setError(reason instanceof Error ? reason.message : 'No se pudieron cargar los cartelitos.'));

  useEffect(() => { void refresh(); }, []);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return items
      .filter(item => filter === 'todos'
        || (filter === 'fuera' ? item.estado === 'Perdido' || item.estado === 'Fuera de uso' : item.estado === filter))
      .filter(item => !needle || String(item.numero).includes(needle) || item.prestadoA.toLowerCase().includes(needle) || item.motivo.toLowerCase().includes(needle));
  }, [items, filter, search]);

  const run = async (action: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await action();
      setMessage(ok);
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo completar la acción.');
    } finally {
      setBusy(false);
    }
  };

  const openDetail = async (pass: PhotoPass) => {
    setDetail(pass);
    setHistory([]);
    try {
      const response = await getPhotoPassHistory(pass.numero);
      setHistory(response.items);
    } catch { /* el historial es accesorio: si falla, el detalle igual sirve */ }
  };

  return (
    <section className="view active passes-page">
      <header className="inv-head">
        <div>
          <h3>Cartelitos</h3>
          <p>Autorizan a usar el celular para sacar fotos a alumnos. Se entregan y se devuelven.</p>
        </div>
        <div className="inv-head-actions">
          <Button disabled={consultationMode} onClick={() => setRangeOpen(true)}>Cargar cartelitos</Button>
        </div>
      </header>

      <div className="inv-kpis">
        <div><span>Total</span><strong>{summary.total}</strong></div>
        <div><span>Disponibles</span><strong>{summary.disponibles}</strong></div>
        <div className={summary.prestados ? 'is-warn' : ''}><span>Prestados</span><strong>{summary.prestados}</strong></div>
        <div className={summary.fuera ? 'is-bad' : ''}><span>Fuera de uso</span><strong>{summary.fuera}</strong></div>
      </div>

      {message && <div className="tool-info">{message}</div>}
      {error && <div className="tool-error">{error}</div>}

      <div className="inv-toolbar">
        <div className="inventory-segmented" role="group" aria-label="Estado">
          <button type="button" className={filter === 'todos' ? 'is-active' : ''} onClick={() => setFilter('todos')}>Todos</button>
          <button type="button" className={filter === 'Disponible' ? 'is-active' : ''} onClick={() => setFilter('Disponible')}>Disponibles</button>
          <button type="button" className={filter === 'Prestado' ? 'is-active' : ''} onClick={() => setFilter('Prestado')}>Prestados</button>
          <button type="button" className={filter === 'fuera' ? 'is-active' : ''} onClick={() => setFilter('fuera')}>Fuera de uso</button>
        </div>
        <input className="input" type="search" placeholder="Buscar número, persona o motivo" value={search} onChange={event => setSearch(event.target.value)} />
      </div>

      {!items.length && (
        <div className="inventory-empty">
          Todavía no hay cartelitos cargados. Usá “Cargar cartelitos” para dar de alta un rango, por ejemplo del 1 al 30.
        </div>
      )}

      <div className="passes-grid">
        {visible.map(pass => (
          <article className={`pass-card ${stateClass(pass.estado)}`} key={pass.numero}>
            <button type="button" className="pass-number" onClick={() => void openDetail(pass)} aria-label={`Cartelito ${pass.numero}`}>
              {pass.numero}
            </button>
            <div className="pass-body">
              <span className="pass-state">{pass.estado}</span>
              {pass.estado === 'Prestado'
                ? <strong title={pass.prestadoA}>{pass.prestadoA}</strong>
                : <strong className="muted">Sin entregar</strong>}
              {pass.estado === 'Prestado' && pass.motivo && <small>{pass.motivo}</small>}
            </div>
            <div className="pass-actions">
              {pass.estado === 'Disponible' && (
                <button type="button" disabled={consultationMode || busy} onClick={() => { setForm({ persona: '', rol: '', motivo: '' }); setLending(pass); }}>Entregar</button>
              )}
              {pass.estado === 'Prestado' && (
                <button type="button" disabled={consultationMode || busy} onClick={() => void run(() => returnPhotoPass(pass.numero), `Cartelito ${pass.numero} devuelto.`)}>Devolver</button>
              )}
              <button type="button" onClick={() => void openDetail(pass)}>Ver</button>
            </div>
          </article>
        ))}
      </div>

      {rangeOpen && (
        <Modal title="Cargar cartelitos" onClose={() => setRangeOpen(false)}>
          <form className="stack" onSubmit={async event => {
            event.preventDefault();
            await run(() => generatePhotoPasses(range.desde, range.hasta), `Cartelitos del ${range.desde} al ${range.hasta} cargados.`);
            setRangeOpen(false);
          }}>
            <p className="muted">Se crean todos los números del rango. Si alguno ya existe, se reactiva sin perder su historial.</p>
            <div className="grid-2">
              <label>Desde<input className="input" type="number" min="1" value={range.desde} onChange={event => setRange(v => ({ ...v, desde: Number(event.target.value) }))} /></label>
              <label>Hasta<input className="input" type="number" min="1" value={range.hasta} onChange={event => setRange(v => ({ ...v, hasta: Number(event.target.value) }))} /></label>
            </div>
            <div className="actions">
              <Button variant="primary" type="submit" disabled={busy}>Cargar</Button>
              <Button type="button" onClick={() => setRangeOpen(false)}>Cancelar</Button>
            </div>
          </form>
        </Modal>
      )}

      {lending && (
        <Modal title={`Entregar cartelito ${lending.numero}`} onClose={() => setLending(null)}>
          <form className="stack" onSubmit={async event => {
            event.preventDefault();
            await run(() => lendPhotoPass(lending.numero, form), `Cartelito ${lending.numero} entregado a ${form.persona}.`);
            setLending(null);
          }}>
            <label>Persona<input className="input" required autoFocus value={form.persona} onChange={event => setForm(v => ({ ...v, persona: event.target.value }))} /></label>
            <div className="grid-2">
              <label>Rol<input className="input" value={form.rol} onChange={event => setForm(v => ({ ...v, rol: event.target.value }))} placeholder="Docente, preceptor..." /></label>
              <label>Motivo<input className="input" value={form.motivo} onChange={event => setForm(v => ({ ...v, motivo: event.target.value }))} placeholder="Acto, salida, proyecto..." /></label>
            </div>
            <div className="actions">
              <Button variant="primary" type="submit" disabled={busy || !form.persona.trim()}>Entregar</Button>
              <Button type="button" onClick={() => setLending(null)}>Cancelar</Button>
            </div>
          </form>
        </Modal>
      )}

      {detail && (
        <Modal title={`Cartelito ${detail.numero}`} onClose={() => setDetail(null)}>
          <div className="stack">
            <div className="grid-2">
              <label>Estado
                <select className="input" value={detail.estado} disabled={consultationMode} onChange={async event => {
                  const estado = event.target.value;
                  await run(() => updatePhotoPass(detail.numero, { estado }), `Cartelito ${detail.numero}: ${estado}.`);
                  setDetail(current => current ? { ...current, estado } : current);
                }}>
                  {ESTADOS.map(value => <option key={value} value={value}>{value}</option>)}
                </select>
              </label>
              <label>Notas
                <input className="input" defaultValue={detail.notas} disabled={consultationMode}
                  onBlur={event => void run(() => updatePhotoPass(detail.numero, { notas: event.target.value }), 'Nota guardada.')} />
              </label>
            </div>
            {detail.estado === 'Prestado' && (
              <div className="tool-info">Entregado a {detail.prestadoA}{detail.rol ? ` (${detail.rol})` : ''}{detail.loanedAt ? ` · ${new Date(detail.loanedAt).toLocaleString('es-AR')}` : ''}</div>
            )}
            <div>
              <h4 style={{ margin: '0 0 8px', fontSize: 13 }}>Historial</h4>
              <div className="pass-history">
                {history.map(event => (
                  <div key={event.id}>
                    <strong>{event.tipo === 'prestamo' ? 'Entregado' : event.tipo === 'devolucion' ? 'Devuelto' : 'Estado'}</strong>
                    <span>{[event.persona, event.motivo].filter(Boolean).join(' · ') || '—'}</span>
                    <time>{event.timestamp ? new Date(event.timestamp).toLocaleString('es-AR') : ''}</time>
                  </div>
                ))}
                {!history.length && <p className="muted">Sin movimientos registrados.</p>}
              </div>
            </div>
            <div className="actions">
              <Button type="button" disabled={consultationMode} onClick={async () => {
                if (!window.confirm(`¿Dar de baja el cartelito ${detail.numero}? Se oculta sin borrar el historial.`)) return;
                await run(() => deletePhotoPass(detail.numero), `Cartelito ${detail.numero} dado de baja.`);
                setDetail(null);
              }}>Dar de baja</Button>
              <Button type="button" onClick={() => setDetail(null)}>Cerrar</Button>
            </div>
          </div>
        </Modal>
      )}
    </section>
  );
}
