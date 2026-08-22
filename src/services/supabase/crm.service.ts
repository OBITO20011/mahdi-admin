import { supabase, isSupabaseConfigured } from '../../lib/supabase';
import {
  CrmCustomer,
  CrmCustomerAddress,
  CrmCustomerFilterParams,
  CrmCustomerOrderSummary,
  CrmCustomerResponse,
  CrmCustomerStats,
  CustomerTag,
} from '../../types/crm';
import {
  calculateOrderAmountDue,
  isOperationalOrderSource,
} from '../../utils/orderCalculations';

type RawCustomer = Record<string, any>;
type RawOrder = Record<string, any>;

function mapAddress(address: Record<string, any>): CrmCustomerAddress {
  const latitude =
    address.latitude === null || address.latitude === undefined
      ? undefined
      : Number(address.latitude);
  const longitude =
    address.longitude === null || address.longitude === undefined
      ? undefined
      : Number(address.longitude);
  const hasCoordinates =
    Number.isFinite(latitude) && Number.isFinite(longitude);

  return {
    id: address.id,
    customerId: address.customer_id,
    governorate: address.governorate || '',
    city: address.city || '',
    area: address.area || '',
    street: address.street || '',
    building: address.building || undefined,
    floor: address.floor || undefined,
    apartment: address.apartment || undefined,
    notes: address.notes || undefined,
    latitude: hasCoordinates ? latitude : undefined,
    longitude: hasCoordinates ? longitude : undefined,
    formattedAddress: address.formatted_address || undefined,
    googleMapsUrl: address.google_maps_url || undefined,
    locationSource: address.location_source || 'manual',
    locationConfirmed: Boolean(address.location_confirmed),
    isDefault: Boolean(address.is_default),
    createdAt: address.created_at,
  };
}

function deriveCustomerStatus(customer: RawCustomer) {
  const isBlocked = Boolean(customer.is_blocked);
  const isActive = customer.is_active !== false && !isBlocked;
  const isVip = Boolean(customer.is_vip);

  return {
    isBlocked,
    isActive,
    isVip,
    status: isBlocked
      ? ('blocked' as const)
      : isVip
      ? ('vip' as const)
      : isActive
      ? ('active' as const)
      : ('inactive' as const),
  };
}

function deriveCustomerTags(
  customer: RawCustomer,
  totalSpending: number
): CustomerTag[] {
  const tags: CustomerTag[] = [];
  if (customer.is_vip || totalSpending >= 500) tags.push('VIP');
  tags.push(customer.customer_type === 'wholesale' ? 'Wholesale' : 'Retail');

  const createdAt = new Date(customer.created_at || 0).getTime();
  if (createdAt && Date.now() - createdAt < 30 * 24 * 60 * 60 * 1000) {
    tags.push('New Customer');
  }
  return tags;
}

function buildCustomer(
  customer: RawCustomer,
  orders: RawOrder[],
  addresses: CrmCustomerAddress[]
): CrmCustomer {
  const completedOrders = orders.filter((order) =>
    ['completed', 'delivered'].includes(order.status)
  );
  const totalSpending = completedOrders.reduce(
    (sum, order) =>
      sum + Number(order.total_in_minor_units || 0) / 1000,
    0
  );
  const currentBalance = completedOrders.reduce((sum, order) => {
    const total = Number(order.total_in_minor_units || 0) / 1000;
    const paid = Number(order.amount_paid_in_minor_units || 0) / 1000;
    return sum + calculateOrderAmountDue(total, paid);
  }, 0);
  const state = deriveCustomerStatus(customer);

  return {
    id: customer.id,
    fullName: customer.full_name || 'عميل بدون اسم',
    phone: customer.phone || '',
    email: customer.email || '',
    governorate:
      customer.governorate || addresses[0]?.governorate || 'غير محدد',
    ...state,
    isDeleted: Boolean(customer.is_deleted),
    tags: deriveCustomerTags(customer, totalSpending),
    notes: customer.notes || '',
    whatsapp: customer.whatsapp || customer.phone || undefined,
    creditLimit:
      Number(customer.credit_limit_in_minor_units || 0) / 1000,
    currentBalance: Number(currentBalance.toFixed(3)),
    customerType:
      customer.customer_type === 'wholesale' ? 'wholesale' : 'retail',
    createdAt: customer.created_at,
    updatedAt: customer.updated_at,
    totalOrdersCount: orders.length,
    totalSpending: Number(totalSpending.toFixed(3)),
    addresses,
  };
}

