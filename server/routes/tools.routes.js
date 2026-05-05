import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let glifingTemplateDataUrl = '';
try {
  const tplPath = path.resolve(__dirname, '..', '..', 'public', 'glifing-template.png');
  if (fs.existsSync(tplPath)) {
    const b64 = fs.readFileSync(tplPath).toString('base64');
    glifingTemplateDataUrl = `data:image/png;base64,${b64}`;
  }
} catch { /* template opcional */ }

export const toolsRouter = Router();

const GLIFING_COLUMNS = ['Username', 'Nombre', 'Apellido', 'Grupo', 'Contraseña'];
const C365_COLUMNS = ['Nombre para mostrar', 'Nombre de usuario', 'mail', 'Contraseña', 'Sede', 'Licencias'];

const jobs = new Map(); // jobId -> { type, filePath, createdAt, content }

function ensureTempDir() {
  fs.mkdirSync(config.toolsTempDir, { recursive: true });
  return config.toolsTempDir;
}

function newJobId() {
  return crypto.randomBytes(8).toString('hex');
}

function pruneOldJobs() {
  const ttl = 30 * 60 * 1000;
  const now = Date.now();
  for (const [id, job] of jobs.entries()) {
    if (now - job.createdAt > ttl) {
      try { if (job.filePath && fs.existsSync(job.filePath)) fs.unlinkSync(job.filePath); } catch {}
      jobs.delete(id);
    }
  }
}

function parseCsv(text) {
  const clean = String(text || '').replace(/^﻿/, '');
  const lines = clean.split(/\r?\n/).filter(l => l.length > 0);
  if (!lines.length) return { headers: [], rows: [] };
  const split = (line) => {
    const out = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (inQ && line[i + 1] === '"') { cur += '"'; i++; } else inQ = !inQ;
      } else if (c === ',' && !inQ) { out.push(cur); cur = ''; }
      else cur += c;
    }
    out.push(cur);
    return out.map(s => s.trim());
  };
  const headers = split(lines[0]);
  const rows = lines.slice(1).map(line => {
    const cells = split(line);
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = cells[idx] ?? ''; });
    return obj;
  });
  return { headers, rows };
}

