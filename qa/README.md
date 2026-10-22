# Entorno de QA aislado (5 usuarios nuevos)

Para el QA de lanzamiento de `docs/redesign/DIRECTIVA-FINAL.md`: server real sobre una
**copia** de `data/techasset.db` con una sede nueva `QA` ("Sede de prueba"). Nunca toca la
base real, producción ni Postgres; no usa los puertos 5173 ni 8000. Todo lo generado vive
en `qa/.out/` (gitignoreado).

## 1. Sembrar (una vez)

```bash
node qa/seed-qa-tenant.mjs              # → qa/.out/qa-seed.db + qa/.out/credenciales.json
node qa/seed-qa-tenant.mjs --fresh      # empezar de cero (vuelve a copiar la base real, solo lectura)
```

Idempotente: correrlo de nuevo sobre la misma salida no duplica nada. Siembra por la API
real (server levantado un momento en un puerto libre): sede `QA` con todos los módulos
(incluidos conocimiento, recordatorios y canvas) y roles, admin Jefe TIC (invitación +
registro real), 40 equipos D5001–D5040 (Touch 1–16, Plani 1–8, Dell 1–8, Tablet 1–6,
TIC 1–2; 7 prestados, uno en reparación y otro fuera de servicio), agenda de la semana
(y de hoy), tareas, tickets, notas, recordatorios, 2 artículos y **10 códigos de
invitación** (impaciente, esceptico, movil, nonativo, destructor y repuesto1–5) con el rol
`Asistente TIC general`, válidos 90 días. Estado aulas queda vacío: la sede QA no tiene plano.

## 2. Una instancia por persona

```bash
node qa/serve-qa.mjs --name=impaciente --port=8711 [--fresh]
node qa/serve-qa.mjs --name=esceptico  --port=8712
node qa/serve-qa.mjs --name=movil      --port=8713
node qa/serve-qa.mjs --name=nonativo   --port=8714
node qa/serve-qa.mjs --name=destructor --port=8715
```

Queda corriendo en primer plano (correrlo en segundo plano si hace falta). Sirve el build
de producción (`dist/`, se rebuildea solo si quedó viejo; `--build` lo fuerza) en
`http://127.0.0.1:<port>/`. Cada `--name` usa su propia copia de la base en
`qa/.out/<name>/techasset.db`: los códigos se gastan solo ahí. `--fresh` vuelve a la base
sembrada (para la segunda vuelta de los 5 usuarios). Entorno del server: SQLite,
`MODO_PRUEBA=true`, `NODE_ENV=test`, mails capturados en `qa/.out/<name>/mails.log`,
adjuntos en un temporal del sistema, sin `DATABASE_URL`, sin IA (las claves van vacías,
no borradas, para que dotenv no las vuelva a leer del `.env`), sin Google, push ni Sentry.

- Registro: `http://127.0.0.1:<port>/register?code=<código>` o desde la landing con
  "Tengo un código". Códigos y mails sugeridos: `qa/.out/credenciales.json`.
- **Aprobación: no hace falta.** El registro con código deja la cuenta **activa** directo
  (rol de la invitación en la sede QA); se entra enseguida con el mail y la contraseña.
- Admin QA (Jefe TIC): `jefa.qa@qa.test`, contraseña en `credenciales.json`.
- Mails que "salieron" (aviso al admin, "olvidé mi contraseña" con su link):
  `node qa/mails.mjs --name=<persona> [--to=<mail>] [--last=3]`.
- Límites reales del login: 8 intentos fallidos por mail+IP en 15 min (se reinicia al
  reiniciar la instancia).

## 3. Probar el entorno

```bash
node qa/smoke-qa.mjs --name=<persona> [--persona=repuesto2] [--headful]
```

Chrome real: landing → "Tengo un código" → registro (gasta un código de repuesto en esa
copia) → Ingresar → Préstamos → prestar y devolver "Touch 7". Capturas en
`qa/.out/<name>/smoke/`.

## 4. Bajar

```bash
node qa/stop-qa.mjs --name=impaciente      # o Ctrl C en su consola
node qa/stop-qa.mjs --all [--purge]        # todas; --purge borra sus carpetas
```
