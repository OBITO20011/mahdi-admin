-- =========================================================================
-- Nawasrah ERP - Migration 079
-- Retire warehouse RPCs that were already fail-closed in migration 074.
--
-- They have no application callers and execution was revoked from every
-- application role. Removing the stale definitions prevents an older local
-- database from retaining code that targets pre-current inventory columns.
-- =========================================================================

BEGIN;

DROP FUNCTION IF EXISTS public.create_supplier_return(
  UUID, UUID, UUID, JSONB, BIGINT, TEXT, TEXT
);

DROP FUNCTION IF EXISTS public.create_stock_count_session(UUID, TEXT);

DROP FUNCTION IF EXISTS public.approve_stock_count(UUID, JSONB, TEXT);

COMMIT;
