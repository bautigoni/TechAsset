import { config } from '../config.js';

function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function appUrl(path = '') {
  const base = (config.appBaseUrl || config.techassetPublicUrl || 'https://techasset.bauhub.online').replace(/\/+$/, '');
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
//  Broadcast de release / "App actualizada"
// ─────────────────────────────────────────────────────────────────────
function markdownToHtml(md) {
  const lines = String(md || '').split('\n');
  let html = '';
  let inList = false;
  for (const raw of lines) {
    const line = raw.trim();
    const bold = (s) => escapeHtml(s).replace(/\*\*(.+?)\*\*/g, '<strong style="color:#ffffff;">$1</strong>');
    if (/^[-*]\s+/.test(line)) {
      if (!inList) { html += '<ul style="margin:0 0 16px;padding-left:18px;color:#dbeafe;font-size:14px;line-height:1.6;">'; inList = true; }
      html += `<li style="margin:0 0 6px;">${bold(line.replace(/^[-*]\s+/, ''))}</li>`;
    } else {
      if (inList) { html += '</ul>'; inList = false; }
      if (line) html += `<p style="margin:0 0 12px;color:#aebbd4;font-size:14px;">${bold(line)}</p>`;
    }
  }
  if (inList) html += '</ul>';
  return html;
}

export function buildReleaseBroadcastMail({ version, title, bodyMd, appUrl: url }) {
  const subject = `TechAsset actualizado: ${title} (v${version})`;
  const link = url || appUrl();
  const body = `
    <p style="margin:0 0 6px;color:#9fb3d1;font-size:12px;text-transform:uppercase;letter-spacing:.05em;">Novedades · v${escapeHtml(version)}</p>
    <h1 style="margin:0 0 16px;font-size:24px;color:#ffffff;">${escapeHtml(title)}</h1>
    ${infoBox(markdownToHtml(bodyMd))}
    ${ctaButton(link, 'Abrir TechAsset')}
    <p style="margin:22px 0 0;color:#9ca3af;font-size:13px;">¡Ya podés instalar la app en tu celu! Entrá desde el navegador y tocá "Instalar".</p>
  `;
  const html = shell({ title: subject, body });
  const text = `${title} (v${version})\n\n${String(bodyMd || '').replace(/\*\*/g, '')}\n\nAbrí TechAsset: ${link}`;
  return { subject, html, text };
}

// ─────────────────────────────────────────────────────────────────────
//  Invitación con código
// ─────────────────────────────────────────────────────────────────────
export function buildInviteMail({ siteName, code, role, registerUrl, expiresAt, isAdmin }) {
  const subject = isAdmin
    ? `Tu acceso de administrador a TechAsset (${siteName})`
    : `Te invitaron a TechAsset (${siteName})`;
  // En la fecha de la sede (la VM corre en UTC: de noche caía un día después).
  const vence = expiresAt ? new Date(expiresAt).toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' }) : 'sin vencimiento';
  const body = `
    <h1 style="margin:0 0 8px;font-size:24px;color:#ffffff;">${escapeHtml(isAdmin ? 'Acceso de administrador' : 'Te sumaron al equipo')}</h1>
    <p style="margin:0 0 22px;color:#aebbd4;font-size:14px;">
      Fuiste invitado a <strong>${escapeHtml(siteName)}</strong> en <strong>TechAsset</strong>${role ? ` como <strong>${escapeHtml(role)}</strong>` : ''}.
      Usá este código para registrarte:
    </p>
    ${infoBox(`
      <p style="margin:0 0 6px;color:#9fb3d1;font-size:12px;text-transform:uppercase;letter-spacing:.05em;">Código de invitación</p>
      <p style="margin:0;font-size:30px;font-weight:800;letter-spacing:.08em;color:#7dd3fc;font-family:monospace;">${escapeHtml(code)}</p>
    `)}
    <p style="margin:0 0 22px;color:#dbeafe;">Válido hasta <strong>${escapeHtml(vence)}</strong>. Es de un solo uso.</p>
    ${ctaButton(registerUrl, 'Registrarme ahora')}
    <p style="margin:22px 0 0;color:#9ca3af;font-size:13px;">
      Si el botón no funciona, entrá a ${escapeHtml(registerUrl)} y pegá el código.
    </p>
  `;
  const html = shell({ title: subject, body });
  const text = `Te invitaron a ${siteName} en TechAsset${role ? ` como ${role}` : ''}.\nCódigo: ${code}\nVálido hasta: ${vence} (un solo uso).\nRegistrate en: ${registerUrl}`;
  return { subject, html, text };
}

// ─────────────────────────────────────────────────────────────────────
//  Registro con invitación: mail a los ADMIN de la sede
//  La cuenta queda ACTIVA al canjear el código (no hay aprobación): el mail
//  avisa quién entró, con qué rol, y cómo desactivarla si no corresponde.
//  `sedeNombre` es el nombre de la sede (no el código); `fecha` ya viene en
//  hora de la sede y 24 h (formatLocalDateTime).
// ─────────────────────────────────────────────────────────────────────
export function buildRegistrationAdminMail({ nombre, email, sedeCodigo, sedeNombre, rol, fecha }) {
  const link = approvalUrl(sedeCodigo);
  const sede = sedeNombre || sedeCodigo || 'sin sede';
  const subject = `Nueva cuenta en TechAsset: ${nombre} (${sede})`;
  const html = shell({
    title: subject,
    body: `
      <h1 style="margin:0 0 8px;font-size:24px;color:#ffffff;">Nueva cuenta con invitación</h1>
      <p style="margin:0 0 24px;color:#aebbd4;font-size:14px;">
        <strong>${escapeHtml(nombre)}</strong> creó su cuenta en <strong>TechAsset</strong> con un código de invitación de la sede <strong>${escapeHtml(sede)}</strong>. La cuenta ya está activa.
      </p>
      ${infoBox(`
        <p style="margin:0 0 10px;"><strong>Nombre:</strong> ${escapeHtml(nombre)}</p>
        <p style="margin:0 0 10px;"><strong>Mail:</strong> ${escapeHtml(email)}</p>
        <p style="margin:0 0 10px;"><strong>Sede:</strong> ${escapeHtml(sede)}</p>
        <p style="margin:0 0 10px;"><strong>Rol (de la invitación):</strong> ${escapeHtml(rol)}</p>
        <p style="margin:0;"><strong>Fecha:</strong> ${escapeHtml(fecha)}</p>
      `)}
      ${ctaButton(link, 'Ver usuarios de la sede')}
      <p style="margin:22px 0 0;color:#9ca3af;font-size:13px;">
        Si la cuenta no corresponde, desactivala desde <strong>Configuración &gt; Usuarios</strong>.
      </p>
    `
  });
  const text =
`${nombre} creó su cuenta en TechAsset con un código de invitación de la sede ${sede}. La cuenta ya está activa.

Nombre: ${nombre}
Mail: ${email}
Sede: ${sede}
Rol (de la invitación): ${rol}
Fecha: ${fecha}

Ver usuarios de la sede: ${link}
Si la cuenta no corresponde, desactivala desde Configuración > Usuarios.`;
  return { subject, html, text, approvalUrl: link };
}

// ─────────────────────────────────────────────────────────────────────
//  Registro con invitación: mail al USUARIO (la cuenta ya está activa)
// ─────────────────────────────────────────────────────────────────────
export function buildRegistrationUserMail({ nombre, sedeNombre, rol }) {
  const link = appUrl('login');
  const privacy = appUrl('privacidad');
  const sede = sedeNombre || 'tu sede';
  const subject = 'Tu cuenta de TechAsset está lista';
  const html = shell({
    title: subject,
    body: `
      <h1 style="margin:0 0 8px;font-size:24px;color:#ffffff;">Tu cuenta está lista</h1>
      <p style="color:#dbeafe;font-size:15px;line-height:1.5;">
        Hola <strong>${escapeHtml(nombre)}</strong>,
      </p>
      <p style="color:#cbd5e1;font-size:15px;line-height:1.5;">
        Creaste tu cuenta de <strong>TechAsset</strong> en la sede <strong>${escapeHtml(sede)}</strong>${rol ? ` con el rol <strong>${escapeHtml(rol)}</strong>` : ''}. Ya podés entrar con tu mail y tu contraseña.
      </p>
      ${ctaButton(link, 'Entrar a TechAsset')}
      <p style="margin:22px 0 0;color:#9ca3af;font-size:13px;">
        Qué datos se guardan y cómo pedir la baja: <a href="${escapeHtml(privacy)}" style="color:#cbd5e1;">${escapeHtml(privacy)}</a>.<br/>
        Si no fuiste vos, avisale al equipo TIC de tu sede.
      </p>
    `
  });
  const text =
`Hola ${nombre},

Creaste tu cuenta de TechAsset en la sede ${sede}${rol ? ` con el rol ${rol}` : ''}. Ya podés entrar con tu mail y tu contraseña: ${link}

Qué datos se guardan y cómo pedir la baja: ${privacy}
Si no fuiste vos, avisale al equipo TIC de tu sede.

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

// ─────────────────────────────────────────────────────────────────────
//  Contraseña: link de un solo uso para crearla o cambiarla
// ─────────────────────────────────────────────────────────────────────
export function buildPasswordLinkMail({ nombre, url, firstTime }) {
  const subject = firstTime ? 'Creá tu contraseña de TechAsset' : 'Cambiá tu contraseña de TechAsset';
  const html = shell({
    title: subject,
    body: `
      <h1 style="margin:0 0 8px;font-size:24px;color:#ffffff;">${escapeHtml(firstTime ? 'Creá tu contraseña' : 'Cambiá tu contraseña')}</h1>
      <p style="margin:0 0 22px;color:#cbd5e1;font-size:15px;line-height:1.5;">
        Hola <strong>${escapeHtml(nombre)}</strong>, alguien pidió ${firstTime ? 'crear la contraseña' : 'cambiar la contraseña'} de tu cuenta de TechAsset.
        El link vale por 1 hora y se puede usar una sola vez.
      </p>
      ${ctaButton(url, firstTime ? 'Crear contraseña' : 'Cambiar contraseña')}
      <p style="margin:22px 0 0;color:#9ca3af;font-size:13px;">Si no fuiste vos, ignorá este mail: tu cuenta no cambia.</p>
    `
  });
  const text = `Hola ${nombre},\n\nPara ${firstTime ? 'crear' : 'cambiar'} tu contraseña de TechAsset entrá a:\n${url}\n\nEl link vale por 1 hora y es de un solo uso. Si no fuiste vos, ignorá este mail.\n\n— TechAsset`;
  return { subject, html, text };
}

// ─────────────────────────────────────────────────────────────────────
//  Contraseña cambiada desde Configuración › Cuenta (aviso de seguridad)
// ─────────────────────────────────────────────────────────────────────
export function buildPasswordChangedMail({ nombre, fecha }) {
  const subject = 'Cambiaste tu contraseña de TechAsset';
  const html = shell({
    title: subject,
    body: `
      <h1 style="margin:0 0 8px;font-size:24px;color:#ffffff;">Contraseña cambiada</h1>
      <p style="margin:0 0 22px;color:#cbd5e1;font-size:15px;line-height:1.5;">
        Hola <strong>${escapeHtml(nombre)}</strong>, la contraseña de tu cuenta de TechAsset se cambió el ${escapeHtml(fecha)}.
        Las sesiones abiertas en otros dispositivos se cerraron.
      </p>
      <p style="margin:0;color:#9ca3af;font-size:13px;">Si no fuiste vos, avisale ya al equipo TIC de tu sede.</p>
    `
  });
  const text = `Hola ${nombre},\n\nLa contraseña de tu cuenta de TechAsset se cambió el ${fecha}. Las sesiones abiertas en otros dispositivos se cerraron.\n\nSi no fuiste vos, avisale ya al equipo TIC de tu sede.\n\n— TechAsset`;
  return { subject, html, text };
}

export { appUrl, approvalUrl };
