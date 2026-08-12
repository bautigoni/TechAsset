# Plan: Resend en el alta de usuarios, vista de usuarios por tenant, y los 3 tenants Faro

Fecha: 2026-08-12 · Verificado contra `f49c643`
Formato: cada punto es **Problema → Por qué importa → Solución sugerida → Archivos → Cómo verificar**. Está escrito para que lo implemente alguien que no participó de la investigación.

---

## 0. Contexto mínimo para quien implemente

TechAsset es multi-tenant: todo dato operativo está particionado por `site_code` (hoy `NFPT`, `NFND`, `DEMO`). El alta de usuarios es **por invitación**: un administrador de sede genera un código de un solo uso, la persona lo canjea en `/register?code=…` y queda con rol y turno predefinidos.

**El flujo de invitaciones ya existe y funciona.** No hay que construirlo:

| Pieza | Dónde |
|---|---|
| Tabla `invites` (código, sede, rol, turno, vencimiento, un solo uso, revocación) | `server/db.js:519` |
| Crear / listar / revocar | `server/services/invites.service.js` |
| API + envío del mail | `server/routes/invites.routes.js:22-45` |
| Plantilla del mail | `server/services/mailTemplates.js:84` |
| Canje del código al registrarse | `server/routes/auth.routes.js:65-94` |
| Panel de invitaciones (por sede) | `src/components/settings/InvitesPanel.tsx` |
| Panel de tenants + "Código admin" | `src/components/settings/TenantsDashboard.tsx:97-110` |

**Resend está configurado en producción** desde el 12/08/2026: `RESEND_API_KEY` y `RESEND_FROM` en el `.env` de la VM, dominio `techasset.bauhub.online` verificado (DKIM y SPF verificados contra la API de Resend), servicio reiniciado y probado. `sendMail` (`server/services/mail.service.js:47`) prioriza Resend y deja SMTP de fallback.

**Dato que cambia decisiones: el SMTP de Gmail está muerto** (`535-5.7.8 BadCredentials` en `journalctl`). El "fallback" no existe. Si Resend falla, no sale ningún mail. Antes de configurar Resend, *ningún* mail de producción estaba saliendo.

**Cadena de delegación, verificada:** una invitación `kind: 'admin'` con rol `Administrador` produce un usuario que pasa `isSiteManager`, porque `Administrador` tiene `admin: true` en el `roles.config` sembrado por defecto (`server/db.js:1278`) y además está en `FALLBACK_MANAGER_ROLES` (`server/services/siteContext.service.js:102`). Es decir: **el admin de cada Faro puede invitar a su propio equipo sin pasar por el superadmin.** Todo el plan se apoya en esto.

---

## P1 — No hay una vista de usuarios por tenant para el superadmin

### Problema

El superadmin no tiene forma de responder "¿quién tiene acceso a Faro Escobar?". Lo que hay:

- `AllowedUsersPanel` (`src/components/settings/AllowedUsersPanel.tsx`) muestra una **lista plana** de usuarios con checkboxes de sedes. Con 3 sedes se lee; con 6 y varias decenas de usuarios, no.
- Está montado dentro de `SettingsPage`, que es **por sede activa**. Para mirar otro tenant hay que cambiar de sede.
- `TenantsDashboard` muestra los tenants pero **no dice cuánta gente hay en cada uno**.

La buena noticia: **los datos ya están del lado del servidor**. `GET /api/allowed-users` (`server/routes/sites.routes.js:118-137`) detecta superadmin y devuelve **todos** los usuarios no borrados, cada uno con su array `sites` completo vía `getAllowedUserSites(row.id)`. Falta la UI, no el endpoint.

### Por qué importa

Es la pantalla de control del onboarding. Con tres colegios nuevos entrando a la vez, el superadmin necesita ver de un vistazo quién fue invitado, quién se registró y quién quedó pendiente de aprobación, por tenant. Sin eso, el alta se audita a mano.

### Solución sugerida

Vista nueva **Usuarios** (o pestaña dentro de Tenants), solo superadmin, con dos niveles:

**Nivel 1 — resumen por tenant.** Una fila por tenant: nombre, código, cantidad de usuarios activos, pendientes de aprobación e invitaciones sin usar. Reusar el estilo de `tenant-card` que ya existe.

**Nivel 2 — detalle del tenant.** Al abrir uno: tabla con `mail`, `nombre`, `rol en esa sede`, `turno`, `estado` (`Pendiente | Activo | Rechazado | Inactivo`), `último login`, y acciones (aprobar, rechazar, desactivar, cambiar rol). Las acciones ya existen: `POST /api/allowed-users/:id/:action` (`sites.routes.js:236`).

