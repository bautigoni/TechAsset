import { useEffect, useState } from 'react';
import { getMailProviderStatus, type MailProviderStatus } from '../../services/settingsApi';
import { Notice } from './settingsKit';

/**
 * Faro del proveedor de mail (reemplaza a MailStatusChip): una línea de texto,
 * sin pastilla. Va donde se decide algo que depende del mail (invitaciones,
 * configuración SMTP). Si no se puede leer el estado, no se muestra.
 */
export function MailStatusLine({ context, refreshKey = 0 }: { context: 'invites' | 'smtp'; refreshKey?: number }) {
  const [status, setStatus] = useState<MailProviderStatus | null>(null);
  useEffect(() => {
    let cancelled = false;
    getMailProviderStatus().then(value => { if (!cancelled) setStatus(value); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [refreshKey]);
  if (!status) return null;

  const resend = Boolean(status.resendConfigurado);
  const smtp = Boolean(status.smtpConfigurado);
  const provider = resend ? 'Resend' : smtp ? 'SMTP' : '';
  const label = provider ? `Mail: ${provider}` : 'Mail sin configurar';

  let detail = '';
  let tone: 'warn' | 'bad' | 'ok' | 'info' = 'info';
  if (status.modoPrueba) {
    detail = context === 'invites' ? 'Modo prueba activo: las invitaciones no se mandan por mail, compartí el link.' : 'Modo prueba activo: no sale ningún mail, todo queda en el registro.';
    tone = 'warn';
  } else if (resend) {
    detail = 'Los mails salen por Resend.';
    tone = 'ok';
  } else if (smtp) {
    detail = 'Resend no está configurado: se usa SMTP.';
    tone = 'warn';
  } else {
    detail = context === 'invites' ? 'Sin proveedor: las invitaciones solo sirven por link copiado.' : 'Sin proveedor: no sale ningún mail hasta completar estos datos.';
    tone = 'bad';
  }

  return (
    <Notice tone={tone} role="status">
      <span><span className={tone === 'bad' ? 'is-bad cfg-strong' : tone === 'warn' ? 'is-warn cfg-strong' : 'cfg-strong'}>{label}</span> · {detail}</span>
    </Notice>
  );
}
