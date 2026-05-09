/**
 * TechAsset - Apps Script duplicable por sede
 *
 * Pegar este archivo desde Extensiones > Apps Script dentro del Spreadsheet
 * correcto de la sede. Si SPREADSHEET_ID queda vacio, usa el Spreadsheet activo.
 *
 * Estructura soportada para NFND:
 * - Hoja: "Hoja 1" o primera hoja disponible.
 * - Fila de encabezados detectada dinamicamente. No necesita empezar en columna A.
 * - Encabezados reales esperados:
 *   B Modelo
 *   C Etiqueta 2023
 *   D numero operativo
 *   E Devuelto
 *   F Comentarios
 *   G Prestada
 *   H Fecha pres
 *   I Fecha dev
 *   J Ultima mod
 *   K Rol
 *   L Ubicacion
 *   M Motivo
 *
 * Acciones:
 * - ?action=debug
 * - ?action=inventory
 * - ?action=state
 * - ?action=loan
 * - ?action=return
 *
 * Reglas:
 * - La columna de estado/Devuelto guarda solo estados validos, nunca fechas.
 * - La columna Prestada guarda el nombre de la persona al prestar.
 * - Las fechas se escriben solo en Fecha pres, Fecha dev, Ultima mod y Movimientos.
 * - La busqueda de etiquetas no distingue mayusculas/minusculas.
 */

const SPREADSHEET_ID = '';
const SHEET_NAME = 'Hoja 1';
const MOVEMENTS_SHEET_NAME = 'Movimientos';
const VALID_STATES = ['Devuelto', 'Prestado', 'No encontrada', 'Fuera de servicio'];

const HEADER_ALIASES = {
  modelo: ['modelo', 'model'],
  categoria: ['categoria', 'categoría', 'tipo', 'tipo dispositivo'],
  dispositivo: ['dispositivo', 'equipo'],
  etiqueta: ['etiqueta', 'etiqueta 2023', 'codigo', 'código', 'code'],
  numero: ['numero operativo', 'número operativo', 'numero', 'número', 'nro', 'num'],
  estado: ['estado', 'estado/devuelto', 'devuelto'],
  comentarios: ['comentarios', 'comentario'],
  prestada: ['prestada', 'prestado a', 'prestado', 'persona'],
  fechaPrestamo: ['fecha pres', 'fecha prestamo', 'fecha préstamo', 'horario prestamo', 'horario préstamo', 'hora prestamo'],
  fechaDevolucion: ['fecha dev', 'fecha devolucion', 'fecha devolución', 'horario devolucion', 'horario devolución', 'hora devolucion'],
  ultimaModificacion: ['ultima mod', 'última mod', 'ultima modificacion', 'última modificación', 'modificado'],
  rol: ['rol'],
  ubicacion: ['ubicacion', 'ubicación'],
  motivo: ['motivo']
};

function doGet(e) {
  return handleRequest(e, 'GET');
}

function doPost(e) {
  return handleRequest(e, 'POST');
}

function handleRequest(e, method) {
  try {
    const action = String((e && e.parameter && e.parameter.action) || 'inventory').toLowerCase();
    const payload = method === 'POST' ? parseBody(e) : {};
    if (action === 'debug') return json(debugInfo());
    if (action === 'inventory') return json({ ...debugInfo(), rows: readInventory(), updatedAt: new Date().toISOString() });
    if (action === 'state') return json({ ...debugInfo(), rows: readState(), updatedAt: new Date().toISOString() });
    if (action === 'loan' || action === 'lend') return json(loanDevice(payload));
    if (action === 'return' || action === 'devolver') return json(returnDevice(payload));
    if (action === 'status') return json(updateStatus(payload));
    if (action === 'adddevice') return json(upsertDevice(payload));
    return json({ ok: false, error: 'Accion no soportada: ' + action });
  } catch (error) {
    return json({ ok: false, error: error && error.message ? error.message : String(error) });
  }
}

function debugInfo() {
  const ss = spreadsheet();
  const sheet = inventorySheet();
  const values = sheet.getDataRange().getValues();
  const headerRowIndex = findHeaderRow(values);
  const columns = buildHeaderMap(values[headerRowIndex] || []);
  const rows = dataRows(values, headerRowIndex, columns);
  return {
    ok: true,
    spreadsheetName: ss.getName(),
    spreadsheetId: ss.getId(),
    sheetName: sheet.getName(),
    headerRow: headerRowIndex + 1,
    headers: headerDebug(columns),
    rowsCount: rows.length,
    firstEtiquetas: rows.slice(0, 5).map(row => clean(row[columns.etiqueta - 1])),
    timestamp: new Date().toISOString(),
    usesActiveSpreadsheet: !SPREADSHEET_ID,
    configuredSpreadsheetId: SPREADSHEET_ID || ''
  };
}

