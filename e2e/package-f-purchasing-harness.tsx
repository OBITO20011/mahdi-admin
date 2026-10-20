import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import '@fontsource/ibm-plex-sans-arabic/400.css';
import '@fontsource/ibm-plex-sans-arabic/500.css';
import '@fontsource/ibm-plex-sans-arabic/600.css';
import '@fontsource/ibm-plex-sans-arabic/700.css';
import '../src/index.css';
import {PurchasesView} from '../src/features/purchases/PurchasesView';
import {DirectReceivingView} from '../src/features/directReceiving/DirectReceivingView';
import {CreatePurchaseOrderModal} from '../src/features/purchases/CreatePurchaseOrderModal';
import {CreateSupplierModal} from '../src/features/purchases/CreateSupplierModal';
import {ReceiveGoodsModal} from '../src/features/purchases/ReceiveGoodsModal';
import {SupplierPaymentModal} from '../src/features/purchases/SupplierPaymentModal';
import {PurchaseOrderDetailView} from '../src/features/purchases/PurchaseOrderDetailView';
import {SupplierReceiptDetailView} from '../src/features/directReceiving/SupplierReceiptDetailView';
import {CreateDirectReceiptModal} from '../src/features/directReceiving/CreateDirectReceiptModal';
import {RecordSupplierPaymentModal} from '../src/features/directReceiving/RecordSupplierPaymentModal';
import {CancelSupplierReceiptDialog} from '../src/features/directReceiving/CancelSupplierReceiptDialog';
import {Modal} from '../src/components/common/Modal';
import {UiButton} from '../src/components/ui';
import {storeEngine,type AppState} from '../src/stores/useAppStore';
import {authStoreEngine,type AuthState} from '../src/stores/useAuthStore';
import {supabase} from '../src/lib/supabase';
import {purchaseOrders,poRows,receipt,receiptRow,supplierRow,otherSupplierRow,warehouseRow,branchRow} from './package-f-purchasing.fixture';
import {inventoryProducts} from './package-f-inventory.fixture';
import {mapAdminProductRecord} from '../src/services/supabase/products.service';
const params=new URLSearchParams(location.search),theme=params.get('theme')==='dark'?'dark':'light';
document.documentElement.classList.toggle('theme-light',theme==='light');document.documentElement.classList.toggle('theme-dark',theme==='dark');document.documentElement.dataset.theme=theme;
if(!supabase||!['localhost','127.0.0.1','[::1]'].includes(new URL(import.meta.env.VITE_SUPABASE_URL ?? '').hostname))throw Error('Purchasing preview requires loopback');
const auth=authStoreEngine as unknown as {state:AuthState;getState:()=>AuthState;initAuth:()=>Promise<void>};
const paymentRole=params.get('role')==='admin'?'admin':params.get('role')==='accountant'?'accountant':params.get('role')==='manager'?'manager':'owner';
auth.state={...auth.getState(),roleName:paymentRole,roles:[paymentRole],isAuthenticated:true,isLoading:false};auth.initAuth=async()=>undefined;
const store=storeEngine as unknown as {state:AppState;getState:()=>AppState};store.state={...store.getState(),warehouses:[{id:warehouseRow.id,name:warehouseRow.name,branchId:branchRow.id,location:'الرمثا'}],branches:[{id:branchRow.id,name:'فرع الرمثا',address:'وسط البلد',city:'الرمثا',phone:''}],activeBranch:{id:branchRow.id,name:'فرع الرمثا',address:'وسط البلد',city:'الرمثا',phone:''}};
storeEngine.setCurrentUser({id:'fixture-owner',name:'مهدي',role:'Owner',themeMode:theme,avatarUrl:''});
const originalRpc=supabase.rpc.bind(supabase),originalFrom=supabase.from.bind(supabase);
const displayLines=(receipt.items??[]).map(item=>({id:item.id,kind:'legacy_single_sku_parcel' as const,commercialQuantity:item.packageQuantity,unitsPerParcel:item.unitsPerPackage,baseUnitName:item.baseUnitName??'باكيت',baseQuantity:item.totalBaseUnits,grossInMinorUnits:item.packageQuantity*item.packagePriceInMinorUnits,lineDiscountInMinorUnits:item.discountInMinorUnits,netInMinorUnits:item.lineTotalInMinorUnits,acquisitionInMinorUnits:item.lineTotalInMinorUnits,components:[{itemId:item.id,productId:item.productId,nameAr:item.productName??null,sku:item.productSku??null,baseQuantity:item.totalBaseUnits,currentSaleUnitPriceInMinorUnits:600}]}));
const displayReceiptRow=params.has('purchase205')?{...receiptRow,subtotal_in_minor_units:100000,total_in_minor_units:100000,amount_paid_in_minor_units:params.has('partial205')?7000:0,amount_due_in_minor_units:params.has('partial205')?93000:100000,payment_status:params.has('partial205')?'partially_paid':'unpaid',payment_method:'cash',supplier_payments:params.has('partial205')?[
 {...receiptRow.supplier_payments[0],amount_in_minor_units:5000,payment_method:'cash'},
 {...receiptRow.supplier_payments[0],id:'payment-cliq',amount_in_minor_units:2000,payment_method:'cliq'},
 {...receiptRow.supplier_payments[0],id:'payment-reversed',amount_in_minor_units:1000,payment_method:'bank_transfer',is_reversed:true},
]:[],supplier_receipt_items:[{...receiptRow.supplier_receipt_items[0],package_quantity:200,units_per_package:1,total_base_units:200,package_price_in_minor_units:500,base_unit_cost_in_minor_units:500,line_total_in_minor_units:100000}]}:receiptRow;
const receivingRows=inventoryProducts.slice(0,3).map((p,index)=>({...p,
 ...(params.has('receivingUnits')?{base_unit:{...p.base_unit,name_ar:index===1?'قنينة':'شوال'},units_per_purchase_unit:index===1?1:24,default_purchase_price_in_minor_units:index===1?50:1000,cost_price_in_minor_units:index===1?50:42}:{}),
 ...(params.has('purchase205')?{category_id:'88888888-8888-4888-8888-000000000080',updated_at:'2026-10-20T08:00:00Z',units_per_purchase_unit:10,units_per_sale_unit:10,base_unit:{id:'88888888-8888-4888-8888-000000000081',code:'PKT',name_ar:'باكيت'},purchase_unit:{id:'88888888-8888-4888-8888-000000000081',code:'PKT',name_ar:'باكيت'},sale_unit:{id:'88888888-8888-4888-8888-000000000082',code:'CTN',name_ar:'كرتونة'},default_purchase_price_in_minor_units:3000,default_sale_price_in_minor_units:6000,sale_price_in_minor_units:600,cost_price_in_minor_units:500}:{}),
 warehouse_balances:[{warehouse_id:warehouseRow.id,on_hand_quantity:100,available_quantity:100,reserved_quantity:0}]}));
