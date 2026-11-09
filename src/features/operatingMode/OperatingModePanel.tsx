import {useRef,useState} from 'react';
import {useAuthStore} from '../../stores/useAuthStore';
import {UiButton} from '../../components/ui';
import {disableFullAccounting} from '../../services/supabase/operatingModeCommand';
import {useOperatingMode} from './operatingModeContext';

export function OperatingModePanel(){
 const mode=useOperatingMode(),auth=useAuthStore();
 const owner=auth.roleName==='owner'||auth.roles.includes('owner');
 const actor=auth.isAuthenticated?auth.user?.id??'':'';
 const [confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[unknown,setUnknown]=useState(false);
 const lock=useRef(false),identity=useRef(actor);identity.current=actor;
 if(!owner||!actor)return null;
 const disable=async()=>{
  if(lock.current||!confirmed||unknown||!mode.verified||mode.mode!=='full'||!mode.installed)return;
  lock.current=true;setBusy(true);
  try{await disableFullAccounting(actor);if(identity.current===actor){setConfirmed(false);await mode.refresh();}}
  catch{if(identity.current===actor)setUnknown(true);}
  finally{lock.current=false;if(identity.current===actor)setBusy(false);}
 };
 const read=async()=>{await mode.refresh();setConfirmed(false);};
 return <section aria-label="وضع التشغيل" className="space-y-3 rounded-xl border border-nw-border bg-nw-surface p-3">
  <h3 className="font-bold">وضع التشغيل</h3>
  <p>{mode.mode==='sales-only'?'مبيعات وذمم — تتبع المخزون والتكلفة مطفأ':mode.mode==='full'?'المحاسبة والمخزون مفعّلان':'جارٍ التحقق من الوضع…'}</p>
  {!mode.verified&&<p role="alert">لم نتأكد من الوضع الحالي؛ أعد قراءة الحالة قبل أي تغيير. (MODE-02)</p>}
  {unknown&&<p role="alert">لم نتأكد هل تغيّر الوضع. لا تكرر العملية؛ أعد قراءة الحالة. إن بقيت المحاسبة مفعّلة راجع الوردية والطلبات المفتوحة والمصادقة الثنائية. (MODE-01)</p>}
  {mode.installed===false&&<p className="text-sm text-nw-muted">هذا الإصدار من قاعدة البيانات لا يحتوي أدوات تغيير الوضع.</p>}
  {mode.mode==='full'&&mode.installed&&<>
   <p className="text-sm text-nw-muted">أغلق الورديات وأنهِ الطلبات المعلقة أولاً. يتطلب التغيير جلسة مالك مؤكدة بالمصادقة الثنائية. إعادة المحاسبة لاحقاً تحتاج جرد تفعيل بالكميات والتكاليف.</p>
   <label className="flex items-center gap-2"><input type="checkbox" checked={confirmed} disabled={busy||unknown||!mode.verified} onChange={event=>setConfirmed(event.target.checked)}/>أؤكد الانتقال إلى البيع بلا تتبع مخزون أو تكلفة</label>
   <UiButton disabled={!confirmed||busy||unknown||!mode.verified} onClick={()=>void disable()}>إطفاء المحاسبة والمخزون</UiButton>
  </>}
  {mode.mode==='sales-only'&&<p className="text-sm text-nw-muted">الديون والفواتير محفوظة. إعادة المحاسبة تتم من أداة جرد التفعيل، ولا تعيد احتساب أرباح المبيعات السابقة.</p>}
  <UiButton disabled={busy||mode.status==='loading'} onClick={()=>void read()}>إعادة قراءة وضع التشغيل</UiButton>
 </section>;
}
