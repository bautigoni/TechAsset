export type PlanItemKind = 'room' | 'block' | 'corridor' | 'patio' | 'dashed' | 'vertical' | 'stairs' | 'bath' | 'poly';

export interface PlanDoor { side: 'top' | 'bottom' | 'left' | 'right'; at: number }

export interface PlanItem {
  k: PlanItemKind;
  /** En `room`: el room_key de la base. */
  id: string;
  label: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  door?: PlanDoor;
  /** Escalones (stairs). */
  n?: number;
  dir?: 'h' | 'v';
  /** Polígono (poly): "x,y x,y …" y posición del label. */
  pts?: string;
  lx?: number;
  ly?: number;
}

export interface PlanRoomItem extends PlanItem {
  k: 'room';
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FloorPlanDef {
  key: 'planta' | 'primero' | 'segundo' | 'inicial' | 'artes';
  label: string;
  /** Texto de `classrooms.piso` en la base. */
  piso: string;
  caption?: string;
  /** Planta que todavía no tiene plano ("Próximamente"). */
  disabled?: boolean;
  width?: number;
  height?: number;
  /** Siluetas del edificio ("x,y x,y …"). */
  outline?: string[];
  items?: PlanItem[];
}

export const FLOOR_PLANS: Record<string, FloorPlanDef[]>;
export function roomName(item: Pick<PlanItem, 'label'>): string;
export function roomsOf(floor: FloorPlanDef | undefined | null): Array<{ roomKey: string; nombre: string; item: PlanRoomItem }>;
