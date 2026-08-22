-- Nawasrah ERP
-- Align the active branch and receiving warehouse with the real Ramtha location.
-- Idempotent: the migration can be rerun after either the old or new codes exist.

UPDATE public.branches
SET
  code = 'BR-RAMTHA-01',
  name_ar = 'محلات النواصرة - الرمثا',
  governorate = 'إربد',
  city = 'الرمثا',
  address = 'الرمثا - محلات النواصرة',
  updated_at = NOW()
WHERE code IN ('BR-AMMAN-01', 'BR-RAMTHA-01');

UPDATE public.warehouses
SET
  code = 'WH-RAMTHA-01',
  name_ar = 'مستودع محلات النواصرة - الرمثا',
  location = 'الرمثا - محلات النواصرة',
  updated_at = NOW()
WHERE code IN ('WH-MAIN-01', 'WH-RAMTHA-01');
