import React from 'react';
import {createRoot} from 'react-dom/client';
import '@fontsource/ibm-plex-sans-arabic/400.css';
import '@fontsource/ibm-plex-sans-arabic/500.css';
import '@fontsource/ibm-plex-sans-arabic/600.css';
import '@fontsource/ibm-plex-sans-arabic/700.css';
import '../src/index.css';
import {GoLiveSetupView} from '../src/features/goLive/GoLiveSetupView';
import {SideNav} from '../src/components/layout/SideNav';
import {Header} from '../src/components/common/Header';
import {BottomTabs} from '../src/components/layout/BottomTabs';
import {authStoreEngine,type AuthState} from '../src/stores/useAuthStore';
import {storeEngine,type AppState} from '../src/stores/useAppStore';
import {supabase} from '../src/lib/supabase';

// In-memory stand-in for the go-live RPC contracts (140-142). Database rules
// themselves are proven by scripts/testing/run-go-live-setup-runtime.mjs.
const params=new URLSearchParams(location.search),theme=params.get('theme')==='dark'?'dark':'light';
document.documentElement.classList.toggle('theme-light',theme==='light');document.documentElement.classList.toggle('theme-dark',theme==='dark');document.documentElement.dataset.theme=theme;
if(!supabase||!['127.0.0.1','localhost','[::1]'].includes(new URL(import.meta.env.VITE_SUPABASE_URL ?? '').hostname))throw Error('Go-live harness requires loopback API only');
const role=params.get('role')??'owner';
const auth=authStoreEngine as unknown as {state:AuthState;getState:()=>AuthState;initAuth:()=>Promise<void>};
auth.state={...auth.getState(),roleName:role,roles:[role],isAuthenticated:true,isLoading:false};auth.initAuth=async()=>undefined;
const engine=storeEngine as unknown as {state:AppState};
const branch={id:'golive-branch',name:'الفرع الرئيسي',address:'',city:'الرمثا',phone:''};
engine.state={...engine.state,activeBranch:branch,branches:[branch],notifications:[],
  warehouses:[{id:'golive-warehouse',name:'المستودع الرئيسي',branchId:branch.id,location:'الرمثا'}]};
storeEngine.setCurrentUser({id:'golive-owner',name:'أحمد',role:role==='owner'?'Owner':'Admin',themeMode:theme,avatarUrl:''});
storeEngine.setActiveTab('go_live');

type Row=Record<string,unknown>;
const customers=[{id:'c1',full_name:'محمد العلي',phone:'0791111111'},{id:'c2',full_name:'سارة الخطيب',phone:'0792222222'}];
const suppliers=[{id:'s1',company_name:'شركة التوزيع الأولى',phone:'065000000'},{id:'s2',company_name:'مؤسسة الحلويات',phone:''}];
const state={finished:params.has('finished'),products:12,imported:0,stockable:12,counted:0,sessions:0,
  customerEntries:[] as Row[],supplierEntries:[] as Row[],keys:new Set<string>(),calls:[] as {name:string;args:Row}[]};
