import { useEffect, useState } from 'react';
import type { Classroom, ClassroomCategory, ClassroomEquipmentItem, ClassroomEquipmentKey, ClassroomGeneralState, ClassroomHistoryEntry, ClassroomIncident, ClassroomIncidentSummary, ClassroomItemState, Operator } from '../../types';
import { fetchClassroom, fetchClassroomHistory, fetchClassroomIncidents, updateClassroom } from '../../services/classroomsApi';
import { Button } from '../layout/Button';

const ITEM_STATES: ClassroomItemState[] = ['OK', 'Con falla', 'No tiene', 'En reparación', 'Sin revisar'];
const ITEM_COLORS: Record<ClassroomItemState, string> = {
  'OK': 'ok',
  'Con falla': 'warn',
  'No tiene': 'neutral',
  'En reparación': 'special',
  'Sin revisar': 'muted'
};

function migrateLegacyState(value: string | undefined): ClassroomItemState {
  if (value === 'No encontrado') return 'Con falla';
  if (value === 'OK' || value === 'Con falla' || value === 'No tiene' || value === 'En reparación' || value === 'Sin revisar') return value;
  return 'Sin revisar';
}

const DEFAULT_EQUIPMENT_OPTIONS: Array<{ key: ClassroomEquipmentKey; label: string; options?: ClassroomItemState[] }> = [
  { key: 'proyector', label: 'Proyector' },
  { key: 'nuc', label: 'NUC' },
  { key: 'monitor', label: 'Monitor' },
  { key: 'tecladoMouse', label: 'Teclado/Mouse' },
  { key: 'tele', label: 'Tele' },
  { key: 'notebook', label: 'Notebook' },
  { key: 'parlantes', label: 'Parlantes' },
  { key: 'conectividad', label: 'Conectividad' },
  { key: 'otro', label: 'Otro' }
];

const LEGACY_STATE_KEYS: Partial<Record<ClassroomEquipmentKey, keyof Pick<Classroom, 'proyector' | 'nuc' | 'monitor' | 'tecladoMouse'>>> = {
  proyector: 'proyector',
  nuc: 'nuc',
  monitor: 'monitor',
  tecladoMouse: 'tecladoMouse'
};

function getEquipment(item: Classroom, categories: Array<{ key: string; label: string }>): ClassroomEquipmentItem[] {
  if (Array.isArray(item.equipment) && item.equipment.length) return item.equipment;
  return (categories.length ? categories : DEFAULT_EQUIPMENT_OPTIONS).slice(0, 4).map(option => {
    const stateKey = LEGACY_STATE_KEYS[option.key];
    return {
      key: option.key,
      label: option.label,
      state: migrateLegacyState(stateKey ? item[stateKey] : 'Sin revisar')
    };
  });
}

function calcGeneral(equipment: ClassroomEquipmentItem[]): ClassroomGeneralState {
  const states = equipment.map(item => item.state);
  if (states.some(v => v === 'En reparación')) return 'Problema';
  if (states.some(v => v === 'Con falla' || v === 'Sin revisar')) return 'Con observaciones';
  if (states.length && states.every(v => v === 'OK' || v === 'No tiene')) return 'OK';
  return 'Sin revisar';
}

