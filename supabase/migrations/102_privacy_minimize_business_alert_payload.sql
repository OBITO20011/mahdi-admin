-- =========================================================================
-- Nawasrah ERP - Privacy minimization for external Business notifications.
--
-- Customer identity, phone, delivery address, and map location remain in the
-- canonical order records where authorized staff need them. They no longer
-- leave PostgreSQL through the Business automation outbox. Existing events are
-- intentionally not rewritten or deleted because retention/destruction needs
-- an approved Business policy.
-- =========================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.enqueue_order_automation_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.source <> 'website'
    OR NEW.status <> 'new'
    OR NEW.delivery_zone IS NULL
    OR (TG_OP = 'UPDATE' AND OLD.delivery_zone IS NOT DISTINCT FROM NEW.delivery_zone)
  THEN
    RETURN NEW;
  END IF;

  PERFORM public.enqueue_automation_event(
    'new_order:' || NEW.id::TEXT,
    'new_order',
    NEW.id,
    jsonb_build_object(
      'orderId', NEW.id,
      'orderNumber', NEW.order_number,
      'deliveryZone', NEW.delivery_zone,
      'deliveryFeeInMinorUnits', NEW.delivery_fee_in_minor_units,
      'totalInMinorUnits', NEW.total_in_minor_units,
      'paymentMethod', NEW.payment_method,
      'source', NEW.source,
      'createdAt', NEW.created_at
    )
  );

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_order_automation_event()
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.enqueue_order_automation_event() IS
  'Queues one owner alert after website pricing is final, excluding customer identity, phone, address, notes, and location from the external automation payload.';

COMMIT;
