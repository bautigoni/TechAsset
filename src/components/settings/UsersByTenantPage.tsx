import { useEffect, useMemo, useState } from 'react';
import {
  getUsersByTenant, runUserAction,
  type AllowedUserAction, type TenantUser, type UsersByTenantResponse
} from '../../services/adminUsersApi';
import { Button } from '../layout/Button';
import { MailStatusChip } from './MailStatusChip';
import { SkeletonPanel } from '../layout/Skeleton';

/**
 * Panel de usuarios de todos los tenants, solo para superadmin.
 *
 * Reemplaza tener que cambiar de sede para ver quién tiene acceso a cada una.
 * Muestra a todos: superadmins, administradores y usuarios comunes, más las
 * invitaciones pendientes — el caso "invitado pero nunca se registró" no
 * aparecía en ningún lado.
 */
function fecha(value: string) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

function statusClass(status: string) {
  if (status === 'Activo') return 'is-activo';
  if (status === 'Pendiente') return 'is-pendiente';
  if (status === 'Rechazado') return 'is-rechazado';
  return 'is-inactivo';
}

function esAdmin(user: TenantUser) {
  return user.esSuperadmin || /admin|jefe/i.test(user.siteRole);
}

export function UsersByTenantPage({ consultationMode }: { consultationMode: boolean }) {
  const [data, setData] = useState<UsersByTenantResponse | null>(null);
  const [abierto, setAbierto] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filtro, setFiltro] = useState<'todos' | 'admins' | 'pendientes'>('todos');
  const [busy, setBusy] = useState(0);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const refresh = () => getUsersByTenant()
    .then(response => {
      setData(response);
      setAbierto(current => current ?? response.tenants[0]?.siteCode ?? null);
    })
    .catch(reason => setError(reason instanceof Error ? reason.message : 'No se pudieron cargar los usuarios.'));

  useEffect(() => { void refresh(); }, []);

  const accion = async (user: TenantUser, action: AllowedUserAction, texto: string) => {
    if (action === 'delete' && !window.confirm(`¿Dar de baja a ${user.email}? Se oculta sin borrar el historial.`)) return;
    setBusy(user.id);
    setError('');
    setMessage('');
    try {
      await runUserAction(user.id, action);
      setMessage(`${user.email}: ${texto}.`);
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo completar la acción.');
    } finally {
      setBusy(0);
    }
  };

  const tenants = data?.tenants || [];
  const tenantAbierto = tenants.find(tenant => tenant.siteCode === abierto) || null;

  const usuariosVisibles = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const lista = tenantAbierto?.users || [];
    return lista
      .filter(user => filtro === 'todos' || (filtro === 'admins' ? esAdmin(user) : user.status === 'Pendiente'))
      .filter(user => !needle || [user.email, user.nombre, user.siteRole].some(value => String(value || '').toLowerCase().includes(needle)));
  }, [tenantAbierto, search, filtro]);

  // Búsqueda global: si escribís algo, importa más encontrar a la persona que
  // en qué tenant estabas parado.
  const coincidenciasGlobales = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle || !data) return [];
    return data.tenants.flatMap(tenant =>
      tenant.users
        .filter(user => [user.email, user.nombre].some(value => String(value || '').toLowerCase().includes(needle)))
        .map(user => ({ tenant: tenant.siteCode, user }))
    );
  }, [data, search]);

  return (
    <section className="view active users-page">
      <header className="inv-head">
        <div>
          <h3>Usuarios</h3>
          <p>Quién tiene acceso a cada tenant: superadmins, administradores y usuarios.</p>
        </div>
        <MailStatusChip />
      </header>

      {data && (
        <div className="inv-kpis">
          <div><span>Usuarios</span><strong>{data.totales.usuarios}</strong></div>
          <div><span>Tenants</span><strong>{data.totales.tenants}</strong></div>
          <div className={data.totales.pendientes ? 'is-warn' : ''}><span>Pendientes</span><strong>{data.totales.pendientes}</strong></div>
          <div className={data.sinSede.length ? 'is-warn' : ''}><span>Sin sede</span><strong>{data.sinSede.length}</strong></div>
        </div>
      )}

      {message && <div className="tool-info">{message}</div>}
      {error && <div className="tool-error">{error}</div>}
      {!data && !error && <SkeletonPanel rows={4} head={false} rowHeight={54} />}

      <div className="inv-toolbar">
        <div className="inventory-segmented" role="group" aria-label="Filtro">
          <button type="button" className={filtro === 'todos' ? 'is-active' : ''} onClick={() => setFiltro('todos')}>Todos</button>
          <button type="button" className={filtro === 'admins' ? 'is-active' : ''} onClick={() => setFiltro('admins')}>Admins</button>
          <button type="button" className={filtro === 'pendientes' ? 'is-active' : ''} onClick={() => setFiltro('pendientes')}>Pendientes</button>
        </div>
        <input className="input" type="search" placeholder="Buscar por mail, nombre o rol" value={search} onChange={event => setSearch(event.target.value)} />
      </div>

      {search.trim() && coincidenciasGlobales.length > 0 && (
        <p className="muted" style={{ fontSize: 12 }}>
          {coincidenciasGlobales.length} coincidencia{coincidenciasGlobales.length === 1 ? '' : 's'} en total:{' '}
          {[...new Set(coincidenciasGlobales.map(item => item.tenant))].join(', ')}
        </p>
      )}

      <div className="users-layout">
        <nav className="users-tenants" aria-label="Tenants">
          {tenants.map(tenant => (
            <button
              key={tenant.siteCode}
              type="button"
              className={`users-tenant ${abierto === tenant.siteCode ? 'is-active' : ''}`}
              onClick={() => setAbierto(tenant.siteCode)}
            >
              <span className="users-tenant-head">
                <strong>{tenant.nombre}</strong>
                <em>{tenant.siteCode}</em>
              </span>
              <span className="users-tenant-counts">
                {tenant.total} usuario{tenant.total === 1 ? '' : 's'}
                {tenant.admins > 0 && <i>{tenant.admins} admin{tenant.admins === 1 ? '' : 's'}</i>}
                {tenant.pendientes > 0 && <i className="is-warn">{tenant.pendientes} pendiente{tenant.pendientes === 1 ? '' : 's'}</i>}
                {tenant.invitacionesActivas > 0 && <i>{tenant.invitacionesActivas} {tenant.invitacionesActivas === 1 ? 'invitación' : 'invitaciones'}</i>}
              </span>
            </button>
          ))}
        </nav>

        <div className="users-detail">
          {tenantAbierto && (
            <>
              <div className="card-head">
                <div>
                  <h4 style={{ margin: 0 }}>{tenantAbierto.nombre}</h4>
                  <span className="muted">{usuariosVisibles.length} de {tenantAbierto.total} usuarios</span>
                </div>
              </div>

              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>Usuario</th><th>Rol</th><th>Turno</th><th>Estado</th><th>Último login</th><th>Acciones</th></tr>
                  </thead>
                  <tbody>
                    {usuariosVisibles.map(user => (
                      <tr key={`${tenantAbierto.siteCode}-${user.id}`}>
                        <td>
                          <strong>{user.nombre || user.email.split('@')[0]}</strong>
                          <small className="muted">{user.email}</small>
                        </td>
                        <td>
                          {user.siteRole}
                          {user.esSuperadmin && <span className="users-tag">superadmin</span>}
                        </td>
                        <td className="muted">{user.turno}</td>
                        <td><span className={`users-status ${statusClass(user.status)}`}>{user.status}</span></td>
                        <td className="muted">{fecha(user.lastLoginAt)}</td>
                        <td>
                          <div className="users-actions">
                            {user.status !== 'Activo' && <button type="button" disabled={consultationMode || busy === user.id} onClick={() => void accion(user, 'approve', 'aprobado')}>Aprobar</button>}
                            {user.status === 'Pendiente' && <button type="button" disabled={consultationMode || busy === user.id} onClick={() => void accion(user, 'reject', 'rechazado')}>Rechazar</button>}
                            {user.status === 'Activo' && <button type="button" disabled={consultationMode || busy === user.id} onClick={() => void accion(user, 'deactivate', 'desactivado')}>Desactivar</button>}
                            <button type="button" className="is-danger" disabled={consultationMode || busy === user.id} onClick={() => void accion(user, 'delete', 'dado de baja')}>Baja</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {!usuariosVisibles.length && <tr><td colSpan={6} className="muted">Sin usuarios para este filtro.</td></tr>}
                  </tbody>
                </table>
              </div>

              {tenantAbierto.invites.length > 0 && (
                <div className="users-invites">
                  <h5>Invitaciones</h5>
                  <div className="table-wrap">
                    <table>
                      <thead><tr><th>Mail</th><th>Rol</th><th>Estado</th><th>Envío</th><th>Vence</th></tr></thead>
                      <tbody>
                        {tenantAbierto.invites.slice(0, 12).map(invite => (
                          <tr key={invite.id}>
                            <td>{invite.email || <span className="muted">solo link</span>}</td>
                            <td className="muted">{invite.role}</td>
                            <td><span className={`users-status ${invite.status === 'Activa' ? 'is-activo' : invite.status === 'Usada' ? 'is-inactivo' : 'is-rechazado'}`}>{invite.status}</span></td>
                            <td className="muted">
                              {invite.emailSentAt ? `Enviado ${fecha(invite.emailSentAt)}` : invite.emailError ? <span className="is-error">{invite.emailError}</span> : invite.email ? 'Sin registro' : '—'}
                            </td>
                            <td className="muted">{fecha(invite.expiresAt)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}

          {data && data.sinSede.length > 0 && (
            <div className="users-invites">
              <h5>Sin sede asignada</h5>
              <p className="muted" style={{ fontSize: 12, margin: '0 0 8px' }}>
                Estos usuarios existen pero no tienen acceso a ningún tenant.
              </p>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Usuario</th><th>Rol</th><th>Estado</th><th>Acciones</th></tr></thead>
                  <tbody>
                    {data.sinSede.map(user => (
                      <tr key={`orphan-${user.id}`}>
                        <td><strong>{user.nombre || user.email.split('@')[0]}</strong><small className="muted">{user.email}</small></td>
                        <td className="muted">{user.siteRole}</td>
                        <td><span className={`users-status ${statusClass(user.status)}`}>{user.status}</span></td>
                        <td>
                          <div className="users-actions">
                            <button type="button" className="is-danger" disabled={consultationMode || busy === user.id} onClick={() => void accion(user, 'delete', 'dado de baja')}>Baja</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="actions">
        <Button onClick={() => void refresh()}>Actualizar</Button>
      </div>
    </section>
  );
}
