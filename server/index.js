import express from 'express';
import compression from 'compression';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import { config } from './config.js';
import { installCrashReporting, reportError } from './services/errorReporting.js';
import { getDb } from './db.js';
import { devicesRouter } from './routes/devices.routes.js';
import { loansRouter } from './routes/loans.routes.js';
import { loansUndoRouter } from './routes/loansUndo.routes.js';
import { agendaRouter } from './routes/agenda.routes.js';
import { tasksRouter } from './routes/tasks.routes.js';
import { analyticsRouter } from './routes/analytics.routes.js';
import { assistantRouter } from './routes/assistant.routes.js';
import { healthRouter } from './routes/health.routes.js';
import { classroomsRouter } from './routes/classrooms.routes.js';
import { toolsRouter } from './routes/tools.routes.js';
import { operationsRouter } from './routes/operations.routes.js';
import { authRouter } from './routes/auth.routes.js';
import { sitesRouter } from './routes/sites.routes.js';
import { inventoryRouter } from './routes/inventory.routes.js';
import { photoPassesRouter } from './routes/photoPasses.routes.js';
import { ticketsRouter } from './routes/tickets.routes.js';
import { invitesRouter } from './routes/invites.routes.js';
import { adminUsersRouter } from './routes/adminUsers.routes.js';
import { googleAuthRouter } from './routes/googleAuth.routes.js';
import { notificationsRouter } from './routes/notifications.routes.js';
import { userPrefsRouter } from './routes/userPrefs.routes.js';
import { calendarRouter, publicCalendarRouter } from './routes/calendar.routes.js';
import { schedulesRouter } from './routes/schedules.routes.js';
import { pettyCashRouter } from './routes/pettyCash.routes.js';
import { suggestionsRouter } from './routes/suggestions.routes.js';
import { remindersRouter } from './routes/reminders.routes.js';
import { knowledgeRouter } from './routes/knowledge.routes.js';
import { canvasRouter } from './routes/canvas.routes.js';
import { historyRouter } from './routes/history.routes.js';
import { scheduleReminderCheck, startNotificationWorkers } from './services/notifications.service.js';
import { invalidateDeviceInventoryCache } from './services/deviceInventory.service.js';
import { bumpTasksVersion } from './services/tasksCache.service.js';
import { authMiddleware, getUserSession, invalidateSessionCache, isSuperadmin, normalizeSiteCode, requireEditor, requireModuleEditor } from './services/siteContext.service.js';

getDb();
startNotificationWorkers();

