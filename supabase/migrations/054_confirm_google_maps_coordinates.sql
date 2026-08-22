-- =========================================================================
-- Nawasrah storefront - confirm coordinates embedded in Google Maps URLs.
-- Trusted direct links become an exact delivery pin at the database boundary.
-- Short Google redirect links remain safe/clickable but unconfirmed until the
-- customer or an ERP operator supplies exact coordinates.
-- =========================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.extract_google_maps_coordinates(
  p_google_maps_url TEXT
)
RETURNS DOUBLE PRECISION[]
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_url TEXT := NULLIF(TRIM(p_google_maps_url), '');
  v_match TEXT[];
  v_latitude DOUBLE PRECISION;
  v_longitude DOUBLE PRECISION;
BEGIN
  IF v_url IS NULL THEN
    RETURN NULL;
  END IF;

  v_match := REGEXP_MATCH(
    v_url,
    '[?&](?:q|query)=(-?[0-9]+(?:\.[0-9]+)?)(?:,|%2c)(-?[0-9]+(?:\.[0-9]+)?)',
    'i'
  );

  IF v_match IS NULL THEN
    v_match := REGEXP_MATCH(
      v_url,
      '/@(-?[0-9]+(?:\.[0-9]+)?),(-?[0-9]+(?:\.[0-9]+)?)(?:,|/|$)',
      'i'
    );
  END IF;

  IF v_match IS NULL THEN
    RETURN NULL;
  END IF;

  v_latitude := v_match[1]::DOUBLE PRECISION;
  v_longitude := v_match[2]::DOUBLE PRECISION;

  IF v_latitude NOT BETWEEN -90 AND 90
    OR v_longitude NOT BETWEEN -180 AND 180
  THEN
    RETURN NULL;
  END IF;

  RETURN ARRAY[v_latitude, v_longitude];
EXCEPTION
  WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.extract_google_maps_coordinates(TEXT)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.validate_customer_address_map_url()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_url TEXT := NULLIF(TRIM(NEW.google_maps_url), '');
  v_coordinates DOUBLE PRECISION[];
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

  IF NEW.latitude IS NULL AND NEW.longitude IS NULL THEN
    v_coordinates := public.extract_google_maps_coordinates(v_url);

    IF v_coordinates IS NOT NULL THEN
      NEW.latitude := v_coordinates[1];
      NEW.longitude := v_coordinates[2];
      NEW.location_source := 'map_pin';
      NEW.location_confirmed := true;
    END IF;
  ELSIF NEW.latitude IS NOT NULL AND NEW.longitude IS NOT NULL THEN
    IF NEW.latitude NOT BETWEEN -90 AND 90
      OR NEW.longitude NOT BETWEEN -180 AND 180
    THEN
      RAISE EXCEPTION 'إحداثيات موقع التوصيل غير صحيحة.';
    END IF;

    NEW.location_confirmed := true;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.validate_customer_address_map_url()
  FROM PUBLIC, anon, authenticated;

-- Safely repair previously saved direct links without resolving or trusting
-- shortened redirects. Reassigning the URL invokes the hardened trigger.
UPDATE public.customer_addresses
SET google_maps_url = google_maps_url
WHERE google_maps_url IS NOT NULL
  AND latitude IS NULL
  AND longitude IS NULL
  AND public.extract_google_maps_coordinates(google_maps_url) IS NOT NULL;

COMMENT ON FUNCTION public.extract_google_maps_coordinates(TEXT) IS
  'Extracts validated latitude/longitude from direct trusted Google Maps URLs.';

COMMENT ON FUNCTION public.validate_customer_address_map_url() IS
  'Validates trusted map links and confirms exact coordinates when embedded.';

COMMIT;