export async function fetchCustomersCrmFromSupabase(
  params: CrmCustomerFilterParams
): Promise<CrmCustomerResponse> {
  const page = params.page && params.page > 0 ? params.page : 1;
  const pageSize =
    params.pageSize && params.pageSize > 0 ? params.pageSize : 10;
  const searchQuery = params.searchQuery?.trim().toLowerCase() || '';
  const statusFilter = params.statusFilter || 'all';
  const sortBy = params.sortBy || 'latest';

  const failure = (error: string): CrmCustomerResponse => ({
    success: false,
    customers: [],
    totalCount: 0,
    page,
    pageSize,
    totalPages: 0,
    error,
  });

  if (!isSupabaseConfigured || !supabase) {
    return failure('لم يتم إعداد الاتصال بقاعدة بيانات Supabase بنجاح.');
  }

  try {
    const [customersResult, ordersResult, addressesResult] =
      await Promise.all([
        supabase
          .from('customers')
          .select('*')
          .order('created_at', { ascending: false }),
        supabase
          .from('orders')
          .select(
            'id, customer_id, total_in_minor_units, amount_paid_in_minor_units, status, source, created_at'
          ),
        supabase.from('customer_addresses').select('*'),
      ]);

    const queryError =
      customersResult.error || ordersResult.error || addressesResult.error;
    if (queryError) return failure(queryError.message);

    const operationalOrders = (ordersResult.data || []).filter((order) =>
      isOperationalOrderSource(order.source)
    );
    const ordersByCustomer = new Map<string, RawOrder[]>();
    operationalOrders.forEach((order) => {
      if (!order.customer_id) return;
      const list = ordersByCustomer.get(order.customer_id) || [];
      list.push(order);
      ordersByCustomer.set(order.customer_id, list);
    });

    const addressesByCustomer = new Map<string, CrmCustomerAddress[]>();
    (addressesResult.data || []).forEach((address) => {
      const list = addressesByCustomer.get(address.customer_id) || [];
      list.push(mapAddress(address));
      addressesByCustomer.set(address.customer_id, list);
    });

    let customers = (customersResult.data || [])
      .map((customer) =>
        buildCustomer(
          customer,
          ordersByCustomer.get(customer.id) || [],
          addressesByCustomer.get(customer.id) || []
        )
      )
      .filter((customer) => !customer.isDeleted);

    if (searchQuery) {
      customers = customers.filter((customer) =>
        [customer.fullName, customer.phone, customer.email].some((value) =>
          value.toLowerCase().includes(searchQuery)
        )
      );
    }

    if (statusFilter !== 'all') {
      customers = customers.filter((customer) => {
        if (statusFilter === 'vip') return customer.isVip;
        if (statusFilter === 'active') {
          return customer.isActive && !customer.isBlocked;
        }
        if (statusFilter === 'inactive') {
          return !customer.isActive && !customer.isBlocked;
        }
        return customer.isBlocked;
      });
    }

    if (sortBy === 'highest_spending') {
      customers.sort((a, b) => b.totalSpending - a.totalSpending);
    } else if (sortBy === 'most_orders') {
      customers.sort((a, b) => b.totalOrdersCount - a.totalOrdersCount);
    } else {
      customers.sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
    }

    const totalCount = customers.length;
    const totalPages = Math.max(Math.ceil(totalCount / pageSize), 1);
    const start = (page - 1) * pageSize;

    return {
      success: true,
      customers: customers.slice(start, start + pageSize),
      totalCount,
      page,
      pageSize,
      totalPages,
    };
  } catch (error: any) {
    return failure(error?.message || 'تعذر جلب بيانات العملاء.');
  }
}

