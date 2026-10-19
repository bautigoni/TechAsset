import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type Ref } from 'react';
import { Camera, PackageMinus, PackagePlus, ScanLine } from 'lucide-react';
import type { Device } from '../../types';
import { Button, Combobox, IconButton, Input, Kbd, Select, StatusText, cx, icons, type SelectOption, type StatusMessage } from '../../ui';
import { getLoanSuggestions, type LoanSuggestion } from '../../services/loansApi';
import { resolveDeviceMatches } from '../../utils/normalizeSearch';
import { aliasOf, agoText, fichaFields, loanOf, nearestDevices, nearestFree, stateText, whereOf } from './dashModel';
import { EMPTY_DRAFT, SCHOOL_LEVELS, applySuggestion, draftPayload, validateDraft, type LendDraft, type LoanOptions } from './loanOptions';
import type { LoanActions } from './useLoanActions';
import { useQrCamera } from './useQrCamera';

type Mode = 'single' | 'lend' | 'return';

export type ActionBarProps = {
  devices: Device[];
  options: LoanOptions;
  /** Modo consulta u offline: busca y muestra, no actúa. */
  readOnly: boolean;
  readOnlyReason: string;
  actions: LoanActions;
  status: { show: (message: StatusMessage) => void; element: ReactNode };
  /** Lo que leyó el lector USB estando en el Inicio. */
  scan?: { code: string; nonce: number };
  /** Abrir el préstamo de estos equipos (Prestar de una fila o "Prestar N" de la selección). */
  lendRequest?: { etiquetas: string[]; nonce: number };
  inputRef: Ref<HTMLInputElement>;
  focusBar: () => void;
  onOpenLoans: (etiqueta: string) => void;
  onShowInList: (query: string) => void;
  onProfile: (device: Device) => void;
};

/**
 * Barra de acción del Inicio: escaneá o escribí un equipo y aparece debajo,
 * EN LÍNEA, el resultado con LA acción que corresponde marcada con Enter
 * (prestado → Devolver; libre → Prestar con persona/rol/ubicación/motivo).
 * "Prestar varios" / "Devolver varios" arman una cola con cada Enter.
 */
