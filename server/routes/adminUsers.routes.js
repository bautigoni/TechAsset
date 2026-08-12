import { Router } from 'express';
import { getDb } from '../db.js';
import { isSuperadmin } from '../services/siteContext.service.js';

/**
 * Panel de usuarios del superadmin: quién tiene acceso a cada tenant.
 *
 * Lo que había antes era una lista plana filtrada por la sede activa, así que
 * para mirar otro tenant había que cambiar de sede. Acá se devuelve todo junto,
 * agrupado por tenant, con los conteos y el estado de las invitaciones (el caso
 * "invitado pero nunca se registró" no se veía en ningún lado).
 *
 * Se resuelve con tres consultas fijas y se arma en memoria: el endpoint viejo
 * llamaba a getAllowedUserSites una vez por usuario (N+1), que con 6 tenants y
 * decenas de usuarios no escala.
 */
export const adminUsersRouter = Router();

adminUsersRouter.get('/admin/users-by-tenant', (req, res) => {
  if (!isSuperadmin(req.user)) {
    return res.status(403).json({ ok: false, error: 'Solo el superadmin puede ver los usuarios de todos los tenants.' });
  }

  const sites = getDb().prepare("SELECT site_code AS siteCode, nombre, subtitulo, activo FROM sites WHERE COALESCE(activo,1)=1 ORDER BY nombre").all();

  // Un JOIN para todos los accesos, con el último login que vive en `users`.
  const accesos = getDb().prepare(`
    SELECT aus.site_code AS siteCode, aus.site_role AS siteRole, aus.turno,
           au.id, au.email, au.nombre, au.default_role AS defaultRole, au.status, au.activo,
           COALESCE(u.last_login_at, '') AS lastLoginAt,
           COALESCE(u.rol_global, '') AS rolGlobal
    FROM allowed_user_sites aus
    JOIN allowed_users au ON au.id = aus.allowed_user_id
    LEFT JOIN users u ON lower(u.email) = lower(au.email)
    WHERE COALESCE(au.deleted_at,'')='' AND COALESCE(aus.activo,1)=1
    ORDER BY au.status='Pendiente' DESC, au.email
  `).all();

  const invitaciones = getDb().prepare(`
    SELECT site_code AS siteCode, id, code, email, role, turno, kind,
           expires_at AS expiresAt, used_at AS usedAt, revoked_at AS revokedAt, created_at AS createdAt,
           COALESCE(email_sent_at,'') AS emailSentAt, COALESCE(email_error,'') AS emailError
    FROM invites
    ORDER BY id DESC
  `).all();

  const ahora = Date.now();
  const inviteStatus = row => row.revokedAt ? 'Revocada'
    : row.usedAt ? 'Usada'
    : (row.expiresAt && new Date(row.expiresAt).getTime() < ahora ? 'Vencida' : 'Activa');

  const porSede = new Map(sites.map(site => [site.siteCode, { ...site, activo: Boolean(site.activo), users: [], invites: [] }]));
  for (const acceso of accesos) {
    const grupo = porSede.get(acceso.siteCode);
    if (!grupo) continue;
    grupo.users.push({
      id: Number(acceso.id),
      email: acceso.email,
      nombre: acceso.nombre || '',
      siteRole: acceso.siteRole || acceso.defaultRole || 'Consulta',
      turno: acceso.turno || 'Sin turno',
      status: acceso.status || (acceso.activo ? 'Activo' : 'Inactivo'),
      activo: Boolean(acceso.activo),
      lastLoginAt: acceso.lastLoginAt,
      esSuperadmin: acceso.rolGlobal === 'Superadmin' || acceso.defaultRole === 'Superadmin'
    });
  }
  for (const invite of invitaciones) {
    const grupo = porSede.get(invite.siteCode);
    if (!grupo) continue;
    grupo.invites.push({ ...invite, status: inviteStatus(invite) });
  }

  const tenants = [...porSede.values()].map(grupo => ({
    ...grupo,
    // Solo las 30 invitaciones más recientes por tenant: la lista completa no
    // aporta y engorda la respuesta.
    invites: grupo.invites.slice(0, 30),
    total: grupo.users.length,
    activos: grupo.users.filter(user => user.status === 'Activo').length,
    pendientes: grupo.users.filter(user => user.status === 'Pendiente').length,
    admins: grupo.users.filter(user => user.esSuperadmin || /admin|jefe/i.test(user.siteRole)).length,
    invitacionesActivas: grupo.invites.filter(invite => invite.status === 'Activa').length,
    invitacionesSinUsar: grupo.invites.filter(invite => invite.status === 'Activa' && invite.email).length
  }));

  // Usuarios sin ninguna sede asignada: quedarían invisibles en una vista
  // agrupada por tenant, y son justamente los que hay que revisar.
  const conSede = new Set(accesos.map(row => Number(row.id)));
  const huerfanos = getDb().prepare(`
    SELECT au.id, au.email, au.nombre, au.default_role AS defaultRole, au.status, au.activo,
           COALESCE(u.last_login_at,'') AS lastLoginAt
    FROM allowed_users au
    LEFT JOIN users u ON lower(u.email) = lower(au.email)
    WHERE COALESCE(au.deleted_at,'')=''
    ORDER BY au.email
  `).all().filter(row => !conSede.has(Number(row.id))).map(row => ({
    id: Number(row.id),
    email: row.email,
    nombre: row.nombre || '',
    siteRole: row.defaultRole || 'Consulta',
    turno: 'Sin turno',
    status: row.status || (row.activo ? 'Activo' : 'Inactivo'),
    activo: Boolean(row.activo),
    lastLoginAt: row.lastLoginAt,
    esSuperadmin: row.defaultRole === 'Superadmin'
  }));

  res.json({
    ok: true,
    tenants,
    sinSede: huerfanos,
    totales: {
      usuarios: new Set([...accesos.map(row => Number(row.id)), ...huerfanos.map(row => row.id)]).size,
      pendientes: tenants.reduce((acc, tenant) => acc + tenant.pendientes, 0) + huerfanos.filter(row => row.status === 'Pendiente').length,
      tenants: tenants.length
    }
  });
});
