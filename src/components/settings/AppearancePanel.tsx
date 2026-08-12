import { useState } from 'react';
import { hasVariantNav, isSmartProfile, readThemeProfile, saveThemeProfile, variantStyle, profileForThemeAndStyle, type ThemeProfile, type VariantStyle } from '../../utils/themeProfile';

const STYLE_OPTIONS: Array<{ value: VariantStyle; label: string; desc: string }> = [
  { value: 'normal', label: 'Normal', desc: 'Sidebar tradicional' },
  { value: 'stairs', label: 'Escalera', desc: 'Items escalonados' },
  { value: 'centered', label: 'Centrada', desc: 'Sidebar tipo dock' },
  { value: 'centered-peek', label: 'Centrada + peek', desc: 'Sidebar que asoma' }
];

export function AppearancePanel() {
  const [profile, setProfile] = useState<ThemeProfile>(() => readThemeProfile());
  const smart = isSmartProfile(profile);
  const variant = hasVariantNav(profile);

  const select = (next: ThemeProfile) => {
    setProfile(next);
    saveThemeProfile(next);
  };

  const changeStyle = (style: VariantStyle) => {
    const next = profileForThemeAndStyle(smart, style);
    select(next);
    // Si se elige un estilo variante (no "Normal"), forzar expansión de la sidebar
    // para que el cambio de 76→240px no comprima el contenido.
    if (hasVariantNav(next)) {
      localStorage.removeItem('techasset_sidebar_collapsed');
      window.dispatchEvent(new CustomEvent('techasset:sidebar-expand'));
    }
  };

  return (
    <section className="card settings-apariencia">
      <div className="card-head"><h3>Apariencia</h3></div>
      <h3 style={{ margin: '0 0 10px', fontSize: 14 }}>Tema visual</h3>
      <div className="theme-option-grid">
        <button type="button" className={`theme-card ${!smart ? 'selected' : ''}`} data-theme="classic" onClick={() => select('classic')}>
          <div className="theme-preview classic">
            <span className="preview-sidebar blue" />
            <span className="preview-content dark" />
          </div>
          <strong>Clásico</strong>
          <span>Azul oscuro original</span>
        </button>
        <button type="button" className={`theme-card ${smart ? 'selected' : ''}`} data-theme="smart" onClick={() => select('smart')}>
          <div className="theme-preview smart">
            <span className="preview-sidebar cream" />
            <span className="preview-content warm" />
          </div>
          <strong>Tema claro</strong>
          <span>Panel flotante, cálido</span>
        </button>
      </div>

      <h3 style={{ margin: '16px 0 10px', fontSize: 14 }}>Estilo de navegación</h3>
      <div className="style-chips">
        {STYLE_OPTIONS.map(option => (
          <button
            key={option.value}
            type="button"
            className={`style-chip ${!variant && option.value === 'normal' || variantStyle(profile) === option.value ? 'active' : ''}`}
            onClick={() => changeStyle(option.value)}
          >
            <span>{option.label}</span>
            <small>{option.desc}</small>
          </button>
        ))}
      </div>
      <small className="muted">La sidebar cambia el acomodo de sus items en desktop; en mobile aparece la barra inferior.</small>
    </section>
  );
}