if(params.has('roundingSale205'))for(const row of receivingRows){row.units_per_purchase_unit=24;row.units_per_sale_unit=24;row.default_sale_price_in_minor_units=1000;row.sale_price_in_minor_units=42;}
if(params.has('purchaseUnitOnly205'))for(const row of receivingRows){row.units_per_purchase_unit=1;row.default_purchase_price_in_minor_units=500;}
if(params.has('legacySaleBase205'))for(const row of receivingRows){row.base_unit={...row.base_unit,code:'PCS'};row.purchase_unit={id:'88888888-8888-4888-8888-000000000082',code:'CTN',name_ar:'كرتونة'};row.sale_unit={...row.base_unit};row.units_per_sale_unit=1;row.default_sale_price_in_minor_units=600;}
if(params.has('purchase205')){
 store.state={...store.getState(),products:[],categories:[{id:receivingRows[0].category_id,nameAr:'مشروبات'}],brands:[],units:[{id:receivingRows[0].base_unit.id,code:receivingRows[0].base_unit.code,nameAr:'باكيت',conversionFactor:1},{id:'88888888-8888-4888-8888-000000000082',code:'CTN',nameAr:'كرتونة',conversionFactor:24},{id:'88888888-8888-4888-8888-000000000083',code:'PARCEL',nameAr:'طرد',conversionFactor:10}]};
 Object.assign(window,{__receiving205UpdateSale:(price:number)=>{receivingRows[0].default_sale_price_in_minor_units=price*receivingRows[0].units_per_sale_unit;receivingRows[0].sale_price_in_minor_units=price;},__receiving205CachedProducts:()=>store.getState().products.length});
 // Refresh reads stay isolated;the actual versioned product writer is still transported.
 storeEngine.refreshProductsFromSupabase=async()=>undefined;
 storeEngine.refreshInventoryMovementsFromSupabase=async()=>undefined;
 storeEngine.refreshStockNotificationsFromSupabase=async()=>[];
}
const client=supabase as unknown as {rpc:(n:string,a?:Record<string,unknown>)=>unknown;from:(n:string)=>unknown;channel:(n:string)=>unknown;removeChannel:(c:unknown)=>unknown};
client.rpc=(name,args)=>{
 const response=(data:unknown)=>Promise.resolve({data,error:null});
 if(name==='get_receiving_purchase_context'&&!params.has('purchase205')){const data={products:(args?.p_product_ids as string[]).map(productId=>({productId,lastPurchase:null}))};const request=Promise.resolve({data,error:null});return Object.assign(request,{abortSignal:()=>request});}
 if(name==='get_supplier_receipt_display_context'&&!params.has('purchase205'))return response({receiptId:receipt.id,lines:displayLines});
 if(name==='get_purchase_orders_page'){const rows=poRows.filter(p=>!args?.p_status||args.p_status==='all'||p.status===args.p_status);return response({orders:rows,total_count:rows.length,summary:{draft_count:1,sent_count:0,approved_count:0,partially_received_count:1,received_count:1,total_in_minor_units:3000000,paid_in_minor_units:800000,due_in_minor_units:2200000}});}
 if(name==='get_supplier_receipts_page')return response({receipts:[displayReceiptRow],total_count:1,summary:{due_in_minor_units:displayReceiptRow.amount_due_in_minor_units,today_count:1,today_total_in_minor_units:displayReceiptRow.total_in_minor_units,today_paid_in_minor_units:displayReceiptRow.amount_paid_in_minor_units,item_count:1}});
 if(name==='get_supplier_payments_page')return response({payments:[],total_count:0});
 if(name==='search_admin_products')return response(args?.p_product_id?receivingRows.filter(row=>row.id===args.p_product_id):receivingRows);
 if(name==='get_product_cost_state_v1'&&params.has('purchase205')){const product=mapAdminProductRecord(receivingRows.find(row=>row.id===args?.p_product_id)!);return response({productId:product.id,updatedAt:product.updatedAt,isFlavorMaster:false,hasCostHistory:true,costPriceInMinorUnits:500,wacCostExactInMinorUnits:'500.000000',defaultPurchasePriceInMinorUnits:3000});}
 if(name==='preview_supplier_receipt_cancellation')return response({receiptId:receipt.id,receiptNumber:receipt.receiptNumber,total:1000000,payable:1000000,paymentsTotal:400000,supplierBalanceBefore:600000,supplierBalanceAfter:0,
 payments:[{id:receipt.payments![0].id,amount:400000,method:'cash',date:receipt.receivedAt,cashShiftId:'fixture-closed-shift',cashShiftStatus:'closed'}]});
 return originalRpc(name,args); // Writes always retain the original isolated transport.
};
const supplierReady=params.has('lateSupplier')?new Promise<void>(resolve=>window.addEventListener('fixture-suppliers-ready',()=>resolve(),{once:true})):Promise.resolve();
client.from=(table)=>{
 const rows:Record<string,unknown>[]=(table==='suppliers'?[otherSupplierRow,supplierRow]:table==='warehouses'?[warehouseRow]:table==='branches'?[branchRow]:table==='units'?[{id:params.has('purchase205')?receivingRows[0].base_unit.id:'packet',code:'PKT',name_ar:'باكيت'},{id:params.has('purchase205')?'88888888-8888-4888-8888-000000000082':'carton',code:'CTN',name_ar:'كرتونة'}]:table==='purchase_orders'?poRows:table==='supplier_receipts'?[displayReceiptRow]:[]) as Record<string,unknown>[];
 let result=rows,single=false;
 const chain:Record<string,unknown>={};
 for(const method of ['select','order','range','limit','eq','in','gte','lte','is','neq','single','maybeSingle'])chain[method]=(...args:unknown[])=>{if(method==='eq')result=result.filter(r=>r[String(args[0])]===args[1]);if(method==='single'||method==='maybeSingle')single=true;return chain;};
 chain.then=(resolve:(v:unknown)=>unknown)=>(table==='suppliers'?supplierReady:Promise.resolve())
   .then(()=>({data:single?result[0]??null:result,error:null,count:result.length})).then(resolve);
 for(const method of ['insert','update','delete','upsert'])chain[method]=(...args:unknown[])=>{const original=originalFrom(table) as unknown as Record<string,(...a:unknown[])=>unknown>;return original[method](...args);};
 return chain;
};
client.channel=()=>{const c={on:()=>c,subscribe:()=>c,unsubscribe:async()=>undefined};return c;};client.removeChannel=async()=>undefined;
const noop=()=>undefined;
function Harness(){
 const [view,setView]=useState(params.get('view')??'purchases'),close=()=>setView('purchases');
 const originalSelected=purchaseOrders[params.get('po')==='received'?2:1];
 const selected=params.has('receivingUnits')?{...originalSelected,items:originalSelected.items.map(item=>({...item,unit:'شوال'}))}:originalSelected;
 const direct=view==='create-direct'||view==='receipt-payment';
 return <main dir="rtl" data-testid="purchasing-workbench" className="min-h-[100dvh] min-w-0 bg-nw-bg font-sans text-nw-text">
  <nav aria-label="شاشات المعاينة" className="flex flex-wrap gap-2 p-4">{['purchases','direct','po-detail','receipt','create-po','supplier','receive','payment','create-direct','receipt-payment','cancel'].map((key,i)=><UiButton key={key} onClick={()=>setView(key)}>{['المشتريات','الاستلام المباشر','تفاصيل أمر','تفاصيل سند','أمر جديد','مورد جديد','استلام أمر','دفعة مورد','سند جديد','دفعة سند','إلغاء سند'][i]}</UiButton>)}</nav>
  {view==='purchases'?<PurchasesView/>:view==='direct'?<DirectReceivingView/>:view==='po-detail'?<PurchaseOrderDetailView poId={selected.id} onClose={close} onRefresh={noop}/>:view==='receipt'?<div className="p-4"><SupplierReceiptDetailView receipt={{...receipt,displayLines}} onBack={close} onRefresh={noop} onRecordPayment={()=>setView('receipt-payment')}/></div>:view==='create-po'?<CreatePurchaseOrderModal isOpen onClose={close} onSuccess={noop}/>:view==='supplier'?<CreateSupplierModal isOpen onClose={close} onSuccess={noop}/>:view==='receive'?<ReceiveGoodsModal isOpen po={selected} onClose={close} onSuccess={noop}/>:view==='payment'?<SupplierPaymentModal isOpen po={selected} onClose={close} onSuccess={noop}/>:null}
  <Modal isOpen={direct} onClose={close} title={view==='create-direct'?'سند استلام جديد':'دفعة السند'} maxWidth="max-w-4xl">{view==='create-direct'?<CreateDirectReceiptModal onClose={close} onSuccess={noop}/>:view==='receipt-payment'?<RecordSupplierPaymentModal receipt={receipt} onClose={close} onSuccess={noop}/>:null}</Modal>
  <CancelSupplierReceiptDialog receipt={view==='cancel'?receipt:null} onClose={close} onSuccess={noop}/>
 </main>;
}
createRoot(document.getElementById('root')!).render(<Harness/>);
