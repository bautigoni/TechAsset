import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { ChevronDown, House, SearchX, Undo2 } from 'lucide-react';
import type { Device } from '../../types';
import {
  Button, Checkbox, ErrorState, Input, Kbd, Segmented, SelectionHeader, SkeletonRows, StatusText, TruncatedText,
  Collapse, cx, icons, useAnchoredToggle, useInlineConfirm, useSelection, type StatusMessage
} from '../../ui';
import { aliasOf, fichaFields, filterList, initialOf, loanOf, sinceOf, stateText, whereOf, type Counts, type ListFilter } from './dashModel';
import type { LoanActions } from './useLoanActions';
import { normalizeText } from '../../utils/formatters';
import { DashEmpty } from './DashEmpty';
import { useSmoothHeight } from './useSmoothHeight';

const FIRST_PAGE = 12;
const PAGE = 20;

export type OutListProps = {
  devices: Device[];
  counts: Counts;
  filter: ListFilter;
  type: string;
  query: string;
  loading: boolean;
  error: string;
  updatedLabel: string;
  retrying: boolean;
  readOnly: boolean;
  actions: LoanActions;
  status: { show: (message: StatusMessage) => void; element: ReactNode; slot: (className?: string) => ReactNode };
  onFilter: (filter: ListFilter) => void;
  onType: (type: string) => void;
  onQuery: (query: string) => void;
  onRetry: () => void;
  onLend: (etiquetas: string[]) => void;
  onEdit: (device: Device) => void;
  onProfile: (device: Device) => void;
  onCopy: (device: Device) => void;
  onShortcuts: () => void;
  /** Lleva a la barra de acción para prestar (estado vacío). */
  onStartLend: () => void;
};

/**
 * "Afuera ahora": la lista operativa. Pestañas Prestados / Disponibles /
 * Todos, buscador flexible, Devolver por fila y la ficha que se abre debajo
 * de la fila. Ctrl/Cmd+clic marca, Shift+clic marca el rango (misma gramática
 * que los cartelitos de Préstamos) y la selección REEMPLAZA el encabezado.
 */
