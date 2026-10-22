import { useSyncExternalStore } from 'react';

/**
 * Estado de la app instalada: hay una versión nueva esperando y/o no hay
 * conexión. Lo muestra la cabecera (ShellStatus) como líneas de estado en el
 * lugar, sin capas: "Hay una versión nueva · Actualizar" y "Sin conexión".
 */
type PwaState = { updateReady: boolean; offline: boolean; updating: boolean; installable: boolean };

let state: PwaState = {
  updateReady: false,
  offline: typeof navigator !== 'undefined' && navigator.onLine === false,
  updating: false,
  installable: false
};
const listeners = new Set<() => void>();
const set = (patch: Partial<PwaState>) => {
  state = { ...state, ...patch };
  listeners.forEach(listener => listener());
};
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

export function usePwaState() {
  return useSyncExternalStore(subscribe, () => state, () => state);
}

let waiting: ServiceWorker | null = null;

/* ── Instalar la app (Android / Chrome: beforeinstallprompt; en iOS no existe) ── */

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
const INSTALL_DISMISS_KEY = 'techasset_install_dismissed';
/** "Más tarde" lo guarda por 30 días: no vuelve en cada vista ni en cada visita. */
const INSTALL_SNOOZE_MS = 30 * 24 * 60 * 60 * 1000;
let installEvent: BeforeInstallPromptEvent | null = null;
/** Sin storage (modo privado): "Más tarde" vale hasta recargar. */
let dismissedNow = false;

function installDismissed() {
  if (dismissedNow) return true;
  try {
    const value = localStorage.getItem(INSTALL_DISMISS_KEY);
    if (!value) return false;
    // '1' = "Más tarde" de antes de que venciera (se cuenta desde hoy).
    const at = value === '1' ? Date.now() : Number(value);
    if (value === '1') localStorage.setItem(INSTALL_DISMISS_KEY, String(at));
    return Number.isFinite(at) && Date.now() - at < INSTALL_SNOOZE_MS;
  } catch { return false; }
}

function listenInstallPrompt() {
  const standalone = window.matchMedia('(display-mode: standalone)').matches
    || (window.navigator as unknown as { standalone?: boolean }).standalone === true;
  if (standalone) return;
  window.addEventListener('beforeinstallprompt', event => {
    // Solo en el celu y si no dijo "Más tarde": ahí se ofrece en línea (nada flotante).
    // En la compu queda el ícono de instalar del navegador.
    if (installDismissed() || !window.matchMedia('(max-width: 768px)').matches) return;
    event.preventDefault();
    installEvent = event as BeforeInstallPromptEvent;
    set({ installable: true });
  });
  window.addEventListener('appinstalled', () => { installEvent = null; set({ installable: false }); });
}

/** "Instalar": el diálogo nativo del navegador. */
export async function promptInstall() {
  const event = installEvent;
  if (!event) return;
  installEvent = null;
  await event.prompt().catch(() => undefined);
  await event.userChoice.catch(() => undefined);
  set({ installable: false });
}

/** "Más tarde": no se vuelve a ofrecer en este navegador por 30 días. */
export function dismissInstall() {
  dismissedNow = true;
  try { localStorage.setItem(INSTALL_DISMISS_KEY, String(Date.now())); } catch { /* sin storage: solo por esta vez */ }
  installEvent = null;
  set({ installable: false });
}

/** "Actualizar": activa el SW nuevo y recarga con el index y los assets del último deploy. */
export function applyUpdate() {
  set({ updating: true });
  if (waiting) waiting.postMessage({ type: 'SKIP_WAITING' });
  else window.location.reload();
}

/**
 * Registra el service worker (solo en producción) y escucha:
 *  - un SW nuevo que quedó instalado y esperando → avisa "Hay una versión nueva";
 *  - el cambio de controlador (después de "Actualizar") → recarga una sola vez;
 *  - online / offline.
 * Busca versiones nuevas al volver a la pestaña y cada 30 minutos.
 */
export function initPwa() {
  window.addEventListener('online', () => set({ offline: false }));
  window.addEventListener('offline', () => set({ offline: true }));
  listenInstallPrompt();

  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  const hadController = Boolean(navigator.serviceWorker.controller);
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // La primera instalación también cambia el controlador: ahí no hay nada que recargar.
    if (!hadController || reloading) return;
    reloading = true;
    window.location.reload();
  });

  const track = (registration: ServiceWorkerRegistration) => {
    const markWaiting = (worker: ServiceWorker | null) => {
      if (!worker || !navigator.serviceWorker.controller) return;
      waiting = worker;
      set({ updateReady: true });
    };
    markWaiting(registration.waiting);
    registration.addEventListener('updatefound', () => {
      const worker = registration.installing;
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed') markWaiting(registration.waiting || worker);
      });
    });
    const check = () => { registration.update().catch(() => undefined); };
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
    window.setInterval(check, 30 * 60 * 1000);
  };

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' })
      .then(track)
      .catch(() => { /* sin SW la app funciona igual (sin modo offline) */ });
  });
}
