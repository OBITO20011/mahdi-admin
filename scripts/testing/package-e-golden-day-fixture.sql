-- Catalog/identity setup only. Inventory and money start at zero and are
-- acquired through the supported public operational RPCs in the runner.
INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
VALUES('92600000-0000-4000-8000-000000000001','authenticated','authenticated','golden-owner@example.test',NOW(),'{}','{}');
INSERT INTO profiles(id,full_name,is_active) VALUES('92600000-0000-4000-8000-000000000001','مالك يوم الاختبار',true);
INSERT INTO roles(code,name_ar) VALUES('owner','مالك النظام') ON CONFLICT(code) DO NOTHING;
INSERT INTO user_roles(user_id,role_id) SELECT '92600000-0000-4000-8000-000000000001',id FROM roles WHERE code='owner';
INSERT INTO units(id,code,name_ar) VALUES('92600000-0000-4000-8000-000000000010','E-PACKET','باكيت');
INSERT INTO categories(id,code,name_ar,is_active) VALUES('92600000-0000-4000-8000-000000000011','E-GOLDEN','اختبار اليوم',true);
INSERT INTO branches(id,code,name_ar,is_active) VALUES('92600000-0000-4000-8000-000000000200','E-GOLDEN','فرع اليوم الكامل',true);
INSERT INTO warehouses(id,branch_id,code,name_ar,is_active,created_at)
VALUES('92600000-0000-4000-8000-000000000201','92600000-0000-4000-8000-000000000200','E-GOLDEN','مستودع اليوم',true,'1900-01-01');
INSERT INTO products(id,sku,name_ar,category_id,unit_id,purchase_unit_id,sale_unit_id,
  units_per_purchase_unit,units_per_sale_unit,default_purchase_price_in_minor_units,
  default_sale_price_in_minor_units,cost_price_in_minor_units,sale_price_in_minor_units,
  wholesale_price_in_minor_units,min_stock_level,is_active,is_flavor_master,wac_cost_in_minor_units_exact)
VALUES
('92600000-0000-4000-8000-000000000100','E-FAMILY','طرد اليوم',
 '92600000-0000-4000-8000-000000000011','92600000-0000-4000-8000-000000000010',
 '92600000-0000-4000-8000-000000000010','92600000-0000-4000-8000-000000000010',5,5,0,5000,0,1000,5000,0,true,true,0),
('92600000-0000-4000-8000-000000000103','E-CARTON','صنف الكرتونة',
 '92600000-0000-4000-8000-000000000011','92600000-0000-4000-8000-000000000010',
 '92600000-0000-4000-8000-000000000010','92600000-0000-4000-8000-000000000010',5,5,0,4500,0,1000,4500,0,true,false,0);
INSERT INTO products(id,sku,name_ar,category_id,flavor_master_product_id,flavor_name_ar,min_stock_level,is_active)
VALUES
('92600000-0000-4000-8000-000000000101','E-A','نكهة أ','92600000-0000-4000-8000-000000000011','92600000-0000-4000-8000-000000000100','أ',0,true),
('92600000-0000-4000-8000-000000000102','E-B','نكهة ب','92600000-0000-4000-8000-000000000011','92600000-0000-4000-8000-000000000100','ب',0,true);
UPDATE products SET unit_id='92600000-0000-4000-8000-000000000010',
  purchase_unit_id='92600000-0000-4000-8000-000000000010',sale_unit_id='92600000-0000-4000-8000-000000000010',
  units_per_purchase_unit=1,units_per_sale_unit=1,default_purchase_price_in_minor_units=0,
  default_sale_price_in_minor_units=1000,sale_price_in_minor_units=1000,wholesale_price_in_minor_units=1000,
  cost_price_in_minor_units=0,wac_cost_in_minor_units_exact=0
WHERE id IN('92600000-0000-4000-8000-000000000101','92600000-0000-4000-8000-000000000102');
INSERT INTO customers(id,full_name,phone,credit_limit_in_minor_units) VALUES
('92600000-0000-4000-8000-000000000401','عميل الدين','0796600401',1000000),
('92600000-0000-4000-8000-000000000402','عميل المدفوع','0796600402',1000000),
('92600000-0000-4000-8000-000000000403','عميل الخصم','0796600403',1000000);
INSERT INTO suppliers(id,company_name,is_active) VALUES
('92600000-0000-4000-8000-000000000301','مورد الاستلام المباشر',true),
('92600000-0000-4000-8000-000000000302','مورد PO',true);
UPDATE storefront_settings SET orders_enabled=true,minimum_order_in_minor_units=0,
  inside_ramtha_delivery_fee_in_minor_units=1000,outside_ramtha_delivery_fee_in_minor_units=1000;
-- Disable only the isolated background sampler: explicit samples are measured
-- after each scenario, so a cron tick cannot race the test's evidence.
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname='run-advanced-monitoring';
