import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/global.css';
import { App } from './App';
import { InstallBanner } from './components/common/InstallBanner';
import { ReleaseNotesModal } from './components/common/ReleaseNotesModal';

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
    navigator.serviceWorker.register('/sw.js').catch(() => { /* sin SW no rompe nada */ });
  });
}