export function ActionBar({ devices, options, readOnly, readOnlyReason, actions, status, scan, lendRequest, inputRef, focusBar, onOpenLoans, onShowInList, onProfile }: ActionBarProps) {
  const [q, setQ] = useState('');
  const query = useDeferredValue(q);
  const [mode, setMode] = useState<Mode>('single');
  const [queue, setQueue] = useState<string[]>([]);
  const [queueNote, setQueueNote] = useState('');
  const [lendList, setLendList] = useState<string[] | null>(null);
  const [draft, setDraft] = useState<LendDraft>(EMPTY_DRAFT);
  const [lendError, setLendError] = useState<[keyof LendDraft, string] | null>(null);
  const [sending, setSending] = useState(false);
  const [active, setActive] = useState(0);
  const [ficha, setFicha] = useState(false);
  const byTag = useMemo(() => new Map(devices.map(device => [device.etiqueta, device])), [devices]);

  const matches = useMemo(() => (query.trim() ? resolveDeviceMatches(devices, query) : []), [devices, query]);
  const found = matches.length === 1 ? matches[0] : undefined;
  const suggestions = useMemo(() => (query.trim() && !matches.length ? nearestDevices(devices, query) : []), [devices, query, matches.length]);
  const pickList = matches.length > 1 ? matches.slice(0, 6) : suggestions;
  const batch = mode !== 'single';
  const lendOpen = Boolean(lendList) || mode === 'lend';
  const lendTags = mode === 'lend' ? queue : lendList || [];

  useEffect(() => { setActive(0); setFicha(false); }, [query]);

  const reset = useCallback((keepMode = false) => {
    setQ('');
    setLendList(null);
    setLendError(null);
    setQueueNote('');
    setFicha(false);
    if (!keepMode) { setMode('single'); setQueue([]); setDraft(EMPTY_DRAFT); }
  }, []);

  const openLend = useCallback((tags: string[]) => {
    if (readOnly) return;
    setMode('single');
    setQueue([]);
    setLendList(tags);
    setDraft(EMPTY_DRAFT);
    setLendError(null);
    if (tags.length === 1) setQ(aliasOf(byTag.get(tags[0]) || ({ etiqueta: tags[0] } as Device)));
  }, [byTag, readOnly]);

  // Prestar desde la lista (fila o selección).
  useEffect(() => {
    if (lendRequest?.etiquetas.length) openLend(lendRequest.etiquetas);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lendRequest?.nonce]);

  /** Suma a la cola de "Prestar/Devolver varios" (duplicado y estado avisados). */
  const addToQueue = useCallback((device: Device) => {
    const want = mode === 'return' ? 'loaned' : 'available';
    const name = aliasOf(device);
    if (queue.includes(device.etiqueta)) { setQueueNote(`${name} ya está en la cola.`); setQ(''); return; }
    if (loanOf(device) !== want) {
      setQueueNote(mode === 'return' ? `${name} no está prestado: no se suma.` : `${name} no está libre (${device.estado || 'sin estado'}): no se suma.`);
      setQ('');
      return;
    }
    setQueue(current => [...current, device.etiqueta]);
    setQueueNote('');
    setQ('');
  }, [mode, queue]);

  // Lector USB en el Inicio: cae acá (en lote, suma directo a la cola).
  useEffect(() => {
    if (!scan?.code) return;
    if (batch) {
      const hits = resolveDeviceMatches(devices, scan.code);
      if (hits.length === 1) addToQueue(hits[0]);
      else { setQ(scan.code); setQueueNote(hits.length ? 'Hay más de un equipo posible: elegí uno.' : `Sin «${scan.code}».`); }
    } else {
      setLendList(null);
      setQ(scan.code);
    }
    focusBar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scan?.nonce]);

  const doReturn = async (tags: string[]) => {
    if (readOnly || !tags.length) return;
    const ok = await actions.returnDevices(tags, status.show);
    if (ok) { reset(); focusBar(); }
  };

  const submitLend = async () => {
    if (readOnly || sending) return;
    if (!lendTags.length) { setLendError(['person', 'Sumá al menos un equipo libre.']); return; }
    const invalid = validateDraft(draft, options);
    if (invalid) { setLendError(invalid); return; }
    setSending(true);
    const result = await actions.lendDevices(lendTags, draftPayload(draft), status.show);
    setSending(false);
    if (!result.ok) { setLendError(['person', result.error || 'No se pudo registrar el préstamo.']); return; }
    reset();
    focusBar();
  };

  /** Enter: la acción principal de lo que se ve. */
  const primary = () => {
    if (lendOpen && mode !== 'lend') { void submitLend(); return; }
    const picked = pickList[active];
    if (batch) {
      const device = found || (matches.length > 1 ? picked : undefined);
      if (device) addToQueue(device);
      else if (!q.trim() && mode === 'return' && queue.length) void doReturn(queue);
      else if (!q.trim() && mode === 'lend' && queue.length) void submitLend();
      return;
    }
    if (!found) { if (picked) setQ(picked.etiqueta); return; }
    if (readOnly) return;
    const state = loanOf(found);
    if (state === 'loaned') void doReturn([found.etiqueta]);
    else if (state === 'available') openLend([found.etiqueta]);
    else {
      const free = nearestFree(devices, found);
      if (free) openLend([free.etiqueta]);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') { event.preventDefault(); primary(); return; }
    if (event.key === 'Escape') { if (q || lendOpen || batch) { event.preventDefault(); event.stopPropagation(); reset(); } return; }
    if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && pickList.length > 1) {
      event.preventDefault();
      setActive(current => (event.key === 'ArrowDown' ? Math.min(pickList.length - 1, current + 1) : Math.max(0, current - 1)));
    }
  };

  const camera = useQrCamera(code => {
    if (batch) {
      const hits = resolveDeviceMatches(devices, code);
      if (hits.length === 1) { addToQueue(hits[0]); return; }
    }
    setLendList(null);
    setQ(code);
    focusBar();
  });

  const toggleBatch = (next: Mode) => {
    if (mode === next) { reset(); return; }
    reset();
    setMode(next);
    setQueue([]);
    focusBar();
  };

  const showResult = Boolean(q.trim()) || batch || Boolean(lendList) || camera.open || Boolean(camera.error);
  const enterHint = lendOpen && mode !== 'lend' ? 'confirma el préstamo'
    : batch ? (found ? 'suma a la cola' : queue.length && !q.trim() ? (mode === 'return' ? `devuelve ${queue.length}` : `presta ${queue.length}`) : 'suma a la cola')
      : found ? (loanOf(found) === 'loaned' ? 'devuelve' : loanOf(found) === 'available' ? 'abre el préstamo' : 'elige el libre más cercano')
        : pickList.length ? 'elige' : 'acción principal';

  return (
    <section className="dash-bar-wrap" aria-label="Prestar o devolver">
      <div className="dash-bar">
        <Input
          ref={inputRef}
          className="dash-bar-field"
          aria-label="Escaneá o escribí un equipo"
          placeholder="Escaneá o escribí un equipo — touch 34, D1436, plani 5"
          autoComplete="off"
          spellCheck={false}
          value={q}
          data-dash-bar=""
          onValueChange={value => { setQ(value); if (!batch && lendList && lendList.length === 1) setLendList(null); setQueueNote(''); }}
          onKeyDown={onKeyDown}
          prefix={<ScanLine size={18} strokeWidth={1.6} aria-hidden="true" />}
          suffix={(
            <span className="dash-bar-suffix">
              {(q || lendOpen || batch) && <IconButton size="sm" label="Limpiar (Esc)" icon={<icons.IconX size={14} />} onClick={() => { reset(); focusBar(); }} />}
              <Kbd className="dash-only-wide">/</Kbd>
            </span>
          )}
        />
        <div className="dash-bar-btns">
          <IconButton className="dash-cam-btn" variant="secondary" label="Escanear QR con la cámara" icon={<Camera size={18} strokeWidth={1.6} />} onClick={() => (camera.open ? camera.stop() : void camera.start())} pressed={camera.open} />
          <Button variant="secondary" icon={<PackagePlus size={16} strokeWidth={1.6} />} aria-pressed={mode === 'lend'} className={cx(mode === 'lend' && 'is-on')} disabled={readOnly} onClick={() => toggleBatch('lend')}>
            Prestar<span className="dash-only-wide"> varios</span>
          </Button>
          <Button variant="secondary" icon={<PackageMinus size={16} strokeWidth={1.6} />} aria-pressed={mode === 'return'} className={cx(mode === 'return' && 'is-on')} disabled={readOnly} onClick={() => toggleBatch('return')}>
            Devolver<span className="dash-only-wide"> varios</span>
          </Button>
        </div>
      </div>

      {showResult && (
        <div id="dash-res" className="dash-res ui-enter" role="region" aria-label="Resultado">
          {(camera.open || camera.error) && (
            <div className="dash-res-cam">
              {camera.open && <video ref={camera.videoRef} className="dash-cam-video" muted playsInline aria-label="Cámara: apuntá al QR del equipo" />}
              {camera.error && <StatusText tone="warn">{camera.error}</StatusText>}
              <Button size="sm" variant="ghost" onClick={() => { camera.stop(); camera.clearError(); }}>Cerrar cámara</Button>
            </div>
          )}

          {batch && (
            <div className="dash-res-batch">
              <div className="dash-row-wrap">
                <span className="dash-res-title">{mode === 'return' ? 'Devolver varios' : 'Prestar varios'}</span>
                <span className="dash-res-hint">Escaneá uno tras otro: cada Enter suma a la cola y confirmás una sola vez.</span>
                <Button size="sm" variant="ghost" onClick={() => { reset(); focusBar(); }}>Cancelar</Button>
              </div>
              <div className="dash-queue" aria-live="polite">
                {queue.map(tag => {
                  const device = byTag.get(tag);
                  return (
                    <span key={tag} className="dash-qchip">
                      <span className="dash-qchip-name">{device ? aliasOf(device) : tag}</span>
                      <span className="ui-mono dash-qchip-tag">{tag}</span>
                      <IconButton size="sm" label={`Sacar ${device ? aliasOf(device) : tag} de la cola`} icon={<icons.IconX size={12} />} onClick={() => setQueue(current => current.filter(item => item !== tag))} />
                    </span>
                  );
                })}
                {!queue.length && <span className="dash-res-hint">Cola vacía. Escaneá el primero.</span>}
              </div>
              {queueNote && <StatusText tone="warn">{queueNote}</StatusText>}
            </div>
          )}

          {found && !(lendList && lendList.length > 1) && (
            <FoundCard
              device={found}
              devices={devices}
              batch={batch}
              inQueue={queue.includes(found.etiqueta)}
              wantLoaned={mode === 'return'}
              readOnly={readOnly}
              readOnlyReason={readOnlyReason}
              lendOpen={lendOpen}
              busy={actions.busy.has(found.etiqueta)}
              ficha={ficha}
              onFicha={() => setFicha(value => !value)}
              onReturn={() => void doReturn([found.etiqueta])}
              onLend={tag => openLend([tag])}
              onAdd={() => addToQueue(found)}
              onProfile={() => onProfile(found)}
            />
          )}

          {!found && q.trim() && matches.length > 1 && (
            <PickList
              title={`${matches.length} coincidencias${matches.length > pickList.length ? ` · mostrando ${pickList.length}, seguí escribiendo` : ''}`}
              items={pickList}
              active={active}
              onActive={setActive}
              onPick={device => { setQ(device.etiqueta); focusBar(); }}
              footer={matches.length > pickList.length ? <Button size="sm" variant="ghost" onClick={() => onShowInList(q)}>+{matches.length - pickList.length} más · ver en la lista</Button> : null}
            />
          )}

          {!found && q.trim() && !matches.length && (
            <div className="dash-res-none">
              <div className="dash-row-wrap">
                <span className="dash-res-title">Sin «{q.trim()}».</span>
                <span className="dash-res-hint">{suggestions.length ? '¿Quisiste decir…?' : 'No hay un equipo así en esta sede.'}</span>
              </div>
              {suggestions.length > 0 && <PickList items={suggestions} active={active} onActive={setActive} onPick={device => { setQ(device.etiqueta); focusBar(); }} />}
            </div>
          )}

          {batch && !q.trim() && !queue.length && <div className="dash-res-idle">Esperando el próximo equipo…</div>}

          {lendOpen && !readOnly && (mode === 'lend' || lendList) && (
            <LendForm
              title={mode === 'lend' ? 'Datos del préstamo (uno para toda la cola)' : lendTags.length === 1 ? `Prestar ${aliasOf(byTag.get(lendTags[0]) || ({ etiqueta: lendTags[0] } as Device))}` : `Prestar ${lendTags.length} equipos`}
              chips={mode !== 'lend' && lendTags.length > 1 ? lendTags.map(tag => byTag.get(tag)).filter((device): device is Device => Boolean(device)) : []}
              cta={mode === 'lend' ? `Prestar ${queue.length}` : lendTags.length > 1 ? `Prestar ${lendTags.length}` : 'Confirmar préstamo'}
              options={options}
              draft={draft}
              setDraft={next => { setDraft(next); setLendError(null); }}
              error={lendError}
              sending={sending}
              autoFocus={mode !== 'lend'}
              onSubmit={() => void submitLend()}
              onCancel={() => { if (batch) reset(); else { setLendList(null); setLendError(null); } focusBar(); }}
              onMoreOptions={lendTags.length === 1 ? () => onOpenLoans(lendTags[0]) : undefined}
            />
          )}

          {mode === 'return' && (
            <div className="dash-row-wrap dash-res-foot">
              <span className="dash-res-hint dash-grow">{queue.length ? `${queue.length} ${queue.length === 1 ? 'equipo' : 'equipos'} en la cola` : 'Sumá equipos con Enter.'}</span>
              <Button variant="primary" disabled={!queue.length || readOnly} loading={queue.some(tag => actions.busy.has(tag))} loadingLabel="Devolviendo…" onClick={() => void doReturn(queue)}>
                Devolver {queue.length}
              </Button>
            </div>
          )}

          <div className="dash-res-keys">
            <span className="dash-nw"><Kbd>↵</Kbd> {enterHint}</span>
            <span className="dash-nw"><Kbd>Esc</Kbd> limpia</span>
            {pickList.length > 1 && <span className="dash-nw"><Kbd>↑</Kbd><Kbd>↓</Kbd> eligen</span>}
            <span className="dash-res-hint dash-only-wide dash-grow dash-end">Con el lector USB, en Inicio lo escaneado cae acá.</span>
          </div>
        </div>
      )}

      {status.element && <div className="dash-status">{status.element}</div>}
    </section>
  );
}

