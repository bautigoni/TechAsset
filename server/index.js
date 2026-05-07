import express from 'express';
import cors from 'cors';
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
import { loadDevicesCsv } from './services/googleSheets.service.js';

getDb();

const app = express();
app.use(cors());
app.use(express.json({ limit: `${Math.max(2, config.maxUploadMb)}mb` }));

app.get('/sheet.csv', async (_req, res, next) => {
  try {
    const { text } = await loadDevicesCsv();
    res.type('text/csv').send(text);
  } catch (error) {
    next(error);
  }
});

app.use('/api', healthRouter);
app.use('/api', devicesRouter);
app.use('/api', loansRouter);
app.use('/api', agendaRouter);
app.use('/api', tasksRouter);
app.use('/api', analyticsRouter);
app.use('/api', assistantRouter);
app.use('/api', prestamosRouter);
app.use('/api', procedimientosRouter);
app.use('/api', classroomsRouter);
app.use('/api', toolsRouter);
app.use('/api', operationsRouter);

const distDir = path.join(config.rootDir, 'dist');
app.use(express.static(distDir));
app.get('*', (_req, res) => {
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