**Del lado del servidor** conviene un endpoint dedicado en vez de agrupar en el cliente:

```
GET /api/admin/users-by-tenant     (solo superadmin)
→ { ok: true, tenants: [ { siteCode, nombre, activos, pendientes, invitacionesActivas,
                            users: [ { email, nombre, siteRole, turno, status, lastLoginAt } ] } ] }
```

Motivo: `getAllowedUserSites` se llama una vez por usuario (N+1). Con 3 tenants y 11 usuarios da igual; con 6 tenants y 100 usuarios no. Resolverlo con un solo JOIN sobre `allowed_users` + `allowed_user_sites` + `users` (para `last_login_at`, `server/db.js:77`).

Incluir en la misma vista el **estado de invitaciones** por tenant (`listInvites` ya devuelve `status: Activa | Usada | Vencida | Revocada`). "Invitado pero nunca se registró" es exactamente el caso que se pierde hoy.

### Archivos

- Nuevo: `server/routes/adminUsers.routes.js` (o extender `sites.routes.js`), registrar en `server/index.js`.
- Nuevo: `src/components/settings/UsersByTenantPage.tsx`.
- `src/App.tsx` — registrar la vista con `lazyView`, protegida por `superadmin` (mismo patrón que `TenantsDashboard`, `src/App.tsx:440`).
- `src/components/layout/Sidebar.tsx` — entrada de menú solo para superadmin.

### Cómo verificar

Como superadmin, la vista lista los 3 tenants con conteos correctos; al abrir NFPT aparecen sus usuarios con rol y último login. Como Administrador de un solo tenant, la vista no aparece en el menú y el endpoint devuelve 403.

---

## P2 — Los roles que ofrece el panel de usuarios no son los del tenant

### Problema

`AllowedUsersPanel.tsx:6-7` tiene los roles **hardcodeados**:

```js
const ADMIN_ROLES = ['Superadmin', 'Jefe TIC', 'Asistente TIC mañana', ...];
const SITE_ROLES  = ['Jefe TIC', 'Asistente TIC mañana', ...];
```

Pero un tenant nuevo se siembra con `roles.config = [Administrador, Asistente, Consulta]` (`server/db.js:1277-1281`), y `InvitesPanel` sí lee esa config del tenant (`InvitesPanel.tsx:23-30`).

Resultado: en los Faro, el panel de usuarios va a ofrecer "Jefe TIC" mientras el panel de invitaciones ofrece "Administrador". Los dos funcionan de casualidad porque ambos están en `FALLBACK_MANAGER_ROLES`, pero se pueden crear usuarios con roles que **no existen en el `roles.config` de su tenant**, y ahí los permisos caen al fallback por nombre en vez de a la config real.

### Por qué importa

Es la clase de inconsistencia que no rompe nada el primer día y confunde para siempre. Con tres tenants nuevos entrando ahora, es el momento de alinearlo.

### Solución sugerida

Que `AllowedUsersPanel` lea `roles.config` del tenant con `getSiteSettings()`, igual que `InvitesPanel`, y use la lista hardcodeada solo como fallback si el tenant no tiene config. Mantener `Superadmin` como opción aparte, solo si `canAssignSuperadmin`.

### Archivos

`src/components/settings/AllowedUsersPanel.tsx:6-20`.

---

## P3 — No queda registro de si el mail de invitación salió

### Problema

`POST /invites` devuelve `emailSent` (`invites.routes.js:37-44`) y el panel lo muestra en pantalla. Al recargar, se pierde. La tabla `invites` (`server/db.js:519-533`) no tiene ninguna columna de envío.

Si invitás a 15 personas y a tres no les llega, no hay forma de saber cuáles fallaron ni por qué. `sendMail` ya devuelve `{ sent, provider, messageId, error }` — la información existe y se tira.

### Por qué importa

Es el problema que más se va a sentir con tres colegios nuevos. "No me llegó" es la consulta número uno de cualquier onboarding, y hoy la respuesta es "no sé".

### Solución sugerida

Tres columnas en `invites`, con `ensureColumn` (idempotente, patrón del repo en `server/db.js`):

- `email_sent_at TEXT DEFAULT ''`
- `email_error TEXT DEFAULT ''`
- `email_message_id TEXT DEFAULT ''`

Guardarlas en `invites.routes.js` después del `await sendMail(...)`, exponerlas en `listInvites` (`invites.service.js:43`) y mostrar el estado en la fila del panel: `Enviado 12/08 14:30` / `Falló: <motivo>` / `Sin mail (link manual)`.

### Cómo verificar

Generar una invitación con mail válido → `email_sent_at` cargado. Generar una con un dominio inexistente → `email_error` con el motivo, visible en el panel.

---

