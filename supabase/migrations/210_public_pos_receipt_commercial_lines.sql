-- Owner-approved read-only receipt projection. Existing token, source, status and ACL stay unchanged.
BEGIN;

CREATE OR REPLACE FUNCTION public.get_public_pos_receipt(p_receipt_token UUID)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_receipt JSONB;
BEGIN
  IF p_receipt_token IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'رابط الإيصال غير صحيح.');
  END IF;

  SELECT jsonb_build_object(
    'success', true,
    'orderNumber', o.order_number, 'createdAt', o.created_at, 'status', o.status,
    'paymentMethod', o.payment_method, 'paymentStatus', o.payment_status,
    'subtotalInMinorUnits', o.subtotal_in_minor_units,
    'discountInMinorUnits', o.discount_in_minor_units,
    'totalInMinorUnits', o.total_in_minor_units,
    'branch', jsonb_build_object('name', COALESCE(b.name_ar, 'محلات النواصرة'),
      'address', COALESCE(b.address, ''), 'phone', COALESCE(b.phone, '')),
    'items', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'productName', oi.product_name_snapshot, 'sku', COALESCE(oi.sku_snapshot, ''),
        'packageQuantity', COALESCE(oi.sale_package_quantity, oi.quantity),
        'packageName', COALESCE(oi.sale_package_name_snapshot, 'طرد'),
        'unitsPerPackage', COALESCE(oi.units_per_sale_package, 1),
        'packagePriceInMinorUnits', COALESCE(oi.sale_package_price_in_minor_units, oi.unit_price_in_minor_units),
        'lineTotalInMinorUnits', oi.line_total_in_minor_units,
        'commercialLineKind', oi.commercial_line_kind,
        'baseQuantity', CASE WHEN oi.commercial_line_kind = 'configurable_parcel'
          THEN (SELECT SUM(c.base_quantity) FROM public.order_parcel_instances i
            JOIN public.order_parcel_components c ON c.parcel_instance_id = i.id
            WHERE i.order_item_id = oi.id AND i.order_id = o.id)
          ELSE oi.quantity END,
        'baseUnitName', oi.base_unit_name_snapshot,
        'parcelInstances', COALESCE((
          SELECT jsonb_agg(jsonb_build_object('components', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
              'name', c.product_name_snapshot, 'quantity', c.base_quantity,
              'unitName', c.base_unit_name_snapshot
            ) ORDER BY c.product_name_snapshot, c.product_id)
            FROM public.order_parcel_components c WHERE c.parcel_instance_id = i.id
          ), '[]'::JSONB)) ORDER BY i.instance_sequence)
          FROM public.order_parcel_instances i
          WHERE i.order_item_id = oi.id AND i.order_id = o.id
        ), '[]'::JSONB)
      ) ORDER BY oi.created_at, oi.id)
      FROM public.order_items oi WHERE oi.order_id = o.id
    ), '[]'::JSONB)
  ) INTO v_receipt
  FROM public.orders o LEFT JOIN public.branches b ON b.id = o.branch_id
  WHERE o.public_receipt_token = p_receipt_token
    AND o.source = 'pos' AND o.status IN ('completed', 'returned');

  IF v_receipt IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'الإيصال غير موجود أو لم يعد متاحاً.');
  END IF;
  RETURN v_receipt;
END;
$$;

-- CREATE OR REPLACE retains the existing owner and privileges; no grants are added or removed.
COMMENT ON FUNCTION public.get_public_pos_receipt(UUID) IS
  'Token-authorized read-only POS receipt with saved commercial kinds and flavor composition; no customer, internal identifiers, cost or profit data.';
COMMIT;
