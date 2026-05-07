import { useState } from 'react';

const PLANTA_BAJA_ROOMS = [
  { id: 'room_Banos_1', label: 'Banos', x: 0, y: 0, w: 108, h: 118, type: 'service', noClick: true },
  { id: 'room_Directores', label: 'Directores', x: 0, y: 118, w: 108, h: 52, type: 'admin', noClick: true },
  { id: 'room_Salita', label: 'Administracion', x: 0, y: 170, w: 108, h: 58, type: 'admin', noClick: true },
  { id: 'room_Preceptoria_2', label: 'Prec. 2', x: 852, y: 0, w: 148, h: 30, type: 'admin', noClick: true },
  { id: 'room_3ero_N', label: '3ero N', x: 112, y: 0, w: 148, h: 118, type: 'classroom' },
  { id: 'room_5to_N', label: '5to N', x: 260, y: 0, w: 148, h: 118, type: 'classroom' },
  { id: 'room_5to_F', label: '5to F', x: 408, y: 0, w: 148, h: 118, type: 'classroom' },
  { id: 'room_5to_S', label: '5to S', x: 556, y: 0, w: 148, h: 118, type: 'classroom' },
  { id: 'room_Drama', label: 'Drama', x: 704, y: 0, w: 148, h: 118, type: 'classroom', noClick: true },
  { id: 'room_Musica', label: 'Musica', x: 852, y: 30, w: 148, h: 88, type: 'classroom', noClick: true },
  { id: 'room_3ero_F', label: '3ero F', x: 112, y: 150, w: 127, h: 110, type: 'classroom' },
  { id: 'room_3ero_S', label: '3ero S', x: 239, y: 150, w: 127, h: 110, type: 'classroom' },
  { id: 'room_4to_N', label: '4to N', x: 366, y: 150, w: 127, h: 110, type: 'classroom' },
  { id: 'room_4to_F', label: '4to F', x: 493, y: 150, w: 127, h: 110, type: 'classroom' },
  { id: 'room_4to_S', label: '4to S', x: 620, y: 150, w: 127, h: 110, type: 'classroom' },
  { id: 'room_Arte', label: 'Arte', x: 747, y: 150, w: 127, h: 110, type: 'classroom' },
  { id: 'room_Banos_2', label: 'Banos', x: 874, y: 150, w: 126, h: 110, type: 'service', noClick: true },
  { id: 'room_Hall_Entrada', label: 'Hall\n+ Entrada', x: 0, y: 228, w: 108, h: 232, type: 'hall', noClick: true },
  { id: 'room_Escalera', label: 'Escalera', x: 140, y: 260, w: 94, h: 80, type: 'stairs', noClick: true },
  { id: 'room_2do_N', label: '2do N', x: 0, y: 460, w: 108, h: 115, type: 'classroom' },
  { id: 'room_2do_F', label: '2do F', x: 0, y: 575, w: 108, h: 115, type: 'classroom' },
  { id: 'room_2do_S', label: '2do S', x: 0, y: 690, w: 108, h: 115, type: 'classroom' },
  { id: 'room_1ero_N', label: '1ero N', x: 140, y: 460, w: 94, h: 115, type: 'classroom' },
  { id: 'room_1ero_F', label: '1ero F', x: 140, y: 575, w: 94, h: 115, type: 'classroom' },
  { id: 'room_1ero_S', label: '1ero S', x: 140, y: 690, w: 94, h: 115, type: 'classroom' },
  { id: 'pasillo_horiz', label: '', x: 108, y: 118, w: 892, h: 32, type: 'corridor', noClick: true },
  { id: 'pasillo_col', label: '', x: 108, y: 118, w: 32, h: 687, type: 'corridor', noClick: true },
  { id: 'pasillo_pre1ero', label: '', x: 140, y: 340, w: 94, h: 120, type: 'corridor', noClick: true },
  { id: 'pasillo_zoom_com', label: '', x: 502, y: 832, w: 44, h: 250, type: 'corridor', noClick: true },
  { id: 'room_Patio_Primaria', label: 'Patio Primaria', x: 234, y: 260, w: 766, h: 572, type: 'patio', noClick: true },
  { id: 'room_Kiosco', label: 'Kiosco', x: 0, y: 832, w: 108, h: 76, type: 'service', noClick: true },
  { id: 'room_Front', label: 'Front', x: 0, y: 908, w: 108, h: 84, type: 'service', noClick: true },
  { id: 'room_Zoom', label: 'Zoom', x: 112, y: 892, w: 390, h: 190, type: 'special' },
  { id: 'room_Comedor', label: 'Comedor', x: 546, y: 832, w: 294, h: 250, type: 'special', noClick: true },
  { id: 'room_Zoom_exit', label: '', x: 225, y: 1082, w: 115, h: 60, type: 'special', noClick: true }
];

