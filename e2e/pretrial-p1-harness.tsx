import {createRoot} from 'react-dom/client';
import '../src/index.css';
import {SupplierReplacementQuantities} from '../src/features/inventory/SupplierReplacementQuantities';
import {RejectionNotice} from '../src/components/common/RejectionNotice';
import type {SupplierReplacementCase,SupplierReplacementPage} from '../src/utils/supplierReplacement';
const row=(id:string,productId:string,productName:string,unit:string,quantity:number):SupplierReplacementCase=>({
  id,productId,productName,supplierId:'supplier',supplierName:'المورد',warehouseId:'warehouse',branchId:'branch',origin:'shop',
  quantity:Math.max(1,quantity),commercialQuantity:Math.max(1,quantity),unitsPerCommercialUnit:1,unitName:unit,baseUnitName:unit,
  pendingQuantity:quantity,receivedQuantity:0,writtenOffQuantity:0,occurredAt:'2026-10-21T10:00:00Z',events:[],
});
const data:SupplierReplacementPage={contractVersion:208,page:1,pageSize:25,totalCount:80,pendingQuantity:999,
  cases:[row('1','juice','عصير','باكيت',2),row('2','juice','عصير','باكيت',3),row('3','rice','أرز','شوال',1),
    ...Array.from({length:22},(_,i)=>row('closed'+i,'old'+i,'صنف مغلق','قنينة',0))]};
createRoot(document.getElementById('root')!).render(<main dir="rtl" className="mx-auto max-w-2xl space-y-5 bg-nw-bg p-4 text-nw-text">
  <h1>الكميات حسب الصنف</h1><SupplierReplacementQuantities data={data}/>
  <section aria-label="رفض معروف"><RejectionNotice reason="SUPPLIER_REPLACEMENT_EXCEEDS_PENDING: internal detail"/></section>
  <section aria-label="رفض غير معروف"><RejectionNotice reason="FUTURE_REJECTION_CODE: hidden database detail"/></section>
</main>);
