import { useEffect, useState } from 'react';
import { getSiteSettings, updateSiteSettings } from '../../services/authApi';
import { TOGGLEABLE_MODULES } from '../../utils/modules';
import { Button } from '../layout/Button';

const ALL_KEYS = TOGGLEABLE_MODULES.map(m => m.key as string);

interface RoleDraft {
  name: string;
  admin: boolean;
  view: Set<string>;
  edit: Set<string>;
}

function expand(list: unknown): Set<string> {
  if (!Array.isArray(list)) return new Set();
  if (list.map(String).includes('*')) return new Set(ALL_KEYS);
  return new Set(list.map(String).filter(k => ALL_KEYS.includes(k)));
}

function toConfig(roles: RoleDraft[]) {
  return roles.map(r => ({
    name: r.name.trim(),
    admin: r.admin,
    view: ALL_KEYS.every(k => r.view.has(k)) ? ['*'] : [...r.view],
    edit: ALL_KEYS.every(k => r.edit.has(k)) ? ['*'] : [...r.edit]
  })).filter(r => r.name);
}

export function RolesPanel({ consultationMode, onChanged }: { consultationMode: boolean; onChanged?: () => void }) {
  const [roles, setRoles] = useState<RoleDraft[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getSiteSettings().then(r => {
      const cfg = (r.settings as Record<string, unknown>)?.['roles.config'];
      if (Array.isArray(cfg) && cfg.length) {
        setRoles(cfg.map(raw => {
          const role = raw as { name?: string; admin?: boolean; view?: unknown; edit?: unknown };
          return { name: String(role.name || ''), admin: Boolean(role.admin), view: expand(role.view), edit: expand(role.edit) };
        }));
      } else {
        setRoles([{ name: 'Administrador', admin: true, view: new Set(ALL_KEYS), edit: new Set(ALL_KEYS) }]);
      }
    }).catch(() => {});
  }, []);

  const mutate = (fn: (roles: RoleDraft[]) => RoleDraft[]) => { if (consultationMode) return; setSaved(false); setRoles(fn); };

  const toggle = (idx: number, kind: 'view' | 'edit', key: string) => mutate(rs => rs.map((r, i) => {
    if (i !== idx) return r;
    const set = new Set(r[kind]);
    if (set.has(key)) set.delete(key); else { set.add(key); if (kind === 'edit') r.view.add(key); }
    return { ...r, [kind]: set };
  }));

  const setAdmin = (idx: number, value: boolean) => mutate(rs => rs.map((r, i) => i === idx ? { ...r, admin: value } : r));
  const rename = (idx: number, name: string) => mutate(rs => rs.map((r, i) => i === idx ? { ...r, name } : r));
  const addRole = () => mutate(rs => [...rs, { name: 'Nuevo rol', admin: false, view: new Set(ALL_KEYS), edit: new Set() }]);
  const removeRole = (idx: number) => mutate(rs => rs.filter((_, i) => i !== idx));

  const save = async () => {
    setSaving(true);
    try {
      await updateSiteSettings({ 'roles.config': toConfig(roles) });
      setSaved(true);
      onChanged?.();
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="card">
      <div className="card-head">
        <h3>Roles y permisos</h3>
        <Button disabled={consultationMode} onClick={addRole}>+ Rol</Button>
      </div>
      <p className="muted" style={{ marginTop: 0 }}>Definí los roles de esta sede y qué puede ver/editar cada uno. "Admin" da acceso total (usuarios, sedes, configuración).</p>

      {roles.map((role, idx) => (
        <div key={idx} className="role-config-card">
          <div className="grid-2" style={{ alignItems: 'end' }}>
            <label>Nombre del rol
              <input className="input" value={role.name} disabled={consultationMode} onChange={e => rename(idx, e.target.value)} />
            </label>
            <label className="module-toggle-row" style={{ alignSelf: 'center' }}>
              <input type="checkbox" checked={role.admin} disabled={consultationMode} onChange={e => setAdmin(idx, e.target.checked)} />
              <span>Administrador del tenant</span>
            </label>
          </div>
          {!role.admin && (
            <div className="role-perm-grid">
              <div className="role-perm-head"><span>Módulo</span><span>Ver</span><span>Editar</span></div>
              {TOGGLEABLE_MODULES.map(mod => (
                <div key={mod.key} className="role-perm-row">
                  <span>{mod.label}</span>
                  <input type="checkbox" checked={role.view.has(mod.key)} disabled={consultationMode} onChange={() => toggle(idx, 'view', mod.key)} />
                  <input type="checkbox" checked={role.edit.has(mod.key)} disabled={consultationMode} onChange={() => toggle(idx, 'edit', mod.key)} />
                </div>
              ))}
            </div>
          )}
          {!consultationMode && roles.length > 1 && (
            <div className="actions"><Button className="mini-action-btn" onClick={() => removeRole(idx)}>Eliminar rol</Button></div>
          )}
        </div>
      ))}

      <div className="actions" style={{ marginTop: 12 }}>
        <Button variant="primary" disabled={saving || consultationMode} onClick={save}>{saving ? 'Guardando…' : 'Guardar roles'}</Button>
        {saved && <span className="muted" style={{ alignSelf: 'center' }}>Guardado ✓</span>}
      </div>
    </section>
  );
}
