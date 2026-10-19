import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

let canvas: CanvasRenderingContext2D | null = null;

function textWidth(text: string, input: HTMLInputElement) {
  canvas ||= document.createElement('canvas').getContext('2d');
  if (!canvas) return 0;
  const style = getComputedStyle(input);
  canvas.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  return canvas.measureText(text).width;
}

/**
 * Placeholder que nunca se ve cortado: de las opciones (de la más larga a la
 * más corta) usa la primera que entra en el ancho real del campo, y se vuelve
 * a elegir cuando el campo cambia de ancho. Devuelve el ref para el <input> y
 * el texto a usar. Sirve también para un campo que se monta después (dentro
 * de un plegable): se engancha apenas aparece.
 *
 *   const [ref, placeholder] = useFitPlaceholder(['Escaneá o escribí — touch 34, D1436', 'Escaneá o escribí…']);
 */
export function useFitPlaceholder(options: string[], external?: RefObject<HTMLInputElement | null>): [RefObject<HTMLInputElement | null>, string] {
  const own = useRef<HTMLInputElement | null>(null);
  const ref = external || own;
  const [index, setIndex] = useState(0);
  const key = options.join('\u0000');
  const watched = useRef<{ el: HTMLInputElement | null; key: string; stop: () => void }>({ el: null, key: '', stop: () => {} });

  // Sin dependencias: barato (compara el elemento y las opciones) y así toma
  // un <input> que aparece en un render posterior.
  useLayoutEffect(() => {
    const input = ref.current;
    if (input === watched.current.el && key === watched.current.key) return;
    watched.current.stop();
    watched.current = { el: input, key, stop: () => {} };
    if (!input || typeof ResizeObserver === 'undefined') return;
    const pick = () => {
      if (!input.isConnected) return;
      const style = getComputedStyle(input);
      const room = input.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - 2;
      if (room <= 0) return;
      const fit = options.findIndex(option => textWidth(option, input) <= room);
      setIndex(fit === -1 ? options.length - 1 : fit);
    };
    pick();
    // Con la fuente web recién cargada el ancho del texto cambia.
    void document.fonts?.ready.then(pick);
    const observer = new ResizeObserver(pick);
    observer.observe(input);
    watched.current.stop = () => observer.disconnect();
  });
  useEffect(() => () => watched.current.stop(), []);
  return [ref, options[Math.min(index, options.length - 1)] || ''];
}
