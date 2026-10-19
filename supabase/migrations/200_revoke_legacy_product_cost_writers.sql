-- Owner-approved 2026-10-19 after actual-role runtime proof on199:
-- legacy master/v2 can overwrite cost_price after stock history, bypassing171.
-- Keep the immutable bodies and their DEFINER internal chain v4 -> v3 -> v2
-- -> master. Only direct client execution is withdrawn; no data rewrite.
BEGIN;

REVOKE EXECUTE ON FUNCTION public.update_product_master(
  UUID, TEXT, TEXT, TEXT, TEXT, UUID, UUID, UUID, UUID, INTEGER, BIGINT,
  BIGINT, BIGINT, INTEGER, INTEGER, BOOLEAN, TEXT
) FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.update_product_master_v2(
  UUID, TEXT, TEXT, TEXT, TEXT, UUID, UUID, UUID, UUID, INTEGER, BIGINT,
  BIGINT, BIGINT, BIGINT, INTEGER, INTEGER, BOOLEAN, TEXT
) FROM PUBLIC, anon, authenticated;

COMMIT;
