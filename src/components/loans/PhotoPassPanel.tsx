import { useEffect, useState } from 'react';
import {
  getPhotoPasses, getPhotoPassOptions, lendPhotoPass, returnPhotoPass,
  type PhotoPass, type PhotoPassOptions
} from '../../services/photoPassesApi';
import { Button } from '../layout/Button';
import { Modal } from '../layout/Modal';

/**
 * Cartelitos de autorización de fotos, dentro de Préstamos.
 *
 * Se le entregan a un alumno, y hay que dejar registrado de qué curso es y con
 * qué docente está. No hay padrón de alumnos en la base: los nombres se
 * aprenden solos, cada uno cargado una vez queda para autocompletar. Los
 * docentes y cursos salen de datos que ya existen (horarios y préstamos).
 */
const EMPTY = { persona: '', curso: '', docente: '', motivo: '' };

export function PhotoPassPanel({ consultationMode }: { consultationMode: boolean }) {
  const [items, setItems] = useState<PhotoPass[]>([]);
  const [options, setOptions] = useState<PhotoPassOptions>({ alumnos: [], cursos: [], docentes: [] });
  const [lending, setLending] = useState<PhotoPass | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const refresh = () => getPhotoPasses()
    .then(response => setItems(response.items))
    .catch(() => setError('No se pudieron cargar los cartelitos.'));

  useEffect(() => {
    void refresh();
    getPhotoPassOptions()
      .then(response => setOptions({ alumnos: response.alumnos, cursos: response.cursos, docentes: response.docentes }))
      .catch(() => undefined);
  }, []);

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
            title={pass.estado === 'Prestado'
              ? `${pass.prestadoA}${pass.curso ? ` · ${pass.curso}` : ''}${pass.docente ? ` · con ${pass.docente}` : ''} — clic para devolver`
              : 'Disponible — clic para entregar'}
            onClick={() => {
              if (pass.estado === 'Prestado') void run(() => returnPhotoPass(pass.numero));
              else { setForm(EMPTY); setLending(pass); }
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
              <span>
                {pass.prestadoA}
                {pass.curso && <em>{pass.curso}</em>}
                {pass.docente && <i>con {pass.docente}</i>}
              </span>
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
            <label>Alumno
              <input className="input" list="pass-alumnos" required autoFocus value={form.persona} onChange={event => setForm(v => ({ ...v, persona: event.target.value }))} placeholder="Nombre y apellido" />
              <datalist id="pass-alumnos">{options.alumnos.map(value => <option key={value} value={value} />)}</datalist>
            </label>
            <div className="grid-2">
              <label>Curso
                <input className="input" list="pass-cursos" value={form.curso} onChange={event => setForm(v => ({ ...v, curso: event.target.value }))} placeholder="Ej. EP · 5F" />
                <datalist id="pass-cursos">{options.cursos.map(value => <option key={value} value={value} />)}</datalist>
              </label>
              <label>Docente a cargo
                <input className="input" list="pass-docentes" value={form.docente} onChange={event => setForm(v => ({ ...v, docente: event.target.value }))} placeholder="Con quién está" />
                <datalist id="pass-docentes">{options.docentes.map(value => <option key={value} value={value} />)}</datalist>
              </label>
            </div>
            <label>Motivo<input className="input" value={form.motivo} onChange={event => setForm(v => ({ ...v, motivo: event.target.value }))} placeholder="Acto, salida, proyecto... (opcional)" /></label>
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
