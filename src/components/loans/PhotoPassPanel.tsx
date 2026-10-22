import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import {
  getPhotoPasses, getPhotoPassOptions, lendPhotoPass, returnPhotoPass,
  type PhotoPass, type PhotoPassOptions
} from '../../services/photoPassesApi';
import { formatTimeOnly } from '../../utils/formatters';
import { Button, Kbd } from '../../ui/Button';
import { Input } from '../../ui/Field';
import { useStatusLine } from '../../ui/StatusSlot';
import { ErrorState } from '../../ui/Data';
import { TruncatedText } from '../../ui/Truncated';
import { Collapse, keepInPlace } from '../../ui/Collapse';
import { Dialog } from '../../ui/Dialog';
import { fold, cx } from '../../ui/util';
import { PersonSuggestInput } from './PersonSuggestInput';
import { ChipLegend, GroupToggle, LazyBody, Reveal, SelectModeButton, SelectionBar, SelectionSwap, batchResultMessage, isMarkClick, useHeldList, usePanelOpen } from './ChipPanelKit';
import { SuccessCheck } from './ScanMessage';

/**
 * Cartelitos de autorización de fotos, dentro de Préstamos.
 *
 * Se le entregan a un alumno, y hay que dejar registrado de qué curso es y con
 * qué docente está. No hay padrón de alumnos: los nombres se aprenden solos.
 * Los docentes y cursos salen de datos que ya existen (horarios y préstamos).
 *
 * Misma gramática que los equipos: clic en uno libre abre el formulario de
 * entrega EN LÍNEA (arriba de la grilla); clic en uno entregado lo devuelve
 * (con Deshacer); Ctrl/Cmd/Shift + clic marca sin actuar y prende el modo
 * selección (Shift sobre otro marca el rango); "Entregar N" usa un solo
 * formulario para todos (el nombre pasa a ser "Responsable").
 */
const EMPTY = { persona: '', curso: '', docente: '', motivo: '' };

// Cuántos cartelitos dibujar mientras llega la respuesta: arranca en el tamaño
// sembrado por defecto (30) y después de la primera carga es exacto.
let ultimoTotalConocido = 30;

const isPrestado = (pass: PhotoPass) => pass.estado === 'Prestado';
const isDisponible = (pass: PhotoPass) => !pass.estado || pass.estado === 'Disponible';

