import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { getDb, invalidateSiteSettings, isPg } from './db.js';
import { startNotificationWorkers } from './services/notifications.service.js';
import { importPostgresIntoSqlite } from './services/pgImport.service.js';
import { app } from './app.js';

// Un error async que nadie atrapó (ej. la base no respondió a tiempo dentro de
// un handler sin try/catch) mataba el proceso en Node 20: systemd lo reiniciaba
// y durante el arranque Caddy devolvía 502. Se loguea y la app sigue.
process.on('unhandledRejection', error => {
  console.error('[unhandledRejection]', error);
});

await importFromPostgresIfAsked();
getDb();

// En el servidor de prueba (mientras la versión vieja sigue andando con los
// mismos datos) los avisos y recordatorios no se mandan: saldrían duplicados.
if (!/^(1|true|si|yes)$/i.test(String(process.env.WORKERS_DISABLED || ''))) {
  // Cada 30 s alcanza para recordatorios y avisos, y son 3 veces menos consultas que con 10 s.
  startNotificationWorkers(Number(process.env.NOTIFICATION_WORKER_MS) || 30000);
} else {
  console.log('[workers] desactivados por WORKERS_DISABLED');
}

const bindHost = process.env.SERVER_HOST || '0.0.0.0';
const port = Number(process.env.PORT) || config.port;
const server = app.listen(port, bindHost, () => {
  console.log(`${config.appName} listo en http://${bindHost === '0.0.0.0' ? '127.0.0.1' : bindHost}:${port}`);
});

// Los 502 venían de acá: Node cierra una conexión keep-alive ociosa a los 5 s y,
// si el hilo estaba ocupado, la cierra justo cuando el proxy la reutiliza para el
// request siguiente → el proxy responde 502. Con un timeout más largo que el del
// proxy, el que cierra es siempre el proxy. (Medido: 7 resets en 60 s → 0.)
server.keepAliveTimeout = 125_000;
server.headersTimeout = 126_000;

/**
 * Corte de Supabase a SQLite, hecho por la app al arrancar.
 *
 * Con IMPORT_FROM_DATABASE_URL (la URL de Supabase) e IMPORT_ID (cualquier
 * texto, ej. "corte-2026-11-20") la app borra su base SQLite, copia Postgres
 * entero, verifica tabla por tabla y deja una marca .imported-<IMPORT_ID>. Con
 * la misma IMPORT_ID no lo vuelve a hacer; para copiar de nuevo (ej. la prueba y
 * después el corte definitivo) se cambia IMPORT_ID y se reinicia. Al terminar el
 * corte se borran las dos variables. No deja copias de la base vieja (pesan).
 */
async function importFromPostgresIfAsked() {
  const from = String(process.env.IMPORT_FROM_DATABASE_URL || '').trim();
  const importId = String(process.env.IMPORT_ID || '').trim().replace(/[^\w.-]/g, '_');
  if (!from || !importId) return;
  if (isPg()) {
    console.error('[import] IMPORT_FROM_DATABASE_URL se ignora: la app está usando Postgres (sacá DATABASE_URL).');
    return;
  }
  const dir = path.dirname(config.sqliteDbPath);
  const marker = path.join(dir, `.imported-${importId}`);
  if (fs.existsSync(marker)) return;
  fs.mkdirSync(dir, { recursive: true });
  console.log(`[import] copiando Postgres → ${config.sqliteDbPath} (${importId})…`);
  for (const file of [config.sqliteDbPath, `${config.sqliteDbPath}-wal`, `${config.sqliteDbPath}-shm`]) {
    if (fs.existsSync(file)) fs.rmSync(file);
  }
  const started = Date.now();
  const result = await importPostgresIntoSqlite({ connectionString: from, lite: getDb(), log: line => console.log(`[import] ${line}`) });
  if (!result.ok) {
    // Sin marca: el próximo arranque lo vuelve a intentar desde cero.
    console.error('[import] ✖ la copia no coincide; la app no arranca con datos incompletos.');
    process.exit(1);
  }
  invalidateSiteSettings();
  for (const name of fs.readdirSync(dir)) if (name.startsWith('.imported-')) fs.rmSync(path.join(dir, name));
  fs.writeFileSync(marker, JSON.stringify({ at: new Date().toISOString(), tables: result.tables, rows: result.rows, seconds: Math.round((Date.now() - started) / 1000) }));
  console.log(`[import] ✔ ${result.rows} filas en ${Math.round((Date.now() - started) / 1000)} s`);
}
