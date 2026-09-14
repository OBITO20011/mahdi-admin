-- Keep POS retries immutable. Migration 023 correctly preserved the base-unit
-- inventory boundary, but its package wrapper continued to rewrite order
-- amounts and package snapshots after the private implementation reported an
-- idempotent replay. The public wrapper below resolves retries before that
-- mutating package-accounting path can run.

BEGIN;

DO $$
BEGIN
  IF to_regprocedure(
    'public._create_pos_sale_package_legacy(uuid,uuid,uuid,text,text,jsonb,bigint,bigint,text)'
  ) IS NULL THEN
    ALTER FUNCTION public.create_pos_sale(
      UUID, UUID, UUID, TEXT, TEXT, JSONB, BIGINT, BIGINT, TEXT
    ) RENAME TO _create_pos_sale_package_legacy;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public._create_pos_sale_package_legacy(
  UUID, UUID, UUID, TEXT, TEXT, JSONB, BIGINT, BIGINT, TEXT
) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.create_pos_sale(
  p_warehouse_id UUID,
  p_branch_id UUID,
  p_customer_id UUID,
  p_customer_name TEXT,
  p_payment_method TEXT,
  p_items JSONB,
  p_discount_in_minor_units BIGINT DEFAULT 0,
  p_amount_received_in_minor_units BIGINT DEFAULT 0,
  p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_key TEXT := NULLIF(TRIM(p_idempotency_key), '');
  v_user_id UUID := auth.uid();
  v_payment_method TEXT := COALESCE(p_payment_method, 'cash');
  v_item JSONB;
  v_product_id UUID;
  v_package_quantity INTEGER;
  v_request_item_count INTEGER := 0;
  v_request_items JSONB := '[]'::JSONB;
  v_stored_item_count INTEGER := 0;
  v_stored_items JSONB := '[]'::JSONB;
  v_snapshots_complete BOOLEAN := false;
  v_original_user_id UUID;
  v_order public.orders%ROWTYPE;
  v_items_result JSONB;
  v_request_tender BIGINT;
  v_stored_tender BIGINT;
  v_legacy_result JSONB;
  v_sorted_items JSONB;
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'sales'],
    'تنفيذ بيع الجملة المباشر'
  );

  IF p_items IS NULL
    OR jsonb_typeof(p_items) <> 'array'
    OR jsonb_array_length(p_items) = 0
  THEN
    RAISE EXCEPTION 'سلة بيع الجملة فارغة.';
  END IF;

  IF COALESCE(p_discount_in_minor_units, -1) < 0 THEN
    RAISE EXCEPTION 'خصم الفاتورة لا يمكن أن يكون سالباً.';
  END IF;

  IF COALESCE(p_amount_received_in_minor_units, -1) < 0 THEN
    RAISE EXCEPTION 'المبلغ المستلم لا يمكن أن يكون سالباً.';
  END IF;

  IF v_payment_method NOT IN (
    'cash', 'cliq', 'card', 'bank_transfer', 'debt', 'mixed'
  ) THEN
    RAISE EXCEPTION 'طريقة الدفع غير معتمدة.';
  END IF;

  -- product_id is the current RPC's stable internal identity. SKU and current
  -- prices remain display/runtime data and never participate in replay identity.
  FOR v_item IN
    SELECT item.value
    FROM jsonb_array_elements(p_items) AS item(value)
    ORDER BY item.value->>'product_id'
  LOOP
    BEGIN
      v_product_id := (v_item->>'product_id')::UUID;
      v_package_quantity := (v_item->>'quantity')::INTEGER;
    EXCEPTION
      WHEN invalid_text_representation OR numeric_value_out_of_range THEN
        RAISE EXCEPTION 'بيانات أحد طرود البيع غير صحيحة.';
    END;

    IF v_product_id IS NULL
      OR v_package_quantity IS NULL
      OR v_package_quantity <= 0
    THEN
      RAISE EXCEPTION 'كل صنف يحتاج منتجاً وعدد طرود صحيحاً أكبر من صفر.';
    END IF;

    v_request_item_count := v_request_item_count + 1;
    v_request_items := v_request_items || jsonb_build_array(
      jsonb_build_object(
        'product_id', v_product_id,
        'quantity', v_package_quantity
      )
    );
  END LOOP;

  IF v_request_item_count <> (
    SELECT COUNT(DISTINCT (item.value->>'product_id')::UUID)
    FROM jsonb_array_elements(p_items) AS item(value)
  ) THEN
    RAISE EXCEPTION 'لا يمكن تكرار المنتج نفسه أكثر من مرة في سلة البيع.';
  END IF;

  SELECT jsonb_agg(
    jsonb_build_object(
      'product_id', normalized.product_id,
      'quantity', normalized.package_quantity
    )
    ORDER BY normalized.product_id
  )
  INTO v_request_items
  FROM (
    SELECT
      (item.value->>'product_id')::UUID AS product_id,
      (item.value->>'quantity')::INTEGER AS package_quantity
    FROM jsonb_array_elements(p_items) AS item(value)
  ) normalized;

  -- Blank keys retain the published optional-key behavior. A real key is
  -- serialized with the same lock used by the original implementation.
  IF v_key IS NULL THEN
    RETURN public._create_pos_sale_package_legacy(
      p_warehouse_id,
      p_branch_id,
      p_customer_id,
      p_customer_name,
      p_payment_method,
      p_items,
      p_discount_in_minor_units,
      p_amount_received_in_minor_units,
      p_idempotency_key
    );
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(v_key));

  SELECT *
  INTO v_order
  FROM public.orders
  WHERE idempotency_key = v_key
  LIMIT 1
  FOR SHARE;

  IF NOT FOUND THEN
    v_legacy_result := public._create_pos_sale_package_legacy(
      p_warehouse_id,
      p_branch_id,
      p_customer_id,
      p_customer_name,
      p_payment_method,
      p_items,
      p_discount_in_minor_units,
      p_amount_received_in_minor_units,
      v_key
    );

    -- PostgreSQL does not guarantee row order when several line items share
    -- the same created_at. Normalize the first response to the same stable
    -- product ordering used by read-only replays.
    IF COALESCE((v_legacy_result->>'success')::BOOLEAN, false)
      AND jsonb_typeof(v_legacy_result->'items') = 'array'
    THEN
      SELECT COALESCE(
        jsonb_agg(item.value ORDER BY item.value->>'productId'),
        '[]'::JSONB
      )
      INTO v_sorted_items
      FROM jsonb_array_elements(v_legacy_result->'items') AS item(value);

      v_legacy_result := jsonb_set(
        v_legacy_result,
        '{items}',
        v_sorted_items
      );
    END IF;

    RETURN v_legacy_result;
  END IF;

  -- The old order table has no creator column. The immutable creation audit is
  -- the only safe legacy ownership proof. Missing/ambiguous proof fails closed.
  SELECT CASE
    WHEN COUNT(DISTINCT user_id) = 1
      THEN MAX(user_id::TEXT)::UUID
    ELSE NULL
  END
  INTO v_original_user_id
  FROM public.audit_logs
  WHERE entity_name = 'orders'
    AND entity_id = v_order.id
    AND action = 'CREATE_POS_SALE';

  IF v_order.source IS DISTINCT FROM 'pos'
    OR v_user_id IS NULL
    OR v_original_user_id IS NULL
    OR v_original_user_id IS DISTINCT FROM v_user_id
  THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'IDEMPOTENCY_CONFLICT: مفتاح إعادة المحاولة مستخدم لعملية مختلفة.';
  END IF;

  SELECT
    COUNT(*),
    COALESCE(
      BOOL_AND(
        oi.product_id IS NOT NULL
        AND oi.sale_package_quantity IS NOT NULL
        AND oi.units_per_sale_package IS NOT NULL
        AND oi.sale_package_price_in_minor_units IS NOT NULL
      ),
      false
    ),
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'product_id', oi.product_id,
          'quantity', oi.sale_package_quantity
        )
        ORDER BY oi.product_id
      ),
      '[]'::JSONB
    ),
    COALESCE(jsonb_agg(jsonb_build_object(
      'id', oi.id,
      'productId', oi.product_id,
      'productName', oi.product_name_snapshot,
      'sku', oi.sku_snapshot,
      'quantity', oi.sale_package_quantity,
      'baseQuantity', oi.quantity,
      'unitsPerSalePackage', oi.units_per_sale_package,
      'salePackage', oi.sale_package_name_snapshot,
      'unitPriceInMinorUnits', oi.sale_package_price_in_minor_units,
      'lineTotalInMinorUnits', oi.line_total_in_minor_units,
      'cogsInMinorUnits', oi.cogs_in_minor_units,
      'profitInMinorUnits', oi.profit_in_minor_units
    ) ORDER BY oi.product_id), '[]'::JSONB)
  INTO
    v_stored_item_count,
    v_snapshots_complete,
    v_stored_items,
    v_items_result
  FROM public.order_items oi
  WHERE oi.order_id = v_order.id;

  -- For cash, zero and an exact-total tender are logically equivalent. Any
  -- explicit over-tender amount remains part of the request because it owns
  -- change due. Other payment methods do not use amount received.
  v_stored_tender := CASE
    WHEN v_order.payment_method = 'cash'
      THEN v_order.total_in_minor_units + v_order.change_due_in_minor_units
    ELSE 0
  END;
  v_request_tender := CASE
    WHEN v_payment_method = 'cash' THEN
      CASE
        WHEN COALESCE(p_amount_received_in_minor_units, 0) IN (
          0, v_order.total_in_minor_units
        ) THEN v_order.total_in_minor_units
        ELSE p_amount_received_in_minor_units
      END
    ELSE 0
  END;

  IF NOT v_snapshots_complete
    OR v_stored_item_count <> v_request_item_count
    OR v_stored_items IS DISTINCT FROM v_request_items
    OR (p_warehouse_id IS NOT NULL
      AND p_warehouse_id IS DISTINCT FROM v_order.warehouse_id)
    OR (p_warehouse_id IS NOT NULL
      AND p_branch_id IS NOT NULL
      AND p_branch_id IS DISTINCT FROM v_order.branch_id)
    OR p_customer_id IS DISTINCT FROM v_order.customer_id
    OR (
      p_customer_id IS NULL
      AND COALESCE(NULLIF(TRIM(p_customer_name), ''), 'زبون نقدي')
        IS DISTINCT FROM COALESCE(v_order.customer_name_snapshot, 'زبون نقدي')
    )
    OR v_payment_method IS DISTINCT FROM v_order.payment_method
    OR COALESCE(p_discount_in_minor_units, 0)
      IS DISTINCT FROM v_order.discount_in_minor_units
    OR v_request_tender IS DISTINCT FROM v_stored_tender
  THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'IDEMPOTENCY_CONFLICT: مفتاح إعادة المحاولة مستخدم لعملية مختلفة.';
  END IF;

  -- Read-only replay: the response is reconstructed exclusively from the
  -- original order and package snapshots. Current product price/SKU/activity
  -- and later customer-payment state cannot rewrite the original command.
  RETURN jsonb_build_object(
    'success', true,
    'idempotentReplay', true,
    'orderId', v_order.id,
    'orderNumber', v_order.order_number,
    'customerName',
      COALESCE(v_order.customer_name_snapshot, 'زبون نقدي'),
    'warehouseId', v_order.warehouse_id,
    'branchId', v_order.branch_id,
    'subtotalInMinorUnits', v_order.subtotal_in_minor_units,
    'discountInMinorUnits', v_order.discount_in_minor_units,
    'totalInMinorUnits', v_order.total_in_minor_units,
    'amountPaidInMinorUnits', CASE
      WHEN v_order.payment_method = 'debt' THEN 0
      ELSE v_order.total_in_minor_units
    END,
    'changeDueInMinorUnits', v_order.change_due_in_minor_units,
    'paymentMethod', v_order.payment_method,
    'paymentStatus', CASE
      WHEN v_order.payment_method = 'debt' THEN 'unpaid'
      ELSE 'paid'
    END,
    'items', v_items_result,
    'message', 'تم بيع طرود الجملة وخصم حباتها من المخزون بدقة.'
  );
END;
$$;

ALTER FUNCTION public.create_pos_sale(
  UUID, UUID, UUID, TEXT, TEXT, JSONB, BIGINT, BIGINT, TEXT
) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.create_pos_sale(
  UUID, UUID, UUID, TEXT, TEXT, JSONB, BIGINT, BIGINT, TEXT
) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.create_pos_sale(
  UUID, UUID, UUID, TEXT, TEXT, JSONB, BIGINT, BIGINT, TEXT
) TO authenticated;

COMMENT ON FUNCTION public.create_pos_sale(
  UUID, UUID, UUID, TEXT, TEXT, JSONB, BIGINT, BIGINT, TEXT
) IS
  'Atomic wholesale POS sale with immutable, conflict-detecting idempotent replay. product_id is the canonical item identity.';

COMMENT ON FUNCTION public._create_pos_sale_package_legacy(
  UUID, UUID, UUID, TEXT, TEXT, JSONB, BIGINT, BIGINT, TEXT
) IS
  'Private package-accounting implementation retained behind the immutable POS idempotency boundary.';

COMMIT;
