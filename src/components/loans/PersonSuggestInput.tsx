import { useEffect, useId, useRef, useState, type KeyboardEvent, type Ref } from 'react';
import { Input } from '../../ui/Field';
import { cx } from '../../ui/util';
import { getPhotoPassSuggestions, type PhotoPassSuggestion } from '../../services/photoPassesApi';

export type SuggestRow = { name: string; hint: string; times: string };

/**
 * Campo de persona con sugerencias del historial. La lista se abre EN LÍNEA
 * debajo del campo (empuja lo de abajo, nunca flota): ≥2 letras, debounce de
 * 220 ms; flechas para moverse, Enter elige la marcada (la primera si no
 * tocaste nada), Escape la cierra. Si no hay lista abierta, Enter llama a
 * `onEnter` (en Préstamos: prestar).
 *
 * Reemplaza al `<datalist>` nativo, que listaba todo lo que alguna vez se
 * escribió tal cual —"mile", "Mile", "Mile STAFF"— y en orden alfabético. Acá
 * el backend agrupa por nombre normalizado y ordena por uso.
 */
export function SuggestInput<T>({ id, value, onChange, fetcher, row, itemKey, onPick, onEnter, placeholder, autoFocus, disabled, inputRef, listLabel, footer, ariaLabel }: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  fetcher: (q: string) => Promise<T[]>;
  row: (item: T) => SuggestRow;
  itemKey: (item: T) => string;
  onPick: (item: T) => void;
  onEnter?: () => void;
  placeholder?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  inputRef?: Ref<HTMLInputElement>;
  listLabel: string;
  footer?: string;
  ariaLabel?: string;
}) {
  const [items, setItems] = useState<T[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const picked = useRef('');
  const listId = useId();
  const fetchRef = useRef(fetcher);
  fetchRef.current = fetcher;

  useEffect(() => {
    const q = value.trim();
    if (q.length < 2 || q === picked.current) { setItems([]); return; }
    let alive = true;
    const timer = window.setTimeout(() => {
      fetchRef.current(q)
        .then(list => { if (alive) { setItems(list); setActive(0); } })
        .catch(() => { if (alive) setItems([]); });
    }, 220);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [value]);

  const visible = open && items.length > 0;
  const pick = (item: T) => {
    picked.current = row(item).name.trim();
    onPick(item);
    setItems([]);
    setOpen(false);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (visible && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault();
      setActive(current => (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length);
      return;
    }
    if (visible && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); return; }
    if (event.key !== 'Enter') return;
    event.preventDefault();
    if (visible) pick(items[Math.min(active, items.length - 1)]);
    else onEnter?.();
  };

  return (
    <div className="lo-suggest">
      <Input
        id={id}
        ref={inputRef}
        value={value}
        autoFocus={autoFocus}
        disabled={disabled}
        autoComplete="off"
        spellCheck={false}
        placeholder={placeholder}
        aria-label={ariaLabel}
        role="combobox"
        aria-expanded={visible}
        aria-controls={visible ? listId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={visible ? `${listId}-${active}` : undefined}
        onValueChange={next => { picked.current = ''; onChange(next); setOpen(true); }}
        onFocus={() => setOpen(true)}
        // El blur se demora: sin eso el clic en una sugerencia cierra la lista antes de registrarse.
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        onKeyDown={onKeyDown}
      />
      {visible && (
        <div className="lo-suggest-list ui-enter" id={listId} role="listbox" aria-label={listLabel}>
          {items.map((item, index) => {
            const data = row(item);
            return (
              <button
                key={itemKey(item)}
                id={`${listId}-${index}`}
                type="button"
                role="option"
                tabIndex={-1}
                aria-selected={index === active}
                className={cx('lo-suggest-item', index === active && 'is-active')}
                onMouseDown={event => { event.preventDefault(); pick(item); }}
                onPointerMove={() => setActive(index)}
              >
                <span className="lo-suggest-main">
                  <span className="lo-suggest-name">{data.name}</span>
                  <span className="lo-suggest-hint">{data.hint}</span>
                </span>
                <span className="lo-suggest-times g-num">{data.times}</span>
              </button>
            );
          })}
          {footer && <div className="lo-suggest-foot">{footer}</div>}
        </div>
      )}
    </div>
  );
}

/** Alumno o docente de los cartelitos (sugerencias de /api/photo-passes/suggest). */
export function PersonSuggestInput({ id, value, onChange, onPick, field, placeholder, autoFocus, onEnter, inputRef }: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  /** Se dispara al elegir una de la lista: sirve para completar curso y docente. */
  onPick?: (suggestion: PhotoPassSuggestion) => void;
  field: 'alumno' | 'docente';
  placeholder?: string;
  autoFocus?: boolean;
  onEnter?: () => void;
  inputRef?: Ref<HTMLInputElement>;
}) {
  return (
    <SuggestInput<PhotoPassSuggestion>
      id={id}
      inputRef={inputRef}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      autoFocus={autoFocus}
      onEnter={onEnter}
      listLabel={field === 'alumno' ? 'Alumnos que ya pidieron cartelitos' : 'Docentes'}
      fetcher={q => getPhotoPassSuggestions(q, field).then(response => response.items || [])}
      itemKey={item => item.nombre}
      row={item => ({
        name: item.nombre,
        hint: [item.curso, field === 'alumno' && item.docente ? `con ${item.docente}` : ''].filter(Boolean).join(' · ') || 'sin datos previos',
        times: `${item.veces}×`
      })}
      onPick={item => { onChange(item.nombre); onPick?.(item); }}
    />
  );
}
