-- -------------------------------------------------------------------------
-- Customer checkout: structured address fields remain required; the free-text
-- delivery detail (p_street) is optional. This prevents duplicating the
-- governorate/city/area in the saved formatted address.
-- -------------------------------------------------------------------------

BEGIN;

DO $$
DECLARE
  v_function REGPROCEDURE :=
    'public.submit_guest_customer_order_core(text,text,text,text,text,text,text,text,text,text,double precision,double precision,text,jsonb,text)'::REGPROCEDURE;
  v_definition TEXT;
  v_required_fragment TEXT := E'\n    OR NULLIF(TRIM(p_street), '''') IS NULL';
BEGIN
  SELECT pg_get_functiondef(v_function) INTO v_definition;

  IF v_definition IS NULL
    OR POSITION(v_required_fragment IN v_definition) = 0
    OR POSITION('OR NULLIF(TRIM(p_area), '''') IS NULL' IN v_definition) = 0
    OR POSITION('OR CHAR_LENGTH(TRIM(p_street)) > 300' IN v_definition) = 0
  THEN
    RAISE EXCEPTION
      'Expected canonical guest checkout definition was not found; refusing to relax address validation.';
  END IF;

  v_definition := REPLACE(v_definition, v_required_fragment, '');

  IF POSITION(v_required_fragment IN v_definition) <> 0
    OR POSITION('OR NULLIF(TRIM(p_area), '''') IS NULL' IN v_definition) = 0
  THEN
    RAISE EXCEPTION
      'Canonical guest checkout validation rewrite did not produce the expected definition.';
  END IF;

  EXECUTE v_definition;
END;
$$;

COMMENT ON FUNCTION public.submit_guest_customer_order_core(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  DOUBLE PRECISION, DOUBLE PRECISION, TEXT, JSONB, TEXT
) IS
  'Private canonical guest checkout core. Governorate, city and area are required; p_street is an optional delivery detail. Pricing, stock reservation, promotions, locking, and idempotency remain server-authoritative.';

DO $$
BEGIN
  IF has_function_privilege(
    'anon',
    'public.submit_guest_customer_order_core(text,text,text,text,text,text,text,text,text,text,double precision,double precision,text,jsonb,text)',
    'EXECUTE'
  ) OR has_function_privilege(
    'authenticated',
    'public.submit_guest_customer_order_core(text,text,text,text,text,text,text,text,text,text,double precision,double precision,text,jsonb,text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Canonical guest checkout core must remain private.';
  END IF;
END;
$$;

COMMIT;
