// Dispara el broadcast de novedades (in-app a todos + push a suscriptos + mail a opt-in)
// y registra el release para el modal "Qué hay de nuevo".
//   node server/scripts/trigger-release.mjs
import { getDb, nowIso } from '../db.js';
import { broadcastRelease } from '../services/notifications.service.js';

const version = '1.4.0';
const title = '¡TechAsset se actualizó! 🎉';
const body = [
  '- **Tickets de InVgate** integrados: cargás el número y te arma el link directo + previsualización del PDF/foto.',
  '- **Búsqueda de tickets** y vista más prolija.',
  '- **Analítica renovada** (bento) y varios **bugs de tareas** corregidos.',
  '- **Notificaciones** in-app + push en el celu + aviso por mail si querés (Configuración → Notificaciones).',
  '- **Ya podés instalar la app en tu celu** (PWA): Compartir → Agregar a inicio.',
  '- **Configuración por sede** (cuenta admin): apagá las secciones que no usen.'
].join('\n');

const db = getDb();
const ts = nowIso();
db.prepare(`
  INSERT INTO release_notes (version, title, body_md, sent_at, sent_by)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(version) DO UPDATE SET title=excluded.title, body_md=excluded.body_md, sent_at=excluded.sent_at
`).run(version, title, body, ts, 'sistema');

const result = await broadcastRelease({ version, title, body });
console.log('BROADCAST OK:', JSON.stringify(result));
process.exit(0);
