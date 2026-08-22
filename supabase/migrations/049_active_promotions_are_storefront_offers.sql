-- =========================================================================
-- Nawasrah ERP - Migration 049
-- Explicitly published scheduled offers may be advertised before their start
-- time, but the canonical promotion calculator still rejects early redemption.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.get_public_storefront_offers()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'success', true,
    'offers', COALESCE(jsonb_agg(to_jsonb(offer_data)), '[]'::jsonb)
  )
  FROM (
    SELECT
      pc.id,
      pc.code,
      pc.description_ar,
      pc.discount_type,
      pc.discount_value,
      pc.minimum_subtotal_in_minor_units,
      pc.maximum_discount_in_minor_units,
      pc.starts_at,
      pc.expires_at
    FROM public.promotion_codes AS pc
    WHERE pc.is_public_offer = true
      AND pc.is_active = true
      AND (pc.expires_at IS NULL OR pc.expires_at > NOW())
      AND (
        pc.maximum_total_redemptions IS NULL
        OR (
          SELECT COUNT(*)
          FROM public.promotion_redemptions AS pr
          WHERE pr.promotion_code_id = pc.id
        ) < pc.maximum_total_redemptions
      )
    ORDER BY
      CASE WHEN pc.starts_at IS NULL OR pc.starts_at <= NOW() THEN 0 ELSE 1 END,
      pc.created_at DESC
    LIMIT 12
  ) AS offer_data;
$$;

REVOKE ALL ON FUNCTION public.get_public_storefront_offers()
  FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_public_storefront_offers()
  TO anon, authenticated;

COMMENT ON FUNCTION public.get_public_storefront_offers() IS
  'Returns explicitly published active current and scheduled storefront promotions. Redemption eligibility remains server-authoritative.';
