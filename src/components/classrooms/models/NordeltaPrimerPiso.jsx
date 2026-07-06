/**
 * NordeltaPrimerPiso.jsx — Bloque 3 · 1° Piso · Nivel Primario / Secundario (NFND).
 * Plano dibujado a mano reproduciendo la geometría real del "Mapa 2026".
 * Cluster EP arriba-izquierda, ala ES arriba-derecha, fila larga abajo.
 * viewBox 0 0 1024 560.
 */
import { Bath, Corridor, C, FloorSvg, Room, Stair, roomListFrom, useFloorInteraction } from './NordeltaFloorKit.jsx';

const ROOMS = [
  // Cluster superior izquierdo (EP)
  { id: 'nd_p1_3F_EP', label: '3°F EP', x: 100, y: 100, w: 94, h: 72, type: 'classroom', door: { side: 'bottom', at: 0.5 } },
  { id: 'nd_p1_3N_EP', label: '3°N EP', x: 252, y: 100, w: 94, h: 72, type: 'classroom', door: { side: 'bottom', at: 0.5 } },
  { id: 'nd_p1_3S_EP', label: '3°S EP', x: 100, y: 200, w: 94, h: 68, type: 'classroom', door: { side: 'right', at: 0.5 } },
  // Banda central
  { id: 'nd_p1_5N_EP', label: '5°N EP', x: 348, y: 198, w: 82, h: 68, type: 'classroom', door: { side: 'bottom', at: 0.5 } },
  { id: 'nd_p1_TICS', label: 'TICS', x: 442, y: 198, w: 82, h: 68, type: 'special', door: { side: 'bottom', at: 0.5 } },
  // Ala superior derecha (ES)
  { id: 'nd_p1_2N_ES', label: '2do N ES', x: 548, y: 88, w: 86, h: 64, type: 'classroom', door: { side: 'bottom', at: 0.5 } },
  { id: 'nd_p1_2F_ES', label: '2do F ES', x: 688, y: 92, w: 86, h: 64, type: 'classroom', door: { side: 'bottom', at: 0.4 } },
  { id: 'nd_p1_2S_ES', label: '2do S ES', x: 716, y: 188, w: 86, h: 66, type: 'classroom', door: { side: 'left', at: 0.5 } },
  // Fila inferior larga
  { id: 'nd_p1_4N_EP', label: '4°N EP', x: 96, y: 356, w: 82, h: 76, type: 'classroom', door: { side: 'top', at: 0.5 } },
  { id: 'nd_p1_4NF_EP', label: '4°NF EP', x: 186, y: 356, w: 82, h: 76, type: 'classroom', door: { side: 'top', at: 0.5 } },
  { id: 'nd_p1_4S_EP', label: '4°S EP', x: 276, y: 356, w: 82, h: 76, type: 'classroom', door: { side: 'top', at: 0.5 } },
  { id: 'nd_p1_5F_EP', label: '5°F EP', x: 366, y: 356, w: 82, h: 76, type: 'classroom', door: { side: 'top', at: 0.5 } },
  { id: 'nd_p1_5S_EP', label: '5°S EP', x: 456, y: 356, w: 82, h: 76, type: 'classroom', door: { side: 'top', at: 0.5 } },
  { id: 'nd_p1_1N_ES', label: '1ro N ES', x: 584, y: 356, w: 82, h: 76, type: 'classroom', door: { side: 'top', at: 0.5 } },
  { id: 'nd_p1_1F_ES', label: '1ro F ES', x: 706, y: 356, w: 82, h: 76, type: 'classroom', door: { side: 'top', at: 0.5 } },
  { id: 'nd_p1_1S_ES', label: '1ro S ES', x: 828, y: 356, w: 82, h: 76, type: 'classroom', door: { side: 'top', at: 0.5 } }
];

const STAIRS = [
  { x: 200, y: 88, w: 48, h: 100, steps: 7, dir: 'h' },   // escalera top-left
  { x: 628, y: 188, w: 52, h: 96, steps: 6, dir: 'v' },   // escalera núcleo central
  { x: 842, y: 270, w: 50, h: 84, steps: 6, dir: 'h' },   // escalera extremo derecho
  { x: 48, y: 280, w: 46, h: 96, steps: 7, dir: 'v' }     // escalera extremo izquierdo
];

const BATHS = [
  { x: 256, y: 188, w: 88, h: 100 },
  { x: 536, y: 188, w: 86, h: 100 }
];

export default function NordeltaPrimerPiso({ onRoomClick = () => {}, statuses = {} }) {
  const { hovered, onHover, roomStatus } = useFloorInteraction(statuses);
  return (
    <FloorSvg viewBox="0 0 1024 560" watermark="BLOQUE 3 · 1° PISO">
      {/* Silueta: cuerpo principal + bloque EP (arriba-izq) + ala ES (arriba-der) */}
      <path d="M 88 172 L 88 434 L 926 434 L 926 72 L 534 72 L 534 172 Z" fill={C.body} stroke={C.wallGlow} strokeWidth={2.5} strokeLinejoin="round" />
      <path d="M 88 92 L 358 92 L 358 188 L 88 188 Z" fill={C.body} stroke={C.wallGlow} strokeWidth={2.5} strokeLinejoin="round" />

      <Corridor x={100} y={300} w={810} h={26} label="── CIRCULACIÓN ──" />
      <Corridor x={330} y={174} w={200} h={24} />
      {/* Terraza / rampa inferior */}
      <rect x={270} y={442} width={360} height={64} fill="url(#ndFloorHatch)" opacity={0.5} />
      <rect x={270} y={442} width={360} height={64} fill="none" stroke={C.wall} strokeWidth={1.5} />

      {STAIRS.map((s, i) => <Stair key={i} s={s} />)}
      {BATHS.map((b, i) => <Bath key={i} b={b} />)}
      {ROOMS.map(room => (
        <Room key={room.id} room={room} status={roomStatus[room.id]} hovered={hovered} onHover={onHover} onClick={onRoomClick} />
      ))}
    </FloorSvg>
  );
}

export const P1_ROOMS = roomListFrom(ROOMS);