export function OutList(props: OutListProps) {
  const { devices, counts, filter, type, query, loading, error, updatedLabel, retrying, readOnly, actions, status, onFilter, onType, onQuery, onRetry, onLend, onEdit, onProfile, onCopy, onShortcuts, onStartLend } = props;
  const [shown, setShown] = useState(FIRST_PAGE);
  const [open, setOpen] = useState<string | null>(null);
  const selection = useSelection();
  const confirm = useInlineConfirm();
  const listRef = useRef<HTMLUListElement | null>(null);
  // La fila tocada: la ficha que se abre y la que se cierra se anclan a ella (no se mueve).
  const pinned = useRef<HTMLElement | null>(null);
  const anchored = useAnchoredToggle();

  const list = useMemo(() => filterList(devices, filter, type, query), [devices, filter, type, query]);
  const visible = list.slice(0, shown);
  const remaining = list.length - visible.length;
  const order = useMemo(() => visible.map(device => device.etiqueta), [visible]);
  const byTag = useMemo(() => new Map(devices.map(device => [device.etiqueta, device])), [devices]);

  useEffect(() => { setShown(FIRST_PAGE); }, [filter, type, query]);
  // La selección se recalcula contra el estado vivo: lo que ya no existe o
  // quedó bloqueado (fuera de servicio) se suelta solo.
  useEffect(() => {
    selection.prune(devices.filter(device => loanOf(device) !== 'blocked').map(device => device.etiqueta));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [devices]);
  useEffect(() => { if (readOnly) selection.clear(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [readOnly]);

  const selected = [...selection.selected].map(tag => byTag.get(tag)).filter((device): device is Device => Boolean(device));
  const toReturn = selected.filter(device => loanOf(device) === 'loaned');
  const toLend = selected.filter(device => loanOf(device) === 'available');

  const returnSelected = async () => {
    const tags = toReturn.map(device => device.etiqueta);
    if (tags.length > 1) {
      const ok = await confirm.ask({ message: `¿Devolver ${tags.length} equipos?`, detail: toReturn.map(device => `${aliasOf(device)} ${device.etiqueta}`).join(' · '), confirmLabel: 'Confirmar' });
      if (!ok) return;
    }
    const done = await actions.returnDevices(tags, status.show);
    if (done) selection.clear();
    else tags.forEach(tag => { if (!selection.isSelected(tag)) selection.toggle(tag); });
  };

  const clickRow = (device: Device, event: MouseEvent) => {
    const target = event.target as HTMLElement;
    // Tocar un texto cortado en touch lo despliega en línea (no abre la ficha).
    const pointer = (event.nativeEvent as PointerEvent).pointerType;
    if (target.closest('.ui-trunc.is-cut') && (pointer === 'touch' || pointer === 'pen')) return;
    if (!readOnly && loanOf(device) !== 'blocked' && selection.handleClick(device.etiqueta, event, order)) return;
    // La fila tocada queda quieta aunque arriba se cierre otra ficha.
    pinned.current = event.currentTarget as HTMLElement;
    setOpen(current => (current === device.etiqueta ? null : device.etiqueta));
  };

  // ↑ ↓ recorren las filas; Espacio marca la fila.
  const onListKey = (event: KeyboardEvent<HTMLUListElement>) => {
    const target = event.target as HTMLElement;
    if (!target.classList.contains('dash-row-hit')) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const hits = [...(listRef.current?.querySelectorAll<HTMLButtonElement>('.dash-row-hit') || [])];
      const index = hits.indexOf(target as HTMLButtonElement);
      hits[event.key === 'ArrowDown' ? Math.min(hits.length - 1, index + 1) : Math.max(0, index - 1)]?.focus();
    } else if (event.key === ' ' && !readOnly) {
      const tag = target.closest<HTMLElement>('[data-device-tag]')?.dataset.deviceTag;
      const device = tag ? byTag.get(tag) : undefined;
      if (device && loanOf(device) !== 'blocked') { event.preventDefault(); selection.setMode(true); selection.toggle(tag!); }
    }
  };

  const allVisible = visible.filter(device => loanOf(device) !== 'blocked').map(device => device.etiqueta);
  const allOn = allVisible.length > 0 && allVisible.every(tag => selection.isSelected(tag));
  const someOn = allVisible.some(tag => selection.isSelected(tag));

  const filtered = Boolean(query.trim() || type);
  const empty: EmptyInfo = filtered
    ? {
      icon: 'search',
      title: 'Nada coincide con el filtro',
      desc: query.trim() ? `No hay equipos para “${query.trim()}”${type ? ` en ${type}` : ''}.` : `No hay equipos de tipo ${type} en esta lista.`,
      actions: [{ label: 'Limpiar el filtro', onClick: () => { onQuery(''); onType(''); } }]
    }
    : filter === 'loaned' ? {
      icon: 'home',
      title: 'Todo en casa',
      desc: counts.available ? `No hay equipos prestados · ${counts.available} ${counts.available === 1 ? 'disponible' : 'disponibles'} para prestar.` : 'No hay equipos prestados.',
      actions: [
        ...(!readOnly && counts.available ? [{ label: 'Prestar un equipo', primary: true, onClick: onStartLend }] : []),
        ...(counts.available ? [{ label: 'Ver disponibles', onClick: () => onFilter('available') }] : [])
      ]
    }
      : filter === 'overdue' ? { icon: 'home', title: 'Nada atrasado', desc: 'Todo lo prestado salió hoy.', actions: [{ label: 'Ver prestados', onClick: () => onFilter('loaned') }] }
        : filter === 'available' ? {
          icon: 'back',
          title: 'No hay equipos libres ahora',
          desc: counts.loaned ? `${counts.loaned} ${counts.loaned === 1 ? 'está prestado' : 'están prestados'}.` : 'Ningún equipo se puede prestar en este momento.',
          actions: counts.loaned ? [{ label: 'Ver prestados', onClick: () => onFilter('loaned') }] : []
        }
          : { icon: 'search', title: 'No hay equipos en esta sede', desc: 'Se cargan desde Dispositivos o con la importación de inventario.', actions: [] };
  const hasRows = !loading && visible.length > 0;
  const bodyRef = useSmoothHeight<HTMLDivElement>(`${filter}|${type}|${query}|${shown}|${loading ? 1 : 0}|${hasRows ? 1 : 0}`);

  const header = (
    <div className="dash-list-head">
      <h2 className="dash-h2" id="afuera-titulo">Afuera ahora</h2>
      <Segmented<'loaned' | 'available' | 'all'>
        size="sm"
        ariaLabel="Filtrar la lista"
        className="dash-tabs"
        value={filter === 'overdue' ? 'loaned' : (filter as 'loaned' | 'available' | 'all')}
        onChange={value => anchored(() => onFilter(value))}
        options={[
          { value: 'loaned', label: 'Prestados', count: counts.loaned },
          { value: 'available', label: 'Disponibles', count: counts.available },
          { value: 'all', label: 'Todos', count: counts.total }
        ]}
      />
      {filter === 'overdue' && <FilterChip label="Más de 1 día afuera" onClear={() => onFilter('loaned')} />}
      {type && <FilterChip label={`Tipo: ${type}`} onClear={() => onType('')} />}
      <Input
        className="dash-list-search"
        size="sm"
        aria-label="Filtrar la lista por equipo o persona"
        placeholder="Filtrar: touch34, Alex…"
        autoComplete="off"
        value={query}
        onValueChange={onQuery}
        prefix={<icons.IconSearch size={14} />}
        suffix={query ? <button type="button" className="dash-clear" aria-label="Limpiar el filtro" onClick={() => onQuery('')}><icons.IconX size={12} /></button> : undefined}
      />
    </div>
  );

  return (
    <section className={cx('dash-card', 'dash-list', readOnly && 'is-readonly', !hasRows && 'is-empty')} aria-labelledby="afuera-titulo" data-dash="afuera">
      <SelectionHeader
        count={selection.count}
        onClear={() => { confirm.cancel(); selection.clear(); }}
        noun={['seleccionado', 'seleccionados']}
        className="dash-selhead"
        stable
        confirm={confirm.element}
        actions={(
          <>
            {toLend.length > 0 && <Button size="sm" variant="secondary" onClick={() => { onLend(toLend.map(device => device.etiqueta)); selection.clear(); }}>Prestar {toLend.length}</Button>}
            {toReturn.length > 0 && (
              <Button size="sm" variant="primary" loading={toReturn.some(device => actions.busy.has(device.etiqueta))} loadingLabel="Devolviendo…" onClick={() => void returnSelected()}>
                Devolver {toReturn.length}
              </Button>
            )}
          </>
        )}
      >
        {header}
      </SelectionHeader>

      {error && <ErrorState className="dash-block-error" message="No se pudo actualizar la lista" updatedAt={updatedLabel} onRetry={onRetry} retrying={retrying} />}
      {status.slot('dash-status dash-status--in')}

      {/* Cambiar de pestaña, filtrar, quedar vacía o "Ver más" estira o encoge la
          lista suave (títulos, filas, vacío y pie juntos): nada aparece de golpe. */}
      <div ref={bodyRef} className="dash-list-body">
      {hasRows && <div className="dash-cols" aria-hidden="true">
        {!readOnly && (
          <Checkbox
            className="dash-col-check"
            ariaLabel={allOn ? 'Desmarcar las filas visibles' : 'Marcar las filas visibles'}
            checked={allOn}
            indeterminate={someOn && !allOn}
            disabled={!allVisible.length}
            onCheckedChange={() => { selection.setMode(true); selection.toggleMany(allVisible); }}
          />
        )}
        <span className="dash-cols-main"><span>Equipo</span><span>Quién</span><span>Dónde</span><span>Desde</span></span>
        <span className="dash-cols-act">{readOnly ? '' : 'Acción'}</span>
      </div>}

      {loading ? <SkeletonRows rows={5} className="dash-list-skel" /> : (
        <ul className={cx('dash-rows', readOnly && 'is-readonly')} hidden={!visible.length} ref={listRef} onKeyDown={onListKey} aria-label="Equipos">
          {visible.map(device => (
            <Row
              key={device.etiqueta}
              device={device}
              open={open === device.etiqueta}
              selected={selection.isSelected(device.etiqueta)}
              busy={actions.busy.has(device.etiqueta)}
              readOnly={readOnly}
              personCount={device.prestadoA ? counts.peopleCount.get(normalizeText(device.prestadoA)) || 0 : 0}
              onClick={event => clickRow(device, event)}
              onCheck={event => { selection.handleClick(device.etiqueta, { ctrlKey: true, metaKey: false, shiftKey: event.shiftKey }, order); }}
              onReturn={() => void actions.returnDevices([device.etiqueta], status.show)}
              onLend={() => onLend([device.etiqueta])}
              onClose={() => { pinned.current = null; setOpen(null); }}
              anchor={() => pinned.current}
              onEdit={() => onEdit(device)}
              onProfile={() => onProfile(device)}
              onCopy={() => onCopy(device)}
            />
          ))}
        </ul>
      )}
      {!loading && !visible.length && <ListEmpty info={empty} />}

      {/* El pie (cuántas, atajos de selección, Ver más) solo tiene sentido con filas. */}
      {hasRows && (
        <div className="dash-list-foot">
          <span className="ui-mono dash-nw">{visible.length} de {list.length}</span>
          {!readOnly && (
            <span className="dash-list-help dash-only-wide">
              <Kbd>Ctrl</Kbd> / <Kbd>⌘</Kbd> / <Kbd>Shift</Kbd> + clic marca varias · clic abre la ficha
            </span>
          )}
          <Button size="sm" variant="ghost" className="dash-only-wide" onClick={onShortcuts}><Kbd>?</Kbd> Atajos</Button>
          <span className="dash-grow" />
          {remaining > 0 && <Button size="sm" variant="secondary" onClick={() => setShown(value => value + PAGE)}>Ver {Math.min(PAGE, remaining)} más</Button>}
          {remaining > PAGE && <Button size="sm" variant="ghost" onClick={() => setShown(list.length)}>Ver todos</Button>}
        </div>
      )}
      </div>
    </section>
  );
}

type EmptyInfo = { icon: 'home' | 'search' | 'back'; title: string; desc: string; actions: Array<{ label: string; primary?: boolean; onClick: () => void }> };

/** Estado vacío compacto: ícono sobrio, una frase y la acción siguiente. */
function ListEmpty({ info }: { info: EmptyInfo }) {
  const Icon = info.icon === 'home' ? House : info.icon === 'back' ? Undo2 : SearchX;
  return (
    <DashEmpty
      icon={<Icon size={18} strokeWidth={1.6} />}
      title={info.title}
      description={info.desc}
      actions={info.actions.length ? info.actions.map(action => <Button key={action.label} size="sm" variant={action.primary ? 'secondary' : 'ghost'} onClick={action.onClick}>{action.label}</Button>) : undefined}
    />
  );
}

function FilterChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span className="dash-fchip">
      <span className="dash-fchip-text">{label}</span>
      <button type="button" className="dash-clear" aria-label={`Quitar el filtro ${label}`} onClick={onClear}><icons.IconX size={12} /></button>
    </span>
  );
}

