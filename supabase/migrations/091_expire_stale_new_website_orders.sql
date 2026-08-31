-- =========================================================================
-- Stale website order reservations
--
-- A website order remains financially untouched while it is `new`: only its
-- inventory reservation exists.  This migration gives newly-created website
-- orders a server-owned five-hour reservation window, then expires only that
-- still-new order through a strict, fully atomic release path.
--
-- Historical `new` rows deliberately receive no backfill: they have no
-- trustworthy expiry timestamp and must be reviewed through the existing
-- Admin confirm/cancel workflow.
-- =========================================================================

BEGIN;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS reservation_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reservation_released_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS expired_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS expired_reason TEXT;

ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE public.orders
  ADD CONSTRAINT orders_status_check CHECK (status IN (
    'new',
    'confirmed',
    'preparing',
    'ready',
    'out_for_delivery',
    'completed',
    'cancelled',
    'returned',
    'expired'
  ));

ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_expired_metadata_check;
ALTER TABLE public.orders
  ADD CONSTRAINT orders_expired_metadata_check CHECK (
    status <> 'expired'
    OR (
      expired_at IS NOT NULL
      AND NULLIF(TRIM(expired_reason), '') IS NOT NULL
      AND reservation_released_at IS NOT NULL
    )
  );

CREATE INDEX IF NOT EXISTS idx_orders_expirable_website_new
  ON public.orders (reservation_expires_at, id)
  WHERE source = 'website'
    AND status = 'new'
    AND reservation_expires_at IS NOT NULL
    AND reservation_released_at IS NULL;

CREATE OR REPLACE FUNCTION public.set_website_new_order_reservation_expiry()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.source = 'website'
    AND NEW.status = 'new'
    AND NEW.reservation_expires_at IS NULL
  THEN
    NEW.reservation_expires_at := COALESCE(NEW.created_at, NOW()) + INTERVAL '5 hours';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_website_new_order_reservation_expiry
  ON public.orders;
CREATE TRIGGER trg_set_website_new_order_reservation_expiry
BEFORE INSERT ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.set_website_new_order_reservation_expiry();

CREATE OR REPLACE FUNCTION public.expire_stale_new_website_orders(
  p_batch_size INTEGER DEFAULT 100
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order RECORD;
  v_item RECORD;
  v_expired_count INTEGER := 0;
  v_expired_order_ids UUID[] := ARRAY[]::UUID[];
  v_reason CONSTANT TEXT := 'انتهت مهلة حجز طلب الموقع (5 ساعات) قبل قبول الطلب.';
BEGIN
  IF p_batch_size IS NULL OR p_batch_size NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'دفعة إنهاء صلاحية الطلبات يجب أن تكون بين 1 و100.';
  END IF;

  -- A short bounded run lets the next scheduled batch retry busy rows. The
  -- order lock is always acquired before inventory rows; inventory rows are
  -- then acquired in product-id order for every order.
  PERFORM set_config('lock_timeout', '3s', true);
  PERFORM set_config('statement_timeout', '25s', true);

  FOR v_order IN
    SELECT o.id, o.order_number, o.warehouse_id
    FROM public.orders AS o
    WHERE o.source = 'website'
      AND o.status = 'new'
      AND o.reservation_expires_at IS NOT NULL
      AND o.reservation_expires_at <= NOW()
      AND o.reservation_released_at IS NULL
    ORDER BY o.reservation_expires_at, o.id
    LIMIT p_batch_size
    FOR UPDATE SKIP LOCKED
  LOOP
    -- The locked row is rechecked so a future caller cannot accidentally
    -- broaden this operation beyond website/new reservations.
    IF v_order.warehouse_id IS NULL THEN
      RAISE EXCEPTION
        'الطلب (%) لا يملك مستودعًا صالحًا لتحرير الحجز.',
        v_order.order_number;
    END IF;

    FOR v_item IN
      SELECT oi.product_id, SUM(oi.quantity)::INTEGER AS quantity
      FROM public.order_items AS oi
      WHERE oi.order_id = v_order.id
      GROUP BY oi.product_id
      ORDER BY oi.product_id
    LOOP
      -- This is intentionally strict. Unlike the historical cancellation
      -- path, a reservation mismatch is never clamped with GREATEST(0, ...).
      -- Any mismatch aborts the whole transaction and leaves zero effects.
      UPDATE public.inventory_balances AS ib
      SET reserved_quantity = ib.reserved_quantity - v_item.quantity,
          updated_at = NOW()
      WHERE ib.warehouse_id = v_order.warehouse_id
        AND ib.product_id = v_item.product_id
        AND ib.reserved_quantity >= v_item.quantity;

      IF NOT FOUND THEN
        RAISE EXCEPTION
          'تعذر تحرير حجز الطلب (%): رصيد الحجز للصنف (%) غير متطابق.',
          v_order.order_number,
          v_item.product_id;
      END IF;
    END LOOP;

    UPDATE public.orders
    SET status = 'expired',
        expired_at = NOW(),
        expired_reason = v_reason,
        reservation_released_at = NOW(),
        updated_at = NOW()
    WHERE id = v_order.id
      AND source = 'website'
      AND status = 'new'
      AND reservation_expires_at <= NOW()
      AND reservation_released_at IS NULL;

    IF NOT FOUND THEN
      RAISE EXCEPTION
        'تغيرت حالة الطلب (%) أثناء إنهاء الصلاحية؛ تم إلغاء العملية بأمان.',
        v_order.order_number;
    END IF;

    INSERT INTO public.order_status_history (
      order_id, old_status, new_status, changed_by, notes
    ) VALUES (
      v_order.id, 'new', 'expired', NULL, v_reason
    );

    INSERT INTO public.audit_logs (
      user_id, action, entity_name, entity_id, details
    ) VALUES (
      NULL,
      'EXPIRE_STALE_NEW_WEBSITE_ORDER',
      'orders',
      v_order.id,
      jsonb_build_object(
        'order_number', v_order.order_number,
        'source', 'website',
        'reservation_expires_at', (SELECT reservation_expires_at FROM public.orders WHERE id = v_order.id),
        'reason', v_reason,
        'actor', 'system'
      )
    );

    v_expired_count := v_expired_count + 1;
    v_expired_order_ids := array_append(v_expired_order_ids, v_order.id);
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'expired_count', v_expired_count,
    'expired_order_ids', v_expired_order_ids
  );
END;
$$;

REVOKE ALL ON FUNCTION public.expire_stale_new_website_orders(INTEGER)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.expire_stale_new_website_orders(INTEGER) IS
  'Private scheduler-only expiry for website/new orders whose five-hour reservation window elapsed. It strictly releases reserved inventory once, then records expired status/history/audit in one transaction.';

-- Supabase Cron is the scheduler, not an HTTP/Edge dependency. If this
-- migration cannot enable pg_cron, it fails closed instead of deploying an
-- expiry policy without a scheduler.
CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.unschedule(jobid)
FROM cron.job
WHERE jobname = 'expire-stale-new-website-orders';

SELECT cron.schedule(
  'expire-stale-new-website-orders',
  '*/5 * * * *',
  $$SELECT public.expire_stale_new_website_orders(100);$$
);

COMMIT;