export async function fetchCustomerDetailsCrmFromSupabase(
  customerId: string
): Promise<{ success: boolean; customer: CrmCustomer | null; error?: string }> {
  if (!isSupabaseConfigured || !supabase) {
    return { success: false, customer: null, error: 'Supabase غير مهيأ.' };
  }

  try {
    const [customerResult, addressesResult, ordersResult] =
      await Promise.all([
        supabase.from('customers').select('*').eq('id', customerId).single(),
        supabase
          .from('customer_addresses')
          .select('*')
          .eq('customer_id', customerId)
          .order('is_default', { ascending: false }),
        supabase
          .from('orders')
          .select(
            'id, order_number, status, payment_status, total_in_minor_units, amount_paid_in_minor_units, source, created_at, order_items(id)'
          )
          .eq('customer_id', customerId)
          .order('created_at', { ascending: false }),
      ]);

    const queryError =
      customerResult.error || addressesResult.error || ordersResult.error;
    if (queryError || !customerResult.data) {
      return {
        success: false,
        customer: null,
        error: queryError?.message || 'العميل غير موجود.',
      };
    }

    const addresses = (addressesResult.data || []).map(mapAddress);
    const rawOrders = (ordersResult.data || []).filter((order) =>
      isOperationalOrderSource(order.source)
    );
    const customer = buildCustomer(
      customerResult.data,
      rawOrders,
      addresses
    );

    let completedOrders = 0;
    let cancelledOrders = 0;
    let totalSpending = 0;
    let outstandingBalance = 0;

    const orderHistory: CrmCustomerOrderSummary[] = rawOrders.map((order) => {
      const totalAmount =
        Number(order.total_in_minor_units || 0) / 1000;
      const amountPaid =
        Number(order.amount_paid_in_minor_units || 0) / 1000;
      const isCompleted = ['completed', 'delivered'].includes(order.status);
      const amountDue = isCompleted
        ? calculateOrderAmountDue(totalAmount, amountPaid)
        : 0;

      if (isCompleted) {
        completedOrders += 1;
        totalSpending += totalAmount;
        outstandingBalance += amountDue;
      } else if (order.status === 'cancelled') {
        cancelledOrders += 1;
      }

      return {
        id: order.id,
        orderNumber: order.order_number,
        status: order.status,
        totalAmount,
        amountPaid,
        amountDue,
        paymentStatus: order.payment_status || 'unpaid',
        source: order.source || 'website',
        itemsCount: Array.isArray(order.order_items)
          ? order.order_items.length
          : 0,
        createdAt: order.created_at,
      };
    });

    const stats: CrmCustomerStats = {
      totalOrders: rawOrders.length,
      completedOrders,
      cancelledOrders,
      totalSpending: Number(totalSpending.toFixed(3)),
      outstandingBalance: Number(outstandingBalance.toFixed(3)),
      averageOrderValue:
        completedOrders > 0
          ? Number((totalSpending / completedOrders).toFixed(3))
          : 0,
      lastOrderDate: rawOrders[0]?.created_at || null,
    };

    customer.currentBalance = stats.outstandingBalance;
    customer.totalSpending = stats.totalSpending;
    customer.stats = stats;
    customer.orderHistory = orderHistory;

    return { success: true, customer };
  } catch (error: any) {
    return {
      success: false,
      customer: null,
      error: error?.message || 'تعذر جلب ملف العميل.',
    };
  }
}

export interface SaveCustomerInput {
  fullName: string;
  phone: string;
  email?: string;
  governorate?: string;
  whatsapp?: string;
  notes?: string;
  customerType?: 'retail' | 'wholesale';
}

