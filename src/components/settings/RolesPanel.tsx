import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, Plus } from 'lucide-react';
import { Button, Checkbox, Collapse, ErrorState, IconButton, InlineConfirm, Input, SkeletonRows, recentTrigger } from '../../ui';
import { cx } from '../../ui/util';
import { getSiteSettings, updateSiteSettings } from '../../services/authApi';
import { getManagedUsers } from '../../services/settingsApi';
import { TOGGLEABLE_MODULES } from '../../utils/modules';
import { Card, CardFoot, CheckField, Notice, dropDraft, errorText, peekDraft, useDirty, useKeepDraft } from './settingsKit';

const ALL_KEYS = TOGGLEABLE_MODULES.map(mod => mod.key as string);

type RoleDraft = { uid: string; name: string; admin: boolean; view: string[]; edit: string[] };
type Status = { tone: 'ok' | 'bad'; text: string } | null;

let uidCounter = 0;
const newUid = () => `r${Date.now().toString(36)}${(uidCounter += 1)}`;

function expand(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  const items = list.map(String);
  if (items.includes('*')) return [...ALL_KEYS];
  return items.filter(key => ALL_KEYS.includes(key));
}

function fromConfig(raw: unknown): RoleDraft[] {
  if (Array.isArray(raw) && raw.length) {
    return raw.map(item => {
      const role = item as { name?: string; admin?: boolean; view?: unknown; edit?: unknown };
      return { uid: newUid(), name: String(role.name || ''), admin: Boolean(role.admin), view: expand(role.view), edit: expand(role.edit) };
    });
  }
  return [{ uid: newUid(), name: 'Administrador', admin: true, view: [...ALL_KEYS], edit: [...ALL_KEYS] }];
}

function toConfig(roles: RoleDraft[]) {
  return roles.map(role => ({
    name: role.name.trim(),
    admin: role.admin,
    view: ALL_KEYS.every(key => role.view.includes(key)) ? ['*'] : role.view.filter(key => ALL_KEYS.includes(key)),
    edit: ALL_KEYS.every(key => role.edit.includes(key)) ? ['*'] : role.edit.filter(key => ALL_KEYS.includes(key))
  })).filter(role => role.name);
}

const signature = (roles: RoleDraft[] | null) => JSON.stringify(roles ? toConfig(roles) : null);

function summaryOf(role: RoleDraft) {
  if (role.admin) return 'Administrador de la sede · ve y edita todo';
  const total = ALL_KEYS.length;
  const views = role.view.length;
  const edits = role.edit.length;
  return `${views === total ? 'Ve todo' : `Ve ${views} de ${total}`} · ${edits === 0 ? 'no edita' : edits === total ? 'edita todo' : `edita ${edits} de ${total}`}`;
}

/**
 * Roles y permisos de la sede (`roles.config`): renombrar, administrador de la
 * sede, grilla Ver/Editar por módulo (marcar Editar marca Ver), agregar y
 * eliminar con confirmación en línea. Los roles alimentan Usuarios e
 * Invitaciones; el back resuelve los permisos con esta misma lista.
 */
