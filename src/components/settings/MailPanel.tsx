import { useEffect, useState, type ReactNode } from 'react';
import { ChevronDown, Eye, EyeOff } from 'lucide-react';
import { Button, Collapse, ErrorState, IconButton, Input, NumberField, Segmented, SkeletonRows } from '../../ui';
import { cx } from '../../ui/util';
import { getMailSettings, saveMailSettings, type MailSettings } from '../../services/settingsApi';
import { Card, CardBody, CardFoot, Notice, Reveal, dropDraft, errorText, peekDraft, useDirty, useKeepDraft } from './settingsKit';
import { MailStatusLine } from './MailStatusLine';

type Draft = Omit<MailSettings, 'smtpAppPasswordMasked' | 'smtpAppPasswordSet'> & { smtpAppPassword: string };
type Status = { tone: 'ok' | 'bad'; text: string } | null;

const fromSettings = (settings: MailSettings): Draft => ({
  smtpServer: settings.smtpServer || '',
  smtpPort: Number(settings.smtpPort) || 465,
  smtpUser: settings.smtpUser || '',
  mailFrom: settings.mailFrom || '',
  mailSubject: settings.mailSubject || '',
  modoPrueba: Boolean(settings.modoPrueba),
  microsoftLoginUrl: settings.microsoftLoginUrl || '',
  smtpAppPassword: ''
});
const signature = (draft: Draft | null) => JSON.stringify(draft);

const HELP = [
  'Usá una cuenta institucional autorizada para enviar correos.',
  'SMTP es el servicio que permite enviar mails desde la app.',
  'Con Microsoft 365 suele usarse el servidor smtp.office365.com, puerto 587.',
  'El usuario es el mail completo de la cuenta que envía.',
  'La contraseña es una contraseña de aplicación o clave SMTP autorizada, no la de la cuenta.',
  'Si la cuenta tiene doble factor, puede necesitar contraseña de aplicación.',
  'En Microsoft 365 puede hacer falta habilitar SMTP AUTH desde la administración.',
  'Probá primero en modo prueba: no manda nada y deja todo en el registro.',
  'Recién después pasá a modo real.',
  'La contraseña nunca se muestra entera. No la subas a GitHub ni la compartas.'
];

/**
 * Mail y SMTP (solo superadmin): configuración global de envío (invitaciones,
 * avisos y credenciales 365). Se guarda en el server y pisa al .env. La
 * contraseña vacía conserva la guardada. Vino de Herramientas (etapa 8b).
 */
