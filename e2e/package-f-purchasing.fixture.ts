import type {PurchaseOrder} from '../src/types/purchases';
import type {SupplierReceipt} from '../src/types/directReceiving';
export const supplierId='88888888-8888-4888-8888-000000000201';
export const warehouseId='88888888-8888-4888-8888-000000000202';
export const branchId='88888888-8888-4888-8888-000000000203';
export const productId='88888888-8888-4888-8888-000000000001';
export const supplierRow={id:supplierId,company_name:'شركة النواصرة للتوريد',contact_person:'أحمد',phone:'0791234567',email:'supplier@example.com',address:'الرمثا',is_active:true,current_balance_in_minor_units:600000};
export const otherSupplierRow={...supplierRow,id:'88888888-8888-4888-8888-000000000200',company_name:'الأمانة للتوريد',current_balance_in_minor_units:200000};
export const warehouseRow={id:warehouseId,name_ar:'المستودع الرئيسي',name:'المستودع الرئيسي',branch_id:branchId,code:'MAIN',location:'الرمثا',is_active:true};
export const branchRow={id:branchId,name_ar:'فرع الرمثا',name:'فرع الرمثا',is_active:true,address:'وسط البلد',city:'الرمثا'};
export const purchaseOrders:PurchaseOrder[]=(['draft','partially_received','received'] as const).map((status,i)=>({
 id:`88888888-8888-4888-8888-${String(301+i).padStart(12,'0')}`,purchaseOrderNumber:`PO-1048${i}`,supplierId,supplierName:supplierRow.company_name,
 warehouseId,warehouseName:warehouseRow.name_ar,branchId,branchName:branchRow.name_ar,status,orderDate:'2026-10-09T08:00:00Z',
 subtotal:1000,discount:20,deliveryFee:20,totalAmount:1000,amountPaid:i?400:0,amountDue:i?600:1000,supplierInvoiceNumber:`INV-24${i}`,
 createdAt:'2026-10-09T08:00:00Z',updatedAt:'2026-10-09T08:00:00Z',notes:'توريد باكيتات وكرتونات',items:[{
 id:`88888888-8888-4888-8888-${String(401+i).padStart(12,'0')}`,purchaseOrderId:`88888888-8888-4888-8888-${String(301+i).padStart(12,'0')}`,
 productId,productName:'عصير برتقال 250مل',sku:'INV-0001',barcode:'6251234500001',unit:'باكيت',orderedQuantity:48,receivedQuantity:i===2?48:i===1?12:0,purchasePrice:20,discount:0,lineTotal:960,
 }],payments:i?[{id:'payment-fixture',supplierId,supplierName:supplierRow.company_name,amount:400,paymentMethod:'cash',paymentDate:'2026-10-09T09:00:00Z',createdAt:'2026-10-09T09:00:00Z'}]:[],receipts:[],
}));
export const poRows=purchaseOrders.map(p=>({id:p.id,purchase_order_number:p.purchaseOrderNumber,supplier_id:supplierId,warehouse_id:warehouseId,branch_id:branchId,status:p.status,order_date:p.orderDate,created_at:p.createdAt,updated_at:p.updatedAt,
 subtotal_in_minor_units:1000000,discount_in_minor_units:20000,delivery_fee_in_minor_units:20000,total_in_minor_units:1000000,amount_paid_in_minor_units:p.amountPaid*1000,
 supplier_invoice_number:p.supplierInvoiceNumber,suppliers:supplierRow,warehouses:warehouseRow,branches:branchRow,purchase_receipts:[],
 supplier_payments:(p.payments??[]).map(x=>({id:x.id,amount_in_minor_units:x.amount*1000,payment_method:x.paymentMethod,payment_date:x.paymentDate,created_at:x.createdAt})),
 purchase_order_items:p.items.map(x=>({id:x.id,purchase_order_id:p.id,product_id:productId,ordered_quantity:x.orderedQuantity,received_quantity:x.receivedQuantity,purchase_price_in_minor_units:20000,discount_in_minor_units:0,line_total_in_minor_units:960000,products:{id:productId,name_ar:x.productName,sku:x.sku,barcode:x.barcode,base_unit:{name_ar:'باكيت'}}})),
}));
export const receipt:SupplierReceipt={id:'88888888-8888-4888-8888-000000000501',receiptNumber:'GR-10481',supplierId,supplierName:supplierRow.company_name,supplierPhone:supplierRow.phone,
 warehouseId,warehouseName:warehouseRow.name_ar,branchId,branchName:branchRow.name_ar,receivedAt:'2026-10-09T10:00:00Z',receivedByName:'مهدي',supplierInvoiceNumber:'INV-245',
 subtotalInMinorUnits:1000000,discountInMinorUnits:0,deliveryFeeInMinorUnits:0,taxInMinorUnits:0,totalInMinorUnits:1000000,amountPaidInMinorUnits:400000,amountDueInMinorUnits:600000,
 paymentStatus:'partially_paid',paymentMethod:'cash',status:'completed',isArchived:false,createdAt:'2026-10-09T10:00:00Z',updatedAt:'2026-10-09T10:00:00Z',
 items:[{id:'receipt-item',supplierReceiptId:'88888888-8888-4888-8888-000000000501',productId,productName:'عصير برتقال 250مل',productSku:'INV-0001',purchaseUnitName:'كرتونة',baseUnitName:'باكيت',packageQuantity:2,unitsPerPackage:24,totalBaseUnits:48,packagePriceInMinorUnits:500000,baseUnitCostInMinorUnits:20833,discountInMinorUnits:0,lineTotalInMinorUnits:1000000,createdAt:'2026-10-09T10:00:00Z'}],
 payments:[{id:'88888888-8888-4888-8888-000000000502',supplierId,amountInMinorUnits:400000,paymentMethod:'cash',paymentDate:'2026-10-09T10:00:00Z',createdAt:'2026-10-09T10:00:00Z'}],
};
export const receiptRow={id:receipt.id,receipt_number:receipt.receiptNumber,supplier_id:supplierId,warehouse_id:warehouseId,branch_id:branchId,received_at:receipt.receivedAt,created_at:receipt.createdAt,
 subtotal_in_minor_units:1000000,discount_in_minor_units:0,delivery_fee_in_minor_units:0,tax_in_minor_units:0,total_in_minor_units:1000000,amount_paid_in_minor_units:400000,amount_due_in_minor_units:600000,
 payment_status:'partially_paid',payment_method:'cash',status:'completed',is_archived:false,suppliers:supplierRow,warehouses:warehouseRow,branches:branchRow,profiles:{full_name:'مهدي'},
 supplier_receipt_items:[{id:'receipt-item',supplier_receipt_id:receipt.id,product_id:productId,products:{name_ar:'عصير برتقال 250مل',sku:'INV-0001'},purchase_unit_name:'كرتونة',base_unit_name:'باكيت',package_quantity:2,units_per_package:24,total_base_units:48,package_price_in_minor_units:500000,base_unit_cost_in_minor_units:20833,line_total_in_minor_units:1000000}],
 supplier_payments:[{id:receipt.payments![0].id,supplier_id:supplierId,supplier_receipt_id:receipt.id,amount_in_minor_units:400000,payment_method:'cash',payment_date:receipt.receivedAt,created_at:receipt.receivedAt,is_reversed:false}],
};
