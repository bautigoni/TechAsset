import { useCallback, useEffect, useState, type FormEvent } from 'react';
import './relatedReminders.css';
import { completeReminder, createReminder, getReminders, undoReminder } from '../../services/remindersApi';
import { Button, Checkbox, Collapse, ErrorState, Input, StatusSlot, cx, useStatusLine } from '../../ui';
import { errorMessage } from '../layout/Feedback';
import { WhenField } from './WhenField';
import { formatWhen, isValidLocal, localToIso, quickWhens, relativeWhen, type ReminderRow } from './reminderUtils';

/**
 * Recordatorios de un objeto (aula, equipo) dentro de su ficha: los 5 primeros
 * (pendientes primero), completar con Deshacer y alta en línea en un solo paso
 * (qué + cuándo). Antes eran dos diálogos seguidos con un datetime nativo.
 */
export function RelatedReminders({ type, id, label, consultationMode = false, onOpenAll }: {
  type: string;
  id: string;
  label: string;
  consultationMode?: boolean;
  onOpenAll?: () => void;
}) {
  const [items, setItems] = useState<ReminderRow[]>([]);
  const [loadError, setLoadError] = useState('');
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [when, setWhen] = useState(() => quickWhens()[0]?.value || '');
  const [busy, setBusy] = useState<number | 'add' | null>(null);
  const [tried, setTried] = useState(false);
  // La línea de estado aparece y se va con el colapso compartido (StatusSlot).
  const status = useStatusLine();
  const setNotice = (notice: { tone: 'ok' | 'bad' | 'info'; message: string; undo?: () => Promise<void> } | null) => {
    if (!notice) { status.clear(); return; }
    status.show({ tone: notice.tone, message: notice.message, undo: notice.undo ? { onUndo: notice.undo } : undefined });
  };

  const refresh = useCallback(async () => {
    try {
      const response = await getReminders({ relatedType: type, relatedId: id });
      setItems(response.items || []);
      setLoadError('');
    } catch (reason) {
      setLoadError(errorMessage(reason, 'No se pudieron cargar los recordatorios.'));
    }
  }, [type, id]);
  useEffect(() => { void refresh(); }, [refresh]);

  const add = async (event: FormEvent) => {
    event.preventDefault();
    setTried(true);
    if (busy || !title.trim() || !isValidLocal(when)) return;
    setBusy('add');
    try {
      const response = await createReminder({ title: title.trim(), remindAt: localToIso(when), relatedType: type, relatedId: id, relatedLabel: label, priority: 'Media' });
      setTitle('');
      setTried(false);
      setAdding(false);
      setNotice({ tone: 'ok', message: `Recordatorio guardado para ${formatWhen(response.item.remindAt)}.` });
      await refresh();
    } catch (reason) {
      setNotice({ tone: 'bad', message: errorMessage(reason, 'No se pudo guardar el recordatorio.') });
    } finally {
      setBusy(null);
    }
  };

  const complete = async (item: ReminderRow) => {
    if (busy) return;
    setBusy(item.id);
    try {
      await completeReminder(item.id);
      await refresh();
      setNotice({
        tone: 'ok',
        message: `«${item.title}» completado.`,
        undo: async () => {
          await undoReminder(item.id, { status: 'pending', remindAt: item.remindAt, notificationSentAt: item.notificationSentAt || '', completedAt: '', completedBy: '' });
          await refresh();
          setNotice({ tone: 'info', message: `«${item.title}» volvió a pendientes.` });
        }
      });
    } catch (reason) {
      setNotice({ tone: 'bad', message: errorMessage(reason, 'No se pudo completar.') });
    } finally {
      setBusy(null);
    }
  };

  const shown = items.slice(0, 5);
  return (
    <section className="relrem" aria-label="Recordatorios vinculados">
      <div className="relrem-head">
        <h3 className="relrem-title">Recordatorios</h3>
        <span className="relrem-count">{items.filter(item => item.status === 'pending').length} pendientes</span>
        <span className="relrem-grow" aria-hidden="true" />
        <Button size="sm" variant="ghost" aria-expanded={adding} disabled={consultationMode} onClick={() => setAdding(open => !open)}>Agregar</Button>
      </div>
      <StatusSlot status={status} />
      {loadError && <ErrorState message={loadError} onRetry={() => void refresh()} />}
      {shown.length ? (
        <ul className="relrem-list">
          {shown.map(item => {
            const done = item.status === 'completed';
            const rel = done ? null : relativeWhen(item.remindAt);
            return (
              <li key={item.id} className={cx('relrem-row', done && 'is-done')}>
                <Checkbox
                  checked={done}
                  disabled={done || consultationMode || item.canEdit === false || busy !== null}
                  ariaLabel={done ? `${item.title}: completado` : `Completar: ${item.title}`}
                  onCheckedChange={() => void complete(item)}
                />
                <span className="relrem-row-title">{item.title}</span>
                <span className={cx('relrem-row-when', rel && `relrem-tone-${rel.tone}`)}>{done ? 'completado' : formatWhen(item.remindAt)}</span>
              </li>
            );
          })}
        </ul>
      ) : !loadError && <p className="relrem-empty">Sin recordatorios vinculados.</p>}
      {items.length > shown.length && <p className="relrem-empty">Y {items.length - shown.length} más.</p>}
      <Collapse open={adding}>
        <form className="relrem-add" onSubmit={event => void add(event)} data-scanner-ignore="" onKeyDown={event => { if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); event.stopPropagation(); setAdding(false); } }}>
          <Input label="Qué hay que recordar" placeholder={`Ej. Revisar el proyector de ${label}`} value={title} onValueChange={setTitle} autoFocus error={tried && !title.trim() ? 'Escribí qué hay que recordar.' : undefined} />
          <WhenField label="Cuándo" value={when} onChange={setWhen} error={tried && !isValidLocal(when) ? 'Elegí fecha y hora.' : undefined} />
          <div className="relrem-actions">
            <Button size="sm" variant="ghost" disabled={busy === 'add'} onClick={() => setAdding(false)}>Cancelar</Button>
            <Button size="sm" type="submit" variant="primary" loading={busy === 'add'} loadingLabel="Guardando…">Guardar</Button>
          </div>
        </form>
      </Collapse>
      {onOpenAll && <Button size="sm" variant="ghost" className="relrem-all" onClick={onOpenAll}>Ver todos en Recordatorios</Button>}
    </section>
  );
}