function Row({ device, open, selected, busy, readOnly, personCount, onClick, onCheck, onReturn, onLend, onClose, anchor, onEdit, onProfile, onCopy }: {
  device: Device;
  open: boolean;
  selected: boolean;
  busy: boolean;
  readOnly: boolean;
  personCount: number;
  onClick: (event: MouseEvent) => void;
  onCheck: (event: MouseEvent) => void;
  onReturn: () => void;
  onLend: () => void;
  onClose: () => void;
  /** Lo que queda quieto al abrir o cerrar la ficha (la fila tocada). */
  anchor: () => HTMLElement | null;
  onEdit: () => void;
  onProfile: () => void;
  onCopy: () => void;
}) {
  const state = loanOf(device);
  const alias = aliasOf(device);
  const since = sinceOf(device);
  const st = stateText(device);
  const where = state === 'loaned' ? whereOf(device) || '—' : [device.marca, device.modelo].filter(Boolean).join(' ') || '—';
  const blocked = state === 'blocked';
  const lineRef = useRef<HTMLDivElement | null>(null);
  return (
    <li className={cx('dash-row', selected && 'is-selected', open && 'is-open', busy && 'is-busy')} data-device-tag={device.etiqueta}>
      {/* Toda la fila responde al mouse (clic abre la ficha; Ctrl/Cmd/Shift marcan);
          con teclado, el botón del equipo hace lo mismo. */}
      <div ref={lineRef} className="dash-row-line" onClick={onClick}>
        {!readOnly && (
          <span className="dash-row-check" onClick={event => event.stopPropagation()}>
            <Checkbox ariaLabel={`${selected ? 'Desmarcar' : 'Marcar'} ${alias}`} checked={selected} disabled={blocked} onCheckedChange={(_, event) => onCheck(event)} />
          </span>
        )}
        <span className="dash-row-main">
          <button type="button" className="dash-row-hit dash-c-eq" aria-expanded={open} aria-label={`${alias} (${device.etiqueta}): ${open ? 'cerrar' : 'abrir'} la ficha`}>
            <span className="dash-alias">{alias}</span>
            <span className="ui-mono dash-tag">{device.etiqueta}</span>
          </button>
          <span className="dash-c-who">
            {state === 'loaned' ? (
              <>
                <span className="dash-initial" aria-hidden="true">{initialOf(device.prestadoA)}</span>
                <span className="dash-c-stack">
                  <TruncatedText className="dash-person" lines={2}>{device.prestadoA || 'Sin persona'}</TruncatedText>
                  <span className="dash-sub">{[device.rol || '—', personCount > 1 ? `${personCount} equipos` : ''].filter(Boolean).join(' · ')}</span>
                </span>
              </>
            ) : <StatusText tone={st.tone} strong={st.tone !== 'normal'}>{st.text}</StatusText>}
          </span>
          <span className="dash-c-where"><TruncatedText className="dash-where" lines={2}>{where}</TruncatedText></span>
          <span className="dash-c-since">
            {state === 'loaned' ? (
              <>
                <StatusText tone={since.tone} mono strong={since.tone !== 'normal'}>{since.main}</StatusText>
                <span className="dash-sub">{since.sub}</span>
              </>
            ) : <span className="dash-sub">—</span>}
          </span>
        </span>
        <span className="dash-row-act" onClick={event => event.stopPropagation()}>
          {!readOnly && state === 'loaned' && <Button size="sm" variant="secondary" loading={busy} loadingLabel="Devolviendo…" aria-label={`Devolver ${alias}`} onClick={onReturn}>Devolver</Button>}
          {!readOnly && state === 'available' && <Button size="sm" variant="ghost" className="dash-lend-btn" aria-label={`Prestar ${alias}`} onClick={onLend}>Prestar</Button>}
          {readOnly && <icons.IconLock size={14} aria-hidden="true" className="dash-lock" />}
          <ChevronDown size={16} strokeWidth={1.6} aria-hidden="true" className={cx('dash-row-chev', open && 'is-open')} />
        </span>
      </div>
      <Collapse open={open} anchor={() => anchor() || lineRef.current} unmountOnClose>
        <div className="dash-ficha" role="region" aria-label={`Ficha de ${alias}`}>
          <dl className="dash-kv">
            {fichaFields(device).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}
          </dl>
          <div className="dash-row-wrap dash-ficha-acts">
            {!readOnly && state === 'loaned' && <Button size="sm" variant="primary" loading={busy} loadingLabel="Devolviendo…" onClick={onReturn}>Devolver</Button>}
            {!readOnly && state === 'available' && <Button size="sm" variant="primary" onClick={onLend}>Prestar</Button>}
            {!readOnly && <Button size="sm" variant="secondary" onClick={onEdit}>Editar</Button>}
            <Button size="sm" variant="secondary" onClick={onProfile}>Ficha completa</Button>
            <Button size="sm" variant="secondary" onClick={onCopy}>Copiar etiqueta</Button>
            <span className="dash-grow" />
            <Button size="sm" variant="ghost" onClick={() => { onClose(); lineRef.current?.querySelector<HTMLButtonElement>('.dash-row-hit')?.focus({ preventScroll: true }); }}>Cerrar</Button>
          </div>
        </div>
      </Collapse>
    </li>
  );
}
