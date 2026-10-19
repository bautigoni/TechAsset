import { Router } from 'express';
import { getDb } from '../db.js';
import { requireSite } from '../services/siteContext.service.js';
import { getMergedDevices } from '../services/deviceInventory.service.js';
import { decorateDevicesWithLifecycle } from '../services/lifecycle.service.js';
import { addDaysToLocalDate, localDayStartIso, localParts, toLocalDate, todayLocal } from '../services/localTime.js';

export const analyticsRouter = Router();

const DAY_MS = 86400000;

// Fecha y hora de cada evento en hora de la sede: los timestamps son ISO UTC y
// el server puede correr en UTC (getHours/getDate daban +3 h y corrían el día).
function eventParts(value) {
  return localParts(value);
}

function monthKey(parts) {
  return `${parts.year}-${String(parts.month).padStart(2, '0')}`;
}

function parseRange(query = {}) {
  const isDay = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
  // Días YYYY-MM-DD: de 00:00 de "from" al final de "to", en hora de la sede.
  if (isDay(query.from) || isDay(query.to)) {
    const fromIso = isDay(query.from) ? localDayStartIso(query.from) : new Date(Date.now() - 365 * DAY_MS).toISOString();
    const toIso = isDay(query.to)
      ? new Date(Date.parse(localDayStartIso(addDaysToLocalDate(query.to, 1))) - 1).toISOString()
      : new Date(Date.parse(localDayStartIso(addDaysToLocalDate(todayLocal(), 1))) - 1).toISOString();
    return { from: fromIso, to: toIso };
  }
  const now = new Date();
  let to = query.to ? new Date(query.to) : now;
  let from = query.from ? new Date(query.from) : new Date(now.getTime() - 365 * DAY_MS);
  if (Number.isNaN(from.getTime())) from = new Date(now.getTime() - 365 * DAY_MS);
  if (Number.isNaN(to.getTime())) to = now;
  // Incluir todo el día "to".
  const toEnd = new Date(to.getTime());
  toEnd.setHours(23, 59, 59, 999);
  return { from: from.toISOString(), to: toEnd.toISOString() };
}

