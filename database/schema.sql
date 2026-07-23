-- ====================================================================
-- Nawasrah Business Manager - Complete Supabase PostgreSQL Schema
-- ====================================================================

-- 1. EXTENSIONS
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. BRANCHES & WAREHOUSES
CREATE TABLE IF NOT EXISTS branches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  city TEXT NOT NULL DEFAULT 'Amman',
  phone TEXT NOT NULL,
  is_main BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS warehouses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  branch_id UUID REFERENCES branches(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  location TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. CATEGORIES, BRANDS & UNITS
CREATE TABLE IF NOT EXISTS categories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name_ar TEXT NOT NULL,
  name_en TEXT,
  icon TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS brands (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name_ar TEXT NOT NULL,
  logo_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. PRODUCTS & INVENTORY BALANCES
CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sku TEXT UNIQUE NOT NULL,
  barcode TEXT UNIQUE NOT NULL,
  name_ar TEXT NOT NULL,
  name_en TEXT,
  description TEXT,
  image_url TEXT,
  category_id UUID REFERENCES categories(id),
  brand_id UUID REFERENCES brands(id),
  cost_price NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
  retail_price NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
  wholesale_price NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
  tax_rate NUMERIC(5, 2) DEFAULT 16.00,
  unit TEXT NOT NULL DEFAULT 'قطعة',
  packet_size INT DEFAULT 1,
  carton_size INT DEFAULT 12,
  on_hand_quantity INT NOT NULL DEFAULT 0 CHECK (on_hand_quantity >= 0),
  reserved_quantity INT NOT NULL DEFAULT 0 CHECK (reserved_quantity >= 0),
  reorder_level INT NOT NULL DEFAULT 5,
  expiry_date DATE,
  batch_number TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. INVENTORY MOVEMENTS (AUDIT TRAIL)
CREATE TABLE IF NOT EXISTS inventory_movements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id UUID REFERENCES products(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES branches(id),
  movement_type TEXT NOT NULL,
  previous_quantity INT NOT NULL,
  quantity_change INT NOT NULL,
  new_quantity INT NOT NULL,
  reason TEXT,
  performed_by_user_id UUID,
  reference_id TEXT,
  timestamp TIMESTAMPTZ DEFAULT NOW()
);

-- 6. CUSTOMERS & SUPPLIERS
CREATE TABLE IF NOT EXISTS customers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  whatsapp TEXT,
  address TEXT NOT NULL,
  governorate TEXT NOT NULL DEFAULT 'عمان',
  customer_type TEXT DEFAULT 'retail',
  credit_limit NUMERIC(12, 2) DEFAULT 0.00,
  payment_term_days INT DEFAULT 30,
  current_balance NUMERIC(12, 2) DEFAULT 0.00,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS suppliers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_name TEXT NOT NULL,
  contact_person TEXT,
  phone TEXT NOT NULL,
  address TEXT,
  current_balance NUMERIC(12, 2) DEFAULT 0.00,
  tax_number TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. ORDERS & ITEMS
CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_number TEXT UNIQUE NOT NULL,
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  governorate TEXT NOT NULL,
  region TEXT NOT NULL,
  address TEXT NOT NULL,
  map_url TEXT,
  subtotal NUMERIC(12, 2) NOT NULL,
  discount NUMERIC(12, 2) DEFAULT 0.00,
  delivery_fee NUMERIC(12, 2) DEFAULT 0.00,
  total_amount NUMERIC(12, 2) NOT NULL,
  payment_method TEXT NOT NULL,
  payment_status TEXT NOT NULL DEFAULT 'unpaid',
  status TEXT NOT NULL DEFAULT 'new',
  branch_id UUID REFERENCES branches(id),
  idempotency_key UUID UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS order_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id),
  product_name TEXT NOT NULL,
  unit_price NUMERIC(12, 2) NOT NULL,
  cost_price NUMERIC(12, 2) NOT NULL,
  quantity INT NOT NULL CHECK (quantity > 0),
  total_price NUMERIC(12, 2) NOT NULL
);

-- 8. EXPENSES, SHIFTS & PAYMENTS
CREATE TABLE IF NOT EXISTS expenses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  expense_number TEXT UNIQUE NOT NULL,
  category TEXT NOT NULL,
  amount NUMERIC(12, 2) NOT NULL,
  payment_method TEXT NOT NULL,
  description TEXT,
  receipt_image_url TEXT,
  is_approved BOOLEAN DEFAULT TRUE,
  branch_id UUID REFERENCES branches(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS shifts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  shift_number TEXT UNIQUE NOT NULL,
  branch_id UUID REFERENCES branches(id),
  cashier_name TEXT NOT NULL,
  opening_cash NUMERIC(12, 2) NOT NULL,
  expected_cash NUMERIC(12, 2) DEFAULT 0.00,
  actual_cash NUMERIC(12, 2),
  cash_discrepancy NUMERIC(12, 2),
  discrepancy_reason TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  start_time TIMESTAMPTZ DEFAULT NOW(),
  end_time TIMESTAMPTZ
);
