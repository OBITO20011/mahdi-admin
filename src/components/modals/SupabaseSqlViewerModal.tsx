import React, { useState } from 'react';
import { Copy, Check, Database, ShieldAlert, Code2, Layers } from 'lucide-react';

const SQL_FILES = [
  {
    id: '001',
    name: '001_initial_schema.sql',
    title: '1. جداول الهيكل الأساسي (Schema)',
    desc: 'إنشاء 13 جدولاً بأسماء عربية وقيود UUID وفلس المبالغ والمستودعات',
    code: `-- =========================================================================
-- Nawasrah Business Manager - Supabase Migration 001: Initial Schema
-- Phase 1 Core Database Schema
-- =========================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. PROFILES
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  phone TEXT,
  avatar_url TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. ROLES & USER_ROLES
CREATE TABLE IF NOT EXISTS public.roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  name_ar TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uk_user_role UNIQUE (user_id, role_id)
);

-- 3. BRANCHES
CREATE TABLE IF NOT EXISTS public.branches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  name_ar TEXT NOT NULL,
  governorate TEXT,
  city TEXT,
  address TEXT,
  phone TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. WAREHOUSES
CREATE TABLE IF NOT EXISTS public.warehouses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID REFERENCES public.branches(id) ON DELETE SET NULL,
  code TEXT UNIQUE NOT NULL,
  name_ar TEXT NOT NULL,
  location TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. CATEGORIES & BRANDS & UNITS
CREATE TABLE IF NOT EXISTS public.categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE,
  name_ar TEXT NOT NULL,
  parent_id UUID REFERENCES public.categories(id) ON DELETE SET NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.brands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name_ar TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.units (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  name_ar TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. PRODUCTS
CREATE TABLE IF NOT EXISTS public.products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku TEXT UNIQUE NOT NULL,
  barcode TEXT,
  name_ar TEXT NOT NULL,
  description TEXT,
  category_id UUID REFERENCES public.categories(id) ON DELETE SET NULL,
  brand_id UUID REFERENCES public.brands(id) ON DELETE SET NULL,
  unit_id UUID REFERENCES public.units(id) ON DELETE SET NULL,
  cost_price_in_minor_units BIGINT NOT NULL DEFAULT 0 CHECK (cost_price_in_minor_units >= 0),
  sale_price_in_minor_units BIGINT NOT NULL DEFAULT 0 CHECK (sale_price_in_minor_units >= 0),
  min_stock_level INT NOT NULL DEFAULT 0 CHECK (min_stock_level >= 0),
  max_stock_level INT CHECK (max_stock_level IS NULL OR max_stock_level >= min_stock_level),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_products_barcode_unique 
ON public.products (barcode) 
WHERE barcode IS NOT NULL AND barcode <> '';

-- 7. PRODUCT_IMAGES
CREATE TABLE IF NOT EXISTS public.product_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  image_url TEXT NOT NULL,
  is_primary BOOLEAN NOT NULL DEFAULT false,
  display_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 8. INVENTORY_BALANCES
CREATE TABLE IF NOT EXISTS public.inventory_balances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  warehouse_id UUID NOT NULL REFERENCES public.warehouses(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  on_hand_quantity INT NOT NULL DEFAULT 0 CHECK (on_hand_quantity >= 0),
  reserved_quantity INT NOT NULL DEFAULT 0 CHECK (reserved_quantity >= 0),
  available_quantity INT GENERATED ALWAYS AS (on_hand_quantity - reserved_quantity) STORED CHECK (available_quantity >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uk_warehouse_product UNIQUE (warehouse_id, product_id)
);

-- 9. INVENTORY_MOVEMENTS
CREATE TABLE IF NOT EXISTS public.inventory_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  warehouse_id UUID NOT NULL REFERENCES public.warehouses(id) ON DELETE RESTRICT,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  movement_type TEXT NOT NULL CHECK (movement_type IN (
    'opening_balance',
    'purchase_receipt',
    'sales_deduction',
    'transfer_in',
    'transfer_out',
    'adjustment_add',
    'adjustment_subtract',
    'return_in',
    'return_out'
  )),
  quantity INT NOT NULL CHECK (quantity <> 0),
  balance_before INT NOT NULL CHECK (balance_before >= 0),
  balance_after INT NOT NULL CHECK (balance_after >= 0),
  reference_type TEXT,
  reference_id UUID,
  notes TEXT,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 10. AUDIT_LOGS
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_name TEXT NOT NULL,
  entity_id UUID,
  details JSONB,
  ip_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- INDEXES
CREATE INDEX IF NOT EXISTS idx_products_sku ON public.products(sku);
CREATE INDEX IF NOT EXISTS idx_products_category ON public.products(category_id);
CREATE INDEX IF NOT EXISTS idx_inventory_balances_wh_prod ON public.inventory_balances(warehouse_id, product_id);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_prod_wh ON public.inventory_movements(warehouse_id, product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON public.audit_logs(entity_name, entity_id);`,
  },
  {
    id: '002',
    name: '002_rls_policies.sql',
    title: '2. سياسات الحماية والتوفير (RLS)',
    desc: 'تفعيل RLS ومنع تعديل رصيد المخزون مباشرة من الواجهات الأمامية',
    code: `-- =========================================================================
-- Nawasrah Business Manager - Supabase Migration 002: RLS Policies
-- =========================================================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.warehouses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.units ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_authenticated()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN (auth.role() = 'authenticated');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE POLICY "Allow users to read all profiles" ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow users to update own profile" ON public.profiles FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());
CREATE POLICY "Allow authenticated users to read roles" ON public.roles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated users to read user roles" ON public.user_roles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated users to read branches" ON public.branches FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated users to read warehouses" ON public.warehouses FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated users to read categories" ON public.categories FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated users to read brands" ON public.brands FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated users to read units" ON public.units FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated users to read products" ON public.products FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated users to read product images" ON public.product_images FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated users to view inventory balances" ON public.inventory_balances FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated users to view inventory movements" ON public.inventory_movements FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated users to view audit logs" ON public.audit_logs FOR SELECT TO authenticated USING (true);`,
  },
  {
    id: '003',
    name: '003_inventory_functions.sql',
    title: '3. دوال العمليات الذرية (RPC Functions)',
    desc: 'دوال create_product_with_opening_stock و receive_inventory للتحكم الآمن',
    code: `-- =========================================================================
-- Nawasrah Business Manager - Supabase Migration 003: Inventory Functions
-- =========================================================================

CREATE OR REPLACE FUNCTION public.create_product_with_opening_stock(
  p_sku TEXT,
  p_barcode TEXT DEFAULT NULL,
  p_name_ar TEXT DEFAULT NULL,
  p_description TEXT DEFAULT NULL,
  p_category_id UUID DEFAULT NULL,
  p_brand_id UUID DEFAULT NULL,
  p_unit_id UUID DEFAULT NULL,
  p_cost_price_in_minor_units BIGINT DEFAULT 0,
  p_sale_price_in_minor_units BIGINT DEFAULT 0,
  p_min_stock_level INT DEFAULT 0,
  p_max_stock_level INT DEFAULT NULL,
  p_warehouse_id UUID DEFAULT NULL,
  p_opening_quantity INT DEFAULT 0,
  p_notes TEXT DEFAULT 'رصيد افتتاحي عند إضافة المنتج'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_product_id UUID;
  v_user_id UUID;
  v_result JSONB;
BEGIN
  v_user_id := auth.uid();

  IF p_sku IS NULL OR TRIM(p_sku) = '' THEN
    RAISE EXCEPTION 'رمز SKU مطلوب ولا يمكن أن يكون فارغاً.';
  END IF;

  IF p_name_ar IS NULL OR TRIM(p_name_ar) = '' THEN
    RAISE EXCEPTION 'اسم المنتج بالعربية مطلوب.';
  END IF;

  IF p_opening_quantity < 0 THEN
    RAISE EXCEPTION 'الكمية الافتتاحية لا يمكن أن تكون أقل من صفر.';
  END IF;

  INSERT INTO public.products (
    sku, barcode, name_ar, description, category_id, brand_id, unit_id,
    cost_price_in_minor_units, sale_price_in_minor_units, min_stock_level, max_stock_level
  ) VALUES (
    TRIM(p_sku), NULLIF(TRIM(p_barcode), ''), TRIM(p_name_ar), p_description, p_category_id, p_brand_id, p_unit_id,
    p_cost_price_in_minor_units, p_sale_price_in_minor_units, p_min_stock_level, p_max_stock_level
  ) RETURNING id INTO v_product_id;

  IF p_warehouse_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.warehouses WHERE id = p_warehouse_id) THEN
      RAISE EXCEPTION 'المستودع المالي المحدد غير موجود.';
    END IF;

    INSERT INTO public.inventory_balances (warehouse_id, product_id, on_hand_quantity, reserved_quantity)
    VALUES (p_warehouse_id, v_product_id, p_opening_quantity, 0);

    IF p_opening_quantity > 0 THEN
      INSERT INTO public.inventory_movements (
        warehouse_id, product_id, movement_type, quantity, balance_before, balance_after, notes, created_by
      ) VALUES (
        p_warehouse_id, v_product_id, 'opening_balance', p_opening_quantity, 0, p_opening_quantity,
        COALESCE(p_notes, 'رصيد افتتاحي عند إنشاء المنتج'), v_user_id
      );
    END IF;
  END IF;

  INSERT INTO public.audit_logs (user_id, action, entity_name, entity_id, details)
  VALUES (v_user_id, 'create_product_with_opening_stock', 'products', v_product_id,
    jsonb_build_object('sku', p_sku, 'name_ar', p_name_ar, 'warehouse_id', p_warehouse_id, 'opening_quantity', p_opening_quantity));

  RETURN jsonb_build_object('success', true, 'product_id', v_product_id, 'sku', p_sku, 'opening_quantity', p_opening_quantity);
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'فشلت عملية إنشاء المنتج والرصيد الافتتاحي: %', SQLERRM;
END;
$$;

CREATE OR REPLACE FUNCTION public.receive_inventory(
  p_warehouse_id UUID,
  p_product_id UUID,
  p_quantity INT,
  p_reference_type TEXT DEFAULT 'purchase_order',
  p_reference_id UUID DEFAULT NULL,
  p_notes TEXT DEFAULT 'استلام كميات جديدة للمخزن'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_current_on_hand INT := 0;
  v_new_on_hand INT := 0;
  v_user_id UUID;
BEGIN
  v_user_id := auth.uid();

  IF p_quantity <= 0 THEN RAISE EXCEPTION 'يجب أن تكون الكمية المستلمة أكبر من صفر.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.warehouses WHERE id = p_warehouse_id) THEN RAISE EXCEPTION 'المستودع المحدد غير موجود.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.products WHERE id = p_product_id) THEN RAISE EXCEPTION 'المنتج المحدد غير موجود.'; END IF;

  SELECT on_hand_quantity INTO v_current_on_hand
  FROM public.inventory_balances
  WHERE warehouse_id = p_warehouse_id AND product_id = p_product_id
  FOR UPDATE;

  IF NOT FOUND THEN
    v_current_on_hand := 0;
    v_new_on_hand := p_quantity;
    INSERT INTO public.inventory_balances (warehouse_id, product_id, on_hand_quantity, reserved_quantity)
    VALUES (p_warehouse_id, p_product_id, v_new_on_hand, 0);
  ELSE
    v_new_on_hand := v_current_on_hand + p_quantity;
    UPDATE public.inventory_balances SET on_hand_quantity = v_new_on_hand, updated_at = NOW()
    WHERE warehouse_id = p_warehouse_id AND product_id = p_product_id;
  END IF;

  INSERT INTO public.inventory_movements (
    warehouse_id, product_id, movement_type, quantity, balance_before, balance_after, reference_type, reference_id, notes, created_by
  ) VALUES (
    p_warehouse_id, p_product_id, 'purchase_receipt', p_quantity, v_current_on_hand, v_new_on_hand, p_reference_type, p_reference_id, p_notes, v_user_id
  );

  INSERT INTO public.audit_logs (user_id, action, entity_name, entity_id, details)
  VALUES (v_user_id, 'receive_inventory', 'inventory_balances', p_product_id,
    jsonb_build_object('warehouse_id', p_warehouse_id, 'received_quantity', p_quantity, 'previous_balance', v_current_on_hand, 'new_balance', v_new_on_hand));

  RETURN jsonb_build_object('success', true, 'warehouse_id', p_warehouse_id, 'product_id', p_product_id, 'balance_after', v_new_on_hand);
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'فشلت عملية استلام وتزويد المخزون: %', SQLERRM;
END;
$$;`,
  },
  {
    id: 'seed',
    name: 'seed.sql',
    title: '4. بيانات التأسيس الأولية (Seed Data)',
    desc: 'الفرع الرئيسي والمستودع والأقسام والوحدات والأدوار',
    code: `-- =========================================================================
-- Nawasrah Business Manager - Supabase Seed Data
-- =========================================================================

INSERT INTO public.roles (code, name_ar, description) VALUES
  ('admin', 'مدير النظام الكامل', 'صلاحيات كاملة للتحكم بالنظام وإدارة الفروع والمستخدمين'),
  ('manager', 'مدير الفرع', 'إدارة العمليات والطلبات والمخزون على مستوى الفرع والمستودع'),
  ('accountant', 'المحاسب المالي', 'إدارة الفواتير والمدفوعات والمستحقات وسندات القبض والدفع'),
  ('sales', 'مبيعات / موظف طلبات', 'إنشاء الطلبات وإدارة المبيعات والتواصل مع العملاء'),
  ('warehouse_keeper', 'أمين المستودع', 'إدارة حركة الاستلام والتصريف وحرد المخزون والتحويلات'),
  ('delivery_driver', 'سائق / مندوب توصيل', 'توصيل الطلبات للعملاء وتحديث حالة التسليم والموقع')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.branches (code, name_ar, governorate, city, address, phone, is_active) VALUES
  ('BR-AMMAN-01', 'فرع عمان الرئيسي', 'عمان', 'خلدا', 'شارع الملك عبدالله الثاني، مجمع النواصرة التجاري', '065551234', true)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.warehouses (branch_id, code, name_ar, location, is_active)
SELECT id, 'WH-MAIN-01', 'المستودع المركزي الرئيسي', 'عمان - خلدا - المبنى الرئيسي الطابق السفلي', true
FROM public.branches WHERE code = 'BR-AMMAN-01'
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.categories (code, name_ar, is_active) VALUES
  ('CAT-CHOCO', 'شوكولاتة', true),
  ('CAT-CHIPS', 'شيبس وتسالي', true),
  ('CAT-BEV', 'مشروبات وعصائر', true),
  ('CAT-BISCUIT', 'بسكويت وويفر', true)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.units (code, name_ar) VALUES
  ('PCS', 'قطعة'), ('PKT', 'باكيت'), ('CTN', 'كرتونة')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.brands (name_ar, description) VALUES
  ('نواصرة فاخر', 'منتجات نواصرة الحصرية عالية الجودة'),
  ('جواهر الشام', 'حلويات ومكسرات ضيافة عالية الجودة'),
  ('الروضة الممتازة', 'منتجات غذائية واستهلاكية مختارة')
ON CONFLICT DO NOTHING;`,
  },
];

