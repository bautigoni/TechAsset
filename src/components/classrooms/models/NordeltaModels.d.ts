import type { PrimerPisoModelProps } from './PrimerPisoModel';

export function NdPlantaBajaModel(props: PrimerPisoModelProps): JSX.Element;
export function NdPrimerPisoModel(props: PrimerPisoModelProps): JSX.Element;
export function NdSegundoPisoModel(props: PrimerPisoModelProps): JSX.Element;
export function NdInicialModel(props: PrimerPisoModelProps): JSX.Element;
export function NdArtesModel(props: PrimerPisoModelProps): JSX.Element;
export const ND_ALL_FLOOR_ROOMS: Record<string, Array<{ roomKey: string; nombre: string; sector: string }>>;
