# DATABASE_DESIGN.md - Nawasrah Business Manager Database Schema & Relational Design

## 🗄️ تصميم قاعدة البيانات والجداول (Supabase PostgreSQL)

تم تصميم قاعدة البيانات لدعم المعاملات التزSynchronous مع الحفاظ على سلامة البيانات الذرية وضمان عدم حدوث حجز مضاعف للمخزون (Double Booking) في أوقات الذروة.

---

## 📋 الجداول الرئيسية (Core Tables)

### 1. `branches` & `warehouses`
- **branches**: `id`, `name`, `address`, `city`, `phone`, `is_main`, `created_at`
- **warehouses**: `id`, `branch_id`, `name`, `location`

### 2. `categories`, `brands`, `products`
- **products**:
  - `id` (UUID PK)
  - `sku` (UNIQUE), `barcode` (UNIQUE)
  - `name_ar`, `name_en`, `description`, `image_url`
  - `cost_price`, `retail_price`, `wholesale_price`
  - `tax_rate` (Default 16.00%)
  - `on_hand_quantity`, `reserved_quantity`, `reorder_level`
  - `unit` ('قطعة', 'باكيت', 'كرتونة')
  - `status` ('active', 'out_of_stock', 'near_expiry')

### 3. `orders` & `order_items`
- **orders**:
  - `id`, `order_number` (UNIQUE e.g. ORD-2026-881)
  - `customer_name`, `customer_phone`, `governorate`, `region`, `address`, `map_url`
  - `subtotal`, `discount`, `delivery_fee`, `total_amount`
  - `payment_method` ('cash', 'cliq', 'card', 'debt')
  - `status` ('new', 'confirmed', 'processing', 'out_for_delivery', 'delivered', 'cancelled')
  - `idempotency_key` (UNIQUE)

### 4. `customers` & `suppliers`
- **customers**: `id`, `name`, `phone`, `whatsapp`, `address`, `credit_limit`, `current_balance`
- **suppliers**: `id`, `company_name`, `contact_person`, `phone`, `current_balance`, `tax_number`

### 5. `inventory_movements` (Audit Feed)
- `id`, `product_id`, `branch_id`, `movement_type`, `previous_quantity`, `quantity_change`, `new_quantity`, `reason`, `performed_by_user_id`, `timestamp`

### 6. `expenses`, `shifts`, `accounts`
- **expenses**: `id`, `expense_number`, `category`, `amount`, `payment_method`, `description`
- **shifts**: `id`, `shift_number`, `branch_id`, `opening_cash`, `expected_cash`, `actual_cash`, `cash_discrepancy`, `status`
- **accounts**: `id`, `code`, `name_ar`, `type`, `balance`, `is_system`

---

## ⚡ الدالة الذرية لضمان عدم تضارب المخزون (`reserve_order_stock`)

تستخدم هذه الدالة قفل الأسطر (`FOR UPDATE`) لضمان صحة حجز المخزون أوتوماتيكياً:

```sql
CREATE OR REPLACE FUNCTION reserve_order_stock(
  p_order_id UUID,
  p_performed_by_id UUID
)
RETURNS VOID AS $$
DECLARE
  item RECORD;
  v_available INT;
BEGIN
  FOR item IN SELECT product_id, product_name, quantity FROM order_items WHERE order_id = p_order_id LOOP
    SELECT (on_hand_quantity - reserved_quantity) INTO v_available
    FROM products
    WHERE id = item.product_id
    FOR UPDATE;

    IF v_available < item.quantity THEN
      RAISE EXCEPTION 'Stock Conflict: Product % has only % available', item.product_name, v_available;
    END IF;
  END LOOP;

  FOR item IN SELECT product_id, product_name, quantity FROM order_items WHERE order_id = p_order_id LOOP
    UPDATE products
    SET reserved_quantity = reserved_quantity + item.quantity
    WHERE id = item.product_id;
  END LOOP;

  UPDATE orders SET status = 'confirmed' WHERE id = p_order_id;
END;
$$ LANGUAGE plpgsql;
```
