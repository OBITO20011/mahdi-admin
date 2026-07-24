/**
 * Nawasrah Business Manager - Enterprise CRM Service (Supabase Integration)
 * Realtime Supabase data fetch, filtering, sorting, pagination, and customer operations.
 */

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

/**
 * Fetch list of customers from Supabase with search, filters, sorting & pagination
 */
export async function fetchCustomersCrmFromSupabase(
  params: CrmCustomerFilterParams
): Promise<CrmCustomerResponse> {
  const page = params.page && params.page > 0 ? params.page : 1;
  const pageSize = params.pageSize && params.pageSize > 0 ? params.pageSize : 10;
  const searchQuery = params.searchQuery?.trim().toLowerCase() || '';
  const statusFilter = params.statusFilter || 'all';
  const sortBy = params.sortBy || 'latest';

  if (!isSupabaseConfigured || !supabase) {
    return {
      success: false,
      customers: [],
      totalCount: 0,
      page,
      pageSize,
      totalPages: 0,
      error: 'لم يتم إعداد الاتصال بقاعدة بيانات Supabase بنجاح.',
    };
  }

  try {
    // 1. Fetch raw customers and related orders
    const [customersRes, ordersRes, addressesRes] = await Promise.all([
      supabase
        .from('customers')
        .select('*')
        .order('created_at', { ascending: false }),
      supabase
        .from('orders')
        .select('id, customer_id, total_in_minor_units, status, created_at, order_items(id)'),
      supabase
        .from('customer_addresses')
        .select('*'),
    ]);

    if (customersRes.error) {
      console.error('[fetchCustomersCrm] Supabase customer query error:', customersRes.error);
      return {
        success: false,
        customers: [],
        totalCount: 0,
        page,
        pageSize,
        totalPages: 0,
        error: customersRes.error.message,
      };
    }

    const rawCustomers = customersRes.data || [];
    const rawOrders = ordersRes.data || [];
    const rawAddresses = addressesRes.data || [];

    // Map orders by customer ID for spending & order count metrics
    const customerOrdersMap = new Map<string, any[]>();
    rawOrders.forEach((o: any) => {
      const cId = o.customer_id;
      if (cId) {
        if (!customerOrdersMap.has(cId)) customerOrdersMap.set(cId, []);
        customerOrdersMap.get(cId)!.push(o);
      }
    });

    // Map addresses by customer ID
    const customerAddressesMap = new Map<string, CrmCustomerAddress[]>();
    rawAddresses.forEach((addr: any) => {
      const cId = addr.customer_id;
      if (cId) {
        if (!customerAddressesMap.has(cId)) customerAddressesMap.set(cId, []);
        customerAddressesMap.get(cId)!.push({
          id: addr.id,
          customerId: addr.customer_id,
          governorate: addr.governorate || 'عمان',
          city: addr.city || 'عمان',
          area: addr.area || '',
          street: addr.street || '',
          building: addr.building || '',
          floor: addr.floor || '',
          apartment: addr.apartment || '',
          notes: addr.notes || '',
          latitude: addr.latitude || 31.9539,
          longitude: addr.longitude || 35.9106,
          formattedAddress: addr.formatted_address || `${addr.governorate || ''} ${addr.area || ''}`,
          googleMapsUrl:
            addr.google_maps_url ||
            (addr.latitude && addr.longitude
              ? `https://maps.google.com/?q=${addr.latitude},${addr.longitude}`
              : `https://maps.google.com/?q=Amman`),
          locationSource: addr.location_source || 'manual',
          locationConfirmed: Boolean(addr.location_confirmed),
          isDefault: Boolean(addr.is_default),
        });
      }
    });

    // Transform raw customers to CrmCustomer
    let transformed: CrmCustomer[] = rawCustomers.map((c: any) => {
      const cOrders = customerOrdersMap.get(c.id) || [];
      const cAddresses = customerAddressesMap.get(c.id) || [];

      // Calculate total spending & total orders
      let totalSpent = 0;
      let orderCount = cOrders.length;

      cOrders.forEach((ord: any) => {
        if (ord.status !== 'cancelled') {
          totalSpent += (Number(ord.total_in_minor_units) || 0) / 1000;
        }
      });

      // Tags derivation
      const tags: CustomerTag[] = [];
      if (c.is_vip || c.status === 'vip' || totalSpent > 500) tags.push('VIP');
      if (c.customer_type === 'wholesale') tags.push('Wholesale');
      else tags.push('Retail');

      const createdAt = c.created_at || new Date().toISOString();
      const isNew = new Date().getTime() - new Date(createdAt).getTime() < 30 * 24 * 60 * 60 * 1000;
      if (isNew) tags.push('New Customer');

      const isBlocked = Boolean(c.is_blocked || c.status === 'blocked');
      const isActive = c.is_active !== undefined ? Boolean(c.is_active) : !isBlocked;
      const isVip = Boolean(c.is_vip || c.status === 'vip');

      let status: 'active' | 'inactive' | 'blocked' | 'vip' = 'active';
      if (isBlocked) status = 'blocked';
      else if (isVip) status = 'vip';
      else if (!isActive) status = 'inactive';

      return {
        id: c.id,
        fullName: c.full_name || c.name || 'عميل بدون اسم',
        phone: c.phone || '0790000000',
        email: c.email || '',
        governorate: c.governorate || (cAddresses[0]?.governorate) || 'عمان',
        status,
        isActive,
        isVip,
        isBlocked,
        isDeleted: Boolean(c.is_deleted),
        tags,
        notes: c.notes || c.internal_notes || '',
        whatsapp: c.whatsapp || c.phone || '0790000000',
        creditLimit: Number(c.credit_limit) || 0,
        currentBalance: Number(c.current_balance) || 0,
        customerType: c.customer_type === 'wholesale' ? 'wholesale' : 'retail',
        createdAt,
        updatedAt: c.updated_at,
        totalOrdersCount: orderCount,
        totalSpending: totalSpent,
        addresses: cAddresses,
      };
    });

    // 2. Exclude soft-deleted items unless requested
    transformed = transformed.filter((c) => !c.isDeleted);

    // 3. Search Filter (by Name, Phone, Email)
    if (searchQuery) {
      transformed = transformed.filter(
        (c) =>
          c.fullName.toLowerCase().includes(searchQuery) ||
          c.phone.toLowerCase().includes(searchQuery) ||
          c.email.toLowerCase().includes(searchQuery)
      );
    }

    // 4. Status / Segment Filter (VIP, Active, Inactive, Blocked)
    if (statusFilter !== 'all') {
      if (statusFilter === 'vip') {
        transformed = transformed.filter((c) => c.isVip || c.status === 'vip');
      } else if (statusFilter === 'active') {
        transformed = transformed.filter((c) => c.isActive && !c.isBlocked);
      } else if (statusFilter === 'inactive') {
        transformed = transformed.filter((c) => !c.isActive && !c.isBlocked);
      } else if (statusFilter === 'blocked') {
        transformed = transformed.filter((c) => c.isBlocked || c.status === 'blocked');
      }
    }

    // 5. Sorting (Latest, Highest Spending, Most Orders)
    if (sortBy === 'latest') {
      transformed.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    } else if (sortBy === 'highest_spending') {
      transformed.sort((a, b) => b.totalSpending - a.totalSpending);
    } else if (sortBy === 'most_orders') {
      transformed.sort((a, b) => b.totalOrdersCount - a.totalOrdersCount);
    }

    // 6. Pagination
    const totalCount = transformed.length;
    const totalPages = Math.ceil(totalCount / pageSize) || 1;
    const startIndex = (page - 1) * pageSize;
    const paginatedCustomers = transformed.slice(startIndex, startIndex + pageSize);

    return {
      success: true,
      customers: paginatedCustomers,
      totalCount,
      page,
      pageSize,
      totalPages,
    };
  } catch (err: any) {
    console.error('[fetchCustomersCrmFromSupabase Exception]:', err);
    return {
      success: false,
      customers: [],
      totalCount: 0,
      page,
      pageSize,
      totalPages: 0,
      error: err.message || 'حدث خطأ في جلب بيانات العملاء.',
    };
  }
}

