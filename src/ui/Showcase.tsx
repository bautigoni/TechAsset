import { useEffect, useMemo, useState, type ReactNode } from 'react';
import './showcase.css';
import {
  Button, Checkbox, Collapse, ColorField, Combobox, DateField, DatePicker, DateRange, DateTimeField, Disclosure, EmptyState, ErrorState,
  Eyebrow, FileDrop, IconButton, InlineConfirm, Input, Kbd, NumberField, RadioGroup, Ring, Segmented, Select, SectionHeader,
  SelectionHeader, Skeleton, SkeletonRows, SkeletonText, StatusLine, StatusText, Switch, Table, Tabs, TagInput, Textarea, TimeField,
  TruncatedText, ageTone, icons, useAnchoredToggle, useInlineConfirm, useSelection, useStatusLine, type Column, type FileDropItem
} from './index';
import { Dialog } from './Dialog';

/**
 * Página de muestra interna (solo superadmin): todos los componentes de
 * src/ui en todos sus estados, en oscuro y claro. Los estados de hover /
 * active / focus se fuerzan con `data-force` para verlos sin interactuar.
 * `?theme=light|dark` en la URL fija el tema al abrir (lo usan las capturas).
 */

type Theme = 'dark' | 'light';

function useShowcaseTheme() {
  const [theme, setTheme] = useState<Theme>(() => {
    const fromUrl = new URLSearchParams(window.location.search).get('theme');
    if (fromUrl === 'light' || fromUrl === 'dark') return fromUrl;
    return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
  });
  useEffect(() => {
    // Vista previa: no se guarda como preferencia; al salir de la página vuelve
    // el tema que tenía el usuario.
    const root = document.documentElement;
    const previous = root.dataset.theme;
    const previousLight = root.classList.contains('theme-light');
    root.dataset.theme = theme;
    root.classList.toggle('theme-light', theme === 'light');
    return () => {
      if (previous) root.dataset.theme = previous;
      else delete root.dataset.theme;
      root.classList.toggle('theme-light', previousLight);
    };
  }, [theme]);
  return [theme, setTheme] as const;
}

function Card({ eyebrow, title, children, wide }: { eyebrow: string; title: string; children: ReactNode; wide?: boolean }) {
  return (
    <section className={`ui-sc-card ${wide ? 'is-wide' : ''}`.trim()} aria-label={title}>
      <SectionHeader eyebrow={eyebrow} title={title} as="h3" />
      <div className="ui-sc-body">{children}</div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="ui-sc-row">
      <Eyebrow className="ui-sc-row-label">{label}</Eyebrow>
      <div className="ui-sc-row-items">{children}</div>
    </div>
  );
}

const STATES = [
  { label: 'Default', force: undefined },
  { label: 'Hover', force: 'hover' },
  { label: 'Active', force: 'active' },
  { label: 'Focus', force: 'focus' }
];

type Device = { tag: string; alias: string; who: string; where: string; since: number; free: boolean };

const DEVICES: Device[] = [
  { tag: 'D1436', alias: 'Touch 34', who: 'Alex C.', where: '5F · Aula 3B', since: 0, free: false },
  { tag: 'D0164', alias: 'Touch 8', who: 'Máximo M.', where: 'Biblioteca', since: 1, free: false },
  { tag: 'D1337', alias: 'TIC 4', who: 'Felipe M.', where: 'Laboratorio de ciencias naturales', since: 3, free: false },
  { tag: 'D0112', alias: 'Plani 1', who: 'Wanda · Maestra · Planificación móvil · Planificación', where: '2do piso', since: 0, free: false },
  { tag: 'D0757', alias: 'Dell 2', who: '—', where: 'Depósito TIC', since: 0, free: true }
];

/**
 * Collapse: toda sección, grupo, ficha o panel que se despliega abre y cierra
 * con alto suave hacia su encabezado, y lo que se tocó no se mueve en pantalla
 * (REGLAS-UX, agregado 19/10). Esta muestra es la referencia de uso.
 */
