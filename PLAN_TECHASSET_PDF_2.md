# Plan TechAsset - PDF "techasseet 2"

Fuente: `PDF de especificación (local)`, repo local y snapshots de `https://techasset.bauhub.online`.

Snapshots generados:

- `.codex-snapshots/techasset-live-afterwait.png` - login desktop publicado.
- `.codex-snapshots/techasset-live-login-iphone390.png` - login publicado en viewport iPhone 390x844.
- `.codex-snapshots/pdf-assets/` - imagenes extraidas del PDF para referencia visual.

Nota sensible: el PDF muestra una API key de Resend. Tratarla como comprometida: rotarla antes de activar envios reales.

## Objetivo

Convertir TechAsset en una experiencia multi-tenant mas pulida: branding configurable por tenant, administracion de tenants clara, emails operativos con Resend, mejor mobile en iPhone, agenda redisenada y conexion con Google Calendar.

## Estado actual observado

- El login publicado carga bien despues de unos segundos, pero hay un estado inicial visible de "Cargando sesion...".
- El login usa la marca TA, que esta bien segun el PDF.
- Dentro de la app, `Topbar` y `Sidebar` usan `/favicon.png` fijo aunque la DB ya tiene `sites.logo`.
- `sites.logo` existe en DB y `SiteInfo.logo`, pero no esta cableado en UI ni hay upload de logo por tenant.
- Hay duplicacion entre `TenantsDashboard` y `SiteAdminPanel` dentro de Configuracion.
- Al crear tenant, el estado de `sites` del `Topbar` puede quedar viejo porque `TenantsDashboard` refresca su lista interna pero no necesariamente refresca la sesion/app shell.
- El selector de sede del `Topbar` es un `<select>` basico.
- Mail ya soporta Resend (`server/services/mail.service.js`) e invitaciones por mail (`server/routes/invites.routes.js`), pero falta cerrar notificaciones de registro nuevo a superadmin/admin del tenant.
- La agenda actual funciona, pero visualmente es una grilla de cards oscura y densa. La referencia del PDF pide un calendario mas institucional, claro, con vistas Mes/Semana/Agenda, chips y boton de sincronizacion.
- No existe todavia feed iCal/Google Calendar.

## Prioridades

P0:

- Rotar Resend key expuesta.
- Resolver tenant creado que no aparece en el selector superior.
- Arreglar safe-area/topbar en iPhone.

P1:

- Branding por tenant dentro de la app.
- Sacar duplicacion Tenants vs Configuracion.
- Emails de registro/invitacion con Resend.

P2:

- Redisenar Agenda TIC.
- Agregar export/sync con Google Calendar.
- QA responsive y deploy.

## Fase 0 - Seguridad y baseline

- [ ] Rotar la API key de Resend expuesta en el PDF.
- [ ] Actualizar `.env` de produccion con la nueva key:
  - `RESEND_API_KEY=...`
  - `RESEND_FROM=TechAsset <...>`
  - `APP_BASE_URL=https://techasset.bauhub.online`
  - `MODO_PRUEBA=false` solo cuando se valide.
- [ ] Verificar DNS de Resend desde el dashboard de Resend y dejar documentado el remitente final.
- [ ] Agregar/validar `.env.example` para Resend si falta algun valor operativo.
- [ ] Confirmar que `.env` no se commitea y que no hay secrets nuevos en docs o snapshots.
- [ ] Smoke test actual antes de tocar codigo:
  - `npm run build`
  - login local
  - crear tenant
  - enviar invitacion dry/test
  - abrir agenda desktop/mobile

Archivos probables:

- `.env.example`
- `server/config.js`
- `server/services/mail.service.js`
- `server/scripts/README.md`

Criterio de aceptacion:

- Resend queda funcionando sin exponer secrets.
- El repo no contiene la key nueva ni la vieja.

## Fase 1 - Branding configurable por tenant

Pedido PDF: "el logo del login que sea la TA pero dentro de la app sea configurable por tenant".

- [ ] Mantener login con marca TA/fav icon actual.
- [ ] Usar `activeSiteInfo.logo || /favicon.png` dentro de la app.
- [ ] Reemplazar logo fijo en:
  - `src/components/layout/Topbar.tsx`
  - `src/components/layout/Sidebar.tsx`
  - banners/componentes internos que usen marca de sede.
