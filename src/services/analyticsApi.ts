import { apiGet } from './apiClient';

export interface AnalyticsRow {
  label: string;
  value: number;
}

export interface LoanEvent {
  id: number;
  tipo: 'prestamo' | 'devolucion';
  etiqueta: string;
  alias: string;
  filtro: string;
  persona: string;
  rol: string;
  ubicacion: string;
  ubicacionDetalle: string;
  curso: string;
  motivo: string;
  motivoDetalle: string;
  comentarios: string;
  operador: string;
  origen: string;
  loanSessionId?: string;
  accessories: string[];
  expectedAccessories: string[];
  timestamp: string;
}

export interface DeviceRankRow {
  etiqueta: string;
  alias: string;
  tipo: string;
  value: number;
  /** Horas promedio afuera de los préstamos del período ya devueltos (null si ninguno volvió). */
  avgHours: number | null;
}

export interface LoanDurations {
  count: number;
  stillOut: number;
  median: number;
  q1: number;
  q3: number;
  max: number;
  over12: number;
  buckets: number[];
  edges: number[];
  sampled: boolean;
  hours: number[];
}

export interface Evolution {
  granularity: 'day' | 'week' | 'month';
  prevAvailable: boolean;
  points: Array<{ key: string; value: number; prev: number | null }>;
}

export interface AnalyticsSummary {
  totalPrestamos: number;
  totalDevoluciones: number;
  prestamosHoy: number;
  prestamosAyer: number;
  ticketsAbiertos: number;
  tareasAbiertas: number;
  personasUnicas: number;
  equiposUnicos: number;
  byPerson: AnalyticsRow[];
  byRole: AnalyticsRow[];
  byLocation: AnalyticsRow[];
  byReason: AnalyticsRow[];
  byCourse: AnalyticsRow[];
  byDevice: AnalyticsRow[];
  byOperator: AnalyticsRow[];
  byTicketDevice: AnalyticsRow[];
  byTaskType: AnalyticsRow[];
  byHourWeekday: AnalyticsRow[];
  annualTrend: AnalyticsRow[];
  avgLoanHoursByDevice: AnalyticsRow[];
  ticketResponseDays: number;
  agendaOccupation: AnalyticsRow[];
  byHour: AnalyticsRow[];
  byWeekday: AnalyticsRow[];
  series: { granularity: 'day' | 'month'; rows: AnalyticsRow[] };
  // Etapa 8a (Analítica Grafito)
  byPersonGrouped: Array<AnalyticsRow & { variants: number }>;
  sinPersona: number;
  byDeviceTag: DeviceRankRow[];
  byType: AnalyticsRow[];
  byOperatorSplit: Array<{ label: string; prestamos: number; devoluciones: number }>;
  openTasksByType: AnalyticsRow[];
  /** [día de la semana 0 = domingo][hora 0-23] = préstamos. */
  hourWeekday: number[][];
  byTypeHour: Array<{ type: string; total: number; fleet: number; hours: number[] }>;
  untypedLoans: number;
  untypedFleet: number;
  annualTrendPrev: AnalyticsRow[];
  durations: LoanDurations;
  evolution: Evolution;
  ticketMetrics: {
    created: number; resolved: number; averageResolutionHours: number; averageResponseHours: number;
    byCategory: AnalyticsRow[]; byPriority: AnalyticsRow[]; byTechnician: AnalyticsRow[]; bySchool: AnalyticsRow[]; byClassroom: AnalyticsRow[];
    openClosed: AnalyticsRow[]; recurring: AnalyticsRow[]; monthly: AnalyticsRow[];
    evolution: Evolution;
  };
}

export interface AnalyticsResponse {
  ok: true;
  from: string;
  to: string;
  /** Solo con ?events=1 (la pantalla no lo usa). */
  events?: LoanEvent[];
  summary: AnalyticsSummary;
}

export interface ParqueRenewalItem {
  etiqueta: string;
  alias: string;
  assetClass: string;
  condition: string;
  fechaAlta: string;
  fechaRenovacion: string;
  mesesRestantes: number | null;
  vencido: boolean;
  estimada: boolean;
}

export interface ParqueResponse {
  ok: true;
  summary: {
    equipos: number;
    recursos: number;
    equiposMalos: number;
    recursosMalos: number;
    vencidos: number;
    aRenovar12: number;
    bajoStock: number;
    cobertura: number;
  };
  condicionTotales: AnalyticsRow[];
  condicionPorClase: Array<{ label: string; Excelente: number; Bueno: number; Regular: number; Malo: number; 'Sin revisar': number }>;
  renovacionPorAnio: AnalyticsRow[];
  vidaConsumida: AnalyticsRow[];
  aRenovar: ParqueRenewalItem[];
}

export const getParque = (fresh = false) => apiGet<ParqueResponse>('/api/analytics/parque', { fresh });

export const getAnalytics = (from?: string, to?: string, fresh = false) => {
  const params = new URLSearchParams();
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  const qs = params.toString();
  return apiGet<AnalyticsResponse>(`/api/analytics${qs ? `?${qs}` : ''}`, { fresh });
};
