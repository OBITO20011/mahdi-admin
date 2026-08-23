-- Nawasrah ERP - Build owner notifications only after website order pricing is final.
-- The public checkout creates its draft order before the wrapper applies delivery-zone fees.
-- Enqueue on the delivery-zone update so alerts contain the final payable amount once.

BEGIN;

CREATE OR REPLACE FUNCTION public.enqueue_order_automation_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_customer_name TEXT;
  v_customer_phone TEXT;
  v_delivery_address TEXT;
  v_google_maps_url TEXT;
BEGIN
  IF NEW.source <> 'website'
    OR NEW.status <> 'new'
    OR NEW.delivery_zone IS NULL
    OR (TG_OP = 'UPDATE' AND OLD.delivery_zone IS NOT DISTINCT FROM NEW.delivery_zone)
  THEN
    RETURN NEW;
  END IF;

  SELECT
    c.full_name,
    c.phone,
    COALESCE(
      NULLIF(TRIM(a.formatted_address), ''),
      NULLIF(CONCAT_WS(
        ' - ',
        NULLIF(TRIM(a.governorate), ''),
        NULLIF(TRIM(a.city), ''),
        NULLIF(TRIM(a.area), ''),
        NULLIF(TRIM(a.street), ''),
        NULLIF(TRIM(a.building), '')
      ), '')
    ),
    NULLIF(TRIM(a.google_maps_url), '')
  INTO v_customer_name, v_customer_phone, v_delivery_address, v_google_maps_url
  FROM public.customers c
  LEFT JOIN public.customer_addresses a ON a.id = NEW.customer_address_id
  WHERE c.id = NEW.customer_id;

  PERFORM public.enqueue_automation_event(
    'new_order:' || NEW.id::TEXT,
    'new_order',
    NEW.id,
    jsonb_build_object(
      'orderId', NEW.id,
      'orderNumber', NEW.order_number,
      'customerName', COALESCE(v_customer_name, 'عميل'),
      'customerPhone', v_customer_phone,
      'deliveryAddress', v_delivery_address,
      'googleMapsUrl', v_google_maps_url,
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

DROP TRIGGER IF EXISTS trg_enqueue_order_automation_event
  ON public.orders;
CREATE TRIGGER trg_enqueue_order_automation_event
AFTER INSERT OR UPDATE OF delivery_zone ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.enqueue_order_automation_event();

COMMENT ON FUNCTION public.enqueue_order_automation_event() IS
  'Queues one owner alert for a website order only after its delivery-zone total is final.';

COMMIT;
