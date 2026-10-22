import {FormFields, Card, UiButton, DataTable, Tr, Th, Td,ReceivingUnitFields,type ReceivingUnitMode} from '../../components/ui';
import {WarehouseChoice} from '../../components/ui/WarehouseChoice';
/**
 * Nawasrah Business Manager - Goods Receiving (GRN) Modal Component
 */

import React, { useState, useEffect, useRef } from 'react';
import {useDialogFocus} from '../../hooks/useDialogFocus';
import { useAppStoreSelector, storeEngine } from '../../stores/useAppStore';
import { PurchaseOrder, ReceivePurchaseOrderInput } from '../../types/purchases';
import { receivePurchaseOrderInSupabase } from '../../services/supabase/purchases.service';
import {fetchProductsForReceivingFromSupabase} from '../../services/supabase/directReceiving.service';
import type {ReceivingProduct} from '../../types/directReceiving';
import {ReceivingPurchaseHint} from './ReceivingPurchaseHint';
import {ReceivingProductPriceEditor} from './ReceivingProductPriceEditor';
import {useReceivingPurchaseContexts} from '../../hooks/useReceivingPurchaseContexts';
import {quoteForQuantity} from '../../utils/receivingPurchaseContext';
import {useAuthStore} from '../../stores/useAuthStore';
import {jodToMinorUnits,minorUnitsToJod,normalizeIntegerQuantity} from '../../utils/receivingCalculations';
import {
  X,
  Truck,
  AlertTriangle,
  CheckCircle2,
} from 'lucide-react';
import { CURRENCY } from '../../constants';

interface ReceiveGoodsModalProps {
  isOpen: boolean;
  po: PurchaseOrder | null;
  onClose: () => void;
  onSuccess: () => void;
}

interface ReceiveRow {
  purchaseOrderItemId: string;
  productId: string;
  productName: string;
  sku: string;
  unit: string;
  orderedQuantity: number;
  previouslyReceivedQuantity: number;
  remainingQuantity: number;
  thisReceiptQuantity: number;
  unitCost: number; // JOD
  receivingMode:ReceivingUnitMode;
  packageQuantity:number;unitsPerPackage:number;packagePriceJod:number;packageName:string;
  productDefaults?:ReceivingProduct;
}

