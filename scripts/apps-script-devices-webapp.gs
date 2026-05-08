/**
 * TechAsset - Apps Script duplicable por sede
 *
 * Uso esperado:
 * 1. Duplicar el Spreadsheet de dispositivos de la sede.
 * 2. Abrir Extensiones > Apps Script.
 * 3. Pegar este archivo o conservarlo si ya venía copiado.
 * 4. Ajustar SHEET_NAME si la pestaña principal no se llama "Inventario".
 * 5. Desplegar como Web App: ejecutar como "Yo" y acceso "Cualquier usuario con el enlace".
 * 6. Copiar la URL del Web App en TechAsset > Configuración > Sede > Apps Script URL.
 *
 * Pestañas esperadas:
 * - Inventario: inventario de dispositivos.
 * - Movimientos: se crea automáticamente si no existe.
 *
 * Columnas esperadas en Inventario, por encabezado o por posición fallback:
 * A Etiqueta
 * B Categoría / Tipo
 * C Dispositivo
 * D Marca
 * E Modelo
 * F Estado
 * G Prestada / Prestado a / Persona
 * H Comentarios
 * I Rol
 * J Ubicación
 * K Motivo
 * L Horario préstamo
 * M Horario devolución
 * N Última modificación
 *
 * Importante:
 * - La columna de estado guarda solo estados válidos, nunca fechas.
 * - La columna G guarda el nombre de la persona al prestar.
 * - Las fechas se escriben únicamente en columnas de horario/última modificación/movimientos.
 * - El script usa el Spreadsheet activo. Para fijar uno concreto, completar SPREADSHEET_ID.
 */

const SPREADSHEET_ID = '';
const SHEET_NAME = 'Inventario';
const MOVEMENTS_SHEET_NAME = 'Movimientos';
const VALID_STATES = ['Devuelto', 'Prestado', 'No encontrada', 'Fuera de servicio'];

const FALLBACK_COLUMNS = {
  etiqueta: 1,
  categoria: 2,
  dispositivo: 3,
  marca: 4,
  modelo: 5,
  estado: 6,
  prestada: 7,
  comentarios: 8,
  rol: 9,
  ubicacion: 10,
  motivo: 11,
  horarioPrestamo: 12,
  horarioDevolucion: 13,
  ultimaModificacion: 14
};

const HEADER_ALIASES = {
  etiqueta: ['etiqueta', 'etiqueta 2023', 'codigo', 'código'],
  categoria: ['categoria', 'categoría', 'tipo', 'tipo dispositivo'],
  dispositivo: ['dispositivo', 'equipo'],
  marca: ['marca'],
  modelo: ['modelo'],
  estado: ['estado', 'estado/devuelto', 'devuelto'],
  prestada: ['prestada', 'prestado a', 'persona'],
  comentarios: ['comentarios', 'comentario'],
  rol: ['rol'],
  ubicacion: ['ubicacion', 'ubicación'],
  motivo: ['motivo'],
  horarioPrestamo: ['horario préstamo', 'horario prestamo', 'hora prestamo', 'fecha prestado'],
  horarioDevolucion: ['horario devolución', 'horario devolucion', 'hora devolucion', 'fecha devuelto'],
  ultimaModificacion: ['última modificación', 'ultima modificacion', 'modificado']
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
    if (action === 'inventory' || action === 'state') return json({ ok: true, rows: readInventory(), updatedAt: new Date().toISOString() });
    if (action === 'loan' || action === 'lend') return json(loanDevice(payload));
    if (action === 'return' || action === 'devolver') return json(returnDevice(payload));
    if (action === 'status') return json(updateStatus(payload));
    if (action === 'adddevice') return json(upsertDevice(payload));
    return json({ ok: false, error: 'Acción no soportada: ' + action }, 400);
  } catch (error) {
    return json({ ok: false, error: error && error.message ? error.message : String(error) }, 500);
  }
}

function readInventory() {
  const sheet = inventorySheet();
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  const columns = columnMap(values[0]);
  return values.slice(1).filter(row => clean(row[columns.etiqueta - 1])).map(row => rowToObject(row, columns));
}

