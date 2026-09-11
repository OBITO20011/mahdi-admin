-- Destructive fixtures run only in the disposable isolated Supabase database.
BEGIN;

CREATE TEMP TABLE product_identifier_runtime_results (
  scenario TEXT PRIMARY KEY,
  passed BOOLEAN NOT NULL
) ON COMMIT DROP;

INSERT INTO public.products (id, sku, barcode, name_ar)
VALUES (
  '81000000-0000-4000-8000-000000000001',
  '  runtime-sku-one  ',
  '  Runtime-Barcode-1  ',
  'Runtime regular product'
);

INSERT INTO product_identifier_runtime_results
VALUES (
  'canonical_insert',
  (SELECT sku = 'RUNTIME-SKU-ONE' AND barcode = 'Runtime-Barcode-1'
   FROM public.products
   WHERE id = '81000000-0000-4000-8000-000000000001')
);

DO $$
BEGIN
  BEGIN
    INSERT INTO public.products (sku, name_ar)
    VALUES (' runtime-sku-one ', 'Duplicate SKU');
    INSERT INTO product_identifier_runtime_results VALUES ('duplicate_sku', false);
  EXCEPTION WHEN unique_violation THEN
    INSERT INTO product_identifier_runtime_results
    VALUES ('duplicate_sku', SQLERRM LIKE '%SKU%مستخدم بالفعل%');
  END;

  BEGIN
    INSERT INTO public.products (sku, barcode, name_ar)
    VALUES ('RUNTIME-SKU-TWO', ' runtime-barcode-1 ', 'Duplicate barcode');
    INSERT INTO product_identifier_runtime_results VALUES ('duplicate_barcode', false);
  EXCEPTION WHEN unique_violation THEN
    INSERT INTO product_identifier_runtime_results
    VALUES ('duplicate_barcode', SQLERRM LIKE '%الباركود مستخدم بالفعل%');
  END;

  BEGIN
    INSERT INTO public.products (sku, name_ar)
    VALUES ('runtime-barcode-1', 'SKU to barcode collision');
    INSERT INTO product_identifier_runtime_results VALUES ('sku_to_barcode_collision', false);
  EXCEPTION WHEN unique_violation THEN
    INSERT INTO product_identifier_runtime_results
    VALUES ('sku_to_barcode_collision', SQLERRM LIKE '%نفس الرقم%');
  END;

  BEGIN
    INSERT INTO public.products (sku, barcode, name_ar)
    VALUES ('RUNTIME-SKU-THREE', 'runtime-sku-one', 'Barcode to SKU collision');
    INSERT INTO product_identifier_runtime_results VALUES ('barcode_to_sku_collision', false);
  EXCEPTION WHEN unique_violation THEN
    INSERT INTO product_identifier_runtime_results
    VALUES ('barcode_to_sku_collision', SQLERRM LIKE '%نفس الرقم%');
  END;

  BEGIN
    INSERT INTO public.products (sku, name_ar)
    VALUES ('   ', 'Blank SKU');
    INSERT INTO product_identifier_runtime_results VALUES ('blank_sku_rejected', false);
  EXCEPTION WHEN check_violation THEN
    INSERT INTO product_identifier_runtime_results
    VALUES ('blank_sku_rejected', SQLERRM LIKE '%SKU مطلوب%');
  END;

  BEGIN
    INSERT INTO public.products (sku, barcode, name_ar, is_flavor_master)
    VALUES ('RUNTIME-MASTER-BAD', 'MASTER-BARCODE', 'Bad master', true);
    INSERT INTO product_identifier_runtime_results VALUES ('master_barcode_rejected', false);
  EXCEPTION WHEN check_violation THEN
    INSERT INTO product_identifier_runtime_results
    VALUES ('master_barcode_rejected', SQLERRM LIKE '%لا يحمل باركود%');
  END;
END;
$$;

INSERT INTO public.products (id, sku, name_ar, is_flavor_master)
VALUES (
  '81000000-0000-4000-8000-000000000010',
  'RUNTIME-MASTER',
  'Runtime flavor master',
  true
);

INSERT INTO product_identifier_runtime_results
VALUES (
  'master_without_barcode',
  (SELECT is_flavor_master AND barcode IS NULL
   FROM public.products
   WHERE id = '81000000-0000-4000-8000-000000000010')
);

INSERT INTO public.products (
  id, sku, barcode, name_ar, flavor_master_product_id, flavor_name_ar
)
VALUES (
  '81000000-0000-4000-8000-000000000011',
  'RUNTIME-CHILD',
  'CHILD-BARCODE',
  'Runtime flavor child',
  '81000000-0000-4000-8000-000000000010',
  'Child'
);

