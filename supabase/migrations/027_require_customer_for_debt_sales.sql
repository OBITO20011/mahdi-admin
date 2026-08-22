-- ============================================================================
-- Nawasrah ERP
-- Require a registered customer for every debt sale.
-- This invariant protects POS, website, and any future order-writing RPC.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.enforce_customer_for_debt_order()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.payment_method = 'debt' AND NEW.customer_id IS NULL THEN
    RAISE EXCEPTION
      'البيع الآجل يتطلب عميلاً مسجلاً حتى يُحفظ الدين على حسابه.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_require_customer_for_debt_order
  ON public.orders;

CREATE TRIGGER trg_require_customer_for_debt_order
BEFORE INSERT OR UPDATE OF payment_method, customer_id
ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.enforce_customer_for_debt_order();

COMMENT ON FUNCTION public.enforce_customer_for_debt_order() IS
  'Prevents creating an uncollectable debt order without a registered customer.';
