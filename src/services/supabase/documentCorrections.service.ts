import {supabase,isSupabaseConfigured} from '../../lib/supabase';
import {correctionRecord,readCorrectionPreview,type CorrectionAction,type CorrectionPreview} from '../../utils/documentCorrection';
import {withAdminActionLock} from './adminCustomerV2Lifecycle';

interface Attempt {version:207;actorId:string;action:CorrectionAction;recordId:string;key:string;
  reason:string;preview:CorrectionPreview;status:'prepared'|'unknown'|'succeeded'|'rejected'}
const client=()=>{if(!isSupabaseConfigured||!supabase)throw new Error('خدمة التصحيحات غير متاحة.');return supabase;};
const actor=async()=>{const {data,error}=await client().auth.getUser();if(error||!data.user)throw new Error('تعذر التحقق من المستخدم الحالي.');return data.user.id;};
const storageKey=(actorId:string,action:CorrectionAction,recordId:string)=>`document-correction207:${actorId}:${action}:${recordId}`;
function readAttempt(raw:string|null,actorId:string,action:CorrectionAction,recordId:string):Attempt|null {
  if(raw===null)return null;
  const a:unknown=JSON.parse(raw);
  if(!correctionRecord(a)||a.version!==207||a.actorId!==actorId||a.action!==action||a.recordId!==recordId
    ||typeof a.key!=='string'||!/^correction207:[0-9a-f-]{36}$/u.test(a.key)||typeof a.reason!=='string'
    ||a.reason.trim().length<3||a.reason.length>500||!['prepared','unknown','succeeded','rejected'].includes(String(a.status)))throw new Error('حالة التصحيح المحفوظة غير متطابقة؛ يلزم مراجعتها قبل محاولة أخرى.');
  readCorrectionPreview(a.preview,action,recordId);return a as unknown as Attempt;
}
const persist=(key:string,a:Attempt)=>{const text=JSON.stringify(a);localStorage.setItem(key,text);if(localStorage.getItem(key)!==text)throw new Error('تعذر تثبيت حالة محاولة التصحيح. استعد نفس المحاولة لمعرفة النتيجة.');};
export async function fetchCorrectionPreview(action:CorrectionAction,recordId:string) {
  const {data,error}=await client().rpc('get_document_correction_preview',{p_action:action,p_record_id:recordId});
  if(error)throw new Error(error.message||'تعذر تحميل المعاينة.');return readCorrectionPreview(data,action,recordId);
}
export async function correctionRecovery(action:CorrectionAction,recordId:string) {
  const id=await actor(),a=readAttempt(localStorage.getItem(storageKey(id,action,recordId)),id,action,recordId);
  return a&&a.status!=='rejected'?{preview:a.preview,reason:a.reason,completed:a.status==='succeeded'}:null;
}
export async function submitDocumentCorrection(action:CorrectionAction,recordId:string,request?:{preview:CorrectionPreview;reason:string}) {
  const actorId=await actor(),key=storageKey(actorId,action,recordId);
  return withAdminActionLock(`${key}:lock`,async()=>{
    if(await actor()!==actorId)throw new Error('تغيّر المستخدم؛ أعد فتح المستند.');
    // Flush WebKit's per-tab storage snapshot after taking the shared lock.
    await new Promise(resolve=>setTimeout(resolve,0));
    const raw=localStorage.getItem(key);let attempt=readAttempt(raw,actorId,action,recordId);
    if(attempt&&attempt.status!=='rejected') {
      if(request&&(request.reason.trim()!==attempt.reason||request.preview.fingerprint!==attempt.preview.fingerprint))throw new Error('توجد محاولة غير محسومة؛ استعد نفس المحاولة دون تغيير المدخلات.');
    }else{
      if(!request)throw new Error('لا توجد محاولة محفوظة لاستعادتها.');
      const reason=request.reason.trim();if(reason.length<3||reason.length>500)throw new Error('اكتب سبباً من3 إلى500 حرف.');
      const preview=readCorrectionPreview(request.preview,action,recordId);if(!preview.eligible)throw new Error(preview.blockedReason||'التصحيح غير متاح.');
      if(typeof crypto.randomUUID!=='function')throw new Error('تعذر إنشاء مفتاح آمن؛ لم يُرسل التصحيح.');
      attempt={version:207,actorId,action,recordId,key:`correction207:${crypto.randomUUID()}`,reason,preview,status:'prepared'};
    }
    if(localStorage.getItem(key)!==raw)throw new Error('تغيّرت المحاولة في نافذة أخرى؛ أعد فتح المستند.');
    const hadUnknown=attempt.status!=='prepared';attempt={...attempt,status:'unknown'};persist(key,attempt);
    const serialized=JSON.stringify(attempt);
    const update=(status:Attempt['status'])=>{if(localStorage.getItem(key)!==serialized)throw new Error('تغيّرت حالة المحاولة؛ يلزم استعادتها.');persist(key,{...attempt,status});};
    let response;
    try{response=await client().rpc('execute_document_correction_once',{p_action:action,p_record_id:recordId,p_reason:attempt.reason,p_idempotency_key:attempt.key,p_preview_fingerprint:attempt.preview.fingerprint});}
    catch{throw new Error('نتيجة التصحيح غير محسومة. استعد نفس المحاولة.');}
    if(response.error){
      // Only a first, explicit PostgreSQL rejection proves no commit. A prior
      // unknown outcome remains recoverable even if today's role was revoked.
      if(!hadUnknown&&['P0001','42501','22023','23514','40001','40P01'].includes(response.error.code??''))update('rejected');
      throw new Error(response.error.message||'نتيجة التصحيح غير محسومة؛ استعد نفس المحاولة.');
    }
    const result:unknown=response.data;
    if(!correctionRecord(result)||result.success!==true||result.contractVersion!==207||result.action!==action||result.recordId!==recordId
      ||!correctionRecord(result.writerResult)||result.writerResult.success!==true)throw new Error('لم يصل دليل نتيجة متطابق؛ استعد نفس المحاولة.');
    if(readCorrectionPreview(result.preview,action,recordId).fingerprint!==attempt.preview.fingerprint)throw new Error('دليل النتيجة يخص معاينة مختلفة؛ استعد نفس المحاولة.');
    update('succeeded');return {recovered:result.idempotent===true};
  });
}
