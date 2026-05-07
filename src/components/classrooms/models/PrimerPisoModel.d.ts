import type { ClassroomGeneralState } from '../../../types';

export interface RoomStatusMap {
  [roomKey: string]: { estadoGeneral: ClassroomGeneralState };
}

export interface PrimerPisoModelProps {
  statuses?: RoomStatusMap;
  onRoomClick?: (roomKey: string, nombre: string) => void;
}

export function PrimerPisoModel(props: PrimerPisoModelProps): JSX.Element;
export function FirstFloorModel(props: PrimerPisoModelProps): JSX.Element;
export function SecondFloorModel(props: PrimerPisoModelProps): JSX.Element;
export const PRIMER_PISO_ROOMS: Array<{ roomKey: string; nombre: string; sector: string }>;
export const FIRST_FLOOR_ROOMS: Array<{ roomKey: string; nombre: string; sector: string }>;
export const SECOND_FLOOR_ROOMS: Array<{ roomKey: string; nombre: string; sector: string }>;
export const ALL_FLOOR_ROOMS: Record<string, Array<{ roomKey: string; nombre: string; sector: string }>>;
