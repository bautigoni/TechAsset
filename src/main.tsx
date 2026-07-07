import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/global.css';
import { App } from './App';
import { InstallBanner } from './components/common/InstallBanner';
import { ReleaseNotesModal } from './components/common/ReleaseNotesModal';
import { applyThemeProfile, readThemeProfile } from './utils/themeProfile';

// Aplicar el perfil de tema guardado antes del primer render para evitar flash.
applyThemeProfile(readThemeProfile());
installViewportZoomLock();

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

function installViewportZoomLock() {
  const preventZoom = (event: Event) => event.preventDefault();
  const preventMultitouch = (event: TouchEvent) => {
    if (event.touches.length > 1) event.preventDefault();
  };

  document.addEventListener('gesturestart', preventZoom, { passive: false });
  document.addEventListener('gesturechange', preventZoom, { passive: false });
  document.addEventListener('gestureend', preventZoom, { passive: false });
  document.addEventListener('touchmove', preventMultitouch, { passive: false });
}
