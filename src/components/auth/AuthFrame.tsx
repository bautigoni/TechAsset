import type { ReactNode } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { Segmented } from '../../ui';
import { setAppearance, useAppearance, type ThemePref } from '../../utils/theme';
import { PRIVACY_PATH, onPrivacyLinkClick } from './publicRoutes';
// Estilos de landing/login: viajan con estas pantallas (solo las ve quien no
// tiene sesión), no en la primera carga de la app.
import '../../styles/screens/auth.css';

const THEMES: Array<{ value: ThemePref; label: string; icon: ReactNode }> = [
  { value: 'dark', label: 'Oscuro', icon: <Moon size={14} strokeWidth={1.6} aria-hidden="true" /> },
  { value: 'light', label: 'Claro', icon: <Sun size={14} strokeWidth={1.6} aria-hidden="true" /> },
  { value: 'system', label: 'Sistema', icon: <Monitor size={14} strokeWidth={1.6} aria-hidden="true" /> }
];

/**
 * Marco de las pantallas sin sesión (landing, ingreso, registro, contraseña):
 * marca, tema y pie. Sin capas: todo en el flujo de la página, que scrollea
 * el documento (nunca un contenedor interno).
 */
export function AuthFrame({ children, onHome, action, wide = false, hidePrivacyLink = false }: {
  children: ReactNode;
  /** La marca vuelve a la landing (en la landing no hace nada). */
  onHome?: () => void;
  /** Botón extra a la derecha (en la landing: "Ingresar"). */
  action?: ReactNode;
  wide?: boolean;
  hidePrivacyLink?: boolean;
}) {
  const { theme } = useAppearance();
  const brand = (
    <>
      <span className="auth-mark" aria-hidden="true">TA</span>
      <span className="auth-name">TechAsset</span>
    </>
  );
  return (
    <div className={`auth${wide ? ' auth--wide' : ''}`}>
      <header className="auth-top">
        {onHome
          ? <button type="button" className="auth-brand" onClick={onHome} aria-label="TechAsset: volver al inicio">{brand}</button>
          : <span className="auth-brand">{brand}</span>}
        <span className="auth-spacer" aria-hidden="true" />
        {/* Sin sesión el tema se guarda solo en este navegador (no hay cuenta a la que mandarlo). */}
        <Segmented size="sm" className="auth-theme" ariaLabel="Tema" value={theme} options={THEMES} onChange={next => setAppearance({ theme: next }, { remote: false })} />
        {action}
      </header>
      <main className="auth-main" id="contenido">{children}</main>
      <footer className="auth-foot">
        <span>TechAsset · gestión TIC del colegio</span>
        {/* En Privacidad mismo no se repite el link a sí misma. */}
        {!hidePrivacyLink && <a className="auth-link" href={PRIVACY_PATH} onClick={onPrivacyLinkClick}>Privacidad y uso</a>}
      </footer>
    </div>
  );
}