function loanDevice(payload) {
  const lock = LockService.getDocumentLock();
  lock.waitLock(8000);
  try {
    const sheet = inventorySheet();
    const context = rowContext(sheet, payload);
    const person = clean(payload.person || payload.persona || payload.prestadoA || payload.prestada);
    const now = new Date();
    writeIfColumn(sheet, context.rowNumber, context.columns.estado, 'Prestado');
    writeIfColumn(sheet, context.rowNumber, context.columns.prestada, person);
    writeIfColumn(sheet, context.rowNumber, context.columns.rol, clean(payload.role || payload.rol));
    writeIfColumn(sheet, context.rowNumber, context.columns.ubicacion, [payload.location, payload.course, payload.locationDetail].map(clean).filter(Boolean).join(' · '));
    writeIfColumn(sheet, context.rowNumber, context.columns.motivo, [payload.reason, payload.reasonDetail].map(clean).filter(Boolean).join(' · '));
    writeIfColumn(sheet, context.rowNumber, context.columns.comentarios, clean(payload.comment || payload.comentario || payload.comentarios));
    writeIfColumn(sheet, context.rowNumber, context.columns.horarioPrestamo, now);
    writeIfColumn(sheet, context.rowNumber, context.columns.ultimaModificacion, now);
    appendMovement('Préstamo', context.tag, person, clean(payload.operator || payload.operador), now);
    return { ok: true, etiqueta: context.tag, estado: 'Prestado' };
  } finally {
    lock.releaseLock();
  }
}

function returnDevice(payload) {
  const lock = LockService.getDocumentLock();
  lock.waitLock(8000);
  try {
    const sheet = inventorySheet();
    const context = rowContext(sheet, payload);
    const now = new Date();
    writeIfColumn(sheet, context.rowNumber, context.columns.estado, 'Devuelto');
    writeIfColumn(sheet, context.rowNumber, context.columns.prestada, '');
    writeIfColumn(sheet, context.rowNumber, context.columns.rol, '');
    writeIfColumn(sheet, context.rowNumber, context.columns.ubicacion, '');
    writeIfColumn(sheet, context.rowNumber, context.columns.motivo, '');
    writeIfColumn(sheet, context.rowNumber, context.columns.comentarios, clean(payload.comment || payload.comentario || ''));
    writeIfColumn(sheet, context.rowNumber, context.columns.horarioDevolucion, now);
    writeIfColumn(sheet, context.rowNumber, context.columns.ultimaModificacion, now);
    appendMovement('Devolución', context.tag, '', clean(payload.operator || payload.operador), now);
    return { ok: true, etiqueta: context.tag, estado: 'Devuelto' };
  } finally {
    lock.releaseLock();
  }
}

function updateStatus(payload) {
  const lock = LockService.getDocumentLock();
  lock.waitLock(8000);
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
    return { ok: true, etiqueta: context.tag, estado: state };
  } finally {
    lock.releaseLock();
  }
}

function upsertDevice(payload) {
  const sheet = inventorySheet();
  const values = sheet.getDataRange().getValues();
  const columns = columnMap(values[0] || []);
  const tag = normalizeTag(payload.etiqueta || payload.codigo || payload.code);
  if (!tag) throw new Error('Etiqueta obligatoria.');
  const rowNumber = findRowNumber(values, columns, tag) || Math.max(sheet.getLastRow() + 1, 2);
  const now = new Date();
  writeIfColumn(sheet, rowNumber, columns.etiqueta, tag);
  writeIfColumn(sheet, rowNumber, columns.categoria, clean(payload.categoria || payload.tipo));
  writeIfColumn(sheet, rowNumber, columns.dispositivo, clean(payload.dispositivo || payload.equipo));
  writeIfColumn(sheet, rowNumber, columns.marca, clean(payload.marca));
  writeIfColumn(sheet, rowNumber, columns.modelo, clean(payload.modelo));
  writeIfColumn(sheet, rowNumber, columns.estado, normalizeState(payload.estado || 'Devuelto'));
  writeIfColumn(sheet, rowNumber, columns.comentarios, clean(payload.comentarios || payload.comentario));
  writeIfColumn(sheet, rowNumber, columns.ultimaModificacion, now);
  appendMovement('Dispositivo', tag, 'Alta/edición', clean(payload.operator || payload.operador), now);
  return { ok: true, etiqueta: tag };
}

function rowContext(sheet, payload) {
  const values = sheet.getDataRange().getValues();
  const columns = columnMap(values[0] || []);
  const tag = normalizeTag(payload.etiqueta || payload.codigo || payload.code);
  if (!tag) throw new Error('Etiqueta obligatoria.');
  const rowNumber = findRowNumber(values, columns, tag);
  if (!rowNumber) throw new Error('No se encontró la etiqueta ' + tag);
  return { columns, tag, rowNumber };
}

function findRowNumber(values, columns, tag) {
  for (let i = 1; i < values.length; i += 1) {
    if (normalizeTag(values[i][columns.etiqueta - 1]) === tag) return i + 1;
  }
  return 0;
}