/* ── Equipo encontrado ──────────────────────────────────────────────────── */

function FoundCard({ device, devices, batch, inQueue, wantLoaned, readOnly, readOnlyReason, lendOpen, busy, ficha, onFicha, onReturn, onLend, onAdd, onProfile }: {
  device: Device;
  devices: Device[];
  batch: boolean;
  inQueue: boolean;
  wantLoaned: boolean;
  readOnly: boolean;
  readOnlyReason: string;
  lendOpen: boolean;
  busy: boolean;
  ficha: boolean;
  onFicha: () => void;
  onReturn: () => void;
  onLend: (etiqueta: string) => void;
  onAdd: () => void;
  onProfile: () => void;
}) {
  const state = loanOf(device);
  const st = stateText(device);
  const free = state === 'blocked' ? nearestFree(devices, device) : undefined;
  const where = whereOf(device);
  const detail = state === 'loaned'
    ? [device.prestadoA, device.rol, where].filter(Boolean).join(' · ') + (device.loanedAt ? ` · ${agoText(Date.now() - new Date(device.loanedAt).getTime())}` : '')
    : state === 'available'
      ? `${[device.marca, device.modelo].filter(Boolean).join(' ') || device.dispositivo || 'Equipo'} · en el mostrador, listo para prestar`
      : `No se puede prestar: está ${device.estado || 'fuera de servicio'}.`;
  const canAdd = batch && !inQueue && state === (wantLoaned ? 'loaned' : 'available');
  return (
    <div className="dash-found" data-device-result={device.etiqueta}>
      <div className="dash-found-main">
        <div className="dash-found-info">
          <div className="dash-found-head">
            <span className="dash-found-alias">{aliasOf(device)}</span>
            <span className="ui-mono dash-found-tag">{device.etiqueta}</span>
            <StatusText tone={st.tone} strong={st.tone !== 'normal'}>{st.text}</StatusText>
          </div>
          <div className="dash-found-detail">{detail}</div>
          {free && <div className="dash-found-detail">Libre más cercano: <b>{aliasOf(free)}</b> <span className="ui-mono">{free.etiqueta}</span></div>}
          {batch && inQueue && <StatusText tone="warn">Ya está en la cola.</StatusText>}
          {batch && !inQueue && !canAdd && <StatusText tone="warn">{wantLoaned ? 'No está prestado: no se puede devolver.' : 'No está libre: no se puede prestar.'}</StatusText>}
        </div>
        <div className="dash-found-acts">
          {readOnly && !batch && state !== 'blocked' && (
            <>
              <Button variant="primary" disabled icon={<icons.IconLock size={14} />}>{state === 'loaned' ? 'Devolver' : 'Prestar'}</Button>
              <span className="dash-res-hint">{readOnlyReason}</span>
            </>
          )}
          {!readOnly && !batch && state === 'loaned' && (
            <Button variant="primary" loading={busy} loadingLabel="Devolviendo…" iconEnd={<Kbd>↵</Kbd>} onClick={onReturn}>Devolver</Button>
          )}
          {!readOnly && !batch && state === 'available' && !lendOpen && (
            <Button variant="primary" iconEnd={<Kbd>↵</Kbd>} onClick={() => onLend(device.etiqueta)}>Prestar</Button>
          )}
          {!readOnly && !batch && free && (
            <Button variant="primary" iconEnd={<Kbd>↵</Kbd>} onClick={() => onLend(free.etiqueta)}>Prestar {aliasOf(free)}</Button>
          )}
          {!readOnly && canAdd && <Button variant="primary" iconEnd={<Kbd>↵</Kbd>} onClick={onAdd}>Agregar a la cola</Button>}
          <Button variant="ghost" aria-expanded={ficha} onClick={onFicha}>{ficha ? 'Ocultar ficha' : 'Ficha'}</Button>
        </div>
      </div>
      {ficha && (
        <div className="dash-found-ficha ui-enter">
          <dl className="dash-kv">
            {fichaFields(device).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}
          </dl>
          <Button size="sm" variant="ghost" onClick={onProfile}>Ficha completa</Button>
        </div>
      )}
    </div>
  );
}

