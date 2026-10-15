import { useEffect, useState } from 'react';
import type { SiteInfo } from '../../types';
import { type AllowedUserItem, getAllowedUsers, getSites, getSiteSettings, saveAllowedUser, updateAllowedUserStatus } from '../../services/authApi';
import { Button } from '../layout/Button';
import { confirmDialog, toast, errorMessage } from '../layout/Feedback';
import { SelectField } from '../layout/SelectField';

// Fallback: si el tenant no tiene roles.config, se usan estos.
const ADMIN_ROLES = ['Superadmin', 'Jefe TIC', 'Asistente TIC mañana', 'Asistente TIC tarde', 'Asistente TIC general', 'Consulta', 'Otro'];
const SITE_ROLES = ['Jefe TIC', 'Asistente TIC mañana', 'Asistente TIC tarde', 'Asistente TIC general', 'Consulta', 'Otro'];
const TURNS = ['Sin turno', 'Mañana', 'Tarde', 'Todo el día'];
const STATUSES: Array<AllowedUserItem['status']> = ['Pendiente', 'Activo', 'Rechazado', 'Inactivo'];

function emptyUser(siteCode = 'NFPT'): AllowedUserItem {
  return { email: '', nombre: '', defaultRole: 'Consulta', turno: 'Sin turno', defaultSiteCode: siteCode, activo: true, status: 'Activo', canChooseRole: false, sites: [{ siteCode, siteRole: 'Consulta', turno: 'Sin turno', isDefault: true }] };
}

