import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Classroom, ClassroomSummary, Operator } from '../../types';
import { fetchClassroomSummary, fetchClassrooms } from '../../services/classroomsApi';
import { ClassroomInfoPanel } from './ClassroomInfoPanel';
import { PrimerPisoModel, PRIMER_PISO_ROOMS } from './models/PrimerPisoModel.jsx';

type FloorKey = 'inicial' | 'planta' | 'primero' | 'segundo';

const FLOORS: Array<{ key: FloorKey; label: string; enabled: boolean }> = [
  { key: 'inicial', label: 'Nivel inicial', enabled: false },
  { key: 'planta', label: 'Planta baja', enabled: true },
  { key: 'primero', label: 'Primer piso', enabled: false },
  { key: 'segundo', label: 'Segundo piso', enabled: false }
];

export function ClassroomStatusPage({ operator, consultationMode }: { operator: Operator; consultationMode: boolean }) {
  const [floor, setFloor] = useState<FloorKey>('planta');
  const [items, setItems] = useState<Classroom[]>([]);
  const [summary, setSummary] = useState<ClassroomSummary | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [selectedNombre, setSelectedNombre] = useState<string>('');

  const refresh = useCallback(async () => {
    try {
      const [list, sum] = await Promise.all([fetchClassrooms(), fetchClassroomSummary()]);
      if (list.ok) setItems(list.items);
      if (sum.ok) setSummary(sum.summary);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const statusMap = useMemo(() => {
    const map: Record<string, { estadoGeneral: Classroom['estadoGeneral'] }> = {};
    items.forEach(c => { map[c.roomKey] = { estadoGeneral: c.estadoGeneral }; });
    return map;
  }, [items]);

  const handleRoomClick = (roomKey: string, nombre: string) => {
    setSelectedKey(roomKey);
    setSelectedNombre(nombre);
  };

  const handleClose = () => { setSelectedKey(null); refresh(); };

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

        {summary && (
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
        )}

        {floor === 'planta' ? (
          <div className="classroom-model-wrap">
            <div className="classroom-model-canvas">
              <PrimerPisoModel statuses={statusMap} onRoomClick={handleRoomClick} />
            </div>
            <details className="classroom-model-list">
              <summary>Ver lista de aulas</summary>
              <div className="classroom-model-list-grid">
                {PRIMER_PISO_ROOMS.map(r => {
                  const status = items.find(c => c.roomKey === r.roomKey);
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
            <div className="empty-state">Próximamente disponible.</div>
          </div>
        )}
      </div>

      {selectedKey && (
        <ClassroomInfoPanel
          roomKey={selectedKey}
          nombre={selectedNombre}
          piso="Planta baja"
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
