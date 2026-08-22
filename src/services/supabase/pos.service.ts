import { supabase, isSupabaseConfigured } from '../../lib/supabase';
import { OrderItem, PaymentMethod } from '../../types';
import { jodToMinorUnits, minorUnitsToJod } from '../../utils/receivingCalculations';

export interface PosCustomer {
  id: string;
  name: string;
  phone: string;
}

export interface OpenPosShift {
  id: string;
  shiftNumber: string;
  branchId: string;
  startTime: string;
}

export interface CreatePosSaleInput {
  warehouseId?: string;
  branchId?: string;
  customerId?: string;
  customerName?: string;
  paymentMethod: PaymentMethod;
  items: Array<Pick<OrderItem, 'productId' | 'quantity'>>;
  discountJod: number;
  amountReceivedJod: number;
  idempotencyKey: string;
}

export interface PosSaleResult {
  orderId: string;
  orderNumber: string;
  customerName: string;
  warehouseId: string;
  branchId?: string;
  subtotal: number;
  discount: number;
  totalAmount: number;
  paidAmount: number;
  changeDue: number;
  paymentMethod: PaymentMethod;
  paymentStatus: 'paid' | 'unpaid' | 'partially_paid';
  idempotentReplay: boolean;
  items: Array<{
    id: string;
    productId: string;
    productName: string;
    sku: string;
    quantity: number;
    baseQuantity: number;
    unitsPerSalePackage: number;
    salePackage: string;
    unitPrice: number;
    totalPrice: number;
  }>;
}

export async function fetchPosCustomersFromSupabase(): Promise<PosCustomer[]> {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('الاتصال بقاعدة بيانات Supabase غير متاح.');
  }

  const { data, error } = await supabase
    .from('customers')
    .select('id,full_name,phone')
    .eq('is_active', true)
    .eq('is_blocked', false)
    .eq('is_deleted', false)
    .order('full_name')
    .limit(250);

  if (error) throw error;

  return (data || []).map((customer: any) => ({
    id: customer.id,
    name: customer.full_name || 'عميل',
    phone: customer.phone || '',
  }));
}

export async function fetchOpenPosShiftFromSupabase(
  branchId: string
): Promise<OpenPosShift | null> {
  if (!isSupabaseConfigured || !supabase || !branchId) {
    throw new Error('الاتصال بقاعدة بيانات Supabase أو الفرع غير متاح.');
  }

  const { data, error } = await supabase.rpc('get_open_pos_shift', {
    p_branch_id: branchId,
  });
  if (error) throw new Error(error.message || 'تعذر التحقق من وردية البيع.');
  if (!data?.success) {
    throw new Error(data?.message || 'تعذر التحقق من وردية البيع.');
  }
  if (!data.hasOpenShift || !data.shift) return null;

  return {
    id: String(data.shift.id || ''),
    shiftNumber: String(data.shift.shiftNumber || ''),
    branchId: String(data.shift.branchId || branchId),
    startTime: String(data.shift.startTime || ''),
  };
}

export async function createPosSaleInSupabase(
  input: CreatePosSaleInput
): Promise<{ success: boolean; data?: PosSaleResult; error?: string }> {
  if (!isSupabaseConfigured || !supabase) {
    return {
      success: false,
      error: 'الاتصال بقاعدة بيانات Supabase غير متاح.',
    };
  }

  try {
    const { data, error } = await supabase.rpc('create_pos_sale', {
      p_warehouse_id: input.warehouseId || null,
      p_branch_id: input.branchId || null,
      p_customer_id: input.customerId || null,
      p_customer_name: input.customerName?.trim() || 'زبون نقدي',
      p_payment_method: input.paymentMethod,
      p_items: input.items.map((item) => ({
        product_id: item.productId,
        quantity: Math.floor(Number(item.quantity) || 0),
      })),
      p_discount_in_minor_units: jodToMinorUnits(input.discountJod),
      p_amount_received_in_minor_units: jodToMinorUnits(
        input.amountReceivedJod
      ),
      p_idempotency_key: input.idempotencyKey,
    });

    if (error) {
      return { success: false, error: error.message };
    }

    if (!data?.success) {
      return {
        success: false,
        error: data?.message || 'فشلت عملية البيع المباشر.',
      };
    }

    return {
      success: true,
      data: {
        orderId: data.orderId,
        orderNumber: data.orderNumber,
        customerName: data.customerName || 'زبون نقدي',
        warehouseId: data.warehouseId || input.warehouseId || '',
        branchId: data.branchId || input.branchId || undefined,
        subtotal: minorUnitsToJod(data.subtotalInMinorUnits),
        discount: minorUnitsToJod(data.discountInMinorUnits),
        totalAmount: minorUnitsToJod(data.totalInMinorUnits),
        paidAmount: minorUnitsToJod(data.amountPaidInMinorUnits),
        changeDue: minorUnitsToJod(data.changeDueInMinorUnits),
        paymentMethod: (data.paymentMethod || input.paymentMethod) as PaymentMethod,
        paymentStatus: data.paymentStatus || 'paid',
        idempotentReplay: Boolean(data.idempotentReplay),
        items: (data.items || []).map((item: any) => ({
          id: item.id,
          productId: item.productId,
          productName: item.productName || 'منتج',
          sku: item.sku || '',
          quantity: Number(item.quantity) || 0,
          baseQuantity: Number(item.baseQuantity) || 0,
          unitsPerSalePackage:
            Number(item.unitsPerSalePackage) || 1,
          salePackage: item.salePackage || 'طرد',
          unitPrice: minorUnitsToJod(item.unitPriceInMinorUnits),
          totalPrice: minorUnitsToJod(item.lineTotalInMinorUnits),
        })),
      },
    };
  } catch (error: any) {
    return {
      success: false,
      error: error?.message || 'تعذر الاتصال بقاعدة بيانات Supabase.',
    };
  }
}

function storefrontReceiptUrl(receiptToken: string): string {
  const environment = (
    import.meta as ImportMeta & { env?: Record<string, string | undefined> }
  ).env;
  const baseUrl =
    environment?.VITE_STOREFRONT_PUBLIC_URL?.trim() ||
    'https://nawasrah-store.pages.dev';
  return `${baseUrl.replace(/\/+$/, '')}/#receipt=${encodeURIComponent(receiptToken)}`;
}

export async function getOrCreatePublicPosReceiptUrlFromSupabase(
  orderId: string
): Promise<string> {
  if (!isSupabaseConfigured || !supabase || !orderId) {
    throw new Error('الاتصال بقاعدة بيانات Supabase أو رقم الفاتورة غير متاح.');
  }

  const { data, error } = await supabase.rpc(
    'get_or_create_pos_receipt_token',
    { p_order_id: orderId }
  );

  if (error) {
    throw new Error(error.message || 'تعذر إنشاء رابط الإيصال.');
  }
  if (!data?.success || !data.receiptToken) {
    throw new Error(data?.message || 'تعذر إنشاء رابط الإيصال.');
  }

  return storefrontReceiptUrl(String(data.receiptToken));
}