if(params.has('seeded')){
  state.customerEntries.push({id:'e1',entryNumber:'COB-001001',customerId:'c1',customerName:'محمد العلي',customerPhone:'0791111111',
    amountInMinorUnits:125500,originalDebtDate:'2025-03-15',notes:'',isReversed:false,reversalReason:null});
  state.supplierEntries.push({id:'e2',entryNumber:'SOB-001001',supplierId:'s1',supplierName:'شركة التوزيع الأولى',direction:'payable',
    amountInMinorUnits:1500000,originalBalanceDate:'2025-06-30',notes:'',isReversed:false,reversalReason:null});
}
(window as unknown as {__goLiveCalls:typeof state.calls}).__goLiveCalls=state.calls;
const active=(rows:Row[])=>rows.filter(row=>!row.isReversed);
const sum=(rows:Row[],f=(_row:Row)=>true)=>active(rows).filter(f).reduce((n,row)=>n+Number(row.amountInMinorUnits),0);
const status=()=>({success:true,finished:state.finished,finishedAt:state.finished?'2026-10-15T09:30:00Z':null,finishedByName:'أحمد',
  products:{activeCount:state.products,importedCount:state.imported},
  stock:{stockableCount:state.stockable,countedProductCount:state.counted,sessionCount:state.sessions},
  customers:{customerCount:customers.length,withOpeningCount:new Set(active(state.customerEntries).map(r=>r.customerId)).size,
    activeEntryCount:active(state.customerEntries).length,activeTotalInMinorUnits:sum(state.customerEntries)},
  suppliers:{supplierCount:suppliers.length,withOpeningCount:new Set(active(state.supplierEntries).map(r=>r.supplierId)).size,
    payableTotalInMinorUnits:sum(state.supplierEntries,r=>r.direction==='payable'),advanceTotalInMinorUnits:sum(state.supplierEntries,r=>r.direction==='advance')}});