/**
 * Fetch detailed profile, full addresses, statistics and order history timeline for a single customer
 */
export async function fetchCustomerDetailsCrmFromSupabase(
  customerId: string
): Promise<{ success: boolean; customer: CrmCustomer | null; error?: string }> {
  if (!isSupabaseConfigured || !supabase) {
    return { success: false, customer: null, error: 'Supabase غير مهيأ' };
  }

  try {
    const [customerRes, addressesRes, ordersRes] = await Promise.all([
      supabase.from('customers').select('*').eq('id', customerId).single(),
      supabase.from('customer_addresses').select('*').eq('customer_id', customerId),
      supabase
        .from('orders')
        .select(`
          id,
          order_number,
          status,
          total_in_minor_units,
          created_at,
          order_items (id)
        `)
        .eq('customer_id', customerId)
        .order('created_at', { ascending: false }),
    ]);

    if (customerRes.error || !customerRes.data) {
      return { success: false, customer: null, error: customerRes.error?.message || 'العميل غير موجود' };
    }

    const c = customerRes.data;
    const rawAddresses = addressesRes.data || [];
    const rawOrders = ordersRes.data || [];

    // Addresses mapping
    const addresses: CrmCustomerAddress[] = rawAddresses.map((addr: any) => ({
      id: addr.id,
      customerId: addr.customer_id,
      governorate: addr.governorate || 'عمان',
      city: addr.city || 'عمان',
      area: addr.area || '',
      street: addr.street || '',
      building: addr.building || '',
      floor: addr.floor || '',
      apartment: addr.apartment || '',
      notes: addr.notes || '',
      latitude: addr.latitude || 31.9539,
      longitude: addr.longitude || 35.9106,
      formattedAddress: addr.formatted_address || `${addr.governorate || ''} ${addr.area || ''}`,
      googleMapsUrl:
        addr.google_maps_url ||
        (addr.latitude && addr.longitude
          ? `https://maps.google.com/?q=${addr.latitude},${addr.longitude}`
          : `https://maps.google.com/?q=Amman`),
      locationSource: addr.location_source || 'manual',
      locationConfirmed: Boolean(addr.location_confirmed),
      isDefault: Boolean(addr.is_default),
    }));

    // Order history & Statistics
    let totalOrders = rawOrders.length;
    let completedOrders = 0;
    let cancelledOrders = 0;
    let totalSpending = 0;
    let lastOrderDate: string | null = null;

    const orderHistory: CrmCustomerOrderSummary[] = rawOrders.map((o: any) => {
      const totalJod = (Number(o.total_in_minor_units) || 0) / 1000;
      const status = o.status || 'new';

      if (status === 'completed' || status === 'delivered') {
        completedOrders += 1;
        totalSpending += totalJod;
      } else if (status === 'cancelled') {
        cancelledOrders += 1;
      } else {
        totalSpending += totalJod;
      }

      if (!lastOrderDate && o.created_at) {
        lastOrderDate = o.created_at;
      }

      return {
        id: o.id,
        orderNumber: o.order_number || `ORD-${o.id.substring(0, 6)}`,
        status,
        totalAmount: totalJod,
        itemsCount: Array.isArray(o.order_items) ? o.order_items.length : 1,
        createdAt: o.created_at,
      };
    });

    const activeOrdersCount = totalOrders - cancelledOrders;
    const averageOrderValue = activeOrdersCount > 0 ? Number((totalSpending / activeOrdersCount).toFixed(2)) : 0;

    const stats: CrmCustomerStats = {
      totalOrders,
      completedOrders,
      cancelledOrders,
      totalSpending,
      averageOrderValue,
      lastOrderDate,
    };

    // Derived tags
    const tags: CustomerTag[] = [];
    if (c.is_vip || c.status === 'vip' || totalSpending > 500) tags.push('VIP');
    if (c.customer_type === 'wholesale') tags.push('Wholesale');
    else tags.push('Retail');
    if (new Date().getTime() - new Date(c.created_at || Date.now()).getTime() < 30 * 24 * 60 * 60 * 1000) {
      tags.push('New Customer');
    }

    const isBlocked = Boolean(c.is_blocked || c.status === 'blocked');
    const isActive = c.is_active !== undefined ? Boolean(c.is_active) : !isBlocked;
    const isVip = Boolean(c.is_vip || c.status === 'vip');

    let status: 'active' | 'inactive' | 'blocked' | 'vip' = 'active';
    if (isBlocked) status = 'blocked';
    else if (isVip) status = 'vip';
    else if (!isActive) status = 'inactive';

    const customer: CrmCustomer = {
      id: c.id,
      fullName: c.full_name || c.name || 'عميل بدون اسم',
      phone: c.phone || '0790000000',
      email: c.email || '',
      governorate: c.governorate || (addresses[0]?.governorate) || 'عمان',
      status,
      isActive,
      isVip,
      isBlocked,
      isDeleted: Boolean(c.is_deleted),
      tags,
      notes: c.notes || c.internal_notes || '',
      whatsapp: c.whatsapp || c.phone || '0790000000',
      creditLimit: Number(c.credit_limit) || 0,
      currentBalance: Number(c.current_balance) || 0,
      customerType: c.customer_type === 'wholesale' ? 'wholesale' : 'retail',
      createdAt: c.created_at || new Date().toISOString(),
      updatedAt: c.updated_at,
      totalOrdersCount: totalOrders,
      totalSpending,
      addresses,
      stats,
      orderHistory,
    };

    return { success: true, customer };
  } catch (err: any) {
    console.error('[fetchCustomerDetailsCrmFromSupabase Exception]:', err);
    return { success: false, customer: null, error: err.message };
  }
}

