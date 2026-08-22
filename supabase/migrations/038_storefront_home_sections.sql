-- =========================================================================
-- Nawasrah ERP - Homepage merchandising controls
-- Visibility is editable; product membership remains driven by real data.
-- =========================================================================

ALTER TABLE public.storefront_settings
  ADD COLUMN IF NOT EXISTS show_newest_products BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS show_best_sellers BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS show_offers BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS show_low_stock BOOLEAN NOT NULL DEFAULT true;

CREATE OR REPLACE FUNCTION public.get_public_storefront_settings()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'storeNameAr', store_name_ar,
    'whatsappNumber', whatsapp_number,
    'cliqAlias', cliq_alias,
    'ordersEnabled', orders_enabled,
    'announcementText', announcement_text,
    'businessHoursText', business_hours_text,
    'deliveryAreasText', delivery_areas_text,
    'deliveryEtaText', delivery_eta_text,
    'exchangePolicyText', exchange_policy_text,
    'minimumOrderInMinorUnits', minimum_order_in_minor_units,
    'deliveryFeeInMinorUnits', delivery_fee_in_minor_units,
    'showNewestProducts', show_newest_products,
    'showBestSellers', show_best_sellers,
    'showOffers', show_offers,
    'showLowStock', show_low_stock,
    'updatedAt', updated_at
  )
  FROM public.storefront_settings
  WHERE id = '00000000-0000-0000-0000-000000000001'::UUID;
$$;

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
  -- Reuse the validated, audited canonical settings mutation.
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

REVOKE ALL ON FUNCTION public.save_storefront_settings(
  TEXT, TEXT, TEXT, BOOLEAN, TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT, BIGINT
) FROM authenticated;
REVOKE ALL ON FUNCTION public.save_storefront_settings_v2(
  TEXT, TEXT, TEXT, BOOLEAN, TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT, BIGINT,
  BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_storefront_settings_v2(
  TEXT, TEXT, TEXT, BOOLEAN, TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT, BIGINT,
  BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN
) TO authenticated;

COMMENT ON FUNCTION public.save_storefront_settings_v2(
  TEXT, TEXT, TEXT, BOOLEAN, TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT, BIGINT,
  BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN
) IS
  'Authenticated storefront settings entry point including homepage section visibility; section products remain derived from live catalog and completed sales.';
