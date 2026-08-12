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
  ticketMetrics: {
    created: number; resolved: number; averageResolutionHours: number; averageResponseHours: number;
    byCategory: AnalyticsRow[]; byPriority: AnalyticsRow[]; byTechnician: AnalyticsRow[]; bySchool: AnalyticsRow[]; byClassroom: AnalyticsRow[];
    openClosed: AnalyticsRow[]; recurring: AnalyticsRow[]; monthly: AnalyticsRow[];
  };
}

export interface AnalyticsResponse {
  ok: true;
  from: string;
  to: string;
  events: LoanEvent[];
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

export const getParque = () => apiGet<ParqueResponse>('/api/analytics/parque');

export const getAnalytics = (from?: string, to?: string) => {
  const params = new URLSearchParams();
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  const qs = params.toString();
  return apiGet<AnalyticsResponse>(`/api/analytics${qs ? `?${qs}` : ''}`);
};
