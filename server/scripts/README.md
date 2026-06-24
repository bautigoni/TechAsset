# Setup scripts

## `send-release-broadcast.js`

Dispara el broadcast de un release a todos los usuarios activos. Inserta la fila en `release_notes` (idempotente por `version`) y manda mail + notificación in-app a cada uno.

### Uso

```bash
# 1) Dry-run primero (no inserta ni envía nada, solo loguea):
npm run release:broadcast:dry -- --version=v1.4.0 --title="TechAsset v1.4.0" --file=./release-notes-v1.4.0.md

# 2) Si el dry-run se ve bien, mandar el real:
npm run release:broadcast -- --version=v1.4.0 --title="TechAsset v1.4.0" --file=./release-notes-v1.4.0.md

# 3) Reenviar (por ejemplo, si el SMTP estaba caído la primera vez):
npm run release:broadcast -- --version=v1.4.0 --title="..." --file=...md --force
```

El `--file` acepta paths relativos al root del repo o absolutos. Soporta markdown con `## headings` y `- bullets` — la plantilla `buildReleaseBroadcastMail` los convierte a HTML card-style.

Si una versión ya tiene `sent_at`, el script aborta con exit code 3 salvo que pases `--force`. Esto previene envíos duplicados accidentales.

---

## Setup de Google OAuth (login con Google)

Para activar el botón "Continuar con Google" en la pantalla de login:

### 1. Crear credenciales en Google Cloud Console

1. Ir a https://console.cloud.google.com/.
2. Crear proyecto (o usar uno existente).
3. **APIs & Services → OAuth consent screen**:
   - Tipo: "External" (o "Internal" si es Google Workspace del colegio).
   - App name: `TechAsset`.
   - Scopes: `openid`, `email`, `profile`.
   - Test users: agregar `admin@northfield.local` y todos los mails de superadmin que quieran probar.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: "Web application".
   - Name: `TechAsset`.
   - Authorized JavaScript origins:
     - `https://techasset.bauhub.online`
     - `http://127.0.0.1:8000` (dev)
     - `http://127.0.0.1:5173` (vite dev)
   - Authorized redirect URIs:
     - `https://techasset.bauhub.online/api/auth/google/callback`
     - `http://127.0.0.1:8000/api/auth/google/callback` (dev)
5. Copiar `Client ID` y `Client Secret`.

### 2. Configurar `.env`

```bash
GOOGLE_CLIENT_ID=xxxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxxxx
GOOGLE_REDIRECT_URI=https://techasset.bauhub.online/api/auth/google/callback
# Vacío = cualquier Google account puede intentar.
# Si querés restringir por dominio del mail:
# GOOGLE_ALLOWED_DOMAINS=northfield.edu.ar,gmail.com
```

### 3. Verificar

- `GET /api/auth/google/config` debe devolver `{ enabled: true }`.
- El botón "Continuar con Google" aparece en `/login`.
- Login de prueba: abrir `/login`, tocar el botón, loguearse con un mail autorizado en `allowed_users`. Termina redirigiendo a `/sede/<site>/dashboard`.

### Troubleshooting

| Problema | Causa probable | Fix |
|---|---|---|
| `redirect_uri_mismatch` | El redirect URI del backend no matchea exactamente con Google Console. | Copiar `GOOGLE_REDIRECT_URI` literal a "Authorized redirect URIs". |
| `invalid_client` | Client ID o Secret mal copiados / con espacios. | Verificar que no haya newline al final. |
| El botón no aparece | Backend devuelve `enabled: false`. | Revisar que `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET` estén no-vacíos. |
| Login funciona pero `error=not_authorized` | Mail no está en `allowed_users`. | Agregar al usuario desde Configuración → Usuarios permitidos. |
| `error=google_verify_failed` | El id_token no es para esta app (`aud` mismatch) o email_verified=false. | Revisar GOOGLE_CLIENT_ID y que la pantalla de consent diga "verified". |

---

## Setup de VAPID (notificaciones push reales)

Sin VAPID, las push no funcionan: el sistema cae gracefully a in-app + mail. Para habilitar push real:

```bash
npm install web-push
npx web-push generate-vapid-keys
```

Eso imprime algo como:

```
======================================
Public Key:
BPlv...resto...
Private Key:
abcd...resto...
======================================
```

Copiar a `.env`:

```bash
VAPID_PUBLIC_KEY=BPlv...
VAPID_PRIVATE_KEY=abcd...
VAPID_SUBJECT=mailto:techassetbot@gmail.com
```

`VAPID_SUBJECT` puede ser `mailto:tu@email` o `https://tu-dominio`. Es solo un identificador de contacto que Google/Firefox validan, no se usa para mandar mails.

Reiniciar el server. El frontend ya está cableado para pedir permiso y suscribir (`useNotifications` + `NotificationBell`) — no hace falta tocar código.

### Verificar

- DevTools → Application → Service Workers → debe aparecer `/sw.js` con state "activated".
- DevTools → Application → Push Messaging → la subscription debería estar después de tocar "Permitir notificaciones".
- Disparar `notifySiteAdmins` (cargar un ticket nuevo desde otra cuenta) y debería llegar push al dispositivo subscripto.