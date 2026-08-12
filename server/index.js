import express from 'express';
import compression from 'compression';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import { config } from './config.js';
import { getDb } from './db.js';
import { devicesRouter } from './routes/devices.routes.js';
import { loansRouter } from './routes/loans.routes.js';
import { agendaRouter } from './routes/agenda.routes.js';
import { tasksRouter } from './routes/tasks.routes.js';
import { analyticsRouter } from './routes/analytics.routes.js';
import { assistantRouter } from './routes/assistant.routes.js';
import { prestamosRouter } from './routes/prestamos.routes.js';
import { procedimientosRouter } from './routes/procedimientos.routes.js';
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
import { googleAuthRouter } from './routes/googleAuth.routes.js';
import { notificationsRouter } from './routes/notifications.routes.js';
import { userPrefsRouter } from './routes/userPrefs.routes.js';
import { calendarRouter, publicCalendarRouter } from './routes/calendar.routes.js';
import { schedulesRouter } from './routes/schedules.routes.js';
import { pettyCashRouter } from './routes/pettyCash.routes.js';
import { suggestionsRouter } from './routes/suggestions.routes.js';
import { remindersRouter } from './routes/reminders.routes.js';
import { startNotificationWorkers } from './services/notifications.service.js';
import { authMiddleware, requireEditor } from './services/siteContext.service.js';

getDb();
startNotificationWorkers();

const app = express();
// gzip para HTML/CSS/JS/JSON. El CSS del bundle pasa de ~250 kB a ~46 kB y las
// respuestas de /api/devices bajan muchísimo. No asumimos que el reverse proxy
// comprima: en Caddy el `encode` es opt-in.
app.use(compression());
app.use(cors());
app.use(cookieParser());
app.use(express.json({ limit: `${Math.max(2, config.maxUploadMb)}mb` }));
app.use('/uploads', express.static(path.join(config.rootDir, 'data', 'uploads')));

app.use('/api', healthRouter);
app.use('/api', authRouter);
app.use('/api', googleAuthRouter);
app.use('/', publicCalendarRouter);
app.use('/api', authMiddleware);
app.use('/api', sitesRouter);
app.use('/api', invitesRouter);
app.use('/api', notificationsRouter);
app.use('/api', userPrefsRouter);
app.use('/api', calendarRouter);
app.use('/api', analyticsRouter);
// Sugerencias permite crear, votar y comentar a cualquier usuario con acceso de
// lectura al módulo; el router aplica propiedad y permisos de gestión por acción.
app.use('/api', suggestionsRouter);
app.use('/api', remindersRouter);
// A partir de acá, bloquear escrituras a usuarios de solo consulta.
// (sitesRouter ya valida manager/superadmin por endpoint.)
app.use('/api', requireEditor);
app.use('/api', devicesRouter);
app.use('/api', loansRouter);
app.use('/api', inventoryRouter);
app.use('/api', photoPassesRouter);
app.use('/api', ticketsRouter);
app.use('/api', agendaRouter);
app.use('/api', schedulesRouter);
app.use('/api', pettyCashRouter);
app.use('/api', tasksRouter);
app.use('/api', assistantRouter);
app.use('/api', prestamosRouter);
app.use('/api', procedimientosRouter);
app.use('/api', classroomsRouter);
app.use('/api', toolsRouter);
app.use('/api', operationsRouter);

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

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ ok: false, error: error.message || 'Error interno' });
});

const bindHost = process.env.SERVER_HOST || '0.0.0.0';
const port = Number(process.env.PORT) || config.port;
app.listen(port, bindHost, () => {
  console.log(`${config.appName} listo en http://${bindHost === '0.0.0.0' ? '127.0.0.1' : bindHost}:${port}`);
});