## P4 — No se puede reenviar una invitación

### Problema

Si la persona borró el mail o cayó en spam, la única salida es generar un código nuevo. El anterior queda vivo hasta vencer, y la persona puede terminar con dos códigos distintos.

### Solución sugerida

`POST /api/invites/:id/resend`: valida que la invitación esté activa (no usada, no revocada, no vencida) con `findValidInvite`, reusa **el mismo código**, vuelve a mandar el mail con `buildInviteMail` y actualiza los campos de P3. Botón "Reenviar" en `InvitesPanel` sobre las filas con estado `Activa`. Aplicar el mismo rate limit de P5.

### Archivos

`server/routes/invites.routes.js`, `src/components/settings/InvitesPanel.tsx`.

---

## P5 — `POST /invites` no tiene rate limit

### Problema

Endpoint autenticado que dispara un mail a un destinatario arbitrario, sin límite. Una cuenta de administrador comprometida —o un bucle mal escrito en el frontend— puede mandar cientos de mails desde el dominio. Resend suspende cuentas por tasa de rebote alta, y perder el dominio deja a los cuatro tenants sin mail.

### Solución sugerida

Copiar el patrón que ya existe en `server/routes/assistant.routes.js:20` (ventana en memoria por usuario, responde 429 con mensaje claro). Sugerido: **20 invitaciones por hora por usuario**. Alcanza para cargar un colegio entero de a tandas y corta cualquier bucle.

---

## P6 — El toggle de modo prueba dejó de funcionar para las invitaciones

### Problema

En `server/services/mail.service.js`:

- Línea 42: chequea `config.smtp.modoPrueba` — **solo la variable de entorno**.
- Línea 47: si Resend está configurado, envía y **retorna**.
- Línea 55: recién ahí chequea el `modoPrueba` guardado en `app_settings` (el que edita la UI).

Como producción ahora tiene Resend, la rama de la línea 47 corre siempre y la línea 55 es inalcanzable. **El toggle de modo prueba de la interfaz ya no tiene efecto** sobre invitaciones, notificaciones ni mails de auth. Solo lo respeta la herramienta de credenciales 365, porque esa ruta chequea `getMailSettings().modoPrueba` por su cuenta antes de llamar a `sendMail` (`server/routes/tools.routes.js:530-534`).

### Por qué importa

Un admin que activa "modo prueba" para probar el circuito va a mandar mails reales creyendo que no. Es el peor tipo de bug: silencioso y en la dirección insegura.

### Solución sugerida

Resolver `modoPrueba` **una sola vez al principio de `sendMail`**, con la config de la base pisando al env (misma precedencia que ya usa `readMailSettings`), y recién después elegir proveedor. Es mover código, no agregarlo.

### Cómo verificar

Con Resend configurado y `MODO_PRUEBA=false` en el env, activar modo prueba desde la UI y generar una invitación: no debe salir mail y debe loguearse `[mail/MODO_PRUEBA]`.

---

## P7 — No hay señal en el panel de qué proveedor de mail está activo

### Problema

Un admin genera invitaciones sin saber si el mail va a salir. Si el proveedor está caído o mal configurado, se entera cuando la persona le avisa que no le llegó.

Ya existe `GET /api/tools/config` (`server/routes/tools.routes.js:590-602`) que devuelve `resendConfigurado`, `smtpConfigurado`, `mailConfigurado` y `modoPrueba` — sin exponer secretos. Hoy **solo lo consume el generador de credenciales 365** (`src/components/tools/Credentials365Tool.tsx:30`).

### Solución sugerida

Reusar ese endpoint en `InvitesPanel` y en la vista de P1. Un chip sobrio, sin iconos:

- `Mail: Resend` — todo bien.
- `Mail: SMTP` — degradado, avisar que Resend no está configurado.
- `Mail sin configurar` — las invitaciones solo van a servir por link copiado.
- Si `modoPrueba` está activo: cartel explícito **"Modo prueba activo: las invitaciones no se envían por mail, compartí el link"**.

Esto es lo que hace que Resend sea "accesible desde el panel": no un formulario de configuración nuevo, sino visibilidad del estado donde se toma la decisión.

---

## P8 — Falta DMARC

### Problema

DKIM y SPF están verificados (consultados contra la API de Resend: `resend._domainkey.techasset` TXT y `send.techasset` MX+TXT, todos `verified`). No hay registro DMARC.

Un dominio nuevo, sin DMARC, mandando mails que invitan gente con un código y un botón, es un perfil que Gmail y Outlook filtran con ganas.

### Solución sugerida

Donde estén los DNS de `bauhub.online`:

```
_dmarc.techasset.bauhub.online   TXT   "v=DMARC1; p=none; rua=mailto:gonibauti@gmail.com"
```

