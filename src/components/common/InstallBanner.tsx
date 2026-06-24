import { useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISS_KEY = 'techasset_install_dismissed';

// E5: banner "Instalar app". Solo en móvil, si no está ya instalada y el navegador
// disparó beforeinstallprompt (Android/Chrome). En iOS no existe ese evento.
export function InstallBanner() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (localStorage.getItem(DISMISS_KEY) === '1') return;
    const isMobile = window.matchMedia('(max-width: 768px)').matches;
    const standalone = window.matchMedia('(display-mode: standalone)').matches
      || (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    if (!isMobile || standalone) return;

    const onPrompt = (event: Event) => {
      event.preventDefault();
      setDeferred(event as BeforeInstallPromptEvent);
      setVisible(true);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', () => setVisible(false));
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  if (!visible) return null;

  const install = async () => {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice.catch(() => {});
    setVisible(false);
    setDeferred(null);
  };

  const later = () => {
    localStorage.setItem(DISMISS_KEY, '1');
    setVisible(false);
  };

  return (
    <div className="install-banner">
      <img src="/techasset-logo.svg" alt="" className="install-banner-logo" />
      <div className="install-banner-text">
        <strong>Instalá TechAsset</strong>
        <span>Tenela como app en tu celu, sin abrir el navegador.</span>
      </div>
      <div className="install-banner-actions">
        <button type="button" className="btn btn-primary" onClick={install}>Instalar</button>
        <button type="button" className="btn btn-secondary" onClick={later}>Más tarde</button>
      </div>
    </div>
  );
}
