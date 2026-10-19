import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/global.css';
import { App } from './App';
import { InstallBanner } from './components/common/InstallBanner';
import { ReleaseNotesModal } from './components/common/ReleaseNotesModal';
import { FeedbackHost } from './components/layout/Feedback';
import { initAppearance } from './utils/theme';
import { installMobileZoomLock } from './utils/mobileZoomLock';

// Tema, densidad y tamaño de texto antes del primer render (sin flash). Migra
// los perfiles viejos y escucha prefers-color-scheme si el tema es "Sistema".
initAppearance();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <InstallBanner />
    <ReleaseNotesModal />
    <FeedbackHost />
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

// Mobile = pantalla fija (decisión del dueño, PLAN §5.1): sin zoom con dos
// dedos. El viewport de index.html lo bloquea en Android; en iPhone Safari
// ignora `user-scalable=no` y hay que cancelar los gestos a mano (salvo dentro
// del plano de aulas y del Canvas, que tienen su propio zoom).
installMobileZoomLock();
