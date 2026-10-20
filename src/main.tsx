import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/global.css';
import { App } from './App';
import { initAppearance } from './utils/theme';
import { installMobileZoomLock } from './utils/mobileZoomLock';
import { initPwa } from './services/pwa';
import { initErrorReporting } from './services/errorReporting';

// Tema, densidad y tamaño de texto antes del primer render (sin flash). Migra
// los perfiles viejos y escucha prefers-color-scheme si el tema es "Sistema".
initAppearance();

// Errores a Sentry SOLO si el build tiene VITE_SENTRY_DSN (apagado por defecto;
// el SDK se baja diferido, la entrada no lo carga).
initErrorReporting();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);

// Service worker (solo en producción), aviso de versión nueva, conexión e
// instalación: todo se muestra en línea en la cabecera (src/services/pwa.ts).
initPwa();

// Mobile = pantalla fija (decisión del dueño, PLAN §5.1): sin zoom con dos
// dedos. El viewport de index.html lo bloquea en Android; en iPhone Safari
// ignora `user-scalable=no` y hay que cancelar los gestos a mano (salvo dentro
// del plano de aulas y del Canvas, que tienen su propio zoom).
installMobileZoomLock();
