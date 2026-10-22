import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Bot, CornerDownLeft, ExternalLink, Search, X } from 'lucide-react';
import type { Device, QuickLink, ViewKey } from '../../types';
import { matchesSmartSearch, resolveDeviceMatches } from '../../utils/normalizeSearch';
import { getOperationalAlias } from '../../utils/classifyDevice';
import { getDeviceStateKey } from '../../utils/deviceState';
import { fold, keepInView } from '../../ui/util';
import { useScrollEdges } from '../../ui/scrollEdges';
import { StripCollapse } from './ShellStrips';
import { AutoHeight } from '../../ui/Collapse';
import type { NavItem } from './nav';

/**
 * Ctrl K / "Buscar o ir a…": paleta EN LÍNEA (franja bajo la barra superior,
 * empuja el contenido). Recupera la búsqueda global que había quedado sin
 * campo: equipos con el motor flexible (touch 34, touch34, 34touch, D1436,
 * 1436, plani 5, planificación 5) → salta a la fila; "prestar D1436" →
 * Préstamos con la etiqueta; secciones; accesos rápidos; "Preguntar al
 * asistente". Flechas, Enter y Esc.
 */
type Entry = {
  id: string;
  group: 'devices' | 'actions' | 'views' | 'links' | 'assistant';
  label: ReactNode;
  meta?: ReactNode;
  icon?: ReactNode;
  external?: boolean;
  run: () => void;
};

const GROUP_LABEL: Record<Entry['group'], string> = {
  actions: 'Acciones',
  devices: 'Equipos',
  views: 'Ir a',
  links: 'Accesos rápidos',
  assistant: 'Asistente'
};
// Con un verbo ("prestar D1436") manda la acción; si no, el equipo (ir a la fila).
const ORDER_COMMAND: Entry['group'][] = ['actions', 'devices', 'views', 'links', 'assistant'];
const ORDER_SEARCH: Entry['group'][] = ['devices', 'actions', 'views', 'links', 'assistant'];
const MAX_PER_GROUP = 6;

const STATE_TEXT: Record<string, string> = { available: 'Disponible', loaned: 'Prestado', missing: 'No encontrado', out: 'Fuera de servicio' };
const COMMAND = /^(prest(?:ar|a|ale|á|ále)|pr[eé]stamo|devolv(?:er|e|é)|devoluci[oó]n|ficha|ver)\s+(.+)$/i;
// Sobre el texto ya sin tildes ni mayúsculas (fold).
const PRIVACY = /privac|mis datos|datos personales|termino|legal|baja de la cuenta|borrar (mi )?cuenta/;

