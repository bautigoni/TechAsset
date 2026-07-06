/**
 * NordeltaModels.jsx
 * Planos esquemáticos SVG interactivos de la sede Nordelta (NFND), derivados
 * del "Mapa 2026". Mismo lenguaje visual que los planos de NFPT (FloorModelBase).
 *
 * IDs con prefijo nd_ para no colisionar con NFPT. Cada aula clickeable mapea
 * a la tabla `classrooms` (site_code=NFND) por su room_key.
 *
 * Pisos (Bloque 3 = Primaria/Secundaria):
 *   planta  → Planta baja      1ro/2do EP · 5to/6to ES · Ágora · Under · Blooming
 *   primero → 1er piso         3ro/4to/5to EP · 1ro/2do ES · TICS
 *   segundo → 2do piso         6to EP · Laboratorio · 3ro/4to ES
 *   inicial → Nivel inicial    salas K (jardín)
 *   artes   → Edificio SUM/Artes  SUM · Música · Arte · Drama · Escenografía
 */
import { FloorModel, toRoomList } from './FloorModelBase.jsx';
import NordeltaPlantaBaja, { PB_ROOMS } from './NordeltaPlantaBaja.jsx';
import NordeltaPrimerPiso, { P1_ROOMS } from './NordeltaPrimerPiso.jsx';
import NordeltaSegundoPiso, { P2_ROOMS } from './NordeltaSegundoPiso.jsx';

// ── Nivel Inicial · Planta baja ────────────────────────────────────────
const INICIAL = [
  { id: 'nd_ini_corr_h', label: '', x: 20, y: 165, w: 1100, h: 22, type: 'corridor', noClick: true },
  { id: 'nd_ini_esc', label: 'Escalera', x: 30, y: 200, w: 95, h: 115, type: 'stairs', noClick: true },
  // Fila superior
  { id: 'nd_ini_K1y2', label: 'K 1y2', x: 30, y: 40, w: 110, h: 115, type: 'classroom' },
  { id: 'nd_ini_K2F', label: 'K2 F', x: 145, y: 40, w: 110, h: 115, type: 'classroom' },
  { id: 'nd_ini_K2N', label: 'K2 N', x: 260, y: 40, w: 110, h: 115, type: 'classroom' },
  { id: 'nd_ini_SUM', label: 'SUM', x: 375, y: 40, w: 110, h: 115, type: 'special' },
  { id: 'nd_ini_K3Taller', label: 'K3 Taller', x: 560, y: 40, w: 110, h: 115, type: 'special' },
  { id: 'nd_ini_K4N', label: 'K4 N', x: 675, y: 40, w: 110, h: 115, type: 'classroom' },
  { id: 'nd_ini_K4F', label: 'K4 F', x: 790, y: 40, w: 110, h: 115, type: 'classroom' },
  { id: 'nd_ini_K4S', label: 'K4 S', x: 905, y: 40, w: 110, h: 115, type: 'classroom' },
  { id: 'nd_ini_dirStaff', label: 'Dir. Staff NI', x: 1020, y: 40, w: 100, h: 115, type: 'admin', noClick: true },
  // Fila inferior
  { id: 'nd_ini_K3N', label: 'K3 N', x: 145, y: 200, w: 110, h: 115, type: 'classroom' },
  { id: 'nd_ini_K3F', label: 'K3 F', x: 260, y: 200, w: 110, h: 115, type: 'classroom' },
  { id: 'nd_ini_recepcion', label: 'Recepción / Dir. NI', x: 430, y: 200, w: 130, h: 115, type: 'admin', noClick: true },
  { id: 'nd_ini_K5S', label: 'K5 S', x: 675, y: 200, w: 110, h: 115, type: 'classroom' },
  { id: 'nd_ini_K5F', label: 'K5 F', x: 790, y: 200, w: 110, h: 115, type: 'classroom' },
  { id: 'nd_ini_K5N', label: 'K5 N', x: 905, y: 200, w: 110, h: 115, type: 'classroom' }
];

// ── Edificio SUM / Artes ───────────────────────────────────────────────
const ARTES = [
  { id: 'nd_art_corr_v', label: '', x: 400, y: 30, w: 20, h: 590, type: 'corridor', noClick: true },
  { id: 'nd_art_SUM', label: 'SUM', x: 40, y: 300, w: 340, h: 300, type: 'special' },
  { id: 'nd_art_music', label: 'Música', x: 435, y: 30, w: 210, h: 115, type: 'classroom' },
  { id: 'nd_art_arte', label: 'Arte', x: 435, y: 160, w: 175, h: 105, type: 'classroom' },
  { id: 'nd_art_esceno', label: 'Escenografía', x: 435, y: 280, w: 175, h: 105, type: 'special' },
  { id: 'nd_art_blooming', label: 'Blooming Inicial', x: 435, y: 400, w: 175, h: 100, type: 'special' },
  { id: 'nd_art_drama', label: 'Drama', x: 435, y: 515, w: 175, h: 105, type: 'classroom' }
];

export function NdPlantaBajaModel(props) {
  return <NordeltaPlantaBaja {...props} />;
}
export function NdPrimerPisoModel(props) {
  return <NordeltaPrimerPiso {...props} />;
}
export function NdSegundoPisoModel(props) {
  return <NordeltaSegundoPiso {...props} />;
}
export function NdInicialModel(props) {
  return <FloorModel rooms={INICIAL} viewBox="0 0 1140 345" watermark="Nordelta · Nivel Inicial" {...props} />;
}
export function NdArtesModel(props) {
  return <FloorModel rooms={ARTES} viewBox="0 0 680 640" watermark="Nordelta · SUM / Artes" {...props} />;
}

export const ND_ALL_FLOOR_ROOMS = {
  planta: PB_ROOMS,
  primero: P1_ROOMS,
  segundo: P2_ROOMS,
  inicial: toRoomList(INICIAL),
  artes: toRoomList(ARTES)
};
