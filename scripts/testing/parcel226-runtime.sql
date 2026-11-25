-- Run only inside the isolated 226 test transaction.
INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
VALUES
  ('92622600-0000-4000-8000-000000000001','authenticated','authenticated','parcel226-owner@example.test',NOW(),'{}','{}'),
  ('92622600-0000-4000-8000-000000000002','authenticated','authenticated','parcel226-viewer@example.test',NOW(),'{}','{}');
INSERT INTO public.profiles(id,full_name,is_active)
VALUES ('92622600-0000-4000-8000-000000000001','مالك الاختبار',true),
       ('92622600-0000-4000-8000-000000000002','مستخدم الاختبار',true);
INSERT INTO public.roles(code,name_ar) VALUES ('owner','مالك النظام') ON CONFLICT(code) DO NOTHING;
INSERT INTO public.user_roles(user_id,role_id)
SELECT '92622600-0000-4000-8000-000000000001',id FROM public.roles WHERE code='owner';
INSERT INTO public.units(id,code,name_ar)
VALUES ('92622600-0000-4000-8000-000000000010','TEST226-BOX','صندوق الاختبار'),
       ('92622600-0000-4000-8000-000000000011','TEST226-SINGLE','باكيت الاختبار');
INSERT INTO public.categories(id,code,name_ar,is_active)
VALUES ('92622600-0000-4000-8000-000000000012','TEST226','فئة الاختبار',true);
INSERT INTO public.branches(id,code,name_ar,is_active)
VALUES ('92622600-0000-4000-8000-000000000020','TEST226','فرع الاختبار',true);
INSERT INTO public.warehouses(id,branch_id,code,name_ar,is_active)
VALUES ('92622600-0000-4000-8000-000000000021','92622600-0000-4000-8000-000000000020','TEST226','مستودع الاختبار',true);

SELECT set_config('request.jwt.claims',
  '{"sub":"92622600-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',true);
SET LOCAL ROLE authenticated;

DO $proof$
DECLARE
  category uuid;
  base_unit uuid;
  carton uuid;
  warehouse uuid;
  family uuid;
  flavors uuid[];
  flavor public.products%ROWTYPE;
  master public.products%ROWTYPE;
  saved jsonb;
