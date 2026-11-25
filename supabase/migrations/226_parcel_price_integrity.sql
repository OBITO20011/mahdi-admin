-- Protect ON package content and separate flavor identities from pricing.
BEGIN;

DO $history226$
BEGIN
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations) <> 185
     OR (SELECT max(version::integer) FROM supabase_migrations.schema_migrations) <> 225
     OR EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '221')
  THEN
    RAISE EXCEPTION 'PRICE226_EXACT225_HISTORY_REQUIRED';
  END IF;
END;
$history226$;

CREATE FUNCTION public.assert_on_parcel_size226_internal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  product public.products%ROWTYPE;
  parcel_enabled boolean;
BEGIN
  IF sales_lite1.enabled() THEN
    RETURN NULL;
  END IF;

  -- Approved price writers can update the same row more than once. Check the
  -- final product so intermediate derived prices do not reject a valid edit.
  SELECT * INTO product FROM public.products WHERE id = NEW.id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT state.parcel_enabled INTO parcel_enabled
  FROM public.product_sale_pricing_state225 state
  WHERE state.product_id = COALESCE(product.flavor_master_product_id, product.id);

  PERFORM public.price225_assert_prices_internal(
    product.unit_id,
    COALESCE(product.sale_unit_id, product.purchase_unit_id, product.unit_id),
    product.units_per_sale_unit,
    product.sale_price_in_minor_units,
    product.default_sale_price_in_minor_units,
    COALESCE(parcel_enabled, true),
    product.parcel_only
  );
  RETURN NULL;
END;
$$;

ALTER FUNCTION public.assert_on_parcel_size226_internal() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.assert_on_parcel_size226_internal()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE CONSTRAINT TRIGGER trg_assert_on_parcel_size226
AFTER UPDATE OF units_per_sale_unit ON public.products
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
WHEN (OLD.units_per_sale_unit IS DISTINCT FROM NEW.units_per_sale_unit)
EXECUTE FUNCTION public.assert_on_parcel_size226_internal();

CREATE FUNCTION public.finalize_import_flavor_identity226(
  p_flavor_product_id uuid,
  p_expected_updated_at timestamptz,
  p_sku text,
  p_barcode text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  prior public.products%ROWTYPE;
  saved public.products%ROWTYPE;
BEGIN
  PERFORM public.assert_erp_role(ARRAY['owner'], 'تثبيت رمز النكهة وباركودها عند الاستيراد');
  PERFORM public.go_live_assert_setup_open_internal();
  PERFORM sales_lite1.lock_mode();
  IF sales_lite1.enabled() THEN
    RAISE EXCEPTION 'PRODUCT_IMPORT226_ON_REQUIRED';
  END IF;
  PERFORM public.product_edit_assert_version_internal(p_flavor_product_id, p_expected_updated_at);

  SELECT * INTO STRICT prior FROM public.products WHERE id = p_flavor_product_id;
  IF prior.flavor_master_product_id IS NULL OR prior.is_flavor_master THEN
    RAISE EXCEPTION 'PRODUCT_IMPORT226_FLAVOR_REQUIRED';
  END IF;

  UPDATE public.products
  SET sku = btrim(p_sku), barcode = nullif(btrim(p_barcode), ''), updated_at = now()
  WHERE id = prior.id
  RETURNING * INTO STRICT saved;

  -- The canonical identifier and inheritance triggers still run. Refuse the
  -- edit if those triggers would also change non-identity metadata.
  IF (to_jsonb(saved) - ARRAY['sku', 'barcode', 'updated_at'])
     IS DISTINCT FROM (to_jsonb(prior) - ARRAY['sku', 'barcode', 'updated_at'])
  THEN
    RAISE EXCEPTION 'PRODUCT_IMPORT226_FLAVOR_METADATA_CHANGED';
  END IF;

  INSERT INTO public.audit_logs(user_id, action, entity_name, entity_id, details)
  VALUES (auth.uid(), 'FINALIZE_IMPORT_FLAVOR_IDENTITY226', 'products', saved.id,
    jsonb_build_object(
      'before', jsonb_build_object('sku', prior.sku, 'barcode', prior.barcode),
      'after', jsonb_build_object('sku', saved.sku, 'barcode', saved.barcode)
    ));
  RETURN jsonb_build_object('success', true, 'productId', saved.id, 'updatedAt', saved.updated_at);
END;
$$;

ALTER FUNCTION public.finalize_import_flavor_identity226(uuid, timestamptz, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.finalize_import_flavor_identity226(uuid, timestamptz, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.finalize_import_flavor_identity226(uuid, timestamptz, text, text)
  TO authenticated;

-- v6 and v7 use the existing definer-owned writers internally.
REVOKE EXECUTE ON FUNCTION public.update_product_master_v4(
  uuid, timestamptz, text, text, text, text, uuid, uuid, uuid, uuid,
  integer, bigint, uuid, integer, bigint, bigint, integer, integer, boolean, text
) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_product_master_v5(
  uuid, timestamptz, text, text, text, text, uuid, uuid, uuid, uuid,
  integer, bigint, uuid, integer, bigint, bigint, integer, integer, boolean, text, boolean
) FROM PUBLIC, anon, authenticated;

COMMIT;