Arrancar en `p=none` (observa, no rechaza). Endurecer a `p=quarantine` cuando los reportes se vean limpios. No requiere tocar código.

---

## Operación: alta de los 3 tenants Faro

Confirmado: los códigos van así.

| Tenant | Código | Nombre | Subtítulo |
|---|---|---|---|
| Faro Puertos | `FRPT` | Faro Puertos | Sede Puertos |
| Faro Escobar | `FRES` | Faro Escobar | Sede Escobar |
| Faro Benavídez | `FRBN` | Faro Benavídez | Sede Benavídez |

El `site_code` queda **inmutable** después de crearse (`TenantsDashboard.tsx:220`) y forma parte de la identidad de dispositivo (`site_code + etiqueta`). Cambiarlo más adelante es una migración.

**Procedimiento** (superadmin, en producción):

1. Vista Tenants → "Crear tenant" por cada uno: código, nombre, subtítulo, color, logo opcional (PNG/JPG/WEBP, máx. 2 MB).
2. `POST /api/sites` corre `seedDefaultSettings` solo (`sites.routes.js:81`): roles, módulos, turnos quedan sembrados.
3. Cargar el mail del administrador en la tarjeta del tenant → botón **Código admin** → genera invitación `admin` a 30 días y la manda por Resend.
4. Esa persona se registra con el código y ya puede invitar a su equipo desde Configuración → Invitaciones.

**Falta un dato para ejecutar el paso 3: el mail del administrador de cada Faro.**

**Orden recomendado: primero P3 a P7, después crear los tenants.** Al revés, los primeros administradores —los que más importan— reciben invitaciones sin registro de envío y sin posibilidad de reenvío.

**Trampa:** el `.env` local apunta al **mismo Postgres de producción**. Crear un tenant "de prueba" en local escribe en la base real. La creación se hace una sola vez, deliberadamente, en la UI de producción.

---

## Deploy

Estos cambios tocan frontend, así que necesitan build completo.

1. `npm run build` local — obligatorio antes de cerrar cualquier cambio.
2. La VM no tiene credenciales de GitHub: `git bundle create /tmp/techasset.bundle <sha-en-la-vm>..main`, `scp` a `oracle:/tmp/`, `git remote set-url origin` al bundle. El propio `deploy.sh` imprime los comandos con el SHA correcto.
3. `ssh oracle` → `/opt/apps/techasset/deploy.sh`. Con 1 GB de RAM el build tarda 2-3 min; alternativa: buildear local y `deploy.sh --no-build`.
4. El `systemctl restart` **no es opcional**: Node no relee el disco.

**Estado actual de la VM: `897368f`.** Está varios commits atrás de `main` (`f49c643`). El próximo deploy va a arrastrar bastante más que estos cambios; conviene revisar el rango antes de subir.

**Smoke test:** crear una invitación real desde la UI a una casilla propia. Es la primera vez que se ejercita el camino `sendMail` → Resend **de la aplicación**; la prueba del 12/08 fue `curl` directo a la API de Resend, que valida key, salida a internet y dominio, pero no el código. Confirmar con `journalctl -u techasset | grep mail` que no aparecen warnings `[mail/resend]`.

---

## Anexo: desarrollar sin ensuciar producción

El `.env` local tiene hoy Postgres de producción + Resend funcionando + `MODO_PRUEBA=False`. Una prueba descuidada **manda mail real y escribe filas en la base real**. Para trabajar en esto:

- `DB_DRIVER=sqlite` (o sacar `DATABASE_URL`) para pegarle a `./data/techasset.db`.
- `MODO_PRUEBA=true` para que los envíos se registren en consola sin salir.
- Tenants de prueba en la base local, nunca `FRPT` / `FRES` / `FRBN` "para ver cómo queda".

---

## Resumen de prioridades

| # | Problema | Esfuerzo | Prioridad |
|---|---|---|---|
| P1 | Sin vista de usuarios por tenant | Alto | Alta (pedido explícito) |
| P3 | No queda registro del envío del mail | Bajo | Alta |
| P6 | Modo prueba no tiene efecto con Resend | Bajo | Alta (falla insegura) |
| P7 | Sin señal del proveedor en el panel | Bajo | Alta |
| P4 | No se puede reenviar una invitación | Bajo | Media |
| P5 | Sin rate limit en `POST /invites` | Bajo | Media |
| P2 | Roles hardcodeados vs `roles.config` | Bajo | Media |
| P8 | Falta DMARC | Nulo (DNS) | Media |

Fase 2, cuando crezca el volumen: `replyTo` con el mail de quien invita, invitaciones en lote, webhooks de Resend para rebotes y quejas de spam.