BEGIN
  SELECT id INTO STRICT category FROM public.categories WHERE code='TEST226';
  SELECT id INTO STRICT base_unit FROM public.units WHERE code='TEST226-SINGLE';
  SELECT id INTO STRICT carton FROM public.units WHERE code='TEST226-BOX';
  SELECT id INTO STRICT warehouse FROM public.warehouses WHERE code='TEST226';

  saved := public.create_product_family_with_flavors_v4(
    p_sku => 'TEST226-FAMILY', p_name_ar => 'عائلة اختبار 226',
    p_category_id => category, p_unit_id => base_unit, p_purchase_unit_id => base_unit,
    p_units_per_purchase_unit => 1, p_default_purchase_price_in_minor_units => 500,
    p_sale_unit_id => base_unit, p_units_per_sale_unit => 1,
    p_default_sale_price_in_minor_units => 1000, p_sale_price_in_minor_units => 1000,
    p_cost_price_in_minor_units => 500, p_warehouse_id => warehouse,
    p_flavors => '[{"nameAr":"أ","openingSalePackages":0},{"nameAr":"ب","openingSalePackages":0}]');
  family := (saved->>'productId')::uuid;
  SELECT array_agg(id ORDER BY id) INTO flavors
    FROM public.products WHERE flavor_master_product_id=family;
  IF cardinality(flavors) IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'TEST226_FAMILY_CREATE';
  END IF;

  BEGIN
    PERFORM public.save_product_parcel_configuration_v1(family,'configurable_mix',true,7,flavors);
    SET CONSTRAINTS public.trg_assert_on_parcel_size226 IMMEDIATE;
    RAISE EXCEPTION 'TEST226_INVALID_COUNT_ACCEPTED';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'PRICES225_DISTINCT_PARCEL_UNIT_REQUIRED:%' THEN RAISE; END IF;
  END;
  IF (SELECT count(*) FROM public.products WHERE id=family OR id=ANY(flavors)) <> 3
     OR EXISTS(SELECT 1 FROM public.products WHERE (id=family OR id=ANY(flavors))
        AND (units_per_sale_unit,sale_price_in_minor_units,default_sale_price_in_minor_units) IS DISTINCT FROM (1,1000::bigint,1000::bigint))
     OR EXISTS(SELECT 1 FROM public.product_parcel_configurations WHERE family_product_id=family)
  THEN
    RAISE EXCEPTION 'TEST226_REJECTION_NOT_ATOMIC';
  END IF;

  SELECT * INTO STRICT master FROM public.products WHERE id=family;
  PERFORM public.update_product_master_v7(
    master.id,master.updated_at,master.sku,master.barcode,master.name_ar,master.description,
    master.category_id,master.brand_id,master.unit_id,master.purchase_unit_id,
    master.units_per_purchase_unit,master.default_purchase_price_in_minor_units,
    carton,12,11000,master.cost_price_in_minor_units,master.min_stock_level,master.max_stock_level,
    master.is_active,NULL,1000,false,true);
  SET CONSTRAINTS public.trg_assert_on_parcel_size226 IMMEDIATE;
  SET CONSTRAINTS public.trg_assert_on_parcel_size226 DEFERRED;
  PERFORM public.save_product_parcel_configuration_v1(family,'configurable_mix',true,12,flavors);

  BEGIN
    PERFORM public.save_product_parcel_configuration_v1(family,'configurable_mix',true,7,flavors);
    SET CONSTRAINTS public.trg_assert_on_parcel_size226 IMMEDIATE;
    RAISE EXCEPTION 'TEST226_OVERPRICED_PARCEL_ACCEPTED';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'PRICES225_PARCEL_PRICE_TOO_HIGH:%' THEN RAISE; END IF;
  END;

  SELECT * INTO STRICT flavor FROM public.products WHERE id=flavors[1];
  BEGIN
    PERFORM public.finalize_import_flavor_identity226(flavor.id,flavor.updated_at-interval '1 second',
      'TEST226-STALE','000226001');
    RAISE EXCEPTION 'TEST226_STALE_IMPORT_ACCEPTED';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'PRODUCT_EDIT_CONFLICT:%' THEN RAISE; END IF;
  END;
  saved := public.finalize_import_flavor_identity226(flavor.id,flavor.updated_at,
    'TEST226-IMPORTED','000226002');
  IF (saved->>'success')::boolean IS DISTINCT FROM true OR (saved->>'productId')::uuid IS DISTINCT FROM flavor.id
     OR NOT EXISTS(SELECT 1 FROM public.products WHERE id=flavor.id AND sku='TEST226-IMPORTED' AND barcode='000226002')
     OR EXISTS(SELECT 1 FROM public.products WHERE (id=family OR id=ANY(flavors))
        AND (units_per_sale_unit,sale_price_in_minor_units,default_sale_price_in_minor_units) IS DISTINCT FROM (12,1000::bigint,11000::bigint))
  THEN
    RAISE EXCEPTION 'TEST226_IMPORT_CHANGED_PRICES_OR_MISSED_IDENTITY';
  END IF;
END;
$proof$;

RESET ROLE;
DO $access$
DECLARE writer record;
BEGIN
 FOR writer IN
  SELECT oid,proname FROM pg_proc WHERE pronamespace='public'::regnamespace
    AND proname IN ('update_product_master_v4','update_product_master_v5')
 LOOP
  IF has_function_privilege('authenticated',writer.oid,'EXECUTE')
     OR has_function_privilege('anon',writer.oid,'EXECUTE')
  THEN
    RAISE EXCEPTION 'TEST226_LEGACY_EXECUTE_REMAINS: %', writer.proname;
  END IF;
 END LOOP;
 IF NOT has_function_privilege('authenticated','public.finalize_import_flavor_identity226(uuid,timestamptz,text,text)','EXECUTE')
    OR has_function_privilege('anon','public.finalize_import_flavor_identity226(uuid,timestamptz,text,text)','EXECUTE')
 THEN RAISE EXCEPTION 'TEST226_IMPORT_EXECUTE_GRANT'; END IF;
END;
$access$;
