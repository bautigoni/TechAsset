import { useState } from 'react';
import type { ParqueRenewalItem, ParqueResponse } from '../../services/analyticsApi';
import { Collapse, ErrorState, StatusText, Table, TruncatedText, type Column as TableColumn } from '../../ui';
import { downloadCsv } from '../../utils/download';
import { todayKeyAr } from '../../utils/formatters';
import {
  Columns, CsvButton, EmptyCard, FlowRows, KpiStrip, Lazy, Panel, PartsRing, SimpleTable, ThinRing, columnsHeight, formatInt, pct, useActive,
  type Column, type Kpi, type Part, type Tone, type View
} from './kit';
import { sum } from './model';

/* Foto del parque: condición y vida útil NO dependen del período (son estado
   presente). Tiene su propio endpoint, su propio error y Recargar lo pide de nuevo. */

type Props = { data: ParqueResponse | null; loading: boolean; error: string; onRetry: () => void };

const CONDITION_TONE: Record<string, Tone> = { Excelente: 'ok', Bueno: 'info', Regular: 'warn', Malo: 'bad', 'Sin revisar': 'rest' };
const FIRST_ROWS = 20;

/** YYYY-MM-DD → DD/MM/AAAA sin pasar por Date (no corre de día por la zona horaria). */
function dayLabel(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value || '');
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value || '—';
}

export function ParqueSection({ data, loading, error, onRetry }: Props) {
  const initial = loading && !data;
  const summary = data?.summary;
  const universo = summary ? summary.equipos + summary.recursos : 0;
  const condition = data?.condicionTotales || [];
  const conditionTotal = sum(condition.map(row => row.value));
  const bad = condition.filter(row => row.label === 'Regular' || row.label === 'Malo').reduce((total, row) => total + row.value, 0);
  const unreviewed = condition.find(row => row.label === 'Sin revisar')?.value ?? 0;
  const headline = initial ? 'Cargando la foto del parque…'
    : !data ? 'No se pudo cargar el parque'
    : !universo ? 'Todavía no hay activos cargados en esta sede'
    : `${formatInt(bad)} ${bad === 1 ? 'activo' : 'activos'} en estado regular o malo${unreviewed ? `, y ${formatInt(unreviewed)} todavía sin revisar` : ''}`;
  const months12 = new Date();
  months12.setMonth(months12.getMonth() + 12);
  const monthName = months12.toLocaleDateString('es-AR', { month: 'long', year: 'numeric', timeZone: 'America/Argentina/Buenos_Aires' });

  const kpis: Kpi[] = [
    { label: 'Equipos regular o malo', value: formatInt(summary?.equiposMalos ?? 0), tone: summary?.equiposMalos ? 'warn' : undefined, hint: 'de los equipos con condición cargada' },
    { label: 'Recursos regular o malo', value: formatInt(summary?.recursosMalos ?? 0), tone: summary?.recursosMalos ? 'warn' : undefined, hint: 'proyectores, audio y otros' },
    { label: 'Vida útil vencida', value: formatInt(summary?.vencidos ?? 0), tone: summary?.vencidos ? 'bad' : undefined, hint: 'activos pasados de su vida útil' },
    { label: 'A renovar en 12 meses', value: formatInt(summary?.aRenovar12 ?? 0), tone: summary?.aRenovar12 ? 'warn' : undefined, hint: `vencen antes de ${monthName}` },
    { label: 'Bajo stock', value: formatInt(summary?.bajoStock ?? 0), tone: summary?.bajoStock ? 'warn' : undefined, hint: 'ítems en el mínimo o debajo' },
    { label: 'Revisado', value: `${summary?.cobertura ?? 0}%`, extra: summary ? <ThinRing value={summary.cobertura} total={100} size={32} /> : undefined, hint: 'con condición cargada' }
  ];

  const has = (key: string) => {
    if (initial) return true;
    if (!data) return false;
    if (key === 'cond') return conditionTotal > 0;
    if (key === 'ren') return data.renovacionPorAnio.some(row => row.value > 0);
    if (key === 'vida') return data.vidaConsumida.some(row => row.value > 0);
    if (key === 'cls') return data.condicionPorClase.length > 0;
    if (key === 'ar') return Boolean(data.aRenovar.length);
    return false;
  };
  const missing = [
    !has('cond') && { name: 'Condición del parque', shape: 'anillo de partes' },
    !has('ren') && { name: 'Renovaciones por año', shape: 'columnas por año' },
    !has('vida') && { name: 'Vida útil consumida', shape: 'columnas por tramo' },
    !has('cls') && { name: 'Clases con más deterioro', shape: 'tabla' }
  ].filter(Boolean) as Array<{ name: string; shape: string }>;

  const render = (key: string, span: number) => {
    if (!data && !initial) return null;
    switch (key) {
      case 'cond': return <ConditionPanel key={key} span={span} rows={condition} total={conditionTotal} loading={initial} />;
      case 'ren': return <YearPanel key={key} span={span} data={data} />;
      case 'vida': return <LifePanel key={key} span={span} data={data} />;
      case 'cls': return <ClassesPanel key={key} span={span} data={data} />;
      case 'ar': return <RenewPanel key={key} span={span} items={data?.aRenovar || []} loading={initial} />;
      default: return null;
    }
  };

  return (
    <section className="an-sec" aria-labelledby="an-par-h">
      <header className="an-sec-head an-sec-head--split">
        <div>
          <span className="an-eyebrow">03 · Parque y vida útil · foto actual</span>
          <h3 className="an-sec-title" id="an-par-h" tabIndex={-1}>{headline}</h3>
        </div>
        <span className="an-sec-tag">Estado actual, sin filtro de período</span>
      </header>
      {error && <ErrorState message={`No se pudo cargar el parque: ${error}`} onRetry={onRetry} retrying={loading} />}
      {data && summary && universo > 0 && summary.cobertura < 60 && (
        <p className="an-callout" role="note">Solo el {summary.cobertura}% del inventario tiene condición cargada. Corré la revisión desde Inventario TIC para que estos números sean confiables.</p>
      )}
      {(data || initial) && <KpiStrip label="Parque" items={kpis} loading={initial} />}
      <FlowRows has={has} render={render} rows={[[['cond', 6], ['cls', 6, 'wide']], [['ren', 6], ['vida', 6]], [['ar', 12]]]} />
      {data && !data.aRenovar.length && <RenewEmpty />}
      {data && missing.length > 0 && (
        <EmptyCard id="an-par-empty" title="Sin datos del parque para estos gráficos" reason="Aparecen cuando los equipos tengan condición, fecha de alta o vida útil cargadas (Inventario TIC y Configuración › Vida útil esperada)." items={missing} />
      )}
    </section>
  );
}

