import { useEffect, useRef, useState } from 'react';

// Más largo que esto ya no es un KPI (es una fecha, un texto), y animar dígito
// por dígito deja de leerse como un número que cambió.
const MAX_ANIMATED = 8;

// Sólo cifras: dígitos con separadores de miles/decimales y un signo o símbolo
// opcional. Sin esto se partía cualquier string —"NFPT" salía N/F/P/T en el KPI
// de sede actual, un dígito por renglón.
const NUMERIC = /^[-+]?[\d.,\s]*\d[\d.,\s]*%?$/;

/**
 * Receta `number-pop-in` de transitions.dev.
 *
 * Los dígitos entran escalonados desde abajo con un blur corto. Sirve para un
 * propósito concreto: cuando un KPI cambia solo (auto-refresh), el movimiento
 * avisa que el dato es otro. Sin esto el número se reemplaza en silencio y
 * nadie se entera.
 *
 * Sólo anima cuando el valor efectivamente cambió — no en cada render.
 */
export function AnimatedNumber({ value }: { value: string | number }) {
  const text = String(value);
  const [run, setRun] = useState(0);
  const previous = useRef(text);

  useEffect(() => {
    if (previous.current === text) return;
    previous.current = text;
    // Remontar el grupo reinicia la animación de forma limpia; tocar la clase
    // pide un reflow forzado a mano y es más frágil.
    setRun(current => current + 1);
  }, [text]);

  if (text.length > MAX_ANIMATED || !NUMERIC.test(text)) return <>{text}</>;

  return (
    <span className="t-digit-group is-animating" key={run}>
      {text.split('').map((char, index) => (
        <span className="t-digit" key={index} data-stagger={Math.min(index, 3)}>{char}</span>
      ))}
    </span>
  );
}