export function AllowedUsersPanel({ canAssignSuperadmin = false, onChanged }: { canAssignSuperadmin?: boolean; onChanged?: () => void }) {
  const [users, setUsers] = useState<AllowedUserItem[]>([]);
  const [sites, setSites] = useState<SiteInfo[]>([]);
  const [draft, setDraft] = useState<AllowedUserItem>(emptyUser());
  const [message, setMessage] = useState('');
  // Los roles salen del roles.config del tenant, igual que en InvitesPanel.
  // Estaban hardcodeados y no coincidian con lo que se siembra en un tenant
  // nuevo (Administrador/Asistente/Consulta): se podian crear usuarios con
  // roles inexistentes en su propia sede.
  const [tenantRoles, setTenantRoles] = useState<string[]>([]);
  const roles = tenantRoles.length
    ? (canAssignSuperadmin ? [...new Set(['Superadmin', ...tenantRoles])] : tenantRoles)
    : (canAssignSuperadmin ? ADMIN_ROLES : SITE_ROLES);

  const load = async () => {
    const [u, s] = await Promise.all([getAllowedUsers(), getSites()]);
    setUsers(u.items);
    setSites(s.items);
    setDraft(current => current.email ? current : emptyUser(s.items[0]?.siteCode || 'NFPT'));
  };

  useEffect(() => { load().catch(reason => toast({ message: errorMessage(reason, 'No se pudo cargar la lista de usuarios.'), tone: 'error' })); }, []);

  useEffect(() => {
    getSiteSettings().then(response => {
      const config = (response.settings as Record<string, unknown>)?.['roles.config'];
      if (!Array.isArray(config) || !config.length) return;
      const nombres = config.map(item => String((item as { name?: string }).name || '')).filter(Boolean);
      if (nombres.length) setTenantRoles(nombres);
    }).catch(() => {});
  }, []);

  const selected = new Set((draft.sites || []).filter(site => site.activo !== false).map(site => site.siteCode));
  const toggleSite = (siteCode: string, checked: boolean) => {
    setDraft(current => {
      const map = new Map((current.sites || []).map(site => [site.siteCode, site]));
      if (checked) map.set(siteCode, { siteCode, siteRole: current.defaultRole, turno: current.turno || 'Sin turno', isDefault: !current.defaultSiteCode });
      else map.delete(siteCode);
      const sitesNext = [...map.values()];
      const defaultSiteCode = sitesNext.some(site => site.siteCode === current.defaultSiteCode) ? current.defaultSiteCode : sitesNext[0]?.siteCode || '';
      return { ...current, defaultSiteCode, sites: sitesNext.map(site => ({ ...site, isDefault: site.siteCode === defaultSiteCode })) };
    });
  };

  const save = async () => {
    if (!draft.email.includes('@')) {
      setMessage('Mail inválido.');
      return;
    }
    const status = draft.status || (draft.activo === false ? 'Inactivo' : 'Activo');
    await saveAllowedUser({
      ...draft,
      status,
      activo: status === 'Activo',
      sites: (draft.sites || []).map(site => ({ ...site, siteRole: draft.defaultRole, turno: draft.turno || 'Sin turno', isDefault: site.siteCode === draft.defaultSiteCode }))
    });
    setMessage('Usuario guardado.');
    setDraft(emptyUser(sites[0]?.siteCode || 'NFPT'));
    await load();
    onChanged?.();
  };

  const runAction = async (user: AllowedUserItem, action: 'approve' | 'reject' | 'deactivate' | 'delete') => {
    if (!user.id) return;
    if (action === 'delete' && !(await confirmDialog({ title: 'Borrar usuario', message: `¿Borrar ${user.email}? Pierde el acceso; su historial queda.`, confirmLabel: 'Borrar', danger: true }))) return;
    await updateAllowedUserStatus(user.id, action);
    const labels = { approve: 'Usuario aprobado.', reject: 'Usuario rechazado.', deactivate: 'Usuario desactivado.', delete: 'Usuario borrado.' };
    setMessage(labels[action]);
    await load();
    onChanged?.();
  };

  return (
    <section className="card">
      <div className="card-head">
        <h3>Usuarios permitidos</h3>
        <Button onClick={() => setDraft(emptyUser(sites[0]?.siteCode || 'NFPT'))}>Nuevo usuario</Button>
      </div>
      <div className="table-wrap">
        <table className="compact-table allowed-users-table">
          <thead><tr><th>Mail</th><th>Rol</th><th>Sedes</th><th>Estado</th><th>Acciones</th></tr></thead>
          <tbody>
            {users.map(user => (
              <tr key={user.id || user.email}>
                <td><strong className="allowed-user-email" title={user.email}>{user.email}</strong><div className="cell-sub">{user.nombre}</div></td>
                <td>{user.defaultRole}</td>
                <td>{(user.sites || []).filter(site => site.activo !== false).map(site => site.siteCode).join(', ') || '-'}</td>
                <td>{user.status || (user.activo === false ? 'Inactivo' : 'Activo')}</td>
                <td>
                  <div className="actions compact-actions">
                    <Button className="mini-action-btn" onClick={() => setDraft({ ...user, turno: user.sites?.[0]?.turno || user.turno || 'Sin turno', defaultSiteCode: user.sites?.find(site => site.isDefault)?.siteCode || user.sites?.[0]?.siteCode || sites[0]?.siteCode || 'NFPT' })}>Editar</Button>
                    {user.status === 'Pendiente' && <Button className="mini-action-btn" onClick={() => runAction(user, 'approve')}>Aprobar</Button>}
                    {user.status === 'Pendiente' && <Button className="mini-action-btn" onClick={() => runAction(user, 'reject')}>Rechazar</Button>}
                    {user.status === 'Activo' && <Button className="mini-action-btn" onClick={() => runAction(user, 'deactivate')}>Desactivar</Button>}
                    <Button className="mini-action-btn" onClick={() => runAction(user, 'delete')}>Borrar</Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="site-admin-form">
        <div className="grid-2">
          <label>Mail<input className="input" value={draft.email} onChange={e => setDraft(s => ({ ...s, email: e.target.value.toLowerCase() }))} placeholder="usuario@northfield.edu.ar" /></label>
          <label>Nombre<input className="input" value={draft.nombre} onChange={e => setDraft(s => ({ ...s, nombre: e.target.value }))} /></label>
        </div>
        <div className="grid-2">
          <label>Rol<SelectField value={String(draft.defaultRole)} onChange={value => setDraft(s => ({ ...s, defaultRole: value }))} options={[...roles.map(role => ({ value: String(role), label: String(role) }))]} /></label>
          <label>Turno<SelectField value={String(draft.turno || 'Sin turno')} onChange={value => setDraft(s => ({ ...s, turno: value }))} options={[...TURNS.map(turn => ({ value: String(turn), label: String(turn) }))]} /></label>
        </div>
        <label>Estado
          <SelectField value={String(draft.status || 'Activo')} onChange={value => setDraft(s => ({ ...s, status: value as AllowedUserItem['status'], activo: value === 'Activo' }))} options={[...STATUSES.map(status => ({ value: String(status), label: String(status) }))]} />
        </label>
        <div className="site-check-grid">
          {sites.map(site => (
            <label key={site.siteCode} className="equipment-option active">
              <input type="checkbox" checked={selected.has(site.siteCode)} onChange={e => toggleSite(site.siteCode, e.target.checked)} />
              <span>{site.siteCode}</span>
            </label>
          ))}
        </div>
        <label>Sede default
          <SelectField ariaLabel="Sede default" value={draft.defaultSiteCode || ''} onChange={defaultSiteCode => setDraft(s => ({ ...s, defaultSiteCode }))} options={(draft.sites || []).map(site => ({ value: site.siteCode, label: site.siteCode }))} />
        </label>
        <div className="actions"><Button variant="primary" onClick={save}>Guardar usuario</Button></div>
        {message && <div className={message.includes('guardado') || message.includes('Usuario') ? 'tool-info' : 'tool-error'}>{message}</div>}
      </div>
    </section>
  );
}
