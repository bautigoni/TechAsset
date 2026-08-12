import { useEffect, useState } from 'react';
import { fetchToolsConfig } from '../../services/toolsApi';
import type { QuickLink } from '../../types';
import { createQuickLink, deleteQuickLink, fetchQuickLinks, updateQuickLink } from '../../services/operationsApi';
import { Button } from '../layout/Button';
import { Modal } from '../layout/Modal';

// Archivos servidos desde public/downloads: no son links configurables, son
// parte de la app, por eso siguen acá y no en la base.
type DownloadLink = { name: string; description: string; url: string; filename: string };

const DOWNLOAD_LINKS: DownloadLink[] = [
  { name: 'Activación Windows / Office (.bat)', description: 'Script institucional. Sólo se descarga, no se ejecuta desde la web.', url: '/downloads/activacion-windows-office.bat', filename: 'activacion-windows-office.bat' },
  { name: 'Reinicio historial WIFI + limpieza DNS (.bat)', description: 'Liberar/renovar IP, flush DNS y reset Winsock/TCP-IP.', url: '/downloads/reinicio-historial-y-dns.bat', filename: 'reinicio-historial-y-dns.bat' }
];

export function useQuickLinks() {
  const [links, setLinks] = useState<QuickLink[]>([]);
  const [handingUrl, setHandingUrl] = useState('');
  const reload = () => fetchQuickLinks().then(r => { if (r.ok) setLinks(r.items); }).catch(() => {});
  useEffect(() => {
    void reload();
    fetchToolsConfig().then(c => setHandingUrl(c.handingTicketUrl || '')).catch(() => {});
  }, []);
  return { links, handingUrl, reload };
}

// Agrupa por categoría para que la lista no sea un chorizo cuando crece.
export function groupLinks(links: QuickLink[]) {
  const map = new Map<string, QuickLink[]>();
  for (const link of links) {
    const key = String(link.categoria || '').trim() || 'Sin categoría';
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(link);
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], 'es'));
}

export function QuickLinkForm({ initial, operator, onDone, onCancel }: {
  initial: Partial<QuickLink>;
  operator: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<Partial<QuickLink>>(initial);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  return (
    <form className="stack" onSubmit={async event => {
      event.preventDefault();
      setError('');
      if (!/^https?:\/\//i.test(String(draft.url || ''))) { setError('Solo se permiten URLs http:// o https://.'); return; }
      setBusy(true);
      try {
        if (draft.id) await updateQuickLink(draft.id, draft);
        else await createQuickLink({ ...draft, operator });
        onDone();
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : 'No se pudo guardar.');
      } finally {
        setBusy(false);
      }
    }}>
      <label>Nombre<input className="input" required value={draft.titulo || ''} onChange={e => setDraft(v => ({ ...v, titulo: e.target.value }))} /></label>
      <label>URL<input className="input" required value={draft.url || ''} onChange={e => setDraft(v => ({ ...v, url: e.target.value }))} placeholder="https://..." /></label>
      <label>Descripción<textarea className="input" rows={2} value={draft.descripcion || ''} onChange={e => setDraft(v => ({ ...v, descripcion: e.target.value }))} /></label>
      <label>Categoría<input className="input" value={draft.categoria || ''} onChange={e => setDraft(v => ({ ...v, categoria: e.target.value }))} placeholder="Institucionales, Personalizados..." /></label>
      {error && <div className="tool-error">{error}</div>}
      <div className="actions">
        <Button variant="primary" type="submit" disabled={busy}>{busy ? 'Guardando...' : 'Guardar'}</Button>
        <Button type="button" onClick={onCancel}>Cancelar</Button>
      </div>
    </form>
  );
}

export function QuickAccess({ operator, consultationMode }: { operator: string; consultationMode: boolean }) {
  const { links, handingUrl, reload } = useQuickLinks();
  const [editing, setEditing] = useState<Partial<QuickLink> | null>(null);
  const [downloadStatus, setDownloadStatus] = useState<Record<string, 'unknown' | 'available' | 'missing'>>({});

  useEffect(() => {
    DOWNLOAD_LINKS.forEach(link => {
      fetch(link.url, { method: 'HEAD' })
        .then(r => setDownloadStatus(s => ({ ...s, [link.url]: r.ok ? 'available' : 'missing' })))
        .catch(() => setDownloadStatus(s => ({ ...s, [link.url]: 'missing' })));
    });
  }, []);

  const groups = groupLinks(links);

  return (
    <>
      <section className="card tool-card">
        <div className="card-head">
          <h3>Accesos rápidos</h3>
          {!consultationMode && <Button variant="primary" onClick={() => setEditing({ titulo: '', url: '', descripcion: '', categoria: 'Institucionales' })}>Nuevo acceso</Button>}
        </div>
        {!links.length && <div className="empty-state">Todavía no hay accesos cargados.</div>}
        {groups.map(([categoria, rows]) => (
          <div className="quick-access-group" key={categoria}>
            <h4>{categoria}</h4>
            <div className="quick-access-grid">
              {rows.map(link => (
                <article key={link.id} className="quick-access-card">
                  <div>
                    <h4>{link.titulo}</h4>
                    {link.descripcion && <p className="muted">{link.descripcion}</p>}
                  </div>
                  <div className="actions">
                    <a className="btn btn-primary" href={link.url} target="_blank" rel="noreferrer">Abrir</a>
                    {!consultationMode && <button className="btn btn-secondary" type="button" onClick={() => setEditing(link)}>Editar</button>}
                    {!consultationMode && <button className="btn btn-secondary" type="button" onClick={async () => {
                      if (!window.confirm(`¿Borrar "${link.titulo}"?`)) return;
                      await deleteQuickLink(link.id, operator);
                      await reload();
                    }}>Borrar</button>}
                  </div>
                </article>
              ))}
            </div>
          </div>
        ))}
        {handingUrl && (
          <p className="muted">Handing configurado en <code>{handingUrl}</code>. Agregalo como acceso si querés tenerlo acá.</p>
        )}
      </section>

      <section className="card tool-card">
        <div className="card-head"><h3>Descargas</h3></div>
        <p className="muted">Estos archivos sólo se descargan, nunca se ejecutan desde la web. Si el archivo no está cargado en el servidor, el botón se deshabilita.</p>
        <div className="quick-access-grid">
          {DOWNLOAD_LINKS.map(link => {
            const status = downloadStatus[link.url] || 'unknown';
            return (
              <article key={link.name} className="quick-access-card">
                <div>
                  <h4>{link.name}</h4>
                  <p className="muted">{link.description}</p>
                </div>
                {status === 'available'
                  ? <a className="btn btn-primary" href={link.url} download={link.filename}>Descargar</a>
                  : <button className="btn btn-secondary" type="button" disabled title="Archivo no cargado">{status === 'missing' ? 'Archivo no cargado' : 'Verificando…'}</button>}
              </article>
            );
          })}
        </div>
      </section>

      {editing && (
        <Modal title={editing.id ? 'Editar acceso' : 'Nuevo acceso rápido'} onClose={() => setEditing(null)}>
          <QuickLinkForm
            initial={editing}
            operator={operator}
            onDone={async () => { setEditing(null); await reload(); }}
            onCancel={() => setEditing(null)}
          />
        </Modal>
      )}
    </>
  );
}
