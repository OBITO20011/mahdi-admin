import { supabase, isSupabaseConfigured } from '../../lib/supabase';
import { Order, OrderStatus } from '../../types';

export async function fetchOrdersFromSupabase(
  filterStatus?: string,
  searchQuery?: string
): Promise<{ success: boolean; orders: Order[]; error?: string }> {
  if (!isSupabaseConfigured || !supabase) {
    return {
      success: false,
      orders: [],
      error: 'لم يتم إعداد عميل Supabase بنجاح.',
    };
  }

  try {
    let query = supabase
      .from('orders')
      .select(`
        id,
        order_number,
        status,
        payment_method,
        payment_status,
        subtotal_in_minor_units,
        delivery_fee_in_minor_units,
        discount_in_minor_units,
        total_in_minor_units,
        customer_notes,
        internal_notes,
        whatsapp_message,
        source,
        branch_id,
        warehouse_id,
        created_at,
        updated_at,
        customers (
          id,
          full_name,
          phone,
          email
        ),
        customer_addresses (
          id,
          governorate,
          city,
          area,
          street,
          building,
          floor,
          apartment,
          notes,
          latitude,
          longitude,
          formatted_address,
          google_maps_url,
          location_source,
          location_confirmed
        ),
        order_items (
          id,
          product_id,
          product_name_snapshot,
          sku_snapshot,
          quantity,
          unit_price_in_minor_units,
          line_total_in_minor_units,
          products (
            id,
            cost_price_in_minor_units,
            units (
              name_ar
            ),
            product_images (
              image_url
            )
          )
        ),
        order_status_history (
          id,
          old_status,
          new_status,
          changed_by,
          notes,
          created_at
        )
      `)
      .order('created_at', { ascending: false });

    if (filterStatus && filterStatus !== 'all') {
      query = query.eq('status', filterStatus);
    }

    const { data, error } = await query;

    if (error) {
      console.error('[fetchOrdersFromSupabase Error]:', error);
      return { success: false, orders: [], error: error.message };
    }

    if (!data) {
      return { success: true, orders: [] };
    }

    const mappedOrders: Order[] = data.map((ord: any) => {
      const cust = ord.customers || {};
      const addr = ord.customer_addresses || {};

      const items = (ord.order_items || []).map((item: any) => {
        const prod = item.products || {};
        const unitPrice = Number(item.unit_price_in_minor_units || 0) / 1000;
        const lineTotal = Number(item.line_total_in_minor_units || 0) / 1000;
        const costPrice = Number(prod.cost_price_in_minor_units || 0) / 1000;

        const unitName = prod.units?.name_ar || prod.unit || 'قطعة';
        const imgUrl =
          Array.isArray(prod.product_images) && prod.product_images.length > 0
            ? prod.product_images[0].image_url
            : prod.image_url ||
              'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&q=80&w=200';

        return {
          id: item.id,
          productId: item.product_id || '',
          productName: item.product_name_snapshot || 'منتج',
          productImage: imgUrl,
          sku: item.sku_snapshot || '',
          unit: unitName,
          unitPrice,
          costPrice,
          quantity: item.quantity || 1,
          discount: 0,
          totalPrice: lineTotal,
        };
      });

      const statusHistory = (ord.order_status_history || [])
        .map((h: any) => ({
          status: (h.new_status || 'new') as OrderStatus,
          changedAt: h.created_at || new Date().toISOString(),
          changedBy: h.changed_by || 'النظام',
          reason: h.notes || undefined,
        }))
        .sort(
          (a: any, b: any) =>
            new Date(b.changedAt).getTime() - new Date(a.changedAt).getTime()
        );

      const lat = addr.latitude ? Number(addr.latitude) : undefined;
      const lng = addr.longitude ? Number(addr.longitude) : undefined;

      let gMapsUrl = addr.google_maps_url;
      if (!gMapsUrl && lat && lng) {
        gMapsUrl = `https://www.google.com/maps?q=${lat},${lng}`;
      }

      const addressStr =
        addr.formatted_address ||
        [addr.governorate, addr.city, addr.area, addr.street, addr.building]
          .filter(Boolean)
          .join(' - ') ||
        'عنوان غير محدد';

      return {
        id: ord.id,
        orderNumber: ord.order_number,
        customerName: cust.full_name || 'عميل زائر',
        customerPhone: cust.phone || '',
        governorate: addr.governorate || 'عمان',
        region: addr.area || addr.city || 'عمان',
        address: addressStr,
        customerAddress: {
          governorate: addr.governorate,
          area: addr.area,
          street: addr.street,
          building: addr.building,
          apartment: addr.apartment,
          landmark: addr.city,
          deliveryNotes: addr.notes,
        },
        latitude: lat,
        longitude: lng,
        formattedAddress: addr.formatted_address,
        googleMapsUrl: gMapsUrl,
        locationSource: addr.location_source || 'manual',
        locationConfirmed: Boolean(addr.location_confirmed),
        items,
        subtotal: Number(ord.subtotal_in_minor_units || 0) / 1000,
        deliveryFee: Number(ord.delivery_fee_in_minor_units || 0) / 1000,
        discount: Number(ord.discount_in_minor_units || 0) / 1000,
        totalAmount: Number(ord.total_in_minor_units || 0) / 1000,
        paymentMethod: (ord.payment_method as any) || 'cash',
        paymentStatus: (ord.payment_status as any) || 'unpaid',
        status: (ord.status as OrderStatus) || 'new',
        branchId: ord.branch_id || '',
        isNew: ord.status === 'new',
        notes: ord.customer_notes,
        internalNotes: ord.internal_notes,
        createdAt: ord.created_at,
        updatedAt: ord.updated_at,
        statusHistory,
      };
    });

    // Apply client-side search query if present
    let filtered = mappedOrders;
    if (searchQuery && searchQuery.trim() !== '') {
      const q = searchQuery.toLowerCase().trim();
      filtered = mappedOrders.filter(
        (o) =>
          o.orderNumber.toLowerCase().includes(q) ||
          o.customerName.toLowerCase().includes(q) ||
          o.customerPhone.includes(q)
      );
    }

    return { success: true, orders: filtered };
  } catch (err: any) {
    console.error('[fetchOrdersFromSupabase Exception]:', err);
    return {
      success: false,
      orders: [],
      error: err?.message || 'حدث خطأ غير متوقع أثناء جلب الطلبات.',
    };
  }
}

