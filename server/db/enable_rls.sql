-- Habilita Row Level Security (RLS) en TODAS las tablas del schema public.
--
-- Por qué: Supabase expone automáticamente cada tabla del schema `public` a
-- través de PostgREST (`https://<proj>.supabase.co/rest/v1/...`) usando la
-- anon key (que es pública por diseño). El linter marca `rls_disabled_in_public`
-- y `sensitive_columns_exposed` (tokens en `user_sessions` y
-- `agenda_calendar_tokens`) porque, sin RLS, cualquiera con la anon key puede
-- leer/escribir esas tablas saltándose por completo el backend Express.
--
-- Por qué NO rompe la app: el backend se conecta con un único `pg.Client`
-- usando DATABASE_URL, es decir el rol DUEÑO de las tablas (las creó este mismo
-- proceso con CREATE TABLE). RLS "normal" (sin FORCE) NO se aplica al dueño de
-- la tabla. Al habilitar RLS sin definir políticas:
--   * anon / authenticated (PostgREST) -> acceso DENEGADO (0 filas).
--   * el rol dueño (nuestro backend)   -> sigue funcionando igual.
--
-- Idempotente: ENABLE ROW LEVEL SECURITY se puede correr varias veces sin error.
-- Cubre también tablas futuras: recorre pg_tables, así que no hay que mantener
-- una lista a mano.

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', r.tablename);
  END LOOP;
END $$;

-- Verificación: lista tablas de public y si tienen RLS activo (rowsecurity = true).
-- SELECT tablename, rowsecurity
-- FROM pg_tables
-- WHERE schemaname = 'public'
-- ORDER BY rowsecurity, tablename;
