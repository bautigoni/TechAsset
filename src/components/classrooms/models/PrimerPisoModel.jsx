import { useState } from 'react';

// Modelo del Primer Piso (basado en TechAsset_PlantaBaja.jsx)
// Adaptado para integrarse con el flujo Estado aulas: cada aula clickeable dispara onRoomClick(roomKey).
// El color del aula refleja `estadoGeneral` recibido en `statuses` (mapa por roomKey).

const ROOMS = [
  { id: 'room_Banos_1', label: 'Baños', x: 0, y: 0, w: 108, h: 118, type: 'service', noClick: true },
  { id: 'room_Directores', label: 'Directores', x: 0, y: 118, w: 108, h: 52, type: 'admin' },
  { id: 'room_Salita', label: 'Administración', x: 0, y: 170, w: 108, h: 58, type: 'admin' },
  { id: 'room_Preceptoria_2', label: 'Prec. 2', x: 852, y: 0, w: 148, h: 30, type: 'admin' },
  { id: 'room_3ero_N', label: '3ero N', x: 112, y: 0, w: 148, h: 118, type: 'classroom' },
  { id: 'room_5to_N', label: '5to N', x: 260, y: 0, w: 148, h: 118, type: 'classroom' },
  { id: 'room_5to_F', label: '5to F', x: 408, y: 0, w: 148, h: 118, type: 'classroom' },
  { id: 'room_5to_S', label: '5to S', x: 556, y: 0, w: 148, h: 118, type: 'classroom' },
  { id: 'room_Drama', label: 'Drama', x: 704, y: 0, w: 148, h: 118, type: 'classroom' },
  { id: 'room_Musica', label: 'Música', x: 852, y: 30, w: 148, h: 88, type: 'classroom' },
  { id: 'room_3ero_F', label: '3ero F', x: 112, y: 150, w: 127, h: 110, type: 'classroom' },
  { id: 'room_3ero_S', label: '3ero S', x: 239, y: 150, w: 127, h: 110, type: 'classroom' },
  { id: 'room_4to_N', label: '4to N', x: 366, y: 150, w: 127, h: 110, type: 'classroom' },
  { id: 'room_4to_F', label: '4to F', x: 493, y: 150, w: 127, h: 110, type: 'classroom' },
  { id: 'room_4to_S', label: '4to S', x: 620, y: 150, w: 127, h: 110, type: 'classroom' },
  { id: 'room_Arte', label: 'Arte', x: 747, y: 150, w: 127, h: 110, type: 'classroom' },
  { id: 'room_Banos_2', label: 'Baños', x: 874, y: 150, w: 126, h: 110, type: 'service', noClick: true },
  { id: 'room_Hall_Entrada', label: 'Hall\n+ Entrada', x: 0, y: 228, w: 108, h: 232, type: 'hall' },
  { id: 'room_Escalera', label: 'Escalera', x: 140, y: 260, w: 94, h: 80, type: 'stairs' },
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
  { id: 'room_Patio_Primaria', label: 'Patio Primaria', x: 234, y: 260, w: 766, h: 572, type: 'patio' },
  { id: 'room_Kiosco', label: 'Kiosco', x: 0, y: 832, w: 108, h: 76, type: 'service', noClick: true },
  { id: 'room_Front', label: 'Front', x: 0, y: 908, w: 108, h: 84, type: 'service' },
  { id: 'room_Zoom', label: 'Zoom', x: 112, y: 892, w: 390, h: 190, type: 'special' },
  { id: 'room_Comedor', label: 'Comedor', x: 546, y: 832, w: 294, h: 250, type: 'special', noClick: true },
  { id: 'room_Zoom_exit', label: '', x: 225, y: 1082, w: 115, h: 60, type: 'special', noClick: true }
];

const T = {
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
  'OK': { fill: 'rgba(34,197,94,0.22)', stroke: '#22c55e' },
  'Con observaciones': { fill: 'rgba(245,158,11,0.22)', stroke: '#f59e0b' },
  'Problema': { fill: 'rgba(239,68,68,0.22)', stroke: '#ef4444' },
  'Sin revisar': null
};

