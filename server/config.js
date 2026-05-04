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
  googleSheetCsvUrl: process.env.GOOGLE_SHEET_CSV_URL || '',
  appsScriptUrl: process.env.APPS_SCRIPT_URL || '',
  sqliteDbPath: path.resolve(rootDir, process.env.SQLITE_DB_PATH || './data/techasset.db'),
  cacheCsvPath: path.resolve(rootDir, process.env.CACHE_CSV_PATH || './data/cache_sheet.csv'),
  devicesAppCsvPath: path.resolve(rootDir, process.env.DEVICES_APP_CSV_PATH || './data/devices_app.csv'),
  openaiApiKey: process.env.OPENAI_API_KEY || '',
  openaiModel: process.env.OPENAI_MODEL || '',
  openaiPromptId: process.env.OPENAI_PROMPT_ID || '',
  localtunnelSubdomain: process.env.LOCALTUNNEL_SUBDOMAIN || 'techasset-nfpt'
};