export function PhotoPassPanel({ consultationMode }: { consultationMode: boolean }) {
  const [items, setItems] = useState<PhotoPass[]>([]);
  const [options, setOptions] = useState<PhotoPassOptions>({ alumnos: [], cursos: [], docentes: [] });
  const [lending, setLending] = useState<PhotoPass[] | null>(null);
  // El diálogo se cierra mostrando lo último (no se vacía a mitad de la salida).
  const lastLending = useRef<PhotoPass[] | null>(null);
  if (lending) lastLending.current = lending;
  const shownLending = lending || lastLending.current;
  const [form, setForm] = useState(EMPTY);
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [confirming, setConfirming] = useState(false);
  const [open, setOpen] = usePanelOpen('photo-passes');
  const anchor = useRef<string | null>(null);
  const alumnoRef = useRef<HTMLInputElement | null>(null);
  const status = useStatusLine();

  const refresh = () => getPhotoPasses()
    .then(response => {
      setItems(response.items);
      setLoadError('');
      if (response.items.length) ultimoTotalConocido = response.items.length;
    })
    .catch(() => setLoadError('No se pudieron cargar los cartelitos.'))
    .finally(() => setLoading(false));

  useEffect(() => {
    void refresh();
  }, []);
  // Las opciones (alumnos, cursos y docentes para autocompletar) solo sirven con
  // el panel abierto: antes se pedían al abrir Préstamos aunque estuviera
  // plegado, y era el pedido más caro de la pantalla.
  const optionsRequested = useRef(false);
  useEffect(() => {
    if (!open || optionsRequested.current) return;
    optionsRequested.current = true;
    getPhotoPassOptions()
      .then(response => setOptions({ alumnos: response.alumnos, cursos: response.cursos, docentes: response.docentes }))
      .catch(() => { optionsRequested.current = false; });
  }, [open]);

  /** Corre la acción sobre cada cartelito, sigue aunque alguno falle y refresca una sola vez. */
  const runBatch = async (list: PhotoPass[], action: (pass: PhotoPass) => Promise<unknown>) => {
    setBusy(true);
    status.clear();
    const errors: string[] = [];
    const done: PhotoPass[] = [];
    for (const pass of list) {
      try {
        await action(pass);
        done.push(pass);
      } catch (reason) {
        errors.push(`${pass.numero}: ${reason instanceof Error ? reason.message : 'error'}`);
      }
    }
    await refresh();
    setBusy(false);
    return { errors, done };
  };

  const exitSelection = () => {
    setSelected(new Set());
    setSelectMode(false);
    setConfirming(false);
    anchor.current = null;
  };

  const prestados = items.filter(isPrestado);
  const heldOut = useHeldList(prestados, pass => String(pass.numero));
  const libres = items.filter(isDisponible);
  const seleccionables = useMemo(() => items.filter(pass => isPrestado(pass) || isDisponible(pass)).map(pass => String(pass.numero)), [items]);
  const marcados = items.filter(pass => selected.has(String(pass.numero)));
  const toLend = marcados.filter(isDisponible);
  const toReturn = marcados.filter(isPrestado);

  // Al cerrar, el foco vuelve al cartelito tocado (o al primero del lote).
  const returnTo = useRef<string | null>(null);
  const openLend = (list: PhotoPass[]) => {
    setForm(EMPTY);
    setFormError('');
    returnTo.current = list[0] ? String(list[0].numero) : null;
    setLending(list);
  };
  const closeLend = () => { setLending(null); setFormError(''); };

  // Deshacer de cartelitos con las rutas de siempre: devolver lo entregado, o
  // volver a entregar lo devuelto con los mismos datos.
  const undoReturn = async (list: PhotoPass[], text: string) => {
    const { errors } = await runBatch(list, pass => lendPhotoPass(pass.numero, { persona: pass.prestadoA, curso: pass.curso, docente: pass.docente, motivo: pass.motivo }));
    status.show(errors.length ? { tone: 'bad', message: `No se pudo deshacer: ${errors.join('; ')}` } : { tone: 'info', message: `Se deshizo: ${text}` });
  };
  const undoLend = async (list: PhotoPass[], text: string) => {
    const { errors } = await runBatch(list, pass => returnPhotoPass(pass.numero));
    status.show(errors.length ? { tone: 'bad', message: `No se pudo deshacer: ${errors.join('; ')}` } : { tone: 'info', message: `Se deshizo: ${text}` });
  };

  const returnPasses = async (list: PhotoPass[]) => {
    if (!list.length) return;
    const { errors, done } = await runBatch(list, pass => returnPhotoPass(pass.numero));
    if (list.length === 1) {
      if (errors.length) { status.show({ tone: 'bad', message: errors[0] }); return; }
      const pass = list[0];
      const text = `Cartelito ${pass.numero} devuelto${pass.prestadoA ? ` · lo tenía ${pass.prestadoA}` : ''}`;
      status.show({ tone: 'ok', icon: <SuccessCheck />, message: text, undo: { seconds: 8, onUndo: () => undoReturn(done, text) } });
      return;
    }
    const result = batchResultMessage('Se devolvieron', 'cartelitos', list.length, errors);
    status.show({ tone: result.tone === 'ok' ? 'ok' : 'warn', message: result.text, undo: done.length ? { seconds: 8, onUndo: () => undoReturn(done, `se devolvieron ${done.length} cartelitos`) } : undefined });
  };

  const submitLend = async () => {
    if (!lending || busy || consultationMode) return;
    if (!form.persona.trim()) { setFormError(lending.length > 1 ? 'Completá el responsable.' : 'Completá el alumno.'); alumnoRef.current?.focus(); return; }
    const list = lending;
    const payload = { persona: form.persona.trim(), curso: form.curso.trim(), docente: form.docente.trim(), motivo: form.motivo.trim() };
    const { errors, done } = await runBatch(list, pass => lendPhotoPass(pass.numero, payload));
    if (done.length) {
      setLending(null);
      if (list.length > 1) exitSelection();
    } else {
      setFormError(errors[0] || 'No se pudo entregar.');
      return;
    }
    const text = list.length === 1
      ? `Cartelito ${list[0].numero} entregado a ${payload.persona}${payload.curso ? ` · ${payload.curso}` : ''}`
      : batchResultMessage('Se entregaron', 'cartelitos', list.length, errors).text;
    status.show({ tone: errors.length ? 'warn' : 'ok', icon: errors.length ? undefined : <SuccessCheck />, message: text, undo: { seconds: 8, onUndo: () => undoLend(done, text) } });
  };

  const onChipClick = (event: MouseEvent, pass: PhotoPass) => {
    const key = String(pass.numero);
    if (selectMode || isMarkClick(event)) {
      event.preventDefault();
      // Al entrar en selección aparecen "Todos / Ninguno": el chip tocado no se corre.
      if (!selectMode) { keepInPlace(event.currentTarget as HTMLElement, { duration: 120 }); setSelectMode(true); }
      setConfirming(false);
      const from = anchor.current;
      if (event.shiftKey && from && from !== key) {
        const a = seleccionables.indexOf(from);
        const b = seleccionables.indexOf(key);
        if (a >= 0 && b >= 0) {
          const range = seleccionables.slice(Math.min(a, b), Math.max(a, b) + 1);
          setSelected(current => new Set([...current, ...range]));
          anchor.current = key;
          return;
        }
      }
      anchor.current = key;
      setSelected(current => {
        const next = new Set(current);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
      return;
    }
    if (isPrestado(pass)) void returnPasses([pass]);
    else openLend([pass]);
  };

  const cursoQuery = fold(form.curso);
  const cursoSuggestions = options.cursos.filter(curso => !cursoQuery || fold(curso).includes(cursoQuery)).filter(curso => curso !== form.curso).slice(0, 12);

  return (
    <section className="lo-card lo-chips lo-passes" aria-labelledby="lo-passes-title" data-loans-grid="passes" data-select-mode={selectMode ? 'on' : 'off'}>
      <SelectionSwap active={selectMode} bar={(
        <SelectionBar
          label="Selección de cartelitos"
          count={marcados.length}
          hint="Seguí marcando o elegí qué hacer."
          idleHint="Tocá los cartelitos que quieras marcar."
          onClear={() => { setSelected(new Set()); setConfirming(false); anchor.current = null; }}
          onDone={exitSelection}
          confirm={confirming && toReturn.length > 1 ? {
            message: `¿Devolver ${toReturn.length} cartelitos?`,
            detail: toReturn.map(pass => pass.numero).join(' · '),
            confirmLabel: `Devolver ${toReturn.length}`,
            onConfirm: () => { const list = toReturn; exitSelection(); void returnPasses(list); },
            onCancel: () => setConfirming(false)
          } : null}
          actions={(
            <>
              {(selectMode && seleccionables.length > 0) && (
                <span className="lo-group-all">
                  <Button size="sm" variant="ghost" onClick={() => setSelected(new Set(seleccionables))}>Todos</Button>
                  <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Ninguno</Button>
                </span>
              )}
              {toLend.length > 0 && <Button size="sm" variant="primary" disabled={busy || consultationMode} onClick={() => openLend(toLend)}>Entregar {toLend.length}</Button>}
              {toReturn.length > 0 && <Button size="sm" variant="secondary" disabled={busy || consultationMode} onClick={() => { if (toReturn.length > 1) setConfirming(true); else { const list = toReturn; exitSelection(); void returnPasses(list); } }}>Devolver {toReturn.length}</Button>}
            </>
          )}
        />
      )}>
        <div className="lo-card-head lo-passes-head">
          <GroupToggle
            open={open}
            onToggle={() => setOpen(!open)}
            title="Cartelitos de fotos"
            free={libres.length}
            total={items.length}
            loading={loading}
            out=""
            controls="lo-passes-body"
          />
          {/* Fuera del botón: en angosto baja con "Varios" al mismo renglón (no queda un botón solo en una fila). */}
          <span className="lo-group-meta lo-passes-meta">
            <span className="lo-group-out">{loading ? '' : `${prestados.length} ${prestados.length === 1 ? 'entregado' : 'entregados'}`}</span>
          </span>
          <SelectModeButton disabled={consultationMode || loading} onClick={() => { setSelectMode(true); if (!open) setOpen(true); }} />
        </div>
      </SelectionSwap>
      <h2 id="lo-passes-title" className="ui-sr">Cartelitos de fotos</h2>

      {status.slot('lo-card-status')}

      <LazyBody open={open || selectMode} className="lo-passes-body">
        <div id="lo-passes-body">
          <Reveal when={Boolean(loadError)}>
            {loadError && <ErrorState message={loadError} onRetry={() => { setLoading(true); void refresh(); }} retrying={loading} />}
          </Reveal>

          <p className="lo-help lo-passes-help">
            <span className="lo-long">Clic: libre lo entrega, entregado lo devuelve. Ctrl/⌘/Shift + clic marca varios.</span>
            <span className="lo-short">Tocá uno libre para entregarlo; uno entregado, para devolverlo. "Varios" marca varios.</span>
          </p>
          <ChipLegend items={[['free', 'Libre'], ['loaned', 'Entregado'], ['blocked', 'Perdido o fuera de uso'], ['selected', 'Marcado']]} />
          <div className="lo-chip-grid" role="group" aria-label="Cartelitos">
            {loading && Array.from({ length: ultimoTotalConocido }, (_, index) => (
              <span className="lo-chip lo-chip-skel" key={index} aria-hidden="true" style={{ animationDelay: `calc(${index % 10} * var(--g-dur-fast) / 2)` }} />
            ))}
            {!loading && items.map(pass => {
              const prestado = isPrestado(pass);
              const bloqueado = !prestado && !isDisponible(pass);
              const marked = selected.has(String(pass.numero));
              const label = bloqueado
                ? `Cartelito ${pass.numero} — ${pass.estado}, no se puede operar`
                : selectMode
                  ? `Cartelito ${pass.numero} — clic para ${marked ? 'desmarcar' : 'marcar'}`
                  : prestado
                    ? `Cartelito ${pass.numero} — entregado a ${[pass.prestadoA, pass.curso, pass.docente ? `con ${pass.docente}` : ''].filter(Boolean).join(' · ')}, clic para devolver`
                    : `Cartelito ${pass.numero} — libre, clic para entregar`;
              return (
                <button
                  key={pass.numero}
                  type="button"
                  className={cx('lo-chip', prestado ? 'is-loaned' : bloqueado ? 'is-blocked' : 'is-free', marked && 'is-selected')}
                  data-pass={pass.numero}
                  disabled={consultationMode || busy || bloqueado}
                  aria-pressed={selectMode && !bloqueado ? marked : undefined}
                  aria-label={label}
                  onMouseDown={event => { if (event.shiftKey) event.preventDefault(); }}
                  onClick={event => onChipClick(event, pass)}
                >
                  {pass.numero}
                </button>
              );
            })}
          </div>
          {/* Entregar o devolver suma o saca su renglón plegándose. */}
          <Reveal when={prestados.length > 0}>
            <div className="lo-out-list">
              {heldOut.rows.map(({ key, item: pass, open: rowOpen, appear }) => (
                <Collapse key={key} open={rowOpen} appear={appear} unmountOnClose reveal={false} onSettled={value => { if (!value) heldOut.release(key); }}>
                  <div className="lo-out-row">
                    <span className="lo-out-num g-num is-loaned">{pass.numero}</span>
                    <TruncatedText className="lo-out-who">{[pass.prestadoA, pass.curso, pass.docente ? `con ${pass.docente}` : ''].filter(Boolean).join(' · ')}</TruncatedText>
                    <span className="lo-out-time g-num">{formatTimeOnly(pass.loanedAt)}</span>
                  </div>
                </Collapse>
              ))}
            </div>
          </Reveal>
        </div>
      </LazyBody>

      {/* Pop up (pedido del dueño, 20/10): única excepción a "nada de modales". */}
      <Dialog
        open={Boolean(lending)}
        className="lo-pass-dialog"
        title={shownLending ? (shownLending.length === 1 ? `Entregar cartelito ${shownLending[0].numero}` : `Entregar ${shownLending.length} cartelitos`) : ''}
        description={shownLending && shownLending.length > 1 ? 'Un solo formulario para todos: el nombre va como responsable.' : 'Queda registrado de qué curso es y con qué docente está.'}
        dirty={Boolean(form.persona.trim() || form.curso.trim() || form.docente.trim() || form.motivo.trim())}
        onClose={closeLend}
        returnFocus={() => (returnTo.current ? document.querySelector<HTMLElement>(`[data-loans-grid="passes"] .lo-chip[data-pass="${returnTo.current}"]`) : null)}
        footer={shownLending && (
          <>
            <Button variant="primary" loading={busy} loadingLabel="Entregando…" disabled={consultationMode} onClick={() => void submitLend()} iconEnd={<Kbd className="lo-hide-touch">↵</Kbd>}>
              {shownLending.length > 1 ? `Entregar ${shownLending.length}` : 'Entregar'}
            </Button>
            <Button variant="ghost" disabled={busy} onClick={closeLend}>Cancelar</Button>
          </>
        )}
      >
        {shownLending && (
          <div className="lo-pass-form" data-pass-form="" data-scanner-ignore="">
            {shownLending.length > 1 && (
              <span className="lo-pf-chips" aria-label="Cartelitos a entregar">
                {shownLending.map(pass => <span key={pass.numero} className="lo-pf-num g-num">{pass.numero}</span>)}
              </span>
            )}
            <div className="lo-frow">
              <label htmlFor="lo-pf-alumno" className="lo-flabel">{shownLending.length > 1 ? 'Responsable' : 'Alumno'}</label>
              <div className="lo-fcontrol">
                {/* Elegir al alumno completa curso y docente con los que suele venir. */}
                <PersonSuggestInput
                  id="lo-pf-alumno"
                  inputRef={alumnoRef}
                  field="alumno"
                  placeholder="Nombre y apellido"
                  value={form.persona}
                  onChange={persona => { setForm(v => ({ ...v, persona })); setFormError(''); }}
                  onPick={item => setForm(v => ({ ...v, persona: item.nombre, curso: v.curso || item.curso, docente: v.docente || item.docente }))}
                  onEnter={() => void submitLend()}
                />
              </div>
            </div>
            <div className="lo-frow">
              <label htmlFor="lo-pf-curso" className="lo-flabel">Curso</label>
              <div className="lo-fcontrol">
                <Input id="lo-pf-curso" value={form.curso} onValueChange={curso => setForm(v => ({ ...v, curso }))} placeholder="Ej. EP · 5F" autoComplete="off" onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void submitLend(); } }} />
                <Reveal when={cursoSuggestions.length > 0} fold="lo-fold-field">
                  <div className="lo-opts" role="group" aria-label="Cursos conocidos">
                    {cursoSuggestions.map(curso => (
                      <button key={curso} type="button" className="lo-opt lo-opt--mono" onClick={() => setForm(v => ({ ...v, curso }))}>{curso}</button>
                    ))}
                  </div>
                </Reveal>
              </div>
            </div>
            <div className="lo-frow">
              <label htmlFor="lo-pf-docente" className="lo-flabel">Docente a cargo</label>
              <div className="lo-fcontrol">
                <PersonSuggestInput id="lo-pf-docente" field="docente" placeholder="Con quién está" value={form.docente} onChange={docente => setForm(v => ({ ...v, docente }))} onEnter={() => void submitLend()} />
              </div>
            </div>
            <div className="lo-frow">
              <label htmlFor="lo-pf-motivo" className="lo-flabel">Motivo</label>
              <Input id="lo-pf-motivo" className="lo-fcontrol" value={form.motivo} onValueChange={motivo => setForm(v => ({ ...v, motivo }))} placeholder="Acto, salida, proyecto… (opcional)" autoComplete="off" onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void submitLend(); } }} />
            </div>
            <Reveal when={Boolean(formError)}>
              {formError && <span className="lo-form-error t-input is-shaking" role="alert">{formError}</span>}
            </Reveal>
          </div>
        )}
      </Dialog>
    </section>
  );
}
