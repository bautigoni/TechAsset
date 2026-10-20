import { useEffect, useState } from 'react';
import { apiGet, getApiGeneration } from './apiClient';
import { getActiveSiteCode } from './activeSite';
import type { LoanSuggestion } from './loansApi';

/**
 * Directorio de personas que pidieron equipos, para la búsqueda rápida
 * (DIRECTIVA §6). Antes cada tecla esperaba 220 ms y pedía /api/loans/suggest,
 * que leía todo loan_events: ~330 ms hasta ver la primera sugerencia. Ahora se
 * baja el directorio de la sede una vez (GET /api/loans/people, ~10 KB gzip con
 * 400 personas; 304 si no cambió) y cada tecla filtra en memoria: la lista
 * aparece en el mismo frame, sin red ni respuestas viejas que pisen a las nuevas.
 *
 * Se revalida en segundo plano si pasó más de 30 s o si hubo una escritura
 * propia (un préstamo puede sumar una persona nueva). Mientras se revalida se
 * sigue usando el que había.
 */
export type PersonEntry = LoanSuggestion & { key: string };

const FRESH_MS = 30 * 1000;
let entry: { site: string; at: number; generation: number; people: PersonEntry[] } | null = null;
let inflight: { site: string; promise: Promise<PersonEntry[]> } | null = null;
const listeners = new Set<() => void>();

export function normalizePerson(value: string) {
  return String(value || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ');
}

function current(site = getActiveSiteCode()) {
  return entry && entry.site === site ? entry.people : null;
}

export function loadPeopleDirectory(): Promise<PersonEntry[]> {
  const site = getActiveSiteCode();
  const fresh = entry && entry.site === site && Date.now() - entry.at < FRESH_MS && entry.generation === getApiGeneration();
  if (fresh) return Promise.resolve(entry!.people);
  if (inflight && inflight.site === site) return inflight.promise;
  const generation = getApiGeneration();
  const promise = apiGet<{ ok: true; people: PersonEntry[] }>('/api/loans/people', { fresh: true })
    .then(response => {
      const people = Array.isArray(response.people) ? response.people : [];
      if (getActiveSiteCode() === site) {
        entry = { site, at: Date.now(), generation, people };
        listeners.forEach(listener => listener());
      }
      return people;
    })
    .finally(() => { if (inflight?.promise === promise) inflight = null; });
  inflight = { site, promise };
  return promise;
}

/** Directorio de la sede activa (null hasta que llega la primera vez). Lo pide/revalida al montar. */
export function usePeopleDirectory() {
  const [people, setPeople] = useState<PersonEntry[] | null>(() => current());
  useEffect(() => {
    const sync = () => setPeople(current());
    listeners.add(sync);
    void loadPeopleDirectory().catch(() => undefined);
    return () => { listeners.delete(sync); };
  }, []);
  return people;
}

/**
 * Misma regla que searchLoanPeople en server/services/loanPeople.service.js (si
 * cambia una, cambiar la otra): sin distinguir mayúsculas ni tildes; cada
 * palabra tipeada tiene que estar en el nombre ("gonz mar" → "María González");
 * primero quien empieza con lo tipeado, después quien tiene una palabra que
 * empieza así; dentro de cada grupo, por uso y fecha (el orden del directorio).
 */
export function searchPeople(people: PersonEntry[], query: string, limit = 8): PersonEntry[] {
  const q = normalizePerson(query);
  if (!q) return people.slice(0, limit);
  const tokens = q.split(' ');
  const ranks: PersonEntry[][] = [[], [], []];
  for (const person of people) {
    if (!tokens.every(token => person.key.includes(token))) continue;
    const rank = person.key.startsWith(q) ? 0 : person.key.split(' ').some(word => word.startsWith(tokens[0])) ? 1 : 2;
    ranks[rank].push(person);
    if (rank === 0 && ranks[0].length >= limit) break;
  }
  return ranks.flat().slice(0, limit);
}
