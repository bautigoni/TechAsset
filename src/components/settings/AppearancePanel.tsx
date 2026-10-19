import { setAppearance, useAppearance, type Density, type TextSize, type ThemePref } from '../../utils/theme';

const THEME_OPTIONS: Array<{ value: ThemePref; label: string; desc: string }> = [
  { value: 'dark', label: 'Oscuro', desc: 'Grafito' },
  { value: 'light', label: 'Claro', desc: 'Fondo claro' },
  { value: 'system', label: 'Sistema', desc: 'Sigue al dispositivo' }
];

const DENSITY_OPTIONS: Array<{ value: Density; label: string; desc: string }> = [
  { value: 'comfortable', label: 'Cómoda', desc: 'Más aire' },
  { value: 'compact', label: 'Compacta', desc: 'Más filas por pantalla' }
];

const TEXT_SIZE_OPTIONS: Array<{ value: TextSize; label: string; desc: string }> = [
  { value: 'normal', label: 'Normal', desc: '100 %' },
  { value: 'large', label: 'Grande', desc: '110 %' },
  { value: 'xlarge', label: 'Muy grande', desc: '120 %' }
];

/** Vista previa en miniatura con los colores reales del tema (clases g-theme-*). */
function ThemePreview({ theme }: { theme: ThemePref }) {
  if (theme === 'system') {
    return (
      <div className="theme-preview is-split" aria-hidden="true">
        <span className="theme-preview-half g-theme-dark"><span className="preview-sidebar" /><span className="preview-content" /></span>
        <span className="theme-preview-half g-theme-light"><span className="preview-sidebar" /><span className="preview-content" /></span>
      </div>
    );
  }
  return (
    <div className={`theme-preview g-theme-${theme}`} aria-hidden="true">
      <span className="preview-sidebar" />
      <span className="preview-content" />
    </div>
  );
}

/**
 * Configuración › Apariencia: Tema, Densidad y Tamaño de texto. Es una
 * preferencia de cada usuario (localStorage + /api/user/prefs), no de la sede.
 */
export function AppearancePanel() {
  const { theme, density, textSize } = useAppearance();

  return (
    <section className="card settings-apariencia">
      <div className="card-head"><h3>Apariencia</h3></div>

      <h4 className="appearance-label" id="appearance-theme">Tema</h4>
      <div className="theme-option-grid" role="group" aria-labelledby="appearance-theme">
        {THEME_OPTIONS.map(option => (
          <button
            key={option.value}
            type="button"
            className={`theme-card ${theme === option.value ? 'selected' : ''}`}
            aria-pressed={theme === option.value}
            onClick={() => setAppearance({ theme: option.value })}
          >
            <ThemePreview theme={option.value} />
            <strong>{option.label}</strong>
            <span>{option.desc}</span>
          </button>
        ))}
      </div>

      <h4 className="appearance-label" id="appearance-density">Densidad</h4>
      <div className="style-chips" role="group" aria-labelledby="appearance-density">
        {DENSITY_OPTIONS.map(option => (
          <button
            key={option.value}
            type="button"
            className={`style-chip ${density === option.value ? 'active' : ''}`}
            aria-pressed={density === option.value}
            onClick={() => setAppearance({ density: option.value })}
          >
            <span>{option.label}</span>
            <small>{option.desc}</small>
          </button>
        ))}
      </div>

      <h4 className="appearance-label" id="appearance-text-size">Tamaño de texto</h4>
      <div className="style-chips" role="group" aria-labelledby="appearance-text-size">
        {TEXT_SIZE_OPTIONS.map(option => (
          <button
            key={option.value}
            type="button"
            className={`style-chip ${textSize === option.value ? 'active' : ''}`}
            aria-pressed={textSize === option.value}
            onClick={() => setAppearance({ textSize: option.value })}
          >
            <span>{option.label}</span>
            <small>{option.desc}</small>
          </button>
        ))}
      </div>
      <small className="muted">Se guarda en tu cuenta: se aplica en cualquier equipo donde entres. Las pantallas que todavía no se rediseñaron toman la densidad y el tamaño de texto a medida que se migran.</small>
    </section>
  );
}
