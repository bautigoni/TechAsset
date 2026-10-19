import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Plus, RefreshCw, Search } from 'lucide-react';
import type { SiteInfo } from '../../types';
import { Button, Collapse, EmptyState, ErrorState, InlineConfirm, Input, Segmented, SkeletonRows, StatusLine } from '../../ui';
import { cx, fold } from '../../ui/util';
import { getSiteSettings, getSites, saveAllowedUser, updateAllowedUserStatus, type AllowedUserItem } from '../../services/authApi';
import { getManagedUsers, undoUserAction, type ManagedUser, type UserStatus } from '../../services/settingsApi';
import { getUsersByTenant, type TenantInvite } from '../../services/adminUsersApi';
import { formatDate } from '../../utils/formatters';
import { Card, CardFoot, CheckField, ChoiceField, errorText, useDirty } from './settingsKit';

// Si la sede no tiene roles.config, los de siempre.
const FALLBACK_ROLES = ['Jefe TIC', 'Asistente TIC mañana', 'Asistente TIC tarde', 'Asistente TIC general', 'Consulta', 'Otro'];
const DEFAULT_TURNS = ['Sin turno', 'Mañana', 'Tarde', 'Todo el día'];
const STATUSES: UserStatus[] = ['Pendiente', 'Activo', 'Rechazado', 'Inactivo'];
const PAGE = 40;

type Action = 'approve' | 'reject' | 'deactivate' | 'delete';
type Filter = 'todos' | 'pendientes' | 'admins' | 'sinsede';
type FormDraft = {
  id?: number;
  email: string;
  nombre: string;
  role: string;
  turno: string;
  status: UserStatus;
  sites: string[];
  defaultSite: string;
};
type RowNote = { key: number; tone: 'ok' | 'bad'; text: string; undo?: { prev: UserStatus } };

const ACTION_DONE: Record<Action, { status: UserStatus; text: (name: string) => string }> = {
  approve: { status: 'Activo', text: name => `Aprobaste a ${name}. Le avisamos por mail en unos segundos.` },
  reject: { status: 'Rechazado', text: name => `Rechazaste la solicitud de ${name}. Le avisamos por mail en unos segundos.` },
  deactivate: { status: 'Inactivo', text: name => `Desactivaste a ${name}: ya no puede entrar. Le avisamos por mail en unos segundos.` },
  delete: { status: 'Inactivo', text: name => `Borraste a ${name}: pierde el acceso, su historial queda.` }
};

const displayName = (user: { nombre?: string; email: string }) => user.nombre?.trim() || user.email.split('@')[0];
const shortDate = (value?: string) => {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : formatDate(date, { day: '2-digit', month: '2-digit', year: '2-digit' });
};
const activeSitesOf = (user: AllowedUserItem) => (user.sites || []).filter(site => site.activo !== false);

/**
 * Usuarios: une "Usuarios permitidos" (Configuración vieja) y "Usuarios por
 * tenant" (superadmin). Pendientes primero; aprobar, rechazar y desactivar con
 * Deshacer (el mail sale recién cuando vence la ventana); borrar con
 * confirmación en línea; edición debajo de la fila. El superadmin ve todas las
 * sedes y filtra por sede, sin sede y admins.
 */
