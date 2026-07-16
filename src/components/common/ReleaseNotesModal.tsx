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

  const blocks = parseRelease(release.bodyMd);

  return (
    <div className="release-modal-overlay" role="dialog" aria-modal="true" onClick={close}>
      <div className="release-modal" onClick={e => e.stopPropagation()}>
        <span className="release-modal-tag">Novedades · {release.version.startsWith('v') ? release.version : `v${release.version}`}</span>
        <h2 className="release-modal-title">{release.title}</h2>
        <div className="release-modal-content">{blocks.map((block,index)=>block.type==='heading'?<h3 key={index}>{block.text}</h3>:block.type==='item'?<div className="release-modal-item" key={index}><span>✓</span><p>{block.text}</p></div>:<p key={index}>{block.text}</p>)}</div>
        <button type="button" className="btn btn-primary release-modal-cta" onClick={close}>¡Buenísimo!</button>
      </div>
    </div>
  );
}

function parseRelease(markdown:string){return String(markdown||'').split('\n').map(line=>line.trim()).filter(Boolean).map(line=>{const heading=line.match(/^#{1,6}\s+(.+)/);const item=line.match(/^[-*+]\s+(.+)/);const text=(heading?.[1]||item?.[1]||line).replace(/\*\*(.*?)\*\*/g,'$1').replace(/`([^`]+)`/g,'$1').replace(/\[(.*?)\]\([^)]*\)/g,'$1');return {type:heading?'heading':item?'item':'paragraph',text} as {type:'heading'|'item'|'paragraph';text:string};});}
