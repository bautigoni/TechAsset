import { useEffect, useState } from 'react';
import { fetchToolsConfig } from '../../services/toolsApi';
import type { QuickLink } from '../../types';
import { createQuickLink, deleteQuickLink, fetchQuickLinks, updateQuickLink } from '../../services/operationsApi';
import { Button } from '../layout/Button';

type StaticQuickLink = { name: string; description: string; url: string; download?: boolean; filename?: string };

const STATIC_LINKS: StaticQuickLink[] = [
  { name: 'Listas EP', description: 'Planilla de listas de Escuela Primaria', url: 'https://docs.google.com/spreadsheets/d/1ppF2IBLxlLUTZ5HS35_C8SOy07VsjtI2WC9JGlqec7U/edit?gid=1611662790#gid=1611662790' },
  { name: 'Listas ES', description: 'Planilla de listas de Escuela Secundaria', url: 'https://docs.google.com/spreadsheets/d/1uVsdBk3McaT8WQI7Svv3e2wRvx6i5XpV52GlEasVJ0w/edit?gid=1617997660#gid=1617997660' },
  { name: 'Hosking', description: 'Portal Northfield Hosking', url: 'https://northfield.hosking.ar/' },
  { name: 'Tiknology / InvGate', description: 'Crear incidente en mesa de ayuda', url: 'https://tikno.sd.cloud.invgate.net/incident/create' },
  { name: 'Drive TIC', description: 'Carpeta general del equipo TIC', url: 'https://drive.google.com/drive/folders/0AGIDB9iIjXK4Uk9PVA' },
  { name: 'Drive recursos presentaciones/pantalla', description: 'Logos, imágenes y recursos visuales institucionales', url: 'https://drive.google.com/drive/folders/1uhfmwUrYrrWAEtTUGxjCO4xLoGVlGUEV' }
];

const DOWNLOAD_LINKS: StaticQuickLink[] = [
  { name: 'Activación Windows / Office (.bat)', description: 'Script institucional. Sólo se descarga, no se ejecuta desde la web.', url: '/downloads/activacion-windows-office.bat', download: true, filename: 'activacion-windows-office.bat' },
  { name: 'Reinicio historial WIFI + limpieza DNS (.bat)', description: 'Liberar/renovar IP, flush DNS y reset Winsock/TCP-IP.', url: '/downloads/reinicio-historial-y-dns.bat', download: true, filename: 'reinicio-historial-y-dns.bat' }
];

export function QuickAccess({ operator, consultationMode }: { operator: string; consultationMode: boolean }) {
  const [handingUrl, setHandingUrl] = useState('');
  const [custom, setCustom] = useState<QuickLink[]>([]);
  const [editing, setEditing] = useState<Partial<QuickLink> | null>(null);
  const [error, setError] = useState('');
  const [downloadStatus, setDownloadStatus] = useState<Record<string, 'unknown' | 'available' | 'missing'>>({});

  useEffect(() => {
    fetchToolsConfig().then(c => setHandingUrl(c.handingTicketUrl || '')).catch(() => {});
    fetchQuickLinks().then(r => r.ok && setCustom(r.items)).catch(() => {});
    DOWNLOAD_LINKS.forEach(link => {
      fetch(link.url, { method: 'HEAD' })
        .then(r => setDownloadStatus(s => ({ ...s, [link.url]: r.ok ? 'available' : 'missing' })))
        .catch(() => setDownloadStatus(s => ({ ...s, [link.url]: 'missing' })));
    });
  }, []);

  const links: StaticQuickLink[] = [
    ...STATIC_LINKS,
    { name: 'Handing', description: handingUrl ? 'Crear ticket en Handing' : 'Configurar HANDING_TICKET_URL en .env', url: handingUrl }
  ];

  return (
    <>
      <section className="card tool-card">
        <div className="card-head">
          <h3>Accesos rápidos institucionales</h3>
          {!consultationMode && <Button variant="primary" onClick={() => setEditing({ titulo: '', url: '', descripcion: '', categoria: 'Personalizados' })}>Nuevo acceso rápido</Button>}
        </div>
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
        <div className="card-head"><h3>Personalizados</h3></div>
        <div className="quick-access-grid">
          {custom.map(link => (
            <article key={link.id} className="quick-access-card">
              <div>
                <h4>{link.titulo}</h4>
                <p className="muted">{link.descripcion}</p>
                {link.categoria && <span className="badge subtle">{link.categoria}</span>}
              </div>
              <div className="actions">
                <a className="btn btn-primary" href={link.url} target="_blank" rel="noreferrer">Abrir</a>
                {!consultationMode && <button className="btn btn-secondary" type="button" onClick={() => setEditing(link)}>Editar</button>}
                {!consultationMode && <button className="btn btn-secondary" type="button" onClick={async () => { await deleteQuickLink(link.id, operator); const r = await fetchQuickLinks(); if (r.ok) setCustom(r.items); }}>Borrar</button>}
              </div>
            </article>
          ))}
          {!custom.length && <div className="empty-state">Sin accesos personalizados.</div>}
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
      {editing && (
        <section className="modal" onClick={() => setEditing(null)}>
          <form className="modal-card stack" onClick={event => event.stopPropagation()} onSubmit={async event => {
            event.preventDefault();
            setError('');
            if (!/^https?:\/\//i.test(String(editing.url || ''))) { setError('Solo se permiten URLs http:// o https://.'); return; }
            if (editing.id) await updateQuickLink(editing.id, editing);
            else await createQuickLink({ ...editing, operator });
            const r = await fetchQuickLinks(); if (r.ok) setCustom(r.items);
            setEditing(null);
          }}>
            <div className="card-head"><h3>{editing.id ? 'Editar acceso' : 'Nuevo acceso rápido'}</h3><button className="icon-btn" type="button" onClick={() => setEditing(null)}>✕</button></div>
            <label>Nombre<input className="input" required value={editing.titulo || ''} onChange={e => setEditing(v => ({ ...v, titulo: e.target.value }))} /></label>
            <label>URL<input className="input" required value={editing.url || ''} onChange={e => setEditing(v => ({ ...v, url: e.target.value }))} placeholder="https://..." /></label>
            <label>Descripción<textarea className="input" rows={3} value={editing.descripcion || ''} onChange={e => setEditing(v => ({ ...v, descripcion: e.target.value }))} /></label>
            <label>Categoría<input className="input" value={editing.categoria || ''} onChange={e => setEditing(v => ({ ...v, categoria: e.target.value }))} /></label>
            {error && <div className="tool-error">{error}</div>}
            <div className="actions"><Button variant="primary" type="submit">Guardar</Button><Button type="button" onClick={() => setEditing(null)}>Cancelar</Button></div>
          </form>
        </section>
      )}
    </>
  );
}
