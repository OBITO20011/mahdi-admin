-- Owner-approved Package E correction. Active supplier balance:
-- completed Direct + PO receipt payables minus every non-reversed payment.
-- A negative amount is a real supplier advance; no live backfill is performed.
-- Historical migrations001-132 and immutable receipt/cost snapshots remain intact.
-- Full explicit SQL definitions preserve existing authority and lock hierarchy.
BEGIN;

ALTER TABLE public.suppliers DROP CONSTRAINT suppliers_current_balance_minor_check;
COMMENT ON COLUMN public.suppliers.current_balance_in_minor_units IS
  'Active direct/PO receipt payables minus active payments; negative means supplier advance.';

CREATE OR REPLACE FUNCTION public.record_supplier_payment(
  p_supplier_id UUID,
  p_purchase_order_id UUID DEFAULT NULL,
  p_amount_in_minor_units BIGINT DEFAULT 0,
  p_payment_method TEXT DEFAULT 'cash',
  p_reference_number TEXT DEFAULT NULL,
  p_payment_date TIMESTAMPTZ DEFAULT NOW(),
  p_notes TEXT DEFAULT NULL,
  p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_key TEXT := NULLIF(TRIM(p_idempotency_key), '');
  v_existing public.supplier_payments%ROWTYPE;
  v_result JSONB;
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'accountant'],
    'تسجيل دفعات الموردين'
  );

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول لتسجيل دفعة مورد.';
  END IF;
  IF p_payment_method IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22004',
      MESSAGE = 'SUPPLIER_PAYMENT_METHOD_REQUIRED: طريقة دفع المورد مطلوبة.';
  END IF;
  IF v_key IS NULL OR CHAR_LENGTH(v_key) NOT BETWEEN 16 AND 200 THEN
    RAISE EXCEPTION 'مفتاح منع تكرار دفعة المورد غير صالح.';
  END IF;

  -- Serialize equal retries before the underlying implementation mutates the
  -- purchase order, supplier balance, cash shift, and audit history.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      v_user_id::TEXT || ':purchase_order_payment:' || v_key,
      0
    )
  );

  SELECT * INTO v_existing
  FROM public.supplier_payments
  WHERE created_by = v_user_id
    AND idempotency_scope = 'purchase_order_payment'
    AND idempotency_key = v_key
  FOR UPDATE;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'success', true,
      'idempotent', true,
      'payment_id', v_existing.id,
      'supplier_id', v_existing.supplier_id,
      'purchase_order_id', v_existing.purchase_order_id,
      'amount_in_minor_units', v_existing.amount_in_minor_units,
      'message', 'تمت معالجة طلب الدفعة سابقًا.'
    );
  END IF;

  PERFORM public.phase2_lock_payment_shift_internal(
    (SELECT branch_id FROM public.purchase_orders WHERE id = p_purchase_order_id),
    p_payment_method, p_amount_in_minor_units
  );
  v_result := public._record_supplier_payment_impl(
    p_supplier_id,
    p_purchase_order_id,
    p_amount_in_minor_units,
    p_payment_method,
    p_reference_number,
    p_payment_date,
    p_notes
  );

  -- One new committed payment reduces supplier debt even when it precedes
  -- receiving. The idempotent branch above never reaches this UPDATE.
  UPDATE public.suppliers
  SET current_balance_in_minor_units = current_balance_in_minor_units - p_amount_in_minor_units,
    updated_at = NOW()
  WHERE id = p_supplier_id;

  UPDATE public.supplier_payments
  SET
    idempotency_scope = 'purchase_order_payment',
    idempotency_key = v_key
  WHERE id = (v_result->>'payment_id')::UUID
    AND created_by = v_user_id
    AND idempotency_scope IS NULL
    AND idempotency_key IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'تعذر تثبيت مفتاح منع تكرار دفعة المورد.';
  END IF;

  RETURN v_result || jsonb_build_object('idempotent', false);
END;
$$;

