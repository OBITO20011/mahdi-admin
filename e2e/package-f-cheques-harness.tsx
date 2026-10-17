import React from 'react';
import {createRoot} from 'react-dom/client';
import '@fontsource/ibm-plex-sans-arabic/400.css';
import '@fontsource/ibm-plex-sans-arabic/500.css';
import '@fontsource/ibm-plex-sans-arabic/600.css';
import '@fontsource/ibm-plex-sans-arabic/700.css';
import '../src/index.css';
import {ChequesView} from '../src/features/cheques/ChequesView';
import {ChequeRegistrationForm} from '../src/features/cheques/ChequeRegistrationForm';
import {CustomerStatement} from '../src/features/crm/CustomerStatement';
import {SideNav} from '../src/components/layout/SideNav';
import {BottomTabs} from '../src/components/layout/BottomTabs';
import {authStoreEngine} from '../src/stores/useAuthStore';
import {storeEngine} from '../src/stores/useAppStore';
import {supabase} from '../src/lib/supabase';
import {chequeRows,chequeBranch,chequeCustomer,chequeSupplier,chequeClaim,chequeResult,type ChequeFixtureRow} from './package-f-cheques.fixture';
import {cashShift} from './package-f-cash.fixture';
const params=new URLSearchParams(location.search),theme=params.get('theme')==='dark'?'dark':'light',role=params.get('role')??'owner';
if(!supabase||!['127.0.0.1','localhost','[::1]'].includes(new URL(import.meta.env.VITE_SUPABASE_URL??'').hostname))throw Error('Cheque preview requires loopback only');
document.documentElement.classList.toggle('theme-light',theme==='light');document.documentElement.classList.toggle('theme-dark',theme==='dark');document.documentElement.dataset.theme=theme;
Object.defineProperty(authStoreEngine,'state',{value:{...authStoreEngine.getState(),roles:[role],roleName:role,isAuthenticated:true,isLoading:false},writable:true});
authStoreEngine.initAuth=async()=>undefined;
const branch={id:chequeBranch,name:'فرع الرمثا',address:'وسط المدينة',city:'الرمثا',phone:''};
Object.defineProperty(storeEngine,'state',{value:{...storeEngine.getState(),activeTab:'cheques',activeBranch:branch,branches:[branch],notifications:[],
  currentShift:params.get('drawer')==='low'?{...cashShift,branchId:chequeBranch,expectedCash:5}:null},writable:true});
storeEngine.setCurrentUser({id:'fixture-cheque-owner',name:'المالك',role:role==='owner'?'Owner':role==='cashier'?'Cashier':'Admin',themeMode:theme,avatarUrl:''});
const rows=structuredClone(chequeRows);
let claimReversalReason:string|null=null;
declare global {interface Window {__chequeFixture:{transition:(id:string,status:ChequeFixtureRow['status'])=>void;reverseClaimPayment:(reason:string)=>void}}}
window.__chequeFixture={transition:(id,status)=>{const c=rows.find(c=>c.id===id);if(c){c.status=status;c.version++;if(status==='endorsed')c.endorsed_supplier_id=chequeSupplier;}},
  reverseClaimPayment:reason=>{claimReversalReason=reason;}};
