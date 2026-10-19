import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import '../../styles/screens/classrooms.css';
import type { Classroom, ClassroomCategory, Operator, SiteInfo } from '../../types';
import { fetchClassroomCategories, fetchClassrooms } from '../../services/classroomsApi';
import { Button, EmptyState, ErrorState, Eyebrow, InlineConfirm, Ring, Segmented, Skeleton, cx } from '../../ui';
import { errorMessage } from '../layout/Feedback';
import { Collapse } from '../common/SoftCollapse';
import { focusQuietly } from '../../utils/reveal';
import { FLOOR_PLANS, roomsOf, type FloorPlanDef } from './plan/floorPlans.js';
import { FloorPlan, IconObs, IconProblem, type RoomStatus } from './plan/FloorPlan';
import { ClassroomSheet } from './ClassroomSheet';
import { ClassroomCategories } from './ClassroomCategories';
import { getEquipment, generalTone, issuesOf } from './classroomState';

type FloorKey = FloorPlanDef['key'];
type FilterKey = 'ok' | 'obs' | 'prob' | 'sin' | 'proy' | 'nuc' | 'mon';
type Pending = { kind: 'room'; roomKey: string; nombre: string; trigger: HTMLElement | null } | { kind: 'close' } | { kind: 'floor'; floor: FloorKey } | { kind: 'site'; site: string };

const FILTERS: Array<{ key: Exclude<FilterKey, 'ok'>; label: string; tone: 'warn' | 'bad' | 'normal' }> = [
  { key: 'obs', label: 'Con observaciones', tone: 'warn' },
  { key: 'prob', label: 'Con problema', tone: 'bad' },
  { key: 'sin', label: 'Sin revisar', tone: 'normal' },
  { key: 'proy', label: 'Proyectores con falla', tone: 'bad' },
  { key: 'nuc', label: 'NUC con falla', tone: 'bad' },
  { key: 'mon', label: 'Monitores con falla', tone: 'bad' }
];

/**
 * Estado de aulas (etapa 6b, rediseño Grafito): plano recoloreado con tokens
 * (cada aula es un botón accesible), resumen que filtra, lista de aulas y la
 * ficha EN LÍNEA (columna al costado del plano en desktop, debajo en mobile).
 */
