import { useEffect, useState } from 'react';
import { getPhotoPassSuggestions, type PhotoPassSuggestion } from '../../services/photoPassesApi';

/**
 * Campo de persona con sugerencias, igual que el de préstamo de equipos.
 *
 * Reemplaza al `<datalist>` nativo, que listaba todo lo que alguna vez se
 * escribió tal cual se escribió —"mile", "Mile", "Mile STAFF", "mili", "Mili
 * doe"— y encima en orden alfabético, así que el nombre que más usás quedaba
 * enterrado. Acá el backend ya agrupa por nombre normalizado y ordena por uso.
 */
export function PersonSuggestInput({ value, onChange, onPick, field, placeholder, autoFocus, required, id }: {
  value: string;
  onChange: (value: string) => void;
  /** Se dispara al elegir una de la lista: sirve para completar curso y docente. */
  onPick?: (suggestion: PhotoPassSuggestion) => void;
  field: 'alumno' | 'docente';
  placeholder?: string;
  autoFocus?: boolean;
  required?: boolean;
  id?: string;
}) {
  const [items, setItems] = useState<PhotoPassSuggestion[]>([]);
  const [abierto, setAbierto] = useState(false);

  useEffect(() => {
    const q = value.trim();
    if (q.length < 2) { setItems([]); return; }
    const timer = window.setTimeout(() => {
      getPhotoPassSuggestions(q, field)
        .then(response => setItems(response.items || []))
        .catch(() => setItems([]));
    }, 220);
    return () => window.clearTimeout(timer);
  }, [value, field]);

  return (
    <span className="loan-person-field">
      <input
        id={id}
        className="input"
        value={value}
        required={required}
        autoFocus={autoFocus}
        autoComplete="off"
        placeholder={placeholder}
        onChange={event => { onChange(event.target.value); setAbierto(true); }}
        onFocus={() => setAbierto(true)}
        // El blur se demora: sin eso el click en una sugerencia cierra la lista
        // antes de que llegue a registrarse.
        onBlur={() => window.setTimeout(() => setAbierto(false), 150)}
      />
      {abierto && items.length > 0 && (
        <ul className="loan-suggest">
          {items.map(item => (
            <li key={item.nombre}>
              <button
                type="button"
                onMouseDown={event => {
                  event.preventDefault();
                  onChange(item.nombre);
                  onPick?.(item);
                  setAbierto(false);
                }}
              >
                <strong>{item.nombre}</strong>
                <span>
                  {[item.curso, field === 'alumno' ? item.docente : ''].filter(Boolean).join(' · ') || 'sin datos previos'}
                  {' · '}{item.veces}×
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </span>
  );
}
