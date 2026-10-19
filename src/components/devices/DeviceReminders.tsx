import { useCallback, useEffect, useId, useState, type FormEvent } from 'react';
import type { Reminder } from '../../types';
import { Button, Collapse, DateTimeField, Eyebrow, Input, StatusText, useStatusLine } from '../../ui';
import { completeReminder, createReminder, getReminders } from '../../services/remindersApi';
import { errorMessage } from '../layout/Feedback';
import { shortWhen } from './deviceView';

/** Próxima hora en punto, local, como 'YYYY-MM-DDTHH:mm' (el valor de DateTimeField). */
function nextHour() {
  const date = new Date(Date.now() + 3600000);
  date.setMinutes(0, 0, 0);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Sin parsear texto del navegador (Safari daba Invalid Date): se arma a mano. */
function fromLocal(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]));
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Recordatorios del equipo dentro de la ficha. "+ Agregar" abre el formulario
 * en el lugar (antes eran dos diálogos seguidos); "Completar" con aviso si falla.
 */
export function DeviceReminders({ etiqueta, label, consultationMode }: { etiqueta: string; label: string; consultationMode: boolean }) {
  const [items, setItems] = useState<Reminder[] | null>(null);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [when, setWhen] = useState(nextHour);
  const [busy, setBusy] = useState<number | 'new' | null>(null);
  const status = useStatusLine();

  const refresh = useCallback(() => getReminders({ relatedType: 'device', relatedId: etiqueta })
    .then(response => setItems(response.items))
    .catch(() => setItems(current => current || [])), [etiqueta]);
  useEffect(() => { void refresh(); }, [refresh]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const date = fromLocal(when);
    if (!title.trim()) return;
    if (!date) { status.show({ tone: 'bad', message: 'La fecha no es válida.' }); return; }
    setBusy('new');
    try {
      await createReminder({ title: title.trim(), remindAt: date.toISOString(), relatedType: 'device', relatedId: etiqueta, relatedLabel: label });
      setTitle('');
      setWhen(nextHour());
      setOpen(false);
      status.show({ tone: 'ok', message: 'Recordatorio guardado.' });
      await refresh();
    } catch (reason) {
      status.show({ tone: 'bad', message: errorMessage(reason, 'No se pudo guardar el recordatorio.') });
    } finally {
      setBusy(null);
    }
  };

  const complete = async (item: Reminder) => {
    setBusy(item.id);
    try {
      await completeReminder(item.id);
      await refresh();
    } catch (reason) {
      status.show({ tone: 'bad', message: errorMessage(reason, 'No se pudo completar el recordatorio.') });
    } finally {
      setBusy(null);
    }
  };

  const list = (items || []).slice(0, 5);
  const formId = useId();
  return (
    <section className="dv-sec" aria-label="Recordatorios">
      <div className="dv-sec-head">
        <Eyebrow>Recordatorios</Eyebrow>
        {!consultationMode && (
          <Button size="sm" variant="ghost" aria-expanded={open} aria-controls={formId} onClick={() => setOpen(value => !value)}>{open ? 'Cancelar' : '+ Agregar'}</Button>
        )}
      </div>
      {list.map(item => (
        <div key={item.id} className="dv-rem">
          <span className="dv-rem-text">
            <span className="dv-ell">{item.title}</span>
            <StatusText tone={item.status === 'completed' ? 'muted' : 'normal'} mono>{item.status === 'completed' ? `Hecho · ${shortWhen(item.remindAt)}` : shortWhen(item.remindAt)}</StatusText>
          </span>
          {item.status === 'pending' && !consultationMode && (
            <Button size="sm" variant="ghost" loading={busy === item.id} onClick={() => void complete(item)}>Completar</Button>
          )}
        </div>
      ))}
      {items && !items.length && !open && <span className="dv-muted">Sin recordatorios para este equipo.</span>}
      <Collapse open={open} id={formId} unmountOnClose>
        <form className="dv-rem-form" data-scanner-ignore="" onSubmit={save} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); } }}>
          <Input label="Qué hay que hacer" value={title} onValueChange={setTitle} placeholder="Ej. revisar el cargador" autoFocus autoComplete="off" />
          <DateTimeField label="Cuándo" value={when} onChange={setWhen} minHour={7} maxHour={20} />
          <div className="dv-form-actions">
            <Button type="submit" size="sm" variant="primary" disabled={!title.trim()} loading={busy === 'new'}>Guardar</Button>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
          </div>
        </form>
      </Collapse>
      {status.element}
    </section>
  );
}
