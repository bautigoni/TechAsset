import { useEffect, useState } from 'react';
import { getPhotoPasses, lendPhotoPass, returnPhotoPass, type PhotoPass } from '../../services/photoPassesApi';
import { Button } from '../layout/Button';
import { Modal } from '../layout/Modal';

/**
 * Cartelitos de autorización de fotos, dentro de Préstamos.
 *
 * No son un módulo ni una categoría: son papeles numerados del 1 al 30 que se
 * entregan y se devuelven. La app los da de alta sola la primera vez, así que
 * acá solo se ve la grilla de números con su estado.
 */
export function PhotoPassPanel({ consultationMode }: { consultationMode: boolean }) {
  const [items, setItems] = useState<PhotoPass[]>([]);
  const [lending, setLending] = useState<PhotoPass | null>(null);
  const [form, setForm] = useState({ persona: '', rol: '', motivo: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const refresh = () => getPhotoPasses()
    .then(response => setItems(response.items))
    .catch(() => setError('No se pudieron cargar los cartelitos.'));

  useEffect(() => { void refresh(); }, []);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await action();
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo completar la acción.');
    } finally {
      setBusy(false);
    }
  };

  const prestados = items.filter(item => item.estado === 'Prestado');

  return (
    <section className="card pass-panel">
      <div className="card-head">
        <div>
          <h3>Cartelitos de fotos</h3>
          <span className="muted">{prestados.length} de {items.length} entregados</span>
        </div>
      </div>
      {error && <div className="tool-error">{error}</div>}
      <div className="pass-chips">
        {items.map(pass => (
          <button
            key={pass.numero}
            type="button"
            className={`pass-chip ${pass.estado === 'Prestado' ? 'is-prestado' : ''}`}
            disabled={consultationMode || busy}
            title={pass.estado === 'Prestado' ? `${pass.prestadoA}${pass.motivo ? ` · ${pass.motivo}` : ''} — clic para devolver` : 'Disponible — clic para entregar'}
            onClick={() => {
              if (pass.estado === 'Prestado') void run(() => returnPhotoPass(pass.numero));
              else { setForm({ persona: '', rol: '', motivo: '' }); setLending(pass); }
            }}
          >
            {pass.numero}
          </button>
        ))}
      </div>
      {prestados.length > 0 && (
        <ul className="pass-lent-list">
          {prestados.map(pass => (
            <li key={pass.numero}>
              <b>{pass.numero}</b>
              <span>{pass.prestadoA}{pass.motivo ? ` · ${pass.motivo}` : ''}</span>
              <time>{pass.loanedAt ? new Date(pass.loanedAt).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) : ''}</time>
            </li>
          ))}
        </ul>
      )}

      {lending && (
        <Modal title={`Entregar cartelito ${lending.numero}`} onClose={() => setLending(null)}>
          <form className="stack" onSubmit={async event => {
            event.preventDefault();
            await run(() => lendPhotoPass(lending.numero, form));
            setLending(null);
          }}>
            <label>Persona<input className="input" required autoFocus value={form.persona} onChange={event => setForm(v => ({ ...v, persona: event.target.value }))} /></label>
            <div className="grid-2">
              <label>Rol<input className="input" value={form.rol} onChange={event => setForm(v => ({ ...v, rol: event.target.value }))} placeholder="Docente, preceptor..." /></label>
              <label>Motivo<input className="input" value={form.motivo} onChange={event => setForm(v => ({ ...v, motivo: event.target.value }))} placeholder="Acto, salida..." /></label>
            </div>
            <div className="actions">
              <Button variant="primary" type="submit" disabled={busy || !form.persona.trim()}>Entregar</Button>
              <Button type="button" onClick={() => setLending(null)}>Cancelar</Button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}