export async function fetchOrderByIdFromSupabase(
  orderId: string
): Promise<{ success: boolean; order?: Order; error?: string }> {
  if (!isSupabaseConfigured || !supabase) {
    return { success: false, error: 'عميل Supabase غير غير معد.' };
  }

  try {
    const res = await fetchOrdersFromSupabase('all');
    if (!res.success) {
      return { success: false, error: res.error };
    }

    const order = res.orders.find((o) => o.id === orderId);
    if (!order) {
      return { success: false, error: 'الطلب غير موجود في قاعدة البيانات.' };
    }

    return { success: true, order };
  } catch (err: any) {
    return { success: false, error: err?.message || 'تعذر جلب تفاصيل الطلب.' };
  }
}

export async function createTestCustomerInSupabase(
  name?: string,
  phone?: string,
  governorate?: string
): Promise<{ success: boolean; data?: any; rawJson?: any; error?: string }> {
  if (!isSupabaseConfigured || !supabase) {
    return { success: false, error: 'عميل Supabase غير متاح.' };
  }

  try {
    const { data, error } = await supabase.rpc('create_test_customer', {
      p_name: name || null,
      p_phone: phone || null,
      p_governorate: governorate || 'عمان',
    });

    if (error) {
      console.error('[createTestCustomerInSupabase Error]:', error);
      return { success: false, error: error.message, rawJson: error };
    }

    return {
      success: true,
      data,
      rawJson: data,
    };
  } catch (err: any) {
    return { success: false, error: err?.message || 'فشل إنشاء العميل التجريبي.' };
  }
}

export async function createTestOrderInSupabase(
  custName?: string,
  custPhone?: string,
  productId?: string,
  quantity?: number
): Promise<{ success: boolean; data?: any; rawJson?: any; error?: string }> {
  if (!isSupabaseConfigured || !supabase) {
    return { success: false, error: 'عميل Supabase غير متاح.' };
  }

  try {
    const { data, error } = await supabase.rpc('create_test_order', {
      p_customer_name: custName || null,
      p_customer_phone: custPhone || null,
      p_product_id: productId || null,
      p_quantity: quantity || 1,
    });

    if (error) {
      console.error('[createTestOrderInSupabase Error]:', error);
      return { success: false, error: error.message, rawJson: error };
    }

    return {
      success: true,
      data,
      rawJson: data,
    };
  } catch (err: any) {
    return { success: false, error: err?.message || 'فشل إنشاء الطلب الاختباري.' };
  }
}

export async function fetchOrderInventoryStatusFromSupabase(orderId: string): Promise<{
  success: boolean;
  orderStatus?: string;
  orderNumber?: string;
  rawOrderData?: any;
  itemsInventory?: Array<{
    productId: string;
    productName: string;
    sku: string;
    quantityInOrder: number;
    onHandQuantity: number;
    reservedQuantity: number;
    availableQuantity: number;
  }>;
  error?: string;
}> {
  if (!isSupabaseConfigured || !supabase) {
    return { success: false, error: 'عميل Supabase غير متاح.' };
  }

  try {
    // 1. Get order details
    const { data: ord, error: ordErr } = await supabase
      .from('orders')
      .select('id, order_number, status, warehouse_id, created_at, updated_at')
      .eq('id', orderId)
      .single();

    if (ordErr || !ord) {
      return { success: false, error: ordErr?.message || 'الطلب غير موجود' };
    }

    // 2. Get order items with product details
    const { data: items, error: itemsErr } = await supabase
      .from('order_items')
      .select(`
        id,
        product_id,
        quantity,
        sku_snapshot,
        products (
          id,
          name_ar,
          sku
        )
      `)
      .eq('order_id', orderId);

    if (itemsErr) {
      return { success: false, error: itemsErr.message };
    }

    const itemsInventory = [];

    // 3. For each item, query inventory_balances
    for (const item of items || []) {
      const prod = Array.isArray(item.products) ? item.products[0] : item.products;
      const prodId = item.product_id;

      const { data: bal } = await supabase
        .from('inventory_balances')
        .select('on_hand_quantity, reserved_quantity')
        .eq('product_id', prodId)
        .maybeSingle();

      const onHand = Number(bal?.on_hand_quantity || 0);
      const reserved = Number(bal?.reserved_quantity || 0);

      itemsInventory.push({
        productId: prodId,
        productName: prod?.name_ar || 'منتج غير معروف',
        sku: item.sku_snapshot || prod?.sku || '',
        quantityInOrder: Number(item.quantity || 0),
        onHandQuantity: onHand,
        reservedQuantity: reserved,
        availableQuantity: onHand - reserved,
      });
    }

    return {
      success: true,
      orderStatus: ord.status,
      orderNumber: ord.order_number,
      rawOrderData: ord,
      itemsInventory,
    };
  } catch (err: any) {
    return { success: false, error: err?.message || 'فشل جلب أرقام المخزون.' };
  }
}

