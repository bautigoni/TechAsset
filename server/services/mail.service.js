import { config } from '../config.js';
import { getAppSetting } from '../db.js';

let nodemailerPromise;

function loadNodemailer() {
  if (!nodemailerPromise) {
    nodemailerPromise = import('nodemailer').then(mod => mod.default || mod).catch(() => null);
  }
  return nodemailerPromise;
}

function readMailSettings() {
  const fromDb = key => {
    const value = getAppSetting(`mail.${key}`);
    return value != null && value !== '' ? value : undefined;
  };
  const port = Number(fromDb('smtpPort') ?? config.smtp.port) || 587;
  const modoPruebaRaw = fromDb('modoPrueba');
  const modoPrueba = modoPruebaRaw != null
    ? String(modoPruebaRaw).toLowerCase() !== 'false'
    : config.smtp.modoPrueba;
  return {
    server: fromDb('smtpServer') ?? config.smtp.server,
    port,
    user: fromDb('smtpUser') ?? config.smtp.user,
    appPassword: fromDb('smtpAppPassword') ?? config.smtp.appPassword,
    mailFrom: fromDb('mailFrom') ?? config.smtp.mailFrom,
    modoPrueba
  };
}

function settingsAreComplete(s) {
  return Boolean(s.server && s.user && s.appPassword && s.mailFrom);
}

/**
 * Envía un mail. Nunca rompe el flujo del caller:
 * - Si MODO_PRUEBA está activo, loguea y devuelve { sent: false, mocked: true }.
 * - Si SMTP no está configurado, loguea y devuelve { sent: false, missingConfig: true }.
 * - Si nodemailer falla, captura el error y devuelve { sent: false, error }.
 */
export async function sendMail({ to, subject, text, html, replyTo }) {
  if (!to || (Array.isArray(to) && !to.length)) return { sent: false, skipped: 'no-recipient' };
  const settings = readMailSettings();
  const recipients = Array.isArray(to) ? to.filter(Boolean) : [to];
  const safeSubject = String(subject || '(sin asunto)');

  if (settings.modoPrueba) {
    console.info(`[mail/MODO_PRUEBA] subject="${safeSubject}" to=${recipients.join(',')} (no se envió, sólo log)`);
    return { sent: false, mocked: true };
  }

  // Preferir Resend (HTTP API) si está configurado. Si falla o no está, cae a SMTP.
  if (config.resend.apiKey && config.resend.from) {
    const resendResult = await sendViaResend({ recipients, subject: safeSubject, text, html, replyTo });
    if (resendResult.sent || resendResult.hardError) return resendResult;
    console.warn('[mail] Resend no disponible, intentando SMTP…');
  }

  if (!settingsAreComplete(settings)) {
    console.warn(`[mail] SMTP incompleto, no se envía "${safeSubject}" a ${recipients.join(',')}.`);
    return { sent: false, missingConfig: true };
  }

  const nodemailer = await loadNodemailer();
  if (!nodemailer) {
    console.warn('[mail] nodemailer no disponible, no se envía.');
    return { sent: false, missingDep: true };
  }

  try {
    const transporter = nodemailer.createTransport({
      host: settings.server,
      port: settings.port,
      secure: settings.port === 465,
      auth: { user: settings.user, pass: settings.appPassword }
    });
    const info = await transporter.sendMail({
      from: settings.mailFrom,
      to: recipients.join(', '),
      replyTo: replyTo || undefined,
      subject: safeSubject,
      text: text || stripHtml(html || ''),
      html: html || undefined
    });
    transporter.close();
    return { sent: true, messageId: info.messageId };
  } catch (error) {
    console.warn(`[mail] error enviando "${safeSubject}":`, error?.message || error);
    return { sent: false, error: error?.message || 'unknown error' };
  }
}

/**
 * Envía vía Resend HTTP API (sin dependencias nuevas, usa fetch nativo de Node 22).
 * Devuelve { sent } o { sent:false, hardError } si el destinatario/payload es inválido.
 */
async function sendViaResend({ recipients, subject, text, html, replyTo }) {
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.resend.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: config.resend.from,
        to: recipients,
        subject,
        html: html || undefined,
        text: text || stripHtml(html || ''),
        reply_to: replyTo || undefined
      })
    });
    if (response.ok) {
      const data = await response.json().catch(() => ({}));
      return { sent: true, provider: 'resend', messageId: data?.id };
    }
    const errText = await response.text().catch(() => '');
    console.warn(`[mail/resend] HTTP ${response.status}: ${errText.slice(0, 200)}`);
    return { sent: false, error: `resend ${response.status}` };
  } catch (error) {
    console.warn('[mail/resend] error:', error?.message || error);
    return { sent: false, error: error?.message || 'resend error' };
  }
}

function stripHtml(value) {
  return String(value || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

export function getSuperadminRecipients() {
  return Array.from(new Set((config.superadminEmails || []).map(e => e.toLowerCase()).filter(Boolean)));
}