/* ── Lista para elegir (ambiguo / parecidos) ────────────────────────────── */

function PickList({ title, items, active, onActive, onPick, footer }: { title?: string; items: Device[]; active: number; onActive: (index: number) => void; onPick: (device: Device) => void; footer?: ReactNode }) {
  return (
    <div className="dash-pick">
      {title && <div className="dash-res-hint dash-pick-title">{title}</div>}
      <div role="listbox" aria-label={title || 'Parecidos'} className="dash-pick-list">
        {items.map((device, index) => {
          const st = stateText(device);
          return (
            <div
              key={device.id}
              role="option"
              aria-selected={index === active}
              className={cx('dash-pick-item', index === active && 'is-active')}
              onMouseDown={event => event.preventDefault()}
              onPointerMove={() => { if (index !== active) onActive(index); }}
              onClick={() => onPick(device)}
            >
              <span className="dash-pick-alias">{aliasOf(device)}</span>
              <span className="ui-mono dash-pick-tag">{device.etiqueta}</span>
              <StatusText tone={st.tone} className="dash-pick-state">{st.text}</StatusText>
              <span className="dash-pick-who dash-only-wide">{device.prestadoA ? [device.prestadoA, whereOf(device)].filter(Boolean).join(' · ') : ''}</span>
              {index === active && <Kbd className="dash-only-wide">↵</Kbd>}
            </div>
          );
        })}
      </div>
      {footer}
    </div>
  );
}

