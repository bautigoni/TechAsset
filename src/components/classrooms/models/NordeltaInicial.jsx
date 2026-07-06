/**
 * NordeltaInicial.jsx — Nivel Inicial · Planta Baja (NFND).
 * Plano dibujado a mano reproduciendo la geometría real del "Mapa 2026".
 * Dos filas de salas K con núcleo central de baños/escalera y anexos laterales.
 * viewBox 0 0 1160 440.
 */
import { Bath, Corridor, C, FloorSvg, Room, Stair, roomListFrom, useFloorInteraction } from './NordeltaFloorKit.jsx';

const ROOMS = [
  // Fila superior
  { id: 'nd_ini_K1y2', label: 'K 1y2', x: 120, y: 118, w: 96, h: 90, type: 'classroom', door: { side: 'bottom', at: 0.5 } },
  { id: 'nd_ini_K2F', label: 'K2 F', x: 226, y: 118, w: 96, h: 90, type: 'classroom', door: { side: 'bottom', at: 0.5 } },
  { id: 'nd_ini_K2N', label: 'K2 N', x: 332, y: 118, w: 96, h: 90, type: 'classroom', door: { side: 'bottom', at: 0.5 } },
  { id: 'nd_ini_SUM', label: 'SUM', x: 438, y: 118, w: 96, h: 90, type: 'special', door: { side: 'bottom', at: 0.5 } },
  { id: 'nd_ini_K3Taller', label: 'K3 Taller', x: 604, y: 118, w: 96, h: 90, type: 'special', door: { side: 'bottom', at: 0.5 } },
  { id: 'nd_ini_K4N', label: 'K4 N', x: 710, y: 118, w: 96, h: 90, type: 'classroom', door: { side: 'bottom', at: 0.5 } },
  { id: 'nd_ini_K4F', label: 'K4 F', x: 816, y: 118, w: 96, h: 90, type: 'classroom', door: { side: 'bottom', at: 0.5 } },
  { id: 'nd_ini_K4S', label: 'K4 S', x: 922, y: 118, w: 96, h: 90, type: 'classroom', door: { side: 'bottom', at: 0.5 } },
  { id: 'nd_ini_dirStaff', label: 'Dir. Staff NI', x: 1030, y: 118, w: 100, h: 90, type: 'admin', noClick: true },
  // Fila inferior
  { id: 'nd_ini_K3N', label: 'K3 N', x: 332, y: 282, w: 96, h: 92, type: 'classroom', door: { side: 'top', at: 0.5 } },
  { id: 'nd_ini_K3F', label: 'K3 F', x: 438, y: 282, w: 96, h: 92, type: 'classroom', door: { side: 'top', at: 0.5 } },
  { id: 'nd_ini_recepcion', label: 'Recepción / Dir. NI', x: 604, y: 282, w: 96, h: 92, type: 'admin', noClick: true },
  { id: 'nd_ini_K5S', label: 'K5 S', x: 710, y: 282, w: 96, h: 92, type: 'classroom', door: { side: 'top', at: 0.5 } },
  { id: 'nd_ini_K5F', label: 'K5 F', x: 816, y: 282, w: 96, h: 92, type: 'classroom', door: { side: 'top', at: 0.5 } },
  { id: 'nd_ini_K5N', label: 'K5 N', x: 922, y: 282, w: 96, h: 92, type: 'classroom', door: { side: 'top', at: 0.5 } }
];

const STAIRS = [
  { x: 548, y: 118, w: 44, h: 92, steps: 6, dir: 'v' },   // núcleo central
  { x: 182, y: 278, w: 46, h: 96, steps: 7, dir: 'v' },   // escalera izquierda
  { x: 1036, y: 282, w: 74, h: 92, steps: 6, dir: 'h' }   // escalera extremo derecho
];

const BATHS = [
  { x: 544, y: 224, w: 54, h: 150, cols: 2 }
];

export default function NordeltaInicial({ onRoomClick = () => {}, statuses = {} }) {
  const { hovered, onHover, roomStatus } = useFloorInteraction(statuses);
  return (
    <FloorSvg viewBox="0 0 1160 440" watermark="NIVEL INICIAL · PB">
      {/* Silueta principal */}
      <path d="M 100 100 L 1132 100 L 1132 400 L 100 400 Z" fill={C.body} stroke={C.wallGlow} strokeWidth={2.5} strokeLinejoin="round" />
      {/* Anexo inferior izquierdo */}
      <path d="M 60 268 L 172 268 L 172 386 L 60 386 Z" fill={C.body} stroke={C.wallGlow} strokeWidth={2} strokeLinejoin="round" strokeDasharray="6 4" />

      <Corridor x={120} y={224} w={900} h={26} label="── CIRCULACIÓN ──" />
      {STAIRS.map((s, i) => <Stair key={i} s={s} />)}
      {BATHS.map((b, i) => <Bath key={i} b={b} />)}
      {ROOMS.map(room => (
        <Room key={room.id} room={room} status={roomStatus[room.id]} hovered={hovered} onHover={onHover} onClick={onRoomClick} />
      ))}
    </FloorSvg>
  );
}

export const INICIAL_ROOMS = roomListFrom(ROOMS);
