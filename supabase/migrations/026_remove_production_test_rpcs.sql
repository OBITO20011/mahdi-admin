-- ============================================================================
-- Nawasrah ERP - Remove obsolete in-app System Test RPCs
-- Production QA remains in the repository test suite and rollback-safe SQL QA.
-- ============================================================================

BEGIN;

DROP FUNCTION IF EXISTS public.create_test_customer(TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.create_test_order(TEXT, TEXT, UUID, INT);

COMMIT;
