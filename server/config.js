import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

dotenv.config({ path: path.join(rootDir, '.env') });

function publicUrl(value, fallback = 'https://techasset.bauhub.online') {
  const raw = String(value || '').trim();
  if (!raw || /work\.gd/i.test(raw)) return fallback;
  return raw.replace(/\/+$/, '');
}

export const config = {
  rootDir,
  port: Number(process.env.PORT || 8000),
  appName: process.env.APP_NAME || 'TechAsset - NFS',
  siteCode: process.env.SITE_CODE || 'NFPT',
  defaultSiteCode: process.env.DEFAULT_SITE_CODE || process.env.SITE_CODE || 'NFPT',
  bootstrapSites: process.env.BOOTSTRAP_SITES || '',
  authAllowedEmails: (process.env.AUTH_ALLOWED_EMAILS || '').split(',').map(item => item.trim().toLowerCase()).filter(Boolean),
  sessionCookieName: process.env.SESSION_COOKIE_NAME || 'techasset_session',
  googleSheetCsvUrl: process.env.GOOGLE_SHEET_CSV_URL || '',
  sheetCacheTtlMs: Number(process.env.SHEET_CACHE_TTL_MS || 5000),
  sheetFetchTimeoutMs: Number(process.env.SHEET_FETCH_TIMEOUT_MS || 4500),
  dbDriver: String(process.env.DB_DRIVER || (process.env.DATABASE_URL ? 'postgres' : 'sqlite')).toLowerCase(),
  databaseUrl: process.env.DATABASE_URL || '',
  sqliteDbPath: path.resolve(rootDir, process.env.SQLITE_DB_PATH || './data/techasset.db'),
  cacheCsvPath: path.resolve(rootDir, process.env.CACHE_CSV_PATH || './data/cache_sheet.csv'),
  devicesAppCsvPath: path.resolve(rootDir, process.env.DEVICES_APP_CSV_PATH || './data/devices_app.csv'),
  openaiApiKey: process.env.OPENAI_API_KEY || '',
  openaiModel: process.env.OPENAI_MODEL || '',
  openaiPromptId: process.env.OPENAI_PROMPT_ID || '',
  localtunnelSubdomain: process.env.LOCALTUNNEL_SUBDOMAIN || 'techasset-nfpt',
  toolsTempDir: path.resolve(rootDir, process.env.TOOLS_TEMP_DIR || './data/tmp'),
  maxUploadMb: Number(process.env.MAX_UPLOAD_MB || 10),
  smtp: {
    server: process.env.SMTP_SERVER || '',
    port: Number(process.env.SMTP_PORT || 465),
    user: process.env.SMTP_USER || '',
    appPassword: process.env.SMTP_APP_PASSWORD || '',
    mailFrom: process.env.MAIL_FROM || '',
    subject: process.env.MAIL_SUBJECT || 'Credenciales de acceso',
    modoPrueba: String(process.env.MODO_PRUEBA || 'true').toLowerCase() !== 'false',
    microsoftLoginUrl: process.env.MICROSOFT_LOGIN_URL || ''
  },
  resend: {
    apiKey: process.env.RESEND_API_KEY || '',
    // Remitente verificado en Resend, ej. "TechAsset <noreply@mail.tudominio.com>".
    from: process.env.RESEND_FROM || process.env.MAIL_FROM || ''
  },
  appBaseUrl: publicUrl(process.env.APP_BASE_URL || process.env.TECHASSET_PUBLIC_URL),
  // La cookie de sesión viaja con Secure cuando la app se sirve por HTTPS. Se
  // deduce de APP_BASE_URL para no romper el desarrollo local por http.
  sessionCookieSecure: String(process.env.SESSION_COOKIE_SECURE || '').toLowerCase() === 'true'
    || /^https:/i.test(String(process.env.APP_BASE_URL || process.env.TECHASSET_PUBLIC_URL || '')),
  superadminEmails: String(process.env.SUPERADMIN_EMAILS || '')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean),
  techassetPublicUrl: publicUrl(process.env.TECHASSET_PUBLIC_URL || process.env.APP_BASE_URL),
  handingTicketUrl: publicUrl(process.env.HANDING_TICKET_URL || process.env.TECHASSET_PUBLIC_URL),
  vapid: {
    publicKey: process.env.VAPID_PUBLIC_KEY || '',
    privateKey: process.env.VAPID_PRIVATE_KEY || '',
    subject: process.env.VAPID_SUBJECT || 'mailto:techassetbot@gmail.com'
  },
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    // Redirect URI tiene que matchear EXACTAMENTE lo cargado en Google Cloud Console.
    redirectUri: process.env.GOOGLE_REDIRECT_URI || '',
    // CSV de dominios permitidos (sin @). Vacío = acepta cualquier Google account
    // (el gatekeeper sigue siendo allowed_users).
    allowedDomains: (process.env.GOOGLE_ALLOWED_DOMAINS || '')
      .split(',')
      .map(item => item.trim().toLowerCase())
      .filter(Boolean)
  }
};