export async function confirmOrderInSupabase(
  orderId: string,
  notes?: string
): Promise<{ success: boolean; message?: string; rawJson?: any; error?: string }> {
  if (!isSupabaseConfigured || !supabase) {
    return { success: false, error: 'عميل Supabase غير متاح.' };
  }

  try {
    const { data, error } = await supabase.rpc('confirm_order', {
      p_order_id: orderId,
      p_notes: notes || null,
    });

    if (error) {
      console.error('[confirmOrderInSupabase Error]:', error);
      return { success: false, error: error.message, rawJson: error };
    }

    return {
      success: true,
      rawJson: data,
      message: data?.message || 'تم تأكيد الطلب وحجز الكميات بنجاح.',
    };
  } catch (err: any) {
    return { success: false, error: err?.message || 'حدث خطأ أثناء تأكيد الطلب.' };
  }
}

export async function completeOrderInSupabase(
  orderId: string,
  notes?: string
): Promise<{ success: boolean; message?: string; rawJson?: any; error?: string }> {
  if (!isSupabaseConfigured || !supabase) {
    return { success: false, error: 'عميل Supabase غير متاح.' };
  }

  try {
    const { data, error } = await supabase.rpc('complete_order', {
      p_order_id: orderId,
      p_notes: notes || null,
    });

    if (error) {
      console.error('[completeOrderInSupabase Error]:', error);
      return { success: false, error: error.message, rawJson: error };
    }

    return {
      success: true,
      rawJson: data,
      message: data?.message || 'تم إكمال الطلب وخصم الكميات من المخزون.',
    };
  } catch (err: any) {
    return { success: false, error: err?.message || 'حدث خطأ أثناء إكمال الطلب.' };
  }
}

export async function cancelOrderInSupabase(
  orderId: string,
  notes?: string
): Promise<{ success: boolean; message?: string; rawJson?: any; error?: string }> {
  if (!isSupabaseConfigured || !supabase) {
    return { success: false, error: 'عميل Supabase غير متاح.' };
  }

  try {
    const { data, error } = await supabase.rpc('cancel_order', {
      p_order_id: orderId,
      p_notes: notes || null,
    });

    if (error) {
      console.error('[cancelOrderInSupabase Error]:', error);
      return { success: false, error: error.message, rawJson: error };
    }

    return {
      success: true,
      rawJson: data,
      message: data?.message || 'تم إلغاء الطلب وتحرير الكمية المحجوزة.',
    };
  } catch (err: any) {
    return { success: false, error: err?.message || 'حدث خطأ أثناء إلغاء الطلب.' };
  }
}

export async function updateOrderStatusInSupabase(
  orderId: string,
  newStatus: string,
  notes?: string
): Promise<{ success: boolean; message?: string; error?: string }> {
  if (!isSupabaseConfigured || !supabase) {
    return { success: false, error: 'عميل Supabase غير متاح.' };
  }

  try {
    const { data, error } = await supabase.rpc('update_order_status', {
      p_order_id: orderId,
      p_new_status: newStatus,
      p_notes: notes || null,
    });

    if (error) {
      console.error('[updateOrderStatusInSupabase Error]:', error);
      return { success: false, error: error.message };
    }

    return {
      success: true,
      message: data?.message || `تم تحديث حالة الطلب إلى ${newStatus}.`,
    };
  } catch (err: any) {
    return { success: false, error: err?.message || 'حدث خطأ أثناء تحديث حالة الطلب.' };
  }
}

export function subscribeToOrdersInSupabase(
  onNewOrUpdatedOrder: (payload: any) => void
) {
  if (!isSupabaseConfigured || !supabase) {
    return () => {};
  }

  const channel = supabase
    .channel('public:orders_changes')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'orders' },
      (payload) => {
        console.log('[Supabase Realtime] Order event received:', payload);
        onNewOrUpdatedOrder(payload);
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}