function rowToObject(row, columns) {
  const prestada = clean(row[columns.prestada - 1]);
  const estado = normalizeState(row[columns.estado - 1] || (prestada ? 'Prestado' : 'Devuelto'));
  return {
    etiqueta: clean(row[columns.etiqueta - 1]),
    categoria: clean(row[columns.categoria - 1]),
    dispositivo: clean(row[columns.dispositivo - 1]),
    marca: clean(row[columns.marca - 1]),
    modelo: clean(row[columns.modelo - 1]),
    estado,
    prestada,
    prestadoA: prestada,
    comentarios: clean(row[columns.comentarios - 1]),
    rol: clean(row[columns.rol - 1]),
    ubicacion: clean(row[columns.ubicacion - 1]),
    motivo: clean(row[columns.motivo - 1]),
    fechaPrestado: asIso(row[columns.horarioPrestamo - 1]),
    horarioPrestamo: asIso(row[columns.horarioPrestamo - 1]),
    fechaDevuelto: asIso(row[columns.horarioDevolucion - 1]),
    horarioDevolucion: asIso(row[columns.horarioDevolucion - 1]),
    ultimaModificacion: asIso(row[columns.ultimaModificacion - 1])
  };
}

function columnMap(headers) {
  const normalizedHeaders = headers.map(normalizeText);
  const result = {};
  Object.keys(FALLBACK_COLUMNS).forEach(key => {
    const aliases = HEADER_ALIASES[key].map(normalizeText);
    const index = normalizedHeaders.findIndex(header => aliases.indexOf(header) >= 0);
    result[key] = index >= 0 ? index + 1 : FALLBACK_COLUMNS[key];
  });
  return result;
}

function appendMovement(tipo, etiqueta, detalle, operador, date) {
  const sheet = movementSheet();
  if (sheet.getLastRow() === 0) sheet.appendRow(['Fecha', 'Tipo', 'Etiqueta', 'Detalle', 'Operador']);
  sheet.appendRow([date || new Date(), tipo, etiqueta, detalle, operador]);
}

function inventorySheet() {
  const ss = SPREADSHEET_ID ? SpreadsheetApp.openById(SPREADSHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME) || ss.getSheets()[0];
  if (!sheet) throw new Error('No se encontró la pestaña de inventario.');
  return sheet;
}

function movementSheet() {
  const ss = SPREADSHEET_ID ? SpreadsheetApp.openById(SPREADSHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(MOVEMENTS_SHEET_NAME) || ss.insertSheet(MOVEMENTS_SHEET_NAME);
}

function writeIfColumn(sheet, row, column, value) {
  if (!column || column < 1) return;
  sheet.getRange(row, column).setValue(value);
}

function normalizeState(value) {
  const text = normalizeText(value);
  if (text.indexOf('fuera') >= 0 || text.indexOf('servicio') >= 0) return 'Fuera de servicio';
  if (text.indexOf('no encontrada') >= 0 || text.indexOf('perd') >= 0) return 'No encontrada';
  if (text.indexOf('prest') >= 0) return 'Prestado';
  if (text.indexOf('dev') >= 0 || text.indexOf('disp') >= 0 || !text) return 'Devuelto';
  if (VALID_STATES.indexOf(clean(value)) >= 0) return clean(value);
  throw new Error('Estado inválido. Usar: ' + VALID_STATES.join(', '));
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

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function normalizeText(value) {
  return clean(value).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
}

function normalizeTag(value) {
  const raw = clean(value).toUpperCase().replace(/\s+/g, '');
  const match = raw.match(/^D?0*(\d{1,5})$/);
  return match ? 'D' + match[1].padStart(4, '0') : raw;
}

function asIso(value) {
  if (!value) return '';
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) return value.toISOString();
  return clean(value);
}

/**
 * Pruebas rápidas:
 * - Leer inventario:
 *   https://script.google.com/macros/s/DEPLOY_ID/exec?action=inventory
 * - Leer estado:
 *   https://script.google.com/macros/s/DEPLOY_ID/exec?action=state
 * - Prestar con curl:
 *   curl -L -X POST "WEB_APP_URL?action=loan" -H "Content-Type: application/json" -d "{\"etiqueta\":\"D1436\",\"person\":\"Juan Pérez\",\"operator\":\"TIC\"}"
 * - Devolver con curl:
 *   curl -L -X POST "WEB_APP_URL?action=return" -H "Content-Type: application/json" -d "{\"etiqueta\":\"D1436\",\"operator\":\"TIC\"}"
 *
 * Al duplicar el Spreadsheet:
 * - Si SPREADSHEET_ID está vacío, el script apunta al Spreadsheet activo duplicado.
 * - Si SPREADSHEET_ID tiene valor, cambiarlo por el ID del nuevo Spreadsheet.
 * - Volver a desplegar o crear una nueva versión del Web App y actualizar la URL en la sede de TechAsset.
 */
