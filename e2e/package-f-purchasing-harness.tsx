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
const params=new URLSearchParams(location.search),theme=params.get('theme')==='dark'?'dark':'light';
document.documentElement.classList.toggle('theme-light',theme==='light');document.documentElement.classList.toggle('theme-dark',theme==='dark');document.documentElement.dataset.theme=theme;
if(!supabase||!['localhost','127.0.0.1','[::1]'].includes(new URL(import.meta.env.VITE_SUPABASE_URL).hostname))throw Error('Purchasing preview requires loopback');
const auth=authStoreEngine as unknown as {state:AuthState;getState:()=>AuthState;initAuth:()=>Promise<void>};
auth.state={...auth.getState(),roleName:'owner',roles:['owner'],isAuthenticated:true,isLoading:false};auth.initAuth=async()=>undefined;
const store=storeEngine as unknown as {state:AppState;getState:()=>AppState};store.state={...store.getState(),warehouses:[{id:warehouseRow.id,name:warehouseRow.name,branchId:branchRow.id,location:'الرمثا'}],branches:[{id:branchRow.id,name:'فرع الرمثا',address:'وسط البلد',city:'الرمثا',phone:''}],activeBranch:{id:branchRow.id,name:'فرع الرمثا',address:'وسط البلد',city:'الرمثا',phone:''}};
storeEngine.setCurrentUser({id:'fixture-owner',name:'مهدي',role:'Owner',themeMode:theme,avatarUrl:''});
const originalRpc=supabase.rpc.bind(supabase),originalFrom=supabase.from.bind(supabase);
const client=supabase as unknown as {rpc:(n:string,a?:Record<string,unknown>)=>unknown;from:(n:string)=>unknown;channel:(n:string)=>unknown;removeChannel:(c:unknown)=>unknown};
client.rpc=(name,args)=>{
 const response=(data:unknown)=>Promise.resolve({data,error:null});
 if(name==='get_purchase_orders_page'){const rows=poRows.filter(p=>!args?.p_status||args.p_status==='all'||p.status===args.p_status);return response({orders:rows,total_count:rows.length,summary:{draft_count:1,sent_count:0,approved_count:0,partially_received_count:1,received_count:1,total_in_minor_units:3000000,paid_in_minor_units:800000,due_in_minor_units:2200000}});}
 if(name==='get_supplier_receipts_page')return response({receipts:[receiptRow],total_count:1,summary:{due_in_minor_units:600000,today_count:1,today_total_in_minor_units:1000000,today_paid_in_minor_units:400000,item_count:1}});
 if(name==='get_supplier_payments_page')return response({payments:[],total_count:0});
 if(name==='search_admin_products')return response(inventoryProducts.slice(0,3).map(p=>({...p,warehouse_balances:[{warehouse_id:warehouseRow.id,on_hand_quantity:100,available_quantity:100,reserved_quantity:0}]})));
 if(name==='preview_supplier_receipt_cancellation')return response({receiptId:receipt.id,receiptNumber:receipt.receiptNumber,total:1000000,payable:1000000,paymentsTotal:400000,supplierBalanceBefore:600000,supplierBalanceAfter:0,
 payments:[{id:receipt.payments![0].id,amount:400000,method:'cash',date:receipt.receivedAt,cashShiftId:'fixture-closed-shift',cashShiftStatus:'closed'}]});
 return originalRpc(name,args); // Writes always retain the original isolated transport.
};
client.from=(table)=>{
 const rows:Record<string,unknown>[]=(table==='suppliers'?[otherSupplierRow,supplierRow]:table==='warehouses'?[warehouseRow]:table==='branches'?[branchRow]:table==='units'?[{id:'packet',code:'PKT',name_ar:'باكيت'},{id:'carton',code:'CTN',name_ar:'كرتونة'}]:table==='purchase_orders'?poRows:table==='supplier_receipts'?[receiptRow]:[]) as Record<string,unknown>[];
 let result=rows,single=false;
 const chain:Record<string,unknown>={};
 for(const method of ['select','order','range','limit','eq','in','gte','lte','is','neq','single','maybeSingle'])chain[method]=(...args:unknown[])=>{if(method==='eq')result=result.filter(r=>r[String(args[0])]===args[1]);if(method==='single'||method==='maybeSingle')single=true;return chain;};
 chain.then=(resolve:(v:unknown)=>unknown)=>Promise.resolve({data:single?result[0]??null:result,error:null,count:result.length}).then(resolve);
 for(const method of ['insert','update','delete','upsert'])chain[method]=(...args:unknown[])=>{const original=originalFrom(table) as unknown as Record<string,(...a:unknown[])=>unknown>;return original[method](...args);};
 return chain;
};
client.channel=()=>{const c={on:()=>c,subscribe:()=>c,unsubscribe:async()=>undefined};return c;};client.removeChannel=async()=>undefined;
const noop=()=>undefined;
function Harness(){
 const [view,setView]=useState(params.get('view')??'purchases'),close=()=>setView('purchases');
 const selected=purchaseOrders[params.get('po')==='received'?2:1],direct=view==='create-direct'||view==='receipt-payment';
 return <main dir="rtl" data-testid="purchasing-workbench" className="min-h-[100dvh] min-w-0 bg-nw-bg font-sans text-nw-text">
  <nav aria-label="شاشات المعاينة" className="flex flex-wrap gap-2 p-4">{['purchases','direct','po-detail','receipt','create-po','supplier','receive','payment','create-direct','receipt-payment','cancel'].map((key,i)=><UiButton key={key} onClick={()=>setView(key)}>{['المشتريات','الاستلام المباشر','تفاصيل أمر','تفاصيل سند','أمر جديد','مورد جديد','استلام أمر','دفعة مورد','سند جديد','دفعة سند','إلغاء سند'][i]}</UiButton>)}</nav>
  {view==='purchases'?<PurchasesView/>:view==='direct'?<DirectReceivingView/>:view==='po-detail'?<PurchaseOrderDetailView poId={selected.id} onClose={close} onRefresh={noop}/>:view==='receipt'?<div className="p-4"><SupplierReceiptDetailView receipt={receipt} onBack={close} onRefresh={noop} onRecordPayment={()=>setView('receipt-payment')}/></div>:view==='create-po'?<CreatePurchaseOrderModal isOpen onClose={close} onSuccess={noop}/>:view==='supplier'?<CreateSupplierModal isOpen onClose={close} onSuccess={noop}/>:view==='receive'?<ReceiveGoodsModal isOpen po={selected} onClose={close} onSuccess={noop}/>:view==='payment'?<SupplierPaymentModal isOpen po={selected} onClose={close} onSuccess={noop}/>:null}
  <Modal isOpen={direct} onClose={close} title={view==='create-direct'?'سند استلام جديد':'دفعة السند'} maxWidth="max-w-4xl">{view==='create-direct'?<CreateDirectReceiptModal onClose={close} onSuccess={noop}/>:view==='receipt-payment'?<RecordSupplierPaymentModal receipt={receipt} onClose={close} onSuccess={noop}/>:null}</Modal>
  <CancelSupplierReceiptDialog receipt={view==='cancel'?receipt:null} onClose={close} onSuccess={noop}/>
 </main>;
}
createRoot(document.getElementById('root')!).render(<Harness/>);
