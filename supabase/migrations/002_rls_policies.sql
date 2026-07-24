-- =========================================================================
-- Nawasrah Business Manager - Supabase Migration 002: RLS Policies
-- Row Level Security for Phase 1 Tables
-- =========================================================================

-- Enable Row Level Security (RLS) on all Phase 1 tables
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

-- -------------------------------------------------------------------------
-- Helper Functions for RBAC RLS
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_authenticated()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN (auth.role() = 'authenticated');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.has_role(required_role TEXT)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 
    FROM public.user_roles ur
    JOIN public.roles r ON ur.role_id = r.id
    WHERE ur.user_id = auth.uid() AND r.code = required_role
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- -------------------------------------------------------------------------
-- 1. PROFILES POLICIES
-- -------------------------------------------------------------------------
CREATE POLICY "Allow users to read all profiles"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Allow users to update own profile"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- -------------------------------------------------------------------------
-- 2. ROLES & USER_ROLES POLICIES
-- -------------------------------------------------------------------------
CREATE POLICY "Allow authenticated users to read roles"
  ON public.roles FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Allow authenticated users to read user roles"
  ON public.user_roles FOR SELECT
  TO authenticated
  USING (true);

-- -------------------------------------------------------------------------
-- 3. BRANCHES & WAREHOUSES POLICIES
-- -------------------------------------------------------------------------
CREATE POLICY "Allow authenticated users to read branches"
  ON public.branches FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Allow authenticated users to read warehouses"
  ON public.warehouses FOR SELECT
  TO authenticated
  USING (true);

-- -------------------------------------------------------------------------
-- 4. CATEGORIES, BRANDS, UNITS POLICIES
-- -------------------------------------------------------------------------
CREATE POLICY "Allow authenticated users to read categories"
  ON public.categories FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Allow authenticated users to read brands"
  ON public.brands FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Allow authenticated users to read units"
  ON public.units FOR SELECT
  TO authenticated
  USING (true);

-- -------------------------------------------------------------------------
-- 5. PRODUCTS & PRODUCT_IMAGES POLICIES
-- -------------------------------------------------------------------------
CREATE POLICY "Allow authenticated users to read products"
  ON public.products FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Allow authenticated users to read product images"
  ON public.product_images FOR SELECT
  TO authenticated
  USING (true);

-- -------------------------------------------------------------------------
-- 6. INVENTORY_BALANCES POLICIES
-- STRICT MANDATE: Direct INSERT, UPDATE, DELETE from client is BLOCKED.
-- Mutations MUST be executed via SECURITY DEFINER RPC functions.
-- -------------------------------------------------------------------------
CREATE POLICY "Allow authenticated users to view inventory balances"
  ON public.inventory_balances FOR SELECT
  TO authenticated
  USING (true);

-- Explicitly NO INSERT, UPDATE, or DELETE policies for public/authenticated client operations on inventory_balances.
-- Only Security Definer RPC functions or service role can mutate inventory_balances.

-- -------------------------------------------------------------------------
-- 7. INVENTORY_MOVEMENTS POLICIES
-- Direct INSERT, UPDATE, DELETE from client is BLOCKED.
-- -------------------------------------------------------------------------
CREATE POLICY "Allow authenticated users to view inventory movements"
  ON public.inventory_movements FOR SELECT
  TO authenticated
  USING (true);

-- -------------------------------------------------------------------------
-- 8. AUDIT_LOGS POLICIES
-- -------------------------------------------------------------------------
CREATE POLICY "Allow authenticated users to view audit logs"
  ON public.audit_logs FOR SELECT
  TO authenticated
  USING (true);
