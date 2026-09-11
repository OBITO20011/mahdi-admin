-- Enforce one canonical, race-safe identifier namespace for products.
BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';

-- Production must be audited before this migration. Fail closed instead of
-- rewriting business product data if an unexpected legacy value is present.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.products
    WHERE sku IS NULL
       OR BTRIM(sku) = ''
       OR sku <> UPPER(BTRIM(sku))
  ) THEN
    RAISE EXCEPTION
      'SKU preflight failed: blank, padded, or non-canonical values exist.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.products
    GROUP BY UPPER(BTRIM(sku))
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'SKU preflight failed: normalized duplicates exist.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.products
    WHERE barcode IS NOT NULL
      AND (BTRIM(barcode) = '' OR barcode <> BTRIM(barcode))
  ) THEN
    RAISE EXCEPTION
      'Barcode preflight failed: blank or padded values exist.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.products
    WHERE NULLIF(BTRIM(barcode), '') IS NOT NULL
    GROUP BY LOWER(BTRIM(barcode))
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Barcode preflight failed: normalized duplicates exist.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.products
    WHERE is_flavor_master = true
      AND barcode IS NOT NULL
  ) THEN
    RAISE EXCEPTION
      'Flavor-master preflight failed: a grouping product has a barcode.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.products sku_product
    JOIN public.products barcode_product
      ON sku_product.id <> barcode_product.id
     AND LOWER(BTRIM(sku_product.sku)) =
         LOWER(BTRIM(barcode_product.barcode))
    WHERE NULLIF(BTRIM(barcode_product.barcode), '') IS NOT NULL
  ) THEN
    RAISE EXCEPTION
      'Identifier preflight failed: a SKU collides with another product barcode.';
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS products_sku_normalized_key
  ON public.products ((UPPER(BTRIM(sku))));

CREATE UNIQUE INDEX IF NOT EXISTS products_barcode_normalized_key
  ON public.products ((LOWER(BTRIM(barcode))))
  WHERE NULLIF(BTRIM(barcode), '') IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.products'::regclass
      AND conname = 'products_sku_canonical_check'
  ) THEN
    ALTER TABLE public.products
      ADD CONSTRAINT products_sku_canonical_check
      CHECK (sku = UPPER(BTRIM(sku)) AND sku <> '');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.products'::regclass
      AND conname = 'products_barcode_canonical_check'
  ) THEN
    ALTER TABLE public.products
      ADD CONSTRAINT products_barcode_canonical_check
      CHECK (
        barcode IS NULL
        OR (barcode = BTRIM(barcode) AND barcode <> '')
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.products'::regclass
      AND conname = 'products_flavor_master_no_barcode_check'
  ) THEN
    ALTER TABLE public.products
      ADD CONSTRAINT products_flavor_master_no_barcode_check
      CHECK (NOT is_flavor_master OR barcode IS NULL);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_product_identifier_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sku TEXT := UPPER(BTRIM(NEW.sku));
  v_barcode TEXT := NULLIF(BTRIM(NEW.barcode), '');
  v_barcode_normalized TEXT;
  v_lock_key TEXT;
BEGIN
  IF v_sku IS NULL OR v_sku = '' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'رمز الصنف SKU مطلوب.',
      CONSTRAINT = 'products_sku_canonical_check';
  END IF;

  IF COALESCE(NEW.is_flavor_master, false) AND v_barcode IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'المنتج الأساسي للنكهات للتجميع فقط ولا يحمل باركود بيع.',
      CONSTRAINT = 'products_flavor_master_no_barcode_check';
  END IF;

  NEW.sku := v_sku;
  NEW.barcode := v_barcode;
  v_barcode_normalized := LOWER(v_barcode);

  -- Serialize every normalized identifier before checking the shared SKU /
  -- barcode namespace. Sorted acquisition prevents inverse-pair deadlocks.
  FOR v_lock_key IN
    SELECT DISTINCT identifier
    FROM (
      VALUES (LOWER(v_sku)), (v_barcode_normalized)
    ) AS identifiers(identifier)
    WHERE identifier IS NOT NULL
    ORDER BY identifier
  LOOP
    PERFORM pg_advisory_xact_lock(
      hashtextextended('product_identifier:' || v_lock_key, 0)
    );
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM public.products product
    WHERE product.id IS DISTINCT FROM NEW.id
      AND UPPER(BTRIM(product.sku)) = v_sku
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23505',
      MESSAGE = 'رمز الصنف SKU مستخدم بالفعل لمنتج آخر.',
      CONSTRAINT = 'products_sku_normalized_key';
  END IF;

  IF v_barcode_normalized IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.products product
    WHERE product.id IS DISTINCT FROM NEW.id
      AND LOWER(BTRIM(product.barcode)) = v_barcode_normalized
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23505',
      MESSAGE = 'الباركود مستخدم بالفعل لمنتج آخر.',
      CONSTRAINT = 'products_barcode_normalized_key';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.products product
    WHERE product.id IS DISTINCT FROM NEW.id
      AND NULLIF(BTRIM(product.barcode), '') IS NOT NULL
      AND LOWER(BTRIM(product.barcode)) = LOWER(v_sku)
  ) OR (
    v_barcode_normalized IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.products product
      WHERE product.id IS DISTINCT FROM NEW.id
        AND LOWER(BTRIM(product.sku)) = v_barcode_normalized
    )
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23505',
      MESSAGE = 'لا يمكن استخدام نفس الرقم كـSKU لمنتج وباركود لمنتج آخر.',
      CONSTRAINT = 'product_identifier_cross_collision';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_product_identifier_integrity()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_products_00_identifier_integrity
  ON public.products;
CREATE TRIGGER trg_products_00_identifier_integrity
BEFORE INSERT OR UPDATE OF sku, barcode, is_flavor_master
ON public.products
FOR EACH ROW
EXECUTE FUNCTION public.enforce_product_identifier_integrity();

COMMENT ON FUNCTION public.enforce_product_identifier_integrity() IS
  'Canonicalizes SKU/barcode and prevents normalized or cross-field product identifier collisions with advisory-lock concurrency safety.';

COMMENT ON INDEX public.products_sku_normalized_key IS
  'Case- and whitespace-normalized uniqueness for required product SKUs.';

COMMENT ON INDEX public.products_barcode_normalized_key IS
  'Case- and whitespace-normalized uniqueness for nonblank optional product barcodes.';

COMMIT;