function ConditionPanel({ span, rows, total, loading }: { span: number; rows: Array<{ label: string; value: number }>; total: number; loading: boolean }) {
  const { active, setActive, groupProps } = useActive();
  const parts: Part[] = rows.map(row => ({ key: row.label, label: row.label, value: row.value, tone: CONDITION_TONE[row.label] || 'rest' }));
  const bad = rows.filter(row => row.label === 'Regular' || row.label === 'Malo').reduce((acc, row) => acc + row.value, 0);
  const unreviewed = rows.find(row => row.label === 'Sin revisar')?.value ?? 0;
  const ratio = total && bad ? Math.max(1, Math.round(total / bad)) : 0;
  const title = loading ? 'Condición del parque'
    : unreviewed === total ? 'Ningún activo tiene la condición cargada todavía'
    : ratio ? `1 de cada ${ratio} activos está regular o malo`
    : 'Ningún activo revisado está regular o malo';
  const readout = active !== null && parts[active]
    ? `${parts[active].label} · ${formatInt(parts[active].value)} activos · ${pct(parts[active].value, total)} de los ${formatInt(total)}`
    : `${formatInt(bad)} activos regular o malo (${pct(bad, total)}) y ${formatInt(unreviewed)} sin revisar (${pct(unreviewed, total)}) sobre ${formatInt(total)} activos.`;
  return (
    <Panel id="an-cond" span={span} eyebrow="Condición del parque · equipos y recursos" title={title} readout={loading ? undefined : readout}>
      {loading ? <Lazy height={176} kind="ring">{() => null}</Lazy> : (
        <div {...groupProps}><PartsRing parts={parts} total={total} active={active} onActive={setActive} centerLabel="activos" ariaLabel={`Anillo de condición de ${total} activos: ${parts.map(part => `${part.label} ${part.value}`).join(', ')}.`} /></div>
      )}
    </Panel>
  );
}

