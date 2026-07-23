-- ====================================================================
-- Nawasrah Business Manager - Atomic Stock Reservation PostgreSQL Function
-- ====================================================================

CREATE OR REPLACE FUNCTION reserve_order_stock(
  p_order_id UUID,
  p_performed_by_id UUID
)
RETURNS VOID AS $$
DECLARE
  item RECORD;
  v_available INT;
  v_order_no TEXT;
BEGIN
  -- Get order number
  SELECT order_number INTO v_order_no FROM orders WHERE id = p_order_id;

  -- Check stock availability for each order item atomically
  FOR item IN SELECT product_id, product_name, quantity FROM order_items WHERE order_id = p_order_id LOOP
    SELECT (on_hand_quantity - reserved_quantity) INTO v_available
    FROM products
    WHERE id = item.product_id
    FOR UPDATE; -- Lock row for concurrency

    IF v_available < item.quantity THEN
      RAISE EXCEPTION 'Stock Conflict: Product % has only % available, required %', item.product_name, v_available, item.quantity;
    END IF;
  END LOOP;

  -- Perform stock reservation
  FOR item IN SELECT product_id, product_name, quantity FROM order_items WHERE order_id = p_order_id LOOP
    UPDATE products
    SET reserved_quantity = reserved_quantity + item.quantity,
        updated_at = NOW()
    WHERE id = item.product_id;

    -- Record movement
    INSERT INTO inventory_movements (
      product_id, movement_type, previous_quantity, quantity_change, new_quantity, reason, performed_by_user_id, reference_id
    ) VALUES (
      item.product_id, 'Reservation', v_available + item.quantity, item.quantity, v_available, 'حجز أوتوماتيكي للطلب ' || v_order_no, p_performed_by_id, p_order_id::TEXT
    );
  END LOOP;

  -- Update order status
  UPDATE orders SET status = 'confirmed', updated_at = NOW() WHERE id = p_order_id;
END;
$$ LANGUAGE plpgsql;