CREATE OR REPLACE FUNCTION public.receive_purchase_order_v2(
  p_purchase_order_id UUID,
  p_warehouse_id UUID DEFAULT NULL,
  p_supplier_invoice_number TEXT DEFAULT NULL,
  p_supplier_invoice_date DATE DEFAULT NULL,
  p_received_at TIMESTAMPTZ DEFAULT NULL,
  p_header_discount_in_minor_units BIGINT DEFAULT 0,
  p_supplier_freight_in_minor_units BIGINT DEFAULT 0,
  p_legacy_tax_in_minor_units BIGINT DEFAULT 0,
  p_amount_paid_at_receipt_in_minor_units BIGINT DEFAULT 0,
  p_payment_method TEXT DEFAULT 'cash',
  p_payment_reference TEXT DEFAULT NULL,
  p_supplier_delivery_note TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_idempotency_key TEXT DEFAULT NULL,
  p_lines JSONB DEFAULT '[]'::JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_key TEXT := NULLIF(BTRIM(p_idempotency_key), '');
  v_invoice_number TEXT := NULLIF(BTRIM(p_supplier_invoice_number), '');
  v_normalized_invoice TEXT := LOWER(NULLIF(BTRIM(p_supplier_invoice_number), ''));
  v_payment_method TEXT := LOWER(COALESCE(NULLIF(BTRIM(p_payment_method), ''), 'cash'));
  v_payment_reference TEXT := NULLIF(BTRIM(p_payment_reference), '');
  v_po public.purchase_orders%ROWTYPE;
  v_po_item public.purchase_order_items%ROWTYPE;
  v_target_warehouse_id UUID;
  v_canonical_lines JSONB;
  v_canonical_request JSONB;
  v_fingerprint TEXT;
  v_existing_operation public.business_operations%ROWTYPE;
  v_operation_id UUID := gen_random_uuid();
  v_receipt_id UUID := gen_random_uuid();
  v_receipt_number TEXT;
  v_result JSONB;
  v_line_weights JSONB;
  v_header_allocations JSONB;
  v_freight_allocations JSONB;
  v_component_weights JSONB;
  v_component_merchandise_allocations JSONB;
  v_component_final_allocations JSONB;
  v_inventory_components JSONB := '[]'::JSONB;
  v_wac_results JSONB;
  v_line JSONB;
  v_component JSONB;
  v_line_id UUID;
  v_item_id UUID;
  v_line_sequence INTEGER := 0;
  v_po_item_id UUID;
  v_line_kind TEXT;
  v_client_line_id UUID;
  v_commercial_quantity INTEGER;
  v_units_per_parcel INTEGER;
  v_received_base_quantity INTEGER;
  v_base_quantity INTEGER;
  v_product_id UUID;
  v_gross BIGINT;
  v_line_discount BIGINT;
  v_line_net BIGINT;
  v_line_header_discount BIGINT;
  v_line_freight BIGINT;
  v_line_acquisition BIGINT;
  v_component_merchandise BIGINT;
  v_component_acquisition BIGINT;
  v_merchandise_gross NUMERIC := 0;
  v_line_discount_total NUMERIC := 0;
  v_line_net_total NUMERIC := 0;
  v_acquisition_total NUMERIC;
  v_invoice_payable NUMERIC;
  v_outstanding NUMERIC;
  v_all_completed BOOLEAN;
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'warehouse_keeper'],
    'استلام أمر شراء - نموذج الطرود'
  );
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'PHASE2_AUTH_REQUIRED: يجب تسجيل الدخول.';
  END IF;
  IF v_key IS NULL OR CHAR_LENGTH(v_key) NOT BETWEEN 16 AND 255 THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = 'PHASE2_IDEMPOTENCY_KEY_INVALID: مفتاح منع التكرار غير صالح.';
  END IF;
  IF p_header_discount_in_minor_units < 0
    OR p_supplier_freight_in_minor_units < 0
    OR p_legacy_tax_in_minor_units < 0
    OR p_amount_paid_at_receipt_in_minor_units < 0
  THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = 'PHASE2_FINANCIAL_VALUE_INVALID: القيم المالية لا يمكن أن تكون سالبة.';
  END IF;
  IF v_payment_method NOT IN ('cash', 'cliq', 'bank_transfer', 'deferred') THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = 'PHASE2_PAYMENT_METHOD_INVALID: طريقة الدفع غير مدعومة.';
  END IF;
  IF v_payment_method = 'deferred'
    AND p_amount_paid_at_receipt_in_minor_units > 0
  THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      CONSTRAINT = 'phase2_deferred_payment_zero_check',
      MESSAGE = 'PHASE2_DEFERRED_PAYMENT_INVALID: الاستلام الآجل لا يقبل دفعة فورية.';
  END IF;
  IF v_payment_method IN ('cliq', 'bank_transfer')
    AND p_amount_paid_at_receipt_in_minor_units > 0
    AND v_payment_reference IS NULL
  THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      CONSTRAINT = 'phase2_payment_reference_required_check',
      MESSAGE = 'PHASE2_PAYMENT_REFERENCE_REQUIRED: مرجع الدفعة الإلكترونية مطلوب.';
  END IF;

  v_canonical_lines := public.phase2_canonicalize_receipt_lines_internal(p_lines);

  v_canonical_request := jsonb_build_object(
    'contract_version', 2,
    'operation_type', 'purchase_order_receipt_v2',
    'purchase_order_id', LOWER(p_purchase_order_id::TEXT),
    'warehouse_id', CASE WHEN p_warehouse_id IS NULL THEN NULL ELSE LOWER(p_warehouse_id::TEXT) END,
    'supplier_invoice_number', v_normalized_invoice,
    'supplier_invoice_date', p_supplier_invoice_date,
    'received_at', CASE WHEN p_received_at IS NULL THEN NULL ELSE TO_CHAR(p_received_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END,
    'header_discount_in_minor_units', p_header_discount_in_minor_units,
    'supplier_freight_in_minor_units', p_supplier_freight_in_minor_units,
    'legacy_tax_in_minor_units', p_legacy_tax_in_minor_units,
    'amount_paid_at_receipt_in_minor_units', p_amount_paid_at_receipt_in_minor_units,
    'payment_method', v_payment_method,
    'payment_reference', v_payment_reference,
    'supplier_delivery_note', NULLIF(BTRIM(p_supplier_delivery_note), ''),
    'notes', NULLIF(BTRIM(p_notes), ''),
    'lines', v_canonical_lines
  );
  v_fingerprint := public.phase2_request_fingerprint_internal(v_canonical_request);

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'purchase_order_receipt_v2:' || v_user_id::TEXT || ':' || v_key, 0
  ));
  SELECT * INTO v_existing_operation
  FROM public.business_operations operation
  WHERE operation.operation_type = 'purchase_order_receipt_v2'
    AND operation.initiated_by = v_user_id
    AND operation.idempotency_key = v_key;
  IF FOUND THEN
    IF v_existing_operation.request_fingerprint IS NULL
      OR v_existing_operation.result_snapshot IS NULL
    THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'LEGACY_IDEMPOTENCY_IDENTITY_UNPROVEN: لا يمكن إثبات تطابق العملية التاريخية.';
    END IF;
    IF v_existing_operation.request_fingerprint IS DISTINCT FROM v_fingerprint THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'IDEMPOTENCY_CONFLICT: استُخدم المفتاح نفسه لطلب مختلف.';
    END IF;
    RETURN v_existing_operation.result_snapshot;
  END IF;

  PERFORM public.phase2_lock_payment_shift_internal(
    (SELECT branch_id FROM public.purchase_orders WHERE id = p_purchase_order_id),
    v_payment_method, p_amount_paid_at_receipt_in_minor_units
  );
  PERFORM public.phase2_lock_inventory_products_internal(ARRAY(
    SELECT DISTINCT (component->>'product_id')::UUID
    FROM jsonb_array_elements(v_canonical_lines) line
    CROSS JOIN LATERAL jsonb_array_elements(line->'components') component
    ORDER BY (component->>'product_id')::UUID
  ));
  PERFORM public.phase2_validate_receipt_lines_internal(v_canonical_lines);
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_canonical_lines) line
    WHERE line->>'purchase_order_item_id' IS NULL
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = 'PHASE2_PO_ITEM_ID_REQUIRED: كل سطر استلام يجب أن يرتبط بسطر أمر شراء.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_canonical_lines) line
    GROUP BY (line->>'purchase_order_item_id')::UUID
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23505',
      CONSTRAINT = 'phase2_purchase_receipt_po_item_unique',
      MESSAGE = 'PHASE2_DUPLICATE_PO_ITEM: لا يجوز تكرار سطر أمر الشراء داخل نفس سند الاستلام.';
  END IF;

  SELECT
    COALESCE(SUM((line->>'gross_amount_in_minor_units')::NUMERIC), 0),
    COALESCE(SUM((line->>'line_discount_in_minor_units')::NUMERIC), 0)
  INTO v_merchandise_gross, v_line_discount_total
  FROM jsonb_array_elements(v_canonical_lines) line;
  v_line_net_total := v_merchandise_gross - v_line_discount_total;
  IF p_header_discount_in_minor_units > v_line_net_total THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      CONSTRAINT = 'phase2_header_discount_total_check',
      MESSAGE = 'PHASE2_HEADER_DISCOUNT_EXCEEDS_NET: خصم رأس الفاتورة يتجاوز صافي البضاعة.';
  END IF;
  IF v_line_net_total = 0
    AND (p_header_discount_in_minor_units > 0 OR p_supplier_freight_in_minor_units > 0)
  THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      CONSTRAINT = 'phase2_zero_allocation_basis_check',
      MESSAGE = 'PHASE2_ZERO_ALLOCATION_BASIS: لا يمكن توزيع خصم أو شحن على أساس صفري.';
  END IF;
  v_acquisition_total := v_line_net_total
    - p_header_discount_in_minor_units::NUMERIC
    + p_supplier_freight_in_minor_units::NUMERIC;
  v_invoice_payable := v_acquisition_total + p_legacy_tax_in_minor_units::NUMERIC;
  IF v_merchandise_gross > 9223372036854775807::NUMERIC
    OR v_line_discount_total > 9223372036854775807::NUMERIC
    OR v_line_net_total > 9223372036854775807::NUMERIC
    OR v_acquisition_total > 9223372036854775807::NUMERIC
    OR v_invoice_payable > 9223372036854775807::NUMERIC
  THEN
    RAISE EXCEPTION USING ERRCODE = '22003',
      MESSAGE = 'PHASE2_MONEY_OVERFLOW: قيمة الاستلام تتجاوز الحد المدعوم.';
  END IF;
  IF p_amount_paid_at_receipt_in_minor_units::NUMERIC > v_invoice_payable THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      CONSTRAINT = 'phase2_payment_upper_bound_check',
      MESSAGE = 'PHASE2_PAYMENT_EXCEEDS_PAYABLE: الدفعة تتجاوز إجمالي فاتورة المورد.';
  END IF;
  v_outstanding := v_invoice_payable - p_amount_paid_at_receipt_in_minor_units::NUMERIC;

  SELECT * INTO v_po
  FROM public.purchase_orders purchase_order
  WHERE purchase_order.id = p_purchase_order_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PHASE2_PURCHASE_ORDER_NOT_FOUND: أمر الشراء غير موجود.';
  END IF;
  IF v_po.status NOT IN ('approved', 'partially_received') THEN
    RAISE EXCEPTION 'PHASE2_PURCHASE_ORDER_STATUS_INVALID: أمر الشراء غير جاهز للاستلام.';
  END IF;
  -- Existing PO payments have ALREADY reduced the supplier balance.
  -- No allocation/backfill into immutable receipt snapshots is needed.
  -- Receiving adds gross payable minus ONLY its own newly committed payment.

  v_target_warehouse_id := COALESCE(p_warehouse_id, v_po.warehouse_id);
  IF v_target_warehouse_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.warehouses warehouse
    WHERE warehouse.id = v_target_warehouse_id AND warehouse.is_active
  ) THEN
    RAISE EXCEPTION 'PHASE2_WAREHOUSE_INVALID: المستودع غير موجود أو غير نشط.';
  END IF;

  PERFORM item.id
  FROM public.purchase_order_items item
  JOIN (
    SELECT DISTINCT (line->>'purchase_order_item_id')::UUID AS item_id
    FROM jsonb_array_elements(v_canonical_lines) line
  ) input_item ON input_item.item_id = item.id
  WHERE item.purchase_order_id = p_purchase_order_id
  ORDER BY item.id
  FOR UPDATE OF item;

  FOR v_line IN SELECT * FROM jsonb_array_elements(v_canonical_lines)
  LOOP
    v_po_item_id := (v_line->>'purchase_order_item_id')::UUID;
    SELECT * INTO v_po_item
    FROM public.purchase_order_items item
    WHERE item.id = v_po_item_id
      AND item.purchase_order_id = p_purchase_order_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'PHASE2_PO_ITEM_NOT_FOUND: سطر أمر الشراء غير موجود.';
    END IF;
    v_line_kind := v_line->>'line_kind';
    v_commercial_quantity := (v_line->>'commercial_quantity')::INTEGER;
    v_received_base_quantity := (
      SELECT SUM((component->>'base_quantity')::INTEGER)
      FROM jsonb_array_elements(v_line->'components') component
    );
    IF v_line_kind IS DISTINCT FROM v_po_item.commercial_line_kind THEN
      RAISE EXCEPTION USING ERRCODE = '23514',
        CONSTRAINT = 'phase2_purchase_receipt_line_kind_check',
        MESSAGE = 'PHASE2_PO_LINE_KIND_MISMATCH: نوع الاستلام لا يطابق سطر أمر الشراء.';
    END IF;
    IF v_line_kind = 'base_unit' THEN
      IF (v_line->'components'->0->>'product_id')::UUID
          IS DISTINCT FROM v_po_item.product_id
        OR v_received_base_quantity > v_po_item.ordered_quantity - v_po_item.received_quantity
      THEN
        RAISE EXCEPTION USING ERRCODE = '23514',
          CONSTRAINT = 'phase2_purchase_receipt_base_quantity_check',
          MESSAGE = 'PHASE2_PO_BASE_RECEIPT_INVALID: المنتج أو الكمية يتجاوزان المتبقي في أمر الشراء.';
      END IF;
    ELSE
      IF NULLIF(v_line->>'family_product_id', '')::UUID
          IS DISTINCT FROM v_po_item.family_product_id
        OR NULLIF(v_line->>'parcel_configuration_id', '')::UUID
          IS DISTINCT FROM v_po_item.parcel_configuration_id
        OR NULLIF(v_line->>'configuration_revision', '')::INTEGER
          IS DISTINCT FROM v_po_item.configuration_revision
        OR NULLIF(v_line->>'units_per_parcel', '')::INTEGER
          IS DISTINCT FROM v_po_item.units_per_parcel_snapshot
        OR v_commercial_quantity
          > v_po_item.parcel_quantity - v_po_item.received_parcel_quantity
      THEN
        RAISE EXCEPTION USING ERRCODE = '23514',
          CONSTRAINT = 'phase2_purchase_receipt_parcel_quantity_check',
          MESSAGE = 'PHASE2_PO_PARCEL_RECEIPT_INVALID: هوية الطرد أو كميته تتجاوز المتبقي في أمر الشراء.';
      END IF;
    END IF;
  END LOOP;

  SELECT NOT EXISTS (
    SELECT 1
    FROM public.purchase_order_items item
    LEFT JOIN LATERAL (
      SELECT
        SUM((component->>'base_quantity')::INTEGER)::INTEGER AS received_base,
        CASE WHEN line->>'line_kind' = 'configurable_parcel'
          THEN (line->>'commercial_quantity')::INTEGER ELSE 0 END AS received_parcels
      FROM jsonb_array_elements(v_canonical_lines) line
      CROSS JOIN LATERAL jsonb_array_elements(line->'components') component
      WHERE (line->>'purchase_order_item_id')::UUID = item.id
      GROUP BY line
    ) incoming ON true
    WHERE item.purchase_order_id = p_purchase_order_id
      AND (
        item.received_quantity + COALESCE(incoming.received_base, 0)
          < item.ordered_quantity
        OR (item.commercial_line_kind = 'configurable_parcel'
          AND item.received_parcel_quantity
            + COALESCE(incoming.received_parcels, 0) < item.parcel_quantity)
      )
  ) INTO v_all_completed;

  IF v_normalized_invoice IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(
      'supplier_invoice:' || v_po.supplier_id::TEXT || ':' || v_normalized_invoice,
      0
    ));
    IF EXISTS (
      SELECT 1 FROM public.supplier_financial_invoice_identities identity
      WHERE identity.supplier_id = v_po.supplier_id
        AND identity.normalized_invoice_number = v_normalized_invoice
        AND identity.is_active
    ) OR EXISTS (
      SELECT 1 FROM public.supplier_receipts receipt
      WHERE receipt.supplier_id = v_po.supplier_id
        AND LOWER(BTRIM(receipt.supplier_invoice_number)) = v_normalized_invoice
        AND receipt.status <> 'cancelled'
    ) OR EXISTS (
      SELECT 1 FROM public.purchase_receipts receipt
      WHERE receipt.supplier_id = v_po.supplier_id
        AND LOWER(BTRIM(receipt.supplier_invoice_number)) = v_normalized_invoice
        AND receipt.status <> 'cancelled'
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '23505',
        CONSTRAINT = 'uq_supplier_financial_invoice_active',
        MESSAGE = 'DUPLICATE_SUPPLIER_INVOICE: رقم فاتورة المورد مستخدم في سند مالي نشط.';
    END IF;
  END IF;

  LOOP
    v_receipt_number := 'GRN-' || TO_CHAR(NOW(), 'YYYY') || '-'
      || LPAD(FLOOR(100000 + RANDOM() * 900000)::BIGINT::TEXT, 6, '0');
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.purchase_receipts receipt
      WHERE receipt.receipt_number = v_receipt_number
    );
  END LOOP;

  v_result := jsonb_build_object(
    'success', true,
    'idempotent', false,
    'operation_id', v_operation_id,
    'receipt_id', v_receipt_id,
    'receipt_number', v_receipt_number,
    'purchase_order_id', p_purchase_order_id,
    'inventory_acquisition_cost_in_minor_units', v_acquisition_total::BIGINT,
    'supplier_invoice_payable_total_in_minor_units', v_invoice_payable::BIGINT,
    'supplier_outstanding_balance_effect_in_minor_units', v_outstanding::BIGINT,
    'is_fully_received', v_all_completed,
    'new_status', CASE WHEN v_all_completed THEN 'received' ELSE 'partially_received' END
  );
  INSERT INTO public.business_operations (
    id, operation_type, idempotency_key, request_fingerprint,
    initiated_by, result_snapshot, completed_at
  ) VALUES (
    v_operation_id, 'purchase_order_receipt_v2', v_key, v_fingerprint,
    v_user_id, v_result, NOW()
  );
  INSERT INTO public.purchase_receipts (
    id, receipt_number, purchase_order_id, supplier_id, warehouse_id,
    received_by, received_at, supplier_delivery_note, notes, operation_id,
    status, supplier_invoice_number, supplier_invoice_date,
    merchandise_gross_snapshot_in_minor_units,
    line_discount_total_snapshot_in_minor_units,
    header_discount_snapshot_in_minor_units,
    supplier_freight_snapshot_in_minor_units,
    legacy_tax_snapshot_in_minor_units,
    inventory_acquisition_cost_snapshot_in_minor_units,
    supplier_invoice_payable_total_snapshot_in_minor_units,
    amount_paid_at_receipt_snapshot_in_minor_units,
    supplier_outstanding_balance_effect_snapshot_in_minor_units,
    payment_method, payment_reference, phase2_finalized_at
  ) VALUES (
    v_receipt_id, v_receipt_number, p_purchase_order_id, v_po.supplier_id,
    v_target_warehouse_id, v_user_id, COALESCE(p_received_at, NOW()),
    NULLIF(BTRIM(p_supplier_delivery_note), ''), NULLIF(BTRIM(p_notes), ''),
    v_operation_id, 'completed', v_invoice_number, p_supplier_invoice_date,
    v_merchandise_gross::BIGINT, v_line_discount_total::BIGINT,
    p_header_discount_in_minor_units, p_supplier_freight_in_minor_units,
    p_legacy_tax_in_minor_units, v_acquisition_total::BIGINT,
    v_invoice_payable::BIGINT, p_amount_paid_at_receipt_in_minor_units,
    v_outstanding::BIGINT, v_payment_method, v_payment_reference, NOW()
  );

  IF v_normalized_invoice IS NOT NULL THEN
    INSERT INTO public.supplier_financial_invoice_identities (
      supplier_id, normalized_invoice_number, operation_id, purchase_receipt_id
    ) VALUES (
      v_po.supplier_id, v_normalized_invoice, v_operation_id, v_receipt_id
    );
  END IF;

  SELECT jsonb_agg(jsonb_build_object(
    'key', line->>'client_line_id',
    'weight', (
      (line->>'gross_amount_in_minor_units')::BIGINT
      - (line->>'line_discount_in_minor_units')::BIGINT
    )
  )) INTO v_line_weights
  FROM jsonb_array_elements(v_canonical_lines) line;
  SELECT COALESCE(jsonb_object_agg(allocation_key, allocated_amount), '{}'::JSONB)
  INTO v_header_allocations
  FROM public.phase2_allocate_largest_remainder_internal(
    p_header_discount_in_minor_units, v_line_weights
  );
  SELECT COALESCE(jsonb_object_agg(allocation_key, allocated_amount), '{}'::JSONB)
  INTO v_freight_allocations
  FROM public.phase2_allocate_largest_remainder_internal(
    p_supplier_freight_in_minor_units, v_line_weights
  );

  FOR v_line IN SELECT * FROM jsonb_array_elements(v_canonical_lines)
  LOOP
    v_line_sequence := v_line_sequence + 1;
    v_line_id := gen_random_uuid();
    v_client_line_id := (v_line->>'client_line_id')::UUID;
    v_po_item_id := (v_line->>'purchase_order_item_id')::UUID;
    v_line_kind := v_line->>'line_kind';
    v_commercial_quantity := (v_line->>'commercial_quantity')::INTEGER;
    v_units_per_parcel := NULLIF(v_line->>'units_per_parcel', '')::INTEGER;
    v_received_base_quantity := (
      SELECT SUM((component->>'base_quantity')::INTEGER)
      FROM jsonb_array_elements(v_line->'components') component
    );
    v_gross := (v_line->>'gross_amount_in_minor_units')::BIGINT;
    v_line_discount := (v_line->>'line_discount_in_minor_units')::BIGINT;
    v_line_net := v_gross - v_line_discount;
    v_line_header_discount := COALESCE(
      (v_header_allocations->>v_client_line_id::TEXT)::BIGINT, 0
    );
    v_line_freight := COALESCE(
      (v_freight_allocations->>v_client_line_id::TEXT)::BIGINT, 0
    );
    v_line_acquisition := v_line_net - v_line_header_discount + v_line_freight;

    INSERT INTO public.purchase_receipt_commercial_lines (
      id, purchase_receipt_id, purchase_order_id, purchase_order_item_id,
      operation_id, client_line_id, line_sequence, commercial_line_kind,
      family_product_id, parcel_configuration_id, configuration_revision,
      received_commercial_quantity, received_parcel_quantity,
      received_base_unit_quantity, units_per_parcel_snapshot,
      base_unit_name_snapshot, parcel_unit_name_snapshot,
      gross_amount_snapshot_in_minor_units,
      line_discount_snapshot_in_minor_units,
      line_net_merchandise_snapshot_in_minor_units,
      allocated_header_discount_in_minor_units,
      allocated_supplier_freight_in_minor_units,
      final_acquisition_amount_in_minor_units, finalized_at
    ) VALUES (
      v_line_id, v_receipt_id, p_purchase_order_id, v_po_item_id,
      v_operation_id, v_client_line_id, v_line_sequence, v_line_kind,
      NULLIF(v_line->>'family_product_id', '')::UUID,
      NULLIF(v_line->>'parcel_configuration_id', '')::UUID,
      NULLIF(v_line->>'configuration_revision', '')::INTEGER,
      v_commercial_quantity,
      CASE WHEN v_line_kind = 'configurable_parcel' THEN v_commercial_quantity END,
      v_received_base_quantity, v_units_per_parcel,
      v_line->>'base_unit_name', NULLIF(v_line->>'parcel_unit_name', ''),
      v_gross, v_line_discount, v_line_net,
      v_line_header_discount, v_line_freight, v_line_acquisition, NOW()
    );

    SELECT jsonb_agg(jsonb_build_object(
      'key', component->>'product_id',
      'weight', CASE
        WHEN component->>'explicit_merchandise_cost_in_minor_units' IS NULL
          THEN (component->>'base_quantity')::BIGINT
        ELSE (component->>'explicit_merchandise_cost_in_minor_units')::BIGINT
      END
    )) INTO v_component_weights
    FROM jsonb_array_elements(v_line->'components') component;
    SELECT COALESCE(jsonb_object_agg(allocation_key, allocated_amount), '{}'::JSONB)
    INTO v_component_merchandise_allocations
    FROM public.phase2_allocate_largest_remainder_internal(
      v_line_net, v_component_weights
    );
    SELECT COALESCE(jsonb_object_agg(allocation_key, allocated_amount), '{}'::JSONB)
    INTO v_component_final_allocations
    FROM public.phase2_allocate_largest_remainder_internal(
      v_line_acquisition, v_component_weights
    );

    FOR v_component IN SELECT * FROM jsonb_array_elements(v_line->'components')
    LOOP
      v_item_id := gen_random_uuid();
      v_product_id := (v_component->>'product_id')::UUID;
      v_base_quantity := (v_component->>'base_quantity')::INTEGER;
      v_component_merchandise :=
        (v_component_merchandise_allocations->>v_product_id::TEXT)::BIGINT;
      v_component_acquisition :=
        (v_component_final_allocations->>v_product_id::TEXT)::BIGINT;

      INSERT INTO public.purchase_receipt_items (
        id, purchase_receipt_id, purchase_order_item_id, product_id,
        received_quantity, unit_cost_in_minor_units, operation_id,
        allocated_cost_in_minor_units, exact_unit_cost_in_minor_units,
        commercial_line_id, merchandise_net_cost_in_minor_units
      ) VALUES (
        v_item_id, v_receipt_id, v_po_item_id, v_product_id,
        v_base_quantity,
        ROUND(v_component_acquisition::NUMERIC / v_base_quantity)::BIGINT,
        v_operation_id, v_component_acquisition,
        ROUND(v_component_acquisition::NUMERIC / v_base_quantity, 6),
        v_line_id, v_component_merchandise
      );
      v_inventory_components := v_inventory_components || jsonb_build_array(
        jsonb_build_object(
          'item_id', v_item_id,
          'client_line_id', v_client_line_id,
          'product_id', v_product_id,
          'base_quantity', v_base_quantity,
          'allocated_cost_in_minor_units', v_component_acquisition
        )
      );
    END LOOP;

    UPDATE public.purchase_order_items
    SET
      received_quantity = received_quantity + v_received_base_quantity,
      received_parcel_quantity = received_parcel_quantity
        + CASE WHEN v_line_kind = 'configurable_parcel'
            THEN v_commercial_quantity ELSE 0 END,
      updated_at = NOW()
    WHERE id = v_po_item_id;
  END LOOP;

  v_wac_results := public.phase2_apply_inventory_and_wac_internal(
    v_operation_id,
    v_target_warehouse_id,
    'purchase_receipt',
    v_receipt_id,
    v_inventory_components,
    v_user_id,
    'استلام أمر شراء Phase 2 - ' || v_receipt_number
  );

  UPDATE public.suppliers
  SET current_balance_in_minor_units =
      current_balance_in_minor_units + v_outstanding::BIGINT,
    updated_at = NOW()
  WHERE id = v_po.supplier_id;

  IF p_amount_paid_at_receipt_in_minor_units > 0 THEN
    INSERT INTO public.supplier_payments (
      supplier_id, purchase_order_id, purchase_receipt_id,
      amount_in_minor_units, payment_method, reference_number,
      payment_date, notes, created_by, operation_id
    ) VALUES (
      v_po.supplier_id, p_purchase_order_id, v_receipt_id,
      p_amount_paid_at_receipt_in_minor_units, v_payment_method,
      v_payment_reference, COALESCE(p_received_at, NOW()),
      'دفعة عند استلام السند ' || v_receipt_number,
      v_user_id, v_operation_id
    );
  END IF;

  UPDATE public.purchase_orders
  SET amount_paid_in_minor_units = amount_paid_in_minor_units + p_amount_paid_at_receipt_in_minor_units,
    status = CASE WHEN v_all_completed THEN 'received' ELSE 'partially_received' END,
    received_at = CASE WHEN v_all_completed THEN NOW() ELSE received_at END,
    updated_at = NOW()
  WHERE id = p_purchase_order_id;

  INSERT INTO public.audit_logs (
    user_id, action, entity_name, entity_id, details
  ) VALUES (
    v_user_id, 'RECEIVE_PURCHASE_ORDER_V2', 'purchase_receipts',
    v_receipt_id,
    jsonb_build_object(
      'operation_id', v_operation_id,
      'purchase_order_id', p_purchase_order_id,
      'receipt_number', v_receipt_number,
      'inventory_acquisition_cost_in_minor_units', v_acquisition_total::BIGINT,
      'supplier_invoice_payable_total_in_minor_units', v_invoice_payable::BIGINT,
      'supplier_outstanding_balance_effect_in_minor_units', v_outstanding::BIGINT,
      'is_fully_received', v_all_completed,
      'wac', v_wac_results
    )
  );

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.reverse_supplier_payment(
  p_supplier_payment_id UUID,
  p_reason TEXT,
  p_idempotency_key TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID;
  v_payment public.supplier_payments%ROWTYPE;
  v_shift public.cash_shifts%ROWTYPE;
  v_receipt public.supplier_receipts%ROWTYPE;
  v_purchase_order public.purchase_orders%ROWTYPE;
  v_existing public.supplier_payment_reversals%ROWTYPE;
  v_reason TEXT := NULLIF(TRIM(p_reason), '');
  v_key TEXT := NULLIF(TRIM(p_idempotency_key), '');
  v_new_paid BIGINT;
  v_new_due BIGINT;
  v_effect JSONB;
BEGIN
  v_user_id := public.assert_reversal_owner('عكس دفعة مورد');
  IF p_supplier_payment_id IS NULL THEN
    RAISE EXCEPTION 'دفعة المورد المطلوب عكسها غير محددة.';
  END IF;
  IF v_reason IS NULL OR CHAR_LENGTH(v_reason) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'سبب عكس دفعة المورد مطلوب ويجب أن يكون بين 3 و500 حرف.';
  END IF;
  IF v_key IS NULL OR CHAR_LENGTH(v_key) NOT BETWEEN 16 AND 200 THEN
    RAISE EXCEPTION 'مفتاح منع التكرار لعكس دفعة المورد غير صالح.';
  END IF;

  PERFORM set_config('lock_timeout', '3s', true);
  PERFORM set_config('statement_timeout', '30s', true);

  SELECT * INTO v_payment
  FROM public.supplier_payments
  WHERE id = p_supplier_payment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'دفعة المورد غير موجودة.';
  END IF;
  IF v_payment.cash_shift_id IS NULL THEN
    RAISE EXCEPTION 'دفعة المورد غير مرتبطة بورديّة صريحة.';
  END IF;

  -- Match the orchestrator's canonical order: shift advisory, operation
  -- advisory, shift row, payment row, then receipt/PO and supplier rows.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('cash-shift-full-reversal:' || v_payment.cash_shift_id::TEXT, 0)
  );
  PERFORM pg_advisory_xact_lock(
    hashtextextended('supplier-payment-reversal:' || p_supplier_payment_id::TEXT, 0)
  );

  SELECT * INTO v_shift
  FROM public.cash_shifts
  WHERE id = v_payment.cash_shift_id
  FOR UPDATE;
  IF NOT FOUND OR v_shift.status <> 'open' THEN
    RAISE EXCEPTION 'لا يمكن عكس دفعة مورد مرتبطة بورديّة غير مفتوحة.';
  END IF;

  SELECT * INTO v_existing
  FROM public.supplier_payment_reversals
  WHERE requested_by = v_user_id
    AND idempotency_key = v_key
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing.supplier_payment_id <> p_supplier_payment_id THEN
      RAISE EXCEPTION 'مفتاح منع التكرار مستخدم لعكس دفعة مورد أخرى.';
    END IF;
    RETURN jsonb_build_object(
      'success', true,
      'idempotent', true,
      'reversal_id', v_existing.id,
      'supplier_payment_id', v_existing.supplier_payment_id,
      'cash_shift_id', v_existing.cash_shift_id,
      'actual_effect', v_existing.actual_effect
    );
  END IF;

  SELECT * INTO v_payment
  FROM public.supplier_payments
  WHERE id = p_supplier_payment_id
  FOR UPDATE;
  IF NOT FOUND OR v_payment.cash_shift_id <> v_shift.id OR v_payment.is_reversed THEN
    RAISE EXCEPTION 'دفعة المورد لم تعد قابلة للعكس.';
  END IF;
  IF (v_payment.supplier_receipt_id IS NULL AND v_payment.purchase_order_id IS NULL)
    OR (v_payment.supplier_receipt_id IS NOT NULL AND v_payment.purchase_order_id IS NOT NULL)
  THEN
    RAISE EXCEPTION 'دفعة المورد لا تحمل مرجعًا ماليًا واحدًا واضحًا يمكن عكسه بأمان.';
  END IF;

  IF v_payment.supplier_receipt_id IS NOT NULL THEN
    SELECT * INTO v_receipt
    FROM public.supplier_receipts
    WHERE id = v_payment.supplier_receipt_id
    FOR UPDATE;
    IF NOT FOUND OR v_receipt.status <> 'completed' OR v_receipt.supplier_id <> v_payment.supplier_id THEN
      RAISE EXCEPTION 'سند استلام المورد لم يعد صالحًا لعكس الدفعة.';
    END IF;
    IF v_receipt.amount_paid_in_minor_units < v_payment.amount_in_minor_units THEN
      RAISE EXCEPTION 'رصيد دفعات سند المورد لا يسمح بعكس هذه الدفعة بأمان.';
    END IF;

    v_new_paid := v_receipt.amount_paid_in_minor_units - v_payment.amount_in_minor_units;
    v_new_due := v_receipt.total_in_minor_units - v_new_paid;

    PERFORM 1 FROM public.suppliers
    WHERE id = v_payment.supplier_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'المورد المرتبط بالدفعة غير موجود.';
    END IF;

    UPDATE public.supplier_receipts
    SET
      amount_paid_in_minor_units = v_new_paid,
      amount_due_in_minor_units = v_new_due,
      payment_status = CASE
        WHEN v_new_paid = 0 THEN 'unpaid'
        WHEN v_new_paid = v_receipt.total_in_minor_units THEN 'paid'
        ELSE 'partially_paid'
      END,
      updated_at = NOW()
    WHERE id = v_receipt.id;

    UPDATE public.suppliers
    SET
      current_balance_in_minor_units = current_balance_in_minor_units + v_payment.amount_in_minor_units,
      updated_at = NOW()
    WHERE id = v_payment.supplier_id;

    v_effect := jsonb_build_object(
      'reference_type', 'supplier_receipt',
      'reference_id', v_receipt.id,
      'supplier_balance_restored_in_minor_units', v_payment.amount_in_minor_units,
      'receipt_amount_paid_after_in_minor_units', v_new_paid,
      'receipt_amount_due_after_in_minor_units', v_new_due,
      'cash_in_minor_units', CASE WHEN v_payment.payment_method = 'cash' THEN v_payment.amount_in_minor_units ELSE 0 END,
      'cliq_in_minor_units', CASE WHEN v_payment.payment_method = 'cliq' THEN v_payment.amount_in_minor_units ELSE 0 END
    );
  ELSE
    SELECT * INTO v_purchase_order
    FROM public.purchase_orders
    WHERE id = v_payment.purchase_order_id
    FOR UPDATE;
    IF NOT FOUND OR v_purchase_order.supplier_id <> v_payment.supplier_id THEN
      RAISE EXCEPTION 'أمر شراء المورد لم يعد صالحًا لعكس الدفعة.';
    END IF;
    IF v_purchase_order.amount_paid_in_minor_units < v_payment.amount_in_minor_units THEN
      RAISE EXCEPTION 'رصيد دفعات أمر الشراء لا يسمح بعكس هذه الدفعة بأمان.';
    END IF;

    PERFORM 1 FROM public.suppliers
    WHERE id = v_payment.supplier_id FOR NO KEY UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'المورد المرتبط بالدفعة غير موجود.'; END IF;
    UPDATE public.suppliers
    SET current_balance_in_minor_units = current_balance_in_minor_units + v_payment.amount_in_minor_units,
      updated_at = NOW()
    WHERE id = v_payment.supplier_id;

    v_new_paid := v_purchase_order.amount_paid_in_minor_units - v_payment.amount_in_minor_units;
    UPDATE public.purchase_orders
    SET amount_paid_in_minor_units = v_new_paid, updated_at = NOW()
    WHERE id = v_purchase_order.id;

    v_effect := jsonb_build_object(
      'reference_type', 'purchase_order',
      'reference_id', v_purchase_order.id,
      'purchase_order_amount_paid_after_in_minor_units', v_new_paid,
      'supplier_balance_restored_in_minor_units', v_payment.amount_in_minor_units,
      'cash_in_minor_units', CASE WHEN v_payment.payment_method = 'cash' THEN v_payment.amount_in_minor_units ELSE 0 END,
      'cliq_in_minor_units', CASE WHEN v_payment.payment_method = 'cliq' THEN v_payment.amount_in_minor_units ELSE 0 END
    );
  END IF;

  INSERT INTO public.supplier_payment_reversals (
    supplier_payment_id, cash_shift_id, requested_by, reason, idempotency_key,
    expected_effect, actual_effect
  ) VALUES (
    v_payment.id, v_shift.id, v_user_id, v_reason, v_key, v_effect, v_effect
  ) RETURNING id INTO v_existing.id;

  UPDATE public.supplier_payments
  SET
    is_reversed = true,
    reversed_at = NOW(),
    reversed_by = v_user_id,
    reversal_reason = v_reason
  WHERE id = v_payment.id;

  INSERT INTO public.audit_logs (
    user_id, action, entity_name, entity_id, details
  ) VALUES (
    v_user_id, 'REVERSE_SUPPLIER_PAYMENT', 'supplier_payment_reversals', v_existing.id,
    jsonb_build_object(
      'supplier_payment_id', v_payment.id,
      'cash_shift_id', v_shift.id,
      'reason', v_reason,
      'effect', v_effect
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'idempotent', false,
    'reversal_id', v_existing.id,
    'supplier_payment_id', v_payment.id,
    'cash_shift_id', v_shift.id,
    'actual_effect', v_effect
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_purchase_receipt_v2(
  p_purchase_receipt_id UUID,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_reason TEXT := NULLIF(BTRIM(p_reason), '');
  v_receipt public.purchase_receipts%ROWTYPE;
  v_reversal_operation_id UUID := gen_random_uuid();
  v_result JSONB;
  v_inventory_result JSONB;
  v_payment_total BIGINT;
  v_po_status TEXT;
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'warehouse_keeper'],
    'إلغاء سند استلام أمر شراء'
  );
  PERFORM public.phase2_lock_receipt_payment_shifts_internal(
    NULL, p_purchase_receipt_id
  );
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'سبب إلغاء سند الاستلام مطلوب.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.purchase_receipts receipt
    WHERE receipt.id = p_purchase_receipt_id
      AND receipt.phase2_finalized_at IS NOT NULL
  ) THEN
    PERFORM public.phase2_lock_inventory_products_internal(ARRAY(
      SELECT DISTINCT item.product_id
      FROM public.purchase_receipt_items item
      WHERE item.purchase_receipt_id = p_purchase_receipt_id
      ORDER BY item.product_id
    ));
  END IF;
  SELECT * INTO v_receipt
  FROM public.purchase_receipts receipt
  WHERE receipt.id = p_purchase_receipt_id
  FOR UPDATE;
  IF NOT FOUND OR v_receipt.phase2_finalized_at IS NULL THEN
    RAISE EXCEPTION 'سند الاستلام Phase 2 غير موجود.';
  END IF;
  IF v_receipt.status = 'cancelled' THEN
    SELECT operation.result_snapshot INTO v_result FROM public.business_operations operation
    WHERE operation.operation_type = 'purchase_receipt_cancellation_v2'
      AND operation.result_snapshot->>'original_operation_id' = v_receipt.operation_id::TEXT
      AND operation.result_snapshot->>'supplier_balance_contract_version' = '133'
    ORDER BY operation.completed_at, operation.id LIMIT 1;
    IF FOUND THEN RETURN v_result; END IF;
    RAISE EXCEPTION 'هذا السند ملغى أو معكوس مسبقاً.';
  END IF;
  IF v_receipt.status <> 'completed' THEN
    RAISE EXCEPTION 'هذا السند ملغى أو معكوس مسبقاً.';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.supplier_payments payment
    WHERE payment.purchase_receipt_id = v_receipt.id
      AND NOT payment.is_reversed
      AND payment.operation_id IS DISTINCT FROM v_receipt.operation_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE2_LATER_PAYMENT_CANCELLATION_UNSUPPORTED: لا يمكن إلغاء سند لديه دفعات لاحقة دون سياسة رد أو ائتمان معتمدة.';
  END IF;

  PERFORM 1 FROM public.purchase_orders purchase_order
  WHERE purchase_order.id = v_receipt.purchase_order_id
  FOR UPDATE;
  PERFORM item.id
  FROM public.purchase_order_items item
  JOIN public.purchase_receipt_commercial_lines line
    ON line.purchase_order_item_id = item.id
  WHERE line.purchase_receipt_id = v_receipt.id
  ORDER BY item.id
  FOR UPDATE OF item;

  -- PO-wide payments remain genuine advances after cancelling a receipt.
  -- Only payments owned by this exact receipt are reversed by cancellation.
  SELECT COALESCE(SUM(payment.amount_in_minor_units), 0) INTO v_payment_total
  FROM public.supplier_payments payment
  WHERE payment.purchase_receipt_id = v_receipt.id AND NOT payment.is_reversed;

  -- Capture the complete immutable cancellation result BEFORE its first
  -- insertion. business_operations history is never updated or weakened.
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM public.purchase_order_items item
    LEFT JOIN public.purchase_receipt_commercial_lines line
      ON line.purchase_order_item_id=item.id AND line.purchase_receipt_id=v_receipt.id
    WHERE item.purchase_order_id=v_receipt.purchase_order_id
      AND item.received_quantity-COALESCE(line.received_base_unit_quantity,0)>0
  ) THEN 'partially_received' ELSE 'approved' END INTO v_po_status;
  v_result := jsonb_build_object(
    'success', true,
    'receipt_id', v_receipt.id,
    'receipt_number', v_receipt.receipt_number,
    'original_operation_id', v_receipt.operation_id,
    'reversal_operation_id', v_reversal_operation_id,
    'payments_marked_reversed_in_minor_units', v_payment_total,
    'purchase_order_status', v_po_status,
    'supplier_balance_contract_version', 133,
    'reversed_base_units', (SELECT COALESCE(SUM(movement.quantity),0)::INTEGER
      FROM public.inventory_movements movement WHERE movement.operation_id=v_receipt.operation_id
        AND movement.movement_type='purchase_receipt')
  );
  INSERT INTO public.business_operations (
    id, operation_type, initiated_by, result_snapshot, completed_at
  ) VALUES (
    v_reversal_operation_id, 'purchase_receipt_cancellation_v2',
    v_user_id, v_result, NOW()
  );

  v_inventory_result := public.phase2_reverse_inventory_and_wac_internal(
    v_receipt.operation_id, v_reversal_operation_id, v_receipt.warehouse_id,
    'purchase_receipt', v_receipt.id, v_user_id, v_reason
  );

  UPDATE public.purchase_order_items item
  SET
    received_quantity = item.received_quantity - line.received_base_unit_quantity,
    received_parcel_quantity = item.received_parcel_quantity
      - COALESCE(line.received_parcel_quantity, 0),
    updated_at = NOW()
  FROM public.purchase_receipt_commercial_lines line
  WHERE line.purchase_receipt_id = v_receipt.id
    AND item.id = line.purchase_order_item_id;

  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM public.purchase_order_items item
      WHERE item.purchase_order_id = v_receipt.purchase_order_id
        AND item.received_quantity > 0
    ) THEN 'partially_received'
    ELSE 'approved'
  END INTO v_po_status;
  UPDATE public.purchase_orders
  SET status = v_po_status, received_at = NULL,
    amount_paid_in_minor_units = amount_paid_in_minor_units - v_payment_total,
    updated_at = NOW()
  WHERE id = v_receipt.purchase_order_id;

  UPDATE public.suppliers
  SET current_balance_in_minor_units = current_balance_in_minor_units
      - v_receipt.supplier_invoice_payable_total_snapshot_in_minor_units + v_payment_total,
    updated_at = NOW()
  WHERE id = v_receipt.supplier_id;

  -- v_payment_total was captured under the original document/shift locks.
  UPDATE public.supplier_payments
  SET is_reversed = true, reversed_at = NOW(), reversed_by = v_user_id,
    reversal_reason = v_reason
  WHERE purchase_receipt_id = v_receipt.id AND NOT is_reversed;
  UPDATE public.supplier_financial_invoice_identities
  SET is_active = false, cancelled_at = NOW()
  WHERE purchase_receipt_id = v_receipt.id AND is_active;
  UPDATE public.purchase_receipts
  SET status = 'cancelled', phase2_cancelled_at = NOW(),
    phase2_cancelled_by = v_user_id,
    phase2_cancellation_reason = v_reason
  WHERE id = v_receipt.id;

  INSERT INTO public.audit_logs (
    user_id, action, entity_name, entity_id, details
  ) VALUES (
    v_user_id, 'CANCEL_PURCHASE_RECEIPT_V2', 'purchase_receipts',
    v_receipt.id,
    jsonb_build_object(
      'original_operation_id', v_receipt.operation_id,
      'reversal_operation_id', v_reversal_operation_id,
      'supplier_outstanding_reversed_in_minor_units',
        v_receipt.supplier_invoice_payable_total_snapshot_in_minor_units - v_payment_total,
      'payments_marked_reversed_in_minor_units', v_payment_total,
      'purchase_order_status', v_po_status,
      'inventory', v_inventory_result
    )
  );
  IF v_inventory_result->>'reversed_base_units' IS DISTINCT FROM v_result->>'reversed_base_units'
    OR v_po_status IS DISTINCT FROM v_result->>'purchase_order_status'
  THEN RAISE EXCEPTION 'SUPPLIER_CANCELLATION_RESULT_MISMATCH'; END IF;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.run_advanced_monitoring_checks(
  p_observed_at TIMESTAMPTZ DEFAULT NOW()
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, auth, cron, pg_temp
AS $$
DECLARE
  v_settings public.advanced_monitoring_settings%ROWTYPE;
  v_count INTEGER;
  v_total_integrity INTEGER := 0;
  v_previous_size BIGINT;
  v_current_size BIGINT;
  v_growth BIGINT := 0;
  v_connection_percent NUMERIC := 0;
  v_slow_count INTEGER := 0;
  v_auth_entries INTEGER := 0;
  v_status TEXT;
  v_result JSONB;
  v_entity UUID := '00000000-0000-0000-0000-000000000099'::UUID;
BEGIN
  IF p_observed_at IS NULL THEN RAISE EXCEPTION 'Monitoring observation time is required.'; END IF;
  PERFORM set_config('lock_timeout','2s',true);
  PERFORM set_config('statement_timeout','90s',true);
  SELECT * INTO STRICT v_settings FROM public.advanced_monitoring_settings WHERE id=true;
  UPDATE public.advanced_monitoring_metrics SET last_scan_started_at=p_observed_at,
    last_error_code=NULL,updated_at=p_observed_at WHERE id=true;

  SELECT count(*) INTO v_count FROM public.inventory_balances
  WHERE on_hand_quantity<0 OR reserved_quantity<0
    OR available_quantity<>on_hand_quantity-reserved_quantity;
  v_total_integrity := v_total_integrity + v_count;
  PERFORM public._set_advanced_monitoring_check('integrity:inventory:balances','inventory','database',
    CASE WHEN v_count=0 THEN 'healthy' ELSE 'critical' END,'critical',v_count,
    'سلامة أرصدة المخزون',jsonb_build_object('mismatchCount',v_count),p_observed_at);

  SELECT count(*) INTO v_count FROM public.inventory_movements
  WHERE balance_before+quantity<>balance_after;
  v_total_integrity := v_total_integrity + v_count;
  PERFORM public._set_advanced_monitoring_check('integrity:inventory:movement-arithmetic','inventory','database',
    CASE WHEN v_count=0 THEN 'healthy' ELSE 'critical' END,'critical',v_count,
    'معادلة حركات المخزون',jsonb_build_object('mismatchCount',v_count),p_observed_at);

  WITH last_move AS (
    SELECT DISTINCT ON(product_id,warehouse_id) product_id,warehouse_id,balance_after
    FROM public.inventory_movements ORDER BY product_id,warehouse_id,created_at DESC,id DESC
  ) SELECT count(*) INTO v_count FROM last_move l
    LEFT JOIN public.inventory_balances b USING(product_id,warehouse_id)
    WHERE b.id IS NULL OR b.on_hand_quantity<>l.balance_after;
  v_total_integrity := v_total_integrity + v_count;
  PERFORM public._set_advanced_monitoring_check('integrity:inventory:movement-ledger','inventory','database',
    CASE WHEN v_count=0 THEN 'healthy' ELSE 'critical' END,'critical',v_count,
    'تطابق رصيد آخر حركة',jsonb_build_object('mismatchCount',v_count),p_observed_at);

  SELECT count(*) INTO v_count FROM public.inventory_movements m
  LEFT JOIN public.products p ON p.id=m.product_id
  LEFT JOIN public.warehouses w ON w.id=m.warehouse_id
  WHERE p.id IS NULL OR w.id IS NULL;
  v_total_integrity := v_total_integrity + v_count;
  PERFORM public._set_advanced_monitoring_check('integrity:inventory:references','inventory','database',
    CASE WHEN v_count=0 THEN 'healthy' ELSE 'critical' END,'critical',v_count,
    'مراجع حركات المخزون',jsonb_build_object('orphanCount',v_count),p_observed_at);

  WITH reservation_sources AS (
    SELECT
      o.warehouse_id,
      oi.product_id,
      SUM(oi.quantity)::BIGINT AS qty
    FROM public.orders o
    JOIN public.order_items oi ON oi.order_id = o.id
    WHERE o.source = 'website'
      AND o.status IN ('new','confirmed','preparing','ready','out_for_delivery')
      AND o.reservation_released_at IS NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.order_inventory_reservations reservation
        WHERE reservation.order_id = o.id
      )
    GROUP BY o.warehouse_id, oi.product_id
    UNION ALL
    SELECT
      reservation.warehouse_id,
      reservation.product_id,
      SUM(reservation.reserved_quantity)::BIGINT AS qty
    FROM public.order_inventory_reservations reservation
    JOIN public.orders o ON o.id = reservation.order_id
    WHERE reservation.reservation_state = 'active'
      AND o.source = 'website'
      AND o.status IN ('new','confirmed','preparing','ready','out_for_delivery')
      AND o.reservation_released_at IS NULL
    GROUP BY reservation.warehouse_id, reservation.product_id
  ), expected AS (
    SELECT warehouse_id, product_id, SUM(qty)::BIGINT AS qty
    FROM reservation_sources
    GROUP BY warehouse_id, product_id
  ), actual AS (
    SELECT warehouse_id,product_id,reserved_quantity::BIGINT qty FROM public.inventory_balances
    WHERE reserved_quantity<>0
  ) SELECT count(*) INTO v_count FROM expected e FULL JOIN actual a USING(warehouse_id,product_id)
    WHERE COALESCE(e.qty,0)<>COALESCE(a.qty,0);
  v_total_integrity := v_total_integrity + v_count;
  PERFORM public._set_advanced_monitoring_check('integrity:orders:reservations','orders','database',
    CASE WHEN v_count=0 THEN 'healthy' ELSE 'critical' END,'critical',v_count,
    'تطابق حجوزات طلبات الموقع',jsonb_build_object('mismatchCount',v_count),p_observed_at);

  WITH expected_sources AS (
    SELECT
      o.id,
      o.warehouse_id,
      oi.product_id,
      SUM(oi.quantity)::BIGINT AS qty
    FROM public.orders o
    JOIN public.order_items oi ON oi.order_id = o.id
    WHERE o.status IN ('completed','returned')
      AND COALESCE(oi.commercial_line_kind, 'base_unit') <> 'configurable_parcel'
    GROUP BY o.id, o.warehouse_id, oi.product_id
    UNION ALL
    SELECT
      o.id,
      o.warehouse_id,
      component.product_id,
      SUM(component.base_quantity)::BIGINT AS qty
    FROM public.orders o
    JOIN public.order_parcel_instances instance ON instance.order_id = o.id
    JOIN public.order_parcel_components component
      ON component.parcel_instance_id = instance.id
    WHERE o.status IN ('completed','returned')
    GROUP BY o.id, o.warehouse_id, component.product_id
  ), expected AS (
    SELECT id, warehouse_id, product_id, SUM(qty)::BIGINT AS qty
    FROM expected_sources
    GROUP BY id, warehouse_id, product_id
  ), actual AS (
    SELECT movement.reference_id AS id,movement.warehouse_id,movement.product_id,
      (-sum(movement.quantity))::BIGINT qty
    FROM public.inventory_movements movement
    JOIN public.orders moved_order ON moved_order.id = movement.reference_id
      AND moved_order.status IN ('completed','returned')
    WHERE movement.movement_type='sales_deduction'
      AND movement.reference_type IN ('order','pos_sale','customer_order')
    GROUP BY movement.reference_id,movement.warehouse_id,movement.product_id
  ) SELECT count(*) INTO v_count FROM expected e FULL JOIN actual a USING(id,warehouse_id,product_id)
    WHERE COALESCE(e.qty,0)<>COALESCE(a.qty,0);
  v_total_integrity := v_total_integrity + v_count;
  PERFORM public._set_advanced_monitoring_check('integrity:orders:stock-deductions','orders','database',
    CASE WHEN v_count=0 THEN 'healthy' ELSE 'critical' END,'critical',v_count,
    'خصم مخزون الطلبات المكتملة',jsonb_build_object('mismatchCount',v_count),p_observed_at);

  -- Reconcile the net stock effect for the complete supplier-receipt lifecycle.
  -- A cancelled receipt intentionally keeps its original purchase movement and
  -- appends an exact return_out reversal under supplier_receipt_cancellation.
  WITH expected AS (
    SELECT
      sr.id,
      sr.warehouse_id,
      sri.product_id,
      CASE
        WHEN sr.status = 'completed' THEN sum(sri.total_base_units)::BIGINT
        WHEN sr.status = 'cancelled' THEN 0::BIGINT
      END AS qty
    FROM public.supplier_receipts sr
    JOIN public.supplier_receipt_items sri ON sri.supplier_receipt_id = sr.id
    WHERE sr.status IN ('completed', 'cancelled')
    GROUP BY sr.id, sr.status, sr.warehouse_id, sri.product_id
  ), actual AS (
    SELECT
      reference_id AS id,
      warehouse_id,
      product_id,
      sum(quantity)::BIGINT AS qty
    FROM public.inventory_movements
    WHERE
      (reference_type = 'supplier_receipt' AND movement_type = 'purchase_receipt')
      OR
      (reference_type = 'supplier_receipt_cancellation' AND movement_type = 'return_out')
    GROUP BY reference_id, warehouse_id, product_id
  )
  SELECT count(*) INTO v_count
  FROM expected e
  FULL JOIN actual a USING(id, warehouse_id, product_id)
  WHERE COALESCE(e.qty, 0) <> COALESCE(a.qty, 0);
  v_total_integrity := v_total_integrity + v_count;
  PERFORM public._set_advanced_monitoring_check('integrity:inventory:receiving','inventory','database',
    CASE WHEN v_count=0 THEN 'healthy' ELSE 'critical' END,'critical',v_count,
    'تطابق حركات استلام الموردين',jsonb_build_object('mismatchCount',v_count),p_observed_at);

  SELECT count(*) INTO v_count
  FROM public.order_items item
  JOIN public.orders customer_order ON customer_order.id = item.order_id
  LEFT JOIN public.business_operations operation
    ON operation.id = customer_order.operation_id
  WHERE CASE
    WHEN operation.operation_type = 'phase3_customer_reservation_v1'
      AND customer_order.status NOT IN ('completed','returned')
    THEN customer_order.cost_finalized_at IS NOT NULL
      OR item.cost_finalized_at IS NOT NULL
      OR item.exact_cogs_snapshot_in_minor_units IS NOT NULL
      OR item.cogs_in_minor_units <> 0
      OR item.profit_in_minor_units <> 0
    WHEN operation.operation_type = 'phase3_customer_reservation_v1'
    THEN customer_order.cost_finalized_at IS NULL
      OR item.cost_finalized_at IS NULL
      OR item.exact_cogs_snapshot_in_minor_units IS NULL
      OR (
        item.commercial_line_kind = 'configurable_parcel'
        AND (
          item.cogs_in_minor_units IS DISTINCT FROM (
            SELECT COALESCE(SUM(instance.cogs_snapshot_in_minor_units), 0)::BIGINT
            FROM public.order_parcel_instances instance
            WHERE instance.order_item_id = item.id
          )
          OR item.exact_cogs_snapshot_in_minor_units IS DISTINCT FROM (
            SELECT COALESCE(SUM(instance.exact_cogs_snapshot_in_minor_units), 0)::NUMERIC(30,6)
            FROM public.order_parcel_instances instance
            WHERE instance.order_item_id = item.id
          )
          OR EXISTS (
            SELECT 1
            FROM public.order_parcel_instances instance
            WHERE instance.order_item_id = item.id
              AND (
                instance.cost_finalized_at IS NULL
                OR instance.exact_cogs_snapshot_in_minor_units IS NULL
                OR instance.cogs_snapshot_in_minor_units IS DISTINCT FROM
                  ROUND(instance.exact_cogs_snapshot_in_minor_units, 0)::BIGINT
                OR instance.cogs_snapshot_in_minor_units IS DISTINCT FROM (
                  SELECT COALESCE(SUM(component.cogs_snapshot_in_minor_units), 0)::BIGINT
                  FROM public.order_parcel_components component
                  WHERE component.parcel_instance_id = instance.id
                )
                OR instance.exact_cogs_snapshot_in_minor_units IS DISTINCT FROM (
                  SELECT COALESCE(SUM(component.exact_cogs_snapshot_in_minor_units), 0)::NUMERIC(30,6)
                  FROM public.order_parcel_components component
                  WHERE component.parcel_instance_id = instance.id
                )
                OR EXISTS (
                  SELECT 1
                  FROM public.order_parcel_components component
                  WHERE component.parcel_instance_id = instance.id
                    AND (
                      component.cost_finalized_at IS NULL
                      OR component.exact_cogs_snapshot_in_minor_units IS NULL
                    )
                )
              )
          )
        )
      )
      OR (
        item.commercial_line_kind <> 'configurable_parcel'
        AND item.cogs_in_minor_units IS DISTINCT FROM
          ROUND(item.exact_cogs_snapshot_in_minor_units, 0)::BIGINT
      )
      OR item.profit_in_minor_units <>
        item.net_refundable_amount_snapshot_in_minor_units - item.cogs_in_minor_units
    WHEN operation.operation_type = 'phase3_pos_sale_v1'
    THEN item.cogs_in_minor_units < 0
      OR item.profit_in_minor_units <>
        item.net_refundable_amount_snapshot_in_minor_units - item.cogs_in_minor_units
    ELSE item.cogs_in_minor_units <> item.unit_cost_in_minor_units * item.quantity
      OR item.profit_in_minor_units <> item.line_total_in_minor_units - item.cogs_in_minor_units
  END;
  v_total_integrity := v_total_integrity + v_count;
  PERFORM public._set_advanced_monitoring_check('integrity:accounting:cogs-profit','accounting','database',
    CASE WHEN v_count=0 THEN 'healthy' ELSE 'critical' END,'critical',v_count,
    'تطابق تكلفة وربح بنود الطلب',jsonb_build_object('mismatchCount',v_count),p_observed_at);

  SELECT count(*) INTO v_count FROM (
    SELECT id FROM public.customer_payments WHERE is_reversed AND
      (reversed_at IS NULL OR reversed_by IS NULL OR NULLIF(TRIM(reversal_reason),'') IS NULL)
    UNION ALL
    SELECT id FROM public.supplier_payments WHERE is_reversed AND
      (reversed_at IS NULL OR reversed_by IS NULL OR NULLIF(TRIM(reversal_reason),'') IS NULL)
    UNION ALL
    SELECT id FROM public.operational_expenses WHERE is_reversed AND
      (reversed_at IS NULL OR reversed_by IS NULL OR NULLIF(TRIM(reversal_reason),'') IS NULL)
  ) x;
  v_total_integrity := v_total_integrity + v_count;
  PERFORM public._set_advanced_monitoring_check('integrity:accounting:reversals','accounting','database',
    CASE WHEN v_count=0 THEN 'healthy' ELSE 'critical' END,'critical',v_count,
    'اكتمال بيانات العكوسات المالية',jsonb_build_object('mismatchCount',v_count),p_observed_at);

  -- Independent committed evidence, not mutable PO totals or supplier balance.
  WITH received AS (
    SELECT supplier_id, total_in_minor_units::BIGINT AS amount
    FROM public.supplier_receipts WHERE status='completed'
    UNION ALL
    SELECT po.supplier_id,
      CASE WHEN receipt.phase2_finalized_at IS NOT NULL
        THEN receipt.supplier_invoice_payable_total_snapshot_in_minor_units
        ELSE (SELECT COALESCE(SUM(item.received_quantity::NUMERIC * item.unit_cost_in_minor_units),0)::BIGINT
          FROM public.purchase_receipt_items item WHERE item.purchase_receipt_id=receipt.id)
      END AS amount
    FROM public.purchase_receipts receipt JOIN public.purchase_orders po ON po.id=receipt.purchase_order_id
    WHERE receipt.status='completed'
  ), received_totals AS (
    SELECT supplier_id, SUM(amount)::BIGINT AS total FROM received GROUP BY supplier_id
  ), paid_totals AS (
    SELECT supplier_id, SUM(amount_in_minor_units)::BIGINT AS total
    FROM public.supplier_payments WHERE NOT is_reversed GROUP BY supplier_id
  ) SELECT count(*) INTO v_count FROM public.suppliers supplier
    LEFT JOIN received_totals received ON received.supplier_id=supplier.id
    LEFT JOIN paid_totals paid ON paid.supplier_id=supplier.id
    WHERE supplier.current_balance_in_minor_units<>COALESCE(received.total,0)-COALESCE(paid.total,0);
  v_total_integrity := v_total_integrity + v_count;
  PERFORM public._set_advanced_monitoring_check('integrity:accounting:supplier-balances','accounting','database',
    CASE WHEN v_count=0 THEN 'healthy' ELSE 'critical' END,'critical',v_count,
    'تطابق ذمم الموردين',jsonb_build_object('mismatchCount',v_count),p_observed_at);

  SELECT count(*) INTO v_count FROM public.cash_shifts
  WHERE (status<>'open' AND expected_cash_in_minor_units<>(opening_cash_in_minor_units+cash_sales_in_minor_units+
    cash_receipts_in_minor_units-cash_supplier_payments_in_minor_units-
    cash_expenses_in_minor_units-cash_refunds_in_minor_units))
    OR (status='closed' AND cash_discrepancy_in_minor_units<>
      actual_cash_in_minor_units-expected_cash_in_minor_units)
    OR (closing_report_snapshot IS NOT NULL AND
      (closing_report_snapshotted_at IS NULL OR closing_report_snapshot_version<>1));
  v_total_integrity := v_total_integrity + v_count;
  PERFORM public._set_advanced_monitoring_check('integrity:shifts:closing','shifts','database',
    CASE WHEN v_count=0 THEN 'healthy' ELSE 'critical' END,'critical',v_count,
    'تطابق إغلاق الوردية وCash/CliQ',jsonb_build_object('mismatchCount',v_count),p_observed_at);

  SELECT count(*) INTO v_count FROM public.cash_shifts
  WHERE status='closed' AND closed_at>=v_settings.monitoring_activated_at
    AND closing_report_snapshot IS NULL;
  v_total_integrity := v_total_integrity + v_count;
  PERFORM public._set_advanced_monitoring_check('integrity:shifts:snapshot','shifts','database',
    CASE WHEN v_count=0 THEN 'healthy' ELSE 'critical' END,'critical',v_count,
    'وجود لقطة إغلاق للورديات الجديدة',jsonb_build_object('missingCount',v_count),p_observed_at);

  SELECT count(*) INTO v_count FROM public.automation_event_deliveries d
  LEFT JOIN public.automation_events e ON e.id=d.event_id
  WHERE e.id IS NULL OR (d.status='processing' AND d.lease_expires_at<=p_observed_at)
    OR d.status='dead_letter' OR (d.status<>'delivered' AND d.attempt_count>=10);
  v_total_integrity := v_total_integrity + v_count;
  PERFORM public._set_advanced_monitoring_check('integrity:automation:outbox','automation','database',
    CASE WHEN v_count=0 THEN 'healthy' ELSE 'critical' END,'high',v_count,
    'سلامة Business automation outbox',jsonb_build_object('issueCount',v_count),p_observed_at);

  SELECT round(100.0*count(*)/GREATEST(current_setting('max_connections')::INTEGER,1),2)
    INTO v_connection_percent FROM pg_stat_activity;
  v_status := CASE WHEN v_connection_percent>=v_settings.connection_critical_percent THEN 'critical'
    WHEN v_connection_percent>=v_settings.connection_warning_percent THEN 'warning' ELSE 'healthy' END;
  PERFORM public._set_advanced_monitoring_check('performance:database:connections','database','database',
    v_status,'high',CASE WHEN v_status='healthy' THEN 0 ELSE 1 END,
    'استخدام اتصالات قاعدة البيانات',jsonb_build_object('usedPercent',v_connection_percent),p_observed_at);

  SELECT count(*) INTO v_slow_count FROM extensions.pg_stat_statements
  WHERE calls>=v_settings.slow_rpc_min_calls
    AND query ~ '"public"\."[a-zA-Z0-9_]+"'
    AND (mean_exec_time>=v_settings.slow_rpc_mean_ms OR max_exec_time>=v_settings.slow_rpc_max_ms);
  PERFORM public._set_advanced_monitoring_check('performance:database:rpcs','performance','database',
    CASE WHEN v_slow_count=0 THEN 'healthy' ELSE 'warning' END,'medium',v_slow_count,
    'أداء RPCs العامة',jsonb_build_object('slowFunctionCount',v_slow_count,
      'meanThresholdMs',v_settings.slow_rpc_mean_ms,'maxThresholdMs',v_settings.slow_rpc_max_ms),p_observed_at);

  PERFORM public._set_advanced_monitoring_check('performance:database:query-errors','performance','database',
    'unknown','medium',0,'معدل أخطاء الاستعلامات غير متاح من telemetry الحالية',
    jsonb_build_object('reason','no-safe-error-rate-source'),p_observed_at);

  SELECT pg_database_size(current_database()) INTO v_current_size;
  SELECT last_database_size_bytes INTO v_previous_size FROM public.advanced_monitoring_metrics WHERE id=true;
  v_growth := GREATEST(v_current_size-COALESCE(v_previous_size,v_current_size),0);
  v_status := CASE WHEN v_previous_size IS NOT NULL
    AND v_growth>=v_settings.database_growth_min_bytes
    AND (100.0*v_growth/GREATEST(v_previous_size,1))>=v_settings.database_growth_warning_percent
    THEN 'warning' ELSE 'healthy' END;
  PERFORM public._set_advanced_monitoring_check('performance:database:growth','performance','database',
    v_status,'medium',CASE WHEN v_status='healthy' THEN 0 ELSE 1 END,
    'نمو حجم قاعدة البيانات',jsonb_build_object('databaseBytes',v_current_size,'growthBytes',v_growth),p_observed_at);

  SELECT count(*) INTO v_count FROM (VALUES
    ('expire-stale-new-website-orders'),('cleanup-guest-order-gateway-requests'),
    ('scan-core-business-alerts'),('scan-business-summaries'),('run-advanced-monitoring')
  ) expected(jobname) LEFT JOIN cron.job j USING(jobname)
  WHERE j.jobid IS NULL OR NOT j.active;
  v_count := v_count+(SELECT count(*) FROM cron.job_run_details d JOIN cron.job j ON j.jobid=d.jobid
    WHERE j.jobname IN ('expire-stale-new-website-orders','cleanup-guest-order-gateway-requests','scan-core-business-alerts','scan-business-summaries')
      AND d.start_time>=p_observed_at-interval '30 minutes' AND d.status<>'succeeded');
  PERFORM public._set_advanced_monitoring_check('database:cron:health','database','database',
    CASE WHEN v_count=0 THEN 'healthy' ELSE 'critical' END,'high',v_count,
    'حالة مهام Supabase cron',jsonb_build_object('issueCount',v_count),p_observed_at);

  SELECT count(*) INTO v_count FROM public.guest_order_gateway_requests
  WHERE created_at>=p_observed_at-interval '15 minutes' AND decision='rate_limited';
  v_count := CASE WHEN v_count>=v_settings.gateway_rate_limit_warning_count THEN v_count ELSE 0 END;
  PERFORM public._set_advanced_monitoring_check('security:gateway:rate-limit','security','database',
    CASE WHEN v_count=0 THEN 'healthy' ELSE 'warning' END,'medium',v_count,
    'سلوك Rate Limit لبوابة الطلبات',jsonb_build_object('limitedRequestCount',v_count),p_observed_at);

  SELECT count(*) INTO v_count FROM public.guest_order_gateway_requests
  WHERE created_at>=p_observed_at-interval '15 minutes' AND outcome='gateway_error';
  v_count := CASE WHEN v_count>=v_settings.gateway_error_warning_count THEN v_count ELSE 0 END;
  PERFORM public._set_advanced_monitoring_check('security:gateway:errors','security','database',
    CASE WHEN v_count=0 THEN 'healthy' ELSE 'warning' END,'high',v_count,
    'أخطاء بوابة الطلبات',jsonb_build_object('gatewayErrorCount',v_count),p_observed_at);

  SELECT count(*) INTO v_auth_entries FROM auth.audit_log_entries
  WHERE created_at>=p_observed_at-interval '15 minutes';
  SELECT count(*) INTO v_count FROM auth.audit_log_entries
  WHERE created_at>=p_observed_at-interval '15 minutes'
    AND payload::TEXT ~* 'error|failed|forbidden|unauthorized';
  PERFORM public._set_advanced_monitoring_check('security:auth:audit','security','database',
    CASE WHEN v_auth_entries=0 THEN 'unknown' WHEN v_count>=5 THEN 'warning' ELSE 'healthy' END,
    'medium',CASE WHEN v_count>=5 THEN v_count ELSE 0 END,
    'مؤشرات Auth audit المخزنة',jsonb_build_object('recentEntryCount',v_auth_entries,
      'anomalyCount',CASE WHEN v_count>=5 THEN v_count ELSE 0 END),p_observed_at);

  SELECT count(*) INTO v_count FROM public.advanced_monitoring_runtime_incidents
  WHERE resolved_at IS NULL AND last_seen_at>=p_observed_at-
    make_interval(mins=>v_settings.runtime_incident_window_minutes);
  PERFORM public._set_advanced_monitoring_check('runtime:admin:errors','runtime','database',
    CASE WHEN v_count=0 THEN 'healthy' ELSE 'critical' END,'high',v_count,
    'أخطاء تشغيل Admin الحرجة',jsonb_build_object('activeFingerprintCount',v_count),p_observed_at);
  UPDATE public.advanced_monitoring_runtime_incidents SET resolved_at=p_observed_at,updated_at=p_observed_at
  WHERE resolved_at IS NULL AND last_seen_at<p_observed_at-
    make_interval(mins=>v_settings.runtime_incident_window_minutes);

  PERFORM public._transition_business_alert_incident(
    'business-integrity:system','business_integrity_warning',v_entity,
    v_total_integrity>0,p_observed_at,
    jsonb_build_object('issueCount',v_total_integrity,
      'message','توجد مشكلة اتساق تحتاج مراجعة الإدارة التقنية.','dashboard','monitoring'),true);

  UPDATE public.advanced_monitoring_metrics SET
    last_scan_completed_at=p_observed_at,last_database_size_bytes=v_current_size,
    last_database_size_observed_at=p_observed_at,last_error_code=NULL,
    updated_at=p_observed_at WHERE id=true;

  SELECT jsonb_build_object('ok',true,'checkedAt',p_observed_at,
    'checkCount',count(*),'openIssueCount',count(*) FILTER(WHERE status IN ('warning','critical')),
    'integrityIssueCount',v_total_integrity) INTO v_result
  FROM public.advanced_monitoring_checks WHERE source='database';
  RETURN v_result;
