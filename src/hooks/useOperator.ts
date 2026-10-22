import { useEffect, useState } from 'react';
import type { Operator } from '../types';

export const OPERATOR_KEY = 'techasset_operator';

function read(): Operator {
  try { return (localStorage.getItem(OPERATOR_KEY) as Operator) || ''; } catch { return ''; }
}

/**
 * Nombre de quien opera (firma préstamos y cambios). Se recuerda en este
 * navegador mientras hay sesión; al cerrar sesión queda vacío y la clave se
 * borra (no queda el nombre en una compu compartida).
 */
export function useOperator() {
  const [operator, setOperator] = useState<Operator>(read);

  useEffect(() => {
    try {
      if (operator) localStorage.setItem(OPERATOR_KEY, operator);
      else localStorage.removeItem(OPERATOR_KEY);
    } catch { /* sin storage: queda en memoria */ }
  }, [operator]);

  return { operator, setOperator };
}