export function UsersPanel({ header, readOnly, siteCode, superadmin, sites: sessionSites, onChanged }: {
  header: (actions?: ReactNode) => ReactNode;
  readOnly: boolean;
  siteCode: string;
  superadmin: boolean;
  sites: SiteInfo[];
  onChanged?: () => void;
}) {
  const [users, setUsers] = useState<ManagedUser[] | null>(null);
  const [order, setOrder] = useState<number[]>([]);
  const [allSites, setAllSites] = useState<SiteInfo[]>(sessionSites);
  const [tenantRoles, setTenantRoles] = useState<Array<{ name: string; admin: boolean }>>([]);
  const [turns, setTurns] = useState<string[]>(DEFAULT_TURNS);
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<Filter>('todos');
  const [siteFilter, setSiteFilter] = useState('todas');
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const [busy, setBusy] = useState(0);
  const [editing, setEditing] = useState<number | 'new' | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(0);
  const [notes, setNotes] = useState<Record<number, RowNote>>({});
  const [deleted, setDeleted] = useState<Set<number>>(new Set());
  const [invites, setInvites] = useState<Record<string, TenantInvite[]>>({});
  const noteKey = useRef(0);

  /* ── Datos ── */
  const load = useCallback(async (keepOrder: boolean) => {
    setLoading(true);
    setLoadError('');
    try {
      const response = await getManagedUsers();
      const items = response.items.map(user => ({ ...user, id: Number(user.id) }));
      setUsers(items);
      setOrder(current => {
        if (!keepOrder || !current.length) return items.map(user => user.id);
        const known = new Set(current);
        const fresh = items.filter(user => !known.has(user.id)).map(user => user.id);
        return [...fresh, ...current.filter(id => items.some(user => user.id === id))];
      });
    } catch (reason) {
      setLoadError(errorText(reason, 'No se pudo cargar la lista de usuarios.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
    getSites().then(response => setAllSites(response.items || [])).catch(() => undefined);
    getSiteSettings().then(response => {
      const cfg = response.settings?.['roles.config'];
      if (Array.isArray(cfg)) setTenantRoles(cfg.map(item => ({ name: String((item as { name?: string }).name || '').trim(), admin: Boolean((item as { admin?: boolean }).admin) })).filter(item => item.name));
      const shifts = response.settings?.['shift.options'];
      if (Array.isArray(shifts) && shifts.length) setTurns(shifts.map(String));
    }).catch(() => undefined);
  }, [load]);

  // Invitaciones por sede (solo superadmin, al filtrar por una sede).
  useEffect(() => {
    if (!superadmin || siteFilter === 'todas' || invites[siteFilter]) return;
    getUsersByTenant()
      .then(response => setInvites(Object.fromEntries(response.tenants.map(tenant => [tenant.siteCode, tenant.invites]))))
      .catch(() => undefined);
  }, [superadmin, siteFilter, invites]);

  const adminNames = useMemo(() => new Set(tenantRoles.filter(role => role.admin).map(role => role.name)), [tenantRoles]);
  const isAdminUser = useCallback((user: ManagedUser) => {
    if (user.defaultRole === 'Superadmin') return true;
    const roles = activeSitesOf(user).map(site => site.siteRole || user.defaultRole);
    return [user.defaultRole, ...roles].some(role => adminNames.has(String(role)) || /admin|jefe/i.test(String(role)));
  }, [adminNames]);
  const isOrphan = (user: ManagedUser) => user.defaultRole !== 'Superadmin' && activeSitesOf(user).length === 0;

  const byId = useMemo(() => new Map((users || []).map(user => [user.id, user])), [users]);
  const ordered = useMemo(() => order.map(id => byId.get(id)).filter(Boolean) as ManagedUser[], [order, byId]);

  const matchesQuery = useCallback((user: ManagedUser, q: string) => !q || [user.email, user.nombre, user.defaultRole, ...activeSitesOf(user).map(site => site.siteRole || '')].some(value => fold(String(value || '')).includes(q)), []);
  const matchesSite = (user: ManagedUser) => siteFilter === 'todas' || activeSitesOf(user).some(site => site.siteCode === siteFilter);
  const q = fold(query);

  const visible = ordered.filter(user => {
    if (!matchesSite(user)) return false;
    if (filter === 'pendientes' && user.status !== 'Pendiente') return false;
    if (filter === 'admins' && !isAdminUser(user)) return false;
    if (filter === 'sinsede' && !isOrphan(user)) return false;
    return matchesQuery(user, q);
  });

  const counts = {
    todos: ordered.filter(matchesSite).length,
    pendientes: ordered.filter(user => matchesSite(user) && user.status === 'Pendiente').length,
    admins: ordered.filter(user => matchesSite(user) && isAdminUser(user)).length,
    sinsede: ordered.filter(isOrphan).length
  };
  // Si hay texto y el filtro de sede esconde coincidencias, se dice dónde están.
  const elsewhere = superadmin && q && siteFilter !== 'todas'
    ? [...new Set(ordered.filter(user => !matchesSite(user) && matchesQuery(user, q)).flatMap(user => activeSitesOf(user).map(site => site.siteCode)))]
    : [];


  /* ── Acciones ── */
  const showNote = (id: number, note: Omit<RowNote, 'key'>) => {
    noteKey.current += 1;
    setNotes(current => ({ ...current, [id]: { ...note, key: noteKey.current } }));
  };
  const clearNote = (id: number) => setNotes(current => { const next = { ...current }; delete next[id]; return next; });

  const patchUser = (id: number, change: Partial<ManagedUser>) => setUsers(current => current ? current.map(user => (user.id === id ? { ...user, ...change } : user)) : current);

  const run = async (user: ManagedUser, action: Action) => {
    if (readOnly || busy) return;
    const prev = user.status;
    setBusy(user.id);
    setConfirmDelete(0);
    try {
      await updateAllowedUserStatus(user.id, action);
      const done = ACTION_DONE[action];
      if (action === 'delete') setDeleted(current => new Set(current).add(user.id));
      else patchUser(user.id, { status: done.status, activo: done.status === 'Activo' });
      showNote(user.id, { tone: 'ok', text: done.text(displayName(user)), undo: { prev } });
      onChanged?.();
    } catch (reason) {
      showNote(user.id, { tone: 'bad', text: errorText(reason, 'No se pudo completar la acción sobre el usuario.') });
    } finally {
      setBusy(0);
    }
  };

  const undo = async (user: ManagedUser, prev: UserStatus) => {
    try {
      const response = await undoUserAction(user.id, prev);
      setDeleted(current => { const next = new Set(current); next.delete(user.id); return next; });
      patchUser(user.id, { status: prev, activo: prev === 'Activo' });
      showNote(user.id, { tone: 'ok', text: response.mailCancelled ? `Listo: ${displayName(user)} volvió a ${prev}. No se mandó ningún mail.` : `Listo: ${displayName(user)} volvió a ${prev}.` });
      onChanged?.();
    } catch (reason) {
      showNote(user.id, { tone: 'bad', text: errorText(reason, 'No se pudo deshacer.') });
    }
  };

  const expireNote = (id: number) => {
    clearNote(id);
    // Un borrado confirmado (sin deshacer) se va de la lista.
    if (deleted.has(id)) {
      setOrder(current => current.filter(item => item !== id));
      setDeleted(current => { const next = new Set(current); next.delete(id); return next; });
    }
  };

  /* ── Formulario (nuevo y editar) ── */
  const roleOptions = useMemo(() => {
    const names = tenantRoles.length ? tenantRoles.map(role => role.name) : FALLBACK_ROLES;
    return superadmin ? [...new Set(['Superadmin', ...names])] : names.filter(name => name !== 'Superadmin');
  }, [tenantRoles, superadmin]);

  const emptyDraft = (): FormDraft => ({
    email: '', nombre: '', role: roleOptions.includes('Consulta') ? 'Consulta' : roleOptions[roleOptions.length - 1] || 'Consulta',
    turno: 'Sin turno', status: 'Activo', sites: [siteCode], defaultSite: siteCode
  });
  const draftFor = (user: ManagedUser): FormDraft => {
    const sites = activeSitesOf(user);
    const here = sites.find(site => site.siteCode === siteCode) || sites[0];
    return {
      id: user.id,
      email: user.email,
      nombre: user.nombre || '',
      role: user.defaultRole === 'Superadmin' ? 'Superadmin' : (here?.siteRole || user.defaultRole || 'Consulta'),
      turno: here?.turno || user.turno || 'Sin turno',
      status: user.status,
      sites: sites.map(site => site.siteCode),
      defaultSite: sites.find(site => site.isDefault)?.siteCode || sites[0]?.siteCode || siteCode
    };
  };

  const openNew = () => { setEditing(current => (current === 'new' ? null : 'new')); setConfirmDelete(0); };

  const listCard = (
    <Card ariaLabel="Usuarios permitidos" className="cfg-users">
      <div className="cfg-toolbar">
        <Segmented
          ariaLabel="Filtrar por estado"
          size="sm"
          value={filter}
          onChange={value => { setFilter(value); setLimit(PAGE); }}
          options={[
            { value: 'todos', label: 'Todos', count: counts.todos },
            { value: 'pendientes', label: 'Pendientes', count: counts.pendientes },
            { value: 'admins', label: 'Admins', count: counts.admins },
            ...(superadmin ? [{ value: 'sinsede' as const, label: 'Sin sede', count: counts.sinsede }] : [])
          ]}
        />
        {superadmin && allSites.length > 1 && (
          <Segmented
            ariaLabel="Filtrar por sede"
            size="sm"
            value={siteFilter}
            onChange={value => { setSiteFilter(value); setLimit(PAGE); }}
            options={[{ value: 'todas', label: 'Todas' }, ...allSites.map(site => ({ value: site.siteCode, label: site.siteCode, count: ordered.filter(user => activeSitesOf(user).some(item => item.siteCode === site.siteCode)).length }))]}
          />
        )}
        <Input
          className="cfg-search"
          size="sm"
          enterKeyHint="search"
          aria-label="Buscar por mail, nombre o rol"
          placeholder="Mail, nombre o rol"
          prefix={<Search size={14} aria-hidden="true" />}
          value={query}
          data-scanner-ignore=""
          onValueChange={value => { setQuery(value); setLimit(PAGE); }}
        />
      </div>
      {elsewhere.length > 0 && <p className="cfg-hint cfg-pad-x">También hay coincidencias en {elsewhere.join(', ')}.</p>}

      <Collapse open={editing === 'new'} unmountOnClose data-scanner-ignore="">
        <UserForm
          key="new"
          title="Nuevo usuario"
          initial={emptyDraft()}
          roleOptions={roleOptions}
          turns={turns}
          sites={allSites}
          siteCode={siteCode}
          superadmin={superadmin}
          readOnly={readOnly}
          onCancel={() => setEditing(null)}
          onSaved={async saved => {
            setEditing(null);
            await load(true);
            const created = (saved.id && Number(saved.id)) || 0;
            if (created) showNote(created, { tone: 'ok', text: `Guardaste a ${displayName(saved)}. Rige al instante.` });
            onChanged?.();
          }}
        />
      </Collapse>

      {users === null && !loadError && <div className="cfg-pad"><SkeletonRows rows={5} /></div>}
      {loadError && <div className="cfg-pad"><ErrorState message={loadError} onRetry={() => void load(true)} retrying={loading} /></div>}

      {users !== null && (
        <div className="cfg-table cfg-tu" role="table" aria-label="Usuarios">
          <div className="cfg-trow cfg-urow is-head" role="row">
            <span role="columnheader">Usuario</span>
            <span role="columnheader">Rol y turno</span>
            <span role="columnheader">Sedes</span>
            <span role="columnheader">Estado</span>
            <span role="columnheader" className="cfg-urow-act">Acciones</span>
          </div>
          {visible.slice(0, limit).map(user => {
            const isDeleted = deleted.has(user.id);
            const sites = activeSitesOf(user);
            const here = sites.find(site => site.siteCode === siteCode) || sites[0];
            const role = user.defaultRole === 'Superadmin' ? 'Superadmin' : (here?.siteRole || user.defaultRole);
            const note = notes[user.id];
            const rowBusy = busy === user.id;
            const disabled = readOnly || Boolean(busy);
            return (
              <div className={cx('cfg-tgroup', isDeleted && 'is-deleted')} key={user.id} data-user-row={user.email}>
                <div className="cfg-trow cfg-urow" role="row">
                  <span className="cfg-ucell cfg-u-user" role="cell">
                    <span className="cfg-strong cfg-wrap">{displayName(user)}</span>
                    <span className="cfg-t3 cfg-break">{user.email}</span>
                  </span>
                  <span className="cfg-ucell cfg-u-role" role="cell">
                    <span className="cfg-wrap">{role}</span>
                    <span className="cfg-t3">{here?.turno || user.turno || 'Sin turno'}</span>
                  </span>
                  <span className="cfg-ucell cfg-u-sites cfg-mono cfg-t2" role="cell">{user.defaultRole === 'Superadmin' ? 'Todas' : sites.map(site => site.siteCode).join(' · ') || <span className="is-warn">Sin sede</span>}</span>
                  <span className="cfg-ucell cfg-u-state" role="cell">
                    <span className={cx('cfg-nowrap', isDeleted ? 'cfg-t3' : user.status === 'Pendiente' ? 'is-warn cfg-strong' : user.status === 'Activo' ? 'cfg-t2' : 'cfg-t3')}>{isDeleted ? 'Borrado' : user.status}</span>
                    <span className="cfg-t3 cfg-mono cfg-nowrap">{user.lastLoginAt ? shortDate(user.lastLoginAt) : 'nunca entró'}</span>
                  </span>
                  <span className="cfg-ucell cfg-urow-act" role="cell">
                    {!isDeleted && (
                      <>
                        {user.status !== 'Activo' && <Button size="sm" variant="secondary" loading={rowBusy} disabled={disabled} onClick={() => void run(user, 'approve')}>{user.status === 'Pendiente' ? 'Aprobar' : 'Reactivar'}</Button>}
                        {user.status === 'Pendiente' && <Button size="sm" variant="ghost" disabled={disabled} onClick={() => void run(user, 'reject')}>Rechazar</Button>}
                        {user.status === 'Activo' && <Button size="sm" variant="ghost" loading={rowBusy} disabled={disabled} onClick={() => void run(user, 'deactivate')}>Desactivar</Button>}
                        <Button size="sm" variant="ghost" aria-expanded={editing === user.id} disabled={readOnly} onClick={() => { setEditing(editing === user.id ? null : user.id); setConfirmDelete(0); }}>{editing === user.id ? 'Cerrar' : 'Editar'}</Button>
                        <Button size="sm" variant="ghost" className="cfg-danger-text" disabled={disabled} aria-expanded={confirmDelete === user.id} onClick={() => setConfirmDelete(confirmDelete === user.id ? 0 : user.id)}>Borrar</Button>
                      </>
                    )}
                  </span>
                </div>
                <Collapse open={confirmDelete === user.id} unmountOnClose data-scanner-ignore="">
                  <InlineConfirm
                    danger
                    className="cfg-row-confirm"
                    message={`¿Borrar a ${displayName(user)}?`}
                    detail="Pierde el acceso; su historial queda. Vas a poder deshacerlo unos segundos."
                    confirmLabel="Borrar"
                    busy={rowBusy}
                    onConfirm={() => void run(user, 'delete')}
                    onCancel={() => setConfirmDelete(0)}
                  />
                </Collapse>
                <Collapse open={Boolean(note)} unmountOnClose data-scanner-ignore="">
                  {note && (
                    <StatusLine
                      key={note.key}
                      className="cfg-row-status"
                      tone={note.tone}
                      message={note.text}
                      undo={note.undo ? { onUndo: () => undo(user, note.undo!.prev), seconds: 8 } : undefined}
                      onDismiss={() => expireNote(user.id)}
                    />
                  )}
                </Collapse>
                <Collapse open={editing === user.id} unmountOnClose data-scanner-ignore="">
                  <UserForm
                    key={`edit-${user.id}`}
                    title={`Editar a ${displayName(user)}`}
                    initial={draftFor(user)}
                    roleOptions={roleOptions}
                    turns={turns}
                    sites={allSites}
                    siteCode={siteCode}
                    superadmin={superadmin}
                    readOnly={readOnly}
                    onCancel={() => setEditing(null)}
                    onSaved={async () => {
                      setEditing(null);
                      await load(true);
                      showNote(user.id, { tone: 'ok', text: 'Usuario guardado. Rige al instante: su próxima acción ya usa el rol nuevo.' });
                      onChanged?.();
                    }}
                  />
                </Collapse>
              </div>
            );
          })}
          {!visible.length && (
            <div className="cfg-pad">
              <EmptyState
                compact
                title={q ? 'Nadie coincide con esa búsqueda.' : filter === 'pendientes' ? 'No hay solicitudes pendientes.' : filter === 'sinsede' ? 'Todos los usuarios tienen al menos una sede.' : 'No hay usuarios con este filtro.'}
                description={q ? 'Probá con parte del mail o del nombre.' : undefined}
                action={(q || filter !== 'todos' || siteFilter !== 'todas') ? <Button size="sm" onClick={() => { setQuery(''); setFilter('todos'); setSiteFilter('todas'); }}>Ver todos</Button> : undefined}
              />
            </div>
          )}
          {visible.length > limit && (
            <div className="cfg-more">
              <Button variant="ghost" onClick={() => setLimit(value => value + PAGE)}>Ver {Math.min(PAGE, visible.length - limit)} más</Button>
              <span className="cfg-t3">Mostrando {limit} de {visible.length}</span>
            </div>
          )}
        </div>
      )}
      <CardFoot status={readOnly ? 'Modo consulta: las acciones están deshabilitadas.' : superadmin ? 'Ves los usuarios de todas las sedes.' : `Ves los usuarios de ${siteCode}.`} tone="muted">
        <Button variant="ghost" size="sm" icon={<RefreshCw size={14} aria-hidden="true" />} loading={loading} onClick={() => void load(false)}>Actualizar</Button>
      </CardFoot>
    </Card>
  );

  const tenantInvites = superadmin && siteFilter !== 'todas' ? invites[siteFilter] : undefined;

  return (
    <>
      {header(<Button variant="primary" icon={<Plus size={15} aria-hidden="true" />} disabled={readOnly} aria-expanded={editing === 'new'} onClick={openNew}>Nuevo usuario</Button>)}
      {listCard}
      {tenantInvites && (
        <Card title={`Invitaciones de ${siteFilter}`} meta={<span className="cfg-mono">{tenantInvites.length > 12 ? `12 de ${tenantInvites.length}` : tenantInvites.length}</span>}>
          {tenantInvites.length ? (
            <div className="cfg-table cfg-tinv" role="table" aria-label={`Invitaciones de ${siteFilter}`}>
              {tenantInvites.slice(0, 12).map(invite => (
                <div className="cfg-trow" role="row" key={invite.id}>
                  <span role="cell" className="cfg-wrap">{invite.email || <span className="cfg-t3">Solo link</span>}</span>
                  <span role="cell" className="cfg-t2">{invite.role}</span>
                  <span role="cell" className={cx('cfg-nowrap', invite.status === 'Activa' ? 'cfg-t2' : 'cfg-t3')}>{invite.status}</span>
                  <span role="cell" className="cfg-t3">{invite.emailSentAt ? `Enviado ${shortDate(invite.emailSentAt)}` : invite.emailError ? <span className="is-bad">{invite.emailError}</span> : invite.email ? 'Sin registro' : '—'}</span>
                  <span role="cell" className="cfg-t3 cfg-mono">vence {shortDate(invite.expiresAt) || '—'}</span>
                </div>
              ))}
            </div>
          ) : <div className="cfg-pad"><EmptyState compact title="Esta sede no tiene invitaciones." /></div>}
          <CardFoot status="Para reenviar o revocar, entrá a la sede y abrí Invitaciones." tone="muted" />
        </Card>
      )}
    </>
  );
}

/* ── Formulario en línea de un usuario ─────────────────────────────────── */

function UserForm({ title, initial, roleOptions, turns, sites, siteCode, superadmin, readOnly, onCancel, onSaved }: {
  title: string;
  initial: FormDraft;
  roleOptions: string[];
  turns: string[];
  sites: SiteInfo[];
  siteCode: string;
  superadmin: boolean;
  readOnly: boolean;
  onCancel: () => void;
  onSaved: (saved: AllowedUserItem) => void | Promise<void>;
}) {
  const [draft, setDraft] = useState<FormDraft>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [mailError, setMailError] = useState('');
  useDirty('usuarios', JSON.stringify(draft) !== JSON.stringify(initial));
  const set = <K extends keyof FormDraft>(key: K, value: FormDraft[K]) => { setDraft(current => ({ ...current, [key]: value })); setError(''); };
  const legacyRole = draft.role && !roleOptions.includes(draft.role) ? draft.role : '';
  const options = legacyRole ? [legacyRole, ...roleOptions] : roleOptions;
  const isSuperRole = draft.role === 'Superadmin';

  const toggleSite = (code: string, on: boolean) => setDraft(current => {
    const list = on ? [...new Set([...current.sites, code])] : current.sites.filter(item => item !== code);
    const defaultSite = list.includes(current.defaultSite) ? current.defaultSite : list[0] || '';
    return { ...current, sites: list, defaultSite };
  });

  const save = async () => {
    const email = draft.email.trim().toLowerCase();
    if (!email.includes('@') || email.startsWith('@') || email.endsWith('@')) { setMailError('Mail inválido: tiene que ser algo como nombre@dominio.'); return; }
    if (superadmin && !isSuperRole && !draft.sites.length) { setError('Marcá al menos una sede.'); return; }
    setSaving(true);
    setError('');
    const siteList = superadmin ? draft.sites : [siteCode];
    const defaultSite = superadmin ? (draft.defaultSite || siteList[0]) : siteCode;
    try {
      const response = await saveAllowedUser({
        id: draft.id,
        email,
        nombre: draft.nombre.trim(),
        defaultRole: draft.role,
        turno: draft.turno,
        status: draft.status,
        activo: draft.status === 'Activo',
        defaultSiteCode: defaultSite,
        sites: siteList.map(code => ({ siteCode: code, siteRole: draft.role, turno: draft.turno, isDefault: code === defaultSite }))
      });
      await onSaved({ ...response.item, id: response.item?.id ?? draft.id, email, nombre: draft.nombre.trim() });
    } catch (reason) {
      setError(errorText(reason, 'No se pudo guardar el usuario.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="cfg-uform" role="group" aria-label={title} data-scanner-ignore="" onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); onCancel(); } }}>
      <div className="cfg-uform-h">
        <span className="cfg-strong">{title}</span>
        <span className="cfg-t3">Entra con mail y contraseña o con Google.</span>
      </div>
      <div className="cfg-grid">
        <Input
          label="Mail"
          type="email"
          inputMode="email"
          autoComplete="off"
          value={draft.email}
          error={mailError || undefined}
          hint="Se guarda en minúsculas."
          placeholder="nombre@colegio.edu.ar"
          onValueChange={value => { set('email', value.toLowerCase()); setMailError(''); }}
          onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void save(); } }}
        />
        <Input
          label="Nombre"
          value={draft.nombre}
          autoComplete="off"
          placeholder="Como lo ven los demás"
          onValueChange={value => set('nombre', value)}
          onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void save(); } }}
        />
      </div>
      <ChoiceField
        label="Rol"
        value={draft.role}
        options={options.map(role => ({ value: role, label: role }))}
        onChange={value => set('role', value)}
        hint={legacyRole ? <span><span className="is-warn">"{legacyRole}" no está en Roles y permisos:</span> se resuelve por nombre. Elegí uno de la lista para que rijan sus permisos.</span> : undefined}
      />
      <div className="cfg-grid">
        <ChoiceField label="Turno" value={draft.turno} options={turns.map(turn => ({ value: turn, label: turn }))} onChange={value => set('turno', value)} />
        <ChoiceField label="Estado" value={draft.status} options={STATUSES.map(status => ({ value: status, label: status }))} onChange={value => set('status', value as UserStatus)} />
      </div>
      {superadmin && !isSuperRole && (
        <div className="cfg-grid">
          <div className="cfg-field">
            <span className="ui-label"><span className="ui-label-text">Sedes</span></span>
            <div className="cfg-checks">
              {sites.map(site => (
                <CheckField key={site.siteCode} checked={draft.sites.includes(site.siteCode)} label={<>{site.nombre || site.siteCode} <span className="cfg-mono cfg-t3">{site.siteCode}</span></>} onChange={on => toggleSite(site.siteCode, on)} />
              ))}
            </div>
          </div>
          {draft.sites.length > 0 && (
            <ChoiceField label="Sede por defecto" value={draft.defaultSite} options={draft.sites.map(code => ({ value: code, label: code }))} onChange={value => set('defaultSite', value)} hint="Solo entre las sedes marcadas." />
          )}
        </div>
      )}
      {superadmin && isSuperRole && <p className="cfg-hint">El superadmin entra a todas las sedes activas.</p>}
      {!superadmin && <p className="cfg-hint">Se guarda en tu sede, <span className="cfg-mono">{siteCode}</span>. Las otras sedes las asigna un superadmin.</p>}
      {error && <p className="cfg-error" role="alert">{error}</p>}
      <div className="cfg-uform-f">
        <Button variant="primary" loading={saving} loadingLabel="Guardando…" disabled={readOnly} onClick={() => void save()}>Guardar usuario</Button>
        <Button variant="ghost" disabled={saving} onClick={onCancel}>Cancelar</Button>
        <span className="cfg-hint">Rige al instante: la próxima acción de este usuario ya usa el rol nuevo.</span>
      </div>
    </div>
  );
}