export function PrimerPisoModel({ statuses = {}, onRoomClick }) {
  const [hovered, setHovered] = useState(null);

  const canClick = r => !r.noClick && r.type !== 'patio' && r.type !== 'corridor' && Boolean(r.label);

  const getFill = r => {
    const status = statuses[r.id]?.estadoGeneral;
    if (canClick(r) && status && STATUS_COLOR[status]) return STATUS_COLOR[status].fill;
    if (r.id === hovered && canClick(r)) return '#142e5e';
    return T[r.type]?.fill;
  };
  const getStroke = r => {
    const status = statuses[r.id]?.estadoGeneral;
    if (canClick(r) && status && STATUS_COLOR[status]) return STATUS_COLOR[status].stroke;
    if (r.id === hovered && canClick(r)) return '#3a90d4';
    return T[r.type]?.stroke;
  };

  return (
    <svg viewBox="0 0 1000 1150" preserveAspectRatio="xMidYMid meet" style={{ width: '100%', height: '100%', display: 'block' }}>
      <defs>
        <pattern id="pgrid" x="0" y="0" width="38" height="38" patternUnits="userSpaceOnUse">
          <path d="M38 0L0 0 0 38" fill="none" stroke="#071630" strokeWidth="0.5" />
        </pattern>
        <pattern id="cpat" x="0" y="0" width="10" height="10" patternUnits="userSpaceOnUse">
          <line x1="-1" y1="1" x2="1" y2="-1" stroke="#071422" strokeWidth="0.7" />
          <line x1="0" y1="10" x2="10" y2="0" stroke="#071422" strokeWidth="0.7" />
          <line x1="9" y1="11" x2="11" y2="9" stroke="#071422" strokeWidth="0.7" />
        </pattern>
      </defs>

      {ROOMS.map(r => {
        const status = statuses[r.id];
        const titleText = canClick(r) ? `${r.label.replace('\n', ' ')}${status ? ' · ' + status.estadoGeneral : ''}` : '';
        return (
          <g
            key={r.id}
            onClick={() => canClick(r) && onRoomClick && onRoomClick(r.id, r.label.replace('\n', ' '))}
            onMouseEnter={() => setHovered(r.id)}
            onMouseLeave={() => setHovered(null)}
            style={{ cursor: canClick(r) ? 'pointer' : 'default' }}
          >
            {titleText && <title>{titleText}</title>}
            <rect
              x={r.x + 0.5} y={r.y + 0.5} width={r.w - 1} height={r.h - 1} rx={1.5}
              fill={getFill(r)} stroke={getStroke(r)} strokeWidth={r.id === hovered && canClick(r) ? 2 : 0.8}
            />
            {r.type === 'patio' && <rect x={r.x + 0.5} y={r.y + 0.5} width={r.w - 1} height={r.h - 1} fill="url(#pgrid)" pointerEvents="none" />}
            {r.type === 'corridor' && <rect x={r.x + 0.5} y={r.y + 0.5} width={r.w - 1} height={r.h - 1} fill="url(#cpat)" pointerEvents="none" />}
            {r.label && (
              <text
                x={r.x + r.w / 2} y={r.y + r.h / 2}
                textAnchor="middle" dominantBaseline="middle"
                fontSize={r.type === 'patio' ? 22 : r.h < 35 ? 7 : (r.label.replace('\n', '').length > 12 ? 8 : (r.w < 90 || r.h < 65 ? 9 : 12))}
                fill={r.type === 'patio' ? 'rgba(40,100,170,0.28)' : r.noClick ? '#1e3850' : '#5a9ecc'}
                fontFamily="'Courier New',Courier,monospace"
                pointerEvents="none"
              >
                {r.label.split('\n').map((l, i) => (
                  <tspan key={i} x={r.x + r.w / 2} dy={i === 0 ? 0 : 14}>{l}</tspan>
                ))}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

export const PRIMER_PISO_ROOMS = ROOMS
  .filter(r => !r.noClick && r.type !== 'patio' && r.type !== 'corridor' && r.label)
  .map(r => ({ roomKey: r.id, nombre: r.label.replace('\n', ' '), sector: r.type }));