/**
 * Edit Customer Profile
 */
export async function updateCustomerCrmInSupabase(
  customerId: string,
  updates: {
    fullName?: string;
    phone?: string;
    email?: string;
    governorate?: string;
    notes?: string;
    tags?: CustomerTag[];
    customerType?: 'retail' | 'wholesale';
  }
): Promise<{ success: boolean; error?: string }> {
  if (!isSupabaseConfigured || !supabase) {
    return { success: false, error: 'Supabase غير مهيأ' };
  }

  try {
    const payload: any = {
      updated_at: new Date().toISOString(),
    };

    if (updates.fullName !== undefined) payload.full_name = updates.fullName;
    if (updates.phone !== undefined) payload.phone = updates.phone;
    if (updates.email !== undefined) payload.email = updates.email;
    if (updates.governorate !== undefined) payload.governorate = updates.governorate;
    if (updates.notes !== undefined) payload.notes = updates.notes;
    if (updates.customerType !== undefined) payload.customer_type = updates.customerType;

    const { error } = await supabase
      .from('customers')
      .update(payload)
      .eq('id', customerId);

    if (error) {
      console.error('[updateCustomerCrmInSupabase Error]:', error);
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

/**
 * Block or Unblock Customer
 */
export async function toggleCustomerBlockStatusInSupabase(
  customerId: string,
  isBlocked: boolean
): Promise<{ success: boolean; error?: string }> {
  if (!isSupabaseConfigured || !supabase) {
    return { success: false, error: 'Supabase غير مهيأ' };
  }

  try {
    const { error } = await supabase
      .from('customers')
      .update({
        is_blocked: isBlocked,
        status: isBlocked ? 'blocked' : 'active',
        is_active: !isBlocked,
        updated_at: new Date().toISOString(),
      })
      .eq('id', customerId);

    if (error) {
      console.error('[toggleCustomerBlockStatusInSupabase Error]:', error);
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

/**
 * Soft Delete Customer
 */
export async function softDeleteCustomerInSupabase(
  customerId: string
): Promise<{ success: boolean; error?: string }> {
  if (!isSupabaseConfigured || !supabase) {
    return { success: false, error: 'Supabase غير مهيأ' };
  }

  try {
    const { error } = await supabase
      .from('customers')
      .update({
        is_deleted: true,
        is_active: false,
        updated_at: new Date().toISOString(),
      })
      .eq('id', customerId);

    if (error) {
      console.error('[softDeleteCustomerInSupabase Error]:', error);
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

/**
 * Add New Address to Customer
 */
export async function addCustomerAddressInSupabase(
  customerId: string,
  addressData: {
    governorate: string;
    city?: string;
    area: string;
    street: string;
    building?: string;
    floor?: string;
    apartment?: string;
    notes?: string;
    latitude?: number;
    longitude?: number;
  }
): Promise<{ success: boolean; address?: CrmCustomerAddress; error?: string }> {
  if (!isSupabaseConfigured || !supabase) {
    return { success: false, error: 'Supabase غير مهيأ' };
  }

  try {
    const lat = addressData.latitude || 31.9539;
    const lng = addressData.longitude || 35.9106;
    const formattedAddress = `${addressData.governorate} - ${addressData.area} - ${addressData.street}`;
    const mapsUrl = `https://maps.google.com/?q=${lat},${lng}`;

    const { data, error } = await supabase
      .from('customer_addresses')
      .insert({
        customer_id: customerId,
        governorate: addressData.governorate,
        city: addressData.city || addressData.governorate,
        area: addressData.area,
        street: addressData.street,
        building: addressData.building || '',
        floor: addressData.floor || '',
        apartment: addressData.apartment || '',
        notes: addressData.notes || '',
        latitude: lat,
        longitude: lng,
        formatted_address: formattedAddress,
        google_maps_url: mapsUrl,
        location_source: 'gps',
        location_confirmed: true,
        is_default: false,
      })
      .select('*')
      .single();

    if (error) {
      console.error('[addCustomerAddressInSupabase Error]:', error);
      return { success: false, error: error.message };
    }

    const createdAddress: CrmCustomerAddress = {
      id: data.id,
      customerId: data.customer_id,
      governorate: data.governorate,
      city: data.city,
      area: data.area,
      street: data.street,
      building: data.building,
      floor: data.floor,
      apartment: data.apartment,
      notes: data.notes,
      latitude: data.latitude,
      longitude: data.longitude,
      formattedAddress: data.formatted_address,
      googleMapsUrl: data.google_maps_url,
      locationSource: 'gps',
      locationConfirmed: true,
      isDefault: false,
    };

    return { success: true, address: createdAddress };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

/**
 * Subscribe to Supabase Realtime changes for customers & addresses
 */
export function subscribeToCrmRealtime(onChange: () => void): () => void {
  if (!isSupabaseConfigured || !supabase) {
    return () => {};
  }

  const channel = supabase
    .channel('crm_realtime_changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'customers' }, () => {
      onChange();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'customer_addresses' }, () => {
      onChange();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => {
      onChange();
    })
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}
