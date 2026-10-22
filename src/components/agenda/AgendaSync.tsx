import { useEffect, useRef, useState } from 'react';
import { getAgendaCalendarFeed, rotateAgendaCalendarFeed } from '../../services/agendaApi';
import { Button, Collapse, Eyebrow, InlineConfirm, Input, Skeleton, StatusLine, type StatusTone } from '../../ui';

const errorText = (err: unknown, fallback: string) => (err instanceof Error && err.message ? err.message : fallback);

const STEPS: Array<[string, string[]]> = [
  ['Google Calendar', ['Copiá el enlace.', 'Abrí “Agregar calendario por URL”.', 'Pegá el enlace y guardá.']],
  ['iPhone', ['Copiá el enlace.', 'Ajustes › Calendario › Cuentas.', 'Añadir cuenta › Otra › Calendario suscrito.']],
  ['Outlook', ['Copiá el enlace.', 'Agregar calendario › Suscribirse desde la web.', 'Pegá el enlace y guardá.']]
];

/** Enlace ICS personal, en línea (antes era un modal). */
export function AgendaSync({ onClose }: { onClose: () => void }) {
  const [feedUrl, setFeedUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [asking, setAsking] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [message, setMessage] = useState<{ tone: StatusTone; text: string; key: number } | null>(null);
  const say = (tone: StatusTone, text: string) => setMessage({ tone, text, key: Date.now() });
  const lastMessage = useRef(message);
  if (message) lastMessage.current = message;
  const shownMessage = message || lastMessage.current;

  useEffect(() => {
    let alive = true;
    getAgendaCalendarFeed()
      .then(response => { if (alive) setFeedUrl(response.feedUrl); })
      .catch(err => { if (alive) say('bad', errorText(err, 'No se pudo generar el enlace.')); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const copy = async () => {
    if (!feedUrl) return;
    try {
      if (!navigator.clipboard?.writeText) throw new Error('sin portapapeles');
      await navigator.clipboard.writeText(feedUrl);
      say('ok', 'Enlace copiado. Pegalo en tu calendario.');
    } catch {
      say('warn', 'No se pudo copiar solo: seleccioná el enlace y copialo a mano.');
    }
  };

  const rotate = async () => {
    setRotating(true);
    try {
      const response = await rotateAgendaCalendarFeed();
      setFeedUrl(response.feedUrl);
      say('ok', 'Enlace nuevo generado. El anterior ya no funciona.');
      setAsking(false);
    } catch (err) {
      say('bad', errorText(err, 'No se pudo regenerar el enlace.'));
    } finally {
      setRotating(false);
    }
  };

  return (
    <section className="ag-card ag-sync" aria-label="Agenda en tu calendario" data-scanner-ignore="">
      <div className="ag-card-head">
        <h3 className="ag-h3">Agenda en tu calendario</h3>
        <Button size="sm" variant="ghost" onClick={onClose}>Cerrar</Button>
      </div>
      <div className="ag-sync-body">
        <p className="ag-muted">Enlace personal para suscribirte desde Google Calendar, Outlook o el calendario del iPhone. Es de solo lectura, respeta la sede activa y no incluye las canceladas. Las actividades semanales se repiten todas las semanas.</p>
        <div className="ag-sync-row">
          {loading ? (
            <Skeleton height="var(--g-control-h)" radius="sm" className="ag-sync-skel" />
          ) : (
            <Input
              label="Enlace ICS"
              className="ag-sync-url"
              readOnly
              value={feedUrl}
              placeholder="No se pudo generar el enlace"
              onFocus={event => event.currentTarget.select()}
            />
          )}
          <div className="ag-sync-btns">
            <Button variant="primary" disabled={!feedUrl} onClick={copy}>Copiar enlace</Button>
            <Button variant="secondary" disabled={!feedUrl} onClick={() => { window.open('https://calendar.google.com/calendar/u/0/r/settings/addbyurl', '_blank', 'noopener,noreferrer'); say('info', 'Se abrió Google Calendar en otra pestaña.'); }}>Abrir Google Calendar</Button>
            <Button variant="ghost" disabled={!feedUrl || asking} onClick={() => setAsking(true)}>Regenerar</Button>
          </div>
        </div>
        <Collapse open={asking} unmountOnClose>
          <InlineConfirm
            message="¿Regenerar el enlace?"
            detail="El enlace actual deja de funcionar en todos los calendarios suscriptos."
            confirmLabel="Regenerar enlace"
            cancelLabel="No"
            busy={rotating}
            onConfirm={rotate}
            onCancel={() => setAsking(false)}
          />
        </Collapse>
        <Collapse open={Boolean(message)} unmountOnClose>
          {shownMessage && <StatusLine key={shownMessage.key} tone={shownMessage.tone} message={shownMessage.text} onDismiss={() => setMessage(null)} />}
        </Collapse>
        <div className="ag-sync-steps">
          {STEPS.map(([title, steps]) => (
            <div key={title}>
              <Eyebrow>{title}</Eyebrow>
              <ol className="ag-steps">{steps.map(step => <li key={step}>{step}</li>)}</ol>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
