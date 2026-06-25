import { useEffect, useState } from 'react';
import { getLatestRelease } from '../../services/notificationsApi';

const SEEN_KEY = 'techasset_last_seen_release';

// F2.4: la primera vez que el user entra tras un release nuevo, le mostramos qué cambió.
export function ReleaseNotesModal() {
  const [release, setRelease] = useState<{ version: string; title: string; bodyMd: string } | null>(null);

  const loadLatest = (force = false) => {
    let alive = true;
    getLatestRelease()
      .then(res => {
        if (!alive || !res.release) return;
        if (!force && localStorage.getItem(SEEN_KEY) === res.release.version) return;
        setRelease(res.release);
      })
      .catch(() => { /* no logueado / sin releases */ });
    return () => { alive = false; };
  };

  useEffect(() => {
    const cleanup = loadLatest(false);
    const open = () => { void loadLatest(true); };
    window.addEventListener('techasset:open-release-notes', open);
    return () => {
      cleanup();
      window.removeEventListener('techasset:open-release-notes', open);
    };
  }, []);

  if (!release) return null;

  const close = () => {
    localStorage.setItem(SEEN_KEY, release.version);
    setRelease(null);
  };

  const lines = release.bodyMd.split('\n').map(l => l.trim()).filter(Boolean);

  return (
    <div className="release-modal-overlay" role="dialog" aria-modal="true" onClick={close}>
      <div className="release-modal" onClick={e => e.stopPropagation()}>
        <span className="release-modal-tag">Novedades · v{release.version}</span>
        <h2 className="release-modal-title">{release.title}</h2>
        <ul className="release-modal-list">
          {lines.map((line, i) => (
            <li key={i}>{line.replace(/^[-*]\s+/, '').replace(/\*\*/g, '')}</li>
          ))}
        </ul>
        <button type="button" className="btn btn-primary release-modal-cta" onClick={close}>¡Buenísimo!</button>
      </div>
    </div>
  );
}
