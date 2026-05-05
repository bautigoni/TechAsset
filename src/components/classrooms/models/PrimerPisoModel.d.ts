import type { ClassroomGeneralState } from '../../../types';

export interface RoomStatusMap {
  [roomKey: string]: { estadoGeneral: ClassroomGeneralState };
}

export interface PrimerPisoModelProps {
  statuses?: RoomStatusMap;
  onRoomClick?: (roomKey: string, nombre: string) => void;
}

export function PrimerPisoModel(props: PrimerPisoModelProps): JSX.Element;
export const PRIMER_PISO_ROOMS: Array<{ roomKey: string; nombre: string; sector: string }>;
