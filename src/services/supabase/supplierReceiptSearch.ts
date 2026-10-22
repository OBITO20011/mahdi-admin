import type {SupabaseClient} from '@supabase/supabase-js';

export interface SupplierReceiptSearchParams {
  page: number;
  pageSize: number;
  search: string;
  supplierId?: string;
  warehouseId?: string;
  paymentStatus?: string;
  isArchived?: boolean;
}

/** Server-side parent filtering and pagination; full item rows use separate embeds. */
export function searchSupplierReceiptRows(client: SupabaseClient, params: SupplierReceiptSearchParams) {
  const pattern = `%${params.search.trim()}%`;
  const literal = `"${pattern.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
  let query = client.from('supplier_receipts').select(`
    *, suppliers(company_name,phone), warehouses(name_ar), branches(name_ar),
    profiles!supplier_receipts_received_by_fkey(full_name),
    supplier_receipt_items(*,products(name_ar,sku,barcode)),
    search_supplier:suppliers(),
    search_items:supplier_receipt_items(products!inner())
  `, {count: 'exact'})
    .eq('is_archived', params.isArchived ?? false)
    .ilike('search_supplier.company_name', pattern)
    .ilike('search_items.products.name_ar', pattern)
    .or(`receipt_number.ilike.${literal},supplier_invoice_number.ilike.${literal},search_supplier.not.is.null,search_items.not.is.null`)
    .order('received_at', {ascending: false}).order('id', {ascending: false})
    .range((params.page - 1) * params.pageSize, params.page * params.pageSize - 1);
  if (params.supplierId) query = query.eq('supplier_id', params.supplierId);
  if (params.warehouseId) query = query.eq('warehouse_id', params.warehouseId);
  if (params.paymentStatus && params.paymentStatus !== 'all') query = query.eq('payment_status', params.paymentStatus);
  return query;
}
