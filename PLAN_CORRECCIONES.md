# Plan: correcciones TechAsset + features nuevas

> Documento de planificación.  
> Estado base: commit `72cbc3f "part excecute of the plan correcciones"` (Fases A–F commiteadas).  
> Slices 7, 8, 9 y 10 también completos en el árbol de trabajo local.  
> Generado a partir de las correcciones pedidas en `TECHASSET.pdf` y de los commits recientes del proyecto.
>
> **Decisiones del Slice 7 (Google OAuth) confirmadas con el usuario**:
> - `GOOGLE_ALLOWED_DOMAINS=` (vacío, cualquier Google account puede intentar — el filtro de `allowed_users` sigue siendo el gatekeeper).
> - Mail del superadmin (tester en Google Cloud Console): `admin@northfield.local`.
> - Login con Google + login por mail, **ambos visibles** en la pantalla.

---

## Resumen ejecutivo

Ocho puntos del PDF (correcciones de UX/bugs) + un sistema de notificaciones nuevo (in-app + mail + broadcast de release) + Google OAuth en el login. Todo respetando multi-sede (`site_code`), `consultationMode`, la estética oscura actual y Postgres como fuente de verdad (el proyecto ya migró de SQLite a Postgres en el commit `72cbc3f`).

### Estado de los slices

| Slice | Descripción | Estado |
|---|---|---|
| Fases A–F | Tickets, analítica bento, tareas flexible, settings toggles, PWA, notificaciones | ✅ Commiteadas en `72cbc3f` |
| Slice 7 | Google OAuth backend (servicio + rutas + config + mount + build limpio) | ✅ Completo en árbol local |
| Slice 8 | Google OAuth frontend (sacar `disabled`, handler, `?error=`, ocultar si no configurado) | ✅ Completo en árbol local |
| Slice 9 | Polish + script broadcast + endpoint admin + release notes v1.4.0 | ✅ Completo en árbol local |
| Slice 10 | Cleanup: `CLAUDE.md` actualizado a Postgres + Google + PWA + notificaciones | ✅ Completo en árbol local |

**Todo el código está listo**. Lo único pendiente es **deploy / configuración**:

1. Configurar Google Cloud Console con las vars del `.env`.
2. (Opcional) Generar VAPID keys para push real.
3. Mandar el primer broadcast de release `v1.4.0` desde consola.

---

## Archivos del PR final (post-Slice 7)

### Backend nuevos (este PR)

- `server/services/googleOAuth.service.js` — `isEnabled`, `generateState`, `buildAuthUrl`, `exchangeCode`, `verifyIdToken` (vía `oauth2.googleapis.com/tokeninfo`).
- `server/routes/googleAuth.routes.js` — `/api/auth/google/config`, `/login`, `/callback`. CSRF con cookie `state`, validación `aud`/`email_verified`/dominio, auditoría en `local_movements`.
- `server/scripts/send-release-broadcast.js` — script CLI para disparar broadcasts sin pasar por HTTP.

### Frontend modificados (este PR)

- `src/services/authApi.ts` — `getGoogleOAuthConfig()`.
- `src/components/auth/LoginPage.tsx` — botón Google cableado, oculta si no configurado, lee `?error=<slug>`.

### Docs

- `server/scripts/README.md` — setup de Google OAuth + VAPID, troubleshooting, ejemplos CLI.
- `release-notes-v1.4.0.md` — release notes listas para mandar.
- `CLAUDE.md` — sección Arquitectura actualizada a Postgres, secciones nuevas "Login con Google" y "PWA + notificaciones push".
- `package.json` — scripts `release:broadcast` y `release:broadcast:dry`.
- `.env.example` — vars `GOOGLE_*` documentadas.

---

## Lista de TODOs (deploy / operación)

### K. Configurar Google Cloud Console

- [ ] **K1.** Ir a https://console.cloud.google.com/ y crear credenciales OAuth 2.0 Client ID (tipo Web application).
  - Authorized JavaScript origins: `https://techasset.bauhub.online`, `http://127.0.0.1:8000`, `http://127.0.0.1:5173`.
  - Authorized redirect URIs: `https://techasset.bauhub.online/api/auth/google/callback`, `http://127.0.0.1:8000/api/auth/google/callback`.
