import { useEffect, useState, type ReactNode } from 'react';
import { Button, ErrorState, Skeleton, Switch } from '../../ui';
import { IconCheck } from '../../ui/icons';
import { enableBrowserPush, getNotificationPrefs, setNotificationEmailPref, setNotificationTypePrefs, type NotificationTypePrefs } from '../../services/notificationsApi';
import { Card, CardFoot, CheckField, Reveal, SettingRow, errorText } from './settingsKit';

const DEFAULT_TYPES: NotificationTypePrefs = {
  releases: true,
  tasks: true,
  tickets: true,
  suggestions: true,
  reminders: true,
  registrations: true,
  system: true
};

const TYPE_OPTIONS: Array<{ key: keyof NotificationTypePrefs; title: string; text: string }> = [
  { key: 'suggestions', title: 'Sugerencias e ideas', text: 'Comentarios y cambios de estado de las ideas que seguís.' },
  { key: 'tasks', title: 'Tareas TIC', text: 'Tareas creadas o asignadas por otros integrantes de la sede.' },
  { key: 'tickets', title: 'Tickets', text: 'Tickets nuevos o cambios relevantes.' },
  { key: 'releases', title: 'Novedades de TechAsset', text: 'Avisos de actualización y cambios de versión.' },
  { key: 'registrations', title: 'Altas e invitaciones', text: 'Registros, aprobaciones e invitaciones de usuarios.' },
  { key: 'system', title: 'Sistema', text: 'Avisos generales de la plataforma.' }
];

type Msg = { tone: 'ok' | 'bad'; text: string; where: 'channels' | 'types' } | null;

/** Preferencias personales: no dependen de la sede ni del modo consulta. */
export function NotificationsPanel({ header }: { header: (actions?: ReactNode) => ReactNode }) {
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [email, setEmail] = useState(false);
  const [types, setTypes] = useState<NotificationTypePrefs>(DEFAULT_TYPES);
  const [pushSubscribed, setPushSubscribed] = useState(false);
  const [pushAvailable, setPushAvailable] = useState(false);
  const [busy, setBusy] = useState<'push' | 'email' | keyof NotificationTypePrefs | ''>('');
  const [msg, setMsg] = useState<Msg>(null);

  const load = () => {
    setLoadError('');
    getNotificationPrefs()
      .then(prefs => {
        setEmail(prefs.email);
        setTypes(prefs.types || DEFAULT_TYPES);
        setPushSubscribed(prefs.pushSubscribed);
        setPushAvailable(prefs.pushAvailable);
        setLoaded(true);
      })
      .catch(reason => setLoadError(errorText(reason, 'No se pudieron cargar tus preferencias de notificaciones.')));
  };
  useEffect(load, []);

  // Los avisos de éxito se van solos (3,5 s); los errores quedan hasta la próxima acción.
  useEffect(() => {
    if (!msg || msg.tone !== 'ok') return;
    const timer = window.setTimeout(() => setMsg(null), 3500);
    return () => window.clearTimeout(timer);
  }, [msg]);

  const activatePush = async () => {
    setBusy('push');
    setMsg(null);
    const result = await enableBrowserPush().catch(reason => ({ ok: false, error: errorText(reason, 'No se pudo activar.') }));
    if (result.ok) {
      setPushSubscribed(true);
      setMsg({ tone: 'ok', text: 'Notificaciones push activadas en este dispositivo.', where: 'channels' });
    } else {
      setMsg({ tone: 'bad', text: result.error || 'No se pudo activar.', where: 'channels' });
    }
    setBusy('');
  };

  const toggleEmail = async (next: boolean) => {
    setEmail(next);
    setBusy('email');
    try {
      await setNotificationEmailPref(next);
      setMsg({ tone: 'ok', text: next ? 'Te vamos a avisar por mail.' : 'Avisos por mail desactivados.', where: 'channels' });
    } catch (reason) {
      setEmail(!next);
      setMsg({ tone: 'bad', text: errorText(reason, 'No se pudo guardar.'), where: 'channels' });
    } finally {
      setBusy('');
    }
  };

  const toggleType = async (key: keyof NotificationTypePrefs) => {
    const previous = types;
    const next = { ...types, [key]: !types[key] };
    setTypes(next);
    setBusy(key);
    try {
      await setNotificationTypePrefs(next);
      setMsg({ tone: 'ok', text: 'Preferencias guardadas.', where: 'types' });
    } catch (reason) {
      setTypes(previous);
      setMsg({ tone: 'bad', text: errorText(reason, 'No se pudo guardar.'), where: 'types' });
    } finally {
      setBusy('');
    }
  };

  if (loadError) return <>{header()}<ErrorState message={loadError} onRetry={load} /></>;

  return (
    <>
      {header()}
      <Card ariaLabel="Canales">
        <SettingRow
          name="Notificaciones push"
          desc={<>En este dispositivo; llegan aunque no tengas la app abierta. En iPhone, primero instalá la app desde Compartir › Agregar a inicio.{loaded && !pushAvailable && <span className="cfg-block is-warn">El servidor no tiene push configurado.</span>}</>}
        >
          {!loaded ? <Skeleton width="6rem" height="var(--g-control-h)" radius="sm" />
            : pushSubscribed ? <span className="cfg-inline cfg-t2"><IconCheck size={14} /> Activadas</span>
            : <Button variant="secondary" loading={busy === 'push'} loadingLabel="Activando…" disabled={!pushAvailable} onClick={() => void activatePush()}>Activar</Button>}
        </SettingRow>
        <SettingRow name="Avisos por mail" desc="Además de la campana, te llega un mail cuando te asignan algo o hay novedades.">
          <span className="cfg-inline">
            <span className="cfg-t2">{email ? 'Activados' : 'Apagados'}</span>
            <Switch checked={email} disabled={!loaded} loading={busy === 'email'} ariaLabel="Avisos por mail" onCheckedChange={next => void toggleEmail(next)} />
          </span>
        </SettingRow>
        <Reveal when={msg?.where === 'channels'}>{msg?.where === 'channels' && <CardFoot status={msg.text} tone={msg.tone} />}</Reveal>
      </Card>
      <Card title="Qué te avisamos" meta="Se guarda al tocar">
        <div className="cfg-checklist">
          {TYPE_OPTIONS.map(option => (
            <div className="cfg-check-row" key={option.key}>
              <CheckField
                checked={Boolean(types[option.key])}
                disabled={!loaded || busy === option.key}
                label={option.title}
                description={option.text}
                onChange={() => void toggleType(option.key)}
              />
              <span className="cfg-t3 cfg-nowrap">{types[option.key] ? 'Activo' : 'Pausado'}</span>
            </div>
          ))}
        </div>
        <Reveal when={msg?.where === 'types'}>{msg?.where === 'types' && <CardFoot status={msg.text} tone={msg.tone} />}</Reveal>
      </Card>
    </>
  );
}