function readInventory() {
  const sheet = inventorySheet();
  const context = sheetContext(sheet);
  return dataRows(context.values, context.headerRowIndex, context.columns).map(row => rowToInventoryObject(row, context.columns));
}

function readState() {
  const sheet = inventorySheet();
  const context = sheetContext(sheet);
  return dataRows(context.values, context.headerRowIndex, context.columns).map(row => rowToStateObject(row, context.columns));
}

function loanDevice(payload) {
  const lock = LockService.getDocumentLock();
  lock.waitLock(15000);
  try {
    const sheet = inventorySheet();
    const context = rowContext(sheet, payload);
    const person = clean(payload.person || payload.persona || payload.prestadoA || payload.prestada);
    const now = new Date();
    writeIfColumn(sheet, context.rowNumber, context.columns.estado, 'Prestado');
    writeIfColumn(sheet, context.rowNumber, context.columns.prestada, person);
    writeIfColumn(sheet, context.rowNumber, context.columns.fechaPrestamo, now);
    writeIfColumn(sheet, context.rowNumber, context.columns.ultimaModificacion, now);
    writeIfColumn(sheet, context.rowNumber, context.columns.rol, clean(payload.role || payload.rol));
    writeIfColumn(sheet, context.rowNumber, context.columns.ubicacion, [payload.location, payload.course, payload.locationDetail].map(clean).filter(Boolean).join(' · '));
    writeIfColumn(sheet, context.rowNumber, context.columns.motivo, [payload.reason, payload.reasonDetail].map(clean).filter(Boolean).join(' · '));
    appendMovement('Prestamo', context.tag, person, clean(payload.operator || payload.operador), now);
    return { ok: true, etiqueta: context.tag, estado: 'Prestado', rowNumber: context.rowNumber };
  } finally {
    lock.releaseLock();
  }
}

function returnDevice(payload) {
  const lock = LockService.getDocumentLock();
  lock.waitLock(15000);
  try {
    const sheet = inventorySheet();
    const context = rowContext(sheet, payload);
    const now = new Date();
    writeIfColumn(sheet, context.rowNumber, context.columns.estado, 'Devuelto');
    writeIfColumn(sheet, context.rowNumber, context.columns.prestada, '');
    writeIfColumn(sheet, context.rowNumber, context.columns.fechaDevolucion, now);
    writeIfColumn(sheet, context.rowNumber, context.columns.ultimaModificacion, now);
    writeIfColumn(sheet, context.rowNumber, context.columns.rol, '');
    writeIfColumn(sheet, context.rowNumber, context.columns.ubicacion, '');
    writeIfColumn(sheet, context.rowNumber, context.columns.motivo, '');
    appendMovement('Devolucion', context.tag, '', clean(payload.operator || payload.operador), now);
    return { ok: true, etiqueta: context.tag, estado: 'Devuelto', rowNumber: context.rowNumber };
  } finally {
    lock.releaseLock();
  }
}

function updateStatus(payload) {
  const lock = LockService.getDocumentLock();
  lock.waitLock(15000);
  try {
    const sheet = inventorySheet();
    const context = rowContext(sheet, payload);
    const state = normalizeState(payload.estado || payload.status || payload.state);
    const now = new Date();
    writeIfColumn(sheet, context.rowNumber, context.columns.estado, state);
    if (state !== 'Prestado') writeIfColumn(sheet, context.rowNumber, context.columns.prestada, '');
    writeIfColumn(sheet, context.rowNumber, context.columns.comentarios, clean(payload.comentario || payload.comentarios || ''));
    writeIfColumn(sheet, context.rowNumber, context.columns.ultimaModificacion, now);
    appendMovement('Estado', context.tag, state, clean(payload.operator || payload.operador), now);
    return { ok: true, etiqueta: context.tag, estado: state, rowNumber: context.rowNumber };
  } finally {
    lock.releaseLock();
  }
}

