import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Classroom, ClassroomSummary, Operator } from '../../types';
import { fetchClassrooms } from '../../services/classroomsApi';
import { ClassroomInfoPanel } from './ClassroomInfoPanel';
import {
  ALL_FLOOR_ROOMS,
  FirstFloorModel,
  PrimerPisoModel,
  SecondFloorModel
} from './models/PrimerPisoModel.jsx';

type FloorKey = 'inicial' | 'planta' | 'primero' | 'segundo';

const FLOORS: Array<{ key: FloorKey; label: string; enabled: boolean; piso: string }> = [
  { key: 'planta', label: 'Planta baja', enabled: true, piso: 'Planta baja' },
  { key: 'primero', label: '1er piso', enabled: false, piso: '1er piso' },
  { key: 'segundo', label: 'Segundo piso', enabled: true, piso: 'Segundo piso' },
  { key: 'inicial', label: 'Nivel inicial', enabled: false, piso: 'Nivel inicial' }
];

export function ClassroomStatusPage({ operator, consultationMode, activeSite }: { operator: Operator; consultationMode: boolean; activeSite: string }) {
  const [floor, setFloor] = useState<FloorKey>('planta');
  const [items, setItems] = useState<Classroom[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [selectedNombre, setSelectedNombre] = useState<string>('');

  const refresh = useCallback(async () => {
    if (activeSite !== 'NFPT') return;
    try {
      const list = await fetchClassrooms();
      if (list.ok) setItems(list.items);
    } catch { /* ignore */ }
  }, [activeSite]);

  useEffect(() => { refresh(); }, [refresh]);

  const activeFloor = FLOORS.find(f => f.key === floor) || FLOORS[1];
  const floorRooms = ALL_FLOOR_ROOMS[floor] || [];
  const floorRoomKeys = useMemo(() => new Set(floorRooms.map(r => r.roomKey)), [floorRooms]);
  const floorItems = useMemo(() => items.filter(c => c.piso === activeFloor.piso || floorRoomKeys.has(c.roomKey)), [items, activeFloor.piso, floorRoomKeys]);

  const statusMap = useMemo(() => {
    const map: Record<string, { estadoGeneral: Classroom['estadoGeneral'] }> = {};
    floorItems.forEach(c => { map[c.roomKey] = { estadoGeneral: c.estadoGeneral }; });
    return map;
  }, [floorItems]);

  const summary = useMemo<ClassroomSummary>(() => {
    const rows = floorRooms.map(room => floorItems.find(c => c.roomKey === room.roomKey));
    const hasFault = (room: Classroom | undefined, key: string) => room?.equipment?.some(item => item.key === key && (item.state === 'Con falla' || item.state === 'En reparación')) || false;
    return {
      total: floorRooms.length,
      ok: rows.filter(r => r?.estadoGeneral === 'OK').length,
      observaciones: rows.filter(r => r?.estadoGeneral === 'Con observaciones').length,
      problema: rows.filter(r => r?.estadoGeneral === 'Problema').length,
      sinRevisar: rows.filter(r => !r || r.estadoGeneral === 'Sin revisar').length,
      proyectorFalla: rows.filter(r => hasFault(r, 'proyector')).length,
      nucFalla: rows.filter(r => hasFault(r, 'nuc')).length,
      monitorFalla: rows.filter(r => hasFault(r, 'monitor')).length
    };
  }, [floorItems, floorRooms]);

  const handleRoomClick = (roomKey: string, nombre: string) => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setSelectedKey(roomKey);
    setSelectedNombre(nombre);
  };

  const handleClose = () => { setSelectedKey(null); refresh(); };

  if (activeSite !== 'NFPT') {
    return (
      <section className="view active">
        <div className="empty-state">Estado de aulas no configurado para esta sede.</div>
      </section>
    );
  }

  return (
    <section className="view active">
      <div className="classrooms-page">
        <div className="classrooms-floor-selector">
          {FLOORS.map(f => (
            <button
              key={f.key}
              type="button"
              className={`floor-btn ${floor === f.key ? 'active' : ''} ${f.enabled ? '' : 'disabled'}`}
              onClick={() => f.enabled && setFloor(f.key)}
              disabled={!f.enabled}
              title={f.enabled ? f.label : 'Próximamente'}
            >
              <span>{f.label}</span>
              {!f.enabled && <small>Próximamente</small>}
            </button>
          ))}
        </div>

        <div className="classroom-summary-grid">
          <SummaryCard label="Total aulas" value={summary.total} />
          <SummaryCard label="Aulas OK" value={summary.ok} tone="ok" />
          <SummaryCard label="Con observaciones" value={summary.observaciones} tone="warn" />
          <SummaryCard label="Con problema" value={summary.problema} tone="bad" />
          <SummaryCard label="Sin revisar" value={summary.sinRevisar} tone="muted" />
          <SummaryCard label="Proyectores con falla" value={summary.proyectorFalla} tone="warn" />
          <SummaryCard label="NUC con falla" value={summary.nucFalla} tone="warn" />
          <SummaryCard label="Monitores con falla" value={summary.monitorFalla} tone="warn" />
        </div>

        {activeFloor.enabled ? (
          <div className="classroom-model-wrap">
            <div className="classroom-model-canvas">
              {floor === 'planta' && <PrimerPisoModel statuses={statusMap} onRoomClick={handleRoomClick} />}
              {floor === 'primero' && <FirstFloorModel statuses={statusMap} onRoomClick={handleRoomClick} />}
              {floor === 'segundo' && <SecondFloorModel statuses={statusMap} onRoomClick={handleRoomClick} />}
            </div>
            <details className="classroom-model-list">
              <summary>Ver lista de aulas</summary>
              <div className="classroom-model-list-grid">
                {floorRooms.map(r => {
                  const status = floorItems.find(c => c.roomKey === r.roomKey);
                  const estado = status?.estadoGeneral || 'Sin revisar';
                  return (
                    <button key={r.roomKey} type="button" className={`classroom-list-item estado-${normalize(estado)}`} onClick={() => handleRoomClick(r.roomKey, r.nombre)}>
                      <strong>{r.nombre}</strong>
                      <span>{estado}</span>
                    </button>
                  );
                })}
              </div>
            </details>
          </div>
        ) : (
          <div className="classroom-model-wrap">
            <div className="empty-state">{activeFloor.label} próximamente disponible.</div>
          </div>
        )}
      </div>

      {selectedKey && (
        <ClassroomInfoPanel
          roomKey={selectedKey}
          nombre={selectedNombre}
          piso={activeFloor.piso}
          operator={operator}
          consultationMode={consultationMode}
          onClose={handleClose}
        />
      )}
    </section>
  );
}

function normalize(s: string) {
  return s.toLowerCase().replace(/\s+/g, '-').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function SummaryCard({ label, value, tone }: { label: string; value: number; tone?: 'ok' | 'warn' | 'bad' | 'muted' }) {
  return (
    <div className={`stat-card classroom-stat ${tone || ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
