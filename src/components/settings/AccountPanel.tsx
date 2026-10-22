import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import type { AuthUser, Operator, SiteInfo } from '../../types';
import { Button, Collapse, Input, Skeleton, Switch } from '../../ui';
import { ApiError } from '../../services/apiClient';
import { changePassword, getAccountInfo } from '../../services/authApi';
import { newPasswordProblem, PASSWORD_HINT, PASSWORD_MAX } from '../../utils/passwordPolicy';
import { PRIVACY_PATH, onPrivacyLinkClick } from '../auth/publicRoutes';
import { Card, CardFoot, Reveal, SettingRow, errorText, useDirty } from './settingsKit';

type Fields = { current: string; next: string; repeat: string };
type FieldErrors = Partial<Record<keyof Fields, string>>;
const EMPTY: Fields = { current: '', next: '', repeat: '' };

/**
 * Configuración › Cuenta: quién sos, tu rol, modo consulta, contraseña, tus
 * datos y la baja, y cerrar sesión. Sin jerga de infraestructura: el estado
 * de la base y de la importación vive en Configuración avanzada (superadmin).
 */
export function AccountPanel({ header, operator, user, sites, siteRole, roleReadOnly, consultationMode, setConsultationMode, onLogout }: {
  header: (actions?: ReactNode) => ReactNode;
  operator: Operator;
  user: AuthUser;
  sites: SiteInfo[];
  siteRole: string;
  roleReadOnly: boolean;
  consultationMode: boolean;
  setConsultationMode: (value: boolean) => void;
  onLogout: () => void | Promise<void>;
}) {
  const [leaving, setLeaving] = useState(false);
  return (
    <>
      {header()}
      <Card ariaLabel="Cuenta">
        <SettingRow name="Usuario actual" desc="Con este nombre quedan firmados tus préstamos y cambios.">
          <span className="cfg-value">
            <span className="cfg-strong">{operator || user.nombre || user.email}</span>
            <span className="cfg-t3 cfg-break">{user.email}</span>
          </span>
        </SettingRow>
        <SettingRow name="Rol en esta sede" desc="Lo asigna quien administra la sede.">
          <span className="cfg-strong">{siteRole || 'Consulta'}</span>
        </SettingRow>
        <SettingRow
          name="Modo consulta"
          desc={roleReadOnly
            ? `Tu rol (${siteRole || 'Consulta'}) es de solo lectura: ves todo, pero no podés cambiar nada.`
            : 'Mirá la app sin poder cambiar nada (solo lectura), por ejemplo para mostrarla en una reunión sin tocar datos por error. Se apaga al recargar la página.'}
        >
          <span className="cfg-inline">
            <span className="cfg-t2">{consultationMode ? 'Activado' : 'Apagado'}</span>
            <Switch checked={consultationMode} disabled={roleReadOnly} ariaLabel="Modo consulta" onCheckedChange={setConsultationMode} />
          </span>
        </SettingRow>
        <SettingRow name="Sedes" desc="Tu usuario tiene acceso a estas sedes.">
          <span className="cfg-break">{sites.map(site => (site.nombre && site.nombre !== site.siteCode ? `${site.nombre} (${site.siteCode})` : site.siteCode)).join(' · ') || '—'}</span>
        </SettingRow>
        <SettingRow name="Sesión" desc="Queda abierta 30 días en este navegador. Al cerrarla se borra de acá tu nombre y lo que tenías a medio cargar.">
          <Button loading={leaving} loadingLabel="Cerrando…" onClick={async () => { setLeaving(true); try { await onLogout(); } finally { setLeaving(false); } }}>Cerrar sesión</Button>
        </SettingRow>
      </Card>
      <PasswordCard email={user.email} nombre={user.nombre} />
      <Card title="Tus datos y la baja">
        <SettingRow
          name="Qué se guarda de vos"
          desc={<>Tu cuenta, lo que firmás en la sede, los mails que te mandamos y qué datos usa el asistente con IA: <a className="cfg-textlink" href={PRIVACY_PATH} onClick={onPrivacyLinkClick}>Privacidad y uso</a>.</>}
        />
        <SettingRow
          name="Cambiar tu nombre o tu mail, o darte de baja"
          desc="Pedíselo al Jefe TIC de tu sede (o a un superadministrador). Si te quitan el acceso no podés volver a entrar; lo que firmaste queda en el historial de la sede."
        />
      </Card>
    </>
  );
}

