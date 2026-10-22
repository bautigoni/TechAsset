/*
 * Reglas del formulario de préstamo, en un solo lugar (Préstamos las usa; el
 * Inicio puede usar las mismas): qué es obligatorio, cómo se nombran los
 * niveles y qué cursos se ofrecen para cada uno.
 *
 * Lo obligatorio es lo mismo que exige el server (validateLoanPayload en
 * server/routes/loans.routes.js): persona, rol y ubicación; con "Aula", nivel y
 * curso. "Otro" en ubicación o motivo pide el detalle (lo pide solo el front).
 */

export type LoanFieldKey = 'person' | 'role' | 'location' | 'locationDetail' | 'schoolLevel' | 'course' | 'reasonDetail';

export type LoanFieldValues = {
  person: string;
  role: string;
  location: string;
  locationDetail: string;
  schoolLevel: string;
  course: string;
  reasonDetail: string;
  requiresCourse: boolean;
  requiresLocationDetail: boolean;
  requiresReasonDetail: boolean;
};

/** Orden en que aparecen en el formulario (el primero con error recibe el foco). */
export const LOAN_FIELD_ORDER: LoanFieldKey[] = ['person', 'role', 'location', 'locationDetail', 'schoolLevel', 'course', 'reasonDetail'];

/** Nombre corto de cada dato, para el resumen "Faltan: persona, rol y ubicación". */
export const LOAN_FIELD_NAMES: Record<LoanFieldKey, string> = {
  person: 'persona',
  role: 'rol',
  location: 'ubicación',
  locationDetail: 'detalle de la ubicación',
  schoolLevel: 'nivel',
  course: 'grado o año',
  reasonDetail: 'detalle del motivo'
};

const MESSAGES: Record<LoanFieldKey, string> = {
  person: 'Escribí quién se lleva el equipo.',
  role: 'Elegí el rol de esa persona.',
  location: 'Elegí dónde va a estar el equipo.',
  locationDetail: 'Escribí cuál es la ubicación.',
  schoolLevel: 'Elegí el nivel: Primaria o Secundaria.',
  course: 'Elegí el grado o año y la división.',
  reasonDetail: 'Escribí cuál es el motivo.'
};

const blank = (value: string) => !String(value || '').trim();

/** TODOS los datos que faltan, en el orden del formulario (no de a uno). */
export function validateLoanFields(values: LoanFieldValues): Partial<Record<LoanFieldKey, string>> {
  const errors: Partial<Record<LoanFieldKey, string>> = {};
  if (blank(values.person)) errors.person = MESSAGES.person;
  if (blank(values.role)) errors.role = MESSAGES.role;
  if (blank(values.location)) errors.location = MESSAGES.location;
  if (values.requiresLocationDetail && blank(values.locationDetail)) errors.locationDetail = MESSAGES.locationDetail;
  if (values.requiresCourse && blank(values.schoolLevel)) errors.schoolLevel = MESSAGES.schoolLevel;
  if (values.requiresCourse && blank(values.course)) errors.course = MESSAGES.course;
  if (values.requiresReasonDetail && blank(values.reasonDetail)) errors.reasonDetail = MESSAGES.reasonDetail;
  return errors;
}

/** "Falta la persona." / "Faltan 3 datos: persona, rol y ubicación." */
export function missingSummary(errors: Partial<Record<LoanFieldKey, string>>) {
  const keys = LOAN_FIELD_ORDER.filter(key => errors[key]);
  if (!keys.length) return '';
  const names = keys.map(key => LOAN_FIELD_NAMES[key]);
  if (names.length === 1) return `Falta completar: ${names[0]}.`;
  const list = `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}`;
  return `Faltan ${names.length} datos: ${list}.`;
}

/* ── Niveles y cursos ─────────────────────────────────────────────────── */

/**
 * Los valores siguen siendo "EP" / "ES" (así se guardan y así los traen las
 * sugerencias y el historial); lo que cambia es cómo se leen.
 */
export const SCHOOL_LEVELS = [
  { value: 'EP', label: 'Primaria (EP)', gradeLabel: 'Grado y división', unit: 'grado' },
  { value: 'ES', label: 'Secundaria (ES)', gradeLabel: 'Año y división', unit: 'año' }
] as const;

export const SCHOOL_LEVEL_VALUES: string[] = SCHOOL_LEVELS.map(level => level.value);

export function schoolLevelLabel(value: string) {
  return SCHOOL_LEVELS.find(level => level.value === value)?.label || value;
}

/** Rótulo del grupo de cursos según el nivel elegido. */
export function gradeGroupLabel(level: string) {
  return SCHOOL_LEVELS.find(item => item.value === level)?.gradeLabel || 'Grado o año y división';
}

/** Ayuda breve de la nomenclatura 1N…6S (el número y la letra). */
export function gradeHelp(level: string) {
  const unit = SCHOOL_LEVELS.find(item => item.value === level)?.unit;
  return unit
    ? `El número es el ${unit} y la letra, la división (N, F o S).`
    : 'El número es el grado (Primaria) o el año (Secundaria) y la letra, la división (N, F o S).';
}

/**
 * Cursos para el nivel elegido. Los de la sede no dicen a qué nivel
 * pertenecen (las dos escuelas usan 1 a 6 con N, F y S), así que solo se
 * filtran los que lo dicen ("EP 4N", "1N ES"): esos van solo con su nivel y
 * se muestran sin la sigla. Sin nivel elegido, se ofrecen todos.
 */
export function gradesForLevel(grades: string[], level: string): Array<{ value: string; label: string }> {
  const tagged = /\b(EP|ES)\b/i;
  return grades
    .filter(grade => {
      const match = grade.match(tagged);
      return !match || !level || match[1].toUpperCase() === level;
    })
    .map(grade => ({ value: grade, label: level ? grade.replace(tagged, '').replace(/\s*·\s*$|^\s*·\s*/g, '').trim() || grade : grade }));
}

/** Si el curso elegido lleva el nivel en el nombre, el nivel sale solo. */
export function levelFromGrade(grade: string) {
  const match = grade.match(/\b(EP|ES)\b/i);
  return match ? match[1].toUpperCase() : '';
}
