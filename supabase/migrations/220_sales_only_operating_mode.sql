--220: approved sales-only mode, shared ledger;627 original bodies remain byte-identical.
--Owner10Nov: PR79 deferred to221;no full H1/M01/supplier-order changes here.
--Historical QUARANTINED comments below identify preserved prototype source provenance.
BEGIN;
DO $migration220$ BEGIN
 IF (SELECT count(*) FROM supabase_migrations.schema_migrations)<>180 OR (SELECT max(version::integer) FROM supabase_migrations.schema_migrations)<>219 THEN RAISE EXCEPTION 'LITE220_EXACT219_HISTORY_REQUIRED';END IF;
 IF (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace)<>636 OR to_regnamespace('sales_lite1') IS NOT NULL OR to_regnamespace('sales_lite2') IS NOT NULL THEN RAISE EXCEPTION 'LITE220_CLEAN219_REQUIRED';END IF;
 END $migration220$;
DO $frozen220_before$ DECLARE mismatches BIGINT; frankfurt_matches BIGINT; BEGIN
 WITH expected(signature,source_hash,definition_hash,owner_name,config,acl) AS(VALUES
('_archive_supplier_receipt_impl(uuid,boolean)','0307f405475c908e3e5eca343e6833c6713f813d6755c03705e0790d6ee7b572','0fa8d35048847084afde6de1433d4fa843c337754f8de2cba4b8d82cdd6ce2f1','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('_build_business_summary_before133(text,date,date,timestamp with time zone)','b01e43721599a9191e4ba41d76f7448b50044b15d53d2e56baa6bf44de4c6f52','9d5497c4ea3e979a326d580233c99180f4d88b93e4fcf6707f94fdb5cac913f7','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('_build_business_summary_before_phase6(text,date,date,timestamp with time zone)','4b5bb0ae5e98976b0a1894cd0c274c4f4ecc0348ad91877a5b0173bd27e0981c','3fd7ce7540054283e4f34bcc5be8487eb7ca1fd782fdfc7e699ab6be90e0770a','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('_calculate_guest_promotion(text,jsonb,text)','5f0826f4419e1439085b97b8f9a34ae870304f73f0cd913ac2d27f1b263ff110','8dbaa5e94fca0343fcdea488c7be344f9f163a77825f2925d05a0a24db43431c','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('_cancel_empty_cash_shift_before_return_events(uuid,text)','981240dd331e0ac283c16aa8209c05a3b2f48f827432ba1244a4e57709007cf4','52eff974919feef6bfe9974cee3460cbdad5cb62535b7b99c4defa45f47171a4','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('_cancel_order_impl(uuid,text)','e99f70493d0ebf2d7f0ee5fe97ff2b6654df6621ae3ef7082a16d4b8a1387b2b','64ed343a18e14535206555630cc6c154a1cb898f718e8f812af8a89aaa406ade','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('_cancel_order_impl_before_phase4_lock(uuid,text)','c42e39dfaa23b65fbe56c1098e2fe2f88a35320cd0a0a818d17e2904be69f833','a61f490e9b1975fca4dc86acc92a58d691795cd82d3dff661289120bd6e1b5e9','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('_cancel_purchase_receipt_v2_before_phase4_lock(uuid,text)','257528fcbd2103c26c923b968b1fb7102416fa154b1c67e95a65b34ad2d1a339','950c2d3131ed4780e0660b273e783cb0acf5c41dc1f49ca5bb5a410adb09c7dc','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('_cancel_supplier_receipt_before_phase4_lock(uuid,text)','655357651546810c11209f5f0ca42d288123d9eb4676336ee62d7385f614d88e','d5aeaa0a33caa98e1d165720f07e8ef471a43c75318fa8aa96b79cd680a9211e','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('_cancel_supplier_receipt_impl(uuid,text)','2eba4b4b2e428673b97b162b5921e04cc925cd8cec56c3f7dd0f542c06c20081','17091b890899da482ac854bf4399e734000c0bb5cb98f0ca6cb97dcdc6df3b54','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('_cancel_supplier_receipt_legacy_guarded_v2(uuid,text)','be3b598eac64ed8639647f9ded79afceb518adc1cb19b7eaadc5c90b7100a9bf','14e9adef4f8b078c573800efa6a22c20ff23b382456474ffcbd8803d82126eba','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('_close_cash_shift_before_closing_report_snapshot(uuid,bigint,text)','c99c381e329c21e528ffef454405f58f71212503b5d2fb8c20bb3ba81c0f5914','dc9458b135cba7cd9aadb7aa8acf33cdb115ea72c977ad3ec22e783a721e61d7','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('_complete_order_impl(uuid,text)','8e8559c46e89768a30e670995c0dbee0b4810fb24ea721ea7eed9642316b654f','637db9ed1559e02b016e6ae49547e4c244aab466f177bd29bb32e14033fb305e','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('_complete_order_impl_before_phase4_lock(uuid,text)','9abfe62b99f019cd0be7649ec989de20efcdbc5bfacf8ed242b3dea323306abb','b291739b378a84d436ae0354c9b8b586ac2e8c87cde571f262423c9a78f0cac8','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('_complete_website_order_with_settlement_before_phase4_lock(uuid,text,bigint,bigint,text,text)','2f9aabb48e2cd28f0a88604dffa336e57e39f0336f505f18a94f54d511a8ee87','04e9d34af947f5d8216b053d98be42baec318d2c84b870d750654d3dfe96dafb','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('_complete_website_order_with_settlement_v2_before_phase4_lock(uuid,text,text,bigint,bigint,text,text)','5ab09f9426b691dbe1af0ca4935ea461499d6f429ab082399799241a1e308a33','c5ad64540fb73c85b72beb09e0269b23e17b3711b6592721577ba044e2ed3675','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('_confirm_order_impl(uuid,text)','0637dfe3f730e8ed70a02b8d9dfd67d50de3493440d24e11cc132d9378e6a81f','86be3e832bf328d590ad8c0333b5c23dc04c69341c1cac493dda2f40042cf7f4','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('_create_direct_supplier_receipt_impl(uuid,uuid,uuid,text,date,timestamp with time zone,bigint,bigint,bigint,bigint,text,text,text,text,uuid,jsonb)','a4230edfd2ab12741f8f1f0dc4a2f199d3a7c39b40c472a2256dd5250b44e657','2f5378e72513008621a454ca03f1f37ea0a583738d16e196ae21340a24672c6d','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('_create_pos_sale_base_units_before_phase3_lock(uuid,uuid,uuid,text,text,jsonb,bigint,bigint,text)','552effd40c17a3bb7f6833bdfb91cb7e5eda1617cc7dfcb89159882aea9857cf','fdaedd1b3732424dd8734fc3ede3af94ab7abad84578db3f3bad0efcb89e391a','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('_create_pos_sale_package_legacy(uuid,uuid,uuid,text,text,jsonb,bigint,bigint,text)','a2255860d58bd55f926f800364d401a9dc604d45ff11c5df3e8d772a8d1ea573','852096efb2252e5aa0dbcb6993907d39e27b8a0225b7ae4b8a57014fc85e34a0','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('_create_pos_sale_v2_before_registered_customer_lock(uuid,uuid,uuid,text,text,jsonb,bigint,bigint,text)','035722f38503a2416fe0ad0b067d2bd5309d732026047f76b81ae76ee7fbe3b7','590508615323dd1bf11cba9a265126842174edc12a8df52651e7b2df01f23126','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('_create_product_with_opening_stock_impl(text,text,text,text,uuid,uuid,uuid,uuid,integer,bigint,bigint,bigint,integer,integer,uuid,integer,text)','9161e9574030cda6056ea178226a5233ada0a64ffbe49c983be4e21a9546d08e','7f64eb63af63f93410aa9701b0b9e1fadd66a60bc3e0fa1fc439682c07a4d4f8','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('_create_purchase_order_impl(uuid,uuid,uuid,timestamp with time zone,bigint,bigint,text,text,text,jsonb)','824ed62ddeaaf41ade8d1e503c282666742cdbf57d636fc65d310c5be73b10d8','30664a61f4cf8c4dea8692143fcffb6df20b3e977828ef1a22264c02de518719','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('_get_cash_shift_closing_report_before_return_events(uuid)','b9d9656f6ad829cb1fac20c5a9826cca46a53b83c98b7f52b867b063b3601651','5f847b1e6076d9f3d557d1e4680ba6159afeb8b7aa5f0dd32c57b78e14ae6036','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('_get_cash_shift_closing_report_before_snapshot(uuid)','977cfbfb377518be210c092218cb624a26d67a74571613c2f8f26f5adad9a37e','e6d913885e16c6e292417f81eb7760aac4bf2dbbf2763a8bc26a7f6eb9359bac','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('_get_cash_shift_closing_report_v1(uuid)','b9f548ea48e85340c02ba2d77ab5bf70a57925962799bcb620d9ca5902f3e148','32c57160272d5971e652e374e1f2a10853a6b97b9f58a11c9e0efda858260b67','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('_get_cash_shift_summary_before_return_events(uuid)','a6f0984fbf13c24e50255d55b2fbb588ad0d8a5394df530af59ec83d1a04dcb7','fb70fb02d375e116d34136f46132141ee38512b207b23f22c4d104a448fc5a52','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('_get_cash_shift_summary_v1(uuid)','6a36717e52aa2776d7b2b9a214ed0ca3f69b347ba52e6cd133bed179168f4f8a','3668fb35c9f22b7e1c3655a3b27a784865aa10212befb9b60ae162c01919615d','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('_get_crm_customer_detail_page_before_phase42_receivables(uuid,integer,integer)','432318a880f915d5a2133e87aa51360d18096a7684982f0f42f004e4ecd138d4','d8e81b655b6851ca7f47fadf333001fd7dd51f393ba21ddac37ebdf3a88fbd2a','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('_get_crm_customer_page_before_phase42_receivables(integer,integer,text,text,text)','bd07bb3502c61e970f63c2c6d46bf51898c12bc2c7acd34abf3111227d484542','65c81bbc6f1cca66d54248571562fe2b71bcc2c879fdd53bda5927a48e471a86','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('_get_expense_shift_center_v1(uuid,integer)','2b0d69b5e5f0a12be28efcd3b757663f337544ae056aaa5407c6c79603258ea7','5ae3b7b311271cc57996a4457674df7bbf7b714c04889ae88698c1a9d656a244','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('_get_home_dashboard_before133()','d8d11731fd29a1a273fd738446c80134000a4b74ca85bfdfd8ea63c61c78ffa8','1d01cec2ae84980f88171e4abaf82794a097c06e48b10379163c105a0d2722a8','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('_get_home_dashboard_before_phase6()','14da3b09ce3d54f092af74341a9d82925cdbc22057aa46ea7e440cb46727f897','432dfc3339885f4fbb747f926d4670e7cc7e76dceb8fef56ba4e92b7689508fd','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('_get_inventory_opening_setup_including_flavor_masters_v1(uuid)','a9035c5480d555f5da87c777040dadcaf2129f02e7e433e94f884997b18fe2e5','20868be93cfe748d8f30dcebc83f7402c55d3f9c0cfa0a4e3a6a6e1128c6d5d7','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('_get_operational_business_report_before133(uuid,date,date)','b597bb767101a149f6e6b9589a547ff5513843c74f8ec4ec52e8a9997d2d426a','9d00e3e8dde311abaad6f1950cab98515f7c3399bf2e7d17b9ad1071277ad071','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('_get_operational_business_report_before_phase6(uuid,date,date)','a8743f5853f500ae2b674c693a0b8428f0126f7994aaaccf8ad87487e6706f80','12fe8941a5ffe802bdbf96b0dceb1b457766be2f0a47c5fcfa0ac185c99b8386','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('_get_operational_business_report_v1(uuid,date,date)','1c91abaad54f0e41ecd23d7d0e766cafb4632335ad8d7810e24141b8cb02507d','91d8a89415d1d93aa629963323e8d1c4ae1ea0231b5009bbaaf5112e13da2725','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('_get_operational_business_report_v2(uuid,date,date)','8cdec3f55549e8d67e8d24ce0e0bc23e1b946f2d2257e152a5b1ce75c278592a','489c804026597de5e28be26f0eb589e01108ea14798106a9cd8af2a424b82833','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('_preview_cash_shift_full_reversal(uuid)','8df0c0b4559029df8d403f2afe992d72a9c24a70c4e2885ee584915724047aa6','c2330e66ebbcb36f8167c87e0ac298d50ff2ccf4556d87714c56c916f19f1104','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('_preview_cash_shift_full_reversal_before133(uuid)','4444d0186b97fb6b5a7c8a758fdf74413cd471f4ca493d1f259d0c524980d848','192f724814ffb1c84580413a7f83bd18d886b82485c785b4fc4ca353e73c97ea','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('_preview_cash_shift_full_reversal_before_paid_order_guard(uuid)','aaa92d260e46b7648d03ed70fab2f2af2ce25fedb969d0f2bbb5a230165fc32e','8b4ca152ec70641986e57a5123cdd7e6e4798d015e6baacaba27470eca889835','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('_receive_inventory_impl(uuid,uuid,integer,text,uuid,text)','2f660eb3e094b2538278bcdaef36b6878acd9972e8c184c296c7b1439bb8b9a5','c92d9b055a8e9b8e0b0ad157e9f610236bac31e7a2d1c23c9a1fc048600b8585','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('_receive_purchase_order_impl(uuid,uuid,text,text,jsonb)','01709a375da7952019fe71fa91b35ee15f7cc2273e432d9b231bb329aea7854c','0a541dfd6f4812ecca822625831bbf618a6006c22c8050f49b929cda8a2694f9','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('_record_customer_order_payment_before_phase42_financial_guard(uuid,bigint,text,text,text)','7c803cd2409d6b6e40a59a037359bf66a8960b3f27f4676d54975d75b596c945','9e5cea4becbd49ba71fd367897697e7b3bc0a363835d344463367b2a3d25ebf2','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('_record_customer_order_payment_before_phase4_lock(uuid,bigint,text,text,text)','d622f9c5d8a02520b653ee01e7a1f1ec23b91189de9e5f89dc0622929fa6aa16','7e7f32e0b9329dde0960a45212a83d9f38962de089ec70c6284ee7a195cd047e','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('_record_supplier_payment_idempotency_legacy(uuid,uuid,bigint,text,text,timestamp with time zone,text)','fccdbdaa04147905bfc150e65db7b42bef88ec48941076ebf556fbd9719d67b0','75eb3918e3c25e60790f2eecf4b010cb966fd7da8a58b2e5f7754af87f1a88c9','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('_record_supplier_payment_impl(uuid,uuid,bigint,text,text,timestamp with time zone,text)','0a3fad7eb377d4712c7c07858644113a46bc683df1866f4ed4c996d64e37b8b6','d1374578f702d7c09251aecaa1e1adf7e8bc5952c12d3f15dfb5f1368de18a35','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('_record_supplier_receipt_payment_idempotency_legacy(uuid,bigint,text,text,text)','addf5cef00e95e260c1faba844a9877c6fdd5649cb46ee484c5b1cb9e504760d','8eec6096f38e4e9323e9f80256efe8cd7f9ebfdd8d5254a9559a26a6c4fdb3ea','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('_record_supplier_receipt_payment_impl(uuid,bigint,text,text,text)','cdf61d824f4b8cba9f8706cab40efb7a06d26b41e4fea9abe0ec1762d7d3e452','9e17a07c703220aa50eaaf07b3278db121f4e23719e0d399c9c420668b0eb6b4','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('_return_completed_website_order_before_phase42_coordinator(uuid,text,text,text,text,text)','1b3590df77595c46acccb3431a2422f5822d5c13b1616f543acbca09ea73502e','c9b7a8c020169f5fb7e5ac7cbe7125f31b0cb7ee648866aae37de934e1f0d35f','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('_return_completed_website_order_before_phase4_lock(uuid,text,text,text,text,text)','f4d6dcb997fc4a429a7c8372f0ff6ac2251e0111f041dead3e63a99a176db28c','8b2367f8557000d97d6c83d272289f248bf4df155c32d7cc16105c848eeedd57','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('_reverse_cash_shift_with_operations_before_phase42_refund_guard(uuid,text,text)','3c71fa32ed70aa6d780954b78337398bf5b69fb7a265306bd50f0141906b708a','fc719df8804769420dd07894be8282f11d69dd0547a157f85b05c883bbba171d','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('_reverse_cash_shift_with_operations_before_phase4_lock(uuid,text,text)','455aa3add85f8dce1e38ba676d6e4147a5fa4e5b0d95a3cf1d8bdc1443e7cbe0','136f680c17927f7ec1248129acf9d4a9880d6d02679e6e9f45bab2418f064df4','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('_reverse_customer_order_payment_before_phase4_lock(uuid,text)','f884466d45fc2af049a51ca28e55038696ae693b5c97ba59afb9e530a0850586','3bc71937597f0b828fc0cfa48a4bb4f9de41f65626bb44839a2834d16a2792e6','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('_reverse_operational_expense_before_phase4_lock(uuid,text)','18f1765319d7b2c79b9c9386c6a9a68b4bf9703c0ab788cb0fa6725854275d6c','43999a98b2ec0ef661b5ace2cd62f57eb95c99848a1e3c47c88866c7b6f7e1a9','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('_reverse_supplier_payment_before_phase4_lock(uuid,text,text)','3f6430fd142c3eec52cc016543437657dbc73a2a8acd9249a84a500ca43fd622','5a946096d13324252f1520b84fcc8a190a0b07452119ff6180a9c508e3e8920d','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('_set_advanced_monitoring_check(text,text,text,text,text,integer,text,jsonb,timestamp with time zone)','f5f9d6977ed359c898b7b84ffb4390da3d624c688f4e5298bc365d56b38ac0f2','e4537130a5b7a826febeea690503c2929e08198a25cf1f84fa9b53a3ace05dfb','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('_submit_guest_customer_order_v1_before_phase3(text,text,text,text,text,text,text,text,text,text,double precision,double precision,text,jsonb,text,text,text)','30f6c6b42666e0faab5ce0e2be45b7578355ca29c1b5fe4f5b2494d5569b1af6','2068f9817b7a8a6a87ab53adc73058700b7975fa710b88b59d83e61b3733e014','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('_transfer_inventory_between_warehouses_phase2_legacy(uuid,uuid,uuid,integer,text,timestamp with time zone)','38435a5319305f156d0f972bf16460b7982369864e6453241ff96d5763062bcd','2803674c4daf75f4d9a589d785238b482e68ad2a681ee36b8c191cf9065e3200','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('_transition_business_alert_incident(text,text,uuid,boolean,timestamp with time zone,jsonb,boolean)','3c716d197df8cb33ea0c20da9e3a280aceac6938f7f707e923dda408e23fbcad','035ad576dd9b0c6d049d9b9f43602987715821a9fa986f147efa4433bf83b3e2','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('_update_order_status_impl(uuid,text,text)','ccc2373770e742b382ebab94846c82903d15b67345269431ab5ffebbd9c66f90','d857078c6b5f13d1637626d28bfd9ac5c1694377c3b2b59e9eaa155fe6a633c6','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('_update_purchase_order_status_impl(uuid,text,text)','1efb78f2325b7e813be9baebfdb2300b3f40ee44c424e5c44c3ce583fbd48f7d','ee20d500f9850a0425b1a85047c8f1299fedad07775073f8d42b7e11c1b19c17','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('accept_order_for_preparation(uuid,text)','88464a07ecc0310fff25a975966844b9fddc94786ce3477178e4bfdfbf48dd74','1879e61307e71d3150dffe0ec238bdc4a7ec050f0775a031e96f5c2f3b571f91','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('add_customer_address(uuid,text,text,text,text,text,text,text,text,double precision,double precision,boolean)','34b076d3f1cd2ff0e76932036b7735ee44e6a2fc36c78ae5625f123bb873178b','fc18f350c5522af8cbb69c4e80877a5485a84fd696c2a05b50076893c0a00c6f','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('adjust_inventory_stock(uuid,uuid,integer,text,text)','2bfa181c2b7782ac55b1d5c850f7af9672354f2f87e81a36813d6f497ad583f9','a109e350e3bc8e6b6b40c0963ccc3b3fde8e7357291d5b1bdb1b2f899e858207','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('aftercare211_assert_replacement_root_internal(uuid,integer)','c9b777eaecb078427d1d45aed427f1dcc4d78f44eb0e3bdc5049813e2245b692','82aca37d8da5df482ba59c0af7affc65b9fa6427102ab1ffd38d76238f123ff2','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('apply_inventory_opening_setup(uuid,jsonb,text,text)','ad15e0ff0e446d5203fc7bae70223a59cd24957d3799a5689ca444e2255a5faf','3062a2a65c67a0075a93dd73a35dd92fa342f734bfff91ff3bffe2c8f5e8b285','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('archive_supplier_receipt(uuid,boolean)','8ac810195addddf780c10e78d6bc47002185ed4cdd3d1c0af8d0fff1e88e00b1','e970551336e13f9ac5c5635a2b2845e90fa4dd977f91060ba908b6596d9d9a76','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('assert_closed_cash_shift_has_snapshot()','8e9800c59e2252d23478d5880f9a061b9c1eb81a1de90218586fa03aad290231','fad68d9c9b607d3ff83a290cdf058535e81e1a4c9bcce611c6470b428709c666','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('assert_configurable_parcel_creation_allowed()','90875cd1e8136293145646ea8f2a2b6c8b297cdad0532d0c7473a479d703323a','4fb03b24d2b04c40521bfb2553c2b91cc063b1a33e00ce241e27f2ee64491fdd','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('assert_erp_role(text[],text)','43ba25c28960e79ed99d1c02e530bbd765ad0c276daac192b943c85ebd7d5f62','6544d6eec04ac29c076f509af11b99d6f080578a3d2723df0679a72353fe354c','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('assert_monitoring_owner()','c15550542d3c37e7dfdf2deca529dab529c2eba4afe40eee26e95cdbaa9faa83','452dcceb675d65c469023e34cee3d4b465c8e4635a40ae0f421d6e706cb0825e','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('assert_order_parcel_composition_total()','8b854104f923175e45dd483e9b6e9ddc343422507de398bb524d94449bcfdcb9','51e1ea5d8a1cd2674da8426539af4da77c2d92e04c361f9193a23083e827485d','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('assert_phase2_receipt_reconciliation()','4ab06d43be86f88a459472fd1686792e36a64325fa60f5a3bfb175dfa42d512e','11faaa169f54c2a07b8e9bd7eb30546207779e90ce8197e120e5599b7954ca47','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('assert_reversal_owner(text)','7c281f0740088f8c04666ddb36c7c18687e64704d568ff05851bb1c05996e7b1','466e19412b67d06a77272cacdd35ed876ba6d487595fa63760c4a767958357b9','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('assign_inventory_movement_mutation_sequence()','36116406b2a8e6c40fbd66ed19249f0cc166cb5e131db07325fbba9e66cfea3c','5417c3ed893b48c98c67a33e9d66c475437746a778427c367ca7aa87fc9d68d6','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('attach_customer_payment_to_open_shift()','81ba6a38d6518f355b19b07d2a19ffb48aca42454d89dd7a8ae38ab1f5362578','48d8c55ad953c3b9d087c932890b354fbe60e10e3d493032e503381597449a1b','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('attach_open_cash_shift_to_pos_order()','d7beeaaa2c6cb3940bdec5a5ab7ce3eb61c2da7fa6c6aac201c39cea3373193b','b56102f6cbeb2acd4d04ca54a07bd33d5cfb7091e2cff92f4a81ded410c64afd','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('attach_supplier_payment_to_open_shift()','4ebe9cd878bb928c5730206bd14f924ce47625c3b8953e4b4607e1a22d133f3f','4035142cf6bcf34cb4fcc632a49a5f4c8cb5226d84ecb04fa0416f01b6da7674','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('authorize_admin_ai_assistant_request()','1442afa9e63a3c7cc87a8c8f78f5917960414809431aa800b5a83b7c8e22044f','24be232932cba4b9387cb178153d7866542713ee1da6ec86a238ad296e643741','postgres','["search_path=public"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('authorize_guest_order_gateway(uuid,text,text,text)','2a5ef29cf5efb2e798e947d9a204f4490afd492da8e43096be5dbd7966463ee4','3687f949c2d9cfac21787ad1e31becd64a6e5401bed833fd3f9d6df6c9864a09','postgres','["search_path=public, pg_temp","lock_timeout=3s","statement_timeout=5s"]'::jsonb,'{postgres=X/postgres,service_role=X/postgres}'),
('build_business_summary(text,date,date,timestamp with time zone)','80a9cf75ed63d8cb4059da12bef36357336d6c65b55a84e33f2f378a3b0161bb','647b3a8f8547a4491c7012468d829e02d199baa113eff9e5471903d4ab731628','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,service_role=X/postgres}'),
('build_public_order_tracking_payload(uuid)','99a3b263835c4cb1bbe85ab5e7979254650be657f8ff501bfafab336b9a8758e','081c97ab54c49d92db6bb59beec95a28065cce8fb1677aa719a393290bc1dbbf','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('cancel_customer_order_v2(uuid,text,text)','fd8b9fca84ddb2c871ea0d1f3ba844bccfa0d634734e50f81ffe60abe0f8291d','1fd06d5f391af914d1d8ffb666a817e8924aa2f17405c33ca7e3d0a5b3d505c2','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('cancel_deferred_cheque_v1(uuid,integer,text,text)','6a2dbcec3bf30e3c6aa10f33df7fa2b8c4e116090ce1ff550ac76d51cb2d1447','475167ffcc2cf76eba947efa0d7c521973b03b6402ea1334eed2fc175df549a8','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('cancel_empty_cash_shift(uuid,text)','510e84b27bdfdda7f9950fdff3731eae9295e8613b28887923bd2cdde8c474ab','0036eefc9a808a409350eb93028db0b859fd39e55ca2bac737d633649980d231','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('cancel_order(uuid,text)','84098d1b0f3902b7ca879afa4fa9b0ab20bc4c3990e57bad8da1ebb33aa84430','36d6c96c4d086f9bc47434db1c1d058812c8ad3907c8a95ef72ffbd4a736bf43','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('cancel_purchase_order(uuid,text)','6ecbaded23dfbf33a617fe6890db62cd0470adf19ca9742e958900660e9d54e1','bb32f76e503888b2d121384ce8aa0f7ca8270caa1b86d962334e80b375d498ec','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('cancel_purchase_receipt_v2(uuid,text)','68b19fa86284d38468bbeec1356914c0dd8d09c480fdc57fd9e3639b0f2902ef','246cc1d2a58494fd9b94e43eb523205d1bf722caec22f8e8ae36c8475d5aec08','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('cancel_supplier_receipt(uuid,text)','5bf1438714ce14d87d1aa648d85e29aa1666459c19a033862440adeb7bc23aab','d54d967a260f2370176434f99ea7e2da1d690231a42ee57c727e7dc95a62e351','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('cancel_uncommitted_pos_sale_attempt_v1(text,text,boolean)','848add08edce906a801cbf250b86f306198c2bb5804d3ddfa6a56c0cae8a201e','6229d4056040f8cd88db679843735a400688e5c680cda383ea26a7b249d02ca5','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('capture_final_return_damage_internal()','9913c88a5067a8c1b456b9131f4623257da8f1714a68be08199b3fa51919101d','b220b43c7005fd6c84a555672a0840c518f6eaf6aa6ed19711a5471beaa82c81','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('cheque_assert_customer_payment_role_internal(uuid,text)','620bee9e7887e739990dbed27b13c1faf662adf1751a407042c812f0013dd0d6','894a190c029aea8f1ddd1b24b8eac91f488628acb89115fac68d1bf53f80f4c6','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('cheque_assert_integrity_internal(uuid)','5891729d0eaf6ed789b89d2b6a7dce1d7b646256ba60570d3cd5413c7fb7c0bc','801aa464dc4c7d2114a57281f5c398d66541bf206c13940a34e6aca997c7b1d6','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('cheque_compensate_internal(uuid,integer,text,text,text)','2d17b865553e93749280e7b5f7b20eb0e0e5f8631a5475decebbdcd03b53eb98','d8f77eab566ba2110a01d9fdf088b1dc3b9a18566ed673d9b163a0a5563a23de','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('cheque_customer_claim_lane_internal(uuid)','8a5d441e6e0293da18886dedbadfcfe31fdc9efd5994e313fbc73e919ccbd63b','c9d1714d0c58f8005912698c2c8e87d4c7600d8ff66566c8c571a61169b10c80','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('cheque_customer_claim_positions_internal(uuid)','cb61f21ddc90ccb1389193d8ea14653fe36440fe7bfa298fba4b478e19369613','a0a5f2d04821c03aae5974434a306bc05c7c12cf9a4ea43a14cfccb1aa70d1c6','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('cheque_enqueue_return_internal()','c5fa6458d94ccd9c896534725979259314777dbac168c83744b7579f82f8d443','64588d2ae781a9955ce980afb8d5c50949f58fd368d3b9a2afefe194fb93d9eb','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('cheque_finish_event_internal(uuid,text,text,text,text,jsonb)','9d1e690c9f7f0e09c67708e1aaae5a336d38270f717494cf4beb1db0410d5e6f','9adc964f71902b0c81371da281575715438342d01ea9f4bd9727c9c4fc817149','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('cheque_guard_customer_deletion_internal()','de2ec3f651fc7c0daa590af040690a5c48c5780e18b9f12ceb504faccd58a80b','0360e296eaab201431ccba93ec8ed6e2f3b35db89810e916776101690299bff5','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('cheque_guard_original_voucher_internal()','2bb9debe4cf9725df1ded65320216dce5219d6073380c57505d8294477d9a7a4','092e4d107b576a0e9398092a0d04a10f08fcb2e9928fa393ea49f54037809f89','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('cheque_guard_record_internal()','fc3c2ecc317c32bfe994531d8bc08e81256538107b89ddd5cde56bbf9c4f6070','3db2842b80dd0959387ce02f3f9bd5bc46e2934747b8d3d9171f0a97ff4916ad','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('cheque_guard_supplier_deletion_internal()','3718f95329653ac7332fe6285a65856bdb40f7b0612be19f573d0780cc9f2fc0','ad01266bbe3f6ea042e26ec47ade5252a49b826d58d1214cefcb205c524053f1','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('cheque_guard_supplier_payment_registration_internal()','cf31dd604426269cefacddc1e3ec9e069dd7b3e492d9bb8a5e7554abb806e0fa','60b543969ca0e5c25223ba0ce52961faa9546ec895a31211a6a25ff8a8dc33ed','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('cheque_integrity_issues_internal()','2e5b6fe6d9014ba99f92d12ba36fe97cf8cec0636e52bfc3d7025a788e2de808','e041e51948edf1ef867a42a70c46c6bf303810cd08726daff3c3445b5ac8cf12','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('cheque_order_debt_date_internal(uuid)','5a6e7b8525177d4d85b18f4039519b0c0d74ecebc506f6a6cb100e459b9651a1','e2811147325aef89e85205e819e09672f32eb383077ea72949f0330b8b018d54','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('cheque_pay_supplier_internal(uuid,uuid,jsonb,uuid)','4c64b82c7243e3c4ae9ac29ae915783841c5a198a84fa46dba4ada4e2130d5f0','b7eac5bbad8f2952a6c65cbdd708afe684c6b2f8b24839d6356f822104f17d8e','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('cheque_reject_evidence_mutation_internal()','bfda51e958f4cc8ad291909461c5d5a0103c2c276848bd99d8fbf57a8f4820ea','bfa3b947234f0952800047ee0509644875278c5241fa5a9cfb46fa7f63dc4095','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('cheque_replay_internal(text,jsonb)','69e666bb16cd0a78cfad02b89f7fb4c6dd0aea2d5477f8229f0c596ac52ea1e7','883b6d5b742f096dc1de3fea006260a64e5a649cccc9effb1f520dd0b3f369f8','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('cheque_result_internal(uuid)','0227251179f93d71d29d30a5b60cec84346c1b9484f3fad886dd135e71d89de2','f3d8a9d1ae4a63e76607c462dc047a4fb06f5c08d37a5ad655a23609844e75e0','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('cheque_shift_settlement_section_internal(uuid)','08660bb6aa837fdca043a46953853ef85d76b65a976f12ee9ab1f9234d8c5538','4b53a4e87d8ae356f9f1e9e859ffdeb3e1cd0e8d15e409b75e156068c2ab4d63','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('cheque_supplier_claim_positions_internal(uuid)','ffda1540f6b695a49d62eef018d2124a798b17aa5b654e0a3543c2c3b4558739','1077b6955a9bb9cf477ef3ab376c344cbac13296b9556475a1e707dd11c7ab0f','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('cheque_supplier_plan_internal(uuid,bigint,uuid,uuid,boolean)','ed46a7c6a5bcecb33f5215d57c1eb69e9bfcc275ce5db1cf750b4c90723bba69','017125d33a914106ea8e4165fb16c779c4aec0f68ad62e611b12d8090c6cb0aa','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('cheque_validate_claim_payment_internal()','8ca60b8d825472e6867f9e6fca6663822db7599f4e821a5e76b409e7bf239241','18c424ac2d509030b0caa6985619fb1c50426a270c10909f81071e88aeb13f35','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('cheque_validate_evidence_internal()','7dd1d3ff53205cbaadc5f52128108e3db0c94d48d68630e71793712a7670e1ba','67a2f6a7e1503ed4a63a7a7a52954eab459a360e3e32d2dc3f94afed9cb7d212','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('claim_automation_deliveries(text,integer,integer)','429a8efbffa82bb716d377a35ace9894a337f6577c0f9c2f4cea342800df0e8d','ddb52e3c62346094ecd8027d5c33d2a9fe6f2fc346fc251f6873aee8a5eb3c6a','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,service_role=X/postgres}'),
('claim_owner_telegram_deliveries_v1(uuid)','a7101d81865ef2cf00f2cca21ac479415c76098692868db261ec142e5f54278f','952acd1a52a3306c9148a407f530b8ac24cf43d35fb604dbdc2f5e01c21e1549','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,service_role=X/postgres}'),
('cleanup_guest_order_gateway_requests(integer)','ab78b65ffe97830f9cc34cb50ad3e96fce7062b59d85c2043fcf2904d0c9101d','d39bf5ef43ba98a9d110bf44987fe37c69b55c07ec1519db9d8bb34de564bcd8','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('clear_deferred_cheque_v1(uuid,integer,text)','66eeb5339f84ecdae64e2319d23b0465a13ac72c5cda6528b22e800fb86d17ca','88e7391c1b87162684efea3a3f2a54d2b52cb6973747892cb85c424884ef342e','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('close_cash_shift(uuid,bigint,text)','e803d44c9edc3958b49a346540bbde7cdefb950eb7b70588e4085f20a1c6135a','6fdd336f8d3f01a3afa54c1b1693ebf8c20515e81ca034cb7c066c32e8caf49a','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('collect_customer_balance_v1(uuid,bigint,text,uuid,text,text,text)','7720070e63a90e705fa3b1de25ffd70525b92ff4878378827d55cae222c68af2','55309cbe9479a0dd157d1e5484a153e7d926030995f3bd1884d008517bab0ae0','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('complete_automation_delivery(uuid,text,boolean,text)','ed0ce00f0506ff23d8fe06f273324dd2dcce36d78ceb304d9156250602baaded','02bbaaeff829e1e32765c451a393f7eb62b07774b7909d9991fa814878c5af04','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,service_role=X/postgres}'),
('complete_order(uuid,text)','0f4de4befdd66000a9f4e707fe0cfb1774ea9f6233936fbc9687d5ab8d808d1a','17223141bdceae5aeb0c88459a1cdd2be80032acca484ba4c4e90d54dddbfc93','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('complete_owner_telegram_delivery_v1(uuid,uuid,boolean,text)','31ea7588d48249624e6b722457e3f22934bc1bf645deb68916870f5537e426ec','e67b3f92ec42d97ade09c108efbf41383655e135733c6129bd9370da70cff1f8','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,service_role=X/postgres}'),
('complete_website_order_with_payment(uuid,text,text,text)','090c1b3c519cf7ef1a7348c0426cf74104088982c1188ce977f3d81074bd5567','69d24efd32a5ff0dc474c2c399759d4ec8c7b14806acea011ae062cbfe43f851','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('complete_website_order_with_settlement(uuid,text,bigint,bigint,text,text)','c0055cf0124832a3cd47dc284daeabb7373c0bf76fe47881443b732b15656641','f01a8ade634f22a445b9a0d53e3b0a682f3cc4264fbce8d9a7ad65e391e807bb','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('complete_website_order_with_settlement_v2(uuid,text,text,bigint,bigint,text,text)','3b685835e5b3d0246d18df01d9939c9229d55716737347fdb408fa2f15bff521','5ddf623648b11cce5a4df9bc875f476cacd9b7f6660d58f382d6dfc50cd23a76','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('confirm_order(uuid,text)','1f4fc2ed630888fcb00889c45e1b1acf695d4d3f090933cf31d0efc13206a925','6980ea286ca225bf68cf27868b1011290dc233bcb5742f0c37055729a2a9a4e2','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('correct_product_cost_v1(uuid,numeric,text,text)','fc0be0760b2d032a5b9a212d8005dd47cfda03c085060399e7e851af5fad4d29','d9eb004884fbed0b846eae0caaf20d9e00e2bd647b3f2034e37250c785e3f572','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('correction207_assert_role_internal(text)','804851cb73cd803436f8cbcc2294998680a0c662661f5850044ddd72db230699','3d218f8e15dfc0376c9b0a910a920412c113213953eb8dd41ed52cf7e4d04d72','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('create_customer_order(text,text,text,text,text,text,text,text,text,text,text,double precision,double precision,text,text,text,uuid,uuid,jsonb,bigint,bigint,text,text,text)','ed54104b4e8b5fa8522f829f0bd46faa5c024cef32c00636f713fc95217a0c48','9292d90b2be99e5b05f0aa485072473a238a5893cdda9218fc9463d9187edb56','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('create_customer_order_base_units_legacy(text,text,text,text,text,text,text,text,text,text,text,double precision,double precision,text,text,text,uuid,uuid,jsonb,bigint,bigint,text,text,text)','e178c90fd39f75b2f3e6c3a5e0621006b91815c5669700ff17de7268bec1091b','fd72006f7956f420f37131c59483e04f61cd7685ec7da56c375d9f4caa906e65','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('create_direct_supplier_receipt(uuid,uuid,uuid,text,date,timestamp with time zone,bigint,bigint,bigint,bigint,text,text,text,text,uuid,jsonb)','6be7953dd743ce497c7c48f7df6c91474c8250a49a919d60ed46638fad6d9778','f78c311628e661a5ec0db877ce9a985f28d03d73ed9464d508cc4e8935f489e9','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('create_direct_supplier_receipt_v2(uuid,uuid,uuid,text,date,timestamp with time zone,bigint,bigint,bigint,bigint,text,text,text,text,text,jsonb)','17e5cd89f9b5a6d445ffe9a348a670545aea02a19629890c64064f0216072030','128b79f4e131006e0fd944863b7f253b4b6d23e8e69f27b27c34e3796575c8e4','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('create_erp_staff_account_record(uuid,text,text,text,uuid,text)','489e4f730c15193b92a41fbc170fdd304f5a33aed534b3eeb385829f21977547','8bc4f74d4b6b0b18aea5668434cf5eaddb0c68d0dd1d147efb6cddcc26886e25','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('create_operational_expense(uuid,text,text,bigint,text,text)','03211fe88e3f247d3e58fe254c4647a6f821229d111ed61d091a64bad86b3619','cc95a6db20b05ef5c792ef6ad155d1b496ef48af537e7002d05882135f5bb593','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('create_owner_cash_withdrawal_v1(uuid,bigint,text,text)','c5694a15acdd28f02052b0241c3275533a6aa6b5925f6436dbeb2766d3955dba','821b12ee2c0415fae439d571c68b6215ae82c960f522389761e47e6164ccd401','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('create_pos_sale(uuid,uuid,uuid,text,text,jsonb,bigint,bigint,text)','8e85e6aab8969295da8a2490f88e952638a8733d0a4215ae6689d0a6193dda0c','258d6efff38f948353a83cacce7e9f5b3d397d5fdd4f219196dd84629d252fbc','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('create_pos_sale_base_units_legacy(uuid,uuid,uuid,text,text,jsonb,bigint,bigint,text)','200faf3b56577e33925d1bdcc9de33ca57cf2b5d4d08c499f16e03ad553a1862','644c18e25dbbd7a781b65f5e2ce78c4039cae6fdee9dcd6c1fa591e95d4e0fc5','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('create_pos_sale_v2(uuid,uuid,uuid,text,text,jsonb,bigint,bigint,text)','aa1fdbf165cfeaf9249126f5aa5ec3066ba70b21e19c1d4cf1a4ca3ff865b87b','511563ea06e103cc3c9bfb43f5a4ce492fca3f19ba4209368c676eabab7286fd','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('create_pos_sale_with_initial_payment_v1(uuid,uuid,uuid,text,jsonb,bigint,bigint,text,text,text)','4df3113a7215a765be61855e5235a9e6162d003b440eaf90241078de016959a6','d11b7a020c9fa50640a8db4773fc34305ea61fd41a9f5b2bae689aa9b941edad','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('create_product_family_with_flavors_v1(text,text,text,text,uuid,uuid,uuid,uuid,integer,bigint,uuid,integer,bigint,bigint,integer,integer,uuid,text,jsonb)','3674f6b65dc7c0ba9de06bb10e95346c859a1769fb1a1841cfb8d414f406f5a1','a9f808d725c1d174cd0630c2e498f2878e4ba0110bbf7df0525cc7d1ff39167f','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('create_product_family_with_flavors_v2(text,text,text,text,uuid,uuid,uuid,uuid,integer,bigint,uuid,integer,bigint,bigint,integer,integer,uuid,text,jsonb,boolean)','56d6a42e41f6278ad4f632c2f24903e9969c2e35387e5e521458cf16d5feaaa5','d20d8f3fece3455501892ca84ad3c019ffc9c1f1f5fe6f63817bb8b61703e0bd','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('create_product_flavor_v1(uuid,text,integer,uuid,text,text)','db8574dc5a9866bde05a80003b020fe2c9fe28b0af0e268d86688f260d2612dd','10be05c41d3e1b4b2dbd7117fbd693fd116c14b9bdca56c49d61276c3fdffb22','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('create_product_with_opening_stock(text,text,text,text,uuid,uuid,uuid,uuid,integer,bigint,bigint,bigint,integer,integer,uuid,integer,text)','9ae4b3e0ac8d986e89c51778b7f9147081ebb749552fc22570772ce5070591e3','ba1b5c1db39afaf15291cfb5bff613d8ede66e59e941cef8433ca3aeeb10a83a','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('create_product_with_opening_stock_v2(text,text,text,text,uuid,uuid,uuid,uuid,integer,bigint,bigint,bigint,bigint,integer,integer,uuid,integer,text)','9db016873553b84912af5f82380391fd814171304018a52742cf77885271fb78','972df275d808749e4dac2dcd49f023c703c32aff16d653ef7ca87c9953ee36ca','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('create_product_with_opening_stock_v3(text,text,text,text,uuid,uuid,uuid,uuid,integer,bigint,bigint,bigint,bigint,integer,integer,uuid,integer,text,text)','50559743f9c40b9d3f82801755fe1484e4890e2802fad0b16f0b605fed721d7b','8f1aff0f496a0c6dac317282a3b3402bbdbc97638a4a8dd8085f48c43a8530bd','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('create_product_with_opening_stock_v4(text,text,text,text,uuid,uuid,uuid,uuid,integer,bigint,uuid,integer,bigint,bigint,integer,integer,uuid,integer,text,text)','40113e26b6b6ab69906e073f22d30b8d769e1f37176899ce483a747bd4ab6aed','86134803c84273e2787d6d275651437ce4e021001d5c703c4cd0a1c5708b99b9','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('create_product_with_opening_stock_v5(text,text,text,text,uuid,uuid,uuid,uuid,integer,bigint,uuid,integer,bigint,bigint,integer,integer,uuid,integer,text,text,boolean)','2fde91f85bd80c5f8bb34daef9c4a360f5be5d11db972c526304d46c8aa279ad','933318708ff5ee2203c028ae447d98239f529eea4f152fc9af77190e9237841d','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('create_purchase_order(uuid,uuid,uuid,timestamp with time zone,bigint,bigint,text,text,text,jsonb)','d3a7c284509bfe448dd3904c5f94084a54ee94780694ea65536cfd563c1d3f7c','a978a8c027c5ab936ad5adedc6a2885379adb10d9f996d8610fd83ea808c1e4b','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('create_purchase_order_v2(uuid,uuid,uuid,timestamp with time zone,bigint,bigint,text,text,text,jsonb)','aad3b4d97ad69baf028889c64dcf03fc6328668dbb7943edaf2f53d5d7ebfeb7','e08302823227b99736e4578955d270f47fc69095973d6d04a0eef58cb05da57b','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('delete_draft_purchase_order(uuid)','8a9ab033f8b0eec8f986313e272cb391daf52c785a133d88bb32e9e1d54ba81a','155b24ee886040a6fb44ad96f3e3b88c40b6e07cba19a29d3bb64a452d87d974','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('disable_push_subscription(text)','b904e40c5181f071cc6b9ea77dbf7201de1f6ee3023065aefeb9f2e86c6e4bf9','59a24129a56a9a4befd6c1cef8293dec658471383f1489255e92b65543829c9f','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('endorse_customer_cheque_v1(uuid,uuid,integer,text)','6684f15d76c99d01dfa75b199bfeb66ebda564b9d47095ea35d46e0865a0fd6f','b213e0484db62950736fb436d918377ffb51636f81c5cdb333fcad83fb19cf41','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('enforce_customer_for_debt_order()','efb66934ec56692d4ee7019b5299d3d0509c26d04c2bbcfcfad2dd4b6aa9820b','5176ae14a35d13d044dbac7a30d39ade1bf1fbd885d9e02c81429e8d9add54d4','postgres','["search_path=public, pg_temp"]'::jsonb,NULL),
('enforce_order_collection_before_completion()','d6bce8b63eb6f4c04fbc009d4d8d15e29af61744295e99bb6fb44de630fe7e5a','1d7dff181e3a406d899ef4520482dabc1f84efceb0d79454f3d27e4641c33da9','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('enforce_product_flavor_inheritance()','c1cf48afcb612f83085a6671311135eb21b9bf24b30bf130034daa762becfcf2','4b3af27f5e2482aa4e740a9dfc968e2c900bea3641ab98e0ff62d4a550ef7bf7','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('enforce_product_identifier_integrity()','d1da3a572b830bd193f77a63fd0fdc91c0e3940f75dedc83b6bc8b7370dea71a','6bc5006129e667ae58de9d2824a7e3df489b4b3e8391ef06cc914a735d4cefc1','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('enqueue_automation_event(text,text,uuid,jsonb)','0ee0f8c615d26f19940154163a0a06859522806b9fe95f2f24b0b3fcf4560113','b65bb88f6d673c87dbdf1366b6b698ccee47d920f39bc18a82f82a19d1dc8f7c','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('enqueue_business_summary(text,date,date,timestamp with time zone,timestamp with time zone)','dccdef51722523267cbf2589210d2c2a8a029eccde893f7374e24137c2d5f15e','90439d360ec768defb508292779461fc698c26e5be4c35f1376527a8e06e422d','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,service_role=X/postgres}'),
('enqueue_closed_shift_automation_event()','1dbec25622223b3a8339c17cca18d04dd11ded4635d128894e3277ecf91548f1','de03ae0645079ea4905b1f870b3403a7988f2668bcf190a3077d468c28c87127','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('enqueue_expired_order_business_alert()','8fcaad7aa09310cb1fe193cda3aec0680e660667610dd9f9df263fa1e9c1051e','4e2b8c0cd6af0fa47366732668c18d1067ed41924ab27f3922dff70c1b404f10','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('enqueue_order_automation_event()','0158bc289ccbe9462a2cb91042e82395f0c7aac07431e2360d31094b0c47276c','32eeb6f9dffbcd3e87daed690d36fc6fd00767c57aec54bc7cf6ac20c7a32bce','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('enqueue_order_push_webhook(jsonb)','0ff94dab65738e4a7ebb0940a1ab8217f64217d1b1834eb93d746fa1c3d4372d','7295cf440d134749d8f58a3bdce5dff704e70f932921ce7a1002fe462a6f4f28','postgres','["search_path=public, vault, net, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('enqueue_owner_telegram_dispatch_v1()','9b71859a5ca00c1291fdf2f712eed2945fffac4a2e0908e63e0c25ab0ee5683c','47b434148d93471976397cf301ea0820d65b4e62a67cf7a04aad0de2dae85689','postgres','["search_path=public, vault, net, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('enqueue_stock_automation_event()','7a01822c986427ff5dd6a57c0e0599cc4799f3de08c4608dd98fb59472d92049','28c3c013ce15c67c7153d485d5e2e881190922d02f90b1c5728a7b324cd17bce','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('execute_aftercare_supplier_v1(text,text,jsonb)','d781efdc4dd15e1e6aebcfd35b90735d07e4a9330966c873d60e831a33857c48','33b93f26cc12a9ffdc883b35343fe4d382a1c92c6b885c8ec9717876e2e07e52','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('execute_document_correction_once(text,uuid,text,text,text)','76ee5d4db1396d8ee62dba06079a81c2a88039797bb2b8fb90a020b7f7c1f7f7','5cf2cca3bafc4699840356ffd49fcfa3865e11a5385cec73c6baa47e97dd8cb6','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('execute_supplier_replacement_v1(text,jsonb,text)','23df05cc21cf3c2b169c810be8aba554904e003bd5807ea86d9265d07b623668','66441d4e92ef25c42c75261e8e557a6b5fae85d773a49d372552a32a739d1278','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('expire_stale_new_website_orders(integer)','d79b831289411bfd62b2cb06e6f186e4df3a1f1810ba0f8c54e31a7c97e378f3','162604618e5bd3653fd176b81e675fb38ae44a48cd5da1147fc90bb93790a96a','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('extract_google_maps_coordinates(text)','d47250a41818ff218ba4942be7a729ea1169df60c109b25ea05ff20dda6a5b07','e3d50efb9b39e920482ebe87c8a17f3f057a48e7a56cedbb184e6e9c982811fe','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('finalize_guest_order_gateway(uuid,text,uuid)','9f5a380643b0f0ae4577acea89b456477a392735c0b59d852d6c1ee9629a78f4','81e0b51b3bf3a035d16a8f558e81ae78988a6ecd7b313a3390f8a2aef27e3c5f','postgres','["search_path=public, pg_temp","lock_timeout=3s","statement_timeout=5s"]'::jsonb,'{postgres=X/postgres,service_role=X/postgres}'),
('finalize_order_parcel_instance_internal(uuid)','0a7b363ec702be6af76758f4cf923d62bec6671985847b1c5abc1dd9a8cafb62','31d47995faf46d673f69f8461d422348e5eb7197b32cb602d6f57661f32c1dcf','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('finish_go_live_setup_v1(text)','8511f969e0d5fdc77123998be492d8b257e52b886e4c50fa6c700ec3b6f3bec0','67503b498fffe99a73b59a6f973a83990fd8c5558a123d0e6fecf9aa14127416','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_active_order_push_targets(uuid)','82a0f17d368b50c0036632d4de1ad76da094f3e28926b668313a993697d016d1','be17a732a19590334ef4e9e8631b38efd35b83852aa56fcff4fcfdece0fd2678','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,service_role=X/postgres}'),
('get_admin_ai_inventory_snapshot()','d906ae08f3341dabb097b0321583472bd7146a3631e3e568e6efda0bee51cc95','9b9ed1858e6ba88eb3813311a44c2cb014be76dee16d698e63b25af4d1c4aa68','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_admin_ai_monthly_report()','e10b194eadb088eba19e24e80ddc62311eb3beff022dc5f1767e54cc5dd9e76a','d467f1b2e662a63888b84dc4e38f76aac73ea888efe73a62c36eddab68aaa873','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_admin_inventory_product_page(integer,integer,text,uuid,uuid,uuid,text)','4c986358f2acd675c3258eff26eb8838165a5b2112020257eaac0c37efbc8486','dec13c8dc955b726ebfb57ad6c5a32da03b9f053bba6a5d26d1272c117093bf3','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_admin_parcel_configuration_context_v1()','8e8b328921226fb43b96784650d7b272f21ec45401201a43cf3fb38c50241b7a','c6096e521c8ac839d25b29b8d751124cd49ef43b1a42c8e4cf8e526eb67284f1','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_admin_product_listing()','104920ad1c58b94e743933e2552ca1293ffdab0e64a08a093fd39662c57a0c12','fc5c671b750569b5b293865f3ac3036fca5697cbc291fdfa87ea0d6420b0b7f4','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_admin_product_page(integer,integer,text,uuid,text,text)','ef789f140370eb6bf8aa2eaa3590ef2ba73e4392eaab6690a9a6c439f2fe48d3','04be6776732872c9003c235248e6ba032c5f7e904def58a6c0d050c82c51e3c0','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_admin_sales_aftercare_context_v1(uuid)','fb3a2edd20ccde8d81c317b8fd29105763202eddfadd558df4cdb4772c8c63af','fd049ff36c12b7de0e43419e55bd15519bd7fdb9b810204b9948da09be59304d','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_advanced_monitoring_dashboard()','255d31ac519109c9b5fcc8caef19e71f90621b706a0005a1df43218312796803','e4211a5af4a06a29eb0e0ffb5dffa919be803ac5ca7b69d23b3d82e41f03ea68','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_advanced_monitoring_status()','b79f4eb619e662ea2a7fa1d0c4a0153ee1551feb7768676b4687edfc7cd9ae0c','829bbf4556fbc48437a970e3253eb64a1f016bf199288c292429b4b8dae66fbd','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,service_role=X/postgres}'),
('get_aftercare_damage_candidates_v1(uuid)','4e16c18b08d17fbe4ca60cc5bab94cfe140b782c0d71b8b6a86969fe346f4ac0','6108c7ff0b86d088504bcb3ca831cd3841081a071e5e7c47a1566d747775f0fb','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_aftercare_integrity_status()','7e62c6057832646edc77fcf20ec2874ca956daad3f3c13c0ef51fb6fa816be16','638bc1a5a0e6e9c0cde1acb0650ac0b88c9f99c85f9c5833353f56052eacac07','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_business_summary_monitoring_status()','90cab0a21ff5e32da239bead44d5d00e24a37d23998801736a16df0201c531f9','5f68a477d8634488b07ebde20aab131e6b8f1d3902f83bbc7c4e96c0c248b055','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,service_role=X/postgres}'),
('get_cash_shift_archive_page(uuid,uuid,text,text,date,date,integer,integer)','b4cb0363ecf1cd74542b7a11b93d5412917b96dd515709f7c2879752e1b7f2a5','8ed6ec2d714d5e22a30df369c13cbb816b8870bd7b9df97ffc5d46dcae36ccba','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_cash_shift_closing_report(uuid)','ed000ccacb39d30705b3d3cc11dec4a500628b06cd3446879241a7eda080eba9','d493b7f5708db0a620701c303275cc97aacac7d7f79fbf7a2c3dc5e546eaaf25','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_cash_shift_display_summary(uuid)','d5f4ad55b7868370e65a51357a748026d10c292b2907220c81e6b4d86ca62883','066920a048f78f5b03949927e036389e91b6ff6ae5d3adfbb126cabbce584861','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_cash_shift_movement_page(uuid,text,text,integer,integer)','3a07f72c92f7c0d7fb9445b054de18ac58839c95e8eadc6802b6fc205e80d7b8','39840b182936c7e52aab8ddb86247332aa3d9d46ecf38d5e7f00af93a253080e','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_cash_shift_summary(uuid)','e64a382cec1d1468ff41324d17127d84d1899c3475aad9d01694fd0d6ceca41b','77d77268413d3f548b4ff0803c7163eccd0744c5241f212a71b38740508e811c','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_configurable_parcel_feature_state()','340b9b3656b0816610803191615b1837db55169627f9579b0df24fd7195f7028','c98a0bb4492f02e831e97f04f48fcd46726cffe692884c0704dea42b35328397','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}'),
('get_crm_customer_detail_page(uuid,integer,integer)','744958069f906d22c392f727ce3e5098b48b3f63b39274de584c6efb109ad8cc','2324199e773e7d7708577f3eb5651831cbf6fd57cc88f00ee122cec5759a7c26','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_crm_customer_page(integer,integer,text,text,text)','7eccf3589f325dcd68404f09b397b8e1333071fb05e867d4814474da528c3a9b','caec4d415afe22937aafd824b8d69fe2e42c0c83b49ca302800a985f4255247f','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_customer_collections_v1(uuid)','f142d74fdacdcbe1ebb87b57b2e6a0190fbe171c98cd29bfb6756e667264d6c5','0b8e6c4178f7e3fefca472f2fbde9f617f7d072a89e3b94a8c8277ff486f9358','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_customer_debt_aging(uuid)','0b162c89095dcbae07f4d6dc11c70819d823eec0ca885408b67a1761ec27fc78','ea56d2a76e531344322171a7f78040c97978f63fda441b36d0dbe15813426210','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_customer_outstanding_orders_page(integer,integer,text)','0e5d7d2ff210a6015e2bbb991bb8d7af659a4114eeb487588108b3d07e43b3d0','2e9dc1e4b06ddc6870a19bafdcca1e35bc1b9982b1eb5fae05df03f332a141a3','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_customer_statement(uuid,integer,integer)','bfc3eb2f7d11c2bc6407f6e6950cb573c4e91f1e8cdb8b933264a37be786f13c','81579ae77067295abf5a4305febdbf0c0d1cbaf8164cd0c9dc17b21c6c651822','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_damage_history_page_v1(text,date,date,text,integer,integer)','d97dd5222cc0784a5ed91cd777a56bea7498891a747f449125c3861981f6439f','234b5efc29e21706cd3e54375d96e901b46f7c9ce2427b44fa2ff4531281ca57','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_damage_ledger_page_v2(timestamp with time zone,timestamp with time zone,text,text,text,uuid,integer,integer)','a21176401ea66160d734879d543dc59df26b541475b4dcf99330a625dafeff03','409f7a3ca8ec0c1288ce5423b72afcd5913ca7b928178f790160d09a9cc248ca','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_dashboard_analytics()','e45ffd96638ea7a2f9dc5cfda60f8683e245223d6ef8542bc887603977f72064','197c2c6815fd166f1fd715477ae21e08f69a6a7e30ad496c085d2c986fc4bdaa','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_deferred_cheque_detail(uuid)','9d198aa544f8defb8eb7b49d71053403748eac0e65ec643e23d19ab884de5db5','72da409454a1246f2e4d6524709245014c323586b7a425ac711128e525df3dd1','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_deferred_cheque_home_alerts(uuid)','d1a8024ef9ef61d0b3741350036553b15f1ad46f224c24fe541c9fad68169eaa','1290b9a542daa30b5309e616bf74863249c15d1643cd8a098947fc49c8fcf7ec','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_deferred_cheques_page(integer,integer,text,text,uuid,text)','1f896ed07bbf15bd9664c563941e826e5a8a3c7fd4a01d624c7ca85504039829','f54a187201cb018a93e151cf5d415647335b39307be50cbd51fce6d615fd8068','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_document_correction_preview(text,uuid)','5079402047e4fb79cad900c5c95e4090cba269558a72086c208993880caa04f0','4f97037406386e2fb54b8046bbea3e5f2b81f0c8a7f87b4ed32887c11c29bd70','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_erp_staff_account_audit_logs(integer)','8eb6f91a10f0c8f4a768095183a3b7f7314b3c552e47f376a9c7f417898afaf0','c99faa610c122eb0572ecbd6ce10c914c69640227b8e8b5668c24602e4049fe8','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_erp_staff_accounts()','b02e6bd7f44bac327a1d8bbcddb93cf763c82fc8b2a1afafd09362233490d95f','aae830fd53eeff921cbb47df0ed8639bdee3c96452d36c1d6e2ae0b543dea675','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_expense_shift_center(uuid,integer)','02946f412bc886021ae8f339e9e293da1f2f1c74bf477b02caa12ee708f4e58c','7fd8a04de3b88a37c47e83ac376f36f8a335fabadb1d9f3118efcea24bbf72f0','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_go_live_cheques_v1(integer,integer)','aaf94abe45c21407d60b75b7a5b4842c1ba7c0efd37917d00e25debc46bfe6d8','e035aae356a228021a862981abf4fc5ce9af25105b589851c92342ab7c2de832','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_go_live_customer_openings_v1(integer,integer)','46f85abb39b8eb41ba66b4a5816c21527bc55e6308e3511d643187c4261beafd','501c17ef531ddc063952716a405d645c556a442d703d09d5773a5e519131f147','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_go_live_setup_status_v1()','7fb099790fd720f2e3146dc69fd8d23d4a2bcced7056c689608427fa9b41183c','5938dd08e73835203a013d0d8d66b71e4631a2073ad9ef59142f112a1d707f38','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_go_live_supplier_openings_v1(integer,integer)','c340fb490734a86a95e79b88790df680187b564406bb5d1c298ab8d13ee7d968','c740fd5af4b8d7cbdcbae7a73f78cc062832cfcd9ffa15051f38fbc12e359609','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_home_dashboard()','028dfa13730bca8226750e408080fc5b6ae5d8aa33c128aebc758d86a48acbbd','da714580fa7eabb2d8bb59cc6d22ba0d65c9e05cdbf0bb18cd88b47c1866efa0','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_inventory_movement_page(integer,integer,text,uuid,uuid,uuid)','595083f9e21fdebd2fe08d576f68b58745e01dc97ef0490795dda6034aec0a7d','fe21dc974371568a588802873f943af2a8701eb053399723cc0807e31b885028','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_inventory_opening_setup(uuid)','c3151aa0ae2b2be5e017e7ce75c33444f90017cd13549c380b7a78d7bc6e267c','a56eda00424cfefa637bbb377b1427bdb56d18d389d7162cea9b10cc5381bd7d','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_open_pos_shift(uuid)','550a07a7d442bc8fb9b94a6c680d12a5edfa82d0a1cc7902510d2048593189ea','44006c0b6372c20f2df091ea584b7fc55bc9f3e92ca801a44360259be8f86481','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_operational_business_report(uuid,date,date)','969d1085d3a30f92ea051d5ad4483381479dc7ad15c17b35a595b383d5afee83','59e9a6ed7411ab3574a61eb1b5fce23b57320d5cded6e433bc9e910ea552a99c','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_operational_orders_page(integer,integer,text,text,text)','177ae4d038647fd9c5323358f03b5f9855e5de54279a47d460d36eea275e1e62','7d55154212daf23bcaa6ea1e7a30d3431ca990597fc8f89c6e57d7df658c8d4f','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_or_create_pos_receipt_token(uuid)','3e65df4fc1f0a0a02bdda0f6d840bcf43576a913eabcdd24ed4d31f0b4f6b8ca','35494c132630126d3473c53e79fcbd36ca2deced38868f1e4a30379acbdfe856','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_order_exchange_details_v1(uuid)','f5aaec3142acf08ead3f2e83829d1e450c236cbaa7376e9214abd5190e687157','ef8bcbb67fb52d173474be47df85f73c9bd7d0198bae582b05d72583cb9b112e','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_owner_warehouses_v1()','963a061f99b523844fe626c8ebf0f130ca4e41d7e3e3f8bd839afeef6beb2f60','8518e344eae4500f108c12b169ff06a2c0cbda4445183239d7ba5023e8405eb3','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_owner_withdrawals_report(uuid,date,date,integer,integer)','3efd82e9f25f20c7e4a60146df06797c44715130ef73f93bc5e5030691a99223','311c665812100c5d409f1afe65e30c54b1b90a1d9180e4aee7053756bfcd2d85','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_pos_configurable_parcel_options_v1(uuid)','97709600edbe179f31db4136ee4f8662ceed8512e91c95ca5cbf4e8cf7607b0d','e1f3ea6510a22b4091d47638da7c3ebe4980ff940cb605bf500bbf52978d2d69','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_pos_customer_page(integer,integer,text)','e2217b244a337efc5664841996076da7dbf5454338b2f7313f25c0ffe6b7eb05','2f06ade81a6c908ca3e9581de3eb7b6aece86bc83684b39a82558a33c349212c','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_pos_sale_attempt_state_v1(text,text)','51e25cffbc9093664aee3785c652b7385b172525599e3f7828d12bb786a6427b','6a0b6e3e48d989a6b416e7e167229146469614fa5671e5fea8dc08a3c58da7b4','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_product_cost_state_v1(uuid)','1a22d7ca8f871eb7851c804169a50b36caf581195d110b5733d7d3ab4e29e5b2','40f6b84cde4b40d02e032a20d09b76a49f7c35597a12cd3ba8378964afffeed6','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_promotion_codes()','e76ac0b1b56e3a7482eda05aa0f23a17b093a8f2afa986a70da38f6adfaac27d','7f58d6e7fa5c23b9a2460c01072f08931185e10217459416dbeec72ee7fcbad7','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_public_configurable_parcel_options(uuid[])','e47829687b94104fea2c62a523d1fd221b423f062ba40fa0ed7dac67d939e819','e85d2d94a797ba40ea17be51d632a53cc5366ba34ad2edc651c9e66f58ab6e31','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres}'),
('get_public_pos_receipt(uuid)','6c114d12ec0209b69ddcac0cbea0ec332af630b2c00506372808045308f04f57','7015e2427de9e735904a8ed2e9959cde0a9d1eb49a2840df1c2ed79b3e12e400','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres}'),
('get_public_product_catalog(integer,integer,uuid,text)','a78485af86e18c86030145a8565ac310740d71fbd483d31bb84b22529e66c1b3','42546354c4245884571fe6841ae7d53b24da78b13993cace61e1784333edec79','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres}'),
('get_public_storefront_catalog(integer,integer,uuid,text)','44fe0afbba58fc6bbade37bdbf41f339da8d6262f27baf6c36e9159ef684be66','5298c4ec55201d779e6b1cd02a2e9466637befb8929d9b468dfe31620ba9a438','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres}'),
('get_public_storefront_catalog_page(integer,integer,uuid,text,text,text,uuid,uuid,uuid[])','7f73f34988f04ce1e07341b9678a9fc824ddfdc72e1eba2c258bd030dca05f03','3a9bc1a125bd69e6d82eefabd9299ee734e2d0c896fe698f15f98688abea021e','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres}'),
('get_public_storefront_merchandising()','e892a886fff75a3f5174bf3b0fc6d3d7a1277cc5bb7d0b3f85e1b460cfa5b8a3','0b9483dfb0387fd92559221ed69d0e6d37ca216a04b437408b38268a045f6e9d','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres}'),
('get_public_storefront_offers()','c4166a0fbff0f2697685c615aa697a88dbcfd441140930eef5ab19e1eea5d789','5749e4afb9aa256fc7998114339dc1ebd7c8a76b8001d2bc2eb45c3af64a9cca','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres}'),
('get_public_storefront_settings()','84c35517479ae65ecc08fa44f93dedc45768dbf152b4f346fd8c579ba65c5eb3','f3fefda77a2cfbae90f5d81d6f85390fea5f1b87580f7799b72cac45cb54f06e','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres}'),
('get_purchase_orders_page(integer,integer,text,text,uuid,uuid,text)','e1c01f6431e0d897a37d061f0ec3a3d2b0bb71ac41fa02a0675c73ce8b47930e','ead8f2bb802f0c1cb92de1655521b1895d1cbb447c4392d005f60b008eddb54d','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_push_subscription_status()','0e70a6567444d0af06ffa0536aa533cc019fba80714db7555a75d62c4d648c61','0fd5bc2e5fd9918871329a04edcf146af54e4e5fb796a7cdf8bee4d54dd7df90','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_push_webhook_secret()','7087296ea4f9fdb9b267a2eb8a8aca4825a3db484c278c576e51422d2f68ebc1','d15e913613a6c7a88b0b2df8b08920b6ea7b0e6f6d5e9ff61ca2db2b7eeba200','postgres','["search_path=public, vault, pg_temp"]'::jsonb,'{postgres=X/postgres,service_role=X/postgres}'),
('get_receiving_purchase_context(uuid[])','55f9972a833739d0be0e1dde41bb724c91a25be7c83f0d2d4e49f6151d019490','caa4b8e9c4c2ce3b52abb16cacc97ec8cf6069559d17bbf6f6b2c8856fff1d7d','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_sales_history_page(integer,integer,text,date,date,text,text,text,text,boolean)','8675f562d60c019cb40b3d44cb4aab33f1563ba5222739da0a66473b3b3807cf','1d5c7564de6073fe999e3c01aef31bd88c05c4650254a32bcc49ebe97065232a','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_shift_owner_withdrawals_v1(uuid)','494e38199b35562bd9522aabb154264bd3f8923f41c92826d5f84de938aa4e01','8ef7d3e75d7c6e0ef7b1ffe363b2fa328cefde3c474042c1c73ed558762a9496','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_stock_alert_notifications(boolean,integer)','20718863bb30caa71186a9361cee9684782dddd49f72aa0b4f14b29b70bb0b7d','beab50bbb37071f476018c779b887e5f81a823a84763abf9e3c9bf3dc75698a2','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_supplier_opening_payable_v1(uuid)','80770a5d3af7353045356814f924a4c62f751dd1c1dd3a7db4c0d7154d5ca9d6','d2781290b38dc891ff74dca3f94d5f1a02e7779a6c6f3ea6e3d0064d3786e3bc','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_supplier_payments_page(integer,integer,text,uuid,text)','a8c5209551c7b6b7022d6e9b447df08fb5dd566dec9e15edf3a58e06f02cad0c','4ef3fdfb5d7478d1e4dafb2e6e68e7793cbf794e6d1cb2899e26a146bbbce523','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_supplier_receipt_display_context(uuid)','d36ed27cc9e355652a97a8506fe0c4b2d0598f80365fd6802e23b03a5b16f3d3','b6bbe8f689e4b07d02c44052e2339f2cb7dfdce7c42f7d3dfd9d1c6e266a6f28','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_supplier_receipts_page(integer,integer,text,uuid,uuid,text,boolean)','4ebcf600303b0a8efe2984241ba471730e5be997dcba4d5dc70c56612664cda4','97c768b10c47bb9c702184e8617eee9f249c953728b12aa10e7df98e158c7d46','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_supplier_replacement_credits_v1(uuid,integer,integer)','ba1cd5419812a8883206c396a805dec7c1704201a3c60fbe89605dd61ec54e15','7c1d424eda1409c23f0511320621bf210458e5fa466312b50ef9cac6c2e1c34f','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_supplier_replacement_options_v1(text,text,text,uuid)','f858db16a0cecb15856f16392fb2a5c418f6cef91815acb742ec6696b38c6870','d3b5c4778fcd6f3fb5709b847befb948688d6b4ffc8251924775649733eae74c','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_supplier_replacements_page_v1(uuid,uuid,text,integer,integer)','dbeec99e1339422cf59dafcdfb48a33432403ef1387ba5a8aedb5cd45f556e31','ccf87375aa4fd11f0c7105a6af88b81a563137949df0fda3a2e47d2053d59173','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('go_live_assert_setup_open_internal()','cd5378dae6688fd51ae69352e9bfde45ec7a860b52f88fa7bcae70dac785fcac','9ce2c7678b2d18236e5d11bc0ee5bed9c763277f350cb5f21fea6b87649fecdc','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('go_live_begin_batch_internal(text,text,jsonb)','eb8ea2e145f4a64d77e8a76396ebecad0e5d80c8fe3608290aec9b56f50b4807','8b2290afff1c1e3247acb1fcef8747173a3f9ce7e7f5046b63126b446b5d3d18','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('go_live_cheque_party_internal(text,text,text,text)','3a1ed9c91fca68cccd79932dffc5c03dab000eb0ebd0746c954b18b25265d0da','9f813de08da016032cf82d756393ef200b0d894e30fadd9898ff16b6121f0fae','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('go_live_cheque_rows_internal(jsonb)','3a63ae16cb739b0acde4f9da14e875139c0f977e0c4531b47e3df89621b545f9','25a201a64e876c09a9bb8e6ede1f88de5f478c99a9ed3d9d6aa874a40d0978aa','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('go_live_collection_result_internal(uuid)','aba95fa8d0f07c09bb5edb2cff593cde8a1005edf91c2654fa9f19c4e4a0aa95','8e4af422a48ef5a35389644c5f09a82d4ca563ec6950438e685f5fb3554660aa','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('go_live_customer_opening_positions_internal(uuid)','d4a5705da05394d4beef776e860a8dc35e289e38d1aee960cbb979e89adf0925','c709d16d9a655e4bf105f51623ad3841682d897613d4f72205acaae8be90cdb4','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('go_live_guard_collection_operation()','6a8b0fe16b05027141e8d17bd1710341c567e9d5921e6ff41bce4add47d5003a','e9323c336aec54520adf1a8ab480918e5477d8308b6718c386052d103d249dbf','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('go_live_guard_collection_payment_reversal()','55abb7420f98fd5aef3de5602e1678820174b54169bfae4c5773470fdf1af203','84b31fb73c134ac1196bd3dbdfa8a893d0d42db0cfd9724fdead3c3ad4eb6814','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('go_live_guard_customer_opening_balance()','a63ddbf841c1b9b15b672fa2c5f853b027214ccb41b6bc7b86b9df9364bb7358','c3461c699c5903639fd3f0a0dfcf4e9cd488451d87eaddefffe77c8f6f331435','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('go_live_guard_opening_cheque_internal()','dc7de6f3d9ab75890d3c1d515966cbfa360f284e55aed16fe64e0189caa22cd2','5e39676462c8bbaaaf605a710976c6a852a99b082525118d73b9e47c10ddf0e8','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('go_live_guard_setup_state()','3f6b624411f998f370d6b91df49f47d48c8afd914e6c4f1488f2264b5cb79b90','f554878da8d3b9d32644ca655ed726ebbf86ab415db4e193aec37f796bc99649','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('go_live_guard_supplier_opening_balance()','e88939ecaf0de0561160305c04699c2dbda70cd9aa9782244ae8ceca55ea5c63','720bcb6d5d18236f420afb7a5ce3373ccb44cdbc7cc413207082b66d8822abd2','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('go_live_main_branch_internal()','96f104f866537c41e169d2b4550417e8ce530062ab887effe0669e8cd0bd0403','2037816407c6bf1f58716cfb0bef0ad0d8e317b50cb94d962412cb0e6a1eee16','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('go_live_normalize_name_internal(text)','899da6faca51026a487c1178acc4a74991605edfcadcb15fa02f1cb168c44c17','4fe5f669f485ff64353f05dc7237cb4e5ee6e0800f1cb699035c702dc15edd0d','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('go_live_plan_customer_collection_internal(uuid,bigint)','2cc3123507d2b6764cf20f12966364e24fe2d2432d8cdf6169d394568c39c159','baa7c075a2effa0428d387d670c9c50da35ce19cfb620c4292bfc60ad8488b90','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('go_live_reject_batch_mutation()','9b874ae52ac567717da268a35851d96acf201be3c9d9a958e6f13e1f7b336867','45d33d6418c2fd7cbf9f888b1135434f0e5768dd154c02d89d6d6c20bec53312','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('go_live_reject_collection_mutation()','3898cb1863dc49c2e2443a7f928f9dd4bbf63b8d6a5e57a282baa56d5d6dba6e','de44c39ab279f6c78dbb3e22d726d51af93217d80f01799a2cbf4172f671d083','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('go_live_reject_opening_write_after_finish()','1e61e011443aac6ffaf45a0440dd680edbbfca93d220e557de351cd03910366a','5741b55e385d580b9e5474391327ab704bd2837baaf71115c12f5a7a335d8b78','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('go_live_reject_truncate()','6ad69020fa74263427645147ce9825243a30064812830a9d7b44ba5184e5b2b5','74588c464c10095e048ae179d0a7f63ccfc44822158a5ffe2d6209bb08ecce68','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('go_live_resolve_unit_internal(text)','5cf6dc6614e2936dfe5c236d3a18b4abd1a4af50f72735e187f086a0c2ee50d2','90893d1845b0ff81aaa53b325077822f3226bc7a9f84f78b08c794b072df7214','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('go_live_seed_exact_wac_from_opening()','262817d52979eb6f1ac298b7cfb89f3a8a1f6c15bd8425df4167cd50ea464579','e96561a0651b8330ce15efcb9b0b84d1d97420f5d406f4ce1ad20e493db09e84','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('go_live_setup_counts_internal()','b6cdb05cc723d733fcabe2b2664d5031b1bcd9b50880672cd4a01c9b27b17437','dec09f64488e0bcbe940663943f47e2bdb2520c60b67b70b9224595aed4c10ec','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('go_live_supplier_opening_payable_internal(uuid)','d217900ade48057b77d399f1c81315af94da8ccb2b8e28735322b6e287939b42','198df55fae3e458c582d73be31909c795cf88850234756ded970dacdd52974c1','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('guard_cash_shift_closing_report_snapshot()','a62c1dbcc0a72cbedc7742c9cd8fb494c41abde77d867ee0c522aa0e71df8690','1cd26c6fc2eb98d8953cd648a6179ce7a5b91aa62f0a1d7a71255c4b275862cc','postgres','["search_path=public, pg_temp"]'::jsonb,NULL),
('guard_finalized_order_parcel_item_history()','c880968264acee98e32d98e6246631fc42ec341764acd1ee5f7cff80ec40c0fc','961f09c377bbc68c951c0829fcbf6058c2f0b6be33fbdb7a41408a98e7d6302a','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('guard_immutable_parcel_foundation_row()','7d050b04fbade8be1ecdef969612f30a416e4d2eb2d94a1b112f3b43d79c8423','ce2c2cb372c9d7988c5b8c2fee5682262811c8bc2f7866a1cefcbd186f09a3ec','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('guard_new_configurable_parcel_row()','4b1dd677cfa24e954448b73461d442fb260bd30c3b452617f1435b5cfbb10fd0','8b253e069498b12bfbc43f5a3349a73a4a5fd962a00c46a1d70cbe49d8d1b5bf','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('guard_order_inventory_reservation_history()','0b876595eef9cb87119d8c4a46211e62f4075e863e725946d1e69547f2b4726d','8797676b261c46d8d6b4b3cac753e2de88ad9a334db3c60575fbeebf306e3bf8','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('guard_order_parcel_component_history()','7b6786dadd675bccdd5b40dadf719a79ff7661241cfacbd68bf610710332c1f3','b32d9f1ab71ebcf5a42beafc8d0c272bb4c5a4f8aa5b6266881c1a775f8646b5','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('guard_order_parcel_instance_history()','09114813c4b38f5bb292e3b34fb30e8b5c74508458b20b0dde71b9a3f3484942','116d326de3f716a9a3037208ba9d4b919332a2243b92131ac7d8b0dea8025080','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('guard_paid_order_customer_payment_reversal()','76ec08429db478af4f47d43525020a0604b419d4d136490bc5ea126cea2bcc30','fbf273e0f51fbb485d722d891141b19916eec77731a99d9bab3dec03ffe6f75b','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('guard_phase2_detail_history()','18babfb38027f57cb3c6e14d9f41a4388b965aeec3e886e89c659da5db577c5b','3bc875a9900fcd35f0f1640cf6039499400da69a1f8d29a51e09ae5e2c24f6be','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('guard_phase2_receipt_header_history()','f60c5b7b4671e386970a08fbe4dc709ae1635c5304589d615d286aa7454a6740','3d6a72d976c589256964bca718cdd4fd7cb3386bc94a8eac15b367d2ae1c3a71','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('guard_phase3_customer_order_cost_finalization()','a812d7f743cc460db974219277305949cf8dacb0a5cf2fa828acdaef54bc2d16','27bde6eeaa7ad95b7ad3d8b80ce1ac13080949b3ea9875a0f26ac0581a2b9476','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('guard_phase3_customer_v2_terminal_status()','7e2c7b5a298d4648c5557cee5b5161a1c638157e8cbf1170311d7f083e037675','e6ecfa0fe8a0f65e36569636883f7c87a7746d3becf1058f6f26029cd0c7dff5','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('guard_phase4_aftercare_consumption_history()','0e40d3e0ae45f6fe3360c600a0073ee2d274352ecfa4dea5ecbc3f29dd6b0118','c001f691a2f36da8533c57f9558548a57ec5fac8b7eb3c56053a67d3b6bc03b7','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('guard_phase4_immutable_row()','9a42ae48b0cf1d23f167bf0227362f6ed7b05a9dbc443f3d2543b493b09a43a5','c5a72f53449bae3670009b29c18da76d0f43a97d958cbdabb279d65c7c913530','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('guard_phase4_replacement_event_history()','1b87e3acdeaf0fca8f14b8a024e4c1a2c70c856e980a7e0908755370fefc3b95','a42bfff51c5dc10014673c9c0218ba98a6c4636d2ec607d130255420b621fce3','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('guard_phase4_sales_return_event_history()','3dc8679803b43cc1ec633879c3a8dd425bee43089173425ec7877e894d237163','a2f6797127587be6a1870d33ad66fdab984f396c92d936ca589a4a6c188a8606','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('guard_supplier_invoice_identity_history()','39b5a5b713d7fde22a639a3bc491cce00aa9e003c080de64e9f36cabe7e22329','7100f56e4c6490942f86791c2864c0edd6de25306a0d7a64ab2c8c43a5baadf9','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('has_erp_role(text[])','a0aee1cfac5a48144cc02c000a132e6747720165822754094498cd18a74760dc','16869078890bc2a5543fc9291ef65a599e230e7467d52ecfd977cd002b134cab','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('home219_adjust208_internal(jsonb,uuid,timestamp with time zone,timestamp with time zone,boolean)','e92ace4b230a29a9b993874dfc6da039be84831705258367020e6f700093e067','717d554c3fcde80048eb4ba1f1247ce42e3a0f1aba4d085796e482c66e5649cf','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('home219_adjust215_internal(jsonb,uuid,timestamp with time zone,timestamp with time zone,text,boolean)','4a2facb6a3f9216857f51688412dc6585f30c6243ad6de21793a04f050bc0e7e','0a9c2e33859beb6f7d7b9c987a21af65a368f1373b6fab03dc725dee7d073e3b','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('home219_shared_period_facts_internal(uuid,timestamp with time zone,timestamp with time zone,timestamp with time zone,timestamp with time zone,text)','213e6cf958c1c6b27625462f2bfac46b638c814533ca840c38b6b36f4a84e6fc','e2cc304b34c1955ee682c924464c0acfc848c371458f7e904481dbc785bbfb50','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('import_go_live_products_v1(text,jsonb,boolean)','673083e60ec89ed413b5662b162a3fdfdbb410777ced6fd02cd8e0da944c42a8','d69806a450635264dc7c37608516645b0ea72b64b3f438ae095eef0afe1c696c','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('inventory_damage_period_totals_internal(uuid,timestamp with time zone,timestamp with time zone)','d97e0b41315e39d6924c34ea5b90f32362d6638c36aeabd52782b783ff6634b3','7e977154e2802f574edcfc426e471be05ab73e82869037f88f743c78036b194b','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('inventory_damage_reject_mutation_internal()','e17cbd70bf217c0264f559da47824f6e09d760326a33486b07ac76ee36dfe4a0','59b818bef0be9a90f374b336915c677b4fd76cb0defe436c8ffa9c54305ddff3','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('is_active_erp_staff()','d3484a9f6e0f78d96517a924f2f2deaaf934b11c4d27e6c94cdbb06bc69834b0','1067f561d9250cad9b6fca264fa0c16524e68148525fe2a84d16d3fe11164c44','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('is_authenticated()','e1ac574a4e8194e1347ed287ee6b1c07378bf74ab379fc0e6618db919fc890f6','d03a3ed6eed728ae1eb26aa4c5b4ed3e3e1d872855e7d4a50e5204f9dbbe337b','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('is_mfa_policy_satisfied()','6925ebb2e9634c4c6c4444489e4bdedd5d2fbb2d3ec60856e013151e094882ef','18d45226808426ecd3999ca8c564416a4a2a92d6ac9883be0cc0c8c500fa7151','postgres','["search_path=public, auth, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('issue_supplier_cheque_v1(uuid,uuid,text,text,date,bigint,text,text,uuid,uuid,boolean)','af305d13c97680532581c83081ae8791f79de522a049e2303c23e790d57e422f','0b4376d26185e73519571ac63693da3aa3689754d6daf513eacc512509125369','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('mark_all_stock_alerts_read()','30eab73e75fa98a2afbb133e6c6d6fa955add9a40169c52dd280e463423be842','7c51b9728afc00c49374897a13a006c8d674f7969c3d759ae7a2457fe89d3663','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('mark_stock_alert_read(uuid)','2be28d31de3a4f7b61f81be297bf8100520bd529fd72eef0093d27725ee913c4','f2530594d1688802486400839a56bafd1aaf321e7f2f9108bf002cbe9e5ab911','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('normalize_customer_phone(text)','62e4fa7b1435b406c30cbad856d39322294874a0fdf6392ca9fbaede90431648','863f9e9e12f7452c926ccc5e9e3c0453ef42b5ad2bc292573e85bbaffc4b9ba8','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('notify_new_website_order_push()','1e29f10a739645f657f151cee1826f827a926bbf147c80393776a5d016e95576','65ee583ecae7ef940229dfb92d7cd1254d55de88f40261ce041f9a857c7ac8eb','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('open_cash_shift(uuid,bigint)','1e81b56831466551cf4832270e77d08871716263f9ba422e4a06ce43f0fff55d','86eb396332c84c0bc7cf49b611da59cd78f324b139277938ecc1337b9eea4b65','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('owner217_claim_deliveries_internal(text,integer,integer)','71aee5432b41ba415f366b2dd1f126a1cdb1c53c0f141f0881f0a73c44adeba6','fb8f1b763325607019d34ad76b870b08a064eb4abc08962a71ba5559b55887e0','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('owner217_complete_delivery_internal(uuid,text,boolean,text)','46a4e548a72aa58c3edf5471eccfb4f7feba77a65d856a9de87d9c86464e74b2','debf9612aad5ec55340cec4f321063c3d72a0f0440fffa9edd7b0cb890570561','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('owner_telegram_dispatch_lease_valid_v1(uuid)','1531f6b813a34d5f0beb5a54c3e36623a9286a24bc578250a2dba44c8dda7ada','55536574c0cc2a5335062911115fdc8a68d1e414539c34864749fdc12f50e301','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,service_role=X/postgres}'),
('owner_withdrawal_closing_section_internal(uuid)','5096fcaecc4b809b96ca76d8cce23140d31c11a87ab88fb1d3122dc58675df4b','25f88d4eed838c81d00727ad176d270a401cb3acfd4baf1e13ff22ed2b982e08','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('owner_withdrawal_events_internal(uuid,timestamp with time zone,timestamp with time zone)','317cbdd304602c4f7091c35ba793bbe77b3566b08b9a416c4638401e6228f0ae','2af4ad360c9b06835ba3d496c5a0a6f058292bcabcf5ff53aff053ebf10f4dd2','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('owner_withdrawal_format_jod_internal(bigint)','8b04fad9c7d54297e434720886cc3e05aba08199acbe6edcba8f48abfc6d9330','2d145d30b3e1ccd6c31ffef34f2c2b56669de2e27cea093e28b555f624c4287f','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('owner_withdrawal_frozen_shift_effect_internal(uuid)','e1bc4dbdcd747b95fe47aef29e5b601c110ae1e188be185bddb5b601307119a2','e291c3b908e66a7564e9de3415ada0b00ade0921ad1dbbc2f78615a6ac786ad6','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('owner_withdrawal_integrity_issues_internal()','43b2d1121b278d9951ccaa97c563955bce983f9e9be708b296fdfd14f4454c3a','55308006cc873471036dd421b069482a56bfb7cd2296d775c8aeb9d15d15a769','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('owner_withdrawal_period_totals_internal(uuid,timestamp with time zone,timestamp with time zone)','80f870d4ac730be2b9580024e7596582edc4a5658660e5783298fb15f2a95393','b0602441e2abbe14012d20f83687279bb0c29b53e134723e276c23c287a1bd93','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('owner_withdrawal_reject_mutation()','9ee220bebeec53e8ec576cf4d5fea45321a561c43209ceb870a5351a53789531','e3aee5bc1472bfc834c5bf8036516672d738f2d66b72b15a66cfdd4c23dbfcc8','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('owner_withdrawal_result_internal(uuid,boolean)','63848951b4cc64cdca2c4f454689c41522a5a22583d87ec8ecb24c6db680b1cf','ae914a0477efd5d2d645c788ca67d18bcc8e8ced10c306a10d079a948e13b551','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('owner_withdrawal_shift_effect_internal(uuid)','d50cff8062c35e3af2b99fc9a6ed1c08f8a02521c38dc63f936424a4d64eeb4e','d39f27c0b8713e0965a58a403dd101b55bbe8e600eb9b263d9bca0fd7a8848f5','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('owner_withdrawal_shift_reversal_plan_internal(uuid)','a910437f5bb2e683c5b7e02cd60ca784e0641f896da5ba91c45741900f3afcfd','53b9419d1cde6f597281e53263ac40b91d17dc8aa5fd63758ad6bf92baf69159','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('package_d_assert_carton_return_item_internal(jsonb)','8da6e98c864e3eb8fc527271176a5c6505ba5b56f4ce00d972a76555ca0164bd','df6f5723865963440bbcda3455429954f7b2e3c193cbd68f8505511aeb06f325','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('package_d_assert_modern_sale_internal(uuid,text)','78124b6530871b1ecae2cddb79052eaabd4946ca1e83ca18afec6adfb98f5caa','af8ebcd2ac8c2a28d94531acba12b590dc5582b46a53fe3e1f4bff23a5ddc8a6','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('package_d_assert_return_evidence_before_single_sku_internal(uuid,boolean)','c8c6046e43e3677bcbc3fe46a0c73f2b9612087ba3c439f0bf2447f79364cd03','5bd1cf4845665472c3f0b913e5481066ea40ddd8b3e88e424127857b6a2031d1','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('package_d_assert_whole_single_sku_quantity_internal(uuid,integer)','8eaafcf677fc2b22e0d91bf552946b22ff1366dd4622a00e2b964acf3ee1ccb9','6ed3c516aa408cc99de4399a173fe75126ae03a74f1f4cedf71f05efb5ad992b','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('package_d_capture_single_sku_price_snapshot()','0f62b9fb4e6567abdbb8149d100370fc381ed6ee1be5fd82134d40d2e1774c5e','892b44635f856a20eace1a7bb6edf52515a44c2c03c9a7935b722281910d9434','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('package_d_create_customer_order_before_source_guard_internal(text,text,text,text,text,text,text,text,text,text,text,double precision,double precision,text,text,text,uuid,uuid,jsonb,bigint,bigint,text,text,text)','cd204da674a1e713ab0e3789929be7609b12cf8cf368b5f1d189873eadafabe1','87880cb9d11cbab9feba17348052f46f08eeaf3d4ee75bbe4be4e64e8c737874','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('package_d_create_pos_sale_before_attempt_guard_internal(uuid,uuid,uuid,text,text,jsonb,bigint,bigint,text)','321a3e22afc02ced7a043892d5c147c462e4319a6b35716a6795a055f2c349c6','173fb6f04b952b6db1bc7a7ac77dab77a2eb2beef92ca042d59a3fb0195274b2','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('package_d_guard_physical_capacity_internal()','5d25c59a536492774d2bde6aef7bd58d15a9bede86490695cf8b2e4b4169d6e3','e3758fa5389f631a988ad5b5f41c9d40c8506dc81aaecb97dd444046be49411f','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('package_d_public_parcel_options_before_policy_internal(uuid[])','341c5022a743bdba146721c005d39b166ebdcc7e88fc736eeb7a6e9fee8b79f9','600e09a155b99ab6953d590ba0b30538c3730e16cef8bf0e7b1628496c424257','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('package_d_reject_pos_cancellation_mutation()','58669f2a947132c1408c0121a4f14534d392864fd36bf85a42d35677b2a0313c','93752ab82ea712969ecdcef84949f5ba8836cf433d8f4d8cf4eda8ee763d11b9','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('package_d_replacement_evidence_before_carton_internal(uuid,boolean)','992582c75e85aae4a910ad488a34a57b8ef5d2f9d0fcd3cd266dd03fda4fe7d4','e0d26122b7ffd3ac4534b2cd176d9b4761cff5fbb629e287955984a5e86473b7','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('package_d_settle_sales_replacement_before_guard_internal(uuid,text,jsonb,text,text)','5adec3ee4344464f3c596b8136a6d07c0c239038ba212770fafa9a0e84b0a0c2','267e0b4006507c321804d7e0e0ea691f1ef8be332f445764e0e176fc57ad3e01','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('package_d_settle_sales_return_before_guard_internal(uuid,text,jsonb,text,text,text,text)','90385b4fa629af45ee535d66a1ec1dc312dccee5d0cec970228132561cd7ea31','843f154dd68764aa835de8a4ec5d9ded52be44bcfbf23665e2fbf9b8d4d30b6f','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('package_d_validate_configurable_parcel_before_policy_internal(text,uuid,uuid,uuid,integer,jsonb)','4053821b74a74a8e7d5922c6bb95c74d9e43ea787a03fff0965a2846e7402c56','87986d89fa222ba929c9939445862797cd56f63a413b7e04f5fbc5ec99792142','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('parcel209_effective_only_internal(uuid)','75162658c4c41c6761a5fe5d0573bff1ee66f6d89b0b97df2b8dd75e2a2bca33','117db108e428c7f0ff0f5d9fa997a79e49d820bef7e18c72e06622c25ab6a0a6','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('parcel209_guard_legacy_items_internal(jsonb)','670e02cbe20f1174ce6971b4574c6895871c71e3e9e307d5fa493718a2fdf310','e2b826b7362dccec66a1f09dfc3165789288e4caed792405c161361dbf98ce67','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('parcel209_guard_modern_lines_internal(jsonb)','fb25a14e0770e23cf88f3ed47604543215b8aff606ec821c77345ba6cc4d0578','ad5ac241c02734b08ee55076559a636b0011ab847b5beff95a03a4151bde5823','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('parcel209_guard_replacement_internal(jsonb)','fcf5fa190f4f79679209aff3b1d9f8da0c2c906c8a251000c78071e65589921c','bd65707dc9b4be98a0b2096f3b88c4ec7340d8d4230f6be414a7bc8ad99f91d2','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('parcel209_inventory_family_set_internal(uuid[])','6b26c09e3cabfb44c08a571c969c16539914201f97801d6674c1bb76bde53ca3','501437b97e4d57d30b1739671ac4c9a1215f20082349d880772cdc4175cdcc91','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('parcel209_pos_customer_internal(uuid,uuid,uuid,text,text,jsonb,bigint,bigint,text)','126627d3383c01e77543e9441dfe3526bbaff4bb6cecaec79b76d73e19a23358','fce0a7a7241ad06ebd8a69e569d5ededc7ad1cb0d7de5e88e833f6205e56330e','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('parcel209_pos_sale_internal(uuid,uuid,uuid,text,text,jsonb,bigint,bigint,text)','e2761c977438dd1127e078ddf5a0676b742a70f206a571044760db3f3b080d4d','8f0af4b176eac6dc79a89ccf916f9639b5d6393cdd17e7a4ec7786f5407842b3','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('parcel209_replacement_issuer_internal(uuid,text,jsonb,text,text)','e6687937a2e13c7712890287e3d4f70773f35ce0fde176140a337bb3c93e4487','d321ac36e1a2d13d5cebbe57a0848138e8f09a1864c8164a23050f520f77625b','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('parcel209_set_flag_internal(uuid,boolean)','a4413a2034e5c32adb2feda568c647c8eb29d96ecfe1788b3d1c8500539d2e0f','e73ae94fb95ac29333d9a496d8a9575e5c65a749cf3a36f9c6fd1903f5407018','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('pay_supplier_cheque_claim_v1(uuid,uuid,bigint,text,text,text,text)','2fe08c057a6a6a9bcb5f8fbfdac3fc1f2b7ffa3c92af179370f2e51c9ffa9fe5','bc7e357184ae45c1d224c4e74d70bcc1417d730c7180d8e13b554315b8f48051','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('pay_supplier_opening_balance_v1(uuid,uuid,bigint,text,text,text,text)','a4afa35320477f8efbf7abad0c872d4834bb3ca9263cbfafb3523114c82fc2ed','287b276dbbe3db692083dce4ee54517ad80a11c5a563d0ac6dc5dcf2206b9924','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('phase133_legacy_po_payables_internal()','2fba411caced86859521656753da0d7f61abe30863b070143d407ef5834e5f8b','fcb763c550f947d6ebfbcf3dbb811c8c09a529e135e0f5aeb3b83476b80c8154','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase133_supplier_balance_evidence_internal()','a38bae7dd4005115eaafcd492358f29ce25ac7f134ed054051dc749a03a1362c','66fe83d216ea7778b835887b0cb9b50fd61dd69d358d37977d5b2fdf665f1fa9','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase133_supplier_balances_internal()','95df82c1ca6a3022b9114a18da74a9b8440df0e597039abbe10463bbe230c9d9','5932d12792711470b558352c99038ce6fdb44a366e0fa612f9d96036a7ca1a80','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase2_allocate_largest_remainder_internal(bigint,jsonb)','b5042d17c1e6defd94ddbcfef794942622f713afc8f5b3c27601f4c59ab3c458','151ec8a2ceb597cf816129d220f5a8c95ee18b656c31a115d8760d103f35e755','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase2_apply_inventory_and_wac_internal(uuid,uuid,text,uuid,jsonb,uuid,text)','478de04336b432e0f0e3e637193256c91130a450d5c0c322dc56cc654195f05c','9fba0590abe799b75d4300b64bd0c5d93c57ddfc4bd91c41ff24968c69edb57c','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase2_canonicalize_legacy_receipt_items_internal(jsonb)','4115f7e23cc0f6d0e65bc66f0b8c5341866a0e219f6d37f766096b536811087c','3f0bb7b5d1b98a155c4d3359afb6e91d2cb0aba7d8a286ff2c89f5017eb8f751','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase2_canonicalize_receipt_lines_internal(jsonb)','4ad838104dc17ccf0812767f2b47b8c826fd2a5de80d0aa00d3b6ce451ea578d','42f4b81de46e5d029d0145f19102aa0e3b9b4d64e31620c97b1420e2f348d15e','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase2_lock_inventory_products_internal(uuid[])','8017eaacb29730b055921eed14b4c95141b1c5c3e7459d15b56a2f58fa8bb3df','dede97031377cf5342f667e9728cb0d4662f6c8d1125cf88cde488644852c6e0','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase2_lock_payment_shift_internal(uuid,text,bigint)','0bb1c425e2c3fec8d2b9dc5426ad3b838f542cad0238618aa47a69b0e89b04eb','60dbc3073c7726249398a5b374eb234aba3dbd8154e8c41d9aed5a0d8374ae1a','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase2_lock_receipt_payment_shifts_internal(uuid,uuid)','907c7b2dde386aca365bda5b5918d9d06acbd79d24238d323b57cf3f3723cbce','e0045353df2c1787d5d9517a3b7b58fa247c6d1b8b45bf117090f41ce2f2c41f','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase2_request_fingerprint_internal(jsonb)','285f6a552d6c94d6b987162c07015ccf53a18bdc8e2fe34cef01d7b33ef1808e','936df8c9a122f13e95ad8bcc209cbcbdfd87b3dece599dbfb8b2952bea8bca56','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase2_reverse_inventory_and_wac_internal(uuid,uuid,uuid,text,uuid,uuid,text)','84fbbd59a8551943c3d760941e7345644bf2410a2a5d18fc327cfe6f5e3dc8d8','d7dd66c84bf7fb405437cd0f84207d66726a7987e8d19076e0194119baf79162','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase2_try_parse_uuid_internal(text)','25ad625f187c98d06c409f45c1daeb2802e7bd8bee35ae0f0a96c4d396856169','42637b2c7c236ce2de3e7563767cb339c528be3e4276f957bbfdfc89b3a08320','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase2_validate_receipt_lines_internal(jsonb)','3669c0007c3f547f8616250ade36c94e4ba781d39837c1954ae556acdf878dba','198ce0b928729f029e1cbfc2fe70db3cde9879ff902b5b7df1263b94c6e9ab06','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase35_report_base_unit_count_internal(uuid,text,integer)','186f7ac6a6e5020c99b9f02fe927640696939b6f7ea5ed4b9c885ed5b552cb2b','399346cf2f646c3a22b624265e7f11fb29517808130e585995b0ebe146f412ef','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase35_report_package_count_internal(uuid,text,integer,integer)','0f91b6b5286dc8ab21046a6f6e1ffd8050d07ad67fb948e395110205b3fc3478','9f49ae0c7df745fb3f62326338f284ddc22d34648630532a550a0ae4cb46f145','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase3_actor_scope_hash_internal(text,uuid,text,text)','d396ecf9c32ee6f94fa6d455635355c6e2b0cac51e0406fb2618b351da939fa1','8e7507e6336df3ed651bb5ba1df213e370789654df3e1a0c3f2edb369236cb66','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase3_allocate_parcel_cogs_internal(jsonb)','4ac6e0d2ede50c54852c732700aa649c9ae47e733a065c0f7c3de70c07e1485d','e68a3ae360d55ffa58bb52957a4518251fc6a57bb43280f86ed40f7a00f7e565','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase3_assert_configurable_parcel_creation_allowed_internal(text,uuid)','feeb9f826bffb6f0bd640d43a4d20c275800e5c1f58ec6d3b35c3c1c8be05744','4e99cff3ab4196eda27b9a93e1032bf0ff576929b1a774a70a2aa5f975290b0c','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase3_assert_legacy_customer_lifecycle_allowed_internal(uuid)','5bd2b45891d7f8ad43b6316064dbe3b3b04e156229333a6769927632cba019f5','6e6eb94b9b21bd3a8647c290cbf4d2b279312745caaa71f3a20ffdb345e66c51','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase3_canonicalize_components_internal(jsonb)','8414ecf265dd688da208a637e2b1152e33ddb324db61752354c77cc98094f91c','042b201d871627b08fabb5fde3778dcd78f72733dbd900e0a0b58c43c1e55839','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase3_canonicalize_sale_request_internal(jsonb)','02c987168c88727906402cf511c312c588b1bbcf14abb8b45b264de89067848c','1f520b1e8d1b52908aff451d9153f73563cad7870419442c25e07416a505171b','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase3_customer_cost_finalization_allowed_internal(uuid,text,uuid)','00d8d200a9a9d02d6989bb518469158f0cd74467c7d29db17fce2ca0d48e2a00','05bec7748428c60c69c4387b90ba875a177b88751110aba55c461476c459e0e3','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase3_customer_line_identity_internal(jsonb)','db9195d38faff8627a681fee1562dacebcc231822464c76a47abc8ab8c43a6dc','d3ad01707ecb6dd3193dd302c69f6fa73fb5ee2d7ba05d01a83ca1262236f542','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase3_expire_customer_order_v2_internal(uuid)','b1e9d43e45b8b22bde53afc3e30281246952733133923b47de75db39d5b308e7','f91f3098e35fa74d922065dad36fa47eb5af30a66028d15197fdc42b93cd8dde','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase3_lock_inventory_products_internal(uuid[])','4fcc232683685ffc666f7fe4d4632dd2f89f8389dbedc1c58326ec22ef6db0fa','5cfae93246e867b157456bd1244b8dc814c9786e0ed773050cb20311d7f44cf4','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase3_lock_open_pos_shift_internal(uuid)','e10fce51e73fa935cba2324881829a4fdabcffc61c15e84764f7b1e752009cc2','0b0c9d7d212d991dc48b11d01c434418cfc42ebb4601258ca4e47509215b150c','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase3_pos_reversal_inventory_rows_internal(uuid)','942f625354c79827883fc16b0bd9131a260073d11f0b3a6ef81888b020b38598','c1eb5283a9cc067cbeb3568337dec0621068e452401ecf674551123945612325','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase3_release_customer_reservations_internal(uuid,uuid,text,text,text,jsonb,text,text,uuid,text,text)','71d07609f9bd7c16c824908abc5631008584c87fc8db1665c7b2de83f6fe56cb','04b0dfb01c0db8c7f1f1c68812bac018935f3ad0fc874ab7610dec0640fe937a','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase3_request_fingerprint_internal(jsonb)','285f6a552d6c94d6b987162c07015ccf53a18bdc8e2fe34cef01d7b33ef1808e','d5b33a44a322bb0a6ddc70bb87fefc2a6ee05879470a0b0d4fa0b2fba97ee1ab','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase3_require_nonnegative_bigint_internal(text,text)','d1f66c8850dd0a5921c28ced1187a26a2bb9bd93a51e564c213871091f73a359','fb7ec7a0a9b9aeada692eb702fc2ff008220604a59e518847b3d252dfccfa1a6','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase3_require_positive_integer_internal(text,text)','d2df3f17684f896365a691552a51a53c83146e5081839dfd3761295f123532f6','90ce7e6f894b62061c0fc8b9b6b68ebc8fc3732a73681dc7f7b686c2d8f5b7f5','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase3_require_uuid_internal(text,text)','8fabc6c5e8462d0ecd6dcfb07db530908636f80c62e0253b1c4723f0ca7f6ee9','36909a1b6f312098dc438a71f04a9ffe2c5a51fefdb4c81f492b76c8e4461c40','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase3_resolve_legacy_pos_location_internal(uuid,uuid)','612b440de697ca3d0ac0c6fe655e464ebc78c4e7ca97482f0c94ece7e3758d99','0018be39463307bd5a84d64491fd6c75c265e641b43d138c29dc49d5935822b0','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase3_resolve_operation_replay_internal(text,text,text,text,text)','1b6c1d667055a2c2b4d6629e17cd888a6c03482e8d502ace40d6ac72a62cbccc','f3ee1356c083e8ab2a237655796e853e47ba821f655824405e8424b8340c9842','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase3_validate_configurable_parcel_internal(text,uuid,uuid,uuid,integer,jsonb)','2d658779360bd7e62ac721df2cf93c9b798f5ea51e80971dba68e50dc5bbe824','88ee5afd46f91d5457247d4975843a01e1f50f68c118f0a99af6be73b7145faf','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase42_apply_return_inventory_before_phase43_internal(uuid,uuid,uuid,jsonb,uuid)','86e8f476bd0c0f30f54fca45c7dfa46e6a12d5574ce9a0f9a3cc382b2e11e16e','7890a50422a1c7f24e39bcec5195bbf721f1b1f49d2447533d77053d496f9c97','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase42_apply_return_inventory_internal(uuid,uuid,uuid,jsonb,uuid)','729bd35deff9e3a2328fa5d6ab7517a345691573968c101a294949915480f70a','429640ccab37373c8bb313db68a44bcd3dffacfbcf71e5f913b22fc8266681ce','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase42_assert_operational_return_evidence_before_phase43(uuid,boolean)','dedb9a293dd36f378b605a84bf0071a3da14a309660df0198459c7b92ae93199','698c65a711c7a24bdb8a7b5e1b704ee4b925f75b34fa6e5335ef1b8c525da82f','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase42_assert_operational_return_evidence_internal(uuid,boolean)','206717f64ee90c031f38d924b780c9067e40b2f48f5470b950caa5ef4391a3e0','04447943ceafb488353eaedc8d5e198ff61d421543890aa89dd5f1212e9308cc','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase42_canonicalize_return_request_before_phase43_internal(uuid,jsonb,text,text,text,text)','8d5f6fcfdfa790b78140e37efcc9458096a79364dbf134b7da8aa3c83248c58c','f3981c500af9e060d1fc9ad3bab4fdc038f4a21733e70199952f74ac6f47eac3','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase42_canonicalize_return_request_internal(uuid,jsonb,text,text,text,text)','658da476bcdf6db0066420992658d22aec5c309f27907310d5838a741e9e24b2','8d8e4df2c8ff9b1e0295c5c863821645e72e366ddc0915a19538da8bed5bff7c','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase42_customer_receivable_total_internal(uuid)','554ad2d5f5940dfc2b8c01b540ca7ec14eef7707ca69ed13d8b5ae4df18eae86','743151bacfb2d899489637157002bc0f8a16d3ee9a981b2a322958a677fad876','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase42_expected_return_effects_pre43_internal(uuid)','4efd045a0a0c5f1da89eda9bb66543692698117150c375a077707a46a3618ddf','76ec07eab9988636773462611fc9003a33c8f28a96a7be65726b283422d127bb','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase42_expected_return_inventory_effects_internal(uuid)','6db1664bc018802433a6d74a151e37044b2523ad2645f84c88ea39a87ee50466','1c411d46517454c92b3945c05d1b34b776cff21b6c5c69eab7894d9f9d40ada9','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase42_guard_inventory_effect_history()','129e1508b43a944d66e49dd7e4cf9e8e9bef81b7567b500c17ff42765b127da6','673f7bfd68181d9d2bc9615dd006dbd5acdfbc0c50e59d5cf96bdf7353471e59','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase42_guard_return_coordinator_version()','919b1b00cc7000cfd7c8716bf8d510457fc66542b9bc729eae0cc86c5e14f117','b4aabd18e1ceef430ea98cb574eebfbd5e55285f86bc34616b84ebffee52863d','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase42_guard_settlement_evidence()','29f33d4947635ef84885a910741779130040858a39d2ac7ab751149b329f52f9','e80bbeb81b1cb4e0f0f74562fb5fa57a334d0cc795b143e0373cdd70e8bb8ed6','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase42_inventory_effects_snapshot_internal(uuid)','309b96e5875c988901b7182895f0e5476f885ad800cb1658e6bf5651654e4a20','b038124b819e69328ee0b61e8e8df4511943d831ee3e742db547195c68a33580','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase42_order_financial_position_internal(uuid)','9a4c8483180151d202ff58cd671361d593e24a37f0eb6da8be49b4f52d16068e','3f4cfa9f1292a88c1ad22ae92fad1e971fae68f0ca688f868059499363e2b9ed','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase42_require_evidence_before_return_settlement()','859b2f32a9f9ca68a11394e5d04b4096dd915a0f9217f12065afe85fe951276f','ea0a1b46968c2322ccb4778e93c11fb1e5024da5c647a2163e2ab6dc38722200','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase43_assert_operational_replacement_evidence_internal(uuid,boolean)','f64621b097a5a0032720af573346e53f0f107787cb06216a0fcdf583dee3e33a','977b981c026bd30f57d66e46fc8606de1dc87e6d074c033bd34a8ed60093ca95','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase43_assert_return_allocation_contract_internal(jsonb,jsonb)','a2ab8af7d52cfc45b6b49974af1308a1c40d2abc586ced37caf52dc544ea58b8','b2fc0adf47a5e380f49d9e4a9fc00916866e9795a21dcc3ba4c39ff2f794a488','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase43_assert_return_physical_evidence_set_internal(uuid)','e783d17f4d4b2c56b58f8c404011b7f421e31f441f890124511ad62243e8bd0f','f1df588f3320f2a1dfb02858d27ee93ac471ab27c6e7fac7f9ff8b05976150f2','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase43_assert_return_physical_source_internal(uuid,text,uuid,text,uuid,uuid)','d75d9033cd6efe0721228db0817f1a460d08915c13933305ff3a2afa9e91b406','07ce65558f0e0b619e48a91502510bd063f62a663b4954151db0544f2753c6b2','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase43_canonicalize_replacement_request_internal(uuid,jsonb,text,text)','418f399e788291fa83cc9e7dfd6643235a86f53f81e6ab20706335767cde8d77','46ed234782a4a571a6691c1ba6434f99de4d2ed0312844df8c4c7abc57e2bbc2','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase43_canonicalize_return_physical_sources_internal(jsonb)','8a37d23a68b0ce973aa65a9759efd5ae485258b7905d85928e480016202b6029','356a1c07083d2bfb8d083da2eb678d1ee11bfbadcbfe0feffc21185cc17cd3f8','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase43_current_physical_representatives_internal(text,uuid,uuid)','62092d5f0d3a17525216d00a7ce86a885089fb6de9270b42966ea2dac3282d81','9e9e99be4a9257e9f075ada289e1d942def608db7c94c476cf03ecd428857938','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase43_guard_immutable_replacement_effect()','7d962693cb6af64b513d4cd7e88302e9f556860833bc1279ce8f3a74527ac2bc','b35ff98d66c8052b6cd7f408309733896f663fec56a4a64bac18b5d570fbb8af','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase43_guard_replacement_settlement_evidence()','1ff3177edc7830899eaffcebc0d7101a72b70d813e74445d1312bd7080dfbe03','66b23008effb85f92393e369c3ff18ec5d6ccc71ba1b86fa114305666765d817','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase43_inventory_effects_snapshot_internal(uuid)','8e966b3e3c1f1a7e320eedb2ab6768ef0c8260cfcb59fa85dd648b52c32db0ee','b412b7f5cf2f3b16fccb7d61d3ca0487e9160ba12f0e87b1ff05bf60206ab2fe','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase43_rebind_return_consumption_to_leaf()','1b8dceef7a35f1dbc088b99ed7884ab9bb8f91b9b3dd566a0978f4a3e0d539af','2d19b69cc5ae86b833b82f05eba4cd35a81b0a1a1a0a7e0add2d7320b6768256','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase43_resolve_replacement_replay_internal(text,text,text)','135f8804d4bc92896e6f6cd2b112490b880d5df0a91eda131f192266f2d06658','96a4bc6c0770eec4d75df5c20792792c32fa84fb1206433e7d950c46ebe88bb4','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase43_return_inventory_sources_internal(uuid,jsonb)','b353d5d61faf5807cb415b71c9a8da285d067b7b1c79ca16e16867fb86afff54','73dd0e806a68c0487464eeb2bff423958b17610d11f33db8b8d6cda38f7486ce','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase4_aftercare_source_root_internal(text,uuid,uuid)','891026386ebfd7c5637bb977bdad3cd4bf326199fd201d85f069515d699a9ea1','5a017601a38e486030c051c945c3f6a2c1f1ab42b91ee93263cb4c3f46c46c26','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase4_assert_aftercare_operation_binding_internal(uuid,text,uuid,smallint)','905876d96ebb25aea8a844a1a5cabe7be98d4785eed0c14a60fbaf520c0aa8c4','1ce010945ab336ca23983dd26da2dd9f1146f5c82318cfad8dc4d49d71468316','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase4_assert_no_settled_aftercare_for_order_internal(uuid)','7e75636e9c90fc7f8cbb787efef6db2a105d02c71193fb82444b61d490461c7d','4958de02e5b80bcf9289b142ef27ec998c78637efc2745944228ddc7a99db57d','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase4_assert_success_result_internal(uuid,text,jsonb,uuid)','ccfaddb732b468337e4b80e9cf6feee7c5e4250baef27cfc20aa0bed9ee96440','9b7235199b29fb1a0153e2098d866813d01d6fb522550163cb8f1f5ecd033492','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase4_authoritative_completion_internal(uuid)','70a594e38fb5d884277da8f64991760c173c09bdd30c8415eb86882e1c8001fb','84681dcffb4c4de923b04462b38d00cac95c4658dd26002afd61c6a94dadee7b','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase4_cancel_draft_aftercare_internal(uuid)','ab21311b1e723e964ca3e496d57bbe1e0dda8f554cc6919f6d1e5f88fc665f6d','05b9254cc016bfd0e3ac2c4d80e93fa244a2b92bd7acee3c0d18d428dd97ac07','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase4_canonicalize_idempotency_key_internal(text)','a714d4665320ff9db77f8e54369118515f3fef6f3a66fa7914af3bd241c76e03','7bd714c08b637576196dc5ed9a2dfd9882f1ce35866b1b6a87f59705ade16ffd','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase4_capture_parcel_component_price_snapshot()','5a2ac36408981ef8ab48c60f9679a78c7727c7122a17e967391995b3eaa95fb7','18f14e92cbd1e979e97685f2d6e40f51a480eddcc5a8151972fd793f71e1a359','postgres','["search_path=public, extensions, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase4_customer_completion_replay_preflight_internal(uuid,text,text,bigint,bigint,text,text)','c515483feab73408def02f35c7a5fdfc9440bb2595bf840d8ccb71959b26fe38','3b9183d148d3b330c4016e8fba74c31ca06383d138b7b207f5b86ec01079a6da','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase4_effective_standalone_unit_price_internal(uuid,text,text,text,timestamp with time zone)','7559d1e347a586241dc0cb823f946bdec9ddd96737015c26708c755b73126f44','e8522c8d6626b7d79780593625a063ab02e70cbb4152e308a8f28a2fb313452c','postgres','["search_path=public, extensions, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase4_finalize_aftercare_operation_before_phase43(uuid)','900ff627e42c9809ddbcf822ec5c39b994e24eefdf2404a526c4169cfc77f3d6','4a6a8e682886b0b03de711aa62a57f51d626c0bcebc1c8d7cf71034f441d0d4a','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase4_finalize_aftercare_operation_foundation_internal(uuid)','5636f03379e40ad37cdeec47ebb0113d6594bb6d05152f0176aa1c6fd24fbb50','4eb05e231431d63765f7ec41e4b4c1202e6308c37a56caf96190beb9ebc28c90','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase4_finalize_aftercare_operation_internal(uuid)','3a67c92a54a95a220ffedd79ca78195b4889b2ebcffc8075fcaf0e9f2cf09896','48bd9fa67ecd631db677fa567d9f2b7a5c2dcda6d2e7045b7fec8b6d9cc17f2d','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase4_full_shift_context_snapshot_internal(uuid)','1593afe18957c69df810a497caeef9f4ea31f9244b80ced861d78bbb79225a9e','74756879eb5ad8d56f99fa69d8e6eb9a500b1fbb45cec72e2bf43f60cacabfa3','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase4_guard_aftercare_operation_order_gate()','b4a450336fc3cc00038395c6dff3383e380f2240a87db25a16100aaabedf29e4','4382cbce224bd34e5b5f5650d4f082ac7bad57aff53e40992e16ea4c1c203d6e','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase4_guard_customer_payment_reversal_dependency()','173fdd0169a92aff1be1943c6d6885271d152c515d6b2a59d96e160ea012a1cd','dedeeedc920166967f56a7801ca564535558a8286d0ff0a469c3be9fefed5e30','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase4_guard_order_reversal_dependency()','0c0e05bab8eb58202f64de3b2ecafee8f876f77286d024fafbf359c668596205','3d8f1987d0d6b3fe320284c18dcee949e95b52ddec681260808fbe5068921d54','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase4_guard_replacement_event_insert_state()','4f73d3a19c0da7ffb7d6361fa7d5168ab7c2d678ae842fa7c99e0f2251d55047','d2d7df57aaa894326bf62909605629ad4beceda436435fc8a34f5cdce9e27de0','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase4_guard_return_event_insert_state()','252dfdaa583af34a2ca86ce3b0b306fdc6233733703cc290c39257cd6277f912','ad90ea34d384c13075d3b07d317a15116bd3eb2f4f48ac310b8b25edd83dbf4e','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase4_lock_aftercare_operation_order_internal(uuid,uuid)','1657b0ec6039a3d3f3b2c9ff6a6a49b5e5b34f548cd55a0921147341de2ea752','24aa21f60b2e1823d6ad72ad38c28ec24fe87fbc4749a7b01e8e6c32a573c0a0','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase4_lock_aftercare_order_gate_internal(text,jsonb,uuid)','9637706995b63aa937c002e6125f6c07685ee0f4892964f332a0005baa3e2a4e','b6ff433e0f44e15656079dd68ed8115462fec24137cb37319db3a34f98f97fc0','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase4_lock_aftercare_parent_order_internal(text,uuid,uuid,uuid)','f950b0d4e4b4396388d8c381605a6eac98b771af09ab7e8559fa4cfb5242b5ea','8e07cc114fdf33ffab2d6d8d4f6a52ae3e43173e5fc7be1a6a4c22a502ff6058','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase4_lock_customer_order_context_internal(uuid,boolean,boolean)','f6417094a5218649f06feed5c392ac6add87db7414d55610e17fb52a80debd8a','e75b69e422f94721b548f56fa84a202461a3018b67b2baca38e295c3331dea9c','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase4_lock_full_shift_context_internal(uuid)','6106b891c6b6a892f142a439301544404ce5091cab39625a85308b59411151b0','c306066ed3e3e924f8d008b3f75c237b42a675130931a55c7c756a6a4d948184','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase4_lock_order_inventory_internal(uuid)','1c235fb01ce0bbfbb8103e8ea036c686b45fbf3d5295abb8fb08302c4ea1e503','7767a27755144ca991df35069fac80c42e6dcd194bf8ef20ce7feab5db0d9d73','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase4_lock_supplier_context_internal(uuid,uuid,uuid)','62c48d4947893b08f6f7721e3bf96d2711f3a4f135fd40b471a77fe3b40507d8','3ac082fe6945129a4479389b432651a895dd6de29a379aa2fc679405509fa0f0','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase4_prepare_component_inspection()','850e990e198e039d5e8b5db590ecc0665da67a213849cd0eae1c4b3ec207e886','1aaaab15bf645a4a599c21c37a73c5dd8a0a7e23b43d693268762575643f5601','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase4_resolve_operation_replay_internal(text,text,text,text)','ee4095a4814c06a0afd5701a5859e5fa3f105a9c731178e42922d2cf4f6a4b55','f3c5ae713defe39f4e0e4a80e174c1b3a17350de0541cda5134bd6671dea7bfa','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase4_supplier_context_snapshot_internal(uuid,uuid,uuid)','117cf9750bfc8035228511d69f58d9f22e64bf5e3d0da7b7fa5eab59e66b7757','0bf9a19a4c12f1511885060dc5595e15175b3ec7df90b79521481abda9f76602','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase4_validate_aftercare_consumption_insert()','4f8b43b01f77e4c515eff8e3eca1b5ebcdd9eddb8ff7421cb8c52dc65d3a7d91','25f79368b0c98bfde57f4029b7feff72fdd7db6cf8321f1634a72afbf67f6278','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase4_validate_replacement_item()','1884f34059c84d3d7c288fc25aaf328e0fffd0bed25c5bb9e2f3394d9f3c240f','65245632c35e91f92155a6d52d42e474d4320de79446cdb9770c2ac5696a5ae8','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase4_validate_return_item_insert()','29bdde48db2df20dfcd21036c1f807ab2d924528b09d9b317248b5d837882f46','b5e1f2c57f60873191495da902db64a65bbcdcf6c8a8406bdea20f10d64753f3','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase6_financial_facts_before208_internal(uuid,timestamp with time zone,timestamp with time zone,text,boolean)','cf4732e57b98f161db8f28c4c5e63d2c503c50819fcd5a069760a6f879e5803b','0e3997ce0050701f705d87caf62b9fd55a1f9dbf55cbef3bb84a8a13f55c9510','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase6_financial_facts_internal(uuid,timestamp with time zone,timestamp with time zone,text,boolean)','e12a56fcdc7334a8962ca456fa750f4bf8c215db59a08f77bcd33bb0eb26b40f','5c432cde31028bcca8906ceabcd9ae7335244a67b865cc21bbcd968220ba64e4','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('populate_order_item_cost_snapshot()','b798be4dddd380589f79954689f7c9ee358c55756c44f7469a26e952faad5920','aafec4e7c63e5ccaedc94c748ee68e5ef439b3260a3031b53e2e0c4b11bbe046','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('preview_admin_sales_return_v2(jsonb)','871e7ffe65cfa43aa364132da8082231d548cff7e5489e576f5f2f106f5ff232','4dd844b15397075f2bcc7f42eb3ed9ef3c4a827c74e695201bbb6566a119cf01','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('preview_aftercare_supplier_v1(text,uuid,uuid)','4ca8a77a4000f7a5be77b2e802d517dc3c85580c681a20441395a20d8353219f','1e9892723246b3927becdffb9269010da7e3e1f2018394f245b1c9dc9d526eac','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('preview_cash_shift_full_reversal(uuid)','8fbeba9e6964c93321173b14d39ddede51780c0d48db217e3e7bd5de79585a2c','454951b9e36433b5db18634475759c2672b7deaa2781612b5051e9d9d5670340','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('preview_customer_cheque_v1(uuid,bigint)','778323a8817ff1dd6a814d0b476b708ad09b9a18d1e934bd958b36b51dbf0435','ab0baead777efe5ae5770af73e7c1d17ee7e19018e6e12f3ded19542650622ed','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('preview_customer_collection_v1(uuid,bigint)','f334b1026543f879e9f1ed0f0b84cd38882ed87f1d41eb9f546b96525edc8ac9','ec0c3e8aa405410e6068c8a1f52ab06e78ac2debd760c946778b4fab688bbd0b','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('preview_go_live_cheques_v1(uuid,jsonb)','7d72fd4c5a2d3cbae58f4eb59f67efb9b2211b01ec9d3c5c0e5350bc414d9b56','4d67020214f986a495a19adb9e48a2caf2305182468f850c4744663cb11da37b','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('preview_guest_promotion(text,jsonb,text)','74be4ca55f601c2d62cc053ed0c3391ee82b3fa9905a6350cab3eaaec2553e01','aa77f43c297d5731005ea774930ad3d8665ee6dc4b3c40eb81203e7cab488233','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres}'),
('preview_guest_promotion_v2(jsonb,text,text)','03addd70d4af079d43438aa39fc7dcf2987753a29712031748cf26543693861d','38adaaba391f905d77e35fa4f8a80c541762ea353a07268d239e0084a1b4eee4','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres}'),
('preview_inspected_sales_replacement_v2(jsonb)','3b7da7d8dc44d7ec66c58b5b0b1e4757aad2715a0496d5d59be28c3e9e5adfa9','5b7c55025d65ac3987cddd50e2d344b3b7bb247675807b2e4e4003a2698a8710','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('preview_sales_exchange_v1(jsonb)','3de4a26112f84bc2901b440574899844318ef495d5b842c98a4b036fe717d439','8ad965a0c976f0bb276898ebb16b32c2e2a8dfdc6da2455374d8722b99be1367','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('preview_supplier_cheque_v1(uuid,bigint,uuid,uuid,boolean)','a2ca001bba4e6c717c88908d753d9f9f72ee2946b294cbcdfaa3f8b935fdd07a','a1f4ff27babdfb28f1ac3ac30cb2f9929ebdbcadac209b67d5ae2e6aaafbacf4','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('preview_supplier_receipt_cancellation(uuid)','f57240ae4b56cbb81ff8d3571aa1e59251119dc5a02bc45f0318ed1dff919d45','8d7d11762c54507d5ad94baf7ddd1d44260072fbc896bf126b030e2fb73aab23','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('preview_supplier_replacement_credit_v1(text,jsonb)','874373d385f7eadc5806fa08b4c646b8c50e608c12a489202e3ade0f77906b8a','b2ecad86a453c057bddfaad577ebb60f2bdb493137be90c59e8ccac086fb5a3e','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('preview_supplier_replacement_v1(text,jsonb)','f2248f32eac0677b2d729f4b73ce9235105fa2acf5a676c5a1dd7ce1a53ca4fe','fe5a8f2503947074360732ebad46121d01db55f7c75fac5368141aaa87c9dd96','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('product_cost_corrections_reject_mutation()','cb840305c5b33e937269dbbd60568d01a020c12810a733a3fe666cb476927856','c3d19527edfd51440c6c93b1bf52872ff3cd6e9bd0f40b5b96e0baa140779793','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('product_edit_assert_version_internal(uuid,timestamp with time zone)','568d42e6915b1cabd95048c977aac3f3e71c0204b81a2a0fdcaa544183eb1d71','e1e749f2fab67eff5a5b5d3fb2e1a3f87485ba55b4cecf82cb5a46006681b7fc','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('product_edit_snapshot_internal(uuid)','62ae96bb2e525ce81f779dca543f604436bc8ecf4dc99b8478a8d036283fed2a','00e65c74f24a3056b41ab95085a88fb63575237b944d3b3ed55800066aee0982','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('product_has_cost_history_internal(uuid)','8c2ffb07d51e6f33b0b7d4af0589160f5505b53da207cc74ca68cd415b1e4720','c36ca6d4ca2bf8529805c5cb087d9c25209f72691a20908652d817de0d1f41f0','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('receive_customer_cheque_v1(uuid,uuid,text,text,date,bigint,text,text)','8a4e75b2e520492a0a501ed48d6bc433ca6fa11d173985a66b416655fab98d80','a6eefc486e0f408e2805c98e7ce0f9a1c3339a1b010c3e8c7de5e2e50749a088','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('receive_inventory(uuid,uuid,integer,text,uuid,text)','ffa7a31b4c98631f482eba17962bf62b53916d1916e0e16925effd8da877b399','c2d23f58cec9a412cc924e9836bba679eb1422c41732dabc79f6f1c9a9b5fd0a','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('receive_purchase_order(uuid,uuid,text,text,jsonb)','9e2d70a64cc42aa3ddd3965c362fccafb108166cf90ede62f6fc09ba6bbce408','25d0b8c47b58fcf5aefbe40cdea987ef5432711b98caa1cf75bd03a71e779e76','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('receive_purchase_order_v2(uuid,uuid,text,date,timestamp with time zone,bigint,bigint,bigint,bigint,text,text,text,text,text,jsonb)','de93fb304ea00ff2ce42fb3f0e6954536a571c492b149f3d6461e2bc25acd279','4b23e1cb8e86dbdcaaef68c9d43f9191728d1565063d9ff5dfa2abc0763bb8d1','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('record_customer_opening_balances_v1(text,jsonb,boolean,boolean)','d7e6e0093756280311b281fb40b0e707541bc8982aeaa56b951a951e805056e0','511b05c9393237d47c15ca945280da85a193b89d3985f9e9708c4eb2c055653b','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('record_customer_order_payment(uuid,bigint,text,text,text)','834fec0d8fefec851c7a7c0e79f220bde25536a5d24617160340592556b8e870','7f0d0dc94c9b726958206dc60777c4c4279696906ae2ccd6e259eaadbad4bbe4','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('record_customer_order_payment_once(uuid,bigint,text,text,text,text)','3338800fd261c14f6daa5a3aef7649d6d3773937e83ddd478ff461f29a5588d9','a0e9536b170f2ea4f45d61394a7ae8c8e7b5fe82c7a7389e65468bc46e773570','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('record_erp_staff_password_reset(uuid)','c2a964b9d908d2c98a7e5b5fd29c49da2561b2fe59c184466fb266609c0c54fe','616801bf57eb5c7f662eb785c14341228ee83cbc7b7fe05966affac194d4d358','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('record_external_monitoring_snapshot(jsonb,timestamp with time zone)','1134b81792da11a207ed3cab693477168aa50fcaa8e2ce7244be3f874a9d643c','69935173419fdcd8aebcb46033b47f3a41635aee11822ce4eb46e1bfe0c54794','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('record_go_live_cheques_v1(uuid,text,jsonb)','f6ca68e42cea0bd139a37a66d2b0b856a7b2ca9630810a0d111baafdb92e1197','f9337e705e72c0157f796ad8d54e7ee26e3122d496dde80c85c2d3e2e6d97276','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('record_supplier_opening_balances_v1(text,jsonb,boolean,boolean)','e2748fc558bea76cc7968685b4b2eafb9d2252575f0e911d4528e4800617fd47','cb8b10c18758b3be431e4c8bd228c957f076396e76223c93c78e2045d2dea0a8','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('record_supplier_payment(uuid,uuid,bigint,text,text,timestamp with time zone,text,text)','3bc85d974a59fa3d0bdef88f46b9a505815e3591bcb59fa66c884f8a01cab2ea','fdc294c329f0dfe30dc8a93f8e54cae42f1ba26c25a0225550eb421f347dd4d3','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('record_supplier_receipt_payment(uuid,bigint,text,text,text,text)','5e80e3f94f07a3708770ad12ce29db2872ebcd64bd1fb519665da332ca8cf3e8','aa268ff3f1539befb7c72e78c4f50cd1f624ae6dd5d77bed8acdc96b61cb6598','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('reject_flavor_master_inventory_mutation()','8d8f1227c4e9e2949b7931bfbf6c0f8a46b411562d3827dc308d74e4fb6926e1','d223fb46d0b94bc26165e0bb69b1bbc65a7cb36e92628e5f0137a28027cd56fb','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('reject_stocked_product_flavor_master_promotion()','a4abdd3415f2766a3ec2cf88fa3435a65648b9065d75f1afd5a0fcf4e807fa53','8c176a49df8f054d2a8625b0df82bdb6e77d860025deb2fb48ff38099df69a08','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('release_owner_telegram_dispatch_v1(uuid)','738d649bd21bbfaee0e13fc8dac05bfa57150c1c01a2978e9d07a970bfedf733','7fe04b4be6dbf05fcda369b0948f2e82e9ed082427267c1fa2d8cd74e04ecc91','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,service_role=X/postgres}'),
('reorder_product_flavors_v1(uuid,uuid[])','31744ee1bcf6351b2951f9fc002a920247855a7373c85897cb99880ed0dd0f79','18d89f0d05d49c724132daa7f4be0752a7a9dfb92685fdeda71b05696a55692b','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('report_admin_runtime_incident(text,text)','9f11ea01c2ba80e401d586560d5a815a0f876f052563817581e65360c89a8c70','51b6a96d685e5b5b1ce658bb471fb4cabc92a178ab19069918af81698b2452f7','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('resolve_legacy_supplier_receipt_replay_v1(uuid)','77ad4281857c4c81c243e7cbcf39d59bb175a949749193e39aafcfc5c95a356d','09b34206e15baa17f54b97b5533c33a76e8eb91b9bca2efd389bbda6064a3731','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('return_completed_website_order(uuid,text,text,text,text,text)','44da87fe8f4e544aeeb378532dea4b3d0434f3d3ab3cc866ce9176e2201cd085','32a5a3e6c30173d0b99b45a147b32479a6f2b5baf9805039871f4c4a593db088','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('return_deferred_cheque_v1(uuid,integer,text,text)','33c9318864f02b3acda8425a9a0b43dacbc4d23fb80299c344b078cc912347d4','080eb2fa975ded431cc468189fd8c0a03ef810f73b76ed463edb88a914a3bb3b','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('reverse_cash_shift_with_operations(uuid,text,text)','a826e14e97b2ded136d2c5bb659fd7e1710553204d043b665580a6dd4a748347','669e91534d65d38f059ac36fb5343315d30d117a3db36b05859827704121d387','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('reverse_customer_collection_v1(uuid,text)','d1fd88f624fb7aa2578f2476e5e565c27dca3159a30d9d61d0f692d4a2161c65','6c7f4eef753e259de0de9a241d8c6b317198409390e4c7edb4dbe5f80377534d','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('reverse_customer_opening_balance_v1(uuid,text)','e6ad0cf7c14859d77695d58970e4ae4182d24c1f7664155e46a17203ea6c717e','11d4144be172b59f0490d89346388000b0a6d99977a15ddf8f79e0187f669448','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('reverse_customer_order_payment(uuid,text)','f06b4173f0842aebfba447139966291675c2f1178b2b34a4d8bd167e64151587','598289ba9e987983e3b9fa86277a4ed90dd985e50ddc542bdb1ebd63804f892c','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('reverse_operational_expense(uuid,text)','0c408c53d039354d5f83f886ce1e97ef5bab1f78509f64972b140d7510f21181','2d8f4ce2e840e6f6987fe852a7153b11262b28b1e282b89841b5c83326c253b3','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('reverse_owner_cash_withdrawal_v1(uuid,text,text)','56c3f35714fcc520dfe65a001dac02867faffa71bba4177b93fb3c97a123d742','0f48508effb7ddf32565fbe22777f4efd712638549571193a93f08fbf3314f2b','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('reverse_pos_sale(uuid,text,text)','9b515578dcfe825024e136d0f0759e8788b0062ad3a0f7bf62b73c0ba557fca2','b3eeb958419584ea10647f59a0b12e035960cb62388751f607e8d5f5d442a65c','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('reverse_supplier_cheque_claim_payment_v1(uuid,text,text)','86522da08b2924d11a28d082d36d1114614a82a455fe5cd5e3351031151cc796','d681fce19f231fa6179367a771ccb03b64c424ce1b19aed817da7d946d8c131a','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('reverse_supplier_opening_balance_v1(uuid,text)','4f8a6b4976092b4ae02e59a6fea8fa73ec384234532023ae95f6f82b46ee2778','953ef1736edb58ab48bdd61775e04d7688f3b4e81a370b41313f197b61d80235','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('reverse_supplier_payment(uuid,text,text)','318c4d5f5e3f6c8315b01325514adcb9df6c40ea1eac3ef0d1eb7f7fb7904b8c','0b266365c2dda508fa613e49e525c9f4dcc44e34f4629c89c2ed86280e5e84b1','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('run_advanced_monitoring_checks(timestamp with time zone)','0cbc34d196051af43956645f98118c8100caf39794896be6780ed30a601ba903','540709b693eb89360518b083f9787865df9abc28a65278d12474b41e3ce12801','postgres','["search_path=public, extensions, auth, cron, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('save_customer(text,text,uuid,text,text,text,text,text)','f9ec5164cc142625510a0923f1ad4884e580fe670f5e8ddca7cf6b6a9597b58a','e2c2a394b32876558f953bb3717d4a6242a48daafec0bdd9706d12523c33be9f','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('save_owner_warehouse_v1(uuid,text,text,uuid,boolean,timestamp with time zone)','b142743fe700304bfed0250e06783ffb73a9c7648485e175f5d2187807337629','04ba77a62a577982ed675a3cf881c3d8a7f7ddef5bbc48c012a4f253169b7301','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('save_product_brand(text,uuid,text,text)','4a5447bc4ffe07a17ad64bc2b9793f2da259e02c1fa15e8dc1371aa01818eaaa','5eba83fe4ac9348062684914fc94f17c0ec54edfe0a16bfa716e6d68b639efa0','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('save_product_category(text,uuid,text)','889200a99f2487bd6c997565eb6079b263e572a37108a1502fede52647cb0781','6c7cbb4018e6a851df50fb7de347a23703136d789e8f29308a22d2161e5c4d35','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('save_product_category(text,uuid,text,text)','24278d9a8d7f98bcc7b786e28648304e9846a32c52608872566bd34883044966','6ec1395a8568e7c77002a628b893b8dfe1afe938b0f239a12d392d7dbeeac67e','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('save_product_parcel_configuration_v1(uuid,text,boolean)','05780c7e6a5183cf3de9ddefa6199a8b4b12d5e0f79d4b59b7947595a680f419','60e8cdf16202ae350d36e99c0e995f12a6dd7ab452eb114c063b9f79252dcd5d','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('save_product_parcel_configuration_v1(uuid,text,boolean,integer,uuid[])','5dee6b99526d44d68f1ccf21e81679cb2645b2f0eb8736c7e5414b6c3e1f8721','ca8392dc293245cb27bf7c84d5556e381c70594a6a2c7282fe601bd9da9844c5','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('save_product_unit(text,text,integer,uuid)','d84f49c87dc48a15f66c272d774b11e96bf49351766a2879259ff54ad7ddba63','1fef4fa01891fc5d22adc5c9331ba1aa687a83c83cacbe450fcfe58ce6652ff1','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('save_push_subscription(text,text,text,text,text)','7ae68605d99cef899a87cf1fb9a1ba1dab428ca249c5476c169aa14716c4c4ed','d4533b80d9c207111093dc9946701fcfab21e79fccbf310dcba8ba5ffbdd7183','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('save_storefront_settings(text,text,text,boolean,text,text,text,text,text,bigint,bigint)','124270a34cf21154b66767cc1ccfbd745d393d982cdee821ea17205916b79a7b','5fa9e10e034b03429d1f7a1ec588a0f5769da9426114d4bc9667b3aa65fd9d4c','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('save_storefront_settings_v2(text,text,text,boolean,text,text,text,text,text,bigint,bigint,boolean,boolean,boolean,boolean)','fcf0254d190910a8cdca6c320f2718704cb53b12db7141f2fee41141da1447f9','e457d0447cc570331f9dc0589481ad0349cdc79f4d7398a657875e898e261c1d','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('save_storefront_settings_v3(text,text,text,boolean,text,text,text,text,text,bigint,bigint,bigint,boolean,boolean,boolean,boolean)','cfc00023d6423a303df210615b5a3f23d7b38a091f7afcb06477922e9dd72647','40e206fda128138826ee642fd946025477386d16134723477af319858ce82061','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('save_supplier(text,uuid,text,text,text,text,text,text,text,boolean)','3583c0dacefc6512fb05c015102e5c238cb1b202a88b9f500fb54080ef457558','7547e04d3f050e9c55ccba7bfe0a90705e0498bcd1872b74961c345668ac3ba3','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('scan_business_summaries(timestamp with time zone)','1a414c7d7bd6c9aec63b06b669c4f5ab54f42ddc24c1eb03bf6fd39ca0a922f1','7ce9f9fa12c9dc6be6de41c4de2e1a6623a644b6cd37b80c828038bd44a362ff','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,service_role=X/postgres}'),
('scan_core_business_alerts(timestamp with time zone,integer)','2986910529d790ef9c4b45d6a03ae1f180a3f9863b8c9f25ec6efbc3666b31dc','450d6a5c0e00e9b5d3458be63f5421a2430f8a589735cb4e7f1c7a91e9dc2efd','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('scan_deferred_cheque_alerts_internal(timestamp with time zone)','db8604e5daff8d8f7f6ede4ea0b803f34573c253db7f946eb42ff27e553a37b2','712abfcce274b1cac4af595fb6871f233d4675a6d35d4cd32fb7ab1aecd0e553','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('search_admin_products(text,integer,uuid,text,uuid)','f65e720ce861b64c8430b96c0acd5bf9ebe7c3b9af751ad98dfac2c4f057a95a','8377925c954cc6a7acae045e91129b67c63ac40a1557c24f54c1cb49fd05c501','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('set_configurable_parcel_feature_state_v1(text)','5ce5e879708a1d138f725514633206cc878b672614102a2c0b929063eef5d01c','8de587ad5d5590b25bd0142cb162fdcd035614b1373452be5b9445a1ef8433bc','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('set_customer_status(uuid,text)','0c7d7df34454dea4c66c9ea93cbb41eb7edfc2a00221a6c3bae0060661ee6192','8bf8ea184156398ae6b86727cee951ec6d16567792d841f75e6acd1c404b03c3','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('set_erp_staff_account_active(uuid,boolean)','c0e0ce1733a87a3dda0e97c2e69fd7624797eaf92d6b1fa1b98e44767d4b181e','1caf7977884e65414a5552b5ca50576e113d489821302854dbd2772108e17ebf','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('set_go_live_main_branch_v1(uuid)','ad5ec9f449c9224c8bbae25346c93950c04bb2353040e56158a162a9d8f02825','d8aa5575174e912bbd040d46904e62d94890e2675fc42c1a6be7a19ef2ec82b9','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('set_product_brand_active(uuid,boolean)','657b15a4e8e5e45b55c9b5f7ec051a6d8f92bfe4b6f99c2236d5005cb18f7857','ad688d56eb68ac0d64c1b29cde972e07c700c0b54271d10010cb0828535c23dd','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('set_product_category_active(uuid,boolean)','1fe7031df6d0afa088a99b87491455d65f4489f8ad446d12872262c7eb0877cd','cf0c484dd3ac6ca6bd068427f226ea1879f254ad0a152c4b38b96ad161aa807c','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('set_product_primary_image(uuid,text)','431c1f1e5a1a55f678cf399a9babf8c7f9ce89c44034a94f2c5c37469e8c7c93','56fca51453c8683640d5c51db0e25a7d6035b0255bea617a59ee644f738ae7ae','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('set_product_unit_active(uuid,boolean)','74ada397f61c847ea278abfd4da30411e51bad547addb08c3eac31660da9ec53','d66f08e9c5a1ae03d54039a19f73d37332c6e34e0d61caeac435412cd002de87','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('set_promotion_code_active(uuid,boolean)','9ed8fc53e471fc2731e56535cd046d75be79fe33562b8ec01afd468ecbd0869b','ad37377fc0e4522cc963720ecb935bdc61a2f9aa96405bbbbeb34ed50f270b62','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('set_supplier_active(uuid,boolean)','36cde3c25af7d01ddf0bca5bb337fb21b2ddaa521e7b3e3e4ff0adb40bf41e26','adfa2af00de5307c19d16bd8a21f8613c85c9faff24d5c524a449dfe18f227e7','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('set_website_new_order_reservation_expiry()','d591cef92aeb4b1c39d316290c4859a41f6104319a64f8e263aac693fba5ab2a','02239718c638951f4452508040dd94dbb840fab0db35ca69a87da6f35452eaeb','postgres','["search_path=public, pg_temp"]'::jsonb,NULL),
('settle_admin_sales_return_v1(uuid,text,jsonb,jsonb,text,text,text,text)','85d5030a09a2e11cda38ffa0a57906c023f6539f029c688f615e7c5b54447cbf','f64ce246a2569b01efcfb4e269f9b3c931e5b1fde31c131c35bc9a5b5bae34c0','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('settle_admin_sales_return_v2(jsonb,text,text)','7e2be38dd4d7f9b3c71b3a97a15742c3817797555011c4fcccf207d10abd2512','54d0f7b9b4bbc9c4c63cfbc59c2c130d3d69e13a9966d44491bd3bff743684d8','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('settle_inspected_sales_replacement_v2(jsonb,text,text)','363f317d05f78f6abaf1bc34a5da8c199d334cb687557efd03714605edd198d4','b5a12ca04499bb3b377409fee36bea5f501ab8c663180a9fd12f0afc457eb62c','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('settle_sales_exchange_v1(jsonb,text,text)','3ea84fffd95cfdf85296fe6a96cbdf1c9824f5f206e9f501283d07cdccf5af1e','7c6baac60326fa03e6b61d6e0d150c8da13d169813d1ad66e3a8cd4370fdd08b','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('settle_sales_replacement_v1(uuid,text,jsonb,text,text)','a09bf1895e7258ee9762a7bff22ec1f9d31cf55d99bfe9b28febede00a8b39d6','0147153ec01d3ab15fa2ec0616f6e90c3a88184606f6c4b48df97e02447d5de5','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('settle_sales_return_v1(uuid,text,jsonb,text,text,text,text)','5156beb699ecf463f4701c0e85369d3821565af135443bee484f3f8e6191d2ec','ebb42d6a6757af2fc16a1756f059b020e84846e348b0626f84d1100329903955','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('settle_supplier_replacement_credit_v1(text,jsonb,text,text)','bd31c35343941d044bb033d6eff54cf94358ed2eeab40b76a22e4ea66a661629','a8cac8c0f4b5d201243434582492c24a79976a29a55a50c48d9f9d68efb56acf','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('sr208_append_event_internal(uuid,uuid,text,integer,integer,bigint,integer,text,timestamp with time zone,uuid)','644693464c9cf4d1f6c1471ffb1e0969716673070b0ed0a1c3621f684e111f76','e13191c03f1725f2da7a01bcaadb0ca64c823bd3b2a053a393d28bc22d0e884d','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('sr208_assert_operation_internal(uuid)','b0c12958e6a660500a1ff4c34c0f5ae83197b729c33efd1ac0d3d5e33a759740','a50a47d4713d619b1a3e6f82921de022741e91fed2474996caf08c07e248de59','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('sr208_assert_role_internal(text)','1676c4821cbcc25eb536aeaa7b0497d12fdb05b00e13f819372b161baadf986f','2834b47aecc3ae57e4fe3f18aa3969b25a0fb9e3cde614e79457f784ef04d89b','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('sr208_case_dto_internal(uuid,boolean)','93c2c829262c21594ff71a5d37527900c6c628b6140114d0bded2814c26e3f32','0ec7d5e6b829613e7dc045825a14723d3accae1b1b66c83fdb80444fd129c634','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('sr208_inventory_fingerprint_internal(uuid)','738639368bf21345a31d75f9e1dceceffd6b1186fa2adee15ad4e0d242ea7e94','8f6fe5055901eebac36aca1942d4295b6b7bec0c94571c57b00ff375727aa8b9','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('sr208_operation_manifest_internal(uuid)','64120375c9c2dc6c88891bf8e5f9efddd9f76df24cfd56b9299bba5731bd2391','d20732682aa84861232be1eb7db9d02c6ebb96967c6a0e4e0f42134302442f01','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('sr211_assert_operation_before211_internal(uuid)','a4079a4581ee0b61377a042c87bc0cd3aa3aafd9ac530d3d87b919f014cd5970','d2acdd7199cf45736d54e57b785401e8604718cf845ede47958c2393cb17e2aa','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('sr211_blocked_internal(text,uuid)','2132a76a7ce557940b5d1d5da5c95ac9f369ed49cb95653ac2c9736021bbca46','243488b83ed3cb77c7de21ee6245b513f7eecd25a9859fa5903fd246667e1b56','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('sr211_links_manifest_internal(uuid)','11c42615db091bded2f02ba012b251eeedbd97d7860d523a50030c4daf4fe7d3','e64ca7fe7c4c17b519c6b45455a4854c706b0fe724a20b86f82e3315a91b3843','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('sr211_source_internal(text,uuid)','e912d1d4331ef060f9d230da412daf91a709ab138eacdd51393c417c03e7a9db','1359afd902989cfd2a106a8c0f899f310fe840dec6117639284b8cf00e730613','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('start_or_update_order_delivery(uuid,integer,text,text)','659df6bae74b26d7368482621af2088bde6232b54fe10e203359f5e8aca5aeac','2713df3d5ffed9d530115aa7ffbac547799c8f8a72580b8058c5dfe126c40478','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('submit_guest_customer_order(text,text,text,text,text,text,text,text,text,text,double precision,double precision,text,jsonb,text,text,text)','b6a8591355fe773ccbd5fe121e9c80cebf1a8b8e012b735f6d09b2fa06f903a4','ea25682ee36d8b6406a76ce8619c373baa70e1f82f22bc72b9f5ecb84081baac','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,service_role=X/postgres}'),
('submit_guest_customer_order_core(text,text,text,text,text,text,text,text,text,text,double precision,double precision,text,jsonb,text)','b6922259f90d354da873c852444b0366bb1ad4a388c0f3c478062f4508cf09f8','2c7987260937f5f505ec8c5302ff7a4f2cee04e838df2f051ed2f7c76ce563fa','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('submit_guest_customer_order_v2(text,text,text,text,text,text,text,text,text,text,text,text,double precision,double precision,text,jsonb,text,text,text,bigint,bigint,bigint,bigint)','0455e497326218665a4297300b00460a5e82bb7b98305abd856b9a9cb5d8753a','ad84680d7d3a7cd58e3c39f5116f63619063342699147a4edc686d96a3fe0ff9','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,service_role=X/postgres}'),
('sync_order_delivery_tracking_timestamps()','029241959aa6f87f62cee69a8ad8af9a265d95457aeb3e00aa79ede711822c9c','e00f152b2f157cbcd9d566224f377ea85234446d00f7aafc6ee17993830b0abc','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('sync_order_payment_state()','616a07a52476ed2aeb74e83e1348b102571cdc496a21c6cee890a463b3487d21','ef378bddb7318dcb1536a88fecb901d04882ffe819b3f043f34ce012c88f499b','postgres','["search_path=public, pg_temp"]'::jsonb,NULL),
('sync_product_flavor_commercial_settings()','6a1392aa7642732d070a316454115890e2a729fd42794a67793b68162898cc5a','aa30db3bddcfa62e8b806fa3861e2062069e1349c87f883973a372133270554c','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('sync_stock_alert(uuid,uuid,integer,integer)','09198200f16e9d794c55cebef3937837f974eb8c8cd59f8e8681bbbc2fc1d85b','a6c71821c26518be874069ac77851c5746da5d2a06958f2fb8af5f86ded44349','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('sync_stock_alert_from_balance()','4cc1cc81424fd3fd35bf11f866801c454caccf463572cc0d841b54614c90a3c8','1a8dbe0a4efcf8c4b4c4d15ffbb538ec8269d39fbdde77028e20bf4b4d2533f8','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('sync_stock_alert_from_product()','fbc126b6c712771fef1081cbfbb9037c20dd8b407a81ee5c5836f9df2dbda879','9e879ff17581b314f31b8320bc5ed70f67dca2d3ab28a9cd02534386eb66f2fd','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('tb215_active_exchange_internal()','31f8119aac66e6a6682b5846cbaa3de5d4db07e332bba5554b71ed6c980c99fe','2eb3458c6b38f6eb58d98694a887d9926a335c2f22917d286714cf03ece675c5','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('tb215_append_before215_internal(uuid,uuid,text,integer,integer,bigint,integer,text,timestamp with time zone,uuid)','6feae78b3a7aa7bab914a53f5c504e595000bcf51be51a28c685e7a732510278','947d4c8c84f9296ee5601d488fd32c541f504cbd8c73e709e1ce3d57e0e232a6','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('tb215_assert_exchange_internal(uuid)','7d52687d5562bcafc44b225a3078b07fdb1e3261201c5a951b549c9cce6e614a','60f10b689b75bff3c91e7c5d95d6d34233d79edf292bc21bcf6151935ecd0059','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('tb215_assert_exchange_pos_admission_internal(uuid,uuid,uuid,text,text,jsonb,bigint,bigint,text)','041827e69d271d7fba473b0cb567bc706bdb153d8e27828d4435d7d476473556','73d5d91b3628139cbc5a84c725547fcd1cf004f6bbe2badba8632a8a7effa955','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('tb215_assert_exchange_return_admission_internal(uuid,text,jsonb,text,text,text,text)','2b02fccb29da092c70c503a9ee2df77b6f156a7a8f571317fabd9af36c09d079','89b277e4778c15c1c57326b96273bfb67a806563a0593ab4bb39621009e5b9dd','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('tb215_assert_exchange_return_event_internal(uuid)','992ebaa3fec6e61f396ad2710caa15441d60c0254216a96dfe24dd31106cb454','493dc3a3f07ccd73c8e184011bd77c18e908170f7b8247f6c6dfe9214edb1ab5','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('tb215_assert_inspection_internal(uuid)','21ed00a80e91feaac1a95d8ac778edff3b69d45e46c704c5f702e4f02e269b65','f2f4fe0dc350bd3d2f3a8e16207c65d34c36d86e6354b65d2e47df94164ca5f3','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('tb215_assert_return_allocation_internal(jsonb,jsonb)','b1d560065c0c482da0c0ec0922e13a7015539f2d582bcbfd43e8777d46faee82','c263b6e7ff8866ca5242cd20d9218e062b0de2ae36a27249de561a405f88b997','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('tb215_assert_return_internal(uuid)','fcbab2586740f9679e442bcb3830b23de2e5670521e9fd04834c0106dc3fd991','f85b935a492726d4e778b6c303f6e8b2e3f7f5683390c38449acb8f0cf39f4c2','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('tb215_assert_supplier_credit_internal(uuid)','3b274a0da20d03433d7d066d946d861aa0df4e1455903f6bf8b394ed0f70848d','66c2c9a736f33b430cd7894e987d1945509e6cf1705f25b3e229fe7124e23bdd','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('tb215_blocked_before215_internal(text,uuid)','19fd1a289d7da59c99355222a924fdfede26075e53a47001e244c0345deeb49f','44211d9a9990e1453389456cabbb64e1243c26e1cac54310d268157904d636ec','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('tb215_canonical_exchange_internal(jsonb)','b3c29f7238f360ffe040ec2bff296096ace3bc54fcc883af601fad8b39c2874c','cdb40ac284a3b297b7c2b57fe2a5f888e95038e3c4c52b8aaa7f6aab629c06ff','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('tb215_canonical_inspection_internal(jsonb)','8e696da2044477481514241d2ead97f10d477ab4f40f476704789fd94126cef9','0bad76b3f61cc0992196638e2218f84214909f1b2811aa12f0ff86c7b3d1a160','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('tb215_canonical_return_internal(jsonb)','5d8a964a71207fcbab329e52cb76cb4bf5484b43ebf9153cc0aca6862c24c742','be2d7fbd6bcc6ca51bf052b17d2e56f88a0619f898af7b828a614a8de9a968df','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('tb215_case_dto_before215_internal(uuid,boolean)','820a2bea086ac08a63e8a670c220f8f44af8b60a937c31ce4338afe4be41dafd','be3320d6102585fcf9a3e0a6f63393e835ba409928afe319d988b1e79bc72978','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('tb215_completion_before_exchange_internal(uuid)','261917df721617996bedbe79601d6bf235a19c1ebd08854d40c7c5558efed610','96ac9857da53bc21af67666121e471b898f51b5b2c21f817d8d5250309cd220f','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('tb215_credit_plan_internal(text,jsonb)','73a100cfc45a64fcc9c2ee733792bd966125d5ab45384c6b60e60588de198c61','999cbf911188ae28d0c25ff6bed2716b1a7cc9a0bc4d2c0856cbe048fdbe600f','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('tb215_damage_candidates_before215_internal(uuid)','50738881026f236eb12f79d61a3cf39f9d9be72cd64a4baff94e48dbf888e26d','12b2af09c79974978a2fd2b02bb3740b6742a1ec25741a1d7cf1aea49dfe1b21','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('tb215_damage_case_roots_internal()','5b309438e0a73b0b13941f905341af0d6e83aa66d19ff98ed3d28a2630d8feee','d0c04f0cce2b205a10532dadad5c13540f7b0e548056d12991ef5e54a9230209','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('tb215_damage_case_states_internal()','7182c6f2ad933f3f904fa5a5ca2a9b4faa36d321efc9da48c7c939b975ccb4f9','287e357d05ee75bd8b4f70e8da812195826555cf101b80ea9231a4b1481f881e','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('tb215_damage_loss_presentation_internal(jsonb,uuid,timestamp with time zone,timestamp with time zone)','d672eee4606182930de8462a4775f61dd6b612c2cd61809c870e358d8de7d7f5','4e866f82df983c7c233fdafcf06fdae91df6ab20cf1e9d34b1f55f5c9a0f419b','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('tb215_damage_movements_internal()','f318ba647b3ea0b2556433c4124903cd4a912345e6c76daa41b9484735552957','653b0c7ef2af10cf8f66652b322e3e127a9230dbd5da420ed713629320709728','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('tb215_damage_nonnegative_quantity_internal(bigint)','87b7c97095ac9b2e98f0de5b0d2df97d384101f06ccdb8936ab16f534d87d843','a3fc0681f5b955f0c511ed944f3e717b3ca157d9e7eb390578464b6475caaf8f','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('tb215_damage_roots_internal()','c25a9e2d3bb4f6bd4df32070966b3a1ccee990e2027d3c08318ca0eab8fc71b2','a13b63737e572ecd4504afdfd9f0e6f7effdff35b18ef509fb0d321d820f1cdb','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('tb215_exchange_canonical_return_internal(uuid,jsonb,text,text,text,text)','48f0d5022a32f0969c65885d50bbf7ffd96f83a38ff9c58560c429a7ad7ecd45','aaf7b574d8c569921d9ad3cd5c431d347b417587e956dc1a06a9a2f0b1bbab97','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('tb215_exchange_completion_guard_internal()','88ef452d83257c10d303f1b9e04eac62a62ed9d4c5a71ea881ef5ba804e5696f','20c2f35c80afaa6fc6b2fec88593be336da1df13a18d72286679701d9f382fa1','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('tb215_exchange_finalize_internal(uuid)','9074b22b8f57171664e0cdd27baeb3d2233d992d94561f7eeabfc7bc3f7e4604','a4201d6b69f187d80896809c62ca22a449bb318b78a5738224be8c47cc2e9014','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('tb215_exchange_financial_adjustment_internal(jsonb,uuid,timestamp with time zone,timestamp with time zone,text,boolean)','f27a447dfaef6688710000e950d91085976dad06c4cbcc922e70fab740b44a7a','3f796d61951d14398f98671d2c71634a18a41b30b274576f0fd285cec9aa0991','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('tb215_exchange_manifest_internal(uuid)','ef2ed5022819e84961b9df045e51b08cee88665afe48ba61340eaaf0dd9ee18d','c62f49dd85a925f04b3147349c82a7e3110ae458ae4af315df85af25f7405bc9','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('tb215_exchange_pos_internal(uuid,uuid,uuid,text,text,jsonb,bigint,bigint,text)','cfeedd4af139142495d7971916ad4e6a3febf0151b97f0e2f1448f241ba4a399','4f4167c682f102ace1475dacf6bf748e619c51badd63d2eb5cccd60a0a81892e','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('tb215_exchange_public_result_internal(uuid)','943c4db5554f869b52950f350d3f85cf52e5a643cd21a98487a087ed3ae49375','4f4e4be69d6222fe7b680796692d67ec8325aabb0909521778a82ac8234bcbfd','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('tb215_exchange_return_internal(uuid,text,jsonb,text,text,text,text)','4457073ee85b4c474da79a1dd8b4b40ee547bab1d4fa696706d30c62dcef2820','b396449d41074ee441ce4faf0c23086cf51e6e8c00968d38877d031a12587971','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('tb215_finalize_before_exchange_internal(uuid)','d5837adcefb3333083d5d40a85c0b54086c1c13e85f4d8b685d6495651afea04','f567740fd652d1082bc47dc7aafc0109d450cc14149da51086cb630f5f5d7abb','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('tb215_financial_facts_before215_internal(uuid,timestamp with time zone,timestamp with time zone,text,boolean)','e737a6bd12ebcd1efc96d55e4da92afdc38fbd707d56a89d21e593d5e81c510f','df303df00e15e646a163f6b939ec2da6d177330d429b486ffdf991032b9d40c2','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('tb215_guard_exchange_return_insert_internal()','c254c251b7455d6e4df44ec23aeaee431fe80fec1d2009cd5cd9b1069d7eb9e9','3737db90241ddf1247791f1e624b7ef4c01294bf8d24ff879fc86315442c4244','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('tb215_guard_funded_pos_reversal_internal()','cde504e727aaed3203c2a6f951595cdbc3dcf24516ec33f724edeb80a3b84087','f8c2f942afacfd6893b1a46d46421f2032eaee9d9502571764421e90eb4bc24a','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('tb215_guard_return_context_internal()','4952023cc4037dc11d2aa45e5ba88e45d00289073c7e2afee8c05654087f23de','49b60deb55d6463b23fa81ddbcaa4bb19c3bcd33fb35c0f71bee5dbb35b9006e','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('tb215_hold_return_subset_internal(uuid,jsonb,text,text)','29efa331a62c8a02e2f10f9ecac5738c36c2fd7ebaa5e285480cf4c842e1437a','fdf886ff5f1d2036c58c381d91a0ea54d3a6f94111051cb5104846c915c692ba','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('tb215_inspection_manifest_internal(uuid)','9b34eb47875cc1cc6e16f0e270a77c66663b83ff479e692072f9298e91b8ffba','e1c1065241e208279b70a8b65bb68d2b3bd11fa4a38227bc4c945f5ecc86b1d5','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('tb215_inspection_public_result_internal(uuid)','8977ab93c685b5ae31452c4515fabbbff04df68afe5bc3bf17feadaf49f35aaa','eef7586392ed5c66cbfd852881b0e47c42f5e085738409e14b6c4f93486d53f5','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('tb215_prepare_exchange_internal(jsonb)','e44c4acfa963e80ec8da566f6541248b61180e2e93ca008c09942632a9d61e20','1ec0a91a448298a1fa86badd1fc1ba0ddb8a300b855335f5040be08f25084cc6','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('tb215_prepare_inspection_internal(jsonb)','70811d72bffd26efc983b551c612867e675fb32c1646f793376ce16ab1ab36db','4dec44a0c6d45378374d79b1f6d5bd6bc96111d16723ee7f591aa127aace2131','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('tb215_prepare_return_internal(jsonb)','c19780c53166a9b0090e1f32c8a1a373fcdd666d3fd4f99b1820da6cf3923df5','53299dd821272c07fdb0a7b931ff8b4dcdfa99205339bd9b2101fd13fbbeb352','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('tb215_read_sale_internal(uuid)','8353997612004e8853a357b64dd0860ff22f7759e2a88058fcc08e4afe2536c0','966b74f41485ecfddbf6cf739e814775eb141870c8edc7bc1e18f4a7d6c303c3','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('tb215_return_allocation_before215_internal(jsonb,jsonb)','1814affc9f8c244ca672831f30d3e25923d8b137b52b26ec767e4e9920ed8f3e','1dd08dd704f311f5f4469930ddff4978e5bf71fc89c5cbc62391b37a89b117b3','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('tb215_return_manifest_internal(uuid)','46ce199e8423663272bef18802a268dc928fb95150c571b6f495ddf3c9057a17','04e3e631364f4a76cb4546a174cd65c534317239aece3fbc7237c47c749bb730','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('tb215_return_public_result_internal(uuid)','6a9f16de84bf05e166a7834aaac1d03bfeb7e70e9ff1ab9abc5bdd207c22080b','9c78c5ec1f9f59b8ad685fef4a7fc8665fc2454241995d62e67176c714a92433','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('tb215_return_source_cost_internal(uuid,jsonb)','1cdb16403cdfd2622262130801144122c3ed722c7d7b057c0203b581d8cb41d0','019527939c3ea909781d723175e981941f3be5ac0bf1206b5de3242a3e2aa14b','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('tb215_shift_before_exchange_internal(uuid)','6860996ec2d5c11e676cb9050e0b978d8fb48d4a5e7c6270002eea410cebdc00','4b24923a36d6f9945a5001350b868a8b7b31738fc9eaba3cda443e70506176cc','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('tb215_source_before215_internal(text,uuid)','4dc8d45589880f8e6544b7228e1478c1a3d85645a58dc57b4adc8eabc2aa6d30','ccae03f7159103a797d766351a001282a8908b41af5dba7f3c799395f9b21f8a','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('tb215_supplier_balance_before215_internal()','f47d870ddb5b20d6654dfc2d779e050070eba29ab0b6777913f6f7cd1bc9ae8c','7592d9b548a93a5abd037e4fa86cbd1ba423d3496a8bd1947897454a02d5f157','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('tb215_supplier_evidence_before215_internal(uuid)','60c8d5ab141dbae4414e51074d742ed80fa184e629902298f569155ef12ee394','fe3714bdc0dcea1e101cd00bf26a6a30c1d648cc79ce2494ba2b0eee60938c7b','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('tb215_supplier_membership_internal(uuid)','46e5da7c1017c41dfaf57b1b03050ddee0e50e9ff4faafe829eeb019d81fc9b4','4dd55536a0665da5342f08d6a56c45af2f2ba1b3810c26f95d206df1853f140c','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('tb215_supplier_writer_before215_internal(text,jsonb,text)','4b1b91f84ab68e4d24ee2a8dd66081a893d73887e01938580dc7d3695dd7b534','a579dcdd61f5e6107f9f297e9f0aa263b305d2b0a2132fcec9bd74968a41a090','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('tb215_warranty_damage_facts_internal()','2ce228e7d713d5e9633bcd1d5e2fa7912c839fc755c2f88ab2e88ac5e22f782a','2b0d210417cdfb26283bb00401eed8a00d8ee60f360feaf524d22d5b5feda046','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('tc216_create_pos_sale_v2_internal(uuid,uuid,uuid,text,text,jsonb,bigint,bigint,text)','b8a24cdc7ba0dff956170c585ce3c6ea11724905955ede22f7dfcf369a13b858','8447d0d584edf7fd765a2dd761f5752d6fb2cfa22d4949c634b5749e36f7e310','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('tc216_get_public_pos_receipt_internal(uuid)','5ae1e79e2c17d4f8e0ff3e2d05f219cd60f9e59ac0507b7384f56b38a79b981e','056f6ac21b8de54654b4277394ef82e9a8d429398749059c5b5454c74ffaa0a2','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('tc216_reject_initial_payment_mutation_internal()','39d822c7228420a34d868c43c7d26146386bb31875ddc49fead55a749dd72d43','00b541a25520bc45a932f1de6c027b49da33e55b384772378c2797d51a9125af','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('track_guest_order(text,text)','d2b1915e40bcbed482904abc57d2a04391670d27b79e40ef8159276da3615a40','653cc758f0ed0a45c2223ceb855c43a0c732775795060fcf131599fb62707451','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres}'),
('track_guest_order_by_token(text)','8fd20ce17eef92e4fbb322f0e75926b255eefd57f76e3a683abe329ce4ee7406','597302bd3a0f8d74f537ec15fa277667df6867984e8aaf61c24a8c7c76ff31c7','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres}'),
('transfer_inventory_between_warehouses(uuid,uuid,uuid,integer,text,timestamp with time zone)','4ec6b53152098b1aceb686bea78f4ba7e43e61602f76c00299767fc7c78d0ff7','5974f1ef76bada533f8b2faac75e2294311c64c50db96637ee0af4e8a466d25b','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('trial212_cash_metadata_internal(text,uuid)','80b537f3e29e9e5d6c07be84c96c027a119eeb5950fe19b074391bd0a4bac1a3','71a2946a2aaf2a0acb5107140e9f3f1cf07950d779798d25eef06f35f7005636','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('update_erp_staff_account_record(uuid,text,text,text,uuid,text)','8cbe88f442698d0c08824e7aae4ad75efd89234688c233f2663f01c911191af7','b74ec45468aad36952391ca4436d5df932ee2fcfce036a24217db64ffd8d405d','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('update_my_erp_profile(text,text,text)','815038200657618cf84391d702872e2784c56b2e4dc25d6c32e649aacf1747fc','28b445f327026312d2d86567e65144ef8ba2a8fbc745581026034dd36d49a0ef','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('update_order_delivery_address(uuid,text,text,text,text,text,text,text,text,double precision,double precision,text,boolean)','d61db61ced35f217c42288dd74af50db768eccf8e1da947b008aaff6264733a7','70080516695ece5035884dba162b4fc2bec9ae4845a69abd317fa0634ffd7d50','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('update_order_status(uuid,text,text)','66b3a2d58defb3305973c08b8dced26b27d4417e312f21f1b4ddc47ea90b9a1a','06d91b63cd8f69202c821d89ab42c0070cdeb3d5cd002a4c2a2813682deac678','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('update_product_flavor_v1(uuid,text,text,text,boolean)','fc64b164a3308735f70d9ef7c02415c8b668f1846dde93f4b3aac3b5e8a478f4','ed7f92228e2d406483b1593e697a78fade86b53fb27d55f5bbbe50271a4500d2','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('update_product_flavor_v2(uuid,timestamp with time zone,text,text,text,boolean)','453796818f1e1e13e3221510f4d73d803a42bc92f9404ecdb57c4f2b478b50c4','1ed87cd60c79ff60ab75e4b99afb8c01956c4d1e3f000248f5204c7b0bf65bc6','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('update_product_master(uuid,text,text,text,text,uuid,uuid,uuid,uuid,integer,bigint,bigint,bigint,integer,integer,boolean,text)','c7dee424db3a3de3e30cba1579af4b533ffe04c1e95f33e3e257ae1d304fe8e8','bbd24aef65e24a1cd204b6cac13ddc5c0f1fbad4d557d78ade8347cf7df3304d','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('update_product_master_v2(uuid,text,text,text,text,uuid,uuid,uuid,uuid,integer,bigint,bigint,bigint,bigint,integer,integer,boolean,text)','5cb36ffffda9d11a0530af1c0caf2459c4297b266c92630da0c7ccfaa0fb2e29','dea2c8a40bd6a136ed28ce328a9a6d77bde33780b1a8cf3940c457f826f464b1','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('update_product_master_v3(uuid,text,text,text,text,uuid,uuid,uuid,uuid,integer,bigint,uuid,integer,bigint,bigint,integer,integer,boolean,text)','e82de71ca34ae776cbd199660f7e67f2b069ba746c4c978d110f3429108d25e1','d62a68f4a8413b2b180dd345ebd9f5486cf0d6ba66b873f26235bdeaa5b6cceb','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('update_product_master_v4(uuid,timestamp with time zone,text,text,text,text,uuid,uuid,uuid,uuid,integer,bigint,uuid,integer,bigint,bigint,integer,integer,boolean,text)','67a0f54e9017258e0b1bc73a296d1ba306874a2b3d6d7dfd1539fab402081df8','a1717a1a9b9d490b199eee85869f0832d58455f6fe84a0846ed4cca6293a916b','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('update_product_master_v5(uuid,timestamp with time zone,text,text,text,text,uuid,uuid,uuid,uuid,integer,bigint,uuid,integer,bigint,bigint,integer,integer,boolean,text,boolean)','b6c014849f6bd33a9b3675ff48b62fcb2c345b4a82d6ef2fb91955f6f8d8e811','81f843d10a62af139fcf1ba146858b993066460f8b5192a76d84df5159eba43b','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('update_purchase_order(uuid,uuid,uuid,uuid,timestamp with time zone,bigint,bigint,text,text,text,jsonb)','6835db30c65cb76571fd6bc95a499e7d247af5e0899ed308107e5a9c953bf3ae','1ff3d940e6f79a881a81b3da5225145d47cd0002ed83a991af459bcbae0e4407','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('update_purchase_order_status(uuid,text,text)','b7f7f93d7cf0d6e141833dcd449ce23d1acce0540c4a078389b483802bb6f43f','575ace19fe2d6fc4bf62a0359043c5d8b370db1bb6432fd39a4980df7e09cc6b','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('update_updated_at_column()','c10d3ecdb68d176c4ef7b01c3a1e54694ef57ab9c5da8db855e50997e3dfff31','f69d9dd30b32ff07c706e362229b68f7329064286569e841db54f5608ce6e7f3','postgres','["search_path=public"]'::jsonb,'{postgres=X/postgres}'),
('upsert_promotion_code(text,text,bigint,uuid,text,bigint,bigint,timestamp with time zone,timestamp with time zone,integer,integer,boolean,boolean)','3e14743e1edec986112042af54771c921e31da66596010d7838948c3465ee46e','23416cd9350a5c87ad1b7e6adb762d81f4f1f36d9d7ad67a1ec77ec18418966c','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('validate_customer_address_map_url()','e123aaf49a679986883946364e9281e5b743a0e016153068fe99c4637baf4432','682d5644b9ba4bb749bf82568279a9fe450afe88f4e862596d62f6951e5762d8','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('validate_inventory_movement_source_chain()','dff8781c1c88d507f18e9185610c0de39f148a90b81720aed9802c45e6b8a709','04bc75affc1ceaefbfca50e3f248aff0dac546a08b62bbe746d9ae3d919cd5a7','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('validate_order_inventory_reservation_chain()','cc3709c715347c0e90da36c887a4e169d8ec68b2716cffff4e6f4c0ca56dba74','e9b2d772a9b04be597ac8f1496d90db49922b3c98a89782724ef068c3c4b26f8','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('validate_order_parcel_component_family()','eba9241144588a2534994df23d7a847e93cc121443d4d88bce810b5116ea57dd','2ba769794462415449af00335e503fa71d5970282756c08b8e596181c3bc5d18','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('validate_order_parcel_instance_family()','ec166d06b92811aef9e1f96a727a1c6d9265d4806fd2e34066658a1bac2bb98f','7f2be369851af6ea905b8dc8d31448c7fe2444219e8ff65eaee671b0f4237493','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('validate_phase2_inventory_movement_source()','06fdeb01285f07b9312f981086dae8a707ac636238e0b9caa3be809e777beb94','9de89a57576b2df7c1da429c61d2333ef8549f568e5778a78fcd0046a1caf231','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('validate_product_parcel_configuration()','572984ff18abbb923f4fb835289dd6a7550886921a1395822c810dd320b24c4a','cfc590708513c292b32059a57cac56bb2f33e308a70731f8af71acf8b46c44d0','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('validate_purchase_order_component_family_v2()','b412fa9ae152b20bba1406c35ec7514333a5a74b0e8a1f7f17032b5ea370f372','c9c6577d64a045f4e95dd38460de402cae8d107948980037c62bc8b654abf252','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('validate_purchase_receipt_item_family_v2()','88aae725de38f4c0879cba69e85898547c87b7e8f85ed5ba6424718c125e5ed3','5845fc9a6f0e4c20bce090ceb6c7160542548a31989a7e29f4d6ce07bf83d51a','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('validate_sales_return_item_line_kind()','1ac71ad2059663f4df17c9e1bb218e6588a1a9f5e2f9fd342301cb19cda2956e','d931e5778c395622152e58365f2b381bb2bcd67dbf82197c03cc3893b9ba3804','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('validate_supplier_receipt_item_commercial_family()','83f006c212cd9b4cd95de9e635a16ee1466072abc981ff45b1fd6cab51ae1dc7','2924086f5d13101b412c091f05de8ab8974fbb778727505f52c363d3f84100ec','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}')),
 frankfurt_acl(signature,acl) AS(VALUES
 ('enforce_customer_for_debt_order()','{=X/postgres,postgres=X/postgres}'),
 ('guard_cash_shift_closing_report_snapshot()','{=X/postgres,postgres=X/postgres}'),
 ('set_website_new_order_reservation_expiry()','{=X/postgres,postgres=X/postgres}'),
 ('sync_order_payment_state()','{=X/postgres,postgres=X/postgres}'))
 SELECT count(*) FILTER(WHERE p.oid IS NULL OR encode(pg_catalog.sha256(convert_to(p.prosrc,'UTF8')),'hex') IS DISTINCT FROM e.source_hash
 OR encode(pg_catalog.sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex') IS DISTINCT FROM e.definition_hash
 OR p.proowner::regrole::text IS DISTINCT FROM e.owner_name OR to_jsonb(p.proconfig) IS DISTINCT FROM NULLIF(e.config,'null'::jsonb)
 OR (p.proacl::text IS DISTINCT FROM e.acl AND p.proacl::text IS DISTINCT FROM COALESCE(f.acl,e.acl))),
 count(*) FILTER(WHERE f.signature IS NOT NULL AND p.proacl::text=f.acl)
 INTO mismatches,frankfurt_matches FROM expected e LEFT JOIN pg_proc p ON p.oid=to_regprocedure('public.'||e.signature)
 LEFT JOIN frankfurt_acl f ON f.signature=e.signature;
 IF mismatches<>0 OR frankfurt_matches NOT IN (0,4)
 THEN RAISE EXCEPTION 'LITE220_FROZEN_BEFORE_MISMATCH:% (Frankfurt ACL matches:%)',mismatches,frankfurt_matches;END IF;
 PERFORM pg_catalog.set_config('nawasrah.frozen220_acl_count',frankfurt_matches::text,true);
 END $frozen220_before$;

-- QUARANTINED PHASE-1 EXPERIMENT. Not a migration, deployment or owner tool.
-- Applied only by run-sales-only-phase1.mjs to its owned, networkless DB219.
-- Local prototype admission replaced by the exact219/636 migration guard above.

CREATE SCHEMA sales_lite1;
REVOKE ALL ON SCHEMA sales_lite1 FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE sales_lite1.mode(id BOOLEAN PRIMARY KEY DEFAULT true CHECK(id),full_accounting BOOLEAN NOT NULL DEFAULT true);
INSERT INTO sales_lite1.mode VALUES(true,true);
CREATE TABLE sales_lite1.availability(product_id UUID PRIMARY KEY REFERENCES public.products(id),available BOOLEAN NOT NULL,revision INTEGER NOT NULL CHECK(revision>0),changed_by UUID NOT NULL REFERENCES public.profiles(id));
CREATE TABLE sales_lite1.requests(key TEXT PRIMARY KEY CHECK(length(key) BETWEEN 8 AND 128),kind TEXT NOT NULL,fingerprint TEXT NOT NULL,actor UUID,result JSONB);
CREATE TABLE sales_lite1.orders(order_id UUID PRIMARY KEY REFERENCES public.orders(id) DEFERRABLE INITIALLY DEFERRED,operation_id UUID NOT NULL UNIQUE REFERENCES public.business_operations(id),recipient JSONB NOT NULL,unavailable_confirmed UUID[] NOT NULL DEFAULT '{}');
CREATE TABLE sales_lite1.completions(order_id UUID PRIMARY KEY REFERENCES sales_lite1.orders(order_id),completed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp());
CREATE TABLE sales_lite1.shifts(shift_id UUID PRIMARY KEY REFERENCES public.cash_shifts(id));
CREATE TABLE sales_lite1.returns(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),order_id UUID NOT NULL REFERENCES public.orders(id),item_id UUID NOT NULL REFERENCES public.order_items(id),quantity INTEGER NOT NULL CHECK(quantity>0),entitlement BIGINT NOT NULL CHECK(entitlement>0),debt_reduction BIGINT NOT NULL CHECK(debt_reduction>=0),money_refund BIGINT NOT NULL CHECK(money_refund>=0),method TEXT NOT NULL CHECK(method IN('cash','cliq')),shift_id UUID NOT NULL REFERENCES public.cash_shifts(id),key TEXT NOT NULL UNIQUE REFERENCES sales_lite1.requests(key),created_by UUID NOT NULL REFERENCES public.profiles(id),created_at TIMESTAMPTZ NOT NULL DEFAULT now(),CHECK(entitlement=debt_reduction+money_refund));
DO $$ DECLARE t TEXT;BEGIN
 FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='sales_lite1' LOOP
  EXECUTE format('ALTER TABLE sales_lite1.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON TABLE sales_lite1.%I FROM PUBLIC,anon,authenticated,service_role',t);
 END LOOP;
END $$;

CREATE FUNCTION sales_lite1.enabled() RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$ SELECT NOT full_accounting FROM sales_lite1.mode WHERE id $$;
CREATE FUNCTION sales_lite1.lock_mode() RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$ BEGIN
 PERFORM 1 FROM sales_lite1.mode WHERE id FOR SHARE;IF NOT FOUND THEN RAISE EXCEPTION 'LITE1_MODE_MISSING';END IF;
END $$;
CREATE FUNCTION sales_lite1.is_order(p_order UUID) RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM sales_lite1.orders l JOIN public.orders o ON o.id=l.order_id AND o.operation_id=l.operation_id JOIN public.business_operations b ON b.id=l.operation_id WHERE l.order_id=p_order AND b.operation_type IN('lite1_pos','lite1_guest'));
$$;
CREATE FUNCTION sales_lite1.available(p_product UUID) RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT p.is_active AND COALESCE(a.available,true) AND COALESCE(f.is_active,true) AND COALESCE(fa.available,true)
 FROM public.products p LEFT JOIN sales_lite1.availability a ON a.product_id=p.id
 LEFT JOIN public.products f ON f.id=p.flavor_master_product_id LEFT JOIN sales_lite1.availability fa ON fa.product_id=f.id WHERE p.id=p_product;
$$;
CREATE FUNCTION sales_lite1.owner() RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$ BEGIN
 PERFORM public.assert_erp_role(ARRAY['owner'],'نموذج البيع دون تتبع المخزون');
END $$;
CREATE FUNCTION sales_lite1.lock_request(p_key TEXT,p_kind TEXT,p_request JSONB) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE h TEXT; r sales_lite1.requests; BEGIN
 IF p_key IS NULL OR length(p_key) NOT BETWEEN 8 AND 128 THEN RAISE EXCEPTION 'LITE1_KEY_INVALID';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_key,0));
 h:=encode(extensions.digest(convert_to(p_request::TEXT,'UTF8'),'sha256'),'hex');
 SELECT * INTO r FROM sales_lite1.requests WHERE key=p_key;
 IF FOUND THEN
  IF r.kind<>p_kind OR r.fingerprint<>h OR r.actor IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'LITE1_IDEMPOTENCY_CONFLICT';END IF;
  IF r.result IS NULL THEN RAISE EXCEPTION 'LITE1_INCOMPLETE_REQUEST';END IF;
  RETURN r.result;
 END IF;
 IF EXISTS(SELECT 1 FROM public.business_operations WHERE idempotency_key=p_key) OR EXISTS(SELECT 1 FROM public.orders WHERE idempotency_key=p_key) THEN RAISE EXCEPTION 'LITE1_IDEMPOTENCY_CONFLICT';END IF;
 -- Same mode row lock for every lite mutation; changing mode serializes with it.
 PERFORM 1 FROM sales_lite1.mode WHERE id AND NOT full_accounting FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'LITE1_MODE_DISABLED';END IF;
 INSERT INTO sales_lite1.requests VALUES(p_key,p_kind,h,auth.uid(),NULL);
 RETURN NULL;
END $$;
CREATE FUNCTION sales_lite1.finish(p_key TEXT,p_result JSONB) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$ BEGIN
 UPDATE sales_lite1.requests SET result=p_result WHERE key=p_key AND result IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'LITE1_REQUEST_NOT_OPEN';END IF;RETURN p_result;
END $$;
CREATE FUNCTION sales_lite1.immutable() RETURNS TRIGGER LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN RAISE EXCEPTION 'LITE1_IMMUTABLE_EVIDENCE';END $$;
CREATE FUNCTION sales_lite1.seal_request() RETURNS TRIGGER LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
 IF TG_OP<>'UPDATE' THEN RAISE EXCEPTION 'LITE1_IMMUTABLE_EVIDENCE';END IF;
 IF OLD.result IS NOT NULL OR NEW.result IS NULL OR (to_jsonb(OLD)-'result') IS DISTINCT FROM(to_jsonb(NEW)-'result') THEN RAISE EXCEPTION 'LITE1_IMMUTABLE_EVIDENCE';END IF;RETURN NEW;
END $$;
DO $$ DECLARE t TEXT;BEGIN
 FOREACH t IN ARRAY ARRAY['orders','shifts','returns','completions'] LOOP
  EXECUTE format('CREATE TRIGGER lite1_immutable BEFORE UPDATE OR DELETE ON sales_lite1.%I FOR EACH ROW EXECUTE FUNCTION sales_lite1.immutable()',t);
  EXECUTE format('CREATE TRIGGER lite1_no_truncate BEFORE TRUNCATE ON sales_lite1.%I FOR EACH STATEMENT EXECUTE FUNCTION sales_lite1.immutable()',t);
 END LOOP;
END $$;
CREATE TRIGGER lite1_seal BEFORE UPDATE OR DELETE ON sales_lite1.requests FOR EACH ROW EXECUTE FUNCTION sales_lite1.seal_request();
CREATE TRIGGER lite1_no_truncate BEFORE TRUNCATE ON sales_lite1.requests FOR EACH STATEMENT EXECUTE FUNCTION sales_lite1.immutable();

CREATE FUNCTION public.lite1_set_mode(p_full BOOLEAN) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$ BEGIN
 PERFORM sales_lite1.owner();
 BEGIN PERFORM 1 FROM sales_lite1.mode WHERE id FOR UPDATE NOWAIT;
 EXCEPTION WHEN lock_not_available THEN RAISE EXCEPTION 'LITE1_MODE_BUSY';END;
 IF p_full IS NULL THEN RAISE EXCEPTION 'LITE1_MODE_INVALID';END IF;
 IF EXISTS(SELECT 1 FROM public.cash_shifts WHERE status='open') OR EXISTS(SELECT 1 FROM public.orders WHERE status NOT IN('completed','cancelled','expired','returned')) THEN RAISE EXCEPTION 'LITE1_MODE_REQUIRES_QUIESCENCE';END IF;
 -- Activation is NOT implemented by this prototype. An opening epoch needs phase2.
 IF p_full AND sales_lite1.enabled() THEN RAISE EXCEPTION 'LITE1_ACTIVATION_REQUIRES_PHASE2';END IF;
 UPDATE sales_lite1.mode SET full_accounting=p_full WHERE id;
 INSERT INTO public.audit_logs(user_id,action,entity_name,details) VALUES(auth.uid(),'LITE1_MODE','prototype',jsonb_build_object('fullAccounting',p_full));
 RETURN jsonb_build_object('fullAccounting',p_full);
END $$;
CREATE FUNCTION public.lite1_set_available(p_product UUID,p_available BOOLEAN,p_revision INTEGER) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE rev INTEGER;BEGIN
 PERFORM sales_lite1.owner();PERFORM 1 FROM sales_lite1.mode WHERE id FOR SHARE;
 PERFORM 1 FROM public.products WHERE id=p_product FOR UPDATE;IF NOT FOUND OR p_available IS NULL THEN RAISE EXCEPTION 'LITE1_PRODUCT_INVALID';END IF;
 SELECT revision INTO rev FROM sales_lite1.availability WHERE product_id=p_product;
 IF COALESCE(rev,0) IS DISTINCT FROM p_revision THEN RAISE EXCEPTION 'LITE1_AVAILABILITY_STALE';END IF;
 INSERT INTO sales_lite1.availability VALUES(p_product,p_available,COALESCE(rev,0)+1,auth.uid()) ON CONFLICT(product_id) DO UPDATE SET available=EXCLUDED.available,revision=EXCLUDED.revision,changed_by=EXCLUDED.changed_by;
 INSERT INTO public.audit_logs(user_id,action,entity_name,entity_id,details) VALUES(auth.uid(),'LITE1_AVAILABILITY','products',p_product,jsonb_build_object('available',p_available,'revision',COALESCE(rev,0)+1));
 RETURN jsonb_build_object('available',p_available,'revision',COALESCE(rev,0)+1);
END $$;

-- New admission triggers, not changes to any frozen writer. The order context is
-- private and is inserted before the order, with a deferred foreign key.
CREATE FUNCTION sales_lite1.guard_order() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$ BEGIN
 PERFORM sales_lite1.lock_mode();
 IF sales_lite1.enabled() AND NOT EXISTS(SELECT 1 FROM sales_lite1.orders l JOIN public.business_operations b ON b.id=l.operation_id WHERE l.order_id=NEW.id AND l.operation_id=NEW.operation_id AND b.operation_type IN('lite1_pos','lite1_guest')) THEN RAISE EXCEPTION 'LITE1_FROZEN_WRITER_DISABLED';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER lite1_mode_admission BEFORE INSERT ON public.orders FOR EACH ROW EXECUTE FUNCTION sales_lite1.guard_order();
CREATE FUNCTION sales_lite1.guard_inventory() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$ BEGIN
 PERFORM sales_lite1.lock_mode();
 IF sales_lite1.enabled() THEN
  IF TG_TABLE_NAME='inventory_balances' THEN
   IF TG_OP='INSERT' AND NEW.on_hand_quantity=0 AND NEW.reserved_quantity=0 THEN RETURN NEW;END IF;
   IF TG_OP='UPDATE' AND NEW.on_hand_quantity=OLD.on_hand_quantity AND NEW.reserved_quantity=OLD.reserved_quantity THEN RETURN NEW;END IF;
  END IF;
  RAISE EXCEPTION 'LITE1_INVENTORY_DISABLED';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD;ELSE RETURN NEW;END IF;
END $$;
CREATE TRIGGER lite1_no_inventory BEFORE INSERT OR UPDATE OR DELETE ON public.inventory_movements FOR EACH ROW EXECUTE FUNCTION sales_lite1.guard_inventory();
CREATE TRIGGER lite1_no_reservations BEFORE INSERT OR UPDATE OR DELETE ON public.order_inventory_reservations FOR EACH ROW EXECUTE FUNCTION sales_lite1.guard_inventory();
CREATE TRIGGER lite1_no_balance_changes BEFORE INSERT OR UPDATE OR DELETE ON public.inventory_balances FOR EACH ROW EXECUTE FUNCTION sales_lite1.guard_inventory();
CREATE FUNCTION sales_lite1.guard_cost() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$ BEGIN
 PERFORM sales_lite1.lock_mode();
 IF sales_lite1.enabled() AND (NEW.cost_price_in_minor_units IS DISTINCT FROM OLD.cost_price_in_minor_units OR NEW.wac_cost_in_minor_units_exact IS DISTINCT FROM OLD.wac_cost_in_minor_units_exact) THEN RAISE EXCEPTION 'LITE1_COST_DISABLED';END IF;RETURN NEW;
END $$;
CREATE TRIGGER lite1_no_cost_changes BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION sales_lite1.guard_cost();
CREATE FUNCTION sales_lite1.mark_shift() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$ BEGIN
 PERFORM sales_lite1.lock_mode();
 IF sales_lite1.enabled() THEN INSERT INTO sales_lite1.shifts VALUES(NEW.id);END IF;RETURN NEW;
END $$;
CREATE TRIGGER lite1_mark_shift AFTER INSERT ON public.cash_shifts FOR EACH ROW EXECUTE FUNCTION sales_lite1.mark_shift();

-- Phase1 deliberately supports base units/flavors only. No invented parcel,
-- discount, delivery fee or credit policy: the missing parallel planners are
-- explicit phase2 work, and unsupported input fails closed.
CREATE FUNCTION sales_lite1.sale(p_request JSONB,p_key TEXT,p_guest BOOLEAN) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE result JSONB; line JSONB; p public.products; customer public.customers;settings public.storefront_settings; c UUID; oid UUID:=gen_random_uuid();op UUID:=gen_random_uuid();bid UUID;wid UUID;sid UUID;method TEXT;initial TEXT;paid BIGINT;total BIGINT:=0;qty INTEGER;price BIGINT;unavailable UUID[]:='{}';v_phone TEXT;amount BIGINT;plan JSONB:='[]';name TEXT;BEGIN
 IF p_guest THEN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'LITE1_GATEWAY_ONLY';END IF;
 ELSE PERFORM sales_lite1.owner();END IF;
 result:=sales_lite1.lock_request(p_key,CASE WHEN p_guest THEN 'guest' ELSE 'pos' END,p_request);IF result IS NOT NULL THEN RETURN result;END IF;
 IF jsonb_typeof(p_request) IS DISTINCT FROM 'object' OR octet_length(p_request::TEXT)>32768 OR (p_request-ARRAY['branchId','warehouseId','customerId','lines','method','paid','initialMethod','unavailableConfirmed','recipient'])<>'{}'::JSONB THEN RAISE EXCEPTION 'LITE1_REQUEST_INVALID';END IF;
 bid:=(p_request->>'branchId')::UUID;wid:=(p_request->>'warehouseId')::UUID;
 IF NOT EXISTS(SELECT 1 FROM public.branches WHERE id=bid AND is_active) OR NOT EXISTS(SELECT 1 FROM public.warehouses WHERE id=wid AND branch_id=bid AND is_active) THEN RAISE EXCEPTION 'LITE1_BRANCH_INVALID';END IF;
 IF jsonb_typeof(p_request->'lines') IS DISTINCT FROM 'array' OR jsonb_array_length(p_request->'lines') NOT BETWEEN 1 AND 30 THEN RAISE EXCEPTION 'LITE1_LINES_INVALID';END IF;
 -- Product/parent locks serialize availability changes with the entire sale.
 PERFORM 1 FROM public.products WHERE id IN(SELECT (l->>'productId')::UUID FROM jsonb_array_elements(p_request->'lines') l UNION SELECT flavor_master_product_id FROM public.products WHERE id IN(SELECT (l->>'productId')::UUID FROM jsonb_array_elements(p_request->'lines') l)) ORDER BY id FOR UPDATE;
 IF p_guest THEN
  SELECT * INTO settings FROM public.storefront_settings WHERE orders_enabled FOR SHARE;IF NOT FOUND THEN RAISE EXCEPTION 'LITE1_STORE_CLOSED';END IF;
  IF settings.inside_ramtha_delivery_fee_in_minor_units<>0 OR settings.outside_ramtha_delivery_fee_in_minor_units<>0 THEN RAISE EXCEPTION 'LITE1_PAID_DELIVERY_REQUIRES_PHASE2';END IF;
  IF p_request ? 'customerId' OR COALESCE(p_request->>'method','cash')<>'cash' OR p_request ? 'paid' OR p_request ? 'initialMethod' OR p_request ? 'unavailableConfirmed' THEN RAISE EXCEPTION 'LITE1_GUEST_INPUT_INVALID';END IF;
  name:=btrim(p_request#>>'{recipient,name}');v_phone:=public.normalize_customer_phone(p_request#>>'{recipient,phone}');
  IF name IS NULL OR length(name) NOT BETWEEN 2 AND 120 OR v_phone IS NULL OR v_phone!~'^[0-9]{9,15}$' OR length(btrim(COALESCE(p_request#>>'{recipient,address}',''))) NOT BETWEEN 2 AND 500 THEN RAISE EXCEPTION 'LITE1_RECIPIENT_INVALID';END IF;
  PERFORM pg_advisory_xact_lock(hashtext(v_phone)::BIGINT);
  -- Qualified comparison is intentional: never overwrite an existing card.
  SELECT * INTO customer FROM public.customers x WHERE public.normalize_customer_phone(x.phone)=v_phone AND NOT x.is_deleted ORDER BY id LIMIT 1 FOR UPDATE;
  IF FOUND THEN IF customer.is_blocked OR NOT customer.is_active THEN RAISE EXCEPTION 'LITE1_CUSTOMER_BLOCKED';END IF;c:=customer.id;
  ELSE INSERT INTO public.customers(full_name,phone) VALUES(name,v_phone) RETURNING id INTO c;END IF;
  method:='cash_on_delivery';paid:=0;
 ELSE
  c:=NULLIF(p_request->>'customerId','')::UUID;method:=p_request->>'method';paid:=COALESCE((p_request->>'paid')::BIGINT,0);initial:=p_request->>'initialMethod';
  SELECT id INTO sid FROM public.cash_shifts WHERE branch_id=bid AND status='open' FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'LITE1_SHIFT_REQUIRED';END IF;
  IF c IS NOT NULL THEN SELECT * INTO customer FROM public.customers WHERE id=c AND is_active AND NOT is_deleted AND NOT is_blocked FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'LITE1_CUSTOMER_INVALID';END IF;name:=customer.full_name;END IF;
  IF method IS NULL OR method NOT IN('cash','cliq','debt','partial') THEN RAISE EXCEPTION 'LITE1_METHOD_INVALID';END IF;
 END IF;
 FOR line IN SELECT value FROM jsonb_array_elements(p_request->'lines') LOOP
  IF (line-ARRAY['productId','quantity'])<>'{}'::JSONB OR COALESCE(line->>'quantity','')!~'^[1-9][0-9]{0,3}$' THEN RAISE EXCEPTION 'LITE1_LINE_INVALID';END IF;
  SELECT * INTO p FROM public.products WHERE id=(line->>'productId')::UUID;
  IF NOT FOUND OR NOT p.is_active OR p.is_flavor_master OR p.parcel_only THEN RAISE EXCEPTION 'LITE1_UNSUPPORTED_PRODUCT';END IF;
  IF EXISTS(SELECT 1 FROM public.products f WHERE f.id=p.flavor_master_product_id AND NOT f.is_active) THEN RAISE EXCEPTION 'LITE1_INACTIVE_PARENT';END IF;
  IF NOT sales_lite1.available(p.id) THEN
   IF p_guest OR NOT COALESCE(p_request->'unavailableConfirmed' @> to_jsonb(ARRAY[p.id]),false) THEN RAISE EXCEPTION 'LITE1_UNAVAILABLE_CONFIRM_REQUIRED';END IF;
   unavailable:=array_append(unavailable,p.id);
  END IF;
  qty:=(line->>'quantity')::INTEGER;price:=p.sale_price_in_minor_units;
  IF price IS NULL OR price<=0 THEN RAISE EXCEPTION 'LITE1_PRICE_REQUIRED';END IF;
  amount:=qty::BIGINT*price;total:=total+amount;
  IF total>1000000000 THEN RAISE EXCEPTION 'LITE1_TOTAL_LIMIT';END IF;
  plan:=plan||jsonb_build_object('id',p.id,'name',p.name_ar,'sku',p.sku,'qty',qty,'price',price,'amount',amount);
 END LOOP;
 IF p_guest AND total<settings.minimum_order_in_minor_units THEN RAISE EXCEPTION 'LITE1_MINIMUM_ORDER';END IF;
 IF NOT p_guest THEN
  IF method IN('debt','partial') AND c IS NULL THEN RAISE EXCEPTION 'LITE1_DEBT_CUSTOMER_REQUIRED';END IF;
  IF method='partial' AND (paid<=0 OR paid>=total OR initial IS NULL OR initial NOT IN('cash','cliq')) THEN RAISE EXCEPTION 'LITE1_PARTIAL_INVALID';END IF;
  IF method<>'partial' AND paid<>0 THEN RAISE EXCEPTION 'LITE1_UNEXPECTED_PAID';END IF;
 END IF;
 result:=jsonb_build_object('success',true,'orderId',oid,'operationId',op,'totalInMinorUnits',total,'amountPaidInMinorUnits',CASE WHEN method IN('cash','cliq') THEN total ELSE paid END,'unavailableConfirmed',to_jsonb(unavailable),'accountingTracked',false);
 INSERT INTO public.business_operations(id,operation_type,idempotency_key,request_fingerprint,initiated_by,result_snapshot,completed_at) VALUES(op,CASE WHEN p_guest THEN 'lite1_guest' ELSE 'lite1_pos' END,p_key,(SELECT r.fingerprint FROM sales_lite1.requests r WHERE r.key=p_key),auth.uid(),result,now());
 INSERT INTO sales_lite1.orders VALUES(oid,op,COALESCE(p_request->'recipient','{}'),unavailable);
 INSERT INTO public.orders(id,order_number,customer_id,customer_name_snapshot,branch_id,warehouse_id,status,payment_method,payment_status,subtotal_in_minor_units,total_in_minor_units,amount_paid_in_minor_units,source,idempotency_key,operation_id,cash_shift_id)
 VALUES(oid,'L1-'||oid::TEXT,c,name,bid,wid,CASE WHEN p_guest THEN 'new' ELSE 'completed' END,CASE WHEN method='partial' THEN 'debt' ELSE method END,'unpaid',total,total,0,CASE WHEN p_guest THEN 'website' ELSE 'pos' END,p_key,op,sid);
 IF NOT p_guest THEN INSERT INTO sales_lite1.completions(order_id) VALUES(oid);END IF;
 FOR line IN SELECT value FROM jsonb_array_elements(plan) LOOP
  INSERT INTO public.order_items(order_id,product_id,product_name_snapshot,sku_snapshot,quantity,unit_price_in_minor_units,line_total_in_minor_units,commercial_line_kind,base_unit_name_snapshot,allocated_discount_snapshot_in_minor_units,net_refundable_amount_snapshot_in_minor_units)
  VALUES(oid,(line->>'id')::UUID,line->>'name',line->>'sku',(line->>'qty')::INTEGER,(line->>'price')::BIGINT,(line->>'amount')::BIGINT,'base_unit','باكيت',0,(line->>'amount')::BIGINT);
 END LOOP;
 IF method='partial' THEN PERFORM public.record_customer_order_payment_once(oid,paid,initial,NULL,'دفعة أولى نموذج معزول',p_key||'-initial');END IF;
 RETURN sales_lite1.finish(p_key,result);
END $$;
CREATE FUNCTION public.lite1_pos(p_request JSONB,p_key TEXT) RETURNS JSONB LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$ SELECT sales_lite1.sale(p_request,p_key,false) $$;
CREATE FUNCTION public.lite1_guest(p_request JSONB,p_key TEXT) RETURNS JSONB LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$ SELECT sales_lite1.sale(p_request,p_key,true) $$;

CREATE FUNCTION public.lite1_complete(p_order UUID,p_key TEXT) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r JSONB;o public.orders;sid UUID;BEGIN
 PERFORM sales_lite1.owner();r:=sales_lite1.lock_request(p_key,'complete',jsonb_build_object('order',p_order));IF r IS NOT NULL THEN RETURN r;END IF;
 PERFORM public.phase4_lock_customer_order_context_internal(p_order,true,false);
 SELECT * INTO o FROM public.orders WHERE id=p_order FOR UPDATE;
 IF NOT sales_lite1.is_order(p_order) OR o.source<>'website' OR o.status<>'new' THEN RAISE EXCEPTION 'LITE1_ORDER_STATE';END IF;
 SELECT id INTO sid FROM public.cash_shifts WHERE branch_id=o.branch_id AND status='open' FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'LITE1_SHIFT_REQUIRED';END IF;
 UPDATE public.orders SET status='completed',cash_shift_id=sid,payment_method='cash',payment_confirmed_at=now(),payment_confirmed_by=auth.uid() WHERE id=p_order;
 INSERT INTO sales_lite1.completions(order_id) VALUES(p_order);
 RETURN sales_lite1.finish(p_key,jsonb_build_object('success',true,'orderId',p_order));
END $$;
CREATE FUNCTION sales_lite1.assert_return_window(p_completed TIMESTAMPTZ,p_observed TIMESTAMPTZ) RETURNS VOID LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
 IF p_completed IS NULL OR p_observed IS NULL OR p_observed>p_completed+INTERVAL '48 hours' THEN RAISE EXCEPTION 'PHASE4_RETURN_WINDOW_EXPIRED';END IF;
END $$;
CREATE FUNCTION public.lite1_return(p_item UUID,p_qty INTEGER,p_method TEXT,p_key TEXT) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r JSONB;i public.order_items;o public.orders;used INTEGER;ent BIGINT;debt BIGINT;refund BIGINT;pos RECORD;sid UUID;rid UUID;BEGIN
 PERFORM sales_lite1.owner();r:=sales_lite1.lock_request(p_key,'return',jsonb_build_object('item',p_item,'qty',p_qty,'method',p_method));IF r IS NOT NULL THEN RETURN r;END IF;
 SELECT * INTO i FROM public.order_items WHERE id=p_item;IF NOT FOUND THEN RAISE EXCEPTION 'LITE1_ITEM_INVALID';END IF;
 PERFORM public.phase4_lock_customer_order_context_internal(i.order_id,true,false);
 SELECT * INTO o FROM public.orders WHERE id=i.order_id FOR UPDATE;
 IF NOT sales_lite1.is_order(o.id) OR o.status<>'completed' OR p_qty IS NULL OR p_qty<=0 OR p_method IS NULL OR p_method NOT IN('cash','cliq') THEN RAISE EXCEPTION 'LITE1_RETURN_INVALID';END IF;
 PERFORM sales_lite1.assert_return_window((SELECT completed_at FROM sales_lite1.completions WHERE order_id=o.id),clock_timestamp());
 SELECT id INTO sid FROM public.cash_shifts WHERE branch_id=o.branch_id AND status='open' FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'LITE1_SHIFT_REQUIRED';END IF;
 SELECT COALESCE(sum(quantity),0) INTO used FROM sales_lite1.returns WHERE item_id=p_item;
 IF p_qty>i.quantity-used THEN RAISE EXCEPTION 'LITE1_RETURN_EXCESS';END IF;
 ent:=p_qty::BIGINT*i.unit_price_in_minor_units;
 SELECT * INTO pos FROM public.phase42_order_financial_position_internal(o.id);
 debt:=LEAST(ent,pos.merchandise_debt_in_minor_units);refund:=ent-debt;
 IF refund>pos.refundable_collected_in_minor_units THEN RAISE EXCEPTION 'LITE1_REFUND_EXCESS';END IF;
 INSERT INTO sales_lite1.returns(order_id,item_id,quantity,entitlement,debt_reduction,money_refund,method,shift_id,key,created_by) VALUES(o.id,p_item,p_qty,ent,debt,refund,p_method,sid,p_key,auth.uid()) RETURNING id INTO rid;
 INSERT INTO public.audit_logs(user_id,action,entity_name,entity_id,details) VALUES(auth.uid(),'LITE1_RETURN','orders',o.id,jsonb_build_object('returnId',rid,'quantity',p_qty,'entitlement',ent,'debtReduction',debt,'refund',refund,'method',p_method));
 RETURN sales_lite1.finish(p_key,jsonb_build_object('success',true,'returnId',rid,'entitlement',ent,'debtReduction',debt,'refund',refund));
END $$;
CREATE FUNCTION public.lite1_expense(p_branch UUID,p_amount BIGINT,p_category TEXT,p_description TEXT,p_key TEXT) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r JSONB;BEGIN
 PERFORM sales_lite1.owner();r:=sales_lite1.lock_request(p_key,'expense',jsonb_build_object('branch',p_branch,'amount',p_amount,'category',p_category,'description',p_description));IF r IS NOT NULL THEN RETURN r;END IF;
 RETURN sales_lite1.finish(p_key,public.create_operational_expense(p_branch,p_category,p_description,p_amount,'cash',NULL));
END $$;

-- A separate, cost-free closing document feeds the EXISTING immutable close
-- snapshot. Full-mode documents take the untouched original branch instead.
CREATE FUNCTION sales_lite1.closing_report(p_shift UUID) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE s public.cash_shifts;v JSONB;net BIGINT;BEGIN
 SELECT * INTO STRICT s FROM public.cash_shifts WHERE id=p_shift;
 v:=public.get_cash_shift_summary(p_shift);
 -- Same reconciliation meaning as044: both payment channels, BEFORE owner
 -- withdrawals. close_cash_shift194 appends the withdrawal-adjusted figure.
 net:=(v->>'cashSalesInMinorUnits')::BIGINT+(v->>'cliqSalesInMinorUnits')::BIGINT+(v->>'cardSalesInMinorUnits')::BIGINT+(v->>'cashReceiptsInMinorUnits')::BIGINT+(v->>'cliqReceiptsInMinorUnits')::BIGINT
 -(v->>'cashSupplierPaymentsInMinorUnits')::BIGINT-(v->>'cliqSupplierPaymentsInMinorUnits')::BIGINT-(v->>'cashExpensesInMinorUnits')::BIGINT-(v->>'cliqExpensesInMinorUnits')::BIGINT-(v->>'cashRefundsInMinorUnits')::BIGINT-(v->>'cliqRefundsInMinorUnits')::BIGINT;
 RETURN jsonb_build_object('success',true,'accountingTracked',false,'shiftId',s.id,'summary',v,'reconciliation',jsonb_build_object('expectedCashInMinorUnits',s.expected_cash_in_minor_units,'actualCashInMinorUnits',s.actual_cash_in_minor_units,'cashDiscrepancyInMinorUnits',s.cash_discrepancy_in_minor_units,'netMovementInMinorUnits',net),'sales',COALESCE((SELECT jsonb_agg(jsonb_build_object('orderId',o.id,'totalInMinorUnits',o.total_in_minor_units,'collectedInMinorUnits',o.amount_paid_in_minor_units) ORDER BY o.id) FROM public.orders o WHERE o.cash_shift_id=s.id),'[]'::JSONB),'returns',COALESCE((SELECT sum(entitlement) FROM sales_lite1.returns WHERE shift_id=s.id),0),'cashExpensesInMinorUnits',s.cash_expenses_in_minor_units);
END
$$;
CREATE FUNCTION sales_lite1.adjust_shift(p_summary JSONB,p_shift UUID) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE cash BIGINT;cliq BIGINT;BEGIN
 SELECT COALESCE(sum(money_refund) FILTER(WHERE method='cash'),0),COALESCE(sum(money_refund) FILTER(WHERE method='cliq'),0) INTO cash,cliq FROM sales_lite1.returns WHERE shift_id=p_shift;
 IF cash=0 AND cliq=0 THEN RETURN p_summary;END IF;
 RETURN p_summary||jsonb_build_object('cashRefundsInMinorUnits',(p_summary->>'cashRefundsInMinorUnits')::BIGINT+cash,'cliqRefundsInMinorUnits',(p_summary->>'cliqRefundsInMinorUnits')::BIGINT+cliq,'expectedCashInMinorUnits',(p_summary->>'expectedCashInMinorUnits')::BIGINT-cash);
END $$;
CREATE FUNCTION sales_lite1.integrity_count() RETURNS BIGINT LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT (SELECT count(*) FROM sales_lite1.orders l JOIN public.orders o ON o.id=l.order_id WHERE NOT sales_lite1.is_order(o.id) OR o.cost_finalized_at IS NOT NULL)
 +(SELECT count(*) FROM sales_lite1.orders l JOIN public.orders o ON o.id=l.order_id WHERE o.status='completed' AND NOT EXISTS(SELECT 1 FROM sales_lite1.completions c WHERE c.order_id=o.id))
 +(SELECT count(*) FROM public.inventory_movements m JOIN sales_lite1.orders l ON l.order_id=m.reference_id)
 +(SELECT count(*) FROM public.order_inventory_reservations r JOIN sales_lite1.orders l ON l.order_id=r.order_id)
 +(SELECT count(*) FROM public.order_items i JOIN sales_lite1.orders l ON l.order_id=i.order_id WHERE i.unit_cost_in_minor_units<>0 OR i.cogs_in_minor_units<>0 OR i.profit_in_minor_units<>0 OR i.cost_finalized_at IS NOT NULL OR i.exact_cogs_snapshot_in_minor_units IS NOT NULL OR i.unit_cost_snapshot_in_minor_units_exact IS NOT NULL)
 +(SELECT count(*) FROM sales_lite1.returns r JOIN public.order_items i ON i.id=r.item_id WHERE i.order_id<>r.order_id OR NOT sales_lite1.is_order(r.order_id))
 +(SELECT count(*) FROM (SELECT item_id,sum(quantity) q,sum(entitlement) e FROM sales_lite1.returns GROUP BY item_id) r JOIN public.order_items i ON i.id=r.item_id WHERE r.q>i.quantity OR r.e>i.net_refundable_amount_snapshot_in_minor_units)
 +(SELECT count(*) FROM (SELECT order_id,sum(money_refund) AS refunded FROM sales_lite1.returns GROUP BY order_id) r
 JOIN public.orders o ON o.id=r.order_id WHERE r.refunded>o.amount_paid_in_minor_units);
$$;

-- No default-executable definer helpers, including newly added public RPCs.
DO $$ DECLARE f RECORD;BEGIN
 FOR f IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='sales_lite1' OR(n.nspname='public' AND p.proname LIKE 'lite1\_%' ESCAPE '\') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f.sig);
 END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION public.lite1_set_mode(BOOLEAN),public.lite1_set_available(UUID,BOOLEAN,INTEGER),public.lite1_pos(JSONB,TEXT),public.lite1_complete(UUID,TEXT),public.lite1_return(UUID,INTEGER,TEXT,TEXT),public.lite1_expense(UUID,BIGINT,TEXT,TEXT,TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.lite1_guest(JSONB,TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.populate_order_item_cost_snapshot()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_unit_cost BIGINT;
  v_operation_type TEXT;
BEGIN
  SELECT operation.operation_type INTO v_operation_type
  FROM public.orders customer_order
  JOIN public.business_operations operation
    ON operation.id = customer_order.operation_id
  WHERE customer_order.id = NEW.order_id;

  IF v_operation_type = 'phase3_customer_reservation_v1' OR sales_lite1.is_order(NEW.order_id) THEN
    NEW.unit_cost_in_minor_units := 0;
    NEW.cogs_in_minor_units := 0;
    NEW.profit_in_minor_units := 0;
    NEW.unit_cost_snapshot_in_minor_units_exact := NULL;
    NEW.exact_cogs_snapshot_in_minor_units := NULL;
    NEW.cost_finalized_at := NULL;
    RETURN NEW;
  END IF;

  SELECT cost_price_in_minor_units INTO v_unit_cost
  FROM public.products WHERE id = NEW.product_id;
  NEW.unit_cost_in_minor_units := COALESCE(v_unit_cost, 0);
  NEW.cogs_in_minor_units := COALESCE(NEW.quantity, 0) * NEW.unit_cost_in_minor_units;
  NEW.profit_in_minor_units :=
    COALESCE(NEW.line_total_in_minor_units, 0) - NEW.cogs_in_minor_units;
  RETURN NEW;
END;
$function$;
CREATE OR REPLACE FUNCTION public.phase42_order_financial_position_internal(p_order_id uuid)
 RETURNS TABLE(total_in_minor_units bigint, delivery_fee_in_minor_units bigint, net_collected_in_minor_units bigint, prior_debt_reductions_in_minor_units bigint, prior_money_refunds_in_minor_units bigint, outstanding_total_in_minor_units bigint, delivery_outstanding_in_minor_units bigint, merchandise_debt_in_minor_units bigint, refundable_collected_in_minor_units bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH position AS (
    SELECT customer_order.total_in_minor_units AS total_amount,
      customer_order.delivery_fee_in_minor_units AS delivery_amount,
      customer_order.amount_paid_in_minor_units AS collected_amount,
      COALESCE(SUM(event.debt_reduction_amount_in_minor_units)
        FILTER (WHERE event.settlement_status = 'settled'
          AND event.contract_version = 401), 0)::BIGINT + COALESCE((SELECT sum(r.debt_reduction) FROM sales_lite1.returns r WHERE r.order_id=customer_order.id),0)::BIGINT AS prior_debt,
      COALESCE(SUM(event.money_refund_amount_in_minor_units)
        FILTER (WHERE event.settlement_status = 'settled'
          AND event.contract_version = 401), 0)::BIGINT + COALESCE((SELECT sum(r.money_refund) FROM sales_lite1.returns r WHERE r.order_id=customer_order.id),0)::BIGINT AS prior_refunds
    FROM public.orders customer_order
    LEFT JOIN public.sales_return_events event
      ON event.order_id = customer_order.id
    WHERE customer_order.id = p_order_id
    GROUP BY customer_order.id
  ), derived AS (
    SELECT *, GREATEST(total_amount - collected_amount - prior_debt, 0)::BIGINT
      AS outstanding_amount
    FROM position
  ), delivery AS (
    SELECT *, LEAST(delivery_amount, outstanding_amount)::BIGINT
      AS delivery_outstanding
    FROM derived
  )
  SELECT total_amount, delivery_amount, collected_amount, prior_debt,
    prior_refunds, outstanding_amount, delivery_outstanding,
    GREATEST(outstanding_amount - delivery_outstanding, 0)::BIGINT,
    GREATEST(collected_amount - prior_refunds
      - (delivery_amount - delivery_outstanding), 0)::BIGINT
  FROM delivery;
$function$;
CREATE OR REPLACE FUNCTION public.get_cash_shift_summary(p_shift_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE result JSONB; status TEXT; cash_in BIGINT; cliq_in BIGINT; cash_out BIGINT; cliq_out BIGINT;
BEGIN
 result:=public.tb215_shift_before_exchange_internal(p_shift_id);
 SELECT s.status INTO status FROM public.cash_shifts s WHERE s.id=p_shift_id;
 IF status IS DISTINCT FROM 'open' THEN RETURN result; END IF;
 result:=sales_lite1.adjust_shift(result,p_shift_id);
 SELECT COALESCE(sum((x.prepared_plan->>'moneyReceivedInMinorUnits')::BIGINT) FILTER(WHERE x.prepared_plan->>'differenceMethod'='cash'),0),
  COALESCE(sum((x.prepared_plan->>'moneyReceivedInMinorUnits')::BIGINT) FILTER(WHERE x.prepared_plan->>'differenceMethod'='cliq'),0),
  COALESCE(sum((x.prepared_plan->>'moneyRefundInMinorUnits')::BIGINT) FILTER(WHERE x.prepared_plan->>'differenceMethod'='cash'),0),
  COALESCE(sum((x.prepared_plan->>'moneyRefundInMinorUnits')::BIGINT) FILTER(WHERE x.prepared_plan->>'differenceMethod'='cliq'),0)
 INTO cash_in,cliq_in,cash_out,cliq_out FROM public.aftercare215_exchanges x JOIN public.aftercare215_exchange_results r ON r.operation_id=x.operation_id
 WHERE(x.prepared_plan->>'cashShiftId')::UUID=p_shift_id;
 result:=jsonb_set(result,'{cashSalesInMinorUnits}',to_jsonb((result->>'cashSalesInMinorUnits')::BIGINT+cash_in));
 result:=jsonb_set(result,'{cliqSalesInMinorUnits}',to_jsonb((result->>'cliqSalesInMinorUnits')::BIGINT+cliq_in));
 result:=jsonb_set(result,'{cashRefundsInMinorUnits}',to_jsonb((result->>'cashRefundsInMinorUnits')::BIGINT+cash_out));
 result:=jsonb_set(result,'{cliqRefundsInMinorUnits}',to_jsonb((result->>'cliqRefundsInMinorUnits')::BIGINT+cliq_out));
 RETURN jsonb_set(result,'{expectedCashInMinorUnits}',to_jsonb((result->>'expectedCashInMinorUnits')::BIGINT+cash_in-cash_out));
END $function$;
CREATE OR REPLACE FUNCTION public._get_cash_shift_closing_report_before_snapshot(p_shift_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_report JSONB;
  v_base_report JSONB;
  v_event_count INTEGER := 0;
  v_exchange_refund_count INTEGER := 0;
  v_internal_exchange_credit BIGINT := 0;
  v_breakdown JSONB;
  v_quantity_breakdown JSONB;
  v_shift public.cash_shifts%ROWTYPE;
  v_gross BIGINT;
  v_credit BIGINT;
  v_first_cash BIGINT;
  v_first_cliq BIGINT;
  v_first_total BIGINT;
  v_direct_collected BIGINT;
  v_unproven INTEGER;
  v_debt_reduction BIGINT;
  v_return_entitlement BIGINT;
BEGIN
  IF EXISTS(SELECT 1 FROM sales_lite1.shifts WHERE shift_id=p_shift_id) THEN
    PERFORM sales_lite1.owner();
    RETURN sales_lite1.closing_report(p_shift_id);
  END IF;
  v_report := public._get_cash_shift_closing_report_before_return_events(p_shift_id);
  IF COALESCE(v_report->>'success', 'false') <> 'true' THEN
    RETURN v_report;
  END IF;
  SELECT COUNT(*)::INTEGER INTO v_event_count
  FROM public.sales_return_events
  WHERE cash_shift_id = p_shift_id
    AND settlement_status = 'settled'
    AND money_refund_amount_in_minor_units > 0 AND refund_method<>'exchange_credit';
  SELECT count(*) INTO v_exchange_refund_count FROM public.aftercare215_exchanges x JOIN public.aftercare215_exchange_results r ON r.operation_id=x.operation_id
  WHERE(x.prepared_plan->>'cashShiftId')::UUID=p_shift_id AND(x.prepared_plan->>'moneyRefundInMinorUnits')::BIGINT>0;
  v_event_count:=v_event_count+v_exchange_refund_count;

  IF v_event_count > 0 THEN
    WITH combined AS (
      SELECT
        item->>'refundMethod' AS refund_method,
        item->>'stockDisposition' AS stock_disposition,
        COALESCE((item->>'count')::INTEGER, 0) AS item_count,
        COALESCE((item->>'amountInMinorUnits')::BIGINT, 0) AS amount
      FROM jsonb_array_elements(COALESCE(v_report->'returnBreakdown', '[]'::JSONB)) item
      UNION ALL
      SELECT
        return_event.refund_method,
        CASE WHEN EXISTS (
          SELECT 1 FROM public.sales_return_items return_item
          WHERE return_item.sales_return_event_id = return_event.id
            AND return_item.stock_disposition = 'damaged'
        ) THEN 'damaged' ELSE 'restock' END,
        1,
        return_event.money_refund_amount_in_minor_units
      FROM public.sales_return_events return_event
      WHERE return_event.cash_shift_id = p_shift_id
        AND return_event.settlement_status = 'settled'
        AND return_event.money_refund_amount_in_minor_units > 0 AND return_event.refund_method<>'exchange_credit'
      UNION ALL
      SELECT x.prepared_plan->>'differenceMethod',CASE WHEN EXISTS(SELECT 1 FROM public.sales_return_items i WHERE i.sales_return_event_id=e.id AND i.stock_disposition='damaged') THEN 'damaged' ELSE 'restock' END,
       1,(x.prepared_plan->>'moneyRefundInMinorUnits')::BIGINT
      FROM public.aftercare215_exchanges x JOIN public.aftercare215_exchange_results r ON r.operation_id=x.operation_id JOIN public.sales_return_events e ON e.operation_id=r.return_operation_id
      WHERE(x.prepared_plan->>'cashShiftId')::UUID=p_shift_id AND(x.prepared_plan->>'moneyRefundInMinorUnits')::BIGINT>0
    ), grouped AS (
      SELECT refund_method, stock_disposition,
        SUM(item_count)::INTEGER AS item_count, SUM(amount)::BIGINT AS amount
      FROM combined
      GROUP BY refund_method, stock_disposition
    )
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'refundMethod', refund_method,
        'stockDisposition', stock_disposition,
        'count', item_count,
        'amountInMinorUnits', amount
      ) ORDER BY amount DESC, refund_method, stock_disposition
    ), '[]'::JSONB)
    INTO v_breakdown
    FROM grouped;

    v_report := jsonb_set(v_report, '{returnBreakdown}', v_breakdown, true);
    v_report := jsonb_set(
      v_report,
      '{outflows,returnCount}',
      to_jsonb(COALESCE((v_report #>> '{outflows,returnCount}')::INTEGER, 0) + v_event_count),
      true
    );
  END IF;

  WITH quantities AS (
    -- Modern allocated returns preserve three independent buckets per physical
    -- leaf. A root inspection's accepted disposition cannot classify all its
    -- accepted quantity: it may contain both sellable and supplier-defect units.
    SELECT e.id AS event_id, (leaf->>'product_id')::UUID AS product_id,
      (leaf->>'sellable_restock_quantity')::INTEGER AS sellable,
      (leaf->>'defect_non_sellable_quantity')::INTEGER AS defect,
      (leaf->>'customer_damage_quantity')::INTEGER AS damage
    FROM public.sales_return_events e
    JOIN public.business_operations op ON op.id = e.operation_id
    CROSS JOIN LATERAL jsonb_array_elements(op.request_identity_snapshot->'physical_sources') leaf
    WHERE e.cash_shift_id = p_shift_id AND e.settlement_status = 'settled' AND e.contract_version = 401
      AND jsonb_typeof(op.request_identity_snapshot->'physical_sources') = 'array'
    UNION ALL
    SELECT e.id, i.product_id,
      CASE WHEN i.stock_disposition = 'restock' THEN i.accepted_base_quantity ELSE 0 END,
      CASE WHEN i.stock_disposition = 'damaged' THEN i.accepted_base_quantity ELSE 0 END,
      i.rejected_base_quantity
    FROM public.sales_return_events e
    JOIN public.sales_return_items i ON i.sales_return_event_id = e.id
    JOIN public.business_operations op ON op.id = e.operation_id
    WHERE e.cash_shift_id = p_shift_id AND e.settlement_status = 'settled' AND e.contract_version = 401
      AND i.return_scope = 'base_unit'
      AND NOT (op.request_identity_snapshot ? 'physical_sources')
    UNION ALL
    SELECT e.id, c.product_id,
      CASE WHEN c.accepted_stock_disposition = 'restock' THEN c.accepted_quantity ELSE 0 END,
      CASE WHEN c.accepted_stock_disposition = 'non_sellable' THEN c.accepted_quantity ELSE 0 END,
      c.rejected_quantity
    FROM public.sales_return_events e
    JOIN public.sales_return_items i ON i.sales_return_event_id = e.id
    JOIN public.sales_return_component_inspections c ON c.sales_return_item_id = i.id
    JOIN public.business_operations op ON op.id = e.operation_id
    WHERE e.cash_shift_id = p_shift_id AND e.settlement_status = 'settled' AND e.contract_version = 401
      AND NOT (op.request_identity_snapshot ? 'physical_sources')
    UNION ALL
    SELECT e.id, i.product_id,
      CASE WHEN e.stock_disposition = 'restock' THEN i.quantity ELSE 0 END,
      CASE WHEN e.stock_disposition = 'damaged' THEN i.quantity ELSE 0 END,
      0
    FROM public.sales_returns e
    JOIN public.order_items i ON i.order_id = e.order_id
    WHERE e.cash_shift_id = p_shift_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'eventId', q.event_id, 'productId', q.product_id,
    'productName', COALESCE(p.name_ar, 'صنف تاريخي'),
    'sellableQuantity', q.sellable, 'defectQuantity', q.defect,
    'customerDamageQuantity', q.damage) ORDER BY q.event_id, q.product_id), '[]'::JSONB)
  INTO v_quantity_breakdown
  FROM quantities q LEFT JOIN public.products p ON p.id = q.product_id;

  -- Preserve the full131 Return projection even if only133 sales enrichment fails.
  v_report := v_report || jsonb_build_object('returnQuantityBreakdown',v_quantity_breakdown);
  v_base_report:=v_report;
  BEGIN

  SELECT * INTO STRICT v_shift FROM public.cash_shifts WHERE id=p_shift_id;
  SELECT COALESCE(sum((x.prepared_plan->>'internalCreditInMinorUnits')::BIGINT),0) INTO v_internal_exchange_credit
  FROM public.aftercare215_exchanges x JOIN public.aftercare215_exchange_results r ON r.operation_id=x.operation_id
  WHERE(x.prepared_plan->>'cashShiftId')::UUID=p_shift_id;

  -- Completion-time truth is immutable. Later receipts/refunds do not turn
  -- newly-sold credit into a different sale. Existing cash/receipt/reconciliation
  -- fields in v_report are never rewritten by this presentation change.
  WITH first_completion AS MATERIALIZED (
    SELECT order_id,MAX(created_at) AS at FROM public.order_status_history
    WHERE new_status='completed' GROUP BY order_id
  ), completions AS MATERIALIZED (
    SELECT DISTINCT ON (operation.result_snapshot->>'order_id')
      operation.result_snapshot->>'order_id' AS order_key,
      operation.result_snapshot,operation.request_identity_snapshot
    FROM public.business_operations operation
    WHERE operation.operation_type='phase3_customer_completion_v1'
      AND operation.result_snapshot->>'order_id'=operation.request_identity_snapshot->>'order_id'
      AND operation.completed_at IS NOT NULL
    ORDER BY operation.result_snapshot->>'order_id',operation.completed_at,operation.id
  ), selected AS (
    SELECT customer_order.*,creation.operation_type,creation.result_snapshot AS creation_result,
      completion.result_snapshot AS completion_result,completion.request_identity_snapshot AS completion_request
    FROM public.orders customer_order
    LEFT JOIN first_completion ON first_completion.order_id=customer_order.id
    LEFT JOIN public.business_operations creation ON creation.id=customer_order.operation_id
    LEFT JOIN completions completion ON completion.order_key=customer_order.id::TEXT
    WHERE customer_order.branch_id=v_shift.branch_id
      AND customer_order.status IN('completed','returned')
      AND (customer_order.cash_shift_id=p_shift_id OR (
        customer_order.cash_shift_id IS NULL AND COALESCE(first_completion.at,customer_order.updated_at)>=v_shift.opened_at
        AND COALESCE(first_completion.at,customer_order.updated_at)<=COALESCE(v_shift.closed_at,NOW())
      ))
  ), anchors AS (
    SELECT selected.*,
      CASE WHEN operation_type='phase3_pos_sale_v1'
        THEN COALESCE((SELECT initial.amount_in_minor_units FROM public.pos216_initial_payments initial WHERE initial.order_id=selected.id),(creation_result->>'amountPaidInMinorUnits')::BIGINT)
        WHEN operation_type='phase3_customer_reservation_v1'
        THEN (completion_result->>'amount_paid_in_minor_units')::BIGINT
        WHEN payment_method IN('cash','cash_on_delivery','cliq','card') THEN total_in_minor_units
        ELSE 0 END AS initial_collected,
      CASE WHEN operation_type='phase3_pos_sale_v1'
        THEN (SELECT receipt.payment_number FROM public.pos216_initial_payments initial JOIN public.customer_payments receipt ON receipt.id=initial.payment_id WHERE initial.order_id=selected.id)
        WHEN operation_type='phase3_customer_reservation_v1'
        THEN NULLIF(completion_result->>'customer_payment_number','') END AS first_voucher_number
    FROM selected
  ), bound AS (
    SELECT anchors.*,payment.id AS first_payment_id,payment.amount_in_minor_units AS first_amount,
      payment.payment_method AS first_method,payment.order_id AS first_order_id,
      payment.cash_shift_id AS first_shift_id
    FROM anchors LEFT JOIN public.customer_payments payment ON payment.payment_number=anchors.first_voucher_number
  )
  SELECT COALESCE(SUM(total_in_minor_units),0)::BIGINT,
    COALESCE(SUM(total_in_minor_units-initial_collected),0)::BIGINT,
    COALESCE(SUM(first_amount) FILTER(WHERE first_method='cash'),0)::BIGINT,
    COALESCE(SUM(first_amount) FILTER(WHERE first_method='cliq'),0)::BIGINT,
    COUNT(*) FILTER(WHERE initial_collected IS NULL OR initial_collected<0
      OR initial_collected>total_in_minor_units OR (
        first_voucher_number IS NOT NULL AND (
          first_payment_id IS NULL OR first_order_id IS DISTINCT FROM id
          OR first_shift_id IS DISTINCT FROM p_shift_id OR first_amount IS DISTINCT FROM initial_collected
          OR first_method IS DISTINCT FROM COALESCE((SELECT initial.payment_method FROM public.pos216_initial_payments initial WHERE initial.order_id=bound.id),completion_request->>'payment_method')
          OR first_method NOT IN('cash','cliq')
        )
      ))::INTEGER
  INTO v_gross,v_credit,v_first_cash,v_first_cliq,v_unproven
  FROM bound;

  v_first_total:=v_first_cash+v_first_cliq;
  v_direct_collected:=COALESCE((v_report#>>'{shift,cashSalesInMinorUnits}')::BIGINT,0)
    +COALESCE((v_report#>>'{shift,cliqSalesInMinorUnits}')::BIGINT,0)
    +COALESCE((v_report#>>'{shift,cardSalesInMinorUnits}')::BIGINT,0);
  IF v_unproven<>0 OR v_gross<>v_direct_collected+v_first_total+v_credit+v_internal_exchange_credit THEN
    RAISE EXCEPTION 'PHASE133_CLOSING_SALES_EVIDENCE_MISMATCH: لا يمكن إثبات توزيع مبيعات الوردية.';
  END IF;

  -- Existing refunds contain legacy + modern money exactly once. Debt-only
  -- Returns have no cash_shift_id; use authoritative settlement time inside
  -- this branch's non-overlapping shift window. No drawer projection changes.
  SELECT COALESCE(SUM(event.debt_reduction_amount_in_minor_units),0)::BIGINT
  INTO v_debt_reduction
  FROM public.sales_return_events event
  JOIN public.orders customer_order ON customer_order.id=event.order_id
  JOIN public.business_operations creation ON creation.id=customer_order.operation_id
  WHERE event.contract_version=401 AND event.settlement_status='settled'
    AND creation.operation_type IN('phase3_pos_sale_v1','phase3_customer_reservation_v1')
    AND event.branch_id=v_shift.branch_id
    AND (event.cash_shift_id=p_shift_id OR (
      event.cash_shift_id IS NULL AND event.settled_at>=v_shift.opened_at
      AND event.settled_at<COALESCE(v_shift.closed_at,NOW())
    ));
  v_return_entitlement:=COALESCE((v_report#>>'{sales,refundsInMinorUnits}')::BIGINT,0)+v_debt_reduction+v_internal_exchange_credit;

  v_report:=jsonb_set(v_report,'{sales}',(v_report->'sales')||jsonb_build_object(
    'salesDefinitionVersion',CASE WHEN v_internal_exchange_credit>0 THEN 215 ELSE 133 END,
    'grossSalesInMinorUnits',v_gross,
    'collectedDirectSalesInMinorUnits',v_direct_collected,
    'initialReceiptPaymentsInMinorUnits',v_first_total,
    'initialReceiptCashInMinorUnits',v_first_cash,
    'initialReceiptCliqInMinorUnits',v_first_cliq,
    'creditSalesInMinorUnits',v_credit,
    'returnEntitlementInMinorUnits',v_return_entitlement,
    'debtReductionInMinorUnits',v_debt_reduction,
    'netSalesInMinorUnits',v_gross-v_return_entitlement
  ));
  IF v_internal_exchange_credit>0 THEN
    v_report:=jsonb_set(v_report,'{sales}',(v_report->'sales')||jsonb_build_object('internalExchangeCreditInMinorUnits',v_internal_exchange_credit::TEXT));
  END IF;
  v_report:=jsonb_set(v_report,'{collections}',(v_report->'collections')||jsonb_build_object(
    'initialPaymentsInMinorUnits',v_first_total,
    'initialCashInMinorUnits',v_first_cash,
    'initialCliqInMinorUnits',v_first_cliq
  ));
  RETURN v_report || jsonb_build_object('returnQuantityBreakdown', v_quantity_breakdown,'salesDetailStatus','available');
  EXCEPTION WHEN query_canceled THEN
    RETURN v_base_report || jsonb_build_object('salesDetailStatus','unavailable','salesDetailMessage','تفصيل غير متاح');
  WHEN OTHERS THEN
    RETURN v_base_report || jsonb_build_object('salesDetailStatus','unavailable','salesDetailMessage','تفصيل غير متاح');
  END;
END;
$function$;
CREATE OR REPLACE FUNCTION public.phase6_financial_facts_before208_internal(p_branch_id uuid, p_period_start timestamp with time zone, p_period_end timestamp with time zone, p_timezone text, p_verify_evidence boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_facts JSONB;
  v_damage JSONB;
BEGIN
  IF p_period_start IS NULL OR p_period_end IS NULL
    OR p_period_end <= p_period_start OR NULLIF(BTRIM(p_timezone), '') IS NULL
  THEN
    RAISE EXCEPTION 'Invalid Phase 6 financial facts period.';
  END IF;

  -- Fail closed on corrupt evidence for the rows this period reports.
  IF p_verify_evidence THEN
    PERFORM public.phase42_assert_operational_return_evidence_internal(e.operation_id, true)
    FROM public.sales_return_events e
    JOIN public.orders o ON o.id = e.order_id
    JOIN public.business_operations creation ON creation.id = o.operation_id
    WHERE e.contract_version = 401 AND e.settlement_status = 'settled'
      AND creation.operation_type IN ('phase3_pos_sale_v1', 'phase3_customer_reservation_v1')
      AND (p_branch_id IS NULL OR o.branch_id = p_branch_id)
      AND e.settled_at >= p_period_start AND e.settled_at < p_period_end;

    PERFORM public.phase43_assert_operational_replacement_evidence_internal(e.operation_id, true)
    FROM public.sales_replacement_events e
    JOIN public.orders o ON o.id = e.root_order_id
    WHERE e.issuance_status = 'issued'
      AND (p_branch_id IS NULL OR o.branch_id = p_branch_id)
      AND e.issued_at >= p_period_start AND e.issued_at < p_period_end;
  END IF;

  v_damage := public.inventory_damage_period_totals_internal(p_branch_id,p_period_start,p_period_end);
  WITH first_completion AS MATERIALIZED (
    SELECT h.order_id, MIN(h.created_at) AS at
    FROM public.order_status_history h
    WHERE h.new_status = 'completed'
    GROUP BY h.order_id
  ), completion_ops AS MATERIALIZED (
    SELECT DISTINCT ON (b.result_snapshot->>'order_id')
      b.result_snapshot->>'order_id' AS order_key,
      b.result_snapshot, b.completed_at, b.request_identity_snapshot
    FROM public.business_operations b
    WHERE b.operation_type = 'phase3_customer_completion_v1'
      AND b.result_snapshot->>'order_id' = b.request_identity_snapshot->>'order_id'
    ORDER BY b.result_snapshot->>'order_id', b.completed_at, b.id
  ), order_scope AS MATERIALIZED (
    SELECT o.id, o.customer_id, o.branch_id, o.status, o.payment_method, o.delivery_fee_in_minor_units, o.total_in_minor_units, o.source, o.created_at, o.amount_paid_in_minor_units, o.operation_id, fc.at AS completion_at, creation.operation_type,
      creation.result_snapshot AS creation_result, creation.completed_at AS creation_recorded_at,
      completion.result_snapshot AS completion_result,
      completion.completed_at AS completion_recorded_at,
      completion.request_identity_snapshot AS completion_request
    FROM public.orders o
    JOIN first_completion fc ON fc.order_id = o.id
    LEFT JOIN public.business_operations creation ON creation.id = o.operation_id
    LEFT JOIN completion_ops completion ON completion.order_key = o.id::TEXT
    WHERE p_branch_id IS NULL OR o.branch_id = p_branch_id
  ), modern_returns AS MATERIALIZED (
    SELECT e.*
    FROM public.sales_return_events e JOIN order_scope o ON o.id = e.order_id
    WHERE e.contract_version = 401 AND e.settlement_status = 'settled'
      AND o.operation_type IN ('phase3_pos_sale_v1', 'phase3_customer_reservation_v1')
  ), issued AS MATERIALIZED (
    SELECT e.*
    FROM public.sales_replacement_events e JOIN order_scope o ON o.id = e.root_order_id
    WHERE e.issuance_status = 'issued'
  ), return_rows AS (
    SELECT e.id, e.order_id, e.settled_at AS at,
      e.debt_reduction_amount_in_minor_units AS debt,
      e.money_refund_amount_in_minor_units AS refund, e.refund_method,
      e.debt_reduction_amount_in_minor_units + e.money_refund_amount_in_minor_units AS entitlement,
      COALESCE((SELECT SUM(f.historical_restock_value_in_minor_units_exact)
        FROM public.phase42_return_inventory_effects f WHERE f.return_event_id = e.id), 0) AS recovery
    FROM modern_returns e
    UNION ALL
    SELECT e.id, e.order_id, e.created_at, 0, e.refund_amount_in_minor_units, e.refund_method,
      e.refund_amount_in_minor_units,
      CASE WHEN e.stock_disposition = 'restock' THEN COALESCE((SELECT SUM(i.cogs_in_minor_units)
        FROM public.order_items i WHERE i.order_id = e.order_id), 0) ELSE 0 END
    FROM public.sales_returns e JOIN order_scope o ON o.id = e.order_id
    WHERE o.operation_type IS NULL OR o.operation_type NOT IN
      ('phase3_pos_sale_v1', 'phase3_customer_reservation_v1')
  ), initial_collections AS (
    SELECT o.id AS order_id,
      CASE WHEN o.operation_type = 'phase3_pos_sale_v1' THEN o.creation_recorded_at
        ELSE COALESCE(o.completion_recorded_at, o.completion_at) END AS at,
      CASE WHEN o.operation_type = 'phase3_pos_sale_v1' THEN o.creation_result->>'paymentMethod'
        WHEN o.operation_type = 'phase3_customer_reservation_v1' THEN o.completion_request->>'payment_method'
        WHEN o.payment_method = 'cash_on_delivery' THEN 'cash' ELSE o.payment_method END AS method,
      CASE WHEN o.operation_type = 'phase3_pos_sale_v1' THEN (o.creation_result->>'amountPaidInMinorUnits')::BIGINT
        WHEN o.operation_type = 'phase3_customer_reservation_v1' THEN
          CASE WHEN NULLIF(o.completion_result->>'customer_payment_number', '') IS NOT NULL THEN 0
            ELSE (o.completion_result->>'amount_paid_in_minor_units')::BIGINT END
        WHEN o.payment_method = 'debt' THEN 0 ELSE o.total_in_minor_units END AS amount
    FROM order_scope o
  ), money_events AS (
    SELECT order_id, at, method, amount AS collection, 0::BIGINT AS reversal, 0::BIGINT AS refund
    FROM initial_collections WHERE amount > 0
    UNION ALL
    SELECT p.order_id, p.created_at, p.payment_method, p.amount_in_minor_units, 0, 0
    FROM public.customer_payments p JOIN public.orders o ON o.id = p.order_id
    WHERE p_branch_id IS NULL OR o.branch_id = p_branch_id
    UNION ALL
    SELECT p.order_id, p.reversed_at, p.payment_method, 0, p.amount_in_minor_units, 0
    FROM public.customer_payments p JOIN public.orders o ON o.id = p.order_id
    WHERE p.is_reversed AND (p_branch_id IS NULL OR o.branch_id = p_branch_id)
    UNION ALL
    SELECT r.order_id, r.created_at, m.method, 0, m.amount, 0
    FROM public.pos_sale_reversals r JOIN order_scope o ON o.id = r.order_id
    CROSS JOIN LATERAL (VALUES
      ('cash', (r.actual_effect->>'cash_in_minor_units')::BIGINT),
      ('cliq', (r.actual_effect->>'cliq_in_minor_units')::BIGINT)) m(method, amount)
    WHERE m.amount > 0
    UNION ALL
    SELECT order_id, at, refund_method, 0, 0, refund FROM return_rows WHERE refund > 0
    UNION ALL
    SELECT NULL::UUID,c.created_at,c.payment_method,a.amount_in_minor_units,0,0
    FROM public.customer_collection_operations c JOIN public.customer_collection_cheque_allocations a ON a.operation_id=c.id
    JOIN public.cheque_compensation_claims k ON k.id=a.claim_id JOIN public.deferred_cheques q ON q.id=k.cheque_id
    WHERE p_branch_id IS NULL OR COALESCE(c.branch_id,q.branch_id)=p_branch_id
    UNION ALL
    SELECT NULL::UUID,c.reversed_at,c.payment_method,0,a.amount_in_minor_units,0
    FROM public.customer_collection_operations c JOIN public.customer_collection_cheque_allocations a ON a.operation_id=c.id
    JOIN public.cheque_compensation_claims k ON k.id=a.claim_id JOIN public.deferred_cheques q ON q.id=k.cheque_id
    WHERE c.is_reversed AND(p_branch_id IS NULL OR COALESCE(c.branch_id,q.branch_id)=p_branch_id)
    UNION ALL
    -- Opening allocation is not a customer_payment. The order allocation is
    -- already counted above and must never be added from collection totals.
    SELECT NULL::UUID,c.created_at,c.payment_method,a.amount_in_minor_units,0,0
    FROM public.customer_collection_operations c
    JOIN public.customer_collection_opening_allocations a ON a.operation_id=c.id
    WHERE p_branch_id IS NULL OR COALESCE(c.branch_id,public.go_live_main_branch_internal())=p_branch_id
    UNION ALL
    SELECT NULL::UUID,c.reversed_at,c.payment_method,0,a.amount_in_minor_units,0
    FROM public.customer_collection_operations c
    JOIN public.customer_collection_opening_allocations a ON a.operation_id=c.id
    WHERE c.is_reversed AND (p_branch_id IS NULL OR COALESCE(c.branch_id,public.go_live_main_branch_internal())=p_branch_id)
  ), coverage_by_order AS (
    SELECT order_id, SUM(collection - reversal)::BIGINT AS coverage
    FROM money_events GROUP BY order_id
  ), debt_by_order AS (
    SELECT order_id, SUM(debt)::BIGINT AS debt_reduction
    FROM return_rows GROUP BY order_id
  ), positions AS (
    SELECT o.id, o.customer_id, o.status, o.total_in_minor_units,
      COALESCE(c.coverage, 0)::BIGINT AS coverage,
      COALESCE(d.debt_reduction, 0)::BIGINT AS debt_reduction,
      GREATEST(o.total_in_minor_units - COALESCE(c.coverage, 0) - COALESCE(d.debt_reduction, 0), 0)::BIGINT AS due
    FROM order_scope o
    LEFT JOIN coverage_by_order c ON c.order_id = o.id
    LEFT JOIN debt_by_order d ON d.order_id = o.id
  ), period_sales AS (
    SELECT * FROM order_scope WHERE status IN ('completed', 'returned')
      AND completion_at >= p_period_start AND completion_at < p_period_end
  ), sales_totals AS (
    SELECT COALESCE(SUM(total_in_minor_units), 0)::BIGINT AS gross,
      COALESCE(SUM(delivery_fee_in_minor_units), 0)::BIGINT AS delivery,
      COUNT(*) AS count FROM period_sales
  ), period_returns AS (
    SELECT COALESCE(SUM(entitlement), 0)::BIGINT AS entitlement,
      COALESCE(SUM(refund), 0)::BIGINT AS refund, COALESCE(SUM(debt), 0)::BIGINT AS debt,
      ROUND(COALESCE(SUM(recovery), 0))::BIGINT AS recovery, COUNT(*) AS count
    FROM return_rows WHERE at >= p_period_start AND at < p_period_end
  ), costs AS (
    SELECT COALESCE(SUM(i.cogs_in_minor_units), 0)::BIGINT AS cogs
    FROM public.order_items i JOIN period_sales o ON o.id = i.order_id
  ), replacement_costs AS (
    SELECT COALESCE(SUM(f.replacement_cogs_snapshot_in_minor_units), 0)::BIGINT AS cost
    FROM issued e JOIN public.phase43_replacement_inventory_effects f ON f.operation_id = e.operation_id
    WHERE e.issued_at >= p_period_start AND e.issued_at < p_period_end
  ), flows AS (
    SELECT COALESCE(SUM(collection - reversal) FILTER (WHERE method = 'cash'), 0)::BIGINT AS cash_received,
      COALESCE(SUM(collection - reversal) FILTER (WHERE method = 'cliq'), 0)::BIGINT AS cliq_received,
      COALESCE(SUM(collection-reversal) FILTER(WHERE method='bank_transfer'),0)::BIGINT AS bank_received,
      COALESCE(SUM(collection-reversal) FILTER(WHERE method='cheque'),0)::BIGINT AS cheque_received,
      COALESCE(SUM(collection-reversal) FILTER(WHERE COALESCE(method,'') NOT IN ('cash','cliq','bank_transfer','cheque')),0)::BIGINT AS other_received,
      COALESCE(SUM(collection-reversal),0)::BIGINT AS total_received,
      COALESCE(SUM(refund) FILTER (WHERE method = 'cash'), 0)::BIGINT AS cash_refunded,
      COALESCE(SUM(refund) FILTER (WHERE method = 'cliq'), 0)::BIGINT AS cliq_refunded
    FROM money_events WHERE at >= p_period_start AND at < p_period_end
  ), eligible AS MATERIALIZED (
    SELECT o.id, o.customer_id, o.total_in_minor_units,
      o.amount_paid_in_minor_units, o.operation_id
    FROM public.orders o
    WHERE o.status IN ('completed', 'delivered')
      AND o.customer_id IS NOT NULL
      AND (p_branch_id IS NULL OR o.branch_id = p_branch_id)
      AND (COALESCE(o.source, 'website') <> 'pos' OR o.payment_method = 'debt')
  ), prior_debt AS MATERIALIZED (
    -- Exact set-based form of121 phase42_order_financial_position_internal's
    -- prior_debt source. Do not introduce a projection/cache or new authority.
    SELECT e.order_id, SUM(e.debt_reduction_amount_in_minor_units)::BIGINT AS amount
    FROM public.sales_return_events e JOIN eligible o ON o.id = e.order_id
    WHERE e.settlement_status = 'settled' AND e.contract_version = 401
      AND o.amount_paid_in_minor_units < o.total_in_minor_units
    GROUP BY e.order_id
  ), financial_positions AS MATERIALIZED (
    SELECT o.*, CASE
      WHEN o.amount_paid_in_minor_units >= o.total_in_minor_units THEN 0::BIGINT
      ELSE GREATEST(o.total_in_minor_units - o.amount_paid_in_minor_units
        - COALESCE(d.amount, 0) - COALESCE((SELECT sum(r.debt_reduction) FROM sales_lite1.returns r WHERE r.order_id=o.id),0), 0)::BIGINT END AS outstanding
    FROM eligible o LEFT JOIN prior_debt d ON d.order_id = o.id
  ), canonical_order_due AS (
    -- Same set-based canonical positions used by192 aging/CRM;see parity guard.
    SELECT id, customer_id, outstanding AS due FROM financial_positions
  ), opening_due AS (
    -- Preserve164 main-branch attribution;do not clamp signed source values.
    SELECT opening.customer_id, opening.outstanding AS due
    FROM public.go_live_customer_opening_positions_internal(NULL) opening
    WHERE p_branch_id IS NULL OR p_branch_id = public.go_live_main_branch_internal()
  ), balances AS (
    SELECT COALESCE(SUM(due), 0)::BIGINT AS due,
      COUNT(*) FILTER (WHERE due > 0 AND is_order) AS orders,
      COUNT(DISTINCT customer_id) FILTER (WHERE due > 0) AS customers
    FROM (
      SELECT true AS is_order, customer_id, due FROM canonical_order_due
      UNION ALL
      SELECT false, customer_id, due FROM opening_due
      UNION ALL
      SELECT false,c.customer_id,c.outstanding FROM public.cheque_customer_claim_positions_internal() c
      JOIN public.cheque_compensation_claims k ON k.id=c.id JOIN public.deferred_cheques q ON q.id=k.cheque_id
      WHERE p_branch_id IS NULL OR q.branch_id=p_branch_id
    ) receivables
  ), cohort AS (
    SELECT COALESCE(SUM(p.coverage), 0)::BIGINT AS coverage,
      COALESCE(SUM(p.due), 0)::BIGINT AS due
    FROM positions p JOIN period_sales o ON o.id = p.id
  ), expenses AS (
    SELECT COALESCE(SUM(amount_in_minor_units), 0)::BIGINT AS amount,
      COALESCE(SUM(amount_in_minor_units) FILTER (WHERE payment_method = 'cash'), 0)::BIGINT AS cash,
      COALESCE(SUM(amount_in_minor_units) FILTER (WHERE payment_method = 'cliq'), 0)::BIGINT AS cliq,
      COUNT(*) AS count
    FROM public.operational_expenses
    WHERE (p_branch_id IS NULL OR branch_id = p_branch_id)
      AND NOT COALESCE(is_reversed, false)
      AND created_at >= p_period_start AND created_at < p_period_end
  ), daily_collections AS (
    -- One period-local aggregation. Never rescan all money events twice for
    -- every date in the month; collection/reversal equations are unchanged.
    SELECT (m.at AT TIME ZONE p_timezone)::DATE AS day,
      COALESCE(SUM(m.collection-m.reversal) FILTER(WHERE m.method='cash'),0)::BIGINT AS cash_collected,
      COALESCE(SUM(m.collection-m.reversal) FILTER(WHERE m.method='cliq'),0)::BIGINT AS cliq_collected,
      COALESCE(SUM(m.collection-m.reversal) FILTER(WHERE m.method='bank_transfer'),0)::BIGINT AS bank_collected,
      COALESCE(SUM(m.collection-m.reversal) FILTER(WHERE m.method='cheque'),0)::BIGINT AS cheque_collected,
      COALESCE(SUM(m.collection-m.reversal) FILTER(WHERE COALESCE(m.method,'') NOT IN ('cash','cliq','bank_transfer','cheque')),0)::BIGINT AS other_collected,
      COALESCE(SUM(m.collection-m.reversal),0)::BIGINT AS total_collected
    FROM money_events m WHERE m.at>=p_period_start AND m.at<p_period_end
    GROUP BY (m.at AT TIME ZONE p_timezone)::DATE
  ), days AS (
    SELECT day::DATE AS day FROM generate_series((p_period_start AT TIME ZONE p_timezone)::DATE,
      (p_period_end AT TIME ZONE p_timezone)::DATE - 1, INTERVAL '1 day') day
  ), daily AS (
    SELECT d.day,
      COALESCE((SELECT SUM(o.total_in_minor_units) FROM period_sales o
        WHERE (o.completion_at AT TIME ZONE p_timezone)::DATE = d.day), 0)::BIGINT AS gross,
      (SELECT COUNT(*) FROM period_sales o
        WHERE (o.completion_at AT TIME ZONE p_timezone)::DATE = d.day)::BIGINT AS count,
      COALESCE((SELECT SUM(r.entitlement) FROM return_rows r
        WHERE r.at >= p_period_start AND r.at < p_period_end
          AND (r.at AT TIME ZONE p_timezone)::DATE = d.day), 0)::BIGINT AS returned,
      COALESCE(dc.cash_collected,0)::BIGINT AS cash_collected,
      COALESCE(dc.cliq_collected,0)::BIGINT AS cliq_collected,
      COALESCE(dc.bank_collected,0)::BIGINT AS bank_collected,
      COALESCE(dc.cheque_collected,0)::BIGINT AS cheque_collected,
      COALESCE(dc.other_collected,0)::BIGINT AS other_collected,
      COALESCE(dc.total_collected,0)::BIGINT AS total_collected
    FROM days d LEFT JOIN daily_collections dc ON dc.day=d.day
  ) SELECT jsonb_build_object(
    'sales', jsonb_build_object('grossSalesInMinorUnits', s.gross, 'deliveryFeesInMinorUnits', s.delivery,
      'returnEntitlementInMinorUnits', r.entitlement, 'refundsInMinorUnits', r.refund,
      'debtReductionInMinorUnits', r.debt, 'netSalesInMinorUnits', s.gross - r.entitlement,
      'cogsInMinorUnits', c.cogs, 'replacementCostInMinorUnits', rc.cost,
      'restockRecoveryInMinorUnits', r.recovery, 'grossProfitInMinorUnits', s.gross - s.delivery - c.cogs,
      'aftercareAdjustedMarginInMinorUnits', s.gross - r.entitlement - c.cogs - rc.cost + r.recovery,
      'netProfitInMinorUnits', s.gross - r.entitlement - c.cogs - rc.cost + r.recovery - x.amount
        - (v_damage->>'additionalInMinorUnits')::BIGINT,
      'damageLosses',v_damage,
      'collectedInMinorUnits', co.coverage, 'outstandingInMinorUnits', co.due, 'returnCount', r.count,
      'orderCount', s.count, 'completedOrderCount', s.count),
    'cashFlow', jsonb_build_object('customerCollections',jsonb_build_object(
      'cashInMinorUnits',f.cash_received,'cliqInMinorUnits',f.cliq_received,
      'bankTransferInMinorUnits',f.bank_received,'chequeInMinorUnits',f.cheque_received,
      'otherInMinorUnits',f.other_received,'totalInMinorUnits',f.total_received),
      'cashCollectedInMinorUnits', f.cash_received,
      'cliqCollectedInMinorUnits', f.cliq_received, 'cashRefundedInMinorUnits', f.cash_refunded,
      'cliqRefundedInMinorUnits', f.cliq_refunded, 'cashNetFlowInMinorUnits', f.cash_received - f.cash_refunded,
      'cliqNetFlowInMinorUnits', f.cliq_received - f.cliq_refunded),
    'balances', jsonb_build_object('customerDueInMinorUnits', b.due, 'customerOrderCount', b.orders,
      'customerCount', b.customers),
    'expenses', jsonb_build_object('totalInMinorUnits', x.amount, 'cashInMinorUnits', x.cash,
      'cliqInMinorUnits', x.cliq, 'count', x.count),
    'dailyBreakdown', (SELECT COALESCE(jsonb_agg(jsonb_build_object('date', day,
      'completedOrderCount', count, 'grossSalesInMinorUnits', gross,
      'returnEntitlementInMinorUnits', returned, 'netSalesInMinorUnits', gross - returned,
      'cashCollectedInMinorUnits',cash_collected,'cliqCollectedInMinorUnits',cliq_collected,
      'customerCollections',jsonb_build_object('cashInMinorUnits',cash_collected,'cliqInMinorUnits',cliq_collected,
        'bankTransferInMinorUnits',bank_collected,'chequeInMinorUnits',cheque_collected,
        'otherInMinorUnits',other_collected,'totalInMinorUnits',total_collected))
      ORDER BY day), '[]'::JSONB) FROM daily)
  ) INTO v_facts
  FROM sales_totals s CROSS JOIN period_returns r CROSS JOIN costs c
    CROSS JOIN replacement_costs rc CROSS JOIN flows f CROSS JOIN balances b
    CROSS JOIN cohort co CROSS JOIN expenses x;

  RETURN v_facts;
END;
$function$;
CREATE OR REPLACE FUNCTION public.run_advanced_monitoring_checks(p_observed_at timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'auth', 'cron', 'pg_temp'
AS $function$
DECLARE
  v_operation RECORD;
  v_return_count INTEGER := 0;
  v_replacement_count INTEGER := 0;
  v_evidence_issues INTEGER := 0;
  v_cached_evidence public.advanced_monitoring_checks%ROWTYPE;
  v_evidence_started TIMESTAMPTZ;
  v_evidence_canceled BOOLEAN := false;
  v_settings public.advanced_monitoring_settings%ROWTYPE;
  v_count INTEGER;
  v_customer_due BIGINT;
  v_reported_customer_due BIGINT;
  v_total_integrity INTEGER := 0;
  v_previous_size BIGINT;
  v_current_size BIGINT;
  v_growth BIGINT := 0;
  v_connection_percent NUMERIC := 0;
  v_slow_count INTEGER := 0;
  v_auth_entries INTEGER := 0;
  v_status TEXT;
  v_result JSONB;
  v_entity UUID := '00000000-0000-0000-0000-000000000099'::UUID;
BEGIN
  IF p_observed_at IS NULL THEN RAISE EXCEPTION 'Monitoring observation time is required.'; END IF;
  PERFORM set_config('lock_timeout','2s',true);
  PERFORM set_config('statement_timeout','90s',true);
  SELECT * INTO STRICT v_settings FROM public.advanced_monitoring_settings WHERE id=true;
  UPDATE public.advanced_monitoring_metrics SET last_scan_started_at=p_observed_at,
    last_error_code=NULL,updated_at=p_observed_at WHERE id=true;

  SELECT count(*) INTO v_count FROM public.inventory_balances
  WHERE on_hand_quantity<0 OR reserved_quantity<0
    OR available_quantity<>on_hand_quantity-reserved_quantity;
  v_total_integrity := v_total_integrity + v_count;
  PERFORM public._set_advanced_monitoring_check('integrity:inventory:balances','inventory','database',
    CASE WHEN v_count=0 THEN 'healthy' ELSE 'critical' END,'critical',v_count,
    'سلامة أرصدة المخزون',jsonb_build_object('mismatchCount',v_count),p_observed_at);

  SELECT count(*) INTO v_count FROM public.inventory_movements
  WHERE balance_before+quantity<>balance_after;
  v_total_integrity := v_total_integrity + v_count;
  PERFORM public._set_advanced_monitoring_check('integrity:inventory:movement-arithmetic','inventory','database',
    CASE WHEN v_count=0 THEN 'healthy' ELSE 'critical' END,'critical',v_count,
    'معادلة حركات المخزون',jsonb_build_object('mismatchCount',v_count),p_observed_at);

  WITH last_move AS (
    SELECT DISTINCT ON(product_id,warehouse_id) product_id,warehouse_id,balance_after
    FROM public.inventory_movements ORDER BY product_id,warehouse_id,created_at DESC,id DESC
  ) SELECT count(*) INTO v_count FROM last_move l
    LEFT JOIN public.inventory_balances b USING(product_id,warehouse_id)
    WHERE b.id IS NULL OR b.on_hand_quantity<>l.balance_after;
  v_total_integrity := v_total_integrity + v_count;
  PERFORM public._set_advanced_monitoring_check('integrity:inventory:movement-ledger','inventory','database',
    CASE WHEN v_count=0 THEN 'healthy' ELSE 'critical' END,'critical',v_count,
    'تطابق رصيد آخر حركة',jsonb_build_object('mismatchCount',v_count),p_observed_at);

  SELECT count(*) INTO v_count FROM public.inventory_movements m
  LEFT JOIN public.products p ON p.id=m.product_id
  LEFT JOIN public.warehouses w ON w.id=m.warehouse_id
  WHERE p.id IS NULL OR w.id IS NULL;
  v_total_integrity := v_total_integrity + v_count;
  PERFORM public._set_advanced_monitoring_check('integrity:inventory:references','inventory','database',
    CASE WHEN v_count=0 THEN 'healthy' ELSE 'critical' END,'critical',v_count,
    'مراجع حركات المخزون',jsonb_build_object('orphanCount',v_count),p_observed_at);

  WITH reservation_sources AS (
    SELECT
      o.warehouse_id,
      oi.product_id,
      SUM(oi.quantity)::BIGINT AS qty
    FROM public.orders o
    JOIN public.order_items oi ON oi.order_id = o.id
    WHERE o.source = 'website'
      AND o.status IN ('new','confirmed','preparing','ready','out_for_delivery')
      AND o.reservation_released_at IS NULL
      AND NOT sales_lite1.is_order(o.id)
      AND NOT EXISTS (
        SELECT 1
        FROM public.order_inventory_reservations reservation
        WHERE reservation.order_id = o.id
      )
    GROUP BY o.warehouse_id, oi.product_id
    UNION ALL
    SELECT
      reservation.warehouse_id,
      reservation.product_id,
      SUM(reservation.reserved_quantity)::BIGINT AS qty
    FROM public.order_inventory_reservations reservation
    JOIN public.orders o ON o.id = reservation.order_id
    WHERE reservation.reservation_state = 'active'
      AND o.source = 'website'
      AND o.status IN ('new','confirmed','preparing','ready','out_for_delivery')
      AND o.reservation_released_at IS NULL
    GROUP BY reservation.warehouse_id, reservation.product_id
  ), expected AS (
    SELECT warehouse_id, product_id, SUM(qty)::BIGINT AS qty
    FROM reservation_sources
    GROUP BY warehouse_id, product_id
  ), actual AS (
    SELECT warehouse_id,product_id,reserved_quantity::BIGINT qty FROM public.inventory_balances
    WHERE reserved_quantity<>0
  ) SELECT count(*) INTO v_count FROM expected e FULL JOIN actual a USING(warehouse_id,product_id)
    WHERE COALESCE(e.qty,0)<>COALESCE(a.qty,0);
  v_total_integrity := v_total_integrity + v_count;
  PERFORM public._set_advanced_monitoring_check('integrity:orders:reservations','orders','database',
    CASE WHEN v_count=0 THEN 'healthy' ELSE 'critical' END,'critical',v_count,
    'تطابق حجوزات طلبات الموقع',jsonb_build_object('mismatchCount',v_count),p_observed_at);

  WITH expected_sources AS (
    SELECT
      o.id,
      o.warehouse_id,
      oi.product_id,
      SUM(oi.quantity)::BIGINT AS qty
    FROM public.orders o
    JOIN public.order_items oi ON oi.order_id = o.id
    WHERE o.status IN ('completed','returned') AND NOT sales_lite1.is_order(o.id)
      AND COALESCE(oi.commercial_line_kind, 'base_unit') <> 'configurable_parcel'
    GROUP BY o.id, o.warehouse_id, oi.product_id
    UNION ALL
    SELECT
      o.id,
      o.warehouse_id,
      component.product_id,
      SUM(component.base_quantity)::BIGINT AS qty
    FROM public.orders o
    JOIN public.order_parcel_instances instance ON instance.order_id = o.id
    JOIN public.order_parcel_components component
      ON component.parcel_instance_id = instance.id
    WHERE o.status IN ('completed','returned') AND NOT sales_lite1.is_order(o.id)
    GROUP BY o.id, o.warehouse_id, component.product_id
  ), expected AS (
    SELECT id, warehouse_id, product_id, SUM(qty)::BIGINT AS qty
    FROM expected_sources
    GROUP BY id, warehouse_id, product_id
  ), actual AS (
    SELECT movement.reference_id AS id,movement.warehouse_id,movement.product_id,
      (-sum(movement.quantity))::BIGINT qty
    FROM public.inventory_movements movement
    JOIN public.orders moved_order ON moved_order.id = movement.reference_id
      AND moved_order.status IN ('completed','returned')
    WHERE movement.movement_type='sales_deduction'
      AND movement.reference_type IN ('order','pos_sale','customer_order')
    GROUP BY movement.reference_id,movement.warehouse_id,movement.product_id
  ) SELECT count(*) INTO v_count FROM expected e FULL JOIN actual a USING(id,warehouse_id,product_id)
    WHERE COALESCE(e.qty,0)<>COALESCE(a.qty,0);
  v_total_integrity := v_total_integrity + v_count;
  PERFORM public._set_advanced_monitoring_check('integrity:orders:stock-deductions','orders','database',
    CASE WHEN v_count=0 THEN 'healthy' ELSE 'critical' END,'critical',v_count,
    'خصم مخزون الطلبات المكتملة',jsonb_build_object('mismatchCount',v_count),p_observed_at);

  -- Reconcile the net stock effect for the complete supplier-receipt lifecycle.
  -- A cancelled receipt intentionally keeps its original purchase movement and
  -- appends an exact return_out reversal under supplier_receipt_cancellation.
  WITH expected AS (
    SELECT
      sr.id,
      sr.warehouse_id,
      sri.product_id,
      CASE
        WHEN sr.status = 'completed' THEN sum(sri.total_base_units)::BIGINT
        WHEN sr.status = 'cancelled' THEN 0::BIGINT
      END AS qty
    FROM public.supplier_receipts sr
    JOIN public.supplier_receipt_items sri ON sri.supplier_receipt_id = sr.id
    WHERE sr.status IN ('completed', 'cancelled')
    GROUP BY sr.id, sr.status, sr.warehouse_id, sri.product_id
  ), actual AS (
    SELECT
      reference_id AS id,
      warehouse_id,
      product_id,
      sum(quantity)::BIGINT AS qty
    FROM public.inventory_movements
    WHERE
      (reference_type = 'supplier_receipt' AND movement_type = 'purchase_receipt')
      OR
      (reference_type = 'supplier_receipt_cancellation' AND movement_type = 'return_out')
    GROUP BY reference_id, warehouse_id, product_id
  )
  SELECT count(*) INTO v_count
  FROM expected e
  FULL JOIN actual a USING(id, warehouse_id, product_id)
  WHERE COALESCE(e.qty, 0) <> COALESCE(a.qty, 0);
  v_total_integrity := v_total_integrity + v_count;
  PERFORM public._set_advanced_monitoring_check('integrity:inventory:receiving','inventory','database',
    CASE WHEN v_count=0 THEN 'healthy' ELSE 'critical' END,'critical',v_count,
    'تطابق حركات استلام الموردين',jsonb_build_object('mismatchCount',v_count),p_observed_at);

  SELECT count(*) INTO v_count
  FROM public.order_items item
  JOIN public.orders customer_order ON customer_order.id = item.order_id
  LEFT JOIN public.business_operations operation
    ON operation.id = customer_order.operation_id
  WHERE CASE
    WHEN sales_lite1.is_order(customer_order.id) THEN item.unit_cost_in_minor_units<>0 OR item.cogs_in_minor_units<>0 OR item.profit_in_minor_units<>0 OR item.cost_finalized_at IS NOT NULL OR item.exact_cogs_snapshot_in_minor_units IS NOT NULL OR item.unit_cost_snapshot_in_minor_units_exact IS NOT NULL
    WHEN operation.operation_type = 'phase3_customer_reservation_v1'
      AND customer_order.status NOT IN ('completed','returned')
    THEN customer_order.cost_finalized_at IS NOT NULL
      OR item.cost_finalized_at IS NOT NULL
      OR item.exact_cogs_snapshot_in_minor_units IS NOT NULL
      OR item.cogs_in_minor_units <> 0
      OR item.profit_in_minor_units <> 0
    WHEN operation.operation_type = 'phase3_customer_reservation_v1'
    THEN customer_order.cost_finalized_at IS NULL
      OR item.cost_finalized_at IS NULL
      OR item.exact_cogs_snapshot_in_minor_units IS NULL
      OR (
        item.commercial_line_kind = 'configurable_parcel'
        AND (
          item.cogs_in_minor_units IS DISTINCT FROM (
            SELECT COALESCE(SUM(instance.cogs_snapshot_in_minor_units), 0)::BIGINT
            FROM public.order_parcel_instances instance
            WHERE instance.order_item_id = item.id
          )
          OR item.exact_cogs_snapshot_in_minor_units IS DISTINCT FROM (
            SELECT COALESCE(SUM(instance.exact_cogs_snapshot_in_minor_units), 0)::NUMERIC(30,6)
            FROM public.order_parcel_instances instance
            WHERE instance.order_item_id = item.id
          )
          OR EXISTS (
            SELECT 1
            FROM public.order_parcel_instances instance
            WHERE instance.order_item_id = item.id
              AND (
                instance.cost_finalized_at IS NULL
                OR instance.exact_cogs_snapshot_in_minor_units IS NULL
                OR instance.cogs_snapshot_in_minor_units IS DISTINCT FROM
                  ROUND(instance.exact_cogs_snapshot_in_minor_units, 0)::BIGINT
                OR instance.cogs_snapshot_in_minor_units IS DISTINCT FROM (
                  SELECT COALESCE(SUM(component.cogs_snapshot_in_minor_units), 0)::BIGINT
                  FROM public.order_parcel_components component
                  WHERE component.parcel_instance_id = instance.id
                )
                OR instance.exact_cogs_snapshot_in_minor_units IS DISTINCT FROM (
                  SELECT COALESCE(SUM(component.exact_cogs_snapshot_in_minor_units), 0)::NUMERIC(30,6)
                  FROM public.order_parcel_components component
                  WHERE component.parcel_instance_id = instance.id
                )
                OR EXISTS (
                  SELECT 1
                  FROM public.order_parcel_components component
                  WHERE component.parcel_instance_id = instance.id
                    AND (
                      component.cost_finalized_at IS NULL
                      OR component.exact_cogs_snapshot_in_minor_units IS NULL
                    )
                )
              )
          )
        )
      )
      OR (
        item.commercial_line_kind <> 'configurable_parcel'
        AND item.cogs_in_minor_units IS DISTINCT FROM
          ROUND(item.exact_cogs_snapshot_in_minor_units, 0)::BIGINT
      )
      OR item.profit_in_minor_units <>
        item.net_refundable_amount_snapshot_in_minor_units - item.cogs_in_minor_units
    WHEN operation.operation_type = 'phase3_pos_sale_v1'
    THEN item.cogs_in_minor_units < 0
      OR item.profit_in_minor_units <>
        item.net_refundable_amount_snapshot_in_minor_units - item.cogs_in_minor_units
    ELSE item.cogs_in_minor_units <> item.unit_cost_in_minor_units * item.quantity
      OR item.profit_in_minor_units <> item.line_total_in_minor_units - item.cogs_in_minor_units
  END;
  v_total_integrity := v_total_integrity + v_count;
  PERFORM public._set_advanced_monitoring_check('integrity:accounting:cogs-profit','accounting','database',
    CASE WHEN v_count=0 THEN 'healthy' ELSE 'critical' END,'critical',v_count,
    'تطابق تكلفة وربح بنود الطلب',jsonb_build_object('mismatchCount',v_count),p_observed_at);

  SELECT count(*) INTO v_count FROM (
    SELECT id FROM public.customer_payments WHERE is_reversed AND
      (reversed_at IS NULL OR reversed_by IS NULL OR NULLIF(TRIM(reversal_reason),'') IS NULL)
    UNION ALL
    SELECT id FROM public.supplier_payments WHERE is_reversed AND
      (reversed_at IS NULL OR reversed_by IS NULL OR NULLIF(TRIM(reversal_reason),'') IS NULL)
    UNION ALL
    SELECT id FROM public.operational_expenses WHERE is_reversed AND
      (reversed_at IS NULL OR reversed_by IS NULL OR NULLIF(TRIM(reversal_reason),'') IS NULL)
  ) x;
  v_total_integrity := v_total_integrity + v_count;
  PERFORM public._set_advanced_monitoring_check('integrity:accounting:reversals','accounting','database',
    CASE WHEN v_count=0 THEN 'healthy' ELSE 'critical' END,'critical',v_count,
    'اكتمال بيانات العكوسات المالية',jsonb_build_object('mismatchCount',v_count),p_observed_at);

  -- Independent committed evidence, not mutable PO totals or supplier balance.
  SELECT COUNT(*) INTO v_count FROM public.suppliers supplier
  JOIN public.phase133_supplier_balance_evidence_internal() evidence ON evidence.supplier_id=supplier.id
  WHERE supplier.current_balance_in_minor_units IS DISTINCT FROM evidence.balance;
  v_total_integrity := v_total_integrity + v_count;
  PERFORM public._set_advanced_monitoring_check('integrity:accounting:supplier-balances','accounting','database',
    CASE WHEN v_count=0 THEN 'healthy' ELSE 'critical' END,'critical',v_count,
    'تطابق ذمم الموردين',jsonb_build_object('mismatchCount',v_count),p_observed_at);

  -- Independent customer-by-customer legal oracle:all customers,not a UI page
  -- or an active-only subset. This is deliberately not the report CTE itself.
  SELECT COALESCE(SUM(public.phase42_customer_receivable_total_internal(c.id)),0)::BIGINT
    INTO v_customer_due FROM public.customers c;
  v_reported_customer_due := (public.phase6_financial_facts_internal(
    NULL,p_observed_at-INTERVAL '1 day',p_observed_at,'Asia/Amman',false)
    #>> '{balances,customerDueInMinorUnits}')::BIGINT;
  v_count := CASE WHEN v_reported_customer_due IS NOT DISTINCT FROM v_customer_due THEN 0 ELSE 1 END;
  v_total_integrity := v_total_integrity + v_count;
  PERFORM public._set_advanced_monitoring_check('integrity:accounting:customer-receivables','accounting','database',
    CASE WHEN v_count=0 THEN 'healthy' ELSE 'critical' END,'critical',v_count,
    'تطابق ذمم الرئيسية مع أرصدة العملاء القانونية',
    jsonb_build_object('canonicalInMinorUnits',v_customer_due,'reportedInMinorUnits',v_reported_customer_due,
      'differenceInMinorUnits',v_reported_customer_due-v_customer_due,
      'canonicalSource','phase42_customer_receivable_total_internal'),p_observed_at);

  -- Owner withdrawals: amounts/branches/links consistent with their shifts and
  -- shift reversals, and every operation has its audit evidence.
  SELECT count(*) INTO v_count FROM public.owner_withdrawal_integrity_issues_internal();
  v_total_integrity := v_total_integrity + v_count;
  PERFORM public._set_advanced_monitoring_check('integrity:accounting:owner-withdrawals','accounting','database',
    CASE WHEN v_count=0 THEN 'healthy' ELSE 'critical' END,'critical',v_count,
    'تطابق سحوبات المالك وعكوسها مع الورديات',jsonb_build_object('issueCount',v_count),p_observed_at);

  SELECT count(*) INTO v_count FROM public.cheque_integrity_issues_internal();
  v_total_integrity:=v_total_integrity+v_count;
  PERFORM public._set_advanced_monitoring_check('integrity:accounting:deferred-cheques','accounting','database',
    CASE WHEN v_count=0 THEN 'healthy' ELSE 'critical' END,'critical',v_count,
    'تطابق الشيكات والقيود التعويضية والتحصيل',jsonb_build_object('issueCount',v_count),p_observed_at);

  SELECT count(*) INTO v_count FROM public.cash_shifts
  WHERE (status<>'open' AND expected_cash_in_minor_units<>(opening_cash_in_minor_units+cash_sales_in_minor_units+
    cash_receipts_in_minor_units-cash_supplier_payments_in_minor_units-
    cash_expenses_in_minor_units-cash_refunds_in_minor_units-
    public.owner_withdrawal_frozen_shift_effect_internal(id)))
    OR (status='closed' AND cash_discrepancy_in_minor_units<>
      actual_cash_in_minor_units-expected_cash_in_minor_units)
    OR (closing_report_snapshot IS NOT NULL AND
      (closing_report_snapshotted_at IS NULL OR closing_report_snapshot_version<>1));
  v_total_integrity := v_total_integrity + v_count;
  PERFORM public._set_advanced_monitoring_check('integrity:shifts:closing','shifts','database',
    CASE WHEN v_count=0 THEN 'healthy' ELSE 'critical' END,'critical',v_count,
    'تطابق إغلاق الوردية وCash/CliQ',jsonb_build_object('mismatchCount',v_count),p_observed_at);

  SELECT count(*) INTO v_count FROM public.cash_shifts
  WHERE status='closed' AND closed_at>=v_settings.monitoring_activated_at
    AND closing_report_snapshot IS NULL;
  v_total_integrity := v_total_integrity + v_count;
  PERFORM public._set_advanced_monitoring_check('integrity:shifts:snapshot','shifts','database',
    CASE WHEN v_count=0 THEN 'healthy' ELSE 'critical' END,'critical',v_count,
    'وجود لقطة إغلاق للورديات الجديدة',jsonb_build_object('missingCount',v_count),p_observed_at);

  SELECT count(*) INTO v_count FROM public.automation_event_deliveries d
  LEFT JOIN public.automation_events e ON e.id=d.event_id
  WHERE e.id IS NULL OR (d.status='processing' AND d.lease_expires_at<=p_observed_at)
    OR d.status='dead_letter' OR (d.status<>'delivered' AND d.attempt_count>=10);
  v_total_integrity := v_total_integrity + v_count;
  PERFORM public._set_advanced_monitoring_check('integrity:automation:outbox','automation','database',
    CASE WHEN v_count=0 THEN 'healthy' ELSE 'critical' END,'high',v_count,
    'سلامة Business automation outbox',jsonb_build_object('issueCount',v_count),p_observed_at);

  SELECT round(100.0*count(*)/GREATEST(current_setting('max_connections')::INTEGER,1),2)
    INTO v_connection_percent FROM pg_stat_activity;
  v_status := CASE WHEN v_connection_percent>=v_settings.connection_critical_percent THEN 'critical'
    WHEN v_connection_percent>=v_settings.connection_warning_percent THEN 'warning' ELSE 'healthy' END;
  PERFORM public._set_advanced_monitoring_check('performance:database:connections','database','database',
    v_status,'high',CASE WHEN v_status='healthy' THEN 0 ELSE 1 END,
    'استخدام اتصالات قاعدة البيانات',jsonb_build_object('usedPercent',v_connection_percent),p_observed_at);

  SELECT count(*) INTO v_slow_count FROM extensions.pg_stat_statements
  WHERE calls>=v_settings.slow_rpc_min_calls
    AND query ~ '"public"\."[a-zA-Z0-9_]+"'
    AND (mean_exec_time>=v_settings.slow_rpc_mean_ms OR max_exec_time>=v_settings.slow_rpc_max_ms);
  PERFORM public._set_advanced_monitoring_check('performance:database:rpcs','performance','database',
    CASE WHEN v_slow_count=0 THEN 'healthy' ELSE 'warning' END,'medium',v_slow_count,
    'أداء RPCs العامة',jsonb_build_object('slowFunctionCount',v_slow_count,
      'meanThresholdMs',v_settings.slow_rpc_mean_ms,'maxThresholdMs',v_settings.slow_rpc_max_ms),p_observed_at);

  PERFORM public._set_advanced_monitoring_check('performance:database:query-errors','performance','database',
    'unknown','medium',0,'معدل أخطاء الاستعلامات غير متاح من telemetry الحالية',
    jsonb_build_object('reason','no-safe-error-rate-source'),p_observed_at);

  SELECT pg_database_size(current_database()) INTO v_current_size;
  SELECT last_database_size_bytes INTO v_previous_size FROM public.advanced_monitoring_metrics WHERE id=true;
  v_growth := GREATEST(v_current_size-COALESCE(v_previous_size,v_current_size),0);
  v_status := CASE WHEN v_previous_size IS NOT NULL
    AND v_growth>=v_settings.database_growth_min_bytes
    AND (100.0*v_growth/GREATEST(v_previous_size,1))>=v_settings.database_growth_warning_percent
    THEN 'warning' ELSE 'healthy' END;
  PERFORM public._set_advanced_monitoring_check('performance:database:growth','performance','database',
    v_status,'medium',CASE WHEN v_status='healthy' THEN 0 ELSE 1 END,
    'نمو حجم قاعدة البيانات',jsonb_build_object('databaseBytes',v_current_size,'growthBytes',v_growth),p_observed_at);

  SELECT count(*) INTO v_count FROM (VALUES
    ('expire-stale-new-website-orders'),('cleanup-guest-order-gateway-requests'),
    ('scan-core-business-alerts'),('scan-business-summaries'),('run-advanced-monitoring')
  ) expected(jobname) LEFT JOIN cron.job j USING(jobname)
  WHERE j.jobid IS NULL OR NOT j.active;
  v_count := v_count+(SELECT count(*) FROM cron.job_run_details d JOIN cron.job j ON j.jobid=d.jobid
    WHERE j.jobname IN ('expire-stale-new-website-orders','cleanup-guest-order-gateway-requests','scan-core-business-alerts','scan-business-summaries')
      AND d.start_time>=p_observed_at-interval '30 minutes' AND d.status<>'succeeded');
  PERFORM public._set_advanced_monitoring_check('database:cron:health','database','database',
    CASE WHEN v_count=0 THEN 'healthy' ELSE 'critical' END,'high',v_count,
    'حالة مهام Supabase cron',jsonb_build_object('issueCount',v_count),p_observed_at);

  SELECT count(*) INTO v_count FROM public.guest_order_gateway_requests
  WHERE created_at>=p_observed_at-interval '15 minutes' AND decision='rate_limited';
  v_count := CASE WHEN v_count>=v_settings.gateway_rate_limit_warning_count THEN v_count ELSE 0 END;
  PERFORM public._set_advanced_monitoring_check('security:gateway:rate-limit','security','database',
    CASE WHEN v_count=0 THEN 'healthy' ELSE 'warning' END,'medium',v_count,
    'سلوك Rate Limit لبوابة الطلبات',jsonb_build_object('limitedRequestCount',v_count),p_observed_at);

  SELECT count(*) INTO v_count FROM public.guest_order_gateway_requests
  WHERE created_at>=p_observed_at-interval '15 minutes' AND outcome='gateway_error';
  v_count := CASE WHEN v_count>=v_settings.gateway_error_warning_count THEN v_count ELSE 0 END;
  PERFORM public._set_advanced_monitoring_check('security:gateway:errors','security','database',
    CASE WHEN v_count=0 THEN 'healthy' ELSE 'warning' END,'high',v_count,
    'أخطاء بوابة الطلبات',jsonb_build_object('gatewayErrorCount',v_count),p_observed_at);

  SELECT count(*) INTO v_auth_entries FROM auth.audit_log_entries
  WHERE created_at>=p_observed_at-interval '15 minutes';
  SELECT count(*) INTO v_count FROM auth.audit_log_entries
  WHERE created_at>=p_observed_at-interval '15 minutes'
    AND payload::TEXT ~* 'error|failed|forbidden|unauthorized';
  PERFORM public._set_advanced_monitoring_check('security:auth:audit','security','database',
    CASE WHEN v_auth_entries=0 THEN 'unknown' WHEN v_count>=5 THEN 'warning' ELSE 'healthy' END,
    'medium',CASE WHEN v_count>=5 THEN v_count ELSE 0 END,
    'مؤشرات Auth audit المخزنة',jsonb_build_object('recentEntryCount',v_auth_entries,
      'anomalyCount',CASE WHEN v_count>=5 THEN v_count ELSE 0 END),p_observed_at);

  SELECT count(*) INTO v_count FROM public.advanced_monitoring_runtime_incidents
  WHERE resolved_at IS NULL AND last_seen_at>=p_observed_at-
    make_interval(mins=>v_settings.runtime_incident_window_minutes);
  PERFORM public._set_advanced_monitoring_check('runtime:admin:errors','runtime','database',
    CASE WHEN v_count=0 THEN 'healthy' ELSE 'critical' END,'high',v_count,
    'أخطاء تشغيل Admin الحرجة',jsonb_build_object('activeFingerprintCount',v_count),p_observed_at);
  UPDATE public.advanced_monitoring_runtime_incidents SET resolved_at=p_observed_at,updated_at=p_observed_at
  WHERE resolved_at IS NULL AND last_seen_at<p_observed_at-
    make_interval(mins=>v_settings.runtime_incident_window_minutes);

  -- Six-hour cadence: never refresh checked_at while reusing the persisted result.
  -- The metrics UPDATE above serializes concurrent monitoring cycles.
  SELECT * INTO v_cached_evidence FROM public.advanced_monitoring_checks
  WHERE check_key='integrity:aftercare:durable-evidence';
  IF FOUND AND v_cached_evidence.checked_at<=p_observed_at
    AND v_cached_evidence.checked_at>p_observed_at-INTERVAL '6 hours' THEN
    v_evidence_issues:=v_cached_evidence.issue_count;
  ELSE
  v_evidence_started:=clock_timestamp();
  BEGIN
  FOR v_operation IN
    SELECT e.operation_id FROM public.sales_return_events e
    JOIN public.orders o ON o.id=e.order_id
    JOIN public.business_operations creation ON creation.id=o.operation_id
    WHERE e.settlement_status='settled' AND e.contract_version=401
      AND creation.operation_type IN ('phase3_pos_sale_v1','phase3_customer_reservation_v1')
      AND e.settled_at>=p_observed_at-INTERVAL '7 days'
  LOOP
    v_return_count := v_return_count + 1;
    BEGIN
      PERFORM public.phase42_assert_operational_return_evidence_internal(v_operation.operation_id,true);
    EXCEPTION WHEN query_canceled THEN RAISE;
    WHEN OTHERS THEN
      v_evidence_issues := v_evidence_issues + 1;
    END;
  END LOOP;
  FOR v_operation IN
    SELECT operation_id FROM public.sales_replacement_events
    WHERE issuance_status='issued' AND issued_at>=p_observed_at-INTERVAL '7 days'
  LOOP
    v_replacement_count := v_replacement_count + 1;
    BEGIN
      PERFORM public.phase43_assert_operational_replacement_evidence_internal(v_operation.operation_id,true);
    EXCEPTION WHEN query_canceled THEN RAISE;
    WHEN OTHERS THEN
      v_evidence_issues := v_evidence_issues + 1;
    END;
  END LOOP;
  EXCEPTION WHEN query_canceled THEN
    v_evidence_canceled:=true;
    v_evidence_issues:=v_evidence_issues+1;
  END;
  PERFORM public._set_advanced_monitoring_check('integrity:aftercare:durable-evidence','accounting','database',
    CASE WHEN v_evidence_issues=0 THEN 'healthy' ELSE 'critical' END,'critical',v_evidence_issues,
    'سلامة أدلة المرتجعات والاستبدالات لآخر 7 أيام',
    jsonb_build_object('windowDays',7,'returnsChecked',v_return_count,
      'replacementsChecked',v_replacement_count,'queryCanceled',v_evidence_canceled,
      'durationMs',ROUND(EXTRACT(EPOCH FROM clock_timestamp()-v_evidence_started)*1000,3)),p_observed_at);
  END IF;
  v_total_integrity := v_total_integrity + v_evidence_issues;

  PERFORM public._transition_business_alert_incident(
    'business-integrity:system','business_integrity_warning',v_entity,
    v_total_integrity>0,p_observed_at,
    jsonb_build_object('issueCount',v_total_integrity,
      'message','توجد مشكلة اتساق تحتاج مراجعة الإدارة التقنية.','dashboard','monitoring'),true);

  UPDATE public.advanced_monitoring_metrics SET
    last_scan_completed_at=p_observed_at,last_database_size_bytes=v_current_size,
    last_database_size_observed_at=p_observed_at,last_error_code=NULL,
    updated_at=p_observed_at WHERE id=true;

  v_count:=sales_lite1.integrity_count();
  v_total_integrity:=v_total_integrity+v_count;
  PERFORM public._set_advanced_monitoring_check('integrity:lite1:evidence','orders','database',CASE WHEN v_count=0 THEN 'healthy' ELSE 'critical' END,'critical',v_count,'سلامة المبيعات بلا تتبع مخزون',jsonb_build_object('mismatchCount',v_count),p_observed_at);
  SELECT jsonb_build_object('ok',true,'checkedAt',p_observed_at,
    'checkCount',count(*),'openIssueCount',count(*) FILTER(WHERE status IN ('warning','critical')),
    'integrityIssueCount',v_total_integrity) INTO v_result
  FROM public.advanced_monitoring_checks WHERE source='database';
  RETURN v_result;
EXCEPTION WHEN OTHERS THEN
  UPDATE public.advanced_monitoring_metrics SET last_error_code=COALESCE(SQLSTATE,'UNKNOWN'),
    updated_at=NOW() WHERE id=true;
  RAISE;
END;
$function$;
CREATE OR REPLACE FUNCTION public.sync_stock_alert(p_product_id uuid, p_warehouse_id uuid, p_on_hand_quantity integer, p_reserved_quantity integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_threshold INTEGER;
  v_is_active BOOLEAN;
  v_available INTEGER :=
    COALESCE(p_on_hand_quantity, 0) - COALESCE(p_reserved_quantity, 0);
  v_severity TEXT;
  v_existing_id UUID;
  v_existing_severity TEXT;
BEGIN
  IF sales_lite1.enabled() THEN RETURN;END IF;
  SELECT min_stock_level, is_active
  INTO v_threshold, v_is_active
  FROM public.products
  WHERE id = p_product_id;

  IF NOT FOUND OR NOT COALESCE(v_is_active, false) THEN
    UPDATE public.stock_alerts
    SET
      status = 'resolved',
      resolved_at = NOW(),
      last_updated_at = NOW()
    WHERE product_id = p_product_id
      AND warehouse_id = p_warehouse_id
      AND status = 'active';
    RETURN;
  END IF;

  v_threshold := GREATEST(COALESCE(v_threshold, 0), 0);

  SELECT id, severity
  INTO v_existing_id, v_existing_severity
  FROM public.stock_alerts
  WHERE product_id = p_product_id
    AND warehouse_id = p_warehouse_id
    AND status = 'active'
  FOR UPDATE;

  IF v_available <= v_threshold THEN
    v_severity :=
      CASE WHEN v_available <= 0
        THEN 'out_of_stock'
        ELSE 'low_stock'
      END;

    IF v_existing_id IS NULL THEN
      INSERT INTO public.stock_alerts (
        product_id,
        warehouse_id,
        severity,
        status,
        available_quantity,
        threshold_quantity
      ) VALUES (
        p_product_id,
        p_warehouse_id,
        v_severity,
        'active',
        v_available,
        v_threshold
      );
    ELSE
      UPDATE public.stock_alerts
      SET
        severity = v_severity,
        available_quantity = v_available,
        threshold_quantity = v_threshold,
        last_updated_at = NOW(),
        resolved_at = NULL
      WHERE id = v_existing_id;

      -- A read low-stock alert becomes unread again if the product reaches zero.
      IF v_existing_severity IS DISTINCT FROM v_severity THEN
        DELETE FROM public.stock_alert_reads
        WHERE stock_alert_id = v_existing_id;
      END IF;
    END IF;
  ELSIF v_existing_id IS NOT NULL THEN
    UPDATE public.stock_alerts
    SET
      status = 'resolved',
      available_quantity = v_available,
      threshold_quantity = v_threshold,
      resolved_at = NOW(),
      last_updated_at = NOW()
    WHERE id = v_existing_id;
  END IF;
END;
$function$;
CREATE OR REPLACE FUNCTION public.enqueue_stock_automation_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_product_name TEXT;
  v_warehouse_name TEXT;
  v_should_enqueue BOOLEAN := false;
BEGIN
  IF sales_lite1.enabled() THEN RETURN NEW;END IF;
  IF NEW.status = 'active' THEN
    v_should_enqueue := TG_OP = 'INSERT'
      OR OLD.status IS DISTINCT FROM 'active'
      OR OLD.severity IS DISTINCT FROM NEW.severity;
  END IF;

  IF NOT v_should_enqueue THEN
    RETURN NEW;
  END IF;

  SELECT p.name_ar INTO v_product_name
  FROM public.products p
  WHERE p.id = NEW.product_id;

  SELECT w.name_ar INTO v_warehouse_name
  FROM public.warehouses w
  WHERE w.id = NEW.warehouse_id;

  PERFORM public.enqueue_automation_event(
    'stock_alert:' || NEW.id::TEXT || ':' || NEW.severity || ':'
      || floor(extract(epoch FROM NEW.last_updated_at))::BIGINT::TEXT,
    CASE
      WHEN NEW.severity = 'out_of_stock' THEN 'out_of_stock'
      ELSE 'low_stock'
    END,
    NEW.id,
    jsonb_build_object(
      'stockAlertId', NEW.id,
      'productId', NEW.product_id,
      'productName', COALESCE(v_product_name, 'صنف'),
      'warehouseId', NEW.warehouse_id,
      'warehouseName', COALESCE(v_warehouse_name, 'المستودع'),
      'availableQuantity', NEW.available_quantity,
      'thresholdQuantity', NEW.threshold_quantity,
      'severity', NEW.severity,
      'updatedAt', NEW.last_updated_at
    )
  );

  RETURN NEW;
END;
$function$;
-- Local prototype admission replaced by the exact219/636 migration guard above.
 CREATE SCHEMA sales_lite2;
 REVOKE ALL ON SCHEMA sales_lite2 FROM PUBLIC,anon,authenticated,service_role;
 CREATE FUNCTION sales_lite2.preview(p_lines jsonb,p_promotion_code text DEFAULT NULL,p_customer_phone text DEFAULT NULL,p_actor_scope text DEFAULT 'guest_gateway')
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,extensions
 AS $lite2_preview$
DECLARE
  v_phone TEXT := CASE
    WHEN NULLIF(BTRIM(p_customer_phone), '') IS NULL THEN NULL
    ELSE public.normalize_customer_phone(p_customer_phone)
  END;
  v_promotion_code TEXT := UPPER(NULLIF(BTRIM(p_promotion_code), ''));
  v_request JSONB;
  v_canonical_request JSONB;
  v_line JSONB;
  v_raw_line JSONB;
  v_instance JSONB;
  v_components JSONB;
  v_line_kind TEXT;
  v_line_identity TEXT;
  v_expected_price BIGINT;
  v_unit_price BIGINT;
  v_commercial_quantity INTEGER;
  v_subtotal BIGINT := 0;
  v_discount BIGINT := 0;
  v_product public.products%ROWTYPE;
  v_configuration public.product_parcel_configurations%ROWTYPE;
  v_capacity INTEGER;
  v_component_total BIGINT;
  v_invalid_component_count INTEGER;
  v_promotion public.promotion_codes%ROWTYPE;
BEGIN
  -- Reuse the approved Phase-3 canonical line grammar and all bounded input
  -- limits.  The synthetic actor/location fields are validation-only and are
  -- never returned or persisted.
  IF jsonb_typeof(p_lines)='array' THEN
    FOR v_raw_line IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
      IF jsonb_typeof(v_raw_line->'parcel_instances')='array' THEN
        FOR v_instance IN SELECT value FROM jsonb_array_elements(v_raw_line->'parcel_instances') LOOP
          IF jsonb_typeof(v_instance->'components')='array' AND EXISTS(
            SELECT 1 FROM jsonb_array_elements(v_instance->'components') c
            WHERE jsonb_typeof(c->'product_id') IS DISTINCT FROM 'string'
              OR (c->>'product_id') !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$') THEN
            RAISE EXCEPTION USING ERRCODE='22023',
              MESSAGE='PARCEL_COMPONENT_INVALID: هوية النكهة غير صحيحة؛ حدّث الصفحة وأعد المحاولة.';
          END IF;
        END LOOP;
      END IF;
    END LOOP;
  END IF;
  v_request := JSONB_BUILD_OBJECT(
    'contract_version', 'phase3-sale-v1',
    'actor_scope_type', 'guest_gateway',
    'actor_scope_hash', REPEAT('0', 64),
    'operation_source', 'customer_reservation',
    'warehouse_id', '00000000-0000-0000-0000-000000000001',
    'promotion_code', v_promotion_code,
    'order_discount_in_minor_units', 0,
    'lines', p_lines
  );
  v_canonical_request := public.phase3_canonicalize_sale_request_internal(v_request);

  IF EXISTS (
    SELECT 1
    FROM JSONB_ARRAY_ELEMENTS(p_lines) candidate
    GROUP BY public.phase3_customer_line_identity_internal(candidate)
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_SALE_CONTRACT_INVALID: Customer commercial identities must be unique.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM JSONB_ARRAY_ELEMENTS(v_canonical_request->'lines') candidate
    WHERE candidate->>'commercial_line_kind' = 'configurable_parcel'
  ) THEN
    IF p_actor_scope='erp_user' THEN
      PERFORM public.phase3_assert_configurable_parcel_creation_allowed_internal('erp_user',auth.uid());
    ELSIF p_actor_scope IS DISTINCT FROM 'guest_gateway'
      OR public.get_configurable_parcel_feature_state() IS DISTINCT FROM 'ENABLED' THEN
      RAISE EXCEPTION USING ERRCODE='P0001',
        MESSAGE='CONFIGURABLE_PARCEL_DISABLED: Configurable Parcel is unavailable for guest preview.';
    END IF;
  END IF;

  FOR v_line IN
    SELECT value
    FROM JSONB_ARRAY_ELEMENTS(v_canonical_request->'lines')
    ORDER BY value::TEXT
  LOOP
    v_line_kind := v_line->>'commercial_line_kind';
    v_line_identity := public.phase3_customer_line_identity_internal(v_line);

    SELECT raw_line.value
    INTO STRICT v_raw_line
    FROM JSONB_ARRAY_ELEMENTS(p_lines) raw_line(value)
    WHERE public.phase3_customer_line_identity_internal(raw_line.value)
      = v_line_identity;
    v_expected_price := public.phase3_require_nonnegative_bigint_internal(
      v_raw_line->>'expected_unit_price_in_minor_units',
      'expected_unit_price_in_minor_units'
    );

    IF v_line_kind = 'base_unit' THEN
      SELECT * INTO v_product
      FROM public.products product
      WHERE product.id = (v_line->>'product_id')::UUID
        AND product.is_active;
      IF NOT FOUND OR v_product.is_flavor_master THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001',
          MESSAGE = 'PHASE3_CUSTOMER_PRODUCT_INVALID: Base Unit is unavailable.';
      END IF;
      v_commercial_quantity := (v_line->>'base_quantity')::INTEGER;
      v_unit_price := v_product.sale_price_in_minor_units;

    ELSIF v_line_kind = 'legacy_single_sku_parcel' THEN
      SELECT * INTO v_product
      FROM public.products product
      WHERE product.id = (v_line->>'product_id')::UUID
        AND product.is_active;
      IF NOT FOUND
        OR v_product.units_per_sale_unit IS DISTINCT FROM
          (v_line->>'units_per_parcel')::INTEGER
        OR COALESCE(v_product.default_sale_price_in_minor_units, 0) <= 0
      THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001',
          MESSAGE = 'PHASE3_CUSTOMER_PRICE_OR_PACKAGE_STALE: Legacy Parcel changed.';
      END IF;
      v_commercial_quantity := (v_line->>'parcel_quantity')::INTEGER;
      v_unit_price := v_product.default_sale_price_in_minor_units;

    ELSE
      SELECT * INTO v_product
      FROM public.products product
      WHERE product.id = (v_line->>'family_product_id')::UUID
        AND product.is_active;
      IF NOT FOUND OR NOT v_product.is_flavor_master
        OR COALESCE(v_product.default_sale_price_in_minor_units, 0) <= 0
      THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001',
          MESSAGE = 'PHASE3_CUSTOMER_PRICE_OR_PACKAGE_STALE: Configurable Parcel changed.';
      END IF;

      SELECT * INTO v_configuration
      FROM public.product_parcel_configurations configuration
      WHERE configuration.id = (v_line->>'parcel_configuration_id')::UUID;
      IF NOT FOUND
        OR NOT v_configuration.is_active
        OR v_configuration.composition_mode <> 'configurable_mix'
        OR v_configuration.family_product_id IS DISTINCT FROM v_product.id
        OR v_configuration.configuration_revision IS DISTINCT FROM
          (v_line->>'configuration_revision')::INTEGER
      THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001',
          MESSAGE = 'PARCEL_CONFIGURATION_STALE: Parcel configuration is unavailable or changed.';
      END IF;

      v_capacity := v_product.units_per_sale_unit;
      IF COALESCE(v_capacity, 0) <= 0 THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001',
          MESSAGE = 'PARCEL_CONFIGURATION_STALE: Parcel Family capacity is invalid.';
      END IF;

      FOR v_instance IN
        SELECT value
        FROM JSONB_ARRAY_ELEMENTS(v_line->'parcel_instances') instance(value)
        ORDER BY (value->>'instance_sequence')::INTEGER
      LOOP
        v_components := v_instance->'components';
        -- Validate all identifiers before any UUID cast (including the policy
        -- lookup below). SQL evaluation order is not a validation boundary.
        IF EXISTS(SELECT 1 FROM jsonb_array_elements(v_components) c
          WHERE jsonb_typeof(c->'product_id') IS DISTINCT FROM 'string'
            OR (c->>'product_id') !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$') THEN
          RAISE EXCEPTION USING ERRCODE='22023',
            MESSAGE='PARCEL_COMPONENT_INVALID: هوية النكهة غير صحيحة؛ حدّث الصفحة وأعد المحاولة.';
        END IF;
        IF EXISTS(SELECT 1 FROM jsonb_array_elements(v_components) c WHERE NOT EXISTS(
          SELECT 1 FROM public.product_parcel_allowed_components allowed
          WHERE allowed.configuration_id=v_configuration.id AND allowed.product_id=(c->>'product_id')::uuid)) THEN
          RAISE EXCEPTION 'PARCEL_COMPONENT_NOT_ALLOWED: إحدى النكهات غير مسموحة لهذا الطرد';
        END IF;
        SELECT
          SUM((component->>'base_quantity')::BIGINT),
          COUNT(*) FILTER (
            WHERE product.id IS NULL
              OR NOT product.is_active
              OR product.is_flavor_master
              OR COALESCE(product.flavor_master_product_id, product.id)
                IS DISTINCT FROM v_product.id
          )
        INTO v_component_total, v_invalid_component_count
        FROM JSONB_ARRAY_ELEMENTS(v_components) component
        LEFT JOIN public.products product
          ON product.id = (component->>'product_id')::UUID;

        IF v_component_total IS DISTINCT FROM v_capacity::BIGINT THEN
          RAISE EXCEPTION USING ERRCODE = '23514',
            CONSTRAINT = 'phase3_parcel_capacity_check',
            MESSAGE = 'PARCEL_CAPACITY_MISMATCH: Parcel composition must equal configured capacity.';
        END IF;
        IF v_invalid_component_count <> 0 THEN
          RAISE EXCEPTION USING ERRCODE = '23514',
            CONSTRAINT = 'phase3_parcel_component_family_check',
            MESSAGE = 'PARCEL_COMPONENT_FAMILY_MISMATCH: Parcel component is not an eligible stocked SKU.';
        END IF;
      END LOOP;

      v_commercial_quantity := (v_line->>'parcel_quantity')::INTEGER;
      v_unit_price := v_product.default_sale_price_in_minor_units;
    END IF;

    IF v_unit_price IS DISTINCT FROM v_expected_price THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'PHASE3_CUSTOMER_QUOTE_STALE: Commercial price changed.';
    END IF;
    v_subtotal := v_subtotal + v_commercial_quantity::BIGINT * v_unit_price;
  END LOOP;

  IF v_promotion_code IS NOT NULL THEN
    IF v_phone IS NULL OR v_phone !~ '^07[789][0-9]{7}$' THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'PHASE3_CUSTOMER_INPUT_INVALID: Customer phone is required for promotion eligibility.';
    END IF;

    -- Deliberately no FOR UPDATE: preview observes current eligibility but does
    -- not reserve quota.  Final V2 checkout owns authoritative locking.
    SELECT * INTO v_promotion
    FROM public.promotion_codes promotion
    WHERE promotion.code = v_promotion_code;
    IF NOT FOUND OR NOT v_promotion.is_active
      OR (v_promotion.starts_at IS NOT NULL AND NOW() < v_promotion.starts_at)
      OR (v_promotion.expires_at IS NOT NULL AND NOW() >= v_promotion.expires_at)
      OR v_subtotal < v_promotion.minimum_subtotal_in_minor_units
    THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'PHASE3_CUSTOMER_PROMOTION_INVALID: Promotion is unavailable.';
    END IF;
    IF v_promotion.maximum_total_redemptions IS NOT NULL AND (
      SELECT COUNT(*)
      FROM public.promotion_redemptions redemption
      WHERE redemption.promotion_code_id = v_promotion.id
    ) >= v_promotion.maximum_total_redemptions THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'PHASE3_CUSTOMER_PROMOTION_INVALID: Promotion is exhausted.';
    END IF;
    IF (
      SELECT COUNT(*)
      FROM public.promotion_redemptions redemption
      WHERE redemption.promotion_code_id = v_promotion.id
        AND redemption.customer_phone = v_phone
    ) >= v_promotion.maximum_redemptions_per_phone THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'PHASE3_CUSTOMER_PROMOTION_INVALID: Promotion is unavailable for this customer.';
    END IF;

    IF v_promotion.discount_type = 'fixed' THEN
      v_discount := LEAST(v_promotion.discount_value, v_subtotal);
    ELSE
      v_discount := FLOOR(
        v_subtotal::NUMERIC * v_promotion.discount_value / 10000
      )::BIGINT;
      IF v_promotion.maximum_discount_in_minor_units IS NOT NULL THEN
        v_discount := LEAST(
          v_discount, v_promotion.maximum_discount_in_minor_units
        );
      END IF;
    END IF;
    v_discount := LEAST(GREATEST(v_discount, 0), v_subtotal);
  END IF;

  RETURN JSONB_BUILD_OBJECT(
    'success', true,
    'contractVersion', 'phase3-customer-promotion-preview-v2',
    'merchandiseSubtotalInMinorUnits', v_subtotal,
    'promotionDiscountInMinorUnits', v_discount,
    'finalMerchandiseTotalInMinorUnits', v_subtotal - v_discount,
    'promotion', CASE WHEN v_promotion_code IS NULL THEN NULL ELSE JSONB_BUILD_OBJECT(
      'code', v_promotion.code,
      'descriptionAr', v_promotion.description_ar
    ) END
  );
END;
$lite2_preview$;
 REVOKE ALL ON FUNCTION sales_lite2.preview(jsonb,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
 -- QUARANTINED phase2. Installed only after the local219 guard in commercialSql.
-- Private monetary planner: no movements, inventory locks, costs or writes.
CREATE FUNCTION sales_lite2.plan(
 p_lines JSONB,p_channel TEXT,p_discount BIGINT DEFAULT 0,
 p_promotion TEXT DEFAULT NULL,p_phone TEXT DEFAULT NULL,p_delivery_zone TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,extensions AS $plan$
DECLARE
 canonical JSONB;line JSONB;quoted JSONB:='[]';quote JSONB;
 product public.products;settings public.storefront_settings;
 price BIGINT;quantity INTEGER;size INTEGER;gross BIGINT;subtotal BIGINT:=0;
 discount BIGINT;delivery BIGINT:=0;seq INTEGER:=0;weights JSONB;
 result_lines JSONB:='[]';plan_lines JSONB:='[]';allocation BIGINT;
 instance JSONB;instances JSONB;instance_weights JSONB;instance_discount BIGINT;
BEGIN
 IF p_channel IS NULL OR p_channel NOT IN('admin_pos','customer_v2') THEN RAISE EXCEPTION 'LITE2_CHANNEL_INVALID';END IF;
 IF p_discount IS NULL OR p_discount<0 OR(p_channel='admin_pos' AND p_promotion IS NOT NULL)
 OR(p_channel='customer_v2' AND p_discount<>0) THEN RAISE EXCEPTION 'LITE2_DISCOUNT_CONTEXT_INVALID';END IF;
 canonical:=public.phase3_canonicalize_sale_request_internal(jsonb_build_object(
  'contract_version','phase3-sale-v1','actor_scope_type',CASE WHEN p_channel='admin_pos' THEN 'erp_user' ELSE 'guest_gateway' END,
  'actor_scope_hash',repeat('0',64),'operation_source',CASE WHEN p_channel='admin_pos' THEN 'admin_pos' ELSE 'customer_reservation' END,
  'warehouse_id','00000000-0000-0000-0000-000000000001','order_discount_in_minor_units',p_discount,'lines',p_lines));
 FOR line IN SELECT value FROM jsonb_array_elements(canonical->'lines') ORDER BY value::TEXT LOOP
  IF line->>'price_authority'<>'server_catalog' OR(line->>'line_discount_in_minor_units')::BIGINT<>0 THEN RAISE EXCEPTION 'LITE2_SERVER_PRICE_REQUIRED';END IF;
  SELECT * INTO product FROM public.products WHERE id=COALESCE(line->>'product_id',line->>'family_product_id')::UUID AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'PHASE3_CUSTOMER_PRODUCT_INVALID';END IF;
  IF line->>'commercial_line_kind'='base_unit' THEN
   IF public.parcel209_effective_only_internal(product.id) THEN RAISE EXCEPTION 'PARCEL209_UNIT_SALE_FORBIDDEN';END IF;
   price:=product.sale_price_in_minor_units;quantity:=(line->>'base_quantity')::INTEGER;size:=1;
  ELSE
   price:=product.default_sale_price_in_minor_units;quantity:=(line->>'parcel_quantity')::INTEGER;size:=product.units_per_sale_unit;
  END IF;
  IF price IS NULL OR price<0 THEN RAISE EXCEPTION 'LITE2_PRICE_INVALID';END IF;
  gross:=price*quantity::BIGINT;subtotal:=subtotal+gross;
  -- Preview reuses the exact existing family/configuration/capacity/price and
  -- promotion checks. POS has no promotion-code contract. Guest keeps original
  -- expected-price evidence, so a stale quote cannot be silently corrected.
  IF p_channel='admin_pos' THEN quoted:=quoted||jsonb_build_array(line||jsonb_build_object('expected_unit_price_in_minor_units',price));END IF;
  seq:=seq+1;
  plan_lines:=plan_lines||jsonb_build_array(jsonb_build_object(
   'line_sequence',seq,'line',line,'product_id',product.id,'commercial_line_kind',line->>'commercial_line_kind',
   'commercial_quantity',quantity,'base_quantity',quantity::BIGINT*size,'units_per_parcel',size,
   'unit_price_in_minor_units',price,'gross_amount_in_minor_units',gross));
 END LOOP;
 quote:=sales_lite2.preview(CASE WHEN p_channel='admin_pos' THEN quoted ELSE p_lines END,p_promotion,p_phone,CASE WHEN p_channel='admin_pos' THEN 'erp_user' ELSE 'guest_gateway' END);
 IF(quote->>'merchandiseSubtotalInMinorUnits')::BIGINT IS DISTINCT FROM subtotal THEN RAISE EXCEPTION 'LITE2_INTERNAL_PRICE_MISMATCH';END IF;
 discount:=CASE WHEN p_channel='admin_pos' THEN p_discount ELSE(quote->>'promotionDiscountInMinorUnits')::BIGINT END;
 IF discount>subtotal THEN RAISE EXCEPTION 'PHASE3_POS_DISCOUNT_EXCEEDS_SUBTOTAL';END IF;
 IF p_channel='customer_v2' THEN
  IF p_delivery_zone IS NULL OR p_delivery_zone NOT IN('inside_ramtha','outside_ramtha') THEN RAISE EXCEPTION 'LITE2_DELIVERY_ZONE_INVALID';END IF;
  SELECT * INTO settings FROM public.storefront_settings WHERE id='00000000-0000-0000-0000-000000000001' FOR SHARE;
  IF NOT FOUND OR NOT settings.orders_enabled THEN RAISE EXCEPTION 'PHASE3_CUSTOMER_ORDERS_DISABLED';END IF;
  IF subtotal<settings.minimum_order_in_minor_units THEN RAISE EXCEPTION 'PHASE3_CUSTOMER_MINIMUM_ORDER_NOT_MET';END IF;
  delivery:=CASE p_delivery_zone WHEN 'inside_ramtha' THEN settings.inside_ramtha_delivery_fee_in_minor_units ELSE settings.outside_ramtha_delivery_fee_in_minor_units END;
 ELSIF p_delivery_zone IS NOT NULL THEN RAISE EXCEPTION 'LITE2_POS_DELIVERY_INVALID';END IF;
 SELECT jsonb_agg(jsonb_build_object('key',value->>'line_sequence','weight',(value->>'gross_amount_in_minor_units')::BIGINT) ORDER BY(value->>'line_sequence')::INTEGER) INTO weights FROM jsonb_array_elements(plan_lines);
 FOR line IN SELECT value FROM jsonb_array_elements(plan_lines) ORDER BY(value->>'line_sequence')::INTEGER LOOP
  SELECT allocated_amount INTO allocation FROM public.phase2_allocate_largest_remainder_internal(discount,weights) WHERE allocation_key=line->>'line_sequence';
  instances:='[]';
  IF line->>'commercial_line_kind'='configurable_parcel' THEN
   SELECT jsonb_agg(jsonb_build_object('key',value->>'instance_sequence','weight',(line->>'unit_price_in_minor_units')::BIGINT) ORDER BY(value->>'instance_sequence')::INTEGER) INTO instance_weights FROM jsonb_array_elements(line#>'{line,parcel_instances}');
   FOR instance IN SELECT value FROM jsonb_array_elements(line#>'{line,parcel_instances}') ORDER BY(value->>'instance_sequence')::INTEGER LOOP
    SELECT allocated_amount INTO instance_discount FROM public.phase2_allocate_largest_remainder_internal(allocation,instance_weights) WHERE allocation_key=instance->>'instance_sequence';
    instances:=instances||jsonb_build_array(instance||jsonb_build_object('gross_amount_in_minor_units',(line->>'unit_price_in_minor_units')::BIGINT,'allocated_discount_in_minor_units',instance_discount,'net_refundable_amount_in_minor_units',(line->>'unit_price_in_minor_units')::BIGINT-instance_discount));
   END LOOP;
  END IF;
  result_lines:=result_lines||jsonb_build_array(line||jsonb_build_object('allocated_discount_in_minor_units',allocation,'net_refundable_amount_in_minor_units',(line->>'gross_amount_in_minor_units')::BIGINT-allocation,'parcel_instances',instances));
 END LOOP;
 RETURN jsonb_build_object('subtotalInMinorUnits',subtotal,'discountInMinorUnits',discount,'deliveryFeeInMinorUnits',delivery,'totalInMinorUnits',subtotal-discount+delivery,'lines',result_lines);
END $plan$;
REVOKE ALL ON FUNCTION sales_lite2.plan(JSONB,TEXT,BIGINT,TEXT,TEXT,TEXT) FROM PUBLIC,anon,authenticated,service_role;

-- QUARANTINED. New writer, same public ledger; no frozen219 function replaced.
CREATE TABLE sales_lite2.sales(
 order_id UUID PRIMARY KEY REFERENCES sales_lite1.orders(order_id),
 request_key TEXT NOT NULL UNIQUE REFERENCES sales_lite1.requests(key),
 plan JSONB NOT NULL,initial_payment_id UUID REFERENCES public.customer_payments(id),
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE sales_lite2.sales ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE sales_lite2.sales FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER lite2_immutable BEFORE UPDATE OR DELETE ON sales_lite2.sales FOR EACH ROW EXECUTE FUNCTION sales_lite1.immutable();
CREATE TRIGGER lite2_no_truncate BEFORE TRUNCATE ON sales_lite2.sales FOR EACH STATEMENT EXECUTE FUNCTION sales_lite1.immutable();

-- Shared only by the new lite writers. Original full writers stay frozen.
CREATE FUNCTION sales_lite2.materialize(p_order UUID,p_operation UUID,p_plan JSONB,p_channel TEXT,p_phone TEXT DEFAULT NULL,p_promotion TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,extensions AS $materialize$
DECLARE
 oid UUID:=p_order;op UUID:=p_operation;plan JSONB:=p_plan;
 line JSONB;instance JSONB;component JSONB;item JSONB;items JSONB:='[]';instances JSONB;proof_lines JSONB:='[]';proof_instances JSONB;proof_components JSONB;
 product public.products;leaf public.products;item_id UUID;instance_id UUID;component_id UUID;
 base_name TEXT;parcel_name TEXT;stored_quantity INTEGER;effective_price BIGINT;
BEGIN
 IF NOT sales_lite1.is_order(oid) OR p_channel NOT IN('admin_pos','customer_v2') THEN RAISE EXCEPTION 'LITE2_MATERIALIZE_CONTEXT_INVALID';END IF;
 FOR line IN SELECT value FROM jsonb_array_elements(plan->'lines') ORDER BY(value->>'line_sequence')::INTEGER LOOP
  SELECT * INTO STRICT product FROM public.products WHERE id=(line->>'product_id')::UUID;
  SELECT name_ar INTO base_name FROM public.units WHERE id=product.unit_id;
  SELECT name_ar INTO parcel_name FROM public.units WHERE id=product.sale_unit_id;
  base_name:=COALESCE(base_name,'وحدة');parcel_name:=CASE WHEN line->>'commercial_line_kind'='base_unit' THEN base_name ELSE COALESCE(parcel_name,'طرد') END;
  item_id:=gen_random_uuid();stored_quantity:=CASE WHEN line->>'commercial_line_kind'='configurable_parcel' THEN(line->>'commercial_quantity')::INTEGER ELSE(line->>'base_quantity')::INTEGER END;
  INSERT INTO public.order_items(id,order_id,product_id,product_name_snapshot,sku_snapshot,quantity,unit_price_in_minor_units,line_total_in_minor_units,
   sale_package_quantity,units_per_sale_package,sale_package_name_snapshot,sale_package_price_in_minor_units,commercial_line_kind,
   family_product_id,parcel_configuration_id,parcel_configuration_revision,base_unit_name_snapshot,allocated_discount_snapshot_in_minor_units,net_refundable_amount_snapshot_in_minor_units)
  VALUES(item_id,oid,product.id,product.name_ar,product.sku,stored_quantity,(line->>'unit_price_in_minor_units')::BIGINT,(line->>'gross_amount_in_minor_units')::BIGINT,
   (line->>'commercial_quantity')::INTEGER,(line->>'units_per_parcel')::INTEGER,parcel_name,(line->>'unit_price_in_minor_units')::BIGINT,line->>'commercial_line_kind',
   CASE WHEN line->>'commercial_line_kind'='configurable_parcel' THEN product.id END,NULLIF(line#>>'{line,parcel_configuration_id}','')::UUID,NULLIF(line#>>'{line,configuration_revision}','')::INTEGER,
   base_name,(line->>'allocated_discount_in_minor_units')::BIGINT,(line->>'net_refundable_amount_in_minor_units')::BIGINT);
  instances:='[]';proof_instances:='[]';
  FOR instance IN SELECT value FROM jsonb_array_elements(line->'parcel_instances') ORDER BY(value->>'instance_sequence')::INTEGER LOOP
   PERFORM public.phase3_assert_configurable_parcel_creation_allowed_internal(CASE WHEN p_channel='admin_pos' THEN 'erp_user' ELSE 'guest_gateway' END,CASE WHEN p_channel='admin_pos' THEN auth.uid() ELSE NULL END);
   instance_id:=gen_random_uuid();
   INSERT INTO public.order_parcel_instances(id,order_item_id,order_id,operation_id,parcel_configuration_id,family_product_id,instance_sequence,configuration_revision,
    units_per_parcel_snapshot,parcel_unit_name_snapshot,gross_amount_snapshot_in_minor_units,allocated_discount_snapshot_in_minor_units,net_refundable_amount_snapshot_in_minor_units,cogs_snapshot_in_minor_units,composition_fingerprint)
   VALUES(instance_id,item_id,oid,op,(line#>>'{line,parcel_configuration_id}')::UUID,product.id,(instance->>'instance_sequence')::INTEGER,(line#>>'{line,configuration_revision}')::INTEGER,
    (line->>'units_per_parcel')::INTEGER,parcel_name,(instance->>'gross_amount_in_minor_units')::BIGINT,(instance->>'allocated_discount_in_minor_units')::BIGINT,(instance->>'net_refundable_amount_in_minor_units')::BIGINT,0,
    public.phase3_request_fingerprint_internal(public.phase3_canonicalize_components_internal(instance->'components')));
   proof_components:='[]';
   FOR component IN SELECT value FROM jsonb_array_elements(instance->'components') ORDER BY(value->>'product_id')::UUID LOOP
    SELECT * INTO STRICT leaf FROM public.products WHERE id=(component->>'product_id')::UUID;
    effective_price:=public.phase4_effective_standalone_unit_price_internal(leaf.id,p_channel,p_phone,p_promotion);
    component_id:=gen_random_uuid();
    INSERT INTO public.order_parcel_components(id,parcel_instance_id,operation_id,product_id,base_quantity,product_name_snapshot,sku_snapshot,base_unit_name_snapshot,unit_cost_snapshot_in_minor_units,cogs_snapshot_in_minor_units)
    VALUES(component_id,instance_id,op,leaf.id,(component->>'base_quantity')::INTEGER,leaf.name_ar,leaf.sku,base_name,0,0);
    proof_components:=proof_components||jsonb_build_array(component||jsonb_build_object('component_id',component_id,'product_name_snapshot',leaf.name_ar,'sku_snapshot',leaf.sku,'base_unit_name_snapshot',base_name,'effectiveStandaloneUnitPriceInMinorUnits',effective_price));
   END LOOP;
   PERFORM public.finalize_order_parcel_instance_internal(instance_id);
   instances:=instances||jsonb_build_array(instance||jsonb_build_object('instance_id',instance_id,'components',proof_components,'configuration_revision',(line#>>'{line,configuration_revision}')::INTEGER,'units_per_parcel',(line->>'units_per_parcel')::INTEGER));
   proof_instances:=proof_instances||jsonb_build_array(instance||jsonb_build_object('instance_id',instance_id,'components',proof_components));
  END LOOP;
  effective_price:=CASE WHEN line->>'commercial_line_kind'='legacy_single_sku_parcel' THEN public.phase4_effective_standalone_unit_price_internal(product.id,p_channel,p_phone,p_promotion) ELSE NULL END;
  proof_lines:=proof_lines||jsonb_build_array(line||jsonb_build_object('orderItemId',item_id,'parcel_instances',proof_instances,'effectiveStandaloneUnitPriceInMinorUnits',effective_price));
  item:=jsonb_build_object('id',item_id,'productId',product.id,'productName',product.name_ar,'sku',product.sku,'commercialLineKind',line->>'commercial_line_kind',
   'quantity',(line->>'commercial_quantity')::INTEGER,'baseQuantity',(line->>'base_quantity')::INTEGER,'unitsPerSalePackage',(line->>'units_per_parcel')::INTEGER,'salePackage',parcel_name,
   'unitPriceInMinorUnits',(line->>'unit_price_in_minor_units')::BIGINT,'lineTotalInMinorUnits',(line->>'gross_amount_in_minor_units')::BIGINT,
   'allocatedDiscountInMinorUnits',(line->>'allocated_discount_in_minor_units')::BIGINT,'netRefundableAmountInMinorUnits',(line->>'net_refundable_amount_in_minor_units')::BIGINT,'parcelInstances',instances,'accountingTracked',false);
  items:=items||jsonb_build_array(item);
 END LOOP;
 RETURN jsonb_build_object('items',items,'lines',proof_lines);
END $materialize$;
REVOKE ALL ON FUNCTION sales_lite2.materialize(UUID,UUID,JSONB,TEXT,TEXT,TEXT) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION sales_lite2.pos(p_request JSONB,p_key TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,extensions AS $pos$
DECLARE
 replay JSONB;plan JSONB;line JSONB;instance JSONB;component JSONB;
 result JSONB;items JSONB:='[]';item JSONB;instances JSONB;proof_lines JSONB:='[]';proof_instances JSONB;proof_components JSONB;
 product public.products;leaf public.products;customer public.customers;
 bid UUID;wid UUID;cid UUID;shift_id UUID;oid UUID:=gen_random_uuid();op UUID:=gen_random_uuid();item_id UUID;instance_id UUID;component_id UUID;
 ids UUID[];unavailable UUID[]:='{}';pid UUID;name TEXT;method TEXT;paid BIGINT:=0;received BIGINT;change_due BIGINT:=0;
 payment JSONB;initial_method TEXT;initial_id UUID;initial_reference TEXT;initial_amount BIGINT;
 base_name TEXT;parcel_name TEXT;stored_quantity INTEGER;effective_price BIGINT;
BEGIN
 PERFORM sales_lite1.owner();
 IF jsonb_typeof(p_request) IS DISTINCT FROM 'object' OR octet_length(p_request::TEXT)>65536
 OR(p_request-ARRAY['branchId','warehouseId','customerId','customerName','paymentMethod','lines','discountInMinorUnits','amountReceivedInMinorUnits','initialPayment','unavailableConfirmed'])<>'{}'::JSONB THEN RAISE EXCEPTION 'LITE2_REQUEST_INVALID';END IF;
 -- Preserve the raw-key coordinator used by the existing POS/partial writers,
 -- in addition to the private sealed-request guard introduced by phase1.
 PERFORM pg_advisory_xact_lock(hashtext(p_key));
 replay:=sales_lite1.lock_request(p_key,'pos2',p_request);IF replay IS NOT NULL THEN RETURN replay;END IF;
 IF EXISTS(SELECT 1 FROM public.pos_uncommitted_attempt_cancellations WHERE actor_id=auth.uid() AND idempotency_key=p_key) THEN RAISE EXCEPTION 'PACKAGE_D_POS_ATTEMPT_CANCELLED';END IF;
 bid:=(p_request->>'branchId')::UUID;wid:=(p_request->>'warehouseId')::UUID;cid:=NULLIF(p_request->>'customerId','')::UUID;
 method:=p_request->>'paymentMethod';received:=COALESCE((p_request->>'amountReceivedInMinorUnits')::BIGINT,0);
 IF method IS NULL OR method NOT IN('cash','cliq','debt') OR received<0 THEN RAISE EXCEPTION 'PHASE3_POS_PAYMENT_METHOD_INVALID';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.branches WHERE id=bid AND is_active)
 OR NOT EXISTS(SELECT 1 FROM public.warehouses WHERE id=wid AND branch_id=bid AND is_active) THEN RAISE EXCEPTION 'PHASE3_POS_LOCATION_INVALID';END IF;
 IF cid IS NOT NULL THEN
  SELECT * INTO customer FROM public.customers WHERE id=cid AND is_active AND NOT is_deleted AND NOT is_blocked FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PHASE3_POS_CUSTOMER_INVALID';END IF;name:=customer.full_name;
 ELSE name:=COALESCE(NULLIF(btrim(p_request->>'customerName'),''),'زبون نقدي');END IF;
 IF length(name)>120 THEN RAISE EXCEPTION 'LITE2_CUSTOMER_NAME_INVALID';END IF;
 IF method='debt' AND cid IS NULL THEN RAISE EXCEPTION 'PHASE3_POS_DEBT_CUSTOMER_REQUIRED';END IF;
 SELECT id INTO shift_id FROM public.cash_shifts WHERE branch_id=bid AND status='open' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'PHASE3_POS_OPEN_SHIFT_REQUIRED';END IF;
 -- Validate/canonicalize first, then lock all products+parents in stable order
 -- and re-read commercial truth. No inventory rows or quantities are touched.
 plan:=sales_lite2.plan(p_request->'lines','admin_pos',COALESCE((p_request->>'discountInMinorUnits')::BIGINT,0));
 SELECT array_agg(DISTINCT id ORDER BY id) INTO ids FROM(
  SELECT(value->>'product_id')::UUID id FROM jsonb_array_elements(plan->'lines')
  UNION SELECT(c->>'product_id')::UUID FROM jsonb_array_elements(plan->'lines') l CROSS JOIN LATERAL jsonb_array_elements(l->'parcel_instances') i CROSS JOIN LATERAL jsonb_array_elements(i->'components') c
 ) x;
 PERFORM 1 FROM public.products WHERE id=ANY(ids) OR id IN(SELECT flavor_master_product_id FROM public.products WHERE id=ANY(ids)) ORDER BY id FOR UPDATE;
 plan:=sales_lite2.plan(p_request->'lines','admin_pos',COALESCE((p_request->>'discountInMinorUnits')::BIGINT,0));
 IF p_request?'unavailableConfirmed' AND jsonb_typeof(p_request->'unavailableConfirmed')<>'array' THEN RAISE EXCEPTION 'LITE2_CONFIRMATION_INVALID';END IF;
 FOREACH pid IN ARRAY ids LOOP
  IF NOT sales_lite1.available(pid) THEN
   IF NOT COALESCE(p_request->'unavailableConfirmed' @> jsonb_build_array(pid),false) THEN RAISE EXCEPTION 'LITE1_UNAVAILABLE_CONFIRM_REQUIRED';END IF;
   unavailable:=array_append(unavailable,pid);
  END IF;
 END LOOP;
 IF p_request?'initialPayment' THEN
  IF method<>'debt' OR jsonb_typeof(p_request->'initialPayment')<>'object'
  OR((p_request->'initialPayment')-ARRAY['amountInMinorUnits','method','referenceNumber'])<>'{}'::JSONB THEN RAISE EXCEPTION 'POS216_INITIAL_PAYMENT_INVALID';END IF;
  initial_amount:=(p_request#>>'{initialPayment,amountInMinorUnits}')::BIGINT;initial_method:=p_request#>>'{initialPayment,method}';initial_reference:=NULLIF(btrim(p_request#>>'{initialPayment,referenceNumber}'),'');
  IF initial_amount IS NULL OR initial_amount<=0 OR initial_amount>=(plan->>'totalInMinorUnits')::BIGINT OR initial_method IS NULL OR initial_method NOT IN('cash','cliq') OR length(COALESCE(initial_reference,''))>200 THEN RAISE EXCEPTION 'POS216_INITIAL_PAYMENT_INVALID';END IF;
 ELSIF method IN('cash','cliq') THEN paid:=(plan->>'totalInMinorUnits')::BIGINT;END IF;
 IF method='cash' AND received>0 AND received<paid THEN RAISE EXCEPTION 'PHASE3_POS_TENDER_INSUFFICIENT';END IF;
 IF method='cash' THEN change_due:=GREATEST(received-paid,0);END IF;
 -- Immutable operation envelope is inserted once, like the phase1 contract.
 -- The sealed request stores the complete DTO (including the subsequently
 -- generated partial-payment ID). Never UPDATE immutable business history.
 INSERT INTO public.business_operations(id,operation_type,idempotency_key,request_fingerprint,initiated_by,result_snapshot,completed_at)
 VALUES(op,'lite1_pos',p_key,(SELECT fingerprint FROM sales_lite1.requests WHERE key=p_key),auth.uid(),
  jsonb_build_object('success',true,'orderId',oid,'operationId',op,'contractVersion','lite2-pos-v1','totalInMinorUnits',(plan->>'totalInMinorUnits')::BIGINT,'accountingTracked',false),now());
 INSERT INTO sales_lite1.orders VALUES(oid,op,'{}',unavailable);
 INSERT INTO public.orders(id,order_number,customer_id,customer_name_snapshot,branch_id,warehouse_id,status,payment_method,payment_status,
  subtotal_in_minor_units,discount_in_minor_units,total_in_minor_units,amount_paid_in_minor_units,change_due_in_minor_units,source,idempotency_key,operation_id,cash_shift_id)
 VALUES(oid,'L2-'||oid::TEXT,cid,name,bid,wid,'completed',method,CASE WHEN method='debt' THEN 'unpaid' ELSE 'paid' END,
  (plan->>'subtotalInMinorUnits')::BIGINT,(plan->>'discountInMinorUnits')::BIGINT,(plan->>'totalInMinorUnits')::BIGINT,paid,change_due,'pos',p_key,op,shift_id);
 INSERT INTO sales_lite1.completions(order_id) VALUES(oid);
 result:=sales_lite2.materialize(oid,op,plan,'admin_pos');items:=result->'items';proof_lines:=result->'lines';
 IF initial_amount IS NOT NULL THEN
  payment:=public.record_customer_order_payment_once(oid,initial_amount,initial_method,initial_reference,NULL,'lite2-initial-'||op::TEXT);
  initial_id:=(payment->>'payment_id')::UUID;paid:=initial_amount;
 END IF;
 result:=jsonb_build_object('success',true,'idempotentReplay',false,'orderId',oid,'operationId',op,'orderNumber','L2-'||oid::TEXT,'warehouseId',wid,'branchId',bid,'cashShiftId',shift_id,
  'customerName',name,'subtotalInMinorUnits',(plan->>'subtotalInMinorUnits')::BIGINT,'discountInMinorUnits',(plan->>'discountInMinorUnits')::BIGINT,'totalInMinorUnits',(plan->>'totalInMinorUnits')::BIGINT,
  'amountPaidInMinorUnits',paid,'changeDueInMinorUnits',change_due,'remainingInMinorUnits',(plan->>'totalInMinorUnits')::BIGINT-paid,'paymentMethod',method,
  'paymentStatus',CASE WHEN initial_amount IS NOT NULL THEN 'partially_paid' WHEN method='debt' THEN 'unpaid' ELSE 'paid' END,'items',items,'unavailableConfirmed',to_jsonb(unavailable),'accountingTracked',false);
 IF initial_id IS NOT NULL THEN result:=result||jsonb_build_object('initialPaymentMethod',initial_method,'initialPaymentId',initial_id);END IF;
 INSERT INTO sales_lite2.sales(order_id,request_key,plan,initial_payment_id) VALUES(oid,p_key,plan||jsonb_build_object('lines',proof_lines),initial_id);
 INSERT INTO public.audit_logs(user_id,action,entity_name,entity_id,details) VALUES(auth.uid(),'LITE2_POS','orders',oid,jsonb_build_object('operationId',op,'unavailableConfirmed',to_jsonb(unavailable)));
 RETURN sales_lite1.finish(p_key,result);
END $pos$;
REVOKE ALL ON FUNCTION sales_lite2.pos(JSONB,TEXT) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.lite1_pos2(p_request JSONB,p_key TEXT) RETURNS JSONB
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$ SELECT sales_lite2.pos(p_request,p_key) $$;
REVOKE ALL ON FUNCTION public.lite1_pos2(JSONB,TEXT) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.lite1_pos2(JSONB,TEXT) TO authenticated;

-- New contract adapter only. The full attempt/cancellation functions stay
-- byte-identical; their existing immutable cancellation table is reused.
CREATE FUNCTION public.lite1_pos2_attempt_state(p_idempotency_key TEXT,p_request_fingerprint TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $state$
DECLARE r sales_lite1.requests;
BEGIN
 PERFORM sales_lite1.owner();
 IF p_idempotency_key IS NULL OR length(p_idempotency_key) NOT BETWEEN 16 AND 128 OR p_idempotency_key<>btrim(p_idempotency_key)
 OR p_request_fingerprint IS NULL OR p_request_fingerprint!~'^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'PACKAGE_D_POS_ATTEMPT_IDENTITY_INVALID';END IF;
 PERFORM pg_advisory_xact_lock(hashtext(p_idempotency_key));
 SELECT * INTO r FROM sales_lite1.requests WHERE key=p_idempotency_key;
 IF FOUND THEN
  IF r.actor IS DISTINCT FROM auth.uid() OR r.kind<>'pos2' OR r.result IS NULL THEN RAISE EXCEPTION 'PHASE3_IDEMPOTENCY_CONFLICT';END IF;
  RETURN jsonb_build_object('state','EXISTS','actorId',auth.uid(),'idempotencyKey',p_idempotency_key,'requestFingerprint',p_request_fingerprint);
 END IF;
 RETURN public.get_pos_sale_attempt_state_v1(p_idempotency_key,p_request_fingerprint);
END $state$;
REVOKE ALL ON FUNCTION public.lite1_pos2_attempt_state(TEXT,TEXT) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.lite1_pos2_attempt_state(TEXT,TEXT) TO authenticated;

CREATE FUNCTION public.lite1_cancel_pos2_attempt(p_idempotency_key TEXT,p_request_fingerprint TEXT,p_confirmed BOOLEAN)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $cancel$
DECLARE r JSONB;
BEGIN
 IF p_confirmed IS DISTINCT FROM true THEN RAISE EXCEPTION 'PACKAGE_D_POS_CANCEL_CONFIRMATION_REQUIRED';END IF;
 r:=public.lite1_pos2_attempt_state(p_idempotency_key,p_request_fingerprint);
 IF r->>'state'='EXISTS' THEN RAISE EXCEPTION 'PACKAGE_D_POS_ATTEMPT_COMMITTED';END IF;
 -- Same transaction and reentrant raw-key lock: an ABSENT observation alone
 -- never permits a new key. The original cancellation writer seals the proof.
 RETURN public.cancel_uncommitted_pos_sale_attempt_v1(p_idempotency_key,p_request_fingerprint,true);
END $cancel$;
REVOKE ALL ON FUNCTION public.lite1_cancel_pos2_attempt(TEXT,TEXT,BOOLEAN) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.lite1_cancel_pos2_attempt(TEXT,TEXT,BOOLEAN) TO authenticated;

-- QUARANTINED phase2: same gateway envelope and ledger;no full writer replaced.
CREATE FUNCTION sales_lite2.guest(p_request JSONB,p_key TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,extensions AS $guest$
<<guest_context>>
DECLARE
 replay JSONB;plan JSONB;materialized JSONB;result JSONB;recipient JSONB;
 phone TEXT;name TEXT;method TEXT;zone TEXT;promotion TEXT;field TEXT;limit_length INTEGER;
 customer public.customers;cid UUID;bid UUID;wid UUID;oid UUID:=gen_random_uuid();op UUID:=gen_random_uuid();address_id UUID:=gen_random_uuid();tracking UUID:=gen_random_uuid();
 ids UUID[];pid UUID;promo_id UUID;reused BOOLEAN:=false;maps TEXT;lat DOUBLE PRECISION;lon DOUBLE PRECISION;recent INTEGER;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'PHASE3_ACTOR_NOT_AUTHORIZED';END IF;
 IF jsonb_typeof(p_request) IS DISTINCT FROM 'object' OR octet_length(p_request::TEXT)>65536
 OR(p_request-ARRAY['phoneHash','sessionHash','recipient','lines','promotionCode','paymentMethod','deliveryZone','expectedQuote'])<>'{}'::JSONB
 OR p_key IS NULL OR p_key!~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
 OR COALESCE(p_request->>'phoneHash','')!~'^[0-9a-f]{64}$' OR COALESCE(p_request->>'sessionHash','')!~'^[0-9a-f]{64}$'
 THEN RAISE EXCEPTION 'PHASE3_IDEMPOTENCY_INPUT_INVALID';END IF;
 recipient:=p_request->'recipient';
 IF jsonb_typeof(recipient) IS DISTINCT FROM 'object' OR(recipient-ARRAY['fullName','phone','governorate','city','area','street','building','addressNotes','googleMapsUrl','latitude','longitude','customerNotes'])<>'{}'::JSONB THEN RAISE EXCEPTION 'PHASE3_CUSTOMER_INPUT_INVALID';END IF;
 name:=btrim(recipient->>'fullName');phone:=public.normalize_customer_phone(recipient->>'phone');
 IF name IS NULL OR length(name) NOT BETWEEN 2 AND 120 OR phone IS NULL OR phone!~'^07[789][0-9]{7}$' THEN RAISE EXCEPTION 'PHASE3_CUSTOMER_INPUT_INVALID';END IF;
 FOREACH field IN ARRAY ARRAY['governorate','city','area','street','building','addressNotes','customerNotes'] LOOP
  limit_length:=CASE field WHEN 'governorate' THEN 80 WHEN 'city' THEN 80 WHEN 'area' THEN 120 WHEN 'street' THEN 300 WHEN 'building' THEN 120 WHEN 'addressNotes' THEN 500 ELSE 1000 END;
  IF(field IN('governorate','city','area','street') AND NULLIF(btrim(recipient->>field),'') IS NULL)
  OR length(COALESCE(btrim(recipient->>field),''))>limit_length THEN RAISE EXCEPTION 'PHASE3_CUSTOMER_INPUT_INVALID';END IF;
 END LOOP;
 lat:=(recipient->>'latitude')::DOUBLE PRECISION;lon:=(recipient->>'longitude')::DOUBLE PRECISION;
 IF(lat IS NULL)<>(lon IS NULL) OR(lat IS NOT NULL AND(lat NOT BETWEEN -90 AND 90 OR lon NOT BETWEEN -180 AND 180)) THEN RAISE EXCEPTION 'PHASE3_CUSTOMER_INPUT_INVALID';END IF;
 maps:=COALESCE(NULLIF(btrim(recipient->>'googleMapsUrl'),''),CASE WHEN lat IS NOT NULL THEN 'https://www.google.com/maps?q='||lat::TEXT||','||lon::TEXT END);
 IF maps IS NOT NULL AND(length(maps)>1000 OR maps!~*'^https://') THEN RAISE EXCEPTION 'PHASE3_CUSTOMER_INPUT_INVALID';END IF;
 method:=lower(btrim(p_request->>'paymentMethod'));zone:=lower(btrim(p_request->>'deliveryZone'));promotion:=upper(NULLIF(btrim(p_request->>'promotionCode'),''));
 IF method IS NULL OR method NOT IN('cash_on_delivery','cliq') OR zone IS NULL OR zone NOT IN('inside_ramtha','outside_ramtha') THEN RAISE EXCEPTION 'PHASE3_CUSTOMER_QUOTE_INVALID';END IF;
 IF zone='inside_ramtha' AND concat_ws(' ',recipient->>'governorate',recipient->>'city',recipient->>'area') NOT ILIKE '%الرمثا%' THEN RAISE EXCEPTION 'PHASE3_CUSTOMER_DELIVERY_ZONE_MISMATCH';END IF;
 PERFORM pg_advisory_xact_lock(hashtext(p_key));
 replay:=sales_lite1.lock_request(p_key,'guest2',p_request);IF replay IS NOT NULL THEN RETURN replay;END IF;
 SELECT warehouse.branch_id,warehouse.id INTO bid,wid FROM public.warehouses warehouse JOIN public.branches branch ON branch.id=warehouse.branch_id
 WHERE warehouse.is_active AND branch.is_active ORDER BY warehouse.created_at,warehouse.id LIMIT 1;
 IF wid IS NULL THEN RAISE EXCEPTION 'PHASE3_CUSTOMER_LOCATION_UNAVAILABLE';END IF;
 PERFORM pg_advisory_xact_lock(hashtext(phone)::BIGINT);
 SELECT * INTO customer FROM public.customers c WHERE public.normalize_customer_phone(c.phone)=guest_context.phone AND NOT is_deleted ORDER BY id LIMIT 1 FOR UPDATE;
 IF FOUND THEN
  IF NOT customer.is_active OR customer.is_blocked THEN RAISE EXCEPTION 'PHASE3_CUSTOMER_UNAVAILABLE';END IF;
  cid:=customer.id;reused:=true;
 END IF;
 -- Same promotion row lock as full checkout: preview alone does not reserve
 -- quota. Lock before the final plan and insert redemption in this transaction.
 IF promotion IS NOT NULL THEN SELECT id INTO promo_id FROM public.promotion_codes WHERE code=promotion FOR UPDATE;END IF;
 plan:=sales_lite2.plan(p_request->'lines','customer_v2',0,promotion,phone,zone);
 SELECT array_agg(DISTINCT id ORDER BY id) INTO ids FROM(
  SELECT(value->>'product_id')::UUID id FROM jsonb_array_elements(plan->'lines')
  UNION SELECT(c->>'product_id')::UUID FROM jsonb_array_elements(plan->'lines') l CROSS JOIN LATERAL jsonb_array_elements(l->'parcel_instances') i CROSS JOIN LATERAL jsonb_array_elements(i->'components') c
 ) x;
 PERFORM 1 FROM public.products WHERE id=ANY(ids) OR id IN(SELECT flavor_master_product_id FROM public.products WHERE id=ANY(ids)) ORDER BY id FOR UPDATE;
 plan:=sales_lite2.plan(p_request->'lines','customer_v2',0,promotion,phone,zone);
 FOREACH pid IN ARRAY ids LOOP IF NOT sales_lite1.available(pid) THEN RAISE EXCEPTION 'LITE1_UNAVAILABLE_CONFIRM_REQUIRED';END IF;END LOOP;
 IF jsonb_typeof(p_request->'expectedQuote') IS DISTINCT FROM 'object'
 OR(p_request->'expectedQuote') IS DISTINCT FROM(plan-ARRAY['lines']) THEN RAISE EXCEPTION 'PHASE3_CUSTOMER_QUOTE_STALE';END IF;
 SELECT count(*) INTO recent FROM public.orders o JOIN public.customers c ON c.id=o.customer_id WHERE o.source='website' AND public.normalize_customer_phone(c.phone)=guest_context.phone AND o.created_at>=now()-interval '10 minutes';
 IF recent>=3 THEN RAISE EXCEPTION 'PHASE3_CUSTOMER_RATE_LIMITED';END IF;
 IF cid IS NULL THEN INSERT INTO public.customers(full_name,phone,governorate,customer_type,is_active,is_blocked,is_deleted)
 VALUES(name,phone,btrim(recipient->>'governorate'),'wholesale',true,false,false) RETURNING id INTO cid;END IF;
 -- H1: never overwrite an existing card or clear/replace its default address.
 -- This row is an order delivery snapshot, always non-default. The private
 -- recipient evidence retains the submitted name for manual owner comparison.
 INSERT INTO public.customer_addresses(id,customer_id,governorate,city,area,street,building,notes,latitude,longitude,formatted_address,google_maps_url,location_source,location_confirmed,is_default)
 VALUES(address_id,cid,btrim(recipient->>'governorate'),btrim(recipient->>'city'),btrim(recipient->>'area'),btrim(recipient->>'street'),NULLIF(btrim(recipient->>'building'),''),NULLIF(btrim(recipient->>'addressNotes'),''),lat,lon,
  concat_ws(' - ',btrim(recipient->>'governorate'),btrim(recipient->>'city'),btrim(recipient->>'area'),btrim(recipient->>'street'),NULLIF(btrim(recipient->>'building'),'')),maps,
  CASE WHEN lat IS NOT NULL THEN 'gps' WHEN maps IS NOT NULL THEN 'map_pin' ELSE 'manual' END,lat IS NOT NULL,false);
 result:=jsonb_build_object('success',true,'idempotent_replay',false,'contract_version','lite2-guest-v1','operation_id',op,'order_id',oid,'order_number','L2-'||oid::TEXT,
  'customer_id',cid,'customer_address_id',address_id,'customer_reused',reused,'status','new','subtotal',(plan->>'subtotalInMinorUnits')::BIGINT,'discount',(plan->>'discountInMinorUnits')::BIGINT,
  'delivery_fee',(plan->>'deliveryFeeInMinorUnits')::BIGINT,'total',(plan->>'totalInMinorUnits')::BIGINT,'promotion_code',promotion,'payment_method',method,'payment_status','unpaid',
  'tracking_token',tracking,'tracking_path','/#track='||tracking::TEXT,'accountingTracked',false);
 INSERT INTO public.business_operations(id,operation_type,idempotency_key,request_fingerprint,result_snapshot,completed_at)
 VALUES(op,'lite1_guest',p_key,(SELECT fingerprint FROM sales_lite1.requests WHERE key=p_key),result,now());
 INSERT INTO sales_lite1.orders VALUES(oid,op,recipient,'{}');
 INSERT INTO public.orders(id,order_number,customer_id,customer_address_id,customer_name_snapshot,branch_id,warehouse_id,status,payment_method,payment_status,
  subtotal_in_minor_units,delivery_fee_in_minor_units,discount_in_minor_units,total_in_minor_units,amount_paid_in_minor_units,source,idempotency_key,operation_id,
  delivery_zone,promotion_code_id,promotion_code_snapshot,tracking_token,customer_notes,reservation_released_at)
 VALUES(oid,'L2-'||oid::TEXT,cid,address_id,name,bid,wid,'new',method,'unpaid',(plan->>'subtotalInMinorUnits')::BIGINT,(plan->>'deliveryFeeInMinorUnits')::BIGINT,
  (plan->>'discountInMinorUnits')::BIGINT,(plan->>'totalInMinorUnits')::BIGINT,0,'website',p_key,op,zone,promo_id,promotion,tracking,NULLIF(btrim(recipient->>'customerNotes'),''),clock_timestamp());
 materialized:=sales_lite2.materialize(oid,op,plan,'customer_v2',phone,promotion);
 INSERT INTO sales_lite2.sales(order_id,request_key,plan) VALUES(oid,p_key,plan||jsonb_build_object('lines',materialized->'lines'));
 IF promo_id IS NOT NULL THEN INSERT INTO public.promotion_redemptions(promotion_code_id,order_id,customer_id,customer_phone,code_snapshot,discount_in_minor_units)
 VALUES(promo_id,oid,cid,phone,promotion,(plan->>'discountInMinorUnits')::BIGINT);END IF;
 INSERT INTO public.order_status_history(order_id,old_status,new_status,changed_by,notes) VALUES(oid,NULL,'new',NULL,'طلب دون تتبع مخزون');
 INSERT INTO public.audit_logs(user_id,action,entity_name,entity_id,details) VALUES(NULL,'LITE2_GUEST','orders',oid,jsonb_build_object('operationId',op,'recipientChangeProposed',reused));
 RETURN sales_lite1.finish(p_key,result||jsonb_build_object('items',materialized->'items'));
END $guest$;
REVOKE ALL ON FUNCTION sales_lite2.guest(JSONB,TEXT) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.lite1_guest2(p_request JSONB,p_key TEXT) RETURNS JSONB
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$ SELECT sales_lite2.guest(p_request,p_key) $$;
REVOKE ALL ON FUNCTION public.lite1_guest2(JSONB,TEXT) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.lite1_guest2(JSONB,TEXT) TO service_role;

-- QUARANTINED phase2. Parallel lifecycle;frozen full coordinators unchanged.
CREATE FUNCTION public.lite1_transition2(p_order UUID,p_next TEXT,p_key TEXT,p_notes TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $transition$
DECLARE replay JSONB;o public.orders;allowed BOOLEAN;
BEGIN
 PERFORM sales_lite1.owner();
 replay:=sales_lite1.lock_request(p_key,'transition2',jsonb_build_object('order',p_order,'next',p_next,'notes',p_notes));IF replay IS NOT NULL THEN RETURN replay;END IF;
 PERFORM public.phase4_lock_customer_order_context_internal(p_order,false,false);
 SELECT * INTO o FROM public.orders WHERE id=p_order FOR UPDATE;
 IF NOT FOUND OR NOT sales_lite1.is_order(o.id) OR o.source<>'website' THEN RAISE EXCEPTION 'LITE2_ORDER_CONTEXT_INVALID';END IF;
 allowed:=CASE o.status WHEN 'new' THEN p_next IN('confirmed','preparing') WHEN 'confirmed' THEN p_next='preparing'
  WHEN 'preparing' THEN p_next IN('ready','out_for_delivery') WHEN 'ready' THEN p_next='out_for_delivery' ELSE false END;
 IF allowed IS DISTINCT FROM true OR length(COALESCE(p_notes,''))>1000 THEN RAISE EXCEPTION 'PHASE3_CUSTOMER_LIFECYCLE_INVALID';END IF;
 UPDATE public.orders SET status=p_next,updated_at=now() WHERE id=p_order;
 INSERT INTO public.order_status_history(order_id,old_status,new_status,changed_by,notes) VALUES(p_order,o.status,p_next,auth.uid(),NULLIF(btrim(p_notes),''));
 RETURN sales_lite1.finish(p_key,jsonb_build_object('success',true,'order_id',p_order,'order_number',o.order_number,'status',p_next,'accountingTracked',false));
END $transition$;
REVOKE ALL ON FUNCTION public.lite1_transition2(UUID,TEXT,TEXT,TEXT) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.lite1_transition2(UUID,TEXT,TEXT,TEXT) TO authenticated;

CREATE FUNCTION public.lite1_complete2(p_order UUID,p_key TEXT,p_payment_method TEXT,p_amount_collected_in_minor_units BIGINT DEFAULT NULL,
 p_delivery_fee_in_minor_units BIGINT DEFAULT NULL,p_reference_number TEXT DEFAULT NULL,p_notes TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $complete$
DECLARE replay JSONB;result JSONB;o public.orders;method TEXT:=lower(NULLIF(btrim(p_payment_method),''));
 fee BIGINT;total BIGINT;collected BIGINT;remaining BIGINT;sid UUID;payment JSONB;
BEGIN
 PERFORM sales_lite1.owner();
 IF method='cash_on_delivery' THEN method:='cash';END IF;
 IF method IS NULL OR method NOT IN('cash','cliq','debt') OR COALESCE(p_amount_collected_in_minor_units,0)<0 OR COALESCE(p_delivery_fee_in_minor_units,0)<0
 OR length(COALESCE(btrim(p_reference_number),''))>120 OR length(COALESCE(p_notes,''))>1000 THEN RAISE EXCEPTION 'PHASE3_CUSTOMER_SETTLEMENT_INVALID';END IF;
 IF method='cliq' AND COALESCE(p_amount_collected_in_minor_units,1)>0 AND NULLIF(btrim(p_reference_number),'') IS NULL THEN RAISE EXCEPTION 'PHASE3_CUSTOMER_SETTLEMENT_REFERENCE_REQUIRED';END IF;
 replay:=sales_lite1.lock_request(p_key,'complete2',jsonb_build_object('order',p_order,'method',method,'collected',p_amount_collected_in_minor_units,'delivery',p_delivery_fee_in_minor_units,'reference',p_reference_number,'notes',p_notes));
 IF replay IS NOT NULL THEN RETURN replay;END IF;
 PERFORM public.phase4_lock_customer_order_context_internal(p_order,method<>'debt',false);
 SELECT * INTO o FROM public.orders WHERE id=p_order FOR UPDATE;
 IF NOT FOUND OR NOT sales_lite1.is_order(o.id) OR o.source<>'website' OR o.status NOT IN('ready','out_for_delivery')
 OR EXISTS(SELECT 1 FROM sales_lite1.completions WHERE order_id=p_order) THEN RAISE EXCEPTION 'PHASE3_CUSTOMER_LIFECYCLE_INVALID';END IF;
 fee:=COALESCE(p_delivery_fee_in_minor_units,o.delivery_fee_in_minor_units,0);
 total:=o.subtotal_in_minor_units-o.discount_in_minor_units+fee;
 collected:=CASE WHEN method='debt' THEN 0 ELSE COALESCE(p_amount_collected_in_minor_units,total) END;
 IF total<0 OR collected<0 OR collected>total THEN RAISE EXCEPTION 'PHASE3_CUSTOMER_SETTLEMENT_INVALID';END IF;
 IF collected=0 THEN method:='debt';END IF;remaining:=total-collected;
 IF remaining>0 AND o.customer_id IS NULL THEN RAISE EXCEPTION 'PHASE3_CUSTOMER_SETTLEMENT_INVALID';END IF;
 SELECT id INTO sid FROM public.cash_shifts WHERE branch_id=o.branch_id AND status='open' ORDER BY id LIMIT 1 FOR UPDATE;
 IF collected>0 AND sid IS NULL THEN RAISE EXCEPTION 'PHASE3_CUSTOMER_OPEN_SHIFT_REQUIRED';END IF;
 -- Same monetary settlement representation as the full completion coordinator.
 -- Full payment is classified by the shared order triggers;partial collection
 -- is a real customer payment through the existing protected writer.
 UPDATE public.orders SET status='completed',delivery_fee_in_minor_units=fee,total_in_minor_units=total,
  payment_method=CASE WHEN remaining>0 THEN 'debt' WHEN method='cash' THEN 'cash_on_delivery' ELSE 'cliq' END,
  payment_status=CASE WHEN remaining=0 THEN 'paid' WHEN collected>0 THEN 'partially_paid' ELSE 'unpaid' END,
  amount_paid_in_minor_units=0,payment_reference_number=CASE WHEN method='cliq' THEN NULLIF(btrim(p_reference_number),'') END,
  payment_confirmed_at=CASE WHEN collected>0 THEN now() END,payment_confirmed_by=CASE WHEN collected>0 THEN auth.uid() END,
  cash_shift_id=sid,updated_at=now() WHERE id=p_order;
 IF remaining>0 AND collected>0 THEN
  payment:=public.record_customer_order_payment_once(p_order,collected,method,NULLIF(btrim(p_reference_number),''),COALESCE(NULLIF(btrim(p_notes),''),'دفعة عند التسليم دون تتبع مخزون'),'lite2-delivery-'||p_order::TEXT);
 END IF;
 INSERT INTO sales_lite1.completions(order_id) VALUES(p_order);
 INSERT INTO public.order_status_history(order_id,old_status,new_status,changed_by,notes) VALUES(p_order,o.status,'completed',auth.uid(),COALESCE(NULLIF(btrim(p_notes),''),'تسليم دون تتبع مخزون'));
 result:=jsonb_build_object('success',true,'operation_id',gen_random_uuid(),'order_id',p_order,'order_number',o.order_number,'status','completed','payment_method',CASE WHEN remaining>0 THEN 'debt' ELSE method END,
  'payment_status',CASE WHEN remaining=0 THEN 'paid' WHEN collected>0 THEN 'partially_paid' ELSE 'unpaid' END,
  'total_in_minor_units',total,'amount_paid_in_minor_units',collected,'remaining_in_minor_units',remaining,'customer_payment_number',payment->>'payment_number','accountingTracked',false);
 RETURN sales_lite1.finish(p_key,result);
END $complete$;
REVOKE ALL ON FUNCTION public.lite1_complete2(UUID,TEXT,TEXT,BIGINT,BIGINT,TEXT,TEXT) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.lite1_complete2(UUID,TEXT,TEXT,BIGINT,BIGINT,TEXT,TEXT) TO authenticated;

CREATE FUNCTION public.lite1_cancel_guest2(p_order UUID,p_key TEXT,p_reason TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $cancel_guest$
DECLARE replay JSONB;o public.orders;
BEGIN
 PERFORM sales_lite1.owner();
 IF length(COALESCE(btrim(p_reason),'')) NOT BETWEEN 2 AND 1000 THEN RAISE EXCEPTION 'PHASE3_CUSTOMER_LIFECYCLE_INVALID';END IF;
 replay:=sales_lite1.lock_request(p_key,'cancel_guest2',jsonb_build_object('order',p_order,'reason',p_reason));IF replay IS NOT NULL THEN RETURN replay;END IF;
 PERFORM public.phase4_lock_customer_order_context_internal(p_order,false,false);
 SELECT * INTO o FROM public.orders WHERE id=p_order FOR UPDATE;
 IF NOT FOUND OR NOT sales_lite1.is_order(o.id) OR o.source<>'website' OR o.status NOT IN('new','confirmed','preparing','ready','out_for_delivery') OR o.amount_paid_in_minor_units<>0
 OR EXISTS(SELECT 1 FROM sales_lite1.completions WHERE order_id=p_order) THEN RAISE EXCEPTION 'PHASE3_CUSTOMER_LIFECYCLE_INVALID';END IF;
 UPDATE public.orders SET status='cancelled',updated_at=now() WHERE id=p_order;
 INSERT INTO public.order_status_history(order_id,old_status,new_status,changed_by,notes) VALUES(p_order,o.status,'cancelled',auth.uid(),btrim(p_reason));
 RETURN sales_lite1.finish(p_key,jsonb_build_object('success',true,'operation_id',gen_random_uuid(),'order_id',p_order,'order_number',o.order_number,'status','cancelled','accountingTracked',false,'reservation_state','not_tracked','released_reservations',0));
END $cancel_guest$;
REVOKE ALL ON FUNCTION public.lite1_cancel_guest2(UUID,TEXT,TEXT) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.lite1_cancel_guest2(UUID,TEXT,TEXT) TO authenticated;

-- Same old page/filter/sort/count contract and role check. Financial correction
-- applies only to immutable lite provenance;full-only JSON stays byte-for-byte.
CREATE FUNCTION public.lite1_operational_orders_page2(p_page INTEGER DEFAULT 1,p_page_size INTEGER DEFAULT 25,p_filter TEXT DEFAULT 'action',p_search TEXT DEFAULT NULL,p_sort TEXT DEFAULT 'newest')
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE base JSONB;adjustment BIGINT;amounts JSONB;
BEGIN
 base:=public.get_operational_orders_page(p_page,p_page_size,p_filter,p_search,p_sort);
 IF NOT EXISTS(SELECT 1 FROM sales_lite1.orders l JOIN public.orders o ON o.id=l.order_id WHERE COALESCE(o.source,'website')<>'pos') THEN RETURN base;END IF;
 SELECT COALESCE(sum(f.outstanding_total_in_minor_units-GREATEST(o.total_in_minor_units-o.amount_paid_in_minor_units,0)),0)::BIGINT INTO adjustment
 FROM sales_lite1.orders l JOIN public.orders o ON o.id=l.order_id CROSS JOIN LATERAL public.phase42_order_financial_position_internal(o.id) f
 WHERE COALESCE(o.source,'website')<>'pos' AND o.status IN('completed','delivered');
 SELECT COALESCE(jsonb_agg(jsonb_build_object('orderId',o.id,'amountPaidInMinorUnits',o.amount_paid_in_minor_units,'amountDueInMinorUnits',f.outstanding_total_in_minor_units,'customerName',o.customer_name_snapshot) ORDER BY o.id),'[]'::JSONB) INTO amounts
 FROM sales_lite1.orders l JOIN public.orders o ON o.id=l.order_id CROSS JOIN LATERAL public.phase42_order_financial_position_internal(o.id) f
 WHERE o.id IN(SELECT value::UUID FROM jsonb_array_elements_text(base->'order_ids'));
 RETURN jsonb_set(base,'{summary,due_in_minor_units}',to_jsonb((base#>>'{summary,due_in_minor_units}')::BIGINT+adjustment))
 ||jsonb_build_object('contractVersion','lite2-orders-page-v1','liteAmounts',amounts);
END $$;
REVOKE ALL ON FUNCTION public.lite1_operational_orders_page2(INTEGER,INTEGER,TEXT,TEXT,TEXT) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.lite1_operational_orders_page2(INTEGER,INTEGER,TEXT,TEXT,TEXT) TO authenticated;

-- Reuse the original metadata writer after the parallel state coordinator has
-- reached out_for_delivery. Its legacy update_order_status branch cannot run.
CREATE FUNCTION public.lite1_delivery2(p_order_id UUID,p_eta_minutes INTEGER,p_driver_phone TEXT,p_notes TEXT,p_key UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE replay JSONB;status TEXT;result JSONB;
BEGIN
 PERFORM sales_lite1.owner();
 replay:=sales_lite1.lock_request(p_key::TEXT,'delivery2',jsonb_build_object('order',p_order_id,'eta',p_eta_minutes,'phone',p_driver_phone,'notes',p_notes));IF replay IS NOT NULL THEN RETURN replay;END IF;
 PERFORM public.phase4_lock_customer_order_context_internal(p_order_id,false,false);
 SELECT o.status INTO status FROM public.orders o WHERE o.id=p_order_id AND o.source='website' AND sales_lite1.is_order(o.id) FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'LITE2_ORDER_CONTEXT_INVALID';END IF;
 IF status='preparing' THEN PERFORM public.lite1_transition2(p_order_id,'ready',p_key::TEXT||':ready',p_notes);status:='ready';END IF;
 IF status='ready' THEN PERFORM public.lite1_transition2(p_order_id,'out_for_delivery',p_key::TEXT||':out',p_notes);status:='out_for_delivery';END IF;
 IF status IS DISTINCT FROM 'out_for_delivery' THEN RAISE EXCEPTION 'PHASE3_CUSTOMER_LIFECYCLE_INVALID';END IF;
 result:=public.start_or_update_order_delivery(p_order_id,p_eta_minutes,p_driver_phone,p_notes);
 RETURN sales_lite1.finish(p_key::TEXT,result||jsonb_build_object('accountingTracked',false));
END $$;
REVOKE ALL ON FUNCTION public.lite1_delivery2(UUID,INTEGER,TEXT,TEXT,UUID) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.lite1_delivery2(UUID,INTEGER,TEXT,TEXT,UUID) TO authenticated;

-- QUARANTINED phase2. Public-safe mode only;no private order/customer evidence.
CREATE FUNCTION public.lite1_operating_mode(p_guest_key TEXT DEFAULT NULL) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE full_mode BOOLEAN;r sales_lite1.requests;operation public.business_operations;
BEGIN
 IF p_guest_key IS NOT NULL THEN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='LITE2_GATEWAY_ONLY';END IF;
  IF p_guest_key!~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN RAISE EXCEPTION 'PHASE3_IDEMPOTENCY_INPUT_INVALID';END IF;
  -- Routing is only an affordance. Each original writer independently checks
  -- the actor and exact request fingerprint before returning its sealed result.
  SELECT * INTO r FROM sales_lite1.requests WHERE key=p_guest_key;
  IF FOUND THEN
   IF r.kind<>'guest2' OR r.result IS NULL THEN RAISE EXCEPTION 'PHASE3_IDEMPOTENCY_CONFLICT';END IF;
   RETURN jsonb_build_object('contractVersion','sales-only-phase2-v1','fullAccounting',false);
  END IF;
  SELECT * INTO operation FROM public.business_operations WHERE idempotency_key=p_guest_key;
  IF FOUND THEN
   IF operation.operation_type<>'phase3_customer_reservation_v1' OR operation.actor_scope_type<>'guest_gateway' OR operation.completed_at IS NULL THEN RAISE EXCEPTION 'PHASE3_IDEMPOTENCY_CONFLICT';END IF;
   RETURN jsonb_build_object('contractVersion','sales-only-phase2-v1','fullAccounting',true);
  END IF;
 END IF;
 SELECT full_accounting INTO full_mode FROM sales_lite1.mode WHERE id;
 IF full_mode IS NULL THEN RAISE EXCEPTION 'LITE2_MODE_MISSING';END IF;
 RETURN jsonb_build_object('contractVersion','sales-only-phase2-v1','fullAccounting',full_mode);
END $$;
REVOKE ALL ON FUNCTION public.lite1_operating_mode(TEXT) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.lite1_operating_mode(TEXT) TO anon,authenticated,service_role;

CREATE FUNCTION public.lite1_set_mode2(p_full BOOLEAN) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 PERFORM sales_lite1.owner();
 IF auth.jwt()->>'aal' IS DISTINCT FROM 'aal2' THEN RAISE EXCEPTION 'LITE2_OWNER_AAL2_REQUIRED';END IF;
 -- Enabling after lite needs the opening epoch transaction, never this toggle.
 RETURN public.lite1_set_mode(p_full);
END $$;
REVOKE ALL ON FUNCTION public.lite1_set_mode2(BOOLEAN) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.lite1_set_mode2(BOOLEAN) TO authenticated;

-- QUARANTINED phase2. The same phase1 manual flags and optimistic revision.
-- No synthetic stock amount, cost read, legacy writer or ACL change.
CREATE FUNCTION public.lite1_product_availability2(p_product_ids UUID[]) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE products JSONB;full_mode BOOLEAN;
BEGIN
 PERFORM sales_lite1.owner();
 IF p_product_ids IS NULL OR cardinality(p_product_ids) NOT BETWEEN 1 AND 200
 OR EXISTS(SELECT 1 FROM unnest(p_product_ids) x WHERE x IS NULL)
 OR(SELECT count(DISTINCT x) FROM unnest(p_product_ids) x)<>cardinality(p_product_ids)
 THEN RAISE EXCEPTION 'LITE2_AVAILABILITY_IDS_INVALID';END IF;
 SELECT full_accounting INTO STRICT full_mode FROM sales_lite1.mode WHERE id;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('productId',p.id,'available',COALESCE(a.available,true),'revision',COALESCE(a.revision,0),
  'effectiveAvailable',sales_lite1.available(p.id),'active',p.is_active,'flavorMasterProductId',p.flavor_master_product_id,
  'parentAvailable',COALESCE(parent.is_active,true) AND COALESCE(parent_flag.available,true)) ORDER BY p.id),'[]') INTO products
 FROM public.products p LEFT JOIN sales_lite1.availability a ON a.product_id=p.id
 LEFT JOIN public.products parent ON parent.id=p.flavor_master_product_id
 LEFT JOIN sales_lite1.availability parent_flag ON parent_flag.product_id=parent.id WHERE p.id=ANY(p_product_ids);
 IF jsonb_array_length(products)<>cardinality(p_product_ids) THEN RAISE EXCEPTION 'LITE2_AVAILABILITY_PRODUCT_CHANGED';END IF;
 RETURN jsonb_build_object('contractVersion','sales-only-availability2-v1','fullAccounting',full_mode,'products',products);
END $$;
REVOKE ALL ON FUNCTION public.lite1_product_availability2(UUID[]) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.lite1_product_availability2(UUID[]) TO authenticated;

CREATE FUNCTION public.lite1_set_available2(p_product UUID,p_available BOOLEAN,p_revision INTEGER) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 PERFORM sales_lite1.owner();PERFORM sales_lite1.lock_mode();
 IF NOT sales_lite1.enabled() THEN RAISE EXCEPTION 'LITE1_MODE_DISABLED';END IF;
 RETURN public.lite1_set_available(p_product,p_available,p_revision);
END $$;
REVOKE ALL ON FUNCTION public.lite1_set_available2(UUID,BOOLEAN,INTEGER) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.lite1_set_available2(UUID,BOOLEAN,INTEGER) TO authenticated;

-- QUARANTINED parallel owner reader. Configuration and prices stay authoritative;
-- no inventory/cost predicate or invented stock capacity in sales-only mode.
CREATE FUNCTION public.lite1_pos_options2(p_warehouse_id UUID) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE options JSONB;state TEXT:=public.get_configurable_parcel_feature_state();
BEGIN
 PERFORM sales_lite1.owner();
 IF (SELECT full_accounting FROM sales_lite1.mode WHERE id) THEN RAISE EXCEPTION 'LITE1_MODE_DISABLED';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.warehouses w JOIN public.branches b ON b.id=w.branch_id
  WHERE w.id=p_warehouse_id AND w.is_active AND b.is_active) THEN RAISE EXCEPTION 'PHASE3_POS_LOCATION_INVALID';END IF;
 IF state='OFF' THEN RETURN jsonb_build_object('featureState',state,'options','[]'::JSONB);END IF;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('familyProductId',f.id,'nameAr',f.name_ar,
  'parcelConfigurationId',c.id,'configurationRevision',c.configuration_revision,
  'unitsPerParcel',f.units_per_sale_unit,'parcelPriceInMinorUnits',f.default_sale_price_in_minor_units,
  'quantityTracked',false,'components',components.value) ORDER BY f.name_ar,f.id),'[]'::JSONB) INTO options
 FROM public.product_parcel_configurations c JOIN public.products f ON f.id=c.family_product_id
 CROSS JOIN LATERAL(SELECT jsonb_agg(jsonb_build_object('productId',p.id,'nameAr',p.name_ar,
  'flavorNameAr',p.flavor_name_ar,'sku',p.sku,'manualAvailable',sales_lite1.available(p.id)) ORDER BY p.name_ar,p.id) value
  FROM public.product_parcel_allowed_components a JOIN public.products p ON p.id=a.product_id
  AND p.is_active AND p.flavor_master_product_id=f.id AND NOT p.is_flavor_master WHERE a.configuration_id=c.id) components
 WHERE c.is_active AND c.composition_mode='configurable_mix' AND f.is_active AND f.is_flavor_master
  AND f.units_per_sale_unit>0 AND f.default_sale_price_in_minor_units>0 AND components.value IS NOT NULL;
 RETURN jsonb_build_object('featureState',state,'options',options);
END $$;
REVOKE ALL ON FUNCTION public.lite1_pos_options2(UUID) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.lite1_pos_options2(UUID) TO authenticated;

-- QUARANTINED. Extensions only to phase1's private evidence,not the219 schema.
-- Zero entitlement consumes return capacity too (e.g.a fully discounted line).
-- The old prototype entrypoint is revoked below; no change to a219 function.
ALTER TABLE sales_lite1.returns DROP CONSTRAINT returns_entitlement_check;
ALTER TABLE sales_lite1.returns ADD CONSTRAINT returns_entitlement_check CHECK(entitlement>=0);
-- Debt-only returns, as in215, do not need a drawer. Money refunds still do.
ALTER TABLE sales_lite1.returns ALTER COLUMN shift_id DROP NOT NULL;
ALTER TABLE sales_lite1.returns ADD CONSTRAINT return_money_requires_shift CHECK(money_refund=0 OR shift_id IS NOT NULL);
CREATE TABLE sales_lite2.return_details(
 return_id UUID PRIMARY KEY REFERENCES sales_lite1.returns(id),
 parcel_instance_id UUID UNIQUE REFERENCES public.order_parcel_instances(id),
 applied_damage BIGINT NOT NULL CHECK(applied_damage>=0),
 request_snapshot JSONB NOT NULL,plan_snapshot JSONB NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE sales_lite2.return_details ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE sales_lite2.return_details FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER lite2_immutable BEFORE UPDATE OR DELETE ON sales_lite2.return_details FOR EACH ROW EXECUTE FUNCTION sales_lite1.immutable();
CREATE TRIGGER lite2_no_truncate BEFORE TRUNCATE ON sales_lite2.return_details FOR EACH STATEMENT EXECUTE FUNCTION sales_lite1.immutable();

CREATE FUNCTION sales_lite2.sale_packet_price(p_order UUID,p_item UUID,p_component UUID) RETURNS BIGINT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT CASE WHEN p_component IS NULL THEN (line->>'effectiveStandaloneUnitPriceInMinorUnits')::BIGINT
 ELSE(SELECT(c->>'effectiveStandaloneUnitPriceInMinorUnits')::BIGINT FROM jsonb_array_elements(line->'parcel_instances') i CROSS JOIN LATERAL jsonb_array_elements(i->'components') c WHERE c->>'component_id'=p_component::TEXT) END
 FROM sales_lite2.sales s CROSS JOIN LATERAL jsonb_array_elements(s.plan->'lines') line WHERE s.order_id=p_order AND line->>'orderItemId'=p_item::TEXT;
$$;
REVOKE ALL ON FUNCTION sales_lite2.sale_packet_price(UUID,UUID,UUID) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION sales_lite2.return_context(p_order UUID) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE o public.orders;completed TIMESTAMPTZ;
BEGIN
 SELECT * INTO o FROM public.orders WHERE id=p_order;
 IF NOT FOUND OR o.status<>'completed' OR NOT sales_lite1.is_order(o.id) OR o.branch_id IS NULL OR o.warehouse_id IS NULL THEN RAISE EXCEPTION 'AFTERCARE215_ORDER_UNAVAILABLE';END IF;
 SELECT completed_at INTO completed FROM sales_lite1.completions WHERE order_id=p_order;
 PERFORM sales_lite1.assert_return_window(completed,statement_timestamp());
 RETURN jsonb_build_object('capability','lite2','order',jsonb_build_object('id',o.id,'orderNumber',o.order_number,'status',o.status,'saleContract','lite2',
  'branchId',o.branch_id,'warehouseId',o.warehouse_id,'completedAt',completed,'deadlineAt',completed+interval '48 hours','withinWindow',true));
END $$;
REVOKE ALL ON FUNCTION sales_lite2.return_context(UUID) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION sales_lite2.prepare_return(p_request JSONB) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,extensions AS $prepare_lite$
#variable_conflict use_variable
DECLARE ctx JSONB; item JSONB; component JSONB; source JSONB; assignment JSONB; oi public.order_items%ROWTYPE; instance public.order_parcel_instances%ROWTYPE;
 pc public.order_parcel_components%ROWTYPE; position RECORD; q INTEGER; prior INTEGER; prior_refund BIGINT; target BIGINT; raw_damage BIGINT; refund BIGINT;
 entitlement BIGINT:=0; customer_damage BIGINT:=0; good_value NUMERIC(30,6):=0; bad_value BIGINT:=0; held_value BIGINT:=0; cost NUMERIC(24,6);
 good_q INTEGER:=0; bad_q INTEGER:=0; damage_q INTEGER:=0; debt BIGINT; money BIGINT; method TEXT; original_method TEXT; shift_id UUID;
 issues JSONB:='[]'::JSONB; sources JSONB:='[]'::JSONB; order_id UUID:=(p_request->'baseRequest'->>'order_id')::UUID;
BEGIN
 ctx:=sales_lite2.return_context(order_id);
 IF jsonb_array_length(p_request->'supplierAssignments')<>0 THEN RAISE EXCEPTION 'LITE2_SUPPLIER_ACCOUNTING_DISABLED';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.branches WHERE id=(ctx->'order'->>'branchId')::UUID AND is_active)
  OR NOT EXISTS(SELECT 1 FROM public.warehouses WHERE id=(ctx->'order'->>'warehouseId')::UUID AND is_active)
 THEN RAISE EXCEPTION 'AFTERCARE215_ORDER_UNAVAILABLE'; END IF;
 IF jsonb_array_length(p_request->'supplierAssignments')>0 THEN PERFORM public.sr208_assert_role_internal('customer_return'); END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(p_request->'baseRequest'->'items') LOOP
  SELECT * INTO oi FROM public.order_items WHERE id=(item->>'order_item_id')::UUID AND order_items.order_id=order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'PHASE42_ORDER_ITEM_INVALID'; END IF;
  IF item->>'return_scope'='base_unit' THEN
   q:=(item->>'quantity')::INTEGER;
   IF oi.commercial_line_kind NOT IN('base_unit','legacy_single_sku_parcel') OR oi.net_refundable_amount_snapshot_in_minor_units IS NULL OR oi.quantity<=0 THEN RAISE EXCEPTION 'PHASE42_BASE_SALE_EVIDENCE_MISSING'; END IF;
   PERFORM public.package_d_assert_whole_single_sku_quantity_internal(oi.id,q);
   SELECT COALESCE(sum(r.quantity),0)::INTEGER,COALESCE(sum(r.entitlement+COALESCE(d.applied_damage,0)),0)::BIGINT
    INTO prior,prior_refund FROM sales_lite1.returns r LEFT JOIN sales_lite2.return_details d ON d.return_id=r.id WHERE r.item_id=oi.id;
   IF prior+q>oi.quantity THEN RAISE EXCEPTION 'PHASE4_LOGICAL_QUANTITY_ALREADY_CONSUMED'; END IF;
   target:=CASE WHEN prior+q=oi.quantity THEN oi.net_refundable_amount_snapshot_in_minor_units ELSE floor(oi.net_refundable_amount_snapshot_in_minor_units::NUMERIC*(prior+q)/oi.quantity)::BIGINT END;
   refund:=target-prior_refund;
   oi.effective_standalone_unit_sale_price_snapshot_in_minor_units:=sales_lite2.sale_packet_price(order_id,oi.id,NULL);
   IF COALESCE((item->>'customer_damage_quantity')::INTEGER,0)>0 AND(oi.commercial_line_kind<>'legacy_single_sku_parcel' OR q<>oi.units_per_sale_package OR oi.effective_standalone_unit_sale_price_snapshot_in_minor_units IS NULL)
   THEN RAISE EXCEPTION 'PACKAGE_D_CARTON_DAMAGE_PRICE_MISSING'; END IF;
   raw_damage:=COALESCE((item->>'customer_damage_quantity')::INTEGER,0)::BIGINT*COALESCE(oi.effective_standalone_unit_sale_price_snapshot_in_minor_units,0);
  ELSE
   SELECT * INTO instance FROM public.order_parcel_instances WHERE id=(item->>'parcel_instance_id')::UUID AND order_item_id=oi.id AND order_parcel_instances.order_id=order_id;
   IF NOT FOUND OR oi.commercial_line_kind IS DISTINCT FROM 'configurable_parcel' OR instance.finalized_at IS NULL OR instance.net_refundable_amount_snapshot_in_minor_units IS NULL
    OR(SELECT count(*) FROM public.order_parcel_components WHERE parcel_instance_id=instance.id)<>jsonb_array_length(item->'components')
   THEN RAISE EXCEPTION 'PHASE42_PARCEL_SALE_EVIDENCE_MISSING'; END IF;
   IF EXISTS(SELECT 1 FROM sales_lite2.return_details d WHERE d.parcel_instance_id=instance.id) THEN RAISE EXCEPTION 'PHASE4_LOGICAL_QUANTITY_ALREADY_CONSUMED'; END IF;
   raw_damage:=0;
   FOR component IN SELECT value FROM jsonb_array_elements(item->'components') LOOP
    SELECT * INTO pc FROM public.order_parcel_components WHERE id=(component->>'parcel_component_id')::UUID AND parcel_instance_id=instance.id;
    IF NOT FOUND THEN RAISE EXCEPTION 'PHASE42_PARCEL_COMPONENT_EVIDENCE_INVALID';END IF;
    pc.effective_standalone_unit_sale_price_snapshot_in_minor_units:=sales_lite2.sale_packet_price(order_id,oi.id,pc.id);
    IF pc.base_quantity<>(component->>'accepted_quantity')::INTEGER+(component->>'rejected_quantity')::INTEGER
     OR((component->>'rejected_quantity')::INTEGER>0 AND pc.effective_standalone_unit_sale_price_snapshot_in_minor_units IS NULL)
    THEN RAISE EXCEPTION 'PHASE42_PARCEL_COMPONENT_EVIDENCE_INVALID'; END IF;
    raw_damage:=raw_damage+(component->>'rejected_quantity')::BIGINT*COALESCE(pc.effective_standalone_unit_sale_price_snapshot_in_minor_units,0);
   END LOOP;
   refund:=instance.net_refundable_amount_snapshot_in_minor_units;
  END IF;
  IF refund<0 THEN RAISE EXCEPTION 'PHASE42_CUMULATIVE_ALLOCATION_INVALID'; END IF;
  customer_damage:=customer_damage+LEAST(refund,raw_damage);entitlement:=entitlement+refund-LEAST(refund,raw_damage);
 END LOOP;
 FOR source IN SELECT value FROM jsonb_array_elements(p_request->'physicalSources') LOOP
  PERFORM public.phase43_assert_return_physical_source_internal(order_id,source->>'root_source_kind',(source->>'root_source_id')::UUID,source->>'source_kind',(source->>'source_id')::UUID,(source->>'product_id')::UUID);
  cost:=0; -- untracked, never financial cost truth
  good_q:=good_q+(source->>'sellable_restock_quantity')::INTEGER;bad_q:=bad_q+(source->>'defect_non_sellable_quantity')::INTEGER;damage_q:=damage_q+(source->>'customer_damage_quantity')::INTEGER;
  good_value:=good_value+cost*(source->>'sellable_restock_quantity')::INTEGER;
  bad_value:=bad_value+round(cost*(source->>'defect_non_sellable_quantity')::INTEGER)::BIGINT;
  sources:=sources||jsonb_build_array(source||jsonb_build_object('historicalUnitCostExact',cost::TEXT));
 END LOOP;
 FOR assignment IN SELECT value FROM jsonb_array_elements(p_request->'supplierAssignments') LOOP
  SELECT value INTO source FROM jsonb_array_elements(sources) WHERE value->>'source_kind'=assignment->>'sourceKind' AND value->>'source_id'=assignment->>'sourceId';
  IF source IS NULL OR(source->>'defect_non_sellable_quantity')::INTEGER<=0 THEN RAISE EXCEPTION 'SUPPLIER_REPLACEMENT_RETURN_ASSIGNMENTS_MISMATCH'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.suppliers WHERE id=(assignment->>'supplierId')::UUID AND is_active) THEN RAISE EXCEPTION 'SUPPLIER_REPLACEMENT_SUPPLIER_INVALID'; END IF;
  held_value:=held_value+round((source->>'historicalUnitCostExact')::NUMERIC*(source->>'defect_non_sellable_quantity')::INTEGER)::BIGINT;
 END LOOP;
 SELECT * INTO position FROM public.phase42_order_financial_position_internal(order_id);
 IF NOT FOUND THEN RAISE EXCEPTION 'PHASE42_FINANCIAL_POSITION_UNAVAILABLE'; END IF;
 debt:=LEAST(entitlement,position.merchandise_debt_in_minor_units);money:=entitlement-debt;
 IF money>position.refundable_collected_in_minor_units THEN RAISE EXCEPTION 'PHASE42_FINANCIAL_EVIDENCE_CONTRADICTORY'; END IF;
 SELECT payment_method INTO original_method FROM public.orders WHERE id=order_id;
 method:=CASE WHEN p_request->>'refundChoice'='auto' THEN CASE WHEN original_method='cash_on_delivery' THEN 'cash' WHEN original_method IN('cash','cliq') THEN original_method ELSE NULL END
  WHEN p_request->>'refundChoice'='debt' THEN NULL ELSE p_request->>'refundChoice' END;
 SELECT id INTO shift_id FROM public.cash_shifts WHERE branch_id=(ctx->'order'->>'branchId')::UUID AND status='open';
 IF money=0 THEN method:=NULL;
 ELSE
  IF method IS NULL THEN issues:=issues||jsonb_build_array(jsonb_build_object('field','refundMethod','code','AFTERCARE215_REFUND_METHOD_REQUIRED')); END IF;
  IF shift_id IS NULL THEN issues:=issues||jsonb_build_array(jsonb_build_object('field','cashShift','code','PHASE2_OPEN_SHIFT_REQUIRED')); END IF;
  IF method='cliq' AND p_request->>'referenceNumber' IS NULL THEN issues:=issues||jsonb_build_array(jsonb_build_object('field','referenceNumber','code','AFTERCARE215_REFUND_REFERENCE_REQUIRED')); END IF;
 END IF;
 RETURN jsonb_build_object('request',p_request,'order',ctx->'order','originalPaymentMethod',original_method,'financialPosition',to_jsonb(position),
  'cashShiftId',CASE WHEN money>0 THEN shift_id END,'refundMethod',method,'referenceNumber',CASE WHEN money>0 AND method='cliq' THEN p_request->'referenceNumber' END,
  'entitlementInMinorUnits',entitlement::TEXT,'debtReductionInMinorUnits',debt::TEXT,'moneyRefundInMinorUnits',money::TEXT,
  'customerDamageDeductionInMinorUnits',customer_damage::TEXT,'goodQuantity',good_q,'badQuantity',bad_q,'customerDamageQuantity',damage_q,
  'goodRestockValueExact',good_value::TEXT,'badLossInMinorUnits',bad_value::TEXT,'supplierHeldInMinorUnits',held_value::TEXT,
  'physicalSources',sources,'issues',issues);
END $prepare_lite$;
REVOKE ALL ON FUNCTION sales_lite2.prepare_return(JSONB) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.lite1_preview_return2(p_payload JSONB) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,extensions AS $$
DECLARE request JSONB;plan JSONB;
BEGIN
 PERFORM sales_lite1.owner();request:=public.tb215_canonical_return_internal(p_payload);
 -- The current inspector submits one root at a time. No silent partial commit
 -- or invented grouping: wider batches fail before any mutation.
 IF jsonb_array_length(request#>'{baseRequest,items}')<>1 THEN RAISE EXCEPTION 'LITE2_ONE_RETURN_ROOT_REQUIRED';END IF;
 plan:=sales_lite2.prepare_return(request);
 RETURN (plan-ARRAY['request','order','originalPaymentMethod','financialPosition','cashShiftId','physicalSources','goodRestockValueExact','badLossInMinorUnits','supplierHeldInMinorUnits'])
  ||jsonb_build_object('contractVersion',215,'orderId',p_payload->'orderId','previewFingerprint',encode(extensions.digest(plan::TEXT,'sha256'),'hex'),'canConfirm',jsonb_array_length(plan->'issues')=0,'accountingTracked',false);
END $$;
REVOKE ALL ON FUNCTION public.lite1_preview_return2(JSONB) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.lite1_preview_return2(JSONB) TO authenticated;

CREATE FUNCTION public.lite1_settle_return2(p_payload JSONB,p_key TEXT,p_preview TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,extensions AS $$
DECLARE request JSONB;sealed_request JSONB;fingerprint TEXT;r sales_lite1.requests;plan JSONB;item JSONB;o public.orders;rid UUID:=gen_random_uuid();sid UUID;quantity INTEGER;method TEXT;result JSONB;
BEGIN
 PERFORM sales_lite1.owner();request:=public.tb215_canonical_return_internal(p_payload);
 IF p_key IS NULL OR length(p_key) NOT BETWEEN 8 AND 128 OR p_preview IS NULL OR p_preview!~'^[a-f0-9]{64}$' OR jsonb_array_length(request#>'{baseRequest,items}')<>1 THEN RAISE EXCEPTION 'LITE2_RETURN_IDENTITY_INVALID';END IF;
 sealed_request:=jsonb_build_object('request',request,'preview',p_preview);fingerprint:=encode(extensions.digest(sealed_request::TEXT,'sha256'),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended(p_key,0));
 SELECT * INTO r FROM sales_lite1.requests WHERE key=p_key;
 IF FOUND THEN
  IF r.kind<>'return2' OR r.actor IS DISTINCT FROM auth.uid() OR r.fingerprint<>fingerprint OR r.result IS NULL THEN RAISE EXCEPTION 'LITE1_IDEMPOTENCY_CONFLICT';END IF;
  RETURN r.result;
 END IF;
 IF EXISTS(SELECT 1 FROM public.business_operations WHERE idempotency_key=p_key) OR EXISTS(SELECT 1 FROM public.orders WHERE idempotency_key=p_key) THEN RAISE EXCEPTION 'LITE1_IDEMPOTENCY_CONFLICT';END IF;
 -- Old lite invoices remain non-stock even after opening epoch enables full.
 PERFORM sales_lite1.lock_mode();
 -- Locks any open shift when present, but debt-only settlement needs none.
 -- The pinned215 preparation and conditional money check below enforce it.
 PERFORM public.phase4_lock_customer_order_context_internal((request#>>'{baseRequest,order_id}')::UUID,false,false);
 SELECT * INTO o FROM public.orders WHERE id=(request#>>'{baseRequest,order_id}')::UUID FOR UPDATE;
 IF NOT FOUND OR NOT sales_lite1.is_order(o.id) THEN RAISE EXCEPTION 'LITE2_ORDER_CONTEXT_INVALID';END IF;
 plan:=sales_lite2.prepare_return(request);
 IF encode(extensions.digest(plan::TEXT,'sha256'),'hex')<>p_preview THEN RAISE EXCEPTION 'AFTERCARE215_PREVIEW_CHANGED';END IF;
 IF jsonb_array_length(plan->'issues')<>0 THEN RAISE EXCEPTION 'LITE2_RETURN_REVIEW_REQUIRED';END IF;
 SELECT id INTO sid FROM public.cash_shifts WHERE branch_id=o.branch_id AND status='open' ORDER BY id LIMIT 1 FOR UPDATE;
 IF (plan->>'moneyRefundInMinorUnits')::BIGINT>0 AND sid IS NULL THEN RAISE EXCEPTION 'LITE1_SHIFT_REQUIRED';END IF;
 IF (plan->>'moneyRefundInMinorUnits')::BIGINT=0 THEN sid:=NULL;END IF;
 item:=request#>'{baseRequest,items,0}';quantity:=CASE WHEN item->>'return_scope'='parcel_instance' THEN 1 ELSE(item->>'quantity')::INTEGER END;
 method:=COALESCE(plan->>'refundMethod','cash');
 INSERT INTO sales_lite1.requests VALUES(p_key,'return2',fingerprint,auth.uid(),NULL);
 INSERT INTO sales_lite1.returns(id,order_id,item_id,quantity,entitlement,debt_reduction,money_refund,method,shift_id,key,created_by)
 VALUES(rid,o.id,(item->>'order_item_id')::UUID,quantity,(plan->>'entitlementInMinorUnits')::BIGINT,(plan->>'debtReductionInMinorUnits')::BIGINT,(plan->>'moneyRefundInMinorUnits')::BIGINT,method,sid,p_key,auth.uid());
 INSERT INTO sales_lite2.return_details(return_id,parcel_instance_id,applied_damage,request_snapshot,plan_snapshot)
 VALUES(rid,NULLIF(item->>'parcel_instance_id','')::UUID,(plan->>'customerDamageDeductionInMinorUnits')::BIGINT,request,plan);
 result:=jsonb_build_object('success',true,'contractVersion',215,'operationId',rid,'returnOperationId',rid,'returnId',rid,'returnNumber','L2R-'||rid::TEXT,'orderId',o.id,'entitlementInMinorUnits',plan->'entitlementInMinorUnits',
  'debtReductionInMinorUnits',plan->'debtReductionInMinorUnits','moneyRefundInMinorUnits',plan->'moneyRefundInMinorUnits','accountingTracked',false,
  'goodQuantity',plan->'goodQuantity','badQuantity',plan->'badQuantity','customerDamageQuantity',plan->'customerDamageQuantity',
  'refundMethod',CASE WHEN(plan->>'moneyRefundInMinorUnits')::BIGINT>0 THEN method ELSE NULL END);
 INSERT INTO public.audit_logs(user_id,action,entity_name,entity_id,details) VALUES(auth.uid(),'LITE2_RETURN','orders',o.id,jsonb_build_object('returnId',rid,'preview',p_preview));
 RETURN sales_lite1.finish(p_key,result);
END $$;
REVOKE ALL ON FUNCTION public.lite1_settle_return2(JSONB,TEXT,TEXT) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.lite1_settle_return2(JSONB,TEXT,TEXT) TO authenticated;
-- Prototype straight-unit arithmetic is not an alternative financial path.
REVOKE ALL ON FUNCTION public.lite1_return(UUID,INTEGER,TEXT,TEXT) FROM authenticated;

-- QUARANTINED. Owner-approved9Nov: narrow additional shared behavioral guard.
-- All628 original bodies and the eight approved bridge diffs stay unchanged.
CREATE FUNCTION sales_lite2.guard_shift_lite_refund() RETURNS TRIGGER
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 -- The UPDATE already owns the shift row lock. Do not add a mode/order lock
 -- with a different ordering. VOLATILE reads see a refund committed while
 -- the original reversal was waiting for that same row lock.
 IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN('cancelled','reversed') AND(EXISTS(SELECT 1 FROM sales_lite1.shifts s WHERE s.shift_id=OLD.id)
 OR EXISTS(SELECT 1 FROM public.orders o JOIN sales_lite1.orders l ON l.order_id=o.id WHERE o.cash_shift_id=OLD.id)) THEN
  RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='هذه الوردية تتبع وضع البيع المبسّط. لا يمكن إلغاؤها أو عكس عملياتها؛ استخدم المرتجع وعدّ الدرج والإغلاق اليومي.';
 END IF;
 IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN('cancelled','reversed')
 AND EXISTS(SELECT 1 FROM sales_lite1.returns r WHERE r.shift_id=OLD.id AND r.money_refund>0)
 THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='LITE2_SHIFT_REVERSAL_HAS_LITE_REFUND';END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION sales_lite2.guard_shift_lite_refund() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER lite2_guard_shift_lite_refund BEFORE UPDATE OF status ON public.cash_shifts
FOR EACH ROW WHEN(OLD.status IS DISTINCT FROM NEW.status AND NEW.status IN('cancelled','reversed'))
EXECUTE FUNCTION sales_lite2.guard_shift_lite_refund();

CREATE FUNCTION public.lite1_preview_shift_reversal2(p_shift_id UUID) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE result JSONB;
BEGIN
 -- Preserve the existing owner/MFA permission check and full-only JSON.
 result:=public.preview_cash_shift_full_reversal(p_shift_id);
 IF EXISTS(SELECT 1 FROM sales_lite1.shifts s WHERE s.shift_id=p_shift_id)
 OR EXISTS(SELECT 1 FROM public.orders o JOIN sales_lite1.orders l ON l.order_id=o.id WHERE o.cash_shift_id=p_shift_id) THEN
  RETURN result||jsonb_build_object('canExecute',false,'liteShiftBlocked',true,'operations',
   COALESCE(result->'operations','[]'::JSONB)||jsonb_build_array(jsonb_build_object('operationType','lite_shift',
    'originalRecordId',p_shift_id,'status','BLOCKED','reason','هذه الوردية تتبع وضع البيع المبسّط. لا يمكن إلغاؤها أو عكس عملياتها؛ استخدم المرتجع وعدّ الدرج والإغلاق اليومي.','expectedEffect','{}'::JSONB)));
 END IF;
 IF EXISTS(SELECT 1 FROM sales_lite1.returns r WHERE r.shift_id=p_shift_id AND r.money_refund>0) THEN
  RETURN result||jsonb_build_object('canExecute',false,'liteMonetaryRefundBlocked',true,'operations',
   COALESCE(result->'operations','[]'::JSONB)||jsonb_build_array(jsonb_build_object(
    'operationType','lite_monetary_refund','originalRecordId',p_shift_id,'status','BLOCKED',
    'reason','الوردية تتضمن ردّ مبلغ لفاتورة قديمة بلا مخزون. لا يمكن إلغاؤها أو عكسها؛ استخدم عدّ الدرج والإغلاق اليومي.',
    'expectedEffect','{}'::JSONB)));
 END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.lite1_preview_shift_reversal2(UUID) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.lite1_preview_shift_reversal2(UUID) TO authenticated;

-- QUARANTINED owner-only read model. Same physical/financial UI contract,
-- independent immutable lite evidence; no frozen context or bridge is changed.
CREATE FUNCTION public.lite1_aftercare_context2(p_order_id UUID) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE o public.orders;completed TIMESTAMPTZ;financial RECORD;
BEGIN
 PERFORM sales_lite1.owner();
 SELECT * INTO o FROM public.orders WHERE id=p_order_id;
 SELECT completed_at INTO completed FROM sales_lite1.completions WHERE order_id=p_order_id;
 IF NOT sales_lite1.is_order(p_order_id) OR o.status IS DISTINCT FROM 'completed' OR completed IS NULL THEN RAISE EXCEPTION 'LITE2_ORDER_CONTEXT_INVALID';END IF;
 SELECT * INTO financial FROM public.phase42_order_financial_position_internal(p_order_id);
 RETURN jsonb_build_object('contractVersion',403,'serverTime',statement_timestamp(),'supported',true,'capability','sales_only','accountingTracked',false,
  'order',jsonb_build_object('id',o.id,'orderNumber',o.order_number,'status',o.status,'saleContract','lite2','branchId',o.branch_id,'warehouseId',o.warehouse_id,
   'completedAt',completed,'deadlineAt',completed+interval '48 hours','withinWindow',statement_timestamp()<=completed+interval '48 hours'),
  'financial',jsonb_build_object('merchandiseDebtInMinorUnits',financial.merchandise_debt_in_minor_units,'refundableCollectedInMinorUnits',financial.refundable_collected_in_minor_units,'deliveryFeeInMinorUnits',financial.delivery_fee_in_minor_units),
  'baseItems',COALESCE((SELECT jsonb_agg(jsonb_build_object('orderItemId',i.id,'productId',i.product_id,'quantity',i.quantity,
    'parcelOnly',public.parcel209_effective_only_internal(i.product_id),'commercialLineKind',i.commercial_line_kind,
    'unitsPerParcel',CASE WHEN i.commercial_line_kind='legacy_single_sku_parcel' THEN i.units_per_sale_package ELSE 1 END,
    'commercialQuantity',COALESCE(i.sale_package_quantity,i.quantity),'standalonePriceInMinorUnits',sales_lite2.sale_packet_price(o.id,i.id,NULL),
    'remainingQuantity',GREATEST(i.quantity-used.quantity,0),
    'physicalRepresentatives',CASE WHEN i.quantity>used.quantity THEN jsonb_build_array(jsonb_build_object('sourceKind','base_order_item','sourceId',i.id,'productId',i.product_id,'remainingQuantity',i.quantity-used.quantity,'parentReplacementItemId',NULL,
     'unitsPerParcel',CASE WHEN i.commercial_line_kind='legacy_single_sku_parcel' THEN i.units_per_sale_package ELSE 1 END,'isSingleSkuParcel',i.commercial_line_kind='legacy_single_sku_parcel')) ELSE '[]'::JSONB END) ORDER BY i.id)
    FROM public.order_items i CROSS JOIN LATERAL(SELECT COALESCE(sum(r.quantity),0)::INTEGER quantity FROM sales_lite1.returns r WHERE r.item_id=i.id) used
    WHERE i.order_id=o.id AND i.commercial_line_kind IN('base_unit','legacy_single_sku_parcel')),'[]'::JSONB),
  'parcelInstances',COALESCE((SELECT jsonb_agg(jsonb_build_object('parcelInstanceId',i.id,'orderItemId',i.order_item_id,'components',
    (SELECT jsonb_agg(jsonb_build_object('parcelComponentId',c.id,'productId',c.product_id,'quantity',c.base_quantity,'parcelOnly',public.parcel209_effective_only_internal(c.product_id),
     'physicalRepresentatives',jsonb_build_array(jsonb_build_object('sourceKind','parcel_component','sourceId',c.id,'productId',c.product_id,'remainingQuantity',c.base_quantity,'parentReplacementItemId',NULL))) ORDER BY c.id)
     FROM public.order_parcel_components c WHERE c.parcel_instance_id=i.id)) ORDER BY i.instance_sequence)
    FROM public.order_parcel_instances i WHERE i.order_id=o.id AND NOT EXISTS(SELECT 1 FROM sales_lite2.return_details d WHERE d.parcel_instance_id=i.id)),'[]'::JSONB),
  'returns',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',r.id,'returnNumber','L2R-'||r.id::TEXT,'createdAt',r.created_at,'quantity',r.quantity) ORDER BY r.created_at,r.id) FROM sales_lite1.returns r WHERE r.order_id=o.id),'[]'::JSONB),'replacements','[]'::JSONB);
END $$;
REVOKE ALL ON FUNCTION public.lite1_aftercare_context2(UUID) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.lite1_aftercare_context2(UUID) TO authenticated;

CREATE FUNCTION public.lite1_order_details2(p_order_id UUID) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE o public.orders;recipient JSONB;card public.customers;reused BOOLEAN;proposal JSONB;financial RECORD;
BEGIN
 PERFORM sales_lite1.owner();SELECT * INTO o FROM public.orders WHERE id=p_order_id;
 IF NOT sales_lite1.is_order(p_order_id) THEN RAISE EXCEPTION 'LITE2_ORDER_CONTEXT_INVALID';END IF;
 SELECT l.recipient,COALESCE((b.result_snapshot->>'customer_reused')::BOOLEAN,false) INTO recipient,reused
 FROM sales_lite1.orders l JOIN public.business_operations b ON b.id=l.operation_id WHERE l.order_id=p_order_id;
 SELECT * INTO card FROM public.customers WHERE id=o.customer_id;
 SELECT COALESCE(jsonb_object_agg(key,value),'{}') INTO proposal FROM jsonb_each(recipient)
 WHERE key IN('fullName','governorate','city','area','street','building','addressNotes');
 SELECT * INTO financial FROM public.phase42_order_financial_position_internal(o.id);
 RETURN jsonb_build_object('contractVersion','lite2-order-details-v1','orderId',o.id,'accountingTracked',false,
  'amountPaidInMinorUnits',o.amount_paid_in_minor_units,'amountDueInMinorUnits',financial.outstanding_total_in_minor_units,
  'recipientProposal',CASE WHEN o.source='website' THEN jsonb_build_object('proposed',reused,'recipient',proposal,
   'customerCard',jsonb_build_object('fullName',card.full_name,'governorate',card.governorate,'defaultAddress',
    (SELECT a.formatted_address FROM public.customer_addresses a WHERE a.customer_id=card.id AND a.is_default ORDER BY a.id LIMIT 1))) ELSE NULL END);
END $$;
REVOKE ALL ON FUNCTION public.lite1_order_details2(UUID) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.lite1_order_details2(UUID) TO authenticated;

CREATE FUNCTION public.lite1_customer_statement2(p_customer_id UUID,p_page INTEGER DEFAULT 1,p_page_size INTEGER DEFAULT 25) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $lite_statement$
DECLARE
  v_page INTEGER := COALESCE(p_page, 1);
  v_size INTEGER := LEAST(COALESCE(p_page_size, 25), 100);
  v_result JSONB;
  v_evidence_total BIGINT;
  v_canonical BIGINT;
BEGIN
  PERFORM sales_lite1.owner();
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'accountant', 'sales'],
    'عرض كشف حساب العميل'
  );
  IF p_customer_id IS NULL OR v_page < 1 OR v_size < 1 THEN
    RAISE EXCEPTION 'معرّف العميل ورقم الصفحة وحجمها مطلوبون وصالحون.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.customers WHERE id = p_customer_id) THEN
    RETURN NULL;
  END IF;

  WITH scoped AS MATERIALIZED (
    SELECT o.* FROM public.orders o
    WHERE o.customer_id = p_customer_id
      AND (COALESCE(o.source, 'website') <> 'pos' OR o.payment_method = 'debt')
      AND (o.status IN ('completed', 'delivered') OR EXISTS (
        SELECT 1 FROM public.pos_sale_reversals r WHERE r.order_id = o.id
          AND (r.actual_effect->>'customer_receivable_in_minor_units')::BIGINT > 0
      ))
  ), vouchers AS MATERIALIZED (
    SELECT p.* FROM public.customer_payments p JOIN scoped o ON o.id = p.order_id
  ), active_payments AS (
    SELECT order_id, SUM(amount_in_minor_units)::BIGINT AS amount
    FROM vouchers WHERE NOT is_reversed GROUP BY order_id
  ), completion_history AS (
    SELECT h.order_id, MIN(h.created_at) AS at
    FROM public.order_status_history h JOIN scoped o ON o.id = h.order_id
    WHERE h.new_status = 'completed' GROUP BY h.order_id
  ), completion_operations AS (
    SELECT o.id AS order_id, MIN(b.completed_at) AS at
    FROM scoped o JOIN public.business_operations b
      ON b.operation_type = 'phase3_customer_completion_v1'
      AND b.result_snapshot->>'order_id' = o.id::TEXT
      AND b.request_identity_snapshot->>'order_id' = o.id::TEXT
      AND b.completed_at IS NOT NULL GROUP BY o.id
  ), exposure AS (
    SELECT o.id, o.order_number,
      LEAST(o.total_in_minor_units, GREATEST(
        o.total_in_minor_units - o.amount_paid_in_minor_units
          + COALESCE(p.amount, 0), 0))::BIGINT AS amount,
      COALESCE(h.at, c.at, (SELECT completed_at FROM sales_lite1.completions WHERE order_id=o.id), CASE
        WHEN creation.operation_type = 'phase3_pos_sale_v1'
          AND creation.result_snapshot->>'orderId' = o.id::TEXT
        THEN creation.completed_at END) AS at
    FROM scoped o LEFT JOIN active_payments p ON p.order_id = o.id
    LEFT JOIN completion_history h ON h.order_id = o.id
    LEFT JOIN completion_operations c ON c.order_id = o.id
    LEFT JOIN public.business_operations creation ON creation.id = o.operation_id
  ), movements AS (
    SELECT 'sale:' || id::TEXT AS movement_id, 'sale_debt'::TEXT AS movement_type,
      'دين بيع'::TEXT AS type_label, id AS order_id, order_number AS reference,
      at AS occurred_at, amount AS debit_in_minor_units, 0::BIGINT AS credit_in_minor_units
    FROM exposure WHERE amount > 0
    UNION ALL
    SELECT 'payment:' || p.id::TEXT, 'payment', CASE WHEN p.payment_method='cheque' THEN 'تحصيل بشيك مؤجل' ELSE 'دفعة عميل' END, p.order_id,
      p.payment_number, p.created_at, 0, p.amount_in_minor_units
    FROM vouchers p
    UNION ALL
    SELECT 'payment_reversal:' || p.id::TEXT, 'payment_reversal', 'عكس دفعة',
      p.order_id, p.payment_number, p.reversed_at, p.amount_in_minor_units, 0
    FROM vouchers p WHERE p.is_reversed
    UNION ALL
    SELECT 'return:' || e.id::TEXT, 'return_debt_reduction', 'تخفيض دين بمرتجع',
      e.order_id, o.order_number, e.settled_at, 0, e.debt_reduction_amount_in_minor_units
    FROM public.sales_return_events e JOIN scoped o ON o.id = e.order_id
    WHERE e.settlement_status = 'settled' AND e.contract_version = 401
      AND e.debt_reduction_amount_in_minor_units > 0
    UNION ALL
    SELECT 'lite_return:'||r.id::TEXT, 'return_debt_reduction', 'تخفيض دين بمرتجع',
      r.order_id, o.order_number, r.created_at, 0, r.debt_reduction
    FROM sales_lite1.returns r JOIN scoped o ON o.id=r.order_id
    WHERE r.debt_reduction>0 AND sales_lite1.is_order(r.order_id)
    UNION ALL
    SELECT 'sale_reversal:' || r.id::TEXT, 'sale_reversal', 'عكس دين بيع',
      r.order_id, o.order_number, r.created_at, 0,
      (r.actual_effect->>'customer_receivable_in_minor_units')::BIGINT
    FROM public.pos_sale_reversals r JOIN scoped o ON o.id = r.order_id
    WHERE (r.actual_effect->>'customer_receivable_in_minor_units')::BIGINT > 0
    UNION ALL
    -- 161: pre-system balance at its original date; a reversal keeps the
    -- original debit and adds its own credit, like a voucher reversal.
    SELECT 'opening:' || b.id::TEXT, 'opening_balance', 'رصيد سابق قبل النظام',
      NULL::UUID, b.entry_number, b.occurred_at, b.amount_in_minor_units, 0
    FROM public.customer_opening_balances b WHERE b.customer_id = p_customer_id
    UNION ALL
    SELECT 'opening_reversal:' || b.id::TEXT, 'opening_balance_reversal', 'عكس رصيد سابق',
      NULL::UUID, b.entry_number, b.reversed_at, 0, b.amount_in_minor_units
    FROM public.customer_opening_balances b
    WHERE b.customer_id = p_customer_id AND b.is_reversed
    UNION ALL
    -- 163: the opening part of a unified collection, and its reversal. Order
    -- parts are ordinary customer_payments and appear as payments above.
    SELECT 'opening_collection:' || c.id::TEXT, 'opening_collection', 'تحصيل دين قديم',
      NULL::UUID, c.operation_number, c.created_at, 0, c.opening_amount_in_minor_units
    FROM public.customer_collection_operations c
    WHERE c.customer_id = p_customer_id AND c.opening_amount_in_minor_units > 0
    UNION ALL
    SELECT 'opening_collection_reversal:' || c.id::TEXT, 'opening_collection_reversal', 'عكس تحصيل دين قديم',
      NULL::UUID, c.operation_number, c.reversed_at, c.opening_amount_in_minor_units, 0
    FROM public.customer_collection_operations c
    WHERE c.customer_id = p_customer_id AND c.opening_amount_in_minor_units > 0 AND c.is_reversed
    UNION ALL
    SELECT 'cheque_claim:'||c.id::TEXT,
      CASE WHEN c.claim_kind='returned' THEN 'cheque_return_compensation' ELSE 'cheque_cancellation_compensation' END,
      CASE WHEN c.claim_kind='returned' THEN 'شيك راجع' ELSE 'إلغاء تسجيل شيك' END,
      NULL::UUID,c.reference,c.created_at,c.amount_in_minor_units,0
    FROM public.cheque_compensation_claims c WHERE c.party_kind='customer' AND c.party_id=p_customer_id
    UNION ALL
    SELECT 'cheque_claim_collection:'||c.id::TEXT,'cheque_claim_collection','تحصيل قيد شيك',
      NULL::UUID,c.operation_number,c.created_at,0,c.compensation_amount_in_minor_units
    FROM public.customer_collection_operations c WHERE c.customer_id=p_customer_id AND c.compensation_amount_in_minor_units>0
    UNION ALL
    SELECT 'cheque_claim_collection_reversal:'||c.id::TEXT,'cheque_claim_collection_reversal','عكس تحصيل قيد شيك',
      NULL::UUID,c.operation_number,c.reversed_at,c.compensation_amount_in_minor_units,0
    FROM public.customer_collection_operations c WHERE c.customer_id=p_customer_id AND c.compensation_amount_in_minor_units>0 AND c.is_reversed
  ), running AS MATERIALIZED (
    SELECT m.*, ROW_NUMBER() OVER (
      ORDER BY occurred_at NULLS FIRST, movement_id COLLATE "C") AS sequence,
      SUM(debit_in_minor_units - credit_in_minor_units) OVER (
        ORDER BY occurred_at NULLS FIRST, movement_id COLLATE "C"
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)::BIGINT AS balance_in_minor_units
    FROM movements m
  ), page_rows AS MATERIALIZED (
    SELECT * FROM running ORDER BY sequence DESC
    OFFSET (v_page::BIGINT - 1) * v_size LIMIT v_size
  )
  SELECT JSONB_BUILD_OBJECT(
    'customer_id', p_customer_id, 'page', v_page, 'page_size', v_size,
    'total_count', (SELECT COUNT(*) FROM running),
    'has_more', (v_page::BIGINT * v_size) < (SELECT COUNT(*) FROM running),
    'timezone', 'Asia/Amman',
    'closing_balance_in_minor_units', COALESCE((
      SELECT balance_in_minor_units FROM running ORDER BY sequence DESC LIMIT 1), 0),
    'page_opening_balance_in_minor_units', COALESCE((
      SELECT balance_in_minor_units - debit_in_minor_units + credit_in_minor_units
      FROM page_rows ORDER BY sequence LIMIT 1), 0),
    'page_closing_balance_in_minor_units', COALESCE((
      SELECT balance_in_minor_units FROM page_rows ORDER BY sequence DESC LIMIT 1), 0),
    'movements', COALESCE((SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
      'movement_id', movement_id, 'movement_type', movement_type, 'type_label', type_label,
      'order_id', order_id, 'reference', reference, 'occurred_at', occurred_at,
      'original_debt_at',(SELECT c.original_debt_at FROM public.cheque_compensation_claims c WHERE movement_id='cheque_claim:'||c.id::TEXT),
      'reason',(SELECT c.reason FROM public.cheque_compensation_claims c WHERE movement_id='cheque_claim:'||c.id::TEXT),
      'occurred_at_amman', TO_CHAR(occurred_at AT TIME ZONE 'Asia/Amman',
        'YYYY-MM-DD"T"HH24:MI:SS.US'),
      'date_label', CASE WHEN occurred_at IS NULL THEN 'تاريخ غير متاح' ELSE NULL END,
      'debit_in_minor_units', debit_in_minor_units, 'credit_in_minor_units', credit_in_minor_units,
      'balance_in_minor_units', balance_in_minor_units, 'sequence', sequence
    ) ORDER BY sequence DESC) FROM page_rows), '[]'::JSONB)
  ), COALESCE((SELECT SUM(debit_in_minor_units - credit_in_minor_units) FROM movements), 0)::BIGINT
  INTO v_result, v_evidence_total;

  v_canonical := public.phase42_customer_receivable_total_internal(p_customer_id);
  IF v_evidence_total IS DISTINCT FROM v_canonical THEN
    -- Do not invent an adjustment to make corrupt/incomplete history balance.
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'CUSTOMER_STATEMENT_EVIDENCE_MISMATCH: أدلة الحركات لا تطابق رصيد العميل؛ يلزم مراجعتها.',
      DETAIL = JSONB_BUILD_OBJECT('movements_in_minor_units', v_evidence_total,
        'canonical_in_minor_units', v_canonical)::TEXT;
  END IF;
  RETURN v_result||jsonb_build_object(
    'outstanding_cheques_in_minor_units',COALESCE((SELECT SUM(q.amount_in_minor_units) FROM public.deferred_cheques q
      WHERE q.customer_id=p_customer_id AND q.status IN ('pending','endorsed')),0),
    'has_returned_cheque',EXISTS(SELECT 1 FROM public.deferred_cheques q WHERE q.customer_id=p_customer_id AND q.status='returned'));
END;
$lite_statement$;
REVOKE ALL ON FUNCTION public.lite1_customer_statement2(UUID,INTEGER,INTEGER) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.lite1_customer_statement2(UUID,INTEGER,INTEGER) TO authenticated;
-- QUARANTINED parallel readers. Provenance is immutable, not the current mode.
-- No original reader, financial formula, ACL or ledger row is changed.
CREATE FUNCTION public.lite1_statement_dispatch2(p_customer_id UUID,p_page INTEGER DEFAULT 1,p_page_size INTEGER DEFAULT 25)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 PERFORM public.assert_erp_role(ARRAY['owner','admin','manager','accountant','sales'],'عرض كشف حساب العميل');
 IF EXISTS(SELECT 1 FROM sales_lite1.orders l JOIN public.orders o ON o.id=l.order_id WHERE o.customer_id=p_customer_id) THEN
  RETURN public.lite1_customer_statement2(p_customer_id,p_page,p_page_size);
 END IF;
 RETURN public.get_customer_statement(p_customer_id,p_page,p_page_size);
END $$;
REVOKE ALL ON FUNCTION public.lite1_statement_dispatch2(UUID,INTEGER,INTEGER) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.lite1_statement_dispatch2(UUID,INTEGER,INTEGER) TO authenticated;

CREATE FUNCTION public.lite1_public_pos_receipt2(p_receipt_token UUID) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE receipt JSONB;payment JSONB;
BEGIN
 -- The original token/source/status gate and sanitized commercial lines run
 -- first, unchanged. An unknown token never reaches private evidence.
 receipt:=public.get_public_pos_receipt(p_receipt_token);
 IF receipt->>'success' IS DISTINCT FROM 'true' THEN RETURN receipt;END IF;
 SELECT jsonb_strip_nulls(jsonb_build_object('amountPaidInMinorUnits',o.amount_paid_in_minor_units,
  'remainingInMinorUnits',f.outstanding_total_in_minor_units,'initialPaymentMethod',p.payment_method)) INTO payment
 FROM public.orders o JOIN sales_lite2.sales s ON s.order_id=o.id
 LEFT JOIN public.customer_payments p ON p.id=s.initial_payment_id
 CROSS JOIN LATERAL public.phase42_order_financial_position_internal(o.id) f
 WHERE o.public_receipt_token=p_receipt_token AND o.source='pos' AND o.status IN('completed','returned');
 RETURN receipt||COALESCE(payment,'{}'::JSONB);
END $$;
REVOKE ALL ON FUNCTION public.lite1_public_pos_receipt2(UUID) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.lite1_public_pos_receipt2(UUID) TO anon,authenticated;

-- QUARANTINED reader. The full immutable snapshot/writers are never changed.
-- A full shift may refund a pre-activation, uncosted invoice. Its drawer money
-- remains authoritative; do not publish a misleading complete profit report.
CREATE FUNCTION public.lite1_shift_closing2(p_shift_id UUID) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE original JSONB;lite_count BIGINT;cash BIGINT;cliq BIGINT;summary JSONB;
BEGIN
 original:=public.get_cash_shift_closing_report(p_shift_id);
 IF COALESCE(original->>'success','false')<>'true' OR original->>'accountingTracked'='false' THEN RETURN original;END IF;
 SELECT count(*),COALESCE(sum(money_refund) FILTER(WHERE method='cash'),0),COALESCE(sum(money_refund) FILTER(WHERE method='cliq'),0)
 INTO lite_count,cash,cliq FROM sales_lite1.returns WHERE shift_id=p_shift_id AND money_refund>0;
 IF lite_count=0 THEN RETURN original;END IF;
 PERFORM sales_lite1.owner();
 summary:=original->'shift';
 IF jsonb_typeof(summary) IS DISTINCT FROM 'object' OR original#>>'{sales,orderCount}' IS NULL
 OR original#>>'{outflows,returnCount}' IS NULL
 OR (summary->>'cashRefundsInMinorUnits')::BIGINT<cash OR (summary->>'cliqRefundsInMinorUnits')::BIGINT<cliq
 OR original#>>'{outflows,cashRefundsInMinorUnits}' IS DISTINCT FROM summary->>'cashRefundsInMinorUnits'
 OR original#>>'{outflows,cliqRefundsInMinorUnits}' IS DISTINCT FROM summary->>'cliqRefundsInMinorUnits'
 THEN RAISE EXCEPTION 'LITE2_MIXED_SHIFT_EVIDENCE_MISMATCH';END IF;
 RETURN jsonb_build_object('success',true,'accountingTracked',false,'historyWithoutCost',true,'contractVersion','lite2-mixed-shift-v1',
 'shiftId',p_shift_id,'summary',summary,'reconciliation',original->'reconciliation','snapshotStatus',original->'snapshotStatus',
 'orderCount',(original#>>'{sales,orderCount}')::BIGINT,'returnCount',(original#>>'{outflows,returnCount}')::BIGINT+lite_count,
 'returnMoneyInMinorUnits',(summary->>'cashRefundsInMinorUnits')::BIGINT+(summary->>'cliqRefundsInMinorUnits')::BIGINT,
 'cashExpensesInMinorUnits',(summary->>'cashExpensesInMinorUnits')::BIGINT);
END $$;
REVOKE ALL ON FUNCTION public.lite1_shift_closing2(UUID) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.lite1_shift_closing2(UUID) TO authenticated;

-- QUARANTINED metadata only. Original documents and reader are unchanged.
CREATE FUNCTION sales_lite2.drawer_metadata(p_source TEXT,p_id UUID) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE oid UUID;
BEGIN
 IF p_source<>'lite_return' THEN RETURN public.trial212_cash_metadata_internal(p_source,p_id);END IF;
 SELECT order_id INTO oid FROM sales_lite1.returns WHERE id=p_id AND money_refund>0;
 IF oid IS NULL THEN RAISE EXCEPTION 'LITE2_DRAWER_RETURN_EVIDENCE_MISSING';END IF;
 RETURN public.trial212_cash_metadata_internal('order',oid);
END $$;
REVOKE ALL ON FUNCTION sales_lite2.drawer_metadata(TEXT,UUID) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION sales_lite2.drawer_page(p_shift_id UUID,p_kind TEXT,p_method TEXT,p_page INTEGER,p_page_size INTEGER) RETURNS JSONB
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $drawer_body$
DECLARE
  v_shift public.cash_shifts%ROWTYPE;
  v_summary JSONB;
  v_key TEXT;
  v_canonical BIGINT;
  v_end TIMESTAMPTZ;
  v_result JSONB;
BEGIN
  PERFORM public.assert_erp_role(ARRAY['owner','admin','manager','accountant'], 'عرض تفاصيل حركة الوردية');
  IF p_shift_id IS NULL OR p_kind IS NULL OR p_method IS NULL
    OR p_kind NOT IN ('sales','receipts','supplier_payments','expenses','refunds','withdrawals','withdrawal_returns')
    OR p_method NOT IN ('cash','cliq','card')
    OR (p_method='card' AND p_kind<>'sales')
    OR (p_kind IN ('withdrawals','withdrawal_returns') AND p_method<>'cash')
    OR p_page IS NULL OR p_page<1 OR p_page>1000000
    OR p_page_size IS NULL OR p_page_size<1 OR p_page_size>100
  THEN RAISE EXCEPTION 'معايير تفاصيل الوردية غير صالحة.' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_shift FROM public.cash_shifts WHERE id=p_shift_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'الوردية المحددة غير موجودة.' USING ERRCODE='22023'; END IF;
  v_summary:=public.get_cash_shift_summary(p_shift_id);
  v_end:=CASE WHEN v_shift.status='open' THEN NOW() ELSE COALESCE(v_shift.closed_at,NOW()) END;
  v_key:=CASE p_kind
    WHEN 'sales' THEN p_method||'SalesInMinorUnits'
    WHEN 'receipts' THEN p_method||'ReceiptsInMinorUnits'
    WHEN 'supplier_payments' THEN p_method||'SupplierPaymentsInMinorUnits'
    WHEN 'expenses' THEN p_method||'ExpensesInMinorUnits'
    WHEN 'refunds' THEN p_method||'RefundsInMinorUnits'
    WHEN 'withdrawals' THEN 'ownerWithdrawalsInMinorUnits'
    WHEN 'withdrawal_returns' THEN 'ownerWithdrawalReturnsInMinorUnits' END;
  v_canonical:=(v_summary->>v_key)::BIGINT;
  -- 044 fallback attribution and 078 reversal predicates are retained exactly.
  -- In particular a legacy reversed receipt with NULL shift still belongs to
  -- the old aggregate; it is labelled, never silently corrected by this reader.
  WITH attributed_sales AS (
    SELECT o.id,o.order_number,o.payment_method,o.total_in_minor_units,
      COALESCE((SELECT completed_at FROM sales_lite1.completions WHERE order_id=o.id),(SELECT MIN(h.created_at) FROM public.order_status_history h
        WHERE h.order_id=o.id AND h.new_status='completed'),o.updated_at) at,
      o.cash_shift_id
    FROM public.orders o WHERE p_kind='sales' AND o.branch_id=v_shift.branch_id
      AND o.status IN ('completed','returned')
      AND (o.payment_method::TEXT=p_method OR (p_method='cash' AND o.payment_method='cash_on_delivery'))
  ), evidence(source,id,reference,at,method,amount,note) AS (
    SELECT 'order'::TEXT,o.id,o.order_number,o.at,p_method,o.total_in_minor_units,NULL::TEXT
    FROM attributed_sales o WHERE o.cash_shift_id=p_shift_id OR
      (o.cash_shift_id IS NULL AND o.at>=v_shift.opened_at AND o.at<=v_end)
    UNION ALL
    SELECT 'customer_payment',cp.id,o.order_number,cp.created_at,cp.payment_method::TEXT,cp.amount_in_minor_units,
      CASE WHEN cp.is_reversed THEN 'سند تاريخي بلا وردية؛ محفوظ ضمن إجمالي القارئ القديم' END
    FROM public.customer_payments cp JOIN public.orders o ON o.id=cp.order_id
    WHERE p_kind='receipts' AND cp.payment_method::TEXT=p_method AND o.branch_id=v_shift.branch_id
      AND o.payment_method='debt' AND (cp.cash_shift_id=p_shift_id OR
        (cp.cash_shift_id IS NULL AND cp.created_at>=v_shift.opened_at AND cp.created_at<=v_end))
      AND NOT (COALESCE(cp.is_reversed,false) AND cp.cash_shift_id IS NOT NULL)
    UNION ALL
    SELECT 'opening_collection',c.id,c.operation_number,c.created_at,c.payment_method::TEXT,c.opening_amount_in_minor_units,'تحصيل دين البداية'
    FROM public.customer_collection_operations c WHERE p_kind='receipts' AND c.cash_shift_id=p_shift_id
      AND NOT c.is_reversed AND c.payment_method::TEXT=p_method AND c.opening_amount_in_minor_units>0
    UNION ALL
    SELECT 'cheque_collection',c.id,c.operation_number,c.created_at,c.payment_method::TEXT,c.compensation_amount_in_minor_units,'تحصيل تعويض شيك'
    FROM public.customer_collection_operations c WHERE p_kind='receipts' AND c.cash_shift_id=p_shift_id
      AND NOT c.is_reversed AND c.payment_method::TEXT=p_method AND c.compensation_amount_in_minor_units>0
    UNION ALL
    SELECT 'supplier_payment',sp.id,COALESCE(sr.receipt_number,po.purchase_order_number,sp.id::TEXT),sp.payment_date,sp.payment_method::TEXT,sp.amount_in_minor_units,NULL::TEXT
    FROM public.supplier_payments sp LEFT JOIN public.purchase_orders po ON po.id=sp.purchase_order_id
      LEFT JOIN public.supplier_receipts sr ON sr.id=sp.supplier_receipt_id
    WHERE p_kind='supplier_payments' AND sp.payment_method::TEXT=p_method
      AND COALESCE(po.branch_id,sr.branch_id)=v_shift.branch_id AND NOT COALESCE(sp.is_reversed,false)
      AND (sp.cash_shift_id=p_shift_id OR (sp.cash_shift_id IS NULL AND sp.payment_date>=v_shift.opened_at AND sp.payment_date<=v_end))
    UNION ALL
    SELECT 'supplier_opening_payment',sp.id,sp.id::TEXT,sp.payment_date,sp.payment_method::TEXT,sp.amount_in_minor_units,'دفعة دين بداية لمورد'
    FROM public.supplier_opening_payments l JOIN public.supplier_payments sp ON sp.id=l.supplier_payment_id
    WHERE p_kind='supplier_payments' AND l.cash_shift_id=p_shift_id AND sp.payment_method::TEXT=p_method AND NOT COALESCE(sp.is_reversed,false)
    UNION ALL
    SELECT 'supplier_cheque_payment',sp.id,c.reference,sp.payment_date,sp.payment_method::TEXT,l.amount_in_minor_units,'دفعة تعويض شيك لمورد'
    FROM public.supplier_cheque_claim_payments l JOIN public.supplier_payments sp ON sp.id=l.supplier_payment_id
      JOIN public.cheque_compensation_claims c ON c.id=l.claim_id
    WHERE p_kind='supplier_payments' AND l.cash_shift_id=p_shift_id AND sp.payment_method::TEXT=p_method AND NOT sp.is_reversed
    UNION ALL
    SELECT 'expense',e.id,e.expense_number,e.created_at,e.payment_method::TEXT,e.amount_in_minor_units,e.description
    FROM public.operational_expenses e WHERE p_kind='expenses' AND e.shift_id=p_shift_id
      AND e.payment_method::TEXT=p_method AND NOT COALESCE(e.is_reversed,false)
    UNION ALL
    SELECT 'legacy_return',r.id,r.return_number,r.created_at,r.refund_method::TEXT,r.refund_amount_in_minor_units,'مرتجع تاريخي'
    FROM public.sales_returns r WHERE p_kind='refunds' AND r.cash_shift_id=p_shift_id AND r.refund_method::TEXT=p_method
    UNION ALL
    SELECT 'return_event',r.id,r.id::TEXT,r.created_at,r.refund_method::TEXT,r.money_refund_amount_in_minor_units,'مبلغ مسترد مسوّى'
    FROM public.sales_return_events r WHERE p_kind='refunds' AND r.cash_shift_id=p_shift_id AND r.refund_method::TEXT=p_method
      AND r.settlement_status='settled' AND r.money_refund_amount_in_minor_units>0
    UNION ALL
    SELECT 'order',o.id,o.order_number,x.created_at,p_method,(x.prepared_plan->>'moneyReceivedInMinorUnits')::BIGINT,'فرق مستلم من تبديل بصنف آخر'
    FROM public.aftercare215_exchanges x JOIN public.aftercare215_exchange_results result ON result.operation_id=x.operation_id JOIN public.orders o ON o.id=result.new_order_id
    WHERE p_kind='sales' AND(x.prepared_plan->>'cashShiftId')::UUID=p_shift_id AND x.prepared_plan->>'differenceMethod'=p_method
     AND(x.prepared_plan->>'moneyReceivedInMinorUnits')::BIGINT>0
    UNION ALL
    SELECT 'return_event',r.id,r.return_number,x.created_at,p_method,(x.prepared_plan->>'moneyRefundInMinorUnits')::BIGINT,'فرق مرجع من تبديل بصنف آخر'
    FROM public.aftercare215_exchanges x JOIN public.aftercare215_exchange_results result ON result.operation_id=x.operation_id JOIN public.sales_return_events r ON r.operation_id=result.return_operation_id
    WHERE p_kind='refunds' AND(x.prepared_plan->>'cashShiftId')::UUID=p_shift_id AND x.prepared_plan->>'differenceMethod'=p_method
     AND(x.prepared_plan->>'moneyRefundInMinorUnits')::BIGINT>0
    UNION ALL
    SELECT 'lite_return',r.id,o.order_number,r.created_at,r.method,r.money_refund,'ردّ مبلغ لفاتورة بلا مخزون'
    FROM sales_lite1.returns r JOIN public.orders o ON o.id=r.order_id
    WHERE p_kind='refunds' AND r.shift_id=p_shift_id AND r.method=p_method AND r.money_refund>0
    UNION ALL
    SELECT 'owner_withdrawal',w.id,w.withdrawal_number,w.created_at,'cash',w.amount_in_minor_units,'سحب مالك'
    FROM public.owner_cash_withdrawals w WHERE p_kind='withdrawals' AND w.cash_shift_id=p_shift_id
    UNION ALL
    SELECT 'owner_withdrawal_return',r.id,w.withdrawal_number,r.reversed_at,'cash',r.amount_in_minor_units,
      'إرجاع سحب من '||s.shift_number
    FROM public.owner_cash_withdrawal_reversals r JOIN public.owner_cash_withdrawals w ON w.id=r.withdrawal_id
      JOIN public.cash_shifts s ON s.id=w.cash_shift_id
    WHERE p_kind='withdrawal_returns' AND r.effective_shift_id=p_shift_id AND r.voided_at IS NULL
  ), totals AS (
    SELECT COUNT(*) count,COALESCE(SUM(amount),0) amount FROM evidence
  ), page AS (
    SELECT * FROM evidence ORDER BY at DESC,id DESC,source
    LIMIT p_page_size OFFSET ((p_page::BIGINT-1)*p_page_size)
  ) SELECT jsonb_build_object(
    'shiftId',p_shift_id,'kind',p_kind,'method',p_method,'generatedAt',NOW(),
    'shiftStatus',v_shift.status,'canonicalAmountInMinorUnits',v_canonical,
    'totalAmountInMinorUnits',totals.amount,'totalCount',totals.count,
    'page',p_page,'pageSize',p_page_size,'totalPages',GREATEST(1,CEIL(totals.count::NUMERIC/p_page_size)),
    'evidenceStatus',CASE WHEN v_canonical IS NULL THEN 'unavailable' WHEN v_canonical=totals.amount THEN 'matched' ELSE 'mismatch' END,
    'rows',COALESCE((SELECT jsonb_agg(jsonb_build_object('source',source,'id',id,'reference',reference,
      'at',at,'method',method,'amountInMinorUnits',amount,'note',note)||sales_lite2.drawer_metadata(source,id) ORDER BY at DESC,id DESC,source) FROM page),'[]'::JSONB)
  ) INTO v_result FROM totals;
  RETURN v_result;
END;
$drawer_body$;
 REVOKE ALL ON FUNCTION sales_lite2.drawer_page(UUID,TEXT,TEXT,INTEGER,INTEGER) FROM PUBLIC,anon,authenticated,service_role;
 CREATE FUNCTION public.lite1_shift_movements2(p_shift_id UUID,p_kind TEXT,p_method TEXT DEFAULT 'cash',p_page INTEGER DEFAULT 1,p_page_size INTEGER DEFAULT 25) RETURNS JSONB
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$BEGIN
 IF (p_kind='sales' AND EXISTS(SELECT 1 FROM sales_lite1.orders l JOIN public.orders o ON o.id=l.order_id WHERE o.cash_shift_id=p_shift_id))
 OR(p_kind='refunds' AND EXISTS(SELECT 1 FROM sales_lite1.returns r WHERE r.shift_id=p_shift_id AND r.money_refund>0)) THEN
  RETURN sales_lite2.drawer_page(p_shift_id,p_kind,p_method,p_page,p_page_size);
 END IF;
 RETURN public.get_cash_shift_movement_page(p_shift_id,p_kind,p_method,p_page,p_page_size);
 END $$;
 REVOKE ALL ON FUNCTION public.lite1_shift_movements2(UUID,TEXT,TEXT,INTEGER,INTEGER) FROM PUBLIC,anon,authenticated,service_role;
 GRANT EXECUTE ON FUNCTION public.lite1_shift_movements2(UUID,TEXT,TEXT,INTEGER,INTEGER) TO authenticated;
CREATE FUNCTION sales_lite2.simple_facts(p_branch_id UUID,p_period_start TIMESTAMPTZ,p_period_end TIMESTAMPTZ,p_timezone TEXT,p_verify_evidence BOOLEAN)
 RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $simple$
DECLARE
  v_facts JSONB;
BEGIN
  IF p_period_start IS NULL OR p_period_end IS NULL
    OR p_period_end <= p_period_start OR NULLIF(BTRIM(p_timezone), '') IS NULL
  THEN
    RAISE EXCEPTION 'Invalid Phase 6 financial facts period.';
  END IF;

  -- Fail closed on corrupt evidence for the rows this period reports.
  IF p_verify_evidence THEN
    PERFORM public.phase42_assert_operational_return_evidence_internal(e.operation_id, true)
    FROM public.sales_return_events e
    JOIN public.orders o ON o.id = e.order_id
    JOIN public.business_operations creation ON creation.id = o.operation_id
    WHERE e.contract_version = 401 AND e.settlement_status = 'settled'
      AND creation.operation_type IN ('phase3_pos_sale_v1', 'phase3_customer_reservation_v1')
      AND (p_branch_id IS NULL OR o.branch_id = p_branch_id)
      AND e.settled_at >= p_period_start AND e.settled_at < p_period_end;

    PERFORM public.phase43_assert_operational_replacement_evidence_internal(e.operation_id, true)
    FROM public.sales_replacement_events e
    JOIN public.orders o ON o.id = e.root_order_id
    WHERE e.issuance_status = 'issued'
      AND (p_branch_id IS NULL OR o.branch_id = p_branch_id)
      AND e.issued_at >= p_period_start AND e.issued_at < p_period_end;
  END IF;

  WITH first_completion AS MATERIALIZED (
    SELECT h.order_id, MIN(h.created_at) AS at
    FROM (
      SELECT order_id,created_at FROM public.order_status_history WHERE new_status='completed'
      UNION ALL SELECT order_id,completed_at FROM sales_lite1.completions
    ) h
    GROUP BY h.order_id
  ), completion_ops AS MATERIALIZED (
    SELECT DISTINCT ON (b.result_snapshot->>'order_id')
      b.result_snapshot->>'order_id' AS order_key,
      b.result_snapshot, b.completed_at, b.request_identity_snapshot
    FROM public.business_operations b
    WHERE b.operation_type = 'phase3_customer_completion_v1'
      AND b.result_snapshot->>'order_id' = b.request_identity_snapshot->>'order_id'
    ORDER BY b.result_snapshot->>'order_id', b.completed_at, b.id
  ), order_scope AS MATERIALIZED (
    SELECT o.id, o.customer_id, o.branch_id, o.status, o.payment_method, o.delivery_fee_in_minor_units, o.total_in_minor_units, o.source, o.created_at, o.amount_paid_in_minor_units, o.operation_id, fc.at AS completion_at, creation.operation_type,
      creation.result_snapshot AS creation_result, creation.completed_at AS creation_recorded_at,
      completion.result_snapshot AS completion_result,
      completion.completed_at AS completion_recorded_at,
      completion.request_identity_snapshot AS completion_request
    FROM public.orders o
    JOIN first_completion fc ON fc.order_id = o.id
    LEFT JOIN public.business_operations creation ON creation.id = o.operation_id
    LEFT JOIN completion_ops completion ON completion.order_key = o.id::TEXT
    WHERE p_branch_id IS NULL OR o.branch_id = p_branch_id
  ), modern_returns AS MATERIALIZED (
    SELECT e.*
    FROM public.sales_return_events e JOIN order_scope o ON o.id = e.order_id
    WHERE e.contract_version = 401 AND e.settlement_status = 'settled'
      AND o.operation_type IN ('phase3_pos_sale_v1', 'phase3_customer_reservation_v1')
  ), return_rows AS (
    SELECT e.id, e.order_id, e.settled_at AS at,
      e.debt_reduction_amount_in_minor_units AS debt,
      e.money_refund_amount_in_minor_units AS refund, e.refund_method,
      e.debt_reduction_amount_in_minor_units + e.money_refund_amount_in_minor_units AS entitlement,
      0::NUMERIC AS recovery
    FROM modern_returns e
    UNION ALL
    SELECT e.id, e.order_id, e.created_at, 0, e.refund_amount_in_minor_units, e.refund_method,
      e.refund_amount_in_minor_units,
      0::NUMERIC
    FROM public.sales_returns e JOIN order_scope o ON o.id = e.order_id
    WHERE o.operation_type IS NULL OR o.operation_type NOT IN
      ('phase3_pos_sale_v1', 'phase3_customer_reservation_v1')
    UNION ALL
    SELECT r.id,r.order_id,r.created_at,r.debt_reduction,r.money_refund,r.method,r.entitlement,0::NUMERIC
    FROM sales_lite1.returns r JOIN order_scope o ON o.id=r.order_id
  ), initial_collections AS (
    SELECT o.id AS order_id,
      CASE WHEN o.operation_type = 'phase3_pos_sale_v1' THEN o.creation_recorded_at
        ELSE COALESCE(o.completion_recorded_at, o.completion_at) END AS at,
      CASE WHEN o.operation_type = 'phase3_pos_sale_v1' THEN o.creation_result->>'paymentMethod'
        WHEN o.operation_type = 'phase3_customer_reservation_v1' THEN o.completion_request->>'payment_method'
        WHEN o.payment_method = 'cash_on_delivery' THEN 'cash' ELSE o.payment_method END AS method,
      CASE WHEN o.operation_type = 'phase3_pos_sale_v1' THEN (o.creation_result->>'amountPaidInMinorUnits')::BIGINT
        WHEN o.operation_type = 'phase3_customer_reservation_v1' THEN
          CASE WHEN NULLIF(o.completion_result->>'customer_payment_number', '') IS NOT NULL THEN 0
            ELSE (o.completion_result->>'amount_paid_in_minor_units')::BIGINT END
        WHEN o.payment_method = 'debt' THEN 0 ELSE o.total_in_minor_units END AS amount
    FROM order_scope o
  ), money_events AS (
    SELECT order_id, at, method, amount AS collection, 0::BIGINT AS reversal, 0::BIGINT AS refund
    FROM initial_collections WHERE amount > 0
    UNION ALL
    SELECT p.order_id, p.created_at, p.payment_method, p.amount_in_minor_units, 0, 0
    FROM public.customer_payments p JOIN public.orders o ON o.id = p.order_id
    WHERE p_branch_id IS NULL OR o.branch_id = p_branch_id
    UNION ALL
    SELECT p.order_id, p.reversed_at, p.payment_method, 0, p.amount_in_minor_units, 0
    FROM public.customer_payments p JOIN public.orders o ON o.id = p.order_id
    WHERE p.is_reversed AND (p_branch_id IS NULL OR o.branch_id = p_branch_id)
    UNION ALL
    SELECT r.order_id, r.created_at, m.method, 0, m.amount, 0
    FROM public.pos_sale_reversals r JOIN order_scope o ON o.id = r.order_id
    CROSS JOIN LATERAL (VALUES
      ('cash', (r.actual_effect->>'cash_in_minor_units')::BIGINT),
      ('cliq', (r.actual_effect->>'cliq_in_minor_units')::BIGINT)) m(method, amount)
    WHERE m.amount > 0
    UNION ALL
    SELECT order_id, at, refund_method, 0, 0, refund FROM return_rows WHERE refund > 0
    UNION ALL
    SELECT NULL::UUID,c.created_at,c.payment_method,a.amount_in_minor_units,0,0
    FROM public.customer_collection_operations c JOIN public.customer_collection_cheque_allocations a ON a.operation_id=c.id
    JOIN public.cheque_compensation_claims k ON k.id=a.claim_id JOIN public.deferred_cheques q ON q.id=k.cheque_id
    WHERE p_branch_id IS NULL OR COALESCE(c.branch_id,q.branch_id)=p_branch_id
    UNION ALL
    SELECT NULL::UUID,c.reversed_at,c.payment_method,0,a.amount_in_minor_units,0
    FROM public.customer_collection_operations c JOIN public.customer_collection_cheque_allocations a ON a.operation_id=c.id
    JOIN public.cheque_compensation_claims k ON k.id=a.claim_id JOIN public.deferred_cheques q ON q.id=k.cheque_id
    WHERE c.is_reversed AND(p_branch_id IS NULL OR COALESCE(c.branch_id,q.branch_id)=p_branch_id)
    UNION ALL
    -- Opening allocation is not a customer_payment. The order allocation is
    -- already counted above and must never be added from collection totals.
    SELECT NULL::UUID,c.created_at,c.payment_method,a.amount_in_minor_units,0,0
    FROM public.customer_collection_operations c
    JOIN public.customer_collection_opening_allocations a ON a.operation_id=c.id
    WHERE p_branch_id IS NULL OR COALESCE(c.branch_id,public.go_live_main_branch_internal())=p_branch_id
    UNION ALL
    SELECT NULL::UUID,c.reversed_at,c.payment_method,0,a.amount_in_minor_units,0
    FROM public.customer_collection_operations c
    JOIN public.customer_collection_opening_allocations a ON a.operation_id=c.id
    WHERE c.is_reversed AND (p_branch_id IS NULL OR COALESCE(c.branch_id,public.go_live_main_branch_internal())=p_branch_id)
  ), coverage_by_order AS (
    SELECT order_id, SUM(collection - reversal)::BIGINT AS coverage
    FROM money_events GROUP BY order_id
  ), debt_by_order AS (
    SELECT order_id, SUM(debt)::BIGINT AS debt_reduction
    FROM return_rows GROUP BY order_id
  ), positions AS (
    SELECT o.id, o.customer_id, o.status, o.total_in_minor_units,
      COALESCE(c.coverage, 0)::BIGINT AS coverage,
      COALESCE(d.debt_reduction, 0)::BIGINT AS debt_reduction,
      GREATEST(o.total_in_minor_units - COALESCE(c.coverage, 0) - COALESCE(d.debt_reduction, 0), 0)::BIGINT AS due
    FROM order_scope o
    LEFT JOIN coverage_by_order c ON c.order_id = o.id
    LEFT JOIN debt_by_order d ON d.order_id = o.id
  ), period_sales AS (
    SELECT * FROM order_scope WHERE status IN ('completed', 'returned')
      AND completion_at >= p_period_start AND completion_at < p_period_end
  ), sales_totals AS (
    SELECT COALESCE(SUM(total_in_minor_units), 0)::BIGINT AS gross,
      COALESCE(SUM(delivery_fee_in_minor_units), 0)::BIGINT AS delivery,
      COUNT(*) AS count FROM period_sales
  ), period_returns AS (
    SELECT COALESCE(SUM(entitlement), 0)::BIGINT AS entitlement,
      COALESCE(SUM(refund), 0)::BIGINT AS refund, COALESCE(SUM(debt), 0)::BIGINT AS debt,
      ROUND(COALESCE(SUM(recovery), 0))::BIGINT AS recovery, COUNT(*) AS count
    FROM return_rows WHERE at >= p_period_start AND at < p_period_end
  ), flows AS (
    SELECT COALESCE(SUM(collection - reversal) FILTER (WHERE method = 'cash'), 0)::BIGINT AS cash_received,
      COALESCE(SUM(collection - reversal) FILTER (WHERE method = 'cliq'), 0)::BIGINT AS cliq_received,
      COALESCE(SUM(collection-reversal) FILTER(WHERE method='bank_transfer'),0)::BIGINT AS bank_received,
      COALESCE(SUM(collection-reversal) FILTER(WHERE method='cheque'),0)::BIGINT AS cheque_received,
      COALESCE(SUM(collection-reversal) FILTER(WHERE COALESCE(method,'') NOT IN ('cash','cliq','bank_transfer','cheque')),0)::BIGINT AS other_received,
      COALESCE(SUM(collection-reversal),0)::BIGINT AS total_received,
      COALESCE(SUM(refund) FILTER (WHERE method = 'cash'), 0)::BIGINT AS cash_refunded,
      COALESCE(SUM(refund) FILTER (WHERE method = 'cliq'), 0)::BIGINT AS cliq_refunded
    FROM money_events WHERE at >= p_period_start AND at < p_period_end
  ), eligible AS MATERIALIZED (
    SELECT o.id, o.customer_id, o.total_in_minor_units,
      o.amount_paid_in_minor_units, o.operation_id
    FROM public.orders o
    WHERE o.status IN ('completed', 'delivered')
      AND o.customer_id IS NOT NULL
      AND (p_branch_id IS NULL OR o.branch_id = p_branch_id)
      AND (COALESCE(o.source, 'website') <> 'pos' OR o.payment_method = 'debt')
  ), prior_debt AS MATERIALIZED (
    -- Exact set-based form of121 phase42_order_financial_position_internal's
    -- prior_debt source. Do not introduce a projection/cache or new authority.
    SELECT e.order_id, SUM(e.debt_reduction_amount_in_minor_units)::BIGINT AS amount
    FROM public.sales_return_events e JOIN eligible o ON o.id = e.order_id
    WHERE e.settlement_status = 'settled' AND e.contract_version = 401
      AND o.amount_paid_in_minor_units < o.total_in_minor_units
    GROUP BY e.order_id
  ), financial_positions AS MATERIALIZED (
    SELECT o.*, CASE
      WHEN o.amount_paid_in_minor_units >= o.total_in_minor_units THEN 0::BIGINT
      ELSE GREATEST(o.total_in_minor_units - o.amount_paid_in_minor_units
        - COALESCE(d.amount, 0) - COALESCE((SELECT sum(r.debt_reduction) FROM sales_lite1.returns r WHERE r.order_id=o.id),0), 0)::BIGINT END AS outstanding
    FROM eligible o LEFT JOIN prior_debt d ON d.order_id = o.id
  ), canonical_order_due AS (
    -- Same set-based canonical positions used by192 aging/CRM;see parity guard.
    SELECT id, customer_id, outstanding AS due FROM financial_positions
  ), opening_due AS (
    -- Preserve164 main-branch attribution;do not clamp signed source values.
    SELECT opening.customer_id, opening.outstanding AS due
    FROM public.go_live_customer_opening_positions_internal(NULL) opening
    WHERE p_branch_id IS NULL OR p_branch_id = public.go_live_main_branch_internal()
  ), balances AS (
    SELECT COALESCE(SUM(due), 0)::BIGINT AS due,
      COUNT(*) FILTER (WHERE due > 0 AND is_order) AS orders,
      COUNT(DISTINCT customer_id) FILTER (WHERE due > 0) AS customers
    FROM (
      SELECT true AS is_order, customer_id, due FROM canonical_order_due
      UNION ALL
      SELECT false, customer_id, due FROM opening_due
      UNION ALL
      SELECT false,c.customer_id,c.outstanding FROM public.cheque_customer_claim_positions_internal() c
      JOIN public.cheque_compensation_claims k ON k.id=c.id JOIN public.deferred_cheques q ON q.id=k.cheque_id
      WHERE p_branch_id IS NULL OR q.branch_id=p_branch_id
    ) receivables
  ), cohort AS (
    SELECT COALESCE(SUM(p.coverage), 0)::BIGINT AS coverage,
      COALESCE(SUM(p.due), 0)::BIGINT AS due
    FROM positions p JOIN period_sales o ON o.id = p.id
  ), expenses AS (
    SELECT COALESCE(SUM(amount_in_minor_units), 0)::BIGINT AS amount,
      COALESCE(SUM(amount_in_minor_units) FILTER (WHERE payment_method = 'cash'), 0)::BIGINT AS cash,
      COALESCE(SUM(amount_in_minor_units) FILTER (WHERE payment_method = 'cliq'), 0)::BIGINT AS cliq,
      COUNT(*) AS count
    FROM public.operational_expenses
    WHERE (p_branch_id IS NULL OR branch_id = p_branch_id)
      AND NOT COALESCE(is_reversed, false)
      AND created_at >= p_period_start AND created_at < p_period_end
  ), daily_collections AS (
    -- One period-local aggregation. Never rescan all money events twice for
    -- every date in the month; collection/reversal equations are unchanged.
    SELECT (m.at AT TIME ZONE p_timezone)::DATE AS day,
      COALESCE(SUM(m.collection-m.reversal) FILTER(WHERE m.method='cash'),0)::BIGINT AS cash_collected,
      COALESCE(SUM(m.collection-m.reversal) FILTER(WHERE m.method='cliq'),0)::BIGINT AS cliq_collected,
      COALESCE(SUM(m.collection-m.reversal) FILTER(WHERE m.method='bank_transfer'),0)::BIGINT AS bank_collected,
      COALESCE(SUM(m.collection-m.reversal) FILTER(WHERE m.method='cheque'),0)::BIGINT AS cheque_collected,
      COALESCE(SUM(m.collection-m.reversal) FILTER(WHERE COALESCE(m.method,'') NOT IN ('cash','cliq','bank_transfer','cheque')),0)::BIGINT AS other_collected,
      COALESCE(SUM(m.collection-m.reversal),0)::BIGINT AS total_collected
    FROM money_events m WHERE m.at>=p_period_start AND m.at<p_period_end
    GROUP BY (m.at AT TIME ZONE p_timezone)::DATE
  ), days AS (
    SELECT day::DATE AS day FROM generate_series((p_period_start AT TIME ZONE p_timezone)::DATE,
      (p_period_end AT TIME ZONE p_timezone)::DATE - 1, INTERVAL '1 day') day
  ), daily AS (
    SELECT d.day,
      COALESCE((SELECT SUM(o.total_in_minor_units) FROM period_sales o
        WHERE (o.completion_at AT TIME ZONE p_timezone)::DATE = d.day), 0)::BIGINT AS gross,
      (SELECT COUNT(*) FROM period_sales o
        WHERE (o.completion_at AT TIME ZONE p_timezone)::DATE = d.day)::BIGINT AS count,
      COALESCE((SELECT SUM(r.entitlement) FROM return_rows r
        WHERE r.at >= p_period_start AND r.at < p_period_end
          AND (r.at AT TIME ZONE p_timezone)::DATE = d.day), 0)::BIGINT AS returned,
      COALESCE(dc.cash_collected,0)::BIGINT AS cash_collected,
      COALESCE(dc.cliq_collected,0)::BIGINT AS cliq_collected,
      COALESCE(dc.bank_collected,0)::BIGINT AS bank_collected,
      COALESCE(dc.cheque_collected,0)::BIGINT AS cheque_collected,
      COALESCE(dc.other_collected,0)::BIGINT AS other_collected,
      COALESCE(dc.total_collected,0)::BIGINT AS total_collected
    FROM days d LEFT JOIN daily_collections dc ON dc.day=d.day
  ) SELECT jsonb_build_object(
    'sales', jsonb_build_object('grossSalesInMinorUnits', s.gross, 'deliveryFeesInMinorUnits', s.delivery,
      'returnEntitlementInMinorUnits', r.entitlement, 'refundsInMinorUnits', r.refund,
      'debtReductionInMinorUnits', r.debt, 'netSalesInMinorUnits', s.gross - r.entitlement,
      'collectedInMinorUnits', co.coverage, 'outstandingInMinorUnits', co.due, 'returnCount', r.count,
      'orderCount', s.count, 'completedOrderCount', s.count),
    'cashFlow', jsonb_build_object('customerCollections',jsonb_build_object(
      'cashInMinorUnits',f.cash_received,'cliqInMinorUnits',f.cliq_received,
      'bankTransferInMinorUnits',f.bank_received,'chequeInMinorUnits',f.cheque_received,
      'otherInMinorUnits',f.other_received,'totalInMinorUnits',f.total_received),
      'cashCollectedInMinorUnits', f.cash_received,
      'cliqCollectedInMinorUnits', f.cliq_received, 'cashRefundedInMinorUnits', f.cash_refunded,
      'cliqRefundedInMinorUnits', f.cliq_refunded, 'cashNetFlowInMinorUnits', f.cash_received - f.cash_refunded,
      'cliqNetFlowInMinorUnits', f.cliq_received - f.cliq_refunded),
    'balances', jsonb_build_object('customerDueInMinorUnits', b.due, 'customerOrderCount', b.orders,
      'customerCount', b.customers),
    'expenses', jsonb_build_object('totalInMinorUnits', x.amount, 'cashInMinorUnits', x.cash,
      'cliqInMinorUnits', x.cliq, 'count', x.count),
    'dailyBreakdown', (SELECT COALESCE(jsonb_agg(jsonb_build_object('date', day,
      'completedOrderCount', count, 'grossSalesInMinorUnits', gross,
      'returnEntitlementInMinorUnits', returned, 'netSalesInMinorUnits', gross - returned,
      'cashCollectedInMinorUnits',cash_collected,'cliqCollectedInMinorUnits',cliq_collected,
      'customerCollections',jsonb_build_object('cashInMinorUnits',cash_collected,'cliqInMinorUnits',cliq_collected,
        'bankTransferInMinorUnits',bank_collected,'chequeInMinorUnits',cheque_collected,
        'otherInMinorUnits',other_collected,'totalInMinorUnits',total_collected))
      ORDER BY day), '[]'::JSONB) FROM daily)
  ) INTO v_facts
  FROM sales_totals s CROSS JOIN period_returns r CROSS JOIN flows f CROSS JOIN balances b
    CROSS JOIN cohort co CROSS JOIN expenses x;

  RETURN v_facts;
END;
$simple$;
 REVOKE ALL ON FUNCTION sales_lite2.simple_facts(UUID,TIMESTAMPTZ,TIMESTAMPTZ,TEXT,BOOLEAN) FROM PUBLIC,anon,authenticated,service_role;
 -- QUARANTINED. Same canonical sales/receivables/collections/expenses;no costs.
CREATE FUNCTION public.lite1_business_report2(p_branch_id UUID,p_date_from DATE,p_date_to DATE)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE facts JSONB;start_at TIMESTAMPTZ;end_at TIMESTAMPTZ;
BEGIN
 PERFORM sales_lite1.owner();
 IF p_branch_id IS NULL OR p_date_from IS NULL OR p_date_to IS NULL OR p_date_to<p_date_from OR p_date_to-p_date_from>365
  OR NOT EXISTS(SELECT 1 FROM public.branches WHERE id=p_branch_id AND is_active) THEN RAISE EXCEPTION 'LITE2_REPORT_PERIOD_INVALID';END IF;
 start_at:=p_date_from::TIMESTAMP AT TIME ZONE 'Asia/Amman';end_at:=(p_date_to+1)::TIMESTAMP AT TIME ZONE 'Asia/Amman';
 facts:=sales_lite2.simple_facts(p_branch_id,start_at,end_at,'Asia/Amman',true);
 -- Reuse the complete existing215 cash/exchange adjustment and evidence
 -- assertions. Inventory recovery/profit-only presentation is intentionally
 -- absent;full historical exchanges still keep their exact monetary meaning.
 PERFORM public.tb215_assert_inspection_internal(i.operation_id) FROM public.aftercare215_inspections i
  JOIN public.orders o ON o.id=i.order_id WHERE o.branch_id=p_branch_id AND i.created_at>=start_at AND i.created_at<end_at;
 PERFORM public.tb215_assert_return_internal(c.operation_id) FROM public.aftercare215_return_contexts c
  JOIN public.orders o ON o.id=c.order_id WHERE o.branch_id=p_branch_id AND c.created_at>=start_at AND c.created_at<end_at;
 facts:=public.tb215_exchange_financial_adjustment_internal(facts,p_branch_id,start_at,end_at,'Asia/Amman',true);
 RETURN jsonb_build_object('success',true,'contractVersion','lite2-business-report-v1','accountingTracked',false,'branchId',p_branch_id,'generatedAt',now(),
  'period',jsonb_build_object('dateFrom',p_date_from,'dateTo',p_date_to,'timezone','Asia/Amman'))||facts;
END $$;
REVOKE ALL ON FUNCTION public.lite1_business_report2(UUID,DATE,DATE) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.lite1_business_report2(UUID,DATE,DATE) TO authenticated;

-- QUARANTINED: reuse verified cost-free report facts, never stock/cost readers.
CREATE FUNCTION public.lite1_home2(p_branch_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE today DATE:=(now() AT TIME ZONE 'Asia/Amman')::DATE;month_start DATE:=date_trunc('month',today)::DATE;
 facts JSONB;summary JSONB;day_fact JSONB;week JSONB;statuses JSONB;recent JSONB;
BEGIN
 PERFORM sales_lite1.owner();
 facts:=public.lite1_business_report2(p_branch_id,LEAST(month_start,today-6),today);
 SELECT x INTO STRICT day_fact FROM jsonb_array_elements(facts->'dailyBreakdown') x WHERE x->>'date'=today::TEXT;
 SELECT jsonb_build_object(
  'todayCollections',day_fact->'customerCollections',
  'todayCashCollectedInMinorUnits',day_fact->'customerCollections'->'cashInMinorUnits',
  'todayCliqCollectedInMinorUnits',day_fact->'customerCollections'->'cliqInMinorUnits',
  'todaySalesInMinorUnits',day_fact->'grossSalesInMinorUnits','todayCompletedOrders',day_fact->'completedOrderCount',
  'monthSalesInMinorUnits',sum((x->>'grossSalesInMinorUnits')::BIGINT),
  'monthNetSalesInMinorUnits',sum((x->>'netSalesInMinorUnits')::BIGINT),
  'customerReceivablesInMinorUnits',facts->'balances'->'customerDueInMinorUnits',
  'activeProductsCount',(SELECT count(*) FROM public.products WHERE is_active),
  'activeCustomersCount',(SELECT count(*) FROM public.customers WHERE is_active AND NOT is_deleted)) INTO summary
 FROM jsonb_array_elements(facts->'dailyBreakdown') x WHERE (x->>'date')::DATE>=month_start;
 SELECT jsonb_agg(jsonb_build_object('date',x->'date','dayLabel',x->'date','salesInMinorUnits',x->'grossSalesInMinorUnits','netSalesInMinorUnits',x->'netSalesInMinorUnits') ORDER BY x->>'date') INTO week
 FROM jsonb_array_elements(facts->'dailyBreakdown') x WHERE (x->>'date')::DATE>=today-6;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('status',status,'count',n) ORDER BY status),'[]'::JSONB) INTO statuses
 FROM(SELECT status,count(*) n FROM public.orders WHERE branch_id=p_branch_id GROUP BY status) s;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'orderNumber',order_number,'customerName',COALESCE(customer_name_snapshot,'زبون مباشر'),'status',status,'paymentStatus',payment_status,'totalInMinorUnits',total_in_minor_units,'source',COALESCE(source,'website'),'createdAt',created_at) ORDER BY created_at DESC,id DESC),'[]'::JSONB) INTO recent
 FROM(SELECT id,order_number,customer_name_snapshot,status,payment_status,total_in_minor_units,source,created_at FROM public.orders WHERE branch_id=p_branch_id ORDER BY created_at DESC,id DESC LIMIT 5) o;
 RETURN jsonb_build_object('contractVersion','lite2-home-v1','accountingTracked',false,'branchId',p_branch_id,'generatedAt',now(),'financialFactsAvailable',true,
  'summary',summary,'orderStatuses',statuses,'latestOrders',recent,'sevenDaySales',week,
  'chequeAlerts',jsonb_build_object('due',(SELECT count(*) FROM public.deferred_cheques WHERE branch_id=p_branch_id AND direction='incoming' AND status='pending' AND due_date>=today AND due_date<=today+2),
   'overdue',(SELECT count(*) FROM public.deferred_cheques WHERE branch_id=p_branch_id AND direction='incoming' AND status='pending' AND due_date<today)));
END $$;
REVOKE ALL ON FUNCTION public.lite1_home2(UUID) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.lite1_home2(UUID) TO authenticated;

-- Provenance controls historical presentation independently from today's mode.
CREATE FUNCTION sales_lite2.period_has_uncosted(p_branch UUID,p_start TIMESTAMPTZ,p_end TIMESTAMPTZ) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM sales_lite1.completions c JOIN public.orders o ON o.id=c.order_id WHERE o.branch_id=p_branch AND c.completed_at>=p_start AND c.completed_at<p_end)
 OR EXISTS(SELECT 1 FROM sales_lite1.returns r JOIN public.orders o ON o.id=r.order_id WHERE o.branch_id=p_branch AND r.created_at>=p_start AND r.created_at<p_end)
$$;
REVOKE ALL ON FUNCTION sales_lite2.period_has_uncosted(UUID,TIMESTAMPTZ,TIMESTAMPTZ) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.lite1_reporting_report2(p_branch_id UUID,p_date_from DATE,p_date_to DATE) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF sales_lite1.enabled() OR sales_lite2.period_has_uncosted(p_branch_id,p_date_from::TIMESTAMP AT TIME ZONE 'Asia/Amman',(p_date_to+1)::TIMESTAMP AT TIME ZONE 'Asia/Amman') THEN
  RETURN public.lite1_business_report2(p_branch_id,p_date_from,p_date_to)||jsonb_build_object('historyWithoutCost',true);
 END IF;
 RETURN public.get_operational_business_report(p_branch_id,p_date_from,p_date_to);
END $$;
REVOKE ALL ON FUNCTION public.lite1_reporting_report2(UUID,DATE,DATE) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.lite1_reporting_report2(UUID,DATE,DATE) TO authenticated;
CREATE FUNCTION public.lite1_reporting_home2(p_branch_id UUID) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE today DATE:=(now() AT TIME ZONE 'Asia/Amman')::DATE;start_day DATE:=LEAST(date_trunc('month',today)::DATE,today-6);
BEGIN
 IF sales_lite1.enabled() OR sales_lite2.period_has_uncosted(p_branch_id,start_day::TIMESTAMP AT TIME ZONE 'Asia/Amman',(today+1)::TIMESTAMP AT TIME ZONE 'Asia/Amman') THEN
  RETURN public.lite1_home2(p_branch_id)||jsonb_build_object('historyWithoutCost',true);
 END IF;
 RETURN public.get_home_dashboard();
END $$;
REVOKE ALL ON FUNCTION public.lite1_reporting_home2(UUID) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.lite1_reporting_home2(UUID) TO authenticated;

CREATE FUNCTION sales_lite2.catalog_page(p_limit integer,p_offset integer,p_category_id uuid,p_search text,p_availability text,p_sort text,p_brand_id uuid,p_sale_unit_id uuid,p_product_ids uuid[])
 RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $catalog$
  WITH  sales_by_product AS (
    SELECT
      oi.product_id,
      COALESCE(SUM(COALESCE(oi.sale_package_quantity, 0)), 0)::BIGINT
        AS sold_packages
    FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
    WHERE o.status = 'completed'
      AND o.created_at >= NOW() - INTERVAL '90 days'
    GROUP BY oi.product_id
  ),
  catalog_source AS (
    SELECT
      p.id,
      p.sku,
      p.barcode,
      p.name_ar,
      p.description,
      p.category_id,
      c.code AS category_code,
      c.name_ar AS category_name_ar,
      p.brand_id,
      b.name_ar AS brand_name_ar,
      p.unit_id,
      base_unit.name_ar AS unit_name_ar,
      p.sale_unit_id,
      sale_unit.name_ar AS sale_unit_name_ar,
      p.units_per_sale_unit,
      p.parcel_only,
      p.default_sale_price_in_minor_units,
      p.sale_price_in_minor_units,
      sales_lite1.available(p.id) AS manual_available,
      image.image_url,
      p.created_at,
      COALESCE(sales.sold_packages, 0)::BIGINT AS sold_packages_last_90_days,
      p.flavor_master_product_id,
      p.flavor_name_ar,
      p.is_flavor_master,
      p.flavor_sort_order,
      COALESCE(p.flavor_master_product_id, p.id) AS family_id
    FROM public.products p
    JOIN public.categories c ON c.id = p.category_id AND c.is_active = true
    LEFT JOIN public.brands b ON b.id = p.brand_id
    JOIN public.units base_unit ON base_unit.id = p.unit_id
    JOIN public.units sale_unit ON sale_unit.id = p.sale_unit_id
    LEFT JOIN sales_by_product sales ON sales.product_id = p.id
    LEFT JOIN LATERAL (
      SELECT pi.image_url
      FROM public.product_images pi
      WHERE pi.product_id = p.id
      ORDER BY pi.is_primary DESC, pi.display_order, pi.created_at
      LIMIT 1
    ) image ON true
    WHERE p.is_active = true
      AND sale_unit.code <> 'PCS'
      AND p.units_per_sale_unit > 0
      AND p.default_sale_price_in_minor_units > 0
  ),
  family_summary AS (
    SELECT
      family_id,
      MIN(category_id::TEXT)::UUID AS category_id,
      MIN(category_code) AS category_code,
      MIN(brand_id::TEXT)::UUID AS brand_id,
      MIN(sale_unit_id::TEXT)::UUID AS sale_unit_id,
      COALESCE(
        MIN(name_ar) FILTER (WHERE flavor_master_product_id IS NULL),
        MIN(name_ar)
      ) AS family_name_ar,
      MIN(default_sale_price_in_minor_units) AS sale_price_in_minor_units,
      NULL::INTEGER AS available_sale_packages,
      BOOL_OR(NOT is_flavor_master AND manual_available) AS is_available,
      false AS is_low_stock,
      MAX(created_at) AS created_at,
      COALESCE(SUM(sold_packages_last_90_days) FILTER (WHERE NOT is_flavor_master), 0)::BIGINT
        AS sold_packages_last_90_days
    FROM catalog_source
    GROUP BY family_id
  ),
  normalized_search AS (
    SELECT LOWER(TRANSLATE(
      REGEXP_REPLACE(COALESCE(NULLIF(BTRIM(p_search), ''), ''), '[ً-ٰٟـ]', '', 'g'),
      'أإآى',
      'اااي'
    )) AS value
  ),
  matching_families AS (
    SELECT fs.*
    FROM family_summary fs
    CROSS JOIN normalized_search normalized
    WHERE (p_category_id IS NULL OR fs.category_id = p_category_id)
      AND (p_brand_id IS NULL OR fs.brand_id = p_brand_id)
      AND (p_sale_unit_id IS NULL OR fs.sale_unit_id = p_sale_unit_id)
      AND (
        p_product_ids IS NULL
        OR fs.family_id = ANY (p_product_ids)
        OR EXISTS (
          SELECT 1
          FROM catalog_source favorite_member
          WHERE favorite_member.family_id = fs.family_id
            AND favorite_member.id = ANY (p_product_ids)
        )
      )
      AND (
        p_availability NOT IN ('available', 'low_stock')
        OR (p_availability = 'available' AND fs.is_available)
        OR (p_availability = 'low_stock' AND fs.is_low_stock)
      )
      AND (p_sort <> 'offers' OR fs.category_code = 'CAT-OFFERS')
      AND (p_sort <> 'low_stock' OR fs.is_low_stock)
      AND (
        normalized.value = ''
        OR EXISTS (
          SELECT 1
          FROM catalog_source searched_member
          WHERE searched_member.family_id = fs.family_id
            AND (
              LOWER(TRANSLATE(REGEXP_REPLACE(searched_member.name_ar, '[ً-ٰٟـ]', '', 'g'), 'أإآى', 'اااي')) LIKE '%' || normalized.value || '%'
              OR LOWER(TRANSLATE(REGEXP_REPLACE(searched_member.sku, '[ً-ٰٟـ]', '', 'g'), 'أإآى', 'اااي')) LIKE '%' || normalized.value || '%'
              OR LOWER(TRANSLATE(REGEXP_REPLACE(COALESCE(searched_member.barcode, ''), '[ً-ٰٟـ]', '', 'g'), 'أإآى', 'اااي')) LIKE '%' || normalized.value || '%'
              OR LOWER(TRANSLATE(REGEXP_REPLACE(COALESCE(searched_member.description, ''), '[ً-ٰٟـ]', '', 'g'), 'أإآى', 'اااي')) LIKE '%' || normalized.value || '%'
              OR LOWER(TRANSLATE(REGEXP_REPLACE(COALESCE(searched_member.brand_name_ar, ''), '[ً-ٰٟـ]', '', 'g'), 'أإآى', 'اااي')) LIKE '%' || normalized.value || '%'
            )
        )
      )
  ),
  paged_families AS (
    SELECT
      mf.*,
      ROW_NUMBER() OVER (
        ORDER BY
          mf.is_available DESC,
          CASE WHEN p_sort = 'name_asc' THEN mf.family_name_ar END ASC,
          CASE WHEN p_sort = 'price_asc' THEN mf.sale_price_in_minor_units END ASC,
          CASE WHEN p_sort = 'price_desc' THEN mf.sale_price_in_minor_units END DESC,
          CASE WHEN p_sort = 'stock_desc' THEN mf.available_sale_packages END DESC,
          CASE WHEN p_sort = 'newest' THEN mf.created_at END DESC,
          CASE WHEN p_sort = 'best_sellers' THEN mf.sold_packages_last_90_days END DESC,
          CASE WHEN p_sort = 'low_stock' THEN mf.available_sale_packages END ASC,
          mf.family_name_ar ASC,
          mf.family_id ASC
      ) AS page_order
    FROM matching_families mf
    ORDER BY
      mf.is_available DESC,
      CASE WHEN p_sort = 'name_asc' THEN mf.family_name_ar END ASC,
      CASE WHEN p_sort = 'price_asc' THEN mf.sale_price_in_minor_units END ASC,
      CASE WHEN p_sort = 'price_desc' THEN mf.sale_price_in_minor_units END DESC,
      CASE WHEN p_sort = 'stock_desc' THEN mf.available_sale_packages END DESC,
      CASE WHEN p_sort = 'newest' THEN mf.created_at END DESC,
      CASE WHEN p_sort = 'best_sellers' THEN mf.sold_packages_last_90_days END DESC,
      CASE WHEN p_sort = 'low_stock' THEN mf.available_sale_packages END ASC,
      mf.family_name_ar ASC,
      mf.family_id ASC
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 24), 1), 48)
    OFFSET GREATEST(COALESCE(p_offset, 0), 0)
  ),
  page_items AS (
    SELECT
      pf.page_order,
      cs.*
    FROM paged_families pf
    JOIN catalog_source cs ON cs.family_id = pf.family_id
  ),
  category_summary AS (
    SELECT
      c.id,
      c.code,
      c.name_ar,
      c.image_url,
      COUNT(fs.family_id)::INTEGER AS product_count,
      COUNT(fs.family_id) FILTER (WHERE fs.is_available)::INTEGER AS available_product_count,
      CASE c.code
        WHEN 'CAT-BEV' THEN 10 WHEN 'CAT-WATER' THEN 20
        WHEN 'CAT-ENERGY' THEN 30 WHEN 'CAT-BISCUIT' THEN 40
        WHEN 'CAT-CAKE' THEN 50 WHEN 'CAT-CHOCO' THEN 60
        WHEN 'CAT-CANDY' THEN 70 WHEN 'CAT-GUM' THEN 80
        WHEN 'CAT-CHIPS' THEN 90 WHEN 'CAT-FOOD' THEN 100
        WHEN 'CAT-GIFTS' THEN 110 WHEN 'CAT-OFFERS' THEN 120
        ELSE 1000
      END AS sort_order
    FROM public.categories c
    LEFT JOIN family_summary fs ON fs.category_id = c.id
    WHERE c.is_active = true
    GROUP BY c.id, c.code, c.name_ar, c.image_url
  ),
  brand_facets AS (
    SELECT fs.brand_id AS id, MIN(cs.brand_name_ar) AS name_ar
    FROM family_summary fs
    JOIN catalog_source cs ON cs.family_id = fs.family_id
    WHERE fs.brand_id IS NOT NULL
    GROUP BY fs.brand_id
  ),
  sale_unit_facets AS (
    SELECT fs.sale_unit_id AS id, MIN(cs.sale_unit_name_ar) AS name_ar
    FROM family_summary fs
    JOIN catalog_source cs ON cs.family_id = fs.family_id
    WHERE fs.sale_unit_id IS NOT NULL
    GROUP BY fs.sale_unit_id
  )
  SELECT jsonb_build_object(
    'items', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', id,
          'sku', sku,
          'barcode', barcode,
          'nameAr', name_ar,
          'description', description,
          'categoryId', category_id,
          'categoryCode', category_code,
          'categoryNameAr', category_name_ar,
          'brandId', brand_id,
          'brandNameAr', brand_name_ar,
          'unitId', unit_id,
          'unitNameAr', unit_name_ar,
          'saleUnitId', sale_unit_id,
          'saleUnitNameAr', sale_unit_name_ar,
          'unitsPerSalePackage', units_per_sale_unit,
          'parcelOnly', parcel_only,
          'salePackagePriceInMinorUnits', default_sale_price_in_minor_units,
          'salePriceInMinorUnits', sale_price_in_minor_units,
          'quantityTracked',false,
          'manualAvailable',manual_available,
          'availableQuantity',NULL,
          'availableSalePackages',NULL,
          'minimumOrderPackages', 1,
          'imageUrl', image_url,
          'isAvailable', manual_available AND NOT is_flavor_master,
          'createdAt', created_at,
          'soldPackagesLast90Days', sold_packages_last_90_days,
          'flavorMasterProductId', flavor_master_product_id,
          'flavorNameAr', flavor_name_ar,
          'isFlavorMaster', is_flavor_master,
          'flavorSortOrder', flavor_sort_order
        )
        ORDER BY page_order,
          CASE WHEN flavor_master_product_id IS NULL THEN 0 ELSE 1 END,
          flavor_sort_order,
          name_ar,
          id
      )
      FROM page_items
    ), '[]'::jsonb),
    'categories', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', id, 'code', code, 'nameAr', name_ar, 'imageUrl', image_url,
        'productCount', product_count, 'availableProductCount', available_product_count
      ) ORDER BY sort_order, name_ar, id)
      FROM category_summary
    ), '[]'::jsonb),
    'brands', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', id, 'nameAr', name_ar) ORDER BY name_ar, id)
      FROM brand_facets
    ), '[]'::jsonb),
    'saleUnits', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', id, 'nameAr', name_ar) ORDER BY name_ar, id)
      FROM sale_unit_facets
    ), '[]'::jsonb),
    'summary', jsonb_build_object(
      'availableProducts', (SELECT COUNT(*) FROM matching_families WHERE is_available),
      'quantityTracked',false,
      'availableSalePackages',NULL,
      'lowStockProducts', (SELECT COUNT(*) FROM matching_families WHERE is_low_stock)
    ),
    'total', (SELECT COUNT(*) FROM matching_families),
    'limit', LEAST(GREATEST(COALESCE(p_limit, 24), 1), 48),
    'offset', GREATEST(COALESCE(p_offset, 0), 0)
  );
$catalog$;
 REVOKE ALL ON FUNCTION sales_lite2.catalog_page(integer,integer,uuid,text,text,text,uuid,uuid,uuid[]) FROM PUBLIC,anon,authenticated,service_role;
 CREATE FUNCTION sales_lite2.parcel_options(p_family_product_ids UUID[])
 RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $parcel$
DECLARE
  v_feature_state TEXT := public.get_configurable_parcel_feature_state();
  v_requested_count INTEGER := COALESCE(CARDINALITY(p_family_product_ids), 0);
  v_options JSONB;
BEGIN
  IF v_requested_count < 1
    OR v_requested_count > 48
    OR ARRAY_POSITION(p_family_product_ids, NULL) IS NOT NULL
  THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'PUBLIC_CONFIGURABLE_PARCEL_REQUEST_INVALID: Provide between 1 and 48 valid Family IDs.';
  END IF;

  -- OWNER_PILOT intentionally grants no Customer guest creation capability.
  -- Returning an empty projection also prevents stale configuration discovery
  -- while creation is unavailable to the public guest actor.
  IF v_feature_state IS DISTINCT FROM 'ENABLED' THEN
    RETURN JSONB_BUILD_OBJECT(
      'featureState', v_feature_state,
      'guestCreationEnabled', false,
      'options', '[]'::JSONB
    );
  END IF;

  WITH requested_families AS (
    SELECT DISTINCT requested.family_product_id
    FROM UNNEST(p_family_product_ids) AS requested(family_product_id)
  ), storefront_warehouse AS (
    -- This is intentionally identical to the Customer V2 warehouse selector.
    SELECT warehouse.id
    FROM public.warehouses warehouse
    JOIN public.branches branch
      ON branch.id = warehouse.branch_id
    WHERE warehouse.is_active
      AND branch.is_active
    ORDER BY warehouse.created_at, warehouse.id
    LIMIT 1
  ), configuration_source AS (
    SELECT
      configuration.id AS parcel_configuration_id,
      configuration.family_product_id,
      configuration.configuration_revision,
      configuration.composition_mode,
      family.units_per_sale_unit AS units_per_parcel,
      family.default_sale_price_in_minor_units AS parcel_price_in_minor_units,
      base_unit.name_ar AS base_unit_name_ar,
      sale_unit.name_ar AS sale_unit_name_ar
    FROM requested_families requested
    JOIN public.product_parcel_configurations configuration
      ON configuration.family_product_id = requested.family_product_id
    JOIN public.products family
      ON family.id = configuration.family_product_id
    JOIN public.categories family_category
      ON family_category.id = family.category_id
      AND family_category.is_active
    JOIN public.units base_unit
      ON base_unit.id = family.unit_id
    JOIN public.units sale_unit
      ON sale_unit.id = family.sale_unit_id
    WHERE configuration.is_active
      AND configuration.composition_mode = 'configurable_mix'
      AND configuration.configuration_revision > 0
      AND family.is_active
      AND sales_lite1.available(family.id)
      AND family.is_flavor_master
      AND family.units_per_sale_unit > 0
      AND family.default_sale_price_in_minor_units > 0
      AND sale_unit.code <> 'PCS'
  ), eligible_components AS (
    SELECT
      configuration.parcel_configuration_id,
      configuration.family_product_id,
      configuration.configuration_revision,
      configuration.composition_mode,
      configuration.units_per_parcel,
      configuration.parcel_price_in_minor_units,
      configuration.base_unit_name_ar,
      configuration.sale_unit_name_ar,
      component.id AS product_id,
      component.sku,
      component.name_ar,
      component.flavor_name_ar,
      component_unit.name_ar AS component_unit_name_ar,
      image.image_url,
      sales_lite1.available(component.id) AS manual_available
    FROM configuration_source configuration
    CROSS JOIN storefront_warehouse warehouse
    JOIN public.products component
      ON component.flavor_master_product_id = configuration.family_product_id
      AND component.is_active
      AND NOT component.is_flavor_master
    JOIN public.categories component_category
      ON component_category.id = component.category_id
      AND component_category.is_active
    JOIN public.units component_unit
      ON component_unit.id = component.unit_id
    JOIN public.units component_sale_unit
      ON component_sale_unit.id = component.sale_unit_id
    LEFT JOIN LATERAL (
      SELECT product_image.image_url
      FROM public.product_images product_image
      WHERE product_image.product_id = component.id
      ORDER BY product_image.is_primary DESC,
        product_image.display_order,
        product_image.created_at,
        product_image.id
      LIMIT 1
    ) image ON true
    WHERE sales_lite1.available(component.id)
      AND EXISTS(SELECT 1 FROM public.product_parcel_allowed_components allowed WHERE allowed.configuration_id=configuration.parcel_configuration_id AND allowed.product_id=component.id)
      AND component.units_per_sale_unit > 0
      AND component.default_sale_price_in_minor_units > 0
      AND component_sale_unit.code <> 'PCS'
  ), option_groups AS (
    SELECT
      component.parcel_configuration_id,
      component.family_product_id,
      component.configuration_revision,
      component.composition_mode,
      component.units_per_parcel,
      component.parcel_price_in_minor_units,
      component.base_unit_name_ar,
      component.sale_unit_name_ar,
      JSONB_AGG(
        JSONB_BUILD_OBJECT(
          'productId', component.product_id,
          'sku', component.sku,
          'nameAr', component.name_ar,
          'flavorNameAr', component.flavor_name_ar,
          'unitNameAr', component.component_unit_name_ar,
          'imageUrl', component.image_url,
          'quantityTracked',false,
          'manualAvailable',component.manual_available,
          'availableQuantity',NULL
        )
        ORDER BY component.flavor_name_ar NULLS LAST,
          component.name_ar,
          component.product_id
      ) AS components
    FROM eligible_components component
    GROUP BY
      component.parcel_configuration_id,
      component.family_product_id,
      component.configuration_revision,
      component.composition_mode,
      component.units_per_parcel,
      component.parcel_price_in_minor_units,
      component.base_unit_name_ar,
      component.sale_unit_name_ar
  )
  SELECT COALESCE(
    JSONB_AGG(
      JSONB_BUILD_OBJECT(
        'familyProductId', option_group.family_product_id,
        'parcelConfigurationId', option_group.parcel_configuration_id,
        'configurationRevision', option_group.configuration_revision,
        'compositionMode', option_group.composition_mode,
        'unitsPerParcel', option_group.units_per_parcel,
        'parcelPriceInMinorUnits', option_group.parcel_price_in_minor_units,
        'baseUnitNameAr', option_group.base_unit_name_ar,
        'saleUnitNameAr', option_group.sale_unit_name_ar,
        'quantityTracked',false,
        'components', option_group.components
      )
      ORDER BY option_group.family_product_id,
        option_group.parcel_configuration_id
    ),
    '[]'::JSONB
  )
  INTO v_options
  FROM option_groups option_group;

  RETURN JSONB_BUILD_OBJECT(
    'featureState', v_feature_state,
    'guestCreationEnabled', true,
    'options', v_options
  );
END;
$parcel$;
 REVOKE ALL ON FUNCTION sales_lite2.parcel_options(UUID[]) FROM PUBLIC,anon,authenticated,service_role;
 -- QUARANTINED parallel public reads. Full mode delegates byte-identical originals.
CREATE FUNCTION public.lite1_catalog_page2(p_limit integer DEFAULT 24,p_offset integer DEFAULT 0,p_category_id uuid DEFAULT NULL,p_search text DEFAULT NULL,p_availability text DEFAULT 'all',p_sort text DEFAULT 'recommended',p_brand_id uuid DEFAULT NULL,p_sale_unit_id uuid DEFAULT NULL,p_product_ids uuid[] DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF (SELECT full_accounting FROM sales_lite1.mode WHERE id) THEN
  RETURN public.get_public_storefront_catalog_page(p_limit,p_offset,p_category_id,p_search,p_availability,p_sort,p_brand_id,p_sale_unit_id,p_product_ids);
 END IF;
 IF (SELECT full_accounting FROM sales_lite1.mode WHERE id) IS DISTINCT FROM false THEN RAISE EXCEPTION 'LITE2_MODE_MISSING';END IF;
 IF length(COALESCE(p_search,''))>500 OR cardinality(p_product_ids)>48 OR array_position(p_product_ids,NULL) IS NOT NULL THEN RAISE EXCEPTION 'LITE2_CATALOG_INPUT_INVALID';END IF;
 RETURN sales_lite2.catalog_page(p_limit,p_offset,p_category_id,p_search,p_availability,p_sort,p_brand_id,p_sale_unit_id,p_product_ids)
  ||jsonb_build_object('contractVersion','lite2-catalog-v1','quantityTracked',false);
END $$;
REVOKE ALL ON FUNCTION public.lite1_catalog_page2(integer,integer,uuid,text,text,text,uuid,uuid,uuid[]) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.lite1_catalog_page2(integer,integer,uuid,text,text,text,uuid,uuid,uuid[]) TO anon,authenticated;

CREATE FUNCTION public.lite1_parcel_options2(p_family_product_ids UUID[])
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF (SELECT full_accounting FROM sales_lite1.mode WHERE id) THEN RETURN public.get_public_configurable_parcel_options(p_family_product_ids);END IF;
 IF (SELECT full_accounting FROM sales_lite1.mode WHERE id) IS DISTINCT FROM false THEN RAISE EXCEPTION 'LITE2_MODE_MISSING';END IF;
 RETURN sales_lite2.parcel_options(p_family_product_ids)||jsonb_build_object('contractVersion','lite2-parcel-options-v1','quantityTracked',false);
END $$;
REVOKE ALL ON FUNCTION public.lite1_parcel_options2(UUID[]) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.lite1_parcel_options2(UUID[]) TO anon,authenticated;

CREATE FUNCTION public.lite1_merchandising2()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF (SELECT full_accounting FROM sales_lite1.mode WHERE id) THEN RETURN public.get_public_storefront_merchandising();END IF;
 IF (SELECT full_accounting FROM sales_lite1.mode WHERE id) IS DISTINCT FROM false THEN RAISE EXCEPTION 'LITE2_MODE_MISSING';END IF;
 RETURN jsonb_build_object('contractVersion','lite2-merchandising-v1','quantityTracked',false,
  'newest',public.lite1_catalog_page2(6,0,NULL,NULL,'all','newest')->'items',
  'bestSellers',public.lite1_catalog_page2(6,0,NULL,NULL,'all','best_sellers')->'items',
  'offers',public.lite1_catalog_page2(6,0,NULL,NULL,'all','offers')->'items','lowStock','[]'::JSONB);
END $$;
REVOKE ALL ON FUNCTION public.lite1_merchandising2() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.lite1_merchandising2() TO anon,authenticated;

-- Same public preview contract. Only OFF uses the already pinned cost-free
-- preview;the original full RPC and its ACL/body are never modified.
CREATE FUNCTION public.lite1_preview_guest2(p_lines JSONB,p_promotion_code TEXT DEFAULT NULL,p_customer_phone TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF (SELECT full_accounting FROM sales_lite1.mode WHERE id) THEN RETURN public.preview_guest_promotion_v2(p_lines,p_promotion_code,p_customer_phone);END IF;
 IF (SELECT full_accounting FROM sales_lite1.mode WHERE id) IS DISTINCT FROM false THEN RAISE EXCEPTION 'LITE2_MODE_MISSING';END IF;
 IF jsonb_typeof(p_lines) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'PHASE3_SALE_CONTRACT_INVALID';END IF;
 IF jsonb_array_length(p_lines) NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION 'PHASE3_SALE_REQUEST_LIMIT_EXCEEDED';END IF;
 RETURN sales_lite2.preview(p_lines,p_promotion_code,p_customer_phone,'guest_gateway');
END $$;
REVOKE ALL ON FUNCTION public.lite1_preview_guest2(JSONB,TEXT,TEXT) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.lite1_preview_guest2(JSONB,TEXT,TEXT) TO anon,authenticated;

-- QUARANTINED phase2. A new activation epoch, never a reopening of GoLive047.
-- All existing orders/payments/debts and the eight approved bridges stay intact.
CREATE TABLE sales_lite2.opening_epochs(
 id UUID PRIMARY KEY,request_key TEXT NOT NULL UNIQUE REFERENCES sales_lite1.requests(key),
 activated_at TIMESTAMPTZ NOT NULL,created_by UUID NOT NULL REFERENCES public.profiles(id),
 manifest JSONB NOT NULL,preview_sha256 TEXT NOT NULL CHECK(preview_sha256~'^[a-f0-9]{64}$')
);
CREATE TABLE sales_lite2.opening_epoch_items(
 epoch_id UUID NOT NULL REFERENCES sales_lite2.opening_epochs(id),
 product_id UUID NOT NULL REFERENCES public.products(id),warehouse_id UUID NOT NULL REFERENCES public.warehouses(id),
 previous_quantity INTEGER NOT NULL CHECK(previous_quantity>=0),actual_quantity INTEGER NOT NULL CHECK(actual_quantity>=0),
 previous_cost BIGINT NOT NULL,previous_wac NUMERIC(24,6),unit_cost BIGINT NOT NULL CHECK(unit_cost>=0),
 movement_id UUID REFERENCES public.inventory_movements(id),PRIMARY KEY(epoch_id,product_id,warehouse_id)
);
DO $$ DECLARE t TEXT;BEGIN
 FOREACH t IN ARRAY ARRAY['opening_epochs','opening_epoch_items'] LOOP
  EXECUTE format('ALTER TABLE sales_lite2.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON TABLE sales_lite2.%I FROM PUBLIC,anon,authenticated,service_role',t);
  EXECUTE format('CREATE TRIGGER lite2_immutable BEFORE UPDATE OR DELETE ON sales_lite2.%I FOR EACH ROW EXECUTE FUNCTION sales_lite1.immutable()',t);
  EXECUTE format('CREATE TRIGGER lite2_no_truncate BEFORE TRUNCATE ON sales_lite2.%I FOR EACH STATEMENT EXECUTE FUNCTION sales_lite1.immutable()',t);
 END LOOP;
END $$;

CREATE FUNCTION sales_lite2.epoch_request(p_rows JSONB,p_notes TEXT) RETURNS JSONB
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public AS $$
DECLARE row JSONB;canonical JSONB:='[]';quantity BIGINT;cost BIGINT;pid UUID;wid UUID;
BEGIN
 IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(p_rows) NOT BETWEEN 1 AND 10000
 OR octet_length(p_rows::TEXT)>2097152 OR length(COALESCE(btrim(p_notes),'')) NOT BETWEEN 5 AND 500 THEN RAISE EXCEPTION 'LITE2_EPOCH_INPUT_INVALID';END IF;
 FOR row IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
  IF jsonb_typeof(row) IS DISTINCT FROM 'object' OR(row-ARRAY['productId','warehouseId','actualQuantity','unitCostInMinorUnits'])<>'{}'::JSONB
  OR COALESCE(row->>'actualQuantity','')!~'^(0|[1-9][0-9]{0,9})$' OR COALESCE(row->>'unitCostInMinorUnits','')!~'^(0|[1-9][0-9]{0,11})$'
  THEN RAISE EXCEPTION 'LITE2_EPOCH_ROW_INVALID';END IF;
  pid:=public.phase3_require_uuid_internal(row->>'productId','epoch product');wid:=public.phase3_require_uuid_internal(row->>'warehouseId','epoch warehouse');
  quantity:=(row->>'actualQuantity')::BIGINT;cost:=(row->>'unitCostInMinorUnits')::BIGINT;
  IF quantity>2147483647 OR(quantity>0 AND cost<=0) THEN RAISE EXCEPTION 'LITE2_EPOCH_COST_QUANTITY_INVALID';END IF;
  -- Validation stays row-specific; aggregate once instead of copying an ever-growing JSON array.
 END LOOP;
 SELECT jsonb_agg(jsonb_build_object('productId',(x->>'productId')::UUID,'warehouseId',(x->>'warehouseId')::UUID,'actualQuantity',(x->>'actualQuantity')::BIGINT,'unitCostInMinorUnits',(x->>'unitCostInMinorUnits')::BIGINT)) INTO canonical FROM jsonb_array_elements(p_rows) x;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(canonical) x GROUP BY x->>'productId',x->>'warehouseId' HAVING count(*)>1)
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(canonical) x GROUP BY x->>'productId' HAVING count(DISTINCT x->>'unitCostInMinorUnits')>1)
 THEN RAISE EXCEPTION 'LITE2_EPOCH_DUPLICATE_OR_COST_CONFLICT';END IF;
 RETURN jsonb_build_object('notes',btrim(p_notes),'rows',(SELECT jsonb_agg(x ORDER BY x->>'productId',x->>'warehouseId') FROM jsonb_array_elements(canonical) x));
END $$;
REVOKE ALL ON FUNCTION sales_lite2.epoch_request(JSONB,TEXT) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION sales_lite2.prepare_epoch(p_request JSONB) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE state JSONB;lines JSONB;
BEGIN
 IF NOT sales_lite1.enabled() THEN RAISE EXCEPTION 'LITE1_MODE_DISABLED';END IF;
 SELECT to_jsonb(s) INTO STRICT state FROM public.go_live_setup_state s WHERE id;
 IF state->>'finished_at' IS NULL THEN RAISE EXCEPTION 'LITE2_EPOCH_GO_LIVE_NOT_FINISHED';END IF;
 IF EXISTS(SELECT 1 FROM public.cash_shifts WHERE status='open')
 OR EXISTS(SELECT 1 FROM public.orders WHERE status NOT IN('completed','cancelled','expired','returned'))
 THEN RAISE EXCEPTION 'LITE1_MODE_REQUIRES_QUIESCENCE';END IF;
 IF EXISTS(SELECT 1 FROM public.inventory_balances WHERE reserved_quantity<>0)
 OR EXISTS(SELECT 1 FROM public.order_inventory_reservations WHERE reservation_state='active') THEN RAISE EXCEPTION 'LITE2_EPOCH_RESERVATIONS_EXIST';END IF;
 -- Never discard forgotten stock in inactive warehouses/products silently.
 IF EXISTS(SELECT 1 FROM public.inventory_balances b JOIN public.products p ON p.id=b.product_id JOIN public.warehouses w ON w.id=b.warehouse_id
 JOIN public.branches branch ON branch.id=w.branch_id WHERE b.on_hand_quantity<>0 AND(NOT p.is_active OR p.is_flavor_master OR NOT w.is_active OR NOT branch.is_active))
 THEN RAISE EXCEPTION 'LITE2_EPOCH_INACTIVE_STOCK_REVIEW';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_request->'rows') x
 LEFT JOIN public.products p ON p.id=(x->>'productId')::UUID
 LEFT JOIN public.warehouses w ON w.id=(x->>'warehouseId')::UUID LEFT JOIN public.branches branch ON branch.id=w.branch_id
 WHERE p.id IS NULL OR NOT p.is_active OR p.is_flavor_master OR p.unit_id IS NULL OR w.id IS NULL OR NOT w.is_active OR branch.id IS NULL OR NOT branch.is_active)
 THEN RAISE EXCEPTION 'LITE2_EPOCH_PRODUCT_WAREHOUSE_INVALID';END IF;
 IF EXISTS(SELECT 1 FROM public.products p CROSS JOIN public.warehouses w JOIN public.branches branch ON branch.id=w.branch_id
 WHERE p.is_active AND NOT p.is_flavor_master AND w.is_active AND branch.is_active
 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_request->'rows') x WHERE(x->>'productId')::UUID=p.id AND(x->>'warehouseId')::UUID=w.id))
 THEN RAISE EXCEPTION 'LITE2_EPOCH_COMPLETE_COUNT_REQUIRED';END IF;
 SELECT jsonb_agg(x||jsonb_build_object('previousQuantity',COALESCE(b.on_hand_quantity,0),'previousCost',p.cost_price_in_minor_units,
  'previousWac',p.wac_cost_in_minor_units_exact,'productUpdatedAt',p.updated_at,'unitsPerPurchasePackage',p.units_per_purchase_unit)
  ORDER BY x->>'productId',x->>'warehouseId') INTO lines
 FROM jsonb_array_elements(p_request->'rows') x JOIN public.products p ON p.id=(x->>'productId')::UUID
 LEFT JOIN public.inventory_balances b ON b.product_id=p.id AND b.warehouse_id=(x->>'warehouseId')::UUID;
 RETURN jsonb_build_object('request',p_request,'lines',lines,'goLiveState',state,'itemCount',jsonb_array_length(lines),
  'totalQuantity',(SELECT sum((x->>'actualQuantity')::BIGINT)::TEXT FROM jsonb_array_elements(lines) x),
  'totalValueExact',(SELECT sum((x->>'actualQuantity')::NUMERIC*(x->>'unitCostInMinorUnits')::NUMERIC)::TEXT FROM jsonb_array_elements(lines) x));
END $$;
REVOKE ALL ON FUNCTION sales_lite2.prepare_epoch(JSONB) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.lite1_preview_epoch2(p_rows JSONB,p_notes TEXT) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,extensions AS $$
DECLARE plan JSONB;
BEGIN
 PERFORM sales_lite1.owner();IF auth.jwt()->>'aal' IS DISTINCT FROM 'aal2' THEN RAISE EXCEPTION 'LITE2_OWNER_AAL2_REQUIRED';END IF;
 plan:=sales_lite2.prepare_epoch(sales_lite2.epoch_request(p_rows,p_notes));
 RETURN (plan-ARRAY['request','goLiveState'])||jsonb_build_object('contractVersion','sales-only-epoch2-v1','previewFingerprint',encode(extensions.digest(plan::TEXT,'sha256'),'hex'));
END $$;
REVOKE ALL ON FUNCTION public.lite1_preview_epoch2(JSONB,TEXT) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.lite1_preview_epoch2(JSONB,TEXT) TO authenticated;

CREATE FUNCTION public.lite1_activate_epoch2(p_rows JSONB,p_notes TEXT,p_key TEXT,p_preview TEXT,p_confirmation TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,extensions AS $$
DECLARE request JSONB;identity JSONB;fingerprint TEXT;r sales_lite1.requests;plan JSONB;line JSONB;result JSONB;
 eid UUID:=gen_random_uuid();at TIMESTAMPTZ;delta INTEGER;movement UUID;pid UUID;wid UUID;
BEGIN
 PERFORM sales_lite1.owner();IF auth.jwt()->>'aal' IS DISTINCT FROM 'aal2' THEN RAISE EXCEPTION 'LITE2_OWNER_AAL2_REQUIRED';END IF;
 IF p_key IS NULL OR length(p_key) NOT BETWEEN 8 AND 128 OR COALESCE(p_preview,'')!~'^[a-f0-9]{64}$'
 OR p_confirmation IS DISTINCT FROM 'تفعيل المحاسبة بالجرد المعتمد' THEN RAISE EXCEPTION 'LITE2_EPOCH_CONFIRMATION_REQUIRED';END IF;
 request:=sales_lite2.epoch_request(p_rows,p_notes);identity:=jsonb_build_object('request',request,'preview',p_preview);
 fingerprint:=encode(extensions.digest(identity::TEXT,'sha256'),'hex');PERFORM pg_advisory_xact_lock(hashtextextended(p_key,0));
 SELECT * INTO r FROM sales_lite1.requests WHERE key=p_key;
 IF FOUND THEN
  IF r.kind<>'epoch2' OR r.actor IS DISTINCT FROM auth.uid() OR r.fingerprint<>fingerprint OR r.result IS NULL THEN RAISE EXCEPTION 'LITE1_IDEMPOTENCY_CONFLICT';END IF;
  RETURN r.result;
 END IF;
 IF EXISTS(SELECT 1 FROM public.business_operations WHERE idempotency_key=p_key) OR EXISTS(SELECT 1 FROM public.orders WHERE idempotency_key=p_key) THEN RAISE EXCEPTION 'LITE1_IDEMPOTENCY_CONFLICT';END IF;
 BEGIN
  PERFORM 1 FROM sales_lite1.mode WHERE id FOR UPDATE NOWAIT;
  -- Prevent catalog/warehouse/balance phantoms during the short activation.
  -- No new trigger, global setting or relaxed legacy writer is necessary.
  LOCK TABLE public.products,public.warehouses,public.branches,public.inventory_balances IN SHARE ROW EXCLUSIVE MODE NOWAIT;
 EXCEPTION WHEN lock_not_available THEN RAISE EXCEPTION 'LITE2_EPOCH_BUSY';END;
 plan:=sales_lite2.prepare_epoch(request);
 IF encode(extensions.digest(plan::TEXT,'sha256'),'hex')<>p_preview THEN RAISE EXCEPTION 'LITE2_EPOCH_PREVIEW_CHANGED';END IF;
 INSERT INTO sales_lite1.requests VALUES(p_key,'epoch2',fingerprint,auth.uid(),NULL);
 at:=clock_timestamp();INSERT INTO sales_lite2.opening_epochs VALUES(eid,p_key,at,auth.uid(),plan,p_preview);
 -- Mode, physical counts and costs commit atomically. Any error rolls back ALL.
 -- The original inventory/cost guards now admit only ordinary full-mode work.
 UPDATE sales_lite1.mode SET full_accounting=true WHERE id;
 -- One cost per SKU was already validated across every warehouse. Update each
 -- product once, not once per warehouse; keep all ordinary triggers enabled.
 UPDATE public.products p SET cost_price_in_minor_units=c.cost,
  wac_cost_in_minor_units_exact=c.cost::NUMERIC,updated_at=at
 FROM (SELECT DISTINCT (x->>'productId')::UUID pid,(x->>'unitCostInMinorUnits')::BIGINT cost FROM jsonb_array_elements(plan->'lines') x) c WHERE p.id=c.pid;
 FOR line IN SELECT value FROM jsonb_array_elements(plan->'lines') LOOP
  pid:=(line->>'productId')::UUID;wid:=(line->>'warehouseId')::UUID;
  INSERT INTO public.inventory_balances(product_id,warehouse_id,on_hand_quantity,reserved_quantity,updated_at)
   VALUES(pid,wid,(line->>'actualQuantity')::INTEGER,0,at)
   ON CONFLICT(product_id,warehouse_id) DO UPDATE SET on_hand_quantity=EXCLUDED.on_hand_quantity,updated_at=EXCLUDED.updated_at;
  delta:=(line->>'actualQuantity')::INTEGER-(line->>'previousQuantity')::INTEGER;movement:=NULL;
  IF delta<>0 THEN
   INSERT INTO public.inventory_movements(product_id,warehouse_id,movement_type,quantity,balance_before,balance_after,reference_type,reference_id,notes,created_by,created_at)
   VALUES(pid,wid,'opening_balance',delta,(line->>'previousQuantity')::INTEGER,(line->>'actualQuantity')::INTEGER,'sales_lite2_opening_epoch',eid,request->>'notes',auth.uid(),at) RETURNING id INTO movement;
  END IF;
  INSERT INTO sales_lite2.opening_epoch_items VALUES(eid,pid,wid,(line->>'previousQuantity')::INTEGER,(line->>'actualQuantity')::INTEGER,
   (line->>'previousCost')::BIGINT,(line->>'previousWac')::NUMERIC,(line->>'unitCostInMinorUnits')::BIGINT,movement);
 END LOOP;
 INSERT INTO public.audit_logs(user_id,action,entity_name,entity_id,details) VALUES(auth.uid(),'LITE2_OPENING_EPOCH','sales_lite2.opening_epochs',eid,
  jsonb_build_object('preview',p_preview,'itemCount',plan->'itemCount','activatedAt',at));
 result:=jsonb_build_object('success',true,'epochId',eid,'activatedAt',at,'fullAccounting',true,'itemCount',plan->'itemCount',
  'totalQuantity',plan->'totalQuantity','totalValueExact',plan->'totalValueExact');
 RETURN sales_lite1.finish(p_key,result);
END $$;
REVOKE ALL ON FUNCTION public.lite1_activate_epoch2(JSONB,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.lite1_activate_epoch2(JSONB,TEXT,TEXT,TEXT,TEXT) TO authenticated;
-- Owner's activation worksheet only. Not a normal stock/cost screen.
CREATE FUNCTION public.lite1_epoch_catalog2() RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE rows JSONB;
BEGIN
 PERFORM sales_lite1.owner();IF auth.jwt()->>'aal' IS DISTINCT FROM 'aal2' THEN RAISE EXCEPTION 'LITE2_OWNER_AAL2_REQUIRED';END IF;
 IF NOT sales_lite1.enabled() THEN RAISE EXCEPTION 'LITE1_MODE_DISABLED';END IF;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('productId',p.id,'warehouseId',w.id,'sku',p.sku,'productName',p.name_ar,
  'warehouseName',w.name_ar,'baseUnitName',COALESCE(u.name_ar,'باكيت'),'previousQuantity',COALESCE(b.on_hand_quantity,0)) ORDER BY p.id,w.id),'[]'::JSONB) INTO rows
 FROM public.products p CROSS JOIN public.warehouses w JOIN public.branches branch ON branch.id=w.branch_id
 LEFT JOIN public.units u ON u.id=p.unit_id LEFT JOIN public.inventory_balances b ON b.product_id=p.id AND b.warehouse_id=w.id
 WHERE p.is_active AND NOT p.is_flavor_master AND w.is_active AND branch.is_active;
 IF jsonb_array_length(rows) NOT BETWEEN 1 AND 10000 THEN RAISE EXCEPTION 'LITE2_EPOCH_INPUT_INVALID';END IF;
 RETURN jsonb_build_object('contractVersion','sales-only-epoch-catalog2-v1','fullAccounting',false,'itemCount',jsonb_array_length(rows),'rows',rows);
END $$;
REVOKE ALL ON FUNCTION public.lite1_epoch_catalog2() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.lite1_epoch_catalog2() TO authenticated;

-- Final phase2 installation closes the deliberately limited phase1 prototypes.
-- Owner wrappers retain their ability to delegate privately as postgres.
-- No219 entrypoint or role is changed by this quarantine-only file.
REVOKE ALL ON FUNCTION public.lite1_set_mode(BOOLEAN),public.lite1_pos(JSONB,TEXT),public.lite1_complete(UUID,TEXT),public.lite1_return(UUID,INTEGER,TEXT,TEXT) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.lite1_guest(JSONB,TEXT) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.lite1_set_available(UUID,BOOLEAN,INTEGER) FROM PUBLIC,anon,authenticated,service_role;


-- Owner10Nov: ninth READ bridge only. Snapshot remains at enqueue time.
CREATE FUNCTION sales_lite2.summary_uses_lite(p_from DATE,p_to DATE) RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE zone TEXT;start_at TIMESTAMPTZ;end_at TIMESTAMPTZ;
BEGIN
 IF sales_lite1.enabled() THEN RETURN true;END IF;
 SELECT business_timezone INTO STRICT zone FROM public.business_alert_settings WHERE id=true;
 start_at:=p_from::TIMESTAMP AT TIME ZONE zone;end_at:=(p_to+1)::TIMESTAMP AT TIME ZONE zone;
 -- All branches,including returns after the opening epoch. No NULL equality.
 RETURN EXISTS(SELECT 1 FROM sales_lite1.completions c WHERE c.completed_at>=start_at AND c.completed_at<end_at)
 OR EXISTS(SELECT 1 FROM sales_lite1.returns r WHERE r.created_at>=start_at AND r.created_at<end_at);
END $$;
REVOKE ALL ON FUNCTION sales_lite2.summary_uses_lite(DATE,DATE) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION sales_lite2.business_summary(p_type TEXT,p_from DATE,p_to DATE,p_generated TIMESTAMPTZ) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE zone TEXT;start_at TIMESTAMPTZ;end_at TIMESTAMPTZ;facts JSONB;result JSONB;sales JSONB;
BEGIN
 IF p_type IS NULL OR p_type NOT IN('daily','weekly') OR p_from IS NULL OR p_to IS NULL OR p_generated IS NULL
 OR(p_type='daily' AND p_from<>p_to) OR(p_type='weekly' AND p_to<>p_from+6) THEN
  RAISE EXCEPTION 'Invalid Business summary period.';
 END IF;
 SELECT business_timezone INTO STRICT zone FROM public.business_alert_settings WHERE id=true;
 start_at:=p_from::TIMESTAMP AT TIME ZONE zone;end_at:=(p_to+1)::TIMESTAMP AT TIME ZONE zone;
 facts:=sales_lite2.simple_facts(NULL,start_at,end_at,zone,true);
 -- Same monetary inspection/exchange evidence checks used by the owner reader.
 PERFORM public.tb215_assert_inspection_internal(i.operation_id) FROM public.aftercare215_inspections i
 WHERE i.created_at>=start_at AND i.created_at<end_at;
 PERFORM public.tb215_assert_return_internal(c.operation_id) FROM public.aftercare215_return_contexts c
 WHERE c.created_at>=start_at AND c.created_at<end_at;
 facts:=public.tb215_exchange_financial_adjustment_internal(facts,NULL,start_at,end_at,zone,true);
 SELECT coalesce(jsonb_object_agg(key,value),'{}'::jsonb) INTO sales FROM jsonb_each(facts->'sales')
 WHERE key=ANY(ARRAY['orderCount','completedOrderCount','returnCount','grossSalesInMinorUnits','netSalesInMinorUnits',
 'refundsInMinorUnits','returnEntitlementInMinorUnits','debtReductionInMinorUnits','deliveryFeesInMinorUnits',
 'collectedInMinorUnits','outstandingInMinorUnits','discountInMinorUnits']);
 result:=jsonb_build_object('contractVersion','lite220-business-summary-v1','accountingTracked',false,'summaryType',p_type,
 'generatedAt',p_generated,'period',jsonb_build_object('dateFrom',p_from,'dateTo',p_to,'timezone',zone),
 'sales',sales,'cashFlow',facts->'cashFlow','expenses',facts->'expenses','dailyBreakdown',facts->'dailyBreakdown',
 'balances',jsonb_build_object('customerDueInMinorUnits',facts#>'{balances,customerDueInMinorUnits}',
 'customerOrderCount',facts#>'{balances,customerOrderCount}','customerCount',facts#>'{balances,customerCount}'));
 IF jsonb_typeof(result)<>'object' OR octet_length(result::TEXT)>32768 THEN
  RAISE EXCEPTION 'Business summary payload is invalid or too large.';
 END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION sales_lite2.business_summary(TEXT,DATE,DATE,TIMESTAMPTZ) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.build_business_summary(p_summary_type text, p_period_start date, p_period_end date, p_generated_at timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_result JSONB; BEGIN
  IF sales_lite2.summary_uses_lite(p_period_start,p_period_end) THEN
    RETURN sales_lite2.business_summary(p_summary_type,p_period_start,p_period_end,p_generated_at);
  END IF;
  v_result:=public._build_business_summary_before133(p_summary_type,p_period_start,p_period_end,p_generated_at);
  RETURN jsonb_set(v_result,'{balances}',(v_result->'balances')||public.phase133_supplier_balances_internal());
END; $function$;
CREATE FUNCTION public.lite1_debt_aging2(p_customer_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_result JSONB;
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'accountant', 'sales'],
    'عرض عمر ذمم العملاء'
  );

  WITH eligible AS MATERIALIZED (
    SELECT o.id, o.customer_id, o.total_in_minor_units,
      o.amount_paid_in_minor_units, o.operation_id
    FROM public.orders o
    WHERE o.status IN ('completed', 'delivered')
      AND o.customer_id IS NOT NULL
      AND (p_customer_id IS NULL OR o.customer_id = p_customer_id)
      AND (COALESCE(o.source, 'website') <> 'pos' OR o.payment_method = 'debt')
  ), prior_debt AS MATERIALIZED (
    -- Exact set-based form of121 phase42_order_financial_position_internal's
    -- prior_debt source. Do not introduce a projection/cache or new authority.
    SELECT e.order_id, SUM(e.debt_reduction_amount_in_minor_units)::BIGINT AS amount
    FROM public.sales_return_events e JOIN eligible o ON o.id = e.order_id
    WHERE e.settlement_status = 'settled' AND e.contract_version = 401
      AND o.amount_paid_in_minor_units < o.total_in_minor_units
    GROUP BY e.order_id
  ), financial_positions AS MATERIALIZED (
    SELECT o.*, CASE
      WHEN o.amount_paid_in_minor_units >= o.total_in_minor_units THEN 0::BIGINT
      ELSE GREATEST(o.total_in_minor_units - o.amount_paid_in_minor_units
        - COALESCE(d.amount, 0) - COALESCE((SELECT sum(r.debt_reduction) FROM sales_lite1.returns r WHERE r.order_id=o.id),0), 0)::BIGINT END AS outstanding
    FROM eligible o LEFT JOIN prior_debt d ON d.order_id = o.id
  ), active_payments AS MATERIALIZED (
    SELECT p.order_id, SUM(p.amount_in_minor_units)::BIGINT AS amount
    FROM public.customer_payments p JOIN eligible o ON o.id = p.order_id
    WHERE NOT p.is_reversed
    GROUP BY p.order_id
  ), completion_history AS MATERIALIZED (
    SELECT h.order_id, MIN(h.created_at) AS at
    FROM public.order_status_history h JOIN eligible o ON o.id = h.order_id
    WHERE h.new_status = 'completed'
    GROUP BY h.order_id
  ), completion_operations AS MATERIALIZED (
    SELECT o.id AS order_id, MIN(b.completed_at) AS at
    FROM eligible o JOIN public.business_operations b
      ON b.operation_type = 'phase3_customer_completion_v1'
      AND b.result_snapshot->>'order_id' = o.id::TEXT
      AND b.request_identity_snapshot->>'order_id' = o.id::TEXT
      AND b.completed_at IS NOT NULL
    GROUP BY o.id
  ), principals AS MATERIALIZED (
    SELECT o.id, o.customer_id, o.outstanding,
      -- amount_paid contains initial collection plus effective later vouchers.
      -- Remove only proven active vouchers to recover the original exposure;
      -- the bounded difference to current outstanding is display FIFO coverage.
      LEAST(o.total_in_minor_units, GREATEST(
        o.total_in_minor_units - o.amount_paid_in_minor_units
          + COALESCE(p.amount, 0), o.outstanding, 0))::BIGINT AS principal,
      COALESCE(h.at, c.at, (SELECT completed_at FROM sales_lite1.completions WHERE order_id=o.id), CASE
        WHEN creation.operation_type = 'phase3_pos_sale_v1'
          AND creation.result_snapshot->>'orderId' = o.id::TEXT
        THEN creation.completed_at END) AS completed_at
    FROM financial_positions o
    LEFT JOIN active_payments p ON p.order_id = o.id
    LEFT JOIN completion_history h ON h.order_id = o.id
    LEFT JOIN completion_operations c ON c.order_id = o.id
    LEFT JOIN public.business_operations creation ON creation.id = o.operation_id
    UNION ALL
    -- 161: an active opening debt is a principal at its original date; its
    -- allocated opening collections (163) are coverage like vouchers, and
    -- FIFO still presents all coverage against the oldest principal first.
    SELECT opening.id, opening.customer_id, opening.outstanding,
      opening.principal, opening.occurred_at
    FROM public.go_live_customer_opening_positions_internal(p_customer_id) opening
    UNION ALL
    SELECT c.id,c.customer_id,c.outstanding,c.principal,c.occurred_at
    FROM public.cheque_customer_claim_positions_internal(p_customer_id)c
  ), ordered AS (
    SELECT *,
      SUM(principal - outstanding) OVER (PARTITION BY customer_id) AS coverage,
      COALESCE(SUM(principal) OVER (PARTITION BY customer_id
        ORDER BY completed_at NULLS FIRST, id
        ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) AS prior_principal
    FROM principals
    -- Zero principal contributes neither coverage nor remaining debt. Keep
    -- positive fully-paid principals: their coverage still belongs in FIFO.
    WHERE principal > 0
  ), allocated AS (
    SELECT *, GREATEST(principal - GREATEST(coverage - prior_principal, 0), 0)::BIGINT AS remaining,
      CASE WHEN completed_at IS NOT NULL THEN GREATEST(
        (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Amman')::DATE
        - (completed_at AT TIME ZONE 'Asia/Amman')::DATE, 0) END AS age_days
    FROM ordered
  ), buckets AS (
    SELECT customer_id, SUM(remaining)::BIGINT AS total,
      COALESCE(SUM(remaining) FILTER (WHERE age_days BETWEEN 0 AND 7), 0)::BIGINT AS days_0_7,
      COALESCE(SUM(remaining) FILTER (WHERE age_days BETWEEN 8 AND 30), 0)::BIGINT AS days_8_30,
      COALESCE(SUM(remaining) FILTER (WHERE age_days > 30), 0)::BIGINT AS days_over_30,
      COALESCE(SUM(remaining) FILTER (WHERE age_days IS NULL), 0)::BIGINT AS age_unavailable,
      COUNT(*) FILTER (WHERE remaining > 0 AND age_days IS NULL)::INTEGER AS undated_debt_count,
      CASE WHEN BOOL_OR(remaining > 0 AND age_days IS NULL) THEN NULL
        ELSE MIN(completed_at) FILTER (WHERE remaining > 0) END AS oldest_debt_at,
      CASE WHEN BOOL_OR(remaining > 0 AND age_days IS NULL) THEN NULL
        ELSE MAX(age_days) FILTER (WHERE remaining > 0) END AS oldest_debt_age_days
    FROM allocated GROUP BY customer_id
  ), payment_dates AS (
    SELECT customer_id, MAX(at) AS last_payment_at FROM (
      SELECT p.customer_id, p.created_at AS at
      FROM public.customer_payments p
      WHERE NOT p.is_reversed
        AND (p_customer_id IS NULL OR p.customer_id = p_customer_id)
      UNION ALL
      SELECT c.customer_id, c.created_at FROM public.customer_collection_operations c
      WHERE NOT c.is_reversed AND c.opening_amount_in_minor_units+c.compensation_amount_in_minor_units > 0
        AND (p_customer_id IS NULL OR c.customer_id = p_customer_id)
    ) paid
    GROUP BY customer_id
  ), customers AS (
    SELECT c.id AS customer_id, c.full_name, c.phone, c.credit_limit_in_minor_units,
      COALESCE(b.total, 0) AS total_in_minor_units,
      COALESCE(b.days_0_7, 0) AS days_0_7_in_minor_units,
      COALESCE(b.days_8_30, 0) AS days_8_30_in_minor_units,
      COALESCE(b.days_over_30, 0) AS days_over_30_in_minor_units,
      COALESCE(b.age_unavailable, 0) AS age_unavailable_in_minor_units,
      COALESCE(b.undated_debt_count, 0) AS undated_debt_count,
      b.oldest_debt_at, b.oldest_debt_age_days, p.last_payment_at,
      COALESCE((SELECT SUM(q.amount_in_minor_units) FROM public.deferred_cheques q
        WHERE q.customer_id=c.id AND q.status IN ('pending','endorsed')),0)::BIGINT AS outstanding_cheques_in_minor_units,
      EXISTS(SELECT 1 FROM public.deferred_cheques q WHERE q.customer_id=c.id AND q.status='returned') AS has_returned_cheque
    FROM public.customers c LEFT JOIN buckets b ON b.customer_id = c.id
    LEFT JOIN payment_dates p ON p.customer_id = c.id
    WHERE p_customer_id IS NULL OR c.id = p_customer_id
  )
  SELECT CASE WHEN p_customer_id IS NOT NULL THEN
    (SELECT TO_JSONB(c) FROM customers c)
  ELSE JSONB_BUILD_OBJECT(
    'total_in_minor_units', COALESCE(SUM(c.total_in_minor_units), 0),
    'days_0_7_in_minor_units', COALESCE(SUM(c.days_0_7_in_minor_units), 0),
    'days_8_30_in_minor_units', COALESCE(SUM(c.days_8_30_in_minor_units), 0),
    'days_over_30_in_minor_units', COALESCE(SUM(c.days_over_30_in_minor_units), 0),
    'age_unavailable_in_minor_units', COALESCE(SUM(c.age_unavailable_in_minor_units), 0),
    'undated_debt_count', COALESCE(SUM(c.undated_debt_count), 0),
    'overdue_customer_count', COUNT(*) FILTER (WHERE c.days_over_30_in_minor_units > 0),
    'over_limit_customer_count', COUNT(*) FILTER (
      WHERE c.credit_limit_in_minor_units > 0 AND c.total_in_minor_units > c.credit_limit_in_minor_units),
    'top_overdue_limit', 50,
    'top_overdue', COALESCE((SELECT JSONB_AGG(TO_JSONB(t)
      ORDER BY t.days_over_30_in_minor_units DESC, t.customer_id)
      FROM (SELECT * FROM customers WHERE days_over_30_in_minor_units > 0
        ORDER BY days_over_30_in_minor_units DESC, customer_id LIMIT 50) t), '[]'::JSONB)
  ) END INTO v_result FROM customers c;
  RETURN v_result;
END;
$function$;
REVOKE ALL ON FUNCTION public.lite1_debt_aging2(UUID) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.lite1_debt_aging2(UUID) TO authenticated;
CREATE FUNCTION public.lite1_crm_page2(p_page integer DEFAULT 1, p_page_size integer DEFAULT 10, p_search text DEFAULT NULL::text, p_status text DEFAULT 'all'::text, p_sort text DEFAULT 'latest'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_page INTEGER := COALESCE(p_page, 1);
  v_page_size INTEGER := COALESCE(p_page_size, 10);
  v_search TEXT := NULLIF(BTRIM(p_search), '');
  v_status TEXT := COALESCE(NULLIF(BTRIM(p_status), ''), 'all');
  v_sort TEXT := COALESCE(NULLIF(BTRIM(p_sort), ''), 'latest');
  v_offset INTEGER;
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY[
      'owner', 'admin', 'manager', 'accountant', 'cashier', 'sales',
      'warehouse_keeper', 'orders', 'delivery_driver', 'view_only'
    ],
    'عرض دليل العملاء'
  );
  IF v_page < 1 OR v_page > 100000 THEN RAISE EXCEPTION 'رقم الصفحة غير صالح.'; END IF;
  IF v_page_size < 1 OR v_page_size > 100 THEN RAISE EXCEPTION 'حجم الصفحة يجب أن يكون بين 1 و100.'; END IF;
  IF v_status NOT IN ('all', 'vip', 'active', 'inactive', 'blocked',
    'has_debt', 'overdue', 'over_limit', 'wholesale') THEN RAISE EXCEPTION 'فلتر العملاء غير صالح.'; END IF;
  IF v_sort NOT IN ('latest', 'highest_spending', 'most_orders') THEN RAISE EXCEPTION 'ترتيب العملاء غير صالح.'; END IF;
  IF v_search IS NOT NULL AND CHAR_LENGTH(v_search) > 100 THEN RAISE EXCEPTION 'عبارة البحث طويلة جدًا.'; END IF;
  v_offset := (v_page - 1) * v_page_size;

  RETURN (
    WITH candidates AS MATERIALIZED (
      SELECT c.* FROM public.customers c
      WHERE c.is_deleted = false
        AND (v_search IS NULL OR c.full_name ILIKE '%' || v_search || '%'
          OR COALESCE(c.phone, '') ILIKE '%' || v_search || '%'
          OR COALESCE(c.email, '') ILIKE '%' || v_search || '%')
        AND (v_status IN ('all', 'has_debt', 'overdue', 'over_limit')
          OR (v_status = 'vip' AND c.is_vip = true)
          OR (v_status = 'active' AND c.is_active = true AND c.is_blocked = false)
          OR (v_status = 'inactive' AND c.is_active = false AND c.is_blocked = false)
          OR (v_status = 'blocked' AND c.is_blocked = true)
          OR (v_status = 'wholesale' AND c.customer_type = 'wholesale'))
    ), eligible AS MATERIALIZED (
      SELECT o.id, o.customer_id, o.total_in_minor_units,
        o.amount_paid_in_minor_units, o.operation_id
      FROM public.orders o JOIN candidates c ON c.id = o.customer_id
      WHERE v_status IN ('has_debt', 'overdue', 'over_limit')
        AND o.status IN ('completed', 'delivered')
        AND (COALESCE(o.source, 'website') <> 'pos' OR o.payment_method = 'debt')
        -- A fully covered order without an active payment has zero principal
        -- and zero outstanding in136,so it cannot affect balance or FIFO.
        -- Retain fully covered orders WITH active payments:their coverage still
        -- pays the oldest principal (including a different,undated order).
        AND (o.amount_paid_in_minor_units < o.total_in_minor_units
          OR (v_status = 'overdue' AND o.id IN (
            SELECT p.order_id FROM public.customer_payments p WHERE NOT p.is_reversed)))
    ), prior_debt AS MATERIALIZED (
      -- Same prior_debt source and set-based expression proven in136 against
      -- phase42_customer_receivable_total_internal for every fixture customer.
      SELECT e.order_id, SUM(e.debt_reduction_amount_in_minor_units)::BIGINT AS amount
      FROM public.sales_return_events e JOIN eligible o ON o.id = e.order_id
      WHERE e.settlement_status = 'settled' AND e.contract_version = 401
        AND o.amount_paid_in_minor_units < o.total_in_minor_units
      GROUP BY e.order_id
    ), financial_positions AS NOT MATERIALIZED (
      SELECT o.*, CASE
        WHEN o.amount_paid_in_minor_units >= o.total_in_minor_units THEN 0::BIGINT
        ELSE GREATEST(o.total_in_minor_units - o.amount_paid_in_minor_units
          - COALESCE(d.amount, 0) - COALESCE((SELECT sum(r.debt_reduction) FROM sales_lite1.returns r WHERE r.order_id=o.id),0), 0)::BIGINT END AS outstanding
      FROM eligible o LEFT JOIN prior_debt d ON d.order_id = o.id
    ), opening_debts AS MATERIALIZED (
      -- 161: active opening debts of candidate customers, original date kept.
      SELECT opening.id, opening.customer_id, opening.principal, opening.outstanding AS amount,
        opening.occurred_at
      FROM public.go_live_customer_opening_positions_internal(NULL) opening
      JOIN candidates c ON c.id = opening.customer_id
      WHERE v_status IN ('has_debt', 'overdue', 'over_limit')
      UNION ALL
      SELECT d.id,d.customer_id,d.principal,d.outstanding,d.occurred_at
      FROM public.cheque_customer_claim_positions_internal(NULL)d JOIN candidates c ON c.id=d.customer_id
      WHERE v_status IN ('has_debt','overdue','over_limit')
    ), balances AS (
      SELECT customer_id, SUM(amount)::BIGINT AS amount
      FROM (SELECT customer_id, outstanding AS amount FROM financial_positions
        UNION ALL SELECT customer_id, amount FROM opening_debts) debt
      GROUP BY customer_id
    ), active_payments AS NOT MATERIALIZED (
      SELECT p.order_id, SUM(p.amount_in_minor_units)::BIGINT AS amount
      FROM public.customer_payments p JOIN eligible o ON o.id = p.order_id
      WHERE v_status = 'overdue' AND NOT p.is_reversed
      GROUP BY p.order_id
    ), completion_history AS NOT MATERIALIZED (
      SELECT h.order_id, MIN(h.created_at) AS at
      FROM public.order_status_history h JOIN eligible o ON o.id = h.order_id
      WHERE v_status = 'overdue' AND h.new_status = 'completed'
      GROUP BY h.order_id
    ), completion_operations AS NOT MATERIALIZED (
      SELECT o.id AS order_id, MIN(b.completed_at) AS at
      FROM eligible o JOIN public.business_operations b
        ON b.operation_type = 'phase3_customer_completion_v1'
        AND b.result_snapshot->>'order_id' = o.id::TEXT
        AND b.request_identity_snapshot->>'order_id' = o.id::TEXT
        AND b.completed_at IS NOT NULL
      WHERE v_status = 'overdue'
      GROUP BY o.id
    ), principals AS NOT MATERIALIZED (
      SELECT o.id, o.customer_id, o.outstanding,
        LEAST(o.total_in_minor_units, GREATEST(
          o.total_in_minor_units - o.amount_paid_in_minor_units
            + COALESCE(p.amount, 0), o.outstanding, 0))::BIGINT AS principal,
        COALESCE(h.at, c.at, (SELECT completed_at FROM sales_lite1.completions WHERE order_id=o.id), CASE
          WHEN creation.operation_type = 'phase3_pos_sale_v1'
            AND creation.result_snapshot->>'orderId' = o.id::TEXT
          THEN creation.completed_at END) AS completed_at
      FROM financial_positions o
      LEFT JOIN active_payments p ON p.order_id = o.id
      LEFT JOIN completion_history h ON h.order_id = o.id
      LEFT JOIN completion_operations c ON c.order_id = o.id
      LEFT JOIN public.business_operations creation ON creation.id = o.operation_id
      WHERE v_status = 'overdue'
      UNION ALL
      SELECT opening.id, opening.customer_id, opening.amount, opening.principal, opening.occurred_at
      FROM opening_debts opening WHERE v_status = 'overdue'
    ), ordered AS (
      SELECT *, SUM(principal - outstanding) OVER (PARTITION BY customer_id) AS coverage,
        COALESCE(SUM(principal) OVER (PARTITION BY customer_id
          ORDER BY completed_at NULLS FIRST, id
          ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) AS prior_principal
      FROM principals WHERE principal > 0
    ), allocated AS (
      SELECT *, GREATEST(principal - GREATEST(coverage - prior_principal, 0), 0)::BIGINT AS remaining,
        CASE WHEN completed_at IS NOT NULL THEN GREATEST(
          (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Amman')::DATE
          - (completed_at AT TIME ZONE 'Asia/Amman')::DATE, 0) END AS age_days
      FROM ordered
    ), overdue AS (
      SELECT customer_id, SUM(remaining)::BIGINT AS amount
      FROM allocated
      WHERE age_days > 30
      GROUP BY customer_id
    ), customer_directory AS (
      SELECT c.id, c.full_name, c.phone, c.email, c.whatsapp, c.governorate,
        c.notes, c.customer_type, c.is_active, c.is_vip, c.is_blocked, c.is_deleted,
        c.credit_limit_in_minor_units, c.created_at, c.updated_at,
        COALESCE(c.governorate, '') AS address_governorate,
        COALESCE(order_stats.total_orders_count, 0)::INTEGER AS total_orders_count,
        COALESCE(order_stats.total_spending_in_minor_units, 0)::BIGINT AS total_spending_in_minor_units
      FROM candidates c
      LEFT JOIN balances balance ON balance.customer_id = c.id
      LEFT JOIN overdue debt_age ON debt_age.customer_id = c.id
      LEFT JOIN LATERAL (
        SELECT COUNT(*) FILTER (WHERE COALESCE(o.source, 'website') <> 'pos')::INTEGER AS total_orders_count,
          COALESCE(SUM(o.total_in_minor_units) FILTER (
            WHERE COALESCE(o.source, 'website') <> 'pos'
              AND o.status IN ('completed', 'delivered')), 0)::BIGINT AS total_spending_in_minor_units
        FROM public.orders o WHERE o.customer_id = c.id
          AND v_sort IN ('highest_spending', 'most_orders')
      ) order_stats ON true
      WHERE (v_status <> 'has_debt' OR COALESCE(balance.amount, 0) > 0)
        AND (v_status <> 'overdue' OR COALESCE(debt_age.amount, 0) > 0)
        AND (v_status <> 'over_limit' OR (c.credit_limit_in_minor_units > 0
          AND COALESCE(balance.amount, 0) > c.credit_limit_in_minor_units))
    ), paged_customers AS (
      SELECT * FROM customer_directory
      ORDER BY
        CASE WHEN v_sort = 'highest_spending' THEN total_spending_in_minor_units END DESC,
        CASE WHEN v_sort = 'most_orders' THEN total_orders_count END DESC,
        CASE WHEN v_sort = 'latest' THEN created_at END DESC,
        id DESC
      OFFSET v_offset LIMIT v_page_size
    )
    SELECT jsonb_build_object(
      'customers', COALESCE((SELECT jsonb_agg(to_jsonb(pc) || jsonb_build_object(
        -- Display-only fields are read for the page,not every matching client.
        -- Historical spend/count are still computed before paging when sorting
        -- by them;their old definitions and tie-break order are unchanged.
        'address_governorate', COALESCE(address.governorate, pc.governorate, ''),
        'total_orders_count', CASE WHEN v_sort = 'latest'
          THEN COALESCE(order_stats.total_orders_count, 0) ELSE pc.total_orders_count END,
        'total_spending_in_minor_units', CASE WHEN v_sort = 'latest'
          THEN COALESCE(order_stats.total_spending_in_minor_units, 0) ELSE pc.total_spending_in_minor_units END,
        'current_balance_in_minor_units', public.phase42_customer_receivable_total_internal(pc.id),
        'outstanding_cheques_in_minor_units',COALESCE((SELECT SUM(q.amount_in_minor_units) FROM public.deferred_cheques q
          WHERE q.customer_id=pc.id AND q.status IN ('pending','endorsed')),0),
        'has_returned_cheque',EXISTS(SELECT 1 FROM public.deferred_cheques q WHERE q.customer_id=pc.id AND q.status='returned')))
        FROM paged_customers pc
        LEFT JOIN LATERAL (
          SELECT ca.governorate FROM public.customer_addresses ca
          WHERE ca.customer_id = pc.id
          ORDER BY ca.is_default DESC, ca.created_at DESC LIMIT 1
        ) address ON true
        LEFT JOIN LATERAL (
          SELECT COUNT(*) FILTER (WHERE COALESCE(o.source, 'website') <> 'pos')::INTEGER AS total_orders_count,
            COALESCE(SUM(o.total_in_minor_units) FILTER (
              WHERE COALESCE(o.source, 'website') <> 'pos'
                AND o.status IN ('completed', 'delivered')), 0)::BIGINT AS total_spending_in_minor_units
          FROM public.orders o WHERE o.customer_id = pc.id AND v_sort = 'latest'
        ) order_stats ON true), '[]'::JSONB),
      'total_count', (SELECT COUNT(*)::INTEGER FROM customer_directory)
    )
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.lite1_crm_page2(INTEGER,INTEGER,TEXT,TEXT,TEXT) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.lite1_crm_page2(INTEGER,INTEGER,TEXT,TEXT,TEXT) TO authenticated;
-- Owner11Nov M3. New trigger;no existing payment/reversal writer is changed.
CREATE FUNCTION sales_lite2.guard_payment_lite_refund() RETURNS TRIGGER
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NOT OLD.is_reversed AND NEW.is_reversed AND EXISTS(
  SELECT 1 FROM sales_lite1.returns r WHERE r.order_id=OLD.order_id AND r.money_refund>0
 ) THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='LITE3_COLLECTION_REVERSAL_HAS_LITE_REFUND',
  DETAIL='لا يمكن عكس سند القبض بعد رد مبلغ بمرتجع لهذه الفاتورة. راجع المرتجع والتحصيل أولاً.';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION sales_lite2.guard_payment_lite_refund() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER lite3_payment_refund_guard BEFORE UPDATE OF is_reversed ON public.customer_payments
FOR EACH ROW WHEN(NOT OLD.is_reversed AND NEW.is_reversed)
EXECUTE FUNCTION sales_lite2.guard_payment_lite_refund();

 CREATE INDEX lite3_returns_order_id_idx ON sales_lite1.returns(order_id);
 CREATE INDEX lite3_returns_item_id_idx ON sales_lite1.returns(item_id);
 CREATE INDEX lite3_returns_shift_id_idx ON sales_lite1.returns(shift_id);
 REVOKE ALL ON FUNCTION public.lite1_expense(UUID,BIGINT,TEXT,TEXT,TEXT) FROM PUBLIC,anon,authenticated,service_role;
 
DO $frozen220_after$ DECLARE mismatches BIGINT; frankfurt_matches BIGINT; BEGIN
 WITH expected(signature,source_hash,definition_hash,owner_name,config,acl) AS(VALUES
('_archive_supplier_receipt_impl(uuid,boolean)','0307f405475c908e3e5eca343e6833c6713f813d6755c03705e0790d6ee7b572','0fa8d35048847084afde6de1433d4fa843c337754f8de2cba4b8d82cdd6ce2f1','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('_build_business_summary_before133(text,date,date,timestamp with time zone)','b01e43721599a9191e4ba41d76f7448b50044b15d53d2e56baa6bf44de4c6f52','9d5497c4ea3e979a326d580233c99180f4d88b93e4fcf6707f94fdb5cac913f7','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('_build_business_summary_before_phase6(text,date,date,timestamp with time zone)','4b5bb0ae5e98976b0a1894cd0c274c4f4ecc0348ad91877a5b0173bd27e0981c','3fd7ce7540054283e4f34bcc5be8487eb7ca1fd782fdfc7e699ab6be90e0770a','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('_calculate_guest_promotion(text,jsonb,text)','5f0826f4419e1439085b97b8f9a34ae870304f73f0cd913ac2d27f1b263ff110','8dbaa5e94fca0343fcdea488c7be344f9f163a77825f2925d05a0a24db43431c','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('_cancel_empty_cash_shift_before_return_events(uuid,text)','981240dd331e0ac283c16aa8209c05a3b2f48f827432ba1244a4e57709007cf4','52eff974919feef6bfe9974cee3460cbdad5cb62535b7b99c4defa45f47171a4','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('_cancel_order_impl(uuid,text)','e99f70493d0ebf2d7f0ee5fe97ff2b6654df6621ae3ef7082a16d4b8a1387b2b','64ed343a18e14535206555630cc6c154a1cb898f718e8f812af8a89aaa406ade','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('_cancel_order_impl_before_phase4_lock(uuid,text)','c42e39dfaa23b65fbe56c1098e2fe2f88a35320cd0a0a818d17e2904be69f833','a61f490e9b1975fca4dc86acc92a58d691795cd82d3dff661289120bd6e1b5e9','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('_cancel_purchase_receipt_v2_before_phase4_lock(uuid,text)','257528fcbd2103c26c923b968b1fb7102416fa154b1c67e95a65b34ad2d1a339','950c2d3131ed4780e0660b273e783cb0acf5c41dc1f49ca5bb5a410adb09c7dc','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('_cancel_supplier_receipt_before_phase4_lock(uuid,text)','655357651546810c11209f5f0ca42d288123d9eb4676336ee62d7385f614d88e','d5aeaa0a33caa98e1d165720f07e8ef471a43c75318fa8aa96b79cd680a9211e','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('_cancel_supplier_receipt_impl(uuid,text)','2eba4b4b2e428673b97b162b5921e04cc925cd8cec56c3f7dd0f542c06c20081','17091b890899da482ac854bf4399e734000c0bb5cb98f0ca6cb97dcdc6df3b54','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('_cancel_supplier_receipt_legacy_guarded_v2(uuid,text)','be3b598eac64ed8639647f9ded79afceb518adc1cb19b7eaadc5c90b7100a9bf','14e9adef4f8b078c573800efa6a22c20ff23b382456474ffcbd8803d82126eba','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('_close_cash_shift_before_closing_report_snapshot(uuid,bigint,text)','c99c381e329c21e528ffef454405f58f71212503b5d2fb8c20bb3ba81c0f5914','dc9458b135cba7cd9aadb7aa8acf33cdb115ea72c977ad3ec22e783a721e61d7','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('_complete_order_impl(uuid,text)','8e8559c46e89768a30e670995c0dbee0b4810fb24ea721ea7eed9642316b654f','637db9ed1559e02b016e6ae49547e4c244aab466f177bd29bb32e14033fb305e','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('_complete_order_impl_before_phase4_lock(uuid,text)','9abfe62b99f019cd0be7649ec989de20efcdbc5bfacf8ed242b3dea323306abb','b291739b378a84d436ae0354c9b8b586ac2e8c87cde571f262423c9a78f0cac8','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('_complete_website_order_with_settlement_before_phase4_lock(uuid,text,bigint,bigint,text,text)','2f9aabb48e2cd28f0a88604dffa336e57e39f0336f505f18a94f54d511a8ee87','04e9d34af947f5d8216b053d98be42baec318d2c84b870d750654d3dfe96dafb','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('_complete_website_order_with_settlement_v2_before_phase4_lock(uuid,text,text,bigint,bigint,text,text)','5ab09f9426b691dbe1af0ca4935ea461499d6f429ab082399799241a1e308a33','c5ad64540fb73c85b72beb09e0269b23e17b3711b6592721577ba044e2ed3675','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('_confirm_order_impl(uuid,text)','0637dfe3f730e8ed70a02b8d9dfd67d50de3493440d24e11cc132d9378e6a81f','86be3e832bf328d590ad8c0333b5c23dc04c69341c1cac493dda2f40042cf7f4','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('_create_direct_supplier_receipt_impl(uuid,uuid,uuid,text,date,timestamp with time zone,bigint,bigint,bigint,bigint,text,text,text,text,uuid,jsonb)','a4230edfd2ab12741f8f1f0dc4a2f199d3a7c39b40c472a2256dd5250b44e657','2f5378e72513008621a454ca03f1f37ea0a583738d16e196ae21340a24672c6d','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('_create_pos_sale_base_units_before_phase3_lock(uuid,uuid,uuid,text,text,jsonb,bigint,bigint,text)','552effd40c17a3bb7f6833bdfb91cb7e5eda1617cc7dfcb89159882aea9857cf','fdaedd1b3732424dd8734fc3ede3af94ab7abad84578db3f3bad0efcb89e391a','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('_create_pos_sale_package_legacy(uuid,uuid,uuid,text,text,jsonb,bigint,bigint,text)','a2255860d58bd55f926f800364d401a9dc604d45ff11c5df3e8d772a8d1ea573','852096efb2252e5aa0dbcb6993907d39e27b8a0225b7ae4b8a57014fc85e34a0','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('_create_pos_sale_v2_before_registered_customer_lock(uuid,uuid,uuid,text,text,jsonb,bigint,bigint,text)','035722f38503a2416fe0ad0b067d2bd5309d732026047f76b81ae76ee7fbe3b7','590508615323dd1bf11cba9a265126842174edc12a8df52651e7b2df01f23126','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('_create_product_with_opening_stock_impl(text,text,text,text,uuid,uuid,uuid,uuid,integer,bigint,bigint,bigint,integer,integer,uuid,integer,text)','9161e9574030cda6056ea178226a5233ada0a64ffbe49c983be4e21a9546d08e','7f64eb63af63f93410aa9701b0b9e1fadd66a60bc3e0fa1fc439682c07a4d4f8','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('_create_purchase_order_impl(uuid,uuid,uuid,timestamp with time zone,bigint,bigint,text,text,text,jsonb)','824ed62ddeaaf41ade8d1e503c282666742cdbf57d636fc65d310c5be73b10d8','30664a61f4cf8c4dea8692143fcffb6df20b3e977828ef1a22264c02de518719','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('_get_cash_shift_closing_report_before_return_events(uuid)','b9d9656f6ad829cb1fac20c5a9826cca46a53b83c98b7f52b867b063b3601651','5f847b1e6076d9f3d557d1e4680ba6159afeb8b7aa5f0dd32c57b78e14ae6036','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('_get_cash_shift_closing_report_before_snapshot(uuid)','1d4bdf58b36935ebef9bc9461281af9197af968cebc1b221091deb0c87691b07','bb192379fe8d76721b4c91e3a21d9a2b459ca7d2c9e8ca764e9b55759a34815f','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('_get_cash_shift_closing_report_v1(uuid)','b9f548ea48e85340c02ba2d77ab5bf70a57925962799bcb620d9ca5902f3e148','32c57160272d5971e652e374e1f2a10853a6b97b9f58a11c9e0efda858260b67','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('_get_cash_shift_summary_before_return_events(uuid)','a6f0984fbf13c24e50255d55b2fbb588ad0d8a5394df530af59ec83d1a04dcb7','fb70fb02d375e116d34136f46132141ee38512b207b23f22c4d104a448fc5a52','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('_get_cash_shift_summary_v1(uuid)','6a36717e52aa2776d7b2b9a214ed0ca3f69b347ba52e6cd133bed179168f4f8a','3668fb35c9f22b7e1c3655a3b27a784865aa10212befb9b60ae162c01919615d','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('_get_crm_customer_detail_page_before_phase42_receivables(uuid,integer,integer)','432318a880f915d5a2133e87aa51360d18096a7684982f0f42f004e4ecd138d4','d8e81b655b6851ca7f47fadf333001fd7dd51f393ba21ddac37ebdf3a88fbd2a','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('_get_crm_customer_page_before_phase42_receivables(integer,integer,text,text,text)','bd07bb3502c61e970f63c2c6d46bf51898c12bc2c7acd34abf3111227d484542','65c81bbc6f1cca66d54248571562fe2b71bcc2c879fdd53bda5927a48e471a86','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('_get_expense_shift_center_v1(uuid,integer)','2b0d69b5e5f0a12be28efcd3b757663f337544ae056aaa5407c6c79603258ea7','5ae3b7b311271cc57996a4457674df7bbf7b714c04889ae88698c1a9d656a244','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('_get_home_dashboard_before133()','d8d11731fd29a1a273fd738446c80134000a4b74ca85bfdfd8ea63c61c78ffa8','1d01cec2ae84980f88171e4abaf82794a097c06e48b10379163c105a0d2722a8','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('_get_home_dashboard_before_phase6()','14da3b09ce3d54f092af74341a9d82925cdbc22057aa46ea7e440cb46727f897','432dfc3339885f4fbb747f926d4670e7cc7e76dceb8fef56ba4e92b7689508fd','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('_get_inventory_opening_setup_including_flavor_masters_v1(uuid)','a9035c5480d555f5da87c777040dadcaf2129f02e7e433e94f884997b18fe2e5','20868be93cfe748d8f30dcebc83f7402c55d3f9c0cfa0a4e3a6a6e1128c6d5d7','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('_get_operational_business_report_before133(uuid,date,date)','b597bb767101a149f6e6b9589a547ff5513843c74f8ec4ec52e8a9997d2d426a','9d00e3e8dde311abaad6f1950cab98515f7c3399bf2e7d17b9ad1071277ad071','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('_get_operational_business_report_before_phase6(uuid,date,date)','a8743f5853f500ae2b674c693a0b8428f0126f7994aaaccf8ad87487e6706f80','12fe8941a5ffe802bdbf96b0dceb1b457766be2f0a47c5fcfa0ac185c99b8386','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('_get_operational_business_report_v1(uuid,date,date)','1c91abaad54f0e41ecd23d7d0e766cafb4632335ad8d7810e24141b8cb02507d','91d8a89415d1d93aa629963323e8d1c4ae1ea0231b5009bbaaf5112e13da2725','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('_get_operational_business_report_v2(uuid,date,date)','8cdec3f55549e8d67e8d24ce0e0bc23e1b946f2d2257e152a5b1ce75c278592a','489c804026597de5e28be26f0eb589e01108ea14798106a9cd8af2a424b82833','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('_preview_cash_shift_full_reversal(uuid)','8df0c0b4559029df8d403f2afe992d72a9c24a70c4e2885ee584915724047aa6','c2330e66ebbcb36f8167c87e0ac298d50ff2ccf4556d87714c56c916f19f1104','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('_preview_cash_shift_full_reversal_before133(uuid)','4444d0186b97fb6b5a7c8a758fdf74413cd471f4ca493d1f259d0c524980d848','192f724814ffb1c84580413a7f83bd18d886b82485c785b4fc4ca353e73c97ea','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('_preview_cash_shift_full_reversal_before_paid_order_guard(uuid)','aaa92d260e46b7648d03ed70fab2f2af2ce25fedb969d0f2bbb5a230165fc32e','8b4ca152ec70641986e57a5123cdd7e6e4798d015e6baacaba27470eca889835','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('_receive_inventory_impl(uuid,uuid,integer,text,uuid,text)','2f660eb3e094b2538278bcdaef36b6878acd9972e8c184c296c7b1439bb8b9a5','c92d9b055a8e9b8e0b0ad157e9f610236bac31e7a2d1c23c9a1fc048600b8585','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('_receive_purchase_order_impl(uuid,uuid,text,text,jsonb)','01709a375da7952019fe71fa91b35ee15f7cc2273e432d9b231bb329aea7854c','0a541dfd6f4812ecca822625831bbf618a6006c22c8050f49b929cda8a2694f9','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('_record_customer_order_payment_before_phase42_financial_guard(uuid,bigint,text,text,text)','7c803cd2409d6b6e40a59a037359bf66a8960b3f27f4676d54975d75b596c945','9e5cea4becbd49ba71fd367897697e7b3bc0a363835d344463367b2a3d25ebf2','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('_record_customer_order_payment_before_phase4_lock(uuid,bigint,text,text,text)','d622f9c5d8a02520b653ee01e7a1f1ec23b91189de9e5f89dc0622929fa6aa16','7e7f32e0b9329dde0960a45212a83d9f38962de089ec70c6284ee7a195cd047e','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('_record_supplier_payment_idempotency_legacy(uuid,uuid,bigint,text,text,timestamp with time zone,text)','fccdbdaa04147905bfc150e65db7b42bef88ec48941076ebf556fbd9719d67b0','75eb3918e3c25e60790f2eecf4b010cb966fd7da8a58b2e5f7754af87f1a88c9','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('_record_supplier_payment_impl(uuid,uuid,bigint,text,text,timestamp with time zone,text)','0a3fad7eb377d4712c7c07858644113a46bc683df1866f4ed4c996d64e37b8b6','d1374578f702d7c09251aecaa1e1adf7e8bc5952c12d3f15dfb5f1368de18a35','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('_record_supplier_receipt_payment_idempotency_legacy(uuid,bigint,text,text,text)','addf5cef00e95e260c1faba844a9877c6fdd5649cb46ee484c5b1cb9e504760d','8eec6096f38e4e9323e9f80256efe8cd7f9ebfdd8d5254a9559a26a6c4fdb3ea','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('_record_supplier_receipt_payment_impl(uuid,bigint,text,text,text)','cdf61d824f4b8cba9f8706cab40efb7a06d26b41e4fea9abe0ec1762d7d3e452','9e17a07c703220aa50eaaf07b3278db121f4e23719e0d399c9c420668b0eb6b4','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('_return_completed_website_order_before_phase42_coordinator(uuid,text,text,text,text,text)','1b3590df77595c46acccb3431a2422f5822d5c13b1616f543acbca09ea73502e','c9b7a8c020169f5fb7e5ac7cbe7125f31b0cb7ee648866aae37de934e1f0d35f','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('_return_completed_website_order_before_phase4_lock(uuid,text,text,text,text,text)','f4d6dcb997fc4a429a7c8372f0ff6ac2251e0111f041dead3e63a99a176db28c','8b2367f8557000d97d6c83d272289f248bf4df155c32d7cc16105c848eeedd57','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('_reverse_cash_shift_with_operations_before_phase42_refund_guard(uuid,text,text)','3c71fa32ed70aa6d780954b78337398bf5b69fb7a265306bd50f0141906b708a','fc719df8804769420dd07894be8282f11d69dd0547a157f85b05c883bbba171d','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('_reverse_cash_shift_with_operations_before_phase4_lock(uuid,text,text)','455aa3add85f8dce1e38ba676d6e4147a5fa4e5b0d95a3cf1d8bdc1443e7cbe0','136f680c17927f7ec1248129acf9d4a9880d6d02679e6e9f45bab2418f064df4','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('_reverse_customer_order_payment_before_phase4_lock(uuid,text)','f884466d45fc2af049a51ca28e55038696ae693b5c97ba59afb9e530a0850586','3bc71937597f0b828fc0cfa48a4bb4f9de41f65626bb44839a2834d16a2792e6','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('_reverse_operational_expense_before_phase4_lock(uuid,text)','18f1765319d7b2c79b9c9386c6a9a68b4bf9703c0ab788cb0fa6725854275d6c','43999a98b2ec0ef661b5ace2cd62f57eb95c99848a1e3c47c88866c7b6f7e1a9','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('_reverse_supplier_payment_before_phase4_lock(uuid,text,text)','3f6430fd142c3eec52cc016543437657dbc73a2a8acd9249a84a500ca43fd622','5a946096d13324252f1520b84fcc8a190a0b07452119ff6180a9c508e3e8920d','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('_set_advanced_monitoring_check(text,text,text,text,text,integer,text,jsonb,timestamp with time zone)','f5f9d6977ed359c898b7b84ffb4390da3d624c688f4e5298bc365d56b38ac0f2','e4537130a5b7a826febeea690503c2929e08198a25cf1f84fa9b53a3ace05dfb','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('_submit_guest_customer_order_v1_before_phase3(text,text,text,text,text,text,text,text,text,text,double precision,double precision,text,jsonb,text,text,text)','30f6c6b42666e0faab5ce0e2be45b7578355ca29c1b5fe4f5b2494d5569b1af6','2068f9817b7a8a6a87ab53adc73058700b7975fa710b88b59d83e61b3733e014','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('_transfer_inventory_between_warehouses_phase2_legacy(uuid,uuid,uuid,integer,text,timestamp with time zone)','38435a5319305f156d0f972bf16460b7982369864e6453241ff96d5763062bcd','2803674c4daf75f4d9a589d785238b482e68ad2a681ee36b8c191cf9065e3200','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('_transition_business_alert_incident(text,text,uuid,boolean,timestamp with time zone,jsonb,boolean)','3c716d197df8cb33ea0c20da9e3a280aceac6938f7f707e923dda408e23fbcad','035ad576dd9b0c6d049d9b9f43602987715821a9fa986f147efa4433bf83b3e2','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('_update_order_status_impl(uuid,text,text)','ccc2373770e742b382ebab94846c82903d15b67345269431ab5ffebbd9c66f90','d857078c6b5f13d1637626d28bfd9ac5c1694377c3b2b59e9eaa155fe6a633c6','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('_update_purchase_order_status_impl(uuid,text,text)','1efb78f2325b7e813be9baebfdb2300b3f40ee44c424e5c44c3ce583fbd48f7d','ee20d500f9850a0425b1a85047c8f1299fedad07775073f8d42b7e11c1b19c17','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('accept_order_for_preparation(uuid,text)','88464a07ecc0310fff25a975966844b9fddc94786ce3477178e4bfdfbf48dd74','1879e61307e71d3150dffe0ec238bdc4a7ec050f0775a031e96f5c2f3b571f91','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('add_customer_address(uuid,text,text,text,text,text,text,text,text,double precision,double precision,boolean)','34b076d3f1cd2ff0e76932036b7735ee44e6a2fc36c78ae5625f123bb873178b','fc18f350c5522af8cbb69c4e80877a5485a84fd696c2a05b50076893c0a00c6f','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('adjust_inventory_stock(uuid,uuid,integer,text,text)','2bfa181c2b7782ac55b1d5c850f7af9672354f2f87e81a36813d6f497ad583f9','a109e350e3bc8e6b6b40c0963ccc3b3fde8e7357291d5b1bdb1b2f899e858207','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('aftercare211_assert_replacement_root_internal(uuid,integer)','c9b777eaecb078427d1d45aed427f1dcc4d78f44eb0e3bdc5049813e2245b692','82aca37d8da5df482ba59c0af7affc65b9fa6427102ab1ffd38d76238f123ff2','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('apply_inventory_opening_setup(uuid,jsonb,text,text)','ad15e0ff0e446d5203fc7bae70223a59cd24957d3799a5689ca444e2255a5faf','3062a2a65c67a0075a93dd73a35dd92fa342f734bfff91ff3bffe2c8f5e8b285','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('archive_supplier_receipt(uuid,boolean)','8ac810195addddf780c10e78d6bc47002185ed4cdd3d1c0af8d0fff1e88e00b1','e970551336e13f9ac5c5635a2b2845e90fa4dd977f91060ba908b6596d9d9a76','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('assert_closed_cash_shift_has_snapshot()','8e9800c59e2252d23478d5880f9a061b9c1eb81a1de90218586fa03aad290231','fad68d9c9b607d3ff83a290cdf058535e81e1a4c9bcce611c6470b428709c666','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('assert_configurable_parcel_creation_allowed()','90875cd1e8136293145646ea8f2a2b6c8b297cdad0532d0c7473a479d703323a','4fb03b24d2b04c40521bfb2553c2b91cc063b1a33e00ce241e27f2ee64491fdd','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('assert_erp_role(text[],text)','43ba25c28960e79ed99d1c02e530bbd765ad0c276daac192b943c85ebd7d5f62','6544d6eec04ac29c076f509af11b99d6f080578a3d2723df0679a72353fe354c','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('assert_monitoring_owner()','c15550542d3c37e7dfdf2deca529dab529c2eba4afe40eee26e95cdbaa9faa83','452dcceb675d65c469023e34cee3d4b465c8e4635a40ae0f421d6e706cb0825e','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('assert_order_parcel_composition_total()','8b854104f923175e45dd483e9b6e9ddc343422507de398bb524d94449bcfdcb9','51e1ea5d8a1cd2674da8426539af4da77c2d92e04c361f9193a23083e827485d','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('assert_phase2_receipt_reconciliation()','4ab06d43be86f88a459472fd1686792e36a64325fa60f5a3bfb175dfa42d512e','11faaa169f54c2a07b8e9bd7eb30546207779e90ce8197e120e5599b7954ca47','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('assert_reversal_owner(text)','7c281f0740088f8c04666ddb36c7c18687e64704d568ff05851bb1c05996e7b1','466e19412b67d06a77272cacdd35ed876ba6d487595fa63760c4a767958357b9','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('assign_inventory_movement_mutation_sequence()','36116406b2a8e6c40fbd66ed19249f0cc166cb5e131db07325fbba9e66cfea3c','5417c3ed893b48c98c67a33e9d66c475437746a778427c367ca7aa87fc9d68d6','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('attach_customer_payment_to_open_shift()','81ba6a38d6518f355b19b07d2a19ffb48aca42454d89dd7a8ae38ab1f5362578','48d8c55ad953c3b9d087c932890b354fbe60e10e3d493032e503381597449a1b','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('attach_open_cash_shift_to_pos_order()','d7beeaaa2c6cb3940bdec5a5ab7ce3eb61c2da7fa6c6aac201c39cea3373193b','b56102f6cbeb2acd4d04ca54a07bd33d5cfb7091e2cff92f4a81ded410c64afd','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('attach_supplier_payment_to_open_shift()','4ebe9cd878bb928c5730206bd14f924ce47625c3b8953e4b4607e1a22d133f3f','4035142cf6bcf34cb4fcc632a49a5f4c8cb5226d84ecb04fa0416f01b6da7674','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('authorize_admin_ai_assistant_request()','1442afa9e63a3c7cc87a8c8f78f5917960414809431aa800b5a83b7c8e22044f','24be232932cba4b9387cb178153d7866542713ee1da6ec86a238ad296e643741','postgres','["search_path=public"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('authorize_guest_order_gateway(uuid,text,text,text)','2a5ef29cf5efb2e798e947d9a204f4490afd492da8e43096be5dbd7966463ee4','3687f949c2d9cfac21787ad1e31becd64a6e5401bed833fd3f9d6df6c9864a09','postgres','["search_path=public, pg_temp","lock_timeout=3s","statement_timeout=5s"]'::jsonb,'{postgres=X/postgres,service_role=X/postgres}'),
('build_business_summary(text,date,date,timestamp with time zone)','cb894b1872b36187be6eeb148bcf66a313465bd24c3ca05b2709b4fdea71cbb4','2f6626f2b33ea1804d15e408d13ab8067f45e47b7a17ec68c0e8f4fb8d94f88f','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,service_role=X/postgres}'),
('build_public_order_tracking_payload(uuid)','99a3b263835c4cb1bbe85ab5e7979254650be657f8ff501bfafab336b9a8758e','081c97ab54c49d92db6bb59beec95a28065cce8fb1677aa719a393290bc1dbbf','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('cancel_customer_order_v2(uuid,text,text)','fd8b9fca84ddb2c871ea0d1f3ba844bccfa0d634734e50f81ffe60abe0f8291d','1fd06d5f391af914d1d8ffb666a817e8924aa2f17405c33ca7e3d0a5b3d505c2','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('cancel_deferred_cheque_v1(uuid,integer,text,text)','6a2dbcec3bf30e3c6aa10f33df7fa2b8c4e116090ce1ff550ac76d51cb2d1447','475167ffcc2cf76eba947efa0d7c521973b03b6402ea1334eed2fc175df549a8','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('cancel_empty_cash_shift(uuid,text)','510e84b27bdfdda7f9950fdff3731eae9295e8613b28887923bd2cdde8c474ab','0036eefc9a808a409350eb93028db0b859fd39e55ca2bac737d633649980d231','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('cancel_order(uuid,text)','84098d1b0f3902b7ca879afa4fa9b0ab20bc4c3990e57bad8da1ebb33aa84430','36d6c96c4d086f9bc47434db1c1d058812c8ad3907c8a95ef72ffbd4a736bf43','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('cancel_purchase_order(uuid,text)','6ecbaded23dfbf33a617fe6890db62cd0470adf19ca9742e958900660e9d54e1','bb32f76e503888b2d121384ce8aa0f7ca8270caa1b86d962334e80b375d498ec','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('cancel_purchase_receipt_v2(uuid,text)','68b19fa86284d38468bbeec1356914c0dd8d09c480fdc57fd9e3639b0f2902ef','246cc1d2a58494fd9b94e43eb523205d1bf722caec22f8e8ae36c8475d5aec08','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('cancel_supplier_receipt(uuid,text)','5bf1438714ce14d87d1aa648d85e29aa1666459c19a033862440adeb7bc23aab','d54d967a260f2370176434f99ea7e2da1d690231a42ee57c727e7dc95a62e351','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('cancel_uncommitted_pos_sale_attempt_v1(text,text,boolean)','848add08edce906a801cbf250b86f306198c2bb5804d3ddfa6a56c0cae8a201e','6229d4056040f8cd88db679843735a400688e5c680cda383ea26a7b249d02ca5','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('capture_final_return_damage_internal()','9913c88a5067a8c1b456b9131f4623257da8f1714a68be08199b3fa51919101d','b220b43c7005fd6c84a555672a0840c518f6eaf6aa6ed19711a5471beaa82c81','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('cheque_assert_customer_payment_role_internal(uuid,text)','620bee9e7887e739990dbed27b13c1faf662adf1751a407042c812f0013dd0d6','894a190c029aea8f1ddd1b24b8eac91f488628acb89115fac68d1bf53f80f4c6','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('cheque_assert_integrity_internal(uuid)','5891729d0eaf6ed789b89d2b6a7dce1d7b646256ba60570d3cd5413c7fb7c0bc','801aa464dc4c7d2114a57281f5c398d66541bf206c13940a34e6aca997c7b1d6','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('cheque_compensate_internal(uuid,integer,text,text,text)','2d17b865553e93749280e7b5f7b20eb0e0e5f8631a5475decebbdcd03b53eb98','d8f77eab566ba2110a01d9fdf088b1dc3b9a18566ed673d9b163a0a5563a23de','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('cheque_customer_claim_lane_internal(uuid)','8a5d441e6e0293da18886dedbadfcfe31fdc9efd5994e313fbc73e919ccbd63b','c9d1714d0c58f8005912698c2c8e87d4c7600d8ff66566c8c571a61169b10c80','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('cheque_customer_claim_positions_internal(uuid)','cb61f21ddc90ccb1389193d8ea14653fe36440fe7bfa298fba4b478e19369613','a0a5f2d04821c03aae5974434a306bc05c7c12cf9a4ea43a14cfccb1aa70d1c6','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('cheque_enqueue_return_internal()','c5fa6458d94ccd9c896534725979259314777dbac168c83744b7579f82f8d443','64588d2ae781a9955ce980afb8d5c50949f58fd368d3b9a2afefe194fb93d9eb','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('cheque_finish_event_internal(uuid,text,text,text,text,jsonb)','9d1e690c9f7f0e09c67708e1aaae5a336d38270f717494cf4beb1db0410d5e6f','9adc964f71902b0c81371da281575715438342d01ea9f4bd9727c9c4fc817149','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('cheque_guard_customer_deletion_internal()','de2ec3f651fc7c0daa590af040690a5c48c5780e18b9f12ceb504faccd58a80b','0360e296eaab201431ccba93ec8ed6e2f3b35db89810e916776101690299bff5','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('cheque_guard_original_voucher_internal()','2bb9debe4cf9725df1ded65320216dce5219d6073380c57505d8294477d9a7a4','092e4d107b576a0e9398092a0d04a10f08fcb2e9928fa393ea49f54037809f89','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('cheque_guard_record_internal()','fc3c2ecc317c32bfe994531d8bc08e81256538107b89ddd5cde56bbf9c4f6070','3db2842b80dd0959387ce02f3f9bd5bc46e2934747b8d3d9171f0a97ff4916ad','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('cheque_guard_supplier_deletion_internal()','3718f95329653ac7332fe6285a65856bdb40f7b0612be19f573d0780cc9f2fc0','ad01266bbe3f6ea042e26ec47ade5252a49b826d58d1214cefcb205c524053f1','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('cheque_guard_supplier_payment_registration_internal()','cf31dd604426269cefacddc1e3ec9e069dd7b3e492d9bb8a5e7554abb806e0fa','60b543969ca0e5c25223ba0ce52961faa9546ec895a31211a6a25ff8a8dc33ed','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('cheque_integrity_issues_internal()','2e5b6fe6d9014ba99f92d12ba36fe97cf8cec0636e52bfc3d7025a788e2de808','e041e51948edf1ef867a42a70c46c6bf303810cd08726daff3c3445b5ac8cf12','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('cheque_order_debt_date_internal(uuid)','5a6e7b8525177d4d85b18f4039519b0c0d74ecebc506f6a6cb100e459b9651a1','e2811147325aef89e85205e819e09672f32eb383077ea72949f0330b8b018d54','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('cheque_pay_supplier_internal(uuid,uuid,jsonb,uuid)','4c64b82c7243e3c4ae9ac29ae915783841c5a198a84fa46dba4ada4e2130d5f0','b7eac5bbad8f2952a6c65cbdd708afe684c6b2f8b24839d6356f822104f17d8e','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('cheque_reject_evidence_mutation_internal()','bfda51e958f4cc8ad291909461c5d5a0103c2c276848bd99d8fbf57a8f4820ea','bfa3b947234f0952800047ee0509644875278c5241fa5a9cfb46fa7f63dc4095','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('cheque_replay_internal(text,jsonb)','69e666bb16cd0a78cfad02b89f7fb4c6dd0aea2d5477f8229f0c596ac52ea1e7','883b6d5b742f096dc1de3fea006260a64e5a649cccc9effb1f520dd0b3f369f8','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('cheque_result_internal(uuid)','0227251179f93d71d29d30a5b60cec84346c1b9484f3fad886dd135e71d89de2','f3d8a9d1ae4a63e76607c462dc047a4fb06f5c08d37a5ad655a23609844e75e0','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('cheque_shift_settlement_section_internal(uuid)','08660bb6aa837fdca043a46953853ef85d76b65a976f12ee9ab1f9234d8c5538','4b53a4e87d8ae356f9f1e9e859ffdeb3e1cd0e8d15e409b75e156068c2ab4d63','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('cheque_supplier_claim_positions_internal(uuid)','ffda1540f6b695a49d62eef018d2124a798b17aa5b654e0a3543c2c3b4558739','1077b6955a9bb9cf477ef3ab376c344cbac13296b9556475a1e707dd11c7ab0f','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('cheque_supplier_plan_internal(uuid,bigint,uuid,uuid,boolean)','ed46a7c6a5bcecb33f5215d57c1eb69e9bfcc275ce5db1cf750b4c90723bba69','017125d33a914106ea8e4165fb16c779c4aec0f68ad62e611b12d8090c6cb0aa','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('cheque_validate_claim_payment_internal()','8ca60b8d825472e6867f9e6fca6663822db7599f4e821a5e76b409e7bf239241','18c424ac2d509030b0caa6985619fb1c50426a270c10909f81071e88aeb13f35','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('cheque_validate_evidence_internal()','7dd1d3ff53205cbaadc5f52128108e3db0c94d48d68630e71793712a7670e1ba','67a2f6a7e1503ed4a63a7a7a52954eab459a360e3e32d2dc3f94afed9cb7d212','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('claim_automation_deliveries(text,integer,integer)','429a8efbffa82bb716d377a35ace9894a337f6577c0f9c2f4cea342800df0e8d','ddb52e3c62346094ecd8027d5c33d2a9fe6f2fc346fc251f6873aee8a5eb3c6a','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,service_role=X/postgres}'),
('claim_owner_telegram_deliveries_v1(uuid)','a7101d81865ef2cf00f2cca21ac479415c76098692868db261ec142e5f54278f','952acd1a52a3306c9148a407f530b8ac24cf43d35fb604dbdc2f5e01c21e1549','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,service_role=X/postgres}'),
('cleanup_guest_order_gateway_requests(integer)','ab78b65ffe97830f9cc34cb50ad3e96fce7062b59d85c2043fcf2904d0c9101d','d39bf5ef43ba98a9d110bf44987fe37c69b55c07ec1519db9d8bb34de564bcd8','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('clear_deferred_cheque_v1(uuid,integer,text)','66eeb5339f84ecdae64e2319d23b0465a13ac72c5cda6528b22e800fb86d17ca','88e7391c1b87162684efea3a3f2a54d2b52cb6973747892cb85c424884ef342e','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('close_cash_shift(uuid,bigint,text)','e803d44c9edc3958b49a346540bbde7cdefb950eb7b70588e4085f20a1c6135a','6fdd336f8d3f01a3afa54c1b1693ebf8c20515e81ca034cb7c066c32e8caf49a','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('collect_customer_balance_v1(uuid,bigint,text,uuid,text,text,text)','7720070e63a90e705fa3b1de25ffd70525b92ff4878378827d55cae222c68af2','55309cbe9479a0dd157d1e5484a153e7d926030995f3bd1884d008517bab0ae0','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('complete_automation_delivery(uuid,text,boolean,text)','ed0ce00f0506ff23d8fe06f273324dd2dcce36d78ceb304d9156250602baaded','02bbaaeff829e1e32765c451a393f7eb62b07774b7909d9991fa814878c5af04','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,service_role=X/postgres}'),
('complete_order(uuid,text)','0f4de4befdd66000a9f4e707fe0cfb1774ea9f6233936fbc9687d5ab8d808d1a','17223141bdceae5aeb0c88459a1cdd2be80032acca484ba4c4e90d54dddbfc93','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('complete_owner_telegram_delivery_v1(uuid,uuid,boolean,text)','31ea7588d48249624e6b722457e3f22934bc1bf645deb68916870f5537e426ec','e67b3f92ec42d97ade09c108efbf41383655e135733c6129bd9370da70cff1f8','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,service_role=X/postgres}'),
('complete_website_order_with_payment(uuid,text,text,text)','090c1b3c519cf7ef1a7348c0426cf74104088982c1188ce977f3d81074bd5567','69d24efd32a5ff0dc474c2c399759d4ec8c7b14806acea011ae062cbfe43f851','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('complete_website_order_with_settlement(uuid,text,bigint,bigint,text,text)','c0055cf0124832a3cd47dc284daeabb7373c0bf76fe47881443b732b15656641','f01a8ade634f22a445b9a0d53e3b0a682f3cc4264fbce8d9a7ad65e391e807bb','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('complete_website_order_with_settlement_v2(uuid,text,text,bigint,bigint,text,text)','3b685835e5b3d0246d18df01d9939c9229d55716737347fdb408fa2f15bff521','5ddf623648b11cce5a4df9bc875f476cacd9b7f6660d58f382d6dfc50cd23a76','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('confirm_order(uuid,text)','1f4fc2ed630888fcb00889c45e1b1acf695d4d3f090933cf31d0efc13206a925','6980ea286ca225bf68cf27868b1011290dc233bcb5742f0c37055729a2a9a4e2','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('correct_product_cost_v1(uuid,numeric,text,text)','fc0be0760b2d032a5b9a212d8005dd47cfda03c085060399e7e851af5fad4d29','d9eb004884fbed0b846eae0caaf20d9e00e2bd647b3f2034e37250c785e3f572','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('correction207_assert_role_internal(text)','804851cb73cd803436f8cbcc2294998680a0c662661f5850044ddd72db230699','3d218f8e15dfc0376c9b0a910a920412c113213953eb8dd41ed52cf7e4d04d72','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('create_customer_order(text,text,text,text,text,text,text,text,text,text,text,double precision,double precision,text,text,text,uuid,uuid,jsonb,bigint,bigint,text,text,text)','ed54104b4e8b5fa8522f829f0bd46faa5c024cef32c00636f713fc95217a0c48','9292d90b2be99e5b05f0aa485072473a238a5893cdda9218fc9463d9187edb56','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('create_customer_order_base_units_legacy(text,text,text,text,text,text,text,text,text,text,text,double precision,double precision,text,text,text,uuid,uuid,jsonb,bigint,bigint,text,text,text)','e178c90fd39f75b2f3e6c3a5e0621006b91815c5669700ff17de7268bec1091b','fd72006f7956f420f37131c59483e04f61cd7685ec7da56c375d9f4caa906e65','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('create_direct_supplier_receipt(uuid,uuid,uuid,text,date,timestamp with time zone,bigint,bigint,bigint,bigint,text,text,text,text,uuid,jsonb)','6be7953dd743ce497c7c48f7df6c91474c8250a49a919d60ed46638fad6d9778','f78c311628e661a5ec0db877ce9a985f28d03d73ed9464d508cc4e8935f489e9','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('create_direct_supplier_receipt_v2(uuid,uuid,uuid,text,date,timestamp with time zone,bigint,bigint,bigint,bigint,text,text,text,text,text,jsonb)','17e5cd89f9b5a6d445ffe9a348a670545aea02a19629890c64064f0216072030','128b79f4e131006e0fd944863b7f253b4b6d23e8e69f27b27c34e3796575c8e4','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('create_erp_staff_account_record(uuid,text,text,text,uuid,text)','489e4f730c15193b92a41fbc170fdd304f5a33aed534b3eeb385829f21977547','8bc4f74d4b6b0b18aea5668434cf5eaddb0c68d0dd1d147efb6cddcc26886e25','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('create_operational_expense(uuid,text,text,bigint,text,text)','03211fe88e3f247d3e58fe254c4647a6f821229d111ed61d091a64bad86b3619','cc95a6db20b05ef5c792ef6ad155d1b496ef48af537e7002d05882135f5bb593','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('create_owner_cash_withdrawal_v1(uuid,bigint,text,text)','c5694a15acdd28f02052b0241c3275533a6aa6b5925f6436dbeb2766d3955dba','821b12ee2c0415fae439d571c68b6215ae82c960f522389761e47e6164ccd401','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('create_pos_sale(uuid,uuid,uuid,text,text,jsonb,bigint,bigint,text)','8e85e6aab8969295da8a2490f88e952638a8733d0a4215ae6689d0a6193dda0c','258d6efff38f948353a83cacce7e9f5b3d397d5fdd4f219196dd84629d252fbc','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('create_pos_sale_base_units_legacy(uuid,uuid,uuid,text,text,jsonb,bigint,bigint,text)','200faf3b56577e33925d1bdcc9de33ca57cf2b5d4d08c499f16e03ad553a1862','644c18e25dbbd7a781b65f5e2ce78c4039cae6fdee9dcd6c1fa591e95d4e0fc5','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('create_pos_sale_v2(uuid,uuid,uuid,text,text,jsonb,bigint,bigint,text)','aa1fdbf165cfeaf9249126f5aa5ec3066ba70b21e19c1d4cf1a4ca3ff865b87b','511563ea06e103cc3c9bfb43f5a4ce492fca3f19ba4209368c676eabab7286fd','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('create_pos_sale_with_initial_payment_v1(uuid,uuid,uuid,text,jsonb,bigint,bigint,text,text,text)','4df3113a7215a765be61855e5235a9e6162d003b440eaf90241078de016959a6','d11b7a020c9fa50640a8db4773fc34305ea61fd41a9f5b2bae689aa9b941edad','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('create_product_family_with_flavors_v1(text,text,text,text,uuid,uuid,uuid,uuid,integer,bigint,uuid,integer,bigint,bigint,integer,integer,uuid,text,jsonb)','3674f6b65dc7c0ba9de06bb10e95346c859a1769fb1a1841cfb8d414f406f5a1','a9f808d725c1d174cd0630c2e498f2878e4ba0110bbf7df0525cc7d1ff39167f','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('create_product_family_with_flavors_v2(text,text,text,text,uuid,uuid,uuid,uuid,integer,bigint,uuid,integer,bigint,bigint,integer,integer,uuid,text,jsonb,boolean)','56d6a42e41f6278ad4f632c2f24903e9969c2e35387e5e521458cf16d5feaaa5','d20d8f3fece3455501892ca84ad3c019ffc9c1f1f5fe6f63817bb8b61703e0bd','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('create_product_flavor_v1(uuid,text,integer,uuid,text,text)','db8574dc5a9866bde05a80003b020fe2c9fe28b0af0e268d86688f260d2612dd','10be05c41d3e1b4b2dbd7117fbd693fd116c14b9bdca56c49d61276c3fdffb22','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('create_product_with_opening_stock(text,text,text,text,uuid,uuid,uuid,uuid,integer,bigint,bigint,bigint,integer,integer,uuid,integer,text)','9ae4b3e0ac8d986e89c51778b7f9147081ebb749552fc22570772ce5070591e3','ba1b5c1db39afaf15291cfb5bff613d8ede66e59e941cef8433ca3aeeb10a83a','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('create_product_with_opening_stock_v2(text,text,text,text,uuid,uuid,uuid,uuid,integer,bigint,bigint,bigint,bigint,integer,integer,uuid,integer,text)','9db016873553b84912af5f82380391fd814171304018a52742cf77885271fb78','972df275d808749e4dac2dcd49f023c703c32aff16d653ef7ca87c9953ee36ca','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('create_product_with_opening_stock_v3(text,text,text,text,uuid,uuid,uuid,uuid,integer,bigint,bigint,bigint,bigint,integer,integer,uuid,integer,text,text)','50559743f9c40b9d3f82801755fe1484e4890e2802fad0b16f0b605fed721d7b','8f1aff0f496a0c6dac317282a3b3402bbdbc97638a4a8dd8085f48c43a8530bd','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('create_product_with_opening_stock_v4(text,text,text,text,uuid,uuid,uuid,uuid,integer,bigint,uuid,integer,bigint,bigint,integer,integer,uuid,integer,text,text)','40113e26b6b6ab69906e073f22d30b8d769e1f37176899ce483a747bd4ab6aed','86134803c84273e2787d6d275651437ce4e021001d5c703c4cd0a1c5708b99b9','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('create_product_with_opening_stock_v5(text,text,text,text,uuid,uuid,uuid,uuid,integer,bigint,uuid,integer,bigint,bigint,integer,integer,uuid,integer,text,text,boolean)','2fde91f85bd80c5f8bb34daef9c4a360f5be5d11db972c526304d46c8aa279ad','933318708ff5ee2203c028ae447d98239f529eea4f152fc9af77190e9237841d','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('create_purchase_order(uuid,uuid,uuid,timestamp with time zone,bigint,bigint,text,text,text,jsonb)','d3a7c284509bfe448dd3904c5f94084a54ee94780694ea65536cfd563c1d3f7c','a978a8c027c5ab936ad5adedc6a2885379adb10d9f996d8610fd83ea808c1e4b','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('create_purchase_order_v2(uuid,uuid,uuid,timestamp with time zone,bigint,bigint,text,text,text,jsonb)','aad3b4d97ad69baf028889c64dcf03fc6328668dbb7943edaf2f53d5d7ebfeb7','e08302823227b99736e4578955d270f47fc69095973d6d04a0eef58cb05da57b','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('delete_draft_purchase_order(uuid)','8a9ab033f8b0eec8f986313e272cb391daf52c785a133d88bb32e9e1d54ba81a','155b24ee886040a6fb44ad96f3e3b88c40b6e07cba19a29d3bb64a452d87d974','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('disable_push_subscription(text)','b904e40c5181f071cc6b9ea77dbf7201de1f6ee3023065aefeb9f2e86c6e4bf9','59a24129a56a9a4befd6c1cef8293dec658471383f1489255e92b65543829c9f','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('endorse_customer_cheque_v1(uuid,uuid,integer,text)','6684f15d76c99d01dfa75b199bfeb66ebda564b9d47095ea35d46e0865a0fd6f','b213e0484db62950736fb436d918377ffb51636f81c5cdb333fcad83fb19cf41','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('enforce_customer_for_debt_order()','efb66934ec56692d4ee7019b5299d3d0509c26d04c2bbcfcfad2dd4b6aa9820b','5176ae14a35d13d044dbac7a30d39ade1bf1fbd885d9e02c81429e8d9add54d4','postgres','["search_path=public, pg_temp"]'::jsonb,NULL),
('enforce_order_collection_before_completion()','d6bce8b63eb6f4c04fbc009d4d8d15e29af61744295e99bb6fb44de630fe7e5a','1d7dff181e3a406d899ef4520482dabc1f84efceb0d79454f3d27e4641c33da9','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('enforce_product_flavor_inheritance()','c1cf48afcb612f83085a6671311135eb21b9bf24b30bf130034daa762becfcf2','4b3af27f5e2482aa4e740a9dfc968e2c900bea3641ab98e0ff62d4a550ef7bf7','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('enforce_product_identifier_integrity()','d1da3a572b830bd193f77a63fd0fdc91c0e3940f75dedc83b6bc8b7370dea71a','6bc5006129e667ae58de9d2824a7e3df489b4b3e8391ef06cc914a735d4cefc1','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('enqueue_automation_event(text,text,uuid,jsonb)','0ee0f8c615d26f19940154163a0a06859522806b9fe95f2f24b0b3fcf4560113','b65bb88f6d673c87dbdf1366b6b698ccee47d920f39bc18a82f82a19d1dc8f7c','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('enqueue_business_summary(text,date,date,timestamp with time zone,timestamp with time zone)','dccdef51722523267cbf2589210d2c2a8a029eccde893f7374e24137c2d5f15e','90439d360ec768defb508292779461fc698c26e5be4c35f1376527a8e06e422d','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,service_role=X/postgres}'),
('enqueue_closed_shift_automation_event()','1dbec25622223b3a8339c17cca18d04dd11ded4635d128894e3277ecf91548f1','de03ae0645079ea4905b1f870b3403a7988f2668bcf190a3077d468c28c87127','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('enqueue_expired_order_business_alert()','8fcaad7aa09310cb1fe193cda3aec0680e660667610dd9f9df263fa1e9c1051e','4e2b8c0cd6af0fa47366732668c18d1067ed41924ab27f3922dff70c1b404f10','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('enqueue_order_automation_event()','0158bc289ccbe9462a2cb91042e82395f0c7aac07431e2360d31094b0c47276c','32eeb6f9dffbcd3e87daed690d36fc6fd00767c57aec54bc7cf6ac20c7a32bce','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('enqueue_order_push_webhook(jsonb)','0ff94dab65738e4a7ebb0940a1ab8217f64217d1b1834eb93d746fa1c3d4372d','7295cf440d134749d8f58a3bdce5dff704e70f932921ce7a1002fe462a6f4f28','postgres','["search_path=public, vault, net, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('enqueue_owner_telegram_dispatch_v1()','9b71859a5ca00c1291fdf2f712eed2945fffac4a2e0908e63e0c25ab0ee5683c','47b434148d93471976397cf301ea0820d65b4e62a67cf7a04aad0de2dae85689','postgres','["search_path=public, vault, net, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('enqueue_stock_automation_event()','d473154c9b3258b16f2907b0bf0ebba42144ebc8f3083a04e6186aa0bcb3b811','3fc0b3105e6734bf57b8b3d90bf527e2217e78ea7eeef94b45489f2006e64e21','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('execute_aftercare_supplier_v1(text,text,jsonb)','d781efdc4dd15e1e6aebcfd35b90735d07e4a9330966c873d60e831a33857c48','33b93f26cc12a9ffdc883b35343fe4d382a1c92c6b885c8ec9717876e2e07e52','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('execute_document_correction_once(text,uuid,text,text,text)','76ee5d4db1396d8ee62dba06079a81c2a88039797bb2b8fb90a020b7f7c1f7f7','5cf2cca3bafc4699840356ffd49fcfa3865e11a5385cec73c6baa47e97dd8cb6','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('execute_supplier_replacement_v1(text,jsonb,text)','23df05cc21cf3c2b169c810be8aba554904e003bd5807ea86d9265d07b623668','66441d4e92ef25c42c75261e8e557a6b5fae85d773a49d372552a32a739d1278','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('expire_stale_new_website_orders(integer)','d79b831289411bfd62b2cb06e6f186e4df3a1f1810ba0f8c54e31a7c97e378f3','162604618e5bd3653fd176b81e675fb38ae44a48cd5da1147fc90bb93790a96a','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('extract_google_maps_coordinates(text)','d47250a41818ff218ba4942be7a729ea1169df60c109b25ea05ff20dda6a5b07','e3d50efb9b39e920482ebe87c8a17f3f057a48e7a56cedbb184e6e9c982811fe','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('finalize_guest_order_gateway(uuid,text,uuid)','9f5a380643b0f0ae4577acea89b456477a392735c0b59d852d6c1ee9629a78f4','81e0b51b3bf3a035d16a8f558e81ae78988a6ecd7b313a3390f8a2aef27e3c5f','postgres','["search_path=public, pg_temp","lock_timeout=3s","statement_timeout=5s"]'::jsonb,'{postgres=X/postgres,service_role=X/postgres}'),
('finalize_order_parcel_instance_internal(uuid)','0a7b363ec702be6af76758f4cf923d62bec6671985847b1c5abc1dd9a8cafb62','31d47995faf46d673f69f8461d422348e5eb7197b32cb602d6f57661f32c1dcf','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('finish_go_live_setup_v1(text)','8511f969e0d5fdc77123998be492d8b257e52b886e4c50fa6c700ec3b6f3bec0','67503b498fffe99a73b59a6f973a83990fd8c5558a123d0e6fecf9aa14127416','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_active_order_push_targets(uuid)','82a0f17d368b50c0036632d4de1ad76da094f3e28926b668313a993697d016d1','be17a732a19590334ef4e9e8631b38efd35b83852aa56fcff4fcfdece0fd2678','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,service_role=X/postgres}'),
('get_admin_ai_inventory_snapshot()','d906ae08f3341dabb097b0321583472bd7146a3631e3e568e6efda0bee51cc95','9b9ed1858e6ba88eb3813311a44c2cb014be76dee16d698e63b25af4d1c4aa68','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_admin_ai_monthly_report()','e10b194eadb088eba19e24e80ddc62311eb3beff022dc5f1767e54cc5dd9e76a','d467f1b2e662a63888b84dc4e38f76aac73ea888efe73a62c36eddab68aaa873','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_admin_inventory_product_page(integer,integer,text,uuid,uuid,uuid,text)','4c986358f2acd675c3258eff26eb8838165a5b2112020257eaac0c37efbc8486','dec13c8dc955b726ebfb57ad6c5a32da03b9f053bba6a5d26d1272c117093bf3','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_admin_parcel_configuration_context_v1()','8e8b328921226fb43b96784650d7b272f21ec45401201a43cf3fb38c50241b7a','c6096e521c8ac839d25b29b8d751124cd49ef43b1a42c8e4cf8e526eb67284f1','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_admin_product_listing()','104920ad1c58b94e743933e2552ca1293ffdab0e64a08a093fd39662c57a0c12','fc5c671b750569b5b293865f3ac3036fca5697cbc291fdfa87ea0d6420b0b7f4','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_admin_product_page(integer,integer,text,uuid,text,text)','ef789f140370eb6bf8aa2eaa3590ef2ba73e4392eaab6690a9a6c439f2fe48d3','04be6776732872c9003c235248e6ba032c5f7e904def58a6c0d050c82c51e3c0','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_admin_sales_aftercare_context_v1(uuid)','fb3a2edd20ccde8d81c317b8fd29105763202eddfadd558df4cdb4772c8c63af','fd049ff36c12b7de0e43419e55bd15519bd7fdb9b810204b9948da09be59304d','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_advanced_monitoring_dashboard()','255d31ac519109c9b5fcc8caef19e71f90621b706a0005a1df43218312796803','e4211a5af4a06a29eb0e0ffb5dffa919be803ac5ca7b69d23b3d82e41f03ea68','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_advanced_monitoring_status()','b79f4eb619e662ea2a7fa1d0c4a0153ee1551feb7768676b4687edfc7cd9ae0c','829bbf4556fbc48437a970e3253eb64a1f016bf199288c292429b4b8dae66fbd','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,service_role=X/postgres}'),
('get_aftercare_damage_candidates_v1(uuid)','4e16c18b08d17fbe4ca60cc5bab94cfe140b782c0d71b8b6a86969fe346f4ac0','6108c7ff0b86d088504bcb3ca831cd3841081a071e5e7c47a1566d747775f0fb','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_aftercare_integrity_status()','7e62c6057832646edc77fcf20ec2874ca956daad3f3c13c0ef51fb6fa816be16','638bc1a5a0e6e9c0cde1acb0650ac0b88c9f99c85f9c5833353f56052eacac07','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_business_summary_monitoring_status()','90cab0a21ff5e32da239bead44d5d00e24a37d23998801736a16df0201c531f9','5f68a477d8634488b07ebde20aab131e6b8f1d3902f83bbc7c4e96c0c248b055','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,service_role=X/postgres}'),
('get_cash_shift_archive_page(uuid,uuid,text,text,date,date,integer,integer)','b4cb0363ecf1cd74542b7a11b93d5412917b96dd515709f7c2879752e1b7f2a5','8ed6ec2d714d5e22a30df369c13cbb816b8870bd7b9df97ffc5d46dcae36ccba','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_cash_shift_closing_report(uuid)','ed000ccacb39d30705b3d3cc11dec4a500628b06cd3446879241a7eda080eba9','d493b7f5708db0a620701c303275cc97aacac7d7f79fbf7a2c3dc5e546eaaf25','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_cash_shift_display_summary(uuid)','d5f4ad55b7868370e65a51357a748026d10c292b2907220c81e6b4d86ca62883','066920a048f78f5b03949927e036389e91b6ff6ae5d3adfbb126cabbce584861','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_cash_shift_movement_page(uuid,text,text,integer,integer)','3a07f72c92f7c0d7fb9445b054de18ac58839c95e8eadc6802b6fc205e80d7b8','39840b182936c7e52aab8ddb86247332aa3d9d46ecf38d5e7f00af93a253080e','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_cash_shift_summary(uuid)','6395b279984fb6e4f9c313bd1daec552ee98015f66b65318bfe312fba12b4f1c','052473f2269219ec4f4cf89b5ac5f634411ea453f7216c4a13259ab8024d619a','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_configurable_parcel_feature_state()','340b9b3656b0816610803191615b1837db55169627f9579b0df24fd7195f7028','c98a0bb4492f02e831e97f04f48fcd46726cffe692884c0704dea42b35328397','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}'),
('get_crm_customer_detail_page(uuid,integer,integer)','744958069f906d22c392f727ce3e5098b48b3f63b39274de584c6efb109ad8cc','2324199e773e7d7708577f3eb5651831cbf6fd57cc88f00ee122cec5759a7c26','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_crm_customer_page(integer,integer,text,text,text)','7eccf3589f325dcd68404f09b397b8e1333071fb05e867d4814474da528c3a9b','caec4d415afe22937aafd824b8d69fe2e42c0c83b49ca302800a985f4255247f','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_customer_collections_v1(uuid)','f142d74fdacdcbe1ebb87b57b2e6a0190fbe171c98cd29bfb6756e667264d6c5','0b8e6c4178f7e3fefca472f2fbde9f617f7d072a89e3b94a8c8277ff486f9358','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_customer_debt_aging(uuid)','0b162c89095dcbae07f4d6dc11c70819d823eec0ca885408b67a1761ec27fc78','ea56d2a76e531344322171a7f78040c97978f63fda441b36d0dbe15813426210','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_customer_outstanding_orders_page(integer,integer,text)','0e5d7d2ff210a6015e2bbb991bb8d7af659a4114eeb487588108b3d07e43b3d0','2e9dc1e4b06ddc6870a19bafdcca1e35bc1b9982b1eb5fae05df03f332a141a3','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_customer_statement(uuid,integer,integer)','bfc3eb2f7d11c2bc6407f6e6950cb573c4e91f1e8cdb8b933264a37be786f13c','81579ae77067295abf5a4305febdbf0c0d1cbaf8164cd0c9dc17b21c6c651822','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_damage_history_page_v1(text,date,date,text,integer,integer)','d97dd5222cc0784a5ed91cd777a56bea7498891a747f449125c3861981f6439f','234b5efc29e21706cd3e54375d96e901b46f7c9ce2427b44fa2ff4531281ca57','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_damage_ledger_page_v2(timestamp with time zone,timestamp with time zone,text,text,text,uuid,integer,integer)','a21176401ea66160d734879d543dc59df26b541475b4dcf99330a625dafeff03','409f7a3ca8ec0c1288ce5423b72afcd5913ca7b928178f790160d09a9cc248ca','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_dashboard_analytics()','e45ffd96638ea7a2f9dc5cfda60f8683e245223d6ef8542bc887603977f72064','197c2c6815fd166f1fd715477ae21e08f69a6a7e30ad496c085d2c986fc4bdaa','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_deferred_cheque_detail(uuid)','9d198aa544f8defb8eb7b49d71053403748eac0e65ec643e23d19ab884de5db5','72da409454a1246f2e4d6524709245014c323586b7a425ac711128e525df3dd1','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_deferred_cheque_home_alerts(uuid)','d1a8024ef9ef61d0b3741350036553b15f1ad46f224c24fe541c9fad68169eaa','1290b9a542daa30b5309e616bf74863249c15d1643cd8a098947fc49c8fcf7ec','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_deferred_cheques_page(integer,integer,text,text,uuid,text)','1f896ed07bbf15bd9664c563941e826e5a8a3c7fd4a01d624c7ca85504039829','f54a187201cb018a93e151cf5d415647335b39307be50cbd51fce6d615fd8068','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_document_correction_preview(text,uuid)','5079402047e4fb79cad900c5c95e4090cba269558a72086c208993880caa04f0','4f97037406386e2fb54b8046bbea3e5f2b81f0c8a7f87b4ed32887c11c29bd70','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_erp_staff_account_audit_logs(integer)','8eb6f91a10f0c8f4a768095183a3b7f7314b3c552e47f376a9c7f417898afaf0','c99faa610c122eb0572ecbd6ce10c914c69640227b8e8b5668c24602e4049fe8','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_erp_staff_accounts()','b02e6bd7f44bac327a1d8bbcddb93cf763c82fc8b2a1afafd09362233490d95f','aae830fd53eeff921cbb47df0ed8639bdee3c96452d36c1d6e2ae0b543dea675','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_expense_shift_center(uuid,integer)','02946f412bc886021ae8f339e9e293da1f2f1c74bf477b02caa12ee708f4e58c','7fd8a04de3b88a37c47e83ac376f36f8a335fabadb1d9f3118efcea24bbf72f0','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_go_live_cheques_v1(integer,integer)','aaf94abe45c21407d60b75b7a5b4842c1ba7c0efd37917d00e25debc46bfe6d8','e035aae356a228021a862981abf4fc5ce9af25105b589851c92342ab7c2de832','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_go_live_customer_openings_v1(integer,integer)','46f85abb39b8eb41ba66b4a5816c21527bc55e6308e3511d643187c4261beafd','501c17ef531ddc063952716a405d645c556a442d703d09d5773a5e519131f147','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_go_live_setup_status_v1()','7fb099790fd720f2e3146dc69fd8d23d4a2bcced7056c689608427fa9b41183c','5938dd08e73835203a013d0d8d66b71e4631a2073ad9ef59142f112a1d707f38','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_go_live_supplier_openings_v1(integer,integer)','c340fb490734a86a95e79b88790df680187b564406bb5d1c298ab8d13ee7d968','c740fd5af4b8d7cbdcbae7a73f78cc062832cfcd9ffa15051f38fbc12e359609','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_home_dashboard()','028dfa13730bca8226750e408080fc5b6ae5d8aa33c128aebc758d86a48acbbd','da714580fa7eabb2d8bb59cc6d22ba0d65c9e05cdbf0bb18cd88b47c1866efa0','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_inventory_movement_page(integer,integer,text,uuid,uuid,uuid)','595083f9e21fdebd2fe08d576f68b58745e01dc97ef0490795dda6034aec0a7d','fe21dc974371568a588802873f943af2a8701eb053399723cc0807e31b885028','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_inventory_opening_setup(uuid)','c3151aa0ae2b2be5e017e7ce75c33444f90017cd13549c380b7a78d7bc6e267c','a56eda00424cfefa637bbb377b1427bdb56d18d389d7162cea9b10cc5381bd7d','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_open_pos_shift(uuid)','550a07a7d442bc8fb9b94a6c680d12a5edfa82d0a1cc7902510d2048593189ea','44006c0b6372c20f2df091ea584b7fc55bc9f3e92ca801a44360259be8f86481','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_operational_business_report(uuid,date,date)','969d1085d3a30f92ea051d5ad4483381479dc7ad15c17b35a595b383d5afee83','59e9a6ed7411ab3574a61eb1b5fce23b57320d5cded6e433bc9e910ea552a99c','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_operational_orders_page(integer,integer,text,text,text)','177ae4d038647fd9c5323358f03b5f9855e5de54279a47d460d36eea275e1e62','7d55154212daf23bcaa6ea1e7a30d3431ca990597fc8f89c6e57d7df658c8d4f','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_or_create_pos_receipt_token(uuid)','3e65df4fc1f0a0a02bdda0f6d840bcf43576a913eabcdd24ed4d31f0b4f6b8ca','35494c132630126d3473c53e79fcbd36ca2deced38868f1e4a30379acbdfe856','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_order_exchange_details_v1(uuid)','f5aaec3142acf08ead3f2e83829d1e450c236cbaa7376e9214abd5190e687157','ef8bcbb67fb52d173474be47df85f73c9bd7d0198bae582b05d72583cb9b112e','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_owner_warehouses_v1()','963a061f99b523844fe626c8ebf0f130ca4e41d7e3e3f8bd839afeef6beb2f60','8518e344eae4500f108c12b169ff06a2c0cbda4445183239d7ba5023e8405eb3','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_owner_withdrawals_report(uuid,date,date,integer,integer)','3efd82e9f25f20c7e4a60146df06797c44715130ef73f93bc5e5030691a99223','311c665812100c5d409f1afe65e30c54b1b90a1d9180e4aee7053756bfcd2d85','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_pos_configurable_parcel_options_v1(uuid)','97709600edbe179f31db4136ee4f8662ceed8512e91c95ca5cbf4e8cf7607b0d','e1f3ea6510a22b4091d47638da7c3ebe4980ff940cb605bf500bbf52978d2d69','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_pos_customer_page(integer,integer,text)','e2217b244a337efc5664841996076da7dbf5454338b2f7313f25c0ffe6b7eb05','2f06ade81a6c908ca3e9581de3eb7b6aece86bc83684b39a82558a33c349212c','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_pos_sale_attempt_state_v1(text,text)','51e25cffbc9093664aee3785c652b7385b172525599e3f7828d12bb786a6427b','6a0b6e3e48d989a6b416e7e167229146469614fa5671e5fea8dc08a3c58da7b4','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_product_cost_state_v1(uuid)','1a22d7ca8f871eb7851c804169a50b36caf581195d110b5733d7d3ab4e29e5b2','40f6b84cde4b40d02e032a20d09b76a49f7c35597a12cd3ba8378964afffeed6','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_promotion_codes()','e76ac0b1b56e3a7482eda05aa0f23a17b093a8f2afa986a70da38f6adfaac27d','7f58d6e7fa5c23b9a2460c01072f08931185e10217459416dbeec72ee7fcbad7','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_public_configurable_parcel_options(uuid[])','e47829687b94104fea2c62a523d1fd221b423f062ba40fa0ed7dac67d939e819','e85d2d94a797ba40ea17be51d632a53cc5366ba34ad2edc651c9e66f58ab6e31','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres}'),
('get_public_pos_receipt(uuid)','6c114d12ec0209b69ddcac0cbea0ec332af630b2c00506372808045308f04f57','7015e2427de9e735904a8ed2e9959cde0a9d1eb49a2840df1c2ed79b3e12e400','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres}'),
('get_public_product_catalog(integer,integer,uuid,text)','a78485af86e18c86030145a8565ac310740d71fbd483d31bb84b22529e66c1b3','42546354c4245884571fe6841ae7d53b24da78b13993cace61e1784333edec79','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres}'),
('get_public_storefront_catalog(integer,integer,uuid,text)','44fe0afbba58fc6bbade37bdbf41f339da8d6262f27baf6c36e9159ef684be66','5298c4ec55201d779e6b1cd02a2e9466637befb8929d9b468dfe31620ba9a438','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres}'),
('get_public_storefront_catalog_page(integer,integer,uuid,text,text,text,uuid,uuid,uuid[])','7f73f34988f04ce1e07341b9678a9fc824ddfdc72e1eba2c258bd030dca05f03','3a9bc1a125bd69e6d82eefabd9299ee734e2d0c896fe698f15f98688abea021e','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres}'),
('get_public_storefront_merchandising()','e892a886fff75a3f5174bf3b0fc6d3d7a1277cc5bb7d0b3f85e1b460cfa5b8a3','0b9483dfb0387fd92559221ed69d0e6d37ca216a04b437408b38268a045f6e9d','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres}'),
('get_public_storefront_offers()','c4166a0fbff0f2697685c615aa697a88dbcfd441140930eef5ab19e1eea5d789','5749e4afb9aa256fc7998114339dc1ebd7c8a76b8001d2bc2eb45c3af64a9cca','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres}'),
('get_public_storefront_settings()','84c35517479ae65ecc08fa44f93dedc45768dbf152b4f346fd8c579ba65c5eb3','f3fefda77a2cfbae90f5d81d6f85390fea5f1b87580f7799b72cac45cb54f06e','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres}'),
('get_purchase_orders_page(integer,integer,text,text,uuid,uuid,text)','e1c01f6431e0d897a37d061f0ec3a3d2b0bb71ac41fa02a0675c73ce8b47930e','ead8f2bb802f0c1cb92de1655521b1895d1cbb447c4392d005f60b008eddb54d','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_push_subscription_status()','0e70a6567444d0af06ffa0536aa533cc019fba80714db7555a75d62c4d648c61','0fd5bc2e5fd9918871329a04edcf146af54e4e5fb796a7cdf8bee4d54dd7df90','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_push_webhook_secret()','7087296ea4f9fdb9b267a2eb8a8aca4825a3db484c278c576e51422d2f68ebc1','d15e913613a6c7a88b0b2df8b08920b6ea7b0e6f6d5e9ff61ca2db2b7eeba200','postgres','["search_path=public, vault, pg_temp"]'::jsonb,'{postgres=X/postgres,service_role=X/postgres}'),
('get_receiving_purchase_context(uuid[])','55f9972a833739d0be0e1dde41bb724c91a25be7c83f0d2d4e49f6151d019490','caa4b8e9c4c2ce3b52abb16cacc97ec8cf6069559d17bbf6f6b2c8856fff1d7d','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_sales_history_page(integer,integer,text,date,date,text,text,text,text,boolean)','8675f562d60c019cb40b3d44cb4aab33f1563ba5222739da0a66473b3b3807cf','1d5c7564de6073fe999e3c01aef31bd88c05c4650254a32bcc49ebe97065232a','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_shift_owner_withdrawals_v1(uuid)','494e38199b35562bd9522aabb154264bd3f8923f41c92826d5f84de938aa4e01','8ef7d3e75d7c6e0ef7b1ffe363b2fa328cefde3c474042c1c73ed558762a9496','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_stock_alert_notifications(boolean,integer)','20718863bb30caa71186a9361cee9684782dddd49f72aa0b4f14b29b70bb0b7d','beab50bbb37071f476018c779b887e5f81a823a84763abf9e3c9bf3dc75698a2','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_supplier_opening_payable_v1(uuid)','80770a5d3af7353045356814f924a4c62f751dd1c1dd3a7db4c0d7154d5ca9d6','d2781290b38dc891ff74dca3f94d5f1a02e7779a6c6f3ea6e3d0064d3786e3bc','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_supplier_payments_page(integer,integer,text,uuid,text)','a8c5209551c7b6b7022d6e9b447df08fb5dd566dec9e15edf3a58e06f02cad0c','4ef3fdfb5d7478d1e4dafb2e6e68e7793cbf794e6d1cb2899e26a146bbbce523','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_supplier_receipt_display_context(uuid)','d36ed27cc9e355652a97a8506fe0c4b2d0598f80365fd6802e23b03a5b16f3d3','b6bbe8f689e4b07d02c44052e2339f2cb7dfdce7c42f7d3dfd9d1c6e266a6f28','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_supplier_receipts_page(integer,integer,text,uuid,uuid,text,boolean)','4ebcf600303b0a8efe2984241ba471730e5be997dcba4d5dc70c56612664cda4','97c768b10c47bb9c702184e8617eee9f249c953728b12aa10e7df98e158c7d46','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_supplier_replacement_credits_v1(uuid,integer,integer)','ba1cd5419812a8883206c396a805dec7c1704201a3c60fbe89605dd61ec54e15','7c1d424eda1409c23f0511320621bf210458e5fa466312b50ef9cac6c2e1c34f','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_supplier_replacement_options_v1(text,text,text,uuid)','f858db16a0cecb15856f16392fb2a5c418f6cef91815acb742ec6696b38c6870','d3b5c4778fcd6f3fb5709b847befb948688d6b4ffc8251924775649733eae74c','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('get_supplier_replacements_page_v1(uuid,uuid,text,integer,integer)','dbeec99e1339422cf59dafcdfb48a33432403ef1387ba5a8aedb5cd45f556e31','ccf87375aa4fd11f0c7105a6af88b81a563137949df0fda3a2e47d2053d59173','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('go_live_assert_setup_open_internal()','cd5378dae6688fd51ae69352e9bfde45ec7a860b52f88fa7bcae70dac785fcac','9ce2c7678b2d18236e5d11bc0ee5bed9c763277f350cb5f21fea6b87649fecdc','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('go_live_begin_batch_internal(text,text,jsonb)','eb8ea2e145f4a64d77e8a76396ebecad0e5d80c8fe3608290aec9b56f50b4807','8b2290afff1c1e3247acb1fcef8747173a3f9ce7e7f5046b63126b446b5d3d18','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('go_live_cheque_party_internal(text,text,text,text)','3a1ed9c91fca68cccd79932dffc5c03dab000eb0ebd0746c954b18b25265d0da','9f813de08da016032cf82d756393ef200b0d894e30fadd9898ff16b6121f0fae','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('go_live_cheque_rows_internal(jsonb)','3a63ae16cb739b0acde4f9da14e875139c0f977e0c4531b47e3df89621b545f9','25a201a64e876c09a9bb8e6ede1f88de5f478c99a9ed3d9d6aa874a40d0978aa','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('go_live_collection_result_internal(uuid)','aba95fa8d0f07c09bb5edb2cff593cde8a1005edf91c2654fa9f19c4e4a0aa95','8e4af422a48ef5a35389644c5f09a82d4ca563ec6950438e685f5fb3554660aa','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('go_live_customer_opening_positions_internal(uuid)','d4a5705da05394d4beef776e860a8dc35e289e38d1aee960cbb979e89adf0925','c709d16d9a655e4bf105f51623ad3841682d897613d4f72205acaae8be90cdb4','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('go_live_guard_collection_operation()','6a8b0fe16b05027141e8d17bd1710341c567e9d5921e6ff41bce4add47d5003a','e9323c336aec54520adf1a8ab480918e5477d8308b6718c386052d103d249dbf','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('go_live_guard_collection_payment_reversal()','55abb7420f98fd5aef3de5602e1678820174b54169bfae4c5773470fdf1af203','84b31fb73c134ac1196bd3dbdfa8a893d0d42db0cfd9724fdead3c3ad4eb6814','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('go_live_guard_customer_opening_balance()','a63ddbf841c1b9b15b672fa2c5f853b027214ccb41b6bc7b86b9df9364bb7358','c3461c699c5903639fd3f0a0dfcf4e9cd488451d87eaddefffe77c8f6f331435','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('go_live_guard_opening_cheque_internal()','dc7de6f3d9ab75890d3c1d515966cbfa360f284e55aed16fe64e0189caa22cd2','5e39676462c8bbaaaf605a710976c6a852a99b082525118d73b9e47c10ddf0e8','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('go_live_guard_setup_state()','3f6b624411f998f370d6b91df49f47d48c8afd914e6c4f1488f2264b5cb79b90','f554878da8d3b9d32644ca655ed726ebbf86ab415db4e193aec37f796bc99649','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('go_live_guard_supplier_opening_balance()','e88939ecaf0de0561160305c04699c2dbda70cd9aa9782244ae8ceca55ea5c63','720bcb6d5d18236f420afb7a5ce3373ccb44cdbc7cc413207082b66d8822abd2','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('go_live_main_branch_internal()','96f104f866537c41e169d2b4550417e8ce530062ab887effe0669e8cd0bd0403','2037816407c6bf1f58716cfb0bef0ad0d8e317b50cb94d962412cb0e6a1eee16','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('go_live_normalize_name_internal(text)','899da6faca51026a487c1178acc4a74991605edfcadcb15fa02f1cb168c44c17','4fe5f669f485ff64353f05dc7237cb4e5ee6e0800f1cb699035c702dc15edd0d','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('go_live_plan_customer_collection_internal(uuid,bigint)','2cc3123507d2b6764cf20f12966364e24fe2d2432d8cdf6169d394568c39c159','baa7c075a2effa0428d387d670c9c50da35ce19cfb620c4292bfc60ad8488b90','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('go_live_reject_batch_mutation()','9b874ae52ac567717da268a35851d96acf201be3c9d9a958e6f13e1f7b336867','45d33d6418c2fd7cbf9f888b1135434f0e5768dd154c02d89d6d6c20bec53312','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('go_live_reject_collection_mutation()','3898cb1863dc49c2e2443a7f928f9dd4bbf63b8d6a5e57a282baa56d5d6dba6e','de44c39ab279f6c78dbb3e22d726d51af93217d80f01799a2cbf4172f671d083','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('go_live_reject_opening_write_after_finish()','1e61e011443aac6ffaf45a0440dd680edbbfca93d220e557de351cd03910366a','5741b55e385d580b9e5474391327ab704bd2837baaf71115c12f5a7a335d8b78','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('go_live_reject_truncate()','6ad69020fa74263427645147ce9825243a30064812830a9d7b44ba5184e5b2b5','74588c464c10095e048ae179d0a7f63ccfc44822158a5ffe2d6209bb08ecce68','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('go_live_resolve_unit_internal(text)','5cf6dc6614e2936dfe5c236d3a18b4abd1a4af50f72735e187f086a0c2ee50d2','90893d1845b0ff81aaa53b325077822f3226bc7a9f84f78b08c794b072df7214','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('go_live_seed_exact_wac_from_opening()','262817d52979eb6f1ac298b7cfb89f3a8a1f6c15bd8425df4167cd50ea464579','e96561a0651b8330ce15efcb9b0b84d1d97420f5d406f4ce1ad20e493db09e84','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('go_live_setup_counts_internal()','b6cdb05cc723d733fcabe2b2664d5031b1bcd9b50880672cd4a01c9b27b17437','dec09f64488e0bcbe940663943f47e2bdb2520c60b67b70b9224595aed4c10ec','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('go_live_supplier_opening_payable_internal(uuid)','d217900ade48057b77d399f1c81315af94da8ccb2b8e28735322b6e287939b42','198df55fae3e458c582d73be31909c795cf88850234756ded970dacdd52974c1','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('guard_cash_shift_closing_report_snapshot()','a62c1dbcc0a72cbedc7742c9cd8fb494c41abde77d867ee0c522aa0e71df8690','1cd26c6fc2eb98d8953cd648a6179ce7a5b91aa62f0a1d7a71255c4b275862cc','postgres','["search_path=public, pg_temp"]'::jsonb,NULL),
('guard_finalized_order_parcel_item_history()','c880968264acee98e32d98e6246631fc42ec341764acd1ee5f7cff80ec40c0fc','961f09c377bbc68c951c0829fcbf6058c2f0b6be33fbdb7a41408a98e7d6302a','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('guard_immutable_parcel_foundation_row()','7d050b04fbade8be1ecdef969612f30a416e4d2eb2d94a1b112f3b43d79c8423','ce2c2cb372c9d7988c5b8c2fee5682262811c8bc2f7866a1cefcbd186f09a3ec','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('guard_new_configurable_parcel_row()','4b1dd677cfa24e954448b73461d442fb260bd30c3b452617f1435b5cfbb10fd0','8b253e069498b12bfbc43f5a3349a73a4a5fd962a00c46a1d70cbe49d8d1b5bf','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('guard_order_inventory_reservation_history()','0b876595eef9cb87119d8c4a46211e62f4075e863e725946d1e69547f2b4726d','8797676b261c46d8d6b4b3cac753e2de88ad9a334db3c60575fbeebf306e3bf8','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('guard_order_parcel_component_history()','7b6786dadd675bccdd5b40dadf719a79ff7661241cfacbd68bf610710332c1f3','b32d9f1ab71ebcf5a42beafc8d0c272bb4c5a4f8aa5b6266881c1a775f8646b5','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('guard_order_parcel_instance_history()','09114813c4b38f5bb292e3b34fb30e8b5c74508458b20b0dde71b9a3f3484942','116d326de3f716a9a3037208ba9d4b919332a2243b92131ac7d8b0dea8025080','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('guard_paid_order_customer_payment_reversal()','76ec08429db478af4f47d43525020a0604b419d4d136490bc5ea126cea2bcc30','fbf273e0f51fbb485d722d891141b19916eec77731a99d9bab3dec03ffe6f75b','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('guard_phase2_detail_history()','18babfb38027f57cb3c6e14d9f41a4388b965aeec3e886e89c659da5db577c5b','3bc875a9900fcd35f0f1640cf6039499400da69a1f8d29a51e09ae5e2c24f6be','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('guard_phase2_receipt_header_history()','f60c5b7b4671e386970a08fbe4dc709ae1635c5304589d615d286aa7454a6740','3d6a72d976c589256964bca718cdd4fd7cb3386bc94a8eac15b367d2ae1c3a71','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('guard_phase3_customer_order_cost_finalization()','a812d7f743cc460db974219277305949cf8dacb0a5cf2fa828acdaef54bc2d16','27bde6eeaa7ad95b7ad3d8b80ce1ac13080949b3ea9875a0f26ac0581a2b9476','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('guard_phase3_customer_v2_terminal_status()','7e2c7b5a298d4648c5557cee5b5161a1c638157e8cbf1170311d7f083e037675','e6ecfa0fe8a0f65e36569636883f7c87a7746d3becf1058f6f26029cd0c7dff5','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('guard_phase4_aftercare_consumption_history()','0e40d3e0ae45f6fe3360c600a0073ee2d274352ecfa4dea5ecbc3f29dd6b0118','c001f691a2f36da8533c57f9558548a57ec5fac8b7eb3c56053a67d3b6bc03b7','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('guard_phase4_immutable_row()','9a42ae48b0cf1d23f167bf0227362f6ed7b05a9dbc443f3d2543b493b09a43a5','c5a72f53449bae3670009b29c18da76d0f43a97d958cbdabb279d65c7c913530','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('guard_phase4_replacement_event_history()','1b87e3acdeaf0fca8f14b8a024e4c1a2c70c856e980a7e0908755370fefc3b95','a42bfff51c5dc10014673c9c0218ba98a6c4636d2ec607d130255420b621fce3','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('guard_phase4_sales_return_event_history()','3dc8679803b43cc1ec633879c3a8dd425bee43089173425ec7877e894d237163','a2f6797127587be6a1870d33ad66fdab984f396c92d936ca589a4a6c188a8606','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('guard_supplier_invoice_identity_history()','39b5a5b713d7fde22a639a3bc491cce00aa9e003c080de64e9f36cabe7e22329','7100f56e4c6490942f86791c2864c0edd6de25306a0d7a64ab2c8c43a5baadf9','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('has_erp_role(text[])','a0aee1cfac5a48144cc02c000a132e6747720165822754094498cd18a74760dc','16869078890bc2a5543fc9291ef65a599e230e7467d52ecfd977cd002b134cab','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('home219_adjust208_internal(jsonb,uuid,timestamp with time zone,timestamp with time zone,boolean)','e92ace4b230a29a9b993874dfc6da039be84831705258367020e6f700093e067','717d554c3fcde80048eb4ba1f1247ce42e3a0f1aba4d085796e482c66e5649cf','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('home219_adjust215_internal(jsonb,uuid,timestamp with time zone,timestamp with time zone,text,boolean)','4a2facb6a3f9216857f51688412dc6585f30c6243ad6de21793a04f050bc0e7e','0a9c2e33859beb6f7d7b9c987a21af65a368f1373b6fab03dc725dee7d073e3b','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('home219_shared_period_facts_internal(uuid,timestamp with time zone,timestamp with time zone,timestamp with time zone,timestamp with time zone,text)','213e6cf958c1c6b27625462f2bfac46b638c814533ca840c38b6b36f4a84e6fc','e2cc304b34c1955ee682c924464c0acfc848c371458f7e904481dbc785bbfb50','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('import_go_live_products_v1(text,jsonb,boolean)','673083e60ec89ed413b5662b162a3fdfdbb410777ced6fd02cd8e0da944c42a8','d69806a450635264dc7c37608516645b0ea72b64b3f438ae095eef0afe1c696c','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('inventory_damage_period_totals_internal(uuid,timestamp with time zone,timestamp with time zone)','d97e0b41315e39d6924c34ea5b90f32362d6638c36aeabd52782b783ff6634b3','7e977154e2802f574edcfc426e471be05ab73e82869037f88f743c78036b194b','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('inventory_damage_reject_mutation_internal()','e17cbd70bf217c0264f559da47824f6e09d760326a33486b07ac76ee36dfe4a0','59b818bef0be9a90f374b336915c677b4fd76cb0defe436c8ffa9c54305ddff3','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('is_active_erp_staff()','d3484a9f6e0f78d96517a924f2f2deaaf934b11c4d27e6c94cdbb06bc69834b0','1067f561d9250cad9b6fca264fa0c16524e68148525fe2a84d16d3fe11164c44','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('is_authenticated()','e1ac574a4e8194e1347ed287ee6b1c07378bf74ab379fc0e6618db919fc890f6','d03a3ed6eed728ae1eb26aa4c5b4ed3e3e1d872855e7d4a50e5204f9dbbe337b','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('is_mfa_policy_satisfied()','6925ebb2e9634c4c6c4444489e4bdedd5d2fbb2d3ec60856e013151e094882ef','18d45226808426ecd3999ca8c564416a4a2a92d6ac9883be0cc0c8c500fa7151','postgres','["search_path=public, auth, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('issue_supplier_cheque_v1(uuid,uuid,text,text,date,bigint,text,text,uuid,uuid,boolean)','af305d13c97680532581c83081ae8791f79de522a049e2303c23e790d57e422f','0b4376d26185e73519571ac63693da3aa3689754d6daf513eacc512509125369','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('mark_all_stock_alerts_read()','30eab73e75fa98a2afbb133e6c6d6fa955add9a40169c52dd280e463423be842','7c51b9728afc00c49374897a13a006c8d674f7969c3d759ae7a2457fe89d3663','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('mark_stock_alert_read(uuid)','2be28d31de3a4f7b61f81be297bf8100520bd529fd72eef0093d27725ee913c4','f2530594d1688802486400839a56bafd1aaf321e7f2f9108bf002cbe9e5ab911','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('normalize_customer_phone(text)','62e4fa7b1435b406c30cbad856d39322294874a0fdf6392ca9fbaede90431648','863f9e9e12f7452c926ccc5e9e3c0453ef42b5ad2bc292573e85bbaffc4b9ba8','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('notify_new_website_order_push()','1e29f10a739645f657f151cee1826f827a926bbf147c80393776a5d016e95576','65ee583ecae7ef940229dfb92d7cd1254d55de88f40261ce041f9a857c7ac8eb','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('open_cash_shift(uuid,bigint)','1e81b56831466551cf4832270e77d08871716263f9ba422e4a06ce43f0fff55d','86eb396332c84c0bc7cf49b611da59cd78f324b139277938ecc1337b9eea4b65','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('owner217_claim_deliveries_internal(text,integer,integer)','71aee5432b41ba415f366b2dd1f126a1cdb1c53c0f141f0881f0a73c44adeba6','fb8f1b763325607019d34ad76b870b08a064eb4abc08962a71ba5559b55887e0','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('owner217_complete_delivery_internal(uuid,text,boolean,text)','46a4e548a72aa58c3edf5471eccfb4f7feba77a65d856a9de87d9c86464e74b2','debf9612aad5ec55340cec4f321063c3d72a0f0440fffa9edd7b0cb890570561','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('owner_telegram_dispatch_lease_valid_v1(uuid)','1531f6b813a34d5f0beb5a54c3e36623a9286a24bc578250a2dba44c8dda7ada','55536574c0cc2a5335062911115fdc8a68d1e414539c34864749fdc12f50e301','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,service_role=X/postgres}'),
('owner_withdrawal_closing_section_internal(uuid)','5096fcaecc4b809b96ca76d8cce23140d31c11a87ab88fb1d3122dc58675df4b','25f88d4eed838c81d00727ad176d270a401cb3acfd4baf1e13ff22ed2b982e08','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('owner_withdrawal_events_internal(uuid,timestamp with time zone,timestamp with time zone)','317cbdd304602c4f7091c35ba793bbe77b3566b08b9a416c4638401e6228f0ae','2af4ad360c9b06835ba3d496c5a0a6f058292bcabcf5ff53aff053ebf10f4dd2','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('owner_withdrawal_format_jod_internal(bigint)','8b04fad9c7d54297e434720886cc3e05aba08199acbe6edcba8f48abfc6d9330','2d145d30b3e1ccd6c31ffef34f2c2b56669de2e27cea093e28b555f624c4287f','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('owner_withdrawal_frozen_shift_effect_internal(uuid)','e1bc4dbdcd747b95fe47aef29e5b601c110ae1e188be185bddb5b601307119a2','e291c3b908e66a7564e9de3415ada0b00ade0921ad1dbbc2f78615a6ac786ad6','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('owner_withdrawal_integrity_issues_internal()','43b2d1121b278d9951ccaa97c563955bce983f9e9be708b296fdfd14f4454c3a','55308006cc873471036dd421b069482a56bfb7cd2296d775c8aeb9d15d15a769','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('owner_withdrawal_period_totals_internal(uuid,timestamp with time zone,timestamp with time zone)','80f870d4ac730be2b9580024e7596582edc4a5658660e5783298fb15f2a95393','b0602441e2abbe14012d20f83687279bb0c29b53e134723e276c23c287a1bd93','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('owner_withdrawal_reject_mutation()','9ee220bebeec53e8ec576cf4d5fea45321a561c43209ceb870a5351a53789531','e3aee5bc1472bfc834c5bf8036516672d738f2d66b72b15a66cfdd4c23dbfcc8','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('owner_withdrawal_result_internal(uuid,boolean)','63848951b4cc64cdca2c4f454689c41522a5a22583d87ec8ecb24c6db680b1cf','ae914a0477efd5d2d645c788ca67d18bcc8e8ced10c306a10d079a948e13b551','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('owner_withdrawal_shift_effect_internal(uuid)','d50cff8062c35e3af2b99fc9a6ed1c08f8a02521c38dc63f936424a4d64eeb4e','d39f27c0b8713e0965a58a403dd101b55bbe8e600eb9b263d9bca0fd7a8848f5','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('owner_withdrawal_shift_reversal_plan_internal(uuid)','a910437f5bb2e683c5b7e02cd60ca784e0641f896da5ba91c45741900f3afcfd','53b9419d1cde6f597281e53263ac40b91d17dc8aa5fd63758ad6bf92baf69159','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('package_d_assert_carton_return_item_internal(jsonb)','8da6e98c864e3eb8fc527271176a5c6505ba5b56f4ce00d972a76555ca0164bd','df6f5723865963440bbcda3455429954f7b2e3c193cbd68f8505511aeb06f325','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('package_d_assert_modern_sale_internal(uuid,text)','78124b6530871b1ecae2cddb79052eaabd4946ca1e83ca18afec6adfb98f5caa','af8ebcd2ac8c2a28d94531acba12b590dc5582b46a53fe3e1f4bff23a5ddc8a6','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('package_d_assert_return_evidence_before_single_sku_internal(uuid,boolean)','c8c6046e43e3677bcbc3fe46a0c73f2b9612087ba3c439f0bf2447f79364cd03','5bd1cf4845665472c3f0b913e5481066ea40ddd8b3e88e424127857b6a2031d1','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('package_d_assert_whole_single_sku_quantity_internal(uuid,integer)','8eaafcf677fc2b22e0d91bf552946b22ff1366dd4622a00e2b964acf3ee1ccb9','6ed3c516aa408cc99de4399a173fe75126ae03a74f1f4cedf71f05efb5ad992b','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('package_d_capture_single_sku_price_snapshot()','0f62b9fb4e6567abdbb8149d100370fc381ed6ee1be5fd82134d40d2e1774c5e','892b44635f856a20eace1a7bb6edf52515a44c2c03c9a7935b722281910d9434','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('package_d_create_customer_order_before_source_guard_internal(text,text,text,text,text,text,text,text,text,text,text,double precision,double precision,text,text,text,uuid,uuid,jsonb,bigint,bigint,text,text,text)','cd204da674a1e713ab0e3789929be7609b12cf8cf368b5f1d189873eadafabe1','87880cb9d11cbab9feba17348052f46f08eeaf3d4ee75bbe4be4e64e8c737874','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('package_d_create_pos_sale_before_attempt_guard_internal(uuid,uuid,uuid,text,text,jsonb,bigint,bigint,text)','321a3e22afc02ced7a043892d5c147c462e4319a6b35716a6795a055f2c349c6','173fb6f04b952b6db1bc7a7ac77dab77a2eb2beef92ca042d59a3fb0195274b2','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('package_d_guard_physical_capacity_internal()','5d25c59a536492774d2bde6aef7bd58d15a9bede86490695cf8b2e4b4169d6e3','e3758fa5389f631a988ad5b5f41c9d40c8506dc81aaecb97dd444046be49411f','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('package_d_public_parcel_options_before_policy_internal(uuid[])','341c5022a743bdba146721c005d39b166ebdcc7e88fc736eeb7a6e9fee8b79f9','600e09a155b99ab6953d590ba0b30538c3730e16cef8bf0e7b1628496c424257','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('package_d_reject_pos_cancellation_mutation()','58669f2a947132c1408c0121a4f14534d392864fd36bf85a42d35677b2a0313c','93752ab82ea712969ecdcef84949f5ba8836cf433d8f4d8cf4eda8ee763d11b9','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('package_d_replacement_evidence_before_carton_internal(uuid,boolean)','992582c75e85aae4a910ad488a34a57b8ef5d2f9d0fcd3cd266dd03fda4fe7d4','e0d26122b7ffd3ac4534b2cd176d9b4761cff5fbb629e287955984a5e86473b7','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('package_d_settle_sales_replacement_before_guard_internal(uuid,text,jsonb,text,text)','5adec3ee4344464f3c596b8136a6d07c0c239038ba212770fafa9a0e84b0a0c2','267e0b4006507c321804d7e0e0ea691f1ef8be332f445764e0e176fc57ad3e01','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('package_d_settle_sales_return_before_guard_internal(uuid,text,jsonb,text,text,text,text)','90385b4fa629af45ee535d66a1ec1dc312dccee5d0cec970228132561cd7ea31','843f154dd68764aa835de8a4ec5d9ded52be44bcfbf23665e2fbf9b8d4d30b6f','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('package_d_validate_configurable_parcel_before_policy_internal(text,uuid,uuid,uuid,integer,jsonb)','4053821b74a74a8e7d5922c6bb95c74d9e43ea787a03fff0965a2846e7402c56','87986d89fa222ba929c9939445862797cd56f63a413b7e04f5fbc5ec99792142','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('parcel209_effective_only_internal(uuid)','75162658c4c41c6761a5fe5d0573bff1ee66f6d89b0b97df2b8dd75e2a2bca33','117db108e428c7f0ff0f5d9fa997a79e49d820bef7e18c72e06622c25ab6a0a6','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('parcel209_guard_legacy_items_internal(jsonb)','670e02cbe20f1174ce6971b4574c6895871c71e3e9e307d5fa493718a2fdf310','e2b826b7362dccec66a1f09dfc3165789288e4caed792405c161361dbf98ce67','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('parcel209_guard_modern_lines_internal(jsonb)','fb25a14e0770e23cf88f3ed47604543215b8aff606ec821c77345ba6cc4d0578','ad5ac241c02734b08ee55076559a636b0011ab847b5beff95a03a4151bde5823','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('parcel209_guard_replacement_internal(jsonb)','fcf5fa190f4f79679209aff3b1d9f8da0c2c906c8a251000c78071e65589921c','bd65707dc9b4be98a0b2096f3b88c4ec7340d8d4230f6be414a7bc8ad99f91d2','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('parcel209_inventory_family_set_internal(uuid[])','6b26c09e3cabfb44c08a571c969c16539914201f97801d6674c1bb76bde53ca3','501437b97e4d57d30b1739671ac4c9a1215f20082349d880772cdc4175cdcc91','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('parcel209_pos_customer_internal(uuid,uuid,uuid,text,text,jsonb,bigint,bigint,text)','126627d3383c01e77543e9441dfe3526bbaff4bb6cecaec79b76d73e19a23358','fce0a7a7241ad06ebd8a69e569d5ededc7ad1cb0d7de5e88e833f6205e56330e','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('parcel209_pos_sale_internal(uuid,uuid,uuid,text,text,jsonb,bigint,bigint,text)','e2761c977438dd1127e078ddf5a0676b742a70f206a571044760db3f3b080d4d','8f0af4b176eac6dc79a89ccf916f9639b5d6393cdd17e7a4ec7786f5407842b3','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('parcel209_replacement_issuer_internal(uuid,text,jsonb,text,text)','e6687937a2e13c7712890287e3d4f70773f35ce0fde176140a337bb3c93e4487','d321ac36e1a2d13d5cebbe57a0848138e8f09a1864c8164a23050f520f77625b','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('parcel209_set_flag_internal(uuid,boolean)','a4413a2034e5c32adb2feda568c647c8eb29d96ecfe1788b3d1c8500539d2e0f','e73ae94fb95ac29333d9a496d8a9575e5c65a749cf3a36f9c6fd1903f5407018','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('pay_supplier_cheque_claim_v1(uuid,uuid,bigint,text,text,text,text)','2fe08c057a6a6a9bcb5f8fbfdac3fc1f2b7ffa3c92af179370f2e51c9ffa9fe5','bc7e357184ae45c1d224c4e74d70bcc1417d730c7180d8e13b554315b8f48051','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('pay_supplier_opening_balance_v1(uuid,uuid,bigint,text,text,text,text)','a4afa35320477f8efbf7abad0c872d4834bb3ca9263cbfafb3523114c82fc2ed','287b276dbbe3db692083dce4ee54517ad80a11c5a563d0ac6dc5dcf2206b9924','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('phase133_legacy_po_payables_internal()','2fba411caced86859521656753da0d7f61abe30863b070143d407ef5834e5f8b','fcb763c550f947d6ebfbcf3dbb811c8c09a529e135e0f5aeb3b83476b80c8154','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase133_supplier_balance_evidence_internal()','a38bae7dd4005115eaafcd492358f29ce25ac7f134ed054051dc749a03a1362c','66fe83d216ea7778b835887b0cb9b50fd61dd69d358d37977d5b2fdf665f1fa9','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase133_supplier_balances_internal()','95df82c1ca6a3022b9114a18da74a9b8440df0e597039abbe10463bbe230c9d9','5932d12792711470b558352c99038ce6fdb44a366e0fa612f9d96036a7ca1a80','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase2_allocate_largest_remainder_internal(bigint,jsonb)','b5042d17c1e6defd94ddbcfef794942622f713afc8f5b3c27601f4c59ab3c458','151ec8a2ceb597cf816129d220f5a8c95ee18b656c31a115d8760d103f35e755','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase2_apply_inventory_and_wac_internal(uuid,uuid,text,uuid,jsonb,uuid,text)','478de04336b432e0f0e3e637193256c91130a450d5c0c322dc56cc654195f05c','9fba0590abe799b75d4300b64bd0c5d93c57ddfc4bd91c41ff24968c69edb57c','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase2_canonicalize_legacy_receipt_items_internal(jsonb)','4115f7e23cc0f6d0e65bc66f0b8c5341866a0e219f6d37f766096b536811087c','3f0bb7b5d1b98a155c4d3359afb6e91d2cb0aba7d8a286ff2c89f5017eb8f751','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase2_canonicalize_receipt_lines_internal(jsonb)','4ad838104dc17ccf0812767f2b47b8c826fd2a5de80d0aa00d3b6ce451ea578d','42f4b81de46e5d029d0145f19102aa0e3b9b4d64e31620c97b1420e2f348d15e','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase2_lock_inventory_products_internal(uuid[])','8017eaacb29730b055921eed14b4c95141b1c5c3e7459d15b56a2f58fa8bb3df','dede97031377cf5342f667e9728cb0d4662f6c8d1125cf88cde488644852c6e0','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase2_lock_payment_shift_internal(uuid,text,bigint)','0bb1c425e2c3fec8d2b9dc5426ad3b838f542cad0238618aa47a69b0e89b04eb','60dbc3073c7726249398a5b374eb234aba3dbd8154e8c41d9aed5a0d8374ae1a','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase2_lock_receipt_payment_shifts_internal(uuid,uuid)','907c7b2dde386aca365bda5b5918d9d06acbd79d24238d323b57cf3f3723cbce','e0045353df2c1787d5d9517a3b7b58fa247c6d1b8b45bf117090f41ce2f2c41f','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase2_request_fingerprint_internal(jsonb)','285f6a552d6c94d6b987162c07015ccf53a18bdc8e2fe34cef01d7b33ef1808e','936df8c9a122f13e95ad8bcc209cbcbdfd87b3dece599dbfb8b2952bea8bca56','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase2_reverse_inventory_and_wac_internal(uuid,uuid,uuid,text,uuid,uuid,text)','84fbbd59a8551943c3d760941e7345644bf2410a2a5d18fc327cfe6f5e3dc8d8','d7dd66c84bf7fb405437cd0f84207d66726a7987e8d19076e0194119baf79162','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase2_try_parse_uuid_internal(text)','25ad625f187c98d06c409f45c1daeb2802e7bd8bee35ae0f0a96c4d396856169','42637b2c7c236ce2de3e7563767cb339c528be3e4276f957bbfdfc89b3a08320','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase2_validate_receipt_lines_internal(jsonb)','3669c0007c3f547f8616250ade36c94e4ba781d39837c1954ae556acdf878dba','198ce0b928729f029e1cbfc2fe70db3cde9879ff902b5b7df1263b94c6e9ab06','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase35_report_base_unit_count_internal(uuid,text,integer)','186f7ac6a6e5020c99b9f02fe927640696939b6f7ea5ed4b9c885ed5b552cb2b','399346cf2f646c3a22b624265e7f11fb29517808130e585995b0ebe146f412ef','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase35_report_package_count_internal(uuid,text,integer,integer)','0f91b6b5286dc8ab21046a6f6e1ffd8050d07ad67fb948e395110205b3fc3478','9f49ae0c7df745fb3f62326338f284ddc22d34648630532a550a0ae4cb46f145','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase3_actor_scope_hash_internal(text,uuid,text,text)','d396ecf9c32ee6f94fa6d455635355c6e2b0cac51e0406fb2618b351da939fa1','8e7507e6336df3ed651bb5ba1df213e370789654df3e1a0c3f2edb369236cb66','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase3_allocate_parcel_cogs_internal(jsonb)','4ac6e0d2ede50c54852c732700aa649c9ae47e733a065c0f7c3de70c07e1485d','e68a3ae360d55ffa58bb52957a4518251fc6a57bb43280f86ed40f7a00f7e565','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase3_assert_configurable_parcel_creation_allowed_internal(text,uuid)','feeb9f826bffb6f0bd640d43a4d20c275800e5c1f58ec6d3b35c3c1c8be05744','4e99cff3ab4196eda27b9a93e1032bf0ff576929b1a774a70a2aa5f975290b0c','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase3_assert_legacy_customer_lifecycle_allowed_internal(uuid)','5bd2b45891d7f8ad43b6316064dbe3b3b04e156229333a6769927632cba019f5','6e6eb94b9b21bd3a8647c290cbf4d2b279312745caaa71f3a20ffdb345e66c51','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase3_canonicalize_components_internal(jsonb)','8414ecf265dd688da208a637e2b1152e33ddb324db61752354c77cc98094f91c','042b201d871627b08fabb5fde3778dcd78f72733dbd900e0a0b58c43c1e55839','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase3_canonicalize_sale_request_internal(jsonb)','02c987168c88727906402cf511c312c588b1bbcf14abb8b45b264de89067848c','1f520b1e8d1b52908aff451d9153f73563cad7870419442c25e07416a505171b','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase3_customer_cost_finalization_allowed_internal(uuid,text,uuid)','00d8d200a9a9d02d6989bb518469158f0cd74467c7d29db17fce2ca0d48e2a00','05bec7748428c60c69c4387b90ba875a177b88751110aba55c461476c459e0e3','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase3_customer_line_identity_internal(jsonb)','db9195d38faff8627a681fee1562dacebcc231822464c76a47abc8ab8c43a6dc','d3ad01707ecb6dd3193dd302c69f6fa73fb5ee2d7ba05d01a83ca1262236f542','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase3_expire_customer_order_v2_internal(uuid)','b1e9d43e45b8b22bde53afc3e30281246952733133923b47de75db39d5b308e7','f91f3098e35fa74d922065dad36fa47eb5af30a66028d15197fdc42b93cd8dde','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase3_lock_inventory_products_internal(uuid[])','4fcc232683685ffc666f7fe4d4632dd2f89f8389dbedc1c58326ec22ef6db0fa','5cfae93246e867b157456bd1244b8dc814c9786e0ed773050cb20311d7f44cf4','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase3_lock_open_pos_shift_internal(uuid)','e10fce51e73fa935cba2324881829a4fdabcffc61c15e84764f7b1e752009cc2','0b0c9d7d212d991dc48b11d01c434418cfc42ebb4601258ca4e47509215b150c','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase3_pos_reversal_inventory_rows_internal(uuid)','942f625354c79827883fc16b0bd9131a260073d11f0b3a6ef81888b020b38598','c1eb5283a9cc067cbeb3568337dec0621068e452401ecf674551123945612325','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase3_release_customer_reservations_internal(uuid,uuid,text,text,text,jsonb,text,text,uuid,text,text)','71d07609f9bd7c16c824908abc5631008584c87fc8db1665c7b2de83f6fe56cb','04b0dfb01c0db8c7f1f1c68812bac018935f3ad0fc874ab7610dec0640fe937a','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase3_request_fingerprint_internal(jsonb)','285f6a552d6c94d6b987162c07015ccf53a18bdc8e2fe34cef01d7b33ef1808e','d5b33a44a322bb0a6ddc70bb87fefc2a6ee05879470a0b0d4fa0b2fba97ee1ab','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase3_require_nonnegative_bigint_internal(text,text)','d1f66c8850dd0a5921c28ced1187a26a2bb9bd93a51e564c213871091f73a359','fb7ec7a0a9b9aeada692eb702fc2ff008220604a59e518847b3d252dfccfa1a6','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase3_require_positive_integer_internal(text,text)','d2df3f17684f896365a691552a51a53c83146e5081839dfd3761295f123532f6','90ce7e6f894b62061c0fc8b9b6b68ebc8fc3732a73681dc7f7b686c2d8f5b7f5','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase3_require_uuid_internal(text,text)','8fabc6c5e8462d0ecd6dcfb07db530908636f80c62e0253b1c4723f0ca7f6ee9','36909a1b6f312098dc438a71f04a9ffe2c5a51fefdb4c81f492b76c8e4461c40','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase3_resolve_legacy_pos_location_internal(uuid,uuid)','612b440de697ca3d0ac0c6fe655e464ebc78c4e7ca97482f0c94ece7e3758d99','0018be39463307bd5a84d64491fd6c75c265e641b43d138c29dc49d5935822b0','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase3_resolve_operation_replay_internal(text,text,text,text,text)','1b6c1d667055a2c2b4d6629e17cd888a6c03482e8d502ace40d6ac72a62cbccc','f3ee1356c083e8ab2a237655796e853e47ba821f655824405e8424b8340c9842','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase3_validate_configurable_parcel_internal(text,uuid,uuid,uuid,integer,jsonb)','2d658779360bd7e62ac721df2cf93c9b798f5ea51e80971dba68e50dc5bbe824','88ee5afd46f91d5457247d4975843a01e1f50f68c118f0a99af6be73b7145faf','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase42_apply_return_inventory_before_phase43_internal(uuid,uuid,uuid,jsonb,uuid)','86e8f476bd0c0f30f54fca45c7dfa46e6a12d5574ce9a0f9a3cc382b2e11e16e','7890a50422a1c7f24e39bcec5195bbf721f1b1f49d2447533d77053d496f9c97','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase42_apply_return_inventory_internal(uuid,uuid,uuid,jsonb,uuid)','729bd35deff9e3a2328fa5d6ab7517a345691573968c101a294949915480f70a','429640ccab37373c8bb313db68a44bcd3dffacfbcf71e5f913b22fc8266681ce','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase42_assert_operational_return_evidence_before_phase43(uuid,boolean)','dedb9a293dd36f378b605a84bf0071a3da14a309660df0198459c7b92ae93199','698c65a711c7a24bdb8a7b5e1b704ee4b925f75b34fa6e5335ef1b8c525da82f','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase42_assert_operational_return_evidence_internal(uuid,boolean)','206717f64ee90c031f38d924b780c9067e40b2f48f5470b950caa5ef4391a3e0','04447943ceafb488353eaedc8d5e198ff61d421543890aa89dd5f1212e9308cc','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase42_canonicalize_return_request_before_phase43_internal(uuid,jsonb,text,text,text,text)','8d5f6fcfdfa790b78140e37efcc9458096a79364dbf134b7da8aa3c83248c58c','f3981c500af9e060d1fc9ad3bab4fdc038f4a21733e70199952f74ac6f47eac3','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase42_canonicalize_return_request_internal(uuid,jsonb,text,text,text,text)','658da476bcdf6db0066420992658d22aec5c309f27907310d5838a741e9e24b2','8d8e4df2c8ff9b1e0295c5c863821645e72e366ddc0915a19538da8bed5bff7c','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase42_customer_receivable_total_internal(uuid)','554ad2d5f5940dfc2b8c01b540ca7ec14eef7707ca69ed13d8b5ae4df18eae86','743151bacfb2d899489637157002bc0f8a16d3ee9a981b2a322958a677fad876','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase42_expected_return_effects_pre43_internal(uuid)','4efd045a0a0c5f1da89eda9bb66543692698117150c375a077707a46a3618ddf','76ec07eab9988636773462611fc9003a33c8f28a96a7be65726b283422d127bb','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase42_expected_return_inventory_effects_internal(uuid)','6db1664bc018802433a6d74a151e37044b2523ad2645f84c88ea39a87ee50466','1c411d46517454c92b3945c05d1b34b776cff21b6c5c69eab7894d9f9d40ada9','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase42_guard_inventory_effect_history()','129e1508b43a944d66e49dd7e4cf9e8e9bef81b7567b500c17ff42765b127da6','673f7bfd68181d9d2bc9615dd006dbd5acdfbc0c50e59d5cf96bdf7353471e59','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase42_guard_return_coordinator_version()','919b1b00cc7000cfd7c8716bf8d510457fc66542b9bc729eae0cc86c5e14f117','b4aabd18e1ceef430ea98cb574eebfbd5e55285f86bc34616b84ebffee52863d','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase42_guard_settlement_evidence()','29f33d4947635ef84885a910741779130040858a39d2ac7ab751149b329f52f9','e80bbeb81b1cb4e0f0f74562fb5fa57a334d0cc795b143e0373cdd70e8bb8ed6','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase42_inventory_effects_snapshot_internal(uuid)','309b96e5875c988901b7182895f0e5476f885ad800cb1658e6bf5651654e4a20','b038124b819e69328ee0b61e8e8df4511943d831ee3e742db547195c68a33580','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase42_order_financial_position_internal(uuid)','8936c1161197db01bc5da8d21f694394cad46025c5316b6471b75b6e69750c62','d894ab027fc972e0ace7288c5603cb5bf6a553e58a26f610c03c8e083017943e','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase42_require_evidence_before_return_settlement()','859b2f32a9f9ca68a11394e5d04b4096dd915a0f9217f12065afe85fe951276f','ea0a1b46968c2322ccb4778e93c11fb1e5024da5c647a2163e2ab6dc38722200','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase43_assert_operational_replacement_evidence_internal(uuid,boolean)','f64621b097a5a0032720af573346e53f0f107787cb06216a0fcdf583dee3e33a','977b981c026bd30f57d66e46fc8606de1dc87e6d074c033bd34a8ed60093ca95','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase43_assert_return_allocation_contract_internal(jsonb,jsonb)','a2ab8af7d52cfc45b6b49974af1308a1c40d2abc586ced37caf52dc544ea58b8','b2fc0adf47a5e380f49d9e4a9fc00916866e9795a21dcc3ba4c39ff2f794a488','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase43_assert_return_physical_evidence_set_internal(uuid)','e783d17f4d4b2c56b58f8c404011b7f421e31f441f890124511ad62243e8bd0f','f1df588f3320f2a1dfb02858d27ee93ac471ab27c6e7fac7f9ff8b05976150f2','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase43_assert_return_physical_source_internal(uuid,text,uuid,text,uuid,uuid)','d75d9033cd6efe0721228db0817f1a460d08915c13933305ff3a2afa9e91b406','07ce65558f0e0b619e48a91502510bd063f62a663b4954151db0544f2753c6b2','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase43_canonicalize_replacement_request_internal(uuid,jsonb,text,text)','418f399e788291fa83cc9e7dfd6643235a86f53f81e6ab20706335767cde8d77','46ed234782a4a571a6691c1ba6434f99de4d2ed0312844df8c4c7abc57e2bbc2','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase43_canonicalize_return_physical_sources_internal(jsonb)','8a37d23a68b0ce973aa65a9759efd5ae485258b7905d85928e480016202b6029','356a1c07083d2bfb8d083da2eb678d1ee11bfbadcbfe0feffc21185cc17cd3f8','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase43_current_physical_representatives_internal(text,uuid,uuid)','62092d5f0d3a17525216d00a7ce86a885089fb6de9270b42966ea2dac3282d81','9e9e99be4a9257e9f075ada289e1d942def608db7c94c476cf03ecd428857938','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase43_guard_immutable_replacement_effect()','7d962693cb6af64b513d4cd7e88302e9f556860833bc1279ce8f3a74527ac2bc','b35ff98d66c8052b6cd7f408309733896f663fec56a4a64bac18b5d570fbb8af','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase43_guard_replacement_settlement_evidence()','1ff3177edc7830899eaffcebc0d7101a72b70d813e74445d1312bd7080dfbe03','66b23008effb85f92393e369c3ff18ec5d6ccc71ba1b86fa114305666765d817','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase43_inventory_effects_snapshot_internal(uuid)','8e966b3e3c1f1a7e320eedb2ab6768ef0c8260cfcb59fa85dd648b52c32db0ee','b412b7f5cf2f3b16fccb7d61d3ca0487e9160ba12f0e87b1ff05bf60206ab2fe','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase43_rebind_return_consumption_to_leaf()','1b8dceef7a35f1dbc088b99ed7884ab9bb8f91b9b3dd566a0978f4a3e0d539af','2d19b69cc5ae86b833b82f05eba4cd35a81b0a1a1a0a7e0add2d7320b6768256','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase43_resolve_replacement_replay_internal(text,text,text)','135f8804d4bc92896e6f6cd2b112490b880d5df0a91eda131f192266f2d06658','96a4bc6c0770eec4d75df5c20792792c32fa84fb1206433e7d950c46ebe88bb4','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase43_return_inventory_sources_internal(uuid,jsonb)','b353d5d61faf5807cb415b71c9a8da285d067b7b1c79ca16e16867fb86afff54','73dd0e806a68c0487464eeb2bff423958b17610d11f33db8b8d6cda38f7486ce','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase4_aftercare_source_root_internal(text,uuid,uuid)','891026386ebfd7c5637bb977bdad3cd4bf326199fd201d85f069515d699a9ea1','5a017601a38e486030c051c945c3f6a2c1f1ab42b91ee93263cb4c3f46c46c26','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase4_assert_aftercare_operation_binding_internal(uuid,text,uuid,smallint)','905876d96ebb25aea8a844a1a5cabe7be98d4785eed0c14a60fbaf520c0aa8c4','1ce010945ab336ca23983dd26da2dd9f1146f5c82318cfad8dc4d49d71468316','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase4_assert_no_settled_aftercare_for_order_internal(uuid)','7e75636e9c90fc7f8cbb787efef6db2a105d02c71193fb82444b61d490461c7d','4958de02e5b80bcf9289b142ef27ec998c78637efc2745944228ddc7a99db57d','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase4_assert_success_result_internal(uuid,text,jsonb,uuid)','ccfaddb732b468337e4b80e9cf6feee7c5e4250baef27cfc20aa0bed9ee96440','9b7235199b29fb1a0153e2098d866813d01d6fb522550163cb8f1f5ecd033492','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase4_authoritative_completion_internal(uuid)','70a594e38fb5d884277da8f64991760c173c09bdd30c8415eb86882e1c8001fb','84681dcffb4c4de923b04462b38d00cac95c4658dd26002afd61c6a94dadee7b','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase4_cancel_draft_aftercare_internal(uuid)','ab21311b1e723e964ca3e496d57bbe1e0dda8f554cc6919f6d1e5f88fc665f6d','05b9254cc016bfd0e3ac2c4d80e93fa244a2b92bd7acee3c0d18d428dd97ac07','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase4_canonicalize_idempotency_key_internal(text)','a714d4665320ff9db77f8e54369118515f3fef6f3a66fa7914af3bd241c76e03','7bd714c08b637576196dc5ed9a2dfd9882f1ce35866b1b6a87f59705ade16ffd','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase4_capture_parcel_component_price_snapshot()','5a2ac36408981ef8ab48c60f9679a78c7727c7122a17e967391995b3eaa95fb7','18f14e92cbd1e979e97685f2d6e40f51a480eddcc5a8151972fd793f71e1a359','postgres','["search_path=public, extensions, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase4_customer_completion_replay_preflight_internal(uuid,text,text,bigint,bigint,text,text)','c515483feab73408def02f35c7a5fdfc9440bb2595bf840d8ccb71959b26fe38','3b9183d148d3b330c4016e8fba74c31ca06383d138b7b207f5b86ec01079a6da','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase4_effective_standalone_unit_price_internal(uuid,text,text,text,timestamp with time zone)','7559d1e347a586241dc0cb823f946bdec9ddd96737015c26708c755b73126f44','e8522c8d6626b7d79780593625a063ab02e70cbb4152e308a8f28a2fb313452c','postgres','["search_path=public, extensions, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase4_finalize_aftercare_operation_before_phase43(uuid)','900ff627e42c9809ddbcf822ec5c39b994e24eefdf2404a526c4169cfc77f3d6','4a6a8e682886b0b03de711aa62a57f51d626c0bcebc1c8d7cf71034f441d0d4a','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase4_finalize_aftercare_operation_foundation_internal(uuid)','5636f03379e40ad37cdeec47ebb0113d6594bb6d05152f0176aa1c6fd24fbb50','4eb05e231431d63765f7ec41e4b4c1202e6308c37a56caf96190beb9ebc28c90','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase4_finalize_aftercare_operation_internal(uuid)','3a67c92a54a95a220ffedd79ca78195b4889b2ebcffc8075fcaf0e9f2cf09896','48bd9fa67ecd631db677fa567d9f2b7a5c2dcda6d2e7045b7fec8b6d9cc17f2d','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase4_full_shift_context_snapshot_internal(uuid)','1593afe18957c69df810a497caeef9f4ea31f9244b80ced861d78bbb79225a9e','74756879eb5ad8d56f99fa69d8e6eb9a500b1fbb45cec72e2bf43f60cacabfa3','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase4_guard_aftercare_operation_order_gate()','b4a450336fc3cc00038395c6dff3383e380f2240a87db25a16100aaabedf29e4','4382cbce224bd34e5b5f5650d4f082ac7bad57aff53e40992e16ea4c1c203d6e','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase4_guard_customer_payment_reversal_dependency()','173fdd0169a92aff1be1943c6d6885271d152c515d6b2a59d96e160ea012a1cd','dedeeedc920166967f56a7801ca564535558a8286d0ff0a469c3be9fefed5e30','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase4_guard_order_reversal_dependency()','0c0e05bab8eb58202f64de3b2ecafee8f876f77286d024fafbf359c668596205','3d8f1987d0d6b3fe320284c18dcee949e95b52ddec681260808fbe5068921d54','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase4_guard_replacement_event_insert_state()','4f73d3a19c0da7ffb7d6361fa7d5168ab7c2d678ae842fa7c99e0f2251d55047','d2d7df57aaa894326bf62909605629ad4beceda436435fc8a34f5cdce9e27de0','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase4_guard_return_event_insert_state()','252dfdaa583af34a2ca86ce3b0b306fdc6233733703cc290c39257cd6277f912','ad90ea34d384c13075d3b07d317a15116bd3eb2f4f48ac310b8b25edd83dbf4e','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase4_lock_aftercare_operation_order_internal(uuid,uuid)','1657b0ec6039a3d3f3b2c9ff6a6a49b5e5b34f548cd55a0921147341de2ea752','24aa21f60b2e1823d6ad72ad38c28ec24fe87fbc4749a7b01e8e6c32a573c0a0','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase4_lock_aftercare_order_gate_internal(text,jsonb,uuid)','9637706995b63aa937c002e6125f6c07685ee0f4892964f332a0005baa3e2a4e','b6ff433e0f44e15656079dd68ed8115462fec24137cb37319db3a34f98f97fc0','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase4_lock_aftercare_parent_order_internal(text,uuid,uuid,uuid)','f950b0d4e4b4396388d8c381605a6eac98b771af09ab7e8559fa4cfb5242b5ea','8e07cc114fdf33ffab2d6d8d4f6a52ae3e43173e5fc7be1a6a4c22a502ff6058','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase4_lock_customer_order_context_internal(uuid,boolean,boolean)','f6417094a5218649f06feed5c392ac6add87db7414d55610e17fb52a80debd8a','e75b69e422f94721b548f56fa84a202461a3018b67b2baca38e295c3331dea9c','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase4_lock_full_shift_context_internal(uuid)','6106b891c6b6a892f142a439301544404ce5091cab39625a85308b59411151b0','c306066ed3e3e924f8d008b3f75c237b42a675130931a55c7c756a6a4d948184','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase4_lock_order_inventory_internal(uuid)','1c235fb01ce0bbfbb8103e8ea036c686b45fbf3d5295abb8fb08302c4ea1e503','7767a27755144ca991df35069fac80c42e6dcd194bf8ef20ce7feab5db0d9d73','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase4_lock_supplier_context_internal(uuid,uuid,uuid)','62c48d4947893b08f6f7721e3bf96d2711f3a4f135fd40b471a77fe3b40507d8','3ac082fe6945129a4479389b432651a895dd6de29a379aa2fc679405509fa0f0','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase4_prepare_component_inspection()','850e990e198e039d5e8b5db590ecc0665da67a213849cd0eae1c4b3ec207e886','1aaaab15bf645a4a599c21c37a73c5dd8a0a7e23b43d693268762575643f5601','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase4_resolve_operation_replay_internal(text,text,text,text)','ee4095a4814c06a0afd5701a5859e5fa3f105a9c731178e42922d2cf4f6a4b55','f3c5ae713defe39f4e0e4a80e174c1b3a17350de0541cda5134bd6671dea7bfa','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase4_supplier_context_snapshot_internal(uuid,uuid,uuid)','117cf9750bfc8035228511d69f58d9f22e64bf5e3d0da7b7fa5eab59e66b7757','0bf9a19a4c12f1511885060dc5595e15175b3ec7df90b79521481abda9f76602','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase4_validate_aftercare_consumption_insert()','4f8b43b01f77e4c515eff8e3eca1b5ebcdd9eddb8ff7421cb8c52dc65d3a7d91','25f79368b0c98bfde57f4029b7feff72fdd7db6cf8321f1634a72afbf67f6278','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase4_validate_replacement_item()','1884f34059c84d3d7c288fc25aaf328e0fffd0bed25c5bb9e2f3394d9f3c240f','65245632c35e91f92155a6d52d42e474d4320de79446cdb9770c2ac5696a5ae8','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase4_validate_return_item_insert()','29bdde48db2df20dfcd21036c1f807ab2d924528b09d9b317248b5d837882f46','b5e1f2c57f60873191495da902db64a65bbcdcf6c8a8406bdea20f10d64753f3','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase6_financial_facts_before208_internal(uuid,timestamp with time zone,timestamp with time zone,text,boolean)','727f127e948fa371f25558f1001d66ba00eb7f036f2f6f939c2beea1e27fd11d','02294e3aa1db7af4e2922a342a53b534b5e776d057821783ef69b736712f4e85','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('phase6_financial_facts_internal(uuid,timestamp with time zone,timestamp with time zone,text,boolean)','e12a56fcdc7334a8962ca456fa750f4bf8c215db59a08f77bcd33bb0eb26b40f','5c432cde31028bcca8906ceabcd9ae7335244a67b865cc21bbcd968220ba64e4','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('populate_order_item_cost_snapshot()','89a7e10c956449c70a29942b259cd3294c1c1fbfd9693e764a6060cafc8af0de','7a5dbb128896f60fd707646395091ed22347b8eef1f5afa27f22d4d0abacc2f0','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('preview_admin_sales_return_v2(jsonb)','871e7ffe65cfa43aa364132da8082231d548cff7e5489e576f5f2f106f5ff232','4dd844b15397075f2bcc7f42eb3ed9ef3c4a827c74e695201bbb6566a119cf01','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('preview_aftercare_supplier_v1(text,uuid,uuid)','4ca8a77a4000f7a5be77b2e802d517dc3c85580c681a20441395a20d8353219f','1e9892723246b3927becdffb9269010da7e3e1f2018394f245b1c9dc9d526eac','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('preview_cash_shift_full_reversal(uuid)','8fbeba9e6964c93321173b14d39ddede51780c0d48db217e3e7bd5de79585a2c','454951b9e36433b5db18634475759c2672b7deaa2781612b5051e9d9d5670340','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('preview_customer_cheque_v1(uuid,bigint)','778323a8817ff1dd6a814d0b476b708ad09b9a18d1e934bd958b36b51dbf0435','ab0baead777efe5ae5770af73e7c1d17ee7e19018e6e12f3ded19542650622ed','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('preview_customer_collection_v1(uuid,bigint)','f334b1026543f879e9f1ed0f0b84cd38882ed87f1d41eb9f546b96525edc8ac9','ec0c3e8aa405410e6068c8a1f52ab06e78ac2debd760c946778b4fab688bbd0b','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('preview_go_live_cheques_v1(uuid,jsonb)','7d72fd4c5a2d3cbae58f4eb59f67efb9b2211b01ec9d3c5c0e5350bc414d9b56','4d67020214f986a495a19adb9e48a2caf2305182468f850c4744663cb11da37b','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('preview_guest_promotion(text,jsonb,text)','74be4ca55f601c2d62cc053ed0c3391ee82b3fa9905a6350cab3eaaec2553e01','aa77f43c297d5731005ea774930ad3d8665ee6dc4b3c40eb81203e7cab488233','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres}'),
('preview_guest_promotion_v2(jsonb,text,text)','03addd70d4af079d43438aa39fc7dcf2987753a29712031748cf26543693861d','38adaaba391f905d77e35fa4f8a80c541762ea353a07268d239e0084a1b4eee4','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres}'),
('preview_inspected_sales_replacement_v2(jsonb)','3b7da7d8dc44d7ec66c58b5b0b1e4757aad2715a0496d5d59be28c3e9e5adfa9','5b7c55025d65ac3987cddd50e2d344b3b7bb247675807b2e4e4003a2698a8710','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('preview_sales_exchange_v1(jsonb)','3de4a26112f84bc2901b440574899844318ef495d5b842c98a4b036fe717d439','8ad965a0c976f0bb276898ebb16b32c2e2a8dfdc6da2455374d8722b99be1367','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('preview_supplier_cheque_v1(uuid,bigint,uuid,uuid,boolean)','a2ca001bba4e6c717c88908d753d9f9f72ee2946b294cbcdfaa3f8b935fdd07a','a1f4ff27babdfb28f1ac3ac30cb2f9929ebdbcadac209b67d5ae2e6aaafbacf4','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('preview_supplier_receipt_cancellation(uuid)','f57240ae4b56cbb81ff8d3571aa1e59251119dc5a02bc45f0318ed1dff919d45','8d7d11762c54507d5ad94baf7ddd1d44260072fbc896bf126b030e2fb73aab23','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('preview_supplier_replacement_credit_v1(text,jsonb)','874373d385f7eadc5806fa08b4c646b8c50e608c12a489202e3ade0f77906b8a','b2ecad86a453c057bddfaad577ebb60f2bdb493137be90c59e8ccac086fb5a3e','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('preview_supplier_replacement_v1(text,jsonb)','f2248f32eac0677b2d729f4b73ce9235105fa2acf5a676c5a1dd7ce1a53ca4fe','fe5a8f2503947074360732ebad46121d01db55f7c75fac5368141aaa87c9dd96','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('product_cost_corrections_reject_mutation()','cb840305c5b33e937269dbbd60568d01a020c12810a733a3fe666cb476927856','c3d19527edfd51440c6c93b1bf52872ff3cd6e9bd0f40b5b96e0baa140779793','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('product_edit_assert_version_internal(uuid,timestamp with time zone)','568d42e6915b1cabd95048c977aac3f3e71c0204b81a2a0fdcaa544183eb1d71','e1e749f2fab67eff5a5b5d3fb2e1a3f87485ba55b4cecf82cb5a46006681b7fc','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('product_edit_snapshot_internal(uuid)','62ae96bb2e525ce81f779dca543f604436bc8ecf4dc99b8478a8d036283fed2a','00e65c74f24a3056b41ab95085a88fb63575237b944d3b3ed55800066aee0982','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('product_has_cost_history_internal(uuid)','8c2ffb07d51e6f33b0b7d4af0589160f5505b53da207cc74ca68cd415b1e4720','c36ca6d4ca2bf8529805c5cb087d9c25209f72691a20908652d817de0d1f41f0','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('receive_customer_cheque_v1(uuid,uuid,text,text,date,bigint,text,text)','8a4e75b2e520492a0a501ed48d6bc433ca6fa11d173985a66b416655fab98d80','a6eefc486e0f408e2805c98e7ce0f9a1c3339a1b010c3e8c7de5e2e50749a088','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('receive_inventory(uuid,uuid,integer,text,uuid,text)','ffa7a31b4c98631f482eba17962bf62b53916d1916e0e16925effd8da877b399','c2d23f58cec9a412cc924e9836bba679eb1422c41732dabc79f6f1c9a9b5fd0a','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('receive_purchase_order(uuid,uuid,text,text,jsonb)','9e2d70a64cc42aa3ddd3965c362fccafb108166cf90ede62f6fc09ba6bbce408','25d0b8c47b58fcf5aefbe40cdea987ef5432711b98caa1cf75bd03a71e779e76','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('receive_purchase_order_v2(uuid,uuid,text,date,timestamp with time zone,bigint,bigint,bigint,bigint,text,text,text,text,text,jsonb)','de93fb304ea00ff2ce42fb3f0e6954536a571c492b149f3d6461e2bc25acd279','4b23e1cb8e86dbdcaaef68c9d43f9191728d1565063d9ff5dfa2abc0763bb8d1','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('record_customer_opening_balances_v1(text,jsonb,boolean,boolean)','d7e6e0093756280311b281fb40b0e707541bc8982aeaa56b951a951e805056e0','511b05c9393237d47c15ca945280da85a193b89d3985f9e9708c4eb2c055653b','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('record_customer_order_payment(uuid,bigint,text,text,text)','834fec0d8fefec851c7a7c0e79f220bde25536a5d24617160340592556b8e870','7f0d0dc94c9b726958206dc60777c4c4279696906ae2ccd6e259eaadbad4bbe4','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('record_customer_order_payment_once(uuid,bigint,text,text,text,text)','3338800fd261c14f6daa5a3aef7649d6d3773937e83ddd478ff461f29a5588d9','a0e9536b170f2ea4f45d61394a7ae8c8e7b5fe82c7a7389e65468bc46e773570','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('record_erp_staff_password_reset(uuid)','c2a964b9d908d2c98a7e5b5fd29c49da2561b2fe59c184466fb266609c0c54fe','616801bf57eb5c7f662eb785c14341228ee83cbc7b7fe05966affac194d4d358','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('record_external_monitoring_snapshot(jsonb,timestamp with time zone)','1134b81792da11a207ed3cab693477168aa50fcaa8e2ce7244be3f874a9d643c','69935173419fdcd8aebcb46033b47f3a41635aee11822ce4eb46e1bfe0c54794','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('record_go_live_cheques_v1(uuid,text,jsonb)','f6ca68e42cea0bd139a37a66d2b0b856a7b2ca9630810a0d111baafdb92e1197','f9337e705e72c0157f796ad8d54e7ee26e3122d496dde80c85c2d3e2e6d97276','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('record_supplier_opening_balances_v1(text,jsonb,boolean,boolean)','e2748fc558bea76cc7968685b4b2eafb9d2252575f0e911d4528e4800617fd47','cb8b10c18758b3be431e4c8bd228c957f076396e76223c93c78e2045d2dea0a8','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('record_supplier_payment(uuid,uuid,bigint,text,text,timestamp with time zone,text,text)','3bc85d974a59fa3d0bdef88f46b9a505815e3591bcb59fa66c884f8a01cab2ea','fdc294c329f0dfe30dc8a93f8e54cae42f1ba26c25a0225550eb421f347dd4d3','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('record_supplier_receipt_payment(uuid,bigint,text,text,text,text)','5e80e3f94f07a3708770ad12ce29db2872ebcd64bd1fb519665da332ca8cf3e8','aa268ff3f1539befb7c72e78c4f50cd1f624ae6dd5d77bed8acdc96b61cb6598','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('reject_flavor_master_inventory_mutation()','8d8f1227c4e9e2949b7931bfbf6c0f8a46b411562d3827dc308d74e4fb6926e1','d223fb46d0b94bc26165e0bb69b1bbc65a7cb36e92628e5f0137a28027cd56fb','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('reject_stocked_product_flavor_master_promotion()','a4abdd3415f2766a3ec2cf88fa3435a65648b9065d75f1afd5a0fcf4e807fa53','8c176a49df8f054d2a8625b0df82bdb6e77d860025deb2fb48ff38099df69a08','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('release_owner_telegram_dispatch_v1(uuid)','738d649bd21bbfaee0e13fc8dac05bfa57150c1c01a2978e9d07a970bfedf733','7fe04b4be6dbf05fcda369b0948f2e82e9ed082427267c1fa2d8cd74e04ecc91','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,service_role=X/postgres}'),
('reorder_product_flavors_v1(uuid,uuid[])','31744ee1bcf6351b2951f9fc002a920247855a7373c85897cb99880ed0dd0f79','18d89f0d05d49c724132daa7f4be0752a7a9dfb92685fdeda71b05696a55692b','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('report_admin_runtime_incident(text,text)','9f11ea01c2ba80e401d586560d5a815a0f876f052563817581e65360c89a8c70','51b6a96d685e5b5b1ce658bb471fb4cabc92a178ab19069918af81698b2452f7','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('resolve_legacy_supplier_receipt_replay_v1(uuid)','77ad4281857c4c81c243e7cbcf39d59bb175a949749193e39aafcfc5c95a356d','09b34206e15baa17f54b97b5533c33a76e8eb91b9bca2efd389bbda6064a3731','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('return_completed_website_order(uuid,text,text,text,text,text)','44da87fe8f4e544aeeb378532dea4b3d0434f3d3ab3cc866ce9176e2201cd085','32a5a3e6c30173d0b99b45a147b32479a6f2b5baf9805039871f4c4a593db088','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('return_deferred_cheque_v1(uuid,integer,text,text)','33c9318864f02b3acda8425a9a0b43dacbc4d23fb80299c344b078cc912347d4','080eb2fa975ded431cc468189fd8c0a03ef810f73b76ed463edb88a914a3bb3b','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('reverse_cash_shift_with_operations(uuid,text,text)','a826e14e97b2ded136d2c5bb659fd7e1710553204d043b665580a6dd4a748347','669e91534d65d38f059ac36fb5343315d30d117a3db36b05859827704121d387','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('reverse_customer_collection_v1(uuid,text)','d1fd88f624fb7aa2578f2476e5e565c27dca3159a30d9d61d0f692d4a2161c65','6c7f4eef753e259de0de9a241d8c6b317198409390e4c7edb4dbe5f80377534d','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('reverse_customer_opening_balance_v1(uuid,text)','e6ad0cf7c14859d77695d58970e4ae4182d24c1f7664155e46a17203ea6c717e','11d4144be172b59f0490d89346388000b0a6d99977a15ddf8f79e0187f669448','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('reverse_customer_order_payment(uuid,text)','f06b4173f0842aebfba447139966291675c2f1178b2b34a4d8bd167e64151587','598289ba9e987983e3b9fa86277a4ed90dd985e50ddc542bdb1ebd63804f892c','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('reverse_operational_expense(uuid,text)','0c408c53d039354d5f83f886ce1e97ef5bab1f78509f64972b140d7510f21181','2d8f4ce2e840e6f6987fe852a7153b11262b28b1e282b89841b5c83326c253b3','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('reverse_owner_cash_withdrawal_v1(uuid,text,text)','56c3f35714fcc520dfe65a001dac02867faffa71bba4177b93fb3c97a123d742','0f48508effb7ddf32565fbe22777f4efd712638549571193a93f08fbf3314f2b','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('reverse_pos_sale(uuid,text,text)','9b515578dcfe825024e136d0f0759e8788b0062ad3a0f7bf62b73c0ba557fca2','b3eeb958419584ea10647f59a0b12e035960cb62388751f607e8d5f5d442a65c','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('reverse_supplier_cheque_claim_payment_v1(uuid,text,text)','86522da08b2924d11a28d082d36d1114614a82a455fe5cd5e3351031151cc796','d681fce19f231fa6179367a771ccb03b64c424ce1b19aed817da7d946d8c131a','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('reverse_supplier_opening_balance_v1(uuid,text)','4f8a6b4976092b4ae02e59a6fea8fa73ec384234532023ae95f6f82b46ee2778','953ef1736edb58ab48bdd61775e04d7688f3b4e81a370b41313f197b61d80235','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('reverse_supplier_payment(uuid,text,text)','318c4d5f5e3f6c8315b01325514adcb9df6c40ea1eac3ef0d1eb7f7fb7904b8c','0b266365c2dda508fa613e49e525c9f4dcc44e34f4629c89c2ed86280e5e84b1','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('run_advanced_monitoring_checks(timestamp with time zone)','2bac7bae15142912c7a2509f4ab95e68745bd3c4970c7d1a8f17894c67d45572','56b7e40391311f4d8ff8ff440d1405b34e2886716f57441104129bac819f6be2','postgres','["search_path=public, extensions, auth, cron, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('save_customer(text,text,uuid,text,text,text,text,text)','f9ec5164cc142625510a0923f1ad4884e580fe670f5e8ddca7cf6b6a9597b58a','e2c2a394b32876558f953bb3717d4a6242a48daafec0bdd9706d12523c33be9f','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('save_owner_warehouse_v1(uuid,text,text,uuid,boolean,timestamp with time zone)','b142743fe700304bfed0250e06783ffb73a9c7648485e175f5d2187807337629','04ba77a62a577982ed675a3cf881c3d8a7f7ddef5bbc48c012a4f253169b7301','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('save_product_brand(text,uuid,text,text)','4a5447bc4ffe07a17ad64bc2b9793f2da259e02c1fa15e8dc1371aa01818eaaa','5eba83fe4ac9348062684914fc94f17c0ec54edfe0a16bfa716e6d68b639efa0','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('save_product_category(text,uuid,text)','889200a99f2487bd6c997565eb6079b263e572a37108a1502fede52647cb0781','6c7cbb4018e6a851df50fb7de347a23703136d789e8f29308a22d2161e5c4d35','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('save_product_category(text,uuid,text,text)','24278d9a8d7f98bcc7b786e28648304e9846a32c52608872566bd34883044966','6ec1395a8568e7c77002a628b893b8dfe1afe938b0f239a12d392d7dbeeac67e','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('save_product_parcel_configuration_v1(uuid,text,boolean)','05780c7e6a5183cf3de9ddefa6199a8b4b12d5e0f79d4b59b7947595a680f419','60e8cdf16202ae350d36e99c0e995f12a6dd7ab452eb114c063b9f79252dcd5d','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('save_product_parcel_configuration_v1(uuid,text,boolean,integer,uuid[])','5dee6b99526d44d68f1ccf21e81679cb2645b2f0eb8736c7e5414b6c3e1f8721','ca8392dc293245cb27bf7c84d5556e381c70594a6a2c7282fe601bd9da9844c5','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('save_product_unit(text,text,integer,uuid)','d84f49c87dc48a15f66c272d774b11e96bf49351766a2879259ff54ad7ddba63','1fef4fa01891fc5d22adc5c9331ba1aa687a83c83cacbe450fcfe58ce6652ff1','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('save_push_subscription(text,text,text,text,text)','7ae68605d99cef899a87cf1fb9a1ba1dab428ca249c5476c169aa14716c4c4ed','d4533b80d9c207111093dc9946701fcfab21e79fccbf310dcba8ba5ffbdd7183','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('save_storefront_settings(text,text,text,boolean,text,text,text,text,text,bigint,bigint)','124270a34cf21154b66767cc1ccfbd745d393d982cdee821ea17205916b79a7b','5fa9e10e034b03429d1f7a1ec588a0f5769da9426114d4bc9667b3aa65fd9d4c','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('save_storefront_settings_v2(text,text,text,boolean,text,text,text,text,text,bigint,bigint,boolean,boolean,boolean,boolean)','fcf0254d190910a8cdca6c320f2718704cb53b12db7141f2fee41141da1447f9','e457d0447cc570331f9dc0589481ad0349cdc79f4d7398a657875e898e261c1d','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('save_storefront_settings_v3(text,text,text,boolean,text,text,text,text,text,bigint,bigint,bigint,boolean,boolean,boolean,boolean)','cfc00023d6423a303df210615b5a3f23d7b38a091f7afcb06477922e9dd72647','40e206fda128138826ee642fd946025477386d16134723477af319858ce82061','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('save_supplier(text,uuid,text,text,text,text,text,text,text,boolean)','3583c0dacefc6512fb05c015102e5c238cb1b202a88b9f500fb54080ef457558','7547e04d3f050e9c55ccba7bfe0a90705e0498bcd1872b74961c345668ac3ba3','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('scan_business_summaries(timestamp with time zone)','1a414c7d7bd6c9aec63b06b669c4f5ab54f42ddc24c1eb03bf6fd39ca0a922f1','7ce9f9fa12c9dc6be6de41c4de2e1a6623a644b6cd37b80c828038bd44a362ff','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,service_role=X/postgres}'),
('scan_core_business_alerts(timestamp with time zone,integer)','2986910529d790ef9c4b45d6a03ae1f180a3f9863b8c9f25ec6efbc3666b31dc','450d6a5c0e00e9b5d3458be63f5421a2430f8a589735cb4e7f1c7a91e9dc2efd','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('scan_deferred_cheque_alerts_internal(timestamp with time zone)','db8604e5daff8d8f7f6ede4ea0b803f34573c253db7f946eb42ff27e553a37b2','712abfcce274b1cac4af595fb6871f233d4675a6d35d4cd32fb7ab1aecd0e553','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('search_admin_products(text,integer,uuid,text,uuid)','f65e720ce861b64c8430b96c0acd5bf9ebe7c3b9af751ad98dfac2c4f057a95a','8377925c954cc6a7acae045e91129b67c63ac40a1557c24f54c1cb49fd05c501','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('set_configurable_parcel_feature_state_v1(text)','5ce5e879708a1d138f725514633206cc878b672614102a2c0b929063eef5d01c','8de587ad5d5590b25bd0142cb162fdcd035614b1373452be5b9445a1ef8433bc','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('set_customer_status(uuid,text)','0c7d7df34454dea4c66c9ea93cbb41eb7edfc2a00221a6c3bae0060661ee6192','8bf8ea184156398ae6b86727cee951ec6d16567792d841f75e6acd1c404b03c3','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('set_erp_staff_account_active(uuid,boolean)','c0e0ce1733a87a3dda0e97c2e69fd7624797eaf92d6b1fa1b98e44767d4b181e','1caf7977884e65414a5552b5ca50576e113d489821302854dbd2772108e17ebf','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('set_go_live_main_branch_v1(uuid)','ad5ec9f449c9224c8bbae25346c93950c04bb2353040e56158a162a9d8f02825','d8aa5575174e912bbd040d46904e62d94890e2675fc42c1a6be7a19ef2ec82b9','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('set_product_brand_active(uuid,boolean)','657b15a4e8e5e45b55c9b5f7ec051a6d8f92bfe4b6f99c2236d5005cb18f7857','ad688d56eb68ac0d64c1b29cde972e07c700c0b54271d10010cb0828535c23dd','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('set_product_category_active(uuid,boolean)','1fe7031df6d0afa088a99b87491455d65f4489f8ad446d12872262c7eb0877cd','cf0c484dd3ac6ca6bd068427f226ea1879f254ad0a152c4b38b96ad161aa807c','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('set_product_primary_image(uuid,text)','431c1f1e5a1a55f678cf399a9babf8c7f9ce89c44034a94f2c5c37469e8c7c93','56fca51453c8683640d5c51db0e25a7d6035b0255bea617a59ee644f738ae7ae','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('set_product_unit_active(uuid,boolean)','74ada397f61c847ea278abfd4da30411e51bad547addb08c3eac31660da9ec53','d66f08e9c5a1ae03d54039a19f73d37332c6e34e0d61caeac435412cd002de87','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('set_promotion_code_active(uuid,boolean)','9ed8fc53e471fc2731e56535cd046d75be79fe33562b8ec01afd468ecbd0869b','ad37377fc0e4522cc963720ecb935bdc61a2f9aa96405bbbbeb34ed50f270b62','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('set_supplier_active(uuid,boolean)','36cde3c25af7d01ddf0bca5bb337fb21b2ddaa521e7b3e3e4ff0adb40bf41e26','adfa2af00de5307c19d16bd8a21f8613c85c9faff24d5c524a449dfe18f227e7','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('set_website_new_order_reservation_expiry()','d591cef92aeb4b1c39d316290c4859a41f6104319a64f8e263aac693fba5ab2a','02239718c638951f4452508040dd94dbb840fab0db35ca69a87da6f35452eaeb','postgres','["search_path=public, pg_temp"]'::jsonb,NULL),
('settle_admin_sales_return_v1(uuid,text,jsonb,jsonb,text,text,text,text)','85d5030a09a2e11cda38ffa0a57906c023f6539f029c688f615e7c5b54447cbf','f64ce246a2569b01efcfb4e269f9b3c931e5b1fde31c131c35bc9a5b5bae34c0','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('settle_admin_sales_return_v2(jsonb,text,text)','7e2be38dd4d7f9b3c71b3a97a15742c3817797555011c4fcccf207d10abd2512','54d0f7b9b4bbc9c4c63cfbc59c2c130d3d69e13a9966d44491bd3bff743684d8','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('settle_inspected_sales_replacement_v2(jsonb,text,text)','363f317d05f78f6abaf1bc34a5da8c199d334cb687557efd03714605edd198d4','b5a12ca04499bb3b377409fee36bea5f501ab8c663180a9fd12f0afc457eb62c','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('settle_sales_exchange_v1(jsonb,text,text)','3ea84fffd95cfdf85296fe6a96cbdf1c9824f5f206e9f501283d07cdccf5af1e','7c6baac60326fa03e6b61d6e0d150c8da13d169813d1ad66e3a8cd4370fdd08b','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('settle_sales_replacement_v1(uuid,text,jsonb,text,text)','a09bf1895e7258ee9762a7bff22ec1f9d31cf55d99bfe9b28febede00a8b39d6','0147153ec01d3ab15fa2ec0616f6e90c3a88184606f6c4b48df97e02447d5de5','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('settle_sales_return_v1(uuid,text,jsonb,text,text,text,text)','5156beb699ecf463f4701c0e85369d3821565af135443bee484f3f8e6191d2ec','ebb42d6a6757af2fc16a1756f059b020e84846e348b0626f84d1100329903955','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('settle_supplier_replacement_credit_v1(text,jsonb,text,text)','bd31c35343941d044bb033d6eff54cf94358ed2eeab40b76a22e4ea66a661629','a8cac8c0f4b5d201243434582492c24a79976a29a55a50c48d9f9d68efb56acf','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('sr208_append_event_internal(uuid,uuid,text,integer,integer,bigint,integer,text,timestamp with time zone,uuid)','644693464c9cf4d1f6c1471ffb1e0969716673070b0ed0a1c3621f684e111f76','e13191c03f1725f2da7a01bcaadb0ca64c823bd3b2a053a393d28bc22d0e884d','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('sr208_assert_operation_internal(uuid)','b0c12958e6a660500a1ff4c34c0f5ae83197b729c33efd1ac0d3d5e33a759740','a50a47d4713d619b1a3e6f82921de022741e91fed2474996caf08c07e248de59','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('sr208_assert_role_internal(text)','1676c4821cbcc25eb536aeaa7b0497d12fdb05b00e13f819372b161baadf986f','2834b47aecc3ae57e4fe3f18aa3969b25a0fb9e3cde614e79457f784ef04d89b','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('sr208_case_dto_internal(uuid,boolean)','93c2c829262c21594ff71a5d37527900c6c628b6140114d0bded2814c26e3f32','0ec7d5e6b829613e7dc045825a14723d3accae1b1b66c83fdb80444fd129c634','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('sr208_inventory_fingerprint_internal(uuid)','738639368bf21345a31d75f9e1dceceffd6b1186fa2adee15ad4e0d242ea7e94','8f6fe5055901eebac36aca1942d4295b6b7bec0c94571c57b00ff375727aa8b9','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('sr208_operation_manifest_internal(uuid)','64120375c9c2dc6c88891bf8e5f9efddd9f76df24cfd56b9299bba5731bd2391','d20732682aa84861232be1eb7db9d02c6ebb96967c6a0e4e0f42134302442f01','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('sr211_assert_operation_before211_internal(uuid)','a4079a4581ee0b61377a042c87bc0cd3aa3aafd9ac530d3d87b919f014cd5970','d2acdd7199cf45736d54e57b785401e8604718cf845ede47958c2393cb17e2aa','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('sr211_blocked_internal(text,uuid)','2132a76a7ce557940b5d1d5da5c95ac9f369ed49cb95653ac2c9736021bbca46','243488b83ed3cb77c7de21ee6245b513f7eecd25a9859fa5903fd246667e1b56','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('sr211_links_manifest_internal(uuid)','11c42615db091bded2f02ba012b251eeedbd97d7860d523a50030c4daf4fe7d3','e64ca7fe7c4c17b519c6b45455a4854c706b0fe724a20b86f82e3315a91b3843','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('sr211_source_internal(text,uuid)','e912d1d4331ef060f9d230da412daf91a709ab138eacdd51393c417c03e7a9db','1359afd902989cfd2a106a8c0f899f310fe840dec6117639284b8cf00e730613','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('start_or_update_order_delivery(uuid,integer,text,text)','659df6bae74b26d7368482621af2088bde6232b54fe10e203359f5e8aca5aeac','2713df3d5ffed9d530115aa7ffbac547799c8f8a72580b8058c5dfe126c40478','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('submit_guest_customer_order(text,text,text,text,text,text,text,text,text,text,double precision,double precision,text,jsonb,text,text,text)','b6a8591355fe773ccbd5fe121e9c80cebf1a8b8e012b735f6d09b2fa06f903a4','ea25682ee36d8b6406a76ce8619c373baa70e1f82f22bc72b9f5ecb84081baac','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,service_role=X/postgres}'),
('submit_guest_customer_order_core(text,text,text,text,text,text,text,text,text,text,double precision,double precision,text,jsonb,text)','b6922259f90d354da873c852444b0366bb1ad4a388c0f3c478062f4508cf09f8','2c7987260937f5f505ec8c5302ff7a4f2cee04e838df2f051ed2f7c76ce563fa','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('submit_guest_customer_order_v2(text,text,text,text,text,text,text,text,text,text,text,text,double precision,double precision,text,jsonb,text,text,text,bigint,bigint,bigint,bigint)','0455e497326218665a4297300b00460a5e82bb7b98305abd856b9a9cb5d8753a','ad84680d7d3a7cd58e3c39f5116f63619063342699147a4edc686d96a3fe0ff9','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,service_role=X/postgres}'),
('sync_order_delivery_tracking_timestamps()','029241959aa6f87f62cee69a8ad8af9a265d95457aeb3e00aa79ede711822c9c','e00f152b2f157cbcd9d566224f377ea85234446d00f7aafc6ee17993830b0abc','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('sync_order_payment_state()','616a07a52476ed2aeb74e83e1348b102571cdc496a21c6cee890a463b3487d21','ef378bddb7318dcb1536a88fecb901d04882ffe819b3f043f34ce012c88f499b','postgres','["search_path=public, pg_temp"]'::jsonb,NULL),
('sync_product_flavor_commercial_settings()','6a1392aa7642732d070a316454115890e2a729fd42794a67793b68162898cc5a','aa30db3bddcfa62e8b806fa3861e2062069e1349c87f883973a372133270554c','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('sync_stock_alert(uuid,uuid,integer,integer)','00d37d1d88a24737c67a38362fed19af03ef327fdd02b71fe28f070b97fde0ea','d490cf6503ef7463da4df2fd38bf25fc6be48e2a4621f28013c31d8520d5cbb1','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('sync_stock_alert_from_balance()','4cc1cc81424fd3fd35bf11f866801c454caccf463572cc0d841b54614c90a3c8','1a8dbe0a4efcf8c4b4c4d15ffbb538ec8269d39fbdde77028e20bf4b4d2533f8','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('sync_stock_alert_from_product()','fbc126b6c712771fef1081cbfbb9037c20dd8b407a81ee5c5836f9df2dbda879','9e879ff17581b314f31b8320bc5ed70f67dca2d3ab28a9cd02534386eb66f2fd','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('tb215_active_exchange_internal()','31f8119aac66e6a6682b5846cbaa3de5d4db07e332bba5554b71ed6c980c99fe','2eb3458c6b38f6eb58d98694a887d9926a335c2f22917d286714cf03ece675c5','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('tb215_append_before215_internal(uuid,uuid,text,integer,integer,bigint,integer,text,timestamp with time zone,uuid)','6feae78b3a7aa7bab914a53f5c504e595000bcf51be51a28c685e7a732510278','947d4c8c84f9296ee5601d488fd32c541f504cbd8c73e709e1ce3d57e0e232a6','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('tb215_assert_exchange_internal(uuid)','7d52687d5562bcafc44b225a3078b07fdb1e3261201c5a951b549c9cce6e614a','60f10b689b75bff3c91e7c5d95d6d34233d79edf292bc21bcf6151935ecd0059','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('tb215_assert_exchange_pos_admission_internal(uuid,uuid,uuid,text,text,jsonb,bigint,bigint,text)','041827e69d271d7fba473b0cb567bc706bdb153d8e27828d4435d7d476473556','73d5d91b3628139cbc5a84c725547fcd1cf004f6bbe2badba8632a8a7effa955','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('tb215_assert_exchange_return_admission_internal(uuid,text,jsonb,text,text,text,text)','2b02fccb29da092c70c503a9ee2df77b6f156a7a8f571317fabd9af36c09d079','89b277e4778c15c1c57326b96273bfb67a806563a0593ab4bb39621009e5b9dd','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('tb215_assert_exchange_return_event_internal(uuid)','992ebaa3fec6e61f396ad2710caa15441d60c0254216a96dfe24dd31106cb454','493dc3a3f07ccd73c8e184011bd77c18e908170f7b8247f6c6dfe9214edb1ab5','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('tb215_assert_inspection_internal(uuid)','21ed00a80e91feaac1a95d8ac778edff3b69d45e46c704c5f702e4f02e269b65','f2f4fe0dc350bd3d2f3a8e16207c65d34c36d86e6354b65d2e47df94164ca5f3','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('tb215_assert_return_allocation_internal(jsonb,jsonb)','b1d560065c0c482da0c0ec0922e13a7015539f2d582bcbfd43e8777d46faee82','c263b6e7ff8866ca5242cd20d9218e062b0de2ae36a27249de561a405f88b997','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('tb215_assert_return_internal(uuid)','fcbab2586740f9679e442bcb3830b23de2e5670521e9fd04834c0106dc3fd991','f85b935a492726d4e778b6c303f6e8b2e3f7f5683390c38449acb8f0cf39f4c2','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('tb215_assert_supplier_credit_internal(uuid)','3b274a0da20d03433d7d066d946d861aa0df4e1455903f6bf8b394ed0f70848d','66c2c9a736f33b430cd7894e987d1945509e6cf1705f25b3e229fe7124e23bdd','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('tb215_blocked_before215_internal(text,uuid)','19fd1a289d7da59c99355222a924fdfede26075e53a47001e244c0345deeb49f','44211d9a9990e1453389456cabbb64e1243c26e1cac54310d268157904d636ec','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('tb215_canonical_exchange_internal(jsonb)','b3c29f7238f360ffe040ec2bff296096ace3bc54fcc883af601fad8b39c2874c','cdb40ac284a3b297b7c2b57fe2a5f888e95038e3c4c52b8aaa7f6aab629c06ff','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('tb215_canonical_inspection_internal(jsonb)','8e696da2044477481514241d2ead97f10d477ab4f40f476704789fd94126cef9','0bad76b3f61cc0992196638e2218f84214909f1b2811aa12f0ff86c7b3d1a160','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('tb215_canonical_return_internal(jsonb)','5d8a964a71207fcbab329e52cb76cb4bf5484b43ebf9153cc0aca6862c24c742','be2d7fbd6bcc6ca51bf052b17d2e56f88a0619f898af7b828a614a8de9a968df','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('tb215_case_dto_before215_internal(uuid,boolean)','820a2bea086ac08a63e8a670c220f8f44af8b60a937c31ce4338afe4be41dafd','be3320d6102585fcf9a3e0a6f63393e835ba409928afe319d988b1e79bc72978','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('tb215_completion_before_exchange_internal(uuid)','261917df721617996bedbe79601d6bf235a19c1ebd08854d40c7c5558efed610','96ac9857da53bc21af67666121e471b898f51b5b2c21f817d8d5250309cd220f','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('tb215_credit_plan_internal(text,jsonb)','73a100cfc45a64fcc9c2ee733792bd966125d5ab45384c6b60e60588de198c61','999cbf911188ae28d0c25ff6bed2716b1a7cc9a0bc4d2c0856cbe048fdbe600f','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('tb215_damage_candidates_before215_internal(uuid)','50738881026f236eb12f79d61a3cf39f9d9be72cd64a4baff94e48dbf888e26d','12b2af09c79974978a2fd2b02bb3740b6742a1ec25741a1d7cf1aea49dfe1b21','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('tb215_damage_case_roots_internal()','5b309438e0a73b0b13941f905341af0d6e83aa66d19ff98ed3d28a2630d8feee','d0c04f0cce2b205a10532dadad5c13540f7b0e548056d12991ef5e54a9230209','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('tb215_damage_case_states_internal()','7182c6f2ad933f3f904fa5a5ca2a9b4faa36d321efc9da48c7c939b975ccb4f9','287e357d05ee75bd8b4f70e8da812195826555cf101b80ea9231a4b1481f881e','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('tb215_damage_loss_presentation_internal(jsonb,uuid,timestamp with time zone,timestamp with time zone)','d672eee4606182930de8462a4775f61dd6b612c2cd61809c870e358d8de7d7f5','4e866f82df983c7c233fdafcf06fdae91df6ab20cf1e9d34b1f55f5c9a0f419b','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('tb215_damage_movements_internal()','f318ba647b3ea0b2556433c4124903cd4a912345e6c76daa41b9484735552957','653b0c7ef2af10cf8f66652b322e3e127a9230dbd5da420ed713629320709728','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('tb215_damage_nonnegative_quantity_internal(bigint)','87b7c97095ac9b2e98f0de5b0d2df97d384101f06ccdb8936ab16f534d87d843','a3fc0681f5b955f0c511ed944f3e717b3ca157d9e7eb390578464b6475caaf8f','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('tb215_damage_roots_internal()','c25a9e2d3bb4f6bd4df32070966b3a1ccee990e2027d3c08318ca0eab8fc71b2','a13b63737e572ecd4504afdfd9f0e6f7effdff35b18ef509fb0d321d820f1cdb','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('tb215_exchange_canonical_return_internal(uuid,jsonb,text,text,text,text)','48f0d5022a32f0969c65885d50bbf7ffd96f83a38ff9c58560c429a7ad7ecd45','aaf7b574d8c569921d9ad3cd5c431d347b417587e956dc1a06a9a2f0b1bbab97','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('tb215_exchange_completion_guard_internal()','88ef452d83257c10d303f1b9e04eac62a62ed9d4c5a71ea881ef5ba804e5696f','20c2f35c80afaa6fc6b2fec88593be336da1df13a18d72286679701d9f382fa1','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('tb215_exchange_finalize_internal(uuid)','9074b22b8f57171664e0cdd27baeb3d2233d992d94561f7eeabfc7bc3f7e4604','a4201d6b69f187d80896809c62ca22a449bb318b78a5738224be8c47cc2e9014','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('tb215_exchange_financial_adjustment_internal(jsonb,uuid,timestamp with time zone,timestamp with time zone,text,boolean)','f27a447dfaef6688710000e950d91085976dad06c4cbcc922e70fab740b44a7a','3f796d61951d14398f98671d2c71634a18a41b30b274576f0fd285cec9aa0991','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('tb215_exchange_manifest_internal(uuid)','ef2ed5022819e84961b9df045e51b08cee88665afe48ba61340eaaf0dd9ee18d','c62f49dd85a925f04b3147349c82a7e3110ae458ae4af315df85af25f7405bc9','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('tb215_exchange_pos_internal(uuid,uuid,uuid,text,text,jsonb,bigint,bigint,text)','cfeedd4af139142495d7971916ad4e6a3febf0151b97f0e2f1448f241ba4a399','4f4167c682f102ace1475dacf6bf748e619c51badd63d2eb5cccd60a0a81892e','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('tb215_exchange_public_result_internal(uuid)','943c4db5554f869b52950f350d3f85cf52e5a643cd21a98487a087ed3ae49375','4f4e4be69d6222fe7b680796692d67ec8325aabb0909521778a82ac8234bcbfd','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('tb215_exchange_return_internal(uuid,text,jsonb,text,text,text,text)','4457073ee85b4c474da79a1dd8b4b40ee547bab1d4fa696706d30c62dcef2820','b396449d41074ee441ce4faf0c23086cf51e6e8c00968d38877d031a12587971','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('tb215_finalize_before_exchange_internal(uuid)','d5837adcefb3333083d5d40a85c0b54086c1c13e85f4d8b685d6495651afea04','f567740fd652d1082bc47dc7aafc0109d450cc14149da51086cb630f5f5d7abb','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('tb215_financial_facts_before215_internal(uuid,timestamp with time zone,timestamp with time zone,text,boolean)','e737a6bd12ebcd1efc96d55e4da92afdc38fbd707d56a89d21e593d5e81c510f','df303df00e15e646a163f6b939ec2da6d177330d429b486ffdf991032b9d40c2','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('tb215_guard_exchange_return_insert_internal()','c254c251b7455d6e4df44ec23aeaee431fe80fec1d2009cd5cd9b1069d7eb9e9','3737db90241ddf1247791f1e624b7ef4c01294bf8d24ff879fc86315442c4244','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('tb215_guard_funded_pos_reversal_internal()','cde504e727aaed3203c2a6f951595cdbc3dcf24516ec33f724edeb80a3b84087','f8c2f942afacfd6893b1a46d46421f2032eaee9d9502571764421e90eb4bc24a','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('tb215_guard_return_context_internal()','4952023cc4037dc11d2aa45e5ba88e45d00289073c7e2afee8c05654087f23de','49b60deb55d6463b23fa81ddbcaa4bb19c3bcd33fb35c0f71bee5dbb35b9006e','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('tb215_hold_return_subset_internal(uuid,jsonb,text,text)','29efa331a62c8a02e2f10f9ecac5738c36c2fd7ebaa5e285480cf4c842e1437a','fdf886ff5f1d2036c58c381d91a0ea54d3a6f94111051cb5104846c915c692ba','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('tb215_inspection_manifest_internal(uuid)','9b34eb47875cc1cc6e16f0e270a77c66663b83ff479e692072f9298e91b8ffba','e1c1065241e208279b70a8b65bb68d2b3bd11fa4a38227bc4c945f5ecc86b1d5','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('tb215_inspection_public_result_internal(uuid)','8977ab93c685b5ae31452c4515fabbbff04df68afe5bc3bf17feadaf49f35aaa','eef7586392ed5c66cbfd852881b0e47c42f5e085738409e14b6c4f93486d53f5','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('tb215_prepare_exchange_internal(jsonb)','e44c4acfa963e80ec8da566f6541248b61180e2e93ca008c09942632a9d61e20','1ec0a91a448298a1fa86badd1fc1ba0ddb8a300b855335f5040be08f25084cc6','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('tb215_prepare_inspection_internal(jsonb)','70811d72bffd26efc983b551c612867e675fb32c1646f793376ce16ab1ab36db','4dec44a0c6d45378374d79b1f6d5bd6bc96111d16723ee7f591aa127aace2131','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('tb215_prepare_return_internal(jsonb)','c19780c53166a9b0090e1f32c8a1a373fcdd666d3fd4f99b1820da6cf3923df5','53299dd821272c07fdb0a7b931ff8b4dcdfa99205339bd9b2101fd13fbbeb352','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('tb215_read_sale_internal(uuid)','8353997612004e8853a357b64dd0860ff22f7759e2a88058fcc08e4afe2536c0','966b74f41485ecfddbf6cf739e814775eb141870c8edc7bc1e18f4a7d6c303c3','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('tb215_return_allocation_before215_internal(jsonb,jsonb)','1814affc9f8c244ca672831f30d3e25923d8b137b52b26ec767e4e9920ed8f3e','1dd08dd704f311f5f4469930ddff4978e5bf71fc89c5cbc62391b37a89b117b3','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('tb215_return_manifest_internal(uuid)','46ce199e8423663272bef18802a268dc928fb95150c571b6f495ddf3c9057a17','04e3e631364f4a76cb4546a174cd65c534317239aece3fbc7237c47c749bb730','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('tb215_return_public_result_internal(uuid)','6a9f16de84bf05e166a7834aaac1d03bfeb7e70e9ff1ab9abc5bdd207c22080b','9c78c5ec1f9f59b8ad685fef4a7fc8665fc2454241995d62e67176c714a92433','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('tb215_return_source_cost_internal(uuid,jsonb)','1cdb16403cdfd2622262130801144122c3ed722c7d7b057c0203b581d8cb41d0','019527939c3ea909781d723175e981941f3be5ac0bf1206b5de3242a3e2aa14b','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('tb215_shift_before_exchange_internal(uuid)','6860996ec2d5c11e676cb9050e0b978d8fb48d4a5e7c6270002eea410cebdc00','4b24923a36d6f9945a5001350b868a8b7b31738fc9eaba3cda443e70506176cc','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('tb215_source_before215_internal(text,uuid)','4dc8d45589880f8e6544b7228e1478c1a3d85645a58dc57b4adc8eabc2aa6d30','ccae03f7159103a797d766351a001282a8908b41af5dba7f3c799395f9b21f8a','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('tb215_supplier_balance_before215_internal()','f47d870ddb5b20d6654dfc2d779e050070eba29ab0b6777913f6f7cd1bc9ae8c','7592d9b548a93a5abd037e4fa86cbd1ba423d3496a8bd1947897454a02d5f157','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('tb215_supplier_evidence_before215_internal(uuid)','60c8d5ab141dbae4414e51074d742ed80fa184e629902298f569155ef12ee394','fe3714bdc0dcea1e101cd00bf26a6a30c1d648cc79ce2494ba2b0eee60938c7b','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('tb215_supplier_membership_internal(uuid)','46e5da7c1017c41dfaf57b1b03050ddee0e50e9ff4faafe829eeb019d81fc9b4','4dd55536a0665da5342f08d6a56c45af2f2ba1b3810c26f95d206df1853f140c','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('tb215_supplier_writer_before215_internal(text,jsonb,text)','4b1b91f84ab68e4d24ee2a8dd66081a893d73887e01938580dc7d3695dd7b534','a579dcdd61f5e6107f9f297e9f0aa263b305d2b0a2132fcec9bd74968a41a090','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('tb215_warranty_damage_facts_internal()','2ce228e7d713d5e9633bcd1d5e2fa7912c839fc755c2f88ab2e88ac5e22f782a','2b0d210417cdfb26283bb00401eed8a00d8ee60f360feaf524d22d5b5feda046','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('tc216_create_pos_sale_v2_internal(uuid,uuid,uuid,text,text,jsonb,bigint,bigint,text)','b8a24cdc7ba0dff956170c585ce3c6ea11724905955ede22f7dfcf369a13b858','8447d0d584edf7fd765a2dd761f5752d6fb2cfa22d4949c634b5749e36f7e310','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('tc216_get_public_pos_receipt_internal(uuid)','5ae1e79e2c17d4f8e0ff3e2d05f219cd60f9e59ac0507b7384f56b38a79b981e','056f6ac21b8de54654b4277394ef82e9a8d429398749059c5b5454c74ffaa0a2','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('tc216_reject_initial_payment_mutation_internal()','39d822c7228420a34d868c43c7d26146386bb31875ddc49fead55a749dd72d43','00b541a25520bc45a932f1de6c027b49da33e55b384772378c2797d51a9125af','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('track_guest_order(text,text)','d2b1915e40bcbed482904abc57d2a04391670d27b79e40ef8159276da3615a40','653cc758f0ed0a45c2223ceb855c43a0c732775795060fcf131599fb62707451','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres}'),
('track_guest_order_by_token(text)','8fd20ce17eef92e4fbb322f0e75926b255eefd57f76e3a683abe329ce4ee7406','597302bd3a0f8d74f537ec15fa277667df6867984e8aaf61c24a8c7c76ff31c7','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres}'),
('transfer_inventory_between_warehouses(uuid,uuid,uuid,integer,text,timestamp with time zone)','4ec6b53152098b1aceb686bea78f4ba7e43e61602f76c00299767fc7c78d0ff7','5974f1ef76bada533f8b2faac75e2294311c64c50db96637ee0af4e8a466d25b','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('trial212_cash_metadata_internal(text,uuid)','80b537f3e29e9e5d6c07be84c96c027a119eeb5950fe19b074391bd0a4bac1a3','71a2946a2aaf2a0acb5107140e9f3f1cf07950d779798d25eef06f35f7005636','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('update_erp_staff_account_record(uuid,text,text,text,uuid,text)','8cbe88f442698d0c08824e7aae4ad75efd89234688c233f2663f01c911191af7','b74ec45468aad36952391ca4436d5df932ee2fcfce036a24217db64ffd8d405d','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('update_my_erp_profile(text,text,text)','815038200657618cf84391d702872e2784c56b2e4dc25d6c32e649aacf1747fc','28b445f327026312d2d86567e65144ef8ba2a8fbc745581026034dd36d49a0ef','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('update_order_delivery_address(uuid,text,text,text,text,text,text,text,text,double precision,double precision,text,boolean)','d61db61ced35f217c42288dd74af50db768eccf8e1da947b008aaff6264733a7','70080516695ece5035884dba162b4fc2bec9ae4845a69abd317fa0634ffd7d50','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('update_order_status(uuid,text,text)','66b3a2d58defb3305973c08b8dced26b27d4417e312f21f1b4ddc47ea90b9a1a','06d91b63cd8f69202c821d89ab42c0070cdeb3d5cd002a4c2a2813682deac678','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('update_product_flavor_v1(uuid,text,text,text,boolean)','fc64b164a3308735f70d9ef7c02415c8b668f1846dde93f4b3aac3b5e8a478f4','ed7f92228e2d406483b1593e697a78fade86b53fb27d55f5bbbe50271a4500d2','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('update_product_flavor_v2(uuid,timestamp with time zone,text,text,text,boolean)','453796818f1e1e13e3221510f4d73d803a42bc92f9404ecdb57c4f2b478b50c4','1ed87cd60c79ff60ab75e4b99afb8c01956c4d1e3f000248f5204c7b0bf65bc6','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('update_product_master(uuid,text,text,text,text,uuid,uuid,uuid,uuid,integer,bigint,bigint,bigint,integer,integer,boolean,text)','c7dee424db3a3de3e30cba1579af4b533ffe04c1e95f33e3e257ae1d304fe8e8','bbd24aef65e24a1cd204b6cac13ddc5c0f1fbad4d557d78ade8347cf7df3304d','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('update_product_master_v2(uuid,text,text,text,text,uuid,uuid,uuid,uuid,integer,bigint,bigint,bigint,bigint,integer,integer,boolean,text)','5cb36ffffda9d11a0530af1c0caf2459c4297b266c92630da0c7ccfaa0fb2e29','dea2c8a40bd6a136ed28ce328a9a6d77bde33780b1a8cf3940c457f826f464b1','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('update_product_master_v3(uuid,text,text,text,text,uuid,uuid,uuid,uuid,integer,bigint,uuid,integer,bigint,bigint,integer,integer,boolean,text)','e82de71ca34ae776cbd199660f7e67f2b069ba746c4c978d110f3429108d25e1','d62a68f4a8413b2b180dd345ebd9f5486cf0d6ba66b873f26235bdeaa5b6cceb','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('update_product_master_v4(uuid,timestamp with time zone,text,text,text,text,uuid,uuid,uuid,uuid,integer,bigint,uuid,integer,bigint,bigint,integer,integer,boolean,text)','67a0f54e9017258e0b1bc73a296d1ba306874a2b3d6d7dfd1539fab402081df8','a1717a1a9b9d490b199eee85869f0832d58455f6fe84a0846ed4cca6293a916b','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('update_product_master_v5(uuid,timestamp with time zone,text,text,text,text,uuid,uuid,uuid,uuid,integer,bigint,uuid,integer,bigint,bigint,integer,integer,boolean,text,boolean)','b6c014849f6bd33a9b3675ff48b62fcb2c345b4a82d6ef2fb91955f6f8d8e811','81f843d10a62af139fcf1ba146858b993066460f8b5192a76d84df5159eba43b','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('update_purchase_order(uuid,uuid,uuid,uuid,timestamp with time zone,bigint,bigint,text,text,text,jsonb)','6835db30c65cb76571fd6bc95a499e7d247af5e0899ed308107e5a9c953bf3ae','1ff3d940e6f79a881a81b3da5225145d47cd0002ed83a991af459bcbae0e4407','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('update_purchase_order_status(uuid,text,text)','b7f7f93d7cf0d6e141833dcd449ce23d1acce0540c4a078389b483802bb6f43f','575ace19fe2d6fc4bf62a0359043c5d8b370db1bb6432fd39a4980df7e09cc6b','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('update_updated_at_column()','c10d3ecdb68d176c4ef7b01c3a1e54694ef57ab9c5da8db855e50997e3dfff31','f69d9dd30b32ff07c706e362229b68f7329064286569e841db54f5608ce6e7f3','postgres','["search_path=public"]'::jsonb,'{postgres=X/postgres}'),
('upsert_promotion_code(text,text,bigint,uuid,text,bigint,bigint,timestamp with time zone,timestamp with time zone,integer,integer,boolean,boolean)','3e14743e1edec986112042af54771c921e31da66596010d7838948c3465ee46e','23416cd9350a5c87ad1b7e6adb762d81f4f1f36d9d7ad67a1ec77ec18418966c','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres,authenticated=X/postgres}'),
('validate_customer_address_map_url()','e123aaf49a679986883946364e9281e5b743a0e016153068fe99c4637baf4432','682d5644b9ba4bb749bf82568279a9fe450afe88f4e862596d62f6951e5762d8','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('validate_inventory_movement_source_chain()','dff8781c1c88d507f18e9185610c0de39f148a90b81720aed9802c45e6b8a709','04bc75affc1ceaefbfca50e3f248aff0dac546a08b62bbe746d9ae3d919cd5a7','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('validate_order_inventory_reservation_chain()','cc3709c715347c0e90da36c887a4e169d8ec68b2716cffff4e6f4c0ca56dba74','e9b2d772a9b04be597ac8f1496d90db49922b3c98a89782724ef068c3c4b26f8','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('validate_order_parcel_component_family()','eba9241144588a2534994df23d7a847e93cc121443d4d88bce810b5116ea57dd','2ba769794462415449af00335e503fa71d5970282756c08b8e596181c3bc5d18','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('validate_order_parcel_instance_family()','ec166d06b92811aef9e1f96a727a1c6d9265d4806fd2e34066658a1bac2bb98f','7f2be369851af6ea905b8dc8d31448c7fe2444219e8ff65eaee671b0f4237493','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('validate_phase2_inventory_movement_source()','06fdeb01285f07b9312f981086dae8a707ac636238e0b9caa3be809e777beb94','9de89a57576b2df7c1da429c61d2333ef8549f568e5778a78fcd0046a1caf231','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('validate_product_parcel_configuration()','572984ff18abbb923f4fb835289dd6a7550886921a1395822c810dd320b24c4a','cfc590708513c292b32059a57cac56bb2f33e308a70731f8af71acf8b46c44d0','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('validate_purchase_order_component_family_v2()','b412fa9ae152b20bba1406c35ec7514333a5a74b0e8a1f7f17032b5ea370f372','c9c6577d64a045f4e95dd38460de402cae8d107948980037c62bc8b654abf252','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('validate_purchase_receipt_item_family_v2()','88aae725de38f4c0879cba69e85898547c87b7e8f85ed5ba6424718c125e5ed3','5845fc9a6f0e4c20bce090ceb6c7160542548a31989a7e29f4d6ce07bf83d51a','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('validate_sales_return_item_line_kind()','1ac71ad2059663f4df17c9e1bb218e6588a1a9f5e2f9fd342301cb19cda2956e','d931e5778c395622152e58365f2b381bb2bcd67dbf82197c03cc3893b9ba3804','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}'),
('validate_supplier_receipt_item_commercial_family()','83f006c212cd9b4cd95de9e635a16ee1466072abc981ff45b1fd6cab51ae1dc7','2924086f5d13101b412c091f05de8ab8974fbb778727505f52c363d3f84100ec','postgres','["search_path=public, pg_temp"]'::jsonb,'{postgres=X/postgres}')),
 frankfurt_acl(signature,acl) AS(VALUES
 ('enforce_customer_for_debt_order()','{=X/postgres,postgres=X/postgres}'),
 ('guard_cash_shift_closing_report_snapshot()','{=X/postgres,postgres=X/postgres}'),
 ('set_website_new_order_reservation_expiry()','{=X/postgres,postgres=X/postgres}'),
 ('sync_order_payment_state()','{=X/postgres,postgres=X/postgres}'))
 SELECT count(*) FILTER(WHERE p.oid IS NULL OR encode(pg_catalog.sha256(convert_to(p.prosrc,'UTF8')),'hex') IS DISTINCT FROM e.source_hash
 OR encode(pg_catalog.sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex') IS DISTINCT FROM e.definition_hash
 OR p.proowner::regrole::text IS DISTINCT FROM e.owner_name OR to_jsonb(p.proconfig) IS DISTINCT FROM NULLIF(e.config,'null'::jsonb)
 OR (p.proacl::text IS DISTINCT FROM e.acl AND p.proacl::text IS DISTINCT FROM COALESCE(f.acl,e.acl))),
 count(*) FILTER(WHERE f.signature IS NOT NULL AND p.proacl::text=f.acl)
 INTO mismatches,frankfurt_matches FROM expected e LEFT JOIN pg_proc p ON p.oid=to_regprocedure('public.'||e.signature)
 LEFT JOIN frankfurt_acl f ON f.signature=e.signature;
 IF mismatches<>0 OR frankfurt_matches NOT IN (0,4) OR frankfurt_matches::text IS DISTINCT FROM pg_catalog.current_setting('nawasrah.frozen220_acl_count',true)
 THEN RAISE EXCEPTION 'LITE220_FROZEN_AFTER_MISMATCH:% (Frankfurt ACL matches:%)',mismatches,frankfurt_matches;END IF;
 END $frozen220_after$;
COMMIT;
