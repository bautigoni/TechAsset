/**
 * NordeltaFloorKit.jsx
 * Primitivas compartidas de los planos dibujados a mano de Nordelta (NFND):
 * paleta, arco de puerta, escaleras, baños, aula interactiva y el wrapper SVG
 * (fondo + grilla + glow + marca de agua). Lo usan las plantas PB / 1° / 2°.
 *
 * Mismo lenguaje visual que el 1er piso de NFPT (FloorMapPrimerPiso).
 */
import { useCallback, useMemo, useState } from 'react';

export const C = {
  planBg: '#060f1e',
  body: '#0a1628',
  corridor: '#05101f',
  wall: '#12305a',
  wallGlow: '#2a7fff',
  room: '#0b1e3d',
  roomHov: '#122a52',
  special: '#0c2348',
  specialHov: '#123a68',
  service: '#080f22',
  admin: '#0a1a33',
  danger: '#2a0f14',
  dangerStroke: '#7a2530',
  stairs: '#0c1830',
  accent: '#00b4e6',
  glow: '#00d4ff',
  text: '#cce8ff',
  textSub: '#5a90c8',
  textTiny: '#284d80',
  ok: { fill: 'rgba(21,200,119,0.20)', stroke: '#15c877' },
  warning: { fill: 'rgba(232,160,32,0.20)', stroke: '#e8a020' },
  problem: { fill: 'rgba(224,56,24,0.20)', stroke: '#e03818' }
};

export const APP_TO_STATUS = {
  OK: 'ok',
  'Con observaciones': 'warning',
  Problema: 'problem',
  'Sin revisar': null
};

export function doorPath(door, room) {
  if (!door) return null;
  const r = 15;
  const { side, at = 0.5 } = door;
  if (side === 'bottom') { const px = room.x + room.w * at, py = room.y + room.h; return `M ${px - r} ${py} A ${r} ${r} 0 0 0 ${px} ${py - r}`; }
  if (side === 'top') { const px = room.x + room.w * at, py = room.y; return `M ${px - r} ${py} A ${r} ${r} 0 0 1 ${px} ${py + r}`; }
  if (side === 'left') { const px = room.x, py = room.y + room.h * at; return `M ${px} ${py - r} A ${r} ${r} 0 0 0 ${px + r} ${py}`; }
  const px = room.x + room.w, py = room.y + room.h * at; return `M ${px} ${py - r} A ${r} ${r} 0 0 1 ${px - r} ${py}`;
}

export function Stair({ s }) {
  const lines = [];
  for (let i = 1; i < s.steps; i += 1) {
    if (s.dir === 'h') {
      const x = s.x + (s.w / s.steps) * i;
      lines.push(<line key={i} x1={x} y1={s.y + 3} x2={x} y2={s.y + s.h - 3} stroke={C.wall} strokeWidth={1} />);
    } else {
      const y = s.y + (s.h / s.steps) * i;
      lines.push(<line key={i} x1={s.x + 3} y1={y} x2={s.x + s.w - 3} y2={y} stroke={C.wall} strokeWidth={1} />);
    }
  }
  return (
    <g style={{ pointerEvents: 'none' }}>
      <rect x={s.x} y={s.y} width={s.w} height={s.h} rx={2} fill={C.stairs} stroke={C.wall} strokeWidth={1.5} />
      {lines}
    </g>
  );
}

export function Bath({ b }) {
  const fx = [];
  const cols = b.cols || 3;
  const fw = 14, fh = 10, gap = (b.w - 16 - cols * fw) / (cols - 1);
  for (let i = 0; i < cols; i += 1) {
    fx.push(<rect key={i} x={b.x + 8 + i * (fw + gap)} y={b.y + b.h - fh - 8} width={fw} height={fh} rx={2} fill="none" stroke={C.wall} strokeWidth={1} />);
  }
  return (
    <g style={{ pointerEvents: 'none' }}>
      <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={2} fill={C.service} stroke={C.wall} strokeWidth={1.5} />
      {fx}
      <text x={b.x + b.w / 2} y={b.y + 20} textAnchor="middle" fill={C.textTiny} fontSize={11} fontFamily="'JetBrains Mono', monospace" letterSpacing={1} style={{ userSelect: 'none' }}>{b.label || 'Baños'}</text>
    </g>
  );
}

// Bloque etiquetado no interactivo (dirección, staff, etc.).
function StaticBlock({ room }) {
  const isDanger = room.tone === 'danger';
  const vertical = room.h > room.w * 1.6;
  return (
    <g style={{ pointerEvents: 'none' }}>
      <rect
        x={room.x} y={room.y} width={room.w} height={room.h} rx={2.5}
        fill={isDanger ? C.danger : C.admin}
        stroke={isDanger ? C.dangerStroke : C.wall}
        strokeWidth={1.5}
        strokeDasharray={room.dashed ? '5 4' : undefined}
      />
      <text
        x={room.x + room.w / 2} y={room.y + room.h / 2}
        textAnchor="middle" dominantBaseline="middle"
        fill={isDanger ? '#e08a92' : C.textSub}
        fontSize={room.w < 70 ? 9 : 10}
        fontFamily="'JetBrains Mono', monospace"
        transform={vertical ? `rotate(-90 ${room.x + room.w / 2} ${room.y + room.h / 2})` : undefined}
        style={{ userSelect: 'none' }}
      >{room.label}</text>
    </g>
  );
}

