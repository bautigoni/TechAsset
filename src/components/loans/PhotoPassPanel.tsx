import { useEffect, useState, type MouseEvent } from 'react';
import {
  getPhotoPasses, getPhotoPassOptions, lendPhotoPass, returnPhotoPass,
  type PhotoPass, type PhotoPassOptions
} from '../../services/photoPassesApi';
import { Button } from '../layout/Button';
import { Modal } from '../layout/Modal';
import { PersonSuggestInput } from './PersonSuggestInput';
import { CollapsiblePanel, SelectModeToggle, SelectionBar, batchResultMessage, useChipSelection } from './ChipPanelKit';

/**
 * Cartelitos de autorización de fotos, dentro de Préstamos.
 *
 * Se le entregan a un alumno, y hay que dejar registrado de qué curso es y con
 * qué docente está. No hay padrón de alumnos en la base: los nombres se
 * aprenden solos, cada uno cargado una vez queda para autocompletar. Los
 * docentes y cursos salen de datos que ya existen (horarios y préstamos).
 *
 * Con "Seleccionar varios" (o Ctrl/Shift+clic) se marcan varios y se entregan
 * con un solo formulario —típico de una salida con todo un grupo— o se
 * devuelven todos juntos.
 */
const EMPTY = { persona: '', curso: '', docente: '', motivo: '' };

// Cuántos cartelitos dibujar mientras llega la respuesta. El panel se monta
// con la vista pero sus datos son un pedido aparte, así que sin esto aparecía
// vacío y ~300 ms después crecía de golpe con los 30 chips: se leía como si
// entrara mucho más tarde que el resto de Préstamos. Arranca en el tamaño
// sembrado por defecto y después de la primera carga es exacto.
let ultimoTotalConocido = 30;

const isPrestado = (pass: PhotoPass) => pass.estado === 'Prestado';
const isDisponible = (pass: PhotoPass) => !pass.estado || pass.estado === 'Disponible';

