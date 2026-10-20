import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type Ref } from 'react';
import { Input } from '../../ui/Field';
import { cx } from '../../ui/util';
import { Collapse } from '../../ui/Collapse';
import { getPhotoPassSuggestions, type PhotoPassSuggestion } from '../../services/photoPassesApi';
import { useHeldList } from './ChipPanelKit';

export type SuggestRow = { name: string; hint: string; times: string };

const EMPTY: never[] = [];

/**
 * Campo de persona con sugerencias del historial. La lista se abre EN LÍNEA
 * debajo del campo (empuja lo de abajo, nunca flota): ≥2 letras, debounce de
 * 220 ms; flechas para moverse, Enter elige la marcada (la primera si no
 * tocaste nada), Escape la cierra. Si no hay lista abierta, Enter llama a
 * `onEnter` (en Préstamos: prestar).
 *
 * Con `local` (un directorio ya bajado, ver services/peopleDirectory.ts) filtra
 * en memoria en cada tecla, sin debounce ni red: la lista sale en el mismo
 * frame. Si `local` devuelve null (directorio todavía sin llegar) cae al
 * `fetcher` con debounce; una respuesta vieja nunca pisa a una nueva.
 *
 * Reemplaza al `<datalist>` nativo, que listaba todo lo que alguna vez se
 * escribió tal cual —"mile", "Mile", "Mile STAFF"— y en orden alfabético. Acá
 * el backend agrupa por nombre normalizado y ordena por uso.
 */
export function SuggestInput<T>({ id, value, onChange, fetcher, local, onOpen, row, itemKey, onPick, onEnter, placeholder, autoFocus, disabled, inputRef, listLabel, footer, ariaLabel }: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  fetcher: (q: string) => Promise<T[]>;
  /** Búsqueda local inmediata; null = todavía no se puede (usa fetcher). */
  local?: ((q: string) => T[] | null) | null;
  /** Al enfocar el campo (para revalidar el directorio local). */
  onOpen?: () => void;
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
  const [fetched, setFetched] = useState<T[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const picked = useRef('');
  const listId = useId();
  const fetchRef = useRef(fetcher);
  fetchRef.current = fetcher;

  const q = value.trim();
  const wanted = q.length >= 2 && q !== picked.current;
  // Resultado local: se calcula en el render de la tecla (filtrar ~400 nombres es < 1 ms).
  const localItems = useMemo(() => (wanted && local ? local(q) : null), [wanted, local, q]);
  const usesLocal = localItems !== null;
  const items: T[] = !wanted ? EMPTY : localItems ?? fetched;

  useEffect(() => {
    if (!wanted || usesLocal) { setFetched(EMPTY); return; }
    let alive = true;
    const timer = window.setTimeout(() => {
      fetchRef.current(q)
        .then(list => { if (alive) { setFetched(list); setActive(0); } })
        .catch(() => { if (alive) setFetched(EMPTY); });
    }, 220);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [q, wanted, usesLocal]);

  const visible = open && items.length > 0;
  // Mientras la lista se pliega se sigue viendo lo último (no se vacía de golpe).
  const shownItems = useRef<T[]>([]);
  if (items.length) shownItems.current = items;
  const listItems = items.length ? items : shownItems.current;
  const held = useHeldList(listItems, itemKey);
  const pick = (item: T) => {
    picked.current = row(item).name.trim();
    onPick(item);
    setFetched(EMPTY);
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
        onValueChange={next => { picked.current = ''; onChange(next); setOpen(true); setActive(0); }}
        onFocus={() => { setOpen(true); onOpen?.(); }}
        // El blur se demora: sin eso el clic en una sugerencia cierra la lista antes de registrarse.
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        onKeyDown={onKeyDown}
      />
      <Collapse open={visible} id={listId} role="listbox" aria-label={listLabel} className="lo-suggest-list" reveal={false}>
          {/* Al tipear, las sugerencias que salen o entran se pliegan: la lista no salta de alto. */}
          {held.rows.map(({ key, item, open: rowOpen, appear, index }) => {
            const data = row(item);
            return (
              <Collapse key={key} open={rowOpen} appear={appear} unmountOnClose reveal={false} anchor={false} outerClassName="lo-suggest-fold" onSettled={value => { if (!value) held.release(key); }}>
                <button
                  id={rowOpen ? `${listId}-${index}` : undefined}
                  type="button"
                  role="option"
                  tabIndex={-1}
                  aria-selected={rowOpen && index === active}
                  className={cx('lo-suggest-item', rowOpen && index === active && 'is-active')}
                  onMouseDown={event => { event.preventDefault(); if (rowOpen) pick(item); }}
                  onPointerMove={() => { if (rowOpen) setActive(index); }}
                >
                  <span className="lo-suggest-main">
                    <span className="lo-suggest-name">{data.name}</span>
                    <span className="lo-suggest-hint">{data.hint}</span>
                  </span>
                  <span className="lo-suggest-times g-num">{data.times}</span>
                </button>
              </Collapse>
            );
          })}
          {footer && <div className="lo-suggest-foot">{footer}</div>}
      </Collapse>
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
