import { useEffect, useMemo, useState } from 'react';
import { Button } from '../layout/Button';
import { SelectField } from '../layout/SelectField';
import { confirmDialog, errorMessage, toast } from '../layout/Feedback';
import { deleteRosterPerson, getRoster, importRoster, previewRoster, type RosterCounts, type RosterPerson } from '../../services/peopleApi';

type Tipo = 'docente' | 'alumno';

/**
 * Lista de docentes y alumnos de la sede, a mano o pegada.
 *
 * Va plegada al final de Configuración a propósito ("escondida"): lo normal es
 * cargarla pegándole las listas al Asistente. Acá se ve qué quedó, se corrige y
 * se puede reemplazar entera. Alimenta las sugerencias de persona en Préstamos
 * y cartelitos, y lo que el Asistente sabe del curso de cada uno.
 */
export function PeopleRosterPanel({ consultationMode }: { consultationMode: boolean }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<RosterPerson[]>([]);
  const [counts, setCounts] = useState<RosterCounts>({ total: 0, docentes: 0, alumnos: 0 });
  const [loaded, setLoaded] = useState(false);
  const [filter, setFilter] = useState('');
  const [text, setText] = useState('');
  const [tipo, setTipo] = useState<Tipo>('alumno');
  const [mode, setMode] = useState<'agregar' | 'reemplazar'>('agregar');
  const [preview, setPreview] = useState<{ items: RosterPerson[]; total: number } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || loaded) return;
    getRoster()
      .then(response => { setItems(response.items); setCounts(response.counts); setLoaded(true); })
      .catch(reason => toast({ message: errorMessage(reason, 'No se pudo leer la lista.'), tone: 'error' }));
  }, [open, loaded]);

  // Vista previa automática mientras se pega: muestra cómo se entendió.
  useEffect(() => {
    if (!text.trim()) { setPreview(null); return; }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      previewRoster(text, tipo)
        .then(response => { if (!cancelled) setPreview({ items: response.items, total: response.total }); })
        .catch(() => { if (!cancelled) setPreview(null); });
    }, 400);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [text, tipo]);

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const list = q
      ? items.filter(item => `${item.nombre} ${item.curso}`.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes(q))
      : items;
    return list.slice(0, 200);
  }, [items, filter]);

  const save = async () => {
    if (!text.trim() || busy) return;
    if (mode === 'reemplazar') {
      const current = tipo === 'docente' ? counts.docentes : counts.alumnos;
      const ok = await confirmDialog({
        title: `Reemplazar la lista de ${tipo === 'docente' ? 'docentes' : 'alumnos'}`,
        message: `Se borran los ${current} que hay ahora y quedan los ${preview?.total ?? 'nuevos'} del texto.`,
        confirmLabel: 'Reemplazar',
        danger: true
      });
      if (!ok) return;
    }
    setBusy(true);
    try {
      const result = await importRoster({ text, tipo, mode, replaceTipo: tipo });
      setItems(result.items);
      setCounts({ total: result.total, docentes: result.docentes, alumnos: result.alumnos });
      setText('');
      setPreview(null);
      toast({ message: `Lista guardada: ${result.added} nuevas${result.updated ? `, ${result.updated} actualizadas` : ''}${result.removed ? `, ${result.removed} quitadas` : ''}.`, tone: 'ok' });
    } catch (reason) {
      toast({ message: errorMessage(reason, 'No se pudo guardar la lista.'), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (person: RosterPerson) => {
    if (!person.id) return;
    try {
      const result = await deleteRosterPerson(person.id);
      setItems(current => current.filter(item => item.id !== person.id));
      setCounts(result.counts);
    } catch (reason) {
      toast({ message: errorMessage(reason, 'No se pudo quitar.'), tone: 'error' });
    }
  };

  return (
    <section className="card people-roster-panel">
      <button type="button" className="people-roster-toggle" aria-expanded={open} onClick={() => setOpen(value => !value)}>
        <span>
          <strong>Lista de docentes y alumnos</strong>
          <small className="muted">Sugerencias de nombres en Préstamos y lo que el Asistente sabe de cada persona.{loaded ? ` ${counts.docentes} docentes · ${counts.alumnos} alumnos.` : ''}</small>
        </span>
        <span className="loan-accessories-chevron" aria-hidden="true">⌄</span>
      </button>
      {open && (
        <div className="stack people-roster-body">
          <p className="muted text-12">
            También podés pegarle las listas al Asistente («cargá esta lista de alumnos de 3S: …»). Una persona por renglón;
            el curso puede ir al lado («Pérez, Juan - 3S») o como título arriba de cada grupo («3S:»). Los títulos «Docentes:» y «Alumnos:» cambian el tipo.
          </p>
          {!consultationMode && (
            <>
              <textarea className="input" rows={6} value={text} onChange={event => setText(event.target.value)} placeholder={'Alumnos 3S:\nPérez, Juan\nGómez, Ana\n\nDocentes:\nLaura Fernández - 4N'} />
              <div className="grid-2">
                <label>Si no dice, son
                  <SelectField value={tipo} onChange={value => setTipo(value as Tipo)} options={[{ value: 'alumno', label: 'Alumnos' }, { value: 'docente', label: 'Docentes' }]} />
                </label>
                <label>Al guardar
                  <SelectField value={mode} onChange={value => setMode(value as 'agregar' | 'reemplazar')} options={[{ value: 'agregar', label: 'Sumar a la lista' }, { value: 'reemplazar', label: `Reemplazar los ${tipo === 'docente' ? 'docentes' : 'alumnos'}` }]} />
                </label>
              </div>
              {preview && (
                <div className="tool-info">
                  Entendí {preview.total} {preview.total === 1 ? 'persona' : 'personas'}
                  {preview.items.length > 0 && <>: {preview.items.slice(0, 6).map(item => `${item.nombre}${item.curso ? ` (${item.curso})` : ''}${item.tipo === 'docente' ? ' · docente' : ''}`).join(', ')}{preview.total > 6 ? '…' : ''}</>}
                </div>
              )}
              <div className="actions">
                <Button type="button" variant="primary" disabled={busy || !text.trim()} onClick={() => void save()}>{busy ? 'Guardando…' : 'Guardar lista'}</Button>
              </div>
            </>
          )}
          {loaded && (
            <>
              <input className="input" value={filter} onChange={event => setFilter(event.target.value)} placeholder={`Buscar entre ${counts.total} personas`} />
              <div className="table-wrap">
                <table className="compact-table">
                  <thead><tr><th>Nombre</th><th>Tipo</th><th>Curso</th><th></th></tr></thead>
                  <tbody>
                    {visible.map(person => (
                      <tr key={person.id ?? person.nombre}>
                        <td>{person.nombre}</td>
                        <td>{person.tipo === 'docente' ? 'Docente' : 'Alumno'}</td>
                        <td>{person.curso || '—'}</td>
                        <td>{!consultationMode && <Button className="mini-action-btn" type="button" onClick={() => void remove(person)}>Quitar</Button>}</td>
                      </tr>
                    ))}
                    {!visible.length && <tr><td colSpan={4} className="empty-state">{counts.total ? 'Nadie coincide con la búsqueda.' : 'Todavía no hay nadie en la lista.'}</td></tr>}
                  </tbody>
                </table>
              </div>
              {items.length > visible.length && !filter && <p className="muted text-12">Se muestran 200 de {items.length}. Buscá para ver el resto.</p>}
            </>
          )}
        </div>
      )}
    </section>
  );
}
