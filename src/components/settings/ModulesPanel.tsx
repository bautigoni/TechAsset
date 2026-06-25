import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { getSiteSettings, updateSiteSettings } from '../../services/authApi';
import {
  TOGGLEABLE_MODULES,
  enabledModuleSet,
  moduleOrder,
  MODULES_ORDER_SETTINGS_KEY,
  MODULES_SETTINGS_KEY,
  orderedToggleableModules,
  type ModuleKey
} from '../../utils/modules';

export function ModulesPanel({ consultationMode, onChanged }: { consultationMode: boolean; onChanged?: () => void }) {
  const [enabled, setEnabled] = useState<Set<string>>(new Set(TOGGLEABLE_MODULES.map(m => m.key)));
  const [order, setOrder] = useState<ModuleKey[]>(TOGGLEABLE_MODULES.map(m => m.key));
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');

  useEffect(() => {
    getSiteSettings()
      .then(response => {
        setEnabled(enabledModuleSet(response.settings));
        setOrder(moduleOrder(response.settings));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const modules = orderedToggleableModules({ [MODULES_ORDER_SETTINGS_KEY]: order });

  const toggle = (key: string) => {
    if (consultationMode) return;
    setEnabled(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const move = (key: ModuleKey, direction: -1 | 1) => {
    if (consultationMode) return;
    setOrder(prev => {
      const index = prev.indexOf(key);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return next;
    });
  };

  const save = async () => {
    setSaving(true);
    try {
      await updateSiteSettings({ [MODULES_SETTINGS_KEY]: [...enabled], [MODULES_ORDER_SETTINGS_KEY]: order });
      setToast('Modulos guardados');
      onChanged?.();
    } catch {
      setToast('No se pudo guardar.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="card">
      <div className="card-head"><h3>Modulos de la sede</h3></div>
      <p className="muted" style={{ marginTop: 0 }}>Prende, apaga y ordena las secciones para esta sede. El menu respeta este orden para sus usuarios.</p>

      <div className="module-group">
        <h4 className="module-group-title">Orden del menu</h4>
        <div className="module-cards module-cards-ordered">
          {modules.map((mod, index) => {
            const on = enabled.has(mod.key);
            return (
              <div key={mod.key} className={`module-card module-card-ordered ${on ? 'is-on' : ''}`}>
                <span className="module-card-position">{index + 1}</span>
                <span className="module-card-icon" aria-hidden>{mod.icon}</span>
                <div className="module-card-body">
                  <div className="module-card-title">{mod.label}</div>
                  <div className="module-card-desc">{mod.description}</div>
                  <div className="module-card-category">{mod.category}</div>
                </div>
                <div className="module-order-actions">
                  <button type="button" className="module-order-btn" aria-label={`Subir ${mod.label}`} title="Subir" disabled={consultationMode || index === 0} onClick={() => move(mod.key, -1)}>
                    <ArrowUp size={15} strokeWidth={2.4} />
                  </button>
                  <button type="button" className="module-order-btn" aria-label={`Bajar ${mod.label}`} title="Bajar" disabled={consultationMode || index === modules.length - 1} onClick={() => move(mod.key, 1)}>
                    <ArrowDown size={15} strokeWidth={2.4} />
                  </button>
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

      <div className="actions" style={{ marginTop: 14 }}>
        <button className="btn btn-primary" type="button" disabled={saving || consultationMode} onClick={save}>
          {saving ? 'Guardando...' : 'Guardar modulos'}
        </button>
      </div>
      {toast && <div className="settings-toast">{toast}</div>}
    </section>
  );
}
