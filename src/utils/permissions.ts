import type { Operator } from '../types';

export const OPERATORS: Operator[] = ['Equi', 'Bauti', 'Lau', 'Gus', 'Mastro', 'Fede'];

export function canEdit(operator: Operator, consultationMode: boolean): boolean {
  if (!consultationMode) return true;
  return operator === 'Lau';
}

export function canDeleteTask(operator: Operator): boolean {
  return operator === 'Bauti' || operator === 'Equi' || operator === 'Lau';
}

export function canResolveTask(operator: Operator, consultationMode: boolean): boolean {
  return !consultationMode && (operator === 'Bauti' || operator === 'Equi');
}