function CollapseDemo() {
  const [group, setGroup] = useState(true);
  const [more, setMore] = useState(false);
  const [card, setCard] = useState<string | null>(null);
  const anchored = useAnchoredToggle();
  const [extra, setExtra] = useState(false);
  const chips = Array.from({ length: 36 }, (_, index) => index + 1);
  const rows = ['Touch 34 · 5F · Aula 3B', 'Touch 8 · Biblioteca', 'TIC 4 · Laboratorio', 'Plani 1 · 2do piso', 'Dell 2 · Depósito', 'Tablet 3 · Sala de 5', 'Touch 12 · 6° A', 'Plani 5 · Dirección'];
  return (
    <>
      <p className="ui-sc-note">
        <code>{'<Collapse open={open} id="x" className="cuerpo">…</Collapse>'}</code> con el botón
        {' '}<code>{'aria-expanded={open} aria-controls="x"'}</code>. Ancla sola al control tocado; se puede
        pasar <code>anchor</code> (ref o función) o <code>anchor={'{false}'}</code>. Para cambios de alto sin
        Collapse: <code>{'const anchored = useAnchoredToggle(); anchored(() => setX(v => !v))'}</code>.
      </p>

      <div className="ui-sc-cgroup">
        <button type="button" className="ui-sc-chead" aria-expanded={group} aria-controls="ui-sc-cg" onClick={() => setGroup(value => !value)}>
          <icons.IconChevronDown size={16} className={group ? 'is-open' : ''} />
          <span>Grupo (como "Cartelitos de fotos")</span>
          <StatusText tone="muted" mono>{chips.length}</StatusText>
        </button>
        <Collapse open={group} id="ui-sc-cg" className="ui-sc-cbody">
          <div className="ui-sc-chips">
            {chips.map(chip => <span key={chip} className="ui-sc-chip">{chip}</span>)}
          </div>
        </Collapse>
      </div>

      <div className="ui-sc-cgroup">
        <ul className="ui-sc-clist">{rows.slice(0, 3).map(row => <li key={row}>{row}</li>)}</ul>
        <Collapse open={more} id="ui-sc-more">
          <ul className="ui-sc-clist">{rows.slice(3).map(row => <li key={row}>{row}</li>)}</ul>
        </Collapse>
        {/* El disparador está DEBAJO: el ancla automática es este botón, no se mueve. */}
        <Button size="sm" variant="ghost" aria-expanded={more} aria-controls="ui-sc-more" onClick={() => setMore(value => !value)}>
          {more ? 'Ver menos' : `Ver más (${rows.length - 3})`}
        </Button>
      </div>

      <div className="ui-sc-cgroup">
        {rows.slice(0, 3).map(row => (
          <div key={row} className="ui-sc-crow">
            <button type="button" className="ui-sc-chead" aria-expanded={card === row} onClick={() => setCard(current => (current === row ? null : row))}>
              <icons.IconChevronDown size={16} className={card === row ? 'is-open' : ''} />
              <span>Ficha: {row}</span>
            </button>
            <Collapse open={card === row} className="ui-sc-cbody">
              <SkeletonText lines={3} />
              <span className="ui-sc-row-items"><Button size="sm" variant="primary">Devolver</Button><Button size="sm">Editar</Button></span>
            </Collapse>
          </div>
        ))}
      </div>

      <div className="ui-sc-cgroup">
        <Button size="sm" variant="secondary" onClick={() => anchored(() => setExtra(value => !value))}>
          {extra ? 'Quitar aviso' : 'Mostrar aviso (useAnchoredToggle)'}
        </Button>
        {extra && <StatusLine tone="info" message="Aviso que aparece sin Collapse: el botón tocado igual queda quieto." autoHideMs={0} />}
      </div>
    </>
  );
}

const COURSES = ['1° A', '1° B', '2° A', '2° B', '3° A', '3° B', '4° A', '4° B', '5° A', '5° B', '6° A', '6° B', 'Sala de 5', 'Biblioteca', 'Dirección'];

