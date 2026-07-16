import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ComponentType } from 'react';
import type { Classroom, ClassroomCategory, ClassroomSummary, Operator } from '../../types';
import { fetchClassroomCategories, fetchClassrooms } from '../../services/classroomsApi';
import { ClassroomInfoPanel } from './ClassroomInfoPanel';
import { ClassroomCategoryManager } from './ClassroomCategoryManager';
import {
  ALL_FLOOR_ROOMS,
  FirstFloorModel,
  PrimerPisoModel,
  SecondFloorModel,
  type PrimerPisoModelProps
} from './models/PrimerPisoModel.jsx';
import {
  ND_ALL_FLOOR_ROOMS,
  NdArtesModel,
  NdInicialModel,
  NdPlantaBajaModel,
  NdPrimerPisoModel,
  NdSegundoPisoModel
} from './models/NordeltaModels.jsx';

type FloorKey = 'inicial' | 'planta' | 'primero' | 'segundo' | 'artes';
type RoomList = Array<{ roomKey: string; nombre: string; sector: string }>;
type FloorModelComp = ComponentType<PrimerPisoModelProps>;

interface FloorDef {
  key: FloorKey;
  label: string;
  piso: string;
  enabled: boolean;
  Model?: FloorModelComp;
}

interface SiteMaps {
  floors: FloorDef[];
  allRooms: Record<string, RoomList>;
}

// Configuración de plantas por sede. Cada aula del modelo SVG mapea a la tabla
// `classrooms` (particionada por site_code) mediante su room_key.
const SITE_MAPS: Record<string, SiteMaps> = {
  NFPT: {
    floors: [
      { key: 'planta', label: 'Planta baja', piso: 'Planta baja', enabled: true, Model: PrimerPisoModel },
      { key: 'primero', label: '1er piso', piso: '1er piso', enabled: true, Model: FirstFloorModel },
      { key: 'segundo', label: 'Segundo piso', piso: 'Segundo piso', enabled: true, Model: SecondFloorModel },
      { key: 'inicial', label: 'Nivel inicial', piso: 'Nivel inicial', enabled: false }
    ],
    allRooms: ALL_FLOOR_ROOMS
  },
  NFND: {
    floors: [
      { key: 'planta', label: 'Planta baja', piso: 'Planta baja', enabled: true, Model: NdPlantaBajaModel },
      { key: 'primero', label: '1er piso', piso: '1er piso', enabled: true, Model: NdPrimerPisoModel },
      { key: 'segundo', label: '2do piso', piso: '2do piso', enabled: true, Model: NdSegundoPisoModel },
      { key: 'inicial', label: 'Nivel inicial', piso: 'Nivel inicial', enabled: true, Model: NdInicialModel },
      { key: 'artes', label: 'SUM / Artes', piso: 'Artes', enabled: true, Model: NdArtesModel }
    ],
    allRooms: ND_ALL_FLOOR_ROOMS
  }
};

export function ClassroomStatusPage({ operator, consultationMode, activeSite }: { operator: Operator; consultationMode: boolean; activeSite: string }) {
  const siteMaps = SITE_MAPS[activeSite];
  const FLOORS = siteMaps?.floors || [];
  const [floor, setFloor] = useState<FloorKey>('planta');
  const [items, setItems] = useState<Classroom[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [selectedNombre, setSelectedNombre] = useState<string>('');
  const [message, setMessage] = useState('');
  const [categories, setCategories] = useState<ClassroomCategory[]>([]);
  const [canManageCategories, setCanManageCategories] = useState(false);
  const [categoryManagerOpen, setCategoryManagerOpen] = useState(false);

  const refresh = useCallback(async () => {
    if (!siteMaps) return;
    try {
      const [list, categoryResponse] = await Promise.all([fetchClassrooms(), fetchClassroomCategories()]);
      if (list.ok) setItems(list.items);
      setCategories(categoryResponse.items || []);
      setCanManageCategories(Boolean(categoryResponse.canManage));
    } catch { /* ignore */ }
  }, [siteMaps]);

  useEffect(() => { refresh(); }, [refresh]);

  const activeFloor = FLOORS.find(f => f.key === floor) || FLOORS[0];
  const activePiso = activeFloor?.piso;
  const floorRooms = siteMaps?.allRooms[floor] || [];
  const floorRoomKeys = useMemo(() => new Set(floorRooms.map(r => r.roomKey)), [floorRooms]);
  const floorItems = useMemo(() => items.filter(c => c.piso === activePiso || floorRoomKeys.has(c.roomKey)), [items, activePiso, floorRoomKeys]);

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
    setMessage('');
    setSelectedKey(roomKey);
    setSelectedNombre(nombre);
  };

  const handleClose = (saved = false) => {
    setSelectedKey(null);
    if (saved) setMessage('Cambios guardados.');
    refresh();
  };

  if (!siteMaps || !activeFloor) {
    return (
      <section className="view active">
        <div className="empty-state">Estado de aulas no configurado para esta sede.</div>
      </section>
    );
  }

  return (
    <section className="view active">
      <div className="classrooms-page">
        {message && <div className="tool-info">{message}</div>}
        <div className="classrooms-controls"><div className="classrooms-floor-selector">
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
        </div>{canManageCategories && <button className="btn" type="button" disabled={consultationMode} onClick={() => setCategoryManagerOpen(true)}>Administrar categorías</button>}</div>

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

        {activeFloor.enabled && activeFloor.Model ? (
          <div className="classroom-model-wrap">
            <div className="classroom-model-canvas">
              <activeFloor.Model statuses={statusMap} onRoomClick={handleRoomClick} />
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
          categories={categories}
          onClose={handleClose}
        />
      )}
      {categoryManagerOpen && <ClassroomCategoryManager categories={categories} onClose={() => setCategoryManagerOpen(false)} onChanged={refresh} />}
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
