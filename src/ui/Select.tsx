import { useEffect, useMemo, useRef, useState, type FocusEvent, type KeyboardEvent, type ReactNode } from 'react';
import { FieldShell, useFieldIds, type FieldProps } from './Field';
import { IconCheck, IconChevronDown, IconSearch } from './icons';
import { cx, fold, keepInView } from './util';

/**
 * Select y Combobox propios. La lista se despliega EN LÍNEA: es parte del
 * flujo, empuja lo de abajo y nunca flota ni tapa nada. Si hay muchas
 * opciones, la lista muestra `maxVisible` filas y scrollea por dentro con la
 * barra oculta y un degradé en el borde que avisa que hay más.
 */

export interface SelectOption {
  value: string;
  label: string;
  /** Línea chica a la derecha (contadores, aclaraciones). Mismo campo que el SelectField viejo. */
  hint?: string;
  disabled?: boolean;
}

/* ── Lista compartida ───────────────────────────────────────────────────── */

function Listbox({ id, options, value, active, onActive, onPick, maxVisible, emptyText, label }: {
  id: string;
  options: SelectOption[];
  value?: string;
  active: number;
  onActive: (index: number) => void;
  onPick: (option: SelectOption) => void;
  maxVisible: number;
  emptyText: ReactNode;
  label?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [edges, setEdges] = useState({ top: false, bottom: false });

  const measure = () => {
    const el = ref.current;
    if (!el) return;
    const top = el.scrollTop > 1;
    const bottom = el.scrollTop + el.clientHeight < el.scrollHeight - 1;
    setEdges(current => (current.top === top && current.bottom === bottom ? current : { top, bottom }));
  };

  useEffect(() => {
    keepInView(ref.current, ref.current?.querySelector<HTMLElement>('[data-active="true"]') || null);
    measure();
  }, [active, options.length]);

  return (
    <div
      ref={ref}
      id={id}
      role="listbox"
      aria-label={label}
      tabIndex={-1}
      className={cx('ui-listbox', edges.top && 'fade-top', edges.bottom && 'fade-bottom')}
      style={{ ['--ui-max-rows' as string]: maxVisible }}
      onScroll={measure}
    >
      {options.map((option, index) => (
        <div
          key={option.value}
          id={`${id}-o${index}`}
          role="option"
          aria-selected={option.value === value}
          aria-disabled={option.disabled || undefined}
          data-active={index === active}
          className={cx('ui-option', option.value === value && 'is-selected', option.disabled && 'is-disabled')}
          // El foco se queda en el disparador / buscador: la lista usa aria-activedescendant.
          onMouseDown={event => event.preventDefault()}
          onPointerMove={() => { if (index !== active && !option.disabled) onActive(index); }}
          onClick={() => { if (!option.disabled) onPick(option); }}
        >
          <span className="ui-option-label">{option.label}</span>
          {option.hint && <span className="ui-option-hint">{option.hint}</span>}
          <span className="ui-option-check" aria-hidden="true">{option.value === value && <IconCheck size={14} />}</span>
        </div>
      ))}
      {!options.length && <div className="ui-listbox-empty">{emptyText}</div>}
    </div>
  );
}

function nextEnabled(options: SelectOption[], from: number, dir: 1 | -1) {
  for (let step = 1; step <= options.length; step += 1) {
    const index = from + dir * step;
    if (index < 0 || index >= options.length) return from;
    if (!options[index].disabled) return index;
  }
  return from;
}
function firstEnabled(options: SelectOption[], fromEnd = false) {
  const list = fromEnd ? [...options.keys()].reverse() : [...options.keys()];
  return list.find(index => !options[index].disabled) ?? -1;
}

/** Type-ahead: letras tipeadas en < 600 ms se suman a la búsqueda. */
function useTypeahead() {
  const buffer = useRef('');
  const timer = useRef<number | undefined>(undefined);
  return (char: string) => {
    window.clearTimeout(timer.current);
    buffer.current += fold(char);
    timer.current = window.setTimeout(() => { buffer.current = ''; }, 600);
    return buffer.current;
  };
}

function isPrintable(event: KeyboardEvent) {
  return event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey;
}

/* ── Select ─────────────────────────────────────────────────────────────── */

export type SelectProps = FieldProps & {
  id?: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  /** Nombre accesible si no hay label visible (mismo nombre que en el SelectField viejo). */
  ariaLabel?: string;
  /** Buscador arriba de la lista. 'auto' = más de 8 opciones. */
  searchable?: boolean | 'auto';
  searchPlaceholder?: string;
  /** Filas visibles antes de scrollear por dentro (default 8). */
  maxVisible?: number;
  size?: 'sm' | 'md';
  emptyText?: ReactNode;
  name?: string;
  /** Abre la lista al montar (página de muestra, formularios que arrancan eligiendo). */
  defaultOpen?: boolean;
  'data-force'?: string;
};

export function Select({ id: idProp, value, options, onChange, disabled, placeholder, ariaLabel, searchable = 'auto', searchPlaceholder = 'Buscar…', maxVisible = 8, size = 'md', emptyText = 'Sin coincidencias', name, defaultOpen = false, label, hint, error, success, required, reserveHelp, className, 'data-force': force }: SelectProps) {
  const { id, helpId, describedBy, invalid } = useFieldIds(idProp, { hint, error, success });
  const listId = `${id}-list`;
  const [open, setOpen] = useState(defaultOpen);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(() => (defaultOpen ? options.findIndex(option => option.value === value) : -1));
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const typeahead = useTypeahead();
  const withSearch = searchable === 'auto' ? options.length > 8 : searchable;

  const selected = options.find(option => option.value === value) || null;
  const filtered = useMemo(() => {
    const q = fold(query);
    if (!q) return options;
    return options.filter(option => fold(option.label).includes(q) || fold(option.hint || '').includes(q));
  }, [options, query]);

  const openList = (seed = '') => {
    if (disabled) return;
    setQuery(seed);
    setOpen(true);
    const base = seed ? options.filter(option => fold(option.label).includes(fold(seed))) : options;
    const current = base.findIndex(option => option.value === value);
    setActive(current >= 0 ? current : firstEnabled(base));
  };
  const close = (refocus = false) => {
    setOpen(false);
    setQuery('');
    if (refocus) triggerRef.current?.focus();
  };
  const pick = (option: SelectOption) => {
    if (option.value !== value) onChange(option.value);
    close(true);
  };

  const mounted = useRef(false);
  useEffect(() => {
    // Al abrir por el usuario el foco va al buscador; con defaultOpen no se roba el foco al montar.
    if (open && withSearch && mounted.current) searchRef.current?.focus();
    mounted.current = true;
  }, [open, withSearch]);
  // Al filtrar, el activo pasa al primer resultado.
  useEffect(() => { if (open && query) setActive(firstEnabled(filtered)); }, [query]); // eslint-disable-line react-hooks/exhaustive-deps

  const navKeys = (event: KeyboardEvent) => {
    const list = filtered;
    switch (event.key) {
      case 'ArrowDown': event.preventDefault(); setActive(current => (current < 0 ? firstEnabled(list) : nextEnabled(list, current, 1))); return true;
      case 'ArrowUp': event.preventDefault(); setActive(current => (current < 0 ? firstEnabled(list, true) : nextEnabled(list, current, -1))); return true;
      case 'Home': event.preventDefault(); setActive(firstEnabled(list)); return true;
      case 'End': event.preventDefault(); setActive(firstEnabled(list, true)); return true;
      case 'PageDown': event.preventDefault(); setActive(current => Math.min(list.length - 1, Math.max(0, current) + maxVisible)); return true;
      case 'PageUp': event.preventDefault(); setActive(current => Math.max(0, current - maxVisible)); return true;
      case 'Enter': event.preventDefault(); if (list[active] && !list[active].disabled) pick(list[active]); return true;
      case 'Escape': event.preventDefault(); event.stopPropagation(); close(true); return true;
      case 'Tab': close(); return false;
      default: return false;
    }
  };

  const onTriggerKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    if (!open) {
      if (['Enter', ' ', 'ArrowDown', 'ArrowUp', 'F4'].includes(event.key) || (event.key === 'ArrowDown' && event.altKey)) {
        event.preventDefault();
        openList();
        return;
      }
      if (isPrintable(event)) {
        event.preventDefault();
        // Lo consume el type-ahead: que no lo junte el escáner USB global de App.
        event.stopPropagation();
        if (withSearch) { openList(event.key); return; }
        // Cerrado y sin buscador: como el nativo, la letra elige directo.
        const q = typeahead(event.key);
        const match = options.find(option => !option.disabled && fold(option.label).startsWith(q));
        if (match && match.value !== value) onChange(match.value);
      }
      return;
    }
    if (navKeys(event)) return;
    if (event.key === ' ') { event.preventDefault(); if (filtered[active]) pick(filtered[active]); return; }
    if (isPrintable(event)) {
      event.stopPropagation();
      const q = typeahead(event.key);
      const index = filtered.findIndex(option => !option.disabled && fold(option.label).startsWith(q));
      if (index >= 0) setActive(index);
    }
  };

  const onRootBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (open && !rootRef.current?.contains(event.relatedTarget as Node | null)) close();
  };

  const activeId = open && active >= 0 && filtered[active] ? `${listId}-o${active}` : undefined;

  return (
    <FieldShell id={id} helpId={helpId} label={label} hint={hint} error={error} success={success} required={required} reserveHelp={reserveHelp} className={className}>
      <div className={cx('ui-select', open && 'is-open')} ref={rootRef} onBlur={onRootBlur} data-scanner-ignore="">
        <button
          ref={triggerRef}
          id={id}
          type="button"
          role="combobox"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-activedescendant={withSearch ? undefined : activeId}
          aria-label={ariaLabel}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          aria-required={required || undefined}
          disabled={disabled}
          data-force={force}
          className={cx('ui-control', 'ui-select-trigger', size === 'sm' && 'ui-control--sm', invalid && 'is-error', !invalid && success && 'is-success')}
          onClick={() => (open ? close() : openList())}
          onKeyDown={onTriggerKey}
        >
          <span className={cx('ui-select-value', !selected && 'is-placeholder')}>{selected?.label || placeholder || 'Elegí una opción'}</span>
          {selected?.hint && <span className="ui-option-hint">{selected.hint}</span>}
          <span className="ui-select-chevron" aria-hidden="true"><IconChevronDown size={16} /></span>
        </button>
        {name && <input type="hidden" name={name} value={value} />}
        {open && (
          <div className="ui-select-panel">
            {withSearch && (
              <div className="ui-select-search">
                <IconSearch size={14} />
                <input
                  ref={searchRef}
                  className="ui-input-el"
                  type="text"
                  role="combobox"
                  aria-autocomplete="list"
                  aria-expanded="true"
                  aria-controls={listId}
                  aria-activedescendant={activeId}
                  aria-label={`Buscar en ${typeof label === 'string' ? label : ariaLabel || 'la lista'}`}
                  placeholder={searchPlaceholder}
                  value={query}
                  autoComplete="off"
                  onChange={event => setQuery(event.target.value)}
                  onKeyDown={navKeys}
                />
              </div>
            )}
            <Listbox
              id={listId}
              options={filtered}
              value={value}
              active={active}
              onActive={setActive}
              onPick={pick}
              maxVisible={maxVisible}
              emptyText={emptyText}
              label={typeof label === 'string' ? label : ariaLabel}
            />
          </div>
        )}
      </div>
    </FieldShell>
  );
}

