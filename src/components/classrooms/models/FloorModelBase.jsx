/**
 * FloorModelBase.jsx
 * Renderer SVG genérico de planta (rect-based) compartido por los planos
 * esquemáticos de TechAsset (NFPT planta baja / 2do piso y todos los de NFND).
 *
 * Un "room" es { id, label, x, y, w, h, type, noClick?, polygon?, lx?, ly?, fontSize? }.
 * El color de cada aula clickeable se pisa con su estado (statuses[id].estadoGeneral).
 * Extraído desde PrimerPisoModel.jsx sin cambiar el look para reutilizarlo en Nordelta.
 */
import { useState } from 'react';

export const TYPE_STYLE = {
  classroom: { fill: '#0d2347', stroke: '#1e56a0' },
  service: { fill: '#06122a', stroke: '#0e1e3a' },
  admin: { fill: '#0b2040', stroke: '#1a4a8a' },
  hall: { fill: '#081b36', stroke: '#123472' },
  stairs: { fill: '#132848', stroke: '#20509a' },
  patio: { fill: '#030b1a', stroke: '#091e3c' },
  special: { fill: '#0c2348', stroke: '#1a4896' },
  corridor: { fill: '#010609', stroke: '#050e1a' }
};

export const STATUS_COLOR = {
  OK: { fill: 'rgba(34,197,94,0.22)', stroke: '#22c55e' },
  'Con observaciones': { fill: 'rgba(245,158,11,0.22)', stroke: '#f59e0b' },
  Problema: { fill: 'rgba(239,68,68,0.22)', stroke: '#ef4444' },
  'Sin revisar': null
};

export function canClick(room) {
  return !room.noClick && room.type !== 'patio' && room.type !== 'corridor' && Boolean(room.label);
}

export function toRoomList(rooms) {
  return rooms
    .filter(canClick)
    .map(r => ({ roomKey: r.id, nombre: r.label.replace('\n', ' '), sector: r.type }));
}

export function FloorModel({ rooms, viewBox, statuses = {}, onRoomClick, watermark }) {
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