export function PhotoPassPanel({ consultationMode }: { consultationMode: boolean }) {
  const [items, setItems] = useState<PhotoPass[]>([]);
  const [options, setOptions] = useState<PhotoPassOptions>({ alumnos: [], cursos: [], docentes: [] });
  const [lending, setLending] = useState<PhotoPass[] | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ tone: 'ok' | 'warn' | 'error'; text: string } | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const { selected, toggle, toggleMany, clear } = useChipSelection();

  const refresh = () => getPhotoPasses()
    .then(response => {
      setItems(response.items);
      if (response.items.length) ultimoTotalConocido = response.items.length;
    })
    .catch(() => setMessage({ tone: 'error', text: 'No se pudieron cargar los cartelitos.' }))
    .finally(() => setLoading(false));

  useEffect(() => {
    void refresh();
    getPhotoPassOptions()
      .then(response => setOptions({ alumnos: response.alumnos, cursos: response.cursos, docentes: response.docentes }))
      .catch(() => undefined);
  }, []);

  // Corre la acción sobre cada cartelito, sigue aunque alguno falle y refresca
  // una sola vez al final.
  const runBatch = async (list: PhotoPass[], verb: string, action: (pass: PhotoPass) => Promise<unknown>) => {
    setBusy(true);
    setMessage(null);
    const errors: string[] = [];
    for (const pass of list) {
      try {
        await action(pass);
      } catch (reason) {
        errors.push(`${pass.numero}: ${reason instanceof Error ? reason.message : 'error'}`);
      }
    }
    await refresh();
    setBusy(false);
    if (list.length === 1) setMessage(errors.length ? { tone: 'error', text: errors[0] } : null);
    else setMessage(batchResultMessage(verb, 'cartelitos', list.length, errors));
    return errors.length === 0;
  };

  const exitSelection = () => {
    clear();
    setSelectMode(false);
  };

  const prestados = items.filter(isPrestado);
  const seleccionables = items.filter(pass => isPrestado(pass) || isDisponible(pass));
  const marcados = items.filter(pass => selected.has(String(pass.numero)));
  const toLend = marcados.filter(isDisponible);
  const toReturn = marcados.filter(isPrestado);

  const openLend = (list: PhotoPass[]) => {
    setForm(EMPTY);
    setLending(list);
  };

  const returnSelected = async () => {
    const list = toReturn;
    if (list.length > 1 && !window.confirm(`¿Devolver ${list.length} cartelitos?`)) return;
    exitSelection();
    await runBatch(list, 'Se devolvieron', pass => returnPhotoPass(pass.numero));
  };

  const onChipClick = (event: MouseEvent, pass: PhotoPass) => {
    if (selectMode || event.ctrlKey || event.metaKey || event.shiftKey) {
      if (!selectMode) setSelectMode(true);
      toggle(String(pass.numero));
      return;
    }
    if (isPrestado(pass)) void runBatch([pass], 'Se devolvieron', item => returnPhotoPass(item.numero));
    else openLend([pass]);
  };

  const allKeys = seleccionables.map(pass => String(pass.numero));
  const allMarked = allKeys.length > 0 && allKeys.every(key => selected.has(key));

  return (
    <div className="device-pass-stack pass-stack">
      <CollapsiblePanel
        id="photo-passes"
        className="device-pass-panel"
        title="Cartelitos de fotos"
        used={prestados.length}
        total={items.length}
        usedLabel="entregados"
        loading={loading}
        extra={(
          <div className="chip-panel-extra">
            {selectMode && allKeys.length > 0 && (
              <button type="button" className="chip-select-all" onClick={() => toggleMany(allKeys)}>{allMarked ? 'Ninguno' : 'Todos'}</button>
            )}
            <SelectModeToggle
              active={selectMode}
              disabled={consultationMode || loading}
              onChange={next => { if (next) setSelectMode(true); else exitSelection(); }}
            />
          </div>
        )}
      >
        {message && <div className={message.tone === 'ok' ? 'tool-info' : message.tone === 'warn' ? 'tool-warning' : 'tool-error'}>{message.text}</div>}
        <div className="pass-chips">
          {loading && Array.from({ length: ultimoTotalConocido }, (_, index) => (
            <span className="pass-chip-skel t-skel-card" key={index} aria-hidden="true" style={{ animationDelay: `${(index % 10) * 60}ms` }} />
          ))}
          {!loading && items.map(pass => {
            const prestado = isPrestado(pass);
            const bloqueado = !prestado && !isDisponible(pass);
            const marcado = selected.has(String(pass.numero));
            return (
              <button
                key={pass.numero}
                type="button"
                className={`pass-chip ${prestado ? 'is-prestado' : ''} ${bloqueado ? 'is-bloqueado' : ''} ${marcado ? 'is-selected' : ''}`}
                disabled={consultationMode || busy || bloqueado}
                aria-pressed={selectMode ? marcado : undefined}
                title={bloqueado
                  ? `${pass.numero} — ${pass.estado}`
                  : selectMode
                    ? `${pass.numero} — clic para ${marcado ? 'desmarcar' : 'marcar'}`
                    : prestado
                      ? `${pass.prestadoA}${pass.curso ? ` · ${pass.curso}` : ''}${pass.docente ? ` · con ${pass.docente}` : ''} — clic para devolver`
                      : 'Disponible — clic para entregar'}
                onClick={event => onChipClick(event, pass)}
              >
                {pass.numero}
              </button>
            );
          })}
        </div>
        {prestados.length > 0 && (
          <ul className="pass-lent-list">
            {prestados.map(pass => (
              <li key={pass.numero}>
                <b>{pass.numero}</b>
                <span>
                  {pass.prestadoA}
                  {pass.curso && <em>{pass.curso}</em>}
                  {pass.docente && <i>con {pass.docente}</i>}
                </span>
                <time>{pass.loanedAt ? new Date(pass.loanedAt).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) : ''}</time>
              </li>
            ))}
          </ul>
        )}
      </CollapsiblePanel>
      <SelectionBar count={marcados.length} onClear={clear}>
        {toLend.length > 0 && <Button variant="primary" disabled={busy} onClick={() => openLend(toLend)}>Entregar {toLend.length}</Button>}
        {toReturn.length > 0 && <Button variant="success" disabled={busy} onClick={() => void returnSelected()}>Devolver {toReturn.length}</Button>}
      </SelectionBar>

      {lending && (
        <Modal
          title={lending.length === 1 ? `Entregar cartelito ${lending[0].numero}` : `Entregar ${lending.length} cartelitos`}
          onClose={() => setLending(null)}
        >
          <form className="stack" onSubmit={async event => {
            event.preventDefault();
            const list = lending;
            const ok = await runBatch(list, 'Se entregaron', pass => lendPhotoPass(pass.numero, form));
            setLending(null);
            if (ok && list.length > 1) exitSelection();
          }}>
            {lending.length > 1 && (
              <div className="pass-batch-preview" aria-label="Cartelitos a entregar">
                {lending.map(pass => <span key={pass.numero} className="pass-chip is-selected">{pass.numero}</span>)}
              </div>
            )}
            <label>{lending.length > 1 ? 'Responsable' : 'Alumno'}
              {/* Elegir al alumno completa curso y docente con los que suele
                  venir: casi siempre es el mismo, y así queda un solo campo
                  para llenar en vez de tres. */}
              <PersonSuggestInput
                field="alumno"
                required
                autoFocus
                placeholder="Nombre y apellido"
                value={form.persona}
                onChange={persona => setForm(v => ({ ...v, persona }))}
                onPick={item => setForm(v => ({
                  ...v,
                  persona: item.nombre,
                  curso: v.curso || item.curso,
                  docente: v.docente || item.docente
                }))}
              />
            </label>
            <div className="grid-2">
              <label>Curso
                <input className="input" list="pass-cursos" value={form.curso} onChange={event => setForm(v => ({ ...v, curso: event.target.value }))} placeholder="Ej. EP · 5F" />
                <datalist id="pass-cursos">{options.cursos.map(value => <option key={value} value={value} />)}</datalist>
              </label>
              <label>Docente a cargo
                <PersonSuggestInput
                  field="docente"
                  placeholder="Con quién está"
                  value={form.docente}
                  onChange={docente => setForm(v => ({ ...v, docente }))}
                />
              </label>
            </div>
            <label>Motivo<input className="input" value={form.motivo} onChange={event => setForm(v => ({ ...v, motivo: event.target.value }))} placeholder="Acto, salida, proyecto... (opcional)" /></label>
            <div className="actions">
              <Button variant="primary" type="submit" disabled={busy || !form.persona.trim()}>
                {busy ? 'Entregando...' : lending.length > 1 ? `Entregar ${lending.length}` : 'Entregar'}
              </Button>
              <Button type="button" onClick={() => setLending(null)}>Cancelar</Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