export function ClassroomStatusPage({ operator, consultationMode, activeSite, sites = [], onSiteChange, onNavigate }: {
  operator: Operator;
  consultationMode: boolean;
  activeSite: string;
  sites?: SiteInfo[];
  onSiteChange?: (code: string) => void;
  onNavigate?: (view: 'tickets' | 'reminders') => void;
}) {
  const floors = FLOOR_PLANS[activeSite];
  const [floorKey, setFloorKey] = useState<FloorKey>('planta');
  const [items, setItems] = useState<Classroom[]>([]);
  const [categories, setCategories] = useState<ClassroomCategory[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [retrying, setRetrying] = useState(false);
  const [filter, setFilter] = useState<FilterKey | null>(null);
  const [catsOpen, setCatsOpen] = useState(false);
  const [selected, setSelected] = useState<{ roomKey: string; nombre: string; piso: string } | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const dirtyRef = useRef(false);
  const triggerRef = useRef<HTMLElement | null>(null);
  const catsButtonRef = useRef<HTMLButtonElement | null>(null);

  const refresh = useCallback(async () => {
    if (!floors) return;
    try {
      const [list, cats] = await Promise.all([fetchClassrooms(), fetchClassroomCategories()]);
      setItems(list.items || []);
      setCategories(cats.items || []);
      setCanManage(Boolean(cats.canManage));
      setLoadError('');
    } catch (reason) {
      setLoadError(errorMessage(reason, 'No se pudo cargar el estado de las aulas.'));
    } finally {
      setLoading(false);
    }
  }, [floors]);

  useEffect(() => { void refresh(); }, [refresh]);

  const refreshCategories = useCallback(async () => {
    const cats = await fetchClassroomCategories();
    setCategories(cats.items || []);
    setCanManage(Boolean(cats.canManage));
  }, []);

  const floor = floors?.find(item => item.key === floorKey && !item.disabled) || floors?.find(item => !item.disabled);
  const rooms = useMemo(() => roomsOf(floor), [floor]);
  const roomKeys = useMemo(() => new Set(rooms.map(room => room.roomKey)), [rooms]);
  const byKey = useMemo(() => {
    const map = new Map<string, Classroom>();
    for (const item of items) if (item.piso === floor?.piso || roomKeys.has(item.roomKey)) map.set(item.roomKey, item);
    return map;
  }, [items, floor, roomKeys]);

  const statuses = useMemo(() => {
    const out: Record<string, RoomStatus> = {};
    for (const room of rooms) {
      const item = byKey.get(room.roomKey);
      out[room.roomKey] = item
        ? { estado: item.estadoGeneral || 'Sin revisar', issues: issuesOf(getEquipment(item, categories)) }
        : { estado: 'Sin revisar', issues: [] };
    }
    return out;
  }, [rooms, byKey, categories]);

  const matchOf = useCallback((roomKey: string, key: FilterKey) => {
    const item = byKey.get(roomKey);
    const estado = statuses[roomKey]?.estado || 'Sin revisar';
    const fault = (equipmentKey: string) => Boolean(item?.equipment?.some(entry => entry.key === equipmentKey && (entry.state === 'Con falla' || entry.state === 'En reparación')));
    switch (key) {
      case 'ok': return estado === 'OK';
      case 'obs': return estado === 'Con observaciones';
      case 'prob': return estado === 'Problema';
      case 'sin': return estado === 'Sin revisar';
      case 'proy': return fault('proyector');
      case 'nuc': return fault('nuc');
      case 'mon': return fault('monitor');
    }
  }, [byKey, statuses]);

  const counts = useMemo(() => {
    const out: Record<FilterKey, number> = { ok: 0, obs: 0, prob: 0, sin: 0, proy: 0, nuc: 0, mon: 0 };
    for (const room of rooms) (Object.keys(out) as FilterKey[]).forEach(key => { if (matchOf(room.roomKey, key)) out[key] += 1; });
    return out;
  }, [rooms, matchOf]);

  const matches = useMemo(() => (filter ? (roomKey: string) => matchOf(roomKey, filter) : null), [filter, matchOf]);

  // ── Abrir / cerrar ficha con aviso de cambios sin guardar ────────────────
  const doOpen = (roomKey: string, nombre: string) => {
    setSelected({ roomKey, nombre, piso: floor?.piso || '' });
    setSheetOpen(true);
  };
  const doClose = () => {
    setSheetOpen(false);
    const trigger = triggerRef.current;
    if (trigger?.isConnected) focusQuietly(trigger);
  };
  const doFloor = (next: FloorKey) => { setSheetOpen(false); setSelected(null); setFilter(null); setFloorKey(next); };

  const guarded = (next: Pending, run: () => void) => {
    if (dirtyRef.current) { setPending(next); return; }
    setPending(null);
    run();
  };

  const pick = (roomKey: string, nombre: string) => {
    if (selected?.roomKey === roomKey && sheetOpen) return;
    const active = document.activeElement;
    const trigger = active instanceof HTMLElement ? active : null;
    // El disparador (para devolverle el foco al cerrar) se fija recién cuando la ficha se abre de verdad.
    guarded({ kind: 'room', roomKey, nombre, trigger }, () => { triggerRef.current = trigger; doOpen(roomKey, nombre); });
  };
  const close = () => guarded({ kind: 'close' }, doClose);
  const chooseFloor = (next: FloorKey) => { if (next !== floorKey) guarded({ kind: 'floor', floor: next }, () => doFloor(next)); };
  const chooseSite = (code: string) => { if (code !== activeSite) guarded({ kind: 'site', site: code }, () => onSiteChange?.(code)); };

  const confirmPending = () => {
    const next = pending;
    dirtyRef.current = false;
    setPending(null);
    if (!next) return;
    if (next.kind === 'room') { triggerRef.current = next.trigger; doOpen(next.roomKey, next.nombre); }
    else if (next.kind === 'close') doClose();
    else if (next.kind === 'floor') doFloor(next.floor);
    else onSiteChange?.(next.site);
  };

  const onDirtyChange = useCallback((dirty: boolean) => { dirtyRef.current = dirty; }, []);
  const onSaved = useCallback((saved: Classroom) => {
    setItems(current => {
      const exists = current.some(item => item.roomKey === saved.roomKey);
      return exists ? current.map(item => (item.roomKey === saved.roomKey ? { ...item, ...saved } : item)) : [...current, saved];
    });
  }, []);

  if (!floors || !floor) {
    return (
      <section className="view active cls">
        <EmptyState title="Estado de aulas no configurado para esta sede." description="Esta sede todavía no tiene planos cargados." />
      </section>
    );
  }

  const siteOptions = sites.filter(site => FLOOR_PLANS[site.siteCode]);
  const siteName = sites.find(site => site.siteCode === activeSite)?.nombre || activeSite;
  const guardElement = pending && selected ? (
    <Collapse open>
      <InlineConfirm
        message={`Tenés cambios sin guardar en ${selected.nombre}.`}
        detail={pending.kind === 'room' ? `Si seguís, se descartan y se abre ${pending.nombre}.` : pending.kind === 'floor' ? 'Si seguís, se descartan y cambia la planta.' : pending.kind === 'site' ? 'Si seguís, se descartan y cambia la sede.' : 'Si seguís, se descartan y se cierra la ficha.'}
        confirmLabel="Descartar cambios"
        cancelLabel="Seguir editando"
        danger
        onConfirm={confirmPending}
        onCancel={() => setPending(null)}
      />
    </Collapse>
  ) : null;

  const okRatioTotal = rooms.length;

  return (
    <section className="view active cls">
      {/* Sede, planta y categorías */}
      <div className="cls-controls">
        {siteOptions.length > 1 && onSiteChange && (
          <Segmented<string>
            ariaLabel="Sede"
            value={activeSite}
            onChange={chooseSite}
            options={siteOptions.map(site => ({ value: site.siteCode, label: site.nombre || site.siteCode, count: site.siteCode }))}
            className="cls-seg-site"
          />
        )}
        <Segmented<FloorKey>
          ariaLabel="Planta"
          value={floor.key}
          onChange={chooseFloor}
          options={floors.map(item => ({ value: item.key, label: item.label, count: item.disabled ? 'Próximamente' : roomsOf(item).length, disabled: item.disabled }))}
          className="cls-seg-floor"
        />
        <span className="cls-grow" aria-hidden="true" />
        {canManage && (
          <Button ref={catsButtonRef} variant="secondary" aria-expanded={catsOpen} onClick={() => setCatsOpen(open => !open)}>
            Categorías de equipamiento
          </Button>
        )}
      </div>

      {pending && (pending.kind === 'floor' || pending.kind === 'site') ? guardElement : null}

      {canManage && (
        <Collapse open={catsOpen}>
          <ClassroomCategories
            categories={categories}
            consultationMode={consultationMode}
            onChanged={refreshCategories}
            onClose={() => { setCatsOpen(false); focusQuietly(catsButtonRef.current); }}
          />
        </Collapse>
      )}

      {loadError && <ErrorState message={loadError} retrying={retrying} onRetry={async () => { setRetrying(true); await refresh(); setRetrying(false); }} />}

      {/* Resumen de la planta: cada indicador filtra el plano y la lista */}
      <div className="cls-summary" role="group" aria-label="Resumen de la planta. Cada indicador filtra el plano y la lista.">
        {loading ? (
          Array.from({ length: 7 }, (_, index) => <Skeleton key={index} className="cls-sum-skel" height="3.25rem" radius="md" index={index} />)
        ) : (
          <>
            <button type="button" className={cx('cls-sum', 'cls-sum-main', filter === 'ok' && 'is-on')} aria-pressed={filter === 'ok'} onClick={() => setFilter(current => (current === 'ok' ? null : 'ok'))}>
              <Ring value={counts.ok} total={okRatioTotal} size={36} unit="aulas OK" />
              <span className="cls-sum-text">
                <span className="cls-sum-label">Aulas OK</span>
                <span className="cls-nowrap"><span className="cls-mono cls-sum-num">{counts.ok}</span><span className="cls-mono cls-muted"> de {okRatioTotal}</span></span>
              </span>
            </button>
            {FILTERS.map(item => (
              <button key={item.key} type="button" className={cx('cls-sum', item.label.length > 18 && 'is-long', filter === item.key && 'is-on')} aria-pressed={filter === item.key} onClick={() => setFilter(current => (current === item.key ? null : item.key))}>
                <span className="cls-sum-label">{item.label}</span>
                <span className={cx('cls-mono', 'cls-sum-num', counts[item.key] > 0 && item.tone !== 'normal' && `cls-tone-${item.tone}`)}>{counts[item.key]}</span>
              </button>
            ))}
            {filter && <Button variant="ghost" className="cls-sum-clear" onClick={() => setFilter(null)}>Quitar filtro</Button>}
          </>
        )}
      </div>

      <div className="cls-layout">
        {/* Plano */}
        <section className="cls-card cls-plan-card" aria-labelledby="cls-plan-title">
          <div className="cls-plan-head">
            <div className="cls-grow">
              <Eyebrow>{`${floor.caption || 'Plano'} · ${activeSite}`}</Eyebrow>
              <h2 className="cls-h2" id="cls-plan-title">{floor.label}</h2>
            </div>
            <Legend />
          </div>
          <FloorPlan floor={floor} siteLabel={siteName} statuses={statuses} selectedKey={sheetOpen ? selected?.roomKey || null : null} matches={matches} onPick={pick} />
        </section>

        {/* Ficha en línea */}
        <div className="cls-side">
          {selected ? (
            <Collapse open={sheetOpen} onClosed={() => setSelected(null)}>
              <ClassroomSheet
                key={selected.roomKey}
                roomKey={selected.roomKey}
                nombre={selected.nombre}
                piso={selected.piso}
                siteCode={activeSite}
                operator={operator}
                consultationMode={consultationMode}
                categories={categories}
                onSaved={onSaved}
                onClose={close}
                onDirtyChange={onDirtyChange}
                onNavigate={onNavigate}
                guard={pending && (pending.kind === 'room' || pending.kind === 'close') ? guardElement : null}
              />
            </Collapse>
          ) : (
            <aside className="cls-card cls-placeholder" aria-label="Ficha del aula">
              <Eyebrow>Ficha del aula</Eyebrow>
              <h2 className="cls-h2">Elegí un aula</h2>
              <p className="cls-para cls-muted">Tocá un aula en el plano o en la lista. La ficha se abre acá, sin tapar el plano.</p>
            </aside>
          )}
        </div>

        {/* Lista de aulas */}
        <section className="cls-card cls-list-card" aria-labelledby="cls-list-title">
          <div className="cls-list-head">
            <h3 className="cls-h3" id="cls-list-title">Aulas de {floor.label}</h3>
            <span className="cls-count">{matches ? rooms.filter(room => matches(room.roomKey)).length : rooms.length}</span>
          </div>
          <RoomList rooms={rooms} statuses={statuses} matches={matches} selectedKey={sheetOpen ? selected?.roomKey || null : null} onPick={pick} />
        </section>
      </div>
    </section>
  );
}

function Legend() {
  return (
    <div className="cls-legend" aria-label="Referencias del plano">
      <span className="cls-muted">OK sin marca</span>
      <span className="cls-tone-warn cls-legend-item"><IconObs />Con observaciones</span>
      <span className="cls-tone-bad cls-legend-item"><IconProblem />Problema</span>
      <span className="cls-muted cls-legend-item"><span className="cls-legend-dash" aria-hidden="true" />Sin revisar</span>
    </div>
  );
}

function RoomList({ rooms, statuses, matches, selectedKey, onPick }: {
  rooms: Array<{ roomKey: string; nombre: string }>;
  statuses: Record<string, RoomStatus>;
  matches: ((roomKey: string) => boolean) | null;
  selectedKey: string | null;
  onPick: (roomKey: string, nombre: string) => void;
}) {
  const visible = matches ? rooms.filter(room => matches(room.roomKey)) : rooms;
  if (!visible.length) return <EmptyState compact title="Ningún aula de esta planta coincide con el filtro." />;
  return (
    <ul className="cls-list">
      {visible.map(room => {
        const status = statuses[room.roomKey];
        const estado = status?.estado || 'Sin revisar';
        // Corto (una línea): el detalle de cada equipo está en la ficha y en la línea debajo del plano.
        const extra: ReactNode = status?.issues.length && estado !== 'OK' ? ` · ${status.issues.length}` : '';
        return (
          <li key={room.roomKey}>
            <button
              type="button"
              className={cx('cls-list-item', room.roomKey === selectedKey && 'is-sel')}
              aria-pressed={room.roomKey === selectedKey}
              aria-label={`${room.nombre}, ${estado}${status?.issues.length ? `: ${status.issues.join(', ')}` : ''}`}
              data-list-room={room.roomKey}
              onClick={() => onPick(room.roomKey, room.nombre)}
            >
              <span className="cls-list-name">{room.nombre}</span>
              <span className={cx('cls-list-state', `cls-tone-${generalTone(estado)}`)}>{estado}{extra}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
