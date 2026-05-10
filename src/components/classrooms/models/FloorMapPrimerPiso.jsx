/**
 * FloorMapPrimerPiso.jsx
 * TechAsset – NFS | Plano interactivo SVG del Primer Piso (NFPT)
 *
 * Adaptación del archivo provisto por el usuario para integrarlo al
 * patrón de la app: acepta tanto `statuses` (formato app:
 * { [roomKey]: { estadoGeneral } }) como `roomStatuses` (formato interno),
 * y propaga `onRoomClick(roomId, nombre)`.
 */

import { useCallback, useMemo, useState } from 'react';

const C = {
  bg: '#03080f',
  planBg: '#060f1e',
  buildingFill: '#0a1628',
  corridorFill: '#060d1b',
  wall: '#0d2040',
  wallStroke: '#1a4a8a',
  wallGlow: '#2a7fff',
  classroom: '#0b1e3d',
  classroomHov: '#112850',
  special: '#091830',
  specialHov: '#0e2240',
  bathroom: '#080f22',
  corridor: '#060d1b',
  accent: '#00b4e6',
  accentDim: '#1a5a8a',
  glow: '#00d4ff',
  textPrimary: '#cce8ff',
  textSub: '#5a90c8',
  textTiny: '#2a5080',
  ok: { fill: '#091f14', stroke: '#15c877', label: 'OK' },
  warning: { fill: '#1f160a', stroke: '#e8a020', label: 'Atención' },
  problem: { fill: '#1f0a08', stroke: '#e03818', label: 'Falla' },
  unknown: { fill: '#10121a', stroke: '#404870', label: 'Sin dato' },
  default: { fill: '#0b1e3d', stroke: '#1a4a8a', label: '—' },
  selected: { fill: '#001a2e', stroke: '#00d4ff', label: 'Selected' }
};

const ROOMS = [
  { id: 'pp_Banos', label: 'BAÑOS', x: 0, y: 0, w: 165, h: 170, type: 'bathroom', desc: 'Baños Primer Piso', interactive: false },
  { id: 'pp_Direccion', label: 'Dirección', x: 0, y: 170, w: 165, h: 70, type: 'special', desc: 'Dirección' },
  { id: 'pp_DOE', label: 'DOE', x: 0, y: 240, w: 165, h: 135, type: 'special', interactive: false, desc: 'Departamento de Orientación Educativa' },

  { id: 'pp_2N', label: '2N', x: 165, y: 0, w: 130, h: 135, type: 'classroom', desc: '2do año N' },
  { id: 'pp_2F', label: '2F', x: 295, y: 0, w: 120, h: 135, type: 'classroom', desc: '2do año F' },
  { id: 'pp_2S', label: '2S', x: 415, y: 0, w: 120, h: 135, type: 'classroom', desc: '2do año S' },
  { id: 'pp_Precep', label: 'PRECEP', x: 535, y: 0, w: 130, h: 135, type: 'special', desc: 'Preceptoría Primer Piso' },
  { id: 'pp_3N', label: '3N', x: 665, y: 0, w: 120, h: 135, type: 'classroom', desc: '3er año N' },
  { id: 'pp_5S', label: '5S', x: 785, y: 0, w: 115, h: 135, type: 'classroom', desc: '5to año S' },
  { id: 'pp_5F', label: '5F', x: 900, y: 0, w: 120, h: 135, type: 'classroom', desc: '5to año F' },

  { id: 'pp_Escalera', label: 'PASILLO', x: 165, y: 210, w: 130, h: 165, type: 'corridor', interactive: false, desc: 'Pasillo / Circulación' },
  { id: 'pp_Lab', label: 'LAB', x: 295, y: 210, w: 120, h: 165, type: 'special', desc: 'Laboratorio' },
  { id: 'pp_Maker', label: 'MAKER', x: 415, y: 210, w: 120, h: 165, type: 'special', desc: 'Sala Maker' },
  { id: 'pp_SalaProfs', label: 'SALA\nPROFES', x: 535, y: 210, w: 70, h: 165, type: 'special', desc: 'Sala de Profesores', smallText: true },
  { id: 'pp_Pasillo', label: 'PASILLO', x: 605, y: 210, w: 60, h: 165, type: 'corridor', interactive: false, desc: 'Pasillo / Circulación', smallText: true },
  { id: 'pp_3F', label: '3F', x: 665, y: 210, w: 120, h: 165, type: 'classroom', desc: '3er año F' },
  { id: 'pp_6F', label: '6F', x: 785, y: 210, w: 115, h: 165, type: 'classroom', desc: '6to año F' },
  { id: 'pp_6N', label: '6N', x: 900, y: 210, w: 120, h: 165, type: 'classroom', desc: '6to año N' },

  { id: 'pp_1F', label: '1F', x: 0, y: 420, w: 165, h: 130, type: 'classroom', desc: '1er año F' },
  { id: 'pp_1N', label: '1N', x: 0, y: 550, w: 165, h: 130, type: 'classroom', desc: '1er año N' },
  { id: 'pp_6F2', label: '6F (T)', x: 0, y: 680, w: 165, h: 150, type: 'classroom', desc: '6to año F (turno tarde)' },

  { id: 'pp_TIC', label: 'TIC', x: 182, y: 420, w: 158, h: 95, type: 'team', interactive: false, desc: 'Sala TIC · TechAsset NFS · home base' },
  { id: 'pp_1S', label: '1S', x: 182, y: 515, w: 158, h: 120, type: 'classroom', desc: '1er año S' },
  { id: 'pp_6S', label: '6S', x: 182, y: 635, w: 158, h: 100, type: 'classroom', desc: '6to año S' },
  { id: 'pp_6N2', label: '6N (T)', x: 182, y: 735, w: 158, h: 95, type: 'classroom', desc: '6to año N (turno tarde)' }
];