export const SupabaseSqlViewerModal: React.FC = () => {
  const [activeTab, setActiveTab] = useState<string>('001');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const selectedFile = SQL_FILES.find((f) => f.id === activeTab) || SQL_FILES[0];

  const handleCopy = (code: string, id: string) => {
    navigator.clipboard.writeText(code);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className="space-y-4 text-xs">
      <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-3 text-amber-300 flex items-start gap-2.5">
        <ShieldAlert className="w-4 h-4 shrink-0 text-amber-400 mt-0.5" />
        <div className="space-y-1 text-[11px] leading-relaxed">
          <p className="font-bold text-amber-200">تعليمات التشغيل والتطبيق على Supabase:</p>
          <p>
            متاح لك نسخ كل ملف بالضغط على زر النسخ وتلصيقه في <strong>Supabase Dashboard → SQL Editor</strong> حسب الترتيب أدناه:
          </p>
        </div>
      </div>

      {/* File Navigation Tabs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 bg-slate-950/80 p-1.5 rounded-2xl border border-slate-800">
        {SQL_FILES.map((file) => (
          <button
            key={file.id}
            onClick={() => setActiveTab(file.id)}
            className={`p-2 rounded-xl font-bold text-[11px] transition text-right flex flex-col gap-0.5 ${
              activeTab === file.id
                ? 'bg-blue-600 text-white shadow-lg'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
            }`}
          >
            <span className="text-[9px] opacity-80">{file.name}</span>
            <span className="truncate">{file.title.split(' ')[1]}</span>
          </button>
        ))}
      </div>

      {/* Active File Info & Copy Button */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3 space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="font-black text-slate-100 text-xs flex items-center gap-1.5">
              <Code2 className="w-3.5 h-3.5 text-blue-400" />
              <span>{selectedFile.title}</span>
            </h4>
            <p className="text-[10px] text-slate-400 mt-0.5">{selectedFile.desc}</p>
          </div>
          <button
            onClick={() => handleCopy(selectedFile.code, selectedFile.id)}
            className={`px-3 py-1.5 rounded-xl font-bold text-[11px] flex items-center gap-1.5 transition border ${
              copiedId === selectedFile.id
                ? 'bg-emerald-600 text-white border-emerald-500'
                : 'bg-blue-600 hover:bg-blue-500 text-white border-blue-500 shadow'
            }`}
          >
            {copiedId === selectedFile.id ? (
              <>
                <Check className="w-3.5 h-3.5" />
                <span>تم النسخ!</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                <span>نسخ هذا الملف</span>
              </>
            )}
          </button>
        </div>

        {/* Code Output Box */}
        <div className="relative">
          <pre className="bg-slate-950 p-3 rounded-xl border border-slate-800 font-mono text-[10px] text-emerald-400 max-h-64 overflow-y-auto leading-relaxed dir-ltr select-all whitespace-pre-wrap break-all">
            {selectedFile.code}
          </pre>
        </div>
      </div>
    </div>
  );
};