export function ClassroomInfoPanel({ roomKey, nombre, piso, operator, consultationMode, categories, onClose }: {
  roomKey: string;
  nombre: string;
  piso: string;
  operator: Operator;
  consultationMode: boolean;
  categories: ClassroomCategory[];
  onClose: (saved?: boolean) => void;
}) {
  const [classroom, setClassroom] = useState<Classroom | null>(null);
  const [draft, setDraft] = useState<Classroom | null>(null);
  const [history, setHistory] = useState<ClassroomHistoryEntry[]>([]);
  const [incidents, setIncidents] = useState<ClassroomIncident[]>([]);
  const [incidentSummary, setIncidentSummary] = useState<ClassroomIncidentSummary>({ open: 0, closed: 0, total: 0, lastIncidentAt: '', commonCategories: [] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [configuringEquipment, setConfiguringEquipment] = useState(false);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    let cancelled = false;
    fetchClassroom(roomKey, nombre, piso).then(r => {
      if (cancelled || !r.ok) return;
      const item = {
        ...r.item,
        proyector: migrateLegacyState(r.item.proyector),
        nuc: migrateLegacyState(r.item.nuc),
        monitor: migrateLegacyState(r.item.monitor),
        tecladoMouse: migrateLegacyState(r.item.tecladoMouse),
        equipment: getEquipment(r.item, categories).map(entry => ({ ...entry, state: migrateLegacyState(entry.state) }))
      };
      setClassroom(item); setDraft(item);
    });
    fetchClassroomHistory(roomKey).then(r => { if (!cancelled && r.ok) setHistory(r.items); });
    fetchClassroomIncidents(roomKey).then(r => { if (!cancelled && r.ok) { setIncidents(r.items || []); setIncidentSummary(r.summary); } }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [roomKey, nombre, piso, categories]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    document.body.classList.add('modal-open');
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.classList.remove('modal-open');
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  if (!draft) {
    return (
      <div className="modal classroom-modal-wrap" onClick={() => onClose()} role="dialog" aria-modal="true">
        <div className="modal-card classroom-modal" onClick={e => e.stopPropagation()}>
          <p>Cargando aula...</p>
        </div>
      </div>
    );
  }

  const updateItem = (key: ClassroomEquipmentKey, value: ClassroomItemState) => {
    setDraft(d => {
      if (!d) return d;
      const equipment = getEquipment(d, categories).map(item => item.key === key ? { ...item, state: value } : item);
      return { ...d, [key]: value, equipment, estadoGeneral: calcGeneral(equipment) };
    });
  };

  const toggleEquipment = (key: ClassroomEquipmentKey) => {
    setDraft(d => {
      if (!d) return d;
      const option = categories.find(item => item.key === key) || DEFAULT_EQUIPMENT_OPTIONS.find(item => item.key === key);
      if (!option) return d;
      const current = getEquipment(d, categories);
      const exists = current.some(item => item.key === key);
      if (exists && current.length === 1) return d;
      const equipment = exists
        ? current.filter(item => item.key !== key)
        : [...current, { key, label: option.label, state: 'Sin revisar' as ClassroomItemState }];
      return { ...d, equipment, estadoGeneral: calcGeneral(equipment) };
    });
  };

  const onSave = async () => {
    if (!draft) return;
    setBusy(true); setError('');
    try {
      const r = await updateClassroom(roomKey, {
        nombre: draft.nombre || nombre,
        piso: piso || draft.piso,
        proyector: draft.proyector,
        nuc: draft.nuc,
        monitor: draft.monitor,
        tecladoMouse: draft.tecladoMouse,
        equipment: getEquipment(draft, categories),
        observaciones: draft.observaciones,
        operator
      });
      if (!r.ok) { setError('No se pudo guardar'); return; }
      const saved = { ...r.item, equipment: getEquipment(r.item, categories) };
      setClassroom(saved); setDraft(saved);
      const hist = await fetchClassroomHistory(roomKey);
      if (hist.ok) setHistory(hist.items);
      onClose(true);
    } catch { setError('Error de conexión'); }
    finally { setBusy(false); }
  };

  const onCancel = () => { onClose(); };

  return (
    <div className="modal classroom-modal-wrap" onClick={() => onClose()} role="dialog" aria-modal="true">
      <div className="modal-card classroom-modal" onClick={e => e.stopPropagation()}>
        <div className="card-head" style={{ marginBottom: 8 }}>
          <div>
            <h3 style={{ margin: 0 }}>{nombre || draft.nombre}</h3>
            <p className="muted" style={{ margin: '2px 0 0' }}>{piso} · {roomKey}</p>
          </div>
          <button type="button" className="icon-btn" onClick={() => onClose()} aria-label="Cerrar">✕</button>
        </div>

        <div className={`classroom-general-badge estado-${normalize(draft.estadoGeneral)}`}>
          Estado general: <strong>{draft.estadoGeneral}</strong>
        </div>

        <section className="classroom-incidents-section">
          <div className="card-head"><div><h4>Incidentes del aula</h4><span className="muted">Los tickets vinculados aparecen automáticamente.</span></div></div>
          <div className="classroom-incident-kpis">
            <div><span>Abiertos</span><strong>{incidentSummary.open}</strong></div>
            <div><span>Cerrados</span><strong>{incidentSummary.closed}</strong></div>
            <div><span>Total</span><strong>{incidentSummary.total}</strong></div>
            <div><span>Último incidente</span><strong>{incidentSummary.lastIncidentAt ? new Date(incidentSummary.lastIncidentAt).toLocaleDateString('es-AR') : '—'}</strong></div>
          </div>
          {incidentSummary.commonCategories.length > 0 && <div className="classroom-incident-categories"><strong>Problemas frecuentes</strong>{incidentSummary.commonCategories.map(item => <span key={item.label}>{item.label} · {item.value}</span>)}</div>}
          <div className="classroom-incident-timeline">
            {incidents.slice(0, 8).map(item => (
              <article key={item.id}>
                <span className={`badge ${item.estado === 'Hecho' ? 'available' : 'loaned'}`}>{item.estado}</span>
                <div><strong>{item.numero ? `#${item.numero} · ` : ''}{item.titulo || 'Incidente sin título'}</strong><span>{[item.categoria, item.prioridad, item.createdAt ? new Date(item.createdAt).toLocaleString('es-AR') : ''].filter(Boolean).join(' · ')}</span></div>
              </article>
            ))}
            {!incidents.length && <div className="empty-state">Esta aula todavía no tiene incidentes vinculados.</div>}
          </div>
        </section>

        <div className="classroom-equipment-toolbar">
          <strong>Equipamiento del espacio</strong>
          <Button onClick={() => setConfiguringEquipment(v => !v)} disabled={consultationMode}>
            {configuringEquipment ? 'Cerrar categorías' : 'Editar equipamiento'}
          </Button>
        </div>

        {configuringEquipment && (
          <div className="classroom-equipment-config">
            {(categories.length ? categories : DEFAULT_EQUIPMENT_OPTIONS).map(option => {
              const current = getEquipment(draft, categories);
              const active = current.some(item => item.key === option.key);
              return (
                <label key={option.key} className={`equipment-option ${active ? 'active' : ''}`}>
                  <input
                    type="checkbox"
                    checked={active}
                    disabled={consultationMode || (active && current.length === 1)}
                    onChange={() => toggleEquipment(option.key)}
                  />
                  <span>{option.label}</span>
                </label>
              );
            })}
          </div>
        )}

        <div className="classroom-items">
          {getEquipment(draft, categories).map(item => (
            <div key={item.key} className="classroom-item-row">
              <div className="classroom-item-label">{item.label}</div>
              <div className="classroom-item-states">
                {(categories.find(category => category.key === item.key)?.options || ITEM_STATES).map(s => (
                  <button
                    key={s}
                    type="button"
                    className={`item-state-btn tone-${ITEM_COLORS[s]} ${item.state === s ? 'active' : ''}`}
                    onClick={() => updateItem(item.key, s)}
                    disabled={consultationMode}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        <label>Observaciones
          <textarea
            className="input"
            rows={3}
            value={draft.observaciones || ''}
            disabled={consultationMode}
            onChange={e => setDraft(d => d ? { ...d, observaciones: e.target.value } : d)}
          />
        </label>

        <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
          Última actualización: {classroom?.ultimaActualizacion ? new Date(classroom.ultimaActualizacion).toLocaleString() : '—'}
          {classroom?.operadorUltimoCambio ? ` · ${classroom.operadorUltimoCambio}` : ''}
        </div>

        {error && <div className="tool-error">{error}</div>}

        <div className="actions classroom-modal-actions">
          <Button onClick={onCancel} disabled={busy}>Cancelar</Button>
          <Button variant="primary" onClick={onSave} disabled={consultationMode || busy}>{busy ? 'Guardando...' : 'Guardar cambios'}</Button>
        </div>

        {history.length > 0 && (
          <details className="classroom-history">
            <summary>Historial de cambios ({history.length})</summary>
            <ul>
              {history.slice(0, 20).map(h => (
                <li key={h.id}>
                  <span className="muted">{new Date(h.timestamp).toLocaleString()}</span>
                  {' · '}
                  <strong>{h.campo}</strong>: {h.valorAnterior || '—'} → {h.valorNuevo || '—'}
                  {h.operador ? ` (${h.operador})` : ''}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </div>
  );
}

function normalize(s: string) {
  return s.toLowerCase().replace(/\s+/g, '-').normalize('NFD').replace(/[̀-ͯ]/g, '');
}