export function Showcase() {
  const [theme, setTheme] = useShowcaseTheme();

  // Campos
  const [name, setName] = useState('máx');
  const [note, setNote] = useState('Faltó el cargador de la Touch 34.\nAvisar a Alex el lunes.');
  const [qty, setQty] = useState<number | null>(12);
  const [checks, setChecks] = useState({ a: false, b: true });
  const [mail, setMail] = useState(true);
  const [turno, setTurno] = useState('manana');
  const [density, setDensity] = useState(() => document.documentElement.dataset.density || 'comfortable');
  useEffect(() => {
    const root = document.documentElement;
    const previous = root.dataset.density;
    root.dataset.density = density;
    return () => { if (previous) root.dataset.density = previous; else delete root.dataset.density; };
  }, [density]);
  const [course, setCourse] = useState('3° A');
  const [type, setType] = useState('touch');
  const [person, setPerson] = useState('Máx');

  // Pickers
  const [date, setDate] = useState('2026-10-19');
  const [date2, setDate2] = useState('');
  const [time, setTime] = useState('09:20');
  const [dateTime, setDateTime] = useState('2026-10-21T10:30');
  const [range, setRange] = useState({ from: '2026-10-12', to: '2026-10-16' });
  const [tags, setTags] = useState(['proyector', 'aula 3B', 'urgente']);
  const [color, setColor] = useState('#2F6FE0');

  // Patrones
  const selection = useSelection(['D1436', 'D0164']);
  const confirm = useInlineConfirm();
  const status = useStatusLine();
  const [tab, setTab] = useState('prestados');
  const [expanded, setExpanded] = useState<string | null>('D1337');
  const [seg, setSeg] = useState('todos');

  const columns = useMemo<Column<Device>[]>(() => [
    { key: 'alias', header: 'Equipo', card: 'title', sortValue: row => row.alias, width: 'minmax(0, 1.2fr)', cell: row => <><b className="ui-sc-alias">{row.alias}</b> <span className="ui-mono ui-sc-tag">{row.tag}</span></> },
    { key: 'who', header: 'Quién', sortValue: row => row.who, width: 'minmax(0, 1.4fr)', cell: row => <TruncatedText>{row.who}</TruncatedText> },
    { key: 'where', header: 'Dónde', sortValue: row => row.where, width: 'minmax(0, 1.2fr)', cell: row => <TruncatedText>{row.where}</TruncatedText> },
    { key: 'since', header: 'Desde', card: 'meta', align: 'end', width: '5.5rem', sortValue: row => row.since, cell: row => row.free ? <StatusText>Disponible</StatusText> : <StatusText tone={ageTone(row.since)} mono>{row.since ? `${row.since} día${row.since > 1 ? 's' : ''}` : '07:20'}</StatusText> }
  ], []);

  const fakeUpload = (file: File, onProgress: (ratio: number) => void) => new Promise<void>((resolve, reject) => {
    let ratio = 0;
    const fail = /error/i.test(file.name);
    const timer = window.setInterval(() => {
      ratio += 0.2;
      onProgress(Math.min(ratio, 1));
      if (fail && ratio >= 0.6) { window.clearInterval(timer); reject(new Error('Se cortó la conexión.')); }
      if (ratio >= 1) { window.clearInterval(timer); resolve(); }
    }, 300);
  });
  const demoFiles = useMemo<FileDropItem[]>(() => [
    { id: 'a', file: new File(['x'.repeat(240000)], 'ticket-4417-foto.jpg', { type: 'image/jpeg' }), status: 'done', progress: 1 },
    { id: 'b', file: new File(['x'.repeat(820000)], 'remito-proveedor.pdf', { type: 'application/pdf' }), status: 'uploading', progress: 0.42 },
    { id: 'c', file: new File(['x'.repeat(120000)], 'captura-error-proyector.png', { type: 'image/png' }), status: 'error', progress: 0.6, error: 'Se cortó la conexión.' }
  ], []);

  const freeTags = DEVICES.map(device => device.tag);

  return (
    <section className="view active ui-sc" data-theme-scope={theme}>
      <div className="ui-sc-inner">
        <SectionHeader
          as="h1"
          eyebrow="Superadmin · interno"
          title="Componentes Grafito"
          description="La librería src/ui en todos sus estados. Nada flota: listas, calendarios, confirmaciones y avisos van en línea; la única capa es el tooltip del texto truncado."
          actions={(
            <>
              <Segmented ariaLabel="Tema" value={theme} onChange={value => setTheme(value as Theme)} options={[{ value: 'dark', label: 'Oscuro' }, { value: 'light', label: 'Claro' }]} />
              <Segmented ariaLabel="Densidad" value={density} onChange={setDensity} options={[{ value: 'comfortable', label: 'Cómoda' }, { value: 'compact', label: 'Compacta' }]} />
            </>
          )}
        />

        <div className="ui-sc-grid">
          <Card eyebrow="Acciones" title="Button · IconButton · Kbd" wide>
            {(['primary', 'secondary', 'ghost', 'danger'] as const).map(variant => (
              <Row key={variant} label={variant}>
                {STATES.map(state => <Button key={state.label} variant={variant} data-force={state.force}>{state.label}</Button>)}
                <Button variant={variant} disabled>Disabled</Button>
                <Button variant={variant} loading loadingLabel="Guardando…">Guardar</Button>
              </Row>
            ))}
            <Row label="Tamaños e ícono">
              <Button variant="primary" icon={<icons.IconUndo size={16} />} iconEnd={<Kbd>↵</Kbd>}>Devolver</Button>
              <Button size="sm" icon={<icons.IconPlus size={14} />}>Nueva</Button>
              <Button size="sm" variant="ghost">Limpiar</Button>
              <IconButton label="Cerrar" icon={<icons.IconX size={16} />} />
              <IconButton label="Buscar" variant="secondary" icon={<icons.IconSearch size={16} />} />
              <IconButton label="Borrar" variant="danger" icon={<icons.IconX size={16} />} />
              <IconButton label="Cargando" loading icon={<icons.IconRetry size={16} />} />
              <Kbd>Ctrl</Kbd><Kbd>K</Kbd><Kbd>/</Kbd>
            </Row>
            <Row label="Label largo">
              <div className="ui-sc-narrow"><Button variant="secondary" block>Prestar 12 equipos a 4° B con un texto que no entra</Button></div>
            </Row>
          </Card>

          <Card eyebrow="Campos" title="Input · Textarea · NumberField">
            <div className="ui-sc-fields">
              <Input label="Persona" placeholder="Nombre o curso" reserveHelp />
              <Input label="Persona" value={name} onValueChange={setName} data-force="focus" reserveHelp />
              <Input label="Equipo" defaultValue="touch 43" error="No existe ese equipo" />
              <Input label="Persona" defaultValue="Máximo M." success="Completado del historial" />
              <Input label="Ubicación" defaultValue="Aula 3B" disabled hint="Deshabilitado" />
              <Input label="Buscar" placeholder="Escaneá o escribí un equipo" prefix={<icons.IconSearch size={16} />} suffix={<Kbd>/</Kbd>} />
            </div>
            <Textarea label="Nota" value={note} onValueChange={setNote} minRows={2} hint="Crece con el texto; nunca muestra barra." />
            <div className="ui-sc-fields">
              <NumberField label="Cantidad" value={qty} onChange={setQty} min={1} max={25} unit="eq." hint="Flechas, PageUp/Down, Home/End" />
              <NumberField label="En el mínimo" value={1} onChange={() => {}} min={1} max={25} />
              <NumberField label="Con error" value={30} onChange={() => {}} error="Tope 25 (Touch)" />
              <NumberField label="Deshabilitado" value={4} onChange={() => {}} disabled />
            </div>
          </Card>

          <Card eyebrow="Elección" title="Checkbox · Switch · Radio · Segmented">
            <Row label="Checkbox">
              <Checkbox checked={false} label="Vacío" />
              <Checkbox checked label="Marcado" />
              <Checkbox checked={false} indeterminate label="Indeterminado" />
              <Checkbox checked={false} label="Foco" data-force="focus" />
              <Checkbox checked={false} label="Hover" data-force="hover" />
              <Checkbox checked={false} disabled label="Deshabilitado" />
              <Checkbox checked disabled label="Marcado deshab." />
            </Row>
            <Row label="Interactivo">
              <Checkbox checked={checks.a} onCheckedChange={next => setChecks(current => ({ ...current, a: next }))} label="Avisarme por mail" description="Cuando alguien te asigna una tarea." />
              <Checkbox checked={checks.b} onCheckedChange={next => setChecks(current => ({ ...current, b: next }))} label="Importante" />
            </Row>
            <Row label="Switch">
              <Switch checked={false} onCheckedChange={() => {}} label="Apagado" />
              <Switch checked onCheckedChange={() => {}} label="Prendido" />
              <Switch checked={false} onCheckedChange={() => {}} label="Foco" data-force="focus" />
              <Switch checked onCheckedChange={() => {}} label="Guardando" loading />
              <Switch checked={false} onCheckedChange={() => {}} label="Deshab." disabled />
            </Row>
            <Switch checked={mail} onCheckedChange={setMail} labelPosition="start" label="Avisos por mail" description="Registro, aprobación y bajas de usuarios." />
            <RadioGroup label="Turno" direction="row" value={turno} onChange={setTurno} options={[{ value: 'manana', label: 'Mañana' }, { value: 'tarde', label: 'Tarde' }, { value: 'ambos', label: 'Ambos' }, { value: 'noche', label: 'Noche', disabled: true }]} />
            <Row label="Segmented">
              <Segmented ariaLabel="Vista" value={seg} onChange={setSeg} options={[{ value: 'todos', label: 'Todos', count: 142 }, { value: 'prestados', label: 'Prestados', count: 23 }, { value: 'libres', label: 'Disponibles', count: 118 }, { value: 'x', label: 'Fuera de servicio', disabled: true }]} />
              <Segmented size="sm" ariaLabel="Período" value="semana" onChange={() => {}} options={[{ value: 'dia', label: 'Día' }, { value: 'semana', label: 'Semana' }, { value: 'mes', label: 'Mes' }]} />
            </Row>
          </Card>

          <Card eyebrow="Listas en línea" title="Select · Combobox">
            <div className="ui-sc-fields">
              <Select label="Curso (abierto, con búsqueda)" value={course} onChange={setCourse} options={COURSES.map(item => ({ value: item, label: item }))} defaultOpen maxVisible={6} />
              <div className="ui-sc-stack">
                <Select label="Tipo de equipo" value={type} onChange={setType} options={[{ value: 'touch', label: 'Touch', hint: '18/25' }, { value: 'tic', label: 'TIC', hint: '9/12' }, { value: 'plani', label: 'Plani', hint: '4/6' }, { value: 'tablet', label: 'Tablet', hint: '0/14', disabled: true }]} />
                <Select label="Foco" value="" placeholder="Elegí un tipo" onChange={() => {}} options={[{ value: 'a', label: 'A' }]} data-force="focus" />
                <Select label="Con error" value="" onChange={() => {}} options={[{ value: 'a', label: 'A' }]} error="Elegí un responsable" />
                <Select label="Deshabilitado" value="tic" onChange={() => {}} options={[{ value: 'tic', label: 'TIC' }]} disabled />
              </div>
            </div>
            <Combobox label="Persona (Combobox)" value={person} onChange={setPerson} options={[{ value: 'Máximo M.', label: 'Máximo M.', hint: 'Alumno · 5F' }, { value: 'Máxima R.', label: 'Máxima R.', hint: 'Docente' }, { value: 'Ana P.', label: 'Ana P.' }]} hint="Sugiere al tipear; Enter elige, Esc cierra. Texto libre permitido." />
          </Card>

          <Card eyebrow="Fechas · chunk diferido" title="DatePicker · TimeField · DateRange" wide>
            <div className="ui-sc-fields ui-sc-fields--top">
              <DatePicker label="Fecha (abierto)" value={date} onChange={setDate} shortcuts={['yesterday', 'today', 'tomorrow']} defaultOpen isDateDisabled={iso => { const d = new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8))).getDay(); return d === 0 || d === 6; }} disabledMessage="Sábados y domingos no se agendan" calendarNote="Sábados y domingos no se agendan." />
              <TimeField label="Desde (abierto)" value={time} onChange={setTime} defaultOpen />
              <div className="ui-sc-stack">
                <DatePicker label="Vacía" value={date2} onChange={setDate2} hint="Tipeá DD/MM/AAAA o abrí el calendario" />
                <DatePicker label="Con error" value="" onChange={() => {}} error="Elegí una fecha" />
                <DateField value={date} onChange={setDate} ariaLabel="DateField (adaptador)" />
                <TimeField label="Deshabilitado" value="13:00" onChange={() => {}} disabled />
              </div>
            </div>
            <div className="ui-sc-fields ui-sc-fields--top">
              <DateTimeField label="Recordatorio" value={dateTime} onChange={setDateTime} />
              <DateRange label="Período" value={range} onChange={setRange} />
            </div>
          </Card>

          <Card eyebrow="Entrada rica · chunk diferido" title="TagInput · ColorField · FileDrop" wide>
            <div className="ui-sc-fields ui-sc-fields--top">
              <TagInput label="Etiquetas" value={tags} onChange={setTags} suggestions={['proyector', 'cargador', 'red', 'impresora', 'aula 3B']} hint="Coma o Enter agregan; Backspace borra el último." />
              <ColorField label="Color de la sede" value={color} onChange={setColor} />
            </div>
            <div className="ui-sc-fields ui-sc-fields--top">
              <FileDrop accept="image/*,.pdf" maxSizeMB={10} multiple upload={fakeUpload} defaultItems={demoFiles} />
              <FileDrop accept=".csv" title="Arrastrá el CSV de inventario acá o tocá para elegirlo" disabled hint="Deshabilitado en modo consulta" />
            </div>
          </Card>

          <Card eyebrow="Abrir y cerrar" title="Collapse · useAnchoredToggle" wide>
            <CollapseDemo />
          </Card>

          <Card eyebrow="Excepción (solo cartelitos)" title="Dialog · pop up centrado" wide>
            <DialogDemo />
          </Card>

          <Card eyebrow="Patrones en línea" title="Selección · Confirmación · Estado" wide>
            <Eyebrow>Ctrl/Cmd+click marca · Shift+click rango · con selección el click simple marca</Eyebrow>
            <SelectionHeader
              count={selection.count}
              onClear={selection.clear}
              noun={['equipo', 'equipos']}
              confirm={confirm.element}
              actions={(
                <>
                  <Button size="sm" variant="primary" iconEnd={<Kbd>↵</Kbd>}>Devolver {selection.count}</Button>
                  <Button size="sm" variant="danger" onClick={async () => {
                    const ok = await confirm.ask({ message: `¿Borrar ${selection.count} equipos?`, detail: [...selection.selected].join(' · '), confirmLabel: 'Borrar', danger: true });
                    if (ok) { status.show({ tone: 'ok', message: `${selection.count} equipos ocultos`, undo: { onUndo: () => status.clear() } }); selection.clear(); }
                  }}>Borrar</Button>
                </>
              )}
            >
              <div className="ui-sc-listhead"><b>Afuera ahora</b><StatusText tone="muted">Prestados 4</StatusText></div>
            </SelectionHeader>
            <div className="ui-sc-chips">
              {DEVICES.map(device => (
                <button
                  key={device.tag}
                  type="button"
                  data-device-tag={device.tag}
                  aria-pressed={selection.isSelected(device.tag)}
                  className={`ui-sc-chip ${selection.isSelected(device.tag) ? 'is-on' : ''}`.trim()}
                  onClick={event => {
                    if (selection.handleClick(device.tag, event, freeTags)) return;
                    status.show({ tone: 'info', message: `Click simple en ${device.alias}: abriría la ficha.` });
                  }}
                >
                  <span className={`ui-check-box ${selection.isSelected(device.tag) ? 'is-on' : ''}`.trim()} aria-hidden="true">{selection.isSelected(device.tag) && <icons.IconCheck size={12} />}</span>
                  {device.alias}
                </button>
              ))}
            </div>
            {status.element}
            <Eyebrow>InlineConfirm</Eyebrow>
            <InlineConfirm message="¿Cancelar Touch 25 de 3° A? Queda en el historial." confirmLabel="Sí, cancelar" cancelLabel="No" onConfirm={() => {}} onCancel={() => {}} />
            <InlineConfirm danger message="¿Borrar 3 equipos?" detail="D0164 · D1337 · D0112" confirmLabel="Borrar" onConfirm={() => {}} onCancel={() => {}} />
            <Eyebrow>StatusLine (reemplaza toasts)</Eyebrow>
            <div className="ui-sc-stack">
              <StatusLine tone="ok" message="Touch 34 devuelto · Alex C. · 5F · Aula 3B" undo={{ onUndo: () => {}, seconds: 8 }} autoHideMs={0} />
              <StatusLine tone="warn" message="2 de 3 devueltos · TIC 4: el equipo ya estaba devuelto" retry={{ onRetry: () => {}, label: 'Reintentar TIC 4' }} />
              <StatusLine tone="bad" message="No se pudo devolver Touch 34 · el servidor no respondió" retry={{ onRetry: () => {} }} />
              <StatusLine tone="info" message="Lista actualizada hace 12 s" autoHideMs={0} onDismiss={() => {}} />
              <StatusLine tone="offline" message="Sin conexión: prestar y devolver en pausa" />
            </div>
            <Disclosure title="Disclosure (abierta)" summary="3 pasos" defaultOpen>
              <SkeletonText lines={2} />
            </Disclosure>
            <Disclosure title="Disclosure (cerrada) con un título bastante largo que tiene que cortarse con elipsis" summary="12" actions={<Button size="sm" variant="ghost">Editar</Button>}>
              <p>Contenido</p>
            </Disclosure>
          </Card>

          <Card eyebrow="Datos" title="Table · Tabs · TruncatedText" wide>
            <Tabs ariaLabel="Lista" value={tab} onChange={setTab} tabs={[{ value: 'prestados', label: 'Prestados', count: 23 }, { value: 'disponibles', label: 'Disponibles', count: 118 }, { value: 'todos', label: 'Todos', count: 142 }]}>
              {tab === 'disponibles' ? <EmptyState title="Todo en casa: no hay equipos prestados." description="Cuando prestes uno aparece acá." action={<Button size="sm">Ver todos</Button>} /> : (
                <Table
                  caption="Equipos afuera"
                  rows={DEVICES}
                  columns={columns}
                  rowKey={row => row.tag}
                  rowAttrs={row => ({ 'data-device-tag': row.tag })}
                  defaultSort={{ key: 'since', dir: 'desc' }}
                  selection={{ selected: selection.selected, onToggle: (key, event) => { if (!selection.handleClick(key, event, DEVICES.map(item => item.tag))) selection.toggle(key); }, onToggleAll: selection.toggleMany, isDisabled: key => key === 'D0757' }}
                  onRowClick={row => setExpanded(current => (current === row.tag ? null : row.tag))}
                  expandedKey={expanded}
                  highlightedKey="D0164"
                  renderExpanded={row => (
                    <div className="ui-sc-detail">
                      <span><b>{row.alias}</b> <span className="ui-mono ui-sc-tag">{row.tag}</span> · {row.where}</span>
                      <span className="ui-sc-row-items"><Button size="sm" variant="primary">Devolver</Button><Button size="sm">Editar</Button><Button size="sm" variant="ghost">Copiar etiqueta</Button></span>
                    </div>
                  )}
                />
              )}
            </Tabs>
            <div className="ui-sc-fields ui-sc-fields--top">
              <div className="ui-sc-stack">
                <Eyebrow>Cargando</Eyebrow>
                <Table caption="Cargando" rows={[] as Device[]} columns={columns} rowKey={row => row.tag} loading loadingRows={3} />
              </div>
              <div className="ui-sc-stack">
                <Eyebrow>Error por bloque</Eyebrow>
                <ErrorState message="No se pudo actualizar la lista" updatedAt="hace 3 min" onRetry={() => {}} />
                <ErrorState message="Reintentando…" onRetry={() => {}} retrying />
                <Eyebrow>Vacío (compacto, con ícono y acción)</Eyebrow>
                <EmptyState compact icon={<icons.IconCalendar size={18} />} title="Agenda de hoy: no hay actividades." description="La próxima es mañana a las 8:00." action={<Button size="sm" variant="secondary">Ver la semana</Button>} />
                <EmptyState center icon={<icons.IconCheck size={22} />} title="Todo en casa." description="No hay equipos afuera ahora." />
              </div>
            </div>
            <Eyebrow>TruncatedText (hover/foco = tooltip; tocar = se despliega)</Eyebrow>
            <div className="ui-sc-trunc">
              <div><TruncatedText>Wanda · Maestra · Planificación móvil · Planificación de 3° A</TruncatedText></div>
              <div><TruncatedText>Corto</TruncatedText></div>
              <div><TruncatedText lines={2}>Proyector del aula 3B con imagen intermitente: se probó otro cable HDMI y el problema sigue; queda pendiente revisar la placa.</TruncatedText></div>
            </div>
          </Card>

          <Card eyebrow="Estados" title="StatusText · Ring · Skeleton">
            <Row label="StatusText">
              <StatusText>Disponible</StatusText>
              <StatusText>Prestado</StatusText>
              <StatusText tone="warn">Prestado · hace 1 día</StatusText>
              <StatusText tone="bad">Prestado · hace 3 días</StatusText>
              <StatusText tone="bad">Fuera de servicio</StatusText>
              <StatusText tone="info">En reparación</StatusText>
              <StatusText mono>07:20</StatusText>
              <StatusText tone="warn" mono>1 día</StatusText>
              <StatusText tone="bad" mono>3 días</StatusText>
            </Row>
            <Row label="Ring">
              <Ring value={18} total={25} label="Touch" />
              <Ring value={1} total={6} label="Plani" />
              <Ring value={0} total={14} label="Tablet" />
              <Ring value={118} total={142} size={40} />
              <Ring value={3} total={30} size={32} />
            </Row>
            <Row label="Skeleton">
              <div className="ui-sc-skel">
                <Skeleton height="2.25rem" radius="sm" />
                <SkeletonText lines={3} />
                <SkeletonRows rows={2} />
              </div>
            </Row>
          </Card>
        </div>
      </div>
    </section>
  );
}

