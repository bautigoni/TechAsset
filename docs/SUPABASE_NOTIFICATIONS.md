# Notificaciones manuales desde Supabase

TechAsset procesa una bandeja PostgreSQL cada 10 segundos. No requiere Docker, rebuild ni reiniciar el servicio.

## Desde SQL Editor

Enviar a todos los usuarios de una sede:

```sql
select public.enqueue_techasset_notification(
  p_title => 'Mantenimiento programado',
  p_body => 'El sistema estará en mantenimiento a las 18:00.',
  p_site_code => 'NFPT',
  p_audience => 'site',
  p_kind => 'system',
  p_link => '/sede/nfpt/dashboard'
);
```

Enviar a un usuario:

```sql
select public.enqueue_techasset_notification(
  p_title => 'Equipo listo',
  p_body => 'Ya podés retirar el dispositivo.',
  p_site_code => 'NFPT',
  p_audience => 'user',
  p_user_email => 'usuario@dominio.com',
  p_kind => 'system',
  p_link => '/sede/nfpt/devices'
);
```

Enviar a todos los usuarios de todos los tenants:

```sql
select public.enqueue_techasset_notification(
  p_title => 'Novedad de TechAsset',
  p_body => 'Ya está disponible una nueva versión.',
  p_audience => 'all',
  p_kind => 'release',
  p_link => '/release-notes'
);
```

Programar el envío usa una fecha ISO en `p_due_at`, por ejemplo `2026-07-17T15:00:00.000Z`.

## Estado del envío

```sql
select id, title, audience, status, result_count, attempts, last_error, created_at, processed_at
from public.notification_outbox
order by id desc
limit 50;
```

Los estados son `pending`, `processing`, `sent` y `error`. El worker reintenta hasta cinco veces. Las preferencias de cada usuario siguen aplicándose a notificaciones, push y email.
