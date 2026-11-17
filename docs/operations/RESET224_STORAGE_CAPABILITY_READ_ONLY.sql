-- للمالك: شغّل الملف كما هو في SQL Editor بدور التنفيذ postgres، ثم أرسل النتيجة.
-- قراءة فقط: لا BEGIN/ROLLBACK كي تبقى النتيجة ظاهرة، ولا كتابة أو تجربة DDL.
-- actor/session_actor: يجب أن يطابقا دور أمر RESET؛ فحص دور آخر لا يكفي.
-- storage_owner/role_memberships: يوضحان الملكية والعضويات دون أي كلمات سر.
-- settings: أسماء محددة فقط؛ وجود policy_grants في pg_settings يعني أن المكتبة حمّلته.
-- policy_configuration_allows: true شرط لازم قبل RESET، وليس شهادة نجاح RESET كله.
-- عند false أو NULL أو غياب الجدول/المكتبة: توقف ولا تمنح صلاحيات؛ راجع السبب أولاً.
WITH actor AS (
  SELECT oid, rolname, rolsuper FROM pg_roles WHERE rolname = current_user
), target AS (
  SELECT oid, relowner FROM pg_class WHERE oid = to_regclass('storage.objects')
), settings AS (
  SELECT name, setting FROM pg_settings WHERE name IN (
    'session_preload_libraries', 'shared_preload_libraries',
    'supautils.version', 'supautils.policy_grants',
    'supautils.privileged_role', 'supautils.superuser'
  )
), permission AS (
  SELECT a.rolsuper OR pg_has_role(a.oid, t.relowner, 'USAGE') OR (
    EXISTS (SELECT 1 FROM settings WHERE name = 'supautils.policy_grants')
    AND coalesce((SELECT setting::jsonb -> a.rolname
      FROM settings WHERE name = 'supautils.policy_grants'), '[]'::jsonb) ? 'storage.objects'
    AND EXISTS (SELECT 1 FROM pg_roles r WHERE r.rolsuper AND r.rolname = (
      SELECT setting FROM settings WHERE name = 'supautils.superuser'))
  ) AS allowed FROM actor a CROSS JOIN target t
)
SELECT jsonb_build_object(
  'actor', current_user, 'session_actor', session_user,
  'server_version', current_setting('server_version'),
  'actor_superuser', (SELECT rolsuper FROM actor),
  'storage_owner', (SELECT pg_get_userbyid(relowner) FROM target),
  'role_memberships', (SELECT coalesce(jsonb_agg(jsonb_build_object(
    'role', r.rolname, 'inherit', m.inherit_option, 'set', m.set_option)
    ORDER BY r.rolname), '[]'::jsonb) FROM pg_auth_members m
    JOIN pg_roles r ON r.oid = m.roleid WHERE m.member = (SELECT oid FROM actor)),
  'settings', (SELECT jsonb_object_agg(name, setting ORDER BY name) FROM settings),
  'policy_configuration_allows', (SELECT allowed FROM permission)
) AS storage_capability_read_only;
