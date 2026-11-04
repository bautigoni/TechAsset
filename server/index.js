import { config } from './config.js';
import { getDb } from './db.js';
import { startNotificationWorkers } from './services/notifications.service.js';
import { installCrashReporting } from './services/errorReporting.js';
import { app } from './app.js';

getDb();
startNotificationWorkers();
installCrashReporting();

const bindHost = process.env.SERVER_HOST || '0.0.0.0';
const port = Number(process.env.PORT) || config.port;
app.listen(port, bindHost, () => {
  console.log(`${config.appName} listo en http://${bindHost === '0.0.0.0' ? '127.0.0.1' : bindHost}:${port}`);
});
