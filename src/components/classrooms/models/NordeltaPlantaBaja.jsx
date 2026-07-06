/**
 * NordeltaPlantaBaja.jsx — Bloque 3 · PB · Nivel Primario / Secundario (NFND).
 * Plano dibujado a mano reproduciendo la geometría real del "Mapa 2026".
 * viewBox 0 0 1024 560. Primitivas en NordeltaFloorKit.
 */
import { Bath, Corridor, C, FloorSvg, Room, Stair, roomListFrom, useFloorInteraction } from './NordeltaFloorKit.jsx';

const ROOMS = [
  { id: 'nd_pb_2S_EP', label: '2°S EP', x: 118, y: 118, w: 90, h: 70, type: 'classroom', door: { side: 'bottom', at: 0.5 } },
  { id: 'nd_pb_2F_EP', label: '2°F EP', x: 264, y: 118, w: 90, h: 70, type: 'classroom', door: { side: 'bottom', at: 0.4 } },
  { id: 'nd_pb_2N_EP', label: '2°N EP', x: 118, y: 216, w: 90, h: 78, type: 'classroom', door: { side: 'right', at: 0.5 } },
  { id: 'nd_pb_1S_EP', label: '1°S EP', x: 366, y: 220, w: 100, h: 74, type: 'classroom', door: { side: 'left', at: 0.6 } },
  { id: 'nd_pb_1F_EP', label: '1°F EP', x: 118, y: 350, w: 90, h: 72, type: 'classroom', door: { side: 'top', at: 0.5 } },
  { id: 'nd_pb_1N_EP', label: '1°N EP', x: 214, y: 350, w: 92, h: 72, type: 'classroom', door: { side: 'top', at: 0.5 } },
  { id: 'nd_pb_agora', label: 'Ágora', x: 372, y: 18, w: 168, h: 150, type: 'special', door: { side: 'bottom', at: 0.5 } },
  { id: 'nd_pb_blooming', label: 'Blooming', x: 490, y: 356, w: 78, h: 84, type: 'special', door: { side: 'top', at: 0.5 } },
  { id: 'nd_pb_5N_ES', label: '5°N ES', x: 566, y: 92, w: 96, h: 66, type: 'classroom', door: { side: 'bottom', at: 0.5 } },
  { id: 'nd_pb_5F_ES', label: '5°F ES', x: 680, y: 92, w: 100, h: 66, type: 'classroom', door: { side: 'bottom', at: 0.4 } },
  { id: 'nd_pb_5S_ES', label: '5°S ES', x: 712, y: 192, w: 100, h: 70, type: 'classroom', door: { side: 'left', at: 0.5 } },
  { id: 'nd_pb_under', label: 'Under', x: 820, y: 146, w: 152, h: 96, type: 'special', door: { side: 'left', at: 0.5 } },
  { id: 'nd_pb_6N_ES', label: '6°N ES', x: 748, y: 356, w: 94, h: 66, type: 'classroom', door: { side: 'top', at: 0.5 } },
  { id: 'nd_pb_6F_ES', label: '6°F ES', x: 866, y: 326, w: 96, h: 76, type: 'classroom', door: { side: 'top', at: 0.5 } }
];

const STAIRS = [
  { x: 212, y: 100, w: 48, h: 128, steps: 7, dir: 'h' },
  { x: 428, y: 232, w: 40, h: 92, steps: 6, dir: 'v' },
  { x: 690, y: 280, w: 66, h: 88, steps: 6, dir: 'h' },
  { x: 882, y: 210, w: 66, h: 100, steps: 7, dir: 'v' }
];

const BATHS = [
  { x: 212, y: 236, w: 150, h: 96 },
  { x: 476, y: 194, w: 148, h: 122 }
];

export default function NordeltaPlantaBaja({ onRoomClick = () => {}, statuses = {} }) {
  const { hovered, onHover, roomStatus } = useFloorInteraction(statuses);
  return (
    <FloorSvg viewBox="0 0 1024 560" watermark="BLOQUE 3 · PB">
      {/* Silueta: cuerpo principal + Ágora sobresaliendo arriba */}
      <path
        d="M 100 108 L 356 108 L 356 14 L 556 14 L 556 108 L 984 108 L 984 462 L 100 462 Z"
        fill={C.body} stroke={C.wallGlow} strokeWidth={2.5} strokeLinejoin="round"
      />
      <Corridor x={100} y={300} w={372} h={30} />
      <Corridor x={566} y={300} w={406} h={30} />
      <Corridor x={100} y={430} w={872} h={32} label="── ENTRADA / NIVEL PRIMARIO · SECUNDARIO ──" />
      {STAIRS.map((s, i) => <Stair key={i} s={s} />)}
      {BATHS.map((b, i) => <Bath key={i} b={b} />)}
      {ROOMS.map(room => (
        <Room key={room.id} room={room} status={roomStatus[room.id]} hovered={hovered} onHover={onHover} onClick={onRoomClick} />
      ))}
    </FloorSvg>
  );
}

export const PB_ROOMS = roomListFrom(ROOMS);
