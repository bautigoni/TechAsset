export type ViewKey = 'dashboard' | 'devices' | 'loans' | 'inventory' | 'analytics' | 'agenda' | 'schedules' | 'tasks' | 'reminders' | 'canvas' | 'pettycash' | 'classrooms' | 'tickets' | 'knowledge' | 'suggestions' | 'tools' | 'quickaccess' | 'assistant' | 'tenants' | 'settings';

export type ClassroomItemState = 'OK' | 'Con falla' | 'No tiene' | 'En reparación' | 'Sin revisar';
export type ClassroomGeneralState = 'OK' | 'Con observaciones' | 'Problema' | 'Sin revisar';
export type ClassroomEquipmentKey = string;

export interface ClassroomCategory {
  id: number;
  key: string;
  label: string;
  type: 'status' | string;
  options: ClassroomItemState[];
  sortOrder: number;
  builtIn: boolean;
}

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
  numeroOperativo?: string;
  aliasOperativo?: string;
  aliasOperativoJson?: string;
  categoria?: string;
  filtro?: string;
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
  ubicacionDetalle?: string;
  curso?: string;
  motivo?: string;
  motivoDetalle?: string;
  loanedAt?: string;
  returnedAt?: string;
  changedAt?: string;
  ultima?: string;
  createdAt?: string;
  condition?: string;
  conditionNotes?: string;
  lastReviewedAt?: string;
  assetClass?: string;
  assetClassConfirmed?: boolean;
  lifecycleSource?: 'equipo' | 'sede' | 'global';
  fechaAlta?: string;
  meses?: number;
  fechaRenovacion?: string;
  mesesRestantes?: number | null;
  vidaConsumidaPct?: number | null;
  vencido?: boolean;
  estimada?: boolean;
}

export type ConditionValue = 'Excelente' | 'Bueno' | 'Regular' | 'Malo';
export const CONDITION_VALUES: ConditionValue[] = ['Excelente', 'Bueno', 'Regular', 'Malo'];