/** Cambiar la contraseña: actual + nueva (con la misma política que el registro). */
function PasswordCard({ email, nombre }: { email: string; nombre: string }) {
  const [account, setAccount] = useState<{ hasPassword: boolean; googleEnabled: boolean } | null>(null);
  const [loadError, setLoadError] = useState('');
  const [open, setOpen] = useState(false);
  const [fields, setFields] = useState<Fields>(EMPTY);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const dirty = open && Boolean(fields.current || fields.next || fields.repeat);
  useDirty('cuenta', dirty);

  const load = () => {
    setLoadError('');
    getAccountInfo()
      .then(data => setAccount({ hasPassword: data.hasPassword, googleEnabled: data.googleEnabled }))
      .catch(reason => setLoadError(errorText(reason, 'No pudimos ver si tu cuenta tiene contraseña.')));
  };
  useEffect(load, []);

  // El OK se va solo; un error queda hasta la próxima acción.
  useEffect(() => {
    if (status?.tone !== 'ok') return;
    const timer = window.setTimeout(() => setStatus(null), 6000);
    return () => window.clearTimeout(timer);
  }, [status]);

  const set = (key: keyof Fields, value: string) => {
    setFields(current => ({ ...current, [key]: value }));
    setErrors(current => (current[key] ? { ...current, [key]: undefined } : current));
  };
  const close = () => { setOpen(false); setFields(EMPTY); setErrors({}); };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setStatus(null);
    const found: FieldErrors = {};
    if (!fields.current) found.current = 'Escribí tu contraseña actual.';
    const problem = newPasswordProblem(fields.next, { email, nombre });
    if (problem) found.next = problem;
    else if (fields.next === fields.current) found.next = 'Tiene que ser distinta de la actual.';
    else if (fields.repeat !== fields.next) found.repeat = 'No coincide con la nueva.';
    if (Object.keys(found).length) {
      setErrors(found);
      const first = (['current', 'next', 'repeat'] as const).find(key => found[key]);
      document.getElementById(`cfg-pw-${first}`)?.focus();
      return;
    }
    setBusy(true);
    try {
      const response = await changePassword(fields.current, fields.next);
      close();
      setStatus({ tone: 'ok', text: response.message || 'Contraseña cambiada.' });
    } catch (reason) {
      const field = reason instanceof ApiError ? String(reason.data.field || '') : '';
      if (field === 'current' || field === 'new') {
        const key = field === 'current' ? 'current' : 'next';
        setErrors({ [key]: (reason as ApiError).message });
        document.getElementById(`cfg-pw-${key}`)?.focus();
      } else {
        setStatus({ tone: 'bad', text: errorText(reason, 'No se pudo cambiar la contraseña.') });
      }
    } finally {
      setBusy(false);
    }
  };

  const reveal = (
    <button type="button" className="cfg-reveal" aria-pressed={show} onClick={() => setShow(value => !value)}>{show ? 'Ocultar' : 'Mostrar'}</button>
  );
  const desc = !account
    ? (loadError || 'Consultando tu cuenta…')
    : account.hasPassword
      ? 'Para cambiarla te pedimos la actual. Las sesiones abiertas en otros dispositivos se cierran y te avisamos por mail.'
      : account.googleEnabled
        ? 'Tu cuenta no tiene contraseña: entrás con Google. Si querés entrar también con mail y contraseña, cerrá sesión y tocá "Olvidé mi contraseña" en el ingreso.'
        : 'Tu cuenta todavía no tiene contraseña. Para crearla, cerrá sesión y tocá "Olvidé mi contraseña" en el ingreso: te llega un link por mail.';

  return (
    <Card ariaLabel="Contraseña">
      <SettingRow name="Contraseña" desc={desc}>
        {!account
          ? (loadError ? <Button variant="secondary" onClick={load}>Reintentar</Button> : <Skeleton width="9rem" height="var(--g-control-h)" radius="sm" />)
          : account.hasPassword
            ? <Button variant="secondary" aria-expanded={open} aria-controls="cfg-pw-form" onClick={() => (open ? close() : setOpen(true))}>{open ? 'Cancelar' : 'Cambiar contraseña'}</Button>
            : null}
      </SettingRow>
      <Collapse open={open} id="cfg-pw-form" unmountOnClose>
        <form className="cfg-card-b cfg-pw" onSubmit={submit} noValidate data-scanner-ignore="">
          <Input id="cfg-pw-current" label="Contraseña actual" type={show ? 'text' : 'password'} autoComplete="current-password" value={fields.current} maxLength={PASSWORD_MAX} suffix={reveal} error={errors.current} onValueChange={value => set('current', value)} autoFocus />
          <Input id="cfg-pw-next" label="Contraseña nueva" type={show ? 'text' : 'password'} autoComplete="new-password" value={fields.next} maxLength={PASSWORD_MAX} hint={PASSWORD_HINT} error={errors.next} onValueChange={value => set('next', value)} />
          <Input id="cfg-pw-repeat" label="Repetí la nueva" type={show ? 'text' : 'password'} autoComplete="new-password" value={fields.repeat} maxLength={PASSWORD_MAX} error={errors.repeat} onValueChange={value => set('repeat', value)} />
          <div className="cfg-pw-actions">
            <Button type="submit" variant="primary" loading={busy} loadingLabel="Cambiando…">Cambiar contraseña</Button>
            <Button variant="ghost" disabled={busy} onClick={close}>Cancelar</Button>
          </div>
        </form>
      </Collapse>
      <Reveal when={Boolean(status)}>{status && <CardFoot status={status.text} tone={status.tone} />}</Reveal>
    </Card>
  );
}
