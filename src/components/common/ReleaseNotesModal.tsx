import { useEffect, useRef, useState } from 'react';
import { getLatestRelease } from '../../services/notificationsApi';
import { useMountTransition } from '../../hooks/useMountTransition';

const SEEN_KEY = 'techasset_last_seen_release';

// F2.4: la primera vez que el user entra tras un release nuevo, le mostramos qué cambió.
export function ReleaseNotesModal() {
  const [release, setRelease] = useState<{ version: string; title: string; bodyMd: string } | null>(null);
  const anim = useMountTransition(!!release, 150); // --modal-close-dur
  const lastReleaseRef = useRef(release);

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

  // Se retiene la última release para tener qué dibujar mientras el modal se
  // va: cuando arranca el cierre, `release` ya es null.
  if (release) lastReleaseRef.current = release;
  const shown = release || lastReleaseRef.current;
  if (!anim.mounted || !shown) return null;

  const close = () => {
    localStorage.setItem(SEEN_KEY, shown.version);
    setRelease(null);
  };

  const blocks = parseRelease(shown.bodyMd);

  return (
    <div className={`release-modal-overlay t-fade ${anim.stateClass}`.trim()} role="dialog" aria-modal="true" onClick={close}>
      <div className="release-modal t-pop" onClick={e => e.stopPropagation()}>
        <span className="release-modal-tag">Novedades · {shown.version.startsWith('v') ? shown.version : `v${shown.version}`}</span>
        <h2 className="release-modal-title">{shown.title}</h2>
        <div className="release-modal-content">{blocks.map((block,index)=>block.type==='heading'?<h3 key={index}>{block.text}</h3>:block.type==='item'?<div className="release-modal-item" key={index}><span>✓</span><p>{block.text}</p></div>:<p key={index}>{block.text}</p>)}</div>
        <button type="button" className="btn btn-primary release-modal-cta" onClick={close}>¡Buenísimo!</button>
      </div>
    </div>
  );
}

function parseRelease(markdown:string){return String(markdown||'').split('\n').map(line=>line.trim()).filter(Boolean).map(line=>{const heading=line.match(/^#{1,6}\s+(.+)/);const item=line.match(/^[-*+]\s+(.+)/);const text=(heading?.[1]||item?.[1]||line).replace(/\*\*(.*?)\*\*/g,'$1').replace(/`([^`]+)`/g,'$1').replace(/\[(.*?)\]\([^)]*\)/g,'$1');return {type:heading?'heading':item?'item':'paragraph',text} as {type:'heading'|'item'|'paragraph';text:string};});}