const originalRpc=supabase.rpc.bind(supabase),originalFrom=supabase.from.bind(supabase);
const ok=(data:unknown)=>Promise.resolve({data,error:null});
Object.defineProperty(supabase,'rpc',{value:(name:string,args:Record<string,unknown>={})=>{
  if(name==='get_deferred_cheques_page'){
    const filtered=rows.filter(c=>(args.p_direction==='all'||c.direction===args.p_direction)
      &&(args.p_status==='all'||c.status===args.p_status||(args.p_status==='due7'&&c.status==='pending')||(args.p_status==='overdue'&&c.status==='endorsed')));
    return ok({items:filtered,page:1,hasMore:false,totalCount:filtered.length,counts:{all:4,pending:2,endorsed:1,cleared:0,returned:1,cancelled:0,due7:2,overdue:1},
      summary:{incomingInMinorUnits:150000,outgoingInMinorUnits:80000,endorsedInMinorUnits:50000},weeks:[{week_start:'2026-10-12',direction:'incoming',amount:150000,count:2},{week_start:'2026-10-12',direction:'outgoing',amount:80000,count:1}]});
  }
  if(name==='get_deferred_cheque_detail'){
    const c=rows.find(c=>c.id===args.p_cheque_id);if(!c)throw Error('Unknown fixture cheque');
    return ok({...chequeResult(c),allocations:[{id:'allocation-1',party_kind:c.customer_id?'customer':'supplier',original_debt_at:'2026-07-01T09:00:00Z',amount_in_minor_units:c.amount_in_minor_units}],
      events:[{id:'event-1',kind:c.direction==='incoming'?'received':'issued',at:'2026-10-16T06:00:00Z',reason:null,actor:'المالك'},
        ...(c.status==='returned'||c.status==='cancelled'?[{id:'event-2',kind:c.status,at:'2026-10-16T07:00:00Z',reason:'الشيك مسجل للمراجعة',actor:'المالك'}]:[])],
      supplierClaims:c.status==='returned'&&c.supplier_id?[{id:chequeClaim,reference:'شيك راجع رقم RET-10502',outstanding:70000}]:[],
      supplierClaimPayments:c.status==='returned'&&c.supplier_id?[{id:'fixture-claim-payment',amount_in_minor_units:12345,payment_method:'bank_transfer',
        paid_at:'2026-10-16T09:00:00Z',is_reversed:claimReversalReason!==null,can_reverse:claimReversalReason===null,reversal_reason:claimReversalReason}]:[]});
  }
  if(name==='get_pos_customer_page')return ok({customers:[{id:chequeCustomer,full_name:'محمد أحمد العلي',phone:'0791111111',current_balance_in_minor_units:100000,credit_limit_in_minor_units:500000}],total_count:1});
  if(name==='preview_customer_cheque_v1')return ok({totalOutstandingInMinorUnits:100000,openingOutstandingInMinorUnits:0,ordersOutstandingInMinorUnits:100000,
    compensationOutstandingInMinorUnits:0,exceedsBalance:Number(args.p_amount_in_minor_units)>100000,
    parts:[{kind:'order',id:'fixture-order',reference:'POS-10482',debtAt:'2026-07-01T09:00:00Z',originalDebtAt:'2026-07-01T09:00:00Z',
      outstandingInMinorUnits:100000,allocateInMinorUnits:Number(args.p_amount_in_minor_units),remainingAfterInMinorUnits:100000-Number(args.p_amount_in_minor_units)}]});
  if(name==='preview_supplier_cheque_v1')return ok({balanceInMinorUnits:200000,allocatedInMinorUnits:Number(args.p_amount_in_minor_units)});
  if(name==='get_customer_statement')return ok({customer_id:chequeCustomer,page:1,page_size:25,total_count:1,has_more:false,
    closing_balance_in_minor_units:100000,page_opening_balance_in_minor_units:0,page_closing_balance_in_minor_units:100000,
    outstanding_cheques_in_minor_units:50000,has_returned_cheque:false,movements:[{movement_id:'cheque_claim:fixture',movement_type:'cheque_cancellation_compensation',type_label:'إلغاء تسجيل شيك',order_id:null,
      reference:'إلغاء تسجيل شيك رقم 0000123456789',occurred_at:'2026-10-16T09:00:00Z',date_label:null,original_debt_at:'2026-07-01T09:00:00Z',reason:'تسجيل خاطئ بلا عكس للدفعة الأصلية',
      debit_in_minor_units:100000,credit_in_minor_units:0,balance_in_minor_units:100000,sequence:1}]});
  // All financial writes retain the original isolated HTTP transport.
  return originalRpc(name,args);
}});
type Result={data:Record<string,unknown>[];error:null};
interface Chain {select:()=>Chain;order:()=>Chain;eq:()=>Chain;then:(resolve:(result:Result)=>unknown)=>Promise<unknown>}
Object.defineProperty(supabase,'from',{value:(name:string)=>{
  if(name!=='suppliers')return originalFrom(name);
  const chain:Chain={select:()=>chain,order:()=>chain,eq:()=>chain,then:resolve=>Promise.resolve({data:[{id:chequeSupplier,company_name:'شركة توريد المواد الغذائية',phone:'065000000',current_balance_in_minor_units:200000,is_active:true}],error:null} as Result).then(resolve)};
  return chain;
}});
const view=params.get('view');
createRoot(document.getElementById('root')!).render(<div className="min-h-screen bg-nw-bg text-nw-text">
  {view==='receive'?<main className="mx-auto max-w-xl p-4"><h1 className="mb-4 text-xl font-bold">استلام شيك عميل</h1><ChequeRegistrationForm direction="incoming" partyId={chequeCustomer}
    parties={[{id:chequeCustomer,name:'محمد أحمد العلي',phone:'0791111111'}]} branchId={chequeBranch} onClose={()=>undefined} onSaved={()=>undefined}/></main>
    :view==='statement'?<main className="mx-auto max-w-4xl p-4"><h1 className="mb-4 text-xl font-bold">كشف حساب العميل</h1><CustomerStatement customerId={chequeCustomer} revision={1}/></main>
    :<><SideNav/><div className="lg:ms-[260px]"><ChequesView/></div><BottomTabs/></>}
</div>);