export function MailPanel({ header, readOnly }: { header: (actions?: ReactNode) => ReactNode; readOnly: boolean; siteCode: string }) {
  const draftKey = 'global:mail';
  const [restored, setRestored] = useState(() => peekDraft<Draft>(draftKey));
  const [settings, setSettings] = useState<MailSettings | null>(null);
  const [draft, setDraft] = useState<Draft | null>(() => restored);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const [help, setHelp] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [refresh, setRefresh] = useState(0);

  const load = () => {
    setLoadError('');
    getMailSettings()
      .then(response => { setSettings(response.settings); setDraft(current => current || fromSettings(response.settings)); })
      .catch(reason => setLoadError(errorText(reason, 'No se pudo cargar la configuración de mail.')));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, []);

  const saved = settings ? fromSettings(settings) : null;
  const changed = Boolean(saved && draft) && signature(saved) !== signature(draft);
  useDirty('mail', changed);
  // La contraseña no se guarda en el borrador en memoria.
  useKeepDraft(draftKey, draft ? { ...draft, smtpAppPassword: '' } : null, changed);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => { setDraft(current => (current ? { ...current, [key]: value } : current)); setStatus(null); };

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    setStatus(null);
    const payload: Record<string, unknown> = {
      smtpServer: draft.smtpServer.trim(),
      smtpPort: Number(draft.smtpPort) || 465,
      smtpUser: draft.smtpUser.trim(),
      mailFrom: draft.mailFrom.trim(),
      mailSubject: draft.mailSubject.trim(),
      microsoftLoginUrl: draft.microsoftLoginUrl.trim(),
      modoPrueba: draft.modoPrueba
    };
    // Vacía = se conserva la que había.
    if (draft.smtpAppPassword) payload.smtpAppPassword = draft.smtpAppPassword;
    try {
      const response = await saveMailSettings(payload);
      setSettings(response.settings);
      setDraft(fromSettings(response.settings));
      setRestored(null);
      dropDraft(draftKey);
      setShowPassword(false);
      setRefresh(value => value + 1);
      setStatus({ tone: 'ok', text: draft.modoPrueba ? 'Configuración guardada. Modo prueba: no sale ningún mail.' : 'Configuración guardada. Modo real: los mails salen con esta cuenta.' });
    } catch (reason) {
      setStatus({ tone: 'bad', text: errorText(reason, 'No se pudo guardar la configuración de mail.') });
    } finally {
      setSaving(false);
    }
  };
  const discard = () => {
    if (saved) setDraft(saved);
    setRestored(null);
    dropDraft(draftKey);
    setStatus(null);
  };

  if (loadError && !settings) return <>{header()}<ErrorState message={loadError} onRetry={load} /></>;

  const passwordHint = settings?.smtpAppPasswordSet
    ? `Hay una guardada (${settings.smtpAppPasswordMasked}). Dejalo vacío para conservarla.`
    : 'Todavía no hay una guardada.';

  return (
    <>
      {header()}
      <MailStatusLine context="smtp" refreshKey={refresh} />
      <Card title="Servidor de salida" heightKey={Boolean(draft)} meta="Global · todas las sedes">
        {restored && changed && <Notice tone="warn">Recuperamos cambios que no habías guardado (la contraseña no se recuerda).</Notice>}
        <button type="button" className="cfg-acc-h is-plain" aria-expanded={help} aria-controls="cfg-smtp-help" onClick={() => setHelp(value => !value)}>
          <span className="cfg-strong">Cómo completar esta configuración</span>
          <ChevronDown size={16} aria-hidden="true" className={cx('cfg-chev', help && 'is-open')} />
        </button>
        <Collapse unmountOnClose data-scanner-ignore="" open={help} id="cfg-smtp-help">
          <ol className="cfg-help-list">
            {HELP.map(item => <li key={item}>{item}</li>)}
          </ol>
        </Collapse>
        <CardBody>
          {!draft ? <SkeletonRows rows={5} /> : (
            <div className="cfg-grid" data-scanner-ignore="">
              <Input label="Servidor SMTP" className="cfg-mono-input" value={draft.smtpServer} disabled={readOnly} placeholder="smtp.office365.com" autoComplete="off" onValueChange={value => set('smtpServer', value)} />
              <NumberField label="Puerto" value={draft.smtpPort} min={1} max={65535} disabled={readOnly} hint={draft.smtpPort === 465 ? 'Cifrada desde el inicio (SSL/TLS).' : 'Se cifra al conectar (STARTTLS).'} onChange={value => set('smtpPort', value ?? 465)} />
              <Input label="Usuario" value={draft.smtpUser} disabled={readOnly} inputMode="email" autoComplete="off" placeholder="cuenta@colegio.edu.ar" onValueChange={value => set('smtpUser', value)} />
              <Input
                label="Contraseña de aplicación"
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                value={draft.smtpAppPassword}
                disabled={readOnly}
                placeholder={settings?.smtpAppPasswordSet ? 'Guardada · vacío la conserva' : 'Sin configurar'}
                hint={passwordHint}
                suffix={<IconButton size="sm" label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'} pressed={showPassword} icon={showPassword ? <EyeOff size={15} aria-hidden="true" /> : <Eye size={15} aria-hidden="true" />} onClick={() => setShowPassword(value => !value)} />}
                onValueChange={value => set('smtpAppPassword', value)}
              />
              <Input label="Mail remitente" value={draft.mailFrom} disabled={readOnly} placeholder="TechAsset <tic@colegio.edu.ar>" onValueChange={value => set('mailFrom', value)} />
              <Input label="Asunto del mail de credenciales" value={draft.mailSubject} disabled={readOnly} placeholder="Tus credenciales de Microsoft 365" onValueChange={value => set('mailSubject', value)} />
              <Input className="cfg-span2" label="URL de ingreso a Microsoft" inputMode="url" value={draft.microsoftLoginUrl} disabled={readOnly} placeholder="https://login.microsoftonline.com" hint={'Es el botón "Ingresar a la plataforma" del mail de credenciales 365.'} onValueChange={value => set('microsoftLoginUrl', value)} />
              <div className="cfg-span2">
                <Segmented
                  label="Modo de envío"
                  value={draft.modoPrueba ? 'prueba' : 'real'}
                  disabled={readOnly}
                  options={[{ value: 'prueba', label: 'Prueba · no envía' }, { value: 'real', label: 'Real · envía' }]}
                  onChange={value => set('modoPrueba', value === 'prueba')}
                />
                <Reveal when={draft && !draft.modoPrueba && settings?.modoPrueba}><p className="cfg-hint is-warn">Al guardar en modo real, las invitaciones, los avisos y las credenciales 365 empiezan a salir de verdad.</p></Reveal>
              </div>
            </div>
          )}
        </CardBody>
        <CardFoot
          status={status?.text || (readOnly ? 'Modo consulta: se ve, no se edita.' : changed ? 'Hay cambios sin guardar.' : 'Se guarda en el servidor y pisa los valores del .env.')}
          tone={status ? status.tone : changed ? 'warn' : 'muted'}
        >
          <Button variant="ghost" disabled={!changed || saving} onClick={discard}>Descartar</Button>
          <Button variant="primary" loading={saving} loadingLabel="Guardando…" disabled={readOnly || !changed} onClick={() => void save()}>Guardar configuración</Button>
        </CardFoot>
      </Card>
    </>
  );
}
