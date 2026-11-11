import {supabase,isSupabaseConfigured,sanitizedSupabaseUrl} from '../../lib/supabase';
import {withAdminActionLock} from './adminCustomerV2Lifecycle';
interface Request {etaMinutes:number;driverPhone:string;notes:string|null}
interface Result {success:true;order_id:string;status:'out_for_delivery';accountingTracked:false;estimated_arrival_at:string;tracking_token:string;driver_phone:string;message:string}
interface Attempt {version:1;actorId:string;orderId:string;key:string;request:Request;status:'IN_FLIGHT'|'OUTCOME_UNKNOWN'|'SUCCEEDED';result?:Result}
interface StorageAccess {getItem:(k:string)=>string|null;setItem:(k:string,v:string)=>void}
export interface DeliveryClient {auth:{getUser:()=>PromiseLike<{data:{user:{id:string}|null};error:unknown}>};rpc:(name:'lite1_delivery2',args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:unknown}>}
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v),uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(v);
const invalid=()=>Error('DELIVERY-01: لم نتأكد من حفظ التوصيل. استخدم استرجاع التوصيل المحفوظ؛ لا تبدأ محاولة جديدة.');
export const liteDeliveryKey=(actorId:string,orderId:string)=>'nawasrah:lite-delivery2:'+sanitizedSupabaseUrl+':'+actorId+':'+orderId;
function request(v:unknown):Request {if(!record(v)||!Number.isInteger(v.etaMinutes)||Number(v.etaMinutes)<5||Number(v.etaMinutes)>360||typeof v.driverPhone!=='string'||!/^07[789]\d{7}$/u.test(v.driverPhone)||(v.notes!==null&&(typeof v.notes!=='string'||v.notes.length>1000)))throw invalid();return {etaMinutes:Number(v.etaMinutes),driverPhone:v.driverPhone,notes:v.notes};}
function result(v:unknown,orderId:string):Result {if(!record(v)||v.success!==true||v.order_id!==orderId||v.accountingTracked!==false||v.status!=='out_for_delivery'||!uuid(v.tracking_token)||typeof v.estimated_arrival_at!=='string'||!Number.isFinite(Date.parse(v.estimated_arrival_at))||typeof v.driver_phone!=='string'||!/^07[789]\d{7}$/u.test(v.driver_phone))throw invalid();return {success:true,order_id:orderId,status:'out_for_delivery',accountingTracked:false,estimated_arrival_at:v.estimated_arrival_at,tracking_token:v.tracking_token,driver_phone:v.driver_phone,message:'بدأ التوصيل وتم حفظ وقت الوصول ورقم السائق.'};}
export function readLiteDeliveryAttempt(actorId:string,orderId:string,storage:StorageAccess):Attempt|null{
 if(!uuid(actorId)||!uuid(orderId))throw invalid();let value:unknown;try{const raw=storage.getItem(liteDeliveryKey(actorId,orderId));if(raw===null)return null;value=JSON.parse(raw);}catch{throw invalid();}
 if(!record(value)||value.version!==1||value.actorId!==actorId||value.orderId!==orderId||!uuid(value.key)||!['IN_FLIGHT','OUTCOME_UNKNOWN','SUCCEEDED'].includes(String(value.status))||(value.status==='SUCCEEDED')!==(value.result!==undefined))throw invalid();
 return {version:1,actorId,orderId,key:value.key,request:request(value.request),status:value.status as Attempt['status'],...(value.status==='SUCCEEDED'?{result:result(value.result,orderId)}:{})};
}
function save(value:Attempt,storage:StorageAccess){const key=liteDeliveryKey(value.actorId,value.orderId),raw=JSON.stringify(value);storage.setItem(key,raw);if(storage.getItem(key)!==raw)throw invalid();}
async function identity(client:DeliveryClient,actorId:string){const user=await client.auth.getUser();if(user.error||user.data.user?.id!==actorId)throw invalid();}
/** Explicit recovery ignores newly typed fields and always uses the original
 * saved metadata/body/key. Concurrent clicks share the captured intent. */
export async function runLiteDeliveryWithClient(client:DeliveryClient,actorId:string,orderId:string,input:Request|null,storage:StorageAccess,recover=false){
 const captured=readLiteDeliveryAttempt(actorId,orderId,storage);const fresh=input===null?null:request(input);
 return withAdminActionLock(liteDeliveryKey(actorId,orderId),async()=>{
  await identity(client,actorId);let saved=readLiteDeliveryAttempt(actorId,orderId,storage);
  if(saved?.status==='SUCCEEDED'&&(!captured||captured.key!==saved.key||captured.status!=='SUCCEEDED'))return saved.result!;
  if(recover){if(!saved)throw invalid();if(saved.status==='SUCCEEDED')return saved.result!;}
  else{
   if(saved&&saved.status!=='SUCCEEDED')throw invalid();if(!fresh)throw invalid();
   saved={version:1,actorId,orderId,key:crypto.randomUUID(),request:fresh,status:'IN_FLIGHT'};save(saved,storage);
  }
  if(!saved)throw invalid();const attempt=saved;save({...attempt,status:'IN_FLIGHT'},storage);
  try{
   await identity(client,actorId);const r=await client.rpc('lite1_delivery2',{p_order_id:orderId,p_eta_minutes:attempt.request.etaMinutes,p_driver_phone:attempt.request.driverPhone,p_notes:attempt.request.notes,p_key:attempt.key});if(r.error)throw invalid();
   const done=result(r.data,orderId);await identity(client,actorId);save({...attempt,status:'SUCCEEDED',result:done},storage);return done;
  }catch{const latest=readLiteDeliveryAttempt(actorId,orderId,storage);if(latest?.key===attempt.key&&latest.status!=='SUCCEEDED')save({...attempt,status:'OUTCOME_UNKNOWN'},storage);throw invalid();}
 });
}
async function configured(){if(!isSupabaseConfigured||!supabase)throw invalid();const actor=await supabase.auth.getUser();if(actor.error||!actor.data.user?.id)throw invalid();return {client:supabase,actorId:actor.data.user.id};}
export async function startLiteDelivery(orderId:string,etaMinutes:number,driverPhone:string,notes?:string){const {client,actorId}=await configured();return runLiteDeliveryWithClient(client,actorId,orderId,{etaMinutes,driverPhone,notes:notes?.trim()||null},localStorage);}
export async function pendingLiteDelivery(orderId:string){const {actorId}=await configured(),saved=readLiteDeliveryAttempt(actorId,orderId,localStorage);return saved?.status==='SUCCEEDED'?null:saved;}
export async function recoverLiteDelivery(orderId:string){const {client,actorId}=await configured();return runLiteDeliveryWithClient(client,actorId,orderId,null,localStorage,true);}