- [ ] **K2.** Pantalla de consentimiento OAuth: tipo External, scopes `openid email profile`, agregar `admin@northfield.local` como tester.
- [ ] **K3.** Copiar Client ID y Client Secret a `.env` del deploy (producción):
  ```
  GOOGLE_CLIENT_ID=xxxxx.apps.googleusercontent.com
  GOOGLE_CLIENT_SECRET=GOCSPX-xxxxx
  GOOGLE_REDIRECT_URI=https://techasset.bauhub.online/api/auth/google/callback
  ```
- [ ] **K4.** Reiniciar el server. Verificar `GET /api/auth/google/config` → `{ enabled: true }`.
- [ ] **K5.** Smoke test: loguearse con `admin@northfield.local` vía Google en `https://techasset.bauhub.online/login`.

### L. (Opcional) Configurar VAPID para push real

- [ ] **L1.** `npm install web-push && npx web-push generate-vapid-keys`.
- [ ] **L2.** Copiar `VAPID_PUBLIC_KEY` y `VAPID_PRIVATE_KEY` al `.env` del deploy.
- [ ] **L3.** Verificar en mobile: tocar "Permitir notificaciones" → DevTools → Application → Push Messaging → subscription creada.
- [ ] **L4.** Disparar una notificación de prueba cargando un ticket desde otra cuenta.

### M. Mandar el primer broadcast `v1.4.0`

- [ ] **M1.** Probar con `MODO_PRUEBA=true` primero:
  ```bash
  npm run release:broadcast:dry -- --version=v1.4.0 --title="TechAsset v1.4.0: tickets, bento, PWA y Google" --file=./release-notes-v1.4.0.md
  ```
- [ ] **M2.** Validar que `recipients activos` sea > 0 y que el body parsea OK (sin headings rotos).
- [ ] **M3.** Pasar `MODO_PRUEBA=false` y mandar el real:
  ```bash
  npm run release:broadcast -- --version=v1.4.0 --title="..." --file=./release-notes-v1.4.0.md
  ```
- [ ] **M4.** Verificar que a cada usuario activo le llegó:
  - Mail (revisar logs SMTP / Resend).
  - Notificación in-app (campana arriba a la derecha).
  - Toast popup en la próxima sesión que abran.
- [ ] **M5.** Verificar el modal "Qué hay de nuevo" en el próximo login.

### N. Cleanup post-deploy

- [ ] **N1.** Confirmar que no quedan TODOs sin migrar a `release-notes-v1.4.0.md`.
- [ ] **N2.** Cerrar issues abiertas que referencien a estos TODOs (A1–H3.5, G1–G5, I1–I3, J1–J4) con links al PR.
- [ ] **N3.** Si hubo cambios al deploy (Caddy, docker-compose, Postgres), commitearlos y bumpear tag de release.

---

## Riesgos / cosas a vigilar

- **Google OAuth sin HTTPS** no funciona (excepto localhost). El deploy actual de `techasset.bauhub.online` ya está detrás de Caddy con HTTPS, OK.
- **VAPID keys**: si no están configuradas, las push fallan silenciosamente — el sistema ya está pensado para caer a in-app + mail sin romper el flujo.
- **Multi-sede**: el callback de Google respeta la sede activa via cookie. Si el usuario cambia de sede después, debe volver a loguearse.
- **Release broadcast**: una vez mandado, no se puede "desmandar". Probar primero con `MODO_PRUEBA=true` y `--dry-run`.
- **Tester en Google Cloud**: solo `admin@northfield.local` puede probar antes de "publicar" la app. Una vez publicada (verificación de Google), todos pueden.

---

## Próximos pasos

1. **Ahora**: el código está listo. Decime si querés que commitee todo este PR (Slices 7-10 + Google frontend) en un solo commit o en varios.
2. **Después**: configurar Google Cloud (K1–K5) — necesito que me pases el Client ID y Client Secret para validar el callback en local.
3. **Después**: mandar el primer broadcast (M1–M5) — con `MODO_PRUEBA=true` para validar antes de pegar el `false`.