import { isSupabaseConfigured, supabase } from '../../lib/supabase';
import {
  calculateOrderAmountDue,
  isOperationalOrderSource,
} from '../../utils/orderCalculations';

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

export async function fetchCustomerOutstandingOrders(): Promise<{
  success: boolean;
  orders: CustomerOutstandingOrder[];
  error?: string;
}> {
  if (!isSupabaseConfigured || !supabase) {
    return {
      success: false,
      orders: [],
      error: 'لم يتم إعداد الاتصال بقاعدة بيانات Supabase.',
    };
  }

  try {
    const { data, error } = await supabase
      .from('orders')
      .select(`
        id,
        order_number,
        customer_id,
        customer_name_snapshot,
        total_in_minor_units,
        amount_paid_in_minor_units,
        payment_status,
        source,
        created_at,
        customers (
          full_name,
          phone
        )
      `)
      .eq('status', 'completed')
      .not('customer_id', 'is', null)
      .order('created_at', { ascending: false });

    if (error) return { success: false, orders: [], error: error.message };

    const orders = (data || [])
      .filter((order) => isOperationalOrderSource(order.source))
      .map((order: any) => {
        const relation = Array.isArray(order.customers)
          ? order.customers[0]
          : order.customers;
        const totalAmount =
          Number(order.total_in_minor_units || 0) / 1000;
        const amountPaid =
          Number(order.amount_paid_in_minor_units || 0) / 1000;
        const amountDue = calculateOrderAmountDue(totalAmount, amountPaid);

        return {
          id: order.id,
          orderNumber: order.order_number,
          customerId: order.customer_id,
          customerName:
            relation?.full_name ||
            order.customer_name_snapshot ||
            'عميل مسجل',
          customerPhone: relation?.phone || '',
          totalAmount,
          amountPaid,
          amountDue,
          paymentStatus:
            amountPaid > 0
              ? ('partially_paid' as const)
              : ('unpaid' as const),
          createdAt: order.created_at,
        };
      })
      .filter((order) => order.amountDue > 0);

    return { success: true, orders };
  } catch (error: any) {
    return {
      success: false,
      orders: [],
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
