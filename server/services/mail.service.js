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

export async function sendMail({ to, subject, text, html, replyTo }) {
  if (!to || (Array.isArray(to) && !to.length)) return { sent: false, skipped: 'no-recipient' };
  const recipients = Array.isArray(to) ? to.filter(Boolean) : [to];
  const safeSubject = String(subject || '(sin asunto)');

  // El modo prueba se resuelve UNA sola vez, antes de elegir proveedor.
  // Antes se chequeaba el env arriba y el ajuste guardado recién después de la
  // rama de Resend: con Resend configurado esa rama siempre retornaba y el
  // toggle de la interfaz no tenía ningún efecto. Un admin creía estar
  // probando y mandaba mails reales. La config de la base pisa al env, igual
  // que en readMailSettings.
  // readMailSettings ya resuelve la precedencia: base > env.
  const settings = readMailSettings();
  if (settings.modoPrueba) {
    console.info(`[mail/MODO_PRUEBA] subject="${safeSubject}" to=${recipients.join(',')} (no se envio, solo log)`);
    return { sent: false, mocked: true };
  }

  if (config.resend.apiKey && config.resend.from) {
    const resendResult = await sendViaResend({ recipients, subject: safeSubject, text, html, replyTo });
    if (resendResult.sent) return resendResult;
    console.warn('[mail] Resend configurado pero no pudo enviar; no se intenta SMTP.');
    return resendResult;
  }

  if (!settingsAreComplete(settings)) {
    console.warn(`[mail] SMTP incompleto, no se envia "${safeSubject}" a ${recipients.join(',')}.`);
    return { sent: false, missingConfig: true };
  }

  const nodemailer = await loadNodemailer();
  if (!nodemailer) {
    console.warn('[mail] nodemailer no disponible, no se envia.');
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
    return { sent: true, provider: 'smtp', messageId: info.messageId };
  } catch (error) {
    console.warn(`[mail] error enviando "${safeSubject}":`, error?.message || error);
    return { sent: false, error: error?.message || 'unknown error' };
  }
}

async function sendViaResend({ recipients, subject, text, html, replyTo }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      signal: controller.signal,
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
  } finally {
    clearTimeout(timeout);
  }
}

function stripHtml(value) {
  return String(value || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

export function getSuperadminRecipients() {
  return Array.from(new Set((config.superadminEmails || []).map(e => e.toLowerCase()).filter(Boolean)));
}
