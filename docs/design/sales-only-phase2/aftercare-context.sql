-- QUARANTINED owner-only read model. Same physical/financial UI contract,
-- independent immutable lite evidence; no frozen context or bridge is changed.
CREATE FUNCTION public.lite1_aftercare_context2(p_order_id UUID) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE o public.orders;completed TIMESTAMPTZ;financial RECORD;
BEGIN
 PERFORM sales_lite1.owner();
 SELECT * INTO o FROM public.orders WHERE id=p_order_id;
 SELECT completed_at INTO completed FROM sales_lite1.completions WHERE order_id=p_order_id;
 IF NOT sales_lite1.is_order(p_order_id) OR o.status IS DISTINCT FROM 'completed' OR completed IS NULL THEN RAISE EXCEPTION 'LITE2_ORDER_CONTEXT_INVALID';END IF;
 SELECT * INTO financial FROM public.phase42_order_financial_position_internal(p_order_id);
 RETURN jsonb_build_object('contractVersion',403,'serverTime',statement_timestamp(),'supported',true,'capability','sales_only','accountingTracked',false,
  'order',jsonb_build_object('id',o.id,'orderNumber',o.order_number,'status',o.status,'saleContract','lite2','branchId',o.branch_id,'warehouseId',o.warehouse_id,
   'completedAt',completed,'deadlineAt',completed+interval '48 hours','withinWindow',statement_timestamp()<=completed+interval '48 hours'),
  'financial',jsonb_build_object('merchandiseDebtInMinorUnits',financial.merchandise_debt_in_minor_units,'refundableCollectedInMinorUnits',financial.refundable_collected_in_minor_units,'deliveryFeeInMinorUnits',financial.delivery_fee_in_minor_units),
  'baseItems',COALESCE((SELECT jsonb_agg(jsonb_build_object('orderItemId',i.id,'productId',i.product_id,'quantity',i.quantity,
    'parcelOnly',public.parcel209_effective_only_internal(i.product_id),'commercialLineKind',i.commercial_line_kind,
    'unitsPerParcel',CASE WHEN i.commercial_line_kind='legacy_single_sku_parcel' THEN i.units_per_sale_package ELSE 1 END,
    'commercialQuantity',COALESCE(i.sale_package_quantity,i.quantity),'standalonePriceInMinorUnits',sales_lite2.sale_packet_price(o.id,i.id,NULL),
    'remainingQuantity',GREATEST(i.quantity-used.quantity,0),
    'physicalRepresentatives',CASE WHEN i.quantity>used.quantity THEN jsonb_build_array(jsonb_build_object('sourceKind','base_order_item','sourceId',i.id,'productId',i.product_id,'remainingQuantity',i.quantity-used.quantity,'parentReplacementItemId',NULL,
     'unitsPerParcel',CASE WHEN i.commercial_line_kind='legacy_single_sku_parcel' THEN i.units_per_sale_package ELSE 1 END,'isSingleSkuParcel',i.commercial_line_kind='legacy_single_sku_parcel')) ELSE '[]'::JSONB END) ORDER BY i.id)
    FROM public.order_items i CROSS JOIN LATERAL(SELECT COALESCE(sum(r.quantity),0)::INTEGER quantity FROM sales_lite1.returns r WHERE r.item_id=i.id) used
    WHERE i.order_id=o.id AND i.commercial_line_kind IN('base_unit','legacy_single_sku_parcel')),'[]'::JSONB),
  'parcelInstances',COALESCE((SELECT jsonb_agg(jsonb_build_object('parcelInstanceId',i.id,'orderItemId',i.order_item_id,'components',
    (SELECT jsonb_agg(jsonb_build_object('parcelComponentId',c.id,'productId',c.product_id,'quantity',c.base_quantity,'parcelOnly',public.parcel209_effective_only_internal(c.product_id),
     'physicalRepresentatives',jsonb_build_array(jsonb_build_object('sourceKind','parcel_component','sourceId',c.id,'productId',c.product_id,'remainingQuantity',c.base_quantity,'parentReplacementItemId',NULL))) ORDER BY c.id)
     FROM public.order_parcel_components c WHERE c.parcel_instance_id=i.id)) ORDER BY i.instance_sequence)
    FROM public.order_parcel_instances i WHERE i.order_id=o.id AND NOT EXISTS(SELECT 1 FROM sales_lite2.return_details d WHERE d.parcel_instance_id=i.id)),'[]'::JSONB),
  'returns',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',r.id,'returnNumber','L2R-'||r.id::TEXT,'createdAt',r.created_at,'quantity',r.quantity) ORDER BY r.created_at,r.id) FROM sales_lite1.returns r WHERE r.order_id=o.id),'[]'::JSONB),'replacements','[]'::JSONB);
END $$;
REVOKE ALL ON FUNCTION public.lite1_aftercare_context2(UUID) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.lite1_aftercare_context2(UUID) TO authenticated;

CREATE FUNCTION public.lite1_order_details2(p_order_id UUID) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE o public.orders;recipient JSONB;card public.customers;reused BOOLEAN;proposal JSONB;financial RECORD;
BEGIN
 PERFORM sales_lite1.owner();SELECT * INTO o FROM public.orders WHERE id=p_order_id;
 IF NOT sales_lite1.is_order(p_order_id) THEN RAISE EXCEPTION 'LITE2_ORDER_CONTEXT_INVALID';END IF;
 SELECT l.recipient,COALESCE((b.result_snapshot->>'customer_reused')::BOOLEAN,false) INTO recipient,reused
 FROM sales_lite1.orders l JOIN public.business_operations b ON b.id=l.operation_id WHERE l.order_id=p_order_id;
 SELECT * INTO card FROM public.customers WHERE id=o.customer_id;
 SELECT COALESCE(jsonb_object_agg(key,value),'{}') INTO proposal FROM jsonb_each(recipient)
 WHERE key IN('fullName','governorate','city','area','street','building','addressNotes');
 SELECT * INTO financial FROM public.phase42_order_financial_position_internal(o.id);
 RETURN jsonb_build_object('contractVersion','lite2-order-details-v1','orderId',o.id,'accountingTracked',false,
  'amountPaidInMinorUnits',o.amount_paid_in_minor_units,'amountDueInMinorUnits',financial.outstanding_total_in_minor_units,
  'recipientProposal',CASE WHEN o.source='website' THEN jsonb_build_object('proposed',reused,'recipient',proposal,
   'customerCard',jsonb_build_object('fullName',card.full_name,'governorate',card.governorate,'defaultAddress',
    (SELECT a.formatted_address FROM public.customer_addresses a WHERE a.customer_id=card.id AND a.is_default ORDER BY a.id LIMIT 1))) ELSE NULL END);
END $$;
REVOKE ALL ON FUNCTION public.lite1_order_details2(UUID) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.lite1_order_details2(UUID) TO authenticated;
