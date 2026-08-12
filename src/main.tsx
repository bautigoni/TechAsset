import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/global.css';
import { App } from './App';
import { InstallBanner } from './components/common/InstallBanner';
import { ReleaseNotesModal } from './components/common/ReleaseNotesModal';
import { applyThemeProfile, readThemeProfile } from './utils/themeProfile';

// Aplicar el perfil de tema guardado antes del primer render para evitar flash.
applyThemeProfile(readThemeProfile());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <InstallBanner />
    <ReleaseNotesModal />
  </StrictMode>
);

// E4: registrar el service worker solo en producción.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' })
      .then((registration) => {
        registration.update().catch(() => { /* sin update no rompe nada */ });
      })
      .catch(() => { /* sin SW no rompe nada */ });
  });
}

// El bloqueo de pinch-zoom se sacó a propósito: la app se usa en celular y
// impedir agrandar deja afuera a quien lo necesita para leer.
