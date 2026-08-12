import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';

export interface SelectOption {
  value: string;
  label: string;
  /** Línea chica debajo del label, para contadores o aclaraciones. */
  hint?: string;
}

// Reemplazo del <select> nativo: la lista desplegable del navegador no se puede
// estilar (borde duro, franja azul sólida) y quedaba como una caja pegada de
// otro sistema. Esto usa los mismos tokens del tema que el resto de la app.
export function SelectField({ value, options, onChange, disabled, placeholder, className = '', ariaLabel }: {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const listId = useId();

  const selectedIndex = useMemo(() => options.findIndex(option => option.value === value), [options, value]);
  const selected = selectedIndex >= 0 ? options[selectedIndex] : null;

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    setActive(selectedIndex >= 0 ? selectedIndex : 0);
    const onPointer = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close();
    };
    // Capturing: si el select vive dentro de un modal, el click afuera lo cierra
    // a él primero y no se lleva puesto el modal entero.
    document.addEventListener('mousedown', onPointer);
    return () => document.removeEventListener('mousedown', onPointer);
  }, [open, selectedIndex, close]);

  // El item activo siempre visible cuando se navega con flechas.
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  const commit = (index: number) => {
    const option = options[index];
    if (!option) return;
    onChange(option.value);
    close();
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (disabled) return;
    if (!open) {
      if (['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(event.key)) {
        event.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive(current => Math.min(current + 1, options.length - 1));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive(current => Math.max(current - 1, 0));
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      setActive(0);
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      setActive(options.length - 1);
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      commit(active);
      return;
    }
    if (event.key === 'Tab') close();
  };

  return (
    <div className={`field-select ${open ? 'is-open' : ''} ${className}`.trim()} ref={rootRef}>
      <button
        type="button"
        className="field-select-trigger"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={ariaLabel}
        onClick={() => setOpen(current => !current)}
        onKeyDown={onKeyDown}
      >
        <span className={selected ? '' : 'is-placeholder'}>{selected?.label || placeholder || 'Elegí una opción'}</span>
        <i aria-hidden="true" />
      </button>

      {open && (
        <div className="field-select-list" role="listbox" id={listId} ref={listRef} tabIndex={-1}>
          {options.map((option, index) => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === value}
              data-active={index === active}
              className={`field-select-option ${option.value === value ? 'is-selected' : ''}`}
              onMouseEnter={() => setActive(index)}
              onClick={() => commit(index)}
            >
              <span>{option.label}</span>
              {option.hint && <em>{option.hint}</em>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
