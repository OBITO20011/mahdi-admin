-- =========================================================================
-- Nawasrah ERP - Remove the one-time E2E maintenance surface after cleanup.
-- The verified production baseline is retained; the destructive helper is not.
-- =========================================================================

BEGIN;

DROP FUNCTION IF EXISTS public.purge_tagged_e2e_test_cycle(TEXT);

COMMIT;
