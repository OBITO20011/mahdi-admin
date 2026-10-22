-- OWNER ONLY: SQL Editor of Frankfurt kzevmysfydaslxcerogt, role postgres.
-- Prepared only: no connection or SQL execution performed by the agent.
-- Three legacy-reader ACL corrections only; no migration/history/body/data edits.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $owner_acl208$
DECLARE
  v_old regprocedure[] := ARRAY[
    'public.get_operational_orders_page(integer,integer,text,text,text)'::regprocedure,
    'public.get_supplier_receipts_page(integer,integer,text,uuid,uuid,text,boolean)'::regprocedure,
    'public.get_cash_shift_closing_report(uuid)'::regprocedure
  ];
  v_new regprocedure[] := ARRAY[
    'public.get_sales_history_page(integer,integer,text,date,date,text,text,text,text,boolean)'::regprocedure,
    'public.get_receiving_purchase_context(uuid[])'::regprocedure,
    'public.get_supplier_receipt_display_context(uuid)'::regprocedure,
    'public.get_cash_shift_movement_page(uuid,text,text,integer,integer)'::regprocedure,
    'public.get_document_correction_preview(text,uuid)'::regprocedure,
    'public.execute_document_correction_once(text,uuid,text,text,text)'::regprocedure
  ];
  v_reader regprocedure;
  v_expected text[] := ARRAY['authenticated=X/postgres','postgres=X/postgres'];
  v_acl text[];
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'OWNER_ACL208_POSTGRES_REQUIRED';
  END IF;
  IF NOT pg_try_advisory_xact_lock(734151139) THEN
    RAISE EXCEPTION 'OWNER_ACL208_UPGRADE_RUNNING';
  END IF;
  -- Validate ALL identities/owners/ACLs before the first REVOKE.
  FOREACH v_reader IN ARRAY (v_old || v_new) LOOP
    IF NOT EXISTS (SELECT FROM pg_proc WHERE oid = v_reader::oid
      AND pg_get_userbyid(proowner) = 'postgres' AND prokind = 'f') THEN
      RAISE EXCEPTION 'OWNER_ACL208_READER_IDENTITY_MISMATCH: %',v_reader;
    END IF;
    SELECT array_agg(a.acl::text ORDER BY a.acl::text COLLATE "C") INTO v_acl
      FROM pg_proc p CROSS JOIN LATERAL unnest(p.proacl) AS a(acl)
      WHERE p.oid = v_reader::oid;
    IF v_acl IS DISTINCT FROM v_expected AND
       (NOT (v_reader = ANY(v_old)) OR
        v_acl IS DISTINCT FROM (v_expected || ARRAY['service_role=X/postgres'])) THEN
      RAISE EXCEPTION 'OWNER_ACL208_UNEXPECTED_ACL: %',v_reader;
    END IF;
  END LOOP;

  REVOKE EXECUTE ON FUNCTION public.get_operational_orders_page(integer,integer,text,text,text)
    FROM service_role RESTRICT;
  REVOKE EXECUTE ON FUNCTION public.get_supplier_receipts_page(integer,integer,text,uuid,uuid,text,boolean)
    FROM service_role RESTRICT;
  REVOKE EXECUTE ON FUNCTION public.get_cash_shift_closing_report(uuid)
    FROM service_role RESTRICT;

  FOREACH v_reader IN ARRAY (v_old || v_new) LOOP
    SELECT array_agg(a.acl::text ORDER BY a.acl::text COLLATE "C") INTO v_acl
      FROM pg_proc p CROSS JOIN LATERAL unnest(p.proacl) AS a(acl)
      WHERE p.oid = v_reader::oid;
    IF v_acl IS DISTINCT FROM v_expected THEN
      RAISE EXCEPTION 'OWNER_ACL208_POSTCONDITION_FAILED: %',v_reader;
    END IF;
  END LOOP;
END;
$owner_acl208$;
COMMIT;

-- Expected: exactly nine rows, each ACL {authenticated=X/postgres,postgres=X/postgres}.
SELECT p.oid::regprocedure AS routine,
       ARRAY(SELECT a.acl::text FROM unnest(p.proacl) AS a(acl)
             ORDER BY a.acl::text COLLATE "C") AS acl
FROM pg_proc p
WHERE p.oid IN (
  'public.get_operational_orders_page(integer,integer,text,text,text)'::regprocedure,
  'public.get_supplier_receipts_page(integer,integer,text,uuid,uuid,text,boolean)'::regprocedure,
  'public.get_cash_shift_closing_report(uuid)'::regprocedure,
  'public.get_sales_history_page(integer,integer,text,date,date,text,text,text,text,boolean)'::regprocedure,
  'public.get_receiving_purchase_context(uuid[])'::regprocedure,
  'public.get_supplier_receipt_display_context(uuid)'::regprocedure,
  'public.get_cash_shift_movement_page(uuid,text,text,integer,integer)'::regprocedure,
  'public.get_document_correction_preview(text,uuid)'::regprocedure,
  'public.execute_document_correction_once(text,uuid,text,text,text)'::regprocedure
)
ORDER BY p.oid::regprocedure::text;
