const FIELD_ALIASES = {
  siteCode: ['sede', 'site', 'site_code', 'site code'],
  etiqueta: ['etiqueta 2023', 'etiqueta', 'codigo', 'código', 'id'],
  categoria: ['categoria', 'categoría', 'tipo', 'tipo dispositivo', 'tipo de dispositivo'],
  filtro: ['filtro', 'filtros', 'categoria dashboard', 'categoría dashboard', 'grupo', 'tipo dashboard'],
  dispositivo: ['dispositivo', 'equipo'],
  marca: ['marca'],
  modelo: ['modelo', 'model', 'modelo técnico'],
  sn: ['s/n', 'serial', 'numero de serie', 'número de serie'],
  mac: ['mac', 'wifi'],
  numero: ['numero operativo', 'número operativo', 'n° operativo', 'nro operativo', 'operativo', 'numero', 'número', 'nro', 'n°', 'alias'],
  aliasOperativo: ['alias operativo', 'nombre operativo', 'alias alternativos', 'aliases', 'alias'],
  estado: ['estado', 'estado/devuelto', 'devuelto'],
  prestada: ['prestada', 'prestado a', 'persona'],
  comentarios: ['comentarios', 'comentario'],
  rol: ['rol'],
  ubicacion: ['ubicacion', 'ubicación'],
  motivo: ['motivo'],
  fechaPrestado: ['fecha pres', 'fecha prestado', 'fecha prestamo', 'fecha préstamo', 'hora prestamo', 'hora préstamo', 'horario prestamo', 'horario préstamo', 'prestamo horario', 'préstamo horario', 'prestado fecha', 'prestado'],
  fechaDevuelto: ['fecha dev', 'fecha devuelto', 'fecha devolucion', 'fecha devolución', 'hora devolucion', 'hora devolución', 'horario devolucion', 'horario devolución', 'devolucion horario', 'devolución horario', 'devuelto fecha'],
  ultima: ['ultima mod', 'última mod', 'ultima modificacion', 'última modificación']
};

export function parseDevicesCsv(text) {
  const rows = parseCsv(text);
  if (!rows.length) return [];
  const headerIndex = findHeaderRow(rows);
  const headers = rows[headerIndex].map(normalizeText);
  const idx = Object.fromEntries(Object.keys(FIELD_ALIASES).map(key => [key, findColumn(headers, FIELD_ALIASES[key])]));
  return rows.slice(headerIndex + 1).map(row => normalizeDevice(row, idx)).filter(device => device.etiqueta || device.sn || device.mac);
}

export function toCsvExportUrl(rawUrl) {
  const value = clean(rawUrl);
  if (!value) return value;
  try {
    const url = new URL(value);
    const isGoogleSheet = url.hostname.includes('docs.google.com') && url.pathname.includes('/spreadsheets/d/');
    const alreadyCsv = url.searchParams.get('output') === 'csv' || url.searchParams.get('tqx') === 'out:csv';
    if (!isGoogleSheet || alreadyCsv) return value;
    const id = url.pathname.match(/\/spreadsheets\/d\/([^/]+)/)?.[1];
    if (!id) return value;
    const gid = url.searchParams.get('gid') || '0';
    return `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv&gid=${encodeURIComponent(gid)}`;
  } catch {
    return value;
  }
}

