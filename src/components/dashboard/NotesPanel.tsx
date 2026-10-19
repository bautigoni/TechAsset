import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Star, Trash2 } from 'lucide-react';
import type { InternalNote } from '../../types';
import { Button, EmptyState, ErrorState, IconButton, Input, SkeletonText, cx, useStatusLine } from '../../ui';
import { createInternalNote, fetchInternalNotes, updateInternalNote } from '../../services/operationsApi';
import { TIME_HM, dayKeyAr, formatDate, todayKeyAr } from '../../utils/formatters';

const TIME_24: Intl.DateTimeFormatOptions = { ...TIME_HM, hour12: false, timeZone: 'America/Argentina/Buenos_Aires' };
import { errorMessage } from '../layout/Feedback';

const MAX_VISIBLE = 4;

// "Hoy" en hora argentina: el server manda localDate; si no, se convierte createdAt (UTC).
const noteDay = (item: InternalNote) => item.localDate || dayKeyAr(item.createdAt || '');

/**
 * Notas del día (lo que antes era el chat de "Traspaso"; el nombre cambió por
 * pedido del dueño). Enter envía, ★ marca Importante (lo cuenta el cierre del
 * día), borrar deja un Deshacer en línea. Sin barra de scroll: últimas 4 y
 * "Ver anteriores (N)". Se refresca al volver a la pestaña (sin polling).
 */
export function NotesPanel({ operator, readOnly, onCount }: { operator: string; readOnly: boolean; onCount?: (count: number) => void }) {
  const [items, setItems] = useState<InternalNote[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [all, setAll] = useState(false);
  const [hidden, setHidden] = useState<Set<number>>(() => new Set());
  const status = useStatusLine();
  const inputRef = useRef<HTMLInputElement | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await fetchInternalNotes('active');
      const today = todayKeyAr();
      setItems(response.items.filter(item => noteDay(item) === today).sort((a, b) => a.id - b.id));
      setLoadError('');
    } catch (reason) {
      setLoadError(errorMessage(reason, 'No se pudieron cargar las notas.'));
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  // Las notas del compañero aparecen al volver a la pestaña (sin sumar polling).
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refresh]);

  const notes = (items || []).filter(item => !hidden.has(item.id));
  const important = notes.filter(item => item.importante).length;
  useEffect(() => { onCount?.(notes.length); }, [notes.length, onCount]);

  const send = async (event?: FormEvent) => {
    event?.preventDefault();
    const value = text.trim();
    if (!value || sending || readOnly) return;
    setSending(true);
    try {
      await createInternalNote({ texto: value, importante: false, operator });
      setText('');
      await refresh();
      inputRef.current?.focus();
    } catch (reason) {
      status.show({ tone: 'bad', message: `No se pudo enviar la nota · ${errorMessage(reason, 'Error del servidor')}`, retry: { onRetry: () => send() } });
    } finally {
      setSending(false);
    }
  };

  const toggleImportant = async (note: InternalNote) => {
    const next = !note.importante;
    setItems(current => current && current.map(item => (item.id === note.id ? { ...item, importante: next } : item)));
    try {
      await updateInternalNote(note.id, { importante: next, operator });
    } catch (reason) {
      setItems(current => current && current.map(item => (item.id === note.id ? { ...item, importante: !next } : item)));
      status.show({ tone: 'bad', message: `No se pudo marcar la nota · ${errorMessage(reason, 'Error del servidor')}` });
    }
  };

  const remove = async (note: InternalNote) => {
    setHidden(current => new Set(current).add(note.id));
    const restore = () => setHidden(current => { const next = new Set(current); next.delete(note.id); return next; });
    try {
      await updateInternalNote(note.id, { visible: false, operator });
      status.show({
        tone: 'ok',
        message: 'Nota borrada',
        undo: {
          onUndo: async () => {
            try {
              await updateInternalNote(note.id, { visible: true, operator });
              restore();
              status.show({ tone: 'info', message: 'Nota recuperada' });
            } catch (reason) {
              status.show({ tone: 'bad', message: `No se pudo recuperar la nota · ${errorMessage(reason, 'Error del servidor')}` });
            }
          }
        }
      });
    } catch (reason) {
      restore();
      status.show({ tone: 'bad', message: `No se pudo borrar la nota · ${errorMessage(reason, 'Error del servidor')}`, retry: { onRetry: () => remove(note) } });
    }
  };

  const extra = Math.max(0, notes.length - MAX_VISIBLE);
  const shown = all ? notes : notes.slice(-MAX_VISIBLE);

  return (
    <section className="dash-card dash-notes" aria-labelledby="notas-titulo">
      <header className="dash-card-head">
        <h2 className="dash-h3" id="notas-titulo">Notas</h2>
        <span className="dash-card-meta g-num">
          {notes.length ? `${notes.length} ${notes.length === 1 ? 'nota' : 'notas'}${important ? ` · ${important} ${important === 1 ? 'importante' : 'importantes'}` : ''}` : 'Sin notas'}
        </span>
      </header>
      <div className="dash-notes-body" aria-live="polite">
        {items === null && !loadError && <SkeletonText lines={2} />}
        {loadError && <ErrorState message={loadError} onRetry={() => void refresh()} />}
        {extra > 0 && (
          <Button size="sm" variant="ghost" className="dash-notes-more" onClick={() => setAll(value => !value)}>
            {all ? `Ver solo las últimas ${MAX_VISIBLE}` : `Ver anteriores (${extra})`}
          </Button>
        )}
        {shown.map(note => {
          const mine = note.operador === operator;
          return (
            <article key={note.id} className={cx('dash-note', mine && 'is-mine', note.importante && 'is-important')}>
              <p className="dash-note-text">{note.texto}</p>
              <footer className="dash-note-meta">
                <span className="ui-mono dash-sub">{note.operador || 'Sin operador'} · {formatDate(note.createdAt, TIME_24)}</span>
                {readOnly ? (note.importante && <span className="dash-note-imp"><Star size={12} strokeWidth={1.8} aria-hidden="true" /> Importante</span>) : (
                  <>
                    <button
                      type="button"
                      className={cx('dash-note-star', note.importante && 'is-on')}
                      aria-pressed={note.importante}
                      aria-label={note.importante ? 'Quitar la marca de importante' : 'Marcar como importante'}
                      onClick={() => void toggleImportant(note)}
                    >
                      <Star size={13} strokeWidth={1.8} aria-hidden="true" />
                      {note.importante && <span>Importante</span>}
                    </button>
                    <IconButton size="sm" label="Borrar nota" icon={<Trash2 size={13} strokeWidth={1.8} />} onClick={() => void remove(note)} />
                  </>
                )}
              </footer>
            </article>
          );
        })}
        {items !== null && !notes.length && !loadError && <EmptyState compact title="Nadie dejó notas hoy." />}
      </div>
      {status.element && <div className="dash-status dash-status--in">{status.element}</div>}
      {!readOnly && (
        <form className="dash-notes-form" data-scanner-ignore="" onSubmit={send}>
          <Input
            ref={inputRef}
            className="dash-grow"
            aria-label="Escribir una nota"
            placeholder="Escribí una nota y apretá Enter…"
            autoComplete="off"
            value={text}
            onValueChange={setText}
          />
          <Button type="submit" variant="secondary" loading={sending} disabled={!text.trim()} aria-label="Enviar nota (Enter)">Enviar</Button>
        </form>
      )}
    </section>
  );
}