function YearPanel({ span, data }: { span: number; data: ParqueResponse | null }) {
  const { active, setActive, groupProps } = useActive();
  const [view, setView] = useState<View>('chart');
  const rows = data?.renovacionPorAnio || [];
  const total = sum(rows.map(row => row.value));
  const universo = data ? data.summary.equipos : 0;
  const firstWith = rows.find(row => row.value > 0);
  const peak = rows.reduce<{ label: string; value: number } | null>((best, row) => (!best || row.value > best.value ? row : best), null);
  const title = !data ? 'Renovaciones por año' : peak ? `El año con más renovaciones es ${peak.label} (${formatInt(peak.value)} activos)` : 'Sin fechas de renovación';
  const cols: Column[] = rows.map(row => ({ key: row.label, label: row.label, value: row.value, display: formatInt(row.value), aria: `${row.label}: ${row.value} activos a renovar` }));
  const readout = active !== null && rows[active]
    ? `${rows[active].label} · ${formatInt(rows[active].value)} activos a renovar${universo ? ` · ${pct(rows[active].value, universo)} de los equipos` : ''}`
    : `${formatInt(total)} de ${formatInt(universo)} equipos tienen fecha de renovación${firstWith ? `; la primera tanda vence en ${firstWith.label}` : ''}.`;
  return (
    <Panel id="an-ren" span={span} eyebrow="Renovaciones por año" title={title} view={view} onView={setView} readout={data ? readout : undefined}>
      {view === 'table' ? (
        <SimpleTable caption="Activos a renovar por año" head={['Año', 'Activos']} rows={rows.map(row => [row.label, formatInt(row.value)])} />
      ) : (
        <Lazy height={columnsHeight(150)} kind="columns">
          {() => <div {...groupProps}><Columns cols={cols} height={150} active={active} onActive={setActive} ariaLabel="Columnas: activos a renovar por año" valueMode="all" /></div>}
        </Lazy>
      )}
    </Panel>
  );
}

const LIFE_LABELS: Record<string, string> = { '0-50%': '0–50%', '50-80%': '50–80%', '80-100%': '80–100%', Vencido: 'Vencida' };
const LIFE_TONES: Tone[] = ['accent', 'accent', 'warn', 'bad'];

function LifePanel({ span, data }: { span: number; data: ParqueResponse | null }) {
  const { active, setActive, groupProps } = useActive();
  const [view, setView] = useState<View>('chart');
  const rows = data?.vidaConsumida || [];
  const total = sum(rows.map(row => row.value));
  const late = rows.slice(2).reduce((acc, row) => acc + row.value, 0);
  const title = !data ? 'Vida útil consumida' : !late ? 'Todo el parque está en la primera parte de su vida útil' : `${formatInt(late)} equipos pasaron el 80% de su vida útil`;
  const cols: Column[] = rows.map((row, index) => ({ key: row.label, label: LIFE_LABELS[row.label] || row.label, value: row.value, display: pct(row.value, total), aria: `${LIFE_LABELS[row.label] || row.label} de vida útil consumida: ${row.value} equipos, ${pct(row.value, total)}`, tone: LIFE_TONES[index] }));
  const readout = active !== null && rows[active] ? `${LIFE_LABELS[rows[active].label] || rows[active].label} de vida útil consumida · ${formatInt(rows[active].value)} equipos (${pct(rows[active].value, total)})` : `${formatInt(total)} equipos con vida útil calculada.`;
  return (
    <Panel id="an-vida" span={span} eyebrow="Vida útil consumida · en orden" title={title} view={view} onView={setView} readout={data ? readout : undefined}>
      {view === 'table' ? (
        <SimpleTable caption="Equipos por tramo de vida útil consumida" head={['Tramo', 'Equipos', '%']} rows={rows.map(row => [LIFE_LABELS[row.label] || row.label, formatInt(row.value), pct(row.value, total)])} />
      ) : (
        <Lazy height={columnsHeight(150)} kind="columns">
          {() => <div {...groupProps}><Columns cols={cols} height={150} active={active} onActive={setActive} ariaLabel="Columnas en orden: porcentaje de equipos por tramo de vida útil consumida" valueMode="all" /></div>}
        </Lazy>
      )}
    </Panel>
  );
}

