import { useEffect, useState } from 'react';
import type { AuthUser, SiteInfo } from '../../types';
import { getSites, saveSite } from '../../services/authApi';
import { Button } from '../layout/Button';

const blankSite: SiteInfo & { isNew?: boolean } = {
  siteCode: '',
  nombre: '',
  subtitulo: '',
  activo: true,
  spreadsheetUrl: '',
  inventorySheetName: '',
  themeColor: '',
  logo: '',
  isNew: true
};

export function SiteAdminPanel({ user, onChanged }: { user: AuthUser; onChanged?: () => void }) {
  const [sites, setSites] = useState<SiteInfo[]>([]);
  const [draft, setDraft] = useState<SiteInfo & { isNew?: boolean }>(blankSite);
  const [message, setMessage] = useState('');

  const load = () => getSites().then(r => setSites(r.items));
  useEffect(() => { load().catch(() => setSites([])); }, []);
  const isSuperadmin = user.rolGlobal === 'Superadmin';

  const edit = (site: SiteInfo) => {
    setDraft({ ...site, isNew: false });
    setMessage('');
  };

  const save = async () => {
    if (!draft.siteCode.trim()) {
      setMessage('Falta código de sede.');
      return;
    }
    await saveSite({ ...draft, siteCode: draft.siteCode.toUpperCase().trim() });
    setMessage('Sede guardada.');
    setDraft(blankSite);
    await load();
    onChanged?.();
  };

  return (
    <section className="card">
      <div className="card-head">
        <h3>Administrar sedes</h3>
        {isSuperadmin && <Button onClick={() => setDraft(blankSite)}>Nueva sede</Button>}
      </div>
      <div className="table-wrap">
        <table className="compact-table">
          <thead><tr><th>Código</th><th>Nombre</th><th>CSV importación</th><th>Estado</th><th></th></tr></thead>
          <tbody>
            {sites.map(site => (
              <tr key={site.siteCode}>
                <td><strong>{site.siteCode}</strong></td>
                <td>{site.nombre}<div className="cell-sub">{site.subtitulo}</div></td>
                <td>{site.spreadsheetUrl ? 'Configurado' : '-'}</td>
                <td>{site.activo === false ? 'Inactiva' : 'Activa'}</td>
                <td><Button className="mini-action-btn" onClick={() => edit(site)}>Editar</Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="site-admin-form">
        <div className="grid-2">
          <label>Código<input className="input" value={draft.siteCode} disabled={!draft.isNew || !isSuperadmin} onChange={e => setDraft(s => ({ ...s, siteCode: e.target.value.toUpperCase() }))} placeholder="NFND" /></label>
          <label>Nombre<input className="input" value={draft.nombre || ''} onChange={e => setDraft(s => ({ ...s, nombre: e.target.value }))} placeholder="Northfield Nordelta" /></label>
        </div>
        <label>Subtítulo<input className="input" value={draft.subtitulo || ''} onChange={e => setDraft(s => ({ ...s, subtitulo: e.target.value }))} /></label>
        <label>URL CSV para importación manual<input className="input" value={draft.spreadsheetUrl || ''} onChange={e => setDraft(s => ({ ...s, spreadsheetUrl: e.target.value }))} placeholder="https://docs.google.com/spreadsheets/...output=csv" /></label>
        <div className="grid-2">
          <label>Inventory sheet name<input className="input" value={draft.inventorySheetName || ''} onChange={e => setDraft(s => ({ ...s, inventorySheetName: e.target.value }))} /></label>
          <label>Color / logo<input className="input" value={draft.themeColor || ''} onChange={e => setDraft(s => ({ ...s, themeColor: e.target.value }))} placeholder="#2563eb" /></label>
        </div>
        {isSuperadmin && <label className="toggle-row">
          <input type="checkbox" checked={draft.activo !== false} onChange={e => setDraft(s => ({ ...s, activo: e.target.checked }))} />
          <span>Sede activa</span>
        </label>}
        <div className="actions"><Button variant="primary" onClick={save}>Guardar sede</Button></div>
        {message && <div className={message.includes('guardada') ? 'tool-info' : 'tool-error'}>{message}</div>}
      </div>
    </section>
  );
}
