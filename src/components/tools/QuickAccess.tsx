import { useEffect, useState } from 'react';
import { fetchToolsConfig } from '../../services/toolsApi';

type QuickLink = { name: string; description: string; url: string; download?: boolean; filename?: string };

const STATIC_LINKS: QuickLink[] = [
  { name: 'Listas EP', description: 'Planilla de listas de Escuela Primaria', url: 'https://docs.google.com/spreadsheets/d/1ppF2IBLxlLUTZ5HS35_C8SOy07VsjtI2WC9JGlqec7U/edit?gid=1611662790#gid=1611662790' },
  { name: 'Listas ES', description: 'Planilla de listas de Escuela Secundaria', url: 'https://docs.google.com/spreadsheets/d/1uVsdBk3McaT8WQI7Svv3e2wRvx6i5XpV52GlEasVJ0w/edit?gid=1617997660#gid=1617997660' },
  { name: 'Hosking', description: 'Portal Northfield Hosking', url: 'https://northfield.hosking.ar/' },
  { name: 'Tiknology / InvGate', description: 'Crear incidente en mesa de ayuda', url: 'https://tikno.sd.cloud.invgate.net/incident/create' },
  { name: 'Drive TIC', description: 'Carpeta general del equipo TIC', url: 'https://drive.google.com/drive/folders/0AGIDB9iIjXK4Uk9PVA' },
  { name: 'Drive recursos presentaciones/pantalla', description: 'Logos, imágenes y recursos visuales institucionales', url: 'https://drive.google.com/drive/folders/1uhfmwUrYrrWAEtTUGxjCO4xLoGVlGUEV' }
];

const DOWNLOAD_LINKS: QuickLink[] = [
  { name: 'Activación Windows / Office (.bat)', description: 'Script institucional. Sólo se descarga, no se ejecuta desde la web.', url: '/downloads/activacion-windows-office.bat', download: true, filename: 'activacion-windows-office.bat' },
  { name: 'Reinicio historial WIFI + limpieza DNS (.bat)', description: 'Liberar/renovar IP, flush DNS y reset Winsock/TCP-IP.', url: '/downloads/reinicio-historial-y-dns.bat', download: true, filename: 'reinicio-historial-y-dns.bat' }
];

export function QuickAccess() {
  const [handingUrl, setHandingUrl] = useState('');
  const [downloadStatus, setDownloadStatus] = useState<Record<string, 'unknown' | 'available' | 'missing'>>({});

  useEffect(() => {
    fetchToolsConfig().then(c => setHandingUrl(c.handingTicketUrl || '')).catch(() => {});
    DOWNLOAD_LINKS.forEach(link => {
      fetch(link.url, { method: 'HEAD' })
        .then(r => setDownloadStatus(s => ({ ...s, [link.url]: r.ok ? 'available' : 'missing' })))
        .catch(() => setDownloadStatus(s => ({ ...s, [link.url]: 'missing' })));
    });
  }, []);

  const links: QuickLink[] = [
    ...STATIC_LINKS,
    { name: 'Handing', description: handingUrl ? 'Crear ticket en Handing' : 'Configurar HANDING_TICKET_URL en .env', url: handingUrl }
  ];

  return (
    <>
      <section className="card tool-card">
        <div className="card-head"><h3>Accesos rápidos institucionales</h3></div>
        <div className="quick-access-grid">
          {links.map(link => (
            <article key={link.name} className="quick-access-card">
              <div>
                <h4>{link.name}</h4>
                <p className="muted">{link.description}</p>
              </div>
              {link.url ? (
                <a className="btn btn-primary" href={link.url} target="_blank" rel="noreferrer">Abrir</a>
              ) : (
                <button className="btn btn-secondary" type="button" disabled title="URL no configurada">Sin configurar</button>
              )}
            </article>
          ))}
        </div>
      </section>

      <section className="card tool-card">
        <div className="card-head"><h3>Descargas</h3></div>
        <p className="muted">Estos archivos sólo se descargan, nunca se ejecutan desde la web. Si el archivo no está cargado en el servidor, el botón se deshabilita.</p>
        <div className="quick-access-grid">
          {DOWNLOAD_LINKS.map(link => {
            const status = downloadStatus[link.url] || 'unknown';
            const ready = status === 'available';
            return (
              <article key={link.name} className="quick-access-card">
                <div>
                  <h4>{link.name}</h4>
                  <p className="muted">{link.description}</p>
                </div>
                {ready ? (
                  <a className="btn btn-primary" href={link.url} download={link.filename}>Descargar</a>
                ) : (
                  <button className="btn btn-secondary" type="button" disabled title="Archivo no cargado">{status === 'missing' ? 'Archivo no cargado' : 'Verificando…'}</button>
                )}
              </article>
            );
          })}
        </div>
      </section>
    </>
  );
}
