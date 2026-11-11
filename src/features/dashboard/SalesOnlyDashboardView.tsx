import {useEffect,useRef,useState} from 'react';
import {Card,UiButton} from '../../components/ui';
import {useAuthStore} from '../../stores/useAuthStore';
import {useAppStoreActions,useAppStoreSelector} from '../../stores/useAppStore';
import {fetchSalesOnlyHome,type SalesOnlyHomeData} from '../../services/supabase/salesOnlyHome.service';
import {subscribeToDashboardRealtime} from '../../services/supabase/dashboard.service';
import {useSalesHistory} from '../../hooks/useSalesHistory';
import {canReadSalesHistory} from '../../utils/salesHistory';
import {SalesInvoiceDialog} from '../salesHistory/SalesInvoiceDialog';
import {DashboardHome} from './DashboardHome';

/** Same Home/receipt/history/controls. Refresh generations never cross actors,
 * branches or failures; full dashboard and its cost/stock reads are not mounted. */
export function SalesOnlyDashboardView(){
 const auth=useAuthStore(),actor=auth.isAuthenticated?auth.user?.id??'':'',branch=useAppStoreSelector(s=>s.activeBranch.id);
 const name=useAppStoreSelector(s=>s.currentUser.name),shift=useAppStoreSelector(s=>s.currentShift),{setActiveTab,openModal}=useAppStoreActions();
 const canRead=canReadSalesHistory(auth.roles,auth.roleName),history=useSalesHistory({page:1,pageSize:5,period:'day',salesOnly:true},canRead,actor);
 const [invoice,setInvoice]=useState<string|null>(null),[refresh,setRefresh]=useState(0),[connected,setConnected]=useState(false),generation=useRef(0);
 const key=JSON.stringify([actor,branch]);const [state,setState]=useState<{key:string;data:SalesOnlyHomeData|null;status:'loading'|'ready'|'error'}>({key:'',data:null,status:'loading'});
 useEffect(()=>{setInvoice(null);},[key]);
 useEffect(()=>{let live=true;const token=++generation.current;setState({key,data:null,status:'loading'});
  if(!actor){setState({key,data:null,status:'error'});return;}
  void fetchSalesOnlyHome(branch).then(data=>{if(live&&token===generation.current)setState({key,data,status:'ready'});},()=>{if(live&&token===generation.current)setState({key,data:null,status:'error'});});
  return()=>{live=false;};
 },[actor,branch,key,refresh]);
 useEffect(()=>subscribeToDashboardRealtime(()=>setRefresh(n=>n+1),setConnected),[]);
 const data=state.key===key&&state.status==='ready'?state.data:null;
 if(!data)return <Card role={state.status==='error'?'alert':'status'}>{state.status==='error'?<>تعذر قراءة مركز اليوم. أعد المحاولة؛ لا تعتمد أرقاماً ناقصة. (HOME-01)<UiButton onClick={()=>setRefresh(n=>n+1)}>إعادة القراءة</UiButton></>:'جارٍ قراءة مركز اليوم…'}</Card>;
 return <><DashboardHome data={data} currentUserName={name} currentShift={shift} loading={false} error={null} realtimeConnected={connected}
  onRefresh={()=>{setRefresh(n=>n+1);void history.reload();}} onOrders={()=>setActiveTab('orders')} onAccounts={()=>setActiveTab('accounts')} onProducts={()=>setActiveTab('products')}
  onInventory={()=>setActiveTab('products')} onShift={()=>setActiveTab('shifts')} onSell={()=>setActiveTab('pos')} onReceive={()=>undefined} onExpense={()=>openModal('add_expense')} onCheques={()=>setActiveTab('cheques')}
  salesHistory={canRead?history:undefined} onSalesHistory={()=>setActiveTab('sales_history')} onInvoice={setInvoice}/>
  {invoice&&canRead&&<SalesInvoiceDialog orderId={invoice} onClose={()=>setInvoice(null)} onChanged={async()=>{setRefresh(n=>n+1);await history.reload();}}/>}</>;
}
