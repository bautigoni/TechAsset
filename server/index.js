import { config } from './config.js';
import { getDb } from './db.js';
import { startNotificationWorkers } from './services/notifications.service.js';
import { app } from './app.js';

// Un error async que nadie atrapó (ej. la base no respondió a tiempo dentro de
// un handler sin try/catch) mataba el proceso en Node 20: systemd lo reiniciaba
// y durante el arranque Caddy devolvía 502. Se loguea y la app sigue.
process.on('unhandledRejection', error => {
  console.error('[unhandledRejection]', error);
});

getDb();
// Cada 30 s alcanza para recordatorios y avisos, y son 3 veces menos consultas
// bloqueantes a la base remota que con 10 s.
startNotificationWorkers(Number(process.env.NOTIFICATION_WORKER_MS) || 30000);

const bindHost = process.env.SERVER_HOST || '0.0.0.0';
const port = Number(process.env.PORT) || config.port;
const server = app.listen(port, bindHost, () => {
  console.log(`${config.appName} listo en http://${bindHost === '0.0.0.0' ? '127.0.0.1' : bindHost}:${port}`);
});

// Los 502 venían de acá: Node cierra una conexión keep-alive ociosa a los 5 s y,
// si el hilo estaba ocupado, la cierra justo cuando Caddy la reutiliza para el
// request siguiente → Caddy responde 502. Con un timeout más largo que el del
// proxy, el que cierra es siempre Caddy. (Medido: 7 resets en 60 s → 0.)
server.keepAliveTimeout = 125_000;
server.headersTimeout = 126_000;