const PRIMER_PISO_LAYOUT = [
  { id: 'sector_1er_piso', label: '1er piso', polygon: '0,0 980,0 980,230 830,230 830,320 380,320 380,830 0,830', type: 'hall', noClick: true, lx: 440, ly: 170, fontSize: 24 },
  { id: 'escalera_1er_piso', label: 'Escalera', polygon: '700,320 700,430 980,430 980,230 830,230 830,320', type: 'stairs', noClick: true, lx: 840, ly: 380, fontSize: 13 },
  { id: 'pasillo_precep_1er_piso', label: 'Pasillo / precep', x: 980, y: 140, w: 190, h: 90, type: 'admin', noClick: true },
  { id: '4N', label: '4N', x: 980, y: 0, w: 190, h: 140, type: 'classroom' },
  { id: '4F', label: '4F', x: 1170, y: 0, w: 150, h: 140, type: 'classroom' },
  { id: '4S', label: '4S', x: 1170, y: 140, w: 150, h: 180, type: 'classroom' },
  { id: '3S', label: '3S', x: 980, y: 230, w: 190, h: 90, type: 'classroom' }
];

const TYPE_STYLE = {
  classroom: { fill: '#0d2347', stroke: '#1e56a0' },
  service: { fill: '#06122a', stroke: '#0e1e3a' },
  admin: { fill: '#0b2040', stroke: '#1a4a8a' },
  hall: { fill: '#081b36', stroke: '#123472' },
  stairs: { fill: '#132848', stroke: '#20509a' },
  patio: { fill: '#030b1a', stroke: '#091e3c' },
  special: { fill: '#0c2348', stroke: '#1a4896' },
  corridor: { fill: '#010609', stroke: '#050e1a' }
};

const STATUS_COLOR = {
  OK: { fill: 'rgba(34,197,94,0.22)', stroke: '#22c55e' },
  'Con observaciones': { fill: 'rgba(245,158,11,0.22)', stroke: '#f59e0b' },
  Problema: { fill: 'rgba(239,68,68,0.22)', stroke: '#ef4444' },
  'Sin revisar': null
};

function canClick(room) {
  return !room.noClick && room.type !== 'patio' && room.type !== 'corridor' && Boolean(room.label);
}

function toRoomList(rooms) {
  return rooms
    .filter(canClick)
    .map(r => ({ roomKey: r.id, nombre: r.label.replace('\n', ' '), sector: r.type }));
}

