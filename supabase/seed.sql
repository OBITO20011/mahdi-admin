-- =========================================================================
-- Nawasrah Business Manager - Supabase Seed Data
-- Initial Master Data for Testing & Setup
-- =========================================================================

-- 1. ROLES
INSERT INTO public.roles (code, name_ar, description) VALUES
  ('admin', 'مدير النظام الكامل', 'صلاحيات كاملة للتحكم بالنظام وإدارة الفروع والمستخدمين'),
  ('manager', 'مدير الفرع', 'إدارة العمليات والطلبات والمخزون على مستوى الفرع والمستودع'),
  ('accountant', 'المحاسب المالي', 'إدارة الفواتير والمدفوعات والمستحقات وسندات القبض والدفع'),
  ('sales', 'مبيعات / موظف طلبات', 'إنشاء الطلبات وإدارة المبيعات والتواصل مع العملاء'),
  ('warehouse_keeper', 'أمين المستودع', 'إدارة حركة الاستلام والتصريف وحرد المخزون والتحويلات'),
  ('delivery_driver', 'سائق / مندوب توصيل', 'توصيل الطلبات للعملاء وتحديث حالة التسليم والموقع')
ON CONFLICT (code) DO NOTHING;

-- 2. MAIN BRANCH
INSERT INTO public.branches (code, name_ar, governorate, city, address, phone, is_active) VALUES
  ('BR-AMMAN-01', 'فرع عمان الرئيسي', 'عمان', 'خلدا', 'شارع الملك عبدالله الثاني، مجمع النواصرة التجاري', '065551234', true)
ON CONFLICT (code) DO NOTHING;

-- 3. MAIN WAREHOUSE
INSERT INTO public.warehouses (branch_id, code, name_ar, location, is_active)
SELECT 
  id, 
  'WH-MAIN-01', 
  'المستودع المركزي الرئيسي', 
  'عمان - خلدا - المبنى الرئيسي الطابق السفلي', 
  true
FROM public.branches 
WHERE code = 'BR-AMMAN-01'
ON CONFLICT (code) DO NOTHING;

-- 4. CATEGORIES (أقسام: شوكولاتة، شيبس، مشروبات، بسكويت)
INSERT INTO public.categories (code, name_ar, is_active) VALUES
  ('CAT-CHOCO', 'شوكولاتة', true),
  ('CAT-CHIPS', 'شيبس وتسالي', true),
  ('CAT-BEV', 'مشروبات وعصائر', true),
  ('CAT-BISCUIT', 'بسكويت وويفر', true)
ON CONFLICT (code) DO NOTHING;

-- 5. UNITS (وحدات: قطعة، باكيت، كرتونة)
INSERT INTO public.units (code, name_ar) VALUES
  ('PCS', 'قطعة'),
  ('PKT', 'باكيت'),
  ('CTN', 'كرتونة')
ON CONFLICT (code) DO NOTHING;

-- 6. BRANDS (علامات تجارية تجريبية)
INSERT INTO public.brands (name_ar, description) VALUES
  ('نواصرة فاخر', 'منتجات نواصرة الحصرية عالية الجودة'),
  ('جواهر الشام', 'حلويات ومكسرات ضيافة عالية الجودة'),
  ('الروضة الممتازة', 'منتجات غذائية واستهلاكية مختارة')
ON CONFLICT DO NOTHING;