export function RolesPanel({ header, readOnly, siteCode, onChanged }: { header: (actions?: ReactNode) => ReactNode; readOnly: boolean; siteCode: string; onChanged?: () => void }) {
  const draftKey = `${siteCode}:roles`;
  const [restored, setRestored] = useState(() => peekDraft<RoleDraft[]>(draftKey));
  const [saved, setSaved] = useState<RoleDraft[] | null>(null);
  const [roles, setRoles] = useState<RoleDraft[] | null>(() => restored);
  const [open, setOpen] = useState<string>('');
  // Encabezado tocado: queda quieto aunque se cierre otro rol de arriba al abrir este.
  const touchedHead = useRef<HTMLElement | null>(null);
  const [deleting, setDeleting] = useState('');
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const [usedRoles, setUsedRoles] = useState<Map<string, number>>(new Map());
  const nameRefs = useRef(new Map<string, HTMLInputElement | null>());
  const focusUid = useRef('');

  const load = () => {
    setLoadError('');
    getSiteSettings()
      .then(response => {
        const fresh = fromConfig(response.settings?.['roles.config']);
        setSaved(fresh);
        setRoles(current => current || fresh);
      })
      .catch(reason => setLoadError(errorText(reason, 'No se pudieron cargar los roles.')));
    // Qué roles usan los usuarios de la sede (para avisar de los que no están en la lista).
    getManagedUsers()
      .then(response => {
        const counts = new Map<string, number>();
        for (const user of response.items) {
          const here = (user.sites || []).find(site => site.siteCode === siteCode && site.activo !== false);
          const role = here?.siteRole || (here ? user.defaultRole : '');
          if (!role || role === 'Superadmin') continue;
          counts.set(role, (counts.get(role) || 0) + 1);
        }
        setUsedRoles(counts);
      })
      .catch(() => undefined);
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, []);

  const changed = Boolean(saved && roles) && signature(saved) !== signature(roles);
  useDirty('roles', changed);
  useKeepDraft(draftKey, roles, changed);

  useEffect(() => {
    if (!focusUid.current) return;
    const input = nameRefs.current.get(focusUid.current);
    if (input) { input.focus({ preventScroll: true }); input.select(); focusUid.current = ''; }
  });

  const mutate = (fn: (current: RoleDraft[]) => RoleDraft[]) => {
    if (readOnly) return;
    setRoles(current => (current ? fn(current) : current));
    setStatus(null);
  };
  const patch = (uid: string, change: Partial<RoleDraft>) => mutate(current => current.map(role => (role.uid === uid ? { ...role, ...change } : role)));
  const togglePerm = (uid: string, kind: 'view' | 'edit', key: string) => mutate(current => current.map(role => {
    if (role.uid !== uid) return role;
    const has = role[kind].includes(key);
    const nextList = has ? role[kind].filter(item => item !== key) : [...role[kind], key];
    // Marcar Editar marca Ver (desmarcar Ver no toca Editar, igual que antes).
    if (kind === 'edit' && !has && !role.view.includes(key)) return { ...role, edit: nextList, view: [...role.view, key] };
    return { ...role, [kind]: nextList };
  }));
  const addRole = () => {
    const uid = newUid();
    mutate(current => [...current, { uid, name: 'Nuevo rol', admin: false, view: [...ALL_KEYS], edit: [] }]);
    setOpen(uid);
    focusUid.current = uid;
  };
  const toggleRole = (head: HTMLElement | null, next: string) => {
    // Lo leen los colapsos (el que abre y el que cierra) en el mismo commit; después se olvida.
    touchedHead.current = head;
    setOpen(next);
    requestAnimationFrame(() => { touchedHead.current = null; });
  };
  const removeRole = (uid: string) => {
    mutate(current => current.filter(role => role.uid !== uid));
    setDeleting('');
    if (open === uid) setOpen('');
  };

  const names = (roles || []).map(role => role.name.trim().toLowerCase());
  const problem = (() => {
    if (!roles) return '';
    if (names.some(name => !name)) return 'Hay un rol sin nombre: escribile uno o eliminalo.';
    const dup = names.find((name, index) => names.indexOf(name) !== index);
    if (dup) return `Hay dos roles que se llaman "${roles.find(role => role.name.trim().toLowerCase() === dup)?.name.trim()}".`;
    if (!roles.some(role => role.admin)) return 'Tiene que quedar al menos un rol administrador de la sede.';
    return '';
  })();

  const missing = useMemo(() => {
    const configured = new Set((saved || []).map(role => role.name.trim()));
    return [...usedRoles.entries()].filter(([name]) => !configured.has(name));
  }, [saved, usedRoles]);

  const save = async () => {
    if (!roles || problem) return;
    setSaving(true);
    setStatus(null);
    try {
      const response = await updateSiteSettings({ 'roles.config': toConfig(roles) });
      const fresh = fromConfig(response.settings?.['roles.config']);
      // Se conservan los uid para que lo abierto siga abierto.
      const merged = fresh.map((role, index) => ({ ...role, uid: roles.filter(item => item.name.trim())[index]?.uid || role.uid }));
      setSaved(merged);
      setRoles(merged);
      setRestored(null);
      dropDraft(draftKey);
      setStatus({ tone: 'ok', text: 'Guardado. Rige desde la próxima acción de cada usuario.' });
      onChanged?.();
    } catch (reason) {
      setStatus({ tone: 'bad', text: errorText(reason, 'No se pudieron guardar los roles.') });
    } finally {
      setSaving(false);
    }
  };
  const discard = () => {
    if (saved) setRoles(saved);
    setRestored(null);
    dropDraft(draftKey);
    setStatus(null);
    setDeleting('');
  };

  if (loadError && !saved) return <>{header()}<ErrorState message={loadError} onRetry={load} /></>;

  const half = Math.ceil(TOGGLEABLE_MODULES.length / 2);
  const columns = [TOGGLEABLE_MODULES.slice(0, half), TOGGLEABLE_MODULES.slice(half)];

  return (
    <>
      {header()}
      {missing.length > 0 && (
        <Notice tone="warn">
          <span><span className="is-warn">{missing.length === 1 ? '1 rol en uso no está' : `${missing.length} roles en uso no están`} en esta lista:</span> {missing.map(([name, n]) => `${name} (${n})`).join(', ')}. Se resuelven por nombre hasta que los agregues acá con el mismo nombre.</span>
        </Notice>
      )}
      <Card ariaLabel="Roles de la sede">
        {restored && changed && <Notice tone="warn">Recuperamos cambios que no habías guardado.</Notice>}
        {!roles ? <div className="cfg-pad"><SkeletonRows rows={3} /></div> : roles.map(role => {
          const isOpen = open === role.uid;
          const bodyId = `cfg-role-${role.uid}`;
          const users = usedRoles.get(role.name.trim()) || 0;
          return (
            <div className="cfg-acc" key={role.uid}>
              {/* La fila entera abre y cierra con el mouse; con teclado, el botón de la flecha. */}
              <div className="cfg-acc-h is-row" onClick={event => toggleRole(event.currentTarget, isOpen ? '' : role.uid)}>
                <span className="cfg-acc-t">
                  <span className="cfg-strong cfg-wrap">{role.name.trim() || 'Rol sin nombre'}</span>
                  <span className="cfg-t2 cfg-wrap">{summaryOf(role)}{users ? ` · ${users} usuario${users === 1 ? '' : 's'}` : ''}</span>
                </span>
                <IconButton
                  size="sm"
                  label={`${isOpen ? 'Cerrar' : 'Abrir'} el rol ${role.name.trim() || 'sin nombre'}`}
                  aria-expanded={isOpen}
                  aria-controls={bodyId}
                  icon={<ChevronDown size={16} aria-hidden="true" className={cx('cfg-chev', isOpen && 'is-open')} />}
                  onClick={event => { event.stopPropagation(); toggleRole(event.currentTarget.closest<HTMLElement>('.cfg-acc-h'), isOpen ? '' : role.uid); }}
                />
              </div>
              <Collapse unmountOnClose data-scanner-ignore="" open={isOpen} id={bodyId} anchor={() => touchedHead.current || recentTrigger()}>
                <div className="cfg-acc-b" data-scanner-ignore="">
                  <div className="cfg-grid">
                    <Input
                      label="Nombre del rol"
                      value={role.name}
                      disabled={readOnly}
                      ref={node => { nameRefs.current.set(role.uid, node); }}
                      hint={users && saved?.some(item => item.uid === role.uid && item.name !== role.name) ? `${users} usuario${users === 1 ? ' tiene' : 's tienen'} este rol: si lo renombrás, quedan resueltos por nombre hasta reasignarlos.` : undefined}
                      onValueChange={value => patch(role.uid, { name: value })}
                    />
                    <div className="cfg-field-end">
                      <CheckField checked={role.admin} disabled={readOnly} label="Administrador de la sede" description="Acceso total: usuarios, invitaciones, módulos y configuración." onChange={value => patch(role.uid, { admin: value })} />
                    </div>
                  </div>
                  {role.admin ? (
                    <p className="cfg-t2 cfg-para">Ve y edita todos los módulos, administra usuarios, invitaciones y la sede.</p>
                  ) : (
                    <>
                      <div className="cfg-perms" role="group" aria-label={`Permisos de ${role.name || 'este rol'} por módulo`}>
                        {columns.map((mods, columnIndex) => (
                          <div className={cx('cfg-perm-col', columnIndex === 1 && 'is-second')} key={columnIndex}>
                            <div className="cfg-perm-h"><span>Módulo</span><span>Ver</span><span>Editar</span></div>
                            {mods.map(mod => (
                              <div className="cfg-perm-r" key={mod.key}>
                                <span className="cfg-wrap">{mod.label}</span>
                                <Checkbox checked={role.view.includes(mod.key)} disabled={readOnly} ariaLabel={`Ver ${mod.label}`} onCheckedChange={() => togglePerm(role.uid, 'view', mod.key)} />
                                <Checkbox checked={role.edit.includes(mod.key)} disabled={readOnly} ariaLabel={`Editar ${mod.label}`} onCheckedChange={() => togglePerm(role.uid, 'edit', mod.key)} />
                              </div>
                            ))}
                          </div>
                        ))}
                      </div>
                      <p className="cfg-hint">Marcar Editar marca Ver.</p>
                    </>
                  )}
                  {!readOnly && (
                    <div className="cfg-acc-f">
                      {roles.length > 1 ? (
                        deleting === role.uid ? (
                          <InlineConfirm
                            danger
                            message={`¿Eliminar el rol ${role.name.trim() || 'sin nombre'}?`}
                            detail={users ? `${users} usuario${users === 1 ? '' : 's'} lo usa${users === 1 ? '' : 'n'}: van a quedar resueltos por nombre hasta que les asignes otro. Se aplica al guardar.` : 'Se aplica al guardar los roles.'}
                            confirmLabel="Eliminar rol"
                            onConfirm={() => removeRole(role.uid)}
                            onCancel={() => setDeleting('')}
                          />
                        ) : <Button variant="danger" size="sm" onClick={() => setDeleting(role.uid)}>Eliminar rol</Button>
                      ) : <span className="cfg-t3">Es el único rol: no se puede eliminar.</span>}
                    </div>
                  )}
                </div>
              </Collapse>
            </div>
          );
        })}
        <CardFoot
          status={problem || status?.text || (readOnly ? 'Modo consulta: se ve, no se edita.' : changed ? 'Hay cambios sin guardar.' : 'Los roles alimentan Usuarios e Invitaciones.')}
          tone={problem ? 'bad' : status ? status.tone : changed ? 'warn' : 'muted'}
        >
          <Button variant="secondary" icon={<Plus size={15} aria-hidden="true" />} disabled={readOnly || !roles} onClick={addRole}>Agregar rol</Button>
          {changed && <Button variant="ghost" disabled={saving} onClick={discard}>Descartar</Button>}
          <Button variant="primary" loading={saving} loadingLabel="Guardando…" disabled={readOnly || !changed || Boolean(problem)} onClick={() => void save()}>Guardar roles</Button>
        </CardFoot>
      </Card>
    </>
  );
}