function FloorModel({ rooms, viewBox, statuses = {}, onRoomClick, watermark }) {
  const [hovered, setHovered] = useState(null);
  const patternSuffix = viewBox.replace(/\W+/g, '-');

  const getFill = room => {
    const status = statuses[room.id]?.estadoGeneral;
    if (canClick(room) && status && STATUS_COLOR[status]) return STATUS_COLOR[status].fill;
    if (room.id === hovered && canClick(room)) return '#142e5e';
    return TYPE_STYLE[room.type]?.fill || TYPE_STYLE.classroom.fill;
  };

  const getStroke = room => {
    const status = statuses[room.id]?.estadoGeneral;
    if (canClick(room) && status && STATUS_COLOR[status]) return STATUS_COLOR[status].stroke;
    if (room.id === hovered && canClick(room)) return '#3a90d4';
    return TYPE_STYLE[room.type]?.stroke || TYPE_STYLE.classroom.stroke;
  };

  return (
    <svg viewBox={viewBox} preserveAspectRatio="xMidYMid meet" style={{ width: '100%', height: '100%', display: 'block' }}>
      <defs>
        <pattern id={`pgrid-${patternSuffix}`} x="0" y="0" width="38" height="38" patternUnits="userSpaceOnUse">
          <path d="M38 0L0 0 0 38" fill="none" stroke="#071630" strokeWidth="0.5" />
        </pattern>
        <pattern id={`cpat-${patternSuffix}`} x="0" y="0" width="10" height="10" patternUnits="userSpaceOnUse">
          <line x1="-1" y1="1" x2="1" y2="-1" stroke="#071422" strokeWidth="0.7" />
          <line x1="0" y1="10" x2="10" y2="0" stroke="#071422" strokeWidth="0.7" />
          <line x1="9" y1="11" x2="11" y2="9" stroke="#071422" strokeWidth="0.7" />
        </pattern>
      </defs>
      <rect x="0" y="0" width="100%" height="100%" fill="#030912" />
      {watermark && (
        <text x="50%" y="50%" textAnchor="middle" dominantBaseline="middle" fill="rgba(15,55,95,0.20)" fontSize="42" fontFamily="'Courier New',Courier,monospace" fontWeight="bold" letterSpacing="2" pointerEvents="none">
          {watermark}
        </text>
      )}

      {rooms.map(room => {
        const clickable = canClick(room);
        const status = statuses[room.id];
        const label = room.label || '';
        const titleText = clickable ? `${label.replace('\n', ' ')}${status ? ' · ' + status.estadoGeneral : ''}` : '';
        const labelX = room.polygon ? room.lx : room.x + room.w / 2;
        const labelY = room.polygon ? room.ly : room.y + room.h / 2;
        const labelSize = room.fontSize || (room.type === 'patio' ? 22 : room.h < 35 ? 7 : (label.replace('\n', '').length > 12 ? 8 : (room.w < 90 || room.h < 65 ? 9 : 12)));

        return (
          <g
            key={room.id}
            onClick={() => clickable && onRoomClick?.(room.id, label.replace('\n', ' '))}
            onMouseEnter={() => clickable && setHovered(room.id)}
            onMouseLeave={() => setHovered(null)}
            style={{ cursor: clickable ? 'pointer' : 'default' }}
          >
            {titleText && <title>{titleText}</title>}
            {room.polygon ? (
              <polygon points={room.polygon} fill={getFill(room)} stroke={getStroke(room)} strokeWidth={room.id === hovered && clickable ? 2 : 0.8} />
            ) : (
              <rect
                x={room.x + 0.5} y={room.y + 0.5} width={room.w - 1} height={room.h - 1} rx={1.5}
                fill={getFill(room)} stroke={getStroke(room)} strokeWidth={room.id === hovered && clickable ? 2 : 0.8}
              />
            )}
            {room.type === 'patio' && <rect x={room.x + 0.5} y={room.y + 0.5} width={room.w - 1} height={room.h - 1} fill={`url(#pgrid-${patternSuffix})`} pointerEvents="none" />}
            {room.type === 'corridor' && <rect x={room.x + 0.5} y={room.y + 0.5} width={room.w - 1} height={room.h - 1} fill={`url(#cpat-${patternSuffix})`} pointerEvents="none" />}
            {label && (
              <text
                x={labelX} y={labelY}
                textAnchor="middle" dominantBaseline="middle"
                fontSize={labelSize}
                fill={room.type === 'patio' ? 'rgba(40,100,170,0.28)' : room.noClick ? '#1e3850' : '#5a9ecc'}
                fontFamily="'Courier New',Courier,monospace"
                pointerEvents="none"
              >
                {label.split('\n').map((line, i) => (
                  <tspan key={i} x={labelX} dy={i === 0 ? 0 : labelSize + 3}>{line}</tspan>
                ))}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

export function PrimerPisoModel(props) {
  return <FloorModel rooms={PLANTA_BAJA_ROOMS} viewBox="0 0 1000 1150" watermark="Escuela Primaria · Planta Baja" {...props} />;
}

export function FirstFloorModel(props) {
  return <FloorModel rooms={[]} viewBox="0 0 1320 830" watermark="1er PISO" {...props} />;
}

export function SecondFloorModel(props) {
  return <FloorModel rooms={PRIMER_PISO_LAYOUT} viewBox="0 0 1320 830" watermark="2° PISO" {...props} />;
}

export const PRIMER_PISO_ROOMS = toRoomList(PLANTA_BAJA_ROOMS);
export const FIRST_FLOOR_ROOMS = [];
export const SECOND_FLOOR_ROOMS = toRoomList(PRIMER_PISO_LAYOUT);
export const ALL_FLOOR_ROOMS = {
  planta: PRIMER_PISO_ROOMS,
  primero: FIRST_FLOOR_ROOMS,
  segundo: SECOND_FLOOR_ROOMS
};