const TYPE_STYLE = {
  classroom: { fill: '#0b1e3d', stroke: '#1a4a8a' },
  special: { fill: '#091830', stroke: '#164080' },
  bathroom: { fill: '#080f22', stroke: '#12305a' },
  corridor: { fill: '#060d1b', stroke: '#0f2a50' },
  team: { fill: '#062838', stroke: '#00d4ff' }
};

// Mapeo del estado de la app al estado interno del plano.
const APP_TO_PLAN_STATUS = {
  'OK': 'ok',
  'Con observaciones': 'warning',
  'Problema': 'problem',
  'Sin revisar': 'default'
};

function normalizeStatuses(statuses, roomStatuses) {
  // `roomStatuses` (formato interno) tiene prioridad si llega.
  if (roomStatuses && Object.keys(roomStatuses).length) return roomStatuses;
  if (!statuses) return {};
  const out = {};
  Object.entries(statuses).forEach(([key, value]) => {
    const estado = value && typeof value === 'object' ? value.estadoGeneral : value;
    const mapped = APP_TO_PLAN_STATUS[estado];
    if (mapped) out[key] = mapped;
  });
  return out;
}

function getRoomStyle(room, statuses, hoveredId, selectedRoom) {
  const base = TYPE_STYLE[room.type] ?? TYPE_STYLE.classroom;
  if (room.interactive === false) {
    return { fill: base.fill, stroke: base.stroke, sw: room.type === 'team' ? 2 : 1.5, opacity: 1 };
  }
  const isSelected = selectedRoom === room.id;
  const isHovered = hoveredId === room.id;
  const status = statuses?.[room.id] ?? 'default';
  if (isSelected) return { fill: C.selected.fill, stroke: C.glow, sw: 2.5, opacity: 1 };
  const stColor = C[status] ?? C.default;
  return {
    fill: status !== 'default' ? stColor.fill : isHovered ? (room.type === 'classroom' ? C.classroomHov : C.specialHov) : base.fill,
    stroke: status !== 'default' ? stColor.stroke : isHovered ? C.accent : base.stroke,
    sw: isHovered || isSelected ? 2 : 1.5,
    opacity: 1
  };
}

