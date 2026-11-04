/** Durable, actor/project/plan-bound orchestration. Never invents a new create key on resume. */
import type {WorkbookProduct} from './productWorkbook';
export interface ProductImportEntry {temporarySku:string;masterId?:string;flavorIds?:Record<string,string>;flavorSkus?:Record<string,string>;complete:boolean}
export interface ProductImportAttempt {version:1;actor:string;project:string;planHash:string;nonce:string;entries:ProductImportEntry[]}
export interface ProductImportSnapshot {id:string;sku:string;barcode:string;metadata?:Record<string,unknown>;flavors:{id:string;name:string;sku:string;barcode:string;metadata?:Record<string,unknown>}[]}
export interface ProductImportPort {
 load:()=>ProductImportAttempt|null;persist:(attempt:ProductImportAttempt)=>void;
 findTemporary:(sku:string)=>Promise<ProductImportSnapshot|null>;
 create:(row:WorkbookProduct,temporarySku:string,key:string)=>Promise<void>;
 read:(id:string)=>Promise<ProductImportSnapshot>;
 assertCreated:(row:WorkbookProduct,current:ProductImportSnapshot)=>void;
 finalize:(row:WorkbookProduct,entry:ProductImportEntry)=>Promise<void>;
 assertFinal:(row:WorkbookProduct,current:ProductImportSnapshot)=>void;
 progress?:(done:number,total:number)=>void;
}
export function createProductImportAttempt(actor:string,project:string,planHash:string,count:number,nonce=crypto.randomUUID()):ProductImportAttempt{
 if(!actor||!project||!/^[a-f0-9]{64}$/u.test(planHash)||!Number.isSafeInteger(count)||count<1||!/^[-a-f0-9]{36}$/u.test(nonce))throw Error('PRODUCT_IMPORT_CONTEXT_INVALID');
 return{version:1,actor,project,planHash,nonce,entries:Array.from({length:count},(_,i)=>({temporarySku:'GI-'+nonce.replaceAll('-','').toUpperCase()+'-'+i,complete:false}))};
}
export async function resumeProductImport(rows:readonly WorkbookProduct[],expected:Pick<ProductImportAttempt,'actor'|'project'|'planHash'>,port:ProductImportPort){
 const attempt=port.load();
 if(!attempt||attempt.version!==1||attempt.actor!==expected.actor||attempt.project!==expected.project||attempt.planHash!==expected.planHash||attempt.entries.length!==rows.length)throw Error('PRODUCT_IMPORT_ATTEMPT_MISMATCH');
 const save=()=>{port.persist(structuredClone(attempt));const read=port.load();if(JSON.stringify(read)!==JSON.stringify(attempt))throw Error('PRODUCT_IMPORT_JOURNAL_NOT_DURABLE');};
 // A quota/readback failure must occur before the first database call.
 save();
 for(const [index,row]of rows.entries()){
  const entry=attempt.entries[index];
  if(!entry.temporarySku.startsWith('GI-'+attempt.nonce.replaceAll('-','').toUpperCase()+'-')||entry.temporarySku!=='GI-'+attempt.nonce.replaceAll('-','').toUpperCase()+'-'+index)throw Error('PRODUCT_IMPORT_JOURNAL_INVALID');
  if(entry.complete){const current=await port.read(entry.masterId!);port.assertFinal(row,current);port.progress?.(index+1,rows.length);continue;}
  if(!entry.masterId){
   let current=await port.findTemporary(entry.temporarySku);
   if(!current){
    // The server's unique temporary SKU fences a delayed/replayed create; its
    // key and nonce are persisted first and never replaced after an unknown result.
    await port.create(row,entry.temporarySku,attempt.nonce+'-'+index);
    current=await port.findTemporary(entry.temporarySku);
   }
   if(!current)throw Error('PRODUCT_IMPORT_CREATE_NOT_CONFIRMED');
   port.assertCreated(row,current);entry.masterId=current.id;
   entry.flavorIds=Object.fromEntries(current.flavors.map(f=>[f.name,f.id]));entry.flavorSkus=Object.fromEntries(current.flavors.map(f=>[f.name,f.sku]));save();
  }
  // IDs must be durable before any temporary identity is renamed.
  await port.finalize(row,entry);
  const current=await port.read(entry.masterId);port.assertFinal(row,current);
  entry.complete=true;save();port.progress?.(index+1,rows.length);
 }
 return{complete:true,count:rows.length,attempt};
}
