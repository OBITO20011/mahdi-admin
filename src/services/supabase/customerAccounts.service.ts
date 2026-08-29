import { isSupabaseConfigured, supabase } from '../../lib/supabase';

export interface CustomerOutstandingOrder {
  id: string;
  orderNumber: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  totalAmount: number;
  amountPaid: number;
  amountDue: number;
  paymentStatus: 'unpaid' | 'partially_paid';
  createdAt: string;
}

export async function fetchCustomerOutstandingOrders(params?: {
  page?: number;
  pageSize?: number;
  search?: string;
}): Promise<{
  success: boolean;
  orders: CustomerOutstandingOrder[];
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
  summary: { amount: number; customers: number };
  error?: string;
}> {
  const page = Math.max(1, Math.trunc(params?.page || 1));
  const pageSize = Math.min(100, Math.max(1, Math.trunc(params?.pageSize || 25)));
  const empty = {
    success: false,
    orders: [] as CustomerOutstandingOrder[],
    page,
    pageSize,
    totalCount: 0,
    totalPages: 1,
    summary: { amount: 0, customers: 0 },
  };
  if (!isSupabaseConfigured || !supabase) {
    return {
      ...empty,
      error: 'لم يتم إعداد الاتصال بقاعدة بيانات Supabase.',
    };
  }

  try {
    const { data, error } = await supabase
      .rpc('get_customer_outstanding_orders_page', {
        p_page: page,
        p_page_size: pageSize,
        p_search: params?.search?.trim() || null,
      });

    if (error) return { ...empty, error: error.message };

    const payload = data && typeof data === 'object' ? data as {
      orders?: unknown[];
      total_count?: unknown;
      summary?: Record<string, unknown>;
    } : {};
    const orders = (Array.isArray(payload.orders) ? payload.orders : []).map((order: any) => {
      const totalAmount = Number(order.total_in_minor_units || 0) / 1000;
      const amountPaid = Number(order.amount_paid_in_minor_units || 0) / 1000;
      return {
        id: order.id,
        orderNumber: order.order_number,
        customerId: order.customer_id,
        customerName: order.customer_name || 'عميل مسجل',
        customerPhone: order.customer_phone || '',
        totalAmount,
        amountPaid,
        amountDue: Number(order.amount_due_in_minor_units || 0) / 1000,
        paymentStatus: order.payment_status === 'partially_paid' ? 'partially_paid' : 'unpaid',
        createdAt: order.created_at,
      } satisfies CustomerOutstandingOrder;
    });
    const totalCount = Math.max(0, Number(payload.total_count) || 0);
    const summary = payload.summary || {};

    return {
      success: true,
      orders,
      page,
      pageSize,
      totalCount,
      totalPages: Math.max(1, Math.ceil(totalCount / pageSize)),
      summary: {
        amount: Number(summary.due_in_minor_units || 0) / 1000,
        customers: Number(summary.customer_count) || 0,
      },
    };
  } catch (error: any) {
    return {
      ...empty,
      error: error?.message || 'تعذر تحميل ذمم العملاء.',
    };
  }
}

export interface RecordCustomerPaymentInput {
  orderId: string;
  amount: number;
  paymentMethod: 'cash' | 'cliq' | 'card' | 'bank_transfer' | 'cheque';
  referenceNumber?: string;
  notes?: string;
  idempotencyKey: string;
}

export async function recordCustomerOrderPayment(
  input: RecordCustomerPaymentInput
): Promise<{
  success: boolean;
  paymentNumber?: string;
  remainingAmount?: number;
  error?: string;
}> {
  if (!isSupabaseConfigured || !supabase) {
    return { success: false, error: 'Supabase غير مهيأ.' };
  }

  const amountInMinorUnits = Math.round(input.amount * 1000);
  if (!Number.isFinite(amountInMinorUnits) || amountInMinorUnits <= 0) {
    return { success: false, error: 'قيمة الدفعة يجب أن تكون أكبر من صفر.' };
  }

  try {
    const { data, error } = await supabase.rpc(
      'record_customer_order_payment_once',
      {
        p_order_id: input.orderId,
        p_amount_in_minor_units: amountInMinorUnits,
        p_payment_method: input.paymentMethod,
        p_reference_number: input.referenceNumber || null,
        p_notes: input.notes || null,
        p_idempotency_key: input.idempotencyKey,
      }
    );

    if (error) return { success: false, error: error.message };

    return {
      success: true,
      paymentNumber: data?.payment_number,
      remainingAmount:
        Number(data?.remaining_in_minor_units || 0) / 1000,
    };
  } catch (error: any) {
    return {
      success: false,
      error: error?.message || 'تعذر تسجيل الدفعة.',
    };
  }
}