- [ ] Agregar edicion de logo en el modulo Tenants:
  - upload de imagen PNG/JPG/WebP/SVG.
  - preview antes de guardar.
  - boton "quitar logo".
  - fallback automatico al favicon/TA.
- [ ] Crear ruta backend para subir logo de tenant:
  - guardar en `data/uploads/site-logos/<siteCode>-<hash>.<ext>`.
  - servir por `/uploads/site-logos/...`.
  - validar tipo y tamano.
- [ ] Persistir URL en `sites.logo`.
- [ ] Si se usa URL externa en vez de upload, validar `https://` y bloquear `javascript:`, `data:` salvo data URL controlada por backend.
- [ ] Aplicar `themeColor` del tenant en detalles sutiles:
  - borde activo del selector.
  - ring del logo.
  - color de acento opcional, sin romper contraste.
- [ ] Revisar PWA:
  - login/app icon puede seguir siendo TA global.
  - no hacer manifest dinamico por tenant en esta fase salvo que sea necesario.

Archivos probables:

- `server/routes/sites.routes.js`
- `server/index.js`
- `src/components/settings/TenantsDashboard.tsx`
- `src/components/layout/Topbar.tsx`
- `src/components/layout/Sidebar.tsx`
- `src/services/authApi.ts`
- `src/types.ts`
- `src/styles/legacy.css` o CSS correspondiente.

Criterio de aceptacion:

- En login se ve TA.
- Dentro de una sede con logo propio se ve ese logo en sidebar/topbar.
- Si el tenant no tiene logo, se ve el favicon/TA.
- El logo se puede cambiar desde Tenants sin tocar codigo.

## Fase 2 - Tenants y selector de sede

Pedido PDF: "cuando creo un tenant no aparece ahi arriba a la derecha" y "la estetica del desplegable es fea".

- [ ] Al crear tenant en `TenantsDashboard`, refrescar la sesion/app shell:
  - opcion A: `TenantsDashboard` llama `onSitesChanged` despues de `saveSite`.
  - opcion B: `saveSite` devuelve item y `App` actualiza `sites`.
  - elegir A para menor riesgo porque ya existe `refreshSessionSites`.
- [ ] Pasar `onSitesChanged={refreshSessionSites}` a `TenantsDashboard` desde `App.tsx`.
- [ ] Si el tenant creado debe quedar seleccionable inmediatamente, asegurarse de que `POST /api/sites` agrega `user_sites` del superadmin actual y que `GET /auth/session` lo devuelve.
- [ ] Reemplazar `<select className="operator-chip">` del `Topbar` por un menu custom:
  - muestra logo/color, codigo y nombre.
  - lista sedes activas.
  - marca sede actual.
  - boton compacto en mobile.
  - cierre por Escape/click afuera.
- [ ] Mantener accesibilidad:
  - `aria-expanded`
  - navegacion con teclado basica.
  - labels claros.
- [ ] Confirmar que usuarios no-superadmin ven solo chip no editable.

Archivos probables:

- `src/App.tsx`
- `src/components/layout/Topbar.tsx`
- `src/components/settings/TenantsDashboard.tsx`
- `server/routes/sites.routes.js`
- `server/services/siteContext.service.js`

Criterio de aceptacion:

- Crear tenant y verlo enseguida en el selector superior sin logout.
- Selector se ve como componente TechAsset, no como select nativo.
- En mobile no tapa la topbar ni rompe ancho.

## Fase 3 - Quitar duplicacion Configuracion vs Tenants

Pedido PDF: dejar el modulo Tenants y sacar lo duplicado de Configuracion.

- [ ] Mover administracion de sedes completa a `TenantsDashboard`.
- [ ] Retirar `SiteAdminPanel` de `SettingsPage` para admins/superadmins.
- [ ] Mantener en Configuracion solo lo que no es tenant CRUD:
  - modo consulta
  - turnos TIC
  - notificaciones
  - modulos
  - roles
  - invitaciones
  - prestamos
  - usuarios permitidos
  - diagnostico avanzado
- [ ] Evaluar si "Configuracion" debe ocultarse para Superadmin cuando solo quiere Tenants. Recomendacion: no eliminar todo el modulo todavia porque contiene usuarios, roles y notificaciones.
- [ ] Dentro de Tenants, agregar editar:
  - nombre
  - subtitulo
  - color
  - logo
  - estado activo/inactivo
  - CSV importacion
  - inventory sheet name
  - generar codigo admin