export default Showcase;

/**
 * Ejemplo del pop up. Es una EXCEPCIÓN a "nada de modales": hoy solo lo usan los
 * cartelitos de fotos (pedido del dueño, 20/10). Para todo lo demás, en línea.
 */
function DialogDemo() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const close = () => { setOpen(false); setName(''); };
  return (
    <>
      <Eyebrow>Esc, la X o el fondo cierran · con algo escrito pregunta antes · Enter envía · el foco vuelve al botón</Eyebrow>
      <div><Button variant="secondary" onClick={() => setOpen(true)}>Abrir el ejemplo</Button></div>
      <Dialog
        open={open}
        title="Entregar cartelito 4"
        description="Ejemplo: el formulario va adentro y las acciones en el pie."
        dirty={Boolean(name.trim())}
        onClose={close}
        footer={(
          <>
            <Button variant="primary" disabled={!name.trim()} onClick={close} iconEnd={<Kbd>↵</Kbd>}>Entregar</Button>
            <Button variant="ghost" onClick={close}>Cancelar</Button>
          </>
        )}
      >
        <Input label="Alumno" value={name} onValueChange={setName} placeholder="Nombre y apellido" onKeyDown={event => { if (event.key === 'Enter' && name.trim()) { event.preventDefault(); close(); } }} />
      </Dialog>
    </>
  );
}