export function Room({ room, status, hovered, onHover, onClick }) {
  if (room.noClick) return <StaticBlock room={room} />;

  const st = status ? (C[status] ?? null) : null;
  const isHov = hovered === room.id;
  const base = room.type === 'special' ? C.special : C.room;
  const baseHov = room.type === 'special' ? C.specialHov : C.roomHov;
  const fill = st ? st.fill : isHov ? baseHov : base;
  const stroke = st ? st.stroke : isHov ? C.accent : C.wall;
  const cx = room.x + room.w / 2;
  const cy = room.y + room.h / 2;
  const door = doorPath(room.door, room);

  return (
    <g
      style={{ cursor: 'pointer' }}
      onMouseEnter={() => onHover(room.id)}
      onMouseLeave={() => onHover(null)}
      onClick={() => onClick(room.id, room.label)}
    >
      <title>{`${room.label}${status ? ' · ' + Object.keys(APP_TO_STATUS).find(k => APP_TO_STATUS[k] === status) : ''}`}</title>
      {isHov && (
        <rect x={room.x - 3} y={room.y - 3} width={room.w + 6} height={room.h + 6} rx={4} fill="none" stroke={C.accent} strokeWidth={2} opacity={0.5} filter="url(#ndFloorGlow)" />
      )}
      <rect x={room.x} y={room.y} width={room.w} height={room.h} rx={2.5} fill={fill} stroke={stroke} strokeWidth={isHov ? 2 : 1.5} />
      <rect x={room.x + 3} y={room.y + 3} width={room.w - 6} height={3} rx={1} fill={stroke} opacity={0.5} />
      {door && <path d={door} fill="none" stroke={C.accent} strokeWidth={1.2} opacity={0.55} />}
      <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle" fill={isHov ? C.glow : C.text} fontSize={room.w < 96 ? 12 : 13} fontFamily="'JetBrains Mono', 'Fira Code', monospace" fontWeight={isHov ? 700 : 600} style={{ userSelect: 'none', pointerEvents: 'none' }}>{room.label}</text>
      {st && <circle cx={room.x + room.w - 9} cy={room.y + 9} r={4.5} fill={st.stroke} opacity={0.95} style={{ pointerEvents: 'none' }} />}
    </g>
  );
}

// Wrapper SVG: defs (glow, grilla, hatch), fondo, grilla y marca de agua.
export function FloorSvg({ viewBox, watermark, children }) {
  const [, , w, h] = viewBox.split(' ').map(Number);
  return (
    <svg viewBox={viewBox} preserveAspectRatio="xMidYMid meet" style={{ width: '100%', height: '100%', display: 'block' }} xmlns="http://www.w3.org/2000/svg">
      <defs>
        <filter id="ndFloorGlow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="4" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        <pattern id="ndFloorGrid" width="22" height="22" patternUnits="userSpaceOnUse">
          <path d="M 22 0 L 0 0 0 22" fill="none" stroke="#0d2040" strokeWidth="0.5" opacity="0.4" />
        </pattern>
        <pattern id="ndFloorHatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="8" stroke="#12305a" strokeWidth="1.4" />
        </pattern>
      </defs>
      <rect width={w} height={h} fill={C.planBg} />
      <rect width={w} height={h} fill="url(#ndFloorGrid)" />
      {watermark && (
        <text x={w / 2} y={h / 2} textAnchor="middle" fill={C.textTiny} fontSize={62} fontFamily="'JetBrains Mono', monospace" fontWeight="900" letterSpacing={8} opacity={0.05} style={{ userSelect: 'none' }}>{watermark}</text>
      )}
      {children}
    </svg>
  );
}

// Estado de hover + mapeo de estados de la app para un piso.
export function useFloorInteraction(statuses) {
  const [hovered, setHovered] = useState(null);
  const roomStatus = useMemo(() => {
    const out = {};
    Object.entries(statuses || {}).forEach(([id, v]) => {
      const estado = v && typeof v === 'object' ? v.estadoGeneral : v;
      const mapped = APP_TO_STATUS[estado];
      if (mapped) out[id] = mapped;
    });
    return out;
  }, [statuses]);
  const onHover = useCallback(id => setHovered(id), []);
  return { hovered, onHover, roomStatus };
}

// Lista de aulas clickeables (para el panel "Ver lista" y el resumen).
export function roomListFrom(rooms) {
  return rooms.filter(r => !r.noClick).map(r => ({ roomKey: r.id, nombre: r.label, sector: r.type }));
}

// Barra de circulación con etiqueta centrada.
export function Corridor({ x, y, w, h, label }) {
  return (
    <g style={{ pointerEvents: 'none' }}>
      <rect x={x} y={y} width={w} height={h} fill={C.corridor} />
      {label && <text x={x + w / 2} y={y + h / 2 + 3} textAnchor="middle" fill={C.textTiny} fontSize={8} fontFamily="'JetBrains Mono', monospace" letterSpacing={3} style={{ userSelect: 'none' }}>{label}</text>}
    </g>
  );
}