export function CommandPalette({ open, devices, navItems, links, consultationMode, canAsk, canManageLinks, onGoView, onJumpToDevice, onLoan, onProfile, onAsk, onManageLinks, onClose }: {
  open: boolean;
  devices: Device[];
  navItems: NavItem[];
  links: QuickLink[];
  consultationMode: boolean;
  canAsk: boolean;
  canManageLinks: boolean;
  onGoView: (view: ViewKey) => void;
  onJumpToDevice: (device: Device) => void;
  onLoan: (code: string) => void;
  onProfile: (device: Device) => void;
  onAsk: (question: string) => void;
  onManageLinks: () => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useScrollEdges<HTMLDivElement>();
  const hasLoans = navItems.some(item => item.key === 'loans');

  // Cada vez que se abre (también si se reabre mientras se cerraba): vacía y con el foco en el campo.
  // En layout effect: si se reabre mientras se cierra, lo que se tipea enseguida no cae sobre la
  // búsqueda anterior (con useEffect el foco y el vaciado podían llegar después de las teclas).
  useLayoutEffect(() => {
    if (!open) return;
    setQuery('');
    inputRef.current?.focus({ preventScroll: true });
  }, [open]);

  const entries = useMemo<Entry[]>(() => {
    const q = query.trim();
    const fq = fold(q);
    const out: Entry[] = [];
    const deviceLabel = (device: Device) => getOperationalAlias(device) || device.etiqueta;
    const stateOf = (device: Device) => STATE_TEXT[getDeviceStateKey(device)] || device.estado || '';

    // "prestar D1436", "devolver touch 34", "ficha plani 5"
    const command = q.match(COMMAND);
    if (command) {
      const verb = fold(command[1]);
      const target = command[2].trim();
      const match = resolveDeviceMatches(devices, target)[0];
      const code = match?.etiqueta || target;
      if (/^(ficha|ver)/.test(verb)) {
        if (match) out.push({ id: `cmd-profile-${code}`, group: 'actions', label: <>Ver ficha de <b>{deviceLabel(match)}</b></>, meta: match.etiqueta, run: () => onProfile(match) });
      } else if (hasLoans && !consultationMode) {
        const lend = /^pr/.test(verb);
        out.push({ id: `cmd-loan-${code}`, group: 'actions', label: <>{lend ? 'Prestar' : 'Devolver'} <b>{match ? deviceLabel(match) : code}</b></>, meta: 'en Préstamos', run: () => onLoan(code) });
      }
    }

    if (q.length >= 2 && !command) {
      const found = devices.filter(device => matchesSmartSearch(device, q)).slice(0, MAX_PER_GROUP);
      for (const device of found) {
        out.push({
          id: `dev-${device.etiqueta}`,
          group: 'devices',
          label: <><b>{deviceLabel(device)}</b>{deviceLabel(device) !== device.etiqueta && <span className="shell-pal-mono g-num"> {device.etiqueta}</span>}</>,
          meta: [stateOf(device), device.prestadoA].filter(Boolean).join(' · '),
          run: () => onJumpToDevice(device)
        });
      }
      // Acciones del mejor resultado, sin tener que escribir el verbo.
      const best = found[0];
      if (best && found.length === 1) {
        const state = getDeviceStateKey(best);
        if (hasLoans && !consultationMode && (state === 'available' || state === 'loaned')) {
          out.push({ id: `act-loan-${best.etiqueta}`, group: 'actions', label: <>{state === 'loaned' ? 'Devolver' : 'Prestar'} <b>{deviceLabel(best)}</b></>, meta: 'en Préstamos', run: () => onLoan(best.etiqueta) });
        }
        out.push({ id: `act-profile-${best.etiqueta}`, group: 'actions', label: <>Ver ficha de <b>{deviceLabel(best)}</b></>, meta: best.etiqueta, run: () => onProfile(best) });
      }
    }

    const views = navItems.filter(item => !fq || fold(`${item.label} ${item.hint} ${item.key}`).includes(fq));
    for (const item of views.slice(0, fq ? MAX_PER_GROUP : 8)) {
      const Icon = item.Icon;
      out.push({ id: `view-${item.key}`, group: 'views', icon: <Icon size={14} strokeWidth={1.6} aria-hidden={true} />, label: item.label, meta: item.hint, run: () => onGoView(item.key) });
    }

    const linkMatches = links.filter(link => !fq || fold(`${link.titulo} ${link.descripcion || ''} ${link.categoria || ''}`).includes(fq));
    for (const link of linkMatches.slice(0, MAX_PER_GROUP)) {
      out.push({ id: `link-${link.id}`, group: 'links', external: true, label: link.titulo, meta: hostOf(link.url), run: () => { window.open(link.url, '_blank', 'noopener,noreferrer'); } });
    }

    // "privacidad", "mis datos", "términos": la página pública de Privacidad (otra pestaña).
    if (fq.length >= 4 && PRIVACY.test(fq)) {
      out.push({ id: 'privacy', group: 'links', external: true, label: 'Privacidad y datos', meta: 'Qué datos guarda TechAsset y quién los ve', run: () => { window.open('/privacidad', '_blank', 'noopener,noreferrer'); } });
    }

    if (q && canAsk) {
      out.push({ id: 'ask', group: 'assistant', icon: <Bot size={14} strokeWidth={1.6} aria-hidden="true" />, label: <>Preguntar al asistente: “{q}”</>, run: () => onAsk(q) });
    }
    const order = command ? ORDER_COMMAND : ORDER_SEARCH;
    return order.flatMap(group => out.filter(entry => entry.group === group));
  }, [query, devices, navItems, links, consultationMode, canAsk, hasLoans, onGoView, onJumpToDevice, onLoan, onProfile, onAsk]);

  // Ejemplos con un equipo real de la sede (no uno que no existe acá).
  const placeholder = useMemo(() => {
    const sample = devices.find(device => device.etiqueta && getOperationalAlias(device)) || devices.find(device => device.etiqueta);
    if (!sample) return 'Buscá un equipo, una sección o un acceso';
    const alias = getOperationalAlias(sample);
    const examples = [alias ? alias.toLowerCase() : '', sample.etiqueta].filter(Boolean).join(', ');
    return `Buscá un equipo (${examples}), una sección, un acceso, o escribí “prestar ${sample.etiqueta}”`;
  }, [devices]);

  useEffect(() => { setActive(0); }, [query]);
  const safeActive = Math.min(active, Math.max(0, entries.length - 1));

  // El activo siempre a la vista dentro de la lista (sin mover la página ni la franja).
  useEffect(() => {
    const list = listRef.current;
    keepInView(list, list?.querySelector<HTMLElement>(`[data-index="${safeActive}"]`) || null);
  }, [safeActive, listRef]);

  const runEntry = (entry: Entry | undefined) => {
    if (!entry) return;
    entry.run();
    onClose();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); setActive(index => (entries.length ? (Math.min(index, entries.length - 1) + 1) % entries.length : 0)); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setActive(index => (entries.length ? (Math.min(index, entries.length - 1) - 1 + entries.length) % entries.length : 0)); }
    else if (event.key === 'Home' && event.ctrlKey) { event.preventDefault(); setActive(0); }
    else if (event.key === 'Enter') { event.preventDefault(); runEntry(entries[safeActive]); }
    else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (query) setQuery(''); else onClose(); }
  };

  const groupOrder = [...new Set(entries.map(entry => entry.group))];
  const groups = groupOrder.map(group => ({ group, items: entries.map((entry, index) => ({ entry, index })).filter(row => row.entry.group === group) })).filter(row => row.items.length);
  const activeId = entries[safeActive] ? `shell-pal-${entries[safeActive].id}` : undefined;

  return (
    <StripCollapse open={open}>
    <section id="shell-strip-palette" className="shell-strip shell-palette" aria-label="Buscar o ir a" data-scanner-ignore="">
      <div className="shell-pal-field">
        <Search size={16} strokeWidth={1.6} aria-hidden="true" />
        <input
          ref={inputRef}
          className="shell-pal-input"
          type="text"
          value={query}
          onChange={event => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          aria-label="Buscar o ir a"
          role="combobox"
          aria-expanded="true"
          aria-controls="shell-pal-list"
          aria-activedescendant={activeId}
          autoComplete="off"
          spellCheck={false}
        />
        <kbd className="ui-kbd">Esc</kbd>
        <button type="button" className="shell-icon-btn" aria-label="Cerrar búsqueda" onClick={onClose}>
          <X size={16} strokeWidth={1.6} aria-hidden="true" />
        </button>
      </div>
      <div className="shell-pal-results ui-scroll-fade" id="shell-pal-list" role="listbox" aria-label="Resultados" ref={listRef}>
        {/* Los resultados cambian de alto suave mientras tipeás (nunca de golpe). */}
        <AutoHeight innerClassName="shell-pal-grid">
        {groups.map(({ group, items }) => (
          <div className="shell-pal-group" key={group} role="group" aria-label={GROUP_LABEL[group]}>
            <div className="g-eyebrow shell-pal-group-label" aria-hidden="true">{GROUP_LABEL[group]}</div>
            {items.map(({ entry, index }) => (
              <div
                key={entry.id}
                id={`shell-pal-${entry.id}`}
                data-index={index}
                role="option"
                aria-selected={index === safeActive}
                className={`shell-pal-item${index === safeActive ? ' is-active' : ''}`}
                onMouseMove={() => { if (index !== safeActive) setActive(index); }}
                onMouseDown={event => event.preventDefault()}
                onClick={() => runEntry(entry)}
              >
                {entry.icon && <span className="shell-pal-icon">{entry.icon}</span>}
                <span className="shell-pal-text">
                  <span className="shell-pal-label">{entry.label}</span>
                  {entry.meta && <span className="shell-pal-meta">{entry.meta}</span>}
                </span>
                {entry.external && <ExternalLink size={14} strokeWidth={1.6} aria-hidden="true" />}
                {index === safeActive && <CornerDownLeft className="shell-pal-enter" size={14} strokeWidth={1.6} aria-hidden="true" />}
              </div>
            ))}
          </div>
        ))}
        {!entries.length && <p className="shell-strip-empty">Nada coincide con “{query.trim()}”.</p>}
        </AutoHeight>
      </div>
      <div className="shell-pal-foot">
        <span className="shell-pal-keys"><kbd className="ui-kbd">↑</kbd><kbd className="ui-kbd">↓</kbd> moverse <kbd className="ui-kbd">Enter</kbd> abrir <kbd className="ui-kbd">Esc</kbd> cerrar</span>
        {canManageLinks && <button type="button" className="shell-link-btn" onClick={() => { onManageLinks(); onClose(); }}>Administrar accesos</button>}
      </div>
    </section>
    </StripCollapse>
  );
}

function hostOf(url: string) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}
