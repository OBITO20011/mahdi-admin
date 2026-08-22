-- =========================================================================
-- Nawasrah ERP - Supplier receiving wholesale guard
-- Receiving controls purchase packages, incoming cost, inventory, and supplier
-- balance. It must never change the product's wholesale selling configuration.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.create_direct_supplier_receipt(
  p_supplier_id UUID,
  p_warehouse_id UUID,
  p_branch_id UUID DEFAULT NULL,
  p_supplier_invoice_number TEXT DEFAULT NULL,
  p_supplier_invoice_date DATE DEFAULT NULL,
  p_received_at TIMESTAMPTZ DEFAULT NOW(),
  p_delivery_fee_in_minor_units BIGINT DEFAULT 0,
  p_discount_in_minor_units BIGINT DEFAULT 0,
  p_tax_in_minor_units BIGINT DEFAULT 0,
  p_amount_paid_in_minor_units BIGINT DEFAULT 0,
  p_payment_method TEXT DEFAULT 'cash',
  p_payment_reference TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_internal_notes TEXT DEFAULT NULL,
  p_idempotency_key UUID DEFAULT NULL,
  p_items JSONB DEFAULT '[]'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_purchase_only_items JSONB := p_items;
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'warehouse_keeper'],
    'استلام بضاعة الموردين'
  );

  -- Older clients may still send the legacy per-piece selling price. Strip it
  -- at the RPC boundary so a purchase receipt cannot overwrite sale pricing.
  IF p_items IS NOT NULL AND jsonb_typeof(p_items) = 'array' THEN
    SELECT COALESCE(
      jsonb_agg(
        item.value - 'selling_price_in_minor_units'
        ORDER BY item.ordinality
      ),
      '[]'::jsonb
    )
    INTO v_purchase_only_items
    FROM jsonb_array_elements(p_items)
      WITH ORDINALITY AS item(value, ordinality);
  END IF;

  RETURN public._create_direct_supplier_receipt_impl(
    p_supplier_id,
    p_warehouse_id,
    p_branch_id,
    p_supplier_invoice_number,
    p_supplier_invoice_date,
    p_received_at,
    p_delivery_fee_in_minor_units,
    p_discount_in_minor_units,
    p_tax_in_minor_units,
    p_amount_paid_in_minor_units,
    p_payment_method,
    p_payment_reference,
    p_notes,
    p_internal_notes,
    p_idempotency_key,
    v_purchase_only_items
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_direct_supplier_receipt(
  UUID, UUID, UUID, TEXT, DATE, TIMESTAMPTZ, BIGINT, BIGINT, BIGINT,
  BIGINT, TEXT, TEXT, TEXT, TEXT, UUID, JSONB
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.create_direct_supplier_receipt(
  UUID, UUID, UUID, TEXT, DATE, TIMESTAMPTZ, BIGINT, BIGINT, BIGINT,
  BIGINT, TEXT, TEXT, TEXT, TEXT, UUID, JSONB
) TO authenticated;

COMMENT ON FUNCTION public.create_direct_supplier_receipt(
  UUID, UUID, UUID, TEXT, DATE, TIMESTAMPTZ, BIGINT, BIGINT, BIGINT,
  BIGINT, TEXT, TEXT, TEXT, TEXT, UUID, JSONB
) IS
  'Atomic supplier receiving for purchase packages. Updates inventory, WAC, supplier balance, payments, movement and audit records without changing wholesale sale pricing.';