function ClassesPanel({ span, data }: { span: number; data: ParqueResponse | null }) {
  const rows = [...(data?.condicionPorClase || [])].sort((a, b) => (b.Regular + b.Malo) - (a.Regular + a.Malo) || b['Sin revisar'] - a['Sin revisar']);
  const totals = rows.reduce((acc, row) => ({ r: acc.r + row.Regular, m: acc.m + row.Malo, s: acc.s + row['Sin revisar'] }), { r: 0, m: 0, s: 0 });
  const worst = rows[0];
  const exportCsv = () => downloadCsv(`clases-deterioro-${todayKeyAr()}.csv`, [['Clase', 'Excelente', 'Bueno', 'Regular', 'Malo', 'Sin revisar'], ...rows.map(row => [row.label, row.Excelente, row.Bueno, row.Regular, row.Malo, row['Sin revisar']])]);
  return (
    <Panel id="an-cls" span={span} eyebrow="Clases con más deterioro · tabla" title={!data ? 'Regular y malo por clase' : worst && worst.Regular + worst.Malo ? `${worst.label}: ${formatInt(worst.Regular + worst.Malo)} en estado regular o malo` : 'Ninguna clase tiene activos regular o malo'}
      tools={<CsvButton onExport={exportCsv} disabled={!rows.length} />} note="Ordenada por regular + malo, de mayor a menor.">
      {!data ? <Lazy height={180} kind="rows">{() => null}</Lazy> : (
        <SimpleTable
          caption="Activos en estado regular o malo por clase"
          head={['Clase', 'Regular', 'Malo', 'Sin revisar']}
          rows={[
            ...rows.map(row => [row.label, formatInt(row.Regular), formatInt(row.Malo), formatInt(row['Sin revisar'])]),
            [<b key="t">Total</b>, <b key="r" className={totals.r ? 'an-warn' : undefined}>{formatInt(totals.r)}</b>, <b key="m" className={totals.m ? 'an-bad' : undefined}>{formatInt(totals.m)}</b>, <b key="s">{formatInt(totals.s)}</b>]
          ]}
        />
      )}
    </Panel>
  );
}

/** "A renovar" sin equipos: una franja compacta con el CSV deshabilitado y el motivo (no una tarjeta alta vacía). */
function RenewEmpty() {
  return (
    <section className="an-card an-empty an-empty--row" aria-labelledby="an-ar-t">
      <div className="an-empty-head">
        <svg className="an-empty-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M8 2v4M16 2v4M3 10h18" /><path d="M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" /><path d="m9 16 2 2 4-4" /></svg>
        <div className="an-empty-text">
          <span className="an-eyebrow">A renovar · próximos 12 meses</span>
          <h4 className="an-card-title" id="an-ar-t">Ningún equipo vence en los próximos 12 meses</h4>
          <p className="an-empty-reason" id="an-ar-why">Nada para exportar. Cuando haya equipos, el CSV sale con etiqueta, alias, clase, condición, alta, renovación, meses restantes y si la fecha es estimada (hasta 100 filas).</p>
        </div>
        <CsvButton label="Exportar CSV" onExport={() => undefined} disabled describedBy="an-ar-why" />
      </div>
    </section>
  );
}