installCrashReporting();
const app = express();
// Caddy corre en el mismo host (127.0.0.1): confiar en su X-Forwarded-For para
// que req.ip sea el cliente real y no el proxy (lo usa el límite de intentos de login).
app.set('trust proxy', 'loopback, uniquelocal');
// gzip para HTML/CSS/JS/JSON. El CSS del bundle pasa de ~250 kB a ~46 kB y las
// respuestas de /api/devices bajan muchísimo. No asumimos que el reverse proxy
// comprima: en Caddy el `encode` es opt-in.
app.use(compression());
// El frontend se sirve desde el mismo origen (en dev, Vite proxea), así que CORS
// solo hace falta para los orígenes propios. Antes respondía a cualquiera.
const allowedOrigins = new Set([
  config.appBaseUrl,
  config.techassetPublicUrl,
  'http://localhost:5173', 'http://127.0.0.1:5173',
  'http://localhost:8000', 'http://127.0.0.1:8000'
].filter(Boolean).map(value => { try { return new URL(value).origin; } catch { return ''; } }).filter(Boolean));
app.use(cors({ origin: (origin, done) => done(null, !origin || allowedOrigins.has(origin)) }));
app.use(cookieParser());
app.use(express.json({ limit: `${Math.max(2, config.maxUploadMb)}mb` }));
// Adjuntos: viven en /uploads/<categoría>/<SEDE>/<archivo> y solo los ve quien
// tiene sesión con acceso a esa sede (comprobantes de caja chica, fotos de
// inventario, PDFs de tickets...). Los logos de sede quedan públicos porque
// van en mails y antes del login.
// fallthrough: false = un adjunto que no existe da 404, no el index.html de la SPA.
const staticUploads = express.static(config.uploadsDir, { maxAge: '7d', immutable: true, fallthrough: false });
// Un archivo que falta en disco (logos y adjuntos perdidos en la migración a la
// VM) respondía 500 y dejaba un ENOENT con stack en el log en CADA carga. Ahora
// es un 404 limpio, cacheable 10 min (el front cae al logo por defecto).
const serveUploads = (req, res, next) => staticUploads(req, res, error => {
  if (error && (error.status === 404 || error.statusCode === 404 || error.code === 'ENOENT')) {
    res.set('Cache-Control', 'private, max-age=600');
    return res.status(404).type('text').send('No existe.');
  }
  return next(error);
});
app.use('/uploads', (req, res, next) => {
  const [category, siteSegment, ...rest] = req.path.split('/').filter(Boolean);
  if (category === 'site-logos') return serveUploads(req, res, next);
  const session = getUserSession(req);
  if (!session) return res.status(401).type('text').send('Necesitás iniciar sesión.');
  // Adjuntos viejos sin carpeta de sede (/uploads/<categoría>/<archivo>): basta con la sesión.
  if (!rest.length) return serveUploads(req, res, next);
  const site = normalizeSiteCode(siteSegment);
  const allowed = isSuperadmin(session.user) || session.sites.some(item => normalizeSiteCode(item.siteCode) === site);
  if (!allowed) return res.status(403).type('text').send('No tenés permiso para esta sede.');
  return serveUploads(req, res, next);
});

// Los GET del API se revalidan siempre, pero con ETag: si el cuerpo no cambió
// desde el último poll, el navegador recibe un 304 vacío en vez del JSON entero.
// Es lo que hace que el auto-refresh cueste casi nada estando quieto.
app.use('/api', (req, res, next) => {
  if (req.method === 'GET') res.set('Cache-Control', 'no-cache, private');
  next();
});

