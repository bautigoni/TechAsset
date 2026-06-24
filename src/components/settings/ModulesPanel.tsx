import { useEffect, useMemo, useState } from 'react';
import { getSiteSettings, updateSiteSettings } from '../../services/authApi';
import { TOGGLEABLE_MODULES, MODULE_CATEGORIES, enabledModuleSet, MODULES_SETTINGS_KEY } from '../../utils/modules';

export function ModulesPanel({ consultationMode, onChanged }: { consultationMode: boolean; onChanged?: () => void }) {
  const [enabled, setEnabled] = useState<Set<string>>(new Set(TOGGLEABLE_MODULES.map(m => m.key)));
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');

  useEffect(() => {
    getSiteSettings()
      .then(response => setEnabled(enabledModuleSet(response.settings)))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const grouped = useMemo(
    () => MODULE_CATEGORIES.map(cat => ({
      cat,
      mods: TOGGLEABLE_MODULES.filter(m => m.category === cat).sort((a, b) => a.label.localeCompare(b.label))
    })).filter(g => g.mods.length),
    []
  );

  const toggle = (key: string) => {
    if (consultationMode) return;
    setEnabled(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const save = async () => {
    setSaving(true);
    try {
      await updateSiteSettings({ [MODULES_SETTINGS_KEY]: [...enabled] });
      setToast('Módulos guardados ✓');
      onChanged?.();
    } catch {
      setToast('No se pudo guardar.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="card">
      <div className="card-head"><h3>Módulos de la sede</h3></div>
      <p className="muted" style={{ marginTop: 0 }}>Prendé o apagá secciones para esta sede. Las apagadas desaparecen del menú para todos sus usuarios.</p>

      {grouped.map(group => (
        <div key={group.cat} className="module-group">
          <h4 className="module-group-title">{group.cat}</h4>
          <div className="module-cards">
            {group.mods.map(mod => {
              const on = enabled.has(mod.key);
              return (
                <div key={mod.key} className={`module-card ${on ? 'is-on' : ''}`}>
                  <span className="module-card-icon" aria-hidden>{mod.icon}</span>
                  <div className="module-card-body">
                    <div className="module-card-title">{mod.label}</div>
                    <div className="module-card-desc">{mod.description}</div>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={on}
                    aria-label={`${on ? 'Apagar' : 'Prender'} ${mod.label}`}
                    className={`switch ${on ? 'is-on' : ''}`}
                    disabled={consultationMode}
                    onClick={() => toggle(mod.key)}
                  >
                    <span className="switch-knob" />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      <div className="actions" style={{ marginTop: 14 }}>
        <button className="btn btn-primary" type="button" disabled={saving || consultationMode} onClick={save}>
          {saving ? 'Guardando…' : 'Guardar módulos'}
        </button>
      </div>
      {toast && <div className="settings-toast">{toast}</div>}
    </section>
  );
}