export interface Movement {
  id?: string;
  timestamp: string;
  tipo: string;
  descripcion: string;
  operador?: string;
  origen: 'Agenda TIC' | 'Tareas TIC' | 'Local';
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

export type TaskState = string;

export interface TaskItem {
  id: string;
  titulo: string;
  descripcion?: string;
  responsable: Operator | string;
  responsables?: string[];
  assigneeEmails?: string[];
  estado: TaskState;
  columnId?: number | null;
  columnColor?: string;
  done?: boolean;
  visibility?: 'team' | 'private';
  ownerEmail?: string;
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
  attachments?: Array<{ name: string; url: string; mimeType?: string }>;
  commentsCount?: number;
}

export interface ClassroomIncident {
  id: number; numero: string; titulo: string; descripcion: string; estado: TicketState; prioridad: string; categoria: string;
  responsables: string[]; createdAt: string; updatedAt: string; resolvedAt: string;
}

export interface ClassroomIncidentSummary {
  open: number; closed: number; total: number; lastIncidentAt: string; commonCategories: Array<{ label: string; value: number }>;
}

export interface TaskColumn { id: number; name: string; color: string; position: number; isDone: boolean; createdBy?: string }
export interface TaskComment { id: number; taskId: string; body: string; authorEmail: string; authorName: string; createdAt: string; updatedAt: string }

export type SchoolLevel = 'primary_first' | 'primary_second' | 'secondary';
export interface TeacherScheduleEntry { id: number; teacher: string; course: string; subject: string; room: string; schoolLevel: SchoolLevel; dayOfWeek: number; startTime: string; endTime: string; createdBy?: string; updatedAt?: string }
export interface RecessSlot { id?: number; label: string; startTime: string; endTime: string; sortOrder?: number }
export interface RecessGroup { id?: number; name: string; sortOrder?: number; slots: RecessSlot[] }

export type CanvasItemType = 'sticky' | 'text' | 'checklist' | 'image' | 'file' | 'link' | 'task-group';
export interface CanvasItem { id: number; itemType: CanvasItemType; title: string; content: Record<string, unknown>; x: number; y: number; width: number; height: number; zIndex: number; color: string; createdBy?: string; createdAt?: string; updatedAt?: string }
export interface Reminder { id:number; siteCode?:string; title:string; description:string; remindAt:string; ownerEmail:string; ownerName:string; priority:string; relatedType:string; relatedId:string; relatedLabel:string; status:'pending'|'completed'; createdByEmail:string; createdByName:string; completedAt:string; createdAt:string; updatedAt:string }

export interface PettyCashExpense { id: number; expenseDate: string; description: string; supplier: string; amount: number; category: string; receiptUrl: string; purchaseRequestId?: number | null; inventoryItemId?: number | null; createdBy?: string; createdAt?: string }
export interface PurchaseRequest { id: number; description: string; category: string; estimatedAmount: number; requestedSupplier: string; justification: string; receiptUrl: string; status: 'Pendiente' | 'Aprobada' | 'Rechazada'; requesterEmail: string; requesterName: string; finalCost: number; finalSupplier: string; resolutionNote: string; resolvedBy: string; resolvedAt: string; createdAt: string }

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

export interface InventoryItem {
  id: number;
  siteCode?: string;
  nombre: string;
  categoria: string;
  cantidad: number;
  unidad: string;
  imagenUrl?: string;
  estado?: string;
  estadoLegacy?: string;
  condicion?: string;
  minStock?: number;
  bajoStock?: boolean;
  condicionUpdatedAt?: string;
  observaciones?: string;
  activo?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export type TicketState = 'No hecho' | 'En proceso' | 'Hecho';
export type TicketSource = 'tik' | 'handing';

export interface Ticket {
  id: number;
  siteCode?: string;
  numero: string;
  titulo: string;
  descripcion: string;
  estado: TicketState;
  prioridad: 'Baja' | 'Media' | 'Alta' | 'Urgente' | string;
  responsables: string[];
  categoria: string;
  imagenUrl: string;
  nota: string;
  origen: TicketSource;
  creadoPor: string;
  operadorUltimoCambio: string;
  createdAt: string;
  updatedAt: string;
  tags?: string[];
  templateId?: number | null;
  classroom?: string;
  classroomKey?: string;
  school?: string;
  aiSummary?: string;
  aiSummaryUpdatedAt?: string;
  firstResponseAt?: string;
  resolvedAt?: string;
  checklist?: string[];
}

export interface TicketTemplate { id: number; title: string; description: string; priority: string; category: string; suggestedAssignee: string; checklist: string[]; tags: string[]; createdBy?: string; createdAt?: string; updatedAt?: string }
export interface TicketComment { id: number; ticketId: number; body: string; authorEmail: string; authorName: string; createdAt: string }
export interface TicketActivity { id: number; action: string; detail: string; actorEmail: string; actorName: string; createdAt: string }
export interface TicketChecklistItem { id: number; ticketId: number; text: string; done: boolean; position: number; completedBy: string; completedAt: string }
export interface TicketRelation { relationId: number; relationType: 'related' | 'parent'; role: 'related' | 'parent' | 'child'; ticket: Ticket }
export interface KnowledgeArticle { id: number; title: string; content: string; contentText: string; category: string; tags: string[]; attachments: Array<{ name: string; url: string; mimeType?: string }>; createdBy: string; updatedBy: string; createdAt: string; updatedAt: string; score?: number }

export type SuggestionStatus = 'Proposed' | 'Under Review' | 'Planned' | 'In Progress' | 'Implemented' | 'Rejected';
export interface Suggestion { id:number; title:string; description:string; category:string; status:SuggestionStatus; authorEmail:string; authorName:string; voteCount:number; commentCount:number; hasVoted:boolean; canEdit:boolean; canDelete:boolean; createdAt:string; updatedAt:string }
export interface SuggestionComment { id:number; suggestionId:number; body:string; authorEmail:string; authorName:string; createdAt:string }
export interface SuggestionStats { total:number; mostVoted:{ id:number; title:string; votes:number } | null; implemented:number; pendingReview:number }

export interface PreviousDayLoan {
  id: number;
  etiqueta: string;
  alias: string;
  filtro: string;
  persona: string;
  rol: string;
  ubicacion: string;
  curso: string;
  motivo: string;
  operador: string;
  accessories?: string[];
  timestamp: string;
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
  state: 'loading' | 'ok' | 'warning' | 'error';
  message?: string;
  loadedAt?: string;
}
