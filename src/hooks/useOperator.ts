import { useEffect, useState } from 'react';
import type { Operator } from '../types';

const KEY = 'techasset_operator';

export function useOperator() {
  const [operator, setOperator] = useState<Operator>(() => (localStorage.getItem(KEY) as Operator) || '');

  useEffect(() => {
    localStorage.setItem(KEY, operator);
  }, [operator]);

  return { operator, setOperator };
}
