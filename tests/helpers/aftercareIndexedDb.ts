/** Small transaction fixture for node tests of the recovery state machine.
 * Real cross-tab IndexedDB/Web Locks are separately exercised in Playwright. */
export function installAftercareIndexedDbFixture():()=>void{
  const before=Object.getOwnPropertyDescriptor(globalThis,'indexedDB');
  const databases=new Map<string,Map<string,unknown>>();
  const factory={open(name:string){
    const request:any={};const created=!databases.has(name);if(created)databases.set(name,new Map());
    const committed=databases.get(name)!;
    const db={createObjectStore(){},close(){},onversionchange:null,
      transaction(){
        const writes=new Map<string,unknown>();let ended=false,pending=0,completion:ReturnType<typeof setImmediate>|undefined;
        const tx:any={};
        const schedule=()=>{if(ended||pending)return;if(completion)clearImmediate(completion);
          completion=setImmediate(()=>{if(ended||pending)return;ended=true;for(const [k,v]of writes)committed.set(k,v);tx.oncomplete?.();});};
        const operation=(work:()=>unknown)=>{pending++;const req:any={};queueMicrotask(()=>{
          if(ended)return;
          try{req.result=structuredClone(work());req.onsuccess?.();}catch(cause){req.error=cause;req.onerror?.();tx.abort();}
          pending--;schedule();
        });return req;};
        tx.objectStore=()=>({get:(key:unknown)=>operation(()=>committed.get(JSON.stringify(key))),
          put:(value:unknown,key:unknown)=>operation(()=>{writes.set(JSON.stringify(key),structuredClone(value));return key;})});
        tx.abort=()=>{if(ended)return;ended=true;if(completion)clearImmediate(completion);queueMicrotask(()=>tx.onabort?.());};
        return tx;
      }};
    request.result=db;
    queueMicrotask(()=>{try{if(created)request.onupgradeneeded?.();request.onsuccess?.();}catch(cause){request.error=cause;request.onerror?.();}});
    return request;
  }};
  Object.defineProperty(globalThis,'indexedDB',{configurable:true,value:factory});
  return()=>{if(before)Object.defineProperty(globalThis,'indexedDB',before);else Reflect.deleteProperty(globalThis,'indexedDB');};
}
