import {replacementRecord,type SupplierReplacementAction,type SupplierReplacementPayload} from '../../utils/supplierReplacement';

export interface ReplacementAttempt {
  version:208;actorId:string;scope:string;nonce:string;key:string;action:SupplierReplacementAction;payload:SupplierReplacementPayload;
  status:'prepared'|'unknown'|'succeeded'|'rejected';
}
const databaseName='nawasrah-supplier-replacement208',storeName='attempts';
const actions=['shop_pending','shop_immediate','shop_damage','receive','writeoff','reverse','customer_return','replacement_supplier','reclassify_replacement','reclassify_return','credit','reverse_credit'];
const storageError=()=>new Error('تعذر قراءة أو تثبيت سجل المحاولة الآمن. أعد فتح الشاشة للتحقق من المحاولة قبل تسجيل عملية جديدة.');
const canonical=(v:unknown):unknown=>Array.isArray(v)?v.map(canonical):replacementRecord(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>[k,canonical(x)])):v;
export const sameReplacementRequest=(a:unknown,b:unknown)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
function parse(v:unknown,actorId:string,scope:string):ReplacementAttempt|null {
  if(v===undefined)return null;
  if(!replacementRecord(v)||v.version!==208||v.actorId!==actorId||v.scope!==scope||!actions.includes(String(v.action))
    ||Object.keys(v).length!==8||typeof v.nonce!=='string'||!/^sr208:[0-9a-f-]{36}$/u.test(String(v.key))||v.key!==`sr208:${v.nonce}`||!replacementRecord(v.payload)
    ||!['prepared','unknown','succeeded','rejected'].includes(String(v.status)))throw storageError();
  return v as unknown as ReplacementAttempt;
}
async function openDatabase():Promise<IDBDatabase> {
  if(!globalThis.indexedDB)throw storageError();
  return new Promise((resolve,reject)=>{
    let request:IDBOpenDBRequest;
    try{request=indexedDB.open(databaseName,1);}catch{reject(storageError());return;}
    request.onupgradeneeded=()=>{request.result.createObjectStore(storeName);};
    request.onerror=()=>reject(storageError());request.onblocked=()=>reject(storageError());
    request.onsuccess=()=>{const db=request.result;db.onversionchange=()=>db.close();resolve(db);};
  });
}
async function transaction<T>(actorId:string,scope:string,change:(a:ReplacementAttempt|null)=>{result:T;save?:ReplacementAttempt}):Promise<T> {
  const db=await openDatabase();
  return new Promise((resolve,reject)=>{
    let result:T;let failure:unknown;
    let tx:IDBTransaction;
    try{tx=db.transaction(storeName,'readwrite');}catch{db.close();reject(storageError());return;}
    const store=tx.objectStore(storeName),request=store.get([actorId,scope]);
    request.onsuccess=()=>{try{const next=change(parse(request.result,actorId,scope));result=next.result;if(next.save)store.put(next.save,[actorId,scope]);}catch(error){failure=error instanceof DOMException?storageError():error;tx.abort();}};
    tx.oncomplete=()=>{db.close();resolve(result);};
    tx.onabort=tx.onerror=()=>{db.close();reject(failure??storageError());};
  });
}
export const readReplacementAttempt=(actorId:string,scope:string)=>transaction(actorId,scope,a=>({result:a}));
export async function prepareReplacementAttempt(actorId:string,scope:string,action:SupplierReplacementAction,payload:SupplierReplacementPayload,expectedNonce:string|null) {
  // Capture before awaiting IDB. A caller cannot mutate a saved request in flight.
  const immutable=JSON.parse(JSON.stringify(payload)) as SupplierReplacementPayload;
  return transaction(actorId,scope,current=>{
    if((current?.nonce??null)!==expectedNonce)throw new Error('تغيّرت المحاولة في نافذة أخرى. أعد فتحها قبل تسجيل عملية جديدة.');
    if(current&&(current.status==='prepared'||current.status==='unknown')){
      if(current.action!==action||!sameReplacementRequest(current.payload,immutable))throw new Error('توجد محاولة غير محسومة. استعدها بنفس المدخلات أولاً.');
      return {result:current};
    }
    if(typeof crypto.randomUUID!=='function')throw storageError();
    const nonce=crypto.randomUUID(),next:ReplacementAttempt={version:208,actorId,scope,nonce,key:`sr208:${nonce}`,action,payload:immutable,status:'prepared'};
    return {result:next,save:next};
  });
}
export async function markReplacementAttempt(attempt:ReplacementAttempt,status:ReplacementAttempt['status']) {
  return transaction(attempt.actorId,attempt.scope,current=>{
    if(!current||current.nonce!==attempt.nonce||current.key!==attempt.key||current.action!==attempt.action||!sameReplacementRequest(current.payload,attempt.payload))throw new Error('هوية المحاولة المحفوظة تغيرت. أعد فتح الشاشة.');
    if(current.status==='succeeded'&&status!=='succeeded')return {result:current};
    if(current.status==='rejected'&&status!=='rejected')throw new Error('المحاولة مرفوضة؛ راجع البيانات وابدأ عملية جديدة.');
    const next={...current,status};return {result:next,save:next};
  });
}