- [ ] Mejorar tabla/listado de Tenants:
  - cards o tabla pulida con logo/color.
  - busqueda por codigo/nombre.
  - estados Activo/Inactivo.
  - accion "Entrar".
  - accion "Editar".
  - accion "Codigo admin".
- [ ] Evitar nested cards excesivas y mantener consistencia con el dashboard actual.

Archivos probables:

- `src/components/settings/SettingsPage.tsx`
- `src/components/settings/SiteAdminPanel.tsx`
- `src/components/settings/TenantsDashboard.tsx`
- `src/components/layout/Sidebar.tsx`

Criterio de aceptacion:

- No aparece "Administrar sedes" duplicado en Configuracion.
- Todo lo relacionado a tenants vive en Tenants.
- Configuracion sigue sirviendo para usuarios/roles/notificaciones.

## Fase 4 - Resend, registros e invitaciones

Pedido PDF: Resend verificado, enviar mail cuando se registra un nuevo usuario al superadmin y admin del tenant, y enviar invitaciones desde admin a empleados.

- [ ] No usar la key hardcodeada del PDF. Solo env vars.
- [ ] Validar que `server/services/mail.service.js` prefiera Resend cuando:
  - `RESEND_API_KEY` existe.
  - `RESEND_FROM` existe.
  - `MODO_PRUEBA=false`.
- [ ] Agregar endpoint o accion de "enviar mail de prueba" para admin/superadmin si no existe en UI.
- [ ] Cablear notificacion de registro nuevo en `POST /api/auth/register`:
  - mail al superadmin global.
  - mail a jefes/admins del tenant de la invitacion.
  - mail de confirmacion al usuario si aplica.
- [ ] Reusar templates existentes:
  - `buildRegistrationAdminMail`
  - `buildRegistrationUserMail`
  - `buildInviteMail`
- [ ] Crear helper `notifyRegistration({ user, invite, siteCode })`.
- [ ] Resolver destinatarios:
  - `SUPERADMIN_EMAILS` desde env.
  - admins/jefes del tenant desde `allowed_users + allowed_user_sites`.
  - evitar duplicados.
- [ ] Mejorar `InvitesPanel`:
  - campo email visible.
  - selector rol/turno.
  - estado "mail enviado/no enviado".
  - copiar link.
  - reenviar invitacion si esta activa.
  - historial de invitaciones.
- [ ] Para invitaciones admin generadas desde Tenants:
  - permitir email opcional.
  - si hay email, enviar automaticamente.
  - si no hay email, mostrar link y copiar.
- [ ] Logging no bloqueante: si Resend falla, la creacion de usuario/invitacion no debe romperse, pero debe mostrar aviso.

Archivos probables:

- `server/routes/auth.routes.js`
- `server/routes/invites.routes.js`
- `server/services/mail.service.js`
- `server/services/mailTemplates.js`
- `server/config.js`
- `src/components/settings/InvitesPanel.tsx`
- `src/components/settings/TenantsDashboard.tsx`
- `src/components/tools/MailSettings.tsx`

Criterio de aceptacion:

- Registro nuevo dispara aviso a superadmin y admin del tenant.
- Invitacion con email manda correo con link.
- Invitacion sin email permite copiar link.
- En `MODO_PRUEBA=true` no envia pero loguea claramente.

## Fase 5 - Mobile/iPhone safe-area

Pedido PDF: en celular la parte de arriba no se ve en algunos iPhones, bajar un poco.

- [ ] Auditar safe-area en:
  - `.topbar`
  - `.main`
  - `.app-shell`
  - `.mobile-menu-btn`
  - `.sidebar.mobile-open`
  - modales.
- [ ] Agregar variables CSS:
  - `--safe-top: env(safe-area-inset-top, 0px)`
  - `--safe-bottom: env(safe-area-inset-bottom, 0px)`
- [ ] En mobile, sumar `padding-top: calc(var(--safe-top) + Xpx)` a la topbar o contenedor principal.
- [ ] Usar `100dvh` con fallback y evitar `100vh` donde corte en iOS.
- [ ] Revisar que el login mobile no quede demasiado bajo.
- [ ] Revisar PWA instalada en iPhone:
  - standalone mode.
  - notch/dynamic island.
  - scroll inicial.
- [ ] Mantener target tactil minimo 44px.

