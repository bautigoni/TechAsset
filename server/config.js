import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

dotenv.config({ path: path.join(rootDir, '.env') });

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
  appsScriptUrl: process.env.APPS_SCRIPT_URL || '',
  appsScriptInventoryUrl: process.env.APPS_SCRIPT_INVENTORY_URL || '',
  sheetCacheTtlMs: Number(process.env.SHEET_CACHE_TTL_MS || 5000),
  sheetFetchTimeoutMs: Number(process.env.SHEET_FETCH_TIMEOUT_MS || 4500),
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
  handingTicketUrl: process.env.HANDING_TICKET_URL || ''
};