function upsertDevice(payload) {
  const sheet = inventorySheet();
  const context = sheetContext(sheet);
  const tag = normalizeEtiqueta(payload.etiqueta || payload.codigo || payload.code);
  if (!tag) throw new Error('Etiqueta obligatoria.');
  const rowNumber = findRowByEtiquetaInValues(context.values, context.columns, tag, context.headerRowIndex) || Math.max(sheet.getLastRow() + 1, context.headerRowIndex + 2);
  const now = new Date();
  writeIfColumn(sheet, rowNumber, context.columns.etiqueta, tag);
  writeIfColumn(sheet, rowNumber, context.columns.modelo, clean(payload.modelo || payload.categoria || payload.tipo));
  writeIfColumn(sheet, rowNumber, context.columns.categoria, clean(payload.categoria || payload.tipo));
  writeIfColumn(sheet, rowNumber, context.columns.dispositivo, clean(payload.dispositivo || payload.equipo));
  writeIfColumn(sheet, rowNumber, context.columns.numero, clean(payload.numero || payload.nro));
  writeIfColumn(sheet, rowNumber, context.columns.estado, normalizeState(payload.estado || 'Devuelto'));
  writeIfColumn(sheet, rowNumber, context.columns.comentarios, clean(payload.comentarios || payload.comentario));
  writeIfColumn(sheet, rowNumber, context.columns.ultimaModificacion, now);
  appendMovement('Dispositivo', tag, 'Alta/edicion', clean(payload.operator || payload.operador), now);
  return { ok: true, etiqueta: tag, rowNumber };
}

function sheetContext(sheet) {
  const values = sheet.getDataRange().getValues();
  const headerRowIndex = findHeaderRow(values);
  const columns = buildHeaderMap(values[headerRowIndex] || []);
  if (!columns.etiqueta) throw new Error('No se encontro la columna Etiqueta 2023.');
  if (!columns.estado) throw new Error('No se encontro la columna Devuelto/Estado.');
  if (!columns.prestada) throw new Error('No se encontro la columna Prestada.');
  return { values, headerRowIndex, columns };
}

function rowContext(sheet, payload) {
  const context = sheetContext(sheet);
  const tag = normalizeEtiqueta(payload.etiqueta || payload.codigo || payload.code);
  if (!tag) throw new Error('Etiqueta obligatoria.');
  const rowNumber = findRowByEtiquetaInValues(context.values, context.columns, tag, context.headerRowIndex);
  if (!rowNumber) throw new Error('No se encontro la etiqueta ' + tag);
  return { columns: context.columns, tag, rowNumber };
}

function findHeaderRow(values) {
  for (let i = 0; i < Math.min(values.length, 25); i += 1) {
    const map = buildHeaderMap(values[i] || []);
    if (map.etiqueta && map.estado && map.prestada) return i;
  }
  throw new Error('No se encontro fila de encabezados con Etiqueta 2023, Devuelto y Prestada.');
}

function buildHeaderMap(headerRow) {
  const normalizedHeaders = headerRow.map(normalizeHeader);
  const result = {};
  Object.keys(HEADER_ALIASES).forEach(key => {
    const aliases = HEADER_ALIASES[key].map(normalizeHeader);
    const index = normalizedHeaders.findIndex(header => aliases.indexOf(header) >= 0);
    if (index >= 0) result[key] = index + 1;
  });
  return result;
}

function findRowByEtiqueta(sheet, etiqueta) {
  const context = sheetContext(sheet);
  return findRowByEtiquetaInValues(context.values, context.columns, normalizeEtiqueta(etiqueta), context.headerRowIndex);
}

function findRowByEtiquetaInValues(values, columns, etiqueta, headerRowIndex) {
  const target = normalizeEtiqueta(etiqueta);
  if (!target || !columns.etiqueta) return 0;
  for (let i = headerRowIndex + 1; i < values.length; i += 1) {
    if (normalizeEtiqueta(values[i][columns.etiqueta - 1]) === target) return i + 1;
  }
  return 0;
}

function dataRows(values, headerRowIndex, columns) {
  return values
    .slice(headerRowIndex + 1)
    .filter(row => normalizeEtiqueta(row[columns.etiqueta - 1]));
}

function rowToInventoryObject(row, columns) {
  const modelo = getCell(row, columns.modelo);
  const prestada = getCell(row, columns.prestada);
  const estado = normalizeState(getCell(row, columns.estado) || (prestada ? 'Prestado' : 'Devuelto'));
  return {
    modelo,
    categoria: getCell(row, columns.categoria) || modelo,
    dispositivo: getCell(row, columns.dispositivo) || modelo || 'Chromebook',
    etiqueta: normalizeEtiqueta(getCell(row, columns.etiqueta)),
    numero: getCell(row, columns.numero),
    estado,
    prestada,
    prestadoA: prestada,
    comentarios: getCell(row, columns.comentarios),
    fechaPrestamo: asIso(getRawCell(row, columns.fechaPrestamo)),
    horarioPrestamo: asIso(getRawCell(row, columns.fechaPrestamo)),
    fechaDevolucion: asIso(getRawCell(row, columns.fechaDevolucion)),
    fechaDevuelto: asIso(getRawCell(row, columns.fechaDevolucion)),
    horarioDevolucion: asIso(getRawCell(row, columns.fechaDevolucion)),
    ultimaModificacion: asIso(getRawCell(row, columns.ultimaModificacion)),
    rol: getCell(row, columns.rol),
    ubicacion: getCell(row, columns.ubicacion),
    motivo: getCell(row, columns.motivo)
  };
}