export const ReceiveGoodsModal = ({
  isOpen,
  po,
  onClose,
  onSuccess,
}: ReceiveGoodsModalProps) => {
  const warehouses = useAppStoreSelector((state) => state.warehouses);
  const activeBranchId=useAppStoreSelector(state=>state.activeBranch?.id);

  const [selectedWarehouseId, setSelectedWarehouseId] = useState<string>('');
  const [supplierDeliveryNote, setSupplierDeliveryNote] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [items, setItems] = useState<ReceiveRow[]>([]);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [editingProductId,setEditingProductId]=useState<string|null>(null);
  const {roles,roleName}=useAuthStore();
  const canEditSale=[...roles,roleName].some(role=>role!==null&&['owner','admin','manager','warehouse_keeper'].includes(role));
  const purchaseRead=useReceivingPurchaseContexts(items.map(item=>item.productId),isOpen);
  const priceTouched=useRef(new Set<string>()),hintApplied=useRef(new Set<string>());
  const currentReceiptKey=useRef('');
  currentReceiptKey.current=isOpen?(po?.id??''):'';
  useEffect(()=>{
    if(!isOpen||purchaseRead.status!=='ready')return;
    setItems(current=>current.map(item=>{
      if(hintApplied.current.has(item.purchaseOrderItemId)||priceTouched.current.has(item.purchaseOrderItemId))return item;
      hintApplied.current.add(item.purchaseOrderItemId);const quote=purchaseRead.quotes[item.productId];if(!quote)return item;
      return item.receivingMode==='package'?{...item,packagePriceJod:minorUnitsToJod(quoteForQuantity(quote,item.unitsPerPackage))}:{...item,unitCost:minorUnitsToJod(quoteForQuantity(quote,1))};
    }));
  },[isOpen,purchaseRead.status,purchaseRead.quotes,items.length]);
  const refreshEditedSaleQuote=async(productId:string)=>{
    const receiptKey=currentReceiptKey.current;
    try{const [product]=await fetchProductsForReceivingFromSupabase({productId,limit:1});if(product&&receiptKey&&currentReceiptKey.current===receiptKey)setItems(current=>current.map(item=>item.productId===productId?{...item,productDefaults:product}:item));}
    catch{if(receiptKey&&currentReceiptKey.current===receiptKey)storeEngine.setToast('تعذر تحديث سعر البيع؛سطر الاستلام محفوظ.','error');}
  };
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const idempotencyKey = useRef(crypto.randomUUID());
  const panel = useDialogFocus(isOpen, () => { if (!isSubmitting) onClose(); }, true);

  useEffect(() => {
    if (isOpen && po?.id) idempotencyKey.current = crypto.randomUUID();
  }, [isOpen, po?.id]);

  useEffect(() => {
    if (isOpen && po) {
      priceTouched.current.clear();hintApplied.current.clear();
      setSelectedWarehouseId(po.warehouseId || (warehouses[0]?.id || ''));
      setSupplierDeliveryNote('');
      setNotes('');
      setErrorMsg(null);

      // Map items
      const mapped = po.items.map((item) => {
        const remaining = Math.max(0, item.orderedQuantity - item.receivedQuantity);
        return {
          purchaseOrderItemId: item.id,
          productId: item.productId,
          productName: item.productName,
          sku: item.sku,
          unit: item.unit,
          orderedQuantity: item.orderedQuantity,
          previouslyReceivedQuantity: item.receivedQuantity,
          remainingQuantity: remaining,
          thisReceiptQuantity: remaining, // default receive all remaining
          unitCost: item.purchasePrice,
          receivingMode:'base_unit' as ReceivingUnitMode,
          packageQuantity:0,unitsPerPackage:1,packagePriceJod:0,packageName:'طرد',
        };
      });

      setItems(mapped);
    }
  }, [isOpen, po, warehouses]);

  useEffect(()=>{
    if(!isOpen||!po)return;
    let active=true;
    Promise.all(Array.from(new Set(po.items.map(item=>item.productId))).map(async productId=>{
      const [product]=await fetchProductsForReceivingFromSupabase({productId,limit:1});
      return product;
    })).then(products=>{
      if(active)setItems(current=>current.map(item=>({...item,productDefaults:products.find(product=>product?.id===item.productId)})));
    }).catch(()=>{if(active)setErrorMsg('تعذر تحميل بيانات طرود الأصناف؛ يمكنك الاستلام بالباكيت أو وحدة المنتج الظاهرة.');});
    return ()=>{active=false;};
  },[isOpen,po]);

  if (!isOpen || !po) return null;

  const handleQuantityChange = (index: number, val: number) => {
    const updated = [...items];
    const item = updated[index];
    const clamped = Math.max(0, Math.min(item.remainingQuantity, val));
    updated[index].thisReceiptQuantity = clamped;
    setItems(updated);
  };

  const handleUnitCostChange = (index: number, val: number) => {
    const updated = [...items];
    priceTouched.current.add(updated[index].purchaseOrderItemId);
    updated[index].unitCost = Math.max(0, val);
    setItems(updated);
  };

  const totalReceivingNow = items.reduce((sum, i) => sum + i.thisReceiptQuantity, 0);

  const changeMode=(index:number,mode:ReceivingUnitMode)=>{
    setItems(current=>current.map((item,i)=>{
      if(i!==index)return item;
      const product=item.productDefaults;
      if(mode==='package'&&(!product||product.unitsPerPackage<=1))return item;
      const units=normalizeIntegerQuantity(product?.unitsPerPackage??1);
      const quote=purchaseRead.status==='ready'?purchaseRead.quotes[item.productId]:null;
      const price=quote?quoteForQuantity(quote,units):product?(product.defaultPackagePriceInMinorUnits||product.costPriceInMinorUnits*units):jodToMinorUnits(item.unitCost);
      const count=Math.floor(item.thisReceiptQuantity/units);
      return {...item,receivingMode:mode,unitsPerPackage:mode==='base_unit'?1:units,
        packageQuantity:count,packagePriceJod:minorUnitsToJod(price),packageName:product?.purchaseUnitName??item.packageName,
        thisReceiptQuantity:mode==='package'?count*units:item.thisReceiptQuantity,
        unitCost:mode==='base_unit'?minorUnitsToJod(Math.round(price/units)):item.unitCost};
    }));
  };
  const changePackage=(index:number,field:'quantity'|'contents'|'price'|'name',value:number|string)=>{
    setItems(current=>current.map((item,i)=>{
      if(i!==index||item.receivingMode!=='package')return item;
      if(field==='price')priceTouched.current.add(item.purchaseOrderItemId);
      const updated={...item};
      if(field==='contents')updated.unitsPerPackage=normalizeIntegerQuantity(Number(value));
      if(field==='quantity')updated.packageQuantity=Math.max(0,Math.floor(Number(value)||0));
      if(field==='price')updated.packagePriceJod=Math.max(0,Number(value)||0);
      if(field==='name')updated.packageName=String(value);
      updated.packageQuantity=Math.min(updated.packageQuantity,Math.floor(updated.remainingQuantity/updated.unitsPerPackage));
      updated.thisReceiptQuantity=updated.packageQuantity*updated.unitsPerPackage;
      return updated;
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if(editingProductId!==null)return;
    setErrorMsg(null);

    if (totalReceivingNow <= 0) {
      setErrorMsg('يرجى تحديد كمية أكبر من صفر لمنتج واحد على الأقل للاستلام.');
      return;
    }

    if (!selectedWarehouseId) {
      setErrorMsg('يرجى اختيار المستودع المستلم للبضائع.');
      return;
    }

    for (const item of items) {
      if (item.thisReceiptQuantity > item.remainingQuantity) {
        setErrorMsg(`الكمية المستلمة للمنتج (${item.productName}) تتجاوز الكمية المتبقية.`);
        return;
      }
    }

    setIsSubmitting(true);
    try {

      const input: ReceivePurchaseOrderInput = {
        idempotencyKey: idempotencyKey.current,
        purchaseOrderId: po.id,
        warehouseId: selectedWarehouseId,
        supplierDeliveryNote: supplierDeliveryNote.trim() || undefined,
        notes: notes.trim() || undefined,
        items: items
          .filter((i) => i.thisReceiptQuantity > 0)
          .map((i) => ({
            purchaseOrderItemId: i.purchaseOrderItemId,
            productId: i.productId,
            receivedQuantity: i.thisReceiptQuantity,
            unitCost: i.unitCost,
            baseUnitName: i.unit,
            ...(i.receivingMode==='package'?{packagePricing:{packageQuantity:i.packageQuantity,
              unitsPerPackage:i.unitsPerPackage,packagePriceInMinorUnits:jodToMinorUnits(i.packagePriceJod)}}:{}),
          })),
      };

      const res = await receivePurchaseOrderInSupabase(input);


      if (res.success) {
        storeEngine.setToast('تم استلام البضائع وزيادة المخزون بنجاح', 'success');
        onSuccess();
        onClose();
      } else {
        setErrorMsg(res.error || 'حدث خطأ أثناء استلام البضائع');
      }

    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <FormFields ref={panel as React.RefObject<HTMLDivElement>} tabIndex={-1} role="dialog" aria-modal="true" aria-label="استلام البضائع" aria-busy={isSubmitting} className="nw-purchasing-fields fixed inset-0 z-50 flex items-center justify-center bg-nw-overlay backdrop-blur-sm p-3 sm:p-4 overflow-y-auto">
      <Card padded={false} className="bg-nw-surface border border-nw-border rounded-3xl w-full max-w-3xl shadow-2xl overflow-hidden my-auto flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="bg-nw-surface-2 px-5 py-4 border-b border-nw-border flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-nw-info-bg border border-nw-border flex items-center justify-center text-nw-info font-bold">
              <Truck className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-nw-text flex items-center gap-2">
                <span>استلام بضاعة</span>
                <span className="text-xs bg-nw-surface-2 px-2 py-0.5 rounded border border-nw-border text-nw-info">
                  {po.purchaseOrderNumber}
                </span>
              </h2>
              <p className="text-xs text-nw-muted">
                تسجيل الكميات الموردة فعلياً لزيادة رصيد المستودع وتحديث متوسط التكلفة
              </p>
            </div>
          </div>
          <UiButton variant="plain"
            type="button"
            aria-label="إغلاق استلام البضائع"
            disabled={isSubmitting}
            onClick={onClose}
            className="w-11 h-11 rounded-xl bg-nw-surface-2 text-nw-text hover:text-nw-text flex items-center justify-center transition h-auto min-h-11 min-w-0 whitespace-normal"
          >
            <X className="w-5 h-5" />
          </UiButton>
        </div>

        {/* Body Form */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4 overflow-y-auto flex-1 text-xs">
          {errorMsg && (
            <div className="bg-nw-bad-bg border border-nw-border p-3 rounded-2xl text-nw-bad flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 text-nw-bad" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Supplier Info & Warehouse Header */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-nw-bg p-3.5 rounded-2xl border border-nw-border">
            <div>
              <span className="text-nw-muted block mb-0.5">المورد:</span>
              <span className="font-bold text-nw-text text-sm">{po.supplierName}</span>
            </div>

            <div>
              <label className="font-bold text-nw-text block mb-1">المستودع المستلم:</label>
              <WarehouseChoice options={warehouses} branchId={po.branchId||activeBranchId} value={selectedWarehouseId}
                onSingle={setSelectedWarehouseId} preserveSelected={!!po.warehouseId}>
              <select aria-label="المستودع"
                value={selectedWarehouseId}
                onChange={(e) => setSelectedWarehouseId(e.target.value)}
                required
                className="w-full bg-nw-surface-2 border border-nw-border rounded-xl px-2.5 py-1.5 text-nw-text font-semibold focus:outline-none focus:border-nw-border"
              >
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
              </WarehouseChoice>
            </div>

            <div>
              <label className="font-bold text-nw-text block mb-1">رقم وصل المورد (اختياري)</label>
              <input aria-label="رقم وصل المورد (اختياري)"
                type="text"
                value={supplierDeliveryNote}
                onChange={(e) => setSupplierDeliveryNote(e.target.value)}
                placeholder="رقم وصل المورد (اختياري)"
                className="w-full bg-nw-surface-2 border border-nw-border rounded-xl px-2.5 py-1.5 text-nw-text focus:outline-none focus:border-nw-border"
              />
            </div>
          </div>

          {/* Items Table */}
          <div className="space-y-3">
            {items.map((item,index)=><Card key={item.purchaseOrderItemId} data-receiving-line={item.purchaseOrderItemId}>
              <h3 className="mb-2 text-sm font-bold text-nw-text">{item.productName}</h3>
              <p className="text-sm text-nw-muted">المطلوب: {item.orderedQuantity} {item.unit} · المستلم: {item.previouslyReceivedQuantity} {item.unit} · المتبقي: {item.remainingQuantity} {item.unit}</p>
              <ReceivingUnitFields unitName={item.unit} mode={item.receivingMode}
                hasPackage={(item.productDefaults?.unitsPerPackage??1)>1} minimum={0} disabled={isSubmitting}
                quantity={item.receivingMode==='package'?item.packageQuantity:item.thisReceiptQuantity}
                unitsPerPackage={item.receivingMode==='package'?item.unitsPerPackage:1}
                priceJod={item.receivingMode==='package'?item.packagePriceJod:item.unitCost}
                packageName={item.packageName} maximum={item.receivingMode==='package'?Math.floor(item.remainingQuantity/item.unitsPerPackage):item.remainingQuantity}
                onMode={mode=>changeMode(index,mode)}
                onQuantity={value=>item.receivingMode==='package'?changePackage(index,'quantity',value):handleQuantityChange(index,value)}
                onContents={value=>changePackage(index,'contents',value)}
                onPrice={value=>item.receivingMode==='package'?changePackage(index,'price',value):handleUnitCostChange(index,value)}
                onPackageName={value=>changePackage(index,'name',value)}/>
              <ReceivingPurchaseHint status={purchaseRead.status} error={purchaseRead.error} quote={purchaseRead.quotes[item.productId]} unitName={item.unit} units={item.receivingMode==='package'?item.unitsPerPackage:1} priceInMinorUnits={jodToMinorUnits(item.receivingMode==='package'?item.packagePriceJod:item.unitCost)} saleQuote={item.productDefaults?.saleQuote??null} onEditSale={canEditSale&&!isSubmitting?()=>setEditingProductId(item.productId):undefined}/>
            </Card>)}
            <div role="status" className="space-y-1 text-sm font-semibold text-nw-info" aria-label="الكميات الداخلة حسب الصنف">{items.filter(item=>item.thisReceiptQuantity>0).map(item=><p key={item.purchaseOrderItemId}>{item.productName}: {item.thisReceiptQuantity} {item.unit}</p>)}</div>
          </div>
          <details>
          <summary className="text-sm text-nw-muted">تفاصيل أمر الشراء بمحتوى الطرود</summary>
          <div className="space-y-2">
            <h3 className="font-bold text-nw-text text-sm flex items-center justify-between">
              <span>جدول فحص واستلام الأصناف:</span>
              <span className="text-xs text-nw-info font-normal">
                الكميات حسب الصنف ووحدته
              </span>
            </h3>

            <div className="border border-nw-border rounded-2xl overflow-hidden bg-nw-bg">
              <div className="overflow-x-auto">
                <DataTable caption="كميات الاستلام" className="w-full text-right text-xs">
                  <thead className="bg-nw-surface-2 text-nw-text font-bold border-b border-nw-border">
                    <Tr>
                      <Th className="p-3">اسم المنتج</Th>
                      <Th className="p-3 w-20 text-center">المطلوب</Th>
                      <Th className="p-3 w-20 text-center">المستلم سابقاً</Th>
                      <Th className="p-3 w-20 text-center text-nw-warn">المتبقي</Th>
                      <Th className="p-3 w-28 text-center text-nw-info">الكمية المستلمة الآن</Th>
                      <Th className="p-3 w-32 text-center">تكلفة الوحدة ({CURRENCY})</Th>
                    </Tr>
                  </thead>
                  <tbody className="divide-y divide-nw-border">
                    {items.map((item, index) => (
                      <Tr key={index} className="hover:bg-nw-surface-2 transition">
                        <Td className="p-3 font-semibold text-nw-text">
                          <div>{item.productName}</div>
                          <div className="text-[10px] text-nw-muted font-mono">
                            رمز الصنف: {item.sku} ({item.unit})
                          </div>
                        </Td>
                        <Td className="p-3 text-center font-bold text-nw-text">{item.orderedQuantity}</Td>
                        <Td className="p-3 text-center text-nw-muted">{item.previouslyReceivedQuantity}</Td>
                        <Td className="p-3 text-center font-black text-nw-warn">{item.remainingQuantity}</Td>
                        <Td className="p-3">
                          <input aria-label="الكمية المستلمة الآن" disabled={item.receivingMode==='package'||isSubmitting}
                            type="number"
                            min="0"
                            max={item.remainingQuantity}
                            value={item.thisReceiptQuantity}
                            onChange={(e) => handleQuantityChange(index, parseInt(e.target.value) || 0)}
                            className="w-full bg-nw-surface-2 border border-nw-border rounded-xl px-2 py-1.5 text-center font-black text-nw-info focus:outline-none focus:border-nw-border text-sm"
                          />
                        </Td>
                        <Td className="p-3">
                          <input aria-label="تكلفة الوحدة" disabled={item.receivingMode==='package'||isSubmitting}
                            type="number"
                            step="0.001"
                            min="0"
                            value={item.unitCost}
                            onChange={(e) => handleUnitCostChange(index, parseFloat(e.target.value) || 0)}
                            className="w-full bg-nw-surface-2 border border-nw-border rounded-xl px-2 py-1.5 text-center font-bold text-nw-text focus:outline-none focus:border-nw-border"
                          />
                        </Td>
                      </Tr>
                    ))}
                  </tbody>
                </DataTable>
              </div>
            </div>
          </div>
          </details>

          {/* Receipt Notes */}
          <div>
            <label className="font-bold text-nw-text block mb-1">ملاحظات سند الاستلام:</label>
            <input aria-label="حالة الشحنة، ملاحظات الجودة والتلف إن وجد..."
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="حالة الشحنة، ملاحظات الجودة والتلف إن وجد..."
              className="w-full bg-nw-surface-2 border border-nw-border rounded-xl p-2.5 text-nw-text focus:outline-none focus:border-nw-border"
            />
          </div>

          {/* Submit Action */}
          <div className="pt-3 border-t border-nw-border flex items-center justify-end gap-3 shrink-0">
            <UiButton variant="plain"
              type="button"
              disabled={isSubmitting}
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-nw-surface-2 text-nw-text hover:bg-nw-surface-2 font-bold transition h-auto min-h-11 min-w-0 whitespace-normal"
            >
              إلغاء
            </UiButton>
            <UiButton variant="plain"
              type="submit"
              disabled={isSubmitting || editingProductId!==null || totalReceivingNow <= 0}
              className="px-6 py-2 rounded-xl bg-nw-accent text-nw-on-accent font-bold transition shadow-lg disabled:opacity-50 flex items-center gap-2 h-auto min-h-11 min-w-0 whitespace-normal"
            >
              {isSubmitting ? (
                <span>جاري تحديث المخزون...</span>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  <span>تأكيد الاستلام وزيادة المخزون</span>
                </>
              )}
            </UiButton>
          </div>
        </form>
      </Card>
      {editingProductId&&<ReceivingProductPriceEditor productId={editingProductId} onClose={()=>setEditingProductId(null)} onSavedOrClosed={()=>void refreshEditedSaleQuote(editingProductId)}/>}
    </FormFields>
  );
};