function countBy(events, getter) {
  const map = new Map();
  for (const ev of events) {
    const label = String(getter(ev) || '').trim();
    if (!label || label === '-') continue;
    map.set(label, (map.get(label) || 0) + 1);
  }
  return [...map.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
}

function rowsFromMap(map) {
  return [...map.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
}

function buildSeries(events, from, to) {
  const spanDays = Math.max(1, Math.round((new Date(to).getTime() - new Date(from).getTime()) / DAY_MS));
  const monthly = spanDays > 92;
  const buckets = new Map();
  for (const ev of events) {
    const d = eventParts(ev.timestamp);
    if (!d) continue;
    const key = monthly ? monthKey(d) : `${monthKey(d)}-${String(d.day).padStart(2, '0')}`;
    buckets.set(key, (buckets.get(key) || 0) + 1);
  }
  return {
    granularity: monthly ? 'month' : 'day',
    rows: [...buckets.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([label, value]) => ({ label, value }))
  };
}

function buildAnnualTrend(events) {
  const buckets = new Map();
  const now = eventParts(new Date());
  for (let i = 11; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(now.year, now.month - 1 - i, 1));
    buckets.set(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`, 0);
  }
  for (const ev of events) {
    const d = eventParts(ev.timestamp);
    if (!d) continue;
    const key = monthKey(d);
    if (buckets.has(key)) buckets.set(key, (buckets.get(key) || 0) + 1);
  }
  return [...buckets.entries()].map(([label, value]) => ({ label, value }));
}

function buildHourWeekday(events) {
  const days = ['Dom', 'Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab'];
  const map = new Map();
  for (const ev of events) {
    const d = eventParts(ev.timestamp);
    if (!d) continue;
    const key = `${days[d.weekday]} ${String(d.hour).padStart(2, '0')}:00`;
    map.set(key, (map.get(key) || 0) + 1);
  }
  return rowsFromMap(map);
}

function buildAverageLoanHours(events) {
  const open = new Map();
  const totals = new Map();
  const counts = new Map();
  for (const ev of [...events].sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)))) {
    const tag = String(ev.etiqueta || '').trim().toUpperCase();
    if (!tag) continue;
    const time = new Date(ev.timestamp).getTime();
    if (Number.isNaN(time)) continue;
    if (ev.tipo === 'prestamo') open.set(tag, { time, label: ev.alias || tag });
    if (ev.tipo === 'devolucion' && open.has(tag)) {
      const start = open.get(tag);
      const hours = Math.max(0, (time - start.time) / 3600000);
      totals.set(start.label, (totals.get(start.label) || 0) + hours);
      counts.set(start.label, (counts.get(start.label) || 0) + 1);
      open.delete(tag);
    }
  }
  return [...totals.entries()]
    .map(([label, total]) => ({ label, value: Math.round((total / Math.max(1, counts.get(label) || 1)) * 10) / 10 }))
    .sort((a, b) => b.value - a.value);
}

function buildAgendaOccupation(siteCode) {
  return getDb().prepare(`
    SELECT COALESCE(NULLIF(dia,''),'Sin dia') AS label, COUNT(*) AS value
    FROM agenda
    WHERE site_code=? AND eliminada=0 AND estado NOT IN ('Cancelado','Realizado')
    GROUP BY COALESCE(NULLIF(dia,''),'Sin dia')
    ORDER BY value DESC
  `).all(siteCode).map(row => ({ label: row.label, value: Number(row.value || 0) }));
}

// Las tres métricas de tickets salen de UNA sola lectura de los tickets activos
// (antes eran cuatro queries; en producción cada una es un viaje sincrónico).
function ticketDeviceRows(rows) {
  const map = new Map();
  for (const row of rows) {
    const text = `${row.titulo || ''} ${row.descripcion || ''} ${row.nota || ''}`;
    const tags = text.match(/\bD\s*0*\d{1,5}\b/gi) || [];
    for (const tag of tags) {
      const number = tag.match(/\d{1,5}/)?.[0] || '';
      if (number) map.set(`D${number.padStart(4, '0')}`, (map.get(`D${number.padStart(4, '0')}`) || 0) + 1);
    }
  }
  return rowsFromMap(map);
}

function avgTicketResponseDays(activeRows) {
  const rows = activeRows.filter(row => row.estado === 'Hecho' && row.created_at && row.updated_at);
  if (!rows.length) return 0;
  const total = rows.reduce((sum, row) => {
    const start = new Date(row.created_at).getTime();
    const end = new Date(row.updated_at).getTime();
    return Number.isNaN(start) || Number.isNaN(end) ? sum : sum + Math.max(0, (end - start) / DAY_MS);
  }, 0);
  return Math.round((total / rows.length) * 10) / 10;
}

function buildTicketMetrics(siteCode, rows) {
  const resolved = rows.filter(row => row.estado === 'Hecho' || row.resolved_at);
  const avgHours = (items, endKey) => {
    const values = items.map(row => (new Date(row[endKey]).getTime() - new Date(row.created_at).getTime()) / 3600000).filter(Number.isFinite).filter(value => value >= 0);
    return values.length ? Math.round(values.reduce((sum,value)=>sum+value,0)/values.length*10)/10 : 0;
  };
  const technicians = [];
  for (const row of rows) {
    let people=[]; try{const parsed=JSON.parse(row.responsables_json||'[]');if(Array.isArray(parsed))people=parsed;}catch{/* noop */}
    if(!people.length) people=['Sin asignar'];
    people.forEach(person=>technicians.push({...row,_technician:String(person)}));
  }
  const recurrence = new Map();
  for(const row of rows){const key=String(row.categoria||row.titulo||'Sin categoría').trim().toLowerCase();const current=recurrence.get(key)||{label:row.categoria||row.titulo||'Sin categoría',value:0};current.value+=1;recurrence.set(key,current);}
  return {
    created:rows.length,resolved:resolved.length,averageResolutionHours:avgHours(resolved,'resolved_at'),averageResponseHours:avgHours(rows.filter(row=>row.first_response_at),'first_response_at'),
    byCategory:countBy(rows,row=>row.categoria||'Sin categoría'),byPriority:countBy(rows,row=>row.prioridad||'Sin prioridad'),byTechnician:countBy(technicians,row=>row._technician),
    bySchool:countBy(rows,row=>row.school||siteCode),byClassroom:countBy(rows,row=>row.classroom||row.classroom_key||'Sin aula'),
    openClosed:[{label:'Abiertos',value:rows.filter(row=>row.estado!=='Hecho').length},{label:'Cerrados',value:resolved.length}],
    recurring:[...recurrence.values()].filter(item=>item.value>1).sort((a,b)=>b.value-a.value).slice(0,12),
    monthly:buildTicketMonthly(rows)
  };
}

function buildTicketMonthly(rows) {
  const buckets = new Map();
  for (const row of rows) {
    const date = eventParts(row.created_at);
    if (!date) continue;
    const key = monthKey(date);
    buckets.set(key,(buckets.get(key)||0)+1);
  }
  return [...buckets.entries()].sort((a,b)=>a[0].localeCompare(b[0])).map(([label,value])=>({label,value}));
}

function buildHourSeries(events) {
  const buckets = new Map(Array.from({ length: 12 }, (_, index) => [`${String(index + 7).padStart(2, '0')}:00`, 0]));
  for (const ev of events) {
    const date = eventParts(ev.timestamp);
    if (!date) continue;
    const hour = date.hour;
    const label = `${String(hour).padStart(2, '0')}:00`;
    buckets.set(label, (buckets.get(label) || 0) + 1);
  }
  return [...buckets.entries()]
    .filter(([, value]) => value > 0)
    .map(([label, value]) => ({ label, value }));
}

function buildWeekdaySeries(events) {
  const labels = ['Dom', 'Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab'];
  const buckets = new Map(labels.map(label => [label, 0]));
  for (const ev of events) {
    const date = eventParts(ev.timestamp);
    if (!date) continue;
    const label = labels[date.weekday];
    buckets.set(label, (buckets.get(label) || 0) + 1);
  }
  return [...buckets.entries()]
    .filter(([, value]) => value > 0)
    .map(([label, value]) => ({ label, value }));
}

// Foto del parque: condición y vida útil NO dependen del período elegido en
// analítica (son estado presente, no eventos), por eso viven en su propio
// endpoint y su propia sección.
analyticsRouter.get('/analytics/parque', async (req, res, next) => {
  try {
    const siteCode = requireSite(req);
    const { items } = await getMergedDevices({ siteCode });
    const devices = decorateDevicesWithLifecycle(items, siteCode);
    const recursos = getDb().prepare(`
      SELECT nombre, categoria, cantidad, unidad, COALESCE(condicion,'') AS condicion, COALESCE(min_stock,3) AS min_stock
      FROM inventory_items
      WHERE site_code=? AND COALESCE(activo,1)=1 AND (deleted_at IS NULL OR TRIM(deleted_at)='')
    `).all(siteCode);

    const malos = value => value === 'Regular' || value === 'Malo';
    const revisados = devices.filter(item => item.condition).length + recursos.filter(item => item.condicion).length;
    const universo = devices.length + recursos.length;
    const proximos12 = devices.filter(item => !item.vencido && typeof item.mesesRestantes === 'number' && item.mesesRestantes <= 12);

    // Totales de condición sobre TODO el parque (equipos + recursos): la barra
    // de la analítica se dibuja con esto, así el ancho cierra con el total.
    const condicionTotales = { Excelente: 0, Bueno: 0, Regular: 0, Malo: 0, 'Sin revisar': 0 };
    for (const device of devices) condicionTotales[device.condition || 'Sin revisar'] += 1;
    for (const recurso of recursos) condicionTotales[recurso.condicion || 'Sin revisar'] += 1;

    const condicionPorClase = new Map();
    for (const device of devices) {
      const clase = device.assetClass || 'Otro';
      if (!condicionPorClase.has(clase)) condicionPorClase.set(clase, { Excelente: 0, Bueno: 0, Regular: 0, Malo: 0, 'Sin revisar': 0 });
      const bucket = condicionPorClase.get(clase);
      bucket[device.condition || 'Sin revisar'] += 1;
    }

    const porAnio = new Map();
    for (const device of devices) {
      if (!device.fechaRenovacion) continue;
      const anio = device.fechaRenovacion.slice(0, 4);
      porAnio.set(anio, (porAnio.get(anio) || 0) + 1);
    }

    const tramos = { '0-50%': 0, '50-80%': 0, '80-100%': 0, Vencido: 0 };
    for (const device of devices) {
      if (device.vidaConsumidaPct === null) continue;
      if (device.vencido) tramos.Vencido += 1;
      else if (device.vidaConsumidaPct >= 80) tramos['80-100%'] += 1;
      else if (device.vidaConsumidaPct >= 50) tramos['50-80%'] += 1;
      else tramos['0-50%'] += 1;
    }

    res.json({
      ok: true,
      summary: {
        equipos: devices.length,
        recursos: recursos.length,
        equiposMalos: devices.filter(item => malos(item.condition)).length,
        recursosMalos: recursos.filter(item => malos(item.condicion)).length,
        vencidos: devices.filter(item => item.vencido).length,
        aRenovar12: proximos12.length,
        bajoStock: recursos.filter(item => Number(item.cantidad || 0) <= Number(item.min_stock || 3)).length,
        cobertura: universo ? Math.round((revisados / universo) * 100) : 0
      },
      condicionTotales: Object.entries(condicionTotales).map(([label, value]) => ({ label, value })),
      condicionPorClase: [...condicionPorClase.entries()].map(([label, valores]) => ({ label, ...valores })),
      renovacionPorAnio: [...porAnio.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([label, value]) => ({ label, value })),
      vidaConsumida: Object.entries(tramos).map(([label, value]) => ({ label, value })),
      aRenovar: [...devices]
        .filter(item => item.vencido || (typeof item.mesesRestantes === 'number' && item.mesesRestantes <= 12))
        .sort((a, b) => (a.mesesRestantes ?? 0) - (b.mesesRestantes ?? 0))
        .slice(0, 100)
        .map(item => ({
          etiqueta: item.etiqueta,
          alias: item.aliasOperativo || '',
          assetClass: item.assetClass,
          condition: item.condition || '',
          fechaAlta: item.fechaAlta || '',
          fechaRenovacion: item.fechaRenovacion || '',
          mesesRestantes: item.mesesRestantes,
          vencido: item.vencido,
          estimada: item.estimada
        }))
    });
  } catch (error) {
    next(error);
  }
});

// ── Analítica Grafito (etapa 8a) ─────────────────────────────────────────────
// Datos nuevos para la propuesta "Planificar la demanda": tipo de equipo por
// hora, duración de cada préstamo, serie densa con el período anterior,
// préstamos/devoluciones por operador y nombres agrupados sin distinguir
// mayúsculas ni acentos. Todo sale de las MISMAS lecturas (una de loan_events,
// una de tickets, una de tareas y la de agenda) en vez de las nueve de antes.

const HOUR_MS = 3600000;
const DURATION_EDGES = [0, 1, 3, 6, 12, 24, Infinity];
const DURATION_SAMPLE_MAX = 5000;

function foldKey(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

/** Agrupa por nombre sin distinguir mayúsculas/acentos; muestra la grafía más usada. */
function groupedCount(items, getter) {
  const groups = new Map();
  for (const item of items) {
    const raw = String(getter(item) || '').trim().replace(/\s+/g, ' ');
    if (!raw || raw === '-') continue;
    const key = foldKey(raw);
    const group = groups.get(key) || { value: 0, spellings: new Map() };
    group.value += 1;
    group.spellings.set(raw, (group.spellings.get(raw) || 0) + 1);
    groups.set(key, group);
  }
  const hasUpper = text => text !== text.toLowerCase();
  return [...groups.values()].map(group => {
    const label = [...group.spellings.entries()]
      .sort((a, b) => b[1] - a[1] || Number(hasUpper(b[0])) - Number(hasUpper(a[0])) || a[0].localeCompare(b[0]))[0][0];
    return { label, value: group.value, variants: group.spellings.size };
  }).sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
}

function quantile(sorted, p) {
  if (!sorted.length) return 0;
  const index = (sorted.length - 1) * p;
  const low = Math.floor(index);
  const high = Math.ceil(index);
  return sorted[low] + (sorted[high] - sorted[low]) * (index - low);
}

const round1 = value => Math.round(value * 10) / 10;
const round2 = value => Math.round(value * 100) / 100;

/**
 * Empareja cada préstamo con la devolución siguiente del mismo equipo (misma
 * regla que buildAverageLoanHours). Devuelve cada préstamo devuelto con su
 * duración y cuántos siguen afuera.
 */
function pairLoans(eventsAsc) {
  const open = new Map();
  const loans = [];
  for (const ev of eventsAsc) {
    const tag = String(ev.etiqueta || '').trim().toUpperCase();
    if (!tag) continue;
    const time = Date.parse(ev.timestamp);
    if (Number.isNaN(time)) continue;
    if (ev.tipo === 'prestamo') open.set(tag, { time, timestamp: ev.timestamp });
    else if (ev.tipo === 'devolucion' && open.has(tag)) {
      const start = open.get(tag);
      loans.push({ tag, start: start.timestamp, hours: Math.max(0, (time - start.time) / HOUR_MS) });
      open.delete(tag);
    }
  }
  return { loans, stillOut: open.size };
}

function buildDurations(loans, stillOut) {
  const sorted = loans.map(loan => loan.hours).sort((a, b) => a - b);
  const buckets = DURATION_EDGES.slice(0, -1).map(() => 0);
  for (const hours of sorted) {
    const index = DURATION_EDGES.findIndex((edge, i) => hours >= edge && hours < DURATION_EDGES[i + 1]);
    if (index >= 0) buckets[index] += 1;
  }
  let hours = sorted;
  let sampled = false;
  if (sorted.length > DURATION_SAMPLE_MAX) {
    // Muestra pareja sobre los valores ordenados: conserva la forma de la
    // distribución; mediana, cuartiles y tramos se calculan sobre todos.
    sampled = true;
    hours = Array.from({ length: DURATION_SAMPLE_MAX }, (_, i) => sorted[Math.round(i * (sorted.length - 1) / (DURATION_SAMPLE_MAX - 1))]);
  }
  return {
    count: sorted.length,
    stillOut,
    median: round2(quantile(sorted, 0.5)),
    q1: round2(quantile(sorted, 0.25)),
    q3: round2(quantile(sorted, 0.75)),
    max: round2(sorted[sorted.length - 1] || 0),
    over12: sorted.filter(value => value >= 12).length,
    buckets,
    edges: DURATION_EDGES.slice(0, -1),
    sampled,
    hours: hours.map(round2)
  };
}

/** Granularidad de la evolución según el largo del período. */
function evolutionGranularity(spanDays) {
  if (spanDays <= 35) return 'day';
  if (spanDays <= 100) return 'week';
  return 'month';
}

function bucketKey(parts, granularity) {
  if (granularity === 'month') return `${parts.year}-${pad2(parts.month)}`;
  if (granularity === 'day') return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`;
  // Semana que empieza el lunes (fecha local del lunes).
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  date.setUTCDate(date.getUTCDate() - ((parts.weekday + 6) % 7));
  return date.toISOString().slice(0, 10);
}

function denseKeys(startParts, endParts, granularity) {
  const keys = [];
  if (granularity === 'month') {
    let year = startParts.year;
    let month = startParts.month;
    while ((year < endParts.year || (year === endParts.year && month <= endParts.month)) && keys.length < 600) {
      keys.push(`${year}-${pad2(month)}`);
      month += 1;
      if (month > 12) { month = 1; year += 1; }
    }
    return keys;
  }
  const first = bucketKey(startParts, granularity);
  const last = bucketKey(endParts, granularity);
  const step = granularity === 'week' ? 7 : 1;
  const cursor = new Date(`${first}T00:00:00Z`);
  while (cursor.toISOString().slice(0, 10) <= last && keys.length < 800) {
    keys.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + step);
  }
  return keys;
}

/**
 * Serie densa (incluye los ceros) del período y, alineada punto a punto, la del
 * período anterior del mismo largo (cada evento anterior se corre +largo y cae
 * en el balde equivalente). Para rangos de más de 400 días ("Todo") no hay
 * período anterior y la serie arranca en el primer mes con registros.
 */
function buildEvolution(items, getTime, fromIso, toIso) {
  const fromMs = Date.parse(fromIso);
  const toMs = Date.parse(toIso);
  const spanMs = toMs - fromMs + 1;
  const spanDays = Math.max(1, Math.round(spanMs / DAY_MS));
  const granularity = evolutionGranularity(spanDays);
  const prevAvailable = spanDays <= 400;
  let startMs = fromMs;
  if (!prevAvailable) {
    let firstMs = Infinity;
    for (const item of items) {
      const time = Date.parse(getTime(item));
      if (time >= fromMs && time <= toMs && time < firstMs) firstMs = time;
    }
    if (Number.isFinite(firstMs)) startMs = firstMs;
  }
  const keys = denseKeys(localParts(startMs), localParts(toMs), granularity);
  const current = new Map(keys.map(key => [key, 0]));
  const previous = new Map(keys.map(key => [key, 0]));
  const prevFromMs = fromMs - spanMs;
  for (const item of items) {
    const time = Date.parse(getTime(item));
    if (Number.isNaN(time)) continue;
    if (time >= fromMs && time <= toMs) {
      const key = bucketKey(localParts(time), granularity);
      if (current.has(key)) current.set(key, current.get(key) + 1);
    } else if (prevAvailable && time >= prevFromMs && time < fromMs) {
      const key = bucketKey(localParts(time + spanMs), granularity);
      if (previous.has(key)) previous.set(key, previous.get(key) + 1);
    }
  }
  return {
    granularity,
    prevAvailable,
    points: keys.map(key => ({ key, value: current.get(key) || 0, prev: prevAvailable ? previous.get(key) || 0 : null }))
  };
}

function buildAnnualPrev(loansAll) {
  const now = localParts(new Date());
  const keys = [];
  for (let i = 23; i >= 12; i -= 1) {
    const d = new Date(Date.UTC(now.year, now.month - 1 - i, 1));
    keys.push(`${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}`);
  }
  const buckets = new Map(keys.map(key => [key, 0]));
  for (const ev of loansAll) {
    const parts = localParts(ev.timestamp);
    if (!parts) continue;
    const key = monthKey(parts);
    if (buckets.has(key)) buckets.set(key, buckets.get(key) + 1);
  }
  return keys.map(key => ({ label: key, value: buckets.get(key) || 0 }));
}

analyticsRouter.get('/analytics', async (req, res, next) => {
  try {
    const siteCode = requireSite(req);
    const { from, to } = parseRange(req.query);
    const db = getDb();

    // Una sola lectura de loan_events (todo el historial de la sede, solo las
    // columnas que se usan): el período, el período anterior, la tendencia
    // anual, hoy/ayer y las duraciones salen de acá.
    const allEvents = db.prepare(`
      SELECT tipo, etiqueta, alias, filtro, persona, rol, ubicacion, curso, motivo, operador, timestamp
      FROM loan_events
      WHERE site_code=?
      ORDER BY timestamp ASC
    `).all(siteCode);
    const rows = allEvents.filter(ev => ev.timestamp && ev.timestamp >= from && ev.timestamp <= to);
    const prestamos = rows.filter(r => r.tipo === 'prestamo');
    const devoluciones = rows.filter(r => r.tipo === 'devolucion');
    const prestamosAll = allEvents.filter(r => r.tipo === 'prestamo');

    // Inventario (caché en memoria de 60 s): tipo y alias actuales por etiqueta.
    const { items: devices } = await getMergedDevices({ siteCode });
    const deviceByTag = new Map(devices.map(device => [String(device.etiqueta || '').toUpperCase(), device]));
    const typeOf = ev => {
      const device = deviceByTag.get(String(ev.etiqueta || '').trim().toUpperCase());
      return String(device?.filtro || ev.filtro || '').trim();
    };

    // Hoy y ayer en hora de la sede (antes, fecha UTC: después de las 21 h "hoy" era mañana).
    const today = todayLocal();
    const yesterday = addDaysToLocalDate(today, -1);

    // Tickets: una lectura de los activos alcanza para todo.
    const tickets = db.prepare(`
      SELECT estado, titulo, descripcion, nota, categoria, prioridad, responsables_json, school, classroom, classroom_key,
             created_at, updated_at, resolved_at, first_response_at
      FROM tickets
      WHERE site_code=? AND activo=1
    `).all(siteCode);
    const ticketsInRange = tickets
      .filter(row => row.created_at && row.created_at >= from && row.created_at <= to)
      .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));

    // Tareas: total y abiertas por tipo en una sola query.
    const taskRows = db.prepare(`
      SELECT COALESCE(NULLIF(tipo,''),'Sin tipo') AS label, COUNT(*) AS value,
             SUM(CASE WHEN estado<>'Hecha' THEN 1 ELSE 0 END) AS open
      FROM tasks
      WHERE site_code=? AND eliminada=0
      GROUP BY COALESCE(NULLIF(tipo,''),'Sin tipo')
    `).all(siteCode).map(row => ({ label: row.label, value: Number(row.value || 0), open: Number(row.open || 0) }));
    const byTaskType = taskRows.map(row => ({ label: row.label, value: row.value })).sort((a, b) => b.value - a.value);
    const openTasksByType = taskRows.filter(row => row.open > 0).map(row => ({ label: row.label, value: row.open })).sort((a, b) => b.value - a.value);

    // Demanda: hora × día y tipo de equipo × hora (préstamos del período).
    const hourWeekday = Array.from({ length: 7 }, () => Array(24).fill(0));
    const typeHours = new Map();
    let untypedLoans = 0;
    for (const ev of prestamos) {
      const parts = localParts(ev.timestamp);
      if (!parts) continue;
      hourWeekday[parts.weekday][parts.hour] += 1;
      const type = typeOf(ev);
      if (!type) { untypedLoans += 1; continue; }
      const entry = typeHours.get(type) || { type, total: 0, hours: Array(24).fill(0) };
      entry.total += 1;
      entry.hours[parts.hour] += 1;
      typeHours.set(type, entry);
    }
    const fleetByType = new Map();
    let untypedFleet = 0;
    for (const device of devices) {
      const type = String(device.filtro || '').trim();
      if (!type) { untypedFleet += 1; continue; }
      fleetByType.set(type, (fleetByType.get(type) || 0) + 1);
    }
    for (const type of fleetByType.keys()) if (!typeHours.has(type)) typeHours.set(type, { type, total: 0, hours: Array(24).fill(0) });
    const byTypeHour = [...typeHours.values()]
      .map(entry => ({ ...entry, fleet: fleetByType.get(entry.type) || 0 }))
      .sort((a, b) => b.total - a.total || b.fleet - a.fleet || a.type.localeCompare(b.type));

    // Duraciones (todo el historial) y ranking de equipos del período.
    const { loans, stillOut } = pairLoans(allEvents);
    const durations = buildDurations(loans, stillOut);
    const periodHours = new Map();
    for (const loan of loans) {
      if (loan.start < from || loan.start > to) continue;
      const entry = periodHours.get(loan.tag) || { total: 0, count: 0 };
      entry.total += loan.hours;
      entry.count += 1;
      periodHours.set(loan.tag, entry);
    }
    const deviceRank = new Map();
    for (const ev of prestamos) {
      const tag = String(ev.etiqueta || '').trim().toUpperCase();
      if (!tag) continue;
      const entry = deviceRank.get(tag) || { etiqueta: tag, alias: '', tipo: '', value: 0 };
      entry.value += 1;
      if (ev.alias) entry.alias = ev.alias;
      deviceRank.set(tag, entry);
    }
    const byDeviceTag = [...deviceRank.values()].map(entry => {
      const device = deviceByTag.get(entry.etiqueta);
      const hours = periodHours.get(entry.etiqueta);
      return {
        etiqueta: entry.etiqueta,
        alias: device?.aliasOperativo || entry.alias || '',
        tipo: String(device?.filtro || '').trim(),
        value: entry.value,
        avgHours: hours && hours.count ? round1(hours.total / hours.count) : null
      };
    }).sort((a, b) => b.value - a.value || (b.avgHours ?? -1) - (a.avgHours ?? -1) || a.etiqueta.localeCompare(b.etiqueta));

    // Operadores: préstamos y devoluciones por separado ("Equi" = "equi").
    const operatorGroups = new Map();
    for (const ev of rows) {
      const raw = String(ev.operador || '').trim().replace(/\s+/g, ' ');
      if (!raw || raw === '-') continue;
      const key = foldKey(raw);
      const entry = operatorGroups.get(key) || { prestamos: 0, devoluciones: 0, spellings: new Map() };
      if (ev.tipo === 'prestamo') entry.prestamos += 1;
      else if (ev.tipo === 'devolucion') entry.devoluciones += 1;
      entry.spellings.set(raw, (entry.spellings.get(raw) || 0) + 1);
      operatorGroups.set(key, entry);
    }
    const byOperatorSplit = [...operatorGroups.values()].map(entry => ({
      label: [...entry.spellings.entries()].sort((a, b) => b[1] - a[1] || Number(b[0] !== b[0].toLowerCase()) - Number(a[0] !== a[0].toLowerCase()))[0][0],
      prestamos: entry.prestamos,
      devoluciones: entry.devoluciones
    })).sort((a, b) => (b.prestamos + b.devoluciones) - (a.prestamos + a.devoluciones) || a.label.localeCompare(b.label));

    const summary = {
      totalPrestamos: prestamos.length,
      totalDevoluciones: devoluciones.length,
      prestamosHoy: prestamosAll.filter(r => toLocalDate(r.timestamp || '') === today).length,
      prestamosAyer: prestamosAll.filter(r => toLocalDate(r.timestamp || '') === yesterday).length,
      ticketsAbiertos: tickets.filter(row => row.estado !== 'Hecho').length,
      tareasAbiertas: taskRows.reduce((sum, row) => sum + row.open, 0),
      personasUnicas: new Set(prestamos.map(r => (r.persona || '').trim().toLowerCase()).filter(Boolean)).size,
      equiposUnicos: new Set(prestamos.map(r => (r.etiqueta || '').trim().toUpperCase()).filter(Boolean)).size,
      byPerson: countBy(prestamos, r => r.persona),
      byPersonGrouped: groupedCount(prestamos, r => r.persona),
      sinPersona: prestamos.filter(r => !String(r.persona || '').trim()).length,
      byRole: countBy(prestamos, r => r.rol),
      byLocation: countBy(prestamos, r => r.ubicacion),
      byReason: countBy(prestamos, r => r.motivo),
      byCourse: countBy(prestamos, r => r.curso),
      byDevice: countBy(prestamos, r => r.alias || r.etiqueta),
      byDeviceTag,
      byType: byTypeHour.filter(entry => entry.total > 0).map(entry => ({ label: entry.type, value: entry.total }))
        .concat(untypedLoans ? [{ label: 'Sin tipo', value: untypedLoans }] : []),
      byOperator: countBy(rows, r => r.operador),
      byOperatorSplit,
      byTicketDevice: ticketDeviceRows(tickets),
      byTaskType,
      openTasksByType,
      byHourWeekday: buildHourWeekday(prestamos),
      hourWeekday,
      byTypeHour,
      untypedLoans,
      untypedFleet,
      annualTrend: buildAnnualTrend(prestamosAll),
      annualTrendPrev: buildAnnualPrev(prestamosAll),
      avgLoanHoursByDevice: buildAverageLoanHours(allEvents),
      durations,
      ticketResponseDays: avgTicketResponseDays(tickets),
      agendaOccupation: buildAgendaOccupation(siteCode),
      byHour: buildHourSeries(prestamos),
      byWeekday: buildWeekdaySeries(prestamos),
      series: buildSeries(prestamos, from, to),
      evolution: buildEvolution(prestamosAll, ev => ev.timestamp, from, to)
    };

    summary.ticketMetrics = {
      ...buildTicketMetrics(siteCode, ticketsInRange),
      evolution: buildEvolution(tickets, row => row.created_at, from, to)
    };

    // `events` (todos los préstamos y devoluciones del período, sin paginar) ya
    // no lo usa la pantalla: viaja solo si se pide con ?events=1.
    let events;
    if (req.query.events === '1') {
      events = db.prepare(`
        SELECT id, tipo, etiqueta, alias, filtro, persona, rol, ubicacion, ubicacion_detalle AS ubicacionDetalle,
               curso, motivo, motivo_detalle AS motivoDetalle, comentarios, operador, origen,
               loan_session_id AS loanSessionId, accessories_json, expected_accessories_json, timestamp
        FROM loan_events
        WHERE site_code=? AND timestamp>=? AND timestamp<=?
        ORDER BY timestamp DESC
      `).all(siteCode, from, to).map(row => ({ ...row, accessories: safeJsonArray(row.accessories_json), expectedAccessories: safeJsonArray(row.expected_accessories_json), accessories_json: undefined, expected_accessories_json: undefined }));
    }

    res.json({ ok: true, from, to, ...(events ? { events } : {}), summary });
  } catch (error) {
    next(error);
  }
});


function safeJsonArray(value) {
  try { const parsed = JSON.parse(String(value || '[]')); return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : []; } catch { return []; }
}
