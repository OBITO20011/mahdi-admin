-- =========================================================================
-- Nawasrah storefront - accept delivery pins from trusted Google Maps hosts
-- =========================================================================

CREATE OR REPLACE FUNCTION public.validate_customer_address_map_url()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_url TEXT := NULLIF(TRIM(NEW.google_maps_url), '');
BEGIN
  IF v_url IS NULL THEN
    RETURN NEW;
  END IF;

  IF CHAR_LENGTH(v_url) > 1000
    OR NOT (
      v_url ~* '^https://maps\.app\.goo\.gl(?:/|$)'
      OR v_url ~* '^https://goo\.gl/maps(?:/|$)'
      OR v_url ~* '^https://maps\.google\.[a-z.]+(?:/|\?|$)'
      OR v_url ~* '^https://(?:www\.)?google\.[a-z.]+/maps(?:/|\?|$)'
    )
  THEN
    RAISE EXCEPTION
      'ألصق رابط مشاركة صحيحًا من خرائط Google لموقع التوصيل.';
  END IF;

  NEW.google_maps_url := v_url;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_customer_address_map_url
  ON public.customer_addresses;
CREATE TRIGGER trg_validate_customer_address_map_url
BEFORE INSERT OR UPDATE OF google_maps_url
ON public.customer_addresses
FOR EACH ROW
EXECUTE FUNCTION public.validate_customer_address_map_url();

REVOKE ALL ON FUNCTION public.validate_customer_address_map_url()
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.validate_customer_address_map_url() IS
  'Rejects arbitrary external URLs while allowing common Google Maps share links for delivery.';