function Room({ room, statuses, hoveredId, selectedRoom, onHover, onClick }) {
  const style = getRoomStyle(room, statuses, hoveredId, selectedRoom);
  const isInteractive = room.interactive !== false;
  const isHov = isInteractive && hoveredId === room.id;
  const isSel = isInteractive && selectedRoom === room.id;
  const isTeam = room.type === 'team';
  const cx = room.x + room.w / 2;
  const cy = room.y + room.h / 2;

  const lines = String(room.label || '').split('\n');
  const fontSize = room.smallText ? 8 : room.w < 90 ? 10 : 13;
  const lineH = fontSize + 2;
  const labelColor = isHov || isSel ? C.glow : isTeam ? '#00d4ff' : !isInteractive ? '#3a5a82' : C.textPrimary;

  const interactionProps = isInteractive
    ? {
        style: { cursor: 'pointer' },
        onMouseEnter: () => onHover(room.id),
        onMouseLeave: () => onHover(null),
        onClick: () => onClick(room.id)
      }
    : { style: { pointerEvents: 'none' } };

  return (
    <g {...interactionProps}>
      {(isHov || isSel) && (
        <rect
          x={room.x - 3} y={room.y - 3}
          width={room.w + 6} height={room.h + 6}
          rx={4} fill="none"
          stroke={isSel ? C.glow : C.accent}
          strokeWidth={isSel ? 3 : 2}
          opacity={isSel ? 0.9 : 0.5}
          filter="url(#fpGlow)"
        />
      )}
      {isTeam && (
        <rect
          x={room.x - 2} y={room.y - 2}
          width={room.w + 4} height={room.h + 4}
          rx={3} fill="none"
          stroke="#00d4ff" strokeWidth={1} opacity={0.35}
          filter="url(#fpGlow)"
        />
      )}
      <rect
        x={room.x} y={room.y}
        width={room.w} height={room.h}
        rx={2}
        fill={style.fill} stroke={style.stroke} strokeWidth={style.sw}
      />
      {room.type !== 'corridor' && (
        <rect
          x={room.x + 2} y={room.y + 2}
          width={room.w - 4} height={3}
          rx={1} fill={style.stroke}
          opacity={isTeam ? 0.85 : 0.5}
        />
      )}
      {isTeam && (
        <text
          x={room.x + room.w - 10} y={room.y + 12}
          textAnchor="middle" dominantBaseline="middle"
          fill="#00d4ff" fontSize={9}
          fontFamily="'JetBrains Mono', monospace"
          style={{ userSelect: 'none', pointerEvents: 'none' }}
        >◆</text>
      )}
      {lines.map((line, i) => (
        <text
          key={i}
          x={cx}
          y={cy + (i - (lines.length - 1) / 2) * lineH}
          textAnchor="middle" dominantBaseline="middle"
          fill={labelColor} fontSize={fontSize}
          fontFamily="'JetBrains Mono', 'Fira Code', monospace"
          fontWeight={isHov || isSel || isTeam ? 700 : 500}
          letterSpacing={room.smallText ? '0' : '0.5'}
          style={{ userSelect: 'none', pointerEvents: 'none' }}
        >{line}</text>
      ))}
      {isTeam && (
        <text
          x={cx} y={cy + 12}
          textAnchor="middle" dominantBaseline="middle"
          fill="#0099b8" fontSize={6}
          fontFamily="'JetBrains Mono', monospace"
          letterSpacing={1.5}
          style={{ userSelect: 'none', pointerEvents: 'none' }}
        >TECHASSET · NFS</text>
      )}
      {statuses?.[room.id] && statuses[room.id] !== 'default' && (
        <circle
          cx={room.x + room.w - 8} cy={room.y + 8}
          r={4}
          fill={(C[statuses[room.id]] ?? C.default).stroke}
          opacity={0.95}
        />
      )}
    </g>
  );
}

export default function FloorMapPrimerPiso({
  onRoomClick = () => {},
  statuses,
  roomStatuses,
  selectedRoom = null
}) {
  const [hoveredId, setHoveredId] = useState(null);

  const planStatuses = useMemo(() => normalizeStatuses(statuses, roomStatuses), [statuses, roomStatuses]);
  const handleHover = useCallback(id => setHoveredId(id), []);
  const handleClick = useCallback(id => {
    const room = ROOMS.find(r => r.id === id);
    if (room) onRoomClick(id, String(room.label || '').replace('\n', ' '));
  }, [onRoomClick]);

  const SVG_W = 1020;
  const SVG_H = 830;

  return (
    <svg viewBox={`0 0 ${SVG_W} ${SVG_H}`} preserveAspectRatio="xMidYMid meet" style={{ width: '100%', height: '100%', display: 'block' }} xmlns="http://www.w3.org/2000/svg">
      <defs>
        <filter id="fpGlow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="4" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <pattern id="fpGrid" width="20" height="20" patternUnits="userSpaceOnUse">
          <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#0d2040" strokeWidth="0.5" opacity="0.4" />
        </pattern>
      </defs>

      <rect width={SVG_W} height={SVG_H} fill={C.planBg} />
      <rect width={SVG_W} height={SVG_H} fill="url(#fpGrid)" />

      <rect x={0} y={0} width={SVG_W} height={375} fill={C.buildingFill} stroke={C.wallGlow} strokeWidth={2} />
      <rect x={0} y={375} width={340} height={455} fill={C.buildingFill} stroke={C.wallGlow} strokeWidth={2} />

      <rect x={165} y={135} width={855} height={75} fill={C.corridorFill} stroke="none" />
      <text x={165 + 855 / 2} y={172} textAnchor="middle" dominantBaseline="middle" fill={C.textTiny} fontSize={9} fontFamily="'JetBrains Mono', monospace" letterSpacing={3} style={{ userSelect: 'none' }}>─── PASILLO / CIRCULACIÓN ───</text>

      <rect x={0} y={375} width={340} height={45} fill={C.planBg} stroke="none" />

      <text x={680} y={500} textAnchor="middle" fill={C.textTiny} fontSize={70} fontFamily="'JetBrains Mono', monospace" fontWeight="900" letterSpacing={10} opacity={0.06} style={{ userSelect: 'none' }}>1° PISO</text>

      {ROOMS.map(room => (
        <Room
          key={room.id}
          room={room}
          statuses={planStatuses}
          hoveredId={hoveredId}
          selectedRoom={selectedRoom}
          onHover={handleHover}
          onClick={handleClick}
        />
      ))}
    </svg>
  );
}

export { ROOMS };