/* ── Préstamo en línea ──────────────────────────────────────────────────── */

function LendForm({ title, chips, cta, options, draft, setDraft, error, sending, autoFocus, onSubmit, onCancel, onMoreOptions }: {
  title: string;
  chips: Device[];
  cta: string;
  options: LoanOptions;
  draft: LendDraft;
  setDraft: (next: LendDraft) => void;
  error: [keyof LendDraft, string] | null;
  sending: boolean;
  autoFocus: boolean;
  onSubmit: () => void;
  onCancel: () => void;
  onMoreOptions?: () => void;
}) {
  const [found, setFound] = useState<LoanSuggestion[]>([]);
  const [frequent, setFrequent] = useState<LoanSuggestion[]>([]);
  const set = (patch: Partial<LendDraft>) => setDraft({ ...draft, ...patch });
  const location = options.locations.find(item => item.label === draft.location);
  const reason = options.motives.find(item => item.label === draft.reason);
  const errorOf = (field: keyof LendDraft) => (error && error[0] === field ? true : undefined);

  // Frecuentes: las personas más prestadas (una vez por apertura, caché de 15 s).
  useEffect(() => {
    let alive = true;
    getLoanSuggestions('').then(response => { if (alive) setFrequent((response.suggestions || []).slice(0, 5)); }).catch(() => undefined);
    return () => { alive = false; };
  }, []);

  // Sugerencias por historial al tipear (≥ 2 letras, 220 ms).
  useEffect(() => {
    const term = draft.person.trim();
    if (term.length < 2) { setFound([]); return; }
    let alive = true;
    const timer = window.setTimeout(() => {
      getLoanSuggestions(term).then(response => { if (alive) setFound(response.suggestions || []); }).catch(() => { if (alive) setFound([]); });
    }, 220);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [draft.person]);

  const personOptions: SelectOption[] = found.map(item => ({
    value: item.persona,
    label: item.persona,
    hint: [item.rol, item.curso || item.ubicacion, `${item.count}×`].filter(Boolean).join(' · ')
  }));
  const pickPerson = (name: string) => {
    const suggestion = [...found, ...frequent].find(item => item.persona === name);
    setDraft(suggestion ? applySuggestion(draft, suggestion, options) : { ...draft, person: name });
  };
  const opt = (list: string[]) => list.map(value => ({ value, label: value }));

  return (
    <form
      className="dash-lend"
      data-scanner-ignore=""
      onSubmit={event => { event.preventDefault(); onSubmit(); }}
      onKeyDown={event => { if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); onCancel(); } }}
    >
      <div className="dash-row-wrap">
        <span className="dash-res-title">{title}</span>
        {chips.map(device => (
          <span key={device.etiqueta} className="dash-qchip dash-qchip--static">
            <span className="dash-qchip-name">{aliasOf(device)}</span>
            <span className="ui-mono dash-qchip-tag">{device.etiqueta}</span>
          </span>
        ))}
      </div>
      <div className="dash-lend-fields">
        <Combobox
          className="dash-lend-person"
          label="Persona"
          required
          value={draft.person}
          onChange={value => set({ person: value })}
          onSelect={option => pickPerson(option.value)}
          onEnter={() => onSubmit()}
          options={personOptions}
          minChars={2}
          placeholder="Nombre"
          autoFocus={autoFocus}
          error={errorOf('person')}
        />
        <Select className="dash-lend-sel" label="Rol" required value={draft.role} onChange={value => set({ role: value })} options={opt(options.roles)} placeholder="Elegir" error={errorOf('role')} />
        <Select className="dash-lend-sel" label="Ubicación" required value={draft.location} onChange={value => set({ location: value })} options={options.locations.map(item => ({ value: item.label, label: item.label }))} placeholder="Elegir" error={errorOf('location')} />
        {location?.requiresCourse && (
          <>
            <Select className="dash-lend-sel dash-lend-sel--sm" label="Nivel" required value={draft.schoolLevel} onChange={value => set({ schoolLevel: value })} options={opt(SCHOOL_LEVELS)} placeholder="EP/ES" error={errorOf('schoolLevel')} />
            <Select className="dash-lend-sel dash-lend-sel--sm" label="Curso" required value={draft.course} onChange={value => set({ course: value })} options={opt(options.grades)} placeholder="Curso" error={errorOf('course')} />
          </>
        )}
        {location?.requiresDetail && <Input className="dash-lend-sel" label="Especificar ubicación" required value={draft.locationDetail} onValueChange={value => set({ locationDetail: value })} error={errorOf('locationDetail')} />}
        <Select className="dash-lend-sel" label="Motivo" value={draft.reason} onChange={value => set({ reason: value })} options={[{ value: '', label: 'Sin motivo' }, ...options.motives.map(item => ({ value: item.label, label: item.label }))]} placeholder="Sin motivo" />
        {reason?.requiresDetail && <Input className="dash-lend-sel" label="Especificar motivo" required value={draft.reasonDetail} onValueChange={value => set({ reasonDetail: value })} error={errorOf('reasonDetail')} />}
      </div>
      {frequent.length > 0 && (
        <div className="dash-row-wrap dash-lend-freq" role="group" aria-label="Personas frecuentes">
          <span className="dash-res-hint">Frecuentes</span>
          {frequent.map(item => (
            <button
              key={item.persona}
              type="button"
              className={cx('dash-freq', draft.person === item.persona && 'is-on')}
              aria-pressed={draft.person === item.persona}
              onClick={() => setDraft(applySuggestion(draft, item, options))}
            >
              <span className="dash-freq-name">{item.persona}</span>
              <span className="dash-freq-hint dash-only-wide">{[item.rol, item.curso || item.ubicacion].filter(Boolean).join(' · ')}</span>
            </button>
          ))}
        </div>
      )}
      <div className="dash-row-wrap dash-lend-foot">
        {error && <span role="alert" className="dash-lend-error">{error[1]}</span>}
        <span className="dash-grow" />
        {onMoreOptions && <Button size="sm" variant="ghost" onClick={onMoreOptions}>Accesorios y más en Préstamos</Button>}
        <Button size="sm" variant="ghost" onClick={onCancel}>Cancelar</Button>
        <Button className="dash-lend-cta" type="submit" variant="primary" loading={sending} loadingLabel="Prestando…" iconEnd={<Kbd>↵</Kbd>}>{cta}</Button>
      </div>
    </form>
  );
}

/* ── Atajos (en línea, con ?) ───────────────────────────────────────────── */

const SHORTCUTS: Array<[ReactNode, string]> = [
  [<Kbd key="s">/</Kbd>, 'enfoca la barra (el lector USB escribe acá)'],
  [<Kbd key="e">↵</Kbd>, 'acción principal: devolver, prestar, sumar a la cola'],
  [<Kbd key="x">Esc</Kbd>, 'limpia la barra o cierra el préstamo'],
  [<><Kbd>↑</Kbd><Kbd>↓</Kbd></>, 'recorren coincidencias y filas de la lista'],
  [<><Kbd>Ctrl</Kbd> / <Kbd>⌘</Kbd> / <Kbd>Shift</Kbd> + clic</>, 'marcan filas (Shift marca el rango)'],
  [<Kbd key="q">?</Kbd>, 'muestra u oculta estos atajos']
];

export function Shortcuts() {
  return (
    <dl className="dash-keys ui-enter" aria-label="Atajos del Inicio">
      {SHORTCUTS.map(([keys, desc]) => <div key={desc}><dt>{keys}</dt><dd>{desc}</dd></div>)}
    </dl>
  );
}
