import { useEffect, useState } from 'react';
import type { Classroom, ClassroomHistoryEntry, ClassroomItemState, Operator } from '../../types';
import { fetchClassroom, fetchClassroomHistory, updateClassroom } from '../../services/classroomsApi';
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

const ITEMS: Array<{ key: 'proyector' | 'nuc' | 'monitor' | 'tecladoMouse'; label: string }> = [
  { key: 'proyector', label: 'Proyector' },
  { key: 'nuc', label: 'NUC' },
  { key: 'monitor', label: 'Monitor' },
  { key: 'tecladoMouse', label: 'Teclado/Mouse' }
];

export function ClassroomInfoPanel({ roomKey, nombre, piso, operator, consultationMode, onClose }: {
  roomKey: string;
  nombre: string;
  piso: string;
  operator: Operator;
  consultationMode: boolean;
  onClose: () => void;
}) {
  const [classroom, setClassroom] = useState<Classroom | null>(null);
  const [draft, setDraft] = useState<Classroom | null>(null);
  const [history, setHistory] = useState<ClassroomHistoryEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetchClassroom(roomKey, nombre).then(r => {
      if (cancelled || !r.ok) return;
      const item = {
        ...r.item,
        proyector: migrateLegacyState(r.item.proyector),
        nuc: migrateLegacyState(r.item.nuc),
        monitor: migrateLegacyState(r.item.monitor),
        tecladoMouse: migrateLegacyState(r.item.tecladoMouse)
      };
      setClassroom(item); setDraft(item);
    });
    fetchClassroomHistory(roomKey).then(r => { if (!cancelled && r.ok) setHistory(r.items); });
    return () => { cancelled = true; };
  }, [roomKey, nombre]);

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
      <div className="modal classroom-modal-wrap" onClick={onClose} role="dialog" aria-modal="true">
        <div className="modal-card classroom-modal" onClick={e => e.stopPropagation()}>
          <p>Cargando aula...</p>
        </div>
      </div>
    );
  }

  const updateItem = (key: typeof ITEMS[number]['key'], value: ClassroomItemState) => {
    setDraft(d => d ? { ...d, [key]: value } : d);
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
        observaciones: draft.observaciones,
        operator
      });
      if (!r.ok) { setError('No se pudo guardar'); return; }
      setClassroom(r.item); setDraft(r.item);
      const hist = await fetchClassroomHistory(roomKey);
      if (hist.ok) setHistory(hist.items);
    } catch { setError('Error de conexión'); }
    finally { setBusy(false); }
  };

  const onCancel = () => { onClose(); };

  return (
    <div className="modal classroom-modal-wrap" onClick={onClose} role="dialog" aria-modal="true">
      <div className="modal-card classroom-modal" onClick={e => e.stopPropagation()}>
        <div className="card-head" style={{ marginBottom: 8 }}>
          <div>
            <h3 style={{ margin: 0 }}>{nombre || draft.nombre}</h3>
            <p className="muted" style={{ margin: '2px 0 0' }}>{piso} · {roomKey}</p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Cerrar">✕</button>
        </div>

        <div className={`classroom-general-badge estado-${normalize(draft.estadoGeneral)}`}>
          Estado general: <strong>{draft.estadoGeneral}</strong>
        </div>

        <div className="classroom-items">
          {ITEMS.map(item => (
            <div key={item.key} className="classroom-item-row">
              <div className="classroom-item-label">{item.label}</div>
              <div className="classroom-item-states">
                {ITEM_STATES.map(s => (
                  <button
                    key={s}
                    type="button"
                    className={`item-state-btn tone-${ITEM_COLORS[s]} ${draft[item.key] === s ? 'active' : ''}`}
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

        <div className="actions" style={{ marginTop: 12 }}>
          <Button onClick={onCancel} disabled={busy}>Cancelar</Button>
          <Button variant="primary" onClick={onSave} disabled={consultationMode || busy}>Guardar cambios</Button>
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
