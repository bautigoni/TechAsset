import type { LoanSuggestion } from '../../services/loansApi';

/*
 * Opciones del préstamo (rol, ubicación, motivo, grados) desde la
 * configuración de la sede, con los mismos defaults y la misma normalización
 * que el formulario de Préstamos (LoanForm). Las settings ya las tiene App:
 * no se vuelven a pedir.
 */

export type PlaceOption = { label: string; requiresDetail?: boolean; requiresCourse?: boolean };

const DEFAULT_ROLES = ['DOE', 'Alumno', 'Maestra', 'Profesor', 'Directivo', 'Preceptor', 'Otro'];
const DEFAULT_LOCATIONS: PlaceOption[] = [{ label: 'Aula', requiresCourse: true }, { label: 'DOE' }, { label: 'Planificación móvil' }, { label: 'Otro', requiresDetail: true }];
const DEFAULT_MOTIVES: PlaceOption[] = [{ label: 'Planificación' }, { label: 'Préstamo autorizado' }, { label: 'Otro', requiresDetail: true }];
const DEFAULT_GRADES = ['1N', '1F', '1S', '2N', '2F', '2S', '3N', '3F', '3S', '4N', '4F', '4S', '5N', '5F', '5S', '6N', '6F', '6S'];
export const SCHOOL_LEVELS = ['EP', 'ES'];

function stringOptions(value: unknown, fallback: string[]) {
  if (!Array.isArray(value)) return fallback;
  const items = value
    .map(item => (typeof item === 'string' ? { label: item, activo: true } : item as { label?: string; nombre?: string; activo?: boolean }))
    .filter(item => item && item.activo !== false)
    .map(item => String(item.label || item.nombre || '').trim())
    .filter(Boolean);
  return items.length ? items : fallback;
}

function placeOptions(value: unknown, fallback: PlaceOption[]): PlaceOption[] {
  if (!Array.isArray(value) || !value.length) return fallback;
  const items = value
    .map(item => (typeof item === 'string' ? { label: item } : item as PlaceOption & { nombre?: string; activo?: boolean }))
    .filter(item => item && (item as { activo?: boolean }).activo !== false)
    .map(item => ({ ...item, label: String(item.label || (item as { nombre?: string }).nombre || '').trim() }))
    .filter(item => item.label);
  return items.length ? items : fallback;
}

export function loanOptions(settings: Record<string, unknown> | null) {
  const source = settings || {};
  const configuredGrades = stringOptions(source['loan.gradeOptions'], []);
  const seen = new Set<string>();
  const grades = [...DEFAULT_GRADES, ...configuredGrades].filter(item => {
    const key = item.trim().toLowerCase();
    if (!key || seen.has(key) || SCHOOL_LEVELS.some(level => level.toLowerCase() === key)) return false;
    seen.add(key);
    return true;
  });
  return {
    roles: stringOptions(source['loan.roles'], DEFAULT_ROLES),
    locations: placeOptions(source['loan.locations'], DEFAULT_LOCATIONS),
    motives: placeOptions(source['loan.motives'], DEFAULT_MOTIVES),
    grades
  };
}

export type LoanOptions = ReturnType<typeof loanOptions>;

export type LendDraft = {
  person: string;
  role: string;
  location: string;
  locationDetail: string;
  schoolLevel: string;
  course: string;
  reason: string;
  reasonDetail: string;
};

export const EMPTY_DRAFT: LendDraft = { person: '', role: '', location: '', locationDetail: '', schoolLevel: '', course: '', reason: '', reasonDetail: '' };

/** Elegir una persona del historial completa rol, ubicación, motivo y curso más usados. */
export function applySuggestion(draft: LendDraft, suggestion: LoanSuggestion, options: LoanOptions): LendDraft {
  const next = { ...draft, person: suggestion.persona };
  if (suggestion.rol && options.roles.includes(suggestion.rol)) next.role = suggestion.rol;
  if (suggestion.ubicacion && options.locations.some(item => item.label === suggestion.ubicacion)) next.location = suggestion.ubicacion;
  if (suggestion.motivo && options.motives.some(item => item.label === suggestion.motivo)) next.reason = suggestion.motivo;
  if (suggestion.curso) {
    const parts = suggestion.curso.split('·').map(part => part.trim()).filter(Boolean);
    const level = parts.find(part => SCHOOL_LEVELS.includes(part));
    const grade = parts.find(part => options.grades.includes(part));
    if (level) next.schoolLevel = level;
    if (grade) next.course = grade;
  }
  return next;
}

/** Error del préstamo: el primer campo (foco), el mensaje y TODOS los campos que faltan (se marcan juntos). */
export type LendError = [keyof LendDraft, string, Array<keyof LendDraft>?];

/**
 * Mismas validaciones que el formulario de Préstamos, pero marca todo lo que
 * falta de una vez: antes avisaba de a un campo y prestar un equipo llevaba
 * tres o cinco intentos (QA ronda 1, impaciente P2 en el Inicio).
 */
export function validateDraft(draft: LendDraft, options: LoanOptions): LendError | null {
  const location = options.locations.find(item => item.label === draft.location);
  const reason = options.motives.find(item => item.label === draft.reason);
  const missing: Array<[keyof LendDraft, string]> = [];
  if (!draft.person.trim()) missing.push(['person', 'la persona']);
  if (!draft.role.trim()) missing.push(['role', 'el rol']);
  if (!draft.location.trim()) missing.push(['location', 'la ubicación']);
  if (location?.requiresCourse && !draft.schoolLevel) missing.push(['schoolLevel', 'el nivel (primaria EP o secundaria ES)']);
  if (location?.requiresCourse && !draft.course) missing.push(['course', 'el curso']);
  if (location?.requiresDetail && !draft.locationDetail.trim()) missing.push(['locationDetail', 'qué ubicación']);
  if (reason?.requiresDetail && !draft.reasonDetail.trim()) missing.push(['reasonDetail', 'qué motivo']);
  if (!missing.length) return null;
  const names = missing.map(([, name]) => name);
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}`;
  return [missing[0][0], `Falta ${list}.`, missing.map(([field]) => field)];
}

/** Payload de /api/loans/lend y /lend-batch (mismos nombres que LoanForm). */
export function draftPayload(draft: LendDraft) {
  return {
    person: draft.person.trim(),
    role: draft.role,
    location: draft.location,
    locationDetail: draft.locationDetail.trim(),
    schoolLevel: draft.schoolLevel,
    course: draft.course,
    reason: draft.reason,
    reasonDetail: draft.reasonDetail.trim()
  };
}
