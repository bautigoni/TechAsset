export type ViewKey = 'dashboard' | 'devices' | 'loans' | 'analytics' | 'agenda' | 'tasks' | 'classrooms' | 'tools' | 'quickaccess' | 'assistant' | 'settings';

export type ClassroomItemState = 'OK' | 'Con falla' | 'No tiene' | 'No encontrado' | 'En reparación' | 'Sin revisar';
export type ClassroomGeneralState = 'OK' | 'Con observaciones' | 'Problema' | 'Sin revisar';

export interface Classroom {
  roomKey: string;
  nombre: string;
  nivel: string;
  piso: string;
  sector: string;
  estadoGeneral: ClassroomGeneralState;
  proyector: ClassroomItemState;
  nuc: ClassroomItemState;
  monitor: ClassroomItemState;
  tecladoMouse: ClassroomItemState;
  observaciones: string;
  ultimaActualizacion: string;
  operadorUltimoCambio: string;
}

export interface ClassroomHistoryEntry {
  id: number;
  roomKey: string;
  timestamp: string;
  operador: string;
  campo: string;
  valorAnterior: string;
  valorNuevo: string;
  observacion: string;
}

export interface ClassroomSummary {
  total: number;
  ok: number;
  observaciones: number;
  problema: number;
  sinRevisar: number;
  proyectorFalla: number;
  nucFalla: number;
  monitorFalla: number;
}

export type DeviceState = 'Disponible' | 'Prestado' | 'No encontrada' | 'Fuera de servicio';
export type DeviceType = 'PLANI' | 'TOUCH' | 'TIC' | 'DELL';
export type Operator = 'Equi' | 'Bauti' | 'Lau' | 'Gus' | 'Mastro' | 'Fede';

export interface Device {
  id: string;
  etiqueta: string;
  numero?: string;
  aliasOperativo?: string;
  dispositivo?: string;
  marca?: string;
  modelo?: string;
  sn?: string;
  mac?: string;
  estado: DeviceState | string;
  prestadoA?: string;
  comentarios?: string;
  rol?: string;
  ubicacion?: string;
  motivo?: string;
  loanedAt?: string;
  returnedAt?: string;
  changedAt?: string;
  ultima?: string;
}

export interface Movement {
  id?: string;
  timestamp: string;
  tipo: string;
  descripcion: string;
  operador?: string;
  origen: 'Google Sheets' | 'Agenda TIC' | 'Tareas TIC' | 'Local';
  etiqueta?: string;
}

export type AgendaState = 'Pendiente' | 'Entregado' | 'Realizado' | 'Cancelado' | 'Faltaron equipos';

export interface AgendaItem {
  id: string;
  dia: string;
  fecha?: string;
  turno: string;
  desde: string;
  hasta: string;
  curso: string;
  actividad: string;
  tipoDispositivo: string;
  cantidad: number;
  ubicacion: string;
  responsableTic?: string;
  estado: AgendaState;
  nota?: string;
  compusRetiradas?: number;
  operadorUltimoCambio?: string;
  ultimaModificacion?: string;
  createdAt?: string;
}

export type TaskState = 'Pendiente' | 'En proceso' | 'Hecha';

export interface TaskItem {
  id: string;
  titulo: string;
  descripcion?: string;
  responsable: Operator | string;
  estado: TaskState;
  prioridad: 'Baja' | 'Media' | 'Urgente' | string;
  tipo?: string;
  fechaCreacion?: string;
  fechaVencimiento?: string;
  comentario?: string;
  creadoPor?: string;
  operadorUltimoCambio?: string;
  agendaId?: string;
  ultimaModificacion?: string;
}

export interface SyncStatus {
  state: 'loading' | 'ok' | 'error';
  message?: string;
  loadedAt?: string;
}
