import { useEffect, useState } from 'react';
import { Button } from '../layout/Button';
import { fetchMailSettings, updateMailSettings, type MailSettingsState } from '../../services/toolsApi';

const EMPTY: MailSettingsState = {
  smtpServer: '',
  smtpPort: 465,
  smtpUser: '',
  smtpAppPasswordMasked: '',
  smtpAppPasswordSet: false,
  mailFrom: '',
  mailSubject: '',
  modoPrueba: true,
  microsoftLoginUrl: ''
};

export function MailSettings() {
  const [settings, setSettings] = useState<MailSettingsState>(EMPTY);
  const [draft, setDraft] = useState<MailSettingsState & { smtpAppPassword?: string }>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  useEffect(() => {
    fetchMailSettings().then(r => { if (r.ok) { setSettings(r.settings); setDraft({ ...r.settings, smtpAppPassword: '' }); } }).catch(() => {});
  }, []);

  const update = <K extends keyof typeof draft>(key: K, value: (typeof draft)[K]) => {
    setDraft(d => ({ ...d, [key]: value }));
  };

  const onSave = async () => {
    setBusy(true); setError(''); setInfo('');
    try {
      const payload: Record<string, unknown> = {
        smtpServer: draft.smtpServer,
        smtpPort: Number(draft.smtpPort) || 465,
        smtpUser: draft.smtpUser,
        mailFrom: draft.mailFrom,
        mailSubject: draft.mailSubject,
        microsoftLoginUrl: draft.microsoftLoginUrl,
        modoPrueba: Boolean(draft.modoPrueba)
      };
      if (draft.smtpAppPassword) payload.smtpAppPassword = draft.smtpAppPassword;
      const r = await updateMailSettings(payload);
      if (!r.ok) { setError('No se pudo guardar la configuración'); return; }
      setSettings(r.settings); setDraft({ ...r.settings, smtpAppPassword: '' });
      setInfo('Configuración guardada.');
    } catch {
      setError('Error de conexión.');
    } finally { setBusy(false); }
  };

  return (
    <section className="card tool-card">
      <div className="card-head"><h3>Configuración SMTP / Credenciales 365</h3></div>
      <p className="muted">Editá los datos de envío. Se guardan en el servidor (SQLite). El .env solo se usa como valor inicial.</p>
      <details className="settings-info-block">
        <summary>¿Cómo completar esta configuración?</summary>
        <ol className="smtp-help-list">
          <li>Usá una cuenta institucional autorizada para enviar correos.</li>
          <li>SMTP es el servicio que permite enviar emails desde la app.</li>
          <li>Para Microsoft 365 suele usarse <code>smtp.office365.com</code>.</li>
          <li>El puerto habitual para Microsoft 365 es <code>587</code>.</li>
          <li>SMTP User debe ser el mail completo de la cuenta emisora.</li>
          <li>La contraseña debe ser una contraseña de aplicación o clave SMTP autorizada.</li>
          <li>Si la cuenta tiene doble factor, puede requerir contraseña de aplicación.</li>
          <li>En Microsoft 365 puede ser necesario habilitar SMTP AUTH desde administración.</li>
          <li>Primero usá Modo prueba y revisá la vista previa/reporte.</li>
          <li>Recién después pasá a Modo real.</li>
          <li>La contraseña no se muestra en claro. No la subas a GitHub ni la compartas.</li>
        </ol>
      </details>

      <div className="grid-2">
        <label>SMTP server<input className="input" value={draft.smtpServer} onChange={e => update('smtpServer', e.target.value)} placeholder="smtp.gmail.com" /></label>
        <label>SMTP port<input className="input" type="number" value={draft.smtpPort} onChange={e => update('smtpPort', Number(e.target.value) || 0)} placeholder="465" /></label>
      </div>
      <div className="grid-2">
        <label>SMTP user<input className="input" value={draft.smtpUser} onChange={e => update('smtpUser', e.target.value)} placeholder="usuario@dominio.com" /></label>
        <label>SMTP app password
          <input
            className="input"
            type="password"
            value={draft.smtpAppPassword || ''}
            onChange={e => update('smtpAppPassword', e.target.value)}
            placeholder={settings.smtpAppPasswordSet ? `Guardada (${settings.smtpAppPasswordMasked}). Dejá vacío para conservar.` : 'Sin configurar'}
          />
        </label>
      </div>
      <div className="grid-2">
        <label>Mail from<input className="input" value={draft.mailFrom} onChange={e => update('mailFrom', e.target.value)} placeholder="TechAsset <noreply@dominio.com>" /></label>
        <label>Mail subject<input className="input" value={draft.mailSubject} onChange={e => update('mailSubject', e.target.value)} placeholder="Credenciales de acceso" /></label>
      </div>
      <div className="grid-2">
        <label>Microsoft login URL<input className="input" value={draft.microsoftLoginUrl} onChange={e => update('microsoftLoginUrl', e.target.value)} placeholder="https://login.microsoftonline.com/" /></label>
        <label>Modo de envío
          <select className="input" value={draft.modoPrueba ? 'prueba' : 'real'} onChange={e => update('modoPrueba', e.target.value === 'prueba')}>
            <option value="prueba">Modo prueba (no envía)</option>
            <option value="real">Modo real (envía)</option>
          </select>
        </label>
      </div>

      <div className="actions" style={{ marginTop: 12 }}>
        <Button variant="primary" disabled={busy} onClick={onSave}>Guardar configuración</Button>
      </div>

      {error && <div className="tool-error">{error}</div>}
      {info && <div className="tool-info">{info}</div>}
    </section>
  );
}
