-- OWNER ONLY: run in the Frankfurt project's SQL Editor as postgres.
-- Prepared only; the agent has not connected or executed this SQL.
-- Operational ACL correction, NOT a migration or a migration-history repair.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $owner_acl208$
DECLARE
  v_old oid := to_regprocedure('public.get_operational_orders_page(integer,integer,text,text,text)');
  v_new oid := to_regprocedure('public.get_sales_history_page(integer,integer,text,date,date,text,text,text,text,boolean)');
  v_expected text[] := ARRAY['authenticated=X/postgres','postgres=X/postgres'];
  v_old_acl text[];
  v_new_acl text[];
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'OWNER_ACL208_POSTGRES_REQUIRED';
  END IF;
  IF NOT pg_try_advisory_xact_lock(734151139) THEN
    RAISE EXCEPTION 'OWNER_ACL208_UPGRADE_RUNNING';
  END IF;
  IF v_old IS NULL OR v_new IS NULL OR
     (SELECT count(*) FROM pg_proc WHERE oid IN (v_old,v_new)
       AND pg_get_userbyid(proowner) = 'postgres' AND prokind = 'f') <> 2 THEN
    RAISE EXCEPTION 'OWNER_ACL208_READER_IDENTITY_MISMATCH';
  END IF;
  SELECT array_agg(a.acl::text ORDER BY a.acl::text COLLATE "C") INTO v_old_acl
    FROM pg_proc p CROSS JOIN LATERAL unnest(p.proacl) AS a(acl) WHERE p.oid = v_old;
  SELECT array_agg(a.acl::text ORDER BY a.acl::text COLLATE "C") INTO v_new_acl
    FROM pg_proc p CROSS JOIN LATERAL unnest(p.proacl) AS a(acl) WHERE p.oid = v_new;
  IF v_new_acl IS DISTINCT FROM v_expected OR
     (v_old_acl IS DISTINCT FROM v_expected AND
      v_old_acl IS DISTINCT FROM (v_expected || ARRAY['service_role=X/postgres'])) THEN
    RAISE EXCEPTION 'OWNER_ACL208_UNEXPECTED_ACL';
  END IF;

  REVOKE EXECUTE ON FUNCTION public.get_operational_orders_page(integer,integer,text,text,text)
    FROM service_role RESTRICT;

  SELECT array_agg(a.acl::text ORDER BY a.acl::text COLLATE "C") INTO v_old_acl
    FROM pg_proc p CROSS JOIN LATERAL unnest(p.proacl) AS a(acl) WHERE p.oid = v_old;
  SELECT array_agg(a.acl::text ORDER BY a.acl::text COLLATE "C") INTO v_new_acl
    FROM pg_proc p CROSS JOIN LATERAL unnest(p.proacl) AS a(acl) WHERE p.oid = v_new;
  IF v_old_acl IS DISTINCT FROM v_expected OR v_new_acl IS DISTINCT FROM v_expected THEN
    RAISE EXCEPTION 'OWNER_ACL208_POSTCONDITION_FAILED';
  END IF;
END;
$owner_acl208$;
COMMIT;

-- Expected: both rows have exactly {authenticated=X/postgres,postgres=X/postgres}.
SELECT p.oid::regprocedure AS reader,
       ARRAY(SELECT a.acl::text FROM unnest(p.proacl) AS a(acl)
             ORDER BY a.acl::text COLLATE "C") AS acl
FROM pg_proc p
WHERE p.oid IN (
  'public.get_operational_orders_page(integer,integer,text,text,text)'::regprocedure,
  'public.get_sales_history_page(integer,integer,text,date,date,text,text,text,text,boolean)'::regprocedure
)
ORDER BY p.oid::regprocedure::text;