Archivos probables:

- `src/styles/responsive.css`
- `src/styles/legacy.css`
- `src/styles/layout.css`
- `src/styles/auth.css`
- `public/manifest.webmanifest`

Criterio de aceptacion:

- En viewport iPhone 390x844 la topbar no queda cortada.
- En iPhone instalado como PWA no hay contenido bajo notch/dynamic island.
- No se rompe desktop.

## Fase 6 - Favicon/icono

Pedido PDF: "aca podes poner el favicon que es mas lindo".

- [ ] Confirmar que `/favicon.png` es el icono deseado.
- [ ] Usar favicon como fallback visual global:
  - login TA actual.
  - app fallback si tenant no tiene logo.
  - InstallBanner si aplica.
- [ ] Revisar `public/manifest.webmanifest`:
  - iconos `192x192`, `512x512`, `maskable`.
  - si `techasset-logo.svg` no coincide con el favicon deseado, reemplazar o agregar PNGs correctos.
- [ ] Revisar `index.html`:
  - `<link rel="icon" ...>`
  - Apple touch icon si falta.

Archivos probables:

- `public/favicon.png`
- `public/techasset-logo.svg`
- `public/manifest.webmanifest`
- `index.html`
- `src/components/common/InstallBanner.tsx`

Criterio de aceptacion:

- Icono correcto en browser tab, PWA install y fallback app.
- Login mantiene identidad TA.

## Fase 7 - Redisenar Agenda TIC

Pedido PDF: calendario actual "horrible", copiar estetica de referencia.

Referencia visual extraida:

- Header claro/institucional, vista Mes/Semana/Agenda.
- Chips de filtros.
- Calendario mensual limpio.
- Vista semanal horizontal.
- Empty states suaves.
- Boton "Nuevo evento".
- Boton/icono de sincronizacion.

Propuesta TechAsset:

- Mantener modo oscuro global de TechAsset, pero redisenar estructura y densidad.
- Agregar layout de agenda con 3 modos:
  - Dia/Hoy: foco operativo TIC.
  - Semana: columnas por dia o timeline horizontal.
  - Mes: calendario mensual con puntos/contadores.
- Mantener "Historial" como vista secundaria o filtro.

Todos funcionales:

- [ ] Crear estructura de `AgendaPage` por vistas:
  - `today`
  - `week`
  - `month`
  - `history`
- [ ] Reemplazar selector actual `Hoy/Lun/Mar...` por:
  - navegacion por fecha.
  - boton Hoy.
  - rango semanal visible.
- [ ] Agregar mini calendario mensual:
  - dia seleccionado.
  - cantidad de eventos por dia.
  - marcas por tipo.
- [ ] Agregar filtros por:
  - turno
  - tipo dispositivo
  - estado
  - curso/ubicacion
  - vencidas/conflictos.
- [ ] Mantener acciones actuales:
  - marcar entregado
  - nota
  - cancelar
  - crear tarea relacionada
  - borrar actividad.
- [ ] Mejorar `AgendaCard`:
  - jerarquia compacta.
  - hora/curso arriba.
  - estado visible.
  - acciones agrupadas.
  - menos botones gigantes repetidos.
- [ ] Mejorar empty states.
- [ ] Mantener export CSV y copiar resumen.
- [ ] Revisar conflictos de capacidad visualmente.

Archivos probables:

- `src/components/agenda/AgendaPage.tsx`
- `src/components/agenda/AgendaCard.tsx`
- `src/components/agenda/AgendaKpis.tsx`
- `src/components/agenda/AgendaModal.tsx`
- `src/services/agendaApi.ts`
- `server/routes/agenda.routes.js`
- CSS en `src/styles/*`.

Criterio de aceptacion:

- La agenda se ve ordenada y moderna en desktop.
- En mobile no obliga a scrollear horizontalmente para operar.
- Las acciones operativas siguen funcionando.
- No se pierde ninguna data existente.

## Fase 8 - Google Calendar / calendario externo

Pedido PDF: conexion con Google Calendar.

Recomendacion: empezar con feed iCal por sede/usuario y boton "Abrir en Google Calendar". Es mas simple y robusto que pedir permisos OAuth de Calendar para escribir eventos.

Alcance version 1:

- [ ] Crear feed ICS por usuario/sede:
  - URL con token secreto.
  - incluye eventos visibles para el usuario.
  - respeta `site_code`.
  - no expone datos de otros tenants.
