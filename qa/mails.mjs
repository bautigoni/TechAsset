// Muestra los mails que "salieron" (modo prueba) en la instancia de una persona,
// con los links que traen (registro, contraseña, aviso al admin).
//
//   node qa/mails.mjs --name=impaciente
//   node qa/mails.mjs --name=impaciente --to=impaciente@qa.test --last=3
import fs from 'node:fs';
import path from 'node:path';
import { flag, instanceDir, option, safeName } from './lib.mjs';

const name = safeName(option('name'));
const file = path.join(instanceDir(name), 'mails.log');
if (!fs.existsSync(file)) {
  console.log(`Todavía no salió ningún mail en "${name}" (${file}).`);
  process.exit(0);
}
const to = String(option('to') || '').toLowerCase();
const last = Number(option('last') || 0);
let mails = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)
  .map(line => { try { return JSON.parse(line); } catch { return null; } })
  .filter(Boolean)
  .filter(mail => !to || [].concat(mail.to || []).some(item => String(item).toLowerCase() === to));
if (last) mails = mails.slice(-last);
if (flag('json')) {
  console.log(JSON.stringify(mails, null, 2));
  process.exit(0);
}
for (const mail of mails) {
  const links = [...new Set(String(mail.text || '').match(/https?:\/\/[^\s)>"']+/g) || [])];
  console.log(`${mail.at || ''} · para ${[].concat(mail.to || []).join(', ')}\n  ${mail.subject || '(sin asunto)'}${links.length ? `\n  ${links.join('\n  ')}` : ''}\n`);
}
if (!mails.length) console.log('Sin mails que coincidan.');