function rowToStateObject(row, columns) {
  const inventory = rowToInventoryObject(row, columns);
  return {
    etiqueta: inventory.etiqueta,
    estado: inventory.estado,
    prestada: inventory.prestada,
    prestadoA: inventory.prestada,
    fechaPrestamo: inventory.fechaPrestamo,
    fechaDevolucion: inventory.fechaDevolucion,
    horarioPrestamo: inventory.horarioPrestamo,
    horarioDevolucion: inventory.horarioDevolucion,
    ultimaModificacion: inventory.ultimaModificacion,
    rol: inventory.rol,
    ubicacion: inventory.ubicacion,
    motivo: inventory.motivo,
    comentarios: inventory.comentarios
  };
}

function headerDebug(columns) {
  const out = {};
  Object.keys(columns).forEach(key => {
    out[key] = columnLetter(columns[key]);
  });
  return out;
}

function inventorySheet() {
  const ss = spreadsheet();
  const named = SHEET_NAME ? ss.getSheetByName(SHEET_NAME) : null;
  const sheet = named || ss.getSheets()[0];
  if (!sheet) throw new Error('No se encontro la pestana de inventario.');
  return sheet;
}

function movementSheet() {
  const ss = spreadsheet();
  return ss.getSheetByName(MOVEMENTS_SHEET_NAME) || ss.insertSheet(MOVEMENTS_SHEET_NAME);
}

function spreadsheet() {
  if (SPREADSHEET_ID) return SpreadsheetApp.openById(SPREADSHEET_ID);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('No hay Spreadsheet activo. Pega este script desde Extensiones > Apps Script dentro del Spreadsheet correcto o completa SPREADSHEET_ID.');
  return ss;
}

function appendMovement(tipo, etiqueta, detalle, operador, date) {
  const sheet = movementSheet();
  if (sheet.getLastRow() === 0) sheet.appendRow(['Fecha', 'Tipo', 'Etiqueta', 'Detalle', 'Operador']);
  sheet.appendRow([date || new Date(), tipo, etiqueta, detalle, operador]);
}

function writeIfColumn(sheet, row, column, value) {
  if (!column || column < 1) return;
  sheet.getRange(row, column).setValue(value);
}

function normalizeHeader(value) {
  return clean(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function normalizeEtiqueta(value) {
  return String(value || '').trim().toUpperCase();
}

function normalizeState(value) {
  const text = normalizeHeader(value);
  if (text.indexOf('fuera') >= 0 || text.indexOf('servicio') >= 0) return 'Fuera de servicio';
  if (text.indexOf('no encontrada') >= 0 || text.indexOf('perd') >= 0) return 'No encontrada';
  if (text.indexOf('prest') >= 0) return 'Prestado';
  if (text.indexOf('dev') >= 0 || text.indexOf('disp') >= 0 || !text) return 'Devuelto';
  const cleanValue = clean(value);
  if (VALID_STATES.indexOf(cleanValue) >= 0) return cleanValue;
  throw new Error('Estado invalido. Usar: ' + VALID_STATES.join(', '));
}

function parseBody(e) {
  const text = e && e.postData && e.postData.contents ? e.postData.contents : '{}';
  try {
    return JSON.parse(text);
  } catch (_error) {
    return {};
  }
}

function json(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function getCell(row, column) {
  return clean(getRawCell(row, column));
}

function getRawCell(row, column) {
  if (!column || column < 1) return '';
  return row[column - 1];
}

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function asIso(value) {
  if (!value) return '';
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) return value.toISOString();
  return clean(value);
}

function columnLetter(column) {
  let value = Number(column || 0);
  let out = '';
  while (value > 0) {
    const mod = (value - 1) % 26;
    out = String.fromCharCode(65 + mod) + out;
    value = Math.floor((value - mod) / 26);
  }
  return out;
}

/**
 * Pruebas rapidas:
 * - WEB_APP_URL?action=debug
 * - WEB_APP_URL?action=inventory
 * - WEB_APP_URL?action=state
 * - curl -L -X POST "WEB_APP_URL?action=loan" -H "Content-Type: application/json" -d "{\"etiqueta\":\"D1188\",\"person\":\"Prueba\",\"operator\":\"TIC\"}"
 * - curl -L -X POST "WEB_APP_URL?action=return" -H "Content-Type: application/json" -d "{\"etiqueta\":\"D1188\",\"operator\":\"TIC\"}"
 */
