import { useEffect, useState, type FormEvent } from 'react';
import './reminderFields.css';
import { Button, Collapse, ErrorState, IconButton, Input, Segmented, Select, Textarea, cx } from '../../ui';
import { IconX } from '../../ui/icons';
import { enableBrowserPush, getNotificationPrefs } from '../../services/notificationsApi';
import { testReminderPush } from '../../services/remindersApi';
import { errorMessage } from '../layout/Feedback';
import { PRIORITIES, RELATED_TYPES, isValidLocal, isoToLocal, localToIso, type Priority, type ReminderRow } from './reminderUtils';
import { WhenField } from './WhenField';

export type ReminderDraft = {
  title: string;
  description: string;
  when: string;
  priority: Priority;
  /** '' = vos · mail de alguien de la sede · '__other' = otro mail. */
  owner: string;
  otherMail: string;
  relatedType: string;
  relatedId: string;
  relatedLabel: string;
};

export const EMPTY_DRAFT: ReminderDraft = { title: '', description: '', when: '', priority: 'Media', owner: '', otherMail: '', relatedType: '', relatedId: '', relatedLabel: '' };

export type Person = { email: string; name: string };

export function draftFromReminder(item: ReminderRow, people: Person[], me: string): ReminderDraft {
  const owner = String(item.ownerEmail || '').toLowerCase();
  const known = people.some(person => person.email === owner);
  return {
    title: item.title,
    description: item.description || '',
    when: isoToLocal(item.remindAt),
    priority: (PRIORITIES as readonly string[]).includes(item.priority) ? item.priority as Priority : 'Media',
    owner: !owner || owner === me ? '' : known ? owner : '__other',
    otherMail: !owner || owner === me || known ? '' : owner,
    relatedType: item.relatedType || '',
    relatedId: item.relatedId || '',
    relatedLabel: item.relatedLabel || ''
  };
}

const MAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function payloadFromDraft(draft: ReminderDraft, people: Person[], me: string) {
  const ownerEmail = draft.owner === '__other' ? draft.otherMail.trim().toLowerCase() : draft.owner || me;
  const person = people.find(item => item.email === ownerEmail);
  return {
    title: draft.title.trim(),
    description: draft.description.trim(),
    remindAt: localToIso(draft.when),
    priority: draft.priority,
    ownerEmail,
    ownerName: person?.name || '',
    relatedType: draft.relatedType,
    relatedId: draft.relatedType ? draft.relatedId.trim() : '',
    relatedLabel: draft.relatedType ? draft.relatedLabel.trim() : ''
  };
}

/**
 * Alta y edición de un recordatorio, en línea. Controlado: el borrador lo
 * guarda quien lo usa, así cerrar o un error no borran lo tipeado.
 */
export function ReminderForm({ mode, draft, onChange, people, peopleError, onSubmit, onCancel, onClose, disabled }: {
  mode: 'create' | 'edit';
  draft: ReminderDraft;
  onChange: (draft: ReminderDraft) => void;
  people: Person[];
  peopleError?: string;
  onSubmit: () => Promise<void>;
  onCancel: () => void;
  /** Cerrar desde la X (en el alta conserva el borrador). */
  onClose?: () => void;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  const [error, setError] = useState('');
  const set = <K extends keyof ReminderDraft>(key: K, value: ReminderDraft[K]) => onChange({ ...draft, [key]: value });

  const titleError = !draft.title.trim() ? 'Escribí qué hay que recordar.' : '';
  const whenError = !isValidLocal(draft.when) ? 'Elegí fecha y hora.' : '';
  const mailError = draft.owner === '__other' && !MAIL_RX.test(draft.otherMail.trim()) ? 'Escribí un mail válido.' : '';
  const invalid = Boolean(titleError || whenError || mailError);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setTried(true);
    if (busy || invalid || disabled) return;
    setBusy(true);
    setError('');
    try {
      await onSubmit();
      setTried(false);
    } catch (reason) {
      setError(errorMessage(reason, 'No se pudo guardar el recordatorio.'));
    } finally {
      setBusy(false);
    }
  };

  const relatedMeta = RELATED_TYPES.find(item => item.value === draft.relatedType);
  const ownerOptions = [
    { value: '', label: 'Vos' },
    ...people.map(person => ({ value: person.email, label: person.name, hint: person.name !== person.email ? person.email : undefined })),
    { value: '__other', label: 'Otro mail…' }
  ];

  return (
    <form className={cx('rem-form', mode === 'edit' && 'is-edit')} onSubmit={event => void submit(event)} data-scanner-ignore="" noValidate
      onKeyDown={event => { if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); onCancel(); } }}
    >
      {mode === 'create' && (
        <div className="rem-form-head">
          <h2 className="rem-h2">Nuevo recordatorio</h2>
          {onClose && <IconButton label="Cerrar el formulario (queda el borrador)" icon={<IconX size={16} />} onClick={onClose} />}
        </div>
      )}
      <Input label="Qué hay que recordar" placeholder="Ej. Retirar las Touch de 3F" value={draft.title} onValueChange={value => set('title', value)} required autoFocus={mode === 'create'} error={tried ? titleError : undefined} disabled={disabled} />
      <Textarea label="Detalle (opcional)" placeholder="Lo que haga falta para no tener que preguntar" minRows={2} value={draft.description} onValueChange={value => set('description', value)} disabled={disabled} />
      <WhenField value={draft.when} onChange={value => set('when', value)} error={tried ? whenError : undefined} disabled={disabled} />
      <Segmented<Priority> label="Prioridad" value={draft.priority} onChange={value => set('priority', value)} options={PRIORITIES.map(value => ({ value, label: <span className={value === 'Urgente' ? 'rem-tone-bad' : value === 'Alta' ? 'rem-tone-warn' : undefined}>{value}</span> }))} disabled={disabled} block />
      <div className="rem-field-group">
        <Select label="Para quién" value={draft.owner} onChange={value => set('owner', value)} options={ownerOptions} disabled={disabled} searchable="auto" hint={peopleError || 'Si es para otra persona, le avisamos que se lo asignaste.'} />
        <Collapse open={draft.owner === '__other'}>
          <Input label="Mail del responsable" inputMode="email" autoComplete="off" placeholder="nombre@escuela.edu.ar" value={draft.otherMail} onValueChange={value => set('otherMail', value)} error={tried ? mailError : undefined} disabled={disabled} />
        </Collapse>
      </div>
      <div className="rem-field-group">
        <Select label="Relacionado con" value={draft.relatedType} onChange={value => set('relatedType', value)} options={[{ value: '', label: 'Nada en particular' }, ...RELATED_TYPES.map(item => ({ value: item.value, label: item.label }))]} disabled={disabled} />
        <Collapse open={Boolean(draft.relatedType)} className="rem-grid-2">
          <Input label="Identificador" placeholder={relatedMeta?.placeholder} value={draft.relatedId} onValueChange={value => set('relatedId', value)} disabled={disabled} className="rem-mono-input" />
          <Input label="Nombre para mostrar" placeholder="Ej. 6F" value={draft.relatedLabel} onValueChange={value => set('relatedLabel', value)} disabled={disabled} />
        </Collapse>
      </div>
      {mode === 'create' && <PushBox />}
      {error && <ErrorState message={error} />}
      <div className="rem-actions rem-actions-end">
        <Button variant="ghost" disabled={busy} onClick={onCancel}>Cancelar</Button>
        <Button type="submit" variant="primary" loading={busy} loadingLabel="Guardando…" disabled={disabled}>{mode === 'create' ? 'Guardar recordatorio' : 'Guardar cambios'}</Button>
      </div>
    </form>
  );
}