// Escrituras que cambian quién accede a qué (usuarios, roles, sedes, login):
// al terminar se limpia la caché de sesiones para que rijan al instante.
const ACCESS_WRITE_PATHS = /^\/(auth|allowed-users|sites|admin|invites|user|site-settings)\b/;
app.use('/api', (req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD' && ACCESS_WRITE_PATHS.test(req.path)) res.on('finish', invalidateSessionCache);
  next();
});
app.use('/api', healthRouter);
app.use('/api', authRouter);
app.use('/api', googleAuthRouter);
app.use('/', publicCalendarRouter);
app.use('/api', authMiddleware);
// El operador de cada movimiento es quien tiene la sesión, no lo que diga el
// body: antes el historial registraba cualquier nombre que mandara el cliente.
app.use('/api', (req, _res, next) => {
  const method = String(req.method || 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') {
    const nombre = req.user?.nombre || req.user?.email || '';
    if (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) {
      req.body.operator = nombre;
      req.body.operador = nombre;
    }
    if (req.query?.operator) req.query.operator = nombre;
  }
  next();
});
// Recordatorios: el worker no pollea; se despierta después de cada escritura
// (rutas de recordatorios y el asistente, que también los crea y borra).
app.use('/api', (req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD' && /^\/(reminders|assistant)\b/.test(req.path)) res.on('finish', scheduleReminderCheck);
  next();
});
app.use('/api', sitesRouter);
app.use('/api', invitesRouter);
app.use('/api', adminUsersRouter);
app.use('/api', notificationsRouter);
app.use('/api', userPrefsRouter);
app.use('/api', calendarRouter);
app.use('/api', analyticsRouter);
// Sugerencias permite crear, votar y comentar a cualquier usuario con acceso de
// lectura al módulo; el router aplica propiedad y permisos de gestión por acción.
app.use('/api', suggestionsRouter);
app.use('/api', remindersRouter);
// Base de conocimiento y canvas: estaban programados pero sin montar. Chequean
// canViewModule/canEditModule adentro; en el front son módulos que cada sede prende.
app.use('/api', knowledgeRouter);
app.use('/api', canvasRouter);
// A partir de acá, bloquear escrituras a usuarios de solo consulta.
// (sitesRouter ya valida manager/superadmin por endpoint.)
app.use('/api', requireEditor);
// Cualquier escritura de equipos/préstamos invalida el inventario cacheado de
// la sede, aunque la ruta no lo haga explícitamente (metadata, vida útil...).
const INVENTORY_WRITE_PATHS = /^\/(devices|device-groups|lifecycle|loans)\b/;
const TASK_WRITE_PATHS = /^\/(tasks|task-columns|asistente)\b/;
app.use('/api', (req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD' && INVENTORY_WRITE_PATHS.test(req.path)) {
    // Salvo que la ruta ya haya actualizado el inventario cacheado en el lugar
    // (préstamo/devolución: patchInventoryState).
    res.on('finish', () => { if (!res.locals.inventoryPatched) invalidateDeviceInventoryCache('write', req.siteCode); });
  }
  // Ídem la lista de tareas cacheada (GET /api/tasks): tareas, subtareas,
  // comentarios, columnas y el asistente (crea tareas y deshace borrados).
  // Se invalida antes y después: un GET que llegue mientras tanto no guarda la vieja.
  if (req.method !== 'GET' && req.method !== 'HEAD' && TASK_WRITE_PATHS.test(req.path)) {
    bumpTasksVersion();
    res.on('finish', bumpTasksVersion);
  }
  next();
});
app.use('/api', requireModuleEditor);
app.use('/api', devicesRouter);
app.use('/api', loansRouter);
app.use('/api', loansUndoRouter);
app.use('/api', inventoryRouter);
app.use('/api', photoPassesRouter);
app.use('/api', ticketsRouter);
app.use('/api', agendaRouter);
app.use('/api', schedulesRouter);
app.use('/api', pettyCashRouter);
app.use('/api', tasksRouter);
app.use('/api', assistantRouter);
app.use('/api', classroomsRouter);
app.use('/api', toolsRouter);
app.use('/api', operationsRouter);
app.use('/api', historyRouter);
// Una ruta de API que no existe responde 404 en JSON. Antes caía en el
// fallback de la SPA y devolvía el index.html con 200: el front recibía HTML
// donde esperaba JSON y el error quedaba escondido.
app.use('/api', (req, res) => res.status(404).json({ ok: false, error: `No existe ${req.method} /api${req.path}.` }));

const distDir = path.join(config.rootDir, 'dist');
// Los assets de Vite llevan hash en el nombre: se pueden cachear para siempre y
// el browser deja de revalidarlos en cada carga. index.html y sw.js, en cambio,
// siempre se revalidan para que un deploy nuevo se tome enseguida.
app.use('/assets', express.static(path.join(distDir, 'assets'), {
  immutable: true,
  maxAge: '1y'
}));
app.use(express.static(distDir, {
  maxAge: '1h',
  setHeaders(res, filePath) {
    const name = path.basename(filePath);
    if (name === 'index.html' || name === 'sw.js' || name === 'manifest.webmanifest') {
      res.setHeader('Cache-Control', 'no-cache');
    }
  }
}));
app.get('*', (_req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.sendFile(path.join(distDir, 'index.html'), error => {
    if (error) res.status(200).send('TechAsset - NFS backend activo. En desarrollo abrí http://127.0.0.1:5173; para producción ejecutá npm run build.');
  });
});

app.use((error, req, res, _next) => {
  console.error(error);
  // Sentry solo si hay SENTRY_DSN (sin cuerpo, cookies ni query: services/errorReporting.js).
  reportError(error, { method: req.method, path: req.path });
  res.status(500).json({ ok: false, error: error.message || 'Error interno' });
});

const bindHost = process.env.SERVER_HOST || '0.0.0.0';
const port = Number(process.env.PORT) || config.port;
app.listen(port, bindHost, () => {
  console.log(`${config.appName} listo en http://${bindHost === '0.0.0.0' ? '127.0.0.1' : bindHost}:${port}`);
});