EXCEPTION WHEN OTHERS THEN
  UPDATE public.advanced_monitoring_metrics SET last_error_code=COALESCE(SQLSTATE,'UNKNOWN'),
    updated_at=NOW() WHERE id=true;
  RAISE;
END;
$$;

CREATE OR REPLACE FUNCTION public._record_supplier_receipt_payment_impl(
  p_receipt_id UUID,
  p_amount_in_minor_units BIGINT,
  p_payment_method TEXT DEFAULT 'cash',
  p_reference_number TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_supplier_id UUID;
  v_receipt_number TEXT;
  v_status TEXT;
  v_total BIGINT;
  v_old_paid BIGINT;
  v_old_due BIGINT;
  v_new_paid BIGINT;
  v_new_due BIGINT;
  v_new_payment_status TEXT;
  v_payment_id UUID;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول لتسجيل دفعة مورد.';
  END IF;
  IF p_amount_in_minor_units IS NULL OR p_amount_in_minor_units <= 0 THEN
    RAISE EXCEPTION 'مبلغ الدفعة يجب أن يكون أكبر من صفر.';
  END IF;
  IF COALESCE(p_payment_method, 'cash') NOT IN (
    'cash', 'bank', 'cliq', 'transfer'
  ) THEN
    RAISE EXCEPTION 'طريقة الدفع غير مدعومة.';
  END IF;

  SELECT
    supplier_id,
    receipt_number,
    status,
    total_in_minor_units,
    amount_paid_in_minor_units,
    amount_due_in_minor_units
  INTO
    v_supplier_id,
    v_receipt_number,
    v_status,
    v_total,
    v_old_paid,
    v_old_due
  FROM public.supplier_receipts
  WHERE id = p_receipt_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'سند الاستلام غير موجود.';
  END IF;
  IF v_status <> 'completed' THEN
    RAISE EXCEPTION 'لا يمكن تسجيل دفعة على سند غير مكتمل.';
  END IF;
  IF p_amount_in_minor_units > v_old_due THEN
    RAISE EXCEPTION 'مبلغ الدفعة يتجاوز المبلغ المتبقي.';
  END IF;

  v_new_paid := v_old_paid + p_amount_in_minor_units;
  v_new_due := v_total - v_new_paid;
  v_new_payment_status := CASE
    WHEN v_new_due = 0 THEN 'paid'
    ELSE 'partially_paid'
  END;

  UPDATE public.supplier_receipts
  SET
    amount_paid_in_minor_units = v_new_paid,
    amount_due_in_minor_units = v_new_due,
    payment_status = v_new_payment_status,
    updated_at = NOW()
  WHERE id = p_receipt_id;

  UPDATE public.suppliers
  SET
    current_balance_in_minor_units =
      current_balance_in_minor_units - p_amount_in_minor_units,
    updated_at = NOW()
  WHERE id = v_supplier_id;

  INSERT INTO public.supplier_payments (
    supplier_id,
    supplier_receipt_id,
    amount_in_minor_units,
    payment_method,
    reference_number,
    payment_date,
    notes,
    created_by
  ) VALUES (
    v_supplier_id,
    p_receipt_id,
    p_amount_in_minor_units,
    COALESCE(p_payment_method, 'cash'),
    NULLIF(TRIM(p_reference_number), ''),
    NOW(),
    COALESCE(p_notes, 'دفعة على سند ' || v_receipt_number),
    v_user_id
  )
  RETURNING id INTO v_payment_id;

  INSERT INTO public.audit_logs (
    user_id,
    action,
    entity_name,
    entity_id,
    details
  ) VALUES (
    v_user_id,
    'RECORD_SUPPLIER_RECEIPT_PAYMENT',
    'supplier_receipts',
    p_receipt_id,
    jsonb_build_object(
      'payment_id', v_payment_id,
      'amount', p_amount_in_minor_units,
      'remaining_due', v_new_due
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'payment_id', v_payment_id,
    'total_paid', v_new_paid,
    'amount_due', v_new_due,
    'payment_status', v_new_payment_status
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.receive_purchase_order(
  p_purchase_order_id UUID,
  p_warehouse_id UUID DEFAULT NULL,
  p_supplier_delivery_note TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_items JSONB DEFAULT '[]'::JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_product_ids UUID[];
  v_baselines JSONB;
  v_result JSONB;
  v_acquisition RECORD;
  v_baseline JSONB;
  v_opening_quantity INTEGER;
  v_prior_exact NUMERIC(24, 6);
  v_new_exact NUMERIC(24, 6);
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'warehouse_keeper'],
    'استلام أوامر الشراء'
  );

  -- Keep payload product_id UUID validation, but trust the PO item product.
  PERFORM (item->>'product_id')::UUID
  FROM jsonb_array_elements(COALESCE(p_items, '[]'::JSONB)) item;

  -- The current UI sends an explicit non-negative receipt unit cost, and the
  -- stored receipt schema treats zero as a real cost. Missing/NULL is not proof
  -- of free inventory. Validate before the legacy implementation writes rows.
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(p_items, '[]'::JSONB)) item
    WHERE COALESCE((item->>'received_quantity')::INTEGER, 0) > 0
      AND (NOT item ? 'unit_cost_in_minor_units'
        OR item->>'unit_cost_in_minor_units' IS NULL)
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = 'PHASE2_LEGACY_COST_REQUIRED: يجب تحديد تكلفة الاستلام صراحةً.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(p_items, '[]'::JSONB)) item
    WHERE COALESCE((item->>'received_quantity')::INTEGER, 0) > 0
      AND CASE
        WHEN item->>'unit_cost_in_minor_units' ~ '^[0-9]+$' THEN
          (item->>'unit_cost_in_minor_units')::NUMERIC > 9223372036854775807::NUMERIC
        ELSE true
      END
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = 'PHASE2_LEGACY_COST_INVALID: تكلفة الاستلام يجب أن تكون عددًا صحيحًا غير سالب ضمن الحد المدعوم.';
  END IF;

  SELECT ARRAY_AGG(product_id ORDER BY product_id)
  INTO v_product_ids
  FROM (
    SELECT DISTINCT po_item.product_id
    FROM jsonb_array_elements(COALESCE(p_items, '[]'::JSONB)) item
    JOIN public.purchase_order_items po_item
      ON po_item.id = (item->>'purchase_order_item_id')::UUID
     AND po_item.purchase_order_id = p_purchase_order_id
  ) products;

  PERFORM public.phase2_lock_inventory_products_internal(v_product_ids);

  SELECT jsonb_object_agg(
    product.id::TEXT,
    jsonb_build_object(
      'opening_quantity', COALESCE((
        SELECT SUM(balance.on_hand_quantity)
        FROM public.inventory_balances balance
        WHERE balance.product_id = product.id
      ), 0),
      'prior_exact', COALESCE(
        product.wac_cost_in_minor_units_exact,
        product.cost_price_in_minor_units::NUMERIC
      )
    )
  )
  INTO v_baselines
  FROM public.products product
  WHERE product.id = ANY(v_product_ids);

  v_result := public._receive_purchase_order_impl(
    p_purchase_order_id,
    p_warehouse_id,
    p_supplier_delivery_note,
    p_notes,
    p_items
  );

  FOR v_acquisition IN
    SELECT
      po_item.product_id,
      SUM((item->>'received_quantity')::INTEGER)::INTEGER AS received_quantity,
      SUM(
        (item->>'received_quantity')::NUMERIC
        * (item->>'unit_cost_in_minor_units')::NUMERIC
      ) AS received_cost
    FROM jsonb_array_elements(p_items) item
    JOIN public.purchase_order_items po_item
      ON po_item.id = (item->>'purchase_order_item_id')::UUID
     AND po_item.purchase_order_id = p_purchase_order_id
    WHERE (item->>'received_quantity')::INTEGER > 0
    GROUP BY po_item.product_id
    ORDER BY po_item.product_id
  LOOP
    v_baseline := v_baselines -> (v_acquisition.product_id::TEXT);
    v_opening_quantity := (v_baseline->>'opening_quantity')::INTEGER;
    v_prior_exact := (v_baseline->>'prior_exact')::NUMERIC(24, 6);
    v_new_exact := CASE
      WHEN v_opening_quantity <= 0 THEN
        ROUND(v_acquisition.received_cost / v_acquisition.received_quantity, 6)
      ELSE
        ROUND(
          (
            v_opening_quantity::NUMERIC * v_prior_exact
            + v_acquisition.received_cost
          ) / (v_opening_quantity + v_acquisition.received_quantity),
          6
        )
    END;

    UPDATE public.products
    SET wac_cost_in_minor_units_exact = v_new_exact,
      cost_price_in_minor_units = ROUND(v_new_exact)::BIGINT,
      updated_at = NOW()
    WHERE id = v_acquisition.product_id;
  END LOOP;

  -- Legacy receipt quantities/costs are explicit historical evidence too.
  -- This updates only the NEW receipt; no old receipt or balance is backfilled.
  UPDATE public.suppliers supplier
  SET current_balance_in_minor_units = supplier.current_balance_in_minor_units + (
      SELECT COALESCE(SUM(item.received_quantity::NUMERIC * item.unit_cost_in_minor_units),0)::BIGINT
      FROM public.purchase_receipt_items item WHERE item.purchase_receipt_id=(v_result->>'receipt_id')::UUID
    ), updated_at=NOW()
  FROM public.purchase_orders purchase_order
  WHERE purchase_order.id=p_purchase_order_id AND supplier.id=purchase_order.supplier_id;
  RETURN v_result;
END;
$$;

-- Existing public grants are retained by CREATE OR REPLACE. Helpers stay private.
ALTER FUNCTION public.record_supplier_payment(UUID,UUID,BIGINT,TEXT,TEXT,TIMESTAMPTZ,TEXT,TEXT) OWNER TO postgres;
ALTER FUNCTION public.receive_purchase_order_v2(UUID,UUID,TEXT,DATE,TIMESTAMPTZ,BIGINT,BIGINT,BIGINT,BIGINT,TEXT,TEXT,TEXT,TEXT,TEXT,JSONB) OWNER TO postgres;
ALTER FUNCTION public.reverse_supplier_payment(UUID,TEXT,TEXT) OWNER TO postgres;
ALTER FUNCTION public.cancel_purchase_receipt_v2(UUID,TEXT) OWNER TO postgres;
ALTER FUNCTION public.run_advanced_monitoring_checks(TIMESTAMPTZ) OWNER TO postgres;
ALTER FUNCTION public._record_supplier_receipt_payment_impl(UUID,BIGINT,TEXT,TEXT,TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public._record_supplier_receipt_payment_impl(UUID,BIGINT,TEXT,TEXT,TEXT) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION public.receive_purchase_order(UUID,UUID,TEXT,TEXT,JSONB) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public._get_cash_shift_closing_report_before_snapshot(p_shift_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_report JSONB;
  v_event_count INTEGER := 0;
  v_breakdown JSONB;
  v_quantity_breakdown JSONB;
  v_shift public.cash_shifts%ROWTYPE;
  v_gross BIGINT;
  v_credit BIGINT;
  v_first_cash BIGINT;
  v_first_cliq BIGINT;
  v_first_total BIGINT;
  v_direct_collected BIGINT;
  v_unproven INTEGER;
  v_debt_reduction BIGINT;
  v_return_entitlement BIGINT;
BEGIN
  v_report := public._get_cash_shift_closing_report_before_return_events(p_shift_id);
  IF COALESCE(v_report->>'success', 'false') <> 'true' THEN
    RETURN v_report;
  END IF;

  SELECT COUNT(*)::INTEGER INTO v_event_count
  FROM public.sales_return_events
  WHERE cash_shift_id = p_shift_id
    AND settlement_status = 'settled'
    AND money_refund_amount_in_minor_units > 0;

  IF v_event_count > 0 THEN
    WITH combined AS (
      SELECT
        item->>'refundMethod' AS refund_method,
        item->>'stockDisposition' AS stock_disposition,
        COALESCE((item->>'count')::INTEGER, 0) AS item_count,
        COALESCE((item->>'amountInMinorUnits')::BIGINT, 0) AS amount
      FROM jsonb_array_elements(COALESCE(v_report->'returnBreakdown', '[]'::JSONB)) item
      UNION ALL
      SELECT
        return_event.refund_method,
        CASE WHEN EXISTS (
          SELECT 1 FROM public.sales_return_items return_item
          WHERE return_item.sales_return_event_id = return_event.id
            AND return_item.stock_disposition = 'damaged'
        ) THEN 'damaged' ELSE 'restock' END,
        1,
        return_event.money_refund_amount_in_minor_units
      FROM public.sales_return_events return_event
      WHERE return_event.cash_shift_id = p_shift_id
        AND return_event.settlement_status = 'settled'
        AND return_event.money_refund_amount_in_minor_units > 0
    ), grouped AS (
      SELECT refund_method, stock_disposition,
        SUM(item_count)::INTEGER AS item_count, SUM(amount)::BIGINT AS amount
      FROM combined
      GROUP BY refund_method, stock_disposition
    )
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'refundMethod', refund_method,
        'stockDisposition', stock_disposition,
        'count', item_count,
        'amountInMinorUnits', amount
      ) ORDER BY amount DESC, refund_method, stock_disposition
    ), '[]'::JSONB)
    INTO v_breakdown
    FROM grouped;

    v_report := jsonb_set(v_report, '{returnBreakdown}', v_breakdown, true);
    v_report := jsonb_set(
      v_report,
      '{outflows,returnCount}',
      to_jsonb(COALESCE((v_report #>> '{outflows,returnCount}')::INTEGER, 0) + v_event_count),
      true
    );
  END IF;

  WITH quantities AS (
    -- Modern allocated returns preserve three independent buckets per physical
    -- leaf. A root inspection's accepted disposition cannot classify all its
    -- accepted quantity: it may contain both sellable and supplier-defect units.
    SELECT e.id AS event_id, (leaf->>'product_id')::UUID AS product_id,
      (leaf->>'sellable_restock_quantity')::INTEGER AS sellable,
      (leaf->>'defect_non_sellable_quantity')::INTEGER AS defect,
      (leaf->>'customer_damage_quantity')::INTEGER AS damage
    FROM public.sales_return_events e
    JOIN public.business_operations op ON op.id = e.operation_id
    CROSS JOIN LATERAL jsonb_array_elements(op.request_identity_snapshot->'physical_sources') leaf
    WHERE e.cash_shift_id = p_shift_id AND e.settlement_status = 'settled' AND e.contract_version = 401
      AND jsonb_typeof(op.request_identity_snapshot->'physical_sources') = 'array'
    UNION ALL
    SELECT e.id, i.product_id,
      CASE WHEN i.stock_disposition = 'restock' THEN i.accepted_base_quantity ELSE 0 END,
      CASE WHEN i.stock_disposition = 'damaged' THEN i.accepted_base_quantity ELSE 0 END,
      i.rejected_base_quantity
    FROM public.sales_return_events e
    JOIN public.sales_return_items i ON i.sales_return_event_id = e.id
    JOIN public.business_operations op ON op.id = e.operation_id
    WHERE e.cash_shift_id = p_shift_id AND e.settlement_status = 'settled' AND e.contract_version = 401
      AND i.return_scope = 'base_unit'
      AND NOT (op.request_identity_snapshot ? 'physical_sources')
    UNION ALL
    SELECT e.id, c.product_id,
      CASE WHEN c.accepted_stock_disposition = 'restock' THEN c.accepted_quantity ELSE 0 END,
      CASE WHEN c.accepted_stock_disposition = 'non_sellable' THEN c.accepted_quantity ELSE 0 END,
      c.rejected_quantity
    FROM public.sales_return_events e
    JOIN public.sales_return_items i ON i.sales_return_event_id = e.id
    JOIN public.sales_return_component_inspections c ON c.sales_return_item_id = i.id
    JOIN public.business_operations op ON op.id = e.operation_id
    WHERE e.cash_shift_id = p_shift_id AND e.settlement_status = 'settled' AND e.contract_version = 401
      AND NOT (op.request_identity_snapshot ? 'physical_sources')
    UNION ALL
    SELECT e.id, i.product_id,
      CASE WHEN e.stock_disposition = 'restock' THEN i.quantity ELSE 0 END,
      CASE WHEN e.stock_disposition = 'damaged' THEN i.quantity ELSE 0 END,
      0
    FROM public.sales_returns e
    JOIN public.order_items i ON i.order_id = e.order_id
    WHERE e.cash_shift_id = p_shift_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'eventId', q.event_id, 'productId', q.product_id,
    'productName', COALESCE(p.name_ar, 'صنف تاريخي'),
    'sellableQuantity', q.sellable, 'defectQuantity', q.defect,
    'customerDamageQuantity', q.damage) ORDER BY q.event_id, q.product_id), '[]'::JSONB)
  INTO v_quantity_breakdown
  FROM quantities q LEFT JOIN public.products p ON p.id = q.product_id;

  SELECT * INTO STRICT v_shift FROM public.cash_shifts WHERE id=p_shift_id;

  -- Completion-time truth is immutable. Later receipts/refunds do not turn
  -- newly-sold credit into a different sale. Existing cash/receipt/reconciliation
  -- fields in v_report are never rewritten by this presentation change.
  WITH first_completion AS MATERIALIZED (
    SELECT order_id,MIN(created_at) AS at FROM public.order_status_history
    WHERE new_status='completed' GROUP BY order_id
  ), completions AS MATERIALIZED (
    SELECT DISTINCT ON (operation.result_snapshot->>'order_id')
      operation.result_snapshot->>'order_id' AS order_key,
      operation.result_snapshot,operation.request_identity_snapshot
    FROM public.business_operations operation
    WHERE operation.operation_type='phase3_customer_completion_v1'
      AND operation.result_snapshot->>'order_id'=operation.request_identity_snapshot->>'order_id'
      AND operation.completed_at IS NOT NULL
    ORDER BY operation.result_snapshot->>'order_id',operation.completed_at,operation.id
  ), selected AS (
    SELECT customer_order.*,creation.operation_type,creation.result_snapshot AS creation_result,
      completion.result_snapshot AS completion_result,completion.request_identity_snapshot AS completion_request
    FROM public.orders customer_order
    JOIN first_completion ON first_completion.order_id=customer_order.id
    LEFT JOIN public.business_operations creation ON creation.id=customer_order.operation_id
    LEFT JOIN completions completion ON completion.order_key=customer_order.id::TEXT
    WHERE customer_order.branch_id=v_shift.branch_id
      AND customer_order.status IN('completed','returned')
      AND (customer_order.cash_shift_id=p_shift_id OR (
        customer_order.cash_shift_id IS NULL AND first_completion.at>=v_shift.opened_at
        AND first_completion.at<=COALESCE(v_shift.closed_at,NOW())
      ))
  ), anchors AS (
    SELECT selected.*,
      CASE WHEN operation_type='phase3_pos_sale_v1'
        THEN (creation_result->>'amountPaidInMinorUnits')::BIGINT
        WHEN operation_type='phase3_customer_reservation_v1'
        THEN (completion_result->>'amount_paid_in_minor_units')::BIGINT
        WHEN payment_method IN('cash','cash_on_delivery','cliq','card') THEN total_in_minor_units
        ELSE 0 END AS initial_collected,
      CASE WHEN operation_type='phase3_customer_reservation_v1'
        THEN NULLIF(completion_result->>'customer_payment_number','') END AS first_voucher_number
    FROM selected
  ), bound AS (
    SELECT anchors.*,payment.id AS first_payment_id,payment.amount_in_minor_units AS first_amount,
      payment.payment_method AS first_method,payment.order_id AS first_order_id,
      payment.cash_shift_id AS first_shift_id
    FROM anchors LEFT JOIN public.customer_payments payment ON payment.payment_number=anchors.first_voucher_number
  )
  SELECT COALESCE(SUM(total_in_minor_units),0)::BIGINT,
    COALESCE(SUM(total_in_minor_units-initial_collected),0)::BIGINT,
    COALESCE(SUM(first_amount) FILTER(WHERE first_method='cash'),0)::BIGINT,
    COALESCE(SUM(first_amount) FILTER(WHERE first_method='cliq'),0)::BIGINT,
    COUNT(*) FILTER(WHERE initial_collected IS NULL OR initial_collected<0
      OR initial_collected>total_in_minor_units OR (
        first_voucher_number IS NOT NULL AND (
          first_payment_id IS NULL OR first_order_id IS DISTINCT FROM id
          OR first_shift_id IS DISTINCT FROM p_shift_id OR first_amount IS DISTINCT FROM initial_collected
          OR first_method IS DISTINCT FROM completion_request->>'payment_method'
          OR first_method NOT IN('cash','cliq')
        )
      ))::INTEGER
  INTO v_gross,v_credit,v_first_cash,v_first_cliq,v_unproven
  FROM bound;

  v_first_total:=v_first_cash+v_first_cliq;
  v_direct_collected:=COALESCE((v_report#>>'{shift,cashSalesInMinorUnits}')::BIGINT,0)
    +COALESCE((v_report#>>'{shift,cliqSalesInMinorUnits}')::BIGINT,0)
    +COALESCE((v_report#>>'{shift,cardSalesInMinorUnits}')::BIGINT,0);
  IF v_unproven<>0 OR v_gross<>v_direct_collected+v_first_total+v_credit THEN
    RAISE EXCEPTION 'PHASE133_CLOSING_SALES_EVIDENCE_MISMATCH: لا يمكن إثبات توزيع مبيعات الوردية.';
  END IF;

  -- Existing refunds contain legacy + modern money exactly once. Debt-only
  -- Returns have no cash_shift_id; use authoritative settlement time inside
  -- this branch's non-overlapping shift window. No drawer projection changes.
  SELECT COALESCE(SUM(event.debt_reduction_amount_in_minor_units),0)::BIGINT
  INTO v_debt_reduction
  FROM public.sales_return_events event
  JOIN public.orders customer_order ON customer_order.id=event.order_id
  JOIN public.business_operations creation ON creation.id=customer_order.operation_id
  WHERE event.contract_version=401 AND event.settlement_status='settled'
    AND creation.operation_type IN('phase3_pos_sale_v1','phase3_customer_reservation_v1')
    AND event.branch_id=v_shift.branch_id
    AND (event.cash_shift_id=p_shift_id OR (
      event.cash_shift_id IS NULL AND event.settled_at>=v_shift.opened_at
      AND event.settled_at<COALESCE(v_shift.closed_at,NOW())
    ));
  v_return_entitlement:=COALESCE((v_report#>>'{sales,refundsInMinorUnits}')::BIGINT,0)+v_debt_reduction;

  v_report:=jsonb_set(v_report,'{sales}',(v_report->'sales')||jsonb_build_object(
    'salesDefinitionVersion',133,
    'grossSalesInMinorUnits',v_gross,
    'collectedDirectSalesInMinorUnits',v_direct_collected,
    'initialReceiptPaymentsInMinorUnits',v_first_total,
    'initialReceiptCashInMinorUnits',v_first_cash,
    'initialReceiptCliqInMinorUnits',v_first_cliq,
    'creditSalesInMinorUnits',v_credit,
    'returnEntitlementInMinorUnits',v_return_entitlement,
    'debtReductionInMinorUnits',v_debt_reduction,
    'netSalesInMinorUnits',v_gross-v_return_entitlement
  ));
  v_report:=jsonb_set(v_report,'{collections}',(v_report->'collections')||jsonb_build_object(
    'initialPaymentsInMinorUnits',v_first_total,
    'initialCashInMinorUnits',v_first_cash,
    'initialCliqInMinorUnits',v_first_cliq
  ));
  RETURN v_report || jsonb_build_object('returnQuantityBreakdown', v_quantity_breakdown);
END;
$$;

ALTER FUNCTION public._get_cash_shift_closing_report_before_snapshot(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public._get_cash_shift_closing_report_before_snapshot(UUID)
  FROM PUBLIC,anon,authenticated,service_role;

COMMIT;