function normalizeDevice(row, idx) {
  const get = key => idx[key] >= 0 ? clean(row[idx[key]]) : '';
  const etiqueta = get('etiqueta');
  const prestadoA = get('prestada');
  const categoria = normalizeCategory(get('categoria'));
  const filtro = normalizeDashboardFilter(get('filtro'));
  const numero = firstOperationalNumber(get('numero'), get('aliasOperativo'));
  return {
    siteCode: get('siteCode'),
    etiqueta,
    numero,
    numeroOperativo: numero,
    categoria,
    filtro,
    dispositivo: get('dispositivo') || categoria || 'Chromebook',
    marca: get('marca'),
    modelo: get('modelo'),
    sn: get('sn'),
    mac: get('mac'),
    estado: normalizeAppState(get('estado'), prestadoA),
    prestadoA,
    comentarios: get('comentarios'),
    rol: get('rol'),
    ubicacion: get('ubicacion'),
    motivo: get('motivo'),
    loanedAt: get('fechaPrestado'),
    returnedAt: get('fechaDevuelto'),
    ultima: get('ultima'),
    aliasOperativo: buildStableOperationalAlias(get('aliasOperativo'), filtro || categoria, numero)
  };
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const input = String(text || '').replace(/^\uFEFF/, '');
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    const next = input[i + 1];
    if (ch === '"' && quoted && next === '"') {
      cell += '"';
      i += 1;
    } else if (ch === '"') {
      quoted = !quoted;
    } else if (ch === ',' && !quoted) {
      row.push(cell);
      cell = '';
    } else if ((ch === '\n' || ch === '\r') && !quoted) {
      if (ch === '\r' && next === '\n') i += 1;
      row.push(cell);
      if (row.some(value => clean(value))) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }
  row.push(cell);
  if (row.some(value => clean(value))) rows.push(row);
  return rows;
}

function findHeaderRow(rows) {
  const required = ['etiqueta', 'devuelto', 'estado', 'prestada', 'filtro'];
  const index = rows.findIndex(row => {
    const normalized = row.map(normalizeText);
    return normalized.some(cell => required.includes(cell) || FIELD_ALIASES.etiqueta.map(normalizeText).includes(cell));
  });
  return index >= 0 ? index : 0;
}

function findColumn(headers, aliases) {
  const normalizedAliases = aliases.map(normalizeText);
  return headers.findIndex(header => normalizedAliases.includes(header));
}

function firstOperationalNumber(...values) {
  for (const value of values) {
    const number = extractOperationalNumber(value);
    if (number) return number;
  }
  return '';
}

function extractOperationalNumber(value) {
  const raw = clean(value);
  if (!raw || /^D0*\d+$/i.test(raw)) return '';
  if (/^\d{1,3}$/.test(raw)) return String(Number(raw));
  const match = raw.match(/\b(?:plani|touch|tic|dell|tablet|notebook|chromebook)\s*0*(\d{1,3})\b/i)
    || raw.match(/\b0*(\d{1,3})\s*(?:plani|touch|tic|dell|tablet|notebook|chromebook)\b/i);
  return match ? String(Number(match[1])) : '';
}

function buildStableOperationalAlias(alias, group, number) {
  const firstAlias = clean(alias).split(',').map(value => value.trim()).find(Boolean) || '';
  const type = normalizeDashboardFilter(group || firstAlias);
  if (type && number) return `${type} ${number}`;
  if (firstAlias && extractOperationalNumber(firstAlias)) return firstAlias;
  return firstAlias || type;
}

function normalizeAppState(value, prestadoA = '') {
  const text = normalizeText(value);
  if (text.includes('prest') || clean(prestadoA)) return 'Prestado';
  if (text.includes('no encontrada') || text.includes('perd')) return 'No encontrada';
  if (text.includes('fuera') || text.includes('servicio')) return 'Fuera de servicio';
  if (text.includes('repar')) return 'En reparación';
  if (text.includes('sin revisar')) return 'Sin revisar';
  return 'Disponible';
}

function normalizeCategory(value) {
  const raw = clean(value);
  if (!raw) return '';
  const text = normalizeText(raw);
  if (text.includes('tablet')) return 'Tablet';
  if (text.includes('plani') || text.includes('planificacion')) return 'Plani';
  if (text === 'touch') return 'Touch';
  if (text === 'tic') return 'TIC';
  if (text === 'dell') return 'Dell';
  return raw.slice(0, 1).toUpperCase() + raw.slice(1);
}

function normalizeDashboardFilter(value) {
  const raw = clean(value);
  if (!raw) return '';
  return raw.slice(0, 1).toUpperCase() + raw.slice(1);
}

function clean(value) {
  return String(value ?? '').trim();
}

function normalizeText(value) {
  return clean(value).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
}
