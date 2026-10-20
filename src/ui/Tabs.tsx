import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { AutoHeight } from './Collapse';
import { cx } from './util';

export type TabItem<V extends string = string> = {
  value: V;
  label: ReactNode;
  count?: ReactNode;
  disabled?: boolean;
};

export type TabsProps<V extends string = string> = {
  tabs: TabItem<V>[];
  value: V;
  onChange: (value: V) => void;
  ariaLabel: string;
  /** Contenido del panel activo (se rotula con la pestaña). */
  children?: ReactNode;
  className?: string;
};

/**
 * Pestañas con indicador deslizante (solo transform). Activación automática:
 * las flechas cambian de pestaña. Si no entran en una fila, envuelven (sin
 * scroll lateral) y el indicador sigue a la pestaña en su renglón.
 * Expone `data-tab-active` en la pestaña activa (lo leen pruebas y scripts).
 */
export function Tabs<V extends string = string>({ tabs, value, onChange, ariaLabel, children, className }: TabsProps<V>) {
  const base = useId().replace(/:/g, '');
  const listRef = useRef<HTMLDivElement | null>(null);
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const [bar, setBar] = useState<{ x: number; y: number; w: number } | null>(null);
  const activeIndex = Math.max(0, tabs.findIndex(tab => tab.value === value));

  // Se mide al cambiar la pestaña y cuando cambia el tamaño de la lista (un
  // ResizeObserver, sin leer layout en cada render).
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const measure = () => {
      const tab = refs.current[activeIndex];
      if (!tab) return;
      const next = { x: tab.offsetLeft, y: tab.offsetTop + tab.offsetHeight, w: tab.offsetWidth };
      setBar(current => (current && current.x === next.x && current.y === next.y && current.w === next.w ? current : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    return () => observer.disconnect();
  }, [activeIndex, tabs.length]);

  const onKeyDown = (event: KeyboardEvent) => {
    const enabled = tabs.map((tab, index) => (tab.disabled ? -1 : index)).filter(index => index >= 0);
    const position = enabled.indexOf(activeIndex);
    let next: number | null = null;
    if (event.key === 'ArrowRight') next = enabled[(position + 1) % enabled.length];
    else if (event.key === 'ArrowLeft') next = enabled[(position - 1 + enabled.length) % enabled.length];
    else if (event.key === 'Home') next = enabled[0];
    else if (event.key === 'End') next = enabled[enabled.length - 1];
    if (next === null || next === undefined) return;
    event.preventDefault();
    onChange(tabs[next].value);
    refs.current[next]?.focus();
  };

  return (
    <div className={cx('ui-tabs', className)}>
      <div ref={listRef} role="tablist" aria-label={ariaLabel} className="ui-tablist" onKeyDown={onKeyDown}>
        {tabs.map((tab, index) => {
          const selected = index === activeIndex;
          return (
            <button
              key={tab.value}
              ref={node => { refs.current[index] = node; }}
              id={`${base}-t${index}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={children !== undefined ? `${base}-p` : undefined}
              tabIndex={selected ? 0 : -1}
              disabled={tab.disabled}
              data-tab-active={selected ? 'true' : undefined}
              className={cx('ui-tab', selected && 'is-active')}
              onClick={() => onChange(tab.value)}
            >
              <span className="ui-tab-label">{tab.label}</span>
              {tab.count !== undefined && <span className="ui-tab-count g-num">{tab.count}</span>}
            </button>
          );
        })}
        {bar && (
          <span
            className="ui-tab-bar"
            aria-hidden="true"
            style={{ transform: `translate(${bar.x}px, ${bar.y}px) scaleX(${bar.w})` }}
          />
        )}
      </div>
      {children !== undefined && (
        <div role="tabpanel" id={`${base}-p`} aria-labelledby={`${base}-t${activeIndex}`} className="ui-tabpanel" tabIndex={0}>
          {/* Cambiar de pestaña cambia el alto suave (la pestaña tocada no se mueve). */}
          <AutoHeight>{children}</AutoHeight>
        </div>
      )}
    </div>
  );
}
