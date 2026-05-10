import { config } from '../config.js';

function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function appUrl(path = '') {
  const base = (config.appBaseUrl || 'http://127.0.0.1:8000').replace(/\/+$/, '');
  if (!path) return base;
  return `${base}/${String(path).replace(/^\/+/, '')}`;
}

function approvalUrl(siteCode) {
  const code = encodeURIComponent(String(siteCode || '').trim());
  return code
    ? appUrl(`sede/${code}/configuracion/usuarios`)
    : appUrl('configuracion/usuarios');
}

function shell({ title, body, footer }) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:0;background:#0f172a;font-family:Arial,Helvetica,sans-serif;color:#e5e7eb;">
  <div style="max-width:640px;margin:0 auto;padding:32px 20px;">
    <div style="background:#111c33;border:1px solid #2b3b5f;border-radius:18px;padding:28px;">
      ${body}
    </div>
    <p style="text-align:center;color:#64748b;font-size:12px;margin-top:18px;">
      ${footer || 'TechAsset · Gestión tecnológica escolar'}
    </p>
  </div>
</body></html>`;
}

function infoBox(html) {
  return `<div style="background:#172642;border:1px solid #2f4773;border-radius:14px;padding:18px;margin-bottom:22px;">${html}</div>`;
}

function ctaButton(href, label, color = '#3b82f6') {
  return `<a href="${escapeHtml(href)}" style="display:inline-block;background:${color};color:#ffffff;text-decoration:none;font-weight:700;padding:13px 20px;border-radius:12px;">${escapeHtml(label)}</a>`;
}

// ─────────────────────────────────────────────────────────────────────
//  Registro: mail al ADMIN
// ─────────────────────────────────────────────────────────────────────
export function buildRegistrationAdminMail({ nombre, email, sede, rol, turno, fecha }) {
  const link = approvalUrl(sede);
  const subject = `Nueva solicitud de acceso a TechAsset (${sede || 'sin sede'})`;
  const html = shell({
    title: subject,
    body: `
      <h1 style="margin:0 0 8px;font-size:24px;color:#ffffff;">Nueva solicitud de acceso</h1>
      <p style="margin:0 0 24px;color:#aebbd4;font-size:14px;">
        Se recibió una nueva solicitud para ingresar a <strong>TechAsset</strong>.
      </p>
      ${infoBox(`
        <p style="margin:0 0 10px;"><strong>Nombre:</strong> ${escapeHtml(nombre)}</p>
        <p style="margin:0 0 10px;"><strong>Mail:</strong> ${escapeHtml(email)}</p>
        <p style="margin:0 0 10px;"><strong>Sede solicitada:</strong> ${escapeHtml(sede)}</p>
        <p style="margin:0 0 10px;"><strong>Rol solicitado:</strong> ${escapeHtml(rol)}</p>
        <p style="margin:0 0 10px;"><strong>Turno:</strong> ${escapeHtml(turno)}</p>
        <p style="margin:0;"><strong>Fecha:</strong> ${escapeHtml(fecha)}</p>
      `)}
      <p style="margin:0 0 22px;color:#dbeafe;">
        El usuario quedó <strong>pendiente de aprobación</strong>.
      </p>
      ${ctaButton(link, 'Revisar solicitud')}
      <p style="margin:22px 0 0;color:#9ca3af;font-size:13px;">
        También podés ingresar manualmente a <strong>Configuración &gt; Usuarios permitidos</strong>.
      </p>
    `
  });
  const text =
`Se recibió una nueva solicitud de acceso a TechAsset.

Nombre: ${nombre}
Mail: ${email}
Sede solicitada: ${sede}
Rol solicitado: ${rol}
Turno: ${turno}
Fecha: ${fecha}

El usuario quedó pendiente de aprobación.

Revisar solicitud: ${link}
También podés entrar manualmente a Configuración > Usuarios permitidos.`;
  return { subject, html, text, approvalUrl: link };
}

// ─────────────────────────────────────────────────────────────────────
//  Registro: mail al USUARIO
// ─────────────────────────────────────────────────────────────────────
export function buildRegistrationUserMail({ nombre, sede }) {
  const subject = 'Solicitud recibida en TechAsset';
  const html = shell({
    title: subject,
    body: `
      <h1 style="margin:0 0 8px;font-size:24px;color:#ffffff;">Solicitud recibida</h1>
      <p style="color:#dbeafe;font-size:15px;line-height:1.5;">
        Hola <strong>${escapeHtml(nombre)}</strong>,
      </p>
      <p style="color:#cbd5e1;font-size:15px;line-height:1.5;">
        Recibimos tu solicitud de acceso a <strong>TechAsset</strong> para la sede <strong>${escapeHtml(sede || 'sin sede')}</strong>.
      </p>
      ${infoBox(`
        <p style="margin:0;color:#dbeafe;">
          Tu cuenta quedó <strong>pendiente de aprobación</strong>. Cuando un administrador la apruebe, vas a poder ingresar a la plataforma.
        </p>
      `)}
      <p style="color:#94a3b8;font-size:13px;margin-bottom:0;">
        No hace falta que respondas este correo.
      </p>
    `
  });
  const text =
`Hola ${nombre},

