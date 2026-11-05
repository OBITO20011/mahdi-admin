import React,{useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import '../src/index.css';
import {Modal} from '../src/components/common/Modal';
import {ResponsiveCartPanel} from '../src/components/ui/ResponsiveCartPanel';
import {ResponsiveActionPanel} from '../src/components/ui/ResponsiveActionPanel';
import {MobileActionMenu} from '../src/components/ui/PhonePresentation';
import {ProductFormModal} from '../src/features/products/ProductFormModal';
import type {StartBarcodeCamera} from '../src/features/barcode/barcodeCamera';
import {installBrowserScreenHistory} from '../src/utils/screenHistory';
import {authStoreEngine,type AuthState} from '../src/stores/useAuthStore';
import {storeEngine,type AppState} from '../src/stores/useAppStore';
import {supabase,sanitizedSupabaseUrl} from '../src/lib/supabase';
import {productWorkbookFixture} from './package-f-product-workbook.fixture';
if(!supabase||!['127.0.0.1','localhost'].includes(new URL(sanitizedSupabaseUrl).hostname))throw Error('LOCAL_ONLY');
const actor='92600000-0000-4000-8000-000000000001',fixture=productWorkbookFixture(actor,()=>false);
Object.assign(supabase,{from:fixture.client.from,rpc:fixture.client.rpc});Object.assign(supabase.auth,{getUser:fixture.client.auth.getUser,getSession:async()=>({data:{session:{user:{id:actor}}},error:null})});
const auth=authStoreEngine as unknown as {state:AuthState;getState:()=>AuthState;initAuth:()=>Promise<void>};auth.state={...auth.getState(),user:{id:actor}as AuthState['user'],roleName:'owner',roles:['owner'],isAuthenticated:true,isLoading:false};auth.initAuth=async()=>undefined;
const engine=storeEngine as unknown as {state:AppState;getState:()=>AppState};engine.state={...engine.getState(),products:[],categories:[{id:'cat',nameAr:'وهمي'}],units:[{id:'pkt',code:'PKT',nameAr:'باكيت',conversionFactor:1}],brands:[],warehouses:[]};
let starts=0,stops=0;
const scanner:StartBarcodeCamera=async()=>{starts++;return {stop:async()=>{stops++;}};};
Object.assign(window,{__dialogProbe:()=>({starts,stops,calls:fixture.calls.length})});
const fields=<><input aria-label="حقل صغير" className="text-[10px]"/><select aria-label="اختيار صغير" className="text-xs"><option>وهمي</option></select><textarea aria-label="نص صغير" className="text-sm"/></>;
function Harness(){const [open,setOpen]=useState(''),[nested,setNested]=useState(false),[clicks,setClicks]=useState(0),[revision,setRevision]=useState(0);
useEffect(()=>{const rerender=()=>setRevision(n=>n+1);window.addEventListener('dialog-parent-render',rerender);return()=>window.removeEventListener('dialog-parent-render',rerender);},[]);
useEffect(()=>installBrowserScreenHistory(()=> 'home',()=>undefined,()=>true),[]);
const content=<>{fields}<button onClick={()=>setNested(true)}>نافذة ثانية</button><div style={{height:1500}}/><button data-testid="last-action" onClick={()=>setOpen('')}>آخر إجراء</button></>;
return <main dir="rtl" data-revision={revision} style={{minHeight:2500,paddingTop:150}}><output data-testid="background-count">{clicks}</output>{['sheet','cart','action','camera'].map(kind=><button key={kind} onClick={()=>setOpen(kind)}>{kind}</button>)}
<MobileActionMenu label="قائمة اختبار"><button onClick={()=>setClicks(n=>n+1)}>قرار قائمة</button></MobileActionMenu>
<button data-testid="background-action" style={{position:'fixed',bottom:0,left:0,zIndex:9999,height:60,width:'100%'}} onClick={()=>setClicks(n=>n+1)}>تحصيل من الزبون</button>
<Modal isOpen={open==='sheet'||open==='camera'} onClose={()=>setOpen('')} title={open==='camera'?'إنشاء منتج':'عكس دفعة عميل'} trackChanges={false}>{open==='camera'?<ProductFormModal onClose={()=>setOpen('')} startBarcodeScanner={scanner}/>:content}</Modal>
{open==='cart'&&<ResponsiveCartPanel open onClose={()=>setOpen('')} title="سلة اختبار" footer={<button onClick={()=>setOpen('')}>رجوع للسلة</button>}>{content}</ResponsiveCartPanel>}
{open==='action'&&<ResponsiveActionPanel open busy={false} onClose={()=>setOpen('')} title="إجراء اختبار" backLabel="إغلاق الإجراء" footer={<span>النهاية</span>}>{content}</ResponsiveActionPanel>}
<Modal isOpen={nested} onClose={()=>setNested(false)} title="متداخلة" trackChanges={false}><button onClick={()=>setNested(false)}>رجوع للأولى</button></Modal>
</main>;}
createRoot(document.getElementById('root')!).render(<Harness/>);
