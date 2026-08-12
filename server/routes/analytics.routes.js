import { Router } from 'express';
import { getDb } from '../db.js';
import { requireSite } from '../services/siteContext.service.js';
import { getMergedDevices } from '../services/deviceInventory.service.js';
import { decorateDevicesWithLifecycle } from '../services/lifecycle.service.js';

export const analyticsRouter = Router();

const DAY_MS = 86400000;

function parseRange(query = {}) {
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
    const d = new Date(ev.timestamp);
    if (Number.isNaN(d.getTime())) continue;
    const key = monthly
      ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    buckets.set(key, (buckets.get(key) || 0) + 1);
  }
  return {
    granularity: monthly ? 'month' : 'day',
    rows: [...buckets.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([label, value]) => ({ label, value }))
  };
}

function buildAnnualTrend(events) {
  const buckets = new Map();
  const now = new Date();
  for (let i = 11; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    buckets.set(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, 0);
  }
  for (const ev of events) {
    const d = new Date(ev.timestamp);
    if (Number.isNaN(d.getTime())) continue;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    if (buckets.has(key)) buckets.set(key, (buckets.get(key) || 0) + 1);
  }
  return [...buckets.entries()].map(([label, value]) => ({ label, value }));
}

function buildHourWeekday(events) {
  const days = ['Dom', 'Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab'];
  const map = new Map();
  for (const ev of events) {
    const d = new Date(ev.timestamp);
    if (Number.isNaN(d.getTime())) continue;
    const key = `${days[d.getDay()]} ${String(d.getHours()).padStart(2, '0')}:00`;
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

function ticketDeviceRows(siteCode) {
  const rows = getDb().prepare(`
    SELECT titulo, descripcion, nota
    FROM tickets
    WHERE site_code=? AND activo=1
  `).all(siteCode);
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

function avgTicketResponseDays(siteCode) {
  const rows = getDb().prepare(`
    SELECT created_at AS createdAt, updated_at AS updatedAt
    FROM tickets
    WHERE site_code=? AND activo=1 AND estado='Hecho' AND created_at<>'' AND updated_at<>''
  `).all(siteCode);
  if (!rows.length) return 0;
  const total = rows.reduce((sum, row) => {
    const start = new Date(row.createdAt).getTime();
    const end = new Date(row.updatedAt).getTime();
    return Number.isNaN(start) || Number.isNaN(end) ? sum : sum + Math.max(0, (end - start) / DAY_MS);
  }, 0);
  return Math.round((total / rows.length) * 10) / 10;
}

function buildTicketMetrics(siteCode, from, to) {
  const rows = getDb().prepare(`
    SELECT * FROM tickets
    WHERE site_code=? AND activo=1 AND created_at>=? AND created_at<=?
    ORDER BY created_at
  `).all(siteCode, from, to);
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
    const date = new Date(row.created_at);
    if (Number.isNaN(date.getTime())) continue;
    const key = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`;
    buckets.set(key,(buckets.get(key)||0)+1);
  }
  return [...buckets.entries()].sort((a,b)=>a[0].localeCompare(b[0])).map(([label,value])=>({label,value}));
}

function buildHourSeries(events) {
  const buckets = new Map(Array.from({ length: 12 }, (_, index) => [`${String(index + 7).padStart(2, '0')}:00`, 0]));
  for (const ev of events) {
    const date = new Date(ev.timestamp);
    if (Number.isNaN(date.getTime())) continue;
    const hour = date.getHours();
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
    const date = new Date(ev.timestamp);
    if (Number.isNaN(date.getTime())) continue;
    const label = labels[date.getDay()];
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

analyticsRouter.get('/analytics', (req, res) => {
  const siteCode = requireSite(req);
  const { from, to } = parseRange(req.query);
  const rows = getDb().prepare(`
    SELECT id, tipo, etiqueta, alias, filtro, persona, rol, ubicacion, ubicacion_detalle AS ubicacionDetalle,
           curso, motivo, motivo_detalle AS motivoDetalle, comentarios, operador, origen,
           loan_session_id AS loanSessionId, accessories_json, expected_accessories_json, timestamp
    FROM loan_events
    WHERE site_code=? AND timestamp>=? AND timestamp<=?
    ORDER BY timestamp DESC
  `).all(siteCode, from, to);

  const prestamos = rows.filter(r => r.tipo === 'prestamo');
  const devoluciones = rows.filter(r => r.tipo === 'devolucion');
  const allEvents = getDb().prepare(`
    SELECT id, tipo, etiqueta, alias, filtro, persona, rol, ubicacion, ubicacion_detalle AS ubicacionDetalle,
           curso, motivo, motivo_detalle AS motivoDetalle, comentarios, operador, origen,
           loan_session_id AS loanSessionId, accessories_json, expected_accessories_json, timestamp
    FROM loan_events
    WHERE site_code=?
    ORDER BY timestamp ASC
  `).all(siteCode);
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - DAY_MS).toISOString().slice(0, 10);
  const ticketsAbiertos = getDb().prepare("SELECT COUNT(*) AS total FROM tickets WHERE site_code=? AND activo=1 AND estado<>'Hecho'").get(siteCode).total;
  const tareasAbiertas = getDb().prepare("SELECT COUNT(*) AS total FROM tasks WHERE site_code=? AND eliminada=0 AND estado<>'Hecha'").get(siteCode).total;
  const byTaskType = getDb().prepare(`
    SELECT COALESCE(NULLIF(tipo,''),'Sin tipo') AS label, COUNT(*) AS value
    FROM tasks
    WHERE site_code=? AND eliminada=0
    GROUP BY COALESCE(NULLIF(tipo,''),'Sin tipo')
    ORDER BY value DESC
  `).all(siteCode).map(row => ({ label: row.label, value: Number(row.value || 0) }));

  const summary = {
    totalPrestamos: prestamos.length,
    totalDevoluciones: devoluciones.length,
    prestamosHoy: allEvents.filter(r => r.tipo === 'prestamo' && String(r.timestamp || '').startsWith(today)).length,
    prestamosAyer: allEvents.filter(r => r.tipo === 'prestamo' && String(r.timestamp || '').startsWith(yesterday)).length,
    ticketsAbiertos: Number(ticketsAbiertos || 0),
    tareasAbiertas: Number(tareasAbiertas || 0),
    personasUnicas: new Set(prestamos.map(r => (r.persona || '').trim().toLowerCase()).filter(Boolean)).size,
    equiposUnicos: new Set(prestamos.map(r => (r.etiqueta || '').trim().toUpperCase()).filter(Boolean)).size,
    byPerson: countBy(prestamos, r => r.persona),
    byRole: countBy(prestamos, r => r.rol),
    byLocation: countBy(prestamos, r => r.ubicacion),
    byReason: countBy(prestamos, r => r.motivo),
    byCourse: countBy(prestamos, r => r.curso),
    byDevice: countBy(prestamos, r => r.alias || r.etiqueta),
    byOperator: countBy(rows, r => r.operador),
    byTicketDevice: ticketDeviceRows(siteCode),
    byTaskType,
    byHourWeekday: buildHourWeekday(prestamos),
    annualTrend: buildAnnualTrend(allEvents.filter(r => r.tipo === 'prestamo')),
    avgLoanHoursByDevice: buildAverageLoanHours(allEvents),
    ticketResponseDays: avgTicketResponseDays(siteCode),
    agendaOccupation: buildAgendaOccupation(siteCode),
    byHour: buildHourSeries(prestamos),
    byWeekday: buildWeekdaySeries(prestamos),
    series: buildSeries(prestamos, from, to)
  };

  summary.ticketMetrics = buildTicketMetrics(siteCode, from, to);

  res.json({ ok: true, from, to, events: rows.map(row => ({ ...row, accessories: safeJsonArray(row.accessories_json), expectedAccessories: safeJsonArray(row.expected_accessories_json), accessories_json: undefined, expected_accessories_json: undefined })), summary });
});

function safeJsonArray(value) {
  try { const parsed = JSON.parse(String(value || '[]')); return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : []; } catch { return []; }
}