- [ ] Endpoint:
  - `GET /api/agenda/calendar-feed`
  - devuelve o rota token.
  - `GET /calendar/:token.ics`
  - publico por token, sin cookie.
- [ ] Boton en Agenda:
  - "Sincronizar calendario".
  - modal con instrucciones.
  - copiar link.
  - abrir Google Calendar con URL prellenada si es posible.
  - tabs Google/Outlook/Apple.
- [ ] Eventos ICS:
  - `UID`
  - `DTSTART`
  - `DTEND`
  - `SUMMARY`
  - `DESCRIPTION`
  - `LOCATION`
  - `STATUS`
  - timezone correcta.
- [ ] Token management:
  - guardar token hash o token en tabla dedicada.
  - permitir regenerar link.
  - revocar link.
- [ ] Seguridad:
  - feed solo lectura.
  - token largo random.
  - sin emails/secrets innecesarios en descripcion.

Alcance version 2 opcional:

- [ ] OAuth Google Calendar con scope `calendar.events`.
- [ ] Permitir "enviar a mi calendario" como eventos creados en cuenta del usuario.
- [ ] Manejar refresh tokens.
- [ ] Resolver duplicados/update/delete.

Archivos probables:

- `server/db.js`
- `server/routes/agenda.routes.js` o nueva `server/routes/calendar.routes.js`
- `server/index.js`
- `src/services/agendaApi.ts`
- `src/components/agenda/AgendaPage.tsx`
- `src/components/layout/Modal.tsx`
- `server/services/googleOAuth.service.js` solo si se hace version 2.

Criterio de aceptacion:

- Desde Agenda se genera/copiar link ICS.
- Google Calendar permite suscribirse al link.
- Al modificar una actividad en TechAsset, el feed refleja cambios.
- Un token de NFPT no muestra NFND.

## Fase 9 - QA, build y deploy

- [ ] `npm run build`.
- [ ] Smoke local con usuario superadmin:
  - login.
  - crear tenant.
  - cambiar logo.
  - cambiar tenant desde topbar.
  - crear invitacion con email en modo prueba.
  - registrarse con invitacion.
  - revisar mails/logs.
  - agenda dia/semana/mes.
  - generar feed calendario.
- [ ] Visual QA con browser:
  - desktop 1280x720.
  - desktop ancho 1440+.
  - iPhone 390x844.
  - mobile instalado/PWA si se puede.
- [ ] Verificar no-regresiones:
  - multi-sede.
  - permisos `consultationMode`.
  - roles admin/superadmin.
  - usuarios no admin.
  - upload size/tipo.
  - CSV importacion.
- [ ] Deploy:
  - set env vars.
  - restart server.
  - smoke en `https://techasset.bauhub.online`.
  - probar Resend real con destinatario controlado.
  - probar feed Calendar.

## Orden recomendado de implementacion

1. Fase 0 - seguridad Resend y baseline.
2. Fase 2 - tenant creado aparece + selector lindo.
3. Fase 3 - quitar duplicacion de Configuracion.
4. Fase 1 - logo por tenant.
5. Fase 4 - mails registro/invitaciones.
6. Fase 5 y 6 - mobile safe-area + favicon/PWA.
7. Fase 7 - redisenar Agenda TIC.
8. Fase 8 - Google Calendar via ICS.
9. Fase 9 - QA/deploy.

## Riesgos

- Resend key expuesta: no activar produccion hasta rotar.
- Configuracion contiene cosas utiles, no conviene eliminar todo el modulo sin confirmar alcance.
- Google Calendar con OAuth completo aumenta mucho complejidad. ICS feed cubre el caso de "ver agenda en Google Calendar" con menor riesgo.
- Upload de logos debe validar archivos para no abrir superficie innecesaria.
- El repo tiene algunos textos con posible mojibake en lecturas de terminal. Confirmar visualmente en browser antes de tocar masivo.

## Pendientes de decision

- Dominio/remitente exacto para Resend (`RESEND_FROM`).
- Si Configuracion debe ocultarse completa para Superadmin o solo sacar "Administrar sedes".
- Si el logo por tenant debe ser upload local, URL externa o ambas. Recomendado: upload local.
- Si Google Calendar necesita escritura real en calendarios personales o alcanza suscripcion ICS. Recomendado: ICS primero.
