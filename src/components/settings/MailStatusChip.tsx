import { useEffect, useState } from 'react';
import { fetchToolsConfig } from '../../services/toolsApi';

/**
 * Faro del proveedor de mail.
 *
 * Se muestra donde se toman las decisiones que dependen del mail (invitaciones,
 * alta de usuarios). Antes un admin generaba invitaciones sin saber si iban a
 * salir y se enteraba cuando la persona avisaba que no le llegó.
 *
 * El endpoint que consulta ya existía y solo lo usaba el generador de
 * credenciales 365; no expone secretos, solo si cada proveedor está configurado.
 */
type Estado = { modoPrueba: boolean; resend: boolean; smtp: boolean } | null;

export function MailStatusChip() {
  const [estado, setEstado] = useState<Estado>(null);

  useEffect(() => {
    let cancelado = false;
    fetchToolsConfig()
      .then(config => {
        if (cancelado) return;
        setEstado({
          modoPrueba: Boolean(config.modoPrueba),
          resend: Boolean(config.resendConfigurado),
          smtp: Boolean(config.smtpConfigurado)
        });
      })
      .catch(() => undefined);
    return () => { cancelado = true; };
  }, []);

  if (!estado) return null;

  const proveedor = estado.resend ? 'Resend' : estado.smtp ? 'SMTP' : '';
  const tono = estado.modoPrueba ? 'is-test' : estado.resend ? 'is-ok' : estado.smtp ? 'is-warn' : 'is-bad';

  return (
    <div className="mail-status">
      <span className={`mail-status-chip ${tono}`}>
        {proveedor ? `Mail: ${proveedor}` : 'Mail sin configurar'}
      </span>
      {estado.modoPrueba && (
        <span className="mail-status-note">
          Modo prueba activo: las invitaciones no se envían por mail, compartí el link.
        </span>
      )}
      {!estado.modoPrueba && !estado.resend && estado.smtp && (
        <span className="mail-status-note">Resend no está configurado: se usa SMTP.</span>
      )}
      {!estado.modoPrueba && !proveedor && (
        <span className="mail-status-note">Sin proveedor: las invitaciones solo sirven por link copiado.</span>
      )}
    </div>
  );
}
