import { useEffect, useState } from 'react';
import { getSiteSettings, updateSiteSettings } from '../../services/authApi';
import { TOGGLEABLE_MODULES, enabledModuleSet, MODULES_SETTINGS_KEY } from '../../utils/modules';

export function ModulesPanel({ consultationMode, onChanged }: { consultationMode: boolean; onChanged?: () => void }) {
  const [enabled, setEnabled] = useState<Set<string>>(new Set(TOGGLEABLE_MODULES.map(m => m.key)));
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(false);

  useEffect(() => {
    getSiteSettings()
      .then(response => setEnabled(enabledModuleSet(response.settings)))
      .catch(() => {});
  }, []);

  const toggle = (key: string) => {
    if (consultationMode) return;
    setSavedAt(false);
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
      setSavedAt(true);
      onChanged?.();
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="card">
      <div className="card-head"><h3>Módulos de la sede</h3></div>
      <p className="muted" style={{ marginTop: 0 }}>Prendé o apagá secciones para esta sede. Las apagadas desaparecen del menú para todos sus usuarios.</p>
      <div className="grid-2">
        {TOGGLEABLE_MODULES.map(mod => (
          <label key={mod.key} className="module-toggle-row">
            <input type="checkbox" checked={enabled.has(mod.key)} disabled={consultationMode} onChange={() => toggle(mod.key)} />
            <span>{mod.label}</span>
          </label>
        ))}
      </div>
      <div className="actions" style={{ marginTop: 12 }}>
        <button className="btn btn-primary" type="button" disabled={saving || consultationMode} onClick={save}>
          {saving ? 'Guardando…' : 'Guardar módulos'}
        </button>
        {savedAt && <span className="muted" style={{ alignSelf: 'center' }}>Guardado ✓</span>}
      </div>
    </section>
  );
}