INSERT INTO product_identifier_runtime_results
VALUES (
  'flavor_child_identifier',
  (SELECT
     flavor_master_product_id = '81000000-0000-4000-8000-000000000010'
     AND sku = 'RUNTIME-CHILD'
     AND barcode = 'CHILD-BARCODE'
   FROM public.products
   WHERE id = '81000000-0000-4000-8000-000000000011')
);

INSERT INTO public.products (id, sku, barcode, name_ar)
VALUES (
  '81000000-0000-4000-8000-000000000020',
  'RUNTIME-EDIT-TARGET',
  'EDIT-BARCODE',
  'Runtime edit target'
);

DO $$
BEGIN
  BEGIN
    INSERT INTO public.products (
      sku, name_ar, flavor_master_product_id, flavor_name_ar
    ) VALUES (
      ' runtime-child ',
      'Duplicate child SKU',
      '81000000-0000-4000-8000-000000000010',
      'Duplicate SKU child'
    );
    INSERT INTO product_identifier_runtime_results VALUES ('child_to_child_sku_duplicate', false);
  EXCEPTION WHEN unique_violation THEN
    INSERT INTO product_identifier_runtime_results VALUES ('child_to_child_sku_duplicate', true);
  END;

  BEGIN
    INSERT INTO public.products (
      sku, barcode, name_ar, flavor_master_product_id, flavor_name_ar
    ) VALUES (
      'RUNTIME-SECOND-CHILD',
      ' child-barcode ',
      'Duplicate child barcode',
      '81000000-0000-4000-8000-000000000010',
      'Duplicate barcode child'
    );
    INSERT INTO product_identifier_runtime_results VALUES ('child_to_child_barcode_duplicate', false);
  EXCEPTION WHEN unique_violation THEN
    INSERT INTO product_identifier_runtime_results VALUES ('child_to_child_barcode_duplicate', true);
  END;

  BEGIN
    INSERT INTO public.products (sku, barcode, name_ar)
    VALUES ('RUNTIME-REGULAR', ' child-barcode ', 'Regular versus child barcode');
    INSERT INTO product_identifier_runtime_results VALUES ('regular_to_child_barcode_duplicate', false);
  EXCEPTION WHEN unique_violation THEN
    INSERT INTO product_identifier_runtime_results VALUES ('regular_to_child_barcode_duplicate', true);
  END;

  BEGIN
    UPDATE public.products
    SET sku = ' runtime-sku-one '
    WHERE id = '81000000-0000-4000-8000-000000000020';
    INSERT INTO product_identifier_runtime_results VALUES ('duplicate_sku_edit', false);
  EXCEPTION WHEN unique_violation THEN
    INSERT INTO product_identifier_runtime_results VALUES ('duplicate_sku_edit', true);
  END;

  BEGIN
    UPDATE public.products
    SET barcode = ' runtime-barcode-1 '
    WHERE id = '81000000-0000-4000-8000-000000000020';
    INSERT INTO product_identifier_runtime_results VALUES ('duplicate_barcode_edit', false);
  EXCEPTION WHEN unique_violation THEN
    INSERT INTO product_identifier_runtime_results VALUES ('duplicate_barcode_edit', true);
  END;
END;
$$;

UPDATE public.products
SET sku = '  runtime-updated  ', barcode = '   '
WHERE id = '81000000-0000-4000-8000-000000000001';

INSERT INTO product_identifier_runtime_results
VALUES (
  'canonical_update',
  (SELECT sku = 'RUNTIME-UPDATED' AND barcode IS NULL
   FROM public.products
   WHERE id = '81000000-0000-4000-8000-000000000001')
);

INSERT INTO product_identifier_runtime_results
VALUES (
  'normalized_indexes',
  to_regclass('public.products_sku_normalized_key') IS NOT NULL
  AND to_regclass('public.products_barcode_normalized_key') IS NOT NULL
);

INSERT INTO product_identifier_runtime_results
VALUES (
  'trigger_is_private',
  NOT has_function_privilege(
    'authenticated',
    'public.enforce_product_identifier_integrity()',
    'EXECUTE'
  )
);

SELECT json_build_object(
  'runtime_scenarios', COUNT(*),
  'passed', COUNT(*) FILTER (WHERE passed),
  'unexpected_failures', COUNT(*) FILTER (WHERE NOT passed)
)
FROM product_identifier_runtime_results;

ROLLBACK;
