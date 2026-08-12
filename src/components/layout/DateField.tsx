import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

// Calendario propio. El popup de `<input type="date">` lo dibuja el browser y
// no se puede estilar: aparecía la caja blanca de Chrome, con su tipografía y
// su celeste, en el medio de la app oscura.
const DIAS = ['LU', 'MA', 'MI', 'JU', 'VI', 'SA', 'DO'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** ISO `yyyy-mm-dd` ⇄ fecha local. Sin `new Date(iso)`: eso parsea en UTC y en
 *  Argentina devuelve el día anterior. */
function fromIso(iso: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || '').trim());
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

function toIso(date: Date) {
  const mes = String(date.getMonth() + 1).padStart(2, '0');
  const dia = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${mes}-${dia}`;
}

function display(iso: string) {
  const date = fromIso(iso);
  if (!date) return '';
  return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;
}

// Lunes primero, como el calendario del sistema en es-AR.
function buildGrid(year: number, month: number) {
  const primero = new Date(year, month, 1);
  const offset = (primero.getDay() + 6) % 7;
  const inicio = new Date(year, month, 1 - offset);
  return Array.from({ length: 42 }, (_, index) => new Date(inicio.getFullYear(), inicio.getMonth(), inicio.getDate() + index));
}

export function DateField({ value, onChange, disabled, placeholder = 'dd/mm/aaaa', ariaLabel, className = '' }: {
  value: string;
  onChange: (iso: string) => void;
  disabled?: boolean;
  placeholder?: string;
  ariaLabel?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const hoy = useMemo(() => new Date(), []);
  const seleccionada = fromIso(value);
  const [cursor, setCursor] = useState(() => seleccionada || hoy);
  // El calendario tiene ancho fijo: si el campo está pegado al borde derecho
  // (pasa en la ficha del equipo) se ancla del otro lado, para no desbordar el
  // modal y meterle scroll horizontal.
  const [alRas, setAlRas] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    setCursor(fromIso(value) || new Date());
    const rect = rootRef.current?.getBoundingClientRect();
    setAlRas(Boolean(rect && rect.left + 268 > window.innerWidth - 12));
    const onPointer = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      close();
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open, value, close]);

  const grid = useMemo(() => buildGrid(cursor.getFullYear(), cursor.getMonth()), [cursor]);
  const isoHoy = toIso(hoy);

  const pick = (date: Date) => {
    // Se guarda al elegir el día, no al perder el foco: un popover no tiene un
    // blur confiable del que colgarse.
    onChange(toIso(date));
    close();
  };

  const moverMes = (delta: number) => setCursor(current => new Date(current.getFullYear(), current.getMonth() + delta, 1));

  return (
    <div className={`field-date ${open ? 'is-open' : ''} ${className}`.trim()} ref={rootRef}>
      <button
        type="button"
        className="field-select-trigger"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen(current => !current)}
      >
        <span className={value ? '' : 'is-placeholder'}>{display(value) || placeholder}</span>
        <i className="field-date-icon" aria-hidden="true" />
      </button>

      {open && (
        <div className={`field-date-pop ${alRas ? 'is-right' : ''}`.trim()} role="dialog" aria-label="Elegir fecha">
          <div className="field-date-head">
            <strong>{MESES[cursor.getMonth()]} de {cursor.getFullYear()}</strong>
            <span>
              <button type="button" onClick={() => moverMes(-1)} aria-label="Mes anterior">‹</button>
              <button type="button" onClick={() => moverMes(1)} aria-label="Mes siguiente">›</button>
            </span>
          </div>

          <div className="field-date-week">
            {DIAS.map(dia => <span key={dia}>{dia}</span>)}
          </div>

          <div className="field-date-grid">
            {grid.map(date => {
              const iso = toIso(date);
              const fuera = date.getMonth() !== cursor.getMonth();
              return (
                <button
                  key={iso}
                  type="button"
                  className={`${fuera ? 'is-out' : ''} ${iso === value ? 'is-selected' : ''} ${iso === isoHoy ? 'is-today' : ''}`.trim()}
                  onClick={() => pick(date)}
                >
                  {date.getDate()}
                </button>
              );
            })}
          </div>

          <div className="field-date-foot">
            <button type="button" onClick={() => { onChange(''); close(); }}>Borrar</button>
            <button type="button" onClick={() => pick(new Date())}>Hoy</button>
          </div>
        </div>
      )}
    </div>
  );
}
