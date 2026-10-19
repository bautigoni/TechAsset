import { useCallback, useEffect, useState } from 'react';
import { Download, Terminal } from 'lucide-react';
import { Button, StatusText, TruncatedText, icons } from '../../ui';

/**
 * Scripts .bat de `public/downloads/` (parte de la app, no links de la base).
 * Se DESCARGAN a la compu (nunca se ejecutan desde la web). Antes de ofrecer
 * "Descargar" se verifica con HEAD que el archivo exista en el server; si no,
 * la fila lo dice (con Reintentar) en vez de mostrar un botón que falla.
 * Se usa en Herramientas › Descargas y en Accesos rápidos (decisión del dueño:
 * los dos lugares).
 */

export type DownloadLink = { name: string; description: string; url: string; filename: string };

export const DOWNLOAD_LINKS: DownloadLink[] = [
  { name: 'Activación Windows / Office', description: 'Script institucional. Solo se descarga; se ejecuta en la PC.', url: '/downloads/activacion-windows-office.bat', filename: 'activacion-windows-office.bat' },
  { name: 'Reinicio historial WiFi + limpieza DNS', description: 'Libera y renueva la IP, vacía la caché DNS y resetea Winsock/TCP-IP.', url: '/downloads/reinicio-historial-y-dns.bat', filename: 'reinicio-historial-y-dns.bat' }
];

type Availability = 'checking' | 'available' | 'missing';

export function useDownloadStatus() {
  const [status, setStatus] = useState<Record<string, Availability>>({});
  const check = useCallback((link: DownloadLink) => {
    setStatus(current => ({ ...current, [link.url]: 'checking' }));
    fetch(link.url, { method: 'HEAD', cache: 'no-store' })
      .then(response => setStatus(current => ({ ...current, [link.url]: response.ok ? 'available' : 'missing' })))
      .catch(() => setStatus(current => ({ ...current, [link.url]: 'missing' })));
  }, []);
  useEffect(() => { DOWNLOAD_LINKS.forEach(check); }, [check]);
  return { status, check };
}

export function DownloadList({ compact = false }: { compact?: boolean }) {
  const { status, check } = useDownloadStatus();
  const [clicked, setClicked] = useState<string | null>(null);
  return (
    <ul className={`tl-dl${compact ? ' tl-dl--compact' : ''}`} aria-label="Scripts para descargar">
      {DOWNLOAD_LINKS.map(link => {
        const state = status[link.url] || 'checking';
        return (
          <li key={link.url} className="tl-dl-row">
            <span className="tl-dl-icon" aria-hidden="true"><Terminal size={16} strokeWidth={1.6} /></span>
            <span className="tl-dl-text">
              <TruncatedText className="tl-dl-name" lines={2}>{link.name}</TruncatedText>
              <TruncatedText className="tl-dl-file">{state === 'missing' ? 'Archivo no cargado en el servidor' : link.filename}</TruncatedText>
              {!compact && <TruncatedText className="tl-dl-desc" lines={2}>{link.description}</TruncatedText>}
            </span>
            <span className="tl-dl-action">
              {state === 'available' && (
                <a
                  className="ui-btn ui-btn--secondary ui-btn--sm"
                  href={link.url}
                  download={link.filename}
                  onClick={() => { setClicked(link.url); window.setTimeout(() => setClicked(current => (current === link.url ? null : current)), 4000); }}
                >
                  <span className="ui-btn-icon">{clicked === link.url ? <icons.IconCheck size={14} /> : <Download size={14} strokeWidth={1.6} />}</span>
                  <span className="ui-btn-label">{clicked === link.url ? 'Descargando' : 'Descargar'}</span>
                </a>
              )}
              {state === 'checking' && <StatusText tone="muted">Verificando…</StatusText>}
              {state === 'missing' && <Button size="sm" variant="ghost" icon={<icons.IconRetry size={14} />} onClick={() => check(link)}>Reintentar</Button>}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
