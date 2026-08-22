-- Remove the unused-result warning from the homepage settings RPC.
CREATE OR REPLACE FUNCTION public.save_storefront_settings_v2(
  p_store_name_ar TEXT,
  p_whatsapp_number TEXT,
  p_cliq_alias TEXT,
  p_orders_enabled BOOLEAN,
  p_announcement_text TEXT,
  p_business_hours_text TEXT,
  p_delivery_areas_text TEXT,
  p_delivery_eta_text TEXT,
  p_exchange_policy_text TEXT,
  p_minimum_order_in_minor_units BIGINT,
  p_delivery_fee_in_minor_units BIGINT,
  p_show_newest_products BOOLEAN,
  p_show_best_sellers BOOLEAN,
  p_show_offers BOOLEAN,
  p_show_low_stock BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  PERFORM public.save_storefront_settings(
    p_store_name_ar,
    p_whatsapp_number,
    p_cliq_alias,
    p_orders_enabled,
    p_announcement_text,
    p_business_hours_text,
    p_delivery_areas_text,
    p_delivery_eta_text,
    p_exchange_policy_text,
    p_minimum_order_in_minor_units,
    p_delivery_fee_in_minor_units
  );

  UPDATE public.storefront_settings
  SET show_newest_products = COALESCE(p_show_newest_products, true),
      show_best_sellers = COALESCE(p_show_best_sellers, true),
      show_offers = COALESCE(p_show_offers, true),
      show_low_stock = COALESCE(p_show_low_stock, true),
      updated_at = NOW(),
      updated_by = v_user_id
  WHERE id = '00000000-0000-0000-0000-000000000001'::UUID;

  INSERT INTO public.audit_logs (user_id, action, entity_name, entity_id, details)
  VALUES (
    v_user_id,
    'save_storefront_home_sections',
    'storefront_settings',
    '00000000-0000-0000-0000-000000000001'::UUID,
    jsonb_build_object(
      'show_newest_products', p_show_newest_products,
      'show_best_sellers', p_show_best_sellers,
      'show_offers', p_show_offers,
      'show_low_stock', p_show_low_stock
    )
  );

  RETURN public.get_public_storefront_settings() || jsonb_build_object(
    'success', true,
    'message', 'تم حفظ إعدادات المتجر وأقسام الصفحة الرئيسية بنجاح.'
  );
END;
$$;