async function saveCustomerThroughRpc(
  input: SaveCustomerInput,
  customerId?: string
): Promise<{ success: boolean; customerId?: string; error?: string }> {
  if (!isSupabaseConfigured || !supabase) {
    return { success: false, error: 'Supabase غير مهيأ.' };
  }

  try {
    const { data, error } = await supabase.rpc('save_customer', {
      p_full_name: input.fullName,
      p_phone: input.phone,
      p_customer_id: customerId || null,
      p_email: input.email || null,
      p_governorate: input.governorate || null,
      p_whatsapp: input.whatsapp || null,
      p_notes: input.notes || null,
      p_customer_type: input.customerType || 'retail',
    });
    if (error) return { success: false, error: error.message };
    return {
      success: true,
      customerId: data?.customer_id || customerId,
    };
  } catch (error: any) {
    return {
      success: false,
      error: error?.message || 'تعذر حفظ بيانات العميل.',
    };
  }
}

export function createCustomerCrmInSupabase(input: SaveCustomerInput) {
  return saveCustomerThroughRpc(input);
}

export async function updateCustomerCrmInSupabase(
  customerId: string,
  updates: SaveCustomerInput
) {
  return saveCustomerThroughRpc(updates, customerId);
}

async function setCustomerStatus(
  customerId: string,
  action: 'block' | 'unblock' | 'delete'
): Promise<{ success: boolean; error?: string }> {
  if (!isSupabaseConfigured || !supabase) {
    return { success: false, error: 'Supabase غير مهيأ.' };
  }

  try {
    const { error } = await supabase.rpc('set_customer_status', {
      p_customer_id: customerId,
      p_action: action,
    });
    return error
      ? { success: false, error: error.message }
      : { success: true };
  } catch (error: any) {
    return {
      success: false,
      error: error?.message || 'تعذر تعديل حالة العميل.',
    };
  }
}

export function toggleCustomerBlockStatusInSupabase(
  customerId: string,
  isBlocked: boolean
) {
  return setCustomerStatus(customerId, isBlocked ? 'block' : 'unblock');
}

export function softDeleteCustomerInSupabase(customerId: string) {
  return setCustomerStatus(customerId, 'delete');
}

export interface CustomerAddressInput {
  governorate: string;
  city?: string;
  area: string;
  street?: string;
  building?: string;
  floor?: string;
  apartment?: string;
  notes?: string;
  latitude?: number;
  longitude?: number;
  isDefault?: boolean;
}

export async function addCustomerAddressInSupabase(
  customerId: string,
  input: CustomerAddressInput
): Promise<{ success: boolean; error?: string }> {
  if (!isSupabaseConfigured || !supabase) {
    return { success: false, error: 'Supabase غير مهيأ.' };
  }

  try {
    const { error } = await supabase.rpc('add_customer_address', {
      p_customer_id: customerId,
      p_governorate: input.governorate,
      p_city: input.city || null,
      p_area: input.area,
      p_street: input.street || null,
      p_building: input.building || null,
      p_floor: input.floor || null,
      p_apartment: input.apartment || null,
      p_notes: input.notes || null,
      p_latitude: input.latitude ?? null,
      p_longitude: input.longitude ?? null,
      p_is_default: Boolean(input.isDefault),
    });
    return error
      ? { success: false, error: error.message }
      : { success: true };
  } catch (error: any) {
    return {
      success: false,
      error: error?.message || 'تعذر إضافة عنوان العميل.',
    };
  }
}

export function subscribeToCrmRealtime(onChange: () => void): () => void {
  if (!isSupabaseConfigured || !supabase) return () => {};

  const channel = supabase
    .channel(`crm-realtime-${crypto.randomUUID()}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'customers' },
      onChange
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'customer_addresses' },
      onChange
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'orders' },
      onChange
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}