/** Cómo avisa: push en este dispositivo (activar / probar) y la nota de iPhone. */
export function PushBox() {
  const [state, setState] = useState<'checking' | 'on' | 'off' | 'blocked' | 'unsupported' | 'unavailable'>('checking');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'bad' | 'muted'; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      if (typeof window === 'undefined' || !('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) return 'unsupported' as const;
      if (Notification.permission === 'denied') return 'blocked' as const;
      try {
        const prefs = await getNotificationPrefs();
        if (!prefs.pushAvailable) return 'unavailable' as const;
      } catch { /* sigue: se mira la suscripción local */ }
      const registration = await Promise.race([
        navigator.serviceWorker.getRegistration(),
        new Promise<undefined>(resolve => window.setTimeout(() => resolve(undefined), 1500))
      ]);
      const subscription = registration ? await registration.pushManager.getSubscription().catch(() => null) : null;
      return subscription && Notification.permission === 'granted' ? 'on' as const : 'off' as const;
    };
    check().then(next => { if (!cancelled) setState(next); }).catch(() => { if (!cancelled) setState('off'); });
    return () => { cancelled = true; };
  }, []);

  const activate = async () => {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    const result = await enableBrowserPush();
    setBusy(false);
    if (result.ok) { setState('on'); setMessage({ tone: 'ok', text: 'Listo: este dispositivo recibe los avisos.' }); }
    else setMessage({ tone: 'bad', text: result.error || 'No se pudo activar.' });
  };
  const test = async () => {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await testReminderPush();
      if (!result.available) setMessage({ tone: 'bad', text: 'El servidor no tiene push configurado: los avisos llegan a la campana y por mail.' });
      else if (!result.sent) setMessage({ tone: 'bad', text: 'No hay ningún dispositivo tuyo suscripto. Activá el push acá.' });
      else setMessage({ tone: 'ok', text: `Mandamos una prueba a ${result.sent === 1 ? 'tu dispositivo' : `tus ${result.sent} dispositivos`}. Si no llegó en unos segundos, revisá los permisos.` });
    } catch (reason) {
      setMessage({ tone: 'bad', text: errorMessage(reason, 'No se pudo mandar la prueba.') });
    } finally {
      setBusy(false);
    }
  };

  const text = {
    checking: 'Revisando las notificaciones de este dispositivo…',
    on: 'Push activado en este dispositivo.',
    off: 'Push no activado en este dispositivo.',
    blocked: 'Las notificaciones están bloqueadas en este navegador: habilitalas desde la configuración del sitio.',
    unsupported: 'Este navegador no recibe push.',
    unavailable: 'El servidor no tiene push configurado.'
  }[state];

  return (
    <div className="rem-push">
      <span className="rem-push-title">Cómo te avisa</span>
      <span className="rem-para">A la hora elegida: en la campana, con notificación push y por mail si lo tenés activo.</span>
      <div className="rem-push-row">
        <span className={cx('rem-push-state', (state === 'off' || state === 'blocked') && 'rem-tone-warn')}>{text}</span>
        {state === 'off' && <Button size="sm" variant="ghost" loading={busy} onClick={() => void activate()}>Activar push</Button>}
        {state === 'on' && <Button size="sm" variant="ghost" loading={busy} onClick={() => void test()}>Probar aviso</Button>}
      </div>
      {message && <span className={cx('rem-para', `rem-tone-${message.tone}`)} role="status">{message.text}</span>}
      <span className="rem-help">En iPhone el push llega solo si agregaste TechAsset a la pantalla de inicio (Compartir › Agregar a inicio, iOS 16.4 o más) y activaste las notificaciones desde ahí.</span>
    </div>
  );
}
