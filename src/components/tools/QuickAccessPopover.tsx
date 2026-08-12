import { useEffect, useRef, useState } from 'react';
import { Zap } from 'lucide-react';
import type { QuickLink } from '../../types';
import { groupLinks, useQuickLinks } from './QuickAccess';

// Versión de escritorio de Accesos rápidos: un botón en la topbar que abre un
// popover. En mobile el módulo sigue siendo una vista propia de la sidebar
// (el popover no entra bien en pantallas chicas).
export function QuickAccessPopover({ onOpenFull }: { onOpenFull?: () => void }) {
  const [open, setOpen] = useState(false);
  const { links } = useQuickLinks();
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const groups = groupLinks(links);

  return (
    <div className="quick-pop-wrap" ref={wrapRef}>
      <button
        className="topbar-icon-btn quick-pop-trigger"
        type="button"
        aria-label="Accesos rápidos"
        aria-expanded={open}
        title="Accesos rápidos"
        onClick={() => setOpen(value => !value)}
      >
        <Zap size={18} strokeWidth={2.1} />
      </button>
      {open && (
        <div className="quick-pop" role="dialog" aria-label="Accesos rápidos">
          <div className="quick-pop-head">
            <strong>Accesos rápidos</strong>
            {onOpenFull && <button type="button" onClick={() => { setOpen(false); onOpenFull(); }}>Administrar</button>}
          </div>
          {!links.length && <p className="muted">Todavía no hay accesos cargados.</p>}
          {groups.map(([categoria, rows]) => (
            <div className="quick-pop-group" key={categoria}>
              <span>{categoria}</span>
              {rows.map((link: QuickLink) => (
                <a key={link.id} href={link.url} target="_blank" rel="noreferrer" onClick={() => setOpen(false)}>
                  <strong>{link.titulo}</strong>
                  {link.descripcion && <small>{link.descripcion}</small>}
                </a>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