/**
 * Adaptador 1:1 del SelectField viejo (`components/layout/SelectField`):
 * mismas props (`value, options, onChange, disabled, placeholder, className,
 * ariaLabel`), así migrar es cambiar el import.
 */
export function SelectField(props: { value: string; options: SelectOption[]; onChange: (value: string) => void; disabled?: boolean; placeholder?: string; className?: string; ariaLabel?: string }) {
  return <Select {...props} />;
}

/* ── Combobox (texto libre + sugerencias; reemplaza <datalist>) ─────────── */

export type ComboboxProps = FieldProps & {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  /** Sugerencias: strings o {value,label,hint}. */
  options: Array<string | SelectOption>;
  /** Se llama al elegir una sugerencia (además de onChange con su value). */
  onSelect?: (option: SelectOption) => void;
  placeholder?: string;
  disabled?: boolean;
  ariaLabel?: string;
  maxVisible?: number;
  /** Mínimo de letras para sugerir (0 = sugiere al enfocar). */
  minChars?: number;
  prefix?: ReactNode;
  emptyText?: ReactNode;
  name?: string;
  autoFocus?: boolean;
  /** Enter sin sugerencia activa (p. ej. "Usar «máx» como persona nueva"). */
  onEnter?: (value: string) => void;
};

export function Combobox({ id: idProp, value, onChange, options, onSelect, placeholder, disabled, ariaLabel, maxVisible = 6, minChars = 0, prefix, emptyText, name, autoFocus, onEnter, label, hint, error, success, required, reserveHelp, className }: ComboboxProps) {
  const { id, helpId, describedBy, invalid } = useFieldIds(idProp, { hint, error, success });
  const listId = `${id}-list`;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const normalized = useMemo<SelectOption[]>(() => options.map(option => (typeof option === 'string' ? { value: option, label: option } : option)), [options]);
  const filtered = useMemo(() => {
    const q = fold(value);
    if (q.length < minChars) return [];
    if (!q) return normalized;
    // Primero los que empiezan con lo tipeado, después los que lo contienen.
    const starts = normalized.filter(option => fold(option.label).startsWith(q));
    const contains = normalized.filter(option => !fold(option.label).startsWith(q) && (fold(option.label).includes(q) || fold(option.hint || '').includes(q)));
    return [...starts, ...contains];
  }, [normalized, value, minChars]);

  const showList = open && (filtered.length > 0 || Boolean(emptyText && value));
  const pick = (option: SelectOption) => {
    onChange(option.value);
    onSelect?.(option);
    setOpen(false);
    setActive(-1);
    inputRef.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!open) { setOpen(true); setActive(firstEnabled(filtered)); return; }
      setActive(current => (current < 0 ? firstEnabled(filtered) : nextEnabled(filtered, current, 1)));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive(current => (current <= 0 ? -1 : nextEnabled(filtered, current, -1)));
    } else if (event.key === 'Enter') {
      if (showList && active >= 0 && filtered[active]) { event.preventDefault(); pick(filtered[active]); return; }
      if (onEnter) { event.preventDefault(); setOpen(false); onEnter(value); }
    } else if (event.key === 'Escape') {
      if (open) { event.preventDefault(); event.stopPropagation(); setOpen(false); setActive(-1); }
    } else if (event.key === 'Tab') {
      setOpen(false);
    }
  };

  const activeId = showList && active >= 0 && filtered[active] ? `${listId}-o${active}` : undefined;

  return (
    <FieldShell id={id} helpId={helpId} label={label} hint={hint} error={error} success={success} required={required} reserveHelp={reserveHelp} className={className}>
      <div
        className={cx('ui-select', 'ui-combobox', showList && 'is-open')}
        ref={rootRef}
        onBlur={event => { if (!rootRef.current?.contains(event.relatedTarget as Node | null)) { setOpen(false); setActive(-1); } }}
      >
        <div className={cx('ui-control', 'ui-input', invalid && 'is-error', !invalid && success && 'is-success', disabled && 'is-disabled')}>
          {prefix && <span className="ui-input-affix">{prefix}</span>}
          <input
            ref={inputRef}
            id={id}
            name={name}
            className="ui-input-el"
            type="text"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={showList}
            aria-controls={showList ? listId : undefined}
            aria-activedescendant={activeId}
            aria-label={ariaLabel}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            aria-required={required || undefined}
            autoComplete="off"
            autoFocus={autoFocus}
            disabled={disabled}
            placeholder={placeholder}
            value={value}
            onFocus={() => setOpen(true)}
            onChange={event => { onChange(event.target.value); setOpen(true); setActive(-1); }}
            onKeyDown={onKeyDown}
          />
        </div>
        {showList && (
          <div className="ui-select-panel">
            <Listbox id={listId} options={filtered} active={active} onActive={setActive} onPick={pick} maxVisible={maxVisible} emptyText={emptyText} label={typeof label === 'string' ? label : ariaLabel} />
          </div>
        )}
      </div>
    </FieldShell>
  );
}
