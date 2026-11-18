import { useEffect, useState } from 'react';
import { getPhotoPassSuggestions, type PhotoPassSuggestion } from '../../services/photoPassesApi';
import { SuggestField } from './SuggestField';

/**
 * Campo de persona con sugerencias, igual que el de préstamo de equipos.
 *
 * Reemplaza al `<datalist>` nativo, que listaba todo lo que alguna vez se
 * escribió tal cual se escribió —"mile", "Mile", "Mile STAFF", "mili", "Mili
 * doe"— y encima en orden alfabético, así que el nombre que más usás quedaba
 * enterrado. Acá el backend ya agrupa por nombre normalizado y ordena por uso,
 * y suma la lista de docentes y alumnos de la sede aunque nunca hayan pedido nada.
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

  useEffect(() => {
    const q = value.trim();
    if (q.length < 2) { setItems([]); return; }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      getPhotoPassSuggestions(q, field)
        .then(response => { if (!cancelled) setItems(response.items || []); })
        .catch(() => { if (!cancelled) setItems([]); });
    }, 180);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [value, field]);

  const options = items.map(item => ({
    key: item.nombre,
    title: item.nombre,
    tag: item.veces ? undefined : 'Lista',
    detail: [
      [item.curso, field === 'alumno' ? item.docente : ''].filter(Boolean).join(' · ') || (item.veces ? 'sin datos previos' : ''),
      item.veces ? `${item.veces}×` : ''
    ].filter(Boolean).join(' · ')
  }));

  return (
    <SuggestField
      id={id}
      value={value}
      onChange={onChange}
      options={options}
      placeholder={placeholder}
      autoFocus={autoFocus}
      required={required}
      onPick={index => {
        const item = items[index];
        if (!item) return;
        onChange(item.nombre);
        onPick?.(item);
      }}
    />
  );
}
