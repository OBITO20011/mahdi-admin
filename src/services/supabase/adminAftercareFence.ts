/** One durable, cross-tab fence per actor/invoice. IndexedDB is authoritative
 * here: a granted Web Lock does not refresh WebKit's localStorage snapshot.
 * This stores identity/status only, never purchase values or preview costs. */
export interface AftercareFenceIdentity {
  actorId:string;orderId:string;action:string;attemptId:string;
  idempotencyKey:string;requestFingerprint:string;
}
interface Fence extends AftercareFenceIdentity {version:215;status:'pending'|'finished'}
const databaseName='nawasrah-aftercare215',storeName='fences';
const unavailable=()=>new Error('AFTERCARE_RECOVERY_UNAVAILABLE: تعذر قراءة سجل المحاولة الآمن؛ لا تبدأ عملية جديدة.');
const review=()=>new Error('AFTERCARE_REVIEW_REQUIRED: هوية المحاولة الآمنة غير متطابقة. أعد فتح الفاتورة.');
const pending=()=>new Error('AFTERCARE_OUTCOME_UNKNOWN: استعد المحاولة السابقة قبل بدء إرجاع أو استبدال آخر.');
const fields=['actorId','orderId','action','attemptId','idempotencyKey','requestFingerprint'] as const;
const actions=['return','replacement','sealed_return','inspected_replacement','exchange'];
const same=(a:AftercareFenceIdentity,b:AftercareFenceIdentity)=>fields.every(k=>a[k]===b[k]);
function parse(raw:unknown,actorId:string,orderId:string):Fence|null {
  if(raw===undefined)return null;
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw review();
  const row=raw as Record<string,unknown>;
  if(Object.keys(row).length!==8||row.version!==215||row.actorId!==actorId||row.orderId!==orderId
    ||!fields.every(k=>typeof row[k]==='string'&&row[k]!=='' )||!actions.includes(String(row.action))
    ||!/^[0-9a-f]{64}$/u.test(String(row.requestFingerprint))||!['pending','finished'].includes(String(row.status)))throw review();
  return row as unknown as Fence;
}
async function open():Promise<IDBDatabase>{
  if(!globalThis.indexedDB)throw unavailable();
  return new Promise((resolve,reject)=>{
    let request:IDBOpenDBRequest;
    try{request=indexedDB.open(databaseName,1);}catch{reject(unavailable());return;}
    request.onupgradeneeded=()=>request.result.createObjectStore(storeName);
    request.onerror=request.onblocked=()=>reject(unavailable());
    request.onsuccess=()=>{const db=request.result;db.onversionchange=()=>db.close();resolve(db);};
  });
}
async function transaction<T>(actorId:string,orderId:string,change:(f:Fence|null)=>{result:T;save?:Fence}):Promise<T>{
  const db=await open();
  return new Promise((resolve,reject)=>{
    let tx:IDBTransaction,result:T,failure:unknown;
    try{tx=db.transaction(storeName,'readwrite');}catch{db.close();reject(unavailable());return;}
    const store=tx.objectStore(storeName),request=store.get([actorId,orderId]);
    request.onsuccess=()=>{try{const next=change(parse(request.result,actorId,orderId));result=next.result;if(next.save)store.put(next.save,[actorId,orderId]);}
      catch(cause){failure=cause instanceof DOMException?unavailable():cause;tx.abort();}};
    request.onerror=()=>{failure=unavailable();};
    tx.onabort=tx.onerror=()=>{db.close();reject(failure??unavailable());};
    tx.oncomplete=()=>{db.close();resolve(result);};
  });
}
export const readAftercareFence=(actorId:string,orderId:string)=>transaction(actorId,orderId,f=>({result:f}));
export async function claimAftercareFence(identity:AftercareFenceIdentity){
  const savedIdentity=Object.fromEntries(fields.map(k=>[k,identity[k]])) as unknown as AftercareFenceIdentity;
  return transaction(identity.actorId,identity.orderId,current=>{
    if(current?.status==='pending'&&!same(current,identity))throw pending();
    return {result:undefined,save:{...savedIdentity,version:215,status:'pending'}};
  });
}
export async function finishAftercareFence(identity:AftercareFenceIdentity){
  return transaction(identity.actorId,identity.orderId,current=>{
    if(!current||!same(current,identity))throw review();
    return {result:undefined,save:{...current,status:'finished'}};
  });
}
