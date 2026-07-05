import { useState } from 'react';
import { isSmartProfile, readThemeProfile, saveThemeProfile, type SmartSidebarStyle, type ThemeProfile } from '../../utils/themeProfile';

const STYLE_OPTIONS: Array<{ value: SmartSidebarStyle; label: string }> = [
  { value: 'normal', label: 'Normal' },
  { value: 'stairs', label: 'Escalera' },
  { value: 'centered', label: 'Centrada' },
  { value: 'centered-peek', label: 'Centrada + peek' }
];

function profileForStyle(style: SmartSidebarStyle): ThemeProfile {
  if (style === 'stairs') return 'smart-stairs';
  if (style === 'centered') return 'smart-centered';
  if (style === 'centered-peek') return 'smart-peek';
  return 'smart';
}

function styleForProfile(profile: ThemeProfile): SmartSidebarStyle {
  if (profile === 'smart-stairs') return 'stairs';
  if (profile === 'smart-centered') return 'centered';
  if (profile === 'smart-peek') return 'centered-peek';
  return 'normal';
}

// Selector de tema visual. Es una preferencia local del dispositivo
// (localStorage), no toca datos de la sede ni respeta consultationMode.
export function AppearancePanel() {
  const [profile, setProfile] = useState<ThemeProfile>(() => readThemeProfile());
  const smart = isSmartProfile(profile);

  const select = (next: ThemeProfile) => {
    setProfile(next);
    saveThemeProfile(next);
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
          <strong>Smart Campus</strong>
          <span>Panel flotante, cálido</span>
        </button>
      </div>
      {smart && (
        <div className="sidebar-style-selector">
          <h4>Estilo de navegación</h4>
          <div className="style-chips">
            {STYLE_OPTIONS.map(option => (
              <button
                key={option.value}
                type="button"
                className={`style-chip ${styleForProfile(profile) === option.value ? 'active' : ''}`}
                onClick={() => select(profileForStyle(option.value))}
              >
                {option.label}
              </button>
            ))}
          </div>
          <small className="muted">La sidebar cambia el acomodo de sus items en desktop; en mobile aparece la barra inferior.</small>
        </div>
      )}
    </section>
  );
}