Recibimos tu solicitud de acceso a TechAsset para la sede ${sede || 'sin sede'}.

Tu cuenta quedó pendiente de aprobación. Cuando un administrador la apruebe, vas a poder ingresar a la plataforma.

— TechAsset`;
  return { subject, html, text };
}

// ─────────────────────────────────────────────────────────────────────
//  Aprobación: mail al USUARIO
// ─────────────────────────────────────────────────────────────────────
export function buildUserApprovedMail({ nombre, sede }) {
  const link = appUrl('');
  const subject = 'Tu acceso a TechAsset fue aprobado';
  const html = shell({
    title: subject,
    body: `
      <h1 style="margin:0 0 8px;font-size:24px;color:#ffffff;">¡Acceso aprobado!</h1>
      <p style="color:#dbeafe;font-size:15px;line-height:1.5;">
        Hola <strong>${escapeHtml(nombre)}</strong>,
      </p>
      <p style="color:#cbd5e1;font-size:15px;line-height:1.5;">
        Tu solicitud para ingresar a <strong>TechAsset</strong>${sede ? ` (sede <strong>${escapeHtml(sede)}</strong>)` : ''} fue aprobada.
      </p>
      ${infoBox(`<p style="margin:0;color:#dbeafe;">Ya podés iniciar sesión con el mail registrado.</p>`)}
      ${ctaButton(link, 'Ingresar a TechAsset', '#16a34a')}
      <p style="margin:22px 0 0;color:#9ca3af;font-size:13px;">
        Si el botón no funciona, copiá y pegá esta URL en el navegador:<br/>
        <span style="color:#cbd5e1;">${escapeHtml(link)}</span>
      </p>
    `
  });
  const text =
`Hola ${nombre},

Tu solicitud para ingresar a TechAsset${sede ? ` (sede ${sede})` : ''} fue aprobada.

Ya podés iniciar sesión.

Ingresá: ${link}

— TechAsset`;
  return { subject, html, text };
}

// ─────────────────────────────────────────────────────────────────────
//  Rechazo / desactivación: mail al USUARIO
// ─────────────────────────────────────────────────────────────────────
export function buildUserRejectedMail({ nombre, motivo }) {
  const subject = 'Solicitud de acceso a TechAsset';
  const html = shell({
    title: subject,
    body: `
      <h1 style="margin:0 0 8px;font-size:24px;color:#ffffff;">Solicitud actualizada</h1>
      <p style="color:#dbeafe;font-size:15px;line-height:1.5;">
        Hola <strong>${escapeHtml(nombre)}</strong>,
      </p>
      <p style="color:#cbd5e1;font-size:15px;line-height:1.5;">
        Tu solicitud de acceso a <strong>TechAsset</strong> no fue aprobada en este momento.
      </p>
      ${motivo ? infoBox(`<p style="margin:0;color:#dbeafe;"><strong>Motivo:</strong> ${escapeHtml(motivo)}</p>`) : ''}
      <p style="color:#94a3b8;font-size:13px;margin-bottom:0;">
        Si pensás que es un error, comunicate con el equipo TIC de tu sede.
      </p>
    `
  });
  const text =
`Hola ${nombre},

Tu solicitud de acceso a TechAsset no fue aprobada en este momento.${motivo ? `\n\nMotivo: ${motivo}` : ''}

Si pensás que es un error, comunicate con el equipo TIC de tu sede.

— TechAsset`;
  return { subject, html, text };
}

export function buildUserDeactivatedMail({ nombre }) {
  const subject = 'Tu acceso a TechAsset fue desactivado';
  const html = shell({
    title: subject,
    body: `
      <h1 style="margin:0 0 8px;font-size:24px;color:#ffffff;">Acceso desactivado</h1>
      <p style="color:#cbd5e1;font-size:15px;line-height:1.5;">
        Hola <strong>${escapeHtml(nombre)}</strong>, tu acceso a TechAsset fue desactivado por un administrador.
      </p>
      ${infoBox(`<p style="margin:0;color:#dbeafe;">Si necesitás recuperar el acceso, contactá al equipo TIC de tu sede.</p>`)}
    `
  });
  const text =
`Hola ${nombre},

Tu acceso a TechAsset fue desactivado por un administrador.

Si necesitás recuperar el acceso, contactá al equipo TIC de tu sede.

— TechAsset`;
  return { subject, html, text };
}

export { appUrl, approvalUrl };