function csvEscape(value) {
  const v = String(value ?? '');
  return /[",\n\r]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v;
}

function rowsToCsv(headers, rows) {
  return [headers.map(csvEscape).join(','), ...rows.map(r => headers.map(h => csvEscape(r[h])).join(','))].join('\r\n');
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

function buildBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.setEncoding('utf8');
    const limit = config.maxUploadMb * 1024 * 1024;
    req.on('data', chunk => { data += chunk; if (data.length > limit) { reject(new Error('Archivo demasiado grande')); req.destroy(); } });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function getCsvFromRequest(req) {
  const ct = String(req.headers['content-type'] || '');
  if (ct.includes('application/json')) {
    return Promise.resolve(String(req.body?.csv || ''));
  }
  if (ct.includes('text/csv') || ct.includes('text/plain')) {
    return buildBody(req);
  }
  return Promise.resolve(String(req.body?.csv || ''));
}

// =========================================================
// Glifing
// =========================================================
toolsRouter.get('/tools/glifing/template', (_req, res) => {
  const sample = rowsToCsv(GLIFING_COLUMNS, [
    { Username: 'jperez', Nombre: 'Juan', Apellido: 'Pérez', Grupo: '4N', 'Contraseña': 'ABC123' }
  ]);
  res.type('text/csv; charset=utf-8').attachment('plantilla-glifing.csv').send('﻿' + sample);
});

toolsRouter.post('/tools/glifing/upload', async (req, res, next) => {
  try {
    const csv = await getCsvFromRequest(req);
    const { headers, rows } = parseCsv(csv);
    const missing = GLIFING_COLUMNS.filter(c => !headers.includes(c));
    if (missing.length) return res.status(400).json({ ok: false, error: `Faltan columnas obligatorias: ${missing.join(', ')}`, missing });
    res.json({ ok: true, headers, total: rows.length, preview: rows.slice(0, 10) });
  } catch (error) { next(error); }
});

function buildGlifingHtml(rows) {
  const cards = rows.map(r => {
    const nombre = `${r.Nombre || ''} ${r.Apellido || ''}`.trim();
    return `
    <article class="g-card">
      <div class="g-card-text">
        <h2>${escapeHtml(nombre)}</h2>
        <p class="g-row">Usuario: <strong>${escapeHtml(r.Username || '')}</strong></p>
        <p class="g-row">Contraseña: <strong>${escapeHtml(r['Contraseña'] || '')}</strong></p>
      </div>
    </article>`;
  }).join('\n');

  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>Tarjetas Glifing</title>
<style>
  @page { size: A4; margin: 10mm; }
  * { box-sizing: border-box; }
  body { font-family: 'Poppins', 'Inter', 'Segoe UI', Arial, sans-serif; background: #f4f5f8; color: #111; margin: 0; padding: 18px; }
  h1 { text-align: center; color: #f08000; margin: 0 0 8px; font-weight: 700; }
  .actions { text-align: center; margin: 0 0 18px; }
  .actions button { background: #f08000; color: #fff; border: 0; border-radius: 10px; padding: 10px 22px; cursor: pointer; font-size: 14px; font-weight: 600; }
  @media print { .actions { display: none; } body { background: #fff; padding: 0; } }
  .grid { display: grid; grid-template-columns: 1fr; gap: 14px; max-width: 720px; margin: 0 auto; }
  .g-card {
    position: relative;
    width: 100%;
    aspect-ratio: 1400 / 620;
    background: ${glifingTemplateDataUrl ? `url('${glifingTemplateDataUrl}') center/100% 100% no-repeat #fff` : '#fff'};
    border: 2px dashed #222;
    border-radius: 18px;
    overflow: hidden;
    page-break-inside: avoid;
  }
  .g-card-text {
    position: absolute;
    top: 58%;
    right: 4%;
    transform: translateY(-50%);
    width: 52%;
    max-width: 52%;
    text-align: center;
    color: #1a1a1a;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
  }
  .g-card-text h2 {
    margin: 0 0 6px;
    font-size: clamp(18px, 2.6vw, 30px);
    line-height: 1.05;
    font-weight: 700;
    color: #1a1a1a;
    word-break: break-word;
    overflow-wrap: anywhere;
    hyphens: auto;
    max-width: 100%;
  }
  .g-card-text .g-row {
    margin: 2px 0;
    font-size: clamp(14px, 1.9vw, 22px);
    color: #333;
    font-weight: 500;
    word-break: break-word;
    overflow-wrap: anywhere;
    max-width: 100%;
  }
  .g-card-text .g-row strong {
    color: #111;
    font-weight: 700;
  }
</style></head>
<body>
  <h1>Tarjetas de acceso · Glifing</h1>
  <div class="actions"><button onclick="window.print()">Imprimir</button></div>
  <div class="grid">${cards}</div>
</body></html>`;
}

toolsRouter.post('/tools/glifing/generate', async (req, res, next) => {
  try {
    pruneOldJobs();
    const csv = await getCsvFromRequest(req);
    const { headers, rows } = parseCsv(csv);
    const missing = GLIFING_COLUMNS.filter(c => !headers.includes(c));
    if (missing.length) return res.status(400).json({ ok: false, error: `Faltan columnas obligatorias: ${missing.join(', ')}` });
    if (!rows.length) return res.status(400).json({ ok: false, error: 'El CSV no contiene filas' });
    const html = buildGlifingHtml(rows);
    const id = newJobId();
    const dir = ensureTempDir();
    const filePath = path.join(dir, `glifing-${id}.html`);
    fs.writeFileSync(filePath, html, 'utf8');
    jobs.set(id, { type: 'glifing', filePath, createdAt: Date.now() });
    res.json({ ok: true, jobId: id, total: rows.length, downloadUrl: `/api/tools/glifing/download/${id}` });
  } catch (error) { next(error); }
});

toolsRouter.get('/tools/glifing/download/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job || job.type !== 'glifing' || !fs.existsSync(job.filePath)) return res.status(404).json({ ok: false, error: 'Resultado no disponible' });
  res.type('text/html; charset=utf-8');
  res.sendFile(job.filePath, () => {
    setTimeout(() => {
      try { fs.unlinkSync(job.filePath); } catch {}
      jobs.delete(req.params.jobId);
    }, 1000);
  });
});

// =========================================================
// Credenciales 365
// =========================================================
toolsRouter.get('/tools/credentials365/template', (_req, res) => {
  const sample = rowsToCsv(C365_COLUMNS, [
    { 'Nombre para mostrar': 'Juan Pérez', 'Nombre de usuario': 'jperez@northfield.edu.ar', mail: 'jperez.personal@gmail.com', 'Contraseña': 'TempPass123!', Sede: 'NFPT', Licencias: 'A1' }
  ]);
  res.type('text/csv; charset=utf-8').attachment('plantilla-credenciales365.csv').send('﻿' + sample);
});

function validateC365(rows) {
  const valid = [];
  const invalid = [];
  for (const r of rows) {
    const reasons = [];
    if (!isValidEmail(r.mail)) reasons.push('mail inválido');
    if (!String(r['Nombre de usuario'] || '').trim()) reasons.push('usuario vacío');
    if (!String(r['Contraseña'] || '').trim()) reasons.push('contraseña vacía');
    if (reasons.length) invalid.push({ ...r, _motivo: reasons.join(', ') });
    else valid.push(r);
  }
  return { valid, invalid };
}

toolsRouter.post('/tools/credentials365/upload', async (req, res, next) => {
  try {
    const csv = await getCsvFromRequest(req);
    const { headers, rows } = parseCsv(csv);
    const missing = C365_COLUMNS.filter(c => !headers.includes(c));
    if (missing.length) return res.status(400).json({ ok: false, error: `Faltan columnas obligatorias: ${missing.join(', ')}`, missing });
    res.json({ ok: true, headers, total: rows.length, preview: rows.slice(0, 10) });
  } catch (error) { next(error); }
});

toolsRouter.post('/tools/credentials365/preview', async (req, res, next) => {
  try {
    const csv = await getCsvFromRequest(req);
    const { headers, rows } = parseCsv(csv);
    const missing = C365_COLUMNS.filter(c => !headers.includes(c));
    if (missing.length) return res.status(400).json({ ok: false, error: `Faltan columnas obligatorias: ${missing.join(', ')}` });
    const { valid, invalid } = validateC365(rows);
    res.json({
      ok: true,
      total: rows.length,
      validos: valid.length,
      invalidos: invalid.length,
      modoPrueba: config.smtp.modoPrueba,
      preview: rows.slice(0, 10),
      invalidPreview: invalid.slice(0, 10).map(r => ({
        'Nombre para mostrar': r['Nombre para mostrar'],
        'Nombre de usuario': r['Nombre de usuario'],
        mail: r.mail,
        motivo: r._motivo
      }))
    });
  } catch (error) { next(error); }
});

function buildEmailHtml({ nombre, usuario, password, sede, licencias }) {
  const loginUrl = config.smtp.microsoftLoginUrl || 'https://login.microsoftonline.com/';
  return `<html><body style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#222;">
    <p>Hola ${escapeHtml(nombre)},</p>
    <p>Te damos la bienvenida.</p>
    <p>Ya tenés disponible tu acceso con los siguientes datos:</p>
    <p>
      <strong>Usuario:</strong> ${escapeHtml(usuario)}<br>
      <strong>Contraseña:</strong> ${escapeHtml(password)}<br>
      <strong>Sede:</strong> ${escapeHtml(sede)}<br>
      <strong>Licencias:</strong> ${escapeHtml(licencias)}
    </p>
    <p><a href="${escapeHtml(loginUrl)}" style="display:inline-block;padding:10px 16px;background:#2563eb;color:#fff;text-decoration:none;border-radius:6px;">Ingresar a la plataforma</a></p>
    <p>Te recomendamos cambiar tu contraseña en el primer ingreso.</p>
    <p>Saludos.</p>
  </body></html>`;
}

async function sendViaSmtp(rows) {
  let nodemailer;
  try { nodemailer = (await import('nodemailer')).default; }
  catch { throw new Error('Falta nodemailer en el servidor. Instalar con npm i nodemailer.'); }

  if (!config.smtp.server || !config.smtp.user || !config.smtp.appPassword || !config.smtp.mailFrom) {
    throw new Error('Configuración SMTP incompleta. Completar variables en .env.');
  }

  const transporter = nodemailer.createTransport({
    host: config.smtp.server,
    port: config.smtp.port,
    secure: Number(config.smtp.port) === 465,
    auth: { user: config.smtp.user, pass: config.smtp.appPassword }
  });

  const results = [];
  for (const r of rows) {
    const nombre = r['Nombre para mostrar'] || '';
    const usuario = r['Nombre de usuario'] || '';
    const destino = r.mail || '';
    const password = r['Contraseña'] || '';
    const sede = r.Sede || '';
    const licencias = r.Licencias || '';
    try {
      await transporter.sendMail({
        from: config.smtp.mailFrom,
        to: destino,
        subject: config.smtp.subject,
        text: `Hola ${nombre}\n\nUsuario: ${usuario}\nContraseña: ${password}\nSede: ${sede}\nLicencias: ${licencias}`,
        html: buildEmailHtml({ nombre, usuario, password, sede, licencias })
      });
      results.push({ mail_destino: destino, usuario, nombre, estado: 'OK', detalle: 'Enviado correctamente' });
    } catch (error) {
      results.push({ mail_destino: destino, usuario, nombre, estado: 'ERROR', detalle: error.message || 'Error SMTP' });
    }
  }
  transporter.close();
  return results;
}

toolsRouter.post('/tools/credentials365/send', async (req, res, next) => {
  try {
    pruneOldJobs();
    const csv = await getCsvFromRequest(req);
    const confirm = (req.body && (req.body.confirm === true || req.body.confirm === 'true')) || req.query.confirm === 'true';
    const { headers, rows } = parseCsv(csv);
    const missing = C365_COLUMNS.filter(c => !headers.includes(c));
    if (missing.length) return res.status(400).json({ ok: false, error: `Faltan columnas obligatorias: ${missing.join(', ')}` });
    const { valid, invalid } = validateC365(rows);

    const modoPrueba = config.smtp.modoPrueba;
    if (!modoPrueba && !confirm) {
      return res.status(400).json({ ok: false, error: 'Confirmación requerida para envío real (confirm=true).', requireConfirm: true, validos: valid.length, invalidos: invalid.length });
    }

    let results;
    if (modoPrueba) {
      results = valid.map(r => ({
        mail_destino: r.mail,
        usuario: r['Nombre de usuario'],
        nombre: r['Nombre para mostrar'],
        estado: 'PRUEBA',
        detalle: 'Correo generado pero no enviado (MODO_PRUEBA=true)'
      }));
    } else {
      results = await sendViaSmtp(valid);
    }
    for (const inv of invalid) {
      results.push({
        mail_destino: inv.mail,
        usuario: inv['Nombre de usuario'],
        nombre: inv['Nombre para mostrar'],
        estado: 'ERROR',
        detalle: inv._motivo || 'Inválido'
      });
    }

    const id = newJobId();
    const dir = ensureTempDir();
    const csvOut = '﻿' + rowsToCsv(['mail_destino', 'usuario', 'nombre', 'estado', 'detalle'], results);
    const filePath = path.join(dir, `c365-report-${id}.csv`);
    fs.writeFileSync(filePath, csvOut, 'utf8');
    jobs.set(id, { type: 'c365-report', filePath, createdAt: Date.now() });

    const stats = {
      total: results.length,
      ok: results.filter(r => r.estado === 'OK').length,
      prueba: results.filter(r => r.estado === 'PRUEBA').length,
      errores: results.filter(r => r.estado === 'ERROR').length
    };
    res.json({ ok: true, modoPrueba, stats, jobId: id, reportUrl: `/api/tools/credentials365/report/${id}`, sample: results.slice(0, 20) });
  } catch (error) { next(error); }
});

toolsRouter.get('/tools/credentials365/report/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job || job.type !== 'c365-report' || !fs.existsSync(job.filePath)) return res.status(404).json({ ok: false, error: 'Reporte no disponible' });
  res.type('text/csv; charset=utf-8').setHeader('Content-Disposition', `attachment; filename="reporte-credenciales365.csv"`);
  res.sendFile(job.filePath, () => {
    setTimeout(() => {
      try { fs.unlinkSync(job.filePath); } catch {}
      jobs.delete(req.params.jobId);
    }, 1000);
  });
});

// =========================================================
// Public config (only safe values)
// =========================================================
toolsRouter.get('/tools/config', (_req, res) => {
  res.json({
    ok: true,
    handingTicketUrl: config.handingTicketUrl,
    modoPrueba: config.smtp.modoPrueba,
    smtpConfigurado: Boolean(config.smtp.server && config.smtp.user && config.smtp.appPassword && config.smtp.mailFrom)
  });
});