const fail=(message:string,details?:unknown)=>Promise.resolve({data:null,error:{message,details:details===undefined?null:JSON.stringify(details),code:'P0001',hint:null}});
const ok=(data:unknown)=>Promise.resolve({data,error:null});
const validate=(name:string,rows:Row[])=>rows.map((row,index)=>{
  if(name.includes('customer')){
    const customer=customers.find(c=>c.id===row.customer_id||c.phone===row.customer_phone);
    return customer?null:{row:index+1,message:'لا يوجد عميل بهذا الهاتف؛ أضف العميل أولاً من شاشة العملاء.'};
  }
  if(name.includes('supplier')){
    const supplier=suppliers.find(s=>s.id===row.supplier_id||s.company_name===row.supplier_name);
    return supplier?null:{row:index+1,message:'لا يوجد مورد نشط بهذا الاسم؛ أضف المورد أولاً من شاشة الموردين.'};
  }
  return String(row.sku).toUpperCase()==='EXISTING'?{row:index+1,message:'رمز SKU مستخدم لمنتج موجود.'}:null;
}).filter(Boolean);
const client=supabase as unknown as {rpc:(name:string,args?:Row)=>unknown;from:(table:string)=>unknown};
const originalFrom=client.from.bind(client);
client.rpc=(name,args={})=>{
  state.calls.push({name,args});
  const finishedError=()=>fail('GO_LIVE_SETUP_FINISHED: تم إنهاء بداية التشغيل؛ لا يُقبل أي إدخال افتتاحي بعد الآن.');
  if(name==='get_go_live_setup_status_v1')return ok(status());
  if(name==='get_go_live_customer_openings_v1')return ok({entries:[...state.customerEntries].reverse()});
  if(name==='get_go_live_supplier_openings_v1')return ok({entries:[...state.supplierEntries].reverse()});
  if(name==='get_crm_customer_page')return ok({customers:customers.filter(c=>!args.p_search||c.full_name.includes(String(args.p_search))||c.phone.includes(String(args.p_search))),total_count:2});
  if(name==='get_inventory_opening_setup')return ok({success:true,warehouse:{id:'golive-warehouse',name:'المستودع الرئيسي'},recentSessions:[],products:[
    {productId:'p1',sku:'CHO-001',barcode:'6281000000017',productName:'شوكولاتة بالحليب',purchasePackageName:'كرتونة',baseUnitName:'باكيت',unitsPerPackage:24,currentQuantity:0,reservedQuantity:0,costPriceInMinorUnits:200,defaultPurchasePriceInMinorUnits:4800,hasOperationalMovements:false,eligible:true},
    {productId:'p2',sku:'FL-A',barcode:'6281000000024',productName:'علكة نكهة نعناع',purchasePackageName:'علبة',baseUnitName:'حبة',unitsPerPackage:5,currentQuantity:0,reservedQuantity:0,costPriceInMinorUnits:150,defaultPurchasePriceInMinorUnits:750,hasOperationalMovements:false,eligible:true}]});
  if(name==='apply_inventory_opening_setup'){
    if(state.finished)return finishedError();
    const rows=args.p_rows as Row[];state.counted+=rows.length;state.sessions++;
    return ok({success:true,sessionId:'s',sessionNumber:'IOS-1',itemCount:rows.length,totalPreviousQuantity:0,totalActualQuantity:0,totalQuantityChange:0,message:'ok'});
  }
  if(['import_go_live_products_v1','record_customer_opening_balances_v1','record_supplier_opening_balances_v1'].includes(name)){
    if(state.finished)return finishedError();
    const rows=args.p_rows as Row[],errors=validate(name,rows);
    if(args.p_dry_run)return ok({success:true,dryRun:true,rowCount:rows.length,validCount:rows.length-errors.length,errors});
    if(errors.length)return fail('GO_LIVE_BATCH_INVALID: الملف يحتوي أسطراً غير صالحة؛ لم يُحفظ أي سطر.',errors);
    const key=String(args.p_idempotency_key);
    if(state.keys.has(key))return ok({success:true,idempotentReplay:true,created:[]});
    state.keys.add(key);
    if(name.startsWith('import'))state.imported+=rows.length;
    for(const row of rows){
      const n=state.customerEntries.length+state.supplierEntries.length+1001;
      if(name.includes('customer')){const c=customers.find(x=>x.id===row.customer_id||x.phone===row.customer_phone)!;
        state.customerEntries.push({id:'ce'+n,entryNumber:'COB-00'+n,customerId:c.id,customerName:c.full_name,customerPhone:c.phone,
          amountInMinorUnits:Number(row.amount_in_minor_units),originalDebtDate:row.original_debt_date,notes:row.notes??'',isReversed:false,reversalReason:null});}
      if(name.includes('supplier')){const s=suppliers.find(x=>x.id===row.supplier_id||x.company_name===row.supplier_name)!;
        state.supplierEntries.push({id:'se'+n,entryNumber:'SOB-00'+n,supplierId:s.id,supplierName:s.company_name,direction:row.direction,
          amountInMinorUnits:Number(row.amount_in_minor_units),originalBalanceDate:row.original_balance_date,notes:row.notes??'',isReversed:false,reversalReason:null});}
    }
    return ok({success:true,idempotentReplay:false,created:rows.map((_,i)=>({row:i+1}))});
  }
  if(name==='reverse_customer_opening_balance_v1'||name==='reverse_supplier_opening_balance_v1'){
    if(state.finished)return finishedError();
    const entry=[...state.customerEntries,...state.supplierEntries].find(e=>e.id===args.p_entry_id);
    if(entry){entry.isReversed=true;entry.reversalReason=args.p_reason;}
    return ok({success:true,idempotentReplay:false});
  }
  if(name==='finish_go_live_setup_v1'){
    if(args.p_confirmation!=='إنهاء بداية التشغيل')return fail('GO_LIVE_CONFIRMATION_REQUIRED: اكتب عبارة التأكيد.');
    state.finished=true;return ok({success:true,finishedAt:'2026-10-15T09:30:00Z'});
  }
  return ok(null);
};
client.from=(table)=>{
  if(table!=='suppliers')return originalFrom(table);
  const result={data:suppliers,error:null};
  const chain={select:()=>chain,eq:()=>chain,order:()=>chain,limit:()=>Promise.resolve(result)};
  return chain;
};
createRoot(document.getElementById('root')!).render(<div dir="rtl" className="flex h-[100dvh] bg-nw-bg font-sans text-nw-text"><SideNav/><div className="flex min-w-0 flex-1 flex-col"><Header/>
  <main data-testid="go-live-scroll" className="min-h-0 flex-1 overflow-y-auto"><GoLiveSetupView/></main><div className="lg:hidden"><BottomTabs/></div></div></div>);
