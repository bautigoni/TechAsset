import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';

/* ── Borradores en memoria ────────────────────────────────────────────────
   Lo que se estaba cargando en un formulario en línea sobrevive a salir de la
   pantalla por el menú (la pantalla se desmonta) y vuelve al entrar: REGLAS-UX
   "nunca perder datos por una navegación evitable". Vive en memoria (no en
   localStorage): un recargo de la página ya lo avisa el navegador
   (`beforeunload`). Las claves llevan la sede para que NFPT y NFND no crucen.
   Lo usan Configuración, Caja chica, Accesos rápidos y Herramientas. */

const drafts = new Map<string, unknown>();

/** Borrador que quedó de una visita anterior (usar en el inicializador del estado). */
export function peekDraft<T>(key: string): T | null {
  return drafts.has(key) ? drafts.get(key) as T : null;
}

export function dropDraft(key: string) {
  drafts.delete(key);
}

/**
 * Al desmontar (cambiar de sección, ir a otra pantalla), si hay cambios sin
 * guardar quedan en memoria; si no, se borra lo que hubiera.
 */
export function useKeepDraft<T>(key: string, value: T, dirty: boolean | (() => boolean)) {
  const valueRef = useRef(value);
  const dirtyRef = useRef(dirty);
  valueRef.current = value;
  dirtyRef.current = dirty;
  useEffect(() => () => {
    if (!key) return;
    // Una función se evalúa al salir (p. ej. "salvo que se haya cancelado recién").
    const keep = typeof dirtyRef.current === 'function' ? dirtyRef.current() : dirtyRef.current;
    if (keep) drafts.set(key, valueRef.current);
    else drafts.delete(key);
  }, [key]);
}

/**
 * `useState` que arranca desde el borrador guardado (si lo hay) y lo guarda al
 * salir mientras `isDirty(valor)`. Devuelve también si arrancó de un borrador.
 */
export function useDraftState<T>(key: string, initial: T | (() => T), isDirty: (value: T) => boolean): [T, Dispatch<SetStateAction<T>>, boolean] {
  const [restored] = useState(() => drafts.has(key));
  const [value, setValue] = useState<T>(() => {
    const saved = peekDraft<T>(key);
    if (saved !== null) return saved;
    return typeof initial === 'function' ? (initial as () => T)() : initial;
  });
  useKeepDraft(key, value, isDirty(value));
  return [value, setValue, restored];
}
