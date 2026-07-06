/**
 * NordeltaSegundoPiso.jsx — Bloque 3 · 2° Piso · Nivel Primario / Secundario (NFND).
 * Plano dibujado a mano reproduciendo la geometría real del "Mapa 2026".
 * Cluster EP + Laboratorio (centro), ala ES arriba-derecha, fila larga abajo.
 * viewBox 0 0 1024 560.
 */
import { Bath, Corridor, C, FloorSvg, Room, Stair, roomListFrom, useFloorInteraction } from './NordeltaFloorKit.jsx';

const ROOMS = [
  // Cluster superior izquierdo
  { id: 'nd_p2_TICS', label: 'TICS', x: 100, y: 150, w: 88, h: 64, type: 'special', door: { side: 'bottom', at: 0.5 } },
  { id: 'nd_p2_dirEP', label: 'Dir. EP', x: 250, y: 142, w: 70, h: 56, type: 'admin', noClick: true },
  { id: 'nd_p2_TICs2', label: 'TICs', x: 330, y: 142, w: 80, h: 56, type: 'admin', noClick: true },
  { id: 'nd_p2_6S_EP', label: '6°S EP', x: 100, y: 230, w: 88, h: 68, type: 'classroom', door: { side: 'right', at: 0.5 } },
  { id: 'nd_p2_lab', label: 'Laboratorio', x: 360, y: 206, w: 166, h: 112, type: 'special', door: { side: 'bottom', at: 0.5 } },
  // Ala superior derecha (ES)
  { id: 'nd_p2_4N_ES', label: '4to N ES', x: 548, y: 120, w: 86, h: 64, type: 'classroom', door: { side: 'bottom', at: 0.5 } },
  { id: 'nd_p2_4F_ES', label: '4to F ES', x: 704, y: 120, w: 86, h: 66, type: 'classroom', door: { side: 'bottom', at: 0.4 } },
  { id: 'nd_p2_4S_ES', label: '4to S ES', x: 716, y: 222, w: 86, h: 68, type: 'classroom', door: { side: 'left', at: 0.5 } },
  // Fila inferior larga
  { id: 'nd_p2_6N_EP', label: '6°N EP', x: 96, y: 378, w: 84, h: 78, type: 'classroom', door: { side: 'top', at: 0.5 } },
  { id: 'nd_p2_6F_EP', label: '6°F EP', x: 190, y: 378, w: 84, h: 78, type: 'classroom', door: { side: 'top', at: 0.5 } },
  { id: 'nd_p2_staffEP', label: 'Staff EP', x: 286, y: 378, w: 80, h: 78, type: 'admin', noClick: true, dashed: true },
  { id: 'nd_p2_dirSec', label: 'Dirección Secundaria', x: 382, y: 378, w: 40, h: 78, type: 'admin', noClick: true, tone: 'danger' },
  { id: 'nd_p2_3N_ES', label: '3ro N ES', x: 476, y: 378, w: 84, h: 78, type: 'classroom', door: { side: 'top', at: 0.5 } },
  { id: 'nd_p2_3F_ES', label: '3ro F ES', x: 600, y: 378, w: 84, h: 78, type: 'classroom', door: { side: 'top', at: 0.5 } },
  { id: 'nd_p2_3S_ES', label: '3ro S ES', x: 724, y: 378, w: 84, h: 78, type: 'classroom', door: { side: 'top', at: 0.5 } },
  { id: 'nd_p2_staffES', label: 'Staff ES', x: 848, y: 378, w: 84, h: 78, type: 'admin', noClick: true, dashed: true }
];

const STAIRS = [
  { x: 200, y: 128, w: 48, h: 94, steps: 7, dir: 'h' },   // escalera top-left
  { x: 638, y: 206, w: 52, h: 100, steps: 6, dir: 'v' },  // escalera núcleo central
  { x: 850, y: 300, w: 50, h: 84, steps: 6, dir: 'h' },   // escalera extremo derecho
  { x: 48, y: 300, w: 46, h: 96, steps: 7, dir: 'v' }     // escalera extremo izquierdo
];

const BATHS = [
  { x: 250, y: 206, w: 92, h: 100 },
  { x: 540, y: 206, w: 90, h: 110 }
];

export default function NordeltaSegundoPiso({ onRoomClick = () => {}, statuses = {} }) {
  const { hovered, onHover, roomStatus } = useFloorInteraction(statuses);
  return (
    <FloorSvg viewBox="0 0 1024 560" watermark="BLOQUE 3 · 2° PISO">
      {/* Silueta: cuerpo principal + bloque EP (arriba-izq) + ala ES (arriba-der) */}
      <path d="M 88 182 L 88 456 L 932 456 L 932 100 L 534 100 L 534 182 Z" fill={C.body} stroke={C.wallGlow} strokeWidth={2.5} strokeLinejoin="round" />
      <path d="M 88 120 L 420 120 L 420 210 L 88 210 Z" fill={C.body} stroke={C.wallGlow} strokeWidth={2.5} strokeLinejoin="round" />

      <Corridor x={100} y={326} w={832} h={26} label="── CIRCULACIÓN ──" />
      {/* Terraza / rampa inferior */}
      <rect x={270} y={464} width={360} height={62} fill="url(#ndFloorHatch)" opacity={0.5} />
      <rect x={270} y={464} width={360} height={62} fill="none" stroke={C.wall} strokeWidth={1.5} />

      {STAIRS.map((s, i) => <Stair key={i} s={s} />)}
      {BATHS.map((b, i) => <Bath key={i} b={b} />)}
      {ROOMS.map(room => (
        <Room key={room.id} room={room} status={roomStatus[room.id]} hovered={hovered} onHover={onHover} onClick={onRoomClick} />
      ))}
    </FloorSvg>
  );
}

export const P2_ROOMS = roomListFrom(ROOMS);
