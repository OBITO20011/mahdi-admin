-- Owner13-17: receipt evidence for suggestions and honest display only.
-- No receipt/product writer, saved amount, balance, permission or WAC change.
BEGIN;

CREATE OR REPLACE FUNCTION public.get_receiving_purchase_context(p_product_ids UUID[])
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner','admin','manager','accountant','warehouse_keeper'],
    'عرض آخر أسعار شراء الأصناف'
  );
  IF p_product_ids IS NULL OR cardinality(p_product_ids) NOT BETWEEN 1 AND 100
    OR array_position(p_product_ids,NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'اختر من صنف واحد إلى100 صنف لقراءة آخر شراء.';
  END IF;
  RETURN (
    SELECT jsonb_build_object('products',COALESCE(jsonb_agg(jsonb_build_object(
      'productId',requested.product_id,'lastPurchase',last_quote.quote
    ) ORDER BY requested.product_id),'[]'::jsonb))
    FROM (SELECT DISTINCT unnest(p_product_ids) AS product_id) requested
    LEFT JOIN LATERAL (
      SELECT jsonb_build_object(
        'receiptId',e.receipt_id,'receiptNumber',e.receipt_number,'source',e.source,
        'receivedAt',e.received_at,'supplierId',e.supplier_id,'supplierName',e.supplier_name,
        'grossInMinorUnits',e.gross,'baseQuantity',e.base_quantity,
        'baseUnitName',e.base_unit_name
      ) AS quote
      FROM (
        SELECT r.id AS receipt_id,r.receipt_number,'direct'::text AS source,
          r.received_at,r.supplier_id,s.company_name AS supplier_name,i.id AS item_id,
          COALESCE(l.gross_amount_snapshot_in_minor_units,
            i.package_quantity::bigint*i.package_price_in_minor_units) AS gross,
          COALESCE(l.received_base_unit_quantity,
            (SELECT SUM(physical.total_base_units)::bigint FROM public.supplier_receipt_items physical WHERE physical.commercial_line_id=l.id),
            i.total_base_units) AS base_quantity,
          COALESCE(NULLIF(l.base_unit_name_snapshot,''),NULLIF(i.base_unit_name,''),'باكيت') AS base_unit_name
        FROM public.supplier_receipt_items i
        JOIN public.supplier_receipts r ON r.id=i.supplier_receipt_id
        LEFT JOIN public.suppliers s ON s.id=r.supplier_id
        LEFT JOIN public.supplier_receipt_commercial_lines l ON l.id=i.commercial_line_id
        WHERE i.product_id=requested.product_id AND r.status='completed'
        UNION ALL
        SELECT r.id,r.receipt_number,'purchase_order'::text,r.received_at,r.supplier_id,
          s.company_name,i.id,
          COALESCE(l.gross_amount_snapshot_in_minor_units,
            i.received_quantity::bigint*i.unit_cost_in_minor_units),
          COALESCE(l.received_base_unit_quantity,i.received_quantity),
          COALESCE(NULLIF(l.base_unit_name_snapshot,''),u.name_ar,'باكيت')
        FROM public.purchase_receipt_items i
        JOIN public.purchase_receipts r ON r.id=i.purchase_receipt_id
        LEFT JOIN public.suppliers s ON s.id=r.supplier_id
        LEFT JOIN public.purchase_receipt_commercial_lines l ON l.id=i.commercial_line_id
        LEFT JOIN public.products p ON p.id=i.product_id
        LEFT JOIN public.units u ON u.id=p.unit_id
        WHERE i.product_id=requested.product_id AND r.status='completed'
      ) e
      WHERE e.base_quantity>0 AND e.gross>=0
      ORDER BY e.received_at DESC,e.source,e.receipt_id DESC,e.item_id DESC
      LIMIT 1
    ) last_quote ON true
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_supplier_receipt_display_context(p_receipt_id UUID)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner','admin','manager','accountant','warehouse_keeper'],
    'عرض أساس أسعار سند الاستلام'
  );
  IF p_receipt_id IS NULL THEN RAISE EXCEPTION 'اختر سند الاستلام.'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.supplier_receipts WHERE id=p_receipt_id) THEN
    RAISE EXCEPTION 'سند الاستلام غير موجود.';
  END IF;
  RETURN (
    SELECT jsonb_build_object('receiptId',p_receipt_id,'lines',COALESCE(jsonb_agg(
      jsonb_build_object(
        'id',e.id,'kind',e.kind,'commercialQuantity',e.quantity,
        'unitsPerParcel',e.units_per_parcel,'baseUnitName',e.base_unit,
        'baseQuantity',e.base_quantity,'grossInMinorUnits',e.gross,
        'lineDiscountInMinorUnits',e.discount,'netInMinorUnits',e.net,
        'acquisitionInMinorUnits',e.acquisition,'components',e.components
      ) ORDER BY e.sequence,e.id),'[]'::jsonb))
    FROM (
      SELECT l.id,l.line_sequence AS sequence,l.commercial_line_kind AS kind,
        l.commercial_quantity AS quantity,
        CASE WHEN l.commercial_line_kind='base_unit' THEN 1 ELSE l.units_per_parcel_snapshot END AS units_per_parcel,
        l.base_unit_name_snapshot AS base_unit,
        COALESCE(l.received_base_unit_quantity,
          (SELECT SUM(physical.total_base_units)::bigint FROM public.supplier_receipt_items physical WHERE physical.commercial_line_id=l.id)) AS base_quantity,
        l.gross_amount_snapshot_in_minor_units AS gross,
        l.discount_snapshot_in_minor_units AS discount,
        l.line_total_snapshot_in_minor_units AS net,
        l.final_acquisition_amount_in_minor_units AS acquisition,
        (SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'itemId',i.id,'productId',i.product_id,'nameAr',p.name_ar,'sku',p.sku,
          'baseQuantity',i.total_base_units,
          'currentSaleUnitPriceInMinorUnits',p.sale_price_in_minor_units
        ) ORDER BY i.id),'[]'::jsonb)
        FROM public.supplier_receipt_items i LEFT JOIN public.products p ON p.id=i.product_id
        WHERE i.commercial_line_id=l.id AND i.supplier_receipt_id=p_receipt_id) AS components
      FROM public.supplier_receipt_commercial_lines l
      WHERE l.supplier_receipt_id=p_receipt_id
      UNION ALL
      SELECT i.id,0,
        CASE WHEN i.units_per_package>1 THEN 'legacy_single_sku_parcel' ELSE 'base_unit' END,
        i.package_quantity,i.units_per_package,COALESCE(NULLIF(i.base_unit_name,''),'باكيت'),
        i.total_base_units,i.package_quantity::bigint*i.package_price_in_minor_units,
        i.discount_in_minor_units,i.line_total_in_minor_units,
        COALESCE(i.allocated_cost_in_minor_units,i.line_total_in_minor_units),
        jsonb_build_array(jsonb_build_object(
          'itemId',i.id,'productId',i.product_id,'nameAr',p.name_ar,'sku',p.sku,
          'baseQuantity',i.total_base_units,
          'currentSaleUnitPriceInMinorUnits',p.sale_price_in_minor_units
        ))
      FROM public.supplier_receipt_items i LEFT JOIN public.products p ON p.id=i.product_id
      WHERE i.supplier_receipt_id=p_receipt_id AND i.commercial_line_id IS NULL
    ) e
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_receiving_purchase_context(UUID[]) FROM PUBLIC,anon,service_role;
REVOKE ALL ON FUNCTION public.get_supplier_receipt_display_context(UUID) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.get_receiving_purchase_context(UUID[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_supplier_receipt_display_context(UUID) TO authenticated;
COMMENT ON FUNCTION public.get_receiving_purchase_context(UUID[]) IS 'Last completed receipt gross quote per physical base quantity; read-only suggestion, never WAC or a product price write.';
COMMENT ON FUNCTION public.get_supplier_receipt_display_context(UUID) IS 'Recorded commercial receipt basis and explicitly current sale quotes; no reconstruction from current package sizes.';
COMMIT;
