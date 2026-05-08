export type ViewKey = 'dashboard' | 'devices' | 'loans' | 'analytics' | 'agenda' | 'tasks' | 'classrooms' | 'tools' | 'quickaccess' | 'assistant' | 'settings';

export type ClassroomItemState = 'OK' | 'Con falla' | 'No tiene' | 'En reparación' | 'Sin revisar';
export type ClassroomGeneralState = 'OK' | 'Con observaciones' | 'Problema' | 'Sin revisar';
export type ClassroomEquipmentKey = 'proyector' | 'nuc' | 'monitor' | 'tecladoMouse' | 'tele' | 'notebook' | 'parlantes' | 'conectividad' | 'otro';

export interface ClassroomEquipmentItem {
  key: ClassroomEquipmentKey;
  label: string;
  state: ClassroomItemState;
}

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
  equipment: ClassroomEquipmentItem[];
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
export type DeviceType = string;
export type Operator = string;

export interface SiteInfo {
  siteCode: string;
  nombre: string;
  subtitulo?: string;
  logo?: string;
  siteRole?: string;
  turno?: string;
  isDefault?: boolean;
  themeColor?: string;
  spreadsheetUrl?: string;
  appsScriptUrl?: string;
  inventorySheetName?: string;
  activo?: boolean;
}

export interface AuthUser {
  id: number;
  email: string;
  nombre: string;
  rolGlobal: string;
}

export interface Device {
  id: string;
  siteCode?: string;
  etiqueta: string;
  numero?: string;
  aliasOperativo?: string;
  aliasOperativoJson?: string;
  categoria?: string;
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
  responsables?: string[];
  estado: TaskState;
  prioridad: 'Baja' | 'Media' | 'Urgente' | string;
  tipo?: string;
  turno?: 'Mañana' | 'Tarde' | 'Todo el día' | 'Sin turno' | string;
  fechaCreacion?: string;
  fechaVencimiento?: string;
  comentario?: string;
  creadoPor?: string;
  operadorUltimoCambio?: string;
  agendaId?: string;
  ultimaModificacion?: string;
  items?: TaskChecklistItem[];
  checklistTotal?: number;
  checklistDone?: number;
}

export interface TaskChecklistItem {
  id: number;
  taskId: string;
  texto: string;
  completada: boolean;
  orden: number;
  creadoPor: string;
  completadoPor: string;
  createdAt: string;
  completedAt: string;
}

export interface InternalNote {
  id: number;
  texto: string;
  operador: string;
  categoria: string;
  importante: boolean;
  archivada: boolean;
  visible?: boolean;
  deletedAt?: string;
  deletedBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface QuickLink {
  id: number;
  titulo: string;
  url: string;
  descripcion: string;
  categoria: string;
  icono: string;
  creadoPor: string;
  activo: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SyncStatus {
  state: 'loading' | 'ok' | 'error';
  message?: string;
  loadedAt?: string;
}