function RenewPanel({ span, items, loading }: { span: number; items: ParqueRenewalItem[]; loading: boolean }) {
  const [all, setAll] = useState(false);
  const columns: Array<TableColumn<ParqueRenewalItem>> = [
    { key: 'equipo', header: 'Equipo', width: 'minmax(0, 1.6fr)', card: 'title', cell: item => <span className="an-device"><TruncatedText>{item.alias || item.etiqueta}</TruncatedText>{item.alias && <span className="an-tag">{item.etiqueta}</span>}</span> },
    { key: 'clase', header: 'Clase', width: 'minmax(0, 1fr)', cell: item => item.assetClass },
    { key: 'cond', header: 'Condición', width: '7rem', cell: item => item.condition ? <StatusText tone={item.condition === 'Malo' ? 'bad' : item.condition === 'Regular' ? 'warn' : 'normal'}>{item.condition}</StatusText> : <span className="an-dim">Sin revisar</span> },
    { key: 'ren', header: 'Renovación', width: 'minmax(0, 1.1fr)', cell: item => <span>{dayLabel(item.fechaRenovacion)}{item.estimada && <span className="an-dim"> · estimada</span>}</span> },
    { key: 'rest', header: 'Restan', width: '6rem', align: 'end', mono: true, cell: item => item.vencido ? <StatusText tone="bad">Vencida</StatusText> : `${item.mesesRestantes ?? '—'} ${item.mesesRestantes === 1 ? 'mes' : 'meses'}` }
  ];
  const exportCsv = () => {
    const headers = ['Etiqueta', 'Alias', 'Clase', 'Condición', 'Alta', 'Renovación', 'Meses restantes', 'Fecha estimada'];
    const rows = items.map(item => [item.etiqueta, item.alias, item.assetClass, item.condition || 'Sin revisar', item.fechaAlta, item.fechaRenovacion, item.mesesRestantes ?? '', item.estimada ? 'sí' : 'no']);
    downloadCsv(`a-renovar-${todayKeyAr()}.csv`, [headers, ...rows]);
  };
  const vencidas = items.filter(item => item.vencido).length;
  const title = loading ? 'Equipos a renovar' : !items.length ? 'Ningún equipo vence en los próximos 12 meses' : `${formatInt(items.length)} ${items.length === 1 ? 'equipo vence' : 'equipos vencen'} en 12 meses${vencidas ? ` (${formatInt(vencidas)} ya ${vencidas === 1 ? 'vencido' : 'vencidos'})` : ''}`;
  const first = items.slice(0, FIRST_ROWS);
  const more = items.slice(FIRST_ROWS);
  return (
    <Panel id="an-ar" span={span} eyebrow="A renovar · próximos 12 meses" title={title}
      tools={<div className="an-tools-row">
        {more.length > 0 && <button type="button" className="an-link" aria-expanded={all} aria-controls="an-ar-more" onClick={() => setAll(value => !value)}>{all ? 'Ver menos' : `Ver los ${formatInt(items.length)}`}</button>}
        <CsvButton label="Exportar CSV" onExport={exportCsv} disabled={!items.length} describedBy="an-ar-why" />
      </div>}
      note={<span id="an-ar-why">{items.length ? `El CSV sale con etiqueta, alias, clase, condición, alta, renovación, meses restantes y si la fecha es estimada (hasta 100 filas).` : 'Nada para exportar. Cuando haya equipos, el CSV sale con etiqueta, alias, clase, condición, alta, renovación, meses restantes y si la fecha es estimada (hasta 100 filas).'}</span>}>
      {loading ? <Lazy height={180} kind="rows">{() => null}</Lazy> : items.length ? (
        <div className="an-renew">
          <Table<ParqueRenewalItem> caption="Equipos a renovar" rows={first} columns={columns} rowKey={item => item.etiqueta} cardBelow="md" />
          {more.length > 0 && (
            <Collapse open={all} id="an-ar-more">
              <div className="an-renew-more"><Table<ParqueRenewalItem> caption="Equipos a renovar (resto)" rows={more} columns={columns} rowKey={item => item.etiqueta} cardBelow="md" /></div>
            </Collapse>
          )}
        </div>
      ) : null}
    </Panel>
  );
}
